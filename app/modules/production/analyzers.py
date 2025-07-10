import re
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

class ProductAnalyzer:
    """Analizator nazw produktów z różnych źródeł (Allegro, Sklep, CRM)"""
    
    # Mapowanie gatunków drewna
    WOOD_SPECIES_MAPPING = {
        'dąb': ['dąb', 'dab', 'oak', 'dębowy', 'dębowa', 'dąbowy', 'dąbowa'],
        'jesion': ['jesion', 'jesionowy', 'jesionowa', 'ash'],
        'buk': ['buk', 'bukowy', 'bukowa', 'beech']
    }
    
    # Mapowanie technologii
    TECHNOLOGY_MAPPING = {
        'lity': ['lity', 'lite', 'solid', 'pełny', 'pełna'],
        'mikrowczep': ['mikrowczep', 'mikro-wczep', 'fingerjoint', 'fj', 'klejonka']
    }
    
    # Mapowanie klas drewna
    CLASS_MAPPING = {
        'A/B': ['a/b', 'ab', 'a-b', 'klasa ab', 'klasa a/b'],
        'B/B': ['b/b', 'bb', 'b-b', 'klasa bb', 'klasa b/b']
    }
    
    # Mapowanie wykończeń
    COATING_MAPPING = {
        'lakier': ['lakier', 'lakierowany', 'lakierowana', 'lacquer', 'varnish'],
        'olej': ['olej', 'olejowany', 'olejowana', 'oil', 'oiled'],
        'wosk': ['wosk', 'woskowany', 'woskowana', 'wax', 'waxed']
    }
    
    # Mapowanie kolorów
    COLOR_MAPPING = {
        'bezbarwny': ['bezbarwny', 'bezbarwna', 'transparent', 'clear', 'naturalny', 'naturalna'],
        'biały': ['biały', 'biała', 'white', 'biel'],
        'czarny': ['czarny', 'czarna', 'black', 'czerń'],
        'brązowy': ['brązowy', 'brązowa', 'brown'],
        'szary': ['szary', 'szara', 'grey', 'gray']
    }
    
    # Mapowanie typów produktów
    PRODUCT_TYPE_MAPPING = {
        'blat': ['blat', 'blaty', 'countertop', 'worktop'],
        'parapet': ['parapet', 'parapety', 'windowsill'],
        'stopień': ['stopień', 'stopnie', 'schody', 'step', 'stairs'],
        'deska': ['deska', 'deski', 'board', 'plank']
    }
    
    @staticmethod
    def analyze_product_name_and_comments(product_name: str, comments: str = '') -> Dict:
        """
        Główna metoda analizująca nazwę produktu i komentarze
        
        Args:
            product_name: Nazwa produktu z Baselinker
            comments: Komentarze do zamówienia
            
        Returns:
            Dict z rozpoznanymi właściwościami produktu
        """
        try:
            # Normalizuj tekst do analizy
            text_to_analyze = f"{product_name} {comments}".lower().strip()
            
            result = {
                'original_name': product_name,
                'wood_species': ProductAnalyzer.extract_wood_species_from_name(text_to_analyze),
                'technology': ProductAnalyzer.extract_technology_from_name(text_to_analyze),
                'wood_class': ProductAnalyzer.extract_wood_class_from_name(text_to_analyze),
                'dimensions': ProductAnalyzer.extract_dimensions_from_text(text_to_analyze),
                'product_type': ProductAnalyzer.extract_product_type_from_name(text_to_analyze),
                'needs_coating': False,
                'coating_type': None,
                'coating_color': None,
                'coating_gloss': None,
                'coating_notes': None
            }
            
            # Analizuj wykończenie
            coating_info = ProductAnalyzer.detect_coating_from_name(text_to_analyze)
            result.update(coating_info)
            
            # Walidacja wyników
            ProductAnalyzer._validate_analysis_result(result)
            
            logger.info(f"Przeanalizowano produkt: {product_name[:50]}... -> {result['wood_species']}-{result['technology']}")
            
            return result
            
        except Exception as e:
            logger.error(f"Błąd analizy produktu '{product_name}': {str(e)}")
            return ProductAnalyzer._get_default_analysis_result(product_name)
    
    @staticmethod
    def extract_wood_species_from_name(text: str) -> Optional[str]:
        """Wyciąga gatunek drewna z nazwy produktu"""
        text = text.lower()
        
        for species, keywords in ProductAnalyzer.WOOD_SPECIES_MAPPING.items():
            for keyword in keywords:
                if keyword in text:
                    return species
        
        # Fallback - spróbuj znaleźć wzorce
        if re.search(r'\bdąb\w*\b', text):
            return 'dąb'
        elif re.search(r'\bjesion\w*\b', text):
            return 'jesion'
        elif re.search(r'\bbuk\w*\b', text):
            return 'buk'
        
        logger.warning(f"Nie rozpoznano gatunku drewna w: {text[:100]}")
        return None
    
    @staticmethod
    def extract_technology_from_name(text: str) -> Optional[str]:
        """Wyciąga technologię (lity/mikrowczep) z nazwy"""
        text = text.lower()
        
        for technology, keywords in ProductAnalyzer.TECHNOLOGY_MAPPING.items():
            for keyword in keywords:
                if keyword in text:
                    return technology
        
        # Fallback - domyślnie mikrowczep (częściej używany)
        logger.warning(f"Nie rozpoznano technologii w: {text[:100]}, przyjęto mikrowczep")
        return 'mikrowczep'
    
    @staticmethod
    def extract_wood_class_from_name(text: str) -> Optional[str]:
        """Wyciąga klasę drewna z nazwy"""
        text = text.lower()
        
        for wood_class, keywords in ProductAnalyzer.CLASS_MAPPING.items():
            for keyword in keywords:
                if keyword in text:
                    return wood_class
        
        # Fallback - domyślnie A/B (wyższa klasa)
        return 'A/B'
    
    @staticmethod
    def extract_dimensions_from_text(text: str) -> str:
        """Wyciąga wymiary z tekstu (długość x szerokość x grubość)"""
        
        # Wzorce dla wymiarów
        patterns = [
            r'(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm',  # 180x70x3 cm
            r'(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)',        # 180x70x3
            r'(\d{2,3})\s*[x×]\s*(\d{2,3})\s*[x×]\s*(\d{1,2})',                          # 180x70x3 (bez przecinków)
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                length, width, thickness = match.groups()
                return f"{length}x{width}x{thickness} cm"
        
        # Spróbuj znaleźć oddzielne wymiary
        length_match = re.search(r'długość[:\s]*(\d+(?:\.\d+)?)', text)
        width_match = re.search(r'szerokość[:\s]*(\d+(?:\.\d+)?)', text)
        thickness_match = re.search(r'grubość[:\s]*(\d+(?:\.\d+)?)', text)
        
        if length_match and width_match and thickness_match:
            return f"{length_match.group(1)}x{width_match.group(1)}x{thickness_match.group(1)} cm"
        
        logger.warning(f"Nie rozpoznano wymiarów w: {text[:100]}")
        return ""
    
    @staticmethod
    def extract_product_type_from_name(text: str) -> Optional[str]:
        """Wyciąga typ produktu z nazwy"""
        text = text.lower()
        
        for product_type, keywords in ProductAnalyzer.PRODUCT_TYPE_MAPPING.items():
            for keyword in keywords:
                if keyword in text:
                    return product_type
        
        # Fallback - spróbuj na podstawie wymiarów
        if re.search(r'\d+\s*[x×]\s*\d+\s*[x×]\s*[23]\s*cm', text):
            return 'blat'  # Cienkie produkty to często blaty
        elif re.search(r'\d+\s*[x×]\s*[12]\d\s*[x×]\s*\d+', text):
            return 'parapet'  # Wąskie produkty to parapety
        
        return 'blat'  # Domyślnie blat
    
    @staticmethod
    def detect_coating_from_name(text: str) -> Dict:
        """Sprawdza czy produkt wymaga lakierowania/olejowania"""
        text = text.lower()
        
        result = {
            'needs_coating': False,
            'coating_type': None,
            'coating_color': None,
            'coating_gloss': None,
            'coating_notes': None
        }
        
        # Sprawdź czy jest surowy (bez wykończenia)
        if any(word in text for word in ['surowy', 'surowa', 'raw', 'unfinished']):
            return result
        
        # Sprawdź typ wykończenia
        for coating_type, keywords in ProductAnalyzer.COATING_MAPPING.items():
            for keyword in keywords:
                if keyword in text:
                    result['needs_coating'] = True
                    result['coating_type'] = coating_type
                    break
            if result['coating_type']:
                break
        
        # Jeśli znaleziono wykończenie, sprawdź kolor
        if result['needs_coating']:
            result['coating_color'] = ProductAnalyzer._extract_coating_color(text)
            result['coating_gloss'] = ProductAnalyzer._extract_coating_gloss(text)
            result['coating_notes'] = ProductAnalyzer._extract_coating_notes(text)
        
        return result
    
    @staticmethod
    def _extract_coating_color(text: str) -> Optional[str]:
        """Wyciąga kolor wykończenia"""
        for color, keywords in ProductAnalyzer.COLOR_MAPPING.items():
            for keyword in keywords:
                if keyword in text:
                    return color
        
        # Szukaj specyficznych kolorów w komentarzach
        color_pattern = r'(?:kolor|color)[:\s]*([a-ząćęłńóśźż\-\s]+?)(?:\s|$|\.)'
        match = re.search(color_pattern, text)
        if match:
            return match.group(1).strip()
        
        return 'bezbarwny'  # Domyślnie bezbarwny
    
    @staticmethod
    def _extract_coating_gloss(text: str) -> Optional[str]:
        """Wyciąga stopień połysku"""
        if any(word in text for word in ['mat', 'matowy', 'matowa', 'matte']):
            return 'mat'
        elif any(word in text for word in ['półmat', 'pólmat', 'semi-matte', 'satin']):
            return 'półmat'
        elif any(word in text for word in ['połysk', 'polysk', 'gloss', 'glossy', 'błyszczący']):
            return 'połysk'
        
        return 'półmat'  # Domyślnie półmat
    
    @staticmethod
    def _extract_coating_notes(text: str) -> Optional[str]:
        """Wyciąga dodatkowe uwagi o wykończeniu"""
        # Szukaj kodów kolorów lub specjalnych instrukcji
        notes = []
        
        # Kody kolorów (np. BN-125/09)
        color_code_pattern = r'\b[A-Z]{1,3}-?\d{2,4}/?[A-Z]?\d*\b'
        color_codes = re.findall(color_code_pattern, text)
        if color_codes:
            notes.extend([f"Kod koloru: {code}" for code in color_codes])
        
        # Uwagi w nawiasach
        bracket_pattern = r'\(([^)]+)\)'
        bracket_matches = re.findall(bracket_pattern, text)
        for match in bracket_matches:
            if any(word in match.lower() for word in ['lakier', 'olej', 'kolor', 'color']):
                notes.append(match)
        
        return '; '.join(notes) if notes else None
    
    @staticmethod
    def determine_workflow_for_product(product_info: Dict) -> Dict:
        """Określa ścieżkę produkcji dla produktu"""
        try:
            wood_species = product_info.get('wood_species', 'dąb')
            technology = product_info.get('technology', 'mikrowczep')
            needs_coating = product_info.get('needs_coating', False)
            
            # Podstawowy workflow dla wszystkich produktów
            base_sequence = [1, 2, 3, 4]  # Cięcie, Sklejanie, Docinanie, Wykończenie
            
            # Dodaj lakierowanie/olejowanie jeśli potrzebne
            if needs_coating:
                base_sequence.append(5)  # Lakierowanie/Olejowanie
            
            # Zawsze pakowanie na końcu
            base_sequence.append(6)  # Pakowanie
            
            # Szacowane czasy wykonania (w minutach)
            estimated_times = {
                '1': 45,   # Cięcie drewna
                '2': 90,   # Sklejanie
                '3': 30,   # Docinanie
                '4': 60,   # Wykończenie
                '5': 120,  # Lakierowanie/Olejowanie (jeśli jest)
                '6': 15    # Pakowanie
            }
            
            # Dostosuj czasy dla różnych gatunków
            if wood_species == 'dąb':
                # Dąb jest twardy - dłuższe czasy
                estimated_times['1'] = 60  # Cięcie
                estimated_times['2'] = 120  # Sklejanie
                estimated_times['4'] = 90   # Wykończenie
            elif wood_species == 'buk':
                # Buk jest bardzo twardy
                estimated_times['1'] = 75
                estimated_times['2'] = 150
                estimated_times['4'] = 105
            
            # Dostosuj czasy dla technologii
            if technology == 'lity':
                # Lity wymaga więcej czasu na sklejanie
                estimated_times['2'] = int(estimated_times['2'] * 1.3)
            
            return {
                'workstation_sequence': base_sequence,
                'estimated_time_minutes': {str(k): v for k, v in estimated_times.items() if int(k) in base_sequence}
            }
            
        except Exception as e:
            logger.error(f"Błąd określania workflow: {str(e)}")
            # Fallback - podstawowy workflow surowy
            return {
                'workstation_sequence': [1, 2, 3, 4, 6],
                'estimated_time_minutes': {
                    '1': 45, '2': 90, '3': 30, '4': 60, '6': 15
                }
            }
    
    @staticmethod
    def _validate_analysis_result(result: Dict):
        """Waliduje wyniki analizy i uzupełnia brakujące dane"""
        
        # Gatunek drewna jest obowiązkowy
        if not result.get('wood_species'):
            result['wood_species'] = 'dąb'  # Domyślnie dąb
            logger.warning(f"Brak gatunku drewna, przyjęto dąb dla: {result.get('original_name', '')}")
        
        # Technologia jest obowiązkowa
        if not result.get('technology'):
            result['technology'] = 'mikrowczep'  # Domyślnie mikrowczep
        
        # Klasa drewna
        if not result.get('wood_class'):
            result['wood_class'] = 'A/B'  # Domyślnie A/B
        
        # Typ produktu
        if not result.get('product_type'):
            result['product_type'] = 'blat'  # Domyślnie blat
    
    @staticmethod
    def _get_default_analysis_result(product_name: str) -> Dict:
        """Zwraca domyślny wynik analizy w przypadku błędu"""
        return {
            'original_name': product_name,
            'wood_species': 'dąb',
            'technology': 'mikrowczep',
            'wood_class': 'A/B',
            'dimensions': '',
            'product_type': 'blat',
            'needs_coating': False,
            'coating_type': None,
            'coating_color': None,
            'coating_gloss': None,
            'coating_notes': None
        }
    
    @staticmethod
    def batch_analyze_products(products: List[Dict]) -> List[Dict]:
        """Analizuje wiele produktów naraz"""
        results = []
        
        for product in products:
            product_name = product.get('name', '')
            comments = product.get('comments', '')
            
            analysis = ProductAnalyzer.analyze_product_name_and_comments(product_name, comments)
            analysis['original_product'] = product
            
            results.append(analysis)
        
        return results
    
    @staticmethod
    def get_analysis_statistics(results: List[Dict]) -> Dict:
        """Zwraca statystyki analizy produktów"""
        if not results:
            return {}
        
        total = len(results)
        
        # Statystyki gatunków
        species_count = {}
        for result in results:
            species = result.get('wood_species')
            species_count[species] = species_count.get(species, 0) + 1
        
        # Statystyki technologii
        tech_count = {}
        for result in results:
            tech = result.get('technology')
            tech_count[tech] = tech_count.get(tech, 0) + 1
        
        # Statystyki wykończeń
        coating_count = sum(1 for r in results if r.get('needs_coating'))
        
        return {
            'total_products': total,
            'species_distribution': species_count,
            'technology_distribution': tech_count,
            'coating_percentage': round((coating_count / total) * 100, 1) if total > 0 else 0,
            'analysis_success_rate': round((sum(1 for r in results if r.get('wood_species')) / total) * 100, 1) if total > 0 else 0
        }