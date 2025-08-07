// app/modules/reports/static/js/volume_manager.js
// Ulepszona wersja z step-by-step workflow i auto-wypełnianiem

class VolumeManager {
    constructor() {
        this.volumeModal = null;
        this.productsNeedingVolume = [];
        this.volumeData = {};
        this.currentProductIndex = 0;
        this.isStepByStepMode = false; // true = step-by-step, false = wszystkie w jednym modalu
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

        // Przyciski w stopce - będą dynamicznie zmieniane w zależności od trybu
        this.bindFooterEvents();

        // Zamknięcie modala przy kliknięciu na overlay
        this.volumeModal.addEventListener('click', (e) => {
            if (e.target === this.volumeModal || e.target.classList.contains('sync-modal-overlay')) {
                this.hideModal();
            }
        });
    }

    bindFooterEvents() {
        const footer = this.volumeModal.querySelector('.sync-modal-footer');
        if (!footer) return;

        // Usuń poprzednie event listenery poprzez klonowanie
        const newFooter = footer.cloneNode(true);
        footer.parentNode.replaceChild(newFooter, footer);

        // Przyciski dla step-by-step mode
        const prevBtn = newFooter.querySelector('#volumePrev');
        const nextBtn = newFooter.querySelector('#volumeNext');
        const finishBtn = newFooter.querySelector('#volumeFinish');

        // Przyciski dla batch mode  
        const backBtn = newFooter.querySelector('#volumeBack');
        const skipBtn = newFooter.querySelector('#volumeSkip');
        const saveBtn = newFooter.querySelector('#volumeSave');

        if (prevBtn) prevBtn.addEventListener('click', () => this.handlePrevious());
        if (nextBtn) nextBtn.addEventListener('click', () => this.handleNext());
        if (finishBtn) finishBtn.addEventListener('click', () => this.handleFinish());

        if (backBtn) backBtn.addEventListener('click', () => this.handleBack());
        if (skipBtn) skipBtn.addEventListener('click', () => this.handleSkip());
        if (saveBtn) saveBtn.addEventListener('click', () => this.handleSave());
    }

    /**
     * Pokazuje modal z produktami wymagającymi uzupełnienia objętości
     * @param {Array} productsData - Lista produktów do uzupełnienia
     */
    showModal(productsData) {
        console.log('[VolumeManager] Pokazywanie modala objętości', productsData);

        this.productsNeedingVolume = productsData;
        this.volumeData = {};
        this.currentProductIndex = 0;

        // Określ tryb pracy na podstawie struktury danych
        this.determineWorkflowMode();
        
        // Auto-wypełnij wykryte objętości
        this.prePopulateDetectedVolumes();

        // Renderuj modal w odpowiednim trybie
        if (this.isStepByStepMode) {
            this.renderStepByStepMode();
        } else {
            this.renderBatchMode();
        }

        this.updateFooterButtons();
        this.volumeModal.style.display = 'flex';

        // Focus na pierwszy input
        setTimeout(() => {
            const firstInput = this.volumeModal.querySelector('.volume-input');
            if (firstInput) firstInput.focus();
        }, 100);
    }

    /**
     * Określa tryb pracy na podstawie struktury produktów
     */
    determineWorkflowMode() {
        // Grupuj produkty według zamówień
        const orderGroups = {};
        this.productsNeedingVolume.forEach(product => {
            const orderId = product.order_id;
            if (!orderGroups[orderId]) {
                orderGroups[orderId] = [];
            }
            orderGroups[orderId].push(product);
        });

        const orderIds = Object.keys(orderGroups);
        
        // Step-by-step gdy produkty z różnych zamówień
        // Batch mode gdy wszystkie produkty z tego samego zamówienia
        this.isStepByStepMode = orderIds.length > 1;
        
        console.log(`[VolumeManager] Tryb pracy: ${this.isStepByStepMode ? 'step-by-step' : 'batch'}`);
        console.log(`[VolumeManager] Zamówienia: ${orderIds.length}, Produkty: ${this.productsNeedingVolume.length}`);
    }

    /**
     * Auto-wypełnia wykryte objętości z analizy nazw produktów
     */
    prePopulateDetectedVolumes() {
        this.productsNeedingVolume.forEach(product => {
            const productKey = `${product.order_id}_${product.product_id || 'unknown'}`;
            const analysis = product.analysis || {};

            // Jeśli wykryto objętość w nazwie produktu
            if (analysis.analysis_type === 'volume_only' && analysis.volume) {
                let volume = parseFloat(analysis.volume);
                
                // Zaokrąglij do 4 miejsc po przecinku
                volume = Math.round(volume * 10000) / 10000;
                
                // Zapisz auto-wykrytą objętość
                this.volumeData[productKey] = {
                    volume: volume,
                    wood_species: analysis.wood_species || '',
                    technology: analysis.technology || '',
                    wood_class: analysis.wood_class || '',
                    auto_detected: true // flaga oznaczająca auto-wykrycie
                };

                console.log(`[VolumeManager] Auto-wypełniono objętość ${volume} m³ dla produktu: ${product.product_name}`);
            }
        });
    }

    /**
     * Renderuje modal w trybie step-by-step (produkt po produkcie)
     */
    renderStepByStepMode() {
        const modalHeader = this.volumeModal.querySelector('.sync-modal-header h3');
        const modalBody = this.volumeModal.querySelector('.sync-modal-body');

        // Nagłówek z progress barem
        modalHeader.innerHTML = this.createStepByStepHeader();

        // Lista produktów po lewej + aktualny produkt po prawej
        modalBody.innerHTML = this.createStepByStepBody();

        // Bind events dla nawigacji i inputów
        this.bindStepByStepEvents();
        this.showCurrentProduct();
    }

    /**
     * Renderuje modal w trybie batch (wszystkie produkty naraz)
     */
    renderBatchMode() {
        const modalHeader = this.volumeModal.querySelector('.sync-modal-header h3');
        const modalBody = this.volumeModal.querySelector('.sync-modal-body');

        modalHeader.innerHTML = 'Uzupełnij objętości produktów';
        modalBody.innerHTML = this.createBatchBody();

        this.bindBatchEvents();
    }

    createStepByStepHeader() {
        const current = this.currentProductIndex + 1;
        const total = this.productsNeedingVolume.length;
        const progress = (current / total) * 100;

        return `
            <div class="step-progress-container">
                <div class="step-progress-header">
                    <span>Uzupełnianie objętości</span>
                    <span class="progress-counter">Produkt ${current} z ${total}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
            </div>
        `;
    }

    createStepByStepBody() {
        return `
            <div class="step-by-step-container">
                <!-- Lista produktów po lewej -->
                <div class="products-checklist">
                    <h4>Lista produktów:</h4>
                    <div id="productsChecklistContainer">
                        ${this.createProductsChecklist()}
                    </div>
                </div>

                <!-- Aktualny produkt po prawej -->
                <div class="current-product-container">
                    <div id="currentProductForm">
                        <!-- Zostanie wypełnione dynamicznie -->
                    </div>
                </div>
            </div>
        `;
    }

    createProductsChecklist() {
        return this.productsNeedingVolume.map((product, index) => {
            const productKey = `${product.order_id}_${product.product_id || 'unknown'}`;
            const isCompleted = this.volumeData[productKey] && this.volumeData[productKey].volume > 0;
            const isCurrent = index === this.currentProductIndex;
            
            return `
                <div class="checklist-item ${isCurrent ? 'current' : ''} ${isCompleted ? 'completed' : ''}" 
                     data-product-index="${index}">
                    <div class="checklist-icon">
                        ${isCompleted ? '✅' : (isCurrent ? '▶️' : '⏸️')}
                    </div>
                    <div class="checklist-content">
                        <div class="product-name-short">${this.truncateText(product.product_name, 40)}</div>
                        <div class="order-info-small">Zamówienie #${product.order_id}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    createBatchBody() {
        const orderGroups = this.groupProductsByOrder();
        
        return `
            <div class="volume-info">
                <div class="info-icon">📏</div>
                <div class="info-text">
                    <p><strong>Produkty wymagają uzupełnienia objętości.</strong></p>
                    <p>Niektóre objętości zostały automatycznie wykryte i wypełnione - możesz je skorygować.</p>
                </div>
            </div>
            <div id="volumeProductsList" class="volume-products-list">
                ${Object.entries(orderGroups).map(([orderId, orderData]) => 
                    this.createOrderElement(orderId, orderData)
                ).join('')}
            </div>
        `;
    }

    showCurrentProduct() {
        if (!this.isStepByStepMode) return;

        const product = this.productsNeedingVolume[this.currentProductIndex];
        if (!product) return;

        const container = document.getElementById('currentProductForm');
        if (!container) return;

        const productKey = `${product.order_id}_${product.product_id || 'unknown'}`;
        const savedData = this.volumeData[productKey] || {};

        container.innerHTML = `
            <div class="current-product-card">
                <div class="product-header">
                    <h4>${product.product_name}</h4>
                    <div class="product-meta">
                        <span>Zamówienie #${product.order_id}</span>
                        <span>Ilość: ${product.quantity} szt.</span>
                    </div>
                </div>

                <div class="volume-form-grid">
                    <div class="volume-input-group required">
                        <label>Objętość na 1 szt. (m³) *</label>
                        <input type="text"
                               class="volume-input volume-required"
                               data-field="volume"
                               data-product-key="${productKey}"
                               value="${savedData.volume || ''}"
                               step="0.0001"
                               min="0"
                               placeholder="np. 0.1234">
                        ${savedData.auto_detected ? '<span class="auto-detected-badge">Automatycznie wykryte</span>' : ''}
                        <div class="validation-message"></div>
                    </div>

                    <div class="volume-input-group">
                        <label>Gatunek drewna</label>
                        <select class="volume-select" data-field="wood_species" data-product-key="${productKey}">
                            <option value="">Wybierz gatunek...</option>
                            <option value="dąb" ${savedData.wood_species === 'dąb' ? 'selected' : ''}>Dąb</option>
                            <option value="jesion" ${savedData.wood_species === 'jesion' ? 'selected' : ''}>Jesion</option>
                            <option value="buk" ${savedData.wood_species === 'buk' ? 'selected' : ''}>Buk</option>
                        </select>
                        ${savedData.auto_detected && savedData.wood_species ? '<span class="auto-detected-badge">Wykryte</span>' : ''}
                    </div>

                    <div class="volume-input-group">
                        <label>Technologia</label>
                        <select class="volume-select" data-field="technology" data-product-key="${productKey}">
                            <option value="">Wybierz technologię...</option>
                            <option value="lity" ${savedData.technology === 'lity' ? 'selected' : ''}>Lity</option>
                            <option value="mikrowczep" ${savedData.technology === 'mikrowczep' ? 'selected' : ''}>Mikrowczep</option>
                        </select>
                        ${savedData.auto_detected && savedData.technology ? '<span class="auto-detected-badge">Wykryte</span>' : ''}
                    </div>

                    <div class="volume-input-group">
                        <label>Klasa drewna</label>
                        <select class="volume-select" data-field="wood_class" data-product-key="${productKey}">
                            <option value="">Wybierz klasę...</option>
                            <option value="A/A" ${savedData.wood_class === 'A/A' ? 'selected' : ''}>A/B</option>
                            <option value="A/B" ${savedData.wood_class === 'A/B' ? 'selected' : ''}>A/B</option>
                            <option value="B/B" ${savedData.wood_class === 'B/B' ? 'selected' : ''}>B/B</option>
                            <option value="Rustic" ${savedData.wood_class === 'Rustic' ? 'selected' : ''}>B/B</option>
                        </select>
                        ${savedData.auto_detected && savedData.wood_class ? '<span class="auto-detected-badge">Wykryte</span>' : ''}
                    </div>
                </div>

                <div class="volume-summary">
                    <strong>Objętość całkowita: <span id="totalVolumeDisplay">0.000 m³</span></strong>
                </div>
            </div>
        `;

        // Bind events dla tego produktu
        this.bindCurrentProductEvents();
        this.updateTotalVolume(productKey);
        this.updateChecklist();
    }

    bindStepByStepEvents() {
        // Kliknięcie w element listy - przejdź do tego produktu
        const checklistItems = this.volumeModal.querySelectorAll('.checklist-item');
        checklistItems.forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.productIndex);
                this.saveCurrentProductData();
                this.currentProductIndex = index;
                this.showCurrentProduct();
                this.updateFooterButtons();
            });
        });
    }

    bindCurrentProductEvents() {
        const inputs = this.volumeModal.querySelectorAll('.volume-input, .volume-select');
        
        inputs.forEach(input => {
            input.addEventListener('input', (e) => {
                this.handleInputChange(e);
            });
            
            input.addEventListener('blur', (e) => {
                if (e.target.classList.contains('volume-input')) {
                    this.formatAndValidateVolumeInput(e.target);
                }
            });
        });
    }

    bindBatchEvents() {
        const inputs = this.volumeModal.querySelectorAll('.volume-input, .volume-select');
        
        inputs.forEach(input => {
            input.addEventListener('input', (e) => {
                this.handleInputChange(e);
            });
            
            input.addEventListener('blur', (e) => {
                if (e.target.classList.contains('volume-input')) {
                    this.formatAndValidateVolumeInput(e.target);
                }
            });
        });

        this.updateSaveButtonState();
    }

    /**
     * Formatuje i waliduje wprowadzoną objętość
     */
    formatAndValidateVolumeInput(input) {
        let value = input.value.trim();
        
        if (!value) return;

        // Zamień przecinek na kropkę
        value = value.replace(',', '.');
        
        // Sprawdź czy to liczba
        const numValue = parseFloat(value);
        if (isNaN(numValue)) {
            this.showInputError(input, 'Wprowadź prawidłową liczbę');
            return;
        }

        // Walidacja nierealistycznych wartości
        if (numValue > 10) {
            this.showInputWarning(input, 'Uwaga: Bardzo duża objętość (>10m³)');
        } else if (numValue < 0.001 && numValue > 0) {
            this.showInputWarning(input, 'Uwaga: Bardzo mała objętość (<0.001m³)');
        } else if (numValue <= 0) {
            this.showInputError(input, 'Objętość musi być większa od 0');
            return;
        } else {
            this.clearInputMessage(input);
        }

        // Zaokrąglij do 4 miejsc po przecinku
        const roundedValue = Math.round(numValue * 10000) / 10000;
        
        // Ustaw sformatowaną wartość
        input.value = roundedValue.toString();

        // Aktualizuj dane
        const productKey = input.dataset.productKey;
        if (productKey) {
            if (!this.volumeData[productKey]) {
                this.volumeData[productKey] = {};
            }
            this.volumeData[productKey].volume = roundedValue;
            this.updateTotalVolume(productKey);
        }
    }

    showInputError(input, message) {
        input.classList.remove('is-valid', 'is-warning');
        input.classList.add('is-invalid');
        
        const messageDiv = input.parentNode.querySelector('.validation-message');
        if (messageDiv) {
            messageDiv.textContent = message;
            messageDiv.className = 'validation-message error';
        }
    }

    showInputWarning(input, message) {
        input.classList.remove('is-valid', 'is-invalid');
        input.classList.add('is-warning');
        
        const messageDiv = input.parentNode.querySelector('.validation-message');
        if (messageDiv) {
            messageDiv.textContent = message;
            messageDiv.className = 'validation-message warning';
        }
    }

    clearInputMessage(input) {
        input.classList.remove('is-invalid', 'is-warning');
        input.classList.add('is-valid');
        
        const messageDiv = input.parentNode.querySelector('.validation-message');
        if (messageDiv) {
            messageDiv.textContent = '';
            messageDiv.className = 'validation-message';
        }
    }

    handleInputChange(e) {
        const input = e.target;
        const productKey = input.dataset.productKey;
        const field = input.dataset.field;

        if (!productKey || !field) return;

        // Inicjalizuj dane produktu jeśli nie istnieją
        if (!this.volumeData[productKey]) {
            this.volumeData[productKey] = {};
        }

        // Zapisz wartość
        this.volumeData[productKey][field] = input.value;

        // Dla objętości - aktualizuj obliczenia
        if (field === 'volume' && !input.value.includes(',')) {
            this.updateTotalVolume(productKey);
        }

        // Aktualizuj stan przycisków
        if (this.isStepByStepMode) {
            this.updateFooterButtons();
        } else {
            this.updateSaveButtonState();
        }
    }

    updateTotalVolume(productKey) {
        const product = this.productsNeedingVolume.find(p =>
            `${p.order_id}_${p.product_id || 'unknown'}` === productKey
        );

        if (!product) return;

        // ✅ POPRAWKA: To już jest total_volume, nie mnóż przez quantity!
        const totalVolume = parseFloat(this.volumeData[productKey]?.volume) || 0;

        // Aktualizuj wyświetlanie
        const totalDisplay = document.getElementById('totalVolumeDisplay');
        if (totalDisplay) {
            totalDisplay.textContent = `${totalVolume.toFixed(3)} m³`;
        }

        const batchDisplay = this.volumeModal.querySelector(`[data-product-key="${productKey}"] .total-volume`);
        if (batchDisplay) {
            batchDisplay.textContent = `${totalVolume.toFixed(3)} m³`;
        }
    }

    updateChecklist() {
        if (!this.isStepByStepMode) return;

        const container = document.getElementById('productsChecklistContainer');
        if (container) {
            container.innerHTML = this.createProductsChecklist();
            this.bindStepByStepEvents();
        }
    }

    updateFooterButtons() {
        const footer = this.volumeModal.querySelector('.sync-modal-footer');
        if (!footer) return;

        if (this.isStepByStepMode) {
            const current = this.currentProductIndex + 1;
            const total = this.productsNeedingVolume.length;
            const isFirst = this.currentProductIndex === 0;
            const isLast = this.currentProductIndex === total - 1;
            const currentProduct = this.productsNeedingVolume[this.currentProductIndex];
            const productKey = `${currentProduct.order_id}_${currentProduct.product_id || 'unknown'}`;
            const hasVolume = this.volumeData[productKey]?.volume > 0;

            footer.innerHTML = `
                <button id="volumePrev" class="btn btn-secondary" ${isFirst ? 'disabled' : ''}>
                    ← Wstecz
                </button>
                <button id="volumeNext" class="btn btn-primary" ${!hasVolume ? 'disabled' : ''}>
                    ${isLast ? 'Zakończ' : 'Dalej →'}
                </button>
                <button id="volumeFinish" class="btn btn-success" style="display: ${isLast ? 'inline-block' : 'none'}">
                    Zapisz wszystkie
                </button>
            `;
        } else {
            footer.innerHTML = `
                <button id="volumeBack" class="btn btn-secondary">Wstecz</button>
                <button id="volumeSkip" class="btn btn-warning">Pomiń (objętość = 0)</button>
                <button id="volumeSave" class="btn btn-primary">Zapisz z objętościami</button>
            `;
        }

        this.bindFooterEvents();
    }

    // Handler methods
    handlePrevious() {
        if (this.currentProductIndex > 0) {
            this.saveCurrentProductData();
            this.currentProductIndex--;
            this.showCurrentProduct();
            this.updateFooterButtons();
        }
    }

    handleNext() {
        const currentProduct = this.productsNeedingVolume[this.currentProductIndex];
        const productKey = `${currentProduct.order_id}_${currentProduct.product_id || 'unknown'}`;
        
        if (!this.volumeData[productKey]?.volume || this.volumeData[productKey].volume <= 0) {
            alert('Proszę wprowadzić objętość przed przejściem dalej.');
            return;
        }

        this.saveCurrentProductData();

        if (this.currentProductIndex < this.productsNeedingVolume.length - 1) {
            this.currentProductIndex++;
            this.showCurrentProduct();
            this.updateFooterButtons();
        } else {
            this.handleFinish();
        }
    }

    handleFinish() {
        this.saveCurrentProductData();
        this.proceedWithSave();
    }

    saveCurrentProductData() {
        if (!this.isStepByStepMode) return;

        const inputs = this.volumeModal.querySelectorAll('.volume-input, .volume-select');
        inputs.forEach(input => {
            const productKey = input.dataset.productKey;
            const field = input.dataset.field;

            if (productKey && field) {
                if (!this.volumeData[productKey]) {
                    this.volumeData[productKey] = {};
                }
                this.volumeData[productKey][field] = input.value;
            }
        });
    }

    // Pozostałe metody bez zmian...
    handleBack() {
        console.log('[VolumeManager] Powrót do listy zamówień');
        this.hideModal();

        const ordersModal = document.getElementById('syncOrdersModal');
        if (ordersModal) {
            ordersModal.style.display = 'flex';
        }
    }

    handleSkip() {
        console.log('[VolumeManager] Pomijanie wprowadzania objętości');

        // ✅ POPRAWKA: Sprawdź czy to drugie kliknięcie PRZED pokazaniem toast
        if (this.lastSkipTime && (Date.now() - this.lastSkipTime) < 3000) {
            // To jest drugie kliknięcie - wykonaj bez pokazywania toast
            this.executeSkip();
            return;
        }

        // Pierwsze kliknięcie - pokaż toast i ustaw czas
        if (window.showToast) {
            window.showToast(
                'Produkty bez objętości będą miały wartość 0 m³. Naciśnij ponownie <span style="font-weight: 600; color: #ED6B24;">"Pomiń"</span> aby potwierdzić.',
                'warning'
            );
        }

        this.lastSkipTime = Date.now();
    }

    executeSkip() {
        // Wyczyść czas ostatniego kliknięcia
        this.lastSkipTime = null;

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

        this.proceedWithSave();
    }

    validateAllInputs() {
        const requiredInputs = this.volumeModal.querySelectorAll('.volume-required');
        return Array.from(requiredInputs).every(input => {
            const value = parseFloat(input.value);
            return input.value && value > 0;
        });
    }

    updateSaveButtonState() {
        if (this.isStepByStepMode) return;

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

    async proceedWithSave() {
        // Wywołaj globalną funkcję zapisywania z danymi objętości
        if (window.syncManager) {
            await window.syncManager.saveOrdersWithVolumes(this.volumeData);
        }
        this.hideModal();
    }

    hideModal() {
        console.log('[VolumeManager] Ukrywanie modala objętości');
        this.volumeModal.style.display = 'none';
        this.clearData();
    }

    clearData() {
        this.productsNeedingVolume = [];
        this.volumeData = {};
        this.currentProductIndex = 0;
        this.isStepByStepMode = false;
    }

    // Pomocnicze metody
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
        // ✅ POPRAWKA: Użyj tych samych dat co w kafelkach w kroku 2
        const formatDate = (timestamp) => {
            if (!timestamp) return 'Brak daty';

            try {
                let date;
                if (typeof timestamp === 'number') {
                    date = new Date(timestamp * 1000); // Unix timestamp
                } else {
                    date = new Date(timestamp);
                }

                if (isNaN(date.getTime())) return 'Błędna data';

                return date.toLocaleDateString('pl-PL');
            } catch (error) {
                return 'Błędna data';
            }
        };

        const orderInfo = orderData.order_info || {};
        const dateCreated = formatDate(orderInfo.date_add);
        const paymentDate = formatDate(orderInfo.payment_date);
        const status = orderInfo.order_status || 'Nieznany status';

        return `
            <div class="volume-order-item">
                <div class="volume-order-header">
                    <h4>Zamówienie #${orderId}</h4>
                    <div class="order-info">
                        <div>${orderInfo.customer_name || 'Nieznany klient'}</div>
                        <div style="font-size: 12px; color: #6c757d; margin-top: 4px;">
                            Złożone: ${dateCreated} | Płatność: ${paymentDate} | Status: ${status}
                        </div>
                    </div>
                </div>
                <div class="volume-products-container">
                    ${orderData.products.map(product => this.createProductElement(product)).join('')}
                </div>
            </div>
        `;
    }

    createProductElement(product) {
        const productKey = `${product.order_id}_${product.product_id || 'unknown'}`;
        const savedData = this.volumeData[productKey] || {};
        const totalVolume = parseFloat(savedData.volume || 0) || 0;

        return `
            <div class="volume-product-item" data-product-key="${productKey}">
                <div class="volume-product-header">
                    <div class="product-name">${product.product_name}</div>
                    <div class="product-quantity">Ilość: <span class="quantity-value">${product.quantity}</span> szt.</div>
                </div>

                <div class="volume-inputs-grid">
                    <!-- Objętość - pole wymagane -->
                    <div class="volume-input-group required">
                        <label>Całkowita objętość (m³)</label>
                        <input type="text"
                               class="volume-input volume-required"
                               data-field="volume"
                               data-product-key="${productKey}"
                               value="${savedData.volume || ''}"
                               step="0.0001"
                               min="0"
                               placeholder="np. 0.1234">
                        <div class="validation-message"></div>
                        ${savedData.auto_detected ? '<span class="auto-detected-badge">Automatycznie wykryte</span>' : ''}
                    </div>

                    <!-- Gatunek drewna -->
                    <div class="volume-input-group">
                        <label>Gatunek</label>
                        <select class="volume-select" data-field="wood_species" data-product-key="${productKey}">
                            <option value="">Wybierz gatunek...</option>
                            <option value="dąb" ${savedData.wood_species === 'dąb' ? 'selected' : ''}>Dąb</option>
                            <option value="buk" ${savedData.wood_species === 'buk' ? 'selected' : ''}>Buk</option>
                            <option value="jesion" ${savedData.wood_species === 'jesion' ? 'selected' : ''}>Jesion</option>
                            <option value="sosna" ${savedData.wood_species === 'sosna' ? 'selected' : ''}>Sosna</option>
                            <option value="brzoza" ${savedData.wood_species === 'brzoza' ? 'selected' : ''}>Brzoza</option>
                        </select>
                        ${savedData.auto_detected && savedData.wood_species ? '<span class="auto-detected-badge">Wykryte</span>' : ''}
                    </div>

                    <!-- Technologia -->
                    <div class="volume-input-group">
                        <label>Technologia</label>
                        <select class="volume-select" data-field="technology" data-product-key="${productKey}">
                            <option value="">Wybierz technologię...</option>
                            <option value="lity" ${savedData.technology === 'lity' ? 'selected' : ''}>Lity</option>
                            <option value="klejony" ${savedData.technology === 'klejony' ? 'selected' : ''}>Klejony</option>
                            <option value="mikrowczep" ${savedData.technology === 'mikrowczep' ? 'selected' : ''}>Mikrowczep</option>
                            <option value="fornir" ${savedData.technology === 'fornir' ? 'selected' : ''}>Fornir</option>
                        </select>
                        ${savedData.auto_detected && savedData.technology ? '<span class="auto-detected-badge">Wykryte</span>' : ''}
                    </div>

                    <!-- Klasa drewna -->
                    <div class="volume-input-group">
                        <label>Klasa</label>
                        <select class="volume-select" data-field="wood_class" data-product-key="${productKey}">
                            <option value="">Wybierz klasę...</option>
                            <option value="A/B" ${savedData.wood_class === 'A/B' ? 'selected' : ''}>A/B</option>
                            <option value="B/B" ${savedData.wood_class === 'B/B' ? 'selected' : ''}>B/B</option>
                        </select>
                        ${savedData.auto_detected && savedData.wood_class ? '<span class="auto-detected-badge">Wykryte</span>' : ''}
                    </div>
                </div>

                <div class="volume-summary">
                    Objętość całkowita: <strong><span class="total-volume">${totalVolume.toFixed(3)} m³</span>
                </div>
            </div>
        `;
    }

    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }
}

// Inicjalizuj VolumeManager globalnie
window.volumeManager = new VolumeManager();