import os
import sys
from datetime import datetime

print(">>> passenger_wsgi.py: start", file=sys.stderr)
print(f">>> sys.executable: {sys.executable}", file=sys.stderr)
print(f">>> sys.version: {sys.version}", file=sys.stderr)
print(f">>> startup time: {datetime.now()}", file=sys.stderr)

# Przekieruj stdout do stderr (ważne dla Passenger)
sys.stdout = sys.stderr

try:
    # Aktywacja virtualenv
    activate_this = '/home/woodpower/virtualenv/domains/crm.woodpower.pl/public_html/3.9/bin/activate_this.py'
    if os.path.exists(activate_this):
        print(">>> passenger_wsgi.py: found activate_this.py, activating venv", file=sys.stderr)
        exec(open(activate_this).read(), {'__file__': activate_this})
        print(">>> passenger_wsgi.py: venv activated", file=sys.stderr)
    else:
        print(f">>> passenger_wsgi.py: activate_this.py not found at {activate_this}", file=sys.stderr)

    # Dodaj katalog app do sys.path
    app_dir = os.path.dirname(__file__)
    if app_dir not in sys.path:
        sys.path.insert(0, app_dir)
        print(f">>> passenger_wsgi.py: added app_dir to path: {app_dir}", file=sys.stderr)

    print(">>> Loading app.py", file=sys.stderr)
    
    # ZMIANA: Używaj importlib zamiast przestarzałego imp
    import importlib.util
    
    spec = importlib.util.spec_from_file_location("app", "app.py")
    if spec is None:
        raise ImportError("Nie można załadować specyfikacji dla app.py")
    
    app_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(app_module)
    
    # Pobierz aplikację z modułu
    application = app_module.app
    
    print(">>> passenger_wsgi.py: aplikacja załadowana pomyślnie", file=sys.stderr)
    print(f">>> passenger_wsgi.py: application type: {type(application)}", file=sys.stderr)

except Exception as e:
    print(f">>> passenger_wsgi.py: KRYTYCZNY BŁĄD podczas ładowania aplikacji: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc(file=sys.stderr)
    
    # Spróbuj fallback - stary sposób ale z obsługą błędów
    try:
        print(">>> passenger_wsgi.py: próba fallback z exec", file=sys.stderr)
        import imp
        wsgi = imp.load_source('wsgi', 'app.py')
        application = wsgi.app
        print(">>> passenger_wsgi.py: fallback udany", file=sys.stderr)
    except Exception as fallback_error:
        print(f">>> passenger_wsgi.py: FALLBACK FAILED: {fallback_error}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise

print(f">>> passenger_wsgi.py: zakończono pomyślnie ({datetime.now()})", file=sys.stderr)