import os
import sys
import imp

# Logujemy aktualny interpreter i sys.path
sys.stderr.write(">>> passenger_wsgi.py: start\n")
sys.stderr.write(">>> sys.executable: " + sys.executable + "\n")
sys.stderr.write(">>> sys.version: " + sys.version + "\n")
sys.stderr.write(">>> sys.path: " + str(sys.path) + "\n")

# Aktywacja środowiska wirtualnego
venv_path = '/home/woodpower/virtualenv/domains/crm.woodpower.pl/public_html/3.9'
activate_this = os.path.join(venv_path, 'bin', 'activate_this.py')
if os.path.exists(activate_this):
    sys.stderr.write(">>> passenger_wsgi.py: found activate_this.py, activating venv\n")
    with open(activate_this) as f:
        exec(f.read(), {'__file__': activate_this})
    sys.stderr.write(">>> passenger_wsgi.py: venv activated\n")
else:
    sys.stderr.write(">>> passenger_wsgi.py: activate_this.py not found at " + activate_this + "\n")

# Logujemy ponownie, żeby sprawdzić, czy zmienił się sys.executable oraz sys.path
sys.stderr.write(">>> After venv activation:\n")
sys.stderr.write(">>> sys.executable: " + sys.executable + "\n")
sys.stderr.write(">>> sys.path: " + str(sys.path) + "\n")

# Dodajemy katalog aplikacji do sys.path
app_dir = os.path.dirname(__file__)
sys.stderr.write(">>> Adding app directory to sys.path: " + app_dir + "\n")
sys.path.insert(0, app_dir)

# Ładujemy aplikację
sys.stderr.write(">>> Loading app.py\n")
wsgi = imp.load_source('wsgi', 'app.py')
application = wsgi.app
sys.stderr.write(">>> Application loaded, passenger_wsgi.py: end\n")
