# app/modules/baselinker/routers.py
from flask import render_template, jsonify, request, session, redirect, url_for, flash
from . import baselinker_bp
from .service import BaselinkerService
from .models import BaselinkerOrderLog, BaselinkerConfig
from modules.calculator.models import Quote, User
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
        
        # Oblicz koszty
        selected_items = [item for item in quote.items if item.is_selected]
        cost_products_netto = sum(item.final_price_netto or 0 for item in selected_items)
        cost_finishing_netto = sum(d.finishing_price_netto or 0 for d in quote.finishing_details)
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
                'total_netto': round(total_netto, 2),      # <-- DODAJ TĘ LINIĘ
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
                    'Przelew bankowy',
                    'Płatność przy odbiorze', 
                    'Karta płatnicza',
                    'BLIK'
                ],
                'delivery_methods': [
                    quote.courier_name or 'DPD',
                    'InPost',
                    'UPS',
                    'Odbior osobisty'
                ]
            }
        })
        
    except Exception as e:
        print(f"[get_order_modal_data] Błąd: {e}", file=sys.stderr)
        return jsonify({'error': 'Błąd pobierania danych zamówienia'}), 500

def _get_product_display_name(item, quote):
    """Generuje wyświetlaną nazwę produktu"""
    service = BaselinkerService()
    return service._translate_variant_code(item.variant_code)

def _get_finishing_details(product_index, quote):
    """Pobiera szczegóły wykończenia dla produktu"""
    from modules.calculator.models import QuoteItemDetails
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
        config = {
            'order_source_id': data.get('order_source_id'),
            'order_status_id': data.get('order_status_id'),
            'payment_method': data.get('payment_method'),
            'delivery_method': data.get('delivery_method')
        }
        
        # Walidacja wymaganych pól
        if not all([config['order_source_id'], config['order_status_id']]):
            return jsonify({'error': 'Brakuje wymaganych danych konfiguracji'}), 400
        
        # Utwórz zamówienie
        service = BaselinkerService()
        result = service.create_order_from_quote(quote, user.id, config)
        
        if result['success']:
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