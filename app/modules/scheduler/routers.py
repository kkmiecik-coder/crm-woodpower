from flask import render_template, request, jsonify, flash, redirect, url_for, session
from modules.scheduler import scheduler_bp
from modules.scheduler.models import EmailSchedule, EmailLog, SchedulerConfig
from modules.scheduler.scheduler_service import (
    get_scheduler_status, trigger_job_manually, pause_job, resume_job, 
    update_job_schedule, remove_job
)
from modules.scheduler.jobs.quote_reminders import get_quote_reminders_stats, check_quote_reminders
from extensions import db
from datetime import datetime, timedelta
import sys

FRIENDLY_MESSAGES = {
    'jobs': {
        'quote_reminders_daily': 'Sprawdzanie przypomnień o wycenach',
        'weekly_report': 'Cotygodniowy raport sprzedaży',
        'monthly_cleanup': 'Miesięczne czyszczenie danych',
        'system_health_check': 'Sprawdzanie stanu systemu',
        'data_backup': 'Kopia zapasowa danych',
        'sync_baselinker': 'Synchronizacja z Baselinker'
    },
    'config_descriptions': {
        'quote_reminder_enabled': 'automatyczne przypomnienia o wycenach',
        'quote_reminder_days': 'liczbę dni po której wysyłane są przypomnienia',
        'daily_check_hour': 'godzinę codziennego sprawdzania',
        'max_reminder_attempts': 'maksymalną liczbę prób wysłania'
    },
    'errors': {
        'job_not_found': 'Nie znaleziono zadania o podanym identyfikatorze',
        'job_already_running': 'Zadanie jest już uruchomione',
        'job_not_running': 'Zadanie nie jest aktualnie uruchomione',
        'scheduler_not_available': 'System automatyzacji jest tymczasowo niedostępny',
        'invalid_hour': 'Godzina musi być liczbą z zakresu 0-23',
        'invalid_config': 'Nieprawidłowa wartość konfiguracji',
        'database_error': 'Błąd zapisu do bazy danych',
        'email_send_failed': 'Nie udało się wysłać powiadomienia email'
    }
}

def get_friendly_job_name(job_id):
    """Zwraca przyjazną nazwę zadania"""
    return FRIENDLY_MESSAGES['jobs'].get(job_id, job_id)

def get_friendly_config_name(config_key):
    """Zwraca przyjazny opis konfiguracji"""
    return FRIENDLY_MESSAGES['config_descriptions'].get(config_key, config_key)

def login_required(func):
    """Dekorator wymagający zalogowania"""
    from functools import wraps
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            flash("Twoja sesja wygasła. Zaloguj się ponownie.", "info")
            return redirect(url_for('login'))
        return func(*args, **kwargs)
    return wrapper

def admin_required(func):
    """Dekorator wymagający uprawnień administratora"""
    from functools import wraps
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            return redirect(url_for('login'))
        
        # Import tutaj żeby uniknąć circular imports
        from modules.calculator.models import User
        user = User.query.filter_by(email=user_email).first()
        if not user or user.role != 'admin':
            flash("Brak uprawnień do tej sekcji.", "error")
            return redirect(url_for('dashboard'))
        return func(*args, **kwargs)
    return wrapper

@scheduler_bp.route('/dashboard')
@login_required
@admin_required
def dashboard():
    """
    Główny dashboard schedulera - statystyki i overview
    """
    try:
        # Pobierz status schedulera
        scheduler_status = get_scheduler_status()
        
        # Pobierz statystyki przypomień o wycenach
        quote_stats = get_quote_reminders_stats()
        
        # Pobierz ostatnie logi (10 najnowszych)
        recent_logs = EmailLog.query.order_by(EmailLog.sent_at.desc()).limit(10).all()
        
        # Pobierz konfiguracje
        configs = {}
        config_records = SchedulerConfig.query.all()
        for config in config_records:
            configs[config.key] = config.value
        
        # POPRAWIONE STATYSTYKI
        total_scheduled = EmailSchedule.query.count()
        
        # Zaplanowane emaile (pending) - te które czekają na wysłanie
        pending_emails = EmailSchedule.query.filter_by(status='pending').count()
        
        # Failed emails - te które się nie udało wysłać
        failed_emails = EmailSchedule.query.filter_by(status='failed').count()
        
        # Logi z ostatnich 30 dni
        thirty_days_ago = datetime.now() - timedelta(days=30)
        recent_sent = EmailLog.query.filter(
            EmailLog.status == 'success',
            EmailLog.sent_at >= thirty_days_ago
        ).count()
        
        recent_failed = EmailLog.query.filter(
            EmailLog.status == 'failed',
            EmailLog.sent_at >= thirty_days_ago
        ).count()
        
        print(f"[Dashboard] Statystyki emaili:", file=sys.stderr)
        print(f"  - Łącznie zaplanowanych: {total_scheduled}", file=sys.stderr)
        print(f"  - Oczekujących (pending): {pending_emails}", file=sys.stderr)
        print(f"  - Nieudanych (failed): {failed_emails}", file=sys.stderr)
        print(f"  - Wysłanych (30 dni): {recent_sent}", file=sys.stderr)
        print(f"  - Błędów (30 dni): {recent_failed}", file=sys.stderr)
        
        return render_template(
            'scheduler_dashboard.html',
            scheduler_status=scheduler_status,
            quote_stats=quote_stats,
            recent_logs=recent_logs,
            configs=configs,
            total_scheduled=total_scheduled,
            pending_emails=pending_emails,
            failed_emails=failed_emails,
            user_email=session.get('user_email')
        )
        
    except Exception as e:
        print(f"[Scheduler Dashboard] Błąd: {e}", file=sys.stderr)
        flash(f"Błąd ładowania dashboard schedulera: {e}", "error")
        return redirect(url_for('dashboard'))

@scheduler_bp.route('/api/job/trigger/<job_id>', methods=['POST'])
@login_required
@admin_required
def trigger_job(job_id):
    """
    API endpoint do ręcznego uruchomienia zadania
    """
    try:
        job_name = get_friendly_job_name(job_id)
        success = trigger_job_manually(job_id)
        
        if success:
            return jsonify({
                'success': True,
                'message': f'✅ Zadanie "{job_name}" zostało uruchomione pomyślnie'
            })
        else:
            return jsonify({
                'success': False,
                'message': f'❌ Nie udało się uruchomić zadania "{job_name}". Sprawdź czy zadanie istnieje i jest aktywne.'
            }), 400
            
    except Exception as e:
        print(f"[API] Błąd uruchamiania zadania {job_id}: {e}", file=sys.stderr)
        job_name = get_friendly_job_name(job_id)
        
        # Spersonalizowane błędy
        if 'not found' in str(e).lower():
            error_msg = f'❌ Zadanie "{job_name}" nie zostało znalezione'
        elif 'already running' in str(e).lower():
            error_msg = f'⚠️ Zadanie "{job_name}" jest już uruchomione'
        else:
            error_msg = f'🔧 Wystąpił błąd podczas uruchamiania zadania "{job_name}"'
            
        return jsonify({
            'success': False,
            'message': error_msg
        }), 500

@scheduler_bp.route('/api/job/pause/<job_id>', methods=['POST'])
@login_required
@admin_required
def pause_job_api(job_id):
    """
    API endpoint do wstrzymania zadania
    """
    try:
        job_name = get_friendly_job_name(job_id)
        success = pause_job(job_id)
        
        if success:
            return jsonify({
                'success': True,
                'message': f'⏸️ Zadanie "{job_name}" zostało wstrzymane'
            })
        else:
            return jsonify({
                'success': False,
                'message': f'❌ Nie udało się wstrzymać zadania "{job_name}". Sprawdź czy zadanie jest aktywne.'
            }), 400
            
    except Exception as e:
        job_name = get_friendly_job_name(job_id)
        return jsonify({
            'success': False,
            'message': f'🔧 Wystąpił błąd podczas wstrzymywania zadania "{job_name}"'
        }), 500

@scheduler_bp.route('/api/job/resume/<job_id>', methods=['POST'])
@login_required
@admin_required
def resume_job_api(job_id):
    """
    API endpoint do wznowienia zadania
    """
    try:
        job_name = get_friendly_job_name(job_id)
        success = resume_job(job_id)
        
        if success:
            return jsonify({
                'success': True,
                'message': f'▶️ Zadanie "{job_name}" zostało wznowione'
            })
        else:
            return jsonify({
                'success': False,
                'message': f'❌ Nie udało się wznowić zadania "{job_name}". Sprawdź czy zadanie jest wstrzymane.'
            }), 400
            
    except Exception as e:
        job_name = get_friendly_job_name(job_id)
        return jsonify({
            'success': False,
            'message': f'🔧 Wystąpił błąd podczas wznawiania zadania "{job_name}"'
        }), 500

@scheduler_bp.route('/api/config/update', methods=['POST'])
@login_required
@admin_required
def update_config():
    """
    API endpoint do aktualizacji konfiguracji schedulera
    """
    try:
        data = request.get_json()
        config_key = data.get('key')
        config_value = data.get('value')
        
        if not config_key or config_value is None:
            return jsonify({
                'success': False,
                'message': '📝 Brak wymaganych danych. Sprawdź poprawność formularza.'
            }), 400
        
        config_name = get_friendly_config_name(config_key)
        
        # Znajdź i zaktualizuj konfigurację
        config = SchedulerConfig.query.filter_by(key=config_key).first()
        if config:
            old_value = config.value
            config.value = str(config_value)
            config.updated_at = datetime.now()
        else:
            # Utwórz nową konfigurację
            config = SchedulerConfig(
                key=config_key,
                value=str(config_value),
                description=f'Konfiguracja: {config_name}'
            )
            db.session.add(config)
            old_value = None
        
        db.session.commit()
        
        # Jeśli zmieniono godzinę sprawdzania, zaktualizuj harmonogram
        if config_key == 'daily_check_hour':
            try:
                new_hour = int(config_value)
                if not (0 <= new_hour <= 23):
                    raise ValueError("Godzina poza zakresem")
                    
                update_job_schedule('quote_reminders_daily', new_hour=new_hour)
                
                return jsonify({
                    'success': True,
                    'message': f'⏰ Godzina sprawdzania została zmieniona na {new_hour}:00'
                })
            except ValueError:
                return jsonify({
                    'success': False,
                    'message': '❌ Godzina musi być liczbą z zakresu 0-23'
                }), 400
        
        # Komunikaty dla innych konfiguracji
        success_messages = {
            'quote_reminder_enabled': f'✅ Przypomnienia o wycenach zostały {"włączone" if config_value == "true" else "wyłączone"}',
            'quote_reminder_days': f'📅 Przypomnienia będą wysyłane po {config_value} dniach',
            'max_reminder_attempts': f'🔄 Maksymalna liczba prób wysłania ustawiona na {config_value}'
        }
        
        message = success_messages.get(config_key, f'✅ Ustawienie "{config_name}" zostało zaktualizowane')
        
        return jsonify({
            'success': True,
            'message': message
        })
        
    except Exception as e:
        db.session.rollback()
        print(f"[API] Błąd aktualizacji konfiguracji: {e}", file=sys.stderr)
        
        # Spersonalizowane komunikaty błędów
        if 'database' in str(e).lower():
            error_msg = '💾 Błąd zapisu do bazy danych. Spróbuj ponownie.'
        elif 'validation' in str(e).lower():
            error_msg = '📝 Wprowadzone dane są nieprawidłowe.'
        else:
            error_msg = '🔧 Wystąpił nieoczekiwany błąd. Skontaktuj się z administratorem.'
            
        return jsonify({
            'success': False,
            'message': error_msg
        }), 500

@scheduler_bp.route('/api/logs/quotes')
@login_required
@admin_required
def get_quote_logs():
    """
    API endpoint zwracający logi przypomień o wycenach
    """
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        status_filter = request.args.get('status', '')
        
        # Bazowe zapytanie
        query = EmailLog.query.filter_by(email_type='quote_reminder_7_days')
        
        # Filtrowanie po statusie
        if status_filter:
            query = query.filter_by(status=status_filter)
        
        # Sortowanie i paginacja
        logs = query.order_by(EmailLog.sent_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        # Przygotuj dane do JSON
        logs_data = []
        for log in logs.items:
            log_data = {
                'id': log.id,
                'quote_id': log.quote_id,
                'recipient_email': log.recipient_email,
                'status': log.status,
                'error_message': log.error_message,
                'sent_at': log.sent_at.strftime('%Y-%m-%d %H:%M:%S'),
                'quote_number': log.quote.quote_number if log.quote else 'N/A'
            }
            logs_data.append(log_data)
        
        return jsonify({
            'success': True,
            'logs': logs_data,
            'pagination': {
                'page': logs.page,
                'pages': logs.pages,
                'per_page': logs.per_page,
                'total': logs.total,
                'has_next': logs.has_next,
                'has_prev': logs.has_prev
            }
        })
        
    except Exception as e:
        print(f"[API] Błąd pobierania logów: {e}", file=sys.stderr)
        return jsonify({
            'success': False,
            'message': f'Błąd: {str(e)}'
        }), 500

@scheduler_bp.route('/api/stats/refresh')
@login_required
@admin_required
def refresh_stats():
    """
    API endpoint do odświeżenia statystyk
    """
    try:
        quote_stats = get_quote_reminders_stats()
        scheduler_status = get_scheduler_status()
        
        return jsonify({
            'success': True,
            'quote_stats': quote_stats,
            'scheduler_status': scheduler_status
        })
        
    except Exception as e:
        print(f"[API] Błąd odświeżania statystyk: {e}", file=sys.stderr)
        return jsonify({
            'success': False,
            'message': f'Błąd: {str(e)}'
        }), 500

# Zamień funkcję test_check_quotes():
@scheduler_bp.route('/test/check-quotes')
@login_required
@admin_required
def test_check_quotes():
    """
    Endpoint testowy do ręcznego sprawdzenia wycen
    """
    try:
        print("[TEST] Ręczne uruchomienie sprawdzania wycen", file=sys.stderr)
        check_quote_reminders()
        flash("🧪 Test sprawdzania wycen został zakończony pomyślnie. Sprawdź logi w systemie.", "success")
        return redirect(url_for('settings'))
        
    except Exception as e:
        print(f"[TEST] Błąd testowego sprawdzania wycen: {e}", file=sys.stderr)
        flash(f"❌ Wystąpił błąd podczas testowania: {str(e)}", "error")
        return redirect(url_for('settings'))

@scheduler_bp.route('/api/schedule/upcoming')
@login_required
@admin_required
def get_upcoming_emails():
    """
    API endpoint zwracający nadchodzące zaplanowane emaile
    """
    try:
        # Pobierz emaile zaplanowane na najbliższe 7 dni
        week_from_now = datetime.now() + timedelta(days=7)
        
        upcoming = EmailSchedule.query.filter(
            EmailSchedule.status == 'pending',
            EmailSchedule.scheduled_date <= week_from_now
        ).order_by(EmailSchedule.scheduled_date.asc()).limit(20).all()
        
        upcoming_data = []
        for email in upcoming:
            upcoming_data.append({
                'id': email.id,
                'quote_id': email.quote_id,
                'quote_number': email.quote.quote_number if email.quote else 'N/A',
                'email_type': email.email_type,
                'recipient_email': email.recipient_email,
                'scheduled_date': email.scheduled_date.strftime('%Y-%m-%d %H:%M:%S'),
                'attempts': email.attempts
            })
        
        return jsonify({
            'success': True,
            'upcoming_emails': upcoming_data
        })
        
    except Exception as e:
        print(f"[API] Błąd pobierania nadchodzących emaili: {e}", file=sys.stderr)
        return jsonify({
            'success': False,
            'message': f'Błąd: {str(e)}'
        }), 500

@scheduler_bp.route('/api/test/send-quote-reminder', methods=['POST'])
@login_required
@admin_required
def send_test_quote_reminder():
    """
    API endpoint do wysyłania próbnego przypomnienia o wycenie
    """
    try:
        data = request.get_json()
        quote_id = data.get('quote_id')
        
        if not quote_id:
            return jsonify({
                'success': False,
                'message': 'Brak ID wyceny w żądaniu'
            }), 400
        
        # Sprawdź czy ID jest liczbą
        try:
            quote_id = int(quote_id)
        except (ValueError, TypeError):
            return jsonify({
                'success': False,
                'message': 'ID wyceny musi być liczbą'
            }), 400
        
        print(f"[TEST QUOTE EMAIL] Rozpoczynam wysyłanie próbnego przypomnienia dla wyceny ID: {quote_id}", file=sys.stderr)
        
        # Import modeli
        from modules.quotes.models import Quote
        from modules.scheduler.jobs.quote_reminders import send_quote_reminder_email
        
        # Znajdź wycenę
        quote = Quote.query.get(quote_id)
        if not quote:
            print(f"[TEST QUOTE EMAIL] Nie znaleziono wyceny ID: {quote_id}", file=sys.stderr)
            return jsonify({
                'success': False,
                'message': f'Nie znaleziono wyceny o ID: {quote_id}'
            }), 404
        
        # Sprawdź czy wycena ma klienta i email
        if not quote.client:
            return jsonify({
                'success': False,
                'message': f'Wycena {quote.quote_number} nie ma przypisanego klienta'
            }), 400
        
        if not quote.client.email:
            return jsonify({
                'success': False,
                'message': f'Klient wyceny {quote.quote_number} nie ma adresu email'
            }), 400
        
        print(f"[TEST QUOTE EMAIL] Wysyłam przypomnienie dla wyceny {quote.quote_number} na {quote.client.email}", file=sys.stderr)
        
        # Użyj istniejącej funkcji do wysyłania przypomnień
        success = send_quote_reminder_email(quote)
        
        if success:
            print(f"[TEST QUOTE EMAIL] Próbne przypomnienie wysłane pomyślnie dla wyceny {quote.quote_number}", file=sys.stderr)
            
            return jsonify({
                'success': True,
                'message': f'Próbne przypomnienie o wycenie {quote.quote_number} zostało wysłane na {quote.client.email}'
            })
        else:
            print(f"[TEST QUOTE EMAIL] Błąd wysyłania próbnego przypomnienia dla wyceny {quote.quote_number}", file=sys.stderr)
            
            return jsonify({
                'success': False,
                'message': f'Nie udało się wysłać przypomnienia o wycenie {quote.quote_number}. Sprawdź logi systemu.'
            }), 500
        
    except Exception as e:
        print(f"[TEST QUOTE EMAIL] Błąd wysyłania próbnego przypomnienia: {e}", file=sys.stderr)
        
        return jsonify({
            'success': False,
            'message': f'Błąd serwera: {str(e)}'
        }), 500