(function (global) {
    'use strict';

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

    class DashboardModule {
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

        // Modal / status helpers
        this.errorsModalInstance = null;
        this.isFetchingErrors = false;
        this.currentChartPeriod = 7;
        this.performanceChartInitialized = false;

        // Event tracking
        this.eventTargets = {};
        this.chartControls = {};

        // Bound handlers for cleanup
        this.boundManualSyncHandler = this.handleManualSync.bind(this);
        this.boundShowErrorsHandler = this.showSystemErrorsModal.bind(this);
        this.boundClearErrorsHandler = this.handleClearErrorsClick.bind(this);
        this.boundCloseErrorsModalHandler = this.handleCloseErrorsModal.bind(this);
        this.boundClearModalErrorsHandler = this.handleClearModalErrorsClick.bind(this);
        this.boundChartPeriodChangeHandler = this.handleChartPeriodChange.bind(this);
        this.boundChartRefreshHandler = this.handleChartRefresh.bind(this);
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
            this.setSystemStatus('info', 'Ładowanie danych dashboardu...');
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
            this.setSystemStatus('info', 'Aktualizuję dane dashboardu...');
            await this.loadDashboardContent({ skipCache: true });
            this.updateWidgets();
            this.state.lastRefresh = new Date();

            this.shared.eventBus.emit('dashboard:refreshed', {
                timestamp: this.state.lastRefresh
            });

            if (this.performanceChartInitialized) {
                this.loadChartData(this.currentChartPeriod || 7);
            }

        } catch (error) {
            console.error('[Dashboard Module] Refresh failed:', error);
            this.shared.toastSystem.show(
                'Błąd odświeżania dashboard: ' + error.message,
                'warning'
            );
            this.setSystemStatus('error', 'Błąd odświeżania: ' + error.message);
        }
    }

    // ========================================================================
    // CONTENT LOADING
    // ========================================================================

    async loadDashboardContent(options = {}) {
        const { skipCache = false } = options;
        const response = await this.shared.apiClient.getDashboardTabContent({ skipCache });

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
        this.state.stats = response.stats || {};

        if (this.state.stats.system_health) {
            this.updateProductionStatus(this.state.stats.system_health);
        } else {
            this.setSystemStatus('loading', 'Oczekiwanie na dane systemowe...');
        }

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
        this.updateProductionStatus(healthData);
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
            await this.loadChartData(this.currentChartPeriod || 7); // Default 7 days

            this.performanceChartInitialized = true;

        } catch (error) {
            console.error('[Dashboard Module] Chart initialization failed:', error);
        }
    }

    initChartControls(container) {
        const controlsContainer = container.querySelector('.chart-controls');
        if (!controlsContainer) return;

        if (!controlsContainer.dataset.initialized) {
            controlsContainer.innerHTML = `
                <div class="d-flex align-items-center gap-2">
                    <select id="chart-period-select" class="form-select form-select-sm" aria-label="Zakres wykresu">
                        <option value="7">Ostatnie 7 dni</option>
                        <option value="14">Ostatnie 14 dni</option>
                        <option value="30">Ostatnie 30 dni</option>
                    </select>
                    <button id="chart-refresh-btn" class="btn btn-outline-primary btn-sm" type="button" title="Odśwież wykres">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
            `;

            controlsContainer.dataset.initialized = 'true';
        }

        // Event listeners
        const periodSelect = document.getElementById('chart-period-select');
        const refreshBtn = document.getElementById('chart-refresh-btn');

        if (periodSelect) {
            periodSelect.value = String(this.currentChartPeriod || 7);
            periodSelect.removeEventListener('change', this.boundChartPeriodChangeHandler);
            periodSelect.addEventListener('change', this.boundChartPeriodChangeHandler);
            this.chartControls.periodSelect = periodSelect;
        }

        if (refreshBtn) {
            refreshBtn.removeEventListener('click', this.boundChartRefreshHandler);
            refreshBtn.addEventListener('click', this.boundChartRefreshHandler);
            this.chartControls.refreshBtn = refreshBtn;
        }
    }

    async loadChartData(period) {
        const normalizedPeriod = [7, 14, 30].includes(period) ? period : 7;
        this.currentChartPeriod = normalizedPeriod;

        const chartContainer = document.querySelector('.widget.performance-chart');
        const loader = chartContainer?.querySelector('.chart-loader');
        const canvas = chartContainer?.querySelector('#performance-chart-canvas');

        if (loader) {
            loader.style.display = 'flex';
        }

        if (canvas) {
            canvas.style.opacity = '0.3';
        }

        try {
            const response = await this.shared.apiClient.request(`/chart-data?period=${normalizedPeriod}`, { skipCache: true });

            if (response.success) {
                this.createOrUpdateChart(response.chart_data, response.summary);
                this.state.chartData = response.chart_data;
                this.state.chartSummary = response.summary;

                if (this.chartControls.periodSelect) {
                    this.chartControls.periodSelect.value = String(normalizedPeriod);
                }
            } else {
                throw new Error(response.error || 'Nie udało się pobrać danych wykresu');
            }

        } catch (error) {
            console.error('[Dashboard Module] Chart data loading failed:', error);
            this.showChartError(error.message || 'Błąd ładowania danych wykresu');
        } finally {
            if (loader) {
                loader.style.display = 'none';
            }

            if (canvas) {
                canvas.style.opacity = '1';
            }
        }
    }

    createOrUpdateChart(chartData, summary) {
        const canvas = document.getElementById('performance-chart-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const container = canvas.parentElement;

        if (container) {
            const errorBox = container.querySelector('.chart-error');
            if (errorBox) {
                errorBox.style.display = 'none';
            }
        }

        canvas.style.display = 'block';

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
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    title: {
                        display: true,
                        text: `Wydajność produkcji (${summary.period_days} dni)`,
                        font: { size: 14, weight: 'bold' }
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.dataset.label || '';
                                const value = context.parsed.y ?? 0;
                                return `${label}: ${value.toFixed(2)} m³`;
                            }
                        }
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
        if (!chartContainer) return;

        const canvas = chartContainer.querySelector('#performance-chart-canvas');
        const loader = chartContainer.querySelector('.chart-loader');

        if (canvas) {
            canvas.style.display = 'none';
        }

        if (loader) {
            loader.style.display = 'none';
        }

        let errorBox = chartContainer.querySelector('.chart-error');
        if (!errorBox) {
            errorBox = document.createElement('div');
            errorBox.className = 'chart-error alert alert-danger mt-3';
            chartContainer.appendChild(errorBox);
        }

        errorBox.innerHTML = `<strong>Błąd wykresu:</strong> ${this.escapeHtml(message || 'Nieznany błąd')}`;
        errorBox.style.display = 'block';
    }

    // ========================================================================
    // EVENT LISTENERS
    // ========================================================================

    setupEventListeners() {
        this.eventTargets = this.eventTargets || {};

        // Manual sync button
        const manualSyncBtn = document.getElementById('manual-sync-btn');
        if (manualSyncBtn) {
            manualSyncBtn.removeEventListener('click', this.boundManualSyncHandler);
            manualSyncBtn.addEventListener('click', this.boundManualSyncHandler);
            this.eventTargets.manualSyncBtn = manualSyncBtn;
        }

        if (this.config.user?.isAdmin) {
            // System errors modal trigger
            const showErrorsBtn = document.getElementById('show-errors-btn');
            if (showErrorsBtn) {
                showErrorsBtn.removeEventListener('click', this.boundShowErrorsHandler);
                showErrorsBtn.addEventListener('click', this.boundShowErrorsHandler);
                this.eventTargets.showErrorsBtn = showErrorsBtn;
            }

            // Widget clear errors button
            const clearErrorsBtn = document.getElementById('clear-errors-btn');
            if (clearErrorsBtn) {
                clearErrorsBtn.removeEventListener('click', this.boundClearErrorsHandler);
                clearErrorsBtn.addEventListener('click', this.boundClearErrorsHandler);
                this.eventTargets.clearErrorsBtn = clearErrorsBtn;
            }

            // Modal specific controls
            const modalElement = document.getElementById('systemErrorsModal');
            if (modalElement && global.bootstrap && typeof global.bootstrap.Modal === 'function') {
                this.errorsModalInstance = global.bootstrap.Modal.getOrCreateInstance(modalElement);

                const closeButton = modalElement.querySelector('[data-action="close-errors-modal"]');
                if (closeButton) {
                    closeButton.removeEventListener('click', this.boundCloseErrorsModalHandler);
                    closeButton.addEventListener('click', this.boundCloseErrorsModalHandler);
                    this.eventTargets.closeErrorsBtn = closeButton;
                }

                const modalClearBtn = document.getElementById('clear-modal-errors-btn');
                if (modalClearBtn) {
                    modalClearBtn.removeEventListener('click', this.boundClearModalErrorsHandler);
                    modalClearBtn.addEventListener('click', this.boundClearModalErrorsHandler);
                    this.eventTargets.modalClearErrorsBtn = modalClearBtn;
                }
            }
        }

        console.log('[Dashboard Module] Event listeners setup complete');
    }

    removeEventListeners() {
        if (!this.eventTargets) return;

        if (this.eventTargets.manualSyncBtn) {
            this.eventTargets.manualSyncBtn.removeEventListener('click', this.boundManualSyncHandler);
        }

        if (this.eventTargets.showErrorsBtn) {
            this.eventTargets.showErrorsBtn.removeEventListener('click', this.boundShowErrorsHandler);
        }

        if (this.eventTargets.clearErrorsBtn) {
            this.eventTargets.clearErrorsBtn.removeEventListener('click', this.boundClearErrorsHandler);
        }

        if (this.eventTargets.closeErrorsBtn) {
            this.eventTargets.closeErrorsBtn.removeEventListener('click', this.boundCloseErrorsModalHandler);
        }

        if (this.eventTargets.modalClearErrorsBtn) {
            this.eventTargets.modalClearErrorsBtn.removeEventListener('click', this.boundClearModalErrorsHandler);
        }

        if (this.chartControls.periodSelect) {
            this.chartControls.periodSelect.removeEventListener('change', this.boundChartPeriodChangeHandler);
        }

        if (this.chartControls.refreshBtn) {
            this.chartControls.refreshBtn.removeEventListener('click', this.boundChartRefreshHandler);
        }

        this.eventTargets = {};
        this.chartControls = {};
        this.errorsModalInstance = null;
    }

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================

    async handleManualSync(event) {
        if (event) {
            event.preventDefault();
        }

        try {
            this.shared.loadingManager.show('manual-sync', 'Synchronizacja w toku...');
            this.setSystemStatus('info', 'Rozpoczęto synchronizację danych...');

            const response = await this.shared.apiClient.triggerManualSync();

            if (response.success) {
                this.shared.toastSystem.show('Synchronizacja zakończona pomyślnie', 'success');
                this.setSystemStatus('info', 'Synchronizacja zakończona, odświeżam dane...');

                setTimeout(() => {
                    this.refresh();
                }, 800);
            } else {
                throw new Error(response.error || 'Synchronizacja nie powiodła się');
            }

        } catch (error) {
            console.error('[Dashboard Module] Manual sync failed:', error);
            this.shared.toastSystem.show('Błąd synchronizacji: ' + error.message, 'error');
            this.setSystemStatus('error', 'Błąd synchronizacji: ' + error.message);
        } finally {
            this.shared.loadingManager.hide('manual-sync');
        }
    }

    async showSystemErrorsModal(event) {
        if (event) {
            event.preventDefault();
        }

        if (!this.config.user?.isAdmin) {
            this.shared.toastSystem.show('Brak uprawnień do podglądu błędów systemu', 'warning');
            return;
        }

        const modalElement = document.getElementById('systemErrorsModal');
        if (!modalElement) {
            this.shared.toastSystem.show('Nie znaleziono modala błędów systemu', 'error');
            return;
        }

        if (!this.errorsModalInstance && global.bootstrap && typeof global.bootstrap.Modal === 'function') {
            this.errorsModalInstance = global.bootstrap.Modal.getOrCreateInstance(modalElement);
        }

        if (this.isFetchingErrors) {
            if (this.errorsModalInstance) {
                this.errorsModalInstance.show();
            }
            return;
        }

        this.isFetchingErrors = true;
        this.toggleErrorsLoading(true);

        try {
            const endpoint = this.config.endpoints?.systemErrors || '/production/admin/ajax/system-errors';
            const response = await fetch(endpoint, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'same-origin'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Nie udało się pobrać błędów systemu');
            }

            this.renderSystemErrors(data.errors || []);
            this.toggleErrorsLoading(false);

            if (this.errorsModalInstance) {
                this.errorsModalInstance.show();
            }
        } catch (error) {
            console.error('[Dashboard Module] Failed to load system errors:', error);
            this.toggleErrorsLoading(false);
            this.renderSystemErrorsError(error.message);
            this.shared.toastSystem.show('Błąd pobierania błędów systemu: ' + error.message, 'error');
            if (this.errorsModalInstance) {
                this.errorsModalInstance.show();
            }
        } finally {
            this.isFetchingErrors = false;
        }
    }

    async clearSystemErrors(options = {}) {
        const { fromModal = false, event = null } = options;

        if (event) {
            event.preventDefault();
        }

        if (!this.config.user?.isAdmin) {
            this.shared.toastSystem.show('Brak uprawnień administratora', 'warning');
            return;
        }

        const confirmed = fromModal || window.confirm('Czy na pewno chcesz oznaczyć wszystkie błędy jako rozwiązane?');
        if (!confirmed) {
            return;
        }

        try {
            if (fromModal) {
                this.toggleErrorsLoading(true);
            }

            this.shared.loadingManager.show('clear-system-errors', 'Czyszczenie błędów systemu...');

            const endpoint = this.config.endpoints?.clearSystemErrors || '/production/admin/ajax/clear-system-errors';
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'same-origin'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Nie udało się wyczyścić błędów systemu');
            }

            this.shared.toastSystem.show(data.message || 'Błędy systemu zostały wyczyszczone', 'success');

            if (this.state.stats?.system_health) {
                this.state.stats.system_health.errors_24h = 0;
                this.updateSystemErrors(0);
                this.updateProductionStatus(this.state.stats.system_health);
            }

            if (fromModal) {
                this.renderSystemErrors([]);
            }

            this.refresh();
        } catch (error) {
            console.error('[Dashboard Module] Failed to clear system errors:', error);
            this.shared.toastSystem.show('Błąd czyszczenia błędów: ' + error.message, 'error');
        } finally {
            this.shared.loadingManager.hide('clear-system-errors');
            if (fromModal) {
                this.toggleErrorsLoading(false);
            }
        }
    }

    closeSystemErrorsModal(event) {
        if (event) {
            event.preventDefault();
        }

        if (this.errorsModalInstance) {
            this.errorsModalInstance.hide();
        }

        this.isFetchingErrors = false;
        this.toggleErrorsLoading(false);
    }

    handleClearErrorsClick(event) {
        this.clearSystemErrors({ event });
    }

    handleCloseErrorsModal(event) {
        this.closeSystemErrorsModal(event);
    }

    handleClearModalErrorsClick(event) {
        this.clearSystemErrors({ fromModal: true, event });
    }

    toggleErrorsLoading(isLoading) {
        const loadingElement = document.getElementById('errors-loading');
        const listElement = document.getElementById('errors-list');
        const emptyState = document.getElementById('errors-empty');

        if (loadingElement) {
            loadingElement.style.display = isLoading ? 'block' : 'none';
        }

        if (isLoading) {
            if (listElement) {
                listElement.style.display = 'none';
            }
            if (emptyState) {
                emptyState.style.display = 'none';
            }
        }
    }

    renderSystemErrors(errors) {
        const listElement = document.getElementById('errors-list');
        const emptyState = document.getElementById('errors-empty');

        if (!listElement || !emptyState) {
            return;
        }

        if (!errors || errors.length === 0) {
            listElement.innerHTML = '';
            listElement.style.display = 'none';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        listElement.style.display = 'block';
        listElement.innerHTML = errors.map(error => this.createSystemErrorHTML(error)).join('');
    }

    renderSystemErrorsError(message) {
        const listElement = document.getElementById('errors-list');
        const emptyState = document.getElementById('errors-empty');

        if (emptyState) {
            emptyState.style.display = 'none';
        }

        if (listElement) {
            listElement.style.display = 'block';
            listElement.innerHTML = `
                <div class="alert alert-danger">
                    <strong>Nie udało się pobrać błędów systemu.</strong><br>
                    <span>${this.escapeHtml(message || 'Spróbuj ponownie później.')}</span>
                </div>
            `;
        }
    }

    createSystemErrorHTML(error) {
        const occurredAt = error?.error_occurred_at
            ? new Date(error.error_occurred_at).toLocaleString('pl-PL', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
            : 'Brak danych';

        const statusBadge = error?.is_resolved
            ? '<span class="badge bg-success">Rozwiązany</span>'
            : '<span class="badge bg-danger">Nierozwiązany</span>';

        const productInfo = error?.related_product_id
            ? `<span class="badge bg-info text-dark ms-2">Produkt #${this.escapeHtml(error.related_product_id)}</span>`
            : '';

        const orderInfo = error?.related_order_id
            ? `<span class="badge bg-secondary ms-2">Zamówienie #${this.escapeHtml(error.related_order_id)}</span>`
            : '';

        const detailsHtml = this.formatErrorDetails(error?.error_details);

        return `
            <div class="system-error-item ${error?.is_resolved ? 'resolved' : 'unresolved'}">
                <div class="system-error-header d-flex justify-content-between align-items-start">
                    <div>
                        <div class="fw-semibold text-uppercase text-muted small">${this.escapeHtml(error?.error_type || 'system')}</div>
                        <div class="system-error-message fw-semibold">${this.escapeHtml(error?.error_message || 'Brak opisu błędu')}</div>
                    </div>
                    <div class="text-end">
                        ${statusBadge}
                        <div class="text-muted small mt-1">${this.escapeHtml(occurredAt)}</div>
                    </div>
                </div>
                <div class="system-error-meta mt-2">
                    <span class="badge bg-light text-dark">Lokalizacja: ${this.escapeHtml(error?.error_location || 'Nieznana')}</span>
                    ${productInfo}
                    ${orderInfo}
                </div>
                ${detailsHtml}
            </div>
        `;
    }

    formatErrorDetails(details) {
        if (!details) {
            return '';
        }

        const normalized = typeof details === 'string'
            ? details
            : Array.isArray(details)
                ? details
                : typeof details === 'object'
                    ? Object.entries(details)
                    : [];

        if (typeof normalized === 'string') {
            return `<div class="system-error-details mt-2"><small class="text-muted">${this.escapeHtml(normalized)}</small></div>`;
        }

        const items = Array.isArray(normalized)
            ? normalized.map(entry => {
                if (Array.isArray(entry)) {
                    const [key, value] = entry;
                    return `<li><strong>${this.escapeHtml(key)}:</strong> ${this.escapeHtml(this.stringifyDetailValue(value))}</li>`;
                }
                return `<li>${this.escapeHtml(this.stringifyDetailValue(entry))}</li>`;
            })
            : [];

        if (!items.length) {
            return '';
        }

        return `
            <div class="system-error-details mt-2">
                <ul class="mb-0 small text-muted">
                    ${items.join('')}
                </ul>
            </div>
        `;
    }

    stringifyDetailValue(value) {
        if (value === null || value === undefined) {
            return 'brak danych';
        }

        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return String(value);
            }
        }

        return String(value);
    }

    handleChartPeriodChange(event) {
        const target = event?.target;
        const period = target ? parseInt(target.value, 10) : NaN;
        const normalizedPeriod = [7, 14, 30].includes(period) ? period : 7;

        this.currentChartPeriod = normalizedPeriod;
        this.loadChartData(normalizedPeriod);
    }

    handleChartRefresh(event) {
        if (event) {
            event.preventDefault();
        }

        const period = this.currentChartPeriod || parseInt(this.chartControls.periodSelect?.value, 10) || 7;
        this.loadChartData(period);
    }

    // ========================================================================
    // AUTO REFRESH
    // ========================================================================

    setupAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }

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

    escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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

    updateProductionStatus(health) {
        const statusInfo = this.determineSystemStatus(health);
        this.setSystemStatus(statusInfo.status, statusInfo.message);
    }

    setSystemStatus(status, message) {
        const indicator = document.getElementById('status-indicator');
        const textElement = document.getElementById('status-text');

        if (!indicator || !textElement) {
            return;
        }

        const statuses = ['success', 'warning', 'error', 'loading'];
        indicator.classList.remove('success', 'warning', 'error', 'loading');

        const normalizedStatus = statuses.includes(status) ? status : 'loading';

        if (status === 'info') {
            indicator.classList.add('loading');
            indicator.style.backgroundColor = '#0d6efd';
            indicator.style.boxShadow = '0 0 6px rgba(13, 110, 253, 0.45)';
        } else if (normalizedStatus === 'loading') {
            indicator.classList.add('loading');
            indicator.style.backgroundColor = '';
            indicator.style.boxShadow = '';
        } else {
            indicator.classList.add(normalizedStatus);
            indicator.style.backgroundColor = '';
            indicator.style.boxShadow = '';
        }

        indicator.dataset.status = status;
        textElement.textContent = message || '';
    }

    determineSystemStatus(health) {
        if (!health) {
            return {
                status: 'loading',
                message: 'Oczekiwanie na dane systemowe...'
            };
        }

        const databaseStatus = (health.database_status || '').toLowerCase();
        if (databaseStatus && databaseStatus !== 'connected' && databaseStatus !== 'ok') {
            return {
                status: 'error',
                message: 'Brak połączenia z bazą danych'
            };
        }

        const syncStatus = (health.sync_status || '').toLowerCase();
        if (['failed', 'error'].includes(syncStatus)) {
            return {
                status: 'error',
                message: 'Synchronizacja zakończona błędem'
            };
        }

        const errorsCount = Number(health.errors_24h) || 0;

        if (errorsCount >= 10) {
            return {
                status: 'error',
                message: `Wykryto ${errorsCount} błędów w ciągu 24h`
            };
        }

        if (syncStatus && !['success', 'completed', 'ok'].includes(syncStatus)) {
            return {
                status: 'warning',
                message: 'Synchronizacja wymaga uwagi'
            };
        }

        if (errorsCount > 0) {
            return {
                status: 'warning',
                message: `Zgłoszone błędy: ${errorsCount}`
            };
        }

        return {
            status: 'success',
            message: 'System działa poprawnie'
        };
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

    if (!global.ProductionModules) {
        global.ProductionModules = {};
    }

    global.ProductionModules.DashboardModule = DashboardModule;

})(window);
