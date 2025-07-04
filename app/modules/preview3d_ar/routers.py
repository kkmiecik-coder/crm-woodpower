# modules/preview3d_ar/routers.py - NAPRAWIONA WERSJA

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

# Dodaj MIME types
mimetypes.add_type('model/vnd.reality', '.reality')
mimetypes.add_type('model/vnd.usdz+zip', '.usdz')

@preview3d_ar_bp.route('/api/product-3d', methods=['POST'])
def generate_product_3d():
    """API endpoint do generowania konfiguracji 3D dla produktu"""
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
    """POPRAWIONY: Generuje plik Reality/USDZ"""
    try:
        print("[generate_reality] Rozpoczęcie generowania Reality/USDZ", file=sys.stderr)
        
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
        
        # Walidacja wymiarów
        if not all(dimensions.values()) or any(d <= 0 for d in dimensions.values()):
            return jsonify({'error': 'Nieprawidłowe wymiary'}), 400
        
        # Przygotuj dane produktu
        product_data = {
            'variant_code': variant_code,
            'dimensions': dimensions
        }
        
        # Generuj Reality/USDZ
        generator = get_reality_generator()
        reality_path = generator.generate_reality(product_data)
        
        if not reality_path or not os.path.exists(reality_path):
            return jsonify({'error': 'Błąd generowania pliku AR'}), 500
        
        # Pobierz informacje o pliku
        model_info = generator.get_model_info(reality_path)
        
        # Określ format na podstawie rozszerzenia
        file_ext = os.path.splitext(reality_path)[1].lower()
        format_name = 'Reality' if file_ext == '.reality' else 'USDZ'
        
        # Zwróć pełny URL
        filename = os.path.basename(reality_path)
        file_url = request.url_root.rstrip('/') + url_for('preview3d_ar.serve_ar_model', filename=filename)
        
        print(f"[generate_reality] {format_name} wygenerowany: {filename}", file=sys.stderr)
        
        response = {
            'success': True,
            'reality_url': file_url,  # Zachowaj nazwę dla kompatybilności
            'filename': filename,
            'model_info': model_info,
            'format': format_name
        }
        
        # Dodaj validację dla USDZ
        if format_name == 'USDZ' and model_info and 'is_valid_usdz' in model_info:
            response['validation'] = model_info['is_valid_usdz']
        
        return jsonify(response)
        
    except Exception as e:
        print(f"[generate_reality] Błąd: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/generate-usdz', methods=['POST'])
def generate_usdz():
    """BACKWARD COMPATIBILITY: Przekierowuje do generate_reality"""
    try:
        print("[generate_usdz] Backward compatibility - przekierowanie do Reality generator", file=sys.stderr)
        
        data = request.json
        if not data:
            return jsonify({'error': 'Brak danych JSON'}), 400
        
        variant_code = data.get('variant_code')
        dimensions = data.get('dimensions')
        
        if not variant_code or not dimensions:
            return jsonify({'error': 'Brak variant_code lub dimensions'}), 400
        
        # Użyj tego samego generatora
        generator = get_reality_generator()
        
        product_data = {
            'variant_code': variant_code,
            'dimensions': dimensions
        }
        
        ar_file_path = generator.generate_reality(product_data)
        
        if not ar_file_path or not os.path.exists(ar_file_path):
            return jsonify({'error': 'Błąd generowania pliku'}), 500
        
        filename = os.path.basename(ar_file_path)
        file_url = request.url_root.rstrip('/') + url_for('preview3d_ar.serve_ar_model', filename=filename)
        model_info = generator.get_model_info(ar_file_path)
        
        print(f"[generate_usdz] Backward compatibility response: {filename}", file=sys.stderr)
        
        return jsonify({
            'success': True,
            'usdz_url': file_url,  # Stara nazwa dla kompatybilności
            'filename': filename,
            'model_info': model_info,
            'note': 'Generated via Reality generator for compatibility'
        })
        
    except Exception as e:
        print(f"[generate_usdz] Błąd: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/ar-models/<filename>')
def serve_ar_model(filename):
    """POPRAWIONY: Serwuje pliki 3D dla AR z proper USDZ handling"""
    try:
        cache_dir = os.path.join(
            current_app.root_path,
            'modules', 'preview3d_ar', 'static', 'ar-models', 'cache'
        )
        file_path = os.path.join(cache_dir, filename)

        if not os.path.exists(file_path):
            print(f"[serve_ar_model] Plik nie istnieje: {file_path}", file=sys.stderr)
            abort(404)

        _, ext = os.path.splitext(filename.lower())
        file_size = os.path.getsize(file_path)

        print(f"[serve_ar_model] Serwowanie: {filename} ({ext}), rozmiar: {file_size} bytes", file=sys.stderr)

        # USDZ - główny format (nawet jeśli nazywa się .reality)
        if ext in ['.usdz', '.reality']:
            # Sprawdź czy to prawdziwy Reality czy USDZ
            is_real_reality = False
            try:
                # Sprawdź nagłówek pliku
                with open(file_path, 'rb') as f:
                    header = f.read(16)
                    # Reality ma specjalny nagłówek binarny
                    # USDZ to ZIP, więc zaczyna się od 'PK'
                    is_real_reality = not header.startswith(b'PK')
            except:
                pass

            if is_real_reality and ext == '.reality':
                # Prawdziwy plik Reality
                print(f"[serve_ar_model] Serwowanie prawdziwego Reality: {filename}", file=sys.stderr)
                
                response = make_response(send_file(
                    file_path,
                    as_attachment=False,
                    download_name=filename,
                    mimetype='model/vnd.reality'
                ))
                
                response.headers['Content-Type'] = 'model/vnd.reality'
                response.headers['X-AR-Format'] = 'Reality'
                response.headers['X-iOS-QuickLook'] = 'true'
                
            else:
                # USDZ (lub USDZ nazywający się .reality)
                print(f"[serve_ar_model] Serwowanie USDZ: {filename}", file=sys.stderr)
                
                # KLUCZOWE: Sprawdź czy USDZ jest prawidłowy
                generator = get_reality_generator()
                validation = generator._validate_usdz(file_path)
                
                if not validation.get('is_valid_zip', False):
                    print(f"[serve_ar_model] BŁĄD: Nieprawidłowy USDZ: {validation}", file=sys.stderr)
                    abort(500)
                
                if not validation.get('has_usd_file', False):
                    print(f"[serve_ar_model] OSTRZEŻENIE: USDZ bez pliku USD", file=sys.stderr)
                
                response = make_response(send_file(
                    file_path,
                    as_attachment=False,
                    download_name=filename.replace('.reality', '.usdz'),  # Wymuszenie .usdz
                    mimetype='model/vnd.usdz+zip'
                ))
                
                response.headers['Content-Type'] = 'model/vnd.usdz+zip'
                response.headers['X-AR-Format'] = 'USDZ'
                response.headers['X-USDZ-Validation'] = 'valid' if validation.get('first_file_is_usd') else 'warning'
            
            # Wspólne nagłówki dla obu formatów
            response.headers['Content-Disposition'] = f'inline; filename="{filename}"'
            response.headers['Content-Length'] = str(file_size)
            response.headers['Accept-Ranges'] = 'bytes'
            response.headers['Cache-Control'] = 'public, max-age=3600'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['X-AR-Model'] = 'true'
            
            return response

        # GLB files
        elif ext == '.glb':
            response = make_response(send_file(
                file_path,
                as_attachment=False,
                download_name=filename,
                mimetype='model/gltf-binary'
            ))
            response.headers['Content-Type'] = 'model/gltf-binary'
            response.headers['Cache-Control'] = 'public, max-age=3600'
            response.headers['X-AR-Format'] = 'GLB'
            return response

        else:
            # Inne pliki
            return send_file(file_path, as_attachment=False, download_name=filename)

    except Exception as e:
        print(f"[serve_ar_model] Błąd serwowania: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500

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
            'available_count': sum(1 for tex in textures.values() if tex.get('variants'))
        })
        
    except ValueError as e:
        return jsonify({'error': f'Invalid variant: {str(e)}'}), 400
    except Exception as e:
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@preview3d_ar_bp.route('/quote/<int:quote_id>')
def show_quote_3d_viewer(quote_id):
    """Endpoint dla wycen - wyświetla viewer 3D"""
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
            
            # Sprawdź dostępność tekstur
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
        
        # Znajdź domyślnie wybrany produkt
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
            # Fallback - pierwszy produkt z dostępnymi teksturami
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
                error_message="Brak produktów z dostępnymi teksturami w tej wycenie"
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
        'formats': ['USDZ (primary)', 'Reality (macOS only)', 'GLB (planned)'],
        'endpoints': [
            '/api/product-3d [POST]',
            '/api/generate-reality [POST] - Returns USDZ or Reality',
            '/api/generate-usdz [POST] - Backward compatibility',
            '/api/check-textures/<variant> [GET]',
            '/quote/<quote_id> [GET]',
            '/modal [GET]',
            '/test [GET]'
        ]
    })

@preview3d_ar_bp.route('/api/ar-info', methods=['GET'])
def ar_info():
    """Informacje o możliwościach AR"""
    try:
        generator = get_reality_generator()
        
        formats = ['USDZ (primary)', 'Reality (macOS only)', 'GLB (planned)']
        
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
            'primary_format': 'USDZ',
            'reality_converter_available': generator._check_reality_converter_available()
        })
        
    except Exception as e:
        print(f"[ar_info] Błąd: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/ar-cleanup', methods=['POST'])
def ar_cleanup():
    """Czyści pliki tymczasowe AR"""
    try:
        generator = get_reality_generator()
        generator.cleanup_temp_files()
        
        return jsonify({
            'success': True,
            'message': 'Pliki tymczasowe wyczyszczone'
        })
        
    except Exception as e:
        print(f"[ar_cleanup] Błąd: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/validate-usdz/<filename>')
def validate_usdz_file(filename):
    """NOWY: Waliduje konkretny plik USDZ"""
    try:
        cache_dir = os.path.join(
            current_app.root_path,
            'modules', 'preview3d_ar', 'static', 'ar-models', 'cache'
        )
        file_path = os.path.join(cache_dir, filename)
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'Plik nie istnieje'}), 404
        
        generator = get_reality_generator()
        validation = generator._validate_usdz(file_path)
        model_info = generator.get_model_info(file_path)
        
        return jsonify({
            'filename': filename,
            'validation': validation,
            'model_info': model_info,
            'recommendations': _get_usdz_recommendations(validation)
        })
        
    except Exception as e:
        print(f"[validate_usdz_file] Błąd: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Błąd serwera: {str(e)}'}), 500

def _get_usdz_recommendations(validation):
    """Zwraca rekomendacje na podstawie walidacji USDZ"""
    recommendations = []
    
    if not validation.get('is_valid_zip', False):
        recommendations.append('KRYTYCZNE: Plik nie jest prawidłowym archiwum ZIP')
        return recommendations
    
    if not validation.get('has_usd_file', False):
        recommendations.append('BŁĄD: Brak pliku USD w archiwum')
    
    if not validation.get('first_file_is_usd', False):
        recommendations.append('OSTRZEŻENIE: Pierwszy plik nie jest plikiem USD (może powodować problemy w iOS)')
    
    if validation.get('files_count', 0) == 1:
        recommendations.append('OK: Minimalistyczna struktura (tylko USD)')
    elif validation.get('files_count', 0) > 10:
        recommendations.append('UWAGA: Dużo plików w archiwum (może wpływać na wydajność)')
    
    if len(recommendations) == 0:
        recommendations.append('✅ Plik USDZ wygląda na prawidłowy')
    
    return recommendations

@preview3d_ar_bp.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found in preview3d_ar module'}), 404

def get_reality_generator():
    """Lazy initialization generatora Reality"""
    global reality_generator
    if reality_generator is None:
        reality_generator = RealityGenerator()
    return reality_generator

# Dodaj do modules/preview3d_ar/routers.py


@preview3d_ar_bp.route('/api/debug-textures/<variant>')
def debug_textures(variant):
    """POPRAWIONY Debug endpoint - sprawdza dostępność tekstur"""
    try:
        print(f"[Debug] Sprawdzanie tekstur dla: {variant}", file=sys.stderr)
        
        # Sprawdź parsing wariantu
        try:
            species, technology, wood_class = TextureConfig.parse_variant(variant)
            print(f"[Debug] Parsed: {species}, {technology}, {wood_class}", file=sys.stderr)
        except Exception as e:
            return jsonify({'error': f'Parse error: {str(e)}'}), 400
        
        # Sprawdź ścieżki
        base_dir = os.path.join(
            current_app.root_path,
            'modules', 'preview3d_ar', 'static', 'textures',
            species, f"{wood_class}_{technology}"
        )
        
        print(f"[Debug] Base dir: {base_dir}", file=sys.stderr)
        print(f"[Debug] Dir exists: {os.path.exists(base_dir)}", file=sys.stderr)
        
        if os.path.exists(base_dir):
            files = os.listdir(base_dir)
            print(f"[Debug] Files in dir: {files}", file=sys.stderr)
        
        # Sprawdź tekstury przez TextureConfig
        textures = TextureConfig.get_all_textures_for_variant(variant)
        
        # POPRAWIONE: Sprawdź lokalne ścieżki na podstawie URLs
        local_paths = {}
        total_existing_files = 0
        
        for surf_type, surf_data in textures.items():
            local_paths[surf_type] = []
            
            for url in surf_data.get('variants', []):
                # Konwertuj URL z powrotem na lokalną ścieżkę
                if '/static/preview3d_ar/' in url:
                    # Usuń domenę jeśli jest
                    if url.startswith('http'):
                        url_path = url.split('/static/preview3d_ar/')[-1]
                    else:
                        url_path = url.split('/static/preview3d_ar/')[-1]
                    
                    # Zbuduj pełną ścieżkę lokalną
                    full_path = os.path.join(
                        current_app.root_path, 
                        'modules', 'preview3d_ar', 'static', 
                        url_path
                    )
                    
                    # Sprawdź czy plik istnieje
                    exists = os.path.exists(full_path)
                    size = os.path.getsize(full_path) if exists else 0
                    
                    local_paths[surf_type].append({
                        'url': url,
                        'rel_path': url_path,
                        'full_path': full_path,
                        'exists': exists,
                        'size': size
                    })
                    
                    if exists:
                        total_existing_files += 1
                        
                    print(f"[Debug] {surf_type}: {url} -> exists: {exists}", file=sys.stderr)
        
        # Poprawne summary
        summary = {
            'total_variants': sum(len(surf['variants']) for surf in textures.values()),
            'existing_files': total_existing_files,
            'has_face_texture': len([p for p in local_paths.get('face', []) if p['exists']]) > 0,
            'has_edge_texture': len([p for p in local_paths.get('edge', []) if p['exists']]) > 0,
            'has_side_texture': len([p for p in local_paths.get('side', []) if p['exists']]) > 0
        }
        
        print(f"[Debug] CORRECTED Summary: {summary}", file=sys.stderr)
        
        return jsonify({
            'variant_code': variant,
            'parsed': {
                'species': species,
                'technology': technology,
                'wood_class': wood_class
            },
            'base_directory': {
                'path': base_dir,
                'exists': os.path.exists(base_dir),
                'files': os.listdir(base_dir) if os.path.exists(base_dir) else []
            },
            'textures': textures,
            'local_paths': local_paths,
            'summary': summary  # POPRAWIONY SUMMARY!
        })
        
    except Exception as e:
        print(f"[Debug] Error: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({'error': f'Debug error: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/debug-usdz-content/<filename>')
def debug_usdz_content(filename):
    """Debug endpoint - sprawdza zawartość pliku USDZ/Reality"""
    try:
        cache_dir = os.path.join(
            current_app.root_path,
            'modules', 'preview3d_ar', 'static', 'ar-models', 'cache'
        )
        file_path = os.path.join(cache_dir, filename)
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        import zipfile
        
        # Sprawdź zawartość ZIP
        file_info = {
            'filename': filename,
            'size': os.path.getsize(file_path),
            'files': [],
            'has_textures': False,
            'has_usd': False,
            'has_obj': False
        }
        
        with zipfile.ZipFile(file_path, 'r') as zf:
            for info in zf.infolist():
                file_entry = {
                    'name': info.filename,
                    'size': info.file_size,
                    'compressed_size': info.compress_size,
                    'type': 'unknown'
                }
                
                # Określ typ pliku
                name_lower = info.filename.lower()
                if name_lower.endswith('.usd'):
                    file_entry['type'] = 'USD Scene'
                    file_info['has_usd'] = True
                elif name_lower.endswith('.obj'):
                    file_entry['type'] = 'OBJ Geometry'
                    file_info['has_obj'] = True
                elif name_lower.endswith(('.jpg', '.jpeg', '.png')):
                    file_entry['type'] = 'Texture'
                    file_info['has_textures'] = True
                elif name_lower.endswith('.mtl'):
                    file_entry['type'] = 'Material'
                
                file_info['files'].append(file_entry)
        
        # Sprawdź USD content jeśli istnieje
        usd_content = None
        for file_entry in file_info['files']:
            if file_entry['type'] == 'USD Scene':
                try:
                    with zipfile.ZipFile(file_path, 'r') as zf:
                        with zf.open(file_entry['name']) as f:
                            usd_content = f.read().decode('utf-8')
                            break
                except:
                    pass
        
        return jsonify({
            'file_info': file_info,
            'usd_content_preview': usd_content[:1000] + '...' if usd_content and len(usd_content) > 1000 else usd_content,
            'diagnosis': {
                'is_valid_usdz': file_info['has_usd'] and file_info['has_obj'],
                'has_textures': file_info['has_textures'],
                'texture_count': len([f for f in file_info['files'] if f['type'] == 'Texture']),
                'total_files': len(file_info['files'])
            }
        })
        
    except Exception as e:
        print(f"[Debug USDZ] Error: {str(e)}", file=sys.stderr)
        return jsonify({'error': f'Debug error: {str(e)}'}), 500