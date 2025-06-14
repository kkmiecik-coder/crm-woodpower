# modules/quotes/routers.py
from flask import render_template, jsonify, request, make_response, current_app, send_file, Blueprint, session, redirect, url_for, flash
from . import quotes_bp
from modules.calculator.models import Quote, User, QuoteItemDetails, QuoteItem, QuoteLog
from modules.quotes.models import QuoteStatus, DiscountReason
from modules.clients.models import Client
from modules.baselinker.service import BaselinkerService
from modules.baselinker.models import BaselinkerConfig
from extensions import db, mail
from weasyprint import HTML
from io import BytesIO
from flask_mail import Message
from functools import wraps
import logging
import sys
from sqlalchemy.orm import joinedload
from sqlalchemy import func
import re
from datetime import datetime
import base64
import os

def render_client_error(error_type, error_code=None, error_message=None, error_details=None, quote_number=None):
    return render_template(
        'quotes/templates/client_error.html',
        error_type=error_type,
        error_code=error_code,
        error_message=error_message,
        error_details=error_details,
        quote_number=quote_number
    ), error_code or 400

def calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto):
    VAT_RATE = 0.23
    
    # Produkty surowe
    products_brutto = cost_products_netto * (1 + VAT_RATE)
    
    # Wykończenie
    finishing_brutto = cost_finishing_netto * (1 + VAT_RATE)
    
    # Wysyłka - konwersja z brutto na netto
    shipping_netto = cost_shipping_brutto / (1 + VAT_RATE)
    
    # Suma
    total_netto = cost_products_netto + cost_finishing_netto + shipping_netto
    total_brutto = products_brutto + finishing_brutto + cost_shipping_brutto
    
    return {
        'products': {
            'netto': round(cost_products_netto, 2),
            'brutto': round(products_brutto, 2)
        },
        'finishing': {
            'netto': round(cost_finishing_netto, 2),
            'brutto': round(finishing_brutto, 2)
        },
        'shipping': {
            'netto': round(shipping_netto, 2),
            'brutto': round(cost_shipping_brutto, 2)
        },
        'total': {
            'netto': round(total_netto, 2),
            'brutto': round(total_brutto, 2)
        }
    }

def login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            flash("Twoja sesja wygasla. Zaloguj się ponownie.", "info")
            return redirect(url_for('login'))
        return func(*args, **kwargs)
    return wrapper

def validate_email_or_phone(email_or_phone, quote):
    """Waliduje czy podany email lub telefon pasuje do wyceny"""
    if not email_or_phone:
        return False
    
    client = quote.client
    if not client:
        return False
    
    # Sprawdź email
    if '@' in email_or_phone:
        return client.email and client.email.lower() == email_or_phone.lower()
    
    # Sprawdź telefon (usuń wszystkie znaki poza cyframi i porównaj)
    phone_digits = re.sub(r'[^\d]', '', email_or_phone)
    client_phone_digits = re.sub(r'[^\d]', '', client.phone) if client.phone else ''
    
    return len(phone_digits) >= 7 and phone_digits in client_phone_digits

@quotes_bp.route('/')
@login_required
def quotes_home():
    print("[quotes_home] routing wywolany", file=sys.stderr)
    
    # AUTOMATYCZNA SYNCHRONIZACJA BASELINKER CONFIG
    try:
        # Sprawdź czy mamy już dane konfiguracyjne
        config_count = BaselinkerConfig.query.count()
        print(f"[quotes_home] Znaleziono {config_count} rekordów konfiguracji Baselinker", file=sys.stderr)
        
        # Jeśli brak konfiguracji lub jest stara (np. > 24h), zsynchronizuj
        if config_count == 0:
            print("[quotes_home] Brak konfiguracji Baselinker - rozpoczynam synchronizację", file=sys.stderr)
            
            # Sprawdź czy mamy konfigurację API
            api_config = current_app.config.get('API_BASELINKER')
            if api_config and api_config.get('api_key'):
                try:
                    service = BaselinkerService()
                    
                    # Synchronizuj źródła zamówień
                    sources_synced = service.sync_order_sources()
                    print(f"[quotes_home] Synchronizacja źródeł: {'OK' if sources_synced else 'BŁĄD'}", file=sys.stderr)
                    
                    # Synchronizuj statusy zamówień  
                    statuses_synced = service.sync_order_statuses()
                    print(f"[quotes_home] Synchronizacja statusów: {'OK' if statuses_synced else 'BŁĄD'}", file=sys.stderr)
                    
                    if sources_synced and statuses_synced:
                        print("[quotes_home] Synchronizacja Baselinker zakończona pomyślnie", file=sys.stderr)
                    else:
                        print("[quotes_home] Synchronizacja Baselinker częściowo nieudana", file=sys.stderr)
                        
                except Exception as e:
                    print(f"[quotes_home] Błąd synchronizacji Baselinker: {e}", file=sys.stderr)
            else:
                print("[quotes_home] Brak konfiguracji API Baselinker - pomijam synchronizację", file=sys.stderr)
        else:
            print("[quotes_home] Konfiguracja Baselinker już istnieje - pomijam synchronizację", file=sys.stderr)
            
    except Exception as e:
        print(f"[quotes_home] Błąd podczas sprawdzania konfiguracji Baselinker: {e}", file=sys.stderr)
    
    return render_template('quotes/templates/quotes.html')

@quotes_bp.route('/api/quotes')
@login_required
def api_quotes():
    print("[api_quotes] Endpoint wywolany", file=sys.stderr)

    try:
        # Mapa statusów
        statuses = {
            s.name: {"name": s.name, "color": s.color_hex}
            for s in QuoteStatus.query.all()
        }
        print(f"[api_quotes] Zaladowano {len(statuses)} statusow", file=sys.stderr)

        quotes = Quote.query.order_by(Quote.created_at.desc()).all()
        print(f"[api_quotes] Zaladowano {len(quotes)} wycen", file=sys.stderr)

        results = []
        for q in quotes:
            client = q.client
            user = q.user
            status_data = statuses.get(q.quote_status.name if q.quote_status else None, {})

            result = {
                "id": q.id,
                "quote_number": q.quote_number,
                "created_at": q.created_at.isoformat() if q.created_at else None,
                "client_number": client.client_number if client else None,
                "client_name": client.client_name if client else None,
                "user_id": user.id if user else None,
                "user_name": f"{user.first_name} {user.last_name}" if user else None,
                "source": q.source,
                "status_id": q.status_id,
                "status_name": status_data.get("name", ""),
                "status_color": status_data.get("color", "#ccc"),
                "all_statuses": statuses,
                "public_url": q.get_public_url(),
                "base_linker_order_id": q.base_linker_order_id,
                # DODANE: public_token do pobierania PDF
                "public_token": q.public_token
            }
            results.append(result)

        print(f"[api_quotes] Zwracamy {len(results)} wyników", file=sys.stderr)
        return jsonify(results)

    except Exception as e:
        print(f"[api_quotes] Błąd: {str(e)}", file=sys.stderr)
        return jsonify({"error": "Wystapil blad serwera"}), 500

@quotes_bp.route('/api/quotes/<int:quote_id>/status', methods=['PATCH'])
@login_required
def update_quote_status(quote_id):
    try:
        data = request.get_json()
        status_id = data.get("status_id")

        if not status_id:
            return jsonify({"error": "Brak status_id w żądaniu"}), 400

        quote = Quote.query.get_or_404(quote_id)
        new_status = QuoteStatus.query.get_or_404(status_id)

        quote.status_id = new_status.id
        db.session.commit()

        print(f"[update_quote_status] Zmieniono status wyceny {quote_id} na {status_id}", file=sys.stderr)
        return jsonify({"message": "Status updated successfully", "new_status": new_status.name})

    except Exception as e:
        print(f"[update_quote_status] Błąd: {str(e)}", file=sys.stderr)
        return jsonify({"error": "Błąd podczas aktualizacji statusu"}), 500

@quotes_bp.route("/api/quotes/<token>/pdf.<format>", methods=["GET"])
def generate_quote_pdf(token, format):
    print(f"[generate_quote_pdf] START -> format={format}, TOKEN={token}", file=sys.stderr)
    
    try:
        if format not in ["pdf", "png"]:
            print(f"[generate_quote_pdf] Unsupported format: {format}", file=sys.stderr)
            return {"error": "Unsupported format"}, 400

        # ZMIANA: Wyszukiwanie po tokenie zamiast ID
        quote = Quote.query.filter_by(public_token=token).first()
        if not quote:
            print(f"[generate_quote_pdf] Brak wyceny dla tokenu: {token}", file=sys.stderr)
            return {"error": "Quote not found"}, 404

        print(f"[generate_quote_pdf] Quote found: {quote.quote_number} (ID: {quote.id})", file=sys.stderr)

        # DODAJ DEBUGGING - sprawdź dane wyceny
        print(f"[DEBUG] Quote data:", file=sys.stderr)
        print(f"  - client_id: {quote.client_id}", file=sys.stderr)
        print(f"  - user_id: {quote.user_id}", file=sys.stderr)
        print(f"  - status_id: {quote.status_id}", file=sys.stderr)
        
        # Wczytaj powiązane dane
        quote.client = Client.query.get(quote.client_id) if quote.client_id else None
        quote.user = User.query.get(quote.user_id) if quote.user_id else None  
        
        print(f"[DEBUG] Related data loaded:", file=sys.stderr)
        print(f"  - client: {quote.client.client_name if quote.client else 'None'}", file=sys.stderr)
        print(f"  - user: {f'{quote.user.first_name} {quote.user.last_name}' if quote.user else 'None'}", file=sys.stderr)
        print(f"  - status: {quote.quote_status.name if quote.quote_status else 'None'}", file=sys.stderr)

        # KLUCZOWE: Oblicz koszty (tak jak w send_email i get_client_quote_data)
        selected_items = [item for item in quote.items if item.is_selected]
        finishing_details = db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()
        
        cost_products_netto = round(sum(item.get_total_price_netto() for item in selected_items), 2)
        cost_finishing_netto = round(sum(d.finishing_price_netto or 0.0 for d in finishing_details), 2)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0.0
        
        # Użyj funkcji calculate_costs_with_vat
        costs = calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto)
        
        print(f"[DEBUG] Calculated costs:", file=sys.stderr)
        print(f"  - products_netto: {costs['products']['netto']}", file=sys.stderr)
        print(f"  - total_brutto: {costs['total']['brutto']}", file=sys.stderr)

        # Funkcja pomocnicza do ładowania ikon
        def load_icon_as_base64(icon_name):
            try:
                # Opcja 1: Bezwzględna ścieżka od root aplikacji
                icons_path = os.path.join(
                    current_app.root_path,  # app/
                    'modules', 'quotes', 'static', 'img', icon_name
                )
                print(f"[PDF] Trying to load icon: {icons_path}", file=sys.stderr)
                
                if os.path.exists(icons_path):
                    with open(icons_path, 'rb') as icon_file:
                        icon_data = base64.b64encode(icon_file.read()).decode('utf-8')
                    
                    ext = icon_name.split('.')[-1].lower()
                    mime_type = 'image/png' if ext == 'png' else 'image/svg+xml' if ext == 'svg' else 'image/jpeg'
                    
                    return f"data:{mime_type};base64,{icon_data}"
                else:
                    print(f"[PDF] Icon not found: {icons_path}", file=sys.stderr)
                    return None
            except Exception as e:
                print(f"[PDF] Error loading icon {icon_name}: {e}", file=sys.stderr)
                return None

        # Załaduj wszystkie ikony
        icons = {
            'logo': load_icon_as_base64('logo.png'),
            'phone': load_icon_as_base64('phone.png'),
            'email': load_icon_as_base64('email.png'),
            'location': load_icon_as_base64('location.png'),
            'website': load_icon_as_base64('website.png'),
            'instagram': load_icon_as_base64('instagram.png'),
            'facebook': load_icon_as_base64('facebook.png'),
        }
        
        print(f"[PDF] Loaded icons: {[k for k, v in icons.items() if v is not None]}", file=sys.stderr)

        # KLUCZOWE: Dodaj koszty do obiektu quote lub przekaż jako osobny parametr
        quote.costs = costs  # Dodaj koszty do obiektu quote

        quote.finishing = finishing_details
        
        # Renderuj template z wszystkimi potrzebnymi danymi
        html_out = render_template("quotes/templates/offer_pdf.html", 
                                 quote=quote, 
                                 client=quote.client,
                                 user=quote.user,
                                 status=quote.quote_status,
                                 costs=costs,  # Przekaż też jako osobny parametr
                                 selected_items=selected_items,  # Dodaj selected_items
                                 finishing_details=finishing_details,  # Dodaj finishing_details
                                 icons=icons)
        
        print(f"[PDF] HTML rendered, length: {len(html_out)}", file=sys.stderr)
        
        # Utwórz HTML object z base_url dla względnych ścieżek
        html = HTML(string=html_out, base_url=request.url_root)
        out = BytesIO()

        if format == "pdf":
            html.write_pdf(out)
            content_type = "application/pdf"
        else:
            html.write_png(out)
            content_type = "image/png"

        out.seek(0)
        filename = f"Oferta_{quote.quote_number}.{format}"
        print(f"[generate_quote_pdf] Zwracamy plik: {filename}", file=sys.stderr)

        return make_response(out.read(), 200, {
            "Content-Type": content_type,
            "Content-Disposition": f"inline; filename=\"{filename}\""
        })

    except Exception as e:
        print(f"[generate_quote_pdf] Blad renderowania PDF: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {"error": "Render error"}, 500

@quotes_bp.route("/api/quotes/<int:quote_id>/send_email", methods=["POST"])
@login_required
def send_email(quote_id):
    print(f"[send_email] Wysylka maila dla wyceny ID {quote_id}", file=sys.stderr)

    data = request.get_json()
    recipient_email = data.get("email")
    print(f"[send_email] Do: {recipient_email}", file=sys.stderr)

    quote = db.session.get(Quote, quote_id)
    if not quote:
        return jsonify({"error": "Quote not found"}), 404

    client = db.session.get(Client, quote.client_id)
    user = db.session.get(User, quote.user_id)
    status = db.session.get(QuoteStatus, quote.status_id)

    # POPRAWKA: Dodaj brakujące dane tak jak w generate_quote_pdf
    # Pobierz wybrane produkty
    selected_items = [item for item in quote.items if item.is_selected]
    
    # Oblicz koszty
    cost_products_netto = round(sum(i.get_total_price_netto or 0 for i in selected_items), 2)
    cost_finishing_netto = round(sum(d.finishing_price_netto or 0.0 for d in db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()), 2)
    cost_shipping_brutto = quote.shipping_cost_brutto or 0.0
    costs = calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto)
    
    # Pobierz detale wykończenia
    finishing_details = db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()
    
    # Załaduj ikony (opcjonalnie - można pominąć dla emaili)
    icons = {}  # Można dodać ikony jeśli potrzebne

    # POPRAWKA: Renderuj z wszystkimi potrzebnymi parametrami
    rendered = render_template("quotes/templates/offer_pdf.html", 
                              quote=quote, 
                              client=client, 
                              user=user, 
                              status=status,
                              costs=costs,  # ✅ Dodane
                              selected_items=selected_items,  # ✅ Dodane
                              finishing_details=finishing_details,  # ✅ Dodane
                              icons=icons)  # ✅ Dodane
    
    pdf_file = BytesIO()
    HTML(string=rendered).write_pdf(pdf_file)
    pdf_file.seek(0)

    msg = Message(subject=f"Wycena {quote.quote_number}",
                  sender=current_app.config['MAIL_USERNAME'],
                  recipients=[recipient_email])
    msg.body = f"Czesc, w zalczniku znajdziesz wycenę nr {quote.quote_number}."
    msg.attach(f"Oferta_{quote.quote_number}.pdf", "application/pdf", pdf_file.read())

    try:
        mail.send(msg)
        print(f"[send_email] Email wyslany pomyslnie do {recipient_email}", file=sys.stderr)
        return jsonify({"success": True, "message": "Email wysłany pomyślnie"})
    except Exception as e:
        print(f"[send_email] Blad wysylki emaila: {str(e)}", file=sys.stderr)
        return jsonify({"error": "Błąd wysyłki emaila"}), 500

@quotes_bp.route('/api/quotes/status-counts')
@login_required
def api_quotes_status_counts():
    print("[api_quotes_status_counts] Endpoint wywolany", file=sys.stderr)

    try:
        # Wyciągamy wszystkie statusy
        statuses = QuoteStatus.query.all()

        # Wyciągamy county zgrupowane po status_id
        counts_raw = db.session.query(Quote.status_id, func.count(Quote.id))\
            .group_by(Quote.status_id).all()
        count_map = {status_id: count for status_id, count in counts_raw}

        # Składamy wynik
        counts = []
        for status in statuses:
            counts.append({
                "id": status.id,
                "name": status.name,
                "count": count_map.get(status.id, 0),
                "color": status.color_hex
            })

        return jsonify(sorted(counts, key=lambda s: s["id"]))

    except Exception as e:
        print(f"[api_quotes_status_counts] Blad: {str(e)}", file=sys.stderr)
        return jsonify({"error": "Wystapil blad serwera"}), 500

@quotes_bp.route("/api/users")
@login_required
def get_users():
    print("[api_users] Endpoint wywolany")
    users = User.query.filter_by(active=True).order_by(User.first_name).all()
    print(f"[api_users] Zaladowano {len(users)} uzytkownikow")
    return jsonify([
        {"id": user.id, "name": f"{user.first_name} {user.last_name}".strip()} for user in users
    ])

@quotes_bp.route("/api/quotes/<int:quote_id>")
@login_required
def get_quote_details(quote_id):
    print(f"[get_quote_details] Pobieranie szczegółów dla wyceny ID {quote_id}", file=sys.stderr)

    try:
        # POPRAWKA: Usuń joinedload(Quote.items) bo lazy='dynamic' nie obsługuje eager loading
        quote = db.session.query(Quote)\
            .options(
                joinedload(Quote.client),
                joinedload(Quote.user),
                joinedload(Quote.quote_status),
                joinedload(Quote.accepted_by_user)  # NOWA RELACJA
            )\
            .filter_by(id=quote_id).first()

        if not quote:
            return jsonify({"error": "Wycena nie znaleziona"}), 404

        # Pobierz szczegóły wykończenia
        finishing_details = db.session.query(QuoteItemDetails).filter_by(quote_id=quote_id).all()

        # POPRAWKA: Pobierz items osobno (ponieważ lazy='dynamic')
        quote_items = quote.items.all()  # .all() na dynamic relationship

        selected_items = [item for item in quote_items if item.is_selected]
        cost_products_netto = round(sum(item.get_total_price_netto() for item in selected_items), 2)
        cost_finishing_netto = round(sum(d.finishing_price_netto or 0.0 for d in finishing_details), 2)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0.0
        costs = calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto)

        # Pobierz wszystkie statusy
        all_statuses = QuoteStatus.query.all()

        # NOWA LOGIKA: Sprawdź czy akceptacja była przez użytkownika wewnętrznego
        accepted_by_user = None
        if (quote.accepted_by_user_id and 
            quote.accepted_by_email and 
            quote.accepted_by_email.startswith('internal_user_')):
            accepted_by_user = quote.accepted_by_user

        print(f"[get_quote_details] Wycena {quote.quote_number}, user akceptujący: {accepted_by_user.first_name if accepted_by_user else 'brak'}", file=sys.stderr)

        return jsonify({
            "id": quote.id,
            "quote_number": quote.quote_number,
            "created_at": quote.created_at.isoformat() if quote.created_at else None,
            "source": quote.source,
            "status_id": quote.status_id,
            "status_name": quote.quote_status.name if quote.quote_status else None,
            "acceptance_date": quote.acceptance_date.isoformat() if quote.acceptance_date else None,
            "accepted_by_email": quote.accepted_by_email,
            "is_client_editable": quote.is_client_editable,
            "base_linker_order_id": quote.base_linker_order_id,
            "public_url": quote.get_public_url(),

            # NOWE POLE: Informacje o użytkowniku akceptującym
            "accepted_by_user": {
                "id": accepted_by_user.id if accepted_by_user else None,
                "first_name": accepted_by_user.first_name if accepted_by_user else None,
                "last_name": accepted_by_user.last_name if accepted_by_user else None,
                "full_name": f"{accepted_by_user.first_name} {accepted_by_user.last_name}" if accepted_by_user else None
            } if accepted_by_user else None,
            
            # Informacje o mnożniku
            "quote_multiplier": float(quote.quote_multiplier) if quote.quote_multiplier else None,
            "quote_client_type": quote.quote_client_type,
            
            # Koszty
            "costs": costs,
            "cost_products": cost_products_netto,
            "cost_finishing": cost_finishing_netto,
            "cost_shipping": cost_shipping_brutto,
            "courier_name": quote.courier_name or "-",
            
            # Pozostałe pola
            "all_statuses": {s.name: {"name": s.name, "color": s.color_hex} for s in all_statuses},
            "finishing": [d.to_dict() if hasattr(d, 'to_dict') else {
                "product_index": d.product_index,
                "finishing_type": d.finishing_type,
                "finishing_variant": d.finishing_variant,
                "finishing_color": d.finishing_color,
                "finishing_gloss_level": d.finishing_gloss_level,
                "finishing_price_netto": float(d.finishing_price_netto) if d.finishing_price_netto else 0.0,
                "quantity": d.quantity or 1
            } for d in finishing_details],
            "client": {
                "id": quote.client.id if quote.client else None,
                "client_name": quote.client.client_name if quote.client else None,
                "client_number": quote.client.client_number if quote.client else None,
                "client_delivery_name": quote.client.client_delivery_name if quote.client else None,
                "company_name": quote.client.delivery_company if quote.client else None,
                "first_name": quote.client.client_number if quote.client else None,  # client_number zawiera imię i nazwisko
                "last_name": "",  # W bazie nie ma oddzielnych pól
                "email": quote.client.email if quote.client else None,
                "phone": quote.client.phone if quote.client else None
            },
            "user": {
                "id": quote.user.id if quote.user else None,
                "first_name": quote.user.first_name if quote.user else "",
                "last_name": quote.user.last_name if quote.user else ""
            },
            "items": [item.to_dict() for item in quote_items]
        })

    except Exception as e:
        print(f"[get_quote_details] Błąd podczas budowania JSON: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": "Błąd serwera"}), 500

@quotes_bp.route("/api/quote_items/<int:item_id>/select", methods=["PATCH"])
@login_required
def select_quote_item(item_id):
    try:
        item = QuoteItem.query.get_or_404(item_id)

        # Zresetuj wszystkie is_selected w tej grupie product_index
        QuoteItem.query.filter_by(quote_id=item.quote_id, product_index=item.product_index).update({QuoteItem.is_selected: False})

        # Ustaw nowy jako wybrany
        item.is_selected = True
        db.session.commit()

        print(f"[select_quote_item] Zmieniono wybrany wariant: ID {item_id}", file=sys.stderr)
        return jsonify({"message": "Wariant ustawiony jako wybrany"})

    except Exception as e:
        print(f"[select_quote_item] Błąd: {e}", file=sys.stderr)
        return jsonify({"error": "Błąd podczas wyboru wariantu"}), 500

@quotes_bp.route("/api/discount-reasons")
@login_required
def get_discount_reasons():
    """Zwraca listę aktywnych powodów rabatów"""
    try:
        reasons = DiscountReason.get_active_reasons_dict()
        return jsonify(reasons)
    except Exception as e:
        print(f"[get_discount_reasons] Błąd: {e}", file=sys.stderr)
        return jsonify({"error": "Błąd podczas pobierania powodów rabatów"}), 500

@quotes_bp.route("/api/quotes/<int:quote_id>/variant/<int:item_id>/discount", methods=["PATCH"])
@login_required
def update_variant_discount(quote_id, item_id):
    """Aktualizuje rabat dla pojedynczego wariantu"""
    try:
        data = request.get_json()
        discount_percentage = data.get("discount_percentage", 0)
        reason_id = data.get("reason_id")
        show_on_client_page = data.get("show_on_client_page", True)

        # Walidacja danych
        if not isinstance(discount_percentage, (int, float)) or discount_percentage < -100 or discount_percentage > 100:
            return jsonify({"error": "Rabat musi być liczbą między -100 a 100"}), 400

        item = QuoteItem.query.filter_by(id=item_id, quote_id=quote_id).first_or_404()
        
        # Zastosuj rabat
        item.apply_discount(discount_percentage, reason_id)
        item.show_on_client_page = show_on_client_page
        
        db.session.commit()
        
        print(f"[update_variant_discount] Zastosowano rabat {discount_percentage}% do wariantu {item_id}", file=sys.stderr)
        
        return jsonify({
            "message": "Rabat został zastosowany",
            "item": item.to_dict()
        })

    except Exception as e:
        print(f"[update_variant_discount] Błąd: {e}", file=sys.stderr)
        return jsonify({"error": "Błąd podczas aktualizacji rabatu"}), 500

@quotes_bp.route("/api/quotes/<int:quote_id>/apply-total-discount", methods=["PATCH"])
@login_required
def apply_total_discount(quote_id):
    """Zastosowuje rabat do wszystkich wariantów (nie tylko is_selected) w wycenie"""
    try:
        data = request.get_json()
        discount_percentage = data.get("discount_percentage", 0)
        reason_id = data.get("reason_id")
        include_finishing = data.get("include_finishing", False)

        # --- WALIDACJA RABATU ---
        if not isinstance(discount_percentage, (int, float)) or discount_percentage < -100 or discount_percentage > 100:
            return jsonify({"error": "Rabat musi być liczbą między -100 a 100"}), 400

        # --- POBIERAMY DANE WYceny ---
        quote = Quote.query.get_or_404(quote_id)

        # --- RABAT DO WSZYSTKICH WARIANTóW ---
        # W metodzie quote.apply_total_discount musi być już zmiana, która nie filtruje po is_selected,
        # tylko pobiera wszystkie QuoteItem z tej wyceny.
        affected_items = quote.apply_total_discount(discount_percentage, reason_id)

        # --- OPCJONALNY RABAT DO WYKOŃCZENIA ---
        if include_finishing and discount_percentage != 0:
            finishing_details = (
                db.session.query(QuoteItemDetails)
                .filter_by(quote_id=quote_id)
                .all()
            )
            for detail in finishing_details:
                if detail.finishing_price_netto is not None and detail.finishing_price_brutto is not None:
                    multiplier = 1 - (discount_percentage / 100)
                    detail.finishing_price_netto = detail.finishing_price_netto * multiplier
                    detail.finishing_price_brutto = detail.finishing_price_brutto * multiplier

        # --- ZAPIS DO BAZY ---
        db.session.commit()

        # --- ODPOWIEDŹ JSON ---
        return jsonify({
            "message": f"Rabat został zastosowany do {affected_items} pozycji",
            "affected_items": affected_items,
            "include_finishing": include_finishing,
            # Jeżeli masz w modelu metody get_total_discount_amount_netto / brutto, to możesz je tu zwrócić
            "total_discount_netto": quote.get_total_discount_amount_netto(),
            "total_discount_brutto": quote.get_total_discount_amount_brutto()
        }), 200

    except Exception as e:
        # loguj błąd na stderr i zwróć 500
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({"error": "Błąd podczas aktualizacji rabatu całkowitego"}), 500



@quotes_bp.route("/wycena/<path:quote_number>/<token>", methods=['GET'])
def client_quote_view(quote_number, token):
    """Publiczna strona wyceny dla klienta - z poprawioną obsługą stanów"""
    
    try:
        quote = Quote.query.filter_by(quote_number=quote_number, public_token=token).first()
        
        if not quote:
            print(f"[client_quote_view] ❌ NIE ZNALEZIONO wyceny dla numeru '{quote_number}' i tokenu '{token}'", file=sys.stderr)
            return render_client_error(
                error_type='not_found',
                error_code=404,
                quote_number=quote_number
            )
        
        print(f"[client_quote_view] ✅ ZNALEZIONO wycenę ID={quote.id}, is_client_editable={quote.is_client_editable}", file=sys.stderr)
        
        # POPRAWKA: Zawsze pokazujemy stronę wyceny, ale z odpowiednim stanem
        # Nie blokujemy dostępu dla zaakceptowanych wycen
        
        print(f"[client_quote_view] Renderuję szablon client_quote.html", file=sys.stderr)
        
        # Przekierowanie na szablon strony klienta z pełnymi danymi
        return render_template("quotes/templates/client_quote.html", 
                             quote=quote,
                             quote_number=quote_number,
                             token=token,
                             is_accepted=not quote.is_client_editable)  # NOWE: przekazujemy stan
        
    except Exception as e:
        print(f"[client_quote_view] ❌ BŁĄD: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        
        return render_client_error(
            error_type='general',
            error_code=500,
            error_message="Wystąpił nieoczekiwany błąd podczas ładowania wyceny.",
            error_details=str(e),
            quote_number=quote_number
        )

@quotes_bp.route("/api/client/quote/<token>")
def get_client_quote_data(token):
    """API dla strony klienta - poprawiona obsługa zaakceptowanych wycen"""
    try:
        quote = Quote.query.filter_by(public_token=token).first()
        
        if not quote:
            return jsonify({
                "error": "not_found", 
                "message": "Wycena nie została znaleziona"
            }), 404
        
        # Oblicz koszty
        cost_products_netto = round(sum(i.get_total_price_netto() for i in quote.items if i.is_selected), 2)
        cost_finishing_netto = round(sum(d.finishing_price_netto or 0.0 for d in db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()), 2)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0.0
        costs = calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto)
        
        # Zawsze pokazujemy wszystkie pozycje, nie tylko show_on_client_page
        # Bo po akceptacji klient powinien widzieć co wybrał
        visible_items = quote.items if not quote.is_client_editable else [item for item in quote.items if item.show_on_client_page]
        
        return jsonify({
            "id": quote.id,
            "quote_number": quote.quote_number,
            "created_at": quote.created_at.isoformat() if quote.created_at else None,
            "is_client_editable": quote.is_client_editable,
            "costs": costs,
            "courier_name": quote.courier_name or "-",
            "status_name": quote.quote_status.name if quote.quote_status else "-",
            "client_comments": getattr(quote, 'client_comments', None),
            "acceptance_date": getattr(quote, 'acceptance_date', None),
            # DODANE: public_token do pobierania PDF po stronie klienta
            "public_token": quote.public_token,
            "client": {
                "client_name": quote.client.client_name if quote.client else "-",
                "email": quote.client.email if quote.client else "-",
                "phone": quote.client.phone if quote.client else "-"
            },
            "user": {
                "first_name": quote.user.first_name if quote.user else "",
                "last_name": quote.user.last_name if quote.user else ""
            },
            "finishing": [
                {
                    "product_index": detail.product_index,
                    "type": detail.finishing_type,
                    "variant": detail.finishing_variant,
                    "color": detail.finishing_color,
                    "gloss": detail.finishing_gloss_level,
                    "netto": detail.finishing_price_netto,
                    "brutto": detail.finishing_price_brutto
                } for detail in db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()
            ],
            "items": [item.to_dict() for item in visible_items]
        })
        
    except Exception as e:
        print(f"[get_client_quote_data] Błąd: {e}", file=sys.stderr)
        return jsonify({
            "error": "general",
            "message": "Wystąpił błąd podczas pobierania danych wyceny",
            "details": str(e)
        }), 500

@quotes_bp.route("/api/client/quote/<token>/update-variant", methods=["PATCH"])
def client_update_variant(token):
    """Zmiana wariantu przez klienta - tylko dla edytowalnych wycen"""
    try:
        quote = Quote.query.filter_by(public_token=token).first_or_404()
        
        # POPRAWKA: Sprawdzamy czy wycena jest nadal edytowalna
        if not quote.is_client_editable:
            return jsonify({
                "error": "quote_not_editable", 
                "message": "Wycena została już zaakceptowana i nie można jej modyfikować"
            }), 403
        
        data = request.get_json()
        item_id = data.get("item_id")

        if not item_id:
            return jsonify({"error": "Brak wymaganych danych"}), 400

        item = QuoteItem.query.filter_by(id=item_id, quote_id=quote.id).first_or_404()
        if not item.show_on_client_page:
            return jsonify({"error": "Pozycja nie jest dostępna"}), 403

        # Odznacz wszystkie warianty w tej grupie i zaznacz wybrany
        QuoteItem.query.filter_by(quote_id=quote.id, product_index=item.product_index).update({QuoteItem.is_selected: False})
        item.is_selected = True
        db.session.commit()

        print(f"[client_update_variant] Klient zmienił wariant na {item_id} w wycenie {quote.id}", file=sys.stderr)
        return jsonify({"message": "Wariant został zmieniony"})

    except Exception as e:
        print(f"[client_update_variant] Błąd: {e}", file=sys.stderr)
        return jsonify({"error": "Błąd podczas zmiany wariantu"}), 500


# POPRAWKA 1: W routers.py w funkcji client_accept_quote
# Zmień tę część kodu:

# GŁÓWNA POPRAWKA W app/modules/quotes/routers.py
# Zastąp funkcję client_accept_quote:

@quotes_bp.route("/api/client/quote/<token>/accept", methods=["POST"])
def client_accept_quote(token):
    """Akceptacja wyceny przez klienta - z poprawną zmianą statusu"""
    try:
        data = request.get_json()
        email_or_phone = data.get("email_or_phone")
        comments = data.get("comments", "")
        
        if not email_or_phone:
            return jsonify({"error": "Wymagany email lub numer telefonu"}), 400
        
        quote = Quote.query.filter_by(public_token=token).first_or_404()
        
        if not quote.is_client_editable:
            return jsonify({"error": "Wycena została już zaakceptowana"}), 403
        
        # Walidacja email/telefon
        if not validate_email_or_phone(email_or_phone, quote):
            return jsonify({"error": "Nieprawidłowy email lub numer telefonu"}), 400
        
        print(f"[client_accept_quote] PRZED zmianą - wycena {quote.id}, status_id: {quote.status_id}", file=sys.stderr)
        
        # KLUCZOWA POPRAWKA: Znajdź status "Zaakceptowane" (ID 3)
        accepted_status = QuoteStatus.query.filter_by(id=3).first()
        if not accepted_status:
            # Fallback - spróbuj różne nazwy
            accepted_status = QuoteStatus.query.filter(
                QuoteStatus.name.in_(["Zaakceptowane", "Zaakceptowana", "Accepted", "Zatwierdzone"])
            ).first()
        
        if accepted_status:
            old_status_id = quote.status_id
            quote.status_id = accepted_status.id
            print(f"[client_accept_quote] Zmiana statusu z {old_status_id} na {accepted_status.id} ({accepted_status.name})", file=sys.stderr)
        else:
            print(f"[client_accept_quote] BŁĄD: Nie znaleziono statusu akceptacji!", file=sys.stderr)
            # Wypisz wszystkie dostępne statusy dla debugowania
            all_statuses = QuoteStatus.query.all()
            print(f"[client_accept_quote] Dostępne statusy:", file=sys.stderr)
            for status in all_statuses:
                print(f"  ID: {status.id}, Nazwa: '{status.name}'", file=sys.stderr)
        
        # Zapisz pozostałe dane akceptacji
        quote.client_comments = comments
        quote.acceptance_date = datetime.now()
        quote.accepted_by_email = email_or_phone
        quote.disable_client_editing()
        
        # WAŻNE: Flush przed commit żeby zobaczyć błędy
        try:
            db.session.flush()
            print(f"[client_accept_quote] Flush wykonany pomyślnie", file=sys.stderr)
        except Exception as e:
            print(f"[client_accept_quote] BŁĄD podczas flush: {e}", file=sys.stderr)
            db.session.rollback()
            return jsonify({"error": "Błąd zapisu do bazy danych"}), 500
        
        # Commit zmian
        try:
            db.session.commit()
            print(f"[client_accept_quote] Commit wykonany pomyślnie", file=sys.stderr)
        except Exception as e:
            print(f"[client_accept_quote] BŁĄD podczas commit: {e}", file=sys.stderr)
            db.session.rollback()
            return jsonify({"error": "Błąd zapisu do bazy danych"}), 500
        
        # Sprawdź po zapisie
        quote_after = Quote.query.get(quote.id)
        print(f"[client_accept_quote] PO zapisie - wycena {quote_after.id}, status_id: {quote_after.status_id}", file=sys.stderr)
        
        # Wyślij emaile
        try:
            send_acceptance_emails(quote)
            print(f"[client_accept_quote] Emaile wysłane pomyślnie", file=sys.stderr)
        except Exception as e:
            print(f"[client_accept_quote] Błąd wysyłki maili: {e}", file=sys.stderr)
        
        return jsonify({
            "message": "Wycena została zaakceptowana",
            "acceptance_date": quote.acceptance_date.isoformat() if quote.acceptance_date else None,
            "new_status": accepted_status.name if accepted_status else "Brak statusu",
            "new_status_id": accepted_status.id if accepted_status else None
        })
        
    except Exception as e:
        print(f"[client_accept_quote] WYJĄTEK: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        db.session.rollback()
        return jsonify({"error": "Błąd podczas akceptacji wyceny"}), 500

def send_acceptance_email_to_salesperson(quote):
    """
    Wysyła email do sprzedawcy o akceptacji wyceny przez klienta
    
    Args:
        quote: Obiekt wyceny (Quote model)
    """
    if not quote.user or not quote.user.email:
        print(f"[send_acceptance_email_to_salesperson] Brak emaila sprzedawcy dla wyceny {quote.id}", file=sys.stderr)
        return
    
    try:
        # Przygotuj dane do szablonu
        selected_items = quote.get_selected_items()
        
        # Oblicz koszty
        cost_products_netto = round(sum(i.get_total_price_netto or 0 for i in selected_items), 2)
        cost_finishing_netto = round(sum(d.finishing_price_netto or 0.0 for d in db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()), 2)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0.0
        costs = calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto)
        
        # Pobierz detale wykończenia
        finishing_details = db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()
        
        # Renderuj szablon HTML
        html_body = render_template('quote_accept_email.html', 
                                  quote=quote,
                                  selected_items=selected_items,
                                  finishing_details=finishing_details,
                                  costs=costs,
                                  acceptance_date=datetime.now(),
                                  base_url=current_app.config.get('BASE_URL', ''))
        
        # Przygotuj wiadomość
        msg = Message(
            subject=f"✅ Akceptacja wyceny {quote.quote_number}",
            sender=current_app.config['MAIL_USERNAME'],  # powiadomienia@woodpower.pl
            recipients=[quote.user.email],
            html=html_body
        )
        
        mail.send(msg)
        print(f"[send_acceptance_email_to_salesperson] Wysłano email do sprzedawcy: {quote.user.email}", file=sys.stderr)
        
    except Exception as e:
        print(f"[send_acceptance_email_to_salesperson] Błąd wysyłki maila do sprzedawcy: {e}", file=sys.stderr)
        raise

def send_acceptance_email_to_client(quote):
    """
    Wysyła email potwierdzający do klienta o akceptacji wyceny
    Email wysyłany z powiadomienia@woodpower.pl, ale Reply-To ustawione na opiekuna
    
    Args:
        quote: Obiekt wyceny (Quote model)
    """
    if not quote.client or not quote.client.email:
        print(f"[send_acceptance_email_to_client] Brak emaila klienta dla wyceny {quote.id}", file=sys.stderr)
        return
    
    try:
        # Przygotuj dane do szablonu
        selected_items = quote.get_selected_items()
        
        # Oblicz koszty
        cost_products_netto = round(sum(i.get_total_price_netto or 0 for i in selected_items), 2)
        cost_finishing_netto = round(sum(d.finishing_price_netto or 0.0 for d in db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()), 2)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0.0
        costs = calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto)
        
        # Pobierz detale wykończenia
        finishing_details = db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()
        
        # Renderuj szablon HTML dla klienta
        html_body = render_template('quote_accept_email_client.html', 
                                  quote=quote,
                                  selected_items=selected_items,
                                  finishing_details=finishing_details,
                                  costs=costs,
                                  acceptance_date=datetime.now(),
                                  base_url=current_app.config.get('BASE_URL', ''))
        
        # Przygotuj wiadomość z Reply-To na opiekuna
        msg = Message(
            subject=f"✅ Potwierdzenie akceptacji wyceny {quote.quote_number} - Wood Power",
            sender=current_app.config['MAIL_USERNAME'],  # powiadomienia@woodpower.pl
            recipients=[quote.client.email],
            html=html_body
        )
        
        # Ustaw Reply-To na email opiekuna wyceny (jeśli istnieje)
        if quote.user and quote.user.email:
            msg.reply_to = quote.user.email
            print(f"[send_acceptance_email_to_client] Ustawiono Reply-To na: {quote.user.email}", file=sys.stderr)
        
        mail.send(msg)
        print(f"[send_acceptance_email_to_client] Wysłano email do klienta: {quote.client.email}", file=sys.stderr)
        
    except Exception as e:
        print(f"[send_acceptance_email_to_client] Błąd wysyłki maila do klienta: {e}", file=sys.stderr)
        raise

def send_acceptance_emails(quote):
    """
    Funkcja pomocnicza - wysyła oba emaile po akceptacji wyceny
    
    Args:
        quote: Obiekt wyceny (Quote model)
    """
    try:
        # Wyślij email do sprzedawcy
        send_acceptance_email_to_salesperson(quote)
        print(f"[send_acceptance_emails] Email do sprzedawcy wysłany pomyślnie", file=sys.stderr)
    except Exception as e:
        print(f"[send_acceptance_emails] Błąd wysyłki maila do sprzedawcy: {e}", file=sys.stderr)
    
    try:
        # Wyślij email do klienta (jeśli ma podany email)
        send_acceptance_email_to_client(quote)
        print(f"[send_acceptance_emails] Email do klienta wysłany pomyślnie", file=sys.stderr)
    except Exception as e:
        print(f"[send_acceptance_emails] Błąd wysyłki maila do klienta: {e}", file=sys.stderr)

@quotes_bp.route("/test-routing")
def test_quotes_routing():
    """Test czy quotes blueprint działa"""
    return "Quotes routing działa!"

# Add this route to app/modules/quotes/routers.py

@quotes_bp.route("/api/quotes/<int:quote_id>/update-quantity", methods=['PATCH'])
def update_quote_quantity(quote_id):
    """Aktualizuje ilość produktu w wycenie"""
    try:
        # Pobierz wycenę
        quote = Quote.query.get_or_404(quote_id)
        
        # Pobierz dane z requestu
        data = request.get_json()
        product_index = data.get('product_index')
        new_quantity = data.get('quantity')
        
        # Walidacja danych
        if not product_index or not new_quantity:
            return jsonify({"error": "Brakuje wymaganych danych (product_index, quantity)"}), 400
        
        try:
            product_index = int(product_index)
            new_quantity = int(new_quantity)
        except (ValueError, TypeError):
            return jsonify({"error": "Nieprawidłowe wartości liczbowe"}), 400
        
        if new_quantity < 1:
            return jsonify({"error": "Ilość musi być większa od 0"}), 400
        
        print(f"[update_quote_quantity] Aktualizacja ilości dla wyceny {quote_id}, produkt {product_index}, nowa ilość: {new_quantity}", file=sys.stderr)
        
        # Znajdź szczegóły wykończenia dla danego produktu
        finishing_details = QuoteItemDetails.query.filter_by(
            quote_id=quote_id,
            product_index=product_index
        ).first()
        
        if not finishing_details:
            return jsonify({"error": f"Nie znaleziono szczegółów produktu {product_index}"}), 404
        
        # Zapisz starą ilość dla logowania
        old_quantity = finishing_details.quantity or 1
        
        # Aktualizuj ilość w QuoteItemDetails
        finishing_details.quantity = new_quantity
        
        print(f"[update_quote_quantity] Zaktualizowano ilość z {old_quantity} na {new_quantity} dla produktu {product_index}", file=sys.stderr)
        
        # Zaloguj zmianę
        current_user_id = session.get('user_id')
        if current_user_id:
            log_entry = QuoteLog(
                quote_id=quote_id,
                user_id=current_user_id,
                description=f"Zmieniono ilość produktu {product_index} z {old_quantity} na {new_quantity} szt."
            )
            db.session.add(log_entry)
        
        # Zapisz zmiany
        db.session.commit()
        
        print(f"[update_quote_quantity] Pomyślnie zaktualizowano ilość produktu {product_index} w wycenie {quote_id}", file=sys.stderr)
        
        return jsonify({
            "message": "Ilość została zaktualizowana",
            "product_index": product_index,
            "old_quantity": old_quantity,
            "new_quantity": new_quantity
        })
        
    except Exception as e:
        db.session.rollback()
        print(f"[update_quote_quantity] Błąd podczas aktualizacji ilości: {e}", file=sys.stderr)
        return jsonify({
            "error": "Błąd podczas aktualizacji ilości",
            "message": str(e)
        }), 500
    
# Dodaj ten kod do app/modules/quotes/routers.py

@quotes_bp.route('/api/quotes/<int:quote_id>/user-accept', methods=['POST'])
@login_required
def user_accept_quote(quote_id):
    """Akceptacja wyceny przez użytkownika wewnętrznego (opiekuna oferty)"""
    try:
        # Pobierz wycenę
        quote = Quote.query.get_or_404(quote_id)
        
        # Pobierz aktualnego użytkownika
        user_email = session.get('user_email')
        user = User.query.filter_by(email=user_email).first()
        
        if not user:
            return jsonify({"error": "Nie znaleziono użytkownika"}), 401
        
        # Sprawdź czy wycena nie została już zaakceptowana
        if not quote.is_client_editable:
            return jsonify({
                "error": "Wycena została już zaakceptowana",
                "message": "Ta wycena została już wcześniej zaakceptowana"
            }), 403
        
        print(f"[user_accept_quote] Akceptacja wyceny {quote_id} przez użytkownika {user.id} ({user.first_name} {user.last_name})", file=sys.stderr)
        
        # Znajdź status "Zaakceptowane" (ID 3)
        accepted_status = QuoteStatus.query.filter_by(id=3).first()
        if not accepted_status:
            # Fallback - spróbuj różne nazwy
            accepted_status = QuoteStatus.query.filter(
                QuoteStatus.name.in_(["Zaakceptowane", "Zaakceptowana", "Accepted", "Zatwierdzone"])
            ).first()
        
        if not accepted_status:
            print(f"[user_accept_quote] BŁĄD: Nie znaleziono statusu akceptacji!", file=sys.stderr)
            return jsonify({"error": "Błąd konfiguracji statusów"}), 500
        
        # Zaktualizuj wycenę
        old_status_id = quote.status_id
        quote.status_id = accepted_status.id
        quote.is_client_editable = False
        
        # NOWA LOGIKA: Wypełnij pola akceptacji przez użytkownika wewnętrznego
        quote.accepted_by_user_id = user.id  # AKTYWACJA TEJ KOLUMNY
        
        # Sprawdź czy nie było wcześniejszej akceptacji przez klienta
        if not quote.acceptance_date:  
            # Jeśli nie było akceptacji przez klienta, ustaw datę akceptacji przez użytkownika
            quote.acceptance_date = datetime.now()
            quote.accepted_by_email = f"internal_user_{user.id}"  # Oznaczenie akceptacji wewnętrznej
        else:
            # Jeśli była już akceptacja przez klienta, dodaj oznaczenie że użytkownik też zaakceptował
            quote.accepted_by_email = f"internal_user_{user.id}"
        
        print(f"[user_accept_quote] Zmiana statusu z {old_status_id} na {accepted_status.id} ({accepted_status.name})", file=sys.stderr)
        
        # Zapisz zmiany
        try:
            db.session.commit()
            print(f"[user_accept_quote] Zmiany zapisane pomyślnie", file=sys.stderr)
        except Exception as e:
            print(f"[user_accept_quote] BŁĄD podczas zapisu: {e}", file=sys.stderr)
            db.session.rollback()
            return jsonify({"error": "Błąd zapisu do bazy danych"}), 500
        
        # Wyślij email do klienta o akceptacji wyceny przez opiekuna
        try:
            if quote.client and quote.client.email:
                send_user_acceptance_email_to_client(quote, user)
                print(f"[user_accept_quote] Email do klienta wysłany", file=sys.stderr)
        except Exception as e:
            print(f"[user_accept_quote] Błąd wysyłki maila: {e}", file=sys.stderr)
        
        return jsonify({
            "message": "Wycena została zaakceptowana przez opiekuna",
            "acceptance_date": quote.acceptance_date.isoformat() if quote.acceptance_date else None,
            "accepted_by_user": f"{user.first_name} {user.last_name}",
            "accepted_by_user_id": user.id,
            "new_status": accepted_status.name,
            "new_status_id": accepted_status.id
        })
        
    except Exception as e:
        print(f"[user_accept_quote] WYJĄTEK: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        db.session.rollback()
        return jsonify({"error": "Błąd podczas akceptacji wyceny"}), 500


def send_user_acceptance_email_to_client(quote, accepting_user):
    """
    Wysyła email do klienta o akceptacji wyceny przez opiekuna oferty
    
    Args:
        quote: Obiekt wyceny (Quote model)
        accepting_user: Użytkownik który zaakceptował wycenę
    """
    if not quote.client or not quote.client.email:
        print(f"[send_user_acceptance_email_to_client] Brak emaila klienta dla wyceny {quote.id}", file=sys.stderr)
        return
    
    try:
        # Przygotuj dane do szablonu
        selected_items = quote.get_selected_items()
        
        # Oblicz koszty
        cost_products_netto = round(sum(i.get_total_price_netto() for i in selected_items), 2)
        cost_finishing_netto = round(sum(d.finishing_price_netto or 0.0 for d in db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()), 2)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0.0
        costs = calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto)
        
        # Pobierz detale wykończenia
        finishing_details = db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()
        
        # Renderuj szablon HTML dla klienta (podobny do istniejącego)
        html_body = render_template('quote_accept_email_client.html', 
                                  quote=quote,
                                  selected_items=selected_items,
                                  finishing_details=finishing_details,
                                  costs=costs,
                                  acceptance_date=datetime.now(),
                                  accepting_user=accepting_user,  # Dodatkowy parametr
                                  acceptance_by='user',  # Oznaczenie że to akceptacja przez użytkownika
                                  base_url=current_app.config.get('BASE_URL', ''))
        
        # Przygotuj wiadomość
        msg = Message(
            subject=f"✅ Wycena {quote.quote_number} została zaakceptowana - Wood Power",
            sender=current_app.config['MAIL_USERNAME'],  # powiadomienia@woodpower.pl
            recipients=[quote.client.email],
            html=html_body
        )
        
        # Ustaw Reply-To na email akceptującego użytkownika
        if accepting_user.email:
            msg.reply_to = accepting_user.email
            print(f"[send_user_acceptance_email_to_client] Ustawiono Reply-To na: {accepting_user.email}", file=sys.stderr)
        
        mail.send(msg)
        print(f"[send_user_acceptance_email_to_client] Wysłano email do klienta: {quote.client.email}", file=sys.stderr)
        
    except Exception as e:
        print(f"[send_user_acceptance_email_to_client] Błąd wysyłki maila do klienta: {e}", file=sys.stderr)
        raise