# app/modules/partner_academy/validators.py
"""
Partner Academy Validators
===========================

Walidacja danych wejściowych dla modułu PartnerAcademy.

Validators:
- validate_application_data: Walidacja formularza rekrutacyjnego
- validate_file: Walidacja uploadowanego pliku NDA
- validate_quiz_answers: Walidacja odpowiedzi quizu (później)

Autor: Development Team
Data: 2025-09-30
"""

import re
import magic
from flask import current_app


def validate_application_data(data, partial=False):
    """
    Walidacja danych formularza aplikacyjnego
    
    Args:
        data (dict): Słownik z danymi z formularza
        partial (bool): Jeśli True, waliduj tylko podane pola (real-time validation)
        
    Returns:
        dict: {
            'valid': bool,
            'errors': dict  # {'field_name': 'error_message'}
        }
    """
    errors = {}
    
    # Lista wymaganych pól
    required_fields = [
        'first_name', 'last_name', 'email', 'phone', 
        'city', 'locality'
    ]
    
    # Sprawdź wymagane pola (tylko jeśli nie partial)
    if not partial:
        for field in required_fields:
            if not data.get(field) or str(data.get(field)).strip() == '':
                errors[field] = 'To pole jest wymagane'
    
    # Walidacja email
    if 'email' in data and data['email']:
        email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_regex, data['email']):
            errors['email'] = 'Nieprawidłowy format adresu email'
    
    # Walidacja telefonu (polski format)
    if 'phone' in data and data['phone']:
        # Usuń spacje i znaki specjalne
        phone_clean = re.sub(r'[\s\-()]', '', data['phone'])
        # Akceptuj: +48123456789, 48123456789, 123456789
        phone_regex = r'^(\+?48)?[0-9]{9}$'
        if not re.match(phone_regex, phone_clean):
            errors['phone'] = 'Nieprawidłowy format numeru telefonu. Wymagane 9 cyfr.'
    
    # Walidacja imienia (tylko litery, spacje, myślniki)
    if 'first_name' in data and data['first_name']:
        name_regex = r'^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s\-]+$'
        if not re.match(name_regex, data['first_name']):
            errors['first_name'] = 'Imię może zawierać tylko litery'
    
    # Walidacja nazwiska (tylko litery, spacje, myślniki)
    if 'last_name' in data and data['last_name']:
        name_regex = r'^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s\-]+$'
        if not re.match(name_regex, data['last_name']):
            errors['last_name'] = 'Nazwisko może zawierać tylko litery'
    
    # Walidacja zgody RODO (tylko jeśli nie partial)
    if not partial:
        if not data.get('data_processing_consent'):
            errors['data_processing_consent'] = 'Zgoda na przetwarzanie danych jest wymagana'
    
    return {
        'valid': len(errors) == 0,
        'errors': errors
    }


def validate_file(file):
    """
    Walidacja uploadowanego pliku NDA
    
    Args:
        file (FileStorage): Obiekt pliku z Flaska
        
    Returns:
        dict: {
            'valid': bool,
            'message': str
        }
    """
    ALLOWED_MIME_TYPES = {
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text'
    }
    MAX_SIZE = 5 * 1024 * 1024  # 5 MB
    
    # Sprawdź czy plik istnieje
    if not file or file.filename == '':
        return {
            'valid': False,
            'message': 'Nie wybrano pliku'
        }
    
    # Sprawdź rozmiar pliku
    file.seek(0, 2)  # Przejdź na koniec
    size = file.tell()
    file.seek(0)  # Wróć na początek
    
    if size > MAX_SIZE:
        return {
            'valid': False,
            'message': f'Plik jest za duży. Maksymalny rozmiar to 5 MB (Twój plik: {size / 1024 / 1024:.1f} MB)'
        }
    
    if size == 0:
        return {
            'valid': False,
            'message': 'Plik jest pusty'
        }
    
    # Sprawdź MIME type (prawdziwy, nie tylko extension)
    try:
        file_content = file.read(2048)  # Przeczytaj pierwsze 2KB
        file.seek(0)  # Wróć na początek
        
        mime_type = magic.from_buffer(file_content, mime=True)
        
        if mime_type not in ALLOWED_MIME_TYPES:
            return {
                'valid': False,
                'message': f'Niedozwolony typ pliku ({mime_type}). Dozwolone formaty: PDF, JPG, PNG, DOCX, ODT'
            }
    except Exception as e:
        current_app.logger.error(f"[Validator] Błąd sprawdzania MIME: {e}")
        return {
            'valid': False,
            'message': 'Nie można zweryfikować typu pliku'
        }
    
    return {
        'valid': True,
        'message': ''
    }


def validate_quiz_answers(step, answers, correct_answers):
    """
    Walidacja odpowiedzi quizu
    
    Args:
        step (str): Krok (np. '1.1', 'M1')
        answers (dict): Odpowiedzi użytkownika {'q1': 'B', 'q2': ['A', 'C']}
        correct_answers (dict): Prawidłowe odpowiedzi
        
    Returns:
        dict: {
            'all_correct': bool,
            'results': dict  # {'q1': bool, 'q2': bool}
        }
    """
    results = {}
    all_correct = True
    
    for question_id, user_answer in answers.items():
        correct = correct_answers.get(question_id)
        
        if correct is None:
            # Nieznane pytanie
            results[question_id] = False
            all_correct = False
            continue
        
        # Multiple choice (lista odpowiedzi)
        if isinstance(correct, list):
            is_correct = set(user_answer) == set(correct) if isinstance(user_answer, list) else False
        # Single choice (jedna odpowiedź)
        else:
            is_correct = user_answer == correct
        
        results[question_id] = is_correct
        
        if not is_correct:
            all_correct = False
    
    return {
        'all_correct': all_correct,
        'results': results
    }