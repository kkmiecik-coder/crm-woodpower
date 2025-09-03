"""
Serwis do pobierania statystyk dla dashboard
"""

from datetime import datetime, timedelta
from sqlalchemy import func, and_
from extensions import db

def get_dashboard_stats(user):
    """
    Pobiera podstawowe statystyki dla dashboard
    
    Args:
        user: Obiekt użytkownika
        
    Returns:
        dict: Słownik ze statystykami
    """
    try:
        # Import modeli (unikamy cyklicznych importów)
        from ..quotes.models import Quote, QuoteStatus  # POPRAWIONE!
        from ..calculator.models import Client
        
        # Daty dla filtrowania
        today = datetime.now().date()
        month_start = today.replace(day=1)
        week_start = today - timedelta(days=today.weekday())
        
        stats = {}
        
        # === STATYSTYKI OFERT ===
        
        # Oferty w tym miesiącu
        month_quotes = Quote.query.filter(
            func.date(Quote.created_at) >= month_start
        ).count()
        
        # Oferty w tym tygodniu
        week_quotes = Quote.query.filter(
            func.date(Quote.created_at) >= week_start
        ).count()
        
        # Wartość ofert w tym miesiącu
        month_value_result = db.session.query(func.sum(Quote.total_price)).filter(
            func.date(Quote.created_at) >= month_start
        ).scalar()
        month_value = float(month_value_result) if month_value_result else 0.0
        
        # Zaakceptowane oferty w tym miesiącu
        accepted_quotes = Quote.query.filter(
            and_(
                func.date(Quote.created_at) >= month_start,
                Quote.acceptance_date.isnot(None)
            )
        ).count()
        
        stats['quotes'] = {
            'month_count': month_quotes,
            'week_count': week_quotes,
            'month_value': month_value,
            'accepted_count': accepted_quotes,
            'acceptance_rate': round((accepted_quotes / month_quotes * 100) if month_quotes > 0 else 0, 1)
        }
        
        # === STATYSTYKI KLIENTÓW ===
        
        # Nowi klienci w tym miesiącu (założenie: client_number zawiera datę)
        total_clients = Client.query.count()
        
        stats['clients'] = {
            'total_count': total_clients
        }
        
        # === OSTATNIE DZIAŁANIA ===
        
        # Ostatnie 5 ofert
        recent_quotes = Quote.query.order_by(Quote.created_at.desc()).limit(5).all()
        
        # Ostatni klienci (ostatnie 5)
        recent_clients = Client.query.order_by(Client.id.desc()).limit(5).all()
        
        stats['recent'] = {
            'quotes': recent_quotes,
            'clients': recent_clients
        }
        
        # === PERSONALIZACJA DLA UŻYTKOWNIKA ===
        
        if user.role in ['admin', 'user']:
            # Statystyki użytkownika
            user_quotes_count = Quote.query.filter_by(user_id=user.id).count()
            stats['user'] = {
                'quotes_count': user_quotes_count
            }
        
        return stats
        
    except Exception as e:
        print(f"[StatsService] Błąd pobierania statystyk: {e}")
        return {
            'quotes': {'month_count': 0, 'week_count': 0, 'month_value': 0.0, 'accepted_count': 0, 'acceptance_rate': 0.0},
            'clients': {'total_count': 0},
            'recent': {'quotes': [], 'clients': []},
            'user': {'quotes_count': 0}
        }

def get_quick_stats_summary():
    """
    Pobiera szybkie podsumowanie do wyświetlenia w małych widgetach
    
    Returns:
        dict: Podstawowe liczniki
    """
    try:
        from ..quotes.models import Quote  # POPRAWIONE!
        from ..calculator.models import Client
        
        today = datetime.now().date()
        
        total_quotes = Quote.query.count()
        total_clients = Client.query.count()
        today_quotes = Quote.query.filter(func.date(Quote.created_at) == today).count()
        
        return {
            'total_quotes': total_quotes,
            'total_clients': total_clients, 
            'today_quotes': today_quotes
        }
        
    except Exception as e:
        print(f"[StatsService] Błąd quick stats: {e}")
        return {
            'total_quotes': 0,
            'total_clients': 0,
            'today_quotes': 0
        }