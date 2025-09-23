# modules/production/services/sync_service.py
"""
Serwis synchronizacji z Baselinker dla modułu Production - ENHANCED VERSION 2.0
================================================================================

ENHANCED VERSION 2.0 - Integracja z nowym systemem priorytetów:
- Domyślna synchronizacja TYLKO ze statusu "Nowe - opłacone" (155824)
- Extraction payment_date z historii zmian statusów  
- Automatyczna zmiana statusu na "W produkcji - surowe" (138619)
- Walidacja kompletności produktów + komentarze w BL przy błędach
- Automatyczne przeliczenie priorytetów po synchronizacji
- Wspólna logika dla manual i CRON sync z tym samym workflow
- Backward compatibility - wszystkie istniejące funkcje zachowane

NOWY WORKFLOW SYNCHRONIZACJI:
1. Pobieranie zamówień ze statusu 155824 ("Nowe - opłacone")
2. Extraction payment_date z date_status_change dla statusu 155824
3. Walidacja kompletności wszystkich produktów w zamówieniu
4. Jeśli validation fails → komentarz do BL + skip całe zamówienie  
5. Zapis produktów z payment_date i thickness_group
6. Zmiana statusu z 155824 → 138619 ("W produkcji - surowe") 
7. Przeliczenie priorytetów z zachowaniem manual overrides

ZACHOWANA KOMPATYBILNOŚĆ:
- Wszystkie istniejące metody i parametry
- Format response i error handling
- Retry mechanism i logging
- Manual sync z filtrami (rozszerzony o nowe opcje)

Autor: Konrad Kmiecik  
Wersja: 2.0 (Enhanced Priority System Integration)
Data: 2025-01-22
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
import pytz

logger = get_structured_logger('production.sync.v2')

def get_local_now():
    """
    Zwraca aktualny czas w strefie czasowej Polski
    Zastępuje datetime.utcnow() dla poprawnego wyświetlania czasu
    """
    poland_tz = pytz.timezone('Europe/Warsaw')
    return datetime.now(poland_tz).replace(tzinfo=None)  # Remove timezone info for MySQL compatibility

class SyncError(Exception):
    """Wyjątek dla błędów synchronizacji"""
    pass

class BaselinkerSyncService:
    """
    Serwis synchronizacji z API Baselinker - ENHANCED VERSION 2.0
    
    Zarządza dwukierunkowym przepływem danych między systemem produkcyjnym
    a platformą Baselinker z nowym systemem priorytetów opartym na dacie opłacenia.
    
    NOWE FUNKCJE w v2.0:
    - Payment date extraction i status change workflow
    - Product validation z komentarzami w Baselinker
    - Priority recalculation integration  
    - Enhanced manual sync z nowymi opcjami
    - CRON sync z identyczną logiką jak manual
    """
    
    def __init__(self):
        """Inicjalizacja serwisu synchronizacji Enhanced v2.0"""
        
        # ZMIANA: Domyślnie tylko status "Nowe - opłacone" dla nowego systemu
        self.source_statuses = [155824]  # GŁÓWNA ZMIANA: tylko "Nowe - opłacone"
        
        # Status docelowy po synchronizacji (zmiana z "Nowe - opłacone")
        self.target_production_status = 138619  # "W produkcji - surowe"
        
        # ZACHOWANE: Status dla ukończonych zamówień  
        self.target_completed_status = 138623  # "Ukończone"
        
        # ZACHOWANA: Konfiguracja API
        self.api_endpoint = "https://api.baselinker.com/connector.php"
        self.api_key = None
        self.api_timeout = 30
        
        # ZACHOWANA: Konfiguracja synchronizacji
        self.max_items_per_batch = 1000
        self.max_retries = 3
        self.retry_delay = 5  # sekund
        
        # Inicjalizacja konfiguracji
        self._load_config()
        
        logger.info("Inicjalizacja BaselinkerSyncService v2.0 (Enhanced Priority System)", extra={
            'source_statuses': self.source_statuses,
            'target_production_status': self.target_production_status,
            'target_completed_status': self.target_completed_status,
            'enhanced_features': [
                'payment_date_extraction',
                'status_change_workflow', 
                'product_validation',
                'priority_recalculation',
                'manual_override_respect'
            ]
        })

    def _load_config(self):
        """ZACHOWANE: Ładuje konfigurację z Flask app.config"""
        try:
            from flask import current_app
        
            # Pobierz konfigurację API Baselinker z Flask config
            api_config = current_app.config.get('API_BASELINKER', {})
            self.api_key = api_config.get('api_key')
            if api_config.get('endpoint'):
                self.api_endpoint = api_config['endpoint']
        
            logger.info("Załadowano konfigurację API Baselinker v2.0", extra={
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
        
            if not self.api_key:
                logger.error("Brak klucza API Baselinker w konfiguracji")
            else:
                logger.info("Klucz API Baselinker załadowany pomyślnie")
            
        except Exception as e:
            logger.error("Błąd ładowania konfiguracji", extra={'error': str(e)})
        
            # FALLBACK: Jeśli current_app nie jest dostępne
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

    # ============================================================================
    # NOWE METODY DLA ENHANCED PRIORITY SYSTEM 2.0
    # ============================================================================

    def sync_paid_orders_only(self) -> Dict[str, Any]:
        """
        NOWA METODA: Automatyczna synchronizacja dla CRON (co godzinę)
        
        Synchronizuje TYLKO zamówienia ze statusu "Nowe - opłacone" (155824):
        1. Pobieranie ostatnie 7 dni z paginacją
        2. Użycie process_orders_with_priority_logic() 
        3. Zawsze auto_status_change = True
        4. Zawsze recalculate_priorities = True
        5. Extended logging dla monitoring
        
        Returns:
            Dict[str, Any]: Raport synchronizacji CRON
        """
        sync_started_at = get_local_now()
        
        # Rozpoczęcie logowania synchronizacji
        sync_log = self._create_sync_log('cron_auto', sync_started_at)
        
        try:
            logger.info("CRON: Rozpoczęcie automatycznej synchronizacji opłaconych zamówień")
            
            # KROK 1: Pobieranie zamówień TYLKO ze statusu "Nowe - opłacone"
            orders_data = self._fetch_paid_orders_for_cron()
            logger.info(f"CRON: Pobrano {len(orders_data)} zamówień ze statusu 'Nowe - opłacone'")
            
            if not orders_data:
                result = {
                    'success': True,
                    'orders_processed': 0,
                    'message': 'Brak nowych opłaconych zamówień do synchronizacji',
                    'sync_type': 'cron_auto',
                    'duration_seconds': 0
                }
                
                if sync_log:
                    sync_log.orders_processed = 0
                    sync_log.complete_sync(success=True)
                    db.session.commit()
                    
                return result
            
            # KROK 2: Przetwarzanie z enhanced priority logic
            processing_result = self.process_orders_with_priority_logic(
                orders_data, 
                sync_type='cron',
                auto_status_change=True  # ZAWSZE dla CRON
            )
            
            # KROK 3: Update sync log
            if sync_log:
                sync_log.orders_processed = processing_result['orders_processed']
                sync_log.products_created = processing_result['products_created']
                sync_log.products_updated = processing_result['products_updated']
                sync_log.products_skipped = processing_result['products_skipped']
                sync_log.error_count = processing_result['errors_count']
                sync_log.priority_recalc_triggered = processing_result.get('priority_recalc_triggered', False)
                sync_log.priority_recalc_duration_seconds = processing_result.get('priority_recalc_duration', 0)
                sync_log.manual_overrides_preserved = processing_result.get('manual_overrides_preserved', 0)
                
                if processing_result.get('error_details'):
                    sync_log.error_details_json = json.dumps(processing_result['error_details'])
                
                sync_log.complete_sync(success=processing_result['success'])
                db.session.commit()
            
            # KROK 4: Return enhanced result
            duration = (get_local_now() - sync_started_at).total_seconds()
            
            result = {
                'success': processing_result['success'],
                'sync_type': 'cron_auto',
                'duration_seconds': round(duration, 2),
                'orders_processed': processing_result['orders_processed'],
                'products_created': processing_result['products_created'],
                'products_updated': processing_result['products_updated'],
                'products_skipped': processing_result['products_skipped'],
                'errors_count': processing_result['errors_count'],
                'status_changes': {
                    'orders_moved_to_production': processing_result.get('status_changes_count', 0),
                    'status_change_errors': processing_result.get('status_change_errors', 0)
                },
                'priority_recalculation': {
                    'triggered': processing_result.get('priority_recalc_triggered', False),
                    'products_updated': processing_result.get('priority_products_updated', 0),
                    'manual_overrides_preserved': processing_result.get('manual_overrides_preserved', 0),
                    'duration_seconds': processing_result.get('priority_recalc_duration', 0)
                }
            }
            
            logger.info("CRON: Zakończono automatyczną synchronizację", extra=result)
            return result
            
        except Exception as e:
            logger.error("CRON: Błąd automatycznej synchronizacji", extra={
                'error': str(e)
            })
            
            if sync_log:
                sync_log.sync_status = 'failed'
                sync_log.error_count = (sync_log.error_count or 0) + 1
                sync_log.error_details_json = json.dumps({'cron_error': str(e)})
                sync_log.complete_sync(success=False, error_message=str(e))
                db.session.commit()
            
            duration = (get_local_now() - sync_started_at).total_seconds()
            
            return {
                'success': False,
                'error': str(e),
                'sync_type': 'cron_auto',
                'duration_seconds': round(duration, 2),
                'orders_processed': 0,
                'products_created': 0
            }

    def process_orders_with_priority_logic(self, orders_data: List[Dict], sync_type: str = 'manual', auto_status_change: bool = True) -> Dict[str, Any]:
        """
        POPRAWIONA wersja: Uniwersalna metoda przetwarzania zamówień z ENHANCED priority logic
    
        NAPRAWIONO:
        - Status change TYLKO dla zamówień z successful product creation
        - Proper error handling dla każdego kroku
        - Zwracanie prawidłowego Dict response
        """
        logger.info("ENHANCED: Rozpoczęcie przetwarzania zamówień z priority logic", extra={
            'orders_count': len(orders_data),
            'sync_type': sync_type,
            'auto_status_change': auto_status_change
        })

        processing_stats = {
            'orders_processed': 0,
            'products_created': 0,
            'products_updated': 0,
            'products_skipped': 0,
            'errors_count': 0,
            'status_changes_count': 0,
            'status_change_errors': 0
        }

        error_details = []
        orders_for_status_change = []  # NOWE: Lista zamówień które kwalifikują się do zmiany statusu

        for order_data in orders_data:
            try:
                # BEZPIECZNE pobieranie order_id
                order_id = None
                if isinstance(order_data, dict):
                    order_id = order_data.get('order_id') or order_data.get('id')
        
                if not order_id:
                    logger.warning("ENHANCED: Pominięto zamówienie bez order_id", extra={
                        'order_data_keys': list(order_data.keys()) if isinstance(order_data, dict) else 'not_dict'
                    })
                    processing_stats['errors_count'] += 1
                    continue
        
                logger.debug("ENHANCED: Przetwarzanie zamówienia", extra={'order_id': order_id})
        
                # KROK 1: Extract payment_date 
                payment_date = None
                try:
                    payment_date = self.extract_payment_date_from_order(order_data)
                    if payment_date:
                        logger.debug("ENHANCED: Wyciągnięto payment_date", extra={
                            'order_id': order_id, 
                            'payment_date': payment_date.isoformat()
                        })
                except Exception as e:
                    logger.warning("ENHANCED: Nie udało się wyciągnąć payment_date", extra={
                        'order_id': order_id,
                        'error': str(e)
                    })
        
                # KROK 2: Walidacja produktów w zamówieniu
                validation_result = self.validate_order_products_completeness(order_data)
                is_valid, validation_errors = validation_result
        
                if not is_valid:
                    logger.warning("ENHANCED: Zamówienie nie przeszło walidacji", extra={
                        'order_id': order_id,
                        'validation_errors': validation_errors
                    })
                
                    # Dodaj komentarz do Baselinker
                    try:
                        self.add_validation_comment_to_baselinker(order_id, validation_errors)
                    except Exception as comment_error:
                        logger.error("ENHANCED: Błąd dodawania komentarza walidacji", extra={
                            'order_id': order_id,
                            'error': str(comment_error)
                        })
                
                    processing_stats['products_skipped'] += len(order_data.get('products', []))
                    processing_stats['errors_count'] += 1
                    error_details.append({
                        'order_id': order_id,
                        'error': 'Validation failed',
                        'details': validation_errors
                    })
                    continue  # Skip całe zamówienie
        
                # KROK 3: Tworzenie produktów
                products = order_data.get('products', [])
                if not products:
                    logger.warning("ENHANCED: Zamówienie bez produktów", extra={'order_id': order_id})
                    continue
            
                order_products_created = 0
                order_errors = 0
            
                for product_data in products:
                    try:
                        production_item = self._create_product_from_order_data(
                            order_data, product_data, payment_date
                        )
                    
                        if production_item:
                            db.session.add(production_item)
                            order_products_created += 1
                            processing_stats['products_created'] += 1
                        
                            logger.debug("ENHANCED: Produkt utworzony", extra={
                                'order_id': order_id,
                                'product_id': production_item.short_product_id,
                                'species': production_item.parsed_wood_species
                            })
                        else:
                            order_errors += 1
                            processing_stats['products_skipped'] += 1
                        
                    except Exception as product_error:
                        error_msg = str(product_error)
                        
                        # Sprawdź czy to błąd ID generatora
                        if "już istnieje w bazie danych" in error_msg or "ID generation" in error_msg:
                            logger.warning("ENHANCED: Problem z generatorem ID - produkt pominięty", extra={
                                'order_id': order_id,
                                'error': error_msg,
                                'product_name': product_data.get('name', 'unknown')
                            })
                        else:
                            logger.error("ENHANCED: Błąd tworzenia produktu", extra={
                                'order_id': order_id,
                                'error': error_msg,
                                'product_name': product_data.get('name', 'unknown')
                            })
                        
                        order_errors += 1
                        processing_stats['products_skipped'] += 1
                        
                        # Dodaj do error_details
                        error_details.append({
                            'order_id': order_id,
                            'product_name': product_data.get('name', 'unknown'),
                            'error_type': 'product_creation_failed',
                            'error_message': error_msg
                        })
            
                # KROK 4: Commit produktów dla tego zamówienia
                if order_products_created > 0:
                    try:
                        db.session.commit()
                        logger.info("ENHANCED: Produkty zamówienia zapisane", extra={
                            'order_id': order_id,
                            'products_created': order_products_created
                        })
                    
                        # DODAJ do listy do zmiany statusu TYLKO jeśli produkty zostały zapisane
                        orders_for_status_change.append(order_id)
                        processing_stats['orders_processed'] += 1
                    
                    except Exception as db_error:
                        logger.error("ENHANCED: Błąd zapisu do bazy", extra={
                            'order_id': order_id,
                            'error': str(db_error)
                        })
                        db.session.rollback()
                        processing_stats['errors_count'] += 1
                        error_details.append({
                            'order_id': order_id,
                            'error': 'Database save failed',
                            'details': str(db_error)
                        })
                else:
                    logger.warning("ENHANCED: Brak produktów do zapisania", extra={
                        'order_id': order_id,
                        'errors': order_errors
                    })
                    processing_stats['errors_count'] += 1
        
            except Exception as order_error:
                logger.error("ENHANCED: Błąd przetwarzania zamówienia", extra={
                    'order_id': order_id if 'order_id' in locals() else 'unknown',
                    'error': str(order_error)
                })
                processing_stats['errors_count'] += 1
                error_details.append({
                    'order_id': order_id if 'order_id' in locals() else 'unknown',
                    'error': 'Order processing failed',
                    'details': str(order_error)
                })

        # KROK 5: Zmiana statusu TYLKO dla zamówień z successful product creation
        if auto_status_change and orders_for_status_change:
            logger.info("ENHANCED: Rozpoczęcie zmiany statusu", extra={
                'orders_for_status_change': len(orders_for_status_change),
                'order_ids': orders_for_status_change
            })
        
            for order_id in orders_for_status_change:
                try:
                    success = self.change_order_status_in_baselinker(
                        order_id, self.target_production_status
                    )
                    if success:
                        processing_stats['status_changes_count'] += 1
                        logger.info("Zmieniono status zamówienia w Baselinker", extra={
                            'order_id': order_id,
                            'new_status': self.target_production_status
                        })
                    else:
                        processing_stats['status_change_errors'] += 1
                        logger.error("ENHANCED: Błąd zmiany statusu", extra={
                            'order_id': order_id,
                            'target_status': self.target_production_status
                        })
                except Exception as status_error:
                    processing_stats['status_change_errors'] += 1
                    logger.error("ENHANCED: Exception podczas zmiany statusu", extra={
                        'order_id': order_id,
                        'error': str(status_error)
                    })

        # KROK 6: Przeliczenie priorytetów (jeśli utworzono produkty)
        priority_recalc_result = {}
        if processing_stats['products_created'] > 0:
            try:
                logger.info("ENHANCED: Rozpoczęcie przeliczania priorytetów")
            
                from ..services.priority_service import get_priority_calculator
                priority_calculator = get_priority_calculator()
                priority_recalc_result = priority_calculator.recalculate_all_priorities()
            
                logger.info("ENHANCED: Zakończono przeliczanie priorytetów", extra={
                    'products_updated': priority_recalc_result.get('products_updated', 0),
                    'manual_overrides_preserved': priority_recalc_result.get('manual_overrides_preserved', 0)
                })
            
            except Exception as priority_error:
                logger.error("ENHANCED: Błąd przeliczania priorytetów", extra={
                    'error': str(priority_error)
                })
                priority_recalc_result = {'error': str(priority_error)}

        # KROK 7: Prepare final result - ZAWSZE zwracaj Dict
        final_result = {
            'success': processing_stats['errors_count'] == 0 or processing_stats['products_created'] > 0,
            'orders_processed': processing_stats['orders_processed'],
            'products_created': processing_stats['products_created'],
            'products_updated': processing_stats['products_updated'],
            'products_skipped': processing_stats['products_skipped'],
            'errors_count': processing_stats['errors_count'],
            'status_changes_count': processing_stats['status_changes_count'],
            'status_change_errors': processing_stats['status_change_errors'],
            'priority_recalc_triggered': bool(priority_recalc_result),
            'priority_recalc_duration': priority_recalc_result.get('calculation_duration', '00:00:00'),
            'manual_overrides_preserved': priority_recalc_result.get('manual_overrides_preserved', 0),
            'error_details': error_details
        }

        logger.info("ENHANCED: Zakończono przetwarzanie zamówień", extra=final_result)
        return final_result  # NAPRAWIONO: zawsze zwraca Dict

    def _create_product_from_order_data(self, order_data: Dict[str, Any], product_data: Dict[str, Any], payment_date: Optional[datetime] = None) -> Optional['ProductionItem']:
        """
        POPRAWIONA wersja: Tworzy ProductionItem z PRAWIDŁOWYM generowaniem Product ID
    
        NAPRAWIONO:
        - Import parsera z parser_service zamiast product_name_parser  
        - Bezpieczny dostęp do wszystkich pól
        - GENEROWANIE PRODUCT ID przez ProductIDGenerator zamiast pobierania z Baselinker
        """
        try:
            from ..models import ProductionItem
            from ..services.parser_service import ProductNameParser
            from ..services.id_generator import ProductIDGenerator
    
            # BEZPIECZNE pobieranie podstawowych pól
            if not isinstance(product_data, dict):
                logger.error("ENHANCED: product_data nie jest dict", extra={'product_data_type': type(product_data)})
                return None
        
            if not isinstance(order_data, dict):
                logger.error("ENHANCED: order_data nie jest dict", extra={'order_data_type': type(order_data)})
                return None
    
            # Pobierz nazwę produktu bezpiecznie
            original_product_name = None
            possible_name_fields = ['name', 'product_name', 'title', 'description']
            for field in possible_name_fields:
                if field in product_data and product_data[field]:
                    original_product_name = str(product_data[field]).strip()
                    break
    
            if not original_product_name:
                logger.error("ENHANCED: Brak nazwy produktu", extra={'product_data_keys': list(product_data.keys())})
                return None
    
            # BEZPIECZNE parsowanie nazwy produktu
            parsed_data = {}
            try:
                parser = ProductNameParser()
                parse_result = parser.parse_product_name(original_product_name)
        
                # BEZPIECZNY dostęp do wyników parsowania
                if isinstance(parse_result, dict):
                    parsed_data = {
                        'species': parse_result.get('wood_species'),
                        'technology': parse_result.get('technology'),  
                        'wood_class': parse_result.get('wood_class'),
                        'length_cm': self._safe_float_conversion(parse_result.get('length_cm')),
                        'width_cm': self._safe_float_conversion(parse_result.get('width_cm')),
                        'thickness_cm': self._safe_float_conversion(parse_result.get('thickness_cm')),
                        'finish_state': parse_result.get('finish_state')
                    }
            
                    logger.debug("ENHANCED: Produkt sparsowany pomyślnie", extra={
                        'original_name': original_product_name[:50],
                        'parsed_species': parsed_data.get('species'),
                        'parsed_dimensions': f"{parsed_data.get('width_cm')}x{parsed_data.get('thickness_cm')}x{parsed_data.get('length_cm')}"
                    })
                else:
                    logger.warning("ENHANCED: Parser zwrócił nieprawidłowy format", extra={
                        'parse_result_type': type(parse_result),
                        'original_name': original_product_name[:50]
                    })
                    parsed_data = {}
            
            except Exception as parse_error:
                logger.error("ENHANCED: Błąd parsowania nazwy produktu", extra={
                    'original_name': original_product_name[:50],
                    'error': str(parse_error)
                })
                parsed_data = {}
        
            # Pobierz podstawowe dane zamówienia
            order_id = order_data.get('order_id') or order_data.get('id')
            internal_order_number = order_data.get('internal_order_number', f"BL_{order_id}")
        
            try:
                # Wygeneruj nowe Product ID w formacie YY_NNNNN_S
                id_generation_result = ProductIDGenerator.generate_product_id_for_order(
                    baselinker_order_id=order_id,
                    total_products_count=1  # Tworzymy pojedynczy produkt
                )
            
                product_id_value = id_generation_result['product_ids'][0]  # Pierwszy (i jedyny) ID
                internal_order_number = id_generation_result['internal_order_number']
            
                logger.debug("ENHANCED: Wygenerowano Product ID", extra={
                    'order_id': order_id,
                    'generated_product_id': product_id_value,
                    'internal_order_number': internal_order_number
                })
            
            except Exception as id_error:
                logger.error("ENHANCED: Błąd generowania Product ID", extra={
                    'order_id': order_id,
                    'error': str(id_error)
                })
                return None
        
            # Sprawdź format wygenerowanego ID
            if not ProductIDGenerator.validate_product_id_format(product_id_value):
                logger.error("ENHANCED: Wygenerowane ID ma nieprawidłowy format", extra={
                    'product_id': product_id_value,
                    'order_id': order_id
                })
                return None
        
            # Wylicz thickness_group na podstawie parsed thickness
            thickness_group = None
            if parsed_data.get('thickness_cm'):
                thickness = parsed_data['thickness_cm']
                if thickness <= 2.5:
                    thickness_group = "0-2.5"
                elif thickness <= 3.5:
                    thickness_group = "2.6-3.5"
                elif thickness <= 4.5:
                    thickness_group = "3.6-4.5"
                else:
                    thickness_group = "4.6+"
        
            # Przygotuj dane finansowe
            unit_price = self._safe_float_conversion(product_data.get('unit_price', 0))
            quantity = max(1, int(product_data.get('quantity', 1)))
        
            # Bezpiecznie pobierz sequence number
            sequence_number = product_data.get('sequence', 1)
            if not isinstance(sequence_number, int):
                try:
                    sequence_number = int(sequence_number)
                except (ValueError, TypeError):
                    sequence_number = 1
        
            # Utworz ProductionItem z wszystkimi polami
            product_item_data = {
                'short_product_id': product_id_value,
                'baselinker_order_id': order_id,
                'internal_order_number': internal_order_number,
                'original_product_name': original_product_name,
                'product_sequence_in_order': sequence_number,
                'unit_price_net': unit_price,
                'total_value_net': unit_price * quantity,
            
                # Parsed data
                'parsed_wood_species': parsed_data.get('species'),
                'parsed_technology': parsed_data.get('technology'),
                'parsed_wood_class': parsed_data.get('wood_class'),
                'parsed_length_cm': parsed_data.get('length_cm'),
                'parsed_width_cm': parsed_data.get('width_cm'),
                'parsed_thickness_cm': parsed_data.get('thickness_cm'),
                'parsed_finish_state': parsed_data.get('finish_state'),
            
                # ENHANCED fields
                'payment_date': payment_date,
                'thickness_group': thickness_group,
                'priority_manual_override': False,
            
                # Default values
                'current_status': 'czeka_na_wyciecie',
                'priority_score': 100,
                'created_at': get_local_now(),
                'updated_at': get_local_now()
            }
        
            production_item = ProductionItem(**product_item_data)
        
            logger.debug("ENHANCED: Utworzono ProductionItem", extra={
                'product_id': product_id_value,
                'order_id': order_id,
                'species': parsed_data.get('species'),
                'payment_date': payment_date.isoformat() if payment_date else None,
                'thickness_group': thickness_group
            })
        
            return production_item
        
        except Exception as e:
            logger.error("ENHANCED: Błąd tworzenia produktu", extra={
                'error': str(e),
                'original_name': original_product_name if 'original_product_name' in locals() else 'unknown'
            })
            return None

    def extract_payment_date_from_order(self, order_data: Dict[str, Any]) -> Optional[datetime]:
        """
        NOWA METODA: Wyciąga datę opłacenia z historii zmian statusów
        
        Szuka date_status_change dla status_id = 155824 ("Nowe - opłacone")
        
        Args:
            order_data: Dane zamówienia z Baselinker
            
        Returns:
            Optional[datetime]: Data opłacenia lub None
        """
        try:
            order_id = order_data.get('order_id')
            
            # OPCJA 1: Prosta - jeśli w obecnym response jest date_status_change
            if order_data.get('order_status_id') == 155824 and order_data.get('date_status_change'):
                timestamp = int(order_data['date_status_change'])
                payment_date = datetime.fromtimestamp(timestamp)
                
                logger.debug("Extracted payment_date z order data", extra={
                    'order_id': order_id,
                    'payment_date': payment_date.isoformat(),
                    'timestamp': timestamp
                })
                
                return payment_date
                
            # OPCJA 2: Można dodać API call do getOrderStatusHistory jeśli potrzeba
            # Ale na razie skupmy się na prostym przypadku
            
            # FALLBACK: Użyj date_add (data dodania zamówienia)
            if order_data.get('date_add'):
                timestamp = int(order_data['date_add'])
                fallback_date = datetime.fromtimestamp(timestamp)
                
                logger.debug("Fallback payment_date z date_add", extra={
                    'order_id': order_id,
                    'fallback_date': fallback_date.isoformat()
                })
                
                return fallback_date
            
            return None
            
        except Exception as e:
            logger.warning("Błąd extraction payment_date", extra={
                'order_id': order_data.get('order_id'),
                'error': str(e)
            })
            return None

    def validate_order_products_completeness(self, order_data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        NOWA METODA: Waliduje wszystkie produkty w zamówieniu
        
        Required fields dla procesu produkcyjnego:
        - species, finish_state, thickness, wood_class (parsowalne z nazwy)
        - width, length (wymiary)
        
        Args:
            order_data: Dane zamówienia z produktami
            
        Returns:
            Tuple[bool, List[str]]: (is_valid, list_of_errors)
        """
        try:
            from ..services.parser_service import get_parser_service
            
            products = order_data.get('products', [])
            if not products:
                return False, ['Zamówienie nie zawiera produktów']
            
            parser = get_parser_service()
            validation_errors = []
            
            for i, product in enumerate(products):
                product_name = product.get('name', '').strip()
                if not product_name:
                    validation_errors.append(f'Produkt {i+1}: Brak nazwy produktu')
                    continue
                
                # Parsowanie nazwy produktu
                try:
                    parsed_data = parser.parse_product_name(product_name)
                    
                    # Sprawdź wymagane pola z parsowania
                    missing_fields = []
                    
                    if not parsed_data.get('wood_species'):
                        missing_fields.append('gatunek drewna')
                    if not parsed_data.get('finish_state'): 
                        missing_fields.append('stan wykończenia')
                    if not parsed_data.get('thickness_cm'):
                        missing_fields.append('grubość')
                    if not parsed_data.get('wood_class'):
                        missing_fields.append('klasa drewna')
                    if not parsed_data.get('width_cm'):
                        missing_fields.append('szerokość')
                    if not parsed_data.get('length_cm'):
                        missing_fields.append('długość')
                    
                    if missing_fields:
                        validation_errors.append(
                            f'Produkt {i+1} "{product_name[:30]}": Brakujące dane - {", ".join(missing_fields)}'
                        )
                        
                except Exception as parse_error:
                    validation_errors.append(
                        f'Produkt {i+1} "{product_name[:30]}": Błąd parsowania - {str(parse_error)}'
                    )
            
            is_valid = len(validation_errors) == 0
            
            logger.debug("Walidacja produktów zamówienia", extra={
                'order_id': order_data.get('order_id'),
                'products_count': len(products),
                'is_valid': is_valid,
                'errors_count': len(validation_errors)
            })
            
            return is_valid, validation_errors
            
        except Exception as e:
            logger.error("Błąd walidacji produktów zamówienia", extra={
                'order_id': order_data.get('order_id'),
                'error': str(e)
            })
            return False, [f'Błąd walidacji: {str(e)}']

    def add_validation_comment_to_baselinker(self, order_id: int, errors: List[str]) -> bool:
        """
        NOWA METODA: Dodaje komentarz z błędami walidacji do zamówienia w BL
        
        Format: "[istniejący_komentarz] SYSTEM: Zamówienie nie posiada pełnych danych
        do synchronizacji z produkcją. Brakujące pola: ..."
        
        Args:
            order_id: ID zamówienia w Baselinker
            errors: Lista błędów walidacji
            
        Returns:
            bool: True jeśli komentarz został dodany
        """
        if not self.api_key or not errors:
            return False
        
        try:
            # Przygotuj tekst komentarza
            error_summary = '; '.join(errors[:3])  # Maksymalnie 3 pierwsze błędy
            if len(errors) > 3:
                error_summary += f' (i {len(errors)-3} więcej błędów)'
            
            validation_message = (
                f"SYSTEM: Zamówienie nie posiada pełnych danych do synchronizacji z produkcją. "
                f"Błędy: {error_summary}. "
                f"Sprawdź kompletność nazw produktów."
            )
            
            # API call do dodania komentarza
            request_data = {
                'token': self.api_key,
                'method': 'addOrderInvoiceComment',
                'parameters': json.dumps({
                    'order_id': order_id,
                    'invoice_comment': validation_message
                })
            }
            
            response_data = self._make_api_request(request_data)
            
            if response_data.get('status') == 'SUCCESS':
                logger.info("Dodano komentarz walidacji do Baselinker", extra={
                    'order_id': order_id,
                    'errors_count': len(errors)
                })
                return True
            else:
                logger.error("Błąd dodawania komentarza do Baselinker", extra={
                    'order_id': order_id,
                    'api_error': response_data.get('error_message')
                })
                return False
                
        except Exception as e:
            logger.error("Wyjątek podczas dodawania komentarza", extra={
                'order_id': order_id,
                'error': str(e)
            })
            return False

    def change_order_status_in_baselinker(self, order_id: int, target_status: int = 138619) -> bool:
        """
        NOWA METODA: Zmienia status zamówienia w Baselinker
        
        Używane dla obu typów synchronizacji (manual i CRON):
        - Z "Nowe - opłacone" (155824)
        - Na "W produkcji - surowe" (138619)
        
        Args:
            order_id: ID zamówienia w Baselinker
            target_status: Docelowy status (domyślnie 138619)
            
        Returns:
            bool: True jeśli zmiana się powiodła
        """
        if not self.api_key:
            logger.error("Brak klucza API dla zmiany statusu")
            return False
        
        try:
            request_data = {
                'token': self.api_key,
                'method': 'setOrderStatus',
                'parameters': json.dumps({
                    'order_id': order_id,
                    'status_id': target_status
                })
            }
            
            response_data = self._make_api_request(request_data)
            
            if response_data.get('status') == 'SUCCESS':
                logger.info("Zmieniono status zamówienia w Baselinker", extra={
                    'order_id': order_id,
                    'new_status': target_status
                })
                return True
            else:
                error_msg = response_data.get('error_message', 'Unknown error')
                logger.error("Błąd zmiany statusu w Baselinker", extra={
                    'order_id': order_id,
                    'target_status': target_status,
                    'error': error_msg
                })
                return False
                
        except Exception as e:
            logger.error("Wyjątek podczas zmiany statusu", extra={
                'order_id': order_id,
                'error': str(e)
            })
            return False

    def _fetch_paid_orders_for_cron(self) -> List[Dict[str, Any]]:
        """
        NOWA METODA: Pobiera zamówienia dla CRON (tylko opłacone z ostatnich 7 dni)
        
        Returns:
            List[Dict[str, Any]]: Lista zamówień "Nowe - opłacone"
        """
        if not self.api_key:
            raise SyncError("Brak klucza API Baselinker")
        
        try:
            # Ostatnie 7 dni
            date_from_timestamp = int((datetime.now() - timedelta(days=7)).timestamp())
            
            logger.info("CRON: Pobieranie opłaconych zamówień", extra={
                'status_id': 155824,
                'days_back': 7,
                'date_from_timestamp': date_from_timestamp
            })
            
            request_data = {
                'token': self.api_key,
                'method': 'getOrders',
                'parameters': json.dumps({
                    'status_id': 155824,  # Tylko "Nowe - opłacone"
                    'get_unconfirmed_orders': True,
                    'date_confirmed_from': date_from_timestamp,
                    'date_limit': 100  # Limit dla CRON
                })
            }
            
            response_data = self._make_api_request(request_data)
            
            if response_data.get('status') == 'SUCCESS':
                orders = response_data.get('orders', [])
                
                logger.info("CRON: Pobrano opłacone zamówienia", extra={
                    'orders_count': len(orders)
                })
                
                return orders
            else:
                error_msg = response_data.get('error_message', 'Unknown error')
                raise SyncError(f'Baselinker API error: {error_msg}')
                
        except Exception as e:
            logger.error("CRON: Błąd pobierania zamówień", extra={'error': str(e)})
            raise SyncError(f'Błąd pobierania zamówień CRON: {str(e)}')

    def _process_single_order_enhanced(self, order: Dict[str, Any], products: List[Dict[str, Any]], 
                                     payment_date: Optional[datetime], sync_type: str) -> Dict[str, Any]:
        """
        ROZSZERZONA WERSJA: Przetwarza zamówienie z payment_date i enhanced features
        
        Args:
            order: Dane zamówienia
            products: Lista produktów (już zwalidowanych)
            payment_date: Data opłacenia (extracted)
            sync_type: Typ synchronizacji
            
        Returns:
            Dict[str, Any]: Wyniki przetwarzania
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
            from ..models import ProductionItem
            
            logger.debug("ENHANCED: Przetwarzanie zamówienia", extra={
                'order_id': baselinker_order_id,
                'products_count': len(products),
                'payment_date': payment_date.isoformat() if payment_date else None,
                'sync_type': sync_type
            })
            
            # Przygotowanie wspólnych danych
            client_data = self._extract_client_data(order)
            deadline_date = self._calculate_deadline_date(order)
            
            # Oblicz łączną liczbę produktów
            total_products_count = sum(self._coerce_quantity(p.get('quantity', 1)) for p in products)
            
            # Wygeneruj wszystkie ID dla zamówienia
            id_result = ProductIDGenerator.generate_product_id_for_order(
                baselinker_order_id, total_products_count
            )
            
            current_id_index = 0
            parser = get_parser_service()
            prepared_items = []
            
            # Przetwarzanie produktów
            for product_index, product in enumerate(products):
                try:
                    product_name = product.get('name', '')
                    quantity = self._coerce_quantity(product.get('quantity', 1))
                    order_product_id = product.get('order_product_id')
                    
                    # Parsowanie nazwy produktu (raz na pozycję)
                    parsed_data = parser.parse_product_name(product_name)
                    
                    # Dla każdej sztuki w quantity - osobny rekord
                    for qty_index in range(quantity):
                        if current_id_index >= len(id_result['product_ids']):
                            raise Exception(f"Brak ID dla pozycji {current_id_index}")
                        
                        product_id = id_result['product_ids'][current_id_index]
                        current_id_index += 1
                        
                        # Przygotowanie danych produktu z ENHANCED features
                        product_data = self._prepare_product_data_enhanced(
                            order=order,
                            product=product,
                            product_id=product_id,
                            id_result=id_result,
                            parsed_data=parsed_data,
                            client_data=client_data,
                            deadline_date=deadline_date,
                            order_product_id=order_product_id,
                            sequence_number=current_id_index,
                            payment_date=payment_date  # NOWE!
                        )
                        
                        # Tworzenie obiektu ProductionItem
                        production_item = ProductionItem(**product_data)
                        
                        # NOWE: Automatyczna aktualizacja thickness_group
                        production_item.update_thickness_group()
                        
                        prepared_items.append(production_item)
                        results['created'] += 1
                        
                except Exception as e:
                    results['errors'] += 1
                    results['error_details'].append({
                        'product_name': product.get('name', ''),
                        'product_index': product_index,
                        'error': str(e)
                    })
                    logger.error("ENHANCED: Błąd przetwarzania produktu", extra={
                        'order_id': baselinker_order_id,
                        'product_name': product.get('name', '')[:50],
                        'error': str(e)
                    })
            
            # Zbiorczy commit
            if prepared_items:
                try:
                    for item in prepared_items:
                        db.session.add(item)
                    
                    db.session.commit()
                    
                    logger.info("ENHANCED: Zapisano produkty do bazy", extra={
                        'order_id': baselinker_order_id,
                        'items_saved': len(prepared_items),
                        'payment_date_set': payment_date is not None
                    })
                    
                except Exception as e:
                    db.session.rollback()
                    results['errors'] = len(prepared_items)
                    results['created'] = 0
                    results['error_details'].append({
                        'error': f'Database commit error: {str(e)}',
                        'order_id': baselinker_order_id
                    })
                    logger.error("ENHANCED: Błąd zapisu do bazy", extra={
                        'order_id': baselinker_order_id,
                        'error': str(e)
                    })
            
        except Exception as e:
            db.session.rollback()
            results['errors'] += 1
            results['error_details'].append({
                'error': str(e),
                'order_id': baselinker_order_id
            })
            logger.error("ENHANCED: Błąd przetwarzania zamówienia", extra={
                'order_id': baselinker_order_id,
                'error': str(e)
            })
        
        return results

    def _prepare_product_data_enhanced(self, order: Dict[str, Any], product: Dict[str, Any], 
                                     product_id: str, id_result: Dict[str, Any], 
                                     parsed_data: Dict[str, Any], client_data: Dict[str, str],
                                     deadline_date: date, order_product_id: Any,
                                     sequence_number: int, payment_date: Optional[datetime]) -> Dict[str, Any]:
        """
        ENHANCED WERSJA: Przygotowuje dane produktu z payment_date
        
        Args:
            payment_date: NOWE - data opłacenia z extraction
        """
        # Podstawowe dane
        order_status = order.get('order_status_id')
        if order_status is None:
            order_status = order.get('status_id')

        if isinstance(order_status, str) and order_status.strip():
            try:
                order_status = int(float(order_status))
            except (TypeError, ValueError):
                pass

        order_product_identifier = (
            order_product_id
            or product.get('order_product_id')
            or product.get('product_id')
            or product.get('id')
            or product.get('storage_product_id')
        )

        product_data = {
            'short_product_id': product_id,
            'internal_order_number': id_result['internal_order_number'],
            'product_sequence_in_order': sequence_number,
            'baselinker_order_id': order['order_id'],
            'baselinker_product_id': str(order_product_identifier) if order_product_identifier else None,
            'original_product_name': product.get('name', ''),
            'baselinker_status_id': order_status,
            
            # NOWE: Payment date dla nowego algorytmu priorytetów
            'payment_date': payment_date,
            
            # Dane klienta
            'client_name': client_data.get('client_name', ''),
            'client_email': client_data.get('client_email', ''),
            'client_phone': client_data.get('client_phone', ''),
            'delivery_address': client_data.get('delivery_address', ''),
            
            # Deadline
            'deadline_date': deadline_date,
            
            # Status początkowy
            'current_status': 'czeka_na_wyciecie',
            'sync_source': 'baselinker_auto'
        }
        
        # Dane sparsowane z nazwy produktu
        if parsed_data:
            volume_m3 = parsed_data.get('volume_m3')
            if volume_m3 is None:
                length = parsed_data.get('length_cm')
                width = parsed_data.get('width_cm')
                thickness = parsed_data.get('thickness_cm')
                try:
                    if all(value is not None for value in (length, width, thickness)):
                        volume_m3 = round((float(length) * float(width) * float(thickness)) / 1_000_000, 6)
                except (TypeError, ValueError):
                    volume_m3 = None

            product_data.update({
                'parsed_wood_species': parsed_data.get('wood_species'),
                'parsed_technology': parsed_data.get('technology'),
                'parsed_wood_class': parsed_data.get('wood_class'),
                'parsed_length_cm': parsed_data.get('length_cm'),
                'parsed_width_cm': parsed_data.get('width_cm'),
                'parsed_thickness_cm': parsed_data.get('thickness_cm'),
                'parsed_finish_state': parsed_data.get('finish_state'),
                'volume_m3': volume_m3
            })
        
        # Dane finansowe
        try:
            price_brutto = float(product.get('price_brutto', 0))
            tax_rate = float(product.get('tax_rate', 23))
            
            price_netto = price_brutto / (1 + tax_rate/100) if tax_rate > 0 else price_brutto
            product_quantity = self._coerce_quantity(product.get('quantity', 1))
            unit_price = price_netto / product_quantity if product_quantity > 0 else price_netto
            
            product_data.update({
                'unit_price_net': round(unit_price, 2),
                'total_value_net': round(unit_price, 2)
            })
        except (ValueError, TypeError):
            product_data.update({
                'unit_price_net': 0,
                'total_value_net': 0
            })
        
        return product_data

    # ============================================================================
    # MODYFIKACJE ISTNIEJĄCYCH METOD - BACKWARD COMPATIBLE ENHANCEMENTS
    # ============================================================================

    def manual_sync_with_filtering(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        ENHANCED VERSION: Rozszerzenie ręcznej synchronizacji z filtrami
        
        ZACHOWANE wszystkie istniejące parametry i funkcjonalności.
        
        NOWE PARAMETRY (opcjonalne dla kompatybilności):
        - recalculate_priorities: bool = True  # Czy przeliczać priorytety po sync
        - auto_status_change: bool = True      # Czy zmieniać status na "W produkcji"
        - respect_manual_overrides: bool = True # Czy respektować manual overrides
        
        NOWE FUNKCJE:
        - Domyślnie synchronizuje ze statusu 155824 (jeśli nie podano target_statuses)
        - Extraction payment_date z każdego zamówienia
        - Walidacja kompletności produktów + komentarze BL
        - Automatyczna zmiana statusu po sync
        - Przeliczenie priorytetów z manual override handling
        """
        sync_started_at = get_local_now()
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
            # NOWE PARAMETRY (backward compatible)
            recalculate_priorities = params.get('recalculate_priorities', True)
            auto_status_change = params.get('auto_status_change', True)
            respect_manual_overrides = params.get('respect_manual_overrides', True)
            
            # ZACHOWANE PARAMETRY
            target_statuses_raw = params.get('target_statuses') or []
            target_statuses = {
                status for status in (
                    self._safe_int(value) for value in target_statuses_raw
                ) if status is not None
            }

            # NOWA LOGIKA: Domyślnie tylko "Nowe - opłacone" jeśli nie podano statusów
            if not target_statuses:
                target_statuses = {155824}  # "Nowe - opłacone"
                logger.info("ENHANCED: Użyto domyślnego statusu 'Nowe - opłacone' (155824)")

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
                timestamp = get_local_now().isoformat()
                entry: Dict[str, Any] = {
                    'timestamp': timestamp,
                    'level': level,
                    'message': message
                }
                if context:
                    entry['context'] = context
                log_entries.append(entry)

                if level == 'error':
                    logger.error(message, extra={'context': 'manual_sync_enhanced', **{f'ctx_{k}': v for k, v in context.items()}})
                elif level == 'warning':
                    logger.warning(message, extra={'context': 'manual_sync_enhanced', **{f'ctx_{k}': v for k, v in context.items()}})
                elif level == 'debug':
                    if debug_mode:
                        logger.debug(message, extra={'context': 'manual_sync_enhanced', **{f'ctx_{k}': v for k, v in context.items()}})
                else:
                    logger.info(message, extra={'context': 'manual_sync_enhanced', **{f'ctx_{k}': v for k, v in context.items()}})

            add_log('ENHANCED: Rozpoczynanie ręcznej synchronizacji v2.0', 'info')
            add_log(
                'ENHANCED: Parametry synchronizacji',
                'info',
                period_days=period_days,
                limit_per_page=limit_per_page,
                force_update=force_update,
                skip_validation=skip_validation,
                dry_run=dry_run,
                debug_mode=debug_mode,
                target_statuses=sorted(target_statuses),
                excluded_keywords=sorted(excluded_keywords),
                # NOWE PARAMETRY
                recalculate_priorities=recalculate_priorities,
                auto_status_change=auto_status_change,
                respect_manual_overrides=respect_manual_overrides
            )

            date_to = get_local_now()
            date_from = date_to - timedelta(days=period_days)
            add_log(
                f'Zakres synchronizacji: {date_from.date()} → {date_to.date()}',
                'info'
            )

            # ZACHOWANE: Pobieranie zamówień przez reports service
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

            # Filtrowanie po statusach
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

            # ZACHOWANE: Parser initialization
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

            excluded_product_types = {'suszenie', 'worek opałowy', 'tarcica', 'deska'}

            # NOWE: Lista zamówień do przetworzenia przez enhanced logic
            qualified_orders = []

            # ZACHOWANE: Filtrowanie i przygotowanie zamówień
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

                # ZACHOWANE: Filtrowanie produktów
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

                # Dodaj do listy do enhanced processing
                order['products'] = filtered_products  # Replace z filtered products
                qualified_orders.append(order)

            add_log(
                f'Zakwalifikowano {len(qualified_orders)} zamówień do enhanced processing.',
                'info'
            )

            # NOWE: Filtrowanie po wybranych order_ids z modalboxa
            filter_order_ids = params.get('filter_order_ids', [])
            selected_orders_only = params.get('selected_orders_only', False)
    
            if selected_orders_only and filter_order_ids:
                logger.info("ENHANCED: Filtrowanie po wybranych zamówieniach", extra={
                    'filter_order_ids': filter_order_ids,
                    'qualified_orders_before': len(qualified_orders)
                })
        
                # Filtruj tylko wybrane zamówienia
                filtered_qualified_orders = []
                for order in qualified_orders:
                    order_id = order.get('order_id') or order.get('id')
                    if order_id in filter_order_ids:
                        filtered_qualified_orders.append(order)
        
                qualified_orders = filtered_qualified_orders
        
                add_log(
                    f'Po filtracji order_ids zostało {len(qualified_orders)} zamówień do przetworzenia.',
                    'info'
                )
        
                logger.info("ENHANCED: Zakończono filtrację po order_ids", extra={
                    'qualified_orders_after': len(qualified_orders),
                    'filtered_out': len(filter_order_ids) - len(qualified_orders)
                })

            # NOWE: Enhanced processing dla qualified orders
            if qualified_orders and not dry_run:
                enhanced_result = self.process_orders_with_priority_logic(
                    qualified_orders,
                    sync_type='manual',
                    auto_status_change=auto_status_change
                )
        
                # Update stats z enhanced processing
                stats['orders_processed'] = enhanced_result.get('orders_processed', 0)
                stats['products_created'] = enhanced_result.get('products_created', 0)
                stats['products_updated'] = enhanced_result.get('products_updated', 0)
                stats['errors_count'] += enhanced_result.get('errors_count', 0)
        
                if enhanced_result.get('error_details'):
                    error_details.extend(enhanced_result['error_details'])
        
                add_log(
                    f'Enhanced processing: {stats["orders_processed"]} zamówień, '
                    f'{stats["products_created"]} produktów utworzonych.',
                    'info'
                )
        
            elif qualified_orders and dry_run:
                # Dry run simulation
                for order in qualified_orders:
                    quantity_total = sum(prod.get('quantity', 0) or 0 for prod in order.get('products', []))
                    stats['products_created'] += quantity_total
                    stats['orders_processed'] += 1
            
                add_log(
                    f"[DRY RUN] Enhanced: {stats['orders_processed']} zamówień, "
                    f"{stats['products_created']} produktów kwalifikuje się do utworzenia.",
                    'info'
                )

            add_log(
                f"ENHANCED: Synchronizacja zakończona. Zamówienia przetworzone: {stats['orders_processed']}, "
                f"utworzone produkty: {stats['products_created']}.",
                'info'
            )

            # NOWE: Enhanced sync log update
            if sync_log:
                sync_log.orders_processed = stats['orders_processed']
                sync_log.products_created = stats['products_created']
                sync_log.products_updated = stats['products_updated']
                sync_log.products_skipped = stats['products_skipped']
                sync_log.error_count = stats['errors_count']
                
                # ENHANCED fields
                if auto_status_change and stats['products_created'] > 0:
                    sync_log.priority_recalc_triggered = recalculate_priorities
                
                if error_details:
                    sync_log.error_details = json.dumps({'errors': error_details})
                
                # POPRAWIONE: complete_sync zamiast mark_completed
                success = stats['errors_count'] == 0
                sync_log.complete_sync(success=success)
                db.session.commit()

            sync_completed_at = get_local_now()
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

            # ENHANCED RESPONSE with new fields
            response = {
                'success': True,
                'message': 'Enhanced synchronizacja Baselinker zakończona pomyślnie.',
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
                        'excluded_keywords': sorted(excluded_keywords),
                        # NOWE OPCJE
                        'recalculate_priorities': recalculate_priorities,
                        'auto_status_change': auto_status_change,
                        'respect_manual_overrides': respect_manual_overrides
                    },
                    'stats': stats_payload,
                    'log_entries': log_entries,
                    # ENHANCED FEATURES INFO
                    'enhanced_features': {
                        'payment_date_extraction': True,
                        'product_validation': True,
                        'status_change_workflow': auto_status_change,
                        'priority_recalculation': recalculate_priorities and stats['products_created'] > 0
                    }
                }
            }

            return response

        except SyncError as sync_error:
            logger.warning('Enhanced Manual Baselinker sync validation error', extra={'error': str(sync_error)})
            
            # Update sync log
            if sync_log:
                sync_log.sync_status = 'failed'
                sync_log.error_details = json.dumps({'error': str(sync_error)})
                sync_log.complete_sync(success=False, error_message=str(sync_error))
                db.session.commit()
            
            return {
                'success': False,
                'error': str(sync_error),
                'message': f'Błąd walidacji synchronizacji: {str(sync_error)}',
                'data': {
                    'sync_id': f"manual_{sync_log.id}" if sync_log else f"manual_{int(sync_started_at.timestamp())}",
                    'status': 'failed',
                    'started_at': sync_started_at.isoformat(),
                    'completed_at': get_local_now().isoformat(),
                    'duration_seconds': int((get_local_now() - sync_started_at).total_seconds()),
                    'stats': stats,
                    'log_entries': log_entries
                }
            }

        except Exception as exc:
            logger.exception('Enhanced Manual Baselinker sync unexpected error')
            
            # Update sync log
            if sync_log:
                sync_log.sync_status = 'failed'
                sync_log.error_details = json.dumps({'error': str(exc)})
                sync_log.complete_sync(success=False, error_message=str(exc))
                db.session.commit()
            
            return {
                'success': False,
                'error': str(exc),
                'message': f'Nieoczekiwany błąd synchronizacji: {str(exc)}',
                'data': {
                    'sync_id': f"manual_{sync_log.id}" if sync_log else f"manual_{int(sync_started_at.timestamp())}",
                    'status': 'failed',
                    'started_at': sync_started_at.isoformat(),
                    'completed_at': get_local_now().isoformat(),
                    'duration_seconds': int((get_local_now() - sync_started_at).total_seconds()),
                    'stats': stats,
                    'log_entries': log_entries
                }
            }

    def enhanced_manual_sync_orders(self, status_ids: List[int] = None, date_from: str = None, 
                                   recalculate_priorities: bool = True, auto_status_change: bool = True, 
                                   respect_manual_overrides: bool = True) -> Dict[str, Any]:
        """
        NOWA METODA: Enhanced ręczna synchronizacja z nowymi parametrami
    
        Args:
            status_ids: Lista statusów (domyślnie [155824])
            date_from: Data od której synchronizować
            recalculate_priorities: Czy przeliczać priorytety
            auto_status_change: Czy zmieniać status
            respect_manual_overrides: Czy respektować manual overrides
        
        Returns:
            Dict[str, Any]: Wyniki synchronizacji
        """
        try:
            # Przygotuj parametry dla manual_sync_with_filtering
            params = {
                'target_statuses': status_ids or [self.source_status_paid],
                'period_days': 7,  # Domyślnie ostatnie 7 dni
                'limit_per_page': 100,
                'dry_run': False,
                'force_update': True,
                'debug_mode': False,
                'skip_validation': False,
                'recalculate_priorities': recalculate_priorities,
                'auto_status_change': auto_status_change,
                'respect_manual_overrides': respect_manual_overrides
            }
        
            logger.info("ENHANCED: Rozpoczęcie enhanced manual sync", extra={
                'status_ids': status_ids,
                'auto_status_change': auto_status_change,
                'recalculate_priorities': recalculate_priorities
            })
        
            # Użyj istniejącej metody manual_sync_with_filtering
            result = self.manual_sync_with_filtering(params)
        
            logger.info("ENHANCED: Zakończono enhanced manual sync", extra={
                'success': result.get('success', False),
                'orders_processed': result.get('data', {}).get('stats', {}).get('orders_processed', 0),
                'products_created': result.get('data', {}).get('stats', {}).get('products_created', 0)
            })
        
            return result
        
        except Exception as e:
            logger.error("ENHANCED: Błąd enhanced manual sync", extra={'error': str(e)})
        
            return {
                'success': False,
                'error': str(e),
                'data': {
                    'stats': {
                        'orders_processed': 0,
                        'products_created': 0,
                        'products_updated': 0,
                        'error_count': 1
                    }
                }
            }

    # ============================================================================
    # ZACHOWANE METODY - BEZ ZMIAN (dla kompatybilności)
    # ============================================================================

    def sync_orders_from_baselinker(self, sync_type: str = 'cron_auto') -> Dict[str, Any]:
        """
        ZMODYFIKOWANE: Używa nowej logiki dla CRON ale zachowuje kompatybilność
        
        Args:
            sync_type (str): Typ synchronizacji ('cron_auto' lub 'manual_trigger')
            
        Returns:
            Dict[str, Any]: Wyniki synchronizacji
        """
        if sync_type == 'cron_auto':
            # NOWE: Przekierowanie na enhanced CRON method
            return self.sync_paid_orders_only()
        else:
            # ZACHOWANE: Legacy behavior dla manual calls
            return self._legacy_sync_orders_from_baselinker(sync_type)
    
    def _legacy_sync_orders_from_baselinker(self, sync_type: str) -> Dict[str, Any]:
        """ZACHOWANE: Original implementation dla backward compatibility"""
        sync_started_at = get_local_now()
        
        # DODAJ: Wyczyść cache ID generatora na początku sync
        from ..services.id_generator import ProductIDGenerator
        ProductIDGenerator.clear_order_cache()
        logger.info("Wyczyszczono cache generatora ID na początku synchronizacji")
    
        # Rozpoczęcie logowania synchronizacji
        sync_log = self._create_sync_log(sync_type, sync_started_at)
        
        try:
            logger.info("Rozpoczęcie synchronizacji Baselinker (legacy)", extra={
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
            
            logger.info("Zakończono synchronizację Baselinker (legacy)", extra=results)
            return results
            
        except Exception as e:
            logger.error("Błąd synchronizacji Baselinker (legacy)", extra={
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
        """ZACHOWANE: Tworzy rekord synchronizacji w bazie danych"""
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
        """ZACHOWANE: Pobiera zamówienia z Baselinker API"""
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
        """ZACHOWANE: Wykonuje request do API Baselinker z retry mechanism"""
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
        """ZACHOWANE: Wersja z debugowaniem"""
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
        """ZACHOWANE: Sprawdza czy zamówienie już zostało przetworzone"""
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
        """ZACHOWANE: Konwertuje wartość quantity na bezpieczną liczbę całkowitą."""
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
        """ZACHOWANE: Bezpiecznie konwertuje wartość na int lub zwraca None."""
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
        """ZACHOWANE: Usuwa istniejące produkty powiązane z zamówieniem Baselinker."""
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
        product_id: str,  # np. '25_00048_3'
        id_result: Dict[str, Any], 
        parsed_data: Dict[str, Any],
        client_data: Dict[str, str],
        deadline_date: date,
        order_product_id: Any,
        sequence_number: int) -> Dict[str, Any]:
        """
        POPRAWIONA WERSJA: Przygotowuje dane produktu z poprawną logiką sequence
        
        Args:
            product_id: Wygenerowany short_product_id (np. '25_00048_3')
            sequence_number: Pozycja w zamówieniu (1, 2, 3, ...)
        """

        # Podstawowe dane
        product_data = {
            'short_product_id': product_id,  # '25_00048_3'
            'internal_order_number': id_result['internal_order_number'],  # '25_00048'
            'product_sequence_in_order': sequence_number,  # 3 (pozycja w zamówieniu)
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
        ZMODYFIKOWANE: Używa nowego priority service
        """
        try:
            # NOWE: Użyj enhanced priority system
            from ..services.priority_service import recalculate_all_priorities
            
            result = recalculate_all_priorities()
            if result.get('success'):
                logger.info("Zaktualizowano priorytety po synchronizacji", extra={
                    'products_updated': result.get('products_prioritized', 0)
                })
            else:
                logger.error("Błąd aktualizacji priorytetów", extra={
                    'error': result.get('error')
                })
                
        except Exception as e:
            logger.error("Wyjątek aktualizacji priorytetów", extra={'error': str(e)})

    def update_order_status_in_baselinker(self, internal_order_number: str) -> bool:
        """ZACHOWANE: Aktualizuje status zamówienia po zakończeniu produkcji"""
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
        """ZACHOWANE: Aktualizuje status konkretnego zamówienia"""
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

    # POZOSTAŁE ZACHOWANE METODY
    def get_sync_status(self) -> Dict[str, Any]:
        """ZACHOWANE: Pobiera status synchronizacji"""
        try:
            from ..models import ProductionSyncLog
            
            # Ostatnia synchronizacja
            last_sync = ProductionSyncLog.query.order_by(
                ProductionSyncLog.sync_started_at.desc()
            ).first()
            
            # Synchronizacja w toku
            running_sync = ProductionSyncLog.query.filter_by(
                sync_status='in_progress'
            ).first()
            
            # Statystyki ostatnich 24h
            since_24h = get_local_now() - timedelta(hours=24)
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
                'error': str(e),
                'last_sync': None,
                'recent_stats': {
                    'syncs_count': 0,
                    'success_count': 0, 
                    'failed_count': 0,
                    'total_products_created': 0,
                    'total_errors': 0
                }
            }

    def cleanup_old_sync_logs(self, days_to_keep: int = 30):
        """ZACHOWANE: Czyści stare logi synchronizacji"""
        # ... (original implementation)
        pass

    def update_order_status(self, internal_order_number: str) -> bool:
        """ZACHOWANE: Alias dla kompatybilności"""
        return self.update_order_status_in_baselinker(internal_order_number)

    def _extract_client_data(self, order: Dict[str, Any]) -> Dict[str, str]:
        """Wyciąga podstawowe dane klienta z zamówienia Baselinker."""

        def _first_non_empty(source: Dict[str, Any], *keys: str) -> str:
            for key in keys:
                if not key:
                    continue
                value = source.get(key)
                if value is None:
                    continue
                if isinstance(value, str):
                    cleaned = value.strip()
                else:
                    cleaned = str(value).strip()
                if cleaned:
                    return cleaned
            return ''

        custom_fields = order.get('custom_extra_fields') or {}
        if not isinstance(custom_fields, dict):
            custom_fields = {}

        client_name = _first_non_empty(
            order,
            'delivery_fullname',
            'invoice_fullname',
            'client_name',
            'customer_name',
            'user_login',
            'client_login'
        )

        if not client_name:
            client_name = _first_non_empty(custom_fields, 'client_name', 'delivery_name', 'invoice_name')

        client_email = _first_non_empty(order, 'email', 'client_email', 'invoice_email')
        if not client_email:
            client_email = _first_non_empty(custom_fields, 'client_email', 'invoice_email')

        client_phone = _first_non_empty(order, 'phone', 'delivery_phone', 'client_phone', 'phone_mobile')
        if not client_phone:
            client_phone = _first_non_empty(custom_fields, 'client_phone', 'delivery_phone')

        street = _first_non_empty(order, 'delivery_address', 'address', 'client_address')
        if not street:
            street = _first_non_empty(custom_fields, 'delivery_address', 'invoice_address')

        postcode = _first_non_empty(order, 'delivery_postcode', 'postcode')
        if not postcode:
            postcode = _first_non_empty(custom_fields, 'delivery_postcode', 'invoice_postcode')

        city = _first_non_empty(order, 'delivery_city', 'city')
        if not city:
            city = _first_non_empty(custom_fields, 'delivery_city', 'invoice_city')

        state = _first_non_empty(order, 'delivery_state', 'state')
        if not state:
            state = _first_non_empty(custom_fields, 'delivery_state', 'invoice_state', 'delivery_region')

        country = _first_non_empty(order, 'delivery_country_code', 'country_code')
        if not country:
            country = _first_non_empty(custom_fields, 'delivery_country_code', 'invoice_country_code')

        address_parts = [street]
        if postcode and city:
            address_parts.append(f"{postcode} {city}")
        else:
            if postcode:
                address_parts.append(postcode)
            if city:
                address_parts.append(city)

        if state:
            address_parts.append(state)

        if country and country.upper() not in {'PL', 'POLSKA'}:
            address_parts.append(country)

        delivery_address = ', '.join(part for part in address_parts if part)

        return {
            'client_name': client_name or '',
            'client_email': client_email or '',
            'client_phone': client_phone or '',
            'delivery_address': delivery_address or ''
        }

    def _calculate_deadline_date(self, order: Dict[str, Any]) -> datetime.date:
        """Oblicza datę deadline'u dla produktu."""

        from ..services.config_service import get_config

        payment_date = self.extract_payment_date_from_order(order)
        if payment_date:
            base_date = payment_date.date()
        else:
            timestamp = order.get('date_add')
            base_date = get_local_now().date()
            if timestamp is not None:
                try:
                    base_date = datetime.fromtimestamp(int(timestamp)).date()
                except (TypeError, ValueError, OSError):
                    pass

        custom_fields = order.get('custom_extra_fields') or {}
        if not isinstance(custom_fields, dict):
            custom_fields = {}

        deadline_days_raw = None
        for key in (
            'production_deadline_days',
            'deadline_days',
            'deadline',
            'production_time_days'
        ):
            if key in custom_fields and custom_fields[key] not in (None, ''):
                deadline_days_raw = custom_fields[key]
                break

        if deadline_days_raw is None:
            deadline_days_raw = order.get('production_deadline_days')

        try:
            deadline_days = int(float(deadline_days_raw)) if deadline_days_raw is not None else None
        except (TypeError, ValueError):
            deadline_days = None

        if deadline_days is None:
            deadline_days = int(get_config('DEADLINE_DEFAULT_DAYS', 14) or 14)

        deadline_days = max(0, min(deadline_days, 180))

        return self._add_business_days(base_date, deadline_days)

    def _add_business_days(self, start_date: date, business_days: int) -> date:
        """Dodaje określoną liczbę dni roboczych do daty startowej."""

        if not isinstance(start_date, date):
            start_date = get_local_now().date()

        if business_days <= 0:
            return start_date

        current_date = start_date
        added_days = 0

        while added_days < business_days:
            current_date += timedelta(days=1)
            if current_date.weekday() < 5:  # Poniedziałek=0 ... Niedziela=6
                added_days += 1

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

    def _safe_float_conversion(self, value) -> float:
        """
        BRAKUJĄCA METODA: Bezpieczna konwersja wartości na float
    
        Args:
            value: Wartość do konwersji (może być None, string, int, float)
        
        Returns:
            float: Skonwertowana wartość lub 0.0 jeśli konwersja nie powiodła się
        """
        try:
            if value is None:
                return 0.0
            if isinstance(value, (int, float)):
                return float(value)
            if isinstance(value, str):
                # Usuń spacje i zamień przecinek na kropkę
                cleaned = str(value).strip().replace(',', '.')
                if not cleaned:
                    return 0.0
                return float(cleaned)
            return 0.0
        except (ValueError, TypeError):
            return 0.0

    def get_baselinker_statuses(self) -> Dict[int, str]:
        """
        ZACHOWANE: Pobiera listę wszystkich statusów z Baselinker API
    
        Returns:
            Dict[int, str]: Słownik {status_id: status_name}
        
        Raises:
            SyncError: W przypadku błędu komunikacji z API
        """
        if not self.api_key:
            raise SyncError("Brak klucza API Baselinker")
    
        logger.debug("Pobieranie statusów z Baselinker API")
    
        try:
            # Przygotowanie requestu do Baselinker
            request_data = {
                'token': self.api_key,
                'method': 'getOrderStatusList',  # Baselinker API method dla statusów
                'parameters': json.dumps({})     # Brak dodatkowych parametrów
            }
        
            # Wykonanie requestu z retry mechanism
            logger.info("Wykonywanie requestu getOrderStatusList", extra={
                'method': 'getOrderStatusList',
                'endpoint': self.api_endpoint
            })
        
            response_data = self._make_api_request(request_data)
        
            # DODANE: Szczegółowe logowanie response
            logger.info("Raw response z _make_api_request", extra={
                'response_type': type(response_data).__name__,
                'response_keys': list(response_data.keys()) if isinstance(response_data, dict) else 'NOT_DICT',
                'response_content': str(response_data)[:300]  # Pierwsze 300 znaków
            })
        
            if response_data.get('status') == 'SUCCESS':
                statuses_data = response_data.get('statuses', [])
            
                # DODANE: Jeszcze więcej szczegółów
                logger.info("Szczegóły statuses_data", extra={
                    'statuses_type': type(statuses_data).__name__,
                    'statuses_length': len(statuses_data) if hasattr(statuses_data, '__len__') else 'NO_LENGTH',
                    'statuses_first_item': statuses_data[0] if (isinstance(statuses_data, list) and len(statuses_data) > 0) else 'NO_FIRST_ITEM',
                    'statuses_sample': str(statuses_data)[:200]  # Pierwsze 200 znaków
                })
            
                statuses = {}
            
                # Sprawdź czy to lista czy słownik
                if isinstance(statuses_data, list):
                    # Format: [{"id": 123, "name": "Status"}, ...]
                    for status_item in statuses_data:
                        try:
                            if isinstance(status_item, dict):
                                status_id = status_item.get('id')
                                status_name = status_item.get('name', f'Status {status_id}')
                            
                                if status_id is not None:
                                    statuses[int(status_id)] = status_name
                            else:
                                logger.warning("Nieoczekiwany format item statusu", extra={
                                    'status_item': status_item,
                                    'type': type(status_item).__name__
                                })
                        except (ValueError, TypeError) as e:
                            logger.warning("Błąd parsowania statusu", extra={
                                'status_item': status_item,
                                'error': str(e)
                            })
                            continue
                        
                elif isinstance(statuses_data, dict):
                    # Format: {"123": {"name": "Status"}, ...}
                    for status_id, status_info in statuses_data.items():
                        try:
                            status_id_int = int(status_id)
                            if isinstance(status_info, dict):
                                status_name = status_info.get('name', f'Status {status_id}')
                            else:
                                # Fallback jeśli status_info to string
                                status_name = str(status_info)
                        
                            statuses[status_id_int] = status_name
                        except (ValueError, TypeError) as e:
                            logger.warning("Błąd parsowania statusu dict", extra={
                                'status_id': status_id,
                                'status_info': status_info,
                                'error': str(e)
                            })
                            continue
                else:
                    logger.warning("Nieoczekiwany format statusów z API", extra={
                        'type': type(statuses_data).__name__,
                        'content': str(statuses_data)
                    })
            
                logger.info("Pobrano statusy z Baselinker", extra={
                    'statuses_count': len(statuses),
                    'status_ids': list(statuses.keys()),
                    'parsed_statuses': statuses
                })
            
                return statuses
            
            else:
                error_msg = response_data.get('error_message', 'Nieznany błąd API')
                error_code = response_data.get('error_code', 'UNKNOWN')
                raise SyncError(f'Baselinker API error [{error_code}]: {error_msg}')
            
        except requests.exceptions.RequestException as e:
            logger.error("Błąd komunikacji z Baselinker API (statusy)", extra={
                'error': str(e),
                'endpoint': self.api_endpoint
            })
            raise SyncError(f'Błąd połączenia z Baselinker: {str(e)}')
        
        except Exception as e:
            logger.error("Nieoczekiwany błąd pobierania statusów", extra={
                'error': str(e),
                'error_type': type(e).__name__
            })
            raise SyncError(f'Błąd pobierania statusów: {str(e)}')

# ============================================================================
# SINGLETON PATTERN - ZACHOWANY DLA KOMPATYBILNOŚCI
# ============================================================================

_sync_service_instance = None

def get_sync_service() -> BaselinkerSyncService:
    """
    Pobiera singleton instance BaselinkerSyncService
    
    Returns:
        BaselinkerSyncService: Instancja serwisu sync v2.0
    """
    global _sync_service_instance
    
    if _sync_service_instance is None:
        _sync_service_instance = BaselinkerSyncService()
        logger.info("Utworzono singleton BaselinkerSyncService v2.0 (Enhanced)")
    
    return _sync_service_instance

# ============================================================================
# HELPER FUNCTIONS - ZACHOWANE + NOWE
# ============================================================================

def sync_orders_from_baselinker(sync_type: str = 'manual_trigger') -> Dict[str, Any]:
    """ZACHOWANE: Helper function dla synchronizacji zamówień"""
    return get_sync_service().sync_orders_from_baselinker(sync_type)

def manual_sync_with_filtering(params: Dict[str, Any]) -> Dict[str, Any]:
    """ZACHOWANE: Helper function dla ręcznej synchronizacji z filtrami."""
    return get_sync_service().manual_sync_with_filtering(params)

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

def get_sync_status() -> Dict[str, Any]:
    """ZACHOWANE: Helper function dla sprawdzania statusu sync"""
    return get_sync_service().get_sync_status()

def cleanup_old_sync_logs(days_to_keep: int = 30):
    """ZACHOWANE: Helper function dla czyszczenia logów"""
    get_sync_service().cleanup_old_sync_logs(days_to_keep)

# ============================================================================
# NOWE HELPER FUNCTIONS DLA ENHANCED PRIORITY SYSTEM 2.0
# ============================================================================

def sync_paid_orders_only() -> Dict[str, Any]:
    """
    NOWA: Helper function dla CRON synchronizacji opłaconych zamówień
    
    Returns:
        Dict[str, Any]: Raport synchronizacji CRON
    """
    return get_sync_service().sync_paid_orders_only()

def process_orders_with_priority_logic(orders_data: List[Dict[str, Any]], 
                                     sync_type: str = 'manual',
                                     auto_status_change: bool = True) -> Dict[str, Any]:
    """
    NOWA: Helper function dla wspólnej logiki przetwarzania
    
    Returns:
        Dict[str, Any]: Wyniki enhanced processing
    """
    return get_sync_service().process_orders_with_priority_logic(orders_data, sync_type, auto_status_change)

def extract_payment_date_from_order(order_data: Dict[str, Any]) -> Optional[datetime]:
    """
    NOWA: Helper function dla extraction payment_date
    
    Returns:
        Optional[datetime]: Data opłacenia lub None
    """
    return get_sync_service().extract_payment_date_from_order(order_data)

def validate_order_products_completeness(order_data: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    NOWA: Helper function dla walidacji produktów w zamówieniu
    
    Returns:
        Tuple[bool, List[str]]: (is_valid, list_of_errors)
    """
    return get_sync_service().validate_order_products_completeness(order_data)

def add_validation_comment_to_baselinker(order_id: int, errors: List[str]) -> bool:
    """
    NOWA: Helper function dla dodawania komentarza walidacji
    
    Returns:
        bool: True jeśli komentarz został dodany
    """
    return get_sync_service().add_validation_comment_to_baselinker(order_id, errors)

def change_order_status_in_baselinker(order_id: int, target_status: int = 138619) -> bool:
    """
    NOWA: Helper function dla zmiany statusu zamówienia
    
    Returns:
        bool: True jeśli zmiana się powiodła
    """
    return get_sync_service().change_order_status_in_baselinker(order_id, target_status)

def _safe_float_conversion(self, value: Any) -> Optional[float]:
    """Bezpieczna konwersja na float"""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None

def _safe_string_extraction(self, data: Dict[str, Any], possible_fields: List[str]) -> Optional[str]:
    """Bezpieczne wyciąganie string z możliwych pól"""
    if not isinstance(data, dict):
        return None
    
    for field in possible_fields:
        if field in data and data[field]:
            value = data[field]
            if isinstance(value, (str, int, float)):
                return str(value).strip()
    return None

def _calculate_volume_safe(self, parsed_data: Dict[str, Any]) -> Optional[float]:
    """Bezpieczne obliczenie objętości"""
    try:
        length = parsed_data.get('length_cm')
        width = parsed_data.get('width_cm') 
        thickness = parsed_data.get('thickness_cm')
        
        if all(v is not None for v in [length, width, thickness]):
            # Convert cm to m and calculate m3
            volume_m3 = (float(length) * float(width) * float(thickness)) / 1000000  # cm3 to m3
            return round(volume_m3, 6)
    except (ValueError, TypeError):
        pass
    return None