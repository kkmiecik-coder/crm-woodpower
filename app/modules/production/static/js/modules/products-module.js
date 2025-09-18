/**
 * products-module.js
 * ========================================================================
 * 
 * Moduł zarządzania listą produktów - restrukturyzacja tab produktów
 * 
 * Odpowiedzialności:
 * - Zaawansowane filtrowanie produktów (text search + 5 multi-select dropdownów)
 * - Virtual scrolling dla wydajności (1000+ produktów)
 * - Drag & drop z animacjami feedback
 * - Akcje grupowe (bulk actions) z modal
 * - Export Excel z opcjami
 * - Auto-refresh hybrydowy zachowujący stan UI
 * - System color coding i urgency indicators
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 1.0 - Nowy moduł wydzielony z dashboard
 * Data: 2025-01-15
 */

class ProductsModule {
    constructor(shared, config) {
        this.shared = shared;
        this.config = config;
        this.isLoaded = false;

        // Template loading state
        this.templateLoaded = false;

        // Debounce timers
        this.debounceTimers = {
            textSearch: null,
            filtersUpdate: null
        };

        // Main components
        this.components = {
            virtualScroll: null,
            dragDrop: null,
            filters: null,
            modals: null,
            exportTool: null,
            fuzzySearchEngine: null,
            searchCache: new Map()
        };

        // State management
        this.state = {
            // Filtry
            currentFilters: {
                textSearch: '',
                woodSpecies: [],
                technologies: [],
                woodClasses: [],
                thicknesses: [],
                statuses: []
            },

            // Zaznaczone produkty
            selectedProducts: new Set(),

            // Lista i sortowanie
            products: [],
            sortColumn: null,
            sortDirection: 'asc',

            // Auto-refresh
            lastUpdate: null,
            refreshInterval: null,

            // UI state
            isRefreshing: false,
            isExporting: false,

            // Statystyki
            stats: {
                totalCount: 0,
                totalVolume: 0,
                totalValue: 0,
                statusBreakdown: {}
            }
        };

        // Bound event handlers - będą dodawane stopniowo
        this.onTextSearchInput = this.handleTextSearchInput.bind(this);
        this.onFilterChange = this.handleFilterChange.bind(this);
        this.onProductSelect = this.handleProductSelect.bind(this);
        this.onSelectAll = this.handleSelectAll.bind(this);
        this.onBulkAction = this.handleBulkAction.bind(this);
        this.onExport = this.handleExport.bind(this);
        this.onProductDrag = this.handleProductDrag.bind(this);
        this.onProductDrop = this.handleProductDrop.bind(this);

        console.log('[ProductsModule] Initialized with state management');
    }

    // ========================================================================
    // LIFECYCLE METHODS
    // ========================================================================

    async load() {
        console.log('[ProductsModule] Loading products module...');

        try {
            if (!this.templateLoaded) {
                // PIERWSZY RAZ - ładuj template HTML + dane
                console.log('[ProductsModule] First load - loading template...');
                await this.loadProductsTemplate();
                this.templateLoaded = true;
            } else {
                // KOLEJNE RAZY - tylko odśwież dane
                console.log('[ProductsModule] Template already loaded - refreshing data only...');
                await this.refreshDataOnly();
            }

            this.isLoaded = true;
            this.state.lastUpdate = new Date();
            console.log('[ProductsModule] Products module loaded successfully');

        } catch (error) {
            console.error('[ProductsModule] Failed to load products module:', error);
            throw error;
        }
    }

    async loadProductsTemplate() {
        console.log('[ProductsModule] Loading HTML template for first time...');

        try {
            // Na razie używamy istniejącego endpointu - w kolejnych krokach zostanie rozbudowany
            const response = await this.shared.apiClient.getProductsTabContent();

            if (!response.success) {
                throw new Error(response.error || 'Failed to load products template');
            }

            // Update DOM with template HTML
            const wrapper = document.getElementById('products-tab-wrapper');
            if (wrapper) {
                wrapper.innerHTML = response.html;
                wrapper.style.display = 'block';

                console.log('[ProductsModule] Products template HTML loaded');

                // Inicjalizacja komponentów (tylko raz przy ładowaniu template)
                this.initializeComponents();
                this.setupEventListeners();

                // Załaduj początkowe dane jeśli są dostępne
                if (response.initial_data) {
                    console.log('[ProductsModule] Loading initial data from template response');
                    await this.updateWithInitialData(response.initial_data);
                }

            } else {
                throw new Error('Products tab wrapper not found');
            }

            console.log('[ProductsModule] Template loaded and initialized successfully');

        } catch (error) {
            console.error('[ProductsModule] Failed to load products template:', error);
            throw error;
        }
    }

    async refreshDataOnly() {
        console.log('[ProductsModule] Refreshing data without template reload...');

        try {
            // W kolejnych krokach implementujemy dedykowane API do refresh
            const response = await this.shared.apiClient.getProductsTabContent();

            if (response.success) {
                await this.updateWithInitialData(response.initial_data || response.data);
                this.state.lastUpdate = new Date();
                console.log('[ProductsModule] Data refresh completed successfully');
            }

        } catch (error) {
            console.error('[ProductsModule] Data refresh failed:', error);
            this.shared.toastSystem.show(
                'Błąd odświeżania danych: ' + error.message,
                'error'
            );
            throw error;
        }
    }

    async unload() {
        console.log('[ProductsModule] Unloading products module...');

        try {
            // Wyczyść intervals
            this.clearAllTimers();

            // Usuń event listeners
            this.removeEventListeners();

            // Zniszcz komponenty
            this.destroyComponents();

            // Reset stanu
            this.resetState();

            this.isLoaded = false;
            console.log('[ProductsModule] Products module unloaded successfully');

        } catch (error) {
            console.error('[ProductsModule] Error during unload:', error);
        }
    }

    async refresh() {
        console.log('[ProductsModule] Manual refresh requested...');

        if (this.state.isRefreshing) {
            console.warn('[ProductsModule] Refresh already in progress');
            return;
        }

        try {
            this.state.isRefreshing = true;
            await this.refreshDataOnly();

            // Emit refresh event
            this.shared.eventBus.emit('products:refreshed', {
                timestamp: this.state.lastUpdate
            });

        } finally {
            this.state.isRefreshing = false;
        }
    }

    destroy() {
        console.log('[ProductsModule] Destroying products module...');
        this.unload();
    }

    // ========================================================================
    // INITIALIZATION METHODS - będą implementowane w kolejnych krokach
    // ========================================================================

    initializeComponents() {
        console.log('[ProductsModule-new] Initializing components...');
        
        try {
            // KROK 3.1: Inicjalizuj text search z fuzzy ✅
            const textSearchSuccess = this.setupTextSearch();
            if (!textSearchSuccess) {
                console.warn('[ProductsModule-new] Text search initialization failed');
            }

            // KROK 3.2: Inicjalizuj multi-select dropdowns ✅
            const multiSelectSuccess = this.setupMultiSelectDropdowns();
            if (!multiSelectSuccess) {
                console.warn('[ProductsModule-new] Multi-select dropdowns initialization failed');
            }

            // KROK 3.3: Inicjalizuj system badges filtrów ✅
            const filterBadgesSuccess = this.setupFilterBadges();
            if (!filterBadgesSuccess) {
                console.warn('[ProductsModule-new] Filter badges initialization failed');
            }

            // KROK 4.1: Inicjalizuj virtual scrolling ✅
            const virtualScrollSuccess = this.initializeVirtualScrolling();
            if (!virtualScrollSuccess) {
                console.warn('[ProductsModule-new] Virtual scrolling initialization failed');
            }

            // KROK 4.2: Inicjalizuj strukturę wiersza produktu
            const productRowSuccess = this.setupProductRowStructure();
            if (!productRowSuccess) {
                console.warn('[ProductsModule-new] Product row structure initialization failed');
            }

            // W kolejnych krokach implementujemy:
            // KROK 5.1: this.initializeDragDrop();
            // KROK 6.1: this.initializeModals();
            // KROK 7.1: this.initializeExport();
            // KROK 7.2: this.initializeAutoRefresh();

            console.log('[ProductsModule-new] Components initialized successfully');
            return true;

        } catch (error) {
            console.error('[ProductsModule-new] Failed to initialize components:', error);
            return false;
        }
    }

    setupEventListeners() {
        console.log('[ProductsModule] Setting up event listeners...');

        const textSearchInput = document.getElementById('products-text-search');

        if (textSearchInput) {
            textSearchInput.addEventListener('input', this.onTextSearchInput);
            textSearchInput.addEventListener('keydown', this.handleTextSearchKeydown.bind(this));
            console.log('[ProductsModule] Text search listeners attached');
        }

        // NOWE: Select All checkbox
        const selectAllCheckbox = document.getElementById('select-all-products');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', this.handleSelectAllChange.bind(this));
            console.log('[ProductsModule] Select all checkbox listener attached');
        }

        // NOWE: Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));
        console.log('[ProductsModule] Keyboard shortcuts listener attached');

        console.log('[ProductsModule] Event listeners setup complete');
    }

    /**
     * NOWA METODA: Obsługuje zmiany w checkbox "Zaznacz wszystko"
     */
    handleSelectAllChange(event) {
        const isChecked = event.target.checked;
        console.log(`[ProductsModule] Select all changed: ${isChecked}`);
        
        if (isChecked) {
            this.selectAllVisibleProducts();
        } else {
            this.deselectAllProducts();
        }
    }

    /**
     * NOWA METODA: Obsługuje skróty klawiszowe
     */
    handleKeyboardShortcuts(event) {
        // Ctrl+A - Zaznacz wszystkie
        if (event.ctrlKey && event.key === 'a') {
            event.preventDefault();
            this.selectAllVisibleProducts();
            return;
        }
        
        // Ctrl+E - Export
        if (event.ctrlKey && event.key === 'e') {
            event.preventDefault();
            this.handleExport({ type: 'selected' });
            return;
        }
        
        // ESC - Zamknij modals/wyczyść zaznaczenia
        if (event.key === 'Escape') {
            this.handleEscapeKey();
            return;
        }
    }

    removeEventListeners() {
        console.log('[ProductsModule-new] Removing event listeners...');

        const textSearchInput = document.getElementById('products-text-search');

        if (textSearchInput) {
            textSearchInput.removeEventListener('input', this.onTextSearchInput);
            textSearchInput.removeEventListener('keydown', this.handleTextSearchKeydown.bind(this));
        }

        // NOWE: Cleanup multi-select event listeners
        document.removeEventListener('click', this.handleMultiSelectOutsideClick.bind(this));

        // Cleanup individual multi-select components
        if (this.components.multiSelects) {
            Object.keys(this.components.multiSelects).forEach(key => {
                this.cleanupMultiSelectEvents(key);
            });
        }

        console.log('[ProductsModule-new] All event listeners removed');
    }

    // ========================================================================
    // DATA HANDLING METHODS - podstawowe
    // ========================================================================

    async updateWithInitialData(data) {
        console.log('[ProductsModule] Updating with initial data...', data);

        if (data && data.products) {
            this.state.products = data.products;
            this.state.stats = data.stats || this.state.stats;
            console.log(`[ProductsModule] Loaded ${this.state.products.length} products`);
            
            // NOWE: Zainicjalizuj filteredProducts z wszystkimi produktami
            if (!this.state.filteredProducts) {
                this.state.filteredProducts = this.state.products;
            }
            
            // NOWE: Odśwież virtual scroll po załadowaniu danych
            if (this.components.virtualScroll) {
                this.refreshVirtualScrollData();
            }
            
            // NOWE: Aktualizuj statystyki
            this.updateSearchStatistics(this.state.products.length, '');
        }

        // W kolejnych krokach implementujemy:
        // - this.updateFiltersOptions();
    }

    // ========================================================================
    // EVENT HANDLERS - podstawowe struktury
    // ========================================================================

    handleTextSearchInput(event) {
        const searchValue = event.target.value.trim();
        console.log('[ProductsModule] Text search input:', searchValue);

        // Wyczyść poprzedni timer
        if (this.debounceTimers.textSearch) {
            clearTimeout(this.debounceTimers.textSearch);
        }

        // Pokaż loading indicator
        this.showSearchLoadingIndicator(true);

        // Debounced search (300ms)
        this.debounceTimers.textSearch = setTimeout(() => {
            this.performTextSearch(searchValue);
        }, 300);
    }

    handleFilterChange(event) {
        console.log('[ProductsModule] Filter change:', event);
        // Implementacja w kolejnych krokach
    }

    handleProductSelect(productId, selected) {
        console.log('[ProductsModule] Product select:', productId, selected);
        // Implementacja w kolejnych krokach
    }

    handleSelectAll(selectAll) {
        console.log('[ProductsModule] Select all:', selectAll);
        // Implementacja w kolejnych krokach
    }

    handleBulkAction(action, productIds) {
        console.log('[ProductsModule] Bulk action:', action, productIds);
        // Implementacja w kolejnych krokach
    }

    handleExport(options) {
        console.log('[ProductsModule] Export:', options);
        // Implementacja w kolejnych krokach
    }

    handleProductDrag(event) {
        console.log('[ProductsModule] Product drag:', event);
        // Implementacja w kolejnych krokach
    }

    handleProductDrop(event) {
        console.log('[ProductsModule] Product drop:', event);
        // Implementacja w kolejnych krokach
    }

    // ========================================================================
    // TEXT SEARCH Z FUZZY
    // ========================================================================

    /**
     * Konfiguruje system wyszukiwania tekstowego z fuzzy matching
     */
    setupTextSearch() {
        console.log('[ProductsModule] Setting up text search with fuzzy matching...');

        try {
            // Inicjalizuj fuzzy search engine
            this.initializeFuzzySearchEngine();

            // Ustaw konfigurację search
            this.searchConfig = {
                minQueryLength: 2,
                maxResults: 1000,
                fuzzyThreshold: 0.6, // 60% podobieństwa
                searchFields: ['product_id', 'product_name', 'client_name', 'short_product_id'],
                cacheEnabled: true,
                cacheExpiry: 5 * 60 * 1000 // 5 minut
            };

            console.log('[ProductsModule] Text search setup completed');
            return true;

        } catch (error) {
            console.error('[ProductsModule] Failed to setup text search:', error);
            return false;
        }
    }

    /**
     * Inicjalizuje silnik fuzzy search
     */
    initializeFuzzySearchEngine() {
        // Implementacja prostego fuzzy search bez zewnętrznych bibliotek
        this.components.fuzzySearchEngine = {
            // Levenshtein distance algorithm
            levenshteinDistance: (str1, str2) => {
                const matrix = [];
                const len1 = str1.length;
                const len2 = str2.length;

                for (let i = 0; i <= len2; i++) {
                    matrix[i] = [i];
                }

                for (let j = 0; j <= len1; j++) {
                    matrix[0][j] = j;
                }

                for (let i = 1; i <= len2; i++) {
                    for (let j = 1; j <= len1; j++) {
                        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                            matrix[i][j] = matrix[i - 1][j - 1];
                        } else {
                            matrix[i][j] = Math.min(
                                matrix[i - 1][j - 1] + 1, // substitution
                                matrix[i][j - 1] + 1,     // insertion
                                matrix[i - 1][j] + 1      // deletion
                            );
                        }
                    }
                }

                return matrix[len2][len1];
            },

            // Oblicza similarity score (0-1)
            calculateSimilarity: (str1, str2) => {
                const maxLength = Math.max(str1.length, str2.length);
                if (maxLength === 0) return 1.0;

                const distance = this.components.fuzzySearchEngine.levenshteinDistance(
                    str1.toLowerCase(),
                    str2.toLowerCase()
                );
                return 1.0 - (distance / maxLength);
            },

            // Sprawdza czy string zawiera query (fuzzy)
            fuzzyMatch: (text, query, threshold = 0.6) => {
                if (!text || !query) return false;

                text = text.toString().toLowerCase();
                query = query.toLowerCase();

                // Exact match - najwyższy priorytet
                if (text.includes(query)) return true;

                // Fuzzy match dla krótkich query
                if (query.length >= 3) {
                    const similarity = this.components.fuzzySearchEngine.calculateSimilarity(text, query);
                    return similarity >= threshold;
                }

                return false;
            }
        };

        console.log('[ProductsModule] Fuzzy search engine initialized');
    }

    /**
     * Wykonuje wyszukiwanie tekstowe z fuzzy matching
     */
    async performTextSearch(searchQuery) {
        console.log('[ProductsModule] Performing text search:', searchQuery);

        try {
            // Aktualizuj stan filtru
            this.state.currentFilters.textSearch = searchQuery;

            // Jeśli puste query - wyczyść filtr
            if (!searchQuery || searchQuery.length < this.searchConfig.minQueryLength) {
                console.log('[ProductsModule] Empty query - clearing text search filter');
                await this.clearTextSearchResults();
                return;
            }

            // Sprawdź cache
            const cacheKey = `search_${searchQuery}`;
            if (this.searchConfig.cacheEnabled && this.components.searchCache.has(cacheKey)) {
                const cached = this.components.searchCache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.searchConfig.cacheExpiry) {
                    console.log('[ProductsModule] Using cached search results');
                    this.displaySearchResults(cached.results, searchQuery);
                    return;
                }
            }

            // Wykonaj fuzzy search na lokalnych danych
            const results = this.fuzzySearchProducts(searchQuery);

            // Cache results
            if (this.searchConfig.cacheEnabled) {
                this.components.searchCache.set(cacheKey, {
                    results: results,
                    timestamp: Date.now()
                });
            }

            // Wyświetl rezultaty
            this.displaySearchResults(results, searchQuery);

            console.log(`[ProductsModule] Text search completed - found ${results.length} results`);

        } catch (error) {
            console.error('[ProductsModule] Text search failed:', error);
            this.showSearchError('Wystąpił błąd podczas wyszukiwania');
        } finally {
            this.showSearchLoadingIndicator(false);
        }
    }

    /**
     * Wykonuje fuzzy search na lokalnych produktach
     */
    fuzzySearchProducts(query) {
        if (!this.state.products || this.state.products.length === 0) {
            return [];
        }

        const results = [];
        const threshold = this.searchConfig.fuzzyThreshold;

        for (const product of this.state.products) {
            let matchScore = 0;
            let matchedField = null;

            // Sprawdź każde pole wyszukiwania
            for (const field of this.searchConfig.searchFields) {
                const fieldValue = this.getProductFieldValue(product, field);
                if (fieldValue && this.components.fuzzySearchEngine.fuzzyMatch(fieldValue, query, threshold)) {
                    const similarity = this.components.fuzzySearchEngine.calculateSimilarity(
                        fieldValue.toString().toLowerCase(),
                        query.toLowerCase()
                    );

                    if (similarity > matchScore) {
                        matchScore = similarity;
                        matchedField = field;
                    }
                }
            }

            // Jeśli znaleziono match, dodaj do rezultatów
            if (matchScore > 0) {
                results.push({
                    product: product,
                    matchScore: matchScore,
                    matchedField: matchedField
                });
            }
        }

        // Sortuj po score (najlepsze dopasowanie pierwsze)
        results.sort((a, b) => b.matchScore - a.matchScore);

        // Zwróć tylko produkty (bez metadanych)
        return results.map(result => result.product);
    }

    /**
     * Pobiera wartość pola produktu do przeszukania
     */
    getProductFieldValue(product, fieldName) {
        switch (fieldName) {
            case 'product_id':
                return product.id || product.product_id;
            case 'short_product_id':
                return product.short_product_id;
            case 'product_name':
                return product.original_product_name || product.product_name;
            case 'client_name':
                return product.client_name || product.customer_name;
            default:
                return product[fieldName];
        }
    }

    /**
     * Wyświetla rezultaty wyszukiwania
     */
    displaySearchResults(results, query) {
        console.log(`[ProductsModule] Displaying ${results.length} search results for: "${query}"`);

        // Aktualizuj listę produktów (w kolejnych krokach będzie virtual scrolling)
        this.state.filteredProducts = results;

        // Aktualizuj statystyki
        this.updateSearchStatistics(results.length, query);

        // Wyświetl search query w UI
        this.showActiveSearchQuery(query);

        // TODO: W kolejnych krokach - aktualizuj virtual scroll list
        // this.updateVirtualScrollList(results);

        console.log('[ProductsModule] Search results displayed');
    }

    /**
     * Czyści rezultaty wyszukiwania tekstowego
     */
    async clearTextSearchResults() {
        console.log('[ProductsModule] Clearing text search results');

        // Wyczyść filtr
        this.state.currentFilters.textSearch = '';

        // Przywróć pełną listę produktów
        this.state.filteredProducts = this.state.products;

        // Wyczyść UI
        this.clearActiveSearchQuery();

        // Aktualizuj statystyki
        this.updateSearchStatistics(this.state.products.length, '');

        // TODO: W kolejnych krokach - aktualizuj virtual scroll
        // this.updateVirtualScrollList(this.state.products);

        this.showSearchLoadingIndicator(false);
    }

    /**
     * Obsługuje klawisze w polu wyszukiwania
     */
    handleTextSearchKeydown(event) {
        switch (event.key) {
            case 'Escape':
                this.clearTextSearch();
                break;
            case 'Enter':
                event.preventDefault();
                // Wymusi natychmiastowe wyszukiwanie
                if (this.debounceTimers.textSearch) {
                    clearTimeout(this.debounceTimers.textSearch);
                }
                this.performTextSearch(event.target.value.trim());
                break;
        }
    }

    /**
     * Czyści pole wyszukiwania (przycisk X)
     */
    clearTextSearch() {
        console.log('[ProductsModule] Clearing text search');

        const textSearchInput = document.getElementById('products-text-search');
        if (textSearchInput) {
            textSearchInput.value = '';
            textSearchInput.focus();
        }

        this.clearTextSearchResults();
    }

    /**
     * Pokazuje/ukrywa loading indicator dla search
     */
    showSearchLoadingIndicator(show) {
        const spinner = document.getElementById('text-search-loading');
        if (spinner) {
            spinner.style.display = show ? 'block' : 'none';
        }

        const textSearchInput = document.getElementById('products-text-search');
        if (textSearchInput) {
            textSearchInput.classList.toggle('searching', show);
        }
    }

    /**
     * Aktualizuje statystyki wyszukiwania
     */
    updateSearchStatistics(resultsCount, query) {
        // Aktualizuj licznik produktów w statystykach
        const totalCountEl = document.getElementById('stats-total-count');
        if (totalCountEl) {
            totalCountEl.textContent = resultsCount.toLocaleString();
        }

        // Pokaż info o aktywnym wyszukiwaniu
        const searchInfo = document.querySelector('.search-results-info');
        if (searchInfo) {
            if (query && resultsCount < this.state.products.length) {
                searchInfo.textContent = `Wyniki dla: "${query}" (${resultsCount} z ${this.state.products.length})`;
                searchInfo.style.display = 'block';
            } else {
                searchInfo.style.display = 'none';
            }
        }
    }

    /**
     * Pokazuje aktywne zapytanie wyszukiwania w UI
     */
    showActiveSearchQuery(query) {
        console.log('[ProductsModule] Active search query:', query);

        // NOWE: Aktualizuj badges po zmianie text search
        this.updateFilterBadges();
    }

    /**
     * Czyści wskaźnik aktywnego wyszukiwania
     */
    clearActiveSearchQuery() {
        console.log('[ProductsModule] Cleared active search query');

        // NOWE: Aktualizuj badges po wyczyszczeniu text search
        this.updateFilterBadges();
    }

    /**
     * Pokazuje błąd wyszukiwania
     */
    showSearchError(message) {
        console.error('[ProductsModule] Search error:', message);

        // Użyj toast systemu jeśli dostępny
        if (this.shared && this.shared.toastSystem) {
            this.shared.toastSystem.show(message, 'error');
        } else {
            // Fallback
            alert('Błąd wyszukiwania: ' + message);
        }
    }

    // ========================================================================
    // MULTI-SELECT DROPDOWNS
    // ========================================================================

    /**
     * Konfiguruje system multi-select dropdownów
     */
    setupMultiSelectDropdowns() {
        console.log('[ProductsModule] Setting up multi-select dropdowns...');

        try {
            // POPRAWIONA Konfiguracja dropdownów - używamy ID-ków z HTML
            this.multiSelectConfig = {
                dropdowns: {
                    'wood-species': {
                        id: 'wood-species-multiselect',
                        displayId: 'filter-wood-species',
                        filterKey: 'woodSpecies',
                        placeholder: 'Wszystkie gatunki...',
                        searchPlaceholder: 'Szukaj gatunku...',
                        endpoint: '/api/filters/wood-species',
                        options: []
                    },
                    'technologies': {
                        id: 'technologies-multiselect',
                        displayId: 'filter-technology',
                        filterKey: 'technologies',
                        placeholder: 'Wszystkie technologie...',
                        searchPlaceholder: 'Szukaj technologii...',
                        endpoint: '/api/filters/technologies',
                        options: []
                    },
                    'wood-classes': {
                        id: 'wood-classes-multiselect',
                        displayId: 'filter-wood-class',
                        filterKey: 'woodClasses',
                        placeholder: 'Wszystkie klasy...',
                        searchPlaceholder: 'Szukaj klasy...',
                        endpoint: '/api/filters/wood-classes',
                        options: []
                    },
                    'thicknesses': {
                        id: 'thicknesses-multiselect',
                        displayId: 'filter-thickness',
                        filterKey: 'thicknesses',
                        placeholder: 'Wszystkie grubości...',
                        searchPlaceholder: 'Szukaj grubości...',
                        endpoint: '/api/filters/thicknesses',
                        options: []
                    },
                    'statuses': {
                        id: 'statuses-multiselect',
                        displayId: 'filter-status',
                        filterKey: 'statuses',
                        placeholder: 'Wszystkie statusy...',
                        searchPlaceholder: 'Szukaj statusu...',
                        endpoint: '/api/filters/statuses',
                        options: []
                    }
                }
            };

            // Inicjalizuj każdy dropdown
            for (const [key, config] of Object.entries(this.multiSelectConfig.dropdowns)) {
                this.initializeSingleMultiSelect(key, config);
            }

            // Załaduj opcje dla wszystkich dropdownów
            this.loadAllFilterOptions();

            console.log('[ProductsModule] Multi-select dropdowns setup completed');
            return true;

        } catch (error) {
            console.error('[ProductsModule] Failed to setup multi-select dropdowns:', error);
            return false;
        }
    }

    /**
     * Inicjalizuje pojedynczy multi-select dropdown
     */
    initializeSingleMultiSelect(key, config) {
        console.log(`[ProductsModule] Initializing multi-select: ${key}`);

        const displayEl = document.getElementById(config.displayId);
        if (!displayEl) {
            console.warn(`[ProductsModule] Display element not found: ${config.displayId}`);
            return;
        }

        const wrapperEl = displayEl.closest('.multi-select-wrapper');
        const dropdownEl = wrapperEl?.querySelector('.multi-select-dropdown');
        if (!dropdownEl) {
            console.warn(`[ProductsModule] Dropdown container not found for: ${key}`);
            return;
        }

        // Zapisz referencje (ważne: element = wrapperEl)
        if (!this.components.multiSelects) this.components.multiSelects = {};
        this.components.multiSelects[key] = {
            config,
            element: wrapperEl,           // <-- TOGO brakowało
            displayElement: displayEl,
            dropdownElement: dropdownEl,
            isOpen: false,
            selectedOptions: new Set(),
            filteredOptions: []
        };

        // Podłącz zdarzenia do istniejących elementów
        this.setupMultiSelectEventsForExisting(key, config, displayEl, dropdownEl);

        console.log(`[ProductsModule] Multi-select initialized successfully: ${key}`);
    }

    setupMultiSelectEventsForExisting(key, config, displayElement, dropdownElement) {
        // Toggle dropdown
        displayElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMultiSelectDropdown(key);
        });

        // Keyboard navigation
        displayElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleMultiSelectDropdown(key);
            } else if (e.key === 'Escape') {
                this.closeMultiSelectDropdown(key);
            }
        });

        // Search input (jeśli istnieje)
        const searchInput = dropdownElement.querySelector('.multi-select-search input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterMultiSelectOptions(key, e.target.value);
            });
        }

        // "Zaznacz wszystkie" - używamy istniejącego checkboxa
        const selectAllCheckbox = dropdownElement.querySelector('input[id*="-all"]');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectAllMultiSelectOptions(key);
                } else {
                    this.clearAllMultiSelectOptions(key);
                }
            });
        }

        // Zatrzymaj propagację kliknięć w dropdown
        dropdownElement.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        console.log(`[ProductsModule] Events setup for existing elements: ${key}`);
    }

    /**
     * Tworzy DOM struktur multi-select dropdown
     */
    createMultiSelectDropdown(key, config) {
        const container = document.createElement('div');
        container.className = 'multi-select-container';
        container.setAttribute('data-key', key);

        container.innerHTML = `
        <div class="multi-select-trigger" tabindex="0" role="button" aria-haspopup="listbox">
            <div class="multi-select-display">
                <span class="placeholder">${config.placeholder}</span>
                <span class="selected-count" style="display: none;">0 wybranych</span>
            </div>
            <div class="multi-select-arrow">
                <i class="fas fa-chevron-down"></i>
            </div>
        </div>
        <div class="multi-select-dropdown" style="display: none;" role="listbox">
            <div class="multi-select-header">
                <div class="multi-select-search">
                    <input type="text" 
                           class="form-control form-control-sm" 
                           placeholder="${config.searchPlaceholder}"
                           autocomplete="off">
                    <i class="fas fa-search search-icon"></i>
                </div>
                <div class="multi-select-actions">
                    <button type="button" class="btn btn-sm btn-link select-all-btn">
                        <i class="fas fa-check-square me-1"></i>Zaznacz wszystkie
                    </button>
                    <button type="button" class="btn btn-sm btn-link clear-all-btn">
                        <i class="fas fa-times me-1"></i>Wyczyść
                    </button>
                </div>
            </div>
            <div class="multi-select-loading" style="display: none;">
                <i class="fas fa-spinner fa-spin me-2"></i>Ładowanie opcji...
            </div>
            <div class="multi-select-options">
                <div class="no-options" style="display: none;">
                    <i class="fas fa-info-circle me-2"></i>Brak dostępnych opcji
                </div>
            </div>
        </div>
    `;

        return container;
    }

    /**
     * Konfiguruje event listeners dla multi-select
     */
    setupMultiSelectEvents(key, config, dropdown) {
        const trigger = dropdown.querySelector('.multi-select-trigger');
        const dropdownMenu = dropdown.querySelector('.multi-select-dropdown');
        const searchInput = dropdown.querySelector('.multi-select-search input');
        const selectAllBtn = dropdown.querySelector('.select-all-btn');
        const clearAllBtn = dropdown.querySelector('.clear-all-btn');

        // Toggle dropdown
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMultiSelectDropdown(key);
        });

        // Keyboard navigation
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleMultiSelectDropdown(key);
            } else if (e.key === 'Escape') {
                this.closeMultiSelectDropdown(key);
            }
        });

        // Search w opcjach
        searchInput.addEventListener('input', (e) => {
            this.filterMultiSelectOptions(key, e.target.value);
        });

        // Zaznacz wszystkie
        selectAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectAllMultiSelectOptions(key);
        });

        // Wyczyść wszystkie
        clearAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearAllMultiSelectOptions(key);
        });

        // Zatrzymaj propagację kliknięć w dropdown
        dropdownMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    /**
     * Toggle dropdown otwórz/zamknij
     */
    toggleMultiSelectDropdown(key) {
        const multiSelect = this.components.multiSelects && this.components.multiSelects[key];
        if (!multiSelect) return;

        if (multiSelect.isOpen) {
            this.closeMultiSelectDropdown(key);
        } else {
            this.openMultiSelectDropdown(key);
        }
    }

    /**
     * Otwiera dropdown
     */
    openMultiSelectDropdown(key) {
        console.log(`[ProductsModule] Opening multi-select dropdown: ${key}`);

        // Zamknij wszystkie inne dropdowny
        this.closeAllMultiSelectDropdowns();

        const multiSelect = this.components.multiSelects && this.components.multiSelects[key];
        if (!multiSelect) return;

        const dropdown = multiSelect.dropdownElement;
        const trigger = multiSelect.displayElement;

        dropdown.style.display = 'block';
        dropdown.classList.add('open');
        trigger.classList.add('open');
        multiSelect.isOpen = true;

        // Focus na search input
        const searchInput = dropdown.querySelector('.multi-select-search input');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 100);
        }

        // Dodaj click listener do zamknięcia
        setTimeout(() => {
            document.addEventListener('click', this.handleMultiSelectOutsideClick.bind(this));
        }, 100);
    }

    /**
     * Zamyka dropdown
     */
    closeMultiSelectDropdown(key) {
        const multiSelect = this.components.multiSelects && this.components.multiSelects[key];
        if (!multiSelect || !multiSelect.isOpen) return;

        const dropdown = multiSelect.dropdownElement;
        const trigger = multiSelect.displayElement;

        dropdown.style.display = 'none';
        dropdown.classList.remove('open');
        trigger.classList.remove('open');
        multiSelect.isOpen = false;

        // Usuń global click listener
        document.removeEventListener('click', this.handleMultiSelectOutsideClick.bind(this));
    }

    /**
     * Zamyka wszystkie otwarte dropdowny
     */
    closeAllMultiSelectDropdowns() {
        if (!this.components.multiSelects) return;

        for (const key of Object.keys(this.components.multiSelects)) {
            this.closeMultiSelectDropdown(key);
        }
    }

    /**
     * Obsługuje kliknięcia poza dropdownem
     */
    handleMultiSelectOutsideClick(event) {
        // Jeśli klik nie był w żadnym wrapperze multi-selectów, zamknij wszystkie
        const insideWrapper = event.target.closest('.multi-select-wrapper');
        if (!insideWrapper) {
            this.closeAllMultiSelectDropdowns();
        }
    }

    /**
     * Filtruje opcje w dropdown na podstawie wyszukiwania
     */
    filterMultiSelectOptions(key, searchQuery) {
        const ms = this.components.multiSelects[key];
        if (!ms) return;

        const options = ms.dropdownElement.querySelectorAll('.multi-select-option');
        const q = (searchQuery || '').toLowerCase().trim();

        let visible = 0;
        options.forEach(opt => {
            // pomiń “zaznacz wszystkie”
            if (opt.classList.contains('multi-select-all')) return;

            // w obecnym HTML tekst opcji jest w labelu, bez .option-text
            const txt = (opt.textContent || '').toLowerCase();
            const show = !q || txt.includes(q);
            opt.style.display = show ? 'flex' : 'none';
            if (show) visible++;
        });

        // (opcjonalnie) pokaż brak opcji – jeżeli dodasz placeholder .no-options w HTML
        const noEl = ms.dropdownElement.querySelector('.no-options');
        if (noEl) noEl.style.display = visible === 0 ? 'block' : 'none';
    }

    /**
     * Zaznacza wszystkie opcje
     */
    selectAllMultiSelectOptions(key) {
        console.log(`[ProductsModule] Selecting all options for: ${key}`);
        const ms = this.components.multiSelects[key];
        if (!ms) return;

        const visibleOptions = ms.dropdownElement.querySelectorAll(
            '.multi-select-option:not(.multi-select-all):not([style*="display: none"])'
        );

        visibleOptions.forEach(opt => {
            const cb = opt.querySelector('input[type="checkbox"]');
            const val = opt.getAttribute('data-value') || (cb && cb.value);
            if (cb && !cb.checked) {
                cb.checked = true;
                if (val) ms.selectedOptions.add(val);
            }
        });

        this.updateMultiSelectDisplay(key);
        this.triggerFilterUpdate(key);
    }

    /**
     * Wyczyść wszystkie zaznaczenia
     */
    clearAllMultiSelectOptions(key) {
        console.log(`[ProductsModule] Clearing all options for: ${key}`);
        const ms = this.components.multiSelects[key];
        if (!ms) return;

        const cbs = ms.dropdownElement.querySelectorAll('.multi-select-option input[type="checkbox"]');
        cbs.forEach(cb => { if (!cb.id.endsWith('-all')) cb.checked = false; });

        ms.selectedOptions.clear();
        this.updateMultiSelectDisplay(key);
        this.triggerFilterUpdate(key);
    }

    /**
     * Aktualizuje wyświetlanie wybranych opcji
     */
    updateMultiSelectDisplay(key) {
        const ms = this.components.multiSelects[key];
        if (!ms) return;

        const selectedCount = ms.selectedOptions.size;
        const labelEl = ms.displayElement.querySelector('.multi-select-placeholder');
        if (!labelEl) return;

        // W tym HTML nie ma osobnego .selected-count – wpisujemy licznik w placeholder
        labelEl.textContent = (selectedCount === 0) ? 'Wszystkie' : `${selectedCount} wybranych`;
    }

    /**
     * Ładuje opcje dla wszystkich filtrów
     */
    async loadAllFilterOptions() {
        console.log('[ProductsModule] Loading filter options for all dropdowns...');

        const promises = [];

        for (const [key, config] of Object.entries(this.multiSelectConfig.dropdowns)) {
            promises.push(this.loadFilterOptions(key, config));
        }

        try {
            await Promise.all(promises);
            console.log('[ProductsModule] All filter options loaded successfully');
        } catch (error) {
            console.error('[ProductsModule] Failed to load some filter options:', error);
        }
    }

    /**
     * Ładuje opcje dla pojedynczego dropdownu
     */
    async loadFilterOptions(key, config) {
        console.log(`[ProductsModule] Loading options for: ${key}`);

        // POPRAWKA: Sprawdź czy komponent istnieje
        const multiSelect = this.components.multiSelects && this.components.multiSelects[key];
        if (!multiSelect) {
            console.warn(`[ProductsModule] Multi-select component not found for: ${key}`);
            return;
        }

        // Pokaż loading
        this.showMultiSelectLoading(key, true);

        try {
            // Na razie używamy mock danych - w kolejnych krokach będzie API
            const options = await this.getMockFilterOptions(key);

            // Zapisz opcje
            config.options = options;

            // Renderuj opcje w dropdown
            this.renderMultiSelectOptionsInExisting(key, options);

            console.log(`[ProductsModule] Loaded ${options.length} options for: ${key}`);

        } catch (error) {
            console.error(`[ProductsModule] Failed to load options for ${key}:`, error);
            this.showMultiSelectError(key, 'Nie udało się załadować opcji');
        } finally {
            this.showMultiSelectLoading(key, false);
        }
    }

    /**
     * Renderuje opcje w istniejących elementach HTML
     */
    renderMultiSelectOptionsInExisting(key, options) {
        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect) return;

        const optionsContainer = multiSelect.dropdownElement.querySelector('.multi-select-options');
        if (!optionsContainer) {
            console.warn(`[ProductsModule] Options container not found for: ${key}`);
            return;
        }

        // Usuń istniejące opcje (oprócz "Zaznacz wszystkie")
        const existingOptions = optionsContainer.querySelectorAll('.multi-select-option:not(.multi-select-all)');
        existingOptions.forEach(option => option.remove());

        // Dodaj nowe opcje
        options.forEach(option => {
            const optionElement = this.createMultiSelectOptionForExisting(key, option);
            optionsContainer.appendChild(optionElement);
        });

        console.log(`[ProductsModule] Rendered ${options.length} options for: ${key}`);
    }

    /**
     * Tworzy opcję dla istniejącej struktury HTML
     */
    createMultiSelectOptionForExisting(key, option) {
        const optionElement = document.createElement('div');
        optionElement.className = 'multi-select-option';
        optionElement.setAttribute('data-value', option.value);

        optionElement.innerHTML = `
        <input type="checkbox" id="${key}-${option.value}" value="${option.value}">
        <label for="${key}-${option.value}">${option.label} <span class="text-muted">(${option.count})</span></label>
    `;

        // Event listener dla checkboxu
        const checkbox = optionElement.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', (e) => {
            this.handleMultiSelectOptionChange(key, option.value, e.target.checked);
        });

        return optionElement;
    }

    /**
     * Mock danych dla filtrów - będzie zastąpione API w kolejnych krokach
     */
    async getMockFilterOptions(key) {
        // Symulacja API delay
        await new Promise(resolve => setTimeout(resolve, 500));

        const mockData = {
            'wood-species': [
                { value: 'dab', label: 'Dąb', count: 45 },
                { value: 'jesion', label: 'Jesion', count: 32 },
                { value: 'buk', label: 'Buk', count: 28 },
                { value: 'sosna', label: 'Sosna', count: 15 },
                { value: 'klon', label: 'Klon', count: 12 }
            ],
            'technologies': [
                { value: 'lity', label: 'Lity', count: 78 },
                { value: 'mikrowczep', label: 'Mikrowczep', count: 56 },
                { value: 'klejony', label: 'Klejony', count: 34 }
            ],
            'wood-classes': [
                { value: 'aa', label: 'A/A', count: 89 },
                { value: 'ab', label: 'A/B', count: 67 },
                { value: 'bb', label: 'B/B', count: 23 }
            ],
            'thicknesses': [
                { value: '4cm', label: '4cm', count: 45 },
                { value: '6cm', label: '6cm', count: 67 },
                { value: '8cm', label: '8cm', count: 34 },
                { value: '10cm', label: '10cm', count: 28 }
            ],
            'statuses': [
                { value: 'czeka_na_wyciecie', label: 'Czeka na wycięcie', count: 45 },
                { value: 'w_trakcie_ciecia', label: 'W trakcie cięcia', count: 23 },
                { value: 'czeka_na_skladanie', label: 'Czeka na składanie', count: 34 },
                { value: 'w_trakcie_skladania', label: 'W trakcie składania', count: 12 },
                { value: 'czeka_na_pakowanie', label: 'Czeka na pakowanie', count: 18 },
                { value: 'spakowane', label: 'Spakowane', count: 56 }
            ]
        };

        return mockData[key] || [];
    }

    /**
     * Renderuje opcje w dropdown
     */
    renderMultiSelectOptions(key, options) {
        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect) return;

        const optionsContainer = multiSelect.element.querySelector('.multi-select-options');

        // Wyczyść istniejące opcje (oprócz "no-options")
        const existingOptions = optionsContainer.querySelectorAll('.multi-select-option');
        existingOptions.forEach(option => option.remove());

        // Dodaj nowe opcje
        options.forEach(option => {
            const optionElement = this.createMultiSelectOption(key, option);
            optionsContainer.insertBefore(optionElement, optionsContainer.querySelector('.no-options'));
        });
    }

    /**
     * Tworzy pojedynczą opcję dropdown
     */
    createMultiSelectOption(key, option) {
        const optionElement = document.createElement('div');
        optionElement.className = 'multi-select-option';
        optionElement.setAttribute('data-value', option.value);
        optionElement.setAttribute('role', 'option');

        optionElement.innerHTML = `
        <label class="option-label">
            <input type="checkbox" value="${option.value}">
            <div class="option-content">
                <div class="option-text">${option.label}</div>
                <div class="option-count">(${option.count})</div>
            </div>
        </label>
    `;

        // Event listener dla checkboxu
        const checkbox = optionElement.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', (e) => {
            this.handleMultiSelectOptionChange(key, option.value, e.target.checked);
        });

        return optionElement;
    }

    /**
     * Obsługuje zmianę zaznaczenia opcji
     */
    handleMultiSelectOptionChange(key, value, isChecked) {
        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect) return;

        if (isChecked) {
            multiSelect.selectedOptions.add(value);
        } else {
            multiSelect.selectedOptions.delete(value);
        }

        this.updateMultiSelectDisplay(key);
        this.triggerFilterUpdate(key);
    }

    /**
     * Pokazuje/ukrywa loading indicator
     */
    showMultiSelectLoading(key, show) {
        const multiSelect = this.components.multiSelects && this.components.multiSelects[key];
        if (!multiSelect) return;

        // Dodaj/usuń loading text w opcjach
        const optionsContainer = multiSelect.dropdownElement.querySelector('.multi-select-options');
        if (!optionsContainer) return;

        let loadingElement = optionsContainer.querySelector('.loading-options');

        if (show && !loadingElement) {
            loadingElement = document.createElement('div');
            loadingElement.className = 'loading-options text-center p-2 text-muted';
            loadingElement.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Ładowanie opcji...';
            optionsContainer.appendChild(loadingElement);
        } else if (!show && loadingElement) {
            loadingElement.remove();
        }
    }

    /**
     * Pokazuje błąd w dropdown
     */
    showMultiSelectError(key, message) {
        console.error(`[ProductsModule] Multi-select error for ${key}:`, message);

        if (this.shared && this.shared.toastSystem) {
            this.shared.toastSystem.show(`Błąd filtra ${key}: ${message}`, 'error');
        }
    }

    /**
     * Wywołuje aktualizację filtrów
     */
    triggerFilterUpdate(key) {
        console.log(`[ProductsModule] Filter update triggered for: ${key}`);

        // Aktualizuj stan filtrów
        const multiSelect = this.components.multiSelects[key];
        const filterKey = this.multiSelectConfig.dropdowns[key].filterKey;

        this.state.currentFilters[filterKey] = Array.from(multiSelect.selectedOptions);

        // NOWE: Aktualizuj badges po zmianie filtrów
        this.updateFilterBadges();

        // W kolejnych krokach - przefiltruj produkty
        // this.applyAllFilters();
    }

    // ========================================================================
    // MULTI-SELECT CLEANUP HELPERS
    // ========================================================================

    /**
     * Czyści event listeners dla pojedynczego multi-select
     */
    cleanupMultiSelectEvents(key) {
        console.log(`[ProductsModule] Cleaning up multi-select events for: ${key}`);

        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect || !multiSelect.element) return;

        // Zamknij dropdown jeśli otwarty
        if (multiSelect.isOpen) {
            this.closeMultiSelectDropdown(key);
        }

        // Usuń referencje do event handlerów
        const checkboxes = multiSelect.element.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.removeEventListener('change', this.handleMultiSelectOptionChange);
        });

        console.log(`[ProductsModule] Multi-select events cleaned up for: ${key}`);
    }

    /**
     * Niszczy komponent multi-select
     */
    destroyMultiSelectComponent(key) {
        console.log(`[ProductsModule] Destroying multi-select component: ${key}`);

        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect) return;

        // Cleanup events
        this.cleanupMultiSelectEvents(key);

        // Usuń element z DOM
        if (multiSelect.element && multiSelect.element.parentNode) {
            multiSelect.element.parentNode.removeChild(multiSelect.element);
        }

        // Wyczyść dane
        if (multiSelect.selectedOptions) {
            multiSelect.selectedOptions.clear();
        }

        // Usuń referencję
        delete this.components.multiSelects[key];

        console.log(`[ProductsModule] Multi-select component destroyed: ${key}`);
    }

    /**
     * Pobiera aktualnie wybrane wartości dla wszystkich filtrów
     */
    getAllSelectedFilters() {
        const filters = {};

        if (!this.components.multiSelects) return filters;

        Object.entries(this.components.multiSelects).forEach(([key, multiSelect]) => {
            const config = this.multiSelectConfig.dropdowns[key];
            if (config) {
                filters[config.filterKey] = Array.from(multiSelect.selectedOptions);
            }
        });

        return filters;
    }

    /**
     * Resetuje wszystkie multi-select filtry
     */
    resetAllMultiSelectFilters() {
        console.log('[ProductsModule] Resetting all multi-select filters');

        if (!this.components.multiSelects) return;

        Object.keys(this.components.multiSelects).forEach(key => {
            this.clearAllMultiSelectOptions(key);
        });
    }

    /**
     * Ustawia wartości filtrów (np. z localStorage)
     */
    setMultiSelectFilters(filtersData) {
        console.log('[ProductsModule] Setting multi-select filters:', filtersData);

        if (!this.components.multiSelects || !filtersData) return;

        Object.entries(this.multiSelectConfig.dropdowns).forEach(([key, config]) => {
            const filterKey = config.filterKey;
            const values = filtersData[filterKey];

            if (values && Array.isArray(values) && values.length > 0) {
                this.setMultiSelectSelection(key, values);
            }
        });
    }

    /**
     * Ustawia zaznaczenie dla konkretnego multi-select
     */
    setMultiSelectSelection(key, values) {
        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect || !values) return;

        // Wyczyść obecne zaznaczenia
        multiSelect.selectedOptions.clear();

        // Odznacz wszystkie checkboxy
        const checkboxes = multiSelect.element.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => checkbox.checked = false);

        // Zaznacz nowe wartości
        values.forEach(value => {
            const checkbox = multiSelect.element.querySelector(`input[type="checkbox"][value="${value}"]`);
            if (checkbox) {
                checkbox.checked = true;
                multiSelect.selectedOptions.add(value);
            }
        });

        // Aktualizuj wyświetlanie
        this.updateMultiSelectDisplay(key);
    }

    // ========================================================================
    // SYSTEM BADGES FILTRÓW - KROK 3.3
    // ========================================================================

    getMultiSelectOptionLabel(key, value) {
        const ms = this.components.multiSelects?.[key];
        if (!ms) return String(value);

        // 1) Spróbuj z DOM (najbardziej aktualne)
        const optEl = ms.dropdownElement.querySelector(`.multi-select-option[data-value="${CSS.escape(value)}"] label`);
        if (optEl) {
            // label może zawierać liczbę (count) – oczyść z nawiasu
            const raw = (optEl.textContent || '').trim();
            const cleaned = raw.replace(/\s*\(\d+\)\s*$/, '').trim();
            if (cleaned) return cleaned;
        }

        // 2) Fallback do config.options
        const cfgOpt = this.multiSelectConfig
            ?.dropdowns?.[key]?.options?.find(o => String(o.value) === String(value));
        if (cfgOpt?.label) return cfgOpt.label;

        return String(value);
    }

    /**
     * Konfiguruje system badges dla aktywnych filtrów
     */
    setupFilterBadges() {
        console.log('[ProductsModule] Setting up filter badges system...');

        try {
            // Znajdź kontenery badges
            this.badgesConfig = {
                container: document.getElementById('active-filters-container'),
                badgesWrapper: document.getElementById('filter-badges'),
                clearAllButton: document.getElementById('clear-all-filters')
            };

            // Sprawdź czy wszystkie elementy istnieją
            if (!this.badgesConfig.container) {
                console.warn('[ProductsModule] Active filters container not found');
                return false;
            }

            if (!this.badgesConfig.badgesWrapper) {
                console.warn('[ProductsModule] Filter badges wrapper not found');
                return false;
            }

            // Setup event listeners
            if (this.badgesConfig.clearAllButton) {
                this.badgesConfig.clearAllButton.addEventListener('click', this.clearAllFilters.bind(this));
            }

            // Ukryj kontener na start (nie ma aktywnych filtrów)
            this.badgesConfig.container.style.display = 'none';

            console.log('[ProductsModule] Filter badges system setup completed');
            return true;

        } catch (error) {
            console.error('[ProductsModule] Failed to setup filter badges system:', error);
            return false;
        }
    }

    /**
     * Aktualizuje badges na podstawie aktywnych filtrów
     */
    updateFilterBadges() {
        if (!this.badgesConfig || !this.badgesConfig.badgesWrapper) return;

        console.log('[ProductsModule] Updating filter badges...');

        // Wyczyść istniejące badge
        this.badgesConfig.badgesWrapper.innerHTML = '';

        const activeBadges = [];

        // --- A) Badge dla text search (bez zmian) ---
        if (this.state.currentFilters.textSearch?.trim()) {
            activeBadges.push({
                type: 'text-search',
                label: 'Wyszukiwanie',
                value: this.state.currentFilters.textSearch.trim(),
                removable: true
            });
        }

        // --- B) Badge dla multi-selectów: 1 badge = 1 zaznaczona opcja ---
        if (this.components.multiSelects) {
            Object.entries(this.multiSelectConfig.dropdowns).forEach(([key, config]) => {
                const ms = this.components.multiSelects[key];
                if (!ms || ms.selectedOptions.size === 0) return;

                const groupLabel = this.getFilterDisplayName(config.filterKey);

                ms.selectedOptions.forEach(val => {
                    const optionLabel = this.getMultiSelectOptionLabel(key, val);

                    activeBadges.push({
                        type: 'multi-select',
                        filterKey: config.filterKey,  // np. "woodClasses"
                        label: groupLabel,            // np. "Klasa drewna"
                        value: optionLabel,           // np. "A/B"
                        removable: true,
                        multiSelectKey: key,          // np. "wood-classes"
                        singleValue: String(val)      // ważne dla remove
                    });
                });
            });
        }

        // Render
        activeBadges.forEach(b => {
            const el = this.createFilterBadge(b);
            this.badgesConfig.badgesWrapper.appendChild(el);
        });

        // Pokaż/ukryj kontener + animacja
        if (activeBadges.length > 0) {
            this.badgesConfig.container.style.display = 'flex';
            this.animateFilterBadgesIn();
        } else {
            this.badgesConfig.container.style.display = 'none';
        }

        console.log(`[ProductsModule] Updated filter badges: ${activeBadges.length} active`);
    }

    /**
     * Tworzy pojedynczy badge filtra
     */
    createFilterBadge(badgeData) {
        const badge = document.createElement('div');
        badge.className = 'filter-badge';
        badge.setAttribute('data-type', badgeData.type);
        badge.setAttribute('data-filter-key', badgeData.filterKey || '');

        badge.innerHTML = `
        <div class="badge-content">
            <span class="badge-label"><strong>${badgeData.label}:</strong></span>
            <span class="badge-value">${badgeData.value}</span>
        </div>
        ${badgeData.removable ? '<button class="badge-remove" type="button" style="background: none; border: none; color: white; margin-left: 6px;"><i class="fas fa-times"></i></button>' : ''}
    `;

        // Event listener dla usuwania
        if (badgeData.removable) {
            const removeButton = badge.querySelector('.badge-remove');
            removeButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeFilterBadge(badgeData);
            });
        }

        // Event listener dla kliknięcia w badge (opcjonalnie - otwarcie filtra)
        badge.addEventListener('click', () => {
            this.handleFilterBadgeClick(badgeData);
        });

        return badge;
    }

    /**
     * Pobiera ikonę dla badge w zależności od typu filtra
     */
    getFilterBadgeIcon(type, filterKey) {
        if (type === 'text-search') {
            return 'fas fa-search';
        }

        const iconMap = {
            'woodSpecies': 'fas fa-tree',
            'technologies': 'fas fa-cogs',
            'woodClasses': 'fas fa-layer-group',
            'thicknesses': 'fas fa-ruler',
            'statuses': 'fas fa-flag'
        };

        return iconMap[filterKey] || 'fas fa-filter';
    }

    /**
     * Pobiera przyjazną nazwę dla filtra
     */
    getFilterDisplayName(filterKey) {
        const nameMap = {
            'woodSpecies': 'Gatunek drewna',
            'technologies': 'Technologia',
            'woodClasses': 'Klasa drewna',
            'thicknesses': 'Grubość',
            'statuses': 'Status'
        };

        return nameMap[filterKey] || filterKey;
    }

    /**
     * Usuwa pojedynczy badge filtra
     */
    removeFilterBadge(badgeData) {
        console.log('[ProductsModule] Removing filter badge:', badgeData);

        if (badgeData.type === 'text-search') {
            // Wyczyść text search
            this.clearTextSearch();
        } else if (badgeData.type === 'multi-select') {
            // Wyczyść multi-select filter
            if (badgeData.singleValue) {
                // Usuń pojedynczą wartość
                this.removeMultiSelectValue(badgeData.multiSelectKey, badgeData.singleValue);
            } else if (badgeData.multipleValues) {
                // Wyczyść wszystkie wartości
                this.clearAllMultiSelectOptions(badgeData.multiSelectKey);
            }
        }

        // Animacja usuwania badge
        this.animateFilterBadgeOut(badgeData);
    }

    /**
     * Usuwa pojedynczą wartość z multi-select
     */
    removeMultiSelectValue(multiSelectKey, value) {
        const multiSelect = this.components.multiSelects && this.components.multiSelects[multiSelectKey];
        if (!multiSelect) return;

        // Usuń z selected options
        multiSelect.selectedOptions.delete(value);

        // Odznacz checkbox
        const checkbox = multiSelect.dropdownElement.querySelector(`input[value="${value}"]`);
        if (checkbox) {
            checkbox.checked = false;
        }

        // Aktualizuj wyświetlanie
        this.updateMultiSelectDisplay(multiSelectKey);

        // Wywołaj update filtrów
        this.triggerFilterUpdate(multiSelectKey);
    }

    /**
     * Obsługuje kliknięcie w badge (otwiera odpowiedni filtr)
     */
    handleFilterBadgeClick(badgeData) {
        console.log('[ProductsModule] Filter badge clicked:', badgeData);

        if (badgeData.type === 'text-search') {
            // Focus na text search
            const textSearchInput = document.getElementById('products-text-search');
            if (textSearchInput) {
                textSearchInput.focus();
                textSearchInput.select();
            }
        } else if (badgeData.type === 'multi-select') {
            // Otwórz odpowiedni multi-select dropdown
            this.openMultiSelectDropdown(badgeData.multiSelectKey);
        }
    }

    /**
     * Czyści wszystkie filtry
     */
    clearAllFilters() {
        console.log('[ProductsModule] Clearing all filters...');

        // Wyczyść text search
        this.clearTextSearch();

        // Wyczyść wszystkie multi-select filtry
        if (this.components.multiSelects) {
            Object.keys(this.components.multiSelects).forEach(key => {
                this.clearAllMultiSelectOptions(key);
            });
        }

        // Animacja usuwania wszystkich badges
        this.animateAllFilterBadgesOut();

        // Wywołaj ogólny refresh filtrów
        this.applyAllFilters();
    }

    /**
     * Animuje pojawianie się badges
     */
    animateFilterBadgesIn() {
        if (!this.badgesConfig.badgesWrapper) return;

        const badges = this.badgesConfig.badgesWrapper.querySelectorAll('.filter-badge');
        badges.forEach((badge, index) => {
            badge.style.opacity = '0';
            badge.style.transform = 'translateY(-10px)';

            setTimeout(() => {
                badge.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                badge.style.opacity = '1';
                badge.style.transform = 'translateY(0)';
            }, index * 50); // Staggered animation
        });
    }

    /**
     * Animuje znikanie pojedynczego badge
     */
    animateFilterBadgeOut(badgeData) {
        const badge = document.querySelector(`[data-type="${badgeData.type}"][data-filter-key="${badgeData.filterKey || ''}"]`);
        if (!badge) return;

        badge.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        badge.style.opacity = '0';
        badge.style.transform = 'translateX(10px)';

        setTimeout(() => {
            this.updateFilterBadges(); // Przebuduj wszystkie badges
        }, 300);
    }

    /**
     * Animuje znikanie wszystkich badges
     */
    animateAllFilterBadgesOut() {
        if (!this.badgesConfig.badgesWrapper) return;

        const badges = this.badgesConfig.badgesWrapper.querySelectorAll('.filter-badge');
        badges.forEach((badge, index) => {
            setTimeout(() => {
                badge.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                badge.style.opacity = '0';
                badge.style.transform = 'scale(0.8)';
            }, index * 30);
        });

        setTimeout(() => {
            this.updateFilterBadges(); // Przebuduj badges po animacji
        }, badges.length * 30 + 200);
    }

    /**
     * Aktualizuje badges po zmianie filtrów
     */
    onFiltersChanged() {
        // Ta metoda będzie wywołana z innych części systemu filtrów
        this.updateFilterBadges();

        // W kolejnych krokach - zastosuj filtry do produktów
        // this.applyAllFilters();
    }

    /**
     * Metoda placeholder dla stosowania filtrów - implementacja w kolejnych krokach
     */
    applyAllFilters() {
        console.log('[ProductsModule] Applying all filters - placeholder for next steps');

        // TODO: W kolejnych krokach implementujemy:
        // - Zbieranie wszystkich aktywnych filtrów
        // - Filtrowanie produktów
        // - Aktualizacja virtual scroll list
        // - Aktualizacja statystyk
    }

    // ========================================================================
    // VIRTUAL SCROLLING
    // ========================================================================

    /**
     * Inicjalizuje system virtual scrolling
     */
    initializeVirtualScrolling() {
        console.log('[ProductsModule] Initializing virtual scrolling...');

        try {
            // Znajdź elementy DOM
            this.virtualScrollElements = {
                container: document.getElementById('virtual-scroll-container'),
                spacerTop: document.getElementById('virtual-scroll-spacer-top'),
                viewport: document.getElementById('virtual-scroll-viewport'),
                spacerBottom: document.getElementById('virtual-scroll-spacer-bottom'),
                header: document.querySelector('.products-list-header')
            };

            // Sprawdź czy wszystkie elementy istnieją
            if (!this.validateVirtualScrollElements()) {
                return false;
            }

            // Konfiguracja virtual scroll
            this.virtualScrollConfig = {
                rowHeight: 65,           // Wysokość pojedynczego wiersza w px
                visibleBuffer: 5,        // Dodatkowe wiersze renderowane poza viewport
                scrollThrottle: 16,      // Throttling scroll events (60fps)
                recycleRows: true,       // Czy recyklować elementy DOM
                estimatedTotalRows: 0,   // Liczba wszystkich produktów
                maxRenderedRows: 50      // Maksymalna liczba renderowanych wierszy jednocześnie
            };

            // Stan virtual scroll
            this.virtualScrollState = {
                scrollTop: 0,
                startIndex: 0,
                endIndex: 0,
                renderedRows: new Map(),     // Map<index, DOMElement>
                recycledRows: [],            // Pool elementów do recyklingu
                isScrolling: false,
                scrollTimeout: null,
                lastScrollTime: 0
            };

            // Inicjalizuj virtual scroll component
            this.components.virtualScroll = new VirtualScrollList(this);

            // Setup event listeners
            this.setupVirtualScrollEvents();

            // Początkowe renderowanie
            this.refreshVirtualScrollData();

            console.log('[ProductsModule] Virtual scrolling initialized successfully');
            return true;

        } catch (error) {
            console.error('[ProductsModule] Failed to initialize virtual scrolling:', error);
            return false;
        }
    }

    /**
     * Waliduje czy wszystkie elementy DOM do virtual scroll istnieją
     */
    validateVirtualScrollElements() {
        const missing = [];
        
        Object.entries(this.virtualScrollElements).forEach(([key, element]) => {
            if (!element) {
                missing.push(key);
            }
        });

        if (missing.length > 0) {
            console.error('[ProductsModule] Missing virtual scroll elements:', missing);
            return false;
        }

        return true;
    }

    /**
     * Konfiguruje event listeners dla virtual scrolling
     */
    setupVirtualScrollEvents() {
        const container = this.virtualScrollElements.container;
        
        // Throttled scroll handler
        const throttledScrollHandler = this.throttle(
            this.handleVirtualScrollEvent.bind(this), 
            this.virtualScrollConfig.scrollThrottle
        );

        container.addEventListener('scroll', throttledScrollHandler, { passive: true });

        // Resize observer dla responsywności
        this.virtualScrollResizeObserver = new ResizeObserver(() => {
            this.recalculateVirtualScrollDimensions();
        });
        this.virtualScrollResizeObserver.observe(container);

        console.log('[ProductsModule] Virtual scroll events setup complete');
    }

    /**
     * Obsługuje zdarzenia scroll
     */
    handleVirtualScrollEvent(event) {
        const container = this.virtualScrollElements.container;
        const scrollTop = container.scrollTop;
        
        // Aktualizuj stan
        this.virtualScrollState.scrollTop = scrollTop;
        this.virtualScrollState.isScrolling = true;
        this.virtualScrollState.lastScrollTime = Date.now();

        // Oblicz nowe indeksy
        this.calculateVisibleRange();

        // Renderuj widoczne wiersze
        this.renderVisibleRows();

        // Reset scrolling state po pewnym czasie
        clearTimeout(this.virtualScrollState.scrollTimeout);
        this.virtualScrollState.scrollTimeout = setTimeout(() => {
            this.virtualScrollState.isScrolling = false;
        }, 150);
    }

    /**
     * Oblicza zakres widocznych wierszy
     */
    calculateVisibleRange() {
        const { scrollTop } = this.virtualScrollState;
        const { rowHeight, visibleBuffer } = this.virtualScrollConfig;
        const containerHeight = this.virtualScrollElements.container.clientHeight;
        
        // Oblicz widoczne wiersze
        const startIndex = Math.floor(scrollTop / rowHeight);
        const visibleRowCount = Math.ceil(containerHeight / rowHeight);
        const endIndex = startIndex + visibleRowCount;

        // Dodaj buffer
        const bufferedStartIndex = Math.max(0, startIndex - visibleBuffer);
        const bufferedEndIndex = Math.min(
            this.getFilteredProductsCount() - 1, 
            endIndex + visibleBuffer
        );

        // Aktualizuj stan
        this.virtualScrollState.startIndex = bufferedStartIndex;
        this.virtualScrollState.endIndex = bufferedEndIndex;

        console.debug(`[VirtualScroll] Range: ${bufferedStartIndex}-${bufferedEndIndex} (${bufferedEndIndex - bufferedStartIndex + 1} rows)`);
    }

    /**
     * Renderuje widoczne wiersze produktów
     */
    renderVisibleRows() {
        const { startIndex, endIndex } = this.virtualScrollState;
        const filteredProducts = this.getFilteredProducts();

        if (!filteredProducts || filteredProducts.length === 0) {
            this.showEmptyState();
            return;
        }

        // Ukryj empty state
        this.hideEmptyState();

        // Usuń wiersze które nie są już widoczne
        this.removeInvisibleRows(startIndex, endIndex);

        // Renderuj nowe widoczne wiersze
        for (let index = startIndex; index <= endIndex; index++) {
            if (index >= filteredProducts.length) break;
            
            const product = filteredProducts[index];
            if (!product) continue;

            let rowElement = this.virtualScrollState.renderedRows.get(index);
            
            if (!rowElement) {
                // Stwórz nowy wiersz (lub użyj z recyklingu)
                rowElement = this.createOrRecycleProductRow(index, product);
                this.virtualScrollState.renderedRows.set(index, rowElement);
            } else {
                // Aktualizuj istniejący wiersz
                this.updateProductRow(rowElement, index, product);
            }
        }

        // Aktualizuj spacers
        this.updateVirtualScrollSpacers();
    }

    /**
     * Usuwa wiersze które nie są już widoczne
     */
    removeInvisibleRows(startIndex, endIndex) {
        const toRemove = [];
        
        this.virtualScrollState.renderedRows.forEach((rowElement, index) => {
            if (index < startIndex || index > endIndex) {
                toRemove.push(index);
            }
        });

        toRemove.forEach(index => {
            const rowElement = this.virtualScrollState.renderedRows.get(index);
            if (rowElement) {
                this.recycleProductRow(rowElement);
                this.virtualScrollState.renderedRows.delete(index);
            }
        });
    }

    /**
     * Tworzy nowy wiersz produktu lub używa z recyklingu
     */
    createOrRecycleProductRow(index, product) {
        let rowElement;

        // Spróbuj użyć z recyklingu
        if (this.virtualScrollConfig.recycleRows && this.virtualScrollState.recycledRows.length > 0) {
            rowElement = this.virtualScrollState.recycledRows.pop();
            console.debug('[VirtualScroll] Recycled row for index:', index);
        } else {
            // Stwórz nowy element
            rowElement = this.createProductRowElement(index, product);
            console.debug('[VirtualScroll] Created new row for index:', index);
        }

        // Aktualizuj dane wiersza
        this.updateProductRow(rowElement, index, product);
        
        // Ustaw pozycję
        this.positionProductRow(rowElement, index);
        
        // Dodaj do viewport
        this.virtualScrollElements.viewport.appendChild(rowElement);
        
        return rowElement;
    }

    /**
     * Tworzy nowy element DOM wiersza produktu
     */
    createProductRowElement(index, product) {
        const template = document.getElementById('product-row-template');
        if (!template) {
            throw new Error('Product row template not found');
        }

        const clone = template.content.cloneNode(true);
        const rowElement = clone.querySelector('.product-row');
        
        // Dodaj unikalną klasę dla identyfikacji
        rowElement.classList.add('virtual-row');
        rowElement.setAttribute('data-virtual-index', index);
        
        return rowElement;
    }

    /**
     * Aktualizuje dane w wierszu produktu
     */
    updateProductRow(rowElement, index, product) {
        const uniqueId = this.getProductUniqueId(product);
        
        // Aktualizuj atrybuty wiersza
        rowElement.setAttribute('data-product-id', uniqueId);
        rowElement.setAttribute('data-virtual-index', index);
        rowElement.setAttribute('data-priority', product.priority_score || 0);
        rowElement.setAttribute('data-status', product.current_status || '');

        // Checkbox - KLUCZOWE: synchronizacja z centralnym state
        const checkbox = rowElement.querySelector('.product-checkbox');
        if (checkbox) {
            checkbox.checked = this.state.selectedProducts.has(uniqueId);
            checkbox.value = uniqueId;
            
            // Remove old listeners i dodaj nowy
            checkbox.replaceWith(checkbox.cloneNode(true));
            const newCheckbox = rowElement.querySelector('.product-checkbox');
            newCheckbox.checked = this.state.selectedProducts.has(uniqueId);
            newCheckbox.value = uniqueId;
            
            newCheckbox.addEventListener('change', (e) => {
                this.handleProductSelection(uniqueId, e.target.checked);
            });
        }

        // Wypełnij dane produktu
        this.populateProductRowData(rowElement, product);
        
        // Color coding
        this.applyProductRowColorCoding(rowElement, product);
    }

    /**
     * Wypełnia dane produktu w wierszu
     */
    populateProductRowData(rowElement, product) {
        // ID produktu
        const idMain = rowElement.querySelector('.product-id-main');
        const idSub = rowElement.querySelector('.product-id-sub');
        if (idMain) idMain.textContent = product.short_product_id || product.id || '-';
        if (idSub) idSub.textContent = product.baselinker_id ? `BL: ${product.baselinker_id}` : '';

        // Nazwa i specyfikacja
        const nameEl = rowElement.querySelector('.product-name');
        const specsEl = rowElement.querySelector('.product-specs');
        if (nameEl) nameEl.textContent = product.original_product_name || product.product_name || '-';
        if (specsEl) {
            specsEl.innerHTML = this.buildProductSpecsHTML(product);
        }

        // Objętość
        const volumeEl = rowElement.querySelector('.product-volume-cell');
        if (volumeEl) {
            volumeEl.textContent = product.volume_m3 ? `${parseFloat(product.volume_m3).toFixed(3)} m³` : '-';
        }

        // Wartość
        const valueEl = rowElement.querySelector('.product-value-cell');
        if (valueEl) {
            const value = parseFloat(product.total_value_net || 0);
            valueEl.textContent = value > 0 ? `${value.toLocaleString()} zł` : '-';
        }

        // Status
        const statusEl = rowElement.querySelector('.status-badge');
        if (statusEl) {
            statusEl.textContent = this.getStatusDisplayName(product.current_status);
            statusEl.className = `status-badge ${this.getStatusClass(product.current_status)}`;
        }

        // Deadline
        const deadlineEl = rowElement.querySelector('.deadline-badge');
        const deadlineDateEl = rowElement.querySelector('.deadline-date');
        if (deadlineEl && deadlineDateEl) {
            this.updateDeadlineDisplay(deadlineEl, deadlineDateEl, product);
        }

        // Priorytet
        const priorityEl = rowElement.querySelector('.priority-score');
        const priorityFillEl = rowElement.querySelector('.priority-fill');
        if (priorityEl) {
            const priority = parseInt(product.priority_score || 0);
            priorityEl.textContent = priority;
            priorityEl.className = `priority-score ${this.getPriorityClass(priority)}`;
            
            if (priorityFillEl) {
                priorityFillEl.style.width = `${Math.min(priority, 200) / 2}%`;
            }
        }

        // Przyciski akcji
        this.setupProductRowActions(rowElement, product);
    }

    /**
     * Buduje HTML specyfikacji produktu
     */
    buildProductSpecsHTML(product) {
        const specs = [];
        
        if (product.wood_species) specs.push(`<span class="spec-wood">${product.wood_species}</span>`);
        if (product.technology) specs.push(`<span class="spec-tech">${product.technology}</span>`);
        if (product.wood_class) specs.push(`<span class="spec-class">${product.wood_class}</span>`);
        if (product.thickness) specs.push(`<span class="spec-thickness">${product.thickness}cm</span>`);
        
        return specs.join(' • ');
    }

    /**
     * Stosuje color coding do wiersza produktu
     */
    applyProductRowColorCoding(rowElement, product) {
        // Usuń poprzednie klasy
        rowElement.classList.remove('urgent-product', 'warning-product', 'normal-product');
        
        // Dodaj klasę na podstawie deadline
        const urgencyClass = this.calculateProductUrgency(product);
        if (urgencyClass) {
            rowElement.classList.add(urgencyClass);
        }
        
        // Dodaj klasę na podstawie priorytetu
        const priority = parseInt(product.priority_score || 0);
        if (priority > 150) {
            rowElement.classList.add('high-priority');
        } else if (priority < 50) {
            rowElement.classList.add('low-priority');
        }
    }

    /**
     * Konfiguruje akcje w wierszu produktu
     */
    setupProductRowActions(rowElement, product) {
        const uniqueId = this.getProductUniqueId(product);
        
        // Przycisk szczegółów
        const detailsBtn = rowElement.querySelector('.product-details-btn');
        if (detailsBtn) {
            detailsBtn.replaceWith(detailsBtn.cloneNode(true));
            const newDetailsBtn = rowElement.querySelector('.product-details-btn');
            newDetailsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showProductDetails(uniqueId);
            });
        }

        // Link do Baselinker
        const baselinkerBtn = rowElement.querySelector('.baselinker-btn');
        if (baselinkerBtn && product.baselinker_id) {
            baselinkerBtn.href = `https://panel.baselinker.com/orders.php?action=details&id=${product.baselinker_id}`;
        }

        // Dropdown menu akcji
        this.setupProductRowDropdownActions(rowElement, uniqueId);
    }

    /**
     * Konfiguruje dropdown akcji w wierszu
     */
    setupProductRowDropdownActions(rowElement, uniqueId) {
        const editPriorityBtn = rowElement.querySelector('.edit-priority-item');
        const changeStatusBtn = rowElement.querySelector('.change-status-item');
        const deleteBtn = rowElement.querySelector('.delete-product-item');

        if (editPriorityBtn) {
            editPriorityBtn.replaceWith(editPriorityBtn.cloneNode(true));
            const newEditBtn = rowElement.querySelector('.edit-priority-item');
            newEditBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.showEditPriorityModal(uniqueId);
            });
        }

        if (changeStatusBtn) {
            changeStatusBtn.replaceWith(changeStatusBtn.cloneNode(true));
            const newStatusBtn = rowElement.querySelector('.change-status-item');
            newStatusBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.showChangeStatusModal(uniqueId);
            });
        }

        if (deleteBtn) {
            deleteBtn.replaceWith(deleteBtn.cloneNode(true));
            const newDeleteBtn = rowElement.querySelector('.delete-product-item');
            newDeleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.confirmDeleteProduct(uniqueId);
            });
        }
    }

    /**
     * Ustawia pozycję wiersza produktu
     */
    positionProductRow(rowElement, index) {
        const top = index * this.virtualScrollConfig.rowHeight;
        rowElement.style.position = 'absolute';
        rowElement.style.top = `${top}px`;
        rowElement.style.width = '100%';
        rowElement.style.height = `${this.virtualScrollConfig.rowHeight}px`;
    }

    /**
     * Dodaje wiersz do recyklingu
     */
    recycleProductRow(rowElement) {
        if (this.virtualScrollConfig.recycleRows) {
            // Wyczyść event listenery poprzez klonowanie
            const cleanElement = rowElement.cloneNode(true);
            rowElement.parentNode.replaceChild(cleanElement, rowElement);
            
            // Dodaj do pool recyklingu
            this.virtualScrollState.recycledRows.push(cleanElement);
            cleanElement.remove(); // Usuń z DOM ale zachowaj w pool
            
            console.debug('[VirtualScroll] Recycled row element');
        } else {
            rowElement.remove();
        }
    }

    /**
     * Aktualizuje spacers (górny i dolny)
     */
    updateVirtualScrollSpacers() {
        const { startIndex, endIndex } = this.virtualScrollState;
        const { rowHeight } = this.virtualScrollConfig;
        const totalRows = this.getFilteredProductsCount();
        
        // Spacer górny
        const topHeight = startIndex * rowHeight;
        this.virtualScrollElements.spacerTop.style.height = `${topHeight}px`;
        
        // Spacer dolny
        const bottomHeight = Math.max(0, (totalRows - endIndex - 1) * rowHeight);
        this.virtualScrollElements.spacerBottom.style.height = `${bottomHeight}px`;
        
        console.debug(`[VirtualScroll] Spacers: top=${topHeight}px, bottom=${bottomHeight}px`);
    }

    /**
     * Przeliczywa wymiary virtual scroll
     */
    recalculateVirtualScrollDimensions() {
        console.log('[VirtualScroll] Recalculating dimensions...');
        
        // Przelicz visible range
        this.calculateVisibleRange();
        
        // Re-render widoczne wiersze
        this.renderVisibleRows();
    }

    /**
     * Odświeża dane virtual scroll
     */
    refreshVirtualScrollData() {
        console.log('[VirtualScroll] Refreshing virtual scroll data...');
        
        // Reset state
        this.virtualScrollState.startIndex = 0;
        this.virtualScrollState.endIndex = 0;
        this.virtualScrollState.scrollTop = 0;
        
        // Wyczyść renderowane wiersze
        this.clearRenderedRows();
        
        // Reset scroll position
        this.virtualScrollElements.container.scrollTop = 0;
        
        // Inicjalny render
        this.calculateVisibleRange();
        this.renderVisibleRows();
        
        // Aktualizuj licznik w nagłówku
        this.updateProductsCount();
    }

    /**
     * Czyści wszystkie renderowane wiersze
     */
    clearRenderedRows() {
        // Usuń z DOM
        this.virtualScrollElements.viewport.innerHTML = '';
        
        // Wyczyść state
        this.virtualScrollState.renderedRows.clear();
        this.virtualScrollState.recycledRows = [];
        
        console.log('[VirtualScroll] Cleared all rendered rows');
    }

    // NOWE FUNKCJE - WKLEJ PO SEKCJI "KONIEC SEKCJI VIRTUAL SCROLLING"

    // ========================================================================
    // PRODUCT ROW STRUCTURE - KROK 4.2
    // ========================================================================

    /**
     * Konfiguruje strukturę wiersza produktu z 12 kolumnami
     */
    setupProductRowStructure() {
        console.log('[ProductsModule] Setting up product row structure...');

        try {
            // Konfiguracja kolumn wiersza produktu
            this.productRowConfig = {
                columns: [
                    {
                        key: 'checkbox',
                        title: '',
                        width: '40px',
                        sortable: false,
                        className: 'product-checkbox-cell'
                    },
                    {
                        key: 'drag_handle',
                        title: '',
                        width: '30px',
                        sortable: false,
                        className: 'product-drag-cell'
                    },
                    {
                        key: 'priority_score',
                        title: 'Priorytet',
                        width: '90px',
                        sortable: true,
                        className: 'product-priority-cell'
                    },
                    {
                        key: 'short_product_id',
                        title: 'ID Produktu',
                        width: '120px',
                        sortable: true,
                        className: 'product-id-cell'
                    },
                    {
                        key: 'original_product_name',
                        title: 'Produkt',
                        width: '200px',
                        sortable: true,
                        className: 'product-info-cell'
                    },
                    {
                        key: 'volume_m3',
                        title: 'Objętość',
                        width: '90px',
                        sortable: true,
                        className: 'product-volume-cell'
                    },
                    {
                        key: 'total_value_net',
                        title: 'Wartość',
                        width: '100px',
                        sortable: true,
                        className: 'product-value-cell'
                    },
                    {
                        key: 'current_status',
                        title: 'Status',
                        width: '140px',
                        sortable: true,
                        className: 'product-status-cell'
                    },
                    {
                        key: 'deadline_date',
                        title: 'Deadline',
                        width: '110px',
                        sortable: true,
                        className: 'product-deadline-cell'
                    },
                    {
                        key: 'actions',
                        title: 'Akcje',
                        width: '120px',
                        sortable: false,
                        className: 'product-actions-cell'
                    }
                ]
            };

            // Mapowanie color coding dla różnych statusów i kategorii
            this.colorCodingConfig = {
                // Status badges
                status: {
                    'czeka_na_wyciecie': { class: 'status-waiting', color: '#ffc107', bg: '#fff3cd' },
                    'w_trakcie_ciecia': { class: 'status-cutting', color: '#fd7e14', bg: '#f8d7da' },
                    'czeka_na_skladanie': { class: 'status-waiting', color: '#6c757d', bg: '#f8f9fa' },
                    'w_trakcie_skladania': { class: 'status-assembly', color: '#007bff', bg: '#cce5ff' },
                    'czeka_na_pakowanie': { class: 'status-waiting', color: '#6c757d', bg: '#f8f9fa' },
                    'w_trakcie_pakowania': { class: 'status-packaging', color: '#28a745', bg: '#d4edda' },
                    'spakowane': { class: 'status-completed', color: '#28a745', bg: '#d4edda' },
                    'wstrzymane': { class: 'status-paused', color: '#ffc107', bg: '#fff3cd' },
                    'anulowane': { class: 'status-cancelled', color: '#dc3545', bg: '#f8d7da' }
                },
                
                // Priority levels
                priority: {
                    'critical': { class: 'priority-critical', threshold: 180, color: '#dc3545' },
                    'high': { class: 'priority-high', threshold: 140, color: '#fd7e14' },
                    'medium': { class: 'priority-medium', threshold: 80, color: '#ffc107' },
                    'low': { class: 'priority-low', threshold: 0, color: '#28a745' }
                },

                // Urgency indicators based on deadline
                urgency: {
                    'overdue': { class: 'urgent-product', days: -1, bg: '#ffebee', border: '#f44336' },
                    'urgent': { class: 'warning-product', days: 2, bg: '#fff3e0', border: '#ff9800' },
                    'warning': { class: 'caution-product', days: 7, bg: '#e8f5e8', border: '#4caf50' },
                    'normal': { class: 'normal-product', days: 999, bg: '#ffffff', border: '#e0e0e0' }
                },

                // Wood species colors
                woodSpecies: {
                    'dab': { class: 'wood-oak', color: '#8d6e63', label: 'Dąb' },
                    'jesion': { class: 'wood-ash', color: '#795548', label: 'Jesion' },
                    'buk': { class: 'wood-beech', color: '#6d4c41', label: 'Buk' },
                    'sosna': { class: 'wood-pine', color: '#4caf50', label: 'Sosna' },
                    'klon': { class: 'wood-maple', color: '#ffeb3b', label: 'Klon' }
                },

                // Technology types
                technology: {
                    'lity': { class: 'tech-solid', color: '#2e7d32', bg: '#e8f5e8', label: 'Lity' },
                    'mikrowczep': { class: 'tech-microchip', color: '#1565c0', bg: '#e3f2fd', label: 'Mikrowczep' },
                    'klejony': { class: 'tech-laminated', color: '#ef6c00', bg: '#fff3e0', label: 'Klejony' }
                }
            };

            // Setup sortowanie nagłówków kolumn
            this.setupColumnSorting();

            console.log('[ProductsModule] Product row structure setup completed');
            return true;

        } catch (error) {
            console.error('[ProductsModule] Failed to setup product row structure:', error);
            return false;
        }
    }

    /**
     * Poprawiona metoda renderowania specyfikacji produktu
     */
    buildProductSpecsHTML(product) {
        const specs = [];
        
        // Gatunek drewna z color coding
        if (product.wood_species) {
            const woodConfig = this.colorCodingConfig.woodSpecies[product.wood_species.toLowerCase()];
            const woodClass = woodConfig ? woodConfig.class : 'wood-default';
            const woodLabel = woodConfig ? woodConfig.label : product.wood_species;
            specs.push(`<span class="spec-badge ${woodClass}">${woodLabel}</span>`);
        }
        
        // Technologia z color coding
        if (product.technology) {
            const techConfig = this.colorCodingConfig.technology[product.technology.toLowerCase()];
            const techClass = techConfig ? techConfig.class : 'tech-default';
            const techLabel = techConfig ? techConfig.label : product.technology;
            specs.push(`<span class="spec-badge ${techClass}">${techLabel}</span>`);
        }
        
        // Klasa drewna
        if (product.wood_class) {
            specs.push(`<span class="spec-badge wood-class-${product.wood_class.toLowerCase().replace('/', '')}">${product.wood_class}</span>`);
        }
        
        // Grubość
        if (product.thickness) {
            specs.push(`<span class="spec-badge thickness">${product.thickness}cm</span>`);
        }
        
        return specs.join(' ');
    }

    /**
     * Poprawiona metoda color coding dla całego wiersza
     */
    applyProductRowColorCoding(rowElement, product) {
        // Usuń poprzednie klasy urgency
        rowElement.classList.remove('urgent-product', 'warning-product', 'caution-product', 'normal-product');
        
        // Usuń poprzednie klasy priority  
        rowElement.classList.remove('high-priority', 'low-priority', 'critical-priority');
        
        // Dodaj klasę urgency na podstawie deadline
        const urgencyClass = this.calculateProductUrgencyClass(product);
        if (urgencyClass) {
            rowElement.classList.add(urgencyClass);
        }
        
        // Dodaj klasę priority na podstawie score
        const priorityClass = this.calculateProductPriorityClass(product);
        if (priorityClass) {
            rowElement.classList.add(priorityClass);
        }
        
        // Ustaw custom CSS properties dla zaawansowanego stylowania
        const urgencyConfig = this.getUrgencyConfig(product);
        if (urgencyConfig) {
            rowElement.style.setProperty('--urgency-bg', urgencyConfig.bg);
            rowElement.style.setProperty('--urgency-border', urgencyConfig.border);
        }
    }

    /**
     * Oblicza klasę urgency produktu
     */
    calculateProductUrgencyClass(product) {
        const daysToDeadline = product.days_to_deadline;
        
        if (daysToDeadline === null || daysToDeadline === undefined) {
            return 'normal-product';
        }
        
        if (daysToDeadline < 0) return 'urgent-product';
        if (daysToDeadline <= 2) return 'warning-product';
        if (daysToDeadline <= 7) return 'caution-product';
        return 'normal-product';
    }

    /**
     * Oblicza klasę priority produktu
     */
    calculateProductPriorityClass(product) {
        const priority = parseInt(product.priority_score || 0);
        
        if (priority >= 180) return 'critical-priority';
        if (priority >= 140) return 'high-priority';
        if (priority <= 30) return 'low-priority';
        return null; // normal priority - bez dodatkowej klasy
    }

    /**
     * Pobiera konfigurację urgency dla produktu
     */
    getUrgencyConfig(product) {
        const daysToDeadline = product.days_to_deadline;
        
        if (daysToDeadline === null || daysToDeadline === undefined) {
            return this.colorCodingConfig.urgency.normal;
        }
        
        if (daysToDeadline < 0) return this.colorCodingConfig.urgency.overdue;
        if (daysToDeadline <= 2) return this.colorCodingConfig.urgency.urgent;
        if (daysToDeadline <= 7) return this.colorCodingConfig.urgency.warning;
        return this.colorCodingConfig.urgency.normal;
    }

    /**
     * Poprawiona metoda wyświetlania deadline z ikonami urgency
     */
    updateDeadlineDisplay(deadlineEl, deadlineDateEl, product) {
        if (!product.deadline_date) {
            deadlineEl.innerHTML = '<span class="no-deadline">-</span>';
            deadlineEl.className = 'deadline-badge';
            if (deadlineDateEl) deadlineDateEl.textContent = '';
            return;
        }

        const today = new Date();
        const deadline = new Date(product.deadline_date);
        const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
        
        let badgeHTML, badgeClass;
        
        if (diffDays < 0) {
            badgeHTML = `<i class="fas fa-exclamation-triangle me-1"></i>Spóźnienie ${Math.abs(diffDays)}d`;
            badgeClass = 'deadline-badge deadline-overdue';
        } else if (diffDays === 0) {
            badgeHTML = `<i class="fas fa-clock me-1"></i>Dziś`;
            badgeClass = 'deadline-badge deadline-today';
        } else if (diffDays <= 2) {
            badgeHTML = `<i class="fas fa-fire me-1"></i>${diffDays}d`;
            badgeClass = 'deadline-badge deadline-urgent';
        } else if (diffDays <= 7) {
            badgeHTML = `<i class="fas fa-hourglass-half me-1"></i>${diffDays}d`;
            badgeClass = 'deadline-badge deadline-warning';
        } else {
            badgeHTML = `<i class="fas fa-calendar me-1"></i>${diffDays}d`;
            badgeClass = 'deadline-badge deadline-normal';
        }
        
        deadlineEl.innerHTML = badgeHTML;
        deadlineEl.className = badgeClass;
        if (deadlineDateEl) {
            deadlineDateEl.textContent = deadline.toLocaleDateString('pl-PL');
        }
    }

    /**
     * Poprawiona metoda wyświetlania priorytetu z progress bar
     */
    updatePriorityDisplay(priorityEl, priorityFillEl, product) {
        const priority = parseInt(product.priority_score || 0);
        const priorityConfig = this.getPriorityConfig(priority);
        
        if (priorityEl) {
            priorityEl.textContent = priority;
            priorityEl.className = `priority-score ${priorityConfig.class}`;
            priorityEl.style.color = priorityConfig.color;
        }
        
        if (priorityFillEl) {
            const fillPercentage = Math.min((priority / 200) * 100, 100);
            priorityFillEl.style.width = `${fillPercentage}%`;
            priorityFillEl.style.backgroundColor = priorityConfig.color;
        }
    }

    /**
     * Pobiera konfigurację priority
     */
    getPriorityConfig(priority) {
        if (priority >= 180) return this.colorCodingConfig.priority.critical;
        if (priority >= 140) return this.colorCodingConfig.priority.high;
        if (priority >= 80) return this.colorCodingConfig.priority.medium;
        return this.colorCodingConfig.priority.low;
    }

    /**
     * Dodaje tooltips z dodatkowymi informacjami
     */
    addProductRowTooltips(rowElement, product) {
        // Tooltip dla nazwy produktu
        const nameElement = rowElement.querySelector('.product-name');
        if (nameElement && product.original_product_name) {
            nameElement.title = product.original_product_name;
        }
        
        // Tooltip dla ID produktu
        const idElement = rowElement.querySelector('.product-id-main');
        if (idElement) {
            const tooltipText = [
                `ID: ${product.short_product_id}`,
                `Zamówienie: ${product.internal_order_number || 'N/A'}`,
                `Baselinker: ${product.baselinker_order_id || 'N/A'}`
            ].join('\n');
            idElement.title = tooltipText;
        }
        
        // Tooltip dla priorytetu
        const priorityElement = rowElement.querySelector('.priority-score');
        if (priorityElement) {
            const priorityConfig = this.getPriorityConfig(product.priority_score || 0);
            priorityElement.title = `Priorytet: ${product.priority_score || 0}/200 (${priorityConfig.class.replace('priority-', '')})`;
        }
        
        // Tooltip dla deadline
        const deadlineElement = rowElement.querySelector('.deadline-badge');
        if (deadlineElement && product.deadline_date) {
            const deadline = new Date(product.deadline_date);
            const urgencyConfig = this.getUrgencyConfig(product);
            deadlineElement.title = `Deadline: ${deadline.toLocaleString('pl-PL')}\nStatus: ${urgencyConfig.class.replace('-product', '')}`;
        }
    }

    // ========================================================================
    // COLUMN SORTING - KROK 4.4 podpunkt
    // ========================================================================

    /**
     * Konfiguruje sortowanie kolumn
     */
    setupColumnSorting() {
        console.log('[ProductsModule] Setting up column sorting...');
        
        // Znajdź wszystkie nagłówki z sortowaniem
        const sortableHeaders = document.querySelectorAll('.sortable-header');
        
        sortableHeaders.forEach(header => {
            header.addEventListener('click', (e) => {
                const sortColumn = header.getAttribute('data-sort');
                this.handleColumnSort(sortColumn);
            });
            
            // Dodaj keyboard accessibility
            header.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const sortColumn = header.getAttribute('data-sort');
                    this.handleColumnSort(sortColumn);
                }
            });
        });
        
        console.log(`[ProductsModule] Column sorting setup for ${sortableHeaders.length} headers`);
    }

    /**
     * Obsługuje sortowanie kolumn
     */
    handleColumnSort(columnKey) {
        console.log(`[ProductsModule] Column sort requested: ${columnKey}`);
        
        // Sprawdź czy to ta sama kolumna - zmień kierunek
        if (this.state.sortColumn === columnKey) {
            this.state.sortDirection = this.state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.state.sortColumn = columnKey;
            this.state.sortDirection = 'asc';
        }
        
        // Aktualizuj wizualne wskaźniki sortowania
        this.updateSortIndicators(columnKey, this.state.sortDirection);
        
        // Posortuj produkty
        this.sortProducts(columnKey, this.state.sortDirection);
        
        // Odśwież virtual scroll z posortowanymi danymi
        this.refreshVirtualScrollData();
        
        console.log(`[ProductsModule] Products sorted by ${columnKey} ${this.state.sortDirection}`);
    }

    /**
     * Aktualizuje wskaźniki sortowania w nagłówkach
     */
    updateSortIndicators(activeColumn, direction) {
        // Usuń wszystkie aktywne wskaźniki
        document.querySelectorAll('.sortable-header').forEach(header => {
            const icon = header.querySelector('i');
            header.classList.remove('sort-asc', 'sort-desc');
            if (icon) {
                icon.className = 'fas fa-sort';
            }
        });
        
        // Dodaj wskaźnik do aktywnej kolumny
        const activeHeader = document.querySelector(`[data-sort="${activeColumn}"]`);
        if (activeHeader) {
            const icon = activeHeader.querySelector('i');
            activeHeader.classList.add(`sort-${direction}`);
            if (icon) {
                icon.className = direction === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
            }
        }
    }

    /**
     * Sortuje produkty w state
     */
    sortProducts(columnKey, direction) {
        const products = this.getFilteredProducts();
        
        products.sort((a, b) => {
            let aVal = this.getSortValue(a, columnKey);
            let bVal = this.getSortValue(b, columnKey);
            
            // Handle null/undefined values
            if (aVal === null || aVal === undefined) aVal = '';
            if (bVal === null || bVal === undefined) bVal = '';
            
            // Numeric comparison
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return direction === 'asc' ? aVal - bVal : bVal - aVal;
            }
            
            // String comparison
            const aStr = aVal.toString().toLowerCase();
            const bStr = bVal.toString().toLowerCase();
            
            if (direction === 'asc') {
                return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
            } else {
                return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
            }
        });
        
        // Aktualizuj przefiltrowane produkty
        this.state.filteredProducts = products;
    }

    /**
     * Pobiera wartość do sortowania dla kolumny
     */
    getSortValue(product, columnKey) {
        switch (columnKey) {
            case 'priority_score':
                return parseInt(product.priority_score || 0);
            case 'short_product_id':
                return product.short_product_id || '';
            case 'original_product_name':
                return product.original_product_name || '';
            case 'volume_m3':
                return parseFloat(product.volume_m3 || 0);
            case 'total_value_net':
                return parseFloat(product.total_value_net || 0);
            case 'current_status':
                return product.current_status || '';
            case 'deadline_date':
                return product.deadline_date ? new Date(product.deadline_date).getTime() : 0;
            default:
                return product[columnKey] || '';
        }
    }

    // ========================================================================
    // KONIEC SEKCJI PRODUCT ROW STRUCTURE
    // ========================================================================

    // ========================================================================
    // CHECKBOX MANAGEMENT - KROK 4.3
    // ========================================================================

    /**
     * Zaznacza wszystkie widoczne produkty
     */
    selectAllVisibleProducts() {
        console.log('[ProductsModule] Selecting all visible products...');
        
        const filteredProducts = this.getFilteredProducts();
        let selectedCount = 0;
        
        filteredProducts.forEach(product => {
            const uniqueId = this.getProductUniqueId(product);
            if (!this.state.selectedProducts.has(uniqueId)) {
                this.state.selectedProducts.add(uniqueId);
                selectedCount++;
            }
        });
        
        // Synchronizuj checkboxy widocznych wierszy
        this.syncVisibleCheckboxes();
        
        // Aktualizuj UI
        this.updateBulkActionsBar();
        this.updateSelectAllCheckbox();
        
        console.log(`[ProductsModule] Selected ${selectedCount} products (total: ${this.state.selectedProducts.size})`);
        
        // Toast notification
        if (this.shared.toastSystem && selectedCount > 0) {
            this.shared.toastSystem.show(`Zaznaczono ${filteredProducts.length} produktów`, 'success');
        }
    }

    /**
     * Odznacza wszystkie produkty
     */
    deselectAllProducts() {
        console.log('[ProductsModule] Deselecting all products...');
        
        const previousCount = this.state.selectedProducts.size;
        this.state.selectedProducts.clear();
        
        // Synchronizuj checkboxy widocznych wierszy
        this.syncVisibleCheckboxes();
        
        // Aktualizuj UI
        this.updateBulkActionsBar();
        this.updateSelectAllCheckbox();
        
        console.log(`[ProductsModule] Deselected ${previousCount} products`);
        
        // Toast notification
        if (this.shared.toastSystem && previousCount > 0) {
            this.shared.toastSystem.show(`Odznaczono ${previousCount} produktów`, 'info');
        }
    }

    /**
     * Synchronizuje checkboxy w widocznych wierszach z centralnym state
     */
    syncVisibleCheckboxes() {
        if (!this.virtualScrollState.renderedRows) return;
        
        this.virtualScrollState.renderedRows.forEach((rowElement, index) => {
            const checkbox = rowElement.querySelector('.product-checkbox');
            if (checkbox) {
                const uniqueId = checkbox.value;
                checkbox.checked = this.state.selectedProducts.has(uniqueId);
            }
        });
    }

    /**
     * Obsługuje zaznaczenie zakresu produktów (Shift+Click)
     */
    handleRangeSelection(currentUniqueId) {
        console.log('[ProductsModule] Range selection triggered:', currentUniqueId);
        
        if (!this.lastSelectedIndex || !this.lastSelectedProduct) {
            // Pierwszy element - zapisz jako punkt startowy
            this.markSelectionStart(currentUniqueId);
            return;
        }
        
        const filteredProducts = this.getFilteredProducts();
        const currentIndex = filteredProducts.findIndex(p => this.getProductUniqueId(p) === currentUniqueId);
        const lastIndex = filteredProducts.findIndex(p => this.getProductUniqueId(p) === this.lastSelectedProduct);
        
        if (currentIndex === -1 || lastIndex === -1) return;
        
        // Określ zakres do zaznaczenia
        const startIndex = Math.min(currentIndex, lastIndex);
        const endIndex = Math.max(currentIndex, lastIndex);
        
        // Zaznacz produkty w zakresie
        let selectedInRange = 0;
        for (let i = startIndex; i <= endIndex; i++) {
            const product = filteredProducts[i];
            const uniqueId = this.getProductUniqueId(product);
            
            if (!this.state.selectedProducts.has(uniqueId)) {
                this.state.selectedProducts.add(uniqueId);
                selectedInRange++;
            }
        }
        
        // Aktualizuj UI
        this.syncVisibleCheckboxes();
        this.updateBulkActionsBar();
        this.updateSelectAllCheckbox();
        
        console.log(`[ProductsModule] Range selected: ${selectedInRange} products in range ${startIndex}-${endIndex}`);
        
        // Toast notification
        if (this.shared.toastSystem && selectedInRange > 0) {
            this.shared.toastSystem.show(`Zaznaczono zakres: ${selectedInRange} produktów`, 'success');
        }
    }

    /**
     * Zapisuje punkt startowy dla range selection
     */
    markSelectionStart(uniqueId) {
        this.lastSelectedProduct = uniqueId;
        
        const filteredProducts = this.getFilteredProducts();
        this.lastSelectedIndex = filteredProducts.findIndex(p => this.getProductUniqueId(p) === uniqueId);
        
        console.log(`[ProductsModule] Selection start marked: ${uniqueId} at index ${this.lastSelectedIndex}`);
    }

    /**
     * Przełącza zaznaczenie pojedynczego produktu
     */
    toggleProductSelection(uniqueId, isShiftClick = false) {
        console.log(`[ProductsModule] Toggle product selection: ${uniqueId} (shift: ${isShiftClick})`);
        
        // Obsługa Shift+Click dla zaznaczania zakresu
        if (isShiftClick) {
            this.handleRangeSelection(uniqueId);
            return;
        }
        
        // Zwykłe przełączenie pojedynczego produktu
        if (this.state.selectedProducts.has(uniqueId)) {
            this.state.selectedProducts.delete(uniqueId);
            console.log(`[ProductsModule] Product deselected: ${uniqueId}`);
        } else {
            this.state.selectedProducts.add(uniqueId);
            this.markSelectionStart(uniqueId); // Zapisz jako potencjalny punkt startowy
            console.log(`[ProductsModule] Product selected: ${uniqueId}`);
        }
        
        // Aktualizuj UI
        this.updateBulkActionsBar();
        this.updateSelectAllCheckbox();
    }

    /**
     * Pobiera stan zaznaczenia wszystkich produktów
     */
    getSelectAllState() {
        const filteredProducts = this.getFilteredProducts();
        const totalVisible = filteredProducts.length;
        
        if (totalVisible === 0) {
            return 'none';
        }
        
        // Policz ile z widocznych produktów jest zaznaczonych
        const selectedVisible = filteredProducts.filter(product => {
            const uniqueId = this.getProductUniqueId(product);
            return this.state.selectedProducts.has(uniqueId);
        }).length;
        
        if (selectedVisible === 0) return 'none';
        if (selectedVisible === totalVisible) return 'all';
        return 'some';
    }

    /**
     * Rozszerzona aktualizacja checkbox "zaznacz wszystko"
     */
    updateSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('select-all-products');
        if (!selectAllCheckbox) return;
        
        const state = this.getSelectAllState();
        
        switch (state) {
            case 'none':
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.title = 'Zaznacz wszystkie widoczne produkty';
                break;
            case 'all':
                selectAllCheckbox.checked = true;
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.title = 'Odznacz wszystkie produkty';
                break;
            case 'some':
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = true;
                selectAllCheckbox.title = 'Część produktów zaznaczona - kliknij aby zaznacz wszystkie';
                break;
        }
    }

    /**
     * Rozszerzona aktualizacja bulk actions bar
     */
    updateBulkActionsBar() {
        const bulkBar = document.getElementById('bulk-actions-bar');
        const countSpan = document.getElementById('bulk-selected-count');
        
        const selectedCount = this.state.selectedProducts.size;
        
        if (selectedCount > 0) {
            bulkBar.style.display = 'flex';
            if (countSpan) {
                countSpan.textContent = selectedCount.toLocaleString();
            }
            
            // Dodaj animację pojawiania się
            if (bulkBar.style.display === 'none') {
                bulkBar.style.opacity = '0';
                bulkBar.style.transform = 'translateY(10px)';
                bulkBar.offsetHeight; // Force reflow
                bulkBar.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                bulkBar.style.opacity = '1';
                bulkBar.style.transform = 'translateY(0)';
            }
        } else {
            // Animacja znikania
            bulkBar.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            bulkBar.style.opacity = '0';
            bulkBar.style.transform = 'translateY(10px)';
            
            setTimeout(() => {
                bulkBar.style.display = 'none';
            }, 300);
        }
    }

    /**
     * Utrzymuje zaznaczenia podczas refresh/filtrowania
     */
    preserveSelectionsAfterRefresh() {
        console.log('[ProductsModule] Preserving selections after refresh...');
        
        // Po refresh danych, checkboxy zostaną zsynchronizowane automatycznie
        // poprzez updateProductRow() -> checkbox.checked = this.state.selectedProducts.has(uniqueId)
        
        // Aktualizuj UI elements
        this.updateBulkActionsBar();
        this.updateSelectAllCheckbox();
        
        const selectedCount = this.state.selectedProducts.size;
        console.log(`[ProductsModule] Preserved ${selectedCount} selections after refresh`);
    }

    /**
     * Pobiera listę zaznaczonych produktów z pełnymi danymi
     */
    getSelectedProductsData() {
        const selectedProducts = [];
        const allProducts = this.state.products; // Zawsze używaj pełnej listy, nie filtredProducts
        
        this.state.selectedProducts.forEach(uniqueId => {
            const product = allProducts.find(p => this.getProductUniqueId(p) === uniqueId);
            if (product) {
                selectedProducts.push(product);
            }
        });
        
        return selectedProducts;
    }

    /**
     * Pobiera statystyki zaznaczonych produktów
     */
    getSelectedProductsStats() {
        const selectedProducts = this.getSelectedProductsData();
        
        return {
            count: selectedProducts.length,
            totalVolume: selectedProducts.reduce((sum, p) => sum + parseFloat(p.volume_m3 || 0), 0),
            totalValue: selectedProducts.reduce((sum, p) => sum + parseFloat(p.total_value_net || 0), 0),
            statusBreakdown: this.groupProductsByStatus(selectedProducts)
        };
    }

    /**
     * Grupuje produkty według statusu
     */
    groupProductsByStatus(products) {
        return products.reduce((acc, product) => {
            const status = product.current_status || 'unknown';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});
    }

    /**
     * Obsługuje klawisz Escape
     */
    handleEscapeKey() {
        // Najpierw sprawdź czy są otwarte modals
        const openModals = document.querySelectorAll('.modal.show');
        if (openModals.length > 0) {
            // Zamknij modal
            openModals.forEach(modal => {
                const modalInstance = bootstrap.Modal.getInstance(modal);
                if (modalInstance) modalInstance.hide();
            });
            return;
        }
        
        // Jeśli nie ma modali, wyczyść zaznaczenia
        if (this.state.selectedProducts.size > 0) {
            this.deselectAllProducts();
        }
    }

    /**
     * Sprawdza czy produkt jest zaznaczony
     */
    isProductSelected(uniqueId) {
        return this.state.selectedProducts.has(uniqueId);
    }

    /**
     * Pobiera liczbę zaznaczonych produktów
     */
    getSelectedCount() {
        return this.state.selectedProducts.size;
    }

    /**
     * Czyści wszystkie zaznaczenia (np. po delete)
     */
    clearAllSelections() {
        console.log('[ProductsModule] Clearing all selections...');
        this.state.selectedProducts.clear();
        this.syncVisibleCheckboxes();
        this.updateBulkActionsBar();
        this.updateSelectAllCheckbox();
    }

    // ========================================================================
    // KONIEC SEKCJI CHECKBOX MANAGEMENT
    // ========================================================================

    // ========================================================================
    // VIRTUAL SCROLL HELPER METHODS
    // ========================================================================

    /**
     * Pobiera liczbę przefiltrowanych produktów
     */
    getFilteredProductsCount() {
        const products = this.getFilteredProducts();
        return products ? products.length : 0;
    }

    /**
     * Pobiera przefiltrowane produkty
     */
    getFilteredProducts() {
        // Jeśli są zastosowane filtry, używaj filteredProducts
        if (this.state.filteredProducts && this.state.filteredProducts.length > 0) {
            return this.state.filteredProducts;
        }
        
        // W przeciwnym razie używaj wszystkich produktów
        return this.state.products || [];
    }

    /**
     * Pobiera unikalny identyfikator produktu
     */
    getProductUniqueId(product) {
        return product.short_product_id || 
            product.id || 
            `${product.baselinker_id}_${product.variant_id}` ||
            product.internal_id ||
            `temp_${Date.now()}_${Math.random()}`;
    }

    /**
     * Obsługuje zaznaczanie/odznaczanie produktu
     */
    handleProductSelection(uniqueId, isSelected) {
        console.log(`[ProductsModule] Product selection: ${uniqueId} = ${isSelected}`);
        
        if (isSelected) {
            this.state.selectedProducts.add(uniqueId);
        } else {
            this.state.selectedProducts.delete(uniqueId);
        }
        
        // Aktualizuj bulk actions bar
        this.updateBulkActionsBar();
        
        // Aktualizuj "select all" checkbox
        this.updateSelectAllCheckbox();
    }

    /**
     * Aktualizuje bulk actions bar
     */
    updateBulkActionsBar() {
        const bulkBar = document.getElementById('bulk-actions-bar');
        const countSpan = document.getElementById('bulk-selected-count');
        
        const selectedCount = this.state.selectedProducts.size;
        
        if (selectedCount > 0) {
            bulkBar.style.display = 'flex';
            if (countSpan) countSpan.textContent = selectedCount;
        } else {
            bulkBar.style.display = 'none';
        }
    }

    /**
     * Aktualizuje checkbox "zaznacz wszystko"
     */
    updateSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('select-all-products');
        if (!selectAllCheckbox) return;
        
        const totalProducts = this.getFilteredProductsCount();
        const selectedCount = this.state.selectedProducts.size;
        
        if (selectedCount === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        } else if (selectedCount === totalProducts) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        }
    }

    /**
     * Aktualizuje licznik produktów
     */
    updateProductsCount() {
        const countElement = document.getElementById('stats-total-count');
        if (countElement) {
            const count = this.getFilteredProductsCount();
            countElement.textContent = count.toLocaleString();
        }
    }

    /**
     * Throttle function dla scroll events
     */
    throttle(func, limit) {
        let lastFunc;
        let lastRan;
        return function() {
            const context = this;
            const args = arguments;
            if (!lastRan) {
                func.apply(context, args);
                lastRan = Date.now();
            } else {
                clearTimeout(lastFunc);
                lastFunc = setTimeout(function() {
                    if ((Date.now() - lastRan) >= limit) {
                        func.apply(context, args);
                        lastRan = Date.now();
                    }
                }, limit - (Date.now() - lastRan));
            }
        };
    }

    // ========================================================================
    // EMPTY STATES I ERROR STATES
    // ========================================================================

    /**
     * Pokazuje empty state
     */
    showEmptyState() {
        const emptyState = document.getElementById('products-empty-state');
        const loadingState = document.getElementById('products-loading');
        const errorState = document.getElementById('products-error-state');
        
        this.clearRenderedRows();
        
        if (emptyState) emptyState.style.display = 'block';
        if (loadingState) loadingState.style.display = 'none';
        if (errorState) errorState.style.display = 'none';
    }

    /**
     * Ukrywa empty state
     */
    hideEmptyState() {
        const emptyState = document.getElementById('products-empty-state');
        const loadingState = document.getElementById('products-loading');
        const errorState = document.getElementById('products-error-state');
        
        if (emptyState) emptyState.style.display = 'none';
        if (loadingState) loadingState.style.display = 'none';
        if (errorState) errorState.style.display = 'none';
    }

    /**
     * Pokazuje loading state
     */
    showLoadingState() {
        const loadingState = document.getElementById('products-loading');
        const emptyState = document.getElementById('products-empty-state');
        const errorState = document.getElementById('products-error-state');
        
        this.clearRenderedRows();
        
        if (loadingState) loadingState.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';
        if (errorState) errorState.style.display = 'none';
    }

    /**
     * Pokazuje error state
     */
    showErrorState(message) {
        const errorState = document.getElementById('products-error-state');
        const messageEl = document.getElementById('error-message');
        const loadingState = document.getElementById('products-loading');
        const emptyState = document.getElementById('products-empty-state');
        
        this.clearRenderedRows();
        
        if (errorState) errorState.style.display = 'block';
        if (messageEl) messageEl.textContent = message || 'Wystąpił błąd podczas pobierania danych produktów.';
        if (loadingState) loadingState.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
    }

    // ========================================================================
    // STATUS I PRIORITY HELPER METHODS
    // ========================================================================

    /**
     * Pobiera nazwę wyświetlaną dla statusu
     */
    getStatusDisplayName(status) {
        const statusMap = {
            'czeka_na_wyciecie': 'Czeka na wycięcie',
            'w_trakcie_ciecia': 'W trakcie cięcia',
            'czeka_na_skladanie': 'Czeka na składanie',
            'w_trakcie_skladania': 'W trakcie składania',
            'czeka_na_pakowanie': 'Czeka na pakowanie',
            'w_trakcie_pakowania': 'W trakcie pakowania',
            'spakowane': 'Spakowane',
            'wstrzymane': 'Wstrzymane',
            'anulowane': 'Anulowane'
        };

        return statusMap[status] || status || 'Nieznany';
    }

    /**
     * Pobiera klasę CSS dla statusu
     */
    getStatusClass(status) {
        const classMap = {
            'czeka_na_wyciecie': 'status-waiting',
            'w_trakcie_ciecia': 'status-cutting',
            'czeka_na_skladanie': 'status-waiting',
            'w_trakcie_skladania': 'status-assembly',
            'czeka_na_pakowanie': 'status-waiting',
            'w_trakcie_pakowania': 'status-packaging',
            'spakowane': 'status-completed',
            'wstrzymane': 'status-paused',
            'anulowane': 'status-cancelled'
        };

        return classMap[status] || 'status-unknown';
    }

    /**
     * Pobiera klasę CSS dla priorytetu
     */
    getPriorityClass(priority) {
        if (priority >= 150) return 'priority-critical';
        if (priority >= 100) return 'priority-high';
        if (priority >= 50) return 'priority-medium';
        return 'priority-low';
    }

    /**
     * Oblicza urgency produktu na podstawie deadline
     */
    calculateProductUrgency(product) {
        if (!product.deadline_date) return 'normal-product';
        
        const today = new Date();
        const deadline = new Date(product.deadline_date);
        const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) return 'urgent-product'; // Przeterminowane
        if (diffDays <= 3) return 'warning-product'; // Pilne
        return 'normal-product';
    }

    /**
     * Aktualizuje wyświetlanie deadline
     */
    updateDeadlineDisplay(deadlineEl, deadlineDateEl, product) {
        if (!product.deadline_date) {
            deadlineEl.textContent = '-';
            deadlineEl.className = 'deadline-badge';
            deadlineDateEl.textContent = '';
            return;
        }

        const today = new Date();
        const deadline = new Date(product.deadline_date);
        const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
        
        let badgeText, badgeClass;
        
        if (diffDays < 0) {
            badgeText = `Spóźnienie ${Math.abs(diffDays)}d`;
            badgeClass = 'deadline-badge deadline-overdue';
        } else if (diffDays === 0) {
            badgeText = 'Dziś';
            badgeClass = 'deadline-badge deadline-today';
        } else if (diffDays <= 3) {
            badgeText = `${diffDays}d`;
            badgeClass = 'deadline-badge deadline-urgent';
        } else if (diffDays <= 7) {
            badgeText = `${diffDays}d`;
            badgeClass = 'deadline-badge deadline-warning';
        } else {
            badgeText = `${diffDays}d`;
            badgeClass = 'deadline-badge deadline-normal';
        }
        
        deadlineEl.textContent = badgeText;
        deadlineEl.className = badgeClass;
        deadlineDateEl.textContent = deadline.toLocaleDateString();
    }

    // ========================================================================
    // PLACEHOLDER METHODS - implementacja w kolejnych krokach
    // ========================================================================

    /**
     * Pokazuje szczegóły produktu - implementacja w kroku 6.1
     */
    showProductDetails(uniqueId) {
        console.log('[ProductsModule] Show product details:', uniqueId);
        // TODO: Implementacja w kroku 6.1 - Modal szczegółów
        this.shared.toastSystem.show('Szczegóły produktu - funkcja w przygotowaniu', 'info');
    }

    /**
     * Pokazuje modal edycji priorytetu - implementacja w kroku 6.2
     */
    showEditPriorityModal(uniqueId) {
        console.log('[ProductsModule] Edit priority modal:', uniqueId);
        // TODO: Implementacja w kroku 6.2 - Modal akcji grupowych
        this.shared.toastSystem.show('Edycja priorytetu - funkcja w przygotowaniu', 'info');
    }

    /**
     * Pokazuje modal zmiany statusu - implementacja w kroku 6.3
     */
    showChangeStatusModal(uniqueId) {
        console.log('[ProductsModule] Change status modal:', uniqueId);
        // TODO: Implementacja w kroku 6.3 - Modal zmiany statusu
        this.shared.toastSystem.show('Zmiana statusu - funkcja w przygotowaniu', 'info');
    }

    /**
     * Potwierdza usunięcie produktu - implementacja w kroku 6.4
     */
    confirmDeleteProduct(uniqueId) {
        console.log('[ProductsModule] Delete product confirm:', uniqueId);
        // TODO: Implementacja w kroku 6.4 - Confirmations
        this.shared.toastSystem.show('Usuwanie produktu - funkcja w przygotowaniu', 'info');
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    clearAllTimers() {
        console.log('[ProductsModule] Clearing all timers...');

        if (this.state.refreshInterval) {
            clearInterval(this.state.refreshInterval);
            this.state.refreshInterval = null;
        }

        // NOWE: Wyczyść debounce timers
        if (this.debounceTimers.textSearch) {
            clearTimeout(this.debounceTimers.textSearch);
            this.debounceTimers.textSearch = null;
        }

        if (this.debounceTimers.filtersUpdate) {
            clearTimeout(this.debounceTimers.filtersUpdate);
            this.debounceTimers.filtersUpdate = null;
        }
    }

    destroyComponents() {
        console.log('[ProductsModule-new] Destroying components...');

        // NOWE: Cleanup multi-select components
        if (this.components.multiSelects) {
            Object.keys(this.components.multiSelects).forEach(key => {
                this.destroyMultiSelectComponent(key);
            });
            this.components.multiSelects = null;
        }

        // Reszta cleanup
        Object.keys(this.components).forEach(key => {
            if (this.components[key] && typeof this.components[key].destroy === 'function') {
                this.components[key].destroy();
            }
            this.components[key] = null;
        });
    }

    resetState() {
        console.log('[ProductsModule] Resetting state...');

        this.state.selectedProducts.clear();
        this.state.products = [];
        this.state.currentFilters = {
            textSearch: '',
            woodSpecies: [],
            technologies: [],
            woodClasses: [],
            thicknesses: [],
            statuses: []
        };
        this.state.isRefreshing = false;
        this.state.isExporting = false;
    }

    // ========================================================================
    // PUBLIC API - dla debugowania
    // ========================================================================

    getCurrentState() {
        return {
            isLoaded: this.isLoaded,
            templateLoaded: this.templateLoaded,
            productsCount: this.state.products.length,
            selectedCount: this.state.selectedProducts.size,
            filters: this.state.currentFilters,
            stats: this.state.stats
        };
    }
}

/**
 * Helper klasa dla Virtual Scrolling
 * (Opcjonalnie - można pozostawić logikę w głównej klasie ProductsModule)
 */
class VirtualScrollList {
    constructor(parentModule) {
        this.parent = parentModule;
        this.isInitialized = false;
        
        console.log('[VirtualScrollList] Helper class initialized');
    }
    
    /**
     * Publiczne API dla refreshu
     */
    refresh() {
        if (this.parent && this.parent.refreshVirtualScrollData) {
            this.parent.refreshVirtualScrollData();
        }
    }
    
    /**
     * Publiczne API dla scrollu do konkretnego produktu
     */
    scrollToProduct(uniqueId) {
        const products = this.parent.getFilteredProducts();
        const index = products.findIndex(p => this.parent.getProductUniqueId(p) === uniqueId);
        
        if (index >= 0) {
            this.scrollToIndex(index);
        }
    }
    
    /**
     * Scrolluje do konkretnego indeksu
     */
    scrollToIndex(index) {
        const container = this.parent.virtualScrollElements.container;
        const rowHeight = this.parent.virtualScrollConfig.rowHeight;
        const scrollTop = index * rowHeight;
        
        container.scrollTop = scrollTop;
        console.log(`[VirtualScrollList] Scrolled to index: ${index}`);
    }
    
    /**
     * Pobiera aktualny zakres widocznych elementów
     */
    getVisibleRange() {
        return {
            startIndex: this.parent.virtualScrollState.startIndex,
            endIndex: this.parent.virtualScrollState.endIndex
        };
    }
    
    /**
     * Czyści wszystkie dane virtual scroll
     */
    clear() {
        if (this.parent && this.parent.clearRenderedRows) {
            this.parent.clearRenderedRows();
        }
    }
    
    /**
     * Cleanup method
     */
    destroy() {
        this.parent = null;
        this.isInitialized = false;
        console.log('[VirtualScrollList] Helper class destroyed');
    }
}

console.log('[ProductsModule] Class definition loaded successfully');