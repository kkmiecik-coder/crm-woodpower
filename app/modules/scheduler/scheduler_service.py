from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.executors.pool import ThreadPoolExecutor
import atexit
import sys
import os
from flask import current_app
from modules.scheduler.jobs.quote_reminders import check_quote_reminders
from modules.scheduler.models import SchedulerConfig, create_default_scheduler_config
from modules.scheduler.models import save_job_state, get_all_job_states, update_job_last_run
from extensions import db

# Globalny scheduler
scheduler = None


# ZNAJDŹ funkcję init_scheduler w scheduler_service.py i ZAMIEŃ całą funkcję na tę:

def init_scheduler(app):
    """
    Inicjalizuje i uruchamia APScheduler z kontekstem aplikacji Flask
    OSTATECZNE ROZWIĄZANIE: File locking zamiast port locking
    """
    global scheduler
    
    import fcntl
    import tempfile
    
    # NOWE: File lock zamiast socket lock
    lock_file_path = os.path.join(tempfile.gettempdir(), 'woodpower_scheduler.lock')
    
    try:
        # Otwórz/utwórz plik lock
        lock_file = open(lock_file_path, 'w')
        
        # Próba zablokowania pliku (non-blocking)
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        
        # Zapisz PID do pliku
        lock_file.write(f"{os.getpid()}\n")
        lock_file.flush()
        
        print(f"[Scheduler] PID {os.getpid()} zablokował plik {lock_file_path} - jestem głównym schedulerem", file=sys.stderr)
        
    except (OSError, IOError) as e:
        print(f"[Scheduler] PID {os.getpid()} - nie można zablokować {lock_file_path}, inny scheduler już działa - pomijam inicjalizację", file=sys.stderr)
        try:
            lock_file.close()
        except:
            pass
        return
    
    # NOWE: Sprawdź czy scheduler już istnieje w tym procesie
    if scheduler is not None:
        if scheduler.running:
            print(f"[Scheduler] PID {os.getpid()} - scheduler już działa w tym procesie", file=sys.stderr)
            return
        else:
            print(f"[Scheduler] PID {os.getpid()} - scheduler istnieje ale nie działa, restartowanie...", file=sys.stderr)
    
    try:
        print(f"[Scheduler] PID {os.getpid()} - inicjalizacja APScheduler...", file=sys.stderr)
        
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
            print(f"[Scheduler] PID {os.getpid()} - domyślne konfiguracje utworzone", file=sys.stderr)
            
            # NOWE: Inicjalizuj tabelę stanów zadań
            from modules.scheduler.models import initialize_default_job_states
            db.create_all()  # Upewnij się że tabele istnieją
            initialize_default_job_states()
            
            # ZADANIE 1: Sprawdzanie wycen (codziennie)
            add_quote_check_job(app)
            
            # ZADANIE 2: Wysyłka emaili (co godzinę)
            add_email_send_job(app)

            # ZADANIE 3: Przenumerowanie kolejki produkcyjnej (codziennie o 00:01)
            add_production_queue_job(app)
            
            # NOWE: Przywróć stany zadań z bazy danych
            restore_job_states_from_db()
        
        # Uruchomienie schedulera z obsługą błędów
        try:
            scheduler.start()
            print(f"[Scheduler] PID {os.getpid()} - APScheduler uruchomiony pomyślnie ✅", file=sys.stderr)
        except Exception as start_error:
            print(f"[Scheduler] PID {os.getpid()} - błąd uruchamiania schedulera: {start_error}", file=sys.stderr)
            # Zwolnij lock jeśli scheduler się nie uruchomił
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                lock_file.close()
                os.remove(lock_file_path)
            except:
                pass
            raise
        
        # Wyloguj informacje o zaplanowanych zadaniach
        log_scheduled_jobs()
        
        # Zarejestruj funkcję zamykającą scheduler przy zamknięciu aplikacji
        def cleanup_scheduler():
            if scheduler and scheduler.running:
                print(f"[Scheduler] PID {os.getpid()} - zamykanie schedulera przy zamknięciu aplikacji", file=sys.stderr)
                scheduler.shutdown(wait=False)
            # Zwolnij lock
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                lock_file.close()
                os.remove(lock_file_path)
                print(f"[Scheduler] PID {os.getpid()} - zwolniono lock {lock_file_path}", file=sys.stderr)
            except:
                pass
        
        atexit.register(cleanup_scheduler)
        
        # Zapisz lock file w schedulerze żeby nie został zamknięty przez garbage collector
        scheduler._lock_file = lock_file
        
    except Exception as e:
        print(f"[Scheduler] PID {os.getpid()} - błąd inicjalizacji APScheduler: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        # Zwolnij lock w przypadku błędu
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            lock_file.close()
            os.remove(lock_file_path)
        except:
            pass
        # Nie re-raise błędu - aplikacja powinna działać nawet bez schedulera
        scheduler = None

def add_production_queue_job(app):
    """
    Dodaje job przenumerowania kolejki produkcyjnej
    """
    try:
        # Import datetime na początku
        from datetime import datetime, timedelta
        
        # Stałe ustawienia - codziennie o 00:01
        production_hour = 0
        production_minute = 1
        
        print(f"[Scheduler] Konfiguracja przenumerowania kolejki: {production_hour:02d}:{production_minute:02d}", file=sys.stderr)
        
        # Wrapper funkcji z kontekstem aplikacji
        def production_queue_job_wrapper():
            with app.app_context():
                try:
                    print(f"[SCHEDULER JOB] === URUCHOMIENIE PRZENUMEROWANIA KOLEJKI ===", file=sys.stderr)
                    print(f"[SCHEDULER JOB] Czas uruchomienia: {datetime.now()}", file=sys.stderr)
                    print(f"[SCHEDULER JOB] Zadanie: production_queue_renumber", file=sys.stderr)
                    
                    # Import tutaj żeby uniknąć circular imports
                    from modules.scheduler.jobs.production_queue_renumber import renumber_production_queue_job
                    
                    result = renumber_production_queue_job()
                    
                    if result['success']:
                        print(f"[SCHEDULER JOB] ✅ Kolejka przenumerowana pomyślnie: {result['message']}", file=sys.stderr)
                    else:
                        print(f"[SCHEDULER JOB] ❌ Błąd przenumerowania: {result['error']}", file=sys.stderr)
                    
                    print(f"[SCHEDULER JOB] === ZAKOŃCZENIE PRZENUMEROWANIA KOLEJKI ===", file=sys.stderr)
                    
                    # Aktualizuj last_run w bazie danych
                    from modules.scheduler.models import update_job_last_run
                    update_job_last_run('production_queue_renumber')
                    
                except Exception as e:
                    print(f"[SCHEDULER JOB] BŁĄD w zadaniu przenumerowania kolejki: {e}", file=sys.stderr)
                    import traceback
                    traceback.print_exc(file=sys.stderr)
        
        # Dodanie zadania do schedulera
        scheduler.add_job(
            func=production_queue_job_wrapper,
            trigger=CronTrigger(hour=production_hour, minute=production_minute),
            id='production_queue_renumber',
            name='Przenumerowanie kolejki produkcyjnej',
            replace_existing=True
        )
        
        print(f"[Scheduler] Dodano zadanie: przenumerowanie kolejki codziennie o {production_hour:02d}:{production_minute:02d}", file=sys.stderr)
        
        # Sprawdź czy uruchomić zadanie natychmiast (po uruchomieniu schedulera)
        def check_production_queue_immediate_run():
            """Sprawdza czy uruchomić przenumerowanie kolejki natychmiast"""
            try:
                from threading import Timer
                
                def delayed_production_check():
                    try:
                        with app.app_context():
                            job = scheduler.get_job('production_queue_renumber')
                            if not job:
                                print(f"[Scheduler] ❌ Nie znaleziono zadania production_queue_renumber", file=sys.stderr)
                                return
                            
                            print(f"[Scheduler] Sprawdzam czy uruchomić przenumerowanie kolejki natychmiast...", file=sys.stderr)
                            
                            current_time = datetime.now()
                            today_scheduled_time = current_time.replace(hour=production_hour, minute=production_minute, second=0, microsecond=0)
                            
                            print(f"[Scheduler] Obecny czas: {current_time.strftime('%H:%M:%S')}", file=sys.stderr)
                            print(f"[Scheduler] Zaplanowany czas dzisiaj: {today_scheduled_time.strftime('%H:%M:%S')}", file=sys.stderr)
                            
                            # Sprawdź czy już minęliśmy dzisiejszą godzinę uruchomienia
                            should_run_immediately = current_time > today_scheduled_time
                            
                            if should_run_immediately:
                                print(f"[Scheduler] ⚠️ Minęliśmy dzisiejszą godzinę przenumerowania", file=sys.stderr)
                                
                                # Sprawdź last_run z bazy danych
                                from modules.scheduler.models import get_job_state
                                job_state = get_job_state('production_queue_renumber')
                                
                                already_run_today = False
                                if job_state and job_state['last_run']:
                                    last_run = job_state['last_run']
                                    if last_run.date() == current_time.date():
                                        already_run_today = True
                                        print(f"[Scheduler] ✅ Przenumerowanie już uruchomione dzisiaj o {last_run.strftime('%H:%M:%S')}", file=sys.stderr)
                                    else:
                                        print(f"[Scheduler] ❌ Ostatnie przenumerowanie: {last_run.strftime('%Y-%m-%d %H:%M:%S')} - nie dzisiaj", file=sys.stderr)
                                else:
                                    print(f"[Scheduler] ❌ Brak informacji o ostatnim przenumerowaniu", file=sys.stderr)
                                
                                # Jeśli zadanie się dziś nie uruchomiło, uruchom natychmiast
                                if not already_run_today:
                                    print(f"[Scheduler] 🚀 URUCHAMIAM PRZENUMEROWANIE KOLEJKI NATYCHMIAST", file=sys.stderr)
                                    production_queue_job_wrapper()
                            else:
                                print(f"[Scheduler] ✅ Przenumerowanie zostanie uruchomione o zaplanowanej godzinie", file=sys.stderr)
                                
                    except Exception as e:
                        print(f"[Scheduler] Błąd sprawdzania natychmiastowego przenumerowania: {e}", file=sys.stderr)
                
                # Uruchom sprawdzenie za 15 sekund (po pełnym starcie aplikacji)
                timer = Timer(15.0, delayed_production_check)
                timer.daemon = True
                timer.start()
                
                print(f"[Scheduler] ⏰ Sprawdzenie natychmiastowego przenumerowania za 15 sekund", file=sys.stderr)
                
            except Exception as e:
                print(f"[Scheduler] Błąd ustawienia opóźnionego sprawdzenia przenumerowania: {e}", file=sys.stderr)
        
        # Uruchom sprawdzenie po inicjalizacji
        check_production_queue_immediate_run()
        
    except Exception as e:
        print(f"[Scheduler] Błąd dodawania zadania przenumerowania kolejki: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)

def restore_job_states_from_db():
    """
    Przywraca stany zadań z bazy danych po restarcie aplikacji (nowy model JobState)
    """
    try:
        print("[Scheduler] Przywracanie stanów zadań z bazy danych...", file=sys.stderr)
        
        from modules.scheduler.models import get_all_job_states
        
        # Pobierz wszystkie stany z bazy
        all_states = get_all_job_states()
        
        if not all_states:
            print("[Scheduler] Brak zapisanych stanów w bazie danych", file=sys.stderr)
            return
        
        print(f"[Scheduler] Znaleziono {len(all_states)} stanów zadań w bazie", file=sys.stderr)
        
        for job_id, state_info in all_states.items():
            try:
                job = scheduler.get_job(job_id)
                if not job:
                    print(f"[Scheduler] ⚠️ Zadanie {job_id} nie istnieje w schedulerze", file=sys.stderr)
                    continue
                
                saved_state = state_info['state']
                
                if saved_state == 'paused':
                    print(f"[Scheduler] Przywracanie stanu 'paused' dla zadania {job_id}", file=sys.stderr)
                    scheduler.pause_job(job_id)
                    print(f"[Scheduler] ✅ Zadanie {job_id} zostało wstrzymane", file=sys.stderr)
                
                elif saved_state == 'active':
                    print(f"[Scheduler] Zadanie {job_id} pozostaje aktywne", file=sys.stderr)
                
                else:
                    print(f"[Scheduler] ⚠️ Nieznany stan '{saved_state}' dla zadania {job_id}", file=sys.stderr)
                
            except Exception as job_error:
                print(f"[Scheduler] ❌ Błąd przywracania stanu zadania {job_id}: {job_error}", file=sys.stderr)
                continue
        
        print("[Scheduler] Zakończono przywracanie stanów zadań", file=sys.stderr)
        
    except Exception as e:
        print(f"[Scheduler] Błąd przywracania stanów zadań z bazy: {e}", file=sys.stderr)

def add_quote_check_job(app):
    """
    Dodaje job sprawdzania wycen (tylko sprawdzanie, bez wysyłki)
    """
    try:
        # Import datetime na początku
        from datetime import datetime, timedelta
        
        # Pobierz godzinę i minutę z konfiguracji
        hour_config = SchedulerConfig.query.filter_by(key='daily_check_hour').first()
        minute_config = SchedulerConfig.query.filter_by(key='daily_check_minute').first()
        
        check_hour = int(hour_config.value) if hour_config else 16
        check_minute = int(minute_config.value) if minute_config else 0
        
        print(f"[Scheduler] Konfiguracja sprawdzania wycen: {check_hour:02d}:{check_minute:02d}", file=sys.stderr)
        
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
                    
                    # Aktualizuj last_run w bazie danych
                    from modules.scheduler.models import update_job_last_run
                    update_job_last_run('quote_check_daily')
                    
                except Exception as e:
                    print(f"[SCHEDULER JOB] BŁĄD w zadaniu sprawdzania wycen: {e}", file=sys.stderr)
                    import traceback
                    traceback.print_exc(file=sys.stderr)
        
        # Dodanie zadania do schedulera z godzinami i minutami
        scheduler.add_job(
            func=quote_check_job_wrapper,
            trigger=CronTrigger(hour=check_hour, minute=check_minute),
            id='quote_check_daily',
            name='Sprawdzanie wycen do przypomnienia',
            replace_existing=True
        )
        
        print(f"[Scheduler] Dodano zadanie: sprawdzanie wycen codziennie o {check_hour:02d}:{check_minute:02d}", file=sys.stderr)
        
        # BEZPIECZNE sprawdzenie next_run_time po uruchomieniu schedulera
        def check_and_maybe_run_immediately():
            """Sprawdza czy uruchomić zadanie natychmiast - po uruchomieniu schedulera"""
            try:
                # Poczekaj aż scheduler się w pełni uruchomi
                from threading import Timer
                
                def delayed_check():
                    try:
                        with app.app_context():
                            # Teraz bezpiecznie sprawdź next_run_time
                            job = scheduler.get_job('quote_check_daily')
                            if not job:
                                print(f"[Scheduler] ❌ Nie znaleziono zadania quote_check_daily", file=sys.stderr)
                                return
                            
                            print(f"[Scheduler] Sprawdzam czy uruchomić zadanie natychmiast...", file=sys.stderr)
                            
                            current_time = datetime.now()
                            today_scheduled_time = current_time.replace(hour=check_hour, minute=check_minute, second=0, microsecond=0)
                            
                            print(f"[Scheduler] Obecny czas: {current_time.strftime('%H:%M:%S')}", file=sys.stderr)
                            print(f"[Scheduler] Zaplanowany czas dzisiaj: {today_scheduled_time.strftime('%H:%M:%S')}", file=sys.stderr)
                            
                            if hasattr(job, 'next_run_time') and job.next_run_time:
                                print(f"[Scheduler] Następne uruchomienie: {job.next_run_time.strftime('%Y-%m-%d %H:%M:%S')}", file=sys.stderr)
                            
                            # Sprawdź czy już minęliśmy dzisiejszą godzinę uruchomienia
                            should_run_immediately = current_time > today_scheduled_time
                            
                            if should_run_immediately:
                                print(f"[Scheduler] ⚠️ Minęliśmy dzisiejszą godzinę uruchomienia", file=sys.stderr)
                                
                                # Sprawdź last_run z bazy danych
                                from modules.scheduler.models import get_job_state
                                job_state = get_job_state('quote_check_daily')
                                
                                already_run_today = False
                                if job_state and job_state['last_run']:
                                    last_run = job_state['last_run']
                                    if last_run.date() == current_time.date():
                                        already_run_today = True
                                        print(f"[Scheduler] ✅ Zadanie już uruchomione dzisiaj o {last_run.strftime('%H:%M:%S')}", file=sys.stderr)
                                    else:
                                        print(f"[Scheduler] ❌ Ostatnie uruchomienie: {last_run.strftime('%Y-%m-%d %H:%M:%S')} - nie dzisiaj", file=sys.stderr)
                                else:
                                    print(f"[Scheduler] ❌ Brak informacji o ostatnim uruchomieniu", file=sys.stderr)
                                
                                # Jeśli zadanie się dziś nie uruchomiło, uruchom natychmiast
                                if not already_run_today:
                                    print(f"[Scheduler] 🚀 URUCHAMIAM ZADANIE NATYCHMIAST", file=sys.stderr)
                                    quote_check_job_wrapper()
                            else:
                                print(f"[Scheduler] ✅ Zadanie zostanie uruchomione o zaplanowanej godzinie", file=sys.stderr)
                                
                    except Exception as e:
                        print(f"[Scheduler] Błąd sprawdzania natychmiastowego uruchomienia: {e}", file=sys.stderr)
                
                # Uruchom sprawdzenie za 10 sekund (po pełnym starcie aplikacji)
                timer = Timer(10.0, delayed_check)
                timer.daemon = True
                timer.start()
                
                print(f"[Scheduler] ⏰ Sprawdzenie natychmiastowego uruchomienia za 10 sekund", file=sys.stderr)
                
            except Exception as e:
                print(f"[Scheduler] Błąd ustawienia opóźnionego sprawdzenia: {e}", file=sys.stderr)
        
        # Uruchom sprawdzenie po inicjalizacji
        check_and_maybe_run_immediately()
        
    except Exception as e:
        print(f"[Scheduler] Błąd dodawania zadania sprawdzania wycen: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)

def add_email_send_job(app):
    """
    Dodaje job wysyłki zaplanowanych emaili (z opóźnieniem po sprawdzaniu)
    """
    try:
        # Pobierz godzinę, minutę sprawdzania i opóźnienie
        hour_config = SchedulerConfig.query.filter_by(key='daily_check_hour').first()
        minute_config = SchedulerConfig.query.filter_by(key='daily_check_minute').first()
        delay_config = SchedulerConfig.query.filter_by(key='email_send_delay').first()
        
        check_hour = int(hour_config.value) if hour_config else 16
        check_minute = int(minute_config.value) if minute_config else 0
        delay_hours = int(delay_config.value) if delay_config else 1
        
        # Oblicz czas wysyłki (dodaj opóźnienie do czasu sprawdzania)
        import datetime as dt
        check_time = dt.time(check_hour, check_minute)
        check_datetime = dt.datetime.combine(dt.date.today(), check_time)
        send_datetime = check_datetime + dt.timedelta(hours=delay_hours)
        
        send_hour = send_datetime.hour
        send_minute = send_datetime.minute
        
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
        
        # Dodanie zadania do schedulera z godzinami i minutami
        scheduler.add_job(
            func=email_send_job_wrapper,
            trigger=CronTrigger(hour=send_hour, minute=send_minute),
            id='email_send_daily',
            name='Wysyłka zaplanowanych emaili',
            replace_existing=True
        )
        
        print(f"[Scheduler] Dodano zadanie: wysyłka emaili codziennie o {send_hour:02d}:{send_minute:02d} (sprawdzanie {check_hour:02d}:{check_minute:02d} + {delay_hours}h)", file=sys.stderr)
        
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
    Wstrzymuje zadanie i zapisuje stan do bazy danych (nowy model JobState)
    
    Args:
        job_id: ID zadania do wstrzymania
    """
    try:
        if scheduler and scheduler.running:
            scheduler.pause_job(job_id)
            
            # NOWE: Zapisz stan do nowego modelu JobState
            from modules.scheduler.models import save_job_state
            save_job_state(job_id, 'paused')
            
            print(f"[Scheduler] Wstrzymano zadanie: {job_id}", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[Scheduler] Błąd wstrzymywania zadania {job_id}: {e}", file=sys.stderr)
        return False


def resume_job(job_id):
    """
    Wznawia wstrzymane zadanie i zapisuje stan do bazy danych (nowy model JobState)
    
    Args:
        job_id: ID zadania do wznowienia
    """
    try:
        if scheduler and scheduler.running:
            scheduler.resume_job(job_id)
            
            # NOWE: Zapisz stan do nowego modelu JobState
            from modules.scheduler.models import save_job_state
            
            # Pobierz następne uruchomienie z schedulera
            job = scheduler.get_job(job_id)
            next_run = job.next_run_time if job else None
            
            save_job_state(job_id, 'active', next_run)
            
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
                'trigger': format_trigger_for_display(str(job.trigger)),
                'func_name': job.func.__name__ if hasattr(job.func, '__name__') else 'Nieznana',
                'is_paused': is_paused
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
    Uruchamia zadanie ręcznie (niezależnie od harmonogramu) i aktualizuje last_run
    
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
                
                # NOWE: Aktualizuj last_run w bazie
                from modules.scheduler.models import update_job_last_run
                update_job_last_run(job_id)
                
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
                is_paused = job.next_run_time is None
                status = 'WSTRZYMANE' if is_paused else 'AKTYWNE'
                print(f"  - {job.id}: {job.name} | Następne: {next_run} | Status: {status}", file=sys.stderr)
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
    Aktualizuje harmonogram istniejącego zadania z obsługą godzin i minut
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
                    
                    # RÓWNIEŻ zaktualizuj wysyłkę emaili (z opóźnieniem)
                    email_job = scheduler.get_job('email_send_daily')
                    if email_job:
                        # Pobierz opóźnienie z konfiguracji
                        delay_config = SchedulerConfig.query.filter_by(key='email_send_delay').first()
                        delay_hours = int(delay_config.value) if delay_config else 1
                        
                        # Oblicz czas wysyłki z opóźnieniem
                        import datetime as dt
                        check_time = dt.time(hour, minute)
                        check_datetime = dt.datetime.combine(dt.date.today(), check_time)
                        send_datetime = check_datetime + dt.timedelta(hours=delay_hours)
                        
                        send_hour = send_datetime.hour
                        send_minute = send_datetime.minute
                        
                        email_trigger = CronTrigger(hour=send_hour, minute=send_minute)
                        scheduler.modify_job('email_send_daily', trigger=email_trigger)
                        
                        print(f"[Scheduler] Zaktualizowano harmonogram sprawdzania: {hour:02d}:{minute:02d}", file=sys.stderr)
                        print(f"[Scheduler] Zaktualizowano harmonogram wysyłki: {send_hour:02d}:{send_minute:02d}", file=sys.stderr)
                    
                    return True  # DODANO
                    
                elif job_id == 'email_send_daily':
                    # Bezpośrednia aktualizacja wysyłki
                    hour = new_hour if new_hour is not None else job.trigger.fields[2].expressions[0].value
                    minute = new_minute if new_minute is not None else job.trigger.fields[1].expressions[0].value
                    
                    new_trigger = CronTrigger(hour=hour, minute=minute)
                    scheduler.modify_job(job_id, trigger=new_trigger)
                    
                    print(f"[Scheduler] Zaktualizowano harmonogram {job_id}: {hour:02d}:{minute:02d}", file=sys.stderr)
                    
                    return True  # DODANO
                
                elif job_id == 'production_queue_renumber':
                    # Aktualizacja przenumerowania kolejki produkcyjnej
                    hour = new_hour if new_hour is not None else 0  # Domyślnie 00:01
                    minute = new_minute if new_minute is not None else 1
                    
                    new_trigger = CronTrigger(hour=hour, minute=minute)
                    scheduler.modify_job(job_id, trigger=new_trigger)
                    
                    print(f"[Scheduler] Zaktualizowano harmonogram przenumerowania kolejki: {hour:02d}:{minute:02d}", file=sys.stderr)
                    
                    return True
                
                else:
                    # DODANO - obsługa innych zadań
                    print(f"[Scheduler] Nieobsługiwane zadanie do aktualizacji: {job_id}", file=sys.stderr)
                    return False

            else:
                print(f"[Scheduler] Nie znaleziono zadania: {job_id}", file=sys.stderr)
                return False
        else:
            print(f"[Scheduler] Scheduler nie działa", file=sys.stderr)
            return False
    except Exception as e:
        print(f"[Scheduler] Błąd aktualizacji harmonogramu {job_id}: {e}", file=sys.stderr)
        return False
    

def format_trigger_for_display(trigger_str):
    """
    Konwertuje techniczny opis trigger na user-friendly format
    """
    try:
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