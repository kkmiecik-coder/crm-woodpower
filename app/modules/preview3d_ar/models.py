# modules/preview3d_ar/models.py

import os
import glob
import tempfile
import hashlib
from flask import current_app, url_for
import trimesh
import numpy as np
from PIL import Image
import pygltflib
from pygltflib import GLTF2, Material, PbrMetallicRoughness, TextureInfo, Texture, Image as GLTFImage, Sampler
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
        data_str = f"{product_data.get('variant_code', '')}-{product_data.get('dimensions', {})}"
        return hashlib.md5(data_str.encode()).hexdigest()

    def _get_texture_path(self, texture_url):
        """Konwertuje URL tekstury na ścieżkę lokalną"""
        if texture_url.startswith('http'):
            return None  # Nie obsługujemy zdalnych tekstur
        
        # Usuń prefix /static/preview3d_ar/
        if '/static/preview3d_ar/' in texture_url:
            rel_path = texture_url.split('/static/preview3d_ar/')[-1]
            return os.path.join(current_app.root_path, 'modules', 'preview3d_ar', 'static', rel_path)
        
        return None

    def _create_wood_geometry(self, dimensions):
        """Tworzy geometrię drewnianego blatu z lamelkami"""
        print(f"[AR3DGenerator] Tworzenie geometrii - wymiary: {dimensions}", file=sys.stderr)
        
        # Wymiary w metrach
        length = dimensions.get('length', 200) / 100.0  # cm -> m
        width = dimensions.get('width', 80) / 100.0
        thickness = dimensions.get('thickness', 3) / 100.0
        
        # Szerokość pojedynczej lamelki (4cm)
        lamella_width = 0.04
        num_lamellas = max(1, int(width / lamella_width))
        actual_lamella_width = width / num_lamellas
        
        print(f"[AR3DGenerator] Lamelki: {num_lamellas} x {actual_lamella_width:.3f}m", file=sys.stderr)
        
        # Łącz wszystkie lamelki w jeden mesh
        combined_mesh = None
        
        for i in range(num_lamellas):
            # Pozycja lamelki
            z_pos = (i - num_lamellas/2 + 0.5) * actual_lamella_width
            
            # Utwórz pojedynczą lamellę
            lamella = trimesh.creation.box(
                extents=[length, thickness, actual_lamella_width]
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
                temp_path = os.path.join(self.temp_dir, f"texture_{os.path.basename(texture_path)}")
                img.save(temp_path, 'JPEG', quality=85)
                
                print(f"[AR3DGenerator] Tekstura przetworzona: {texture_path} -> {temp_path}", file=sys.stderr)
                return temp_path
        
        except Exception as e:
            print(f"[AR3DGenerator] Błąd przetwarzania tekstury {texture_path}: {e}", file=sys.stderr)
            return None

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
                    # Zastosuj teksturę
                    texture_image = Image.open(processed_texture)
                    # Tutaj można dodać bardziej zaawansowane mapowanie tekstur
                    print(f"[AR3DGenerator] Aplikacja tekstury: {processed_texture}", file=sys.stderr)
            
            # Wyeksportuj do GLB
            mesh.export(glb_path)
            
            print(f"[AR3DGenerator] GLB wygenerowany: {glb_path}", file=sys.stderr)
            return glb_path
            
        except Exception as e:
            print(f"[AR3DGenerator] Błąd generowania GLB: {e}", file=sys.stderr)
            raise

    def generate_usdz(self, product_data):
        """Generuje plik USDZ dla iOS QuickLook"""
        print(f"[AR3DGenerator] Generowanie USDZ dla: {product_data}", file=sys.stderr)
    
        try:
            # Sprawdź cache
            cache_key = self._generate_cache_key(product_data)
        
            # POPRAWKA: Sprawdź czy już istnieje GLB i użyj go jako USDZ
            glb_path = os.path.join(self.cache_dir, f"{cache_key}.glb")
        
            if os.path.exists(glb_path):
                print(f"[AR3DGenerator] Używam GLB jako USDZ: {glb_path}", file=sys.stderr)
                return glb_path
        
            # Jeśli nie ma GLB, wygeneruj nowy
            glb_path = self.generate_glb(product_data)
        
            print(f"[AR3DGenerator] USDZ wygenerowany (jako GLB): {glb_path}", file=sys.stderr)
            return glb_path
        
        except Exception as e:
            print(f"[AR3DGenerator] Błąd generowania USDZ: {e}", file=sys.stderr)
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