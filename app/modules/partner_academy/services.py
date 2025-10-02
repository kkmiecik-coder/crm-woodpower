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
import uuid


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
        """
        Utworzenie nowej aplikacji rekrutacyjnej z plikiem NDA
        
        Args:
            form_data (dict): Dane z formularza
            file (FileStorage): Plik NDA
            ip_address (str): Adres IP użytkownika
            user_agent (str): User agent przeglądarki
            
        Returns:
            PartnerApplication: Utworzona aplikacja
            
        Raises:
            ValueError: Błędy walidacji
        """
        
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
        
        # Przygotuj dane podstawowe
        application_data = {
            'first_name': form_data['first_name'],
            'last_name': form_data['last_name'],
            'email': form_data['email'],
            'phone': form_data['phone'],
            'city': form_data['city'],
            'address': form_data['address'],  # ZMIENIONE z locality
            'postal_code': form_data['postal_code'],  # DODANE
            'pesel': form_data['pesel'],
            'about_text': form_data.get('about_text', ''),
            'data_processing_consent': form_data.get('data_processing_consent', 'off') == 'on',
            'nda_filename': unique_filename,
            'nda_filepath': filepath,
            'nda_filesize': filesize,
            'nda_mime_type': mime_type,
            'ip_address': ip_address,
            'user_agent': user_agent,
            'status': 'pending'
        }
        
        # Obsługa danych B2B
        # ZMIENIONE: sprawdzamy cooperation_type zamiast is_b2b
        is_b2b = form_data.get('cooperation_type') == 'b2b'
        application_data['is_b2b'] = is_b2b
        
        if is_b2b:
            application_data.update({
                'company_name': form_data.get('company_name', ''),
                'nip': form_data.get('nip', ''),
                'regon': form_data.get('regon', ''),
                'company_address': form_data.get('company_address', ''),
                'company_city': form_data.get('company_city', ''),
                'company_postal_code': form_data.get('company_postal_code', '')
            })
        
        # Utwórz rekord w bazie
        application = PartnerApplication(**application_data)
        
        try:
            db.session.add(application)
            db.session.commit()
            
            current_app.logger.info(
                f"Utworzono aplikację: {application.email} (ID: {application.id})"
            )
            
            return application
            
        except Exception as e:
            db.session.rollback()
            # Usuń plik jeśli nie udało się zapisać do bazy
            if os.path.exists(filepath):
                os.remove(filepath)
            raise e
    
    @classmethod
    def get_application_by_id(cls, application_id):
        """Pobierz aplikację po ID"""
        return PartnerApplication.query.get(application_id)
    
    @classmethod
    def get_application_by_email(cls, email):
        """Pobierz aplikację po email"""
        return PartnerApplication.query.filter_by(email=email).first()
    
    @classmethod
    def update_application_status(cls, application_id, new_status, notes=None):
        """
        Aktualizacja statusu aplikacji
        
        Args:
            application_id (int): ID aplikacji
            new_status (str): Nowy status (pending, contacted, rejected, accepted)
            notes (str, optional): Notatka do dodania
        """
        application = cls.get_application_by_id(application_id)
        
        if not application:
            raise ValueError(f"Aplikacja o ID {application_id} nie istnieje")
        
        # Sprawdź czy status jest prawidłowy
        valid_statuses = ['pending', 'contacted', 'rejected', 'accepted']
        if new_status not in valid_statuses:
            raise ValueError(f"Nieprawidłowy status: {new_status}")
        
        application.status = new_status
        application.updated_at = datetime.utcnow()
        
        # Dodaj notatkę jeśli została przekazana
        if notes:
            import json
            current_notes = json.loads(application.notes) if application.notes else []
            current_notes.append({
                'timestamp': datetime.utcnow().isoformat(),
                'author': 'system',
                'text': notes
            })
            application.notes = json.dumps(current_notes)
        
        db.session.commit()
        
        current_app.logger.info(
            f"Zaktualizowano status aplikacji {application_id}: {new_status}"
        )
        
        return application
    
    @classmethod
    def get_nda_file_path(cls, application_id):
        """Pobierz ścieżkę do pliku NDA"""
        application = cls.get_application_by_id(application_id)
        if application and application.nda_filepath:
            return application.nda_filepath
        return None


class EmailService:
    """Serwis wysyłki emaili"""
    
    @staticmethod
    def send_application_confirmation(application):
        """
        Wyślij email potwierdzający otrzymanie aplikacji
        
        Args:
            application (PartnerApplication): Aplikacja rekrutacyjna
        """
        try:
            msg = Message(
                subject='Potwierdzenie otrzymania aplikacji - WoodPower Partner Academy',
                sender=current_app.config.get('MAIL_DEFAULT_SENDER'),
                recipients=[application.email]
            )
            
            # Renderuj template email
            msg.html = render_template(
                'emails/application_confirmation.html',
                application=application
            )
            
            mail.send(msg)
            
            current_app.logger.info(
                f"Wysłano email potwierdzający do: {application.email}"
            )
            
        except Exception as e:
            current_app.logger.error(
                f"Błąd wysyłki emaila do {application.email}: {str(e)}"
            )
    
    @staticmethod
    def send_admin_notification(application):
        """
        Wyślij notyfikację do admina o nowej aplikacji
        
        Args:
            application (PartnerApplication): Aplikacja rekrutacyjna
        """
        try:
            admin_email = current_app.config.get('ADMIN_EMAIL')
            if not admin_email:
                return
            
            msg = Message(
                subject=f'Nowa aplikacja: {application.first_name} {application.last_name}',
                sender=current_app.config.get('MAIL_DEFAULT_SENDER'),
                recipients=[admin_email]
            )
            
            msg.html = render_template(
                'emails/admin_notification.html',
                application=application
            )
            
            mail.send(msg)
            
            current_app.logger.info(
                f"Wysłano notyfikację do admina o aplikacji: {application.id}"
            )
            
        except Exception as e:
            current_app.logger.error(
                f"Błąd wysyłki notyfikacji do admina: {str(e)}"
            )
    
    @staticmethod
    def send_status_update(application, new_status):
        """
        Wyślij email o zmianie statusu aplikacji
        
        Args:
            application (PartnerApplication): Aplikacja
            new_status (str): Nowy status
        """
        try:
            status_messages = {
                'contacted': 'Skontaktujemy się z Tobą wkrótce',
                'accepted': 'Twoja aplikacja została zaakceptowana!',
                'rejected': 'Informacja o Twojej aplikacji'
            }
            
            subject = f'WoodPower Partner Academy - {status_messages.get(new_status, "Aktualizacja statusu")}'
            
            msg = Message(
                subject=subject,
                sender=current_app.config.get('MAIL_DEFAULT_SENDER'),
                recipients=[application.email]
            )
            
            msg.html = render_template(
                f'emails/status_{new_status}.html',
                application=application
            )
            
            mail.send(msg)
            
            current_app.logger.info(
                f"Wysłano email o zmianie statusu do: {application.email} ({new_status})"
            )
            
        except Exception as e:
            current_app.logger.error(
                f"Błąd wysyłki emaila o statusie: {str(e)}"
            )


class LearningService:
    """Serwis zarządzania postępem szkoleniowym"""
    
    @staticmethod
    def find_or_create_session_by_ip(ip_address):
        """
        Znajdź istniejącą sesję po IP lub utwórz nową
        
        Args:
            ip_address (str): Adres IP użytkownika
            
        Returns:
            str: session_id
        """
        # Szukaj aktywnej sesji z tego IP (ostatnie 24h)
        from datetime import timedelta
        yesterday = datetime.utcnow() - timedelta(days=1)
        
        existing_session = PartnerLearningSession.query.filter(
            PartnerLearningSession.ip_address == ip_address,
            PartnerLearningSession.last_accessed_at >= yesterday
        ).first()
        
        if existing_session:
            return existing_session.session_id
        
        # Utwórz nową sesję
        session_id = str(uuid.uuid4())
        new_session = PartnerLearningSession(
            session_id=session_id,
            ip_address=ip_address,
            current_step='1.1'
        )
        
        db.session.add(new_session)
        db.session.commit()
        
        current_app.logger.info(f"Utworzono nową sesję: {session_id}")
        
        return session_id
    
    @staticmethod
    def get_session(session_id):
        """Pobierz sesję po ID"""
        return PartnerLearningSession.query.filter_by(session_id=session_id).first()
    
    @staticmethod
    def load_progress(session_id):
        """
        Załaduj progress użytkownika
        
        Args:
            session_id (str): ID sesji
            
        Returns:
            dict: Progress data
        """
        session = LearningService.get_session(session_id)
        
        if not session:
            return {
                'current_step': '1.1',
                'completed_steps': [],
                'quiz_results': {},
                'total_time_spent': 0
            }
        
        return {
            'current_step': session.current_step,
            'completed_steps': session.completed_steps or [],
            'quiz_results': session.quiz_results or {},
            'total_time_spent': session.total_time_spent
        }
    
    @staticmethod
    def update_progress(session_id, current_step, completed_steps, quiz_results=None):
        """
        Aktualizuj progress użytkownika
        
        Args:
            session_id (str): ID sesji
            current_step (str): Aktualny krok
            completed_steps (list): Lista ukończonych kroków
            quiz_results (dict, optional): Wyniki quizów
        """
        session = LearningService.get_session(session_id)
        
        if not session:
            raise ValueError(f"Sesja {session_id} nie istnieje")
        
        session.current_step = current_step
        session.completed_steps = completed_steps
        
        if quiz_results:
            current_results = session.quiz_results or {}
            current_results.update(quiz_results)
            session.quiz_results = current_results
        
        session.last_accessed_at = datetime.utcnow()
        
        # Sprawdź czy szkolenie zostało ukończone
        if current_step == '3.1' and not session.is_completed:
            session.is_completed = True
            session.completed_at = datetime.utcnow()
        
        db.session.commit()
        
        current_app.logger.info(
            f"Zaktualizowano progress sesji {session_id}: krok {current_step}"
        )
    
    @staticmethod
    def sync_time(session_id, time_spent, step_time_tracking=None):
        """
        Synchronizuj czas spędzony w sesji
        
        Args:
            session_id (str): ID sesji
            time_spent (int): Czas w sekundach
            step_time_tracking (dict, optional): Czas na poszczególnych krokach
        """
        session = LearningService.get_session(session_id)
        
        if not session:
            raise ValueError(f"Sesja {session_id} nie istnieje")
        
        session.total_time_spent = time_spent
        
        if step_time_tracking:
            session.step_time_tracking = step_time_tracking
        
        session.last_accessed_at = datetime.utcnow()
        
        db.session.commit()
        
        current_app.logger.info(
            f"Zsynchronizowano czas sesji {session_id}: {time_spent}s"
        )