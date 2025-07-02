# modules/preview3d_ar/routers.py
from flask import jsonify, request, render_template, current_app
from . import preview3d_ar_bp
from .models import TextureConfig
from modules.calculator.models import Quote, QuoteItem, QuoteItemDetails
from extensions import db
from sqlalchemy.orm import joinedload
import sys

@preview3d_ar_bp.route('/api/product-3d', methods=['POST'])
def generate_product_3d():
    """
    API endpoint do generowania konfiguracji 3D dla produktu
    
    Obsługuje dane z kalkulatora i quotes w formacie:
    - Kalkulator: {"variant": "dab-lity-ab", "dimensions": {"length": 200, "width": 80, "thickness": 3}, "quantity": 1}
    - Quotes: {"variant_code": "dab-lity-ab", "length_cm": 200, "width_cm": 80, "thickness_cm": 3, "quantity": 1}
    """
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Uniwersalne parsowanie danych z różnych źródeł
        variant_code = data.get('variant') or data.get('variant_code')
        if not variant_code:
            return jsonify({'error': 'Missing variant code'}), 400
            
        # Parsowanie wymiarów z różnych formatów
        dimensions = {}
        if 'dimensions' in data:
            # Format z kalkulatora
            dims = data['dimensions']
            dimensions = {
                'length': dims.get('length', 0),
                'width': dims.get('width', 0), 
                'thickness': dims.get('thickness', 0)
            }
        else:
            # Format z quotes
            dimensions = {
                'length': data.get('length') or data.get('length_cm', 0),
                'width': data.get('width') or data.get('width_cm', 0),
                'thickness': data.get('thickness') or data.get('thickness_cm', 0)
            }
        
        quantity = data.get('quantity', 1)
        
        # Walidacja wymiarów
        if not all(dimensions.values()) or any(d <= 0 for d in dimensions.values()):
            return jsonify({'error': 'Invalid dimensions'}), 400
        
        # Pobierz tekstury dla wariantu z fallbackiem
        try:
            # Najpierw spróbuj standardową metodę
            textures = TextureConfig.get_all_textures_for_variant(variant_code)
            species, technology, wood_class = TextureConfig.parse_variant(variant_code)
            
            # Sprawdź czy są dostępne tekstury, jeśli nie - dodaj fallback
            for surf in ['face', 'edge', 'side']:
                if surf not in textures:
                    textures[surf] = {'variants': [], 'fallback_color': '#D0D0D0'}
                    
                # Jeśli brak wariantów, dodaj fallback SVG
                if not textures[surf].get('variants'):
                    fallback_colors = {'face': '#D0D0D0', 'edge': '#B0B0B0', 'side': '#909090'}
                    color = fallback_colors.get(surf, '#C0C0C0')
                    fallback_url = f'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="{color}"/></svg>'
                    textures[surf]['variants'] = [fallback_url]
                
        except Exception as e:
            print(f"[Preview3D] Texture error: {str(e)}", file=sys.stderr)
            # Ostateczny fallback - podstawowe kolory
            textures = {
                'face': {'variants': ['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#D0D0D0"/></svg>'], 'fallback_color': '#D0D0D0'},
                'edge': {'variants': ['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#B0B0B0"/></svg>'], 'fallback_color': '#B0B0B0'},
                'side': {'variants': ['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#909090"/></svg>'], 'fallback_color': '#909090'}
            }
            species, technology, wood_class = 'unknown', 'unknown', 'unknown'
        
        # Przygotuj odpowiedź w formacie zgodnym z WoodViewer
        response_data = {
            'geometry': {
                'type': 'box',
                'dimensions': dimensions,
                'quantity': quantity
            },
            'materials': textures,
            'metadata': {
                'variant_code': variant_code,
                'species': species,
                'technology': technology,
                'wood_class': wood_class
            }
        }
        
        print(f"[Preview3D] Generated 3D config for {variant_code}: {dimensions}", file=sys.stderr)
        texture_summary = [f'{k}:{len(v.get("variants", []))}' for k, v in textures.items()]
        print(f"[Preview3D] Textures: {texture_summary}", file=sys.stderr)
        return jsonify(response_data)
        
    except Exception as e:
        print(f"[Preview3D] Error generating 3D config: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/check-textures/<variant>')
def check_textures(variant):
    """
    Sprawdza dostępność tekstur dla danego wariantu (endpoint diagnostyczny)
    """
    try:
        textures = TextureConfig.get_all_textures_for_variant(variant)
        species, technology, wood_class = TextureConfig.parse_variant(variant)
        
        return jsonify({
            'variant_code': variant,
            'parsed': {
                'species': species,
                'technology': technology, 
                'wood_class': wood_class
            },
            'textures': textures,
            'available_count': sum(1 for tex in textures.values() if tex['exists'])
        })
        
    except ValueError as e:
        return jsonify({'error': f'Invalid variant: {str(e)}'}), 400
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@preview3d_ar_bp.route('/quote/<int:quote_id>')
def show_quote_3d_viewer(quote_id):
    """
    Nowy endpoint dla wycen - wyświetla viewer 3D z możliwością przełączania między produktami
    """
    try:
        print(f"[show_quote_3d_viewer] Starting for quote_id: {quote_id}", file=sys.stderr)
        
        # Pobierz wycenę z produktami
        quote = db.session.query(Quote)\
            .options(joinedload(Quote.client))\
            .filter_by(id=quote_id).first()
        
        if not quote:
            print(f"[show_quote_3d_viewer] Quote not found: {quote_id}", file=sys.stderr)
            return jsonify({'error': 'Quote not found'}), 404
        
        print(f"[show_quote_3d_viewer] Found quote: {quote.quote_number}", file=sys.stderr)
        
        # Pobierz wszystkie produkty z wyceny pogrupowane po product_index
        quote_items = db.session.query(QuoteItem)\
            .filter_by(quote_id=quote_id)\
            .order_by(QuoteItem.product_index, QuoteItem.variant_code)\
            .all()
        
        print(f"[show_quote_3d_viewer] Found {len(quote_items)} items", file=sys.stderr)
        
        if not quote_items:
            return jsonify({'error': 'No products found in quote'}), 404
        
        # Debug każdego itemu
        for item in quote_items:
            try:
                quantity = item.get_quantity()
                print(f"[show_quote_3d_viewer] Item: {item.variant_code}, index: {item.product_index}, qty: {quantity}", file=sys.stderr)
            except Exception as e:
                print(f"[show_quote_3d_viewer] Error getting quantity for item {item.id}: {str(e)}", file=sys.stderr)
        
        # Grupuj produkty po product_index
        products = {}
        for item in quote_items:
            if item.product_index not in products:
                products[item.product_index] = {
                    'product_index': item.product_index,
                    'dimensions': {
                        'length': float(item.length_cm),
                        'width': float(item.width_cm),
                        'thickness': float(item.thickness_cm)
                    },
                    'variants': []
                }
            
            # Sprawdź dostępność tekstur dla wariantu
            try:
                textures = TextureConfig.get_all_textures_for_variant(item.variant_code)
                has_textures = any(len(tex.get('variants', [])) > 0 for tex in textures.values())
                print(f"[show_quote_3d_viewer] Variant {item.variant_code} has_textures: {has_textures}", file=sys.stderr)
            except Exception as e:
                print(f"[show_quote_3d_viewer] Error checking textures for {item.variant_code}: {str(e)}", file=sys.stderr)
                has_textures = False
            
            try:
                quantity = item.get_quantity()
            except:
                quantity = 1
                
            products[item.product_index]['variants'].append({
                'id': item.id,
                'variant_code': item.variant_code,
                'is_selected': item.is_selected,
                'quantity': quantity,
                'price_brutto': float(item.get_total_price_brutto()),
                'has_textures': has_textures
            })
        
        # Sortuj produkty po indeksie
        sorted_products = sorted(products.values(), key=lambda x: x['product_index'])
        print(f"[show_quote_3d_viewer] Created {len(sorted_products)} product groups", file=sys.stderr)
        
        # Znajdź domyślnie wybrany produkt (pierwszy z wybranym wariantem lub pierwszy dostępny)
        default_product = None
        for product in sorted_products:
            selected_variant = next((v for v in product['variants'] if v['is_selected']), None)
            if selected_variant and selected_variant['has_textures']:
                default_product = {
                    'product_index': product['product_index'],
                    'variant_code': selected_variant['variant_code'],
                    'dimensions': product['dimensions']
                }
                print(f"[show_quote_3d_viewer] Found default product: {default_product}", file=sys.stderr)
                break
        
        if not default_product:
            # Fallback - pierwszy produkt z dostępnymi teksturami
            for product in sorted_products:
                for variant in product['variants']:
                    if variant['has_textures']:
                        default_product = {
                            'product_index': product['product_index'],
                            'variant_code': variant['variant_code'],
                            'dimensions': product['dimensions']
                        }
                        print(f"[show_quote_3d_viewer] Fallback default product: {default_product}", file=sys.stderr)
                        break
                if default_product:
                    break
        
        if not default_product:
            print("[show_quote_3d_viewer] No products with textures found", file=sys.stderr)
            return render_template(
                'preview3d_ar/templates/quote_3d_viewer.html',
                quote={'quote_number': quote.quote_number, 'id': quote_id, 'client': quote.client},
                products=[],
                default_product=None,
                error_message="Brak produktów z dostępnymi teksturami w tej wycenie"
            )
        
        print(f"[show_quote_3d_viewer] Rendering template with default_product: {default_product}", file=sys.stderr)
        return render_template(
            'preview3d_ar/templates/quote_3d_viewer.html',
            quote=quote,
            products=sorted_products,
            default_product=default_product
        )
        
    except Exception as e:
        print(f"[show_quote_3d_viewer] Error: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@preview3d_ar_bp.route('/modal')
def show_3d_modal():
    """
    Modal z 3D viewerem (fallback dla desktop i Android) - zachowujemy kompatybilność
    """
    return render_template('preview3d_ar/templates/3d_modal.html')

@preview3d_ar_bp.route('/test')
def test_endpoint():
    """
    Endpoint testowy do sprawdzania czy moduł działa
    """
    return jsonify({
        'module': 'preview3d_ar',
        'status': 'active',
        'endpoints': [
            '/api/product-3d [POST]',
            '/api/check-textures/<variant> [GET]',
            '/quote/<quote_id> [GET]',
            '/modal [GET]',
            '/test [GET]'
        ]
    })

# Obsługa błędów 404 dla tego blueprintu
@preview3d_ar_bp.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found in preview3d_ar module'}), 404