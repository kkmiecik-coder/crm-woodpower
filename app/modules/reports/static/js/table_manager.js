// modules/reports/static/js/table_manager.js
/**
 * Manager zarządzający filtrami dropdown i dodawaniem/edycją wierszy
 * Odpowiedzialny za filtry wielokrotne, dodawanie/edycję wierszy
 */

class TableManager {
    constructor() {
        this.filterElements = {};
        this.modalElements = {};
        this.isInitialized = false;

        // Dane dropdown'ów
        this.dropdownData = {
            customer_name: [],
            delivery_state: [],
            wood_species: [],
            current_status: [],
            delivery_method: [],
            order_source: [],
            payment_method: []
        };

        // Aktywne filtry (checkbox states)
        this.activeFilters = {
            customer_name: [],
            delivery_state: [],
            wood_species: [],
            current_status: []
        };

        // Stany dropdown'ów
        this.dropdownStates = {
            customer_name: false,
            delivery_state: false,
            wood_species: false,
            current_status: false
        };

        console.log('[TableManager] Initialized');
    }

    /**
     * Inicjalizacja managera
     */
    init() {
        console.log('[TableManager] Starting initialization...');

        this.cacheElements();
        this.setupEventListeners();
        this.loadDropdownData();

        this.isInitialized = true;
        console.log('[TableManager] Initialization complete');
    }

    /**
     * Cache elementów DOM - NOWA WERSJA DLA DROPDOWN'ÓW
     */
    cacheElements() {
        // Filtry dat
        this.filterElements = {
            filterDateFrom: document.getElementById('filterDateFrom'),
            filterDateTo: document.getElementById('filterDateTo'),

            // Dropdown elementy - NOWA STRUKTURA
            customerNameDropdown: document.getElementById('filterCustomerNameDropdown'),
            customerNameToggle: document.getElementById('filterCustomerNameToggle'),
            customerNameMenu: document.getElementById('filterCustomerNameMenu'),
            customerNameLabel: document.querySelector('#filterCustomerNameToggle .filter-dropdown-label'),
            customerNameOptions: document.getElementById('filterCustomerNameOptions'),
            searchCustomerName: document.getElementById('searchCustomerName'),

            deliveryStateDropdown: document.getElementById('filterDeliveryStateDropdown'),
            deliveryStateToggle: document.getElementById('filterDeliveryStateToggle'),
            deliveryStateMenu: document.getElementById('filterDeliveryStateMenu'),
            deliveryStateLabel: document.querySelector('#filterDeliveryStateToggle .filter-dropdown-label'),
            deliveryStateOptions: document.getElementById('filterDeliveryStateOptions'),
            searchDeliveryState: document.getElementById('searchDeliveryState'),

            woodSpeciesDropdown: document.getElementById('filterWoodSpeciesDropdown'),
            woodSpeciesToggle: document.getElementById('filterWoodSpeciesToggle'),
            woodSpeciesMenu: document.getElementById('filterWoodSpeciesMenu'),
            woodSpeciesLabel: document.querySelector('#filterWoodSpeciesToggle .filter-dropdown-label'),
            woodSpeciesOptions: document.getElementById('filterWoodSpeciesOptions'),
            searchWoodSpecies: document.getElementById('searchWoodSpecies'),

            currentStatusDropdown: document.getElementById('filterCurrentStatusDropdown'),
            currentStatusToggle: document.getElementById('filterCurrentStatusToggle'),
            currentStatusMenu: document.getElementById('filterCurrentStatusMenu'),
            currentStatusLabel: document.querySelector('#filterCurrentStatusToggle .filter-dropdown-label'),
            currentStatusOptions: document.getElementById('filterCurrentStatusOptions'),
            searchCurrentStatus: document.getElementById('searchCurrentStatus')
        };

        // Modal elementy
        this.modalElements = {
            modal: document.getElementById('manualRowModal'),
            title: document.getElementById('manualRowModalTitle'),
            form: document.getElementById('manualRowForm'),
            cancelBtn: document.getElementById('manualRowCancel'),
            saveBtn: document.getElementById('manualRowSave'),

            // Pola formularza
            recordId: document.getElementById('recordId'),
            dateCreated: document.getElementById('dateCreated'),
            internalOrderNumber: document.getElementById('internalOrderNumber'),
            customerName: document.getElementById('customerName'),
            phone: document.getElementById('phone'),
            deliveryAddress: document.getElementById('deliveryAddress'),
            deliveryPostcode: document.getElementById('deliveryPostcode'),
            deliveryCity: document.getElementById('deliveryCity'),
            deliveryState: document.getElementById('deliveryState'),
            groupType: document.getElementById('groupType'),
            productType: document.getElementById('productType'),
            woodSpecies: document.getElementById('woodSpecies'),
            technology: document.getElementById('technology'),
            woodClass: document.getElementById('woodClass'),
            finishState: document.getElementById('finishState'),
            lengthCm: document.getElementById('lengthCm'),
            widthCm: document.getElementById('widthCm'),
            thicknessCm: document.getElementById('thicknessCm'),
            quantity: document.getElementById('quantity'),
            priceGross: document.getElementById('priceGross'),
            deliveryCost: document.getElementById('deliveryCost'),
            deliveryMethod: document.getElementById('deliveryMethod'),
            orderSource: document.getElementById('orderSource'),
            paymentMethod: document.getElementById('paymentMethod'),
            paidAmountNet: document.getElementById('paidAmountNet'),
            currentStatus: document.getElementById('currentStatus')
        };

        console.log('[TableManager] Elements cached');
    }

    /**
     * Ustawienie event listenerów - NOWA WERSJA
     */
    setupEventListeners() {
        // Obsługa dat
        if (this.filterElements.filterDateFrom) {
            this.filterElements.filterDateFrom.addEventListener('change', () => {
                this.handleDateFilterChange();
            });
        }

        if (this.filterElements.filterDateTo) {
            this.filterElements.filterDateTo.addEventListener('change', () => {
                this.handleDateFilterChange();
            });
        }

        // NOWA OBSŁUGA DROPDOWN'ÓW
        this.setupDropdownEventListeners();

        // Zamknięcie dropdown'ów przy kliknięciu poza nimi
        document.addEventListener('click', (e) => {
            this.handleOutsideClick(e);
        });

        // Obsługa klawisza Escape
        document.addEventListener('keydown', (e) => {
            this.handleEscapeKey(e);
        });

        // Modal events
        if (this.modalElements.modal) {
            const closeBtn = this.modalElements.modal.querySelector('.close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.hideManualRowModal());
            }

            this.modalElements.modal.addEventListener('click', (e) => {
                if (e.target === this.modalElements.modal) {
                    this.hideManualRowModal();
                }
            });
        }

        if (this.modalElements.cancelBtn) {
            this.modalElements.cancelBtn.addEventListener('click', () => {
                this.hideManualRowModal();
            });
        }

        if (this.modalElements.saveBtn) {
            this.modalElements.saveBtn.addEventListener('click', () => {
                this.saveManualRow();
            });
        }

        if (this.modalElements.form) {
            this.modalElements.form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveManualRow();
            });
        }

        this.setupRealTimeValidation();

        console.log('[TableManager] Event listeners setup complete');
    }

    /**
     * Obsługa zmiany filtrów dat
     */
    handleDateFilterChange() {
        const dateFrom = this.filterElements.filterDateFrom?.value;
        const dateTo = this.filterElements.filterDateTo?.value;

        console.log('[TableManager] Date filter changed:', { dateFrom, dateTo });

        // Przekaż do ReportsManager
        if (window.reportsManager) {
            window.reportsManager.setDateRange(dateFrom, dateTo);
        }
    }

    /**
     * NOWA METODA - Ustawienie event listenerów dla dropdown'ów
     */
    setupDropdownEventListeners() {
        const filterKeys = ['customer_name', 'delivery_state', 'wood_species', 'current_status'];

        filterKeys.forEach(filterKey => {
            const camelCase = this.snakeToCamel(filterKey);
            const toggle = this.filterElements[`${camelCase}Toggle`];
            const menu = this.filterElements[`${camelCase}Menu`];
            const search = this.filterElements[`search${this.capitalizeFirst(camelCase)}`];

            // Toggle dropdown
            if (toggle) {
                toggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleDropdown(filterKey);
                });
            }

            // Search input
            if (search) {
                search.addEventListener('input', (e) => {
                    this.filterDropdownOptions(filterKey, e.target.value);
                });

                // Zapobiegaj zamykaniu dropdown'a przy kliknięciu w search
                search.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }

            // Zapobiegaj zamykaniu dropdown'a przy kliknięciu w menu
            if (menu) {
                menu.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }
        });
    }

    /**
     * NOWA METODA - Toggle dropdown'a
     */
    toggleDropdown(filterKey) {
        const isOpen = this.dropdownStates[filterKey];

        // Zamknij wszystkie inne dropdown'y
        Object.keys(this.dropdownStates).forEach(key => {
            if (key !== filterKey) {
                this.closeDropdown(key);
            }
        });

        if (isOpen) {
            this.closeDropdown(filterKey);
        } else {
            this.openDropdown(filterKey);
        }
    }

    /**
     * NOWA METODA - Otwórz dropdown
     */
    openDropdown(filterKey) {
        const camelCase = this.snakeToCamel(filterKey);
        const toggle = this.filterElements[`${camelCase}Toggle`];
        const menu = this.filterElements[`${camelCase}Menu`];
        const search = this.filterElements[`search${this.capitalizeFirst(camelCase)}`];

        if (toggle && menu) {
            toggle.classList.add('active');
            menu.classList.add('show');
            this.dropdownStates[filterKey] = true;

            // Focus na search input
            if (search) {
                setTimeout(() => {
                    search.focus();
                }, 100);
            }
        }
    }

    /**
     * NOWA METODA - Zamknij dropdown
     */
    closeDropdown(filterKey) {
        const camelCase = this.snakeToCamel(filterKey);
        const toggle = this.filterElements[`${camelCase}Toggle`];
        const menu = this.filterElements[`${camelCase}Menu`];

        if (toggle && menu) {
            toggle.classList.remove('active');
            menu.classList.remove('show');
            this.dropdownStates[filterKey] = false;
        }
    }

    /**
     * NOWA METODA - Zamknij dropdown przy kliknięciu poza nim
     */
    handleOutsideClick(e) {
        const filterKeys = ['customer_name', 'delivery_state', 'wood_species', 'current_status'];

        filterKeys.forEach(filterKey => {
            const camelCase = this.snakeToCamel(filterKey);
            const dropdown = this.filterElements[`${camelCase}Dropdown`];

            if (dropdown && !dropdown.contains(e.target)) {
                this.closeDropdown(filterKey);
            }
        });
    }

    /**
     * NOWA METODA - Obsługa klawisza Escape
     */
    handleEscapeKey(e) {
        if (e.key === 'Escape') {
            this.closeAllDropdowns();
        }
    }

    /**
     * POPRAWIONA METODA - Filtrowanie opcji dropdown'a
     */
    filterDropdownOptions(filterKey, searchTerm) {
        const camelCase = this.snakeToCamel(filterKey);
        const optionsContainer = this.filterElements[`${camelCase}Options`];

        if (!optionsContainer) return;

        const options = optionsContainer.querySelectorAll('.filter-option');
        const term = searchTerm.toLowerCase();

        options.forEach(option => {
            const label = option.querySelector('label');
            if (label) {
                const labelText = label.textContent.toLowerCase();
                if (labelText.includes(term)) {
                    option.classList.remove('hidden');
                } else {
                    option.classList.add('hidden');
                }
            }
        });
    }

    /**
     * POPRAWIONA METODA - Ładowanie danych dla dropdown'ów
     */
    async loadDropdownData() {
        console.log('[TableManager] Loading dropdown data...');

        const fieldsToLoad = ['customer_name', 'delivery_state', 'wood_species', 'current_status'];

        try {
            // Ustaw wszystkie dropdown'y w trybie loading
            fieldsToLoad.forEach(field => {
                this.setDropdownLoading(field, true);
            });

            // Ładuj dane dla każdego pola równolegle
            const promises = fieldsToLoad.map(field => this.loadDropdownValues(field));
            const results = await Promise.all(promises);

            // Aktualizuj dropdown'y
            fieldsToLoad.forEach((field, index) => {
                this.dropdownData[field] = results[index] || [];
                this.setDropdownLoading(field, false);
                this.updateDropdownOptions(field);
            });

            console.log('[TableManager] Dropdown data loaded successfully');

        } catch (error) {
            console.error('[TableManager] Error loading dropdown data:', error);

            // W przypadku błędu, usuń loading ze wszystkich dropdown'ów
            fieldsToLoad.forEach(field => {
                this.setDropdownLoading(field, false);
            });
        }
    }

    /**
     * Ładowanie wartości dla konkretnego dropdown'a
     */
    async loadDropdownValues(fieldName) {
        try {
            const response = await fetch(`/reports/api/dropdown-values/${fieldName}`);
            const result = await response.json();

            if (result.success) {
                return result.values || [];
            } else {
                console.error(`[TableManager] Error loading ${fieldName}:`, result.error);
                return [];
            }
        } catch (error) {
            console.error(`[TableManager] Network error loading ${fieldName}:`, error);
            return [];
        }
    }

    /**
     * POPRAWIONA METODA - Aktualizacja opcji dropdown'a
     */
    updateDropdownOptions(fieldName) {
        const camelCase = this.snakeToCamel(fieldName);
        const container = this.filterElements[`${camelCase}Options`];

        if (!container) {
            console.warn(`[TableManager] Container not found for field: ${fieldName}`);
            return;
        }

        const values = this.dropdownData[fieldName] || [];

        // Wyczyść kontener
        container.innerHTML = '';

        // Dodaj opcje checkbox
        values.forEach(value => {
            const isChecked = this.activeFilters[fieldName] &&
                this.activeFilters[fieldName].includes(value);

            const optionHtml = `
                <div class="filter-option">
                    <input type="checkbox" 
                           id="${fieldName}_${this.sanitizeId(value)}" 
                           value="${value}" 
                           ${isChecked ? 'checked' : ''}
                           data-filter="${fieldName}">
                    <label for="${fieldName}_${this.sanitizeId(value)}">${value}</label>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', optionHtml);
        });

        // Dodaj event listenery do nowych checkbox'ów
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                this.handleFilterChange(e.target.dataset.filter, e.target.value, e.target.checked);
            });
        });

        // Aktualizuj label dropdown'a
        this.updateDropdownLabel(fieldName);

        console.log(`[TableManager] Updated dropdown ${fieldName} with ${values.length} options`);
    }

    /**
     * NOWA METODA - Aktualizacja label dropdown'a
     */
    updateDropdownLabel(fieldName) {
        const camelCase = this.snakeToCamel(fieldName);
        const label = this.filterElements[`${camelCase}Label`];
        const toggle = this.filterElements[`${camelCase}Toggle`];

        if (!label || !toggle) return;

        const activeCount = this.activeFilters[fieldName] ? this.activeFilters[fieldName].length : 0;

        const defaultLabels = {
            customer_name: 'Wszyscy klienci',
            delivery_state: 'Wszystkie województwa',
            wood_species: 'Wszystkie gatunki',
            current_status: 'Wszystkie statusy'
        };

        if (activeCount === 0) {
            label.textContent = defaultLabels[fieldName];
            label.classList.add('placeholder');
            toggle.classList.remove('has-selection');

            // Usuń counter jeśli istnieje
            const existingCounter = toggle.querySelector('.filter-dropdown-counter');
            if (existingCounter) {
                existingCounter.remove();
            }
        } else {
            const selectedValues = this.activeFilters[fieldName];

            if (activeCount === 1) {
                label.textContent = selectedValues[0];
            } else {
                label.textContent = `${activeCount} wybranych`;
            }

            label.classList.remove('placeholder');
            toggle.classList.add('has-selection');

            // Dodaj lub aktualizuj counter
            let counter = toggle.querySelector('.filter-dropdown-counter');
            if (!counter) {
                counter = document.createElement('span');
                counter.className = 'filter-dropdown-counter';
                toggle.insertBefore(counter, toggle.querySelector('i'));
            }
            counter.textContent = activeCount;
        }
    }

    /**
     * POPRAWIONA METODA - Obsługa zmiany filtra
     */
    handleFilterChange(filterKey, value, isChecked) {
        console.log('[TableManager] Filter changed:', filterKey, value, isChecked);

        if (!this.activeFilters[filterKey]) {
            this.activeFilters[filterKey] = [];
        }

        if (isChecked) {
            if (!this.activeFilters[filterKey].includes(value)) {
                this.activeFilters[filterKey].push(value);
            }
        } else {
            const index = this.activeFilters[filterKey].indexOf(value);
            if (index > -1) {
                this.activeFilters[filterKey].splice(index, 1);
            }
        }

        // Wyczyść puste filtry
        if (this.activeFilters[filterKey].length === 0) {
            delete this.activeFilters[filterKey];
        }

        // Aktualizuj label dropdown'a
        this.updateDropdownLabel(filterKey);

        // Prześlij zmiany do ReportsManager
        if (window.reportsManager) {
            window.reportsManager.setFilter(filterKey, this.activeFilters[filterKey] || []);
        }
    }

    /**
     * POPRAWIONA METODA - Aktualizacja checkboxów z zewnątrz
     */
    updateFilterCheckboxes(filterKey, value, isChecked) {
        const camelCase = this.snakeToCamel(filterKey);
        const container = this.filterElements[`${camelCase}Options`];

        if (!container) return;

        const checkbox = container.querySelector(`input[value="${value}"]`);
        if (checkbox) {
            checkbox.checked = isChecked;
        }

        // Aktualizuj lokalny stan
        if (!this.activeFilters[filterKey]) {
            this.activeFilters[filterKey] = [];
        }

        if (isChecked) {
            if (!this.activeFilters[filterKey].includes(value)) {
                this.activeFilters[filterKey].push(value);
            }
        } else {
            const index = this.activeFilters[filterKey].indexOf(value);
            if (index > -1) {
                this.activeFilters[filterKey].splice(index, 1);
            }
        }

        if (this.activeFilters[filterKey].length === 0) {
            delete this.activeFilters[filterKey];
        }

        // Aktualizuj label
        this.updateDropdownLabel(filterKey);
    }

    /**
     * POPRAWIONA METODA - Czyszczenie filtrów
     */
    clearFilters() {
        console.log('[TableManager] Clearing filters...');

        // Wyczyść daty
        if (this.filterElements.filterDateFrom) {
            this.filterElements.filterDateFrom.value = '';
        }
        if (this.filterElements.filterDateTo) {
            this.filterElements.filterDateTo.value = '';
        }

        // Wyczyść stany checkbox'ów i dropdown'ów
        Object.keys(this.activeFilters).forEach(filterKey => {
            const camelCase = this.snakeToCamel(filterKey);
            const container = this.filterElements[`${camelCase}Options`];

            if (container) {
                container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                    checkbox.checked = false;
                });
            }

            // Wyczyść search input
            const searchElement = this.filterElements[`search${this.capitalizeFirst(camelCase)}`];
            if (searchElement) {
                searchElement.value = '';
                // Pokaż wszystkie opcje
                this.filterDropdownOptions(filterKey, '');
            }

            // Zamknij dropdown
            this.closeDropdown(filterKey);
        });

        // Wyczyść lokalny stan
        this.activeFilters = {
            customer_name: [],
            delivery_state: [],
            wood_species: [],
            current_status: []
        };

        // Aktualizuj wszystkie labels
        Object.keys(this.activeFilters).forEach(filterKey => {
            this.updateDropdownLabel(filterKey);
        });

        console.log('[TableManager] Filters cleared');
    }

    /**
     * NOWA METODA - Zamknięcie wszystkich dropdown'ów
     */
    closeAllDropdowns() {
        Object.keys(this.dropdownStates).forEach(filterKey => {
            this.closeDropdown(filterKey);
        });
    }

    /**
     * NOWA METODA - Ustawienie dropdown'a w trybie loading
     */
    setDropdownLoading(filterKey, isLoading) {
        const camelCase = this.snakeToCamel(filterKey);
        const container = this.filterElements[`${camelCase}Options`];

        if (!container) return;

        if (isLoading) {
            container.innerHTML = `
                <div class="filter-option">
                    <div class="loading-spinner"></div>
                    <label>Ładowanie...</label>
                </div>
            `;
        } else {
            this.updateDropdownOptions(filterKey);
        }
    }

    /**
     * NOWA METODA - Konwersja snake_case na camelCase
     */
    snakeToCamel(str) {
        return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
    }

    /**
     * Sanityzacja ID dla HTML
     */
    sanitizeId(value) {
        return value.replace(/[^a-zA-Z0-9]/g, '_');
    }

    /**
     * Kapitalizacja pierwszej litery
     */
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * NOWA METODA - Pobieranie kontenera filtru (dla kompatybilności)
     */
    getFilterContainer(filterKey) {
        const camelCase = this.snakeToCamel(filterKey);
        return this.filterElements[`${camelCase}Options`];
    }

    /**
     * Ustawienie walidacji w czasie rzeczywistym
     */
    setupRealTimeValidation() {
        // Walidacja wymiarów dla automatycznego obliczania objętości
        const dimensionFields = [
            this.modalElements.lengthCm,
            this.modalElements.widthCm,
            this.modalElements.thicknessCm,
            this.modalElements.quantity
        ];

        dimensionFields.forEach(field => {
            if (field) {
                field.addEventListener('input', () => {
                    this.calculateVolumePreview();
                });
            }
        });

        // Walidacja ceny brutto dla obliczania netto
        if (this.modalElements.priceGross) {
            this.modalElements.priceGross.addEventListener('input', () => {
                this.calculatePricePreview();
            });
        }
    }

    /**
     * Pokazanie modala dodawania/edycji ręcznego wiersza
     */
    showManualRowModal(record = null) {
        console.log('[TableManager] Showing manual row modal', record ? 'for edit' : 'for add');

        if (!this.modalElements.modal) {
            console.error('[TableManager] Modal element not found');
            return;
        }

        // Ustaw tytuł i tryb
        const isEdit = record !== null;
        if (this.modalElements.title) {
            this.modalElements.title.textContent = isEdit ? 'Edytuj wiersz' : 'Dodaj wiersz';
        }

        // Wypełnij formularz
        if (isEdit) {
            this.populateFormWithRecord(record);
        } else {
            this.resetForm();
        }

        // Pokaż modal
        this.modalElements.modal.classList.add('show');
        this.modalElements.modal.style.display = 'block';

        // Focus na pierwszy input
        if (this.modalElements.dateCreated) {
            setTimeout(() => {
                this.modalElements.dateCreated.focus();
            }, 100);
        }
    }

    /**
     * Ukrycie modala
     */
    hideManualRowModal() {
        console.log('[TableManager] Hiding manual row modal');

        if (this.modalElements.modal) {
            this.modalElements.modal.classList.remove('show');
            this.modalElements.modal.style.display = 'none';
        }

        this.resetForm();
    }

    /**
     * Wypełnienie formularza danymi rekordu (edycja)
     */
    populateFormWithRecord(record) {
        console.log('[TableManager] Populating form with record:', record.id);

        // Podstawowe dane
        this.setFieldValue('recordId', record.id);
        this.setFieldValue('dateCreated', record.date_created.split('T')[0]); // Konwersja do YYYY-MM-DD
        this.setFieldValue('internalOrderNumber', record.internal_order_number);
        this.setFieldValue('customerName', record.customer_name);
        this.setFieldValue('phone', record.phone);
        this.setFieldValue('deliveryAddress', record.delivery_address);
        this.setFieldValue('deliveryPostcode', record.delivery_postcode);
        this.setFieldValue('deliveryCity', record.delivery_city);
        this.setFieldValue('deliveryState', record.delivery_state);

        // Dane produktu
        this.setFieldValue('groupType', record.group_type);
        this.setFieldValue('productType', record.product_type);
        this.setFieldValue('woodSpecies', record.wood_species);
        this.setFieldValue('technology', record.technology);
        this.setFieldValue('woodClass', record.wood_class);
        this.setFieldValue('finishState', record.finish_state);

        // Wymiary
        this.setFieldValue('lengthCm', record.length_cm);
        this.setFieldValue('widthCm', record.width_cm);
        this.setFieldValue('thicknessCm', record.thickness_cm);
        this.setFieldValue('quantity', record.quantity);

        // Ceny
        this.setFieldValue('priceGross', record.price_gross);
        this.setFieldValue('deliveryCost', record.delivery_cost);

        // Pozostałe
        this.setFieldValue('deliveryMethod', record.delivery_method);
        this.setFieldValue('orderSource', record.order_source);
        this.setFieldValue('paymentMethod', record.payment_method);
        this.setFieldValue('paidAmountNet', record.paid_amount_net);
        this.setFieldValue('currentStatus', record.current_status);

        // Przelicz podglądy
        this.calculateVolumePreview();
        this.calculatePricePreview();
    }

    /**
     * Reset formularza
     */
    resetForm() {
        if (!this.modalElements.form) return;

        this.modalElements.form.reset();

        // Ustaw wartości domyślne
        this.setFieldValue('dateCreated', new Date().toISOString().split('T')[0]);
        this.setFieldValue('quantity', '1');
        this.setFieldValue('finishState', 'surowy');
        this.setFieldValue('deliveryCost', '0');
        this.setFieldValue('paidAmountNet', '0');
        this.setFieldValue('currentStatus', 'Nowe - opłacone');
        this.setFieldValue('productType', 'deska'); // Domyślnie deska
        this.setFieldValue('recordId', '');

        console.log('[TableManager] Form reset');
    }

    /**
     * Ustawienie wartości pola
     */
    setFieldValue(fieldName, value) {
        const element = this.modalElements[fieldName];
        if (element && value !== null && value !== undefined) {
            element.value = value;
        }
    }

    /**
     * Pobieranie wartości pola
     */
    getFieldValue(fieldName) {
        const element = this.modalElements[fieldName];
        return element ? element.value : '';
    }

    /**
     * Obliczanie podglądu objętości
     */
    calculateVolumePreview() {
        const length = parseFloat(this.getFieldValue('lengthCm')) || 0;
        const width = parseFloat(this.getFieldValue('widthCm')) || 0;
        const thickness = parseFloat(this.getFieldValue('thicknessCm')) || 0;
        const quantity = parseInt(this.getFieldValue('quantity')) || 0;

        if (length > 0 && width > 0 && thickness > 0 && quantity > 0) {
            const volumePerPiece = (length * width * thickness) / 1000000; // cm3 to m3
            const totalVolume = volumePerPiece * quantity;

            // Pokaż podgląd (można dodać element do formularza)
            console.log('[TableManager] Volume preview:', {
                volumePerPiece: volumePerPiece.toFixed(4),
                totalVolume: totalVolume.toFixed(4)
            });
        }
    }

    /**
     * Obliczanie podglądu ceny netto
     */
    calculatePricePreview() {
        const priceGross = parseFloat(this.getFieldValue('priceGross')) || 0;

        if (priceGross > 0) {
            const priceNet = priceGross / 1.23;

            console.log('[TableManager] Price preview:', {
                priceGross: priceGross.toFixed(2),
                priceNet: priceNet.toFixed(2)
            });
        }
    }

    /**
     * Zapisywanie ręcznego wiersza
     */
    async saveManualRow() {
        console.log('[TableManager] Saving manual row...');

        if (!this.validateForm()) {
            return;
        }

        this.setLoadingState(true);

        try {
            // Przygotuj dane
            const formData = this.collectFormData();
            const isEdit = formData.record_id && formData.record_id.trim();

            // Wybierz endpoint
            const endpoint = isEdit ? '/reports/api/update-manual-row' : '/reports/api/add-manual-row';

            console.log('[TableManager] Sending data to:', endpoint, formData);

            // Wyślij zapytanie
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (result.success) {
                console.log('[TableManager] Manual row saved successfully');

                // Zamknij modal
                this.hideManualRowModal();

                // Odśwież dane
                if (window.reportsManager) {
                    window.reportsManager.refreshData();
                }

                // Pokaż komunikat sukcesu
                this.showMessage(result.message || 'Wiersz został zapisany', 'success');

            } else {
                throw new Error(result.error || 'Błąd zapisu');
            }

        } catch (error) {
            console.error('[TableManager] Error saving manual row:', error);
            this.showMessage('Błąd zapisu: ' + error.message, 'error');
        } finally {
            this.setLoadingState(false);
        }
    }

    /**
     * Walidacja formularza
     */
    validateForm() {
        const requiredFields = [
            { field: 'dateCreated', name: 'Data' },
            { field: 'customerName', name: 'Imię i nazwisko' },
            { field: 'groupType', name: 'Grupa' },
            { field: 'productType', name: 'Rodzaj' },
            { field: 'quantity', name: 'Ilość' }
        ];

        for (const { field, name } of requiredFields) {
            const value = this.getFieldValue(field);
            if (!value || value.trim() === '') {
                this.showMessage(`Pole "${name}" jest wymagane`, 'error');

                // Focus na pole
                const element = this.modalElements[field];
                if (element) {
                    element.focus();
                }

                return false;
            }
        }

        // Walidacja liczb
        const numericFields = ['lengthCm', 'widthCm', 'thicknessCm', 'quantity', 'priceGross'];
        for (const field of numericFields) {
            const value = this.getFieldValue(field);
            if (value && isNaN(parseFloat(value))) {
                this.showMessage(`Pole "${field}" musi być liczbą`, 'error');
                return false;
            }
        }

        console.log('[TableManager] Form validation passed');
        return true;
    }

    /**
     * Zbieranie danych z formularza
     */
    collectFormData() {
        const data = {};

        // Pobierz wszystkie wartości z formularza
        Object.keys(this.modalElements).forEach(key => {
            if (key !== 'modal' && key !== 'title' && key !== 'form' &&
                key !== 'cancelBtn' && key !== 'saveBtn') {
                const value = this.getFieldValue(key);
                if (value !== '') {
                    data[this.camelToSnake(key)] = value;
                }
            }
        });

        console.log('[TableManager] Collected form data:', data);
        return data;
    }

    /**
     * Konwersja camelCase na snake_case
     */
    camelToSnake(str) {
        return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    }

    /**
     * Ustawienie stanu ładowania dla modala
     */
    setLoadingState(loading) {
        if (this.modalElements.saveBtn) {
            this.modalElements.saveBtn.disabled = loading;
            this.modalElements.saveBtn.innerHTML = loading ?
                '<i class="fas fa-spinner fa-spin"></i> Zapisywanie...' :
                'Zapisz';
        }

        if (this.modalElements.cancelBtn) {
            this.modalElements.cancelBtn.disabled = loading;
        }
    }

    /**
     * Pokazywanie komunikatu
     */
    showMessage(message, type = 'info') {
        console.log(`[TableManager] ${type.toUpperCase()}:`, message);

        // TODO: Implementacja lepszego systemu notyfikacji
        if (type === 'error') {
            alert('Błąd: ' + message);
        } else {
            alert(message);
        }
    }

    /**
     * NOWA METODA - Sprawdzenie czy dropdown jest otwarty
     */
    isDropdownOpen(filterKey) {
        return this.dropdownStates[filterKey] || false;
    }

    /**
     * NOWA METODA - Refresh dropdown'a po zmianie danych
     */
    refreshDropdown(filterKey) {
        this.updateDropdownOptions(filterKey);

        // Jeśli dropdown jest otwarty, odśwież search
        if (this.isDropdownOpen(filterKey)) {
            const camelCase = this.snakeToCamel(filterKey);
            const search = this.filterElements[`search${this.capitalizeFirst(camelCase)}`];
            if (search) {
                this.filterDropdownOptions(filterKey, search.value);
            }
        }
    }

    /**
     * NOWA METODA - Pobieranie aktualnych filtrów
     */
    getCurrentFilters() {
        return { ...this.activeFilters };
    }

    /**
     * NOWA METODA - Sprawdzenie czy jakiś filtr jest aktywny
     */
    hasActiveFilters() {
        return Object.keys(this.activeFilters).some(key =>
            this.activeFilters[key] && this.activeFilters[key].length > 0
        );
    }

    /**
     * NOWA METODA - Pobieranie liczby aktywnych filtrów
     */
    getActiveFiltersCount() {
        return Object.keys(this.activeFilters).reduce((count, key) => {
            return count + (this.activeFilters[key] ? this.activeFilters[key].length : 0);
        }, 0);
    }

    /**
     * NOWA METODA - Eksport stanu filtrów
     */
    exportFiltersState() {
        return {
            activeFilters: { ...this.activeFilters },
            dropdownStates: { ...this.dropdownStates }
        };
    }

    /**
     * NOWA METODA - Import stanu filtrów
     */
    importFiltersState(state) {
        if (state.activeFilters) {
            this.activeFilters = { ...state.activeFilters };
        }
        if (state.dropdownStates) {
            this.dropdownStates = { ...state.dropdownStates };
        }

        // Aktualizuj interfejs
        Object.keys(this.activeFilters).forEach(filterKey => {
            this.updateDropdownOptions(filterKey);
        });
    }

    /**
     * Publiczne API
     */
    refreshDropdownData() {
        console.log('[TableManager] Manual dropdown refresh requested');
        this.loadDropdownData();
    }

    getDropdownData(fieldName) {
        return this.dropdownData[fieldName] || [];
    }

    getActiveFilters() {
        return { ...this.activeFilters };
    }

    setActiveFilters(filters) {
        this.activeFilters = { ...filters };

        // Aktualizuj interfejs
        Object.keys(this.activeFilters).forEach(filterKey => {
            this.updateDropdownOptions(filterKey);
        });
    }

    /**
     * Debug info
     */
    getDebugInfo() {
        return {
            activeFilters: this.activeFilters,
            dropdownStates: this.dropdownStates,
            dropdownData: Object.keys(this.dropdownData).reduce((acc, key) => {
                acc[key] = this.dropdownData[key].length;
                return acc;
            }, {}),
            hasActiveFilters: this.hasActiveFilters(),
            activeFiltersCount: this.getActiveFiltersCount(),
            isInitialized: this.isInitialized
        };
    }
}

// Export dla global scope
window.TableManager = TableManager;