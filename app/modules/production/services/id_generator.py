# modules/production/services/id_generator.py
"""
Generator ID produktów dla modułu Production
============================================

Implementuje system generowania unikalnych identyfikatorów produktów w formacie:
YY_NNNNN_S gdzie:
- YY = rok (25 dla 2025, 26 dla 2026)
- NNNNN = numer zamówienia w bazie (5-cyfrowy z padding)
- S = numer produktu w zamówieniu (1, 2, 3...)

Przykłady:
- 25_05248_1 (pierwszy produkt w zamówieniu 5248 z 2025)
- 25_05248_2 (drugi produkt w tym samym zamówieniu)
- 26_00001_1 (pierwszy produkt pierwszego zamówienia z 2026)

Autor: Konrad Kmiecik
Wersja: 1.2 (Finalna - z zabezpieczeniami)
Data: 2025-01-08
"""

import re
from datetime import datetime
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text
from extensions import db
from modules.logging import get_structured_logger
import threading
import sys

logger = get_structured_logger('production.id_generator')

class ProductIDGeneratorError(Exception):
    """Wyjątek dla błędów generatora ID"""
    pass

class ProductIDGenerator:
    """
    Generator unikalnych ID produktów z automatycznym licznikiem per rok
    
    Klasa statyczna zarządzająca generowaniem i walidacją ID produktów
    w nowym formacie skróconym dla optimalizacji workflow produkcyjnego.
    """

    # Cache dla mapowania baselinker_order_id -> internal_order_number
    _order_mapping_cache = {}
    _cache_lock = threading.Lock() if 'threading' in sys.modules else None
    
    # Pattern dla walidacji formatu ID
    PRODUCT_ID_PATTERN = re.compile(r'^(\d{2})_(\d{5})_(\d+)$')
    INTERNAL_ORDER_PATTERN = re.compile(r'^(\d{2})_(\d{5})$')

    @classmethod
    def generate_product_id_for_order(cls, baselinker_order_id, total_products_count):
        """
        Generuje jeden internal_order_number dla całego zamówienia
        i zwraca listę wszystkich product_id dla tego zamówienia
    
        Args:
            baselinker_order_id (int): ID zamówienia w Baselinker
            total_products_count (int): Łączna liczba produktów w zamówieniu
        
        Returns:
            dict: {
                'internal_order_number': str,  # '25_01029'
                'product_ids': [str],          # ['25_01029_1', '25_01029_2', ...]
                'year_code': str,              # '25'
                'order_counter': int           # 1029
            }
        """
        try:
            # Sprawdź cache - czy to zamówienie już było przetwarzane
            if baselinker_order_id in cls._order_mapping_cache:
                cached = cls._order_mapping_cache[baselinker_order_id]
                # Wygeneruj listę product_ids dla cache'owanego zamówienia
                product_ids = []
                for seq in range(1, total_products_count + 1):
                    product_ids.append(f"{cached['internal_order_number']}_{seq}")
            
                return {
                    'internal_order_number': cached['internal_order_number'],
                    'product_ids': product_ids,
                    'year_code': cached['year_code'],
                    'order_counter': cached['order_counter']
                }
        
            # Generuj nowy internal_order_number
            current_year = datetime.now().year
            year_code = str(current_year)[-2:]
            order_counter = cls._get_next_order_counter(current_year)
        
            internal_order_number = f"{year_code}_{order_counter:05d}"
        
            # Wygeneruj listę wszystkich product_ids dla tego zamówienia
            product_ids = []
            for sequence in range(1, total_products_count + 1):
                product_ids.append(f"{internal_order_number}_{sequence}")
        
            result = {
                'internal_order_number': internal_order_number,
                'product_ids': product_ids,
                'year_code': year_code,
                'order_counter': order_counter
            }
        
            # Zapisz w cache
            cls._order_mapping_cache[baselinker_order_id] = {
                'internal_order_number': internal_order_number,
                'year_code': year_code,
                'order_counter': order_counter
            }
        
            logger.info("Wygenerowano ID dla zamówienia", extra={
                'baselinker_order_id': baselinker_order_id,
                'internal_order_number': internal_order_number,
                'total_products': total_products_count,
                'first_id': product_ids[0] if product_ids else None,
                'last_id': product_ids[-1] if product_ids else None
            })
        
            return result
        
        except Exception as e:
            logger.error("Błąd generowania ID dla zamówienia", extra={
                'baselinker_order_id': baselinker_order_id,
                'total_products_count': total_products_count,
                'error': str(e)
            })
            raise ProductIDGeneratorError(f"Nie można wygenerować ID dla zamówienia: {str(e)}")
    
    @classmethod
    def generate_product_id(cls, baselinker_order_id, sequence_number):
        """
        Generuje nowy Product ID w formacie YY_NNNNN_S
        
        Args:
            baselinker_order_id (int): ID zamówienia w Baselinker
            sequence_number (int): Numer sekwencji produktu w zamówieniu (1, 2, 3...)
            
        Returns:
            dict: {
                'product_id': str,           # Kompletny ID produktu (25_05248_1)
                'internal_order_number': str, # Numer zamówienia wewnętrznego (25_05248)
                'year_code': str,            # Kod roku (25)
                'order_counter': int,        # Licznik zamówienia (5248)
                'sequence': int              # Numer sekwencji (1)
            }
            
        Raises:
            ProductIDGeneratorError: W przypadku błędu generowania
        """
        try:
            # Walidacja parametrów wejściowych
            if not isinstance(baselinker_order_id, int) or baselinker_order_id <= 0:
                raise ProductIDGeneratorError(f"Nieprawidłowy baselinker_order_id: {baselinker_order_id}")
                
            if not isinstance(sequence_number, int) or sequence_number <= 0:
                raise ProductIDGeneratorError(f"Nieprawidłowy sequence_number: {sequence_number}")
            
            # Pobranie aktualnego roku i konwersja na 2-cyfrowy kod
            current_year = datetime.now().year
            year_code = str(current_year)[-2:]  # 2025 -> 25
            
            # Pobranie/utworzenie licznika dla roku
            order_counter = cls._get_next_order_counter(current_year)
            
            # Formatowanie licznika do 5 cyfr z zerem wiodącym
            formatted_counter = f"{order_counter:05d}"
            
            # Tworzenie ID
            internal_order_number = f"{year_code}_{formatted_counter}"
            product_id = f"{internal_order_number}_{sequence_number}"
            
            # Walidacja wygenerowanego ID
            if not cls.validate_product_id_format(product_id):
                raise ProductIDGeneratorError(f"Wygenerowany ID ma nieprawidłowy format: {product_id}")
            
            result = {
                'product_id': product_id,
                'internal_order_number': internal_order_number,
                'year_code': year_code,
                'order_counter': order_counter,
                'sequence': sequence_number
            }
            
            logger.info("Wygenerowano nowy Product ID", extra={
                'baselinker_order_id': baselinker_order_id,
                'generated_id': product_id,
                'internal_order': internal_order_number,
                'year': current_year,
                'counter': order_counter,
                'sequence': sequence_number
            })
            
            return result
            
        except Exception as e:
            logger.error("Błąd generowania Product ID", extra={
                'baselinker_order_id': baselinker_order_id,
                'sequence_number': sequence_number,
                'error': str(e)
            })
            raise ProductIDGeneratorError(f"Nie można wygenerować Product ID: {str(e)}")
    
    @classmethod
    def _get_next_order_counter(cls, year):
        """
        Pobiera i inkrementuje licznik zamówień dla podanego roku
    
        Args:
            year (int): Rok dla którego pobrać licznik
        
        Returns:
            int: Następny numer w sekwencji
        
        Raises:
            ProductIDGeneratorError: W przypadku błędu bazy danych
        """
        try:
            # Import lokalny aby uniknąć circular imports
            from ..models import ProductionOrderCounter
        
            # USUŃ with db.session.begin(): - to powoduje konflikt
            # Szukanie istniejącego licznika
            counter = ProductionOrderCounter.query.filter_by(year=year).first()
        
            if not counter:
                # Utworzenie nowego licznika dla roku
                counter = ProductionOrderCounter(
                    year=year,
                    current_counter=1
                )
                db.session.add(counter)
            else:
                # Inkrementacja licznika
                counter.current_counter += 1
                counter.last_updated_at = datetime.utcnow()
        
            next_counter = counter.current_counter
        
            # Commit bez transakcji bloku
            db.session.commit()
        
            logger.debug("Pobrano kolejny licznik zamówienia", extra={
                'year': year,
                'counter': next_counter
            })
        
            return next_counter
        
        except IntegrityError as e:
            db.session.rollback()
            logger.error("Błąd integralności podczas pobierania licznika", extra={
                'year': year,
                'error': str(e)
            })
            raise ProductIDGeneratorError(f"Błąd integralności bazy danych: {str(e)}")
        
        except Exception as e:
            db.session.rollback()
            logger.error("Błąd pobierania licznika zamówienia", extra={
                'year': year,
                'error': str(e)
            })
            raise ProductIDGeneratorError(f"Nie można pobrać licznika: {str(e)}")
    
    @classmethod
    def validate_product_id_format(cls, product_id):
        """
        Waliduje format Product ID
        
        Args:
            product_id (str): ID do sprawdzenia
            
        Returns:
            bool: True jeśli format jest poprawny
        """
        if not isinstance(product_id, str):
            return False
            
        match = cls.PRODUCT_ID_PATTERN.match(product_id)
        if not match:
            return False
            
        year_code, order_number, sequence = match.groups()
        
        # Sprawdzenie czy rok jest sensowny (20-99 dla lat 2020-2099)
        try:
            year_int = int(year_code)
            if not (20 <= year_int <= 99):
                return False
        except ValueError:
            return False
            
        # Sprawdzenie czy numer zamówienia jest w zakresie
        try:
            order_int = int(order_number)
            if not (1 <= order_int <= 99999):
                return False
        except ValueError:
            return False
            
        # Sprawdzenie czy sekwencja jest sensowna
        try:
            sequence_int = int(sequence)
            if not (1 <= sequence_int <= 999):  # Max 999 produktów w zamówieniu
                return False
        except ValueError:
            return False
            
        return True
    
    @classmethod
    def validate_internal_order_format(cls, internal_order):
        """
        Waliduje format wewnętrznego numeru zamówienia
        
        Args:
            internal_order (str): Numer do sprawdzenia (format: YY_NNNNN)
            
        Returns:
            bool: True jeśli format jest poprawny
        """
        if not isinstance(internal_order, str):
            return False
            
        return bool(cls.INTERNAL_ORDER_PATTERN.match(internal_order))
    
    @classmethod
    def parse_product_id(cls, product_id):
        """
        Parsuje Product ID na komponenty
        
        Args:
            product_id (str): ID do sparsowania
            
        Returns:
            dict: {
                'year_code': str,
                'order_counter': int,
                'sequence': int,
                'internal_order_number': str,
                'full_year': int
            } lub None jeśli format niepoprawny
        """
        if not cls.validate_product_id_format(product_id):
            return None
            
        match = cls.PRODUCT_ID_PATTERN.match(product_id)
        year_code, order_number, sequence = match.groups()
        
        # Konwersja 2-cyfrowego roku na pełny rok
        year_int = int(year_code)
        full_year = 2000 + year_int if year_int >= 20 else 1900 + year_int
        
        return {
            'year_code': year_code,
            'order_counter': int(order_number),
            'sequence': int(sequence),
            'internal_order_number': f"{year_code}_{order_number}",
            'full_year': full_year
        }
    
    @classmethod
    def get_current_counter_for_year(cls, year=None):
        """
        Pobiera aktualny licznik dla roku (bez inkrementacji)
        
        Args:
            year (int, optional): Rok. Domyślnie aktualny rok.
            
        Returns:
            int: Aktualny licznik lub 0 jeśli nie istnieje
        """
        if year is None:
            year = datetime.now().year
            
        try:
            from ..models import ProductionOrderCounter
            
            counter = ProductionOrderCounter.query.filter_by(year=year).first()
            return counter.current_counter if counter else 0
            
        except Exception as e:
            logger.error("Błąd pobierania aktualnego licznika", extra={
                'year': year,
                'error': str(e)
            })
            return 0
    
    @classmethod
    def generate_multiple_product_ids(cls, baselinker_order_id, product_count):
        """
        Generuje wiele Product ID dla tego samego zamówienia
        
        Args:
            baselinker_order_id (int): ID zamówienia w Baselinker
            product_count (int): Liczba produktów do wygenerowania
            
        Returns:
            list: Lista słowników z wygenerowanymi ID
            
        Raises:
            ProductIDGeneratorError: W przypadku błędu
        """
        if not isinstance(product_count, int) or product_count <= 0:
            raise ProductIDGeneratorError(f"Nieprawidłowa liczba produktów: {product_count}")
            
        if product_count > 999:
            raise ProductIDGeneratorError(f"Zbyt duża liczba produktów: {product_count} (max 999)")
        
        try:
            # Wygenerowanie ID dla pierwszego produktu (pobiera nowy licznik)
            first_id = cls.generate_product_id(baselinker_order_id, 1)
            results = [first_id]
            
            # Generowanie kolejnych ID z tym samym internal_order_number
            internal_order = first_id['internal_order_number']
            year_code = first_id['year_code']
            order_counter = first_id['order_counter']
            
            for sequence in range(2, product_count + 1):
                product_id = f"{internal_order}_{sequence}"
                
                result = {
                    'product_id': product_id,
                    'internal_order_number': internal_order,
                    'year_code': year_code,
                    'order_counter': order_counter,
                    'sequence': sequence
                }
                results.append(result)
            
            logger.info("Wygenerowano wiele Product ID", extra={
                'baselinker_order_id': baselinker_order_id,
                'product_count': product_count,
                'internal_order': internal_order,
                'first_id': first_id['product_id'],
                'last_id': results[-1]['product_id']
            })
            
            return results
            
        except Exception as e:
            logger.error("Błąd generowania wielu Product ID", extra={
                'baselinker_order_id': baselinker_order_id,
                'product_count': product_count,
                'error': str(e)
            })
            raise ProductIDGeneratorError(f"Nie można wygenerować wielu ID: {str(e)}")
    
    @classmethod
    def is_product_id_unique(cls, product_id):
        """
        Sprawdza czy Product ID jest unikalny w bazie danych
        
        Args:
            product_id (str): ID do sprawdzenia
            
        Returns:
            bool: True jeśli ID jest unikalny
        """
        try:
            from ..models import ProductionItem
            
            existing = ProductionItem.query.filter_by(
                short_product_id=product_id
            ).first()
            
            is_unique = existing is None
            
            logger.debug("Sprawdzono unikalność Product ID", extra={
                'product_id': product_id,
                'is_unique': is_unique
            })
            
            return is_unique
            
        except Exception as e:
            logger.error("Błąd sprawdzania unikalności Product ID", extra={
                'product_id': product_id,
                'error': str(e)
            })
            return False
    
    @classmethod
    def reset_counter_for_year(cls, year, new_value=0, admin_user_id=None):
        """
        Resetuje licznik dla roku (funkcja administracyjna)
        
        Args:
            year (int): Rok do resetowania
            new_value (int): Nowa wartość licznika
            admin_user_id (int, optional): ID administratora wykonującego reset
            
        Returns:
            bool: True jeśli reset się powiódł
            
        Raises:
            ProductIDGeneratorError: W przypadku błędu
        """
        try:
            from ..models import ProductionOrderCounter
            
            counter = ProductionOrderCounter.query.filter_by(year=year).first()
            
            if not counter:
                # Utworzenie nowego licznika
                counter = ProductionOrderCounter(
                    year=year,
                    current_counter=new_value
                )
                db.session.add(counter)
            else:
                # Reset istniejącego licznika
                old_value = counter.current_counter
                counter.current_counter = new_value
                counter.last_updated_at = datetime.utcnow()
                
                logger.warning("Reset licznika zamówień", extra={
                    'year': year,
                    'old_value': old_value,
                    'new_value': new_value,
                    'admin_user_id': admin_user_id
                })
            
            db.session.commit()
            
            logger.info("Zresetowano licznik dla roku", extra={
                'year': year,
                'new_value': new_value,
                'admin_user_id': admin_user_id
            })
            
            return True
            
        except Exception as e:
            db.session.rollback()
            logger.error("Błąd resetowania licznika", extra={
                'year': year,
                'new_value': new_value,
                'admin_user_id': admin_user_id,
                'error': str(e)
            })
            raise ProductIDGeneratorError(f"Nie można zresetować licznika: {str(e)}")

    @classmethod
    def clear_order_cache(cls):
        """Czyści cache mapowania zamówień (użyj po zakończeniu synchronizacji)"""
        cls._order_mapping_cache.clear()
        logger.info("Wyczyszczono cache mapowania zamówień")

# Funkcje pomocnicze na poziomie modułu
def generate_product_id(baselinker_order_id, sequence_number):
    """Wrapper funkcji generowania ID"""
    return ProductIDGenerator.generate_product_id(baselinker_order_id, sequence_number)

def validate_product_id(product_id):
    """Wrapper funkcji walidacji ID"""
    return ProductIDGenerator.validate_product_id_format(product_id)

def parse_product_id(product_id):
    """Wrapper funkcji parsowania ID"""
    return ProductIDGenerator.parse_product_id(product_id)