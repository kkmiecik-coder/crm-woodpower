import requests
import json
import logging
import time
from datetime import datetime, timedelta
import traceback
from flask import current_app, session, request
from extensions import db
from .models import RegisterCompany, RegisterPkdCode, RegisterApiLog, RegisterIntegrationConfig

# Konfiguracja loggera
register_logger = logging.getLogger('company_register_module')
register_logger.info("✅ company_register_logger zainicjowany poprawnie w service.py")


class RegisterIntegrationService:
    """
    Bazowa klasa serwisowa do obsługi integracji z rejestrami
    """
    def __init__(self, register_type=None):
        self.register_type = register_type
        self.config = self._load_config() if register_type else None
        self.logger = register_logger
    
    def _load_config(self):
        """Ładuje konfigurację z bazy danych"""
        config = RegisterIntegrationConfig.get_config(self.register_type)
        
        if not config:
            self.logger.warning(f"Brak konfiguracji dla rejestru {self.register_type}")
            return None
            
        if not config.active:
            self.logger.warning(f"Integracja z rejestrem {self.register_type} jest nieaktywna")
            return None
            
        return config
    
    def _log_api_call(self, operation, status, request_params=None, response_code=None, 
                    response_time_ms=None, error_details=None):
        """Loguje wywołanie API do bazy danych"""
        try:
            RegisterApiLog.log_api_call(
                register_type=self.register_type,
                operation=operation,
                status=status,
                request_params=request_params,
                response_code=response_code,
                response_time_ms=response_time_ms,
                error_details=error_details,
                user_id=session.get('user_id') if session else None,
                ip_address=request.remote_addr if request else None
            )
        except Exception as e:
            # Fallback do logowania bezpośrednio przez logger
            self.logger.error(f"Błąd logowania API: {str(e)}")
    
    def _check_rate_limit(self):
        """Sprawdza czy nie przekroczono limitu zapytań"""
        if not self.config:
            return False
        
        # Sprawdzenie limitów zapytań (50 na 3 minuty i 1000 na 60 minut)
        # Pobieramy liczbę zapytań w ostatnich 3 minutach
        three_min_ago = datetime.utcnow() - timedelta(minutes=3)
        three_min_count = RegisterApiLog.query.filter(
            RegisterApiLog.register_type == self.register_type,
            RegisterApiLog.created_at >= three_min_ago
        ).count()
    
        # Pobieramy liczbę zapytań w ostatnich 60 minutach
        hour_ago = datetime.utcnow() - timedelta(minutes=60)
        hour_count = RegisterApiLog.query.filter(
            RegisterApiLog.register_type == self.register_type,
            RegisterApiLog.created_at >= hour_ago
        ).count()
    
        # Sprawdzamy oba limity
        if three_min_count >= 50:
            self.logger.warning(f"Przekroczono limit 50 zapytań na 3 minuty ({three_min_count})")
            return False
        
        if hour_count >= 1000:
            self.logger.warning(f"Przekroczono limit 1000 zapytań na godzinę ({hour_count})")
            return False
    
        return True
    
    def _make_api_request(self, endpoint, params, timeout=30):
        """
        Bazowa metoda do wykonywania zapytań API
        
        Args:
            endpoint (str): Endpoint API
            params (dict): Parametry zapytania
            timeout (int): Limit czasu w sekundach
            
        Returns:
            dict: Odpowiedź API lub słownik z błędem
        """
        # Sprawdzenie czy konfiguracja jest dostępna
        if not self.config:
            error_msg = f"Brak konfiguracji dla rejestru {self.register_type}"
            self.logger.error(error_msg)
            return {'error': error_msg, 'success': False}
        
        # Sprawdzenie limitu zapytań
        if not self._check_rate_limit():
            error_msg = f"Przekroczono limit zapytań dla rejestru {self.register_type}"
            self.logger.warning(error_msg)
            self._log_api_call(
                operation=endpoint,
                status='error',
                request_params=params,
                error_details=error_msg
            )
            return {'error': error_msg, 'success': False}
        
        # Dodanie klucza API do parametrów
        api_params = params.copy()
        api_params['api_key'] = self.config.api_key
        
        # Przygotowanie URL
        url = f"{self.config.api_url}/{endpoint}"
        
        # Pomiar czasu
        start_time = time.time()
        
        try:
            # Wykonanie zapytania
            response = requests.get(url, params=api_params, timeout=timeout)
            response_time = int((time.time() - start_time) * 1000)  # Czas w ms
            
            # Logowanie zapytania
            self._log_api_call(
                operation=endpoint,
                status='success' if response.status_code == 200 else 'error',
                request_params=params,  # Bez klucza API
                response_code=response.status_code,
                response_time_ms=response_time,
                error_details=None if response.status_code == 200 else response.text
            )
            
            # Sprawdzenie odpowiedzi
            if response.status_code != 200:
                error_msg = f"Błąd API {self.register_type}: {response.status_code} - {response.text}"
                self.logger.error(error_msg)
                return {'error': error_msg, 'success': False}
                
            # Parsowanie odpowiedzi JSON
            result = response.json()
            
            # Aktualizacja daty ostatniej synchronizacji
            if self.config:
                self.config.last_sync = datetime.utcnow()
                try:
                    db.session.commit()
                except:
                    db.session.rollback()
            
            return result
            
        except requests.RequestException as e:
            response_time = int((time.time() - start_time) * 1000)
            error_msg = f"Błąd połączenia z API {self.register_type}: {str(e)}"
            self.logger.error(error_msg)
            
            # Logowanie błędu
            self._log_api_call(
                operation=endpoint,
                status='error',
                request_params=params,  # Bez klucza API
                response_time_ms=response_time,
                error_details=str(e)
            )
            
            return {'error': error_msg, 'success': False}
        except Exception as e:
            response_time = int((time.time() - start_time) * 1000)
            error_msg = f"Nieoczekiwany błąd podczas zapytania do API {self.register_type}: {str(e)}"
            self.logger.error(f"{error_msg}\n{traceback.format_exc()}")
            
            # Logowanie błędu
            self._log_api_call(
                operation=endpoint,
                status='error',
                request_params=params,  # Bez klucza API
                response_time_ms=response_time,
                error_details=str(e)
            )
            
            return {'error': error_msg, 'success': False}
    
    def search_companies(self, params):
        """
        Wyszukuje firmy na podstawie podanych parametrów
        
        Args:
            params (dict): Parametry wyszukiwania
            
        Returns:
            dict: Wyniki wyszukiwania
        """
        # Ta metoda powinna być nadpisana przez podklasy
        raise NotImplementedError("Metoda powinna być zaimplementowana przez podklasę")
    
    def get_company_details(self, identifier_type, identifier_value):
        """
        Pobiera szczegóły firmy na podstawie identyfikatora
        
        Args:
            identifier_type (str): Typ identyfikatora ('nip', 'regon', 'company_id')
            identifier_value (str): Wartość identyfikatora
            
        Returns:
            dict: Szczegóły firmy
        """
        # Ta metoda powinna być nadpisana przez podklasy
        raise NotImplementedError("Metoda powinna być zaimplementowana przez podklasę")
    
    def validate_company_data(self, company_data):
        """
        Waliduje dane firmy przed zapisem do bazy
        
        Args:
            company_data (dict): Dane firmy
            
        Returns:
            tuple: (bool, str) - (czy dane są poprawne, komunikat błędu)
        """
        required_fields = ['nip', 'company_name']
        
        for field in required_fields:
            if field not in company_data or not company_data[field]:
                return False, f"Brak wymaganego pola: {field}"
        
        return True, ""
    
    def save_company(self, company_data, update_existing=False):
        """
        Zapisuje dane firmy do bazy
        
        Args:
            company_data (dict): Dane firmy
            update_existing (bool): Czy aktualizować istniejące firmy
            
        Returns:
            tuple: (bool, RegisterCompany, str) - (sukces, obiekt firmy, komunikat)
        """
        # Walidacja danych
        is_valid, error_msg = self.validate_company_data(company_data)
        
        if not is_valid:
            return False, None, error_msg
        
        try:
            # Sprawdzenie czy firma już istnieje
            existing_company = RegisterCompany.get_by_nip(company_data['nip'])
            
            if existing_company:
                # Firma już istnieje
                if update_existing:
                    # Aktualizacja istniejącej firmy
                    
                    # Aktualizacja podstawowych pól
                    existing_company.register_type = company_data.get('register_type', existing_company.register_type)
                    existing_company.company_id = company_data.get('company_id', existing_company.company_id)
                    existing_company.regon = company_data.get('regon', existing_company.regon)
                    existing_company.company_name = company_data.get('company_name', existing_company.company_name)
                    existing_company.address = company_data.get('address', existing_company.address)
                    existing_company.postal_code = company_data.get('postal_code', existing_company.postal_code)
                    existing_company.city = company_data.get('city', existing_company.city)
                    existing_company.legal_form = company_data.get('legal_form', existing_company.legal_form)
                    existing_company.status = company_data.get('status', existing_company.status)
                    existing_company.pkd_main = company_data.get('pkd_main', existing_company.pkd_main)
                    
                    # Aktualizacja kodów PKD
                    if 'pkd_codes' in company_data:
                        existing_company.pkd_codes = json.dumps(company_data['pkd_codes'])
                    
                    existing_company.industry_desc = company_data.get('industry_desc', existing_company.industry_desc)
                    
                    # Aktualizacja dat
                    if 'foundation_date' in company_data and company_data['foundation_date']:
                        try:
                            if isinstance(company_data['foundation_date'], str):
                                existing_company.foundation_date = datetime.strptime(company_data['foundation_date'], '%Y-%m-%d').date()
                            else:
                                existing_company.foundation_date = company_data['foundation_date']
                        except ValueError:
                            # Ignorowanie nieprawidłowej daty
                            pass
                    
                    if 'last_update_date' in company_data and company_data['last_update_date']:
                        try:
                            if isinstance(company_data['last_update_date'], str):
                                existing_company.last_update_date = datetime.strptime(company_data['last_update_date'], '%Y-%m-%d').date()
                            else:
                                existing_company.last_update_date = company_data['last_update_date']
                        except ValueError:
                            # Ignorowanie nieprawidłowej daty
                            pass
                    
                    # Aktualizacja pełnych danych
                    if 'full_data' in company_data:
                        existing_company.full_data = json.dumps(company_data['full_data'])
                    
                    # Zapis zmian
                    db.session.commit()
                    return True, existing_company, "Zaktualizowano istniejącą firmę"
                else:
                    # Firma już istnieje, ale nie aktualizujemy
                    return False, existing_company, "Firma już istnieje w bazie"
            else:
                # Tworzenie nowej firmy
                new_company = RegisterCompany(
                    register_type=company_data.get('register_type'),
                    company_id=company_data.get('company_id'),
                    nip=company_data.get('nip'),
                    regon=company_data.get('regon'),
                    company_name=company_data.get('company_name'),
                    address=company_data.get('address'),
                    postal_code=company_data.get('postal_code'),
                    city=company_data.get('city'),
                    legal_form=company_data.get('legal_form'),
                    status=company_data.get('status'),
                    pkd_main=company_data.get('pkd_main'),
                    pkd_codes=json.dumps(company_data.get('pkd_codes', [])),
                    industry_desc=company_data.get('industry_desc'),
                    full_data=json.dumps(company_data.get('full_data', {})),
                    created_by=session.get('user_id') if session else None
                )
                
                # Obsługa dat
                if 'foundation_date' in company_data and company_data['foundation_date']:
                    try:
                        if isinstance(company_data['foundation_date'], str):
                            new_company.foundation_date = datetime.strptime(company_data['foundation_date'], '%Y-%m-%d').date()
                        else:
                            new_company.foundation_date = company_data['foundation_date']
                    except ValueError:
                        # Ignorowanie nieprawidłowej daty
                        pass
                
                if 'last_update_date' in company_data and company_data['last_update_date']:
                    try:
                        if isinstance(company_data['last_update_date'], str):
                            new_company.last_update_date = datetime.strptime(company_data['last_update_date'], '%Y-%m-%d').date()
                        else:
                            new_company.last_update_date = company_data['last_update_date']
                    except ValueError:
                        # Ignorowanie nieprawidłowej daty
                        pass
                
                # Zapis do bazy
                db.session.add(new_company)
                db.session.commit()
                return True, new_company, "Zapisano nową firmę"
                
        except Exception as e:
            db.session.rollback()
            error_msg = f"Błąd podczas zapisywania firmy: {str(e)}"
            self.logger.error(f"{error_msg}\n{traceback.format_exc()}")
            return False, None, error_msg


class CEIDGIntegrationService(RegisterIntegrationService):
    """
    Klasa serwisowa do obsługi integracji z CEIDG
    """
    def __init__(self):
        super().__init__(register_type='CEIDG')
        # Zmiana adresu URL z v1 na v2
        if self.config and self.config.api_url:
            if '/v1' in self.config.api_url:
                self.config.api_url = self.config.api_url.replace('/v1', '/v2')
    
    def search_companies(self, params):
        """
        Wyszukuje firmy w CEIDG na podstawie podanych parametrów
        
        Args:
            params (dict): Parametry wyszukiwania
            
        Returns:
            dict: Wyniki wyszukiwania
        """
        # Mapowanie parametrów na format API CEIDG
        ceidg_params = {}
    
        # Mapowanie podstawowych parametrów (nip jako pojedynczy parametr zamiast tablicy)
        if 'nip' in params:
            ceidg_params['nip'] = params['nip']
        if 'regon' in params:
            ceidg_params['regon'] = params['regon']
        if 'company_name' in params:
            ceidg_params['nazwa'] = params['company_name']
    
        # Mapowanie parametrów branżowych
        if 'pkd_code' in params:
            ceidg_params['pkd'] = params['pkd_code']
    
        # Mapowanie dat
        if 'foundation_date_from' in params:
            ceidg_params['dataod'] = params['foundation_date_from']
        if 'foundation_date_to' in params:
            ceidg_params['datado'] = params['foundation_date_to']
    
        # Status działalności
        if 'status' in params:
            ceidg_params['status'] = params['status']
    
        # Paginacja
        ceidg_params['page'] = params.get('page', 1)
        ceidg_params['limit'] = params.get('limit', 50)
    
        # Wywołanie API
        result = self._make_api_request('firmy', ceidg_params)
        
        if 'error' in result:
            return result
        
        # Przetwarzanie wyników
        processed_results = []
        
        if 'results' in result and result['results']:
            for company in result['results']:
                processed_company = self._process_company_data(company)
                processed_results.append(processed_company)
        
        return {
            'success': True,
            'results': processed_results,
            'total': result.get('total', len(processed_results)),
            'page': result.get('page', 1),
            'pages': result.get('pages', 1)
        }
    
    def get_company_details(self, identifier_type, identifier_value):
        """
        Pobiera szczegóły firmy z CEIDG na podstawie identyfikatora
        
        Args:
            identifier_type (str): Typ identyfikatora ('nip', 'regon', 'company_id')
            identifier_value (str): Wartość identyfikatora
            
        Returns:
            dict: Szczegóły firmy
        """
        # Przygotowanie parametrów
        params = {identifier_type: identifier_value}
        
        # Wywołanie API
        result = self._make_api_request('company-details', params)
        
        if 'error' in result:
            return result
        
        # Przetwarzanie wyniku
        if 'company' in result:
            processed_company = self._process_company_data(result['company'])
            return {
                'success': True,
                'company': processed_company
            }
        else:
            return {
                'success': False,
                'error': 'Nie znaleziono firmy'
            }
    
    def _process_company_data(self, company_data):
        """
        Przetwarza dane firmy z CEIDG na format używany w aplikacji
        
        Args:
            company_data (dict): Dane firmy z CEIDG
            
        Returns:
            dict: Przetworzone dane firmy
        """
        processed_data = {
            'register_type': 'CEIDG',
            'company_id': company_data.get('id'),
            'nip': company_data.get('nip'),
            'regon': company_data.get('regon'),
            'company_name': company_data.get('name'),
            'address': self._format_address(company_data),
            'postal_code': company_data.get('postal_code'),
            'city': company_data.get('city'),
            'legal_form': 'Jednoosobowa działalność gospodarcza',
            'status': self._map_status(company_data.get('status')),
            'pkd_codes': self._extract_pkd_codes(company_data),
            'pkd_main': self._extract_main_pkd(company_data),
            'industry_desc': self._extract_industry_desc(company_data),
            'foundation_date': company_data.get('start_date'),
            'last_update_date': company_data.get('last_update_date'),
            'full_data': company_data
        }
        
        return processed_data
    
    def _format_address(self, company_data):
        """Formatuje adres firmy"""
        address_parts = []
        
        if 'street' in company_data and company_data['street']:
            address_parts.append(company_data['street'])
        
        if 'house_number' in company_data and company_data['house_number']:
            address_parts.append(company_data['house_number'])
        
        if 'flat_number' in company_data and company_data['flat_number']:
            address_parts.append('/' + company_data['flat_number'])
        
        return ' '.join(address_parts)
    
    def _map_status(self, status):
        """Mapuje status firmy z CEIDG na format aplikacji"""
        status_map = {
            'ACTIVE': 'Aktywna',
            'SUSPENDED': 'Zawieszona',
            'CLOSED': 'Zamknięta',
            'LIQUIDATED': 'Zlikwidowana',
            'BANKRUPTCY': 'W upadłości'
        }
        
        return status_map.get(status, status)
    
    def _extract_pkd_codes(self, company_data):
        """Wyciąga kody PKD z danych firmy"""
        pkd_codes = []
        
        if 'pkd_codes' in company_data and company_data['pkd_codes']:
            for pkd_item in company_data['pkd_codes']:
                if 'code' in pkd_item:
                    pkd_codes.append(pkd_item['code'])
        
        return pkd_codes
    
    def _extract_main_pkd(self, company_data):
        """Wyciąga główny kod PKD z danych firmy"""
        if 'pkd_codes' in company_data and company_data['pkd_codes']:
            for pkd_item in company_data['pkd_codes']:
                if 'code' in pkd_item and pkd_item.get('is_main', False):
                    return pkd_item['code']
        
        return None
    
    def _extract_industry_desc(self, company_data):
        """Wyciąga opis branży z danych firmy"""
        if 'pkd_codes' in company_data and company_data['pkd_codes']:
            for pkd_item in company_data['pkd_codes']:
                if 'code' in pkd_item and 'description' in pkd_item and pkd_item.get('is_main', False):
                    return pkd_item['description']
        
        return None


class KRSIntegrationService(RegisterIntegrationService):
    """
    Klasa serwisowa do obsługi integracji z KRS
    """
    def __init__(self):
        super().__init__(register_type='KRS')
    
    def search_companies(self, params):
        """
        Wyszukuje firmy w KRS na podstawie podanych parametrów
        
        Args:
            params (dict): Parametry wyszukiwania
            
        Returns:
            dict: Wyniki wyszukiwania
        """
        # Mapowanie parametrów na format API KRS
        krs_params = {}
        
        # Mapowanie podstawowych parametrów
        if 'nip' in params:
            krs_params['nip'] = params['nip']
        if 'regon' in params:
            krs_params['regon'] = params['regon']
        if 'company_name' in params:
            krs_params['name'] = params['company_name']
        
        # Mapowanie parametrów branżowych
        if 'pkd_code' in params:
            krs_params['pkd'] = params['pkd_code']
        
        # Mapowanie dat
        if 'foundation_date_from' in params:
            krs_params['register_date_from'] = params['foundation_date_from']
        if 'foundation_date_to' in params:
            krs_params['register_date_to'] = params['foundation_date_to']
        
        # Dodatkowe parametry
        krs_params['page'] = params.get('page', 1)
        krs_params['limit'] = params.get('limit', 50)
        
        # Wywołanie API
        result = self._make_api_request('search', krs_params)
        
        if 'error' in result:
            return result
        
        # Przetwarzanie wyników
        processed_results = []
        
        if 'results' in result and result['results']:
            for company in result['results']:
                processed_company = self._process_company_data(company)
                processed_results.append(processed_company)
        
        return {
            'success': True,
            'results': processed_results,
            'total': result.get('total', len(processed_results)),
            'page': result.get('page', 1),
            'pages': result.get('pages', 1)
        }
    
    def get_company_details(self, identifier_type, identifier_value):
        """
        Pobiera szczegóły firmy z KRS na podstawie identyfikatora
        
        Args:
            identifier_type (str): Typ identyfikatora ('nip', 'regon', 'krs')
            identifier_value (str): Wartość identyfikatora
            
        Returns:
            dict: Szczegóły firmy
        """
        # Przygotowanie parametrów
        params = {}
        
        # Mapowanie typów identyfikatorów
        if identifier_type == 'company_id':
            params['krs'] = identifier_value
        else:
            params[identifier_type] = identifier_value
        
        # Wywołanie API
        result = self._make_api_request('company-details', params)
        
        if 'error' in result:
            return result
        
        # Przetwarzanie wyniku
        if 'company' in result:
            processed_company = self._process_company_data(result['company'])
            return {
                'success': True,
                'company': processed_company
            }
        else:
            return {
                'success': False,
                'error': 'Nie znaleziono firmy'
            }
    
    def _process_company_data(self, company_data):
        """
        Przetwarza dane firmy z KRS na format używany w aplikacji
        
        Args:
            company_data (dict): Dane firmy z KRS
            
        Returns:
            dict: Przetworzone dane firmy
        """
        processed_data = {
            'register_type': 'KRS',
            'company_id': company_data.get('krs'),
            'nip': company_data.get('nip'),
            'regon': company_data.get('regon'),
            'company_name': company_data.get('name'),
            'address': self._format_address(company_data),
            'postal_code': company_data.get('postal_code'),
            'city': company_data.get('city'),
            'legal_form': self._extract_legal_form(company_data),
            'status': self._map_status(company_data.get('status')),
            'pkd_codes': self._extract_pkd_codes(company_data),
            'pkd_main': self._extract_main_pkd(company_data),
            'industry_desc': self._extract_industry_desc(company_data),
            'foundation_date': company_data.get('register_date'),
            'last_update_date': company_data.get('last_update_date'),
            'full_data': company_data
        }
        
        return processed_data
    
    def _format_address(self, company_data):
        """Formatuje adres firmy"""
        address_parts = []
        
        if 'street' in company_data and company_data['street']:
            address_parts.append(company_data['street'])
        
        if 'house_number' in company_data and company_data['house_number']:
            address_parts.append(company_data['house_number'])
        
        if 'flat_number' in company_data and company_data['flat_number']:
            address_parts.append('/' + company_data['flat_number'])
        
        return ' '.join(address_parts)
    
    def _extract_legal_form(self, company_data):
        """Wyciąga formę prawną firmy z danych KRS"""
        if 'legal_form' in company_data:
            return company_data['legal_form']
            
        # Domyślne mapowanie na podstawie typu spółki
        company_type = company_data.get('company_type')
        if company_type:
            type_map = {
                'SP_ZOO': 'Spółka z ograniczoną odpowiedzialnością',
                'SA': 'Spółka akcyjna',
                'SJ': 'Spółka jawna',
                'SK': 'Spółka komandytowa',
                'SKA': 'Spółka komandytowo-akcyjna',
                'SP': 'Spółka partnerska',
                'SC': 'Spółka cywilna'
            }
            return type_map.get(company_type, company_type)
        
        return 'Nieznana forma prawna'
    
    def _map_status(self, status):
        """Mapuje status firmy z KRS na format aplikacji"""
        status_map = {
            'ACTIVE': 'Aktywna',
            'PENDING_LIQUIDATION': 'W likwidacji',
            'LIQUIDATED': 'Zlikwidowana',
            'BANKRUPTCY': 'W upadłości',
            'DELETED': 'Wykreślona z rejestru'
        }
        
        return status_map.get(status, status)
    
    def _extract_pkd_codes(self, company_data):
       """Wyciąga kody PKD z danych firmy"""
       pkd_codes = []
       
       if 'pkd_codes' in company_data and company_data['pkd_codes']:
           for pkd_item in company_data['pkd_codes']:
               if 'code' in pkd_item:
                   pkd_codes.append(pkd_item['code'])
       
       return pkd_codes
   
   def _extract_main_pkd(self, company_data):
       """Wyciąga główny kod PKD z danych firmy"""
       if 'pkd_codes' in company_data and company_data['pkd_codes']:
           for pkd_item in company_data['pkd_codes']:
               if 'code' in pkd_item and pkd_item.get('is_main', False):
                   return pkd_item['code']
           
           # Jeśli nie znaleziono głównego kodu, zwracamy pierwszy
           if company_data['pkd_codes'] and 'code' in company_data['pkd_codes'][0]:
               return company_data['pkd_codes'][0]['code']
       
       return None
   
   def _extract_industry_desc(self, company_data):
       """Wyciąga opis branży z danych firmy"""
       if 'pkd_codes' in company_data and company_data['pkd_codes']:
           for pkd_item in company_data['pkd_codes']:
               if 'code' in pkd_item and 'description' in pkd_item and pkd_item.get('is_main', False):
                   return pkd_item['description']
           
           # Jeśli nie znaleziono głównego kodu, zwracamy opis pierwszego
           if company_data['pkd_codes'] and 'description' in company_data['pkd_codes'][0]:
               return company_data['pkd_codes'][0]['description']
       
       return None


class RegisterService:
   """
   Główna klasa serwisowa do obsługi rejestrów - fasada dla obu typów rejestrów
   """
   def __init__(self):
       self.ceidg_service = CEIDGIntegrationService()
       self.krs_service = KRSIntegrationService()
       self.logger = register_logger
   
   def search_in_registers(self, params, register_type=None):
       """
       Wyszukuje firmy w rejestrach CEIDG i KRS
       
       Args:
           params (dict): Parametry wyszukiwania
           register_type (str): Typ rejestru ('CEIDG', 'KRS' lub None dla obu)
           
       Returns:
           dict: Wyniki wyszukiwania i statusy operacji
       """
       results = []
       errors = []
       sources = []
       
       # Sprawdzenie parametrów wyszukiwania
       if not params:
           return {
               'success': False,
               'error': 'Brak parametrów wyszukiwania'
           }
       
       # Wyszukiwanie w CEIDG
       if register_type is None or register_type == 'CEIDG':
           try:
               ceidg_config = RegisterIntegrationConfig.get_config('CEIDG')
               if ceidg_config and ceidg_config.active:
                   ceidg_result = self.ceidg_service.search_companies(params)
                   
                   if ceidg_result.get('success', False) and 'results' in ceidg_result:
                       for company in ceidg_result['results']:
                           # Dodanie źródła danych
                           company['register_type'] = 'CEIDG'
                           results.append(company)
                       
                       sources.append('CEIDG')
                   elif 'error' in ceidg_result:
                       errors.append(f"CEIDG: {ceidg_result['error']}")
               else:
                   errors.append("Integracja z CEIDG nie jest aktywna")
           except Exception as e:
               error_msg = f"Błąd wyszukiwania w CEIDG: {str(e)}"
               self.logger.error(f"{error_msg}\n{traceback.format_exc()}")
               errors.append(f"CEIDG: {str(e)}")
       
       # Wyszukiwanie w KRS
       if register_type is None or register_type == 'KRS':
           try:
               krs_config = RegisterIntegrationConfig.get_config('KRS')
               if krs_config and krs_config.active:
                   krs_result = self.krs_service.search_companies(params)
                   
                   if krs_result.get('success', False) and 'results' in krs_result:
                       for company in krs_result['results']:
                           # Dodanie źródła danych
                           company['register_type'] = 'KRS'
                           results.append(company)
                       
                       sources.append('KRS')
                   elif 'error' in krs_result:
                       errors.append(f"KRS: {krs_result['error']}")
               else:
                   errors.append("Integracja z KRS nie jest aktywna")
           except Exception as e:
               error_msg = f"Błąd wyszukiwania w KRS: {str(e)}"
               self.logger.error(f"{error_msg}\n{traceback.format_exc()}")
               errors.append(f"KRS: {str(e)}")
       
       # Przygotowanie odpowiedzi
       if not sources:
           # Żaden rejestr nie był dostępny
           return {
               'success': False,
               'error': "Brak dostępu do rejestrów: " + ", ".join(errors)
           }
       
       # Zwracanie wyników i informacji o błędach (jeśli były)
       return {
           'success': True,
           'data': results,
           'sources': sources,
           'partial_errors': errors if errors else None,
           'total': len(results)
       }
   
   def get_company_details(self, register_type, identifier_type, identifier_value):
       """
       Pobiera szczegóły firmy z rejestru
       
       Args:
           register_type (str): Typ rejestru ('CEIDG' lub 'KRS')
           identifier_type (str): Typ identyfikatora ('nip', 'regon', 'company_id')
           identifier_value (str): Wartość identyfikatora
           
       Returns:
           dict: Szczegóły firmy
       """
       if not register_type or not identifier_type or not identifier_value:
           return {
               'success': False,
               'error': 'Brak wymaganych parametrów'
           }
       
       try:
           if register_type == 'CEIDG':
               return self.ceidg_service.get_company_details(identifier_type, identifier_value)
           elif register_type == 'KRS':
               return self.krs_service.get_company_details(identifier_type, identifier_value)
           else:
               return {
                   'success': False,
                   'error': f"Nieznany typ rejestru: {register_type}"
               }
       except Exception as e:
           error_msg = f"Błąd pobierania szczegółów firmy: {str(e)}"
           self.logger.error(f"{error_msg}\n{traceback.format_exc()}")
           return {
               'success': False,
               'error': error_msg
           }
   
   def save_companies(self, companies, update_existing=False):
       """
       Zapisuje firmy do bazy danych
       
       Args:
           companies (list): Lista firm do zapisania
           update_existing (bool): Czy aktualizować istniejące firmy
           
       Returns:
           dict: Statystyki zapisywania
       """
       if not companies:
           return {
               'success': False,
               'error': 'Brak firm do zapisania'
           }
       
       stats = {
           'saved': 0,
           'updated': 0,
           'failed': 0,
           'already_exists': 0
       }
       
       for company_data in companies:
           try:
               register_type = company_data.get('register_type')
               
               if register_type == 'CEIDG':
                   service = self.ceidg_service
               elif register_type == 'KRS':
                   service = self.krs_service
               else:
                   # Nieznany typ rejestru
                   stats['failed'] += 1
                   continue
               
               # Zapisanie firmy
               success, company, message = service.save_company(company_data, update_existing)
               
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
                       self.logger.warning(f"Nie udało się zapisać firmy: {message}")
           except Exception as e:
               stats['failed'] += 1
               error_msg = f"Błąd zapisywania firmy: {str(e)}"
               self.logger.error(f"{error_msg}\n{traceback.format_exc()}")
       
       return {
           'success': True,
           'stats': stats,
           'message': f"Zapisano {stats['saved']} firm, zaktualizowano {stats['updated']}, pominięto {stats['already_exists']}, błędy: {stats['failed']}"
       }
   
   def test_connections(self):
       """
       Testuje połączenia z API rejestrów
       
       Returns:
           dict: Wyniki testów
       """
       results = {
           'CEIDG': {
               'success': False,
               'message': 'Nie przetestowano'
           },
           'KRS': {
               'success': False,
               'message': 'Nie przetestowano'
           }
       }
       
       # Test CEIDG
       try:
           ceidg_config = RegisterIntegrationConfig.get_config('CEIDG')
           if ceidg_config and ceidg_config.active:
               ceidg_result = self.ceidg_service._make_api_request('test', {})
               
               if not 'error' in ceidg_result:
                   results['CEIDG'] = {
                       'success': True,
                       'message': 'Połączenie działa poprawnie'
                   }
               else:
                   results['CEIDG'] = {
                       'success': False,
                       'message': ceidg_result['error']
                   }
           else:
               results['CEIDG'] = {
                   'success': False,
                   'message': 'Integracja nie jest aktywna'
               }
       except Exception as e:
           results['CEIDG'] = {
               'success': False,
               'message': f"Błąd: {str(e)}"
           }
       
       # Test KRS
       try:
           krs_config = RegisterIntegrationConfig.get_config('KRS')
           if krs_config and krs_config.active:
               krs_result = self.krs_service._make_api_request('test', {})
               
               if not 'error' in krs_result:
                   results['KRS'] = {
                       'success': True,
                       'message': 'Połączenie działa poprawnie'
                   }
               else:
                   results['KRS'] = {
                       'success': False,
                       'message': krs_result['error']
                   }
           else:
               results['KRS'] = {
                   'success': False,
                   'message': 'Integracja nie jest aktywna'
               }
       except Exception as e:
           results['KRS'] = {
               'success': False,
               'message': f"Błąd: {str(e)}"
           }
       
       return {
           'success': results['CEIDG']['success'] or results['KRS']['success'],
           'results': results
       }
   
   def create_client_from_company(self, company_id):
       """
       Tworzy klienta na podstawie danych firmy
       
       Args:
           company_id (int): ID firmy
           
       Returns:
           dict: Informacje o utworzonym kliencie
       """
       from modules.clients.models import Client
       
       try:
           # Pobranie firmy
           company = RegisterCompany.query.get(company_id)
           
           if not company:
               return {
                   'success': False,
                   'error': 'Firma nie istnieje'
               }
           
           # Sprawdzenie czy klient z tym NIP już istnieje
           existing_client = Client.query.filter_by(invoice_nip=company.nip).first()
           
           if existing_client:
               return {
                   'success': False,
                   'error': f"Klient z NIP {company.nip} już istnieje (ID: {existing_client.id})",
                   'client_id': existing_client.id
               }
           
           # Generowanie numeru klienta
           import random
           import string
           
           # Generowanie losowego numeru klienta
           client_number = ''.join(random.choices(string.digits, k=6))
           
           # Tworzenie nowego klienta
           new_client = Client(
               client_number=client_number,
               client_name=company.company_name,
               client_delivery_name=company.company_name,
               email="",  # Brak w danych rejestru
               phone="",  # Brak w danych rejestru
               
               # Adres dostawy
               delivery_company=company.company_name,
               delivery_address=company.address,
               delivery_zip=company.postal_code,
               delivery_city=company.city,
               delivery_region="",  # Brak w danych rejestru
               delivery_country="Polska",
               
               # Adres faktury
               invoice_company=company.company_name,
               invoice_address=company.address,
               invoice_zip=company.postal_code,
               invoice_city=company.city,
               invoice_region="",  # Brak w danych rejestru
               invoice_nip=company.nip,
               
               # Źródło klienta
               source=f"Register:{company.register_type}"
           )
           
           # Zapisanie klienta
           db.session.add(new_client)
           db.session.commit()
           
           return {
               'success': True,
               'client': {
                   'id': new_client.id,
                   'client_number': new_client.client_number,
                   'client_name': new_client.client_name
               },
               'message': f"Utworzono klienta: {new_client.client_name}"
           }
       except Exception as e:
           db.session.rollback()
           error_msg = f"Błąd tworzenia klienta: {str(e)}"
           self.logger.error(f"{error_msg}\n{traceback.format_exc()}")
           return {
               'success': False,
               'error': error_msg
           }