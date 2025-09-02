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
        
        Args:
            filters (dict): Słownik z filtrami
            limit (int): Limit wyników
            offset (int): Offset dla paginacji
            
        Returns:
            Lista firm spełniających kryteria
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
    register_type = db.Column(db.String(20), nullable=False)  # 'CEIDG' lub 'KRS'
    operation = db.Column(db.String(50), nullable=False)  # 'search', 'details', etc.
    status = db.Column(db.String(20), nullable=False)  # 'success', 'error'
    request_params = db.Column(db.Text)  # JSON z parametrami zapytania
    response_code = db.Column(db.Integer)
    response_time_ms = db.Column(db.Integer)
    error_details = db.Column(db.Text)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    ip_address = db.Column(db.String(45))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def __repr__(self):
        return f"<RegisterApiLog {self.register_type} - {self.operation} - {self.status}>"
    
    @classmethod
    def log_api_call(cls, register_type, operation, status, request_params=None, 
                   response_code=None, response_time_ms=None, error_details=None, 
                   user_id=None, ip_address=None):
        """
        Loguje zapytanie do API
        
        Args:
            register_type (str): Typ rejestru ('CEIDG' lub 'KRS')
            operation (str): Rodzaj operacji ('search', 'details', etc.)
            status (str): Status operacji ('success', 'error')
            request_params (dict): Parametry zapytania
            response_code (int): Kod odpowiedzi HTTP
            response_time_ms (int): Czas odpowiedzi w milisekundach
            error_details (str): Szczegóły błędu
            user_id (int): ID użytkownika
            ip_address (str): Adres IP
            
        Returns:
            RegisterApiLog: Utworzony obiekt logu
        """
        api_log = cls(
            register_type=register_type,
            operation=operation,
            status=status,
            request_params=json.dumps(request_params) if request_params else None,
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
            # Log w trybie awaryjnym (nie używamy modelu do logowania błędu modelu)
            import logging
            logger = logging.getLogger('register_module')
            logger.error(f"Error logging API call: {str(e)}")
            
        return api_log


class RegisterIntegrationConfig(db.Model):
    """
    Model dla konfiguracji integracji z API rejestrów
    """
    __tablename__ = 'register_integration_config'
    
    id = db.Column(db.Integer, primary_key=True)
    register_type = db.Column(db.String(20), nullable=False)  # 'CEIDG' lub 'KRS'
    api_key = db.Column(db.String(255))
    api_url = db.Column(db.String(255))
    rate_limit = db.Column(db.Integer, default=100)
    rate_limit_period = db.Column(db.String(10), default='day')
    active = db.Column(db.Boolean, default=True)
    last_sync = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f"<RegisterIntegrationConfig {self.register_type}>"
    
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
            db.session.commit()