# modules/production/services/config_service.py
"""
Serwis konfiguracji dla modułu Production
==========================================

Implementuje system zarządzania konfiguracją z cache'owaniem i automatycznym odświeżaniem:
- Cache konfiguracji z kontrolowanym TTL
- Automatyczne odświeżanie przy zmianie w bazie danych
- Walidacja typów konfiguracji (string, integer, boolean, json, ip_list)
- Hot-reload konfiguracji bez restartu aplikacji
- Hierarchiczny system konfiguracji (per-stanowisko → globalna)

Obsługiwane klucze konfiguracji:
- STATION_ALLOWED_IPS - lista dozwolonych IP
- REFRESH_INTERVAL_SECONDS - częstotliwość odświeżania interfejsów
- DEBUG_PRODUCTION_* - tryby debugowania
- CACHE_DURATION_SECONDS - czas cache dla priorytetów
- SYNC_ENABLED - włączenie/wyłączenie synchronizacji

Autor: Konrad Kmiecik
Wersja: 1.2 (Finalna - z zabezpieczeniami)
Data: 2025-01-08
"""

import json
import threading
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Union, List
from modules.logging import get_structured_logger
from app import db

logger = get_structured_logger('production.config')

class ConfigError(Exception):
    """Wyjątek dla błędów konfiguracji"""
    pass

class ProductionConfigService:
    """
    Serwis zarządzania konfiguracją modułu produkcyjnego
    
    Zapewnia szybki dostęp do konfiguracji z cache'owaniem i automatycznym
    odświeżaniem przy zmianach w bazie danych.
    """
    
    def __init__(self, cache_duration_minutes=60):
        """
        Inicjalizacja serwisu konfiguracji
        
        Args:
            cache_duration_minutes (int): Czas życia cache w minutach
        """
        self.cache_duration = timedelta(minutes=cache_duration_minutes)
        self._config_cache = {}
        self._cache_timestamps = {}
        self._lock = threading.RLock()  # ReentrantLock dla thread safety
        
        # Domyślne wartości konfiguracji
        self._default_values = {
            'STATION_ALLOWED_IPS': '192.168.1.100,192.168.1.101,192.168.1.102',
            'REFRESH_INTERVAL_SECONDS': 30,
            'DEBUG_PRODUCTION_BACKEND': False,
            'DEBUG_PRODUCTION_FRONTEND': False,
            'CACHE_DURATION_SECONDS': 3600,
            'SYNC_ENABLED': True,
            'MAX_SYNC_ITEMS_PER_BATCH': 1000,
            'DEADLINE_DEFAULT_DAYS': 14,
            'ADMIN_EMAIL_NOTIFICATIONS': 'admin@woodpower.pl',
            'BASELINKER_TARGET_STATUS_COMPLETED': 138623,
            'STATION_AUTO_REFRESH_ENABLED': True,
            'ERROR_NOTIFICATION_THRESHOLD': 10,
            'MAX_PRODUCTS_PER_ORDER': 999,
            'PRIORITY_RECALC_INTERVAL_HOURS': 24
        }
        
        logger.info("Inicjalizacja ProductionConfigService", extra={
            'cache_duration_minutes': cache_duration_minutes,
            'default_configs_count': len(self._default_values)
        })
    
    def get_config(self, key: str, default: Any = None, station_type: Optional[str] = None) -> Any:
        """
        Pobiera wartość konfiguracji z cache lub bazy danych
        
        Args:
            key (str): Klucz konfiguracji
            default (Any): Wartość domyślna jeśli klucz nie istnieje
            station_type (str, optional): Typ stanowiska dla konfiguracji hierarchicznej
            
        Returns:
            Any: Sparsowana wartość konfiguracji
        """
        try:
            # Sprawdzenie konfiguracji hierarchicznej (station-specific → global)
            if station_type:
                station_key = f"{key}_{station_type.upper()}"
                station_value = self._get_config_value(station_key)
                if station_value is not None:
                    logger.debug("Zwrócono konfigurację per-stanowisko", extra={
                        'key': station_key,
                        'station_type': station_type
                    })
                    return station_value
            
            # Fallback do globalnej konfiguracji
            global_value = self._get_config_value(key)
            if global_value is not None:
                return global_value
            
            # Sprawdzenie domyślnych wartości
            if key in self._default_values:
                logger.debug("Zwrócono wartość domyślną", extra={
                    'key': key,
                    'default_value': self._default_values[key]
                })
                return self._default_values[key]
            
            # Ostateczny fallback
            logger.debug("Zwrócono fallback default", extra={
                'key': key,
                'default': default
            })
            return default
            
        except Exception as e:
            logger.error("Błąd pobierania konfiguracji", extra={
                'key': key,
                'station_type': station_type,
                'error': str(e)
            })
            return default
    
    def _get_config_value(self, key: str) -> Optional[Any]:
        """
        Pobiera wartość konfiguracji z cache lub bazy danych
        
        Args:
            key (str): Klucz konfiguracji
            
        Returns:
            Optional[Any]: Sparsowana wartość lub None jeśli nie istnieje
        """
        with self._lock:
            # Sprawdzenie cache
            if self._is_cache_valid(key):
                logger.debug("Wartość z cache", extra={'key': key})
                return self._config_cache[key]
            
            # Pobranie z bazy danych
            value = self._load_from_database(key)
            
            if value is not None:
                # Zapisanie w cache
                self._config_cache[key] = value
                self._cache_timestamps[key] = datetime.now()
            
            return value
    
    def _is_cache_valid(self, key: str) -> bool:
        """
        Sprawdza czy wpis w cache jest nadal ważny
        
        Args:
            key (str): Klucz do sprawdzenia
            
        Returns:
            bool: True jeśli cache jest ważny
        """
        if key not in self._config_cache:
            return False
            
        if key not in self._cache_timestamps:
            return False
            
        cache_age = datetime.now() - self._cache_timestamps[key]
        return cache_age < self.cache_duration
    
    def _load_from_database(self, key: str) -> Optional[Any]:
        """
        Ładuje konfigurację z bazy danych
        
        Args:
            key (str): Klucz konfiguracji
            
        Returns:
            Optional[Any]: Sparsowana wartość lub None
        """
        try:
            from ..models import ProductionConfig
            
            config = ProductionConfig.query.filter_by(config_key=key).first()
            if not config:
                logger.debug("Konfiguracja nie znaleziona w bazie", extra={'key': key})
                return None
            
            # Parsowanie wartości zgodnie z typem
            parsed_value = self._parse_config_value(config.config_value, config.config_type)
            
            logger.debug("Załadowano konfigurację z bazy", extra={
                'key': key,
                'type': config.config_type,
                'value': str(parsed_value)[:100]  # Truncate dla logów
            })
            
            return parsed_value
            
        except Exception as e:
            logger.error("Błąd ładowania konfiguracji z bazy", extra={
                'key': key,
                'error': str(e)
            })
            return None
    
    def _parse_config_value(self, value: str, config_type: str) -> Any:
        """
        Parsuje wartość konfiguracji zgodnie z typem
        
        Args:
            value (str): Wartość do sparsowania
            config_type (str): Typ konfiguracji
            
        Returns:
            Any: Sparsowana wartość
            
        Raises:
            ConfigError: W przypadku błędu parsowania
        """
        if not value:
            return None
        
        try:
            if config_type == 'boolean':
                return str(value).lower() in ('true', '1', 'yes', 'on', 'enabled')
                
            elif config_type == 'integer':
                return int(value)
                
            elif config_type == 'json':
                return json.loads(value)
                
            elif config_type == 'ip_list':
                # Parsowanie listy IP oddzielonych przecinkami
                ip_list = []
                for ip in value.split(','):
                    cleaned_ip = ip.strip()
                    if cleaned_ip:
                        ip_list.append(cleaned_ip)
                return ip_list
                
            elif config_type == 'string':
                return str(value)
                
            else:
                logger.warning("Nieznany typ konfiguracji", extra={
                    'config_type': config_type,
                    'value': value
                })
                return str(value)
                
        except (ValueError, json.JSONDecodeError) as e:
            raise ConfigError(f"Błąd parsowania wartości '{value}' jako {config_type}: {e}")
    
    def set_config(self, key: str, value: Any, user_id: Optional[int] = None, 
                   description: Optional[str] = None, config_type: str = 'string') -> bool:
        """
        Ustawia wartość konfiguracji
        
        Args:
            key (str): Klucz konfiguracji
            value (Any): Wartość do ustawienia
            user_id (int, optional): ID użytkownika aktualizującego
            description (str, optional): Opis konfiguracji
            config_type (str): Typ konfiguracji
            
        Returns:
            bool: True jeśli konfiguracja została ustawiona
        """
        try:
            from ..models import ProductionConfig
            
            # Konwersja wartości do stringa zgodnie z typem
            string_value = self._serialize_config_value(value, config_type)
            
            # Walidacja wartości przed zapisaniem
            self._validate_config_value(key, string_value, config_type)
            
            with self._lock:
                # Pobranie/utworzenie konfiguracji
                config = ProductionConfig.query.filter_by(config_key=key).first()
                
                if config:
                    old_value = config.config_value
                    config.config_value = string_value
                    config.updated_by = user_id
                    config.updated_at = datetime.utcnow()
                    if description:
                        config.config_description = description
                else:
                    config = ProductionConfig(
                        config_key=key,
                        config_value=string_value,
                        config_description=description,
                        config_type=config_type,
                        updated_by=user_id
                    )
                    db.session.add(config)
                    old_value = None
                
                db.session.commit()
                
                # Invalidacja cache dla tego klucza
                self._invalidate_cache_key(key)
                
                logger.info("Zaktualizowano konfigurację", extra={
                    'key': key,
                    'old_value': str(old_value)[:100] if old_value else None,
                    'new_value': str(string_value)[:100],
                    'config_type': config_type,
                    'user_id': user_id
                })
                
                return True
                
        except Exception as e:
            db.session.rollback()
            logger.error("Błąd ustawiania konfiguracji", extra={
                'key': key,
                'value': str(value),
                'config_type': config_type,
                'user_id': user_id,
                'error': str(e)
            })
            return False
    
    def _serialize_config_value(self, value: Any, config_type: str) -> str:
        """
        Serializuje wartość do stringa zgodnie z typem
        
        Args:
            value (Any): Wartość do serializacji
            config_type (str): Typ konfiguracji
            
        Returns:
            str: Zserializowana wartość
        """
        if config_type == 'boolean':
            return 'true' if value else 'false'
            
        elif config_type == 'integer':
            return str(int(value))
            
        elif config_type == 'json':
            return json.dumps(value, ensure_ascii=False)
            
        elif config_type == 'ip_list':
            if isinstance(value, list):
                return ','.join(str(ip) for ip in value)
            else:
                return str(value)
                
        else:
            return str(value)
    
    def _validate_config_value(self, key: str, value: str, config_type: str):
        """
        Waliduje wartość konfiguracji przed zapisem
        
        Args:
            key (str): Klucz konfiguracji
            value (str): Wartość do walidacji
            config_type (str): Typ konfiguracji
            
        Raises:
            ConfigError: W przypadku nieprawidłowej wartości
        """
        # Walidacje specyficzne dla kluczy
        if key == 'REFRESH_INTERVAL_SECONDS' and config_type == 'integer':
            interval = int(value)
            if not (5 <= interval <= 300):  # 5 sekund - 5 minut
                raise ConfigError("Interwał odświeżania musi być między 5 a 300 sekund")
        
        elif key == 'MAX_SYNC_ITEMS_PER_BATCH' and config_type == 'integer':
            batch_size = int(value)
            if not (1 <= batch_size <= 10000):
                raise ConfigError("Rozmiar batcha musi być między 1 a 10000")
        
        elif key == 'DEADLINE_DEFAULT_DAYS' and config_type == 'integer':
            days = int(value)
            if not (1 <= days <= 365):
                raise ConfigError("Domyślny deadline musi być między 1 a 365 dni")
        
        elif key.endswith('_IPS') and config_type == 'ip_list':
            # Walidacja listy IP
            import ipaddress
            for ip in value.split(','):
                ip = ip.strip()
                if ip:
                    try:
                        # Sprawdzenie czy to IP czy sieć CIDR
                        if '/' in ip:
                            ipaddress.ip_network(ip, strict=False)
                        else:
                            ipaddress.ip_address(ip)
                    except ValueError:
                        raise ConfigError(f"Nieprawidłowy format IP: {ip}")
    
    def _invalidate_cache_key(self, key: str):
        """
        Invaliduje cache dla konkretnego klucza
        
        Args:
            key (str): Klucz do invalidacji
        """
        if key in self._config_cache:
            del self._config_cache[key]
        if key in self._cache_timestamps:
            del self._cache_timestamps[key]
            
        logger.debug("Invalidated cache for key", extra={'key': key})
    
    def invalidate_cache(self):
        """Invaliduje cały cache konfiguracji"""
        with self._lock:
            self._config_cache.clear()
            self._cache_timestamps.clear()
            
        logger.info("Invalidated full config cache")
    
    def get_all_configs(self, include_defaults: bool = True) -> Dict[str, Any]:
        """
        Pobiera wszystkie konfiguracje
        
        Args:
            include_defaults (bool): Czy dołączyć wartości domyślne
            
        Returns:
            Dict[str, Any]: Słownik wszystkich konfiguracji
        """
        try:
            from ..models import ProductionConfig
            
            configs = {}
            
            # Pobranie wszystkich konfiguracji z bazy
            db_configs = ProductionConfig.query.all()
            for config in db_configs:
                parsed_value = self._parse_config_value(config.config_value, config.config_type)
                configs[config.config_key] = {
                    'value': parsed_value,
                    'type': config.config_type,
                    'description': config.config_description,
                    'updated_at': config.updated_at.isoformat() if config.updated_at else None
                }
            
            # Dodanie domyślnych wartości jeśli nie ma w bazie
            if include_defaults:
                for key, default_value in self._default_values.items():
                    if key not in configs:
                        configs[key] = {
                            'value': default_value,
                            'type': self._guess_config_type(default_value),
                            'description': f'Wartość domyślna dla {key}',
                            'updated_at': None,
                            'is_default': True
                        }
            
            logger.debug("Pobrano wszystkie konfiguracje", extra={
                'configs_count': len(configs),
                'db_configs_count': len(db_configs)
            })
            
            return configs
            
        except Exception as e:
            logger.error("Błąd pobierania wszystkich konfiguracji", extra={
                'error': str(e)
            })
            return {}
    
    def _guess_config_type(self, value: Any) -> str:
        """
        Odgaduje typ konfiguracji na podstawie wartości
        
        Args:
            value (Any): Wartość do analizy
            
        Returns:
            str: Typ konfiguracji
        """
        if isinstance(value, bool):
            return 'boolean'
        elif isinstance(value, int):
            return 'integer'
        elif isinstance(value, (list, dict)):
            return 'json'
        else:
            return 'string'
    
    def export_configs(self, include_sensitive: bool = False) -> Dict[str, Any]:
        """
        Eksportuje konfiguracje do backup/przywracania
        
        Args:
            include_sensitive (bool): Czy dołączyć wrażliwe dane
            
        Returns:
            Dict[str, Any]: Wyeksportowane konfiguracje
        """
        configs = self.get_all_configs()
        
        # Filtrowanie wrażliwych kluczy
        sensitive_keys = ['API_KEY', 'SECRET', 'PASSWORD', 'TOKEN']
        
        if not include_sensitive:
            filtered_configs = {}
            for key, config in configs.items():
                if not any(sensitive in key.upper() for sensitive in sensitive_keys):
                    filtered_configs[key] = config
            configs = filtered_configs
        
        export_data = {
            'export_timestamp': datetime.utcnow().isoformat(),
            'configs_count': len(configs),
            'include_sensitive': include_sensitive,
            'configs': configs
        }
        
        logger.info("Wyeksportowano konfiguracje", extra={
            'configs_count': len(configs),
            'include_sensitive': include_sensitive
        })
        
        return export_data
    
    def import_configs(self, import_data: Dict[str, Any], user_id: Optional[int] = None,
                      overwrite_existing: bool = False) -> Dict[str, bool]:
        """
        Importuje konfiguracje z backup
        
        Args:
            import_data (Dict[str, Any]): Dane do importu
            user_id (int, optional): ID użytkownika importującego
            overwrite_existing (bool): Czy nadpisywać istniejące
            
        Returns:
            Dict[str, bool]: Wyniki importu per klucz
        """
        results = {}
        
        if 'configs' not in import_data:
            logger.error("Brak sekcji 'configs' w danych importu")
            return results
        
        for key, config_data in import_data['configs'].items():
            try:
                # Sprawdzenie czy konfiguracja już istnieje
                if not overwrite_existing and key in self.get_all_configs():
                    logger.debug("Pomijam istniejącą konfigurację", extra={'key': key})
                    results[key] = False
                    continue
                
                success = self.set_config(
                    key=key,
                    value=config_data['value'],
                    user_id=user_id,
                    description=config_data.get('description'),
                    config_type=config_data.get('type', 'string')
                )
                
                results[key] = success
                
            except Exception as e:
                logger.error("Błąd importu konfiguracji", extra={
                    'key': key,
                    'error': str(e)
                })
                results[key] = False
        
        success_count = sum(1 for success in results.values() if success)
        
        logger.info("Zakończono import konfiguracji", extra={
            'total_configs': len(results),
            'success_count': success_count,
            'user_id': user_id,
            'overwrite_existing': overwrite_existing
        })
        
        return results
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """
        Pobiera statystyki cache
        
        Returns:
            Dict[str, Any]: Statystyki cache
        """
        with self._lock:
            now = datetime.now()
            valid_entries = 0
            
            for key in self._cache_timestamps:
                if (now - self._cache_timestamps[key]) < self.cache_duration:
                    valid_entries += 1
            
            return {
                'total_entries': len(self._config_cache),
                'valid_entries': valid_entries,
                'expired_entries': len(self._config_cache) - valid_entries,
                'cache_duration_minutes': self.cache_duration.total_seconds() / 60,
                'oldest_entry': min(self._cache_timestamps.values()).isoformat() if self._cache_timestamps else None,
                'newest_entry': max(self._cache_timestamps.values()).isoformat() if self._cache_timestamps else None
            }

# Singleton instance dla globalnego dostępu
_config_service_instance = None
_instance_lock = threading.Lock()

def get_config_service() -> ProductionConfigService:
    """
    Pobiera singleton instance ProductionConfigService
    
    Returns:
        ProductionConfigService: Instancja serwisu
    """
    global _config_service_instance
    
    if _config_service_instance is None:
        with _instance_lock:
            if _config_service_instance is None:
                _config_service_instance = ProductionConfigService()
                logger.info("Utworzono singleton ProductionConfigService")
    
    return _config_service_instance

# Funkcje pomocnicze dla szybkiego dostępu
def get_config(key: str, default: Any = None, station_type: Optional[str] = None) -> Any:
    """Helper function dla pobierania konfiguracji"""
    return get_config_service().get_config(key, default, station_type)

def set_config(key: str, value: Any, user_id: Optional[int] = None) -> bool:
    """Helper function dla ustawiania konfiguracji"""
    return get_config_service().set_config(key, value, user_id)

def invalidate_config_cache():
    """Helper function dla invalidacji cache"""
    get_config_service().invalidate_cache()