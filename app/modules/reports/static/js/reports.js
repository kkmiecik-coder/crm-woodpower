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
        this.quotesCache = new Map();

        // Dodaj sortowanie tabeli
        this.tableSorting = null;

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

        // NOWE: Inicjalizuj sortowanie
        this.initTableSorting();

        this.loadInitialData();

        window.reportsManager = this;

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
            statOrdersProducts: document.getElementById('statOrdersProducts'),
            statOrderAmountNet: document.getElementById('statOrderAmountNet'),
            statValueNet: document.getElementById('statValueNet'),
            statPricePerM3: document.getElementById('statPricePerM3'),
            statDeliveryCostNet: document.getElementById('statDeliveryCostNet'),
            statPaidAmountNet: document.getElementById('statPaidAmountNet'),
            statBalanceDue: document.getElementById('statBalanceDue'),
            statProductionVolume: document.getElementById('statProductionVolume'),
            statProductionValueNet: document.getElementById('statProductionValueNet'),
            statReadyPickupVolume: document.getElementById('statReadyPickupVolume'),
            statReadyPickupValueNet: document.getElementById('statReadyPickupValueNet'),
            statOlejowanieVolume: document.getElementById('statOlejowanieVolume'),
            statLakierowanieVolume: document.getElementById('statLakierowanieVolume'),

            // Statystyki porównawcze
            compTotalM3: document.getElementById('compTotalM3'),
            compOrderAmountNet: document.getElementById('compOrderAmountNet'),
            compPricePerM3: document.getElementById('compPricePerM3'),
            compDeliveryCostNet: document.getElementById('compDeliveryCostNet'),
            compPaidAmountNet: document.getElementById('compPaidAmountNet'),
            compBalanceDue: document.getElementById('compBalanceDue'),
            compProductionVolume: document.getElementById('compProductionVolume'),
            compProductionValueNet: document.getElementById('compProductionValueNet'),
            compReadyPickupVolume: document.getElementById('compReadyPickupVolume'),
            compReadyPickupValueNet: document.getElementById('compReadyPickupValueNet'),

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

        // Excel export - normalny tryb
        const exportExcelOption = document.getElementById('exportExcelOption');
        if (exportExcelOption) {
            exportExcelOption.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleExportExcel();
            });
        }

        // Excel export - fullscreen
        const fullscreenExportExcelOption = document.getElementById('fullscreenExportExcelOption');
        if (fullscreenExportExcelOption) {
            fullscreenExportExcelOption.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleExportExcel();
            });
        }

        // Routimo export - normalny tryb
        const exportRoutimoOption = document.getElementById('exportRoutimoOption');
        if (exportRoutimoOption) {
            exportRoutimoOption.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleExportRoutimo();
            });
        }

        // Routimo export - fullscreen
        const fullscreenExportRoutimoOption = document.getElementById('fullscreenExportRoutimoOption');
        if (fullscreenExportRoutimoOption) {
            fullscreenExportRoutimoOption.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleExportRoutimo();
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

    // NOWA METODA: Inicjalizacja sortowania
    initTableSorting() {
        if (typeof TableSorting !== 'undefined') {
            this.tableSorting = new TableSorting();
            this.tableSorting.init();
            console.log('[ReportsManager] Sortowanie tabeli zainicjowane');
        } else {
            console.warn('[ReportsManager] TableSorting nie jest dostępny');
        }
    }

    /**
     * Ustawienie domyślnych dat (początek bieżącego miesiąca)
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
            avg_price_per_m3: 0,
            delivery_cost_net: 0,
            paid_amount_net: 0,
            balance_due: 0,
            production_volume: 0,
            production_value_net: 0,
            ready_pickup_volume: 0,
            ready_pickup_value_net: 0
        };

        this.updateStatistics(emptyStats);
        this.updateStat('statOlejowanieVolume', 0, 4, ' m³');
        this.updateStat('statLakierowanieVolume', 0, 4, ' m³');
    }

    /**
     * Czyszczenie porównań
     */
    clearComparisons() {
        console.log('[ReportsManager] Clearing comparisons...');

        const elementMap = {
            'total_m3': 'compTotalM3',
            'unique_orders': 'compOrdersProducts',
            'order_amount_net': 'compOrderAmountNet',
            'avg_price_per_m3': 'compPricePerM3',
            'delivery_cost_net': 'compDeliveryCostNet',
            'paid_amount_net': 'compPaidAmountNet',
            'balance_due': 'compBalanceDue',
            'production_volume': 'compProductionVolume',
            'production_value_net': 'compProductionValueNet',
            'ready_pickup_volume': 'compReadyPickupVolume',
            'ready_pickup_value_net': 'compReadyPickupValueNet'
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

        const surfaceElements = ['compOlejowanieSurface', 'compLakierowanieSurface'];
        surfaceElements.forEach(elementId => {
            const element = document.getElementById(elementId);
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

            // DODAJ TĘ LINIĘ: Resetuj sortowanie przy nowych danych
            if (this.tableSorting) {
                this.tableSorting.resetSort();
            }

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

    // NOWA METODA: Reset sortowania (publiczna)
    resetTableSort() {
        if (this.tableSorting) {
            this.tableSorting.resetSort();
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

        // DEBUG: Sprawdź dane przed grupowaniem
        const manualRecords = this.currentData.filter(r => r.is_manual);
        this.currentData.slice(0, 10).forEach((record, i) => {
        });

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

        // Grupuj dane - NOWA STRUKTURA
        const { grouped, ordersOrder } = this.groupDataByOrder(this.currentData);
        ordersOrder.slice(0, 10).forEach((key, i) => {
            const orders = grouped.get(key);
            const firstOrder = orders[0];
        });

        // POPRAWKA: Iteruj przez ordersOrder zamiast Object.entries
        let html = '';
        ordersOrder.forEach(key => {
            const orders = grouped.get(key);
            html += this.renderOrderRows(orders);
        });

        this.elements.reportsTableBody.innerHTML = html;

        // Dodaj hover effect dla grupowanych zamówień
        this.setupOrderHoverEffects();

        // NOWE: Odśwież layout w fullscreen
        if (this.isInFullscreenMode()) {
            setTimeout(() => {
                this.refreshTableLayout();
            }, 100);
        }

        // DODANE: Asynchronicznie sprawdź wyceny dla zamówień
        setTimeout(() => {
            if (this.checkQuotesForRenderedOrders) {
                this.checkQuotesForRenderedOrders();
            }
        }, 100);

        console.log('[ReportsManager] Table updated with corrected grouping order');
    }

    /**
     * Grupowanie danych według zamówienia
     */
    groupDataByOrder(data) {
        const grouped = new Map();
        const ordersOrder = [];

        data.forEach(record => {
            // POPRAWKA: Używaj ZAWSZE prefiksów tekstowych, żeby uniknąć sortowania numerycznego
            const key = record.baselinker_order_id
                ? `bl_${record.baselinker_order_id}`
                : `manual_${record.id}`;

            if (!grouped.has(key)) {
                grouped.set(key, []);
                ordersOrder.push(key); // Zapisz kolejność pierwszego wystąpienia
            }

            grouped.get(key).push(record);
        });

        // WAŻNE: Użyj Map.entries() zamiast konwersji na object
        return { grouped, ordersOrder };
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
            ${this.renderMergedCell(order.delivery_address || '', orderCount, isFirst, 'cell-text')}
            ${this.renderMergedCell(order.delivery_city || '', orderCount, isFirst, 'cell-text')}
            ${this.renderMergedCell(order.delivery_postcode || '', orderCount, isFirst, 'cell-text')}
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
            ${this.renderMergedCell(this.formatCurrency(order.avg_order_price_per_m3), orderCount, isFirst, 'cell-currency')}
            <td class="cell-date">${order.realization_date || ''}</td>
            <td class="cell-status ${this.getStatusClass(order.current_status)}">${order.current_status || ''}</td>
            ${this.renderMergedCell(this.formatCurrency(order.delivery_cost), orderCount, isFirst, 'cell-currency')}
            ${this.renderMergedCell(this.formatCurrency(order.delivery_cost / 1.23), orderCount, isFirst, 'cell-currency')}
            ${this.renderMergedCell(order.payment_method || '', orderCount, isFirst, 'cell-text')}
            ${this.renderMergedCell(this.formatCurrency(order.paid_amount_net), orderCount, isFirst, 'cell-currency')}
            ${this.renderMergedCell(this.formatCurrencyWithSign(order.balance_due), orderCount, isFirst, 'cell-currency')}
            <td class="cell-number">${this.formatNumber(order.production_volume, 4)}</td>
            <td class="cell-currency">${this.formatCurrency(order.production_value_net)}</td>
            <td class="cell-number">${this.formatNumber(order.ready_pickup_volume, 4)}</td>
            <td class="cell-currency">${this.formatCurrency(order.ready_pickup_value_net)}</td>
            <td class="cell-number">${order.current_status && order.current_status.toLowerCase() === 'czeka na odbiór osobisty' ? this.formatNumber(order.total_volume, 4) : '0.00'}</td>
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

        // ===== PRZYCISK BASELINKER - NOWA LOGIKA =====

        // Sprawdź czy ma numer zamówienia Baselinker (z API lub wpisany ręcznie)
        const hasBaselinkerNumber = isValidBaselinkerOrderNumber(order.baselinker_order_id);

        if (hasBaselinkerNumber) {
            const baselinkerUrl = `https://panel.baselinker.com/orders.php#order:${order.baselinker_order_id}`;

            // Określ źródło numeru dla celów debugowania
            const source = order.is_manual ? 'ręczny wpis' : 'z Baselinker API';

            buttons.push(`
            <a href="${baselinkerUrl}" 
               target="_blank" 
               class="action-btn action-btn-baselinker"
               title="Otwórz zamówienie #${order.baselinker_order_id} w Baselinker (${source})">
                <i class="fas fa-external-link-alt"></i>
                Baselinker
            </a>
        `);

            // Debug log dla zamówień ręcznych z numerem Baselinker
            if (order.is_manual) {
                console.log(`[renderActionButtons] Dodano przycisk Baselinker dla ręcznego zamówienia:`, {
                    recordId: order.id,
                    baselinkerOrderId: order.baselinker_order_id,
                    customerName: order.customer_name
                });
            }
        }

        // ===== PRZYCISK WYCENA - POZOSTAJE BEZ ZMIAN =====

        if (order.baselinker_order_id) {
            // Sprawdź cache czy mamy info o wycenie
            const cachedQuote = this.quotesCache.get(order.baselinker_order_id);

            if (cachedQuote?.hasQuote) {
                // Wycena istnieje - aktywny przycisk z przekierowaniem do modala
                buttons.push(`
                <button class="action-btn action-btn-quote" 
                        onclick="window.reportsManager.redirectToQuoteByOrderId('${order.baselinker_order_id}')"
                        title="Przejdź do wyceny ${cachedQuote.quoteNumber || ''}">
                    <i class="fas fa-file-invoice"></i>
                    Wycena
                </button>
            `);
            } else if (cachedQuote?.hasQuote === false) {
                // Sprawdzono i nie ma wyceny
                buttons.push(`
                <button disabled class="action-btn action-btn-quote" title="Brak wyceny w systemie">
                    <i class="fas fa-file-invoice"></i>
                    Wycena
                </button>
            `);
            } else {
                // Nie sprawdzano jeszcze - przycisk w stanie loading
                buttons.push(`
                <button class="action-btn action-btn-quote action-btn-checking" 
                        data-order-id="${order.baselinker_order_id}"
                        title="Sprawdzanie dostępności wyceny...">
                    <i class="fas fa-spinner fa-spin"></i>
                    Sprawdzam...
                </button>
            `);
            }
        }

        // ===== PRZYCISK EDYCJI - POZOSTAJE BEZ ZMIAN =====

        buttons.push(`
        <button class="action-btn action-btn-edit" data-action="edit" data-record-id="${order.id}" 
                title="${order.is_manual ? 'Edytuj ręczny rekord' : 'Edytuj rekord z Baselinker'}">
            <i class="fas fa-edit"></i>
            Edytuj
        </button>
    `);

        // ===== PRZYCISK USUWANIA - TYLKO DLA RĘCZNYCH =====

        if (order.is_manual) {
            buttons.push(`
            <button class="action-btn action-btn-delete" data-action="delete" data-record-id="${order.id}" 
                    title="Usuń ręczny rekord">
                <i class="fas fa-trash"></i>
                Usuń
            </button>
        `);
        }

        return `
        <div class="action-buttons">
            ${buttons.join('')}
        </div>
    `;
    }

    /**
    * Obsługa usuwania rekordu z potwierdzeniem
    */
    handleDeleteManualRow(recordId) {
        console.log('[ReportsManager] Delete record:', recordId, 'type:', typeof recordId);

        try {
            // Konwertuj recordId na liczbę jeśli to string
            const numericRecordId = typeof recordId === 'string' ?
                parseInt(recordId, 10) : recordId;

            if (isNaN(numericRecordId)) {
                console.error('[ReportsManager] Invalid recordId:', recordId);
                this.showError('Nieprawidłowy ID rekordu');
                return;
            }

            // Znajdź rekord w aktualnych danych
            const record = this.currentData.find(r => {
                return r.id === numericRecordId || r.id === recordId ||
                    String(r.id) === String(recordId);
            });

            if (!record) {
                console.error('[ReportsManager] Record not found:', numericRecordId);
                this.showError('Nie znaleziono rekordu do usunięcia');
                return;
            }

            // Sprawdź czy to zamówienie z Baselinker ma wiele produktów
            let relatedRecords = [];
            if (record.baselinker_order_id) {
                relatedRecords = this.currentData.filter(r =>
                    r.baselinker_order_id === record.baselinker_order_id
                );
            }

            // Przygotuj komunikat potwierdzenia
            let confirmMessage;
            if (relatedRecords.length > 1) {
                confirmMessage = `Czy na pewno chcesz usunąć całe zamówienie "${record.customer_name}" z ${relatedRecords.length} produktami?\n\nTa operacja jest nieodwracalna i zostanie usunięte na zawsze.`;
            } else {
                confirmMessage = `Czy na pewno chcesz usunąć rekord dla klienta "${record.customer_name}"?\n\nTa operacja jest nieodwracalna i rekord zostanie usunięty na zawsze.`;
            }

            // Pokaż dialog potwierdzenia
            this.showDeleteConfirmation(confirmMessage, () => {
                // Wywołaj usuwanie po potwierdzeniu
                this.executeDelete(numericRecordId, relatedRecords);
            });

        } catch (error) {
            console.error('[ReportsManager] Error in handleDeleteManualRow:', error);
            this.showError('Błąd podczas przygotowania usuwania: ' + error.message);
        }
    }

    /**
     * Pokazanie modala potwierdzenia usunięcia
     */
    showDeleteConfirmation(message, onConfirm) {
        // Utwórz modal potwierdzenia jeśli nie istnieje
        let modal = document.getElementById('deleteConfirmationModal');

        if (!modal) {
            modal = this.createDeleteConfirmationModal();
        }

        // Ustaw komunikat
        const messageElement = modal.querySelector('.delete-confirmation-message');
        if (messageElement) {
            messageElement.textContent = message;
        }

        // Ustaw event listenery
        const confirmBtn = modal.querySelector('.delete-confirm-btn');
        const cancelBtn = modal.querySelector('.delete-cancel-btn');
        const closeBtn = modal.querySelector('.delete-modal-close');

        // Usuń stare event listenery (jeśli istnieją)
        const newConfirmBtn = confirmBtn.cloneNode(true);
        const newCancelBtn = cancelBtn.cloneNode(true);
        const newCloseBtn = closeBtn.cloneNode(true);

        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

        // Dodaj nowe event listenery
        newConfirmBtn.addEventListener('click', () => {
            this.hideDeleteConfirmation();
            onConfirm();
        });

        newCancelBtn.addEventListener('click', () => {
            this.hideDeleteConfirmation();
        });

        newCloseBtn.addEventListener('click', () => {
            this.hideDeleteConfirmation();
        });

        // Pokaż modal
        modal.style.display = 'block';
        modal.classList.add('show');

        // Zablokuj scroll na body
        document.body.style.overflow = 'hidden';

        // Focus na przycisk anuluj (bezpieczniejszy domyślny wybór)
        setTimeout(() => {
            newCancelBtn.focus();
        }, 100);
    }

    /**
     * Ukrycie modala potwierdzenia
     */
    hideDeleteConfirmation() {
        const modal = document.getElementById('deleteConfirmationModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('show');
        }

        // Przywróć scroll
        document.body.style.overflow = '';
    }

    /**
     * Utworzenie modala potwierdzenia usunięcia
     */
    createDeleteConfirmationModal() {
        const modal = document.createElement('div');
        modal.id = 'deleteConfirmationModal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('role', 'dialog');

        modal.innerHTML = `
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Potwierdzenie usunięcia
                    </h5>
                    <button type="button" class="close delete-modal-close" aria-label="Zamknij">
                        <span aria-hidden="true" class="text-white">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="text-center">
                        <i class="fas fa-trash-alt fa-3x text-danger mb-3"></i>
                        <p class="delete-confirmation-message fw-bold fs-5"></p>
                        <div class="alert alert-warning mt-3">
                            <i class="fas fa-info-circle me-2"></i>
                            <strong>Uwaga:</strong> Ta operacja jest nieodwracalna!
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary delete-cancel-btn">
                        <i class="fas fa-times me-2"></i>Anuluj
                    </button>
                    <button type="button" class="btn btn-danger delete-confirm-btn">
                        <i class="fas fa-trash me-2"></i>Usuń na zawsze
                    </button>
                </div>
            </div>
        </div>
    `;

        document.body.appendChild(modal);
        return modal;
    }

    /**
     * Wykonanie usuwania rekordu
     */
    async executeDelete(recordId, relatedRecords = []) {
        console.log('[ReportsManager] Executing delete for record:', recordId);

        try {
            // Pokaż loading
            this.setDeleteLoadingState(true);

            // Wyślij zapytanie do API
            const response = await fetch('/reports/api/delete-manual-row', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    record_id: recordId,
                    delete_all_products: relatedRecords.length > 1
                })
            });

            console.log('[ReportsManager] Delete response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[ReportsManager] Delete response data:', result);

            if (result.success) {
                console.log('[ReportsManager] Delete successful');

                // Odśwież dane
                this.refreshData();

                // Pokaż komunikat sukcesu
                const deletedCount = result.deleted_count || 1;
                const successMessage = deletedCount > 1 ?
                    `Usunięto zamówienie z ${deletedCount} produktami` :
                    'Rekord został usunięty';

                this.showMessage(successMessage, 'success');

            } else {
                throw new Error(result.error || 'Błąd usuwania rekordu');
            }

        } catch (error) {
            console.error('[ReportsManager] Delete error:', error);
            this.showError('Błąd usuwania: ' + error.message);
        } finally {
            this.setDeleteLoadingState(false);
        }
    }

    /**
     * Ustawienie stanu loading dla operacji usuwania
     */
    setDeleteLoadingState(loading) {
        const modal = document.getElementById('deleteConfirmationModal');
        if (!modal) return;

        const confirmBtn = modal.querySelector('.delete-confirm-btn');
        const cancelBtn = modal.querySelector('.delete-cancel-btn');

        if (confirmBtn) {
            confirmBtn.disabled = loading;
            confirmBtn.innerHTML = loading ?
                '<i class="fas fa-spinner fa-spin me-2"></i>Usuwanie...' :
                '<i class="fas fa-trash me-2"></i>Usuń na zawsze';
        }

        if (cancelBtn) {
            cancelBtn.disabled = loading;
        }
    }

    /**
     * Pokazywanie komunikatów użytkownikowi
     */
    showMessage(message, type = 'info') {
        console.log(`[ReportsManager] ${type.toUpperCase()}:`, message);

        // Utwórz lub znajdź kontener na komunikaty
        let messageContainer = document.getElementById('reports-message-container');

        if (!messageContainer) {
            messageContainer = this.createMessageContainer();
        }

        // Utwórz element komunikatu
        const messageElement = document.createElement('div');
        messageElement.className = `alert alert-${this.getBootstrapClass(type)} alert-dismissible fade show message-item`;
        messageElement.setAttribute('role', 'alert');

        messageElement.innerHTML = `
        <i class="fas ${this.getMessageIcon(type)} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Zamknij"></button>
    `;

        // Dodaj komunikat do kontenera
        messageContainer.appendChild(messageElement);

        // Automatycznie usuń komunikat po 5 sekundach (tylko success i info)
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.classList.remove('show');
                    setTimeout(() => {
                        if (messageElement.parentNode) {
                            messageElement.remove();
                        }
                    }, 150); // Czas na animację fade
                }
            }, 5000);
        }

        // Przewiń do komunikatu
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Pokazywanie komunikatu błędu (alias dla showMessage)
     */
    showError(message) {
        this.showMessage(message, 'error');
    }

    /**
     * Tworzenie kontenera na komunikaty
     */
    createMessageContainer() {
        const container = document.createElement('div');
        container.id = 'reports-message-container';
        container.className = 'message-container position-fixed';
        container.style.cssText = `
        top: 80px;
        right: 20px;
        z-index: 1055;
        max-width: 400px;
    `;

        document.body.appendChild(container);
        return container;
    }

    /**
     * Mapowanie typów komunikatów na klasy Bootstrap
     */
    getBootstrapClass(type) {
        const classMap = {
            'success': 'success',
            'error': 'danger',
            'warning': 'warning',
            'info': 'info'
        };
        return classMap[type] || 'info';
    }

    /**
     * Mapowanie typów komunikatów na ikony Font Awesome
     */
    getMessageIcon(type) {
        const iconMap = {
            'success': 'fa-check-circle',
            'error': 'fa-exclamation-circle',
            'warning': 'fa-exclamation-triangle',
            'info': 'fa-info-circle'
        };
        return iconMap[type] || 'fa-info-circle';
    }

    /**
     * Asynchroniczne sprawdzenie wycen dla zamówień po renderowaniu tabeli
     */
    async checkQuotesForRenderedOrders() {
        console.log('[checkQuotesForRenderedOrders] Sprawdzanie wycen dla wyrenderowanych zamówień');

        // Znajdź wszystkie przyciski w stanie "sprawdzania"
        const checkingButtons = document.querySelectorAll('.action-btn-checking');

        if (checkingButtons.length === 0) {
            console.log('[checkQuotesForRenderedOrders] Brak przycisków do sprawdzenia');
            return;
        }

        console.log(`[checkQuotesForRenderedOrders] Znaleziono ${checkingButtons.length} przycisków do sprawdzenia`);

        // Sprawdź każdy przycisk asynchronicznie
        const promises = Array.from(checkingButtons).map(async (button) => {
            const orderID = button.dataset.orderId;

            if (!orderID) {
                console.warn('[checkQuotesForRenderedOrders] Brak orderID w przycisku');
                return;
            }

            try {
                const hasQuote = await this.checkIfOrderHasQuote(orderID);
                const cachedData = this.quotesCache.get(orderID);

                // Aktualizuj przycisk na podstawie wyniku
                if (hasQuote && cachedData?.quoteId) {
                    button.outerHTML = `
                    <button class="action-btn action-btn-quote" 
                            onclick="window.reportsManager.redirectToQuoteByOrderId('${orderID}')"
                            title="Przejdź do wyceny ${cachedData.quoteNumber || ''}">
                        <i class="fas fa-file-invoice"></i>
                        Wycena
                    </button>
                `;
                } else {
                    button.outerHTML = `
                    <button disabled class="action-btn action-btn-quote" title="Brak wyceny w systemie">
                        <i class="fas fa-file-invoice"></i>
                        Wycena
                    </button>
                `;
                }

            } catch (error) {
                console.error(`[checkQuotesForRenderedOrders] Błąd dla orderID ${orderID}:`, error);

                // W przypadku błędu pokaż przycisk nieaktywny
                button.outerHTML = `
                <button disabled class="action-btn action-btn-quote" title="Błąd sprawdzania wyceny">
                    <i class="fas fa-exclamation-triangle"></i>
                    Błąd
                </button>
            `;
            }
        });

        // Poczekaj na wszystkie sprawdzenia
        await Promise.all(promises);
        console.log('[checkQuotesForRenderedOrders] Zakończono sprawdzanie wszystkich wycen');
    }

    /**
     * Sprawdzenie czy zamówienie ma wycenę w systemie
     * @param {string|number} orderID - ID zamówienia z Baselinker
     * @returns {boolean} - true jeśli zamówienie ma wycenę
     */
    async checkIfOrderHasQuote(orderID) {
        if (!orderID) {
            console.log('[checkIfOrderHasQuote] Brak orderID');
            return false;
        }

        // Sprawdź cache
        if (this.quotesCache.has(orderID)) {
            const cachedResult = this.quotesCache.get(orderID);
            console.log(`[checkIfOrderHasQuote] Cache hit dla ${orderID}:`, cachedResult);
            return cachedResult.hasQuote;
        }

        try {
            // Wywołaj endpoint API do sprawdzenia czy istnieje wycena z tym base_linker_order_id
            const response = await fetch(`/quotes/api/check-quote-by-order/${orderID}`);

            if (!response.ok) {
                console.warn(`[checkIfOrderHasQuote] API error: ${response.status}`);
                return false;
            }

            const data = await response.json();

            // Zapisz w cache wynik
            this.quotesCache.set(orderID, {
                hasQuote: data.hasQuote,
                quoteId: data.quoteId,
                quoteNumber: data.quoteNumber,
                timestamp: Date.now()
            });

            return data.hasQuote;

        } catch (error) {
            console.error(`[checkIfOrderHasQuote] Błąd podczas sprawdzania wyceny dla ${orderID}:`, error);
            return false;
        }
    }

    /**
     * Funkcja do przekierowania do modułu quotes z otwarciem modala wyceny
     * @param {string|number} orderID - ID zamówienia z Baselinker
     */
    async redirectToQuoteByOrderId(orderID) {
        console.log(`[redirectToQuoteByOrderId] Przekierowanie do wyceny dla zamówienia: ${orderID}`);

        if (!orderID) {
            console.error("[redirectToQuoteByOrderId] Brak orderID");
            return;
        }

        try {
            // Sprawdź cache najpierw
            let quoteData = this.quotesCache.get(orderID);

            if (!quoteData || !quoteData.quoteId) {
                // Jeśli nie ma w cache, wywołaj API
                const response = await fetch(`/quotes/api/check-quote-by-order/${orderID}`);

                if (!response.ok) {
                    console.error(`[redirectToQuoteByOrderId] API error: ${response.status}`);
                    alert('Nie udało się znaleźć wyceny dla tego zamówienia');
                    return;
                }

                const data = await response.json();

                if (!data.hasQuote) {
                    alert('To zamówienie nie ma powiązanej wyceny w systemie');
                    return;
                }

                quoteData = {
                    quoteId: data.quoteId,
                    quoteNumber: data.quoteNumber
                };
            }

            console.log(`[redirectToQuoteByOrderId] Przekierowanie do wyceny ID: ${quoteData.quoteId}`);

            // Zapisz ID wyceny w sessionStorage (tak samo jak w calculator)
            sessionStorage.setItem('openQuoteId', quoteData.quoteId);
            console.log(`[redirectToQuoteByOrderId] Zapisano do sessionStorage: openQuoteModal=${quoteData.quoteId}`);

            // Przekieruj do modułu quotes
            window.location.href = '/quotes/';

        } catch (error) {
            console.error(`[redirectToQuoteByOrderId] Błąd podczas przekierowania:`, error);
            alert('Wystąpił błąd podczas przekierowania do wyceny');
        }
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
     * Oblicza statystyki powierzchni według wykończenia
     */
    calculateFinishStatistics(data) {
        let olejowanieSurface = 0;
        let lakierowanieSurface = 0;

        console.log('[calculateFinishStatistics] Rozpoczynam obliczenia powierzchni dla', data.length, 'rekordów');

        // Iteruj przez wszystkie rekordy danych
        data.forEach(record => {
            if (!record.finish_state || !record.total_surface_m2) {
                return; // Pomiń rekordy bez wykończenia lub powierzchni
            }

            const finishState = String(record.finish_state).toLowerCase().trim();
            const surface = parseFloat(record.total_surface_m2) || 0;

            console.log(`[calculateFinishStatistics] Rekord ID ${record.id}: finish_state="${finishState}", surface=${surface}`);

            // Sprawdź czy to olejowanie (różne warianty)
            if (finishState.includes('olejowa') ||
                finishState.includes('olejowanie') ||
                finishState.includes('olej') ||
                finishState.includes('olejowany')) {
                olejowanieSurface += surface;
                console.log(`[calculateFinishStatistics] Dodano olejowanie: ${surface} m² (${finishState})`);
            }

            // Sprawdź czy to lakierowanie (różne warianty)
            if (finishState.includes('lakierowa') ||
                finishState.includes('lakierowanie') ||
                finishState.includes('lakier') ||
                finishState.includes('lakierowany')) {
                lakierowanieSurface += surface;
                console.log(`[calculateFinishStatistics] Dodano lakierowanie: ${surface} m² (${finishState})`);
            }
        });

        console.log(`[calculateFinishStatistics] Podsumowanie - Olejowanie: ${olejowanieSurface} m², Lakierowanie: ${lakierowanieSurface} m²`);

        return {
            olejowanie_surface: olejowanieSurface,
            lakierowanie_surface: lakierowanieSurface
        };
    }

    /**
 * Aktualizacja statystyk
 */
    updateStatistics(stats) {
        if (!stats) return;

        // Aktualizuj wszystkie standardowe statystyki
        this.updateStat('statTotalM3', stats.total_m3, 4, ' m³');  // TTL m³ klejonki
        this.updateStat('statOrderAmountNet', stats.order_amount_net, 2, ' PLN');
        this.updateStat('statValueNet', stats.value_net, 2, ' PLN');
        this.updateStat('statPricePerM3', stats.avg_price_per_m3, 2, ' PLN');
        this.updateStat('statPaidAmountNet', stats.paid_amount_net, 2, ' PLN');
        this.updateStat('statBalanceDue', stats.balance_due, 2, ' PLN');
        this.updateStat('statProductionVolume', stats.production_volume, 4, ' m³');
        this.updateStat('statProductionValueNet', stats.production_value_net, 2, ' PLN');
        this.updateStat('statReadyPickupVolume', stats.ready_pickup_volume, 4, ' m³');
        this.updateStat('statReadyPickupValueNet', stats.ready_pickup_value_net, 2, ' PLN');
        this.updateStat('statPickupReady', stats.pickup_ready_volume, 4, ' m³');

        // POPRAWKA 1: Wartość klejonek netto
        this.updateStat('statKlejonkaValueNet', stats.klejonka_value_net, 2, ' PLN');

        // POPRAWKI 3 i 4: Statystyki dla deski
        this.updateStat('statDeskaValueNet', stats.deska_value_net, 2, ' PLN');
        this.updateStat('statDeskaTotalM3', stats.deska_total_m3, 4, ' m³');

        // POPRAWKA 5: Wartość usług netto
        this.updateStat('statServicesValueNet', stats.services_value_net, 2, ' PLN');

        // NAPRAWKA: Specjalna obsługa dla statystyki "Zamówienia/Pozycje"
        if (this.elements.statOrdersProducts) {
            this.elements.statOrdersProducts.textContent = `${stats.unique_orders || 0} / ${stats.products_count || 0}`;
        }

        // NOWE - oblicz i aktualizuj statystyki wykończenia na podstawie aktualnych danych
        if (this.currentData && this.currentData.length > 0) {
            const finishStats = this.calculateFinishStatistics(this.currentData);
            this.updateStat('statOlejowanieSurface', finishStats.olejowanie_surface, 4, ' m²');
            this.updateStat('statLakierowanieSurface', finishStats.lakierowanie_surface, 4, ' m²');
        } else {
            this.updateStat('statOlejowanieSurface', 0, 4, ' m²');
            this.updateStat('statLakierowanieSurface', 0, 4, ' m²');
        }

        console.log('[ReportsManager] Statystyki zaktualizowane', stats);
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
            this.clearComparisons();
            return;
        }
        const fields = [
            'total_m3', 'order_amount_net', 'value_net',
            'avg_price_per_m3', 'paid_amount_net', 'balance_due',
            'production_volume', 'production_value_net', 'ready_pickup_volume', 'ready_pickup_value_net',
            'olejowanie_surface', 'lakierowanie_surface',
            // POPRAWKA 1: Dodano wartość klejonek netto
            'klejonka_value_net',
            // POPRAWKI 3 i 4: Dodano statystyki dla deski
            'deska_value_net', 'deska_total_m3',
            // POPRAWKA 5: Dodano wartość usług netto
            'services_value_net'
        ];
        const elementMap = {
            'total_m3': 'compTotalM3',
            'unique_orders': 'compOrdersProducts',      // NOWE: mapowanie dla zamówień/produktów
            'order_amount_net': 'compOrderAmountNet',
            'avg_price_per_m3': 'compPricePerM3',
            'paid_amount_net': 'compPaidAmountNet',
            'balance_due': 'compBalanceDue',
            'production_volume': 'compProductionVolume',
            'production_value_net': 'compProductionValueNet',
            'olejowanie_surface': 'compOlejowanieSurface',
            'lakierowanie_surface': 'compLakierowanieSurface',
            'ready_pickup_volume': 'compReadyPickupVolume',
            'ready_pickup_value_net': 'compReadyPickupValueNet',
            // POPRAWKA 1: Dodano mapowanie dla wartości klejonek netto
            'klejonka_value_net': 'compKlejonkaValueNet',
            // POPRAWKI 3 i 4: Dodano mapowania dla statystyk deski
            'deska_value_net': 'compDeskaValueNet',
            'deska_total_m3': 'compDeskaTotalM3',
            // POPRAWKA 5: Dodano mapowanie dla wartości usług netto
            'services_value_net': 'compServicesValueNet'
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
     * Obsługa eksportu Excel - ZAKTUALIZOWANE dla dropdown
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
     * NOWA METODA - Obsługa eksportu Routimo
     */
    handleExportRoutimo() {
        console.log('[ReportsManager] Export Routimo clicked');

        if (window.exportManager) {
            window.exportManager.exportToRoutimo();
        } else {
            console.error('[ReportsManager] ExportManager not available');
            this.showError('ExportManager nie jest dostępny');
        }
    }

    /**
     * NOWA METODA - Generyczna obsługa eksportu
     */
    handleExport(type) {
        console.log('[ReportsManager] Export requested:', type);

        if (!window.exportManager) {
            console.error('[ReportsManager] ExportManager not available');
            this.showError('ExportManager nie jest dostępny');
            return;
        }

        switch (type) {
            case 'excel':
                window.exportManager.exportToExcel();
                break;
            case 'routimo':
                window.exportManager.exportToRoutimo();
                break;
            default:
                console.error('[ReportsManager] Unknown export type:', type);
                this.showError(`Nieznany typ eksportu: ${type}`);
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
        this.showMessage(message, 'error'); // TODO: Lepszy system notyfikacji
    }

    /**
     * Formatowanie liczb z separatorami tysięcy
     */
    formatNumber(value, decimals = 2) {
        if (value === null || value === undefined || value === '') {
            return '0' + ',0000'.substring(0, decimals + 1);
        }

        const num = parseFloat(value);
        if (isNaN(num)) {
            return '0' + ',0000'.substring(0, decimals + 1);
        }

        // Dla pól objętości zawsze używaj 4 miejsca po przecinku
        const fixedDecimals = decimals === 4 ? 4 : decimals;

        return num.toLocaleString('pl-PL', {
            minimumFractionDigits: fixedDecimals,
            maximumFractionDigits: fixedDecimals
        });
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
     * NOWA METODA - Sprawdzenie dostępności opcji eksportu
     */
    getAvailableExportOptions() {
        if (window.exportManager && typeof window.exportManager.getExportOptions === 'function') {
            return window.exportManager.getExportOptions();
        }

        return {
            excel: { available: true, label: 'Excel' },
            routimo: { available: false, label: 'Routimo' }
        };
    }

    /**
     * NOWA METODA - Sprawdzenie czy eksport jest w toku
     */
    isExportInProgress() {
        if (window.exportManager && typeof window.exportManager.isExportInProgress === 'function') {
            return window.exportManager.isExportInProgress();
        }

        return false;
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
     * Modal potwierdzenia zastępujący confirm()
     */
    showConfirmDialog(message, title = 'Potwierdzenie') {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.5); z-index: 9999;
                display: flex; align-items: center; justify-content: center; border-radius: 8px;
            `;

            modal.innerHTML = `
                <div style="
                    background: white; border-radius: 8px; max-width: 500px; width: 90%;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                ">
                    <div style="
                        padding: 20px; border-bottom: 1px solid #dee2e6;
                        display: flex; justify-content: space-between; align-items: center;
                    ">
                        <h5 style="margin: 0; font-weight: 600;">${title}</h5>
                        <button type="button" class="modal-close" style="
                            background: none; border: none; font-size: 24px; cursor: pointer;
                            color: #666; padding: 0; width: 30px; height: 30px;
                        ">×</button>
                    </div>
                    <div style="
                        padding: 20px; font-size: 16px; line-height: 1.5; color: #555;
                        white-space: pre-line;
                    ">${message}</div>
                    <div style="
                        padding: 15px 20px; display: flex; gap: 10px; justify-content: flex-end;
                        background: #f8f9fa; border-top: 1px solid #dee2e6; border-radius: 0 0 8px 8px;
                    ">
                        <button type="button" class="confirm-cancel" style="
                            padding: 8px 20px; border-radius: 6px; font-weight: 500;
                            background: #6c757d; border: 1px solid #6c757d; color: white;
                            cursor: pointer; transition: all 0.2s ease;
                        ">Anuluj</button>
                        <button type="button" class="confirm-ok" style="
                            padding: 8px 20px; border-radius: 6px; font-weight: 500;
                            background: #007bff; border: 1px solid #007bff; color: white;
                            cursor: pointer; transition: all 0.2s ease;
                        ">OK</button>
                    </div>
                </div>
            `;

            const closeModal = (result) => {
                modal.remove();
                resolve(result);
            };

            modal.querySelector('.modal-close').addEventListener('click', () => closeModal(false));
            modal.querySelector('.confirm-cancel').addEventListener('click', () => closeModal(false));
            modal.querySelector('.confirm-ok').addEventListener('click', () => closeModal(true));

            const handleKeydown = (e) => {
                if (e.key === 'Escape') {
                    closeModal(false);
                    document.removeEventListener('keydown', handleKeydown);
                }
            };
            document.addEventListener('keydown', handleKeydown);

            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal(false);
            });

            document.body.appendChild(modal);
            setTimeout(() => modal.querySelector('.confirm-ok').focus(), 100);
        });
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

        // ZMIANA: Zastąpienie confirm() modalem
        const confirmed = await this.showConfirmDialog(
            'Czy na pewno chcesz zsynchronizować statusy zamówień z Baselinker?\n\nTo może potrwać kilka minut.',
            'Potwierdzenie synchronizacji'
        );

        if (!confirmed) {
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

                // ZMIANA: Zastąpienie alert() systemem komunikatów
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

                // Użyj istniejący system komunikatów Bootstrap zamiast alert()
                this.showMessage(message, 'success');

                // Odśwież dane
                this.refreshData();

            } else {
                // ZMIANA: Zastąpienie alert() dla błędów
                const errorMessage = result.error || 'Nieznany błąd podczas synchronizacji';
                console.error('[ReportsManager] Sync statuses failed:', errorMessage);
                this.showError(`Błąd podczas synchronizacji statusów: ${errorMessage}`);
            }

        } catch (error) {
            console.error('[ReportsManager] Sync statuses error:', error);

            // ZMIANA: Zastąpienie alert() dla błędów sieciowych
            this.showError(`Błąd sieci podczas synchronizacji: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

}

// Export dla global scope
window.ReportsManager = ReportsManager;


/**
 * Sprawdza czy wartość jest prawidłowym numerem zamówienia Baselinker
 * @param {*} value - Wartość do sprawdzenia
 * @returns {boolean} - true jeśli to prawidłowy numer
 */
function isValidBaselinkerOrderNumber(value) {
    // Sprawdź czy wartość istnieje i nie jest null/undefined
    if (!value) {
        return false;
    }

    // Konwertuj na string i usuń białe znaki
    const stringValue = String(value).trim();

    // Sprawdź czy to tylko cyfry (może być z zerem na początku)
    const isNumeric = /^\d+$/.test(stringValue);

    // Sprawdź czy nie jest pustym stringiem
    const isNotEmpty = stringValue.length > 0;

    // Sprawdź czy po konwersji na liczbę to nadal sensowna wartość
    const numericValue = parseInt(stringValue, 10);
    const isValidNumber = !isNaN(numericValue) && numericValue > 0;

    return isNumeric && isNotEmpty && isValidNumber;
}

function testBaselinkerValidation() {
    const testCases = [
        // Prawidłowe wartości
        { input: 123456, expected: true, description: "Liczba całkowita" },
        { input: "123456", expected: true, description: "String z cyframi" },
        { input: "000123", expected: true, description: "Z zerem na początku" },
        { input: "  123456  ", expected: true, description: "Z białymi znakami" },

        // Nieprawidłowe wartości
        { input: null, expected: false, description: "null" },
        { input: undefined, expected: false, description: "undefined" },
        { input: "", expected: false, description: "Pusty string" },
        { input: "   ", expected: false, description: "Same białe znaki" },
        { input: "abc", expected: false, description: "Tekst" },
        { input: "123abc", expected: false, description: "Cyfry z tekstem" },
        { input: "abc123", expected: false, description: "Tekst z cyframi" },
        { input: "12.34", expected: false, description: "Liczba dziesiętna" },
        { input: "-123", expected: false, description: "Liczba ujemna" },
        { input: "0", expected: false, description: "Zero" },
        { input: 0, expected: false, description: "Liczba zero" },
        { input: [], expected: false, description: "Pusta tablica" },
        { input: {}, expected: false, description: "Pusty obiekt" }
    ];

    console.log("🧪 TESTY WALIDACJI NUMERU BASELINKER:");
    console.log("=====================================");

    let passed = 0;
    let failed = 0;

    testCases.forEach((testCase, index) => {
        const result = isValidBaselinkerOrderNumber(testCase.input);
        const status = result === testCase.expected ? "✅ PASS" : "❌ FAIL";

        console.log(`${index + 1}. ${status} | ${testCase.description}`);
        console.log(`   Input: ${JSON.stringify(testCase.input)} → Output: ${result} (Expected: ${testCase.expected})`);

        if (result === testCase.expected) {
            passed++;
        } else {
            failed++;
            console.error(`   ❌ Test failed for: ${testCase.description}`);
        }
    });

    console.log("=====================================");
    console.log(`📊 WYNIKI: ${passed} przeszło, ${failed} nie przeszło`);

    if (failed === 0) {
        console.log("🎉 Wszystkie testy przeszły pomyślnie!");
    } else {
        console.error(`⚠️ ${failed} testów nie przeszło. Sprawdź implementację.`);
    }

    return { passed, failed, total: testCases.length };
}