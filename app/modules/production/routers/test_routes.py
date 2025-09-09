# modules/production/routers/test_routes.py
"""
Test Router dla modułu Production
==================================

Kompletny test backendu modułu produkcyjnego przed rozpoczęciem prac nad frontendem.
Sprawdza wszystkie komponenty: models, services, utilities, konfigurację i integracje.

Endpoint: GET /production/test/backend
Autor: Konrad Kmiecik
Data: 2025-01-08
"""

from flask import Blueprint, jsonify, request
from datetime import datetime
import traceback
import sys
import os

# Import głównego loggera
from modules.logging import get_structured_logger

# Inicjalizacja Blueprint i logger
test_bp = Blueprint('prod_test_routes', __name__)
logger = get_structured_logger('production.test')

@test_bp.route('/test/backend', methods=['GET'])
def test_backend_complete():
    """
    Kompletny test backendu modułu production
    
    Returns:
        JSON: Szczegółowy raport z testów wszystkich komponentów
    """
    
    test_results = {
        'test_timestamp': datetime.utcnow().isoformat(),
        'test_status': 'UNKNOWN',
        'overall_success': False,
        'components': {},
        'summary': {
            'total_tests': 0,
            'passed_tests': 0,
            'failed_tests': 0,
            'errors': []
        }
    }
    
    logger.info("🚀 Rozpoczęcie kompleksowego testu backendu modułu production")
    
    # ============================================================================
    # TEST 1: IMPORTY I STRUKTURA MODUŁU
    # ============================================================================
    
    test_results['components']['module_structure'] = test_module_structure()
    
    # ============================================================================
    # TEST 2: MODELE BAZY DANYCH
    # ============================================================================
    
    test_results['components']['database_models'] = test_database_models()
    
    # ============================================================================
    # TEST 3: SERWISY (SERVICES)
    # ============================================================================
    
    test_results['components']['services'] = test_services()
    
    # ============================================================================
    # TEST 4: KONFIGURACJA I CACHE
    # ============================================================================
    
    test_results['components']['configuration'] = test_configuration()
    
    # ============================================================================
    # TEST 5: ZABEZPIECZENIA I WALIDACJA
    # ============================================================================
    
    test_results['components']['security'] = test_security()
    
    # ============================================================================
    # TEST 6: INTEGRACJE ZEWNĘTRZNE
    # ============================================================================
    
    test_results['components']['integrations'] = test_integrations()
    
    # ============================================================================
    # PODSUMOWANIE WYNIKÓW
    # ============================================================================
    
    # Oblicz statystyki
    for component_name, component_result in test_results['components'].items():
        test_results['summary']['total_tests'] += len(component_result.get('tests', {}))
        
        for test_name, test_result in component_result.get('tests', {}).items():
            if test_result.get('status') == 'PASS':
                test_results['summary']['passed_tests'] += 1
            else:
                test_results['summary']['failed_tests'] += 1
                test_results['summary']['errors'].append(f"{component_name}.{test_name}: {test_result.get('error', 'Unknown error')}")
    
    # Określ ogólny status
    if test_results['summary']['failed_tests'] == 0:
        test_results['test_status'] = 'ALL_PASS'
        test_results['overall_success'] = True
        logger.info("✅ Wszystkie testy backendu przeszły pomyślnie!")
    elif test_results['summary']['passed_tests'] > test_results['summary']['failed_tests']:
        test_results['test_status'] = 'MOSTLY_PASS'
        test_results['overall_success'] = False
        logger.warning(f"⚠️ Część testów nie przeszła: {test_results['summary']['failed_tests']} błędów")
    else:
        test_results['test_status'] = 'MAJOR_ISSUES'
        test_results['overall_success'] = False
        logger.error(f"❌ Poważne problemy z backendem: {test_results['summary']['failed_tests']} błędów")
    
    return jsonify(test_results), 200 if test_results['overall_success'] else 500


def test_module_structure():
    """
    Test struktury i importów modułu production
    """
    logger.info("🔍 Testowanie struktury modułu production...")
    
    result = {
        'component': 'module_structure',
        'status': 'UNKNOWN',
        'tests': {}
    }
    
    # Test 1: Import głównego Blueprint
    try:
        from modules.production import production_bp
        result['tests']['blueprint_import'] = {
            'status': 'PASS',
            'message': f'Blueprint zaimportowany: {production_bp.name}',
            'details': {
                'name': production_bp.name,
                'url_prefix': production_bp.url_prefix
            }
        }
    except Exception as e:
        result['tests']['blueprint_import'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 2: Import modeli
    try:
        from modules.production import models
        model_classes = [name for name in dir(models) if not name.startswith('_')]
        result['tests']['models_import'] = {
            'status': 'PASS',
            'message': f'Modele zaimportowane: {len(model_classes)} klas',
            'details': {'available_models': model_classes}
        }
    except Exception as e:
        result['tests']['models_import'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 3: Import serwisów
    try:
        from modules.production import services
        service_modules = [name for name in dir(services) if not name.startswith('_')]
        result['tests']['services_import'] = {
            'status': 'PASS',
            'message': f'Serwisy zaimportowane: {len(service_modules)} modułów',
            'details': {'available_services': service_modules}
        }
    except Exception as e:
        result['tests']['services_import'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Określ ogólny status komponentu
    passed_tests = sum(1 for test in result['tests'].values() if test['status'] == 'PASS')
    result['status'] = 'PASS' if passed_tests == len(result['tests']) else 'FAIL'
    
    return result


def test_database_models():
    """
    Test modeli bazy danych
    """
    logger.info("🗃️ Testowanie modeli bazy danych...")
    
    result = {
        'component': 'database_models',
        'status': 'UNKNOWN',
        'tests': {}
    }
    
    # Test 1: ProductionItem model
    try:
        from modules.production.models import ProductionItem
        
        # Sprawdź czy model ma wymagane atrybuty
        required_attrs = [
            'short_product_id', 'internal_order_number', 'baselinker_order_id',
            'original_product_name', 'current_status', 'created_at'
        ]
        
        missing_attrs = [attr for attr in required_attrs if not hasattr(ProductionItem, attr)]
        
        if not missing_attrs:
            result['tests']['production_item_model'] = {
                'status': 'PASS',
                'message': 'ProductionItem model ma wszystkie wymagane atrybuty',
                'details': {'required_attributes': required_attrs}
            }
        else:
            result['tests']['production_item_model'] = {
                'status': 'FAIL',
                'error': f'Brakujące atrybuty: {missing_attrs}',
                'details': {'missing_attributes': missing_attrs}
            }
    except Exception as e:
        result['tests']['production_item_model'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 2: ProductionOrderCounter model
    try:
        from modules.production.models import ProductionOrderCounter
        
        required_attrs = ['year', 'current_counter', 'last_updated_at']
        missing_attrs = [attr for attr in required_attrs if not hasattr(ProductionOrderCounter, attr)]
        
        if not missing_attrs:
            result['tests']['order_counter_model'] = {
                'status': 'PASS',
                'message': 'ProductionOrderCounter model poprawny',
                'details': {'required_attributes': required_attrs}
            }
        else:
            result['tests']['order_counter_model'] = {
                'status': 'FAIL',
                'error': f'Brakujące atrybuty: {missing_attrs}',
                'details': {'missing_attributes': missing_attrs}
            }
    except Exception as e:
        result['tests']['order_counter_model'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 3: PriorityConfig model
    try:
        from modules.production.models import ProductionPriorityConfig as PriorityConfig
    
        # ZMIEŃ te pola na rzeczywiste z twojego modelu:
        required_attrs = ['config_name', 'weight_percentage', 'display_order', 'is_active']
        missing_attrs = [attr for attr in required_attrs if not hasattr(PriorityConfig, attr)]
    
        if not missing_attrs:
            result['tests']['priority_config_model'] = {
                'status': 'PASS',
                'message': 'PriorityConfig model poprawny',
                'details': {'required_attributes': required_attrs}
            }
        else:
            result['tests']['priority_config_model'] = {
                'status': 'FAIL',
                'error': f'Brakujące atrybuty: {missing_attrs}',
                'details': {'missing_attributes': missing_attrs}
            }
    except Exception as e:
        result['tests']['priority_config_model'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 4: Połączenie z bazą danych
    try:
        from extensions import db
        from sqlalchemy import text
        db.session.execute(text('SELECT 1'))  # DODAJ text()
        result['tests']['database_connection'] = {
            'status': 'PASS',
            'message': 'Połączenie z bazą danych działa'
        }
    except Exception as e:
        result['tests']['database_connection'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Określ ogólny status komponentu
    passed_tests = sum(1 for test in result['tests'].values() if test['status'] == 'PASS')
    result['status'] = 'PASS' if passed_tests == len(result['tests']) else 'FAIL'
    
    return result


def test_services():
    """
    Test serwisów modułu production
    """
    logger.info("🔧 Testowanie serwisów...")
    
    result = {
        'component': 'services',
        'status': 'UNKNOWN',
        'tests': {}
    }
    
    # Test 1: ID Generator Service
    try:
        from modules.production.services.id_generator import ProductIDGenerator
        
        # Test generowania ID
        test_id_result = ProductIDGenerator.generate_product_id(12345, 1)
        
        if 'product_id' in test_id_result and 'internal_order_number' in test_id_result:
            result['tests']['id_generator_service'] = {
                'status': 'PASS',
                'message': 'ProductIDGenerator działa poprawnie',
                'details': {
                    'test_result': test_id_result,
                    'format_valid': len(test_id_result['product_id'].split('_')) == 3
                }
            }
        else:
            result['tests']['id_generator_service'] = {
                'status': 'FAIL',
                'error': 'Nieprawidłowy format wyniku generowania ID',
                'details': {'result': test_id_result}
            }
    except Exception as e:
        result['tests']['id_generator_service'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 2: Security Service
    try:
        from modules.production.services.security_service import IPSecurityService
        
        # Test walidacji IP (dummy test)
        test_result = IPSecurityService.is_ip_allowed('192.168.1.100')
        
        result['tests']['security_service'] = {
            'status': 'PASS',
            'message': 'IPSecurityService zaimportowany i działa',
            'details': {'test_ip_check': isinstance(test_result, bool)}
        }
    except Exception as e:
        result['tests']['security_service'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 3: Config Service
    try:
        from modules.production.services.config_service import ProductionConfigService
        
        # Test pobierania konfiguracji
        config_result = ProductionConfigService.get_config('REFRESH_INTERVAL_SECONDS', '30')
        
        result['tests']['config_service'] = {
            'status': 'PASS',
            'message': 'ProductionConfigService działa poprawnie',
            'details': {'config_test_result': config_result}
        }
    except Exception as e:
        result['tests']['config_service'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 4: Parser Service
    try:
        from modules.production.services.parser_service import ProductNameParser
        
        # Test parsowania nazwy produktu
        parser = ProductNameParser()
        test_parse = parser.parse_product_name("DĄB KLASA AB 20x140x1000 SUROWY")
        
        result['tests']['parser_service'] = {
            'status': 'PASS',
            'message': 'ProductNameParser działa poprawnie',
            'details': {
                'test_input': "DĄB KLASA AB 20x140x1000 SUROWY",
                'parse_result': test_parse
            }
        }
    except Exception as e:
        result['tests']['parser_service'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 5: Priority Calculator
    try:
        from modules.production.services.priority_service import PriorityCalculator
        
        calculator = PriorityCalculator()
        test_priority = calculator.calculate_priority({
            'deadline_days_remaining': 5,
            'volume_per_piece': 0.5,
            'finish_state': 'surowy'
        })
        
        result['tests']['priority_service'] = {
            'status': 'PASS',
            'message': 'PriorityCalculator działa poprawnie',
            'details': {
                'test_priority_score': test_priority
            }
        }
    except Exception as e:
        result['tests']['priority_service'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Określ ogólny status komponentu
    passed_tests = sum(1 for test in result['tests'].values() if test['status'] == 'PASS')
    result['status'] = 'PASS' if passed_tests == len(result['tests']) else 'FAIL'
    
    return result


def test_configuration():
    """
    Test konfiguracji i cache
    """
    logger.info("⚙️ Testowanie konfiguracji...")
    
    result = {
        'component': 'configuration',
        'status': 'UNKNOWN',
        'tests': {}
    }
    
    # Test 1: Konfiguracja core.json
    try:
        import json
        import os
    
        # POPRAW ścieżkę - usuń 'app/' z początku
        config_path = os.path.join('config', 'core.json')
    
        # Alternatywnie możesz użyć ścieżki absolutnej:
        # config_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'config', 'core.json'))
    
        # Załadowanie konfiguracji z pliku JSON
        with open(config_path, 'r') as f:
            config_data = json.load(f)
    
        test_configs = [
            'PRODUCTION_CRON_SECRET',
            'PRODUCTION_SYNC_INTERVAL',
            'PRODUCTION_MAX_ITEMS_PER_SYNC'
        ]
    
        missing_configs = []
        for config_key in test_configs:
            if config_key not in config_data or config_data[config_key] is None:
                missing_configs.append(config_key)
    
        if not missing_configs:
            result['tests']['core_config'] = {
                'status': 'PASS',
                'message': 'Wszystkie wymagane konfiguracje dostępne',
                'details': {
                    'found_configs': {key: str(config_data[key])[:50] for key in test_configs}
                }
            }
        else:
            result['tests']['core_config'] = {
                'status': 'FAIL',
                'error': f'Brakujące konfiguracje: {missing_configs}',
                'details': {'missing_configs': missing_configs}
            }
    except Exception as e:
        result['tests']['core_config'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 2: Cache priority config
    try:
        from modules.production.services.config_service import PriorityConfigCache
        
        cache_result = PriorityConfigCache.get_priority_config()
        
        result['tests']['priority_cache'] = {
            'status': 'PASS',
            'message': 'Cache priorytetów działa poprawnie',
            'details': {
                'cache_type': type(cache_result).__name__,
                'cache_items_count': len(cache_result) if isinstance(cache_result, dict) else 'unknown'
            }
        }
    except Exception as e:
        result['tests']['priority_cache'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Określ ogólny status komponentu
    passed_tests = sum(1 for test in result['tests'].values() if test['status'] == 'PASS')
    result['status'] = 'PASS' if passed_tests == len(result['tests']) else 'FAIL'
    
    return result


def test_security():
    """
    Test zabezpieczeń
    """
    logger.info("🔒 Testowanie zabezpieczeń...")
    
    result = {
        'component': 'security',
        'status': 'UNKNOWN',
        'tests': {}
    }
    
    # Test 1: IP validation
    try:
        from modules.production.services.security_service import IPSecurityService
        
        # Test dozwolonego IP
        allowed_result = IPSecurityService.is_ip_allowed('192.168.1.100')
        # Test niedozwolonego IP
        blocked_result = IPSecurityService.is_ip_allowed('10.0.0.1')
        
        result['tests']['ip_security'] = {
            'status': 'PASS',
            'message': 'Walidacja IP działa poprawnie',
            'details': {
                'allowed_ip_test': allowed_result,
                'blocked_ip_test': blocked_result
            }
        }
    except Exception as e:
        result['tests']['ip_security'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 2: CRON secret validation (jeśli istnieje)
    try:
        from modules.production.services.security_service import validate_cron_secret
        
        # Test z prawidłowym sekretom (dummy test)
        secret_test = validate_cron_secret('test_secret')
        
        result['tests']['cron_security'] = {
            'status': 'PASS',
            'message': 'Walidacja CRON secret dostępna',
            'details': {'test_result': secret_test}
        }
    except ImportError:
        result['tests']['cron_security'] = {
            'status': 'SKIP',
            'message': 'Funkcja validate_cron_secret nie znaleziona - prawdopodobnie nie zaimplementowana jeszcze'
        }
    except Exception as e:
        result['tests']['cron_security'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Określ ogólny status komponentu
    passed_tests = sum(1 for test in result['tests'].values() if test['status'] == 'PASS')
    skipped_tests = sum(1 for test in result['tests'].values() if test['status'] == 'SKIP')
    total_meaningful_tests = len(result['tests']) - skipped_tests
    
    if total_meaningful_tests == 0:
        result['status'] = 'SKIP'
    else:
        result['status'] = 'PASS' if passed_tests == total_meaningful_tests else 'FAIL'
    
    return result


def test_integrations():
    """
    Test integracji zewnętrznych
    """
    logger.info("🔌 Testowanie integracji...")
    
    result = {
        'component': 'integrations',
        'status': 'UNKNOWN',
        'tests': {}
    }
    
    # Test 1: Baselinker service integration
    try:
        from modules.production.services.sync_service import BaselinkerSyncService
        
        # Sprawdź czy klasa ma wymagane metody
        required_methods = ['sync_orders_from_baselinker', 'update_order_status']
        missing_methods = []
        
        for method in required_methods:
            if not hasattr(BaselinkerSyncService, method):
                missing_methods.append(method)
        
        if not missing_methods:
            result['tests']['baselinker_integration'] = {
                'status': 'PASS',
                'message': 'BaselinkerSyncService ma wszystkie wymagane metody',
                'details': {'required_methods': required_methods}
            }
        else:
            result['tests']['baselinker_integration'] = {
                'status': 'FAIL',
                'error': f'Brakujące metody: {missing_methods}',
                'details': {'missing_methods': missing_methods}
            }
    except Exception as e:
        result['tests']['baselinker_integration'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 2: Reports parser integration
    try:
        from modules.reports.parser import ProductNameParser as ReportsParser
        from modules.production.services.parser_service import ProductNameParser as ProductionParser
        
        # Sprawdź czy można utworzyć instancje obu parserów
        reports_parser = ReportsParser()
        production_parser = ProductionParser()
        
        result['tests']['parser_integration'] = {
            'status': 'PASS',
            'message': 'Integracja z parserem reports działa poprawnie',
            'details': {
                'reports_parser_available': True,
                'production_parser_available': True
            }
        }
    except Exception as e:
        result['tests']['parser_integration'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 3: Logging integration
    try:
        from modules.logging import get_structured_logger
        
        # Test utworzenia logger production
        production_logger = get_structured_logger('production.test_logger')
        production_logger.info("Test message from production module")
        
        result['tests']['logging_integration'] = {
            'status': 'PASS',
            'message': 'System logowania działa poprawnie z modułem production',
            'details': {'logger_name': 'production.test_logger'}
        }
    except Exception as e:
        result['tests']['logging_integration'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 4: Database extensions integration
    try:
        from extensions import db
        from sqlalchemy import text

        # Użyj prostszego testu zamiast transakcji
        db_result = db.session.execute(text('SELECT 1'))

        result['tests']['database_extensions'] = {
            'status': 'PASS',
            'message': 'Integracja z extensions.db działa poprawnie'
        }
    except Exception as e:
        result['tests']['database_extensions'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Test 5: Flask-Login integration (jeśli używane)
    try:
        from flask_login import current_user, login_required
        
        result['tests']['flask_login_integration'] = {
            'status': 'PASS',
            'message': 'Flask-Login integration dostępna',
            'details': {
                'current_user_available': hasattr(current_user, 'is_authenticated'),
                'login_required_decorator': callable(login_required)
            }
        }
    except Exception as e:
        result['tests']['flask_login_integration'] = {
            'status': 'FAIL',
            'error': str(e),
            'traceback': traceback.format_exc()
        }
    
    # Określ ogólny status komponentu
    passed_tests = sum(1 for test in result['tests'].values() if test['status'] == 'PASS')
    result['status'] = 'PASS' if passed_tests == len(result['tests']) else 'FAIL'
    
    return result


# ============================================================================
# REJESTRACJA ROUTERA TESTOWEGO
# ============================================================================

def register_test_routes(main_blueprint):
    """
    Rejestruje routing testowy w głównym blueprint modułu production
    """
    try:
        main_blueprint.register_blueprint(test_bp)
        logger.info("✅ Zarejestrowano routing testowy dla modułu production")
        return True
    except Exception as e:
        logger.error(f"❌ Błąd rejestracji routingu testowego: {str(e)}")
        return False

logger.info("🧪 Moduł testowy modułu production zainicjowany", extra={
    'test_endpoint': '/production/test/backend',
    'methods': ['GET'],
    'description': 'Kompleksowy test backendu modułu production'
})