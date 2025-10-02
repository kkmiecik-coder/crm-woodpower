# app/modules/partner_academy/services.py
"""
Partner Academy Services
========================

Warstwa logiki biznesowej dla modułu PartnerAcademy.

Services:
- ApplicationService: Obsługa aplikacji rekrutacyjnych
- EmailService: Wysyłka emaili (potwierdzenia, notyfikacje)
- LearningService: Zarządzanie postępem szkoleniowym

Autor: Development Team
Data: 2025-09-30
"""

import os
from werkzeug.utils import secure_filename
from flask import current_app, render_template
from flask_mail import Message
from extensions import db, mail
from modules.partner_academy.models import PartnerApplication, PartnerLearningSession
from datetime import datetime
import magic


class ApplicationService:
    """Serwis zarządzania aplikacjami rekrutacyjnymi"""
    
    # Konfiguracja uploadów
    UPLOAD_FOLDER = 'modules/partner_academy/static/media/nda_users/'
    ALLOWED_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png', 'docx', 'odt'}
    ALLOWED_MIME_TYPES = {
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text'
    }
    MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB
    
    @classmethod
    def create_application(cls, form_data, file, ip_address, user_agent):
        """Utworzenie nowej aplikacji rekrutacyjnej z plikiem NDA"""
        
        # Zapisz plik na dysku
        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        unique_filename = f"{timestamp}_{filename}"
        
        # Upewnij się że folder istnieje
        os.makedirs(cls.UPLOAD_FOLDER, exist_ok=True)
        
        filepath = os.path.join(cls.UPLOAD_FOLDER, unique_filename)
        file.save(filepath)
        
        # Pobierz info o pliku
        filesize = os.path.getsize(filepath)
        mime_type = magic.from_file(filepath, mime=True)
        
        # Utwórz rekord w bazie - POPRAWIONE NAZWY KOLUMN
        application = PartnerApplication(
            first_name=form_data['first_name'],
            last_name=form_data['last_name'],
            email=form_data['email'],
            phone=form_data['phone'],
            city=form_data['city'],
            locality=form_data['locality'],
            experience_level=form_data.get('experience_level'),
            about_text=form_data.get('about_text'),
            data_processing_consent=form_data['data_processing_consent'],
            nda_filename=filename,
            nda_filepath=filepath,  # ← POPRAWIONE
            nda_filesize=filesize,
            nda_mime_type=mime_type,
            status='pending',
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        db.session.add(application)
        db.session.commit()
        
        return application
    
    @classmethod
    def get_application_by_email(cls, email):
        """Znajdź aplikację po emailu"""
        return PartnerApplication.query.filter_by(email=email).first()
    
    @classmethod
    def update_status(cls, application_id, new_status):
        """Zmień status aplikacji"""
        application = PartnerApplication.query.get(application_id)
        if application:
            application.status = new_status
            application.updated_at = datetime.utcnow()
            db.session.commit()
            return True
        return False


class EmailService:
    """Serwis do wysyłania emaili"""
    
    @staticmethod
    def _load_email_config():
        """Ładuje konfigurację emaili z pliku JSON"""
        import json
        
        try:
            config_path = os.path.join(
                current_app.root_path,
                'modules',
                'partner_academy',
                'config',
                'mail_addresses.json'
            )
            
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
            
            return config
            
        except FileNotFoundError:
            current_app.logger.error("[EmailService] Brak pliku mail_addresses.json")
            return {
                'notification_emails': ['admin@woodpower.pl'],
                'confirmation_emails': []
            }
        except json.JSONDecodeError as e:
            current_app.logger.error(f"[EmailService] Błąd parsowania JSON: {e}")
            return {
                'notification_emails': ['admin@woodpower.pl'],
                'confirmation_emails': []
            }
    
    @staticmethod
    def send_confirmation_email(application: PartnerApplication):
        """Wysyła email potwierdzający do kandydata + kopie"""
        try:
            config = EmailService._load_email_config()
            recipient_email = application.email
            cc_emails = config.get('confirmation_emails', [])
            
            msg = Message(
                'Potwierdzenie aplikacji - WoodPower PartnerAcademy',
                sender=current_app.config.get('MAIL_USERNAME'),
                recipients=[recipient_email],
                cc=cc_emails if cc_emails else None
            )
            
            msg.html = render_template(
                'emails/application_received.html',
                first_name=application.first_name,
                last_name=application.last_name
            )
            
            mail.send(msg)
            
            current_app.logger.info(
                f"[EmailService] Wysłano potwierdzenie do {recipient_email}"
                + (f" (cc: {', '.join(cc_emails)})" if cc_emails else "")
            )
            
        except Exception as e:
            current_app.logger.error(f"[EmailService] Błąd wysyłania potwierdzenia: {e}")
            raise
    
    @staticmethod
    def send_notification_email(application: PartnerApplication):
        """Wysyła powiadomienie o nowej aplikacji do managementu (z załącznikiem NDA)"""
        try:
            config = EmailService._load_email_config()
            management_emails = config.get('notification_emails', ['admin@woodpower.pl'])
        
            msg = Message(
                f'Nowa aplikacja partnera: {application.first_name} {application.last_name}',
                sender=current_app.config.get('MAIL_USERNAME'),
                recipients=management_emails
            )
        
            msg.html = render_template(
                'emails/application_notification.html',
                application=application
            )
        
            # Załącz plik NDA
            if application.nda_filepath and os.path.exists(application.nda_filepath):
                try:
                    with open(application.nda_filepath, 'rb') as f:
                        file_content = f.read()
                
                    # Określ MIME type
                    mime_type = 'application/pdf'
                    if application.nda_filename.lower().endswith('.pdf'):
                        mime_type = 'application/pdf'
                    elif application.nda_filename.lower().endswith(('.jpg', '.jpeg')):
                        mime_type = 'image/jpeg'
                    elif application.nda_filename.lower().endswith('.png'):
                        mime_type = 'image/png'
                    elif application.nda_filename.lower().endswith('.docx'):
                        mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    elif application.nda_filename.lower().endswith('.odt'):
                        mime_type = 'application/vnd.oasis.opendocument.text'
                
                    msg.attach(
                        application.nda_filename,
                        mime_type,
                        file_content
                    )
                
                    current_app.logger.info(f"[EmailService] Załączono plik: {application.nda_filename}")
                
                except Exception as e:
                    current_app.logger.error(f"[EmailService] Błąd załączania pliku: {e}")
        
            mail.send(msg)
        
            current_app.logger.info(
                f"[EmailService] Wysłano powiadomienie do {', '.join(management_emails)}"
            )
        
        except Exception as e:
            current_app.logger.error(f"[EmailService] Błąd wysyłania powiadomienia: {e}")
            raise
    
    @staticmethod
    def send_application_emails(application: PartnerApplication):
        """Wysyła wszystkie emaile po złożeniu aplikacji"""
        try:
            EmailService.send_confirmation_email(application)
            EmailService.send_notification_email(application)
        except Exception as e:
            current_app.logger.error(f"[EmailService] Błąd wysyłania emaili: {e}")


class LearningService:
    """Serwis zarządzania sesjami e-learningowymi"""
    
    @classmethod
    def get_or_create_session(cls, session_id, ip_address, user_agent):
        """Pobierz istniejącą sesję lub utwórz nową"""
        session = PartnerLearningSession.query.filter_by(session_id=session_id).first()
        
        if not session:
            session = PartnerLearningSession(
                session_id=session_id,
                current_step='1.1',
                completed_steps=[],
                locked_steps=['1.2', '1.3', '1.4', 'M1', '2.1', '2.2', '2.3', '2.4', 'M2', '3.1'],
                quiz_results={},
                total_time_spent=0,
                step_times={},
                ip_address=ip_address,
                user_agent=user_agent
            )
            db.session.add(session)
            db.session.commit()
            current_app.logger.info(f"[LearningService] Utworzono nową sesję: {session_id}")
        else:
            session.last_accessed_at = datetime.utcnow()
            db.session.commit()
        
        return session
    
    @classmethod
    def update_progress(cls, session_id, action, completed_step=None):
        """Aktualizacja postępu w szkoleniu"""
        session = PartnerLearningSession.query.filter_by(session_id=session_id).first()
        
        if not session:
            return None
        
        if action == 'complete_step' and completed_step:
            completed = session.completed_steps or []
            if completed_step not in completed:
                completed.append(completed_step)
                session.completed_steps = completed
                
                next_step = cls._get_next_step(completed_step)
                if next_step:
                    locked = session.locked_steps or []
                    if next_step in locked:
                        locked.remove(next_step)
                        session.locked_steps = locked
                
                session.current_step = next_step or completed_step
        
        session.last_accessed_at = datetime.utcnow()
        db.session.commit()
        
        return session
    
    @classmethod
    def save_quiz_result(cls, session_id, step, attempts, is_correct):
        """Zapisz wynik quizu"""
        session = PartnerLearningSession.query.filter_by(session_id=session_id).first()
        
        if session:
            results = session.quiz_results or {}
            results[step] = {
                'attempts': attempts,
                'correct': is_correct,
                'timestamp': datetime.utcnow().isoformat()
            }
            session.quiz_results = results
            db.session.commit()
    
    @classmethod
    def update_time_spent(cls, session_id, step, time_increment):
        """Aktualizuj czas spędzony na platformie"""
        session = PartnerLearningSession.query.filter_by(session_id=session_id).first()
        
        if session:
            session.total_time_spent += time_increment
            
            step_times = session.step_times or {}
            step_times[step] = step_times.get(step, 0) + time_increment
            session.step_times = step_times
            
            session.last_accessed_at = datetime.utcnow()
            db.session.commit()
    
    @staticmethod
    def _get_next_step(current_step):
        """Zwróć następny krok w sekwencji"""
        steps = ['1.1', '1.2', '1.3', '1.4', 'M1', '2.1', '2.2', '2.3', '2.4', 'M2', '3.1']
        try:
            current_index = steps.index(current_step)
            if current_index < len(steps) - 1:
                return steps[current_index + 1]
            return None
        except ValueError:
            return None
        
    @staticmethod
    def find_or_create_session_by_ip(ip_address: str):
        """
        Znajdź istniejącą sesję dla danego IP lub utwórz nową.
        Wyszukuje sesję utworzoną w ciągu ostatnich 24h.
        """
        from datetime import datetime, timedelta
        from models import LearningSession
        
        # Sprawdź czy istnieje aktywna sesja dla tego IP (ostatnie 24h)
        cutoff_time = datetime.utcnow() - timedelta(hours=24)
        
        existing_session = LearningSession.query.filter(
            LearningSession.ip_address == ip_address,
            LearningSession.created_at >= cutoff_time
        ).order_by(LearningSession.created_at.desc()).first()
        
        if existing_session:
            current_app.logger.info(f"Znaleziono istniejącą sesję dla IP {ip_address}: {existing_session.session_id}")
            return existing_session
        
        # Utwórz nową sesję
        import uuid
        session_id = f"session_{uuid.uuid4().hex[:16]}"
        
        new_session = LearningSession(
            session_id=session_id,
            ip_address=ip_address,
            current_step='1.1',
            completed_steps=[],
            total_time_spent=0
        )
        
        db.session.add(new_session)
        db.session.commit()
        
        current_app.logger.info(f"Utworzono nową sesję dla IP {ip_address}: {session_id}")
        return new_session
    
    @staticmethod
    def find_or_create_session_by_ip(ip_address: str) -> str:
        """
        Znajdź istniejącą sesję dla danego IP lub utwórz nową.
        Wyszukuje sesję utworzoną w ciągu ostatnich 24h.
        
        Returns:
            str: session_id
        """
        from datetime import datetime, timedelta
        from modules.partner_academy.utils import generate_session_id
        
        # Sprawdź czy istnieje aktywna sesja dla tego IP (ostatnie 24h)
        cutoff_time = datetime.utcnow() - timedelta(hours=24)
        
        existing_session = PartnerLearningSession.query.filter(
            PartnerLearningSession.ip_address == ip_address,
            PartnerLearningSession.created_at >= cutoff_time
        ).order_by(PartnerLearningSession.created_at.desc()).first()
        
        if existing_session:
            current_app.logger.info(f"Znaleziono istniejącą sesję dla IP {ip_address}: {existing_session.session_id}")
            return existing_session.session_id
        
        # Utwórz nową sesję
        new_session_id = generate_session_id()
        
        new_session = PartnerLearningSession(
            session_id=new_session_id,
            ip_address=ip_address,
            current_step='1.1',
            completed_steps=[],
            locked_steps=['1.2', '1.3', '1.4', 'M1', '2.1', '2.2', '2.3', '2.4', 'M2', '3.1'],
            total_time_spent=0,
            step_times={}
        )
        
        db.session.add(new_session)
        db.session.commit()
        
        current_app.logger.info(f"Utworzono nową sesję dla IP {ip_address}: {new_session_id}")
        return new_session_id
    
# End of services.py