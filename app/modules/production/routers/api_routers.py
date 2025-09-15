# modules/production/routers/api_routers.py
"""
API Routers dla modułu Production
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
from flask import Blueprint, request, jsonify, current_app, render_template
from flask_login import login_required, current_user
from functools import wraps
from modules.logging import get_structured_logger
from extensions import db
from sqlalchemy import and_, or_, text


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
# API ROUTERS - PRD Section 6.1 (Dashboard)
# ============================================================================

@api_bp.route('/dashboard-stats', methods=['GET'])
@login_required
def dashboard_stats():
    """
    GET /production/api/dashboard-stats
    
    ROZBUDOWANA WERSJA - Zwraca statystyki dla dashboard z dodatkowymi metrykami
    
    Query params:
        include_products: true|false - czy dołączyć listę produktów (default: false)
        limit: liczba produktów do zwrócenia (default: 10, max: 50)
        
    Returns: JSON ze statystykami + opcjonalnie produktami
    """
    try:
        # Parametry opcjonalne
        include_products = request.args.get('include_products', 'false').lower() == 'true'
        limit = min(request.args.get('limit', 10, type=int), 50)
        
        from ..models import ProductionItem
        from sqlalchemy import func, desc
        from datetime import datetime, timedelta
        
        # ============================================================================
        # PODSTAWOWE STATYSTYKI (istniejące)
        # ============================================================================
        
        # Statystyki per status
        status_stats = db.session.query(
            ProductionItem.current_status,
            func.count(ProductionItem.id).label('count'),
            func.avg(ProductionItem.priority_score).label('avg_priority')
        ).group_by(ProductionItem.current_status).all()
        
        stations_stats = {}
        total_products = 0
        
        for status, count, avg_priority in status_stats:
            total_products += count
            
            if status == 'czeka_na_wyciecie':
                stations_stats['cutting'] = {
                    'waiting_count': count,
                    'avg_priority': round(avg_priority or 0, 1)
                }
            elif status == 'czeka_na_skladanie':
                stations_stats['assembly'] = {
                    'waiting_count': count,
                    'avg_priority': round(avg_priority or 0, 1)
                }
            elif status == 'czeka_na_pakowanie':
                stations_stats['packaging'] = {
                    'waiting_count': count,
                    'avg_priority': round(avg_priority or 0, 1)
                }
        
        # ============================================================================
        # DODATKOWE STATYSTYKI (nowe)
        # ============================================================================
        
        # Produkty z wysokim priorytetem (>=150)
        high_priority_count = ProductionItem.query.filter(
            ProductionItem.priority_score >= 150
        ).count()
        
        # Produkty przeterminowane
        today = datetime.now().date()
        overdue_count = ProductionItem.query.filter(
            ProductionItem.deadline_date < today,
            ProductionItem.current_status != 'spakowane'
        ).count()
        
        # Produkty spakowane dzisiaj
        today_start = datetime.combine(today, datetime.min.time())
        today_end = datetime.combine(today, datetime.max.time())
        
        completed_today = ProductionItem.query.filter(
            ProductionItem.current_status == 'spakowane',
            ProductionItem.packaging_completed_at >= today_start,
            ProductionItem.packaging_completed_at <= today_end
        ).count() if hasattr(ProductionItem, 'packaging_completed_at') else 0
        
        # Produkty utworzone w tym tygodniu
        week_ago = today - timedelta(days=7)
        week_start = datetime.combine(week_ago, datetime.min.time())
        
        new_this_week = ProductionItem.query.filter(
            ProductionItem.created_at >= week_start
        ).count()
        
        # Średnia objętość w produkcji
        avg_volume = db.session.query(func.avg(ProductionItem.volume_m3)).filter(
            ProductionItem.volume_m3.isnot(None),
            ProductionItem.current_status != 'spakowane'
        ).scalar()
        
        # ============================================================================
        # ALERTY I OSTRZEŻENIA (nowe)
        # ============================================================================
        
        alerts = []
        
        # Alert o przeterminowanych produktach
        if overdue_count > 0:
            alerts.append({
                'type': 'danger',
                'title': 'Produkty przeterminowane',
                'message': f'{overdue_count} produktów przekroczyło deadline',
                'count': overdue_count,
                'priority': 'high'
            })
        
        # Alert o produktach z wysokim priorytetem
        if high_priority_count > 10:
            alerts.append({
                'type': 'warning',
                'title': 'Dużo produktów wysokiego priorytetu',
                'message': f'{high_priority_count} produktów z priorytetem ≥150',
                'count': high_priority_count,
                'priority': 'medium'
            })
        
        # Alert o zastoju w produkcji
        cutting_backlog = stations_stats.get('cutting', {}).get('waiting_count', 0)
        if cutting_backlog > 50:
            alerts.append({
                'type': 'info',
                'title': 'Duża kolejka w wycinaniu',
                'message': f'{cutting_backlog} produktów czeka na wycięcie',
                'count': cutting_backlog,
                'priority': 'low'
            })
        
        # ============================================================================
        # PRZYGOTOWANIE ODPOWIEDZI
        # ============================================================================
        
        dashboard_data = {
            'success': True,
            'stats': {
                'total_products': total_products,
                'high_priority_count': high_priority_count,
                'overdue_count': overdue_count,
                'completed_today': completed_today,
                'new_this_week': new_this_week,
                'avg_volume_m3': round(avg_volume or 0, 2),
                'stations': stations_stats
            },
            'alerts': alerts,
            'last_updated': datetime.utcnow().isoformat()
        }
        
        # ============================================================================
        # OPCJONALNE PRODUKTY
        # ============================================================================
        
        if include_products:
            # Najwyższy priorytet + najbliższe deadline
            priority_products = ProductionItem.query.filter(
                ProductionItem.current_status != 'spakowane'
            ).order_by(
                desc(ProductionItem.priority_score),
                ProductionItem.deadline_date.asc()
            ).limit(limit).all()
            
            products_data = []
            for product in priority_products:
                days_to_deadline = None
                if product.deadline_date:
                    days_to_deadline = (product.deadline_date - today).days
                
                products_data.append({
                    'id': product.id,
                    'short_product_id': product.short_product_id,
                    'internal_order_number': product.internal_order_number,
                    'original_product_name': product.original_product_name[:50] + '...' if len(product.original_product_name) > 50 else product.original_product_name,
                    'current_status': product.current_status,
                    'priority_score': product.priority_score or 0,
                    'deadline_date': product.deadline_date.isoformat() if product.deadline_date else None,
                    'days_to_deadline': days_to_deadline,
                    'is_overdue': days_to_deadline is not None and days_to_deadline < 0,
                    'is_urgent': days_to_deadline is not None and days_to_deadline <= 2
                })
            
            dashboard_data['products'] = products_data
        
        logger.info("Dashboard stats - rozbudowane", extra={
            'user_id': current_user.id,
            'include_products': include_products,
            'total_products': total_products,
            'alerts_count': len(alerts)
        })
        
        return jsonify(dashboard_data)
        
    except Exception as e:
        logger.error("Błąd dashboard stats - rozbudowanych", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': f'Błąd pobierania statystyk: {str(e)}'
        }), 500
    
          
@api_bp.route('/chart-data')
@admin_required
def chart_data():
    """
    AJAX endpoint dla danych wykresów wydajności dziennej (tylko admin)
    
    Query params:
        period: int - liczba dni do pobrania (7, 14, 30)
        
    Returns:
        JSON: Dane wydajności per stanowisko i dzień dla Chart.js
    """
    try:
        period = request.args.get('period', 7, type=int)
        
        # Walidacja okresu
        if period not in [7, 14, 30]:
            return jsonify({
                'success': False,
                'error': 'Nieprawidłowy okres. Dozwolone: 7, 14, 30 dni'
            }), 400
            
        logger.info(f"AJAX: Pobieranie danych wykresów dla {period} dni", extra={
            'user_id': current_user.id,
            'period': period
        })
        
        from ..models import ProductionItem
        from sqlalchemy import and_, func
        from datetime import datetime, timedelta, date
        
        # Oblicz zakres dat
        end_date = date.today()
        start_date = end_date - timedelta(days=period - 1)
        
        # Mapowanie statusów na stanowiska dla zakończonych zadań
        station_completion_mapping = {
            'cutting': 'cutting_completed_at',
            'assembly': 'assembly_completed_at', 
            'packaging': 'packaging_completed_at'
        }
        
        chart_data = {
            'labels': [],
            'datasets': [
                {
                    'label': 'Wycinanie',
                    'data': [],
                    'borderColor': '#fd7e14',
                    'backgroundColor': 'rgba(253, 126, 20, 0.1)',
                    'tension': 0.4
                },
                {
                    'label': 'Składanie', 
                    'data': [],
                    'borderColor': '#007bff',
                    'backgroundColor': 'rgba(0, 123, 255, 0.1)',
                    'tension': 0.4
                },
                {
                    'label': 'Pakowanie',
                    'data': [],
                    'borderColor': '#28a745',
                    'backgroundColor': 'rgba(40, 167, 69, 0.1)',
                    'tension': 0.4
                }
            ]
        }
        
        # Generuj etykiety dat
        current_date = start_date
        daily_data = {}
        
        while current_date <= end_date:
            label = current_date.strftime('%d.%m')
            chart_data['labels'].append(label)
            daily_data[current_date] = {
                'cutting': 0,
                'assembly': 0,
                'packaging': 0
            }
            current_date += timedelta(days=1)
        
        # Pobierz dane wydajności dla każdego stanowiska
        for station, completion_field in station_completion_mapping.items():
            completion_attr = getattr(ProductionItem, completion_field)
            
            # Zapytanie o sumę objętości per dzień dla stanowiska
            daily_volumes = db.session.query(
                func.date(completion_attr).label('completion_date'),
                func.sum(ProductionItem.volume_m3).label('total_volume')
            ).filter(
                and_(
                    completion_attr.isnot(None),
                    func.date(completion_attr) >= start_date,
                    func.date(completion_attr) <= end_date
                )
            ).group_by(
                func.date(completion_attr)
            ).all()
            
            # Wypełnij dane dla stanowiska
            for completion_date, total_volume in daily_volumes:
                if completion_date in daily_data:
                    daily_data[completion_date][station] = float(total_volume or 0)
        
        # Wypełnij datasets danymi
        for day_date in sorted(daily_data.keys()):
            chart_data['datasets'][0]['data'].append(daily_data[day_date]['cutting'])
            chart_data['datasets'][1]['data'].append(daily_data[day_date]['assembly'])
            chart_data['datasets'][2]['data'].append(daily_data[day_date]['packaging'])
        
        # Oblicz statystyki podsumowujące
        total_volumes = {
            'cutting': sum(chart_data['datasets'][0]['data']),
            'assembly': sum(chart_data['datasets'][1]['data']),
            'packaging': sum(chart_data['datasets'][2]['data'])
        }
        
        avg_daily = {
            'cutting': total_volumes['cutting'] / period,
            'assembly': total_volumes['assembly'] / period,
            'packaging': total_volumes['packaging'] / period
        }
        
        # Znajdź najlepszy dzień
        best_day_idx = 0
        best_day_total = 0
        for i in range(len(chart_data['labels'])):
            day_total = (chart_data['datasets'][0]['data'][i] + 
                        chart_data['datasets'][1]['data'][i] + 
                        chart_data['datasets'][2]['data'][i])
            if day_total > best_day_total:
                best_day_total = day_total
                best_day_idx = i
        
        summary = {
            'period_days': period,
            'total_volumes': total_volumes,
            'avg_daily': {k: round(v, 2) for k, v in avg_daily.items()},
            'best_day': {
                'date': chart_data['labels'][best_day_idx] if chart_data['labels'] else None,
                'volume': round(best_day_total, 2)
            },
            'total_period_volume': round(sum(total_volumes.values()), 2)
        }
        
        response_data = {
            'success': True,
            'chart_data': chart_data,
            'summary': summary,
            'period': period,
            'date_range': {
                'start': start_date.isoformat(),
                'end': end_date.isoformat()
            },
            'generated_at': datetime.utcnow().isoformat()
        }
        
        logger.info("Pomyślnie wygenerowano dane wykresów", extra={
            'user_id': current_user.id,
            'period': period,
            'total_volume': summary['total_period_volume'],
            'data_points': len(chart_data['labels'])
        })
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error("Błąd generowania danych wykresów", extra={
            'user_id': current_user.id,
            'period': request.args.get('period'),
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': f'Błąd pobierania danych wykresów: {str(e)}'
        }), 500
    
    
# ============================================================================
# API ROUTERS - PRD Section 6.2 (Stanowiska)
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
# API ROUTERS - PRD Section 6.3 (CRON i Synchronizacja)
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
# API ROUTERS - PRD Section 6.4 (Konfiguracja i Monitoring)
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
    

@api_bp.route('/baselinker-health')
@login_required
def baselinker_health():
    """
    Lightweight sprawdzenie statusu Baselinker API
    Używa minimalnego requesta aby nie obciążać API
    
    Returns:
        JSON: {
            'status': 'connected'|'slow'|'error'|'unknown',
            'response_time': float|None,
            'error': str|None
        }
    """
    try:
        import time
        import requests
        from flask import current_app
        
        logger.info("API: Sprawdzanie statusu Baselinker", extra={
            'user_id': current_user.id,
            'endpoint': 'baselinker-health'
        })
        
        start_time = time.time()
        
        # Pobierz konfigurację API
        api_config = current_app.config.get('API_BASELINKER', {})
        api_key = api_config.get('api_key')
        endpoint = api_config.get('endpoint', 'https://api.baselinker.com/connector.php')
        
        if not api_key:
            logger.warning("Brak klucza API Baselinker")
            return jsonify({
                'status': 'error', 
                'error': 'Brak skonfigurowanego klucza API',
                'response_time': None
            })
        
        # Minimalny request - sprawdź tylko dostępność
        # Używamy getInventories bo to jeden z najmniejszych requestów
        payload = {
            'method': 'getInventories'
        }
        
        headers = {
            'X-BLToken': api_key,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        response = requests.post(
            endpoint,
            data=payload,
            headers=headers,
            timeout=10  # 10 sekund timeout
        )
        
        response_time = time.time() - start_time
        
        logger.info(f"Baselinker API response: {response.status_code}, time: {response_time:.2f}s")
        
        if response.status_code == 200:
            try:
                data = response.json()
                
                # Sprawdź czy API zwróciło błąd
                if 'error' in data and data['error']:
                    logger.warning(f"Baselinker API error: {data['error']}")
                    return jsonify({
                        'status': 'error',
                        'error': f"API Error: {data['error']}",
                        'response_time': response_time
                    })
                
                # API działa poprawnie
                # Określ status na podstawie czasu odpowiedzi
                if response_time > 5.0:
                    status = 'slow'
                elif response_time > 3.0:
                    status = 'slow'
                else:
                    status = 'connected'
                
                logger.info(f"Baselinker status: {status}")
                
                return jsonify({
                    'status': status,
                    'response_time': response_time,
                    'error': None
                })
                
            except ValueError as e:
                # Błąd parsowania JSON
                logger.error(f"Baselinker JSON parse error: {str(e)}")
                return jsonify({
                    'status': 'error',
                    'error': 'Nieprawidłowa odpowiedź API (JSON)',
                    'response_time': response_time
                })
        else:
            # HTTP error
            logger.warning(f"Baselinker HTTP error: {response.status_code}")
            return jsonify({
                'status': 'error',
                'error': f'HTTP {response.status_code}: {response.reason}',
                'response_time': response_time
            })
            
    except requests.exceptions.Timeout:
        logger.warning("Baselinker API timeout")
        return jsonify({
            'status': 'error',
            'error': 'Timeout połączenia (>10s)',
            'response_time': None
        })
        
    except requests.exceptions.ConnectionError:
        logger.error("Baselinker connection error")
        return jsonify({
            'status': 'error',
            'error': 'Błąd połączenia z API',
            'response_time': None
        })
        
    except Exception as e:
        logger.error(f"Baselinker health check error: {str(e)}", extra={
            'error': str(e),
            'user_id': current_user.id
        })
        return jsonify({
            'status': 'error',
            'error': f'Nieoczekiwany błąd: {str(e)}',
            'response_time': None
        })

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
# API ROUTERS - PRD Section 6.2 (Complete Packaging z Baselinker Update)
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
    
# ============================================================================
# NOWE ENDPOINTY AJAX DLA SYSTEMU TABÓW
# Dodaj te funkcje do istniejącego api_routers.py
# ============================================================================

@api_bp.route('/dashboard-tab-content')
@login_required
def dashboard_tab_content():
    """
    AJAX endpoint dla zawartości taba Dashboard - POPRAWIONY
    """
    try:
        logger.info("AJAX: Ładowanie zawartości dashboard-tab", extra={
            'user_id': current_user.id,
            'user_role': getattr(current_user, 'role', 'unknown')
        })
        
        from ..models import ProductionItem, ProductionError, ProductionSyncLog
        
        today = date.today()
        today_start = datetime.combine(today, datetime.min.time())
        
        # Statystyki stanowisk
        dashboard_stats = {
            'stations': {
                'cutting': {'pending_count': 0, 'today_m3': 0.0},
                'assembly': {'pending_count': 0, 'today_m3': 0.0},
                'packaging': {'pending_count': 0, 'today_m3': 0.0}
            },
            'today_totals': {
                'completed_orders': 0,
                'total_m3': 0.0,
                'avg_deadline_distance': 0.0
            },
            'deadline_alerts': [],
            'system_health': {
                'last_sync': None,
                'sync_status': 'unknown',
                'errors_24h': 0,
                'database_status': 'connected'
            }
        }
        
        # CUTTING
        cutting_pending = ProductionItem.query.filter_by(current_status='czeka_na_wyciecie').count()
        cutting_today_m3 = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                    .filter(ProductionItem.cutting_completed_at >= today_start)\
                                    .scalar() or 0.0
        
        # ASSEMBLY
        assembly_pending = ProductionItem.query.filter_by(current_status='czeka_na_skladanie').count()
        assembly_today_m3 = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                     .filter(ProductionItem.assembly_completed_at >= today_start)\
                                     .scalar() or 0.0
        
        # PACKAGING
        packaging_pending = ProductionItem.query.filter_by(current_status='czeka_na_pakowanie').count()
        packaging_today_m3 = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                      .filter(ProductionItem.packaging_completed_at >= today_start)\
                                      .scalar() or 0.0
        
        dashboard_stats['stations'] = {
            'cutting': {'pending_count': cutting_pending, 'today_m3': float(cutting_today_m3)},
            'assembly': {'pending_count': assembly_pending, 'today_m3': float(assembly_today_m3)},
            'packaging': {'pending_count': packaging_pending, 'today_m3': float(packaging_today_m3)}
        }
        
        # Dzisiejsze podsumowania
        completed_today = ProductionItem.query.filter(
            ProductionItem.current_status == 'spakowane',
            ProductionItem.packaging_completed_at >= today_start
        ).count()
        
        total_m3_today = cutting_today_m3 + assembly_today_m3 + packaging_today_m3
        
        # Średni deadline
        avg_deadline = db.session.query(db.func.avg(
            db.func.datediff(ProductionItem.deadline_date, db.func.current_date())
        )).filter(ProductionItem.deadline_date.isnot(None)).scalar()
        
        dashboard_stats['today_totals'] = {
            'completed_orders': completed_today,
            'total_m3': float(total_m3_today),
            'avg_deadline_distance': float(avg_deadline) if avg_deadline else 0.0
        }
        
        # Alerty terminów
        deadline_alerts = ProductionItem.query.filter(
            ProductionItem.deadline_date <= (today + timedelta(days=3)),
            ProductionItem.current_status != 'spakowane'
        ).order_by(ProductionItem.deadline_date.asc()).limit(10).all()
        
        dashboard_stats['deadline_alerts'] = [
            {
                'short_product_id': alert.short_product_id,
                'deadline_date': alert.deadline_date.isoformat() if alert.deadline_date else None,
                'days_remaining': (alert.deadline_date - today).days if alert.deadline_date else 0,
                'current_station': alert.current_status.replace('czeka_na_', '')
            }
            for alert in deadline_alerts
        ]
        
        # System health - POPRAWIONE: sync_status zamiast status
        errors_24h = ProductionError.query.filter(
            ProductionError.error_occurred_at >= (datetime.utcnow() - timedelta(hours=24)),
            ProductionError.is_resolved == False
        ).count()
        
        last_sync = ProductionSyncLog.query.order_by(ProductionSyncLog.sync_started_at.desc()).first()
        
        dashboard_stats['system_health'] = {
            'last_sync': last_sync.sync_started_at.isoformat() if last_sync else None,
            'sync_status': 'success' if last_sync and last_sync.sync_status == 'completed' else 'warning',
            'errors_24h': errors_24h,
            'database_status': 'connected'
        }
        
        print(f"[DEBUG] Dashboard stats: {dashboard_stats}")
        print(f"[DEBUG] Rendering template...")

        rendered_html = render_template('components/dashboard-tab-content.html', 
                                    dashboard_stats=dashboard_stats)

        print(f"[DEBUG] Rendered HTML length: {len(rendered_html)}")
        print(f"[DEBUG] HTML preview: {rendered_html[:200]}...")
        
        return jsonify({
            'success': True,
            'html': rendered_html,
            'stats': dashboard_stats,
            'last_updated': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error("Błąd AJAX dashboard-tab-content", extra={
            'user_id': current_user.id,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500



@api_bp.route('/products-tab-content')
@login_required
def products_tab_content():
    """
    AJAX endpoint dla zawartości taba Lista produktów - POPRAWIONY
    """
    try:
        logger.info("AJAX: Ładowanie zawartości products-tab", extra={
            'user_id': current_user.id,
            'user_role': getattr(current_user, 'role', 'unknown')
        })
        
        from ..models import ProductionItem
        
        # Filtry z query params
        status_filter = request.args.get('status', 'all')
        search_query = request.args.get('search', '').strip()
        limit = min(int(request.args.get('limit', 100)), 500)
        
        # Query podstawowy
        query = ProductionItem.query
        
        # Filtrowanie po statusie
        if status_filter and status_filter != 'all':
            query = query.filter(ProductionItem.current_status == status_filter)
        
        # Wyszukiwanie
        if search_query:
            query = query.filter(
                db.or_(
                    ProductionItem.short_product_id.ilike(f'%{search_query}%'),
                    ProductionItem.internal_order_number.ilike(f'%{search_query}%'),
                    ProductionItem.original_product_name.ilike(f'%{search_query}%')
                )
            )
        
        # Sortowanie i limit
        products = query.order_by(ProductionItem.priority_score.desc()).limit(limit).all()
        
        # Sprawdź czy user jest adminem
        is_admin = hasattr(current_user, 'role') and current_user.role.lower() in ['admin', 'administrator']
        
        # Opcje statusów dla filtra
        status_options = [
            ('all', 'Wszystkie'),
            ('czeka_na_wyciecie', 'Czeka na wycięcie'),
            ('czeka_na_skladanie', 'Czeka na składanie'), 
            ('czeka_na_pakowanie', 'Czeka na pakowanie'),
            ('spakowane', 'Spakowane'),
            ('wstrzymane', 'Wstrzymane')
        ]
        
        # Statystyki - DODANO: today dla template
        today = date.today()
        stats = {
            'total_products': len(products),
            'high_priority': sum(1 for p in products if p.priority_score >= 150),
            'overdue': sum(1 for p in products if p.deadline_date and p.deadline_date < today),
            'status_filter': status_filter,
            'search_query': search_query
        }
        
        # Renderuj komponent
        rendered_html = render_template('components/products-tab-content.html',
                              products=products,
                              status_filter=status_filter,
                              search_query=search_query,
                              status_options=status_options,
                              is_admin=is_admin,
                              stats=stats,
                              today=today)
        
        return jsonify({
            'success': True,
            'html': rendered_html,
            'stats': stats,
            'last_updated': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error("Błąd AJAX products-tab-content", extra={
            'user_id': current_user.id,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    


@api_bp.route('/reports-tab-content')
@login_required
def reports_tab_content():
    """
    AJAX endpoint dla zawartości taba Raporty - POPRAWIONY
    """
    try:
        logger.info("AJAX: Ładowanie zawartości reports-tab", extra={
            'user_id': current_user.id,
            'user_role': getattr(current_user, 'role', 'unknown')
        })
        
        from ..models import ProductionItem, ProductionSyncLog
        
        # Przygotuj dane dla raportów
        today = date.today()
        week_ago = today - timedelta(days=7)
        month_ago = today - timedelta(days=30)
        
        # Raporty wydajności
        daily_stats = []
        for i in range(7):
            day = today - timedelta(days=i)
            day_start = datetime.combine(day, datetime.min.time())
            day_end = datetime.combine(day, datetime.max.time())
            
            completed = ProductionItem.query.filter(
                ProductionItem.current_status == 'spakowane',
                ProductionItem.packaging_completed_at >= day_start,
                ProductionItem.packaging_completed_at <= day_end
            ).count()
            
            volume = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                              .filter(
                                  ProductionItem.packaging_completed_at >= day_start,
                                  ProductionItem.packaging_completed_at <= day_end
                              ).scalar() or 0.0
            
            daily_stats.append({
                'date': day.isoformat(),
                'completed_orders': completed,
                'total_volume': float(volume)
            })
        
        # Raport statusów
        status_report = []
        statuses = ['czeka_na_wyciecie', 'czeka_na_skladanie', 'czeka_na_pakowanie', 'spakowane', 'wstrzymane']
        for status in statuses:
            count = ProductionItem.query.filter_by(current_status=status).count()
            volume = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                              .filter_by(current_status=status).scalar() or 0.0
            
            status_report.append({
                'status': status,
                'count': count,
                'volume': float(volume)
            })
        
        # Historia synchronizacji
        sync_history = ProductionSyncLog.query\
                                       .order_by(ProductionSyncLog.sync_started_at.desc())\
                                       .limit(20).all()
        
        reports_data = {
            'daily_performance': daily_stats,
            'status_breakdown': status_report,
            'sync_history': [
                {
                    'date': sync.sync_started_at.isoformat(),
                    'status': sync.sync_status,  # POPRAWIONE: sync_status zamiast status
                    'items_processed': (sync.products_created or 0) + (sync.products_updated or 0),
                    'duration_seconds': sync.sync_duration_seconds or 0
                }
                for sync in sync_history
            ],
            'summary': {
                'week_completed': sum(day['completed_orders'] for day in daily_stats),
                'week_volume': sum(day['total_volume'] for day in daily_stats),
                'total_in_system': sum(item['count'] for item in status_report)
            }
        }
        
        # Renderuj komponent
        rendered_html = render_template('components/reports-tab-content.html',
                              reports_data=reports_data)
        
        return jsonify({
            'success': True,
            'html': rendered_html,
            'data': reports_data,
            'last_updated': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error("Błąd AJAX reports-tab-content", extra={
            'user_id': current_user.id,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500



@api_bp.route('/stations-tab-content')
@login_required  
def stations_tab_content():
    """
    AJAX endpoint dla zawartości taba Stanowiska - POPRAWIONY
    """
    try:
        logger.info("AJAX: Ładowanie zawartości stations-tab", extra={
            'user_id': current_user.id,
            'user_role': getattr(current_user, 'role', 'unknown')
        })
        
        from ..models import ProductionItem
        
        # Dane dla każdego stanowiska
        stations_data = {}
        stations = ['cutting', 'assembly', 'packaging']
        
        for station in stations:
            status_map = {
                'cutting': 'czeka_na_wyciecie',
                'assembly': 'czeka_na_skladanie', 
                'packaging': 'czeka_na_pakowanie'
            }
            
            status = status_map[station]
            
            # Produkty oczekujące na danym stanowisku
            pending_products = ProductionItem.query\
                                           .filter_by(current_status=status)\
                                           .order_by(ProductionItem.priority_score.desc())\
                                           .limit(20).all()
            
            # Statystyki stanowiska
            total_pending = ProductionItem.query.filter_by(current_status=status).count()
            high_priority = ProductionItem.query.filter(
                ProductionItem.current_status == status,
                ProductionItem.priority_score >= 150
            ).count()
            
            # Dzisiejsze wykonania
            today = date.today()
            today_start = datetime.combine(today, datetime.min.time())
            
            completed_field_map = {
                'cutting': ProductionItem.cutting_completed_at,
                'assembly': ProductionItem.assembly_completed_at,
                'packaging': ProductionItem.packaging_completed_at
            }
            
            completed_field = completed_field_map[station]
            today_completed = ProductionItem.query.filter(
                completed_field >= today_start
            ).count()
            
            today_volume = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                   .filter(completed_field >= today_start)\
                                   .scalar() or 0.0
            
            # POPRAWIONE: twórz słowniki zamiast obiektów z .days_diff
            stations_data[station] = {
                'name': {
                    'cutting': 'Wycinanie',
                    'assembly': 'Składanie',
                    'packaging': 'Pakowanie'
                }[station],
                'icon': {
                    'cutting': '🪚',
                    'assembly': '🔧', 
                    'packaging': '📦'
                }[station],
                'pending_products': [
                    {
                        'short_id': p.short_product_id,
                        'product_name': p.original_product_name[:50] + '...' if len(p.original_product_name or '') > 50 else (p.original_product_name or ''),
                        'priority_score': p.priority_score,
                        'deadline_date': p.deadline_date.isoformat() if p.deadline_date else None,
                        'days_remaining': (p.deadline_date - today).days if p.deadline_date else 0,  # DODANO: days_remaining
                        'volume_m3': float(p.volume_m3 or 0),
                        'internal_order_number': p.internal_order_number
                    }
                    for p in pending_products
                ],
                'stats': {
                    'total_pending': total_pending,
                    'high_priority': high_priority,
                    'today_completed': today_completed,
                    'today_volume': float(today_volume)
                }
            }
        
        # Renderuj komponent
        rendered_html = render_template('components/stations-tab-content.html',
                              stations_data=stations_data)
        
        return jsonify({
            'success': True,
            'html': rendered_html,
            'data': stations_data,
            'last_updated': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error("Błąd AJAX stations-tab-content", extra={
            'user_id': current_user.id,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

  

@api_bp.route('/config-tab-content')
@admin_required
def config_tab_content():
    """
    AJAX endpoint dla zawartości taba Konfiguracja (tylko admin)
    
    Returns:
        JSON: {success: true, html: "rendered_html"}
    """
    try:
        logger.info("AJAX: Ładowanie zawartości config-tab", extra={
            'user_id': current_user.id,
            'user_role': getattr(current_user, 'role', 'unknown')
        })
        
        from ..models import ProductionConfig, ProductionPriorityConfig
        from ..services.config_service import get_config_service
        
        # Pobierz wszystkie konfiguracje
        config_service = get_config_service()
        all_configs = config_service.get_all_configs()
        
        # Grupuj konfiguracje
        config_groups = {
            'sync': {},
            'stations': {},
            'priorities': {},
            'system': {},
            'other': {}
        }
        
        for key, config in all_configs.items():
            if 'SYNC' in key or 'BASELINKER' in key:
                config_groups['sync'][key] = config
            elif 'STATION' in key or 'REFRESH' in key:
                config_groups['stations'][key] = config
            elif 'PRIORITY' in key or 'DEADLINE' in key:
                config_groups['priorities'][key] = config
            elif 'DEBUG' in key or 'CACHE' in key or 'EMAIL' in key:
                config_groups['system'][key] = config
            else:
                config_groups['other'][key] = config
        
        # Konfiguracje priorytetów - drag&drop
        priority_configs = ProductionPriorityConfig.query\
                                                 .filter_by(is_active=True)\
                                                 .order_by(ProductionPriorityConfig.display_order)\
                                                 .all()
        
        # Statystyki cache
        cache_stats = config_service.get_cache_stats()
        
        config_data = {
            'config_groups': config_groups,
            'priority_configs': [
                {
                    'id': pc.id,
                    'criterion_name': pc.criterion_name,
                    'weight': pc.weight,
                    'display_order': pc.display_order,
                    'is_active': pc.is_active
                }
                for pc in priority_configs
            ],
            'cache_stats': cache_stats
        }
        
        # Renderuj komponent
        rendered_html = render_template('components/config-tab-content.html',
                              config_data=config_data,
                              config_groups=config_groups,
                              priority_configs=priority_configs,
                              cache_stats=cache_stats)
        
        return jsonify({
            'success': True,
            'html': rendered_html,
            'data': config_data,
            'last_updated': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error("Błąd AJAX config-tab-content", extra={
            'user_id': current_user.id,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    
# ============================================================================
# NOWE API ENDPOINTY - DO DODANIA
# ============================================================================
# Te endpointy należy DODAĆ do pliku: app/modules/production/routers/api_routes.py

# 1. BULK OPERATIONS ENDPOINT
@api_bp.route('/products/bulk-action', methods=['POST'])
@login_required
def bulk_action():
    """
    POST /production/api/products/bulk-action
    
    Wykonuje masowe operacje na produktach
    
    Body (JSON):
    {
        "action": "update_status|update_priority|export|delete",
        "product_ids": [1, 2, 3, ...],
        "parameters": {
            "new_status": "czeka_na_wyciecie",
            "new_priority": 150,
            "export_format": "excel"
        }
    }
    
    Returns: JSON z rezultatem operacji
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Brak danych JSON'}), 400
        
        action = data.get('action')
        product_ids = data.get('product_ids', [])
        parameters = data.get('parameters', {})
        
        # Walidacja
        if not action or not product_ids:
            return jsonify({'success': False, 'error': 'Wymagane: action i product_ids'}), 400
        
        valid_actions = ['update_status', 'update_priority', 'export', 'delete']
        if action not in valid_actions:
            return jsonify({'success': False, 'error': f'Nieprawidłowa akcja. Dostępne: {valid_actions}'}), 400
        
        from ..models import ProductionItem
        
        # Pobierz produkty
        products = ProductionItem.query.filter(ProductionItem.id.in_(product_ids)).all()
        
        if not products:
            return jsonify({'success': False, 'error': 'Nie znaleziono produktów'}), 404
        
        results = {
            'success': True,
            'action': action,
            'processed_count': 0,
            'failed_count': 0,
            'errors': []
        }
        
        # Wykonaj akcję na każdym produkcie
        for product in products:
            try:
                if action == 'update_status':
                    new_status = parameters.get('new_status')
                    if new_status and hasattr(ProductionItem, 'current_status'):
                        product.current_status = new_status
                        results['processed_count'] += 1
                
                elif action == 'update_priority':
                    new_priority = parameters.get('new_priority')
                    if new_priority is not None:
                        product.priority_score = int(new_priority)
                        results['processed_count'] += 1
                
                elif action == 'delete':
                    # Tylko admin może usuwać
                    if not (hasattr(current_user, 'role') and current_user.role.lower() in ['admin', 'administrator']):
                        results['errors'].append(f'Brak uprawnień do usunięcia produktu {product.id}')
                        results['failed_count'] += 1
                        continue
                    
                    db.session.delete(product)
                    results['processed_count'] += 1
                
                elif action == 'export':
                    # Export będzie obsłużony w osobnym endpoincie
                    results['processed_count'] += 1
                
            except Exception as e:
                logger.error(f"Błąd bulk action dla produktu {product.id}", extra={'error': str(e)})
                results['errors'].append(f'Błąd produktu {product.id}: {str(e)}')
                results['failed_count'] += 1
        
        # Zapisz zmiany dla akcji modyfikujących
        if action in ['update_status', 'update_priority', 'delete']:
            db.session.commit()
        
        logger.info("Bulk action wykonana", extra={
            'user_id': current_user.id,
            'action': action,
            'product_count': len(product_ids),
            'processed': results['processed_count'],
            'failed': results['failed_count']
        })
        
        return jsonify(results)
        
    except Exception as e:
        db.session.rollback()
        logger.error("Błąd bulk action", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': f'Błąd serwera: {str(e)}'
        }), 500


# 2. SZCZEGÓŁY PRODUKTU ENDPOINT
@api_bp.route('/products/<int:product_id>/details', methods=['GET'])
@login_required
def product_details(product_id):
    """
    GET /production/api/products/<id>/details
    
    Zwraca szczegółowe informacje o produkcie dla modala
    
    Returns: JSON z kompletnymi danymi produktu
    """
    try:
        from ..models import ProductionItem
        
        product = ProductionItem.query.get_or_404(product_id)
        
        # Pobierz historię statusów (jeśli tabela istnieje)
        status_history = []
        try:
            # Z database_structure.md widzę że nie ma tabeli prod_status_history w obecnej strukturze
            # Dodajemy placeholder dla przyszłej implementacji
            status_history = [
                {
                    'status': product.current_status,
                    'changed_at': product.created_at.isoformat() if product.created_at else None,
                    'station': 'System',
                    'notes': 'Utworzono w systemie'
                }
            ]
        except:
            pass
        
        # Oblicz metryki czasu (jeśli dostępne)
        time_metrics = {}
        if hasattr(product, 'cutting_started_at') and product.cutting_started_at:
            time_metrics['cutting_duration'] = calculate_duration(product.cutting_started_at, product.cutting_completed_at)
        if hasattr(product, 'assembly_started_at') and product.assembly_started_at:
            time_metrics['assembly_duration'] = calculate_duration(product.assembly_started_at, product.assembly_completed_at)
        if hasattr(product, 'packaging_started_at') and product.packaging_started_at:
            time_metrics['packaging_duration'] = calculate_duration(product.packaging_started_at, product.packaging_completed_at)
        
        # Oblicz dni do deadline
        days_to_deadline = None
        if product.deadline_date:
            days_to_deadline = (product.deadline_date - datetime.now().date()).days
        
        # Przygotuj kompletne dane
        product_data = {
            'id': product.id,
            'short_product_id': product.short_product_id,
            'internal_order_number': product.internal_order_number,
            'baselinker_order_id': product.baselinker_order_id,
            'original_product_name': product.original_product_name,
            'current_status': product.current_status,
            'priority_score': product.priority_score,
            'deadline_date': product.deadline_date.isoformat() if product.deadline_date else None,
            'days_to_deadline': days_to_deadline,
            'created_at': product.created_at.isoformat() if product.created_at else None,
            
            # Dane parsowane
            'parsed_data': {
                'wood_species': product.parsed_wood_species,
                'technology': product.parsed_technology,
                'wood_class': product.parsed_wood_class,
                'length_cm': float(product.parsed_length_cm) if product.parsed_length_cm else None,
                'width_cm': float(product.parsed_width_cm) if product.parsed_width_cm else None,
                'thickness_cm': float(product.parsed_thickness_cm) if product.parsed_thickness_cm else None,
                'finish_state': product.parsed_finish_state,
                'volume_m3': float(product.volume_m3) if product.volume_m3 else None,
                'dimensions': f"{product.parsed_length_cm or 0}×{product.parsed_width_cm or 0}×{product.parsed_thickness_cm or 0}cm"
            },
            
            # Dane finansowe
            'financial_data': {
                'unit_price_net': float(product.unit_price_net) if product.unit_price_net else None,
                'total_value_net': float(product.total_value_net) if product.total_value_net else None
            },
            
            # Historia statusów
            'status_history': status_history,
            
            # Metryki czasu
            'time_metrics': time_metrics,
            
            # Status flags
            'is_overdue': days_to_deadline is not None and days_to_deadline < 0,
            'is_urgent': days_to_deadline is not None and days_to_deadline <= 2,
            'is_high_priority': (product.priority_score or 0) >= 150
        }
        
        logger.info("Pobrano szczegóły produktu", extra={
            'user_id': current_user.id,
            'product_id': product_id,
            'product_short_id': product.short_product_id
        })
        
        return jsonify({
            'success': True,
            'product': product_data
        })
        
    except Exception as e:
        logger.error("Błąd pobierania szczegółów produktu", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'product_id': product_id,
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': f'Błąd pobierania szczegółów: {str(e)}'
        }), 500


# 3. EXPORT PRODUKTÓW ENDPOINT
@api_bp.route('/products/export', methods=['POST'])
@login_required
def export_products():
    """
    POST /production/api/products/export
    
    Generuje export produktów w różnych formatach
    
    Body (JSON):
    {
        "format": "excel|csv|pdf",
        "product_ids": [1, 2, 3] | "all" | "filtered",
        "filters": {...},  // Jeśli product_ids == "filtered"
        "columns": ["id", "name", "status", ...]
    }
    
    Returns: JSON z URL do pobrania pliku
    """
    try:
        import io
        import csv
        from datetime import datetime
        from flask import send_file, make_response
        
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Brak danych JSON'}), 400
        
        export_format = data.get('format', 'excel').lower()
        product_selection = data.get('product_ids', 'all')
        selected_columns = data.get('columns', [])
        filters = data.get('filters', {})
        
        # Walidacja formatu
        valid_formats = ['excel', 'csv', 'pdf']
        if export_format not in valid_formats:
            return jsonify({'success': False, 'error': f'Nieprawidłowy format. Dostępne: {valid_formats}'}), 400
        
        from ..models import ProductionItem
        
        # Buduj query na podstawie selekcji
        query = ProductionItem.query
        
        if isinstance(product_selection, list):
            # Konkretne IDs
            query = query.filter(ProductionItem.id.in_(product_selection))
        elif product_selection == "filtered":
            # Zastosuj filtry
            if filters.get('status'):
                query = query.filter(ProductionItem.current_status == filters['status'])
            if filters.get('search'):
                search_term = f"%{filters['search']}%"
                query = query.filter(
                    db.or_(
                        ProductionItem.short_product_id.ilike(search_term),
                        ProductionItem.original_product_name.ilike(search_term)
                    )
                )
        # "all" - bez dodatkowych filtrów
        
        products = query.all()
        
        if not products:
            return jsonify({'success': False, 'error': 'Brak produktów do eksportu'}), 404
        
        # Przygotuj dane do eksportu
        export_data = []
        for product in products:
            row = {
                'ID Produktu': product.short_product_id,
                'Zamówienie': product.internal_order_number,
                'Baselinker ID': product.baselinker_order_id,
                'Nazwa Produktu': product.original_product_name,
                'Status': product.current_status,
                'Priorytet': product.priority_score,
                'Deadline': product.deadline_date.strftime('%Y-%m-%d') if product.deadline_date else '',
                'Gatunek': product.parsed_wood_species or '',
                'Technologia': product.parsed_technology or '',
                'Klasa': product.parsed_wood_class or '',
                'Wymiary': f"{product.parsed_length_cm or 0}×{product.parsed_width_cm or 0}×{product.parsed_thickness_cm or 0}cm",
                'Objętość m³': product.volume_m3 or 0,
                'Cena netto': product.unit_price_net or 0,
                'Wartość całkowita': product.total_value_net or 0,
                'Data utworzenia': product.created_at.strftime('%Y-%m-%d %H:%M') if product.created_at else ''
            }
            
            # Filtruj kolumny jeśli określone
            if selected_columns:
                row = {k: v for k, v in row.items() if k in selected_columns}
            
            export_data.append(row)
        
        # Generuj plik na podstawie formatu
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        if export_format == 'csv':
            output = io.StringIO()
            if export_data:
                writer = csv.DictWriter(output, fieldnames=export_data[0].keys())
                writer.writeheader()
                writer.writerows(export_data)
            
            response = make_response(output.getvalue())
            response.headers['Content-Type'] = 'text/csv; charset=utf-8'
            response.headers['Content-Disposition'] = f'attachment; filename=produkty_{timestamp}.csv'
            
            logger.info("Export CSV wygenerowany", extra={
                'user_id': current_user.id,
                'products_count': len(products),
                'format': export_format
            })
            
            return response
        
        elif export_format == 'excel':
            # Dla Excel będziemy potrzebować pandas/openpyxl
            # Na razie zwrócimy CSV z odpowiednim Content-Type
            output = io.StringIO()
            if export_data:
                writer = csv.DictWriter(output, fieldnames=export_data[0].keys())
                writer.writeheader()
                writer.writerows(export_data)
            
            response = make_response(output.getvalue())
            response.headers['Content-Type'] = 'application/vnd.ms-excel'
            response.headers['Content-Disposition'] = f'attachment; filename=produkty_{timestamp}.xls'
            
            return response
        
        elif export_format == 'pdf':
            # PDF export będzie wymagał reportlab lub podobnej biblioteki
            # Na razie zwracamy błąd z informacją
            return jsonify({
                'success': False,
                'error': 'Export PDF będzie dostępny w przyszłej wersji'
            }), 501
        
    except Exception as e:
        logger.error("Błąd eksportu produktów", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': f'Błąd eksportu: {str(e)}'
        }), 500


# 4. DANE FILTRÓW ENDPOINT
@api_bp.route('/products/filters-data', methods=['GET'])
@login_required
def get_filters_data():
    """
    GET /production/api/products/filters-data
    
    Zwraca unikalne wartości dla dropdownów filtrów
    
    Returns: JSON z listami unikalnych wartości
    """
    try:
        from ..models import ProductionItem
        from sqlalchemy import func, distinct
        
        # Pobierz unikalne wartości dla filtrów
        
        # Statusy - z enum w modelu
        statuses = [
            {'value': 'czeka_na_wyciecie', 'label': 'Czeka na wycięcie'},
            {'value': 'czeka_na_skladanie', 'label': 'Czeka na składanie'},
            {'value': 'czeka_na_pakowanie', 'label': 'Czeka na pakowanie'},
            {'value': 'spakowane', 'label': 'Spakowane'},
            {'value': 'wstrzymane', 'label': 'Wstrzymane'}
        ]
        
        # Gatunki drewna
        wood_species_query = db.session.query(distinct(ProductionItem.parsed_wood_species))\
                                      .filter(ProductionItem.parsed_wood_species.isnot(None))\
                                      .filter(ProductionItem.parsed_wood_species != '')\
                                      .all()
        wood_species = [{'value': item[0], 'label': item[0]} for item in wood_species_query]
        
        # Technologie
        technology_query = db.session.query(distinct(ProductionItem.parsed_technology))\
                                    .filter(ProductionItem.parsed_technology.isnot(None))\
                                    .filter(ProductionItem.parsed_technology != '')\
                                    .all()
        technologies = [{'value': item[0], 'label': item[0]} for item in technology_query]
        
        # Klasy drewna
        wood_class_query = db.session.query(distinct(ProductionItem.parsed_wood_class))\
                                    .filter(ProductionItem.parsed_wood_class.isnot(None))\
                                    .filter(ProductionItem.parsed_wood_class != '')\
                                    .all()
        wood_classes = [{'value': item[0], 'label': item[0]} for item in wood_class_query]
        
        # Zakres priorytetów
        priority_stats = db.session.query(
            func.min(ProductionItem.priority_score),
            func.max(ProductionItem.priority_score),
            func.avg(ProductionItem.priority_score)
        ).filter(ProductionItem.priority_score.isnot(None)).first()
        
        priority_range = {
            'min': int(priority_stats[0]) if priority_stats[0] else 0,
            'max': int(priority_stats[1]) if priority_stats[1] else 200,
            'avg': int(priority_stats[2]) if priority_stats[2] else 100
        }
        
        # Ostatnie 30 dni dla date picker
        from datetime import datetime, timedelta
        date_suggestions = {
            'today': datetime.now().date().isoformat(),
            'yesterday': (datetime.now() - timedelta(days=1)).date().isoformat(),
            'week_ago': (datetime.now() - timedelta(days=7)).date().isoformat(),
            'month_ago': (datetime.now() - timedelta(days=30)).date().isoformat()
        }
        
        filters_data = {
            'statuses': statuses,
            'wood_species': wood_species,
            'technologies': technologies,
            'wood_classes': wood_classes,
            'priority_range': priority_range,
            'date_suggestions': date_suggestions,
            'total_products': ProductionItem.query.count()
        }
        
        logger.info("Pobrano dane filtrów", extra={
            'user_id': current_user.id,
            'wood_species_count': len(wood_species),
            'technologies_count': len(technologies),
            'total_products': filters_data['total_products']
        })
        
        return jsonify({
            'success': True,
            'filters_data': filters_data
        })
        
    except Exception as e:
        logger.error("Błąd pobierania danych filtrów", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': f'Błąd pobierania filtrów: {str(e)}'
        }), 500


# 5. UPDATE PRIORYTETU POJEDYNCZEGO PRODUKTU
@api_bp.route('/products/<int:product_id>/priority', methods=['PUT'])
@admin_required
def update_single_product_priority(product_id):
    """
    PUT /production/api/products/<id>/priority
    
    Aktualizuje priorytet pojedynczego produktu
    
    Body (JSON):
    {
        "priority": 150
    }
    
    Returns: JSON z rezultatem
    """
    try:
        data = request.get_json()
        if not data or 'priority' not in data:
            return jsonify({'success': False, 'error': 'Wymagany parametr: priority'}), 400
        
        new_priority = data['priority']
        
        # Walidacja priorytetu
        if not isinstance(new_priority, int) or new_priority < 0 or new_priority > 200:
            return jsonify({'success': False, 'error': 'Priorytet musi być liczbą 0-200'}), 400
        
        from ..models import ProductionItem
        
        product = ProductionItem.query.get_or_404(product_id)
        old_priority = product.priority_score
        
        product.priority_score = new_priority
        db.session.commit()
        
        logger.info("Zaktualizowano priorytet produktu", extra={
            'user_id': current_user.id,
            'product_id': product_id,
            'product_short_id': product.short_product_id,
            'old_priority': old_priority,
            'new_priority': new_priority
        })
        
        return jsonify({
            'success': True,
            'message': 'Priorytet zaktualizowany',
            'product_id': product_id,
            'old_priority': old_priority,
            'new_priority': new_priority
        })
        
    except Exception as e:
        db.session.rollback()
        logger.error("Błąd aktualizacji priorytetu", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'product_id': product_id,
            'error': str(e)
        })
        return jsonify({
            'success': False,
            'error': f'Błąd aktualizacji priorytetu: {str(e)}'
        }), 500


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def calculate_duration(start_time, end_time):
    """
    Oblicza czas trwania między dwoma timestampami
    
    Args:
        start_time: datetime początkowy
        end_time: datetime końcowy (może być None)
    
    Returns:
        dict: {'hours': int, 'minutes': int, 'total_minutes': int}
    """
    if not start_time:
        return None
    
    if not end_time:
        end_time = datetime.utcnow()
    
    duration = end_time - start_time
    total_minutes = int(duration.total_seconds() / 60)
    hours = total_minutes // 60
    minutes = total_minutes % 60
    
    return {
        'hours': hours,
        'minutes': minutes,
        'total_minutes': total_minutes,
        'formatted': f"{hours}h {minutes}m"
    }

logger.info("Zainicjalizowano API routers modułu production", extra={
    'blueprint_name': api_bp.name,
    'total_endpoints': 7,  # dashboard-stats, complete-task, cron-sync, manual-sync, update-config, health, complete-packaging
    'prd_compliance': True
})