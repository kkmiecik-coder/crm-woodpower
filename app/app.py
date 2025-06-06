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
from modules.calculator import calculator_bp
from extensions import db, mail
from modules.calculator.models import User, Invitation, Price, Multiplier
from modules.clients import clients_bp
import logging
from modules.public_calculator import public_calculator_bp
from modules.analytics.routers import analytics_bp
from modules.quotes.routers import quotes_bp
from sqlalchemy.exc import ResourceClosedError, OperationalError

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

    @app.before_request
    def extend_session():
        session.permanent = True

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

    # -------------------------
    #         ROUTES
    # -------------------------
    @app.route("/")
    def index():
        return redirect(url_for("login"))

    from datetime import timedelta
    app.permanent_session_lifetime = timedelta(minutes=120)

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
            session['user_id'] = user.id  # <-- TO JEST NOWE
            session.permanent = True
            return redirect(url_for("dashboard"))

        return render_template("login.html")

    @app.route("/dashboard")
    @login_required
    def dashboard():
        user_email = session.get('user_email')
        return render_template("dashboard/dashboard.html", user_email=user_email)

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
    def logged_out():
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

            # Utworzenie wiadomości email – wysyłamy na admin@woodpower.pl
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
                                    problem_description=problem_description)

            # Dołączenie przesłanych załączników
            for attachment_name in ['attachment1', 'attachment2', 'attachment3']:
                attachment = request.files.get(attachment_name)
                if attachment and attachment.filename:
                    msg.attach(attachment.filename, attachment.content_type, attachment.read())

            # Wysłanie maila
            mail.send(msg)

            # Flash – komunikat o sukcesie
            flash("Wiadomość wysłana, odpowiemy najszybciej jak to będzie możliwe.", "issue_success")
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
            return render_template("settings_page/admin_settings.html",
                                   users_list=all_users,
                                   prices=all_prices,
                                   multipliers=multipliers)
        else:
            return render_template("settings_page/user_settings.html")
        
    import logging

    # Konfiguracja logowania na początku app.py
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('flask_debug.log'),
            logging.StreamHandler(sys.stdout)
        ]
    )

    @app.route("/settings/prices", methods=["GET", "POST"])
    @login_required
    def admin_prices():
        logging.info("Wejście do endpointu /settings/prices")
        
        # 1. Sprawdź, czy zalogowany jest admin (jeśli masz mechanizm roli)
        current_email = session.get('user_email')
        logging.debug("Aktualny email: %s", current_email)
        current_user = User.query.filter_by(email=current_email).first()
        logging.debug("Pobrany użytkownik: %s", current_user)
        
        if not current_user or current_user.role != 'admin':
            logging.warning("Brak uprawnień dla użytkownika: %s", current_email)
            flash("Brak uprawnień. Tylko administrator może edytować cennik.", "error")
            return redirect(url_for('settings'))  # lub dashboard

        # 2A. Obsługa zapisu (POST)
        if request.method == "POST":
            logging.info("Otrzymano żądanie POST. Rozpoczynam aktualizację cennika.")
            all_prices = Price.query.all()
            logging.debug("Pobrano %d rekordów z tabeli prices", len(all_prices))
            
            # Dla każdego rekordu w bazie:
            for price_record in all_prices:
                prefix = f"price_{price_record.id}_"
                logging.debug("Przetwarzanie rekordu ID: %s (prefix: %s)", price_record.id, prefix)
                
                # Odczytujemy wartości z formularza i zamieniamy przecinek na kropkę
                new_thickness_min = request.form.get(prefix + "thickness_min", "").replace(",", ".")
                new_thickness_max = request.form.get(prefix + "thickness_max", "").replace(",", ".")
                new_length_min = request.form.get(prefix + "length_min", "").replace(",", ".")
                new_length_max = request.form.get(prefix + "length_max", "").replace(",", ".")
                new_price_per_m3 = request.form.get(prefix + "price_per_m3", "").replace(",", ".")
                
                logging.debug("Dane wejściowe dla rekordu ID %s: thickness_min=%s, thickness_max=%s, length_min=%s, length_max=%s, price_per_m3=%s",
                            price_record.id, new_thickness_min, new_thickness_max, new_length_min, new_length_max, new_price_per_m3)
                try:
                    # Konwersja na float/int
                    thickness_min_val = float(new_thickness_min)
                    thickness_max_val = float(new_thickness_max)
                    length_min_val = int(float(new_length_min))
                    length_max_val = int(float(new_length_max))
                    price_per_m3_val = float(new_price_per_m3)
                    
                    logging.debug("Skonwertowane wartości dla rekordu ID %s: thickness_min=%s, thickness_max=%s, length_min=%s, length_max=%s, price_per_m3=%s",
                                price_record.id, thickness_min_val, thickness_max_val, length_min_val, length_max_val, price_per_m3_val)
                    
                    # Sprawdzenie, czy wartości nie są ujemne:
                    if thickness_min_val < 0 or thickness_max_val < 0 or length_min_val < 0 or length_max_val < 0 or price_per_m3_val < 0:
                        logging.error("Wprowadzono ujemne wartości dla rekordu ID %s", price_record.id)
                        flash(f"Nie można wprowadzić ujemnych wartości (ID: {price_record.id}).", "error")
                        return redirect(url_for('admin_prices'))
                    
                    # Aktualizacja rekordu
                    price_record.thickness_min = thickness_min_val
                    price_record.thickness_max = thickness_max_val
                    price_record.length_min = length_min_val
                    price_record.length_max = length_max_val
                    price_record.price_per_m3 = price_per_m3_val
                    logging.info("Zaktualizowano rekord ID %s", price_record.id)
                    
                except ValueError:
                    logging.exception("Błąd konwersji wartości liczbowych przy rekordzie ID %s", price_record.id)
                    flash(f"Błąd konwersji wartości liczbowych przy rekordzie ID {price_record.id}.", "error")
                    return redirect(url_for('admin_prices'))
            
            # Po zaktualizowaniu wszystkich rekordów
            db.session.commit()
            logging.info("Pomyślnie zaktualizowano cennik. Dane zapisane do bazy.")
            flash("Pomyślnie zaktualizowano cennik.", "success")
            return redirect(url_for('admin_prices'))
        
        # 2B. Obsługa GET – wyświetlenie
        logging.info("Obsługa żądania GET – wyświetlam stronę z cennikiem.")
        all_prices = Price.query.order_by(Price.species, Price.wood_class).all()
        logging.debug("Dla widoku GET pobrano %d rekordów", len(all_prices))
        return render_template("settings_page/admin_settings.html", prices=all_prices)

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
                return dict(user_name=user_name, user_avatar=user_avatar, user_email=user.email)
        # Domyślne wartości, gdy nie ma zalogowanego użytkownika.
        return dict(user_name="Dzielny człowieku!", user_avatar=url_for('static', filename='images/avatars/default_avatars/avatar1.svg'))


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
        current_app.logger.error("ResourceClosedError – rollback wykonany")
        return render_template("error.html", message="Błąd połączenia z bazą. Spróbuj ponownie."), 500

    @app.errorhandler(OperationalError)
    def handle_operational_error(e):
        db.session.rollback()
        current_app.logger.error("OperationalError – rollback wykonany")
        return render_template("error.html", message="Problem z bazą danych. Spróbuj za chwilę."), 500

    @app.teardown_appcontext
    def shutdown_session(exception=None):
        if exception:
            current_app.logger.error(f"Teardown exception: {exception}")
            db.session.rollback()
        db.session.remove()

    # Konfiguracja loggera – warto przed returnem, by działał globalnie
    if not app.logger.handlers:
        file_handler = logging.FileHandler("stderr.log", encoding="utf-8")
        file_handler.setLevel(logging.DEBUG)
        formatter = logging.Formatter("%(asctime)s %(levelname)s: %(message)s")
        file_handler.setFormatter(formatter)
        app.logger.addHandler(file_handler)

    # LOGI DEBUG na końcu create_app()
    print("=== FLASK APP DEBUG ===", file=sys.stderr)
    print(f"Flask app created: {app}", file=sys.stderr)
    
    # Sprawdź zarejestrowane blueprinty
    print("=== REGISTERED BLUEPRINTS ===", file=sys.stderr)
    for name, blueprint in app.blueprints.items():
        print(f"Blueprint: {name} -> {blueprint}", file=sys.stderr)
    
    # Sprawdź routy związane z wycenami
    print("=== WYCENA ROUTES ===", file=sys.stderr)
    for rule in app.url_map.iter_rules():
        if 'wycena' in str(rule.rule) or 'quotes' in str(rule.endpoint):
            print(f"Route: {rule.rule} -> {rule.endpoint} [{', '.join(rule.methods)}]", file=sys.stderr)

    return app

def sprawdz_w_bazie(email, password):
    user = User.query.filter_by(email=email).first()
    if not user or not user.active:
        return False
    return check_password_hash(user.password, password)

app = create_app()

if __name__ == "__main__":
    app.run(debug=False)