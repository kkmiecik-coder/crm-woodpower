import requests
import json
import logging
import time
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
    
    def _check_rate_limit(self):
        """
        Sprawdza limity API dla CEIDG:
        - 50 zapytań w 3 minuty
        - 1000 zapytań w 60 minut
        """
        if not self.config or self.register_type != 'CEIDG':
            return True  # KRS nie ma takich limitów
        
        # CEIDG - sprawdzenie limitów
        three_min_ago = datetime.utcnow() - timedelta(minutes=3)
        three_min_count = RegisterApiLog.query.filter(
            RegisterApiLog.register_type == 'CEIDG',
            RegisterApiLog.created_at >= three_min_ago
        ).count()
    
        hour_ago = datetime.utcnow() - timedelta(minutes=60)
        hour_count = RegisterApiLog.query.filter(
            RegisterApiLog.register_type == 'CEIDG',
            RegisterApiLog.created_at >= hour_ago
        ).count()
    
        if three_min_count >= 50:
            self.logger.warning(f"CEIDG: Przekroczono limit 50 zapytań na 3 minuty ({three_min_count})")
            return False
        
        if hour_count >= 1000:
            self.logger.warning(f"CEIDG: Przekroczono limit 1000 zapytań na godzinę ({hour_count})")
            return False
    
        return True


class CEIDGIntegrationService(RegisterIntegrationService):
    """
    Klasa serwisowa do obsługi integracji z CEIDG API v2
    """
    def __init__(self):
        super().__init__(register_type='CEIDG')
        # URL API zgodne z dokumentacją
        self.api_base_url = "https://dane.biznes.gov.pl/api/ceidg/v2"
        self.test_api_base_url = "https://test-dane.biznes.gov.pl/api/ceidg/v2"
    
    def _make_api_request(self, endpoint, params, timeout=30, use_test=False):
        """
        Wykonuje zapytanie do API CEIDG zgodnie z dokumentacją
        """
        if not self.config:
            error_msg = f"Brak konfiguracji dla rejestru CEIDG"
            self.logger.error(error_msg)
            return {'error': error_msg, 'success': False}
        
        # Sprawdzenie limitu zapytań
        if not self._check_rate_limit():
            error_msg = f"Przekroczono limit zapytań dla CEIDG"
            self.logger.warning(error_msg)
            self._log_api_call(
                operation=endpoint,
                status='error',
                request_params=params,
                error_details=error_msg
            )
            return {'error': error_msg, 'success': False}
        
        # Wybór URL (test vs produkcja)
        base_url = self.test_api_base_url if use_test else self.api_base_url
        url = f"{base_url}/{endpoint}"
        
        # Przygotowanie nagłówków z JWT tokenem
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
                status='success' if response.status_code == 200 else 'error',
                request_params=params,
                response_code=response.status_code,
                response_time_ms=response_time,
                error_details=None if response.status_code == 200 else response.text
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
                return result
            elif response.status_code == 204:
                # Brak danych - zgodnie z dokumentacją
                return {'success': True, 'results': [], 'message': 'Brak danych spełniających kryteria'}
            elif response.status_code == 429:
                error_msg = "Zbyt wiele zapytań - przekroczono limit API CEIDG"
                self.logger.warning(error_msg)
                return {'error': error_msg, 'success': False, 'rate_limit_exceeded': True}
            else:
                error_msg = f"Błąd API CEIDG: {response.status_code} - {response.text}"
                self.logger.error(error_msg)
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
        Endpoint: /firmy
        """
        # Mapowanie parametrów zgodnie z dokumentacją CEIDG
        ceidg_params = {}
        
        # CEIDG wymaga tablic dla niektórych parametrów
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
            
        # Parametry dat - format YYYY-MM-DD
        if 'foundation_date_from' in params:
            ceidg_params['dataod'] = params['foundation_date_from']
        if 'foundation_date_to' in params:
            ceidg_params['datado'] = params['foundation_date_to']
            
        # Status jako tablica
        if 'status' in params:
            # Mapowanie statusów zgodnie z CEIDG
            status_map = {
                'ACTIVE': 'AKTYWNY',
                'SUSPENDED': 'ZAWIESZONY',
                'CLOSED': 'WYKRESLONY',
                'PENDING': 'OCZEKUJE_NA_ROZPOCZECIE_DZIALANOSCI'
            }
            mapped_status = status_map.get(params['status'], params['status'])
            ceidg_params['status[]'] = mapped_status
            
        # Paginacja i limit
        limit = min(params.get('limit', 50), 50)  # Domyślnie 50, maksymalnie 50
        page = params.get('page', 1)
        foundation_date_to = params.get('foundation_date_to')
        foundation_date_to_dt = (
            datetime.strptime(foundation_date_to, "%Y-%m-%d") if foundation_date_to else None
        )

        all_results = []
        next_page = None

        while True:
            ceidg_params['page'] = page
            ceidg_params['limit'] = limit

            result = self._make_api_request('firmy', ceidg_params, use_test=params.get('use_test', False))

            if 'error' in result:
                return result

            companies = result.get('firmy', [])

            if not companies:
                next_page = None
                break

            processed_batch = []
            for company in companies:
                processed_company = self._process_company_data(company)
                processed_batch.append(processed_company)

            all_results.extend(processed_batch)

            # Sprawdzenie daty założenia
            if foundation_date_to_dt:
                dates = [
                    datetime.strptime(c.get('dataRozpoczecia'), "%Y-%m-%d")
                    for c in companies if c.get('dataRozpoczecia')
                ]
                latest_date = max(dates) if dates else None
                if latest_date and latest_date > foundation_date_to_dt:
                    next_page = None
                    break

            page += 1
            next_page = page

        return {
            'success': True,
            'results': all_results,
            'total': len(all_results),
            'page': params.get('page', 1),
            'next_page': next_page
        }
    
    def get_company_details(self, identifier_type, identifier_value):
        """
        Pobiera szczegóły firmy z CEIDG
        Endpoint: /firma lub /firma/{id}
        """
        params = {}
        
        if identifier_type == 'company_id':
            # Bezpośredni endpoint z ID
            endpoint = f"firma/{identifier_value}"
        else:
            # Endpoint z parametrami query
            endpoint = "firma"
            if identifier_type == 'nip':
                params['nip'] = identifier_value
            elif identifier_type == 'regon':
                params['regon'] = identifier_value
            elif identifier_type == 'ids':
                params['ids[]'] = identifier_value
        
        result = self._make_api_request(endpoint, params)
        
        if 'error' in result:
            return result
        
        # Przetwarzanie wyniku
        if 'firma' in result and result['firma']:
            # CEIDG zwraca tablicę firm nawet dla jednej firmy
            company_data = result['firma'][0] if isinstance(result['firma'], list) else result['firma']
            processed_company = self._process_company_data(company_data)
            return {
                'success': True,
                'company': processed_company
            }
        else:
            return {
                'success': False,
                'error': 'Nie znaleziono firmy w CEIDG'
            }
    
    def _process_company_data(self, company_data):
        """
        Przetwarza dane firmy z CEIDG zgodnie ze strukturą API v2
        """
        # Podstawowe dane
        processed_data = {
            'register_type': 'CEIDG',
            'company_id': company_data.get('id'),
            'company_name': company_data.get('nazwa'),
            'status': self._map_status(company_data.get('status')),
            'foundation_date': company_data.get('dataRozpoczecia'),
            'last_update_date': None,  # CEIDG nie zwraca tej informacji bezpośrednio
        }
        
        # Dane właściciela
        if 'wlasciciel' in company_data:
            owner = company_data['wlasciciel']
            processed_data.update({
                'nip': owner.get('nip'),
                'regon': owner.get('regon'),
                'owner_name': f"{owner.get('imie', '')} {owner.get('nazwisko', '')}".strip()
            })
        
        # Adres działalności
        if 'adresDzialalnosci' in company_data:
            address = company_data['adresDzialalnosci']
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
                'voivodeship': address.get('wojewodztwo')
            })
        
        # Kody PKD
        if 'pkd' in company_data:
            processed_data['pkd_codes'] = company_data['pkd']
        if 'pkdGlowny' in company_data:
            processed_data['pkd_main'] = company_data['pkdGlowny']
            if isinstance(company_data.get('pkd'), list):
                for pkd in company_data['pkd']:
                    if pkd.get('kod') == company_data['pkdGlowny']:
                        processed_data['industry_desc'] = pkd.get('nazwa')
                        break
            
        # Kontakt
        processed_data.update({
            'phone': company_data.get('telefon'),
            'email': company_data.get('email'),
            'www': company_data.get('www')
        })
        
        # Pełne dane dla przechowania
        processed_data['full_data'] = company_data
        
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
        return status_map.get(status, status)


class KRSIntegrationService(RegisterIntegrationService):
    """
    Klasa serwisowa do obsługi integracji z otwartym API KRS
    """
    def __init__(self):
        super().__init__(register_type='KRS')
        # Otwarte API KRS - brak wymaganego tokenu
        self.api_base_url = "https://api-krs.ms.gov.pl/api/krs"

    def _make_api_request(self, krs, odpis_type="OdpisAktualny", timeout=30):
        """Wykonuje zapytanie do API KRS (MS.gov)"""
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
                return response.json()
            elif response.status_code == 404:
                error_msg = "Nie znaleziono podmiotu w KRS"
                self.logger.warning(error_msg)
                return {"error": error_msg, "success": False}
            elif 500 <= response.status_code < 600:
                error_msg = f"Błąd serwera API KRS: {response.status_code}"
                self.logger.error(error_msg)
                return {"error": error_msg, "success": False}
            else:
                error_msg = f"Błąd API KRS: {response.status_code} - {response.text}"
                self.logger.error(error_msg)
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
        """Wyszukuje firmę w KRS po numerze KRS"""
        krs_number = params.get("krs") if params else None
        if not krs_number:
            return {"success": False, "error": "Brak numeru KRS"}

        result = self._make_api_request(krs_number, "OdpisAktualny")

        if "error" in result:
            return result

        processed_company = self._process_krs_company_data(result)

        return {
            "success": True,
            "results": [processed_company] if processed_company else [],
            "total": 1 if processed_company else 0,
        }

    def get_company_details(self, identifier_type, identifier_value):
        """Pobiera szczegóły firmy z KRS po numerze KRS"""
        if identifier_type != "krs":
            return {"success": False, "error": "Obsługiwany jest tylko numer KRS"}

        result = self._make_api_request(identifier_value, "OdpisPelny")

        if "error" in result:
            return result

        processed_company = self._process_krs_company_data(result)
        return {"success": True, "company": processed_company}

    def _process_krs_company_data(self, company_data):
        """Przetwarza dane firmy z API KRS"""
        odpis = company_data.get("odpis", {})
        dane = odpis.get("danePodmiotu", {})
        adres = (
            odpis.get("siedzibaIAdres", {})
            .get("adres", {})
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
                if ceidg_config and ceidg_config.active:
                    ceidg_result = self.ceidg_service.search_companies(params)
                    
                    if ceidg_result.get('success', False) and 'results' in ceidg_result:
                        results.extend(ceidg_result['results'])
                        sources.append('CEIDG')
                        self.logger.info(f"CEIDG: Znaleziono {len(ceidg_result['results'])} firm")
                    elif 'error' in ceidg_result:
                        errors.append(f"CEIDG: {ceidg_result['error']}")
                else:
                    errors.append("Integracja z CEIDG nie jest aktywna")
            except Exception as e:
                error_msg = f"Błąd wyszukiwania w CEIDG: {str(e)}"
                self.logger.error(error_msg)
                errors.append(f"CEIDG: {str(e)}")
        
        # Wyszukiwanie w KRS
        if register_type is None or register_type == 'KRS':
            try:
                # KRS nie wymaga konfiguracji tokenu
                krs_result = self.krs_service.search_companies(params)
                
                if krs_result.get('success', False) and 'results' in krs_result:
                    results.extend(krs_result['results'])
                    sources.append('KRS')
                    self.logger.info(f"KRS: Znaleziono {len(krs_result['results'])} firm")
                elif 'error' in krs_result:
                    errors.append(f"KRS: {krs_result['error']}")
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
        
        # Test CEIDG z ponownymi próbami i krótszym timeoutem
        try:
            ceidg_config = RegisterIntegrationConfig.get_config('CEIDG')
            if ceidg_config and ceidg_config.active:
                last_error = None
                for attempt in range(3):
                    test_result = self.ceidg_service._make_api_request(
                        'firmy', {'limit': 1, 'page': 1}, timeout=5
                    )
                    if 'error' not in test_result:
                        results['CEIDG'] = {
                            'success': True,
                            'message': 'Połączenie działa poprawnie'
                        }
                        break
                    last_error = test_result['error']
                    time.sleep(1)
                if not results['CEIDG']['success']:
                    results['CEIDG'] = {
                        'success': False,
                        'message': last_error or 'Nieznany błąd'
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
        
        # Test KRS z obsługą błędów
        try:
            test_result = self.krs_service._make_api_request("0000000001")

            if 'error' not in test_result:
                results['KRS'] = {
                    'success': True,
                    'message': 'Połączenie działa poprawnie'
                }
            else:
                results['KRS'] = {
                    'success': False,
                    'message': test_result['error']
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