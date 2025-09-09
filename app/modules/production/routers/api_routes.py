# modules/production/routers/api_routes.py
"""
API Routes dla modułu Production
=================================

REST API endpoints dla operacji produkcyjnych:
- Synchronizacja z Baselinker (ręczna i CRON)
- Zarządzanie zadaniami produkcyjnymi
- Pobieranie danych dla stanowisk
- Aktualizacja priorytetów i statusów
- Health check i monitoring
- Zarządzanie konfiguracją

Wszystkie endpointy wymagają autoryzacji (oprócz CRON z secret).
Zwracają JSON responses z kodem statusu HTTP.

Autor: Konrad Kmiecik
Wersja: 1.2 (Finalna - z zabezpieczeniami)
Data: 2025-01-08
"""

import json
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from functools import wraps
from modules.logging import get_structured_logger
from app import db

# Utworzenie Blueprint dla API
api_bp = Blueprint('production_api', __name__)
logger = get_structured_logger('production.api')

# Dekorator dla sprawdzania secret CRON
def cron_secret_required(f):
    """
    Dekorator sprawdzający secret dla żądań CRON
    
    Args:
        f: Funkcja do zabezpieczenia
        
    Returns:
        Zabezpieczona funkcja
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Sprawdzenie nagłówka z secret
        cron_secret = request.headers.get('X-Cron-Secret')
        
        if not cron_secret:
            logger.warning("Brak nagłówka X-Cron-Secret w żądaniu CRON")
            return jsonify({
                'error': 'Missing CRON secret header',
                'code': 'MISSING_CRON_SECRET'
            }), 401
        
        # Pobranie oczekiwanego secret z konfiguracji
        try:
            expected_secret = current_app.config.get('PRODUCTION_CRON_SECRET')
            if not expected_secret:
                # Fallback do konfiguracji z pliku
                import os
                config_path = os.path.join('app', 'config', 'core.json')
                if os.path.exists(config_path):
                    with open(config_path, 'r') as f:
                        config = json.load(f)
                        expected_secret = config.get('PRODUCTION_CRON_SECRET')
            
            if not expected_secret:
                logger.error("Brak skonfigurowanego CRON secret")
                return jsonify({
                    'error': 'CRON secret not configured',
                    'code': 'CRON_SECRET_NOT_CONFIGURED'
                }), 500
            
            if cron_secret != expected_secret:
                logger.warning("Nieprawidłowy CRON secret", extra={
                    'provided_secret': cron_secret[:10] + '...' if len(cron_secret) > 10 else cron_secret,
                    'client_ip': request.remote_addr
                })
                return jsonify({
                    'error': 'Invalid CRON secret',
                    'code': 'INVALID_CRON_SECRET'
                }), 401
            
        except Exception as e:
            logger.error("Błąd weryfikacji CRON secret", extra={'error': str(e)})
            return jsonify({
                'error': 'CRON secret verification failed',
                'code': 'CRON_SECRET_ERROR'
            }), 500
        
        return f(*args, **kwargs)
    
    return decorated_function

# Dekorator dla sprawdzania roli admin
def admin_required(f):
    """
    Dekorator sprawdzający czy użytkownik ma rolę admin
    
    Args:
        f: Funkcja do zabezpieczenia
        
    Returns:
        Zabezpieczona funkcja
    """
    @wraps(f)
    @login_required
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({
                'error': 'Authentication required',
                'code': 'AUTH_REQUIRED'
            }), 401
        
        if not hasattr(current_user, 'role') or current_user.role.lower() not in ['admin', 'administrator']:
            logger.warning("Próba dostępu bez uprawnień admin", extra={
                'user_id': current_user.id if current_user.is_authenticated else None,
                'user_role': getattr(current_user, 'role', 'unknown'),
                'endpoint': request.endpoint
            })
            return jsonify({
                'error': 'Admin role required',
                'code': 'ADMIN_REQUIRED'
            }), 403
        
        return f(*args, **kwargs)
    
    return decorated_function

# ============================================================================
# ENDPOINTS SYNCHRONIZACJI
# ============================================================================

@api_bp.route('/cron-sync', methods=['POST'])
@cron_secret_required
def cron_sync():
    """
    Endpoint synchronizacji wywoływany przez CRON
    
    Headers:
        X-Cron-Secret: Secret key dla autoryzacji CRON
    
    Returns:
        JSON: Status synchronizacji i statystyki
    """
    try:
        logger.info("Rozpoczęcie synchronizacji CRON")
        
        from ..services.sync_service import sync_orders_from_baselinker
        
        # Sprawdzenie czy synchronizacja już nie jest w toku
        from ..services.sync_service import get_sync_status
        status = get_sync_status()
        
        if status.get('is_running'):
            logger.warning("Synchronizacja już w toku - pomijam")
            return jsonify({
                'success': False,
                'message': 'Synchronization already in progress',
                'code': 'SYNC_IN_PROGRESS'
            }), 409
        
        # Wykonanie synchronizacji
        result = sync_orders_from_baselinker('cron_auto')
        
        logger.info("Zakończono synchronizację CRON", extra=result)
        
        return jsonify({
            'success': result['success'],
            'message': 'CRON synchronization completed',
            'data': result,
            'timestamp': datetime.utcnow().isoformat()
        }), 200 if result['success'] else 500
        
    except Exception as e:
        logger.error("Błąd synchronizacji CRON", extra={'error': str(e)})
        return jsonify({
            'success': False,
            'error': str(e),
            'code': 'CRON_SYNC_ERROR',
            'timestamp': datetime.utcnow().isoformat()
        }), 500

@api_bp.route('/manual-sync', methods=['POST'])
@admin_required
def manual_sync():
    """
    Trigger ręcznej synchronizacji (tylko admin)
    
    Returns:
        JSON: Status inicjacji synchronizacji
    """
    try:
        logger.info("Rozpoczęcie ręcznej synchronizacji", extra={
            'user_id': current_user.id,
            'user_email': getattr(current_user, 'email', 'unknown')
        })
        
        from ..services.sync_service import sync_orders_from_baselinker, get_sync_status
        
        # Sprawdzenie czy synchronizacja już nie jest w toku
        status = get_sync_status()
        if status.get('is_running'):
            return jsonify({
                'success': False,
                'message': 'Synchronization already in progress',
                'code': 'SYNC_IN_PROGRESS'
            }), 409
        
        # Wykonanie synchronizacji
        result = sync_orders_from_baselinker('manual_trigger')
        
        return jsonify({
            'success': result['success'],
            'message': 'Manual synchronization completed',
            'data': result,
            'triggered_by': current_user.id,
            'timestamp': datetime.utcnow().isoformat()
        }), 200 if result['success'] else 500
        
    except Exception as e:
        logger.error("Błąd ręcznej synchronizacji", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': str(e),
            'code': 'MANUAL_SYNC_ERROR'
        }), 500

@api_bp.route('/sync-status', methods=['GET'])
@login_required
def sync_status():
    """
    Pobiera status synchronizacji
    
    Returns:
        JSON: Informacje o statusie synchronizacji
    """
    try:
        from ..services.sync_service import get_sync_status
        
        status = get_sync_status()
        
        return jsonify({
            'success': True,
            'data': status,
            'timestamp': datetime.utcnow().isoformat()
        }), 200
        
    except Exception as e:
        logger.error("Błąd pobierania statusu synchronizacji", extra={'error': str(e)})
        return jsonify({
            'success': False,
            'error': str(e),
            'code': 'SYNC_STATUS_ERROR'
        }), 500

# ============================================================================
# ENDPOINTS ZARZĄDZANIA ZADANIAMI
# ============================================================================

@api_bp.route('/complete-task', methods=['POST'])
def complete_task():
    """
    Oznacza zadanie jako ukończone (bez autoryzacji - zabezpieczone IP)
    
    Request JSON:
        {
            "product_id": "25_05248_1",
            "station_code": "cutting|assembly|packaging",
            "worker_id": 123 (optional)
        }
    
    Returns:
        JSON: Status operacji
    """
    try:
        # Sprawdzenie IP (security_service middleware powinien to obsłużyć)
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'Missing JSON data',
                'code': 'MISSING_DATA'
            }), 400
        
        product_id = data.get('product_id')
        station_code = data.get('station_code')
        worker_id = data.get('worker_id')
        
        if not product_id or not station_code:
            return jsonify({
                'success': False,
                'error': 'Missing product_id or station_code',
                'code': 'MISSING_REQUIRED_FIELDS'
            }), 400
        
        if station_code not in ['cutting', 'assembly', 'packaging']:
            return jsonify({
                'success': False,
                'error': 'Invalid station_code',
                'code': 'INVALID_STATION_CODE'
            }), 400
        
        from ..models import ProductionItem
        
        # Znajdź produkt
        product = ProductionItem.query.filter_by(short_product_id=product_id).first()
        if not product:
            return jsonify({
                'success': False,
                'error': 'Product not found',
                'code': 'PRODUCT_NOT_FOUND'
            }), 404
        
        # Sprawdź czy produkt jest w odpowiednim statusie
        expected_status = {
            'cutting': 'czeka_na_wyciecie',
            'assembly': 'czeka_na_skladanie', 
            'packaging': 'czeka_na_pakowanie'
        }
        
        if product.current_status != expected_status[station_code]:
            return jsonify({
                'success': False,
                'error': f'Product status is {product.current_status}, expected {expected_status[station_code]}',
                'code': 'INVALID_PRODUCT_STATUS'
            }), 400
        
        # Oznacz zadanie jako ukończone
        product.complete_task(station_code)
        
        # Zapisz zmiany
        db.session.commit()
        
        logger.info("Ukończono zadanie", extra={
            'product_id': product_id,
            'station_code': station_code,
            'worker_id': worker_id,
            'new_status': product.current_status,
            'client_ip': request.remote_addr
        })
        
        result = {
            'success': True,
            'message': 'Task completed successfully',
            'data': {
                'product_id': product_id,
                'station_code': station_code,
                'new_status': product.current_status,
                'completed_at': datetime.utcnow().isoformat()
            }
        }
        
        # Sprawdź czy to było ostatnie zadanie dla zamówienia (packaging)
        if station_code == 'packaging':
            # Sprawdź czy wszystkie produkty z zamówienia są spakowane
            from ..services.sync_service import update_order_status_in_baselinker
            
            try:
                success = update_order_status_in_baselinker(product.internal_order_number)
                result['data']['baselinker_updated'] = success
            except Exception as e:
                logger.error("Błąd aktualizacji statusu w Baselinker", extra={
                    'internal_order_number': product.internal_order_number,
                    'error': str(e)
                })
                result['data']['baselinker_updated'] = False
                result['data']['baselinker_error'] = str(e)
        
        return jsonify(result), 200
        
    except Exception as e:
        db.session.rollback()
        logger.error("Błąd ukończenia zadania", extra={
            'product_id': data.get('product_id') if 'data' in locals() else 'unknown',
            'station_code': data.get('station_code') if 'data' in locals() else 'unknown',
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': str(e),
            'code': 'COMPLETE_TASK_ERROR'
        }), 500

@api_bp.route('/get-products', methods=['GET'])
def get_products():
    """
    Pobiera produkty dla stanowiska (bez autoryzacji - zabezpieczone IP)
    
    Query params:
        station_code: cutting|assembly|packaging
        limit: liczba produktów (default: 50)
        sort_by: priority|deadline|created_at (default: priority)
    
    Returns:
        JSON: Lista produktów dla stanowiska
    """
    try:
        station_code = request.args.get('station_code')
        limit = min(int(request.args.get('limit', 50)), 200)  # Max 200
        sort_by = request.args.get('sort_by', 'priority')
        
        if not station_code or station_code not in ['cutting', 'assembly', 'packaging']:
            return jsonify({
                'success': False,
                'error': 'Invalid or missing station_code',
                'code': 'INVALID_STATION_CODE'
            }), 400
        
        from ..models import ProductionItem
        from sqlalchemy import desc, asc
        
        # Mapowanie statusów na stanowiska
        status_map = {
            'cutting': 'czeka_na_wyciecie',
            'assembly': 'czeka_na_skladanie',
            'packaging': 'czeka_na_pakowanie'
        }
        
        # Query podstawowy
        query = ProductionItem.query.filter_by(
            current_status=status_map[station_code]
        )
        
        # Sortowanie
        if sort_by == 'priority':
            query = query.order_by(desc(ProductionItem.priority_score))
        elif sort_by == 'deadline':
            query = query.order_by(asc(ProductionItem.deadline_date))
        elif sort_by == 'created_at':
            query = query.order_by(asc(ProductionItem.created_at))
        else:
            query = query.order_by(desc(ProductionItem.priority_score))
        
        # Wykonanie query
        products = query.limit(limit).all()
        
        # Serializacja produktów
        products_data = []
        for product in products:
            product_data = {
                'product_id': product.short_product_id,
                'internal_order_number': product.internal_order_number,
                'original_name': product.original_product_name,
                'priority_score': product.priority_score,
                'priority_level': product.priority_level,
                'deadline_date': product.deadline_date.isoformat() if product.deadline_date else None,
                'days_until_deadline': product.days_until_deadline,
                'is_overdue': product.is_overdue,
                'volume_m3': float(product.volume_m3) if product.volume_m3 else None,
                'total_value_net': float(product.total_value_net) if product.total_value_net else None,
                'created_at': product.created_at.isoformat(),
                'parsed_data': {
                    'wood_species': product.parsed_wood_species,
                    'technology': product.parsed_technology,
                    'wood_class': product.parsed_wood_class,
                    'dimensions': f"{product.parsed_length_cm}×{product.parsed_width_cm}×{product.parsed_thickness_cm}" if all([
                        product.parsed_length_cm, product.parsed_width_cm, product.parsed_thickness_cm
                    ]) else None,
                    'finish_state': product.parsed_finish_state
                }
            }
            products_data.append(product_data)
        
        logger.debug("Pobrano produkty dla stanowiska", extra={
            'station_code': station_code,
            'products_count': len(products_data),
            'limit': limit,
            'sort_by': sort_by
        })
        
        return jsonify({
            'success': True,
            'data': {
                'products': products_data,
                'station_code': station_code,
                'count': len(products_data),
                'limit': limit,
                'sort_by': sort_by,
                'timestamp': datetime.utcnow().isoformat()
            }
        }), 200
        
    except Exception as e:
        logger.error("Błąd pobierania produktów", extra={
            'station_code': request.args.get('station_code'),
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': str(e),
            'code': 'GET_PRODUCTS_ERROR'
        }), 500

# ============================================================================
# ENDPOINTS ZARZĄDZANIA PRIORYTETAMI
# ============================================================================

@api_bp.route('/update-priority', methods=['POST'])
@admin_required
def update_priority():
    """
    Aktualizuje priorytet produktu (tylko admin)
    
    Request JSON:
        {
            "product_id": "25_05248_1",
            "new_priority": 150
        }
    
    Returns:
        JSON: Status operacji
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'Missing JSON data',
                'code': 'MISSING_DATA'
            }), 400
        
        product_id = data.get('product_id')
        new_priority = data.get('new_priority')
        
        if not product_id or new_priority is None:
            return jsonify({
                'success': False,
                'error': 'Missing product_id or new_priority',
                'code': 'MISSING_REQUIRED_FIELDS'
            }), 400
        
        # Walidacja priorytetu
        try:
            new_priority = int(new_priority)
            if not (1 <= new_priority <= 1000):
                raise ValueError("Priority must be between 1 and 1000")
        except ValueError as e:
            return jsonify({
                'success': False,
                'error': str(e),
                'code': 'INVALID_PRIORITY'
            }), 400
        
        from ..models import ProductionItem
        
        # Znajdź produkt
        product = ProductionItem.query.filter_by(short_product_id=product_id).first()
        if not product:
            return jsonify({
                'success': False,
                'error': 'Product not found',
                'code': 'PRODUCT_NOT_FOUND'
            }), 404
        
        old_priority = product.priority_score
        product.priority_score = new_priority
        product.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        logger.info("Zaktualizowano priorytet produktu", extra={
            'product_id': product_id,
            'old_priority': old_priority,
            'new_priority': new_priority,
            'user_id': current_user.id
        })
        
        return jsonify({
            'success': True,
            'message': 'Priority updated successfully',
            'data': {
                'product_id': product_id,
                'old_priority': old_priority,
                'new_priority': new_priority,
                'updated_by': current_user.id,
                'updated_at': product.updated_at.isoformat()
            }
        }), 200
        
    except Exception as e:
        db.session.rollback()
        logger.error("Błąd aktualizacji priorytetu", extra={
            'product_id': data.get('product_id') if 'data' in locals() else 'unknown',
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': str(e),
            'code': 'UPDATE_PRIORITY_ERROR'
        }), 500

@api_bp.route('/recalculate-priorities', methods=['POST'])
@admin_required
def recalculate_priorities():
    """
    Przelicza priorytety wszystkich aktywnych produktów (tylko admin)
    
    Returns:
        JSON: Status operacji i liczba zaktualizowanych produktów
    """
    try:
        from ..models import ProductionItem
        from ..services.priority_service import get_priority_calculator
        
        priority_calc = get_priority_calculator()
        if not priority_calc:
            return jsonify({
                'success': False,
                'error': 'Priority calculator not available',
                'code': 'PRIORITY_CALC_UNAVAILABLE'
            }), 500
        
        # Pobierz aktywne produkty
        active_products = ProductionItem.query.filter(
            ProductionItem.current_status.in_([
                'czeka_na_wyciecie',
                'czeka_na_skladanie', 
                'czeka_na_pakowanie'
            ])
        ).all()
        
        updated_count = 0
        for product in active_products:
            try:
                # Przygotowanie danych do obliczenia
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
                logger.warning("Błąd przeliczania priorytetu produktu", extra={
                    'product_id': product.short_product_id,
                    'error': str(e)
                })
                continue
        
        db.session.commit()
        
        logger.info("Przeliczono priorytety produktów", extra={
            'total_products': len(active_products),
            'updated_count': updated_count,
            'user_id': current_user.id
        })
        
        return jsonify({
            'success': True,
            'message': 'Priorities recalculated successfully',
            'data': {
                'total_products': len(active_products),
                'updated_count': updated_count,
                'recalculated_by': current_user.id,
                'recalculated_at': datetime.utcnow().isoformat()
            }
        }), 200
        
    except Exception as e:
        db.session.rollback()
        logger.error("Błąd przeliczania priorytetów", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': str(e),
            'code': 'RECALCULATE_PRIORITIES_ERROR'
        }), 500

# ============================================================================
# ENDPOINTS MONITORINGU I STATYSTYK  
# ============================================================================

@api_bp.route('/health', methods=['GET'])
@login_required
def health_check():
    """
    Health check endpoint dla modułu production
    
    Returns:
        JSON: Status zdrowia systemu
    """
    try:
        health_data = {
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'module': 'production',
            'version': '1.2.0'
        }
        
        # Sprawdzenie bazy danych
        try:
            from ..models import ProductionItem
            db.session.execute('SELECT 1').fetchone()
            health_data['database'] = 'connected'
        except Exception as e:
            health_data['database'] = 'error'
            health_data['database_error'] = str(e)
            health_data['status'] = 'degraded'
        
        # Sprawdzenie API Baselinker
        try:
            from ..services.sync_service import get_sync_status
            sync_status = get_sync_status()
            health_data['baselinker_api'] = 'configured' if sync_status.get('sync_enabled') else 'not_configured'
        except Exception as e:
            health_data['baselinker_api'] = 'error'
            health_data['baselinker_error'] = str(e)
            health_data['status'] = 'degraded'
        
        # Sprawdzenie cache
        try:
            from ..services.config_service import get_config_service
            config_service = get_config_service()
            cache_stats = config_service.get_cache_stats()
            health_data['cache'] = 'active'
            health_data['cache_stats'] = cache_stats
        except Exception as e:
            health_data['cache'] = 'error'
            health_data['cache_error'] = str(e)
        
        # Sprawdzenie błędów
        try:
            from ..models import ProductionError
            recent_errors = ProductionError.query.filter(
                ProductionError.error_occurred_at >= datetime.utcnow() - timedelta(hours=1),
                ProductionError.is_resolved == False
            ).count()
            health_data['pending_errors'] = recent_errors
            if recent_errors > 10:
                health_data['status'] = 'degraded'
        except Exception as e:
            health_data['pending_errors'] = 'unknown'
        
        # Sprawdzenie synchronizacji
        try:
            last_sync = get_sync_status().get('last_sync', {})
            if last_sync and last_sync.get('timestamp'):
                last_sync_time = datetime.fromisoformat(last_sync['timestamp'].replace('Z', '+00:00'))
                hours_since_sync = (datetime.utcnow() - last_sync_time).total_seconds() / 3600
                
                health_data['last_sync'] = last_sync['timestamp']
                health_data['hours_since_last_sync'] = round(hours_since_sync, 1)
                
                if hours_since_sync > 25:  # Ponad 25h od ostatniej sync
                    health_data['status'] = 'degraded'
                    health_data['sync_warning'] = 'Last sync too old'
            else:
                health_data['last_sync'] = None
                
        except Exception as e:
            health_data['sync_check_error'] = str(e)
        
        # Status końcowy
        status_code = 200
        if health_data['status'] == 'degraded':
            status_code = 200  # Nadal 200, ale ze statusem degraded
        elif health_data['status'] != 'healthy':
            status_code = 503
        
        return jsonify(health_data), status_code
        
    except Exception as e:
        logger.error("Błąd health check", extra={'error': str(e)})
        return jsonify({
            'status': 'error',
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500

@api_bp.route('/stats', methods=['GET'])
@login_required  
def get_stats():
    """
    Pobiera statystyki produkcji
    
    Query params:
        timeframe: today|week|month (default: today)
        detailed: true|false (default: false)
    
    Returns:
        JSON: Statystyki produkcji
    """
    try:
        timeframe = request.args.get('timeframe', 'today')
        detailed = request.args.get('detailed', 'false').lower() == 'true'
        
        from ..models import ProductionItem, ProductionSyncLog
        from sqlalchemy import func, and_
        
        # Określenie zakresu czasowego
        now = datetime.utcnow()
        if timeframe == 'today':
            start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif timeframe == 'week':
            start_date = now - timedelta(days=7)
        elif timeframe == 'month':
            start_date = now - timedelta(days=30)
        else:
            start_date = now - timedelta(days=1)
        
        stats = {
            'timeframe': timeframe,
            'period_start': start_date.isoformat(),
            'period_end': now.isoformat(),
            '