from extensions import db
from datetime import datetime
import sys

# Import modeli potrzebnych dla Foreign Key
try:
    from modules.calculator.models import Quote, User
    from modules.clients.models import Client  
    from modules.quotes.models import QuoteStatus
    print("[Scheduler Models] Importy modeli udane", file=sys.stderr)
except ImportError as e:
    print(f"[Scheduler Models] Błąd importu modeli: {e}", file=sys.stderr)
    # W przypadku błędu importu, Foreign Key będą bez relacji
    pass

class EmailSchedule(db.Model):
    """
    Model dla harmonogramu wysyłanych maili automatycznych
    """
    __tablename__ = 'scheduler_email_schedule'
    
    id = db.Column(db.Integer, primary_key=True)
    quote_id = db.Column(db.Integer, db.ForeignKey('quotes.id'), nullable=False)
    email_type = db.Column(db.String(50), nullable=False)  # 'quote_reminder_7_days'
    recipient_email = db.Column(db.String(255), nullable=False)
    scheduled_date = db.Column(db.DateTime, nullable=False)  # Kiedy ma zostać wysłane
    sent_date = db.Column(db.DateTime, nullable=True)  # Kiedy faktycznie wysłano
    status = db.Column(db.String(20), default='pending', nullable=False)  # pending/sent/failed/cancelled
    attempts = db.Column(db.Integer, default=0)  # Liczba prób wysłania
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relacja z wycenami - tylko jeśli model Quote został zaimportowany
    try:
        quote = db.relationship('Quote', backref='scheduled_emails', foreign_keys=[quote_id])
    except:
        pass
    
    def __repr__(self):
        return f'<EmailSchedule {self.email_type} for Quote {self.quote_id}>'


class EmailLog(db.Model):
    """
    Model dla logów wysyłanych maili - przechowuje szczegóły i błędy
    """
    __tablename__ = 'scheduler_email_log'
    
    id = db.Column(db.Integer, primary_key=True)
    schedule_id = db.Column(db.Integer, db.ForeignKey('scheduler_email_schedule.id'), nullable=True)
    quote_id = db.Column(db.Integer, db.ForeignKey('quotes.id'), nullable=True)  # ZMIENIONE: nullable=True dla system jobów
    email_type = db.Column(db.String(50), nullable=False)
    job_type = db.Column(db.String(50), nullable=True)  # NOWE: typ zadania schedulera
    recipient_email = db.Column(db.String(255), nullable=False)
    subject = db.Column(db.String(255), nullable=True)  # NOWE: temat emaila
    content = db.Column(db.Text, nullable=True)  # NOWE: treść wiadomości
    status = db.Column(db.String(20), nullable=False)  # success/failed/error
    error_message = db.Column(db.Text, nullable=True)  # Opis błędu jeśli wystąpił
    sent_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relacje - tylko jeśli modele zostały zaimportowane
    try:
        schedule = db.relationship('EmailSchedule', backref='logs', foreign_keys=[schedule_id])
        quote = db.relationship('Quote', backref='email_logs', foreign_keys=[quote_id])
    except:
        pass
    
    def __repr__(self):
        return f'<EmailLog {self.email_type} - {self.status}>'


class SchedulerConfig(db.Model):
    """
    Model dla konfiguracji schedulera - ustawienia globalne
    """
    __tablename__ = 'scheduler_config'
    
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<SchedulerConfig {self.key}: {self.value}>'


class JobState(db.Model):
    """
    Model dla trwałego przechowywania stanów zadań schedulera
    """
    __tablename__ = 'scheduler_job_states'
    
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.String(100), unique=True, nullable=False)  # ID zadania np. 'quote_check_daily'
    state = db.Column(db.String(20), nullable=False, default='active')  # 'active', 'paused'
    last_run = db.Column(db.DateTime, nullable=True)  # Ostatnie uruchomienie
    next_run = db.Column(db.DateTime, nullable=True)  # Następne zaplanowane uruchomienie
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<JobState {self.job_id}: {self.state}>'


def create_default_scheduler_config():
    """
    Tworzy domyślne ustawienia schedulera jeśli nie istnieją
    UPROSZCZONE: Bez quote_reminder_enabled (kontrola przez scheduler)
    """
    defaults = [
        # USUNIĘTO: quote_reminder_enabled (kontrola przez wstrzymanie/wznowienie zadań)
        {
            'key': 'quote_reminder_days',
            'value': '7',
            'description': 'Po ilu dniach sprawdzać wyceny (minimum)'
        },
        {
            'key': 'quote_reminder_max_days',
            'value': '30',
            'description': 'Maksymalny wiek wycen do sprawdzania (dni)'
        },
        {
            'key': 'daily_check_hour',
            'value': '16',
            'description': 'O której godzinie sprawdzać codziennie (0-23)'
        },
        {
            'key': 'daily_check_minute',
            'value': '0',
            'description': 'O której minucie sprawdzać codziennie (0-59)'
        },
        {
            'key': 'email_send_delay',
            'value': '1',
            'description': 'Po ilu godzinach od sprawdzania wysłać emaile'
        },
        {
            'key': 'max_reminder_attempts',
            'value': '3',
            'description': 'Maksymalna liczba prób wysłania przypomnienia'
        }
    ]
    
    for config in defaults:
        existing = SchedulerConfig.query.filter_by(key=config['key']).first()
        if not existing:
            new_config = SchedulerConfig(
                key=config['key'],
                value=config['value'],
                description=config['description']
            )
            db.session.add(new_config)
    
    try:
        db.session.commit()
        print("[Scheduler] Domyślne konfiguracje zostały utworzone", file=sys.stderr)
    except Exception as e:
        db.session.rollback()
        print(f"[Scheduler] Błąd tworzenia konfiguracji: {e}", file=sys.stderr)

def save_job_state(job_id, state, next_run_time=None):
    """
    Zapisuje stan zadania do bazy danych (nowy model JobState)
    
    Args:
        job_id: ID zadania
        state: Stan zadania ('active' lub 'paused')
        next_run_time: Następne uruchomienie (opcjonalne)
    """
    try:
        print(f"[JobState] Zapisuję stan zadania {job_id}: {state}", file=sys.stderr)
        
        # Znajdź lub utwórz wpis stanu zadania
        job_state = JobState.query.filter_by(job_id=job_id).first()
        
        if job_state:
            # Aktualizuj istniejący
            job_state.state = state
            job_state.updated_at = datetime.utcnow()
            if next_run_time:
                job_state.next_run = next_run_time
            print(f"[JobState] Zaktualizowano istniejący stan zadania {job_id}", file=sys.stderr)
        else:
            # Utwórz nowy
            job_state = JobState(
                job_id=job_id,
                state=state,
                next_run=next_run_time
            )
            db.session.add(job_state)
            print(f"[JobState] Utworzono nowy stan zadania {job_id}", file=sys.stderr)
        
        db.session.commit()
        print(f"[JobState] ✅ Zapisano stan zadania {job_id}: {state}", file=sys.stderr)
        return True
        
    except Exception as e:
        print(f"[JobState] ❌ Błąd zapisu stanu zadania {job_id}: {e}", file=sys.stderr)
        db.session.rollback()
        return False


def get_job_state(job_id):
    """
    Pobiera zapisany stan zadania z bazy danych
    
    Args:
        job_id: ID zadania
        
    Returns:
        dict: Stan zadania lub None jeśli nie znaleziono
    """
    try:
        job_state = JobState.query.filter_by(job_id=job_id).first()
        
        if job_state:
            result = {
                'state': job_state.state,
                'last_run': job_state.last_run,
                'next_run': job_state.next_run,
                'updated_at': job_state.updated_at
            }
            print(f"[JobState] ✅ Odczytano stan zadania {job_id}: {job_state.state}", file=sys.stderr)
            return result
        else:
            print(f"[JobState] ℹ️ Brak zapisanego stanu dla zadania {job_id}", file=sys.stderr)
            return None
            
    except Exception as e:
        print(f"[JobState] ❌ Błąd odczytu stanu zadania {job_id}: {e}", file=sys.stderr)
        return None


def get_all_job_states():
    """
    Pobiera wszystkie stany zadań z bazy danych
    
    Returns:
        dict: Słownik {job_id: state_info}
    """
    try:
        all_states = JobState.query.all()
        result = {}
        
        for job_state in all_states:
            result[job_state.job_id] = {
                'state': job_state.state,
                'last_run': job_state.last_run,
                'next_run': job_state.next_run,
                'updated_at': job_state.updated_at
            }
        
        print(f"[JobState] Odczytano stany {len(result)} zadań z bazy", file=sys.stderr)
        return result
        
    except Exception as e:
        print(f"[JobState] Błąd odczytu wszystkich stanów: {e}", file=sys.stderr)
        return {}


def update_job_last_run(job_id):
    """
    Aktualizuje czas ostatniego uruchomienia zadania
    
    Args:
        job_id: ID zadania
    """
    try:
        job_state = JobState.query.filter_by(job_id=job_id).first()
        
        if job_state:
            job_state.last_run = datetime.utcnow()
            job_state.updated_at = datetime.utcnow()
            db.session.commit()
            print(f"[JobState] Zaktualizowano last_run dla zadania {job_id}", file=sys.stderr)
        else:
            # Utwórz nowy wpis jeśli nie istnieje
            job_state = JobState(
                job_id=job_id,
                state='active',
                last_run=datetime.utcnow()
            )
            db.session.add(job_state)
            db.session.commit()
            print(f"[JobState] Utworzono nowy wpis z last_run dla zadania {job_id}", file=sys.stderr)
            
    except Exception as e:
        print(f"[JobState] Błąd aktualizacji last_run dla {job_id}: {e}", file=sys.stderr)
        db.session.rollback()


def initialize_default_job_states():
    """
    Inicjalizuje domyślne stany dla znanych zadań
    """
    try:
        default_jobs = [
            'quote_check_daily',
            'email_send_daily'
        ]
        
        for job_id in default_jobs:
            existing = JobState.query.filter_by(job_id=job_id).first()
            if not existing:
                job_state = JobState(
                    job_id=job_id,
                    state='active'
                )
                db.session.add(job_state)
                print(f"[JobState] Utworzono domyślny stan dla zadania {job_id}", file=sys.stderr)
        
        db.session.commit()
        print("[JobState] Zainicjalizowano domyślne stany zadań", file=sys.stderr)
        
    except Exception as e:
        print(f"[JobState] Błąd inicjalizacji domyślnych stanów: {e}", file=sys.stderr)
        db.session.rollback()