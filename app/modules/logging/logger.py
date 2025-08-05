# modules/logging/logger.py
"""
Główne klasy systemu logowania
"""

import logging
import logging.handlers
import os
import glob
from datetime import datetime, timedelta
from flask import request, session, has_request_context
from .config import LogConfig


class CustomFormatter(logging.Formatter):
    """Custom formatter z kontekstem Flask"""
    
    def format(self, record):
        # Pobierz kontekst z Flask (jeśli dostępny)
        user = 'system'
        endpoint = '-'
        
        if has_request_context():
            try:
                # Pobierz użytkownika z sesji
                if session and 'user_email' in session:
                    user = session['user_email']
                
                # Pobierz endpoint
                if request and request.endpoint:
                    endpoint = request.endpoint
                elif request and request.path:
                    endpoint = request.path
                    
            except RuntimeError:
                # Poza kontekstem aplikacji
                pass
        
        # Pobierz nazwę modułu z logger name
        module = record.name
        if module.startswith('app.'):
            module = module[4:]  # Usuń prefiks 'app.'
        
        # Formatuj timestamp
        timestamp = datetime.fromtimestamp(record.created).strftime(LogConfig.TIMESTAMP_FORMAT)
        
        # Buduj sformatowany komunikat
        formatted_message = LogConfig.LOG_FORMAT.format(
            timestamp=timestamp,
            level=record.levelname,
            module=module,
            user=user,
            endpoint=endpoint,
            message=record.getMessage()
        )
        
        return formatted_message

class TimedRotatingFileHandlerWithCleanup(logging.handlers.TimedRotatingFileHandler):
    """Handler z automatycznym czyszczeniem starych logów"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.cleanup_old_logs()
    
    def doRollover(self):
        """Override rollover aby dodać cleanup"""
        super().doRollover()
        self.cleanup_old_logs()
    
    def cleanup_old_logs(self):
        """Usuwa logi starsze niż RETENTION_DAYS"""
        try:
            cutoff_date = datetime.now() - timedelta(days=LogConfig.RETENTION_DAYS)
            pattern = os.path.join(LogConfig.LOG_DIR, 'app_*.log')
            
            for log_file in glob.glob(pattern):
                try:
                    # Wyciągnij datę z nazwy pliku
                    filename = os.path.basename(log_file)
                    if filename.startswith('app_') and filename.endswith('.log'):
                        date_str = filename[4:-4]  # Usuń 'app_' i '.log'
                        file_date = datetime.strptime(date_str, '%Y-%m-%d')
                        
                        if file_date < cutoff_date:
                            os.remove(log_file)
                            print(f"[LogCleanup] Usunięto stary log: {log_file}")
                            
                except (ValueError, OSError) as e:
                    print(f"[LogCleanup] Błąd podczas usuwania {log_file}: {e}")
                    
        except Exception as e:
            print(f"[LogCleanup] Błąd podczas czyszczenia logów: {e}")

class AppLogger:
    """Główna klasa systemu logowania"""
    
    _instance = None
    _configured = False
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    @classmethod
    def setup(cls):
        """Konfiguruje system logowania dla całej aplikacji"""
        if cls._configured:
            return
        
        # Upewnij się, że katalog logów istnieje
        LogConfig.ensure_log_dir()
        
        # Pobierz root logger
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.DEBUG)
        
        # Usuń istniejące handlery
        for handler in root_logger.handlers[:]:
            root_logger.removeHandler(handler)
        
        # Utwórz handler z rotacją dzienną
        log_file = LogConfig.get_log_filepath()
        handler = TimedRotatingFileHandlerWithCleanup(
            filename=log_file,
            when=LogConfig.ROTATION_TIME,
            interval=LogConfig.ROTATION_INTERVAL,
            backupCount=LogConfig.RETENTION_DAYS,
            encoding='utf-8'
        )
        
        # Ustaw formatter
        formatter = CustomFormatter()
        handler.setFormatter(formatter)
        
        # Dodaj handler do root loggera
        root_logger.addHandler(handler)
        
        # Dodaj console handler dla development
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        console_handler.setLevel(logging.INFO)
        root_logger.addHandler(console_handler)
        
        cls._configured = True
        
        # Log pierwszej wiadomości
        logger = logging.getLogger('app.logging')
        logger.info("System logowania uruchomiony")
    
    @classmethod
    def get_logger(cls, module_name):
        """Zwraca logger dla konkretnego modułu"""
        if not cls._configured:
            cls.setup()
        
        return logging.getLogger(f'app.{module_name}')

# Pomocnicza funkcja dla łatwego dostępu
def get_logger(module_name):
    """
    Pobiera logger dla modułu
    
    Args:
        module_name (str): Nazwa modułu (np. 'baselinker.service')
    
    Returns:
        logging.Logger: Skonfigurowany logger
    """
    return AppLogger.get_logger(module_name)