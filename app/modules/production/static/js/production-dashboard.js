/**
 * Production Dashboard JavaScript - KOMPLETNY REFAKTOR Z WYKRESAMI
 * ===============================================================
 * 
 * Zintegrowany system tabów AJAX + Widget wydajności dziennej
 * Przeniesione wszystkie funkcje z HTML do pliku JS
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 4.0 - Kompletny system z wykresami
 * Data: 2025-09-14
 */

// ============================================================================
// KONFIGURACJA GLOBALNA I STAN
// ============================================================================

const TabDashboard = {
    state: {
        currentActiveTab: 'dashboard-tab',
        refreshInterval: null,
        isLoading: false,
        retryCount: 0
    },
    config: {
        refreshIntervalMs: 180000, // 3 minuty
        maxRetries: 3,
        retryDelayMs: 2000
    },
    endpoints: {}
};

// Stan wykresów wydajności
let dailyPerformanceChart = null;
let chartPeriod = 7;
let chartRefreshTimeout = null;
let chartDataCache = new Map();
let autoRefreshInterval = null;

// Cache i zmienne pomocnicze
const CACHE_DURATION = 5 * 60 * 1000; // 5 minut
const AUTO_REFRESH_DELAY = 5 * 60 * 1000; // 5 minut
let lastApiCall = null;

// ============================================================================
// INICJALIZACJA GŁÓWNA
// ============================================================================

/**
 * Główna funkcja inicjalizacji - uruchamiana po załadowaniu DOM
 */
function initTabDashboard() {
    console.log('[Tab Dashboard] Inicjalizacja systemu tabów...');
    updateSystemStatus('loading', 'Sprawdzanie konfiguracji...');
    
    // Załaduj konfigurację z window.productionConfig (ustawiane w HTML)
    if (typeof window.productionConfig !== 'undefined') {
        TabDashboard.endpoints = window.productionConfig.endpoints;
        console.log('[Tab Dashboard] Załadowano endpointy:', TabDashboard.endpoints);
    } else {
        console.error('[Tab Dashboard] Brak window.productionConfig - używam fallback');
        TabDashboard.endpoints = {
            dashboardTabContent: '/production/api/dashboard-tab-content',
            productsTabContent: '/production/api/products-tab-content',
            reportsTabContent: '/production/api/reports-tab-content',
            stationsTabContent: '/production/api/stations-tab-content',
            configTabContent: '/production/api/config-tab-content',
            chartData: '/production/api/chart-data'
        };
    }
    
    // Dodaj endpoint dla wykresów jeśli nie istnieje
    if (!TabDashboard.endpoints.chartData) {
        TabDashboard.endpoints.chartData = '/production/api/chart-data';
    }
    
    initTabEventListeners();
    setupAutoRefresh();
    loadTabContent('dashboard-tab');
    
    setTimeout(() => {
        checkSystemOverallHealth();
    }, 2000);
    
    console.log('[Tab Dashboard] Inicjalizacja zakończona');
}

/**
 * Inicjalizuje event listenery
 */
function initTabEventListeners() {
    // Tab buttons
    document.querySelectorAll('[data-bs-toggle="tab"]').forEach(tabButton => {
        tabButton.addEventListener('click', handleTabClick);
    });
    
    // System refresh button
    const refreshBtn = document.getElementById('refresh-system-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', handleSystemRefresh);
    }
    
    // Obsługa widoczności strony
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    console.log('[Tab Dashboard] Event listenery zainicjalizowane');
}

// ============================================================================
// WIDGET WYDAJNOŚCI DZIENNEJ - IMPLEMENTACJA
// ============================================================================

/**
 * Główna funkcja inicjalizacji wykresu wydajności dziennej
 */
function createDailyPerformanceChart() {
    console.log('[Performance Chart] Inicjalizacja wykresu wydajności dziennej');
    
    // Sprawdź uprawnienia
    if (window.productionConfig?.currentUser?.role !== 'admin') {
        console.log('[Performance Chart] Brak uprawnień - widget nie zostanie załadowany');
        return;
    }
    
    // Sprawdź Chart.js
    if (typeof Chart === 'undefined') {
        console.error('[Performance Chart] Chart.js nie jest załadowany');
        showChartError('Błąd: Chart.js nie jest dostępny');
        return;
    }
    
    initChartControls();
    loadChartDataWithRetry(chartPeriod);
    enableAutoRefresh();
}

/**
 * Inicjalizuje kontrolki wykresu
 */
function initChartControls() {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) {
        console.error('[Performance Chart] Widget nie znaleziony');
        return;
    }
    
    let controlsContainer = chartWidget.querySelector('.chart-controls');
    if (!controlsContainer) {
        const widgetHeader = chartWidget.querySelector('.widget-header');
        if (widgetHeader) {
            controlsContainer = document.createElement('div');
            controlsContainer.className = 'chart-controls';
            widgetHeader.appendChild(controlsContainer);
        }
    }
    
    if (controlsContainer) {
        controlsContainer.innerHTML = `
            <select id="chart-period-select" class="form-select form-select-sm">
                <option value="7" ${chartPeriod === 7 ? 'selected' : ''}>Ostatnie 7 dni</option>
                <option value="14" ${chartPeriod === 14 ? 'selected' : ''}>Ostatnie 14 dni</option>
                <option value="30" ${chartPeriod === 30 ? 'selected' : ''}>Ostatnie 30 dni</option>
            </select>
            <button id="chart-refresh-btn" class="btn btn-outline-primary btn-sm" title="Odśwież wykres">
                <i class="fas fa-sync-alt"></i>
            </button>
        `;
        
        // Event listenery
        const periodSelect = document.getElementById('chart-period-select');
        const refreshBtn = document.getElementById('chart-refresh-btn');
        
        if (periodSelect) {
            periodSelect.addEventListener('change', handlePeriodChange);
        }
        
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                clearChartCache();
                loadChartDataWithRetry(chartPeriod);
            });
        }
        
        enhanceChartAccessibility();
    }
}

/**
 * Obsługuje zmianę okresu z debouncing
 */
function handlePeriodChange(event) {
    const newPeriod = parseInt(event.target.value);
    console.log('[Performance Chart] Zmiana okresu na:', newPeriod, 'dni');
    
    if (chartRefreshTimeout) {
        clearTimeout(chartRefreshTimeout);
    }
    
    chartRefreshTimeout = setTimeout(() => {
        chartPeriod = newPeriod;
        clearChartCache();
        loadChartDataWithRetry(chartPeriod);
        trackChartUsage('period_changed', { period: newPeriod });
    }, 300);
}

/**
 * Ładuje dane z retry mechanizmem
 */
async function loadChartDataWithRetry(period, retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000;
    
    try {
        await loadChartDataWithCache(period);
    } catch (error) {
        console.error(`[Performance Chart] Próba ${retryCount + 1} nieudana:`, error);
        
        if (retryCount < maxRetries) {
            console.log(`[Performance Chart] Ponowna próba za ${retryDelay}ms...`);
            showChartRetrying(retryCount + 1, maxRetries);
            
            setTimeout(() => {
                loadChartDataWithRetry(period, retryCount + 1);
            }, retryDelay);
        } else {
            console.error('[Performance Chart] Wszystkie próby wyczerpane');
            showChartError(`Nie udało się załadować danych po ${maxRetries + 1} próbach. Sprawdź połączenie internetowe.`);
            addRetryButton(period);
        }
    }
}

/**
 * Ładuje dane z cache lub API
 */
async function loadChartDataWithCache(period) {
    const cacheKey = `chart_data_${period}`;
    const now = Date.now();
    
    // Sprawdź cache
    if (chartDataCache.has(cacheKey)) {
        const cached = chartDataCache.get(cacheKey);
        if (now - cached.timestamp < CACHE_DURATION) {
            console.log('[Performance Chart] Używam danych z cache dla okresu:', period);
            hideChartLoading();
            createOrUpdateChart(cached.data.chart_data, cached.data.summary);
            updateChartSummary(cached.data.summary);
            return;
        } else {
            chartDataCache.delete(cacheKey);
        }
    }
    
    // Załaduj z API
    await loadChartData(period);
}

/**
 * Pobiera dane z API
 */
async function loadChartData(period) {
    console.log('[Performance Chart] Ładowanie danych dla okresu:', period, 'dni');
    
    try {
        showChartLoading();
        hideChartError();
        
        const endpoint = `${TabDashboard.endpoints.chartData}?period=${period}`;
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Nieznany błąd API');
        }
        
        console.log('[Performance Chart] Otrzymano dane:', data);
        
        // Cache successful response
        const cacheKey = `chart_data_${period}`;
        chartDataCache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        
        hideChartLoading();
        createOrUpdateChart(data.chart_data, data.summary);
        updateChartSummary(data.summary);
        
        trackChartUsage('chart_loaded', { period: period });
        
    } catch (error) {
        console.error('[Performance Chart] Błąd ładowania danych:', error);
        hideChartLoading();
        throw error; // Re-throw dla retry mechanizmu
    }
}

/**
 * Tworzy lub aktualizuje wykres Chart.js
 */
function createOrUpdateChart(chartData, summary) {
    const canvas = document.getElementById('performance-chart-canvas');
    if (!canvas) {
        console.error('[Performance Chart] Canvas nie znaleziony');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // Zniszcz istniejący wykres
    if (dailyPerformanceChart) {
        dailyPerformanceChart.destroy();
    }
    
    const config = {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: {
                    display: true,
                    text: `Wydajność produkcji (${summary.period_days} dni)`,
                    font: {
                        size: 14,
                        weight: 'bold'
                    }
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            return `Data: ${context[0].label}`;
                        },
                        label: function(context) {
                            const value = context.raw.toFixed(2);
                            return `${context.dataset.label}: ${value} m³`;
                        },
                        footer: function(context) {
                            let sum = 0;
                            context.forEach(function(tooltipItem) {
                                sum += tooltipItem.raw;
                            });
                            return `Łącznie: ${sum.toFixed(2)} m³`;
                        }
                    },
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    footerColor: '#fff',
                    borderColor: '#ddd',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Dzień',
                        font: { weight: 'bold' }
                    },
                    grid: {
                        display: true,
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Objętość (m³)',
                        font: { weight: 'bold' }
                    },
                    beginAtZero: true,
                    grid: {
                        display: true,
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(1) + ' m³';
                        }
                    }
                }
            },
            elements: {
                point: {
                    radius: 4,
                    hoverRadius: 8,
                    borderWidth: 2,
                    hoverBorderWidth: 3
                },
                line: {
                    borderWidth: 3,
                    tension: 0.4
                }
            },
            animation: {
                duration: 750,
                easing: 'easeInOutQuart'
            }
        }
    };
    
    dailyPerformanceChart = new Chart(ctx, config);
    console.log('[Performance Chart] Wykres utworzony pomyślnie');
}

/**
 * Aktualizuje sekcję podsumowania
 */
function updateChartSummary(summary) {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) return;
    
    let summaryContainer = chartWidget.querySelector('.chart-summary');
    if (!summaryContainer) {
        summaryContainer = document.createElement('div');
        summaryContainer.className = 'chart-summary';
        chartWidget.querySelector('.widget-content').appendChild(summaryContainer);
    }
    
    const summaryHTML = `
        <div class="chart-summary-grid">
            <div class="summary-item">
                <span class="summary-label">Łączna objętość</span>
                <span class="summary-value">${summary.total_period_volume} m³</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Śr. dzienna (wycinanie)</span>
                <span class="summary-value">${summary.avg_daily.cutting} m³</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Śr. dzienna (składanie)</span>
                <span class="summary-value">${summary.avg_daily.assembly} m³</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Śr. dzienna (pakowanie)</span>
                <span class="summary-value">${summary.avg_daily.packaging} m³</span>
            </div>
            ${summary.best_day.date ? `
            <div class="summary-item">
                <span class="summary-label">Najlepszy dzień</span>
                <span class="summary-value trend-up">${summary.best_day.date} (${summary.best_day.volume} m³)</span>
            </div>
            ` : ''}
        </div>
    `;
    
    summaryContainer.innerHTML = summaryHTML;
}

// ============================================================================
// FUNKCJE POMOCNICZE WYKRESÓW
// ============================================================================

function showChartLoading() {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) return;
    
    const widgetContent = chartWidget.querySelector('.widget-content');
    if (!widgetContent) return;
    
    const existingLoader = widgetContent.querySelector('.chart-loader');
    if (existingLoader) existingLoader.remove();
    
    const loader = document.createElement('div');
    loader.className = 'chart-loader';
    loader.innerHTML = `
        <div class="spinner"></div>
        <span>Ładowanie danych wykresu...</span>
    `;
    
    widgetContent.appendChild(loader);
    
    const periodSelect = document.getElementById('chart-period-select');
    const refreshBtn = document.getElementById('chart-refresh-btn');
    if (periodSelect) periodSelect.disabled = true;
    if (refreshBtn) refreshBtn.disabled = true;
}

function hideChartLoading() {
    const loader = document.querySelector('.chart-loader');
    if (loader) loader.remove();
    
    const periodSelect = document.getElementById('chart-period-select');
    const refreshBtn = document.getElementById('chart-refresh-btn');
    if (periodSelect) periodSelect.disabled = false;
    if (refreshBtn) refreshBtn.disabled = false;
}

function showChartError(message) {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) return;
    
    const widgetContent = chartWidget.querySelector('.widget-content');
    if (!widgetContent) return;
    
    hideChartError();
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'chart-error alert alert-danger alert-dismissible';
    errorDiv.innerHTML = `
        <strong>Błąd wykresu:</strong> ${message}
        <button type="button" class="btn-close" onclick="hideChartError()"></button>
    `;
    
    widgetContent.appendChild(errorDiv);
}

function hideChartError() {
    const error = document.querySelector('.chart-error');
    if (error) error.remove();
}

function showChartRetrying(currentAttempt, maxAttempts) {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) return;
    
    const widgetContent = chartWidget.querySelector('.widget-content');
    if (!widgetContent) return;
    
    hideChartLoading();
    
    const retryLoader = document.createElement('div');
    retryLoader.className = 'chart-loader retry-loader';
    retryLoader.innerHTML = `
        <div class="spinner"></div>
        <span>Ponowna próba ${currentAttempt}/${maxAttempts}...</span>
    `;
    
    widgetContent.appendChild(retryLoader);
}

function addRetryButton(period) {
    const errorDiv = document.querySelector('.chart-error');
    if (!errorDiv) return;
    
    const retryButton = document.createElement('button');
    retryButton.className = 'btn btn-outline-primary btn-sm mt-2';
    retryButton.innerHTML = '<i class="fas fa-redo me-1"></i>Spróbuj ponownie';
    retryButton.onclick = () => {
        hideChartError();
        loadChartDataWithRetry(period);
    };
    
    errorDiv.appendChild(retryButton);
}

function enhanceChartAccessibility() {
    const periodSelect = document.getElementById('chart-period-select');
    const refreshBtn = document.getElementById('chart-refresh-btn');
    const canvas = document.getElementById('performance-chart-canvas');
    
    if (periodSelect) {
        periodSelect.setAttribute('aria-label', 'Wybierz okres wykresu wydajności');
    }
    
    if (refreshBtn) {
        refreshBtn.setAttribute('aria-label', 'Odśwież dane wykresu wydajności');
    }
    
    if (canvas) {
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Wykres wydajności dziennej produkcji');
    }
}

function trackChartUsage(action, data = {}) {
    console.log('[Performance Chart Analytics]', action, data);
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        user_id: window.productionConfig?.currentUser?.id,
        action: action,
        data: data
    };
    
    let logs = JSON.parse(localStorage.getItem('chart_usage_logs') || '[]');
    logs.push(logEntry);
    
    if (logs.length > 100) {
        logs = logs.slice(-100);
    }
    
    localStorage.setItem('chart_usage_logs', JSON.stringify(logs));
}

function enableAutoRefresh() {
    disableAutoRefresh();
    
    autoRefreshInterval = setInterval(() => {
        if (!document.hidden && dailyPerformanceChart) {
            console.log('[Performance Chart] Auto-refresh danych');
            clearChartCache();
            loadChartDataWithRetry(chartPeriod);
            trackChartUsage('auto_refresh', { period: chartPeriod });
        }
    }, AUTO_REFRESH_DELAY);
    
    console.log('[Performance Chart] Auto-refresh włączony (5 min)');
}

function disableAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('[Performance Chart] Auto-refresh wyłączony');
    }
}

function clearChartCache() {
    chartDataCache.clear();
    console.log('[Performance Chart] Cache wyczyszczony');
}

function destroyPerformanceChart() {
    if (dailyPerformanceChart) {
        dailyPerformanceChart.destroy();
        dailyPerformanceChart = null;
    }
    
    if (chartRefreshTimeout) {
        clearTimeout(chartRefreshTimeout);
        chartRefreshTimeout = null;
    }
    
    disableAutoRefresh();
    clearChartCache();
    hideChartLoading();
    hideChartError();
    
    console.log('[Performance Chart] Wykres zniszczony');
}

// ============================================================================
// FUNKCJE DASHBOARD - PRZENIESIONE Z HTML
// ============================================================================

/**
 * Inicjalizuje wszystkie widgety dashboard
 */
function initDashboardWidgets(data) {
    console.log('[Dashboard] Inicjalizacja widgetów dashboard - IMPLEMENTACJA');
    
    initStationCards();
    
    if (data && data.stats) {
        console.log('[Dashboard] Używam danych z API:', data.stats);
        
        if (data.stats.stations) {
            updateStationsStats(data.stats.stations);
        }
        
        if (data.stats.today_totals) {
            updateTodayTotals(data.stats.today_totals);
        }

        if (data.stats.deadline_alerts) {
            updateDeadlineAlerts(data.stats.deadline_alerts);
        }

        if (data.stats.system_health) {
            updateSystemHealth(data.stats.system_health);
        }
    }
    
    console.log('[Dashboard] Widgety dashboard zainicjalizowane');
}

function initStationCards() {
    document.querySelectorAll('.station-card').forEach(card => {
        card.addEventListener('click', function() {
            const stationUrl = this.getAttribute('data-station-url');
            if (stationUrl) {
                window.location.href = stationUrl;
            }
        });
    });
}

// ============================================================================
// FUNKCJE PRZENIESIONE Z production-dashboard.js (GŁÓWNEGO PLIKU)
// ============================================================================

function updateTodayTotals(totals) {
    console.log('[Dashboard] Aktualizacja dzisiejszych statystyk:', totals);
    
    if (!totals || typeof totals !== 'object') {
        console.warn('[Dashboard] Brak danych today_totals');
        return;
    }
    
    updateTodayValue('today-completed', totals.completed_orders || 0, 'liczba');
    updateTodayValue('today-total-m3', totals.total_m3 || 0, 'm3');
    updateTodayValue('today-avg-deadline', totals.avg_deadline_distance || 0, 'dni');
    updateTodayDate();
    
    console.log('[Dashboard] Dzisiejsze statystyki zaktualizowane');
}

function updateTodayValue(elementId, value, type) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn(`[Dashboard] Element ${elementId} nie znaleziony`);
        return;
    }
    
    // WYCZYŚĆ WARTOŚĆ Z BACKENDU
    const cleanValue = cleanBackendValue(value);
    
    let displayValue;
    let colorClass = '';
    
    switch (type) {
        case 'liczba':
            displayValue = cleanValue;
            if (cleanValue === 0) colorClass = 'text-muted';
            else if (cleanValue >= 10) colorClass = 'text-success';
            else if (cleanValue >= 5) colorClass = 'text-info';
            else colorClass = 'text-warning';
            break;
            
        case 'm3':
            displayValue = cleanValue.toFixed(4);
            if (cleanValue === 0) colorClass = 'text-muted';
            else if (cleanValue >= 50) colorClass = 'text-success';
            else if (cleanValue >= 20) colorClass = 'text-info';
            else colorClass = 'text-warning';
            break;
            
        case 'dni':
            displayValue = Math.round(cleanValue);
            if (cleanValue <= 0) colorClass = 'text-danger';
            else if (cleanValue <= 3) colorClass = 'text-warning';
            else if (cleanValue <= 7) colorClass = 'text-info';
            else colorClass = 'text-success';
            break;
            
        default:
            displayValue = cleanValue;
    }
    
    updateNumberWithoutGreenBackground(element, displayValue);
    
    setTimeout(() => {
        element.className = element.className.replace(/text-(muted|success|info|warning|danger)/g, '');
        if (colorClass) {
            element.classList.add(colorClass);
        }
    }, 200);
    
    console.log(`[DEBUG] updateTodayValue ${elementId}:`, {
        original: value,
        cleaned: cleanValue,
        display: displayValue,
        type: type
    });
}

function updateTodayDate() {
    const dateElement = document.getElementById('today-date');
    if (dateElement) {
        const today = new Date();
        const dateString = today.toLocaleDateString('pl-PL', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        dateElement.textContent = dateString;
    }
}

function updateDeadlineAlerts(alerts) {
    console.log('[Dashboard] Aktualizacja alertów deadline:', alerts);
    
    const alertsCountElement = document.getElementById('alerts-count');
    const alertsListElement = document.getElementById('alerts-list');
    
    if (!alertsListElement) {
        console.warn('[Dashboard] Element alerts-list nie znaleziony');
        return;
    }
    
    if (alertsCountElement) {
        alertsCountElement.textContent = alerts ? alerts.length : 0;
        
        alertsCountElement.className = 'alert-count';
        if (alerts && alerts.length > 0) {
            if (alerts.length >= 5) {
                alertsCountElement.classList.add('alert-count-critical');
            } else if (alerts.length >= 3) {
                alertsCountElement.classList.add('alert-count-warning');
            } else {
                alertsCountElement.classList.add('alert-count-info');
            }
        }
    }
    
    alertsListElement.innerHTML = '';
    
    if (!alerts || alerts.length === 0) {
        alertsListElement.innerHTML = `
            <div class="no-alerts-state">
                <div class="no-alerts-icon">✅</div>
                <p class="no-alerts-text">Brak pilnych alertów</p>
                <small class="text-muted">Wszystkie produkty są na czasie</small>
            </div>
        `;
        return;
    }
    
    alerts.forEach(alert => {
        const alertElement = createAlertElement(alert);
        alertsListElement.appendChild(alertElement);
    });
    
    console.log(`[Dashboard] ${alerts.length} alertów deadline renderowanych`);
}

function updateSystemHealth(health) {
    console.log('[Dashboard] Aktualizacja statusu systemu:', health);
    
    if (!health || typeof health !== 'object') {
        console.warn('[Dashboard] Brak danych system_health');
        return;
    }
    
    updateHealthIndicator(health);
    updateLastSync(health.last_sync, health.sync_status);
    updateDatabaseStatus(health.database_status);
    updateSystemErrors(health.errors_24h);

    checkBaselinkerAPIStatus().then(baselinkerData => {
        updateBaselinkerStatus(baselinkerData);
    }).catch(error => {
        console.error('[Baselinker] Błąd aktualizacji statusu:', error);
        updateBaselinkerStatus(null);
    });
    
    console.log('[Dashboard] Status systemu zaktualizowany');
}

function updateHealthIndicator(health) {
    const indicator = document.getElementById('health-indicator');
    if (!indicator) return;
    
    let overallStatus = 'healthy';
    let statusText = 'System działa poprawnie';
    let statusIcon = '✅';
    
    if (health.database_status !== 'connected') {
        overallStatus = 'critical';
        statusText = 'Problemy z bazą danych';
        statusIcon = '🚨';
    } else if (health.sync_status !== 'success') {
        overallStatus = 'warning';
        statusText = 'Problemy z synchronizacją';
        statusIcon = '⚠️';
    } else if (health.errors_24h && health.errors_24h > 5) {
        overallStatus = 'warning';
        statusText = 'Wykryto błędy systemu';
        statusIcon = '⚠️';
    } else if (health.errors_24h && health.errors_24h > 0) {
        overallStatus = 'info';
        statusText = 'Drobne błędy systemu';
        statusIcon = 'ℹ️';
    }
    
    indicator.className = `health-indicator health-${overallStatus}`;
    indicator.innerHTML = `${statusIcon} ${statusText}`;
    indicator.title = `Status systemu: ${statusText}`;
}

function updateLastSync(lastSync, syncStatus) {
    const element = document.getElementById('last-sync-time');
    if (!element) return;
    
    let syncText = 'Brak danych';
    let syncClass = 'sync-unknown';
    
    if (lastSync) {
        const syncDate = new Date(lastSync);
        const now = new Date();
        const diffHours = Math.floor((now - syncDate) / (1000 * 60 * 60));
        
        const timeText = syncDate.toLocaleString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        if (syncStatus === 'success') {
            if (diffHours < 2) {
                syncClass = 'sync-recent';
                syncText = `${timeText} (${diffHours}h temu)`;
            } else if (diffHours < 24) {
                syncClass = 'sync-normal';
                syncText = `${timeText} (${diffHours}h temu)`;
            } else {
                syncClass = 'sync-old';
                syncText = `${timeText} (${Math.floor(diffHours/24)} dni temu)`;
            }
        } else {
            syncClass = 'sync-error';
            syncText = `Błąd: ${timeText}`;
        }
    }
    
    element.className = `health-value ${syncClass}`;
    element.textContent = syncText;
    
    const statusElement = document.getElementById('sync-status');
    if (statusElement) {
        statusElement.className = `health-status ${syncClass}`;
        statusElement.textContent = syncStatus === 'success' ? 'OK' : 'Błąd';
    }
}

function updateDatabaseStatus(dbStatus) {
    const valueElement = document.getElementById('db-response-time');
    const statusElement = document.getElementById('db-status');
    
    if (valueElement) {
        valueElement.textContent = dbStatus === 'connected' ? 'Połączona' : 'Rozłączona';
    }
    
    if (statusElement) {
        let statusClass = 'db-unknown';
        let statusText = 'Nieznany';
        
        switch (dbStatus) {
            case 'connected':
                statusText = 'OK';
                statusClass = 'db-connected';
                break;
            case 'disconnected':
                statusText = 'Błąd';
                statusClass = 'db-error';
                break;
            case 'slow':
                statusText = 'Wolna';
                statusClass = 'db-warning';
                break;
        }
        
        statusElement.className = `health-status ${statusClass}`;
        statusElement.textContent = statusText;
    }
}

function updateSystemErrors(errorCount) {
    const valueElement = document.getElementById('error-count');
    const statusElement = document.getElementById('errors-status');
    
    if (valueElement) {
        valueElement.textContent = errorCount || 0;
        
        valueElement.className = 'health-value';
        if (errorCount > 10) {
            valueElement.classList.add('errors-critical');
        } else if (errorCount > 5) {
            valueElement.classList.add('errors-warning');
        } else if (errorCount > 0) {
            valueElement.classList.add('errors-info');
        }
    }
    
    if (statusElement) {
        let statusClass = 'errors-ok';
        let statusText = 'Brak';
        
        if (errorCount > 10) {
            statusClass = 'errors-critical';
            statusText = 'Krytyczne';
        } else if (errorCount > 5) {
            statusClass = 'errors-warning';
            statusText = 'Ostrzeżenia';
        } else if (errorCount > 0) {
            statusClass = 'errors-info';
            statusText = 'Drobne';
        }
        
        statusElement.className = `health-status ${statusClass}`;
        statusElement.textContent = statusText;
    }
}

function createAlertElement(alert) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert-item';
    
    let urgencyClass = 'alert-normal';
    let urgencyIcon = '⏰';
    
    if (alert.days_remaining <= 0) {
        urgencyClass = 'alert-overdue';
        urgencyIcon = '🚨';
    } else if (alert.days_remaining <= 1) {
        urgencyClass = 'alert-critical';
        urgencyIcon = '⚠️';
    } else if (alert.days_remaining <= 2) {
        urgencyClass = 'alert-warning';
        urgencyIcon = '⏳';
    }
    
    alertDiv.classList.add(urgencyClass);
    
    let dateText = 'Brak daty';
    if (alert.deadline_date) {
        const date = new Date(alert.deadline_date);
        dateText = date.toLocaleDateString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
    
    let daysText = '';
    if (alert.days_remaining <= 0) {
        daysText = `Spóźnione o ${Math.abs(alert.days_remaining)} dni`;
    } else {
        daysText = `${alert.days_remaining} dni pozostało`;
    }
    
    alertDiv.innerHTML = `
        <div class="alert-icon">${urgencyIcon}</div>
        <div class="alert-content">
            <div class="alert-header">
                <span class="alert-product-id">${alert.short_product_id || 'ID nieznany'}</span>
                <span class="alert-days ${urgencyClass}">${daysText}</span>
            </div>
            <div class="alert-details">
                <span class="alert-deadline">Termin: ${dateText}</span>
                <span class="alert-station">Na: ${formatStationName(alert.current_station)}</span>
            </div>
        </div>
        <div class="alert-actions">
            <button class="btn btn-sm btn-outline-primary" onclick="viewProductDetails('${alert.short_product_id}')">
                <i class="fas fa-eye"></i>
            </button>
        </div>
    `;
    
    return alertDiv;
}

function formatStationName(station) {
    const stationNames = {
        'cutting': 'Wycinanie',
        'assembly': 'Składanie', 
        'packaging': 'Pakowanie',
        'wyciecie': 'Wycinanie',
        'skladanie': 'Składanie',
        'pakowanie': 'Pakowanie'
    };
    
    return stationNames[station] || station || 'Nieznane';
}

function updateStationsStats(stations) {
    console.log('[Dashboard Tab] Aktualizacja statystyk stanowisk:', stations);
    
    if (!stations || typeof stations !== 'object') {
        console.warn('[Dashboard Tab] Brak danych stanowisk');
        return;
    }
    
    updateSingleStationCard('cutting', stations.cutting, '🪚', 'Wycinanie');
    updateSingleStationCard('assembly', stations.assembly, '🔧', 'Składanie'); 
    updateSingleStationCard('packaging', stations.packaging, '📦', 'Pakowanie');
    
    updateLastRefreshTime('stations-updated');
}

function updateSingleStationCard(stationType, stationData, icon, displayName) {
    if (!stationData) {
        console.warn(`[Dashboard] Brak danych dla stanowiska: ${stationType}`);
        return;
    }
    
    const pendingElement = document.getElementById(`${stationType}-pending`);
    const volumeElement = document.getElementById(`${stationType}-today-m3`);
    const statusElement = document.getElementById(`${stationType}-status`);
    const cardElement = document.querySelector(`.station-card.${stationType}-station`);
    
    if (!pendingElement || !volumeElement) {
        console.warn(`[Dashboard] Nie znaleziono elementów dla stanowiska: ${stationType}`);
        return;
    }
    
    // UŻYJ CZYSZCZENIA DANYCH Z BACKENDU
    const cleanPending = cleanBackendValue(stationData.pending_count);
    const cleanVolume = cleanBackendValue(stationData.today_m3);
    
    updateNumberWithoutGreenBackground(pendingElement, cleanPending);
    updateNumberWithoutGreenBackground(volumeElement, cleanVolume.toFixed(4));
    
    // Przekaż wyczyszczone dane do statusu
    const cleanStationData = {
        ...stationData,
        name: displayName,
        pending_count: cleanPending,
        today_m3: cleanVolume,
        today_completed: cleanBackendValue(stationData.today_completed)
    };
    
    updateStationStatus(statusElement, cardElement, cleanStationData);
    
    console.log(`[Dashboard] Zaktualizowano stanowisko ${displayName}:`, {
        original_pending: stationData.pending_count,
        clean_pending: cleanPending,
        original_volume: stationData.today_m3,
        clean_volume: cleanVolume,
        status: statusElement?.classList.toString()
    });
}

function updateNumberWithoutGreenBackground(element, newValue) {
    if (!element) return;
    
    const currentValue = element.textContent || '0';
    const numericNewValue = parseFloat(newValue) || 0;
    const numericCurrentValue = parseFloat(currentValue) || 0;
    
    if (numericCurrentValue === numericNewValue) return;
    
    const duration = 800;
    const steps = 20;
    const stepValue = (numericNewValue - numericCurrentValue) / steps;
    const stepTime = duration / steps;
    
    let currentStep = 0;
    
    const animate = () => {
        currentStep++;
        const intermediateValue = numericCurrentValue + (stepValue * currentStep);
        
        if (currentStep < steps) {
            if (newValue.toString().includes('.')) {
                element.textContent = intermediateValue.toFixed(4); // 4 miejsca po przecinku
            } else {
                element.textContent = Math.round(intermediateValue);
            }
            setTimeout(animate, stepTime);
        } else {
            element.textContent = newValue;
            // USUNIĘTO: zielone tło, dodano tylko subtelną animację
            element.style.transform = 'scale(1.05)';
            element.style.transition = 'transform 0.3s ease';
            
            setTimeout(() => {
                element.style.transform = 'scale(1)';
            }, 300);
        }
    };
    
    animate();
}

function updateStationStatus(statusElement, cardElement, stationData) {
    if (!statusElement || !cardElement) return;
    
    const pendingCount = stationData.pending_count || 0;
    const todayVolume = stationData.today_m3 || 0;
    const todayCompleted = stationData.today_completed || 0;
    
    // Znajdź kropkę statusu w HTML
    const statusDot = statusElement.querySelector('.status-dot');
    if (!statusDot) {
        console.warn('[Station Status] Nie znaleziono .status-dot dla', stationData.name);
        return;
    }
    
    let statusClass = 'active'; // ZMIANA: użyj klas z CSS (active, warning, danger)
    
    // Logika statusu - dopasowana do CSS
    if (pendingCount === 0 && todayCompleted === 0 && todayVolume === 0) {
        statusClass = ''; // Brak klasy = szary (domyślny)
    } else if (pendingCount > 25) {
        statusClass = 'danger';     // Czerwony - bardzo przeciążone
    } else if (pendingCount > 15) {
        statusClass = 'warning';    // Żółty - zajęte
    } else {
        statusClass = 'active';     // Zielony - normalna praca
    }
    
    // Usuń wszystkie poprzednie klasy statusu z kropki
    statusDot.classList.remove('active', 'warning', 'danger');
    
    // Dodaj nową klasę tylko jeśli nie jest pusta
    if (statusClass) {
        statusDot.classList.add(statusClass);
    }
    
    console.log(`[Station Status] ${stationData.name || 'Unknown'}: ${statusClass || 'default'} (pending: ${pendingCount}, volume: ${todayVolume})`);
}

function updateLastRefreshTime(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('pl-PL', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        element.textContent = `Aktualizacja: ${timeString}`;
    }
}

// ============================================================================
// AJAX SYSTEM - PRZENIESIONY Z GŁÓWNEGO PLIKU
// ============================================================================

function setupAutoRefresh() {
    if (TabDashboard.state.refreshInterval) {
        clearInterval(TabDashboard.state.refreshInterval);
    }
    
    TabDashboard.state.refreshInterval = setInterval(() => {
        if (!document.hidden && !TabDashboard.state.isLoading) {
            console.log(`[Tab Dashboard] Auto-refresh dla taba: ${TabDashboard.state.currentActiveTab}`);
            loadTabContent(TabDashboard.state.currentActiveTab, true);
        }
    }, TabDashboard.config.refreshIntervalMs);
    
    console.log(`[Tab Dashboard] Auto-refresh ustawiony na ${TabDashboard.config.refreshIntervalMs/1000/60} minut`);
}

async function loadTabContent(tabName, silentRefresh = false) {
    console.log(`[Tab Dashboard] Ładowanie taba: ${tabName}, silent: ${silentRefresh}`);
    updateSystemStatus('loading', `Ładowanie taba ${tabName}...`);
    
    lastApiCall = `${new Date().toLocaleTimeString()} (${tabName})`;
    window.lastApiCall = lastApiCall;
    
    TabDashboard.state.currentActiveTab = tabName;
    
    const loadingElement = document.getElementById(`${tabName}-loading`);
    const wrapperElement = document.getElementById(`${tabName}-wrapper`);
    const errorElement = document.getElementById(`${tabName}-error`);
    
    if (!loadingElement || !wrapperElement || !errorElement) {
        console.error(`[Tab Dashboard] Nie znaleziono elementów DOM dla taba: ${tabName}`);
        return;
    }
    
    if (!silentRefresh) {
        loadingElement.style.display = 'block';
        wrapperElement.style.display = 'none';
        errorElement.style.display = 'none';
        TabDashboard.state.isLoading = true;
    }
    
    try {
        const endpointKey = getEndpointKey(tabName);
        const endpoint = TabDashboard.endpoints[endpointKey];
        
        if (!endpoint) {
            throw new Error(`Brak endpointu dla taba: ${tabName}`);
        }
        
        console.log(`[Tab Dashboard] Wywołuję endpoint: ${endpoint}`);
        
        const response = await fetch(endpoint, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Nieznany błąd API');
        }
        
        wrapperElement.innerHTML = data.html;
        
        loadingElement.style.display = 'none';
        wrapperElement.style.display = 'block';
        errorElement.style.display = 'none';
        
        executeTabCallback(tabName, data);
        
        TabDashboard.state.retryCount = 0;
        
        if (!silentRefresh) {
            updateSystemStatus('success', 'System gotowy');
        } else {
            updateSystemStatus('success', `${tabName} odświeżony`);
        }
        
        console.log(`[Tab Dashboard] Tab ${tabName} załadowany pomyślnie`);
        
    } catch (error) {
        console.error(`[Tab Dashboard] Błąd ładowania taba ${tabName}:`, error);
        handleTabLoadError(tabName, error, silentRefresh);
    } finally {
        TabDashboard.state.isLoading = false;
    }
}

function handleTabLoadError(tabName, error, silentRefresh) {
    const loadingElement = document.getElementById(`${tabName}-loading`);
    const wrapperElement = document.getElementById(`${tabName}-wrapper`);
    const errorElement = document.getElementById(`${tabName}-error`);
    const errorMessageElement = document.getElementById(`${tabName}-error-message`);
    
    if (!silentRefresh) {
        loadingElement.style.display = 'none';
        wrapperElement.style.display = 'none';
        errorElement.style.display = 'block';
        
        if (errorMessageElement) {
            errorMessageElement.textContent = error.message;
        }
        
        updateSystemStatus('error', `Błąd ładowania: ${error.message}`);
    }
    
    TabDashboard.state.retryCount++;
    
    if (TabDashboard.state.retryCount < TabDashboard.config.maxRetries) {
        console.log(`[Tab Dashboard] Ponowna próba ${TabDashboard.state.retryCount}/${TabDashboard.config.maxRetries} za ${TabDashboard.config.retryDelayMs}ms`);
        
        setTimeout(() => {
            loadTabContent(tabName, silentRefresh);
        }, TabDashboard.config.retryDelayMs);
    } else {
        console.error(`[Tab Dashboard] Przekroczono maksymalną liczbę prób dla taba: ${tabName}`);
    }
}

function executeTabCallback(tabName, data) {
    const callbackName = getTabCallbackName(tabName);
    
    if (typeof window[callbackName] === 'function') {
        console.log(`[Tab Dashboard] Wykonuję callback: ${callbackName}`);
        try {
            window[callbackName](data);
        } catch (error) {
            console.error(`[Tab Dashboard] Błąd callbacku ${callbackName}:`, error);
        }
    } else {
        console.log(`[Tab Dashboard] Brak callbacku ${callbackName} - pomijam`);
    }
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function handleTabClick(event) {
    const tabButton = event.currentTarget;
    const targetId = tabButton.getAttribute('data-bs-target');
    
    if (!targetId) {
        console.error('[Tab Dashboard] Brak data-bs-target w przycisku taba');
        return;
    }
    
    const tabName = targetId.replace('#', '').replace('-content', '');
    console.log(`[Tab Dashboard] Kliknięto tab: ${tabName}`);
    
    // Zniszcz wykres jeśli opuszczamy dashboard
    if (TabDashboard.state.currentActiveTab === 'dashboard-tab' && tabName !== 'dashboard-tab') {
        destroyPerformanceChart();
    }
    
    loadTabContent(tabName);
}

async function handleSystemRefresh() {
    console.log('[Tab Dashboard] Odświeżanie systemu...');
    
    const refreshBtn = document.getElementById('refresh-system-btn');
    const refreshIcon = refreshBtn?.querySelector('.refresh-icon');
    const refreshText = refreshBtn?.querySelector('.refresh-text');
    
    if (refreshBtn) refreshBtn.disabled = true;
    if (refreshIcon) refreshIcon.textContent = '⏳';
    if (refreshText) refreshText.textContent = 'Odświeżanie...';
    
    try {
        // Wyczyść cache wykresów przy ręcznym odświeżeniu
        clearChartCache();
        
        await loadTabContent(TabDashboard.state.currentActiveTab);
        
        showNotification('System odświeżony pomyślnie', 'success');
        startRefreshCooldown();
        
    } catch (error) {
        console.error('[Tab Dashboard] Błąd odświeżania:', error);
        showNotification('Błąd odświeżania systemu', 'error');
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
        if (refreshIcon) refreshIcon.textContent = '🔄';
        if (refreshText) refreshText.textContent = 'Odśwież system';
    }
}

function handleVisibilityChange() {
    if (document.hidden) {
        console.log('[Tab Dashboard] Strona ukryta - wstrzymanie auto-refresh');
    } else {
        console.log('[Tab Dashboard] Strona widoczna - wznowienie auto-refresh');
        if (!TabDashboard.state.isLoading) {
            loadTabContent(TabDashboard.state.currentActiveTab, true);
        }
    }
}

// ============================================================================
// FUNKCJE POMOCNICZE
// ============================================================================

function debugAPIResponse(data) {
    console.log('[DEBUG] Surowe dane z API:', data);
    
    if (data.stats && data.stats.stations) {
        Object.keys(data.stats.stations).forEach(stationKey => {
            const station = data.stats.stations[stationKey];
            console.log(`[DEBUG] ${stationKey} RAW data:`, {
                pending_count: station.pending_count,
                today_m3: station.today_m3,
                typeof_pending: typeof station.pending_count,
                typeof_volume: typeof station.today_m3,
                is_string_dash: station.today_m3 === "-",
                is_null: station.today_m3 === null,
                is_undefined: station.today_m3 === undefined
            });
        });
    }
    
    if (data.stats && data.stats.today_totals) {
        console.log('[DEBUG] Today totals RAW:', {
            completed_orders: data.stats.today_totals.completed_orders,
            total_m3: data.stats.today_totals.total_m3,
            typeof_m3: typeof data.stats.today_totals.total_m3,
            is_string_dash: data.stats.today_totals.total_m3 === "-"
        });
    }
}

function cleanBackendValue(value) {
    // Jeśli backend zwraca "-", zamień na 0
    if (value === "-" || value === null || value === undefined || value === "") {
        return 0;
    }
    
    // Jeśli to string z liczbą, przekonwertuj
    if (typeof value === 'string' && !isNaN(parseFloat(value))) {
        return parseFloat(value);
    }
    
    // Jeśli to już liczba, zwróć bez zmian
    if (typeof value === 'number') {
        return value;
    }
    
    // W ostateczności zwróć 0
    return 0;
}

function getEndpointKey(tabName) {
    const mapping = {
        'dashboard-tab': 'dashboardTabContent',
        'products-tab': 'productsTabContent',
        'reports-tab': 'reportsTabContent',
        'stations-tab': 'stationsTabContent',
        'config-tab': 'configTabContent'
    };
    
    return mapping[tabName];
}

function getTabCallbackName(tabName) {
    const mapping = {
        'dashboard-tab': 'onDashboardTabLoaded',
        'products-tab': 'onProductsTabLoaded',
        'reports-tab': 'onReportsTabLoaded',
        'stations-tab': 'onStationsTabLoaded',
        'config-tab': 'onConfigTabLoaded'
    };
    
    return mapping[tabName];
}

function updateSystemStatus(status, message) {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    
    if (indicator) {
        indicator.className = indicator.className.replace(/\b(loading|active|warning|error|success)\b/g, '');
        indicator.classList.add('status-indicator', status);
    }
    
    if (text) {
        text.textContent = message;
    }
    
    console.log(`[Tab Dashboard] Header Status: ${status} - ${message}`);
}

function showNotification(message, type = 'info') {
    console.log(`[Tab Dashboard] Notyfikacja ${type.toUpperCase()}: ${message}`);
    
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else if (typeof alert !== 'undefined') {
        alert(message);
    }
}

function startRefreshCooldown() {
    const refreshTimer = document.getElementById('refresh-timer');
    const refreshBtn = document.getElementById('refresh-system-btn');
    
    if (!refreshTimer || !refreshBtn) return;
    
    let seconds = 5;
    refreshTimer.style.display = 'inline';
    refreshTimer.textContent = `(${seconds}s)`;
    refreshBtn.disabled = true;
    
    const countdown = setInterval(() => {
        seconds--;
        refreshTimer.textContent = `(${seconds}s)`;
        
        if (seconds <= 0) {
            clearInterval(countdown);
            refreshTimer.style.display = 'none';
            refreshBtn.disabled = false;
        }
    }, 1000);
}

function checkSystemOverallHealth() {
    console.log('[System Health] Sprawdzanie ogólnego stanu systemu...');
    
    let issues = [];
    let overallStatus = 'success';
    let statusMessage = 'System działa poprawnie';
    
    const errors = localStorage.getItem('system_errors');
    if (errors && JSON.parse(errors).length > 0) {
        issues.push('Błędy systemu');
        overallStatus = 'warning';
    }
    
    if (TabDashboard.state.retryCount > 0) {
        issues.push('Problemy z ładowaniem');
        overallStatus = 'warning';
    }
    
    if (!TabDashboard.endpoints || Object.keys(TabDashboard.endpoints).length === 0) {
        issues.push('Brak konfiguracji');
        overallStatus = 'error';
    }
    
    if (issues.length > 0) {
        if (overallStatus === 'error') {
            statusMessage = `Błąd krytyczny: ${issues.join(', ')}`;
        } else {
            statusMessage = `Ostrzeżenia: ${issues.join(', ')}`;
        }
    }
    
    updateSystemStatus(overallStatus, statusMessage);
    console.log(`[System Health] Status: ${overallStatus}, Wiadomość: ${statusMessage}`);
}

async function checkBaselinkerAPIStatus() {
    const cacheKey = 'baselinker_api_status';
    const timestampKey = 'baselinker_last_check';
    const CACHE_DURATION = 15 * 60 * 1000;
    
    const lastCheck = localStorage.getItem(timestampKey);
    const cachedStatus = localStorage.getItem(cacheKey);
    const now = Date.now();
    
    if (lastCheck && cachedStatus && (now - parseInt(lastCheck)) < CACHE_DURATION) {
        console.log('[Baselinker] Używam cache:', JSON.parse(cachedStatus));
        return JSON.parse(cachedStatus);
    }
    
    console.log('[Baselinker] Cache wygasł, sprawdzam API...');
    
    try {
        lastApiCall = `${new Date().toLocaleTimeString()} (Baselinker)`;
        window.lastApiCall = lastApiCall;
        
        const response = await fetch('/production/api/baselinker-health', {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(timestampKey, now.toString());
        
        console.log('[Baselinker] Status zaktualizowany:', result);
        return result;
        
    } catch (error) {
        console.error('[Baselinker] Błąd sprawdzania API:', error);
        
        if (cachedStatus) {
            console.log('[Baselinker] Używam ostatni znany status z cache');
            return JSON.parse(cachedStatus);
        }
        
        return { 
            status: 'unknown', 
            error: error.message,
            response_time: null 
        };
    }
}

function updateBaselinkerStatus(baselinkerData) {
    const valueElement = document.getElementById('api-response-time');
    const statusElement = document.getElementById('api-status');
    
    if (!valueElement || !statusElement) {
        console.warn('[Baselinker] Elementy HTML nie znalezione');
        return;
    }
    
    if (!baselinkerData) {
        valueElement.textContent = '-';
        statusElement.className = 'health-status api-unknown';
        statusElement.textContent = 'Nieznany';
        return;
    }
    
    if (baselinkerData.response_time !== null && baselinkerData.response_time !== undefined) {
        const responseTimeMs = Math.round(baselinkerData.response_time * 1000);
        valueElement.textContent = `${responseTimeMs}ms`;
    } else if (baselinkerData.error) {
        valueElement.textContent = 'Błąd połączenia';
    } else {
        valueElement.textContent = 'Nieznany';
    }
    
    let statusClass = 'api-unknown';
    let statusText = 'Nieznany';
    
    switch (baselinkerData.status) {
        case 'connected':
            statusClass = 'api-connected';
            statusText = 'OK';
            break;
        case 'slow':
            statusClass = 'api-warning';
            statusText = 'Wolny';
            break;
        case 'error':
            statusClass = 'api-error';
            statusText = 'Błąd';
            break;
        case 'unknown':
        default:
            statusClass = 'api-unknown';
            statusText = 'Nieznany';
    }
    
    statusElement.className = `health-status ${statusClass}`;
    statusElement.textContent = statusText;
    
    if (baselinkerData.error) {
        statusElement.title = `Błąd: ${baselinkerData.error}`;
    } else if (baselinkerData.response_time) {
        statusElement.title = `Czas odpowiedzi: ${Math.round(baselinkerData.response_time * 1000)}ms`;
    }
}

// ============================================================================
// CALLBACK FUNCTIONS - ZINTEGROWANE
// ============================================================================

window.onDashboardTabLoaded = function(data) {
    console.log('[Dashboard Tab] Callback wykonany, dane:', data);
    
    // DODAJ DEBUGOWANIE
    debugAPIResponse(data);
    
    // Inicjalizuj podstawowe widgety
    initDashboardWidgets(data);
    
    // Inicjalizuj wykresy dla adminów z opóźnieniem dla DOM
    if (window.productionConfig?.currentUser?.role === 'admin') {
        setTimeout(() => {
            createDailyPerformanceChart();
        }, 100);
    }
};

window.onProductsTabLoaded = function(data) {
    console.log('[Products Tab] Callback wykonany, dane:', data);
    
    if (typeof initProductFilters === 'function') {
        initProductFilters();
    }
    
    if (window.productionConfig?.currentUser?.role === 'admin') {
        if (typeof initDragAndDrop === 'function') {
            initDragAndDrop();
        }
    }
};

window.onReportsTabLoaded = function(data) {
    console.log('[Reports Tab] Callback wykonany, dane:', data);
    
    if (typeof initReportsCharts === 'function') {
        initReportsCharts(data);
    }
};

window.onStationsTabLoaded = function(data) {
    console.log('[Stations Tab] Callback wykonany, dane:', data);
    
    if (typeof initStationsInterface === 'function') {
        initStationsInterface();
    }
};

window.onConfigTabLoaded = function(data) {
    console.log('[Config Tab] Callback wykonany, dane:', data);
    
    if (typeof initConfigForms === 'function') {
        initConfigForms();
    }
    
    if (typeof initPriorityDragDrop === 'function') {
        initPriorityDragDrop();
    }
};

// ============================================================================
// PLACEHOLDER FUNCTIONS - POZOSTAŁE DO IMPLEMENTACJI
// ============================================================================

window.initProductFilters = function() {
    console.log('[Products] TODO: Inicjalizacja filtrów produktów');
};

window.initDragAndDrop = function() {
    console.log('[Products] TODO: Inicjalizacja drag&drop');
};

window.initReportsCharts = function(data) {
    console.log('[Reports] TODO: Inicjalizacja wykresów raportów');
};

window.initStationsInterface = function() {
    console.log('[Stations] TODO: Inicjalizacja interfejsu stanowisk');
};

window.initConfigForms = function() {
    console.log('[Config] TODO: Inicjalizacja formularzy konfiguracji');
};

window.initPriorityDragDrop = function() {
    console.log('[Config] TODO: Inicjalizacja drag&drop priorytetów');
};

// ============================================================================
// FUNKCJE MODALI I AKCJI - PRZENIESIONE Z HTML
// ============================================================================

function showSystemErrorsModal() {
    console.log('[Dashboard] Otwórz modal błędów systemu');
    
    const modal = document.getElementById('systemErrorsModal');
    if (modal) {
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    } else {
        window.open('/production/api/system-errors', '_blank', 'width=800,height=600,scrollbars=yes');
    }
}

function closeSystemErrorsModal() {
    const modal = document.getElementById('systemErrorsModal');
    if (modal) {
        const bootstrapModal = bootstrap.Modal.getInstance(modal);
        if (bootstrapModal) {
            bootstrapModal.hide();
        }
    }
}

function clearSystemErrors() {
    console.log('[Dashboard] Czyszczenie błędów systemu');
    
    fetch('/production/api/clear-errors', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Błędy systemu wyczyszczone', 'success');
            closeSystemErrorsModal();
            loadTabContent(TabDashboard.state.currentActiveTab, true);
        } else {
            showNotification('Błąd czyszczenia: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Błąd czyszczenia błędów:', error);
        showNotification('Błąd połączenia', 'error');
    });
}

function clearAllSystemErrors() {
    console.log('[Dashboard] Czyszczenie wszystkich błędów systemu');
    
    if (confirm('Czy na pewno chcesz wyczyścić wszystkie błędy systemu?')) {
        fetch('/production/api/clear-all-errors', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Wszystkie błędy systemu wyczyszczone', 'success');
                closeSystemErrorsModal();
                loadTabContent(TabDashboard.state.currentActiveTab, true);
            } else {
                showNotification('Błąd czyszczenia: ' + data.error, 'error');
            }
        })
        .catch(error => {
            console.error('Błąd czyszczenia wszystkich błędów:', error);
            showNotification('Błąd połączenia', 'error');
        });
    }
}

function triggerManualSync() {
    console.log('[Dashboard] Uruchamianie ręcznej synchronizacji');
    
    const syncButton = document.getElementById('manual-sync-btn');
    if (syncButton) {
        syncButton.disabled = true;
        syncButton.textContent = 'Synchronizacja...';
    }
    
    fetch('/production/api/manual-sync', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Synchronizacja zakończona pomyślnie', 'success');
            
            // Odśwież aktywny tab po synchronizacji
            setTimeout(() => {
                loadTabContent(TabDashboard.state.currentActiveTab, true);
            }, 2000);
        } else {
            showNotification('Błąd synchronizacji: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Błąd ręcznej synchronizacji:', error);
        showNotification('Błąd połączenia podczas synchronizacji', 'error');
    })
    .finally(() => {
        if (syncButton) {
            syncButton.disabled = false;
            syncButton.textContent = 'Ręczna synchronizacja';
        }
    });
}

function viewProductDetails(productId) {
    console.log('[Dashboard] Wyświetl szczegóły produktu:', productId);
    
    if (!productId) {
        console.warn('[Dashboard] Brak ID produktu');
        return;
    }
    
    const detailsUrl = `/production/products/details/${productId}`;
    window.open(detailsUrl, '_blank', 'width=1000,height=700,scrollbars=yes,resizable=yes');
}

// ============================================================================
// FUNKCJE DEBUG PANEL - PRZENIESIONE Z HTML
// ============================================================================

function toggleDebugPanel() {
    const panel = document.getElementById('debug-panel');
    const button = document.querySelector('.debug-toggle');
    
    if (!panel || !button) return;
    
    if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'block';
        button.style.display = 'none';
        updateDebugInfo();
        
        if (!window.debugInterval) {
            window.debugInterval = setInterval(() => {
                if (panel.style.display === 'block') {
                    updateDebugInfo();
                }
            }, 2000);
        }
    } else {
        panel.style.display = 'none';
        button.style.display = 'block';
        if (window.debugInterval) {
            clearInterval(window.debugInterval);
            window.debugInterval = null;
        }
    }
}

function updateDebugInfo() {
    const status = document.getElementById('status-text')?.textContent || 'Nieznany';
    const activeTab = TabDashboard?.state?.currentActiveTab || 'Nieznany';
    const retryCount = TabDashboard?.state?.retryCount || 0;
    const autoRefresh = TabDashboard?.state?.refreshInterval ? 'ON' : 'OFF';
    
    const debugStatus = document.getElementById('debug-status');
    const debugActiveTab = document.getElementById('debug-active-tab');
    const debugRetryCount = document.getElementById('debug-retry-count');
    const debugAutoRefresh = document.getElementById('debug-auto-refresh');
    const debugLastApi = document.getElementById('debug-last-api');
    
    if (debugStatus) debugStatus.textContent = status;
    if (debugActiveTab) debugActiveTab.textContent = activeTab;
    if (debugRetryCount) debugRetryCount.textContent = retryCount;
    if (debugAutoRefresh) debugAutoRefresh.textContent = autoRefresh;
    if (debugLastApi) debugLastApi.textContent = lastApiCall || 'Brak API calls';
}

function refreshSystemWithTimer() {
    const btn = document.getElementById('refresh-system-btn');
    const timer = document.getElementById('refresh-timer');
    
    if (!btn || !timer) return;
    
    btn.disabled = true;
    timer.style.display = 'inline';
    
    let seconds = 5;
    timer.textContent = `(${seconds}s)`;
    
    // Odśwież aktywny tab
    if (TabDashboard?.state?.currentActiveTab) {
        loadTabContent(TabDashboard.state.currentActiveTab);
    }
    
    const countdown = setInterval(() => {
        seconds--;
        timer.textContent = `(${seconds}s)`;
        
        if (seconds <= 0) {
            clearInterval(countdown);
            btn.disabled = false;
            timer.style.display = 'none';
        }
    }, 1000);
}

// ============================================================================
// EKSPORT I INICJALIZACJA KOŃCOWA
// ============================================================================

// Udostępnij główne funkcje globalnie
window.loadTabContent = loadTabContent;
window.TabDashboard = TabDashboard;
window.createDailyPerformanceChart = createDailyPerformanceChart;
window.destroyPerformanceChart = destroyPerformanceChart;
window.hideChartError = hideChartError;
window.clearChartCache = clearChartCache;
window.enableAutoRefresh = enableAutoRefresh;
window.disableAutoRefresh = disableAutoRefresh;

// Funkcje modali i akcji
window.showSystemErrorsModal = showSystemErrorsModal;
window.closeSystemErrorsModal = closeSystemErrorsModal;
window.clearSystemErrors = clearSystemErrors;
window.clearAllSystemErrors = clearAllSystemErrors;
window.triggerManualSync = triggerManualSync;
window.viewProductDetails = viewProductDetails;

// Funkcje debug
window.toggleDebugPanel = toggleDebugPanel;
window.updateDebugInfo = updateDebugInfo;
window.refreshSystemWithTimer = refreshSystemWithTimer;

// Auto-inicjalizacja po załadowaniu DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabDashboard);
} else {
    initTabDashboard();
}

// Periodic health check
setInterval(() => {
    if (!document.hidden && !TabDashboard.state.isLoading) {
        checkSystemOverallHealth();
    }
}, 30000); // Co 30 sekund

console.log('[Tab Dashboard] Kompletny moduł załadowany - system tabów + wykresy gotowe!');

// ============================================================================
// CLEANUP I DESTRUKTORY
// ============================================================================

// Cleanup przy opuszczeniu strony
window.addEventListener('beforeunload', () => {
    destroyPerformanceChart();
    
    if (TabDashboard.state.refreshInterval) {
        clearInterval(TabDashboard.state.refreshInterval);
    }
    
    if (window.debugInterval) {
        clearInterval(window.debugInterval);
    }
    
    console.log('[Tab Dashboard] Cleanup wykonany');
});

function debugStationsData(stations) {
    console.log('[Dashboard Debug] Otrzymane dane stanowisk:', stations);
    
    Object.keys(stations || {}).forEach(stationKey => {
        const station = stations[stationKey];
        console.log(`[Dashboard Debug] ${stationKey}:`, {
            pending_count: station?.pending_count,
            today_m3: station?.today_m3,
            today_completed: station?.today_completed,
            hasData: station !== null && station !== undefined
        });
    });
}