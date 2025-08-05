// app/modules/reports/static/js/volume_manager.js
// Nowy moduł do zarządzania modalem objętości

class VolumeManager {
    constructor() {
        this.volumeModal = null;
        this.productsNeedingVolume = [];
        this.volumeData = {};
        this.isInitialized = false;

        this.init();
    }

    init() {
        if (this.isInitialized) return;

        console.log('[VolumeManager] Inicjalizacja modala objętości');

        this.volumeModal = document.getElementById('volumeModal');
        if (!this.volumeModal) {
            console.error('[VolumeManager] Nie znaleziono modala objętości');
            return;
        }

        this.bindEvents();
        this.isInitialized = true;
    }

    bindEvents() {
        // Zamknięcie modala
        const closeBtn = document.getElementById('volumeModalClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideModal());
        }

        // Przyciski w stopce
        const backBtn = document.getElementById('volumeBack');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.handleBack());
        }

        const skipBtn = document.getElementById('volumeSkip');
        if (skipBtn) {
            skipBtn.addEventListener('click', () => this.handleSkip());
        }

        const saveBtn = document.getElementById('volumeSave');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.handleSave());
        }

        // Zamknięcie modala przy kliknięciu na overlay
        this.volumeModal.addEventListener('click', (e) => {
            if (e.target === this.volumeModal || e.target.classList.contains('sync-modal-overlay')) {
                this.hideModal();
            }
        });
    }

    /**
     * Pokazuje modal z produktami wymagającymi uzupełnienia objętości
     * @param {Array} productsData - Lista produktów do uzupełnienia
     */
    showModal(productsData) {
        console.log('[VolumeManager] Pokazywanie modala objętości', productsData);

        this.productsNeedingVolume = productsData;
        this.volumeData = {};

        this.renderProducts();
        this.volumeModal.style.display = 'flex';

        // Focus na pierwszy input
        setTimeout(() => {
            const firstInput = this.volumeModal.querySelector('.volume-input');
            if (firstInput) firstInput.focus();
        }, 100);
    }

    hideModal() {
        console.log('[VolumeManager] Ukrywanie modala objętości');
        this.volumeModal.style.display = 'none';
        this.clearData();
    }

    renderProducts() {
        const container = document.getElementById('volumeProductsList');
        if (!container) return;

        container.innerHTML = '';

        // Grupuj produkty według zamówień
        const orderGroups = this.groupProductsByOrder();

        Object.entries(orderGroups).forEach(([orderId, orderData]) => {
            const orderElement = this.createOrderElement(orderId, orderData);
            container.appendChild(orderElement);
        });

        // Bind events dla inputów
        this.bindInputEvents();
    }

    groupProductsByOrder() {
        const groups = {};

        this.productsNeedingVolume.forEach(product => {
            const orderId = product.order_id;

            if (!groups[orderId]) {
                groups[orderId] = {
                    order_info: product.order_info || {},
                    products: []
                };
            }

            groups[orderId].products.push(product);
        });

        return groups;
    }

    createOrderElement(orderId, orderData) {
        const template = document.getElementById('volumeOrderTemplate');
        const clone = template.content.cloneNode(true);

        // Ustaw dane zamówienia
        const orderNumber = clone.querySelector('.order-number');
        const customerName = clone.querySelector('.customer-name');
        const orderDate = clone.querySelector('.order-date');

        if (orderNumber) orderNumber.textContent = orderId;
        if (customerName) customerName.textContent = orderData.order_info.customer_name || 'Nieznany klient';
        if (orderDate) orderDate.textContent = orderData.order_info.date || 'Brak daty';

        // Dodaj produkty
        const productsContainer = clone.querySelector('.volume-products-container');
        orderData.products.forEach(product => {
            const productElement = this.createProductElement(product);
            productsContainer.appendChild(productElement);
        });

        return clone;
    }

    createProductElement(product) {
        const template = document.getElementById('volumeProductTemplate');
        const clone = template.content.cloneNode(true);

        const productKey = `${product.order_id}_${product.product_id || 'unknown'}`;

        // Ustaw klucz produktu
        const productItem = clone.querySelector('.volume-product-item');
        productItem.setAttribute('data-product-key', productKey);

        // Ustaw dane produktu
        const productName = clone.querySelector('.product-name');
        const quantityValue = clone.querySelector('.quantity-value');

        if (productName) productName.textContent = product.product_name || 'Nieznany produkt';
        if (quantityValue) quantityValue.textContent = product.quantity || 1;

        // Ustaw ID dla inputów
        const inputs = clone.querySelectorAll('.volume-input, .volume-select');
        inputs.forEach((input, index) => {
            const field = input.getAttribute('data-field');
            input.id = `${productKey}_${field}`;

            // Ustaw label for
            const label = input.closest('.volume-input-group').querySelector('label');
            if (label) label.setAttribute('for', input.id);
        });

        // Jeśli są automatycznie wykryte atrybuty, ustaw je
        if (product.analysis) {
            this.setAutoDetectedValues(clone, product.analysis);
        }

        return clone;
    }

    setAutoDetectedValues(element, analysis) {
        // Ustaw automatycznie wykryte wartości
        const fields = ['wood_species', 'technology', 'wood_class'];

        fields.forEach(field => {
            if (analysis[field]) {
                const select = element.querySelector(`[data-field="${field}"]`);
                const helpText = select?.closest('.volume-input-group').querySelector('.auto-detected');

                if (select) {
                    select.value = analysis[field];
                    if (helpText) {
                        helpText.textContent = `Wykryto automatycznie: ${analysis[field]}`;
                        helpText.style.display = 'block';
                    }
                }
            }
        });
    }

    bindInputEvents() {
        // Event listenery dla inputów objętości
        const volumeInputs = this.volumeModal.querySelectorAll('.volume-input[data-field="volume"]');
        volumeInputs.forEach(input => {
            input.addEventListener('input', (e) => this.handleVolumeInput(e));
            input.addEventListener('blur', (e) => this.validateVolumeInput(e));
        });

        // Event listenery dla selectów
        const selects = this.volumeModal.querySelectorAll('.volume-select');
        selects.forEach(select => {
            select.addEventListener('change', (e) => this.handleSelectChange(e));
        });
    }

    handleVolumeInput(event) {
        const input = event.target;
        const productKey = input.closest('.volume-product-item').getAttribute('data-product-key');
        const volume = parseFloat(input.value) || 0;

        // Aktualizuj dane
        if (!this.volumeData[productKey]) {
            this.volumeData[productKey] = {};
        }
        this.volumeData[productKey].volume = volume;

        // Aktualizuj podsumowanie
        this.updateVolumeSummary(productKey);

        // Walidacja
        this.validateVolumeInput(event);
    }

    handleSelectChange(event) {
        const select = event.target;
        const productKey = select.closest('.volume-product-item').getAttribute('data-product-key');
        const field = select.getAttribute('data-field');
        const value = select.value;

        // Aktualizuj dane
        if (!this.volumeData[productKey]) {
            this.volumeData[productKey] = {};
        }
        this.volumeData[productKey][field] = value;

        console.log(`[VolumeManager] Zaktualizowano ${field} dla ${productKey}: ${value}`);
    }

    validateVolumeInput(event) {
        const input = event.target;
        const value = parseFloat(input.value);

        // Resetuj klasy
        input.classList.remove('is-invalid', 'is-valid');

        if (!input.value || value <= 0) {
            input.classList.add('is-invalid');
        } else {
            input.classList.add('is-valid');
        }

        this.updateSaveButtonState();
    }

    updateVolumeSummary(productKey) {
        const productItem = this.volumeModal.querySelector(`[data-product-key="${productKey}"]`);
        if (!productItem) return;

        const quantityElement = productItem.querySelector('.quantity-value');
        const totalVolumeElement = productItem.querySelector('.total-volume');

        if (!quantityElement || !totalVolumeElement) return;

        const quantity = parseInt(quantityElement.textContent) || 1;
        const volumePerPiece = this.volumeData[productKey]?.volume || 0;
        const totalVolume = volumePerPiece * quantity;

        totalVolumeElement.textContent = `${totalVolume.toFixed(3)} m³`;
    }

    updateSaveButtonState() {
        const saveBtn = document.getElementById('volumeSave');
        if (!saveBtn) return;

        const requiredInputs = this.volumeModal.querySelectorAll('.volume-required');
        const allValid = Array.from(requiredInputs).every(input => {
            const value = parseFloat(input.value);
            return input.value && value > 0;
        });

        saveBtn.disabled = !allValid;

        if (allValid) {
            saveBtn.textContent = `Zapisz z objętościami (${requiredInputs.length})`;
        } else {
            saveBtn.textContent = 'Uzupełnij wymagane pola';
        }
    }

    handleBack() {
        console.log('[VolumeManager] Powrót do listy zamówień');
        this.hideModal();

        // Pokaż poprzedni modal (lista zamówień)
        const ordersModal = document.getElementById('syncOrdersModal');
        if (ordersModal) {
            ordersModal.style.display = 'flex';
        }
    }

    handleSkip() {
        console.log('[VolumeManager] Pominięcie uzupełniania objętości');

        if (!confirm('Czy na pewno chcesz pominąć uzupełnianie objętości? Produkty bez objętości będą miały wartość 0 m³.')) {
            return;
        }

        // Ustaw objętość 0 dla wszystkich produktów
        this.productsNeedingVolume.forEach(product => {
            const productKey = `${product.order_id}_${product.product_id || 'unknown'}`;
            this.volumeData[productKey] = { volume: 0 };
        });

        this.proceedWithSave();
    }

    async handleSave() {
        console.log('[VolumeManager] Zapisywanie z uzupełnionymi objętościami');

        if (!this.validateAllInputs()) {
            alert('Proszę uzupełnić wszystkie wymagane pola objętości.');
            return;
        }

        await this.proceedWithSave();
    }

    validateAllInputs() {
        const requiredInputs = this.volumeModal.querySelectorAll('.volume-required');
        return Array.from(requiredInputs).every(input => {
            const value = parseFloat(input.value);
            return input.value && value > 0;
        });
    }

    async proceedWithSave() {
        try {
            this.showSaveProgress();

            // Pobierz wybrane zamówienia z poprzedniego kroku
            const selectedOrderIds = Array.from(new Set(
                this.productsNeedingVolume.map(p => p.order_id)
            ));

            console.log('[VolumeManager] Zapisywanie zamówień:', selectedOrderIds);
            console.log('[VolumeManager] Dane objętości:', this.volumeData);

            const response = await fetch('/reports/api/save-orders-with-volumes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    order_ids: selectedOrderIds,
                    volume_fixes: this.volumeData
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccessMessage(result);
                this.hideModal();

                // Odśwież tabelę raportów
                if (window.reportsManager) {
                    window.reportsManager.refreshTable();
                }
            } else {
                throw new Error(result.error || 'Nieznany błąd');
            }

        } catch (error) {
            console.error('[VolumeManager] Błąd zapisywania:', error);
            alert(`Błąd zapisywania zamówień: ${error.message}`);
        } finally {
            this.hideSaveProgress();
        }
    }

    showSaveProgress() {
        const saveBtn = document.getElementById('volumeSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Zapisywanie...';
        }
    }

    hideSaveProgress() {
        const saveBtn = document.getElementById('volumeSave');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Zapisz z objętościami';
        }
    }

    showSuccessMessage(result) {
        const message = result.message || 'Zamówienia zostały pomyślnie zapisane';

        // Pokaż toast lub alert
        if (window.showToast) {
            window.showToast(message, 'success');
        } else {
            alert(message);
        }
    }

    clearData() {
        this.productsNeedingVolume = [];
        this.volumeData = {};
    }

    /**
     * Publiczne API dla integracji z SyncManager
     */
    getVolumeData() {
        return this.volumeData;
    }

    hasVolumeData() {
        return Object.keys(this.volumeData).length > 0;
    }
}

// Inicjalizacja globalnego instance
let volumeManager = null;

document.addEventListener('DOMContentLoaded', function () {
    volumeManager = new VolumeManager();

    // Udostępnij globalnie dla innych modułów
    window.volumeManager = volumeManager;
});

// Export dla użycia w innych plikach
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VolumeManager;
}