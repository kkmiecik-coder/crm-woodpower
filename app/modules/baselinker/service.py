import requests
import json
import logging
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
        
        try:
            response = requests.post(self.endpoint, headers=headers, data=data, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            self.logger.error(f"Błąd żądania Baselinker: {e}")
            raise
    
    def get_order_sources(self) -> List[Dict]:
        """Pobiera dostępne źródła zamówień"""
        try:
            response = self._make_request('getOrderSources', {})
            if response.get('status') == 'SUCCESS':
                return response.get('order_sources', [])
            else:
                raise Exception(f"API Error: {response.get('error_message', 'Unknown error')}")
        except Exception as e:
            self.logger.error(f"Błąd pobierania źródeł zamówień: {e}")
            raise
    
    def get_order_statuses(self) -> List[Dict]:
        """Pobiera dostępne statusy zamówień"""
        try:
            response = self._make_request('getOrderStatuses', {})
            if response.get('status') == 'SUCCESS':
                return response.get('order_statuses', [])
            else:
                raise Exception(f"API Error: {response.get('error_message', 'Unknown error')}")
        except Exception as e:
            self.logger.error(f"Błąd pobierania statusów zamówień: {e}")
            raise
    
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
                
                db.session.commit()
                
                return {
                    'success': True,
                    'order_id': baselinker_order_id,
                    'message': 'Zamówienie zostało utworzone pomyślnie'
                }
            else:
                error_msg = response.get('error_message', 'Nieznany błąd API')
                log_entry.status = 'error'
                log_entry.error_message = error_msg
                log_entry.response_data = json.dumps(response)
                db.session.commit()
                
                return {
                    'success': False,
                    'error': error_msg
                }
                
        except Exception as e:
            # Loguj błąd
            if 'log_entry' in locals():
                log_entry.status = 'error'
                log_entry.error_message = str(e)
                db.session.commit()
            
            self.logger.error(f"Błąd tworzenia zamówienia: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _prepare_order_data(self, quote, config: Dict) -> Dict:
        """Przygotowuje dane zamówienia dla API Baselinker"""
        import time
        
        # Pobierz wybrane produkty
        selected_items = [item for item in quote.items if item.is_selected]
        
        # Przygotuj produkty
        products = []
        for i, item in enumerate(selected_items):
            # Nazwa produktu z wymiarami
            product_name = f"{self._translate_variant_code(item.variant_code)} - {item.length_cm}×{item.width_cm}×{item.thickness_cm}cm"
            
            # Dodaj informacje o wykończeniu jeśli istnieją
            finishing_details = quote.finishing_details.filter_by(product_index=item.product_index).first()
            if finishing_details and finishing_details.finishing_type != 'Brak':
                finishing_parts = [
                    finishing_details.finishing_variant,
                    finishing_details.finishing_type,
                    finishing_details.finishing_color,
                    finishing_details.finishing_gloss_level
                ]
                finishing_str = ' - '.join(filter(None, finishing_parts))
                if finishing_str:
                    product_name += f" - {finishing_str}"
            
            products.append({
                'storage': 'db',
                'storage_id': 0,
                'product_id': f"QUOTE_{quote.id}_ITEM_{item.id}",
                'variant_id': 0,
                'name': product_name,
                'sku': f"WP-{item.variant_code.upper()}-{item.id}",
                'ean': '',
                'location': '',
                'warehouse_id': 0,
                'attributes': '',
                'price_brutto': float(item.final_price_brutto or 0),
                'price_netto': float(item.final_price_netto or 0),
                'tax_rate': 23,
                'quantity': 1,
                'weight': self._calculate_item_weight(item)
            })
        
        # Dane klienta
        client = quote.client
        
        order_data = {
            'order_source_id': config.get('order_source_id', 1),
            'order_status_id': config.get('order_status_id', 1),
            'date_add': int(time.time()),
            'currency': 'PLN',
            'payment_method': config.get('payment_method', 'Przelew bankowy'),
            'payment_method_cod': False,
            'paid': 0,
            'user_comments': f"Zamówienie z wyceny {quote.quote_number}",
            'admin_comments': f"Automatycznie utworzone z wyceny {quote.quote_number} przez system Wood Power CRM",
            'phone': client.phone or '',
            'email': client.email or '',
            'user_login': client.client_name or '',
            'delivery_method': config.get('delivery_method', quote.courier_name or 'Kurier'),
            'delivery_price': float(quote.shipping_cost_brutto or 0),
            'delivery_fullname': client.client_delivery_name or client.client_name or '',
            'delivery_company': client.delivery_company or client.invoice_company or '',
            'delivery_address': client.delivery_address or '',
            'delivery_postcode': client.delivery_zip or '',
            'delivery_city': client.delivery_city or '',
            'delivery_country_code': client.delivery_country or 'PL',
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
            'invoice_country_code': 'PL',
            'want_invoice': bool(client.invoice_nip),
            'extra_field_1': quote.quote_number,
            'extra_field_2': quote.source or '',
            'products': products
        }
        
        return order_data
    
    def _translate_variant_code(self, code: str) -> str:
        """Tłumaczy kod wariantu na czytelną nazwę"""
        translations = {
            'dab-lity-ab': 'Dąb lity A/B',
            'dab-lity-bb': 'Dąb lity B/B',
            'dab-micro-ab': 'Dąb mikrowczep A/B',
            'dab-micro-bb': 'Dąb mikrowczep B/B',
            'jes-lity-ab': 'Jesion lity A/B',
            'jes-micro-ab': 'Jesion mikrowczep A/B',
            'buk-lity-ab': 'Buk lity A/B',
            'buk-micro-ab': 'Buk mikrowczep A/B'
        }
        return translations.get(code, code)
    
    def _calculate_item_weight(self, item) -> float:
        """Oblicza wagę produktu na podstawie objętości (przyjmując gęstość drewna 800kg/m³)"""
        if item.volume_m3:
            return round(item.volume_m3 * 800, 2)
        return 0.0
    
    def sync_order_sources(self) -> bool:
        """Synchronizuje źródła zamówień z Baselinker"""
        try:
            sources = self.get_order_sources()
            
            for source in sources:
                existing = BaselinkerConfig.query.filter_by(
                    config_type='order_source',
                    baselinker_id=source['id']
                ).first()
                
                if not existing:
                    config = BaselinkerConfig(
                        config_type='order_source',
                        baselinker_id=source['id'],
                        name=source['name']
                    )
                    db.session.add(config)
                else:
                    existing.name = source['name']
                    existing.is_active = True
            
            db.session.commit()
            return True
            
        except Exception as e:
            db.session.rollback()
            self.logger.error(f"Błąd synchronizacji źródeł: {e}")
            return False
    
    def sync_order_statuses(self) -> bool:
        """Synchronizuje statusy zamówień z Baselinker"""
        try:
            statuses = self.get_order_statuses()
            
            for status in statuses:
                existing = BaselinkerConfig.query.filter_by(
                    config_type='order_status',
                    baselinker_id=status['id']
                ).first()
                
                if not existing:
                    config = BaselinkerConfig(
                        config_type='order_status',
                        baselinker_id=status['id'],
                        name=status['name']
                    )
                    db.session.add(config)
                else:
                    existing.name = status['name']
                    existing.is_active = True
            
            db.session.commit()
            return True
            
        except Exception as e:
            db.session.rollback()
            self.logger.error(f"Błąd synchronizacji statusów: {e}")
            return False