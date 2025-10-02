# app/modules/partner_academy/models.py
"""
Partner Academy Models
======================

Modele dla systemu rekrutacji i szkoleń partnerów handlowych.

Tabele:
- partner_applications: Dane aplikacji rekrutacyjnych
- partner_learning_sessions: Sesje e-learningowe i progress tracking

Autor: Development Team
Data: 2025-09-30
"""

from extensions import db
from datetime import datetime
from sqlalchemy import JSON, Text

class PartnerApplication(db.Model):
    """
    Model dla aplikacji rekrutacyjnych partnerów
    
    Przechowuje dane z formularza rekrutacyjnego, plik NDA,
    zgody RODO i status aplikacji.
    """
    __tablename__ = 'partner_applications'
    
    # ============================================================================
    # PRIMARY KEY
    # ============================================================================
    id = db.Column(db.Integer, primary_key=True)
    
    # ============================================================================
    # DANE OSOBOWE
    # ============================================================================
    first_name = db.Column(db.String(100), nullable=False, comment='Imię kandydata')
    last_name = db.Column(db.String(100), nullable=False, comment='Nazwisko kandydata')
    email = db.Column(db.String(255), nullable=False, unique=True, index=True, comment='Email kontaktowy')
    phone = db.Column(db.String(20), nullable=False, comment='Numer telefonu')
    city = db.Column(db.String(100), nullable=False, comment='Miasto')
    locality = db.Column(db.String(100), nullable=False, comment='Miejscowość')
    
    # ============================================================================
    # DODATKOWE INFORMACJE
    # ============================================================================
    experience_level = db.Column(
        db.String(50), 
        comment='Poziom doświadczenia: brak, 1-2 lata, 3-5 lat, 5+ lat'
    )
    about_text = db.Column(db.Text, comment='Tekst o sobie (dlaczego chcę zostać partnerem)')
    
    # ============================================================================
    # ZGODY RODO
    # ============================================================================
    data_processing_consent = db.Column(
        db.Boolean, 
        nullable=False, 
        default=False,
        comment='Zgoda na przetwarzanie danych osobowych (wymagana)'
    )
    
    # ============================================================================
    # PLIK NDA
    # ============================================================================
    nda_filename = db.Column(db.String(255), comment='Nazwa pliku NDA')
    nda_filepath = db.Column(db.String(500), comment='Ścieżka do pliku NDA')
    nda_filesize = db.Column(db.Integer, comment='Rozmiar pliku w bajtach')
    nda_mime_type = db.Column(db.String(100), comment='Typ MIME pliku')
    
    
    # ============================================================================
    # NOTATKI ADMINA (NOWE)
    # ============================================================================
    notes = db.Column(
        Text,
        default='[]',
        comment='Notatki admina w formacie JSON [{timestamp, author, text}]'
    )

    # ============================================================================
    # STATUS APLIKACJI
    # ============================================================================
    status = db.Column(
        db.String(50), 
        default='pending', 
        index=True,
        comment='Status: pending, contacted, rejected, accepted'
    )
    
    # ============================================================================
    # METADATA
    # ============================================================================
    created_at = db.Column(
        db.DateTime, 
        default=datetime.utcnow, 
        nullable=False,
        index=True,
        comment='Data utworzenia aplikacji'
    )
    updated_at = db.Column(
        db.DateTime, 
        default=datetime.utcnow, 
        onupdate=datetime.utcnow,
        comment='Data ostatniej aktualizacji'
    )
    ip_address = db.Column(db.String(45), comment='Adres IP kandydata')
    user_agent = db.Column(db.Text, comment='User agent przeglądarki')
    
    def to_dict(self):
        """Konwersja do słownika (dla JSON API)"""
        return {
            'id': self.id,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'email': self.email,
            'phone': self.phone,
            'city': self.city,
            'locality': self.locality,
            'experience_level': self.experience_level,
            'status': self.status,
            'has_nda_file': bool(self.nda_filepath),
            'notes': self.notes or [],
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    def __repr__(self):
        return f'<PartnerApplication {self.email} - {self.status}>'


class PartnerLearningSession(db.Model):
    """
    Model dla sesji e-learningowych partnerów
    
    Przechowuje progress użytkownika na platformie szkoleniowej,
    wyniki quizów, czasy spędzone na poszczególnych krokach.
    """
    __tablename__ = 'partner_learning_sessions'
    
    # ============================================================================
    # PRIMARY KEY
    # ============================================================================
    id = db.Column(db.Integer, primary_key=True)
    
    # ============================================================================
    # IDENTYFIKACJA SESJI
    # ============================================================================
    session_id = db.Column(
        db.String(64), 
        nullable=False, 
        unique=True, 
        index=True,
        comment='Unikalny identyfikator sesji (z localStorage)'
    )
    
    # ============================================================================
    # PROGRESS TRACKING
    # ============================================================================
    current_step = db.Column(
        db.String(10), 
        nullable=False, 
        default='1.1',
        index=True,
        comment='Aktualny krok: 1.1, 1.2, M1, 2.1, etc.'
    )
    
    # POPRAWIONE: lambda zamiast list/dict
    completed_steps = db.Column(
        JSON, 
        default=lambda: [],
        comment='Lista ukończonych kroków: ["1.1", "1.2", "1.3"]'
    )
    locked_steps = db.Column(
        JSON, 
        default=lambda: [],
        comment='Lista zablokowanych kroków'
    )
    
    # ============================================================================
    # QUIZ RESULTS
    # ============================================================================
    quiz_results = db.Column(
        JSON,
        default=lambda: {},
        comment='Wyniki quizów: {"1.1": {"attempts": 2, "correct": true, "timestamp": "..."}}'
    )
    
    # ============================================================================
    # TIME TRACKING
    # ============================================================================
    total_time_spent = db.Column(
        db.Integer, 
        default=0,
        comment='Całkowity czas spędzony w sekundach'
    )
    step_times = db.Column(
        JSON,
        default=lambda: {},
        comment='Czas na poszczególnych krokach: {"1.1": 120, "1.2": 180}'
    )
    
    # ============================================================================
    # METADATA
    # ============================================================================
    last_accessed_at = db.Column(
        db.DateTime, 
        default=datetime.utcnow,
        index=True,
        comment='Data ostatniego dostępu'
    )
    created_at = db.Column(
        db.DateTime, 
        default=datetime.utcnow,
        comment='Data utworzenia sesji'
    )
    ip_address = db.Column(db.String(45), comment='Adres IP użytkownika')
    user_agent = db.Column(db.Text, comment='User agent przeglądarki')
    
    def to_dict(self):
        """Konwersja do słownika (dla JSON API)"""
        return {
            'session_id': self.session_id,
            'current_step': self.current_step,
            'completed_steps': self.completed_steps or [],
            'locked_steps': self.locked_steps or [],
            'quiz_results': self.quiz_results or {},
            'total_time_spent': self.total_time_spent,
            'step_times': self.step_times or {},
            'last_accessed_at': self.last_accessed_at.isoformat() if self.last_accessed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
    
    def get_completion_percentage(self):
        """Oblicz procent ukończenia szkolenia"""
        total_steps = 11  # 1.1, 1.2, 1.3, 1.4, M1, 2.1, 2.2, 2.3, 2.4, M2, 3.1
        completed_count = len(self.completed_steps) if self.completed_steps else 0
        return (completed_count / total_steps) * 100
    
    def __repr__(self):
        return f'<PartnerLearningSession {self.session_id} - {self.current_step}>'