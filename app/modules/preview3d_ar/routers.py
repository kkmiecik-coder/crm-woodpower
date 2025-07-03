# modules/preview3d_ar/routers.py
from flask import jsonify, request, render_template, current_app, send_file, send_from_directory, url_for, make_response, abort
from . import preview3d_ar_bp
from .models import TextureConfig, AR3DGenerator
from modules.calculator.models import Quote, QuoteItem, QuoteItemDetails
from extensions import db
from sqlalchemy.orm import joinedload
import sys
import os
import mimetypes

# Globalna instancja generatora AR
ar_generator = None

mimetypes.add_type('model/vnd.usd+zip', '.usdz')

@preview3d_ar_bp.route('/api/product-3d', methods=['POST'])
def generate_product_3d():
    """
    API endpoint do generowania konfiguracji 3D dla produktu
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
    """Sprawdza dostępność tekstur dla danego wariantu"""
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

def get_ar_generator():
    """Lazy initialization generatora AR"""
    global ar_generator
    if ar_generator is None:
        ar_generator = AR3DGenerator()
    return ar_generator

@preview3d_ar_bp.route('/api/generate-usdz', methods=['POST'])
def generate_usdz():
    """
    Generuje plik USDZ dla iOS QuickLook AR - POPRAWIONA WERSJA
    """
    try:
        print(f"[generate_usdz] Rozpoczęcie generowania USDZ", file=sys.stderr)
        
        data = request.json
        if not data:
            return jsonify({'error': 'Brak danych JSON'}), 400
        
        variant_code = data.get('variant_code')
        dimensions = data.get('dimensions')
        
        if not variant_code:
            return jsonify({'error': 'Brak variant_code'}), 400
        
        if not dimensions:
            return jsonify({'error': 'Brak dimensions'}), 400
        
        print(f"[generate_usdz] Dane: {variant_code}, {dimensions}", file=sys.stderr)
        
        # Pobierz tekstury przez istniejącą metodę
        try:
            textures = TextureConfig.get_all_textures_for_variant(variant_code)
            print(f"[generate_usdz] Tekstury pobrane: {len(textures)} typów", file=sys.stderr)
        except Exception as e:
            print(f"[generate_usdz] Błąd tekstur: {e}", file=sys.stderr)
            return jsonify({'error': f'Błąd tekstur: {str(e)}'}), 500
        
        # Przygotuj dane produktu
        product_data = {
            'variant_code': variant_code,
            'dimensions': dimensions,
            'textures': textures
        }
        
        # Generuj USDZ
        generator = get_ar_generator()
        usdz_path = generator.generate_usdz(product_data)
        
        if not usdz_path or not os.path.exists(usdz_path):
            return jsonify({'error': 'Błąd generowania pliku USDZ'}), 500
        
        # KLUCZOWA POPRAWKA: Zwróć pełny URL z protokołem
        filename = os.path.basename(usdz_path)
        
        # Zbuduj pełny URL z protokołem i hostem
        file_url = request.url_root.rstrip('/') + url_for('preview3d_ar.serve_ar_model', filename=filename)
        
        # Pobierz informacje o pliku
        model_info = generator.get_model_info(usdz_path)
        
        print(f"[generate_usdz] USDZ wygenerowany: {filename}", file=sys.stderr)
        print(f"[generate_usdz] Pełny URL: {file_url}", file=sys.stderr)
        
        return jsonify({
            'success': True,
            'usdz_url': file_url,
            'filename': filename,
            'model_info': model_info
        })
        
    except Exception as e:
        print(f"[generate_usdz] Błąd: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/generate-glb', methods=['POST'])
def generate_glb():
    """
    Generuje plik GLB dla Android WebXR AR
    
    Oczekuje JSON:
    {
        "variant_code": "dab-lity-ab",
        "dimensions": {"length": 200, "width": 80, "thickness": 3}
    }
    """
    try:
        print(f"[generate_glb] Rozpoczęcie generowania GLB", file=sys.stderr)
        
        data = request.json
        if not data:
            return jsonify({'error': 'Brak danych JSON'}), 400
        
        variant_code = data.get('variant_code')
        dimensions = data.get('dimensions')
        
        if not variant_code:
            return jsonify({'error': 'Brak variant_code'}), 400
        
        if not dimensions:
            return jsonify({'error': 'Brak dimensions'}), 400
        
        print(f"[generate_glb] Dane: {variant_code}, {dimensions}", file=sys.stderr)
        
        # Pobierz tekstury przez istniejącą metodę
        try:
            textures = TextureConfig.get_all_textures_for_variant(variant_code)
            print(f"[generate_glb] Tekstury pobrane: {len(textures)} typów", file=sys.stderr)
        except Exception as e:
            print(f"[generate_glb] Błąd tekstur: {e}", file=sys.stderr)
            return jsonify({'error': f'Błąd tekstur: {str(e)}'}), 500
        
        # Przygotuj dane produktu
        product_data = {
            'variant_code': variant_code,
            'dimensions': dimensions,
            'textures': textures
        }
        
        # Generuj GLB
        generator = get_ar_generator()
        glb_path = generator.generate_glb(product_data)
        
        if not glb_path or not os.path.exists(glb_path):
            return jsonify({'error': 'Błąd generowania pliku GLB'}), 500
        
        # Zwróć URL do pliku
        filename = os.path.basename(glb_path)
        file_url = url_for('preview3d_ar.serve_ar_model', filename=filename)
        
        # Pobierz informacje o pliku
        model_info = generator.get_model_info(glb_path)
        
        print(f"[generate_glb] GLB wygenerowany: {filename}", file=sys.stderr)
        
        return jsonify({
            'success': True,
            'glb_url': file_url,
            'filename': filename,
            'model_info': model_info
        })
        
    except Exception as e:
        print(f"[generate_glb] Błąd: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/ar-models/<filename>')
def serve_ar_model(filename):
    """
    Serwuje pliki 3D dla AR (USDZ i GLB).
    Dla .usdz ustawia Content-Type model/vnd.usd+zip i inline disposition,
    dzięki czemu Safari Quick Look powinien próbować otworzyć model zamiast pobierać.
    """
    try:
        # Ścieżka do katalogu z cache plików AR
        cache_dir = os.path.join(
            current_app.root_path,
            'modules', 'preview3d_ar', 'static', 'ar-models', 'cache'
        )
        file_path = os.path.join(cache_dir, filename)

        # Sprawdzenie, czy plik istnieje
        if not os.path.exists(file_path):
            abort(404)

        # Rozszerzenie pliku (w małych literach)
        _, ext = os.path.splitext(filename.lower())

        # Obsługa USDZ
        if ext == '.usdz':
            response = make_response(send_file(
                file_path,
                as_attachment=False,
                download_name=filename
            ))
            response.headers['Content-Type'] = 'model/vnd.usd+zip'
            response.headers['Content-Disposition'] = f'inline; filename="{filename}"'
            response.headers['Cache-Control'] = 'public, max-age=3600'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response

        # Obsługa GLB
        elif ext == '.glb':
            response = make_response(send_file(
                file_path,
                as_attachment=False,
                download_name=filename
            ))
            response.headers['Content-Type'] = 'model/gltf-binary'
            response.headers['Content-Disposition'] = f'inline; filename="{filename}"'
            response.headers['Cache-Control'] = 'public, max-age=3600'
            return response

        # Inne pliki - po prostu wyślij
        else:
            return send_file(
                file_path,
                as_attachment=False,
                download_name=filename
            )

    except Exception as e:
        # Logujemy błąd po stronie serwera
        print(f"[serve_ar_model] Błąd: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500


@preview3d_ar_bp.route('/api/ar-info', methods=['GET'])
def ar_info():
    """
    Zwraca informacje o możliwościach AR
    """
    try:
        generator = get_ar_generator()
        
        # Sprawdź dostępne formaty
        formats = ['GLB', 'OBJ']  # USDZ dodamy później
        
        # Sprawdź cache
        cache_files = []
        if os.path.exists(generator.cache_dir):
            cache_files = os.listdir(generator.cache_dir)
        
        return jsonify({
            'ar_enabled': True,
            'supported_formats': formats,
            'cache_files': len(cache_files),
            'cache_dir': generator.cache_dir,
            'temp_dir': generator.temp_dir
        })
        
    except Exception as e:
        print(f"[ar_info] Błąd: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/ar-cleanup', methods=['POST'])
def ar_cleanup():
    """
    Czyści pliki tymczasowe AR
    """
    try:
        generator = get_ar_generator()
        generator.cleanup_temp_files()
        
        return jsonify({
            'success': True,
            'message': 'Pliki tymczasowe wyczyszczone'
        })
        
    except Exception as e:
        print(f"[ar_cleanup] Błąd: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500