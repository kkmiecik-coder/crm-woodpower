# database_config.py
# Zoptymalizowana konfiguracja połączeń z bazą danych

import os
from sqlalchemy import create_engine, event, pool
from sqlalchemy.pool import NullPool, QueuePool
import logging

logger = logging.getLogger(__name__)

class DatabaseConfig:
    """Konfiguracja połączeń z bazą danych z obsługą reconnect"""
    
    @staticmethod
    def get_database_uri():
        """Pobiera URI bazy danych z zmiennych środowiskowych lub konfiguracji"""
        # Możesz dostosować te wartości do swojej konfiguracji
        db_host = os.environ.get('DB_HOST', 'localhost')
        db_port = os.environ.get('DB_PORT', '3306')
        db_name = os.environ.get('DB_NAME', 'your_database')
        db_user = os.environ.get('DB_USER', 'your_user')
        db_pass = os.environ.get('DB_PASSWORD', 'your_password')
        
        # Dodaj parametry dla lepszej stabilności połączenia
        connection_params = [
            'charset=utf8mb4',
            'connect_timeout=10',
            'read_timeout=30',
            'write_timeout=30',
            'max_allowed_packet=67108864',  # 64MB
            'autocommit=true'
        ]
        
        params_str = '&'.join(connection_params)
        
        return f"mysql+pymysql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}?{params_str}"
    
    @staticmethod
    def create_engine_with_reconnect(uri=None, **kwargs):
        """Tworzy engine z automatycznym reconnect"""
        
        if uri is None:
            uri = DatabaseConfig.get_database_uri()
        
        # Domyślne parametry dla engine
        engine_params = {
            'pool_size': 5,  # Zmniejszona liczba połączeń
            'max_overflow': 10,  # Maksymalnie 15 połączeń łącznie
            'pool_timeout': 30,  # Timeout oczekiwania na połączenie
            'pool_recycle': 3600,  # Recykling połączeń co godzinę
            'pool_pre_ping': True,  # Sprawdzanie połączenia przed użyciem
            'echo': False,  # Wyłącz echo SQL w produkcji
            'connect_args': {
                'connect_timeout': 10,
                'read_timeout': 30,
                'write_timeout': 30,
                'charset': 'utf8mb4',
                'use_unicode': True,
            }
        }
        
        # Aktualizuj parametry przekazanymi wartościami
        engine_params.update(kwargs)
        
        # Utwórz engine
        engine = create_engine(uri, **engine_params)
        
        # Dodaj listener dla automatycznego reconnect
        @event.listens_for(engine, "connect")
        def receive_connect(dbapi_conn, connection_record):
            connection_record.info['pid'] = os.getpid()
            logger.info(f"Nowe połączenie z bazą danych utworzone (PID: {os.getpid()})")
        
        @event.listens_for(engine, "checkout")
        def receive_checkout(dbapi_conn, connection_record, connection_proxy):
            pid = os.getpid()
            if connection_record.info['pid'] != pid:
                connection_record.connection = connection_proxy.connection = None
                raise pool.DisconnectionError(
                    f"Połączenie było własnością PID {connection_record.info['pid']}, "
                    f"próba użycia przez PID {pid}"
                )
        
        @event.listens_for(engine.pool, "connect")
        def ping_connection(dbapi_conn, connection_record):
            """Ping połączenia przy każdym checkout z pool"""
            old_isolation = dbapi_conn.isolation_level
            dbapi_conn.isolation_level = 0
            try:
                # Testuj połączenie
                dbapi_conn.cursor().execute("SELECT 1")
            except:
                # Połączenie jest martwe, zgłoś to
                logger.warning("Wykryto martwe połączenie, oznaczam do recyklingu")
                # Invalidate the connection
                connection_record.invalidate()
                # Rzuć DisconnectionError, żeby pool wiedział o problemie
                raise pool.DisconnectionError("Połączenie z bazą danych utracone")
            finally:
                dbapi_conn.isolation_level = old_isolation
        
        return engine
    
    @staticmethod
    def get_flask_sqlalchemy_config():
        """Zwraca konfigurację dla Flask-SQLAlchemy"""
        return {
            'SQLALCHEMY_DATABASE_URI': DatabaseConfig.get_database_uri(),
            'SQLALCHEMY_ENGINE_OPTIONS': {
                'pool_size': 5,
                'max_overflow': 10,
                'pool_timeout': 30,
                'pool_recycle': 3600,
                'pool_pre_ping': True,
                'connect_args': {
                    'connect_timeout': 10,
                    'read_timeout': 30,
                    'write_timeout': 30,
                    'charset': 'utf8mb4',
                    'use_unicode': True,
                }
            },
            'SQLALCHEMY_TRACK_MODIFICATIONS': False,
            'SQLALCHEMY_ECHO': False,
        }
    
    @staticmethod
    def init_app(app):
        """Inicjalizuje aplikację Flask z konfiguracją bazy danych"""
        
        # Ustaw konfigurację
        db_config = DatabaseConfig.get_flask_sqlalchemy_config()
        for key, value in db_config.items():
            app.config[key] = value
        
        # Dodaj funkcję zamykania sesji
        @app.teardown_appcontext
        def shutdown_session(exception=None):
            """Bezpieczne zamykanie sesji"""
            try:
                if hasattr(app, 'db'):
                    # Najpierw commit lub rollback
                    if exception is None:
                        try:
                            app.db.session.commit()
                        except:
                            app.db.session.rollback()
                    else:
                        app.db.session.rollback()
                    
                    # Następnie zamknij sesję
                    app.db.session.remove()
                    
            except Exception as e:
                logger.error(f"Błąd podczas zamykania sesji: {e}")
        
        logger.info("Konfiguracja bazy danych zainicjalizowana")
        
        return app