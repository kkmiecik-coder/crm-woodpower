# app/modules/partner_academy/utils.py
"""
Partner Academy Utils
=====================

Funkcje pomocnicze dla modułu PartnerAcademy.

Utils:
- generate_nda_pdf: Generowanie PDF z umową NDA
- rate_limit: Dekorator rate limiting
- get_quiz_answers: Pobieranie prawidłowych odpowiedzi do quizów

Autor: Development Team
Data: 2025-09-30
"""

from functools import wraps
from flask import request, jsonify
from datetime import datetime, timedelta
import io


# ============================================================================
# RATE LIMITING
# ============================================================================

# Prosta implementacja rate limiting w pamięci
_rate_limit_storage = {}

def rate_limit(max_requests=5, window=60):
    """
    Dekorator rate limiting
    
    Args:
        max_requests (int): Maksymalna liczba requestów
        window (int): Okno czasowe w sekundach
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Identyfikator klienta (IP)
            client_id = request.headers.get('X-Forwarded-For', request.remote_addr)
            if client_id and ',' in client_id:
                client_id = client_id.split(',')[0].strip()
            
            # Klucz w storage
            key = f"{f.__name__}:{client_id}"
            now = datetime.now()
            
            # Inicjalizacja jeśli brak
            if key not in _rate_limit_storage:
                _rate_limit_storage[key] = []
            
            # Usuń stare requesty spoza okna
            _rate_limit_storage[key] = [
                timestamp for timestamp in _rate_limit_storage[key]
                if now - timestamp < timedelta(seconds=window)
            ]
            
            # Sprawdź limit
            if len(_rate_limit_storage[key]) >= max_requests:
                return jsonify({
                    'success': False,
                    'error': 'Zbyt wiele requestów. Spróbuj ponownie za chwilę.'
                }), 429
            
            # Dodaj nowy request
            _rate_limit_storage[key].append(now)
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator


# ============================================================================
# QUIZ ANSWERS
# ============================================================================

def get_quiz_answers(step):
    """
    Pobierz prawidłowe odpowiedzi dla danego quizu
    
    Args:
        step (str): Identyfikator kroku (np. 'M1', 'M2')
        
    Returns:
        dict: Słownik z prawidłowymi odpowiedziami {question_id: correct_answer}
    """
    
    # Przykładowe odpowiedzi - dostosuj do rzeczywistych pytań
    quiz_answers = {
        'M1': {
            'q1': 'b',
            'q2': 'a',
            'q3': 'c',
            'q4': 'b',
            'q5': 'a'
        },
        'M2': {
            'q1': 'a',
            'q2': 'c',
            'q3': 'b',
            'q4': 'a',
            'q5': 'c'
        }
        # Dodaj więcej quizów według potrzeb
    }
    
    return quiz_answers.get(step, {})


# ============================================================================
# NDA PDF GENERATION
# ============================================================================

def generate_nda_pdf(data):
    """
    Generuj PDF z NDA używając WeasyPrint i HTML template
    
    Args:
        data (dict): Dane z formularza zawierające:
            - first_name, last_name, email, phone
            - city, locality, pesel
            - is_b2b (opcjonalnie 'on')
            - company_name, nip, company_address, company_city, company_postal_code (jeśli B2B)
            
    Returns:
        bytes: PDF jako bytes (surowe bajty, nie BytesIO)
    """
    try:
        from weasyprint import HTML
        from flask import render_template, current_app
        import os
        
        # Dodaj bieżącą datę do danych
        data['current_date'] = datetime.now().strftime('%d.%m.%Y')
        
        # Sprawdź czy to B2B
        is_b2b = data.get('is_b2b') == 'on'
        data['is_b2b_bool'] = is_b2b
        
        # Przygotuj ścieżki do obrazów (bezwzględne, rzeczywiste ścieżki na dysku)
        app_root = os.path.abspath(current_app.root_path)
        
        logo_path = os.path.abspath(os.path.join(app_root, 'static', 'images', 'logo.png'))
        sign_path = os.path.abspath(os.path.join(app_root, 'modules', 'partner_academy', 'static', 'media', 'images', 'sign.png'))
        
        # Debug - sprawdź czy pliki istnieją
        current_app.logger.info(f"Logo path: {logo_path}, exists: {os.path.exists(logo_path)}")
        current_app.logger.info(f"Sign path: {sign_path}, exists: {os.path.exists(sign_path)}")
        
        # Dodaj ścieżki do danych dla template
        data['logo_path'] = logo_path
        data['sign_path'] = sign_path
        
        # Renderuj HTML template z danymi
        html_content = render_template(
            'nda_template.html',
            **data
        )
        
        # Generuj PDF z HTML - zwróć surowe bajty
        html = HTML(string=html_content, base_url=app_root)
        pdf_bytes = html.write_pdf()
        
        # Zwróć surowe bajty zamiast BytesIO
        return pdf_bytes
        
    except ImportError:
        raise Exception("WeasyPrint nie jest zainstalowane. Użyj: pip install WeasyPrint")
    except Exception as e:
        current_app.logger.error(f"Error generating NDA PDF: {str(e)}")
        import traceback
        traceback.print_exc()
        return None