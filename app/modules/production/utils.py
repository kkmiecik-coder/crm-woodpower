# modules/production/utils.py
"""
Funkcje pomocnicze dla modułu Production
"""

import re
from typing import Dict, List, Optional, Tuple
from datetime import datetime, date
from decimal import Decimal
from modules.logging import get_structured_logger

# Inicjalizacja loggera
production_logger = get_structured_logger('production.utils')
production_logger.info("✅ production_logger zainicjowany poprawnie w utils.py")


# modules/production/utils.py
"""
Funkcje pomocnicze dla modułu Production
"""

import re
from typing import Dict, List, Optional, Tuple
from datetime import datetime, date, timedelta
from decimal import Decimal
from modules.logging import get_structured_logger

# Import parsera z modułu Reports
try:
    from modules.reports.parser import ProductNameParser as ReportsProductNameParser
    REPORTS_PARSER_AVAILABLE = True
except ImportError:
    REPORTS_PARSER_AVAILABLE = False
    production_logger = get_structured_logger('production.utils')
    production_logger.warning("Nie można zaimportować ProductNameParser z modułu Reports")

# Inicjalizacja loggera
production_logger = get_structured_logger('production.utils')
production_logger.info("✅ production_logger zainicjowany poprawnie w utils.py")


class ProductionNameParser:
    """
    Wrapper na ProductNameParser z modułu Reports
    Dostosowany do potrzeb modułu produkcyjnego
    """
    
    def __init__(self):
        self.logger = get_structured_logger('production.parser')
        
        if REPORTS_PARSER_AVAILABLE:
            self.reports_parser = ReportsProductNameParser()
            self.logger.info("Używam ProductNameParser z modułu Reports")
        else:
            self.reports_parser = None
            self.logger.warning("ProductNameParser z Reports niedostępny - używam fallback")
            self._init_fallback_patterns()
    
    def _init_fallback_patterns(self):
        """Inicjalizuje podstawowe wzorce jeśli parser z Reports nie jest dostępny"""
        # Podstawowe wzorce jako fallback
        self.wood_species_patterns = {
            'dąb': ['dębowa', 'dąb', 'dab'],
            'buk': ['bukowa', 'buk'],
            'jesion': ['jesionowa', 'jesion'],
            'sosna': ['sosnowa', 'sosna'],
            'brzoza': ['brzozowa', 'brzoza']
        }
        
        self.technology_patterns = {
            'lita': ['lita', 'lite', 'lity'],
            'mikrowczep': ['mikrowczep', 'klejonka']
        }
        
        self.class_patterns = {
            'A/A': ['A/A', 'AA'],
            'A/B': ['A/B', 'AB'], 
            'B/B': ['B/B', 'BB'],
            'Rustic': ['rustic', 'rustik']
        }
        
        self.finish_patterns = {
            'surowa': ['surowa', 'surowe', 'surowy'],
            'olejowana': ['olejowana', 'olejowane', 'olejowany'],
            'bejcowana': ['bejcowana', 'bejcowane', 'bejcowany']
        }
        
        # Wzorzec wymiarów - bardziej elastyczny
        self.dimensions_pattern = re.compile(
            r'(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)(?:\s*cm)?',
            re.IGNORECASE
        )
    
    def parse_product_name(self, product_name: str) -> Dict:
        """
        Parsuje nazwę produktu używając parsera z Reports lub fallback
        
        Args:
            product_name: Nazwa produktu do parsowania
            
        Returns:
            Dict: Słownik z parsowanymi parametrami
        """
        if not product_name:
            return {}
        
        try:
            if self.reports_parser:
                # Użyj parsera z modułu Reports
                result = self._parse_with_reports_parser(product_name)
            else:
                # Użyj fallback parsera
                result = self._parse_with_fallback(product_name)
            
            self.logger.debug("Sparsowano nazwę produktu",
                            product_name=product_name[:100], 
                            parsed_result=result,
                            parser_type="reports" if self.reports_parser else "fallback")
            
            return result
            
        except Exception as e:
            self.logger.error("Błąd podczas parsowania nazwy produktu",
                            product_name=product_name, error=str(e))
            return {}
    
    def _parse_with_reports_parser(self, product_name: str) -> Dict:
        """Parsuje używając parsera z modułu Reports"""
        # Sprawdź jakie metody ma parser z Reports
        if hasattr(self.reports_parser, 'parse_product_name'):
            # Jeśli ma metodę parse_product_name, użyj jej
            reports_result = self.reports_parser.parse_product_name(product_name)
        elif hasattr(self.reports_parser, 'parse'):
            # Jeśli ma metodę parse, użyj jej
            reports_result = self.reports_parser.parse(product_name)
        else:
            # Fallback na parsowanie ręczne
            self.logger.warning("Parser z Reports nie ma znanej metody parsowania")
            return self._parse_with_fallback(product_name)
        
        # Mapuj wyniki z Reports na format Production
        result = {
            'wood_species': None,
            'wood_technology': None,
            'wood_class': None,
            'finish_type': None,
            'dimensions_length': None,
            'dimensions_width': None,
            'dimensions_thickness': None
        }
        
        if isinstance(reports_result, dict):
            # Mapuj pola (dostosuj nazwy pól do tego co zwraca parser z Reports)
            result['wood_species'] = reports_result.get('wood_species')
            result['wood_technology'] = reports_result.get('technology')  # Reports: technology -> Production: wood_technology
            result['wood_class'] = reports_result.get('wood_class')
            result['finish_type'] = reports_result.get('finish_state')  # Reports: finish_state -> Production: finish_type
            
            # Wymiary
            result['dimensions_length'] = reports_result.get('length_cm')
            result['dimensions_width'] = reports_result.get('width_cm') 
            result['dimensions_thickness'] = reports_result.get('thickness_cm')
            
            # Konwertuj wymiary na float jeśli są Decimal
            for dim in ['dimensions_length', 'dimensions_width', 'dimensions_thickness']:
                if result[dim] is not None:
                    try:
                        result[dim] = float(result[dim])
                    except (ValueError, TypeError):
                        result[dim] = None
        
        return result
    
    def _parse_with_fallback(self, product_name: str) -> Dict:
        """Parsuje używając prostego parsera fallback"""
        name_lower = product_name.lower()
        
        result = {
            'wood_species': self._extract_wood_species(name_lower),
            'wood_technology': self._extract_technology(name_lower),
            'wood_class': self._extract_class(name_lower),
            'finish_type': self._extract_finish(name_lower),
            'dimensions_length': None,
            'dimensions_width': None,
            'dimensions_thickness': None
        }
        
        # Parsuj wymiary
        dimensions = self._extract_dimensions(product_name)
        if dimensions:
            result.update(dimensions)
        
        return result
    
    def _extract_wood_species(self, name_lower: str) -> Optional[str]:
        """Wyciąga gatunek drewna z nazwy"""
        for species, patterns in self.wood_species_patterns.items():
            for pattern in patterns:
                if pattern.lower() in name_lower:
                    return species
        return None
    
    def _extract_technology(self, name_lower: str) -> Optional[str]:
        """Wyciąga technologię z nazwy"""
        for technology, patterns in self.technology_patterns.items():
            for pattern in patterns:
                if pattern.lower() in name_lower:
                    return technology
        return None
    
    def _extract_class(self, name_lower: str) -> Optional[str]:
        """Wyciąga klasę drewna z nazwy"""
        for wood_class, patterns in self.class_patterns.items():
            for pattern in patterns:
                if pattern.lower() in name_lower:
                    return wood_class
        return None
    
    def _extract_finish(self, name_lower: str) -> Optional[str]:
        """Wyciąga typ wykończenia z nazwy"""
        for finish, patterns in self.finish_patterns.items():
            for pattern in patterns:
                if pattern.lower() in name_lower:
                    return finish
        return None
    
    def _extract_dimensions(self, product_name: str) -> Dict:
        """Wyciąga wymiary z nazwy produktu"""
        match = self.dimensions_pattern.search(product_name)
        
        if match:
            try:
                length = float(match.group(1))
                width = float(match.group(2))
                thickness = float(match.group(3))
                
                return {
                    'dimensions_length': length,
                    'dimensions_width': width,
                    'dimensions_thickness': thickness
                }
            except ValueError:
                self.logger.warning("Nie można przekonwertować wymiarów na liczby",
                                  dimensions_match=match.groups())
        
        return {}


class ProductionPriorityCalculator:
    """
    Kalkulator priorytetów dla produktów w produkcji
    """
    
    def __init__(self):
        self.logger = get_structured_logger('production.priority')
        
        # Wagi dla różnych kryteriów (zgodnie z planem: deadline > gatunek > technologia > klasa > wielkość)
        self.deadline_weight = 1000  # Najważniejsze
        self.species_weight = 100
        self.technology_weight = 50
        self.class_weight = 25
        self.order_size_weight = 10
        
        # Wartości dla gatunków drewna (w kolejności priorytetów)
        self.species_values = {
            'dąb': 100,      # Najwyższy priorytet
            'jesion': 80,
            'buk': 60,
            'sosna': 40,
            'brzoza': 20
        }
        
        # Wartości dla technologii
        self.technology_values = {
            'lita': 100,     # Wyższy priorytet
            'mikrowczep': 50
        }
        
        # Wartości dla klas drewna
        self.class_values = {
            'A/A': 100,
            'A/B': 80,
            'B/B': 60,
            'Rustic': 40
        }
    
    def calculate_priority(self, wood_species: str = None, wood_technology: str = None, 
                          wood_class: str = None, deadline_date: date = None, 
                          order_size: int = 1) -> Dict:
        """
        Oblicza priorytet produktu na podstawie różnych kryteriów
        
        Args:
            wood_species: Gatunek drewna
            wood_technology: Technologia
            wood_class: Klasa drewna
            deadline_date: Data realizacji
            order_size: Wielkość zamówienia
            
        Returns:
            Dict: Wynik priorytetu i grupa
        """
        try:
            priority_score = 0
            
            # 1. DEADLINE (najważniejsze)
            if deadline_date:
                days_to_deadline = (deadline_date - date.today()).days
                # Im bliżej deadline, tym wyższy priorytet
                if days_to_deadline <= 0:
                    deadline_score = self.deadline_weight * 2  # Przekroczony deadline
                elif days_to_deadline <= 3:
                    deadline_score = self.deadline_weight * 1.5  # Bardzo pilne
                elif days_to_deadline <= 7:
                    deadline_score = self.deadline_weight * 1.2  # Pilne
                else:
                    deadline_score = max(0, self.deadline_weight - (days_to_deadline * 10))
                
                priority_score += deadline_score
            
            # 2. GATUNEK DREWNA
            species_score = self.species_values.get(wood_species, 0) * self.species_weight / 100
            priority_score += species_score
            
            # 3. TECHNOLOGIA
            technology_score = self.technology_values.get(wood_technology, 0) * self.technology_weight / 100
            priority_score += technology_score
            
            # 4. KLASA DREWNA
            class_score = self.class_values.get(wood_class, 0) * self.class_weight / 100
            priority_score += class_score
            
            # 5. WIELKOŚĆ ZAMÓWIENIA (małe zamówienia mają wyższy priorytet)
            if order_size == 1:
                size_score = self.order_size_weight  # Pojedyncze produkty
            elif order_size <= 3:
                size_score = self.order_size_weight * 0.8  # Małe zamówienia
            elif order_size <= 5:
                size_score = self.order_size_weight * 0.6  # Średnie zamówienia
            else:
                size_score = self.order_size_weight * 0.4  # Duże zamówienia
            
            priority_score += size_score
            
            # Grupa priorytetowa do grupowania podobnych produktów
            priority_group = self._create_priority_group(
                wood_species, wood_technology, wood_class, deadline_date
            )
            
            result = {
                'priority_score': int(priority_score),
                'priority_group': priority_group
            }
            
            self.logger.debug("Obliczono priorytet produktu",
                            wood_species=wood_species, wood_technology=wood_technology,
                            wood_class=wood_class, deadline_date=deadline_date.isoformat() if deadline_date else None,
                            order_size=order_size, result=result)
            
            return result
            
        except Exception as e:
            self.logger.error("Błąd podczas obliczania priorytetu",
                            wood_species=wood_species, error=str(e))
            return {
                'priority_score': 0,
                'priority_group': 'unknown'
            }
    
    def _create_priority_group(self, wood_species: str = None, wood_technology: str = None,
                              wood_class: str = None, deadline_date: date = None) -> str:
        """
        Tworzy grupę priorytetową dla grupowania podobnych produktów
        
        Returns:
            str: Nazwa grupy priorytetowej
        """
        parts = []
        
        if wood_species:
            parts.append(wood_species)
        else:
            parts.append('unknown_species')
        
        if wood_technology:
            parts.append(wood_technology)
        else:
            parts.append('unknown_tech')
        
        if wood_class:
            parts.append(wood_class.replace('/', ''))  # A/B -> AB
        else:
            parts.append('unknown_class')
        
        if deadline_date:
            parts.append(deadline_date.strftime('%Y-%m-%d'))
        else:
            parts.append('no_deadline')
        
        return '_'.join(parts)
    
    def get_priority_explanation(self, wood_species: str = None, wood_technology: str = None,
                                wood_class: str = None, deadline_date: date = None,
                                order_size: int = 1) -> Dict:
        """
        Zwraca szczegółowe wyjaśnienie jak został obliczony priorytet
        
        Returns:
            Dict: Szczegółowe wyjaśnienie priorytetu
        """
        explanation = {
            'deadline': {'score': 0, 'reason': 'Brak deadline'},
            'species': {'score': 0, 'reason': f'Gatunek: {wood_species or "nieznany"}'},
            'technology': {'score': 0, 'reason': f'Technologia: {wood_technology or "nieznana"}'},
            'class': {'score': 0, 'reason': f'Klasa: {wood_class or "nieznana"}'},
            'order_size': {'score': 0, 'reason': f'Wielkość zamówienia: {order_size}'},
            'total_score': 0
        }
        
        try:
            # Oblicz każdy komponent osobno dla wyjaśnienia
            if deadline_date:
                days_to_deadline = (deadline_date - date.today()).days
                if days_to_deadline <= 0:
                    explanation['deadline']['score'] = self.deadline_weight * 2
                    explanation['deadline']['reason'] = f'PRZEKROCZONY DEADLINE! ({abs(days_to_deadline)} dni temu)'
                elif days_to_deadline <= 3:
                    explanation['deadline']['score'] = self.deadline_weight * 1.5
                    explanation['deadline']['reason'] = f'Bardzo pilne ({days_to_deadline} dni do deadline)'
                elif days_to_deadline <= 7:
                    explanation['deadline']['score'] = self.deadline_weight * 1.2
                    explanation['deadline']['reason'] = f'Pilne ({days_to_deadline} dni do deadline)'
                else:
                    explanation['deadline']['score'] = max(0, self.deadline_weight - (days_to_deadline * 10))
                    explanation['deadline']['reason'] = f'Standardowy ({days_to_deadline} dni do deadline)'
            
            # Pozostałe komponenty...
            explanation['species']['score'] = self.species_values.get(wood_species, 0) * self.species_weight / 100
            explanation['technology']['score'] = self.technology_values.get(wood_technology, 0) * self.technology_weight / 100
            explanation['class']['score'] = self.class_values.get(wood_class, 0) * self.class_weight / 100
            
            if order_size == 1:
                explanation['order_size']['score'] = self.order_size_weight
                explanation['order_size']['reason'] += ' (pojedynczy produkt - wysoki priorytet)'
            elif order_size <= 3:
                explanation['order_size']['score'] = self.order_size_weight * 0.8
                explanation['order_size']['reason'] += ' (małe zamówienie)'
            elif order_size <= 5:
                explanation['order_size']['score'] = self.order_size_weight * 0.6
                explanation['order_size']['reason'] += ' (średnie zamówienie)'
            else:
                explanation['order_size']['score'] = self.order_size_weight * 0.4
                explanation['order_size']['reason'] += ' (duże zamówienie - niższy priorytet)'
            
            # Suma
            explanation['total_score'] = sum(comp['score'] for comp in explanation.values() if isinstance(comp, dict) and 'score' in comp)
            
            return explanation
            
        except Exception as e:
            self.logger.error("Błąd podczas tworzenia wyjaśnienia priorytetu", error=str(e))
            return explanation


class ProductionStatsCalculator:
    """
    Kalkulator statystyk dla modułu produkcji
    """
    
    def __init__(self):
        self.logger = get_structured_logger('production.stats')
    
    def calculate_worker_stats(self, worker_id: int, date_from: date = None, date_to: date = None) -> Dict:
        """
        Oblicza statystyki pracownika
        
        Args:
            worker_id: ID pracownika
            date_from: Data od
            date_to: Data do
            
        Returns:
            Dict: Statystyki pracownika
        """
        try:
            from .models import ProductionItem, ProductionStatus
            
            # Domyślnie ostatnie 30 dni
            if not date_from:
                date_from = date.today() - timedelta(days=30)
            if not date_to:
                date_to = date.today()
            
            # Produkty sklejone przez pracownika w okresie
            completed_items = ProductionItem.query.join(ProductionStatus).filter(
                ProductionItem.glued_by_worker_id == worker_id,
                ProductionStatus.name == 'completed',
                ProductionItem.gluing_completed_at >= date_from,
                ProductionItem.gluing_completed_at <= date_to
            ).all()
            
            if not completed_items:
                return {
                    'worker_id': worker_id,
                    'period': {'from': date_from.isoformat(), 'to': date_to.isoformat()},
                    'completed_items_count': 0,
                    'average_time_seconds': 0,
                    'total_time_seconds': 0,
                    'overtime_items_count': 0,
                    'efficiency_percentage': 0
                }
            
            # Oblicz statystyki
            total_time = sum(item.gluing_duration_seconds or 0 for item in completed_items)
            average_time = total_time / len(completed_items) if completed_items else 0
            overtime_items = [item for item in completed_items if item.gluing_overtime_seconds and item.gluing_overtime_seconds > 0]
            
            # Wydajność względem standardu (20 minut = 1200 sekund)
            standard_time = 1200  # 20 minut
            efficiency = (standard_time / average_time * 100) if average_time > 0 else 0
            
            stats = {
                'worker_id': worker_id,
                'period': {'from': date_from.isoformat(), 'to': date_to.isoformat()},
                'completed_items_count': len(completed_items),
                'average_time_seconds': int(average_time),
                'total_time_seconds': total_time,
                'overtime_items_count': len(overtime_items),
                'efficiency_percentage': round(efficiency, 1)
            }
            
            self.logger.debug("Obliczono statystyki pracownika", worker_id=worker_id, stats=stats)
            
            return stats
            
        except Exception as e:
            self.logger.error("Błąd podczas obliczania statystyk pracownika",
                            worker_id=worker_id, error=str(e))
            return {}
    
    def calculate_station_stats(self, station_id: int, date_from: date = None, date_to: date = None) -> Dict:
        """
        Oblicza statystyki stanowiska
        
        Args:
            station_id: ID stanowiska
            date_from: Data od
            date_to: Data do
            
        Returns:
            Dict: Statystyki stanowiska
        """
        try:
            from .models import ProductionItem, ProductionStatus
            
            # Domyślnie ostatnie 30 dni
            if not date_from:
                date_from = date.today() - timedelta(days=30)
            if not date_to:
                date_to = date.today()
            
            # Produkty sklejone na stanowisku w okresie
            completed_items = ProductionItem.query.join(ProductionStatus).filter(
                ProductionItem.glued_at_station_id == station_id,
                ProductionStatus.name == 'completed',
                ProductionItem.gluing_completed_at >= date_from,
                ProductionItem.gluing_completed_at <= date_to
            ).all()
            
            if not completed_items:
                return {
                    'station_id': station_id,
                    'period': {'from': date_from.isoformat(), 'to': date_to.isoformat()},
                    'completed_items_count': 0,
                    'total_usage_hours': 0,
                    'average_items_per_day': 0,
                    'utilization_percentage': 0
                }
            
            # Oblicz statystyki
            total_time_seconds = sum(item.gluing_duration_seconds or 0 for item in completed_items)
            total_usage_hours = total_time_seconds / 3600  # Konwersja na godziny
            
            # Średnia produktów na dzień
            period_days = (date_to - date_from).days + 1
            average_items_per_day = len(completed_items) / period_days if period_days > 0 else 0
            
            # Wykorzystanie stanowiska (zakładając 8h pracy dziennie)
            max_working_hours = period_days * 8
            utilization = (total_usage_hours / max_working_hours * 100) if max_working_hours > 0 else 0
            
            stats = {
                'station_id': station_id,
                'period': {'from': date_from.isoformat(), 'to': date_to.isoformat()},
                'completed_items_count': len(completed_items),
                'total_usage_hours': round(total_usage_hours, 2),
                'average_items_per_day': round(average_items_per_day, 1),
                'utilization_percentage': round(utilization, 1)
            }
            
            self.logger.debug("Obliczono statystyki stanowiska", station_id=station_id, stats=stats)
            
            return stats
            
        except Exception as e:
            self.logger.error("Błąd podczas obliczania statystyk stanowiska",
                            station_id=station_id, error=str(e))
            return {}