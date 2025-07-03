# modules/preview3d_ar/routers.py - KOMPLETNA NAPRAWIONA WERSJA

from flask import jsonify, request, render_template, current_app, send_file, send_from_directory, url_for, make_response, abort
from . import preview3d_ar_bp
from .models import TextureConfig, RealityGenerator
from modules.calculator.models import Quote, QuoteItem, QuoteItemDetails
from extensions import db
from sqlalchemy.orm import joinedload
import sys
import os
import mimetypes

# Globalna instancja generatora Reality
reality_generator = None

# Dodaj MIME types dla Reality
mimetypes.add_type('model/vnd.reality', '.reality')
mimetypes.add_type('model/vnd.usdz+zip', '.usdz')

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
            dims = data['dimensions']
            dimensions = {
                'length': dims.get('length', 0),
                'width': dims.get('width', 0), 
                'thickness': dims.get('thickness', 0)
            }
        else:
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
            textures = TextureConfig.get_all_textures_for_variant(variant_code)
            species, technology, wood_class = TextureConfig.parse_variant(variant_code)
            
            # Sprawdź czy są dostępne tekstury, jeśli nie - dodaj fallback
            for surf in ['face', 'edge', 'side']:
                if surf not in textures:
                    textures[surf] = {'variants': [], 'fallback_color': '#D0D0D0'}
                    
                if not textures[surf].get('variants'):
                    fallback_colors = {'face': '#D0D0D0', 'edge': '#B0B0B0', 'side': '#909090'}
                    color = fallback_colors.get(surf, '#C0C0C0')
                    fallback_url = f'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="{color}"/></svg>'
                    textures[surf]['variants'] = [fallback_url]
                
        except Exception as e:
            print(f"[Preview3D] Texture error: {str(e)}", file=sys.stderr)
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
        return jsonify(response_data)
        
    except Exception as e:
        print(f"[Preview3D] Error generating 3D config: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/generate-reality', methods=['POST'])
def generate_reality():
    """
    NOWY: Generuje plik Reality dla iOS QuickLook AR
    """
    try:
        print("[generate_reality] Rozpoczecie generowania Reality", file=sys.stderr)
        
        data = request.json
        if not data:
            return jsonify({'error': 'Brak danych JSON'}), 400
        
        variant_code = data.get('variant_code')
        dimensions = data.get('dimensions')
        
        if not variant_code:
            return jsonify({'error': 'Brak variant_code'}), 400
        
        if not dimensions:
            return jsonify({'error': 'Brak dimensions'}), 400
        
        print(f"[generate_reality] Dane: {variant_code}, {dimensions}", file=sys.stderr)
        
        # Pobierz tekstury
        try:
            textures = TextureConfig.get_all_textures_for_variant(variant_code)
            print(f"[generate_reality] Tekstury pobrane: {len(textures)} typow", file=sys.stderr)
        except Exception as e:
            print(f"[generate_reality] Blad tekstur: {e}", file=sys.stderr)
            return jsonify({'error': f'Blad tekstur: {str(e)}'}), 500
        
        # Przygotuj dane produktu
        product_data = {
            'variant_code': variant_code,
            'dimensions': dimensions,
            'textures': textures
        }
        
        # Generuj Reality
        generator = get_reality_generator()
        reality_path = generator.generate_reality(product_data)
        
        if not reality_path or not os.path.exists(reality_path):
            return jsonify({'error': 'Blad generowania pliku Reality'}), 500
        
        # Zwroc pelny URL z protokolem
        filename = os.path.basename(reality_path)
        file_url = request.url_root.rstrip('/') + url_for('preview3d_ar.serve_ar_model', filename=filename)
        
        # Pobierz informacje o pliku
        model_info = generator.get_model_info(reality_path)
        
        print(f"[generate_reality] Reality wygenerowany: {filename}", file=sys.stderr)
        
        return jsonify({
            'success': True,
            'reality_url': file_url,
            'filename': filename,
            'model_info': model_info,
            'format': 'Reality'
        })
        
    except Exception as e:
        print(f"[generate_reality] Blad: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({'error': f'Blad serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/generate-usdz', methods=['POST'])
def generate_usdz():
    """
    BACKWARD COMPATIBILITY: Uzywa nowego generatora Reality ale zwraca jako USDZ
    """
    try:
        print("[generate_usdz] DEPRECATED: Przekierowanie do Reality generator", file=sys.stderr)
        
        data = request.json
        if not data:
            return jsonify({'error': 'Brak danych JSON'}), 400
        
        variant_code = data.get('variant_code')
        dimensions = data.get('dimensions')
        
        if not variant_code or not dimensions:
            return jsonify({'error': 'Brak variant_code lub dimensions'}), 400
        
        # Uzyj nowego generatora
        generator = get_reality_generator()
        
        product_data = {
            'variant_code': variant_code,
            'dimensions': dimensions,
            'textures': TextureConfig.get_all_textures_for_variant(variant_code)
        }
        
        reality_path = generator.generate_reality(product_data)
        
        if not reality_path or not os.path.exists(reality_path):
            return jsonify({'error': 'Blad generowania pliku'}), 500
        
        # Skopiuj .reality jako .usdz dla backward compatibility
        cache_key = generator._generate_cache_key(product_data)
        usdz_path = os.path.join(generator.cache_dir, f"{cache_key}.usdz")
        
        import shutil
        shutil.copy2(reality_path, usdz_path)
        
        filename = os.path.basename(usdz_path)
        file_url = request.url_root.rstrip('/') + url_for('preview3d_ar.serve_ar_model', filename=filename)
        model_info = generator.get_model_info(usdz_path)
        
        print(f"[generate_usdz] Backward compatibility USDZ: {filename}", file=sys.stderr)
        
        return jsonify({
            'success': True,
            'usdz_url': file_url,
            'filename': filename,
            'model_info': model_info
        })
        
    except Exception as e:
        print(f"[generate_usdz] Blad: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Blad serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/ar-models/<filename>')
def serve_ar_model(filename):
    """
    POPRAWIONY: Serwuje pliki 3D dla AR z obsluga Reality format
    """
    try:
        cache_dir = os.path.join(
            current_app.root_path,
            'modules', 'preview3d_ar', 'static', 'ar-models', 'cache'
        )
        file_path = os.path.join(cache_dir, filename)

        if not os.path.exists(file_path):
            abort(404)

        _, ext = os.path.splitext(filename.lower())

        # NOWE: Obsluga plikow Reality
        if ext == '.reality':
            file_size = os.path.getsize(file_path)
            print(f"[serve_ar_model] Serving Reality: {filename}, size: {file_size} bytes", file=sys.stderr)
            
            response = make_response(send_file(
                file_path,
                as_attachment=False,
                download_name=filename,
                mimetype='model/vnd.reality'
            ))
            
            response.headers['Content-Type'] = 'model/vnd.reality'
            response.headers['Content-Disposition'] = f'inline; filename="{filename}"'
            response.headers['Content-Length'] = str(file_size)
            response.headers['Accept-Ranges'] = 'bytes'
            response.headers['Cache-Control'] = 'public, max-age=3600'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['X-AR-Model'] = 'true'
            response.headers['X-AR-Format'] = 'Reality'
            response.headers['X-iOS-QuickLook'] = 'true'
            
            return response

        # POPRAWIONE: Obsluga USDZ z prawidlowym MIME type
        elif ext == '.usdz':
            file_size = os.path.getsize(file_path)
            print(f"[serve_ar_model] Serving USDZ: {filename}, size: {file_size} bytes", file=sys.stderr)
            
            response = make_response(send_file(
                file_path,
                as_attachment=False,
                download_name=filename,
                mimetype='model/vnd.usdz+zip'
            ))
            
            response.headers['Content-Type'] = 'model/vnd.usdz+zip'
            response.headers['Content-Disposition'] = f'inline; filename="{filename}"'
            response.headers['Content-Length'] = str(file_size)
            response.headers['Accept-Ranges'] = 'bytes'
            response.headers['Cache-Control'] = 'public, max-age=3600'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['X-AR-Model'] = 'true'
            response.headers['X-AR-Format'] = 'USDZ'
            
            return response

        # Obsluga GLB
        elif ext == '.glb':
            response = make_response(send_file(
                file_path,
                as_attachment=False,
                download_name=filename,
                mimetype='model/gltf-binary'
            ))
            response.headers['Content-Type'] = 'model/gltf-binary'
            response.headers['Cache-Control'] = 'public, max-age=3600'
            return response

        else:
            return send_file(file_path, as_attachment=False, download_name=filename)

    except Exception as e:
        print(f"[serve_ar_model] Blad: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Blad serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/check-textures/<variant>')
def check_textures(variant):
    """Sprawdza dostepnosc tekstur dla danego wariantu"""
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
            'available_count': sum(1 for tex in textures.values() if tex.get('variants'))
        })
        
    except ValueError as e:
        return jsonify({'error': f'Invalid variant: {str(e)}'}), 400
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@preview3d_ar_bp.route('/quote/<int:quote_id>')
def show_quote_3d_viewer(quote_id):
    """
    Endpoint dla wycen - wyswietla viewer 3D
    """
    try:
        print(f"[show_quote_3d_viewer] Starting for quote_id: {quote_id}", file=sys.stderr)
        
        quote = db.session.query(Quote)\
            .options(joinedload(Quote.client))\
            .filter_by(id=quote_id).first()
        
        if not quote:
            return jsonify({'error': 'Quote not found'}), 404
        
        quote_items = db.session.query(QuoteItem)\
            .filter_by(quote_id=quote_id)\
            .order_by(QuoteItem.product_index, QuoteItem.variant_code)\
            .all()
        
        if not quote_items:
            return jsonify({'error': 'No products found in quote'}), 404
        
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
            
            # Sprawdz dostepnosc tekstur
            try:
                textures = TextureConfig.get_all_textures_for_variant(item.variant_code)
                has_textures = any(len(tex.get('variants', [])) > 0 for tex in textures.values())
            except Exception:
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
        
        # Sortuj produkty
        sorted_products = sorted(products.values(), key=lambda x: x['product_index'])
        
        # Znajdz domyslnie wybrany produkt
        default_product = None
        for product in sorted_products:
            selected_variant = next((v for v in product['variants'] if v['is_selected']), None)
            if selected_variant and selected_variant['has_textures']:
                default_product = {
                    'product_index': product['product_index'],
                    'variant_code': selected_variant['variant_code'],
                    'dimensions': product['dimensions']
                }
                break
        
        if not default_product:
            # Fallback - pierwszy produkt z dostepnymi teksturami
            for product in sorted_products:
                for variant in product['variants']:
                    if variant['has_textures']:
                        default_product = {
                            'product_index': product['product_index'],
                            'variant_code': variant['variant_code'],
                            'dimensions': product['dimensions']
                        }
                        break
                if default_product:
                    break
        
        if not default_product:
            return render_template(
                'preview3d_ar/templates/quote_3d_viewer.html',
                quote={'quote_number': quote.quote_number, 'id': quote_id, 'client': quote.client},
                products=[],
                default_product=None,
                error_message="Brak produktow z dostepnymi teksturami w tej wycenie"
            )
        
        return render_template(
            'preview3d_ar/templates/quote_3d_viewer.html',
            quote=quote,
            products=sorted_products,
            default_product=default_product
        )
        
    except Exception as e:
        print(f"[show_quote_3d_viewer] Error: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@preview3d_ar_bp.route('/modal')
def show_3d_modal():
    """Modal z 3D viewerem"""
    return render_template('preview3d_ar/templates/3d_modal.html')

@preview3d_ar_bp.route('/test')
def test_endpoint():
    """Endpoint testowy"""
    return jsonify({
        'module': 'preview3d_ar',
        'status': 'active',
        'formats': ['Reality', 'USDZ (deprecated)', 'GLB (planned)'],
        'endpoints': [
            '/api/product-3d [POST]',
            '/api/generate-reality [POST] - NEW!',
            '/api/generate-usdz [POST] - DEPRECATED',
            '/api/check-textures/<variant> [GET]',
            '/quote/<quote_id> [GET]',
            '/modal [GET]',
            '/test [GET]'
        ]
    })

@preview3d_ar_bp.route('/api/ar-info', methods=['GET'])
def ar_info():
    """Informacje o mozliwosciach AR"""
    try:
        generator = get_reality_generator()
        
        formats = ['Reality', 'USDZ (compatibility)']
        
        cache_files = []
        if os.path.exists(generator.cache_dir):
            cache_files = os.listdir(generator.cache_dir)
        
        reality_files = [f for f in cache_files if f.endswith('.reality')]
        usdz_files = [f for f in cache_files if f.endswith('.usdz')]
        
        return jsonify({
            'ar_enabled': True,
            'supported_formats': formats,
            'cache_files': {
                'reality': len(reality_files),
                'usdz': len(usdz_files),
                'total': len(cache_files)
            },
            'cache_dir': generator.cache_dir,
            'temp_dir': generator.temp_dir,
            'primary_format': 'Reality'
        })
        
    except Exception as e:
        print(f"[ar_info] Blad: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Blad serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/ar-cleanup', methods=['POST'])
def ar_cleanup():
    """Czysci pliki tymczasowe AR"""
    try:
        generator = get_reality_generator()
        generator.cleanup_temp_files()
        
        return jsonify({
            'success': True,
            'message': 'Pliki tymczasowe wyczyszczone'
        })
        
    except Exception as e:
        print(f"[ar_cleanup] Blad: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Blad serwera: {str(e)}'}), 500

@preview3d_ar_bp.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found in preview3d_ar module'}), 404

def get_reality_generator():
    """Lazy initialization generatora Reality"""
    global reality_generator
    if reality_generator is None:
        reality_generator = RealityGenerator()
    return reality_generator