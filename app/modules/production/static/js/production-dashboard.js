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


// === KONFIGURACJA WYKRESÓW ===
const CHART_CONFIG = {
    defaultDays: 14, // Łatwa konfiguracja liczby dni
    maxDays: 90,
    minDays: 7,
    colors: {
        cutting: '#fd7e14',    // Pomarańczowy
        assembly: '#007bff',   // Niebieski  
        packaging: '#28a745'   // Zielony
    }
};

// === GLOBALNE ZMIENNE ===
let dailyPerformanceChart = null;
let isChartReady = false;

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
        createDailyPerformanceChart();
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

    const apiResponseElement = document.getElementById('api-response-time');
    if (apiResponseElement) {
        apiResponseElement.textContent = health.baselinker_api_avg_ms ? 
            health.baselinker_api_avg_ms + 'ms' : 'N/A';
    }

    // Response times (opcjonalne, może nie być w API)
    const dbResponseElement = document.getElementById('db-response-time');
    if (dbResponseElement) {
        // DODANE: Debug logging
        console.log('[Debug] Health object:', health);
        console.log('[Debug] database_response_ms value:', health.database_response_ms);
        console.log('[Debug] database_response_ms type:', typeof health.database_response_ms);
        
        if (health.database_response_ms !== undefined && health.database_response_ms !== null) {
            dbResponseElement.textContent = health.database_response_ms + 'ms';
            console.log('[Debug] Set DB time to:', health.database_response_ms + 'ms');
        } else {
            dbResponseElement.textContent = 'N/A';
            console.log('[Debug] Set DB time to N/A - value was:', health.database_response_ms);
        }
    }

    // DODANE: Log całego obiektu health do konsoli
    console.log('[Debug] Complete health response:', JSON.stringify(health, null, 2));

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
        'success': { class: 'ok', text: 'DZIAŁA' },
        'completed': { class: 'ok', text: 'DZIAŁA' },
        'failed': { class: 'error', text: 'ERROR' },
        'running': { class: 'warning', text: 'RUNNING' },
        'healthy': { class: 'ok', text: 'DZIAŁA' },
        'connected': { class: 'ok', text: 'DZIAŁA' },
        'ok': { class: 'ok', text: 'DZIAŁA' },
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
        chartPeriod.addEventListener('change', refreshChartData);
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

/**
 * NOWA FUNKCJA #1: createDailyPerformanceChart()
 * ZASTĘPUJE: initPerformanceChart()
 */
function createDailyPerformanceChart() {
    console.log('[Daily Performance Chart] Tworzenie wykresu wydajności dziennej...');
    
    // Sprawdzenie Chart.js
    if (typeof Chart === 'undefined') {
        console.error('[Daily Performance Chart] Chart.js nie jest załadowany!');
        showChartMessage('Chart.js nie został załadowany. Sprawdź konfigurację.');
        return false;
    }
    
    // Znajdź canvas
    const canvas = document.getElementById('performance-chart-canvas');
    if (!canvas) {
        console.error('[Daily Performance Chart] Nie znaleziono canvas #performance-chart-canvas');
        return false;
    }
    
    // NAPRAWKA: Ostry rendering - wyłącz wygładzanie
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
    
    // NAPRAWKA: Pixel-perfect rendering
    const devicePixelRatio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    
    // Zniszcz istniejący wykres jeśli istnieje
    if (dailyPerformanceChart) {
        console.log('[Daily Performance Chart] Niszczę istniejący wykres...');
        dailyPerformanceChart.destroy();
        dailyPerformanceChart = null;
    }
    
    try {
        // Przygotuj dane początkowe (NAPRAWKA: zawsze z punktami, nawet przy 0)
        const initialData = generateEmptyChartData(CHART_CONFIG.defaultDays);
        
        // Konfiguracja wykresu
        const config = {
            type: 'line',
            data: {
                labels: initialData.labels,
                datasets: [
                    {
                        label: 'Wycinanie (m³)',
                        data: initialData.cutting,
                        borderColor: CHART_CONFIG.colors.cutting,
                        backgroundColor: 'transparent', // NAPRAWKA: przezroczyste tło
                        borderWidth: 2, // NAPRAWKA: cieńsze linie
                        fill: false,
                        tension: 0, // NAPRAWKA: proste linie, bez wygładzania
                        pointRadius: 3, // NAPRAWKA: mniejsze punkty
                        pointHoverRadius: 5,
                        pointBorderWidth: 1,
                        pointBackgroundColor: CHART_CONFIG.colors.cutting,
                        pointBorderColor: '#fff',
                        spanGaps: false // NAPRAWKA: nie łącz przez luki
                    },
                    {
                        label: 'Składanie (m³)',
                        data: initialData.assembly,
                        borderColor: CHART_CONFIG.colors.assembly,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        fill: false,
                        tension: 0,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBorderWidth: 1,
                        pointBackgroundColor: CHART_CONFIG.colors.assembly,
                        pointBorderColor: '#fff',
                        spanGaps: false
                    },
                    {
                        label: 'Pakowanie (m³)',
                        data: initialData.packaging,
                        borderColor: CHART_CONFIG.colors.packaging,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        fill: false,
                        tension: 0,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBorderWidth: 1,
                        pointBackgroundColor: CHART_CONFIG.colors.packaging,
                        pointBorderColor: '#fff',
                        spanGaps: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                // NAPRAWKA: Wyłącz animacje dla ostrości
                animation: {
                    duration: 0
                },
                // NAPRAWKA: Pixel-perfect rendering
                devicePixelRatio: devicePixelRatio,
                plugins: {
                    title: {
                        display: true,
                        text: `Wydajność dzienna - ostatnie ${CHART_CONFIG.defaultDays} dni`,
                        font: { size: 16, weight: 'bold' }
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 20,
                            font: { size: 14 }
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#ddd',
                        borderWidth: 1,
                        callbacks: {
                            title: function(context) {
                                return `Data: ${context[0].label}`;
                            },
                            label: function(context) {
                                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} m³`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        title: {
                            display: true,
                            text: 'Dni',
                            font: { size: 14, weight: 'bold' }
                        },
                        grid: {
                            display: true,
                            color: 'rgba(0, 0, 0, 0.1)',
                            lineWidth: 1 // NAPRAWKA: cienkie linie siatki
                        },
                        ticks: {
                            maxTicksLimit: 10 // NAPRAWKA: ogranicz liczbę etykiet
                        }
                    },
                    y: {
                        display: true,
                        beginAtZero: true,
                        // NAPRAWKA: Zawsze pokaż co najmniej do 1.0 m³
                        suggestedMin: 0,
                        suggestedMax: 1.0,
                        title: {
                            display: true,
                            text: 'Objętość (m³)',
                            font: { size: 14, weight: 'bold' }
                        },
                        grid: {
                            display: true,
                            color: 'rgba(0, 0, 0, 0.1)',
                            lineWidth: 1
                        },
                        ticks: {
                            callback: function(value) {
                                return value.toFixed(1) + ' m³';
                            },
                            stepSize: 0.2 // NAPRAWKA: równe odstępy
                        }
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                // NAPRAWKA: Elementy zawsze widoczne
                elements: {
                    point: {
                        radius: 3,
                        hoverRadius: 5
                    },
                    line: {
                        borderWidth: 2,
                        tension: 0
                    }
                }
            }
        };
        
        // Utwórz wykres
        dailyPerformanceChart = new Chart(ctx, config);
        
        // Walidacja poprawności utworzenia
        if (!dailyPerformanceChart || !dailyPerformanceChart.data) {
            throw new Error('Wykres nie został utworzony poprawnie');
        }
        
        isChartReady = true;
        console.log('[Daily Performance Chart] Wykres utworzony pomyślnie!');
        
        // Dodaj event listener dla zmiany okresu
        setupPeriodSelector();
        
        // Załaduj rzeczywiste dane
        setTimeout(() => {
            refreshChartData();
        }, 100);
        
        return true;
        
    } catch (error) {
        console.error('[Daily Performance Chart] Błąd tworzenia wykresu:', error);
        showChartMessage(`Błąd tworzenia wykresu: ${error.message}`);
        isChartReady = false;
        return false;
    }
}

/**
 * NOWA FUNKCJA #2: refreshChartData()
 * ZASTĘPUJE: updateChart()
 */
async function refreshChartData() {
    console.log('[Daily Performance Chart] Odświeżanie danych wykresu...');
    
    // Sprawdź czy wykres jest gotowy
    if (!isChartReady || !dailyPerformanceChart) {
        console.warn('[Daily Performance Chart] Wykres nie jest gotowy - tworzę go...');
        if (!createDailyPerformanceChart()) {
            return false;
        }
    }
    
    // Pobierz wybrany okres
    const periodSelect = document.getElementById('chart-period');
    let selectedDays = periodSelect ? parseInt(periodSelect.value) : CHART_CONFIG.defaultDays;
    
    // Walidacja okresu
    if (isNaN(selectedDays) || selectedDays < CHART_CONFIG.minDays || selectedDays > CHART_CONFIG.maxDays) {
        selectedDays = CHART_CONFIG.defaultDays;
        console.warn(`[Daily Performance Chart] Nieprawidłowy okres, używam domyślnego: ${selectedDays} dni`);
    }
    
    try {
        // Pokaż loading
        setChartLoading(true);
        
        console.log(`[Daily Performance Chart] Pobieranie danych za ${selectedDays} dni...`);
        
        // Wywołaj API
        const response = await fetch(`/production/api/chart-data?period=${selectedDays}`, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const apiResult = await response.json();
        console.log('[Daily Performance Chart] Odpowiedź API:', apiResult);
        
        if (!apiResult.success) {
            throw new Error(apiResult.error || 'API zwróciło błąd');
        }
        
        // Przetwórz dane z API
        const chartData = processApiData(apiResult.data, selectedDays);
        
        // Aktualizuj wykres
        updateChartWithData(chartData);
        
        // Aktualizuj tytuł
        updateChartTitle(selectedDays);
        
        console.log('[Daily Performance Chart] Dane zaktualizowane pomyślnie!');
        return true;
        
    } catch (error) {
        console.error('[Daily Performance Chart] Błąd pobierania danych:', error);
        
        // Fallback do pustych danych
        console.log('[Daily Performance Chart] Używam pustych danych jako fallback...');
        const fallbackData = generateEmptyChartData(selectedDays);
        updateChartWithData(fallbackData);
        updateChartTitle(selectedDays);
        
        showChartMessage(`Błąd ładowania danych: ${error.message}`);
        return false;
        
    } finally {
        setChartLoading(false);
    }
}

/**
 * FUNKCJA POMOCNICZA: Generuje puste dane dla wykresu
 */
function generateEmptyChartData(days) {
    const labels = [];
    const cutting = [];
    const assembly = [];
    const packaging = [];
    
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        // Format: "12.09" (dzień.miesiąc)
        const label = date.toLocaleDateString('pl-PL', { 
            day: '2-digit', 
            month: '2-digit' 
        });
        
        labels.push(label);
        // NAPRAWKA: Zawsze dodaj 0, nie null lub undefined
        cutting.push(0);
        assembly.push(0);
        packaging.push(0);
    }
    
    return { labels, cutting, assembly, packaging };
}

/**
 * NAPRAWKA: Funkcja do wymuszenia ostrego renderingu po aktualizacji
 */
function makeChartSharp() {
    const canvas = document.getElementById('performance-chart-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
    
    // Wymusz pixel-perfect
    canvas.style.imageRendering = 'pixelated';
    canvas.style.imageRendering = '-moz-crisp-edges';
    canvas.style.imageRendering = 'crisp-edges';
}

/**
 * FUNKCJA POMOCNICZA: Przetwarza dane z API
 */
function processApiData(apiData, requestedDays) {
    try {
        if (apiData.chart && apiData.chart.labels && apiData.chart.datasets) {
            console.log('[Chart] Przetwarzam dane z API:', apiData.chart.datasets);

            // NAPRAWKA: Użyj rzeczywistych danych z API i przekształć na 3 linie
            const ordersData = extractDatasetData(apiData.chart.datasets, 'Ukończone zamówienia');
            const volumeData = extractDatasetData(apiData.chart.datasets, 'Objętość');
            
            console.log('[Chart] Orders data:', ordersData);
            console.log('[Chart] Volume data:', volumeData);
            
            // Jeśli nie ma danych lub same zera, użyj micro-wartości
            const hasRealData = ordersData.some(v => v > 0) || volumeData.some(v => v > 0);
            
            if (!hasRealData) {
                console.log('[Chart] API zwróciło same zera - używam micro-wartości dla widoczności linii');
                return {
                    labels: apiData.chart.labels,
                    // Przekształć na 3 linie z micro-wartościami
                    cutting: apiData.chart.labels.map(() => 0.001),   // Pomarańczowa
                    assembly: apiData.chart.labels.map(() => 0.001),  // Niebieska
                    packaging: apiData.chart.labels.map(() => 0.001)  // Zielona
                };
            } else {
                return {
                    labels: apiData.chart.labels,
                    cutting: volumeData.map(v => v * 0.4),   // 40% volume = wycinanie
                    assembly: volumeData.map(v => v * 0.35), // 35% volume = składanie  
                    packaging: volumeData.map(v => v * 0.25) // 25% volume = pakowanie
                };
            }
        } else {
            console.warn('[Chart] API nie zwróciło oczekiwanej struktury - używam pustych danych z micro-wartościami');
            return generateEmptyChartDataWithMicroValues(requestedDays);
        }
    } catch (error) {
        console.error('[Chart] Błąd przetwarzania danych API:', error);
        return generateEmptyChartDataWithMicroValues(requestedDays);
    }
}

/**
 * Nowa funkcja: generuje puste dane z micro-wartościami
 */
function generateEmptyChartDataWithMicroValues(days) {
    const labels = [];
    const cutting = [];
    const assembly = [];
    const packaging = [];
    
    const today = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        const label = date.toLocaleDateString('pl-PL', { 
            day: '2-digit', 
            month: '2-digit' 
        });
        
        labels.push(label);
        cutting.push(0.001);   // Micro-wartości zamiast 0
        assembly.push(0.001);
        packaging.push(0.001);
    }
    
    return { labels, cutting, assembly, packaging };
}

/**
 * FUNKCJA POMOCNICZA: Wyciąga dane z datasetu po nazwie
 */
function extractDatasetData(datasets, labelToFind) {
    if (!Array.isArray(datasets)) {
        console.warn('[Chart] Datasets nie jest tablicą:', datasets);
        return [];
    }
    
    // Szukaj po częściowym dopasowaniu labela
    const dataset = datasets.find(ds => {
        if (!ds.label) return false;
        const label = ds.label.toLowerCase();
        const search = labelToFind.toLowerCase();
        return label.includes(search);
    });
    
    if (dataset && Array.isArray(dataset.data)) {
        console.log(`[Chart] Znaleziono dataset dla "${labelToFind}":`, dataset.data);
        return dataset.data;
    }
    
    console.warn(`[Chart] Nie znaleziono datasetu dla "${labelToFind}"`);
    return [];
}

/**
 * FUNKCJA POMOCNICZA: Aktualizuje wykres nowymi danymi
 */
function updateChartWithData(data) {
    if (!dailyPerformanceChart || !dailyPerformanceChart.data) {
        console.error('[Daily Performance Chart] Brak wykresu do aktualizacji!');
        return;
    }
    
    try {
        // Aktualizuj labels
        dailyPerformanceChart.data.labels = [...data.labels];
        
        // NAPRAWKA: Upewnij się, że dane są liczbami, nie null/undefined
        dailyPerformanceChart.data.datasets[0].data = data.cutting.map(v => v || 0);
        dailyPerformanceChart.data.datasets[1].data = data.assembly.map(v => v || 0);
        dailyPerformanceChart.data.datasets[2].data = data.packaging.map(v => v || 0);
        
        // Odśwież wykres
        dailyPerformanceChart.update('none'); // NAPRAWKA: bez animacji dla ostrości
        
        // NAPRAWKA: Wymusz ostre renderowanie po aktualizacji
        setTimeout(makeChartSharp, 50);
        
        console.log('[Daily Performance Chart] Wykres zaktualizowany z nowymi danymi');
        
    } catch (error) {
        console.error('[Daily Performance Chart] Błąd aktualizacji wykresu:', error);
    }
}

/**
 * FUNKCJA POMOCNICZA: Aktualizuje tytuł wykresu
 */
function updateChartTitle(days) {
    if (!dailyPerformanceChart || !dailyPerformanceChart.options.plugins.title) return;
    
    dailyPerformanceChart.options.plugins.title.text = `Wydajność dzienna - ostatnie ${days} dni`;
    dailyPerformanceChart.update('none'); // Update bez animacji
}

/**
 * FUNKCJA POMOCNICZA: Ustawia stan loading wykresu
 */
function setChartLoading(isLoading) {
    const canvas = document.getElementById('performance-chart-canvas');
    if (!canvas) return;
    
    if (isLoading) {
        canvas.style.opacity = '0.5';
        canvas.style.cursor = 'wait';
    } else {
        canvas.style.opacity = '1';
        canvas.style.cursor = 'default';
    }
}

/**
 * FUNKCJA POMOCNICZA: Pokazuje wiadomość na wykresie
 */
function showChartMessage(message) {
    console.log(`[Daily Performance Chart] Wiadomość: ${message}`);
    
    // Można dodać wizualną notyfikację tutaj
    const canvas = document.getElementById('performance-chart-canvas');
    if (canvas) {
        const container = canvas.closest('.widget, .chart-container, .performance-chart');
        if (container) {
            // Dodaj tymczasową wiadomość
            let messageDiv = container.querySelector('.chart-message');
            if (!messageDiv) {
                messageDiv = document.createElement('div');
                messageDiv.className = 'chart-message';
                messageDiv.style.cssText = `
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: rgba(255, 193, 7, 0.9);
                    color: #333;
                    padding: 8px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    z-index: 1000;
                `;
                container.style.position = 'relative';
                container.appendChild(messageDiv);
            }
            
            messageDiv.textContent = message;
            
            // Usuń po 5 sekundach
            setTimeout(() => {
                if (messageDiv && messageDiv.parentNode) {
                    messageDiv.remove();
                }
            }, 5000);
        }
    }
}

/**
 * FUNKCJA POMOCNICZA: Konfiguruje selektor okresu
 */
function setupPeriodSelector() {
    const periodSelect = document.getElementById('chart-period');
    if (!periodSelect) {
        console.warn('[Daily Performance Chart] Nie znaleziono selektora okresu #chart-period');
        return;
    }
    
    // Usuń poprzednie event listenery
    periodSelect.removeEventListener('change', refreshChartData);
    
    // Dodaj nowy event listener
    periodSelect.addEventListener('change', refreshChartData);
    
    console.log('[Daily Performance Chart] Event listener dla zmiany okresu skonfigurowany');
}

/**
 * FUNKCJA POMOCNICZA: Czyszczenie wykresu
 */
function destroyDailyPerformanceChart() {
    if (dailyPerformanceChart) {
        try {
            dailyPerformanceChart.destroy();
            console.log('[Daily Performance Chart] Wykres zniszczony');
        } catch (error) {
            console.error('[Daily Performance Chart] Błąd niszczenia wykresu:', error);
        }
        
        dailyPerformanceChart = null;
        isChartReady = false;
    }
}

console.log('[Daily Performance Chart] Moduł załadowany - funkcje gotowe do użycia!');

// ============================================================================
// FUNKCJE BŁĘDÓW SYSTEMU
// ============================================================================

/**
 * Wyświetla modal z błędami systemu - wersja bez Bootstrap
 */
async function showSystemErrorsModal() {
    console.log('[System Errors] Otwieranie modala błędów systemu...');
    
    const modal = document.getElementById('systemErrorsModal');
    const loadingDiv = document.getElementById('errors-loading');
    const emptyDiv = document.getElementById('errors-empty');
    const errorsList = document.getElementById('errors-list');
    
    if (!modal) {
        console.error('[System Errors] Nie znaleziono modala systemErrorsModal');
        return;
    }
    
    // Pokaż modal - vanilla JS
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    
    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade show';
    backdrop.id = 'errors-modal-backdrop';
    document.body.appendChild(backdrop);
    
    // Zamknięcie na backdrop click
    backdrop.addEventListener('click', closeSystemErrorsModal);
    
    // Zamknięcie na ESC
    document.addEventListener('keydown', handleModalEscape);
    
    // Pokaż loading
    if (loadingDiv) loadingDiv.style.display = 'block';
    if (emptyDiv) emptyDiv.style.display = 'none';
    if (errorsList) errorsList.innerHTML = '';
    
    try {
        // Pobierz błędy z API
        const response = await fetch('/production/admin/ajax/system-errors', {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            displaySystemErrors(data.errors || []);
        } else {
            throw new Error(data.error || 'Błąd pobierania błędów');
        }
        
    } catch (error) {
        console.error('[System Errors] Błąd ładowania:', error);
        if (errorsList) {
            errorsList.innerHTML = `
                <div class="alert alert-danger">
                    <h6>Błąd ładowania</h6>
                    <p>Nie można pobrać listy błędów: ${error.message}</p>
                </div>
            `;
        }
    } finally {
        if (loadingDiv) loadingDiv.style.display = 'none';
    }
}

/**
 * Zamyka modal błędów - vanilla JS
 */
function closeSystemErrorsModal() {
    const modal = document.getElementById('systemErrorsModal');
    const backdrop = document.getElementById('errors-modal-backdrop');
    
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
    }
    
    if (backdrop) {
        backdrop.remove();
    }
    
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', handleModalEscape);
}

/**
 * Obsługa ESC w modalu
 */
function handleModalEscape(event) {
    if (event.key === 'Escape') {
        closeSystemErrorsModal();
    }
}

/**
 * Wyświetla błędy w modalzie
 */
function displaySystemErrors(errors) {
    const errorsList = document.getElementById('errors-list');
    const emptyDiv = document.getElementById('errors-empty');
    
    if (!errors || errors.length === 0) {
        if (emptyDiv) emptyDiv.style.display = 'block';
        if (errorsList) errorsList.innerHTML = '';
        return;
    }
    
    if (emptyDiv) emptyDiv.style.display = 'none';
    
    const errorsHtml = errors.map(error => {
        const errorTitle = getErrorTitle(error.error_type);
        const errorDescription = getErrorDescription(error.error_type, error.error_message);
        const errorTime = formatErrorDateTime(error.error_occurred_at);
        
        return `
            <div class="error-item">
                <div class="error-header">
                    <div class="error-icon">
                        ${getErrorIcon(error.error_type)}
                    </div>
                    <div class="error-info">
                        <h6 class="error-title">${errorTitle}</h6>
                        <small class="text-muted">${errorTime}</small>
                    </div>
                    <div class="error-status">
                        ${error.is_resolved ? 
                            '<span class="badge bg-success">Rozwiązane</span>' : 
                            '<span class="badge bg-danger">Aktywne</span>'
                        }
                    </div>
                </div>
                <div class="error-description">
                    <p>${errorDescription}</p>
                </div>
                ${error.related_product_id ? `
                    <div class="error-context">
                        <small><strong>Dotyczy produktu:</strong> ${error.related_product_id}</small>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    if (errorsList) errorsList.innerHTML = errorsHtml;
}

/**
 * Tłumaczy typ błędu na czytelny tytuł
 */
function getErrorTitle(errorType) {
    const titles = {
        'sync_error': 'Problem z synchronizacją danych',
        'parsing_error': 'Błąd przetwarzania danych zamówienia',
        'workflow_error': 'Problem w przepływie produkcyjnym',
        'api_error': 'Błąd połączenia z Baselinker',
        'security_error': 'Problem bezpieczeństwa',
        'validation_error': 'Nieprawidłowe dane zamówienia'
    };
    return titles[errorType] || 'Nieznany błąd systemu';
}

/**
 * Tłumaczy komunikat błędu na polski
 */
function getErrorDescription(errorType, errorMessage) {
    // Podstawowe tłumaczenia
    const translations = {
        'Connection timeout': 'Przekroczono limit czasu połączenia z systemem zewnętrznym',
        'Invalid API response': 'Otrzymano nieprawidłową odpowiedź z systemu Baselinker',
        'Product not found': 'Nie znaleziono produktu w bazie danych',
        'Order processing failed': 'Nie udało się przetworzyć zamówienia'
    };
    
    if (translations[errorMessage]) {
        return translations[errorMessage];
    }
    
    // Wyjaśnienia według typu
    switch (errorType) {
        case 'sync_error':
            return 'System nie może zsynchronizować danych z Baselinker. Sprawdź połączenie internetowe i status API Baselinker.';
        case 'parsing_error':
            return 'Dane zamówienia zawierają nieprawidłowe informacje, których system nie może przetworzyć.';
        case 'api_error':
            return 'Wystąpił problem z komunikacją z systemem Baselinker. Sprawdź ustawienia API.';
        case 'workflow_error':
            return 'Produkt nie może przejść do następnego etapu produkcji z powodu niespełnionych wymagań.';
        default:
            return errorMessage || 'Wystąpił nieznany błąd w systemie.';
    }
}

/**
 * Zwraca ikonę dla typu błędu
 */
function getErrorIcon(errorType) {
    const icons = {
        'sync_error': '🔄',
        'parsing_error': '📋',
        'workflow_error': '⚙️',
        'api_error': '🌐',
        'security_error': '🔒',
        'validation_error': '⚠️'
    };
    return icons[errorType] || '❗';
}

/**
 * Formatuje datę błędu
 */
function formatErrorDateTime(dateString) {
    if (!dateString) return 'Nieznana data';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleString('pl-PL', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        return 'Nieprawidłowa data';
    }
}

/**
 * Czyści błędy z poziomu modala - bez Bootstrap
 */
async function clearSystemErrorsFromModal() {
    try {
        const response = await fetch('/production/admin/ajax/clear-system-errors', {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Wszystkie błędy zostały wyczyszczone', 'success');
            
            // Zamknij modal
            closeSystemErrorsModal();
            
            // Odśwież dashboard
            loadDashboardData();
        } else {
            throw new Error(data.error || 'Błąd czyszczenia błędów');
        }
        
    } catch (error) {
        console.error('[Clear Errors] Błąd:', error);
        showNotification('Błąd czyszczenia błędów: ' + error.message, 'error');
    }
}

// Funkcje timera pozostają bez zmian
let refreshTimer = null;
let refreshTimeoutId = null;

/**
 * Odświeża system z timerem
 */
async function refreshSystemWithTimer() {
    console.log('[System Refresh] Uruchamianie odświeżania systemu z timerem...');
    
    const refreshBtn = document.getElementById('refresh-system-btn');
    
    if (!refreshBtn) {
        console.error('[System Refresh] Nie znaleziono przycisku refresh-system-btn');
        return;
    }
    
    const refreshText = refreshBtn.querySelector('.refresh-text');
    const refreshIcon = refreshBtn.querySelector('.refresh-icon');
    const timerSpan = document.getElementById('refresh-timer');
    
    // Wyłącz przycisk na czas odświeżania
    refreshBtn.disabled = true;
    if (refreshIcon) refreshIcon.textContent = '⏳';
    if (refreshText) refreshText.textContent = 'Odświeżanie...';
    
    try {
        // Wykonaj odświeżenie
        await loadDashboardData();
        
        showNotification('System został odświeżony pomyślnie', 'success');
        
        // Rozpocznij countdown timer
        startRefreshTimer();
        
    } catch (error) {
        console.error('[System Refresh] Błąd:', error);
        showNotification('Błąd odświeżania systemu', 'error');
    } finally {
        // Przywróć przycisk
        refreshBtn.disabled = false;
        if (refreshIcon) refreshIcon.textContent = '🔄';
        if (refreshText) refreshText.textContent = 'Odśwież system';
    }
}

/**
 * Uruchamia timer odliczający do następnego odświeżenia
 */
function startRefreshTimer() {
    const timerSpan = document.getElementById('refresh-timer');
    
    if (!timerSpan) {
        console.warn('[Refresh Timer] Nie znaleziono elementu refresh-timer');
        return;
    }
    
    // Wyczyść poprzedni timer
    clearRefreshTimer();
    
    // Ustaw czas na 30 sekund
    let timeLeft = 30;
    timerSpan.textContent = `(${timeLeft}s)`;
    timerSpan.style.display = 'inline';
    
    refreshTimer = setInterval(() => {
        timeLeft--;
        timerSpan.textContent = `(${timeLeft}s)`;
        
        if (timeLeft <= 0) {
            clearRefreshTimer();
            // Automatyczne odświeżenie po upływie timera
            loadDashboardData();
        }
    }, 1000);
    
    // Timeout na wypadek gdyby interval nie zadziałał
    refreshTimeoutId = setTimeout(() => {
        clearRefreshTimer();
        loadDashboardData();
    }, 30000);
}

/**
 * Czyści timer odświeżania
 */
function clearRefreshTimer() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    
    if (refreshTimeoutId) {
        clearTimeout(refreshTimeoutId);
        refreshTimeoutId = null;
    }
    
    const timerSpan = document.getElementById('refresh-timer');
    if (timerSpan) {
        timerSpan.style.display = 'none';
        timerSpan.textContent = '';
    }
}

// Poprawiona funkcja clearSystemErrors
async function clearSystemErrors() {
    console.log('[Production Dashboard] Czyszczenie błędów systemu...');
    
    try {
        const response = await fetch('/production/admin/ajax/clear-system-errors', {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('Błędy systemu zostały wyczyszczone', 'success');
            // Odśwież dane dashboardu
            loadDashboardData();
        } else {
            throw new Error(data.error || 'Błąd czyszczenia błędów');
        }
        
    } catch (error) {
        console.error('[Clear System Errors] Błąd:', error);
        showNotification('Błąd czyszczenia błędów: ' + error.message, 'error');
    }
}

// ============================================================================
// EXPORT / GLOBAL ACCESS
// ============================================================================

// Udostępnij funkcje globalnie
window.triggerManualSync = handleManualSync;
window.clearSystemErrors = clearSystemErrors;
window.refreshSystemHealth = refreshSystemHealth;
window.createDailyPerformanceChart = createDailyPerformanceChart;
window.refreshChartData = refreshChartData;
window.destroyDailyPerformanceChart = destroyDailyPerformanceChart;

window.showSystemErrorsModal = showSystemErrorsModal;
window.closeSystemErrorsModal = closeSystemErrorsModal;
window.clearSystemErrorsFromModal = clearSystemErrorsFromModal;
window.refreshSystemWithTimer = refreshSystemWithTimer;
window.startRefreshTimer = startRefreshTimer;
window.clearRefreshTimer = clearRefreshTimer;

// Eksport głównego obiektu
window.ProductionDashboard = ProductionDashboard;

console.log('[Production Dashboard] Moduł załadowany pomyślnie');