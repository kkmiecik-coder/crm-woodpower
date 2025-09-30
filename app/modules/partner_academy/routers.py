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

from flask import render_template, request, jsonify, current_app, send_file
from modules.partner_academy import partner_academy_bp
from modules.partner_academy.services import ApplicationService, EmailService, LearningService
from modules.partner_academy.validators import validate_application_data, validate_file, validate_quiz_answers
from modules.partner_academy.utils import rate_limit, get_quiz_answers, generate_nda_pdf
from extensions import db
import io


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