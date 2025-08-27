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
        Oblicza priorytet produktu - POPRAWIONA LOGIKA
        Im MNIEJSZY priority_score, tym WYŻSZY priorytet w kolejce (001, 002, 003...)
        """
        try:
            # Zaczynamy od 5000 i odejmujemy punkty za pilne sprawy
            priority_score = 5000
        
            # 1. DEADLINE - NAJWAŻNIEJSZE (duże odejmowanie za opóźnienia)
            if deadline_date:
                days_to_deadline = (deadline_date - date.today()).days
            
                if days_to_deadline <= -30:
                    # Bardzo stare opóźnienia (ponad miesiąc)
                    priority_score -= 4500
                elif days_to_deadline <= -14:
                    # Duże opóźnienia (2+ tygodnie)
                    priority_score -= 4000
                elif days_to_deadline <= -7:
                    # Tygodniowe opóźnienia
                    priority_score -= 3500
                elif days_to_deadline <= -1:
                    # Świeże opóźnienia (1-7 dni temu)
                    priority_score -= 3000
                elif days_to_deadline == 0:
                    # Dzisiaj deadline
                    priority_score -= 2500
                elif days_to_deadline <= 3:
                    # Za 1-3 dni deadline
                    priority_score -= 2000
                elif days_to_deadline <= 7:
                    # Za tydzień deadline
                    priority_score -= 1500
                elif days_to_deadline <= 14:
                    # Za 2 tygodnie
                    priority_score -= 1000
                else:
                    # Dalekie terminy - mniejszy priorytet
                    priority_score -= max(0, 500 - (days_to_deadline * 5))
            else:
                # Brak deadline = średni priorytet
                priority_score -= 500
        
            # 2. GATUNEK DREWNA - mniejsze znaczenie
            species_bonus = self.species_values.get(wood_species, 0)
            priority_score -= (species_bonus * 2)  # Zmniejszona waga
        
            # 3. TECHNOLOGIA - mniejsze znaczenie
            tech_bonus = self.technology_values.get(wood_technology, 0)
            priority_score -= tech_bonus
        
            # 4. KLASA DREWNA - małe znaczenie
            class_bonus = self.class_values.get(wood_class, 0)
            priority_score -= (class_bonus // 2)  # Jeszcze mniejsza waga
        
            # 5. WIELKOŚĆ ZAMÓWIENIA - bardzo małe znaczenie
            if order_size == 1:
                priority_score -= 50   # Małe zamówienia nieco wyższy priorytet
            elif order_size <= 3:
                priority_score -= 25
            # Większe zamówienia bez bonusu
        
            # Upewnij się, że wynik jest dodatni i w rozsądnym zakresie
            priority_score = max(1, min(priority_score, 9999))
        
            # Grupa priorytetowa na podstawie deadline
            if deadline_date:
                days_to_deadline = (deadline_date - date.today()).days
                if days_to_deadline <= -7:
                    priority_group = f'expired_critical_{abs(days_to_deadline)}d'
                elif days_to_deadline <= 0:
                    priority_group = f'expired_urgent_{abs(days_to_deadline)}d'
                elif days_to_deadline <= 7:
                    priority_group = f'upcoming_{days_to_deadline}d'
                else:
                    priority_group = f'future_{days_to_deadline}d'
            else:
                priority_group = 'no_deadline'
        
            result = {
                'priority_score': int(priority_score),
                'priority_group': priority_group
            }
        
            self.logger.debug("Obliczono priorytet - DEADLINE FIRST",
                            wood_species=wood_species, 
                            deadline_date=deadline_date.isoformat() if deadline_date else None,
                            days_to_deadline=days_to_deadline if deadline_date else None,
                            result=result)
        
            return result
        
        except Exception as e:
            self.logger.error("Błąd podczas obliczania priorytetu",
                            wood_species=wood_species, error=str(e))
            return {
                'priority_score': 8000,  # Średni priorytet przy błędzie
                'priority_group': 'error'
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
        
    def renumber_production_queue(self):
        """
        NOWA WERSJA: Przelicza priorytety według nowej logiki, a potem przenumerowuje
        """
        try:
            from .models import ProductionItem, ProductionStatus
            from extensions import db
        
            # Pobierz wszystkie produkty oczekujące
            pending_items = ProductionItem.query.join(ProductionStatus).filter(
                ProductionStatus.name == 'pending'
            ).all()
        
            updated_count = 0
        
            # KROK 1: Przelicz priorytety według NOWEJ LOGIKI
            for item in pending_items:
                # Pobierz wielkość zamówienia
                order_size = ProductionItem.query.filter_by(
                    baselinker_order_id=item.baselinker_order_id
                ).count()
            
                # UŻYJ NOWEJ LOGIKI calculate_priority
                priority_data = self.calculate_priority(
                    wood_species=item.wood_species,
                    wood_technology=item.wood_technology,
                    wood_class=item.wood_class,
                    deadline_date=item.deadline_date,
                    order_size=order_size
                )
            
                # Zapisz nowy priorytet
                old_score = item.priority_score
                item.priority_score = priority_data['priority_score']
                item.priority_group = priority_data['priority_group']
            
                if old_score != item.priority_score:
                    updated_count += 1
                    self.logger.debug("Zaktualizowano priorytet produktu",
                                    item_id=item.id, 
                                    old_score=old_score,
                                    new_score=item.priority_score,
                                    deadline=item.deadline_date.isoformat() if item.deadline_date else None)
        
            # KROK 2: Posortuj według nowych priorytetów (niższy score = wyższy priorytet)
            pending_items.sort(key=lambda x: (x.priority_score, x.created_at))
        
            # KROK 3: Przenumeruj pozycje 1, 2, 3, 4...
            for i, item in enumerate(pending_items, start=1):
                item.priority_score = i
        
            db.session.commit()
        
            self.logger.info("Przeliczono i przenumerowano kolejkę produkcyjną",
                           total_items=len(pending_items),
                           updated_count=updated_count)
        
            return {
                'total_items': len(pending_items),
                'renumbered': len(pending_items),  # Wszystkie zostały przenumerowane
                'updated_count': updated_count,    # Ile miało zmienione priorytety
                'success': True
            }
        
        except Exception as e:
            self.logger.error("Błąd podczas przeliczania kolejki", error=str(e))
            from extensions import db
            db.session.rollback()
            return {
                'error': str(e),
                'success': False
            }
    
    def reorder_item_to_position(self, item_id, new_position):
        """
        Przenosi produkt na nową pozycję w kolejce
        
        Args:
            item_id (int): ID produktu do przeniesienia
            new_position (int): Nowa pozycja (1 = najwyższy priorytet)
            
        Returns:
            dict: Rezultat operacji
        """
        try:
            from .models import ProductionItem, ProductionStatus
            from extensions import db
            
            # Pobierz produkt
            item = ProductionItem.query.get(item_id)
            if not item:
                raise ValueError(f"Produkt o ID {item_id} nie istnieje")
            
            # Sprawdź czy to produkt oczekujący
            if item.status.name != 'pending':
                raise ValueError(f"Można zmieniać pozycję tylko produktów oczekujących")
            
            old_position = item.priority_score
            
            # Pobierz wszystkie produkty oczekujące
            pending_items = ProductionItem.query.join(ProductionStatus).filter(
                ProductionStatus.name == 'pending'
            ).order_by(ProductionItem.priority_score.asc()).all()
            
            if new_position < 1 or new_position > len(pending_items):
                raise ValueError(f"Pozycja {new_position} jest poza zakresem 1-{len(pending_items)}")
            
            # Usuń produkt z obecnej pozycji
            pending_items.remove(item)
            
            # Wstaw na nową pozycję
            pending_items.insert(new_position - 1, item)
            
            # Przenumeruj wszystkie pozycje
            for i, pending_item in enumerate(pending_items, start=1):
                pending_item.priority_score = i
            
            db.session.commit()
            
            self.logger.info("Przeniesiono produkt w kolejce",
                           item_id=item_id,
                           old_position=old_position,
                           new_position=new_position)
            
            return {
                'success': True,
                'item_id': item_id,
                'old_position': old_position,
                'new_position': new_position,
                'total_items': len(pending_items)
            }
            
        except Exception as e:
            self.logger.error("Błąd podczas zmiany pozycji produktu",
                            item_id=item_id, new_position=new_position, error=str(e))
            from extensions import db
            db.session.rollback()
            raise
    
    def _get_queue_structure_summary(self):
        """Zwraca podsumowanie struktury kolejki (dla debugowania)"""
        try:
            from .models import ProductionItem, ProductionStatus
            
            pending_items = ProductionItem.query.join(ProductionStatus).filter(
                ProductionStatus.name == 'pending'
            ).order_by(ProductionItem.priority_score.asc()).all()
            
            return {
                'total_items': len(pending_items),
                'priority_range': {
                    'min': pending_items[0].priority_score if pending_items else None,
                    'max': pending_items[-1].priority_score if pending_items else None
                },
                'first_5_items': [
                    {
                        'id': item.id,
                        'position': item.priority_score,
                        'product_name': item.product_name[:50] + '...' if len(item.product_name) > 50 else item.product_name,
                        'deadline': item.deadline_date.isoformat() if item.deadline_date else None
                    } for item in pending_items[:5]
                ]
            }
            
        except Exception as e:
            self.logger.error("Błąd podczas pobierania struktury kolejki", error=str(e))
            return {'error': str(e)}


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

def calculate_packaging_priority(products):
    """
    Oblicza priorytet pakowania na podstawie listy produktów
    
    Args:
        products (list): Lista obiektów ProductionItem
        
    Returns:
        dict: {
            'priority': 'urgent'|'medium'|'normal',
            'deadline': date|None,
            'days_until_deadline': int|None,
            'reason': str
        }
    """
    try:
        if not products:
            return {
                'priority': 'normal',
                'deadline': None,
                'days_until_deadline': None,
                'reason': 'Brak produktów'
            }
        
        # Znajdź najwcześniejszy deadline
        deadlines = [p.deadline_date for p in products if p.deadline_date]
        
        if not deadlines:
            return {
                'priority': 'normal',
                'deadline': None,
                'days_until_deadline': None,
                'reason': 'Brak deadline'
            }
        
        earliest_deadline = min(deadlines)
        today = date.today()
        days_diff = (earliest_deadline - today).days
        
        # Logika priorytetyzacji
        if days_diff < 0:
            return {
                'priority': 'urgent',
                'deadline': earliest_deadline,
                'days_until_deadline': days_diff,
                'reason': f'Opóźnione o {abs(days_diff)} dni'
            }
        elif days_diff == 0:
            return {
                'priority': 'urgent',
                'deadline': earliest_deadline,
                'days_until_deadline': days_diff,
                'reason': 'Deadline dziś'
            }
        elif days_diff == 1:
            return {
                'priority': 'urgent',
                'deadline': earliest_deadline,
                'days_until_deadline': days_diff,
                'reason': 'Deadline jutro'
            }
        elif days_diff <= 3:
            return {
                'priority': 'medium',
                'deadline': earliest_deadline,
                'days_until_deadline': days_diff,
                'reason': f'Deadline za {days_diff} dni'
            }
        else:
            return {
                'priority': 'normal',
                'deadline': earliest_deadline,
                'days_until_deadline': days_diff,
                'reason': f'Deadline za {days_diff} dni'
            }
            
    except Exception as e:
        production_logger.error("Błąd obliczania priorytetu pakowania", error=str(e))
        return {
            'priority': 'normal',
            'deadline': None,
            'days_until_deadline': None,
            'reason': f'Błąd: {str(e)}'
        }


def format_packaging_deadline(deadline_date):
    """
    Formatuje deadline na czytelny tekst dla interfejsu pakowania
    
    Args:
        deadline_date (date): Data deadline
        
    Returns:
        dict: {
            'text': str,
            'priority': 'urgent'|'medium'|'normal',
            'css_class': str
        }
    """
    try:
        if not deadline_date:
            return {
                'text': 'BRAK',
                'priority': 'normal',
                'css_class': 'normal'
            }
        
        today = date.today()
        days_diff = (deadline_date - today).days
        
        if days_diff < 0:
            return {
                'text': f'OPÓŹNIONE ({abs(days_diff)} dni)',
                'priority': 'urgent',
                'css_class': 'urgent'
            }
        elif days_diff == 0:
            return {
                'text': 'DZIŚ',
                'priority': 'urgent',
                'css_class': 'urgent'
            }
        elif days_diff == 1:
            return {
                'text': 'JUTRO',
                'priority': 'urgent',
                'css_class': 'urgent'
            }
        elif days_diff <= 3:
            return {
                'text': f'{days_diff} DNI',
                'priority': 'medium',
                'css_class': 'medium'
            }
        elif days_diff <= 7:
            return {
                'text': f'{days_diff} DNI',
                'priority': 'normal',
                'css_class': 'normal'
            }
        else:
            return {
                'text': deadline_date.strftime('%d.%m'),
                'priority': 'normal',
                'css_class': 'normal'
            }
            
    except Exception as e:
        production_logger.error("Błąd formatowania deadline", error=str(e))
        return {
            'text': 'BŁĄD',
            'priority': 'normal',
            'css_class': 'normal'
        }


def validate_packaging_order(order_summary):
    """
    Waliduje czy zamówienie może być pakowane
    
    Args:
        order_summary (ProductionOrderSummary): Zamówienie do walidacji
        
    Returns:
        dict: {
            'valid': bool,
            'errors': list,
            'warnings': list
        }
    """
    errors = []
    warnings = []
    
    try:
        # Sprawdź podstawowe wymagania
        if not order_summary.all_items_glued:
            errors.append("Nie wszystkie produkty zostały sklejone")
        
        if order_summary.packaging_status == 'completed':
            errors.append("Zamówienie zostało już spakowane")
        
        # Sprawdź produkty
        from .models import ProductionItem
        products = ProductionItem.query.filter_by(
            baselinker_order_id=order_summary.baselinker_order_id
        ).all()
        
        if not products:
            errors.append("Zamówienie nie zawiera produktów")
        else:
            # Sprawdź statusy produktów
            completed_products = [p for p in products if p.status.name == 'completed']
            
            if len(completed_products) != len(products):
                errors.append(
                    f"Nie wszystkie produkty ukończone: {len(completed_products)}/{len(products)}"
                )
            
            # Sprawdź czasy sklejenia
            products_without_gluing_time = [
                p for p in completed_products 
                if p.gluing_completed_at is None
            ]
            
            if products_without_gluing_time:
                warnings.append(
                    f"{len(products_without_gluing_time)} produktów bez czasu sklejenia"
                )
        
        # Sprawdź deadline
        priority_info = calculate_packaging_priority(products)
        if priority_info['priority'] == 'urgent' and priority_info['days_until_deadline'] is not None:
            if priority_info['days_until_deadline'] < 0:
                warnings.append(f"Zamówienie opóźnione o {abs(priority_info['days_until_deadline'])} dni")
            elif priority_info['days_until_deadline'] <= 1:
                warnings.append("Pilny deadline - należy spakować priorytetowo")
        
        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings
        }
        
    except Exception as e:
        production_logger.error(f"Błąd walidacji zamówienia {order_summary.id}", error=str(e))
        return {
            'valid': False,
            'errors': [f"Błąd walidacji: {str(e)}"],
            'warnings': []
        }


def sort_packaging_queue(orders_data):
    """
    Sortuje kolejkę pakowania według priorytetów
    
    Args:
        orders_data (list): Lista słowników z danymi zamówień
        
    Returns:
        list: Posortowana lista zamówień
    """
    try:
        def sort_key(order):
            # Priorytet (urgent = 0, medium = 1, normal = 2)
            priority_weight = {
                'urgent': 0,
                'medium': 1, 
                'normal': 2
            }.get(order.get('priority', 'normal'), 2)
            
            # Deadline (brak deadline = data maksymalna)
            deadline = order.get('deadline')
            if deadline:
                try:
                    deadline_date = datetime.fromisoformat(deadline.replace('Z', '+00:00')).date()
                except:
                    deadline_date = date.max
            else:
                deadline_date = date.max
            
            # Data utworzenia (starsze pierwsze)
            created_at = order.get('created_at')
            if created_at:
                try:
                    created_date = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                except:
                    created_date = datetime.max
            else:
                created_date = datetime.max
            
            return (priority_weight, deadline_date, created_date)
        
        sorted_orders = sorted(orders_data, key=sort_key)
        
        production_logger.info(f"Posortowano {len(sorted_orders)} zamówień w kolejce pakowania")
        
        return sorted_orders
        
    except Exception as e:
        production_logger.error("Błąd sortowania kolejki pakowania", error=str(e))
        return orders_data  # Zwróć nieposortowaną listę


def calculate_packaging_stats_summary(orders):
    """
    Oblicza statystyki podsumowujące dla kolejki pakowania
    
    Args:
        orders (list): Lista zamówień do pakowania
        
    Returns:
        dict: Statystyki kolejki
    """
    try:
        if not orders:
            return {
                'total_orders': 0,
                'total_products': 0,
                'urgent_orders': 0,
                'medium_orders': 0,
                'normal_orders': 0,
                'overdue_orders': 0,
                'avg_products_per_order': 0
            }
        
        stats = {
            'total_orders': len(orders),
            'total_products': 0,
            'urgent_orders': 0,
            'medium_orders': 0,
            'normal_orders': 0,
            'overdue_orders': 0
        }
        
        for order in orders:
            # Liczba produktów
            products_count = order.get('total_items_count', 0)
            stats['total_products'] += products_count
            
            # Priorytety
            priority = order.get('priority', 'normal')
            if priority == 'urgent':
                stats['urgent_orders'] += 1
            elif priority == 'medium':
                stats['medium_orders'] += 1
            else:
                stats['normal_orders'] += 1
            
            # Opóźnienia
            deadline = order.get('deadline')
            if deadline:
                try:
                    deadline_date = datetime.fromisoformat(deadline.replace('Z', '+00:00')).date()
                    if deadline_date < date.today():
                        stats['overdue_orders'] += 1
                except:
                    pass
        
        # Średnia liczba produktów na zamówienie
        stats['avg_products_per_order'] = round(
            stats['total_products'] / stats['total_orders'], 1
        ) if stats['total_orders'] > 0 else 0
        
        return stats
        
    except Exception as e:
        production_logger.error("Błąd obliczania statystyk pakowania", error=str(e))
        return {
            'total_orders': 0,
            'total_products': 0,
            'urgent_orders': 0,
            'medium_orders': 0,
            'normal_orders': 0,
            'overdue_orders': 0,
            'avg_products_per_order': 0
        }


def format_packaging_duration(duration_seconds):
    """
    Formatuje czas pakowania na czytelny tekst
    
    Args:
        duration_seconds (int): Czas w sekundach
        
    Returns:
        str: Sformatowany czas (np. "15 min", "1h 23min", "2h")
    """
    try:
        if duration_seconds is None or duration_seconds < 0:
            return "---"
        
        hours = duration_seconds // 3600
        minutes = (duration_seconds % 3600) // 60
        
        if hours == 0:
            if minutes == 0:
                return "< 1 min"
            return f"{minutes} min"
        elif hours < 24:
            if minutes == 0:
                return f"{hours}h"
            return f"{hours}h {minutes}min"
        else:
            days = hours // 24
            remaining_hours = hours % 24
            if remaining_hours == 0:
                return f"{days}d"
            return f"{days}d {remaining_hours}h"
            
    except Exception as e:
        production_logger.error("Błąd formatowania czasu pakowania", error=str(e))
        return "---"


def generate_packaging_report_data(date_from=None, date_to=None):
    """
    Generuje dane do raportu pakowania
    
    Args:
        date_from (date): Data początkowa
        date_to (date): Data końcowa
        
    Returns:
        dict: Dane raportu
    """
    try:
        from .models import ProductionOrderSummary, ProductionItem
        from sqlalchemy import func
        
        if date_from is None:
            date_from = date.today()
        if date_to is None:
            date_to = date.today()
        
        production_logger.info(f"Generowanie raportu pakowania {date_from} - {date_to}")
        
        # Zamówienia spakowane w okresie
        packed_orders = ProductionOrderSummary.query.filter(
            ProductionOrderSummary.packaging_status == 'completed',
            func.date(ProductionOrderSummary.updated_at) >= date_from,
            func.date(ProductionOrderSummary.updated_at) <= date_to
        ).all()
        
        # Produkty spakowane w okresie
        packed_products = ProductionItem.query.filter(
            func.date(ProductionItem.packaging_completed_at) >= date_from,
            func.date(ProductionItem.packaging_completed_at) <= date_to
        ).all()
        
        # Statystyki podstawowe
        report_data = {
            'period': {
                'date_from': date_from.isoformat(),
                'date_to': date_to.isoformat(),
                'days_count': (date_to - date_from).days + 1
            },
            'summary': {
                'orders_packed': len(packed_orders),
                'products_packed': len(packed_products),
                'avg_orders_per_day': round(len(packed_orders) / ((date_to - date_from).days + 1), 1),
                'avg_products_per_day': round(len(packed_products) / ((date_to - date_from).days + 1), 1)
            },
            'orders': [],
            'products_by_species': {},
            'packaging_times': []
        }
        
        # Szczegóły zamówień
        for order in packed_orders:
            duration = order.get_packaging_duration()
            
            report_data['orders'].append({
                'baselinker_order_id': order.baselinker_order_id,
                'products_count': order.total_items_count,
                'packaging_duration': duration,
                'packaging_duration_formatted': format_packaging_duration(duration),
                'completed_at': order.updated_at.isoformat() if order.updated_at else None
            })
        
        # Analiza gatunków drewna
        for product in packed_products:
            species = product.wood_species or 'Nieznany'
            if species not in report_data['products_by_species']:
                report_data['products_by_species'][species] = 0
            report_data['products_by_species'][species] += product.quantity
        
        # Czasy pakowania
        packaging_durations = [
            order.get_packaging_duration() 
            for order in packed_orders 
            if order.get_packaging_duration() is not None
        ]
        
        if packaging_durations:
            report_data['packaging_times'] = {
                'avg_duration': round(sum(packaging_durations) / len(packaging_durations)),
                'min_duration': min(packaging_durations),
                'max_duration': max(packaging_durations),
                'count': len(packaging_durations)
            }
        
        production_logger.info("Raport pakowania wygenerowany", summary=report_data['summary'])
        
        return report_data
        
    except Exception as e:
        production_logger.error("Błąd generowania raportu pakowania", error=str(e))
        return {
            'period': {
                'date_from': date_from.isoformat() if date_from else None,
                'date_to': date_to.isoformat() if date_to else None,
                'days_count': 0
            },
            'summary': {
                'orders_packed': 0,
                'products_packed': 0,
                'avg_orders_per_day': 0,
                'avg_products_per_day': 0
            },
            'error': str(e)
        }