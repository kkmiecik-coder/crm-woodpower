# modules/production/__init__.py
"""
Moduł Produkcyjny - Wood Power CRM
Odpowiedzialny za zarządzanie produkcją lat drewnianych na stanowiskach sklejania i pakowania
"""

from flask import Blueprint

# Utworzenie Blueprint dla modułu production
production_bp = Blueprint(
    "production", 
    __name__,
    template_folder="templates",
    static_folder="static",
    url_prefix="/production"
)

# Import routingu po utworzeniu Blueprint (unikamy circular imports)
from . import routers

# Eksportujemy Blueprint dla łatwego importu w głównej aplikacji
__all__ = ['production_bp']