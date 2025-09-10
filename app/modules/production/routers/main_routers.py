# modules/production/routers/main_routers.py
"""
Main Routers dla modułu Production
==================================

Główne interfejsy zarządzania zgodne z PRD Section 6.1:
- GET /production → dashboard główny
- GET /production/products → szczegółowa lista produktów  
- GET /production/config → panel konfiguracji (tylko admin)

Wszystkie endpointy wymagają autoryzacji (login_required).
Interfejsy zoptymalizowane pod desktop/laptop.

Autor: Konrad Kmiecik
Wersja: 1.0 (Podstawowa zgodnie z PRD)
Data: 2025-01-09
"""

from datetime import datetime, date, timedelta
from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from flask_login import login_required, current_user
from functools import wraps
from modules.logging import get_structured_logger
from extensions import db

# Utworzenie Blueprint dla głównych routów
main_bp = Blueprint('production_main', __name__)
logger = get_structured_logger('production.main')

# ============================================================================
# DECORATORS
# ============================================================================

def admin_required(f):
    """Dekorator sprawdzający rolę admin"""
    @wraps(f)
    @login_required
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            flash('Wymagane logowanie', 'error')
            return redirect(url_for('auth.login'))
        
        if not hasattr(current_user, 'role') or current_user.role.lower() not in ['admin', 'administrator']:
            logger.warning("Odmowa dostępu admin", extra={
                'user_id': current_user.id,
                'endpoint': request.endpoint
            })
            flash('Brak uprawnień administratora', 'error')
            return redirect(url_for('production_main.dashboard'))
        
        return f(*args, **kwargs)
    return decorated_function

# ============================================================================
# ROUTERS - zgodnie z PRD Section 6.1
# ============================================================================

@main_bp.route('/')
@login_required
def dashboard():
    """
    GET /production - Dashboard główny (PRD Section 6.1)
    
    Dashboard z podstawowymi statystykami:
    - Karty przeglądowe (nie szczegółowe listy)
    - Statystyki stanowisk
    - Alerty deadline
    - System health
    
    Autoryzacja: user, admin
    Returns: HTML dashboard
    """
    try:
        logger.info("Dostęp do dashboard główny", extra={
            'user_id': current_user.id,
            'user_role': getattr(current_user, 'role', 'unknown')
        })
        
        from ..models import ProductionItem
        
        # Podstawowe statystyki - zgodnie z PRD API response structure
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
        
        # Statystyki per stanowisko
        today = date.today()
        
        # Cutting - oczekujące
        cutting_pending = ProductionItem.query.filter_by(current_status='czeka_na_wyciecie').count()
        cutting_today_m3 = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                    .filter(ProductionItem.cutting_completed_at >= datetime.combine(today, datetime.min.time()))\
                                    .scalar() or 0.0
        
        # Assembly - oczekujące  
        assembly_pending = ProductionItem.query.filter_by(current_status='czeka_na_skladanie').count()
        assembly_today_m3 = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                     .filter(ProductionItem.assembly_completed_at >= datetime.combine(today, datetime.min.time()))\
                                     .scalar() or 0.0
        
        # Packaging - oczekujące
        packaging_pending = ProductionItem.query.filter_by(current_status='czeka_na_pakowanie').count()
        packaging_today_m3 = db.session.query(db.func.sum(ProductionItem.volume_m3))\
                                      .filter(ProductionItem.packaging_completed_at >= datetime.combine(today, datetime.min.time()))\
                                      .scalar() or 0.0
        
        # Aktualizacja statystyk
        dashboard_stats['stations']['cutting'] = {
            'pending_count': cutting_pending,
            'today_m3': float(cutting_today_m3)
        }
        dashboard_stats['stations']['assembly'] = {
            'pending_count': assembly_pending, 
            'today_m3': float(assembly_today_m3)
        }
        dashboard_stats['stations']['packaging'] = {
            'pending_count': packaging_pending,
            'today_m3': float(packaging_today_m3)
        }
        
        # Dzisiejsze ukończone zamówienia
        completed_today = ProductionItem.query.filter(
            ProductionItem.current_status == 'spakowane',
            ProductionItem.packaging_completed_at >= datetime.combine(today, datetime.min.time())
        ).count()
        
        total_m3_today = float(cutting_today_m3 + assembly_today_m3 + packaging_today_m3)
        
        dashboard_stats['today_totals'] = {
            'completed_orders': completed_today,
            'total_m3': total_m3_today,
            'avg_deadline_distance': 7.0  # Placeholder - będzie obliczane
        }
        
        # Alerty deadline - produkty zbliżające się do terminu
        deadline_alerts = ProductionItem.query.filter(
            ProductionItem.deadline_date <= date.today() + timedelta(days=3),
            ProductionItem.current_status.in_(['czeka_na_wyciecie', 'czeka_na_skladanie', 'czeka_na_pakowanie'])
        ).limit(5).all()
        
        dashboard_stats['deadline_alerts'] = [
            {
                'product_id': alert.short_product_id,
                'days_remaining': (alert.deadline_date - date.today()).days if alert.deadline_date else 0,
                'current_station': alert.current_status.replace('czeka_na_', '')
            }
            for alert in deadline_alerts
        ]
        
        return render_template(
            'production/dashboard.html',
            dashboard_stats=dashboard_stats,
            page_title="Dashboard Produkcji"
        )
        
    except Exception as e:
        logger.error("Błąd dashboard główny", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        flash(f'Błąd ładowania dashboard: {str(e)}', 'error')
        return render_template('production/dashboard.html', 
                             dashboard_stats={}, 
                             page_title="Dashboard Produkcji")

@main_bp.route('/products')
@login_required
def products_list():
    """
    GET /production/products - Szczegółowa lista produktów (PRD Section 6.1)
    
    Kompletna lista produktów bez paginacji z funkcjami:
    - Wyszukiwanie, filtry
    - Drag&drop priority (tylko admin)
    - Kolumny: Priorytet, ID Zamówienia, Produkt, Klient, Data, Status, Deadline
    
    Autoryzacja: user, admin  
    Returns: HTML z listą produktów
    """
    try:
        logger.info("Dostęp do listy produktów", extra={
            'user_id': current_user.id,
            'user_role': getattr(current_user, 'role', 'unknown')
        })
        
        from ..models import ProductionItem
        
        # Filtry z query params
        status_filter = request.args.get('status')
        search_query = request.args.get('search', '').strip()
        
        # Query podstawowy - wszystkie produkty bez paginacji zgodnie z PRD
        query = ProductionItem.query
        
        # Filtrowanie po statusie
        if status_filter and status_filter != 'all':
            query = query.filter(ProductionItem.current_status == status_filter)
        
        # Wyszukiwanie w ID zamówienia i nazwie produktu
        if search_query:
            query = query.filter(
                db.or_(
                    ProductionItem.short_product_id.ilike(f'%{search_query}%'),
                    ProductionItem.internal_order_number.ilike(f'%{search_query}%'),
                    ProductionItem.original_product_name.ilike(f'%{search_query}%')
                )
            )
        
        # Sortowanie po priorytecie (najwyższy pierwszy)
        products = query.order_by(ProductionItem.priority_score.desc()).all()
        
        # Sprawdź czy user jest adminem (dla drag&drop)
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
        
        return render_template(
            'production/products.html',
            products=products,
            status_filter=status_filter,
            search_query=search_query,
            status_options=status_options,
            is_admin=is_admin,
            page_title="Lista Produktów Produkcyjnych"
        )
        
    except Exception as e:
        logger.error("Błąd listy produktów", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        flash(f'Błąd ładowania listy produktów: {str(e)}', 'error')
        return render_template('production/products.html', 
                             products=[], 
                             status_filter=None,
                             search_query='',
                             status_options=[],
                             is_admin=False,
                             page_title="Lista Produktów Produkcyjnych")

@main_bp.route('/config')
@admin_required
def config_panel():
    """
    GET /production/config - Panel konfiguracji (PRD Section 6.1)
    
    Panel konfiguracji z funkcjami zgodnie z PRD:
    - Konfiguracja kryteriów priorytetu
    - Częstotliwość odświeżania 
    - Ustawienia debug
    - Zarządzanie IP
    
    Autoryzacja: tylko admin
    Returns: HTML panel konfiguracji
    """
    try:
        logger.info("Dostęp do panelu konfiguracji", extra={
            'user_id': current_user.id
        })
        
        from ..models import ProductionConfig, ProductionPriorityConfig
        
        # Podstawowe konfiguracje zgodnie z PRD
        config_keys = [
            'STATION_ALLOWED_IPS',
            'REFRESH_INTERVAL_SECONDS',
            'DEBUG_PRODUCTION_BACKEND', 
            'DEBUG_PRODUCTION_FRONTEND'
        ]
        
        configs = {}
        for key in config_keys:
            config = ProductionConfig.query.filter_by(config_key=key).first()
            configs[key] = {
                'value': config.config_value if config else '',
                'description': config.config_description if config else '',
                'type': config.config_type if config else 'string'
            }
        
        # Konfiguracje priorytetów - drag&drop zgodnie z PRD
        priority_configs = ProductionPriorityConfig.query.filter_by(is_active=True)\
                                                         .order_by(ProductionPriorityConfig.display_order).all()
        
        return render_template(
            'production/config.html',
            configs=configs,
            priority_configs=priority_configs,
            page_title="Konfiguracja Produkcji"
        )
        
    except Exception as e:
        logger.error("Błąd panelu konfiguracji", extra={
            'user_id': current_user.id,
            'error': str(e)
        })
        flash(f'Błąd ładowania konfiguracji: {str(e)}', 'error')
        return redirect(url_for('production_main.dashboard'))

# ============================================================================
# HELPER ROUTERS
# ============================================================================

@main_bp.route('/update-priority', methods=['POST'])
@admin_required
def update_product_priority():
    """
    POST /production/update-priority
    
    Aktualizuje priorytet produktu (drag&drop w liście produktów)
    Dostępne tylko dla adminów zgodnie z PRD.
    
    JSON body:
        product_id: ID produktu
        new_priority: nowy priorytet
        
    Returns: JSON status
    """
    try:
        data = request.get_json()
        product_id = data.get('product_id')
        new_priority = data.get('new_priority')
        
        if not product_id or new_priority is None:
            return jsonify({'success': False, 'error': 'Brak wymaganych danych'}), 400
        
        from ..models import ProductionItem
        
        product = ProductionItem.query.filter_by(short_product_id=product_id).first()
        if not product:
            return jsonify({'success': False, 'error': 'Produkt nie znaleziony'}), 404
        
        # Aktualizacja priorytetu
        old_priority = product.priority_score
        product.priority_score = int(new_priority)
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
            'message': f'Priorytet produktu {product_id} zaktualizowany'
        })
        
    except Exception as e:
        db.session.rollback()
        logger.error("Błąd aktualizacji priorytetu", extra={
            'product_id': data.get('product_id') if 'data' in locals() else None,
            'user_id': current_user.id,
            'error': str(e)
        })
        
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================================
# ERROR HANDLERS
# ============================================================================

@main_bp.errorhandler(404)
def not_found(error):
    """Handler dla błędów 404"""
    flash('Nie znaleziono żądanej strony', 'error')
    return redirect(url_for('production_main.dashboard'))

@main_bp.errorhandler(500) 
def server_error(error):
    """Handler dla błędów serwera"""
    logger.error("Błąd serwera w main routers", extra={
        'user_id': current_user.id if current_user.is_authenticated else None,
        'error': str(error),
        'path': request.path
    })
    flash('Wystąpił błąd systemu', 'error')
    return redirect(url_for('production_main.dashboard'))

# ============================================================================
# CONTEXT PROCESSORS
# ============================================================================

@main_bp.context_processor
def inject_main_context():
    """Injektuje kontekst dla głównych templates"""
    try:
        return {
            'current_time': datetime.utcnow(),
            'current_user_role': getattr(current_user, 'role', 'unknown') if current_user.is_authenticated else None,
            'dashboard_url': url_for('production_main.dashboard'),
            'products_url': url_for('production_main.products_list'),
            'config_url': url_for('production_main.config_panel')
        }
    except Exception as e:
        logger.error("Błąd context processor main", extra={'error': str(e)})
        return {'current_time': datetime.utcnow()}

logger.info("Zainicjalizowano Main routers zgodnie z PRD", extra={
    'blueprint_name': main_bp.name,
    'routers_count': 3,  # dashboard, products, config
    'prd_compliance': True
})d