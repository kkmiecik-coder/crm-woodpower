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
import math
import requests
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from extensions import db
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
        """Ładuje konfigurację z Flask app.config (zamiast bezpośrednio z pliku)"""
        try:
            # POPRAWKA: Używaj current_app.config zamiast bezpośredniego czytania pliku
            from flask import current_app
        
            # Pobierz konfigurację API Baselinker z Flask config
            api_config = current_app.config.get('API_BASELINKER', {})
            self.api_key = api_config.get('api_key')
            if api_config.get('endpoint'):
                self.api_endpoint = api_config['endpoint']
        
            logger.info("Załadowano konfigurację API Baselinker", extra={
                'api_key_present': bool(self.api_key),
                'endpoint': self.api_endpoint
            })
        
            # Sprawdzenie konfiguracji z modułu production
            try:
                from .config_service import get_config
            
                self.max_items_per_batch = get_config('MAX_SYNC_ITEMS_PER_BATCH', 1000)
                self.target_completed_status = get_config('BASELINKER_TARGET_STATUS_COMPLETED', 138623)
            
            except ImportError:
                logger.warning("Nie można załadować konfiguracji z ProductionConfigService")
        
            # Sprawdzenie czy klucz API został załadowany
            if not self.api_key:
                logger.error("Brak klucza API Baselinker w konfiguracji")
                logger.error("Dostępne klucze w current_app.config: %s", list(current_app.config.keys()))
            else:
                logger.info("Klucz API Baselinker załadowany pomyślnie")
            
        except Exception as e:
            logger.error("Błąd ładowania konfiguracji", extra={'error': str(e)})
        
            # FALLBACK: Jeśli current_app nie jest dostępne, spróbuj starej metody
            logger.warning("Próba fallback z bezpośrednim czytaniem pliku")
            try:
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
                    logger.info("Fallback: Załadowano konfigurację z pliku")
                else:
                    logger.error("Fallback: Plik konfiguracji nie istnieje: %s", config_path)
                
            except Exception as fallback_error:
                logger.error("Fallback również się nie powiódł", extra={'error': str(fallback_error)})

    
    def sync_orders_from_baselinker(self, sync_type: str = 'cron_auto') -> Dict[str, Any]:
        """
        Główna metoda synchronizacji zamówień z Baselinker
        
        Args:
            sync_type (str): Typ synchronizacji ('cron_auto' lub 'manual_trigger')
            
        Returns:
            Dict[str, Any]: Wyniki synchronizacji
        """
        sync_started_at = datetime.utcnow()
        
        # DODAJ: Wyczyść cache ID generatora na początku sync
        from ..services.id_generator import ProductIDGenerator
        ProductIDGenerator.clear_order_cache()
        logger.info("Wyczyszczono cache generatora ID na początku synchronizacji")
    
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


    def manual_sync_with_filtering(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Ręczna synchronizacja z Baselinkerem z filtrowaniem produktów."""

        sync_started_at = datetime.utcnow()
        sync_log = self._create_sync_log('manual_trigger', sync_started_at)

        stats = {
            'pages_processed': 0,
            'orders_found': 0,
            'orders_matched_status': 0,
            'orders_processed': 0,
            'orders_skipped_existing': 0,
            'products_created': 0,
            'products_updated': 0,
            'products_skipped': 0,
            'errors_count': 0
        }
        error_details: List[Dict[str, Any]] = []
        log_entries: List[Dict[str, Any]] = []

        try:
            target_statuses_raw = params.get('target_statuses') or []
            target_statuses = {
                status for status in (
                    self._safe_int(value) for value in target_statuses_raw
                ) if status is not None
            }

            if not target_statuses:
                raise SyncError('Brak docelowych statusów zamówień do synchronizacji.')

            try:
                period_days = int(params.get('period_days', 25))
            except (TypeError, ValueError):
                period_days = 25
            period_days = max(1, min(period_days, 90))

            try:
                limit_per_page = int(params.get('limit_per_page', 100))
            except (TypeError, ValueError):
                limit_per_page = 100
            limit_per_page = max(10, min(limit_per_page, 200))

            force_update = bool(params.get('force_update'))
            skip_validation = bool(params.get('skip_validation'))
            dry_run = bool(params.get('dry_run'))
            debug_mode = bool(params.get('debug_mode'))

            excluded_keywords = {
                str(keyword).lower().strip()
                for keyword in params.get('excluded_keywords', [])
                if isinstance(keyword, str) and keyword.strip()
            }

            if sync_log:
                sync_log.processed_status_ids = ','.join(map(str, sorted(target_statuses)))

            def add_log(message: str, level: str = 'info', **context: Any) -> None:
                timestamp = datetime.utcnow().isoformat()
                entry: Dict[str, Any] = {
                    'timestamp': timestamp,
                    'level': level,
                    'message': message
                }
                if context:
                    entry['context'] = context
                log_entries.append(entry)

                if level == 'error':
                    logger.error(message, extra={'context': 'manual_sync', **{f'ctx_{k}': v for k, v in context.items()}})
                elif level == 'warning':
                    logger.warning(message, extra={'context': 'manual_sync', **{f'ctx_{k}': v for k, v in context.items()}})
                elif level == 'debug':
                    if debug_mode:
                        logger.debug(message, extra={'context': 'manual_sync', **{f'ctx_{k}': v for k, v in context.items()}})
                else:
                    logger.info(message, extra={'context': 'manual_sync', **{f'ctx_{k}': v for k, v in context.items()}})

            add_log('Rozpoczynanie ręcznej synchronizacji z Baselinker.', 'info')
            add_log(
                'Parametry synchronizacji',
                'debug' if debug_mode else 'info',
                period_days=period_days,
                limit_per_page=limit_per_page,
                force_update=force_update,
                skip_validation=skip_validation,
                dry_run=dry_run,
                debug_mode=debug_mode,
                target_statuses=sorted(target_statuses)
            )

            date_to = datetime.utcnow()
            date_from = date_to - timedelta(days=period_days)
            add_log(
                f'Zakres synchronizacji: {date_from.date()} → {date_to.date()}',
                'info'
            )

            from modules.reports.service import get_reports_service

            reports_service = get_reports_service()
            if not reports_service:
                raise SyncError('Nie można zainicjować serwisu raportów Baselinker.')

            fetch_result = reports_service.fetch_orders_from_date_range(
                date_from=date_from,
                date_to=date_to,
                get_all_statuses=True,
                limit_per_page=limit_per_page
            )

            if not fetch_result.get('success'):
                raise SyncError(fetch_result.get('error', 'Nie udało się pobrać zamówień z Baselinker.'))

            orders = fetch_result.get('orders', []) or []
            stats['orders_found'] = len(orders)
            stats['pages_processed'] = fetch_result.get('pages_processed') or 0
            if stats['pages_processed'] == 0 and stats['orders_found'] > 0:
                stats['pages_processed'] = max(1, math.ceil(stats['orders_found'] / max(limit_per_page, 1)))

            add_log(
                f'Pobrano {stats["orders_found"]} zamówień (strony API: {stats["pages_processed"]}).',
                'info'
            )

            target_statuses_set = set(target_statuses)
            orders_after_status: List[Dict[str, Any]] = []
            for order in orders:
                status_value = self._safe_int(order.get('order_status_id') or order.get('status_id'))
                if status_value is None:
                    if debug_mode:
                        add_log(
                            'Pominięto zamówienie bez statusu.',
                            'debug',
                            order_id=order.get('order_id')
                        )
                    continue

                if status_value not in target_statuses_set:
                    continue

                orders_after_status.append(order)

            stats['orders_matched_status'] = len(orders_after_status)
            add_log(
                f'Do dalszego przetworzenia zakwalifikowano {stats["orders_matched_status"]} zamówień.',
                'info'
            )

            reports_parser = None
            try:
                from modules.reports.parser import ProductNameParser as ReportsProductNameParser
                reports_parser = ReportsProductNameParser()
                if debug_mode:
                    add_log('Zainicjowano parser nazw produktów z modułu reports.', 'debug')
            except Exception as parser_error:
                add_log(
                    'Nie udało się zainicjować parsera nazw produktów z modułu reports. '
                    'Używane będzie podstawowe filtrowanie słów kluczowych.',
                    'warning'
                )
                logger.debug(
                    'Parser reports niedostępny',
                    extra={'context': 'manual_sync', 'error': str(parser_error)}
                )

            excluded_product_types = {'suszenie', 'worek opałowy', 'tarcica', 'deska'}

            for order in orders_after_status:
                order_id_val = self._safe_int(order.get('order_id'))
                if order_id_val is None:
                    stats['errors_count'] += 1
                    error_details.append({'error': 'Brak identyfikatora zamówienia', 'order': order})
                    add_log('Pominięto zamówienie bez identyfikatora.', 'error')
                    continue

                if not force_update and self._order_already_processed(order_id_val):
                    stats['orders_skipped_existing'] += 1
                    add_log(
                        f'Zamówienie {order_id_val} było już zsynchronizowane - pominięto.',
                        'info'
                    )
                    continue

                if force_update and not dry_run:
                    try:
                        removed_count = self._delete_existing_items(order_id_val)
                        if removed_count:
                            stats['products_skipped'] += removed_count
                            add_log(
                                f'Usunięto {removed_count} istniejących pozycji zamówienia {order_id_val}.',
                                'info'
                            )
                    except Exception as delete_error:
                        stats['errors_count'] += 1
                        error_details.append({'error': str(delete_error), 'order_id': order_id_val})
                        add_log(
                            f'Nie udało się usunąć istniejących pozycji zamówienia {order_id_val}.',
                            'error'
                        )
                        continue

                products = order.get('products') or []
                if not products:
                    if debug_mode:
                        add_log(
                            f'Zamówienie {order_id_val} nie zawiera produktów - pominięto.',
                            'debug'
                        )
                    continue

                filtered_products: List[Dict[str, Any]] = []

                for product in products:
                    product_name_raw = product.get('name', '')
                    product_name = product_name_raw.strip() if isinstance(product_name_raw, str) else ''
                    if not product_name and skip_validation:
                        product_name = 'Produkt bez nazwy'

                    if not product_name and not skip_validation:
                        skipped_qty = self._coerce_quantity(product.get('quantity', 1))
                        stats['products_skipped'] += skipped_qty
                        add_log(
                            f'Pominięto pozycję bez nazwy w zamówieniu {order_id_val}.',
                            'warning'
                        )
                        continue

                    quantity_value = self._coerce_quantity(product.get('quantity', 1))
                    if quantity_value <= 0:
                        if skip_validation:
                            quantity_value = 1
                        else:
                            stats['products_skipped'] += 1
                            if debug_mode:
                                add_log(
                                    f'Pominięto pozycję {product_name or product_name_raw} (nieprawidłowa ilość).',
                                    'debug',
                                    order_id=order_id_val
                                )
                            continue

                    name_lower = product_name.lower()
                    if excluded_keywords and any(keyword in name_lower for keyword in excluded_keywords):
                        stats['products_skipped'] += quantity_value
                        if debug_mode:
                            add_log(
                                f"Wykluczono '{product_name}' na podstawie słów kluczowych.",
                                'debug',
                                order_id=order_id_val
                            )
                        continue

                    if reports_parser:
                        try:
                            parsed = reports_parser.parse_product_name(product_name)
                            product_type = (parsed.get('product_type') or '').lower()
                        except Exception as parse_error:
                            product_type = ''
                            if debug_mode:
                                add_log(
                                    f"Błąd parsowania '{product_name}': {parse_error}",
                                    'debug',
                                    order_id=order_id_val
                                )
                        if product_type and product_type in excluded_product_types:
                            stats['products_skipped'] += quantity_value
                            if debug_mode:
                                add_log(
                                    f"Wykluczono '{product_name}' (typ: {product_type}).",
                                    'debug',
                                    order_id=order_id_val
                                )
                            continue

                    sanitized_product = dict(product)
                    sanitized_product['name'] = product_name if product_name else product.get('name', '')
                    sanitized_product['quantity'] = quantity_value
                    filtered_products.append(sanitized_product)

                if not filtered_products:
                    if debug_mode:
                        add_log(
                            f'Brak produktów do utworzenia dla zamówienia {order_id_val} po filtrach.',
                            'debug'
                        )
                    continue

                if dry_run:
                    quantity_total = sum(prod.get('quantity', 0) or 0 for prod in filtered_products)
                    stats['products_created'] += quantity_total
                    stats['orders_processed'] += 1
                    add_log(
                        f"[DRY RUN] Zamówienie {order_id_val}: {quantity_total} pozycji kwalifikuje się do utworzenia.",
                        'info'
                    )
                    continue

                order_results = self._process_single_order(order, filtered_products, dry_run=False)
                stats['orders_processed'] += 1
                stats['products_created'] += order_results.get('created', 0)
                stats['products_updated'] += order_results.get('updated', 0)
                stats['errors_count'] += order_results.get('errors', 0)

                if order_results.get('error_details'):
                    error_details.extend(order_results['error_details'])
                    add_log(
                        f"Zamówienie {order_id_val} zakończone z błędami ({len(order_results['error_details'])}).",
                        'warning'
                    )

                add_log(
                    f"Przetworzono zamówienie {order_id_val} - utworzono {order_results.get('created', 0)} pozycji.",
                    'info'
                )

            add_log(
                f"Synchronizacja zakończona. Zamówienia przetworzone: {stats['orders_processed']},"
                f" utworzone produkty: {stats['products_created']}.",
                'info'
            )

            if sync_log:
                sync_log.orders_fetched = stats['orders_matched_status']
                sync_log.products_created = stats['products_created']
                sync_log.products_updated = stats['products_updated']
                sync_log.products_skipped = stats['products_skipped']
                sync_log.error_count = stats['errors_count']
                if error_details:
                    sync_log.error_details = json.dumps({'errors': error_details})
                sync_log.mark_completed()
                db.session.commit()

            sync_completed_at = datetime.utcnow()
            duration_seconds = int((sync_completed_at - sync_started_at).total_seconds())
            status_label = 'dry_run' if dry_run else ('partial' if stats['errors_count'] > 0 else 'completed')

            stats_payload = {
                'pages_processed': int(stats['pages_processed']),
                'orders_found': int(stats['orders_found']),
                'orders_matched': int(stats['orders_matched_status']),
                'orders_processed': int(stats['orders_processed']),
                'orders_skipped_existing': int(stats['orders_skipped_existing']),
                'products_created': int(stats['products_created']),
                'products_updated': int(stats['products_updated']),
                'products_skipped': int(stats['products_skipped']),
                'errors_count': int(stats['errors_count'])
            }

            response = {
                'success': True,
                'message': 'Synchronizacja Baselinker zakończona pomyślnie.',
                'data': {
                    'sync_id': f"manual_{sync_log.id}" if sync_log else f"manual_{int(sync_started_at.timestamp())}",
                    'status': status_label,
                    'started_at': sync_started_at.isoformat(),
                    'completed_at': sync_completed_at.isoformat(),
                    'duration_seconds': duration_seconds,
                    'options': {
                        'force_update': force_update,
                        'skip_validation': skip_validation,
                        'dry_run': dry_run,
                        'debug_mode': debug_mode,
                        'limit_per_page': limit_per_page,
                        'period_days': period_days,
                        'target_statuses': sorted(target_statuses),
                        'excluded_keywords': sorted(excluded_keywords)
                    },
                    'stats': stats_payload,
                    'log_entries': log_entries
                }
            }

            return response

        except SyncError as sync_error:
            logger.warning('Manual Baselinker sync validation error', extra={'error': str(sync_error)})
            if sync_log:
                sync_log.sync_status = 'failed'
                sync_log.error_count = (sync_log.error_count or 0) + 1
                sync_log.error_details = json.dumps({'error': str(sync_error), 'logs': log_entries[-20:]})
                sync_log.mark_completed()
                db.session.commit()

            add_log(str(sync_error), 'error')
            sync_completed_at = datetime.utcnow()
            stats_payload = {
                'pages_processed': int(stats['pages_processed']),
                'orders_found': int(stats['orders_found']),
                'orders_matched': int(stats['orders_matched_status']),
                'orders_processed': int(stats['orders_processed']),
                'orders_skipped_existing': int(stats['orders_skipped_existing']),
                'products_created': int(stats['products_created']),
                'products_updated': int(stats['products_updated']),
                'products_skipped': int(stats['products_skipped']),
                'errors_count': int(stats['errors_count'] + 1)
            }

            return {
                'success': False,
                'error': str(sync_error),
                'data': {
                    'status': 'failed',
                    'started_at': sync_started_at.isoformat(),
                    'completed_at': sync_completed_at.isoformat(),
                    'duration_seconds': int((sync_completed_at - sync_started_at).total_seconds()),
                    'stats': stats_payload,
                    'log_entries': log_entries
                }
            }

        except Exception as exc:
            logger.exception('Manual Baselinker sync unexpected error')
            if sync_log:
                sync_log.sync_status = 'failed'
                sync_log.error_count = (sync_log.error_count or 0) + 1
                sync_log.error_details = json.dumps({'error': str(exc), 'logs': log_entries[-20:]})
                sync_log.mark_completed()
                db.session.commit()

            add_log(str(exc), 'error')
            sync_completed_at = datetime.utcnow()
            stats_payload = {
                'pages_processed': int(stats['pages_processed']),
                'orders_found': int(stats['orders_found']),
                'orders_matched': int(stats['orders_matched_status']),
                'orders_processed': int(stats['orders_processed']),
                'orders_skipped_existing': int(stats['orders_skipped_existing']),
                'products_created': int(stats['products_created']),
                'products_updated': int(stats['products_updated']),
                'products_skipped': int(stats['products_skipped']),
                'errors_count': int(stats['errors_count'] + 1)
            }

            return {
                'success': False,
                'error': 'Wystąpił nieoczekiwany błąd podczas synchronizacji.',
                'data': {
                    'status': 'failed',
                    'started_at': sync_started_at.isoformat(),
                    'completed_at': sync_completed_at.isoformat(),
                    'duration_seconds': int((sync_completed_at - sync_started_at).total_seconds()),
                    'stats': stats_payload,
                    'log_entries': log_entries
                }
            }

    
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
    
    def _process_orders_to_products(self, orders_data: List[Dict[str, Any]], dry_run: bool = False) -> Dict[str, Any]:
        """
        Wersja z debugowaniem
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
                    continue
                
                # DEBUG stanu przed każdym zamówieniem
                self.debug_id_generator_state(order_id)
                
                # Sprawdzenie czy zamówienie już istnieje
                if self._order_already_processed(order_id):
                    logger.info("⏭️ DEBUG: Zamówienie już przetworzone - pomijam", extra={
                        'order_id': order_id
                    })
                    results['skipped'] += 1
                    continue
                
                products = order.get('products', [])
                if not products:
                    logger.debug("⏭️ DEBUG: Zamówienie bez produktów", extra={'order_id': order_id})
                    results['skipped'] += 1
                    continue
                
                # UŻYJ nowej metody z pełnym debugowaniem
                order_results = self._process_single_order_with_full_debug(order, products, dry_run=dry_run)
                
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
                logger.error("🚨 DEBUG: Błąd przetwarzania zamówienia", extra={
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


    def _coerce_quantity(self, value: Any, default: int = 1) -> int:
        """Konwertuje wartość quantity na bezpieczną liczbę całkowitą."""
        try:
            if value is None:
                return default

            if isinstance(value, (int, float)):
                quantity = int(float(value))
            else:
                value_str = str(value).strip()
                if not value_str:
                    return default
                quantity = int(float(value_str.replace(',', '.')))

            if quantity <= 0:
                return default

            return quantity

        except (TypeError, ValueError):
            return default

    def _safe_int(self, value: Any) -> Optional[int]:
        """Bezpiecznie konwertuje wartość na int lub zwraca None."""
        try:
            if value is None:
                return None

            if isinstance(value, (int, float)):
                converted = int(float(value))
            else:
                value_str = str(value).strip()
                if not value_str:
                    return None
                converted = int(float(value_str))

            return converted

        except (TypeError, ValueError):
            return None

    def _delete_existing_items(self, baselinker_order_id: int) -> int:
        """Usuwa istniejące produkty powiązane z zamówieniem Baselinker."""
        from ..models import ProductionItem

        try:
            deleted_count = ProductionItem.query.filter_by(
                baselinker_order_id=baselinker_order_id
            ).delete()
            db.session.commit()
            return deleted_count or 0
        except Exception as exc:
            db.session.rollback()
            logger.error("Błąd usuwania istniejących produktów", extra={
                'order_id': baselinker_order_id,
                'error': str(exc)
            })
            raise

    
    def _process_single_order(self, order: Dict[str, Any], products: List[Dict[str, Any]], dry_run: bool = False) -> Dict[str, Any]:
        """
        Przetwarza pojedyncze zamówienie na produkty z poprawną logiką numerowania ID

        Args:
            order (Dict[str, Any]): Dane zamówienia
            products (List[Dict[str, Any]]): Lista produktów w zamówieniu
            dry_run (bool): Czy wykonać przetwarzanie w trybie symulacji
        
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
        
            logger.info("Przetwarzanie zamówienia", extra={
                'baselinker_order_id': baselinker_order_id,
                'products_count': len(products)
            })
        
            # KROK 1: Przygotowanie wspólnych danych dla zamówienia
            client_data = self._extract_client_data(order)
            deadline_date = self._calculate_deadline_date(order)
        
            # KROK 2: Policz łączną liczbę produktów (suma wszystkich quantity)
            total_products_count = 0
            for product in products:
                quantity = self._coerce_quantity(product.get('quantity', 1))
                total_products_count += quantity
        
            logger.debug("Policzono produkty w zamówieniu", extra={
                'baselinker_order_id': baselinker_order_id,
                'product_items': len(products),
                'total_products_count': total_products_count
            })
        
            # KROK 3: Wygeneruj WSZYSTKIE ID dla zamówienia NARAZ
            # To zapewnia jeden XXXXX dla całego zamówienia
            id_result = ProductIDGenerator.generate_product_id_for_order(
                baselinker_order_id, total_products_count
            )
            
            product_ids_list = id_result['product_ids']  # Lista wszystkich ID: ['25_00024_1', '25_00024_2', ...]
            internal_order_number = id_result['internal_order_number']  # '25_00024'
        
            logger.debug("Wygenerowano ID dla zamówienia", extra={
                'baselinker_order_id': baselinker_order_id,
                'internal_order_number': internal_order_number,
                'total_ids_generated': len(product_ids_list),
                'first_id': product_ids_list[0] if product_ids_list else None,
                'last_id': product_ids_list[-1] if product_ids_list else None
            })
        
            # KROK 4: Przetwórz produkty używając pre-wygenerowanych ID
            current_id_index = 0  # Indeks w liście product_ids_list
            parser = get_parser_service()
            priority_calc = get_priority_calculator()
        
            for product_index, product in enumerate(products):
                try:
                    product_name = product.get('name', '')
                    quantity = self._coerce_quantity(product.get('quantity', 1))
                    order_product_id = product.get('order_product_id')

                    logger.debug("Przetwarzanie produktu", extra={
                        'product_name': product_name[:50],
                        'quantity': quantity,
                        'order_product_id': order_product_id,
                        'product_index': product_index
                    })

                    # Dla każdej sztuki w quantity - utwórz osobny rekord
                    for qty_index in range(quantity):
                        try:
                            # Sprawdź czy nie wyszliśmy poza zakres wygenerowanych ID
                            if current_id_index >= len(product_ids_list):
                                raise Exception(f"Brak ID dla produktu na pozycji {current_id_index}")
                            
                            # Użyj kolejnego ID z listy
                            product_id = product_ids_list[current_id_index]
                            current_id_index += 1
                            
                            # Parsowanie nazwy produktu (raz na product, nie na quantity)
                            if qty_index == 0:  # Parsuj tylko pierwszy raz
                                parsed_data = parser.parse_product_name(product_name)
                            
                            # Przygotowanie danych produktu
                            product_data = self._prepare_product_data_new(
                                order=order,
                                product=product,
                                product_id=product_id,
                                id_result=id_result,
                                parsed_data=parsed_data,
                                client_data=client_data,
                                deadline_date=deadline_date,
                                order_product_id=order_product_id,
                                sequence_number=current_id_index  # Numer w sekwencji zamówienia
                            )
                            
                            # Obliczenie priorytetu
                            priority_score = priority_calc.calculate_priority(product_data)
                            product_data['priority_score'] = priority_score
                            
                            if not dry_run:
                                # Zapis do bazy danych
                                production_item = ProductionItem(**product_data)
                                db.session.add(production_item)
                            
                            results['created'] += 1
                            
                            logger.debug("Utworzono produkt", extra={
                                'product_id': product_id,
                                'sequence_in_order': current_id_index,
                                'qty_index': qty_index + 1,
                                'priority_score': priority_score
                            })
                        
                        except Exception as e:
                            results['errors'] += 1
                            results['error_details'].append({
                                'product_name': product_name,
                                'qty_index': qty_index + 1,
                                'sequence': current_id_index,
                                'error': str(e)
                            })
                            logger.error("Błąd tworzenia produktu", extra={
                                'product_name': product_name,
                                'qty_index': qty_index + 1,
                                'sequence': current_id_index,
                                'baselinker_order_id': baselinker_order_id,
                                'error': str(e)
                            })
                            # Nie zwiększaj current_id_index przy błędzie - ID zostanie "zmarnowane"
                            # ale numeracja pozostanie spójna
                    
                except Exception as e:
                    results['errors'] += 1
                    results['error_details'].append({
                        'product_name': product.get('name'),
                        'product_index': product_index,
                        'order_id': baselinker_order_id,
                        'error': str(e)
                    })
                    logger.error("Błąd przetwarzania produktu", extra={
                        'product_name': product.get('name', ''),
                        'product_index': product_index,
                        'baselinker_order_id': baselinker_order_id,
                        'error': str(e)
                    })
        
            # KROK 5: Commit wszystkich produktów z zamówienia
            if not dry_run:
                db.session.commit()
            
            logger.info("Zakończono przetwarzanie zamówienia", extra={
                'baselinker_order_id': baselinker_order_id,
                'created': results['created'],
                'errors': results['errors'],
                'internal_order_number': internal_order_number,
                'ids_used': current_id_index,
                'ids_generated': len(product_ids_list)
            })

        except Exception as e:
            if not dry_run:
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

    def _prepare_product_data(self, order: Dict[str, Any], product: Dict[str, Any], id_result: Dict[str, Any], parsed_data: Dict[str, Any]) -> Dict[str, Any]:
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

    def _prepare_product_data_new(
        self, 
        order: Dict[str, Any], 
        product: Dict[str, Any], 
        product_id: str,
        id_result: Dict[str, Any], 
        parsed_data: Dict[str, Any],
        client_data: Dict[str, str],
        deadline_date: date,
        order_product_id: Any,
        sequence_number: int) -> Dict[str, Any]:
        """
        Przygotowuje dane produktu do zapisania w bazie - POPRAWIONA WERSJA
        
        Args:
            order: Dane zamówienia z Baselinker
            product: Dane produktu z Baselinker  
            product_id: Wygenerowany short_product_id (np. '25_00024_3')
            id_result: Wynik generowania ID
            parsed_data: Sparsowane dane nazwy produktu
            client_data: Dane klienta
            deadline_date: Obliczona data deadline
            order_product_id: ID produktu w zamówieniu z Baselinker
            sequence_number: Numer sekwencyjny w zamówieniu (1, 2, 3, ...)
        
        Returns:
            Dict[str, Any]: Przygotowane dane produktu
        """

        # Podstawowe dane z ID generator
        product_data = {
            'short_product_id': product_id,
            'internal_order_number': id_result['internal_order_number'],
            'product_sequence_in_order': sequence_number,
            'baselinker_order_id': order['order_id'],
            'baselinker_product_id': str(order_product_id) if order_product_id else None,
            'original_product_name': product.get('name', ''),
            'baselinker_status_id': order.get('order_status_id'),
        
            # Dane klienta
            'client_name': client_data['client_name'],
            'client_email': client_data['client_email'],  
            'client_phone': client_data['client_phone'],
            'delivery_address': client_data['delivery_address'],
        
            # Deadline
            'deadline_date': deadline_date,
        
            # Status początkowy
            'current_status': 'czeka_na_wyciecie',
            'sync_source': 'baselinker_auto'
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

        # Dane finansowe z produktu Baselinker
        try:
            price_brutto = float(product.get('price_brutto', 0))
            tax_rate = float(product.get('tax_rate', 23))
        
            # Oblicz cenę netto na JEDNĄ SZTUKĘ
            price_netto = price_brutto / (1 + tax_rate/100) if tax_rate > 0 else price_brutto
            
            # WAŻNE: Cena per sztuka, nie per quantity całkowite
            # Jeśli quantity=3, to każdy z 3 rekordów ma cenę za 1 sztukę
            product_quantity = self._coerce_quantity(product.get('quantity', 1))
            unit_price = price_netto / product_quantity if product_quantity > 0 else price_netto
        
            product_data.update({
                'unit_price_net': round(unit_price, 2),
                'total_value_net': round(unit_price, 2)  # Jeden rekord = jedna sztuka
            })
        except (ValueError, TypeError) as e:
            logger.warning("Błąd obliczania cen produktu", extra={
                'product_name': product.get('name', '')[:50],
                'price_brutto': product.get('price_brutto'),
                'error': str(e)
            })
            product_data.update({
                'unit_price_net': 0,
                'total_value_net': 0
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

    def update_order_status(self, internal_order_number: str) -> bool:
        """
        Alias dla update_order_status_in_baselinker dla zgodności z testami
    
        Args:
            internal_order_number (str): Numer zamówienia wewnętrznego
        
        Returns:
            bool: True jeśli aktualizacja się powiodła
        """
        return self.update_order_status_in_baselinker(internal_order_number)

    def _extract_client_data(self, order: Dict[str, Any]) -> Dict[str, str]:
        """
        Wyciąga dane klienta w hierarchii:
        delivery_fullname > invoice_fullname > user_login > email > phone
        """
        client_name = (
            order.get('delivery_fullname') or
            order.get('invoice_fullname') or 
            order.get('user_login') or
            order.get('email') or
            order.get('phone') or
            'Nieznany klient'
        )
    
        # Skróć nazwę klienta do maksymalnie 255 znaków (limit bazy danych)
        if len(client_name) > 255:
            client_name = client_name[:252] + "..."
    
        # Przygotuj adres dostawy
        delivery_parts = [
            order.get('delivery_address', '').strip(),
            order.get('delivery_city', '').strip(),
            order.get('delivery_postcode', '').strip()
        ]
        delivery_address = ' '.join(part for part in delivery_parts if part)
    
        return {
            'client_name': client_name,
            'client_email': order.get('email', ''),
            'client_phone': order.get('phone', ''),
            'delivery_address': delivery_address
        }

    def _calculate_deadline_date(self, order: Dict[str, Any]) -> datetime.date:
        """
        Oblicza deadline na podstawie date_confirmed + konfigurowalne dni robocze
        """
        try:
            from ..services.config_service import get_config_service
            from datetime import timedelta
        
            date_confirmed_timestamp = order.get('date_confirmed')
            if not date_confirmed_timestamp:
                # Fallback: data dzisiejsza
                base_date = datetime.now().date()
                logger.warning("Brak date_confirmed w zamówieniu, używam daty dzisiejszej", extra={
                    'order_id': order.get('order_id')
                })
            else:
                # Konwersja timestamp Unix na date
                base_date = datetime.fromtimestamp(int(date_confirmed_timestamp)).date()
        
            # Pobierz konfigurowalne dni robocze (zapisane raz na początku sync)
            if not hasattr(self, '_cached_deadline_days'):
                config_service = get_config_service()
                self._cached_deadline_days = int(config_service.get_config('DEADLINE_DEFAULT_DAYS', '14'))
        
            # Oblicz deadline pomijając weekendy
            deadline_date = self._add_business_days(base_date, self._cached_deadline_days)
        
            logger.debug("Obliczono deadline", extra={
                'order_id': order.get('order_id'),
                'date_confirmed': base_date.isoformat() if base_date else None,
                'deadline_days': self._cached_deadline_days,
                'calculated_deadline': deadline_date.isoformat()
            })
        
            return deadline_date
        
        except Exception as e:
            logger.error("Błąd obliczania deadline", extra={
                'order_id': order.get('order_id'),
                'error': str(e)
            })
            # Fallback: dzisiejsza data + 14 dni roboczych
            return self._add_business_days(datetime.now().date(), 14)

    def _add_business_days(self, start_date: date, business_days: int) -> date:
        """Dodaje dni robocze pomijając weekendy (sobota=5, niedziela=6)"""
        from datetime import timedelta
    
        current_date = start_date
        days_added = 0
    
        while days_added < business_days:
            current_date += timedelta(days=1)
            # Weekday: Poniedziałek=0, Wtorek=1, ..., Sobota=5, Niedziela=6
            if current_date.weekday() < 5:  # 0-4 = Poniedziałek-Piątek
                days_added += 1
            
        return current_date
    
    def debug_id_generator_state(self, baselinker_order_id: int):
        """Debug stanu ID generatora"""
        from ..services.id_generator import ProductIDGenerator
        
        logger.info("🔍 DEBUG: Stan ID generatora", extra={
            'baselinker_order_id': baselinker_order_id,
            'cache_size': len(ProductIDGenerator._order_mapping_cache),
            'cache_contents': dict(ProductIDGenerator._order_mapping_cache)
        })
        
        # Sprawdź aktualny licznik w bazie
        current_counter = ProductIDGenerator.get_current_counter_for_year()
        logger.info("🔍 DEBUG: Licznik w bazie danych", extra={
            'current_counter': current_counter
        })
    

    def _process_single_order_with_full_debug(self, order: Dict[str, Any], products: List[Dict[str, Any]], dry_run: bool = False) -> Dict[str, Any]:
        """
        Wersja _process_single_order z pełnym debugowaniem
        """
        results = {
            'created': 0,
            'updated': 0,
            'errors': 0,
            'error_details': []
        }

        baselinker_order_id = order['order_id']
        
        logger.info("🔍 DEBUG: Rozpoczęcie przetwarzania zamówienia", extra={
            'baselinker_order_id': baselinker_order_id,
            'products_count': len(products),
            'dry_run': dry_run
        })

        try:
            from ..services.id_generator import ProductIDGenerator
            from ..services.parser_service import get_parser_service
            from ..services.priority_service import get_priority_calculator
            from ..models import ProductionItem

            # DEBUG: Sprawdź stan bazy przed rozpoczęciem
            existing_count = ProductionItem.query.count()
            logger.info("🔍 DEBUG: Stan bazy przed przetwarzaniem", extra={
                'total_records_in_db': existing_count,
                'baselinker_order_id': baselinker_order_id
            })
            
            # DEBUG: Sprawdź czy to zamówienie już istnieje
            existing_for_order = ProductionItem.query.filter_by(
                baselinker_order_id=baselinker_order_id
            ).all()
            
            if existing_for_order:
                logger.warning("🚨 DEBUG: Zamówienie już istnieje w bazie!", extra={
                    'baselinker_order_id': baselinker_order_id,
                    'existing_records': len(existing_for_order),
                    'existing_ids': [item.short_product_id for item in existing_for_order]
                })
                # Wyjdź z funkcji, nie przetwarzaj ponownie
                return results

            # KROK 1: Przygotowanie wspólnych danych dla zamówienia
            client_data = self._extract_client_data(order)
            deadline_date = self._calculate_deadline_date(order)

            # KROK 2: DEBUG - Szczegółowa analiza produktów
            logger.info("🔍 DEBUG: Analiza produktów w zamówieniu", extra={
                'baselinker_order_id': baselinker_order_id
            })
            
            total_products_count = 0
            products_breakdown = []
            
            for i, product in enumerate(products):
                quantity = self._coerce_quantity(product.get('quantity', 1))
                total_products_count += quantity
                
                product_breakdown = {
                    'index': i,
                    'name': product.get('name', '')[:50],
                    'quantity': quantity,
                    'baselinker_product_id': product.get('order_product_id')
                }
                products_breakdown.append(product_breakdown)
                
                logger.info("🔍 DEBUG: Produkt w zamówieniu", extra={
                    'baselinker_order_id': baselinker_order_id,
                    'product_index': i,
                    'product_name': product.get('name', '')[:50],
                    'quantity': quantity,
                    'baselinker_product_id': product.get('order_product_id')
                })

            logger.info("🔍 DEBUG: Podsumowanie produktów", extra={
                'baselinker_order_id': baselinker_order_id,
                'product_items_count': len(products),
                'total_products_count': total_products_count,
                'products_breakdown': products_breakdown
            })

            # KROK 3: Generowanie ID
            logger.info("🔍 DEBUG: Przed generowaniem ID", extra={
                'baselinker_order_id': baselinker_order_id,
                'total_products_count': total_products_count
            })
            
            id_result = ProductIDGenerator.generate_product_id_for_order(
                baselinker_order_id, total_products_count
            )
            
            logger.info("🔍 DEBUG: Po wygenerowaniu ID", extra={
                'baselinker_order_id': baselinker_order_id,
                'internal_order_number': id_result['internal_order_number'],
                'generated_ids_count': len(id_result['product_ids']),
                'first_id': id_result['product_ids'][0] if id_result['product_ids'] else None,
                'last_id': id_result['product_ids'][-1] if id_result['product_ids'] else None,
                'all_generated_ids': id_result['product_ids']
            })

            # KROK 4: Sprawdzenie unikalności przed wstawieniem
            logger.info("🔍 DEBUG: Sprawdzanie unikalności wygenerowanych ID", extra={
                'baselinker_order_id': baselinker_order_id
            })
            
            for product_id in id_result['product_ids']:
                existing = ProductionItem.query.filter_by(short_product_id=product_id).first()
                if existing:
                    logger.error("🚨 DEBUG: KONFLIKT! Wygenerowany ID już istnieje!", extra={
                        'baselinker_order_id': baselinker_order_id,
                        'conflicting_id': product_id,
                        'existing_record_id': existing.id,
                        'existing_order_id': existing.baselinker_order_id
                    })
                    results['errors'] += 1
                    results['error_details'].append({
                        'error': f'ID {product_id} już istnieje',
                        'conflicting_id': product_id
                    })
                    return results

            logger.info("✅ DEBUG: Wszystkie wygenerowane ID są unikalne", extra={
                'baselinker_order_id': baselinker_order_id
            })

            # KROK 5: Przetwarzanie produktów
            current_id_index = 0
            parser = get_parser_service()
            priority_calc = get_priority_calculator()
            
            prepared_items = []  # Lista do zbiorczego commit

            for product_index, product in enumerate(products):
                try:
                    product_name = product.get('name', '')
                    quantity = self._coerce_quantity(product.get('quantity', 1))
                    order_product_id = product.get('order_product_id')

                    logger.info("🔍 DEBUG: Przetwarzanie produktu", extra={
                        'baselinker_order_id': baselinker_order_id,
                        'product_index': product_index,
                        'product_name': product_name[:50],
                        'quantity': quantity,
                        'current_id_index': current_id_index
                    })

                    # Parsowanie nazwy produktu (raz na produkt)
                    parsed_data = parser.parse_product_name(product_name)

                    # Dla każdej sztuki w quantity
                    for qty_index in range(quantity):
                        try:
                            if current_id_index >= len(id_result['product_ids']):
                                raise Exception(f"Brak ID dla pozycji {current_id_index}")
                            
                            product_id = id_result['product_ids'][current_id_index]
                            current_id_index += 1

                            logger.info("🔍 DEBUG: Tworzenie rekordu produktu", extra={
                                'baselinker_order_id': baselinker_order_id,
                                'product_id': product_id,
                                'qty_index': qty_index + 1,
                                'sequence_number': current_id_index
                            })

                            # Przygotowanie danych produktu
                            product_data = self._prepare_product_data_new(
                                order=order,
                                product=product,
                                product_id=product_id,
                                id_result=id_result,
                                parsed_data=parsed_data,
                                client_data=client_data,
                                deadline_date=deadline_date,
                                order_product_id=order_product_id,
                                sequence_number=current_id_index
                            )

                            # Obliczenie priorytetu
                            priority_score = priority_calc.calculate_priority(product_data)
                            product_data['priority_score'] = priority_score

                            if not dry_run:
                                # Przygotuj obiekt ale nie commituj jeszcze
                                production_item = ProductionItem(**product_data)
                                prepared_items.append(production_item)
                                
                                logger.info("🔍 DEBUG: Przygotowano rekord do wstawienia", extra={
                                    'baselinker_order_id': baselinker_order_id,
                                    'product_id': product_id,
                                    'prepared_items_count': len(prepared_items)
                                })

                            results['created'] += 1

                        except Exception as e:
                            results['errors'] += 1
                            results['error_details'].append({
                                'product_name': product_name,
                                'qty_index': qty_index + 1,
                                'sequence': current_id_index,
                                'error': str(e)
                            })
                            logger.error("🚨 DEBUG: Błąd tworzenia produktu", extra={
                                'baselinker_order_id': baselinker_order_id,
                                'product_name': product_name[:50],
                                'qty_index': qty_index + 1,
                                'error': str(e)
                            })

                except Exception as e:
                    results['errors'] += 1
                    results['error_details'].append({
                        'product_name': product.get('name'),
                        'product_index': product_index,
                        'error': str(e)
                    })

            # KROK 6: Zbiorczy commit wszystkich rekordów
            if not dry_run and prepared_items:
                logger.info("🔍 DEBUG: Rozpoczęcie zbiorczego commit", extra={
                    'baselinker_order_id': baselinker_order_id,
                    'items_to_commit': len(prepared_items)
                })
                
                try:
                    # Dodaj wszystkie rekordy do sesji
                    for item in prepared_items:
                        db.session.add(item)
                    
                    # Commit wszystkich naraz
                    db.session.commit()
                    
                    logger.info("✅ DEBUG: Zbiorczy commit zakończony pomyślnie", extra={
                        'baselinker_order_id': baselinker_order_id,
                        'committed_items': len(prepared_items)
                    })
                    
                    # Sprawdź stan po commit
                    final_count = ProductionItem.query.count()
                    logger.info("🔍 DEBUG: Stan bazy po commit", extra={
                        'baselinker_order_id': baselinker_order_id,
                        'total_records_now': final_count
                    })
                    
                except Exception as e:
                    db.session.rollback()
                    logger.error("🚨 DEBUG: Błąd zbiorczego commit", extra={
                        'baselinker_order_id': baselinker_order_id,
                        'error': str(e),
                        'items_attempted': len(prepared_items)
                    })
                    
                    # Sprawdź który rekord powoduje problem
                    for i, item in enumerate(prepared_items):
                        existing = ProductionItem.query.filter_by(
                            short_product_id=item.short_product_id
                        ).first()
                        if existing:
                            logger.error("🚨 DEBUG: Konflikt przy wstawianiu", extra={
                                'item_index': i,
                                'conflicting_id': item.short_product_id,
                                'existing_record': existing.id
                            })
                    
                    results['errors'] = len(prepared_items)
                    results['created'] = 0

            logger.info("🔍 DEBUG: Zakończenie przetwarzania zamówienia", extra={
                'baselinker_order_id': baselinker_order_id,
                'created': results['created'],
                'errors': results['errors']
            })

        except Exception as e:
            if not dry_run:
                db.session.rollback()
            results['errors'] += 1
            results['error_details'].append({
                'error': str(e),
                'order_id': baselinker_order_id
            })
            logger.error("🚨 DEBUG: Błąd główny przetwarzania zamówienia", extra={
                'order_id': baselinker_order_id,
                'error': str(e)
            })

        return results

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

def manual_sync_with_filtering(params: Dict[str, Any]) -> Dict[str, Any]:
    """Helper function dla ręcznej synchronizacji z filtrami."""
    return get_sync_service().manual_sync_with_filtering(params)

def update_order_status_in_baselinker(internal_order_number: str) -> bool:
    """Helper function dla aktualizacji statusu"""
    return get_sync_service().update_order_status_in_baselinker(internal_order_number)

def get_sync_status() -> Dict[str, Any]:
    """Helper function dla sprawdzania statusu sync"""
    return get_sync_service().get_sync_status()

def cleanup_old_sync_logs(days_to_keep: int = 30):
    """Helper function dla czyszczenia logów"""
    get_sync_service().cleanup_old_sync_logs(days_to_keep)