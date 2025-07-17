// ===================================
// CLIENT QUOTE JS - Wood Power v3.0
// Redesign 2025
// ===================================

// ===================================
// GLOBAL STATE
// ===================================
const globalState = {
    quoteData: null,
    selectedVariants: new Map(),
    currentProductIndex: 1,
    isQuoteAccepted: window.IS_ACCEPTED || false,
    isLoading: false
};

// ===================================
// API CALLS
// ===================================
const api = {
    /**
     * Wykonuje request do API
     * @param {string} url - URL endpointu
     * @param {Object} options - Opcje fetch
     * @returns {Promise} Odpowiedź z API
     */
    async call(url, options = {}) {
        const defaultOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin'
        };

        const config = { ...defaultOptions, ...options };

        try {
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                const errorMessage = data.error || data.message || `Błąd serwera (${response.status})`;
                throw new Error(errorMessage);
            }

            return data;
        } catch (error) {
            console.error('[API] Request failed:', error);
            throw error;
        }
    },

    /**
     * Pobiera dane wyceny
     * @param {string} token - Token publiczny wyceny
     * @returns {Promise} Dane wyceny
     */
    async getQuoteData(token) {
        return this.call(`/quotes/api/client/quote/${token}`);
    },

    /**
     * Aktualizuje wybrany wariant
     * @param {string} token - Token publiczny wyceny
     * @param {number} itemId - ID wybranego wariantu
     * @returns {Promise} Odpowiedź z API
     */
    async updateVariant(token, itemId) {
        return this.call(`/quotes/api/client/quote/${token}/update-variant`, {
            method: 'PATCH',
            body: JSON.stringify({ item_id: itemId })
        });
    },

    /**
     * Akceptuje wycenę
     * @param {string} token - Token publiczny wyceny
     * @param {Object} data - Dane do akceptacji
     * @returns {Promise} Odpowiedź z API
     */
    async acceptQuote(token, data) {
        return this.call(`/quotes/api/client/quote/${token}/accept`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }
};

// ===================================
// UTILS
// ===================================
const utils = {
    /**
     * Formatuje kwotę w PLN
     * @param {number} amount - Kwota
     * @returns {string} Sformatowana kwota
     */
    formatCurrency(amount) {
        return new Intl.NumberFormat('pl-PL', {
            style: 'currency',
            currency: 'PLN'
        }).format(amount || 0);
    },

    /**
     * Tłumaczy kod wariantu na czytelną nazwę
     * @param {string} code - Kod wariantu
     * @returns {string} Nazwa wariantu
     */
    translateVariantCode(code) {
        const translations = {
            'oak_solid_ab': 'Dąb lity A/B',
            'oak_solid_bb': 'Dąb lity B/B',
            'oak_micro_ab': 'Dąb mikrowczep A/B',
            'oak_micro_bb': 'Dąb mikrowczep B/B',
            'ash_solid_ab': 'Jesion lity A/B',
            'ash_micro_ab': 'Jesion mikrowczep A/B',
            'beech_solid_ab': 'Buk lity A/B',
            'beech_micro_ab': 'Buk mikrowczep A/B'
        };
        return translations[code] || code;
    },

    /**
     * Sprawdza czy urządzenie jest mobilne
     * @returns {boolean} True jeśli mobilne
     */
    isMobile() {
        return window.innerWidth <= 768;
    },

    /**
     * Pokazuje/ukrywa loading
     * @param {boolean} show - Czy pokazać loading
     */
    setLoading(show) {
        const loadingEl = document.getElementById('loadingOverlay');
        if (loadingEl) {
            loadingEl.classList.toggle('hidden', !show);
        }
        globalState.isLoading = show;
    },

    /**
     * Pokazuje alert z komunikatem
     * @param {string} message - Treść komunikatu
     * @param {string} type - Typ komunikatu (success, error, warning)
     */
    showAlert(message, type = 'info') {
        // TODO: Implementacja toastu/alertu
        console.log(`[Alert ${type}]:`, message);
    },

    /**
     * Generuje kod QR
     * @param {string} text - Tekst do zakodowania
     * @param {string} elementId - ID elementu canvas
     */
    generateQRCode(text, elementId = 'qrCode') {
        const canvas = document.getElementById(elementId);
        if (!canvas || !window.QRCode) return;

        // Wyczyść poprzedni kod
        canvas.innerHTML = '';

        new QRCode(canvas, {
            text: text,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    }
};

// ===================================
// RENDER FUNCTIONS
// ===================================
const render = {
    /**
     * Renderuje przyciski/dropdown produktów
     */
    productTabs() {
        const buttonsContainer = document.getElementById('productButtons');
        const selectElement = document.getElementById('productSelect');

        if (!buttonsContainer || !selectElement || !globalState.quoteData) return;

        buttonsContainer.innerHTML = '';
        selectElement.innerHTML = '';

        // Grupuj produkty według product_index
        const products = this.groupProductsByIndex();

        products.forEach(product => {
            // Desktop button
            const button = document.createElement('button');
            button.className = `product-button ${product.index === globalState.currentProductIndex ? 'active' : ''}`;
            button.onclick = () => handlers.switchProduct(product.index);
            button.innerHTML = `
                <div class="product-button-title">Produkt ${product.index}</div>
                <div class="product-button-dimensions">${product.dimensions}</div>
            `;
            buttonsContainer.appendChild(button);

            // Mobile option
            const option = document.createElement('option');
            option.value = product.index;
            option.textContent = `Produkt ${product.index} - ${product.dimensions}`;
            option.selected = product.index === globalState.currentProductIndex;
            selectElement.appendChild(option);
        });
    },

    /**
     * Renderuje sekcje produktów
     */
    productSections() {
        const sectionsContainer = document.getElementById('productSections');
        if (!sectionsContainer || !globalState.quoteData) return;

        sectionsContainer.innerHTML = '';

        const products = this.groupProductsByIndex();

        products.forEach(product => {
            const section = document.createElement('div');
            section.className = `product-section ${product.index === globalState.currentProductIndex ? 'active' : ''}`;
            section.id = `product-${product.index}`;

            section.innerHTML = `
                <div class="product-header">
                    <div class="product-info">
                        <h2>Produkt ${product.index}</h2>
                        <div class="product-details">
                            <div class="product-detail">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M4 12h16m-7 5h7"></path>
                                </svg>
                                <span>${product.dimensions}</span>
                            </div>
                            <div class="product-detail">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
                                </svg>
                                <span>${product.volume}</span>
                            </div>
                            <div class="product-detail">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"></path>
                                </svg>
                                <span>${product.finishing}</span>
                            </div>
                            <div class="product-detail">
                                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"></path>
                                </svg>
                                <span>Ilość: ${product.quantity} szt.</span>
                            </div>
                        </div>
                    </div>
                    <div class="product-actions">
                        <button class="btn btn-3d" onclick="handlers.open3DViewer(${product.index})">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path>
                            </svg>
                            3D
                        </button>
                        <button class="btn btn-ar" onclick="handlers.openARModal(${product.index})">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                            </svg>
                            AR
                        </button>
                    </div>
                </div>

                <div class="variants-grid">
                    ${this.renderVariants(product)}
                </div>
            `;

            sectionsContainer.appendChild(section);
        });
    },

    /**
     * Renderuje karty wariantów
     * @param {Object} product - Dane produktu
     * @returns {string} HTML wariantów
     */
    renderVariants(product) {
        return product.variants
            .filter(v => v.show_on_client_page !== false)
            .map(variant => {
                const isSelected = globalState.selectedVariants.get(product.index) === variant.id;
                const isDisabled = globalState.isQuoteAccepted && !isSelected;

                // Pobierz dane o wykończeniu
                const finishing = globalState.quoteData.finishing?.find(
                    f => f.product_index === product.index
                );

                // Ścieżka do obrazka tekstury
                const texturePath = finishing?.finishing_color
                    ? `/static/img/finishing_colors/${finishing.finishing_color}.jpg`
                    : '/static/img/finishing_colors/placeholder.jpg';

                return `
                    <div class="variant-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}" 
                         onclick="${!isDisabled ? `handlers.selectVariant(${product.index}, ${variant.id})` : ''}">
                        <div class="variant-content">
                            <div class="variant-image" style="background-image: url('${texturePath}')"></div>
                            <div class="variant-info">
                                <div class="variant-header">
                                    <div class="variant-name">${utils.translateVariantCode(variant.variant_code)}</div>
                                    <div class="variant-badge ${isSelected ? 'selected' : 'available'}">
                                        ${isSelected ? 'Wybrany' : 'Wybierz'}
                                    </div>
                                </div>
                                <div class="variant-details">
                                    Kod: ${variant.variant_code}
                                </div>
                                <div class="variant-pricing">
                                    <div class="price-label">Cena jednostkowa:</div>
                                    <div class="price-value">
                                        <div class="price-brutto">${utils.formatCurrency(variant.price_brutto)}</div>
                                        <div class="price-netto">${utils.formatCurrency(variant.price_netto)} netto</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
    },

    /**
     * Renderuje tabelę porównania wariantów
     */
    comparison() {
        const tbody = document.getElementById('comparisonBody');
        if (!tbody || !globalState.quoteData) return;

        const variants = this.getUniqueVariants();

        tbody.innerHTML = variants.map(variant => {
            const total = this.calculateVariantTotal(variant.code);
            const currentTotal = this.calculateCurrentTotal();
            const difference = total.brutto - currentTotal.brutto;
            const isSelected = this.isVariantSelected(variant.code);

            return `
                <tr class="${isSelected ? 'selected-row' : ''}">
                    <td>${variant.name}</td>
                    <td class="price-cell">${utils.formatCurrency(total.netto)}</td>
                    <td class="price-cell">${utils.formatCurrency(total.brutto)}</td>
                    <td class="price-cell">
                        ${difference !== 0 ? (difference > 0 ? '+' : '') + utils.formatCurrency(difference) : '-'}
                    </td>
                </tr>
            `;
        }).join('');
    },

    /**
     * Aktualizuje mobilne podsumowanie
     */
    mobileSummary() {
        const total = this.calculateCurrentTotal();
        const mobileTotalEl = document.getElementById('mobileTotalPrice');
        if (mobileTotalEl) {
            mobileTotalEl.textContent = utils.formatCurrency(total.brutto);
        }

        // Update details
        const detailsContent = document.getElementById('mobileDetailsContent');
        if (!detailsContent || !globalState.quoteData) return;

        const products = this.groupProductsByIndex();

        detailsContent.innerHTML = `
            <div class="mb-3">
                <strong>Produkty:</strong>
                ${products.map(product => {
            const selectedId = globalState.selectedVariants.get(product.index);
            const variant = product.variants.find(v => v.id === selectedId);
            const subtotal = variant ? variant.price_brutto * product.quantity : 0;

            return `
                        <div style="display: flex; justify-content: space-between; margin-top: 8px;">
                            <span>Produkt ${product.index} (${product.quantity} szt.)</span>
                            <span>${utils.formatCurrency(subtotal)}</span>
                        </div>
                    `;
        }).join('')}
            </div>
            ${globalState.quoteData.shipping_cost_brutto ? `
                <div style="border-top: 1px solid var(--border-light); padding-top: 16px;">
                    <div style="display: flex; justify-content: space-between;">
                        <span>Dostawa (${globalState.quoteData.courier_name || 'Kurier'}):</span>
                        <span>${utils.formatCurrency(globalState.quoteData.shipping_cost_brutto)}</span>
                    </div>
                </div>
            ` : ''}
            <div style="border-top: 2px solid var(--border-medium); margin-top: 16px; padding-top: 16px;">
                <div style="display: flex; justify-content: space-between; font-weight: 700;">
                    <span>Razem brutto:</span>
                    <span>${utils.formatCurrency(total.brutto)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 14px; color: var(--text-secondary);">
                    <span>Razem netto:</span>
                    <span>${utils.formatCurrency(total.netto)}</span>
                </div>
            </div>
        `;
    },

    // Helper functions
    groupProductsByIndex() {
        if (!globalState.quoteData || !globalState.quoteData.items) return [];

        const groups = new Map();

        globalState.quoteData.items.forEach(item => {
            if (!groups.has(item.product_index)) {
                // Pobierz dane o wykończeniu dla tego produktu
                const finishing = globalState.quoteData.finishing?.find(
                    f => f.product_index === item.product_index
                );

                groups.set(item.product_index, {
                    index: item.product_index,
                    dimensions: `${item.length_cm} × ${item.width_cm} × ${item.thickness_cm} cm`,
                    volume: `${item.volume_m3.toFixed(3)} m³`,
                    finishing: this.formatFinishing(finishing),
                    quantity: finishing?.quantity || 1,
                    variants: []
                });
            }

            groups.get(item.product_index).variants.push(item);
        });

        return Array.from(groups.values()).sort((a, b) => a.index - b.index);
    },

    formatFinishing(finishing) {
        if (!finishing || !finishing.finishing_type || finishing.finishing_type === 'Brak') {
            return 'Brak wykończenia';
        }

        const parts = [];
        if (finishing.finishing_type) parts.push(finishing.finishing_type);
        if (finishing.finishing_color && finishing.finishing_color !== 'Brak') {
            parts.push(finishing.finishing_color);
        }
        if (finishing.finishing_variant) parts.push(finishing.finishing_variant);

        return parts.join(' - ');
    },

    getUniqueVariants() {
        const variantsMap = new Map();
        const products = this.groupProductsByIndex();

        products.forEach(product => {
            product.variants
                .filter(v => v.show_on_client_page !== false)
                .forEach(variant => {
                    if (!variantsMap.has(variant.variant_code)) {
                        variantsMap.set(variant.variant_code, {
                            code: variant.variant_code,
                            name: utils.translateVariantCode(variant.variant_code)
                        });
                    }
                });
        });

        return Array.from(variantsMap.values());
    },

    calculateVariantTotal(variantCode) {
        let totalNetto = 0;
        let totalBrutto = 0;
        const products = this.groupProductsByIndex();

        products.forEach(product => {
            const variant = product.variants.find(v => v.variant_code === variantCode);
            if (variant) {
                totalNetto += variant.price_netto * product.quantity;
                totalBrutto += variant.price_brutto * product.quantity;
            }
        });

        // Add shipping
        if (globalState.quoteData.shipping_cost_netto) {
            totalNetto += globalState.quoteData.shipping_cost_netto;
        }
        if (globalState.quoteData.shipping_cost_brutto) {
            totalBrutto += globalState.quoteData.shipping_cost_brutto;
        }

        return { netto: totalNetto, brutto: totalBrutto };
    },

    calculateCurrentTotal() {
        let totalNetto = 0;
        let totalBrutto = 0;
        const products = this.groupProductsByIndex();

        products.forEach(product => {
            const selectedId = globalState.selectedVariants.get(product.index);
            const variant = product.variants.find(v => v.id === selectedId);
            if (variant) {
                totalNetto += variant.price_netto * product.quantity;
                totalBrutto += variant.price_brutto * product.quantity;
            }
        });

        // Add shipping
        if (globalState.quoteData.shipping_cost_netto) {
            totalNetto += globalState.quoteData.shipping_cost_netto;
        }
        if (globalState.quoteData.shipping_cost_brutto) {
            totalBrutto += globalState.quoteData.shipping_cost_brutto;
        }

        return { netto: totalNetto, brutto: totalBrutto };
    },

    isVariantSelected(variantCode) {
        const products = this.groupProductsByIndex();

        return products.some(product => {
            const selectedId = globalState.selectedVariants.get(product.index);
            const variant = product.variants.find(v => v.id === selectedId);
            return variant && variant.variant_code === variantCode;
        });
    }
};

// ===================================
// EVENT HANDLERS
// ===================================
const handlers = {
    /**
     * Przełącza między produktami
     * @param {number} index - Indeks produktu
     */
    switchProduct(index) {
        globalState.currentProductIndex = index;

        // Update tabs
        document.querySelectorAll('.product-button').forEach((btn, i) => {
            const products = render.groupProductsByIndex();
            btn.classList.toggle('active', products[i]?.index === index);
        });

        // Update sections
        document.querySelectorAll('.product-section').forEach(section => {
            section.classList.remove('active');
        });
        const activeSection = document.getElementById(`product-${index}`);
        if (activeSection) {
            activeSection.classList.add('active');
        }

        // Update mobile select
        const mobileSelect = document.getElementById('productSelect');
        if (mobileSelect) {
            mobileSelect.value = index;
        }
    },

    /**
     * Wybiera wariant produktu
     * @param {number} productIndex - Indeks produktu
     * @param {number} variantId - ID wariantu
     */
    async selectVariant(productIndex, variantId) {
        if (globalState.isQuoteAccepted || globalState.isLoading) return;

        try {
            utils.setLoading(true);

            // Wywołaj API
            await api.updateVariant(window.QUOTE_TOKEN, variantId);

            // Zaktualizuj stan lokalny
            globalState.selectedVariants.set(productIndex, variantId);

            // Odśwież UI
            render.productSections();
            render.comparison();
            render.mobileSummary();

            utils.showAlert('Wariant został zmieniony', 'success');

        } catch (error) {
            console.error('Błąd przy zmianie wariantu:', error);
            utils.showAlert('Błąd przy zmianie wariantu', 'error');
        } finally {
            utils.setLoading(false);
        }
    },

    /**
     * Otwiera podgląd 3D
     * @param {number} productIndex - Indeks produktu
     */
    open3DViewer(productIndex) {
        const modal = document.getElementById('viewerModal');
        const iframe = document.getElementById('viewerFrame');

        if (!modal || !iframe) return;

        // Przygotuj dane produktu
        const products = render.groupProductsByIndex();
        const product = products.find(p => p.index === productIndex);
        if (!product) return;

        // Ustaw URL iframe z parametrami
        const params = new URLSearchParams({
            quote: window.QUOTE_NUMBER,
            product: productIndex,
            token: window.QUOTE_TOKEN
        });

        iframe.src = `/preview3d-ar/quote/${window.QUOTE_NUMBER}?${params}`;
        modal.classList.add('active');

        // Obsługa zamykania na Escape
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.close3DViewer();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    },

    /**
     * Zamyka podgląd 3D
     */
    close3DViewer() {
        const modal = document.getElementById('viewerModal');
        const iframe = document.getElementById('viewerFrame');

        if (modal) modal.classList.remove('active');
        if (iframe) iframe.src = '';
    },

    /**
     * Otwiera modal AR
     * @param {number} productIndex - Indeks produktu
     */
    openARModal(productIndex) {
        if (utils.isMobile()) {
            // Na mobile - bezpośrednie uruchomienie AR
            console.log('Opening AR on mobile for product:', productIndex);
            // TODO: Implementacja AR dla mobile
        } else {
            // Na desktop - pokazanie QR code
            const modal = document.getElementById('qrModal');
            if (!modal) return;

            modal.classList.add('active');

            // Generuj QR code z linkiem do tej strony
            const currentUrl = window.location.href;
            utils.generateQRCode(currentUrl);

            // Pokaż URL
            const urlEl = document.getElementById('qrUrl');
            if (urlEl) {
                urlEl.textContent = currentUrl;
            }
        }
    },

    /**
     * Pokazuje modal akceptacji
     */
    showAcceptModal() {
        if (globalState.isQuoteAccepted) return;

        const modal = document.getElementById('acceptModal');
        if (modal) {
            modal.classList.add('active');
        }
    },

    /**
     * Obsługa formularza akceptacji
     * @param {Event} event - Event formularza
     */
    async handleAcceptSubmit(event) {
        event.preventDefault();

        // Pobierz dane z formularza
        const email = document.getElementById('acceptEmail').value;
        const phone = document.getElementById('acceptPhone').value;
        const comments = document.getElementById('acceptComments').value;
        const terms = document.getElementById('acceptTerms').checked;

        // Walidacja
        let hasErrors = false;

        if (!email || !email.includes('@')) {
            document.getElementById('emailError').textContent = 'Podaj prawidłowy adres email';
            document.getElementById('emailError').classList.remove('hidden');
            hasErrors = true;
        }

        if (!phone || phone.length < 9) {
            document.getElementById('phoneError').textContent = 'Podaj prawidłowy numer telefonu';
            document.getElementById('phoneError').classList.remove('hidden');
            hasErrors = true;
        }

        if (!terms) {
            document.getElementById('termsError').textContent = 'Musisz zaakceptować warunki';
            document.getElementById('termsError').classList.remove('hidden');
            hasErrors = true;
        }

        if (hasErrors) return;

        try {
            utils.setLoading(true);

            // Wyślij dane do API
            const response = await api.acceptQuote(window.QUOTE_TOKEN, {
                email_or_phone: email,
                phone: phone,
                comments: comments
            });

            // Sukces - odśwież stronę
            utils.showAlert('Wycena została zaakceptowana!', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 1500);

        } catch (error) {
            console.error('Błąd akceptacji:', error);
            utils.showAlert(error.message || 'Błąd podczas akceptacji wyceny', 'error');
        } finally {
            utils.setLoading(false);
        }
    },

    /**
     * Zamyka modal
     * @param {string} modalId - ID modala
     */
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }

        // Wyczyść błędy formularza
        document.querySelectorAll('.form-error').forEach(el => {
            el.classList.add('hidden');
            el.textContent = '';
        });
    },

    /**
     * Przełącza widoczność podsumowania mobilnego
     */
    toggleSummary() {
        const details = document.getElementById('bottomBarDetails');
        const chevron = document.getElementById('summaryChevron');

        if (details && chevron) {
            details.classList.toggle('open');
            chevron.classList.toggle('open');
        }
    }
};

// ===================================
// INITIALIZATION
// ===================================
const init = {
    /**
     * Ładuje dane wyceny
     */
    async loadQuoteData() {
        try {
            utils.setLoading(true);

            const token = window.QUOTE_TOKEN;
            if (!token) {
                throw new Error('Brak tokenu wyceny');
            }

            // Pobierz dane z API
            globalState.quoteData = await api.getQuoteData(token);
            console.log('Załadowano dane wyceny:', globalState.quoteData);

            // Ustaw domyślnie wybrane warianty
            if (globalState.quoteData.items) {
                globalState.quoteData.items.forEach(item => {
                    if (item.is_selected) {
                        globalState.selectedVariants.set(item.product_index, item.id);
                    }
                });
            }

            // Sprawdź czy wycena jest zaakceptowana
            globalState.isQuoteAccepted = !globalState.quoteData.is_client_editable;

            // Renderuj UI
            this.renderAll();

        } catch (error) {
            console.error('Błąd ładowania danych:', error);
            utils.showAlert('Błąd ładowania danych wyceny', 'error');
        } finally {
            utils.setLoading(false);
        }
    },

    /**
     * Renderuje wszystkie elementy UI
     */
    renderAll() {
        render.productTabs();
        render.productSections();
        render.comparison();
        render.mobileSummary();

        // Pokaż/ukryj elementy w zależności od stanu
        if (globalState.isQuoteAccepted) {
            this.disableInteractions();
        }
    },

    /**
     * Wyłącza interakcje dla zaakceptowanej wyceny
     */
    disableInteractions() {
        // Wyłącz przycisk akceptacji
        const acceptBtn = document.querySelector('.btn-accept');
        if (acceptBtn) {
            acceptBtn.disabled = true;
            acceptBtn.textContent = 'Wycena zaakceptowana';
        }

        // Dodaj klasę do body
        document.body.classList.add('quote-accepted');
    },

    /**
     * Ustawia event listenery
     */
    setupEventListeners() {
        // Product selection (mobile)
        const productSelect = document.getElementById('productSelect');
        if (productSelect) {
            productSelect.addEventListener('change', (e) => {
                handlers.switchProduct(parseInt(e.target.value));
            });
        }

        // Close modals on outside click
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    handlers.closeModal(modal.id);
                }
            });
        });

        // Close 3D viewer on click outside
        const viewerModal = document.getElementById('viewerModal');
        if (viewerModal) {
            viewerModal.addEventListener('click', (e) => {
                if (e.target === viewerModal) {
                    handlers.close3DViewer();
                }
            });
        }

        // Expose handlers to global scope for onclick attributes
        window.handlers = handlers;
        window.toggleSummary = handlers.toggleSummary;
        window.showAcceptModal = handlers.showAcceptModal;
        window.closeModal = handlers.closeModal;
        window.handleAcceptSubmit = handlers.handleAcceptSubmit;
    }
};

// ===================================
// MAIN ENTRY POINT
// ===================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Client Quote JS - Initializing...');

    try {
        // Ustaw event listenery
        init.setupEventListeners();

        // Załaduj dane wyceny
        await init.loadQuoteData();

        console.log('Client Quote JS - Ready');

    } catch (error) {
        console.error('Błąd inicjalizacji:', error);
        utils.showAlert('Błąd ładowania strony', 'error');
    }
});

// ===================================
// PUBLIC API (dla debugowania)
// ===================================
window.clientQuote = {
    state: globalState,
    api: api,
    utils: utils,
    render: render,
    handlers: handlers,
    init: init
};