from flask import Blueprint

# Tworzenie blueprint dla modułu production
production_bp = Blueprint(
    'production',
    __name__,
    template_folder='templates',
    static_folder='static',
    static_url_path='/production/static'
)

# Import routerów (musi być na końcu, żeby uniknąć circular imports)
from . import routers