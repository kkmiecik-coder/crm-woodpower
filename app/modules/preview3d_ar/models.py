# modules/preview3d_ar/models.py - NOWA WERSJA Z REALITY FORMAT

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
    """Generator plików Reality dla Apple AR QuickLook"""
    
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
        if not texture_url or texture_url.startswith('http'):
            return None
        
        # Usuń prefix /static/preview3d_ar/
        if '/static/preview3d_ar/' in texture_url:
            rel_path = texture_url.split('/static/preview3d_ar/')[-1]
            return os.path.join(current_app.root_path, 'modules', 'preview3d_ar', 'static', rel_path)
        
        return None

    def _create_wood_geometry_data(self, dimensions):
        """Tworzy dane geometrii w formacie kompatybilnym z Reality"""
        print(f"[RealityGenerator] Tworzenie geometrii - wymiary: {dimensions}", file=sys.stderr)
        
        # Wymiary w metrach dla AR
        length = dimensions.get('length', 200) / 100.0  # cm -> m
        width = dimensions.get('width', 80) / 100.0
        thickness = dimensions.get('thickness', 3) / 100.0
        
        # Utwórz prostą geometrię blatu (pojedynczy blok)
        mesh = trimesh.creation.box(
            extents=[length, thickness, width]
        )
        
        # Upewnij się, że normalne są prawidłowe
        mesh.fix_normals()
        
        # Generuj UV coordinates jeśli nie ma
        if not hasattr(mesh.visual, 'uv') or mesh.visual.uv is None:
            vertices = mesh.vertices
            uv_coords = []
            for vertex in vertices:
                u = (vertex[0] + length/2) / length
                v = (vertex[2] + width/2) / width
                uv_coords.append([u, v])
            
            mesh.visual.uv = np.array(uv_coords)
        
        print(f"[RealityGenerator] Geometria utworzona - wymiary AR: {length:.3f}m x {width:.3f}m x {thickness:.3f}m", file=sys.stderr)
        print(f"[RealityGenerator] Wierzchołki: {len(mesh.vertices)}, Faces: {len(mesh.faces)}", file=sys.stderr)
        
        return mesh

    def _process_texture_for_reality(self, texture_path, target_size=(1024, 1024)):
        """Przetwarza teksturę dla formatu Reality"""
        if not texture_path or not os.path.exists(texture_path):
            print(f"[RealityGenerator] Tekstura nie istnieje: {texture_path}", file=sys.stderr)
            return None
        
        try:
            # Otwórz i przetwórz obraz
            with Image.open(texture_path) as img:
                # Konwertuj na RGB jeśli potrzeba
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # Zmień rozmiar jeśli potrzeba
                if img.size != target_size:
                    img = img.resize(target_size, Image.Resampling.LANCZOS)
                
                # Zapisz do pliku tymczasowego w formacie PNG (lepszy dla Reality)
                temp_filename = f"texture_{hashlib.md5(texture_path.encode()).hexdigest()}.png"
                temp_path = os.path.join(self.temp_dir, temp_filename)
                img.save(temp_path, 'PNG', optimize=True)
                
                print(f"[RealityGenerator] Tekstura przetworzona: {os.path.basename(texture_path)} -> {temp_filename}", file=sys.stderr)
                return temp_path
        
        except Exception as e:
            print(f"[RealityGenerator] Błąd przetwarzania tekstury {texture_path}: {e}", file=sys.stderr)
            return None

    def _create_reality_scene_json(self, product_data, mesh_data, texture_paths):
        """Tworzy JSON scene descriptor dla Reality file"""
        variant_code = product_data.get('variant_code', 'unknown')
        dimensions = product_data.get('dimensions', {})
        
        # Podstawowy template sceny Reality
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
            "scene": {
                "rootEntity": {
                    "name": "WoodPanel",
                    "transform": {
                        "translation": [0, 0, 0],
                        "rotation": [0, 0, 0, 1],
                        "scale": [1, 1, 1]
                    },
                    "components": {
                        "ARKit": {
                            "planeDetection": ["horizontal"],
                            "worldAlignment": "gravity",
                            "environmentTexturing": "automatic"
                        },
                        "Model": {
                            "mesh": "WoodMesh",
                            "materials": ["WoodMaterial"]
                        },
                        "Collision": {
                            "enabled": True,
                            "shape": "automatic"
                        }
                    }
                }
            },
            "resources": {
                "meshes": {
                    "WoodMesh": {
                        "type": "generated",
                        "primitive": "box",
                        "dimensions": {
                            "width": dimensions.get('length', 200) / 100.0,
                            "height": dimensions.get('thickness', 3) / 100.0,
                            "depth": dimensions.get('width', 80) / 100.0
                        }
                    }
                },
                "materials": {
                    "WoodMaterial": {
                        "type": "PhysicallyBased",
                        "baseColor": {
                            "texture": texture_paths.get('face') if texture_paths.get('face') else None,
                            "color": [0.82, 0.71, 0.55, 1.0]
                        },
                        "roughness": 0.85,
                        "metallic": 0.0,
                        "normal": {
                            "texture": texture_paths.get('face') if texture_paths.get('face') else None
                        }
                    }
                }
            }
        }
        
        return scene_data

    def _create_reality_file(self, scene_data, output_path):
        """Tworzy plik Reality na podstawie danych sceny"""
        try:
            # Reality file to w rzeczywistości specjalny format binarny Apple
            # Na razie użyjemy prostego podejścia - utworzymy USDZ z lepszymi metadanymi
            # i przekonwertujemy go używając narzędzi Apple jeśli są dostępne
            
            # Sprawdź czy jest dostępne narzędzie Reality Converter
            reality_converter_path = self._find_reality_converter()
            
            if reality_converter_path:
                return self._create_reality_with_converter(scene_data, output_path, reality_converter_path)
            else:
                # Fallback: utwórz zoptymalizowany USDZ który będzie kompatybilny
                return self._create_optimized_usdz_as_reality(scene_data, output_path)
                
        except Exception as e:
            print(f"[RealityGenerator] Błąd tworzenia pliku Reality: {e}", file=sys.stderr)
            return False

    def _find_reality_converter(self):
        """Próbuje znaleźć Reality Converter lub inne narzędzia Apple"""
        possible_paths = [
            '/Applications/Reality Converter.app/Contents/MacOS/Reality Converter',
            '/usr/bin/xcrun',
            '/Applications/Xcode.app/Contents/Developer/usr/bin/reality_converter'
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                print(f"[RealityGenerator] Znaleziono narzędzie: {path}", file=sys.stderr)
                return path
        
        print("[RealityGenerator] Nie znaleziono Reality Converter, używam fallback", file=sys.stderr)
        return None

    def _create_optimized_usdz_as_reality(self, scene_data, output_path):
        """Tworzy zoptymalizowany USDZ który będzie działał jak Reality file"""
        try:
            # Na razie jako workaround, utworzymy bardzo zoptymalizowany USDZ
            # który będzie miał rozszerzenie .reality ale będzie w rzeczywistości USDZ
            
            # Zmień rozszerzenie na .usdz dla procesu tworzenia
            usdz_temp_path = output_path.replace('.reality', '.usdz')
            
            # Utwórz mesh
            dimensions = scene_data['resources']['meshes']['WoodMesh']['dimensions']
            mesh = trimesh.creation.box(
                extents=[dimensions['width'], dimensions['height'], dimensions['depth']]
            )
            
            # Zapisz OBJ
            obj_file = os.path.join(self.temp_dir, 'temp_model.obj')
            mesh.export(obj_file)
            
            # Utwórz prostszy USD content
            usd_content = self._create_simple_usd_content(scene_data, obj_file)
            usd_file = os.path.join(self.temp_dir, 'temp_scene.usd')
            
            with open(usd_file, 'w', encoding='utf-8') as f:
                f.write(usd_content)
            
            # Utwórz USDZ
            success = self._create_usdz_zip(usd_file, obj_file, None, usdz_temp_path)
            
            if success and os.path.exists(usdz_temp_path):
                # Skopiuj jako .reality
                import shutil
                shutil.copy2(usdz_temp_path, output_path)
                
                print(f"[RealityGenerator] Reality file utworzony (USDZ fallback): {output_path}", file=sys.stderr)
                return True
            
            return False
            
        except Exception as e:
            print(f"[RealityGenerator] Błąd tworzenia fallback Reality: {e}", file=sys.stderr)
            return False

    def _create_simple_usd_content(self, scene_data, obj_file):
        """Tworzy prostszy USD content zoptymalizowany dla Reality"""
        variant = scene_data['metadata']['title']
        obj_basename = os.path.basename(obj_file)
        
        # Uproszczony USD template kompatybilny z Reality/QuickLook
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
        prepend references = @./{obj_basename}@</Geometry>
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
        
        return usd_content

    def _create_usdz_zip(self, usd_file, obj_file, texture_file, output_path):
        """Tworzy USDZ jako ZIP"""
        try:
            import zipfile
            
            with zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_STORED) as zf:
                # USD jako pierwszy (wymagane)
                zf.write(usd_file, os.path.basename(usd_file))
                # OBJ
                zf.write(obj_file, os.path.basename(obj_file))
                # Tekstura (jeśli jest)
                if texture_file and os.path.exists(texture_file):
                    zf.write(texture_file, os.path.basename(texture_file))
            
            return os.path.exists(output_path)
            
        except Exception as e:
            print(f"[RealityGenerator] Błąd USDZ ZIP: {e}", file=sys.stderr)
            return False

    def generate_reality(self, product_data):
        """Główna metoda generowania pliku Reality"""
        print(f"[RealityGenerator] Generowanie Reality dla: {product_data}", file=sys.stderr)
        
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
            
            # Przetwórz tekstury
            texture_paths = {}
            for surface_type in ['face', 'edge', 'side']:
                if textures.get(surface_type, {}).get('variants'):
                    texture_url = textures[surface_type]['variants'][0]
                    texture_local_path = self._get_texture_path(texture_url)
                    if texture_local_path:
                        processed_texture = self._process_texture_for_reality(texture_local_path)
                        if processed_texture:
                            texture_paths[surface_type] = processed_texture
            
            # Utwórz dane sceny
            mesh_data = self._create_wood_geometry_data(product_data.get('dimensions', {}))
            scene_data = self._create_reality_scene_json(product_data, mesh_data, texture_paths)
            
            # Utwórz plik Reality
            success = self._create_reality_file(scene_data, reality_path)
            
            if not success:
                raise Exception("Nie udało się utworzyć pliku Reality")
            
            print(f"[RealityGenerator] Reality wygenerowany: {reality_path}", file=sys.stderr)
            return reality_path
            
        except Exception as e:
            print(f"[RealityGenerator] Błąd generowania Reality: {e}", file=sys.stderr)
            raise

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
            return {
                'file_size': stat.st_size,
                'file_size_mb': round(stat.st_size / (1024*1024), 2),
                'created': stat.st_mtime,
                'format': 'Reality' if file_path.endswith('.reality') else os.path.splitext(file_path)[1].lower()
            }
        except Exception as e:
            print(f"[RealityGenerator] Błąd info modelu: {e}", file=sys.stderr)
            return None

# Backward compatibility - zachowaj stary generator USDZ
class AR3DGenerator(RealityGenerator):
    """Deprecated - używaj RealityGenerator"""
    
    def generate_usdz(self, product_data):
        """Backward compatibility wrapper"""
        print("[AR3DGenerator] DEPRECATED: Użyj RealityGenerator.generate_reality()", file=sys.stderr)
        reality_path = self.generate_reality(product_data)
        # Skopiuj .reality jako .usdz dla backward compatibility
        if reality_path:
            usdz_path = reality_path.replace('.reality', '.usdz')
            import shutil
            shutil.copy2(reality_path, usdz_path)
            return usdz_path
        return None