/**
 * Priority Config JavaScript - ROZBUDOWANA WERSJA
 * =================================================
 * 
 * Kompletna funkcjonalność dla zarządzania priorytetami i listy produktów:
 * - ✅ Drag & Drop dla adminów (SortableJS) - ROZBUDOWANE
 * - ✅ Zaawansowane filtrowanie i wyszukiwanie - NOWE
 * - ✅ Bulk operations (masowe operacje) - NOWE
 * - ✅ Modal szczegółów produktu - NOWE
 * - ✅ System exportu - NOWE
 * - ✅ Paginacja z AJAX - NOWE
 * - ✅ Real-time aktualizacja listy - ROZBUDOWANE
 * - ✅ Responsive table handling - NOWE
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 2.0 (Faza 2 - Full Implementation)
 * Data: 2025-01-15
 */

// ============================================================================
// KONFIGURACJA I ZMIENNE GLOBALNE
// ============================================================================

const ProductsList = {
    // Konfiguracja - ZAKTUALIZOWANA
    config: {
        refreshInterval: 60000,
        filterDelay: 300,
        maxPriority: 200,
        minPriority: 0,
        defaultPerPage: 50,
        maxPerPage: 200,
        ajaxTimeout: 30000,
        autoSaveDelay: 2000
    },

    // Stan aplikacji - ZAKTUALIZOWANY
    state: {
        isLoading: false,
        originalOrder: [],
        currentFilters: {
            status: 'all',
            search: '',
            client: '',
            wood_species: '',
            technology: '',
            wood_class: '',
            date_from: '',
            date_to: '',
            priority_min: null,
            priority_max: null,
            sort_by: 'priority_score',
            sort_order: 'desc'
        },
        pagination: {
            currentPage: 1,
            perPage: 50,
            totalPages: 1,
            totalItems: 0
        },
        sortable: null,
        unsavedChanges: false,
        currentProduct: null,
        filtersData: null,
        lastRefresh: null
    },

    // API endpoints
    endpoints: {
        productsList: '/production/products',
        productsFiltered: '/production/api/products-filtered',
        updatePriority: '/production/api/update-priority',
        bulkAction: '/production/api/products/bulk-action',
        productDetails: '/production/api/products/{id}/details',
        exportProducts: '/production/api/products/export',
        filtersData: '/production/api/products/filters-data',
        dashboardStats: '/production/api/dashboard-stats'
    },

    // Cache
    cache: {
        filtersData: null,
        filtersExpiry: null,
        products: new Map()
    }
};

// ============================================================================
// INICJALIZACJA GŁÓWNA
// ============================================================================

/**
 * Inicjalizuje listę produktów - ROZBUDOWANA WERSJA
 */
function initProductsList() {
    console.log('[Products List] Inicjalizacja rozbudowanej wersji...');

    // Sprawdź dostępność danych
    if (typeof window.productsData === 'undefined') {
        console.warn('[Products List] Brak danych produktów');
        window.productsData = { products: [], isAdmin: false };
    }

    // Zapisz oryginalne dane
    ProductsList.state.originalOrder = [...(window.productsData.products || [])];

    // Inicjalizacja wszystkich systemów
    initEventListeners();
    initFilterHandlers();
    initPaginationHandlers();
    AdvancedFilters.init();
    BulkActions.init();
    ExportManager.init();

    // Załaduj filtry z URL/localStorage
    loadFiltersFromStorage();

    // Załaduj dane filtrów z API
    loadFiltersData();

    // Zastosuj filtry i odśwież
    applyAllFilters();

    // Inicjalizuj drag&drop dla adminów
    if (window.productsData.isAdmin) {
        initDragAndDrop();
    }

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Auto-refresh
    setupAutoRefresh();

    console.log('[Products List] Inicjalizacja zakończona - wszystkie systemy aktywne');
}

/**
 * Inicjalizuje drag & drop dla adminów - ROZBUDOWANA WERSJA
 */
function initDragAndDrop() {
    if (!window.productsData.isAdmin || typeof Sortable === 'undefined') {
        console.log('[Products List] Drag & drop niedostępny');
        return;
    }

    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;

    console.log('[Products List] Inicjalizacja zaawansowanego drag & drop...');

    ProductsList.state.sortable = new Sortable(tbody, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        scroll: true,
        scrollSensitivity: 100,
        scrollSpeed: 10,

        onStart: function (evt) {
            console.log('[Drag & Drop] Start:', evt.oldIndex);
            document.body.classList.add('sorting-active');
            showDragHelp();
        },

        onEnd: function (evt) {
            console.log('[Drag & Drop] End:', evt.oldIndex, '->', evt.newIndex);
            document.body.classList.remove('sorting-active');
            hideDragHelp();

            if (evt.oldIndex !== evt.newIndex) {
                handlePriorityReorder(evt.oldIndex, evt.newIndex);
            }
        },

        onMove: function (evt, originalEvent) {
            // Highlight drop zone
            const related = evt.related;
            if (related) {
                related.classList.add('drag-hover');
                setTimeout(() => related.classList.remove('drag-hover'), 200);
            }
            return true;
        }
    });

    // Add visual indicators
    addDragVisualIndicators();

    console.log('[Products List] Zaawansowany drag & drop zainicjalizowany');
}

// ============================================================================
// SYSTEM ZAAWANSOWANYCH FILTRÓW
// ============================================================================

const AdvancedFilters = {
    init() {
        console.log('[Advanced Filters] Inicjalizacja zintegrowanego systemu...');
        this.setupFilterHandlers();
        this.setupDateRangePickers();
        this.setupPrioritySliders();
        this.setupAdvancedToggle();
        this.setupBasicFilters(); // NOWE
    },

    // NOWA FUNKCJA - podstawowe filtry
    setupBasicFilters() {
        // Status filter - natychmiastowe filtrowanie
        const statusFilter = document.getElementById('status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.updateFilter('status', e.target.value);
                this.applyFilters(); // Bez opóźnienia dla select
            });
            console.log('[Advanced Filters] Podłączono status filter');
        }

        // Search input - z opóźnieniem
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', debounce((e) => {
                this.updateFilter('search', e.target.value);
                this.applyFilters();
            }, ProductsList.config.filterDelay));
            console.log('[Advanced Filters] Podłączono search input');
        }

        // Clear search button
        const clearSearchBtn = document.getElementById('clear-search-btn');
        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                this.clearSearch();
            });
            console.log('[Advanced Filters] Podłączono clear search button');
        }

        // Per page selector
        const perPageSelect = document.getElementById('per-page-select');
        if (perPageSelect) {
            perPageSelect.addEventListener('change', (e) => {
                this.updateFilter('per_page', parseInt(e.target.value));
                this.updateFilter('page', 1); // Reset do pierwszej strony
                this.applyFilters();
            });
        }

        // Header sorting - NOWE
        this.setupHeaderSorting();
    },

    // NOWA FUNKCJA - sortowanie przez nagłówki
    setupHeaderSorting() {
        const sortableHeaders = document.querySelectorAll('[data-sort]');

        sortableHeaders.forEach(header => {
            header.style.cursor = 'pointer';
            header.addEventListener('click', (e) => {
                e.preventDefault();

                const sortBy = header.dataset.sort;
                if (!sortBy) return;

                // Zmień kierunek sortowania jeśli kliknięto ten sam nagłówek
                let sortOrder = 'desc';
                if (ProductsList.state.currentFilters.sort_by === sortBy &&
                    ProductsList.state.currentFilters.sort_order === 'desc') {
                    sortOrder = 'asc';
                }

                this.updateFilter('sort_by', sortBy);
                this.updateFilter('sort_order', sortOrder);
                this.applyFilters();

                // Zaktualizuj wizualnie nagłówki
                this.updateSortingVisuals(sortBy, sortOrder);
            });
        });

        console.log(`[Advanced Filters] Podłączono sortowanie dla ${sortableHeaders.length} nagłówków`);
    },

    // NOWA FUNKCJA - wizualne wskaźniki sortowania
    updateSortingVisuals(activeSortBy, sortOrder) {
        // Usuń wszystkie istniejące wskaźniki
        document.querySelectorAll('.sort-indicator').forEach(indicator => {
            indicator.remove();
        });

        // Dodaj wskaźnik do aktywnego nagłówka
        const activeHeader = document.querySelector(`[data-sort="${activeSortBy}"]`);
        if (activeHeader) {
            const indicator = document.createElement('i');
            indicator.className = `fas fa-chevron-${sortOrder === 'desc' ? 'down' : 'up'} sort-indicator ms-1`;
            activeHeader.appendChild(indicator);
        }
    },

    // ZAKTUALIZOWANA FUNKCJA - stosowanie filtrów
    async applyFilters() {
        console.log('[Advanced Filters] Stosowanie filtrów z nowym endpointem...');

        // Zbierz wszystkie filtry
        const filters = this.collectCurrentFilters();

        // Aktualizuj stan
        ProductsList.state.currentFilters = { ...ProductsList.state.currentFilters, ...filters };

        // Reset do pierwszej strony jeśli to nie paginacja
        if (!filters.page) {
            ProductsList.state.currentFilters.page = 1;
        }

        // Zapisz filtry do localStorage
        this.saveFiltersToStorage();

        // Wywołaj nowy endpoint filtrowania
        await this.fetchFilteredProducts();
    },

    // NOWA FUNKCJA - wywołanie API filtrowania
    async fetchFilteredProducts() {
        if (ProductsList.state.isLoading) {
            console.log('[Advanced Filters] Filtrowanie już w toku...');
            return;
        }

        try {
            ProductsList.state.isLoading = true;
            this.showLoadingState();

            // Przygotuj parametry zapytania
            const queryParams = new URLSearchParams();
            Object.entries(ProductsList.state.currentFilters).forEach(([key, value]) => {
                if (value !== null && value !== '' && value !== 'all') {
                    queryParams.append(key, value);
                }
            });

            console.log(`[Advanced Filters] Wysyłanie zapytania: ${queryParams.toString()}`);

            // Wyślij zapytanie do nowego endpointu
            const response = await fetch(`${ProductsList.endpoints.productsFiltered}?${queryParams.toString()}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success) {
                // Aktualizuj UI z nowymi danymi
                this.updateProductsList(data.products);
                this.updatePagination(data.pagination);
                this.updateStats(data.stats);

                // Clear bulk selection
                if (typeof BulkActions !== 'undefined') {
                    BulkActions.clearSelection();
                }

                // Re-initialize drag&drop if admin
                if (window.productsData && window.productsData.isAdmin && ProductsList.state.sortable) {
                    ProductsList.state.sortable.destroy();
                    if (typeof initDragAndDrop === 'function') {
                        initDragAndDrop();
                    }
                }

                ProductsList.state.lastRefresh = new Date();
                console.log(`[Advanced Filters] Załadowano ${data.products.length} produktów`);

                // Toast notification
                if (typeof showToast === 'function') {
                    showToast(`Znaleziono ${data.pagination.total} produktów`, 'success', 2000);
                }
            } else {
                throw new Error(data.error || 'Błąd filtrowania produktów');
            }

        } catch (error) {
            console.error('[Advanced Filters] Błąd filtrowania:', error);
            this.showErrorState();

            if (typeof showToast === 'function') {
                showToast(`Błąd filtrowania: ${error.message}`, 'error');
            }
        } finally {
            ProductsList.state.isLoading = false;
            this.hideLoadingState();
        }
    },

    // NOWA FUNKCJA - aktualizacja listy produktów
    updateProductsList(products) {
        const tbody = document.getElementById('products-tbody');
        if (!tbody) {
            console.error('[Advanced Filters] Nie znaleziono tbody produktów');
            return;
        }

        if (products.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center py-4">
                        <div class="no-products-message">
                            <i class="fas fa-search fa-2x text-muted mb-3"></i>
                            <h6>Nie znaleziono produktów</h6>
                            <p class="text-muted mb-3">Nie znaleziono produktów spełniających kryteria filtrowania.</p>
                            <button class="btn btn-outline-primary btn-sm" onclick="AdvancedFilters.clearAllFilters()">
                                Wyczyść filtry
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        // Generuj HTML dla produktów używając istniejącej funkcji lub nowej
        let html = '';
        products.forEach((product, index) => {
            html += this.generateProductRowHtml(product, index);
        });

        tbody.innerHTML = html;

        // Przywróć interakcje
        if (typeof addRowInteractions === 'function') {
            addRowInteractions();
        }
    },

    // NOWA FUNKCJA - generowanie HTML wiersza (uproszczona wersja)
    generateProductRowHtml(product, index) {
        const isAdmin = window.productsData && window.productsData.isAdmin;
        const statusBadge = this.getStatusBadge(product.current_status);
        const priorityColor = this.getPriorityColor(product.priority_score);
        const deadlineInfo = this.getDeadlineInfo(product.days_to_deadline);

        return `
            <tr class="product-row" data-product-id="${product.id}" data-status="${product.current_status}">
                <td class="text-center">
                    <input type="checkbox" class="form-check-input bulk-select" value="${product.id}">
                </td>
                ${isAdmin ? '<td class="text-center drag-handle"><i class="fas fa-grip-vertical text-muted"></i></td>' : ''}
                <td>
                    <div class="d-flex align-items-center">
                        <div class="priority-indicator me-2" style="background-color: ${priorityColor}; width: 4px; height: 20px;"></div>
                        <span class="priority-score fw-bold">${Math.round(product.priority_score || 0)}</span>
                    </div>
                </td>
                <td>
                    <div class="product-id-main fw-bold">${product.short_product_id}</div>
                    <small class="text-muted">Zamówienie: ${product.internal_order_number}</small>
                    ${product.baselinker_order_id ? `<br><small class="text-muted">BL: ${product.baselinker_order_id}</small>` : ''}
                </td>
                <td>
                    <div class="product-name" title="${product.product_name}">
                        ${product.product_name.length > 50 ? product.product_name.substring(0, 50) + '...' : product.product_name}
                    </div>
                    ${product.client_name ? `<small class="text-muted">${product.client_name}</small>` : ''}
                </td>
                <td class="text-center">
                    ${product.volume_m3 ? product.volume_m3.toFixed(3) + ' m³' : '-'}
                </td>
                <td class="text-center">
                    ${product.total_value ? product.total_value.toFixed(2) + ' zł' : '-'}
                </td>
                <td class="text-center">${statusBadge}</td>
                <td class="text-center">${deadlineInfo}</td>
                <td class="text-center">
                    <div class="btn-group">
                        <button class="btn btn-sm btn-outline-primary" onclick="ProductModal.openModal && ProductModal.openModal(${product.id})" title="Szczegóły">
                            <i class="fas fa-eye"></i>
                        </button>
                        <a href="https://panel-f.baselinker.com/orders.php#order:${product.baselinker_order_id}" 
                           target="_blank" class="btn btn-sm btn-outline-info" title="Baselinker">
                            <i class="fas fa-external-link-alt"></i>
                        </a>
                    </div>
                </td>
            </tr>
        `;
    },

    // NOWA FUNKCJA - pomocnicze funkcje formatowania
    getStatusBadge(status) {
        const statusMap = {
            'czeka_na_wyciecie': { class: 'warning', text: 'Wycinanie' },
            'czeka_na_skladanie': { class: 'info', text: 'Składanie' },
            'czeka_na_pakowanie': { class: 'primary', text: 'Pakowanie' },
            'spakowane': { class: 'success', text: 'Spakowane' }
        };

        const statusInfo = statusMap[status] || { class: 'secondary', text: status };
        return `<span class="badge bg-${statusInfo.class}">${statusInfo.text}</span>`;
    },

    getPriorityColor(priority) {
        if (priority >= 150) return '#dc3545'; // czerwony
        if (priority >= 100) return '#fd7e14'; // pomarańczowy  
        if (priority >= 50) return '#ffc107';  // żółty
        return '#28a745'; // zielony
    },

    getDeadlineInfo(daysToDeadline) {
        if (daysToDeadline === null || daysToDeadline === undefined) return '-';

        if (daysToDeadline < 0) {
            return `<span class="text-danger fw-bold">${Math.abs(daysToDeadline)} dni po terminie</span>`;
        } else if (daysToDeadline <= 3) {
            return `<span class="text-warning fw-bold">${daysToDeadline} dni</span>`;
        } else {
            return `<span class="text-success">${daysToDeadline} dni</span>`;
        }
    },

    // NOWA FUNKCJA - aktualizacja paginacji
    updatePagination(pagination) {
        if (!pagination) return;

        // Aktualizuj stan paginacji
        ProductsList.state.pagination = {
            currentPage: pagination.page,
            perPage: pagination.per_page,
            totalPages: pagination.pages,
            totalItems: pagination.total
        };

        // Aktualizuj kontrolki paginacji jeśli istnieją
        if (typeof PaginationManager !== 'undefined' && PaginationManager.updateControls) {
            PaginationManager.updateControls(pagination);
        }

        console.log('[Advanced Filters] Paginacja zaktualizowana:', pagination);
    },

    // NOWA FUNKCJA - aktualizacja statystyk
    updateStats(stats) {
        if (!stats) return;

        // Aktualizuj elementy statystyk
        const elements = {
            'filter-total-count': stats.total_filtered,
            'filter-high-priority-count': stats.overdue_count,
            'filter-overdue-count': stats.overdue_count,
            'filter-avg-priority': Math.round(stats.avg_priority || 0)
        };

        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value || 0;
            }
        });

        // Pokaż/ukryj pasek statystyk
        const statsBar = document.getElementById('filter-stats-bar');
        if (statsBar) {
            const hasActiveFilters = Object.values(ProductsList.state.currentFilters)
                .some(value => value && value !== '' && value !== 'all');

            statsBar.style.display = hasActiveFilters ? 'block' : 'none';
        }

        console.log('[Advanced Filters] Statystyki zaktualizowane:', stats);
    },

    // POMOCNICZE FUNKCJE - stan ładowania
    showLoadingState() {
        const tbody = document.getElementById('products-tbody');
        if (tbody && tbody.children.length > 0) {
            tbody.style.opacity = '0.6';
            tbody.style.pointerEvents = 'none';
        }

        // Wyłącz filtry podczas ładowania
        document.querySelectorAll('#status-filter, #search-input').forEach(el => {
            el.disabled = true;
        });
    },

    hideLoadingState() {
        const tbody = document.getElementById('products-tbody');
        if (tbody) {
            tbody.style.opacity = '1';
            tbody.style.pointerEvents = 'auto';
        }

        // Włącz filtry po ładowaniu
        document.querySelectorAll('#status-filter, #search-input').forEach(el => {
            el.disabled = false;
        });
    },

    showErrorState() {
        const tbody = document.getElementById('products-tbody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center py-4 text-danger">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Wystąpił błąd podczas ładowania produktów. 
                        <button class="btn btn-sm btn-outline-primary ms-2" onclick="AdvancedFilters.applyFilters()">
                            Spróbuj ponownie
                        </button>
                    </td>
                </tr>
            `;
        }
    },

    // POMOCNICZE FUNKCJE - zarządzanie filtrami
    updateFilter(key, value) {
        ProductsList.state.currentFilters[key] = value;
        console.log(`[Advanced Filters] Zaktualizowano filtr: ${key} = ${value}`);
    },

    clearSearch() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
            this.updateFilter('search', '');
            this.applyFilters();
            console.log('[Advanced Filters] Wyczyszczono wyszukiwanie');
        }
    },

    collectCurrentFilters() {
        return {
            status: this.getElementValue('status-filter'),
            search: this.getElementValue('search-input'),
            page: ProductsList.state.currentFilters.page || 1,
            per_page: this.getElementValue('per-page-select', 'int') || ProductsList.config.defaultPerPage,
            sort_by: ProductsList.state.currentFilters.sort_by || 'priority_score',
            sort_order: ProductsList.state.currentFilters.sort_order || 'desc'
        };
    },

    getElementValue(elementId, type = 'string') {
        const element = document.getElementById(elementId);
        if (!element) return type === 'int' ? null : '';

        const value = element.value;
        if (type === 'int') {
            return value ? parseInt(value) : null;
        }
        return value || '';
    },

    clearAllFilters() {
        console.log('[Advanced Filters] Czyszczenie wszystkich filtrów...');

        // Reset UI elements
        const filterElements = [
            'status-filter', 'search-input', 'per-page-select'
        ];

        filterElements.forEach(elementId => {
            const element = document.getElementById(elementId);
            if (element) {
                if (element.type === 'select-one') {
                    element.selectedIndex = 0;
                } else {
                    element.value = element.id === 'per-page-select' ? '50' : '';
                }
            }
        });

        // Reset state
        ProductsList.state.currentFilters = {
            status: 'all',
            search: '',
            page: 1,
            per_page: 50,
            sort_by: 'priority_score',
            sort_order: 'desc'
        };

        // Clear localStorage
        localStorage.removeItem('productsListFilters');

        // Apply filters
        this.applyFilters();

        if (typeof showToast === 'function') {
            showToast('Filtry zostały wyczyszczone', 'info');
        }
    },

    saveFiltersToStorage() {
        try {
            localStorage.setItem('productsListFilters', JSON.stringify(ProductsList.state.currentFilters));
        } catch (error) {
            console.warn('[Advanced Filters] Nie można zapisać filtrów do localStorage:', error);
        }
    },

    // Zachowaj pozostałe funkcje z oryginalnego AdvancedFilters
    setupDateRangePickers() {
        const dateFromInput = document.getElementById('date-from');
        const dateToInput = document.getElementById('date-to');

        if (dateFromInput && dateToInput) {
            // Ustaw max date na dzisiaj
            const today = new Date().toISOString().split('T')[0];
            dateFromInput.max = today;
            dateToInput.max = today;

            // Walidacja zakresu dat
            dateFromInput.addEventListener('change', () => {
                if (dateFromInput.value && dateToInput.value) {
                    if (dateFromInput.value > dateToInput.value) {
                        dateToInput.value = dateFromInput.value;
                    }
                }
                this.applyFilters();
            });

            dateToInput.addEventListener('change', () => {
                if (dateFromInput.value && dateToInput.value) {
                    if (dateToInput.value < dateFromInput.value) {
                        dateFromInput.value = dateToInput.value;
                    }
                }
                this.applyFilters();
            });
        }
    },

    setupPrioritySliders() {
        const priorityMinSlider = document.getElementById('priority-min-slider');
        const priorityMaxSlider = document.getElementById('priority-max-slider');
        const priorityMinValue = document.getElementById('priority-min-value');
        const priorityMaxValue = document.getElementById('priority-max-value');

        if (priorityMinSlider && priorityMaxSlider) {
            priorityMinSlider.addEventListener('input', () => {
                const minVal = parseInt(priorityMinSlider.value);
                const maxVal = parseInt(priorityMaxSlider.value);

                if (minVal > maxVal) {
                    priorityMaxSlider.value = minVal;
                }

                if (priorityMinValue) priorityMinValue.textContent = minVal;
                if (priorityMaxValue) priorityMaxValue.textContent = priorityMaxSlider.value;

                this.applyFilters();
            });

            priorityMaxSlider.addEventListener('input', () => {
                const minVal = parseInt(priorityMinSlider.value);
                const maxVal = parseInt(priorityMaxSlider.value);

                if (maxVal < minVal) {
                    priorityMinSlider.value = maxVal;
                }

                if (priorityMinValue) priorityMinValue.textContent = priorityMinSlider.value;
                if (priorityMaxValue) priorityMaxValue.textContent = maxVal;

                this.applyFilters();
            });
        }
    },

    setupAdvancedToggle() {
        const toggleBtn = document.getElementById('advanced-filters-toggle');
        const advancedContainer = document.getElementById('advanced-filters-container');

        if (toggleBtn && advancedContainer) {
            toggleBtn.addEventListener('click', () => {
                const isVisible = advancedContainer.style.display !== 'none';

                if (isVisible) {
                    advancedContainer.style.display = 'none';
                    toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Pokaż zaawansowane filtry';
                } else {
                    advancedContainer.style.display = 'block';
                    toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Ukryj zaawansowane filtry';

                    // Załaduj dane jeśli jeszcze nie załadowane
                    if (!ProductsList.cache.filtersData) {
                        this.loadFilterData();
                    }
                }
            });
        }
    },

    async loadFilterData() {
        try {
            if (ProductsList.cache.filtersData &&
                ProductsList.cache.filtersExpiry &&
                Date.now() < ProductsList.cache.filtersExpiry) {
                console.log('[Advanced Filters] Używam cache danych filtrów');
                this.populateFilterDropdowns(ProductsList.cache.filtersData);
                return;
            }

            showSpinner('Ładowanie filtrów...');

            const response = await fetch(ProductsList.endpoints.filtersData, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Błąd pobierania danych filtrów');
            }

            // Cache na 5 minut
            ProductsList.cache.filtersData = data.filters_data;
            ProductsList.cache.filtersExpiry = Date.now() + (5 * 60 * 1000);

            this.populateFilterDropdowns(data.filters_data);

            console.log('[Advanced Filters] Dane filtrów załadowane:', data.filters_data);

        } catch (error) {
            console.error('[Advanced Filters] Błąd ładowania danych filtrów:', error);
            showToast('Błąd ładowania filtrów: ' + error.message, 'error');
        } finally {
            hideSpinner();
        }
    },
};

// ============================================================================
// SYSTEM BULK OPERATIONS
// ============================================================================

const BulkActions = {
    selectedIds: new Set(),
    isSelectAll: false,

    init() {
        console.log('[Bulk Actions] Inicjalizacja...');
        this.setupSelectionHandlers();
        this.setupActionHandlers();
        this.setupKeyboardShortcuts();
    },

    setupSelectionHandlers() {
        // Select all checkbox
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', this.toggleAll.bind(this));
        }

        // Individual product checkboxes - event delegation
        document.addEventListener('change', (event) => {
            if (event.target.classList.contains('product-checkbox')) {
                const productId = parseInt(event.target.value);
                if (event.target.checked) {
                    this.selectProduct(productId);
                } else {
                    this.deselectProduct(productId);
                }
            }
        });
    },

    setupActionHandlers() {
        // Bulk action buttons
        const bulkActionButtons = {
            'bulk-update-status': this.updateStatus.bind(this),
            'bulk-update-priority': this.updatePriority.bind(this),
            'bulk-export': this.exportSelected.bind(this),
            'bulk-delete': this.deleteSelected.bind(this)
        };

        Object.entries(bulkActionButtons).forEach(([buttonId, handler]) => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.addEventListener('click', handler);
            }
        });
    },

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            // Ctrl+A - select all
            if (event.ctrlKey && event.key === 'a' && this.selectedIds.size > 0) {
                event.preventDefault();
                this.toggleAll();
            }

            // Delete key - delete selected
            if (event.key === 'Delete' && this.selectedIds.size > 0 && window.productsData.isAdmin) {
                event.preventDefault();
                this.deleteSelected();
            }

            // Escape - clear selection
            if (event.key === 'Escape' && this.selectedIds.size > 0) {
                this.clearSelection();
            }
        });
    },

    selectProduct(productId) {
        this.selectedIds.add(productId);
        this.updateUI();

        // Visual feedback
        const checkbox = document.querySelector(`input[value="${productId}"]`);
        if (checkbox) {
            const row = checkbox.closest('tr');
            if (row) row.classList.add('selected');
        }
    },

    deselectProduct(productId) {
        this.selectedIds.delete(productId);
        this.updateUI();

        // Visual feedback
        const checkbox = document.querySelector(`input[value="${productId}"]`);
        if (checkbox) {
            const row = checkbox.closest('tr');
            if (row) row.classList.remove('selected');
        }
    },

    toggleAll() {
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        const productCheckboxes = document.querySelectorAll('.product-checkbox');

        if (selectAllCheckbox && selectAllCheckbox.checked) {
            // Select all visible products
            productCheckboxes.forEach(checkbox => {
                checkbox.checked = true;
                this.selectProduct(parseInt(checkbox.value));
            });
            this.isSelectAll = true;
        } else {
            // Deselect all
            productCheckboxes.forEach(checkbox => {
                checkbox.checked = false;
                this.deselectProduct(parseInt(checkbox.value));
            });
            this.clearSelection();
        }
    },

    clearSelection() {
        this.selectedIds.clear();
        this.isSelectAll = false;

        // Clear UI
        document.querySelectorAll('.product-checkbox').forEach(checkbox => {
            checkbox.checked = false;
            const row = checkbox.closest('tr');
            if (row) row.classList.remove('selected');
        });

        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;

        this.updateUI();
    },

    updateUI() {
        const count = this.selectedIds.size;
        const bulkActionsBar = document.getElementById('bulk-actions-bar');
        const bulkCount = document.getElementById('bulk-count');

        if (count > 0) {
            if (bulkActionsBar) bulkActionsBar.style.display = 'flex';
            if (bulkCount) bulkCount.textContent = count;
        } else {
            if (bulkActionsBar) bulkActionsBar.style.display = 'none';
        }

        // Update select all checkbox state
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        const visibleCheckboxes = document.querySelectorAll('.product-checkbox');

        if (selectAllCheckbox && visibleCheckboxes.length > 0) {
            const checkedCount = document.querySelectorAll('.product-checkbox:checked').length;

            if (checkedCount === 0) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
            } else if (checkedCount === visibleCheckboxes.length) {
                selectAllCheckbox.checked = true;
                selectAllCheckbox.indeterminate = false;
            } else {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = true;
            }
        }
    },

    async updateStatus() {
        if (this.selectedIds.size === 0) {
            showToast('Nie wybrano żadnych produktów', 'warning');
            return;
        }

        const newStatus = await this.promptForStatus();
        if (!newStatus) return;

        try {
            showSpinner(`Aktualizowanie statusu ${this.selectedIds.size} produktów...`);

            const response = await fetch(ProductsList.endpoints.bulkAction, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    action: 'update_status',
                    product_ids: Array.from(this.selectedIds),
                    parameters: {
                        new_status: newStatus
                    }
                })
            });

            const data = await response.json();

            if (data.success) {
                showToast(`Zaktualizowano status ${data.processed_count} produktów`, 'success');
                this.clearSelection();
                refreshProductsList();
            } else {
                throw new Error(data.error || 'Błąd aktualizacji statusu');
            }

        } catch (error) {
            console.error('[Bulk Actions] Błąd aktualizacji statusu:', error);
            showToast('Błąd aktualizacji statusu: ' + error.message, 'error');
        } finally {
            hideSpinner();
        }
    },

    async updatePriority() {
        if (this.selectedIds.size === 0) {
            showToast('Nie wybrano żadnych produktów', 'warning');
            return;
        }

        const newPriority = await this.promptForPriority();
        if (newPriority === null) return;

        try {
            showSpinner(`Aktualizowanie priorytetu ${this.selectedIds.size} produktów...`);

            const response = await fetch(ProductsList.endpoints.bulkAction, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    action: 'update_priority',
                    product_ids: Array.from(this.selectedIds),
                    parameters: {
                        new_priority: newPriority
                    }
                })
            });

            const data = await response.json();

            if (data.success) {
                showToast(`Zaktualizowano priorytet ${data.processed_count} produktów`, 'success');
                this.clearSelection();
                refreshProductsList();
            } else {
                throw new Error(data.error || 'Błąd aktualizacji priorytetu');
            }

        } catch (error) {
            console.error('[Bulk Actions] Błąd aktualizacji priorytetu:', error);
            showToast('Błąd aktualizacji priorytetu: ' + error.message, 'error');
        } finally {
            hideSpinner();
        }
    },

    async exportSelected() {
        if (this.selectedIds.size === 0) {
            showToast('Nie wybrano żadnych produktów', 'warning');
            return;
        }

        // Otwórz modal exportu z pre-selected products
        ExportManager.openExportModal(Array.from(this.selectedIds));
    },

    async deleteSelected() {
        if (!window.productsData.isAdmin) {
            showToast('Brak uprawnień do usuwania produktów', 'error');
            return;
        }

        if (this.selectedIds.size === 0) {
            showToast('Nie wybrano żadnych produktów', 'warning');
            return;
        }

        const confirmed = await this.confirmDeletion();
        if (!confirmed) return;

        try {
            showSpinner(`Usuwanie ${this.selectedIds.size} produktów...`);

            const response = await fetch(ProductsList.endpoints.bulkAction, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    action: 'delete',
                    product_ids: Array.from(this.selectedIds)
                })
            });

            const data = await response.json();

            if (data.success) {
                showToast(`Usunięto ${data.processed_count} produktów`, 'success');
                this.clearSelection();
                refreshProductsList();
            } else {
                throw new Error(data.error || 'Błąd usuwania produktów');
            }

        } catch (error) {
            console.error('[Bulk Actions] Błąd usuwania produktów:', error);
            showToast('Błąd usuwania produktów: ' + error.message, 'error');
        } finally {
            hideSpinner();
        }
    },

    async promptForStatus() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal fade';
            modal.innerHTML = `
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Zmiana statusu</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>Wybierz nowy status dla ${this.selectedIds.size} wybranych produktów:</p>
                            <select class="form-select" id="bulk-status-select">
                                <option value="">-- Wybierz status --</option>
                                <option value="czeka_na_wyciecie">Czeka na wycięcie</option>
                                <option value="czeka_na_skladanie">Czeka na składanie</option>
                                <option value="czeka_na_pakowanie">Czeka na pakowanie</option>
                                <option value="spakowane">Spakowane</option>
                                <option value="wstrzymane">Wstrzymane</option>
                            </select>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Anuluj</button>
                            <button type="button" class="btn btn-primary" id="confirm-status-btn">Zatwierdź</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();

            const confirmBtn = modal.querySelector('#confirm-status-btn');
            const statusSelect = modal.querySelector('#bulk-status-select');

            confirmBtn.addEventListener('click', () => {
                const selectedStatus = statusSelect.value;
                if (selectedStatus) {
                    bsModal.hide();
                    resolve(selectedStatus);
                } else {
                    showToast('Wybierz status', 'warning');
                }
            });

            modal.addEventListener('hidden.bs.modal', () => {
                document.body.removeChild(modal);
                resolve(null);
            });
        });
    },

    async promptForPriority() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal fade';
            modal.innerHTML = `
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Zmiana priorytetu</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>Ustaw nowy priorytet dla ${this.selectedIds.size} wybranych produktów:</p>
                            <div class="mb-3">
                                <label for="bulk-priority-input" class="form-label">Priorytet (0-200)</label>
                                <input type="number" class="form-control" id="bulk-priority-input" 
                                       min="0" max="200" value="100" step="1">
                                <div class="form-text">0 = najniższy priorytet, 200 = najwyższy priorytet</div>
                            </div>
                            <div class="priority-presets">
                                <button type="button" class="btn btn-outline-secondary btn-sm" onclick="document.getElementById('bulk-priority-input').value = 50">Niski (50)</button>
                                <button type="button" class="btn btn-outline-primary btn-sm" onclick="document.getElementById('bulk-priority-input').value = 100">Normalny (100)</button>
                                <button type="button" class="btn btn-outline-warning btn-sm" onclick="document.getElementById('bulk-priority-input').value = 150">Wysoki (150)</button>
                                <button type="button" class="btn btn-outline-danger btn-sm" onclick="document.getElementById('bulk-priority-input').value = 200">Krytyczny (200)</button>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Anuluj</button>
                            <button type="button" class="btn btn-primary" id="confirm-priority-btn">Zatwierdź</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();

            const confirmBtn = modal.querySelector('#confirm-priority-btn');
            const priorityInput = modal.querySelector('#bulk-priority-input');

            confirmBtn.addEventListener('click', () => {
                const priority = parseInt(priorityInput.value);
                if (priority >= 0 && priority <= 200) {
                    bsModal.hide();
                    resolve(priority);
                } else {
                    showToast('Priorytet musi być między 0 a 200', 'warning');
                }
            });

            modal.addEventListener('hidden.bs.modal', () => {
                document.body.removeChild(modal);
                resolve(null);
            });
        });
    },

    async confirmDeletion() {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal fade';
            modal.innerHTML = `
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header bg-danger text-white">
                            <h5 class="modal-title">Potwierdzenie usunięcia</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="alert alert-danger">
                                <i class="fas fa-exclamation-triangle"></i>
                                <strong>Uwaga!</strong> Ta operacja jest nieodwracalna.
                            </div>
                            <p>Czy na pewno chcesz usunąć <strong>${this.selectedIds.size}</strong> wybranych produktów?</p>
                            <p class="text-muted">Wszystkie dane związane z tymi produktami zostaną trwale usunięte.</p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Anuluj</button>
                            <button type="button" class="btn btn-danger" id="confirm-delete-btn">Usuń produkty</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();

            const confirmBtn = modal.querySelector('#confirm-delete-btn');

            confirmBtn.addEventListener('click', () => {
                bsModal.hide();
                resolve(true);
            });

            modal.addEventListener('hidden.bs.modal', () => {
                document.body.removeChild(modal);
                resolve(false);
            });
        });
    }
};

// ============================================================================
// SYSTEM EXPORTU
// ============================================================================

const ExportManager = {
    init() {
        console.log('[Export Manager] Inicjalizacja...');
        this.setupEventHandlers();
    },

    setupEventHandlers() {
        const exportBtn = document.getElementById('export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.openExportModal());
        }
    },

    openExportModal(preSelectedIds = null) {
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Export produktów</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <div class="col-md-6">
                                <h6>Format eksportu</h6>
                                <div class="form-check">
                                    <input class="form-check-input" type="radio" name="export-format" value="excel" id="format-excel" checked>
                                    <label class="form-check-label" for="format-excel">
                                        <i class="fas fa-file-excel text-success"></i> Excel (.xlsx)
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="radio" name="export-format" value="csv" id="format-csv">
                                    <label class="form-check-label" for="format-csv">
                                        <i class="fas fa-file-csv text-info"></i> CSV (.csv)
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="radio" name="export-format" value="pdf" id="format-pdf" disabled>
                                    <label class="form-check-label text-muted" for="format-pdf">
                                        <i class="fas fa-file-pdf text-danger"></i> PDF (wkrótce)
                                    </label>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <h6>Zakres danych</h6>
                                <div class="form-check">
                                    <input class="form-check-input" type="radio" name="export-scope" value="selected" id="scope-selected" ${preSelectedIds ? 'checked' : ''} ${preSelectedIds ? '' : 'disabled'}>
                                    <label class="form-check-label" for="scope-selected">
                                        Wybrane produkty ${preSelectedIds ? `(${preSelectedIds.length})` : '(0)'}
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="radio" name="export-scope" value="filtered" id="scope-filtered" ${!preSelectedIds ? 'checked' : ''}>
                                    <label class="form-check-label" for="scope-filtered">
                                        Aktualne filtry
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="radio" name="export-scope" value="all" id="scope-all">
                                    <label class="form-check-label" for="scope-all">
                                        Wszystkie produkty
                                    </label>
                                </div>
                            </div>
                        </div>
                        
                        <hr>
                        
                        <h6>Kolumny do eksportu</h6>
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="ID Produktu" id="col-id" checked>
                                    <label class="form-check-label" for="col-id">ID Produktu</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Zamówienie" id="col-order" checked>
                                    <label class="form-check-label" for="col-order">Zamówienie</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Nazwa Produktu" id="col-name" checked>
                                    <label class="form-check-label" for="col-name">Nazwa Produktu</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Status" id="col-status" checked>
                                    <label class="form-check-label" for="col-status">Status</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Priorytet" id="col-priority" checked>
                                    <label class="form-check-label" for="col-priority">Priorytet</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Deadline" id="col-deadline" checked>
                                    <label class="form-check-label" for="col-deadline">Deadline</label>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Gatunek" id="col-species">
                                    <label class="form-check-label" for="col-species">Gatunek drewna</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Technologia" id="col-tech">
                                    <label class="form-check-label" for="col-tech">Technologia</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Wymiary" id="col-dimensions">
                                    <label class="form-check-label" for="col-dimensions">Wymiary</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Objętość m³" id="col-volume">
                                    <label class="form-check-label" for="col-volume">Objętość m³</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Cena netto" id="col-price">
                                    <label class="form-check-label" for="col-price">Cena netto</label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input column-check" type="checkbox" value="Data utworzenia" id="col-created">
                                    <label class="form-check-label" for="col-created">Data utworzenia</label>
                                </div>
                            </div>
                        </div>
                        
                        <div class="mt-3">
                            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="ExportManager.selectAllColumns()">Wszystkie</button>
                            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="ExportManager.selectBasicColumns()">Podstawowe</button>
                            <button type="button" class="btn btn-outline-secondary btn-sm" onclick="ExportManager.clearAllColumns()">Żadne</button>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Anuluj</button>
                        <button type="button" class="btn btn-primary" id="start-export-btn">
                            <i class="fas fa-download"></i> Rozpocznij export
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();

        // Event handlers
        const startExportBtn = modal.querySelector('#start-export-btn');
        startExportBtn.addEventListener('click', () => {
            this.startExport(modal, preSelectedIds);
        });

        modal.addEventListener('hidden.bs.modal', () => {
            document.body.removeChild(modal);
        });
    },

    async startExport(modal, preSelectedIds) {
        try {
            // Zbierz parametry eksportu
            const format = modal.querySelector('input[name="export-format"]:checked').value;
            const scope = modal.querySelector('input[name="export-scope"]:checked').value;
            const selectedColumns = Array.from(modal.querySelectorAll('.column-check:checked')).map(cb => cb.value);

            if (selectedColumns.length === 0) {
                showToast('Wybierz przynajmniej jedną kolumnę', 'warning');
                return;
            }

            // Przygotuj dane do eksportu
            let exportData = {
                format: format,
                columns: selectedColumns
            };

            switch (scope) {
                case 'selected':
                    if (!preSelectedIds || preSelectedIds.length === 0) {
                        showToast('Brak wybranych produktów', 'warning');
                        return;
                    }
                    exportData.product_ids = preSelectedIds;
                    break;

                case 'filtered':
                    exportData.product_ids = 'filtered';
                    exportData.filters = ProductsList.state.currentFilters;
                    break;

                case 'all':
                    exportData.product_ids = 'all';
                    break;
            }

            // Zamknij modal
            const bsModal = bootstrap.Modal.getInstance(modal);
            bsModal.hide();

            // Rozpocznij export
            showSpinner('Generowanie eksportu...');

            const response = await fetch(ProductsList.endpoints.exportProducts, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify(exportData)
            });

            if (response.ok) {
                // Jeśli response jest plikiem, pobierz go
                const contentType = response.headers.get('Content-Type');
                if (contentType && (contentType.includes('text/csv') || contentType.includes('application/vnd.ms-excel'))) {
                    const blob = await response.blob();
                    const filename = this.getFilenameFromResponse(response) || `produkty_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xls' : 'csv'}`;
                    this.downloadBlob(blob, filename);
                    showToast('Export został pobrany', 'success');
                } else {
                    // JSON response z URL lub błędem
                    const data = await response.json();
                    if (data.success) {
                        if (data.download_url) {
                            window.open(data.download_url, '_blank');
                        }
                        showToast('Export został wygenerowany', 'success');
                    } else {
                        throw new Error(data.error || 'Błąd eksportu');
                    }
                }
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

        } catch (error) {
            console.error('[Export Manager] Błąd eksportu:', error);
            showToast('Błąd eksportu: ' + error.message, 'error');
        } finally {
            hideSpinner();
        }
    },

    getFilenameFromResponse(response) {
        const contentDisposition = response.headers.get('Content-Disposition');
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="(.+)"/);
            if (filenameMatch) {
                return filenameMatch[1];
            }
        }
        return null;
    },

    downloadBlob(blob, filename) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    },

    selectAllColumns() {
        document.querySelectorAll('.column-check').forEach(checkbox => {
            checkbox.checked = true;
        });
    },

    selectBasicColumns() {
        document.querySelectorAll('.column-check').forEach(checkbox => {
            checkbox.checked = false;
        });

        // Zaznacz podstawowe kolumny
        const basicColumns = ['col-id', 'col-order', 'col-name', 'col-status', 'col-priority', 'col-deadline'];
        basicColumns.forEach(colId => {
            const checkbox = document.getElementById(colId);
            if (checkbox) checkbox.checked = true;
        });
    },

    clearAllColumns() {
        document.querySelectorAll('.column-check').forEach(checkbox => {
            checkbox.checked = false;
        });
    }
};

// ============================================================================
// SYSTEM PAGINACJI
// ============================================================================

const PaginationManager = {
    init() {
        console.log('[Pagination Manager] Inicjalizacja...');
        this.setupEventHandlers();
    },

    setupEventHandlers() {
        // Per page selector
        const perPageSelect = document.getElementById('per-page-select');
        if (perPageSelect) {
            perPageSelect.addEventListener('change', this.changePerPage.bind(this));
        }

        // Page navigation buttons - event delegation
        document.addEventListener('click', (event) => {
            if (event.target.classList.contains('page-btn')) {
                const page = parseInt(event.target.dataset.page);
                if (page) {
                    this.goToPage(page);
                }
            }
        });

        // Prev/Next buttons
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');

        if (prevBtn) prevBtn.addEventListener('click', this.prevPage.bind(this));
        if (nextBtn) nextBtn.addEventListener('click', this.nextPage.bind(this));
    },

    async goToPage(page) {
        if (page === ProductsList.state.pagination.currentPage) return;

        ProductsList.state.pagination.currentPage = page;
        await refreshProductsList();
        this.scrollToTop();
    },

    async prevPage() {
        if (ProductsList.state.pagination.currentPage > 1) {
            await this.goToPage(ProductsList.state.pagination.currentPage - 1);
        }
    },

    async nextPage() {
        if (ProductsList.state.pagination.currentPage < ProductsList.state.pagination.totalPages) {
            await this.goToPage(ProductsList.state.pagination.currentPage + 1);
        }
    },

    async changePerPage() {
        const perPageSelect = document.getElementById('per-page-select');
        if (!perPageSelect) return;

        const newPerPage = parseInt(perPageSelect.value);
        if (newPerPage !== ProductsList.state.pagination.perPage) {
            ProductsList.state.pagination.perPage = newPerPage;
            ProductsList.state.pagination.currentPage = 1; // Reset to first page
            await refreshProductsList();
            this.scrollToTop();
        }
    },

    updateControls(paginationData) {
        if (!paginationData) return;

        // Update state
        ProductsList.state.pagination = {
            currentPage: paginationData.page,
            perPage: paginationData.per_page,
            totalPages: paginationData.pages,
            totalItems: paginationData.total
        };

        // Update info text
        const itemsFrom = ((paginationData.page - 1) * paginationData.per_page) + 1;
        const itemsTo = Math.min(paginationData.page * paginationData.per_page, paginationData.total);

        const fromElement = document.getElementById('items-from');
        const toElement = document.getElementById('items-to');
        const totalElement = document.getElementById('total-items');

        if (fromElement) fromElement.textContent = itemsFrom;
        if (toElement) toElement.textContent = itemsTo;
        if (totalElement) totalElement.textContent = paginationData.total;

        // Update page numbers
        this.updatePageNumbers(paginationData);

        // Update prev/next buttons
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');

        if (prevBtn) {
            prevBtn.disabled = !paginationData.has_prev;
            prevBtn.classList.toggle('disabled', !paginationData.has_prev);
        }

        if (nextBtn) {
            nextBtn.disabled = !paginationData.has_next;
            nextBtn.classList.toggle('disabled', !paginationData.has_next);
        }

        // Update per page selector
        const perPageSelect = document.getElementById('per-page-select');
        if (perPageSelect && perPageSelect.value != paginationData.per_page) {
            perPageSelect.value = paginationData.per_page;
        }
    },

    updatePageNumbers(paginationData) {
        const pageNumbersContainer = document.getElementById('page-numbers');
        if (!pageNumbersContainer) return;

        const currentPage = paginationData.page;
        const totalPages = paginationData.pages;

        let html = '';

        // Show max 7 page numbers
        let startPage = Math.max(1, currentPage - 3);
        let endPage = Math.min(totalPages, currentPage + 3);

        // Adjust if we're near the beginning or end
        if (endPage - startPage < 6) {
            if (startPage === 1) {
                endPage = Math.min(totalPages, startPage + 6);
            } else if (endPage === totalPages) {
                startPage = Math.max(1, endPage - 6);
            }
        }

        // First page + ellipsis
        if (startPage > 1) {
            html += `<button class="btn btn-outline-secondary btn-sm page-btn" data-page="1">1</button>`;
            if (startPage > 2) {
                html += `<span class="pagination-ellipsis">...</span>`;
            }
        }

        // Page numbers
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === currentPage;
            html += `<button class="btn ${isActive ? 'btn-primary' : 'btn-outline-secondary'} btn-sm page-btn" 
                     data-page="${i}" ${isActive ? 'disabled' : ''}>${i}</button>`;
        }

        // Last page + ellipsis
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += `<span class="pagination-ellipsis">...</span>`;
            }
            html += `<button class="btn btn-outline-secondary btn-sm page-btn" data-page="${totalPages}">${totalPages}</button>`;
        }

        pageNumbersContainer.innerHTML = html;
    },

    scrollToTop() {
        const tableContainer = document.querySelector('.products-table-container');
        if (tableContainer) {
            tableContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
};

// ============================================================================
// FUNKCJE GŁÓWNE
// ============================================================================

/**
 * Odświeża listę produktów
 */
async function refreshProductsList() {
    console.log('[Products List] Odświeżanie przez zintegrowany system...');

    // Użyj nowego systemu filtrowania
    await AdvancedFilters.applyFilters();
}

/**
 * Aktualizuje tabelę produktów z nowymi danymi
 */
function updateProductsTable(products) {
    const tbody = document.getElementById('products-tbody');
    if (!tbody) {
        console.error('[Products List] Nie znaleziono tbody');
        return;
    }

    if (!products || products.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="100%" class="text-center py-5">
                    <div class="no-products-message">
                        <i class="fas fa-search fa-3x text-muted mb-3"></i>
                        <h5>Brak produktów</h5>
                        <p class="text-muted">Nie znaleziono produktów spełniających kryteria filtrowania.</p>
                        <button class="btn btn-outline-primary" onclick="AdvancedFilters.clearAllFilters()">
                            Wyczyść filtry
                        </button>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    products.forEach(product => {
        html += generateProductRowHtml(product);
    });

    tbody.innerHTML = html;

    // Add visual enhancements
    addRowInteractions();
    updateRowVisualStates();
}

/**
 * Generuje HTML dla wiersza produktu
 */
function generateProductRowHtml(product) {
    const isAdmin = window.productsData.isAdmin;
    const statusDisplay = getStatusDisplay(product.current_status);
    const statusClass = getStatusClass(product.current_status);
    const priorityClass = getPriorityClass(product.priority_score);
    const deadlineInfo = getDeadlineInfo(product);

    return `
        <tr class="product-row ${product.status_flags?.is_overdue ? 'row-overdue' : ''} ${product.status_flags?.is_urgent ? 'row-urgent' : ''}"
            data-product-id="${product.id}"
            data-priority="${product.priority_score || 0}"
            data-status="${product.current_status}"
            onclick="ProductModal.openModal(${product.id})">

            <!-- Checkbox column -->
            <td class="checkbox-cell" onclick="event.stopPropagation()">
                <input type="checkbox" class="product-checkbox" 
                       value="${product.id}" 
                       onchange="BulkActions.toggleProduct(${product.id})">
            </td>

            ${isAdmin ? `
            <!-- Priority column for admin -->
            <td class="priority-cell" onclick="event.stopPropagation()">
                <div class="priority-container">
                    <div class="drag-handle" title="Przeciągnij aby zmienić priorytet">
                        <i class="fas fa-grip-vertical"></i>
                    </div>
                    <div class="priority-value">
                        <span class="priority-score ${priorityClass}" 
                              data-original="${product.priority_score || 0}"
                              onclick="editPriorityInline(${product.id}, this)">
                            ${product.priority_score || 0}
                        </span>
                        <div class="priority-bar">
                            <div class="priority-fill" style="width: ${Math.min((product.priority_score || 0) / 2, 100)}%"></div>
                        </div>
                    </div>
                </div>
            </td>
            ` : ''}

            <!-- Product ID -->
            <td class="product-id-cell">
                <div class="product-id-container">
                    <span class="product-id-main" title="ID produktu">${product.short_product_id}</span>
                    <span class="product-id-original" title="Zamówienie wewnętrzne">${product.internal_order_number}</span>
                    ${product.baselinker_order_id ? `<span class="product-id-baselinker" title="ID Baselinker">BL: ${product.baselinker_order_id}</span>` : ''}
                </div>
            </td>

            <!-- Product name and details -->
            <td class="product-cell">
                <div class="product-info">
                    <div class="product-name" title="${product.original_product_name}">
                        ${product.original_product_name.length > 60 ?
            product.original_product_name.substring(0, 60) + '...' :
            product.original_product_name}
                    </div>
                    ${product.parsed_data ? `
                    <div class="product-specs">
                        ${product.parsed_data.wood_species ? `<span class="spec-item species">${product.parsed_data.wood_species}</span>` : ''}
                        ${product.parsed_data.technology ? `<span class="spec-item tech">${product.parsed_data.technology}</span>` : ''}
                        ${product.parsed_data.dimensions ? `<span class="spec-item dims">${product.parsed_data.dimensions}</span>` : ''}
                        ${product.parsed_data.volume_m3 ? `<span class="spec-item volume">${product.parsed_data.volume_m3} m³</span>` : ''}
                    </div>
                    ` : ''}
                </div>
            </td>

            <!-- Status -->
            <td class="status-cell">
                <span class="status-badge ${statusClass}" title="Status produktu">
                    ${statusDisplay}
                </span>
                ${product.status_flags?.is_overdue ? '<i class="fas fa-exclamation-triangle text-danger ms-1" title="Przeterminowane"></i>' : ''}
                ${product.status_flags?.is_urgent ? '<i class="fas fa-clock text-warning ms-1" title="Pilne"></i>' : ''}
            </td>

            <!-- Deadline -->
            <td class="deadline-cell">
                ${deadlineInfo.html}
            </td>

            <!-- Created date -->
            <td class="created-cell">
                <span class="created-date">${formatDate(product.created_at)}</span>
            </td>

            <!-- Financial data -->
            <td class="financial-cell">
                ${product.financial_data?.total_value_net ? `
                <div class="financial-info">
                    <span class="total-value">${formatCurrency(product.financial_data.total_value_net)}</span>
                    ${product.financial_data.unit_price_net ? `<span class="unit-price">${formatCurrency(product.financial_data.unit_price_net)}/m³</span>` : ''}
                </div>
                ` : '<span class="text-muted">-</span>'}
            </td>

            <!-- Actions -->
            <td class="actions-cell" onclick="event.stopPropagation()">
                <div class="dropdown">
                    <button class="btn btn-sm btn-outline-secondary dropdown-toggle" 
                            type="button" data-bs-toggle="dropdown">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <ul class="dropdown-menu">
                        <li>
                            <a class="dropdown-item" href="#" onclick="ProductModal.openModal(${product.id})">
                                <i class="fas fa-eye"></i> Szczegóły
                            </a>
                        </li>
                        ${isAdmin ? `
                        <li>
                            <a class="dropdown-item" href="#" onclick="editProductPriority(${product.id})">
                                <i class="fas fa-edit"></i> Edytuj priorytet
                            </a>
                        </li>
                        <li>
                            <a class="dropdown-item" href="#" onclick="changeProductStatus(${product.id})">
                                <i class="fas fa-exchange-alt"></i> Zmień status
                            </a>
                        </li>
                        <li><hr class="dropdown-divider"></li>
                        <li>
                            <a class="dropdown-item text-danger" href="#" onclick="deleteProduct(${product.id})">
                                <i class="fas fa-trash"></i> Usuń
                            </a>
                        </li>
                        ` : ''}
                    </ul>
                </div>
            </td>
        </tr>
    `;
}

/**
 * Dodaje interakcje do wierszy tabeli
 */
function addRowInteractions() {
    const rows = document.querySelectorAll('.product-row');

    rows.forEach(row => {
        // Hover effects
        row.addEventListener('mouseenter', function () {
            this.classList.add('row-hover');
        });

        row.addEventListener('mouseleave', function () {
            this.classList.remove('row-hover');
        });

        // Context menu
        row.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            showContextMenu(e, this);
        });

        // Double click for quick action
        row.addEventListener('dblclick', function () {
            const productId = this.dataset.productId;
            ProductModal.openModal(parseInt(productId));
        });
    });
}

/**
 * Aktualizuje stany wizualne wierszy
 */
function updateRowVisualStates() {
    const rows = document.querySelectorAll('.product-row');

    rows.forEach(row => {
        const priority = parseInt(row.dataset.priority || '0');
        const status = row.dataset.status;

        // Priority visual indicators
        if (priority >= 150) {
            row.classList.add('high-priority');
        } else if (priority <= 50) {
            row.classList.add('low-priority');
        }

        // Status visual indicators
        row.classList.add(`status-${status.replace('_', '-')}`);
    });
}

/**
 * Pokazuje menu kontekstowe dla wiersza
 */
function showContextMenu(event, row) {
    const productId = parseInt(row.dataset.productId);
    const isAdmin = window.productsData.isAdmin;

    // Remove existing context menu
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    menu.style.zIndex = '9999';

    menu.innerHTML = `
        <div class="context-menu-content">
            <div class="context-menu-item" onclick="ProductModal.openModal(${productId})">
                <i class="fas fa-eye"></i> Zobacz szczegóły
            </div>
            <div class="context-menu-item" onclick="BulkActions.selectProduct(${productId}); document.querySelector('.context-menu').remove();">
                <i class="fas fa-check-square"></i> Zaznacz produkt
            </div>
            ${isAdmin ? `
            <hr class="context-menu-divider">
            <div class="context-menu-item" onclick="editProductPriority(${productId})">
                <i class="fas fa-edit"></i> Edytuj priorytet
            </div>
            <div class="context-menu-item" onclick="changeProductStatus(${productId})">
                <i class="fas fa-exchange-alt"></i> Zmień status
            </div>
            <hr class="context-menu-divider">
            <div class="context-menu-item text-danger" onclick="deleteProduct(${productId})">
                <i class="fas fa-trash"></i> Usuń produkt
            </div>
            ` : ''}
        </div>
    `;

    document.body.appendChild(menu);

    // Remove menu on click outside
    setTimeout(() => {
        document.addEventListener('click', function removeMenu() {
            menu.remove();
            document.removeEventListener('click', removeMenu);
        });
    }, 100);
}

/**
 * Aktualizuje statystyki filtra
 */
function updateFilterStats(stats) {
    if (!stats) return;

    // Update counters
    const elements = {
        'filter-total-count': stats.total_products,
        'filter-high-priority-count': stats.high_priority_count,
        'filter-overdue-count': stats.overdue_count,
        'filter-avg-priority': stats.avg_priority
    };

    Object.entries(elements).forEach(([elementId, value]) => {
        const element = document.getElementById(elementId);
        if (element && value !== undefined) {
            element.textContent = value;
        }
    });

    // Show/hide filter stats bar
    const statsBar = document.getElementById('filter-stats-bar');
    if (statsBar) {
        const hasActiveFilters = Object.values(ProductsList.state.currentFilters)
            .some(value => value && value !== '' && value !== 'all');

        if (hasActiveFilters) {
            statsBar.style.display = 'block';
        } else {
            statsBar.style.display = 'none';
        }
    }
}

// ============================================================================
// MODAL SZCZEGÓŁÓW PRODUKTU
// ============================================================================

const ProductModal = {
    currentProductId: null,
    productsList: [],

    async openModal(productId) {
        try {
            this.currentProductId = productId;
            showSpinner('Ładowanie szczegółów produktu...');

            const response = await fetch(ProductsList.endpoints.productDetails.replace('{id}', productId), {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Błąd pobierania szczegółów produktu');
            }

            this.showModal(data.product);

        } catch (error) {
            console.error('[Product Modal] Błąd ładowania szczegółów:', error);
            showToast('Błąd ładowania szczegółów: ' + error.message, 'error');
        } finally {
            hideSpinner();
        }
    },

    showModal(product) {
        // Create modal if doesn't exist
        let modal = document.getElementById('productDetailModal');
        if (!modal) {
            modal = this.createModal();
        }

        // Update modal content
        this.updateModalContent(modal, product);

        // Show modal
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();

        // Setup navigation
        this.setupNavigation(modal);
    },

    createModal() {
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'productDetailModal';
        modal.innerHTML = `
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="productModalTitle">Szczegóły produktu</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="productModalBody">
                        <!-- Content will be loaded here -->
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" id="prevProductBtn">
                            <i class="fas fa-chevron-left"></i> Poprzedni
                        </button>
                        <button type="button" class="btn btn-outline-secondary" id="nextProductBtn">
                            Następny <i class="fas fa-chevron-right"></i>
                        </button>
                        <div class="flex-fill"></div>
                        <button type="button" class="btn btn-outline-primary" onclick="ProductModal.exportSingle()">
                            <i class="fas fa-download"></i> Eksport
                        </button>
                        ${window.productsData.isAdmin ? `
                        <button type="button" class="btn btn-primary" onclick="ProductModal.editProduct()">
                            <i class="fas fa-edit"></i> Edytuj
                        </button>
                        ` : ''}
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Zamknij</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        return modal;
    },

    updateModalContent(modal, product) {
        const title = modal.querySelector('#productModalTitle');
        const body = modal.querySelector('#productModalBody');

        if (title) {
            title.textContent = `Produkt ${product.short_product_id}`;
        }

        if (body) {
            body.innerHTML = this.generateModalContent(product);
        }
    },

    generateModalContent(product) {
        const deadlineInfo = getDeadlineInfo(product);
        const statusDisplay = getStatusDisplay(product.current_status);
        const statusClass = getStatusClass(product.current_status);

        return `
            <div class="product-detail-container">
                <!-- Header section -->
                <div class="row mb-4">
                    <div class="col-md-8">
                        <div class="product-detail-header">
                            <h4 class="product-detail-title">${product.original_product_name}</h4>
                            <div class="product-detail-meta">
                                <span class="badge bg-primary me-2">ID: ${product.short_product_id}</span>
                                <span class="badge bg-secondary me-2">Zamówienie: ${product.internal_order_number}</span>
                                ${product.baselinker_order_id ? `<span class="badge bg-info">Baselinker: ${product.baselinker_order_id}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="col-md-4 text-end">
                        <div class="product-detail-status">
                            <span class="status-badge ${statusClass} fs-6">${statusDisplay}</span>
                            <div class="priority-display mt-2">
                                <span class="text-muted">Priorytet:</span>
                                <span class="priority-value fs-5 fw-bold ${getPriorityClass(product.priority_score)}">${product.priority_score || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Main content tabs -->
                <ul class="nav nav-tabs mb-3" id="productDetailTabs">
                    <li class="nav-item">
                        <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#overview-tab">Przegląd</button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#specifications-tab">Specyfikacja</button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#timeline-tab">Historia</button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#financial-tab">Finanse</button>
                    </li>
                </ul>

                <div class="tab-content">
                    <!-- Overview tab -->
                    <div class="tab-pane fade show active" id="overview-tab">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="detail-section">
                                    <h6 class="detail-section-title">Informacje podstawowe</h6>
                                    <table class="table table-sm">
                                        <tr>
                                            <td class="fw-medium">Status:</td>
                                            <td><span class="status-badge ${statusClass}">${statusDisplay}</span></td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Priorytet:</td>
                                            <td><span class="${getPriorityClass(product.priority_score)}">${product.priority_score || 0}</span></td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Deadline:</td>
                                            <td>${deadlineInfo.text}</td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Data utworzenia:</td>
                                            <td>${formatDateTime(product.created_at)}</td>
                                        </tr>
                                    </table>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="detail-section">
                                    <h6 class="detail-section-title">Metryki</h6>
                                    <div class="metrics-grid">
                                        ${product.status_flags?.is_overdue ? `
                                        <div class="metric-item alert alert-danger">
                                            <i class="fas fa-exclamation-triangle"></i>
                                            <span>Przeterminowane</span>
                                        </div>
                                        ` : ''}
                                        ${product.status_flags?.is_urgent ? `
                                        <div class="metric-item alert alert-warning">
                                            <i class="fas fa-clock"></i>
                                            <span>Pilne</span>
                                        </div>
                                        ` : ''}
                                        ${product.status_flags?.is_high_priority ? `
                                        <div class="metric-item alert alert-info">
                                            <i class="fas fa-star"></i>
                                            <span>Wysoki priorytet</span>
                                        </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Specifications tab -->
                    <div class="tab-pane fade" id="specifications-tab">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="detail-section">
                                    <h6 class="detail-section-title">Materiał</h6>
                                    <table class="table table-sm">
                                        <tr>
                                            <td class="fw-medium">Gatunek drewna:</td>
                                            <td>${product.parsed_data?.wood_species || '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Klasa:</td>
                                            <td>${product.parsed_data?.wood_class || '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Technologia:</td>
                                            <td>${product.parsed_data?.technology || '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Wykończenie:</td>
                                            <td>${product.parsed_data?.finish_state || '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                    </table>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="detail-section">
                                    <h6 class="detail-section-title">Wymiary</h6>
                                    <table class="table table-sm">
                                        <tr>
                                            <td class="fw-medium">Długość:</td>
                                            <td>${product.parsed_data?.length_cm ? product.parsed_data.length_cm + ' cm' : '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Szerokość:</td>
                                            <td>${product.parsed_data?.width_cm ? product.parsed_data.width_cm + ' cm' : '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Grubość:</td>
                                            <td>${product.parsed_data?.thickness_cm ? product.parsed_data.thickness_cm + ' cm' : '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Objętość:</td>
                                            <td>${product.parsed_data?.volume_m3 ? product.parsed_data.volume_m3 + ' m³' : '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Timeline tab -->
                    <div class="tab-pane fade" id="timeline-tab">
                        <div class="detail-section">
                            <h6 class="detail-section-title">Historia statusów</h6>
                            <div class="timeline">
                                ${this.generateTimelineHtml(product.status_history)}
                            </div>
                            
                            ${product.time_metrics ? `
                            <h6 class="detail-section-title mt-4">Metryki czasu</h6>
                            <div class="time-metrics">
                                ${Object.entries(product.time_metrics).map(([key, metric]) => `
                                    <div class="metric-item">
                                        <span class="metric-label">${this.getMetricLabel(key)}:</span>
                                        <span class="metric-value">${metric.formatted || 'W trakcie'}</span>
                                    </div>
                                `).join('')}
                            </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Financial tab -->
                    <div class="tab-pane fade" id="financial-tab">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="detail-section">
                                    <h6 class="detail-section-title">Ceny</h6>
                                    <table class="table table-sm">
                                        <tr>
                                            <td class="fw-medium">Cena jednostkowa netto:</td>
                                            <td>${product.financial_data?.unit_price_net ? formatCurrency(product.financial_data.unit_price_net) : '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                        <tr>
                                            <td class="fw-medium">Wartość całkowita netto:</td>
                                            <td class="fw-bold">${product.financial_data?.total_value_net ? formatCurrency(product.financial_data.total_value_net) : '<span class="text-muted">Nie określono</span>'}</td>
                                        </tr>
                                    </table>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="detail-section">
                                    <h6 class="detail-section-title">Obliczenia</h6>
                                    ${product.parsed_data?.volume_m3 && product.financial_data?.unit_price_net ? `
                                    <table class="table table-sm">
                                        <tr>
                                            <td>Objętość:</td>
                                            <td>${product.parsed_data.volume_m3} m³</td>
                                        </tr>
                                        <tr>
                                            <td>Cena za m³:</td>
                                            <td>${formatCurrency(product.financial_data.unit_price_net)}</td>
                                        </tr>
                                        <tr class="table-active">
                                            <td class="fw-bold">Razem:</td>
                                            <td class="fw-bold">${formatCurrency(product.financial_data.unit_price_net * product.parsed_data.volume_m3)}</td>
                                        </tr>
                                    </table>
                                    ` : '<p class="text-muted">Brak danych do obliczeń</p>'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    generateTimelineHtml(statusHistory) {
        if (!statusHistory || statusHistory.length === 0) {
            return '<p class="text-muted">Brak historii statusów</p>';
        }

        return statusHistory.map((entry, index) => `
            <div class="timeline-item ${index === 0 ? 'timeline-current' : ''}">
                <div class="timeline-marker">
                    <i class="fas fa-circle"></i>
                </div>
                <div class="timeline-content">
                    <div class="timeline-header">
                        <span class="timeline-status">${getStatusDisplay(entry.status)}</span>
                        <span class="timeline-date">${formatDateTime(entry.changed_at)}</span>
                    </div>
                    ${entry.station ? `<div class="timeline-station">Stanowisko: ${entry.station}</div>` : ''}
                    ${entry.notes ? `<div class="timeline-notes">${entry.notes}</div>` : ''}
                </div>
            </div>
        `).join('');
    },

    getMetricLabel(metricKey) {
        const labels = {
            'cutting_duration': 'Czas wycinania',
            'assembly_duration': 'Czas składania',
            'packaging_duration': 'Czas pakowania'
        };
        return labels[metricKey] || metricKey;
    },

    setupNavigation(modal) {
        const prevBtn = modal.querySelector('#prevProductBtn');
        const nextBtn = modal.querySelector('#nextProductBtn');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.navigateToProduct('prev'));
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.navigateToProduct('next'));
        }

        // Update button states
        this.updateNavigationButtons();
    },

    navigateToProduct(direction) {
        // Get current products list from table
        const productRows = document.querySelectorAll('.product-row');
        const productIds = Array.from(productRows).map(row => parseInt(row.dataset.productId));

        const currentIndex = productIds.indexOf(this.currentProductId);

        let nextIndex;
        if (direction === 'prev') {
            nextIndex = currentIndex - 1;
        } else {
            nextIndex = currentIndex + 1;
        }

        if (nextIndex >= 0 && nextIndex < productIds.length) {
            this.openModal(productIds[nextIndex]);
        }
    },

    updateNavigationButtons() {
        const modal = document.getElementById('productDetailModal');
        if (!modal) return;

        const prevBtn = modal.querySelector('#prevProductBtn');
        const nextBtn = modal.querySelector('#nextProductBtn');

        const productRows = document.querySelectorAll('.product-row');
        const productIds = Array.from(productRows).map(row => parseInt(row.dataset.productId));
        const currentIndex = productIds.indexOf(this.currentProductId);

        if (prevBtn) {
            prevBtn.disabled = currentIndex <= 0;
        }

        if (nextBtn) {
            nextBtn.disabled = currentIndex >= productIds.length - 1;
        }
    },

    exportSingle() {
        if (!this.currentProductId) return;
        ExportManager.openExportModal([this.currentProductId]);
    },

    editProduct() {
        if (!this.currentProductId) return;
        // Placeholder for edit functionality
        showToast('Funkcja edycji będzie dostępna wkrótce', 'info');
    }
};

// ============================================================================
// FUNKCJE POMOCNICZE - DRAG & DROP
// ============================================================================

/**
 * Obsługuje zmianę kolejności priorytetów przez drag & drop
 */
async function handlePriorityReorder(oldIndex, newIndex) {
    try {
        console.log('[Drag & Drop] Przetwarzanie zmiany kolejności...', { oldIndex, newIndex });

        const rows = document.querySelectorAll('#products-tbody .product-row');
        const products = [];

        // Zbierz wszystkie produkty z ich nowymi pozycjami
        rows.forEach((row, index) => {
            const productId = parseInt(row.dataset.productId);
            // Oblicz nowy priorytet na podstawie pozycji (odwrotnie - wyższy index = niższy priorytet)
            const newPriority = Math.max(0, 200 - (index * 2));

            products.push({
                id: productId,
                priority: newPriority
            });
        });

        // Wyślij batch update
        const response = await fetch(ProductsList.endpoints.updatePriority, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                products: products
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`Zaktualizowano priorytety ${data.updated_count} produktów`, 'success');

            // Aktualizuj UI bez pełnego refresh
            updatePriorityDisplays(data.updated_products);

            ProductsList.state.unsavedChanges = false;
            hideSaveButton();
        } else {
            throw new Error(data.error || 'Błąd aktualizacji priorytetów');
        }

    } catch (error) {
        console.error('[Drag & Drop] Błąd aktualizacji priorytetów:', error);
        showToast('Błąd aktualizacji priorytetów: ' + error.message, 'error');

        // Przywróć oryginalną kolejność
        refreshProductsList();
    }
}

/**
 * Aktualizuje wyświetlane priorytety po drag & drop
 */
function updatePriorityDisplays(updatedProducts) {
    updatedProducts.forEach(product => {
        const row = document.querySelector(`[data-product-id="${product.id}"]`);
        if (row) {
            const priorityScore = row.querySelector('.priority-score');
            const priorityFill = row.querySelector('.priority-fill');

            if (priorityScore) {
                priorityScore.textContent = product.new_priority;
                priorityScore.className = `priority-score ${getPriorityClass(product.new_priority)}`;
            }

            if (priorityFill) {
                priorityFill.style.width = Math.min((product.new_priority / 2), 100) + '%';
            }

            // Aktualizuj dataset
            row.dataset.priority = product.new_priority;
        }
    });
}

/**
 * Dodaje wizualne wskaźniki dla drag & drop
 */
function addDragVisualIndicators() {
    const style = document.createElement('style');
    style.textContent = `
        .sortable-ghost {
            opacity: 0.4;
            background-color: #f8f9fa;
        }
        
        .sortable-chosen {
            background-color: #e3f2fd;
        }
        
        .sortable-drag {
            transform: rotate(2deg);
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        }
        
        .sorting-active {
            user-select: none;
        }
        
        .drag-hover {
            background-color: #e8f5e8;
            border-top: 2px solid #28a745;
        }
        
        .drag-help {
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 10px;
            border-radius: 5px;
            z-index: 10000;
            font-size: 12px;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Pokazuje pomoc podczas przeciągania
 */
function showDragHelp() {
    const help = document.createElement('div');
    help.className = 'drag-help';
    help.textContent = 'Przeciągnij aby zmienić priorytet';
    document.body.appendChild(help);

    setTimeout(() => {
        if (help.parentNode) {
            help.parentNode.removeChild(help);
        }
    }, 3000);
}

/**
 * Ukrywa pomoc po zakończeniu przeciągania
 */
function hideDragHelp() {
    const help = document.querySelector('.drag-help');
    if (help) {
        help.remove();
    }
}

/**
 * Pokazuje przycisk zapisywania zmian
 */
function showSaveButton() {
    const saveBtn = document.getElementById('save-priorities-btn');
    if (saveBtn) {
        saveBtn.style.display = 'block';
        ProductsList.state.unsavedChanges = true;
    }
}

/**
 * Ukrywa przycisk zapisywania zmian
 */
function hideSaveButton() {
    const saveBtn = document.getElementById('save-priorities-btn');
    if (saveBtn) {
        saveBtn.style.display = 'none';
        ProductsList.state.unsavedChanges = false;
    }
}

// ============================================================================
// FUNKCJE POMOCNICZE - UI I FORMATOWANIE
// ============================================================================

if (typeof debounce === 'undefined') {
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

/**
 * Pobiera wyświetlaną nazwę statusu
 */
function getStatusDisplay(status) {
    const statusMap = {
        'czeka_na_wyciecie': 'Czeka na wycięcie',
        'czeka_na_skladanie': 'Czeka na składanie',
        'czeka_na_pakowanie': 'Czeka na pakowanie',
        'spakowane': 'Spakowane',
        'wstrzymane': 'Wstrzymane',
        'anulowane': 'Anulowane'
    };
    return statusMap[status] || status || 'Nieznany';
}

/**
 * Pobiera klasę CSS dla statusu
 */
function getStatusClass(status) {
    const statusClasses = {
        'czeka_na_wyciecie': 'status-waiting',
        'czeka_na_skladanie': 'status-progress',
        'czeka_na_pakowanie': 'status-progress',
        'spakowane': 'status-completed',
        'wstrzymane': 'status-paused',
        'anulowane': 'status-cancelled'
    };
    return statusClasses[status] || 'status-unknown';
}

/**
 * Pobiera klasę CSS dla priorytetu
 */
function getPriorityClass(priority) {
    const p = priority || 0;
    if (p >= 150) return 'priority-critical';
    if (p >= 120) return 'priority-high';
    if (p >= 80) return 'priority-medium';
    return 'priority-low';
}

/**
 * Pobiera informacje o deadline
 */
function getDeadlineInfo(product) {
    if (!product.deadline_date) {
        return {
            text: 'Nie określono',
            html: '<span class="text-muted">Nie określono</span>',
            class: ''
        };
    }

    const days = product.days_to_deadline;
    let text, className, icon;

    if (days < 0) {
        text = `Przeterminowane (${Math.abs(days)} dni)`;
        className = 'text-danger fw-bold';
        icon = '<i class="fas fa-exclamation-triangle text-danger"></i>';
    } else if (days === 0) {
        text = 'Dzisiaj';
        className = 'text-warning fw-bold';
        icon = '<i class="fas fa-clock text-warning"></i>';
    } else if (days <= 2) {
        text = `${days} dni`;
        className = 'text-warning';
        icon = '<i class="fas fa-clock text-warning"></i>';
    } else if (days <= 7) {
        text = `${days} dni`;
        className = 'text-info';
        icon = '';
    } else {
        text = `${days} dni`;
        className = 'text-muted';
        icon = '';
    }

    return {
        text: text,
        html: `<span class="${className}">${icon} ${text}</span>`,
        class: className
    };
}

/**
 * Formatuje datę
 */
function formatDate(dateString) {
    if (!dateString) return '-';

    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('pl-PL');
    } catch (error) {
        return dateString;
    }
}

/**
 * Formatuje datę i czas
 */
function formatDateTime(dateString) {
    if (!dateString) return '-';

    try {
        const date = new Date(dateString);
        return date.toLocaleString('pl-PL');
    } catch (error) {
        return dateString;
    }
}

/**
 * Formatuje kwotę w walucie
 */
function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '-';

    try {
        return new Intl.NumberFormat('pl-PL', {
            style: 'currency',
            currency: 'PLN'
        }).format(amount);
    } catch (error) {
        return amount + ' PLN';
    }
}

// ============================================================================
// FUNKCJE UTILITY
// ============================================================================

/**
 * Debounce function dla optymalizacji wydajności
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Pokazuje spinner ładowania
 */
function showSpinner(message = 'Ładowanie...') {
    let spinner = document.getElementById('global-spinner');

    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'global-spinner';
        spinner.className = 'global-spinner';
        spinner.innerHTML = `
            <div class="spinner-overlay">
                <div class="spinner-content">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <div class="spinner-message mt-2">${message}</div>
                </div>
            </div>
        `;
        document.body.appendChild(spinner);
    } else {
        const messageElement = spinner.querySelector('.spinner-message');
        if (messageElement) {
            messageElement.textContent = message;
        }
    }

    spinner.style.display = 'flex';
}

/**
 * Ukrywa spinner ładowania
 */
function hideSpinner() {
    const spinner = document.getElementById('global-spinner');
    if (spinner) {
        spinner.style.display = 'none';
    }
}

/**
 * Pokazuje toast notification
 */
function showToast(message, type = 'info', duration = 5000) {
    // Remove existing toasts of same type
    const existingToasts = document.querySelectorAll(`.toast-${type}`);
    existingToasts.forEach(toast => toast.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} show`;
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.right = '20px';
    toast.style.zIndex = '9999';
    toast.style.minWidth = '300px';

    const icons = {
        'success': 'fas fa-check-circle',
        'error': 'fas fa-exclamation-circle',
        'warning': 'fas fa-exclamation-triangle',
        'info': 'fas fa-info-circle'
    };

    const colors = {
        'success': 'text-bg-success',
        'error': 'text-bg-danger',
        'warning': 'text-bg-warning',
        'info': 'text-bg-info'
    };

    toast.innerHTML = `
        <div class="toast-header ${colors[type]}">
            <i class="${icons[type]} me-2"></i>
            <strong class="me-auto">${type.charAt(0).toUpperCase() + type.slice(1)}</strong>
            <button type="button" class="btn-close btn-close-white" onclick="this.closest('.toast').remove()"></button>
        </div>
        <div class="toast-body">
            ${message}
        </div>
    `;

    document.body.appendChild(toast);

    // Auto remove
    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, duration);
    }
}

// ============================================================================
// FUNKCJE GŁÓWNE - INICJALIZACJA I KONTROLERY
// ============================================================================

/**
 * Inicjalizuje handlery zdarzeń
 */
function initEventListeners() {
    // Refresh button
    const refreshBtn = document.getElementById('refresh-products-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshProductsList);
    }

    // Save priorities button
    const savePrioritiesBtn = document.getElementById('save-priorities-btn');
    if (savePrioritiesBtn) {
        savePrioritiesBtn.addEventListener('click', savePriorities);
    }

    // Export button
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => ExportManager.openExportModal());
    }

    // Clear filters button
    const clearFiltersBtn = document.getElementById('clear-filters-btn');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => AdvancedFilters.clearAllFilters());
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Przed opuszczeniem strony
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Visibility change handling
    document.addEventListener('visibilitychange', handleVisibilityChange);

    console.log('[Products List] Event listenery zainicjalizowane');
}

/**
 * Inicjalizuje handlery paginacji
 */
function initPaginationHandlers() {
    PaginationManager.init();
}

/**
 * Inicjalizuje handlery filtrów
 */
function initFilterHandlers() {
    AdvancedFilters.init();
}

/**
 * Ładuje dane filtrów z API
 */
async function loadFiltersData() {
    await AdvancedFilters.loadFilterData();
}

/**
 * Ładuje filtry z localStorage
 */
function loadFiltersFromStorage() {
    try {
        const savedFilters = localStorage.getItem('productsListFilters');
        if (savedFilters) {
            const filters = JSON.parse(savedFilters);
            ProductsList.state.currentFilters = { ...ProductsList.state.currentFilters, ...filters };

            // Zastosuj filtry do UI
            applyFiltersToUI(filters);
        }
    } catch (error) {
        console.warn('[Products List] Nie można załadować filtrów z localStorage:', error);
    }
}

/**
 * Stosuje filtry do elementów UI
 */
function applyFiltersToUI(filters) {
    Object.entries(filters).forEach(([key, value]) => {
        const element = document.getElementById(key.replace('_', '-') + '-filter') ||
            document.getElementById(key.replace('_', '-'));

        if (element && value !== null && value !== '') {
            element.value = value;
        }
    });
}

/**
 * Stosuje wszystkie filtry
 */
function applyAllFilters() {
    AdvancedFilters.applyFilters();
}

/**
 * Setupuje skróty klawiszowe
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

/**
 * Obsługuje skróty klawiszowe
 */
function handleKeyboardShortcuts(event) {
    // Ctrl+R - refresh
    if (event.ctrlKey && event.key === 'r') {
        event.preventDefault();
        refreshProductsList();
    }

    // Ctrl+E - export
    if (event.ctrlKey && event.key === 'e') {
        event.preventDefault();
        ExportManager.openExportModal();
    }

    // Ctrl+F - focus search
    if (event.ctrlKey && event.key === 'f') {
        event.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }

    // Escape - clear search/selection
    if (event.key === 'Escape') {
        BulkActions.clearSelection();
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput === document.activeElement) {
            searchInput.blur();
        }
    }
}

/**
 * Obsługuje zamknięcie strony
 */
function handleBeforeUnload(event) {
    if (ProductsList.state.unsavedChanges) {
        event.preventDefault();
        event.returnValue = 'Masz niezapisane zmiany. Czy na pewno chcesz opuścić stronę?';
        return event.returnValue;
    }
}

/**
 * Obsługuje zmianę widoczności strony
 */
function handleVisibilityChange() {
    if (document.hidden) {
        // Strona ukryta - wstrzymaj auto-refresh
        console.log('[Products List] Strona ukryta - wstrzymano auto-refresh');
    } else {
        // Strona widoczna - wznów auto-refresh
        console.log('[Products List] Strona widoczna - wznowiono auto-refresh');

        // Jeśli ostatnie odświeżenie było dawno, odśwież teraz
        if (ProductsList.state.lastRefresh) {
            const timeSinceRefresh = Date.now() - ProductsList.state.lastRefresh.getTime();
            if (timeSinceRefresh > ProductsList.config.refreshInterval) {
                refreshProductsList();
            }
        }
    }
}

/**
 * Setupuje auto-refresh
 */
function setupAutoRefresh() {
    // Auto-refresh co minute jeśli strona jest widoczna
    setInterval(() => {
        if (!document.hidden && !ProductsList.state.isLoading) {
            console.log('[Products List] Auto-refresh...');
            refreshProductsList();
        }
    }, ProductsList.config.refreshInterval);
}

// ============================================================================
// FUNKCJE AKCJI
// ============================================================================

/**
 * Zapisuje priorytety (placeholder)
 */
async function savePriorities() {
    showToast('Priorytety zostały zapisane automatycznie', 'success');
    hideSaveButton();
}

/**
 * Edytuje priorytet inline
 */
function editPriorityInline(productId, element) {
    if (!window.productsData.isAdmin) return;

    const currentPriority = parseInt(element.textContent);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '200';
    input.value = currentPriority;
    input.className = 'form-control form-control-sm';
    input.style.width = '70px';

    element.parentNode.replaceChild(input, element);
    input.focus();
    input.select();

    const saveEdit = async () => {
        const newPriority = parseInt(input.value);
        if (newPriority >= 0 && newPriority <= 200 && newPriority !== currentPriority) {
            try {
                const response = await fetch(ProductsList.endpoints.updatePriority, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: JSON.stringify({
                        product_id: productId,
                        new_priority: newPriority
                    })
                });

                const data = await response.json();

                if (data.success) {
                    element.textContent = newPriority;
                    element.className = `priority-score ${getPriorityClass(newPriority)}`;

                    // Update priority bar
                    const priorityFill = element.parentNode.querySelector('.priority-fill');
                    if (priorityFill) {
                        priorityFill.style.width = Math.min((newPriority / 2), 100) + '%';
                    }

                    showToast('Priorytet zaktualizowany', 'success');
                } else {
                    throw new Error(data.error);
                }
            } catch (error) {
                showToast('Błąd aktualizacji: ' + error.message, 'error');
                element.textContent = currentPriority;
            }
        } else {
            element.textContent = currentPriority;
        }

        input.parentNode.replaceChild(element, input);
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            saveEdit();
        } else if (e.key === 'Escape') {
            element.textContent = currentPriority;
            input.parentNode.replaceChild(element, input);
        }
    });
}

/**
 * Edytuje priorytet produktu
 */
async function editProductPriority(productId) {
    const newPriority = await BulkActions.promptForPriority();
    if (newPriority === null) return;

    try {
        const response = await fetch(ProductsList.endpoints.updatePriority, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                product_id: productId,
                new_priority: newPriority
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Priorytet zaktualizowany', 'success');
            refreshProductsList();
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        showToast('Błąd aktualizacji: ' + error.message, 'error');
    }
}

/**
 * Zmienia status produktu
 */
async function changeProductStatus(productId) {
    const newStatus = await BulkActions.promptForStatus();
    if (!newStatus) return;

    try {
        const response = await fetch(ProductsList.endpoints.bulkAction, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                action: 'update_status',
                product_ids: [productId],
                parameters: {
                    new_status: newStatus
                }
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Status zaktualizowany', 'success');
            refreshProductsList();
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        showToast('Błąd aktualizacji: ' + error.message, 'error');
    }
}

/**
 * Usuwa produkt
 */
async function deleteProduct(productId) {
    if (!window.productsData.isAdmin) {
        showToast('Brak uprawnień', 'error');
        return;
    }

    const confirmed = confirm('Czy na pewno chcesz usunąć ten produkt?');
    if (!confirmed) return;

    try {
        const response = await fetch(ProductsList.endpoints.bulkAction, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                action: 'delete',
                product_ids: [productId]
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast('Produkt został usunięty', 'success');
            refreshProductsList();
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        showToast('Błąd usuwania: ' + error.message, 'error');
    }
}

// ============================================================================
// INITIALIZATION TRIGGER
// ============================================================================

// Auto-inicjalizacja gdy DOM jest gotowy
document.addEventListener('DOMContentLoaded', function () {
    console.log('[Products List] DOM załadowany - inicjalizacja...');
    initProductsList();
});

// Fallback jeśli DOMContentLoaded już przeszedł
if (document.readyState === 'loading') {
    // DOM jeszcze się ładuje
    document.addEventListener('DOMContentLoaded', initProductsList);
} else {
    // DOM już załadowany
    setTimeout(initProductsList, 100);
}