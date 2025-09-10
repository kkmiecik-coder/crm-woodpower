/**
 * Production Dashboard JavaScript - NAPRAWIONE
 * =============================================
 * 
 * POPRAWKI:
 * 1. Naprawiona funkcja updateSystemHealth - zgodność z API
 * 2. Lepsze error handling w loadDashboardData
 * 3. Poprawne URL endpoints z window.productionEndpoints
 * 4. Dodane fallback dla undefined data
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 2.1 - NAPRAWIONE BŁĘDY
 * Data: 2025-09-10
 */

// ============================================================================
// KONFIGURACJA I ZMIENNE GLOBALNE
// ============================================================================

const ProductionDashboard = {
    // Konfiguracja
    config: {
        refreshInterval: 30000, // 30 sekund
        maxRetries: 3,
        retryDelay: 1000,
        chartColors: {
            cutting: '#fd7e14',
            assembly: '#007bff',
            packaging: '#28a745',
            total: '#2c5530'
        }
    },

    // Stan aplikacji
    state: {
        isLoading: false,
        lastUpdate: null,
        retryCount: 0,
        autoRefreshEnabled: true,
        chart: null
    },

    // API endpoints - pobrane z window.productionEndpoints lub fallback
    endpoints: {
        dashboardStats: '/production/api/dashboard-stats',
        manualSync: '/production/api/manual-sync',
        healthCheck: '/production/api/health'
    }
};

// ============================================================================
// INICJALIZACJA
// ============================================================================

/**
 * Inicjalizuje dashboard po załadowaniu DOM
 */
function initProductionDashboard() {
    console.log('[Production Dashboard] Inicjalizacja...');

    // NAPRAWKA: Sprawdź dostępność danych i endpoint URLs
    if (typeof window.productionStats === 'undefined') {
        console.warn('[Production Dashboard] Brak danych początkowych');
        window.productionStats = {};
    }

    // NAPRAWKA: Ustaw prawidłowe endpointy z Jinja2
    if (typeof window.productionEndpoints !== 'undefined') {
        ProductionDashboard.endpoints = window.productionEndpoints;
        console.log('[Production Dashboard] Użyto endpoints z serwera:', ProductionDashboard.endpoints);
    } else {
        console.warn('[Production Dashboard] Użyto fallback endpoints');
    }

    // Inicjalizacja komponentów
    initEventListeners();
    initAutoRefresh();
    updateDateTime();

    // Załaduj dane początkowe
    if (Object.keys(window.productionStats).length > 0) {
        console.log('[Production Dashboard] Używam danych z serwera');
        updateDashboardData(window.productionStats);
    }

    // NAPRAWKA: Zawsze wywołaj loadDashboardData() dla świeżych danych
    console.log('[Production Dashboard] Ładowanie świeżych danych z API');
    loadDashboardData();

    // Inicjalizuj wykres dla adminów
    if (window.currentUser && window.currentUser.role === 'admin') {
        initPerformanceChart();
    }

    console.log('[Production Dashboard] Inicjalizacja zakończona');
}

// ============================================================================
// ŁADOWANIE DANYCH
// ============================================================================

/**
 * Ładuje dane z API - NAPRAWIONE ERROR HANDLING
 */
async function loadDashboardData() {
    if (ProductionDashboard.state.isLoading) return;

    ProductionDashboard.state.isLoading = true;
    updateLoadingState(true);

    console.log('[Production Dashboard] Ładowanie danych...');

    try {
        const response = await fetch(ProductionDashboard.endpoints.dashboardStats, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            // NAPRAWKA: Lepsze error handling
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText || 'Nieznany błąd API'}`);
        }

        const data = await response.json();
        
        // NAPRAWKA: Sprawdź strukturę odpowiedzi
        if (!data || typeof data !== 'object') {
            throw new Error('Nieprawidłowa struktura odpowiedzi API');
        }

        console.log('[Production Dashboard] Odebrano dane:', data);
        updateDashboardData(data);

        // Reset retry counter po udanej operacji
        ProductionDashboard.state.retryCount = 0;
        updateStatusIndicator('active', 'System aktywny');

    } catch (error) {
        console.error('[Production Dashboard] Błąd ładowania danych:', error);
        handleLoadError(error);
    } finally {
        ProductionDashboard.state.isLoading = false;
        updateLoadingState(false);
    }
}

/**
 * Aktualizuje dane dashboard - NAPRAWIONE
 */
function updateDashboardData(data) {
    try {
        console.log('[Production Dashboard] Aktualizacja danych:', data);

        // NAPRAWKA: Dodaj fallback dla każdej sekcji
        if (data.stations) {
            updateStationsStats(data.stations);
        } else {
            console.warn('[Production Dashboard] Brak danych stations');
        }

        if (data.today_totals) {
            updateTodayTotals(data.today_totals);
        } else {
            console.warn('[Production Dashboard] Brak danych today_totals');
        }

        if (data.deadline_alerts) {
            updateDeadlineAlerts(data.deadline_alerts);
        } else {
            console.warn('[Production Dashboard] Brak danych deadline_alerts');
        }

        // NAPRAWKA: System health z prawidłową strukturą
        if (data.system_health) {
            updateSystemHealth(data.system_health);
        } else {
            console.warn('[Production Dashboard] Brak danych system_health');
        }

        // Aktualizuj last updated timestamps
        updateLastUpdatedTimestamps();
        ProductionDashboard.state.lastUpdate = new Date();

        // Dodaj fade-in animation
        document.querySelectorAll('.widget-content').forEach(content => {
            content.classList.add('fade-in');
            setTimeout(() => content.classList.remove('fade-in'), 500);
        });

    } catch (error) {
        console.error('[Production Dashboard] Błąd aktualizacji danych:', error);
        showNotification('Błąd aktualizacji danych', 'error');
    }
}

// ============================================================================
// AKTUALIZACJA KOMPONENTÓW
// ============================================================================

/**
 * Aktualizuje statystyki stanowisk
 */
function updateStationsStats(stations) {
    Object.entries(stations).forEach(([stationCode, stats]) => {
        const pendingElement = document.getElementById(`${stationCode}-pending`);
        const todayM3Element = document.getElementById(`${stationCode}-today-m3`);
        const statusElement = document.getElementById(`${stationCode}-status`);

        if (pendingElement) {
            pendingElement.textContent = stats.pending_count || '0';
        }

        if (todayM3Element) {
            todayM3Element.textContent = (stats.today_m3 || 0).toFixed(2);
        }

        if (statusElement) {
            updateStationStatus(statusElement, stats);
        }
    });
}

/**
 * Aktualizuje dzisiejsze podsumowanie
 */
function updateTodayTotals(totals) {
    const elements = {
        'today-completed-orders': totals.completed_orders || 0,
        'today-total-m3': (totals.total_m3 || 0).toFixed(2),
        'today-avg-deadline': (totals.avg_deadline_distance || 0).toFixed(1)
    };

    Object.entries(elements).forEach(([elementId, value]) => {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    });
}

/**
 * Aktualizuje alerty terminów
 */
function updateDeadlineAlerts(alerts) {
    const alertsList = document.getElementById('alerts-list');
    const alertsCount = document.getElementById('alerts-count');

    if (alertsCount) {
        alertsCount.textContent = alerts.length;
    }

    if (!alertsList) return;

    if (alerts.length === 0) {
        alertsList.innerHTML = '<div class="no-alerts">Brak alertów terminów</div>';
        return;
    }

    alertsList.innerHTML = '';
    alerts.forEach(alert => {
        const alertElement = createAlertElement(alert);
        alertsList.appendChild(alertElement);
    });
}

/**
 * Automatyczne wykrywanie błędów systemu i aktualizacja statusu
 */
function updateSystemStatusBasedOnHealth(health) {
    let systemStatus = 'active';
    let statusText = 'System aktywny';
    
    // Sprawdź czy są błędy w systemie
    const hasErrors = health.errors_24h && health.errors_24h > 0;
    const hasSyncErrors = health.sync_status === 'failed';
    const hasDatabaseErrors = health.database_status === 'error';
    
    if (hasErrors || hasSyncErrors || hasDatabaseErrors) {
        systemStatus = 'error';
        
        // Stwórz opisowy komunikat błędu
        const errorMessages = [];
        if (hasErrors) errorMessages.push(`${health.errors_24h} błędów`);
        if (hasSyncErrors) errorMessages.push('błąd synchronizacji');
        if (hasDatabaseErrors) errorMessages.push('błąd bazy danych');
        
        statusText = `System aktywny - ${errorMessages.join(', ')}`;
        
        // Dodaj pulsowanie
        const indicator = document.getElementById('status-indicator');
        if (indicator) {
            indicator.classList.add('pulse-error');
        }
    } else if (health.sync_status === 'running') {
        systemStatus = 'warning';
        statusText = 'System aktywny - synchronizacja w toku';
    } else if (health.sync_status === 'never_run') {
        systemStatus = 'warning';
        statusText = 'System aktywny - brak synchronizacji';
    }
    
    updateStatusIndicator(systemStatus, statusText);
    console.log(`[Status Indicator] Status: ${systemStatus}, Text: ${statusText}`);
}

/**
 * NAPRAWIONA: Aktualizuje system health - zgodność z API
 */
function updateSystemHealth(health) {
    console.log('[Production Dashboard] Aktualizacja system health:', health);
    // NAPRAWKA: Aktualizuj główny status systemu na podstawie health
    updateSystemStatusBasedOnHealth(health);

    // NAPRAWKA: Zgodność z rzeczywistą strukturą API
    // API zwraca: database_status, sync_status, errors_24h, last_sync
    
    // Last sync
    const lastSyncElement = document.getElementById('last-sync-time');
    const syncStatusElement = document.getElementById('sync-status');

    if (lastSyncElement) {
        if (health.last_sync) {
            lastSyncElement.textContent = formatDateTime(new Date(health.last_sync));
        } else {
            lastSyncElement.textContent = 'Brak danych';
        }
    }

    if (syncStatusElement) {
        updateHealthStatus(syncStatusElement, health.sync_status || 'unknown');
    }

    // NAPRAWKA: Database status (health.database_status, nie health.database.status)
    const dbStatusElement = document.getElementById('db-status');
    if (dbStatusElement) {
        updateHealthStatus(dbStatusElement, health.database_status || 'unknown');
    }

    // NAPRAWKA: Baselinker API status 
    const apiStatusElement = document.getElementById('api-status');
    if (apiStatusElement) {
        // Wywnioskuj status API z sync_status
        let apiStatus = 'unknown';
        if (health.sync_status === 'success' || health.sync_status === 'completed') apiStatus = 'ok';
        else if (health.sync_status === 'failed') apiStatus = 'error';
        else if (health.sync_status === 'running') apiStatus = 'warning';
        
        updateHealthStatus(apiStatusElement, apiStatus);
    }

    // NAPRAWKA: Error count (health.errors_24h, nie health.errors.count)
    const errorCountElement = document.getElementById('error-count');
    const errorsStatusElement = document.getElementById('errors-status');

    if (errorCountElement) {
        errorCountElement.textContent = health.errors_24h || '0';
    }

    if (errorsStatusElement) {
        const status = (health.errors_24h && health.errors_24h > 0) ? 'error' : 'ok';
        updateHealthStatus(errorsStatusElement, status);
    }

    // Response times (opcjonalne, może nie być w API)
    const dbResponseElement = document.getElementById('db-response-time');
    if (dbResponseElement) {
        dbResponseElement.textContent = health.database_response_ms ? 
            health.database_response_ms + 'ms' : 'N/A';
    }

    const apiResponseElement = document.getElementById('api-response-time');
    if (apiResponseElement) {
        apiResponseElement.textContent = health.baselinker_api_avg_ms ? 
            health.baselinker_api_avg_ms + 'ms' : 'N/A';
    }

    // Health indicator główny
    updateMainHealthIndicator(health);
}

/**
 * Aktualizuje status health elementu
 */
function updateHealthStatus(element, status) {
    if (!element) return;
    
    // Usuń poprzednie klasy
    element.classList.remove('ok', 'warning', 'error', 'unknown', 'healthy', 'connected');

    // NAPRAWKA: Lepsze mapowanie statusów na CSS classes
    const statusMap = {
        'success': { class: 'ok', text: 'OK' },
        'completed': { class: 'ok', text: 'OK' },
        'failed': { class: 'error', text: 'ERROR' },
        'running': { class: 'warning', text: 'RUNNING' },
        'healthy': { class: 'ok', text: 'OK' },
        'connected': { class: 'ok', text: 'OK' },
        'ok': { class: 'ok', text: 'OK' },
        'error': { class: 'error', text: 'ERROR' },
        'warning': { class: 'warning', text: 'WARNING' },
        'unknown': { class: 'unknown', text: 'UNKNOWN' }
    };

    // Pobierz mapowanie lub użyj fallback
    const mapping = statusMap[status] || { class: 'unknown', text: 'UNKNOWN' };
    
    // Dodaj klasę CSS i ustaw tekst
    element.classList.add(mapping.class);
    element.textContent = mapping.text;
    
    console.log(`[Health Status] Element ${element.id}: status="${status}" -> class="${mapping.class}", text="${mapping.text}"`);
}

/**
 * Aktualizuje główny wskaźnik health
 */
function updateMainHealthIndicator(health) {
    const healthDot = document.querySelector('.health-dot');
    if (!healthDot) return;

    // Usuń poprzednie klasy
    healthDot.classList.remove('healthy', 'warning', 'error');

    // Określ ogólny status
    let overallStatus = 'healthy';

    if (health.errors_24h && health.errors_24h > 0) {
        overallStatus = 'error';
    } else if (health.sync_status === 'failed') {
        overallStatus = 'error';
    } else if (health.sync_status === 'running') {
        overallStatus = 'warning';
    } else if (health.database_status !== 'healthy') {
        overallStatus = 'error';
    }

    healthDot.classList.add(overallStatus);
}

// ============================================================================
// UTILITY I HELPER FUNCTIONS
// ============================================================================

/**
 * Obsługuje błędy ładowania - NAPRAWIONE
 */
function handleLoadError(error) {
    ProductionDashboard.state.retryCount++;

    console.error(`[Production Dashboard] Błąd ładowania (próba ${ProductionDashboard.state.retryCount}):`, error);

    if (ProductionDashboard.state.retryCount < ProductionDashboard.config.maxRetries) {
        console.log(`[Production Dashboard] Ponowna próba ${ProductionDashboard.state.retryCount}/${ProductionDashboard.config.maxRetries}`);

        setTimeout(() => {
            loadDashboardData();
        }, ProductionDashboard.config.retryDelay * ProductionDashboard.state.retryCount);

        updateStatusIndicator('warning', 'Ponowna próba...');
    } else {
        console.error('[Production Dashboard] Przekroczono maksymalną liczbę prób');
        updateStatusIndicator('error', 'Błąd połączenia');
        showNotification('Błąd ładowania danych', 'error');
    }
}

/**
 * Pokazuje notyfikację użytkownikowi
 */
function showNotification(message, type = 'info') {
    // Sprawdź czy istnieje system notyfikacji w głównej aplikacji
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else {
        // Fallback - prosty alert
        console.log(`[Notification ${type.toUpperCase()}] ${message}`);
    }
}

/**
 * Inicjalizuje event listenery
 */
function initEventListeners() {
    // Manual sync button
    const manualSyncBtn = document.getElementById('manual-sync-btn');
    if (manualSyncBtn) {
        manualSyncBtn.addEventListener('click', handleManualSync);
    }

    // Station cards click
    document.querySelectorAll('.station-card').forEach(card => {
        card.addEventListener('click', handleStationCardClick);
    });

    // Chart period selector
    const chartPeriod = document.getElementById('chart-period');
    if (chartPeriod) {
        chartPeriod.addEventListener('change', updateChart);
    }

    // System health actions
    const clearErrorsBtn = document.querySelector('[onclick="clearSystemErrors()"]');
    if (clearErrorsBtn) {
        clearErrorsBtn.addEventListener('click', clearSystemErrors);
    }

    const refreshHealthBtn = document.querySelector('[onclick="refreshSystemHealth()"]');
    if (refreshHealthBtn) {
        refreshHealthBtn.addEventListener('click', refreshSystemHealth);
    }

    // Obsługa zmiany widoczności strony (pause auto-refresh gdy ukryta)
    document.addEventListener('visibilitychange', handleVisibilityChange);

    console.log('[Production Dashboard] Event listenery zainicjalizowane');
}

/**
 * Inicjalizuje auto-refresh
 */
function initAutoRefresh() {
    if (ProductionDashboard.state.autoRefreshEnabled) {
        setInterval(() => {
            if (!document.hidden && !ProductionDashboard.state.isLoading) {
                loadDashboardData();
            }
        }, ProductionDashboard.config.refreshInterval);

        console.log('[Production Dashboard] Auto-refresh włączony:', ProductionDashboard.config.refreshInterval + 'ms');
    }
}

/**
 * Pozostałe funkcje helper (bez zmian)
 */
function updateLoadingState(isLoading) {
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.textContent = isLoading ? 'Ładowanie...' : 'System aktywny';
    }
}

function updateStatusIndicator(status, text) {
    const indicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    if (indicator) {
        indicator.classList.remove('active', 'warning', 'error');
        indicator.classList.add(status);
    }

    if (statusText) {
        statusText.textContent = text;
    }
}

function updateLastUpdatedTimestamps() {
    const now = new Date();
    const timeString = formatDateTime(now);

    document.querySelectorAll('.last-updated').forEach(element => {
        element.textContent = `Aktualizacja: ${timeString}`;
    });
}

function updateDateTime() {
    const todayDateElement = document.getElementById('today-date');
    if (todayDateElement) {
        todayDateElement.textContent = formatDate(new Date());
    }

    // Aktualizuj co minutę
    setTimeout(updateDateTime, 60000);
}

function formatDateTime(date) {
    return date.toLocaleString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit'
    });
}

function formatDate(date) {
    return date.toLocaleDateString('pl-PL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// ============================================================================
// DODATKOWE FUNKCJE (manual sync, charts, etc.)
// ============================================================================

/**
 * Obsługuje manual sync
 */
async function handleManualSync(event) {
    const button = event.target.closest('button');

    if (button.disabled) return;

    button.disabled = true;
    button.classList.add('loading');

    try {
        const response = await fetch(ProductionDashboard.endpoints.manualSync, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showNotification('Synchronizacja zakończona pomyślnie', 'success');
            // Odśwież dane po synchronizacji
            setTimeout(() => loadDashboardData(), 1000);
        } else {
            throw new Error(data.error || 'Błąd synchronizacji');
        }

    } catch (error) {
        console.error('[Production Dashboard] Błąd manual sync:', error);
        showNotification('Błąd synchronizacji: ' + error.message, 'error');
    } finally {
        button.disabled = false;
        button.classList.remove('loading');
    }
}

// Placeholder dla innych funkcji
function handleStationCardClick(event) {
    const card = event.currentTarget;
    const station = card.dataset.station;
    if (station) {
        window.location.href = `/production/${station}`;
    }
}

function handleVisibilityChange() {
    if (document.hidden) {
        console.log('[Production Dashboard] Strona ukryta - wstrzymanie auto-refresh');
    } else {
        console.log('[Production Dashboard] Strona widoczna - wznowienie auto-refresh');
        if (!ProductionDashboard.state.isLoading) {
            loadDashboardData();
        }
    }
}

function clearSystemErrors() {
    console.log('[Production Dashboard] Czyszczenie błędów systemu...');
    showNotification('Błędy systemu zostały wyczyszczone', 'success');
}

function refreshSystemHealth() {
    console.log('[Production Dashboard] Odświeżanie statusu systemu...');
    loadDashboardData();
}

function createAlertElement(alert) {
    const div = document.createElement('div');
    div.className = 'deadline-alert';
    div.innerHTML = `
        <div class="alert-content">
            <div class="alert-product">
                <span class="product-id">${alert.product_id}</span>
                <span class="order-id">#${alert.order_id}</span>
            </div>
            <div class="alert-description">${alert.description}</div>
        </div>
        <div class="alert-deadline ${getAlertSeverity(alert.days_remaining)}">
            ${alert.days_remaining} dni
        </div>
    `;
    return div;
}

function getAlertSeverity(daysRemaining) {
    if (daysRemaining <= 0) return 'danger';
    if (daysRemaining <= 2) return 'warning';
    return 'info';
}

function updateStationStatus(statusElement, stats) {
    const statusDot = statusElement.querySelector('.status-dot');
    if (!statusDot) return;

    statusDot.classList.remove('active', 'warning', 'danger');

    let statusClass = 'active';
    if (stats.pending_count > 20) {
        statusClass = 'warning';
    } else if (stats.pending_count > 50) {
        statusClass = 'danger';
    }

    statusDot.classList.add(statusClass);
}

function initPerformanceChart() {
    // Chart.js integration - placeholder
    console.log('[Production Dashboard] Inicjalizacja wykresu wydajności...');
}

function updateChart() {
    console.log('[Production Dashboard] Aktualizacja wykresu...');
}

// ============================================================================
// EXPORT / GLOBAL ACCESS
// ============================================================================

// Udostępnij funkcje globalnie
window.triggerManualSync = handleManualSync;
window.updateChart = updateChart;
window.clearSystemErrors = clearSystemErrors;
window.refreshSystemHealth = refreshSystemHealth;

// Eksport głównego obiektu
window.ProductionDashboard = ProductionDashboard;

console.log('[Production Dashboard] Moduł załadowany pomyślnie');