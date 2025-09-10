/**
 * Production Dashboard JavaScript
 * ===============================
 * 
 * Funkcjonalność dla dashboard modułu produkcji:
 * - Real-time aktualizacja statystyk
 * - AJAX calls do API
 * - Obsługa manuel sync
 * - Chart.js integration
 * - Auto-refresh mechanizm
 * - Error handling i user feedback
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 1.0
 * Data: 2025-01-10
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

    // API endpoints
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

    // Sprawdź dostępność danych
    if (typeof window.productionStats === 'undefined') {
        console.warn('[Production Dashboard] Brak danych początkowych');
        window.productionStats = {};
    }

    // Inicjalizacja komponentów
    initEventListeners();
    initAutoRefresh();
    updateDateTime();

    // Załaduj dane początkowe
    if (Object.keys(window.productionStats).length > 0) {
        updateDashboardData(window.productionStats);
    } else {
        loadDashboardData();
    }

    // Inicjalizuj wykres dla adminów
    if (window.currentUser && window.currentUser.role === 'admin') {
        initPerformanceChart();
    }

    console.log('[Production Dashboard] Inicjalizacja zakończona');
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

// ============================================================================
// ŁADOWANIE DANYCH
// ============================================================================

/**
 * Ładuje dane dashboard z API
 */
async function loadDashboardData() {
    if (ProductionDashboard.state.isLoading) {
        console.log('[Production Dashboard] Ładowanie w toku - pomijam');
        return;
    }

    ProductionDashboard.state.isLoading = true;
    updateLoadingState(true);

    try {
        console.log('[Production Dashboard] Ładowanie danych...');

        const response = await fetch(ProductionDashboard.endpoints.dashboardStats, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success) {
            updateDashboardData(data.data);
            ProductionDashboard.state.lastUpdate = new Date();
            ProductionDashboard.state.retryCount = 0;
            updateStatusIndicator('active', 'System aktywny');
        } else {
            throw new Error(data.error || 'Nieznany błąd API');
        }

    } catch (error) {
        console.error('[Production Dashboard] Błąd ładowania danych:', error);
        handleLoadError(error);
    } finally {
        ProductionDashboard.state.isLoading = false;
        updateLoadingState(false);
    }
}

/**
 * Aktualizuje dane na dashboard
 */
function updateDashboardData(data) {
    console.log('[Production Dashboard] Aktualizacja danych:', data);

    try {
        // Aktualizuj statystyki stanowisk
        if (data.stations) {
            updateStationsStats(data.stations);
        }

        // Aktualizuj podsumowanie dzisiejsze
        if (data.today_totals) {
            updateTodayTotals(data.today_totals);
        }

        // Aktualizuj alerty terminów
        if (data.deadline_alerts) {
            updateDeadlineAlerts(data.deadline_alerts);
        }

        // Aktualizuj system health
        if (data.system_health) {
            updateSystemHealth(data.system_health);
        }

        // Aktualizuj last updated timestamps
        updateLastUpdatedTimestamps();

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
 * Aktualizuje status stanowiska
 */
function updateStationStatus(statusElement, stats) {
    const statusDot = statusElement.querySelector('.status-dot');
    if (!statusDot) return;

    // Usuń poprzednie klasy
    statusDot.classList.remove('active', 'warning', 'danger');

    // Określ status na podstawie danych
    let statusClass = 'active';

    if (stats.pending_count > 20) {
        statusClass = 'danger';
    } else if (stats.pending_count > 10) {
        statusClass = 'warning';
    } else if (stats.pending_count === 0) {
        statusClass = 'inactive';
    }

    statusDot.classList.add(statusClass);
}

/**
 * Aktualizuje dzisiejsze podsumowanie
 */
function updateTodayTotals(totals) {
    const completedElement = document.getElementById('today-completed');
    const totalM3Element = document.getElementById('today-total-m3');
    const avgDeadlineElement = document.getElementById('today-avg-deadline');

    if (completedElement) {
        completedElement.textContent = totals.completed_orders || '0';
    }

    if (totalM3Element) {
        totalM3Element.textContent = (totals.total_m3 || 0).toFixed(2) + ' m³';
    }

    if (avgDeadlineElement) {
        const avgDays = totals.avg_deadline_distance || 0;
        avgDeadlineElement.textContent = avgDays.toFixed(1) + ' dni';
    }
}

/**
 * Aktualizuje alerty terminów
 */
function updateDeadlineAlerts(alerts) {
    const alertsList = document.getElementById('alerts-list');
    const alertsCount = document.getElementById('alerts-count');

    if (!alertsList) return;

    // Aktualizuj licznik
    if (alertsCount) {
        alertsCount.textContent = alerts.length;
    }

    // Wyczyść listę
    alertsList.innerHTML = '';

    if (alerts.length === 0) {
        alertsList.innerHTML = '<div class="loading-state">Brak alertów terminów</div>';
        return;
    }

    // Dodaj alerty
    alerts.forEach(alert => {
        const alertElement = createAlertElement(alert);
        alertsList.appendChild(alertElement);
    });
}

/**
 * Tworzy element alertu
 */
function createAlertElement(alert) {
    const div = document.createElement('div');
    div.className = `alert-item ${getAlertSeverity(alert.days_remaining)}`;

    div.innerHTML = `
        <div class="alert-info">
            <div class="alert-product-id">${alert.product_id}</div>
            <div class="alert-details">Stanowisko: ${alert.current_station}</div>
        </div>
        <div class="alert-deadline ${getAlertSeverity(alert.days_remaining)}">
            ${alert.days_remaining} dni
        </div>
    `;

    return div;
}

/**
 * Określa wagę alertu
 */
function getAlertSeverity(daysRemaining) {
    if (daysRemaining <= 0) return 'danger';
    if (daysRemaining <= 2) return 'warning';
    return 'info';
}

/**
 * Aktualizuje system health
 */
function updateSystemHealth(health) {
    // Last sync
    const lastSyncElement = document.getElementById('last-sync-time');
    const syncStatusElement = document.getElementById('sync-status');

    if (lastSyncElement && health.last_sync) {
        lastSyncElement.textContent = formatDateTime(new Date(health.last_sync));
    }

    if (syncStatusElement) {
        updateHealthStatus(syncStatusElement, health.sync_status);
    }

    // Database
    const dbResponseElement = document.getElementById('db-response-time');
    const dbStatusElement = document.getElementById('db-status');

    if (dbResponseElement && health.database) {
        dbResponseElement.textContent = health.database.response_time + 'ms';
    }

    if (dbStatusElement) {
        updateHealthStatus(dbStatusElement, health.database.status);
    }

    // API
    const apiResponseElement = document.getElementById('api-response-time');
    const apiStatusElement = document.getElementById('api-status');

    if (apiResponseElement && health.api) {
        apiResponseElement.textContent = health.api.response_time + 'ms';
    }

    if (apiStatusElement) {
        updateHealthStatus(apiStatusElement, health.api.status);
    }

    // Errors
    const errorCountElement = document.getElementById('error-count');
    const errorsStatusElement = document.getElementById('errors-status');

    if (errorCountElement && health.errors) {
        errorCountElement.textContent = health.errors.count || '0';
    }

    if (errorsStatusElement) {
        const status = (health.errors && health.errors.count > 0) ? 'error' : 'ok';
        updateHealthStatus(errorsStatusElement, status);
    }

    // Health indicator główny
    updateMainHealthIndicator(health);
}

/**
 * Aktualizuje status health elementu
 */
function updateHealthStatus(element, status) {
    // Usuń poprzednie klasy
    element.classList.remove('ok', 'warning', 'error');

    // Dodaj nową klasę
    element.classList.add(status);
    element.textContent = status.toUpperCase();
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

    if (health.errors && health.errors.count > 0) {
        overallStatus = 'error';
    } else if (health.api && health.api.status !== 'ok') {
        overallStatus = 'warning';
    } else if (health.database && health.database.status !== 'ok') {
        overallStatus = 'error';
    }

    healthDot.classList.add(overallStatus);
}

// ============================================================================
// MANUAL SYNC
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
        console.log('[Production Dashboard] Manual sync...');

        const response = await fetch(ProductionDashboard.endpoints.manualSync, {
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

// ============================================================================
// CHART FUNCTIONALITY
// ============================================================================

/**
 * Inicjalizuje wykres wydajności
 */
function initPerformanceChart() {
    const canvas = document.getElementById('performance-chart-canvas');
    if (!canvas || typeof Chart === 'undefined') return;

    const ctx = canvas.getContext('2d');

    ProductionDashboard.state.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Wycinanie (m³)',
                    data: [],
                    borderColor: ProductionDashboard.config.chartColors.cutting,
                    backgroundColor: ProductionDashboard.config.chartColors.cutting + '20',
                    tension: 0.4
                },
                {
                    label: 'Składanie (m³)',
                    data: [],
                    borderColor: ProductionDashboard.config.chartColors.assembly,
                    backgroundColor: ProductionDashboard.config.chartColors.assembly + '20',
                    tension: 0.4
                },
                {
                    label: 'Pakowanie (m³)',
                    data: [],
                    borderColor: ProductionDashboard.config.chartColors.packaging,
                    backgroundColor: ProductionDashboard.config.chartColors.packaging + '20',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Wolumen (m³)'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });

    // Załaduj dane wykresu
    loadChartData();
}

/**
 * Ładuje dane dla wykresu
 */
async function loadChartData(period = 7) {
    if (!ProductionDashboard.state.chart) return;

    try {
        const response = await fetch(`/production/api/chart-data?period=${period}`, {
            credentials: 'same-origin'
        });

        if (response.ok) {
            const data = await response.json();
            updateChartData(data);
        }
    } catch (error) {
        console.error('[Production Dashboard] Błąd ładowania danych wykresu:', error);
    }
}

/**
 * Aktualizuje dane wykresu
 */
function updateChartData(data) {
    const chart = ProductionDashboard.state.chart;

    chart.data.labels = data.labels;
    chart.data.datasets[0].data = data.cutting;
    chart.data.datasets[1].data = data.assembly;
    chart.data.datasets[2].data = data.packaging;

    chart.update();
}

/**
 * Aktualizuje wykres (zmiana okresu)
 */
function updateChart() {
    const periodSelect = document.getElementById('chart-period');
    if (periodSelect) {
        loadChartData(parseInt(periodSelect.value));
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Aktualizuje stan loading
 */
function updateLoadingState(isLoading) {
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.textContent = isLoading ? 'Ładowanie...' : 'System aktywny';
    }
}

/**
 * Aktualizuje wskaźnik status
 */
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

/**
 * Aktualizuje timestampy ostatniej aktualizacji
 */
function updateLastUpdatedTimestamps() {
    const now = new Date();
    const timeString = formatDateTime(now);

    document.querySelectorAll('.last-updated').forEach(element => {
        element.textContent = `Aktualizacja: ${timeString}`;
    });
}

/**
 * Aktualizuje datę i czas
 */
function updateDateTime() {
    const todayDateElement = document.getElementById('today-date');
    if (todayDateElement) {
        todayDateElement.textContent = formatDate(new Date());
    }

    // Aktualizuj co minutę
    setTimeout(updateDateTime, 60000);
}

/**
 * Formatuje datę i czas
 */
function formatDateTime(date) {
    return date.toLocaleString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit'
    });
}

/**
 * Formatuje datę
 */
function formatDate(date) {
    return date.toLocaleDateString('pl-PL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Obsługuje kliknięcie karty stanowiska
 */
function handleStationCardClick(event) {
    const card = event.currentTarget;
    const station = card.dataset.station;

    if (station) {
        window.location.href = `/production/${station}`;
    }
}

/**
 * Obsługuje zmianę widoczności strony
 */
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

/**
 * Obsługuje błędy ładowania
 */
function handleLoadError(error) {
    ProductionDashboard.state.retryCount++;

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
 * System health actions
 */
function clearSystemErrors() {
    // Implementacja czyszczenia błędów
    console.log('[Production Dashboard] Czyszczenie błędów systemu...');
    showNotification('Błędy systemu zostały wyczyszczone', 'success');
}

function refreshSystemHealth() {
    console.log('[Production Dashboard] Odświeżanie statusu systemu...');
    loadDashboardData();
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