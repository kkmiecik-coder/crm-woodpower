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

        // Main components
        this.components = {
            virtualScroll: null,
            dragDrop: null,
            filters: null,
            modals: null,
            exportTool: null
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

        console.log('[ProductsModule-new] Initialized with state management');
    }

    // ========================================================================
    // LIFECYCLE METHODS
    // ========================================================================

    async load() {
        console.log('[ProductsModule-new] Loading products module...');

        try {
            if (!this.templateLoaded) {
                // PIERWSZY RAZ - ładuj template HTML + dane
                console.log('[ProductsModule-new] First load - loading template...');
                await this.loadProductsTemplate();
                this.templateLoaded = true;
            } else {
                // KOLEJNE RAZY - tylko odśwież dane
                console.log('[ProductsModule-new] Template already loaded - refreshing data only...');
                await this.refreshDataOnly();
            }

            this.isLoaded = true;
            this.state.lastUpdate = new Date();
            console.log('[ProductsModule-new] Products module loaded successfully');

        } catch (error) {
            console.error('[ProductsModule-new] Failed to load products module:', error);
            throw error;
        }
    }

    async loadProductsTemplate() {
        console.log('[ProductsModule-new] Loading HTML template for first time...');

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

                console.log('[ProductsModule-new] Products template HTML loaded');

                // Inicjalizacja komponentów (tylko raz przy ładowaniu template)
                this.initializeComponents();
                this.setupEventListeners();

                // Załaduj początkowe dane jeśli są dostępne
                if (response.initial_data) {
                    console.log('[ProductsModule-new] Loading initial data from template response');
                    await this.updateWithInitialData(response.initial_data);
                }

            } else {
                throw new Error('Products tab wrapper not found');
            }

            console.log('[ProductsModule-new] Template loaded and initialized successfully');

        } catch (error) {
            console.error('[ProductsModule-new] Failed to load products template:', error);
            throw error;
        }
    }

    async refreshDataOnly() {
        console.log('[ProductsModule-new] Refreshing data without template reload...');

        try {
            // W kolejnych krokach implementujemy dedykowane API do refresh
            const response = await this.shared.apiClient.getProductsTabContent();

            if (response.success) {
                await this.updateWithInitialData(response.initial_data || response.data);
                this.state.lastUpdate = new Date();
                console.log('[ProductsModule-new] Data refresh completed successfully');
            }

        } catch (error) {
            console.error('[ProductsModule-new] Data refresh failed:', error);
            this.shared.toastSystem.show(
                'Błąd odświeżania danych: ' + error.message,
                'error'
            );
            throw error;
        }
    }

    async unload() {
        console.log('[ProductsModule-new] Unloading products module...');

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
            console.log('[ProductsModule-new] Products module unloaded successfully');

        } catch (error) {
            console.error('[ProductsModule-new] Error during unload:', error);
        }
    }

    async refresh() {
        console.log('[ProductsModule-new] Manual refresh requested...');

        if (this.state.isRefreshing) {
            console.warn('[ProductsModule-new] Refresh already in progress');
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
        console.log('[ProductsModule-new] Destroying products module...');
        this.unload();
    }

    // ========================================================================
    // INITIALIZATION METHODS - będą implementowane w kolejnych krokach
    // ========================================================================

    initializeComponents() {
        console.log('[ProductsModule-new] Initializing components...');

        // W kolejnych krokach implementujemy:
        // - this.initializeFilters();
        // - this.initializeVirtualScrolling();
        // - this.initializeDragDrop();
        // - this.initializeModals();
        // - this.initializeExport();

        console.log('[ProductsModule-new] Components initialized (basic)');
    }

    setupEventListeners() {
        console.log('[ProductsModule-new] Setting up event listeners...');

        // W kolejnych krokach dodamy rzeczywiste event listeners

        console.log('[ProductsModule-new] Event listeners setup complete (basic)');
    }

    removeEventListeners() {
        console.log('[ProductsModule-new] Removing event listeners...');

        // W kolejnych krokach implementujemy cleanup

        console.log('[ProductsModule-new] Event listeners removed');
    }

    // ========================================================================
    // DATA HANDLING METHODS - podstawowe
    // ========================================================================

    async updateWithInitialData(data) {
        console.log('[ProductsModule-new] Updating with initial data...', data);

        if (data && data.products) {
            this.state.products = data.products;
            this.state.stats = data.stats || this.state.stats;
            console.log(`[ProductsModule-new] Loaded ${this.state.products.length} products`);
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
        console.log('[ProductsModule-new] Text search input:', event.target.value);
        // Implementacja w kolejnych krokach
    }

    handleFilterChange(event) {
        console.log('[ProductsModule-new] Filter change:', event);
        // Implementacja w kolejnych krokach
    }

    handleProductSelect(productId, selected) {
        console.log('[ProductsModule-new] Product select:', productId, selected);
        // Implementacja w kolejnych krokach
    }

    handleSelectAll(selectAll) {
        console.log('[ProductsModule-new] Select all:', selectAll);
        // Implementacja w kolejnych krokach
    }

    handleBulkAction(action, productIds) {
        console.log('[ProductsModule-new] Bulk action:', action, productIds);
        // Implementacja w kolejnych krokach
    }

    handleExport(options) {
        console.log('[ProductsModule-new] Export:', options);
        // Implementacja w kolejnych krokach
    }

    handleProductDrag(event) {
        console.log('[ProductsModule-new] Product drag:', event);
        // Implementacja w kolejnych krokach
    }

    handleProductDrop(event) {
        console.log('[ProductsModule-new] Product drop:', event);
        // Implementacja w kolejnych krokach
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    clearAllTimers() {
        console.log('[ProductsModule-new] Clearing all timers...');

        if (this.state.refreshInterval) {
            clearInterval(this.state.refreshInterval);
            this.state.refreshInterval = null;
        }

        // W kolejnych krokach dodamy więcej timerów do wyczyszczenia
    }

    destroyComponents() {
        console.log('[ProductsModule-new] Destroying components...');

        // W kolejnych krokach implementujemy cleanup komponentów
        Object.keys(this.components).forEach(key => {
            if (this.components[key] && typeof this.components[key].destroy === 'function') {
                this.components[key].destroy();
            }
            this.components[key] = null;
        });
    }

    resetState() {
        console.log('[ProductsModule-new] Resetting state...');

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

console.log('[ProductsModule-new] Class definition loaded successfully');