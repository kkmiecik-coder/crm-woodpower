/**
 * Config Module - Moduł zarządzania konfiguracją
 * static/js/config-module.js
 * 
 * Zarządza interfejsem konfiguracji systemu produkcyjnego:
 * - Śledzenie zmian konfiguracji
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

        console.log('[ConfigModule] Instance created');
    }

    /**
     * Inicjalizacja modułu
     */
    init() {
        if (this.isInitialized) {
            console.log('[ConfigModule] Already initialized');
            return;
        }

        console.log('[ConfigModule] Initializing...');

        try {
            // Inicjalizacja podstawowych komponentów
            this.initIPManagement();
            this.initJSONValidation();
            this.initSwitchLabels();
            this.initEventListeners();

            // Reset stanu
            this.resetPendingChanges();

            this.isInitialized = true;
            console.log('[ConfigModule] Initialized successfully');

        } catch (error) {
            console.error('[ConfigModule] Initialization failed:', error);
        }
    }

    /**
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
     * Śledzenie zmian konfiguracji
     */
    configChanged(key, value) {
        console.log('[ConfigModule] Configuration changed:', key, '=', value);

        this.pendingChanges[key] = value;
        this.changesCount = Object.keys(this.pendingChanges).length;

        this.updateChangesIndicator();

        // Pokazuj save bar jeśli są zmiany
        this.showSaveBar(this.changesCount > 0);
    }

    /**
     * Aktualizacja wskaźnika zmian
     */
    updateChangesIndicator() {
        const saveBar = document.getElementById('config-save-bar');
        const changesCountEl = document.getElementById('changes-count');

        if (this.changesCount > 0) {
            if (saveBar) saveBar.classList.add('has-changes');
            if (changesCountEl) changesCountEl.textContent = this.changesCount;
        } else {
            if (saveBar) saveBar.classList.remove('has-changes');
            if (changesCountEl) changesCountEl.textContent = '0';
        }
    }

    /**
     * Pokazanie/ukrycie paska zapisywania
     */
    showSaveBar(show) {
        const saveBar = document.getElementById('config-save-bar');
        if (saveBar) {
            saveBar.style.display = show ? 'block' : 'none';
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

        console.log('[ConfigModule] Saving changes:', this.pendingChanges);

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
                console.log('[ConfigModule] Changes saved successfully');
                this.showToast('Konfiguracja zapisana pomyślnie!', 'success');

                // Wyczyść pending changes
                this.resetPendingChanges();

            } else {
                throw new Error(result.error || 'Nieznany błąd');
            }

        } catch (error) {
            console.error('[ConfigModule] Error saving changes:', error);
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
            console.log('[ConfigModule] Discarding changes');

            // Przeładuj stronę aby przywrócić oryginalne wartości
            window.location.reload();
        }
    }

    /**
     * Reset do wartości domyślnych
     */
    resetToDefault(key) {
        if (!confirm(`Czy na pewno chcesz przywrócić domyślną wartość dla ${key}?`)) {
            return;
        }

        const defaultValue = this.defaultValues[key];

        if (defaultValue !== undefined) {
            console.log(`[ConfigModule] Resetting ${key} to default:`, defaultValue);

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
        this.showSaveBar(false);
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
            <div class="ip-item-actions">
                <button class="btn btn-outline-danger btn-sm" onclick="window.configModule.removeIP('${ip}')" title="Usuń IP">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        container.appendChild(ipItem);
    }

    /**
     * Usunięcie IP z DOM
     */
    removeIPFromList(ip) {
        const items = document.querySelectorAll('.ip-item');
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
        const items = document.querySelectorAll('.ip-address');
        return Array.from(items).map(item => item.textContent);
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
     * Walidacja input IP
     */
    validateIPInput(input) {
        if (input.value && !this.isValidIP(input.value)) {
            input.classList.add('is-invalid');
        } else {
            input.classList.remove('is-invalid');
        }
    }

    // ========================================================================
    // JSON VALIDATION
    // ========================================================================

    /**
     * Walidacja JSON
     */
    validateJSON(textarea) {
        try {
            JSON.parse(textarea.value);
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
        }
    }

    // ========================================================================
    // CACHE MANAGEMENT
    // ========================================================================

    /**
     * Czyszczenie cache
     */
    async clearCache() {
        if (!confirm('Czy na pewno chcesz wyczyścić cache systemu?')) {
            return;
        }

        console.log('[ConfigModule] Clearing cache');

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
                this.showToast('Cache został wyczyszczony pomyślnie', 'success');

                // Odśwież statystyki cache
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                throw new Error(result.error || 'Nieznany błąd');
            }

        } catch (error) {
            console.error('[ConfigModule] Error clearing cache:', error);
            this.showToast(`Błąd czyszczenia cache: ${error.message}`, 'error');
        }
    }

    // ========================================================================
    // TOAST NOTIFICATIONS
    // ========================================================================

    /**
     * Pokazanie toast notification
     */
    showToast(message, type = 'info') {
        const alertClass = {
            'success': 'alert-success',
            'error': 'alert-danger',
            'info': 'alert-info',
            'warning': 'alert-warning'
        }[type] || 'alert-info';

        const icon = {
            'success': 'fa-check-circle',
            'error': 'fa-exclamation-triangle',
            'info': 'fa-info-circle',
            'warning': 'fa-exclamation-triangle'
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

        console.log('[ConfigModule] Cleaned up');
    }
}

// ============================================================================
// GLOBAL FUNCTIONS - dla kompatybilności z HTML onclick
// ============================================================================

// Globalne funkcje wywoływane z HTML
window.configChanged = function (key, value) {
    if (window.configModule) {
        window.configModule.configChanged(key, value);
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

// Automatyczna inicjalizacja gdy DOM jest gotowy
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
    }
}

// Inicjalizacja przy ładowaniu dokumentu
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConfigModule);
} else {
    initConfigModule();
}

console.log('[ConfigModule] Script loaded');