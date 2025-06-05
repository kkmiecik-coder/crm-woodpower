# modules/quotes/routers.py
from flask import render_template, jsonify, request, make_response, current_app, send_file, Blueprint, session, redirect, url_for, flash
from . import quotes_bp
from modules.calculator.models import Quote, User, QuoteItemDetails
from modules.quotes.models import QuoteStatus
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


def calculate_costs_with_vat(cost_products_netto, cost_finishing_netto, cost_shipping_brutto):
    """
    Oblicza koszty brutto i netto dla wyceny
    Założenia:
    - cost_products_netto i cost_finishing_netto są wartościami netto
    - cost_shipping_brutto jest wartością brutto
    - VAT = 23%
    """
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
                "all_statuses": statuses
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

@quotes_bp.route("/wycena/<quote_number>", methods=["GET", "POST"])
def public_quote_view(quote_number):
    print(f"[public_quote_view] Wywołano widok publiczny wyceny {quote_number}", file=sys.stderr)

    quote = Quote.query.filter_by(quote_number=quote_number).first_or_404()
    quote.client = Client.query.get(quote.client_id) if quote.client_id else None
    quote.user = User.query.get(quote.user_id)
    quote.status = QuoteStatus.query.get(quote.status_id)

    error = None
    confirmation_success = False

    if request.method == "POST":
        input_code = request.form.get("confirmation_code")
        print(f"[public_quote_view] Wprowadzony kod: {input_code}", file=sys.stderr)
        if input_code == quote.confirmation_code:
            confirmed_status = QuoteStatus.query.filter_by(name="Potwierdzona").first()
            if confirmed_status:
                quote.status_id = confirmed_status.id
                db.session.commit()
                quote.status = confirmed_status
            confirmation_success = True
        else:
            error = "Nieprawidlowy kod potwierdzenia."

    return render_template("quotes/templates/public_quote.html", quote=quote, error=error, confirmation_success=confirmation_success)

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
        print(f"[get_quote_details] quote_status keys: {quote.quote_status.__dict__.keys()}", file=sys.stderr)
        print(f"[get_quote_details] quote.items len: {len(quote.items)}", file=sys.stderr)

        # DEBUG: pokaż pierwsze 1-2 elementy jeśli istnieją
        for idx, i in enumerate(quote.items[:2]):
            print(f"[get_quote_details] item[{idx}]: id={i.id}, price={i.final_price_netto}", file=sys.stderr)

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
                "client_name": quote.client.client_name if quote.client else "-",
                "email": quote.client.email if quote.client else "-",
                "phone": quote.client.phone if quote.client else "-",
                "company": quote.client.invoice_company or quote.client.delivery_company or "-"
            },
            "user": {
                "first_name": quote.user.first_name if quote.user else "",
                "last_name": quote.user.last_name if quote.user else ""
            },
            "items": [
                {
                    "id": i.id,
                    "product_index": i.product_index,
                    "is_selected": i.is_selected,
                    "length_cm": i.length_cm,
                    "width_cm": i.width_cm,
                    "thickness_cm": i.thickness_cm,
                    "volume_m3": i.volume_m3,
                    "price_per_m3": i.price_per_m3,
                    "final_price_netto": i.final_price_netto,
                    "final_price_brutto": i.final_price_brutto,
                    "variant_code": i.variant_code
                } for i in quote.items
            ]
        })

    except Exception as e:
        print(f"[get_quote_details] Błąd podczas budowania JSON: {e}", file=sys.stderr)
        return jsonify({"error": "Błąd serwera"}), 500

@quotes_bp.route("/api/quote_items/<int:item_id>/select", methods=["PATCH"])
@login_required
def select_quote_item(item_id):
    try:
        from modules.calculator.models import QuoteItem  # Jeśli nie masz jeszcze importu
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
