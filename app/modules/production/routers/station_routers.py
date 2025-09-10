# modules/production/routers/station_routers.py
"""
Station Routers dla modułu Production
=====================================

Interfejsy stanowisk produkcyjnych zoptymalizowane pod tablety:
- Wybór stanowiska (station-select)
- Stanowisko wycinania (cutting)
- Stanowisko składania (assembly) 
- Stanowisko pakowania (packaging)

Wszystkie interfejsy są:
- Zabezpieczone IP whitelist (bez logowania)
- Zoptymalizowane pod ekrany dotykowe
- Auto-refresh co 30 sekund
- Responsive design dla tabletów

Autor: Konrad Kmiecik
Wersja: 1.2 (Finalna - z zabezpieczeniami)
Data: 2025-01-08
"""

from flask import Blueprint, render_template, request, redirect, url_for, jsonify, flash
from datetime import datetime, date, timedelta
from modules.logging import get_structured_logger
from extensions import db

# Utworzenie Blueprint dla interfejsów stanowisk
station_bp = Blueprint('production_stations', __name__)
logger = get_structured_logger('production.stations')

@station_bp.before_request
def apply_station_security():
    """Sprawdza IP tylko dla interfejsów stanowisk"""
    from .. import apply_security
    return apply_security()

# ============================================================================
# HELPERS I UTILITIES
# ============================================================================

def get_station_config():
    """
    Pobiera konfigurację dla interfejsów stanowisk
    
    Returns:
        Dict[str, Any]: Konfiguracja interfejsów
    """
    try:
        from ..services.config_service import get_config
        
        config = {
            'refresh_interval': get_config('REFRESH_INTERVAL_SECONDS', 30),
            'auto_refresh_enabled': get_config('STATION_AUTO_REFRESH_ENABLED', True),
            'debug_frontend': get_config('DEBUG_PRODUCTION_FRONTEND', False),
            'show_detailed_info': get_config('STATION_SHOW_DETAILED_INFO', True),
            'max_products_display': get_config('STATION_MAX_PRODUCTS_DISPLAY', 50)
        }
        
        return config
        
    except Exception as e:
        logger.error("Błąd pobierania konfiguracji stanowisk", extra={'error': str(e)})
        return {
            'refresh_interval': 30,
            'auto_refresh_enabled': True,
            'debug_frontend': False,
            'show_detailed_info': True,
            'max_products_display': 50
        }

def get_products_for_station(station_code, limit=50, sort_by='priority'):
    """
    Pobiera produkty dla konkretnego stanowiska
    
    Args:
        station_code (str): Kod stanowiska
        limit (int): Limit produktów
        sort_by (str): Sposób sortowania
        
    Returns:
        List[Dict]: Lista produktów z dodatkowymi informacjami
    """
    try:
        from ..models import ProductionItem
        from sqlalchemy import desc, asc
        
        # Mapowanie statusów na stanowiska
        status_map = {
            'cutting': 'czeka_na_wyciecie',
            'assembly': 'czeka_na_skladanie',
            'packaging': 'czeka_na_pakowanie'
        }
        
        if station_code not in status_map:
            return []
        
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
        
        # Przygotowanie danych z dodatkowymi informacjami
        products_data = []
        for product in products:
            # Obliczenie koloru priorytetu
            if product.priority_score >= 200:
                priority_color = 'critical'
                priority_class = 'priority-critical'
            elif product.priority_score >= 150:
                priority_color = 'high'
                priority_class = 'priority-high'
            elif product.priority_score >= 100:
                priority_color = 'normal'
                priority_class = 'priority-normal'
            else:
                priority_color = 'low'
                priority_class = 'priority-low'
            
            # Obliczenie koloru deadline
            if product.deadline_date:
                days_diff = (product.deadline_date - date.today()).days
                if days_diff < 0:
                    deadline_color = 'overdue'
                    deadline_class = 'deadline-overdue'
                elif days_diff <= 1:
                    deadline_color = 'urgent'
                    deadline_class = 'deadline-urgent'
                elif days_diff <= 3:
                    deadline_color = 'soon'
                    deadline_class = 'deadline-soon'
                else:
                    deadline_color = 'normal'
                    deadline_class = 'deadline-normal'
            else:
                deadline_color = 'unknown'
                deadline_class = 'deadline-unknown'
            
            # Formatowanie wymiarów
            dimensions_text = ''
            if all([product.parsed_length_cm, product.parsed_width_cm, product.parsed_thickness_cm]):
                dimensions_text = f"{product.parsed_length_cm}×{product.parsed_width_cm}×{product.parsed_thickness_cm}"
            
            # Przygotowanie danych produktu
            product_data = {
                'id': product.short_product_id,
                'internal_order': product.internal_order_number,
                'original_name': product.original_product_name,
                'priority_score': product.priority_score,
                'priority_level': product.priority_level,
                'priority_color': priority_color,
                'priority_class': priority_class,
                'deadline_date': product.deadline_date,
                'days_until_deadline': product.days_until_deadline,
                'is_overdue': product.is_overdue,
                'deadline_color': deadline_color,
                'deadline_class': deadline_class,
                'volume_m3': product.volume_m3,
                'total_value_net': product.total_value_net,
                'created_at': product.created_at,
                'wood_species': product.parsed_wood_species,
                'technology': product.parsed_technology,
                'wood_class': product.parsed_wood_class,
                'dimensions': dimensions_text,
                'finish_state': product.parsed_finish_state,
                # Formatowane teksty dla UI
                'display_name': _format_product_display_name(product),
                'display_priority': f"{product.priority_score} ({product.priority_level})",
                'display_deadline': _format_deadline_display(product),
                'display_value': f"{product.total_value_net:.2f} PLN" if product.total_value_net else "—",
                'display_volume': f"{product.volume_m3:.3f} m³" if product.volume_m3 else "—"
            }
            
            products_data.append(product_data)
        
        logger.debug("Pobrano produkty dla stanowiska", extra={
            'station_code': station_code,
            'products_count': len(products_data),
            'sort_by': sort_by
        })
        
        return products_data
        
    except Exception as e:
        logger.error("Błąd pobierania produktów dla stanowiska", extra={
            'station_code': station_code,
            'error': str(e)
        })
        return []

def _format_product_display_name(product):
    """
    Formatuje nazwę produktu do wyświetlenia
    
    Args:
        product: Obiekt ProductionItem
        
    Returns:
        str: Sformatowana nazwa
    """
    parts = []
    
    if product.parsed_wood_species:
        parts.append(product.parsed_wood_species.title())
    
    if product.parsed_technology:
        parts.append(product.parsed_technology.title())
    
    if product.parsed_wood_class:
        parts.append(f"Klasa {product.parsed_wood_class}")
    
    if all([product.parsed_length_cm, product.parsed_width_cm, product.parsed_thickness_cm]):
        dimensions = f"{product.parsed_length_cm}×{product.parsed_width_cm}×{product.parsed_thickness_cm}"
        parts.append(dimensions)
    
    if product.parsed_finish_state and product.parsed_finish_state != 'surowe':
        parts.append(product.parsed_finish_state.title())
    
    if parts:
        return " | ".join(parts)
    else:
        # Fallback do oryginalnej nazwy (skróconej)
        original = product.original_product_name
        if len(original) > 60:
            return original[:57] + "..."
        return original

def _format_deadline_display(product):
    """
    Formatuje deadline do wyświetlenia
    
    Args:
        product: Obiekt ProductionItem
        
    Returns:
        str: Sformatowany deadline
    """
    if not product.deadline_date:
        return "Brak terminu"
    
    days_diff = (product.deadline_date - date.today()).days
    
    if days_diff < 0:
        return f"Opóźnione o {abs(days_diff)} dni"
    elif days_diff == 0:
        return "Dziś!"
    elif days_diff == 1:
        return "Jutro"
    elif days_diff <= 7:
        return f"Za {days_diff} dni"
    else:
        return product.deadline_date.strftime("%d.%m.%Y")

def get_station_summary():
    """
    Pobiera podsumowanie wszystkich stanowisk dla wyboru stanowiska
    
    Returns:
        Dict[str, Dict]: Podsumowanie per stanowisko
    """
    try:
        from ..models import ProductionItem
        from sqlalchemy import func
        
        # Query dla wszystkich statusów jednocześnie
        summary_data = db.session.query(
            ProductionItem.current_status,
            func.count(ProductionItem.id).label('count'),
            func.sum(ProductionItem.volume_m3).label('volume'),
            func.avg(ProductionItem.priority_score).label('avg_priority')
        ).filter(
            ProductionItem.current_status.in_([
                'czeka_na_wyciecie',
                'czeka_na_skladanie', 
                'czeka_na_pakowanie'
            ])
        ).group_by(ProductionItem.current_status).all()
        
        # Mapowanie na stacje
        status_to_station = {
            'czeka_na_wyciecie': 'cutting',
            'czeka_na_skladanie': 'assembly',
            'czeka_na_pakowanie': 'packaging'
        }
        
        station_names = {
            'cutting': 'Wycinanie',
            'assembly': 'Składanie',
            'packaging': 'Pakowanie'
        }
        
        summary = {}
        
        # Inicjalizacja wszystkich stacji
        for station_code, station_name in station_names.items():
            summary[station_code] = {
                'name': station_name,
                'count': 0,
                'volume_m3': 0.0,
                'avg_priority': 100.0,
                'status_class': 'station-empty'
            }
        
        # Wypełnienie danymi
        for status, count, volume, avg_priority in summary_data:
            station_code = status_to_station.get(status)
            if station_code:
                summary[station_code].update({
                    'count': count,
                    'volume_m3': float(volume or 0),
                    'avg_priority': float(avg_priority or 100)
                })
                
                # Określenie klasy CSS na podstawie liczby zadań
                if count == 0:
                    summary[station_code]['status_class'] = 'station-empty'
                elif count <= 5:
                    summary[station_code]['status_class'] = 'station-low'
                elif count <= 15:
                    summary[station_code]['status_class'] = 'station-medium'
                else:
                    summary[station_code]['status_class'] = 'station-high'
        
        return summary
        
    except Exception as e:
        logger.error("Błąd pobierania podsumowania stanowisk", extra={'error': str(e)})
        return {
            'cutting': {'name': 'Wycinanie', 'count': 0, 'volume_m3': 0.0, 'avg_priority': 100.0, 'status_class': 'station-empty'},
            'assembly': {'name': 'Składanie', 'count': 0, 'volume_m3': 0.0, 'avg_priority': 100.0, 'status_class': 'station-empty'},
            'packaging': {'name': 'Pakowanie', 'count': 0, 'volume_m3': 0.0, 'avg_priority': 100.0, 'status_class': 'station-empty'}
        }

# ============================================================================
# ROUTERS - WYBÓR STANOWISKA
# ============================================================================

@station_bp.route('/')
@station_bp.route('/station-select')
def station_select():
    """
    Interfejs wyboru stanowiska (strona główna dla stanowisk)
    
    Returns:
        HTML: Interfejs wyboru stanowiska
    """
    try:
        logger.info("Dostęp do wyboru stanowiska", extra={
            'client_ip': request.remote_addr,
            'user_agent': request.headers.get('User-Agent', 'Unknown')
        })
        
        # Pobranie podsumowania stanowisk
        stations_summary = get_station_summary()
        
        # Konfiguracja interfejsu
        config = get_station_config()
        
        # Czas ostatniej aktualizacji
        last_updated = datetime.utcnow()
        
        return render_template(
            'stations/select.html',
            stations=stations_summary,
            config=config,
            last_updated=last_updated,
            page_title="Wybór stanowiska produkcyjnego"
        )
        
    except Exception as e:
        logger.error("Błąd interfejsu wyboru stanowiska", extra={
            'client_ip': request.remote_addr,
            'error': str(e)
        })
        
        # Fallback template z błędem
        return render_template(
            'stations/access_denied.html',
            error_message="Błąd ładowania interfejsu wyboru stanowiska",
            error_details=str(e),
            back_url=None
        ), 500

# ============================================================================
# ROUTERS - STANOWISKO WYCINANIA
# ============================================================================

@station_bp.route('/cutting')
def cutting_station():
    """
    Interfejs stanowiska wycinania
    
    Query params:
        sort: priority|deadline|created_at (default: priority)
        limit: max liczba produktów (default: 50)
        
    Returns:
        HTML: Interfejs stanowiska wycinania
    """
    try:
        sort_by = request.args.get('sort', 'priority')
        limit = min(int(request.args.get('limit', 50)), 100)
        
        logger.info("Dostęp do stanowiska wycinania", extra={
            'client_ip': request.remote_addr,
            'sort_by': sort_by,
            'limit': limit
        })
        
        # Pobranie produktów
        products = get_products_for_station('cutting', limit, sort_by)
        
        # Konfiguracja interfejsu
        config = get_station_config()
        
        # Statystyki stanowiska
        total_products = len(products)
        high_priority_count = sum(1 for p in products if p['priority_score'] >= 150)
        overdue_count = sum(1 for p in products if p['is_overdue'])
        
        station_stats = {
            'total_products': total_products,
            'high_priority_count': high_priority_count,
            'overdue_count': overdue_count,
            'avg_priority': sum(p['priority_score'] for p in products) / len(products) if products else 0
        }
        
        return render_template(
            'production/cutting.html',
            products=products,
            station_code='cutting',
            station_name='Wycinanie',
            station_stats=station_stats,
            config=config,
            sort_by=sort_by,
            limit=limit,
            last_updated=datetime.utcnow(),
            page_title="Stanowisko Wycinania"
        )
        
    except Exception as e:
        logger.error("Błąd interfejsu wycinania", extra={
            'client_ip': request.remote_addr,
            'error': str(e)
        })
        
        return render_template(
            'production/error.html',
            error_message="Błąd ładowania stanowiska wycinania",
            error_details=str(e),
            back_url=url_for('production_stations.station_select')
        ), 500

# ============================================================================
# ROUTERS - STANOWISKO SKŁADANIA
# ============================================================================

@station_bp.route('/assembly')
def assembly_station():
    """
    Interfejs stanowiska składania
    
    Query params:
        sort: priority|deadline|created_at (default: priority)
        limit: max liczba produktów (default: 50)
        
    Returns:
        HTML: Interfejs stanowiska składania
    """
    try:
        sort_by = request.args.get('sort', 'priority')
        limit = min(int(request.args.get('limit', 50)), 100)
        
        logger.info("Dostęp do stanowiska składania", extra={
            'client_ip': request.remote_addr,
            'sort_by': sort_by,
            'limit': limit
        })
        
        # Pobranie produktów
        products = get_products_for_station('assembly', limit, sort_by)
        
        # Konfiguracja interfejsu
        config = get_station_config()
        
        # Statystyki stanowiska
        total_products = len(products)
        high_priority_count = sum(1 for p in products if p['priority_score'] >= 150)
        overdue_count = sum(1 for p in products if p['is_overdue'])
        
        station_stats = {
            'total_products': total_products,
            'high_priority_count': high_priority_count,
            'overdue_count': overdue_count,
            'avg_priority': sum(p['priority_score'] for p in products) / len(products) if products else 0
        }
        
        return render_template(
            'production/assembly.html',
            products=products,
            station_code='assembly',
            station_name='Składanie',
            station_stats=station_stats,
            config=config,
            sort_by=sort_by,
            limit=limit,
            last_updated=datetime.utcnow(),
            page_title="Stanowisko Składania"
        )
        
    except Exception as e:
        logger.error("Błąd interfejsu składania", extra={
            'client_ip': request.remote_addr,
            'error': str(e)
        })
        
        return render_template(
            'production/error.html',
            error_message="Błąd ładowania stanowiska składania",
            error_details=str(e),
            back_url=url_for('production_stations.station_select')
        ), 500

# ============================================================================
# ROUTERS - STANOWISKO PAKOWANIA
# ============================================================================

@station_bp.route('/packaging')
def packaging_station():
    """
    Interfejs stanowiska pakowania
    
    Query params:
        sort: priority|deadline|created_at (default: priority)
        limit: max liczba produktów (default: 50)
        view: grid|list (default: list) - pakowanie używa widoku listy
        
    Returns:
        HTML: Interfejs stanowiska pakowania
    """
    try:
        sort_by = request.args.get('sort', 'priority')
        limit = min(int(request.args.get('limit', 50)), 100)
        view_mode = request.args.get('view', 'list')  # pakowanie domyślnie lista
        
        logger.info("Dostęp do stanowiska pakowania", extra={
            'client_ip': request.remote_addr,
            'sort_by': sort_by,
            'limit': limit,
            'view_mode': view_mode
        })
        
        # Pobranie produktów
        products = get_products_for_station('packaging', limit, sort_by)
        
        # Grupowanie produktów po zamówieniach (dla pakowania)
        orders_grouped = {}
        for product in products:
            order_number = product['internal_order']
            if order_number not in orders_grouped:
                orders_grouped[order_number] = {
                    'order_number': order_number,
                    'products': [],
                    'total_products': 0,
                    'total_volume': 0,
                    'total_value': 0,
                    'highest_priority': 0,
                    'earliest_deadline': None,
                    'has_overdue': False
                }
            
            order = orders_grouped[order_number]
            order['products'].append(product)
            order['total_products'] += 1
            order['total_volume'] += product['volume_m3'] or 0
            order['total_value'] += product['total_value_net'] or 0
            order['highest_priority'] = max(order['highest_priority'], product['priority_score'])
            
            if product['deadline_date']:
                if order['earliest_deadline'] is None or product['deadline_date'] < order['earliest_deadline']:
                    order['earliest_deadline'] = product['deadline_date']
            
            if product['is_overdue']:
                order['has_overdue'] = True
        
        # Sortowanie grup zamówień
        if sort_by == 'priority':
            orders_list = sorted(orders_grouped.values(), key=lambda x: x['highest_priority'], reverse=True)
        elif sort_by == 'deadline':
            orders_list = sorted(orders_grouped.values(), 
                               key=lambda x: x['earliest_deadline'] or date.max)
        else:
            orders_list = list(orders_grouped.values())
        
        # Konfiguracja interfejsu
        config = get_station_config()
        
        # Statystyki stanowiska
        total_products = len(products)
        total_orders = len(orders_grouped)
        high_priority_count = sum(1 for p in products if p['priority_score'] >= 150)
        overdue_count = sum(1 for p in products if p['is_overdue'])
        
        station_stats = {
            'total_products': total_products,
            'total_orders': total_orders,
            'high_priority_count': high_priority_count,
            'overdue_count': overdue_count,
            'avg_priority': sum(p['priority_score'] for p in products) / len(products) if products else 0
        }
        
        return render_template(
            'production/packaging.html',
            products=products,
            orders_grouped=orders_list,
            station_code='packaging',
            station_name='Pakowanie',
            station_stats=station_stats,
            config=config,
            sort_by=sort_by,
            limit=limit,
            view_mode=view_mode,
            last_updated=datetime.utcnow(),
            page_title="Stanowisko Pakowania"
        )
        
    except Exception as e:
        logger.error("Błąd interfejsu pakowania", extra={
            'client_ip': request.remote_addr,
            'error': str(e)
        })
        
        return render_template(
            'production/error.html',
            error_message="Błąd ładowania stanowiska pakowania",
            error_details=str(e),
            back_url=url_for('production_stations.station_select')
        ), 500

# ============================================================================
# AJAX ENDPOINTS DLA INTERFEJSÓW STANOWISK
# ============================================================================

@station_bp.route('/ajax/products/<station_code>')
def ajax_get_products(station_code):
    """
    AJAX endpoint dla odświeżania listy produktów
    
    Args:
        station_code: cutting|assembly|packaging
        
    Query params:
        sort: priority|deadline|created_at
        limit: max liczba produktów
        
    Returns:
        JSON: Lista produktów
    """
    try:
        if station_code not in ['cutting', 'assembly', 'packaging']:
            return jsonify({
                'success': False,
                'error': 'Invalid station code'
            }), 400
        
        sort_by = request.args.get('sort', 'priority')
        limit = min(int(request.args.get('limit', 50)), 100)
        
        # Pobranie produktów
        products = get_products_for_station(station_code, limit, sort_by)
        
        # Statystyki
        total_products = len(products)
        high_priority_count = sum(1 for p in products if p['priority_score'] >= 150)
        overdue_count = sum(1 for p in products if p['is_overdue'])
        
        result = {
            'success': True,
            'data': {
                'products': products,
                'stats': {
                    'total_products': total_products,
                    'high_priority_count': high_priority_count,
                    'overdue_count': overdue_count,
                    'avg_priority': sum(p['priority_score'] for p in products) / len(products) if products else 0
                },
                'last_updated': datetime.utcnow().isoformat(),
                'station_code': station_code,
                'sort_by': sort_by
            }
        }
        
        logger.debug("AJAX: Pobrano produkty dla stanowiska", extra={
            'station_code': station_code,
            'products_count': len(products),
            'client_ip': request.remote_addr
        })
        
        return jsonify(result), 200
        
    except Exception as e:
        logger.error("Błąd AJAX pobierania produktów", extra={
            'station_code': station_code,
            'error': str(e)
        })
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@station_bp.route('/ajax/summary')
def ajax_station_summary():
    """
    AJAX endpoint dla odświeżania podsumowania stanowisk
    
    Returns:
        JSON: Podsumowanie wszystkich stanowisk
    """
    try:
        # Pobranie podsumowania
        summary = get_station_summary()
        
        result = {
            'success': True,
            'data': {
                'stations': summary,
                'last_updated': datetime.utcnow().isoformat()
            }
        }
        
        logger.debug("AJAX: Pobrano podsumowanie stanowisk", extra={
            'client_ip': request.remote_addr
        })
        
        return jsonify(result), 200
        
    except Exception as e:
        logger.error("Błąd AJAX podsumowania stanowisk", extra={'error': str(e)})
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# UTILITY ROUTERS
# ============================================================================

@station_bp.route('/config')
def get_station_frontend_config():
    """
    Endpoint dla konfiguracji JavaScript frontend
    
    Returns:
        JSON: Konfiguracja dla interfejsów stanowisk
    """
    try:
        config = get_station_config()
        
        # Dodaj dodatkowe informacje dla frontend
        frontend_config = {
            **config,
            'api_base_url': '/production/api',
            'ajax_base_url': '/production/ajax',
            'station_urls': {
                'cutting': url_for('production_stations.cutting_station'),
                'assembly': url_for('production_stations.assembly_station'),
                'packaging': url_for('production_stations.packaging_station'),
                'select': url_for('production_stations.station_select')
            },
            'timestamp': datetime.utcnow().isoformat()
        }
        
        return jsonify({
            'success': True,
            'config': frontend_config
        }), 200
        
    except Exception as e:
        logger.error("Błąd pobierania konfiguracji frontend", extra={'error': str(e)})
        
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# ERROR HANDLERS
# ============================================================================

@station_bp.errorhandler(403)
def station_access_denied(error):
    """Handler dla błędów dostępu IP"""
    logger.warning("Odrzucono dostęp do interfejsu stanowiska", extra={
        'client_ip': request.remote_addr,
        'path': request.path,
        'user_agent': request.headers.get('User-Agent')
    })
    
    return render_template(
        'production/access_denied.html',
        error_message="Dostęp zabroniony",
        error_details="Twój adres IP nie jest autoryzowany do dostępu do stanowisk produkcyjnych.",
        client_ip=request.remote_addr
    ), 403

@station_bp.errorhandler(500)
def station_server_error(error):
    """Handler dla błędów serwera w interfejsach stanowisk"""
    logger.error("Błąd serwera w interfejsie stanowiska", extra={
        'client_ip': request.remote_addr,
        'path': request.path,
        'error': str(error)
    })
    
    return render_template(
        'production/error.html',
        error_message="Błąd systemu",
        error_details="Wystąpił nieoczekiwany błąd. Spróbuj odświeżyć stronę.",
        back_url=url_for('production_stations.station_select')
    ), 500

# ============================================================================
# BEFORE/AFTER REQUEST HANDLERS
# ============================================================================

@station_bp.before_request
def log_station_access():
    """Loguje dostęp do interfejsów stanowisk"""
    try:
        from . import log_route_access
        log_route_access(request)
        
        # Dodatkowe logowanie dla interfejsów stanowisk
        logger.debug("Dostęp do interfejsu stanowiska", extra={
            'path': request.path,
            'method': request.method,
            'client_ip': request.remote_addr,
            'user_agent': request.headers.get('User-Agent', 'Unknown'),
            'endpoint': request.endpoint
        })
        
    except Exception as e:
        logger.error("Błąd logowania dostępu do stanowiska", extra={'error': str(e)})

@station_bp.after_request
def add_station_headers(response):
    """Dodaje nagłówki do odpowiedzi interfejsów stanowisk"""
    try:
        from . import apply_common_headers
        response = apply_common_headers(response)
        
        # Dodatkowe nagłówki dla interfejsów stanowisk
        response.headers['X-Station-Interface'] = '1.2.0'
        response.headers['X-Robots-Tag'] = 'noindex, nofollow'  # Nie indeksuj interfejsów stanowisk
        
        # Cache control dla interfejsów (nie cache'uj)
        if request.endpoint and 'ajax' not in request.endpoint:
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        
        return response
        
    except Exception as e:
        logger.error("Błąd dodawania nagłówków stanowiska", extra={'error': str(e)})
        return response

# ============================================================================
# CONTEXT PROCESSORS
# ============================================================================

@station_bp.context_processor
def inject_station_context():
    """
    Injektuje wspólny kontekst dla wszystkich templates stanowisk
    
    Returns:
        Dict[str, Any]: Kontekst dostępny w templates
    """
    try:
        # Podstawowe informacje
        context = {
            'current_time': datetime.utcnow(),
            'current_date': date.today(),
            'station_version': '1.2.0',
            'client_ip': request.remote_addr,
        }
        
        # Konfiguracja (uproszczona dla templates)
        config = get_station_config()
        context['station_config'] = {
            'refresh_interval': config['refresh_interval'],
            'auto_refresh_enabled': config['auto_refresh_enabled'],
            'debug_mode': config['debug_frontend']
        }
        
        # URL helpers dla navigation
        context['station_urls'] = {
            'select': url_for('production_stations.station_select'),
            'cutting': url_for('production_stations.cutting_station'),
            'assembly': url_for('production_stations.assembly_station'),
            'packaging': url_for('production_stations.packaging_station')
        }
        
        # AJAX URLs
        context['ajax_urls'] = {
            'products': lambda station: url_for('production_stations.ajax_get_products', station_code=station),
            'summary': url_for('production_stations.ajax_station_summary'),
            'config': url_for('production_stations.get_station_frontend_config')
        }
        
        # API URLs (dla complete-task)
        context['api_urls'] = {
            'complete_task': '/production/api/complete-task',
            'get_products': '/production/api/get-products'
        }
        
        return context
        
    except Exception as e:
        logger.error("Błąd context processor stanowiska", extra={'error': str(e)})
        return {
            'current_time': datetime.utcnow(),
            'current_date': date.today(),
            'station_version': '1.2.0',
            'client_ip': request.remote_addr or 'unknown'
        }

# ============================================================================
# HELPER FUNCTIONS DLA TEMPLATES
# ============================================================================

@station_bp.app_template_filter('format_priority')
def format_priority_filter(priority_score):
    """
    Template filter dla formatowania priorytetu
    
    Args:
        priority_score (int): Wynik priorytetu
        
    Returns:
        str: Sformatowany priorytet
    """
    if priority_score >= 200:
        return f"🔴 {priority_score} (Krytyczny)"
    elif priority_score >= 150:
        return f"🟠 {priority_score} (Wysoki)"
    elif priority_score >= 100:
        return f"🟡 {priority_score} (Normalny)"
    else:
        return f"🟢 {priority_score} (Niski)"

@station_bp.app_template_filter('format_deadline')
def format_deadline_filter(deadline_date):
    """
    Template filter dla formatowania deadline
    
    Args:
        deadline_date (date): Data deadline
        
    Returns:
        str: Sformatowany deadline
    """
    if not deadline_date:
        return "Brak terminu"
    
    if isinstance(deadline_date, str):
        try:
            deadline_date = datetime.strptime(deadline_date, '%Y-%m-%d').date()
        except ValueError:
            return "Nieprawidłowa data"
    
    days_diff = (deadline_date - date.today()).days
    
    if days_diff < 0:
        return f"⚠️ Opóźnione o {abs(days_diff)} dni"
    elif days_diff == 0:
        return "🔥 Dziś!"
    elif days_diff == 1:
        return "⚡ Jutro"
    elif days_diff <= 3:
        return f"🟡 Za {days_diff} dni"
    elif days_diff <= 7:
        return f"🟢 Za {days_diff} dni"
    else:
        return deadline_date.strftime("📅 %d.%m.%Y")

@station_bp.app_template_filter('format_volume')
def format_volume_filter(volume_m3):
    """
    Template filter dla formatowania objętości
    
    Args:
        volume_m3 (float): Objętość w m³
        
    Returns:
        str: Sformatowana objętość
    """
    if not volume_m3:
        return "—"
    
    try:
        volume = float(volume_m3)
        if volume >= 1.0:
            return f"{volume:.2f} m³"
        else:
            return f"{volume:.3f} m³"
    except (ValueError, TypeError):
        return "—"

@station_bp.app_template_filter('format_currency')
def format_currency_filter(amount):
    """
    Template filter dla formatowania kwot
    
    Args:
        amount (float): Kwota
        
    Returns:
        str: Sformatowana kwota
    """
    if not amount:
        return "—"
    
    try:
        amount = float(amount)
        return f"{amount:,.2f} PLN".replace(",", " ")
    except (ValueError, TypeError):
        return "—"

@station_bp.app_template_filter('truncate_smart')
def truncate_smart_filter(text, length=50):
    """
    Template filter dla inteligentnego skracania tekstu
    
    Args:
        text (str): Tekst do skrócenia
        length (int): Maksymalna długość
        
    Returns:
        str: Skrócony tekst
    """
    if not text or len(text) <= length:
        return text
    
    # Spróbuj skrócić na granicy słowa
    truncated = text[:length]
    last_space = truncated.rfind(' ')
    
    if last_space > length * 0.75:  # Jeśli ostatnia spacja jest blisko końca
        return truncated[:last_space] + "..."
    else:
        return truncated + "..."

@station_bp.app_template_filter('highlight_search')
def highlight_search_filter(text, search_term):
    """
    Template filter dla podświetlania wyszukiwanych fraz
    
    Args:
        text (str): Tekst do podświetlenia
        search_term (str): Fraza do podświetlenia
        
    Returns:
        str: Tekst z podświetleniem HTML
    """
    if not text or not search_term:
        return text
    
    import re
    pattern = re.compile(re.escape(search_term), re.IGNORECASE)
    return pattern.sub(f'<mark class="highlight">{search_term}</mark>', text)

# ============================================================================
# DEBUGGING I DEVELOPMENT HELPERS
# ============================================================================

@station_bp.route('/debug/station-info')
def debug_station_info():
    """
    Debug endpoint z informacjami o stanie stanowisk (tylko w trybie debug)
    
    Returns:
        JSON: Informacje debugowe
    """
    try:
        # Sprawdź czy debug jest włączony
        config = get_station_config()
        if not config.get('debug_frontend', False):
            return jsonify({
                'error': 'Debug mode is disabled'
            }), 403
        
        from ..services.security_service import IPSecurityService
        
        debug_info = {
            'timestamp': datetime.utcnow().isoformat(),
            'client_info': {
                'ip': request.remote_addr,
                'user_agent': request.headers.get('User-Agent'),
                'ip_allowed': IPSecurityService.is_ip_allowed(request.remote_addr)
            },
            'station_summary': get_station_summary(),
            'config': config,
            'request_info': {
                'method': request.method,
                'path': request.path,
                'endpoint': request.endpoint,
                'headers': dict(request.headers)
            }
        }
        
        return jsonify({
            'success': True,
            'debug_info': debug_info
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

logger.info("Zainicjalizowano Station routers dla modułu production", extra={
    'blueprint_name': station_bp.name,
    'protected_by_ip': True,
    'tablet_optimized': True
})