import requests
import json
import logging
import time
import re
from datetime import datetime, timedelta
from flask import current_app, session, request
from extensions import db
from .models import RegisterCompany, RegisterPkdCode, RegisterApiLog, RegisterIntegrationConfig

# Konfiguracja loggera
register_logger = logging.getLogger('company_register_module')


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
            self.logger.error(f"Błąd logowania API: {str(e)}")


class CEIDGIntegrationService(RegisterIntegrationService):
    """
    Klasa serwisowa do obsługi integracji z CEIDG API v2
    """
    def __init__(self):
        super().__init__(register_type='CEIDG')
        # URL API z bazy danych
        if self.config and self.config.api_url:
            self.api_base_url = self.config.api_url
            # URL testowy - zamiana domeny
            self.test_api_base_url = self.config.api_url.replace('dane.biznes.gov.pl', 'test-dane.biznes.gov.pl')
        else:
            # Fallback URLs zgodnie z dokumentacją
            self.api_base_url = "https://dane.biznes.gov.pl/api/ceidg/v2"
            self.test_api_base_url = "https://test-dane.biznes.gov.pl/api/ceidg/v2"
    
    def _is_uuid(self, value):
        """Sprawdza czy wartość jest prawidłowym UUID"""
        uuid_pattern = re.compile(r'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$')
        return bool(uuid_pattern.match(str(value)))
    
    def _check_rate_limit_detailed(self):
        """
        Sprawdza limity API dla CEIDG zgodnie z dokumentacją:
        - 50 zapytań w okresie 3 minut
        - 1000 zapytań w okresie 60 minut
        """
        if not self.config or self.register_type != 'CEIDG':
            return True, "OK"
        
        now = datetime.utcnow()
        
        # Sprawdzenie 50 zapytań w 3 minuty
        three_minutes_ago = now - timedelta(minutes=3)
        three_min_count = RegisterApiLog.query.filter(
            RegisterApiLog.register_type == 'CEIDG',
            RegisterApiLog.created_at >= three_minutes_ago
        ).count()
        
        if three_min_count >= 50:
            self.logger.warning(f"CEIDG: Przekroczono limit 50 zapytań na 3 minuty ({three_min_count})")
            return False, "Przekroczono limit 50 zapytań na 3 minuty"
        
        # Sprawdzenie 1000 zapytań w 60 minut
        hour_ago = now - timedelta(minutes=60)
        hour_count = RegisterApiLog.query.filter(
            RegisterApiLog.register_type == 'CEIDG',
            RegisterApiLog.created_at >= hour_ago
        ).count()
        
        if hour_count >= 1000:
            self.logger.warning(f"CEIDG: Przekroczono limit 1000 zapytań na godzinę ({hour_count})")
            return False, "Przekroczono limit 1000 zapytań na godzinę"
        
        return True, "OK"
    
    def _is_uuid(self, value):
        """Sprawdza czy wartość jest prawidłowym UUID"""
        uuid_pattern = re.compile(r'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$')
        is_uuid = bool(uuid_pattern.match(str(value)))
        self.logger.info(f"🆔 DEBUGGING: UUID check for '{value}': {is_uuid}")
        return is_uuid

    def _wait_for_optimal_timing(self):
        """
        Implementuje optymalny delay 3,6s między zapytaniami zgodnie z dokumentacją
        """
        last_call = RegisterApiLog.query.filter(
            RegisterApiLog.register_type == 'CEIDG'
        ).order_by(RegisterApiLog.created_at.desc()).first()
        
        if last_call:
            time_since = (datetime.utcnow() - last_call.created_at).total_seconds()
            optimal_delay = 3.6  # Zgodnie z dokumentacją CEIDG
            
            if time_since < optimal_delay:
                sleep_time = optimal_delay - time_since
                self.logger.info(f"CEIDG: Czekanie {sleep_time:.1f}s dla optymalnego rate limiting")
                time.sleep(sleep_time)

    def _make_api_request(self, endpoint, params, timeout=30, use_test=False):
        """Wykonuje zapytanie do API CEIDG zgodnie z dokumentacją v2"""
        if not self.config:
            error_msg = f"Brak konfiguracji dla rejestru CEIDG"
            self.logger.error(error_msg)
            return {'error': error_msg, 'success': False}
        
        if not self.config.api_key:
            error_msg = f"Brak JWT tokenu dla CEIDG w konfiguracji"
            self.logger.error(error_msg)
            return {'error': error_msg, 'success': False}
        
        # Sprawdzenie rate limit
        can_proceed, limit_msg = self._check_rate_limit_detailed()
        if not can_proceed:
            self.logger.warning(f"Rate limit CEIDG: {limit_msg}")
            self._log_api_call(
                operation=endpoint,
                status='error',
                request_params=params,
                error_details=limit_msg
            )
            return {'error': limit_msg, 'success': False, 'rate_limit_exceeded': True}
        
        # Optymalne czekanie między zapytaniami
        self._wait_for_optimal_timing()
        
        # Wybór URL (test vs produkcja)
        base_url = self.test_api_base_url if use_test else self.api_base_url
        url = f"{base_url}/{endpoint}"
        
        # Przygotowanie nagłówków z JWT tokenem z bazy danych
        headers = {
            'Authorization': f'Bearer {self.config.api_key}',
            'Content-Type': 'application/json'
        }
        
        start_time = time.time()
        
        try:
            # Wykonanie zapytania
            response = requests.get(url, params=params, headers=headers, timeout=timeout)
            response_time = int((time.time() - start_time) * 1000)
            
            # Logowanie zapytania
            self._log_api_call(
                operation=endpoint,
                status='success' if response.status_code in [200, 204] else 'error',
                request_params=params,
                response_code=response.status_code,
                response_time_ms=response_time,
                error_details=None if response.status_code in [200, 204] else response.text
            )
            
            # Obsługa odpowiedzi zgodnie z dokumentacją
            if response.status_code == 200:
                result = response.json()
                # Aktualizacja ostatniej synchronizacji
                if self.config:
                    self.config.last_sync = datetime.utcnow()
                    try:
                        db.session.commit()
                    except:
                        db.session.rollback()
                return {'success': True, **result}
                
            elif response.status_code == 204:
                # Brak danych - zgodnie z dokumentacją
                return {'success': True, 'results': [], 'message': 'Brak danych spełniających kryteria'}
                
            elif response.status_code == 400:
                error_msg = "Niepoprawnie skonstruowane zapytanie CEIDG"
                self.logger.error(f"{error_msg}: {response.text}")
                return {'error': error_msg, 'success': False}
                
            elif response.status_code == 401:
                error_msg = "Brak autoryzacji CEIDG - sprawdź JWT token"
                self.logger.error(error_msg)
                return {'error': error_msg, 'success': False}
                
            elif response.status_code == 403:
                error_msg = "Brak uprawnień do zasobu CEIDG"
                self.logger.error(error_msg)
                return {'error': error_msg, 'success': False}
                
            elif response.status_code == 404:
                error_msg = "Zasób CEIDG nie istnieje"
                self.logger.error(error_msg)
                return {'error': error_msg, 'success': False}
                
            elif response.status_code == 429:
                error_msg = "Zbyt wiele zapytań - przekroczono limit API CEIDG"
                self.logger.warning(error_msg)
                return {'error': error_msg, 'success': False, 'rate_limit_exceeded': True}
                
            elif response.status_code == 500:
                error_msg = "Wewnętrzny błąd serwera CEIDG"
                self.logger.error(f"{error_msg}: {response.text}")
                return {'error': error_msg, 'success': False}
                
            else:
                error_msg = f"Nieoczekiwany błąd API CEIDG: {response.status_code}"
                self.logger.error(f"{error_msg}: {response.text}")
                return {'error': error_msg, 'success': False}
                
        except requests.RequestException as e:
            response_time = int((time.time() - start_time) * 1000)
            error_msg = f"Błąd połączenia z API CEIDG: {str(e)}"
            self.logger.error(error_msg)
            
            self._log_api_call(
                operation=endpoint,
                status='error',
                request_params=params,
                response_time_ms=response_time,
                error_details=str(e)
            )
            
            return {'error': error_msg, 'success': False}
    
    def search_companies(self, params):
        """
        Wyszukuje firmy w CEIDG zgodnie z dokumentacją API v2
        Endpoint: /firmy + pobieranie szczegółów z linków
        """
        self.logger.info(f"🔍 DEBUGGING: Starting CEIDG search with params: {params}")
        
        # Mapowanie parametrów zgodnie z dokumentacją CEIDG - WSZYSTKIE JAKO TABLICE
        ceidg_params = {}
        
        # CEIDG wymaga tablic dla parametrów wyszukiwania
        if 'nip' in params:
            ceidg_params['nip[]'] = params['nip']
        if 'regon' in params:
            ceidg_params['regon[]'] = params['regon']
        if 'company_name' in params:
            ceidg_params['nazwa[]'] = params['company_name']
        if 'pkd_code' in params:
            ceidg_params['pkd[]'] = params['pkd_code']
        if 'miasto' in params:
            ceidg_params['miasto[]'] = params['miasto']
        if 'wojewodztwo' in params:
            ceidg_params['wojewodztwo[]'] = params['wojewodztwo']
        if 'ulica' in params:
            ceidg_params['ulica[]'] = params['ulica']
        if 'kod_pocztowy' in params:
            ceidg_params['kod[]'] = params['kod_pocztowy']
        if 'foundation_date_from' in params:
            ceidg_params['dataod'] = params['foundation_date_from']
        if 'foundation_date_to' in params:
            ceidg_params['datado'] = params['foundation_date_to']
        if 'status' in params:
            status_map = {
                'ACTIVE': 'AKTYWNY',
                'SUSPENDED': 'ZAWIESZONY',
                'CLOSED': 'WYKRESLONY',
                'PENDING': 'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI',
                'COMPANY_ONLY': 'WYLACZNIE_W_FORMIE_SPOLKI'
            }
            mapped_status = status_map.get(params['status'], params['status'])
            ceidg_params['status[]'] = mapped_status
            
        # Paginacja i limit - ograniczamy do 10 żeby nie robić za dużo szczegółowych zapytań
        limit = min(params.get('limit', 10), 10)  # Zmniejszamy limit z powodu dodatkowych zapytań
        page = params.get('page', 1)
        
        ceidg_params['page'] = page
        ceidg_params['limit'] = limit
        
        self.logger.info(f"🔍 DEBUGGING: Mapped CEIDG params: {json.dumps(ceidg_params, ensure_ascii=False)}")
        
        # Wykonanie zapytania do /firmy (podstawowe dane)
        result = self._make_api_request('firmy', ceidg_params, use_test=params.get('use_test', False))
        
        if not result.get('success', False):
            self.logger.error(f"❌ DEBUGGING: CEIDG API failed: {result.get('error', 'Unknown error')}")
            return result
        
        # Przetwarzanie wyników
        companies = result.get('firmy', [])
        self.logger.info(f"📊 DEBUGGING: CEIDG returned {len(companies)} companies from /firmy endpoint")
        
        processed_results = []
        
        for i, company in enumerate(companies):
            self.logger.info(f"🔄 DEBUGGING: Processing company {i+1}/{len(companies)}: {company.get('nazwa', 'Unknown')}")
            
            # KLUCZOWE: Pobierz szczegółowe dane używając linku z odpowiedzi
            detailed_company = company.copy()  # Start with basic data
            
            if 'link' in company and company['link']:
                self.logger.info(f"🔗 DEBUGGING: Fetching detailed data from: {company['link']}")
                try:
                    # Wyciągnij ID z linku i użyj go w zapytaniu
                    company_id = company['link'].split('/')[-1]
                    self.logger.info(f"🆔 DEBUGGING: Extracted company ID: {company_id}")
                    
                    # Pobierz szczegóły firmy
                    detailed_result = self.get_company_details('company_id', company_id)
                    
                    if detailed_result.get('success') and 'company' in detailed_result:
                        # Użyj full_data z szczegółowego zapytania
                        detailed_data = detailed_result['company'].get('full_data', {})
                        if detailed_data:
                            detailed_company = detailed_data
                            self.logger.info(f"✅ DEBUGGING: Got detailed data with keys: {list(detailed_data.keys())}")
                        else:
                            self.logger.warning(f"⚠️ DEBUGGING: No full_data in detailed result")
                    else:
                        self.logger.warning(f"⚠️ DEBUGGING: Failed to get company details: {detailed_result.get('error', 'Unknown error')}")
                        
                except Exception as e:
                    self.logger.error(f"❌ DEBUGGING: Exception getting company details: {str(e)}")
            else:
                self.logger.warning(f"⚠️ DEBUGGING: No link found in company data")
            
            # Przetwórz dane (teraz z pełnymi szczegółami)
            processed_company = self._process_company_data(detailed_company)
            processed_results.append(processed_company)
            
            # Log processed result for first company
            if i == 0:
                self.logger.info(f"📋 DEBUGGING: First company AFTER processing:")
                self.logger.info(f"   pkd_main: {processed_company.get('pkd_main')}")
                self.logger.info(f"   industry_desc: {processed_company.get('industry_desc')}")
                self.logger.info(f"   phone: {processed_company.get('phone')}")
                self.logger.info(f"   email: {processed_company.get('email')}")
        
        final_result = {
            'success': True,
            'results': processed_results,
            'total': result.get('count', len(processed_results)),
            'page': page,
            'has_next': result.get('links', {}).get('next') is not None
        }
        
        self.logger.info(f"✅ DEBUGGING: CEIDG search completed with {len(processed_results)} processed companies")
        
        return final_result
    
    def get_company_details(self, identifier_type, identifier_value):
        """
        Pobiera szczegóły firmy z CEIDG
        Obsługuje dwa endpointy zgodnie z dokumentacją:
        - /firma?query - z parametrami query  
        - /firma/{id} - z UUID w ścieżce
        """
        self.logger.info(f"🔍 DEBUGGING: Getting company details: {identifier_type}={identifier_value}")
        
        params = {}
        
        if identifier_type == 'company_id' and self._is_uuid(identifier_value):
            # UUID - bezpośredni endpoint /firma/{id}
            endpoint = f"firma/{identifier_value}"
            self.logger.info(f"🆔 DEBUGGING: Using UUID endpoint: {endpoint}")
        else:
            # Endpoint z parametrami query /firma
            endpoint = "firma"
            if identifier_type == 'nip':
                params['nip'] = identifier_value  # Pojedynczy NIP (nie tablica!)
            elif identifier_type == 'regon':
                params['regon'] = identifier_value
            elif identifier_type == 'ids':
                params['ids[]'] = identifier_value  # ids jako tablica
            else:
                error_msg = f'Nieobsługiwany typ identyfikatora: {identifier_type}'
                self.logger.error(f"❌ DEBUGGING: {error_msg}")
                return {
                    'success': False,
                    'error': error_msg
                }
            
            self.logger.info(f"🔍 DEBUGGING: Using query endpoint: {endpoint} with params: {params}")
        
        result = self._make_api_request(endpoint, params)
        
        if not result.get('success', False):
            self.logger.error(f"❌ DEBUGGING: Company details API failed: {result.get('error')}")
            return result
        
        self.logger.info(f"📊 DEBUGGING: Company details result keys: {list(result.keys())}")
        
        # Przetwarzanie wyniku
        if 'firma' in result and result['firma']:
            # CEIDG zwraca tablicę firm nawet dla jednej firmy w endpoint /firma
            company_data = result['firma'][0] if isinstance(result['firma'], list) else result['firma']
            
            self.logger.info(f"📋 DEBUGGING: Company details data keys: {list(company_data.keys()) if isinstance(company_data, dict) else 'Not a dict'}")
            self.logger.info(f"📋 DEBUGGING: Company details full data (first 2000 chars): {json.dumps(company_data, ensure_ascii=False, indent=2)[:2000]}...")
            
            processed_company = self._process_company_data(company_data)
            return {
                'success': True,
                'company': processed_company
            }
        else:
            error_msg = 'Nie znaleziono firmy w CEIDG'
            self.logger.warning(f"⚠️ DEBUGGING: {error_msg}")
            return {
                'success': False,
                'error': error_msg
            }
    
    def _process_company_data(self, company_data):
        """
        Przetwarza dane firmy z CEIDG zgodnie ze strukturą API v2
        """
        self.logger.info(f"🔄 DEBUGGING: Processing CEIDG company: {company_data.get('nazwa', 'Unknown')}")
        
        # LOG PEŁNEJ STRUKTURY DANYCH Z CEIDG
        self.logger.info(f"📊 RAW CEIDG DATA KEYS: {list(company_data.keys()) if isinstance(company_data, dict) else 'Not a dict'}")
        self.logger.info(f"📊 RAW CEIDG DATA (first 1000 chars): {json.dumps(company_data, ensure_ascii=False, indent=2)[:1000]}...")
        
        # Podstawowe dane
        processed_data = {
            'register_type': 'CEIDG',
            'company_id': company_data.get('id'),
            'company_name': company_data.get('nazwa'),
            'status': self._map_status(company_data.get('status')),
            'foundation_date': company_data.get('dataRozpoczecia'),
            'last_update_date': company_data.get('dataModyfikacji'),
        }
        
        self.logger.info(f"📄 Basic data processed: name={processed_data['company_name']}, status={processed_data['status']}")
        
        # Dane właściciela
        if 'wlasciciel' in company_data:
            owner = company_data['wlasciciel']
            self.logger.info(f"👤 Owner data keys: {list(owner.keys()) if isinstance(owner, dict) else 'Not a dict'}")
            self.logger.info(f"👤 Owner data: {json.dumps(owner, ensure_ascii=False)}")
            
            processed_data.update({
                'nip': owner.get('nip'),
                'regon': owner.get('regon'),
                'owner_name': f"{owner.get('imie', '')} {owner.get('nazwisko', '')}".strip()
            })
            self.logger.info(f"👤 Owner processed: NIP={processed_data.get('nip')}, REGON={processed_data.get('regon')}")
        else:
            self.logger.warning("⚠️ NO 'wlasciciel' found in CEIDG data!")
        
        # Adres działalności
        if 'adresDzialalnosci' in company_data:
            address = company_data['adresDzialalnosci']
            self.logger.info(f"🏢 Address data keys: {list(address.keys()) if isinstance(address, dict) else 'Not a dict'}")
            self.logger.info(f"🏢 Address data: {json.dumps(address, ensure_ascii=False)}")
            
            address_parts = []
            if address.get('ulica'):
                address_parts.append(address.get('ulica'))
            if address.get('budynek'):
                address_parts.append(address.get('budynek'))
            if address.get('lokal'):
                address_parts.append(f"/{address.get('lokal')}")
                    
            processed_data.update({
                'address': ' '.join(address_parts),
                'postal_code': address.get('kod'),
                'city': address.get('miasto'),
                'voivodeship': address.get('wojewodztwo'),
                'country': address.get('kraj', 'PL')
            })
            self.logger.info(f"🏢 Address processed: {processed_data.get('address')}, {processed_data.get('city')}")
        else:
            self.logger.warning("⚠️ NO 'adresDzialalnosci' found in CEIDG data!")
        
        # KLUCZOWE: DEBUGGING PKD - TU JEST PRAWDOPODOBNIE PROBLEM!
        self.logger.info("📋 DEBUGGING PKD DATA:")
        self.logger.info(f"📋 'pkd' key exists: {'pkd' in company_data}")
        self.logger.info(f"📋 'pkdGlowny' key exists: {'pkdGlowny' in company_data}")
        
        if 'pkd' in company_data:
            pkd_data = company_data['pkd']
            self.logger.info(f"📋 PKD data type: {type(pkd_data)}")
            self.logger.info(f"📋 PKD data value: {json.dumps(pkd_data, ensure_ascii=False)}")
            processed_data['pkd_codes'] = pkd_data
        else:
            self.logger.warning("⚠️ NO 'pkd' found in CEIDG data!")
            processed_data['pkd_codes'] = []
        
        if 'pkdGlowny' in company_data:
            main_pkd = company_data['pkdGlowny']
            self.logger.info(f"📋 Main PKD found: {main_pkd} (type: {type(main_pkd)})")
            processed_data['pkd_main'] = main_pkd
            
            # Szukanie opisu głównego PKD
            if isinstance(company_data.get('pkd'), list):
                self.logger.info(f"📋 Searching for PKD description in list of {len(company_data['pkd'])} items")
                for i, pkd in enumerate(company_data['pkd']):
                    self.logger.info(f"📋 PKD item {i}: {json.dumps(pkd, ensure_ascii=False) if isinstance(pkd, dict) else pkd}")
                    if isinstance(pkd, dict) and pkd.get('kod') == main_pkd:
                        processed_data['industry_desc'] = pkd.get('nazwa')
                        self.logger.info(f"📋 ✅ Found PKD description: {processed_data['industry_desc']}")
                        break
                else:
                    self.logger.warning(f"⚠️ PKD description NOT FOUND for main PKD: {main_pkd}")
            else:
                self.logger.warning(f"⚠️ PKD is not a list, it's: {type(company_data.get('pkd'))}")
        else:
            self.logger.warning("⚠️ NO 'pkdGlowny' found in CEIDG data!")
        
        # DEBUGGING KONTAKT - TELEFON I EMAIL
        self.logger.info("📞 DEBUGGING CONTACT DATA:")
        self.logger.info(f"📞 'telefon' key exists: {'telefon' in company_data}")
        self.logger.info(f"📞 'email' key exists: {'email' in company_data}")
        self.logger.info(f"📞 'www' key exists: {'www' in company_data}")
        
        phone = company_data.get('telefon')
        email = company_data.get('email')
        www = company_data.get('www')
        
        self.logger.info(f"📞 Phone value: {phone} (type: {type(phone)})")
        self.logger.info(f"📞 Email value: {email} (type: {type(email)})")
        self.logger.info(f"📞 WWW value: {www} (type: {type(www)})")
        
        processed_data.update({
            'phone': phone,
            'email': email,
            'www': www
        })
        
        # Pełne dane dla przechowania
        processed_data['full_data'] = company_data
        
        # FINAL LOG - CO ZOSTAŁO PRZETWORZONE
        self.logger.info("✅ FINAL PROCESSED DATA:")
        self.logger.info(f"   company_name: {processed_data.get('company_name')}")
        self.logger.info(f"   nip: {processed_data.get('nip')}")
        self.logger.info(f"   regon: {processed_data.get('regon')}")
        self.logger.info(f"   pkd_main: {processed_data.get('pkd_main')}")
        self.logger.info(f"   industry_desc: {processed_data.get('industry_desc')}")
        self.logger.info(f"   phone: {processed_data.get('phone')}")
        self.logger.info(f"   email: {processed_data.get('email')}")
        self.logger.info(f"   pkd_codes count: {len(processed_data.get('pkd_codes', [])) if isinstance(processed_data.get('pkd_codes'), list) else 'not a list'}")
        
        return processed_data
    
    def _map_status(self, status):
        """Mapuje statusy z CEIDG na polskie nazwy"""
        status_map = {
            'AKTYWNY': 'Aktywna',
            'WYKRESLONY': 'Wykreślona',
            'ZAWIESZONY': 'Zawieszona',
            'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI': 'Oczekuje na rozpoczęcie',
            'WYLACZNIE_W_FORMIE_SPOLKI': 'Wyłącznie w formie spółki'
        }
        return status_map.get(status, status or 'Nieznany')


class KRSIntegrationService(RegisterIntegrationService):
    """
    Klasa serwisowa do obsługi integracji z otwartym API KRS
    """
    def __init__(self):
        super().__init__(register_type='KRS')
        # Otwarte API KRS - brak wymaganego tokenu
        self.api_base_url = "https://api-krs.ms.gov.pl/api/krs"

    def _make_api_request(self, krs, odpis_type="OdpisAktualny", timeout=30):
        """Wykonuje zapytanie do API KRS"""
        url = f"{self.api_base_url}/{odpis_type}/{krs}"
        params = {"rejestr": "P", "format": "json"}
        headers = {"Content-Type": "application/json"}
        start_time = time.time()

        try:
            response = requests.get(url, params=params, headers=headers, timeout=timeout)
            response_time = int((time.time() - start_time) * 1000)

            self._log_api_call(
                operation=odpis_type,
                status="success" if response.status_code == 200 else "error",
                request_params={"krs": krs, **params},
                response_code=response.status_code,
                response_time_ms=response_time,
                error_details=None if response.status_code == 200 else response.text,
            )

            if response.status_code == 200:
                return {'success': True, **response.json()}
            elif response.status_code == 404:
                error_msg = "Nie znaleziono podmiotu w KRS"
                self.logger.warning(error_msg)
                return {"error": error_msg, "success": False}
            else:
                error_msg = f"Błąd API KRS: {response.status_code}"
                self.logger.error(f"{error_msg}: {response.text}")
                return {"error": error_msg, "success": False}

        except requests.RequestException as e:
            response_time = int((time.time() - start_time) * 1000)
            error_msg = f"Błąd połączenia z API KRS: {str(e)}"
            self.logger.error(error_msg)

            self._log_api_call(
                operation=odpis_type,
                status="error",
                request_params={"krs": krs, **params},
                response_time_ms=response_time,
                error_details=str(e),
            )

            return {"error": error_msg, "success": False}

    def search_companies(self, params):
        """
        Wyszukuje firmy w CEIDG zgodnie z dokumentacją API v2
        Endpoint: /firmy
        """
        self.logger.info(f"🔍 DEBUGGING: Starting CEIDG search with params: {params}")
        
        # Mapowanie parametrów zgodnie z dokumentacją CEIDG - WSZYSTKIE JAKO TABLICE
        ceidg_params = {}
        
        # CEIDG wymaga tablic dla parametrów wyszukiwania
        if 'nip' in params:
            # NIP jako tablica zgodnie z dokumentacją: nip[]=value
            ceidg_params['nip[]'] = params['nip']
        
        if 'regon' in params:
            ceidg_params['regon[]'] = params['regon']
            
        if 'company_name' in params:
            # nazwa[] zgodnie z dokumentacją
            ceidg_params['nazwa[]'] = params['company_name']
            
        # Parametry PKD
        if 'pkd_code' in params:
            ceidg_params['pkd[]'] = params['pkd_code']
        
        # Parametry adresowe jako tablice
        if 'miasto' in params:
            ceidg_params['miasto[]'] = params['miasto']
        if 'wojewodztwo' in params:
            ceidg_params['wojewodztwo[]'] = params['wojewodztwo']
        if 'ulica' in params:
            ceidg_params['ulica[]'] = params['ulica']
        if 'kod_pocztowy' in params:
            ceidg_params['kod[]'] = params['kod_pocztowy']
            
        # Parametry dat - format YYYY-MM-DD
        if 'foundation_date_from' in params:
            ceidg_params['dataod'] = params['foundation_date_from']
        if 'foundation_date_to' in params:
            ceidg_params['datado'] = params['foundation_date_to']
            
        # Status jako tablica z mapowaniem zgodnie z dokumentacją
        if 'status' in params:
            status_map = {
                'ACTIVE': 'AKTYWNY',
                'SUSPENDED': 'ZAWIESZONY',
                'CLOSED': 'WYKRESLONY',
                'PENDING': 'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI',
                'COMPANY_ONLY': 'WYLACZNIE_W_FORMIE_SPOLKI'
            }
            mapped_status = status_map.get(params['status'], params['status'])
            ceidg_params['status[]'] = mapped_status
            
        # Paginacja i limit
        limit = min(params.get('limit', 25), 50)  # Maksymalnie 50 zgodnie z dokumentacją
        page = params.get('page', 1)
        
        ceidg_params['page'] = page
        ceidg_params['limit'] = limit
        
        self.logger.info(f"🔍 DEBUGGING: Mapped CEIDG params: {json.dumps(ceidg_params, ensure_ascii=False)}")
        
        # Wykonanie zapytania
        result = self._make_api_request('firmy', ceidg_params, use_test=params.get('use_test', False))
        
        self.logger.info(f"📊 DEBUGGING: CEIDG API result keys: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}")
        
        if not result.get('success', False):
            self.logger.error(f"❌ DEBUGGING: CEIDG API failed: {result.get('error', 'Unknown error')}")
            return result
        
        # Przetwarzanie wyników - zgodnie z dokumentacją pole 'firmy'
        companies = result.get('firmy', [])
        self.logger.info(f"📊 DEBUGGING: CEIDG returned {len(companies)} companies")
        
        # LOG PIERWSZEJ FIRMY BEZPOŚREDNIO Z API
        if companies and len(companies) > 0:
            first_company = companies[0]
            self.logger.info(f"📋 DEBUGGING: First company RAW from CEIDG API:")
            self.logger.info(f"   Keys: {list(first_company.keys()) if isinstance(first_company, dict) else 'Not a dict'}")
            self.logger.info(f"   Full data (first 2000 chars): {json.dumps(first_company, ensure_ascii=False, indent=2)[:2000]}...")
            
            # Sprawdź konkretnie PKD pola
            self.logger.info(f"📋 DEBUGGING: PKD fields check:")
            self.logger.info(f"   'pkd' exists: {'pkd' in first_company}")
            self.logger.info(f"   'pkdGlowny' exists: {'pkdGlowny' in first_company}")
            self.logger.info(f"   'telefon' exists: {'telefon' in first_company}")
            self.logger.info(f"   'email' exists: {'email' in first_company}")
            
            if 'pkd' in first_company:
                self.logger.info(f"   pkd value: {json.dumps(first_company['pkd'], ensure_ascii=False)}")
            if 'pkdGlowny' in first_company:
                self.logger.info(f"   pkdGlowny value: {first_company['pkdGlowny']}")
            if 'telefon' in first_company:
                self.logger.info(f"   telefon value: {first_company['telefon']}")
            if 'email' in first_company:
                self.logger.info(f"   email value: {first_company['email']}")
        
        processed_results = []
        
        for i, company in enumerate(companies):
            self.logger.info(f"🔄 DEBUGGING: Processing company {i+1}/{len(companies)}: {company.get('nazwa', 'Unknown')}")
            processed_company = self._process_company_data(company)
            processed_results.append(processed_company)
            
            # Log processed result for first company
            if i == 0:
                self.logger.info(f"📋 DEBUGGING: First company AFTER processing:")
                self.logger.info(f"   pkd_main: {processed_company.get('pkd_main')}")
                self.logger.info(f"   industry_desc: {processed_company.get('industry_desc')}")
                self.logger.info(f"   phone: {processed_company.get('phone')}")
                self.logger.info(f"   email: {processed_company.get('email')}")
        
        final_result = {
            'success': True,
            'results': processed_results,
            'total': result.get('count', len(processed_results)),
            'page': page,
            'has_next': result.get('links', {}).get('next') is not None
        }
        
        self.logger.info(f"✅ DEBUGGING: CEIDG search completed with {len(processed_results)} processed companies")
        
        return final_result

    def get_company_details(self, identifier_type, identifier_value):
        """Pobiera szczegóły firmy z KRS po numerze KRS"""
        if identifier_type != "krs":
            return {"success": False, "error": "Obsługiwany jest tylko numer KRS"}

        result = self._make_api_request(identifier_value, "OdpisPelny")

        if not result.get('success', False):
            return result

        processed_company = self._process_krs_company_data(result)
        return {"success": True, "company": processed_company}

    def _process_krs_company_data(self, company_data):
        """Przetwarza dane firmy z API KRS"""
        odpis = company_data.get("odpis", {})
        dane = odpis.get("danePodmiotu", {})
        adres = (
            odpis.get("siedzibaIAdres", {}).get("adres", {})
            if isinstance(odpis.get("siedzibaIAdres"), dict)
            else {}
        )

        processed_data = {
            "register_type": "KRS",
            "company_id": dane.get("numerKRS") or dane.get("krs"),
            "nip": dane.get("nip"),
            "regon": dane.get("regon"),
            "company_name": dane.get("nazwa") or dane.get("pelnaNazwa"),
            "legal_form": dane.get("formaPrawna"),
            "status": self._map_krs_status(dane.get("status")),
            "address": adres.get("ulica") or adres.get("adresPelny"),
            "postal_code": adres.get("kodPocztowy"),
            "city": adres.get("miejscowosc"),
            "foundation_date": dane.get("dataRejestracji"),
            "pkd_main": dane.get("pkdPrzewazajace") or dane.get("pkd"),
            "pkd_codes": [],
            "full_data": company_data,
        }

        kontakt = odpis.get("daneKontaktowe", {})
        processed_data.update({
            "phone": kontakt.get("telefon") or kontakt.get("numerTelefonu"),
            "email": kontakt.get("adresEmail") or kontakt.get("email"),
        })

        dzial = odpis.get("dzialalnosci", {})
        if isinstance(dzial, dict):
            pkds = dzial.get("pkd", [])
            if isinstance(pkds, list):
                for pkd in pkds:
                    if pkd.get("przewazajace") or pkd.get("przewazajaca") or pkd.get("przewazajacy"):
                        processed_data["pkd_main"] = pkd.get("kod") or processed_data.get("pkd_main")
                        processed_data["industry_desc"] = pkd.get("nazwa") or pkd.get("opis")
                        break

        return processed_data
    
    def _map_krs_status(self, status):
        """Mapuje statusy KRS"""
        if not status:
            return 'Nieznany'
        return status


class RegisterService:
    """
    Główna klasa serwisowa - fasada dla CEIDG i KRS
    """
    def __init__(self):
        self.ceidg_service = CEIDGIntegrationService()
        self.krs_service = KRSIntegrationService()
        self.logger = register_logger
    
    def search_in_registers(self, params, register_type=None):
        """
        Wyszukuje firmy w rejestrach CEIDG i/lub KRS
        """
        results = []
        errors = []
        sources = []
        
        # Walidacja parametrów
        if not params:
            return {
                'success': False,
                'error': 'Brak parametrów wyszukiwania'
            }
        
        # Wyszukiwanie w CEIDG
        if register_type is None or register_type == 'CEIDG':
            try:
                ceidg_config = RegisterIntegrationConfig.get_config('CEIDG')
                if ceidg_config and ceidg_config.active and ceidg_config.api_key:
                    ceidg_result = self.ceidg_service.search_companies(params)
                    
                    if ceidg_result.get('success', False) and 'results' in ceidg_result:
                        results.extend(ceidg_result['results'])
                        sources.append('CEIDG')
                        self.logger.info(f"CEIDG: Znaleziono {len(ceidg_result['results'])} firm")
                    elif ceidg_result.get('rate_limit_exceeded'):
                        errors.append(f"CEIDG: {ceidg_result['error']}")
                    elif 'error' in ceidg_result:
                        errors.append(f"CEIDG: {ceidg_result['error']}")
                else:
                    errors.append("CEIDG: Integracja nie jest aktywna lub brak konfiguracji")
            except Exception as e:
                error_msg = f"Błąd wyszukiwania w CEIDG: {str(e)}"
                self.logger.error(error_msg)
                errors.append(f"CEIDG: {str(e)}")
        
        # Wyszukiwanie w KRS
        if register_type is None or register_type == 'KRS':
            try:
                if params.get('krs'):
                    krs_result = self.krs_service.search_companies(params)
                    
                    if krs_result.get('success', False) and 'results' in krs_result:
                        results.extend(krs_result['results'])
                        sources.append('KRS')
                        self.logger.info(f"KRS: Znaleziono {len(krs_result['results'])} firm")
                    elif 'error' in krs_result:
                        errors.append(f"KRS: {krs_result['error']}")
                else:
                    errors.append("KRS: Brak numeru KRS")
            except Exception as e:
                error_msg = f"Błąd wyszukiwania w KRS: {str(e)}"
                self.logger.error(error_msg)
                errors.append(f"KRS: {str(e)}")
        
        # Przygotowanie odpowiedzi
        if not sources:
            return {
                'success': False,
                'error': "Brak dostępu do rejestrów: " + ", ".join(errors)
            }
        
        return {
            'success': True,
            'data': results,
            'sources': sources,
            'partial_errors': errors if errors else None,
            'total': len(results)
        }
    
    def get_company_details(self, register_type, identifier_type, identifier_value):
        """
        Pobiera szczegóły firmy z wybranego rejestru
        """
        if not register_type or not identifier_type or not identifier_value:
            return {
                'success': False,
                'error': 'Brak wymaganych parametrów'
            }
        
        try:
            if register_type == 'CEIDG':
                ceidg_config = RegisterIntegrationConfig.get_config('CEIDG')
                if not ceidg_config or not ceidg_config.active or not ceidg_config.api_key:
                    return {
                        'success': False,
                        'error': 'CEIDG nie jest dostępny - sprawdź konfigurację'
                    }
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
            self.logger.error(error_msg)
            return {
                'success': False,
                'error': error_msg
            }
    
    def test_connections(self):
        """
        Testuje połączenia z API rejestrów
        """
        results = {
            'CEIDG': {'success': False, 'message': 'Nie przetestowano'},
            'KRS': {'success': False, 'message': 'Nie przetestowano'}
        }
        
        # Test CEIDG z konfiguracją z bazy danych
        try:
            ceidg_config = RegisterIntegrationConfig.get_config('CEIDG')
            if ceidg_config and ceidg_config.active and ceidg_config.api_key:
                # Test z minimalnym zapytaniem
                test_result = self.ceidg_service._make_api_request(
                    'firmy', {'limit': 1, 'page': 1}, timeout=10, use_test=True
                )
                if test_result.get('success'):
                    results['CEIDG'] = {
                        'success': True,
                        'message': 'Połączenie działa poprawnie',
                        'api_url': self.ceidg_service.api_base_url
                    }
                else:
                    results['CEIDG'] = {
                        'success': False,
                        'message': test_result.get('error', 'Nieznany błąd')
                    }
            else:
                missing = []
                if not ceidg_config:
                    missing.append('brak konfiguracji')
                else:
                    if not ceidg_config.active:
                        missing.append('nieaktywna')
                    if not ceidg_config.api_key:
                        missing.append('brak JWT tokenu')
                
                results['CEIDG'] = {
                    'success': False,
                    'message': f'CEIDG: {", ".join(missing)}'
                }
        except Exception as e:
            results['CEIDG'] = {
                'success': False,
                'message': f"Błąd testu CEIDG: {str(e)}"
            }
        
        # Test KRS
        try:
            test_result = self.krs_service._make_api_request("0000000001", timeout=10)
            if test_result.get('success') or 'nie znaleziono' in test_result.get('error', '').lower():
                # Nawet 404 oznacza że API działa
                results['KRS'] = {
                    'success': True,
                    'message': 'Połączenie działa poprawnie'
                }
            else:
                results['KRS'] = {
                    'success': False,
                    'message': test_result.get('error', 'Nieznany błąd')
                }
        except Exception as e:
            results['KRS'] = {
                'success': False,
                'message': f"Błąd testu KRS: {str(e)}"
            }
        
        return {
            'success': results['CEIDG']['success'] or results['KRS']['success'],
            'results': results
        }