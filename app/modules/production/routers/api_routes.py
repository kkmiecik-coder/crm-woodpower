# modules/production/routers/api_routes.py
"""
API Routes dla modułu Production
=================================

REST API endpoints zgodne z PRD Section 6:
- GET /api/dashboard-stats → statystyki dla dashboard
- POST /api/complete-task → oznaczenie zadania jako wykonane
- POST /api/cron-sync → endpoint synchronizacji CRON
- POST /api/manual-sync → trigger ręcznej synchronizacji
- POST /api/update-config → aktualizacja konfiguracji
- GET /api/health → health check
- POST /api/complete-packaging → ukończenie pakowania z Baselinker update

Zwraca JSON responses z odpowiednimi kodami HTTP.
Autoryzacja zależna od endpointu.

Autor: Konrad Kmiecik
Wersja: 1.0 (Podstawowa zgodnie z PRD)
Data: 2025-01-09
"""

import json
from datetime import datetime, date, timedelta
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from functools import wraps
from modules.logging import get_structured_logger
from extensions import db

# Utworzenie Blueprint dla API
api_bp = Blueprint('production_api', __name__)
logger = get_structured_logger('production.api')

# ============================================================================
# DECORATORS - zabezpieczenia dla różnych typów endpointów
# ============================================================================

def admin_required(f):
    """
    Dekorator dla endpointów wymagających roli admin
    Używany dla: manual-sync, update-config
    """
    @wraps(f)
    @login_required
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({'success': False, 'error': 'Wymagana autoryzacja'}), 401
        
        if not hasattr(current_user, 'role') or current_user.role.lower() not in ['admin', 'administrator']:
            logger.warning("API: Odmowa dostępu admin", extra={
                'user_id': current_user.id,
                'endpoint': request.endpoint,
                'client_ip': request.remote_addr
            })
            return jsonify({'success': False, 'error': 'Brak uprawnień administratora'}), 403
        
        return f(*args, **kwargs)
    return decorated_function

def cron_secret_required(f):
    """
    Dekorator dla endpointów CRON wymagających sekretu
    Używany dla: cron-sync
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        cron_secret = request.headers.get('X-Cron-Secret')
        
        # Pobierz secret z konfiguracji
        expected_secret = current_app.config.get('PRODUCTION_CRON_SECRET', 'prod_sync_secret_key_2025')
        
        if not cron_secret or cron_secret != expected_secret:
            logger.warning("CRON: Nieprawidłowy secret", extra={
                'provided_secret_length': len(cron_secret) if cron_secret else 0,
                'client_ip': request.remote_addr,
                'endpoint': request.endpoint
            })
            return jsonify({'success': False, 'error': 'Nieprawidłowy CRON secret'}), 403
        
        return f(*args, **kwargs)
    return decorated_function

def ip_validation_required(f):
    """
    Dekorator dla walidacji IP stanowisk
    Używany dla: complete-task, complete-packaging
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            from ..services.security_service import IPSecurityService
            
            client_ip = IPSecurityService.get_client_ip(request)
            
            if not IPSecurityService.is_ip_allowed(client_ip):
                logger.warning("IP validation failed", extra={
                    'client_ip': client_ip,
                    'endpoint': request.endpoint,
                    'user_agent': request.headers.get('User-Agent', 'Unknown')
                })
                return jsonify({'success': False, 'error': 'IP nie autoryzowany'}), 403
            
            logger.debug("IP validation success", extra={
                'client_ip': client_ip,
                'endpoint': request.endpoint
            })
            
        except Exception as e:
            logger.error("IP validation error", extra={
                'error': str(e),
                'client_ip': request.remote_addr,
                'endpoint': request.endpoint
            })
            return jsonify({'success': False, 'error': 'Błąd walidacji IP'}), 500
        
        return f(*args, **kwargs)
    return decorated_function

# ============================================================================
# API ROUTES - PRD Section 6.1 (Dashboard)
# ============================================================================

@api_bp.route('/dashboard-stats')
@login_required
def dashboard_stats():
    """
    GET /api/dashboard-stats - Statystyki dla dashboard (PRD Section 6.1)
    
    Zwraca dane JSON zgodne ze strukturą określoną w PRD:
    - stations: statystyki per stanowisko (pending_count, today_m3)
    - today_totals: dzisiejsze totały (completed_orders, total_m3, avg_deadline_distance) 
    - deadline_alerts: alerty terminów (product_id, days_remaining, current_station)
    - system_health: status systemu (last_sync, sync_status, errors_24h, database_status)
    
    Autoryzacja: user, admin
    Returns: JSON zgodny z PRD spec
    """
    try:
        logger.info("API: Pobieranie statystyk dashboard", extra={
            'user_id': current_user.id,
            'user_role': getattr(current_user, 'role', 'unknown')
        })
        
        from ..models import ProductionItem
        
        today = date.today()
        today_start = datetime.combine(today, datetime.min.time())
        
        # Statystyki stanowisk zgodnie z PRD response structure
        stations_stats = {
            'cutting': {'pending_count': 0, 'today_m3': 0.0},
            'assembly': {'pending_count': 0, 'today_m3': 0.0},
            'packaging': {'pending_count': 0, 'today_m3': 0.0}
        }
        
        # CUTTING - oczekujące produkty + dzisiejsze m3
        cutting_pending = ProductionItem.query.filter_by(current_status='czeka_na_wyciecie').count()
        cutting_today_m3 = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                    .filter(ProductionItem.cutting_completed_at >= today_start)\
                                    .scalar() or 0.0
        
        stations_stats['cutting'] = {
            'pending_count': cutting_pending,
            'today_m3': float(cutting_today_m3)
        }
        
        # ASSEMBLY - oczekujące produkty + dzisiejsze m3
        assembly_pending = ProductionItem.query.filter_by(current_status='czeka_na_skladanie').count()
        assembly_today_m3 = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                     .filter(ProductionItem.assembly_completed_at >= today_start)\
                                     .scalar() or 0.0
        
        stations_stats['assembly'] = {
            'pending_count': assembly_pending,
            'today_m3': float(assembly_today_m3)
        }
        
        # PACKAGING - oczekujące produkty + dzisiejsze m3
        packaging_pending = ProductionItem.query.filter_by(current_status='czeka_na_pakowanie').count()
        packaging_today_m3 = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                      .filter(ProductionItem.packaging_completed_at >= today_start)\
                                      .scalar() or 0.0
        
        stations_stats['packaging'] = {
            'pending_count': packaging_pending,
            'today_m3': float(packaging_today_m3)
        }
        
        # TODAY TOTALS - dzisiejsze ukończone zamówienia
        completed_today = ProductionItem.query.filter(
            ProductionItem.current_status == 'spakowane',
            ProductionItem.packaging_completed_at >= today_start
        ).count()
        
        total_m3_today = float(cutting_today_m3 + assembly_today_m3 + packaging_today_m3)
        
        # Średnia odległość od deadline dla aktywnych produktów
        active_products_with_deadlines = ProductionItem.query.filter(
            ProductionItem.current_status.in_(['czeka_na_wyciecie', 'czeka_na_skladanie', 'czeka_na_pakowanie']),
            ProductionItem.deadline_date.isnot(None)
        ).all()
        
        if active_products_with_deadlines:
            deadline_distances = []
            for product in active_products_with_deadlines:
                days_diff = (product.deadline_date - today).days
                deadline_distances.append(days_diff)
            
            avg_deadline_distance = sum(deadline_distances) / len(deadline_distances)
        else:
            avg_deadline_distance = 0.0
        
        # DEADLINE ALERTS - produkty zbliżające się do terminu (zgodnie z PRD)
        deadline_alerts = []
        alerts_query = ProductionItem.query.filter(
            ProductionItem.deadline_date <= today + timedelta(days=3),
            ProductionItem.current_status.in_(['czeka_na_wyciecie', 'czeka_na_skladanie', 'czeka_na_pakowanie'])
        ).order_by(ProductionItem.deadline_date).limit(5).all()
        
        for alert in alerts_query:
            days_remaining = (alert.deadline_date - today).days if alert.deadline_date else 0
            current_station = alert.current_status.replace('czeka_na_', '')
            
            deadline_alerts.append({
                'product_id': alert.short_product_id,
                'days_remaining': days_remaining,
                'current_station': current_station
            })
        
        # SYSTEM HEALTH - podstawowy status systemu
        # TODO: Integracja z sync_service gdy będzie dostępny
        system_health = {
            'last_sync': None,  # Będzie pobierane z sync_service
            'sync_status': 'unknown',  # success/failed/running
            'errors_24h': 0,  # Zliczenie z ProductionError
            'baselinker_api_avg_ms': None,  # Średni czas odpowiedzi API
            'database_status': 'healthy'  # Status połączenia DB
        }
        
        # Zliczenie błędów z ostatnich 24h
        try:
            from ..models import ProductionError
            errors_24h = ProductionError.query.filter(
                ProductionError.error_occurred_at >= datetime.utcnow() - timedelta(hours=24)
            ).count()
            system_health['errors_24h'] = errors_24h
        except Exception:
            system_health['errors_24h'] = 0
        
        # Response zgodny z PRD Section 6.1
        response_data = {
            'stations': stations_stats,
            'today_totals': {
                'completed_orders': completed_today,
                'total_m3': total_m3_today,
                'avg_deadline_distance': round(avg_deadline_distance, 1)
            },
            'deadline_alerts': deadline_alerts,
            'system_health': system_health
        }
        
        return jsonify(response_data), 200
        
    except Exception as e:
        logger.error("API: Błąd statystyk dashboard", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# API ROUTES - PRD Section 6.2 (Stanowiska)
# ============================================================================

@api_bp.route('/complete-task', methods=['POST'])
@ip_validation_required
def complete_task():
    """
    POST /api/complete-task - Oznaczenie zadania jako wykonane (PRD Section 6.2)
    
    Body JSON zgodny z PRD:
    {
        "product_id": "25_05248_1",
        "station_code": "cutting"
    }
    
    Akcje:
    1. Sprawdza czy produkt istnieje i ma odpowiedni status
    2. Oznacza zadanie jako ukończone w modelu
    3. Automatycznie zmienia status na następny w workflow
    4. Loguje operację
    
    Autoryzacja: Brak (walidacja IP)
    Returns: JSON status operacji
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Brak danych JSON'}), 400
        
        product_id = data.get('product_id')
        station_code = data.get('station_code')
        
        if not product_id or not station_code:
            return jsonify({
                'success': False, 
                'error': 'Wymagane pola: product_id, station_code'
            }), 400
        
        # Walidacja station_code
        valid_stations = ['cutting', 'assembly', 'packaging']
        if station_code not in valid_stations:
            return jsonify({
                'success': False,
                'error': f'Nieprawidłowy station_code. Dozwolone: {valid_stations}'
            }), 400
        
        logger.info("API: Próba ukończenia zadania", extra={
            'product_id': product_id,
            'station_code': station_code,
            'client_ip': request.remote_addr
        })
        
        from ..models import ProductionItem
        
        # Znajdź produkt
        product = ProductionItem.query.filter_by(short_product_id=product_id).first()
        if not product:
            return jsonify({
                'success': False,
                'error': f'Produkt {product_id} nie znaleziony'
            }), 404
        
        # Sprawdź czy produkt jest w odpowiednim statusie dla danego stanowiska
        expected_status_map = {
            'cutting': 'czeka_na_wyciecie',
            'assembly': 'czeka_na_skladanie', 
            'packaging': 'czeka_na_pakowanie'
        }
        
        expected_status = expected_status_map[station_code]
        if product.current_status != expected_status:
            return jsonify({
                'success': False,
                'error': f'Produkt ma status "{product.current_status}", oczekiwano "{expected_status}"'
            }), 400
        
        # Ukończ zadanie używając metody z modelu
        old_status = product.current_status
        product.complete_task(station_code)
        
        db.session.commit()
        
        logger.info("API: Ukończono zadanie", extra={
            'product_id': product_id,
            'station_code': station_code,
            'old_status': old_status,
            'new_status': product.current_status,
            'client_ip': request.remote_addr
        })
        
        return jsonify({
            'success': True,
            'message': f'Zadanie {station_code} dla produktu {product_id} ukończone',
            'data': {
                'product_id': product.short_product_id,
                'old_status': old_status,
                'new_status': product.current_status,
                'completed_at': datetime.utcnow().isoformat()
            }
        }), 200
        
    except Exception as e:
        db.session.rollback()
        logger.error("API: Błąd ukończenia zadania", extra={
            'product_id': data.get('product_id') if 'data' in locals() else None,
            'station_code': data.get('station_code') if 'data' in locals() else None,
            'client_ip': request.remote_addr,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# API ROUTES - PRD Section 6.3 (CRON i Synchronizacja)
# ============================================================================

@api_bp.route('/cron-sync', methods=['POST'])
@cron_secret_required
def cron_sync():
    """
    POST /api/cron-sync - Endpoint synchronizacji CRON (PRD Section 6.3)
    
    Endpoint wywoływany przez zadanie CRON co godzinę.
    Pobiera zamówienia z Baselinker i synchronizuje produkty produkcyjne.
    
    Headers wymagane:
        X-Cron-Secret: {config_secret}
    
    Body (opcjonalny):
    {
        "trigger": "cron",
        "timestamp": 1704711600,
        "force_full_sync": false
    }
    
    Autoryzacja: CRON secret
    Returns: JSON status synchronizacji i statystyki
    """
    try:
        data = request.get_json() or {}
        trigger_type = data.get('trigger', 'cron')
        
        logger.info("CRON: Rozpoczęcie synchronizacji", extra={
            'trigger_type': trigger_type,
            'client_ip': request.remote_addr,
            'cron_timestamp': data.get('timestamp')
        })
        
        from ..services.sync_service import sync_orders_from_baselinker
        
        # Wykonanie synchronizacji z Baselinker
        sync_result = sync_orders_from_baselinker(sync_type='cron_auto')
        
        # Logowanie wyników synchronizacji
        logger.info("CRON: Synchronizacja zakończona", extra={
            'sync_duration': sync_result.get('sync_duration_seconds', 0),
            'products_created': sync_result.get('products_created', 0),
            'products_updated': sync_result.get('products_updated', 0),
            'errors_count': sync_result.get('error_count', 0),
            'success': sync_result.get('success', False)
        })
        
        # Response zgodny z oczekiwaniami CRON
        if sync_result.get('success'):
            return jsonify({
                'success': True,
                'message': 'Synchronizacja CRON zakończona pomyślnie',
                'stats': {
                    'orders_processed': sync_result.get('orders_fetched', 0),
                    'products_created': sync_result.get('products_created', 0),
                    'products_updated': sync_result.get('products_updated', 0),
                    'products_skipped': sync_result.get('products_skipped', 0),
                    'duration_seconds': sync_result.get('sync_duration_seconds', 0)
                },
                'status': 'completed' if sync_result.get('error_count', 0) == 0 else 'partial',
                'timestamp': datetime.utcnow().isoformat()
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': sync_result.get('error', 'Nieznany błąd synchronizacji'),
                'stats': {
                    'orders_processed': sync_result.get('orders_fetched', 0),
                    'products_created': sync_result.get('products_created', 0),
                    'error_count': sync_result.get('error_count', 0)
                },
                'status': 'failed'
            }), 500
            
    except Exception as e:
        logger.error("CRON: Błąd synchronizacji", extra={
            'client_ip': request.remote_addr,
            'trigger_type': data.get('trigger') if 'data' in locals() else 'unknown',
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e),
            'status': 'failed',
            'timestamp': datetime.utcnow().isoformat()
        }), 500

@api_bp.route('/manual-sync', methods=['POST'])
@admin_required
def manual_sync():
    """
    POST /api/manual-sync - Trigger ręcznej synchronizacji (PRD Section 6.3)
    
    Endpoint dla adminów do uruchamiania ręcznej synchronizacji z Baselinker.
    Może być wywołany z panelu administracyjnego.
    
    Body (opcjonalny):
    {
        "sync_type": "full",  // full, incremental (obecnie nie obsługiwane - zawsze incremental)
        "target_status_ids": [138618, 138619, 138623], // obecnie nie obsługiwane
        "limit": 1000  // obecnie nie obsługiwane
    }
    
    Autoryzacja: admin
    Returns: JSON status synchronizacji (wykonuje się synchronicznie)
    """
    try:
        data = request.get_json() or {}
        sync_type = data.get('sync_type', 'incremental')
        target_statuses = data.get('target_status_ids', [])
        limit = data.get('limit', 1000)
        
        logger.info("API: Ręczna synchronizacja", extra={
            'user_id': current_user.id,
            'sync_type': sync_type,
            'target_statuses': target_statuses,
            'limit': limit
        })
        
        # Walidacja parametrów
        valid_sync_types = ['full', 'incremental']
        if sync_type not in valid_sync_types:
            return jsonify({
                'success': False,
                'error': f'Nieprawidłowy sync_type. Dozwolone: {valid_sync_types}'
            }), 400
            
        if limit and (not isinstance(limit, int) or limit < 1 or limit > 5000):
            return jsonify({
                'success': False,
                'error': 'Limit musi być liczbą między 1 a 5000'
            }), 400
        
        from ..services.sync_service import sync_orders_from_baselinker, get_sync_status
        
        # Sprawdź czy synchronizacja już nie jest w toku
        current_status = get_sync_status()
        if current_status.get('is_running'):
            return jsonify({
                'success': False,
                'error': 'Synchronizacja jest już w toku',
                'current_sync_status': current_status
            }), 409
        
        # Wykonaj synchronizację (obecnie bez dodatkowych parametrów)
        # BaselinkerSyncService używa własnej konfiguracji statusów i limitów
        sync_result = sync_orders_from_baselinker(sync_type='manual_trigger')
        
        logger.info("API: Ręczna synchronizacja zakończona", extra={
            'user_id': current_user.id,
            'sync_success': sync_result.get('success', False),
            'products_created': sync_result.get('products_created', 0),
            'products_updated': sync_result.get('products_updated', 0),
            'error_count': sync_result.get('error_count', 0)
        })
        
        # Response z wynikami synchronizacji
        if sync_result.get('success'):
            return jsonify({
                'success': True,
                'message': 'Ręczna synchronizacja zakończona pomyślnie',
                'data': {
                    'sync_id': f'manual_{int(datetime.utcnow().timestamp())}',
                    'status': 'completed' if sync_result.get('error_count', 0) == 0 else 'partial',
                    'initiated_at': datetime.utcnow().isoformat(),
                    'initiated_by': current_user.id,
                    'duration_seconds': sync_result.get('sync_duration_seconds', 0),
                    'stats': {
                        'orders_fetched': sync_result.get('orders_fetched', 0),
                        'products_created': sync_result.get('products_created', 0),
                        'products_updated': sync_result.get('products_updated', 0),
                        'products_skipped': sync_result.get('products_skipped', 0),
                        'error_count': sync_result.get('error_count', 0)
                    },
                    'parameters_note': 'Dodatkowe parametry (target_status_ids, limit) będą obsługiwane w przyszłej wersji'
                }
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': sync_result.get('error', 'Nieznany błąd synchronizacji'),
                'data': {
                    'sync_id': f'manual_failed_{int(datetime.utcnow().timestamp())}',
                    'status': 'failed',
                    'initiated_at': datetime.utcnow().isoformat(),
                    'initiated_by': current_user.id,
                    'error_count': sync_result.get('error_count', 1)
                }
            }), 500
        
    except Exception as e:
        logger.error("API: Błąd ręcznej synchronizacji", extra={
            'user_id': current_user.id,
            'sync_type': data.get('sync_type') if 'data' in locals() else 'unknown',
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e),
            'data': {
                'status': 'failed',
                'initiated_by': current_user.id
            }
        }), 500


# ============================================================================
# API ROUTES - PRD Section 6.4 (Konfiguracja i Monitoring)
# ============================================================================

@api_bp.route('/update-config', methods=['POST'])
@admin_required
def update_config():
    """
    POST /api/update-config - Aktualizacja konfiguracji systemu (PRD Section 6.4)
    
    Body JSON zgodny z PRD:
    {
        "config_key": "STATION_ALLOWED_IPS",
        "config_value": "192.168.1.100,192.168.1.101"
    }
    
    Opcjonalne pola:
    {
        "config_description": "Opis konfiguracji",
        "config_type": "string"  // string, integer, boolean, json, ip_list
    }
    
    Autoryzacja: admin
    Returns: JSON status operacji
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Brak danych JSON'}), 400
        
        config_key = data.get('config_key')
        config_value = data.get('config_value')
        config_description = data.get('config_description')
        config_type = data.get('config_type', 'string')
        
        if not config_key or config_value is None:
            return jsonify({
                'success': False,
                'error': 'Wymagane pola: config_key, config_value'
            }), 400
        
        # Walidacja config_type
        valid_types = ['string', 'integer', 'boolean', 'json', 'ip_list']
        if config_type not in valid_types:
            return jsonify({
                'success': False,
                'error': f'Nieprawidłowy config_type. Dozwolone: {valid_types}'
            }), 400
        
        # Walidacja wartości zgodnie z typem
        validation_result = _validate_config_value(config_value, config_type)
        if not validation_result['valid']:
            return jsonify({
                'success': False,
                'error': f'Nieprawidłowa wartość dla typu {config_type}: {validation_result["error"]}'
            }), 400
        
        logger.info("API: Aktualizacja konfiguracji", extra={
            'config_key': config_key,
            'config_type': config_type,
            'user_id': current_user.id
        })
        
        from ..models import ProductionConfig
        
        # Użycie metody z modelu dla aktualizacji konfiguracji
        ProductionConfig.set_config(
            key=config_key,
            value=config_value,
            user_id=current_user.id,
            description=config_description,
            config_type=config_type
        )
        
        logger.info("API: Zaktualizowano konfigurację", extra={
            'config_key': config_key,
            'user_id': current_user.id,
            'config_type': config_type
        })
        
        return jsonify({
            'success': True,
            'message': f'Konfiguracja {config_key} zaktualizowana',
            'data': {
                'config_key': config_key,
                'config_value': config_value,
                'config_type': config_type,
                'updated_at': datetime.utcnow().isoformat(),
                'updated_by': current_user.id
            }
        }), 200
        
    except Exception as e:
        logger.error("API: Błąd aktualizacji konfiguracji", extra={
            'config_key': data.get('config_key') if 'data' in locals() else None,
            'user_id': current_user.id,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@api_bp.route('/health')
def health_check():
    """
    GET /api/health - Health check endpoint (PRD Section 6.4)
    
    Sprawdza stan systemu produkcyjnego:
    - Status bazy danych
    - Status synchronizacji Baselinker
    - Status cache
    - Liczba nierozwiązanych błędów
    - Wydajność API Baselinker
    
    Autoryzacja: user, admin
    Returns: JSON zgodny z PRD spec
    """
    try:
        logger.debug("API: Health check", extra={
            'user_id': current_user.id
        })
        
        health_data = {
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'last_sync': None,
            'database': 'disconnected',
            'baselinker_api': 'unknown',
            'cache': 'inactive',
            'pending_errors': 0
        }
        
        # Test połączenia z bazą danych
        try:
            from ..models import ProductionItem
            
            # Proste zapytanie testowe
            db.session.execute(db.text('SELECT 1')).scalar()
            health_data['database'] = 'connected'
            
            # Sprawdzenie liczby oczekujących błędów
            from ..models import ProductionError
            pending_errors = ProductionError.query.filter_by(is_resolved=False).count()
            health_data['pending_errors'] = pending_errors
            
        except Exception as e:
            health_data['database'] = 'error'
            health_data['status'] = 'unhealthy'
            logger.warning("Health check: Błąd bazy danych", extra={'error': str(e)})
        
        # Status ostatniej synchronizacji
        try:
            from ..services.sync_service import get_sync_status
            
            sync_status = get_sync_status()
            if sync_status.get('last_sync'):
                health_data['last_sync'] = sync_status['last_sync']['timestamp']
                
                # Status API Baselinker na podstawie ostatniej synchronizacji
                if sync_status.get('sync_enabled'):
                    last_sync_status = sync_status['last_sync'].get('status')
                    if last_sync_status == 'completed':
                        health_data['baselinker_api'] = 'responsive'
                    elif last_sync_status == 'failed':
                        health_data['baselinker_api'] = 'error'
                        health_data['status'] = 'degraded'
                    else:
                        health_data['baselinker_api'] = 'unknown'
                else:
                    health_data['baselinker_api'] = 'disabled'
            
        except Exception as e:
            health_data['baselinker_api'] = 'error'
            logger.warning("Health check: Błąd sprawdzania sync", extra={'error': str(e)})
        
        # Status cache (sprawdzenie config_service)
        try:
            from ..services.config_service import get_config_service
            
            config_service = get_config_service()
            if config_service:
                # Test cache - pobierz dowolną konfigurację
                test_config = config_service.get_config('STATION_ALLOWED_IPS', 'test')
                health_data['cache'] = 'active'
            else:
                health_data['cache'] = 'inactive'
                
        except Exception as e:
            health_data['cache'] = 'error'
            logger.warning("Health check: Błąd sprawdzania cache", extra={'error': str(e)})
        
        # Określenie ogólnego stanu zdrowia
        if health_data['database'] == 'error':
            health_data['status'] = 'unhealthy'
        elif health_data['pending_errors'] > 10:
            health_data['status'] = 'degraded'
        elif health_data['baselinker_api'] == 'error':
            health_data['status'] = 'degraded'
        
        # Dodatkowe informacje diagnostyczne dla adminów
        if hasattr(current_user, 'role') and current_user.role.lower() in ['admin', 'administrator']:
            try:
                from ..models import ProductionItem
                
                # Statystyki produktów
                active_products = ProductionItem.query.filter(
                    ProductionItem.current_status.in_([
                        'czeka_na_wyciecie', 'czeka_na_skladanie', 'czeka_na_pakowanie'
                    ])
                ).count()
                
                completed_today = ProductionItem.query.filter(
                    ProductionItem.current_status == 'spakowane',
                    ProductionItem.packaging_completed_at >= datetime.combine(date.today(), datetime.min.time())
                ).count()
                
                health_data['diagnostics'] = {
                    'active_products': active_products,
                    'completed_today': completed_today,
                    'database_tables_accessible': True
                }
                
            except Exception as e:
                health_data['diagnostics'] = {
                    'error': str(e),
                    'database_tables_accessible': False
                }
        
        return jsonify(health_data), 200
        
    except Exception as e:
        logger.error("API: Błąd health check", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        
        return jsonify({
            'status': 'error',
            'timestamp': datetime.utcnow().isoformat(),
            'error': str(e),
            'database': 'unknown',
            'baselinker_api': 'unknown',
            'cache': 'unknown',
            'pending_errors': 'unknown'
        }), 500

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _validate_config_value(value, config_type):
    """
    Waliduje wartość konfiguracji zgodnie z jej typem
    
    Args:
        value: Wartość do walidacji
        config_type (str): Typ konfiguracji
        
    Returns:
        Dict[str, Any]: Wynik walidacji
    """
    try:
        if config_type == 'integer':
            int(value)
        elif config_type == 'boolean':
            if str(value).lower() not in ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off']:
                return {'valid': False, 'error': 'Wartość boolean musi być: true/false, 1/0, yes/no, on/off'}
        elif config_type == 'json':
            json.loads(str(value))
        elif config_type == 'ip_list':
            import ipaddress
            ips = [ip.strip() for ip in str(value).split(',') if ip.strip()]
            for ip in ips:
                ipaddress.ip_address(ip)  # Walidacja każdego IP
        # string - zawsze prawidłowy
        
        return {'valid': True}
        
    except ValueError as e:
        return {'valid': False, 'error': str(e)}
    except Exception as e:
        return {'valid': False, 'error': f'Błąd walidacji: {str(e)}'}


# ============================================================================
# API ROUTES - PRD Section 6.2 (Complete Packaging z Baselinker Update)
# ============================================================================

@api_bp.route('/complete-packaging', methods=['POST'])
@ip_validation_required
def complete_packaging():
    """
    POST /api/complete-packaging - Ukończenie pakowania z aktualizacją Baselinker (PRD Section 6.2)
    
    Body JSON zgodny z PRD:
    {
        "internal_order_number": "25_05248",
        "completed_products": [
            {"product_id": "25_05248_1", "confirmed": true},
            {"product_id": "25_05248_2", "confirmed": true}
        ]
    }
    
    Działanie:
    1. Zmienia status produktów na 'spakowane'
    2. Wysyła API call do Baselinker zmieniający status zamówienia na 138623
    
    Autoryzacja: Brak (walidacja IP)
    Returns: JSON status operacji i potwierdzenie aktualizacji Baselinker
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Brak danych JSON'}), 400
        
        internal_order_number = data.get('internal_order_number')
        completed_products = data.get('completed_products', [])
        
        if not internal_order_number:
            return jsonify({
                'success': False,
                'error': 'Wymagane pole: internal_order_number'
            }), 400
        
        if not completed_products or not isinstance(completed_products, list):
            return jsonify({
                'success': False,
                'error': 'Wymagane pole: completed_products (lista produktów)'
            }), 400
        
        logger.info("API: Próba ukończenia pakowania", extra={
            'internal_order_number': internal_order_number,
            'products_count': len(completed_products),
            'client_ip': request.remote_addr
        })
        
        from ..models import ProductionItem
        from ..services.sync_service import update_order_status_in_baselinker
        
        # Walidacja i przygotowanie listy produktów do aktualizacji
        products_to_complete = []
        validation_errors = []
        
        for product_data in completed_products:
            product_id = product_data.get('product_id')
            confirmed = product_data.get('confirmed', False)
            
            if not product_id:
                validation_errors.append('Brak product_id w jednym z produktów')
                continue
            
            if not confirmed:
                validation_errors.append(f'Produkt {product_id} nie jest potwierdzony (confirmed: false)')
                continue
            
            # Znajdź produkt w bazie
            product = ProductionItem.query.filter_by(short_product_id=product_id).first()
            if not product:
                validation_errors.append(f'Produkt {product_id} nie znaleziony')
                continue
            
            # Sprawdź czy produkt należy do danego zamówienia
            if product.internal_order_number != internal_order_number:
                validation_errors.append(f'Produkt {product_id} nie należy do zamówienia {internal_order_number}')
                continue
            
            # Sprawdź czy produkt jest w statusie czeka_na_pakowanie
            if product.current_status != 'czeka_na_pakowanie':
                validation_errors.append(f'Produkt {product_id} ma status "{product.current_status}", oczekiwano "czeka_na_pakowanie"')
                continue
            
            products_to_complete.append(product)
        
        # Jeśli są błędy walidacji, zwróć je
        if validation_errors:
            return jsonify({
                'success': False,
                'error': 'Błędy walidacji produktów',
                'validation_errors': validation_errors
            }), 400
        
        if not products_to_complete:
            return jsonify({
                'success': False,
                'error': 'Brak produktów do ukończenia po walidacji'
            }), 400
        
        # Wykonaj ukończenie pakowania dla wszystkich produktów
        completed_products_list = []
        packaging_errors = []
        
        for product in products_to_complete:
            try:
                old_status = product.current_status
                product.complete_task('packaging')
                
                completed_products_list.append({
                    'product_id': product.short_product_id,
                    'old_status': old_status,
                    'new_status': product.current_status,
                    'completed_at': product.packaging_completed_at.isoformat() if product.packaging_completed_at else None
                })
                
                logger.debug("Ukończono pakowanie produktu", extra={
                    'product_id': product.short_product_id,
                    'old_status': old_status,
                    'new_status': product.current_status
                })
                
            except Exception as e:
                packaging_errors.append({
                    'product_id': product.short_product_id,
                    'error': str(e)
                })
                logger.error("Błąd ukończenia pakowania produktu", extra={
                    'product_id': product.short_product_id,
                    'error': str(e)
                })
        
        # Commit zmian w bazie danych
        db.session.commit()
        
        # Sprawdź czy wszystkie produkty z zamówienia są spakowane i zaktualizuj Baselinker
        baselinker_update_success = False
        baselinker_error = None
        
        try:
            # Sprawdź czy wszystkie produkty z tego zamówienia są teraz spakowane
            all_products_in_order = ProductionItem.query.filter_by(
                internal_order_number=internal_order_number
            ).all()
            
            all_packed = all(p.current_status == 'spakowane' for p in all_products_in_order)
            
            if all_packed:
                logger.info("Wszystkie produkty spakowane - aktualizacja Baselinker", extra={
                    'internal_order_number': internal_order_number,
                    'total_products': len(all_products_in_order)
                })
                
                # Aktualizuj status w Baselinker
                baselinker_update_success = update_order_status_in_baselinker(internal_order_number)
                
                if not baselinker_update_success:
                    baselinker_error = "Nie udało się zaktualizować statusu w Baselinker"
            else:
                packed_count = sum(1 for p in all_products_in_order if p.current_status == 'spakowane')
                logger.info("Nie wszystkie produkty spakowane - brak aktualizacji Baselinker", extra={
                    'internal_order_number': internal_order_number,
                    'packed_count': packed_count,
                    'total_count': len(all_products_in_order)
                })
                
        except Exception as e:
            baselinker_error = str(e)
            logger.error("Błąd aktualizacji Baselinker", extra={
                'internal_order_number': internal_order_number,
                'error': str(e)
            })
        
        # Przygotuj response
        response_data = {
            'success': True,
            'message': f'Ukończono pakowanie {len(completed_products_list)} produktów',
            'data': {
                'internal_order_number': internal_order_number,
                'completed_products': completed_products_list,
                'packaging_errors': packaging_errors,
                'baselinker_update': {
                    'attempted': len(completed_products_list) > 0,
                    'success': baselinker_update_success,
                    'error': baselinker_error
                },
                'completed_at': datetime.utcnow().isoformat()
            }
        }
        
        # Jeśli były błędy pakowania, ale część się udała
        if packaging_errors:
            response_data['success'] = len(completed_products_list) > 0
            response_data['message'] += f', {len(packaging_errors)} błędów'
        
        logger.info("API: Ukończono pakowanie zamówienia", extra={
            'internal_order_number': internal_order_number,
            'completed_count': len(completed_products_list),
            'error_count': len(packaging_errors),
            'baselinker_success': baselinker_update_success,
            'client_ip': request.remote_addr
        })
        
        return jsonify(response_data), 200
        
    except Exception as e:
        db.session.rollback()
        logger.error("API: Błąd ukończenia pakowania", extra={
            'internal_order_number': data.get('internal_order_number') if 'data' in locals() else None,
            'client_ip': request.remote_addr,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e),
            'data': {
                'completed_at': datetime.utcnow().isoformat(),
                'rollback_performed': True
            }
        }), 500

# ============================================================================
# ERROR HANDLERS
# ============================================================================

@api_bp.errorhandler(400)
def bad_request(error):
    """Handler dla błędów 400 Bad Request"""
    logger.warning("API: Bad Request", extra={
        'error': str(error),
        'endpoint': request.endpoint,
        'client_ip': request.remote_addr
    })
    
    return jsonify({
        'success': False,
        'error': 'Nieprawidłowe żądanie',
        'status_code': 400
    }), 400

@api_bp.errorhandler(401)
def unauthorized(error):
    """Handler dla błędów 401 Unauthorized"""
    logger.warning("API: Unauthorized", extra={
        'error': str(error),
        'endpoint': request.endpoint,
        'client_ip': request.remote_addr
    })
    
    return jsonify({
        'success': False,
        'error': 'Wymagana autoryzacja',
        'status_code': 401
    }), 401

@api_bp.errorhandler(403)
def forbidden(error):
    """Handler dla błędów 403 Forbidden"""
    logger.warning("API: Forbidden", extra={
        'error': str(error),
        'endpoint': request.endpoint,
        'client_ip': request.remote_addr,
        'user_id': current_user.id if current_user.is_authenticated else None
    })
    
    return jsonify({
        'success': False,
        'error': 'Brak uprawnień',
        'status_code': 403
    }), 403

@api_bp.errorhandler(404)
def not_found(error):
    """Handler dla błędów 404 Not Found"""
    logger.warning("API: Not Found", extra={
        'error': str(error),
        'endpoint': request.endpoint,
        'client_ip': request.remote_addr
    })
    
    return jsonify({
        'success': False,
        'error': 'Endpoint nie znaleziony',
        'status_code': 404
    }), 404

@api_bp.errorhandler(405)
def method_not_allowed(error):
    """Handler dla błędów 405 Method Not Allowed"""
    logger.warning("API: Method Not Allowed", extra={
        'error': str(error),
        'method': request.method,
        'endpoint': request.endpoint,
        'client_ip': request.remote_addr
    })
    
    return jsonify({
        'success': False,
        'error': f'Metoda {request.method} nie dozwolona',
        'status_code': 405
    }), 405

@api_bp.errorhandler(500)
def internal_server_error(error):
    """Handler dla błędów 500 Internal Server Error"""
    logger.error("API: Internal Server Error", extra={
        'error': str(error),
        'endpoint': request.endpoint,
        'client_ip': request.remote_addr,
        'user_id': current_user.id if current_user.is_authenticated else None
    })
    
    return jsonify({
        'success': False,
        'error': 'Błąd wewnętrzny serwera',
        'status_code': 500
    }), 500

# ============================================================================
# CONTEXT PROCESSORS I BEFORE/AFTER REQUEST
# ============================================================================

@api_bp.before_request
def log_api_request():
    """Loguje wszystkie żądania API"""
    try:
        logger.debug("API Request", extra={
            'method': request.method,
            'path': request.path,
            'endpoint': request.endpoint,
            'client_ip': request.remote_addr,
            'user_agent': request.headers.get('User-Agent', 'Unknown'),
            'content_type': request.headers.get('Content-Type'),
            'user_id': current_user.id if current_user.is_authenticated else None
        })
    except Exception as e:
        logger.error("Błąd logowania API request", extra={'error': str(e)})

@api_bp.after_request
def add_api_headers(response):
    """Dodaje nagłówki do wszystkich odpowiedzi API"""
    try:
        # Nagłówki dla API
        response.headers['Content-Type'] = 'application/json; charset=utf-8'
        response.headers['X-API-Version'] = '1.0'
        response.headers['X-Production-Module'] = 'WoodPower-Production-API'
        
        # Nagłówki CORS (jeśli potrzebne)
        # response.headers['Access-Control-Allow-Origin'] = '*'
        # response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        
        return response
    except Exception as e:
        logger.error("Błąd dodawania nagłówków API", extra={'error': str(e)})
        return response

logger.info("Zainicjalizowano API routes modułu production", extra={
    'blueprint_name': api_bp.name,
    'total_endpoints': 7,  # dashboard-stats, complete-task, cron-sync, manual-sync, update-config, health, complete-packaging
    'prd_compliance': True
})