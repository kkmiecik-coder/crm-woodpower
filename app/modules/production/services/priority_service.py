# modules/production/services/priority_service.py
"""
Serwis priorytetów dla modułu Production
========================================

Implementuje elastyczny system obliczania priorytetów produktów produkcyjnych:
- Konfigurowalny system wag priorytetyzacji
- Różne kryteria: termin, wartość, objętość, FIFO, klasa drewna
- Cache wyników dla wydajności
- Hot-reload konfiguracji priorytetów
- Szczegółowe logowanie decyzji priorytetowych

Kryteria priorytetyzacji:
- deadline: priorytet na podstawie terminu realizacji (dni do deadline)
- value: priorytet na podstawie wartości zamówienia (PLN)  
- volume: priorytet na podstawie objętości produktu (m³)
- fifo: priorytet kolejności (pierwszy wchodzi, pierwszy wychodzi)
- wood_class: priorytet na podstawie klasy drewna (A > B > C > Rustic)
- customer_type: priorytet na podstawie typu klienta

Autor: Konrad Kmiecik
Wersja: 1.2 (Finalna - z zabezpieczeniami)
Data: 2025-01-08
"""

import threading
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional, Tuple
from modules.logging import get_structured_logger

logger = get_structured_logger('production.priority')

class PriorityError(Exception):
    """Wyjątek dla błędów kalkulacji priorytetów"""
    pass

class PriorityCalculator:
    """
    Kalkulator priorytetów produktów z konfigurowalnymi regułami
    
    System oblicza priorytet jako ważoną sumę różnych kryteriów,
    gdzie każde kryterium może mieć własną wagę i konfigurację.
    """
    
    def __init__(self, cache_duration_minutes=30):
        """
        Inicjalizacja kalkulatora priorytetów
        
        Args:
            cache_duration_minutes (int): Czas życia cache konfiguracji
        """
        self.cache_duration = timedelta(minutes=cache_duration_minutes)
        self._config_cache = None
        self._cache_timestamp = None
        self._lock = threading.RLock()
        
        # Domyślne wagi kryteriów (używane gdy brak konfiguracji w bazie)
        self._default_criteria = {
            'deadline': {
                'weight': 40,
                'config': {
                    'urgent_days': 3,      # Dni do deadline = krytyczne
                    'normal_days': 7,      # Dni do deadline = normalne
                    'base_score': 100,     # Bazowy wynik dla normalnych terminów
                    'urgent_multiplier': 2.0,  # Mnożnik dla pilnych
                    'overdue_penalty': 50  # Kara za przekroczenie terminu
                }
            },
            'value': {
                'weight': 30,
                'config': {
                    'high_threshold': 5000,    # Wysoka wartość (PLN)
                    'medium_threshold': 2000,  # Średnia wartość (PLN)
                    'base_score': 50,          # Bazowy wynik dla wartości
                    'high_multiplier': 2.0,    # Mnożnik dla wysokiej wartości
                    'medium_multiplier': 1.5   # Mnożnik dla średniej wartości
                }
            },
            'volume': {
                'weight': 20,
                'config': {
                    'large_threshold': 1.0,    # Duża objętość (m³)
                    'medium_threshold': 0.5,   # Średnia objętość (m³)
                    'base_score': 30,          # Bazowy wynik dla objętości
                    'large_multiplier': 1.8,   # Mnożnik dla dużej objętości
                    'medium_multiplier': 1.3   # Mnożnik dla średniej objętości
                }
            },
            'fifo': {
                'weight': 10,
                'config': {
                    'base_score': 10,          # Bazowy wynik FIFO
                    'hours_penalty': 0.1       # Kara za każdą godzinę opóźnienia
                }
            }
        }
        
        logger.info("Inicjalizacja PriorityCalculator", extra={
            'cache_duration_minutes': cache_duration_minutes,
            'default_criteria_count': len(self._default_criteria)
        })
    
    def calculate_priority(self, product_data: Dict[str, Any]) -> int:
        """
        Oblicza priorytet produktu na podstawie konfigurowanych kryteriów
        
        Args:
            product_data (Dict[str, Any]): Dane produktu zawierające:
                - deadline_date: data deadline (date lub str)
                - total_value_net: wartość netto (float)
                - volume_m3: objętość w m³ (float)
                - created_at: data utworzenia (datetime lub str)
                - wood_class: klasa drewna (str)
                - customer_type: typ klienta (str)
                
        Returns:
            int: Wynik priorytetu (wyższy = wyższy priorytet)
        """
        try:
            # Pobranie aktualnej konfiguracji
            criteria_config = self._get_criteria_config()
            
            total_score = 0.0
            total_weight = 0.0
            calculation_details = {}
            
            for criterion_name, criterion_config in criteria_config.items():
                try:
                    # Obliczenie wyniku dla kryterium
                    criterion_score = self._calculate_criterion_score(
                        criterion_name, 
                        criterion_config, 
                        product_data
                    )
                    
                    # Zastosowanie wagi
                    weight = criterion_config.get('weight', 0) / 100.0
                    weighted_score = criterion_score * weight
                    
                    total_score += weighted_score
                    total_weight += weight
                    
                    calculation_details[criterion_name] = {
                        'raw_score': criterion_score,
                        'weight': criterion_config.get('weight', 0),
                        'weighted_score': weighted_score
                    }
                    
                except Exception as e:
                    logger.warning("Błąd obliczania kryterium", extra={
                        'criterion': criterion_name,
                        'error': str(e)
                    })
                    continue
            
            # Normalizacja wyniku końcowego
            if total_weight > 0:
                final_score = total_score / total_weight
            else:
                final_score = 100  # Domyślny priorytet
            
            # Zaokrąglenie do liczby całkowitej
            priority_score = max(1, int(round(final_score)))
            
            logger.debug("Obliczono priorytet produktu", extra={
                'product_id': product_data.get('short_product_id', 'unknown'),
                'final_priority': priority_score,
                'total_score': total_score,
                'total_weight': total_weight,
                'criteria_details': calculation_details
            })
            
            return priority_score
            
        except Exception as e:
            logger.error("Błąd obliczania priorytetu", extra={
                'product_data': {k: str(v)[:50] for k, v in product_data.items()},
                'error': str(e)
            })
            return 100  # Domyślny priorytet przy błędzie
    
    def _get_criteria_config(self) -> Dict[str, Dict[str, Any]]:
        """
        Pobiera konfigurację kryteriów z cache lub bazy danych
        
        Returns:
            Dict[str, Dict[str, Any]]: Konfiguracja kryteriów
        """
        with self._lock:
            # Sprawdzenie czy cache jest ważny
            if self._is_config_cache_valid():
                return self._config_cache
            
            # Pobranie konfiguracji z bazy danych
            config = self._load_criteria_config_from_db()
            
            # Zapisanie w cache
            self._config_cache = config
            self._cache_timestamp = datetime.now()
            
            return config
    
    def _is_config_cache_valid(self) -> bool:
        """
        Sprawdza czy cache konfiguracji jest ważny
        
        Returns:
            bool: True jeśli cache jest ważny
        """
        if self._config_cache is None or self._cache_timestamp is None:
            return False
            
        cache_age = datetime.now() - self._cache_timestamp
        return cache_age < self.cache_duration
    
    def _load_criteria_config_from_db(self) -> Dict[str, Dict[str, Any]]:
        """
        Ładuje konfigurację kryteriów z bazy danych
        
        Returns:
            Dict[str, Dict[str, Any]]: Konfiguracja kryteriów
        """
        try:
            from ..models import ProductionPriorityConfig
            
            config = {}
            db_configs = ProductionPriorityConfig.query.filter_by(is_active=True).order_by(
                ProductionPriorityConfig.display_order
            ).all()
            
            if not db_configs:
                logger.info("Brak konfiguracji priorytetów w bazie, używam domyślnych")
                return self._default_criteria
            
            for db_config in db_configs:
                try:
                    config_name = db_config.config_name.lower().replace(' ', '_')
                    config[config_name] = {
                        'weight': db_config.weight_percentage,
                        'config': db_config.criteria_json
                    }
                    
                except Exception as e:
                    logger.warning("Błąd parsowania konfiguracji priorytetu", extra={
                        'config_name': db_config.config_name,
                        'error': str(e)
                    })
                    continue
            
            if not config:
                logger.warning("Nie można załadować konfiguracji z bazy, używam domyślnych")
                return self._default_criteria
            
            logger.info("Załadowano konfigurację priorytetów z bazy", extra={
                'criteria_count': len(config)
            })
            
            return config
            
        except Exception as e:
            logger.error("Błąd ładowania konfiguracji priorytetów", extra={
                'error': str(e)
            })
            return self._default_criteria
    
    def _calculate_criterion_score(self, criterion_name: str, criterion_config: Dict[str, Any], 
                                 product_data: Dict[str, Any]) -> float:
        """
        Oblicza wynik dla konkretnego kryterium
        
        Args:
            criterion_name (str): Nazwa kryterium
            criterion_config (Dict[str, Any]): Konfiguracja kryterium
            product_data (Dict[str, Any]): Dane produktu
            
        Returns:
            float: Wynik dla kryterium
        """
        config = criterion_config.get('config', {})
        
        if criterion_name == 'deadline' or 'termin' in criterion_name.lower():
            return self._calculate_deadline_score(config, product_data)
            
        elif criterion_name == 'value' or 'wartość' in criterion_name.lower():
            return self._calculate_value_score(config, product_data)
            
        elif criterion_name == 'volume' or 'objętość' in criterion_name.lower():
            return self._calculate_volume_score(config, product_data)
            
        elif criterion_name == 'fifo' or 'kolejność' in criterion_name.lower():
            return self._calculate_fifo_score(config, product_data)
            
        elif criterion_name == 'wood_class' or 'klasa' in criterion_name.lower():
            return self._calculate_wood_class_score(config, product_data)
            
        elif criterion_name == 'customer_type' or 'klient' in criterion_name.lower():
            return self._calculate_customer_type_score(config, product_data)
            
        else:
            logger.warning("Nieznane kryterium priorytetu", extra={
                'criterion_name': criterion_name
            })
            return 0.0
    
    def _calculate_deadline_score(self, config: Dict[str, Any], product_data: Dict[str, Any]) -> float:
        """
        Oblicza wynik priorytetu na podstawie terminu realizacji
        
        Args:
            config (Dict[str, Any]): Konfiguracja kryterium deadline
            product_data (Dict[str, Any]): Dane produktu
            
        Returns:
            float: Wynik priorytetu deadline
        """
        deadline_date = product_data.get('deadline_date')
        if not deadline_date:
            return config.get('base_score', 100)
        
        # Konwersja na date object jeśli potrzeba
        if isinstance(deadline_date, str):
            try:
                deadline_date = datetime.strptime(deadline_date, '%Y-%m-%d').date()
            except ValueError:
                return config.get('base_score', 100)
        elif isinstance(deadline_date, datetime):
            deadline_date = deadline_date.date()
        
        # Obliczenie dni do deadline
        days_until_deadline = (deadline_date - date.today()).days
        
        urgent_days = config.get('urgent_days', 3)
        normal_days = config.get('normal_days', 7)
        base_score = config.get('base_score', 100)
        urgent_multiplier = config.get('urgent_multiplier', 2.0)
        overdue_penalty = config.get('overdue_penalty', 50)
        
        if days_until_deadline < 0:
            # Przekroczony termin - wysoki priorytet ale z karą
            score = base_score * urgent_multiplier - (abs(days_until_deadline) * overdue_penalty)
        elif days_until_deadline <= urgent_days:
            # Pilny termin
            score = base_score * urgent_multiplier
        elif days_until_deadline <= normal_days:
            # Normalny termin
            score = base_score
        else:
            # Daleki termin - niski priorytet
            score = base_score * (normal_days / days_until_deadline)
        
        return max(10, score)  # Minimalny wynik 10
    
    def _calculate_value_score(self, config: Dict[str, Any], product_data: Dict[str, Any]) -> float:
        """
        Oblicza wynik priorytetu na podstawie wartości zamówienia
        
        Args:
            config (Dict[str, Any]): Konfiguracja kryterium wartości
            product_data (Dict[str, Any]): Dane produktu
            
        Returns:
            float: Wynik priorytetu wartości
        """
        value = product_data.get('total_value_net', 0)
        if not value or value <= 0:
            return config.get('base_score', 50)
        
        try:
            value = float(value)
        except (ValueError, TypeError):
            return config.get('base_score', 50)
        
        high_threshold = config.get('high_threshold', 5000)
        medium_threshold = config.get('medium_threshold', 2000)
        base_score = config.get('base_score', 50)
        high_multiplier = config.get('high_multiplier', 2.0)
        medium_multiplier = config.get('medium_multiplier', 1.5)
        
        if value >= high_threshold:
            score = base_score * high_multiplier
        elif value >= medium_threshold:
            score = base_score * medium_multiplier
        else:
            # Proporcjonalny wynik dla niskich wartości
            score = base_score * (value / medium_threshold)
        
        return max(10, score)
    
    def _calculate_volume_score(self, config: Dict[str, Any], product_data: Dict[str, Any]) -> float:
        """
        Oblicza wynik priorytetu na podstawie objętości produktu
        
        Args:
            config (Dict[str, Any]): Konfiguracja kryterium objętości
            product_data (Dict[str, Any]): Dane produktu
            
        Returns:
            float: Wynik priorytetu objętości
        """
        volume = product_data.get('volume_m3', 0)
        if not volume or volume <= 0:
            return config.get('base_score', 30)
        
        try:
            volume = float(volume)
        except (ValueError, TypeError):
            return config.get('base_score', 30)
        
        large_threshold = config.get('large_threshold', 1.0)
        medium_threshold = config.get('medium_threshold', 0.5)
        base_score = config.get('base_score', 30)
        large_multiplier = config.get('large_multiplier', 1.8)
        medium_multiplier = config.get('medium_multiplier', 1.3)
        
        if volume >= large_threshold:
            score = base_score * large_multiplier
        elif volume >= medium_threshold:
            score = base_score * medium_multiplier
        else:
            # Proporcjonalny wynik dla małych objętości
            score = base_score * (volume / medium_threshold)
        
        return max(5, score)
    
    def _calculate_fifo_score(self, config: Dict[str, Any], product_data: Dict[str, Any]) -> float:
        """
        Oblicza wynik priorytetu FIFO (pierwszy wchodzi, pierwszy wychodzi)
        
        Args:
            config (Dict[str, Any]): Konfiguracja kryterium FIFO
            product_data (Dict[str, Any]): Dane produktu
            
        Returns:
            float: Wynik priorytetu FIFO
        """
        created_at = product_data.get('created_at')
        if not created_at:
            return config.get('base_score', 10)
        
        # Konwersja na datetime jeśli potrzeba
        if isinstance(created_at, str):
            try:
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            except ValueError:
                return config.get('base_score', 10)
        
        # Obliczenie czasu od utworzenia
        now = datetime.now()
        if created_at.tzinfo:
            # Dodanie timezone info do now jeśli created_at ma timezone
            from datetime import timezone
            now = now.replace(tzinfo=timezone.utc)
        
        hours_since_created = (now - created_at).total_seconds() / 3600
        
        base_score = config.get('base_score', 10)
        hours_penalty = config.get('hours_penalty', 0.1)
        
        # Im starszy produkt, tym wyższy priorytet (ale z ograniczeniem wzrostu)
        fifo_bonus = min(50, hours_since_created * hours_penalty)
        score = base_score + fifo_bonus
        
        return max(1, score)
    
    def _calculate_wood_class_score(self, config: Dict[str, Any], product_data: Dict[str, Any]) -> float:
        """
        Oblicza wynik priorytetu na podstawie klasy drewna
        
        Args:
            config (Dict[str, Any]): Konfiguracja kryterium klasy drewna
            product_data (Dict[str, Any]): Dane produktu
            
        Returns:
            float: Wynik priorytetu klasy drewna
        """
        wood_class = product_data.get('wood_class', '').upper()
        
        # Mapowanie klas na wyniki
        class_scores = config.get('class_scores', {
            'A': 100,
            'SELECT': 90,
            'PREMIUM': 85,
            'B': 70,
            'NATURE': 60,
            'C': 50,
            'RUSTIC': 40
        })
        
        base_score = config.get('base_score', 50)
        
        if wood_class in class_scores:
            return class_scores[wood_class]
        
        return base_score
    
    def _calculate_customer_type_score(self, config: Dict[str, Any], product_data: Dict[str, Any]) -> float:
        """
        Oblicza wynik priorytetu na podstawie typu klienta
        
        Args:
            config (Dict[str, Any]): Konfiguracja kryterium typu klienta
            product_data (Dict[str, Any]): Dane produktu
            
        Returns:
            float: Wynik priorytetu typu klienta
        """
        customer_type = product_data.get('customer_type', '').lower()
        
        # Mapowanie typów klientów na wyniki
        type_scores = config.get('type_scores', {
            'vip': 100,
            'premium': 80,
            'partner': 70,
            'hurtowy': 60,
            'detaliczny': 50,
            'standard': 40
        })
        
        base_score = config.get('base_score', 50)
        
        for type_key, score in type_scores.items():
            if type_key in customer_type:
                return score
        
        return base_score
    
    def calculate_priorities_batch(self, products_data: List[Dict[str, Any]]) -> List[Tuple[str, int]]:
        """
        Oblicza priorytety dla wielu produktów jednocześnie
        
        Args:
            products_data (List[Dict[str, Any]]): Lista danych produktów
            
        Returns:
            List[Tuple[str, int]]: Lista (product_id, priority_score)
        """
        results = []
        
        for product_data in products_data:
            try:
                product_id = product_data.get('short_product_id', 'unknown')
                priority = self.calculate_priority(product_data)
                results.append((product_id, priority))
                
            except Exception as e:
                product_id = product_data.get('short_product_id', 'unknown')
                logger.error("Błąd obliczania priorytetu w batch", extra={
                    'product_id': product_id,
                    'error': str(e)
                })
                results.append((product_id, 100))  # Domyślny priorytet
        
        logger.info("Obliczono priorytety batch", extra={
            'products_count': len(products_data),
            'success_count': len(results)
        })
        
        return results
    
    def invalidate_cache(self):
        """Invaliduje cache konfiguracji priorytetów"""
        with self._lock:
            self._config_cache = None
            self._cache_timestamp = None
            
        logger.info("Invalidated priority config cache")
    
    def get_criteria_weights(self) -> Dict[str, int]:
        """
        Pobiera aktualne wagi kryteriów
        
        Returns:
            Dict[str, int]: Słownik nazwa_kryterium -> waga_procentowa
        """
        config = self._get_criteria_config()
        return {name: criteria.get('weight', 0) for name, criteria in config.items()}
    
    def simulate_priority_calculation(self, product_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Symuluje obliczenie priorytetu z szczegółami dla debugowania
        
        Args:
            product_data (Dict[str, Any]): Dane produktu
            
        Returns:
            Dict[str, Any]: Szczegółowe informacje o obliczeniu priorytetu
        """
        criteria_config = self._get_criteria_config()
        
        simulation = {
            'product_id': product_data.get('short_product_id', 'unknown'),
            'final_priority': 0,
            'criteria_breakdown': {},
            'total_weight': 0,
            'warnings': []
        }
        
        total_score = 0.0
        total_weight = 0.0
        
        for criterion_name, criterion_config in criteria_config.items():
            try:
                criterion_score = self._calculate_criterion_score(
                    criterion_name, criterion_config, product_data
                )
                
                weight = criterion_config.get('weight', 0) / 100.0
                weighted_score = criterion_score * weight
                
                total_score += weighted_score
                total_weight += weight
                
                simulation['criteria_breakdown'][criterion_name] = {
                    'raw_score': round(criterion_score, 2),
                    'weight_percent': criterion_config.get('weight', 0),
                    'weight_decimal': round(weight, 3),
                    'weighted_score': round(weighted_score, 2),
                    'config_used': criterion_config.get('config', {})
                }
                
            except Exception as e:
                simulation['warnings'].append(f"Błąd kryterium {criterion_name}: {str(e)}")
        
        if total_weight > 0:
            final_score = total_score / total_weight
        else:
            final_score = 100
            simulation['warnings'].append("Suma wag wynosi 0, użyto domyślnego priorytetu")
        
        simulation['final_priority'] = max(1, int(round(final_score)))
        simulation['total_weight'] = round(total_weight * 100, 1)  # Procent
        simulation['raw_total_score'] = round(total_score, 2)
        
        return simulation

# Singleton instance dla globalnego dostępu
_priority_calculator_instance = None
_calculator_lock = threading.Lock()

def get_priority_calculator() -> PriorityCalculator:
    """
    Pobiera singleton instance PriorityCalculator
    
    Returns:
        PriorityCalculator: Instancja kalkulatora
    """
    global _priority_calculator_instance
    
    if _priority_calculator_instance is None:
        with _calculator_lock:
            if _priority_calculator_instance is None:
                _priority_calculator_instance = PriorityCalculator()
                logger.info("Utworzono singleton PriorityCalculator")
    
    return _priority_calculator_instance

# Funkcje pomocnicze
def calculate_priority(product_data: Dict[str, Any]) -> int:
    """Helper function dla obliczania priorytetu"""
    return get_priority_calculator().calculate_priority(product_data)

def calculate_priorities_batch(products_data: List[Dict[str, Any]]) -> List[Tuple[str, int]]:
    """Helper function dla obliczania priorytetów batch"""
    return get_priority_calculator().calculate_priorities_batch(products_data)

def invalidate_priority_cache():
    """Helper function dla invalidacji cache priorytetów"""
    get_priority_calculator().invalidate_cache()

def simulate_priority_calculation(product_data: Dict[str, Any]) -> Dict[str, Any]:
    """Helper function dla symulacji obliczenia priorytetu"""
    return get_priority_calculator().simulate_priority_calculation(product_data)