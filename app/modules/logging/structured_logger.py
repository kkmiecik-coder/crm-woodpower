# modules/logging/structured_logger.py
"""
Wrapper dla standardowego loggera obsługujący strukturalne logowanie
"""

import logging
import json
from typing import Any, Dict


class StructuredLogger:
    """Logger wrapper obsługujący dodatkowe parametry kontekstowe"""
    
    def __init__(self, logger: logging.Logger):
        self._logger = logger
    
    def _format_message(self, message: str, **kwargs) -> str:
        """Formatuje wiadomość z dodatkowymi parametrami"""
        if not kwargs:
            return message
        
        # Konwertuj wszystkie wartości na stringi
        formatted_kwargs = {}
        for key, value in kwargs.items():
            if isinstance(value, (dict, list)):
                formatted_kwargs[key] = json.dumps(value, ensure_ascii=False)
            else:
                formatted_kwargs[key] = str(value)
        
        # Buduj suffiks z parametrami
        params_str = " ".join([f"{k}={v}" for k, v in formatted_kwargs.items()])
        return f"{message} {params_str}"
    
    def debug(self, message: str, **kwargs):
        """Log debug z dodatkowymi parametrami"""
        formatted_msg = self._format_message(message, **kwargs)
        self._logger.debug(formatted_msg)
    
    def info(self, message: str, **kwargs):
        """Log info z dodatkowymi parametrami"""
        formatted_msg = self._format_message(message, **kwargs)
        self._logger.info(formatted_msg)
    
    def warning(self, message: str, **kwargs):
        """Log warning z dodatkowymi parametrami"""
        formatted_msg = self._format_message(message, **kwargs)
        self._logger.warning(formatted_msg)
    
    def error(self, message: str, **kwargs):
        """Log error z dodatkowymi parametrami"""
        formatted_msg = self._format_message(message, **kwargs)
        self._logger.error(formatted_msg)
    
    def critical(self, message: str, **kwargs):
        """Log critical z dodatkowymi parametrami"""
        formatted_msg = self._format_message(message, **kwargs)
        self._logger.critical(formatted_msg)
    
    # Przekieruj inne metody na standardowy logger
    def __getattr__(self, name):
        return getattr(self._logger, name)