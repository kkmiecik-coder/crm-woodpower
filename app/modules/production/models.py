# modules/production/models.py
"""
Modele bazy danych dla modułu Production
"""

from extensions import db
from datetime import datetime, timedelta, date
from sqlalchemy import Index
from decimal import Decimal
from modules.logging import get_structured_logger

# NOWY KOD - funkcja pomocnicza dla lokalnego czasu
def get_local_datetime():
    """Zwraca aktualny czas dla Polski"""
    import pytz
    poland_tz = pytz.timezone('Europe/Warsaw')
    return datetime.now(poland_tz).replace(tzinfo=None)

# Inicjalizacja loggera
production_logger = get_structured_logger('production.models')
production_logger.info("✅ production_logger zainicjowany poprawnie w module Productions w models.py")


class ProductionStatus(db.Model):
    """
    Model dla statusów produkcji
    """
    __tablename__ = 'production_statuses'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True, comment="Nazwa systemowa statusu")
    display_name = db.Column(db.String(100), nullable=False, comment="Nazwa wyświetlana")
    color_code = db.Column(db.String(7), nullable=False, comment="Kod koloru hex")
    created_at = db.Column(db.DateTime, default=get_local_datetime, nullable=False)
    
    # Relacje
    items = db.relationship('ProductionItem', backref='status', lazy=True)
    
    def __repr__(self):
        return f'<ProductionStatus {self.name}: {self.display_name}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'display_name': self.display_name,
            'color_code': self.color_code,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class ProductionConfig(db.Model):
    """
    Model dla konfiguracji modułu produkcji
    """
    __tablename__ = 'production_config'
    
    id = db.Column(db.Integer, primary_key=True)
    config_key = db.Column(db.String(100), nullable=False, unique=True, comment="Klucz konfiguracji")
    config_value = db.Column(db.Text, nullable=False, comment="Wartość konfiguracji")
    description = db.Column(db.Text, nullable=True, comment="Opis konfiguracji")
    updated_at = db.Column(db.DateTime, default=get_local_datetime, onupdate=get_local_datetime, nullable=False)
    
    def __repr__(self):
        return f'<ProductionConfig {self.config_key}: {self.config_value}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'config_key': self.config_key,
            'config_value': self.config_value,
            'description': self.description,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    @classmethod
    def get_value(cls, key, default=None):
        """Pobiera wartość konfiguracji"""
        config = cls.query.filter_by(config_key=key).first()
        return config.config_value if config else default
    
    @classmethod
    def set_value(cls, key, value, description=None):
        """Ustawia wartość konfiguracji"""
        try:
            config = cls.query.filter_by(config_key=key).first()
            if config:
                config.config_value = value
                if description:
                    config.description = description
                import pytz
                poland_tz = pytz.timezone('Europe/Warsaw')
                config.updated_at = datetime.now(poland_tz).replace(tzinfo=None)
                production_logger.info("Zaktualizowano konfigurację", config_key=key, value=value)
            else:
                config = cls(
                    config_key=key,
                    config_value=value,
                    description=description
                )
                db.session.add(config)
                production_logger.info("Utworzono nową konfigurację", config_key=key, value=value)
            
            db.session.commit()
            return config
            
        except Exception as e:
            production_logger.error("Błąd podczas ustawiania konfiguracji", 
                                  config_key=key, error=str(e), error_type=type(e).__name__)
            db.session.rollback()
            raise


class ProductionStation(db.Model):
    """
    Model dla stanowisk produkcyjnych
    """
    __tablename__ = 'production_stations'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, comment="Nazwa stanowiska")
    station_type = db.Column(db.Enum('gluing', 'packaging', name='station_type_enum'), nullable=False, comment="Typ stanowiska")
    is_active = db.Column(db.Boolean, default=True, nullable=False, comment="Czy stanowisko aktywne")
    current_item_id = db.Column(db.Integer, db.ForeignKey('production_items.id'), nullable=True, comment="Aktualnie produkowany item")
    last_activity_at = db.Column(db.DateTime, nullable=True, comment="Ostatnia aktywność")
    created_at = db.Column(db.DateTime, default=get_local_datetime, nullable=False)
    
    @property
    def current_item(self):
        """Pobiera aktualny produkt bez rekursji"""
        if self.current_item_id:
            return ProductionItem.query.get(self.current_item_id)
        return None
    
    def __repr__(self):
        return f'<ProductionStation {self.name} ({self.station_type})>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'station_type': self.station_type,
            'is_active': self.is_active,
            'current_item_id': self.current_item_id,
            'is_busy': self.current_item_id is not None,
            'last_activity_at': self.last_activity_at.isoformat() if self.last_activity_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
    
    @property
    def is_busy(self):
        """Sprawdza czy stanowisko jest zajęte"""
        return self.current_item_id is not None


class Worker(db.Model):
    """
    Model dla pracowników
    """
    __tablename__ = 'workers'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, comment="Imię i nazwisko pracownika")
    is_active = db.Column(db.Boolean, default=True, nullable=False, comment="Czy pracownik aktywny")
    station_type_preference = db.Column(db.Enum('gluing', 'packaging', 'both', name='worker_preference_enum'), default='both', comment="Preferowany typ stanowiska")
    created_at = db.Column(db.DateTime, default=get_local_datetime, nullable=False)
    
    def __repr__(self):
        return f'<Worker {self.name}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'is_active': self.is_active,
            'station_type_preference': self.station_type_preference,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
    
    @classmethod
    def get_active_workers(cls, station_type=None):
        """Pobiera aktywnych pracowników, opcjonalnie filtruje po typie stanowiska"""
        query = cls.query.filter_by(is_active=True)
        if station_type:
            query = query.filter(
                (cls.station_type_preference == station_type) | 
                (cls.station_type_preference == 'both')
            )
        return query.all()


class ProductionItem(db.Model):
    """
    Model dla produktów w produkcji (główna tabela)
    """
    __tablename__ = 'production_items'
    
    # === PODSTAWOWE POLA ===
    id = db.Column(db.Integer, primary_key=True)
    baselinker_order_id = db.Column(db.Integer, nullable=False, comment="ID zamówienia z Baselinker")
    baselinker_order_product_id = db.Column(db.Integer, nullable=False, comment="ID produktu w zamówieniu")
    product_name = db.Column(db.String(500), nullable=False, comment="Pełna nazwa produktu")
    quantity = db.Column(db.Integer, nullable=False, comment="Ilość")
    
    # === PARSOWANE Z NAZWY PRODUKTU ===
    wood_species = db.Column(db.String(50), nullable=True, comment="Gatunek drewna")
    wood_technology = db.Column(db.String(50), nullable=True, comment="Technologia")
    wood_class = db.Column(db.String(10), nullable=True, comment="Klasa drewna")
    dimensions_length = db.Column(db.Numeric(8, 1), nullable=True, comment="Długość w cm")
    dimensions_width = db.Column(db.Numeric(8, 1), nullable=True, comment="Szerokość w cm")
    dimensions_thickness = db.Column(db.Numeric(8, 1), nullable=True, comment="Grubość w cm")
    finish_type = db.Column(db.String(50), nullable=True, comment="Typ wykończenia")
    
    # === PRIORYTETY I PLANOWANIE ===
    deadline_date = db.Column(db.Date, nullable=True, comment="Data realizacji")
    priority_score = db.Column(db.Integer, nullable=True, comment="Wynik priorytetu")
    priority_group = db.Column(db.String(100), nullable=True, comment="Grupa priorytetowa")
    
    # === STATUS I PRZYPISANIA ===
    status_id = db.Column(db.Integer, db.ForeignKey('production_statuses.id'), nullable=False, comment="Aktualny status")
    
    # === CZASY REALIZACJI ===
    packaging_started_at = db.Column(db.DateTime, nullable=True, comment="Rozpoczęcie pakowania")
    packaging_completed_at = db.Column(db.DateTime, nullable=True, comment="Zakończenie pakowania")
    
    # === METADANE ===
    created_at = db.Column(db.DateTime, default=get_local_datetime, nullable=False)
    updated_at = db.Column(db.DateTime, default=get_local_datetime, onupdate=get_local_datetime, nullable=False)
    imported_from_baselinker_at = db.Column(db.DateTime, nullable=True, comment="Kiedy pobrano z Baselinker")
    
    # === INDEKSY ===
    __table_args__ = (
        Index('ix_production_items_baselinker_order', 'baselinker_order_id'),
        Index('ix_production_items_status', 'status_id'),
        Index('ix_production_items_priority', 'priority_score', 'deadline_date'),
        Index('ix_production_items_wood_specs', 'wood_species', 'wood_technology', 'wood_class'),
        Index('ix_production_items_unique_product', 'baselinker_order_id', 'baselinker_order_product_id', unique=True),
    )
    
    def __repr__(self):
        return f'<ProductionItem {self.id}: {self.product_name[:50]}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'baselinker_order_id': self.baselinker_order_id,
            'baselinker_order_product_id': self.baselinker_order_product_id,
            'product_name': self.product_name,
            'quantity': self.quantity,
            'wood_species': self.wood_species,
            'wood_technology': self.wood_technology,
            'wood_class': self.wood_class,
            'dimensions_length': float(self.dimensions_length) if self.dimensions_length else None,
            'dimensions_width': float(self.dimensions_width) if self.dimensions_width else None,
            'dimensions_thickness': float(self.dimensions_thickness) if self.dimensions_thickness else None,
            'finish_type': self.finish_type,
            'deadline_date': self.deadline_date.isoformat() if self.deadline_date else None,
            'priority_score': self.priority_score,
            'priority_group': self.priority_group,
            'status': self.status.to_dict() if self.status else None,
            'packaging_started_at': self.packaging_started_at.isoformat() if self.packaging_started_at else None,
            'packaging_completed_at': self.packaging_completed_at.isoformat() if self.packaging_completed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'imported_from_baselinker_at': self.imported_from_baselinker_at.isoformat() if self.imported_from_baselinker_at else None
        }
    
    @property
    def dimensions_formatted(self):
        """Sformatowane wymiary produktu"""
        if self.dimensions_length and self.dimensions_width and self.dimensions_thickness:
            return f"{self.dimensions_length}×{self.dimensions_width}×{self.dimensions_thickness} cm"
        return None
    
    @property
    def is_overdue(self):
        """Sprawdza czy produkt przekroczył deadline"""
        if self.deadline_date:
            return datetime.now().date() > self.deadline_date
        return False

    @classmethod
    def get_queue_items(cls, limit=None):
        """Pobiera produkty z bazy do panelu zarządzania"""
        try:
            query = cls.query.join(ProductionStatus).filter(
                ProductionStatus.name == 'pending'
            ).order_by(
                cls.priority_score.asc(),  # Zmienione z desc() na asc() - niższy wynik = wyższy priorytet
                cls.deadline_date.asc(),
                cls.created_at.asc()
            )
            
            if limit:
                query = query.limit(limit)
                
            return query.all()
            
        except Exception as e:
            production_logger.error("Błąd podczas pobierania kolejki produktów", error=str(e))
            return []

    def is_ready_for_packaging(self):
        """
        Sprawdza czy produkt jest gotowy do pakowania
        POPRAWKA: usuń referencję do gluing_completed_at
        """
        return self.status.name == 'completed'

    def start_packaging_process(self):
        """
        Rozpoczyna proces pakowania dla produktu
        """
        try:
            if self.packaging_started_at is None:
                self.packaging_started_at = datetime.utcnow()
                self.updated_at = datetime.utcnow()
                
                production_logger.info(f"Rozpoczęto pakowanie produktu {self.id}")
                return True
            
            return True  # Już rozpoczęte
            
        except Exception as e:
            production_logger.error(f"Błąd rozpoczynania pakowania produktu {self.id}", error=str(e))
            return False

    def complete_packaging_process(self):
        """
        Kończy proces pakowania dla produktu
        """
        try:
            packaging_time = datetime.utcnow()
            
            if self.packaging_completed_at is None:
                self.packaging_completed_at = packaging_time
            
            if self.packaging_started_at is None:
                self.packaging_started_at = packaging_time
            
            self.updated_at = packaging_time
            
            production_logger.info(f"Ukończono pakowanie produktu {self.id}")
            return True
            
        except Exception as e:
            production_logger.error(f"Błąd ukończenia pakowania produktu {self.id}", error=str(e))
            return False

    def get_packaging_duration_seconds(self):
        """
        Oblicza czas pakowania w sekundach
        """
        try:
            if not self.packaging_started_at or not self.packaging_completed_at:
                return None
            
            duration = (self.packaging_completed_at - self.packaging_started_at).total_seconds()
            return int(duration) if duration >= 0 else None
            
        except Exception as e:
            production_logger.error(f"Błąd obliczania czasu pakowania produktu {self.id}", error=str(e))
            return None

    def get_waiting_time_after_gluing_hours(self):
        """
        POPRAWKA: Czasowo zwraca None - funkcja będzie niepotrzebna bez gluing_completed_at
        W przyszłości będzie pobierać dane z nowych tabel gluing_assignments
        """
        return None

    def to_packaging_dict(self):
        """
        Zwraca dane produktu w formacie dla API pakowania
        """
        base_dict = self.to_dict()
        
        # Dodaj dane specyficzne dla pakowania
        packaging_data = {
            'is_ready_for_packaging': self.is_ready_for_packaging(),
            'packaging_duration_seconds': self.get_packaging_duration_seconds(),
            'waiting_time_after_gluing_hours': self.get_waiting_time_after_gluing_hours(),
            'packaging_started_at': self.packaging_started_at.isoformat() if self.packaging_started_at else None,
            'packaging_completed_at': self.packaging_completed_at.isoformat() if self.packaging_completed_at else None
        }
        
        base_dict.update(packaging_data)
        return base_dict



class ProductionOrderSummary(db.Model):
    """
    Model dla podsumowania zamówień (dla pakowania)
    """
    __tablename__ = 'production_orders_summary'
    
    id = db.Column(db.Integer, primary_key=True)
    baselinker_order_id = db.Column(db.Integer, nullable=False, unique=True, comment="ID zamówienia z Baselinker")
    customer_name = db.Column(db.String(200), nullable=True, comment="Nazwa klienta")
    internal_order_number = db.Column(db.String(50), nullable=True, comment="Numer wewnętrzny")
    total_items_count = db.Column(db.Integer, nullable=False, default=0, comment="Łączna liczba produktów")
    completed_items_count = db.Column(db.Integer, nullable=False, default=0, comment="Liczba ukończonych produktów")
    all_items_glued = db.Column(db.Boolean, default=False, nullable=False, comment="Czy wszystkie produkty sklejone")
    packaging_status = db.Column(db.Enum('waiting', 'in_progress', 'completed', name='packaging_status_enum'), default='waiting', comment="Status pakowania")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=get_local_datetime, onupdate=get_local_datetime, nullable=False)
    
    def __repr__(self):
        return f'<ProductionOrderSummary {self.baselinker_order_id}: {self.customer_name}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'baselinker_order_id': self.baselinker_order_id,
            'customer_name': self.customer_name,
            'internal_order_number': self.internal_order_number,
            'total_items_count': self.total_items_count,
            'completed_items_count': self.completed_items_count,
            'all_items_glued': self.all_items_glued,
            'packaging_status': self.packaging_status,
            'completion_percentage': self.completion_percentage,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    @property
    def completion_percentage(self):
        """Procent ukończenia zamówienia"""
        if self.total_items_count > 0:
            return round((self.completed_items_count / self.total_items_count) * 100, 1)
        return 0.0
    
    def update_completion_status(self):
        """Aktualizuje status ukończenia na podstawie produktów"""
        try:
            completed_count = ProductionItem.query.join(ProductionStatus).filter(
                ProductionItem.baselinker_order_id == self.baselinker_order_id,
                ProductionStatus.name == 'completed'
            ).count()
            
            old_completed = self.completed_items_count
            self.completed_items_count = completed_count
            self.all_items_glued = (completed_count >= self.total_items_count)
            self.updated_at = datetime.utcnow()
            
            db.session.commit()
            
            production_logger.info("Zaktualizowano status ukończenia zamówienia",
                                 order_id=self.baselinker_order_id,
                                 old_completed=old_completed,
                                 new_completed=completed_count,
                                 total_items=self.total_items_count,
                                 all_glued=self.all_items_glued)
            
        except Exception as e:
            production_logger.error("Błąd podczas aktualizacji statusu zamówienia",
                                  order_id=self.baselinker_order_id, error=str(e))
            db.session.rollback()
            raise
    
    @classmethod
    def create_or_update_from_items(cls, baselinker_order_id, customer_name=None, internal_order_number=None):
        """Tworzy lub aktualizuje podsumowanie na podstawie produktów"""
        try:
            summary = cls.query.filter_by(baselinker_order_id=baselinker_order_id).first()
            
            total_count = ProductionItem.query.filter_by(
                baselinker_order_id=baselinker_order_id
            ).count()
            
            if not summary:
                summary = cls(
                    baselinker_order_id=baselinker_order_id,
                    customer_name=customer_name,
                    internal_order_number=internal_order_number,
                    total_items_count=total_count
                )
                db.session.add(summary)
                production_logger.info("Utworzono nowe podsumowanie zamówienia",
                                     order_id=baselinker_order_id,
                                     customer_name=customer_name,
                                     total_items=total_count)
            else:
                summary.total_items_count = total_count
                if customer_name:
                    summary.customer_name = customer_name
                if internal_order_number:
                    summary.internal_order_number = internal_order_number
                production_logger.info("Zaktualizowano podsumowanie zamówienia",
                                     order_id=baselinker_order_id,
                                     total_items=total_count)
            
            summary.update_completion_status()
            return summary
            
        except Exception as e:
            production_logger.error("Błąd podczas tworzenia/aktualizacji podsumowania zamówienia",
                                  order_id=baselinker_order_id, error=str(e))
            db.session.rollback()
            raise

    def refresh_completion_status(self):
        """
        Odświeża status ukończenia na podstawie aktualnego stanu produktów
        """
        try:
            # Pobierz wszystkie produkty zamówienia
            total_products = ProductionItem.query.filter_by(
                baselinker_order_id=self.baselinker_order_id
            ).count()
            
            # Pobierz ukończone produkty
            completed_products = ProductionItem.query.join(ProductionStatus).filter(
                ProductionItem.baselinker_order_id == self.baselinker_order_id,
                ProductionStatus.name == 'completed'
            ).count()
            
            # Aktualizuj liczniki
            old_completed = self.completed_items_count
            old_all_glued = self.all_items_glued
            
            self.total_items_count = total_products
            self.completed_items_count = completed_products
            self.all_items_glued = (completed_products >= total_products and total_products > 0)
            self.updated_at = datetime.utcnow()
            
            # Loguj zmiany
            if old_completed != completed_products or old_all_glued != self.all_items_glued:
                production_logger.info(
                    f"Zaktualizowano status zamówienia {self.baselinker_order_id}: "
                    f"{completed_products}/{total_products} produktów, "
                    f"all_items_glued: {self.all_items_glued}"
                )
            
            return True
            
        except Exception as e:
            production_logger.error(
                f"Błąd odświeżania statusu zamówienia {self.baselinker_order_id}", 
                error=str(e)
            )
            return False

    def can_be_packed(self):
        """
        Sprawdza czy zamówienie może być pakowane
        """
        return (
            self.all_items_glued == True and 
            self.packaging_status in ['waiting', 'in_progress']
        )

    def get_packaging_priority(self):
        """
        Oblicza priorytet pakowania na podstawie deadline produktów
        """
        try:
            # Pobierz produkty zamówienia
            products = ProductionItem.query.filter_by(
                baselinker_order_id=self.baselinker_order_id
            ).all()
            
            if not products:
                return 'normal'
            
            # Znajdź najwcześniejszy deadline
            deadlines = [p.deadline_date for p in products if p.deadline_date]
            
            if not deadlines:
                return 'normal'
            
            earliest_deadline = min(deadlines)
            today = date.today()
            days_diff = (earliest_deadline - today).days
            
            # Ustal priorytet
            if days_diff < 0:
                return 'urgent'  # Opóźnione
            elif days_diff <= 1:
                return 'urgent'  # Dziś lub jutro
            elif days_diff <= 3:
                return 'medium'  # Do 3 dni
            else:
                return 'normal'  # Powyżej 3 dni
                
        except Exception as e:
            production_logger.error(
                f"Błąd obliczania priorytetu zamówienia {self.baselinker_order_id}",
                error=str(e)
            )
            return 'normal'

    def get_earliest_deadline(self):
        """
        Zwraca najwcześniejszy deadline spośród produktów zamówienia
        """
        try:
            products = ProductionItem.query.filter_by(
                baselinker_order_id=self.baselinker_order_id
            ).all()
            
            deadlines = [p.deadline_date for p in products if p.deadline_date]
            
            if deadlines:
                return min(deadlines)
            return None
            
        except Exception as e:
            production_logger.error(
                f"Błąd pobierania deadline zamówienia {self.baselinker_order_id}",
                error=str(e)
            )
            return None

    def get_products_for_packaging(self):
        """
        Pobiera produkty zamówienia przygotowane do pakowania
        """
        try:
            products = ProductionItem.query.filter_by(
                baselinker_order_id=self.baselinker_order_id
            ).all()
            
            # Filtruj tylko ukończone produkty
            completed_products = [p for p in products if p.status.name == 'completed']
            
            return completed_products
            
        except Exception as e:
            production_logger.error(
                f"Błąd pobierania produktów zamówienia {self.baselinker_order_id}",
                error=str(e)
            )
            return []

    def start_packaging(self):
        """
        Rozpoczyna proces pakowania zamówienia
        """
        try:
            if not self.can_be_packed():
                return False, "Zamówienie nie może być pakowane"
            
            if self.packaging_status == 'in_progress':
                return True, "Pakowanie już w trakcie"
            
            # Zmień status na w trakcie
            self.packaging_status = 'in_progress'
            self.updated_at = datetime.utcnow()
            
            # Ustaw czas rozpoczęcia pakowania dla produktów
            products = ProductionItem.query.filter_by(
                baselinker_order_id=self.baselinker_order_id
            ).all()
            
            packaging_start_time = datetime.utcnow()
            
            for product in products:
                if product.packaging_started_at is None:
                    product.packaging_started_at = packaging_start_time
            
            db.session.commit()
            
            production_logger.info(f"Rozpoczęto pakowanie zamówienia {self.baselinker_order_id}")
            
            return True, "Pakowanie rozpoczęte"
            
        except Exception as e:
            db.session.rollback()
            production_logger.error(
                f"Błąd rozpoczynania pakowania zamówienia {self.baselinker_order_id}",
                error=str(e)
            )
            return False, str(e)

    def complete_packaging(self):
        """
        Kończy proces pakowania zamówienia
        """
        try:
            if self.packaging_status == 'completed':
                return True, "Pakowanie już ukończone"
            
            # Zmień status na ukończone
            self.packaging_status = 'completed'
            self.updated_at = datetime.utcnow()
            
            # Ustaw czas ukończenia pakowania dla produktów
            products = ProductionItem.query.filter_by(
                baselinker_order_id=self.baselinker_order_id
            ).all()
            
            packaging_complete_time = datetime.utcnow()
            
            for product in products:
                if product.packaging_completed_at is None:
                    product.packaging_completed_at = packaging_complete_time
                
                if product.packaging_started_at is None:
                    product.packaging_started_at = packaging_complete_time
            
            db.session.commit()
            
            production_logger.info(f"Ukończono pakowanie zamówienia {self.baselinker_order_id}")
            
            return True, "Pakowanie ukończone"
            
        except Exception as e:
            db.session.rollback()
            production_logger.error(
                f"Błąd ukończenia pakowania zamówienia {self.baselinker_order_id}",
                error=str(e)
            )
            return False, str(e)

    def get_packaging_duration(self):
        """
        Oblicza czas trwania pakowania w sekundach
        """
        try:
            if self.packaging_status != 'completed':
                return None
            
            # Znajdź najwcześniejszy start i najpóźniejsze ukończenie
            products = ProductionItem.query.filter_by(
                baselinker_order_id=self.baselinker_order_id
            ).all()
            
            start_times = [p.packaging_started_at for p in products if p.packaging_started_at]
            end_times = [p.packaging_completed_at for p in products if p.packaging_completed_at]
            
            if not start_times or not end_times:
                return None
            
            earliest_start = min(start_times)
            latest_end = max(end_times)
            
            duration = (latest_end - earliest_start).total_seconds()
            
            return int(duration) if duration >= 0 else None
            
        except Exception as e:
            production_logger.error(
                f"Błąd obliczania czasu pakowania zamówienia {self.baselinker_order_id}",
                error=str(e)
            )
            return None

    def to_packaging_dict(self):
        """
        Zwraca dane zamówienia w formacie dla API pakowania
        """
        try:
            # Pobierz produkty
            products = self.get_products_for_packaging()
            
            products_data = []
            for product in products:
                products_data.append({
                    'id': product.id,
                    'name': product.product_name,
                    'qty': product.quantity,
                    'wood_species': product.wood_species,
                    'wood_technology': product.wood_technology,
                    'wood_class': product.wood_class,
                    'dimensions': {
                        'length': float(product.dimensions_length) if product.dimensions_length else None,
                        'width': float(product.dimensions_width) if product.dimensions_width else None,
                        'thickness': float(product.dimensions_thickness) if product.dimensions_thickness else None
                    },
                    'finish_type': product.finish_type
                })
            
            return {
                'id': self.id,
                'baselinker_order_id': self.baselinker_order_id,
                'order_number': self.internal_order_number or f"#{self.baselinker_order_id}",
                'customer_name': f"Zamówienie #{self.baselinker_order_id}",
                'total_items_count': self.total_items_count,
                'completed_items_count': self.completed_items_count,
                'all_items_glued': self.all_items_glued,
                'packaging_status': self.packaging_status,
                'priority': self.get_packaging_priority(),
                'deadline': self.get_earliest_deadline().isoformat() if self.get_earliest_deadline() else None,
                'completion_percentage': self.completion_percentage,
                'products': products_data,
                'packaging_duration': self.get_packaging_duration(),
                'created_at': self.created_at.isoformat() if self.created_at else None,
                'updated_at': self.updated_at.isoformat() if self.updated_at else None
            }
            
        except Exception as e:
            production_logger.error(
                f"Błąd konwersji zamówienia {self.baselinker_order_id} do dict",
                error=str(e)
            )
            return self.to_dict()  # Fallback do podstawowej metody


# ===================================================================
# NOWE MODELE GLUING - DO DODANIA NA KOŃCU PLIKU models.py
# Tabele: prod_gluing_items, prod_gluing_stations, prod_gluing_assignments, prod_gluing_config
# ===================================================================

class ProdGluingConfig(db.Model):
    """
    Model dla konfiguracji modułu gluing
    """
    __tablename__ = 'prod_gluing_config'
    
    id = db.Column(db.Integer, primary_key=True)
    config_key = db.Column(db.String(100), nullable=False, unique=True, comment="Klucz konfiguracji")
    config_value = db.Column(db.Text, nullable=True, comment="Wartość konfiguracji")
    description = db.Column(db.Text, nullable=True, comment="Opis konfiguracji")
    updated_at = db.Column(db.DateTime, default=get_local_datetime, onupdate=get_local_datetime, nullable=False)
    
    def __repr__(self):
        return f'<ProdGluingConfig {self.config_key}: {self.config_value}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'config_key': self.config_key,
            'config_value': self.config_value,
            'description': self.description,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    @classmethod
    def get_value(cls, key, default=None):
        """Pobiera wartość konfiguracji gluing"""
        try:
            config = cls.query.filter_by(config_key=key).first()
            if config:
                production_logger.debug("Pobrano konfigurację gluing", config_key=key, value=config.config_value)
                return config.config_value
            else:
                production_logger.warning("Nie znaleziono konfiguracji gluing", config_key=key, default=default)
                return default
        except Exception as e:
            production_logger.error("Błąd podczas pobierania konfiguracji gluing", 
                                  config_key=key, error=str(e), error_type=type(e).__name__)
            return default
    
    @classmethod
    def set_value(cls, key, value, description=None):
        """Ustawia wartość konfiguracji gluing"""
        try:
            config = cls.query.filter_by(config_key=key).first()
            if config:
                config.config_value = value
                if description:
                    config.description = description
                config.updated_at = get_local_datetime()
                production_logger.info("Zaktualizowano konfigurację gluing", config_key=key, value=value)
            else:
                config = cls(
                    config_key=key,
                    config_value=value,
                    description=description
                )
                db.session.add(config)
                production_logger.info("Utworzono nową konfigurację gluing", config_key=key, value=value)
            
            db.session.commit()
            return config
            
        except Exception as e:
            production_logger.error("Błąd podczas ustawiania konfiguracji gluing", 
                                  config_key=key, error=str(e), error_type=type(e).__name__)
            db.session.rollback()
            raise


class ProdGluingStation(db.Model):
    """
    Model dla stanowisk klejenia
    """
    __tablename__ = 'prod_gluing_stations'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, comment="Nazwa stanowiska")
    machine_number = db.Column(db.Integer, nullable=False, comment="1 lub 2 (numer maszyny)")
    station_number = db.Column(db.Integer, nullable=False, comment="1, 2, lub 3 (numer stanowiska)")
    
    # Wymiary fizyczne
    width_cm = db.Column(db.Numeric(8, 2), nullable=False, comment="Szerokość stanowiska w cm")
    height_cm = db.Column(db.Numeric(8, 2), nullable=False, comment="Wysokość stanowiska w cm")
    max_thickness_cm = db.Column(db.Numeric(8, 2), default=10.0, comment="Maksymalna grubość produktów")
    
    # Pozycjonowanie w UI
    display_x = db.Column(db.Integer, default=0, comment="Pozycja X w Canvas")
    display_y = db.Column(db.Integer, default=0, comment="Pozycja Y w Canvas")
    display_color = db.Column(db.String(7), default='#2ecc71', comment="Kolor stanowiska")
    display_order = db.Column(db.Integer, default=0, comment="Kolejność wyświetlania")
    
    # Status i konfiguracja
    is_active = db.Column(db.Boolean, default=True, nullable=False, comment="Czy stanowisko aktywne")
    is_blocked = db.Column(db.Boolean, default=False, comment="Czy stanowisko zablokowane")
    block_reason = db.Column(db.Text, comment="Powód zablokowania")
    
    # Metadane
    created_at = db.Column(db.DateTime, default=get_local_datetime, nullable=False)
    updated_at = db.Column(db.DateTime, default=get_local_datetime, onupdate=get_local_datetime)
    last_maintenance_at = db.Column(db.DateTime, comment="Ostatnia konserwacja")
    
    # Relacje
    assignments = db.relationship('ProdGluingAssignment', backref='station', lazy=True)
    
    def __repr__(self):
        return f'<ProdGluingStation {self.name} (M{self.machine_number}-S{self.station_number})>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'machine_number': self.machine_number,
            'station_number': self.station_number,
            'dimensions': {
                'width': float(self.width_cm) if self.width_cm else 0,
                'height': float(self.height_cm) if self.height_cm else 0,
                'max_thickness': float(self.max_thickness_cm) if self.max_thickness_cm else 10.0
            },
            'display': {
                'x': self.display_x,
                'y': self.display_y,
                'color': self.display_color,
                'order': self.display_order
            },
            'status': {
                'is_active': self.is_active,
                'is_blocked': self.is_blocked,
                'block_reason': self.block_reason,
                'is_busy': self.is_busy()
            },
            'occupancy_percent': self.get_occupancy_percent(),
            'current_thickness': self.get_current_thickness(),
            'last_maintenance_at': self.last_maintenance_at.isoformat() if self.last_maintenance_at else None
        }
    
    def is_busy(self):
        """Sprawdza czy stanowisko ma aktywne przypisania"""
        active_assignments = ProdGluingAssignment.query.filter_by(
            station_id=self.id
        ).filter(
            ProdGluingAssignment.completed_at.is_(None)
        ).count()
        return active_assignments > 0
    
    def get_occupancy_percent(self):
        """Oblicza procentowe zajęcie stanowiska"""
        try:
            total_area = float(self.width_cm * self.height_cm) if (self.width_cm and self.height_cm) else 0
            if total_area == 0:
                return 0
                
            occupied_area = db.session.query(
                db.func.sum(ProdGluingAssignment.width_occupied * ProdGluingAssignment.height_occupied)
            ).filter(
                ProdGluingAssignment.station_id == self.id,
                ProdGluingAssignment.completed_at.is_(None)
            ).scalar() or 0
            
            return min(100, (float(occupied_area) / total_area) * 100)
            
        except Exception as e:
            production_logger.error("Błąd obliczania zajętości stanowiska", 
                                  station_id=self.id, error=str(e))
            return 0
    
    def get_current_thickness(self):
        """Zwraca aktualną grubość produktów na stanowisku"""
        try:
            current_assignment = ProdGluingAssignment.query.join(ProdGluingItem).filter(
                ProdGluingAssignment.station_id == self.id,
                ProdGluingAssignment.completed_at.is_(None)
            ).first()
            
            if current_assignment and current_assignment.item:
                return float(current_assignment.item.dimensions_thickness) if current_assignment.item.dimensions_thickness else 0
            return 0
            
        except Exception as e:
            production_logger.error("Błąd pobierania grubości stanowiska", 
                                  station_id=self.id, error=str(e))
            return 0
    
    def can_fit_product(self, item):
        """Sprawdza czy produkt zmieści się na stanowisku"""
        try:
            if not item or not item.dimensions_length or not item.dimensions_width:
                return False, "Brak wymiarów produktu"
                
            if not self.is_active:
                return False, "Stanowisko nieaktywne"
                
            if self.is_blocked:
                return False, f"Stanowisko zablokowane: {self.block_reason}"
            
            # Sprawdź grubość
            current_thickness = self.get_current_thickness()
            if current_thickness > 0 and item.dimensions_thickness:
                thickness_diff = abs(current_thickness - float(item.dimensions_thickness))
                tolerance = float(ProdGluingConfig.get_value('thickness_tolerance', 0.5))
                if thickness_diff > tolerance:
                    return False, f"Różna grubość: {current_thickness}cm vs {item.dimensions_thickness}cm"
            
            # Sprawdź czy się zmieści (uproszczona logika)
            occupancy = self.get_occupancy_percent()
            item_area = float(item.dimensions_length * item.dimensions_width)
            station_area = float(self.width_cm * self.height_cm)
            required_percent = (item_area / station_area) * 100
            
            if occupancy + required_percent > 95:  # 5% margin
                return False, f"Za mało miejsca: {occupancy:.1f}% + {required_percent:.1f}% > 95%"
            
            return True, "OK"
            
        except Exception as e:
            production_logger.error("Błąd sprawdzania czy produkt się zmieści", 
                                  station_id=self.id, item_id=item.id if item else None, error=str(e))
            return False, f"Błąd sprawdzania: {str(e)}"
    
    @classmethod
    def get_active_stations(cls):
        """Pobiera aktywne stanowiska klejenia"""
        return cls.query.filter_by(is_active=True, is_blocked=False).order_by(cls.display_order).all()
    
    @classmethod
    def get_stations_with_stats(cls):
        """Pobiera stanowiska z podstawowymi statystykami"""
        stations = cls.get_active_stations()
        return [
            {
                **station.to_dict(),
                'current_items_count': ProdGluingAssignment.query.filter_by(
                    station_id=station.id
                ).filter(ProdGluingAssignment.completed_at.is_(None)).count()
            } for station in stations
        ]


class ProdGluingItem(db.Model):
    """
    Model dla produktów do sklejenia
    """
    __tablename__ = 'prod_gluing_items'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Podstawowe dane z Baselinker
    baselinker_order_id = db.Column(db.Integer, nullable=False, comment="ID zamówienia z Baselinker")
    baselinker_order_product_id = db.Column(db.Integer, nullable=False, comment="ID produktu w zamówieniu")
    product_name = db.Column(db.String(500), comment="Pełna nazwa produktu z Baselinker")
    display_name = db.Column(db.String(200), comment="Uproszczona nazwa dla pracowników")
    item_sequence = db.Column(db.Integer, default=1, comment="1,2,3 jeśli produkt ma wiele sztuk")
    
    # Parsowane dane produktu
    wood_species = db.Column(db.String(50), comment="Gatunek drewna")
    wood_technology = db.Column(db.String(50), comment="Technologia")
    wood_class = db.Column(db.String(10), comment="Klasa drewna")
    dimensions_length = db.Column(db.Numeric(8, 2), comment="Długość w cm")
    dimensions_width = db.Column(db.Numeric(8, 2), comment="Szerokość w cm")
    dimensions_thickness = db.Column(db.Numeric(8, 2), comment="Grubość w cm")
    finish_type = db.Column(db.String(50), comment="Typ wykończenia")
    
    # Priorytety i kolejkowanie
    deadline_date = db.Column(db.Date, comment="Termin deadline")
    priority_score = db.Column(db.Integer, comment="Wynik priorytetowy")
    priority_group = db.Column(db.String(100), comment="Grupa priorytetowa")
    requires_stabilization = db.Column(db.Boolean, default=False, comment="Czy wymaga stabilizacji")
    stabilization_length = db.Column(db.Numeric(8, 2), comment="Długość lameli stabilizującej")
    
    # Status i workflow
    status = db.Column(db.Enum('pending', 'assigned', 'in_progress', 'completed', name='gluing_status_enum'), 
                       default='pending', comment="Status w workflow gluing")
    
    # Metadane
    created_at = db.Column(db.DateTime, default=get_local_datetime, nullable=False)
    updated_at = db.Column(db.DateTime, default=get_local_datetime, onupdate=get_local_datetime)
    imported_from_baselinker_at = db.Column(db.DateTime, comment="Kiedy zaimportowano z Baselinker")
    notes = db.Column(db.Text, comment="Notatki specjalne")
    
    # Relacje
    assignments = db.relationship('ProdGluingAssignment', backref='item', lazy=True)
    
    def __repr__(self):
        return f'<ProdGluingItem {self.id}: {self.display_name or self.product_name[:50]}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'baselinker_order_id': self.baselinker_order_id,
            'baselinker_order_product_id': self.baselinker_order_product_id,
            'product_name': self.product_name,
            'display_name': self.display_name,
            'item_sequence': self.item_sequence,
            'wood_info': {
                'species': self.wood_species,
                'technology': self.wood_technology,
                'class': self.wood_class
            },
            'dimensions': {
                'length': float(self.dimensions_length) if self.dimensions_length else 0,
                'width': float(self.dimensions_width) if self.dimensions_width else 0,
                'thickness': float(self.dimensions_thickness) if self.dimensions_thickness else 0,
                'area': self.get_area()
            },
            'finish_type': self.finish_type,
            'deadline_date': self.deadline_date.isoformat() if self.deadline_date else None,
            'priority_score': self.priority_score,
            'priority_group': self.priority_group,
            'requires_stabilization': self.requires_stabilization,
            'stabilization_length': float(self.stabilization_length) if self.stabilization_length else None,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'notes': self.notes,
            'current_assignment': self.get_current_assignment()
        }
    
    def get_area(self):
        """Oblicza powierzchnię produktu w cm²"""
        if self.dimensions_length and self.dimensions_width:
            return float(self.dimensions_length * self.dimensions_width)
        return 0
    
    def get_current_assignment(self):
        """Pobiera aktualne przypisanie (jeśli jest)"""
        assignment = ProdGluingAssignment.query.filter_by(
            item_id=self.id
        ).filter(
            ProdGluingAssignment.completed_at.is_(None)
        ).first()
        
        return assignment.to_dict() if assignment else None
    
    def calculate_priority_score(self):
        """Oblicza wynik priorytetowy na podstawie deadline i innych czynników"""
        try:
            if not self.deadline_date:
                return 999999  # Najniższy priorytet
            
            today = date.today()
            days_to_deadline = (self.deadline_date - today).days
            
            # Bazowy wynik (im mniej dni, tym wyższy priorytet = niższy score)
            base_score = max(1, days_to_deadline * 100)
            
            # Modyfikatory
            if self.requires_stabilization:
                base_score += 50  # Produkty ze stabilizacją nieco później
                
            # Powierzchnia - większe produkty mają wyższy priorytet
            area = self.get_area()
            if area > 5000:  # Duże produkty
                base_score -= 25
            elif area < 1000:  # Małe produkty
                base_score += 25
            
            self.priority_score = max(1, base_score)
            production_logger.debug("Obliczono priorytet", 
                                  item_id=self.id, priority_score=self.priority_score, days_to_deadline=days_to_deadline)
            
            return self.priority_score
            
        except Exception as e:
            production_logger.error("Błąd obliczania priorytetu", 
                                  item_id=self.id, error=str(e))
            return 999999
    
    @classmethod
    def get_queue_items(cls, limit=None):
        """Pobiera produkty w kolejce (status pending) posortowane po priorytecie"""
        query = cls.query.filter_by(status='pending').order_by(cls.priority_score.asc())
        if limit:
            query = query.limit(limit)
        return query.all()
    
    @classmethod
    def get_items_by_status(cls, status):
        """Pobiera produkty o danym statusie"""
        return cls.query.filter_by(status=status).order_by(cls.priority_score.asc()).all()
    
    @classmethod
    def parse_product_name(cls, product_name):
        """
        Parsuje nazwę produktu używając parsera z modułu reports
        Fallback: zwraca podstawowe dane z nazwy
        """
        try:
            # TODO: Import i użycie parsera z modułu reports
            # from modules.reports.utils import parse_product_name as reports_parser
            # parsed_data = reports_parser(product_name)
            
            # Tymczasowy fallback - prosty parsing
            production_logger.warning("Używam fallback parsera nazw", product_name=product_name)
            
            # Uproszczony parsing (do zastąpienia parserem z reports)
            parts = product_name.split()
            parsed = {
                'wood_species': None,
                'wood_technology': None,
                'wood_class': None,
                'dimensions_length': None,
                'dimensions_width': None,
                'dimensions_thickness': None,
                'finish_type': None,
                'display_name': product_name[:200]  # Skrócona nazwa
            }
            
            # Podstawowe wykrywanie wymiarów (format: 30x40x4)
            import re
            dimension_pattern = r'(\d+)x(\d+)x(\d+(?:\.\d+)?)'
            match = re.search(dimension_pattern, product_name)
            if match:
                parsed['dimensions_length'] = Decimal(match.group(1))
                parsed['dimensions_width'] = Decimal(match.group(2))  
                parsed['dimensions_thickness'] = Decimal(match.group(3))
            
            # Wykrywanie gatunku drewna
            wood_species = ['dąb', 'jesion', 'sosna', 'buk', 'brzoza', 'klon']
            for species in wood_species:
                if species.lower() in product_name.lower():
                    parsed['wood_species'] = species
                    break
            
            production_logger.debug("Sparsowano nazwę produktu", 
                                  product_name=product_name, parsed_data=parsed)
            return parsed
            
        except Exception as e:
            production_logger.error("Błąd parsowania nazwy produktu", 
                                  product_name=product_name, error=str(e))
            return {
                'display_name': product_name[:200],
                'wood_species': None,
                'wood_technology': None,
                'wood_class': None,
                'dimensions_length': None,
                'dimensions_width': None,
                'dimensions_thickness': None,
                'finish_type': None
            }


class ProdGluingAssignment(db.Model):
    """
    Model dla przypisań produktów do stanowisk klejenia
    """
    __tablename__ = 'prod_gluing_assignments'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Relacje
    item_id = db.Column(db.Integer, db.ForeignKey('prod_gluing_items.id'), nullable=False, comment="ID produktu")
    station_id = db.Column(db.Integer, db.ForeignKey('prod_gluing_stations.id'), nullable=False, comment="ID stanowiska")
    
    # Pozycjonowanie na stanowisku
    position_x = db.Column(db.Numeric(8, 2), default=0, comment="Pozycja X na stanowisku")
    position_y = db.Column(db.Numeric(8, 2), default=0, comment="Pozycja Y na stanowisku") 
    width_occupied = db.Column(db.Numeric(8, 2), comment="Zajmowana szerokość")
    height_occupied = db.Column(db.Numeric(8, 2), comment="Zajmowana wysokość")
    
    # Status produkcji
    worker_name = db.Column(db.String(100), comment="Imię pracownika")
    started_at = db.Column(db.DateTime, comment="Czas rozpoczęcia")
    completed_at = db.Column(db.DateTime, comment="Czas zakończenia")
    duration_seconds = db.Column(db.Integer, comment="Rzeczywisty czas w sekundach")
    overtime_seconds = db.Column(db.Integer, default=0, comment="Czas przekroczenia")
    
    # Specjalne flagi
    requires_stabilization = db.Column(db.Boolean, default=False, comment="Czy użyto stabilizacji")
    stabilization_length = db.Column(db.Numeric(8, 2), comment="Długość użytej lameli")
    
    # Metadane
    created_at = db.Column(db.DateTime, default=get_local_datetime, nullable=False)
    updated_at = db.Column(db.DateTime, default=get_local_datetime, onupdate=get_local_datetime)
    notes = db.Column(db.Text, comment="Notatki do przypisania")
    
    def __repr__(self):
        return f'<ProdGluingAssignment {self.id}: Item{self.item_id}→Station{self.station_id}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'item_id': self.item_id,
            'station_id': self.station_id,
            'position': {
                'x': float(self.position_x) if self.position_x else 0,
                'y': float(self.position_y) if self.position_y else 0
            },
            'occupied_size': {
                'width': float(self.width_occupied) if self.width_occupied else 0,
                'height': float(self.height_occupied) if self.height_occupied else 0
            },
            'worker_name': self.worker_name,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'duration_seconds': self.duration_seconds,
            'overtime_seconds': self.overtime_seconds,
            'requires_stabilization': self.requires_stabilization,
            'stabilization_length': float(self.stabilization_length) if self.stabilization_length else None,
            'notes': self.notes,
            'status': self.get_status(),
            'time_remaining': self.get_time_remaining()
        }
    
    def get_status(self):
        """Zwraca aktualny status przypisania"""
        if self.completed_at:
            return 'completed'
        elif self.started_at:
            return 'in_progress'
        else:
            return 'assigned'
    
    def get_time_remaining(self):
        """Zwraca pozostały czas w sekundach (może być ujemny = overtime)"""
        if not self.started_at or self.completed_at:
            return None
            
        try:
            standard_time_minutes = int(ProdGluingConfig.get_value('gluing_time_minutes', 20))
            standard_time_seconds = standard_time_minutes * 60
            
            elapsed = (get_local_datetime() - self.started_at).total_seconds()
            remaining = standard_time_seconds - elapsed
            
            return int(remaining)
            
        except Exception as e:
            production_logger.error("Błąd obliczania pozostałego czasu", 
                                  assignment_id=self.id, error=str(e))
            return None
    
    def start_production(self, worker_name):
        """Rozpoczyna produkcję na stanowisku"""
        try:
            if self.started_at:
                raise ValueError(f"Produkcja już rozpoczęta o {self.started_at}")
                
            self.worker_name = worker_name
            self.started_at = get_local_datetime()
            
            # Update status produktu
            if self.item:
                self.item.status = 'in_progress'
            
            db.session.commit()
            production_logger.info("Rozpoczęto produkcję", 
                                 assignment_id=self.id, worker_name=worker_name, 
                                 item_id=self.item_id, station_id=self.station_id)
            
            return self
            
        except Exception as e:
            production_logger.error("Błąd rozpoczynania produkcji", 
                                  assignment_id=self.id, worker_name=worker_name, error=str(e))
            db.session.rollback()
            raise
    
    def complete_production(self):
        """Kończy produkcję i oblicza statystyki"""
        try:
            if self.completed_at:
                raise ValueError(f"Produkcja już zakończona o {self.completed_at}")
                
            if not self.started_at:
                raise ValueError("Nie można zakończyć - produkcja nie była rozpoczęta")
            
            now = get_local_datetime()
            self.completed_at = now
            
            # Oblicz czasy
            duration = (now - self.started_at).total_seconds()
            self.duration_seconds = int(duration)
            
            # Oblicz overtime
            standard_time_minutes = int(ProdGluingConfig.get_value('gluing_time_minutes', 20))
            standard_time_seconds = standard_time_minutes * 60
            
            if duration > standard_time_seconds:
                self.overtime_seconds = int(duration - standard_time_seconds)
            
            # Update status produktu
            if self.item:
                self.item.status = 'completed'
            
            db.session.commit()
            production_logger.info("Zakończono produkcję", 
                                 assignment_id=self.id, duration_seconds=self.duration_seconds,
                                 overtime_seconds=self.overtime_seconds)
            
            return self
            
        except Exception as e:
            production_logger.error("Błąd kończenia produkcji", 
                                  assignment_id=self.id, error=str(e))
            db.session.rollback()
            raise
    
    @classmethod
    def create_assignment(cls, item_id, station_id, position_x=0, position_y=0):
        """Tworzy nowe przypisanie produktu do stanowiska"""
        try:
            # Sprawdź czy item i station istnieją
            item = ProdGluingItem.query.get(item_id)
            station = ProdGluingStation.query.get(station_id)
            
            if not item:
                raise ValueError(f"Nie znaleziono produktu ID: {item_id}")
            if not station:
                raise ValueError(f"Nie znaleziono stanowiska ID: {station_id}")
            
            # Sprawdź czy można umieścić produkt
            can_fit, reason = station.can_fit_product(item)
            if not can_fit:
                raise ValueError(f"Nie można umieścić produktu: {reason}")
            
            # Sprawdź czy produkt nie jest już przypisany
            existing = cls.query.filter_by(item_id=item_id).filter(
                cls.completed_at.is_(None)
            ).first()
            if existing:
                raise ValueError(f"Produkt już przypisany do stanowiska {existing.station_id}")
            
            # Oblicz zajmowane wymiary
            width_occupied = item.dimensions_length if item.dimensions_length else 0
            height_occupied = item.dimensions_width if item.dimensions_width else 0
            
            # Utwórz przypisanie
            assignment = cls(
                item_id=item_id,
                station_id=station_id,
                position_x=position_x,
                position_y=position_y,
                width_occupied=width_occupied,
                height_occupied=height_occupied,
                requires_stabilization=item.requires_stabilization
            )
            
            # Update status produktu
            item.status = 'assigned'
            
            db.session.add(assignment)
            db.session.commit()
            
            production_logger.info("Utworzono przypisanie", 
                                 assignment_id=assignment.id, item_id=item_id, 
                                 station_id=station_id, position_x=position_x, position_y=position_y)
            
            return assignment
            
        except Exception as e:
            production_logger.error("Błąd tworzenia przypisania", 
                                  item_id=item_id, station_id=station_id, error=str(e))
            db.session.rollback()
            raise
    
    @classmethod
    def get_active_assignments_for_station(cls, station_id):
        """Pobiera aktywne przypisania dla stanowiska"""
        return cls.query.filter_by(station_id=station_id).filter(
            cls.completed_at.is_(None)
        ).order_by(cls.created_at.asc()).all()
    
    @classmethod
    def get_production_stats(cls, date_from=None, date_to=None):
        """Pobiera statystyki produkcji dla danego okresu"""
        try:
            query = cls.query.filter(cls.completed_at.is_not(None))
            
            if date_from:
                query = query.filter(cls.completed_at >= date_from)
            if date_to:
                query = query.filter(cls.completed_at <= date_to)
            
            assignments = query.all()
            
            if not assignments:
                return {
                    'total_completed': 0,
                    'avg_duration_minutes': 0,
                    'max_duration_minutes': 0,
                    'min_duration_minutes': 0,
                    'overtime_count': 0,
                    'overtime_percent': 0
                }
            
            durations = [a.duration_seconds for a in assignments if a.duration_seconds]
            overtime_count = len([a for a in assignments if a.overtime_seconds > 0])
            
            stats = {
                'total_completed': len(assignments),
                'avg_duration_minutes': round(sum(durations) / len(durations) / 60, 1) if durations else 0,
                'max_duration_minutes': round(max(durations) / 60, 1) if durations else 0,
                'min_duration_minutes': round(min(durations) / 60, 1) if durations else 0,
                'overtime_count': overtime_count,
                'overtime_percent': round((overtime_count / len(assignments)) * 100, 1) if assignments else 0
            }
            
            production_logger.debug("Obliczono statystyki produkcji", stats=stats)
            return stats
            
        except Exception as e:
            production_logger.error("Błąd obliczania statystyk", error=str(e))
            return {
                'total_completed': 0,
                'avg_duration_minutes': 0,
                'max_duration_minutes': 0,
                'min_duration_minutes': 0,
                'overtime_count': 0,
                'overtime_percent': 0
            }


# ===================================================================
# POMOCNICZE FUNKCJE GLUING
# ===================================================================

def sync_items_from_baselinker():
    """
    Synchronizuje produkty z Baselinker do tabeli prod_gluing_items
    TODO: Implementacja schedulera
    """
    try:
        # TODO: Implementacja synchronizacji z Baselinker API
        # 1. Pobierz zamówienia z ostatnich X dni
        # 2. Filtruj produkty wymagające sklejenia  
        # 3. Parsuj nazwy produktów
        # 4. Utwórz rekordy w prod_gluing_items
        # 5. Oblicz priorytety
        
        production_logger.warning("sync_items_from_baselinker - TODO: implementacja")
        return {'success': False, 'message': 'TODO: implementacja'}
        
    except Exception as e:
        production_logger.error("Błąd synchronizacji z Baselinker", error=str(e))
        raise

def recalculate_all_priorities():
    """
    Przelicza priorytety wszystkich produktów pending
    """
    try:
        items = ProdGluingItem.get_items_by_status('pending')
        updated_count = 0
        
        for item in items:
            old_priority = item.priority_score
            new_priority = item.calculate_priority_score()
            if old_priority != new_priority:
                updated_count += 1
        
        if updated_count > 0:
            db.session.commit()
            production_logger.info("Przeliczono priorytety", updated_count=updated_count)
        
        return {'success': True, 'updated_count': updated_count}
        
    except Exception as e:
        production_logger.error("Błąd przeliczania priorytetów", error=str(e))
        db.session.rollback()
        raise

def get_gluing_dashboard_data():
    """
    Pobiera dane dla dashboardu gluing (tablet interface)
    """
    try:
        # Statystyki ogólne
        total_items = ProdGluingItem.query.count()
        pending_items = ProdGluingItem.query.filter_by(status='pending').count()
        in_progress_items = ProdGluingItem.query.filter_by(status='in_progress').count()
        completed_today = ProdGluingItem.query.join(ProdGluingAssignment).filter(
            ProdGluingAssignment.completed_at >= date.today()
        ).count()
        
        # Stanowiska z danymi
        stations = ProdGluingStation.get_stations_with_stats()
        
        # Kolejka (top 20)
        queue_items = ProdGluingItem.get_queue_items(limit=20)
        
        # Aktywne przypisania
        active_assignments = ProdGluingAssignment.query.filter(
            ProdGluingAssignment.completed_at.is_(None)
        ).all()
        
        dashboard_data = {
            'stats': {
                'total_items': total_items,
                'pending_items': pending_items,
                'in_progress_items': in_progress_items,
                'completed_today': completed_today
            },
            'stations': stations,
            'queue_items': [item.to_dict() for item in queue_items],
            'active_assignments': [assignment.to_dict() for assignment in active_assignments],
            'config': {
                'gluing_time_minutes': int(ProdGluingConfig.get_value('gluing_time_minutes', 20)),
                'auto_suggest_enabled': ProdGluingConfig.get_value('auto_suggest_enabled', '1') == '1',
                'show_priority_numbers': ProdGluingConfig.get_value('show_priority_numbers', '1') == '1'
            }
        }
        
        production_logger.debug("Wygenerowano dane dashboardu gluing", 
                              total_items=total_items, pending_items=pending_items)
        
        return dashboard_data
        
    except Exception as e:
        production_logger.error("Błąd generowania danych dashboardu", error=str(e))
        raise