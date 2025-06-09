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
            if (e.target.closest('#baselinker-close-modal') ||
                e.target.closest('#baselinker-close-modal-footer')) {
                this.closeModal();
            }

            // Zamykanie przez kliknięcie tła
            if (e.target.classList.contains('bl-style-modal-overlay')) {
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

            // Sync config button
            if (e.target.closest('#baselinker-sync-config')) {
                this.syncConfig();
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

            // Wypełnij modal danymi (bez generowania HTML)
            this.populateModalData();

            // Pokaż modal
            this.showModal();

            // Reset kroku
            this.currentStep = 1;
            this.updateStep();

        } catch (error) {
            console.error('[Baselinker] Error opening modal:', error);
            this.showAlert(`Błąd ładowania danych: ${error.message}`, 'error');
        } finally {
            this.hideLoadingOverlay();
        }
    }

    populateModalData() {
        if (!this.modalData) return;

        console.log('[Baselinker] Populating modal with data');

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
        if (!container) return;

        const quote = this.modalData.quote;
        const client = this.modalData.client;

        container.innerHTML = `
            <div class="bl-style-summary-row">
                <span>Numer wyceny:</span>
                <strong>${quote.quote_number}</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Klient:</span>
                <strong>${client.name}${client.company ? ` - ${client.company}` : ''}</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Data wyceny:</span>
                <strong>${new Date(quote.created_at).toLocaleDateString('pl-PL')}</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Status wyceny:</span>
                <div class="bl-style-status-ready">✓ ${quote.status}</div>
            </div>
            <div class="bl-style-summary-row">
                <span>Źródło wyceny:</span>
                <strong>${quote.source || 'Nie podano'}</strong>
            </div>
        `;
    }

    populateProductsList() {
        const container = document.getElementById('baselinker-products-list');
        if (!container) return;

        const products = this.modalData.products;

        if (!products || products.length === 0) {
            container.innerHTML = '<p>Brak produktów do wyświetlenia</p>';
            return;
        }

        container.innerHTML = products.map(product => `
            <div class="bl-style-product-item">
                <div class="bl-style-product-name">
                    ${this.translateVariantCode(product.variant_code)} - Produkt ${product.id}
                    <div class="bl-style-product-details">
                        Wymiary: ${product.dimensions}<br>
                        Objętość: ${product.volume ? product.volume.toFixed(3) : '0.000'} m³
                    </div>
                </div>
                <div>${product.dimensions}</div>
                <div class="bl-style-product-finishing">
                    ${product.finishing || 'Brak'}
                </div>
                <div class="bl-style-product-price">${this.formatCurrency(product.price_brutto)}</div>
            </div>
        `).join('');
    }

    populateFinancialSummary() {
        const container = document.getElementById('baselinker-financial-summary');
        if (!container) return;

        const costs = this.modalData.costs;

        container.innerHTML = `
            <div class="bl-style-summary-row">
                <span>Koszt produktów:</span>
                <strong>${this.formatCurrency(costs.products_netto)} netto</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Koszt wykończenia:</span>
                <strong>${this.formatCurrency(costs.finishing_netto)} netto</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Koszt wysyłki:</span>
                <strong>${this.formatCurrency(costs.shipping_brutto)} brutto</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Wartość całkowita:</span>
                <strong>${this.formatCurrency(costs.total_brutto)} brutto</strong>
            </div>
        `;
    }

    populateConfigurationForm() {
        const config = this.modalData.config;

        // Źródła zamówień
        const orderSourceSelect = document.getElementById('order-source-select');
        if (orderSourceSelect) {
            orderSourceSelect.innerHTML = '<option value="">Wybierz źródło...</option>';
            config.order_sources.forEach(source => {
                const option = document.createElement('option');
                option.value = source.id;
                option.textContent = source.name;
                option.selected = source.is_default;
                orderSourceSelect.appendChild(option);
            });
        }

        // Statusy zamówień
        const orderStatusSelect = document.getElementById('order-status-select');
        if (orderStatusSelect) {
            orderStatusSelect.innerHTML = '<option value="">Wybierz status...</option>';
            config.order_statuses.forEach(status => {
                const option = document.createElement('option');
                option.value = status.id;
                option.textContent = status.name;
                option.selected = status.is_default;
                orderStatusSelect.appendChild(option);
            });
        }

        // Metody płatności
        const paymentMethodSelect = document.getElementById('payment-method-select');
        if (paymentMethodSelect) {
            paymentMethodSelect.innerHTML = '<option value="">Wybierz metodę...</option>';
            config.payment_methods.forEach(method => {
                const option = document.createElement('option');
                option.value = method;
                option.textContent = method;
                option.selected = method === 'Przelew bankowy';
                paymentMethodSelect.appendChild(option);
            });
        }

        // Metody dostawy
        const deliveryMethodSelect = document.getElementById('delivery-method-select');
        if (deliveryMethodSelect) {
            deliveryMethodSelect.innerHTML = '<option value="">Wybierz metodę...</option>';
            config.delivery_methods.forEach(method => {
                const option = document.createElement('option');
                option.value = method;
                option.textContent = method;
                option.selected = method === this.modalData.courier;
                deliveryMethodSelect.appendChild(option);
            });
        }
    }

    populateClientPreview() {
        const container = document.getElementById('baselinker-client-preview');
        if (!container) return;

        const client = this.modalData.client;

        container.innerHTML = `
            <div class="bl-style-client-field">
                <div class="bl-style-client-label">Imię i nazwisko</div>
                <div class="bl-style-client-value">${client.name || '-'}</div>
            </div>
            <div class="bl-style-client-field">
                <div class="bl-style-client-label">Firma</div>
                <div class="bl-style-client-value">${client.company || '-'}</div>
            </div>
            <div class="bl-style-client-field">
                <div class="bl-style-client-label">E-mail</div>
                <div class="bl-style-client-value">${client.email || '-'}</div>
            </div>
            <div class="bl-style-client-field">
                <div class="bl-style-client-label">Telefon</div>
                <div class="bl-style-client-value">${client.phone || '-'}</div>
            </div>
            <div class="bl-style-client-field">
                <div class="bl-style-client-label">Adres dostawy</div>
                <div class="bl-style-client-value">${client.delivery_address || '-'}</div>
            </div>
            <div class="bl-style-client-field">
                <div class="bl-style-client-label">Miasto</div>
                <div class="bl-style-client-value">${client.delivery_city || '-'}</div>
            </div>
        `;
    }

    populateFinalSummary() {
        const container = document.getElementById('baselinker-final-summary');
        if (!container) return;

        const quote = this.modalData.quote;
        const client = this.modalData.client;
        const costs = this.modalData.costs;

        container.innerHTML = `
            <div class="bl-style-summary-row">
                <span>Wycena:</span>
                <strong>${quote.quote_number}</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Klient:</span>
                <strong>${client.name}${client.company ? ` - ${client.company}` : ''}</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Produktów:</span>
                <strong>${this.modalData.products.length} ${this.modalData.products.length === 1 ? 'pozycja' : 'pozycje'}</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Wartość zamówienia:</span>
                <strong>${this.formatCurrency(costs.total_brutto)} brutto</strong>
            </div>
            <div class="bl-style-summary-row">
                <span>Status zamówienia:</span>
                <div class="bl-style-status-ready" id="final-order-status">✓ Gotowe do wysłania</div>
            </div>
        `;
    }

    updateStep() {
        console.log(`[Baselinker] Updating to step ${this.currentStep}`);

        // Aktualizuj progress bar
        document.querySelectorAll('.bl-style-progress-step').forEach((step, index) => {
            step.classList.remove('active', 'completed');
            if (index + 1 < this.currentStep) {
                step.classList.add('completed');
            } else if (index + 1 === this.currentStep) {
                step.classList.add('active');
            }
        });

        // Aktualizuj zawartość kroków
        document.querySelectorAll('.bl-style-step-content').forEach((content, index) => {
            content.classList.remove('active');
            if (index + 1 === this.currentStep) {
                content.classList.add('active');
            }
        });

        // Aktualizuj przyciski
        const prevBtn = document.getElementById('baselinker-prev-step');
        const nextBtn = document.getElementById('baselinker-next-step');
        const submitBtn = document.getElementById('baselinker-submit-order');

        if (prevBtn) prevBtn.style.display = this.currentStep > 1 ? 'flex' : 'none';
        if (nextBtn) nextBtn.style.display = this.currentStep < this.totalSteps ? 'flex' : 'none';
        if (submitBtn) submitBtn.style.display = this.currentStep === this.totalSteps ? 'flex' : 'none';

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
        const orderSource = document.getElementById('order-source-select')?.value;
        const orderStatus = document.getElementById('order-status-select')?.value;
        const paymentMethod = document.getElementById('payment-method-select')?.value;

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
                nextBtn.classList.remove('bl-style-btn-disabled');
            } else {
                nextBtn.classList.add('bl-style-btn-disabled');
            }
        }
    }

    prepareValidation() {
        const container = document.getElementById('baselinker-config-display');
        if (!container) return;

        // Sprawdź konfigurację
        const orderSource = document.getElementById('order-source-select')?.value;
        const orderStatus = document.getElementById('order-status-select')?.value;
        const paymentMethod = document.getElementById('payment-method-select')?.value;
        const deliveryMethod = document.getElementById('delivery-method-select')?.value;

        container.innerHTML = `
            <div class="bl-style-config-row">
                <span class="bl-style-config-label">Źródło zamówienia:</span>
                <span class="bl-style-config-value">${this.getSelectedOptionText('order-source-select')}</span>
            </div>
            <div class="bl-style-config-row">
                <span class="bl-style-config-label">Status zamówienia:</span>
                <span class="bl-style-config-value">${this.getSelectedOptionText('order-status-select')}</span>
            </div>
            <div class="bl-style-config-row">
                <span class="bl-style-config-label">Metoda płatności:</span>
                <span class="bl-style-config-value">${this.getSelectedOptionText('payment-method-select')}</span>
            </div>
            <div class="bl-style-config-row">
                <span class="bl-style-config-label">Metoda dostawy:</span>
                <span class="bl-style-config-value">${this.getSelectedOptionText('delivery-method-select') || 'Nie wybrano'}</span>
            </div>
        `;

        // Sprawdź czy wszystko jest gotowe
        const finalStatus = document.getElementById('final-order-status');
        if (finalStatus) {
            if (orderSource && orderStatus && paymentMethod) {
                finalStatus.className = 'bl-style-status-ready';
                finalStatus.innerHTML = '✓ Gotowe do wysłania';
            } else {
                finalStatus.className = 'bl-style-status-warning';
                finalStatus.innerHTML = '⚠ Wymagana konfiguracja';
            }
        }
    }

    async syncConfig() {
        console.log('[Baselinker] Syncing configuration...');

        try {
            const response = await fetch('/baselinker/api/sync-config');
            const result = await response.json();

            if (result.success) {
                this.showAlert('Konfiguracja zsynchronizowana pomyślnie', 'success');
                // Odśwież dane modala jeśli jest otwarty
                if (this.modalData) {
                    this.openModal(this.modalData.quote.id);
                }
            } else {
                this.showAlert('Błąd synchronizacji konfiguracji', 'error');
            }
        } catch (error) {
            console.error('[Baselinker] Sync error:', error);
            this.showAlert('Błąd połączenia podczas synchronizacji', 'error');
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

        if (submitBtn) {
            const btnText = submitBtn.querySelector('.bl-style-btn-text');
            const btnLoading = submitBtn.querySelector('.bl-style-btn-loading');

            submitBtn.disabled = true;
            if (btnText) btnText.style.display = 'none';
            if (btnLoading) btnLoading.style.display = 'flex';
        }

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
            if (submitBtn) {
                const btnText = submitBtn.querySelector('.bl-style-btn-text');
                const btnLoading = submitBtn.querySelector('.bl-style-btn-loading');

                submitBtn.disabled = false;
                if (btnText) btnText.style.display = 'flex';
                if (btnLoading) btnLoading.style.display = 'none';
            }
        }
    }

    showModal() {
        const modal = document.getElementById('baselinker-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';

            // Animacja z nowym systemem klas
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
                z-index: 10001;
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
        const existingAlerts = document.querySelectorAll('.bl-style-alert');
        existingAlerts.forEach(alert => alert.remove());

        // Utwórz nowy alert
        const alert = document.createElement('div');
        alert.className = `bl-style-alert bl-style-alert-${type}`;

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
}