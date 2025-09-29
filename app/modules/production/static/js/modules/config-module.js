/**
 * Config Module - Moduł zarządzania konfiguracją
 * static/js/config-module.js
<<<<<<< Updated upstream
 * WERSJA 2.0 - Z POPRAWKAMI ŚLEDZENIA ZMIAN
 * 
 * Zarządza interfejsem konfiguracji systemu produkcyjnego:
 * - Śledzenie zmian konfiguracji z porównaniem do oryginału
=======
 * 
 * Zarządza interfejsem konfiguracji systemu produkcyjnego:
 * - Śledzenie zmian konfiguracji
>>>>>>> Stashed changes
 * - Zarządzanie listą IP
 * - Walidacja danych
 * - Zapisywanie zmian
 * - Reset do wartości domyślnych
 */

class ConfigModule {
    constructor() {
        this.pendingChanges = {};
        this.changesCount = 0;
        this.isInitialized = false;

<<<<<<< Updated upstream
        // KLUCZOWE: Przechowywanie oryginalnych wartości z bazy danych
        this.originalValues = {};

        // Debug mode
        this.debug = true;

=======
>>>>>>> Stashed changes
        // Wartości domyślne dla konfiguracji
        this.defaultValues = {
            'SYNC_ENABLED': true,
            'MAX_SYNC_ITEMS_PER_BATCH': 1000,
            'BASELINKER_TARGET_STATUS_COMPLETED': 138623,
            'BASELINKER_SOURCE_STATUS_PAID': 155824,
            'BASELINKER_TARGET_STATUS_PRODUCTION': 138619,
            'SYNC_RETRY_COUNT': 3,
            'STATION_ALLOWED_IPS': '192.168.1.100,192.168.1.101,192.168.1.102',
            'REFRESH_INTERVAL_SECONDS': 30,
            'STATION_AUTO_REFRESH_ENABLED': true,
            'STATION_SHOW_DETAILED_INFO': true,
            'STATION_MAX_PRODUCTS_DISPLAY': 50,
            'DEADLINE_DEFAULT_DAYS': 14,
            'PRIORITY_RECALC_INTERVAL_HOURS': 24,
            'PRIORITY_ALGORITHM_VERSION': '2.0',
            'DEBUG_PRODUCTION_BACKEND': false,
            'DEBUG_PRODUCTION_FRONTEND': false,
            'CACHE_DURATION_SECONDS': 3600,
            'ADMIN_EMAIL_NOTIFICATIONS': 'admin@woodpower.pl',
            'ERROR_NOTIFICATION_THRESHOLD': 10,
            'BASELINKER_STATUSES_CACHE': '{"id": 105112, "name": "Nowe - opłacone", "color": "ffffff"}',
            'MAX_PRODUCTS_PER_ORDER': 999,
            'STATION_IP_CACHE_DURATION_MINUTES': 10,
            'STATION_CUTTING_PRIORITY_SORT': 'priority_rank',
            'STATION_ASSEMBLY_PRIORITY_SORT': 'priority_rank',
            'STATION_PACKAGING_PRIORITY_SORT': 'priority_rank'
        };

<<<<<<< Updated upstream
        console.log('[ConfigModule v2.0] Instance created');
=======
        console.log('[ConfigModule] Instance created');
>>>>>>> Stashed changes
    }

    /**
     * Inicjalizacja modułu
     */
    init() {
        if (this.isInitialized) {
            console.log('[ConfigModule] Already initialized');
            return;
        }

<<<<<<< Updated upstream
        console.log('[ConfigModule] Initializing v2.0...');

        try {
            // Inicjalizacja podstawowych komponentów (bez ładowania wartości!)
=======
        console.log('[ConfigModule] Initializing...');

        try {
            // Inicjalizacja podstawowych komponentów
>>>>>>> Stashed changes
            this.initIPManagement();
            this.initJSONValidation();
            this.initSwitchLabels();
            this.initEventListeners();

<<<<<<< Updated upstream
            // Reset stanu - upewnij się że bar jest ukryty na start
            this.resetPendingChanges();
            this.hideSaveBar();

            // NIE ŁADUJEMY tutaj originalValues!
            // To będzie zrobione ręcznie przez production-app-loader.js po załadowaniu AJAX

            this.isInitialized = true;
            console.log('[ConfigModule] ✅ Initialized successfully (waiting for DOM to load original values)');

        } catch (error) {
            console.error('[ConfigModule] ❌ Initialization failed:', error);
=======
            // Reset stanu
            this.resetPendingChanges();

            this.isInitialized = true;
            console.log('[ConfigModule] Initialized successfully');

        } catch (error) {
            console.error('[ConfigModule] Initialization failed:', error);
>>>>>>> Stashed changes
        }
    }

    /**
<<<<<<< Updated upstream
     * PUBLICZNA METODA: Ładowanie oryginalnych wartości
     * WYWOŁANA RĘCZNIE przez production-app-loader.js PO załadowaniu AJAX contentu
     */
    loadOriginalValuesFromDOM() {
        console.log('[ConfigModule] 📥 loadOriginalValuesFromDOM() called by external trigger');
        this.loadOriginalValues();
    }

    /**
     * KLUCZOWE: Ładowanie oryginalnych wartości z DOM
     * WYWOŁANE Z OPÓŹNIENIEM po załadowaniu HTML przez AJAX
     */
    loadOriginalValues() {
        console.log('[ConfigModule] 📥 Scheduling loadOriginalValues...');

        // Czekaj aż DOM będzie gotowy (content ładowany przez AJAX)
        const attemptLoad = (retryCount = 0) => {
            console.log(`[ConfigModule] Attempt ${retryCount + 1} to load original values...`);

            // Mapowanie pól formularza na klucze konfiguracji
            const fieldMappings = {
                'sync_enabled': 'SYNC_ENABLED',
                'max_sync_items': 'MAX_SYNC_ITEMS_PER_BATCH',
                'baselinker_completed': 'BASELINKER_TARGET_STATUS_COMPLETED',
                // 'baselinker_paid': 'BASELINKER_SOURCE_STATUS_PAID', // NIE ISTNIEJE W HTML
                // 'baselinker_production': 'BASELINKER_TARGET_STATUS_PRODUCTION', // NIE ISTNIEJE W HTML
                'sync_retry': 'SYNC_RETRY_COUNT',
                'refresh_interval': 'REFRESH_INTERVAL_SECONDS',
                'station_auto_refresh': 'STATION_AUTO_REFRESH_ENABLED',
                // 'station_show_details': 'STATION_SHOW_DETAILED_INFO', // NIE ISTNIEJE W HTML
                'station_max_products': 'STATION_MAX_PRODUCTS_DISPLAY',
                'deadline_days': 'DEADLINE_DEFAULT_DAYS',
                'priority_recalc': 'PRIORITY_RECALC_INTERVAL_HOURS',
                'priority_version': 'PRIORITY_ALGORITHM_VERSION',
                'debug_backend': 'DEBUG_PRODUCTION_BACKEND',
                'debug_frontend': 'DEBUG_PRODUCTION_FRONTEND',
                'cache_duration': 'CACHE_DURATION_SECONDS',
                'admin_email': 'ADMIN_EMAIL_NOTIFICATIONS',
                'error_threshold': 'ERROR_NOTIFICATION_THRESHOLD',
                'baselinker_cache': 'BASELINKER_STATUSES_CACHE',
                'max_products_order': 'MAX_PRODUCTS_PER_ORDER'
            };

            let foundCount = 0;

            // Pobierz wartości ze wszystkich pól formularza
            for (const [fieldId, configKey] of Object.entries(fieldMappings)) {
                const field = document.getElementById(fieldId);
                if (field) {
                    foundCount++;
                    if (field.type === 'checkbox') {
                        this.originalValues[configKey] = field.checked;
                    } else {
                        this.originalValues[configKey] = field.value;
                    }

                    if (this.debug) {
                        console.log(`[ConfigModule] 📌 Loaded ${configKey}:`, this.originalValues[configKey], `(from #${fieldId})`);
                    }
                } else {
                    if (this.debug) {
                        console.warn(`[ConfigModule] ⚠️ Field not found: #${fieldId} for ${configKey}`);
                    }
                }
            }

            // Specjalne traktowanie dla STATION_ALLOWED_IPS
            const ipList = this.getCurrentIPList();
            if (ipList.length > 0) {
                this.originalValues['STATION_ALLOWED_IPS'] = ipList.join(',');
                foundCount++;
            }

            console.log(`[ConfigModule] Found ${foundCount} / ${Object.keys(fieldMappings).length} fields`);

            // Jeśli nie znaleziono żadnych pól i mamy retry, spróbuj ponownie
            if (foundCount === 0 && retryCount < 5) {
                console.warn(`[ConfigModule] ⚠️ NO FIELDS FOUND! Retry ${retryCount + 1}/5 in 200ms...`);
                setTimeout(() => attemptLoad(retryCount + 1), 200);
                return;
            }

            // Sukces lub max retry
            if (foundCount > 0) {
                console.log(`[ConfigModule] ✅ Original values loaded successfully: ${Object.keys(this.originalValues).length} configs`);
                if (this.debug) {
                    console.log('[ConfigModule] 🔍 DEBUG: All original values:', this.originalValues);
                }
            } else {
                console.error('[ConfigModule] ❌ FAILED to load original values after 5 attempts!');
                console.error('[ConfigModule] DOM might not contain config fields. Check if config-tab-content.html loaded correctly.');
            }
        };

        // Rozpocznij ładowanie z małym opóźnieniem
        setTimeout(() => attemptLoad(0), 150);
    }

    /**
=======
>>>>>>> Stashed changes
     * Inicjalizacja event listeners
     */
    initEventListeners() {
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+S = Zapisz zmiany
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                if (this.changesCount > 0) {
                    this.saveAllChanges();
                }
            }

            // Escape = Anuluj zmiany
            if (e.key === 'Escape') {
                if (this.changesCount > 0) {
                    this.discardChanges();
                }
            }
        });

        console.log('[ConfigModule] Event listeners initialized');
    }

    /**
     * Inicjalizacja zarządzania IP
     */
    initIPManagement() {
        const ipInput = document.getElementById('new-ip-input');
        if (ipInput) {
            // Enter = dodaj IP
            ipInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.addIP();
                }
            });

            // Walidacja w czasie rzeczywistym
            ipInput.addEventListener('input', (e) => {
                this.validateIPInput(e.target);
            });
        }

        console.log('[ConfigModule] IP management initialized');
    }

    /**
     * Inicjalizacja walidacji JSON
     */
    initJSONValidation() {
        const jsonEditors = document.querySelectorAll('.json-editor');
        jsonEditors.forEach(editor => {
            this.validateJSON(editor);
        });

        console.log('[ConfigModule] JSON validation initialized');
    }

    /**
     * Inicjalizacja etykiet switch
     */
    initSwitchLabels() {
        document.querySelectorAll('.form-check-input[type="checkbox"]').forEach(checkbox => {
            this.updateSwitchLabel(checkbox);
            checkbox.addEventListener('change', () => {
                this.updateSwitchLabel(checkbox);
            });
        });

        console.log('[ConfigModule] Switch labels initialized');
    }

    /**
<<<<<<< Updated upstream
     * KLUCZOWE: Śledzenie zmian konfiguracji z porównaniem do oryginału
     */
    configChanged(key, value) {
        console.log('═══════════════════════════════════════════');
        console.log('[ConfigModule] 🔄 Configuration change detected');
        console.log('Key:', key);
        console.log('New value:', value, 'Type:', typeof value);

        // Pobierz oryginalną wartość
        const originalValue = this.originalValues[key];
        console.log('Original value:', originalValue, 'Type:', typeof originalValue);

        // Normalizacja wartości do porównania
        const normalizedValue = this.normalizeValue(value);
        const normalizedOriginal = this.normalizeValue(originalValue);

        console.log('After normalization:');
        console.log('  New:', normalizedValue, 'Type:', typeof normalizedValue);
        console.log('  Original:', normalizedOriginal, 'Type:', typeof normalizedOriginal);
        console.log('  Are equal?', normalizedValue === normalizedOriginal);

        // Sprawdź czy wartość wróciła do oryginału
        if (normalizedValue === normalizedOriginal) {
            // Usuń z pending changes jeśli istnieje
            if (this.pendingChanges.hasOwnProperty(key)) {
                delete this.pendingChanges[key];
                console.log('✅ Value returned to original → REMOVED from pending changes');
            } else {
                console.log('ℹ️  Value equals original → NOT in pending changes');
            }
            // Usuń highlight z pola
            this.removeFieldHighlight(key);
        } else {
            // Wartość się różni od oryginału, dodaj do pending changes
            this.pendingChanges[key] = value;
            console.log('📝 Value differs from original → ADDED to pending changes');
            // Dodaj highlight do pola
            this.addFieldHighlight(key);
        }

        // Przelicz liczbę zmian
        this.changesCount = Object.keys(this.pendingChanges).length;
        console.log('📊 Total pending changes:', this.changesCount);
        console.log('Pending changes:', Object.keys(this.pendingChanges));
        console.log('═══════════════════════════════════════════');

        // Aktualizuj UI
        this.updateChangesIndicator();
    }

    /**
     * KLUCZOWE: Normalizacja wartości do porównania
     */
    normalizeValue(value) {
        // Obsługa null/undefined
        if (value === null || value === undefined) {
            return '';
        }

        // Boolean - zwróć bez zmian
        if (typeof value === 'boolean') {
            return value;
        }

        // Konwersja do string i trim
        const strValue = String(value).trim();

        // Próba konwersji na number jeśli wygląda na liczbę
        if (/^\d+$/.test(strValue)) {
            return parseInt(strValue, 10);
        }

        // Próba konwersji na float jeśli ma kropkę
        if (/^\d+\.\d+$/.test(strValue)) {
            return parseFloat(strValue);
        }

        // Próba konwersji na boolean jeśli wygląda na boolean
        if (strValue.toLowerCase() === 'true') return true;
        if (strValue.toLowerCase() === 'false') return false;

        return strValue;
=======
     * Śledzenie zmian konfiguracji
     */
    configChanged(key, value) {
        console.log('[ConfigModule] Configuration changed:', key, '=', value);

        this.pendingChanges[key] = value;
        this.changesCount = Object.keys(this.pendingChanges).length;

        this.updateChangesIndicator();

        // Pokazuj save bar jeśli są zmiany
        this.showSaveBar(this.changesCount > 0);
>>>>>>> Stashed changes
    }

    /**
     * Aktualizacja wskaźnika zmian
     */
    updateChangesIndicator() {
        const saveBar = document.getElementById('config-save-bar');
        const changesCountEl = document.getElementById('changes-count');

<<<<<<< Updated upstream
        console.log('[ConfigModule] 🎨 Updating UI indicator');
        console.log('Changes count:', this.changesCount);

        if (this.changesCount > 0) {
            console.log('→ Showing save bar');
            if (saveBar) saveBar.classList.add('has-changes');
            if (changesCountEl) changesCountEl.textContent = this.changesCount;
        } else {
            console.log('→ Hiding save bar');
=======
        if (this.changesCount > 0) {
            if (saveBar) saveBar.classList.add('has-changes');
            if (changesCountEl) changesCountEl.textContent = this.changesCount;
        } else {
>>>>>>> Stashed changes
            if (saveBar) saveBar.classList.remove('has-changes');
            if (changesCountEl) changesCountEl.textContent = '0';
        }
    }

    /**
<<<<<<< Updated upstream
     * Ukrycie paska zapisywania (force)
     */
    hideSaveBar() {
        const saveBar = document.getElementById('config-save-bar');
        if (saveBar) {
            saveBar.classList.remove('has-changes');
            console.log('[ConfigModule] Save bar hidden');
=======
     * Pokazanie/ukrycie paska zapisywania
     */
    showSaveBar(show) {
        const saveBar = document.getElementById('config-save-bar');
        if (saveBar) {
            saveBar.style.display = show ? 'block' : 'none';
>>>>>>> Stashed changes
        }
    }

    /**
     * Zapisanie wszystkich zmian
     */
    async saveAllChanges() {
        if (this.changesCount === 0) {
            this.showToast('Brak zmian do zapisania', 'info');
            return;
        }

<<<<<<< Updated upstream
        console.log('[ConfigModule] 💾 Saving changes:', this.pendingChanges);
=======
        console.log('[ConfigModule] Saving changes:', this.pendingChanges);
>>>>>>> Stashed changes

        const saveBtn = document.getElementById('btn-save');
        const originalText = saveBtn ? saveBtn.innerHTML : '';

        try {
            // UI feedback
            if (saveBtn) {
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Zapisywanie...';
                saveBtn.disabled = true;
            }

            // API call
            const response = await fetch('/production/api/update-configs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    configs: this.pendingChanges
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }

            if (result.success) {
<<<<<<< Updated upstream
                console.log('[ConfigModule] ✅ Changes saved successfully');
                this.showToast('Konfiguracja zapisana pomyślnie!', 'success');

                // NOWE: Zaktualizuj oryginalne wartości po pomyślnym zapisie
                Object.assign(this.originalValues, this.pendingChanges);
                console.log('[ConfigModule] 📝 Original values updated after save');

                // Wyczyść pending changes i usuń highlighty
                this.resetPendingChanges();
                this.hideSaveBar();
=======
                console.log('[ConfigModule] Changes saved successfully');
                this.showToast('Konfiguracja zapisana pomyślnie!', 'success');

                // Wyczyść pending changes
                this.resetPendingChanges();
>>>>>>> Stashed changes

            } else {
                throw new Error(result.error || 'Nieznany błąd');
            }

        } catch (error) {
<<<<<<< Updated upstream
            console.error('[ConfigModule] ❌ Error saving changes:', error);
=======
            console.error('[ConfigModule] Error saving changes:', error);
>>>>>>> Stashed changes
            this.showToast(`Błąd zapisywania: ${error.message}`, 'error');
        } finally {
            // Przywróć przycisk
            if (saveBtn) {
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
            }
        }
    }

    /**
     * Anulowanie zmian
     */
    discardChanges() {
        if (this.changesCount === 0) return;

        if (confirm('Czy na pewno chcesz anulować wszystkie niezapisane zmiany?')) {
<<<<<<< Updated upstream
            console.log('[ConfigModule] 🔄 Discarding changes - restoring original values');

            // Przywróć każdą wartość z originalValues
            for (const [configKey, originalValue] of Object.entries(this.originalValues)) {
                this.restoreFieldValue(configKey, originalValue);
            }

            // Wyczyść pending changes i usuń highlighty
            this.resetPendingChanges();
            this.hideSaveBar();

            this.showToast('Anulowano wszystkie zmiany', 'info');
=======
            console.log('[ConfigModule] Discarding changes');

            // Przeładuj stronę aby przywrócić oryginalne wartości
            window.location.reload();
>>>>>>> Stashed changes
        }
    }

    /**
<<<<<<< Updated upstream
     * Przywrócenie oryginalnej wartości do pola formularza
     */
    restoreFieldValue(configKey, originalValue) {
        const fieldId = this.getFieldIdFromConfigKey(configKey);
        if (!fieldId) return;

        // Specjalna obsługa dla IP
        if (configKey === 'STATION_ALLOWED_IPS') {
            this.resetIPList(originalValue);
            return;
        }

        const field = document.getElementById(fieldId);
        if (!field) {
            console.warn(`[ConfigModule] Field not found for restore: ${fieldId}`);
            return;
        }

        // Przywróć wartość w zależności od typu pola
        if (field.type === 'checkbox') {
            field.checked = Boolean(originalValue);
            this.updateSwitchLabel(field);
        } else {
            field.value = originalValue;
            // Walidacja JSON jeśli to textarea z JSON
            if (field.classList.contains('json-editor')) {
                this.validateJSON(field);
            }
        }

        console.log(`[ConfigModule] Restored ${configKey} to:`, originalValue);
    }

    /**
=======
>>>>>>> Stashed changes
     * Reset do wartości domyślnych
     */
    resetToDefault(key) {
        if (!confirm(`Czy na pewno chcesz przywrócić domyślną wartość dla ${key}?`)) {
            return;
        }

        const defaultValue = this.defaultValues[key];

        if (defaultValue !== undefined) {
<<<<<<< Updated upstream
            console.log(`[ConfigModule] 🔄 Resetting ${key} to default:`, defaultValue);
=======
            console.log(`[ConfigModule] Resetting ${key} to default:`, defaultValue);
>>>>>>> Stashed changes

            // Aktualizuj pole formularza
            this.updateFormField(key, defaultValue);

            // Śledź zmianę
            this.configChanged(key, defaultValue);

            this.showToast(`Przywrócono domyślną wartość dla ${key}`, 'success');
        } else {
            this.showToast(`Brak zdefiniowanej wartości domyślnej dla ${key}`, 'error');
        }
    }

    /**
     * Aktualizacja pola formularza
     */
    updateFormField(key, value) {
        const fieldMappings = {
            'SYNC_ENABLED': 'sync_enabled',
            'MAX_SYNC_ITEMS_PER_BATCH': 'max_sync_items',
            'BASELINKER_TARGET_STATUS_COMPLETED': 'baselinker_completed',
<<<<<<< Updated upstream
            'BASELINKER_SOURCE_STATUS_PAID': 'baselinker_paid',
            'BASELINKER_TARGET_STATUS_PRODUCTION': 'baselinker_production',
            'SYNC_RETRY_COUNT': 'sync_retry',
            'REFRESH_INTERVAL_SECONDS': 'refresh_interval',
            'STATION_AUTO_REFRESH_ENABLED': 'station_auto_refresh',
            'STATION_SHOW_DETAILED_INFO': 'station_show_details',
=======
            'SYNC_RETRY_COUNT': 'sync_retry',
            'REFRESH_INTERVAL_SECONDS': 'refresh_interval',
            'STATION_AUTO_REFRESH_ENABLED': 'station_auto_refresh',
>>>>>>> Stashed changes
            'STATION_MAX_PRODUCTS_DISPLAY': 'station_max_products',
            'DEADLINE_DEFAULT_DAYS': 'deadline_days',
            'PRIORITY_RECALC_INTERVAL_HOURS': 'priority_recalc',
            'PRIORITY_ALGORITHM_VERSION': 'priority_version',
            'DEBUG_PRODUCTION_BACKEND': 'debug_backend',
            'DEBUG_PRODUCTION_FRONTEND': 'debug_frontend',
            'CACHE_DURATION_SECONDS': 'cache_duration',
            'ADMIN_EMAIL_NOTIFICATIONS': 'admin_email',
            'ERROR_NOTIFICATION_THRESHOLD': 'error_threshold',
            'BASELINKER_STATUSES_CACHE': 'baselinker_cache',
            'MAX_PRODUCTS_PER_ORDER': 'max_products_order'
        };

        const fieldId = fieldMappings[key];
        const field = document.getElementById(fieldId);

        if (field) {
            if (field.type === 'checkbox') {
                field.checked = Boolean(value);
                this.updateSwitchLabel(field);
            } else if (key === 'STATION_ALLOWED_IPS') {
                this.resetIPList(value);
            } else {
                field.value = value;
                if (field.classList.contains('json-editor')) {
                    this.validateJSON(field);
                }
            }
        }
    }

    /**
     * Reset stanu pending changes
     */
    resetPendingChanges() {
        this.pendingChanges = {};
        this.changesCount = 0;
        this.updateChangesIndicator();
<<<<<<< Updated upstream
        // Usuń wszystkie highlighty
        this.removeAllHighlights();
    }

    // ========================================================================
    // VISUAL FEEDBACK - HIGHLIGHTING
    // ========================================================================

    /**
     * Dodanie pomarańczowego obrysu do zmienionego pola
     */
    addFieldHighlight(configKey) {
        const fieldId = this.getFieldIdFromConfigKey(configKey);
        if (!fieldId) return;

        const field = document.getElementById(fieldId);
        if (!field) return;

        // Znajdź rodzica .config-item
        const configItem = field.closest('.config-item');
        if (configItem) {
            configItem.classList.add('config-item-changed');
            console.log(`[ConfigModule] 🎨 Added highlight to ${configKey}`);
        }
    }

    /**
     * Usunięcie pomarańczowego obrysu ze zmienionego pola
     */
    removeFieldHighlight(configKey) {
        const fieldId = this.getFieldIdFromConfigKey(configKey);
        if (!fieldId) return;

        const field = document.getElementById(fieldId);
        if (!field) return;

        // Znajdź rodzica .config-item
        const configItem = field.closest('.config-item');
        if (configItem) {
            configItem.classList.remove('config-item-changed');
            console.log(`[ConfigModule] 🎨 Removed highlight from ${configKey}`);
        }
    }

    /**
     * Usunięcie wszystkich highlightów (np. po zapisie)
     */
    removeAllHighlights() {
        const allHighlighted = document.querySelectorAll('.config-item-changed');
        allHighlighted.forEach(item => {
            item.classList.remove('config-item-changed');
        });
        if (allHighlighted.length > 0) {
            console.log(`[ConfigModule] 🎨 Removed all highlights (${allHighlighted.length} items)`);
        }
    }

    /**
     * Pomocnicza metoda: mapowanie configKey → fieldId
     */
    getFieldIdFromConfigKey(configKey) {
        const reverseMapping = {
            'SYNC_ENABLED': 'sync_enabled',
            'MAX_SYNC_ITEMS_PER_BATCH': 'max_sync_items',
            'BASELINKER_TARGET_STATUS_COMPLETED': 'baselinker_completed',
            'SYNC_RETRY_COUNT': 'sync_retry',
            'REFRESH_INTERVAL_SECONDS': 'refresh_interval',
            'STATION_AUTO_REFRESH_ENABLED': 'station_auto_refresh',
            'STATION_MAX_PRODUCTS_DISPLAY': 'station_max_products',
            'DEADLINE_DEFAULT_DAYS': 'deadline_days',
            'PRIORITY_RECALC_INTERVAL_HOURS': 'priority_recalc',
            'PRIORITY_ALGORITHM_VERSION': 'priority_version',
            'DEBUG_PRODUCTION_BACKEND': 'debug_backend',
            'DEBUG_PRODUCTION_FRONTEND': 'debug_frontend',
            'CACHE_DURATION_SECONDS': 'cache_duration',
            'ADMIN_EMAIL_NOTIFICATIONS': 'admin_email',
            'ERROR_NOTIFICATION_THRESHOLD': 'error_threshold',
            'BASELINKER_STATUSES_CACHE': 'baselinker_cache',
            'MAX_PRODUCTS_PER_ORDER': 'max_products_order',
            'STATION_ALLOWED_IPS': 'ip-list-items' // specjalny case
        };

        return reverseMapping[configKey];
=======
        this.showSaveBar(false);
>>>>>>> Stashed changes
    }

    // ========================================================================
    // IP MANAGEMENT
    // ========================================================================

    /**
     * Dodanie IP do listy
     */
    addIP() {
        const input = document.getElementById('new-ip-input');
        const ip = input.value.trim();

        if (!ip) {
            this.showToast('Wprowadź adres IP', 'error');
            return;
        }

        if (!this.isValidIP(ip)) {
            this.showToast('Nieprawidłowy format adresu IP', 'error');
            return;
        }

        // Sprawdź czy IP już istnieje
        const existingIPs = this.getCurrentIPList();
        if (existingIPs.includes(ip)) {
            this.showToast('Ten adres IP już istnieje na liście', 'error');
            return;
        }

        // Dodaj IP do listy
        this.addIPToList(ip);
        input.value = '';

        // Śledź zmianę
        const newIPList = this.getCurrentIPList().join(',');
        this.configChanged('STATION_ALLOWED_IPS', newIPList);

        console.log('[ConfigModule] Added IP:', ip);
        this.showToast(`Dodano IP: ${ip}`, 'success');
    }

    /**
     * Usunięcie IP z listy
     */
    removeIP(ip) {
        if (!confirm(`Czy na pewno chcesz usunąć IP: ${ip}?`)) {
            return;
        }

        this.removeIPFromList(ip);

        // Śledź zmianę
        const newIPList = this.getCurrentIPList().join(',');
        this.configChanged('STATION_ALLOWED_IPS', newIPList);

        console.log('[ConfigModule] Removed IP:', ip);
        this.showToast(`Usunięto IP: ${ip}`, 'success');
    }

    /**
     * Dodanie IP do DOM
     */
    addIPToList(ip) {
        const container = document.getElementById('ip-list-items');
        if (!container) return;

        const ipItem = document.createElement('div');
        ipItem.className = 'ip-item';
        ipItem.innerHTML = `
            <span class="ip-address">${ip}</span>
<<<<<<< Updated upstream
            <button class="btn btn-sm btn-danger" onclick="window.configModule.removeIP('${ip}')">
                <i class="fas fa-times"></i>
            </button>
        `;

=======
            <div class="ip-item-actions">
                <button class="btn btn-outline-danger btn-sm" onclick="window.configModule.removeIP('${ip}')" title="Usuń IP">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
>>>>>>> Stashed changes
        container.appendChild(ipItem);
    }

    /**
     * Usunięcie IP z DOM
     */
    removeIPFromList(ip) {
<<<<<<< Updated upstream
        const container = document.getElementById('ip-list-items');
        if (!container) return;

        const items = container.querySelectorAll('.ip-item');
=======
        const items = document.querySelectorAll('.ip-item');
>>>>>>> Stashed changes
        items.forEach(item => {
            const ipSpan = item.querySelector('.ip-address');
            if (ipSpan && ipSpan.textContent === ip) {
                item.remove();
            }
        });
    }

    /**
     * Pobranie aktualnej listy IP
     */
    getCurrentIPList() {
<<<<<<< Updated upstream
        const container = document.getElementById('ip-list-items');
        if (!container) return [];

        const ipSpans = container.querySelectorAll('.ip-address');
        return Array.from(ipSpans).map(span => span.textContent.trim());
=======
        const items = document.querySelectorAll('.ip-address');
        return Array.from(items).map(item => item.textContent);
>>>>>>> Stashed changes
    }

    /**
     * Reset listy IP
     */
    resetIPList(ipString) {
        const container = document.getElementById('ip-list-items');
        if (!container) return;

        container.innerHTML = '';

        const ips = ipString.split(',').map(ip => ip.trim()).filter(ip => ip);
        ips.forEach(ip => this.addIPToList(ip));
    }

    /**
     * Walidacja IP
     */
    isValidIP(ip) {
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
    }

    /**
<<<<<<< Updated upstream
     * Walidacja IP input
     */
    validateIPInput(input) {
        const ip = input.value.trim();
        if (!ip) {
            input.classList.remove('is-invalid');
            return;
        }

        if (this.isValidIP(ip)) {
            input.classList.remove('is-invalid');
        } else {
            input.classList.add('is-invalid');
=======
     * Walidacja input IP
     */
    validateIPInput(input) {
        if (input.value && !this.isValidIP(input.value)) {
            input.classList.add('is-invalid');
        } else {
            input.classList.remove('is-invalid');
>>>>>>> Stashed changes
        }
    }

    // ========================================================================
    // JSON VALIDATION
    // ========================================================================

    /**
     * Walidacja JSON
     */
    validateJSON(textarea) {
<<<<<<< Updated upstream
        const value = textarea.value.trim();

        if (!value) {
            textarea.classList.remove('json-valid', 'json-invalid');
            return;
        }

        try {
            JSON.parse(value);
=======
        try {
            JSON.parse(textarea.value);
>>>>>>> Stashed changes
            textarea.classList.remove('json-invalid');
            textarea.classList.add('json-valid');
        } catch (e) {
            textarea.classList.remove('json-valid');
            textarea.classList.add('json-invalid');
        }
    }

    // ========================================================================
    // SWITCH LABELS
    // ========================================================================

    /**
<<<<<<< Updated upstream
     * Aktualizacja etykiety switch
     */
    updateSwitchLabel(checkbox) {
        const label = checkbox.closest('.form-check').querySelector('.form-check-label span');
        if (!label) return;

        if (checkbox.checked) {
            label.textContent = 'Włączone';
            label.className = 'text-success fw-bold';
        } else {
            label.textContent = 'Wyłączone';
            label.className = 'text-muted';
=======
     * Aktualizacja etykiet switch
     */
    updateSwitchLabel(checkbox) {
        const label = checkbox.parentElement.querySelector('.form-check-label span');
        if (label) {
            if (checkbox.checked) {
                label.textContent = 'Włączone';
                label.className = 'text-success fw-bold';
            } else {
                label.textContent = 'Wyłączone';
                label.className = 'text-muted';
            }
>>>>>>> Stashed changes
        }
    }

    // ========================================================================
    // CACHE MANAGEMENT
    // ========================================================================

    /**
     * Czyszczenie cache
     */
    async clearCache() {
<<<<<<< Updated upstream
        if (!confirm('Czy na pewno chcesz wyczyścić cache? To spowoduje ponowne załadowanie wszystkich danych.')) {
            return;
        }

        console.log('[ConfigModule] Clearing cache...');
=======
        if (!confirm('Czy na pewno chcesz wyczyścić cache systemu?')) {
            return;
        }

        console.log('[ConfigModule] Clearing cache');
>>>>>>> Stashed changes

        try {
            const response = await fetch('/production/api/clear-cache', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            const result = await response.json();

            if (result.success) {
<<<<<<< Updated upstream
                this.showToast('Cache wyczyszczony pomyślnie!', 'success');
                setTimeout(() => window.location.reload(), 1000);
            } else {
                throw new Error(result.error || 'Błąd czyszczenia cache');
            }
=======
                this.showToast('Cache został wyczyszczony pomyślnie', 'success');

                // Odśwież statystyki cache
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                throw new Error(result.error || 'Nieznany błąd');
            }

>>>>>>> Stashed changes
        } catch (error) {
            console.error('[ConfigModule] Error clearing cache:', error);
            this.showToast(`Błąd czyszczenia cache: ${error.message}`, 'error');
        }
    }

    // ========================================================================
<<<<<<< Updated upstream
    // TOAST SYSTEM
    // ========================================================================

    /**
     * Wyświetlenie toast notification
=======
    // TOAST NOTIFICATIONS
    // ========================================================================

    /**
     * Pokazanie toast notification
>>>>>>> Stashed changes
     */
    showToast(message, type = 'info') {
        const alertClass = {
            'success': 'alert-success',
            'error': 'alert-danger',
<<<<<<< Updated upstream
            'warning': 'alert-warning',
            'info': 'alert-info'
=======
            'info': 'alert-info',
            'warning': 'alert-warning'
>>>>>>> Stashed changes
        }[type] || 'alert-info';

        const icon = {
            'success': 'fa-check-circle',
<<<<<<< Updated upstream
            'error': 'fa-times-circle',
            'warning': 'fa-exclamation-triangle',
            'info': 'fa-info-circle'
=======
            'error': 'fa-exclamation-triangle',
            'info': 'fa-info-circle',
            'warning': 'fa-exclamation-triangle'
>>>>>>> Stashed changes
        }[type] || 'fa-info-circle';

        const toast = document.createElement('div');
        toast.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
        toast.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px; max-width: 500px;';
        toast.innerHTML = `
            <i class="fas ${icon} me-2"></i>${message}
            <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
        `;

        document.body.appendChild(toast);

        // Auto-usuń po 5 sekundach
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 150);
            }
        }, 5000);
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Czyszczenie modułu
     */
    cleanup() {
        this.isInitialized = false;
        this.resetPendingChanges();
<<<<<<< Updated upstream
        this.originalValues = {};
=======
>>>>>>> Stashed changes

        console.log('[ConfigModule] Cleaned up');
    }
}

// ============================================================================
// GLOBAL FUNCTIONS - dla kompatybilności z HTML onclick
// ============================================================================

<<<<<<< Updated upstream
window.configChanged = function (key, value) {
    if (window.configModule) {
        window.configModule.configChanged(key, value);
    } else {
        console.error('[ConfigModule] Global configModule not found!');
=======
// Globalne funkcje wywoływane z HTML
window.configChanged = function (key, value) {
    if (window.configModule) {
        window.configModule.configChanged(key, value);
>>>>>>> Stashed changes
    }
};

window.resetToDefault = function (key) {
    if (window.configModule) {
        window.configModule.resetToDefault(key);
    }
};

window.addIP = function () {
    if (window.configModule) {
        window.configModule.addIP();
    }
};

window.removeIP = function (ip) {
    if (window.configModule) {
        window.configModule.removeIP(ip);
    }
};

window.validateJSON = function (textarea) {
    if (window.configModule) {
        window.configModule.validateJSON(textarea);
    }
};

window.clearCache = function () {
    if (window.configModule) {
        window.configModule.clearCache();
    }
};

window.saveAllChanges = function () {
    if (window.configModule) {
        window.configModule.saveAllChanges();
    }
};

window.discardChanges = function () {
    if (window.configModule) {
        window.configModule.discardChanges();
    }
};

// ============================================================================
// AUTO-INITIALIZATION
// ============================================================================

<<<<<<< Updated upstream
=======
// Automatyczna inicjalizacja gdy DOM jest gotowy
>>>>>>> Stashed changes
function initConfigModule() {
    if (typeof window.configModule !== 'undefined') {
        console.log('[ConfigModule] Already exists, cleaning up...');
        window.configModule.cleanup();
    }

    window.configModule = new ConfigModule();

    // Inicjalizuj jeśli jesteśmy na stronie konfiguracji
    const configContainer = document.querySelector('.config-container');
    if (configContainer) {
        window.configModule.init();
<<<<<<< Updated upstream
    } else {
        console.log('[ConfigModule] Config container not found, skipping init');
=======
>>>>>>> Stashed changes
    }
}

// Inicjalizacja przy ładowaniu dokumentu
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConfigModule);
} else {
    initConfigModule();
}

<<<<<<< Updated upstream
console.log('[ConfigModule v2.0] Script loaded - with enhanced debugging');
=======
console.log('[ConfigModule] Script loaded');
>>>>>>> Stashed changes
