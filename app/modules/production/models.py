# modules/production/models.py
"""
Modele bazy danych dla modułu Production
"""

from extensions import db
from datetime import datetime, timedelta
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
    
    # Relacje - POPRAWIONE BEZ REKURSJI
    glued_items = db.relationship('ProductionItem', foreign_keys='ProductionItem.glued_at_station_id', backref='glued_at_station', lazy=True)

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
    
    # Relacje
    glued_items = db.relationship('ProductionItem', foreign_keys='ProductionItem.glued_by_worker_id', backref='glued_by_worker', lazy=True)
    
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
    glued_at_station_id = db.Column(db.Integer, db.ForeignKey('production_stations.id'), nullable=True, comment="Stanowisko sklejania")
    glued_by_worker_id = db.Column(db.Integer, db.ForeignKey('workers.id'), nullable=True, comment="Pracownik który sklejał")
    
    # === CZASY REALIZACJI ===
    gluing_started_at = db.Column(db.DateTime, nullable=True, comment="Rozpoczęcie sklejania")
    gluing_completed_at = db.Column(db.DateTime, nullable=True, comment="Zakończenie sklejania")
    gluing_duration_seconds = db.Column(db.Integer, nullable=True, comment="Rzeczywisty czas sklejania")
    gluing_overtime_seconds = db.Column(db.Integer, nullable=True, comment="Czas przekroczenia")
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
            'glued_at_station': self.glued_at_station.to_dict() if self.glued_at_station else None,
            'glued_by_worker': self.glued_by_worker.to_dict() if self.glued_by_worker else None,
            'gluing_started_at': self.gluing_started_at.isoformat() if self.gluing_started_at else None,
            'gluing_completed_at': self.gluing_completed_at.isoformat() if self.gluing_completed_at else None,
            'gluing_duration_seconds': self.gluing_duration_seconds,
            'gluing_overtime_seconds': self.gluing_overtime_seconds,
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
    
    @property
    def gluing_time_formatted(self):
        """Sformatowany czas sklejania"""
        if self.gluing_duration_seconds:
            minutes = self.gluing_duration_seconds // 60
            seconds = self.gluing_duration_seconds % 60
            return f"{minutes}:{seconds:02d}"
        return None
    
    def start_gluing(self, worker_id, station_id):
        """Rozpoczyna proces sklejania"""
        try:
            # POPRAWKA: Użyj czasu lokalnego zamiast UTC dla Polski
            from datetime import datetime
            import pytz
        
            # Strefa czasowa dla Polski
            poland_tz = pytz.timezone('Europe/Warsaw')
        
            # Zapisz czas lokalny Polski
            self.gluing_started_at = datetime.now(poland_tz).replace(tzinfo=None)
        
            self.glued_by_worker_id = worker_id
            self.glued_at_station_id = station_id
            db.session.commit()
            production_logger.info("Rozpoczęto sklejanie produktu",
                                 item_id=self.id, product_name=self.product_name,
                                 worker_id=worker_id, station_id=station_id,
                                 started_at=self.gluing_started_at.isoformat())
        except Exception as e:
            production_logger.error("Błąd podczas rozpoczynania sklejania",
                                  item_id=self.id, worker_id=worker_id, station_id=station_id,
                                  error=str(e), error_type=type(e).__name__)
            db.session.rollback()
            raise
    
    def complete_gluing(self):
        """Kończy proces sklejania"""
        try:
            if self.gluing_started_at:
                # POPRAWKA: Użyj czasu lokalnego zamiast UTC dla Polski
                from datetime import datetime
                import pytz
            
                # Strefa czasowa dla Polski
                poland_tz = pytz.timezone('Europe/Warsaw')
            
                # Zapisz czas lokalny Polski
                self.gluing_completed_at = datetime.now(poland_tz).replace(tzinfo=None)
            
                duration = self.gluing_completed_at - self.gluing_started_at
                self.gluing_duration_seconds = int(duration.total_seconds())
            
                # Oblicz overtime jeśli przekroczył normę
                standard_time = int(ProductionConfig.get_value('gluing_time_minutes', '20')) * 60
                if self.gluing_duration_seconds > standard_time:
                    self.gluing_overtime_seconds = self.gluing_duration_seconds - standard_time
            
                db.session.commit()
                production_logger.info("Zakończono sklejanie produktu",
                                     item_id=self.id, product_name=self.product_name,
                                     duration_seconds=self.gluing_duration_seconds,
                                     overtime_seconds=self.gluing_overtime_seconds,
                                     completed_at=self.gluing_completed_at.isoformat())
            else:
                production_logger.warning("Próba zakończenia sklejania bez rozpoczęcia",
                                        item_id=self.id, product_name=self.product_name)
            
        except Exception as e:
            production_logger.error("Błąd podczas kończenia sklejania",
                                  item_id=self.id, error=str(e), error_type=type(e).__name__)
            db.session.rollback()
            raise
    
    @classmethod
    def get_queue_items(cls, limit=None):
        """Pobiera produkty z kolejki do sklejania (posortowane według priorytetów)"""
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
    
    @classmethod
    def get_by_baselinker_order_product(cls, order_id, product_id):
        """Znajduje produkt po ID zamówienia i produktu z Baselinker"""
        return cls.query.filter_by(
            baselinker_order_id=order_id,
            baselinker_order_product_id=product_id
        ).first()

    def is_ready_for_packaging(self):
        """
        Sprawdza czy produkt jest gotowy do pakowania (sklejony)
        """
        return (
            self.status.name == 'completed' and 
            self.gluing_completed_at is not None
        )

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
        Oblicza czas oczekiwania od sklejenia do pakowania w godzinach
        """
        try:
            if not self.gluing_completed_at:
                return None
            
            reference_time = self.packaging_started_at or datetime.utcnow()
            
            waiting_time = (reference_time - self.gluing_completed_at).total_seconds() / 3600.0
            return round(waiting_time, 1) if waiting_time >= 0 else None
            
        except Exception as e:
            production_logger.error(
                f"Błąd obliczania czasu oczekiwania produktu {self.id}", 
                error=str(e)
            )
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