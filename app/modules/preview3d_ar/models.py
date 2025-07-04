# modules/preview3d_ar/models.py - PROSTA POPRAWKA z teksturami

import os
import glob
import tempfile
import hashlib
import subprocess
import json
import sys
import zipfile
import shutil
import random
from flask import current_app, url_for
import trimesh
import numpy as np
from PIL import Image

class TextureConfig:
    """Konfiguracja tekstur z fallbackiem do szarego koloru"""

    # Mapowanie kodów z bazy na nazwy folderów
    SPECIES_MAP = {
        'dab': 'oak',
        'jes': 'ash',
        'buk': 'beech'
    }
    TECH_MAP = {
        'lity': 'lite',
        'micro': 'micro'
    }
    SURFACE_TYPES = ['face', 'edge', 'side']
    FALLBACK_COLORS = {
        'face': '#D0D0D0',
        'edge': '#B0B0B0',
        'side': '#909090'
    }

    @staticmethod
    def parse_variant(variant_code):
        parts = variant_code.split('-')
        if len(parts) != 3:
            raise ValueError(f"Nieprawidłowy format wariantu: {variant_code}")
        species = TextureConfig.SPECIES_MAP.get(parts[0])
        tech = TextureConfig.TECH_MAP.get(parts[1])
        wood_class = parts[2]
        if not species or not tech:
            raise ValueError(f"Nieznany wariant: {variant_code}")
        return species, tech, wood_class

    @staticmethod
    def get_all_textures_for_variant(variant_code):
        """
        POPRAWIONA WERSJA: Zwraca dla każdego typu powierzchni:
        {
            'variants': [url1, url2, ...],
            'fallback_color': '#XXXXXX'
        }
        """
        try:
            species, tech, wood_class = TextureConfig.parse_variant(variant_code)
            print(f"[TextureConfig] Parsing {variant_code} -> {species}, {tech}, {wood_class}", file=sys.stderr)
        except ValueError as e:
            print(f"[TextureConfig] Parse error for {variant_code}: {e}", file=sys.stderr)
            return {
                surf: {'variants': [], 'fallback_color': '#C0C0C0'}
                for surf in TextureConfig.SURFACE_TYPES
            }

        # Ścieżka do folderu ze statycznymi teksturami
        base_dir = os.path.join(
            current_app.root_path,
            'modules', 'preview3d_ar', 'static', 'textures',
            species, f"{wood_class}_{tech}"
        )
        
        print(f"[TextureConfig] Base directory: {base_dir}", file=sys.stderr)
        print(f"[TextureConfig] Directory exists: {os.path.exists(base_dir)}", file=sys.stderr)

        if os.path.exists(base_dir):
            all_files = os.listdir(base_dir)
            print(f"[TextureConfig] Files in directory: {all_files}", file=sys.stderr)

        textures = {}
        for surf in TextureConfig.SURFACE_TYPES:
            # POPRAWIONY WZORZEC: Uwzględnia różne formaty nazw plików
            patterns_to_try = [
                os.path.join(base_dir, f"{surf}_*.jpg"),     # face_1.jpg, face_2.jpg
                os.path.join(base_dir, f"{surf}_*.jpeg"),    # face_1.jpeg
                os.path.join(base_dir, f"{surf}*.jpg"),      # face1.jpg (bez podkreślnika)
                os.path.join(base_dir, f"{surf}_*.png"),     # face_1.png
            ]
            
            files = []
            for pattern in patterns_to_try:
                found_files = glob.glob(pattern)
                files.extend(found_files)
                print(f"[TextureConfig] Pattern {pattern} found {len(found_files)} files", file=sys.stderr)
            
            # Usuń duplikaty i sortuj
            files = sorted(list(set(files)))
            print(f"[TextureConfig] Surface {surf}: found {len(files)} files total", file=sys.stderr)
            
            urls = []
            for path in files:
                try:
                    # Ścieżka względna od katalogu static
                    rel = os.path.relpath(
                        path,
                        os.path.join(current_app.root_path, 'modules', 'preview3d_ar', 'static')
                    )
                    rel = rel.replace(os.sep, '/')
                    url = url_for('preview3d_ar.static', filename=rel)
                    urls.append(url)
                    print(f"[TextureConfig] Generated URL: {url}", file=sys.stderr)
                except Exception as e:
                    print(f"[TextureConfig] Error generating URL for {path}: {e}", file=sys.stderr)
            
            textures[surf] = {
                'variants': urls,
                'fallback_color': TextureConfig.FALLBACK_COLORS[surf]
            }
            
            print(f"[TextureConfig] Surface {surf}: {len(urls)} URLs generated", file=sys.stderr)
        
        print(f"[TextureConfig] Final result: {sum(len(t['variants']) for t in textures.values())} total URLs", file=sys.stderr)
        return textures

class RealityGenerator:
    """Generator plików Reality/USDZ dla Apple AR QuickLook z obsługą tekstur"""
    
    def __init__(self):
        self.cache_dir = os.path.join(
            current_app.root_path, 
            'modules', 'preview3d_ar', 'static', 'ar-models', 'cache'
        )
        self.temp_dir = os.path.join(
            current_app.root_path, 
            'modules', 'preview3d_ar', 'static', 'ar-models', 'temp'
        )
        
        # Upewnij się, że foldery istnieją
        os.makedirs(self.cache_dir, exist_ok=True)
        os.makedirs(self.temp_dir, exist_ok=True)
        
        print(f"[RealityGenerator] Inicjalizacja - cache: {self.cache_dir}", file=sys.stderr)
        print(f"[RealityGenerator] Inicjalizacja - temp: {self.temp_dir}", file=sys.stderr)

    def _generate_cache_key(self, product_data):
        """Generuje unikalny klucz cache dla produktu"""
        variant = product_data.get('variant_code', '')
        dims = product_data.get('dimensions', {})
        data_str = f"{variant}-{dims.get('length', 0)}-{dims.get('width', 0)}-{dims.get('thickness', 0)}"
        return hashlib.md5(data_str.encode()).hexdigest()

    def _get_texture_path(self, texture_url):
        """Konwertuje URL tekstury na ścieżkę lokalną"""
        if not texture_url or texture_url.startswith('data:'):
            return None
            
        if texture_url.startswith('http'):
            return None
        
        print(f"[RealityGenerator] Converting texture URL: {texture_url}", file=sys.stderr)
        
        # POPRAWIONY: Obsługa różnych formatów URL
        if '/preview3d-ar/static/' in texture_url:
            # Format: /preview3d-ar/static/textures/oak/ab_lite/face_1.jpg
            rel_path = texture_url.split('/preview3d-ar/static/')[-1]
            full_path = os.path.join(current_app.root_path, 'modules', 'preview3d_ar', 'static', rel_path)
            print(f"[RealityGenerator] Converted path: {full_path}", file=sys.stderr)
            print(f"[RealityGenerator] Path exists: {os.path.exists(full_path)}", file=sys.stderr)
            return full_path if os.path.exists(full_path) else None
        elif '/static/preview3d_ar/' in texture_url:
            # Format: /static/preview3d_ar/textures/oak/ab_lite/face_1.jpg (fallback)
            rel_path = texture_url.split('/static/preview3d_ar/')[-1]
            full_path = os.path.join(current_app.root_path, 'modules', 'preview3d_ar', 'static', rel_path)
            print(f"[RealityGenerator] Converted path (fallback): {full_path}", file=sys.stderr)
            return full_path if os.path.exists(full_path) else None
        
        print(f"[RealityGenerator] URL format not recognized: {texture_url}", file=sys.stderr)
        return None

    def _process_texture_for_ar(self, texture_path, surface_type='face', target_size=(1024, 1024)):
        """Przetwarza teksturę dla formatu AR/USDZ"""
        if not texture_path or not os.path.exists(texture_path):
            print(f"[RealityGenerator] Texture not found: {texture_path}", file=sys.stderr)
            return None
        
        try:
            # Otwórz i przetwórz obraz
            with Image.open(texture_path) as img:
                # Konwertuj na RGB jeśli potrzeba
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # Zmień rozmiar dla AR - ograniczenie do maksymalnie 1024x1024
                max_size = min(target_size[0], 1024)
                if img.size[0] > max_size or img.size[1] > max_size:
                    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                
                # Utwórz nazwę pliku z hashem dla unikalności
                texture_hash = hashlib.md5(texture_path.encode()).hexdigest()[:8]
                temp_filename = f"{surface_type}_{texture_hash}.jpg"
                temp_path = os.path.join(self.temp_dir, temp_filename)
                
                # Zapisz jako JPEG z kompresją dla AR (lepsze dla iOS)
                img.save(temp_path, 'JPEG', quality=85, optimize=True)
                
                print(f"[RealityGenerator] Texture processed: {os.path.basename(texture_path)} -> {temp_filename}", file=sys.stderr)
                return temp_path
        
        except Exception as e:
            print(f"[RealityGenerator] Error processing texture {texture_path}: {e}", file=sys.stderr)
            return None

    def _create_wood_geometry_usd_with_textures(self, dimensions, variant_code, texture_filenames):
        """Tworzy USD geometrię z teksturami"""
        print(f"[RealityGenerator] Creating USD geometry with textures - wymiary: {dimensions}", file=sys.stderr)
        
        # Wymiary w metrach dla AR (konwersja z cm)
        length = dimensions.get('length', 200) / 100.0  # cm -> m
        width = dimensions.get('width', 80) / 100.0
        thickness = dimensions.get('thickness', 3) / 100.0
        
        # Przygotuj referencje tekstur
        diffuse_texture = texture_filenames.get('face', '')
        
        # USD content z teksturami
        if diffuse_texture:
            texture_usd = f'''
                color3f inputs:diffuseColor.connect = </WoodPanel/Materials/WoodMaterial/DiffuseTexture.outputs:rgb>
                
                def Shader "DiffuseTexture"
                {{
                    uniform token info:id = "UsdUVTexture"
                    asset inputs:file = @./{diffuse_texture}@
                    float2 inputs:st.connect = </WoodPanel/Materials/WoodMaterial/UVReader.outputs:result>
                    token inputs:wrapS = "repeat"
                    token inputs:wrapT = "repeat"
                    color3f outputs:rgb
                }}'''
            
            uv_reader_usd = '''
            def Shader "UVReader"
            {
                uniform token info:id = "UsdPrimvarReader_float2"
                string inputs:varname = "st"
                float2 outputs:result
            }'''
        else:
            texture_usd = 'color3f inputs:diffuseColor = (0.82, 0.71, 0.55)'
            uv_reader_usd = ''
        
        usd_content = f'''#usda 1.0
(
    customLayerData = {{
        string creator = "Wood Power CRM"
        string[] providedExtensions = ["USDZ"]
    }}
    defaultPrim = "WoodPanel"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "WoodPanel" (
    assetInfo = {{
        string name = "Wood Panel {variant_code}"
        string identifier = "{variant_code}"
        string version = "1.0"
    }}
    kind = "component"
)
{{
    # Metadane AR dla iOS QuickLook
    custom bool preliminary_collidesWithEnvironment = 1
    custom string preliminary_planeAnchoring = "horizontal"
    custom float preliminary_worldScale = 1.0
    custom bool preliminary_receivesShadows = 1
    custom bool preliminary_castsShadows = 1
    
    def Mesh "WoodMesh"
    {{
        # Geometria box z UV coordinates
        int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
        int[] faceVertexIndices = [0, 1, 3, 2, 4, 6, 7, 5, 0, 2, 6, 4, 1, 5, 7, 3, 0, 4, 5, 1, 2, 3, 7, 6]
        point3f[] points = [
            ({-length/2}, {-thickness/2}, {-width/2}),
            ({length/2}, {-thickness/2}, {-width/2}),
            ({-length/2}, {thickness/2}, {-width/2}),
            ({length/2}, {thickness/2}, {-width/2}),
            ({-length/2}, {-thickness/2}, {width/2}),
            ({length/2}, {-thickness/2}, {width/2}),
            ({-length/2}, {thickness/2}, {width/2}),
            ({length/2}, {thickness/2}, {width/2})
        ]
        
        # UV coordinates dla tekstur
        float2[] primvars:st = [
            (0, 0), (1, 0), (1, 1), (0, 1),
            (0, 0), (1, 0), (1, 1), (0, 1),
            (0, 0), (1, 0), (1, 1), (0, 1),
            (0, 0), (1, 0), (1, 1), (0, 1),
            (0, 0), (1, 0), (1, 1), (0, 1),
            (0, 0), (1, 0), (1, 1), (0, 1)
        ]
        
        rel material:binding = </WoodPanel/Materials/WoodMaterial>
        uniform token subdivisionScheme = "none"
        uniform bool doubleSided = 0
    }}
    
    def Scope "Materials"
    {{
        def Material "WoodMaterial"
        {{
            token outputs:surface.connect = </WoodPanel/Materials/WoodMaterial/PreviewSurface.outputs:surface>
            
            def Shader "PreviewSurface"
            {{
                uniform token info:id = "UsdPreviewSurface"
                
                {texture_usd}
                
                float inputs:roughness = 0.85
                float inputs:metallic = 0.0
                float inputs:clearcoat = 0.0
                float inputs:opacity = 1.0
                float inputs:ior = 1.45
                token outputs:surface
            }}
            
            {uv_reader_usd}
        }}
    }}
}}
'''
        
        print(f"[RealityGenerator] USD content created - AR dimensions: {length:.3f}m x {width:.3f}m x {thickness:.3f}m", file=sys.stderr)
        print(f"[RealityGenerator] Using texture: {diffuse_texture if diffuse_texture else 'none'}", file=sys.stderr)
        return usd_content

    def _create_usdz_with_textures(self, usd_content, processed_textures, output_path):
        """Tworzy USDZ z teksturami"""
        try:
            print(f"[RealityGenerator] Creating USDZ with textures: {list(processed_textures.keys())}", file=sys.stderr)
            
            # Utwórz pliki tymczasowe
            usd_file = os.path.join(self.temp_dir, 'model.usd')
            
            # Zapisz USD
            with open(usd_file, 'w', encoding='utf-8') as f:
                f.write(usd_content)
            
            # Utwórz USDZ jako ZIP z teksturami
            with zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_STORED) as zf:
                # USD musi być pierwszym plikiem w archiwum
                zf.write(usd_file, 'model.usd')
                
                # Dodaj wszystkie tekstury
                for surface_type, texture_path in processed_textures.items():
                    if texture_path and os.path.exists(texture_path):
                        texture_filename = os.path.basename(texture_path)
                        zf.write(texture_path, texture_filename)
                        print(f"[RealityGenerator] Added texture to USDZ: {texture_filename}", file=sys.stderr)
            
            # Sprawdź czy plik został utworzony
            if not os.path.exists(output_path):
                raise Exception(f"Failed to create USDZ file: {output_path}")
            
            file_size = os.path.getsize(output_path)
            print(f"[RealityGenerator] USDZ with textures created: {output_path}, size: {file_size} bytes", file=sys.stderr)
            
            return True
            
        except Exception as e:
            print(f"[RealityGenerator] Error creating USDZ with textures: {e}", file=sys.stderr)
            return False
        finally:
            # Wyczyść pliki tymczasowe
            if os.path.exists(usd_file):
                os.remove(usd_file)

    def _create_wood_geometry_usd(self, dimensions, variant_code):
        """FALLBACK: Tworzy USD bez tekstur (stara metoda dla kompatybilności)"""
        print(f"[RealityGenerator] Creating USD geometry WITHOUT textures - dimensions: {dimensions}", file=sys.stderr)
        
        # Wymiary w metrach dla AR (konwersja z cm)
        length = dimensions.get('length', 200) / 100.0  # cm -> m
        width = dimensions.get('width', 80) / 100.0
        thickness = dimensions.get('thickness', 3) / 100.0
        
        usd_content = f'''#usda 1.0
(
    customLayerData = {{
        string creator = "Wood Power CRM"
        string[] providedExtensions = ["USDZ"]
    }}
    defaultPrim = "WoodPanel"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "WoodPanel" (
    assetInfo = {{
        string name = "Wood Panel {variant_code}"
        string identifier = "{variant_code}"
        string version = "1.0"
    }}
    kind = "component"
)
{{
    # Metadane AR dla iOS QuickLook
    custom bool preliminary_collidesWithEnvironment = 1
    custom string preliminary_planeAnchoring = "horizontal"
    custom float preliminary_worldScale = 1.0
    custom bool preliminary_receivesShadows = 1
    custom bool preliminary_castsShadows = 1
    
    def Mesh "WoodMesh"
    {{
        # Geometria box
        int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
        int[] faceVertexIndices = [0, 1, 3, 2, 4, 6, 7, 5, 0, 2, 6, 4, 1, 5, 7, 3, 0, 4, 5, 1, 2, 3, 7, 6]
        point3f[] points = [
            ({-length/2}, {-thickness/2}, {-width/2}),
            ({length/2}, {-thickness/2}, {-width/2}),
            ({-length/2}, {thickness/2}, {-width/2}),
            ({length/2}, {thickness/2}, {-width/2}),
            ({-length/2}, {-thickness/2}, {width/2}),
            ({length/2}, {-thickness/2}, {width/2}),
            ({-length/2}, {thickness/2}, {width/2}),
            ({length/2}, {thickness/2}, {width/2})
        ]
        
        rel material:binding = </WoodPanel/Materials/WoodMaterial>
        uniform token subdivisionScheme = "none"
        uniform bool doubleSided = 0
    }}
    
    def Scope "Materials"
    {{
        def Material "WoodMaterial"
        {{
            token outputs:surface.connect = </WoodPanel/Materials/WoodMaterial/PreviewSurface.outputs:surface>
            
            def Shader "PreviewSurface"
            {{
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0.82, 0.71, 0.55)
                float inputs:roughness = 0.85
                float inputs:metallic = 0.0
                float inputs:clearcoat = 0.0
                float inputs:opacity = 1.0
                float inputs:ior = 1.45
                token outputs:surface
            }}
        }}
    }}
}}
'''
        
        print(f"[RealityGenerator] USD content created - AR dimensions: {length:.3f}m x {width:.3f}m x {thickness:.3f}m", file=sys.stderr)
        return usd_content

    def _create_proper_usdz(self, usd_content, output_path):
        """FALLBACK: Tworzy USDZ bez tekstur (stara metoda)"""
        try:
            print(f"[RealityGenerator] Creating USDZ WITHOUT textures: {output_path}", file=sys.stderr)
            
            # Utwórz pliki tymczasowe
            usd_file = os.path.join(self.temp_dir, 'model.usd')
            
            # Zapisz USD
            with open(usd_file, 'w', encoding='utf-8') as f:
                f.write(usd_content)
            
            # Utwórz USDZ jako ZIP
            with zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_STORED) as zf:
                # USD musi być pierwszym plikiem w archiwum
                zf.write(usd_file, 'model.usd')
            
            # Sprawdź czy plik został utworzony
            if not os.path.exists(output_path):
                raise Exception(f"Failed to create USDZ file: {output_path}")
            
            file_size = os.path.getsize(output_path)
            print(f"[RealityGenerator] USDZ created: {output_path}, size: {file_size} bytes", file=sys.stderr)
            
            return True
            
        except Exception as e:
            print(f"[RealityGenerator] Error creating USDZ: {e}", file=sys.stderr)
            return False
        finally:
            # Wyczyść pliki tymczasowe
            if os.path.exists(usd_file):
                os.remove(usd_file)

    def _check_reality_converter_available(self):
        """Sprawdza czy Reality Converter jest dostępny"""
        try:
            result = subprocess.run(['xcrun', '--find', 'RealityConverter'], 
                                  capture_output=True, text=True)
            if result.returncode == 0:
                print("[RealityGenerator] Reality Converter available", file=sys.stderr)
                return True
        except:
            pass
        
        print("[RealityGenerator] Reality Converter not available - using USDZ", file=sys.stderr)
        return False

    def generate_reality(self, product_data):
        """
        POPRAWIONA METODA: Generuje plik Reality/USDZ z teksturami
        """
        print(f"[RealityGenerator] Generating AR with textures for: {product_data}", file=sys.stderr)
        
        try:
            # Sprawdź cache
            cache_key = self._generate_cache_key(product_data)
            
            # Sprawdź czy Reality Converter jest dostępny
            can_create_reality = self._check_reality_converter_available()
            
            if can_create_reality:
                # Próbuj utworzyć prawdziwy plik Reality
                reality_path = os.path.join(self.cache_dir, f"{cache_key}.reality")
                if os.path.exists(reality_path):
                    print(f"[RealityGenerator] Reality from cache: {reality_path}", file=sys.stderr)
                    return reality_path
                
                print("[RealityGenerator] Reality creation not implemented - fallback to USDZ", file=sys.stderr)
            
            # GŁÓWNA ŚCIEŻKA: Utwórz USDZ z teksturami
            usdz_path = os.path.join(self.cache_dir, f"{cache_key}.usdz")
            
            if os.path.exists(usdz_path):
                print(f"[RealityGenerator] USDZ from cache: {usdz_path}", file=sys.stderr)
                return usdz_path
            
            # Pobierz dane produktu
            variant_code = product_data.get('variant_code', 'unknown')
            dimensions = product_data.get('dimensions', {})
            
            # Walidacja wymiarów
            if not all(dimensions.values()) or any(d <= 0 for d in dimensions.values()):
                raise ValueError("Invalid product dimensions")
            
            # NOWE: Pobierz i przetwórz tekstury
            processed_textures = {}
            texture_filenames = {}
            
            try:
                textures = TextureConfig.get_all_textures_for_variant(variant_code)
                print(f"[RealityGenerator] Textures for {variant_code}: {list(textures.keys())}", file=sys.stderr)
                
                for surface_type in ['face', 'edge', 'side']:
                    texture_variants = textures.get(surface_type, {}).get('variants', [])
                    if texture_variants:
                        # Wybierz losową teksturę z dostępnych wariantów
                        selected_texture_url = random.choice(texture_variants)
                        texture_local_path = self._get_texture_path(selected_texture_url)
                        
                        if texture_local_path:
                            processed_texture = self._process_texture_for_ar(texture_local_path, surface_type)
                            if processed_texture:
                                processed_textures[surface_type] = processed_texture
                                texture_filenames[surface_type] = os.path.basename(processed_texture)
                                print(f"[RealityGenerator] Texture {surface_type} processed: {texture_filenames[surface_type]}", file=sys.stderr)
                        else:
                            print(f"[RealityGenerator] Local path not found for {surface_type}: {selected_texture_url}", file=sys.stderr)
                    else:
                        print(f"[RealityGenerator] No texture variants for {surface_type}", file=sys.stderr)
                
            except Exception as e:
                print(f"[RealityGenerator] Error processing textures for {variant_code}: {e}", file=sys.stderr)
                # Kontynuuj bez tekstur
            
            # Wybierz metodę tworzenia USD na podstawie dostępności tekstur
            if processed_textures:
                print(f"[RealityGenerator] Using {len(processed_textures)} textures for AR model", file=sys.stderr)
                usd_content = self._create_wood_geometry_usd_with_textures(dimensions, variant_code, texture_filenames)
                success = self._create_usdz_with_textures(usd_content, processed_textures, usdz_path)
            else:
                print("[RealityGenerator] No textures available - creating model without textures", file=sys.stderr)
                usd_content = self._create_wood_geometry_usd(dimensions, variant_code)
                success = self._create_proper_usdz(usd_content, usdz_path)
            
            if not success:
                raise Exception("Failed to create USDZ file")
            
            print(f"[RealityGenerator] USDZ generated: {usdz_path}", file=sys.stderr)
            return usdz_path
            
        except Exception as e:
            print(f"[RealityGenerator] Error generating Reality/USDZ: {e}", file=sys.stderr)
            raise

    def cleanup_temp_files(self):
        """Czyści pliki tymczasowe"""
        try:
            cleaned_count = 0
            for file in os.listdir(self.temp_dir):
                if file.endswith(('.usd', '.obj', '.tmp', '.jpg', '.jpeg')):
                    file_path = os.path.join(self.temp_dir, file)
                    if os.path.isfile(file_path):
                        os.remove(file_path)
                        cleaned_count += 1
            print(f"[RealityGenerator] Temp files cleaned: {cleaned_count} files", file=sys.stderr)
        except Exception as e:
            print(f"[RealityGenerator] Error cleaning temp files: {e}", file=sys.stderr)

    def get_model_info(self, file_path):
        """Zwraca informacje o modelu z analizą tekstur"""
        try:
            if not os.path.exists(file_path):
                return None
            
            stat = os.stat(file_path)
            
            # Sprawdź format na podstawie rozszerzenia
            ext = os.path.splitext(file_path)[1].lower()
            format_name = {
                '.reality': 'Reality',
                '.usdz': 'USDZ', 
                '.glb': 'GLB'
            }.get(ext, 'Unknown')
            
            # Sprawdź zawartość USDZ
            texture_count = 0
            file_list = []
            
            if ext == '.usdz':
                try:
                    with zipfile.ZipFile(file_path, 'r') as zf:
                        file_list = zf.namelist()
                        texture_count = len([f for f in file_list if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
                except:
                    pass
            
            return {
                'file_size': stat.st_size,
                'file_size_mb': round(stat.st_size / (1024*1024), 2),
                'created': stat.st_mtime,
                'format': format_name,
                'is_valid_usdz': self._validate_usdz(file_path) if ext == '.usdz' else None,
                'texture_count': texture_count,
                'files_in_archive': file_list
            }
        except Exception as e:
            print(f"[RealityGenerator] Error getting model info: {e}", file=sys.stderr)
            return None

    def _validate_usdz(self, file_path):
        """Waliduje plik USDZ"""
        try:
            # Sprawdź czy to prawidłowy ZIP
            with zipfile.ZipFile(file_path, 'r') as zf:
                files = zf.namelist()
                
                # Sprawdź czy zawiera plik USD
                has_usd = any(f.endswith('.usd') or f.endswith('.usda') for f in files)
                
                # Sprawdź czy USD jest pierwszym plikiem (wymagane dla iOS)
                first_file_is_usd = len(files) > 0 and (files[0].endswith('.usd') or files[0].endswith('.usda'))
                
                # Sprawdź tekstury
                texture_files = [f for f in files if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
                
                return {
                    'is_valid_zip': True,
                    'has_usd_file': has_usd,
                    'first_file_is_usd': first_file_is_usd,
                    'files_count': len(files),
                    'texture_count': len(texture_files),
                    'texture_files': texture_files,
                    'files': files[:5]  # pierwsze 5 plików
                }
                
        except Exception as e:
            return {
                'is_valid_zip': False,
                'error': str(e)
            }

# Backward compatibility - zachowaj stary generator USDZ
class AR3DGenerator(RealityGenerator):
    """Deprecated - używaj RealityGenerator"""
    
    def generate_usdz(self, product_data):
        """Backward compatibility wrapper"""
        print("[AR3DGenerator] DEPRECATED: Use RealityGenerator.generate_reality()", file=sys.stderr)
        return self.generate_reality(product_data)