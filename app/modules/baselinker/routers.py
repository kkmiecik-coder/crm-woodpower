# app/modules/baselinker/routers.py
from flask import render_template, jsonify, request, session, redirect, url_for, flash
from . import baselinker_bp
from .service import BaselinkerService
from .models import BaselinkerOrderLog, BaselinkerConfig
from modules.calculator.models import Quote, User, QuoteItemDetails  # DODANO QuoteItemDetails
from extensions import db
import sys
from functools import wraps

def login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            flash("Twoja sesja wygasła. Zaloguj się ponownie.", "info")
            return redirect(url_for('login'))
        return func(*args, **kwargs)
    return wrapper

@baselinker_bp.route('/api/quote/<int:quote_id>/order-modal-data')
@login_required
def get_order_modal_data(quote_id):
    """Pobiera dane do wyświetlenia w modalu zamówienia"""
    try:
        quote = Quote.query.get_or_404(quote_id)
        
        # Sprawdź czy wycena może być złożona jako zamówienie
        if not quote.is_eligible_for_order():
            return jsonify({
                'error': 'Wycena nie może zostać złożona jako zamówienie',
                'details': 'Wycena musi być zaakceptowana przez klienta'
            }), 400
        
        # Pobierz konfigurację Baselinker
        order_sources = BaselinkerConfig.query.filter_by(
            config_type='order_source',
            is_active=True
        ).all()
        
        order_statuses = BaselinkerConfig.query.filter_by(
            config_type='order_status', 
            is_active=True
        ).all()
        
        # POPRAWKA: Ustaw domyślne wartości dla statusów
        # Znajdź status "Nowe - nieopłacone" (ID: 105112) i ustaw jako domyślny
        for status in order_statuses:
            if status.baselinker_id == 105112:
                status.is_default = True
                print(f"[get_order_modal_data] Ustawiono status '{status.name}' (ID: {status.baselinker_id}) jako domyślny", file=sys.stderr)
            else:
                status.is_default = False
        
        # Oblicz koszty
        selected_items = [item for item in quote.items if item.is_selected]
        cost_products_netto = sum(item.final_price_netto or 0 for item in selected_items)
        
        # Pobierz szczegóły wykończenia bezpośrednio z bazy
        finishing_details = QuoteItemDetails.query.filter_by(quote_id=quote.id).all()
        cost_finishing_netto = sum(d.finishing_price_netto or 0 for d in finishing_details)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0
        
        # Oblicz z VAT
        VAT_RATE = 0.23
        products_brutto = cost_products_netto * (1 + VAT_RATE)
        finishing_brutto = cost_finishing_netto * (1 + VAT_RATE) 
        shipping_netto = cost_shipping_brutto / (1 + VAT_RATE)
        total_brutto = products_brutto + finishing_brutto + cost_shipping_brutto
        total_netto = cost_products_netto + cost_finishing_netto + shipping_netto
        
        return jsonify({
            'quote': {
                'id': quote.id,
                'quote_number': quote.quote_number,
                'created_at': quote.created_at.isoformat() if quote.created_at else None,
                'status': quote.quote_status.name if quote.quote_status else None,
                'source': quote.source
            },
            'client': {
                'name': quote.client.client_name if quote.client else None,
                'number': quote.client.client_number if quote.client else None,  # DODANE: client_number
                'company': quote.client.invoice_company or quote.client.delivery_company,
                'email': quote.client.email if quote.client else None,
                'phone': quote.client.phone if quote.client else None,
                'delivery_name': quote.client.client_delivery_name if quote.client else None,
                'delivery_company': quote.client.delivery_company if quote.client else None,
                'delivery_address': quote.client.delivery_address if quote.client else None,
                'delivery_postcode': quote.client.delivery_zip if quote.client else None,
                'delivery_city': quote.client.delivery_city if quote.client else None,
                'invoice_name': quote.client.invoice_name if quote.client else None,
                'invoice_company': quote.client.invoice_company if quote.client else None,
                'invoice_nip': quote.client.invoice_nip if quote.client else None,
                'invoice_address': quote.client.invoice_address if quote.client else None,
                'invoice_postcode': quote.client.invoice_zip if quote.client else None,
                'invoice_city': quote.client.invoice_city if quote.client else None
            },
            'products': [
                {
                    'id': item.id,
                    'name': _get_product_display_name(item, quote),
                    'variant_code': item.variant_code,
                    'dimensions': f"{item.length_cm}×{item.width_cm}×{item.thickness_cm} cm",
                    'volume': item.volume_m3,
                    'price_netto': item.final_price_netto,
                    'price_brutto': item.final_price_brutto,
                    'finishing': _get_finishing_details(item.product_index, quote)
                }
                for item in selected_items
            ],
            'costs': {
                'products_netto': round(cost_products_netto, 2),
                'products_brutto': round(products_brutto, 2),
                'finishing_netto': round(cost_finishing_netto, 2),
                'finishing_brutto': round(finishing_brutto, 2),
                'shipping_netto': round(shipping_netto, 2),
                'shipping_brutto': round(cost_shipping_brutto, 2),
                'total_netto': round(total_netto, 2),
                'total_brutto': round(total_brutto, 2)
            },
            'courier': quote.courier_name,
            'config': {
                'order_sources': [
                    {
                        'id': source.baselinker_id,
                        'name': source.name,
                        'is_default': source.is_default
                    }
                    for source in order_sources
                ],
                'order_statuses': [
                    {
                        'id': status.baselinker_id,
                        'name': status.name, 
                        'is_default': status.is_default
                    }
                    for status in order_statuses
                ],
                'payment_methods': [
                    'Przelew bankowy',  # POPRAWKA: Jako pierwszy (domyślny)
                    'Płatność przy odbiorze', 
                    'Przelewy24.pl',
                    'Gotówka'
                ],
                'delivery_methods': [
                    quote.courier_name or 'Przesyłka kurierska',
                    'Transport własny',
                    'Odbiór osobisty'  # DODANE: Opcja odbioru osobistego
                ]
            }
        })
        
    except Exception as e:
        print(f"[get_order_modal_data] Błąd: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({'error': 'Błąd pobierania danych zamówienia'}), 500

def _get_product_display_name(item, quote):
    """Generuje wyświetlaną nazwę produktu"""
    service = BaselinkerService()
    return service._translate_variant_code(item.variant_code)

def _get_finishing_details(product_index, quote):
    """Pobiera szczegóły wykończenia dla produktu"""
    # POPRAWKA: Import już jest na górze pliku
    finishing = QuoteItemDetails.query.filter_by(
        quote_id=quote.id, 
        product_index=product_index
    ).first()
    
    if not finishing or finishing.finishing_type == 'Brak':
        return None
    
    parts = [
        finishing.finishing_variant,
        finishing.finishing_type,
        finishing.finishing_color,
        finishing.finishing_gloss_level
    ]
    return ' - '.join(filter(None, parts))

@baselinker_bp.route('/api/quote/<int:quote_id>/create-order', methods=['POST'])
@login_required
def create_order(quote_id):
    """Tworzy zamówienie w Baselinker"""
    try:
        quote = Quote.query.get_or_404(quote_id)
        user_email = session.get('user_email')
        user = User.query.filter_by(email=user_email).first()
        
        if not user:
            return jsonify({'error': 'Nie znaleziono użytkownika'}), 401
        
        # Sprawdź czy wycena może być złożona
        if not quote.is_eligible_for_order():
            return jsonify({
                'error': 'Wycena nie może zostać złożona jako zamówienie',
                'details': 'Wycena musi być zaakceptowana przez klienta'
            }), 400
        
        # Sprawdź czy zamówienie już nie zostało złożone
        if quote.base_linker_order_id:
            return jsonify({
                'error': 'Zamówienie już zostało złożone',
                'order_id': quote.base_linker_order_id
            }), 400
        
        data = request.get_json()
        print(f"[create_order] Otrzymane dane: {data}", file=sys.stderr)
        
        config = {
            'order_source_id': data.get('order_source_id'),
            'order_status_id': data.get('order_status_id'),
            'payment_method': data.get('payment_method'),
            'delivery_method': data.get('delivery_method')
        }
        
        print(f"[create_order] Konfiguracja: {config}", file=sys.stderr)
        
        # Walidacja
        validation_errors = []
        
        if not config['order_source_id']:
            validation_errors.append('order_source_id jest wymagane')
        elif config['order_source_id'] == 0:
            validation_errors.append('order_source_id nie może być 0')
            
        if not config['order_status_id']:
            validation_errors.append('order_status_id jest wymagane')
            
        if not config['payment_method']:
            validation_errors.append('payment_method jest wymagane')
        
        if validation_errors:
            error_msg = f"Brakuje wymaganych danych konfiguracji: {', '.join(validation_errors)}"
            print(f"[create_order] BŁĄD WALIDACJI: {error_msg}", file=sys.stderr)
            return jsonify({'error': error_msg}), 400
        
        # Sprawdź czy source_id i status_id istnieją w bazie
        source_exists = BaselinkerConfig.query.filter_by(
            config_type='order_source',
            baselinker_id=config['order_source_id'],
            is_active=True
        ).first()
        
        status_exists = BaselinkerConfig.query.filter_by(
            config_type='order_status', 
            baselinker_id=config['order_status_id'],
            is_active=True
        ).first()
        
        if not source_exists:
            return jsonify({'error': f'Źródło zamówienia o ID {config["order_source_id"]} nie istnieje'}), 400
            
        if not status_exists:
            return jsonify({'error': f'Status zamówienia o ID {config["order_status_id"]} nie istnieje'}), 400
        
        # Utwórz zamówienie
        service = BaselinkerService()
        result = service.create_order_from_quote(quote, user.id, config)
        
        print(f"[create_order] Wynik serwisu: {result}", file=sys.stderr)
        
        if result['success']:
            # ZAKTUALIZOWANE: Zmień status wyceny na "Złożone" (ID: 4) i dodaj baselinker_order_id
            try:
                from modules.quotes.models import QuoteStatus
                from modules.calculator.models import QuoteLog
                
                # Znajdź status "Złożone"
                placed_status = QuoteStatus.query.filter_by(id=4).first()
                if placed_status:
                    old_status_id = quote.status_id
                    quote.status_id = placed_status.id
                    
                    # NOWE: Zapisz numer zamówienia Baselinker w wycenie
                    quote.base_linker_order_id = result['order_id']
                    
                    # Dodaj log zmiany statusu
                    log = QuoteLog(
                        quote_id=quote.id,
                        user_id=user.id,
                        description=f"Automatyczna zmiana statusu na '{placed_status.name}' po złożeniu zamówienia w Baselinker (#{result['order_id']})"
                    )
                    db.session.add(log)
                    
                    print(f"[create_order] Zmieniono status wyceny z {old_status_id} na {placed_status.id} ({placed_status.name})", file=sys.stderr)
                    print(f"[create_order] Zapisano numer zamówienia Baselinker: {result['order_id']}", file=sys.stderr)
                else:
                    print(f"[create_order] OSTRZEŻENIE: Nie znaleziono statusu 'Złożone' (ID: 4)", file=sys.stderr)
                
                db.session.commit()
                print(f"[create_order] Status wyceny zaktualizowany pomyślnie", file=sys.stderr)
                
            except Exception as status_error:
                print(f"[create_order] Błąd podczas zmiany statusu wyceny: {status_error}", file=sys.stderr)
                # Nie przerywamy procesu - zamówienie zostało złożone pomyślnie
            
            return jsonify({
                'success': True,
                'message': result['message'],
                'order_id': result['order_id'],
                'quote_number': quote.quote_number
            })
        else:
            return jsonify({
                'success': False,
                'error': result['error']
            }), 400
            
    except Exception as e:
        print(f"[create_order] Błąd: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({'error': 'Błąd tworzenia zamówienia'}), 500

@baselinker_bp.route('/api/sync-config')
@login_required  
def sync_config():
    """Synchronizuje konfigurację z Baselinker (źródła, statusy)"""
    try:
        service = BaselinkerService()
        
        sources_synced = service.sync_order_sources()
        statuses_synced = service.sync_order_statuses()
        
        if sources_synced and statuses_synced:
            return jsonify({
                'success': True,
                'message': 'Konfiguracja została zsynchronizowana'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Błąd synchronizacji konfiguracji'
            }), 500
            
    except Exception as e:
        print(f"[sync_config] Błąd: {e}", file=sys.stderr)
        return jsonify({'error': 'Błąd synchronizacji'}), 500

@baselinker_bp.route('/api/quote/<int:quote_id>/order-logs')
@login_required
def get_order_logs(quote_id):
    """Pobiera logi operacji Baselinker dla wyceny"""
    try:
        logs = BaselinkerOrderLog.query.filter_by(quote_id=quote_id)\
            .order_by(BaselinkerOrderLog.created_at.desc()).all()
        
        return jsonify([log.to_dict() for log in logs])
        
    except Exception as e:
        print(f"[get_order_logs] Błąd: {e}", file=sys.stderr)
        return jsonify({'error': 'Błąd pobierania logów'}), 500
    
@baselinker_bp.route('/api/order/<int:order_id>/status')
@login_required
def get_order_status(order_id):
    """Pobiera status zamówienia z Baselinker"""
    print(f"[get_order_status] Rozpoczynam pobieranie statusu dla zamówienia ID: {order_id}", file=sys.stderr)
    
    try:
        service = BaselinkerService()
        print(f"[get_order_status] Utworzono instancję BaselinkerService", file=sys.stderr)
        
        result = service.get_order_details(order_id)
        print(f"[get_order_status] Wynik z get_order_details: {result}", file=sys.stderr)
        
        if result['success']:
            print(f"[get_order_status] Sukces - dane zamówienia: {result.get('order', {})}", file=sys.stderr)
            
            # Mapuj ID statusu na nazwę (można rozszerzyć)
            status_map = {
                105112: 'Nowe - nieopłacone',
                155824: 'Nowe - opłacone',
                138619: 'W produkcji - surowe',
                148832: 'W produkcji - olejowanie',
                148831: 'W produkcji - bejcowanie',
                148830: 'W produkcji - lakierowanie',
                138620: 'Produkcja zakończona',
                138623: 'Zamówienie spakowane',
                105113: 'Paczka zgłoszona do wysyłki',
                105114: 'Wysłane - kurier',
                149763: 'Wysłane - transport WoodPower',
                149777: 'Czeka na odbiór osobisty',
                138624: 'Dostarczona - kurier',
                149778: 'Dostarczona - trans. WoodPower',
                149779: 'Odebrane',
                138625: 'Zamówienie anulowane'
            }
            
            order_status_id = result['order'].get('order_status_id')
            print(f"[get_order_status] order_status_id z Baselinker: {order_status_id}", file=sys.stderr)
            
            status_name = status_map.get(order_status_id, f'Status {order_status_id}')
            print(f"[get_order_status] Zamapowany status_name: {status_name}", file=sys.stderr)
            
            response_data = {
                'success': True,
                'status_id': order_status_id,
                'status_name': status_name
            }
            print(f"[get_order_status] Zwracam odpowiedź: {response_data}", file=sys.stderr)
            
            return jsonify(response_data)
        else:
            error_msg = result.get('error', 'Nieznany błąd')
            print(f"[get_order_status] Błąd z get_order_details: {error_msg}", file=sys.stderr)
            
            return jsonify({
                'success': False,
                'error': error_msg
            }), 400
            
    except Exception as e:
        print(f"[get_order_status] WYJĄTEK: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        
        return jsonify({'error': 'Błąd pobierania statusu zamówienia'}), 500