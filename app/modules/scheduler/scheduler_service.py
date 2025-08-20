from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.executors.pool import ThreadPoolExecutor
import atexit
import sys
from flask import current_app
from modules.scheduler.jobs.quote_reminders import check_quote_reminders
from modules.scheduler.models import SchedulerConfig, create_default_scheduler_config
from extensions import db

# Globalny scheduler
scheduler = None


def init_scheduler(app):
    """
    Inicjalizuje i uruchamia APScheduler z kontekstem aplikacji Flask
    """
    global scheduler
    
    try:
        print("[Scheduler] Inicjalizacja APScheduler...", file=sys.stderr)
        
        # Konfiguracja executorów i jobstore
        executors = {
            'default': ThreadPoolExecutor(max_workers=3)
        }
        
        job_defaults = {
            'coalesce': True,
            'max_instances': 1,
            'misfire_grace_time': 300
        }
        
        # Tworzenie schedulera
        scheduler = BackgroundScheduler(
            executors=executors,
            job_defaults=job_defaults,
            timezone='Europe/Warsaw'
        )
        
        # Dodanie jobów z kontekstem aplikacji
        with app.app_context():
            # Sprawdź/utwórz domyślne konfiguracje
            create_default_scheduler_config()
            
            # ZADANIE 1: Sprawdzanie wycen (codziennie)
            add_quote_check_job(app)
            
            # ZADANIE 2: Wysyłka emaili (co godzinę)
            add_email_send_job(app)
        
        # Uruchomienie schedulera
        scheduler.start()
        print("[Scheduler] APScheduler uruchomiony pomyślnie", file=sys.stderr)
        
        # Wyloguj informacje o zaplanowanych zadaniach
        log_scheduled_jobs()
        
    except Exception as e:
        print(f"[Scheduler] BŁĄD inicjalizacji: {e}", file=sys.stderr)
        if scheduler:
            scheduler.shutdown()

def add_quote_check_job(app):
    """
    Dodaje job sprawdzania wycen (tylko sprawdzanie, bez wysyłki)
    """
    try:
        # Pobierz godzinę z konfiguracji
        hour_config = SchedulerConfig.query.filter_by(key='daily_check_hour').first()
        check_hour = int(hour_config.value) if hour_config else 9
        
        # Wrapper funkcji z kontekstem aplikacji
        def quote_check_job_wrapper():
            with app.app_context():
                try:
                    print(f"[SCHEDULER JOB] === URUCHOMIENIE SPRAWDZANIA WYCEN ===", file=sys.stderr)
                    print(f"[SCHEDULER JOB] Czas uruchomienia: {datetime.now()}", file=sys.stderr)
                    print(f"[SCHEDULER JOB] Zadanie: quote_check_daily", file=sys.stderr)
                    
                    # Import tutaj żeby uniknąć circular imports
                    from modules.scheduler.jobs.quote_reminders import check_quote_reminders
                    
                    check_quote_reminders()  # Tylko sprawdzanie, bez wysyłki
                    
                    print(f"[SCHEDULER JOB] === ZAKOŃCZENIE SPRAWDZANIA WYCEN ===", file=sys.stderr)
                    
                except Exception as e:
                    print(f"[SCHEDULER JOB] BŁĄD w zadaniu sprawdzania wycen: {e}", file=sys.stderr)
                    import traceback
                    traceback.print_exc(file=sys.stderr)
        
        # Dodanie zadania do schedulera
        scheduler.add_job(
            func=quote_check_job_wrapper,
            trigger=CronTrigger(hour=check_hour, minute=0),
            id='quote_check_daily',
            name='Sprawdzanie wycen do przypomnienia',
            replace_existing=True
        )
        
        print(f"[Scheduler] Dodano zadanie: sprawdzanie wycen codziennie o {check_hour}:00", file=sys.stderr)
        
    except Exception as e:
        print(f"[Scheduler] Błąd dodawania zadania sprawdzania wycen: {e}", file=sys.stderr)

def add_email_send_job(app):
    """
    Dodaje job wysyłki zaplanowanych emaili (codziennie, 1h po sprawdzaniu)
    """
    try:
        # Pobierz godzinę sprawdzania i opóźnienie
        hour_config = SchedulerConfig.query.filter_by(key='daily_check_hour').first()
        delay_config = SchedulerConfig.query.filter_by(key='email_send_delay').first()
        
        check_hour = int(hour_config.value) if hour_config else 9
        delay_hours = int(delay_config.value) if delay_config else 1
        
        # Oblicz godzinę wysyłki
        send_hour = (check_hour + delay_hours) % 24
        
        # Wrapper funkcji z kontekstem aplikacji
        def email_send_job_wrapper():
            with app.app_context():
                try:
                    print(f"[SCHEDULER JOB] === URUCHOMIENIE WYSYŁKI EMAILI ===", file=sys.stderr)
                    print(f"[SCHEDULER JOB] Czas uruchomienia: {datetime.now()}", file=sys.stderr)
                    print(f"[SCHEDULER JOB] Zadanie: email_send_daily", file=sys.stderr)
                    
                    # Import tutaj żeby uniknąć circular imports
                    from modules.scheduler.jobs.quote_reminders import send_scheduled_emails
                    
                    send_scheduled_emails()
                    
                    print(f"[SCHEDULER JOB] === ZAKOŃCZENIE WYSYŁKI EMAILI ===", file=sys.stderr)
                    
                except Exception as e:
                    print(f"[SCHEDULER JOB] BŁĄD w zadaniu wysyłki emaili: {e}", file=sys.stderr)
                    import traceback
                    traceback.print_exc(file=sys.stderr)
        
        # Dodanie zadania do schedulera
        scheduler.add_job(
            func=email_send_job_wrapper,
            trigger=CronTrigger(hour=send_hour, minute=0),  # Codziennie o określonej godzinie
            id='email_send_daily',
            name='Wysyłka zaplanowanych emaili',
            replace_existing=True
        )
        
        print(f"[Scheduler] Dodano zadanie: wysyłka emaili codziennie o {send_hour}:00 (sprawdzanie + {delay_hours}h)", file=sys.stderr)
        
    except Exception as e:
        print(f"[Scheduler] Błąd dodawania zadania wysyłki emaili: {e}", file=sys.stderr)

def add_quote_reminder_job(app):
    """
    Dodaje job sprawdzania przypomień o wycenach
    
    Args:
        app: Instancja aplikacji Flask
    """
    try:
        # Pobierz godzinę z konfiguracji
        hour_config = SchedulerConfig.query.filter_by(key='daily_check_hour').first()
        check_hour = int(hour_config.value) if hour_config else 9
        
        # Wrapper funkcji z kontekstem aplikacji
        def quote_reminder_job_wrapper():
            with app.app_context():
                try:
                    print(f"[Scheduler] Uruchamiam sprawdzanie wycen o {check_hour}:00", file=sys.stderr)
                    check_quote_reminders()
                except Exception as e:
                    print(f"[Scheduler] Błąd w zadaniu sprawdzania wycen: {e}", file=sys.stderr)
        
        # Dodanie zadania do schedulera
        scheduler.add_job(
            func=quote_reminder_job_wrapper,
            trigger=CronTrigger(hour=check_hour, minute=0),  # Codziennie o określonej godzinie
            id='quote_reminders_daily',
            name='Sprawdzanie przypomień o wycenach',
            replace_existing=True
        )
        
        print(f"[Scheduler] Dodano zadanie: sprawdzanie wycen codziennie o {check_hour}:00", file=sys.stderr)
        
    except Exception as e:
        print(f"[Scheduler] Błąd dodawania zadania wycen: {e}", file=sys.stderr)


def add_test_job(app):
    """
    Dodaje testowe zadanie uruchamiane co minutę (tylko do debugowania)
    UŻYJ TYLKO DO TESTÓW!
    
    Args:
        app: Instancja aplikacji Flask
    """
    def test_job_wrapper():
        with app.app_context():
            print(f"[Scheduler TEST] Testowe zadanie uruchomione o {datetime.now()}", file=sys.stderr)
    
    scheduler.add_job(
        func=test_job_wrapper,
        trigger=CronTrigger(minute='*'),  # Co minutę
        id='test_job',
        name='Zadanie testowe co minutę',
        replace_existing=True
    )
    
    print("[Scheduler] UWAGA: Dodano zadanie testowe uruchamiane co minutę!", file=sys.stderr)


def remove_job(job_id):
    """
    Usuwa zadanie z schedulera
    
    Args:
        job_id: ID zadania do usunięcia
    """
    try:
        if scheduler and scheduler.running:
            scheduler.remove_job(job_id)
            print(f"[Scheduler] Usunięto zadanie: {job_id}", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[Scheduler] Błąd usuwania zadania {job_id}: {e}", file=sys.stderr)
        return False


def pause_job(job_id):
    """
    Wstrzymuje zadanie
    
    Args:
        job_id: ID zadania do wstrzymania
    """
    try:
        if scheduler and scheduler.running:
            scheduler.pause_job(job_id)
            print(f"[Scheduler] Wstrzymano zadanie: {job_id}", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[Scheduler] Błąd wstrzymywania zadania {job_id}: {e}", file=sys.stderr)
        return False


def resume_job(job_id):
    """
    Wznawia wstrzymane zadanie
    
    Args:
        job_id: ID zadania do wznowienia
    """
    try:
        if scheduler and scheduler.running:
            scheduler.resume_job(job_id)
            print(f"[Scheduler] Wznowiono zadanie: {job_id}", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[Scheduler] Błąd wznawiania zadania {job_id}: {e}", file=sys.stderr)
        return False


def get_scheduler_status():
    """
    Zwraca status schedulera i listę zadań
    
    Returns:
        dict: Informacje o schedulerze
    """
    try:
        if not scheduler:
            return {
                'running': False,
                'jobs': [],
                'error': 'Scheduler nie został zainicjalizowany'
            }
        
        jobs_info = []
        for job in scheduler.get_jobs():
            # Sprawdź czy zadanie jest aktywne (ma następne uruchomienie)
            is_paused = job.next_run_time is None
            
            jobs_info.append({
                'id': job.id,
                'name': job.name,
                'next_run': job.next_run_time.strftime('%Y-%m-%d %H:%M:%S') if job.next_run_time else 'Wstrzymane',
                'trigger': format_trigger_for_display(str(job.trigger)),  # <-- UŻYWAJ NOWEJ FUNKCJI
                'func_name': job.func.__name__ if hasattr(job.func, '__name__') else 'Nieznana',
                'is_paused': is_paused  # <-- DODAJ STATUS PAUZY
            })
        
        return {
            'running': scheduler.running,
            'jobs': jobs_info,
            'timezone': str(scheduler.timezone)
        }
        
    except Exception as e:
        print(f"[Scheduler] Błąd pobierania statusu: {e}", file=sys.stderr)
        return {
            'running': False,
            'jobs': [],
            'error': str(e)
        }


def trigger_job_manually(job_id):
    """
    Uruchamia zadanie ręcznie (niezależnie od harmonogramu)
    
    Args:
        job_id: ID zadania do uruchomienia
        
    Returns:
        bool: True jeśli uruchomiono pomyślnie
    """
    try:
        if scheduler and scheduler.running:
            job = scheduler.get_job(job_id)
            if job:
                # Uruchom zadanie w tle
                scheduler.modify_job(job_id, next_run_time=datetime.now())
                print(f"[Scheduler] Ręcznie uruchomiono zadanie: {job_id}", file=sys.stderr)
                return True
            else:
                print(f"[Scheduler] Nie znaleziono zadania: {job_id}", file=sys.stderr)
                return False
        return False
    except Exception as e:
        print(f"[Scheduler] Błąd ręcznego uruchomienia {job_id}: {e}", file=sys.stderr)
        return False


def log_scheduled_jobs():
    """
    Wylogowuje informacje o wszystkich zaplanowanych zadaniach
    """
    try:
        if scheduler:
            jobs = scheduler.get_jobs()
            print(f"[Scheduler] Zaplanowane zadania ({len(jobs)}):", file=sys.stderr)
            for job in jobs:
                next_run = job.next_run_time.strftime('%Y-%m-%d %H:%M:%S') if job.next_run_time else 'Brak'
                print(f"  - {job.id}: {job.name} | Następne: {next_run}", file=sys.stderr)
        else:
            print("[Scheduler] Brak aktywnego schedulera", file=sys.stderr)
    except Exception as e:
        print(f"[Scheduler] Błąd logowania zadań: {e}", file=sys.stderr)


def shutdown_scheduler():
    """
    Bezpieczne zamknięcie schedulera
    """
    global scheduler
    try:
        print("[Scheduler] WYWOŁANO shutdown_scheduler()", file=sys.stderr)
        
        # Import do stack trace
        import traceback
        print("[Scheduler] Stack trace wywołania shutdown:", file=sys.stderr)
        traceback.print_stack(file=sys.stderr)
        
        if scheduler and scheduler.running:
            print("[Scheduler] Zamykanie schedulera...", file=sys.stderr)
            scheduler.shutdown(wait=True)
            print("[Scheduler] Scheduler zamknięty pomyślnie", file=sys.stderr)
        else:
            print("[Scheduler] Scheduler nie był uruchomiony lub już zamknięty", file=sys.stderr)
    except Exception as e:
        print(f"[Scheduler] Błąd zamykania schedulera: {e}", file=sys.stderr)


def update_job_schedule(job_id, new_hour=None, new_minute=None):
    """
    Aktualizuje harmonogram istniejącego zadania
    """
    try:
        if scheduler and scheduler.running:
            job = scheduler.get_job(job_id)
            if job:
                if job_id == 'quote_check_daily':
                    # Aktualizuj sprawdzanie wycen
                    hour = new_hour if new_hour is not None else job.trigger.fields[2].expressions[0].value
                    minute = new_minute if new_minute is not None else job.trigger.fields[1].expressions[0].value
                    
                    new_trigger = CronTrigger(hour=hour, minute=minute)
                    scheduler.modify_job(job_id, trigger=new_trigger)
                    
                    # RÓWNIEŻ zaktualizuj wysyłkę emaili (1h później)
                    email_job = scheduler.get_job('email_send_daily')
                    if email_job:
                        # Pobierz opóźnienie z konfiguracji
                        delay_config = SchedulerConfig.query.filter_by(key='email_send_delay').first()
                        delay_hours = int(delay_config.value) if delay_config else 1
                        
                        send_hour = (hour + delay_hours) % 24
                        email_trigger = CronTrigger(hour=send_hour, minute=minute)
                        scheduler.modify_job('email_send_daily', trigger=email_trigger)
                        
                        print(f"[Scheduler] Zaktualizowano harmonogram sprawdzania: {hour:02d}:{minute:02d}", file=sys.stderr)
                        print(f"[Scheduler] Zaktualizowano harmonogram wysyłki: {send_hour:02d}:{minute:02d}", file=sys.stderr)
                    
                elif job_id == 'email_send_daily':
                    # Bezpośrednia aktualizacja wysyłki
                    hour = new_hour if new_hour is not None else job.trigger.fields[2].expressions[0].value
                    minute = new_minute if new_minute is not None else job.trigger.fields[1].expressions[0].value
                    
                    new_trigger = CronTrigger(hour=hour, minute=minute)
                    scheduler.modify_job(job_id, trigger=new_trigger)
                    
                    print(f"[Scheduler] Zaktualizowano harmonogram {job_id}: {hour:02d}:{minute:02d}", file=sys.stderr)
                
                return True
            else:
                print(f"[Scheduler] Nie znaleziono zadania: {job_id}", file=sys.stderr)
                return False
    except Exception as e:
        print(f"[Scheduler] Błąd aktualizacji harmonogramu {job_id}: {e}", file=sys.stderr)
        return False

def format_trigger_for_display(trigger_str):
    """
    Konwertuje techniczny opis trigger na user-friendly format
    """
    try:
        # USUŃ debugLog - nie jest dostępne w tym pliku
        print(f"[Format Trigger] Formatowanie triggera: {trigger_str}", file=sys.stderr)
        
        # Obsługa cron triggers
        if 'cron[' in trigger_str:
            import re
            
            # Znajdź parametry
            hour_match = re.search(r"hour='(\d+)'", trigger_str)
            minute_match = re.search(r"minute='(\d+)'", trigger_str)
            day_match = re.search(r"day='(\d+)'", trigger_str)
            day_of_week_match = re.search(r"day_of_week='(\w+)'", trigger_str)
            
            hour = int(hour_match.group(1)) if hour_match else None
            minute = int(minute_match.group(1)) if minute_match else None
            day = int(day_match.group(1)) if day_match else None
            day_of_week = day_of_week_match.group(1) if day_of_week_match else None
            
            # SPECJALNE PRZYPADKI DLA NASZYCH ZADAŃ
            if minute == 0 and hour is not None:
                # Codziennie o określonej godzinie
                return f"⏰ Codziennie o {hour:02d}:00"
            elif minute == 0 and hour is None:
                # Co godzinę
                return f"🔄 Co godzinę (o pełnej godzinie)"
            elif hour is not None and minute is not None:
                # Konkretna godzina i minuta
                if day_of_week:
                    days_pl = {
                        'mon': 'poniedziałki', 'tue': 'wtorki', 'wed': 'środy',
                        'thu': 'czwartki', 'fri': 'piątki', 'sat': 'soboty', 'sun': 'niedziele'
                    }
                    day_name = days_pl.get(day_of_week.lower(), day_of_week)
                    return f"📅 Cotygodniowo ({day_name}) o {hour:02d}:{minute:02d}"
                elif day:
                    return f"📅 Miesięcznie ({day}. dzień) o {hour:02d}:{minute:02d}"
                else:
                    return f"⏰ Codziennie o {hour:02d}:{minute:02d}"
        
        # Obsługa interval triggers
        elif 'interval[' in trigger_str:
            import re
            
            seconds_match = re.search(r"seconds=(\d+)", trigger_str)
            minutes_match = re.search(r"minutes=(\d+)", trigger_str)
            hours_match = re.search(r"hours=(\d+)", trigger_str)
            days_match = re.search(r"days=(\d+)", trigger_str)
            
            if days_match:
                days = int(days_match.group(1))
                return f"🔄 Co {days} {'dzień' if days == 1 else 'dni'}"
            elif hours_match:
                hours = int(hours_match.group(1))
                return f"🔄 Co {hours} {'godzinę' if hours == 1 else 'godziny' if hours < 5 else 'godzin'}"
            elif minutes_match:
                minutes = int(minutes_match.group(1))
                return f"🔄 Co {minutes} {'minutę' if minutes == 1 else 'minuty' if minutes < 5 else 'minut'}"
            elif seconds_match:
                seconds = int(seconds_match.group(1))
                return f"🔄 Co {seconds} {'sekundę' if seconds == 1 else 'sekundy' if seconds < 5 else 'sekund'}"
        
        # Obsługa date triggers (jednorazowe)
        elif 'date[' in trigger_str:
            return "📅 Jednorazowo"
        
        # Fallback - zwróć oryginalny string jeśli nie rozpoznano
        return trigger_str
        
    except Exception as e:
        print(f"[Format Trigger] Błąd formatowania '{trigger_str}': {e}", file=sys.stderr)
        return trigger_str

# Import datetime na końcu żeby uniknąć circular imports
from datetime import datetime