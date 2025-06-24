# test_logging.py
"""
Skrypt testowy do sprawdzenia działania nowego systemu logowania
Uruchom z katalogu głównego aplikacji: python test_logging.py
"""

import os
import sys
from datetime import datetime

# Dodaj ścieżkę do modułów
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

def test_logging_system():
    """Test podstawowej funkcjonalności systemu logowania"""
    
    print("=== TEST SYSTEMU LOGOWANIA ===")
    
    # Test 1: Import modułu
    try:
        from modules.logging import AppLogger, get_logger, LogConfig
        print("✅ Import modułu logowania - OK")
    except ImportError as e:
        print(f"❌ Błąd importu: {e}")
        return False
    
    # Test 2: Konfiguracja
    try:
        AppLogger.setup()
        print("✅ Konfiguracja systemu - OK")
    except Exception as e:
        print(f"❌ Błąd konfiguracji: {e}")
        return False
    
    # Test 3: Tworzenie katalogu logów
    try:
        LogConfig.ensure_log_dir()
        if os.path.exists(LogConfig.LOG_DIR):
            print(f"✅ Katalog logów utworzony: {LogConfig.LOG_DIR}")
        else:
            print(f"❌ Katalog logów nie istnieje: {LogConfig.LOG_DIR}")
            return False
    except Exception as e:
        print(f"❌ Błąd tworzenia katalogu: {e}")
        return False
    
    # Test 4: Pobieranie loggera i test logowania
    try:
        logger = get_logger('test.module')
        
        # Test różnych poziomów logowania
        logger.debug("Test wiadomości DEBUG")
        logger.info("Test wiadomości INFO")
        logger.warning("Test wiadomości WARNING")
        logger.error("Test wiadomości ERROR")
        logger.critical("Test wiadomości CRITICAL")
        
        print("✅ Testowe logi zapisane")
    except Exception as e:
        print(f"❌ Błąd logowania: {e}")
        return False
    
    # Test 5: Sprawdzenie czy plik logu został utworzony
    try:
        log_file = LogConfig.get_log_filepath()
        if os.path.exists(log_file):
            file_size = os.path.getsize(log_file)
            print(f"✅ Plik logu utworzony: {log_file} ({file_size} bajtów)")
            
            # Pokaż zawartość
            with open(log_file, 'r', encoding='utf-8') as f:
                content = f.read()
                print("\n--- ZAWARTOŚĆ PLIKU LOGU ---")
                print(content)
                print("--- KONIEC ZAWARTOŚCI ---\n")
        else:
            print(f"❌ Plik logu nie istnieje: {log_file}")
            return False
    except Exception as e:
        print(f"❌ Błąd sprawdzania pliku: {e}")
        return False
    
    # Test 6: Test API endpoints (bez Flask context)
    try:
        from modules.logging.routers import logging_bp
        print("✅ Import endpoints API - OK")
    except ImportError as e:
        print(f"❌ Błąd importu API: {e}")
        return False
    
    print("\n🎉 WSZYSTKIE TESTY PRZESZŁY POMYŚLNIE!")
    print(f"📁 Katalog logów: {LogConfig.LOG_DIR}")
    print(f"📄 Aktualny plik logu: {LogConfig.get_log_filepath()}")
    return True

if __name__ == "__main__":
    test_logging_system()