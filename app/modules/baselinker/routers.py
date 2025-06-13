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
        
        # POPRAWKA: Ustaw domyślne wartości dla statusów PRZED zwróceniem danych
        # Znajdź status "Nowe - nieopłacone" (ID: 105112) i ustaw jako domyślny
        default_status_set = False
        for status in order_statuses:
            if status.baselinker_id == 105112:
                status.is_default = True
                default_status_set = True
                print(f"[get_order_modal_data] ✅ Ustawiono status '{status.name}' (ID: {status.baselinker_id}) jako domyślny", file=sys.stderr)
            else:
                status.is_default = False
        
        # Jeśli nie znaleziono statusu 105112, znajdź podobny
        if not default_status_set:
            for status in order_statuses:
                if 'nowe' in status.name.lower() and 'nieopłacone' in status.name.lower():
                    status.is_default = True
                    default_status_set = True
                    print(f"[get_order_modal_data] ✅ Fallback: Ustawiono status '{status.name}' (ID: {status.baselinker_id}) jako domyślny", file=sys.stderr)
                    break
        
        if not default_status_set:
            print(f"[get_order_modal_data] ⚠️ OSTRZEŻENIE: Nie znaleziono domyślnego statusu zamówienia", file=sys.stderr)

        # Podobnie dla order_sources - ustaw pierwszy dostępny jako domyślny jeśli żaden nie jest oznaczony
        default_source_set = any(source.is_default for source in order_sources)
        if not default_source_set and order_sources:
            # Filtruj źródła z prawidłowymi ID (nie równymi 0)
            valid_sources = [source for source in order_sources if source.baselinker_id and source.baselinker_id != 0]
            if valid_sources:
                valid_sources[0].is_default = True
                print(f"[get_order_modal_data] ✅ Ustawiono pierwsze prawidłowe źródło '{valid_sources[0].name}' (ID: {valid_sources[0].baselinker_id}) jako domyślne", file=sys.stderr)
        
        # Pobierz wybrane produkty
        selected_items = [item for item in quote.items if item.is_selected]
        
        # POPRAWKA: Przygotuj dane produktów z quantity z finishing_details
        products_data = []
        for item in selected_items:
            finishing_details = QuoteItemDetails.query.filter_by(
                quote_id=quote.id, 
                product_index=item.product_index
            ).first()
            
            # POPRAWKA: Pobierz quantity z finishing_details
            quantity = finishing_details.quantity if finishing_details and finishing_details.quantity else 1
            
            # POPRAWKA: Przygotuj dane wykończenia (tak jak w modalu szczegółów)
            finishing_data = None
            if finishing_details:
                finishing_data = {
                    'variant': finishing_details.finishing_variant,
                    'type': finishing_details.finishing_type,
                    'color': finishing_details.finishing_color,
                    'gloss': finishing_details.finishing_gloss_level,  # <- POPRAWKA: finishing_gloss_level zamiast finishing_gloss
                    'quantity': finishing_details.quantity or 1,  # <- KLUCZOWE POLE
                    'brutto': float(finishing_details.finishing_price_brutto or 0),
                    'netto': float(finishing_details.finishing_price_netto or 0)
                }
            
            product_data = {
                'id': item.id,
                'name': _get_product_display_name(item, quote),
                'variant_code': item.variant_code,
                'dimensions': f"{item.length_cm}×{item.width_cm}×{item.thickness_cm} cm",
                'volume': item.volume_m3,
                'price_netto': float(item.price_netto or 0),
                'price_brutto': float(item.price_brutto or 0),
                'quantity': quantity,
                'finishing': finishing_data
            }
            
            products_data.append(product_data)
            print(f"[get_order_modal_data] Produkt {item.product_index}: quantity={quantity}, finishing_quantity={finishing_details.quantity if finishing_details else 'brak'}", file=sys.stderr)

        # Oblicz koszty
        cost_products_netto = sum(item.get_total_price_netto() for item in selected_items)
        
        # Pobierz szczegóły wykończenia bezpośrednio z bazy
        finishing_details_all = QuoteItemDetails.query.filter_by(quote_id=quote.id).all()
        cost_finishing_netto = sum(d.finishing_price_netto or 0 for d in finishing_details_all)
        cost_shipping_brutto = quote.shipping_cost_brutto or 0
        
        # Oblicz z VAT
        VAT_RATE = 0.23
        products_brutto = cost_products_netto * (1 + VAT_RATE)
        finishing_brutto = cost_finishing_netto * (1 + VAT_RATE) 
        shipping_netto = cost_shipping_brutto / (1 + VAT_RATE)
        total_brutto = products_brutto + finishing_brutto + cost_shipping_brutto
        total_netto = cost_products_netto + cost_finishing_netto + shipping_netto
        
        print(f"[get_order_modal_data] Przygotowano dane dla {len(products_data)} produktów", file=sys.stderr)
        
        return jsonify({
            'quote': {
                'id': quote.id,
                'quote_number': quote.quote_number,
                'created_at': quote.created_at.isoformat() if quote.created_at else None,
                'status': quote.quote_status.name if quote.quote_status else None,
                'source': quote.source,
                'client_id': quote.client_id  # DODANE: client_id do sekcji quote
            },
            'client': {
                'id': quote.client.id if quote.client else None,  # DODANE: ID klienta
                'name': quote.client.client_name if quote.client else None,
                'number': quote.client.client_number if quote.client else None,
                'company': quote.client.invoice_company or quote.client.delivery_company,
                'email': quote.client.email if quote.client else None,
                'phone': quote.client.phone if quote.client else None,
                'delivery_name': quote.client.client_delivery_name if quote.client else None,
                'delivery_company': quote.client.delivery_company if quote.client else None,
                'delivery_address': quote.client.delivery_address if quote.client else None,
                'delivery_postcode': quote.client.delivery_zip if quote.client else None,
                'delivery_city': quote.client.delivery_city if quote.client else None,
                'delivery_region': quote.client.delivery_region if quote.client else None,
                'invoice_name': quote.client.invoice_name if quote.client else None,
                'invoice_company': quote.client.invoice_company if quote.client else None,
                'invoice_nip': quote.client.invoice_nip if quote.client else None,
                'invoice_address': quote.client.invoice_address if quote.client else None,
                'invoice_postcode': quote.client.invoice_zip if quote.client else None,
                'invoice_city': quote.client.invoice_city if quote.client else None,
                'invoice_region': quote.client.invoice_region if quote.client else None,
                'want_invoice': bool(quote.client.invoice_nip) if quote.client else False
            },
            'products': products_data,  # <- POPRAWKA: Używamy nowej listy z quantity
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
    """Tworzy zamówienie w Baselinker z obsługą danych klienta"""
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
        
        # NOWE: Pobierz dane klienta z żądania
        client_data = data.get('client_data')
        
        print(f"[create_order] Konfiguracja: {config}", file=sys.stderr)
        print(f"[create_order] Dane klienta: {client_data}", file=sys.stderr)
        
        # Walidacja konfiguracji
        validation_errors = []
        
        if config['order_source_id'] is None or config['order_source_id'] == '':
            validation_errors.append('order_source_id jest wymagane')
        else:
            try:
                config['order_source_id'] = int(config['order_source_id'])
                print(f"[create_order] ✅ Prawidłowe order_source_id: {config['order_source_id']}", file=sys.stderr)
            except (ValueError, TypeError):
                validation_errors.append('order_source_id musi być liczbą')
            
        if not config['order_status_id']:
            validation_errors.append('order_status_id jest wymagane')
        else:
            try:
                config['order_status_id'] = int(config['order_status_id'])
            except (ValueError, TypeError):
                validation_errors.append('order_status_id musi być liczbą')
            
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
            print(f"[create_order] ❌ Źródło o ID {config['order_source_id']} nie istnieje w bazie", file=sys.stderr)
            return jsonify({'error': f'Źródło zamówienia o ID {config["order_source_id"]} nie istnieje'}), 400
            
        if not status_exists:
            print(f"[create_order] ❌ Status o ID {config['order_status_id']} nie istnieje w bazie", file=sys.stderr)
            return jsonify({'error': f'Status zamówienia o ID {config["order_status_id"]} nie istnieje'}), 400
        
        print(f"[create_order] ✅ Walidacja przeszła - źródło: {source_exists.name}, status: {status_exists.name}", file=sys.stderr)
        
        # NOWE: Zaktualizuj dane klienta jeśli zostały przesłane
        if client_data:
            try:
                from modules.calculator.models import Client
                
                client = quote.client
                if client:
                    print(f"[create_order] Aktualizacja danych klienta ID: {client.id}", file=sys.stderr)
                    
                    # Zaktualizuj podstawowe dane
                    if client_data.get('delivery_name'):
                        client.name = client_data['delivery_name']
                    if client_data.get('email'):
                        client.email = client_data['email']
                    if client_data.get('phone'):
                        client.phone = client_data['phone']
                    
                    # Zaktualizuj dane dostawy
                    if client_data.get('delivery_company'):
                        client.company = client_data['delivery_company']
                    if client_data.get('delivery_address'):
                        client.delivery_address = client_data['delivery_address']
                    if client_data.get('delivery_postcode'):
                        client.delivery_postcode = client_data['delivery_postcode']
                    if client_data.get('delivery_city'):
                        client.delivery_city = client_data['delivery_city']
                    if client_data.get('delivery_region'):
                        client.delivery_region = client_data['delivery_region']
                    
                    # Zaktualizuj dane fakturowe
                    if client_data.get('invoice_name'):
                        client.invoice_name = client_data['invoice_name']
                    if client_data.get('invoice_company'):
                        client.invoice_company = client_data['invoice_company']
                    if client_data.get('invoice_nip'):
                        client.invoice_nip = client_data['invoice_nip']
                    if client_data.get('invoice_address'):
                        client.invoice_address = client_data['invoice_address']
                    if client_data.get('invoice_postcode'):
                        client.invoice_postcode = client_data['invoice_postcode']
                    if client_data.get('invoice_city'):
                        client.invoice_city = client_data['invoice_city']
                    if client_data.get('invoice_region'):
                        client.invoice_region = client_data['invoice_region']
                    
                    db.session.commit()
                    print(f"[create_order] ✅ Dane klienta zaktualizowane pomyślnie", file=sys.stderr)
                
            except Exception as e:
                print(f"[create_order] ⚠️ Błąd podczas aktualizacji danych klienta: {e}", file=sys.stderr)
                db.session.rollback()
                # Nie przerywamy procesu - kontynuujemy z tworzeniem zamówienia
        
        # Utwórz zamówienie
        service = BaselinkerService()
        result = service.create_order_from_quote(quote, user.id, config)
        
        print(f"[create_order] Wynik serwisu: {result}", file=sys.stderr)
        
        if result['success']:
            # Zaktualizuj status wyceny na "Złożone" (ID: 4)
            try:
                from modules.quotes.models import QuoteStatus
                ordered_status = QuoteStatus.query.filter_by(id=4).first()
                if ordered_status:
                    quote.status_id = ordered_status.id
                    db.session.commit()
                    print(f"[create_order] ✅ Status wyceny zmieniony na: {ordered_status.name}", file=sys.stderr)
                else:
                    print(f"[create_order] ⚠️ Nie znaleziono statusu 'Złożone' (ID: 4)", file=sys.stderr)
            except Exception as e:
                print(f"[create_order] ⚠️ Błąd podczas zmiany statusu wyceny: {e}", file=sys.stderr)
            
            return jsonify({
                'success': True,
                'order_id': result['order_id'],
                'quote_number': quote.quote_number,
                'message': 'Zamówienie zostało pomyślnie utworzone w Baselinker'
            })
        else:
            return jsonify({
                'success': False,
                'error': result.get('error', 'Nieznany błąd podczas tworzenia zamówienia')
            }), 500
        
    except Exception as e:
        print(f"[create_order] 💥 Nieoczekiwany błąd: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'Błąd serwera: {str(e)}'
        }), 500

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