# modules/preview3d_ar/models.py - POPRAWIONA WERSJA Z TEKSTURAMI

import os
import glob
import tempfile
import hashlib
import subprocess
import json
import sys
from flask import current_app, url_for
import trimesh
import numpy as np
from PIL import Image
import zipfile
import shutil

class RealityGenerator:
    """Generator plików Reality dla Apple AR QuickLook z obsługą tekstur"""
    
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
        
        # Usuń prefix /static/preview3d_ar/
        if '/static/preview3d_ar/' in texture_url:
            rel_path = texture_url.split('/static/preview3d_ar/')[-1]
            full_path = os.path.join(current_app.root_path, 'modules', 'preview3d_ar', 'static', rel_path)
            return full_path if os.path.exists(full_path) else None
        
        return None

    def _process_texture_for_reality(self, texture_path, surface_type='face', target_size=(1024, 1024)):
        """Przetwarza teksturę dla formatu Reality/USDZ"""
        if not texture_path or not os.path.exists(texture_path):
            print(f"[RealityGenerator] Tekstura nie istnieje: {texture_path}", file=sys.stderr)
            return None
        
        try:
            # Otwórz i przetwórz obraz
            with Image.open(texture_path) as img:
                # Konwertuj na RGB jeśli potrzeba
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # Zmień rozmiar dla AR - ograniczenie do maksymalnie 2048x2048
                max_size = min(target_size[0], 2048)
                if img.size[0] > max_size or img.size[1] > max_size:
                    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                
                # Utwórz nazwę pliku z hashem dla unikalności
                texture_hash = hashlib.md5(texture_path.encode()).hexdigest()[:8]
                temp_filename = f"{surface_type}_{texture_hash}.jpg"
                temp_path = os.path.join(self.temp_dir, temp_filename)
                
                # Zapisz jako JPEG z kompresją dla AR (lepsze dla iOS)
                img.save(temp_path, 'JPEG', quality=85, optimize=True)
                
                print(f"[RealityGenerator] Tekstura przetworzona: {os.path.basename(texture_path)} -> {temp_filename}", file=sys.stderr)
                return temp_path
        
        except Exception as e:
            print(f"[RealityGenerator] Błąd przetwarzania tekstury {texture_path}: {e}", file=sys.stderr)
            return None

    def _create_wood_geometry_data(self, dimensions):
        """Tworzy dane geometrii w formacie kompatybilnym z Reality"""
        print(f"[RealityGenerator] Tworzenie geometrii - wymiary: {dimensions}", file=sys.stderr)
        
        # Wymiary w metrach dla AR
        length = dimensions.get('length', 200) / 100.0  # cm -> m
        width = dimensions.get('width', 80) / 100.0
        thickness = dimensions.get('thickness', 3) / 100.0
        
        # Utwórz prostą geometrię blatu
        mesh = trimesh.creation.box(
            extents=[length, thickness, width]
        )
        
        # Upewnij się, że normalne są prawidłowe
        mesh.fix_normals()
        
        # POPRAWIONE: Generuj prawidłowe UV coordinates
        vertices = mesh.vertices
        faces = mesh.faces
        
        # Utwórz UV mapping dla każdej ściany
        uv_coords = np.zeros((len(vertices), 2))
        
        # Dla prostokątnego blatu, mapuj UV na podstawie pozycji
        for i, vertex in enumerate(vertices):
            x, y, z = vertex
            # Normalizuj współrzędne do zakresu [0, 1]
            u = (x + length/2) / length
            v = (z + width/2) / width
            uv_coords[i] = [u, v]
        
        mesh.visual.uv = uv_coords
        
        print(f"[RealityGenerator] Geometria utworzona - wymiary AR: {length:.3f}m x {width:.3f}m x {thickness:.3f}m", file=sys.stderr)
        print(f"[RealityGenerator] Wierzchołki: {len(mesh.vertices)}, Faces: {len(mesh.faces)}, UV: {len(uv_coords)}", file=sys.stderr)
        
        return mesh

    def _create_usd_content_with_textures(self, scene_data, obj_filename, texture_filenames):
        """NOWA METODA: Tworzy USD content z prawidłowymi teksturami"""
        variant = scene_data['metadata']['title']
        
        # Przygotuj referencje tekstur
        diffuse_texture = texture_filenames.get('face', '')
        normal_texture = texture_filenames.get('face', '')  # Użyj tej samej dla normal map
        
        # USD template z teksturami
        usd_content = f'''#usda 1.0
(
    customLayerData = {{
        string creator = "Wood Power CRM"
        string[] providedExtensions = ["USDZ", "Reality"]
    }}
    defaultPrim = "WoodPanel"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "WoodPanel" (
    assetInfo = {{
        asset identifier = @./WoodPanel.reality@
        string name = "{variant}"
        string version = "1.0"
    }}
    kind = "component"
)
{{
    # Metadane AR zoptymalizowane dla iOS 18+
    custom bool preliminary_collidesWithEnvironment = 1
    custom string preliminary_planeAnchoring = "horizontal"
    custom float preliminary_worldScale = 1.0
    custom bool preliminary_receivesShadows = 1
    custom bool preliminary_castsShadows = 1
    
    def Mesh "Geometry"
    {{
        prepend references = @./{obj_filename}@</Geometry>
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
                
                # KLUCZOWE: Dodaj tekstury
                {self._get_texture_input_usd(diffuse_texture, 'diffuseColor')}
                {self._get_texture_input_usd(normal_texture, 'normal') if normal_texture else ''}
                
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
        
        return usd_content

    def _get_texture_input_usd(self, texture_filename, input_type):
        """Generuje USD kod dla tekstury"""
        if not texture_filename:
            return ''
        
        if input_type == 'diffuseColor':
            return f'''
                color3f inputs:diffuseColor.connect = </WoodPanel/Materials/WoodMaterial/DiffuseTexture.outputs:rgb>
                
                def Shader "DiffuseTexture"
                {{
                    uniform token info:id = "UsdUVTexture"
                    asset inputs:file = @./{texture_filename}@
                    float2 inputs:st.connect = </WoodPanel/Materials/WoodMaterial/UVReader.outputs:result>
                    token inputs:wrapS = "repeat"
                    token inputs:wrapT = "repeat"
                    color3f outputs:rgb
                }}
                
                def Shader "UVReader"
                {{
                    uniform token info:id = "UsdPrimvarReader_float2"
                    string inputs:varname = "st"
                    float2 outputs:result
                }}'''
        
        elif input_type == 'normal':
            return f'''
                normal3f inputs:normal.connect = </WoodPanel/Materials/WoodMaterial/NormalTexture.outputs:rgb>
                
                def Shader "NormalTexture"
                {{
                    uniform token info:id = "UsdUVTexture"
                    asset inputs:file = @./{texture_filename}@
                    float2 inputs:st.connect = </WoodPanel/Materials/WoodMaterial/UVReader.outputs:result>
                    normal3f outputs:rgb
                }}'''
        
        return ''

    def _create_reality_file_with_textures(self, scene_data, mesh_data, processed_textures, output_path):
        """POPRAWIONA METODA: Tworzy plik Reality z teksturami"""
        try:
            print(f"[RealityGenerator] Tworzenie Reality z teksturami: {processed_textures}", file=sys.stderr)
            
            # 1. Zapisz mesh jako OBJ
            obj_filename = f"model_{hashlib.md5(str(scene_data).encode()).hexdigest()[:8]}.obj"
            obj_path = os.path.join(self.temp_dir, obj_filename)
            mesh_data.export(obj_path)
            
            # 2. Przygotuj nazwy plików tekstur
            texture_filenames = {}
            texture_paths = {}
            
            for surface_type, texture_path in processed_textures.items():
                if texture_path and os.path.exists(texture_path):
                    filename = os.path.basename(texture_path)
                    texture_filenames[surface_type] = filename
                    texture_paths[surface_type] = texture_path
            
            print(f"[RealityGenerator] Pliki tekstur: {texture_filenames}", file=sys.stderr)
            
            # 3. Utwórz USD content z teksturami
            usd_content = self._create_usd_content_with_textures(scene_data, obj_filename, texture_filenames)
            usd_filename = f"scene_{hashlib.md5(str(scene_data).encode()).hexdigest()[:8]}.usd"
            usd_path = os.path.join(self.temp_dir, usd_filename)
            
            with open(usd_path, 'w', encoding='utf-8') as f:
                f.write(usd_content)
            
            # 4. Utwórz USDZ z wszystkimi plikami
            success = self._create_usdz_with_all_files(usd_path, obj_path, texture_paths, output_path)
            
            if success:
                print(f"[RealityGenerator] Reality z teksturami utworzony: {output_path}", file=sys.stderr)
                return True
            else:
                print(f"[RealityGenerator] Błąd tworzenia Reality", file=sys.stderr)
                return False
                
        except Exception as e:
            print(f"[RealityGenerator] Błąd tworzenia Reality z teksturami: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return False

    def _create_usdz_with_all_files(self, usd_path, obj_path, texture_paths, output_path):
        """POPRAWIONA METODA: Tworzy USDZ z wszystkimi plikami"""
        try:
            print(f"[RealityGenerator] Tworzenie USDZ z plikami:", file=sys.stderr)
            print(f"  USD: {os.path.basename(usd_path)}", file=sys.stderr)
            print(f"  OBJ: {os.path.basename(obj_path)}", file=sys.stderr)
            print(f"  Tekstury: {[os.path.basename(p) for p in texture_paths.values()]}", file=sys.stderr)
            
            with zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_STORED) as zf:
                # USD jako pierwszy (wymagane przez USDZ)
                zf.write(usd_path, os.path.basename(usd_path))
                
                # OBJ geometry
                zf.write(obj_path, os.path.basename(obj_path))
                
                # Wszystkie tekstury
                for surface_type, texture_path in texture_paths.items():
                    if texture_path and os.path.exists(texture_path):
                        texture_filename = os.path.basename(texture_path)
                        zf.write(texture_path, texture_filename)
                        print(f"    Dodano teksturę: {texture_filename}", file=sys.stderr)
            
            # Sprawdź czy plik został utworzony
            if os.path.exists(output_path):
                file_size = os.path.getsize(output_path)
                print(f"[RealityGenerator] USDZ utworzony: {file_size} bytes", file=sys.stderr)
                return True
            else:
                print(f"[RealityGenerator] USDZ nie został utworzony", file=sys.stderr)
                return False
            
        except Exception as e:
            print(f"[RealityGenerator] Błąd USDZ: {e}", file=sys.stderr)
            return False

    def generate_reality(self, product_data):
        """POPRAWIONA METODA: Główna metoda generowania pliku Reality z teksturami"""
        print(f"[RealityGenerator] Generowanie Reality z teksturami dla: {product_data}", file=sys.stderr)
        
        try:
            # Sprawdź cache
            cache_key = self._generate_cache_key(product_data)
            reality_path = os.path.join(self.cache_dir, f"{cache_key}.reality")
            
            if os.path.exists(reality_path):
                print(f"[RealityGenerator] Reality z cache: {reality_path}", file=sys.stderr)
                return reality_path
            
            # Pobierz tekstury
            variant_code = product_data.get('variant_code', '')
            textures = TextureConfig.get_all_textures_for_variant(variant_code)
            
            print(f"[RealityGenerator] Tekstury dla {variant_code}: {textures}", file=sys.stderr)
            
            # POPRAWIONE: Przetwórz wszystkie dostępne tekstury
            processed_textures = {}
            for surface_type in ['face', 'edge', 'side']:
                texture_variants = textures.get(surface_type, {}).get('variants', [])
                if texture_variants:
                    # Weź pierwszą dostępną teksturę
                    first_texture_url = texture_variants[0]
                    texture_local_path = self._get_texture_path(first_texture_url)
                    
                    if texture_local_path:
                        processed_texture = self._process_texture_for_reality(texture_local_path, surface_type)
                        if processed_texture:
                            processed_textures[surface_type] = processed_texture
                            print(f"[RealityGenerator] Tekstura {surface_type} przetworzona: {processed_texture}", file=sys.stderr)
                        else:
                            print(f"[RealityGenerator] Błąd przetwarzania tekstury {surface_type}", file=sys.stderr)
                    else:
                        print(f"[RealityGenerator] Nie znaleziono lokalnej ścieżki dla {surface_type}: {first_texture_url}", file=sys.stderr)
                else:
                    print(f"[RealityGenerator] Brak tekstur dla {surface_type}", file=sys.stderr)
            
            if not processed_textures:
                print(f"[RealityGenerator] UWAGA: Brak dostępnych tekstur, tworzę model bez tekstur", file=sys.stderr)
            
            # Utwórz dane sceny
            mesh_data = self._create_wood_geometry_data(product_data.get('dimensions', {}))
            scene_data = self._create_reality_scene_json(product_data, mesh_data, processed_textures)
            
            # Utwórz plik Reality z teksturami
            success = self._create_reality_file_with_textures(scene_data, mesh_data, processed_textures, reality_path)
            
            if not success:
                raise Exception("Nie udało się utworzyć pliku Reality")
            
            print(f"[RealityGenerator] Reality z teksturami wygenerowany: {reality_path}", file=sys.stderr)
            return reality_path
            
        except Exception as e:
            print(f"[RealityGenerator] Błąd generowania Reality: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            raise

    def _create_reality_scene_json(self, product_data, mesh_data, texture_paths):
        """Tworzy JSON scene descriptor dla Reality file"""
        variant_code = product_data.get('variant_code', 'unknown')
        dimensions = product_data.get('dimensions', {})
        
        scene_data = {
            "version": "1.0",
            "format": "RealityFile",
            "generator": "Wood Power CRM",
            "metadata": {
                "title": f"Wood Panel - {variant_code}",
                "description": f"Wood panel {variant_code} - {dimensions.get('length', 0)}x{dimensions.get('width', 0)}x{dimensions.get('thickness', 0)} cm",
                "creator": "Wood Power CRM",
                "keywords": ["wood", "panel", variant_code]
            },
            "textures": texture_paths  # Dodaj informacje o teksturach
        }
        
        return scene_data

    def cleanup_temp_files(self):
        """Czyści pliki tymczasowe"""
        try:
            for file in os.listdir(self.temp_dir):
                file_path = os.path.join(self.temp_dir, file)
                if os.path.isfile(file_path):
                    os.remove(file_path)
            print(f"[RealityGenerator] Pliki tymczasowe wyczyszczone", file=sys.stderr)
        except Exception as e:
            print(f"[RealityGenerator] Błąd czyszczenia: {e}", file=sys.stderr)

    def get_model_info(self, file_path):
        """Zwraca informacje o modelu Reality"""
        try:
            if not os.path.exists(file_path):
                return None
            
            stat = os.stat(file_path)
            
            # Sprawdź zawartość USDZ
            texture_count = 0
            file_list = []
            
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
                'format': 'Reality' if file_path.endswith('.reality') else os.path.splitext(file_path)[1].lower(),
                'texture_count': texture_count,
                'files_in_archive': file_list
            }
        except Exception as e:
            print(f"[RealityGenerator] Błąd info modelu: {e}", file=sys.stderr)
            return None

# Klasa TextureConfig pozostaje bez zmian
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