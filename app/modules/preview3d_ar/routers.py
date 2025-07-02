# modules/preview3d_ar/routers.py
from flask import jsonify, request, render_template, current_app
from . import preview3d_ar_bp
from .models import TextureConfig

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
        if not all(dimensions[key] > 0 for key in ['length', 'width', 'thickness']):
            return jsonify({'error': 'Invalid dimensions - all must be greater than 0'}), 400
        
        # Pobierz informacje o teksturach
        textures = TextureConfig.get_all_textures_for_variant(variant_code)
        
        # Parse variant dla metadanych
        try:
            species, technology, wood_class = TextureConfig.parse_variant(variant_code)
        except ValueError as e:
            return jsonify({'error': f'Invalid variant format: {str(e)}'}), 400
        
        # Przygotuj response
        response_data = {
            'success': True,
            'geometry': {
                'type': 'box',
                'dimensions': dimensions,
                'quantity': quantity
            },
            'materials': textures,
            'metadata': {
                'species': species,
                'technology': technology,
                'wood_class': wood_class,
                'variant_code': variant_code
            }
        }
        
        current_app.logger.info(f"Generated 3D config for variant: {variant_code}, dims: {dimensions}")
        return jsonify(response_data)
        
    except Exception as e:
        current_app.logger.error(f"Error in generate_product_3d: {str(e)}")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@preview3d_ar_bp.route('/api/check-textures/<variant_code>')
def check_textures(variant_code):
    """
    Sprawdza dostępność tekstur dla danego wariantu (endpoint diagnostyczny)
    """
    try:
        textures = TextureConfig.get_all_textures_for_variant(variant_code)
        species, technology, wood_class = TextureConfig.parse_variant(variant_code)
        
        return jsonify({
            'variant_code': variant_code,
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

@preview3d_ar_bp.route('/modal')
def show_3d_modal():
    """
    Modal z 3D viewerem (fallback dla desktop i Android)
    """
    # TODO: Implementacja modala z 3D viewerem
    return render_template('3d_modal.html')

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
            '/modal [GET]',
            '/test [GET]'
        ]
    })

# Obsługa błędów 404 dla tego blueprintu
@preview3d_ar_bp.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found in preview3d_ar module'}), 404