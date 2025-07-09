// modules/reports/static/js/table_manager.js
/**
 * Manager zarządzający filtrami checkbox i dodawaniem/edycją wierszy
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

        console.log('[TableManager] Initialized');
    }

    /**
     * Inicjalizacja managera
     */
    init() {
        console.log('[TableManager] Starting initialization...');

        this.cacheElements();
        this.setupEventListeners();
        this.setupCheckboxFilters();
        this.loadDropdownData();

        this.isInitialized = true;
        console.log('[TableManager] Initialization complete');
    }

    /**
     * Cache elementów DOM
     */
    cacheElements() {
        // Filtry checkbox
        this.filterElements = {
            customerNameContainer: document.getElementById('filterCustomerNameContainer'),
            customerNameOptions: document.getElementById('filterCustomerNameOptions'),
            searchCustomerName: document.getElementById('searchCustomerName'),

            deliveryStateContainer: document.getElementById('filterDeliveryStateContainer'),
            deliveryStateOptions: document.getElementById('filterDeliveryStateOptions'),
            searchDeliveryState: document.getElementById('searchDeliveryState'),

            woodSpeciesContainer: document.getElementById('filterWoodSpeciesContainer'),
            woodSpeciesOptions: document.getElementById('filterWoodSpeciesOptions'),
            searchWoodSpecies: document.getElementById('searchWoodSpecies'),

            currentStatusContainer: document.getElementById('filterCurrentStatusContainer'),
            currentStatusOptions: document.getElementById('filterCurrentStatusOptions'),
            searchCurrentStatus: document.getElementById('searchCurrentStatus')
        };

        // Modal dodawania/edycji
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
     * Ustawienie event listenerów
     */
    setupEventListeners() {
        // Modal events
        if (this.modalElements.modal) {
            // Zamknięcie modala
            const closeBtn = this.modalElements.modal.querySelector('.close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.hideManualRowModal());
            }

            // Kliknięcie poza modalem
            this.modalElements.modal.addEventListener('click', (e) => {
                if (e.target === this.modalElements.modal) {
                    this.hideManualRowModal();
                }
            });
        }

        // Przyciski modala
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

        // Submit formularza
        if (this.modalElements.form) {
            this.modalElements.form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveManualRow();
            });
        }

        // Walidacja w czasie rzeczywistym
        this.setupRealTimeValidation();

        console.log('[TableManager] Event listeners setup complete');
    }

    /**
     * Ustawienie filtrów checkbox
     */
    setupCheckboxFilters() {
        // Event listenery dla wyszukiwania
        Object.keys(this.activeFilters).forEach(filterKey => {
            const searchElement = this.filterElements[`search${this.capitalizeFirst(filterKey.replace('_', ''))}`];
            if (searchElement) {
                searchElement.addEventListener('input', (e) => {
                    this.filterDropdownOptions(filterKey, e.target.value);
                });
            }
        });

        console.log('[TableManager] Checkbox filters setup complete');
    }

    /**
     * Filtrowanie opcji dropdown'a na podstawie wyszukiwania
     */
    filterDropdownOptions(filterKey, searchTerm) {
        const optionsContainer = this.filterElements[`${filterKey.replace('_', '')}Options`];
        if (!optionsContainer) return;

        const options = optionsContainer.querySelectorAll('.filter-option');
        const term = searchTerm.toLowerCase();

        options.forEach(option => {
            const label = option.querySelector('label').textContent.toLowerCase();
            if (label.includes(term)) {
                option.style.display = 'flex';
            } else {
                option.style.display = 'none';
            }
        });
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
     * Ładowanie danych dla dropdown'ów
     */
    async loadDropdownData() {
        console.log('[TableManager] Loading dropdown data...');

        const fieldsToLoad = Object.keys(this.dropdownData);

        try {
            // Ładuj dane dla każdego pola równolegle
            const promises = fieldsToLoad.map(field => this.loadDropdownValues(field));
            const results = await Promise.all(promises);

            // Aktualizuj dropdown'y
            fieldsToLoad.forEach((field, index) => {
                this.dropdownData[field] = results[index] || [];
                this.updateDropdownOptions(field);
            });

            console.log('[TableManager] Dropdown data loaded successfully');

        } catch (error) {
            console.error('[TableManager] Error loading dropdown data:', error);
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
     * Aktualizacja opcji dropdown'a
     */
    updateDropdownOptions(fieldName) {
        // Mapowanie nazw pól na kontenery
        const containerMapping = {
            customer_name: this.filterElements.customerNameOptions,
            delivery_state: this.filterElements.deliveryStateOptions,
            wood_species: this.filterElements.woodSpeciesOptions,
            current_status: this.filterElements.currentStatusOptions
        };

        const container = containerMapping[fieldName];
        if (!container) return;

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

        console.log(`[TableManager] Updated dropdown ${fieldName} with ${values.length} options`);
    }

    /**
     * Sanityzacja ID dla HTML
     */
    sanitizeId(value) {
        return value.replace(/[^a-zA-Z0-9]/g, '_');
    }

    /**
     * Obsługa zmiany filtra checkbox
     */
    handleFilterChange(filterKey, value, isChecked) {
        console.log('[TableManager] Filter changed:', filterKey, value, isChecked);

        if (!this.activeFilters[filterKey]) {
            this.activeFilters[filterKey] = [];
        }

        if (isChecked) {
            // Dodaj wartość do filtra
            if (!this.activeFilters[filterKey].includes(value)) {
                this.activeFilters[filterKey].push(value);
            }
        } else {
            // Usuń wartość z filtra
            const index = this.activeFilters[filterKey].indexOf(value);
            if (index > -1) {
                this.activeFilters[filterKey].splice(index, 1);
            }
        }

        // Wyczyść puste filtry
        if (this.activeFilters[filterKey].length === 0) {
            delete this.activeFilters[filterKey];
        }

        // Prześlij zmiany do ReportsManager
        if (window.reportsManager) {
            window.reportsManager.setFilter(filterKey, this.activeFilters[filterKey] || []);
        }
    }

    /**
     * Aktualizacja checkboxów z zewnątrz (z ReportsManager)
     */
    updateFilterCheckboxes(filterKey, value, isChecked) {
        const container = this.getFilterContainer(filterKey);
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
    }

    /**
     * Pobieranie kontenera filtru
     */
    getFilterContainer(filterKey) {
        const containerMapping = {
            customer_name: this.filterElements.customerNameOptions,
            delivery_state: this.filterElements.deliveryStateOptions,
            wood_species: this.filterElements.woodSpeciesOptions,
            current_status: this.filterElements.currentStatusOptions
        };

        return containerMapping[filterKey];
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
     * Kapitalizacja pierwszej litery
     */
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
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
     * Czyszczenie filtrów
     */
    clearFilters() {
        console.log('[TableManager] Clearing filters...');

        // Wyczyść stany checkbox'ów
        Object.keys(this.activeFilters).forEach(filterKey => {
            const container = this.getFilterContainer(filterKey);
            if (container) {
                container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                    checkbox.checked = false;
                });
            }
        });

        // Wyczyść wyszukiwania
        Object.keys(this.activeFilters).forEach(filterKey => {
            const searchElement = this.filterElements[`search${this.capitalizeFirst(filterKey.replace('_', ''))}`];
            if (searchElement) {
                searchElement.value = '';
                this.filterDropdownOptions(filterKey, ''); // Pokaż wszystkie opcje
            }
        });

        // Wyczyść lokalny stan
        this.activeFilters = {
            customer_name: [],
            delivery_state: [],
            wood_species: [],
            current_status: []
        };

        console.log('[TableManager] Filters cleared');
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
}

// Export dla global scope
window.TableManager = TableManager;