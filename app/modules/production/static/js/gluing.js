/**
 * GLUING DASHBOARD - JavaScript dla nowego interfejsu tabletu klejenia
 * Wykorzystuje API endpoints z backendu: /production/api/gluing/*
 */

class GluingDashboard {
    constructor() {
        // Stan aplikacji
        this.products = [];
        this.stations = [];
        this.filteredProducts = [];
        this.selectedProduct = null;
        this.activeFilters = {
            species: [],
            technology: [],
            wood_class: [],
            thickness: []
        };
        this.connectionStatus = 'connected';
        this.refreshInterval = null;
        this.autoRefreshSeconds = 30;

        // Konfiguracja API
        this.apiBase = '/production/api/gluing';

        // Elementy DOM
        this.elements = {};

        // Bind methods
        this.refreshData = this.refreshData.bind(this);
        this.handleProductClick = this.handleProductClick.bind(this);
        this.handleStationClick = this.handleStationClick.bind(this);
    }

    /**
     * Inicjalizacja aplikacji
     */
    async init() {
        console.log('🚀 Inicjalizacja Gluing Dashboard');

        try {
            // Znajdź elementy DOM
            this.findDOMElements();

            // Ustaw event listenery
            this.setupEventListeners();

            // Załaduj początkowe dane
            await this.loadInitialData();

            // Uruchom auto-refresh
            this.startAutoRefresh();

            console.log('✅ Gluing Dashboard zainicjalizowany');

        } catch (error) {
            console.error('❌ Błąd inicjalizacji:', error);
            this.showToast('Błąd inicjalizacji aplikacji', 'error');
        }
    }

    /**
     * Znajdź wszystkie potrzebne elementy DOM
     */
    findDOMElements() {
        // Status połączenia
        this.elements.connectionStatus = document.getElementById('connectionStatus');
        this.elements.refreshBtn = document.getElementById('refreshDataBtn');

        // Sekcja maszyn
        this.elements.machinesGrid = document.querySelector('.gluing-machines-grid');

        // Sekcja produktów
        this.elements.productsGrid = document.getElementById('productsGrid');
        this.elements.filtersContainer = document.getElementById('filtersContainer');
        this.elements.clearFiltersBtn = document.getElementById('clearFiltersBtn');
        this.elements.totalCount = document.getElementById('totalProductsCount');
        this.elements.selectedIndicator = document.getElementById('selectedProductIndicator');

        // Modal
        this.elements.modal = document.getElementById('assignmentModal');
        this.elements.modalClose = document.getElementById('closeAssignmentModal');
        this.elements.modalCancel = document.getElementById('cancelAssignment');
        this.elements.modalConfirm = document.getElementById('confirmAssignment');
        this.elements.modalProductDetails = document.getElementById('assignmentProductDetails');
        this.elements.modalStationDetails = document.getElementById('assignmentStationDetails');

        // Toast container
        this.elements.toastContainer = document.getElementById('toastContainer');

        // Sprawdź czy wszystkie kluczowe elementy istnieją
        const required = ['machinesGrid', 'productsGrid', 'filtersContainer'];
        for (const key of required) {
            if (!this.elements[key]) {
                throw new Error(`Nie znaleziono elementu: ${key}`);
            }
        }
    }

    /**
     * Ustaw event listenery
     */
    setupEventListeners() {
        // Przycisk odświeżania
        if (this.elements.refreshBtn) {
            this.elements.refreshBtn.addEventListener('click', this.refreshData);
        }

        // Przycisk czyszczenia filtrów
        if (this.elements.clearFiltersBtn) {
            this.elements.clearFiltersBtn.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }

        // Modal - zamknięcie
        if (this.elements.modalClose) {
            this.elements.modalClose.addEventListener('click', () => {
                this.hideModal();
            });
        }

        if (this.elements.modalCancel) {
            this.elements.modalCancel.addEventListener('click', () => {
                this.hideModal();
            });
        }

        // Modal - potwierdzenie przypisania
        if (this.elements.modalConfirm) {
            this.elements.modalConfirm.addEventListener('click', () => {
                this.confirmAssignment();
            });
        }

        // Zamknięcie modala na ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.elements.modal.classList.contains('hidden')) {
                this.hideModal();
            }
        });

        // Zamknięcie modala na klik w tło
        if (this.elements.modal) {
            this.elements.modal.addEventListener('click', (e) => {
                if (e.target === this.elements.modal) {
                    this.hideModal();
                }
            });
        }
    }

    /**
     * Załaduj początkowe dane z API
     */
    async loadInitialData() {
        console.log('📡 Ładowanie danych początkowych');

        try {
            // Pokaż loading
            this.setConnectionStatus('loading', 'Ładowanie danych...');

            // Ładuj równolegle produkty i stanowiska
            const [productsResponse, stationsResponse] = await Promise.all([
                this.apiCall('/items'),
                this.apiCall('/stations')
            ]);

            // Przetwórz dane
            this.products = productsResponse || [];
            this.stations = stationsResponse || [];
            this.filteredProducts = [...this.products];

            console.log(`📦 Załadowano ${this.products.length} produktów`);
            console.log(`🏭 Załadowano ${this.stations.length} stanowisk`);

            // Renderuj interfejs
            this.renderStations();
            this.generateFilters();
            this.renderProducts();
            this.updateProductsCount();

            this.setConnectionStatus('connected', 'Połączono z bazą');

        } catch (error) {
            console.error('❌ Błąd ładowania danych:', error);
            this.setConnectionStatus('error', 'Błąd połączenia');
            this.showToast('Błąd ładowania danych', 'error');
        }
    }

    /**
     * Odświeżanie danych
     */
    async refreshData() {
        console.log('🔄 Odświeżanie danych');

        try {
            // Animacja przycisku
            const refreshIcon = this.elements.refreshBtn?.querySelector('.gluing-refresh-icon');
            if (refreshIcon) {
                refreshIcon.style.transform = 'rotate(360deg)';
                setTimeout(() => {
                    refreshIcon.style.transform = 'rotate(0deg)';
                }, 300);
            }

            await this.loadInitialData();

        } catch (error) {
            console.error('❌ Błąd odświeżania:', error);
            this.showToast('Błąd odświeżania danych', 'error');
        }
    }

    /**
     * Wywołanie API
     */
    async apiCall(endpoint, options = {}) {
        const url = `${this.apiBase}${endpoint}`;

        const defaultOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            ...options
        };

        console.log(`📡 API Call: ${defaultOptions.method} ${url}`);

        try {
            const response = await fetch(url, defaultOptions);

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // Sprawdź czy odpowiedź ma format success/data
            if (data.hasOwnProperty('success')) {
                if (data.success) {
                    return data.data || data;
                } else {
                    throw new Error(data.message || 'API zwróciło błąd');
                }
            }

            return data;

        } catch (error) {
            console.error(`❌ API Call failed: ${url}`, error);

            // Ustaw status połączenia na błąd
            this.setConnectionStatus('error', 'Błąd połączenia z API');

            throw error;
        }
    }

    /**
     * Renderowanie stanowisk
     */
    renderStations() {
        if (!this.stations || this.stations.length === 0) {
            console.log('⚠️ Brak danych stanowisk');
            return;
        }

        console.log('🏭 Renderowanie stanowisk');

        // Sortuj stanowiska według display_order lub machine/station number
        const sortedStations = [...this.stations].sort((a, b) => {
            if (a.display_order && b.display_order) {
                return a.display_order - b.display_order;
            }
            // Fallback: sortuj według machine i station number
            if (a.machine_number !== b.machine_number) {
                return a.machine_number - b.machine_number;
            }
            return a.station_number - b.station_number;
        });

        // Znajdź wszystkie elementy stanowisk
        const stationElements = this.elements.machinesGrid.querySelectorAll('.gluing-station');

        sortedStations.forEach((station, index) => {
            if (index < stationElements.length) {
                this.renderSingleStation(station, stationElements[index]);
            }
        });
    }

    /**
     * Renderowanie pojedynczego stanowiska
     */
    renderSingleStation(station, element) {
        if (!station || !element) return;

        // Ustaw ID stanowiska
        element.dataset.stationId = station.id;
        element.dataset.machine = station.machine_number;
        element.dataset.station = station.station_number;

        // Znajdź elementy wewnętrzne
        const label = element.querySelector('.gluing-station-label');
        const status = element.querySelector('.gluing-station-status');
        const content = element.querySelector('.gluing-station-content');
        const capacity = element.querySelector('.gluing-station-capacity');

        // Ustaw nazwę stanowiska
        if (label) {
            label.textContent = station.name;
        }

        // Sprawdź status stanowiska
        const stationStatus = this.getStationStatus(station);

        // Ustaw status
        if (status) {
            status.textContent = stationStatus.text;
            status.className = `gluing-station-status ${stationStatus.class}`;
        }

        // Ustaw klasy CSS dla stanowiska
        element.className = `gluing-station ${stationStatus.class}`;

        // Ustaw pojemność
        if (capacity) {
            const occupancyPercent = this.calculateStationOccupancy(station);
            capacity.textContent = `${occupancyPercent}%`;
        }

        // Ustaw zawartość
        if (content) {
            if (stationStatus.class === 'available') {
                content.innerHTML = '<div class="gluing-empty-station">Kliknij, aby przypisać produkt</div>';
            } else {
                // Pokaż przypisane produkty (jeśli są)
                content.innerHTML = this.renderStationProducts(station);
            }
        }

        // Dodaj event listener
        element.removeEventListener('click', this.handleStationClick);
        element.addEventListener('click', (e) => this.handleStationClick(e, station));
    }

    /**
     * Oblicz zajętość stanowiska
     */
    calculateStationOccupancy(station) {
        // Tu będzie logika obliczania zajętości na podstawie przypisanych produktów
        // Na razie zwracamy 0 - będzie rozwinięte gdy będą dane o assignments
        return 0;
    }

    /**
     * Sprawdź status stanowiska
     */
    getStationStatus(station) {
        if (!station.status?.is_active) {
            return { class: 'inactive', text: 'Nieaktywne' };
        }
        
        if (station.status?.is_blocked) {
            return { class: 'blocked', text: 'Zablokowane' };
        }
        
        // GŁÓWNA POPRAWKA - sprawdź is_busy
        if (station.status?.is_busy && station.current_items_count > 0) {
            return { class: 'occupied', text: 'Zajęte' };
        }
        
        // Sprawdź zajętość
        const occupancy = station.occupancy_percent || 0;
        
        if (occupancy === 0) {
            return { class: 'available', text: 'Wolne' };
        } else if (occupancy < 100) {
            return { class: 'occupied', text: 'Zajęte' };
        } else {
            return { class: 'full', text: 'Pełne' };
        }
    }

    /**
     * Renderuj produkty przypisane do stanowiska
     */
    renderStationProducts(station) {
        if (station.current_items_count > 0) {
            const occupancy = Math.round(station.occupancy_percent || 0);
            return `
                <div class="gluing-assigned-products">
                    <div class="gluing-product-info">
                        ${station.current_items_count} szt. • ${station.current_thickness}cm • ${occupancy}%
                    </div>
                    <button class="gluing-start-btn" 
                            data-action="start-production" 
                            data-station-id="${station.id}">
                        ROZPOCZNIJ
                    </button>
                </div>
            `;
        }
        
        return '<div class="gluing-empty-station">Kliknij, aby przypisać produkt</div>';
    }

    /**
     * Generowanie dynamicznych filtrów
     */
    generateFilters() {
        if (!this.products || this.products.length === 0) {
            this.elements.filtersContainer.innerHTML = '<div class="gluing-filters-loading">Brak produktów do filtrowania</div>';
            return;
        }

        console.log('🔧 Generowanie filtrów');

        // Zbierz unikalne wartości dla każdego typu filtra
        const filterData = {
            species: new Set(),
            technology: new Set(),
            wood_class: new Set(),
            thickness: new Set()
        };

        this.products.forEach(product => {
            if (product.wood_species) filterData.species.add(product.wood_species);
            if (product.wood_technology) filterData.technology.add(product.wood_technology);
            if (product.wood_class) filterData.wood_class.add(product.wood_class);
            if (product.dimensions_thickness) filterData.thickness.add(product.dimensions_thickness.toString());
        });

        // Generuj HTML filtrów
        let filtersHTML = '';

        const filterLabels = {
            species: 'Gatunek',
            technology: 'Technologia',
            wood_class: 'Klasa',
            thickness: 'Grubość (cm)'
        };

        Object.keys(filterData).forEach(filterType => {
            const values = Array.from(filterData[filterType]).sort();

            if (values.length > 0) {
                filtersHTML += `
                    <div class="gluing-filter-group">
                        <label class="gluing-filter-label">${filterLabels[filterType]}:</label>
                        <div class="gluing-filter-buttons" data-filter-type="${filterType}">
                            ${values.map(value => `
                                <button class="gluing-filter-btn" 
                                        data-filter="${filterType}" 
                                        data-value="${value}">
                                    ${value}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
        });

        // Dodaj przycisk czyszczenia
        filtersHTML += `
            <div class="gluing-clear-filters">
                <button class="gluing-clear-btn hidden" id="clearFiltersBtn">
                    ✖️ Wyczyść wszystkie filtry
                </button>
            </div>
        `;

        this.elements.filtersContainer.innerHTML = filtersHTML;

        // Przypisz event listenery do przycisków filtrów
        this.setupFilterListeners();

        // Znajdź ponownie przycisk czyszczenia
        this.elements.clearFiltersBtn = document.getElementById('clearFiltersBtn');
        if (this.elements.clearFiltersBtn) {
            this.elements.clearFiltersBtn.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }
    }

    /**
     * Ustaw event listenery dla filtrów
     */
    setupFilterListeners() {
        const filterButtons = this.elements.filtersContainer.querySelectorAll('.gluing-filter-btn');

        filterButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const filterType = e.target.dataset.filter;
                const filterValue = e.target.dataset.value;

                this.toggleFilter(filterType, filterValue, e.target);
            });
        });
    }

    /**
     * Przełącz filtr
     */
    toggleFilter(filterType, filterValue, buttonElement) {
        const isActive = buttonElement.classList.contains('active');

        if (isActive) {
            // Usuń filtr
            buttonElement.classList.remove('active');
            const index = this.activeFilters[filterType].indexOf(filterValue);
            if (index > -1) {
                this.activeFilters[filterType].splice(index, 1);
            }
        } else {
            // Dodaj filtr
            buttonElement.classList.add('active');
            if (!this.activeFilters[filterType].includes(filterValue)) {
                this.activeFilters[filterType].push(filterValue);
            }
        }

        // Filtruj produkty
        this.applyFilters();

        // Pokaż/ukryj przycisk czyszczenia
        this.updateClearFiltersButton();
    }

    /**
     * Wyczyść wszystkie filtry
     */
    clearAllFilters() {
        // Wyczyść stan filtrów
        Object.keys(this.activeFilters).forEach(key => {
            this.activeFilters[key] = [];
        });

        // Usuń klasy active z przycisków
        const activeButtons = this.elements.filtersContainer.querySelectorAll('.gluing-filter-btn.active');
        activeButtons.forEach(button => {
            button.classList.remove('active');
        });

        // Przywróć wszystkie produkty
        this.filteredProducts = [...this.products];

        // Rerenderuj
        this.renderProducts();
        this.updateProductsCount();
        this.updateClearFiltersButton();

        this.showToast('Filtry wyczyszczone', 'info');
    }

    /**
     * Zastosuj filtry
     */
    applyFilters() {
        let filtered = [...this.products];

        // Zastosuj każdy typ filtra
        Object.keys(this.activeFilters).forEach(filterType => {
            const values = this.activeFilters[filterType];

            if (values.length > 0) {
                filtered = filtered.filter(product => {
                    switch (filterType) {
                        case 'species':
                            return values.includes(product.wood_species);
                        case 'technology':
                            return values.includes(product.wood_technology);
                        case 'wood_class':
                            return values.includes(product.wood_class);
                        case 'thickness':
                            return values.includes(product.dimensions_thickness?.toString());
                        default:
                            return true;
                    }
                });
            }
        });

        this.filteredProducts = filtered;

        // Rerenderuj produkty
        this.renderProducts();
        this.updateProductsCount();

        console.log(`🔍 Filtry zastosowane: ${this.filteredProducts.length}/${this.products.length} produktów`);
    }

    /**
     * Aktualizuj przycisk czyszczenia filtrów
     */
    updateClearFiltersButton() {
        if (!this.elements.clearFiltersBtn) return;

        const hasActiveFilters = Object.values(this.activeFilters).some(values => values.length > 0);

        if (hasActiveFilters) {
            this.elements.clearFiltersBtn.classList.remove('hidden');
        } else {
            this.elements.clearFiltersBtn.classList.add('hidden');
        }
    }

    /**
     * Renderowanie produktów
     */
    renderProducts() {
        if (!this.filteredProducts || this.filteredProducts.length === 0) {
            this.elements.productsGrid.innerHTML = `
                <div class="gluing-products-loading">
                    <p>Brak produktów do wyświetlenia</p>
                </div>
            `;
            return;
        }

        console.log(`📦 Renderowanie ${this.filteredProducts.length} produktów`);

        // Sortuj produkty według priority_score
        const sortedProducts = [...this.filteredProducts].sort((a, b) => {
            // Sortuj najpierw według priority_score (malejąco)
            if (a.priority_score !== b.priority_score) {
                return (b.priority_score || 0) - (a.priority_score || 0);
            }

            // Potem według deadline_date (rosnąco)
            if (a.deadline_date && b.deadline_date) {
                return new Date(a.deadline_date) - new Date(b.deadline_date);
            }

            // Na końcu według created_at (rosnąco - starsze pierwsze)
            return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        });

        const productsHTML = sortedProducts.map((product, index) => {
            return this.renderProductCard(product, index + 1);
        }).join('');

        this.elements.productsGrid.innerHTML = productsHTML;

        // Przypisz event listenery
        this.setupProductListeners();
    }

    /**
     * Renderuj pojedynczą kartę produktu
     */
    renderProductCard(product, priorityNumber) {
        const displayName = product.display_name || product.product_name || 'Nieznany produkt';

        // Przygotuj parametry jako badge'y
        const params = [];
        if (product.wood_species) params.push(product.wood_species);
        if (product.wood_technology) params.push(product.wood_technology);
        if (product.wood_class) params.push(product.wood_class);

        // Dodaj wymiary
        if (product.dimensions_thickness || product.dimensions_width || product.dimensions_length) {
            const dimensions = [
                product.dimensions_thickness ? `${product.dimensions_thickness}cm` : null,
                product.dimensions_width ? `${product.dimensions_width}cm` : null,
                product.dimensions_length ? `${product.dimensions_length}cm` : null
            ].filter(Boolean).join('×');

            if (dimensions) params.push(dimensions);
        }

        const paramsHTML = params.map(param =>
            `<span class="gluing-param-badge">${param}</span>`
        ).join('');

        return `
            <div class="gluing-product-card" 
                 data-product-id="${product.id}"
                 data-priority="${priorityNumber}">
                <div class="gluing-product-priority">
                    <span class="gluing-priority-number">${priorityNumber}</span>
                </div>
                <div class="gluing-product-info">
                    <h3 class="gluing-product-name">${displayName}</h3>
                    <div class="gluing-product-params">
                        ${paramsHTML}
                    </div>
                </div>
                <div class="gluing-product-actions">
                    <span class="gluing-product-quantity">
                        ${product.item_sequence || 1} szt.
                    </span>
                </div>
            </div>
        `;
    }

    /**
     * Ustaw event listenery dla produktów
     */
    setupProductListeners() {
        const productCards = this.elements.productsGrid.querySelectorAll('.gluing-product-card');

        productCards.forEach(card => {
            card.addEventListener('click', (e) => {
                const productId = parseInt(card.dataset.productId);
                this.handleProductClick(e, productId);
            });
        });
    }

    /**
     * Obsługa kliknięcia w produkt
     */
    handleProductClick(event, productId) {
        event.stopPropagation();

        const product = this.filteredProducts.find(p => p.id === productId);
        if (!product) return;

        console.log('📦 Kliknięto w produkt:', product.display_name);

        // Usuń poprzednią selekcję
        const prevSelected = this.elements.productsGrid.querySelector('.gluing-product-card.selected');
        if (prevSelected) {
            prevSelected.classList.remove('selected');
        }

        // Dodaj selekcję do nowej karty
        const currentCard = event.currentTarget;
        currentCard.classList.add('selected');

        // Zapisz wybrany produkt
        this.selectedProduct = product;

        // Aktualizuj wskaźnik
        if (this.elements.selectedIndicator) {
            this.elements.selectedIndicator.textContent = `Wybrano: ${product.display_name || product.product_name} - kliknij na wolne stanowisko`;
            this.elements.selectedIndicator.style.color = '#FE5516';
            this.elements.selectedIndicator.style.fontWeight = '600';
        }

        this.showToast('Produkt wybrany - kliknij na stanowisko', 'info');
    }

    /**
     * Obsługa kliknięcia w stanowisko
     */
    handleStationClick(event, station) {
        event.stopPropagation();
        
        // Sprawdź czy kliknięto przycisk START
        if (event.target.dataset.action === 'start-production') {
            this.startProduction(station);
            return;
        }
        
        // Reszta kodu dla przypisywania produktu
        if (!this.selectedProduct) {
            this.showToast('Najpierw wybierz produkt z listy', 'warning');
            return;
        }

        console.log('🏭 Kliknięto w stanowisko:', station.name);

        // Sprawdź czy stanowisko jest dostępne
        const stationStatus = this.getStationStatus(station);
        if (stationStatus.class !== 'available' && stationStatus.class !== 'occupied') {
            this.showToast('Stanowisko niedostępne', 'warning');
            return;
        }

        // Pokaż modal potwierdzenia
        this.showAssignmentModal(this.selectedProduct, station);
    }

    async startProduction(station) {
        console.log('🚀 Rozpoczynanie produkcji na stanowisku:', station.name);
        
        try {
            // Znajdź assignment_id dla tego stanowiska
            // Najpierw sprawdź czy stanowisko ma przypisane produkty
            if (!station.current_items_count || station.current_items_count === 0) {
                this.showToast('Brak produktów przypisanych do stanowiska', 'warning');
                return;
            }
            
            // API call do rozpoczęcia produkcji
            // Musimy wysłać POST do /production/api/gluing/assignments/{assignment_id}/start
            // Ale nie mamy assignment_id, więc użyjemy station_id jako identyfikatora
            
            const result = await this.apiCall(`/start-station/${station.id}`, {
                method: 'POST',
                body: JSON.stringify({
                    worker_name: 'Operator',
                    started_at: new Date().toISOString()
                })
            });
            
            console.log('✅ Produkcja rozpoczęta:', result);
            
            // Odśwież dane stanowisk
            await this.refreshData();
            
            this.showToast(`Rozpoczęto produkcję na ${station.name}`, 'success');
            
        } catch (error) {
            console.error('❌ Błąd rozpoczynania produkcji:', error);
            this.showToast('Błąd rozpoczynania produkcji', 'error');
        }
    }

    /**
     * Pokaż modal przypisania
     */
    showAssignmentModal(product, station) {
        if (!this.elements.modal) return;

        // Wypełnij szczegóły produktu
        if (this.elements.modalProductDetails) {
            const displayName = product.display_name || product.product_name;
            const params = [];
            if (product.wood_species) params.push(product.wood_species);
            if (product.wood_technology) params.push(product.wood_technology);
            if (product.wood_class) params.push(product.wood_class);

            this.elements.modalProductDetails.innerHTML = `
                <h4>${displayName}</h4>
                <p>${params.join(' • ')}</p>
            `;
        }

        // Wypełnij szczegóły stanowiska
        if (this.elements.modalStationDetails) {
            this.elements.modalStationDetails.innerHTML = `
                <h4>Stanowisko ${station.name}</h4>
                <p>Maszyna ${station.machine_number}</p>
            `;
        }

        // Zapisz dane do potwierdzenia
        this.pendingAssignment = {
            product: product,
            station: station
        };

        // Pokaż modal
        this.elements.modal.classList.remove('hidden');
    }

    /**
     * Ukryj modal
     */
    hideModal() {
        if (this.elements.modal) {
            this.elements.modal.classList.add('hidden');
        }

        this.pendingAssignment = null;
    }

    /**
     * Potwierdź przypisanie
     */
    async confirmAssignment() {
        if (!this.pendingAssignment) return;

        const { product, station } = this.pendingAssignment;

        try {
            console.log('📋 Przypisywanie produktu do stanowiska');

            // Wywołaj API przypisania
            const assignmentData = {
                item_id: product.id,
                station_id: station.id,
                position_x: 0, // Domyślnie - może być rozwinięte o drag&drop
                position_y: 0,
                worker_name: 'Operator' // Może być rozwinięte o wybór operatora
            };

            const result = await this.apiCall('/assign', {
                method: 'POST',
                body: JSON.stringify(assignmentData)
            });

            console.log('✅ Produkty przypisany pomyślnie');

            // Ukryj modal
            this.hideModal();

            // Wyczyść selekcję
            this.clearProductSelection();

            // Odśwież dane
            await this.refreshData();

            this.showToast('Produkt przypisany do stanowiska!', 'success');

        } catch (error) {
            console.error('❌ Błąd przypisania:', error);
            this.showToast('Błąd podczas przypisywania produktu', 'error');
        }
    }

    /**
     * Wyczyść selekcję produktu
     */
    clearProductSelection() {
        this.selectedProduct = null;

        // Usuń klasę selected
        const selected = this.elements.productsGrid.querySelector('.gluing-product-card.selected');
        if (selected) {
            selected.classList.remove('selected');
        }

        // Przywróć domyślny tekst wskaźnika
        if (this.elements.selectedIndicator) {
            this.elements.selectedIndicator.textContent = 'Wybierz produkt, a następnie kliknij na wolne stanowisko';
            this.elements.selectedIndicator.style.color = '#666';
            this.elements.selectedIndicator.style.fontWeight = 'normal';
        }
    }

    /**
     * Aktualizacja liczby produktów
     */
    updateProductsCount() {
        if (!this.elements.totalCount) return;

        const total = this.products.length;
        const filtered = this.filteredProducts.length;

        let text;
        if (total === filtered) {
            text = `${total} produktów`;
        } else {
            text = `${filtered} z ${total} produktów`;
        }

        this.elements.totalCount.textContent = text;
    }

    /**
     * Ustaw status połączenia
     */
    setConnectionStatus(status, message) {
        this.connectionStatus = status;

        if (!this.elements.connectionStatus) return;

        const statusDot = this.elements.connectionStatus.querySelector('.gluing-status-dot');
        const statusText = this.elements.connectionStatus;

        // Usuń poprzednie klasy
        statusText.classList.remove('status-connected', 'status-loading', 'status-error');

        switch (status) {
            case 'connected':
                statusText.classList.add('status-connected');
                if (statusDot) {
                    statusDot.style.backgroundColor = '#4CAF50';
                    statusDot.style.animation = 'gluing-pulse 2s infinite';
                }
                break;

            case 'loading':
                statusText.classList.add('status-loading');
                if (statusDot) {
                    statusDot.style.backgroundColor = '#FF9800';
                    statusDot.style.animation = 'gluing-pulse 0.8s infinite';
                }
                break;

            case 'error':
                statusText.classList.add('status-error');
                if (statusDot) {
                    statusDot.style.backgroundColor = '#F44336';
                    statusDot.style.animation = 'none';
                }
                break;
        }

        // Aktualizuj tekst (zachowaj ikonę i kropkę)
        const textElement = statusText.lastChild;
        if (textElement && textElement.nodeType === Node.TEXT_NODE) {
            textElement.textContent = message || 'Połączenie z bazą';
        }
    }

    /**
     * Pokaż toast notification
     */
    showToast(message, type = 'info', duration = 4000) {
        if (!this.elements.toastContainer) {
            console.warn('Brak kontenera toast notifications');
            return;
        }

        // Utwórz element toast
        const toast = document.createElement('div');
        toast.className = `gluing-toast ${type}`;
        toast.innerHTML = `
            <div class="gluing-toast-content">
                <span class="gluing-toast-message">${message}</span>
            </div>
        `;

        // Dodaj do kontenera
        this.elements.toastContainer.appendChild(toast);

        // Auto-usuń po określonym czasie
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'gluing-slide-out 0.3s ease';
                setTimeout(() => {
                    if (toast.parentNode) {
                        this.elements.toastContainer.removeChild(toast);
                    }
                }, 300);
            }
        }, duration);
    }

    /**
     * Auto-refresh danych
     */
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        let countdown = this.autoRefreshSeconds;

        this.refreshInterval = setInterval(() => {
            countdown--;

            // Aktualizuj licznik w przycisku
            const timerElement = document.querySelector('.prod-module-timer');
            if (timerElement) {
                timerElement.textContent = `(${countdown}s)`;
            }

            if (countdown <= 0) {
                // Reset licznika
                countdown = this.autoRefreshSeconds;

                // Odśwież dane (tylko jeśli nie ma aktywnych modali)
                if (this.elements.modal?.classList.contains('hidden') !== false) {
                    this.refreshData();
                }
            }
        }, 1000);
    }

    /**
     * Zatrzymaj auto-refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * Obsługa błędów API
     */
    handleApiError(error, context = '') {
        console.error(`API Error ${context}:`, error);

        this.setConnectionStatus('error', 'Błąd połączenia');

        let errorMessage = 'Wystąpił błąd połączenia';

        if (error.message) {
            if (error.message.includes('404')) {
                errorMessage = 'Nie znaleziono zasobu';
            } else if (error.message.includes('500')) {
                errorMessage = 'Błąd serwera';
            } else if (error.message.includes('403')) {
                errorMessage = 'Brak uprawnień';
            } else {
                errorMessage = error.message;
            }
        }

        this.showToast(errorMessage, 'error');
    }

    /**
     * Sprawdź czy jest połączenie z internetem
     */
    async checkConnection() {
        try {
            const response = await fetch('/production/api/gluing/config', {
                method: 'HEAD',
                cache: 'no-cache'
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Tryb offline - zapisz dane lokalnie
     */
    saveToLocalStorage() {
        try {
            const dataToSave = {
                products: this.products,
                stations: this.stations,
                timestamp: new Date().toISOString(),
                activeFilters: this.activeFilters
            };

            localStorage.setItem('gluing_dashboard_backup', JSON.stringify(dataToSave));
            console.log('Dane zapisane lokalnie');

        } catch (error) {
            console.warn('Nie można zapisać danych lokalnie:', error);
        }
    }

    /**
     * Wczytaj dane z localStorage
     */
    loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem('gluing_dashboard_backup');
            if (saved) {
                const data = JSON.parse(saved);

                // Sprawdź czy dane nie są za stare (max 1 godzina)
                const savedTime = new Date(data.timestamp);
                const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

                if (savedTime > hourAgo) {
                    console.log('Wczytywanie danych z localStorage');

                    this.products = data.products || [];
                    this.stations = data.stations || [];
                    this.filteredProducts = [...this.products];
                    this.activeFilters = data.activeFilters || {
                        species: [],
                        technology: [],
                        wood_class: [],
                        thickness: []
                    };

                    return true;
                }
            }
        } catch (error) {
            console.warn('Nie można wczytać danych z localStorage:', error);
        }

        return false;
    }

    /**
     * Czyszczenie danych localStorage
     */
    clearLocalStorage() {
        try {
            localStorage.removeItem('gluing_dashboard_backup');
        } catch (error) {
            console.warn('Nie można wyczyścić localStorage:', error);
        }
    }

    /**
     * Cleanup - wywoływane przy zamknięciu aplikacji
     */
    cleanup() {
        this.stopAutoRefresh();
        this.saveToLocalStorage();
        console.log('Gluing Dashboard cleanup completed');
    }
}

// CSS animations dodane dynamicznie
const additionalCSS = `
    @keyframes gluing-slide-out {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .status-connected .gluing-status-dot {
        background-color: #4CAF50 !important;
    }
    
    .status-loading .gluing-status-dot {
        background-color: #FF9800 !important;
    }
    
    .status-error .gluing-status-dot {
        background-color: #F44336 !important;
    }
`;

// Dodaj style do head
const styleSheet = document.createElement('style');
styleSheet.textContent = additionalCSS;
document.head.appendChild(styleSheet);

// Inicjalizacja aplikacji po załadowaniu DOM
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🌟 DOM załadowany - inicjalizacja Gluing Dashboard');

    try {
        // Utwórz instancję aplikacji
        window.gluingDashboard = new GluingDashboard();

        // Inicjalizuj
        await window.gluingDashboard.init();

        // Obsługa zamknięcia strony
        window.addEventListener('beforeunload', () => {
            if (window.gluingDashboard) {
                window.gluingDashboard.cleanup();
            }
        });

        // Obsługa utraty/przywrócenia fokusa (dla sprawdzenia połączenia)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && window.gluingDashboard) {
                // Sprawdź połączenie po powrocie do karty
                window.gluingDashboard.checkConnection().then(connected => {
                    if (connected) {
                        window.gluingDashboard.refreshData();
                    }
                });
            }
        });

    } catch (error) {
        console.error('❌ Krytyczny błąd inicjalizacji:', error);

        // Pokaż błąd użytkownikowi
        document.body.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: Arial, sans-serif;">
                <div style="text-align: center; padding: 40px; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
                    <h2 style="color: #f44336; margin-bottom: 16px;">Błąd inicjalizacji</h2>
                    <p style="color: #666; margin-bottom: 20px;">Nie można załadować interfejsu klejenia.</p>
                    <button onclick="location.reload()" style="background: #FE5516; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer;">
                        Spróbuj ponownie
                    </button>
                </div>
            </div>
        `;
    }
});