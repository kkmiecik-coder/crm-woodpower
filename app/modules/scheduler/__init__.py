from flask import Blueprint

# Tworzenie blueprint
scheduler_bp = Blueprint(
    'scheduler', 
    __name__, 
    template_folder='templates',
    static_folder='static',
    static_url_path='/scheduler/static',
    url_prefix='/scheduler'
)

# WAŻNE: Import routers na końcu żeby uniknąć circular imports
from . import routers  # <-- Ta linia musi być!