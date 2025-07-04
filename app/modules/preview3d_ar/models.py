# modules/preview3d_ar/models.py - NAPRAWIONA WERSJA

import os
import glob
import tempfile
import hashlib
import subprocess
import json
import sys
import zipfile
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
        Zwraca dla każdego typu powierzchni:
          {
            'variants': [url1, url2, ...],
            'fallback_color': '#XXXXXX'
          }
        """
        try:
            species, tech, wood_class = TextureConfig.parse_variant(variant_code)
        except ValueError:
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

        textures = {}
        for surf in TextureConfig.SURFACE_TYPES:
            pattern = os.path.join(base_dir, f"{surf}_*.jpg")
            files = glob.glob(pattern)
            urls = []
            for path in sorted(files):
                # ścieżka względna od katalogu static
                rel = os.path.relpath(
                    path,
                    os.path.join(current_app.root_path, 'modules', 'preview3d_ar', 'static')
                )
                rel = rel.replace(os.sep, '/')
                urls.append(url_for('preview3d_ar.static', filename=rel))
            textures[surf] = {
                'variants': urls,
                'fallback_color': TextureConfig.FALLBACK_COLORS[surf]
            }
        return textures

class RealityGenerator:
    """Generator plików Reality/USDZ dla Apple AR QuickLook"""
    
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

    def _create_wood_geometry_usd(self, dimensions, variant_code):
        """Tworzy prawidłową geometrię USD dla drewna"""
        print(f"[RealityGenerator] Tworzenie USD geometrii - wymiary: {dimensions}", file=sys.stderr)
        
        # Wymiary w metrach dla AR (konwersja z cm)
        length = dimensions.get('length', 200) / 100.0  # cm -> m
        width = dimensions.get('width', 80) / 100.0
        thickness = dimensions.get('thickness', 3) / 100.0
        
        # POPRAWIONY USD content z właściwą strukturą
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
    # KLUCZOWE: Metadane AR dla iOS QuickLook
    custom bool preliminary_collidesWithEnvironment = 1
    custom string preliminary_planeAnchoring = "horizontal"
    custom float preliminary_worldScale = 1.0
    custom bool preliminary_receivesShadows = 1
    custom bool preliminary_castsShadows = 1
    
    def Mesh "WoodMesh"
    {{
        # POPRAWIONA geometria - bezpośrednie definiowanie box
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
        normal3f[] normals = [
            (0, 0, -1), (0, 0, -1), (0, 0, -1), (0, 0, -1),
            (0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1),
            (0, -1, 0), (0, -1, 0), (0, -1, 0), (0, -1, 0),
            (0, 1, 0), (0, 1, 0), (0, 1, 0), (0, 1, 0),
            (-1, 0, 0), (-1, 0, 0), (-1, 0, 0), (-1, 0, 0),
            (1, 0, 0), (1, 0, 0), (1, 0, 0), (1, 0, 0)
        ]
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
        
        print(f"[RealityGenerator] USD content utworzony - wymiary AR: {length:.3f}m x {width:.3f}m x {thickness:.3f}m", file=sys.stderr)
        return usd_content

    def _create_proper_usdz(self, usd_content, output_path):
        """Tworzy PRAWIDŁOWY plik USDZ jako ZIP"""
        try:
            print(f"[RealityGenerator] Tworzenie USDZ: {output_path}", file=sys.stderr)
            
            # Utwórz pliki tymczasowe
            usd_file = os.path.join(self.temp_dir, 'model.usd')
            
            # Zapisz USD
            with open(usd_file, 'w', encoding='utf-8') as f:
                f.write(usd_content)
            
            # KLUCZOWE: Utwórz USDZ jako właściwy ZIP
            with zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_STORED) as zf:
                # WAŻNE: USD musi być pierwszym plikiem w archiwum
                zf.write(usd_file, 'model.usd')
            
            # Sprawdź czy plik został utworzony
            if not os.path.exists(output_path):
                raise Exception(f"Nie udało się utworzyć pliku USDZ: {output_path}")
            
            file_size = os.path.getsize(output_path)
            print(f"[RealityGenerator] USDZ utworzony: {output_path}, rozmiar: {file_size} bytes", file=sys.stderr)
            
            return True
            
        except Exception as e:
            print(f"[RealityGenerator] Błąd tworzenia USDZ: {e}", file=sys.stderr)
            return False
        finally:
            # Wyczyść pliki tymczasowe
            if os.path.exists(usd_file):
                os.remove(usd_file)

    def _check_reality_converter_available(self):
        """Sprawdza czy Reality Converter jest dostępny"""
        # Reality Converter działa tylko na macOS z Xcode
        try:
            result = subprocess.run(['xcrun', '--find', 'RealityConverter'], 
                                  capture_output=True, text=True)
            if result.returncode == 0:
                print("[RealityGenerator] Reality Converter dostępny", file=sys.stderr)
                return True
        except:
            pass
        
        print("[RealityGenerator] Reality Converter niedostępny - używam USDZ", file=sys.stderr)
        return False

    def generate_reality(self, product_data):
        """
        GŁÓWNA METODA: Generuje plik Reality (lub USDZ fallback)
        
        WAŻNE: Prawdziwe pliki Reality można tworzyć tylko na macOS z Xcode.
        Na innych systemach tworzymy wysokiej jakości USDZ.
        """
        print(f"[RealityGenerator] Generowanie AR dla: {product_data}", file=sys.stderr)
        
        try:
            # Sprawdź cache
            cache_key = self._generate_cache_key(product_data)
            
            # ZMIANA: Sprawdź czy Reality Converter jest dostępny
            can_create_reality = self._check_reality_converter_available()
            
            if can_create_reality:
                # Próbuj utworzyć prawdziwy plik Reality
                reality_path = os.path.join(self.cache_dir, f"{cache_key}.reality")
                if os.path.exists(reality_path):
                    print(f"[RealityGenerator] Reality z cache: {reality_path}", file=sys.stderr)
                    return reality_path
                
                # Tutaj byłaby logika Reality Converter (wymagane macOS + Xcode)
                # Na razie fallback do USDZ
                print("[RealityGenerator] Reality creation not implemented - fallback to USDZ", file=sys.stderr)
            
            # FALLBACK: Utwórz wysokiej jakości USDZ
            usdz_path = os.path.join(self.cache_dir, f"{cache_key}.usdz")
            
            if os.path.exists(usdz_path):
                print(f"[RealityGenerator] USDZ z cache: {usdz_path}", file=sys.stderr)
                return usdz_path
            
            # Pobierz dane produktu
            variant_code = product_data.get('variant_code', 'unknown')
            dimensions = product_data.get('dimensions', {})
            
            # Walidacja wymiarów
            if not all(dimensions.values()) or any(d <= 0 for d in dimensions.values()):
                raise ValueError("Nieprawidłowe wymiary produktu")
            
            # Utwórz USD content
            usd_content = self._create_wood_geometry_usd(dimensions, variant_code)
            
            # Utwórz USDZ
            success = self._create_proper_usdz(usd_content, usdz_path)
            
            if not success:
                raise Exception("Nie udało się utworzyć pliku USDZ")
            
            print(f"[RealityGenerator] USDZ wygenerowany: {usdz_path}", file=sys.stderr)
            return usdz_path
            
        except Exception as e:
            print(f"[RealityGenerator] Błąd generowania: {e}", file=sys.stderr)
            raise

    def cleanup_temp_files(self):
        """Czyści pliki tymczasowe"""
        try:
            for file in os.listdir(self.temp_dir):
                if file.endswith(('.usd', '.obj', '.tmp')):
                    file_path = os.path.join(self.temp_dir, file)
                    if os.path.isfile(file_path):
                        os.remove(file_path)
            print(f"[RealityGenerator] Pliki tymczasowe wyczyszczone", file=sys.stderr)
        except Exception as e:
            print(f"[RealityGenerator] Błąd czyszczenia: {e}", file=sys.stderr)

    def get_model_info(self, file_path):
        """Zwraca informacje o modelu"""
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
            
            return {
                'file_size': stat.st_size,
                'file_size_mb': round(stat.st_size / (1024*1024), 2),
                'created': stat.st_mtime,
                'format': format_name,
                'is_valid_usdz': self._validate_usdz(file_path) if ext == '.usdz' else None
            }
        except Exception as e:
            print(f"[RealityGenerator] Błąd info modelu: {e}", file=sys.stderr)
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
                
                return {
                    'is_valid_zip': True,
                    'has_usd_file': has_usd,
                    'first_file_is_usd': first_file_is_usd,
                    'files_count': len(files),
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
        print("[AR3DGenerator] DEPRECATED: Użyj RealityGenerator.generate_reality()", file=sys.stderr)
        return self.generate_reality(product_data)