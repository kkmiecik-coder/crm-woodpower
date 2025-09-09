# modules/production/services/sync_service.py
"""
Serwis synchronizacji z Baselinker dla modułu Production
========================================================

Implementuje automatyczną synchronizację zamówień z API Baselinker:
- Pobieranie zamówień ze statusami produkcyjnymi
- Rozbijanie zamówień na pojedyncze produkty z nowym formatem ID
- Parsowanie nazw produktów i obliczanie priorytetów
- Aktualizacja statusów w Baselinker po zakończeniu produkcji
- Obsługa błędów i retry mechanism
- Szczegółowe logowanie wszystkich operacji

Obsługiwane statusy Baselinker:
- 138619 (W produkcji - surowe)
- 148832 (W produkcji - olejowanie)  
- 148831 (W produkcji - bejcowanie)
- 148830 (W produkcji - lakierowanie)
- 155824 (Nowe - opłacone)

Status docelowy po produkcji: 138623 (Ukończone)

Autor: Konrad Kmiecik
Wersja: 1.2 (Finalna - z zabezpieczeniami)
Data: 2025-01-08
"""

import json
import requests
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from app import db
from modules.logging import get_structured_logger

logger = get_structured_logger('production.sync')

class SyncError(Exception):
    """Wyjątek dla błędów synchronizacji"""
    pass

class BaselinkerSyncService:
    """
    Serwis synchronizacji z API Baselinker
    
    Zarządza dwukierunkowym przepływem danych między systemem produkcyjnym
    a platformą Baselinker z obsługą błędów i retry mechanism.
    """
    
    def __init__(self):
        """Inicjalizacja serwisu synchronizacji"""
        # Statusy Baselinker które interesują nas w synchronizacji
        self.source_statuses = [
            138619,  # W produkcji - surowe
            148832,  # W produkcji - olejowanie
            148831,  # W produkcji - bejcowanie  
            148830,  # W produkcji - lakierowanie
            155824   # Nowe - opłacone
        ]
        
        # Status docelowy po ukończeniu produkcji
        self.target_completed_status = 138623  # Ukończone
        
        # Konfiguracja API
        self.api_endpoint = "https://api.baselinker.com/connector.php"
        self.api_key = None
        self.api_timeout = 30
        
        # Konfiguracja synchronizacji
        self.max_items_per_batch = 1000
        self.max_retries = 3
        self.retry_delay = 5  # sekund
        
        # Inicjalizacja konfiguracji
        self._load_config()
        
        logger.info("Inicjalizacja BaselinkerSyncService", extra={
            'source_statuses': self.source_statuses,
            'target_status': self.target_completed_status,
            'max_items_per_batch': self.max_items_per_batch
        })
    
    def _load_config(self):
        """Ładuje konfigurację z pliku config i bazy danych"""
        try:
            # Import konfiguracji z core.json
            import json
            import os
            
            config_path = os.path.join('app', 'config', 'core.json')
            if os.path.exists(config_path):
                with open(config_path, 'r') as f:
                    config = json.load(f)
                    api_config = config.get('API_BASELINKER', {})
                    self.api_key = api_config.get('api_key')
                    if api_config.get('endpoint'):
                        self.api_endpoint = api_config['endpoint']
            
            # Sprawdzenie konfiguracji z modułu production
            try:
                from .config_service import get_config
                
                self.max_items_per_batch = get_config('MAX_SYNC_ITEMS_PER_BATCH', 1000)
                self.target_completed_status = get_config('BASELINKER_TARGET_STATUS_COMPLETED', 138623)
                
            except ImportError:
                logger.warning("Nie można załadować konfiguracji z ProductionConfigService")
            
            if not self.api_key:
                logger.error("Brak klucza API Baselinker w konfiguracji")
                
        except Exception as e:
            logger.error("Błąd ładowania konfiguracji", extra={'error': str(e)})
    
    def sync_orders_from_baselinker(self, sync_type: str = 'cron_auto') -> Dict[str, Any]:
        """
        Główna metoda synchronizacji zamówień z Baselinker
        
        Args:
            sync_type (str): Typ synchronizacji ('cron_auto' lub 'manual_trigger')
            
        Returns:
            Dict[str, Any]: Wyniki synchronizacji
        """
        sync_started_at = datetime.utcnow()
        
        # Rozpoczęcie logowania synchronizacji
        sync_log = self._create_sync_log(sync_type, sync_started_at)
        
        try:
            logger.info("Rozpoczęcie synchronizacji Baselinker", extra={
                'sync_type': sync_type,
                'sync_log_id': sync_log.id if sync_log else None
            })
            
            # 1. Pobieranie zamówień z Baselinker
            orders_data = self._fetch_orders_from_baselinker()
            if sync_log:
                sync_log.orders_fetched = len(orders_data)
            
            # 2. Przetwarzanie zamówień na produkty
            processing_results = self._process_orders_to_products(orders_data)
            
            if sync_log:
                sync_log.products_created = processing_results['created']
                sync_log.products_updated = processing_results['updated'] 
                sync_log.products_skipped = processing_results['skipped']
                sync_log.error_count = processing_results['errors']
                sync_log.error_details = json.dumps(processing_results['error_details'])
            
            # 3. Aktualizacja priorytetów dla nowych produktów
            self._update_product_priorities()
            
            # 4. Zakończenie synchronizacji
            if sync_log:
                sync_log.mark_completed()
                db.session.commit()
            
            results = {
                'success': True,
                'sync_duration_seconds': sync_log.sync_duration_seconds if sync_log else 0,
                'orders_fetched': len(orders_data),
                'products_created': processing_results['created'],
                'products_updated': processing_results['updated'],
                'products_skipped': processing_results['skipped'],
                'error_count': processing_results['errors']
            }
            
            logger.info("Zakończono synchronizację Baselinker", extra=results)
            return results
            
        except Exception as e:
            logger.error("Błąd synchronizacji Baselinker", extra={
                'sync_type': sync_type,
                'error': str(e)
            })
            
            if sync_log:
                sync_log.sync_status = 'failed'
                sync_log.error_count = sync_log.error_count + 1 if sync_log.error_count else 1
                sync_log.error_details = json.dumps({'main_error': str(e)})
                sync_log.mark_completed()
                db.session.commit()
            
            return {
                'success': False,
                'error': str(e),
                'sync_duration_seconds': sync_log.sync_duration_seconds if sync_log else 0
            }
    
    def _create_sync_log(self, sync_type: str, sync_started_at: datetime) -> Optional['ProductionSyncLog']:
        """
        Tworzy rekord synchronizacji w bazie danych
        
        Args:
            sync_type (str): Typ synchronizacji
            sync_started_at (datetime): Czas rozpoczęcia
            
        Returns:
            Optional[ProductionSyncLog]: Rekord logu lub None przy błędzie
        """
        try:
            from ..models import ProductionSyncLog
            
            sync_log = ProductionSyncLog(
                sync_type=sync_type,
                sync_started_at=sync_started_at,
                processed_status_ids=','.join(map(str, self.source_statuses))
            )
            
            db.session.add(sync_log)
            db.session.commit()
            
            return sync_log
            
        except Exception as e:
            logger.error("Błąd tworzenia logu synchronizacji", extra={'error': str(e)})
            return None
    
    def _fetch_orders_from_baselinker(self) -> List[Dict[str, Any]]:
        """
        Pobiera zamówienia z Baselinker API
        
        Returns:
            List[Dict[str, Any]]: Lista zamówień z Baselinker
            
        Raises:
            SyncError: W przypadku błędu komunikacji z API
        """
        if not self.api_key:
            raise SyncError("Brak klucza API Baselinker")
        
        all_orders = []
        
        for status_id in self.source_statuses:
            try:
                logger.debug("Pobieranie zamówień dla statusu", extra={
                    'status_id': status_id
                })
                
                # Przygotowanie requestu do Baselinker
                request_data = {
                    'token': self.api_key,
                    'method': 'getOrders',
                    'parameters': json.dumps({
                        'status_id': status_id,
                        'get_unconfirmed_orders': True,
                        'date_confirmed_from': int((datetime.now() - timedelta(days=30)).timestamp()),
                        'date_limit': self.max_items_per_batch
                    })
                }
                
                # Wykonanie requestu z retry
                response_data = self._make_api_request(request_data)
                
                if response_data.get('status') == 'SUCCESS':
                    orders = response_data.get('orders', [])
                    all_orders.extend(orders)
                    
                    logger.debug("Pobrano zamówienia dla statusu", extra={
                        'status_id': status_id,
                        'orders_count': len(orders)
                    })
                else:
                    error_msg = response_data.get('error_message', 'Unknown error')
                    logger.warning("Błąd API dla statusu", extra={
                        'status_id': status_id,
                        'error': error_msg
                    })
                    
            except Exception as e:
                logger.error("Błąd pobierania zamówień dla statusu", extra={
                    'status_id': status_id,
                    'error': str(e)
                })
                continue
        
        logger.info("Pobrano wszystkie zamówienia z Baselinker", extra={
            'total_orders': len(all_orders)
        })
        
        return all_orders
    
    def _make_api_request(self, request_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Wykonuje request do API Baselinker z retry mechanism
        
        Args:
            request_data (Dict[str, Any]): Dane requestu
            
        Returns:
            Dict[str, Any]: Odpowiedź z API
            
        Raises:
            SyncError: W przypadku błędu komunikacji
        """
        last_error = None
        
        for attempt in range(self.max_retries):
            try:
                logger.debug("Wykonywanie requestu do Baselinker", extra={
                    'attempt': attempt + 1,
                    'method': request_data.get('method')
                })
                
                response = requests.post(
                    self.api_endpoint,
                    data=request_data,
                    timeout=self.api_timeout,
                    headers={'Content-Type': 'application/x-www-form-urlencoded'}
                )
                
                response.raise_for_status()
                
                try:
                    response_data = response.json()
                    return response_data
                except json.JSONDecodeError as e:
                    raise SyncError(f"Nieprawidłowa odpowiedź JSON: {e}")
                    
            except requests.RequestException as e:
                last_error = e
                logger.warning("Błąd requestu API", extra={
                    'attempt': attempt + 1,
                    'error': str(e)
                })
                
                if attempt < self.max_retries - 1:
                    import time
                    time.sleep(self.retry_delay * (attempt + 1))  # Exponential backoff
                
        raise SyncError(f"Nie udało się wykonać requestu po {self.max_retries} próbach: {last_error}")
    
    def _process_orders_to_products(self, orders_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Przetwarza zamówienia z Baselinker na produkty produkcyjne
        
        Args:
            orders_data (List[Dict[str, Any]]): Lista zamówień
            
        Returns:
            Dict[str, Any]: Wyniki przetwarzania
        """
        results = {
            'created': 0,
            'updated': 0, 
            'skipped': 0,
            'errors': 0,
            'error_details': []
        }
        
        for order in orders_data:
            try:
                order_id = order.get('order_id')
                if not order_id:
                    results['errors'] += 1
                    results['error_details'].append({'error': 'Brak order_id', 'order': order})
                    continue
                
                # Sprawdzenie czy zamówienie już istnieje
                if self._order_already_processed(order_id):
                    results['skipped'] += 1
                    continue
                
                # Przetwarzanie produktów w zamówieniu
                products = order.get('products', [])
                if not products:
                    logger.debug("Zamówienie bez produktów", extra={'order_id': order_id})
                    results['skipped'] += 1
                    continue
                
                order_results = self._process_single_order(order, products)
                results['created'] += order_results['created']
                results['updated'] += order_results['updated']
                results['errors'] += order_results['errors']
                results['error_details'].extend(order_results['error_details'])
                
            except Exception as e:
                results['errors'] += 1
                results['error_details'].append({
                    'error': str(e),
                    'order_id': order.get('order_id', 'unknown')
                })
                logger.error("Błąd przetwarzania zamówienia", extra={
                    'order_id': order.get('order_id'),
                    'error': str(e)
                })
        
        return results
    
    def _order_already_processed(self, baselinker_order_id: int) -> bool:
        """
        Sprawdza czy zamówienie już zostało przetworzone
        
        Args:
            baselinker_order_id (int): ID zamówienia w Baselinker
            
        Returns:
            bool: True jeśli zamówienie już istnieje
        """
        try:
            from ..models import ProductionItem
            
            existing = ProductionItem.query.filter_by(
                baselinker_order_id=baselinker_order_id
            ).first()
            
            return existing is not None
            
        except Exception as e:
            logger.error("Błąd sprawdzania istniejącego zamówienia", extra={
                'order_id': baselinker_order_id,
                'error': str(e)
            })
            return False
    
    def _process_single_order(self, order: Dict[str, Any], products: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Przetwarza pojedyncze zamówienie na produkty
        
        Args:
            order (Dict[str, Any]): Dane zamówienia
            products (List[Dict[str, Any]]): Lista produktów w zamówieniu
            
        Returns:
            Dict[str, Any]: Wyniki przetwarzania zamówienia
        """
        results = {
            'created': 0,
            'updated': 0,
            'errors': 0,
            'error_details': []
        }
        
        baselinker_order_id = order['order_id']
        
        try:
            from ..services.id_generator import ProductIDGenerator
            from ..services.parser_service import get_parser_service
            from ..services.priority_service import get_priority_calculator
            from ..models import ProductionItem
            
            parser = get_parser_service()
            priority_calc = get_priority_calculator()
            
            sequence_counter = 1
            
            for product in products:
                try:
                    product_name = product.get('name', '')
                    quantity = int(product.get('quantity', 1))
                    
                    # Tworzenie produktów według quantity (każda sztuka = osobny rekord)
                    for qty_index in range(quantity):
                        # Generowanie Product ID
                        id_result = ProductIDGenerator.generate_product_id(
                            baselinker_order_id, sequence_counter
                        )
                        
                        # Parsowanie nazwy produktu
                        parsed_data = parser.parse_product_name(product_name) if parser else {}
                        
                        # Przygotowanie danych produktu
                        product_data = self._prepare_product_data(
                            order, product, id_result, parsed_data
                        )
                        
                        # Obliczenie priorytetu
                        if priority_calc:
                            priority = priority_calc.calculate_priority(product_data)
                            product_data['priority_score'] = priority
                        
                        # Utworzenie rekordu ProductionItem
                        production_item = ProductionItem(**product_data)
                        
                        db.session.add(production_item)
                        results['created'] += 1
                        sequence_counter += 1
                        
                        logger.debug("Utworzono produkt", extra={
                            'product_id': id_result['product_id'],
                            'order_id': baselinker_order_id,
                            'product_name': product_name[:50]
                        })
                
                except Exception as e:
                    results['errors'] += 1
                    results['error_details'].append({
                        'error': str(e),
                        'product_name': product.get('name', 'unknown'),
                        'order_id': baselinker_order_id
                    })
                    logger.error("Błąd przetwarzania produktu", extra={
                        'product_name': product.get('name'),
                        'order_id': baselinker_order_id,
                        'error': str(e)
                    })
            
            # Commit wszystkich produktów z zamówienia
            db.session.commit()
            
        except Exception as e:
            db.session.rollback()
            results['errors'] += 1
            results['error_details'].append({
                'error': str(e),
                'order_id': baselinker_order_id
            })
            logger.error("Błąd przetwarzania zamówienia", extra={
                'order_id': baselinker_order_id,
                'error': str(e)
            })
        
        return results
    
    def _prepare_product_data(self, order: Dict[str, Any], product: Dict[str, Any], 
                            id_result: Dict[str, Any], parsed_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Przygotowuje dane produktu do zapisania w bazie
        
        Args:
            order (Dict[str, Any]): Dane zamówienia
            product (Dict[str, Any]): Dane produktu
            id_result (Dict[str, Any]): Wygenerowane ID
            parsed_data (Dict[str, Any]): Sparsowane dane nazwy
            
        Returns:
            Dict[str, Any]: Przygotowane dane produktu
        """
        # Podstawowe dane z ID generator
        product_data = {
            'short_product_id': id_result['product_id'],
            'internal_order_number': id_result['internal_order_number'],
            'product_sequence_in_order': id_result['sequence'],
            'baselinker_order_id': order['order_id'],
            'original_product_name': product.get('name', ''),
            'baselinker_status_id': order.get('order_status_id')
        }
        
        # Dane sparsowane z nazwy produktu
        if parsed_data:
            product_data.update({
                'parsed_wood_species': parsed_data.get('wood_species'),
                'parsed_technology': parsed_data.get('technology'),
                'parsed_wood_class': parsed_data.get('wood_class'),
                'parsed_length_cm': parsed_data.get('length_cm'),
                'parsed_width_cm': parsed_data.get('width_cm'),
                'parsed_thickness_cm': parsed_data.get('thickness_cm'),
                'parsed_finish_state': parsed_data.get('finish_state'),
                'volume_m3': parsed_data.get('volume_m3')
            })
        
        # Dane finansowe
        try:
            unit_price = float(product.get('price_brutto', 0)) * 0.81  # Szacunkowa konwersja na netto
            product_data.update({
                'unit_price_net': unit_price,
                'total_value_net': unit_price  # Jedna sztuka
            })
        except (ValueError, TypeError):
            pass
        
        # Deadline (domyślnie 14 dni od dzisiaj)
        try:
            from .config_service import get_config
            default_days = get_config('DEADLINE_DEFAULT_DAYS', 14)
            product_data['deadline_date'] = date.today() + timedelta(days=default_days)
        except:
            product_data['deadline_date'] = date.today() + timedelta(days=14)
        
        # Metadata
        product_data.update({
            'sync_source': 'baselinker_auto',
            'current_status': 'czeka_na_wyciecie'  # Domyślny status początkowy
        })
        
        return product_data
    
    def _update_product_priorities(self):
        """
        Aktualizuje priorytety dla nowych produktów
        """
        try:
            from ..models import ProductionItem
            from ..services.priority_service import get_priority_calculator
            
            priority_calc = get_priority_calculator()
            if not priority_calc:
                logger.warning("Brak kalkulatora priorytetów")
                return
            
            # Znajdź produkty bez ustawionego priorytetu
            products_to_update = ProductionItem.query.filter(
                ProductionItem.priority_score == 100,  # Domyślny priorytet
                ProductionItem.current_status != 'spakowane'
            ).limit(100).all()  # Limit dla wydajności
            
            updated_count = 0
            for product in products_to_update:
                try:
                    # Przygotowanie danych do obliczenia priorytetu
                    product_data = {
                        'deadline_date': product.deadline_date,
                        'total_value_net': float(product.total_value_net or 0),
                        'volume_m3': float(product.volume_m3 or 0),
                        'created_at': product.created_at,
                        'wood_class': product.parsed_wood_class
                    }
                    
                    # Obliczenie nowego priorytetu
                    new_priority = priority_calc.calculate_priority(product_data)
                    
                    if new_priority != product.priority_score:
                        product.priority_score = new_priority
                        product.updated_at = datetime.utcnow()
                        updated_count += 1
                        
                except Exception as e:
                    logger.warning("Błąd aktualizacji priorytetu produktu", extra={
                        'product_id': product.short_product_id,
                        'error': str(e)
                    })
            
            if updated_count > 0:
                db.session.commit()
                logger.info("Zaktualizowano priorytety produktów", extra={
                    'updated_count': updated_count
                })
                
        except Exception as e:
            logger.error("Błąd aktualizacji priorytetów", extra={'error': str(e)})
    
    def update_order_status_in_baselinker(self, internal_order_number: str) -> bool:
        """
        Aktualizuje status zamówienia w Baselinker po zakończeniu produkcji
        
        Args:
            internal_order_number (str): Numer zamówienia wewnętrznego (np. 25_05248)
            
        Returns:
            bool: True jeśli aktualizacja się powiodła
        """
        try:
            from ..models import ProductionItem
            
            # Znajdź wszystkie produkty z tego zamówienia
            products = ProductionItem.query.filter_by(
                internal_order_number=internal_order_number
            ).all()
            
            if not products:
                logger.warning("Nie znaleziono produktów dla zamówienia", extra={
                    'internal_order_number': internal_order_number
                })
                return False
            
            # Sprawdź czy wszystkie produkty są spakowane
            all_packed = all(p.current_status == 'spakowane' for p in products)
            if not all_packed:
                logger.info("Nie wszystkie produkty są spakowane", extra={
                    'internal_order_number': internal_order_number,
                    'packed_count': sum(1 for p in products if p.current_status == 'spakowane'),
                    'total_count': len(products)
                })
                return False
            
            # Pobierz baselinker_order_id
            baselinker_order_id = products[0].baselinker_order_id
            
            # Aktualizuj status w Baselinker
            return self._update_baselinker_order_status(baselinker_order_id, self.target_completed_status)
            
        except Exception as e:
            logger.error("Błąd aktualizacji statusu w Baselinker", extra={
                'internal_order_number': internal_order_number,
                'error': str(e)
            })
            return False
    
    def _update_baselinker_order_status(self, baselinker_order_id: int, new_status_id: int) -> bool:
        """
        Aktualizuje status konkretnego zamówienia w Baselinker
        
        Args:
            baselinker_order_id (int): ID zamówienia w Baselinker
            new_status_id (int): Nowy status ID
            
        Returns:
            bool: True jeśli aktualizacja się powiodła
        """
        if not self.api_key:
            logger.error("Brak klucza API Baselinker dla aktualizacji statusu")
            return False
        
        try:
            request_data = {
                'token': self.api_key,
                'method': 'setOrderStatus',
                'parameters': json.dumps({
                    'order_id': baselinker_order_id,
                    'status_id': new_status_id
                })
            }
            
            response_data = self._make_api_request(request_data)
            
            if response_data.get('status') == 'SUCCESS':
                logger.info("Zaktualizowano status zamówienia w Baselinker", extra={
                    'baselinker_order_id': baselinker_order_id,
                    'new_status_id': new_status_id
                })
                return True
            else:
                error_msg = response_data.get('error_message', 'Unknown error')
                logger.error("Błąd aktualizacji statusu w Baselinker", extra={
                    'baselinker_order_id': baselinker_order_id,
                    'error': error_msg
                })
                return False
                
        except Exception as e:
            logger.error("Błąd komunikacji z Baselinker przy aktualizacji statusu", extra={
                'baselinker_order_id': baselinker_order_id,
                'error': str(e)
            })
            return False
    
    def get_sync_status(self) -> Dict[str, Any]:
        """
        Pobiera status synchronizacji
        
        Returns:
            Dict[str, Any]: Informacje o statusie sync
        """
        try:
            from ..models import ProductionSyncLog
            
            # Ostatnia synchronizacja
            last_sync = ProductionSyncLog.query.order_by(
                ProductionSyncLog.sync_started_at.desc()
            ).first()
            
            # Synchronizacja w toku
            running_sync = ProductionSyncLog.query.filter_by(
                sync_status='running'
            ).first()
            
            # Statystyki ostatnich 24h
            since_24h = datetime.utcnow() - timedelta(hours=24)
            recent_syncs = ProductionSyncLog.query.filter(
                ProductionSyncLog.sync_started_at >= since_24h
            ).all()
            
            return {
                'sync_enabled': bool(self.api_key),
                'is_running': running_sync is not None,
                'last_sync': {
                    'timestamp': last_sync.sync_started_at.isoformat() if last_sync else None,
                    'status': last_sync.sync_status if last_sync else None,
                    'duration_seconds': last_sync.sync_duration_seconds if last_sync else None,
                    'products_created': last_sync.products_created if last_sync else 0,
                    'error_count': last_sync.error_count if last_sync else 0
                } if last_sync else None,
                'recent_stats': {
                    'syncs_count': len(recent_syncs),
                    'success_count': len([s for s in recent_syncs if s.sync_status == 'completed']),
                    'failed_count': len([s for s in recent_syncs if s.sync_status == 'failed']),
                    'total_products_created': sum(s.products_created or 0 for s in recent_syncs),
                    'total_errors': sum(s.error_count or 0 for s in recent_syncs)
                }
            }
            
        except Exception as e:
            logger.error("Błąd pobierania statusu synchronizacji", extra={'error': str(e)})
            return {
                'sync_enabled': bool(self.api_key),
                'is_running': False,
                'error': str(e)
            }
    
    def cleanup_old_sync_logs(self, days_to_keep: int = 30):
        """
        Czyści stare logi synchronizacji
        
        Args:
            days_to_keep (int): Liczba dni do zachowania
        """
        try:
            from ..models import ProductionSyncLog
            
            cutoff_date = datetime.utcnow() - timedelta(days=days_to_keep)
            
            deleted_count = ProductionSyncLog.query.filter(
                ProductionSyncLog.sync_started_at < cutoff_date
            ).delete()
            
            db.session.commit()
            
            logger.info("Wyczyszczono stare logi synchronizacji", extra={
                'deleted_count': deleted_count,
                'days_to_keep': days_to_keep
            })
            
        except Exception as e:
            db.session.rollback()
            logger.error("Błąd czyszczenia logów synchronizacji", extra={
                'error': str(e)
            })

# Singleton instance dla globalnego dostępu
_sync_service_instance = None

def get_sync_service() -> BaselinkerSyncService:
    """
    Pobiera singleton instance BaselinkerSyncService
    
    Returns:
        BaselinkerSyncService: Instancja serwisu sync
    """
    global _sync_service_instance
    
    if _sync_service_instance is None:
        _sync_service_instance = BaselinkerSyncService()
        logger.info("Utworzono singleton BaselinkerSyncService")
    
    return _sync_service_instance

# Funkcje pomocnicze
def sync_orders_from_baselinker(sync_type: str = 'manual_trigger') -> Dict[str, Any]:
    """Helper function dla synchronizacji zamówień"""
    return get_sync_service().sync_orders_from_baselinker(sync_type)

def update_order_status_in_baselinker(internal_order_number: str) -> bool:
    """Helper function dla aktualizacji statusu"""
    return get_sync_service().update_order_status_in_baselinker(internal_order_number)

def get_sync_status() -> Dict[str, Any]:
    """Helper function dla sprawdzania statusu sync"""
    return get_sync_service().get_sync_status()

def cleanup_old_sync_logs(days_to_keep: int = 30):
    """Helper function dla czyszczenia logów"""
    get_sync_service().cleanup_old_sync_logs(days_to_keep)