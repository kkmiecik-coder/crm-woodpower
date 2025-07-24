// modules/reports/static/js/reports.js
/**
 * Główny manager modułu Reports
 * Odpowiedzialny za inicjalizację i koordynację wszystkich komponentów
 */

class ReportsManager {
    constructor() {
        this.currentData = [];
        this.currentStats = {};
        this.currentComparison = {};
        this.currentFilters = {};
        this.dateFrom = null;
        this.dateTo = null;
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
        this.setDefaultDates();
        this.loadInitialData();

        console.log('[ReportsManager] Initialization complete');
    }

    /**
     * Cache elementów DOM - POPRAWKA: Dodano filtry dropdown
     */
    cacheElements() {
        this.elements = {
            // Kontrolki dat - POPRAWKA: Zmieniono na filterDateFrom/To
            dateFrom: document.getElementById('filterDateFrom'),
            dateTo: document.getElementById('filterDateTo'),
            syncBtn: document.getElementById('syncBtn'),
            syncStatusesBtn: document.getElementById('syncStatusesBtn'),
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

            // Statystyki porównawcze
            compTotalM3: document.getElementById('compTotalM3'),
            compOrderAmountNet: document.getElementById('compOrderAmountNet'),
            compValueNet: document.getElementById('compValueNet'),
            compValueGross: document.getElementById('compValueGross'),
            compPricePerM3: document.getElementById('compPricePerM3'),
            compDeliveryCost: document.getElementById('compDeliveryCost'),
            compPaidAmountNet: document.getElementById('compPaidAmountNet'),
            compBalanceDue: document.getElementById('compBalanceDue'),
            compProductionVolume: document.getElementById('compProductionVolume'),
            compProductionValueNet: document.getElementById('compProductionValueNet'),
            compReadyPickupVolume: document.getElementById('compReadyPickupVolume'),

            // Tabela
            reportsTable: document.getElementById('reportsTable'),
            reportsTableBody: document.getElementById('reportsTableBody'),

            // Filtry aktywne
            activeFilters: document.getElementById('activeFilters'),
            activeFiltersList: document.getElementById('activeFiltersList')
        };

        console.log('[ReportsManager] Elements cached');
    }

    /**
     * Ustawienie event listenerów - POPRAWKA: Poprawiono obsługę dat
     */
    setupEventListeners() {
        // POPRAWKA: Zmiana dat - używamy filterDateFrom/To zamiast dateFrom/To
        if (this.elements.dateFrom) {
            this.elements.dateFrom.addEventListener('change', () => {
                this.dateFrom = this.elements.dateFrom.value;
                this.loadData();
            });
        }

        if (this.elements.dateTo) {
            this.elements.dateTo.addEventListener('change', () => {
                this.dateTo = this.elements.dateTo.value;
                this.loadData();
            });
        }

        // Synchronizacja z Baselinker
        if (this.elements.syncBtn) {
            this.elements.syncBtn.addEventListener('click', () => {
                this.handleSyncClick();
            });
        }

        // Synchronizacja statusów
        if (this.elements.syncStatusesBtn) {
            this.elements.syncStatusesBtn.addEventListener('click', () => {
                this.handleSyncStatusesClick();
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

        // NOWE: Obsługa resize z fullscreen
        window.addEventListener('resize', () => {
            this.handleFullscreenResize();
        });

        console.log('[ReportsManager] Event listeners setup complete');
    }

    /**
     * Ustawienie domyślnych dat (ostatni miesiąc)
     */
    setDefaultDates() {
        // Sprawdź czy są domyślne daty z serwera
        const serverDateFrom = window.reportsConfig?.default_date_from;
        const serverDateTo = window.reportsConfig?.default_date_to;

        if (serverDateFrom && serverDateTo) {
            this.dateFrom = serverDateFrom;
            this.dateTo = serverDateTo;
        } else {
            // Fallback - ostatni miesiąc
            const today = new Date();
            const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

            this.dateFrom = lastMonth.toISOString().split('T')[0];
            this.dateTo = today.toISOString().split('T')[0];
        }

        // POPRAWKA: Ustaw wartości w prawidłowych elementach
        if (this.elements.dateFrom) {
            this.elements.dateFrom.value = this.dateFrom;
        }
        if (this.elements.dateTo) {
            this.elements.dateTo.value = this.dateTo;
        }

        console.log('[ReportsManager] Default dates set:', this.dateFrom, 'to', this.dateTo);
    }

    /**
     * Resetowanie do domyślnych dat (publiczna metoda)
     */
    resetToDefaultDates() {
        this.setDefaultDates();
        this.loadData();
    }

    /**
     * Ładowanie początkowych danych - POPRAWKA: Ulepszona obsługa błędów
     */
    async loadInitialData() {
        console.log('[ReportsManager] Loading initial data...');

        try {
            // Najpierw wyczyść statystyki i porównania
            this.clearStatistics();
            this.clearComparisons();

            // Załaduj dane z API
            await this.loadData();

            // Tylko jeśli nie mamy danych z API, użyj window.reportsConfig
            if (this.currentData.length === 0 && window.reportsConfig) {
                if (window.reportsConfig.stats && Object.keys(window.reportsConfig.stats).length > 0) {
                    this.updateStatistics(window.reportsConfig.stats);
                }
                if (window.reportsConfig.comparison && Object.keys(window.reportsConfig.comparison).length > 0) {
                    this.updateComparisons(window.reportsConfig.comparison);
                }
            }

            console.log('[ReportsManager] Initial data loaded');
        } catch (error) {
            console.error('[ReportsManager] Error loading initial data:', error);
            // W przypadku błędu wyczyść wszystko
            this.clearStatistics();
            this.clearComparisons();
        }
    }

    /**
     * Czyszczenie statystyk
     */
    clearStatistics() {
        console.log('[ReportsManager] Clearing statistics...');

        const emptyStats = {
            total_m3: 0,
            order_amount_net: 0,
            value_net: 0,
            value_gross: 0,
            avg_price_per_m3: 0,
            delivery_cost: 0,
            paid_amount_net: 0,
            balance_due: 0,
            production_volume: 0,
            production_value_net: 0,
            ready_pickup_volume: 0
        };

        this.updateStatistics(emptyStats);
    }

    /**
     * Czyszczenie porównań
     */
    clearComparisons() {
        console.log('[ReportsManager] Clearing comparisons...');

        const elementMap = {
            'total_m3': 'compTotalM3',
            'order_amount_net': 'compOrderAmountNet',
            'value_net': 'compValueNet',
            'value_gross': 'compValueGross',
            'avg_price_per_m3': 'compPricePerM3',
            'delivery_cost': 'compDeliveryCost',
            'paid_amount_net': 'compPaidAmountNet',
            'balance_due': 'compBalanceDue',
            'production_volume': 'compProductionVolume',
            'production_value_net': 'compProductionValueNet',
            'ready_pickup_volume': 'compReadyPickupVolume'
        };

        // Wyczyść porównania - ustaw puste teksty
        Object.keys(elementMap).forEach(field => {
            const elementId = elementMap[field];
            const element = this.elements[elementId];

            if (element) {
                element.textContent = '';
                element.className = 'stat-comparison';
            }
        });
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
                dateFrom: this.dateFrom,
                dateTo: this.dateTo,
                filters: this.currentFilters
            });

            // Przygotuj parametry
            const params = new URLSearchParams();

            // Dodaj daty
            if (this.dateFrom) {
                params.append('date_from', this.dateFrom);
            }
            if (this.dateTo) {
                params.append('date_to', this.dateTo);
            }

            // Dodaj filtry kolumn (obsługa multiple values)
            for (const [key, values] of Object.entries(this.currentFilters)) {
                if (values && Array.isArray(values) && values.length > 0) {
                    values.forEach(value => {
                        if (value && value.trim()) {
                            params.append(`filter_${key}`, value.trim());
                        }
                    });
                }
            }

            // Wykonaj zapytanie
            const response = await fetch(`/reports/api/data?${params}`);

            // POPRAWKA: Sprawdź czy odpowiedź jest OK
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Błąd ładowania danych');
            }

            // Aktualizuj dane
            this.currentData = result.data || [];
            this.currentStats = result.stats || {};
            this.currentComparison = result.comparison || {};

            // Aktualizuj interfejs
            this.updateTable();
            this.updateStatistics(this.currentStats);
            this.updateComparisons(this.currentComparison);
            this.updateActiveFilters();

            console.log('[ReportsManager] Data loaded successfully', {
                recordsCount: this.currentData.length,
                stats: this.currentStats,
                comparison: this.currentComparison
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

        // Dodaj hover effect dla grupowanych zamówień
        this.setupOrderHoverEffects();

        // NOWE: Odśwież layout w fullscreen
        if (this.isInFullscreenMode()) {
            setTimeout(() => {
                this.refreshTableLayout();
            }, 100);
        }

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
        const baselinkerOrderId = orders[0].baselinker_order_id;

        // NOWA LOGIKA: Oblicz łączną objętość TTL M3 dla całego zamówienia
        const totalOrderM3 = orders.reduce((sum, order) => {
            return sum + (parseFloat(order.total_volume) || 0);
        }, 0);

        orders.forEach((order, index) => {
            const isFirst = index === 0;
            const isLast = index === orderCount - 1;

            html += `
            <tr data-record-id="${order.id}" 
                data-baselinker-id="${baselinkerOrderId || `manual_${order.id}`}"
                data-order-group="${baselinkerOrderId || `manual_${order.id}`}"
                ${order.is_manual ? 'data-manual="true"' : ''}
                ${isFirst ? 'class="order-group-start"' : ''}
                ${isLast ? 'class="order-group-end"' : ''}>
                ${this.renderMergedCell(order.date_created, orderCount, isFirst, 'cell-date')}
                ${this.renderMergedCell(this.formatNumber(totalOrderM3, 4), orderCount, isFirst, 'cell-number')}
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
                ${this.renderMergedCell(this.formatCurrencyWithSign(order.balance_due), orderCount, isFirst, 'cell-currency')}
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
            const baselinkerUrl = `https://panel.baselinker.com/orders.php#order:${order.baselinker_order_id}`;
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

        // ZMIANA: Przycisk edycji dla WSZYSTKICH rekordów
        buttons.push(`
            <button class="action-btn action-btn-edit" data-action="edit" data-record-id="${order.id}" title="${order.is_manual ? 'Edytuj ręczny rekord' : 'Edytuj rekord z Baselinker'}">
                <i class="fas fa-edit"></i>
                Edytuj
            </button>
        `);

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
            'Paczka zgłoszona do wysyłki': 'status-paczka-zgloszona-do-wysylki',
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
        this.updateStat('statTotalM3', stats.total_m3, 2, ' M³');
        this.updateStat('statOrderAmountNet', stats.order_amount_net, 2, ' PLN');
        this.updateStat('statValueNet', stats.value_net, 2, ' PLN');
        this.updateStat('statValueGross', stats.value_gross, 2, ' PLN');
        this.updateStat('statPricePerM3', stats.avg_price_per_m3, 2, ' PLN');
        this.updateStat('statDeliveryCost', stats.delivery_cost, 2, ' PLN');
        this.updateStat('statPaidAmountNet', stats.paid_amount_net, 2, ' PLN');
        this.updateStat('statBalanceDue', stats.balance_due, 2, ' PLN');
        this.updateStat('statProductionVolume', stats.production_volume, 2, '');
        this.updateStat('statProductionValueNet', stats.production_value_net, 2, ' PLN');
        this.updateStat('statReadyPickupVolume', stats.ready_pickup_volume, 2, '');
    }

    /**
     * Ustawienie hover effects dla grupowanych zamówień
     */
    setupOrderHoverEffects() {
        if (!this.elements.reportsTableBody) return;

        const rows = this.elements.reportsTableBody.querySelectorAll('tr[data-order-group]');

        rows.forEach(row => {
            const orderGroup = row.dataset.orderGroup;

            row.addEventListener('mouseenter', () => {
                // Podświetl TYLKO wiersze z tym samym order-group (to samo zamówienie)
                const relatedRows = this.elements.reportsTableBody.querySelectorAll(`tr[data-order-group="${orderGroup}"]`);
                relatedRows.forEach(relatedRow => {
                    relatedRow.classList.add('hover-group');
                });
            });

            row.addEventListener('mouseleave', () => {
                // Usuń podświetlenie TYLKO z wierszy z tym samym order-group
                const relatedRows = this.elements.reportsTableBody.querySelectorAll(`tr[data-order-group="${orderGroup}"]`);
                relatedRows.forEach(relatedRow => {
                    relatedRow.classList.remove('hover-group');
                });
            });
        });
    }

    /**
     * Aktualizacja porównań - POPRAWKA: Ulepszona obsługa
     */
    updateComparisons(comparison) {
        if (!comparison || Object.keys(comparison).length === 0) {
            console.log('[ReportsManager] No comparison data, clearing comparisons');
            this.clearComparisons();
            return;
        }

        console.log('[ReportsManager] Updating comparisons:', comparison);

        const fields = [
            'total_m3', 'order_amount_net', 'value_net', 'value_gross',
            'avg_price_per_m3', 'delivery_cost', 'paid_amount_net', 'balance_due',
            'production_volume', 'production_value_net', 'ready_pickup_volume'
        ];

        const elementMap = {
            'total_m3': 'compTotalM3',
            'order_amount_net': 'compOrderAmountNet',
            'value_net': 'compValueNet',
            'value_gross': 'compValueGross',
            'avg_price_per_m3': 'compPricePerM3',
            'delivery_cost': 'compDeliveryCost',
            'paid_amount_net': 'compPaidAmountNet',
            'balance_due': 'compBalanceDue',
            'production_volume': 'compProductionVolume',
            'production_value_net': 'compProductionValueNet',
            'ready_pickup_volume': 'compReadyPickupVolume'
        };

        fields.forEach(field => {
            const elementId = elementMap[field];
            const element = this.elements[elementId];
            const compData = comparison[field];

            if (element) {
                if (compData && compData.change_percent !== undefined) {
                    const changePercent = compData.change_percent;
                    const isPositive = compData.is_positive;

                    if (changePercent !== 0) {
                        const sign = isPositive ? '+' : '';
                        element.textContent = `${sign}${changePercent}%`;
                        element.className = `stat-comparison ${isPositive ? 'positive' : 'negative'}`;
                    } else {
                        element.textContent = '';
                        element.className = 'stat-comparison';
                    }
                } else {
                    // Brak danych porównawczych dla tego pola
                    element.textContent = '';
                    element.className = 'stat-comparison';
                }
            }
        });
    }

    /**
     * Aktualizacja pojedynczej statystyki
     */
    updateStat(elementId, value, decimals = 2, suffix = '') {
        const element = document.getElementById(elementId);
        if (!element) return;

        // Użyj nowego formatowania z separatorami tysięcy
        const formatted = this.formatStatNumber(value, decimals, suffix);
        element.textContent = formatted;
    }

    /**
     * Aktualizacja aktywnych filtrów
     */
    updateActiveFilters() {
        if (!this.elements.activeFilters || !this.elements.activeFiltersList) return;

        const activeFiltersCount = Object.keys(this.currentFilters).reduce((count, key) => {
            const values = this.currentFilters[key];
            return count + (values && Array.isArray(values) ? values.length : 0);
        }, 0);

        if (activeFiltersCount === 0) {
            this.elements.activeFilters.style.display = 'none';
            return;
        }

        // Pokaż sekcję aktywnych filtrów
        this.elements.activeFilters.style.display = 'block';

        // Wygeneruj tagi filtrów
        let tagsHtml = '';
        for (const [key, values] of Object.entries(this.currentFilters)) {
            if (values && Array.isArray(values) && values.length > 0) {
                const filterLabel = this.getFilterLabel(key);
                values.forEach(value => {
                    tagsHtml += `
                        <span class="active-filter-tag" data-filter="${key}" data-value="${value}">
                            ${filterLabel}: ${value}
                            <span class="active-filter-remove" data-filter="${key}" data-value="${value}">×</span>
                        </span>
                    `;
                });
            }
        }

        this.elements.activeFiltersList.innerHTML = tagsHtml;

        // Dodaj event listenery do usuwania filtrów
        this.elements.activeFiltersList.querySelectorAll('.active-filter-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const filter = btn.dataset.filter;
                const value = btn.dataset.value;
                this.removeFilter(filter, value);
            });
        });
    }

    /**
     * Pobieranie etykiety filtra
     */
    getFilterLabel(filterKey) {
        const labels = {
            'customer_name': 'Klient',
            'delivery_state': 'Województwo',
            'wood_species': 'Gatunek',
            'current_status': 'Status'
        };
        return labels[filterKey] || filterKey;
    }

    /**
     * Usuwanie pojedynczego filtra
     */
    removeFilter(filterKey, value) {
        if (this.currentFilters[filterKey] && Array.isArray(this.currentFilters[filterKey])) {
            const index = this.currentFilters[filterKey].indexOf(value);
            if (index > -1) {
                this.currentFilters[filterKey].splice(index, 1);
                if (this.currentFilters[filterKey].length === 0) {
                    delete this.currentFilters[filterKey];
                }
            }
        }

        // Odśwież dane i aktywne filtry
        this.loadData();

        // Powiadom TableManager o zmianie
        if (window.tableManager) {
            window.tableManager.updateFilterCheckboxes(filterKey, value, false);
        }
    }

    handleEditManualRow(recordId) {
        console.log('[ReportsManager] Edit record:', recordId, 'type:', typeof recordId);

        try {
            // POPRAWKA: Konwertuj recordId i porównuj różne typy
            const numericRecordId = typeof recordId === 'string' ? parseInt(recordId, 10) : recordId;

            const record = this.currentData.find(r => {
                return r.id === numericRecordId || r.id === recordId || String(r.id) === String(recordId);
            });

            if (!record) {
                console.error('[ReportsManager] Record not found. Available records:',
                    this.currentData.slice(0, 3).map(r => ({ id: r.id, type: typeof r.id })));
                this.showError('Nie znaleziono rekordu do edycji');
                return;
            }

            console.log(`[ReportsManager] Found record ${record.id}. Opening edit modal for ${record.is_manual ? 'manual' : 'Baselinker'} record`);

            if (window.tableManager) {
                // Przekaż obsługę do TableManager z poprawnym ID
                window.tableManager.handleEditButtonClick(record.id, {
                    preventDefault: () => { },
                    stopPropagation: () => { }
                });
            } else {
                console.error('[ReportsManager] TableManager not available');
                this.showError('TableManager nie jest dostępny');
            }
        } catch (error) {
            console.error('[ReportsManager] Error in handleEditManualRow:', error);
            this.showError('Błąd podczas otwierania edycji: ' + error.message);
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

        // NOWE: F11 - Fullscreen toggle
        if (e.key === 'F11') {
            e.preventDefault();
            this.toggleFullscreen();
        }

        // NOWE: Escape - Wyjście z fullscreen (jeśli aktywny)
        if (e.key === 'Escape' && this.isInFullscreenMode()) {
            // Pozwól FullscreenManager obsłużyć to pierwsze
            // ReportsManager nie robi nic - to tylko backup
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
     * Obsługa edycji rekordu - dla wszystkich typów
     */
    handleTableClick(e) {
        const target = e.target;

        // Przycisk edycji
        if (target.matches('.action-btn-edit') || target.closest('.action-btn-edit')) {
            const button = target.matches('.action-btn-edit') ? target : target.closest('.action-btn-edit');
            const recordId = button.getAttribute('data-record-id');

            console.log('[ReportsManager] Edit button clicked, raw recordId:', recordId, 'type:', typeof recordId);

            if (recordId) {
                // POPRAWKA: Konwertuj string na number przed przekazaniem
                const numericRecordId = parseInt(recordId, 10);
                console.log('[ReportsManager] Converted to numeric:', numericRecordId);

                if (!isNaN(numericRecordId)) {
                    this.handleEditManualRow(numericRecordId);
                } else {
                    console.error('[ReportsManager] Invalid recordId:', recordId);
                    this.showError('Nieprawidłowy ID rekordu');
                }
            }
            return;
        }

        // Przycisk usuwania ręcznego wiersza
        if (target.matches('.action-btn-delete') || target.closest('.action-btn-delete')) {
            const button = target.matches('.action-btn-delete') ? target : target.closest('.action-btn-delete');
            const recordId = parseInt(button.getAttribute('data-record-id'), 10);

            if (recordId && !isNaN(recordId)) {
                this.handleDeleteManualRow(recordId);
            }
            return;
        }

        // Links do Baselinker i wycen - pozostają bez zmian
        if (target.matches('a[href*="baselinker.com"]')) {
            // Link do Baselinker - pozwól na standardowe działanie
            return;
        }

        if (target.matches('a[href*="/quotes/"]')) {
            // Link do wycen - pozwól na standardowe działanie  
            return;
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

        this.resetToDefaultDates();
    }

    /**
     * Ustawienie filtra - POPRAWKA: Lepsze logowanie
     */
    setFilter(column, values) {
        console.log('[ReportsManager] Setting filter:', column, values);

        if (values && Array.isArray(values) && values.length > 0) {
            // Filtruj puste wartości
            const filteredValues = values.filter(v => v && v.trim());
            if (filteredValues.length > 0) {
                this.currentFilters[column] = filteredValues;
            } else {
                delete this.currentFilters[column];
            }
        } else {
            delete this.currentFilters[column];
        }

        this.loadData();
    }

    /**
     * Dodawanie wartości do filtra
     */
    addFilterValue(column, value) {
        if (!value || !value.trim()) return;

        if (!this.currentFilters[column]) {
            this.currentFilters[column] = [];
        }

        if (!this.currentFilters[column].includes(value)) {
            this.currentFilters[column].push(value);
            this.loadData();
        }
    }

    /**
     * Usuwanie wartości z filtra
     */
    removeFilterValue(column, value) {
        if (this.currentFilters[column] && Array.isArray(this.currentFilters[column])) {
            const index = this.currentFilters[column].indexOf(value);
            if (index > -1) {
                this.currentFilters[column].splice(index, 1);
                if (this.currentFilters[column].length === 0) {
                    delete this.currentFilters[column];
                }
                this.loadData();
            }
        }
    }

    /**
     * Pokazywanie loading
     */
    showLoading(message = 'Pobieranie danych...') {
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.classList.remove('hidden');

            // W trybie fullscreen - wyższy z-index
            if (this.isInFullscreenMode()) {
                this.elements.loadingOverlay.style.zIndex = '10001';
            } else {
                this.elements.loadingOverlay.style.zIndex = '9999';
            }
        }
    }

    /**
     * Ukrywanie loading
     */
    hideLoading() {
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.classList.add('hidden');
            this.elements.loadingOverlay.style.zIndex = ''; // Reset z-index
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
     * Formatowanie liczb z separatorami tysięcy
     */
    formatNumber(value, decimals = 2) {
        if (value === null || value === undefined || value === '') {
            return '0' + (decimals > 0 ? '.' + '0'.repeat(decimals) : '');
        }

        const num = parseFloat(value);
        if (isNaN(num)) {
            return '0' + (decimals > 0 ? '.' + '0'.repeat(decimals) : '');
        }

        // NOWE: Dodaj separatory tysięcy (spacje)
        const formatted = num.toFixed(decimals);
        const parts = formatted.split('.');

        // Dodaj spacje co 3 cyfry od prawej strony
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

        return parts.join('.');
    }

    /**
     * Formatowanie waluty z separatorami tysięcy
     */
    formatCurrency(value) {
        const formatted = this.formatNumber(value, 2);
        return formatted + ' PLN';
    }

    /**
     * Formatowanie waluty ze znakiem (dla sald) z separatorami tysięcy
     */
    formatCurrencyWithSign(value) {
        const num = parseFloat(value || 0);
        const formatted = this.formatNumber(Math.abs(num), 2);

        if (num > 0) {
            return `+${formatted} PLN`;
        } else if (num < 0) {
            return `-${formatted} PLN`;
        } else {
            return formatted + ' PLN';
        }
    }

    /**
     * NOWA: Formatowanie liczb dla statystyk (bez waluty)
     */
    formatStatNumber(value, decimals = 2, suffix = '') {
        const formatted = this.formatNumber(value, decimals);
        return formatted + suffix;
    }

    /**
     * POPRAWKA: Ustawienie dat programowo - lepsze logowanie
     */
    setDateRange(dateFrom, dateTo) {
        console.log('[ReportsManager] Setting date range:', dateFrom, dateTo);

        this.dateFrom = dateFrom;
        this.dateTo = dateTo;

        if (this.elements.dateFrom) {
            this.elements.dateFrom.value = dateFrom || '';
        }
        if (this.elements.dateTo) {
            this.elements.dateTo.value = dateTo || '';
        }

        this.loadData();
    }

    /**
     * Pobieranie bieżących dat dla innych managerów
     */
    getCurrentDateRange() {
        return {
            date_from: this.dateFrom,
            date_to: this.dateTo
        };
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

    getDateFrom() {
        return this.dateFrom;
    }

    getDateTo() {
        return this.dateTo;
    }

    /**
     * NOWA METODA - Sprawdzenie czy dane są ładowane
     */
    isDataLoading() {
        return this.isLoading;
    }

    /**
     * NOWA METODA - Sprawdzenie czy jesteśmy w trybie fullscreen
     */
    isInFullscreenMode() {
        if (window.fullscreenManager && typeof window.fullscreenManager.isFullscreenActive === 'function') {
            return window.fullscreenManager.isFullscreenActive();
        }
        return false;
    }

    /**
     * NOWA METODA - Przełączenie trybu fullscreen
     */
    toggleFullscreen() {
        if (window.fullscreenManager && typeof window.fullscreenManager.toggle === 'function') {
            window.fullscreenManager.toggle();
        } else {
            console.warn('[ReportsManager] FullscreenManager not available');
        }
    }

    /**
     * NOWA METODA - Wymuszenie wyjścia z fullscreen
     */
    exitFullscreen() {
        if (window.fullscreenManager && typeof window.fullscreenManager.exitFullscreen === 'function') {
            window.fullscreenManager.exitFullscreen();
        }
    }

    /**
     * NOWA METODA - Resetowanie filtrów bez resetowania dat
     */
    clearFiltersOnly() {
        console.log('[ReportsManager] Clearing filters only (keeping dates)');

        this.currentFilters = {};

        if (window.tableManager) {
            window.tableManager.clearFilters();
        }

        this.loadData();
    }

    /**
     * NOWA METODA - Sprawdzenie czy są aktywne filtry
     */
    hasActiveFilters() {
        return Object.keys(this.currentFilters).length > 0;
    }

    /**
     * NOWA METODA - Pobieranie liczby rekordów
     */
    getRecordsCount() {
        return this.currentData.length;
    }

    /**
     * NOWA METODA - Obsługa zmiany trybu fullscreen
     */
    onFullscreenChange(isFullscreen) {
        console.log('[ReportsManager] Fullscreen mode changed:', isFullscreen);

        // Odśwież layout po zmianie trybu
        setTimeout(() => {
            // Powiadom o zmianie rozmiaru okna
            window.dispatchEvent(new Event('resize'));

            // Odśwież tabele jeśli potrzeba
            if (this.elements.reportsTable) {
                this.refreshTableLayout();
            }
        }, 300);

        // Aktualizuj inne managery o zmianie
        this.notifyManagersAboutFullscreen(isFullscreen);
    }

    /**
     * NOWA METODA - Powiadomienie managerów o zmianie fullscreen
     */
    notifyManagersAboutFullscreen(isFullscreen) {
        // Powiadom TableManager
        if (window.tableManager && typeof window.tableManager.onFullscreenChange === 'function') {
            window.tableManager.onFullscreenChange(isFullscreen);
        }

        // Powiadom ExportManager
        if (window.exportManager && typeof window.exportManager.onFullscreenChange === 'function') {
            window.exportManager.onFullscreenChange(isFullscreen);
        }

        // Powiadom SyncManager
        if (window.syncManager && typeof window.syncManager.onFullscreenChange === 'function') {
            window.syncManager.onFullscreenChange(isFullscreen);
        }
    }

    /**
     * NOWA METODA - Odświeżenie layoutu tabeli
     */
    refreshTableLayout() {
        if (!this.elements.reportsTable) return;

        // POPRAWKA: Nie używamy display: none, który resetuje scroll
        if (this.isInFullscreenMode()) {
            // W fullscreen używamy delikatnego odświeżenia
            const tableWrapper = document.querySelector('.fullscreen-table-container .table-wrapper');
            if (tableWrapper) {
                // Zapisz pozycję scroll
                const scrollTop = tableWrapper.scrollTop;
                const scrollLeft = tableWrapper.scrollLeft;

                // Wymusz repaint
                tableWrapper.style.transform = 'translateZ(0)';

                requestAnimationFrame(() => {
                    tableWrapper.style.transform = '';
                    // Przywróć pozycję scroll
                    tableWrapper.scrollTop = scrollTop;
                    tableWrapper.scrollLeft = scrollLeft;
                });
            }
        } else {
            // W normalnym trybie można użyć standardowego odświeżenia
            this.elements.reportsTable.style.display = 'none';
            this.elements.reportsTable.offsetHeight; // Trigger reflow
            this.elements.reportsTable.style.display = '';
        }

        // Odśwież hover effects dla grupowanych zamówień
        this.setupOrderHoverEffects();
    }

    /**
     * NOWA METODA - Weryfikacja stanu managera
     */
    validateState() {
        const issues = [];

        if (!this.elements.reportsTableBody) {
            issues.push('Missing table body element');
        }

        if (!this.elements.dateFrom || !this.elements.dateTo) {
            issues.push('Missing date filter elements');
        }

        if (!this.dateFrom || !this.dateTo) {
            issues.push('Date range not set');
        }

        // NOWE: Sprawdź dostępność FullscreenManager
        if (!window.fullscreenManager) {
            issues.push('FullscreenManager not available');
        }

        return {
            isValid: issues.length === 0,
            issues: issues
        };
    }

    /**
     * NOWA METODA - Publiczne API dla fullscreen
     */

    // Aktywuj fullscreen
    activateFullscreen() {
        if (window.fullscreenManager && typeof window.fullscreenManager.activate === 'function') {
            window.fullscreenManager.activate();
        }
    }

    // Deaktywuj fullscreen
    deactivateFullscreen() {
        if (window.fullscreenManager && typeof window.fullscreenManager.deactivate === 'function') {
            window.fullscreenManager.deactivate();
        }
    }

    // Pobierz stan fullscreen
    getFullscreenState() {
        if (window.fullscreenManager && typeof window.fullscreenManager.getState === 'function') {
            return window.fullscreenManager.getState();
        }
        return { isFullscreen: false, isCompatible: false };
    }

    /**
     * NOWA METODA - Obsługa resize w fullscreen
     */
    handleFullscreenResize() {
        if (this.isInFullscreenMode()) {
            // POPRAWKA: Delikatne odświeżenie bez resetowania scroll
            setTimeout(() => {
                // Powiadom FullscreenManager o resize
                if (window.fullscreenManager && typeof window.fullscreenManager.handleFullscreenResize === 'function') {
                    window.fullscreenManager.handleFullscreenResize();
                }
            }, 150);
        }
    }

    /**
     * Debug info
     */
    getDebugInfo() {
        const validation = this.validateState();

        return {
            currentData: this.currentData.length,
            currentStats: this.currentStats,
            currentComparison: this.currentComparison,
            currentFilters: this.currentFilters,
            dateFrom: this.dateFrom,
            dateTo: this.dateTo,
            isLoading: this.isLoading,
            hasActiveFilters: this.hasActiveFilters(),
            isFullscreen: this.isInFullscreenMode(), // NOWE
            validation: validation,
            elements: {
                cached: Object.keys(this.elements).length,
                missing: Object.keys(this.elements).filter(key => !this.elements[key]).length
            },
            // NOWE: Informacje o fullscreen
            fullscreenManager: {
                available: !!window.fullscreenManager,
                active: this.isInFullscreenMode()
            }
        };
    }

    /**
     * Obsługa synchronizacji statusów
     */
    async handleSyncStatusesClick() {
        console.log('[ReportsManager] Sync statuses button clicked');

        if (this.isLoading) {
            this.showError('Trwa już ładowanie danych. Proszę czekać...');
            return;
        }

        // Potwierdź akcję
        if (!confirm('Czy na pewno chcesz zsynchronizować statusy zamówień z Baselinker?\n\nTo może potrwać kilka minut.')) {
            return;
        }

        this.showLoading('Synchronizowanie statusów...');

        try {
            const response = await fetch('/reports/api/sync-statuses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.success) {
                console.log('[ReportsManager] Statuses sync completed successfully:', result);

                // Pokaż komunikat sukcesu z detalami
                let message = `Synchronizacja statusów i płatności zakończona pomyślnie!\n\n`;
                message += `Przetworzono: ${result.orders_processed} zamówień\n`;
                message += `Zaktualizowano łącznie: ${result.orders_updated} rekordów\n`;

                if (result.status_updated > 0) {
                    message += `Zaktualizowano statusy: ${result.status_updated} rekordów\n`;
                }

                if (result.payment_updated > 0) {
                    message += `Zaktualizowano płatności: ${result.payment_updated} rekordów\n`;
                }

                message += `Unikalne zamówienia: ${result.unique_orders}`;

                alert(message);

                // Odśwież dane
                this.refreshData();

            } else {
                throw new Error(result.error || 'Błąd synchronizacji statusów');
            }

        } catch (error) {
            console.error('[ReportsManager] Sync statuses error:', error);
            this.showError('Błąd synchronizacji statusów: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

}

// Export dla global scope
window.ReportsManager = ReportsManager;