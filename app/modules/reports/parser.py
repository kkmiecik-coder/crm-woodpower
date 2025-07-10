# modules/reports/parser.py
"""
Parser nazw produktów z Baselinker
Wyciąga wymiary, gatunek, technologię, klasę i wykończenie z nazwy produktu
"""

import re
from typing import Dict, Optional, Tuple
from decimal import Decimal


class ProductNameParser:
    """
    Klasa do parsowania nazw produktów z Baselinker
    
    Przykłady nazw:
    - "Klejonka bukowa mikrowczep A/B 98.0×40.0×2.0cm"
    - "Parapet 160x20x2 cm dębowy lity B/B surowy"
    - "Blat drewniany dębowy mikrowczep A/B 90x60x2 cm surowy"
    - "Spocznik dąb lity A/B 190x88x3 cm lakierowany"
    """
    
    # Mapowanie gatunków drewna
    WOOD_SPECIES_MAP = {
        'bukowa': 'buk',
        'bukowy': 'buk', 
        'bukowe': 'buk',
        'dębowa': 'dąb',
        'dębowy': 'dąb',
        'dębowe': 'dąb',
        'jesionowa': 'jesion',
        'jesionowy': 'jesion',
        'jesionowe': 'jesion',
        'dąb': 'dąb',  # już w formie kanonicznej
        'jesion': 'jesion',
        'buk': 'buk'
    }
    
    # Mapowanie technologii
    TECHNOLOGY_MAP = {
        'lity': 'lity',
        'lita': 'lity',
        'lite': 'lity',
        'mikrowczep': 'mikrowczep'
    }
    
    # Mapowanie wykończeń
    FINISH_MAP = {
        'surowy': 'surowy',
        'surowa': 'surowy',
        'surowe': 'surowy',
        'lakierowany': 'lakierowany',
        'lakierowana': 'lakierowany',
        'lakierowane': 'lakierowany',
        'olejowany': 'olejowany',
        'olejowana': 'olejowany',
        'olejowane': 'olejowany',
        'bezbarwny': 'lakierowany'  # "lakierowany bezbarwny"
    }
    
    # POPRAWKA: Zaktualizowane mapowanie typów produktów
    PRODUCT_TYPE_MAP = {
        'klejonka': 'klejonka',
        'deska': 'deska',
        'blat': 'deska',      # blat to rodzaj deski
        'parapet': 'deska',   # parapet to rodzaj deski  
        'spocznik': 'deska',  # spocznik to rodzaj deski
        'schody': 'deska',    # schody/stopień to rodzaj deski
        'trep': 'deska',
        'stopień': 'deska'
    }
    
    def __init__(self):
        # Regex dla wymiarów - obsługuje różne separatory
        self.dimension_patterns = [
            # Format: 98.0×40.0×2.0cm
            r'(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*cm',
            # Format: 160x20x2 cm
            r'(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s+cm',
            # Format: 120/30/2.5 cm
            r'(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*cm',
        ]
        
        # Regex dla klasy drewna
        self.class_pattern = r'([AB]/[AB]|[AB]-[AB])'
        
        # Kompiluj regex'y dla wydajności
        self.compiled_dimension_patterns = [re.compile(pattern, re.IGNORECASE) for pattern in self.dimension_patterns]
        self.compiled_class_pattern = re.compile(self.class_pattern)
    
    def parse_product_name(self, product_name: str) -> Dict[str, any]:
        """
        Parsuje nazwę produktu i wyciąga wszystkie możliwe informacje
        
        Args:
            product_name (str): Nazwa produktu z Baselinker
            
        Returns:
            Dict[str, any]: Słownik z wyciągniętymi informacjami
        """
        if not product_name:
            return self._empty_result()
        
        name_lower = product_name.lower()
        result = {
            'product_type': None,      # klejonka/deska
            'wood_species': None,      # dąb/jesion/buk
            'technology': None,        # lity/mikrowczep
            'wood_class': None,        # A/B, B/B
            'finish_state': 'surowy',  # domyślnie surowy
            'length_cm': None,
            'width_cm': None,
            'thickness_cm': None,
            'volume_per_piece': None,  # w m3
            'parsed_successfully': False,
            'raw_name': product_name
        }
        
        try:
            # 1. Wyciągnij typ produktu
            result['product_type'] = self._extract_product_type(name_lower)
            
            # 2. Wyciągnij gatunek drewna
            result['wood_species'] = self._extract_wood_species(name_lower)
            
            # 3. Wyciągnij technologię
            result['technology'] = self._extract_technology(name_lower)
            
            # 4. Wyciągnij klasę drewna
            result['wood_class'] = self._extract_wood_class(product_name)
            
            # 5. Wyciągnij wykończenie
            result['finish_state'] = self._extract_finish_state(name_lower)
            
            # 6. Wyciągnij wymiary
            dimensions = self._extract_dimensions(product_name)
            if dimensions:
                result['length_cm'] = dimensions[0]
                result['width_cm'] = dimensions[1] 
                result['thickness_cm'] = dimensions[2]
                result['volume_per_piece'] = self._calculate_volume(dimensions)
            
            # Sprawdź czy parsowanie było udane
            result['parsed_successfully'] = self._is_parsing_successful(result)
            
        except Exception as e:
            print(f"[ProductNameParser] Błąd parsowania '{product_name}': {e}")
            result['parsed_successfully'] = False
        
        return result
    
    def _extract_product_type(self, name_lower: str) -> Optional[str]:
        """
        POPRAWKA: Wyciąga typ produktu - domyślnie klejonka, chyba że znajdzie słowo wskazujące na deskę
        """
        # Sprawdź czy nazwa zawiera słowa wskazujące na deskę
        for key, value in self.PRODUCT_TYPE_MAP.items():
            if key in name_lower:
                return value
        
        # POPRAWKA: Jeśli nie znaleziono żadnego słowa kluczowego, domyślnie zwróć 'klejonka'
        return 'klejonka'
    
    def _extract_wood_species(self, name_lower: str) -> Optional[str]:
        """Wyciąga gatunek drewna"""
        for key, value in self.WOOD_SPECIES_MAP.items():
            if key in name_lower:
                return value
        return None
    
    def _extract_technology(self, name_lower: str) -> Optional[str]:
        """Wyciąga technologię"""
        for key, value in self.TECHNOLOGY_MAP.items():
            if key in name_lower:
                return value
        return None
    
    def _extract_wood_class(self, product_name: str) -> Optional[str]:
        """Wyciąga klasę drewna (A/B, B/B)"""
        match = self.compiled_class_pattern.search(product_name)
        if match:
            wood_class = match.group(1)
            # Normalizuj format (A-B -> A/B)
            return wood_class.replace('-', '/')
        return None
    
    def _extract_finish_state(self, name_lower: str) -> str:
        """Wyciąga stan wykończenia"""
        for key, value in self.FINISH_MAP.items():
            if key in name_lower:
                return value
        return 'surowy'  # domyślnie surowy
    
    def _extract_dimensions(self, product_name: str) -> Optional[Tuple[Decimal, Decimal, Decimal]]:
        """Wyciąga wymiary (długość × szerokość × grubość)"""
        for pattern in self.compiled_dimension_patterns:
            match = pattern.search(product_name)
            if match:
                try:
                    length = Decimal(match.group(1))
                    width = Decimal(match.group(2))
                    thickness = Decimal(match.group(3))
                    return (length, width, thickness)
                except (ValueError, TypeError):
                    continue
        return None
    
    def _calculate_volume(self, dimensions: Tuple[Decimal, Decimal, Decimal]) -> Decimal:
        """Oblicza objętość w m3"""
        length_cm, width_cm, thickness_cm = dimensions
        # Konwersja z cm3 na m3 (dzielimy przez 1,000,000)
        volume_cm3 = length_cm * width_cm * thickness_cm
        volume_m3 = volume_cm3 / 1000000
        return volume_m3.quantize(Decimal('0.0001'))  # Zaokrąglenie do 4 miejsc po przecinku
    
    def _is_parsing_successful(self, result: Dict) -> bool:
        """Sprawdza czy parsowanie było udane"""
        # Minimalne wymagania: wymiary + gatunek lub typ produktu
        has_dimensions = all([
            result['length_cm'] is not None,
            result['width_cm'] is not None, 
            result['thickness_cm'] is not None
        ])
        
        has_basic_info = result['wood_species'] is not None or result['product_type'] is not None
        
        return has_dimensions and has_basic_info
    
    def _empty_result(self) -> Dict[str, any]:
        """Zwraca pusty wynik - POPRAWKA: domyślnie klejonka"""
        return {
            'product_type': 'klejonka',  # POPRAWKA: domyślnie klejonka
            'wood_species': None,
            'technology': None,
            'wood_class': None,
            'finish_state': 'surowy',
            'length_cm': None,
            'width_cm': None,
            'thickness_cm': None,
            'volume_per_piece': None,
            'parsed_successfully': False,
            'raw_name': ''
        }


# ===== FUNKCJE POMOCNICZE =====

def parse_single_product(product_name: str) -> Dict[str, any]:
    """
    Funkcja pomocnicza do parsowania pojedynczej nazwy produktu
    
    Args:
        product_name (str): Nazwa produktu
        
    Returns:
        Dict[str, any]: Wynik parsowania
    """
    parser = ProductNameParser()
    return parser.parse_product_name(product_name)


def test_parser():
    """
    Funkcja testowa parsera
    """
    parser = ProductNameParser()
    
    test_names = [
        "Klejonka bukowa mikrowczep A/B 98.0×40.0×2.0cm",
        "Klejonka bukowa mikrowczep A/B 100.0×20.0×2.0cm", 
        "Parapet 160x20x2 cm dębowy lity B/B surowy",
        "Blat drewniany dębowy mikrowczep A/B 90x60x2 cm surowy",
        "Blat 200x60x4 cm dębowy mikrowczep A/B surowy",
        "Blat dębowy 120x70x3 cm mikrowczep A/B lakierowany bezbarwny",
        "Spocznik dąb lity A/B 190x88x3 cm lakierowany",
        "Dąb lity A/B olejowany 80x30x7 cm olejowany",
        "Schody trep stopień drewniany dębowy mikrowczep B/B 120x35x4 cm surowy",
        "Bukowa mikrowczep A/B 120x30x2 cm surowy",  # TEST: bez słowa "klejonka" - powinno być klejonka
        "Produkty dębowe 100x50x3 cm"  # TEST: bez słowa kluczowego - powinno być klejonka
    ]
    
    print("🔍 TEST PARSERA NAZW PRODUKTÓW - POPRAWKA")
    print("=" * 80)
    
    for name in test_names:
        result = parser.parse_product_name(name)
        print(f"\n📦 PRODUKT: {name}")
        print(f"   ✅ Sukces: {result['parsed_successfully']}")
        print(f"   🏷️  Typ: {result['product_type']}")
        print(f"   🌳 Gatunek: {result['wood_species']}")
        print(f"   ⚙️  Technologia: {result['technology']}")
        print(f"   📊 Klasa: {result['wood_class']}")
        print(f"   🎨 Wykończenie: {result['finish_state']}")
        print(f"   📏 Wymiary: {result['length_cm']}×{result['width_cm']}×{result['thickness_cm']} cm")
        print(f"   📦 Objętość: {result['volume_per_piece']} m³")


if __name__ == "__main__":
    # Uruchom test parsera
    test_parser()