# modules/production/routers/__init__.py
"""
Routery modułu Production
==========================

Inicjalizacja wszystkich routerów dla modułu produkcyjnego:
- api_routes: Endpoints API dla operacji produkcyjnych
- station_routes: Interfejsy stanowisk produkcyjnych (tablet-friendly)
- admin_routes: Panel administracyjny z zarządzaniem konfiguracją

Struktura URL:
- /production/api/* - REST API endpoints
- /production/* - Interfejsy stanowisk (cutting, assembly, packaging)
- /production/admin/* - Panel administracyjny

Autor: Konrad Kmiecik
Wersja: 1.2 (Finalna - z zabezpieczeniami)
Data: 2025-01-08
"""

from flask import Blueprint
from modules.logging import get_structured_logger

logger = get_structured_logger('production.routers')

# Blueprinty dla różnych grup routerów
api_bp = None
station_bp = None
admin_bp = None

# Import routerów (będą dodawane postupnie)
try:
    from .api_routes import api_bp as imported_api_bp
    api_bp = imported_api_bp
    logger.info("Zaimportowano API routes")
except ImportError as e:
    logger.warning(f"Nie można zaimportować API routes: {e}")

try:
    from .station_routes import station_bp as imported_station_bp
    station_bp = imported_station_bp
    logger.info("Zaimportowano Station routes")
except ImportError as e:
    logger.warning(f"Nie można zaimportować Station routes: {e}")

try:
    from .admin_routes import admin_bp as imported_admin_bp
    admin_bp = imported_admin_bp
    logger.info("Zaimportowano Admin routes")
except ImportError as e:
    logger.warning(f"Nie można zaimportować Admin routes: {e}")

def get_available_routes():
    """
    Pobiera listę dostępnych routerów
    
    Returns:
        Dict[str, bool]: Status dostępności routerów
    """
    return {
        'api_routes': api_bp is not None,
        'station_routes': station_bp is not None,
        'admin_routes': admin_bp is not None
    }

def register_production_routes(main_blueprint):
    """
    Rejestruje wszystkie dostępne routery w głównym blueprint
    
    Args:
        main_blueprint: Główny blueprint modułu production
    """
    if main_blueprint.deferred_functions:
        logger.info("Routery modułu production już zarejestrowane - pomijam ponowną rejestrację")
        return 0

    registered_count = 0

    if api_bp:
        main_blueprint.register_blueprint(api_bp, url_prefix='/api')
        registered_count += 1
        logger.info("Zarejestrowano API routes pod /production/api")

    if station_bp:
        main_blueprint.register_blueprint(station_bp, url_prefix='')
        registered_count += 1
        logger.info("Zarejestrowano Station routes pod /production")

    if admin_bp:
        main_blueprint.register_blueprint(admin_bp, url_prefix='/admin')
        registered_count += 1
        logger.info("Zarejestrowano Admin routes pod /production/admin")

    logger.info("Zakończono rejestrację routerów", extra={
        'registered_count': registered_count,
        'total_possible': 3
    })

    return registered_count

# Funkcje pomocnicze dla routerów
def get_route_stats():
    """
    Pobiera statystyki routerów
    
    Returns:
        Dict[str, Any]: Statystyki routerów
    """
    stats = {
        'available_routers': get_available_routes(),
        'total_routers': 3,
        'loaded_routers': sum(1 for r in get_available_routes().values() if r)
    }
    
    # Dodatkowe informacje o routach (jeśli routery są dostępne)
    route_info = {}
    
    if api_bp:
        # Pobierz informacje o API routes
        route_info['api'] = {
            'prefix': '/api',
            'description': 'REST API endpoints for production operations',
            'protected': True,
            'content_type': 'application/json'
        }
    
    if station_bp:
        # Pobierz informacje o Station routes
        route_info['stations'] = {
            'prefix': '',
            'description': 'Tablet-optimized interfaces for production stations',
            'protected': True,  # Zabezpieczone IP
            'content_type': 'text/html'
        }
    
    if admin_bp:
        # Pobierz informacje o Admin routes
        route_info['admin'] = {
            'prefix': '/admin',
            'description': 'Administrative panel for production management',
            'protected': True,  # Wymaga autoryzacji
            'content_type': 'text/html'
        }
    
    stats['route_info'] = route_info
    
    return stats

# URL patterns dla różnych typów routerów
URL_PATTERNS = {
    'api_routes': [
        '/api/sync',                    # Synchronizacja ręczna
        '/api/complete-task',           # Ukończenie zadania
        '/api/update-priority',         # Aktualizacja priorytetu
        '/api/get-products',            # Pobieranie produktów dla stanowiska
        '/api/health',                  # Health check
        '/api/stats',                   # Statystyki produkcji
        '/api/config',                  # Zarządzanie konfiguracją
        '/api/errors',                  # Obsługa błędów
    ],
    'station_routes': [
        '/',                           # Wybór stanowiska
        '/station-select',             # Wybór stanowiska (alternatywny)
        '/cutting',                    # Stanowisko wycinania
        '/assembly',                   # Stanowisko składania
        '/packaging',                  # Stanowisko pakowania
    ],
    'admin_routes': [
        '/admin',                      # Dashboard administratora
        '/admin/dashboard',            # Dashboard (alternatywny)
        '/admin/config',               # Konfiguracja systemu
        '/admin/priorities',           # Zarządzanie priorytetami
        '/admin/sync-logs',            # Logi synchronizacji
        '/admin/errors',               # Zarządzanie błędami
        '/admin/users',                # Zarządzanie użytkownikami stanowisk
        '/admin/stats',                # Szczegółowe statystyki
    ]
}

def get_all_url_patterns():
    """
    Pobiera wszystkie wzorce URL dla modułu
    
    Returns:
        Dict[str, List[str]]: Wzorce URL pogrupowane po typach
    """
    return URL_PATTERNS

def validate_route_access(route_path: str, user_role: str = None, client_ip: str = None):
    """
    Waliduje dostęp do konkretnej trasy
    
    Args:
        route_path (str): Ścieżka trasy do sprawdzenia
        user_role (str, optional): Rola użytkownika
        client_ip (str, optional): IP klienta
    
    Returns:
        Dict[str, Any]: Wynik walidacji dostępu
    """
    validation_result = {
        'allowed': False,
        'route_type': None,
        'requires_auth': False,
        'requires_ip_whitelist': False,
        'reason': None
    }
    
    # Identyfikacja typu trasy
    if route_path.startswith('/admin'):
        validation_result['route_type'] = 'admin'
        validation_result['requires_auth'] = True
        
        # Admin routes wymagają roli admin
        if user_role and user_role.lower() in ['admin', 'administrator']:
            validation_result['allowed'] = True
        else:
            validation_result['reason'] = 'Admin role required'
            
    elif route_path.startswith('/api'):
        validation_result['route_type'] = 'api'
        validation_result['requires_auth'] = True
        
        # API routes wymagają autoryzacji (ale nie koniecznie admin)
        if user_role and user_role.lower() in ['admin', 'user', 'partner']:
            validation_result['allowed'] = True
        else:
            validation_result['reason'] = 'Authentication required'
            
    elif route_path in ['/', '/station-select', '/cutting', '/assembly', '/packaging']:
        validation_result['route_type'] = 'station'
        validation_result['requires_ip_whitelist'] = True
        
        # Station routes wymagają tylko IP whitelist (bez autoryzacji)
        try:
            from ..services.security_service import IPSecurityService
            if client_ip and IPSecurityService.is_ip_allowed(client_ip):
                validation_result['allowed'] = True
            else:
                validation_result['reason'] = 'IP not whitelisted for station access'
        except Exception as e:
            validation_result['reason'] = f'IP validation error: {str(e)}'
    else:
        validation_result['reason'] = 'Unknown route'
    
    return validation_result

# Middleware helpers dla routerów
def apply_common_headers(response):
    """
    Stosuje wspólne nagłówki dla wszystkich odpowiedzi modułu
    
    Args:
        response: Obiekt odpowiedzi Flask
        
    Returns:
        response: Zmodyfikowana odpowiedź
    """
    # Nagłówki bezpieczeństwa
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    # Nagłówki dla modułu production
    response.headers['X-Production-Module'] = 'WoodPower-Production-v1.2'
    
    return response

def log_route_access(request, response_status=None):
    """
    Loguje dostęp do tras modułu
    
    Args:
        request: Obiekt request Flask
        response_status (int, optional): Status odpowiedzi
    """
    try:
        from ..services.security_service import IPSecurityService
        
        client_ip = IPSecurityService.get_client_ip(request)
        
        logger.info("Route access", extra={
            'path': request.path,
            'method': request.method,
            'client_ip': client_ip,
            'user_agent': request.headers.get('User-Agent', 'Unknown'),
            'response_status': response_status,
            'endpoint': request.endpoint
        })
        
    except Exception as e:
        logger.error("Błąd logowania dostępu do trasy", extra={
            'error': str(e),
            'path': request.path if request else 'unknown'
        })

# Eksport głównych komponentów
__all__ = [
    'api_bp',
    'station_bp', 
    'admin_bp',
    'get_available_routes',
    'register_production_routes',
    'get_route_stats',
    'get_all_url_patterns',
    'validate_route_access',
    'apply_common_headers',
    'log_route_access',
    'URL_PATTERNS'
]

# Metadata routerów
__version__ = '1.2.0'
__total_routers__ = 3
__description__ = 'Production module routers with security and monitoring'

logger.info("Zainicjalizowano moduł routerów production", extra={
    'version': __version__,
    'total_routers': __total_routers__,
    'loaded_routers': sum(1 for r in get_available_routes().values() if r)
})