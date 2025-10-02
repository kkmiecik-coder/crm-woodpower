# app/modules/partner_academy/routers.py
"""
Partner Academy Routes
======================

API endpoints i routes dla modułu PartnerAcademy.

Element 1: Recruitment
- GET /partner-academy/ - strona rekrutacyjna
- POST /partner-academy/api/application/validate - walidacja pola
- POST /partner-academy/api/application/submit - wysłanie aplikacji
- POST /partner-academy/api/application/generate-nda - generowanie PDF (opcjonalne)

Element 2: Learning Platform
- GET /partner-academy/learning - platforma e-learningowa
- POST /partner-academy/api/progress/load - ładowanie progressu
- POST /partner-academy/api/progress/update - aktualizacja progressu
- POST /partner-academy/api/time/sync - synchronizacja czasu
- POST /partner-academy/api/quiz/validate - walidacja quizu

Autor: Development Team
Data: 2025-09-30
"""

from flask import render_template, request, jsonify, current_app, send_file, session, redirect, url_for, flash
from modules.partner_academy import partner_academy_bp
from modules.partner_academy.services import ApplicationService, EmailService, LearningService
from modules.partner_academy.validators import validate_application_data, validate_file, validate_quiz_answers
from modules.partner_academy.utils import rate_limit, get_quiz_answers, generate_nda_pdf
from extensions import db
from modules.partner_academy.models import PartnerApplication, PartnerLearningSession
import io
import os
from datetime import datetime

from sqlalchemy import func, or_, desc
import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from functools import wraps

def login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            flash("Twoja sesja wygasła. Zaloguj się ponownie.", "info")
            return redirect(url_for('login'))
        return func(*args, **kwargs)
    return wrapper

# ============================================================================
# ELEMENT 1: RECRUITMENT - VIEWS
# ============================================================================

@partner_academy_bp.route('/')
def recruitment():
    """Strona rekrutacyjna (Element 1)"""
    return render_template('recruitment.html')


# ============================================================================
# ELEMENT 2: LEARNING PLATFORM - VIEWS
# ============================================================================

@partner_academy_bp.route('/learning')
def learning():
    """Platforma e-learningowa (Element 2)"""
    return render_template('learning_platform.html')


# ============================================================================
# API ENDPOINTS - ELEMENT 1: RECRUITMENT
# ============================================================================

@partner_academy_bp.route('/api/session/init', methods=['POST'])
def init_session():
    """Inicjalizacja sesji - znajdź istniejącą po IP lub utwórz nową"""
    try:
        # Pobierz IP użytkownika
        ip_address = request.headers.get('X-Forwarded-For', request.remote_addr)
        if ip_address and ',' in ip_address:
            ip_address = ip_address.split(',')[0].strip()
        
        # Znajdź lub utwórz sesję
        session_id = LearningService.find_or_create_session_by_ip(ip_address)
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'ip_address': ip_address
        }), 200
        
    except Exception as e:
        current_app.logger.error(f"[API] Błąd inicjalizacji sesji: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': 'Błąd inicjalizacji sesji'
        }), 500

@partner_academy_bp.route('/api/application/validate', methods=['POST'])
@rate_limit(limit=20, per_hour=True)
def validate_application():
    """
    Walidacja pojedynczego pola formularza w czasie rzeczywistym
    
    Request JSON:
    {
        "field": "email",
        "value": "jan@example.com"
    }
    
    Response:
    {
        "valid": true,
        "message": ""
    }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'valid': False,
                'message': 'Brak danych'
            }), 400
        
        field = data.get('field')
        value = data.get('value')
        
        if not field:
            return jsonify({
                'valid': False,
                'message': 'Brak nazwy pola'
            }), 400
        
        # Walidacja partial (tylko podane pole)
        validation_result = validate_application_data({field: value}, partial=True)
        
        if validation_result['valid']:
            return jsonify({
                'valid': True,
                'message': ''
            }), 200
        else:
            # Zwróć błąd dla tego konkretnego pola
            error_message = validation_result['errors'].get(field, 'Nieprawidłowa wartość')
            return jsonify({
                'valid': False,
                'message': error_message
            }), 200
    
    except Exception as e:
        current_app.logger.error(f"[API] Błąd walidacji pola: {e}")
        return jsonify({
            'valid': False,
            'message': 'Błąd serwera'
        }), 500


@partner_academy_bp.route('/api/application/submit', methods=['POST'])
@rate_limit(limit=5, per_hour=True)  # Niższy limit dla submit
def submit_application():
    """
    Wysłanie kompletnej aplikacji z plikiem NDA
    
    Request (multipart/form-data):
    - first_name, last_name, email, phone, city, locality
    - experience_level, about_text
    - data_processing_consent, marketing_consent
    - nda_file (file)
    
    Response:
    {
        "success": true,
        "message": "Aplikacja została wysłana pomyślnie",
        "application_id": 123
    }
    """
    try:
        # Zbierz dane z formularza
        form_data = {
            'first_name': request.form.get('first_name'),
            'last_name': request.form.get('last_name'),
            'email': request.form.get('email'),
            'phone': request.form.get('phone'),
            'city': request.form.get('city'),
            'locality': request.form.get('locality'),
            'experience_level': request.form.get('experience_level'),
            'about_text': request.form.get('about_text'),
            'data_processing_consent': request.form.get('data_processing_consent') == 'true'
        }
        
        # Walidacja danych formularza (pełna)
        validation_result = validate_application_data(form_data, partial=False)
        
        if not validation_result['valid']:
            return jsonify({
                'success': False,
                'errors': validation_result['errors']
            }), 400
        
        # Sprawdź czy email już istnieje
        existing = ApplicationService.get_application_by_email(form_data['email'])
        if existing:
            return jsonify({
                'success': False,
                'message': 'Aplikacja z tym adresem email została już wysłana'
            }), 400
        
        # Walidacja pliku
        if 'nda_file' not in request.files:
            return jsonify({
                'success': False,
                'message': 'Brak załączonego pliku NDA'
            }), 400
        
        file = request.files['nda_file']
        file_validation = validate_file(file)
        
        if not file_validation['valid']:
            return jsonify({
                'success': False,
                'message': file_validation['message']
            }), 400
        
        # Zapisz aplikację
        application = ApplicationService.create_application(
            form_data=form_data,
            file=file,
            ip_address=request.remote_addr,
            user_agent=request.user_agent.string
        )
        
        # Wyślij emaile
        try:
            EmailService.send_application_emails(application)
        except Exception as e:
            current_app.logger.error(f"[API] Błąd wysyłki emaili: {e}")
            # Nie przerywaj - aplikacja jest zapisana, emaile można wysłać później
        
        return jsonify({
            'success': True,
            'message': 'Aplikacja została wysłana pomyślnie! Skontaktujemy się z Tobą w ciągu 48 godzin.',
            'application_id': application.id
        }), 200
    
    except Exception as e:
        current_app.logger.error(f"[API] Błąd submit aplikacji: {e}")
        db.session.rollback()
        return jsonify({
            'success': False,
            'message': 'Wystąpił błąd podczas wysyłania aplikacji. Spróbuj ponownie.'
        }), 500


@partner_academy_bp.route('/api/application/generate-nda', methods=['POST'])
@rate_limit(limit=10, per_hour=True)
def generate_nda():
    """Generowanie PDF z NDA"""
    import sys
    import traceback
    import tempfile
    import os
    from flask import send_file
    
    temp_file = None
    
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'message': 'Brak danych'
            }), 400
        
        print(f"[NDA] Generowanie PDF dla: {data.get('email')}", file=sys.stderr)
        
        # Generuj PDF
        pdf_bytes = generate_nda_pdf(data)
        
        print(f"[NDA] PDF wygenerowany, rozmiar: {len(pdf_bytes)} bytes", file=sys.stderr)
        
        # Nazwa pliku
        filename = f"NDA_{data.get('last_name', 'Document')}_{data.get('first_name', '')}.pdf"
        
        # FIX: Zapisz do tymczasowego pliku zamiast BytesIO
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
        temp_file.write(pdf_bytes)
        temp_file.close()
        
        print(f"[NDA] Zapisano do tymczasowego pliku: {temp_file.name}", file=sys.stderr)
        
        # Zwróć plik z dysku
        response = send_file(
            temp_file.name,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=filename
        )
        
        # Usuń tymczasowy plik po wysłaniu (Flask zadba o to automatycznie)
        @response.call_on_close
        def cleanup():
            try:
                os.unlink(temp_file.name)
                print(f"[NDA] Usunięto tymczasowy plik: {temp_file.name}", file=sys.stderr)
            except Exception as e:
                print(f"[NDA] Nie można usunąć pliku tymczasowego: {e}", file=sys.stderr)
        
        return response
    
    except ImportError as e:
        error_msg = f"WeasyPrint nie jest zainstalowany: {str(e)}"
        print(f"[NDA ERROR] {error_msg}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        
        # Cleanup w przypadku błędu
        if temp_file and os.path.exists(temp_file.name):
            os.unlink(temp_file.name)
        
        return jsonify({
            'success': False,
            'message': 'Generowanie PDF wymaga dodatkowych bibliotek.'
        }), 500
    
    except Exception as e:
        error_msg = f"Błąd generowania PDF: {str(e)}"
        print(f"[NDA ERROR] {error_msg}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        
        # Cleanup w przypadku błędu
        if temp_file and os.path.exists(temp_file.name):
            os.unlink(temp_file.name)
        
        return jsonify({
            'success': False,
            'message': f'Błąd generowania PDF: {str(e)}'
        }), 500


# ============================================================================
# API ENDPOINTS - ELEMENT 2: LEARNING PLATFORM
# ============================================================================

@partner_academy_bp.route('/api/progress/load', methods=['POST'])
def load_progress():
    """
    Ładowanie progressu użytkownika na platformie
    
    Request JSON:
    {
        "session_id": "abc123..."
    }
    
    Response:
    {
        "success": true,
        "data": {
            "current_step": "1.2",
            "completed_steps": ["1.1"],
            "locked_steps": ["1.3", "1.4", ...],
            "total_time_spent": 300,
            ...
        }
    }
    """
    try:
        data = request.get_json()
        
        if not data or not data.get('session_id'):
            return jsonify({
                'success': False,
                'message': 'Brak session_id'
            }), 400
        
        session_id = data['session_id']
        
        # Pobierz lub utwórz sesję
        session = LearningService.get_or_create_session(
            session_id=session_id,
            ip_address=request.remote_addr,
            user_agent=request.user_agent.string
        )
        
        return jsonify({
            'success': True,
            'data': session.to_dict()
        }), 200
    
    except Exception as e:
        current_app.logger.error(f"[API] Błąd load progress: {e}")
        return jsonify({
            'success': False,
            'message': 'Błąd serwera'
        }), 500


@partner_academy_bp.route('/api/progress/update', methods=['POST'])
def update_progress():
    """
    Aktualizacja progressu użytkownika
    
    Request JSON:
    {
        "session_id": "abc123...",
        "action": "complete_step",
        "completed_step": "1.1"
    }
    
    Response:
    {
        "success": true,
        "data": { ... }
    }
    """
    try:
        data = request.get_json()
        
        if not data or not data.get('session_id'):
            return jsonify({
                'success': False,
                'message': 'Brak session_id'
            }), 400
        
        session_id = data['session_id']
        action = data.get('action', 'navigate')
        completed_step = data.get('completed_step')
        
        # Aktualizuj progress
        session = LearningService.update_progress(
            session_id=session_id,
            action=action,
            completed_step=completed_step
        )
        
        if not session:
            return jsonify({
                'success': False,
                'message': 'Sesja nie istnieje'
            }), 404
        
        return jsonify({
            'success': True,
            'data': session.to_dict()
        }), 200
    
    except Exception as e:
        current_app.logger.error(f"[API] Błąd update progress: {e}")
        return jsonify({
            'success': False,
            'message': 'Błąd serwera'
        }), 500


@partner_academy_bp.route('/api/time/sync', methods=['POST'])
def sync_time():
    """
    Synchronizacja czasu spędzonego na platformie
    
    Request JSON:
    {
        "session_id": "abc123...",
        "step": "1.1",
        "time_increment": 10
    }
    
    Response:
    {
        "success": true,
        "total_time": 310
    }
    """
    try:
        data = request.get_json()
        
        if not data or not data.get('session_id'):
            return jsonify({
                'success': False,
                'message': 'Brak session_id'
            }), 400
        
        session_id = data['session_id']
        step = data.get('step', '1.1')
        time_increment = int(data.get('time_increment', 0))
        
        # Aktualizuj czas
        LearningService.update_time_spent(
            session_id=session_id,
            step=step,
            time_increment=time_increment
        )
        
        # Pobierz zaktualizowaną sesję
        from modules.partner_academy.models import PartnerLearningSession
        session = PartnerLearningSession.query.filter_by(session_id=session_id).first()
        
        return jsonify({
            'success': True,
            'total_time': session.total_time_spent if session else 0
        }), 200
    
    except Exception as e:
        current_app.logger.error(f"[API] Błąd sync time: {e}")
        return jsonify({
            'success': False,
            'message': 'Błąd serwera'
        }), 500


@partner_academy_bp.route('/api/quiz/validate', methods=['POST'])
def validate_quiz():
    """
    Walidacja odpowiedzi quizu
    
    Request JSON:
    {
        "session_id": "abc123...",
        "step": "1.1",
        "answers": {
            "q1": "B",
            "q2": ["A", "C", "D"],
            "q3": "C"
        }
    }
    
    Response:
    {
        "success": true,
        "all_correct": false,
        "results": {
            "q1": false,
            "q2": true,
            "q3": true
        }
    }
    """
    try:
        data = request.get_json()
        
        if not data or not data.get('session_id') or not data.get('step'):
            return jsonify({
                'success': False,
                'message': 'Brak wymaganych danych'
            }), 400
        
        session_id = data['session_id']
        step = data['step']
        answers = data.get('answers', {})
        
        # Pobierz prawidłowe odpowiedzi
        correct_answers = get_quiz_answers(step)
        
        if not correct_answers:
            return jsonify({
                'success': False,
                'message': 'Brak quizu dla tego kroku'
            }), 400
        
        # Waliduj odpowiedzi
        validation = validate_quiz_answers(step, answers, correct_answers)
        
        # Zapisz wynik
        if validation['all_correct']:
            # Pobierz aktualną liczbę prób
            from modules.partner_academy.models import PartnerLearningSession
            session = PartnerLearningSession.query.filter_by(session_id=session_id).first()
            
            if session:
                quiz_results = session.quiz_results or {}
                attempts = quiz_results.get(step, {}).get('attempts', 0) + 1
                
                LearningService.save_quiz_result(
                    session_id=session_id,
                    step=step,
                    attempts=attempts,
                    is_correct=True
                )
        
        return jsonify({
            'success': True,
            'all_correct': validation['all_correct'],
            'results': validation['results']
        }), 200
    
    except Exception as e:
        current_app.logger.error(f"[API] Błąd validate quiz: {e}")
        return jsonify({
            'success': False,
            'message': 'Błąd serwera'
        }), 500


@partner_academy_bp.route('/admin/')
@login_required
def admin_dashboard():
    """Strona główna panelu admina"""
    return render_template('admin.html')


@partner_academy_bp.route('/admin/api/stats')
@login_required
def get_admin_stats():
    """Statystyki dla dashboard"""
    try:
        total_applications = PartnerApplication.query.count()
        pending_count = PartnerApplication.query.filter_by(status='pending').count()
        accepted_count = PartnerApplication.query.filter_by(status='accepted').count()
        in_progress_count = PartnerLearningSession.query.filter(
            PartnerLearningSession.current_step != '3.1'
        ).count()
        completed_count = PartnerLearningSession.query.filter_by(current_step='3.1').count()
        avg_time = db.session.query(func.avg(PartnerLearningSession.total_time_spent)).scalar() or 0
        avg_time_hours = round(avg_time / 3600, 1)
        
        return jsonify({
            'success': True,
            'data': {
                'total_applications': total_applications,
                'pending_count': pending_count,
                'accepted_count': accepted_count,
                'in_progress_count': in_progress_count,
                'completed_count': completed_count,
                'avg_time_hours': avg_time_hours
            }
        }), 200
    except Exception as e:
        current_app.logger.error(f"Admin stats error: {str(e)}")
        return jsonify({'success': False, 'message': 'Błąd pobierania statystyk'}), 500


@partner_academy_bp.route('/admin/api/applications')
@login_required
def get_admin_applications():
    """Lista aplikacji z filtrowaniem i paginacją"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        status_filter = request.args.get('status', '')
        search = request.args.get('search', '')
        
        query = PartnerApplication.query
        
        if status_filter:
            query = query.filter_by(status=status_filter)
        
        if search:
            pattern = f'%{search}%'
            query = query.filter(
                or_(
                    PartnerApplication.first_name.ilike(pattern),
                    PartnerApplication.last_name.ilike(pattern),
                    PartnerApplication.email.ilike(pattern),
                    PartnerApplication.phone.ilike(pattern)
                )
            )
        
        query = query.order_by(desc(PartnerApplication.created_at))
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)
        
        applications = [{
            'id': app.id,
            'created_at': app.created_at.strftime('%Y-%m-%d %H:%M'),
            'first_name': app.first_name,
            'last_name': app.last_name,
            'email': app.email,
            'phone': app.phone,
            'status': app.status
        } for app in pagination.items]
        
        return jsonify({
            'success': True,
            'data': {
                'applications': applications,
                'pagination': {
                    'page': pagination.page,
                    'per_page': pagination.per_page,
                    'total': pagination.total,
                    'pages': pagination.pages
                }
            }
        }), 200
    except Exception as e:
        current_app.logger.error(f"Admin applications error: {str(e)}")
        return jsonify({'success': False, 'message': 'Błąd pobierania aplikacji'}), 500


@partner_academy_bp.route('/admin/api/applications/<int:app_id>')
@login_required
def get_admin_application_details(app_id):
    """Szczegóły aplikacji"""
    try:
        app = PartnerApplication.query.get_or_404(app_id)
        notes = json.loads(app.notes) if app.notes else []
        
        return jsonify({
            'success': True,
            'data': {
                'id': app.id,
                'first_name': app.first_name,
                'last_name': app.last_name,
                'email': app.email,
                'phone': app.phone,
                'city': app.city,
                'locality': app.locality,
                'experience_level': app.experience_level or 'Nie podano',
                'about_text': app.about_text or '',
                'data_processing_consent': app.data_processing_consent,
                'nda_filename': app.nda_filename,
                'nda_filesize': app.nda_filesize,
                'status': app.status,
                'notes': notes,
                'created_at': app.created_at.strftime('%Y-%m-%d %H:%M'),
                'ip_address': app.ip_address
            }
        }), 200
    except Exception as e:
        current_app.logger.error(f"Admin app details error: {str(e)}")
        return jsonify({'success': False, 'message': 'Błąd pobierania szczegółów'}), 500


@partner_academy_bp.route('/admin/api/applications/<int:app_id>/status', methods=['POST'])
@login_required
def update_admin_application_status(app_id):
    """Zmiana statusu aplikacji"""
    try:
        data = request.get_json()
        new_status = data.get('status')
        
        if new_status not in ['pending', 'contacted', 'accepted', 'rejected']:
            return jsonify({'success': False, 'message': 'Nieprawidłowy status'}), 400
        
        app = PartnerApplication.query.get_or_404(app_id)
        app.status = new_status
        app.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Status zaktualizowany'}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Admin status update error: {str(e)}")
        return jsonify({'success': False, 'message': 'Błąd aktualizacji statusu'}), 500


@partner_academy_bp.route('/admin/api/applications/<int:app_id>/notes', methods=['POST'])
@login_required
def add_admin_application_note(app_id):
    """Dodanie notatki"""
    try:
        data = request.get_json()
        note_text = data.get('text', '').strip()
        
        if not note_text:
            return jsonify({'success': False, 'message': 'Treść notatki jest wymagana'}), 400
        
        app = PartnerApplication.query.get_or_404(app_id)
        notes = json.loads(app.notes) if app.notes else []
        
        new_note = {
            'timestamp': datetime.utcnow().isoformat(),
            'author': 'admin',
            'text': note_text
        }
        notes.insert(0, new_note)
        
        app.notes = json.dumps(notes)
        app.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Notatka dodana', 'note': new_note}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Admin note add error: {str(e)}")
        return jsonify({'success': False, 'message': 'Błąd dodawania notatki'}), 500


@partner_academy_bp.route('/admin/api/learning-sessions/<session_id>')
@login_required
def get_admin_learning_session(session_id):
    """Szczegóły postępu w szkoleniu"""
    try:
        session = PartnerLearningSession.query.filter_by(session_id=session_id).first_or_404()
        
        return jsonify({
            'success': True,
            'data': {
                'session_id': session.session_id,
                'current_step': session.current_step,
                'completed_steps': session.completed_steps or [],
                'quiz_results': session.quiz_results or {},
                'total_time_spent': session.total_time_spent,
                'total_hours': round(session.total_time_spent / 3600, 2),
                'last_accessed_at': session.last_accessed_at.strftime('%Y-%m-%d %H:%M')
            }
        }), 200
    except Exception as e:
        current_app.logger.error(f"Admin session error: {str(e)}")
        return jsonify({'success': False, 'message': 'Błąd pobierania postępu'}), 500


@partner_academy_bp.route('/admin/api/export')
@login_required
def export_admin_applications():
    """Eksport do XLSX"""
    try:
        status_filter = request.args.get('status', '')
        search = request.args.get('search', '')
        
        query = PartnerApplication.query
        if status_filter:
            query = query.filter_by(status=status_filter)
        if search:
            pattern = f'%{search}%'
            query = query.filter(
                or_(
                    PartnerApplication.first_name.ilike(pattern),
                    PartnerApplication.last_name.ilike(pattern),
                    PartnerApplication.email.ilike(pattern)
                )
            )
        
        applications = query.order_by(desc(PartnerApplication.created_at)).all()
        
        wb = Workbook()
        ws = wb.active
        ws.title = "Aplikacje"
        
        headers = ['ID', 'Data', 'Imię', 'Nazwisko', 'Email', 'Telefon', 
                   'Miasto', 'Miejscowość', 'Doświadczenie', 'Status']
        ws.append(headers)
        
        for cell in ws[1]:
            cell.fill = PatternFill(start_color="ED6B24", end_color="ED6B24", fill_type="solid")
            cell.font = Font(bold=True, color="FFFFFF")
        
        for app in applications:
            ws.append([
                app.id,
                app.created_at.strftime('%Y-%m-%d %H:%M'),
                app.first_name,
                app.last_name,
                app.email,
                app.phone,
                app.city,
                app.locality,
                app.experience_level or '',
                app.status
            ])
        
        for column in ws.columns:
            max_length = max(len(str(cell.value)) for cell in column)
            ws.column_dimensions[column[0].column_letter].width = min(max_length + 2, 50)
        
        # Zapisz do pliku tymczasowego
        filename = f'aplikacje_{datetime.now().strftime("%Y-%m-%d")}.xlsx'
        filepath = os.path.join('/tmp', filename)
        wb.save(filepath)
        
        # Wyślij plik
        return send_file(
            filepath,
            as_attachment=True,
            download_name=filename,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        current_app.logger.error(f"Admin export error: {str(e)}")
        return jsonify({'success': False, 'message': 'Błąd eksportu'}), 500

@partner_academy_bp.route('/admin/api/applications/<int:app_id>/nda')
@login_required
def download_nda(app_id):
    """Pobierz/wyświetl plik NDA"""
    try:
        app = PartnerApplication.query.get_or_404(app_id)
        if not app.nda_filepath or not os.path.exists(app.nda_filepath):
            return jsonify({'success': False, 'message': 'Plik nie istnieje'}), 404
        
        return send_file(
            app.nda_filepath,
            mimetype=app.nda_mime_type,
            as_attachment=False  # False = wyświetl w przeglądarce
        )
    except Exception as e:
        current_app.logger.error(f"Download NDA error: {str(e)}")
        return jsonify({'success': False, 'message': 'Błąd pobierania pliku'}), 500