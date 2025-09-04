from flask import render_template, session, redirect, url_for, request, flash
from functools import wraps
from . import dashboard_bp  # Import blueprint z __init__.py
from .services.stats_service import get_dashboard_stats
from .services.weather_service import get_weather_data
from .services.chart_service import get_quotes_chart_data, get_top_products_data, get_production_overview
from ..calculator.models import User
import logging

logger = logging.getLogger(__name__)

def login_required(func):
    """Dekorator zabezpieczający strony – wymaga zalogowania"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            flash("Twoja sesja wygasła. Zaloguj się ponownie.", "info")
            return redirect(url_for('login'))
        return func(*args, **kwargs)
    return wrapper

@dashboard_bp.route('/')
@dashboard_bp.route('/dashboard')
@login_required
def dashboard():
    """Główna strona dashboard z nowymi widgetami"""
    user_email = session.get('user_email')
    user = User.query.filter_by(email=user_email).first()
    
    logger.info("[Dashboard] DEBUG: Starting dashboard route")
    logger.info(f"[Dashboard] DEBUG: User email: {user_email}")
    logger.info(f"[Dashboard] DEBUG: User object: {user}")
    
    # Pobieranie danych dla dashboard
    try:
        # Podstawowe statystyki
        logger.info("[Dashboard] DEBUG: Getting dashboard stats...")
        dashboard_stats = get_dashboard_stats(user)
        logger.info("[Dashboard] Retrieved stats: %s", dashboard_stats)
        
        # Dane pogodowe
        logger.info("[Dashboard] DEBUG: Getting weather data...")
        weather_data = get_weather_data()
        logger.info("[Dashboard] Retrieved weather: %s", weather_data.get('city', 'unknown'))
        
        # Dane dla wykresu wycen
        logger.info("[Dashboard] DEBUG: Getting chart data...")
        chart_data = get_quotes_chart_data(months=6)
        logger.info("[Dashboard] Retrieved chart data: %s months", len(chart_data.get('labels', [])))
        
        # DEBUG - sprawdź szczegóły chart_data
        logger.info(f"[Dashboard] DEBUG: Chart data type: {type(chart_data)}")
        logger.info(f"[Dashboard] DEBUG: Chart data keys: {chart_data.keys() if isinstance(chart_data, dict) else 'Not a dict'}")
        
        if 'summary' in chart_data:
            logger.info("[Dashboard] DEBUG: Chart summary - total: %s, accepted: %s, ordered: %s", 
                       chart_data['summary'].get('total_quotes', 0),
                       chart_data['summary'].get('accepted_quotes', 0), 
                       chart_data['summary'].get('ordered_quotes', 0))
        else:
            logger.warning("[Dashboard] DEBUG: No 'summary' key in chart_data!")
        
        if 'labels' in chart_data:
            logger.info(f"[Dashboard] DEBUG: Chart labels: {chart_data['labels']}")
        else:
            logger.warning("[Dashboard] DEBUG: No 'labels' key in chart_data!")
        
        if 'datasets' in chart_data:
            logger.info(f"[Dashboard] DEBUG: Chart datasets: {chart_data['datasets']}")
        else:
            logger.warning("[Dashboard] DEBUG: No 'datasets' key in chart_data!")
        
        # Top produkty
        logger.info("[Dashboard] DEBUG: Getting top products...")
        top_products = get_top_products_data(limit=5)
        logger.info("[Dashboard] Retrieved top products: %s items", len(top_products))
        
        # Dane produkcji (opcjonalne)
        logger.info("[Dashboard] DEBUG: Getting production data...")
        production_data = get_production_overview()
        logger.info("[Dashboard] Retrieved production data: %s total items", production_data.get('total_items', 0))
        
    except Exception as e:
        logger.exception("[Dashboard] Błąd pobierania danych")
        logger.error(f"[Dashboard] DEBUG: Exception in dashboard route: {type(e).__name__}: {e}")
        
        # Fallback values
        dashboard_stats = {
            'quotes': {'month_count': 0, 'week_count': 0, 'month_value': 0.0, 'accepted_count': 0, 'acceptance_rate': 0.0},
            'clients': {'total_count': 0},
            'recent': {'quotes': [], 'clients': []},
            'user': {'quotes_count': 0}
        }
        weather_data = {'success': False, 'message': 'Błąd pobierania danych pogodowych'}
        chart_data = {'summary': {'total_quotes': 0, 'accepted_quotes': 0, 'ordered_quotes': 0}}
        top_products = []
        production_data = {'total_items': 0, 'statuses': []}
    
    logger.info("[Dashboard] DEBUG: Rendering template with data...")
    logger.info(f"[Dashboard] DEBUG: Final chart_data being passed to template: {chart_data}")
    
    return render_template('dashboard.html',
                         user_email=user_email,
                         user=user,
                         stats=dashboard_stats,
                         weather=weather_data,
                         chart_data=chart_data,
                         top_products=top_products,
                         production_data=production_data)

# Dodaj endpoint debugowania
@dashboard_bp.route('/debug/database')
@login_required
def debug_database():
    """Debug endpoint - sprawdź stan bazy danych"""
    try:
        from ...quotes.models import Quote
        from ...baselinker.models import BaselinkerReportsOrders
        
        logger.info("[Dashboard] DEBUG: Database debug endpoint called")
        
        # Sprawdź tabele
        quotes_count = Quote.query.count()
        orders_count = BaselinkerReportsOrders.query.count()
        
        logger.info(f"[Dashboard] DEBUG: Quotes count: {quotes_count}")
        logger.info(f"[Dashboard] DEBUG: Orders count: {orders_count}")
        
        # Przykładowe rekordy
        sample_quotes = Quote.query.limit(3).all()
        sample_orders = BaselinkerReportsOrders.query.limit(3).all()
        
        debug_info = {
            'quotes_table': {
                'exists': True,
                'count': quotes_count,
                'sample_ids': [q.id for q in sample_quotes],
                'sample_dates': [q.created_at.isoformat() if q.created_at else None for q in sample_quotes],
                'sample_data': [
                    {
                        'id': q.id,
                        'quote_number': q.quote_number,
                        'created_at': q.created_at.isoformat() if q.created_at else None,
                        'acceptance_date': q.acceptance_date.isoformat() if q.acceptance_date else None
                    } for q in sample_quotes
                ]
            },
            'orders_table': {
                'exists': True, 
                'count': orders_count,
                'sample_ids': [o.id for o in sample_orders],
                'sample_dates': [o.date_created.isoformat() if o.date_created else None for o in sample_orders],
                'sample_data': [
                    {
                        'id': o.id,
                        'baselinker_order_id': o.baselinker_order_id,
                        'date_created': o.date_created.isoformat() if o.date_created else None,
                        'customer_name': o.customer_name
                    } for o in sample_orders
                ]
            }
        }
        
        logger.info(f"[Dashboard] DEBUG: Database info: {debug_info}")
        return debug_info
        
    except Exception as e:
        logger.exception(f"[Dashboard] DEBUG: Error in database debug: {e}")
        return {'error': str(e), 'type': type(e).__name__}

@dashboard_bp.route('/api/refresh-stats')
@login_required  
def refresh_stats():
    """API endpoint do odświeżania statystyk dashboard"""
    try:
        user_email = session.get('user_email')
        user = User.query.filter_by(email=user_email).first()
        
        # Pobierz fresh dane
        dashboard_stats = get_dashboard_stats(user)
        chart_data = get_quotes_chart_data(months=6)
        top_products = get_top_products_data(limit=5)
        
        return {
            'success': True,
            'stats': dashboard_stats,
            'chart_data': chart_data,
            'top_products': top_products,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.exception("[Dashboard] Błąd odświeżania statystyk")
        return {'success': False, 'error': str(e)}, 500

@dashboard_bp.route('/api/weather')
@login_required
def refresh_weather():
    """API endpoint do odświeżania danych pogodowych"""
    try:
        weather_data = get_weather_data()
        return {
            'success': True,
            'weather': weather_data,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.exception("[Dashboard] Błąd odświeżania pogody")
        return {'success': False, 'error': str(e)}, 500

@dashboard_bp.route('/api/chart-data/<chart_type>')
@login_required
def get_chart_data(chart_type):
    """API endpoint do pobierania danych wykresów"""
    try:
        if chart_type == 'quotes':
            months = request.args.get('months', 6, type=int)
            data = get_quotes_chart_data(months=months)
        elif chart_type == 'products':
            limit = request.args.get('limit', 5, type=int)
            data = get_top_products_data(limit=limit)
        elif chart_type == 'production':
            data = get_production_overview()
        else:
            return {'success': False, 'error': 'Unknown chart type'}, 400
            
        return {
            'success': True,
            'data': data,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.exception(f"[Dashboard] Błąd pobierania danych wykresu {chart_type}")
        return {'success': False, 'error': str(e)}, 500