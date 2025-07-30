# modules/reports/service.py
"""
Serwis do komunikacji z Baselinker API dla modułu Reports
"""

import requests
import json
import sys
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta, date
from flask import current_app
from extensions import db
from .models import BaselinkerReportOrder, ReportsSyncLog
from .utils import PostcodeToStateMapper
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

    def _create_order_record(self, order: Dict, product: Dict, parsed_product: Dict, 
                       total_m3_all_products: float, total_order_value_net: float) -> BaselinkerReportOrder:
        """
        Tworzy rekord zamówienia z automatycznym uzupełnianiem województwa
        """
        try:
            # Pobierz dane adresowe
            postcode = order.get('delivery_postcode', '').strip()
            current_state = order.get('delivery_state', '').strip()
        
            # NOWA LOGIKA: Automatyczne uzupełnianie województwa zgodnie z wymaganiami
            final_state = self._auto_fill_state_for_order(postcode, current_state)
        
            # Oblicz wartości produktu
            quantity = product.get('quantity', 1)
            price_gross = safe_float_convert(product.get('price_brutto', 0))
            price_net = price_gross / 1.23 if price_gross else 0
            value_gross = price_gross * quantity
            value_net = price_net * quantity
            volume_per_piece = parsed_product.get('volume_per_piece') or Decimal('0')
            total_volume = float(volume_per_piece) * quantity
            price_per_m3 = (price_net / float(volume_per_piece)) if volume_per_piece > 0 else 0
        
            record = BaselinkerReportOrder(
                # Dane zamówienia
                date_created=datetime.strptime(order['date_add'], '%Y-%m-%d %H:%M:%S').date(),
                total_m3=total_m3_all_products,
                order_amount_net=total_order_value_net,
                baselinker_order_id=order.get('order_id'),
                internal_order_number=order.get('extra_field_1'),
                customer_name=order.get('delivery_fullname'),
                delivery_postcode=postcode,
                delivery_city=order.get('delivery_city'),
                delivery_address=order.get('delivery_address'),
                delivery_state=final_state,  # ZMIANA: Użyj przetworzoonego województwa
                phone=order.get('phone'),
                caretaker=order.get('user_comments'),
                delivery_method=order.get('delivery_method'),
                order_source=order.get('order_source'),
            
                # Dane produktu z Baselinker
                raw_product_name=product.get('name'),
                quantity=quantity,
                price_gross=price_gross,
                price_net=price_net,
                value_gross=value_gross,
                value_net=value_net,
                volume_per_piece=float(volume_per_piece),
                total_volume=total_volume,
                price_per_m3=price_per_m3,
            
                # Dane z parsera
                group_type='towar',
                product_type=parsed_product.get('product_type') or 'klejonka',
                finish_state=parsed_product.get('finish_state') or 'surowy',
                wood_species=parsed_product.get('wood_species'),
                technology=parsed_product.get('technology'),
                wood_class=parsed_product.get('wood_class'),
                length_cm=float(parsed_product.get('length_cm') or 0),
                width_cm=float(parsed_product.get('width_cm') or 0),
                thickness_cm=float(parsed_product.get('thickness_cm') or 0),
            
                # Status i pozostałe
                current_status=self.status_map.get(order.get('order_status_id'), 'Nieznany'),
                delivery_cost=safe_float_convert(order.get('delivery_price', 0)),
                payment_method=order.get('payment_method'),
                paid_amount_net=safe_float_convert(order.get('payment_done', 0)) / 1.23,
                balance_due=max(0, value_net - (safe_float_convert(order.get('paid', 0)) / 1.23)),
            
                # Dane produkcji (zostaną zaktualizowane przez metodę update_production_fields)
                production_volume=0,
                production_value_net=0,
                ready_pickup_volume=0
            )
        
            # Aktualizuj pola produkcji na podstawie statusu
            record.update_production_fields()
        
            return record
        
        except Exception as e:
            self.logger.error("Błąd tworzenia rekordu zamówienia",
                            order_id=order.get('order_id'),
                            product_name=product.get('name'),
                            error=str(e),
                            error_type=type(e).__name__)
            raise

    def _auto_fill_state_for_order(self, postcode: str, current_state: str) -> str:
        """
        Automatyczne uzupełnianie województwa zgodnie z wymaganiami:
        1. Jeśli województwo jest wpisane - puszczamy dalej
        2. Jeśli nie ma województwa, sprawdzamy kod pocztowy i uzupełniamy  
        3. Jeśli nie ma województwa ani kodu pocztowego - puszczamy dalej
    
        Args:
            postcode (str): Kod pocztowy
            current_state (str): Obecne województwo
        
        Returns:
            str: Finalne województwo
        """
        # KROK 1: Jeśli województwo jest wpisane - puszczamy dalej
        if current_state and current_state.strip():
            self.logger.debug("Województwo już wpisane, pomijamy auto-fill",
                             current_state=current_state,
                             postcode=postcode)
            return current_state.strip()
    
        # KROK 2: Jeśli nie ma województwa, sprawdzamy kod pocztowy i uzupełniamy
        if postcode and postcode.strip():
            auto_state = PostcodeToStateMapper.get_state_from_postcode(postcode)
            if auto_state:
                self.logger.info("Automatyczne uzupełnienie województwa z kodu pocztowego",
                               postcode=postcode,
                               auto_filled_state=auto_state)
                return auto_state
            else:
                self.logger.debug("Nie rozpoznano województwa z kodu pocztowego",
                                postcode=postcode)
    
        # KROK 3: Jeśli nie ma województwa ani kodu pocztowego - puszczamy dalej
        self.logger.debug("Brak danych do auto-fill województwa",
                         postcode=postcode or 'BRAK',
                         current_state=current_state or 'BRAK')
        return current_state or ''

    def update_existing_record(self, record: BaselinkerReportOrder, order: Dict, 
                         product: Dict, parsed_product: Dict) -> bool:
        """
        Aktualizuje istniejący rekord z automatycznym uzupełnianiem województwa
        """
        try:
            changes_made = False
        
            # Pobierz dane adresowe
            postcode = order.get('delivery_postcode', '').strip()
            current_state = order.get('delivery_state', '').strip()
        
            # NOWA LOGIKA: Automatyczne uzupełnianie województwa
            auto_state = self._auto_fill_state_for_order(postcode, current_state or record.delivery_state)
        
            # Sprawdź czy województwo się zmieniło
            if record.delivery_state != auto_state:
                self.logger.info("Aktualizacja województwa w istniejącym rekordzie",
                               record_id=record.id,
                               order_id=order.get('order_id'),
                               postcode=postcode,
                               old_state=record.delivery_state or 'BRAK',
                               new_state=auto_state)
                record.delivery_state = auto_state
                changes_made = True
        
            # Sprawdź inne pola, które mogły się zmienić
            new_status = self.status_map.get(order.get('order_status_id'), 'Nieznany')
            if record.current_status != new_status:
                record.current_status = new_status
                changes_made = True
        
            # Sprawdź dane kontaktowe
            new_phone = order.get('phone', '').strip()
            if record.phone != new_phone:
                record.phone = new_phone
                changes_made = True
        
            # Sprawdź kod pocztowy
            if record.delivery_postcode != postcode:
                record.delivery_postcode = postcode
                changes_made = True
        
            # Sprawdź miasto
            new_city = order.get('delivery_city', '').strip()
            if record.delivery_city != new_city:
                record.delivery_city = new_city
                changes_made = True
        
            # Sprawdź adres
            new_address = order.get('delivery_address', '').strip()
            if record.delivery_address != new_address:
                record.delivery_address = new_address
                changes_made = True
        
            # Jeśli zaszły zmiany, zaktualizuj pola produkcji
            if changes_made:
                record.update_production_fields()
                record.updated_at = datetime.utcnow()
        
            return changes_made
        
        except Exception as e:
            self.logger.error("Błąd aktualizacji rekordu",
                            record_id=record.id,
                            order_id=order.get('order_id'),
                            error=str(e))
            return False
    
    def fetch_orders_from_baselinker(self, date_from: Optional[datetime] = None, order_id: Optional[int] = None, max_orders: int = 500, include_excluded_statuses: bool = False) -> List[Dict]:
        """
        Pobiera zamówienia z Baselinker API z prawidłową paginacją
    
        Args:
            date_from (datetime): Data od której pobierać zamówienia (opcjonalne)
            order_id (int): Konkretny numer zamówienia (jeśli podany, date_from ignorowane)
            max_orders (int): Maksymalna liczba zamówień do pobrania (domyślnie 500)
            include_excluded_statuses (bool): Czy dołączyć anulowane i nieopłacone (domyślnie False)
    
        Returns:
            List[Dict]: Lista zamówień z Baselinker (bez duplikatów)
        """
        if not self.api_key or not self.endpoint:
            self.logger.error("Brak konfiguracji API Baselinker")
            raise ValueError("Brak konfiguracji API Baselinker")

        headers = {
            'X-BLToken': self.api_key,
            'Content-Type': 'application/x-www-form-urlencoded'
        }

        # Jeśli pobieramy konkretne zamówienie
        if order_id:
            parameters = {
                "order_id": order_id,
                "include_custom_extra_fields": True
            }
        
            # POPRAWKA: Dodaj filtr statusów także dla pojedynczego zamówienia
            if not include_excluded_statuses:
                parameters["filter_order_status_id"] = "!105112,!138625"  # Wykluczamy nieopłacone i anulowane
        
            self.logger.info("Pobieranie pojedynczego zamówienia", 
                            order_id=order_id,
                            include_excluded_statuses=include_excluded_statuses)
    
            data = {
                'method': 'getOrders',
                'parameters': json.dumps(parameters)
            }
    
            try:
                response = requests.post(self.endpoint, headers=headers, data=data, timeout=30)
                response.raise_for_status()
                result = response.json()
        
                if result.get('status') == 'SUCCESS':
                    orders = result.get('orders', [])
                    self.logger.info("Pomyślnie pobrano zamówienia", 
                                   orders_count=len(orders),
                                   has_date_filter=False,
                                   single_order=True,
                                   filtered_excluded_statuses=not include_excluded_statuses)
                    return orders
                else:
                    error_msg = result.get('error_message', 'Nieznany błąd API')
                    self.logger.error("Błąd API Baselinker", error_message=error_msg)
                    return []
                
            except Exception as e:
                self.logger.error("Błąd pobierania pojedynczego zamówienia", 
                                 order_id=order_id, error=str(e))
                return []

        # POBIERANIE WIELU ZAMÓWIEŃ Z PRAWIDŁOWĄ PAGINACJĄ BASELINKER
        all_orders = []
        seen_order_ids = set()  # Przechowuje ID zamówień które już mamy
        page = 0

        # Pobieranie w pętli z PRAWIDŁOWĄ paginacją według dokumentacji Baselinker
        current_date_from = date_from  # Startuj od podanej daty
        current_time = datetime.now()

        self.logger.info("Rozpoczęcie pobierania zamówień z prawidłową paginacją Baselinker",
                        date_from=current_date_from.isoformat() if current_date_from else None,
                        current_time=current_time.isoformat(),
                        max_orders=max_orders,
                        existing_orders_count=len(seen_order_ids),
                        include_excluded_statuses=include_excluded_statuses)

        while len(all_orders) < max_orders:
            page += 1
    
            # Parametry dla tego zapytania - zgodnie z dokumentacją Baselinker
            parameters = {
                "include_custom_extra_fields": True,
                "get_unconfirmed_orders": True,  # WAŻNE: żeby łapać niepotwierdzone
            }
        
            # POPRAWKA: Zawsze dodawaj filtr statusów (chyba że explicite żądamy wszystkich)
            if not include_excluded_statuses:
                parameters["filter_order_status_id"] = "!105112,!138625"  # Wykluczamy nieopłacone i anulowane
    
            # KLUCZOWA ZMIANA: Używaj date_confirmed_from zamiast date_add_from/to
            if current_date_from:
                # Upewnij się, że to datetime, nie date
                if isinstance(current_date_from, date) and not isinstance(current_date_from, datetime):
                    current_date_from = datetime.combine(current_date_from, datetime.min.time())

                timestamp_from = int(current_date_from.timestamp())
                parameters["date_confirmed_from"] = timestamp_from
        
            self.logger.debug("Pobieranie partii zamówień - paginacja Baselinker",
                             page=page,
                             date_confirmed_from=current_date_from.isoformat() if current_date_from else None,
                             current_count=len(all_orders),
                             filtered_excluded_statuses=not include_excluded_statuses)
    
            data = {
                'method': 'getOrders',
                'parameters': json.dumps(parameters)
            }
    
            try:
                response = requests.post(self.endpoint, headers=headers, data=data, timeout=30)
                response.raise_for_status()
                result = response.json()
        
                if result.get('status') == 'SUCCESS':
                    batch_orders = result.get('orders', [])
            
                    if not batch_orders:
                        self.logger.info("Brak zamówień w tym zakresie dat - kończę pobieranie",
                                       page=page, total_collected=len(all_orders))
                        break
            
                    # Filtruj duplikaty i śledź najnowsze date_confirmed
                    new_orders_in_batch = 0
                    latest_date_confirmed = None
            
                    for order in batch_orders:
                        order_id_val = order.get('order_id')
                
                        if order_id_val not in seen_order_ids:
                            all_orders.append(order)
                            seen_order_ids.add(order_id_val)
                            new_orders_in_batch += 1
                    
                            # Śledzenie najnowszej daty
                            date_confirmed = order.get('date_confirmed')
                            if date_confirmed:
                                if latest_date_confirmed is None or date_confirmed > latest_date_confirmed:
                                    latest_date_confirmed = date_confirmed
            
                    self.logger.debug("Przetworzona partia zamówień",
                                    page=page,
                                    batch_total=len(batch_orders),
                                    new_orders=new_orders_in_batch,
                                    duplicates=len(batch_orders) - new_orders_in_batch,
                                    total_collected=len(all_orders))
            
                    # Jeśli mamy mniej niż 100 zamówień w partii, prawdopodobnie to koniec
                    if len(batch_orders) < 100:
                        self.logger.info("Partia zawiera mniej niż 100 zamówień - kończę pobieranie",
                                       page=page, batch_size=len(batch_orders))
                        break
                
                    # Aktualizuj date_from dla następnej iteracji
                    if latest_date_confirmed:
                        current_date_from = datetime.fromtimestamp(latest_date_confirmed)
                        self.logger.debug("Aktualizacja date_from dla następnej iteracji",
                                        new_date_from=current_date_from.isoformat(),
                                        batch_size=len(batch_orders))
                    else:
                        # Brak date_confirmed w zamówieniach - nie można kontynuować
                        self.logger.warning("Brak date_confirmed w zamówieniach - kończę pobieranie",
                                          page=page, batch_size=len(batch_orders))
                        break
                
                else:
                    error_msg = result.get('error_message', 'Nieznany błąd API')
                    error_code = result.get('error_code', 'Brak kodu błędu')
                    self.logger.error("Błąd API Baselinker",
                                     page=page, error_message=error_msg, error_code=error_code)
                    break
            
            except requests.exceptions.Timeout:
                self.logger.error("Timeout przy pobieraniu partii", page=page)
                continue
        
            except requests.exceptions.RequestException as e:
                self.logger.error("Błąd połączenia", page=page, error=str(e))
                continue
        
            # Bezpieczeństwo - maksymalnie 20 stron (żeby nie było nieskończonej pętli)
            if page >= 20:
                self.logger.warning("Osiągnięto maksymalną liczbę stron", max_pages=20, total_collected=len(all_orders))
                break

        self.logger.info("Zakończono pobieranie zamówień z prawidłową paginacją Baselinker",
                        total_orders=len(all_orders),
                        pages_processed=page,
                        date_from=date_from.isoformat() if date_from else None,
                        max_orders=max_orders,
                        unique_orders=len(seen_order_ids),
                        filtered_excluded_statuses=not include_excluded_statuses)

        return all_orders
    
    def fetch_order_statuses(self) -> List[Dict]:
        """
        Pobiera listę statusów zamówień z API Baselinker i zwraca
        listę słowników: {'status_id': int, 'status_name': str}
        """
        if not self.api_key or not self.endpoint:
            self.logger.error("Brak konfiguracji API Baselinker")
            raise ValueError("Brak konfiguracji API Baselinker")

        headers = {
            'X-BLToken': self.api_key,
            'Content-Type': 'application/x-www-form-urlencoded'
        }

        # Przygotuj payload
        data = {
            'method': 'getOrderStatusList',
            'parameters': json.dumps({})  # brak dodatkowych parametrów
        }

        try:
            self.logger.info("Pobieram statusy zamówień z Baselinker")
            response = requests.post(self.endpoint, headers=headers, data=data, timeout=30)
            response.raise_for_status()
            result = response.json()

            if result.get('status') != 'SUCCESS':
                msg = result.get('error_message', 'Nieznany błąd API')
                code = result.get('error_code', '')
                self.logger.error("Błąd API przy pobieraniu statusów",
                                  status=msg, code=code)
                return []

            raw_statuses = result.get('orders_statuses', [])
            statuses = []
            for s in raw_statuses:
                try:
                    sid = int(s.get('orders_status_id', 0))
                    name = s.get('name', '').strip()
                    statuses.append({'status_id': sid, 'status_name': name})
                except Exception:
                    self.logger.warning("Nieprawidłowy wpis statusu", raw=s)

            self.logger.info("Pobrano statusy zamówień", count=len(statuses))
            return statuses

        except requests.exceptions.RequestException as e:
            self.logger.error("Błąd HTTP przy pobieraniu statusów", error=str(e))
            return []

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
    
        # NOWE: Pobierz informację o typie ceny z custom_extra_fields
        custom_fields = order.get('custom_extra_fields', {})
        price_type_from_api = custom_fields.get('106169', '').strip()
        
        self.logger.debug("Pobrano typ ceny z custom_extra_fields",
                         order_id=order.get('order_id'),
                         price_type_from_api=price_type_from_api)

        # Podstawowe dane zamówienia (wspólne dla wszystkich produktów)
        base_data = self._extract_base_order_data(order)
    
        # Oblicz łączną wartość zamówienia netto (dla order_amount_net)
        total_order_value_gross = 0
        for product in products:
            original_price_gross = float(product.get('price_brutto', 0))
            
            # Przetwórz cenę przez metodę z modelu
            temp_record = BaselinkerReportOrder()
            processed_price_gross, _ = temp_record.process_baselinker_amount(
                original_price_gross, price_type_from_api
            )
            
            product_value = processed_price_gross * int(product.get('quantity', 1))
            total_order_value_gross += product_value

        # Przelicz na netto (VAT 23%) - tylko produkty, bez kuriera
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
            
                # NOWE: Przetwórz cenę produktu
                original_price_gross = float(product.get('price_brutto', 0))
                temp_record = BaselinkerReportOrder()
                processed_price_gross, processed_price_type = temp_record.process_baselinker_amount(
                    original_price_gross, price_type_from_api
                )
                
                # Utwórz rekord
                record = BaselinkerReportOrder(
                    # Dane zamówienia - EXPLICITE BEZ KOPIOWANIA base_data
                    date_created=datetime.fromtimestamp(order.get('date_add')).date() if order.get('date_add') else datetime.now().date(),
                    baselinker_order_id=order.get('order_id'),
                    internal_order_number=order.get('extra_field_1'),
                    customer_name=order.get('delivery_fullname') or order.get('delivery_company') or order.get('user_login') or 'Nieznany klient',
                    delivery_postcode=order.get('delivery_postcode'),
                    delivery_city=order.get('delivery_city'),
                    delivery_address=order.get('delivery_address'),
                    delivery_state=order.get('delivery_state'),
                    phone=order.get('phone'),
                    caretaker=(order.get('custom_extra_fields', {}).get('105623') or "Brak danych"),
                    delivery_method=order.get('delivery_method'),
                    order_source=order.get('order_source'),
                    current_status=self.status_map.get(order.get('order_status_id'), f'Status {order.get("order_status_id")}'),
                    baselinker_status_id=order.get('order_status_id'),
                
                    # FINANSE - POPRAWNIE OBLICZONE
                    order_amount_net=total_order_value_net,  # ✅ Tylko produkty netto 124.80
                    delivery_cost=float(order.get('delivery_price', 0)),  # ✅ Kurier brutto 25.00
                    paid_amount_net=float(order.get('payment_done', 0)) / 1.23,  # ✅ payment_done netto
                    payment_method=order.get('payment_method'),
                
                    # DANE PRODUKTU
                    total_m3=total_m3_all_products,
                    raw_product_name=product.get('name'),
                    quantity=product.get('quantity', 1),
                    price_gross=processed_price_gross,
                    price_type=processed_price_type,
                    original_amount_from_baselinker=original_price_gross,
                
                    # Dane z parsera
                    product_type=parsed_product.get('product_type') or 'deska',
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
                    is_manual=False,
                    email=order.get('email')
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
        delivery_cost_original = float(delivery_price_gross) if delivery_price_gross else 0

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
            'delivery_cost': float(order.get('delivery_price', 0)),
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
                
                # NOWE: Sprawdź czy trzeba zaktualizować pola price_type
                custom_fields = order.get('custom_extra_fields', {})
                price_type_from_api = custom_fields.get('106169', '').strip()

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

                    if not record.price_type and price_type_from_api:
                        # Zaktualizuj price_type dla starych rekordów
                        normalized_type = 'netto' if price_type_from_api.lower() == 'netto' else 'brutto' if price_type_from_api.lower() == 'brutto' else ''
                        if normalized_type != record.price_type:
                            record.price_type = normalized_type
                            self.logger.info("Zaktualizowano price_type dla istniejącego rekordu",
                                           record_id=record.id,
                                           order_id=order_id,
                                           new_price_type=normalized_type)
                
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
    
    def get_order_details(self, order_id: int, include_excluded_statuses: bool = False) -> Optional[Dict]:
        """
        Pobiera szczegóły pojedynczego zamówienia z Baselinker
        """
        try:
            # POPRAWKA: Używaj nowej metody z filtrowaniem statusów
            orders = self.fetch_orders_from_baselinker(
                order_id=order_id, 
                include_excluded_statuses=include_excluded_statuses
            )
        
            if orders and len(orders) > 0:
                order = orders[0]
            
                # Sprawdź czy zamówienie nie ma wykluczanego statusu (dodatkowa walidacja)
                if not include_excluded_statuses:
                    status_id = order.get('order_status_id')
                    if status_id in [105112, 138625]:  # Nowe - nieopłacone, Anulowane
                        self.logger.info("Zamówienie wykluczono ze względu na status",
                                       order_id=order_id,
                                       status_id=status_id,
                                       status_name=self.status_map.get(status_id, f'Status {status_id}'))
                        return None
            
                # NOWE: Przetwórz ceny produktów w pojedynczym zamówieniu
                custom_fields = order.get('custom_extra_fields', {})
                price_type_from_api = custom_fields.get('106169', '').strip()
            
                # Jeśli zamówienie ma produkty, przetworz ich ceny
                if 'products' in order and order['products']:
                    for product in order['products']:
                        original_price = float(product.get('price_brutto', 0))
                    
                        # Utwórz tymczasowy rekord do przetworzenia
                        temp_record = BaselinkerReportOrder()
                        processed_price, _ = temp_record.process_baselinker_amount(
                            original_price, price_type_from_api
                        )
                    
                        # Zaktualizuj cenę w produkcie
                        product['price_brutto'] = processed_price
                    
                        self.logger.debug("Przetworzono cenę produktu w get_order_details",
                                        order_id=order.get('order_id'),
                                        product_name=product.get('name'),
                                        original_price=original_price,
                                        processed_price=processed_price,
                                        price_type=price_type_from_api)
            
                return order
        
            return None
        
        except Exception as e:
            self.logger.error("Błąd pobierania szczegółów zamówienia",
                             order_id=order_id,
                             include_excluded_statuses=include_excluded_statuses,
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

    def fetch_orders_from_date_range(self, date_from: datetime, date_to: datetime, get_all_statuses: bool = False) -> Dict[str, any]:
        """
        NOWA METODA: Pobiera zamówienia z Baselinker dla konkretnego zakresu dat
        Używana przez nowy system wyboru zamówień
        """
        try:
            self.logger.info("Pobieranie zamówień dla zakresu dat",
                            date_from=date_from.isoformat(),
                            date_to=date_to.isoformat(),
                            get_all_statuses=get_all_statuses)

            headers = {
                'X-BLToken': self.api_key,
                'Content-Type': 'application/x-www-form-urlencoded'
            }

            all_orders = []
            seen_order_ids = set()
            page = 0
            max_pages = 10  # Bezpiecznik - maksymalnie 10 stron dla zakresu dat
        
            # Konwertuj daty na timestampy
            date_from_timestamp = int(date_from.timestamp())
            date_to_timestamp = int(date_to.timestamp()) + 86399  # Dodaj 23:59:59 do daty końcowej

            self.logger.info("Konwersja dat na timestampy",
                            date_from_timestamp=date_from_timestamp,
                            date_to_timestamp=date_to_timestamp)

            while page < max_pages:
                page += 1
            
                # Parametry zapytania zgodne z API Baselinker
                parameters = {
                    "include_custom_extra_fields": True,
                    "get_unconfirmed_orders": True,
                    "date_confirmed_from": date_from_timestamp,
                    "date_confirmed_to": date_to_timestamp
                }

                # POPRAWKA: Domyślnie wykluczamy anulowane i nieopłacone (chyba że explicite żądamy wszystkich)
                if not get_all_statuses:
                    parameters["filter_order_status_id"] = "!105112,!138625"  # Wykluczamy nieopłacone i anulowane

                self.logger.debug("Pobieranie partii zamówień dla zakresu dat",
                                page=page,
                                parameters=parameters,
                                filtered_excluded_statuses=not get_all_statuses)

                data = {
                    'method': 'getOrders',
                    'parameters': json.dumps(parameters)
                }

                try:
                    response = requests.post(self.endpoint, headers=headers, data=data, timeout=30)
                    response.raise_for_status()
                    result = response.json()

                    if result.get('status') == 'SUCCESS':
                        batch_orders = result.get('orders', [])
                    
                        if not batch_orders:
                            self.logger.info("Brak więcej zamówień - kończę pobieranie",
                                        page=page, total_collected=len(all_orders))
                            break

                        # Filtruj duplikaty
                        new_orders_in_batch = 0
                        for order in batch_orders:
                            order_id_val = order.get('order_id')
                        
                            if order_id_val not in seen_order_ids:
                                all_orders.append(order)
                                seen_order_ids.add(order_id_val)
                                new_orders_in_batch += 1

                        self.logger.debug("Przetworzona partia dla zakresu dat",
                                        page=page,
                                        batch_total=len(batch_orders),
                                        new_orders=new_orders_in_batch,
                                        duplicates=len(batch_orders) - new_orders_in_batch,
                                        total_collected=len(all_orders))

                        # Jeśli mamy mniej niż 100 zamówień w partii, prawdopodobnie to koniec
                        if len(batch_orders) < 100:
                            self.logger.info("Partia zawiera mniej niż 100 zamówień - kończę pobieranie zakresu",
                                           page=page, batch_size=len(batch_orders))
                            break

                    else:
                        error_msg = result.get('error_message', 'Nieznany błąd API')
                        error_code = result.get('error_code', 'Brak kodu błędu')
                        self.logger.error("Błąd API Baselinker podczas pobierania zakresu dat",
                                         page=page, error_message=error_msg, error_code=error_code)
                        return {
                            'success': False,
                            'orders': [],
                            'error': f'Błąd API: {error_msg} (kod: {error_code})'
                        }

                except requests.exceptions.Timeout:
                    self.logger.error("Timeout przy pobieraniu partii zakresu dat", page=page)
                    continue
                
                except requests.exceptions.RequestException as e:
                    self.logger.error("Błąd połączenia podczas pobierania zakresu dat", page=page, error=str(e))
                    continue

            self.logger.info("Zakończono pobieranie zamówień dla zakresu dat",
                            total_orders=len(all_orders),
                            pages_processed=page,
                            date_from=date_from.isoformat(),
                            date_to=date_to.isoformat(),
                            unique_orders=len(seen_order_ids),
                            get_all_statuses=get_all_statuses,
                            filtered_excluded_statuses=not get_all_statuses)

            return {
                'success': True,
                'orders': all_orders,
                'error': None
            }

        except Exception as e:
            self.logger.error("Nieoczekiwany błąd podczas pobierania zamówień dla zakresu dat",
                             error=str(e),
                             error_type=type(e).__name__,
                             date_from=date_from.isoformat(),
                             date_to=date_to.isoformat())
            return {
                'success': False,
                'orders': [],
                'error': f'Błąd serwera: {str(e)}'
            }

    def set_dimension_fixes(self, fixes: Dict):
        """
        Ustawia poprawki wymiarów dla produktów
        
        Args:
            fixes (Dict): {order_id: {product_id: {length_cm: X, width_cm: Y, thickness_mm: Z}}}
        """
        self.dimension_fixes = fixes
        self.logger.info("Ustawiono poprawki wymiarów", fixes_count=len(fixes))
    
    def clear_dimension_fixes(self):
        """Czyści poprawki wymiarów"""
        self.dimension_fixes = {}
        self.logger.info("Wyczyszczono poprawki wymiarów")
    
    def _apply_dimension_fixes(self, order_id: int, product_id: int, parsed_data: Dict) -> Dict:
        """
        Stosuje poprawki wymiarów dla konkretnego produktu
        
        Args:
            order_id (int): ID zamówienia
            product_id (int): ID produktu
            parsed_data (Dict): Sparsowane dane produktu
            
        Returns:
            Dict: Poprawione dane produktu
        """
        if not self.dimension_fixes:
            return parsed_data
            
        order_fixes = self.dimension_fixes.get(str(order_id), {})
        product_fixes = order_fixes.get(str(product_id), {})
        
        if product_fixes:
            # Zastosuj poprawki
            if 'length_cm' in product_fixes:
                parsed_data['length_cm'] = float(product_fixes['length_cm'])
            if 'width_cm' in product_fixes:
                parsed_data['width_cm'] = float(product_fixes['width_cm'])
            if 'thickness_mm' in product_fixes:
                parsed_data['thickness_mm'] = float(product_fixes['thickness_mm'])
            # NOWE: nadpisanie objętości per sztuka
            if 'volume_m3' in product_fixes:
                parsed_data['volume_override_m3'] = float(product_fixes['volume_m3'])
                
            self.logger.info("Zastosowano poprawki wymiarów",
                           order_id=order_id,
                           product_id=product_id,
                           fixes=product_fixes)
        
        return parsed_data
    
    def _create_report_record(self, order: Dict, product: Dict) -> BaselinkerReportOrder:
        """
        Tworzy rekord raportu z zastosowaniem poprawek wymiarów.
        """
        try:
            # Parsuj nazwę produktu
            product_name = product.get('name', '')
            parsed_data = self.parser.parse_product_name(product_name)

            # Zastosuj poprawki wymiarów jeśli są dostępne
            order_id = order.get('order_id')
            product_id = product.get('product_id')
            if order_id and product_id:
                parsed_data = self._apply_dimension_fixes(order_id, product_id, parsed_data)

            # Oblicz objętość (m³) z priorytetem nadpisania ręcznego
            quantity = float(product.get('quantity', 0))
            total_m3 = None
            # Ręczne nadpisanie objętości per sztuka
            if parsed_data.get('volume_override_m3') is not None:
                total_m3 = quantity * parsed_data['volume_override_m3']
            # Automatyczne obliczenie z wymiarów jeśli brak nadpisania
            elif all(parsed_data.get(key) for key in ['length_cm', 'width_cm', 'thickness_mm']):
                length_m = parsed_data['length_cm'] / 100
                width_m = parsed_data['width_cm'] / 100
                thickness_m = parsed_data['thickness_mm'] / 1000
                total_m3 = quantity * length_m * width_m * thickness_m

            # Budowanie rekordu raportu
            record = BaselinkerReportOrder(
                order_id=order_id,
                product_id=product_id,
                product_name=product_name,
                quantity=quantity,
                length_cm=parsed_data.get('length_cm'),
                width_cm=parsed_data.get('width_cm'),
                thickness_mm=parsed_data.get('thickness_mm'),
                # Zapisz objętość do kolumny total_m3 w bazie i ttl m3 w UI
                total_volume=total_m3,
                # ... inne pola zgodnie z modelem BaselinkerReportOrder
            )

            return record

        except Exception as e:
            self.logger.error(
                "Błąd tworzenia rekordu z poprawkami wymiarów",
                order_id=order.get('order_id'),
                product_id=order.get('product_id'),
                error=str(e)
            )
            raise
    

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

# Funkcja pomocnicza do bezpiecznej konwersji
def safe_float_convert(value) -> float:
    """Bezpiecznie konwertuje wartość do float"""
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0.0
    