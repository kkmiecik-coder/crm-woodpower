/**
 * Dashboard Baselinker Sync Modal
 * app/modules/production/static/js/modules/dashboard_bl_sync_modal.js
 * 
 * Obsługa modalu synchronizacji z Baselinkerem dla modułu production
 * Wersja: 1.0
 * Data: 2024-09-16
 */

class DashboardBLSyncModal {
    constructor() {
        this.modalElement = null;
        this.modalInstance = null;
        this.syncInProgress = false;
        this.syncStartTime = null;
        this.logEntries = [];
        this.statsCounters = {
            pages: 0,
            orders: 0,
            products: 0,
            skipped: 0,
            errors: 0
        };

        // Referencje do elementów DOM
        this.domElements = {};

        // Konfiguracja
        this.config = {
            syncPeriodDays: 25, // Zawsze 25 dni wstecz
            apiTimeout: 30000,  // 30 sekund timeout
            maxRetries: 3,
            logMaxEntries: 1000,
            excludedKeywords: [
                'usługa', 'usługi', 'usługowa', 'usługowe',
                'deska', 'deski', 'worek', 'worki', 'worków',
                'tarcica', 'tarcicy'
            ]
        };

        console.log('[BL Sync Modal] Inicjalizacja modalu synchronizacji');
        this.init();
    }

    /**
     * Inicjalizacja modalu
     */
    init() {
        try {
            this.modalElement = document.getElementById('baselinkerSyncModal');
            if (!this.modalElement) {
                console.error('[BL Sync Modal] Element modal nie znaleziony');
                return;
            }

            // Inicjalizacja Bootstrap Modal
            this.modalInstance = new bootstrap.Modal(this.modalElement, {
                backdrop: 'static',
                keyboard: false
            });

            // Cachowanie referencji DOM
            this.cacheDOMReferences();

            // Setup event listeners
            this.setupEventListeners();

            console.log('[BL Sync Modal] Modal zainicjalizowany pomyślnie');

        } catch (error) {
            console.error('[BL Sync Modal] Błąd inicjalizacji:', error);
        }
    }

    /**
     * Cachowanie referencji do elementów DOM
     */
    cacheDOMReferences() {
        this.domElements = {
            // Steps
            step1: document.getElementById('sync-step-1'),
            step2: document.getElementById('sync-step-2'),
            step3: document.getElementById('sync-step-3'),

            // Form elements
            form: document.getElementById('baselinker-sync-form'),
            syncType: document.getElementById('sync-type'),
            syncLimit: document.getElementById('sync-limit'),
            forceUpdate: document.getElementById('force-update'),
            skipValidation: document.getElementById('skip-validation'),
            dryRun: document.getElementById('dry-run'),
            debugMode: document.getElementById('debug-mode'),

            // Status checkboxes
            statusProduction: document.getElementById('status-production'),
            statusReady: document.getElementById('status-ready'),
            statusPacked: document.getElementById('status-packed'),
            statusOther: document.getElementById('status-other'),

            // Progress elements
            syncStatus: document.getElementById('sync-status'),
            syncDetails: document.getElementById('sync-details'),
            syncStartTime: document.getElementById('sync-start-time'),
            syncProgress: document.getElementById('sync-progress'),
            currentOperation: document.getElementById('current-operation'),
            operationProgress: document.getElementById('operation-progress'),

            // Stats counters
            statPages: document.getElementById('stat-pages'),
            statOrders: document.getElementById('stat-orders'),
            statProducts: document.getElementById('stat-products'),
            statSkipped: document.getElementById('stat-skipped'),

            // Log
            syncLog: document.getElementById('sync-log'),

            // Results
            resultIcon: document.getElementById('result-icon'),
            syncResultTitle: document.getElementById('sync-result-title'),
            syncResultSummary: document.getElementById('sync-result-summary'),
            totalDuration: document.getElementById('total-duration'),
            syncResultsAlert: document.getElementById('sync-results-alert'),
            syncResultsContent: document.getElementById('sync-results-content'),
            finalStats: document.getElementById('final-stats'),

            // Buttons
            startSyncBtn: document.getElementById('start-sync-btn'),
            stopSyncBtn: document.getElementById('stop-sync-btn'),
            finishSyncBtn: document.getElementById('finish-sync-btn'),
            modalCancelBtn: document.getElementById('modal-cancel-btn'),
            cancelBtnText: document.getElementById('cancel-btn-text'),
            viewProductsBtn: document.getElementById('view-products-btn'),
            exportLogBtn: document.getElementById('export-log-btn'),
            syncAgainBtn: document.getElementById('sync-again-btn')
        };
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Start synchronization
        if (this.domElements.startSyncBtn) {
            this.domElements.startSyncBtn.addEventListener('click', () => {
                this.startSynchronization();
            });
        }

        // Stop synchronization
        if (this.domElements.stopSyncBtn) {
            this.domElements.stopSyncBtn.addEventListener('click', () => {
                this.stopSynchronization();
            });
        }

        // Sync again
        if (this.domElements.syncAgainBtn) {
            this.domElements.syncAgainBtn.addEventListener('click', () => {
                this.resetModal();
                this.showStep(1);
            });
        }

        // View products
        if (this.domElements.viewProductsBtn) {
            this.domElements.viewProductsBtn.addEventListener('click', () => {
                this.navigateToProducts();
            });
        }

        // Export log
        if (this.domElements.exportLogBtn) {
            this.domElements.exportLogBtn.addEventListener('click', () => {
                this.exportSyncLog();
            });
        }

        // Log filtering
        this.setupLogFiltering();

        // Modal events
        this.modalElement.addEventListener('hidden.bs.modal', () => {
            if (this.syncInProgress) {
                this.stopSynchronization();
            }
        });
    }

    /**
     * Setup log filtering functionality
     */
    setupLogFiltering() {
        const filterButtons = document.querySelectorAll('input[name="log-filter"]');
        filterButtons.forEach(btn => {
            btn.addEventListener('change', (e) => {
                this.filterLogEntries(e.target.id);
            });
        });
    }

    /**
     * Pokazuje modal synchronizacji
     */
    show() {
        console.log('[BL Sync Modal] Pokazywanie modalu');
        this.resetModal();
        this.modalInstance.show();
    }

    /**
     * Ukrywa modal synchronizacji
     */
    hide() {
        console.log('[BL Sync Modal] Ukrywanie modalu');
        if (this.syncInProgress) {
            this.stopSynchronization();
        }
        this.modalInstance.hide();
    }

    /**
     * Resetuje modal do stanu początkowego
     */
    resetModal() {
        console.log('[BL Sync Modal] Reset modalu');

        // Reset kroków
        this.showStep(1);

        // Reset formularza
        if (this.domElements.form) {
            this.domElements.form.reset();
            this.domElements.syncType.value = 'incremental';
            this.domElements.syncLimit.value = '100';
            this.domElements.statusProduction.checked = true;
            this.domElements.statusReady.checked = true;
            this.domElements.statusPacked.checked = false;
            this.domElements.statusOther.checked = false;
        }

        // Reset stats
        this.resetStats();

        // Reset log
        this.logEntries = [];
        if (this.domElements.syncLog) {
            this.domElements.syncLog.innerHTML = '';
        }

        // Reset progress
        if (this.domElements.syncProgress) {
            this.domElements.syncProgress.style.width = '0%';
            this.domElements.syncProgress.setAttribute('aria-valuenow', '0');
        }

        if (this.domElements.operationProgress) {
            this.domElements.operationProgress.style.width = '0%';
        }

        // Reset buttons
        this.updateButtons('ready');

        this.syncInProgress = false;
        this.syncStartTime = null;
    }

    /**
     * Pokazuje określony krok modalu
     */
    showStep(stepNumber) {
        console.log(`[BL Sync Modal] Przełączanie na krok ${stepNumber}`);

        // Ukryj wszystkie kroki
        [1, 2, 3].forEach(num => {
            const step = this.domElements[`step${num}`];
            if (step) {
                step.style.display = 'none';
            }
        });

        // Pokaż wybrany krok
        const targetStep = this.domElements[`step${stepNumber}`];
        if (targetStep) {
            targetStep.style.display = 'block';
        }

        // Aktualizuj przyciski
        switch (stepNumber) {
            case 1:
                this.updateButtons('ready');
                break;
            case 2:
                this.updateButtons('syncing');
                break;
            case 3:
                this.updateButtons('finished');
                break;
        }
    }

    /**
     * Aktualizuje stan przycisków
     */
    updateButtons(state) {
        const elements = this.domElements;

        switch (state) {
            case 'ready':
                if (elements.startSyncBtn) elements.startSyncBtn.style.display = 'inline-block';
                if (elements.stopSyncBtn) elements.stopSyncBtn.style.display = 'none';
                if (elements.finishSyncBtn) elements.finishSyncBtn.style.display = 'none';
                if (elements.cancelBtnText) elements.cancelBtnText.textContent = 'Anuluj';
                break;

            case 'syncing':
                if (elements.startSyncBtn) elements.startSyncBtn.style.display = 'none';
                if (elements.stopSyncBtn) elements.stopSyncBtn.style.display = 'inline-block';
                if (elements.finishSyncBtn) elements.finishSyncBtn.style.display = 'none';
                if (elements.cancelBtnText) elements.cancelBtnText.textContent = 'Anuluj';
                break;

            case 'finished':
                if (elements.startSyncBtn) elements.startSyncBtn.style.display = 'none';
                if (elements.stopSyncBtn) elements.stopSyncBtn.style.display = 'none';
                if (elements.finishSyncBtn) elements.finishSyncBtn.style.display = 'inline-block';
                if (elements.cancelBtnText) elements.cancelBtnText.textContent = 'Zamknij';
                break;
        }
    }

    /**
     * Resetuje statystyki
     */
    resetStats() {
        this.statsCounters = {
            pages: 0,
            orders: 0,
            products: 0,
            skipped: 0,
            errors: 0
        };
        this.updateStatsDisplay();
    }

    /**
     * Aktualizuje wyświetlanie statystyk
     */
    updateStatsDisplay() {
        const elements = this.domElements;
        if (elements.statPages) elements.statPages.textContent = this.statsCounters.pages;
        if (elements.statOrders) elements.statOrders.textContent = this.statsCounters.orders;
        if (elements.statProducts) elements.statProducts.textContent = this.statsCounters.products;
        if (elements.statSkipped) elements.statSkipped.textContent = this.statsCounters.skipped;
    }

    /**
     * Rozpoczyna synchronizację
     */
    async startSynchronization() {
        console.log('[BL Sync Modal] Rozpoczynanie synchronizacji');

        try {
            // Walidacja formularza
            const params = this.collectFormParameters();
            if (!this.validateParameters(params)) {
                return;
            }

            // Przełącz na krok 2
            this.showStep(2);

            // Setup initial state
            this.syncInProgress = true;
            this.syncStartTime = new Date();

            if (this.domElements.syncStartTime) {
                this.domElements.syncStartTime.textContent = this.syncStartTime.toLocaleTimeString();
            }

            this.addLogEntry('🚀 Rozpoczynanie synchronizacji z Baselinker...', 'info');
            this.addLogEntry(`📋 Parametry: ${JSON.stringify(params, null, 2)}`, 'debug');

            // Start sync process
            await this.performSynchronization(params);

        } catch (error) {
            console.error('[BL Sync Modal] Błąd podczas synchronizacji:', error);
            this.handleSyncError(error);
        }
    }

    /**
     * Zbiera parametry z formularza
     */
    collectFormParameters() {
        const elements = this.domElements;

        // Zbierz zaznaczone statusy
        const targetStatuses = [];
        if (elements.statusProduction?.checked) targetStatuses.push('138619');
        if (elements.statusReady?.checked) targetStatuses.push('148832');
        if (elements.statusPacked?.checked) targetStatuses.push('148831');

        return {
            sync_type: elements.syncType?.value || 'incremental',
            period_days: this.config.syncPeriodDays, // Zawsze 25 dni
            limit_per_page: parseInt(elements.syncLimit?.value || '100'),
            target_statuses: targetStatuses,
            force_update: elements.forceUpdate?.checked || false,
            skip_validation: elements.skipValidation?.checked || false,
            dry_run: elements.dryRun?.checked || false,
            debug_mode: elements.debugMode?.checked || false,
            excluded_keywords: this.config.excludedKeywords
        };
    }

    /**
     * Waliduje parametry synchronizacji
     */
    validateParameters(params) {
        if (!params.target_statuses || params.target_statuses.length === 0) {
            this.addLogEntry('❌ Błąd: Nie wybrano żadnego statusu zamówień', 'error');
            alert('Wybierz przynajmniej jeden status zamówień do synchronizacji.');
            return false;
        }

        if (params.limit_per_page < 10 || params.limit_per_page > 200) {
            this.addLogEntry('❌ Błąd: Nieprawidłowy limit na stronę', 'error');
            alert('Limit zamówień na stronę musi być między 10 a 200.');
            return false;
        }

        return true;
    }

    /**
     * Wykonuje proces synchronizacji
     */
    async performSynchronization(params) {
        this.updateProgress(5, 'Inicjalizacja połączenia...');
        this.updateCurrentOperation('Łączenie z API Baselinker', 10);

        try {
            // Wywołaj API synchronizacji
            const response = await fetch('/production/api/sync/baselinker', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify(params),
                signal: AbortSignal.timeout(this.config.apiTimeout)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.success) {
                await this.handleSyncSuccess(result);
            } else {
                throw new Error(result.error || 'Nieznany błąd synchronizacji');
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                this.addLogEntry('⏰ Timeout: Przekroczono czas oczekiwania na odpowiedź', 'warning');
                throw new Error('Timeout synchronizacji - spróbuj ponownie');
            }
            throw error;
        }
    }

    /**
     * Obsługuje sukces synchronizacji
     */
    async handleSyncSuccess(result) {
        console.log('[BL Sync Modal] Synchronizacja zakończona sukcesem:', result);

        this.updateProgress(100, 'Synchronizacja zakończona');
        this.updateCurrentOperation('Finalizowanie...', 100);

        // Aktualizuj statystyki z wyniku
        if (result.data && result.data.stats) {
            const stats = result.data.stats;
            this.statsCounters.pages = stats.pages_processed || 0;
            this.statsCounters.orders = stats.orders_processed || 0;
            this.statsCounters.products = stats.products_created || 0;
            this.statsCounters.skipped = stats.products_skipped || 0;
            this.statsCounters.errors = stats.errors_count || 0;
            this.updateStatsDisplay();
        }

        this.addLogEntry('✅ Synchronizacja zakończona pomyślnie!', 'success');

        // Przechodzi do kroku 3 po krótkiej pauzie
        setTimeout(() => {
            this.showSyncResults(result, 'success');
        }, 1000);
    }

    /**
     * Obsługuje błąd synchronizacji
     */
    handleSyncError(error) {
        console.error('[BL Sync Modal] Błąd synchronizacji:', error);

        this.syncInProgress = false;
        this.addLogEntry(`❌ Błąd synchronizacji: ${error.message}`, 'error');

        // Przechodzi do kroku 3 z błędem
        setTimeout(() => {
            this.showSyncResults({ error: error.message }, 'error');
        }, 1000);
    }

    /**
     * Zatrzymuje synchronizację
     */
    stopSynchronization() {
        console.log('[BL Sync Modal] Zatrzymywanie synchronizacji');

        this.syncInProgress = false;
        this.addLogEntry('🛑 Synchronizacja zatrzymana przez użytkownika', 'warning');

        // Reset do kroku 1
        setTimeout(() => {
            this.resetModal();
        }, 500);
    }

    /**
     * Pokazuje wyniki synchronizacji
     */
    showSyncResults(result, type) {
        console.log('[BL Sync Modal] Pokazywanie wyników:', type);

        this.showStep(3);
        this.syncInProgress = false;

        const elements = this.domElements;

        // Oblicz czas trwania
        const duration = this.syncStartTime ?
            Math.floor((new Date() - this.syncStartTime) / 1000) : 0;
        const durationFormatted = this.formatDuration(duration);

        if (elements.totalDuration) {
            elements.totalDuration.textContent = durationFormatted;
        }

        if (type === 'success') {
            // Sukces
            if (elements.resultIcon) {
                elements.resultIcon.innerHTML = '<i class="fas fa-check-circle text-success"></i>';
            }
            if (elements.syncResultTitle) {
                elements.syncResultTitle.textContent = 'Synchronizacja zakończona pomyślnie!';
            }
            if (elements.syncResultSummary) {
                elements.syncResultSummary.textContent = 'Wszystkie dane zostały zsynchronizowane z Baselinker.';
            }

            this.showSuccessResults(result);

        } else {
            // Błąd
            if (elements.resultIcon) {
                elements.resultIcon.innerHTML = '<i class="fas fa-exclamation-circle text-danger"></i>';
            }
            if (elements.syncResultTitle) {
                elements.syncResultTitle.textContent = 'Błąd synchronizacji';
            }
            if (elements.syncResultSummary) {
                elements.syncResultSummary.textContent = 'Synchronizacja nie została ukończona z powodu błędu.';
            }

            this.showErrorResults(result);
        }
    }

    /**
     * Pokazuje szczegóły sukcesu
     */
    showSuccessResults(result) {
        const elements = this.domElements;
        const stats = result.data?.stats || {};

        if (elements.syncResultsAlert) {
            elements.syncResultsAlert.className = 'alert alert-success';
        }

        if (elements.syncResultsContent) {
            elements.syncResultsContent.innerHTML = `
                <h6><i class="fas fa-chart-bar me-2"></i>Podsumowanie synchronizacji</h6>
                <div class="row">
                    <div class="col-md-6">
                        <ul class="mb-0">
                            <li><strong>Strony API przetworzono:</strong> ${stats.pages_processed || 0}</li>
                            <li><strong>Zamówienia pobrane:</strong> ${stats.orders_processed || 0}</li>
                            <li><strong>Produkty utworzone:</strong> ${stats.products_created || 0}</li>
                        </ul>
                    </div>
                    <div class="col-md-6">
                        <ul class="mb-0">
                            <li><strong>Produkty zaktualizowane:</strong> ${stats.products_updated || 0}</li>
                            <li><strong>Pozycje pominięte:</strong> ${stats.products_skipped || 0}</li>
                            <li><strong>Błędy:</strong> ${stats.errors_count || 0}</li>
                        </ul>
                    </div>
                </div>
            `;
        }

        // Aktualizuj finalne statystyki
        this.showFinalStats(stats);
    }

    /**
     * Pokazuje szczegóły błędu
     */
    showErrorResults(result) {
        const elements = this.domElements;

        if (elements.syncResultsAlert) {
            elements.syncResultsAlert.className = 'alert alert-danger';
        }

        if (elements.syncResultsContent) {
            elements.syncResultsContent.innerHTML = `
                <h6><i class="fas fa-exclamation-triangle me-2"></i>Szczegóły błędu</h6>
                <p class="mb-2"><strong>Komunikat:</strong></p>
                <div class="bg-light p-2 rounded">
                    <code>${result.error || 'Nieznany błąd'}</code>
                </div>
                <p class="mt-3 mb-0">
                    <small class="text-muted">
                        Sprawdź logi powyżej aby uzyskać więcej informacji. 
                        Jeśli problem się powtarza, skontaktuj się z administratorem.
                    </small>
                </p>
            `;
        }
    }

    /**
     * Pokazuje finalne statystyki
     */
    showFinalStats(stats) {
        if (!this.domElements.finalStats) return;

        this.domElements.finalStats.innerHTML = `
            <div class="col-3">
                <div class="stat-card bg-info text-white p-3 rounded text-center">
                    <h4 class="mb-1">${stats.orders_processed || 0}</h4>
                    <small>Zamówienia</small>
                </div>
            </div>
            <div class="col-3">
                <div class="stat-card bg-success text-white p-3 rounded text-center">
                    <h4 class="mb-1">${stats.products_created || 0}</h4>
                    <small>Utworzone</small>
                </div>
            </div>
            <div class="col-3">
                <div class="stat-card bg-warning text-white p-3 rounded text-center">
                    <h4 class="mb-1">${stats.products_skipped || 0}</h4>
                    <small>Pominięte</small>
                </div>
            </div>
            <div class="col-3">
                <div class="stat-card bg-danger text-white p-3 rounded text-center">
                    <h4 class="mb-1">${stats.errors_count || 0}</h4>
                    <small>Błędy</small>
                </div>
            </div>
        `;
    }

    /**
     * Aktualizuje progress bar
     */
    updateProgress(percent, message) {
        if (this.domElements.syncProgress) {
            this.domElements.syncProgress.style.width = `${percent}%`;
            this.domElements.syncProgress.setAttribute('aria-valuenow', percent);
        }

        if (this.domElements.syncDetails && message) {
            this.domElements.syncDetails.textContent = message;
        }
    }

    /**
     * Aktualizuje aktualną operację
     */
    updateCurrentOperation(operation, percent = null) {
        if (this.domElements.currentOperation) {
            this.domElements.currentOperation.textContent = operation;
        }

        if (percent !== null && this.domElements.operationProgress) {
            this.domElements.operationProgress.style.width = `${percent}%`;
        }
    }

    /**
     * Dodaje wpis do loga
     */
    addLogEntry(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const entry = {
            timestamp,
            message,
            type,
            id: Date.now() + Math.random()
        };

        this.logEntries.push(entry);

        // Limit entries
        if (this.logEntries.length > this.config.logMaxEntries) {
            this.logEntries.shift();
        }

        // Add to DOM
        this.addLogEntryToDOM(entry);

        // Debug output
        if (type === 'debug' && (!this.domElements.debugMode || !this.domElements.debugMode.checked)) {
            return;
        }

        console.log(`[BL Sync Modal] ${type.toUpperCase()}: ${message}`);
    }

    /**
     * Dodaje wpis do DOM loga
     */
    addLogEntryToDOM(entry) {
        if (!this.domElements.syncLog) return;

        const entryElement = document.createElement('div');
        entryElement.className = `log-entry log-${entry.type}`;
        entryElement.setAttribute('data-type', entry.type);
        entryElement.innerHTML = `
            <span class="log-timestamp">[${entry.timestamp}]</span> ${entry.message}
        `;

        this.domElements.syncLog.appendChild(entryElement);
        this.domElements.syncLog.scrollTop = this.domElements.syncLog.scrollHeight;
    }

    /**
     * Filtruje wpisy loga
     */
    filterLogEntries(filterType) {
        const entries = this.domElements.syncLog.querySelectorAll('.log-entry');

        entries.forEach(entry => {
            const type = entry.getAttribute('data-type');
            let show = false;

            switch (filterType) {
                case 'log-all':
                    show = true;
                    break;
                case 'log-errors':
                    show = type === 'error';
                    break;
                case 'log-success':
                    show = type === 'success';
                    break;
            }

            entry.classList.toggle('filtered-out', !show);
        });
    }

    /**
     * Eksportuje log synchronizacji
     */
    exportSyncLog() {
        const logText = this.logEntries
            .map(entry => `[${entry.timestamp}] ${entry.type.toUpperCase()}: ${entry.message}`)
            .join('\n');

        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `baselinker-sync-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.addLogEntry('📁 Log został wyeksportowany', 'info');
    }

    /**
     * Nawiguje do listy produktów
     */
    navigateToProducts() {
        // Sprawdź czy jesteśmy w aplikacji z zakładkami
        if (typeof window.ProductionApp !== 'undefined' && window.ProductionApp.switchToTab) {
            window.ProductionApp.switchToTab('products-tab');
            this.hide();
        } else {
            // Redirect bezpośredni
            window.location.href = '/production/products';
        }
    }

    /**
     * Formatuje czas trwania
     */
    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

/**
 * Globalna instancja modalu
 */
let dashboardBLSyncModal = null;

/**
 * Inicjalizacja po załadowaniu DOM
 */
function initializeBLSyncModal() {
    console.log('[BL Sync Modal] Próba inicjalizacji modalu...');

    const modalElement = document.getElementById('baselinkerSyncModal');
    if (modalElement) {
        if (!dashboardBLSyncModal) {
            dashboardBLSyncModal = new DashboardBLSyncModal();
            console.log('[BL Sync Modal] Modal zainicjalizowany i gotowy');
        }
        return true;
    } else {
        console.warn('[BL Sync Modal] Element modal nie znaleziony');
        return false;
    }
}

// Spróbuj na DOMContentLoaded
document.addEventListener('DOMContentLoaded', initializeBLSyncModal);

// Fallback - spróbuj ponownie po 1 sekundzie jeśli nie udało się
setTimeout(() => {
    if (!dashboardBLSyncModal) {
        console.log('[BL Sync Modal] Retry inicjalizacji...');
        initializeBLSyncModal();
    }
}, 1000);

/**
 * Globalne funkcje pomocnicze
 */

/**
 * Pokazuje modal synchronizacji z Baselinkerem
 * Może być wywołana z innych części aplikacji
 */
window.showBaselinkerSyncModal = function() {
    console.log('[BL Sync Modal] Wywołano showBaselinkerSyncModal()');

    if (dashboardBLSyncModal) {
        dashboardBLSyncModal.show();
    } else {
        // Spróbuj zainicjalizować ponownie
        console.log('[BL Sync Modal] Próba ponownej inicjalizacji...');
        if (initializeBLSyncModal()) {
            dashboardBLSyncModal.show();
        } else {
            alert('Modal synchronizacji nie jest dostępny. Odśwież stronę i spróbuj ponownie.');
        }
    }
};

/**
 * Ukrywa modal synchronizacji
 */
window.hideBaselinkerSyncModal = function () {
    console.log('[BL Sync Modal] Wywołano hideBaselinkerSyncModal()');

    if (dashboardBLSyncModal) {
        dashboardBLSyncModal.hide();
    }
};

/**
 * Sprawdza czy modal jest aktywny
 */
window.isBaselinkerSyncModalActive = function () {
    return dashboardBLSyncModal ? dashboardBLSyncModal.syncInProgress : false;
};

/**
 * Integracja z istniejącym DashboardModule
 * Jeśli istnieje globalny DashboardModule, zastąp jego metodę handleManualSync
 */
if (typeof window.DashboardModule !== 'undefined') {
    console.log('[BL Sync Modal] Znaleziono DashboardModule - zastępowanie handleManualSync');

    // Zachowaj oryginalną metodę jako backup
    window.DashboardModule.originalHandleManualSync = window.DashboardModule.handleManualSync;

    // Zastąp metodę nową implementacją
    window.DashboardModule.handleManualSync = function () {
        console.log('[Dashboard Module] handleManualSync przekierowane do modalu');
        window.showBaselinkerSyncModal();
    };
} else {
    console.log('[BL Sync Modal] DashboardModule nie znaleziony - modal będzie działał niezależnie');
}

/**
 * Obsługa przycisków synchronizacji w dashboard
 * Automatyczne podłączenie do przycisków z odpowiednimi ID lub klasami
 */
document.addEventListener('DOMContentLoaded', function () {
    // Znajdź przyciski synchronizacji
    const syncButtons = document.querySelectorAll(
        '#manual-sync-btn, .manual-sync-btn, [data-action="manual-sync"], [data-sync="baselinker"]'
    );

    if (syncButtons.length > 0) {
        console.log(`[BL Sync Modal] Znaleziono ${syncButtons.length} przycisk(ów) synchronizacji`);

        syncButtons.forEach((btn, index) => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();

                console.log(`[BL Sync Modal] Kliknięto przycisk synchronizacji #${index}`);
                window.showBaselinkerSyncModal();
            });
        });
    } else {
        console.warn('[BL Sync Modal] Nie znaleziono przycisków synchronizacji do podłączenia');
    }
});

/**
 * Debug functions - dostępne w konsoli deweloperskiej
 */
if (typeof window.debugMode !== 'undefined' && window.debugMode) {
    window.debugBLSyncModal = {
        showModal: () => window.showBaselinkerSyncModal(),
        hideModal: () => window.hideBaselinkerSyncModal(),
        resetModal: () => dashboardBLSyncModal?.resetModal(),
        getStats: () => dashboardBLSyncModal?.statsCounters,
        getLogEntries: () => dashboardBLSyncModal?.logEntries,
        isActive: () => window.isBaselinkerSyncModalActive(),
        instance: () => dashboardBLSyncModal
    };

    console.log('[BL Sync Modal] Debug functions dostępne w window.debugBLSyncModal');
}

/**
 * Export dla modułów ES6 (jeśli potrzebne)
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DashboardBLSyncModal;
}

console.log('[BL Sync Modal] Plik załadowany pomyślnie - wersja 1.0');