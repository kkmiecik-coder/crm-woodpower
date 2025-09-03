from flask import render_template, session, redirect, url_for, request, flash
from functools import wraps
from . import dashboard_bp  # Import blueprint z __init__.py
from .services.stats_service import get_dashboard_stats
from .services.weather_service import get_weather_data
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
    """Główna strona dashboard"""
    user_email = session.get('user_email')
    user = User.query.filter_by(email=user_email).first()
    
    # Pobieranie danych dla dashboard
    try:
        dashboard_stats = get_dashboard_stats(user)
        logger.info("[Dashboard] Retrieved stats: %s", dashboard_stats)
        weather_data = get_weather_data()
    except Exception:
        logger.exception("[Dashboard] Błąd pobierania danych")
        dashboard_stats = {}
        weather_data = {}
    
    return render_template('dashboard.html',
                         user_email=user_email,
                         user=user,
                         stats=dashboard_stats,
                         weather=weather_data)