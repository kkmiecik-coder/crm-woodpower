/**
 * Config Management JavaScript
 * ============================
 * 
 * Funkcjonalność dla panelu konfiguracji produkcji:
 * - Drag & Drop priorytetów
 * - Zarządzanie IP whitelist
 * - Synchronizacja CRON
 * - Cache management
 * - Real-time validation
 * - Unsaved changes tracking
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 1.0
 * Data: 2025-01-10
 */

// ============================================================================
// KONFIGURACJA I ZMIENNE GLOBALNE
// ============================================================================

const ConfigPanel = {
    // Konfiguracja
    config: {
        autoSaveDelay: 2000, // 2 sekundy
        maxWeightSum: 100,
        minWeightSum: 95,
        validateDelay: 500
    },

    // Stan aplikacji
    state: {
        unsavedChanges: false,
        prioritySortable: null,
        configValues: {},
        originalValues: {},
        validationErrors: []
    },

    // API endpoints
    endpoints: {
        updateConfig: '/production/api/update-config',
        syncStatus: '/production/api/sync-status',
        cacheStats: '/production/api/cache-stats',
        manualSync: '/production/api/manual-sync',
        clearCache: '/production/api/clear-cache',
        testIP: '/production/api/test-ip',
        exportConfig: '/production/api/export-config'
    }
};

// ============================================================================
// INICJALIZACJA
// ============================================================================

/**
 * Inicjalizuje panel konfiguracji
 */
function initConfigPanel() {
    console.log('[Config Panel] Inicjalizacja...');

    // Sprawdź dostępność danych
    if (typeof window.configData === 'undefined') {
        console.warn('[Config Panel] Brak danych konfiguracji');
        window.configData = { configs: {}, priorityConfigs: [] };
    }

    // Zapisz oryginalne wartości
    saveOriginalValues();

    // Inicjalizacja komponentów
    initEventListeners();
    initConfigValidation();

    // Aktualizuj UI
    updateConfigStatus();

    console.log('[Config Panel] Inicjalizacja zakończona');
}

/**
 * Inicjalizuje drag & drop dla priorytetów
 */
function initPrioritiesDragDrop() {
    if (typeof Sortable === 'undefined') {
        console.warn('[Config Panel] Sortable.js niedostępny');
        return;
    }

    const prioritiesList = document.getElementById('priority-criteria-list');
    if (!prioritiesList) return;

    console.log('[Config Panel] Inicjalizacja drag & drop priorytetów...');

    ConfigPanel.state.prioritySortable = new Sortable(prioritiesList, {
        handle: '.priority-drag-handle',
        animation: 150,
        ghostClass: 'priority-ghost',
        chosenClass: 'priority-chosen',
        dragClass: 'priority-drag',

        onStart: function (evt) {
            console.log('[Priority Drag] Start:', evt.oldIndex);
            document.body.classList.add('priority-dragging');
        },

        onEnd: function (evt) {
            console.log('[Priority Drag] End:', evt.oldIndex, '->', evt.newIndex);
            document.body.classList.remove('priority-dragging');

            if (evt.oldIndex !== evt.newIndex) {
                handlePriorityReorder();
            }
        }
    });
}

/**
 * Inicjalizuje event listenery
 */
function initEventListeners() {
    // Save config button
    const saveBtn = document.getElementById('save-config-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveAllConfigurations);
    }

    // Reset button
    const resetBtn = document.getElementById('reset-config-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetToDefaults);
    }

    // Export button
    const exportBtn = document.getElementById('export-config-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportConfiguration);
    }

    // Tab change events
    const tabButtons = document.querySelectorAll('[data-bs-toggle="tab"]');
    tabButtons.forEach(button => {
        button.addEventListener('shown.bs.tab', function (event) {
            const tabId = event.target.getAttribute('data-bs-target').substring(1);
            handleTabChange(tabId);
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Przed opuszczeniem strony
    window.addEventListener('beforeunload', handleBeforeUnload);

    console.log('[Config Panel] Event listenery zainicjalizowane');
}

/**
 * Inicjalizuje walidację konfiguracji
 */
function initConfigValidation() {
    // Walidacja interwałów z debounce
    const refreshInterval = document.getElementById('refresh-interval');
    if (refreshInterval) {
        let timeout;
        refreshInterval.addEventListener('input', function () {
            clearTimeout(timeout);
            timeout = setTimeout(() => validateRefreshInterval(this), ConfigPanel.config.validateDelay);
        });
    }

    // Walidacja IP
    const newIpInput = document.getElementById('new-ip');
    if (newIpInput) {
        newIpInput.addEventListener('input', validateIPFormat);
    }

    console.log('[Config Panel] Walidacja zainicjalizowana');
}

// ============================================================================
// PRIORYTETY - DRAG & DROP
// ============================================================================

/**
 * Obsługuje zmianę kolejności priorytetów
 */
function handlePriorityReorder() {
    console.log('[Priority Reorder] Aktualizacja kolejności...');

    const items = document.querySelectorAll('.priority-config-item');
    items.forEach((item, index) => {
        const configId = item.dataset.configId;
        const originalOrder = parseInt(item.dataset.originalOrder);

        if (index !== originalOrder) {
            item.dataset.currentOrder = index;
            markConfigChanged();
        }
    });

    updateWeightSummary();
    showNotification('Kolejność priorytetów została zmieniona', 'info');
}

/**
 * Aktualizuje wartość wagi priorytetu
 */
function updateWeightValue(slider, configId) {
    const value = parseInt(slider.value);
    const valueDisplay = document.getElementById(`weight-value-${configId}`);
    const item = document.querySelector(`[data-config-id="${configId}"]`);

    if (valueDisplay) {
        valueDisplay.textContent = value + '%';
    }

    if (item) {
        const originalWeight = parseInt(item.dataset.originalWeight);
        if (value !== originalWeight) {
            item.dataset.currentWeight = value;
            markConfigChanged();
        }
    }

    updateWeightSummary();
}

/**
 * Przełącza aktywność kryterium
 */
function toggleCriterion(configId, isActive) {
    console.log('[Toggle Criterion] ID:', configId, 'Active:', isActive);

    const item = document.querySelector(`[data-config-id="${configId}"]`);
    if (item) {
        item.dataset.currentActive = isActive;

        // Disable/enable controls
        const slider = document.getElementById(`weight-${configId}`);
        const valueDisplay = document.getElementById(`weight-value-${configId}`);

        if (slider) slider.disabled = !isActive;
        if (valueDisplay) {
            valueDisplay.style.opacity = isActive ? '1' : '0.5';
        }

        item.style.opacity = isActive ? '1' : '0.7';
        markConfigChanged();
    }

    updateWeightSummary();
}

/**
 * Aktualizuje podsumowanie wag
 */
function updateWeightSummary() {
    const activeItems = document.querySelectorAll('.priority-config-item input[type="checkbox"]:checked');
    let totalWeight = 0;

    activeItems.forEach(checkbox => {
        const configId = checkbox.id.replace('active-', '');
        const slider = document.getElementById(`weight-${configId}`);
        if (slider) {
            totalWeight += parseInt(slider.value);
        }
    });

    const totalWeightElement = document.getElementById('total-weight');
    const weightStatusElement = document.getElementById('weight-status');

    if (totalWeightElement) {
        totalWeightElement.textContent = totalWeight + '%';
    }

    if (weightStatusElement) {
        const statusMessage = weightStatusElement.querySelector('.status-message');
        if (statusMessage) {
            if (totalWeight === 100) {
                statusMessage.textContent = '✅ Wagi są prawidłowe';
                statusMessage.className = 'status-message text-success';
            } else if (totalWeight >= ConfigPanel.config.minWeightSum && totalWeight <= ConfigPanel.config.maxWeightSum) {
                statusMessage.textContent = '⚠️ Wagi zbliżone do optymalnych';
                statusMessage.className = 'status-message text-warning';
            } else {
                statusMessage.textContent = '❌ Suma wag powinna wynosić 100%';
                statusMessage.className = 'status-message text-danger';
            }
        }
    }
}

/**
 * Normalizuje wagi do sumy 100%
 */
function normalizeWeights() {
    const activeItems = document.querySelectorAll('.priority-config-item input[type="checkbox"]:checked');
    const activeCount = activeItems.length;

    if (activeCount === 0) {
        showNotification('Brak aktywnych kryteriów do normalizacji', 'warning');
        return;
    }

    const targetWeight = Math.floor(100 / activeCount);
    const remainder = 100 - (targetWeight * activeCount);

    activeItems.forEach((checkbox, index) => {
        const configId = checkbox.id.replace('active-', '');
        const slider = document.getElementById(`weight-${configId}`);
        const valueDisplay = document.getElementById(`weight-value-${configId}`);

        if (slider && valueDisplay) {
            // Dodaj resztę do pierwszego elementu
            const finalWeight = targetWeight + (index === 0 ? remainder : 0);

            slider.value = finalWeight;
            valueDisplay.textContent = finalWeight + '%';

            // Zaktualizuj dane
            const item = document.querySelector(`[data-config-id="${configId}"]`);
            if (item) {
                item.dataset.currentWeight = finalWeight;
            }
        }
    });

    markConfigChanged();
    updateWeightSummary();
    showNotification('Wagi zostały znormalizowane do 100%', 'success');
}

/**
 * Dodaje nowe kryterium priorytetu
 */
function addNewCriterion() {
    const modal = new bootstrap.Modal(document.getElementById('addCriterionModal'));
    modal.show();
}

/**
 * Zapisuje nowe kryterium
 */
function saveNewCriterion() {
    const name = document.getElementById('criterionName').value.trim();
    const description = document.getElementById('criterionDescription').value.trim();
    const weight = parseInt(document.getElementById('criterionWeight').value);

    if (!name) {
        showNotification('Nazwa kryterium jest wymagana', 'error');
        return;
    }

    if (weight < 0 || weight > 100) {
        showNotification('Waga musi być między 0 a 100', 'error');
        return;
    }

    // TODO: Implementacja dodawania przez API
    console.log('[Add Criterion] Nowe kryterium:', { name, description, weight });
    showNotification('Funkcja dodawania kryteriów w przygotowaniu', 'info');

    // Zamknij modal
    bootstrap.Modal.getInstance(document.getElementById('addCriterionModal')).hide();
}

/**
 * Tworzy domyślne kryteria priorytetów
 */
function createDefaultPriorities() {
    showConfirmModal(
        'Utworzenie domyślnych kryteriów',
        'Czy na pewno chcesz utworzyć domyślne kryteria priorytetów? Obecne ustawienia zostaną nadpisane.',
        () => {
            console.log('[Create Default] Tworzenie domyślnych priorytetów...');
            showNotification('Funkcja tworzenia domyślnych kryteriów w przygotowaniu', 'info');
        }
    );
}

// ============================================================================
// KONFIGURACJA SYSTEMOWA
// ============================================================================

/**
 * Waliduje interwał odświeżania
 */
function validateRefreshInterval(input) {
    const value = parseInt(input.value);
    const currentDisplay = document.getElementById('current-refresh');

    if (value < 5 || value > 300) {
        input.classList.add('is-invalid');
        showNotification('Interwał musi być między 5 a 300 sekund', 'error');
        return;
    }

    input.classList.remove('is-invalid');
    input.classList.add('is-valid');

    if (currentDisplay) {
        currentDisplay.textContent = value;
    }

    updateConfigValue('REFRESH_INTERVAL_SECONDS', value);
}

/**
 * Aktualizuje wartość konfiguracji
 */
function updateConfigValue(key, value) {
    ConfigPanel.state.configValues[key] = value;

    // Sprawdź czy wartość się zmieniła
    const originalValue = ConfigPanel.state.originalValues[key];
    if (String(value) !== String(originalValue)) {
        markConfigChanged();
    }

    // Aktualizuj dependent displays
    updateDependentDisplays(key, value);
}

/**
 * Aktualizuje powiązane wyświetlenia
 */
function updateDependentDisplays(key, value) {
    switch (key) {
        case 'PRODUCTION_SYNC_INTERVAL':
            const syncDisplay = document.getElementById('current-sync-interval');
            if (syncDisplay) {
                syncDisplay.textContent = Math.round(parseInt(value) / 60);
            }
            break;

        case 'CACHE_DURATION_SECONDS':
            const cacheDisplay = document.getElementById('current-cache-duration');
            if (cacheDisplay) {
                cacheDisplay.textContent = Math.round(parseInt(value) / 60);
            }
            break;
    }
}

// ============================================================================
// ZABEZPIECZENIA IP
// ============================================================================

/**
 * Waliduje format IP
 */
function validateIPFormat() {
    const input = document.getElementById('new-ip');
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

    if (input.value.trim() === '') {
        input.classList.remove('is-valid', 'is-invalid');
        return;
    }

    if (ipRegex.test(input.value.trim())) {
        input.classList.remove('is-invalid');
        input.classList.add('is-valid');
    } else {
        input.classList.remove('is-valid');
        input.classList.add('is-invalid');
    }
}

/**
 * Dodaje nowy adres IP
 */
function addNewIP() {
    const input = document.getElementById('new-ip');
    const ipAddress = input.value.trim();
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

    if (!ipAddress) {
        showNotification('Wprowadź adres IP', 'warning');
        return;
    }

    if (!ipRegex.test(ipAddress)) {
        showNotification('Nieprawidłowy format adresu IP', 'error');
        return;
    }

    // Sprawdź duplikaty
    const existingIPs = Array.from(document.querySelectorAll('.ip-item')).map(item => item.dataset.ip);
    if (existingIPs.includes(ipAddress)) {
        showNotification('Ten adres IP już istnieje', 'warning');
        return;
    }

    // Dodaj IP do listy
    const ipList = document.getElementById('ip-list');
    const noIpsElement = ipList.querySelector('.no-ips');

    if (noIpsElement) {
        noIpsElement.remove();
    }

    const ipItem = createIPItemElement(ipAddress);
    ipList.appendChild(ipItem);

    // Wyczyść input
    input.value = '';
    input.classList.remove('is-valid', 'is-invalid');

    // Aktualizuj konfigurację
    updateIPConfiguration();

    showNotification(`Dodano adres IP: ${ipAddress}`, 'success');
}

/**
 * Tworzy element IP
 */
function createIPItemElement(ipAddress) {
    const div = document.createElement('div');
    div.className = 'ip-item';
    div.dataset.ip = ipAddress;

    div.innerHTML = `
        <span class="ip-address">${ipAddress}</span>
        <div class="ip-actions">
            <button class="btn btn-sm btn-outline-primary" onclick="testIPAccess('${ipAddress}')">
                🔍 Test
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="removeIP('${ipAddress}')">
                🗑️ Usuń
            </button>
        </div>
    `;

    return div;
}

/**
 * Usuwa adres IP
 */
function removeIP(ipAddress) {
    showConfirmModal(
        'Usunięcie adresu IP',
        `Czy na pewno chcesz usunąć adres IP: ${ipAddress}?`,
        () => {
            const ipItem = document.querySelector(`[data-ip="${ipAddress}"]`);
            if (ipItem) {
                ipItem.remove();
                updateIPConfiguration();
                showNotification(`Usunięto adres IP: ${ipAddress}`, 'success');

                // Sprawdź czy lista jest pusta
                const ipList = document.getElementById('ip-list');
                if (ipList.children.length === 0) {
                    const noIpsDiv = document.createElement('div');
                    noIpsDiv.className = 'no-ips';
                    noIpsDiv.innerHTML = '<p class="text-muted">Brak skonfigurowanych adresów IP</p>';
                    ipList.appendChild(noIpsDiv);
                }
            }
        }
    );
}

/**
 * Testuje dostęp IP
 */
async function testIPAccess(ipAddress) {
    console.log('[Test IP] Testowanie:', ipAddress);

    try {
        const response = await fetch(`${ConfigPanel.endpoints.testIP}/${ipAddress}`, {
            credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`IP ${ipAddress}: ${data.message}`, 'success');
        } else {
            showNotification(`IP ${ipAddress}: ${data.error}`, 'warning');
        }

    } catch (error) {
        console.error('[Test IP] Błąd:', error);
        showNotification(`Błąd testowania IP ${ipAddress}`, 'error');
    }
}

/**
 * Aktualizuje konfigurację IP
 */
function updateIPConfiguration() {
    const ipItems = document.querySelectorAll('.ip-item');
    const ipList = Array.from(ipItems).map(item => item.dataset.ip);
    const ipString = ipList.join(',');

    updateConfigValue('STATION_ALLOWED_IPS', ipString);
}

// ============================================================================
// SYNCHRONIZACJA
// ============================================================================

/**
 * Ładuje status synchronizacji
 */
async function loadSyncStatus() {
    const statusContainer = document.getElementById('sync-status-content');
    if (!statusContainer) return;

    try {
        statusContainer.innerHTML = '<div class="status-loading">Ładowanie statusu synchronizacji...</div>';

        const response = await fetch(ConfigPanel.endpoints.syncStatus, {
            credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
            statusContainer.innerHTML = generateSyncStatusHtml(data.status);
        } else {
            throw new Error(data.error || 'Błąd ładowania statusu');
        }

    } catch (error) {
        console.error('[Sync Status] Błąd:', error);
        statusContainer.innerHTML = `<div class="alert alert-danger">Błąd ładowania statusu: ${error.message}</div>`;
    }
}

/**
 * Generuje HTML dla statusu synchronizacji
 */
function generateSyncStatusHtml(status) {
    return `
        <div class="sync-status-grid">
            <div class="status-item">
                <div class="status-label">Ostatnia synchronizacja:</div>
                <div class="status-value">${formatDateTime(status.last_sync)}</div>
            </div>
            <div class="status-item">
                <div class="status-label">Status:</div>
                <div class="status-value">
                    <span class="badge ${status.status === 'success' ? 'bg-success' : 'bg-danger'}">
                        ${status.status === 'success' ? 'OK' : 'BŁĄD'}
                    </span>
                </div>
            </div>
            <div class="status-item">
                <div class="status-label">Zsynchronizowane produkty:</div>
                <div class="status-value">${status.synced_products || 0}</div>
            </div>
            <div class="status-item">
                <div class="status-label">Błędy:</div>
                <div class="status-value text-${status.errors_count > 0 ? 'danger' : 'success'}">
                    ${status.errors_count || 0}
                </div>
            </div>
        </div>
        ${status.last_error ? `
            <div class="alert alert-warning mt-3">
                <strong>Ostatni błąd:</strong> ${status.last_error}
            </div>
        ` : ''}
    `;
}

/**
 * Przełącza widoczność tajnego klucza
 */
function toggleSecretVisibility() {
    const input = document.getElementById('cron-secret');
    const button = input.nextElementSibling;

    if (input.type === 'password') {
        input.type = 'text';
        button.textContent = '🙈';
    } else {
        input.type = 'password';
        button.textContent = '👁️';
    }
}

/**
 * Regeneruje tajny klucz
 */
function regenerateSecret() {
    showConfirmModal(
        'Regeneracja klucza CRON',
        'Czy na pewno chcesz wygenerować nowy klucz? Stary klucz przestanie działać.',
        () => {
            const newSecret = generateRandomSecret(32);
            const input = document.getElementById('cron-secret');

            if (input) {
                input.value = newSecret;
                updateConfigValue('PRODUCTION_CRON_SECRET', newSecret);
                showNotification('Wygenerowano nowy klucz CRON', 'success');
            }
        }
    );
}

/**
 * Generuje losowy tajny klucz
 */
function generateRandomSecret(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Uruchamia manualną synchronizację
 */
async function triggerManualSync() {
    const button = event.target.closest('button');
    const originalText = button.innerHTML;

    button.disabled = true;
    button.innerHTML = '⏳ Synchronizowanie...';

    try {
        const response = await fetch(ConfigPanel.endpoints.manualSync, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Synchronizacja ukończona pomyślnie', 'success');
            // Odśwież status po synchronizacji
            setTimeout(loadSyncStatus, 1000);
        } else {
            throw new Error(data.error || 'Błąd synchronizacji');
        }

    } catch (error) {
        console.error('[Manual Sync] Błąd:', error);
        showNotification('Błąd synchronizacji: ' + error.message, 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = originalText;
    }
}

/**
 * Sprawdza health synchronizacji
 */
function checkSyncHealth() {
    console.log('[Sync Health] Sprawdzanie...');
    loadSyncStatus();
    showNotification('Status synchronizacji został odświeżony', 'info');
}

/**
 * Czyści błędy synchronizacji
 */
function clearSyncErrors() {
    showConfirmModal(
        'Czyszczenie błędów',
        'Czy na pewno chcesz wyczyścić wszystkie błędy synchronizacji?',
        () => {
            console.log('[Clear Sync Errors] Czyszczenie błędów...');
            showNotification('Błędy synchronizacji zostały wyczyszczone', 'success');
            setTimeout(loadSyncStatus, 500);
        }
    );
}

/**
 * Pokazuje logi synchronizacji
 */
function viewSyncLogs() {
    console.log('[View Sync Logs] Otwieranie logów...');
    showNotification('Funkcja przeglądu logów w przygotowaniu', 'info');
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

/**
 * Ładuje statystyki cache
 */
async function loadCacheStats() {
    const statsContainer = document.getElementById('cache-stats');
    if (!statsContainer) return;

    try {
        statsContainer.innerHTML = '<div class="stats-loading">Ładowanie statystyk cache...</div>';

        const response = await fetch(ConfigPanel.endpoints.cacheStats, {
            credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
            statsContainer.innerHTML = generateCacheStatsHtml(data.stats);
        } else {
            throw new Error(data.error || 'Błąd ładowania statystyk');
        }

    } catch (error) {
        console.error('[Cache Stats] Błąd:', error);
        statsContainer.innerHTML = `<div class="alert alert-danger">Błąd ładowania statystyk: ${error.message}</div>`;
    }
}

/**
 * Generuje HTML dla statystyk cache
 */
function generateCacheStatsHtml(stats) {
    return `
        <div class="cache-stats-grid">
            <div class="cache-stat-card">
                <div class="stat-icon">🗂️</div>
                <div class="stat-content">
                    <div class="stat-value">${stats.total_keys || 0}</div>
                    <div class="stat-label">Kluczy w cache</div>
                </div>
            </div>
            <div class="cache-stat-card">
                <div class="stat-icon">📊</div>
                <div class="stat-content">
                    <div class="stat-value">${stats.hit_rate || 0}%</div>
                    <div class="stat-label">Współczynnik trafień</div>
                </div>
            </div>
            <div class="cache-stat-card">
                <div class="stat-icon">💾</div>
                <div class="stat-content">
                    <div class="stat-value">${formatBytes(stats.memory_usage || 0)}</div>
                    <div class="stat-label">Użycie pamięci</div>
                </div>
            </div>
            <div class="cache-stat-card">
                <div class="stat-icon">⏱️</div>
                <div class="stat-content">
                    <div class="stat-value">${formatDateTime(stats.last_updated)}</div>
                    <div class="stat-label">Ostatnia aktualizacja</div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Czyści cały cache
 */
function clearAllCache() {
    showConfirmModal(
        'Czyszczenie cache',
        'Czy na pewno chcesz wyczyścić cały cache? To może wpłynąć na wydajność systemu.',
        async () => {
            try {
                const response = await fetch(ConfigPanel.endpoints.clearCache, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    credentials: 'same-origin'
                });

                const data = await response.json();

                if (data.success) {
                    showNotification('Cache został wyczyszczony', 'success');
                    setTimeout(loadCacheStats, 500);
                } else {
                    throw new Error(data.error || 'Błąd czyszczenia cache');
                }

            } catch (error) {
                console.error('[Clear Cache] Błąd:', error);
                showNotification('Błąd czyszczenia cache: ' + error.message, 'error');
            }
        }
    );
}

/**
 * Odświeża statystyki cache
 */
function refreshCacheStats() {
    console.log('[Refresh Cache Stats] Odświeżanie...');
    loadCacheStats();
}

/**
 * Preload cache
 */
function preloadCache() {
    console.log('[Preload Cache] Ładowanie cache...');
    showNotification('Cache zostanie załadowany w tle', 'info');
}

// ============================================================================
// ZAPISYWANIE I WALIDACJA
// ============================================================================

/**
 * Zapisuje oryginalné wartości
 */
function saveOriginalValues() {
    if (window.configData.configs) {
        Object.entries(window.configData.configs).forEach(([key, config]) => {
            ConfigPanel.state.originalValues[key] = config.value;
            ConfigPanel.state.configValues[key] = config.value;
        });
    }

    console.log('[Config Panel] Oryginalne wartości zapisane');
}

/**
 * Oznacza konfigurację jako zmienioną
 */
function markConfigChanged() {
    ConfigPanel.state.unsavedChanges = true;
    updateConfigStatus();

    const saveBtn = document.getElementById('save-config-btn');
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.add('btn-warning');
        saveBtn.classList.remove('btn-primary');
    }
}

/**
 * Aktualizuje status konfiguracji
 */
function updateConfigStatus() {
    const indicator = document.getElementById('config-indicator');
    const text = document.getElementById('config-text');

    if (indicator && text) {
        const dot = indicator.querySelector('.status-dot');

        if (ConfigPanel.state.unsavedChanges) {
            dot.classList.remove('active');
            dot.classList.add('warning');
            text.textContent = 'Niezapisane zmiany';
        } else {
            dot.classList.remove('warning');
            dot.classList.add('active');
            text.textContent = 'Konfiguracja załadowana';
        }
    }
}

/**
 * Zapisuje wszystkie konfiguracje
 */
async function saveAllConfigurations() {
    const saveBtn = document.getElementById('save-config-btn');
    const originalText = saveBtn.innerHTML;

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="quick-action-icon">⏳</span>Zapisywanie...';

    try {
        console.log('[Save Config] Zapisywanie konfiguracji...');

        // Przygotuj dane do zapisania
        const configUpdates = {};
        const priorityUpdates = [];

        // Zbierz zmiany konfiguracji systemowej
        Object.entries(ConfigPanel.state.configValues).forEach(([key, value]) => {
            if (String(value) !== String(ConfigPanel.state.originalValues[key])) {
                configUpdates[key] = value;
            }
        });

        // Zbierz zmiany priorytetów
        document.querySelectorAll('.priority-config-item').forEach((item, index) => {
            const configId = item.dataset.configId;
            const currentWeight = item.dataset.currentWeight || item.dataset.originalWeight;
            const currentOrder = item.dataset.currentOrder || index;
            const currentActive = item.querySelector('input[type="checkbox"]').checked;

            priorityUpdates.push({
                id: configId,
                weight: parseInt(currentWeight),
                order: parseInt(currentOrder),
                active: currentActive
            });
        });

        const requestData = {
            config_updates: configUpdates,
            priority_updates: priorityUpdates
        };

        console.log('[Save Config] Dane do zapisania:', requestData);

        const response = await fetch(ConfigPanel.endpoints.updateConfig, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin',
            body: JSON.stringify(requestData)
        });

        const data = await response.json();

        if (data.success) {
            // Zaktualizuj oryginalne wartości
            Object.assign(ConfigPanel.state.originalValues, configUpdates);

            // Zaktualizuj dataset atrybuty priorytetów
            document.querySelectorAll('.priority-config-item').forEach((item, index) => {
                const currentWeight = item.dataset.currentWeight || item.dataset.originalWeight;
                const currentOrder = item.dataset.currentOrder || index;

                item.dataset.originalWeight = currentWeight;
                item.dataset.originalOrder = currentOrder;

                // Usuń tymczasowe atrybuty
                delete item.dataset.currentWeight;
                delete item.dataset.currentOrder;
                delete item.dataset.currentActive;
            });

            ConfigPanel.state.unsavedChanges = false;
            updateConfigStatus();

            showNotification('Konfiguracja została zapisana pomyślnie', 'success');

            // Odśwież zależne dane
            setTimeout(() => {
                loadSyncStatus();
                loadCacheStats();
            }, 1000);

        } else {
            throw new Error(data.error || 'Błąd zapisywania konfiguracji');
        }

    } catch (error) {
        console.error('[Save Config] Błąd:', error);
        showNotification('Błąd zapisywania konfiguracji: ' + error.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
        saveBtn.classList.remove('btn-warning');
        saveBtn.classList.add('btn-primary');
    }
}

/**
 * Przywraca domyślne ustawienia
 */
function resetToDefaults() {
    showConfirmModal(
        'Przywrócenie domyślnych ustawień',
        'Czy na pewno chcesz przywrócić wszystkie ustawienia do wartości domyślnych? Wszystkie zmiany zostaną utracone.',
        () => {
            console.log('[Reset Defaults] Przywracanie domyślnych...');

            // Reset konfiguracji systemowej
            const defaultValues = {
                'REFRESH_INTERVAL_SECONDS': '30',
                'DEBUG_PRODUCTION_BACKEND': 'False',
                'DEBUG_PRODUCTION_FRONTEND': 'False',
                'PRODUCTION_MAX_ITEMS_PER_SYNC': '1000',
                'PRODUCTION_SYNC_INTERVAL': '3600',
                'CACHE_DURATION_SECONDS': '3600'
            };

            Object.entries(defaultValues).forEach(([key, value]) => {
                const element = document.querySelector(`[data-config-key="${key}"], #${key.toLowerCase().replace(/_/g, '-')}`);
                if (element) {
                    if (element.type === 'checkbox') {
                        element.checked = value === 'True';
                    } else {
                        element.value = value;
                    }
                    updateConfigValue(key, value);
                }
            });

            // Reset priorytetów
            document.querySelectorAll('.priority-config-item').forEach(item => {
                const configId = item.dataset.configId;
                const slider = document.getElementById(`weight-${configId}`);
                const checkbox = document.getElementById(`active-${configId}`);

                if (slider) {
                    slider.value = '20'; // Domyślna waga
                    updateWeightValue(slider, configId);
                }

                if (checkbox) {
                    checkbox.checked = true;
                    toggleCriterion(configId, true);
                }
            });

            normalizeWeights();
            showNotification('Przywrócono domyślne ustawienia', 'success');
        }
    );
}

/**
 * Eksportuje konfigurację
 */
async function exportConfiguration() {
    console.log('[Export Config] Eksport konfiguracji...');

    try {
        const response = await fetch(ConfigPanel.endpoints.exportConfig, {
            credentials: 'same-origin'
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `production_config_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showNotification('Konfiguracja została wyeksportowana', 'success');
        } else {
            throw new Error('Błąd eksportu konfiguracji');
        }

    } catch (error) {
        console.error('[Export Config] Błąd:', error);
        showNotification('Błąd eksportu konfiguracji', 'error');
    }
}

// ============================================================================
// OBSŁUGA ZAKŁADEK
// ============================================================================

/**
 * Obsługuje zmianę zakładki
 */
function handleTabChange(tabId) {
    console.log('[Tab Change] Przełączenie na:', tabId);

    switch (tabId) {
        case 'priorities':
            updateWeightSummary();
            break;

        case 'sync':
            loadSyncStatus();
            break;

        case 'cache':
            loadCacheStats();
            break;
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Obsługuje skróty klawiszowe
 */
function handleKeyboardShortcuts(event) {
    // Ctrl + S - save config
    if (event.ctrlKey && event.key === 's') {
        event.preventDefault();
        if (ConfigPanel.state.unsavedChanges) {
            saveAllConfigurations();
        }
        return;
    }

    // Escape - close modals
    if (event.key === 'Escape') {
        const openModals = document.querySelectorAll('.modal.show');
        openModals.forEach(modal => {
            const modalInstance = bootstrap.Modal.getInstance(modal);
            if (modalInstance) {
                modalInstance.hide();
            }
        });
    }
}

/**
 * Obsługuje przed opuszczeniem strony
 */
function handleBeforeUnload(event) {
    if (ConfigPanel.state.unsavedChanges) {
        event.preventDefault();
        event.returnValue = 'Masz niezapisane zmiany konfiguracji. Czy na pewno chcesz opuścić stronę?';
    }
}

/**
 * Pokazuje modal potwierdzenia
 */
function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    const titleElement = document.getElementById('confirmModalTitle');
    const bodyElement = document.getElementById('confirmModalBody');
    const actionButton = document.getElementById('confirmModalAction');

    if (titleElement) titleElement.textContent = title;
    if (bodyElement) bodyElement.textContent = message;

    // Usuń poprzednie event listenery
    const newActionButton = actionButton.cloneNode(true);
    actionButton.parentNode.replaceChild(newActionButton, actionButton);

    // Dodaj nowy event listener
    newActionButton.addEventListener('click', () => {
        onConfirm();
        bootstrap.Modal.getInstance(modal).hide();
    });

    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
}

/**
 * Formatuje datę i czas
 */
function formatDateTime(dateString) {
    if (!dateString) return 'Brak';
    const date = new Date(dateString);
    return date.toLocaleString('pl-PL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Formatuje bajty
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Pokazuje notyfikację użytkownikowi
 */
function showNotification(message, type = 'info') {
    // Sprawdź czy istnieje system notyfikacji w głównej aplikacji
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    } else {
        // Fallback - prosty alert lub console
        console.log(`[Notification ${type.toUpperCase()}] ${message}`);

        // Użyj prostego toast z priority-config.js jeśli dostępny
        if (typeof window.createSimpleToast === 'function') {
            window.createSimpleToast(message, type);
        }
    }
}

// ============================================================================
// EXPORT / GLOBAL ACCESS
// ============================================================================

// Udostępnij funkcje globalnie (dla onclick w HTML)
window.updateWeightValue = updateWeightValue;
window.toggleCriterion = toggleCriterion;
window.normalizeWeights = normalizeWeights;
window.addNewCriterion = addNewCriterion;
window.saveNewCriterion = saveNewCriterion;
window.createDefaultPriorities = createDefaultPriorities;

window.validateRefreshInterval = validateRefreshInterval;
window.updateConfigValue = updateConfigValue;

window.addNewIP = addNewIP;
window.removeIP = removeIP;
window.testIPAccess = testIPAccess;

window.toggleSecretVisibility = toggleSecretVisibility;
window.regenerateSecret = regenerateSecret;
window.triggerManualSync = triggerManualSync;
window.checkSyncHealth = checkSyncHealth;
window.clearSyncErrors = clearSyncErrors;
window.viewSyncLogs = viewSyncLogs;

window.clearAllCache = clearAllCache;
window.refreshCacheStats = refreshCacheStats;
window.preloadCache = preloadCache;

window.saveAllConfigurations = saveAllConfigurations;
window.resetToDefaults = resetToDefaults;
window.exportConfiguration = exportConfiguration;

// Eksport głównego obiektu
window.ConfigPanel = ConfigPanel;

console.log('[Config Management] Moduł załadowany pomyślnie');