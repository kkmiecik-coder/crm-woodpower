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
Wersja: 1.1 (Poprawione URL routing)
Data: 2025-09-10
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
            # POPRAWIONE - dodano prefix
            return redirect(url_for('production.production_main.dashboard'))
        
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
            'panel/dashboard.html',
            dashboard_stats=dashboard_stats,
            page_title="Dashboard Produkcji"
        )
        
    except Exception as e:
        logger.error("Błąd dashboard główny", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e)
        })
        flash(f'Błąd ładowania dashboard: {str(e)}', 'error')
        return render_template('panel/dashboard.html',
                            dashboard_stats={}, 
                            page_title="Dashboard Produkcji")

@main_bp.route('/products')
@login_required
def products_list():
    """
    GET /production/products - Szczegółowa lista produktów (PRD Section 6.1)
    
    ROZBUDOWANA WERSJA z:
    - Zaawansowanym filtrowaniem
    - Paginacją 
    - Sortowaniem
    - AJAX support
    - Metadata dla UI
    
    Query params:
        page: numer strony (default: 1)
        per_page: produktów na stronę (default: 50, max: 200)
        status: filtr statusu
        search: wyszukiwanie w ID/nazwie
        client: filtr klienta (ID lub nazwa)
        wood_species: gatunek drewna
        technology: technologia
        wood_class: klasa drewna
        date_from: data od (YYYY-MM-DD)
        date_to: data do (YYYY-MM-DD)
        priority_min: minimalny priorytet
        priority_max: maksymalny priorytet
        sort_by: kolumna sortowania (default: priority_score)
        sort_order: kierunek sortowania (asc|desc, default: desc)
        
    Returns: 
        HTML: Pełna strona z listą produktów
        JSON: Dane dla AJAX (gdy X-Requested-With: XMLHttpRequest)
    """
    try:
        logger.info("Dostęp do listy produktów - rozbudowana wersja", extra={
            'user_id': current_user.id,
            'user_role': getattr(current_user, 'role', 'unknown'),
            'query_params': dict(request.args)
        })
        
        from ..models import ProductionItem
        from sqlalchemy import desc, asc, and_, or_
        
        # ============================================================================
        # PARSOWANIE PARAMETRÓW
        # ============================================================================
        
        # Paginacja
        page = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 50, type=int), 200)  # Max 200
        
        # Filtry podstawowe
        status_filter = request.args.get('status')
        search_query = request.args.get('search', '').strip()
        
        # Filtry zaawansowane
        client_filter = request.args.get('client', '').strip()
        wood_species_filter = request.args.get('wood_species')
        technology_filter = request.args.get('technology')
        wood_class_filter = request.args.get('wood_class')
        
        # Filtry dat
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        
        # Filtry priorytetu
        priority_min = request.args.get('priority_min', type=int)
        priority_max = request.args.get('priority_max', type=int)
        
        # Sortowanie
        sort_by = request.args.get('sort_by', 'priority_score')
        sort_order = request.args.get('sort_order', 'desc').lower()
        
        # Walidacja sortowania
        valid_sort_columns = [
            'priority_score', 'created_at', 'deadline_date', 'current_status',
            'short_product_id', 'internal_order_number', 'baselinker_order_id',
            'parsed_wood_species', 'parsed_technology', 'volume_m3'
        ]
        
        if sort_by not in valid_sort_columns:
            sort_by = 'priority_score'
        
        if sort_order not in ['asc', 'desc']:
            sort_order = 'desc'
        
        # ============================================================================
        # BUDOWANIE QUERY
        # ============================================================================
        
        query = ProductionItem.query
        
        # Filtr statusu
        if status_filter and status_filter != 'all':
            query = query.filter(ProductionItem.current_status == status_filter)
        
        # Wyszukiwanie w ID zamówienia i nazwie produktu
        if search_query:
            search_pattern = f'%{search_query}%'
            query = query.filter(
                or_(
                    ProductionItem.short_product_id.ilike(search_pattern),
                    ProductionItem.internal_order_number.ilike(search_pattern),
                    ProductionItem.original_product_name.ilike(search_pattern),
                    ProductionItem.baselinker_order_id.ilike(search_pattern)
                )
            )
        
        # Filtr gatunku drewna
        if wood_species_filter:
            query = query.filter(ProductionItem.parsed_wood_species == wood_species_filter)
        
        # Filtr technologii
        if technology_filter:
            query = query.filter(ProductionItem.parsed_technology == technology_filter)
        
        # Filtr klasy drewna
        if wood_class_filter:
            query = query.filter(ProductionItem.parsed_wood_class == wood_class_filter)
        
        # Filtry dat
        if date_from:
            try:
                from datetime import datetime
                date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                query = query.filter(ProductionItem.created_at >= date_from_obj)
            except ValueError:
                logger.warning("Nieprawidłowy format date_from", extra={'date_from': date_from})
        
        if date_to:
            try:
                from datetime import datetime, timedelta
                date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                # Dodaj 1 dzień żeby uwzględnić cały dzień
                date_to_end = datetime.combine(date_to_obj, datetime.max.time())
                query = query.filter(ProductionItem.created_at <= date_to_end)
            except ValueError:
                logger.warning("Nieprawidłowy format date_to", extra={'date_to': date_to})
        
        # Filtry priorytetu
        if priority_min is not None:
            query = query.filter(ProductionItem.priority_score >= priority_min)
        
        if priority_max is not None:
            query = query.filter(ProductionItem.priority_score <= priority_max)
        
        # ============================================================================
        # SORTOWANIE
        # ============================================================================
        
        sort_column = getattr(ProductionItem, sort_by)
        if sort_order == 'desc':
            query = query.order_by(desc(sort_column))
        else:
            query = query.order_by(asc(sort_column))
        
        # Dodaj secondary sort dla stabilności
        if sort_by != 'priority_score':
            query = query.order_by(desc(ProductionItem.priority_score))
        if sort_by not in ['created_at', 'priority_score']:
            query = query.order_by(desc(ProductionItem.created_at))
        
        # ============================================================================
        # WYKONANIE QUERY Z PAGINACJĄ
        # ============================================================================
        
        # Przed paginacją - policz total dla statystyk
        total_count = query.count()
        
        # Wykonaj paginację
        paginated_products = query.paginate(
            page=page,
            per_page=per_page,
            error_out=False
        )
        
        products = paginated_products.items
        
        # ============================================================================
        # PRZYGOTOWANIE DANYCH
        # ============================================================================
        
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
        
        # Statystyki dla aktualnego filtra
        filter_stats = {
            'total_products': total_count,
            'current_page': page,
            'per_page': per_page,
            'total_pages': paginated_products.pages,
            'has_prev': paginated_products.has_prev,
            'has_next': paginated_products.has_next,
            'prev_num': paginated_products.prev_num,
            'next_num': paginated_products.next_num
        }
        
        # Dodatkowe statystyki dla filtru
        if products:
            from datetime import datetime
            
            high_priority_count = sum(1 for p in products if (p.priority_score or 0) >= 150)
            overdue_count = sum(1 for p in products 
                              if p.deadline_date and p.deadline_date < datetime.now().date())
            avg_priority = sum(p.priority_score or 0 for p in products) / len(products)
            
            filter_stats.update({
                'high_priority_count': high_priority_count,
                'overdue_count': overdue_count,
                'avg_priority': round(avg_priority, 1)
            })
        
        # Aktywne filtry dla UI
        active_filters = {
            'status': status_filter,
            'search': search_query,
            'client': client_filter,
            'wood_species': wood_species_filter,
            'technology': technology_filter,
            'wood_class': wood_class_filter,
            'date_from': date_from,
            'date_to': date_to,
            'priority_min': priority_min,
            'priority_max': priority_max,
            'sort_by': sort_by,
            'sort_order': sort_order
        }
        
        # ============================================================================
        # RESPONSE - AJAX vs HTML
        # ============================================================================
        
        # Jeśli to AJAX request, zwróć JSON
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            
            # Przygotuj produkty jako dict dla JSON
            products_data = []
            for product in products:
                # Oblicz dni do deadline
                days_to_deadline = None
                if product.deadline_date:
                    days_to_deadline = (product.deadline_date - datetime.now().date()).days
                
                product_dict = {
                    'id': product.id,
                    'short_product_id': product.short_product_id,
                    'internal_order_number': product.internal_order_number,
                    'baselinker_order_id': product.baselinker_order_id,
                    'original_product_name': product.original_product_name,
                    'current_status': product.current_status,
                    'priority_score': product.priority_score or 0,
                    'deadline_date': product.deadline_date.isoformat() if product.deadline_date else None,
                    'days_to_deadline': days_to_deadline,
                    'created_at': product.created_at.isoformat() if product.created_at else None,
                    'parsed_data': {
                        'wood_species': product.parsed_wood_species,
                        'technology': product.parsed_technology,
                        'wood_class': product.parsed_wood_class,
                        'volume_m3': float(product.volume_m3) if product.volume_m3 else None,
                        'dimensions': f"{product.parsed_length_cm or 0}×{product.parsed_width_cm or 0}×{product.parsed_thickness_cm or 0}cm"
                    },
                    'financial_data': {
                        'unit_price_net': float(product.unit_price_net) if product.unit_price_net else None,
                        'total_value_net': float(product.total_value_net) if product.total_value_net else None
                    },
                    'status_flags': {
                        'is_overdue': days_to_deadline is not None and days_to_deadline < 0,
                        'is_urgent': days_to_deadline is not None and days_to_deadline <= 2,
                        'is_high_priority': (product.priority_score or 0) >= 150
                    }
                }
                products_data.append(product_dict)
            
            return jsonify({
                'success': True,
                'products': products_data,
                'pagination': {
                    'page': page,
                    'per_page': per_page,
                    'total': total_count,
                    'pages': paginated_products.pages,
                    'has_prev': paginated_products.has_prev,
                    'has_next': paginated_products.has_next,
                    'prev_num': paginated_products.prev_num,
                    'next_num': paginated_products.next_num,
                    'page_range': list(paginated_products.iter_pages())
                },
                'filters': active_filters,
                'stats': filter_stats,
                'sort': {
                    'sort_by': sort_by,
                    'sort_order': sort_order
                }
            })
        
        # ============================================================================
        # STANDARD HTML RESPONSE
        # ============================================================================
        
        return render_template(
            'production/products.html',
            products=products,
            pagination=paginated_products,
            status_filter=status_filter,
            search_query=search_query,
            client_filter=client_filter,
            wood_species_filter=wood_species_filter,
            technology_filter=technology_filter,
            wood_class_filter=wood_class_filter,
            date_from=date_from,
            date_to=date_to,
            priority_min=priority_min,
            priority_max=priority_max,
            sort_by=sort_by,
            sort_order=sort_order,
            status_options=status_options,
            active_filters=active_filters,
            filter_stats=filter_stats,
            is_admin=is_admin,
            page_title="Lista Produktów Produkcyjnych"
        )
        
    except Exception as e:
        logger.error("Błąd listy produktów - rozbudowana", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e),
            'query_params': dict(request.args)
        })
        flash(f'Błąd ładowania listy produktów: {str(e)}', 'error')
        
        # Fallback response
        return render_template('production/products.html', 
                             products=[], 
                             pagination=None,
                             status_filter=None,
                             search_query='',
                             status_options=[],
                             active_filters={},
                             filter_stats={},
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
            'panel/config.html',
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
        # POPRAWIONE: Dodano prefix production.
        return redirect(url_for('production.production_main.dashboard'))

# ============================================================================
# HELPER ROUTERS
# ============================================================================

@main_bp.route('/update-priority', methods=['POST'])
@admin_required
def update_product_priority():
    """
    POST /production/update-priority
    
    ROZBUDOWANA WERSJA - Aktualizuje priorytet produktu (drag&drop w liście produktów)
    Obsługuje zarówno pojedyncze produkty jak i batch update
    Dostępne tylko dla adminów zgodnie z PRD.
    
    Body (JSON):
    {
        "product_id": 123,              // Dla pojedynczego produktu
        "new_priority": 150,            // Nowy priorytet
        
        // LUB dla batch update:
        "products": [                   // Lista produktów z priorytetami
            {"id": 123, "priority": 150},
            {"id": 124, "priority": 149},
            ...
        ]
    }
    
    Returns: JSON z rezultatem
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Brak danych JSON'}), 400
        
        from ..models import ProductionItem
        
        # ============================================================================
        # SINGLE PRODUCT UPDATE
        # ============================================================================
        
        if 'product_id' in data and 'new_priority' in data:
            product_id = data['product_id']
            new_priority = data['new_priority']
            
            # Walidacja
            if not isinstance(new_priority, int) or new_priority < 0 or new_priority > 200:
                return jsonify({'success': False, 'error': 'Priorytet musi być liczbą 0-200'}), 400
            
            product = ProductionItem.query.get(product_id)
            if not product:
                return jsonify({'success': False, 'error': 'Produkt nie znaleziony'}), 404
            
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
                'updated_count': 1,
                'product': {
                    'id': product_id,
                    'short_product_id': product.short_product_id,
                    'old_priority': old_priority,
                    'new_priority': new_priority
                }
            })
        
        # ============================================================================
        # BATCH PRODUCTS UPDATE (DRAG & DROP)
        # ============================================================================
        
        elif 'products' in data:
            products_data = data['products']
            
            if not isinstance(products_data, list) or not products_data:
                return jsonify({'success': False, 'error': 'Lista produktów nie może być pusta'}), 400
            
            updated_count = 0
            failed_count = 0
            errors = []
            updated_products = []
            
            for product_data in products_data:
                try:
                    product_id = product_data.get('id')
                    new_priority = product_data.get('priority')
                    
                    # Walidacja pojedynczego elementu
                    if not product_id or new_priority is None:
                        errors.append(f'Brak ID lub priorytetu dla elementu: {product_data}')
                        failed_count += 1
                        continue
                    
                    if not isinstance(new_priority, int) or new_priority < 0 or new_priority > 200:
                        errors.append(f'Nieprawidłowy priorytet {new_priority} dla produktu {product_id}')
                        failed_count += 1
                        continue
                    
                    # Aktualizuj produkt
                    product = ProductionItem.query.get(product_id)
                    if not product:
                        errors.append(f'Produkt {product_id} nie znaleziony')
                        failed_count += 1
                        continue
                    
                    old_priority = product.priority_score
                    product.priority_score = new_priority
                    
                    updated_products.append({
                        'id': product_id,
                        'short_product_id': product.short_product_id,
                        'old_priority': old_priority,
                        'new_priority': new_priority
                    })
                    
                    updated_count += 1
                    
                except Exception as e:
                    errors.append(f'Błąd produktu {product_id}: {str(e)}')
                    failed_count += 1
            
            # Zapisz zmiany jeśli były jakieś udane aktualizacje
            if updated_count > 0:
                db.session.commit()
            
            logger.info("Batch update priorytetów", extra={
                'user_id': current_user.id,
                'total_products': len(products_data),
                'updated_count': updated_count,
                'failed_count': failed_count
            })
            
            return jsonify({
                'success': True,
                'message': f'Zaktualizowano {updated_count} produktów',
                'updated_count': updated_count,
                'failed_count': failed_count,
                'errors': errors,
                'updated_products': updated_products
            })
        
        else:
            return jsonify({'success': False, 'error': 'Wymagane: product_id+new_priority lub products'}), 400
        
    except Exception as e:
        db.session.rollback()
        logger.error("Błąd aktualizacji priorytetu", extra={
            'user_id': current_user.id if current_user.is_authenticated else None,
            'error': str(e),
            'request_data': data if 'data' in locals() else None
        })
        return jsonify({
            'success': False,
            'error': f'Błąd serwera: {str(e)}'
        }), 500

# ============================================================================
# ERROR HANDLERS
# ============================================================================

@main_bp.errorhandler(404)
def not_found(error):
    """Handler dla błędów 404"""
    flash('Nie znaleziono żądanej strony', 'error')
    # POPRAWIONE: Dodano prefix production.
    return redirect(url_for('production.production_main.dashboard'))

@main_bp.errorhandler(500) 
def server_error(error):
    """Handler dla błędów serwera"""
    logger.error("Błąd serwera w main routers", extra={
        'user_id': current_user.id if current_user.is_authenticated else None,
        'error': str(error),
        'path': request.path
    })
    flash('Wystąpił błąd systemu', 'error')
    # POPRAWIONE: Dodano prefix production.
    return redirect(url_for('production.production_main.dashboard'))

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
            'dashboard_url': url_for('production.production_main.dashboard'),
            'products_url': url_for('production.production_main.products_list'), 
            'config_url': url_for('production.production_main.config_panel'),
            # Dodatkowe URL dla API
            'api_dashboard_stats': url_for('production.production_api.dashboard_stats'),
            'api_manual_sync': url_for('production.production_api.manual_sync')
        }
    except Exception as e:
        logger.error("Błąd context processor main", extra={'error': str(e)})
        return {
            'current_time': datetime.utcnow(),
            'dashboard_url': '#',
            'products_url': '#', 
            'config_url': '#'
        }

logger.info("Zainicjalizowano Main routers zgodnie z PRD", extra={
    'blueprint_name': main_bp.name,
    'routers_count': 3,  # dashboard, products, config
    'prd_compliance': True
})