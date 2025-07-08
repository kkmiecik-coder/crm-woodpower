// modules/reports/static/js/reports.js
/**
 * Główny manager modułu Reports
 * Odpowiedzialny za inicjalizację i koordynację wszystkich komponentów
 */

class ReportsManager {
    constructor() {
        this.currentData = [];
        this.currentStats = {};
        this.currentFilters = {};
        this.dateRange = 'last_month';
        this.isLoading = false;

        // Referencias do elementów DOM
        this.elements = {};

        console.log('[ReportsManager] Initialized');
    }

    /**
     * Inicjalizacja managera
     */
    init() {
        console.log('[ReportsManager] Starting initialization...');

        this.cacheElements();
        this.setupEventListeners();
        this.loadInitialData();

        console.log('[ReportsManager] Initialization complete');
    }

    /**
     * Cache elementów DOM
     */
    cacheElements() {
        this.elements = {
            // Kontrolki
            dateRange: document.getElementById('dateRange'),
            syncBtn: document.getElementById('syncBtn'),
            addManualRowBtn: document.getElementById('addManualRowBtn'),
            exportExcelBtn: document.getElementById('exportExcelBtn'),
            clearFiltersBtn: document.getElementById('clearFiltersBtn'),

            // Overlays
            loadingOverlay: document.getElementById('loadingOverlay'),
            syncLoadingOverlay: document.getElementById('syncLoadingOverlay'),
            syncLoadingText: document.getElementById('syncLoadingText'),

            // Statystyki
            statTotalM3: document.getElementById('statTotalM3'),
            statOrderAmountNet: document.getElementById('statOrderAmountNet'),
            statValueNet: document.getElementById('statValueNet'),
            statValueGross: document.getElementById('statValueGross'),
            statPricePerM3: document.getElementById('statPricePerM3'),
            statDeliveryCost: document.getElementById('statDeliveryCost'),
            statPaidAmountNet: document.getElementById('statPaidAmountNet'),
            statBalanceDue: document.getElementById('statBalanceDue'),
            statProductionVolume: document.getElementById('statProductionVolume'),
            statProductionValueNet: document.getElementById('statProductionValueNet'),
            statReadyPickupVolume: document.getElementById('statReadyPickupVolume'),

            // Tabela
            reportsTable: document.getElementById('reportsTable'),
            reportsTableBody: document.getElementById('reportsTableBody')
        };

        console.log('[ReportsManager] Elements cached');
    }

    /**
     * Ustawienie event listenerów
     */
    setupEventListeners() {
        // Zmiana zakresu dat
        if (this.elements.dateRange) {
            this.elements.dateRange.addEventListener('change', (e) => {
                this.dateRange = e.target.value;
                this.loadData();
            });
        }

        // Synchronizacja z Baselinker
        if (this.elements.syncBtn) {
            this.elements.syncBtn.addEventListener('click', () => {
                this.handleSyncClick();
            });
        }

        // Dodawanie ręcznego wiersza
        if (this.elements.addManualRowBtn) {
            this.elements.addManualRowBtn.addEventListener('click', () => {
                this.handleAddManualRow();
            });
        }

        // Eksport do Excel
        if (this.elements.exportExcelBtn) {
            this.elements.exportExcelBtn.addEventListener('click', () => {
                this.handleExportExcel();
            });
        }

        // Czyszczenie filtrów
        if (this.elements.clearFiltersBtn) {
            this.elements.clearFiltersBtn.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }

        // Delegacja eventów dla tabeli (edit, links)
        if (this.elements.reportsTable) {
            this.elements.reportsTable.addEventListener('click', (e) => {
                this.handleTableClick(e);
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });

        console.log('[ReportsManager] Event listeners setup complete');
    }

    /**
     * Ładowanie początkowych danych
     */
    async loadInitialData() {
        console.log('[ReportsManager] Loading initial data...');

        // Ustaw domyślny zakres dat
        if (this.elements.dateRange) {
            this.elements.dateRange.value = this.dateRange;
        }

        // Załaduj dane
        await this.loadData();

        // Aktualizuj statystyki z konfiguracji (jeśli dostępne)
        if (window.reportsConfig && window.reportsConfig.stats) {
            this.updateStatistics(window.reportsConfig.stats);
        }

        console.log('[ReportsManager] Initial data loaded');
    }

    /**
     * Ładowanie danych z API
     */
    async loadData() {
        if (this.isLoading) {
            console.log('[ReportsManager] Already loading, skipping...');
            return;
        }

        this.showLoading();
        this.isLoading = true;

        try {
            console.log('[ReportsManager] Loading data...', {
                dateRange: this.dateRange,
                filters: this.currentFilters
            });

            // Przygotuj parametry
            const params = new URLSearchParams({
                date_range: this.dateRange
            });

            // Dodaj filtry kolumn
            for (const [key, value] of Object.entries(this.currentFilters)) {
                if (value && value.trim()) {
                    params.append(`filter_${key}`, value.trim());
                }
            }

            // Wykonaj zapytanie
            const response = await fetch(`/reports/api/data?${params}`);
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Błąd ładowania danych');
            }

            // Aktualizuj dane
            this.currentData = result.data || [];
            this.currentStats = result.stats || {};

            // Aktualizuj interfejs
            this.updateTable();
            this.updateStatistics(this.currentStats);

            console.log('[ReportsManager] Data loaded successfully', {
                recordsCount: this.currentData.length,
                stats: this.currentStats
            });

        } catch (error) {
            console.error('[ReportsManager] Error loading data:', error);
            this.showError('Błąd ładowania danych: ' + error.message);
        } finally {
            this.hideLoading();
            this.isLoading = false;
        }
    }

    /**
     * Aktualizacja tabeli
     */
    updateTable() {
        if (!this.elements.reportsTableBody) {
            console.error('[ReportsManager] Table body element not found');
            return;
        }

        console.log('[ReportsManager] Updating table with', this.currentData.length, 'records');

        if (this.currentData.length === 0) {
            this.elements.reportsTableBody.innerHTML = `
                <tr>
                    <td colspan="41" class="text-center text-muted" style="padding: 2rem;">
                        <i class="fas fa-inbox fa-2x mb-2"></i><br>
                        Brak danych do wyświetlenia
                    </td>
                </tr>
            `;
            return;
        }

        // Grupuj dane według zamówienia dla merge cells
        const groupedData = this.groupDataByOrder(this.currentData);

        let html = '';
        for (const [orderId, orders] of Object.entries(groupedData)) {
            html += this.renderOrderRows(orders);
        }

        this.elements.reportsTableBody.innerHTML = html;

        console.log('[ReportsManager] Table updated');
    }

    /**
     * Grupowanie danych według zamówienia
     */
    groupDataByOrder(data) {
        const grouped = {};

        data.forEach(record => {
            const key = record.baselinker_order_id || `manual_${record.id}`;
            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(record);
        });

        return grouped;
    }

    /**
     * Renderowanie wierszy zamówienia z merge cells
     */
    renderOrderRows(orders) {
        let html = '';
        const orderCount = orders.length;

        orders.forEach((order, index) => {
            const isFirst = index === 0;
            const isLast = index === orderCount - 1;

            html += `
                <tr data-record-id="${order.id}" ${order.is_manual ? 'data-manual="true"' : ''}>
                    ${this.renderMergedCell(order.date_created, orderCount, isFirst, 'cell-date')}
                    <td class="cell-number">${this.formatNumber(order.total_volume, 4)}</td>
                    ${this.renderMergedCell(this.formatCurrency(order.order_amount_net), orderCount, isFirst, 'cell-currency')}
                    ${this.renderMergedCell(order.baselinker_order_id || '', orderCount, isFirst, 'cell-number')}
                    ${this.renderMergedCell(order.internal_order_number || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(order.customer_name || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(order.delivery_postcode || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(order.delivery_city || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(order.delivery_address || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(order.delivery_state || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(order.phone || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(order.caretaker || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(order.delivery_method || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(order.order_source || '', orderCount, isFirst, 'cell-text')}
                    <td class="cell-text">${order.group_type || ''}</td>
                    <td class="cell-text">${order.product_type || ''}</td>
                    <td class="cell-text">${order.finish_state || ''}</td>
                    <td class="cell-text">${order.wood_species || ''}</td>
                    <td class="cell-text">${order.technology || ''}</td>
                    <td class="cell-text">${order.wood_class || ''}</td>
                    <td class="cell-number">${this.formatNumber(order.length_cm, 2)}</td>
                    <td class="cell-number">${this.formatNumber(order.width_cm, 2)}</td>
                    <td class="cell-number">${this.formatNumber(order.thickness_cm, 2)}</td>
                    <td class="cell-number">${order.quantity || 0}</td>
                    <td class="cell-currency">${this.formatCurrency(order.price_gross)}</td>
                    <td class="cell-currency">${this.formatCurrency(order.price_net)}</td>
                    <td class="cell-currency">${this.formatCurrency(order.value_gross)}</td>
                    <td class="cell-currency">${this.formatCurrency(order.value_net)}</td>
                    <td class="cell-number">${this.formatNumber(order.volume_per_piece, 4)}</td>
                    <td class="cell-number">${this.formatNumber(order.total_volume, 4)}</td>
                    <td class="cell-currency">${this.formatCurrency(order.price_per_m3)}</td>
                    <td class="cell-date">${order.realization_date || ''}</td>
                    <td class="cell-status ${this.getStatusClass(order.current_status)}">${order.current_status || ''}</td>
                    ${this.renderMergedCell(this.formatCurrency(order.delivery_cost), orderCount, isFirst, 'cell-currency')}
                    ${this.renderMergedCell(order.payment_method || '', orderCount, isFirst, 'cell-text')}
                    ${this.renderMergedCell(this.formatCurrency(order.paid_amount_net), orderCount, isFirst, 'cell-currency')}
                    ${this.renderMergedCell(this.formatCurrency(order.balance_due), orderCount, isFirst, 'cell-currency')}
                    <td class="cell-number">${this.formatNumber(order.production_volume, 4)}</td>
                    <td class="cell-currency">${this.formatCurrency(order.production_value_net)}</td>
                    <td class="cell-number">${this.formatNumber(order.ready_pickup_volume, 4)}</td>
                    ${this.renderMergedCell(this.renderActionButtons(order), orderCount, isFirst, 'cell-actions')}
                </tr>
            `;
        });

        return html;
    }

    /**
     * Renderowanie merged cell
     */
    renderMergedCell(content, rowspan, isFirst, cssClass = '') {
        if (isFirst && rowspan > 1) {
            const mergedClass = `merged-cell merged-cell-first ${cssClass}`;
            return `<td rowspan="${rowspan}" class="${mergedClass}">${content}</td>`;
        } else if (isFirst) {
            return `<td class="${cssClass}">${content}</td>`;
        } else {
            return ''; // Komórka nie renderowana (merged)
        }
    }

    /**
     * Renderowanie przycisków akcji
     */
    renderActionButtons(order) {
        const buttons = [];

        // Przycisk Baselinker
        if (order.baselinker_order_id) {
            const baselinkerUrl = `https://panel-f.baselinker.com/orders.php#order:${order.baselinker_order_id}`;
            buttons.push(`
                <a href="${baselinkerUrl}" target="_blank" class="action-btn action-btn-baselinker">
                    <i class="fas fa-external-link-alt"></i>
                    Baselinker
                </a>
            `);
        }

        // Przycisk Wycena
        const hasQuote = this.checkIfOrderHasQuote(order.baselinker_order_id);
        if (order.baselinker_order_id) {
            if (hasQuote) {
                buttons.push(`
                    <a href="/quotes/?search=${order.baselinker_order_id}" target="_blank" class="action-btn action-btn-quote">
                        <i class="fas fa-file-invoice"></i>
                        Wycena
                    </a>
                `);
            } else {
                buttons.push(`
                    <button disabled class="action-btn action-btn-quote" title="Brak wyceny w systemie">
                        <i class="fas fa-file-invoice"></i>
                        Wycena
                    </button>
                `);
            }
        }

        // Przycisk edycji dla ręcznych wierszy
        if (order.is_manual) {
            buttons.push(`
                <button class="action-btn action-btn-edit" data-action="edit" data-record-id="${order.id}">
                    <i class="fas fa-edit"></i>
                    Edytuj
                </button>
            `);
        }

        return `
            <div class="action-buttons">
                ${buttons.join('')}
                ${order.is_manual ? '<div class="manual-row-indicator">RĘCZNY</div>' : ''}
            </div>
        `;
    }

    /**
     * Sprawdzenie czy zamówienie ma wycenę (placeholder - do implementacji)
     */
    checkIfOrderHasQuote(orderID) {
        // TODO: Implementacja sprawdzania czy zamówienie ma wycenę w systemie
        // Można to zrobić przez AJAX call do endpointu quotes lub cache'ować te dane
        return Math.random() > 0.5; // Tymczasowo losowo
    }

    /**
     * Pobieranie klasy CSS dla statusu
     */
    getStatusClass(status) {
        if (!status) return '';

        const statusMap = {
            'Nowe - nieopłacone': 'status-nowe-nieopłacone',
            'Nowe - opłacone': 'status-nowe-opłacone',
            'W produkcji - surowe': 'status-w-produkcji-surowe',
            'W produkcji - lakierowanie': 'status-w-produkcji-lakierowanie',
            'W produkcji - bejcowanie': 'status-w-produkcji-bejcowanie',
            'W produkcji - olejowanie': 'status-w-produkcji-olejowanie',
            'Produkcja zakończona': 'status-produkcja-zakończona',
            'Zamówienie spakowane': 'status-zamówienie-spakowane',
            'Wysłane - kurier': 'status-wysłane-kurier',
            'Wysłane - transport WoodPower': 'status-wysłane-transport-woodpower',
            'Dostarczona - kurier': 'status-dostarczona-kurier',
            'Dostarczona - trans. WoodPower': 'status-dostarczona-trans-woodpower',
            'Czeka na odbiór osobisty': 'status-czeka-na-odbiór-osobisty',
            'Odebrane': 'status-odebrane',
            'Zamówienie anulowane': 'status-zamówienie-anulowane'
        };

        return statusMap[status] || '';
    }

    /**
     * Aktualizacja statystyk
     */
    updateStatistics(stats) {
        if (!stats) return;

        console.log('[ReportsManager] Updating statistics:', stats);

        // Aktualizuj wszystkie statystyki
        this.updateStat('statTotalM3', stats.total_m3, 2, ' m³');
        this.updateStat('statOrderAmountNet', stats.order_amount_net, 2, ' zł');
        this.updateStat('statValueNet', stats.value_net, 2, ' zł');
        this.updateStat('statValueGross', stats.value_gross, 2, ' zł');
        this.updateStat('statPricePerM3', stats.avg_price_per_m3, 2, ' zł');
        this.updateStat('statDeliveryCost', stats.delivery_cost, 2, ' zł');
        this.updateStat('statPaidAmountNet', stats.paid_amount_net, 2, ' zł');
        this.updateStat('statBalanceDue', stats.balance_due, 2, ' zł');
        this.updateStat('statProductionVolume', stats.production_volume, 2, '');
        this.updateStat('statProductionValueNet', stats.production_value_net, 2, ' zł');
        this.updateStat('statReadyPickupVolume', stats.ready_pickup_volume, 2, '');
    }

    /**
     * Aktualizacja pojedynczej statystyki
     */
    updateStat(elementId, value, decimals = 2, suffix = '') {
        const element = this.elements[elementId];
        if (element) {
            const formattedValue = this.formatNumber(value || 0, decimals);
            element.textContent = formattedValue + suffix;
        }
    }

    /**
     * Obsługa kliknięć w tabeli
     */
    handleTableClick(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const recordId = target.dataset.recordId;

        switch (action) {
            case 'edit':
                this.handleEditManualRow(recordId);
                break;
            default:
                console.log('[ReportsManager] Unknown table action:', action);
        }
    }

    /**
     * Obsługa skrótów klawiaturowych
     */
    handleKeyboardShortcuts(e) {
        // Ctrl+R - Odśwież dane
        if (e.ctrlKey && e.key === 'r') {
            e.preventDefault();
            this.loadData();
        }

        // Ctrl+E - Eksport Excel
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            this.handleExportExcel();
        }

        // Ctrl+N - Nowy wiersz
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            this.handleAddManualRow();
        }
    }

    /**
     * Obsługa kliknięcia synchronizacji
     */
    handleSyncClick() {
        console.log('[ReportsManager] Sync button clicked');

        if (window.syncManager) {
            window.syncManager.showSyncModal();
        } else {
            console.error('[ReportsManager] SyncManager not available');
            this.showError('SyncManager nie jest dostępny');
        }
    }

    /**
     * Obsługa dodawania ręcznego wiersza
     */
    handleAddManualRow() {
        console.log('[ReportsManager] Add manual row clicked');

        if (window.tableManager) {
            window.tableManager.showManualRowModal();
        } else {
            console.error('[ReportsManager] TableManager not available');
            this.showError('TableManager nie jest dostępny');
        }
    }

    /**
     * Obsługa edycji ręcznego wiersza
     */
    handleEditManualRow(recordId) {
        console.log('[ReportsManager] Edit manual row:', recordId);

        const record = this.currentData.find(r => r.id == recordId);
        if (!record) {
            this.showError('Nie znaleziono rekordu do edycji');
            return;
        }

        if (!record.is_manual) {
            this.showError('Można edytować tylko rekordy dodane ręcznie');
            return;
        }

        if (window.tableManager) {
            window.tableManager.showManualRowModal(record);
        } else {
            console.error('[ReportsManager] TableManager not available');
            this.showError('TableManager nie jest dostępny');
        }
    }

    /**
     * Obsługa eksportu Excel
     */
    handleExportExcel() {
        console.log('[ReportsManager] Export Excel clicked');

        if (window.exportManager) {
            window.exportManager.exportToExcel();
        } else {
            console.error('[ReportsManager] ExportManager not available');
            this.showError('ExportManager nie jest dostępny');
        }
    }

    /**
     * Czyszczenie wszystkich filtrów
     */
    clearAllFilters() {
        console.log('[ReportsManager] Clearing all filters');

        this.currentFilters = {};

        if (window.tableManager) {
            window.tableManager.clearFilters();
        }

        this.loadData();
    }

    /**
     * Ustawienie filtra
     */
    setFilter(column, value) {
        console.log('[ReportsManager] Setting filter:', column, value);

        if (value && value.trim()) {
            this.currentFilters[column] = value.trim();
        } else {
            delete this.currentFilters[column];
        }

        this.loadData();
    }

    /**
     * Pokazywanie loading
     */
    showLoading(message = 'Pobieranie danych...') {
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.classList.remove('hidden');
        }
    }

    /**
     * Ukrywanie loading
     */
    hideLoading() {
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.classList.add('hidden');
        }
    }

    /**
     * Pokazywanie błędu
     */
    showError(message) {
        console.error('[ReportsManager] Error:', message);
        alert('Błąd: ' + message); // TODO: Lepszy system notyfikacji
    }

    /**
     * Formatowanie liczby
     */
    formatNumber(value, decimals = 2) {
        if (value === null || value === undefined || value === '') {
            return '0' + (decimals > 0 ? '.' + '0'.repeat(decimals) : '');
        }

        const num = parseFloat(value);
        if (isNaN(num)) {
            return '0' + (decimals > 0 ? '.' + '0'.repeat(decimals) : '');
        }

        return num.toFixed(decimals);
    }

    /**
     * Formatowanie waluty
     */
    formatCurrency(value) {
        const formatted = this.formatNumber(value, 2);
        return formatted;
    }

    /**
     * Publiczne API dla innych managerów
     */
    refreshData() {
        console.log('[ReportsManager] Manual data refresh requested');
        this.loadData();
    }

    getCurrentData() {
        return this.currentData;
    }

    getCurrentStats() {
        return this.currentStats;
    }

    getCurrentFilters() {
        return { ...this.currentFilters };
    }

    getDateRange() {
        return this.dateRange;
    }
}

// Export dla global scope
window.ReportsManager = ReportsManager;