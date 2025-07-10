# Zastąp plik app/modules/production/models.py tym kodem

from datetime import datetime
from extensions import db
# Import User z modułu calculator
from modules.calculator.models import User

class Workstation(db.Model):
    """Model stanowisk pracy w hali produkcyjnej"""
    __tablename__ = 'workstations'
    __table_args__ = {'extend_existing': True}
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)  # "Cięcie drewna", "Sklejanie", etc.
    sequence_order = db.Column(db.Integer, nullable=False)  # kolejność w workflow (1-6)
    tablet_identifier = db.Column(db.String(50), unique=True)  # "TABLET_CUTTING", etc.
    is_active = db.Column(db.Boolean, default=True)
    
    def __repr__(self):
        return f'<Workstation {self.name}>'

class ProductionTask(db.Model):
    """Model zadań produkcyjnych utworzonych z zamówień Baselinker"""
    __tablename__ = 'production_tasks'
    __table_args__ = {'extend_existing': True}
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Powiązania z Baselinker i CRM
    baselinker_order_id = db.Column(db.Integer, nullable=False)
    baselinker_product_id = db.Column(db.Integer, nullable=False)
    quote_id = db.Column(db.Integer, nullable=True)  # może być NULL dla zamówień z Allegro/Sklepu
    product_index = db.Column(db.Integer, nullable=True)  # dla produktów z CRM
    
    # Informacje o produkcie
    product_name = db.Column(db.Text, nullable=False)  # pełna nazwa produktu
    variant_code = db.Column(db.String(50), nullable=True)  # dla produktów z CRM
    dimensions = db.Column(db.String(50), nullable=False)  # "180x70x3 cm"
    quantity = db.Column(db.Integer, nullable=False, default=1)
    
    # Rozpoznane właściwości produktu
    wood_species = db.Column(db.String(20), nullable=False)  # "dąb", "jesion", "buk"
    technology = db.Column(db.String(20), nullable=False)  # "lity", "mikrowczep"
    wood_class = db.Column(db.String(10), nullable=True)  # "A/B", "B/B"
    needs_coating = db.Column(db.Boolean, default=False)
    coating_type = db.Column(db.String(20), nullable=True)  # "lakier", "olej", "wosk"
    coating_color = db.Column(db.String(50), nullable=True)  # "bezbarwny", "biały", etc.
    
    # Status i priorytety
    status = db.Column(db.Enum('pending', 'in_progress', 'completed', 'cancelled', name='task_status'),
                      default='pending', nullable=False)
    priority_order = db.Column(db.Integer, default=999)  # im niższa wartość, tym wyższy priorytet
    
    # Daty
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    planned_start_date = db.Column(db.Date, nullable=True)
    actual_start_date = db.Column(db.DateTime, nullable=True)
    estimated_completion_date = db.Column(db.Date, nullable=True)
    actual_completion_date = db.Column(db.DateTime, nullable=True)
    
    # Dodatkowe informacje
    notes = db.Column(db.Text, nullable=True)  # uwagi do zadania
    created_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    def get_completion_percentage(self) -> int:
        """Oblicza procent ukończenia zadania"""
        try:
            total_steps = ProductionProgress.query.filter_by(production_task_id=self.id).count()
            completed_steps = ProductionProgress.query.filter_by(
                production_task_id=self.id, 
                status='completed'
            ).count()
            
            if total_steps == 0:
                return 0
            
            return int((completed_steps / total_steps) * 100)
            
        except Exception:
            return 0

    def get_current_workstation(self):
        """Pobiera aktualne stanowisko dla zadania"""
        try:
            current_progress = ProductionProgress.query.filter_by(
                production_task_id=self.id,
                status='in_progress'
            ).first()
            
            if current_progress:
                return current_progress.workstation
            
            # Jeśli brak zadania w trakcie, sprawdź następne oczekujące
            next_progress = ProductionProgress.query.filter_by(
                production_task_id=self.id,
                status='pending'
            ).order_by(ProductionProgress.sequence_order).first()
            
            if next_progress:
                return next_progress.workstation
            
            return None
            
        except Exception:
            return None

    def update_status_based_on_progress(self):
        """Aktualizuje status zadania na podstawie postępu"""
        try:
            in_progress_count = ProductionProgress.query.filter_by(
                production_task_id=self.id,
                status='in_progress'
            ).count()
            
            total_count = ProductionProgress.query.filter_by(production_task_id=self.id).count()
            completed_count = ProductionProgress.query.filter_by(
                production_task_id=self.id,
                status='completed'
            ).count()
            
            if in_progress_count > 0:
                self.status = 'in_progress'
            elif completed_count == total_count and total_count > 0:
                self.status = 'completed'
                self.actual_completion_date = datetime.utcnow()
            else:
                self.status = 'pending'
                
        except Exception as e:
            print(f"Błąd aktualizacji statusu zadania {self.id}: {str(e)}")
    
    def __repr__(self):
        return f'<ProductionTask {self.id}: {self.product_name[:30]}>'

class ProductionProgress(db.Model):
    """Model postępu zadania produkcyjnego przez stanowiska"""
    __tablename__ = 'production_progress'
    __table_args__ = (
        db.UniqueConstraint('production_task_id', 'workstation_id', name='unique_task_workstation'),
        {'extend_existing': True}
    )
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Powiązania
    production_task_id = db.Column(db.Integer, db.ForeignKey('production_tasks.id'), nullable=False)
    workstation_id = db.Column(db.Integer, db.ForeignKey('workstations.id'), nullable=False)
    
    # Kolejność i status
    sequence_order = db.Column(db.Integer, nullable=False)  # kolejność w workflow (1,2,3...)
    status = db.Column(db.Enum('pending', 'in_progress', 'completed', 'skipped', name='progress_status'),
                      default='pending', nullable=False)
    
    # Czasy
    planned_start_time = db.Column(db.DateTime, nullable=True)
    actual_start_time = db.Column(db.DateTime, nullable=True)
    estimated_duration_minutes = db.Column(db.Integer, nullable=True)
    actual_duration_minutes = db.Column(db.Integer, nullable=True)
    actual_end_time = db.Column(db.DateTime, nullable=True)
    
    # Dodatkowe informacje
    worker_notes = db.Column(db.Text, nullable=True)
    quality_check_passed = db.Column(db.Boolean, nullable=True)
    
    # Relacje
    task = db.relationship('ProductionTask', backref='progress_entries')
    workstation = db.relationship('Workstation', backref='progress_records')
    
    def __repr__(self):
        return f'<ProductionProgress T:{self.production_task_id} W:{self.workstation_id} {self.status}>'

class ProductionBatch(db.Model):
    """Model partii produkcyjnych - grupowanie zadań"""
    __tablename__ = 'production_batches'
    __table_args__ = {'extend_existing': True}
    
    id = db.Column(db.Integer, primary_key=True)
    batch_name = db.Column(db.String(100), nullable=False)
    batch_date = db.Column(db.Date, nullable=False)
    wood_species = db.Column(db.String(20), nullable=False)
    technology = db.Column(db.String(20), nullable=False)
    status = db.Column(db.Enum('planned', 'in_progress', 'completed', 'cancelled', name='batch_status'),
                      default='planned', nullable=False)
    planned_start_date = db.Column(db.Date, nullable=True)
    actual_start_date = db.Column(db.Date, nullable=True)
    planned_completion_date = db.Column(db.Date, nullable=True)
    actual_completion_date = db.Column(db.Date, nullable=True)
    current_workstation_id = db.Column(db.Integer, db.ForeignKey('workstations.id'), nullable=True)
    task_count = db.Column(db.Integer, default=0)
    completed_task_count = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    notes = db.Column(db.Text, nullable=True)
    
    # Relacje
    current_workstation = db.relationship('Workstation', backref='current_batches')
    
    def __repr__(self):
        return f'<ProductionBatch {self.batch_name}>'

class ProductionBatchTask(db.Model):
    """Model relacji między zadaniami a partiami"""
    __tablename__ = 'production_batch_tasks'
    __table_args__ = (
        db.UniqueConstraint('batch_id', 'production_task_id', name='unique_batch_task'),
        {'extend_existing': True}
    )
    
    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('production_batches.id'), nullable=False)
    production_task_id = db.Column(db.Integer, db.ForeignKey('production_tasks.id'), nullable=False)
    sequence_in_batch = db.Column(db.Integer, nullable=False)  # kolejność w partii
    
    # Relacje
    batch = db.relationship('ProductionBatch', backref='task_relations')
    task = db.relationship('ProductionTask', backref='batch_relations')
    
    def __repr__(self):
        return f'<BatchTask B:{self.batch_id} T:{self.production_task_id}>'

class ProductionAlert(db.Model):
    """Model alertów i powiadomień"""
    __tablename__ = 'production_alerts'
    __table_args__ = {'extend_existing': True}
    
    id = db.Column(db.Integer, primary_key=True)
    alert_type = db.Column(db.Enum('delay', 'bottleneck', 'completion', 'error', name='alert_type'), 
                          nullable=False)
    
    title = db.Column(db.String(200), nullable=False)
    message = db.Column(db.Text, nullable=False)
    
    # Powiązania
    related_task_id = db.Column(db.Integer, db.ForeignKey('production_tasks.id'), nullable=True)
    related_batch_id = db.Column(db.Integer, db.ForeignKey('production_batches.id'), nullable=True)
    
    # Status
    is_read = db.Column(db.Boolean, default=False)
    email_sent = db.Column(db.Boolean, default=False)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relacje
    related_task = db.relationship('ProductionTask', backref='alerts')
    related_batch = db.relationship('ProductionBatch', backref='alerts')
    
    def __repr__(self):
        return f'<ProductionAlert {self.alert_type}: {self.title}>'

class ProductionWorkflow(db.Model):
    """Model definicji workflow dla różnych typów produktów"""
    __tablename__ = 'production_workflows'
    __table_args__ = (
        db.UniqueConstraint('wood_species', 'technology', 'needs_coating', name='unique_workflow'),
        {'extend_existing': True}
    )
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Typ produktu
    wood_species = db.Column(db.String(20), nullable=False)  # "dąb"
    technology = db.Column(db.String(20), nullable=False)  # "lity"
    needs_coating = db.Column(db.Boolean, nullable=False)  # true/false
    
    # Definicja workflow
    workstation_sequence = db.Column(db.JSON)  # [1,2,3,4,5,6] lub [1,2,3,4,6]
    estimated_time_minutes = db.Column(db.JSON)  # {"1": 45, "2": 60, "3": 30, ...}
    
    def __repr__(self):
        return f'<Workflow {self.wood_species}-{self.technology}-coating:{self.needs_coating}>'