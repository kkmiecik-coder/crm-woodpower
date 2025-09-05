from flask import Flask, render_template, redirect, url_for, request, session, flash, current_app
import os
import json
import sys
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature
from functools import wraps
from flask_mail import Mail, Message
from jinja2 import ChoiceLoader, FileSystemLoader
from extensions import db, mail
import threading
from sqlalchemy import desc
from modules.calculator import calculator_bp
from modules.calculator.models import User, Invitation, Price, Multiplier
from modules.clients import clients_bp
from modules.public_calculator import public_calculator_bp
from modules.analytics.routers import analytics_bp
from modules.quotes.routers import quotes_bp
from modules.baselinker import baselinker_bp
from modules.preview3d_ar import preview3d_ar_bp
from modules.logging import AppLogger, get_logger, logging_bp, get_structured_logger
from modules.reports import reports_bp
from modules.production import production_bp
from modules.company_register import register_bp
from modules.dashboard import dashboard_bp
from modules.dashboard.models import ChangelogEntry, ChangelogItem, UserSession
from modules.dashboard.services.user_activity_service import UserActivityService
from sqlalchemy.exc import ResourceClosedError, OperationalError

os.environ['PYTHONIOENCODING'] = 'utf-8:replace'
from modules.scheduler import scheduler_bp
try:
    from modules.scheduler.scheduler_service import init_scheduler, get_scheduler_status
    from modules.scheduler.jobs.quote_reminders import get_quote_reminders_stats
    SCHEDULER_AVAILABLE = True
except ImportError as e:
    print(f"[WARNING] Scheduler niedostępny: {e}", file=sys.stderr)
    SCHEDULER_AVAILABLE = False
    init_scheduler = lambda app: None
    get_scheduler_status = lambda: {'running': False, 'jobs': []}
    get_quote_reminders_stats = lambda: {
        'sent_last_30_days': 0, 
        'failed_last_30_days': 0, 
        'pending_reminders': 0, 
        'success_rate': 0
    }

_scheduler_lock = threading.Lock()
_scheduler_initialized = False

def initialize_scheduler_safely(app):
    """
    Thread-safe inicjalizacja schedulera - wywoływana tylko raz
    """
    global _scheduler_initialized
    
    if not SCHEDULER_AVAILABLE:
        print("[Scheduler] Scheduler niedostępny - pomijam inicjalizację", file=sys.stderr)
        return
    
    # Double-checked locking pattern
    if not _scheduler_initialized:
        with _scheduler_lock:
            if not _scheduler_initialized:
                try:
                    print(f"[Scheduler] Inicjalizacja schedulera w procesie PID: {os.getpid()}", file=sys.stderr)
                    init_scheduler(app)
                    _scheduler_initialized = True
                    print("[Scheduler] ✅ Scheduler zainicjalizowany pomyślnie", file=sys.stderr)
                except Exception as e:
                    print(f"[Scheduler] ❌ Błąd inicjalizacji schedulera: {e}", file=sys.stderr)
                    import traceback
                    traceback.print_exc(file=sys.stderr)
            else:
                print("[Scheduler] Scheduler już zainicjalizowany - pomijam", file=sys.stderr)
    else:
        print("[Scheduler] Scheduler już zainicjalizowany - pomijam", file=sys.stderr)

def create_admin():
    """Tworzy użytkownika admina, jeśli nie istnieje."""
    admin_email = "admin@woodpower.pl"
    admin_password = "Kmiecik99"  # Ustaw mocne hasło
    admin_user = User.query.filter_by(email=admin_email).first()
    if not admin_user:
        hashed_pass = generate_password_hash(admin_password)
        new_admin = User(
            email=admin_email,
            password=hashed_pass,
            role="admin"
        )
        db.session.add(new_admin)
        db.session.commit()

# Funkcje do generowania i weryfikacji tokena resetującego hasło
def generate_reset_token(email, secret_key, salt='password-reset-salt'):
    serializer = URLSafeTimedSerializer(secret_key)
    return serializer.dumps(email, salt=salt)

def verify_reset_token(token, secret_key, salt='password-reset-salt', expiration=3600):
    serializer = URLSafeTimedSerializer(secret_key)
    try:
        email = serializer.loads(token, salt=salt, max_age=expiration)
    except (SignatureExpired, BadSignature):
        return None
    return email

def create_app():
    app = Flask(__name__)
    app.secret_key = "65d769148feb6bc476c6d2120d4abb40069cdfd919c37f99"
    app.jinja_loader = ChoiceLoader([
        app.jinja_loader,
        FileSystemLoader(os.path.join(app.root_path, 'modules'))
    ])

    # Ładowanie konfiguracji z pliku config/core.json
    config_path = os.path.join(app.root_path, "config", "core.json")
    if os.path.exists(config_path):
        with open(config_path, "r") as config_file:
            config_data = json.load(config_file)
        app.config.update(config_data)
        print("Konfiguracja załadowana z app/config/core.json", file=sys.stderr)
    else:
        config_data = {
            "DEBUG": True,
            "DATABASE_URI": "sqlite:///kalkulator_web.db"
        }
        app.config.update(config_data)
        print("Nie znaleziono app/config/core.json – użyto wartości domyślnych", file=sys.stderr)

    # Dodajemy ustawienia utrzymujące połączenie z bazą:
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_pre_ping': True,
        'pool_recycle': 270,
        'pool_size': 5,
        'max_overflow': 10
    }
    app.config['SQLALCHEMY_DATABASE_URI'] = app.config["DATABASE_URI"]
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    # Inicjalizacja Flask-Mail oraz bazy danych itp.
    mail = Mail(app)
    db.init_app(app)
    
    with app.app_context():
        db.create_all()
        create_admin()

    # Rejestracja blueprintów oraz dalsze routy...
    app.register_blueprint(calculator_bp, url_prefix='/calculator')
    app.register_blueprint(clients_bp, url_prefix='/clients')
    app.register_blueprint(public_calculator_bp)
    app.register_blueprint(analytics_bp, url_prefix="/analytics")
    app.register_blueprint(quotes_bp, url_prefix="/quotes")
    app.register_blueprint(baselinker_bp, url_prefix='/baselinker')
    app.register_blueprint(logging_bp, url_prefix='/logging')
    app.register_blueprint(preview3d_ar_bp)
    app.register_blueprint(reports_bp, url_prefix='/reports')
    app.register_blueprint(scheduler_bp, url_prefix='/scheduler')
    app.register_blueprint(production_bp)
    app.register_blueprint(register_bp)
    app.register_blueprint(dashboard_bp, url_prefix='/dashboard')

    @app.before_request
    def extend_session():
        session.permanent = True
    
        # DODAJ tracking aktywności użytkowników
        track_user_activity()

    # Dekorator zabezpieczający strony – wymaga zalogowania
    def login_required(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            user_email = session.get('user_email')
            if not user_email:
                flash("Twoja sesja wygasła. Zaloguj się ponownie.", "info")
                return redirect(url_for('login'))
            return func(*args, **kwargs)
        return wrapper

    def track_user_activity():
        """
        Śledzi aktywność użytkowników przy każdym żądaniu HTTP
        """
        try:
            # Sprawdź czy użytkownik jest zalogowany
            user_id = session.get('user_id')
            user_email = session.get('user_email')
        
            if not user_id or not user_email:
                return
        
            # Pobierz informacje o żądaniu
            current_page = request.endpoint
            ip_address = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
        
            # Jeśli IP zawiera wiele adresów (proxy), weź pierwszy
            if ip_address and ',' in ip_address:
                ip_address = ip_address.split(',')[0].strip()
        
            # Aktualizuj aktywność
            UserActivityService.update_activity(
                user_id=user_id,
                current_page=current_page,
                ip_address=ip_address
            )
        
        except Exception as e:
            # Nie przerywaj żądania jeśli tracking się nie powiedzie
            current_app.logger.debug(f"[Activity] Błąd tracking aktywności: {e}")

    def check_user_session_validity():
        """
        Sprawdza ważność sesji użytkownika i wylogowuje jeśli nieważna
        """
        try:
            session_token = session.get('user_session_token')
            user_id = session.get('user_id')
        
            if not session_token or not user_id:
                return True  # Brak sesji - OK
        
            # Sprawdź czy sesja istnieje w bazie
            user_session = UserSession.query.filter_by(
                session_token=session_token,
                user_id=user_id,
                is_active=True
            ).first()
        
            if not user_session:
                # Sesja nieważna - wyloguj
                current_app.logger.warning(f"[Security] Wykryto nieważną sesję dla user_id={user_id}")
                session.clear()
                return False
        
            # Sprawdź czy sesja nie jest zbyt stara (ponad 24h)
            from datetime import datetime, timedelta
            if user_session.last_activity_at < datetime.utcnow() - timedelta(hours=24):
                current_app.logger.info(f"[Security] Sesja wygasła dla user_id={user_id}")
                user_session.force_logout()
                session.clear()
                return False
        
            return True
        
        except Exception as e:
            current_app.logger.error(f"[Security] Błąd sprawdzania sesji: {e}")
            return True  # W razie błędu nie wylogowuj

    @app.errorhandler(401)
    def handle_unauthorized(error):
        """
        Obsługa błędów autoryzacji - przekieruj na login
        """
        if request.path.startswith('/api/'):
            return jsonify({
                'success': False,
                'error': 'Sesja wygasła',
                'redirect': url_for('login')
            }), 401
        else:
            flash("Twoja sesja wygasła. Zaloguj się ponownie.", "info")
            return redirect(url_for('login'))

    # -------------------------
    #         ROUTES
    # -------------------------
    from datetime import timedelta
    app.permanent_session_lifetime = timedelta(minutes=120)

    @app.route('/api/session/ping', methods=['POST'])
    def session_ping():
        """
        Endpoint do odświeżania sesji (heartbeat)
        Może być wywoływany przez JavaScript co kilka minut
        """
        try:
            user_id = session.get('user_id')
            if not user_id:
                return jsonify({'success': False, 'error': 'Nie zalogowano'}), 401
        
            # Aktualizuj aktywność
            success = UserActivityService.update_activity(
                user_id=user_id,
                current_page=request.json.get('current_page') if request.is_json else None
            )
        
            if success:
                return jsonify({
                    'success': True,
                    'timestamp': datetime.utcnow().isoformat()
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Nie udało się zaktualizować sesji'
                }), 500
            
        except Exception as e:
            current_app.logger.error(f"[SessionPing] Błąd: {e}")
            return jsonify({
                'success': False,
                'error': 'Błąd serwera'
            }), 500


    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if request.method == 'POST':
            email = request.form.get('email')
            password = request.form.get('password')

            # Pobieramy użytkownika z bazy
            user = User.query.filter_by(email=email).first()
            if not user:
                return render_template('login.html',
                                       email_value=email,
                                       password_error='Błędne hasło lub e-mail.',
                                       email_error=None)
            if not user.active:
                return render_template('login.html',
                                       email_value=email,
                                       password_error='Twoje konto zostało dezaktywowane.',
                                       email_error=None)
            if not check_password_hash(user.password, password):
                return render_template('login.html',
                                       email_value=email,
                                       password_error='Błędne hasło lub e-mail.',
                                       email_error=None)

            # Jeśli wszystko jest ok, zapisujemy sesję
            session['user_email'] = email
            session['user_id'] = user.id
            session.permanent = True
        
            # DODAJ: Utwórz sesję użytkownika dla tracking
            try:
                ip_address = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
                if ip_address and ',' in ip_address:
                    ip_address = ip_address.split(',')[0].strip()
                
                user_agent = request.headers.get('User-Agent', '')
            
                UserActivityService.create_session(
                    user_id=user.id,
                    ip_address=ip_address,
                    user_agent=user_agent
                )
            
                current_app.logger.info(f"[Login] Utworzono sesję tracking dla {email}")
            
            except Exception as e:
                current_app.logger.error(f"[Login] Błąd tworzenia sesji tracking: {e}")
                # Nie przerywaj logowania jeśli tracking się nie powiedzie
        
            return redirect(url_for("dashboard.dashboard"))

        return render_template("login.html")

    @app.route("/")
    def index():
        # Jeśli użytkownik jest zalogowany, przekieruj na dashboard
        if session.get('user_email'):
            return redirect(url_for('dashboard.dashboard'))
        return redirect(url_for("login"))

    @app.route("/clients")
    @login_required
    def clients():
        user_email = session.get('user_email')
        return render_template("clients.html", user_email=user_email)

    @app.route("/help")
    @login_required
    def help():
        user_email = session.get('user_email')
        return render_template("help/help.html", user_email=user_email)

    @app.route("/logged_out")
    @app.route("/logged_out")
    def logged_out():
        try:
            # DODAJ: Zakończ sesję tracking przed wylogowaniem
            user_id = session.get('user_id')
            session_token = session.get('user_session_token')
        
            if user_id or session_token:
                UserActivityService.end_session(
                    user_id=user_id,
                    session_token=session_token
                )
                current_app.logger.info(f"[Logout] Zakończono sesję tracking dla user_id={user_id}")
            
        except Exception as e:
            current_app.logger.error(f"[Logout] Błąd kończenia sesji tracking: {e}")
    
        # Oryginalne czyszczenie sesji
        session.clear()
        return render_template("logged_out.html")

    @app.route("/issue", methods=["GET", "POST"])
    @login_required
    def issue():
        user_email = session.get('user_email')
        
        if request.method == "POST":
            # Pobranie danych z formularza
            problem_location = request.form.get('problem_location')
            priority = request.form.get('priority')
            problem_description = request.form.get('problem_description')

            # Walidacja podstawowych pól
            if not problem_location or not priority or not problem_description:
                flash("Wszystkie pola są wymagane.", "error")
                return redirect(url_for("issue"))

            # Pobranie wszystkich załączników z pola 'attachments'
            attachments = request.files.getlist('attachments')
            
            # Stałe walidacyjne
            MAX_FILE_SIZE_MB = 2
            MAX_TOTAL_SIZE_MB = 15
            MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
            MAX_TOTAL_SIZE_BYTES = MAX_TOTAL_SIZE_MB * 1024 * 1024
            
            # Walidacja załączników
            if attachments:
                total_size = 0
                valid_attachments = []
                errors = []
                
                for attachment in attachments:
                    if attachment and attachment.filename:
                        # Sprawdź rozmiar pojedynczego pliku
                        attachment.seek(0, 2)  # Przejdź na koniec pliku
                        file_size = attachment.tell()
                        attachment.seek(0)  # Wróć na początek
                        
                        if file_size > MAX_FILE_SIZE_BYTES:
                            errors.append(f"Plik '{attachment.filename}' jest za duży ({file_size / (1024*1024):.1f}MB). Maksymalny rozmiar: {MAX_FILE_SIZE_MB}MB")
                            continue
                        
                        total_size += file_size
                        valid_attachments.append(attachment)
                
                # Sprawdź łączny rozmiar
                if total_size > MAX_TOTAL_SIZE_BYTES:
                    errors.append(f"Łączny rozmiar plików ({total_size / (1024*1024):.1f}MB) przekracza limit {MAX_TOTAL_SIZE_MB}MB")
                
                # Jeśli są błędy walidacji
                if errors:
                    flash(errors[0], "error")  # Pokazuj tylko pierwszy błąd w toast
                    return redirect(url_for("issue"))
                
                # Użyj tylko prawidłowych załączników
                attachments = valid_attachments

            try:
                # Utworzenie wiadomości email
                msg = Message("Nowe zgłoszenie błędu",
                            sender=app.config.get("MAIL_USERNAME"),
                            recipients=["admin@woodpower.pl"])
                
                # Ustawienie reply_to na adres zalogowanego użytkownika
                msg.reply_to = user_email

                # Wygenerowanie treści maila przy użyciu szablonu
                msg.html = render_template("issue_mail.html",
                                        user_email=user_email,
                                        problem_location=problem_location,
                                        priority=priority,
                                        problem_description=problem_description,
                                        attachments_count=len(attachments) if attachments else 0)

                # Dołączenie załączników
                total_attached_size = 0
                if attachments:
                    for attachment in attachments:
                        if attachment and attachment.filename:
                            # Bezpieczna nazwa pliku (usunięcie potencjalnie niebezpiecznych znaków)
                            import re
                            safe_filename = re.sub(r'[^\w\s.-]', '', attachment.filename)
                            safe_filename = re.sub(r'[-\s]+', '-', safe_filename)
                            
                            # Odczytaj zawartość pliku
                            file_content = attachment.read()
                            file_size = len(file_content)
                            total_attached_size += file_size
                            
                            # Dołącz do wiadomości
                            msg.attach(
                                safe_filename,
                                attachment.content_type or 'application/octet-stream',
                                file_content
                            )
                            
                            current_app.logger.info(f"Załączono plik: {safe_filename} ({file_size} bytes)")

                # Logowanie informacji o zgłoszeniu
                current_app.logger.info(f"Nowe zgłoszenie od {user_email}: {problem_location} - {priority}")
                current_app.logger.info(f"Liczba załączników: {len(attachments) if attachments else 0}")
                current_app.logger.info(f"Łączny rozmiar załączników: {total_attached_size} bytes")

                 # Wysłanie maila
                mail.send(msg)
                
                # ✅ PRAWIDŁOWE Flash – komunikat o sukcesie
                if attachments:
                    flash(f"Zgłoszenie wysłane z {len(attachments)} załącznikami. Odpowiemy najszybciej jak to będzie możliwe.", "success")
                else:
                    flash("Zgłoszenie zostało wysłane. Odpowiemy najszybciej jak to będzie możliwe.", "success")
                    
            except Exception as e:
                current_app.logger.error(f"Błąd podczas wysyłania zgłoszenia: {str(e)}")
                flash(f"Wystąpił błąd: {str(e)} podczas wysyłania zgłoszenia. Spróbuj ponownie.", "error")

            return redirect(url_for("issue"))
        
        return render_template("issue/issue.html", user_email=user_email)

    @app.route("/settings")
    @login_required
    def settings():
        user_email = session.get('user_email')
        user = User.query.filter_by(email=user_email).first()
        if not user:
            return redirect(url_for('login'))

        if user.role == "admin":
            all_users = User.query.all()
            all_prices = Price.query.order_by(Price.species, Price.wood_class).all()
            multipliers = Multiplier.query.all()
        
            # DODAJ DANE SCHEDULERA
            try:
                from modules.scheduler.scheduler_service import get_scheduler_status
                from modules.scheduler.jobs.quote_reminders import get_quote_reminders_stats
                from modules.scheduler.models import EmailLog, EmailSchedule, SchedulerConfig
                from datetime import datetime, timedelta
            
                # Pobierz dane schedulera
                scheduler_status = get_scheduler_status()
                quote_stats = get_quote_reminders_stats()
                recent_logs = EmailLog.query.order_by(EmailLog.sent_at.desc()).limit(10).all()
            
                # Konfiguracje
                configs = {}
                config_records = SchedulerConfig.query.all()
                for config in config_records:
                    configs[config.key] = config.value
            
                # Statystyki
                pending_emails = EmailSchedule.query.filter_by(status='pending').count()
            
            
            except Exception as e:
                print(f"[Settings] Błąd ładowania danych schedulera: {e}", file=sys.stderr)
                # Ustaw wartości domyślne jeśli scheduler nie działa
                scheduler_status = {'running': False, 'jobs': []}
                quote_stats = {'sent_last_30_days': 0, 'failed_last_30_days': 0}
                recent_logs = []
                configs = {}
                pending_emails = 0
        
            return render_template("settings_page/admin_settings.html",
                                   users_list=all_users,
                                   prices=all_prices,
                                   multipliers=multipliers,
                                   # DODAJ DANE SCHEDULERA DO TEMPLATE
                                   scheduler_status=scheduler_status,
                                   quote_stats=quote_stats,
                                   recent_logs=recent_logs,
                                   configs=configs,
                                   pending_emails=pending_emails)
        else:
            return render_template("settings_page/user_settings.html")

    @app.route("/settings/prices", methods=["GET", "POST"])
    @login_required
    def admin_prices():
        # Nowy system logowania
        prices_logger = get_logger('admin.prices')
        prices_logger.info("Wejście do endpointu /settings/prices")
        
        # 1. Sprawdź, czy zalogowany jest admin
        current_email = session.get('user_email')
        prices_logger.debug("Sprawdzanie uprawnień użytkownika", user_email=current_email)
        current_user = User.query.filter_by(email=current_email).first()
        prices_logger.debug("Pobrano użytkownika z bazy", 
                        user_found=bool(current_user), 
                        user_role=current_user.role if current_user else None)
        
        if not current_user or current_user.role != 'admin':
            prices_logger.warning("Odmowa dostępu - brak uprawnień administratora", 
                                user_email=current_email,
                                user_role=current_user.role if current_user else 'brak_użytkownika')
            flash("Brak uprawnień. Tylko administrator może edytować cennik.", "error")
            return redirect(url_for('settings'))

        # 2A. Obsługa zapisu (POST)
        if request.method == "POST":
            prices_logger.info("Rozpoczęcie aktualizacji cennika", operation='POST_update')
            all_prices = Price.query.all()
            prices_logger.debug("Pobrano rekordy cennika z bazy danych", 
                            total_records=len(all_prices))
            
            updated_records = 0
            errors_count = 0
            
            # Dla każdego rekordu w bazie:
            for price_record in all_prices:
                prefix = f"price_{price_record.id}_"
                prices_logger.debug("Przetwarzanie rekordu cennika", 
                                record_id=price_record.id,
                                species=price_record.species,
                                wood_class=price_record.wood_class,
                                form_prefix=prefix)
                
                # Odczytujemy wartości z formularza i zamieniamy przecinek na kropkę
                new_thickness_min = request.form.get(prefix + "thickness_min", "").replace(",", ".")
                new_thickness_max = request.form.get(prefix + "thickness_max", "").replace(",", ".")
                new_length_min = request.form.get(prefix + "length_min", "").replace(",", ".")
                new_length_max = request.form.get(prefix + "length_max", "").replace(",", ".")
                new_price_per_m3 = request.form.get(prefix + "price_per_m3", "").replace(",", ".")
                
                prices_logger.debug("Otrzymane dane z formularza", 
                                record_id=price_record.id,
                                form_data={
                                    'thickness_min_raw': new_thickness_min,
                                    'thickness_max_raw': new_thickness_max,
                                    'length_min_raw': new_length_min,
                                    'length_max_raw': new_length_max,
                                    'price_per_m3_raw': new_price_per_m3
                                })
                
                try:
                    # Konwersja na float/int
                    thickness_min_val = float(new_thickness_min)
                    thickness_max_val = float(new_thickness_max)
                    length_min_val = int(float(new_length_min))
                    length_max_val = int(float(new_length_max))
                    price_per_m3_val = float(new_price_per_m3)
                    
                    prices_logger.debug("Pomyślna konwersja wartości", 
                                    record_id=price_record.id,
                                    converted_values={
                                        'thickness_min': thickness_min_val,
                                        'thickness_max': thickness_max_val,
                                        'length_min': length_min_val,
                                        'length_max': length_max_val,
                                        'price_per_m3': price_per_m3_val
                                    })
                    
                    # Sprawdzenie, czy wartości nie są ujemne
                    if thickness_min_val < 0 or thickness_max_val < 0 or length_min_val < 0 or length_max_val < 0 or price_per_m3_val < 0:
                        prices_logger.error("Wykryto ujemne wartości w formularzu", 
                                        record_id=price_record.id,
                                        species=price_record.species,
                                        wood_class=price_record.wood_class,
                                        invalid_values={
                                            'thickness_min': thickness_min_val,
                                            'thickness_max': thickness_max_val,
                                            'length_min': length_min_val,
                                            'length_max': length_max_val,
                                            'price_per_m3': price_per_m3_val
                                        },
                                        validation_error='negative_values')
                        flash(f"Nie można wprowadzić ujemnych wartości (ID: {price_record.id}).", "error")
                        return redirect(url_for('admin_prices'))
                    
                    # Sprawdzenie logiki min/max
                    if thickness_min_val > thickness_max_val:
                        prices_logger.error("Nieprawidłowa logika min/max dla grubości", 
                                        record_id=price_record.id,
                                        thickness_min=thickness_min_val,
                                        thickness_max=thickness_max_val,
                                        validation_error='thickness_min_greater_than_max')
                        flash(f"Grubość min nie może być większa od max (ID: {price_record.id}).", "error")
                        return redirect(url_for('admin_prices'))
                    
                    if length_min_val > length_max_val:
                        prices_logger.error("Nieprawidłowa logika min/max dla długości", 
                                        record_id=price_record.id,
                                        length_min=length_min_val,
                                        length_max=length_max_val,
                                        validation_error='length_min_greater_than_max')
                        flash(f"Długość min nie może być większa od max (ID: {price_record.id}).", "error")
                        return redirect(url_for('admin_prices'))
                    
                    # Sprawdź czy są zmiany
                    changes_detected = (
                        price_record.thickness_min != thickness_min_val or
                        price_record.thickness_max != thickness_max_val or
                        price_record.length_min != length_min_val or
                        price_record.length_max != length_max_val or
                        price_record.price_per_m3 != price_per_m3_val
                    )
                    
                    if changes_detected:
                        # Loguj stare vs nowe wartości
                        prices_logger.info("Wykryto zmiany w rekordzie", 
                                        record_id=price_record.id,
                                        species=price_record.species,
                                        wood_class=price_record.wood_class,
                                        old_values={
                                            'thickness_min': float(price_record.thickness_min),
                                            'thickness_max': float(price_record.thickness_max),
                                            'length_min': price_record.length_min,
                                            'length_max': price_record.length_max,
                                            'price_per_m3': float(price_record.price_per_m3)
                                        },
                                        new_values={
                                            'thickness_min': thickness_min_val,
                                            'thickness_max': thickness_max_val,
                                            'length_min': length_min_val,
                                            'length_max': length_max_val,
                                            'price_per_m3': price_per_m3_val
                                        })
                        
                        # Aktualizacja rekordu
                        price_record.thickness_min = thickness_min_val
                        price_record.thickness_max = thickness_max_val
                        price_record.length_min = length_min_val
                        price_record.length_max = length_max_val
                        price_record.price_per_m3 = price_per_m3_val
                        updated_records += 1
                        
                        prices_logger.info("Rekord został zaktualizowany", 
                                        record_id=price_record.id,
                                        species=price_record.species,
                                        wood_class=price_record.wood_class,
                                        update_successful=True)
                    else:
                        prices_logger.debug("Brak zmian w rekordzie", 
                                        record_id=price_record.id,
                                        species=price_record.species,
                                        wood_class=price_record.wood_class)
                    
                except ValueError as e:
                    errors_count += 1
                    prices_logger.error("Błąd konwersji wartości liczbowych", 
                                    record_id=price_record.id,
                                    species=price_record.species,
                                    wood_class=price_record.wood_class,
                                    error_message=str(e),
                                    error_type='ValueError',
                                    form_data={
                                        'thickness_min_raw': new_thickness_min,
                                        'thickness_max_raw': new_thickness_max,
                                        'length_min_raw': new_length_min,
                                        'length_max_raw': new_length_max,
                                        'price_per_m3_raw': new_price_per_m3
                                    })
                    flash(f"Błąd konwersji wartości liczbowych przy rekordzie ID {price_record.id}.", "error")
                    return redirect(url_for('admin_prices'))
                
                except Exception as e:
                    errors_count += 1
                    prices_logger.error("Nieoczekiwany błąd podczas przetwarzania rekordu", 
                                    record_id=price_record.id,
                                    species=price_record.species,
                                    wood_class=price_record.wood_class,
                                    error_message=str(e),
                                    error_type=type(e).__name__)
                    flash(f"Nieoczekiwany błąd przy rekordzie ID {price_record.id}.", "error")
                    return redirect(url_for('admin_prices'))
            
            # Po zaktualizowaniu wszystkich rekordów
            try:
                db.session.commit()
                prices_logger.info("Pomyślnie zakończono aktualizację cennika", 
                                operation='database_commit',
                                total_records_processed=len(all_prices),
                                records_updated=updated_records,
                                records_unchanged=len(all_prices) - updated_records,
                                errors_count=errors_count,
                                commit_successful=True)
                
                if updated_records > 0:
                    flash(f"Pomyślnie zaktualizowano cennik. Zmieniono {updated_records} rekordów.", "success")
                else:
                    flash("Cennik sprawdzony - brak zmian do zapisania.", "info")
                    
            except Exception as e:
                db.session.rollback()
                prices_logger.error("Błąd podczas zapisywania do bazy danych", 
                                error_message=str(e),
                                error_type=type(e).__name__,
                                operation='database_commit',
                                records_to_update=updated_records)
                flash("Błąd podczas zapisywania zmian do bazy danych.", "error")
            
            return redirect(url_for('admin_prices'))
        
        # 2B. Obsługa GET – wyświetlenie
        prices_logger.info("Wyświetlanie strony administracji cennika", operation='GET_display')
        all_prices = Price.query.order_by(Price.species, Price.wood_class).all()
        prices_logger.debug("Pobrano dane cennika do wyświetlenia", 
                        total_records=len(all_prices),
                        species_count=len(set(p.species for p in all_prices)),
                        wood_classes=list(set(p.wood_class for p in all_prices)))
        
        prices_logger.info("Renderowanie szablonu admin_settings.html", 
                        template='admin_settings.html',
                        data_records=len(all_prices))
        
        return render_template("settings_page/admin_settings.html", prices=all_prices)

    @app.route('/settings/logs')
    @login_required
    def settings_logs():
        user_email = session.get('user_email')
        user = User.query.filter_by(email=user_email).first()
        if not user or user.role != 'admin':
            flash('Brak uprawnień. Tylko administrator ma dostęp do logów.', 'error')
            return redirect(url_for('settings'))
        return render_template('settings_page/logs_console.html')

    @app.route('/api/latest-version')
    def get_latest_version():
        try:
            # Sprawdź czy masz import modelu
        
            # Musisz zaimportować model - sprawdź jaki masz:
            # from modules.dashboard.models import ChangelogEntry  # lub inna ścieżka
        
            latest_entry = db.session.query(ChangelogEntry)\
                .order_by(desc(ChangelogEntry.id))\
                .first()
                
            if latest_entry:
                return {'version': latest_entry.version}
            else:
                return {'version': 'v1.2'}
            
        except Exception as e:
            return {'version': 'v1.2'}

    @app.route("/invite_user", methods=["POST"])
    @login_required
    def invite_user():
        # ... sprawdzanie, czy admin ...
        invite_email = request.form.get('invite_email')
        invite_role = request.form.get('invite_role')  # Nowe pole

        # Sprawdzamy, czy takie zaproszenie już istnieje
        existing_invitation = Invitation.query.filter_by(email=invite_email).first()
        if existing_invitation:
            flash("Ten e-mail jest już zaproszony.", "warning")
            return redirect(url_for("settings"))

        import secrets
        token = secrets.token_urlsafe(32)

        # Zapisujemy zaproszenie, uwzględniając rolę
        invite_multiplier_id = request.form.get('invite_multiplier')

        # Jeśli partner → ustaw multiplier_id, w pozostałych przypadkach None
        multiplier_id = int(invite_multiplier_id) if invite_role == "partner" and invite_multiplier_id else None

        new_invitation = Invitation(
            email=invite_email,
            token=token,
            active=True,
            role=invite_role,
            multiplier_id=multiplier_id
        )
        db.session.add(new_invitation)
        db.session.commit()

        invitation_link = url_for('accept_invitation', token=token, _external=True)

        subject = "Zaproszenie do CRM WoodPower"
        msg = Message(subject,
                      sender=current_app.config.get("MAIL_USERNAME"),
                      recipients=[invite_email])

        msg.html = render_template("new_account_register_mail.html",
                                   invitation_link=invitation_link)
        mail.send(msg)

        flash("Zaproszenie wysłane do " + invite_email, "success")
        return redirect(url_for("settings"))

    @app.route('/accept_invitation/<token>', methods=['GET', 'POST'])
    def accept_invitation(token):
        invitation = Invitation.query.filter_by(token=token, active=True).first()
        if not invitation:
            flash("Zaproszenie jest nieprawidłowe lub nieaktywne.", "error")
            return redirect(url_for('login'))

        if request.method == 'GET':
            return render_template("accept_invitation.html", token=token)

        # Pobieramy dane z formularza
        first_name = request.form.get('first_name')
        last_name = request.form.get('last_name')
        password = request.form.get('password')
        password2 = request.form.get('password2')
        # ...

        if password != password2:
            flash("Hasła muszą być identyczne!", "error")
            return redirect(url_for('accept_invitation', token=token))

        existing_user = User.query.filter_by(email=invitation.email).first()
        if existing_user:
            flash("Konto z tym e-mailem już istnieje!", "error")
            return redirect(url_for('login'))

        hashed_pass = generate_password_hash(password)
        # Ustawiamy rolę na taką, jaka została zapisana w zaproszeniu
        new_user = User(
            email=invitation.email,
            password=hashed_pass,
            role=invitation.role if invitation.role else 'user',
            first_name=first_name,
            last_name=last_name,
            multiplier_id=invitation.multiplier_id
        )

        # Obsługa avatara ...
        db.session.add(new_user)
        db.session.commit()

        invitation.active = False
        db.session.commit()

        flash("Konto zostało utworzone! Możesz się zalogować.", "success")
        return redirect(url_for('login'))


    @app.context_processor
    def inject_user():
        user_email = session.get('user_email')
        if user_email:
            user = User.query.filter_by(email=user_email).first()
            if user:
                # Jeśli imię i nazwisko są uzupełnione, łączymy je. W przeciwnym razie używamy emaila.
                user_name = f"{user.first_name} {user.last_name}".strip() if user.first_name or user.last_name else user.email
                # Jeśli brak avatara, ustawiamy domyślną ścieżkę.
                user_avatar = user.avatar_path if user.avatar_path else url_for('static', filename='images/avatars/default_avatars/avatar1.svg')
            
                # DODAJ informacje o sesji
                session_info = {}
                try:
                    session_token = session.get('user_session_token')
                    if session_token:
                        user_session = UserSession.query.filter_by(
                            session_token=session_token,
                            is_active=True
                        ).first()
                    
                        if user_session:
                            session_info = {
                                'session_duration': user_session.get_session_duration(),
                                'last_activity': user_session.get_relative_time(),
                                'current_page': user_session.get_page_display_name()
                            }
                except Exception as e:
                    current_app.logger.debug(f"[Context] Błąd pobierania info sesji: {e}")
            
                return dict(
                    user_name=user_name, 
                    user_avatar=user_avatar, 
                    user_email=user.email,
                    user=user,  # Dodaj cały obiekt user
                    user_session=session_info
                )
    
        # Domyślne wartości, gdy nie ma zalogowanego użytkownika.
        return dict(
            user_name="Dzielny człowieku!", 
            user_avatar=url_for('static', filename='images/avatars/default_avatars/avatar1.svg'),
            user=None,
            user_session={}
        )

    @app.route('/debug/session-info')
    @login_required
    def debug_session_info():
        """
        Debug endpoint - informacje o sesji (tylko w trybie DEBUG)
        """
        if not current_app.config.get('DEBUG'):
            return "Debug mode wyłączony", 404
    
        try:
            user_id = session.get('user_id')
            session_token = session.get('user_session_token')
        
            session_data = {
                'flask_session': dict(session),
                'user_id': user_id,
                'session_token': session_token[:8] + '...' if session_token else None
            }
        
            if session_token:
                user_session = UserSession.query.filter_by(
                    session_token=session_token
                ).first()
            
                if user_session:
                    session_data['user_session'] = user_session.to_dict()
        
            return jsonify(session_data)
        
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/update_password', methods=['POST'])
    @login_required
    def update_password():
        user_email = session.get('user_email')
        user = User.query.filter_by(email=user_email).first()
        if not user:
            flash("Błąd: użytkownik nie znaleziony.", "error")
            return redirect(url_for('settings'))

        old_pass = request.form.get('old_password')
        new_pass = request.form.get('new_password')
        confirm_pass = request.form.get('confirm_password')

        # Sprawdź stare hasło
        if not check_password_hash(user.password, old_pass):
            flash("Stare hasło jest niepoprawne.", "error")
            return redirect(url_for('settings'))

        # Sprawdź czy nowe hasła są identyczne
        if new_pass != confirm_pass:
            flash("Nowe hasła nie są identyczne.", "error")
            return redirect(url_for('settings'))

        # Zaktualizuj
        user.password = generate_password_hash(new_pass)
        db.session.commit()

        flash("Hasło zostało zmienione.", "success")
        return redirect(url_for('settings'))

    @app.route('/update_avatar', methods=['POST'])
    @login_required
    def update_avatar():
        user_email = session.get('user_email')
        user = User.query.filter_by(email=user_email).first()
        if not user:
            flash("Błąd: użytkownik nie znaleziony.", "error")
            return redirect(url_for('settings'))
    
        default_avatar = request.form.get('default_avatar')
        avatar_file = request.files.get('avatar_file')
    
        # Obsługa wybrania predefiniowanego avatara
        if default_avatar:
            # Zakładamy, że predefiniowane avatary są w folderze /static/images/avatars/default_avatars
            user.avatar_path = f"static/images/avatars/{default_avatar}"
        elif avatar_file and avatar_file.filename != "":
            # Zapisujemy wgrany plik do folderu /static/images/avatars/users_avatars
            import os
            filename = avatar_file.filename
            save_path = os.path.join("static", "images", "avatars", "users_avatars", filename)
            avatar_file.save(save_path)
            user.avatar_path = f"/static/images/avatars/users_avatars/{filename}"
        else:
            flash("Nie wybrano żadnego avatara.", "error")
            return redirect(url_for('settings'))
    
        db.session.commit()
        flash("Avatar został zaktualizowany.", "success")
        return redirect(url_for('settings'))

    @app.route("/edit_user/<int:user_id>", methods=["GET", "POST"])
    @login_required
    def edit_user(user_id):
        # 1. Sprawdź, czy zalogowany jest admin
        current_email = session.get('user_email')
        current_user = User.query.filter_by(email=current_email).first()
        if current_user.role != 'admin':
            flash("Brak uprawnień.", "error")
            return redirect(url_for('dashboard'))
    
        # 2. Pobierz użytkownika do edycji
        user_to_edit = User.query.get_or_404(user_id)
    
        if request.method == "GET":
            # Wyświetl formularz edycji (np. roli)
            return render_template("edit_user.html", user=user_to_edit)
        else:
            # POST – aktualizacja roli
            new_role = request.form.get('role')
            user_to_edit.role = new_role
            db.session.commit()
            flash("Zaktualizowano dane użytkownika.", "success")
            return redirect(url_for('settings'))


    @app.route("/deactivate_user/<int:user_id>", methods=["POST"])
    @login_required
    def deactivate_user(user_id):
        current_email = session.get('user_email')
        current_user = User.query.filter_by(email=current_email).first()
        if current_user.role != 'admin':
            flash("Brak uprawnień.", "error")
            return redirect(url_for('dashboard'))

        user_to_edit = User.query.get_or_404(user_id)
        user_to_edit.active = False
        db.session.commit()
        flash("Użytkownik został dezaktywowany.", "info")
        return redirect(url_for('settings'))


    @app.route("/activate_user/<int:user_id>", methods=["POST"])
    @login_required
    def activate_user(user_id):
        current_email = session.get('user_email')
        current_user = User.query.filter_by(email=current_email).first()
        if current_user.role != 'admin':
            flash("Brak uprawnień.", "error")
            return redirect(url_for('dashboard'))

        user_to_edit = User.query.get_or_404(user_id)
        user_to_edit.active = True
        db.session.commit()
        flash("Użytkownik został aktywowany.", "success")
        return redirect(url_for('settings'))

    @app.route("/edit_user_modal", methods=["POST"])
    @login_required
    def edit_user_modal():
        current_email = session.get('user_email')
        current_user = User.query.filter_by(email=current_email).first()
        if current_user.role != 'admin':
            flash("Brak uprawnień.", "error")
            return redirect(url_for("dashboard"))

        user_id = request.form.get('user_id')
        first_name = request.form.get('first_name')
        last_name = request.form.get('last_name')
        role = request.form.get('role')
        email = request.form.get('email')

        user_to_edit = User.query.get_or_404(user_id)
        user_to_edit.first_name = first_name
        user_to_edit.last_name = last_name
        user_to_edit.role = role
        user_to_edit.email = email  # pamiętaj o obsłudze unikalności, jeśli konieczne
        db.session.commit()

        flash("Zaktualizowano dane użytkownika.", "success")
        return redirect(url_for('settings'))

    @app.route('/delete_user/<int:user_id>', methods=["POST"])
    @login_required
    def delete_user(user_id):
        current_email = session.get('user_email')
        current_user = User.query.filter_by(email=current_email).first()
        if current_user.role != 'admin':
            flash("Brak uprawnień.", "error")
            return redirect(url_for('dashboard'))
    
        user_to_delete = User.query.get_or_404(user_id)
    
        # Usuwamy powiązane zaproszenia, jeśli istnieją
        Invitation.query.filter_by(email=user_to_delete.email).delete()
    
        db.session.delete(user_to_delete)
        db.session.commit()
    
        flash("Użytkownik został usunięty.", "success")
        return redirect(url_for('settings'))

    # -------------------------
    # RESET HASŁA
    # -------------------------
    @app.route('/reset_password', methods=['GET', 'POST'])
    def reset_password_request():
        if request.method == 'POST':
            email = request.form.get('email')
            user = User.query.filter_by(email=email).first()
            if user:
                token = generate_reset_token(email, app.secret_key)
                user.reset_token = token
                db.session.commit()

                reset_link = url_for('reset_password_token', token=token, _external=True)
                html_body = render_template('reset_password_email_template.html', reset_link=reset_link)
            
                msg = Message("Resetowanie hasła CRM WoodPower",
                              sender=app.config.get("MAIL_USERNAME"),
                              recipients=[email])
                msg.html = html_body
                mail.send(msg)
            
                flash("Sprawdź swój email – link do resetowania hasła został wysłany.", "info")
                return redirect(url_for('reset_password_success'))
            else:
                email_error = "Ten mail nie występuje w bazie danych."
                return render_template("reset_password_request.html", email_value=email, email_error=email_error)
        email_value = request.args.get('email_value', '')
        return render_template("reset_password_request.html", email_value=email_value)

    @app.route('/reset_password_success')
    def reset_password_success():
        return render_template("reset_password_success.html")

    @app.route('/reset_password/<token>', methods=['GET', 'POST'])
    def reset_password_token(token):
        email = verify_reset_token(token, app.secret_key)
        if not email:
            return render_template("reset_password_expired.html")
    
        user = User.query.filter_by(email=email).first()
        if not user or user.reset_token != token:
            return render_template("reset_password_expired.html")
    
        if request.method == 'POST':
            new_password = request.form.get('new_password')
            repeat_password = request.form.get('repeat_password')

            if not new_password or not repeat_password:
                flash("Wprowadź oba pola hasła.", "error")
                return render_template("reset_password_form.html", token=token)
            if new_password != repeat_password:
                flash("Hasła muszą być identyczne.", "error")
                return render_template("reset_password_form.html", token=token)

            user.password = generate_password_hash(new_password)
            user.reset_token = None
            db.session.commit()
            return render_template("reset_password_complete.html")
    
        return render_template("reset_password_form.html", token=token)

    @app.errorhandler(ResourceClosedError)
    def handle_resource_closed_error(e):
        db.session.rollback()
        
        # NOWE strukturalne logowanie:
        error_logger = get_structured_logger('app.errors')
        error_logger.error("ResourceClosedError occurred", 
                          error=str(e), 
                          error_type='ResourceClosedError')
        
        # ZOSTAW STARE:
        current_app.logger.error("ResourceClosedError – rollback wykonany")
        return render_template("error.html", message="Problem z bazą danych. Spróbuj ponownie."), 500

    @app.errorhandler(OperationalError)
    def handle_operational_error(e):
        db.session.rollback()
        
        # NOWE strukturalne logowanie:
        error_logger = get_structured_logger('app.errors')
        error_logger.error("OperationalError occurred", 
                          error=str(e), 
                          error_type='OperationalError')
        
        # ZOSTAW STARE:
        current_app.logger.error("OperationalError – rollback wykonany")
        return render_template("error.html", message="Problem z bazą danych. Spróbuj za chwilę."), 500

    @app.teardown_appcontext
    def shutdown_session(exception=None):
        if exception:
            # NOWE strukturalne logowanie:
            error_logger = get_structured_logger('app.teardown')
            error_logger.error("Teardown exception occurred", 
                              error=str(exception), 
                              error_type=type(exception).__name__)
            
            # ZOSTAW STARE:
            current_app.logger.error(f"Teardown exception: {exception}")
            db.session.rollback()
        db.session.remove()

    # Konfiguracja nowego systemu logowania
    AppLogger.setup()
    app_logger = get_structured_logger('main')
    app_logger.info("Aplikacja Flask została uruchomiona")

    # Logi debug aplikacji
    app_logger.info("Flask app created", app_info=str(app))

    # Sprawdź zarejestrowane blueprinty
    blueprints = list(app.blueprints.keys())
    app_logger.debug("Registered blueprints", blueprints_count=len(blueprints), blueprints=blueprints)

    # Sprawdź routy związane z wycenami
    wycena_routes = []
    for rule in app.url_map.iter_rules():
        if 'wycena' in str(rule.rule) or 'quotes' in str(rule.endpoint):
            wycena_routes.append({
                'rule': str(rule.rule),
                'endpoint': rule.endpoint,
                'methods': list(rule.methods)
            })

    if wycena_routes:
        app_logger.debug("Wycena routes registered", routes_count=len(wycena_routes))

    # Inicjalizacja schedulera (na końcu po wszystkich konfiguracjach)
    if not app.config.get('TESTING', False):
        initialize_scheduler_safely(app)

    return app

def sprawdz_w_bazie(email, password):
    user = User.query.filter_by(email=email).first()
    if not user or not user.active:
        return False
    return check_password_hash(user.password, password)

app = create_app()

if __name__ == "__main__":
    app.run(debug=False)