# modules/production/routers.py
"""
Routing i views dla modułu Production
"""

from flask import render_template, request, jsonify, session, redirect, url_for, flash
from functools import wraps
from datetime import datetime, date
from . import production_bp
from .models import (
    ProductionItem, ProductionStatus, ProductionStation,
    Worker, ProductionConfig, ProductionOrderSummary
)
from .service import ProductionService
from .utils import ProductionStatsCalculator
from extensions import db
from modules.logging import get_structured_logger

# Inicjalizacja loggera
production_logger = get_structured_logger('production.routers')
production_logger.info("✅ production_logger zainicjowany poprawnie w routers.py")


def login_required(func):
    """Dekorator wymagający zalogowania"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            production_logger.warning("Próba dostępu bez autoryzacji",
                                     endpoint=request.endpoint,
                                     ip=request.remote_addr)
            flash("Twoja sesja wygasła. Zaloguj się ponownie.", "error")
            return redirect(url_for('login'))
        return func(*args, **kwargs)
    return wrapper


# ============================================================================
# PANEL KONTROLNY - VIEWS
# ============================================================================

@production_bp.route('/')
@login_required
def dashboard():
    """Dashboard modułu produkcyjnego"""
    user_email = session.get('user_email')
    production_logger.info("Dostęp do dashboardu produkcji", user_email=user_email)
    
    try:
        # Pobierz podstawowe statystyki dla dashboardu
        total_items = ProductionItem.query.count()
        pending_items = ProductionItem.query.join(ProductionStatus).filter(
            ProductionStatus.name == 'pending'
        ).count()
        in_progress_items = ProductionItem.query.join(ProductionStatus).filter(
            ProductionStatus.name == 'in_progress'
        ).count()
        completed_items = ProductionItem.query.join(ProductionStatus).filter(
            ProductionStatus.name == 'completed'
        ).count()
        
        # Pobierz statusy stanowisk
        stations = ProductionStation.query.filter_by(is_active=True).all()
        
        # Przygotuj dane dla widoku
        dashboard_data = {
            'total_items': total_items,
            'pending_items': pending_items,
            'in_progress_items': in_progress_items,
            'completed_items': completed_items,
            'stations': [station.to_dict() for station in stations]
        }
        
        return render_template('production/dashboard.html', data=dashboard_data)
        
    except Exception as e:
        production_logger.error("Błąd podczas ładowania dashboardu",
                              user_email=user_email, error=str(e))
        flash('Błąd podczas ładowania dashboardu', 'error')
        return render_template('dashboard.html', data=dashboard_data)


@production_bp.route('/production-list')
@production_bp.route('/settings')
@production_bp.route('/reports')
@login_required
def redirect_to_dashboard():
    """Przekierowanie legacy tras do dashboardu"""
    production_logger.info("Przekierowanie do dashboardu", path=request.path)
    return redirect(url_for('production.dashboard'))


@production_bp.route('/settings')
@login_required
def settings():
    """Ustawienia modułu produkcyjnego"""
    user_email = session.get('user_email')
    production_logger.info("Dostęp do ustawień produkcji", user_email=user_email)
    
    try:
        # Pobierz konfigurację
        configs = ProductionConfig.query.all()
        workers = Worker.query.filter_by(is_active=True).all()
        stations = ProductionStation.query.all()
        
        settings_data = {
            'configs': [config.to_dict() for config in configs],
            'workers': [worker.to_dict() for worker in workers],
            'stations': [station.to_dict() for station in stations]
        }
        
        return render_template('production/settings.html', data=settings_data)
        
    except Exception as e:
        production_logger.error("Błąd podczas ładowania ustawień",
                              user_email=user_email, error=str(e))
        flash('Błąd podczas ładowania ustawień', 'error')
        return render_template('production/settings.html', data={})


@production_bp.route('/api/settings')
@login_required
def api_settings():
    """API dane do ustawień"""
    try:
        # Pobierz konfigurację
        configs = ProductionConfig.query.all()
        workers = Worker.query.filter_by(is_active=True).all()
        
        return jsonify({
            'success': True,
            'data': {
                'configs': [config.to_dict() for config in configs],
                'workers': [worker.to_dict() for worker in workers]
            }
        })
        
    except Exception as e:
        production_logger.error("Błąd API ustawień", error=str(e))
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# API ENDPOINTS - RAPORTY
# ============================================================================


@production_bp.route('/api/reports/workers')
@login_required
def api_reports_workers():
    """API raport wydajności pracowników"""
    try:
        from datetime import datetime
        date_from_str = request.args.get('date_from')
        date_to_str = request.args.get('date_to')
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date() if date_from_str else None
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date() if date_to_str else None

        calculator = ProductionStatsCalculator()
        workers = Worker.query.filter_by(is_active=True).all()

        workers_data = []
        for worker in workers:
            stats = calculator.calculate_worker_stats(worker.id, date_from, date_to)
            stats['worker_name'] = worker.name
            workers_data.append(stats)

        return jsonify({'success': True, 'data': workers_data})

    except Exception as e:
        production_logger.error("Błąd API raportu pracowników", error=str(e))
        return jsonify({'success': False, 'error': str(e)}), 500


@production_bp.route('/api/reports/stations')
@login_required
def api_reports_stations():
    """API raport wydajności stanowisk"""
    try:
        from datetime import datetime
        date_from_str = request.args.get('date_from')
        date_to_str = request.args.get('date_to')
        date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date() if date_from_str else None
        date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date() if date_to_str else None

        calculator = ProductionStatsCalculator()
        stations = ProductionStation.query.filter_by(is_active=True).all()

        stations_data = []
        for station in stations:
            stats = calculator.calculate_station_stats(station.id, date_from, date_to)
            stats['station_name'] = station.name
            stats['station_type'] = station.station_type
            stations_data.append(stats)

        return jsonify({'success': True, 'data': stations_data})

    except Exception as e:
        production_logger.error("Błąd API raportu stanowisk", error=str(e))
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# STANOWISKO PRACY - VIEWS (NOWA LOGIKA)
# ============================================================================

@production_bp.route('/work')
def work_station_select():
    """Ekran 1: Wybór typu stanowiska (sklejanie/pakowanie)"""
    production_logger.info("Dostęp do wyboru typu stanowiska")
    
    return render_template('station_select.html')


# ============================================================================
# API ENDPOINTS - WEBHOOK I SYNCHRONIZACJA
# ============================================================================

@production_bp.route('/api/test-baselinker', methods=['GET'])
@login_required
def api_test_baselinker():
    """Test połączenia z Baselinker API"""
    user_email = session.get('user_email')
    production_logger.info("Test połączenia z Baselinker", user_email=user_email)
    
    try:
        service = ProductionService()
        
        # Test podstawowy - pobierz jeden status
        result = service._make_baselinker_request('getOrders', {
            'status_id': 138619,  # W produkcji - surowe
            'get_unconfirmed_orders': True,
            'include_custom_extra_fields': True
        })
        
        orders = result.get('orders', [])
        
        return jsonify({
            'success': True,
            'message': 'Połączenie z Baselinker działa!',
            'orders_found': len(orders),
            'sample_order_ids': [order.get('order_id') for order in orders[:3]]  # Pierwsze 3 ID
        })
        
    except Exception as e:
        production_logger.error("Błąd testu Baselinker",
                              user_email=user_email, error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@production_bp.route('/api/sync-test', methods=['POST'])
@login_required  
def api_sync_test():
    """Test synchronizacji jednego zamówienia"""
    user_email = session.get('user_email')
    
    try:
        data = request.get_json() or {}
        order_id = data.get('order_id')
        
        if not order_id:
            return jsonify({'success': False, 'error': 'Brak order_id'}), 400
        
        production_logger.info("Test synchronizacji zamówienia",
                             user_email=user_email, order_id=order_id)
        
        service = ProductionService()
        
        # Pobierz konkretne zamówienie
        result = service._make_baselinker_request('getOrders', {
            'order_id': order_id,
            'include_custom_extra_fields': True
        })
        
        orders = result.get('orders', [])
        if not orders:
            return jsonify({'success': False, 'error': 'Zamówienie nie znalezione'}), 404
        
        # Przetwórz zamówienie
        stats = service.process_order_from_baselinker(orders[0])
        
        return jsonify({
            'success': True,
            'message': 'Zamówienie przetworzone pomyślnie',
            'order_id': order_id,
            'stats': stats
        })
        
    except Exception as e:
        production_logger.error("Błąd testu synchronizacji",
                              user_email=user_email, error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@production_bp.route('/api/baselinker-webhook', methods=['POST'])
def api_baselinker_webhook():
    """Webhook z Baselinker - automatyczne pobieranie zamówień"""
    production_logger.info("Otrzymano webhook z Baselinker")
    
    try:
        # Pobierz serwis i zsynchronizuj nowe zamówienia
        service = ProductionService()
        result = service.sync_new_orders()
        
        production_logger.info("Webhook Baselinker przetworzony pomyślnie",
                             result=result)
        
        return jsonify({
            'success': True,
            'message': 'Webhook przetworzony pomyślnie',
            'result': result
        })
        
    except Exception as e:
        production_logger.error("Błąd podczas przetwarzania webhook Baselinker",
                              error=str(e), error_type=type(e).__name__)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@production_bp.route('/api/sync-orders', methods=['POST'])
@login_required
def api_sync_orders():
    """Ręczne pobieranie zamówień z Baselinker"""
    user_email = session.get('user_email')
    production_logger.info("Ręczna synchronizacja zamówień", user_email=user_email)
    
    try:
        data = request.get_json() or {}
        date_from = data.get('date_from')
        date_to = data.get('date_to')
        
        service = ProductionService()
        result = service.sync_orders_by_date(date_from, date_to)
        
        production_logger.info("Ręczna synchronizacja zakończona pomyślnie",
                             user_email=user_email, result=result)
        
        return jsonify({
            'success': True,
            'message': 'Synchronizacja zakończona pomyślnie',
            'result': result
        })
        
    except Exception as e:
        production_logger.error("Błąd podczas ręcznej synchronizacji",
                              user_email=user_email, error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@production_bp.route('/api/recalculate-priorities', methods=['POST'])
@login_required
def api_recalculate_priorities():
    """Przelicza priorytety wszystkich produktów oczekujących - NOWA WERSJA"""
    user_email = session.get('user_email')
    production_logger.info("Przeliczanie priorytetów", user_email=user_email)
    
    try:
        # Użyj nowego systemu przenumerowania kolejki
        from .utils import ProductionPriorityCalculator
        calculator = ProductionPriorityCalculator()
        result = calculator.renumber_production_queue()
        
        production_logger.info("Przeliczanie priorytetów zakończone",
                             user_email=user_email, result=result)
        
        return jsonify({
            'success': True,
            'message': f'Kolejka produkcyjna przeliczona pomyślnie. Przenumerowano {result["renumbered"]} produktów.',
            'result': result
        })
        
    except Exception as e:
        production_logger.error("Błąd przeliczania priorytetów",
                              user_email=user_email, error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@production_bp.route('/api/test-parser', methods=['POST'])
@login_required
def api_test_parser():
    """Test parsera nazw produktów"""
    try:
        data = request.get_json()
        product_name = data.get('product_name', '')
        
        if not product_name:
            return jsonify({'success': False, 'error': 'Brak product_name'}), 400
        
        # Test parsera z production utils
        from .utils import ProductionNameParser
        parser = ProductionNameParser()
        result = parser.parse_product_name(product_name)
        
        return jsonify({
            'success': True,
            'product_name': product_name,
            'parsed_result': result,
            'parser_used': 'reports' if parser.reports_parser else 'fallback'
        })
        
    except Exception as e:
        production_logger.error("Błąd testu parsera", error=str(e))
        return jsonify({'success': False, 'error': str(e)}), 500


@production_bp.route('/api/reparse-products', methods=['POST'])
@login_required
def api_reparse_products():
    """Re-parsuje nazwy wszystkich produktów i aktualizuje pola"""
    user_email = session.get('user_email')
    production_logger.info("Re-parsowanie nazw produktów", user_email=user_email)
    
    try:
        from .utils import ProductionNameParser
        parser = ProductionNameParser()
        
        # Pobierz wszystkie produkty
        items = ProductionItem.query.all()
        updated_count = 0
        
        for item in items:
            # Parsuj nazwę produktu
            parsed_data = parser.parse_product_name(item.product_name)
            
            # Sprawdź czy są zmiany
            changes_made = False
            
            # Aktualizuj pola jeśli parser zwrócił dane
            if parsed_data.get('wood_species') and parsed_data['wood_species'] != item.wood_species:
                item.wood_species = parsed_data['wood_species']
                changes_made = True
                
            if parsed_data.get('wood_technology') and parsed_data['wood_technology'] != item.wood_technology:
                item.wood_technology = parsed_data['wood_technology']
                changes_made = True
                
            if parsed_data.get('wood_class') and parsed_data['wood_class'] != item.wood_class:
                item.wood_class = parsed_data['wood_class']
                changes_made = True
                
            if parsed_data.get('finish_type') and parsed_data['finish_type'] != item.finish_type:
                item.finish_type = parsed_data['finish_type']
                changes_made = True
                
            if parsed_data.get('dimensions_length') and parsed_data['dimensions_length'] != item.dimensions_length:
                item.dimensions_length = parsed_data['dimensions_length']
                changes_made = True
                
            if parsed_data.get('dimensions_width') and parsed_data['dimensions_width'] != item.dimensions_width:
                item.dimensions_width = parsed_data['dimensions_width']
                changes_made = True
                
            if parsed_data.get('dimensions_thickness') and parsed_data['dimensions_thickness'] != item.dimensions_thickness:
                item.dimensions_thickness = parsed_data['dimensions_thickness']
                changes_made = True
            
            if changes_made:
                updated_count += 1
        
        # Zapisz zmiany
        db.session.commit()
        
        production_logger.info("Re-parsowanie zakończone",
                             user_email=user_email, 
                             total_items=len(items),
                             updated_count=updated_count)
        
        return jsonify({
            'success': True,
            'message': 'Re-parsowanie zakończone pomyślnie',
            'result': {
                'total_items': len(items),
                'updated_count': updated_count
            }
        })
        
    except Exception as e:
        production_logger.error("Błąd re-parsowania produktów",
                              user_email=user_email, error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# API ENDPOINTS - PANEL KONTROLNY
# ============================================================================

@production_bp.route('/api/dashboard')
@login_required
def api_dashboard():
    """API dane do dashboardu"""
    try:
        # Statystyki produktów
        total_items = ProductionItem.query.count()
        pending_items = ProductionItem.query.join(ProductionStatus).filter(
            ProductionStatus.name == 'pending'
        ).count()
        in_progress_items = ProductionItem.query.join(ProductionStatus).filter(
            ProductionStatus.name == 'in_progress'
        ).count()
        completed_items = ProductionItem.query.join(ProductionStatus).filter(
            ProductionStatus.name == 'completed'
        ).count()
        
        # Statusy stanowisk - ZAKTUALIZOWANE
        stations = ProductionStation.query.filter_by(is_active=True).all()
        stations_data = []
        
        for station in stations:
            station_dict = station.to_dict()
            
            # Dodaj informacje o czasie pracy
            if station.current_item and station.current_item.gluing_started_at:
                # Użyj lokalnego czasu zamiast UTC
                import pytz
                poland_tz = pytz.timezone('Europe/Warsaw')
                now_local = datetime.now(poland_tz).replace(tzinfo=None)
    
                working_time = now_local - station.current_item.gluing_started_at
                station_dict['working_time_seconds'] = int(working_time.total_seconds())
            
            # NOWY KOD: Dodaj szczegółowe informacje o aktualnym produkcie
            if station.current_item_id and station.current_item:
                current_item = station.current_item
                
                # Podstawowe informacje o produkcie
                station_dict['current_item'] = {
                    'id': current_item.id,
                    'product_name': current_item.product_name,
                    'baselinker_order_id': current_item.baselinker_order_id,
                    'quantity': current_item.quantity,
                    'wood_species': current_item.wood_species,
                    'wood_technology': current_item.wood_technology,
                    'wood_class': current_item.wood_class,
                    'dimensions_length': current_item.dimensions_length,
                    'dimensions_width': current_item.dimensions_width,
                    'dimensions_thickness': current_item.dimensions_thickness,
                    'gluing_started_at': current_item.gluing_started_at.isoformat() if current_item.gluing_started_at else None,
                    'deadline_date': current_item.deadline_date.isoformat() if current_item.deadline_date else None
                }
                
                # Informacje o pracowniku
                if current_item.glued_by_worker_id and current_item.glued_by_worker:
                    station_dict['current_item']['glued_by_worker'] = {
                        'id': current_item.glued_by_worker.id,
                        'name': current_item.glued_by_worker.name
                    }
                else:
                    station_dict['current_item']['glued_by_worker'] = None
            else:
                station_dict['current_item'] = None
                
            stations_data.append(station_dict)
        
        # Kolejka produktów (top 10)
        queue_items = ProductionItem.get_queue_items(limit=10)
        
        # Produkty z przekroczonym deadline
        overdue_items = ProductionItem.query.join(ProductionStatus).filter(
            ProductionStatus.name.in_(['pending', 'in_progress']),
            ProductionItem.deadline_date < db.func.current_date()
        ).count()
        
        return jsonify({
            'success': True,
            'data': {
                'stats': {
                    'total_items': total_items,
                    'pending_items': pending_items,
                    'in_progress_items': in_progress_items,
                    'completed_items': completed_items,
                    'overdue_items': overdue_items
                },
                'stations': stations_data,
                'queue_preview': [item.to_dict() for item in queue_items]
            }
        })
        
    except Exception as e:
        production_logger.error("Błąd API dashboardu", error=str(e))
        return jsonify({'success': False, 'error': str(e)}), 500


@production_bp.route('/api/items')
def api_items():
    """API lista produktów z filtrami - NOWA WERSJA BEZ PAGINACJI"""
    try:
        # Pobierz parametry filtrów
        status_name = request.args.get('status')
        wood_species = request.args.get('wood_species')
        wood_technology = request.args.get('wood_technology')
        station_id = request.args.get('station_id')
        worker_id = request.args.get('worker_id')
        
        # Parametry paginacji - ignorowane dla pełnej listy
        limit = request.args.get('limit')  # Opcjonalny limit dla testów
        
        # Buduj query z filtrami
        query = ProductionItem.query
        
        if status_name:
            query = query.join(ProductionStatus).filter(ProductionStatus.name == status_name)
        if wood_species:
            query = query.filter(ProductionItem.wood_species == wood_species)
        if wood_technology:
            query = query.filter(ProductionItem.wood_technology == wood_technology)
        if station_id:
            query = query.filter(ProductionItem.glued_at_station_id == int(station_id))
        if worker_id:
            query = query.filter(ProductionItem.glued_by_worker_id == int(worker_id))
        
        # Sortowanie według priority_score (pozycja w kolejce)
        query = query.order_by(ProductionItem.priority_score.asc())
        
        # Opcjonalny limit (dla testów/debugowania)
        if limit:
            try:
                limit_int = int(limit)
                query = query.limit(limit_int)
            except ValueError:
                pass  # Ignoruj nieprawidłowy limit
        
        # Pobierz wszystkie wyniki
        items = query.all()
        
        # Format odpowiedzi
        items_data = []
        for item in items:
            item_dict = item.to_dict()
            # Dodaj sformatowaną pozycję w kolejce
            item_dict['formatted_priority'] = f"{item.priority_score:03d}" if item.priority_score else "000"
            items_data.append(item_dict)
        
        return jsonify({
            'success': True,
            'data': items_data,
            'total_count': len(items),
            'has_filters': bool(status_name or wood_species or wood_technology or station_id or worker_id),
            'applied_filters': {
                'status': status_name,
                'wood_species': wood_species,
                'wood_technology': wood_technology,
                'station_id': station_id,
                'worker_id': worker_id
            }
        })
        
    except Exception as e:
        production_logger.error("Błąd API listy produktów", error=str(e))
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# API ENDPOINTS - STANOWISKO SKLEJANIA
# ============================================================================

@production_bp.route('/api/worker/login', methods=['POST'])
def api_worker_login():
    """API logowanie pracownika na stanowisku"""
    try:
        data = request.get_json()
        worker_id = data.get('worker_id')
        
        if not worker_id:
            return jsonify({'success': False, 'error': 'Brak worker_id'}), 400
        
        worker = Worker.query.get_or_404(worker_id)
        
        if not worker.is_active:
            return jsonify({'success': False, 'error': 'Pracownik nieaktywny'}), 400
        
        production_logger.info("Pracownik zalogowany na stanowisku",
                             worker_id=worker_id, worker_name=worker.name)
        
        return jsonify({
            'success': True,
            'worker': worker.to_dict()
        })
        
    except Exception as e:
        production_logger.error("Błąd logowania pracownika", error=str(e))
        return jsonify({'success': False, 'error': str(e)}), 500


@production_bp.route('/api/item/<int:item_id>/complete', methods=['POST'])
def api_complete_item(item_id):
    """API zakończenie produkcji produktu"""
    try:
        # Zakończ produkcję
        service = ProductionService()
        result = service.complete_production(item_id)
        
        production_logger.info("Zakończono produkcję produktu", item_id=item_id)
        
        return jsonify({
            'success': True,
            'message': 'Produkcja zakończona',
            'result': result
        })
        
    except Exception as e:
        production_logger.error("Błąd kończenia produkcji",
                              item_id=item_id, error=str(e))
        return jsonify({'success': False, 'error': str(e)}), 500


@production_bp.route('/api/stations/status')
def api_stations_status():
    """API status wszystkich stanowisk - dla odświeżania co 1 sekundę"""
    try:
        stations = ProductionStation.query.filter_by(is_active=True).all()
        
        stations_data = []
        for station in stations:
            station_dict = station.to_dict()
            
            # Dodaj informacje o czasie pracy
            if station.current_item and station.current_item.gluing_started_at:
                # Użyj lokalnego czasu zamiast UTC
                import pytz
                poland_tz = pytz.timezone('Europe/Warsaw')
                now_local = datetime.now(poland_tz).replace(tzinfo=None)
    
                working_time = now_local - station.current_item.gluing_started_at
                station_dict['working_time_seconds'] = int(working_time.total_seconds())
    
                # Sprawdź czy przekroczono czas
                standard_time = int(ProductionConfig.get_value('gluing_time_minutes', '20')) * 60
                station_dict['is_overtime'] = working_time.total_seconds() > standard_time
            
            # NOWY KOD: Dodaj szczegółowe informacje o aktualnym produkcie
            if station.current_item_id and station.current_item:
                current_item = station.current_item
                
                # Podstawowe informacje o produkcie
                station_dict['current_item'] = {
                    'id': current_item.id,
                    'product_name': current_item.product_name,
                    'baselinker_order_id': current_item.baselinker_order_id,
                    'quantity': current_item.quantity,
                    'wood_species': current_item.wood_species,
                    'wood_technology': current_item.wood_technology,
                    'wood_class': current_item.wood_class,
                    'dimensions_length': current_item.dimensions_length,
                    'dimensions_width': current_item.dimensions_width,
                    'dimensions_thickness': current_item.dimensions_thickness,
                    'gluing_started_at': current_item.gluing_started_at.isoformat() if current_item.gluing_started_at else None,
                    'deadline_date': current_item.deadline_date.isoformat() if current_item.deadline_date else None
                }
                
                # Informacje o pracowniku
                if current_item.glued_by_worker_id and current_item.glued_by_worker:
                    station_dict['current_item']['glued_by_worker'] = {
                        'id': current_item.glued_by_worker.id,
                        'name': current_item.glued_by_worker.name
                    }
                else:
                    station_dict['current_item']['glued_by_worker'] = None
            else:
                station_dict['current_item'] = None
                
            stations_data.append(station_dict)
        
        return jsonify({
            'success': True,
            'data': stations_data
        })
        
    except Exception as e:
        production_logger.error("Błąd API statusu stanowisk", error=str(e))
        return jsonify({'success': False, 'error': str(e)}), 500
    
@production_bp.route('/api/renumber-queue', methods=['POST'])
@login_required
def api_renumber_queue():
    """API przenumerowanie całej kolejki produkcyjnej"""
    user_email = session.get('user_email')
    production_logger.info("Ręczne przenumerowanie kolejki", user_email=user_email)
    
    try:
        from .utils import ProductionPriorityCalculator
        calculator = ProductionPriorityCalculator()
        result = calculator.renumber_production_queue()
        
        production_logger.info("Przenumerowanie kolejki zakończone",
                             user_email=user_email, result=result)
        
        return jsonify({
            'success': True,
            'message': f'Kolejka przenumerowana pomyślnie. Zaktualizowano {result["renumbered"]} produktów.',
            'result': result
        })
        
    except Exception as e:
        production_logger.error("Błąd przenumerowania kolejki",
                              user_email=user_email, error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@production_bp.route('/api/items/<int:item_id>/reorder', methods=['POST'])
@login_required
def api_reorder_item(item_id):
    """API zmiana pozycji produktu w kolejce"""
    user_email = session.get('user_email')
    
    try:
        data = request.get_json()
        new_position = data.get('new_position')
        
        if not new_position or not isinstance(new_position, int) or new_position < 1:
            return jsonify({
                'success': False,
                'error': 'new_position musi być liczbą dodatnią'
            }), 400
        
        production_logger.info("Zmiana pozycji produktu",
                             user_email=user_email, item_id=item_id, new_position=new_position)
        
        from .utils import ProductionPriorityCalculator
        calculator = ProductionPriorityCalculator()
        result = calculator.reorder_item_to_position(item_id, new_position)
        
        production_logger.info("Zmiana pozycji produktu zakończona",
                             user_email=user_email, result=result)
        
        return jsonify({
            'success': True,
            'message': f'Produkt przeniesiony z pozycji {result["old_position"]} na {result["new_position"]}',
            'result': result
        })
        
    except ValueError as e:
        production_logger.warning("Nieprawidłowe dane zmiany pozycji",
                                user_email=user_email, item_id=item_id, error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400
        
    except Exception as e:
        production_logger.error("Błąd zmiany pozycji produktu",
                              user_email=user_email, item_id=item_id, error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@production_bp.route('/api/queue-structure')
@login_required
def api_queue_structure():
    """API struktura kolejki produkcyjnej (dla debugowania)"""
    try:
        from .utils import ProductionPriorityCalculator
        calculator = ProductionPriorityCalculator()
        structure = calculator._get_queue_structure_summary()
        
        return jsonify({
            'success': True,
            'data': structure
        })
        
    except Exception as e:
        production_logger.error("Błąd pobierania struktury kolejki", error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@production_bp.route('/api/priority-explanation/<int:item_id>')
@login_required
def api_priority_explanation(item_id):
    """API wyjaśnienie priorytetu konkretnego produktu"""
    try:
        # Pobierz produkt
        item = ProductionItem.query.get_or_404(item_id)
        
        # Pobierz wielkość zamówienia
        order_size = ProductionItem.query.filter_by(
            baselinker_order_id=item.baselinker_order_id
        ).count()
        
        # Wygeneruj wyjaśnienie
        from .utils import ProductionPriorityCalculator
        calculator = ProductionPriorityCalculator()
        explanation = calculator.get_priority_explanation(
            wood_species=item.wood_species,
            wood_technology=item.wood_technology,
            wood_class=item.wood_class,
            deadline_date=item.deadline_date,
            order_size=order_size,
            created_at=item.created_at
        )
        
        return jsonify({
            'success': True,
            'item': {
                'id': item.id,
                'product_name': item.product_name,
                'current_priority_score': item.priority_score,
                'priority_group': item.priority_group
            },
            'explanation': explanation
        })
        
    except Exception as e:
        production_logger.error("Błąd wyjaśnienia priorytetu",
                              item_id=item_id, error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# STANOWISKO PAKOWANIA
# ============================================================================

@production_bp.route('/work/packaging')
def work_packaging_dashboard():
    """Interfejs stanowiska pakowania"""
    production_logger.info("Dostęp do interfejsu pakowania")
    
    try:
        return render_template('packaging_dashboard.html')
        
    except Exception as e:
        production_logger.error("Błąd podczas ładowania interfejsu pakowania", error=str(e))
        return render_template('error.html',
                             error="Błąd ładowania interfejsu pakowania")


# ===== API ENDPOINTS DLA PAKOWANIA =====

@production_bp.route('/api/packaging/queue')
def api_packaging_queue():
    """API: Lista zamówień gotowych do pakowania"""
    production_logger.info("API: Pobieranie kolejki pakowania")
    
    try:
        # Pobierz zamówienia gotowe do pakowania
        orders_ready = ProductionOrderSummary.query.filter(
            ProductionOrderSummary.all_items_glued == True,
            ProductionOrderSummary.packaging_status.in_(['waiting', 'in_progress'])
        ).order_by(
            ProductionOrderSummary.created_at.asc()
        ).all()
        
        orders_data = []
        
        for order in orders_ready:
            # Pobierz produkty zamówienia
            products = ProductionItem.query.filter_by(
                baselinker_order_id=order.baselinker_order_id
            ).all()
            
            # Oblicz priorytet na podstawie deadline
            earliest_deadline = None
            if products:
                deadlines = [p.deadline_date for p in products if p.deadline_date]
                if deadlines:
                    earliest_deadline = min(deadlines)
            
            # Ustal priorytet
            priority = 'normal'
            if earliest_deadline:
                today = date.today()
                days_diff = (earliest_deadline - today).days
                
                if days_diff < 0:
                    priority = 'urgent'  # Opóźnione
                elif days_diff <= 1:
                    priority = 'urgent'  # Dziś lub jutro
                elif days_diff <= 3:
                    priority = 'medium'  # Do 3 dni
            
            # Przygotuj dane produktów
            products_data = []
            for product in products:
                products_data.append({
                    'name': product.product_name,
                    'qty': product.quantity,
                    'wood_species': product.wood_species,
                    'wood_technology': product.wood_technology,
                    'wood_class': product.wood_class,
                    'finish_type': product.finish_type
                })
            
            order_data = {
                'id': order.id,
                'baselinker_order_id': order.baselinker_order_id,
                'order_number': order.internal_order_number or f"#{order.baselinker_order_id}",
                'customer_name': f"Zamówienie #{order.baselinker_order_id}",
                'deadline': earliest_deadline.isoformat() if earliest_deadline else None,
                'priority': priority,
                'total_items_count': order.total_items_count,
                'completed_items_count': order.completed_items_count,
                'all_items_glued': order.all_items_glued,
                'packaging_status': order.packaging_status,
                'products': products_data,
                'created_at': order.created_at.isoformat() if order.created_at else None
            }
            
            orders_data.append(order_data)
        
        production_logger.info(f"API: Zwrócono {len(orders_data)} zamówień do pakowania")
        
        return jsonify({
            'success': True,
            'count': len(orders_data),
            'orders': orders_data
        })
        
    except Exception as e:
        production_logger.error("Błąd API kolejki pakowania", error=str(e))
        return jsonify({
            'success': False,
            'error': str(e),
            'orders': []
        }), 500


@production_bp.route('/api/packaging/complete/<int:order_id>', methods=['POST'])
def api_packaging_complete(order_id):
    """API: Oznacz zamówienie jako spakowane"""
    production_logger.info(f"API: Pakowanie zamówienia {order_id}")
    
    try:
        data = request.get_json() or {}
        baselinker_order_id = data.get('baselinker_order_id')
        update_baselinker = data.get('update_baselinker', True)
        
        # Pobierz zamówienie
        order_summary = ProductionOrderSummary.query.get_or_404(order_id)
        
        # Sprawdź czy zamówienie można pakować
        if not order_summary.all_items_glued:
            production_logger.warning(f"Próba pakowania zamówienia {order_id} - nie wszystkie produkty sklejone")
            return jsonify({
                'success': False,
                'error': 'Nie wszystkie produkty zostały sklejone'
            }), 400
        
        if order_summary.packaging_status == 'completed':
            production_logger.warning(f"Próba pakowania już spakowanego zamówienia {order_id}")
            return jsonify({
                'success': False,
                'error': 'Zamówienie zostało już spakowane'
            }), 400
        
        # Aktualizuj status pakowania
        order_summary.packaging_status = 'completed'
        order_summary.updated_at = datetime.utcnow()
        
        # Aktualizuj czasy pakowania dla wszystkich produktów zamówienia
        products = ProductionItem.query.filter_by(
            baselinker_order_id=order_summary.baselinker_order_id
        ).all()
        
        packaging_time = datetime.utcnow()
        
        for product in products:
            if product.packaging_completed_at is None:
                product.packaging_completed_at = packaging_time
                if product.packaging_started_at is None:
                    product.packaging_started_at = packaging_time
        
        # Zapisz zmiany w bazie danych
        db.session.commit()
        
        production_logger.info(f"Zamówienie {order_id} oznaczone jako spakowane")
        
        # Aktualizuj status w Baselinker (jeśli wymagane)
        baselinker_success = True
        baselinker_error = None
        
        if update_baselinker and baselinker_order_id:
            try:
                from .service import ProductionService
                service = ProductionService()
                
                baselinker_success = service.update_order_status_to_shipped(
                    baselinker_order_id
                )
                
                if baselinker_success:
                    production_logger.info(f"Status zamówienia {baselinker_order_id} zaktualizowany w Baselinker")
                else:
                    baselinker_error = "Błąd aktualizacji statusu w Baselinker"
                    production_logger.error(baselinker_error)
                    
            except Exception as e:
                baselinker_success = False
                baselinker_error = str(e)
                production_logger.error("Błąd aktualizacji Baselinker", error=str(e))
        
        return jsonify({
            'success': True,
            'message': 'Zamówienie zostało spakowane',
            'order_id': order_id,
            'baselinker_order_id': baselinker_order_id,
            'packaging_completed_at': packaging_time.isoformat(),
            'baselinker_updated': baselinker_success,
            'baselinker_error': baselinker_error
        })
        
    except Exception as e:
        db.session.rollback()
        production_logger.error(f"Błąd podczas pakowania zamówienia {order_id}", error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@production_bp.route('/api/packaging/stats')
def api_packaging_stats():
    """API: Statystyki pakowania"""
    production_logger.info("API: Pobieranie statystyk pakowania")
    
    try:
        today = date.today()
        
        # Statystyki dzienne
        orders_waiting = ProductionOrderSummary.query.filter(
            ProductionOrderSummary.all_items_glued == True,
            ProductionOrderSummary.packaging_status == 'waiting'
        ).count()
        
        orders_in_progress = ProductionOrderSummary.query.filter(
            ProductionOrderSummary.packaging_status == 'in_progress'
        ).count()
        
        orders_completed_today = ProductionOrderSummary.query.filter(
            ProductionOrderSummary.packaging_status == 'completed',
            func.date(ProductionOrderSummary.updated_at) == today
        ).count()
        
        # Produkty spakowane dzisiaj
        products_packed_today = ProductionItem.query.filter(
            func.date(ProductionItem.packaging_completed_at) == today
        ).count()
        
        stats = {
            'orders_waiting': orders_waiting,
            'orders_in_progress': orders_in_progress,
            'orders_completed_today': orders_completed_today,
            'products_packed_today': products_packed_today,
            'date': today.isoformat()
        }
        
        production_logger.info("API: Statystyki pakowania pobrane", stats=stats)
        
        return jsonify({
            'success': True,
            'stats': stats
        })
        
    except Exception as e:
        production_logger.error("Błąd API statystyk pakowania", error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500