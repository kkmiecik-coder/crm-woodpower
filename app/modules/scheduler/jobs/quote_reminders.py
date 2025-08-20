from datetime import datetime, timedelta
from flask import current_app, render_template
from flask_mail import Message
from extensions import db, mail
from modules.scheduler.models import EmailSchedule, EmailLog, SchedulerConfig
import sys

def check_quote_reminders():
    """
    Sprawdza wyceny wymagające przypomnienia i oznacza je do wysyłki.
    NIE wysyła emaili - tylko przygotowuje harmonogram.
    Wywoływana codziennie przez scheduler.
    """
    try:
        print("[Quote Check] === ROZPOCZĘCIE SPRAWDZANIA WYCEN ===", file=sys.stderr)
        
        # Sprawdź czy funkcja jest włączona
        config = SchedulerConfig.query.filter_by(key='quote_reminder_enabled').first()
        if not config or config.value.lower() != 'true':
            print("[Quote Check] Przypomnienia są wyłączone w konfiguracji", file=sys.stderr)
            return
        
        # Pobierz konfigurację dni
        min_days_config = SchedulerConfig.query.filter_by(key='quote_reminder_days').first()
        min_days = int(min_days_config.value) if min_days_config else 7
        
        max_days_config = SchedulerConfig.query.filter_by(key='quote_reminder_max_days').first()
        max_days = int(max_days_config.value) if max_days_config else 30
        
        # Oblicz daty
        current_date = datetime.now()
        min_date = current_date - timedelta(days=min_days)   # 7 dni temu
        max_date = current_date - timedelta(days=max_days)   # 30 dni temu
        
        print(f"[Quote Check] Szukam wycen z okresu: {max_date.strftime('%Y-%m-%d')} do {min_date.strftime('%Y-%m-%d')}", file=sys.stderr)
        print(f"[Quote Check] Wyceny starsze niż {min_days} dni, ale nie starsze niż {max_days} dni", file=sys.stderr)
        
        # Import modelu Quote
        from modules.quotes.models import Quote
        
        # Znajdź wyceny do sprawdzenia
        quotes_to_check = db.session.query(Quote).filter(
            Quote.status_id == 1,  # Status "Nowa wycena"
            Quote.created_at >= max_date,  # Nie starsze niż 30 dni
            Quote.created_at <= min_date,  # Starsze niż 7 dni
        ).all()
        
        print(f"[Quote Check] Znaleziono {len(quotes_to_check)} wycen do sprawdzenia", file=sys.stderr)
        
        scheduled_count = 0
        skipped_count = 0
        error_count = 0
        
        for quote in quotes_to_check:
            try:
                print(f"[Quote Check] Sprawdzam wycenę {quote.quote_number} (ID: {quote.id})", file=sys.stderr)
                
                # Sprawdź czy już nie zaplanowano przypomnienia dla tej wyceny
                existing_schedule = EmailSchedule.query.filter_by(
                    quote_id=quote.id,
                    email_type='quote_reminder_7_days'
                ).first()
                
                if existing_schedule:
                    print(f"[Quote Check] Wycena {quote.quote_number} - przypomnienie już zaplanowane (status: {existing_schedule.status})", file=sys.stderr)
                    skipped_count += 1
                    continue
                
                # Sprawdź czy klient ma email
                if not quote.client or not quote.client.email:
                    print(f"[Quote Check] Wycena {quote.quote_number} - brak klienta lub emaila", file=sys.stderr)
                    # Zaloguj błąd ale nie przerwij procesu
                    log_email_error(quote.id, 'quote_reminder_7_days', '', 'Brak klienta lub emaila klienta')
                    error_count += 1
                    continue
                
                # NOWE: Utwórz wpis w harmonogramie z opóźnieniem 1h
                schedule_date = datetime.now() + timedelta(hours=1)
                
                new_schedule = EmailSchedule(
                    quote_id=quote.id,
                    email_type='quote_reminder_7_days',
                    recipient_email=quote.client.email,
                    scheduled_date=schedule_date,
                    status='pending',
                    attempts=0
                )
                
                db.session.add(new_schedule)
                scheduled_count += 1
                
                print(f"[Quote Check] ✅ Zaplanowano przypomnienie dla wyceny {quote.quote_number} na {schedule_date.strftime('%Y-%m-%d %H:%M')}", file=sys.stderr)
                
            except Exception as e:
                print(f"[Quote Check] ❌ Błąd przetwarzania wyceny {quote.id}: {e}", file=sys.stderr)
                error_count += 1
                continue
        
        # Zapisz wszystkie zmiany
        db.session.commit()
        
        print(f"[Quote Check] === ZAKOŃCZENIE SPRAWDZANIA ===", file=sys.stderr)
        print(f"[Quote Check] Zaplanowano: {scheduled_count}, Pominięto: {skipped_count}, Błędów: {error_count}", file=sys.stderr)
        
    except Exception as e:
        print(f"[Quote Check] KRYTYCZNY BŁĄD w sprawdzaniu wycen: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)

def send_quote_reminder_email(quote):
    """
    Wysyła email z przypomnieniem o wycenie do klienta
    
    Args:
        quote: Obiekt wyceny (Quote model)
        
    Returns:
        bool: True jeśli wysłano pomyślnie, False w przypadku błędu
    """
    step = "INIT"
    error_details = {}
    
    try:
        step = "VALIDATION_QUOTE"
        print(f"[Email] === ROZPOCZĘCIE WYSYŁKI PRZYPOMNIENIA ===", file=sys.stderr)
        print(f"[Email] Wycena ID: {quote.id}, Numer: {quote.quote_number}", file=sys.stderr)
        
        # Sprawdź czy wycena ma klienta
        if not quote.client:
            error_details = {
                'step': step,
                'issue': 'Wycena nie ma przypisanego klienta',
                'quote_id': quote.id,
                'quote_number': quote.quote_number
            }
            print(f"[Email] BŁĄD: {error_details}", file=sys.stderr)
            return False
        
        step = "VALIDATION_EMAIL"
        client_email = quote.client.email
    
        # Sprawdź jakie atrybuty ma model Client
        client_attrs = [attr for attr in dir(quote.client) if not attr.startswith('_')]
        print(f"[Email] Dostępne atrybuty Client: {client_attrs}", file=sys.stderr)
    
        # Użyj odpowiednich atrybutów (prawdopodobnie 'name' zamiast 'first_name', 'last_name')
        if hasattr(quote.client, 'name'):
            client_name = quote.client.name
        elif hasattr(quote.client, 'first_name') and hasattr(quote.client, 'last_name'):
            client_name = f"{quote.client.first_name} {quote.client.last_name}"
        elif hasattr(quote.client, 'company_name'):
            client_name = quote.client.company_name
        else:
            client_name = f"Klient ID: {quote.client.id}"
    
        print(f"[Email] Klient: {client_name}", file=sys.stderr)
        print(f"[Email] Email klienta: {client_email}", file=sys.stderr)
        
        if not client_email:
            # Użyj bezpiecznej nazwy klienta
            safe_client_name = getattr(quote.client, 'name', 
                                     getattr(quote.client, 'company_name', 
                                           f"Klient ID: {quote.client.id}"))
            
            error_details = {
                'step': step,
                'issue': 'Klient nie ma adresu email',
                'client_id': quote.client.id,
                'client_name': safe_client_name
            }
            print(f"[Email] BŁĄD: {error_details}", file=sys.stderr)
            return False
        
        # Walidacja formatu email
        import re
        email_pattern = r'^[^\s@]+@[^\s@]+\.[^\s@]+$'
        if not re.match(email_pattern, client_email):
            error_details = {
                'step': step,
                'issue': 'Nieprawidłowy format adresu email',
                'email': client_email
            }
            print(f"[Email] BŁĄD: {error_details}", file=sys.stderr)
            return False
        
        step = "DATABASE_SCHEDULE"
        print(f"[Email] Sprawdzam/tworzę wpis w harmonogramie...", file=sys.stderr)
        
        # Utwórz lub znajdź wpis w harmonogramie
        schedule_entry = EmailSchedule.query.filter_by(
            quote_id=quote.id,
            email_type='quote_reminder_7_days'
        ).first()
        
        if not schedule_entry:
            print(f"[Email] Tworzę nowy wpis w harmonogramie", file=sys.stderr)
            schedule_entry = EmailSchedule(
                quote_id=quote.id,
                email_type='quote_reminder_7_days',
                recipient_email=client_email,
                scheduled_date=datetime.now(),
                status='pending'
            )
            db.session.add(schedule_entry)
            db.session.flush()  # Żeby dostać ID
        else:
            print(f"[Email] Znaleziono istniejący wpis w harmonogramie (ID: {schedule_entry.id})", file=sys.stderr)
        
        # Zwiększ licznik prób
        schedule_entry.attempts += 1
        print(f"[Email] Próba nr: {schedule_entry.attempts}", file=sys.stderr)
        
        step = "URL_GENERATION"
        # Wygeneruj URL wyceny
        if not quote.public_token:
            error_details = {
                'step': step,
                'issue': 'Wycena nie ma public_token',
                'quote_id': quote.id,
                'quote_number': quote.quote_number
            }
            print(f"[Email] BŁĄD: {error_details}", file=sys.stderr)
            return False
        
        quote_url = f"https://crm.woodpower.pl/quotes/c/{quote.public_token}"
        print(f"[Email] URL wyceny: {quote_url}", file=sys.stderr)
        
        step = "TEMPLATE_RENDERING"
        print(f"[Email] Renderuję szablon email...", file=sys.stderr)
        
        # Lista szablonów do sprawdzenia
        template_paths = [
            'quote_reminder_email.html',
            'scheduler/quote_reminder_email.html',
            '../quote_reminder_email.html'
        ]
        
        html_body = None
        used_template = None
        
        for template_path in template_paths:
            try:
                print(f"[Email] Próbuję szablon: {template_path}", file=sys.stderr)
                
                # Sprawdź czy wszystkie dane są dostępne
                template_data = {
                    'quote': quote,
                    'client': quote.client,
                    'quote_url': quote_url,
                    'days_passed': 7
                }
                
                print(f"[Email] Dane dla szablonu: quote_id={quote.id}, client_id={quote.client.id}, quote_url_length={len(quote_url)}", file=sys.stderr)
                
                html_body = render_template(template_path, **template_data)
                used_template = template_path
                print(f"[Email] ✅ SUKCES: Wyrenderowano szablon {template_path}", file=sys.stderr)
                print(f"[Email] Długość HTML: {len(html_body)} znaków", file=sys.stderr)
                break
                
            except Exception as template_error:
                print(f"[Email] ❌ Błąd szablonu {template_path}: {type(template_error).__name__}: {template_error}", file=sys.stderr)
                continue
        
        if not html_body:
            error_details = {
                'step': step,
                'issue': 'Nie udało się wyrenderować żadnego szablonu',
                'tried_templates': template_paths,
                'quote_id': quote.id
            }
            print(f"[Email] KRYTYCZNY BŁĄD: {error_details}", file=sys.stderr)
            return False
        
        step = "EMAIL_PREPARATION"
        print(f"[Email] Przygotowuję wiadomość email...", file=sys.stderr)
        
        # Sprawdź konfigurację SMTP
        smtp_config = {
            'MAIL_USERNAME': current_app.config.get('MAIL_USERNAME'),
            'MAIL_SERVER': current_app.config.get('MAIL_SERVER'),
            'MAIL_PORT': current_app.config.get('MAIL_PORT'),
            'MAIL_USE_TLS': current_app.config.get('MAIL_USE_TLS')
        }
        print(f"[Email] Konfiguracja SMTP: {smtp_config}", file=sys.stderr)
        
        if not smtp_config['MAIL_USERNAME']:
            error_details = {
                'step': step,
                'issue': 'Brak konfiguracji MAIL_USERNAME',
                'config_keys': list(smtp_config.keys())
            }
            print(f"[Email] BŁĄD KONFIGURACJI: {error_details}", file=sys.stderr)
            return False
        
        # Przygotuj wiadomość
        msg = Message(
            subject=f"Przypomnienie o wycenie #{quote.quote_number} - Wood Power",
            sender=smtp_config['MAIL_USERNAME'],
            recipients=[client_email],
            html=html_body
        )
        
        # Ustaw Reply-To na email opiekuna wyceny (jeśli istnieje)
        if quote.user and quote.user.email:
            msg.reply_to = quote.user.email
            print(f"[Email] Reply-To ustawione na: {quote.user.email}", file=sys.stderr)
        else:
            print(f"[Email] Brak opiekuna wyceny - Reply-To nie ustawione", file=sys.stderr)
        
        print(f"[Email] Temat: {msg.subject}", file=sys.stderr)
        print(f"[Email] Od: {msg.sender}", file=sys.stderr)
        print(f"[Email] Do: {msg.recipients}", file=sys.stderr)
        
        step = "EMAIL_SENDING"
        print(f"[Email] Wysyłam email przez SMTP...", file=sys.stderr)
        
        # Wyślij email
        mail.send(msg)
        
        print(f"[Email] ✅ EMAIL WYSŁANY POMYŚLNIE!", file=sys.stderr)
        
        step = "DATABASE_UPDATE"
        print(f"[Email] Aktualizuję bazę danych...", file=sys.stderr)
        
        # Oznacz jako wysłane
        schedule_entry.status = 'sent'
        schedule_entry.sent_date = datetime.now()
        
        # Zapisz log sukcesu
        log_entry = EmailLog(
            schedule_id=schedule_entry.id,
            quote_id=quote.id,
            email_type='quote_reminder_7_days',
            recipient_email=client_email,
            status='success',
            sent_at=datetime.now()
        )
        db.session.add(log_entry)
        db.session.commit()
        
        print(f"[Email] === ZAKOŃCZENIE: SUKCES ===", file=sys.stderr)
        print(f"[Email] Wysłano przypomnienie do {client_email} dla wyceny {quote.quote_number}", file=sys.stderr)
        return True
        
    except Exception as e:
        error_type = type(e).__name__
        error_message = str(e)
        
        print(f"[Email] === ZAKOŃCZENIE: BŁĄD ===", file=sys.stderr)
        print(f"[Email] Krok: {step}", file=sys.stderr)
        print(f"[Email] Typ błędu: {error_type}", file=sys.stderr)
        print(f"[Email] Komunikat: {error_message}", file=sys.stderr)
        print(f"[Email] Szczegóły: {error_details}", file=sys.stderr)
        
        # Import dla stack trace
        import traceback
        print(f"[Email] Stack trace:", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        
        # Oznacz jako błąd w harmonogramie
        try:
            if 'schedule_entry' in locals() and schedule_entry:
                schedule_entry.status = 'failed'
                db.session.commit()
                print(f"[Email] Zaktualizowano status harmonogramu na 'failed'", file=sys.stderr)
        except Exception as db_error:
            print(f"[Email] Błąd aktualizacji harmonogramu: {db_error}", file=sys.stderr)
        
        # Zapisz szczegółowy log błędu
        detailed_error = f"KROK: {step} | TYP: {error_type} | KOMUNIKAT: {error_message} | SZCZEGÓŁY: {error_details}"
        
        try:
            log_email_error(quote.id, 'quote_reminder_7_days', 
                          client_email if 'client_email' in locals() else 'unknown', 
                          detailed_error)
            print(f"[Email] Zapisano szczegółowy log błędu", file=sys.stderr)
        except Exception as log_error:
            print(f"[Email] Błąd zapisu logu: {log_error}", file=sys.stderr)
        
        return False

def log_email_error(quote_id, email_type, recipient_email, error_message):
    """
    Zapisuje błąd wysyłki emaila do bazy danych
    
    Args:
        quote_id: ID wyceny
        email_type: Typ emaila
        recipient_email: Email odbiorcy
        error_message: Opis błędu
    """
    try:
        log_entry = EmailLog(
            quote_id=quote_id,
            email_type=email_type,
            recipient_email=recipient_email,
            status='failed',
            error_message=error_message,
            sent_at=datetime.now()
        )
        db.session.add(log_entry)
        db.session.commit()
        
    except Exception as e:
        print(f"[Error Log] Nie można zapisać błędu do bazy: {e}", file=sys.stderr)


def get_quote_reminders_stats():
    """
    Zwraca statystyki przypomień o wycenach (dla interfejsu administracyjnego)
    
    Returns:
        dict: Słownik ze statystykami
    """
    try:
        # Statystyki z ostatnich 30 dni
        thirty_days_ago = datetime.now() - timedelta(days=30)
        
        total_sent = EmailLog.query.filter(
            EmailLog.email_type == 'quote_reminder_7_days',
            EmailLog.status == 'success',
            EmailLog.sent_at >= thirty_days_ago
        ).count()
        
        total_failed = EmailLog.query.filter(
            EmailLog.email_type == 'quote_reminder_7_days',
            EmailLog.status == 'failed',
            EmailLog.sent_at >= thirty_days_ago
        ).count()
        
        pending_count = EmailSchedule.query.filter(
            EmailSchedule.email_type == 'quote_reminder_7_days',
            EmailSchedule.status == 'pending'
        ).count()
        
        return {
            'sent_last_30_days': total_sent,
            'failed_last_30_days': total_failed,
            'pending_reminders': pending_count,
            'success_rate': round((total_sent / (total_sent + total_failed) * 100), 1) if (total_sent + total_failed) > 0 else 0
        }
        
    except Exception as e:
        print(f"[Stats] Błąd pobierania statystyk: {e}", file=sys.stderr)
        return {
            'sent_last_30_days': 0,
            'failed_last_30_days': 0,
            'pending_reminders': 0,
            'success_rate': 0
        }

def send_scheduled_emails():
    """
    Wysyła zaplanowane emaile które mają scheduled_date <= teraz.
    Wywoływana co godzinę przez scheduler.
    """
    try:
        print("[Email Send] === ROZPOCZĘCIE WYSYŁKI ZAPLANOWANYCH EMAILI ===", file=sys.stderr)
        
        # Sprawdź czy funkcja jest włączona
        config = SchedulerConfig.query.filter_by(key='quote_reminder_enabled').first()
        if not config or config.value.lower() != 'true':
            print("[Email Send] Przypomnienia są wyłączone w konfiguracji", file=sys.stderr)
            return
        
        # Znajdź emaile gotowe do wysłania
        current_time = datetime.now()
        
        emails_to_send = EmailSchedule.query.filter(
            EmailSchedule.status == 'pending',
            EmailSchedule.scheduled_date <= current_time
        ).all()
        
        print(f"[Email Send] Znaleziono {len(emails_to_send)} emaili do wysłania", file=sys.stderr)
        
        sent_count = 0
        failed_count = 0
        
        for email_schedule in emails_to_send:
            try:
                print(f"[Email Send] Wysyłam email dla wyceny ID: {email_schedule.quote_id}", file=sys.stderr)
                
                # Import modelu Quote
                from modules.quotes.models import Quote
                
                # Pobierz wycenę
                quote = Quote.query.get(email_schedule.quote_id)
                if not quote:
                    print(f"[Email Send] ❌ Nie znaleziono wyceny ID: {email_schedule.quote_id}", file=sys.stderr)
                    email_schedule.status = 'failed'
                    failed_count += 1
                    continue
                
                # Wyślij email używając istniejącej funkcji
                success = send_quote_reminder_email(quote)
                
                if success:
                    # Email został wysłany - funkcja send_quote_reminder_email już zaktualizowała status
                    sent_count += 1
                    print(f"[Email Send] ✅ Wysłano email dla wyceny {quote.quote_number}", file=sys.stderr)
                    
                    # Zmień status wyceny na "Wysłano przypomnienie" (id: 7)
                    quote.status_id = 7
                    
                else:
                    failed_count += 1
                    print(f"[Email Send] ❌ Nie udało się wysłać emaila dla wyceny {quote.quote_number}", file=sys.stderr)
                
            except Exception as e:
                print(f"[Email Send] ❌ Błąd wysyłki dla harmonogramu ID {email_schedule.id}: {e}", file=sys.stderr)
                email_schedule.status = 'failed'
                failed_count += 1
                
                # Zapisz szczegółowy błąd
                import traceback
                error_trace = traceback.format_exc()
                log_email_error(email_schedule.quote_id, email_schedule.email_type, 
                              email_schedule.recipient_email, f"Błąd harmonogramu: {str(e)}\n{error_trace}")
                continue
        
        # Zapisz wszystkie zmiany
        db.session.commit()
        
        print(f"[Email Send] === ZAKOŃCZENIE WYSYŁKI ===", file=sys.stderr)
        print(f"[Email Send] Wysłano: {sent_count}, Nie udało się: {failed_count}", file=sys.stderr)
        
    except Exception as e:
        print(f"[Email Send] KRYTYCZNY BŁĄD w wysyłce emaili: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)