// app/modules/baselinker/static/js/baselinker.js

console.log('[Baselinker] Module loaded');

class BaselinkerModal {
    constructor() {
        this.currentStep = 1;
        this.totalSteps = 3;
        this.quoteData = null;
        this.modalData = null;
        this.isSubmitting = false;
        this.originalClientData = null; // NOWE: przechowuje oryginalne dane klienta

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

            // NOWE: Zapisz oryginalne dane klienta
            this.originalClientData = this.cloneClientData(this.modalData.client);

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

    // NOWA FUNKCJA: Klonuje dane klienta
    cloneClientData(clientData) {
        return {
            delivery_name: clientData.delivery_name || clientData.name || '',
            delivery_company: clientData.delivery_company || clientData.company || '',
            delivery_address: clientData.delivery_address || '',
            delivery_postcode: clientData.delivery_postcode || '',
            delivery_city: clientData.delivery_city || '',
            email: clientData.email || '',
            phone: clientData.phone || '',
            invoice_name: clientData.invoice_name || clientData.name || '',
            invoice_company: clientData.invoice_company || clientData.company || '',
            invoice_nip: clientData.invoice_nip || '',
            invoice_address: clientData.invoice_address || clientData.delivery_address || '',
            invoice_postcode: clientData.invoice_postcode || clientData.delivery_postcode || '',
            invoice_city: clientData.invoice_city || clientData.delivery_city || '',
            want_invoice: !!(clientData.invoice_nip && clientData.invoice_nip.trim() !== '')
        };
    }

    // NOWA FUNKCJA: Pobiera aktualne dane z formularza
    getCurrentClientData() {
        return {
            delivery_name: this.getInputValue('delivery-fullname'),
            delivery_company: this.getInputValue('delivery-company'),
            delivery_address: this.getInputValue('delivery-address'),
            delivery_postcode: this.getInputValue('delivery-postcode'),
            delivery_city: this.getInputValue('delivery-city'),
            email: this.getInputValue('client-email'),
            phone: this.getInputValue('client-phone'),
            invoice_name: this.getInputValue('invoice-fullname'),
            invoice_company: this.getInputValue('invoice-company'),
            invoice_nip: this.getInputValue('invoice-nip'),
            invoice_address: this.getInputValue('invoice-address'),
            invoice_postcode: this.getInputValue('invoice-postcode'),
            invoice_city: this.getInputValue('invoice-city'),
            want_invoice: document.getElementById('want-invoice-checkbox')?.checked || false
        };
    }

    // NOWA FUNKCJA: Porównuje dane klienta
    hasClientDataChanged() {
        if (!this.originalClientData) return false;

        const currentData = this.getCurrentClientData();
        
        // Porównaj wszystkie pola
        for (const key in this.originalClientData) {
            if (this.originalClientData[key] !== currentData[key]) {
                console.log(`[Baselinker] Zmiana w polu ${key}: "${this.originalClientData[key]}" -> "${currentData[key]}"`);
                return true;
            }
        }
        
        return false;
    }

    // NOWA FUNKCJA: Pokazuje dialog aktualizacji danych klienta
    async showClientDataUpdateDialog() {
        const message = `Dane klienta zostały zmienione w formularzu.\n\nCzy chcesz zaktualizować dane klienta w bazie danych?\n\n• Tak - zaktualizuj dane w bazie\n• Nie - kontynuuj z nowymi danymi tylko dla tego zamówienia`;
        
        return new Promise((resolve) => {
            // Użyj natywnego confirm jako fallback
            const result = confirm(message);
            resolve(result);
        });
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
                <div class="bl-style-status-badge bl-style-status-ready">✓ ${quote.status}</div>
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
                ${this.buildProductName(product)}
                <div class="bl-style-product-details">
                    Waga: ${this.calculateProductWeight(product)} kg
                </div>
            </div>
            <div>${product.dimensions}</div>
            <div class="bl-style-product-price">
                <div class="bl-style-amount">
                    <div class="bl-style-amount-brutto">${this.formatCurrency(product.price_brutto)}</div>
                    <div class="bl-style-amount-netto">${this.formatCurrency(product.price_netto)} netto</div>
                </div>
            </div>
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
                <div class="bl-style-amount">
                    <div class="bl-style-amount-brutto">${this.formatCurrency(costs.products_brutto)}</div>
                    <div class="bl-style-amount-netto">${this.formatCurrency(costs.products_netto)} netto</div>
                </div>
            </div>
            <div class="bl-style-summary-row">
                <span>Koszt wykończenia:</span>
                <div class="bl-style-amount">
                    <div class="bl-style-amount-brutto">${this.formatCurrency(costs.finishing_brutto)}</div>
                    <div class="bl-style-amount-netto">${this.formatCurrency(costs.finishing_netto)} netto</div>
                </div>
            </div>
            <div class="bl-style-summary-row">
                <span>Koszt wysyłki:</span>
                <div class="bl-style-amount">
                    <div class="bl-style-amount-brutto">${this.formatCurrency(costs.shipping_brutto)}</div>
                    <div class="bl-style-amount-netto">${this.formatCurrency(costs.shipping_netto)} netto</div>
                </div>
            </div>
            <div class="bl-style-summary-row">
                <span>Wartość całkowita:</span>
                <div class="bl-style-amount">
                    <div class="bl-style-amount-brutto">${this.formatCurrency(costs.total_brutto)}</div>
                    <div class="bl-style-amount-netto">${this.formatCurrency(costs.total_netto)} netto</div>
                </div>
            </div>
        `;
    }

    populateConfigurationForm() {
        const config = this.modalData.config;

        console.log('[Baselinker] Konfiguracja otrzymana:', config);

        // Źródła zamówień
        const orderSourceSelect = document.getElementById('order-source-select');
        if (orderSourceSelect) {
            orderSourceSelect.innerHTML = '<option value="">Wybierz źródło...</option>';
            
            // Przefiltruj źródła - usuń te z ID = 0
            const validSources = config.order_sources.filter(source => source.id && source.id !== 0);
            console.log(`[Baselinker] Prawidłowe źródła (bez ID=0): ${validSources.length}`, validSources);
            
            validSources.forEach(source => {
                const option = document.createElement('option');
                option.value = source.id;
                option.textContent = source.name;
                option.selected = source.is_default;
                orderSourceSelect.appendChild(option);
                console.log(`[Baselinker] Dodano źródło: ID=${source.id}, Nazwa=${source.name}, Default=${source.is_default}`);
            });

            // Jeśli nie ma prawidłowych źródeł, pokaż komunikat
            if (validSources.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'Brak dostępnych źródeł - uruchom synchronizację';
                option.disabled = true;
                orderSourceSelect.appendChild(option);
                console.log('[Baselinker] UWAGA: Brak prawidłowych źródeł zamówień!');
            }
        }

        // Statusy zamówień
        const orderStatusSelect = document.getElementById('order-status-select');
        if (orderStatusSelect) {
            orderStatusSelect.innerHTML = '<option value="">Wybierz status...</option>';
            
            console.log(`[Baselinker] Statusy zamówień: ${config.order_statuses.length}`, config.order_statuses);
            
            config.order_statuses.forEach(status => {
                const option = document.createElement('option');
                option.value = status.id;
                option.textContent = status.name;
                option.selected = status.is_default;
                orderStatusSelect.appendChild(option);
                console.log(`[Baselinker] Dodano status: ID=${status.id}, Nazwa=${status.name}, Default=${status.is_default}`);
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

        // POPRAWKA: Dodaj event listenery dla walidacji w czasie rzeczywistym
        const selectIds = ['order-source-select', 'order-status-select', 'payment-method-select'];

        selectIds.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                // Usuń stare event listenery (żeby nie duplikować)
                select.replaceWith(select.cloneNode(true));
                const newSelect = document.getElementById(selectId);

                newSelect.addEventListener('change', () => {
                    console.log(`[Baselinker] Zmiana w ${selectId}: ${newSelect.value}`);
                    // Usuń błąd z tego pola
                    newSelect.classList.remove('bl-style-error');

                    // Usuń komunikat błędu dla tego pola
                    const errorMsg = newSelect.parentNode?.querySelector('.bl-style-error-message');
                    if (errorMsg) {
                        errorMsg.remove();
                    }

                    // Sprawdź czy można przejść dalej
                    this.validateConfiguration();
                });
            }
        });
    }

    populateClientPreview() {
        // Nowa funkcja obsługująca formularze klienta
        this.populateClientData();
    }

    populateClientData() {
        const client = this.modalData.client;

        // Wypełnij dane dostawy
        this.setInputValue('delivery-fullname', client.delivery_name || client.name || '');
        this.setInputValue('delivery-company', client.delivery_company || client.company || '');
        this.setInputValue('delivery-address', client.delivery_address || '');
        this.setInputValue('delivery-postcode', client.delivery_postcode || '');
        this.setInputValue('delivery-city', client.delivery_city || '');
        this.setInputValue('client-email', client.email || '');
        this.setInputValue('client-phone', client.phone || '');

        // Wypełnij dane faktury
        this.setInputValue('invoice-fullname', client.invoice_name || client.name || '');
        this.setInputValue('invoice-company', client.invoice_company || client.company || '');
        this.setInputValue('invoice-nip', client.invoice_nip || '');
        this.setInputValue('invoice-address', client.invoice_address || client.delivery_address || '');
        this.setInputValue('invoice-postcode', client.invoice_postcode || client.delivery_postcode || '');
        this.setInputValue('invoice-city', client.invoice_city || client.delivery_city || '');

        // Checkbox faktury
        const wantInvoiceCheckbox = document.getElementById('want-invoice-checkbox');
        const invoiceSection = document.getElementById('invoice-data-section');

        if (wantInvoiceCheckbox && invoiceSection) {
            // Sprawdź czy klient ma NIP - jeśli tak, to prawdopodobnie chce fakturę
            const hasNip = client.invoice_nip && client.invoice_nip.trim() !== '';
            wantInvoiceCheckbox.checked = hasNip;
            invoiceSection.style.display = hasNip ? 'block' : 'none';

            // Event listener dla checkboxa
            wantInvoiceCheckbox.addEventListener('change', (e) => {
                invoiceSection.style.display = e.target.checked ? 'block' : 'none';
            });
        }
    }

    // POPRAWIONA FUNKCJA: Bardziej dokładna walidacja
    validateConfigurationForm() {
        const orderSource = document.getElementById('order-source-select');
        const orderStatus = document.getElementById('order-status-select');
        const paymentMethod = document.getElementById('payment-method-select');

        let isValid = true;
        let errorMessages = [];

        // Reset poprzednich błędów
        this.clearValidationErrors();

        console.log('[Baselinker] Walidacja formularza konfiguracji:');
        console.log(`- Źródło: "${orderSource?.value}" (type: ${typeof orderSource?.value})`);
        console.log(`- Status: "${orderStatus?.value}" (type: ${typeof orderStatus?.value})`);
        console.log(`- Płatność: "${paymentMethod?.value}" (type: ${typeof paymentMethod?.value})`);

        // POPRAWIONA WALIDACJA ŹRÓDŁA - nie akceptuj 0 ani pustych wartości
        if (!orderSource?.value || orderSource.value.trim() === '' || orderSource.value === '0') {
            this.markFieldAsError(orderSource, 'Wybierz prawidłowe źródło zamówienia');
            errorMessages.push('Źródło zamówienia jest wymagane (nie może być 0)');
            isValid = false;
            console.log('[Baselinker] BŁĄD: Nieprawidłowe źródło zamówienia');
        }

        if (!orderStatus?.value || orderStatus.value.trim() === '') {
            this.markFieldAsError(orderStatus, 'Wybierz status zamówienia');
            errorMessages.push('Status zamówienia jest wymagany');
            isValid = false;
            console.log('[Baselinker] BŁĄD: Brak statusu zamówienia');
        }

        if (!paymentMethod?.value || paymentMethod.value.trim() === '') {
            this.markFieldAsError(paymentMethod, 'Wybierz metodę płatności');
            errorMessages.push('Metoda płatności jest wymagana');
            isValid = false;
            console.log('[Baselinker] BŁĄD: Brak metody płatności');
        }

        console.log(`[Baselinker] Walidacja zakończona: ${isValid ? 'SUKCES' : 'BŁĄD'}`);

        // Pokaż komunikat błędu jeśli potrzeba
        if (!isValid) {
            this.showValidationAlert(errorMessages);
        }

        return isValid;
    }

    async nextStep() {
        console.log(`[Baselinker] Próba przejścia z kroku ${this.currentStep} na ${this.currentStep + 1}`);

        if (this.currentStep < this.totalSteps) {
            // POPRAWKA: Walidacja kroku 2
            if (this.currentStep === 2) {
                console.log('[Baselinker] Walidacja kroku 2...');
                
                // Sprawdź konfigurację
                if (!this.validateConfigurationForm()) {
                    console.log('[Baselinker] Walidacja nie przeszła - blokowanie przejścia');
                    return;
                }

                // NOWE: Sprawdź czy dane klienta się zmieniły
                if (this.hasClientDataChanged()) {
                    console.log('[Baselinker] Dane klienta zostały zmienione');
                    
                    const shouldUpdate = await this.showClientDataUpdateDialog();
                    
                    if (shouldUpdate) {
                        console.log('[Baselinker] Użytkownik wybrał aktualizację danych klienta');
                        // Tutaj można dodać wywołanie API do aktualizacji danych klienta
                        this.showAlert('Dane klienta zostaną zaktualizowane po złożeniu zamówienia', 'info');
                    } else {
                        console.log('[Baselinker] Użytkownik wybrał kontynuację bez aktualizacji');
                        this.showAlert('Kontynuujesz z nowymi danymi tylko dla tego zamówienia', 'info');
                    }
                }
            }

            console.log('[Baselinker] Przechodzę do następnego kroku');
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

        // POPRAWKA: Reset walidacji przy powrocie do kroku 2
        if (this.currentStep === 2) {
            // Wyczyść poprzednie błędy walidacji
            this.clearValidationErrors();

            // Ponownie sprawdź walidację
            setTimeout(() => {
                this.validateConfiguration();
            }, 100);
        }

        // Przygotuj podsumowanie w kroku 3
        if (this.currentStep === 3) {
            this.prepareValidation();
        }
    }

    validateConfiguration() {
        // POPRAWKA: Sprawdź czy wszystkie wymagane pola są wypełnione
        const isValid = this.validateConfigurationForm();

        console.log(`[Baselinker] validateConfiguration wynik: ${isValid}`);

        // Aktualizuj stan przycisku Next
        const nextBtn = document.getElementById('baselinker-next-step');
        if (nextBtn) {
            nextBtn.disabled = !isValid;
            if (isValid) {
                nextBtn.classList.remove('bl-style-btn-disabled');
                nextBtn.style.opacity = '1';
                nextBtn.style.cursor = 'pointer';
            } else {
                nextBtn.classList.add('bl-style-btn-disabled');
                nextBtn.style.opacity = '0.6';
                nextBtn.style.cursor = 'not-allowed';
            }
        }

        // NOWA POPRAWKA: Zawsze zwróć true jeśli jesteśmy w kroku 1 lub 3
        if (this.currentStep === 1 || this.currentStep === 3) {
            return true;
        }

        return isValid;
    }

    async submitOrder() {
        if (this.isSubmitting) return;

        console.log('[Baselinker] Submitting order...');

        // Walidacja końcowa
        if (!this.validateConfigurationForm()) {
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

                // Pokaż modal sukcesu zamiast alertów
                this.showSuccessModal(result.order_id, result.quote_number);

                // Zamknij główny modal
                this.closeModal();

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
        this.originalClientData = null; // NOWE: Reset danych klienta
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

    // NOWA FUNKCJA: Oblicza wagę produktu
    calculateProductWeight(product) {
        // Waga produktu na podstawie objętości (gęstość drewna 800kg/m³)
        if (product.volume) {
            return (product.volume * 800).toFixed(2);
        }
        return '0.00';
    }

    // Utility methods
    translateVariantCode(code) {
        const translations = {
            'dab-lity-ab': 'Klejonka dębowa lita A/B',
            'dab-lity-bb': 'Klejonka dębowa lita B/B',
            'dab-micro-ab': 'Klejonka dębowa mikrowczep A/B',
            'dab-micro-bb': 'Klejonka dębowa mikrowczep B/B',
            'jes-lity-ab': 'Klejonka jesionowa lita A/B',
            'jes-micro-ab': 'Klejonka jesionowa mikrowczep A/B',
            'buk-lity-ab': 'Klejonka bukowa lita A/B',
            'buk-micro-ab': 'Klejonka bukowa mikrowczep A/B'
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

    clearValidationErrors() {
        // Usuń klasy błędów z wszystkich pól
        document.querySelectorAll('.bl-style-form-select.bl-style-error').forEach(field => {
            field.classList.remove('bl-style-error');
        });

        // Usuń komunikaty błędów
        document.querySelectorAll('.bl-style-error-message').forEach(msg => {
            msg.remove();
        });
    }

    markFieldAsError(field, message) {
        if (!field) return;

        field.classList.add('bl-style-error');

        // Dodaj komunikat błędu pod polem
        const errorMsg = document.createElement('div');
        errorMsg.className = 'bl-style-error-message';
        errorMsg.innerHTML = `⚠️ ${message}`;

        // Wstaw po polu
        if (field.parentNode) {
            field.parentNode.appendChild(errorMsg);
        }
    }

    showValidationAlert(messages) {
        const message = `Aby przejść dalej, wypełnij wymagane pola:\n\n• ${messages.join('\n• ')}`;
        this.showAlert(message, 'warning');
    }

    // NOWE UTILITY FUNCTIONS
    getInputValue(inputId) {
        const input = document.getElementById(inputId);
        return input ? (input.value || '').trim() : '';
    }

    // Utility methods
    buildProductName(product) {
        // Nowy format: Klejonka [gatunek]owa [technologia] [klasa] [wymiary] cm [wykończenie]
        const variantInfo = this.parseVariantCode(product.variant_code);
        const dimensions = product.dimensions;
        const finishing = this.getFinishingDisplay(product.finishing);

        return `Klejonka ${variantInfo.species}owa ${variantInfo.technology} ${variantInfo.woodClass} ${dimensions} ${finishing}`;
    }

    parseVariantCode(code) {
        // Parsuj kod wariantu na komponenty
        const translations = {
            'dab': 'dęb',
            'jes': 'jesion',
            'buk': 'buk'
        };

        const techTranslations = {
            'lity': 'lity',
            'micro': 'mikrowczep'
        };

        const classTranslations = {
            'ab': 'A/B',
            'bb': 'B/B'
        };

        if (!code) return { species: 'nieznany', technology: '', woodClass: '' };

        const parts = code.toLowerCase().split('-');
        const species = translations[parts[0]] || parts[0];
        const technology = techTranslations[parts[1]] || parts[1];
        const woodClass = classTranslations[parts[2]] || parts[2];

        return { species, technology, woodClass };
    }

    getFinishingDisplay(finishing) {
        if (!finishing || finishing === 'Brak' || finishing.trim() === '') {
            return 'surowe';
        }
        return finishing;
    }

    setInputValue(inputId, value) {
        const input = document.getElementById(inputId);
        if (input) {
            input.value = value || '';
        }
    }

    showSuccessModal(orderId, quoteNumber) {
        // Usuń istniejący modal sukcesu jeśli jest
        const existingModal = document.getElementById('baselinker-success-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Utwórz nowy modal sukcesu
        const modal = document.createElement('div');
        modal.id = 'baselinker-success-modal';
        modal.className = 'bl-style-modal-overlay';
        modal.innerHTML = `
            <div class="bl-style-modal-box" style="max-width: 600px;">
                <div class="bl-style-modal-header" style="background: linear-gradient(135deg, #4284F3 0%, #1651B4 100%);">
                    <h2 class="bl-style-modal-title">
                        <span class="bl-style-icon">✅</span>
                        Zamówienie zostało złożone pomyślnie!
                    </h2>
                    <button class="bl-style-modal-close" id="success-modal-close">&times;</button>
                </div>

                <div class="bl-style-modal-content" style="text-align: center; padding: 40px 24px;">
                    <div class="success-icon" style="margin-bottom: 24px;">
                        <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #4284F3 0%, #1651B4 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto; box-shadow: 0 8px 32px rgba(66, 132, 243, 0.3);">
                            <span style="color: white; font-size: 36px; font-weight: bold;">✓</span>
                        </div>
                    </div>

                    <div class="order-info" style="margin-bottom: 32px;">
                        <h3 style="color: #1F2020; margin-bottom: 8px; font-size: 18px;">Numer zamówienia w Baselinker:</h3>
                        <div class="order-number" style="font-size: 32px; font-weight: bold; color: #4284F3; margin-bottom: 16px;">
                            #${orderId}
                        </div>
                        <p style="color: #666; font-size: 14px; line-height: 1.5;">
                            Zamówienie dla wyceny <strong>${quoteNumber}</strong> zostało pomyślnie utworzone w systemie Baselinker.
                        </p>
                    </div>

                    <div class="success-actions" style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
                        <button id="view-order-baselinker" class="bl-style-btn bl-style-btn-primary" style="min-width: 200px;">
                            <span class="bl-style-icon">🔗</span>
                            Przejdź do Baselinker
                        </button>
                        <button id="success-modal-close-btn" class="bl-style-btn bl-style-btn-secondary" style="min-width: 120px;">
                            Zamknij
                        </button>
                    </div>

                    <div class="success-notes" style="margin-top: 32px; padding: 16px; background: #E3F2FD; border-radius: 8px; border-left: 4px solid #2196F3;">
                        <p style="color: #1565c0; font-size: 13px; margin: 0; line-height: 1.4;">
                            <strong>ℹ️ Informacja:</strong> Status wyceny został automatycznie zmieniony na "Złożone". 
                            Możesz teraz zarządzać zamówieniem w panelu Baselinker.
                        </p>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        const closeButtons = modal.querySelectorAll('#success-modal-close, #success-modal-close-btn');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                modal.style.display = 'none';
                modal.remove();
            });
        });

        const baselinkerBtn = modal.querySelector('#view-order-baselinker');
        if (baselinkerBtn) {
            baselinkerBtn.addEventListener('click', () => {
                const baselinkerUrl = `https://panel-f.baselinker.com/orders.php#order:${orderId}`;
                window.open(baselinkerUrl, '_blank');
                modal.style.display = 'none';
                modal.remove();
            });
        }

        // Zamykanie przez ESC
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
                modal.remove();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);

        // Pokaż modal
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
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