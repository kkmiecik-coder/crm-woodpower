# app/modules/baselinker/service.py - WERSJA Z NOWYM STRUKTURALNYM LOGOWANIEM

import requests
import json
import sys
from typing import Dict, List, Optional
from flask import current_app, session, request
from extensions import db
from .models import BaselinkerOrderLog, BaselinkerConfig
from modules.logging import get_structured_logger

class BaselinkerService:
    """Serwis do komunikacji z API Baselinker"""
    
    def __init__(self):
        self.api_key = current_app.config.get('API_BASELINKER', {}).get('api_key')
        self.endpoint = current_app.config.get('API_BASELINKER', {}).get('endpoint')
        self.logger = get_structured_logger('baselinker.service')
    
    def _make_request(self, method: str, parameters: Dict) -> Dict:
        """Wykonuje żądanie do API Baselinker"""
        if not self.api_key or not self.endpoint:
            self.logger.error("Brak konfiguracji API Baselinker", 
                            method=method, 
                            has_api_key=bool(self.api_key),
                            has_endpoint=bool(self.endpoint))
            raise ValueError("Brak konfiguracji API Baselinker")
        
        headers = {
            'X-BLToken': self.api_key,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        data = {
            'method': method,
            'parameters': json.dumps(parameters)
        }
        
        self.logger.info("Wysyłanie żądania API", 
                        method=method, 
                        endpoint=self.endpoint,
                        params_keys=list(parameters.keys()))
        
        try:
            response = requests.post(self.endpoint, headers=headers, data=data, timeout=30)
            
            self.logger.debug("Otrzymano odpowiedź API", 
                            method=method,
                            status_code=response.status_code,
                            response_size=len(response.content))
            
            response.raise_for_status()
            response_json = response.json()
            
            api_status = response_json.get('status')
            if api_status == 'SUCCESS':
                self.logger.info("Pomyślne wywołanie API", 
                               method=method, 
                               api_status=api_status)
            else:
                self.logger.warning("API zwróciło błąd", 
                                  method=method, 
                                  api_status=api_status,
                                  error_message=response_json.get('error_message'))

            return response_json
            
        except requests.exceptions.RequestException as e:
            self.logger.error("Błąd żądania API", 
                            method=method, 
                            error=str(e),
                            error_type=type(e).__name__)
            raise
    
    def get_order_sources(self) -> List[Dict]:
        """Pobiera dostępne źródła zamówień"""
        self.logger.info("Pobieranie źródeł zamówień z API")
        
        try:
            response = self._make_request('getOrderSources', {})
        
            if response.get('status') == 'SUCCESS':
                sources_data = response.get('sources', {})
                self.logger.debug("Odebrano dane źródeł", 
                                categories_count=len(sources_data),
                                raw_data_keys=list(sources_data.keys()))
            
                sources_list = []
            
                for category, items in sources_data.items():
                    self.logger.debug("Przetwarzanie kategorii źródeł", 
                                    category=category, 
                                    items_count=len(items))
                
                    for source_id, source_name in items.items():
                        sources_list.append({
                            'id': int(source_id) if source_id.isdigit() else 0,
                            'name': f"{source_name} ({category})",
                            'category': category
                        })
                        self.logger.debug("Dodano źródło", 
                                        source_id=source_id, 
                                        source_name=source_name, 
                                        category=category)
            
                self.logger.info("Pomyślnie pobrano źródła zamówień", 
                               total_sources=len(sources_list))
                return sources_list
            else:
                error_msg = response.get('error_message', 'Unknown error')
                self.logger.error("API zwróciło błąd w getOrderSources", 
                                error_message=error_msg)
                raise Exception(f"API Error: {error_msg}")
                
        except Exception as e:
            self.logger.error("Błąd pobierania źródeł zamówień", 
                            error=str(e),
                            error_type=type(e).__name__)
            raise
    
    def get_order_statuses(self) -> List[Dict]:
        """Pobiera dostępne statusy zamówień"""
        self.logger.info("Pobieranie statusów zamówień z API")
        
        try:
            methods_to_try = ['getOrderStatusList', 'getOrderStatuses']
            
            for method_name in methods_to_try:
                try:
                    self.logger.debug("Próba wywołania metody", method=method_name)
                    response = self._make_request(method_name, {})
                    
                    if response.get('status') == 'SUCCESS':
                        statuses = (response.get('order_statuses') or 
                                  response.get('statuses') or 
                                  response.get('order_status_list') or [])
                        
                        self.logger.info("Pomyślnie pobrano statusy", 
                                       method=method_name,
                                       statuses_count=len(statuses))
                        return statuses
                    else:
                        error_msg = response.get('error_message', 'Unknown error')
                        self.logger.warning("Metoda zwróciła błąd", 
                                          method=method_name,
                                          error_message=error_msg)
                        continue
                        
                except Exception as method_error:
                    self.logger.warning("Nieudana próba wywołania metody", 
                                      method=method_name,
                                      error=str(method_error))
                    continue
            
            self.logger.error("Wszystkie metody pobierania statusów nieudane")
            raise Exception("Wszystkie metody pobierania statusów nieudane")
            
        except Exception as e:
            self.logger.error("Błąd pobierania statusów zamówień", 
                            error=str(e),
                            error_type=type(e).__name__)
            raise
    
    def sync_order_sources(self) -> bool:
        """Synchronizuje źródła zamówień z Baselinker"""
        self.logger.info("Rozpoczęcie synchronizacji źródeł zamówień")
        
        try:
            sources = self.get_order_sources()
            self.logger.debug("Pobrano źródła do synchronizacji", sources_count=len(sources))
        
            # DODAJ STANDARDOWE ŹRÓDŁA JEŚLI ICH BRAK
            standard_sources = [
                {'id': 0, 'name': 'Osobiście (personal)', 'category': 'personal'},
                # Możesz dodać więcej standardowych źródeł
            ]
        
            # Połącz źródła z API i standardowe
            all_sources = sources + standard_sources
            
            updated_count = 0
            created_count = 0
        
            for source in all_sources:
                self.logger.debug("Przetwarzanie źródła", 
                                source_id=source.get('id'),
                                source_name=source.get('name'))
            
                existing = BaselinkerConfig.query.filter_by(
                    config_type='order_source',
                    baselinker_id=source.get('id')
                ).first()
            
                if not existing:
                    config = BaselinkerConfig(
                        config_type='order_source',
                        baselinker_id=source.get('id'),
                        name=source.get('name', 'Nieznane zrodlo')
                    )
                    db.session.add(config)
                    created_count += 1
                    self.logger.debug("Utworzono nowe źródło", 
                                    source_name=config.name,
                                    source_id=config.baselinker_id)
                else:
                    existing.name = source.get('name', existing.name)
                    existing.is_active = True
                    updated_count += 1
                    self.logger.debug("Zaktualizowano źródło", 
                                    source_name=existing.name,
                                    source_id=existing.baselinker_id)
        
            db.session.commit()
        
            saved_count = BaselinkerConfig.query.filter_by(config_type='order_source').count()
            self.logger.info("Synchronizacja źródeł zakończona pomyślnie", 
                           created_count=created_count,
                           updated_count=updated_count,
                           total_in_db=saved_count)
        
            return True
        
        except Exception as e:
            db.session.rollback()
            self.logger.error("Błąd synchronizacji źródeł", 
                            error=str(e),
                            error_type=type(e).__name__)
            return False
    
    def sync_order_statuses(self) -> bool:
        """Synchronizuje statusy zamówień z Baselinker"""
        self.logger.info("Rozpoczęcie synchronizacji statusów zamówień")
        
        try:
            statuses = self.get_order_statuses()
            self.logger.debug("Pobrano statusy do synchronizacji", statuses_count=len(statuses))
            
            updated_count = 0
            created_count = 0
            
            for status in statuses:
                self.logger.debug("Przetwarzanie statusu", 
                                status_id=status.get('id'),
                                status_name=status.get('name'))
                
                existing = BaselinkerConfig.query.filter_by(
                    config_type='order_status',
                    baselinker_id=status.get('id')
                ).first()
                
                if not existing:
                    config = BaselinkerConfig(
                        config_type='order_status',
                        baselinker_id=status.get('id'),
                        name=status.get('name', 'Nieznany status')
                    )
                    db.session.add(config)
                    created_count += 1
                    self.logger.debug("Utworzono nowy status", 
                                    status_name=config.name,
                                    status_id=config.baselinker_id)
                else:
                    existing.name = status.get('name', existing.name)
                    existing.is_active = True
                    updated_count += 1
                    self.logger.debug("Zaktualizowano status", 
                                    status_name=existing.name,
                                    status_id=existing.baselinker_id)
            
            db.session.commit()
            
            saved_count = BaselinkerConfig.query.filter_by(config_type='order_status').count()
            self.logger.info("Synchronizacja statusów zakończona pomyślnie", 
                           created_count=created_count,
                           updated_count=updated_count,
                           total_in_db=saved_count)
            
            return True
            
        except Exception as e:
            db.session.rollback()
            self.logger.error("Błąd synchronizacji statusów", 
                            error=str(e),
                            error_type=type(e).__name__)
            return False

    def get_order_details(self, order_id: int) -> Dict:
        """Pobiera szczegóły zamówienia z Baselinker"""
        self.logger.info("Pobieranie szczegółów zamówienia", order_id=order_id)
        
        try:
            parameters = {'order_id': order_id}
            
            response = self._make_request('getOrders', parameters)
            
            if response.get('status') == 'SUCCESS':
                orders = response.get('orders', [])
                self.logger.debug("Otrzymano odpowiedź getOrders", 
                                orders_count=len(orders),
                                order_id=order_id)
                
                if orders:
                    order = orders[0]  # getOrders zwraca listę, ale z order_id powinien być jeden
                    
                    order_details = {
                        'order_id': order.get('order_id'),
                        'order_status_id': order.get('order_status_id'),
                        'payment_done': order.get('payment_done', 0),
                        'currency': order.get('currency'),
                        'order_page': order.get('order_page'),
                        'date_add': order.get('date_add'),
                        'date_confirmed': order.get('date_confirmed')
                    }

                    self.logger.info("Pomyślnie pobrano szczegóły zamówienia",
                                   order_id=order_id,
                                   status_id=order_details['order_status_id'],
                                   payment_done=order_details['payment_done'])

                    return {
                        'success': True,
                        'order': order_details
                    }
                else:
                    self.logger.warning("Zamówienie nie znalezione", order_id=order_id)
                    return {'success': False, 'error': 'Zamówienie nie znalezione'}
            else:
                error_msg = response.get('error_message', 'Unknown error')
                self.logger.error("API zwróciło błąd w get_order_details", 
                                order_id=order_id,
                                error_message=error_msg)
                return {'success': False, 'error': error_msg}
                
        except Exception as e:
            self.logger.error("Wyjątek podczas pobierania szczegółów zamówienia", 
                            order_id=order_id,
                            error=str(e),
                            error_type=type(e).__name__)
            import traceback
            self.logger.debug("Stack trace błędu", traceback=traceback.format_exc())
            return {'success': False, 'error': str(e)}

    def create_order_from_quote(self, quote, user_id: int, config: Dict) -> Dict:
        """Tworzy zamówienie w Baselinker na podstawie wyceny"""
        self.logger.info("Rozpoczęcie tworzenia zamówienia z wyceny",
                        quote_id=quote.id,
                        quote_number=quote.quote_number,
                        user_id=user_id)
        
        try:
            # Przygotuj dane zamówienia
            order_data = self._prepare_order_data(quote, config)
            
            self.logger.debug("Przygotowano dane zamówienia",
                            quote_id=quote.id,
                            products_count=len(order_data.get('products', [])),
                            order_source_id=order_data.get('custom_source_id'),
                            order_status_id=order_data.get('order_status_id'))
            
            # Loguj żądanie
            log_entry = BaselinkerOrderLog(
                quote_id=quote.id,
                action='create_order',
                status='pending',
                request_data=json.dumps(order_data),
                created_by=user_id
            )
            db.session.add(log_entry)
            db.session.flush()
            
            self.logger.debug("Utworzono log entry", log_id=log_entry.id)
            
            # Wyślij żądanie do API
            response = self._make_request('addOrder', order_data)
            
            if response.get('status') == 'SUCCESS':
                baselinker_order_id = response.get('order_id')
                
                # Aktualizuj log
                log_entry.status = 'success'
                log_entry.baselinker_order_id = baselinker_order_id
                log_entry.response_data = json.dumps(response)
                
                # Zaktualizuj wycenę
                quote.base_linker_order_id = baselinker_order_id
                
                # NOWE: Zmień status wyceny na "Złożone" (ID=4)
                quote.status_id = 4
                
                db.session.commit()
                
                self.logger.info("Pomyślnie utworzono zamówienie",
                               quote_id=quote.id,
                               baselinker_order_id=baselinker_order_id,
                               log_id=log_entry.id)
                
                return {
                    'success': True,
                    'order_id': baselinker_order_id,
                    'message': 'Zamowienie zostalo utworzone pomyslnie'
                }
            else:
                error_msg = response.get('error_message', 'Nieznany blad API')
                log_entry.status = 'error'
                log_entry.error_message = error_msg
                log_entry.response_data = json.dumps(response)
                db.session.commit()
                
                self.logger.error("Błąd tworzenia zamówienia w API",
                                quote_id=quote.id,
                                error_message=error_msg,
                                log_id=log_entry.id)
                
                return {
                    'success': False,
                    'error': error_msg
                }
                
        except Exception as e:
            if 'log_entry' in locals():
                log_entry.status = 'error'
                log_entry.error_message = str(e)
                db.session.commit()
                self.logger.debug("Zaktualizowano log entry z błędem", log_id=log_entry.id)
            
            self.logger.error("Wyjątek podczas tworzenia zamówienia", 
                            quote_id=quote.id,
                            error=str(e),
                            error_type=type(e).__name__)
            return {
                'success': False,
                'error': str(e)
            }
    
    def _prepare_order_data(self, quote, config: Dict) -> Dict:
        """Przygotowuje dane zamówienia dla API Baselinker"""
        import time
        from modules.calculator.models import QuoteItemDetails

        self.logger.debug("Rozpoczęcie przygotowania danych zamówienia",
                        quote_id=quote.id,
                        config_keys=list(config.keys()))

        # 🔧 POPRAWKA: Zabezpieczenie przed błędem AppenderQuery
        try:
            # Konwertuj AppenderQuery na listę przed użyciem len()
            all_items = list(quote.items)
            selected_items = [item for item in all_items if item.is_selected]
        
            self.logger.debug("Wybrane produkty do zamówienia", 
                            selected_items_count=len(selected_items),
                            total_items_count=len(all_items))
        except Exception as e:
            # Fallback gdyby był problem z konwersją
            self.logger.warning("Problem z konwersją quote.items na listę",
                              quote_id=quote.id,
                              error=str(e))
            selected_items = []
            for item in quote.items:
                if item.is_selected:
                    selected_items.append(item)
        
            self.logger.debug("Wybrane produkty do zamówienia (fallback)", 
                            selected_items_count=len(selected_items))

        # Sprawdź czy są wybrane produkty
        if not selected_items:
            self.logger.error("Brak wybranych produktów w wycenie", quote_id=quote.id)
            raise ValueError("Wycena nie ma wybranych produktów")

        # Przygotuj produkty
        products = []
        for i, item in enumerate(selected_items):
            # Pobierz szczegóły wykończenia
            finishing_details = QuoteItemDetails.query.filter_by(
                quote_id=quote.id, 
                product_index=item.product_index
            ).first()

            # Pobierz quantity z QuoteItemDetails
            quantity = finishing_details.quantity if finishing_details else 1
            self.logger.debug("Przetwarzanie produktu",
                            product_index=item.product_index,
                            variant_code=item.variant_code,
                            quantity=quantity,
                            has_finishing=bool(finishing_details))

            # Generuj SKU według schematu
            sku = self._generate_sku(item, finishing_details)

            # Nazwa produktu z wymiarami
            base_name = f"{self._translate_variant_code(item.variant_code)} {item.length_cm}×{item.width_cm}×{item.thickness_cm}cm"

            # NOWE: Używamy cen jednostkowych bezpośrednio z bazy (już nie trzeba dzielić!)
            unit_price_netto = float(item.price_netto or 0)
            unit_price_brutto = float(item.price_brutto or 0)

            self.logger.debug("Ceny produktu z bazy",
                            product_index=item.product_index,
                            unit_price_netto=unit_price_netto,
                            unit_price_brutto=unit_price_brutto)

            # Dodaj cenę wykończenia do ceny jednostkowej (jeśli istnieje)
            if finishing_details and finishing_details.finishing_price_netto:
                finishing_unit_netto = float(finishing_details.finishing_price_netto or 0)
                finishing_unit_brutto = float(finishing_details.finishing_price_brutto or 0)
            
                unit_price_netto += finishing_unit_netto
                unit_price_brutto += finishing_unit_brutto
            
                self.logger.debug("Dodano cenę wykończenia",
                                product_index=item.product_index,
                                finishing_netto=finishing_unit_netto,
                                finishing_brutto=finishing_unit_brutto)

            self.logger.debug("Finalne ceny produktu",
                            product_index=item.product_index,
                            final_unit_netto=unit_price_netto,
                            final_unit_brutto=unit_price_brutto,
                            quantity=quantity)

            # Oblicz wagę (zakładając gęstość drewna ~0.7 kg/dm³)
            volume_dm3 = float(item.volume_m3 or 0) * 1000  # m³ na dm³
            weight_kg = round(volume_dm3 * 0.7, 2) if item.volume_m3 else 0.0

            self.logger.debug("Obliczenie wagi produktu",
                            product_index=item.product_index,
                            volume_m3=item.volume_m3,
                            volume_dm3=volume_dm3,
                            weight_kg=weight_kg)

            # Dodaj wykończenie do nazwy jeśli istnieje
            product_name = base_name
            if finishing_details and finishing_details.finishing_type:
                finishing_desc = self._translate_finishing(finishing_details)
                if finishing_desc:
                    product_name += f" ({finishing_desc})"

            products.append({
                'name': product_name,
                'sku': sku,
                'ean': '',  # EAN opcjonalny
                'price_brutto': round(unit_price_brutto, 2),  # CENA JEDNOSTKOWA (nie całkowita!)
                'price_netto': round(unit_price_netto, 2),    # CENA JEDNOSTKOWA (nie całkowita!)
                'tax_rate': 23,  # VAT 23%
                'quantity': quantity,
                'weight': weight_kg,
                'variant_id': 0
            })

        client = quote.client
        if not client:
            self.logger.error("Wycena nie ma przypisanego klienta", quote_id=quote.id)
            raise ValueError("Wycena nie ma przypisanego klienta")

        # Konfiguracja zamówienia
        order_source_id = config.get('order_source_id')
        order_status_id = config.get('order_status_id')
        payment_method = config.get('payment_method', 'Przelew bankowy')
        delivery_method = config.get('delivery_method', quote.courier_name or 'Przesyłka kurierska')
        delivery_price = float(quote.shipping_cost_brutto or 0)

        self.logger.debug("Konfiguracja zamówienia",
                        order_source_id=order_source_id,
                        order_status_id=order_status_id,
                        payment_method=payment_method,
                        delivery_method=delivery_method,
                        delivery_price=delivery_price)

        total_quantity = sum(p['quantity'] for p in products)
        self.logger.info("Przygotowano produkty do zamówienia",
                       products_count=len(products),
                       total_quantity=total_quantity)

        order_data = {
            'custom_source_id': order_source_id,
            'order_status_id': order_status_id,
            'date_add': int(time.time()),
            'currency': 'PLN',
            'payment_method': payment_method,
            'payment_method_cod': 'false',
            'paid': '0',
            'user_comments': f"Zamówienie z wyceny {quote.quote_number}",
            'admin_comments': f"Automatycznie utworzone z wyceny {quote.quote_number} przez system Wood Power CRM",
            'phone': client.phone or '',
            'email': client.email or '',
            'user_login': client.client_name or '',
            'delivery_method': delivery_method,
            'delivery_price': delivery_price,
            'delivery_fullname': client.client_delivery_name or client.client_name or '',
            'delivery_company': client.delivery_company or client.invoice_company or '',
            'delivery_address': client.delivery_address or '',
            'delivery_postcode': client.delivery_zip or '',
            'delivery_city': client.delivery_city or '',
            'delivery_state': client.delivery_region or '',         # ← zamiast delivery_region
            'delivery_country_code': config.get('delivery_country', 'PL'),
            'delivery_point_id': '',
            'delivery_point_name': '',
            'delivery_point_address': '',
            'delivery_point_postcode': '',
            'delivery_point_city': '',
            'invoice_fullname': client.invoice_name or client.client_name or '',
            'invoice_company': client.invoice_company or '',
            'invoice_nip': client.invoice_nip or '',
            'invoice_address': client.invoice_address or client.delivery_address or '',
            'invoice_postcode': client.invoice_zip or client.delivery_zip or '',
            'invoice_city': client.invoice_city or client.delivery_city or '',
            'invoice_state': client.invoice_region or '',           # ← zamiast invoice_region
            'invoice_country_code': config.get('delivery_country', 'PL'),
            'want_invoice': bool(client.invoice_nip),
            'extra_field_1': '',
            'extra_field_2': '',
            'products': products
        }

        self.logger.info("Dane zamówienia przygotowane",
                       order_source_id=order_data['custom_source_id'],
                       order_status_id=order_data['order_status_id'],
                       delivery_method=order_data['delivery_method'],
                       delivery_price=order_data['delivery_price'],
                       products_count=len(products),
                       client_email=order_data['email'])

        return order_data
    
    def _generate_sku(self, item, finishing_details=None):
        """Generuje SKU w formacie BLADEBLIT3501004ABSUR"""
        try:
            # Parsuj kod wariantu (np. "dab-lity-ab")
            variant_parts = item.variant_code.lower().split('-') if item.variant_code else []
            
            # 1. Typ produktu (zawsze BLA dla blat)
            product_type = "BLA"
            
            # 2. Gatunek drewna (pierwsze 3 litery)
            species_map = {
                'dab': 'DEB',
                'jes': 'JES', 
                'buk': 'BUK',
                'brzoza': 'BRZ',
                'sosna': 'SOS'
            }
            species = species_map.get(variant_parts[0] if len(variant_parts) > 0 else '', 'XXX')
            
            # 3. Technologia (pierwsze 3 litery)
            tech_map = {
                'lity': 'LIT',
                'micro': 'MIC',
                'finger': 'FIN'
            }
            technology = tech_map.get(variant_parts[1] if len(variant_parts) > 1 else '', 'XXX')
            
            # 4. Wymiary (bez zer wiodących, ale minimum 3 cyfry dla długości)
            length = str(int(item.length_cm or 0)).zfill(3) if item.length_cm else "000"
            width = str(int(item.width_cm or 0)) if item.width_cm else "0"  
            thickness = str(int(item.thickness_cm or 0)) if item.thickness_cm else "0"
            
            # 5. Klasa drewna
            wood_class = variant_parts[2].upper() if len(variant_parts) > 2 else "XX"
            
            # 6. Wykończenie
            finishing = "SUR"  # Domyślnie surowe
            if finishing_details and finishing_details.finishing_type and finishing_details.finishing_type != 'Brak':
                # Mapowanie wykończeń na 3-literowe kody
                finishing_map = {
                    'lakier': 'LAK',
                    'olej': 'OLE', 
                    'wosk': 'WOS',
                    'bejca': 'BEJ',
                    'lazura': 'LAZ'
                }
                
                finishing_type = finishing_details.finishing_type.lower()
                for key, value in finishing_map.items():
                    if key in finishing_type:
                        finishing = value
                        break
            
            # Składamy SKU
            sku = f"{product_type}{species}{technology}{length}{width}{thickness}{wood_class}{finishing}"
            
            self.logger.debug("Wygenerowano SKU",
                            item_id=item.id,
                            variant_code=item.variant_code,
                            sku=sku,
                            product_type=product_type,
                            species=species,
                            technology=technology,
                            dimensions=f"{length}x{width}x{thickness}",
                            wood_class=wood_class,
                            finishing=finishing)
            
            return sku
            
        except Exception as e:
            self.logger.error("Błąd generowania SKU", 
                            item_id=getattr(item, 'id', None),
                            variant_code=getattr(item, 'variant_code', None),
                            error=str(e))
            # Fallback na stary format
            fallback_sku = f"WP-{item.variant_code.upper()}-{item.id}" if item.variant_code else f"WP-UNKNOWN-{item.id}"
            self.logger.warning("Użyto fallback SKU", sku=fallback_sku)
            return fallback_sku
    
    def _translate_variant_code(self, code: str) -> str:
        """Tłumaczy kod wariantu na czytelną nazwę"""
        translations = {
            'dab-lity-ab': 'Klejonka dębowa lita A/B',
            'dab-lity-bb': 'Klejonka dębowa lita B/B',
            'dab-micro-ab': 'Klejonka dębowa mikrowczep A/B',
            'dab-micro-bb': 'Klejonka dębowa mikrowczep B/B',
            'jes-lity-ab': 'Klejonka jesionowa lita A/B',
            'jes-micro-ab': 'Klejonka jesionowa mikrowczep A/B',
            'buk-lity-ab': 'Klejonka bukowa lita A/B',
            'buk-micro-ab': 'Klejonka bukowa mikrowczep A/B'
        }
        return translations.get(code, f'Klejonka {code}' if code else 'Nieznany produkt')
    
    def _translate_finishing(self, finishing_details):
        """Tłumaczy szczegóły wykończenia na czytelny opis"""
        if not finishing_details or not finishing_details.finishing_type or finishing_details.finishing_type == 'Brak':
            return None
        
        parts = []
        
        # Typ wykończenia
        if finishing_details.finishing_type:
            parts.append(finishing_details.finishing_type)
        
        # Wariant wykończenia
        if finishing_details.finishing_variant and finishing_details.finishing_variant != finishing_details.finishing_type:
            parts.append(finishing_details.finishing_variant)
        
        # Kolor
        if finishing_details.finishing_color:
            parts.append(finishing_details.finishing_color)
        
        # Poziom połysku
        if finishing_details.finishing_gloss_level:
            parts.append(f"połysk {finishing_details.finishing_gloss_level}")
        
        return ' - '.join(parts) if parts else None
    
    def _calculate_item_weight(self, item) -> float:
        """Oblicza wagę produktu na podstawie objętości (przyjmując gęstość drewna 800kg/m³)"""
        if item.volume_m3:
            weight = round(item.volume_m3 * 800, 2)
            self.logger.debug("Obliczono wagę produktu",
                            item_id=getattr(item, 'id', None),
                            volume_m3=item.volume_m3,
                            weight_kg=weight)
            return weight
        return 0.0