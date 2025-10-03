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
Ostatnia aktualizacja: 2025-10-02 - Dodanie debugowania i poprawka mapowania pól
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
    
    Usage:
        @rate_limit(max_requests=10, window=60)
        def my_endpoint():
            ...
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

def get_quiz_answers(step=None):
    """
    Pobierz prawidłowe odpowiedzi dla danego quizu lub wszystkich quizów
    
    Args:
        step (str, optional): Identyfikator kroku (np. 'M1', 'M2'). 
                             Jeśli None, zwraca wszystkie odpowiedzi.
        
    Returns:
        dict: Słownik z prawidłowymi odpowiedziami
              Jeśli step podany: {question_id: correct_answer}
              Jeśli step None: {step_id: {question_id: correct_answer}}
    
    Example:
        >>> get_quiz_answers('M1')
        {'q1': 'b', 'q2': 'a', 'q3': 'c'}
        
        >>> get_quiz_answers()
        {'M1': {'q1': 'b', 'q2': 'a'}, 'M2': {'q1': 'a', 'q2': 'c'}}
    """
    
    # Wszystkie odpowiedzi do quizów
    # UWAGA: To są przykładowe odpowiedzi - zastąp je rzeczywistymi
    quiz_answers = {
        'M1': {
            'q1': 'b',  # Przykładowa odpowiedź
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
        },
        # Dodaj więcej quizów według potrzeb:
        # 'M3': {...},
        # 'FINAL': {...}
    }
    
    if step:
        return quiz_answers.get(step, {})
    return quiz_answers


# ============================================================================
# NDA PDF GENERATION
# ============================================================================

def generate_nda_pdf(data):
    """
    Generuj PDF z NDA używając WeasyPrint i HTML template
    
    Args:
        data (dict): Dane z formularza zawierające:
            Dane osobowe:
            - first_name, last_name, email, phone
            - city, address (adres), postal_code, pesel
            
            Dane B2B (opcjonalnie):
            - cooperation_type: 'b2b' lub 'contract'
            - company_name, nip, regon
            - company_address, company_city, company_postal_code
            
    Returns:
        bytes: PDF jako surowe bajty
        
    Raises:
        Exception: Gdy WeasyPrint nie jest zainstalowany lub wystąpi błąd generowania
    
    Example:
        >>> data = {
        ...     'first_name': 'Jan',
        ...     'last_name': 'Kowalski',
        ...     'email': 'jan@example.com',
        ...     'city': 'Warszawa',
        ...     'address': 'ul. Przykładowa 10',
        ...     'postal_code': '00-001',
        ...     'pesel': '12345678901',
        ...     'cooperation_type': 'contract'
        ... }
        >>> pdf_bytes = generate_nda_pdf(data)
    """
    try:
        from weasyprint import HTML
        from flask import render_template, current_app
        import os
        
        # Dodaj bieżącą datę do danych
        data['current_date'] = datetime.now().strftime('%d.%m.%Y')
        
        # Sprawdź czy to B2B
        is_b2b = data.get('cooperation_type') == 'b2b'
        data['is_b2b_bool'] = is_b2b
                
        # Przygotuj ścieżki do obrazów (bezwzględne, rzeczywiste ścieżki na dysku)
        app_root = os.path.abspath(current_app.root_path)
        
        # Ścieżki do logo i podpisu
        logo_path = os.path.abspath(
            os.path.join(app_root, 'static', 'images', 'logo.png')
        )
        sign_path = os.path.abspath(
            os.path.join(
                app_root, 
                'modules', 
                'partner_academy', 
                'static', 
                'media', 
                'images', 
                'sign.png'
            )
        )
        
        # Jeśli pliki nie istnieją, użyj placeholder lub pomiń
        if not os.path.exists(logo_path):
            logo_path = None
        
        if not os.path.exists(sign_path):
            sign_path = None
        
        # Dodaj ścieżki do danych dla template
        data['logo_path'] = logo_path
        data['sign_path'] = sign_path
        
        # Renderuj HTML template z danymi
        html_content = render_template(
            'nda_template.html',
            **data
        )
        
        # DEBUGOWANIE - Loguj fragment HTML z danymi osobowymi
        if 'PESEL' in html_content:
            start_idx = html_content.find('PESEL')
            snippet = html_content[max(0, start_idx-100):start_idx+200]
            current_app.logger.info(f"HTML snippet around PESEL: {snippet}")
        
        # Generuj PDF z HTML - zwróć surowe bajty
        html = HTML(string=html_content, base_url=app_root)
        pdf_bytes = html.write_pdf()
        
        # Zwróć surowe bajty
        return pdf_bytes
        
    except ImportError as e:
        error_msg = "WeasyPrint nie jest zainstalowane. Użyj: pip install WeasyPrint"
        current_app.logger.error(error_msg)
        raise Exception(error_msg)
        
    except Exception as e:
        current_app.logger.error(f"Error generating NDA PDF: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        raise


# Koniec pliku utils.py