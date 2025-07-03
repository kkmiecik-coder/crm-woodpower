# modules/preview3d_ar/models.py - POPRAWIONA WERSJA

import os
import glob
import tempfile
import hashlib
import subprocess
import json
from flask import current_app, url_for
import trimesh
import numpy as np
from PIL import Image
import sys

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

class AR3DGenerator:
    """Generator plików 3D dla AR - tworzy modele USDZ (iOS) i GLB (Android)"""
    
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
        
        print(f"[AR3DGenerator] Inicjalizacja - cache: {self.cache_dir}", file=sys.stderr)
        print(f"[AR3DGenerator] Inicjalizacja - temp: {self.temp_dir}", file=sys.stderr)

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

    def _create_wood_geometry(self, dimensions):
        """Tworzy geometrię drewnianego blatu z lamelkami"""
        print(f"[AR3DGenerator] Tworzenie geometrii - wymiary: {dimensions}", file=sys.stderr)
        
        # Wymiary w metrach - SKALA AR (mniejsze obiekty)
        length = dimensions.get('length', 200) / 1000.0  # cm -> m, skalowane do AR
        width = dimensions.get('width', 80) / 1000.0
        thickness = dimensions.get('thickness', 3) / 1000.0
        
        # Szerokość pojedynczej lamelki
        lamella_width = width / 10  # Podziel na 10 lamellek
        num_lamellas = 10
        
        print(f"[AR3DGenerator] Wymiary AR: {length}m x {width}m x {thickness}m", file=sys.stderr)
        print(f"[AR3DGenerator] Lamelki: {num_lamellas} x {lamella_width:.4f}m", file=sys.stderr)
        
        # Łącz wszystkie lamelki w jeden mesh
        combined_mesh = None
        
        for i in range(num_lamellas):
            # Pozycja lamelki
            z_pos = (i - num_lamellas/2 + 0.5) * lamella_width
            
            # Utwórz pojedynczą lamellę
            lamella = trimesh.creation.box(
                extents=[length, thickness, lamella_width]
            )
            
            # Przesuń lamellę na właściwą pozycję
            lamella.apply_translation([0, 0, z_pos])
            
            # Dodaj do kombinowanego mesh
            if combined_mesh is None:
                combined_mesh = lamella
            else:
                combined_mesh = trimesh.util.concatenate([combined_mesh, lamella])
        
        print(f"[AR3DGenerator] Geometria utworzona - wierzchołki: {len(combined_mesh.vertices)}", file=sys.stderr)
        return combined_mesh

    def _process_texture_for_ar(self, texture_path, target_size=(512, 512)):
        """Przetwarza teksturę dla AR - optymalizuje rozmiar i format"""
        if not texture_path or not os.path.exists(texture_path):
            print(f"[AR3DGenerator] Tekstura nie istnieje: {texture_path}", file=sys.stderr)
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
                
                # Zapisz do pliku tymczasowego
                temp_filename = f"texture_{hashlib.md5(texture_path.encode()).hexdigest()}.jpg"
                temp_path = os.path.join(self.temp_dir, temp_filename)
                img.save(temp_path, 'JPEG', quality=85)
                
                print(f"[AR3DGenerator] Tekstura przetworzona: {os.path.basename(texture_path)} -> {temp_filename}", file=sys.stderr)
                return temp_path
        
        except Exception as e:
            print(f"[AR3DGenerator] Błąd przetwarzania tekstury {texture_path}: {e}", file=sys.stderr)
            return None

    def _create_usd_content(self, obj_file, texture_file, product_data):
        """Tworzy zawartość pliku USD z metadanymi AR"""
        variant_code = product_data.get('variant_code', 'unknown')
        dimensions = product_data.get('dimensions', {})
        
        # Upewnij się, że ścieżki są względne
        obj_basename = os.path.basename(obj_file)
        texture_basename = os.path.basename(texture_file) if texture_file else None
        
        # Podstawowy szablon USD z metadanymi AR
        usd_content = f'''#usda 1.0
(
    doc = "Wood Power AR Model - {variant_code}"
    metersPerUnit = 1
    upAxis = "Y"
    defaultPrim = "WoodModel"
)

def Xform "WoodModel" (
    assetInfo = {{
        string identifier = "{variant_code}"
        string name = "Wood Panel {variant_code}"
        string version = "1.0"
    }}
    kind = "component"
    variants = {{
        string materialVariant = "wood"
    }}
)
{{
    # Metadane AR dla iOS
    custom bool preliminary_collidesWithEnvironment = 1
    custom string preliminary_planeAnchoring = "horizontal"
    custom bool preliminary_receivesShadows = 1
    custom bool preliminary_castsShadows = 1
    
    def Mesh "WoodMesh"
    {{
        int[] faceVertexCounts = []
        int[] faceVertexIndices = []
        point3f[] points = []
        normal3f[] normals = []
        float2[] primvars:st = []
        
        # Referencja do pliku OBJ
        prepend references = @./{obj_basename}@
        
        # Materiał'''

        if texture_basename:
            usd_content += f'''
        rel material:binding = </WoodModel/Materials/WoodMaterial>
    }}
    
    def Scope "Materials"
    {{
        def Material "WoodMaterial"
        {{
            token outputs:surface.connect = </WoodModel/Materials/WoodMaterial/PreviewSurface.outputs:surface>
            
            def Shader "PreviewSurface"
            {{
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor.connect = </WoodModel/Materials/WoodMaterial/DiffuseTexture.outputs:rgb>
                float inputs:roughness = 0.8
                float inputs:metallic = 0.0
                token outputs:surface
            }}
            
            def Shader "DiffuseTexture"
            {{
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @./{texture_basename}@
                token inputs:wrapS = "repeat"
                token inputs:wrapT = "repeat"
                float3 outputs:rgb
            }}
            
            def Shader "TextureCoordinate"
            {{
                uniform token info:id = "UsdPrimvarReader_float2"
                token inputs:varname = "st"
                float2 outputs:result
            }}
        }}
    }}'''
        else:
            # Materiał bez tekstury
            usd_content += f'''
        rel material:binding = </WoodModel/Materials/WoodMaterial>
    }}
    
    def Scope "Materials"
    {{
        def Material "WoodMaterial"
        {{
            token outputs:surface.connect = </WoodModel/Materials/WoodMaterial/PreviewSurface.outputs:surface>
            
            def Shader "PreviewSurface"
            {{
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0.8, 0.7, 0.6)
                float inputs:roughness = 0.8
                float inputs:metallic = 0.0
                token outputs:surface
            }}
        }}
    }}'''

        usd_content += '''
}
'''
        
        return usd_content

    def _create_usdz_with_command_line(self, usd_file, obj_file, texture_file, output_path):
        """Tworzy plik USDZ używając narzędzi USD (jeśli dostępne)"""
        try:
            # Sprawdź czy usdzip jest dostępny
            result = subprocess.run(['which', 'usdzip'], 
                                   capture_output=True, text=True)
            if result.returncode != 0:
                print("[AR3DGenerator] usdzip nie jest dostępny", file=sys.stderr)
                return False
            
            # Przygotuj listę plików do spakowania
            files_to_zip = [usd_file, obj_file]
            if texture_file and os.path.exists(texture_file):
                files_to_zip.append(texture_file)
            
            # Utwórz USDZ
            cmd = ['usdzip', output_path] + files_to_zip
            result = subprocess.run(cmd, capture_output=True, text=True, 
                                   cwd=os.path.dirname(usd_file))
            
            if result.returncode == 0:
                print(f"[AR3DGenerator] USDZ utworzony: {output_path}", file=sys.stderr)
                return True
            else:
                print(f"[AR3DGenerator] Błąd usdzip: {result.stderr}", file=sys.stderr)
                return False
                
        except Exception as e:
            print(f"[AR3DGenerator] Błąd tworzenia USDZ: {e}", file=sys.stderr)
            return False

    def _create_usdz_with_zip(self, usd_file, obj_file, texture_file, output_path):
        """Tworzy plik USDZ jako archiwum ZIP (fallback)"""
        try:
            import zipfile

            with zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_STORED) as zf:
                # Dodaj plik USD
                zf.write(usd_file, os.path.basename(usd_file))
                # Dodaj plik OBJ
                zf.write(obj_file, os.path.basename(obj_file))
                # Dodaj teksturę jeśli istnieje
                if texture_file and os.path.exists(texture_file):
                    zf.write(texture_file, os.path.basename(texture_file))

                print(f"[AR3DGenerator] USDZ utworzony jako ZIP: {output_path}", file=sys.stderr)
                return True
        except Exception as e:
            print(f"[AR3DGenerator] Błąd tworzenia USDZ ZIP: {e}", file=sys.stderr)
            return False

    def generate_usdz(self, product_data):
        """Generuje plik USDZ dla iOS QuickLook AR"""
        print(f"[AR3DGenerator] Generowanie USDZ dla: {product_data}", file=sys.stderr)
    
        try:
            # Sprawdź cache
            cache_key = self._generate_cache_key(product_data)
            usdz_path = os.path.join(self.cache_dir, f"{cache_key}.usdz")
            
            if os.path.exists(usdz_path):
                print(f"[AR3DGenerator] USDZ z cache: {usdz_path}", file=sys.stderr)
                return usdz_path
            
            # Pobierz tekstury
            variant_code = product_data.get('variant_code', '')
            textures = TextureConfig.get_all_textures_for_variant(variant_code)
            
            # Wybierz pierwszą dostępną teksturę dla face
            face_texture_url = None
            if textures.get('face', {}).get('variants'):
                face_texture_url = textures['face']['variants'][0]
            
            # Utwórz geometrię
            dimensions = product_data.get('dimensions', {})
            mesh = self._create_wood_geometry(dimensions)
            
            # Zapisz OBJ do pliku tymczasowego
            obj_file = os.path.join(self.temp_dir, f"{cache_key}.obj")
            mesh.export(obj_file)
            
            # Przetwórz teksturę
            texture_file = None
            if face_texture_url:
                texture_path = self._get_texture_path(face_texture_url)
                texture_file = self._process_texture_for_ar(texture_path)
            
            # Utwórz plik USD
            usd_file = os.path.join(self.temp_dir, f"{cache_key}.usd")
            usd_content = self._create_usd_content(obj_file, texture_file, product_data)
            
            with open(usd_file, 'w', encoding='utf-8') as f:
                f.write(usd_content)
            
            # Utwórz USDZ
            success = self._create_usdz_with_command_line(usd_file, obj_file, texture_file, usdz_path)
            
            if not success:
                # Fallback do ZIP
                success = self._create_usdz_with_zip(usd_file, obj_file, texture_file, usdz_path)
            
            if not success:
                raise Exception("Nie udało się utworzyć pliku USDZ")
            
            print(f"[AR3DGenerator] USDZ wygenerowany: {usdz_path}", file=sys.stderr)
            return usdz_path
            
        except Exception as e:
            print(f"[AR3DGenerator] Błąd generowania USDZ: {e}", file=sys.stderr)
            raise

    def generate_glb(self, product_data):
        """Generuje plik GLB dla Android WebXR"""
        print(f"[AR3DGenerator] Generowanie GLB dla: {product_data}", file=sys.stderr)
        
        try:
            # Sprawdź cache
            cache_key = self._generate_cache_key(product_data)
            glb_path = os.path.join(self.cache_dir, f"{cache_key}.glb")
            
            if os.path.exists(glb_path):
                print(f"[AR3DGenerator] GLB z cache: {glb_path}", file=sys.stderr)
                return glb_path
            
            # Pobierz tekstury
            variant_code = product_data.get('variant_code', '')
            textures = TextureConfig.get_all_textures_for_variant(variant_code)
            
            # Wybierz pierwszą dostępną teksturę dla face
            face_texture_url = None
            if textures.get('face', {}).get('variants'):
                face_texture_url = textures['face']['variants'][0]
            
            # Utwórz geometrię
            dimensions = product_data.get('dimensions', {})
            mesh = self._create_wood_geometry(dimensions)
            
            # Dodaj teksturę jeśli dostępna
            if face_texture_url:
                texture_path = self._get_texture_path(face_texture_url)
                processed_texture = self._process_texture_for_ar(texture_path)
                
                if processed_texture:
                    # Załaduj teksturę
                    try:
                        texture_image = Image.open(processed_texture)
                        # Konwertuj na tablicę numpy
                        texture_array = np.array(texture_image)
                        
                        # Dodaj materiał z teksturą
                        material = trimesh.visual.material.PBRMaterial(
                            baseColorTexture=texture_array,
                            metallicFactor=0.0,
                            roughnessFactor=0.8
                        )
                        
                        # Przypisz materiał do mesh
                        mesh.visual.material = material
                        
                        print(f"[AR3DGenerator] Tekstura zastosowana: {processed_texture}", file=sys.stderr)
                    except Exception as e:
                        print(f"[AR3DGenerator] Błąd aplikacji tekstury: {e}", file=sys.stderr)
            
            # Wyeksportuj do GLB
            mesh.export(glb_path)
            
            print(f"[AR3DGenerator] GLB wygenerowany: {glb_path}", file=sys.stderr)
            return glb_path
            
        except Exception as e:
            print(f"[AR3DGenerator] Błąd generowania GLB: {e}", file=sys.stderr)
            raise

    def cleanup_temp_files(self):
        """Czyści pliki tymczasowe"""
        try:
            for file in os.listdir(self.temp_dir):
                file_path = os.path.join(self.temp_dir, file)
                if os.path.isfile(file_path):
                    os.remove(file_path)
            print(f"[AR3DGenerator] Pliki tymczasowe wyczyszczone", file=sys.stderr)
        except Exception as e:
            print(f"[AR3DGenerator] Błąd czyszczenia: {e}", file=sys.stderr)

    def get_model_info(self, file_path):
        """Zwraca informacje o modelu"""
        try:
            if not os.path.exists(file_path):
                return None
            
            stat = os.stat(file_path)
            return {
                'file_size': stat.st_size,
                'file_size_mb': round(stat.st_size / (1024*1024), 2),
                'created': stat.st_mtime,
                'format': os.path.splitext(file_path)[1].lower()
            }
        except Exception as e:
            print(f"[AR3DGenerator] Błąd info modelu: {e}", file=sys.stderr)
            return None