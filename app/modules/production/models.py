# modules/production/models.py
"""
Modele SQLAlchemy dla modułu Production
========================================

Definiuje wszystkie tabele bazy danych dla systemu zarządzania produkcją:
- ProductionItem - główna tabela produktów z nowym formatem ID
- ProductionOrderCounter - liczniki numerów zamówień per rok
- ProductionPriorityConfig - konfiguracja systemu priorytetów
- ProductionSyncLog - logi synchronizacji z Baselinker
- ProductionError - rejestr błędów systemu
- ProductionConfig - konfiguracja modułu

Autor: Konrad Kmiecik
Wersja: 1.2 (Finalna - z zabezpieczeniami)
Data: 2025-01-08
"""

from datetime import datetime, date
from sqlalchemy import Column, Integer, String, Text, DateTime, Date, Decimal, Enum, Boolean, JSON, ForeignKey
from sqlalchemy.orm import relationship, validates
from sqlalchemy.sql import func
from app import db
from modules.logging import get_structured_logger

logger = get_structured_logger('production.models')

class ProductionOrderCounter(db.Model):
    """
    Liczniki numerów zamówień produkcyjnych per rok
    Zapewnia unikalne numerowanie w formacie YY_NNNNN
    """
    __tablename__ = 'prod_order_counters'
    
    id = Column(Integer, primary_key=True)
    year = Column(Integer, nullable=False, unique=True)
    current_counter = Column(Integer, default=0, nullable=False)
    last_updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<ProductionOrderCounter {self.year}: {self.current_counter}>'
    
    @classmethod
    def get_next_counter(cls, year=None):
        """
        Pobiera i inkrementuje licznik dla podanego roku
        
        Args:
            year (int, optional): Rok dla którego pobrać licznik. Domyślnie aktualny rok.
            
        Returns:
            int: Następny numer w sekwencji
        """
        if year is None:
            year = datetime.now().year
            
        counter = cls.query.filter_by(year=year).first()
        if not counter:
            counter = cls(year=year, current_counter=0)
            db.session.add(counter)
            
        counter.current_counter += 1
        counter.last_updated_at = datetime.utcnow()
        
        db.session.commit()
        
        logger.info("Wygenerowano nowy licznik", extra={
            'year': year,
            'counter': counter.current_counter
        })
        
        return counter.current_counter

class ProductionItem(db.Model):
    """
    Główna tabela produktów w systemie produkcyjnym
    Każdy rekord reprezentuje pojedynczy produkt z unikalnym ID w formacie YY_NNNNN_S
    """
    __tablename__ = 'prod_items'
    
    id = Column(Integer, primary_key=True)
    
    # IDENTYFIKATORY SYSTEMU
    short_product_id = Column(String(10), unique=True, nullable=False, index=True)
    internal_order_number = Column(String(8), nullable=False, index=True)
    product_sequence_in_order = Column(Integer, nullable=False)
    
    # DANE BASELINKER
    baselinker_order_id = Column(Integer, nullable=False, index=True)
    baselinker_product_id = Column(String(50))
    original_product_name = Column(Text, nullable=False)
    baselinker_status_id = Column(Integer)
    
    # DANE PRODUKTU (PARSOWANE)
    parsed_wood_species = Column(String(50))
    parsed_technology = Column(String(50))
    parsed_wood_class = Column(String(10))
    parsed_length_cm = Column(Decimal(10, 2))
    parsed_width_cm = Column(Decimal(10, 2))
    parsed_thickness_cm = Column(Decimal(10, 2))
    parsed_finish_state = Column(String(50))
    
    # KALKULACJE BIZNESOWE
    volume_m3 = Column(Decimal(10, 4))
    unit_price_net = Column(Decimal(10, 2))
    total_value_net = Column(Decimal(10, 2))
    
    # STATUS PRODUKCJI
    current_status = Column(Enum(
        'czeka_na_wyciecie',
        'czeka_na_skladanie',
        'czeka_na_pakowanie', 
        'spakowane',
        'anulowane',
        'wstrzymane',
        name='production_status'
    ), default='czeka_na_wyciecie', nullable=False, index=True)
    
    # PRIORYTETY I PLANOWANIE
    priority_score = Column(Integer, default=100, index=True)
    deadline_date = Column(Date, index=True)
    days_until_deadline = Column(Integer)
    
    # ŚLEDZENIE CZASU WYKONANIA - WYCINANIE
    cutting_started_at = Column(DateTime)
    cutting_completed_at = Column(DateTime, index=True)
    cutting_duration_minutes = Column(Integer)
    cutting_assigned_worker_id = Column(Integer, ForeignKey('users.id'))
    
    # ŚLEDZENIE CZASU WYKONANIA - SKŁADANIE
    assembly_started_at = Column(DateTime)
    assembly_completed_at = Column(DateTime, index=True)
    assembly_duration_minutes = Column(Integer)
    assembly_assigned_worker_id = Column(Integer, ForeignKey('users.id'))
    
    # ŚLEDZENIE CZASU WYKONANIA - PAKOWANIE
    packaging_started_at = Column(DateTime)
    packaging_completed_at = Column(DateTime, index=True)
    packaging_duration_minutes = Column(Integer)
    packaging_assigned_worker_id = Column(Integer, ForeignKey('users.id'))
    
    # UWAGI I PROBLEMY
    production_notes = Column(Text)
    quality_issues = Column(Text)
    
    # METADANE
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    sync_source = Column(Enum('baselinker_auto', 'manual_entry', name='sync_source'), 
                        default='baselinker_auto')
    
    # RELACJE
    cutting_worker = relationship("User", foreign_keys=[cutting_assigned_worker_id])
    assembly_worker = relationship("User", foreign_keys=[assembly_assigned_worker_id])  
    packaging_worker = relationship("User", foreign_keys=[packaging_assigned_worker_id])
    
    def __repr__(self):
        return f'<ProductionItem {self.short_product_id}: {self.current_status}>'
    
    @validates('short_product_id')
    def validate_product_id(self, key, product_id):
        """Walidacja formatu Product ID: YY_NNNNN_S"""
        import re
        pattern = r'^\d{2}_\d{5}_\d+$'
        if not re.match(pattern, product_id):
            raise ValueError(f"Product ID musi być w formacie YY_NNNNN_S, otrzymano: {product_id}")
        return product_id
    
    @property
    def is_overdue(self):
        """Sprawdza czy produkt przekroczył deadline"""
        if not self.deadline_date:
            return False
        return date.today() > self.deadline_date
    
    @property
    def status_display_name(self):
        """Nazwa statusu do wyświetlania"""
        status_names = {
            'czeka_na_wyciecie': 'Czeka na wycięcie',
            'czeka_na_skladanie': 'Czeka na składanie',
            'czeka_na_pakowanie': 'Czeka na pakowanie',
            'spakowane': 'Spakowane',
            'anulowane': 'Anulowane',
            'wstrzymane': 'Wstrzymane'
        }
        return status_names.get(self.current_status, self.current_status)
    
    @property
    def priority_level(self):
        """Poziom priorytetu jako tekst"""
        if self.priority_score >= 200:
            return 'Krytyczny'
        elif self.priority_score >= 150:
            return 'Wysoki'
        elif self.priority_score >= 100:
            return 'Normalny'
        else:
            return 'Niski'
    
    @property
    def total_production_time_minutes(self):
        """Całkowity czas produkcji w minutach"""
        total = 0
        if self.cutting_duration_minutes:
            total += self.cutting_duration_minutes
        if self.assembly_duration_minutes:
            total += self.assembly_duration_minutes
        if self.packaging_duration_minutes:
            total += self.packaging_duration_minutes
        return total
    
    def update_deadline_days(self):
        """Aktualizuje liczbę dni do deadline"""
        if self.deadline_date:
            self.days_until_deadline = (self.deadline_date - date.today()).days
    
    def start_task(self, station_code, worker_id=None):
        """
        Rozpoczyna zadanie na określonym stanowisku
        
        Args:
            station_code (str): Kod stanowiska ('cutting', 'assembly', 'packaging')
            worker_id (int, optional): ID pracownika
        """
        now = datetime.utcnow()
        
        if station_code == 'cutting':
            self.cutting_started_at = now
            if worker_id:
                self.cutting_assigned_worker_id = worker_id
        elif station_code == 'assembly':
            self.assembly_started_at = now
            if worker_id:
                self.assembly_assigned_worker_id = worker_id
        elif station_code == 'packaging':
            self.packaging_started_at = now
            if worker_id:
                self.packaging_assigned_worker_id = worker_id
                
        logger.info("Rozpoczęto zadanie", extra={
            'product_id': self.short_product_id,
            'station': station_code,
            'worker_id': worker_id
        })
    
    def complete_task(self, station_code):
        """
        Oznacza zadanie jako ukończone i aktualizuje status
        
        Args:
            station_code (str): Kod stanowiska
        """
        now = datetime.utcnow()
        
        if station_code == 'cutting':
            self.cutting_completed_at = now
            if self.cutting_started_at:
                self.cutting_duration_minutes = int(
                    (now - self.cutting_started_at).total_seconds() / 60
                )
            self.current_status = 'czeka_na_skladanie'
            
        elif station_code == 'assembly':
            self.assembly_completed_at = now
            if self.assembly_started_at:
                self.assembly_duration_minutes = int(
                    (now - self.assembly_started_at).total_seconds() / 60
                )
            self.current_status = 'czeka_na_pakowanie'
            
        elif station_code == 'packaging':
            self.packaging_completed_at = now
            if self.packaging_started_at:
                self.packaging_duration_minutes = int(
                    (now - self.packaging_started_at).total_seconds() / 60
                )
            self.current_status = 'spakowane'
        
        self.updated_at = now
        
        logger.info("Ukończono zadanie", extra={
            'product_id': self.short_product_id,
            'station': station_code,
            'new_status': self.current_status,
            'duration_minutes': getattr(self, f'{station_code}_duration_minutes')
        })

class ProductionPriorityConfig(db.Model):
    """
    Konfiguracja systemu priorytetów dla produktów
    Pozwala na elastyczne zarządzanie regułami priorytetyzacji
    """
    __tablename__ = 'prod_priority_config'
    
    id = Column(Integer, primary_key=True)
    config_name = Column(String(100), nullable=False)
    criteria_json = Column(JSON, nullable=False)
    weight_percentage = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=True, index=True)
    display_order = Column(Integer, default=0, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<ProductionPriorityConfig {self.config_name}: {self.weight_percentage}%>'
    
    @validates('weight_percentage')
    def validate_weight(self, key, weight):
        """Walidacja wagi procentowej"""
        if not 0 <= weight <= 100:
            raise ValueError("Waga musi być między 0 a 100")
        return weight

class ProductionSyncLog(db.Model):
    """
    Logi synchronizacji z systemem Baselinker
    Śledzenie operacji automatycznej synchronizacji danych
    """
    __tablename__ = 'prod_sync_logs'
    
    id = Column(Integer, primary_key=True)
    sync_type = Column(Enum('cron_auto', 'manual_trigger', name='sync_type'), nullable=False)
    sync_started_at = Column(DateTime, nullable=False, index=True)
    sync_completed_at = Column(DateTime)
    sync_duration_seconds = Column(Integer)
    
    # STATYSTYKI SYNC
    orders_fetched = Column(Integer, default=0)
    products_created = Column(Integer, default=0)
    products_updated = Column(Integer, default=0)
    products_skipped = Column(Integer, default=0)
    
    # STATUS I BŁĘDY
    sync_status = Column(Enum('running', 'completed', 'failed', 'partial', name='sync_status'), 
                        default='running', index=True)
    error_count = Column(Integer, default=0)
    error_details = Column(Text)
    
    # METADANE
    baselinker_api_response_time_ms = Column(Integer)
    processed_status_ids = Column(Text)
    total_memory_usage_mb = Column(Decimal(10, 2))
    
    def __repr__(self):
        return f'<ProductionSyncLog {self.sync_type} {self.sync_started_at}: {self.sync_status}>'
    
    @property
    def success_rate(self):
        """Wskaźnik sukcesu synchronizacji"""
        total_processed = self.products_created + self.products_updated + self.products_skipped
        if total_processed == 0:
            return 0
        return ((self.products_created + self.products_updated) / total_processed) * 100
    
    def mark_completed(self):
        """Oznacza synchronizację jako ukończoną"""
        self.sync_completed_at = datetime.utcnow()
        if self.sync_started_at:
            self.sync_duration_seconds = int(
                (self.sync_completed_at - self.sync_started_at).total_seconds()
            )
        
        if self.error_count == 0:
            self.sync_status = 'completed'
        elif self.products_created > 0 or self.products_updated > 0:
            self.sync_status = 'partial'
        else:
            self.sync_status = 'failed'

class ProductionError(db.Model):
    """
    Rejestr błędów systemu produkcyjnego
    Centralne logowanie i śledzenie problemów
    """
    __tablename__ = 'prod_errors'
    
    id = Column(Integer, primary_key=True)
    error_type = Column(Enum(
        'sync_error',
        'parsing_error',
        'workflow_error', 
        'api_error',
        'security_error',
        name='error_type'
    ), nullable=False, index=True)
    
    # KONTEKST BŁĘDU
    related_product_id = Column(String(10), ForeignKey('prod_items.short_product_id'))
    related_order_id = Column(Integer)
    error_location = Column(String(100), nullable=False)
    
    # DANE BŁĘDU
    error_message = Column(Text, nullable=False)
    error_details = Column(JSON)
    stack_trace = Column(Text)
    
    # STATUS ROZWIĄZANIA
    is_resolved = Column(Boolean, default=False, index=True)
    resolution_notes = Column(Text)
    resolved_at = Column(DateTime)
    resolved_by = Column(Integer, ForeignKey('users.id'))
    
    # METADANE
    error_occurred_at = Column(DateTime, default=datetime.utcnow, index=True)
    user_ip = Column(String(45))
    user_agent = Column(Text)
    
    # RELACJE
    related_product = relationship("ProductionItem")
    resolver = relationship("User")
    
    def __repr__(self):
        return f'<ProductionError {self.error_type} {self.error_occurred_at}>'
    
    def resolve(self, user_id, resolution_notes=None):
        """
        Oznacza błąd jako rozwiązany
        
        Args:
            user_id (int): ID użytkownika rozwiązującego
            resolution_notes (str, optional): Notatki rozwiązania
        """
        self.is_resolved = True
        self.resolved_at = datetime.utcnow()
        self.resolved_by = user_id
        if resolution_notes:
            self.resolution_notes = resolution_notes
            
        logger.info("Rozwiązano błąd", extra={
            'error_id': self.id,
            'error_type': self.error_type,
            'resolved_by': user_id
        })

class ProductionConfig(db.Model):
    """
    Konfiguracja systemu produkcyjnego
    Centralne zarządzanie ustawieniami modułu
    """
    __tablename__ = 'prod_config'
    
    id = Column(Integer, primary_key=True)
    config_key = Column(String(100), unique=True, nullable=False, index=True)
    config_value = Column(Text, nullable=False)
    config_description = Column(Text)
    config_type = Column(Enum('string', 'integer', 'boolean', 'json', 'ip_list', name='config_type'),
                        default='string')
    
    # METADANE
    updated_by = Column(Integer, ForeignKey('users.id'))
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # RELACJE
    updater = relationship("User")
    
    def __repr__(self):
        return f'<ProductionConfig {self.config_key}: {self.config_value[:50]}>'
    
    @property
    def parsed_value(self):
        """Parsuje wartość konfiguracji zgodnie z typem"""
        if self.config_type == 'boolean':
            return self.config_value.lower() in ('true', '1', 'yes', 'on')
        elif self.config_type == 'integer':
            try:
                return int(self.config_value)
            except ValueError:
                return 0
        elif self.config_type == 'json':
            try:
                import json
                return json.loads(self.config_value)
            except:
                return {}
        elif self.config_type == 'ip_list':
            return [ip.strip() for ip in self.config_value.split(',') if ip.strip()]
        else:
            return self.config_value
    
    @classmethod
    def get_config(cls, key, default=None):
        """
        Pobiera wartość konfiguracji
        
        Args:
            key (str): Klucz konfiguracji
            default: Wartość domyślna
            
        Returns:
            Sparsowana wartość konfiguracji
        """
        config = cls.query.filter_by(config_key=key).first()
        if config:
            return config.parsed_value
        return default
    
    @classmethod
    def set_config(cls, key, value, user_id=None, description=None, config_type='string'):
        """
        Ustawia wartość konfiguracji
        
        Args:
            key (str): Klucz konfiguracji
            value: Wartość do ustawienia
            user_id (int, optional): ID użytkownika aktualizującego
            description (str, optional): Opis konfiguracji
            config_type (str): Typ konfiguracji
        """
        config = cls.query.filter_by(config_key=key).first()
        
        if config:
            config.config_value = str(value)
            config.updated_by = user_id
            config.updated_at = datetime.utcnow()
        else:
            config = cls(
                config_key=key,
                config_value=str(value),
                config_description=description,
                config_type=config_type,
                updated_by=user_id
            )
            db.session.add(config)
        
        db.session.commit()
        
        logger.info("Zaktualizowano konfigurację", extra={
            'config_key': key,
            'updated_by': user_id
        })

# Funkcje pomocnicze dla inicjalizacji danych
def init_default_configs():
    """Inicjalizuje domyślne konfiguracje modułu"""
    defaults = [
        ('STATION_ALLOWED_IPS', '192.168.1.100,192.168.1.101,192.168.1.102', 
         'IP adresy dozwolone dla stanowisk produkcyjnych', 'ip_list'),
        ('REFRESH_INTERVAL_SECONDS', '30', 
         'Częstotliwość odświeżania interfejsów stanowisk w sekundach', 'integer'),
        ('DEBUG_PRODUCTION_BACKEND', 'false', 
         'Debug logging dla backendu produkcji', 'boolean'),
        ('DEBUG_PRODUCTION_FRONTEND', 'false', 
         'Debug logging dla frontendu produkcji', 'boolean'),
        ('CACHE_DURATION_SECONDS', '3600', 
         'Czas cache dla konfiguracji priorytetów w sekundach', 'integer'),
        ('SYNC_ENABLED', 'true', 
         'Czy synchronizacja z Baselinker jest włączona', 'boolean'),
        ('MAX_SYNC_ITEMS_PER_BATCH', '1000', 
         'Maksymalna liczba elementów na jedną sesję sync', 'integer'),
        ('DEADLINE_DEFAULT_DAYS', '14', 
         'Domyślna liczba dni do deadline dla nowych zamówień', 'integer'),
        ('ADMIN_EMAIL_NOTIFICATIONS', 'admin@woodpower.pl', 
         'Email administratora do powiadomień o błędach', 'string'),
        ('BASELINKER_TARGET_STATUS_COMPLETED', '138623', 
         'Status ID w Baselinker dla ukończonych zamówień', 'integer')
    ]
    
    for key, value, description, config_type in defaults:
        if not ProductionConfig.query.filter_by(config_key=key).first():
            ProductionConfig.set_config(key, value, description=description, config_type=config_type)
    
    logger.info("Zainicjalizowano domyślne konfiguracje modułu production")

def init_default_priority_configs():
    """Inicjalizuje domyślne konfiguracje priorytetów"""
    defaults = [
        ('Termin realizacji', '{"type": "deadline", "urgent_days": 3, "normal_days": 7}', 40, 1),
        ('Wartość zamówienia', '{"type": "value", "high_threshold": 5000, "medium_threshold": 2000}', 30, 2),
        ('Objętość produktu', '{"type": "volume", "large_threshold": 1.0, "medium_threshold": 0.5}', 20, 3),
        ('Kolejność FIFO', '{"type": "fifo", "base_score": 10}', 10, 4)
    ]
    
    for name, criteria, weight, order in defaults:
        if not ProductionPriorityConfig.query.filter_by(config_name=name).first():
            import json
            config = ProductionPriorityConfig(
                config_name=name,
                criteria_json=json.loads(criteria),
                weight_percentage=weight,
                display_order=order
            )
            db.session.add(config)
    
    db.session.commit()
    logger.info("Zainicjalizowano domyślne konfiguracje priorytetów")

# Inicjalizacja liczników dla aktualnego i następnego roku
def init_order_counters():
    """Inicjalizuje liczniki zamówień dla aktualnego i następnego roku"""
    current_year = datetime.now().year
    years_to_init = [current_year, current_year + 1]
    
    for year in years_to_init:
        if not ProductionOrderCounter.query.filter_by(year=year).first():
            counter = ProductionOrderCounter(year=year, current_counter=0)
            db.session.add(counter)
    
    db.session.commit()
    logger.info("Zainicjalizowano liczniki zamówień", extra={'years': years_to_init})