from extensions import db
from datetime import datetime
import json

class RegisterCompany(db.Model):
    """
    Model dla firm pobranych z rejestrów CEIDG/KRS
    """
    __tablename__ = 'register_companies'
    
    id = db.Column(db.Integer, primary_key=True)
    register_type = db.Column(db.String(20), nullable=False, index=True)  # 'CEIDG' lub 'KRS'
    company_id = db.Column(db.String(50))  # ID firmy w rejestrze
    nip = db.Column(db.String(20), unique=True, index=True)
    regon = db.Column(db.String(20), index=True)
    company_name = db.Column(db.String(255), index=True)
    address = db.Column(db.String(255))
    postal_code = db.Column(db.String(10))
    city = db.Column(db.String(100))
    legal_form = db.Column(db.String(100))
    status = db.Column(db.String(50), index=True)
    pkd_main = db.Column(db.String(10), index=True)  # Główny kod PKD
    pkd_codes = db.Column(db.Text)  # JSON z kodami PKD
    industry_desc = db.Column(db.String(255))
    phone = db.Column(db.String(50))
    email = db.Column(db.String(255))
    foundation_date = db.Column(db.Date, index=True)
    last_update_date = db.Column(db.Date)
    full_data = db.Column(db.Text)  # JSON z pełnymi danymi
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    
    def __repr__(self):
        return f"<RegisterCompany {self.nip} - {self.company_name}>"
    
    def to_dict(self):
        """Konwertuje model do słownika (JSON)"""
        return {
            'id': self.id,
            'register_type': self.register_type,
            'company_id': self.company_id,
            'nip': self.nip,
            'regon': self.regon,
            'company_name': self.company_name,
            'address': self.address,
            'postal_code': self.postal_code,
            'city': self.city,
            'legal_form': self.legal_form,
            'status': self.status,
            'pkd_main': self.pkd_main,
            'pkd_codes': json.loads(self.pkd_codes) if self.pkd_codes else [],
            'industry_desc': self.industry_desc,
            'phone': self.phone,
            'email': self.email,
            'foundation_date': self.foundation_date.strftime('%Y-%m-%d') if self.foundation_date else None,
            'last_update_date': self.last_update_date.strftime('%Y-%m-%d') if self.last_update_date else None,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'updated_at': self.updated_at.strftime('%Y-%m-%d %H:%M:%S')
        }
    
    @classmethod
    def get_by_nip(cls, nip):
        """Pobiera firmę po NIP"""
        return cls.query.filter_by(nip=nip).first()
    
    @classmethod
    def get_by_regon(cls, regon):
        """Pobiera firmę po REGON"""
        return cls.query.filter_by(regon=regon).first()
    
    @classmethod
    def search(cls, filters=None, limit=50, offset=0):
        """
        Wyszukuje firmy według podanych filtrów
        """
        if not filters:
            filters = {}
            
        query = cls.query
        
        # Filtrowanie po typie rejestru
        if 'register_type' in filters:
            query = query.filter(cls.register_type == filters['register_type'])
            
        # Filtrowanie po NIP
        if 'nip' in filters:
            query = query.filter(cls.nip.like(f"%{filters['nip']}%"))
            
        # Filtrowanie po REGON
        if 'regon' in filters:
            query = query.filter(cls.regon.like(f"%{filters['regon']}%"))
            
        # Filtrowanie po nazwie
        if 'company_name' in filters:
            query = query.filter(cls.company_name.like(f"%{filters['company_name']}%"))
            
        # Filtrowanie po PKD
        if 'pkd_code' in filters:
            query = query.filter(cls.pkd_main == filters['pkd_code'])
            
        # Filtrowanie po dacie utworzenia
        if 'foundation_date_from' in filters:
            query = query.filter(cls.foundation_date >= filters['foundation_date_from'])
            
        if 'foundation_date_to' in filters:
            query = query.filter(cls.foundation_date <= filters['foundation_date_to'])
            
        # Filtrowanie po statusie
        if 'status' in filters:
            query = query.filter(cls.status == filters['status'])
            
        # Sortowanie
        sort_by = filters.get('sort_by', 'company_name')
        sort_dir = filters.get('sort_dir', 'asc')
        
        if hasattr(cls, sort_by):
            column = getattr(cls, sort_by)
            if sort_dir.lower() == 'desc':
                query = query.order_by(column.desc())
            else:
                query = query.order_by(column.asc())
        
        # Wykonanie zapytania z limitem i offsetem
        return query.limit(limit).offset(offset).all()

    def save_company(self, company_data, update_existing=False):
        """
        Zapisuje dane firmy do bazy z walidacją
        """
        # Walidacja podstawowa
        if not company_data.get('nip'):
            return False, None, "Brak wymaganego pola NIP"
        
        if not company_data.get('company_name'):
            return False, None, "Brak wymaganego pola nazwa firmy"
        
        try:
            # Sprawdzenie czy firma już istnieje
            existing_company = self.get_by_nip(company_data['nip'])
            
            if existing_company:
                if update_existing:
                    # Aktualizacja istniejącej firmy
                    self._update_company_fields(existing_company, company_data)
                    db.session.commit()
                    return True, existing_company, "Zaktualizowano istniejącą firmę"
                else:
                    return False, existing_company, "Firma już istnieje w bazie"
            else:
                # Tworzenie nowej firmy
                new_company = self._create_new_company(company_data)
                db.session.add(new_company)
                db.session.commit()
                return True, new_company, "Zapisano nową firmę"
                
        except Exception as e:
            db.session.rollback()
            return False, None, f"Błąd podczas zapisywania firmy: {str(e)}"
    
    def _update_company_fields(self, existing_company, company_data):
        """Aktualizuje pola istniejącej firmy"""
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
        existing_company.industry_desc = company_data.get('industry_desc', existing_company.industry_desc)
        existing_company.phone = company_data.get('phone', existing_company.phone)
        existing_company.email = company_data.get('email', existing_company.email)

        # Aktualizacja kodów PKD
        if 'pkd_codes' in company_data:
            existing_company.pkd_codes = json.dumps(company_data['pkd_codes'])
        
        # Aktualizacja dat
        self._update_dates(existing_company, company_data)
        
        # Aktualizacja pełnych danych
        if 'full_data' in company_data:
            existing_company.full_data = json.dumps(company_data['full_data'])
    
    def _create_new_company(self, company_data):
        """Tworzy nową firmę"""
        from flask import session
        
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
            phone=company_data.get('phone'),
            email=company_data.get('email'),
            full_data=json.dumps(company_data.get('full_data', {})),
            created_by=session.get('user_id') if session else None
        )
        
        # Obsługa dat
        self._update_dates(new_company, company_data)
        
        return new_company
    
    def _update_dates(self, company, company_data):
        """Aktualizuje daty w obiekcie firmy"""
        # Lista obsługiwanych formatów dat zgodnie z CEIDG
        date_formats = ['%Y-%m-%d', '%Y-%m-%d %H:%M:%S', '%d-%m-%Y', '%d.%m.%Y']
    
        if 'foundation_date' in company_data and company_data['foundation_date']:
            try:
                if isinstance(company_data['foundation_date'], str):
                    parsed_date = None
                    for fmt in date_formats:
                        try:
                            parsed_date = datetime.strptime(company_data['foundation_date'], fmt).date()
                            break
                        except ValueError:
                            continue
                    if parsed_date:
                        company.foundation_date = parsed_date
                else:
                    company.foundation_date = company_data['foundation_date']
            except (ValueError, TypeError):
                pass  # Ignorowanie nieprawidłowej daty
    
        if 'last_update_date' in company_data and company_data['last_update_date']:
            try:
                if isinstance(company_data['last_update_date'], str):
                    parsed_date = None
                    for fmt in date_formats:
                        try:
                            parsed_date = datetime.strptime(company_data['last_update_date'], fmt).date()
                            break
                        except ValueError:
                            continue
                    if parsed_date:
                        company.last_update_date = parsed_date
                else:
                    company.last_update_date = company_data['last_update_date']
            except (ValueError, TypeError):
                pass  # Ignorowanie nieprawidłowej daty


class RegisterPkdCode(db.Model):
    """
    Model dla kodów PKD (słownik)
    """
    __tablename__ = 'register_pkd_codes'
    
    id = db.Column(db.Integer, primary_key=True)
    pkd_code = db.Column(db.String(10), unique=True, nullable=False)
    pkd_name = db.Column(db.String(255), nullable=False)
    pkd_category = db.Column(db.String(100))
    pkd_section = db.Column(db.String(5))
    is_common = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<RegisterPkdCode {self.pkd_code} - {self.pkd_name}>"
    
    def to_dict(self):
        """Konwertuje model do słownika (JSON)"""
        return {
            'id': self.id,
            'pkd_code': self.pkd_code,
            'pkd_name': self.pkd_name,
            'pkd_category': self.pkd_category,
            'pkd_section': self.pkd_section,
            'is_common': self.is_common
        }
    
    @classmethod
    def get_common_codes(cls):
        """Pobiera popularne kody PKD"""
        return cls.query.filter_by(is_common=True).order_by(cls.pkd_code).all()
    
    @classmethod
    def search(cls, search_term=None, section=None, only_common=False):
        """Wyszukuje kody PKD"""
        query = cls.query
        
        if only_common:
            query = query.filter_by(is_common=True)
            
        if section:
            query = query.filter_by(pkd_section=section)
            
        if search_term:
            query = query.filter(
                db.or_(
                    cls.pkd_code.like(f"%{search_term}%"),
                    cls.pkd_name.like(f"%{search_term}%")
                )
            )
            
        return query.order_by(cls.pkd_code).all()


class RegisterApiLog(db.Model):
    """
    Model dla logów zapytań API
    """
    __tablename__ = 'register_api_logs'
    
    id = db.Column(db.Integer, primary_key=True)
    register_type = db.Column(db.String(20), nullable=False, index=True)  # 'CEIDG' lub 'KRS'
    operation = db.Column(db.String(50), nullable=False)  # 'search', 'details', etc.
    status = db.Column(db.String(20), nullable=False, index=True)  # 'success', 'error'
    request_params = db.Column(db.Text)  # JSON z parametrami zapytania
    response_code = db.Column(db.Integer)
    response_time_ms = db.Column(db.Integer)
    error_details = db.Column(db.Text)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    ip_address = db.Column(db.String(45))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    
    def __repr__(self):
        return f"<RegisterApiLog {self.register_type} - {self.operation} - {self.status}>"
    
    def to_dict(self):
        """Konwertuje model do słownika (JSON)"""
        return {
            'id': self.id,
            'register_type': self.register_type,
            'operation': self.operation,
            'status': self.status,
            'response_code': self.response_code,
            'response_time_ms': self.response_time_ms,
            'error_details': self.error_details,
            'user_id': self.user_id,
            'ip_address': self.ip_address,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S')
        }
    
    @classmethod
    def log_api_call(cls, register_type, operation, status, request_params=None, 
                   response_code=None, response_time_ms=None, error_details=None, 
                   user_id=None, ip_address=None):
        """
        Loguje zapytanie do API z obsługą rate limiting CEIDG
        """
        # Skróć długie error_details dla CEIDG (często zawierają HTML)
        if error_details and len(error_details) > 1000:
            error_details = error_details[:997] + "..."
    
        api_log = cls(
            register_type=register_type,
            operation=operation,
            status=status,
            request_params=json.dumps(request_params, ensure_ascii=False) if request_params else None,
            response_code=response_code,
            response_time_ms=response_time_ms,
            error_details=error_details,
            user_id=user_id,
            ip_address=ip_address
        )
    
        db.session.add(api_log)
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            # Fallback do logowania przez standardowy logger
            import logging
            logger = logging.getLogger('register_module')
            logger.error(f"Error logging API call: {str(e)}")
        
        return api_log

    @classmethod
    def get_recent_logs(cls, register_type=None, limit=100):
        """Pobiera najnowsze logi"""
        query = cls.query
        
        if register_type:
            query = query.filter_by(register_type=register_type)
            
        return query.order_by(cls.created_at.desc()).limit(limit).all()
    
    @classmethod
    def get_stats(cls, register_type=None, days=7):
        """Pobiera statystyki API"""
        from datetime import timedelta
        
        start_date = datetime.utcnow() - timedelta(days=days)
        query = cls.query.filter(cls.created_at >= start_date)
        
        if register_type:
            query = query.filter_by(register_type=register_type)
        
        total_calls = query.count()
        success_calls = query.filter_by(status='success').count()
        error_calls = query.filter_by(status='error').count()
        
        avg_response_time = db.session.query(
            db.func.avg(cls.response_time_ms)
        ).filter(
            cls.created_at >= start_date,
            cls.response_time_ms.isnot(None)
        )
        
        if register_type:
            avg_response_time = avg_response_time.filter_by(register_type=register_type)
            
        avg_response_time = avg_response_time.scalar() or 0
        
        return {
            'total_calls': total_calls,
            'success_calls': success_calls,
            'error_calls': error_calls,
            'success_rate': (success_calls / total_calls * 100) if total_calls > 0 else 0,
            'avg_response_time_ms': round(avg_response_time, 2)
        }


class RegisterIntegrationConfig(db.Model):
    """
    Model dla konfiguracji integracji z API rejestrów
    """
    __tablename__ = 'register_integration_config'
    
    id = db.Column(db.Integer, primary_key=True)
    register_type = db.Column(db.String(20), nullable=False, unique=True)  # 'CEIDG' lub 'KRS'
    api_key = db.Column(db.String(500))  # JWT token dla CEIDG
    api_url = db.Column(db.String(255))
    rate_limit = db.Column(db.Integer, default=100)
    rate_limit_period = db.Column(db.String(10), default='day')
    active = db.Column(db.Boolean, default=True, index=True)
    last_sync = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<RegisterIntegrationConfig {self.register_type}>"
    
    def to_dict(self):
        """Konwertuje model do słownika (JSON) - bez wrażliwych danych"""
        return {
            'id': self.id,
            'register_type': self.register_type,
            'api_url': self.api_url,
            'rate_limit': self.rate_limit,
            'rate_limit_period': self.rate_limit_period,
            'active': self.active,
            'last_sync': self.last_sync.strftime('%Y-%m-%d %H:%M:%S') if self.last_sync else None,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'updated_at': self.updated_at.strftime('%Y-%m-%d %H:%M:%S')
        }
    
    @classmethod
    def get_config(cls, register_type):
        """Pobiera konfigurację dla danego rejestru"""
        return cls.query.filter_by(register_type=register_type).first()
    
    @classmethod
    def update_last_sync(cls, register_type):
        """Aktualizuje datę ostatniej synchronizacji"""
        config = cls.get_config(register_type)
        if config:
            config.last_sync = datetime.utcnow()
            try:
                db.session.commit()
            except:
                db.session.rollback()
    
    @classmethod
    def is_active(cls, register_type):
        """Sprawdza czy integracja jest aktywna"""
        config = cls.get_config(register_type)
        return config and config.active
    
    def validate_config(self):
        """Waliduje konfigurację zgodnie z wymaganiami API"""
        errors = []
    
        if self.register_type == 'CEIDG':
            if not self.api_key:
                errors.append("CEIDG wymaga JWT tokenu")
            else:
                # Podstawowa walidacja formatu JWT
                token_parts = self.api_key.split('.')
                if len(token_parts) != 3:
                    errors.append("JWT token musi mieć format: header.payload.signature")
                
            if not self.api_url:
                errors.append("Brak URL API dla CEIDG")
            else:
                if 'ceidg' not in self.api_url.lower():
                    errors.append("URL API powinien wskazywać na endpoint CEIDG")
            
        if self.register_type == 'KRS':
            if not self.api_url:
                errors.append("Brak URL API dla KRS")
            else:
                if 'krs' not in self.api_url.lower():
                    errors.append("URL API powinien wskazywać na endpoint KRS")
    
        return len(errors) == 0, errors