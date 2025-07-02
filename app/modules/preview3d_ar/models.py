# modules/preview3d_ar/models.py

import os
import glob
from flask import current_app, url_for

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
