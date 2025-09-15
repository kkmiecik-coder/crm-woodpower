/**
 * Dashboard Module - Logika dashboard przeniesiona z production-dashboard.js
 * ========================================================================
 * 
 * Odpowiedzialności:
 * - Ładowanie i renderowanie dashboard content
 * - Zarządzanie widgetami dashboard
 * - Obsługa systemu wykresów (dla adminów)
 * - Refresh management dla dashboard
 * - System health monitoring
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 1.0 - Wyciągnięcie z production-dashboard.js
 * Data: 2025-01-15
 */

export class DashboardModule {
    constructor(shared, config) {
        this.shared = shared;
        this.config = config;
        this.isLoaded = false;
        this.autoRefreshInterval = null;
        this.chartInstance = null;

        // State
        this.state = {
            lastRefresh: null,
            widgetStates: {},
            chartData: null
        };

        // Components registry
        this.components = {
            stationsWidget: null,
            todayTotalsWidget: null,
            alertsWidget: null,
            systemHealthWidget: null,
            performanceChart: null
        };
    }

    // ========================================================================
    // LIFECYCLE METHODS
    // ========================================================================

    async load() {
        if (this.isLoaded) {
            console.log('[Dashboard Module] Already loaded, refreshing...');
            return this.refresh();
        }

        console.log('[Dashboard Module] Loading dashboard...');

        try {
            // 1. Load dashboard content from API
            await this.loadDashboardContent();

            // 2. Initialize widgets
            this.initializeWidgets();

            // 3. Setup event listeners
            this.setupEventListeners();

            // 4. Setup auto-refresh
            this.setupAutoRefresh();

            // 5. Initialize charts for admins
            if (this.config.user?.isAdmin) {
                await this.initializePerformanceChart();
            }

            this.isLoaded = true;
            this.state.lastRefresh = new Date();

            console.log('[Dashboard Module] Dashboard loaded successfully');

        } catch (error) {
            console.error('[Dashboard Module] Failed to load dashboard:', error);
            throw error;
        }
    }

    async unload() {
        console.log('[Dashboard Module] Unloading dashboard...');

        // Clear intervals
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }

        // Destroy chart
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }

        // Clean up components
        Object.values(this.components).forEach(component => {
            if (component && typeof component.destroy === 'function') {
                component.destroy();
            }
        });

        // Remove event listeners
        this.removeEventListeners();

        this.isLoaded = false;
        console.log('[Dashboard Module] Dashboard unloaded');
    }

    async refresh() {
        console.log('[Dashboard Module] Refreshing dashboard...');

        try {
            await this.loadDashboardContent();
            this.updateWidgets();
            this.state.lastRefresh = new Date();

            this.shared.eventBus.emit('dashboard:refreshed', {
                timestamp: this.state.lastRefresh
            });

        } catch (error) {
            console.error('[Dashboard Module] Refresh failed:', error);
            this.shared.toastSystem.show(
                'Błąd odświeżania dashboard: ' + error.message,
                'warning'
            );
        }
    }

    // ========================================================================
    // CONTENT LOADING
    // ========================================================================

    async loadDashboardContent() {
        const response = await this.shared.apiClient.getDashboardTabContent();

        if (!response.success) {
            throw new Error(response.error || 'Failed to load dashboard content');
        }

        // Update DOM with new content
        const wrapper = document.getElementById('dashboard-tab-wrapper');
        if (wrapper) {
            wrapper.innerHTML = response.html;
            wrapper.style.display = 'block';
        }

        // Store stats for widgets
        this.state.stats = response.stats;

        return response;
    }

    // ========================================================================
    // WIDGET MANAGEMENT
    // ========================================================================

    initializeWidgets() {
        console.log('[Dashboard Module] Initializing widgets...');

        // Initialize each widget
        this.components.stationsWidget = this.initStationsWidget();
        this.components.todayTotalsWidget = this.initTodayTotalsWidget();
        this.components.alertsWidget = this.initAlertsWidget();
        this.components.systemHealthWidget = this.initSystemHealthWidget();

        this.updateWidgets();
    }

    initStationsWidget() {
        const stationsGrid = document.querySelector('.stations-grid');
        if (!stationsGrid) return null;

        // Initialize station cards click handlers
        const stationCards = stationsGrid.querySelectorAll('.station-card');
        stationCards.forEach(card => {
            card.addEventListener('click', () => {
                const stationUrl = card.getAttribute('data-station-url');
                if (stationUrl) {
                    window.location.href = stationUrl;
                }
            });
        });

        return {
            element: stationsGrid,
            update: this.updateStationsWidget.bind(this),
            destroy: () => {
                // Cleanup if needed
            }
        };
    }

    initTodayTotalsWidget() {
        const todayWidget = document.querySelector('.widget.today-summary');
        if (!todayWidget) return null;

        return {
            element: todayWidget,
            update: this.updateTodayTotalsWidget.bind(this),
            destroy: () => {
                // Cleanup if needed
            }
        };
    }

    initAlertsWidget() {
        const alertsWidget = document.querySelector('.widget.deadline-alerts');
        if (!alertsWidget) return null;

        return {
            element: alertsWidget,
            update: this.updateAlertsWidget.bind(this),
            destroy: () => {
                // Cleanup if needed
            }
        };
    }

    initSystemHealthWidget() {
        const healthWidget = document.querySelector('.widget.system-health');
        if (!healthWidget) return null;

        return {
            element: healthWidget,
            update: this.updateSystemHealthWidget.bind(this),
            destroy: () => {
                // Cleanup if needed
            }
        };
    }

    updateWidgets() {
        if (!this.state.stats) return;

        console.log('[Dashboard Module] Updating widgets with fresh data...');

        // Update each widget with current stats
        if (this.components.stationsWidget) {
            this.components.stationsWidget.update(this.state.stats.stations);
        }

        if (this.components.todayTotalsWidget) {
            this.components.todayTotalsWidget.update(this.state.stats.today_totals);
        }

        if (this.components.alertsWidget) {
            this.components.alertsWidget.update(this.state.stats.deadline_alerts);
        }

        if (this.components.systemHealthWidget) {
            this.components.systemHealthWidget.update(this.state.stats.system_health);
        }
    }

    // ========================================================================
    // WIDGET UPDATE METHODS - Przeniesione z production-dashboard.js
    // ========================================================================

    updateStationsWidget(stationsData) {
        if (!stationsData) return;

        Object.entries(stationsData).forEach(([stationType, data]) => {
            this.updateSingleStationCard(stationType, data);
        });

        this.updateLastRefreshTime('stations-updated');
    }

    updateSingleStationCard(stationType, stationData) {
        if (!stationData) return;

        // Update pending count
        const pendingElement = document.getElementById(`${stationType}-pending`);
        if (pendingElement) {
            this.updateNumberWithAnimation(pendingElement, stationData.pending_count || 0);
        }

        // Update volume
        const volumeElement = document.getElementById(`${stationType}-today-m3`);
        if (volumeElement) {
            const volume = this.cleanBackendValue(stationData.today_m3);
            this.updateNumberWithAnimation(volumeElement, volume.toFixed(4));
        }

        // Update status indicator
        const statusElement = document.getElementById(`${stationType}-status`);
        if (statusElement) {
            this.updateStationStatus(statusElement, stationData);
        }
    }

    updateTodayTotalsWidget(totalsData) {
        if (!totalsData) return;

        this.updateTodayValue('today-completed', totalsData.completed_orders || 0, 'liczba');
        this.updateTodayValue('today-total-m3', totalsData.total_m3 || 0, 'm3');
        this.updateTodayValue('today-avg-deadline', totalsData.avg_deadline_distance || 0, 'dni');

        this.updateTodayDate();
    }

    updateAlertsWidget(alertsData) {
        const alertsCount = document.getElementById('alerts-count');
        const alertsList = document.getElementById('alerts-list');

        if (alertsCount) {
            alertsCount.textContent = alertsData ? alertsData.length : 0;
        }

        if (alertsList) {
            if (!alertsData || alertsData.length === 0) {
                alertsList.innerHTML = this.getNoAlertsHTML();
            } else {
                alertsList.innerHTML = alertsData.map(alert =>
                    this.createAlertHTML(alert)
                ).join('');
            }
        }
    }

    updateSystemHealthWidget(healthData) {
        if (!healthData) return;

        this.updateHealthIndicator(healthData);
        this.updateLastSync(healthData.last_sync, healthData.sync_status);
        this.updateDatabaseStatus(healthData.database_status);
        this.updateSystemErrors(healthData.errors_24h);
    }

    // ========================================================================
    // PERFORMANCE CHART - For Admins
    // ========================================================================

    async initializePerformanceChart() {
        if (!this.config.user?.isAdmin || typeof Chart === 'undefined') {
            console.log('[Dashboard Module] Performance chart not available');
            return;
        }

        console.log('[Dashboard Module] Initializing performance chart...');

        try {
            const chartContainer = document.querySelector('.widget.performance-chart');
            if (!chartContainer) return;

            // Initialize chart controls
            this.initChartControls(chartContainer);

            // Load chart data
            await this.loadChartData(7); // Default 7 days

        } catch (error) {
            console.error('[Dashboard Module] Chart initialization failed:', error);
        }
    }

    initChartControls(container) {
        const controlsContainer = container.querySelector('.chart-controls');
        if (!controlsContainer) return;

        controlsContainer.innerHTML = `
            <select id="chart-period-select" class="form-select form-select-sm">
                <option value="7">Ostatnie 7 dni</option>
                <option value="14">Ostatnie 14 dni</option>
                <option value="30">Ostatnie 30 dni</option>
            </select>
            <button id="chart-refresh-btn" class="btn btn-outline-primary btn-sm">
                <i class="fas fa-sync-alt"></i>
            </button>
        `;

        // Event listeners
        const periodSelect = document.getElementById('chart-period-select');
        const refreshBtn = document.getElementById('chart-refresh-btn');

        if (periodSelect) {
            periodSelect.addEventListener('change', (e) => {
                this.loadChartData(parseInt(e.target.value));
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                const period = parseInt(periodSelect?.value || 7);
                this.loadChartData(period);
            });
        }
    }

    async loadChartData(period) {
        try {
            const response = await this.shared.apiClient.request(`/chart-data?period=${period}`);

            if (response.success) {
                this.createOrUpdateChart(response.chart_data, response.summary);
                this.state.chartData = response;
            }

        } catch (error) {
            console.error('[Dashboard Module] Chart data loading failed:', error);
            this.showChartError('Błąd ładowania danych wykresu');
        }
    }

    createOrUpdateChart(chartData, summary) {
        const canvas = document.getElementById('performance-chart-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Destroy existing chart
        if (this.chartInstance) {
            this.chartInstance.destroy();
        }

        // Create new chart
        this.chartInstance = new Chart(ctx, {
            type: 'line',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `Wydajność produkcji (${summary.period_days} dni)`,
                        font: { size: 14, weight: 'bold' }
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Data'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Objętość (m³)'
                        },
                        beginAtZero: true
                    }
                }
            }
        });
    }

    showChartError(message) {
        const chartContainer = document.querySelector('.widget.performance-chart .widget-content');
        if (chartContainer) {
            chartContainer.innerHTML = `
                <div class="alert alert-danger">
                    <strong>Błąd wykresu:</strong> ${message}
                </div>
            `;
        }
    }

    // ========================================================================
    // EVENT LISTENERS
    // ========================================================================

    setupEventListeners() {
        // Manual sync button
        const manualSyncBtn = document.getElementById('manual-sync-btn');
        if (manualSyncBtn) {
            manualSyncBtn.addEventListener('click', this.handleManualSync.bind(this));
        }

        // System errors modal
        const showErrorsBtn = document.querySelector('.error-details-btn');
        if (showErrorsBtn) {
            showErrorsBtn.addEventListener('click', this.showSystemErrorsModal.bind(this));
        }

        // Clear errors button
        const clearErrorsBtn = document.querySelector('[onclick*="clearSystemErrors"]');
        if (clearErrorsBtn) {
            clearErrorsBtn.addEventListener('click', this.clearSystemErrors.bind(this));
        }

        console.log('[Dashboard Module] Event listeners setup complete');
    }

    removeEventListeners() {
        // Remove any manually attached listeners
        // Most will be cleaned up when DOM is replaced
    }

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================

    async handleManualSync() {
        try {
            this.shared.loadingManager.show('manual-sync', 'Synchronizacja w toku...');

            const response = await this.shared.apiClient.triggerManualSync();

            if (response.success) {
                this.shared.toastSystem.show('Synchronizacja zakończona pomyślnie', 'success');

                // Refresh dashboard after sync
                setTimeout(() => {
                    this.refresh();
                }, 2000);
            } else {
                throw new Error(response.error || 'Synchronizacja nie powiodła się');
            }

        } catch (error) {
            console.error('[Dashboard Module] Manual sync failed:', error);
            this.shared.toastSystem.show('Błąd synchronizacji: ' + error.message, 'error');
        } finally {
            this.shared.loadingManager.hide('manual-sync');
        }
    }

    showSystemErrorsModal() {
        // TODO: Implement system errors modal
        this.shared.toastSystem.show('Modal błędów systemu będzie dostępny wkrótce', 'info');
    }

    clearSystemErrors() {
        // TODO: Implement clear system errors
        this.shared.toastSystem.show('Czyszczenie błędów systemu będzie dostępne wkrótce', 'info');
    }

    // ========================================================================
    // AUTO REFRESH
    // ========================================================================

    setupAutoRefresh() {
        // Refresh dashboard every 3 minutes
        this.autoRefreshInterval = setInterval(() => {
            if (!document.hidden) {
                this.refresh();
            }
        }, 180000);

        console.log('[Dashboard Module] Auto-refresh setup (3 minutes)');
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    cleanBackendValue(value) {
        if (value === "-" || value === null || value === undefined || value === "") {
            return 0;
        }

        if (typeof value === 'string' && !isNaN(parseFloat(value))) {
            return parseFloat(value);
        }

        if (typeof value === 'number') {
            return value;
        }

        return 0;
    }

    updateNumberWithAnimation(element, newValue) {
        if (!element) return;

        const currentValue = parseFloat(element.textContent) || 0;
        const targetValue = parseFloat(newValue) || 0;

        if (currentValue === targetValue) return;

        // Simple animation
        const duration = 800;
        const steps = 20;
        const stepValue = (targetValue - currentValue) / steps;
        const stepTime = duration / steps;

        let currentStep = 0;

        const animate = () => {
            currentStep++;
            const intermediateValue = currentValue + (stepValue * currentStep);

            if (currentStep < steps) {
                element.textContent = typeof newValue === 'string' && newValue.includes('.')
                    ? intermediateValue.toFixed(4)
                    : Math.round(intermediateValue);
                setTimeout(animate, stepTime);
            } else {
                element.textContent = newValue;
            }
        };

        animate();
    }

    updateTodayValue(elementId, value, type) {
        const element = document.getElementById(elementId);
        if (!element) return;

        const cleanValue = this.cleanBackendValue(value);
        let displayValue;

        switch (type) {
            case 'liczba':
                displayValue = cleanValue;
                break;
            case 'm3':
                displayValue = cleanValue.toFixed(4);
                break;
            case 'dni':
                displayValue = Math.round(cleanValue);
                break;
            default:
                displayValue = cleanValue;
        }

        this.updateNumberWithAnimation(element, displayValue);
    }

    updateTodayDate() {
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

    updateLastRefreshTime(elementId) {
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

    updateStationStatus(statusElement, stationData) {
        const statusDot = statusElement.querySelector('.status-dot');
        if (!statusDot) return;

        const pendingCount = stationData.pending_count || 0;

        // Reset classes
        statusDot.classList.remove('active', 'warning', 'danger');

        // Apply status based on pending count
        if (pendingCount === 0) {
            // No class = default gray
        } else if (pendingCount > 25) {
            statusDot.classList.add('danger');
        } else if (pendingCount > 15) {
            statusDot.classList.add('warning');
        } else {
            statusDot.classList.add('active');
        }
    }

    updateHealthIndicator(health) {
        const indicator = document.getElementById('health-indicator');
        if (!indicator) return;

        let overallStatus = 'healthy';
        let statusText = 'System działa poprawnie';

        if (health.database_status !== 'connected') {
            overallStatus = 'critical';
            statusText = 'Problemy z bazą danych';
        } else if (health.sync_status !== 'success') {
            overallStatus = 'warning';
            statusText = 'Problemy z synchronizacją';
        } else if (health.errors_24h && health.errors_24h > 5) {
            overallStatus = 'warning';
            statusText = 'Wykryto błędy systemu';
        }

        indicator.className = `health-indicator health-${overallStatus}`;
        indicator.textContent = statusText;
    }

    updateLastSync(lastSync, syncStatus) {
        const element = document.getElementById('last-sync-time');
        if (!element) return;

        if (lastSync) {
            const syncDate = new Date(lastSync);
            const timeText = syncDate.toLocaleString('pl-PL', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            element.textContent = timeText;
        } else {
            element.textContent = 'Brak danych';
        }
    }

    updateDatabaseStatus(dbStatus) {
        const element = document.getElementById('db-response-time');
        if (element) {
            element.textContent = dbStatus === 'connected' ? 'Połączona' : 'Rozłączona';
        }
    }

    updateSystemErrors(errorCount) {
        const element = document.getElementById('error-count');
        if (element) {
            element.textContent = errorCount || 0;
        }
    }

    getNoAlertsHTML() {
        return `
            <div class="no-alerts-state">
                <div class="no-alerts-icon">✅</div>
                <p class="no-alerts-text">Brak pilnych alertów</p>
                <small class="text-muted">Wszystkie produkty zgodne z terminem</small>
            </div>
        `;
    }

    createAlertHTML(alert) {
        const urgencyClass = alert.days_remaining <= 0 ? 'alert-overdue' :
            alert.days_remaining <= 1 ? 'alert-critical' :
                alert.days_remaining <= 2 ? 'alert-warning' : 'alert-normal';

        const urgencyIcon = alert.days_remaining <= 0 ? '🚨' :
            alert.days_remaining <= 1 ? '⚠️' :
                alert.days_remaining <= 2 ? '⏳' : '⏰';

        return `
            <div class="alert-item ${urgencyClass}">
                <div class="alert-icon">${urgencyIcon}</div>
                <div class="alert-content">
                    <div class="alert-header">
                        <span class="alert-product-id">${alert.short_product_id}</span>
                        <span class="alert-days">${alert.days_remaining} dni</span>
                    </div>
                    <div class="alert-details">
                        <span class="alert-deadline">Termin: ${alert.deadline_date}</span>
                    </div>
                </div>
            </div>
        `;
    }
}