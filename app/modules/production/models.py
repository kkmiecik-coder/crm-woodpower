# modules/production/models.py
"""
Modele bazy danych dla modułu Production
"""

from extensions import db
from datetime import datetime, timedelta
from sqlalchemy import Index
from decimal import Decimal
from modules.logging import get_structured_logger

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    
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
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
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
                config.updated_at = datetime.utcnow()
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    
    # Relacje
    current_item = db.relationship('ProductionItem', foreign_keys=[current_item_id], post_update=True)
    glued_items = db.relationship('ProductionItem', foreign_keys='ProductionItem.glued_at_station_id', backref='glued_at_station', lazy=True)
    
    def __repr__(self):
        return f'<ProductionStation {self.name} ({self.station_type})>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'station_type': self.station_type,
            'is_active': self.is_active,
            'current_item_id': self.current_item_id,
            'current_item': self.current_item.to_dict() if self.current_item else None,
            'last_activity_at': self.last_activity_at.isoformat() if self.last_activity_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
    
    @property
    def is_busy(self):
        """Sprawdza czy stanowisko jest zajęte"""
        return self.current_item_id is not None
    
    def set_current_item(self, item_id):
        """Ustawia aktualny produkt na stanowisku"""
        try:
            self.current_item_id = item_id
            self.last_activity_at = datetime.utcnow()
            db.session.commit()
            production_logger.info("Ustawiono produkt na stanowisku", 
                                 station_id=self.id, station_name=self.name, item_id=item_id)
        except Exception as e:
            production_logger.error("Błąd podczas ustawiania produktu na stanowisku",
                                  station_id=self.id, item_id=item_id, error=str(e))
            db.session.rollback()
            raise
    
    def clear_current_item(self):
        """Czyści aktualny produkt ze stanowiska"""
        try:
            old_item_id = self.current_item_id
            self.current_item_id = None
            self.last_activity_at = datetime.utcnow()
            db.session.commit()
            production_logger.info("Wyczyszczono produkt ze stanowiska",
                                 station_id=self.id, station_name=self.name, old_item_id=old_item_id)
        except Exception as e:
            production_logger.error("Błąd podczas czyszczenia produktu ze stanowiska",
                                  station_id=self.id, error=str(e))
            db.session.rollback()
            raise


class Worker(db.Model):
    """
    Model dla pracowników
    """
    __tablename__ = 'workers'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, comment="Imię i nazwisko pracownika")
    is_active = db.Column(db.Boolean, default=True, nullable=False, comment="Czy pracownik aktywny")
    station_type_preference = db.Column(db.Enum('gluing', 'packaging', 'both', name='worker_preference_enum'), default='both', comment="Preferowany typ stanowiska")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
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
            self.gluing_started_at = datetime.utcnow()
            self.glued_by_worker_id = worker_id
            self.glued_at_station_id = station_id
            db.session.commit()
            production_logger.info("Rozpoczęto sklejanie produktu",
                                 item_id=self.id, product_name=self.product_name,
                                 worker_id=worker_id, station_id=station_id)
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
                self.gluing_completed_at = datetime.utcnow()
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
                                     overtime_seconds=self.gluing_overtime_seconds)
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
        query = cls.query.join(ProductionStatus).filter(
            ProductionStatus.name == 'pending'
        ).order_by(
            cls.priority_score.desc(),
            cls.deadline_date.asc(),
            cls.created_at.asc()
        )
        
        if limit:
            query = query.limit(limit)
            
        return query.all()
    
    @classmethod
    def get_by_baselinker_order_product(cls, order_id, product_id):
        """Znajduje produkt po ID zamówienia i produktu z Baselinker"""
        return cls.query.filter_by(
            baselinker_order_id=order_id,
            baselinker_order_product_id=product_id
        ).first()


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
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
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