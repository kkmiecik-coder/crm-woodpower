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
    
    Args:
        app: Instancja aplikacji Flask
    """
    global scheduler
    
    try:
        print("[Scheduler] Inicjalizacja APScheduler...", file=sys.stderr)
        
        # Konfiguracja executorów i jobstore
        executors = {
            'default': ThreadPoolExecutor(max_workers=3)
        }
        
        job_defaults = {
            'coalesce': True,          # Łączenie zaległych zadań
            'max_instances': 1,        # Jedna instancja zadania na raz
            'misfire_grace_time': 300  # 5 minut na uruchomienie spóźnionego zadania
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
            
            # Dodaj job sprawdzania wycen
            add_quote_reminder_job(app)
            
            # Dodaj inne joby tutaj w przyszłości
            # add_weekly_report_job(app)
            # add_cleanup_job(app)
        
        # Uruchomienie schedulera
        scheduler.start()
        print("[Scheduler] APScheduler uruchomiony pomyślnie", file=sys.stderr)
        
        # Rejestracja zamknięcia schedulera przy wyjściu z aplikacji
        atexit.register(lambda: shutdown_scheduler())
        
        # Wyloguj informacje o zaplanowanych zadaniach
        log_scheduled_jobs()
        
    except Exception as e:
        print(f"[Scheduler] BŁĄD inicjalizacji: {e}", file=sys.stderr)
        if scheduler:
            scheduler.shutdown()


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
        if scheduler and scheduler.running:
            print("[Scheduler] Zamykanie schedulera...", file=sys.stderr)
            scheduler.shutdown(wait=True)
            print("[Scheduler] Scheduler zamknięty pomyślnie", file=sys.stderr)
    except Exception as e:
        print(f"[Scheduler] Błąd zamykania schedulera: {e}", file=sys.stderr)


def update_job_schedule(job_id, new_hour=None, new_minute=None):
    """
    Aktualizuje harmonogram istniejącego zadania
    
    Args:
        job_id: ID zadania
        new_hour: Nowa godzina (0-23)
        new_minute: Nowa minuta (0-59)
    """
    try:
        if scheduler and scheduler.running:
            job = scheduler.get_job(job_id)
            if job:
                # Utwórz nowy trigger
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
    
    Args:
        trigger_str: String z opisem triggera np. "cron[hour='9', minute='0']"
        
    Returns:
        str: Przyjazny opis np. "Codziennie o 9:00"
    """
    try:
        # Obsługa cron triggers
        if 'cron[' in trigger_str:
            # Wyciągnij parametry z stringa
            import re
            
            # Znajdź hour i minute
            hour_match = re.search(r"hour='(\d+)'", trigger_str)
            minute_match = re.search(r"minute='(\d+)'", trigger_str)
            day_match = re.search(r"day='(\d+)'", trigger_str)
            day_of_week_match = re.search(r"day_of_week='(\w+)'", trigger_str)
            
            hour = int(hour_match.group(1)) if hour_match else None
            minute = int(minute_match.group(1)) if minute_match else 0
            day = int(day_match.group(1)) if day_match else None
            day_of_week = day_of_week_match.group(1) if day_of_week_match else None
            
            # Formatuj godzinę
            if hour is not None:
                time_str = f"{hour:02d}:{minute:02d}"
                
                # Różne rodzaje harmonogramów
                if day_of_week:
                    # Cotygodniowo w określony dzień
                    days_pl = {
                        'mon': 'poniedziałki', 'tue': 'wtorki', 'wed': 'środy',
                        'thu': 'czwartki', 'fri': 'piątki', 'sat': 'soboty', 'sun': 'niedziele'
                    }
                    day_name = days_pl.get(day_of_week.lower(), day_of_week)
                    return f"📅 Cotygodniowo ({day_name}) o {time_str}"
                    
                elif day:
                    # Miesięcznie w określony dzień
                    return f"📅 Miesięcznie ({day}. dzień miesiąca) o {time_str}"
                    
                else:
                    # Codziennie
                    return f"⏰ Codziennie o {time_str}"
        
        # Obsługa interval triggers
        elif 'interval[' in trigger_str:
            # Wyciągnij parametry interwału
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