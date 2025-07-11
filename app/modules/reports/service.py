# modules/reports/service.py
"""
Serwis do komunikacji z Baselinker API dla modułu Reports
"""

import requests
import json
import sys
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from flask import current_app
from extensions import db
from .models import BaselinkerReportOrder, ReportsSyncLog
from .parser import ProductNameParser
from modules.logging import get_structured_logger
from decimal import Decimal

class BaselinkerReportsService:
    """
    Serwis do synchronizacji danych z Baselinker dla modułu Reports
    """
    
    def __init__(self):
        self.api_key = current_app.config.get('API_BASELINKER', {}).get('api_key')
        self.endpoint = current_app.config.get('API_BASELINKER', {}).get('endpoint')
        self.logger = get_structured_logger('reports.service')
        self.parser = ProductNameParser()
        
        # Mapowanie statusów Baselinker
        self.status_map = {
            105112: "Nowe - nieopłacone",
            105113: "Paczka zgłoszona do wysyłki", 
            105114: "Wysłane - kurier",
            138619: "W produkcji - surowe",
            138620: "Produkcja zakończona",
            138623: "Zamówienie spakowane",
            138624: "Dostarczona - kurier",
            138625: "Zamówienie anulowane",
            148830: "W produkcji - lakierowanie",
            148831: "W produkcji - bejcowanie", 
            148832: "W produkcji - olejowanie",
            149763: "Wysłane - transport WoodPower",
            149777: "Czeka na odbiór osobisty",
            149778: "Dostarczona - trans. WoodPower",
            149779: "Odebrane",
            155824: "Nowe - opłacone"
        }
    
    def fetch_orders_from_baselinker(self, date_from: Optional[datetime] = None, 
                                    order_id: Optional[int] = None) -> List[Dict]:
        """
        Pobiera zamówienia z Baselinker API
    
        Args:
            date_from (datetime): Data od której pobierać zamówienia (opcjonalne)
            order_id (int): Konkretny numer zamówienia (jeśli podany, date_from ignorowane)
        
        Returns:
            List[Dict]: Lista zamówień z Baselinker
        """
        if not self.api_key or not self.endpoint:
            self.logger.error("Brak konfiguracji API Baselinker")
            raise ValueError("Brak konfiguracji API Baselinker")
    
        headers = {
            'X-BLToken': self.api_key,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    
        # Parametry zapytania
        if order_id:
            # Pobierz konkretne zamówienie
            parameters = {
                "order_id": order_id,
                "include_custom_extra_fields": True
            }
            self.logger.info("Pobieranie pojedynczego zamówienia", order_id=order_id)
        else:
            # Pobierz wszystkie zamówienia (bez ograniczenia daty lub z podanej daty)
            parameters = {
                "get_unconfirmed_orders": True,  # ZMIANA: Pobieramy też niezatwierdzone
                "include_custom_extra_fields": True,
                # ZMIANA: Dodajemy filtry statusów - wykluczamy 105112 i 138625
                "filter_order_status_id": "!105112,!138625"  # ! oznacza wykluczenie
            }
        
            # Jeśli podano date_from, dodaj ją do parametrów
            if date_from is not None:
                timestamp = int(date_from.timestamp())
                parameters["date_confirmed_from"] = timestamp
                self.logger.info("Pobieranie zamówień od daty", 
                               date_from=date_from.isoformat(),
                               timestamp=timestamp)
            else:
                self.logger.info("Pobieranie wszystkich zamówień (bez ograniczenia daty)")
    
        data = {
            'method': 'getOrders',
            'parameters': json.dumps(parameters)
        }
    
        try:
            self.logger.debug("Wysyłanie zapytania do Baselinker API", 
                             endpoint=self.endpoint, 
                             parameters=parameters)
        
            response = requests.post(self.endpoint, headers=headers, data=data, timeout=30)
            response.raise_for_status()
        
            result = response.json()
        
            self.logger.debug("Otrzymano odpowiedź z Baselinker API", 
                             status=result.get('status'),
                             response_size=len(str(result)))
        
            if result.get('status') == 'SUCCESS':
                orders = result.get('orders', [])
                self.logger.info("Pomyślnie pobrano zamówienia", 
                               orders_count=len(orders),
                               has_date_filter=date_from is not None,
                               single_order=order_id is not None)
                return orders
            else:
                error_msg = result.get('error_message', 'Nieznany błąd API')
                error_code = result.get('error_code', 'Brak kodu błędu')
                self.logger.error("Błąd API Baselinker przy pobieraniu zamówień",
                                error_message=error_msg,
                                error_code=error_code,
                                api_status=result.get('status'),
                                parameters=parameters)
                raise ValueError(f"Błąd API Baselinker: {error_code} - {error_msg}")
            
        except requests.exceptions.Timeout:
            self.logger.error("Timeout przy pobieraniu zamówień z Baselinker",
                             timeout=30,
                             parameters=parameters)
            raise ValueError("Timeout połączenia z Baselinker API")
        
        except requests.exceptions.RequestException as e:
            self.logger.error("Błąd połączenia z Baselinker API",
                             error=str(e),
                             error_type=type(e).__name__,
                             parameters=parameters)
            raise ValueError(f"Błąd połączenia: {str(e)}")
        
        except ValueError as e:
            # Re-raise ValueError (nasze własne błędy)
            raise
        
        except Exception as e:
            self.logger.error("Nieoczekiwany błąd przy pobieraniu zamówień",
                             error=str(e),
                             error_type=type(e).__name__,
                             parameters=parameters)
            raise ValueError(f"Nieoczekiwany błąd: {str(e)}")
    
    def sync_orders(self, date_from: Optional[datetime] = None, 
                   sync_type: str = 'manual', orders_list: Optional[List[Dict]] = None) -> Dict[str, any]:
        """
        Synchronizuje zamówienia z Baselinker
    
        Args:
            date_from (datetime): Data od której synchronizować (ignorowane jeśli orders_list podane)
            sync_type (str): 'manual', 'auto' lub 'selected'
            orders_list (List[Dict]): Lista zamówień do synchronizacji (opcjonalne)
        
        Returns:
            Dict: Raport synchronizacji
        """
        sync_start = datetime.utcnow()
    
        try:
            self.logger.info("Rozpoczęcie synchronizacji", 
                           sync_type=sync_type,
                           date_from=date_from.isoformat() if date_from else None,
                           orders_list_provided=orders_list is not None,
                           orders_list_count=len(orders_list) if orders_list else 0)
        
            # ZMIANA: Użyj podanej listy zamówień lub pobierz z Baselinker
            if orders_list is not None:
                # Synchronizacja wybranych zamówień
                orders = orders_list
                self.logger.info("Używam podanej listy zamówień", orders_count=len(orders))
            else:
                # Pobierz zamówienia z Baselinker
                orders = self.fetch_orders_from_baselinker(date_from)
                self.logger.info("Pobrano zamówienia z Baselinker", orders_count=len(orders))
        
            if not orders:
                self.logger.info("Brak zamówień do synchronizacji")
                return {
                    'success': True,
                    'message': 'Brak zamówień do synchronizacji',
                    'orders_processed': 0,
                    'orders_added': 0,
                    'orders_updated': 0,
                    'new_orders': []
                }
        
            # Sprawdź które zamówienia już istnieją
            order_ids = [order['order_id'] for order in orders]
            existing_order_ids = self._get_existing_order_ids(order_ids)
        
            self.logger.info("Analiza istniejących zamówień",
                           total_orders=len(orders),
                           existing_orders=len(existing_order_ids),
                           new_orders=len(order_ids) - len(existing_order_ids))
        
            # Przefiltruj nowe zamówienia
            new_orders = [order for order in orders if order['order_id'] not in existing_order_ids]
            existing_orders = [order for order in orders if order['order_id'] in existing_order_ids]
        
            # Dodaj nowe zamówienia
            added_count = 0
            if new_orders:
                self.logger.info("Dodawanie nowych zamówień", count=len(new_orders))
                added_count = self.add_orders_to_database(new_orders)
        
            # Aktualizuj istniejące zamówienia (statusy i płatności)
            updated_count = 0
            if existing_orders:
                self.logger.info("Aktualizowanie istniejących zamówień", count=len(existing_orders))
                updated_count = self._update_existing_orders(existing_orders, existing_order_ids)
        
            # Przygotuj listę nowych zamówień do zwrócenia
            new_orders_info = []
            for order in new_orders:
                new_orders_info.append({
                    'order_id': order['order_id'],
                    'customer_name': order.get('delivery_fullname', 'Nieznany klient'),
                    'total_value': sum(p.get('price_brutto', 0) * p.get('quantity', 1) 
                                     for p in order.get('products', []))
                })
        
            # Zapisz raport synchronizacji
            sync_log = ReportsSyncLog(
                sync_type=sync_type,
                orders_processed=len(orders),
                orders_added=added_count,
                orders_updated=updated_count,
                status='success',
                duration_seconds=int((datetime.utcnow() - sync_start).total_seconds())
            )
            db.session.add(sync_log)
            db.session.commit()
        
            self.logger.info("Synchronizacja zakończona pomyślnie",
                           orders_processed=len(orders),
                           orders_added=added_count,
                           orders_updated=updated_count,
                           duration_seconds=sync_log.duration_seconds)
        
            return {
                'success': True,
                'message': f'Synchronizacja zakończona pomyślnie',
                'orders_processed': len(orders),
                'orders_added': added_count,
                'orders_updated': updated_count,
                'new_orders': new_orders_info,
                'sync_log_id': sync_log.id
            }
        
        except Exception as e:
            # Zapisz błąd do logów
            error_duration = int((datetime.utcnow() - sync_start).total_seconds())
            sync_log = ReportsSyncLog(
                sync_type=sync_type,
                status='error',
                error_message=str(e),
                duration_seconds=error_duration
            )
            db.session.add(sync_log)
            db.session.commit()
        
            self.logger.error("Błąd podczas synchronizacji", 
                             error=str(e),
                             error_type=type(e).__name__,
                             sync_type=sync_type)
        
            return {
                'success': False,
                'error': str(e),
                'orders_processed': 0,
                'orders_added': 0,
                'orders_updated': 0
            }
    
    def add_orders_to_database(self, orders: List[Dict]) -> int:
        """
        Dodaje zamówienia do bazy danych
        
        Args:
            orders (List[Dict]): Lista zamówień z Baselinker
            
        Returns:
            int: Liczba dodanych rekordów (produktów)
        """
        added_count = 0
        
        for order in orders:
            try:
                # Konwertuj zamówienie na rekordy w bazie
                records = self._convert_order_to_records(order)
                
                for record in records:
                    db.session.add(record)
                    added_count += 1
                
                self.logger.debug("Dodano zamówienie do bazy",
                                order_id=order['order_id'],
                                products_count=len(records))
                
            except Exception as e:
                self.logger.error("Błąd dodawania zamówienia",
                                order_id=order.get('order_id'),
                                error=str(e))
                continue
        
        try:
            db.session.commit()
            self.logger.info("Dodano rekordy do bazy", added_count=added_count)
        except Exception as e:
            db.session.rollback()
            self.logger.error("Błąd zapisu do bazy", error=str(e))
            raise
        
        return added_count
    
    def _convert_order_to_records(self, order: Dict) -> List[BaselinkerReportOrder]:
        """
        Konwertuje zamówienie z Baselinker na rekordy w bazie (jeden rekord = jeden produkt)
        """
        records = []
        products = order.get('products', [])
    
        if not products:
            self.logger.warning("Zamówienie bez produktów",
                              order_id=order.get('order_id'))
            return records
    
        # Podstawowe dane zamówienia (wspólne dla wszystkich produktów)
        base_data = self._extract_base_order_data(order)
    
        # Oblicz łączną wartość zamówienia netto (dla order_amount_net)
        total_order_value_gross = 0
        for product in products:
            product_value = float(product.get('price_brutto', 0)) * int(product.get('quantity', 1))
            total_order_value_gross += product_value
    
        # Dodaj koszt dostawy
        delivery_cost_gross = float(order.get('delivery_price', 0))
        total_order_value_gross += delivery_cost_gross
    
        # Przelicz na netto (VAT 23%)
        total_order_value_net = total_order_value_gross / 1.23
    
        # NOWA LOGIKA: Oblicz łączną objętość wszystkich produktów w zamówieniu
        total_m3_all_products = 0.0
        for product in products:
            try:
                parsed_product = self.parser.parse_product_name(product.get('name', ''))
        
                # POPRAWKA: Bezpieczna konwersja wszystkich wymiarów na float
                length_cm = parsed_product.get('length_cm')
                width_cm = parsed_product.get('width_cm') 
                thickness_mm = parsed_product.get('thickness_mm')
                quantity = int(product.get('quantity', 1))
        
                # Bezpieczna konwersja Decimal/None na float
                def safe_float_convert(value):
                    if value is None:
                        return 0.0
                    if isinstance(value, Decimal):
                        return float(value)
                    try:
                        return float(value)
                    except (ValueError, TypeError):
                        return 0.0
        
                length_m = safe_float_convert(length_cm) / 100 if length_cm else 0.0
                width_m = safe_float_convert(width_cm) / 100 if width_cm else 0.0
                thickness_m = safe_float_convert(thickness_mm) / 1000 if thickness_mm else 0.0
        
                if length_m > 0 and width_m > 0 and thickness_m > 0:
                    product_m3 = length_m * width_m * thickness_m * quantity
                    total_m3_all_products += product_m3
            
                    self.logger.debug("Obliczono objętość produktu",
                                    order_id=order.get('order_id'),
                                    product_name=product.get('name'),
                                    length_m=round(length_m, 4),
                                    width_m=round(width_m, 4),
                                    thickness_m=round(thickness_m, 4),
                                    quantity=quantity,
                                    product_m3=round(product_m3, 6))
                else:
                    self.logger.debug("Nie można obliczyć objętości - brak wymiarów",
                                    order_id=order.get('order_id'),
                                    product_name=product.get('name'),
                                    parsed_dimensions={
                                        'length_cm': safe_float_convert(length_cm) if length_cm else None,
                                        'width_cm': safe_float_convert(width_cm) if width_cm else None,
                                        'thickness_mm': safe_float_convert(thickness_mm) if thickness_mm else None
                                    })
            
            except Exception as e:
                self.logger.warning("Błąd obliczania objętości produktu",
                                  order_id=order.get('order_id'),
                                  product_name=product.get('name'),
                                  error=str(e),
                                  error_type=type(e).__name__)
                continue

        self.logger.info("Obliczono łączną objętość zamówienia",
                        order_id=order.get('order_id'),
                        total_m3=round(total_m3_all_products, 6),
                        products_count=len(products))
    
        # Teraz utwórz rekordy dla każdego produktu z tą samą łączną objętością
        for product in products:
            try:
                # Parsuj nazwę produktu
                parsed_product = self.parser.parse_product_name(product.get('name', ''))
            
                # Utwórz rekord
                record = BaselinkerReportOrder(
                    # Dane zamówienia
                    **base_data,
                
                    # ZMIANA: Każdy rekord ma tę samą łączną objętość całego zamówienia
                    total_m3=total_m3_all_products,
                    order_amount_net=total_order_value_net,
                    
                    # Dane produktu z Baselinker
                    raw_product_name=product.get('name'),
                    quantity=product.get('quantity', 1),
                    price_gross=product.get('price_brutto', 0),
                    
                    # Dane z parsera
                    product_type=parsed_product.get('product_type') or 'deska',  # Domyślnie deska
                    wood_species=parsed_product.get('wood_species'),
                    technology=parsed_product.get('technology'),
                    wood_class=parsed_product.get('wood_class'),
                    finish_state=parsed_product.get('finish_state', 'surowy'),
                    length_cm=parsed_product.get('length_cm'),
                    width_cm=parsed_product.get('width_cm'),
                    thickness_cm=parsed_product.get('thickness_cm'),
                    
                    # Grupa - domyślnie 'towar' dla produktów z Baselinker
                    group_type='towar',
                    
                    # Pola techniczne
                    is_manual=False
                )
                
                # Oblicz pola pochodne
                record.calculate_fields()
                
                records.append(record)
                
            except Exception as e:
                self.logger.error("Błąd przetwarzania produktu",
                                order_id=order.get('order_id'),
                                product_name=product.get('name'),
                                error=str(e))
                continue
        
        return records
    
    def _extract_base_order_data(self, order: Dict) -> Dict:
        """
        Wyciąga podstawowe dane zamówienia (wspólne dla wszystkich produktów)
        """
        # Konwertuj timestamp na datę
        date_add = order.get('date_add')
        if date_add:
            date_created = datetime.fromtimestamp(date_add).date()
        else:
            date_created = datetime.now().date()
        
        # Wyciągnij nazwę klienta (priorytet: delivery_fullname > delivery_company > user_login)
        customer_name = (
            order.get('delivery_fullname') or 
            order.get('delivery_company') or 
            order.get('user_login') or 
            'Nieznany klient'
        )
        
        # Mapuj status
        status_id = order.get('order_status_id')
        current_status = self.status_map.get(status_id, f'Status {status_id}')
        
        # Oblicz zapłaconą kwotę netto z brutto
        payment_done_gross = order.get('payment_done', 0)
        paid_amount_net = float(payment_done_gross) / 1.23 if payment_done_gross else 0
        
        # Oblicz koszt dostawy netto
        delivery_price_gross = order.get('delivery_price', 0)
        delivery_cost_net = float(delivery_price_gross) / 1.23 if delivery_price_gross else 0

        # Pobieramy custom fields i wyciągamy opiekuna
        custom_fields = order.get('custom_extra_fields') or {}
        caretaker_name = custom_fields.get('105623') or "Brak danych"
        
        return {
            'date_created': date_created,
            'baselinker_order_id': order.get('order_id'),
            'internal_order_number': order.get('extra_field_1'),
            'customer_name': customer_name,
            'delivery_postcode': order.get('delivery_postcode'),
            'delivery_city': order.get('delivery_city'),
            'delivery_address': order.get('delivery_address'),
            'delivery_state': order.get('delivery_state'),
            'phone': order.get('phone'),
            'caretaker': caretaker_name,
            'delivery_method': order.get('delivery_method'),
            'order_source': order.get('order_source'),
            'current_status': current_status,
            'baselinker_status_id': status_id,
            'delivery_cost': delivery_cost_net,  # Koszt dostawy netto
            'payment_method': order.get('payment_method'),
            'paid_amount_net': paid_amount_net,  # Zapłacono netto
            'email': order.get('email')
        }
    
    def _get_existing_order_ids(self, order_ids: List[int]) -> set:
        """
        Pobiera ID zamówień które już istnieją w bazie
        """
        existing = db.session.query(BaselinkerReportOrder.baselinker_order_id)\
            .filter(BaselinkerReportOrder.baselinker_order_id.in_(order_ids))\
            .distinct().all()
        
        return {row[0] for row in existing}
    
    def _update_existing_orders(self, orders: List[Dict], existing_order_ids: set) -> int:
        """
        Aktualizuje statusy istniejących zamówień
        """
        updated_count = 0
        
        for order in orders:
            order_id = order['order_id']
            if order_id not in existing_order_ids:
                continue
            
            try:
                # Pobierz status z Baselinker
                status_id = order.get('order_status_id')
                new_status = self.status_map.get(status_id, f'Status {status_id}')
                
                # Oblicz zapłaconą kwotę netto z brutto
                payment_done_gross = order.get('payment_done', 0)
                paid_amount_net = float(payment_done_gross) / 1.23 if payment_done_gross else 0
                
                # Aktualizuj wszystkie rekordy tego zamówienia
                records = BaselinkerReportOrder.query.filter_by(baselinker_order_id=order_id).all()
                
                for record in records:
                    if record.current_status != new_status or record.paid_amount_net != paid_amount_net:
                        record.current_status = new_status
                        record.baselinker_status_id = status_id
                        record.paid_amount_net = paid_amount_net
                        record.updated_at = datetime.utcnow()
                        
                        # Przelicz pola produkcji na podstawie nowego statusu
                        record.update_production_fields()
                        
                        # Przelicz saldo (order_amount_net - paid_amount_net)
                        if record.order_amount_net is not None:
                            record.balance_due = float(record.order_amount_net) - paid_amount_net
                        
                        updated_count += 1
                
            except Exception as e:
                self.logger.error("Błąd aktualizacji zamówienia",
                                order_id=order_id,
                                error=str(e))
                continue
        
        if updated_count > 0:
            try:
                db.session.commit()
                self.logger.info("Zaktualizowano rekordy", updated_count=updated_count)
            except Exception as e:
                db.session.rollback()
                self.logger.error("Błąd zapisu aktualizacji", error=str(e))
                raise
        
        return updated_count
    
    def get_order_details(self, order_id: int) -> Optional[Dict]:
        """
        Pobiera szczegóły pojedynczego zamówienia z Baselinker
        """
        try:
            orders = self.fetch_orders_from_baselinker(order_id=order_id)
            return orders[0] if orders else None
        except Exception as e:
            self.logger.error("Błąd pobierania szczegółów zamówienia",
                            order_id=order_id,
                            error=str(e))
            return None
    
    def check_for_new_orders(self, hours_back: int = 24) -> Tuple[bool, int]:
        """
        Sprawdza czy są nowe zamówienia w Baselinker (dla automatycznego sprawdzania)
    
        Args:
            hours_back (int): Ile godzin wstecz sprawdzać (domyślnie 24h)
        
        Returns:
            Tuple[bool, int]: (czy_są_nowe, liczba_nowych)
        """
        try:
            self.logger.info("Rozpoczęcie sprawdzania nowych zamówień", 
                            hours_back=hours_back)
        
            date_from = datetime.now() - timedelta(hours=hours_back)
            orders = self.fetch_orders_from_baselinker(date_from)
        
            if not orders:
                self.logger.info("Brak zamówień w sprawdzanym okresie",
                               date_from=date_from.isoformat())
                return False, 0
        
            # Sprawdź które zamówienia już mamy
            order_ids = [order['order_id'] for order in orders]
            existing_ids = self._get_existing_order_ids(order_ids)
        
            new_orders_count = len(order_ids) - len(existing_ids)
            has_new = new_orders_count > 0
        
            self.logger.info("Sprawdzenie nowych zamówień zakończone",
                           total_orders=len(orders),
                           existing_orders=len(existing_ids),
                           new_orders=new_orders_count,
                           has_new_orders=has_new)
        
            return has_new, new_orders_count
        
        except Exception as e:
            self.logger.error("Błąd sprawdzania nowych zamówień", 
                             error=str(e),
                             error_type=type(e).__name__,
                             hours_back=hours_back)
            return False, 0

# ===== FUNKCJE POMOCNICZE =====

def get_reports_service() -> BaselinkerReportsService:
    """
    Factory function dla serwisu
    """
    return BaselinkerReportsService()


def sync_recent_orders(days_back: int = None) -> Dict:
    """
    Synchronizuje zamówienia z ostatnich X dni lub wszystkie jeśli days_back=None
    
    Args:
        days_back (int): Ile dni wstecz synchronizować (None = wszystkie)
        
    Returns:
        Dict: Wynik synchronizacji
    """
    service = get_reports_service()
    
    if days_back is not None:
        date_from = datetime.now() - timedelta(days=days_back)
        service.logger.info("Synchronizacja zamówień z ostatnich dni", 
                          days_back=days_back,
                          date_from=date_from.isoformat())
    else:
        date_from = None
        service.logger.info("Synchronizacja wszystkich zamówień")
    
    return service.sync_orders(date_from=date_from, sync_type='manual')

def check_new_orders_available() -> Tuple[bool, int]:
    """
    Sprawdza czy są dostępne nowe zamówienia
    """
    service = get_reports_service()
    return service.check_for_new_orders()