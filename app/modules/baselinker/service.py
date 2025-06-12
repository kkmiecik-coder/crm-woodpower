# app/modules/baselinker/service.py - OCZYSZCZONA WERSJA TYLKO Z SERWISEM

import requests
import json
import logging
import sys
from typing import Dict, List, Optional
from flask import current_app
from extensions import db
from .models import BaselinkerOrderLog, BaselinkerConfig

class BaselinkerService:
    """Serwis do komunikacji z API Baselinker"""
    
    def __init__(self):
        self.api_key = current_app.config.get('API_BASELINKER', {}).get('api_key')
        self.endpoint = current_app.config.get('API_BASELINKER', {}).get('endpoint')
        self.logger = logging.getLogger(__name__)
    
    def _make_request(self, method: str, parameters: Dict) -> Dict:
        """Wykonuje żądanie do API Baselinker"""
        if not self.api_key or not self.endpoint:
            raise ValueError("Brak konfiguracji API Baselinker")
        
        headers = {
            'X-BLToken': self.api_key,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        data = {
            'method': method,
            'parameters': json.dumps(parameters)
        }
        
        print(f"[BaselinkerService._make_request] Wysylam zadanie API: method={method}, params={parameters}", file=sys.stderr)
        print(f"[BaselinkerService._make_request] URL: {self.endpoint}", file=sys.stderr)
        
        try:
            response = requests.post(self.endpoint, headers=headers, data=data, timeout=30)
            print(f"[BaselinkerService._make_request] HTTP status: {response.status_code}", file=sys.stderr)
            
            response.raise_for_status()
            response_json = response.json()

            return response_json
        except requests.exceptions.RequestException as e:
            print(f"[BaselinkerService._make_request] Blad zadania API: {e}", file=sys.stderr)
            raise
    
    def get_order_sources(self) -> List[Dict]:
        """Pobiera dostępne źródła zamówień"""
        try:
            response = self._make_request('getOrderSources', {})
            print(f"[BaselinkerService] getOrderSources response status: {response.get('status')}", file=sys.stderr)
        
            if response.get('status') == 'SUCCESS':
                sources_data = response.get('sources', {})
                print(f"[BaselinkerService] Raw sources data: {sources_data}", file=sys.stderr)
            
                sources_list = []
            
                for category, items in sources_data.items():
                    print(f"[BaselinkerService] Przetwarzam kategorie: {category} z {len(items)} elementami", file=sys.stderr)
                
                    for source_id, source_name in items.items():
                        sources_list.append({
                            'id': int(source_id) if source_id.isdigit() else 0,
                            'name': f"{source_name} ({category})",
                            'category': category
                        })
                        print(f"[BaselinkerService] Dodano zrodlo: ID={source_id}, Name={source_name}, Category={category}", file=sys.stderr)
            
                print(f"[BaselinkerService] Znaleziono {len(sources_list)} zrodel zamowien", file=sys.stderr)
                return sources_list
            else:
                error_msg = response.get('error_message', 'Unknown error')
                print(f"[BaselinkerService] API Error w getOrderSources: {error_msg}", file=sys.stderr)
                raise Exception(f"API Error: {error_msg}")
        except Exception as e:
            print(f"[BaselinkerService] Blad pobierania zrodel zamowien: {e}", file=sys.stderr)
            raise
    
    def get_order_statuses(self) -> List[Dict]:
        """Pobiera dostępne statusy zamówień"""
        try:
            for method_name in ['getOrderStatusList', 'getOrderStatuses']:
                try:
                    print(f"[BaselinkerService] Probuje metode: {method_name}", file=sys.stderr)
                    response = self._make_request(method_name, {})
                    print(f"[BaselinkerService] {method_name} response status: {response.get('status')}", file=sys.stderr)
                    
                    if response.get('status') == 'SUCCESS':
                        statuses = (response.get('order_statuses') or 
                                  response.get('statuses') or 
                                  response.get('order_status_list') or [])
                        print(f"[BaselinkerService] Znaleziono {len(statuses)} statusow zamowien", file=sys.stderr)
                        return statuses
                    else:
                        error_msg = response.get('error_message', 'Unknown error')
                        print(f"[BaselinkerService] API Error w {method_name}: {error_msg}", file=sys.stderr)
                        continue
                        
                except Exception as method_error:
                    print(f"[BaselinkerService] Metoda {method_name} nieudana: {method_error}", file=sys.stderr)
                    continue
            
            raise Exception("Wszystkie metody pobierania statusow nieudane")
            
        except Exception as e:
            print(f"[BaselinkerService] Blad pobierania statusow zamowien: {e}", file=sys.stderr)
            raise
    
    def sync_order_sources(self) -> bool:
        """Synchronizuje źródła zamówień z Baselinker"""
        try:
            sources = self.get_order_sources()
            print(f"[BaselinkerService] Synchronizuje {len(sources)} zrodel", file=sys.stderr)
        
            # DODAJ STANDARDOWE ŹRÓDŁA JEŚLI ICH BRAK
            standard_sources = [
                {'id': 0, 'name': 'Osobiście (personal)', 'category': 'personal'},
                # Możesz dodać więcej standardowych źródeł
            ]
        
            # Połącz źródła z API i standardowe
            all_sources = sources + standard_sources
        
            for source in all_sources:
                print(f"[BaselinkerService] Przetwarzam zrodlo: {source}", file=sys.stderr)
            
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
                    print(f"[BaselinkerService] Dodano nowe zrodlo: {config.name}", file=sys.stderr)
                else:
                    existing.name = source.get('name', existing.name)
                    existing.is_active = True
                    print(f"[BaselinkerService] Zaktualizowano zrodlo: {existing.name}", file=sys.stderr)
        
            db.session.commit()
        
            saved_count = BaselinkerConfig.query.filter_by(config_type='order_source').count()
            print(f"[BaselinkerService] Zapisano {saved_count} zrodel do bazy", file=sys.stderr)
        
            return True
        
        except Exception as e:
            db.session.rollback()
            print(f"[BaselinkerService] Blad synchronizacji zrodel: {e}", file=sys.stderr)
            return False
    
    def sync_order_statuses(self) -> bool:
        """Synchronizuje statusy zamówień z Baselinker"""
        try:
            statuses = self.get_order_statuses()
            print(f"[BaselinkerService] Synchronizuje {len(statuses)} statusow", file=sys.stderr)
            
            for status in statuses:
                print(f"[BaselinkerService] Przetwarzam status: {status}", file=sys.stderr)
                
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
                    print(f"[BaselinkerService] Dodano nowy status: {config.name}", file=sys.stderr)
                else:
                    existing.name = status.get('name', existing.name)
                    existing.is_active = True
                    print(f"[BaselinkerService] Zaktualizowano status: {existing.name}", file=sys.stderr)
            
            db.session.commit()
            
            saved_count = BaselinkerConfig.query.filter_by(config_type='order_status').count()
            print(f"[BaselinkerService] Zapisano {saved_count} statusow do bazy", file=sys.stderr)
            
            return True
            
        except Exception as e:
            db.session.rollback()
            print(f"[BaselinkerService] Blad synchronizacji statusow: {e}", file=sys.stderr)
            return False

    def get_order_details(self, order_id: int) -> Dict:
        """Pobiera szczegóły zamówienia z Baselinker"""
        
        try:
            parameters = {'order_id': order_id}
            
            response = self._make_request('getOrders', parameters)
            
            if response.get('status') == 'SUCCESS':
                orders = response.get('orders', [])
                print(f"[BaselinkerService.get_order_details] Liczba zamówień w odpowiedzi: {len(orders)}", file=sys.stderr)
                
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

                    result = {
                        'success': True,
                        'order': order_details
                    }
                    return result
                else:
                    return {'success': False, 'error': 'Zamówienie nie znalezione'}
            else:
                error_msg = response.get('error_message', 'Unknown error')
                print(f"[BaselinkerService.get_order_details] API error: {error_msg}", file=sys.stderr)
                return {'success': False, 'error': error_msg}
                
        except Exception as e:
            print(f"[BaselinkerService.get_order_details] WYJĄTEK: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return {'success': False, 'error': str(e)}

    def create_order_from_quote(self, quote, user_id: int, config: Dict) -> Dict:
        """Tworzy zamówienie w Baselinker na podstawie wyceny"""
        try:
            # Przygotuj dane zamówienia
            order_data = self._prepare_order_data(quote, config)
            
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
                
                return {
                    'success': False,
                    'error': error_msg
                }
                
        except Exception as e:
            if 'log_entry' in locals():
                log_entry.status = 'error'
                log_entry.error_message = str(e)
                db.session.commit()
            
            print(f"[BaselinkerService] Blad tworzenia zamowienia: {e}", file=sys.stderr)
            return {
                'success': False,
                'error': str(e)
            }
    
    def _prepare_order_data(self, quote, config: Dict) -> Dict:
        """Przygotowuje dane zamówienia dla API Baselinker"""
        import time
        from modules.calculator.models import QuoteItemDetails

        # Pobierz wybrane produkty
        selected_items = [item for item in quote.items if item.is_selected]

        # Przygotuj produkty
        products = []
        for i, item in enumerate(selected_items):
            # Pobierz szczegóły wykończenia
            finishing_details = QuoteItemDetails.query.filter_by(
                quote_id=quote.id, 
                product_index=item.product_index
            ).first()
    
            # Generuj SKU według schematu
            sku = self._generate_sku(item, finishing_details)
    
            # Nazwa produktu z wymiarami
            base_name = f"{self._translate_variant_code(item.variant_code)} {item.length_cm}×{item.width_cm}×{item.thickness_cm}cm"

            # Oblicz cenę produktu + wykończenie
            product_price_netto = float(item.final_price_netto or 0)
            product_price_brutto = float(item.final_price_brutto or 0)
    
            # Dodaj cenę wykończenia jeśli istnieje
            finishing_price_netto = 0
            finishing_price_brutto = 0
    
            if finishing_details and finishing_details.finishing_price_netto:
                finishing_price_netto = float(finishing_details.finishing_price_netto or 0)
                finishing_price_brutto = float(finishing_details.finishing_price_brutto or 0)
        
                print(f"[BaselinkerService] Produkt {item.product_index}: surowy={product_price_netto}, wykończenie={finishing_price_netto}", file=sys.stderr)
    
            # Suma: produkt surowy + wykończenie
            total_price_netto = product_price_netto + finishing_price_netto
            total_price_brutto = product_price_brutto + finishing_price_brutto
    
            print(f"[BaselinkerService] Końcowa cena produktu {item.product_index}: netto={total_price_netto}, brutto={total_price_brutto}", file=sys.stderr)
    
            # Nazwa produktu z wykończeniem
            if finishing_details and finishing_details.finishing_type and finishing_details.finishing_type != 'Brak':
                finishing_parts = [
                    finishing_details.finishing_variant,
                    finishing_details.finishing_type,
                    finishing_details.finishing_color,
                    finishing_details.finishing_gloss_level
                ]
                finishing_str = ' - '.join(filter(None, finishing_parts))
                if finishing_str:
                    product_name = f"{base_name} {finishing_str}"
                else:
                    product_name = f"{base_name} surowe"
            else:
                product_name = f"{base_name} surowe"

            products.append({
                'storage': 'db',
                'storage_id': 0,
                'product_id': '',
                'variant_id': 0,
                'name': product_name,
                'sku': sku,
                'ean': '',
                'location': '',
                'warehouse_id': 0,
                'attributes': '',
                'price_brutto': total_price_brutto,
                'price_netto': total_price_netto,
                'tax_rate': 23,
                'quantity': 1,
                'weight': self._calculate_item_weight(item)
            })

        # Dane klienta
        client = quote.client

        # Sprawdź metodę dostawy i ustaw odpowiedni koszt wysyłki
        delivery_method = config.get('delivery_method', quote.courier_name or 'Kurier')
        delivery_price = float(quote.shipping_cost_brutto or 0)

        # Zeruj koszt wysyłki dla odbioru osobistego
        if delivery_method and ('odbior' in delivery_method.lower() or 'odbiór' in delivery_method.lower()):
            print(f"[BaselinkerService] Wykryto odbiór osobisty - zerowanie kosztów wysyłki z {delivery_price} na 0.00", file=sys.stderr)
            delivery_price = 0.0
        else:
            print(f"[BaselinkerService] Metoda dostawy '{delivery_method}' - koszt wysyłki: {delivery_price}", file=sys.stderr)

        # 🔧 KRYTYCZNA POPRAWKA: Usuń delivery_region i invoice_region z danych
        order_data = {
            'custom_source_id': config.get('order_source_id', 1),
            'order_status_id': config.get('order_status_id', 105112),
            'date_add': int(time.time()),
            'currency': 'PLN',
            'payment_method': config.get('payment_method', 'Przelew bankowy'),
            'payment_method_cod': False,
            'paid': 0,
            'user_comments': f"Zamowienie z wyceny {quote.quote_number}",
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
            # 🔧 USUNIĘTE: 'delivery_region': client.delivery_region or '',
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
            # 🔧 USUNIĘTE: 'invoice_region': client.invoice_region or client.delivery_region or '',
            'invoice_country_code': config.get('delivery_country', 'PL'),
            'want_invoice': bool(client.invoice_nip),
            'extra_field_1': quote.quote_number,
            'extra_field_2': quote.source or '',
            'products': products
        }

        print(f"[BaselinkerService] ✅ Przygotowane dane zamowienia (BEZ delivery/invoice_region):", file=sys.stderr)
        print(f"[BaselinkerService] - order_source_id: {order_data['custom_source_id']}", file=sys.stderr)
        print(f"[BaselinkerService] - order_status_id: {order_data['order_status_id']}", file=sys.stderr)
        print(f"[BaselinkerService] - delivery_method: {order_data['delivery_method']}", file=sys.stderr)
        print(f"[BaselinkerService] - delivery_price: {order_data['delivery_price']}", file=sys.stderr)
    
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
            
            print(f"[_generate_sku] Wygenerowano SKU: {sku} dla wariantu: {item.variant_code}", file=sys.stderr)
            print(f"  - Produkt: {product_type}, Gatunek: {species}, Tech: {technology}", file=sys.stderr)
            print(f"  - Wymiary: {length}x{width}x{thickness}, Klasa: {wood_class}, Wykończenie: {finishing}", file=sys.stderr)
            
            return sku
            
        except Exception as e:
            print(f"[BaselinkerService] Błąd generowania SKU: {e}", file=sys.stderr)
            # Fallback na stary format
            return f"WP-{item.variant_code.upper()}-{item.id}" if item.variant_code else f"WP-UNKNOWN-{item.id}"
    
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
    
    def _calculate_item_weight(self, item) -> float:
        """Oblicza wagę produktu na podstawie objętości (przyjmując gęstość drewna 800kg/m³)"""
        if item.volume_m3:
            return round(item.volume_m3 * 800, 2)
        return 0.0