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
    
    # Pobieranie danych dla dashboard
    try:
        # Podstawowe statystyki
        dashboard_stats = get_dashboard_stats(user)
        logger.info("[Dashboard] Retrieved stats: %s", dashboard_stats)
        
        # Dane pogodowe
        weather_data = get_weather_data()
        logger.info("[Dashboard] Retrieved weather: %s", weather_data.get('city', 'unknown'))
        
        # Dane dla wykresu wycen
        chart_data = get_quotes_chart_data(months=6)
        logger.info("[Dashboard] Retrieved chart data: %s months", len(chart_data.get('labels', [])))
        
        # Top produkty
        top_products = get_top_products_data(limit=5)
        logger.info("[Dashboard] Retrieved top products: %s items", len(top_products))
        
        # Dane produkcji (opcjonalne)
        production_data = get_production_overview()
        logger.info("[Dashboard] Retrieved production data: %s total items", production_data.get('total_items', 0))
        
    except Exception as e:
        logger.exception("[Dashboard] Błąd pobierania danych")
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
    
    return render_template('dashboard.html',
                         user_email=user_email,
                         user=user,
                         stats=dashboard_stats,
                         weather=weather_data,
                         chart_data=chart_data,
                         top_products=top_products,
                         production_data=production_data)

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