from flask import render_template, request, jsonify, current_app, session
from . import register_bp
from .models import RegisterCompany, RegisterPkdCode, RegisterApiLog, RegisterIntegrationConfig
from .services import RegisterService
from extensions import db
import json
import logging
from datetime import datetime, timedelta
import time
import traceback
from functools import wraps

# Konfiguracja loggera
register_logger = logging.getLogger('company_register_module')
register_logger.info("✅ company_register_logger zainicjowany poprawnie w routers.py")


def api_response(success, data=None, message=None, error=None, status_code=200):
    """
    Tworzy ustandaryzowaną odpowiedź API
    """
    response = {'success': success}
    
    if data is not None:
        response['data'] = data
    if message is not None:
        response['message'] = message
    if error is not None:
        response['error'] = error
        
    return jsonify(response), status_code


def handle_exceptions(f):
    """Dekorator do obsługi wyjątków"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            error_details = traceback.format_exc()
            register_logger.error(f"Błąd w module rejestrów: {str(e)}\n{error_details}")
            
            return api_response(
                success=False,
                error=f"Wystąpił błąd: {str(e)}",
                status_code=500
            )
    return decorated_function


# Endpoint renderujący główny widok modułu
@register_bp.route('/')
def index():
    """Renderuje główny widok modułu rejestrów"""
    return render_template('register/index.html')


# Endpoint do pobierania listy zapisanych firm
@register_bp.route('/api/companies')
@handle_exceptions
def api_companies():
    """
    API do pobierania listy zapisanych firm z możliwością filtrowania
    """
    # Parametry filtrowania
    register_type = request.args.get('register_type')
    nip = request.args.get('nip')
    regon = request.args.get('regon')
    company_name = request.args.get('company_name')
    pkd_code = request.args.get('pkd_code')
    foundation_date_from = request.args.get('foundation_date_from')
    foundation_date_to = request.args.get('foundation_date_to')
    status = request.args.get('status')
    
    # Parametry paginacji
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)
    sort_by = request.args.get('sort_by', 'company_name')
    sort_dir = request.args.get('sort_dir', 'asc')
    
    # Przygotowanie filtrów
    filters = {}
    
    if register_type:
        filters['register_type'] = register_type
    if nip:
        filters['nip'] = nip
    if regon:
        filters['regon'] = regon
    if company_name:
        filters['company_name'] = company_name
    if pkd_code:
        filters['pkd_code'] = pkd_code
    if status:
        filters['status'] = status
    
    if foundation_date_from:
        try:
            filters['foundation_date_from'] = datetime.strptime(foundation_date_from, '%Y-%m-%d').date()
        except ValueError:
            return api_response(False, error="Nieprawidłowy format daty początkowej", status_code=400)
    
    if foundation_date_to:
        try:
            filters['foundation_date_to'] = datetime.strptime(foundation_date_to, '%Y-%m-%d').date()
        except ValueError:
            return api_response(False, error="Nieprawidłowy format daty końcowej", status_code=400)
    
    # Dodanie parametrów sortowania
    filters['sort_by'] = sort_by
    filters['sort_dir'] = sort_dir
    
    # Wyszukiwanie firm
    companies = RegisterCompany.search(filters, limit, offset)
    
    # Liczba wszystkich rekordów (dla paginacji)
    query = RegisterCompany.query
    
    for key, value in filters.items():
        if key not in ['sort_by', 'sort_dir', 'limit', 'offset'] and hasattr(RegisterCompany, key):
            column = getattr(RegisterCompany, key)
            
            if key.endswith('_from'):
                base_key = key[:-5]
                if hasattr(RegisterCompany, base_key):
                    base_column = getattr(RegisterCompany, base_key)
                    query = query.filter(base_column >= value)
            elif key.endswith('_to'):
                base_key = key[:-3]
                if hasattr(RegisterCompany, base_key):
                    base_column = getattr(RegisterCompany, base_key)
                    query = query.filter(base_column <= value)
            elif isinstance(value, str) and '%' in value:
                query = query.filter(column.like(value))
            else:
                query = query.filter(column == value)
    
    total_count = query.count()
    
    return api_response(
        success=True,
        data={
            'companies': [company.to_dict() for company in companies],
            'total_count': total_count,
            'page': offset // limit + 1 if limit > 0 else 1,
            'total_pages': (total_count + limit - 1) // limit if limit > 0 else 1
        }
    )


# Endpoint do wyszukiwania firm w rejestrach
@register_bp.route('/api/search', methods=['POST'])
@handle_exceptions
def api_search():
    """
    API do wyszukiwania firm w rejestrach CEIDG i KRS
    """
    data = request.json
    
    if not data:
        return api_response(False, error="Brak danych wyszukiwania", status_code=400)
    
    # Walidacja podstawowa
    search_params = {}
    
    for param in ['nip', 'regon', 'krs', 'company_name', 'pkd_code', 'foundation_date_from', 'foundation_date_to', 'status']:
        if param in data and data[param]:
            search_params[param] = data[param]
    
    if not search_params:
        return api_response(False, error="Podaj co najmniej jeden parametr wyszukiwania (np. NIP, REGON, KRS)", status_code=400)
    
    # Dodanie parametrów paginacji i testowania
    search_params['page'] = data.get('page', 1)
    raw_limit = data.get('limit', 25)
    try:
        limit = int(raw_limit)
    except (ValueError, TypeError):
        return api_response(False, error="Parametr limit musi być liczbą całkowitą", status_code=400)
    if limit <= 0:
        return api_response(False, error="Parametr limit musi być dodatni", status_code=400)
    search_params['limit'] = min(limit, 50)
    search_params['use_test'] = data.get('use_test', False)  # Dla testów CEIDG
    
    # Wykorzystanie nowego serwisu
    register_service = RegisterService()
    result = register_service.search_in_registers(search_params, data.get('register_type'))
    
    if result['success']:
        message = None
        if 'partial_errors' in result and result['partial_errors']:
            if len(result['sources']) == 1:
                message = f"Wyniki tylko z {', '.join(result['sources'])}. Błędy: {', '.join(result['partial_errors'])}"
            else:
                message = f"Wystąpiły błędy: {', '.join(result['partial_errors'])}"
        
        return api_response(
            success=True,
            data=result['data'],
            message=message
        )
    else:
        return api_response(
            success=False,
            error=result['error'],
            status_code=500
        )


# Endpoint do pobierania szczegółów firmy z rejestru
@register_bp.route('/api/company-details', methods=['GET'])
@handle_exceptions
def api_company_details():
    """
    API do pobierania szczegółów firmy z rejestru
    """
    register_type = request.args.get('register_type')
    nip = request.args.get('nip')
    regon = request.args.get('regon')
    company_id = request.args.get('company_id')
    krs = request.args.get('krs')

    if not register_type:
        return api_response(False, error="Brak parametru register_type", status_code=400)

    if not (nip or regon or company_id or krs):
        return api_response(False, error="Podaj NIP, REGON, KRS lub ID firmy", status_code=400)

    # Określenie typu identyfikatora
    identifier_type = None
    identifier_value = None

    if nip:
        identifier_type = 'nip'
        identifier_value = nip
    elif regon:
        identifier_type = 'regon'
        identifier_value = regon
    elif company_id:
        identifier_type = 'company_id'
        identifier_value = company_id
    elif krs:
        identifier_type = 'krs'
        identifier_value = krs
    
    # Wykorzystanie nowego serwisu
    register_service = RegisterService()
    result = register_service.get_company_details(register_type, identifier_type, identifier_value)
    
    if result['success']:
        return api_response(True, data=result['company'])
    else:
        status_code = 404 if "nie znaleziono" in result['error'].lower() else 500
        return api_response(False, error=result['error'], status_code=status_code)


# Endpoint do zapisywania firm do bazy
@register_bp.route('/api/save-companies', methods=['POST'])
@handle_exceptions
def api_save_companies():
    """
    API do zapisywania firm do bazy danych z wykorzystaniem nowego serwisu
    """
    data = request.json
    
    if not data or 'companies' not in data:
        return api_response(False, error="Brak danych do zapisania", status_code=400)
    
    companies = data['companies']
    if not companies:
        return api_response(False, error="Lista firm jest pusta", status_code=400)
    
    # Wykorzystanie metod z serwisu bazowego
    stats = {
        'saved': 0,
        'updated': 0,
        'failed': 0,
        'already_exists': 0
    }
    failed_details = []
    
    update_existing = data.get('update_existing', False)
    
    for company_data in companies:
        try:
            # Walidacja typu rejestru
            register_type = company_data.get('register_type')
            if not register_type or register_type not in ['CEIDG', 'KRS']:
                stats['failed'] += 1
                failed_details.append({'input': company_data, 'error': 'Nieprawidłowy typ rejestru'})
                continue
            
            # Zapisywanie bezpośrednio poprzez model
            company_model = RegisterCompany()
            success, company, message = company_model.save_company(company_data, update_existing)

            if success:
                if 'zaktualizowano' in message.lower():
                    stats['updated'] += 1
                else:
                    stats['saved'] += 1
            else:
                if company and 'już istnieje' in message.lower():
                    stats['already_exists'] += 1
                else:
                    stats['failed'] += 1
                    failed_details.append({'input': company_data, 'error': message})
                    
        except Exception as e:
            stats['failed'] += 1
            register_logger.error(f"Błąd zapisywania firmy: {str(e)}")
    
    response_data = {**stats}
    if failed_details:
        response_data['failed_details'] = failed_details

    if stats['failed'] == len(companies):
        return api_response(
            success=False,
            data=response_data,
            error="Wszystkie firmy mają nieprawidłowy typ rejestru",
            status_code=400
        )

    if stats['failed'] > 0:
        return api_response(
            success=False,
            data=response_data,
            error=f"Nie zapisano {stats['failed']} firm"
        )

    return api_response(
        success=True,
        data=response_data,
        message=f"Zapisano {stats['saved']} firm, zaktualizowano {stats['updated']}, pominięto {stats['already_exists']}"
    )


# Endpoint do pobierania kodów PKD
@register_bp.route('/api/pkd-codes')
@handle_exceptions
def api_pkd_codes():
    """API do pobierania kodów PKD"""
    search_term = request.args.get('search')
    section = request.args.get('section')
    only_common = request.args.get('common', 'false').lower() == 'true'
    
    pkd_codes = RegisterPkdCode.search(search_term, section, only_common)
    
    return api_response(
        success=True,
        data=[code.to_dict() for code in pkd_codes]
    )


# Endpoint do zarządzania konfiguracją integracji
@register_bp.route('/api/integration-config', methods=['GET', 'POST'])
@handle_exceptions
def api_integration_config():
    """API do zarządzania konfiguracją integracji"""
    if request.method == 'GET':
        # Dostęp dla zalogowanych użytkowników
        if not session.get('user_id'):
            return api_response(False, error="Brak uprawnień", status_code=403)

        ceidg_config = RegisterIntegrationConfig.get_config('CEIDG')
        krs_config = RegisterIntegrationConfig.get_config('KRS')
        
        configs = []
        
        if ceidg_config:
            configs.append({
                'id': ceidg_config.id,
                'register_type': ceidg_config.register_type,
                'api_url': ceidg_config.api_url,
                'active': ceidg_config.active,
                'rate_limit': ceidg_config.rate_limit,
                'rate_limit_period': ceidg_config.rate_limit_period,
                'last_sync': ceidg_config.last_sync.strftime('%Y-%m-%d %H:%M:%S') if ceidg_config.last_sync else None
            })
        
        if krs_config:
            configs.append({
                'id': krs_config.id,
                'register_type': krs_config.register_type,
                'api_url': krs_config.api_url,
                'active': krs_config.active,
                'rate_limit': krs_config.rate_limit,
                'rate_limit_period': krs_config.rate_limit_period,
                'last_sync': krs_config.last_sync.strftime('%Y-%m-%d %H:%M:%S') if krs_config.last_sync else None
            })
        
        return api_response(True, data=configs)

    elif request.method == 'POST':
        # Modyfikacja konfiguracji tylko dla administratorów
        if session.get('role') != 'admin':
            return api_response(False, error="Brak uprawnień", status_code=403)
        data = request.json
        
        if not data or 'register_type' not in data:
            return api_response(False, error="Brak danych konfiguracji", status_code=400)
        
        config = RegisterIntegrationConfig.get_config(data['register_type'])
        
        if not config:
            config = RegisterIntegrationConfig(
                register_type=data['register_type'],
                api_key=data.get('api_key'),
                api_url=data.get('api_url'),
                rate_limit=data.get('rate_limit', 100),
                rate_limit_period=data.get('rate_limit_period', 'day'),
                active=data.get('active', True)
            )
            db.session.add(config)
        else:
            if 'api_key' in data and data['api_key']:
                config.api_key = data['api_key']
            if 'api_url' in data:
                config.api_url = data['api_url']
            if 'rate_limit' in data:
                config.rate_limit = data['rate_limit']
            if 'rate_limit_period' in data:
                config.rate_limit_period = data['rate_limit_period']
            if 'active' in data:
                config.active = data['active']
        
        db.session.commit()
        
        return api_response(
            success=True,
            message=f"Konfiguracja {data['register_type']} została zaktualizowana"
        )


# Endpoint do testowania połączeń z API
@register_bp.route('/api/test-connections', methods=['POST'])
@handle_exceptions
def api_test_connections():
    """
    API do testowania połączeń z rejestrami
    """
    register_service = RegisterService()
    result = register_service.test_connections()
    
    if result['success']:
        return api_response(
            success=True,
            data=result['results'],
            message="Testy połączeń zakończone"
        )
    else:
        return api_response(
            success=False,
            data=result['results'],
            error="Wszystkie testy połączeń nie powiodły się"
        )


# Endpoint do tworzenia klienta z firmy
@register_bp.route('/api/create-client', methods=['POST'])
@handle_exceptions
def api_create_client():
    """API do tworzenia klienta w systemie na podstawie danych firmy z rejestru"""
    from modules.clients.models import Client
    
    data = request.json
    
    if not data or 'company_id' not in data:
        return api_response(False, error="Brak ID firmy", status_code=400)
    
    company = RegisterCompany.query.get(data['company_id'])
    if not company:
        return api_response(False, error="Firma nie istnieje", status_code=404)
    
    # Sprawdzenie czy klient już istnieje
    existing_client = Client.query.filter_by(invoice_nip=company.nip).first()
    if existing_client:
        return api_response(
            success=False,
            error=f"Klient z NIP {company.nip} już istnieje (ID: {existing_client.id})",
            status_code=409
        )
    
    try:
        # Generowanie numeru klienta
        import random
        import string
        
        client_number = ''.join(random.choices(string.digits, k=6))
        
        # Tworzenie nowego klienta
        new_client = Client(
            client_number=client_number,
            client_name=company.company_name,
            client_delivery_name=company.company_name,
            email="",
            phone="",
            
            # Adres dostawy
            delivery_company=company.company_name,
            delivery_address=company.address,
            delivery_zip=company.postal_code,
            delivery_city=company.city,
            delivery_region="",
            delivery_country="Polska",
            
            # Adres faktury
            invoice_company=company.company_name,
            invoice_address=company.address,
            invoice_zip=company.postal_code,
            invoice_city=company.city,
            invoice_region="",
            invoice_nip=company.nip,
            
            # Źródło klienta
            source=f"Register:{company.register_type}"
        )
        
        db.session.add(new_client)
        db.session.commit()
        
        return api_response(
            success=True,
            data={
                'client_id': new_client.id,
                'client_number': new_client.client_number
            },
            message=f"Utworzono klienta: {new_client.client_name}"
        )
    except Exception as e:
        db.session.rollback()
        register_logger.error(f"Błąd tworzenia klienta: {str(e)}\n{traceback.format_exc()}")
        return api_response(False, error=f"Błąd podczas tworzenia klienta: {str(e)}", status_code=500)


# Endpoint do usuwania firmy z bazy
@register_bp.route('/api/delete-company/<int:company_id>', methods=['DELETE'])
@handle_exceptions
def api_delete_company(company_id):
    """API do usuwania firmy z bazy danych"""
    if session.get('role') != 'admin':
        return api_response(False, error="Brak uprawnień", status_code=403)
    
    company = RegisterCompany.query.get(company_id)
    if not company:
        return api_response(False, error="Firma nie istnieje", status_code=404)
    
    company_name = company.company_name
    db.session.delete(company)
    db.session.commit()
    
    return api_response(
        success=True,
        message=f"Firma {company_name} została usunięta"
    )


# Endpoint do czyszczenia logów API
@register_bp.route('/api/clear-api-logs', methods=['POST'])
@handle_exceptions
def api_clear_api_logs():
    """API do czyszczenia logów zapytań API"""
    if session.get('role') != 'admin':
        return api_response(False, error="Brak uprawnień", status_code=403)
    
    data = request.json or {}
    days = data.get('days', 30)
    
    if days <= 0:
        return api_response(False, error="Parametr days musi być większy od 0", status_code=400)
    
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
    try:
        result = db.session.query(RegisterApiLog).filter(RegisterApiLog.created_at < cutoff_date).delete()
        db.session.commit()
        
        return api_response(
            success=True,
            message=f"Usunięto {result} logów starszych niż {days} dni"
        )
    except Exception as e:
        db.session.rollback()
        return api_response(False, error=f"Błąd podczas czyszczenia logów: {str(e)}", status_code=500)


# Endpoint do inicjalizacji słownika kodów PKD
@register_bp.route('/api/initialize-pkd-codes', methods=['POST'])
@handle_exceptions
def api_initialize_pkd_codes():
    """API do inicjalizacji słownika kodów PKD"""
    if session.get('role') != 'admin':
        return api_response(False, error="Brak uprawnień", status_code=403)
    
    # Lista podstawowych kodów PKD (skrócona dla przykładu)
    common_pkd_codes = [
        # Branża drzewna i meblarska
        {'code': '02.20.Z', 'name': 'Pozyskiwanie drewna', 'category': 'Leśnictwo', 'section': 'A', 'is_common': True},
        {'code': '16.10.Z', 'name': 'Produkcja wyrobów tartacznych', 'category': 'Drzewna', 'section': 'C', 'is_common': True},
        {'code': '16.21.Z', 'name': 'Produkcja arkuszy fornirowych i płyt wykonanych na bazie drewna', 'category': 'Drzewna', 'section': 'C', 'is_common': True},
        {'code': '16.22.Z', 'name': 'Produkcja gotowych parkietów podłogowych', 'category': 'Drzewna', 'section': 'C', 'is_common': True},
        {'code': '16.23.Z', 'name': 'Produkcja pozostałych wyrobów stolarskich i ciesielskich dla budownictwa', 'category': 'Drzewna', 'section': 'C', 'is_common': True},
        {'code': '16.24.Z', 'name': 'Produkcja opakowań drewnianych', 'category': 'Drzewna', 'section': 'C', 'is_common': True},
        {'code': '16.29.Z', 'name': 'Produkcja pozostałych wyrobów z drewna; produkcja wyrobów z korka, słomy i materiałów używanych do wyplatania', 'category': 'Drzewna', 'section': 'C', 'is_common': True},
        {'code': '31.01.Z', 'name': 'Produkcja mebli biurowych i sklepowych', 'category': 'Meblarska', 'section': 'C', 'is_common': True},
        {'code': '31.02.Z', 'name': 'Produkcja mebli kuchennych', 'category': 'Meblarska', 'section': 'C', 'is_common': True},
        {'code': '31.03.Z', 'name': 'Produkcja materaców', 'category': 'Meblarska', 'section': 'C', 'is_common': True},
        {'code': '31.09.Z', 'name': 'Produkcja pozostałych mebli', 'category': 'Meblarska', 'section': 'C', 'is_common': True},
        {'code': '46.13.Z', 'name': 'Działalność agentów zajmujących się sprzedażą drewna i materiałów budowlanych', 'category': 'Handel', 'section': 'G', 'is_common': True},
        {'code': '46.73.Z', 'name': 'Sprzedaż hurtowa drewna, materiałów budowlanych i wyposażenia sanitarnego', 'category': 'Handel', 'section': 'G', 'is_common': True},
        {'code': '47.59.Z', 'name': 'Sprzedaż detaliczna mebli, sprzętu oświetleniowego i pozostałych artykułów użytku domowego', 'category': 'Handel', 'section': 'G', 'is_common': True},
 
        # Budownictwo i architektura
        {'code': '41.10.Z', 'name': 'Realizacja projektów budowlanych związanych ze wznoszeniem budynków', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '41.20.Z', 'name': 'Roboty budowlane związane ze wznoszeniem budynków mieszkalnych i niemieszkalnych', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '42.11.Z', 'name': 'Roboty związane z budową dróg i autostrad', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '42.21.Z', 'name': 'Roboty związane z budową rurociągów przesyłowych i sieci rozdzielczych', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '42.22.Z', 'name': 'Roboty związane z budową linii telekomunikacyjnych i elektroenergetycznych', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '42.91.Z', 'name': 'Roboty związane z budową obiektów inżynierii wodnej', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '42.99.Z', 'name': 'Roboty związane z budową pozostałych obiektów inżynierii lądowej i wodnej', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '43.11.Z', 'name': 'Rozbiórka i burzenie obiektów budowlanych', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '43.12.Z', 'name': 'Przygotowanie terenu pod budowę', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '43.13.Z', 'name': 'Wykonywanie wykopów i wierceń geologiczno-inżynierskich', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
 
        # Wykończenia i remonty
        {'code': '43.21.Z', 'name': 'Wykonywanie instalacji elektrycznych', 'category': 'Wykończenia', 'section': 'F', 'is_common': True},
        {'code': '43.22.Z', 'name': 'Wykonywanie instalacji wodno-kanalizacyjnych, cieplnych, gazowych i klimatyzacyjnych', 'category': 'Wykończenia', 'section': 'F', 'is_common': True},
        {'code': '43.29.Z', 'name': 'Wykonywanie pozostałych instalacji budowlanych', 'category': 'Wykończenia', 'section': 'F', 'is_common': True},
        {'code': '43.31.Z', 'name': 'Tynkowanie', 'category': 'Wykończenia', 'section': 'F', 'is_common': True},
        {'code': '43.32.Z', 'name': 'Zakładanie stolarki budowlanej', 'category': 'Wykończenia', 'section': 'F', 'is_common': True},
        {'code': '43.33.Z', 'name': 'Posadzkarstwo; tapetowanie i oblicowywanie ścian', 'category': 'Wykończenia', 'section': 'F', 'is_common': True},
        {'code': '43.34.Z', 'name': 'Malowanie i szklenie', 'category': 'Wykończenia', 'section': 'F', 'is_common': True},
        {'code': '43.39.Z', 'name': 'Wykonywanie pozostałych robót budowlanych wykończeniowych', 'category': 'Wykończenia', 'section': 'F', 'is_common': True},
        {'code': '43.91.Z', 'name': 'Wykonywanie konstrukcji i pokryć dachowych', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
        {'code': '43.99.Z', 'name': 'Pozostałe specjalistyczne roboty budowlane, gdzie indziej niesklasyfikowane', 'category': 'Budownictwo', 'section': 'F', 'is_common': True},
 
        # Architektura i projektowanie
        {'code': '71.11.Z', 'name': 'Działalność w zakresie architektury', 'category': 'Architektura', 'section': 'M', 'is_common': True},
        {'code': '71.12.Z', 'name': 'Działalność w zakresie inżynierii i związane z nią doradztwo techniczne', 'category': 'Architektura', 'section': 'M', 'is_common': True},
        {'code': '74.10.Z', 'name': 'Działalność w zakresie specjalistycznego projektowania', 'category': 'Projektowanie', 'section': 'M', 'is_common': True},
 
        # Nieruchomości
        {'code': '68.10.Z', 'name': 'Kupno i sprzedaż nieruchomości na własny rachunek', 'category': 'Nieruchomości', 'section': 'L', 'is_common': True},
        {'code': '68.20.Z', 'name': 'Wynajem i zarządzanie nieruchomościami własnymi lub dzierżawionymi', 'category': 'Nieruchomości', 'section': 'L', 'is_common': True},
        {'code': '68.31.Z', 'name': 'Pośrednictwo w obrocie nieruchomościami', 'category': 'Nieruchomości', 'section': 'L', 'is_common': True},
        {'code': '68.32.Z', 'name': 'Zarządzanie nieruchomościami wykonywane na zlecenie', 'category': 'Nieruchomości', 'section': 'L', 'is_common': True},
 
        # Pozostałe powiązane
        {'code': '81.21.Z', 'name': 'Niespecjalistyczne sprzątanie budynków i obiektów przemysłowych', 'category': 'Usługi', 'section': 'N', 'is_common': True},
        {'code': '81.22.Z', 'name': 'Specjalistyczne sprzątanie budynków i obiektów przemysłowych', 'category': 'Usługi', 'section': 'N', 'is_common': True},
        {'code': '81.30.Z', 'name': 'Działalność usługowa związana z zagospodarowaniem terenów zieleni', 'category': 'Usługi', 'section': 'N', 'is_common': True},
 
        # IT i technologia (zachowane z poprzedniej listy)
        {'code': '62.01.Z', 'name': 'Działalność związana z oprogramowaniem', 'category': 'IT', 'section': 'J', 'is_common': True},
        {'code': '62.02.Z', 'name': 'Działalność związana z doradztwem w zakresie informatyki', 'category': 'IT', 'section': 'J', 'is_common': True},
        {'code': '62.03.Z', 'name': 'Działalność związana z zarządzaniem urządzeniami informatycznymi', 'category': 'IT', 'section': 'J', 'is_common': True},
 
        # Handel (zachowane z poprzedniej listy)
        {'code': '46.90.Z', 'name': 'Sprzedaż hurtowa niewyspecjalizowana', 'category': 'Handel', 'section': 'G', 'is_common': True},
        {'code': '47.91.Z', 'name': 'Sprzedaż detaliczna prowadzona przez Internet', 'category': 'Handel', 'section': 'G', 'is_common': True},
 
        # Transport (zachowane z poprzedniej listy)
        {'code': '49.41.Z', 'name': 'Transport drogowy towarów', 'category': 'Transport', 'section': 'H', 'is_common': True},
 
        # Usługi finansowe (zachowane z poprzedniej listy)
        {'code': '69.20.Z', 'name': 'Działalność rachunkowo-księgowa; doradztwo podatkowe', 'category': 'Finanse', 'section': 'M', 'is_common': True},
    ]
    
    count_added = 0
    count_updated = 0
    
    try:
        for pkd_data in common_pkd_codes:
            existing_code = RegisterPkdCode.query.filter_by(pkd_code=pkd_data['code']).first()
            
            if existing_code:
                existing_code.pkd_name = pkd_data['name']
                existing_code.pkd_category = pkd_data['category']
                existing_code.pkd_section = pkd_data['section']
                existing_code.is_common = pkd_data['is_common']
                count_updated += 1
            else:
                new_code = RegisterPkdCode(
                    pkd_code=pkd_data['code'],
                    pkd_name=pkd_data['name'],
                    pkd_category=pkd_data['category'],
                    pkd_section=pkd_data['section'],
                    is_common=pkd_data['is_common']
                )
                db.session.add(new_code)
                count_added += 1
        
        db.session.commit()
        
        return api_response(
            success=True,
            message=f"Zainicjalizowano słownik kodów PKD: dodano {count_added}, zaktualizowano {count_updated}"
        )
    except Exception as e:
        db.session.rollback()
        return api_response(False, error=f"Błąd inicjalizacji kodów PKD: {str(e)}", status_code=500)