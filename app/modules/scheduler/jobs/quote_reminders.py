from datetime import datetime, timedelta
from flask import current_app, render_template
from flask_mail import Message
from extensions import db, mail
from modules.scheduler.models import EmailSchedule, EmailLog, SchedulerConfig
import sys

def check_quote_reminders():
    """
    Główna funkcja sprawdzająca wyceny wymagające przypomnienia.
    Wywoływana codziennie przez scheduler.
    """
    try:
        print("[Quote Reminders] Rozpoczęcie sprawdzania wycen do przypomnienia", file=sys.stderr)
        
        # Sprawdź czy funkcja jest włączona
        config = SchedulerConfig.query.filter_by(key='quote_reminder_enabled').first()
        if not config or config.value.lower() != 'true':
            print("[Quote Reminders] Przypomnienia są wyłączone w konfiguracji", file=sys.stderr)
            return
        
        # Pobierz konfigurację dni
        days_config = SchedulerConfig.query.filter_by(key='quote_reminder_days').first()
        reminder_days = int(days_config.value) if days_config else 7
        
        # Oblicz daty
        current_date = datetime.now()
        target_date = current_date - timedelta(days=reminder_days)  # 7 dni temu
        max_date = current_date - timedelta(days=14)  # Maksymalnie 14 dni wstecz dla optymalizacji
        
        print(f"[Quote Reminders] Szukam wycen z okresu: {max_date.strftime('%Y-%m-%d')} do {target_date.strftime('%Y-%m-%d')}", file=sys.stderr)
        
        # Import modelu Quote (musi być tutaj żeby uniknąć circular imports)
        from modules.quotes.models import Quote
        
        # Znajdź wyceny do przypomnienia
        quotes_to_remind = db.session.query(Quote).filter(
            Quote.status_id == 1,  # Status "Nowa wycena"
            Quote.created_at >= max_date,  # Ostatnie 14 dni (optymalizacja)
            Quote.created_at <= target_date,  # Starsze niż 7 dni
        ).all()
        
        print(f"[Quote Reminders] Znaleziono {len(quotes_to_remind)} wycen do sprawdzenia", file=sys.stderr)
        
        sent_count = 0
        error_count = 0
        
        for quote in quotes_to_remind:
            try:
                # Sprawdź czy już nie wysłano przypomnienia dla tej wyceny
                existing_reminder = EmailSchedule.query.filter_by(
                    quote_id=quote.id,
                    email_type='quote_reminder_7_days',
                    status='sent'
                ).first()
                
                if existing_reminder:
                    print(f"[Quote Reminders] Wycena {quote.quote_number} - przypomnienie już wysłane", file=sys.stderr)
                    continue
                
                # Sprawdź czy klient ma email
                if not quote.client or not quote.client.email:
                    print(f"[Quote Reminders] Wycena {quote.quote_number} - brak emaila klienta", file=sys.stderr)
                    log_email_error(quote.id, 'quote_reminder_7_days', '', 'Brak emaila klienta')
                    error_count += 1
                    continue
                
                # Wyślij przypomnienie
                success = send_quote_reminder_email(quote)
                if success:
                    # Zmień status wyceny na "Wysłano przypomnienie" (id: 7)
                    quote.status_id = 7
                    db.session.commit()
                    sent_count += 1
                    print(f"[Quote Reminders] Wysłano przypomnienie dla wyceny {quote.quote_number}", file=sys.stderr)
                else:
                    error_count += 1
                    
            except Exception as e:
                print(f"[Quote Reminders] Błąd przetwarzania wyceny {quote.id}: {e}", file=sys.stderr)
                log_email_error(quote.id, 'quote_reminder_7_days', quote.client.email if quote.client else '', str(e))
                error_count += 1
                continue
        
        print(f"[Quote Reminders] Zakończono: wysłano {sent_count}, błędów {error_count}", file=sys.stderr)
        
    except Exception as e:
        print(f"[Quote Reminders] KRYTYCZNY BŁĄD w sprawdzaniu wycen: {e}", file=sys.stderr)


def send_quote_reminder_email(quote):
    """
    Wysyła email z przypomnieniem o wycenie do klienta
    
    Args:
        quote: Obiekt wyceny (Quote model)
        
    Returns:
        bool: True jeśli wysłano pomyślnie, False w przypadku błędu
    """
    try:
        client_email = quote.client.email
        
        # Utwórz lub znajdź wpis w harmonogramie
        schedule_entry = EmailSchedule.query.filter_by(
            quote_id=quote.id,
            email_type='quote_reminder_7_days'
        ).first()
        
        if not schedule_entry:
            schedule_entry = EmailSchedule(
                quote_id=quote.id,
                email_type='quote_reminder_7_days',
                recipient_email=client_email,
                scheduled_date=datetime.now(),
                status='pending'
            )
            db.session.add(schedule_entry)
            db.session.flush()  # Żeby dostać ID
        
        # Zwiększ licznik prób
        schedule_entry.attempts += 1
        
        # Wygeneruj treść maila
        quote_url = f"https://crm.woodpower.pl/quotes/c/{quote.public_token}"
        
        html_body = render_template(
            'scheduler/quote_reminder_email.html',
            quote=quote,
            client=quote.client,
            quote_url=quote_url,
            days_passed=7
        )
        
        # Przygotuj wiadomość
        msg = Message(
            subject=f"Przypomnienie o wycenie #{quote.quote_number} - Wood Power",
            sender=current_app.config['MAIL_USERNAME'],
            recipients=[client_email],
            html=html_body
        )
        
        # Ustaw Reply-To na email opiekuna wyceny (jeśli istnieje)
        if quote.user and quote.user.email:
            msg.reply_to = quote.user.email
        
        # Wyślij email
        mail.send(msg)
        
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
        
        print(f"[Email] Wysłano przypomnienie do {client_email} dla wyceny {quote.quote_number}", file=sys.stderr)
        return True
        
    except Exception as e:
        print(f"[Email] Błąd wysyłki przypomnienia dla wyceny {quote.id}: {e}", file=sys.stderr)
        
        # Oznacz jako błąd w harmonogramie
        if 'schedule_entry' in locals():
            schedule_entry.status = 'failed'
            db.session.commit()
        
        # Zapisz log błędu
        log_email_error(quote.id, 'quote_reminder_7_days', client_email, str(e))
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