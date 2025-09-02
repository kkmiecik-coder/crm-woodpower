from flask import Blueprint

# Tworzenie Flask Blueprint
register_bp = Blueprint('register', __name__, 
                        url_prefix='/register',
                        template_folder='templates', 
                        static_folder='static')

# Import routerów aby zarejestrować endpointy
# Importujemy na końcu pliku, aby uniknąć cyklicznych importów
from . import routers, models