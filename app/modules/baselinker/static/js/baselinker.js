// app/modules/baselinker/static/js/baselinker.js

console.log('[Baselinker] Module loaded');

class BaselinkerModal {
    constructor() {
        this.currentStep = 1;
        this.totalSteps = 3;
        this.quoteData = null;
        this.modalData = null;
        this.isSubmitting = false;

        this.init();
    }

    init() {
        console.log('[Baselinker] Initializing modal handlers');
        this.attachEventListeners();
    }

    attachEventListeners() {
        // Event listener dla przycisku "Zamów" w modalu szczegółów wyceny
        document.addEventListener('click', (e) => {
            const orderBtn = e.target.closest('#quote-order-btn');
            if (orderBtn) {
                e.preventDefault();
                const quoteId = this.extractQuoteIdFromModal();
                if (quoteId) {
                    this.openModal(quoteId);
                } else {
                    this.showAlert('Nie udało się określić ID wyceny', 'error');
                }
            }
        });

        // Event listeners dla modala
        this.setupModalEventListeners();
    }

    setupModalEventListeners() {
        // Zamykanie modala
        document.addEventListener('click', (e) => {
            if (e.target.closest('.baselinker-close-modal')) {
                this.closeModal();
            }

            // Zamykanie przez kliknięcie tła
            if (e.target.classList.contains('baselinker-modal-overlay')) {
                this.closeModal();
            }
        });

        // Nawigacja między krokami
        document.addEventListener('click', (e) => {
            if (e.target.closest('#baselinker-prev-step')) {
                this.prevStep();
            }

            if (e.target.closest('#baselinker-next-step')) {
                this.nextStep();
            }

            if (e.target.closest('#baselinker-submit-order')) {
                this.submitOrder();
            }
        });

        // Klawisz ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isModalOpen()) {
                this.closeModal();
            }
        });
    }

    extractQuoteIdFromModal() {
        // Próbuj znaleźć ID wyceny z przycisków w modalu
        const downloadBtn = document.querySelector('#download-details-btn');
        if (downloadBtn && downloadBtn.dataset.id) {
            return parseInt(downloadBtn.dataset.id);
        }

        // Backup - sprawdź inne możliwe miejsca
        const modalTitle = document.querySelector('#quotes-details-modal-quote-number');
        if (modalTitle && modalTitle.textContent) {
            // Jeśli mamy dostęp do numeru wyceny, możemy go użyć
            console.log('[Baselinker] Znaleziono numer wyceny:', modalTitle.textContent);
        }

        return null;
    }

    async openModal(quoteId) {
        console.log(`[Baselinker] Opening modal for quote ID: ${quoteId}`);

        try {
            this.showLoadingOverlay();

            // Pobierz dane do modala
            const response = await fetch(`/baselinker/api/quote/${quoteId}/order-modal-data`);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            this.modalData = await response.json();
            console.log('[Baselinker] Modal data loaded:', this.modalData);

            // Renderuj modal
            this.renderModal();
            this.showModal();

        } catch (error) {
            console.error('[Baselinker] Error opening modal:', error);
            this.showAlert(`Błąd ładowania danych: ${error.message}`, 'error');
        } finally {
            this.hideLoadingOverlay();
        }
    }

    renderModal() {
        // Usuń istniejący modal jeśli istnieje
        const existingModal = document.getElementById('baselinker-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Utwórz HTML modala
        const modalHTML = this.generateModalHTML();
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Wypełnij danymi
        this.populateModalData();

        // Reset kroku
        this.currentStep = 1;
        this.updateStep();
    }

    generateModalHTML() {
        return `
            <div id="baselinker-modal" class="baselinker-modal-overlay" style="display: none;">
                <div class="baselinker-modal-box">
                    <div class="modal-header">
                        <h2 class="modal-title">
                            <div class="baselinker-logo">BL</div>
                            Składanie zamówienia w Baselinker
                        </h2>
                        <button class="close-modal baselinker-close-modal">&times;</button>
                    </div>

                    <div class="modal-content">
                        <!-- Progress Bar -->
                        <div class="progress-bar">
                            <div class="progress-step active" data-step="1">
                                <div class="step-icon">1</div>
                                <span>Przegląd</span>
                            </div>
                            <div class="progress-step" data-step="2">
                                <div class="step-icon">2</div>
                                <span>Konfiguracja</span>
                            </div>
                            <div class="progress-step" data-step="3">
                                <div class="step-icon">3</div>
                                <span>Potwierdzenie</span>
                            </div>
                        </div>

                        <!-- Krok 1: Przegląd -->
                        <div class="step-content active" data-step="1">
                            <div class="section">
                                <h3 class="section-title">
                                    <div class="section-icon">📋</div>
                                    Przegląd zamówienia
                                </h3>
                                
                                <div class="order-summary" id="baselinker-order-summary">
                                    <!-- Wypełniane dynamicznie -->
                                </div>
                            </div>

                            <div class="section">
                                <h3 class="section-title">
                                    <div class="section-icon">📦</div>
                                    Produkty do zamówienia
                                </h3>
                                
                                <div class="products-list" id="baselinker-products-list">
                                    <!-- Wypełniane dynamicznie -->
                                </div>
                            </div>

                            <div class="section">
                                <h3 class="section-title">
                                    <div class="section-icon">💰</div>
                                    Podsumowanie finansowe
                                </h3>
                                
                                <div class="order-summary" id="baselinker-financial-summary">
                                    <!-- Wypełniane dynamicznie -->
                                </div>
                            </div>
                        </div>

                        <!-- Krok 2: Konfiguracja -->
                        <div class="step-content" data-step="2">
                            <div class="section">
                                <h3 class="section-title">
                                    <div class="section-icon">⚙️</div>
                                    Konfiguracja zamówienia
                                </h3>
                                
                                <div class="form-grid">
                                    <div class="form-group">
                                        <label class="form-label">Źródło zamówienia *</label>
                                        <select class="form-select" id="order-source-select" required>
                                            <option value="">Wybierz źródło...</option>
                                        </select>
                                    </div>
                                    
                                    <div class="form-group">
                                        <label class="form-label">Status zamówienia *</label>
                                        <select class="form-select" id="order-status-select" required>
                                            <option value="">Wybierz status...</option>
                                        </select>
                                    </div>
                                    
                                    <div class="form-group">
                                        <label class="form-label">Metoda płatności *</label>
                                        <select class="form-select" id="payment-method-select" required>
                                            <option value="">Wybierz metodę...</option>
                                        </select>
                                    </div>
                                    
                                    <div class="form-group">
                                        <label class="form-label">Metoda dostawy</label>
                                        <select class="form-select" id="delivery-method-select">
                                            <option value="">Wybierz metodę...</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="alert alert-info" style="margin-top: 1rem;">
                                    <strong>Informacja:</strong> Dane klienta zostaną automatycznie przeniesione z wyceny do zamówienia w Baselinker.
                                </div>
                            </div>

                            <div class="section">
                                <h3 class="section-title">
                                    <div class="section-icon">📍</div>
                                    Podgląd danych klienta
                                </h3>
                                
                                <div class="form-grid" id="baselinker-client-preview">
                                    <!-- Wypełniane dynamicznie - tylko do odczytu -->
                                </div>
                            </div>
                        </div>

                        <!-- Krok 3: Potwierdzenie -->
                        <div class="step-content" data-step="3">
                            <div class="section">
                                <h3 class="section-title">
                                    <div class="section-icon">✅</div>
                                    Potwierdzenie składania zamówienia
                                </h3>
                                
                                <div class="alert alert-warning">
                                    <strong>Uwaga!</strong> Po kliknięciu "Złóż zamówienie" dane zostaną wysłane do systemu Baselinker i utworzone zostanie nowe zamówienie. Tej operacji nie można cofnąć.
                                </div>

                                <div class="order-summary" id="baselinker-final-summary">
                                    <!-- Wypełniane dynamicznie -->
                                </div>

                                <div id="baselinker-validation-results">
                                    <!-- Wyniki walidacji -->
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="modal-actions">
                        <button class="btn btn-secondary baselinker-close-modal">
                            Anuluj
                        </button>
                        <button class="btn btn-secondary" id="baselinker-prev-step" style="display: none;">
                            ← Poprzedni
                        </button>
                        <button class="btn btn-primary" id="baselinker-next-step">
                            Następny →
                        </button>
                        <button class="btn btn-primary" id="baselinker-submit-order" style="display: none;">
                            <div class="loading-spinner" style="display: none;"></div>
                            Złóż zamówienie
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    populateModalData() {
        if (!this.modalData) return;

        // Krok 1: Przegląd zamówienia
        this.populateOrderSummary();
        this.populateProductsList();
        this.populateFinancialSummary();

        // Krok 2: Konfiguracja
        this.populateConfigurationForm();
        this.populateClientPreview();

        // Krok 3: Potwierdzenie
        this.populateFinalSummary();
    }

    populateOrderSummary() {
        const container = document.getElementById('baselinker-order-summary');
        const quote = this.modalData.quote;
        const client = this.modalData.client;

        container.innerHTML = `
            <div class="summary-row">
                <span>Numer wyceny:</span>
                <strong>${quote.quote_number}</strong>
            </div>
            <div class="summary-row">
                <span>Klient:</span>
                <strong>${client.name}${client.company ? ` - ${client.company}` : ''}</strong>
            </div>
            <div class="summary-row">
                <span>Data wyceny:</span>
                <strong>${new Date(quote.created_at).toLocaleDateString('pl-PL')}</strong>
            </div>
            <div class="summary-row">
                <span>Status wyceny:</span>
                <div class="status-indicator status-ready">✓ ${quote.status}</div>
            </div>
            <div class="summary-row">
                <span>Źródło wyceny:</span>
                <strong>${quote.source || 'Nie podano'}</strong>
            </div>
        `;
    }

    populateProductsList() {
        const container = document.getElementById('baselinker-products-list');
        const products = this.modalData.products;

        if (!products || products.length === 0) {
            container.innerHTML = '<p>Brak produktów do wyświetlenia</p>';
            return;
        }

        container.innerHTML = products.map(product => `
            <div class="product-item">
                <div class="product-info">
                    <h4>${this.translateVariantCode(product.variant_code)} - Produkt ${product.id}</h4>
                    <div class="product-details">
                        Wymiary: ${product.dimensions}<br>
                        Objętość: ${product.volume ? product.volume.toFixed(3) : '0.000'} m³
                        ${product.finishing ? `<br>Wykończenie: ${product.finishing}` : ''}
                    </div>
                </div>
                <div class="product-quantity">1 szt.</div>
                <div class="product-price">${this.formatCurrency(product.price_brutto)}</div>
            </div>
        `).join('');
    }

    populateFinancialSummary() {
        const container = document.getElementById('baselinker-financial-summary');
        const costs = this.modalData.costs;

        container.innerHTML = `
            <div class="summary-row">
                <span>Koszt produktów:</span>
                <strong>${this.formatCurrency(costs.products_netto)} netto</strong>
            </div>
            <div class="summary-row">
                <span>Koszt wykończenia:</span>
                <strong>${this.formatCurrency(costs.finishing_netto)} netto</strong>
            </div>
            <div class="summary-row">
                <span>Koszt wysyłki:</span>
                <strong>${this.formatCurrency(costs.shipping_brutto)} brutto</strong>
            </div>
            <div class="summary-row">
                <span>Wartość całkowita:</span>
                <strong>${this.formatCurrency(costs.total_brutto)} brutto</strong>
            </div>
        `;
    }

    populateConfigurationForm() {
        const config = this.modalData.config;

        // Źródła zamówień
        const orderSourceSelect = document.getElementById('order-source-select');
        orderSourceSelect.innerHTML = '<option value="">Wybierz źródło...</option>';
        config.order_sources.forEach(source => {
            const option = document.createElement('option');
            option.value = source.id;
            option.textContent = source.name;
            option.selected = source.is_default;
            orderSourceSelect.appendChild(option);
        });

        // Statusy zamówień
        const orderStatusSelect = document.getElementById('order-status-select');
        orderStatusSelect.innerHTML = '<option value="">Wybierz status...</option>';
        config.order_statuses.forEach(status => {
            const option = document.createElement('option');
            option.value = status.id;
            option.textContent = status.name;
            option.selected = status.is_default;
            orderStatusSelect.appendChild(option);
        });

        // Metody płatności
        const paymentMethodSelect = document.getElementById('payment-method-select');
        paymentMethodSelect.innerHTML = '<option value="">Wybierz metodę...</option>';
        config.payment_methods.forEach(method => {
            const option = document.createElement('option');
            option.value = method;
            option.textContent = method;
            option.selected = method === 'Przelew bankowy';
            paymentMethodSelect.appendChild(option);
        });

        // Metody dostawy
        const deliveryMethodSelect = document.getElementById('delivery-method-select');
        deliveryMethodSelect.innerHTML = '<option value="">Wybierz metodę...</option>';
        config.delivery_methods.forEach(method => {
            const option = document.createElement('option');
            option.value = method;
            option.textContent = method;
            option.selected = method === this.modalData.courier;
            deliveryMethodSelect.appendChild(option);
        });
    }

    populateClientPreview() {
        const container = document.getElementById('baselinker-client-preview');
        const client = this.modalData.client;

        container.innerHTML = `
            <div class="form-group">
                <label class="form-label">Imię i nazwisko</label>
                <input type="text" class="form-input" value="${client.name || ''}" readonly>
            </div>
            <div class="form-group">
                <label class="form-label">Firma</label>
                <input type="text" class="form-input" value="${client.company || ''}" readonly>
            </div>
            <div class="form-group">
                <label class="form-label">E-mail</label>
                <input type="email" class="form-input" value="${client.email || ''}" readonly>
            </div>
            <div class="form-group">
                <label class="form-label">Telefon</label>
                <input type="text" class="form-input" value="${client.phone || ''}" readonly>
            </div>
            <div class="form-group">
                <label class="form-label">Adres dostawy</label>
                <input type="text" class="form-input" value="${client.delivery_address || ''}" readonly>
            </div>
            <div class="form-group">
                <label class="form-label">Miasto</label>
                <input type="text" class="form-input" value="${client.delivery_city || ''}" readonly>
            </div>
        `;
    }

    populateFinalSummary() {
        const container = document.getElementById('baselinker-final-summary');
        const quote = this.modalData.quote;
        const client = this.modalData.client;
        const costs = this.modalData.costs;

        container.innerHTML = `
            <div class="summary-row">
                <span>Wycena:</span>
                <strong>${quote.quote_number}</strong>
            </div>
            <div class="summary-row">
                <span>Klient:</span>
                <strong>${client.name}${client.company ? ` - ${client.company}` : ''}</strong>
            </div>
            <div class="summary-row">
                <span>Produktów:</span>
                <strong>${this.modalData.products.length} ${this.modalData.products.length === 1 ? 'pozycja' : 'pozycje'}</strong>
            </div>
            <div class="summary-row">
                <span>Wartość zamówienia:</span>
                <strong>${this.formatCurrency(costs.total_brutto)} brutto</strong>
            </div>
            <div class="summary-row">
                <span>Status zamówienia:</span>
                <div class="status-indicator status-ready" id="final-order-status">✓ Gotowe do wysłania</div>
            </div>
        `;
    }

    updateStep() {
        // Aktualizuj progress bar
        document.querySelectorAll('.progress-step').forEach((step, index) => {
            step.classList.remove('active', 'completed');
            if (index + 1 < this.currentStep) {
                step.classList.add('completed');
            } else if (index + 1 === this.currentStep) {
                step.classList.add('active');
            }
        });

        // Aktualizuj zawartość kroków
        document.querySelectorAll('.step-content').forEach((content, index) => {
            content.classList.remove('active');
            if (index + 1 === this.currentStep) {
                content.classList.add('active');
            }
        });

        // Aktualizuj przyciski
        const prevBtn = document.getElementById('baselinker-prev-step');
        const nextBtn = document.getElementById('baselinker-next-step');
        const submitBtn = document.getElementById('baselinker-submit-order');

        prevBtn.style.display = this.currentStep > 1 ? 'flex' : 'none';
        nextBtn.style.display = this.currentStep < this.totalSteps ? 'flex' : 'none';
        submitBtn.style.display = this.currentStep === this.totalSteps ? 'flex' : 'none';

        // Walidacja kroku 2
        if (this.currentStep === 2) {
            this.validateConfiguration();
        }

        // Przygotuj podsumowanie w kroku 3
        if (this.currentStep === 3) {
            this.prepareValidation();
        }
    }

    nextStep() {
        if (this.currentStep < this.totalSteps) {
            // Walidacja przed przejściem dalej
            if (this.currentStep === 2 && !this.validateConfigurationForm()) {
                return;
            }

            this.currentStep++;
            this.updateStep();
        }
    }

    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.updateStep();
        }
    }

    validateConfigurationForm() {
        const orderSource = document.getElementById('order-source-select').value;
        const orderStatus = document.getElementById('order-status-select').value;
        const paymentMethod = document.getElementById('payment-method-select').value;

        if (!orderSource || !orderStatus || !paymentMethod) {
            this.showAlert('Wypełnij wszystkie wymagane pola konfiguracji', 'warning');
            return false;
        }

        return true;
    }

    validateConfiguration() {
        // Sprawdź czy wszystkie wymagane pola są wypełnione
        const isValid = this.validateConfigurationForm();

        // Aktualizuj stan przycisku Next
        const nextBtn = document.getElementById('baselinker-next-step');
        if (nextBtn) {
            nextBtn.disabled = !isValid;
            if (isValid) {
                nextBtn.classList.remove('btn-disabled');
            } else {
                nextBtn.classList.add('btn-disabled');
            }
        }
    }

    prepareValidation() {
        const container = document.getElementById('baselinker-validation-results');

        // Sprawdź konfigurację
        const orderSource = document.getElementById('order-source-select').value;
        const orderStatus = document.getElementById('order-status-select').value;
        const paymentMethod = document.getElementById('payment-method-select').value;
        const deliveryMethod = document.getElementById('delivery-method-select').value;

        let validationHTML = '<div class="section"><h4>Wybrana konfiguracja:</h4>';

        validationHTML += `
            <div class="order-summary">
                <div class="summary-row">
                    <span>Źródło zamówienia:</span>
                    <strong>${this.getSelectedOptionText('order-source-select')}</strong>
                </div>
                <div class="summary-row">
                    <span>Status zamówienia:</span>
                    <strong>${this.getSelectedOptionText('order-status-select')}</strong>
                </div>
                <div class="summary-row">
                    <span>Metoda płatności:</span>
                    <strong>${this.getSelectedOptionText('payment-method-select')}</strong>
                </div>
                <div class="summary-row">
                    <span>Metoda dostawy:</span>
                    <strong>${this.getSelectedOptionText('delivery-method-select') || 'Nie wybrano'}</strong>
                </div>
            </div>
        `;

        validationHTML += '</div>';

        container.innerHTML = validationHTML;

        // Sprawdź czy wszystko jest gotowe
        const finalStatus = document.getElementById('final-order-status');
        if (orderSource && orderStatus && paymentMethod) {
            finalStatus.className = 'status-indicator status-ready';
            finalStatus.innerHTML = '✓ Gotowe do wysłania';
        } else {
            finalStatus.className = 'status-indicator status-warning';
            finalStatus.innerHTML = '⚠ Wymagana konfiguracja';
        }
    }

    async submitOrder() {
        if (this.isSubmitting) return;

        console.log('[Baselinker] Submitting order...');

        // Walidacja końcowa
        if (!this.validateConfigurationForm()) {
            this.showAlert('Wypełnij wszystkie wymagane pola', 'error');
            return;
        }

        // Potwierdzenie użytkownika
        const confirmMessage = `Czy na pewno chcesz złożyć zamówienie w Baselinker dla wyceny ${this.modalData.quote.quote_number}?\n\nTej operacji nie można cofnąć.`;
        if (!confirm(confirmMessage)) {
            return;
        }

        this.isSubmitting = true;
        const submitBtn = document.getElementById('baselinker-submit-order');
        const spinner = submitBtn.querySelector('.loading-spinner');

        // Pokaż loading
        submitBtn.disabled = true;
        spinner.style.display = 'inline-block';
        submitBtn.innerHTML = '<div class="loading-spinner"></div> Składanie zamówienia...';

        try {
            // Przygotuj dane
            const orderData = {
                order_source_id: parseInt(document.getElementById('order-source-select').value),
                order_status_id: parseInt(document.getElementById('order-status-select').value),
                payment_method: document.getElementById('payment-method-select').value,
                delivery_method: document.getElementById('delivery-method-select').value || this.modalData.courier
            };

            console.log('[Baselinker] Sending order data:', orderData);

            // Wyślij żądanie
            const response = await fetch(`/baselinker/api/quote/${this.modalData.quote.id}/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(orderData)
            });

            const result = await response.json();

            if (response.ok && result.success) {
                console.log('[Baselinker] Order created successfully:', result);

                this.showAlert(`Zamówienie zostało utworzone pomyślnie!\nID zamówienia: ${result.order_id}`, 'success');

                // Zamknij modal po 2 sekundach
                setTimeout(() => {
                    this.closeModal();
                    // Opcjonalnie odśwież stronę lub zaktualizuj dane
                    if (typeof refreshQuoteDetailsModal === 'function') {
                        refreshQuoteDetailsModal();
                    }
                }, 2000);

            } else {
                console.error('[Baselinker] Order creation failed:', result);
                this.showAlert(`Błąd podczas tworzenia zamówienia: ${result.error}`, 'error');
            }

        } catch (error) {
            console.error('[Baselinker] Submit error:', error);
            this.showAlert(`Błąd sieci: ${error.message}`, 'error');
        } finally {
            // Przywróć przycisk
            this.isSubmitting = false;
            submitBtn.disabled = false;
            spinner.style.display = 'none';
            submitBtn.innerHTML = 'Złóż zamówienie';
        }
    }

    showModal() {
        const modal = document.getElementById('baselinker-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';

            // Animacja
            setTimeout(() => {
                modal.classList.add('active');
            }, 10);
        }
    }

    closeModal() {
        const modal = document.getElementById('baselinker-modal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';

            setTimeout(() => {
                modal.style.display = 'none';
                modal.remove();
            }, 300);
        }

        // Reset stanu
        this.currentStep = 1;
        this.modalData = null;
        this.isSubmitting = false;
    }

    isModalOpen() {
        const modal = document.getElementById('baselinker-modal');
        return modal && modal.style.display !== 'none';
    }

    showLoadingOverlay() {
        // Utwórz overlay jeśli nie istnieje
        let overlay = document.getElementById('baselinker-loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'baselinker-loading-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                color: white;
                font-size: 18px;
            `;
            overlay.innerHTML = '<div>Ładowanie danych...</div>';
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    }

    hideLoadingOverlay() {
        const overlay = document.getElementById('baselinker-loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    showAlert(message, type = 'info') {
        // Usuń istniejące alerty
        const existingAlerts = document.querySelectorAll('.baselinker-alert');
        existingAlerts.forEach(alert => alert.remove());

        // Utwórz nowy alert
        const alert = document.createElement('div');
        alert.className = `baselinker-alert alert alert-${type}`;
        alert.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10001;
            max-width: 400px;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            font-size: 14px;
            line-height: 1.4;
        `;

        // Kolory w zależności od typu
        const colors = {
            success: { bg: '#07B90D', color: 'white' },
            error: { bg: '#E53935', color: 'white' },
            warning: { bg: '#FFC107', color: '#1F2020' },
            info: { bg: '#2196F3', color: 'white' }
        };

        const alertColors = colors[type] || colors.info;
        alert.style.backgroundColor = alertColors.bg;
        alert.style.color = alertColors.color;

        alert.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <span>${message.replace(/\n/g, '<br>')}</span>
                <button onclick="this.parentElement.parentElement.remove()" 
                        style="background: none; border: none; color: inherit; cursor: pointer; font-size: 18px; margin-left: 12px;">×</button>
            </div>
        `;

        document.body.appendChild(alert);

        // Auto-remove po 5 sekundach (oprócz błędów)
        if (type !== 'error') {
            setTimeout(() => {
                if (alert.parentElement) {
                    alert.remove();
                }
            }, 5000);
        }
    }

    // Utility methods
    translateVariantCode(code) {
        const translations = {
            'dab-lity-ab': 'Dąb lity A/B',
            'dab-lity-bb': 'Dąb lity B/B',
            'dab-micro-ab': 'Dąb mikrowczep A/B',
            'dab-micro-bb': 'Dąb mikrowczep B/B',
            'jes-lity-ab': 'Jesion lity A/B',
            'jes-micro-ab': 'Jesion mikrowczep A/B',
            'buk-lity-ab': 'Buk lity A/B',
            'buk-micro-ab': 'Buk mikrowczep A/B'
        };
        return translations[code] || code || 'Nieznany wariant';
    }

    formatCurrency(amount) {
        if (amount == null || isNaN(amount)) return '0.00 PLN';
        return `${parseFloat(amount).toFixed(2)} PLN`;
    }

    getSelectedOptionText(selectId) {
        const select = document.getElementById(selectId);
        if (!select || !select.value) return '';
        const selectedOption = select.options[select.selectedIndex];
        return selectedOption ? selectedOption.textContent : '';
    }
}

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Baselinker] DOM loaded, initializing...');
    window.baselinkerModal = new BaselinkerModal();
});

// Export dla użycia w innych modułach
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BaselinkerModal;
}w