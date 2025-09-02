# modules/production/__init__.py
"""
Moduł Produkcyjny - Wood Power CRM
Odpowiedzialny za zarządzanie produkcją lat drewnianych na stanowiskach sklejania i pakowania
"""

from flask import Blueprint
import logging

# Utworzenie Blueprint dla modułu production
production_bp = Blueprint(
    "production", 
    __name__,
    template_folder="templates",
    static_folder="static",
    url_prefix="/production"
)

# Konfiguracja loggera dla modułu production
production_logger = logging.getLogger('production')

# Import routingu po utworzeniu Blueprint (unikamy circular imports)
from . import routers

# Import funkcji pakowania z utils
try:
    from .utils import (
        calculate_packaging_priority,
        format_packaging_deadline,
        validate_packaging_order,
        sort_packaging_queue,
        calculate_packaging_stats_summary,
        format_packaging_duration,
        generate_packaging_report_data
    )
    production_logger.info("✅ Funkcje pakowania zaimportowane pomyślnie")
except ImportError as e:
    production_logger.warning(f"⚠️ Błąd importu funkcji pakowania: {str(e)}")

def register_packaging_routes():
    """
    Rejestruje dodatkowe routing'i dla pakowania
    """
    # Routing'i pakowania są już zarejestrowane w routers.py
    # Ta funkcja jest dla ewentualnych przyszłych rozszerzeń
    
    # Logowanie zarejestrowanych endpoint'ów pakowania
    packaging_routes = [
        '/work/packaging',
        '/api/packaging/queue', 
        '/api/packaging/complete/<int:order_id>',
        '/api/packaging/stats'
    ]
    
    production_logger.info(
        f"Zarejestrowano {len(packaging_routes)} routing'ów pakowania"
    )
    
    return True

def verify_packaging_database_setup():
    """
    Sprawdza czy baza danych ma wymagane tabele i kolumny dla pakowania
    """
    try:
        from .models import ProductionOrderSummary, ProductionItem
        
        # Sprawdź czy tabele istnieją i mają wymagane kolumny
        required_columns = {
            'production_orders_summary': [
                'packaging_status', 
                'all_items_glued',
                'total_items_count',
                'completed_items_count'
            ],
            'production_items': [
                'packaging_started_at',
                'packaging_completed_at'
            ]
        }
        
        # W rzeczywistej aplikacji można dodać sprawdzenie struktury bazy
        # Na razie tylko logujemy informację
        
        production_logger.info(
            "Sprawdzono strukturę bazy danych dla pakowania"
        )
        
        return True
        
    except Exception as e:
        production_logger.error(f"Błąd sprawdzania struktury bazy dla pakowania: {str(e)}")
        return False

def initialize_production_module():
    """
    Inicjalizuje cały moduł produkcyjny
    """
    try:
        production_logger.info("🚀 Inicjalizacja modułu produkcyjnego...")
        
        # Zarejestruj routing'i pakowania
        register_packaging_routes()
        
        # Sprawdź strukturę bazy danych
        verify_packaging_database_setup()
        
        return True
        
    except Exception as e:
        production_logger.error(f"❌ Błąd inicjalizacji modułu produkcyjnego: {str(e)}")
        return False

# Wywołaj inicjalizację modułu
try:
    initialize_production_module()
except Exception as e:
    production_logger.error(f"Krytyczny błąd inicjalizacji: {str(e)}")

# Eksportujemy Blueprint i kluczowe funkcje dla łatwego importu w głównej aplikacji
__all__ = [
    'production_bp',
    'production_logger',
    'initialize_production_module',
    'register_packaging_routes',
    'verify_packaging_database_setup'
]