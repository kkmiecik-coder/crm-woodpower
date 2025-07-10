from datetime import datetime
from extensions import db
# Import User z modułu calculator
from modules.calculator.models import User

class Workstation(db.Model):
    """Model stanowisk pracy w hali produkcyjnej"""
    __tablename__ = 'workstations'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)  # "Cięcie drewna", "Sklejanie", etc.
    sequence_order = db.Column(db.Integer, nullable=False)  # kolejność w workflow (1-6)
    tablet_identifier = db.Column(db.String(50), unique=True)  # "TABLET_CUTTING", etc.
    is_active = db.Column(db.Boolean, default=True)
    
    # Relacje
    progress_records = db.relationship('ProductionProgress', backref='workstation', lazy=True)
    current_batches = db.relationship('ProductionBatch', backref='current_workstation', lazy=True)
    
    def __repr__(self):
        return f'<Workstation {self.name}>'

class ProductionTask(db.Model):
    """Model zadań produkcyjnych utworzonych z zamówień Baselinker"""
    __tablename__ = 'production_tasks'
    
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
    coating_gloss = db.Column(db.String(20), nullable=True)  # "mat", "półmat", "połysk"
    coating_notes = db.Column(db.Text, nullable=True)  # dodatkowe info z komentarzy
    
    # Zarządzanie produkcją
    priority_order = db.Column(db.Integer, nullable=False, default=1000)
    estimated_completion_date = db.Column(db.Date, nullable=True)
    actual_start_date = db.Column(db.DateTime, nullable=True)
    actual_completion_date = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.Enum('pending', 'in_progress', 'completed', 'on_hold', 'cancelled', name='task_status'), 
                      default='pending')
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relacje
    progress_records = db.relationship('ProductionProgress', backref='production_task', lazy=True, cascade='all, delete-orphan')
    batch_relations = db.relationship('ProductionBatchTask', backref='task', lazy=True)
    alerts = db.relationship('ProductionAlert', backref='related_task', lazy=True)
    
    def __repr__(self):
        return f'<ProductionTask {self.id}: {self.product_name[:50]}>'
    
    def get_current_workstation(self):
        """Zwraca aktualne stanowisko pracy lub None jeśli ukończone"""
        if self.status == 'completed':
            return None
            
        # Znajdź pierwszy niezakończony etap
        for progress in sorted(self.progress_records, key=lambda x: x.workstation.sequence_order):
            if progress.status in ['pending', 'in_progress']:
                return progress.workstation
        return None
    
    def get_completion_percentage(self):
        """Zwraca procent ukończenia zadania"""
        if not self.progress_records:
            return 0
        
        completed_count = sum(1 for p in self.progress_records if p.status == 'completed')
        total_count = len(self.progress_records)
        
        return int((completed_count / total_count) * 100) if total_count > 0 else 0

class ProductionProgress(db.Model):
    """Model postępu zadania na poszczególnych stanowiskach"""
    __tablename__ = 'production_progress'
    
    id = db.Column(db.Integer, primary_key=True)
    production_task_id = db.Column(db.Integer, db.ForeignKey('production_tasks.id'), nullable=False)
    workstation_id = db.Column(db.Integer, db.ForeignKey('workstations.id'), nullable=False)
    
    status = db.Column(db.Enum('pending', 'in_progress', 'completed', 'skipped', name='progress_status'), 
                      default='pending')
    
    # Timestamps
    started_at = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    time_spent_minutes = db.Column(db.Integer, nullable=True)  # czas wykonania w minutach
    
    # Pracownik i urządzenie
    worker_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    tablet_identifier = db.Column(db.String(50), nullable=True)  # który tablet zarejestrował
    
    notes = db.Column(db.Text, nullable=True)  # uwagi pracownika
    
    # Relacje
    worker = db.relationship('User', backref='work_progress')
    
    def __repr__(self):
        return f'<ProductionProgress Task:{self.production_task_id} Station:{self.workstation_id}>'
    
    def start_work(self, worker_user_id=None, tablet_id=None):
        """Rozpoczyna pracę na stanowisku"""
        self.status = 'in_progress'
        self.started_at = datetime.utcnow()
        self.worker_user_id = worker_user_id
        self.tablet_identifier = tablet_id
        db.session.commit()
    
    def complete_work(self, notes=None):
        """Kończy pracę na stanowisku"""
        self.status = 'completed'
        self.completed_at = datetime.utcnow()
        if self.started_at:
            time_diff = self.completed_at - self.started_at
            self.time_spent_minutes = int(time_diff.total_seconds() / 60)
        if notes:
            self.notes = notes
        db.session.commit()

class ProductionBatch(db.Model):
    """Model partii produkcyjnych - grupowanie zadań"""
    __tablename__ = 'production_batches'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)  # "DĄB-MIK-001"
    
    # Właściwości partii
    wood_species = db.Column(db.String(20), nullable=False)  # "dąb"
    technology = db.Column(db.String(20), nullable=False)  # "mikrowczep"
    
    # Daty
    batch_date = db.Column(db.Date, default=datetime.utcnow().date)
    planned_start_date = db.Column(db.Date, nullable=True)
    actual_start_date = db.Column(db.Date, nullable=True)
    actual_completion_date = db.Column(db.Date, nullable=True)
    
    # Status i postęp
    current_workstation_id = db.Column(db.Integer, db.ForeignKey('workstations.id'), nullable=True)
    status = db.Column(db.Enum('planned', 'in_progress', 'completed', 'cancelled', name='batch_status'), 
                      default='planned')
    
    # Statystyki
    task_count = db.Column(db.Integer, default=0)
    completed_task_count = db.Column(db.Integer, default=0)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relacje
    task_relations = db.relationship('ProductionBatchTask', backref='batch', lazy=True)
    alerts = db.relationship('ProductionAlert', backref='related_batch', lazy=True)
    
    def __repr__(self):
        return f'<ProductionBatch {self.name}>'
    
    def get_completion_percentage(self):
        """Zwraca procent ukończenia partii"""
        if self.task_count == 0:
            return 0
        return int((self.completed_task_count / self.task_count) * 100)
    
    def update_task_counts(self):
        """Aktualizuje liczniki zadań w partii"""
        self.task_count = len(self.task_relations)
        self.completed_task_count = sum(1 for tr in self.task_relations 
                                      if tr.task.status == 'completed')
        db.session.commit()

class ProductionBatchTask(db.Model):
    """Model relacji między zadaniami a partiami"""
    __tablename__ = 'production_batch_tasks'
    
    id = db.Column(db.Integer, primary_key=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('production_batches.id'), nullable=False)
    production_task_id = db.Column(db.Integer, db.ForeignKey('production_tasks.id'), nullable=False)
    sequence_in_batch = db.Column(db.Integer, nullable=False)  # kolejność w partii
    
    # Unikalne powiązanie zadanie-partia
    __table_args__ = (db.UniqueConstraint('batch_id', 'production_task_id', name='unique_batch_task'),)
    
    def __repr__(self):
        return f'<BatchTask B:{self.batch_id} T:{self.production_task_id}>'

class ProductionAlert(db.Model):
    """Model alertów i powiadomień"""
    __tablename__ = 'production_alerts'
    
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
    
    def __repr__(self):
        return f'<ProductionAlert {self.alert_type}: {self.title}>'

class ProductionWorkflow(db.Model):
    """Model definicji workflow dla różnych typów produktów"""
    __tablename__ = 'production_workflows'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Typ produktu
    wood_species = db.Column(db.String(20), nullable=False)  # "dąb"
    technology = db.Column(db.String(20), nullable=False)  # "lity"
    needs_coating = db.Column(db.Boolean, nullable=False)  # true/false
    
    # Definicja workflow
    workstation_sequence = db.Column(db.JSON)  # [1,2,3,4,5,6] lub [1,2,3,4,6]
    estimated_time_minutes = db.Column(db.JSON)  # {"1": 45, "2": 60, "3": 30, ...}
    
    # Unikalne połączenie typu produktu
    __table_args__ = (db.UniqueConstraint('wood_species', 'technology', 'needs_coating', 
                                        name='unique_workflow'),)
    
    def __repr__(self):
        return f'<Workflow {self.wood_species}-{self.technology}-coating:{self.needs_coating}>'