# app/modules/partner_academy/utils.py
"""
Partner Academy Utilities
==========================

Funkcje pomocnicze dla modułu PartnerAcademy.

Utils:
- rate_limit: Decorator rate limitingu
- generate_session_id: Generowanie unikalnego ID sesji
- get_next_step: Nawigacja między krokami
- get_quiz_answers: Ładowanie prawidłowych odpowiedzi quizu
- generate_nda_pdf: Generowanie PDF z NDA (opcjonalne)

Autor: Development Team
Data: 2025-09-30
"""

from functools import wraps
from flask import request, jsonify
from datetime import datetime, timedelta
import hashlib
import os


# ============================================================================
# RATE LIMITING
# ============================================================================

# Cache dla rate limitingu (w produkcji użyj Redis)
_rate_limit_cache = {}
_quiz_answers_cache = None


def rate_limit(limit=20, per_hour=True):
    """
    Decorator rate limitingu dla API endpoints
    
    Args:
        limit (int): Liczba dozwolonych requestów
        per_hour (bool): True = na godzinę, False = na minutę
    
    Usage:
        @rate_limit(limit=20, per_hour=True)
        def my_endpoint():
            ...
    """
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            # Identyfikator klienta (IP + endpoint)
            ip = request.remote_addr
            endpoint = request.endpoint
            key = f"{ip}:{endpoint}"
            
            current_time = datetime.now()
            
            # Sprawdź cache
            if key in _rate_limit_cache:
                requests, reset_time = _rate_limit_cache[key]
                
                # Resetuj jeśli minął przedział czasowy
                if current_time > reset_time:
                    requests = 0
                    window = timedelta(hours=1) if per_hour else timedelta(minutes=1)
                    reset_time = current_time + window
                
                # Sprawdź limit
                if requests >= limit:
                    return jsonify({
                        'success': False,
                        'error': 'Przekroczono limit żądań. Spróbuj ponownie później.',
                        'retry_after': int((reset_time - current_time).total_seconds())
                    }), 429
                
                requests += 1
                _rate_limit_cache[key] = (requests, reset_time)
            else:
                # Pierwszy request
                window = timedelta(hours=1) if per_hour else timedelta(minutes=1)
                reset_time = current_time + window
                _rate_limit_cache[key] = (1, reset_time)
            
            return f(*args, **kwargs)
        return wrapped
    return decorator


# ============================================================================
# SESSION MANAGEMENT
# ============================================================================

def generate_session_id():
    """
    Generuj unikalny ID sesji dla learning platform
    
    Returns:
        str: Unikalny hash SHA256 (64 znaki)
    """
    timestamp = str(datetime.now().timestamp())
    random_data = os.urandom(16).hex()
    combined = f"{timestamp}{random_data}"
    return hashlib.sha256(combined.encode()).hexdigest()


# ============================================================================
# LEARNING NAVIGATION
# ============================================================================

def get_next_step(current_step):
    """
    Zwróć następny krok w sekwencji szkoleniowej
    
    Args:
        current_step (str): Aktualny krok (np. '1.1')
        
    Returns:
        str: Następny krok lub None jeśli ostatni
    """
    steps = ['1.1', '1.2', '1.3', '1.4', 'M1', '2.1', '2.2', '2.3', '2.4', 'M2', '3.1']
    
    try:
        current_index = steps.index(current_step)
        if current_index < len(steps) - 1:
            return steps[current_index + 1]
        return None  # Ostatni krok
    except ValueError:
        # Nieznany krok - zwróć pierwszy
        return '1.1'


def get_step_label(step):
    """
    Zwróć czytelną nazwę kroku
    
    Args:
        step (str): Kod kroku (np. '1.1')
        
    Returns:
        str: Nazwa kroku
    """
    labels = {
        '1.1': 'Gatunki drewna',
        '1.2': 'Technologia',
        '1.3': 'Klasy',
        '1.4': 'Wykończenia',
        'M1': 'Quiz Moduł 1',
        '2.1': 'Kalkulator',
        '2.2': 'Wyceny CRM',
        '2.3': 'Zamawianie',
        '2.4': 'Opieka posprzedażowa',
        'M2': 'Quiz Moduł 2',
        '3.1': 'Materiały PDF'
    }
    return labels.get(step, step)


# ============================================================================
# QUIZ MANAGEMENT
# ============================================================================

def get_quiz_answers(step):
    """
    Załaduj prawidłowe odpowiedzi dla quizu z pliku JSON (z cachem)
    
    Args:
        step (str): Kod kroku (np. '1.1', 'M1')
        
    Returns:
        dict: Słownik z prawidłowymi odpowiedziami
        
    Format:
        {
            'q1': 'B',              # single choice
            'q2': ['A', 'C', 'D']   # multiple choice
        }
    """
    global _quiz_answers_cache
    import json
    from flask import current_app
    
    # Jeśli cache pusty, wczytaj z pliku
    if _quiz_answers_cache is None:
        try:
            config_path = os.path.join(
                current_app.root_path, 
                'modules', 
                'partner_academy', 
                'config', 
                'quiz_answers.json'
            )
            
            with open(config_path, 'r', encoding='utf-8') as f:
                _quiz_answers_cache = json.load(f)
            
            current_app.logger.info("[Utils] Wczytano quiz_answers.json do cache")
        
        except Exception as e:
            current_app.logger.error(f"[Utils] Błąd ładowania quiz answers: {e}")
            _quiz_answers_cache = {}
    
    return _quiz_answers_cache.get(step, {})

# ============================================================================
# NDA PDF GENERATION (OPCJONALNE - wymaga WeasyPrint)
# ============================================================================

def generate_nda_pdf(data):
    """
    Generuj PDF z NDA używając WeasyPrint
    """
    try:
        from weasyprint import HTML
        from flask import render_template
        from io import BytesIO
        from datetime import datetime
        
        # DODAJ datę do danych
        data['current_date'] = datetime.now().strftime('%d.%m.%Y')
        
        # Renderuj HTML template z danymi
        html_content = render_template(
            'nda_template.html',  # ← BEZ partner_academy/
            **data
        )
        
        # Generuj PDF
        html = HTML(string=html_content)
        out = BytesIO()
        html.write_pdf(out)
        out.seek(0)
        
        return out.read()
        
    except ImportError:
        raise Exception("WeasyPrint nie jest zainstalowane. Użyj: pip install WeasyPrint")