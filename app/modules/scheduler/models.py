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
    quote_id = db.Column(db.Integer, db.ForeignKey('quotes.id'), nullable=False)
    email_type = db.Column(db.String(50), nullable=False)
    recipient_email = db.Column(db.String(255), nullable=False)
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


def create_default_scheduler_config():
    """
    Tworzy domyślne ustawienia schedulera jeśli nie istnieją
    """
    defaults = [
        {
            'key': 'quote_reminder_enabled',
            'value': 'true',
            'description': 'Czy włączone są przypomnienia o wycenach'
        },
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
            'value': '16',  # ZMIENIONE na 16:00
            'description': 'O której godzinie sprawdzać codziennie (0-23)'
        },
        {
            'key': 'email_send_delay',  # NOWE
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