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

            // KROK 3.3: Inicjalizuj system badges filtrów
            const filterBadgesSuccess = this.setupFilterBadges();
            if (!filterBadgesSuccess) {
                console.warn('[ProductsModule-new] Filter badges initialization failed');
            }

            // W kolejnych krokach implementujemy:
            // KROK 4.1: this.initializeVirtualScrolling();
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
        const clearSearchBtn = document.getElementById('clear-text-search');

        if (textSearchInput) {
            textSearchInput.addEventListener('input', this.onTextSearchInput);
            textSearchInput.addEventListener('keydown', this.handleTextSearchKeydown.bind(this));
            console.log('[ProductsModule] Text search listeners attached');
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', this.clearTextSearch.bind(this));
            console.log('[ProductsModule] Clear search listener attached');
        }

        console.log('[ProductsModule] Event listeners setup complete');
    }

    removeEventListeners() {
        console.log('[ProductsModule-new] Removing event listeners...');

        const textSearchInput = document.getElementById('products-text-search');
        const clearSearchBtn = document.getElementById('clear-text-search');

        if (textSearchInput) {
            textSearchInput.removeEventListener('input', this.onTextSearchInput);
            textSearchInput.removeEventListener('keydown', this.handleTextSearchKeydown.bind(this));
        }

        if (clearSearchBtn) {
            clearSearchBtn.removeEventListener('click', this.clearTextSearch.bind(this));
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
        }

        // W kolejnych krokach implementujemy:
        // - this.updateProductsList();
        // - this.updateStatistics();
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

        const existingElement = document.getElementById(config.displayId);
        if (!existingElement) {
            console.warn(`[ProductsModule] Display element not found: ${config.displayId}`);
            return;
        }

        // POPRAWKA: Zamiast tworzyć nowy element, użyjemy istniejącego z HTML
        // i dodamy do niego naszą funkcjonalność

        // Znajdź dropdown container
        const dropdownElement = existingElement.closest('.multi-select-wrapper')?.querySelector('.multi-select-dropdown');
        if (!dropdownElement) {
            console.warn(`[ProductsModule] Dropdown container not found for: ${key}`);
            return;
        }

        // Ustaw event listeners na istniejących elementach
        this.setupMultiSelectEventsForExisting(key, config, existingElement, dropdownElement);

        // Zapisz referencję
        if (!this.components.multiSelects) {
            this.components.multiSelects = {};
        }
        this.components.multiSelects[key] = {
            config: config,
            displayElement: existingElement,
            dropdownElement: dropdownElement,
            isOpen: false,
            selectedOptions: new Set(),
            filteredOptions: []
        };

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
        // Sprawdź czy kliknięcie było w którymś multi-select
        const multiSelectContainer = event.target.closest('.multi-select-container');
        if (!multiSelectContainer) {
            this.closeAllMultiSelectDropdowns();
        }
    }

    /**
     * Filtruje opcje w dropdown na podstawie wyszukiwania
     */
    filterMultiSelectOptions(key, searchQuery) {
        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect) return;

        const options = multiSelect.element.querySelectorAll('.multi-select-option');
        const query = searchQuery.toLowerCase().trim();

        let visibleCount = 0;

        options.forEach(option => {
            const text = option.querySelector('.option-text').textContent.toLowerCase();
            const isVisible = !query || text.includes(query);

            option.style.display = isVisible ? 'flex' : 'none';
            if (isVisible) visibleCount++;
        });

        // Pokaż/ukryj "Brak opcji"
        const noOptions = multiSelect.element.querySelector('.no-options');
        if (noOptions) {
            noOptions.style.display = visibleCount === 0 ? 'block' : 'none';
        }
    }

    /**
     * Zaznacza wszystkie opcje
     */
    selectAllMultiSelectOptions(key) {
        console.log(`[ProductsModule] Selecting all options for: ${key}`);

        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect) return;

        // Zaznacz wszystkie widoczne opcje
        const visibleOptions = multiSelect.element.querySelectorAll('.multi-select-option:not([style*="display: none"])');

        visibleOptions.forEach(option => {
            const checkbox = option.querySelector('input[type="checkbox"]');
            const value = option.getAttribute('data-value');

            if (checkbox && !checkbox.checked) {
                checkbox.checked = true;
                multiSelect.selectedOptions.add(value);
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

        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect) return;

        // Odznacz wszystkie opcje
        const checkboxes = multiSelect.element.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });

        multiSelect.selectedOptions.clear();

        this.updateMultiSelectDisplay(key);
        this.triggerFilterUpdate(key);
    }

    /**
     * Aktualizuje wyświetlanie wybranych opcji
     */
    updateMultiSelectDisplay(key) {
        const multiSelect = this.components.multiSelects[key];
        if (!multiSelect) return;

        const selectedCount = multiSelect.selectedOptions.size;
        const placeholder = multiSelect.element.querySelector('.placeholder');
        const countSpan = multiSelect.element.querySelector('.selected-count');

        if (selectedCount === 0) {
            placeholder.style.display = 'inline';
            countSpan.style.display = 'none';
        } else {
            placeholder.style.display = 'none';
            countSpan.style.display = 'inline';
            countSpan.textContent = `${selectedCount} wybranych`;
        }
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

        // Wyczyść istniejące badges
        this.badgesConfig.badgesWrapper.innerHTML = '';

        const activeBadges = [];

        // Badge dla text search
        if (this.state.currentFilters.textSearch && this.state.currentFilters.textSearch.trim()) {
            activeBadges.push({
                type: 'text-search',
                label: 'Wyszukiwanie',
                value: this.state.currentFilters.textSearch.trim(),
                removable: true
            });
        }

        // Badges dla multi-select filtrów
        if (this.components.multiSelects) {
            Object.entries(this.multiSelectConfig.dropdowns).forEach(([key, config]) => {
                const multiSelect = this.components.multiSelects[key];
                if (multiSelect && multiSelect.selectedOptions.size > 0) {
                    const selectedValues = Array.from(multiSelect.selectedOptions);

                    // Jeśli tylko jedna opcja zaznaczona - pokaż nazwę
                    if (selectedValues.length === 1) {
                        const optionData = config.options.find(opt => opt.value === selectedValues[0]);
                        activeBadges.push({
                            type: 'multi-select',
                            filterKey: config.filterKey,
                            label: this.getFilterDisplayName(config.filterKey),
                            value: optionData ? optionData.label : selectedValues[0],
                            removable: true,
                            multiSelectKey: key,
                            singleValue: selectedValues[0]
                        });
                    } else {
                        // Więcej opcji - pokaż licznik
                        activeBadges.push({
                            type: 'multi-select',
                            filterKey: config.filterKey,
                            label: this.getFilterDisplayName(config.filterKey),
                            value: `${selectedValues.length} wybranych`,
                            removable: true,
                            multiSelectKey: key,
                            multipleValues: selectedValues
                        });
                    }
                }
            });
        }

        // Renderuj badges
        activeBadges.forEach(badge => {
            const badgeElement = this.createFilterBadge(badge);
            this.badgesConfig.badgesWrapper.appendChild(badgeElement);
        });

        // Pokaż/ukryj kontener badges
        if (activeBadges.length > 0) {
            this.badgesConfig.container.style.display = 'block';
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

        // Ikona w zależności od typu filtra
        const icon = this.getFilterBadgeIcon(badgeData.type, badgeData.filterKey);

        badge.innerHTML = `
        <div class="badge-content">
            <i class="${icon} badge-icon"></i>
            <span class="badge-label">${badgeData.label}:</span>
            <span class="badge-value">${badgeData.value}</span>
        </div>
        ${badgeData.removable ? '<button class="badge-remove" type="button"><i class="fas fa-times"></i></button>' : ''}
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

console.log('[ProductsModule] Class definition loaded successfully');