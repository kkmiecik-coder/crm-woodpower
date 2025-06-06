# modules/quotes/routers.py
from flask import render_template, jsonify, request, make_response, current_app, send_file, Blueprint, session, redirect, url_for, flash
from . import quotes_bp
from modules.calculator.models import Quote, User, QuoteItemDetails, QuoteItem
from modules.quotes.models import QuoteStatus, DiscountReason
from modules.clients.models import Client
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
                "public_url": q.get_public_url()
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

@quotes_bp.route("/api/quotes/<int:quote_id>/pdf.<format>", methods=["GET"])
@login_required
def generate_quote_pdf(quote_id, format):
    print(f"[generate_quote_pdf] START -> format={format}, ID={quote_id}", file=sys.stderr)

    if format not in ["pdf", "png"]:
        print(f"[generate_quote_pdf] Unsupported format: {format}", file=sys.stderr)
        return {"error": "Unsupported format"}, 400

    quote = Quote.query.get(quote_id)
    if not quote:
        print(f"[generate_quote_pdf] Brak wyceny ID: {quote_id}", file=sys.stderr)
        return {"error": "Quote not found"}, 404

    print(f"[generate_quote_pdf] Quote found: {quote.quote_number}", file=sys.stderr)

    quote.client = Client.query.get(quote.client_id) if quote.client_id else None
    quote.user = User.query.get(quote.user_id)

    try:
        html_out = render_template("quotes/templates/offer_pdf.html", quote=quote)
        html = HTML(string=html_out)
        out = BytesIO()

        if format == "pdf":
            html.write_pdf(out)
            content_type = "application/pdf"
        else:
            html.write_png(out)
            content_type = "image/png"

        out.seek(0)
        filename = f"Wycena_{quote.quote_number}.{format}"
        print(f"[generate_quote_pdf] Zwracamy plik: {filename}", file=sys.stderr)

        return make_response(out.read(), 200, {
            "Content-Type": content_type,
            "Content-Disposition": f"inline; filename=\"{filename}\""
        })
    except Exception as e:
        print(f"[generate_quote_pdf] Blad renderowania PDF: {str(e)}", file=sys.stderr)
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

    rendered = render_template("quotes/templates/offer_pdf.html", quote=quote, client=client, user=user, status=status)
    pdf_file = BytesIO()
    HTML(string=rendered).write_pdf(pdf_file)
    pdf_file.seek(0)

    msg = Message(subject=f"Wycena {quote.quote_number}",
                  sender=current_app.config['MAIL_USERNAME'],
                  recipients=[recipient_email])
    msg.body = f"Czesc, w zalczniku znajdziesz wycenę nr {quote.quote_number}."
    msg.attach(f"wycena_{quote.quote_number}.pdf", "application/pdf", pdf_file.read())

    try:
        mail.send(msg)
        return jsonify({"message": "Email sent successfully"})
    except Exception as e:
        logging.error(f"Blad wysylki maila: {str(e)}")
        return jsonify({"error": "Failed to send email"}), 500

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
        quote = db.session.query(Quote)\
            .options(
                joinedload(Quote.client),
                joinedload(Quote.user),
                joinedload(Quote.items),
                joinedload(Quote.quote_status)
            )\
            .filter(Quote.id == quote_id)\
            .first()

        if not quote:
            print(f"[get_quote_details] Brak wyceny ID {quote_id}", file=sys.stderr)
            return jsonify({"error": "Quote not found"}), 404

        print(f"[get_quote_details] quote_status repr: {repr(quote.quote_status)}", file=sys.stderr)
        print(f"[get_quote_details] quote.items len: {len(quote.items)}", file=sys.stderr)

        # Oblicz koszty produktów i wykończenia
        cost_products_netto = round(sum(i.final_price_netto or 0 for i in quote.items if i.is_selected), 2)
        cost_finishing_netto = round(sum(d.finishing_price_netto or 0.0 for d in db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()), 2)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0.0
        
        # Oblicz wszystkie warianty kosztów
        costs = calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto)
        
        all_statuses = QuoteStatus.query.all()
        
        return jsonify({
            "id": quote.id,
            "quote_number": quote.quote_number,
            "created_at": quote.created_at.isoformat() if quote.created_at else None,
            "source": quote.source or "-",
            "public_url": quote.get_public_url(),
            "is_client_editable": quote.is_client_editable,
            
            # Nowa struktura kosztów
            "costs": costs,
            
            # Zachowaj stare pola dla kompatybilności
            "cost_products": costs['products']['netto'],
            "cost_finishing": costs['finishing']['netto'], 
            "cost_shipping": costs['shipping']['brutto'],
            "cost_total": costs['total']['brutto'],
            
            "courier_name": quote.courier_name or "-",
            "status_name": quote.quote_status.name if quote.quote_status else "-",
            "status_color": quote.quote_status.color_hex if quote.quote_status else "#999",
            "all_statuses": {s.id: {"id": s.id, "name": s.name, "color": s.color_hex} for s in all_statuses},
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
            "client": {
                "client_number": quote.client.client_number if quote.client else "-",
                "client_name": quote.client.client_name if quote.client else "-",
                "client_delivery_name": quote.client.client_delivery_name if quote.client else "-",
                "email": quote.client.email if quote.client else "-",
                "phone": quote.client.phone if quote.client else "-",
                "company": quote.client.invoice_company or quote.client.delivery_company or "-"
            },
            "user": {
                "first_name": quote.user.first_name if quote.user else "",
                "last_name": quote.user.last_name if quote.user else ""
            },
            "items": [item.to_dict() for item in quote.items]
        })

    except Exception as e:
        print(f"[get_quote_details] Błąd podczas budowania JSON: {e}", file=sys.stderr)
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
    """Publiczna strona wyceny dla klienta - z debugiem"""
    
    # SZCZEGÓŁOWE LOGI
    print(f"[client_quote_view] ===== ROUTING DEBUG =====", file=sys.stderr)
    print(f"[client_quote_view] Otrzymano quote_number: '{quote_number}' (type: {type(quote_number)})", file=sys.stderr)
    print(f"[client_quote_view] Otrzymano token: '{token}' (type: {type(token)})", file=sys.stderr)
    print(f"[client_quote_view] Request path: {request.path}", file=sys.stderr)
    print(f"[client_quote_view] Request URL: {request.url}", file=sys.stderr)
    print(f"[client_quote_view] Request method: {request.method}", file=sys.stderr)
    
    try:
        # Log przed query
        print(f"[client_quote_view] Szukam w bazie: quote_number='{quote_number}', public_token='{token}'", file=sys.stderr)
        
        # Sprawdź ile wycen jest w bazie z tym numerem
        quotes_with_number = Quote.query.filter_by(quote_number=quote_number).all()
        print(f"[client_quote_view] Znaleziono {len(quotes_with_number)} wycen z numerem '{quote_number}'", file=sys.stderr)
        
        for q in quotes_with_number:
            print(f"[client_quote_view] Wycena ID={q.id}, quote_number='{q.quote_number}', public_token='{q.public_token}'", file=sys.stderr)
        
        quote = Quote.query.filter_by(quote_number=quote_number, public_token=token).first()
        
        if not quote:
            print(f"[client_quote_view] ❌ NIE ZNALEZIONO wyceny dla numeru '{quote_number}' i tokenu '{token}'", file=sys.stderr)
            
            # Sprawdź wszystkie wyceny z tym tokenem
            quotes_with_token = Quote.query.filter_by(public_token=token).all()
            print(f"[client_quote_view] Znaleziono {len(quotes_with_token)} wycen z tokenem '{token}'", file=sys.stderr)
            
            for q in quotes_with_token:
                print(f"[client_quote_view] Token match - ID={q.id}, quote_number='{q.quote_number}'", file=sys.stderr)
            
            return render_client_error(
                error_type='not_found',
                error_code=404,
                quote_number=quote_number
            )
        
        print(f"[client_quote_view] ✅ ZNALEZIONO wycenę ID={quote.id}", file=sys.stderr)
        
        # Sprawdź czy wycena jest edytowalna
        is_editable = getattr(quote, 'is_client_editable', True)  # domyślnie True jeśli pole nie istnieje
        print(f"[client_quote_view] is_client_editable: {is_editable}", file=sys.stderr)
        
        if not is_editable:
            print(f"[client_quote_view] Wycena {quote_number} została już zaakceptowana", file=sys.stderr)
            return render_client_error(
                error_type='already_accepted',
                error_code=403,
                quote_number=quote_number
            )
        
        print(f"[client_quote_view] Renderuję szablon client_quote.html", file=sys.stderr)
        
        # Przekierowanie na szablon strony klienta
        return render_template("quotes/templates/client_quote.html", 
                             quote=quote,
                             quote_number=quote_number,
                             token=token)
        
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
    """API dla strony klienta - dane wyceny"""
    try:
        quote = Quote.query.filter_by(public_token=token).first()
        
        if not quote:
            return jsonify({
                "error": "not_found", 
                "message": "Wycena nie została znaleziona"
            }), 404
        
        if not quote.is_client_editable:
            return jsonify({
                "error": "already_accepted", 
                "message": "Wycena została już zaakceptowana"
            }), 403
        
        # Oblicz koszty
        cost_products_netto = round(sum(i.final_price_netto or 0 for i in quote.items if i.is_selected), 2)
        cost_finishing_netto = round(sum(d.finishing_price_netto or 0.0 for d in db.session.query(QuoteItemDetails).filter_by(quote_id=quote.id).all()), 2)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0.0
        costs = calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto)
        
        # Pobierz tylko pozycje widoczne dla klienta
        visible_items = [item for item in quote.items if item.show_on_client_page]
        
        return jsonify({
            "id": quote.id,
            "quote_number": quote.quote_number,
            "created_at": quote.created_at.isoformat() if quote.created_at else None,
            "is_client_editable": quote.is_client_editable,
            "costs": costs,
            "courier_name": quote.courier_name or "-",
            "status_name": quote.quote_status.name if quote.quote_status else "-",
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
    """Zmiana wariantu przez klienta (bez walidacji e-mail/telefon)"""
    try:
        data = request.get_json()
        item_id = data.get("item_id")

        # Wymagamy tylko item_id
        if not item_id:
            return jsonify({"error": "Brak wymaganych danych"}), 400

        quote = Quote.query.filter_by(public_token=token).first_or_404()
        if not quote.is_client_editable:
            return jsonify({"error": "Wycena nie może być już edytowana"}), 403

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


@quotes_bp.route("/api/client/quote/<token>/accept", methods=["POST"])
def client_accept_quote(token):
    """Akceptacja wyceny przez klienta"""
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
        
        # Zmień status na "Zaakceptowana"
        accepted_status = QuoteStatus.query.filter_by(name="Zaakceptowana").first()
        if accepted_status:
            quote.status_id = accepted_status.id
        
        # Zapisz komentarze klienta i wyłącz edycję
        quote.client_comments = comments
        quote.disable_client_editing()
        
        db.session.commit()
        
        # ZMIANA: Wyślij oba emaile (do sprzedawcy i klienta)
        try:
            send_acceptance_emails(quote)
        except Exception as e:
            print(f"[client_accept_quote] Błąd wysyłki maili: {e}", file=sys.stderr)
        
        print(f"[client_accept_quote] Wycena {quote.id} została zaakceptowana przez klienta", file=sys.stderr)
        
        return jsonify({"message": "Wycena została zaakceptowana"})
        
    except Exception as e:
        print(f"[client_accept_quote] Błąd: {e}", file=sys.stderr)
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
        cost_products_netto = round(sum(i.final_price_netto or 0 for i in selected_items), 2)
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
        cost_products_netto = round(sum(i.final_price_netto or 0 for i in selected_items), 2)
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