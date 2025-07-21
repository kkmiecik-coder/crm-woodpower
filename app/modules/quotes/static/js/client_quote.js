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
    isLoading: false,
    hasUnsavedChanges: false
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
            // Dąb
            'dab-lity-ab': 'Dąb lity A/B',
            'dab-lity-bb': 'Dąb lity B/B',
            'dab-micro-ab': 'Dąb mikrowczep A/B',
            'dab-micro-bb': 'Dąb mikrowczep B/B',

            // Jesion
            'jes-lity-ab': 'Jesion lity A/B',
            'jes-micro-ab': 'Jesion mikrowczep A/B',

            // Buk
            'buk-lity-ab': 'Buk lity A/B',
            'buk-micro-ab': 'Buk mikrowczep A/B',
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
        if (!canvas) {
            console.error('QR Canvas element not found:', elementId);
            return;
        }

        if (!window.QRCode) {
            console.error('QRCode library not loaded');
            return;
        }

        // Wyczyść poprzedni kod
        canvas.innerHTML = '';

        try {
            new QRCode(canvas, {
                text: text,
                width: 200,
                height: 200,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
            console.log('QR code generated successfully for:', text);
        } catch (error) {
            console.error('Error generating QR code:', error);
        }
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
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
                                </svg>
                                <span>${product.dimensions}</span>
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

                <div class="save-changes-section ${globalState.hasUnsavedChanges ? 'visible' : 'hidden'}" id="saveChangesSection-${product.index}">
                    <div class="save-changes-content">
                        <span class="save-changes-text">Masz niezapisane zmiany</span>
                        <button class="btn-save-changes" onclick="handlers.saveChanges()">
                            Zapisz zmiany
                        </button>
                    </div>
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

                // Użyj ścieżki z podwójnym quotes
                const variantImagePath = `/quotes/quotes/static/img/${variant.variant_code}.jpg`;

                // Te ceny już są przemnożone przez ilość w API
                const totalBrutto = variant.final_price_brutto || variant.unit_price_brutto || 0;
                const totalNetto = variant.final_price_netto || variant.unit_price_netto || 0;

                // Oblicz cenę jednostkową (podziel przez ilość)
                const quantity = variant.quantity || 1;
                const unitPriceBrutto = totalBrutto / quantity;
                const unitPriceNetto = totalNetto / quantity;

                return `
            <div class="variant-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}" 
                 ${globalState.isQuoteAccepted ? '' : `onclick="handlers.selectVariant(${product.index}, ${variant.id})"`}>
                <div class="variant-content">
                    <div class="variant-image" 
                         style="background-image: url('${variantImagePath}')" 
                         onerror="console.error('Failed to load image: ${variantImagePath}')">
                        <div class="variant-badge-overlay ${isSelected ? 'selected' : 'available'}">
                            ${globalState.isQuoteAccepted ? (isSelected ? 'Wybrany' : '') : (isSelected ? 'Wybrany' : 'Wybierz')}
                        </div>
                    </div>
                    <div class="variant-info">
                        <div class="variant-header">
                            <div class="variant-name">${utils.translateVariantCode(variant.variant_code)}</div>
                        </div>
                        <div class="variant-pricing-flex">
                            <div class="price-left">
                                <div class="price-label">Cena:</div>
                                <div class="price-brutto">${utils.formatCurrency(unitPriceBrutto)}</div>
                                <div class="price-netto">${utils.formatCurrency(unitPriceNetto)} netto</div>
                            </div>
                            <div class="price-right">
                                <div class="price-label">Wartość:</div>
                                <div class="price-brutto total">${utils.formatCurrency(totalBrutto)}</div>
                                <div class="price-netto">${utils.formatCurrency(totalNetto)} netto</div>
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

        // POPRAWKA: Pobierz pierwszy produkt jako bazę do porównania
        const firstProduct = this.groupProductsByIndex()[0];
        if (!firstProduct) return;

        tbody.innerHTML = variants.map(variant => {
            // POPRAWKA: Znajdź wariant dla pierwszego produktu
            const variantForProduct = firstProduct.variants.find(v => v.variant_code === variant.code);
            if (!variantForProduct) return '';

            // Oblicz ceny dla tego konkretnego wariantu
            const totalBrutto = variantForProduct.final_price_brutto || variantForProduct.unit_price_brutto || 0;
            const totalNetto = variantForProduct.final_price_netto || variantForProduct.unit_price_netto || 0;

            // Sprawdź czy jest wybrany
            const isSelected = globalState.selectedVariants.get(firstProduct.index) === variantForProduct.id;

            // Oblicz różnicę względem aktualnie wybranego
            const selectedVariantId = globalState.selectedVariants.get(firstProduct.index);
            const selectedVariant = firstProduct.variants.find(v => v.id === selectedVariantId);
            const selectedTotal = selectedVariant ? (selectedVariant.final_price_brutto || selectedVariant.unit_price_brutto || 0) : 0;
            const difference = totalBrutto - selectedTotal;

            return `
            <tr class="${isSelected ? 'selected-row' : ''}">
                <td>${variant.name}</td>
                <td class="price-cell">${utils.formatCurrency(totalNetto)}</td>
                <td class="price-cell">${utils.formatCurrency(totalBrutto)}</td>
                <td class="price-cell">
                    ${difference !== 0 ? (difference > 0 ? '+' : '') + utils.formatCurrency(difference) : '-'}
                </td>
            </tr>
        `;
        }).filter(row => row !== '').join('');
    },

    /**
    * Renderuje podsumowanie na desktop z cenami brutto i netto
    */
    desktopSummary() {
        const summaryContainer = document.getElementById('desktopSummaryContent');
        const totalContainer = document.getElementById('desktopTotalSummary');

        if (!summaryContainer || !totalContainer || !globalState.quoteData) return;

        const selectedItems = this.getSelectedItems();
        const costs = globalState.quoteData.costs || {};

        // Renderuj zawartość podsumowania z pełnymi nazwami produktów i ilościami
        summaryContainer.innerHTML = selectedItems.map(item => {
            const product = this.getProductByIndex(item.product_index);
            const variantName = utils.translateVariantCode(item.variant_code);
            const quantity = item.quantity || 1;
            const productName = product ? product.full_name || `Produkt ${item.product_index}` : `Produkt ${item.product_index}`;

            return `
        <div class="summary-item">
            <div class="summary-item-label">
                ${productName} ${variantName}
                <br><small>${quantity} szt.</small>
            </div>
            <div class="summary-item-value">
                <div class="price-brutto">${utils.formatCurrency(item.final_price_brutto)}</div>
                <div class="price-netto">${utils.formatCurrency(item.final_price_netto)} netto</div>
            </div>
        </div>
    `;
        }).join('');

        // Renderuj podsumowanie całkowite z cenami brutto i netto
        totalContainer.innerHTML = `
    <div class="summary-total-row">
        <span class="summary-total-label">Produkty:</span>
        <div class="summary-total-value">
            <div class="price-brutto">${utils.formatCurrency(costs.products?.brutto || 0)}</div>
            <div class="price-netto">${utils.formatCurrency(costs.products?.netto || 0)} netto</div>
        </div>
    </div>
    <div class="summary-total-row">
        <span class="summary-total-label">Wykończenie:</span>
        <div class="summary-total-value">
            <div class="price-brutto">${utils.formatCurrency(costs.finishing?.brutto || 0)}</div>
            <div class="price-netto">${utils.formatCurrency(costs.finishing?.netto || 0)} netto</div>
        </div>
    </div>
    <div class="summary-total-row">
        <span class="summary-total-label">Transport:</span>
        <div class="summary-total-value">
            <div class="price-brutto">${utils.formatCurrency(costs.shipping?.brutto || 0)}</div>
            <div class="price-netto">${utils.formatCurrency(costs.shipping?.netto || 0)} netto</div>
        </div>
    </div>
    <div class="summary-total-row total-row">
        <span class="summary-total-label summary-total-main">RAZEM:</span>
        <div class="summary-total-value">
            <div class="price-brutto summary-total-main">${utils.formatCurrency(costs.total?.brutto || 0)}</div>
            <div class="price-netto total-netto">${utils.formatCurrency(costs.total?.netto || 0)} netto</div>
        </div>
    </div>
    `;
    },

    /**
 * Aktualizuje mobilne podsumowanie z cenami brutto i netto
 */
    mobileSummary() {
        const detailsContent = document.getElementById('mobileDetailsContent');
        const totalPrice = document.getElementById('mobileTotalPrice');

        if (!detailsContent || !totalPrice || !globalState.quoteData) return;

        const selectedItems = this.getSelectedItems();
        const costs = globalState.quoteData.costs || {};

        // Aktualizuj całkowitą cenę
        totalPrice.innerHTML = `
        <div class="price-netto mobile-total-netto">${utils.formatCurrency(costs.total?.netto || 0)} netto</div>
        <div class="price-brutto">${utils.formatCurrency(costs.total?.brutto || 0)}</div>
    `;

        // Renderuj szczegóły z pełnymi nazwami produktów i ilościami
        detailsContent.innerHTML = `
        <div class="mobile-summary-details">
            ${selectedItems.map(item => {
            const product = this.getProductByIndex(item.product_index);
            const variantName = utils.translateVariantCode(item.variant_code);
            const quantity = item.quantity || 1;
            const productName = product ? product.full_name || `Produkt ${item.product_index}` : `Produkt ${item.product_index}`;

            return `
                    <div class="mobile-summary-item">
                        <span>${productName} ${variantName} (${quantity} szt.)</span>
                        <div class="mobile-price-stack">
                            <div class="price-netto">${utils.formatCurrency(item.final_price_netto)} netto</div>
                            <div class="price-brutto">${utils.formatCurrency(item.final_price_brutto)}</div>
                        </div>
                    </div>
                `;
        }).join('')}
        
        <div class="mobile-summary-section">
            <div class="mobile-summary-item">
                <span>Wykończenie:</span>
                <div class="mobile-price-stack">
                    <div class="price-netto">${utils.formatCurrency(costs.finishing?.netto || 0)} netto</div>
                    <div class="price-brutto">${utils.formatCurrency(costs.finishing?.brutto || 0)}</div>
                </div>
            </div>
            <div class="mobile-summary-item">
                <span>Transport:</span>
                <div class="mobile-price-stack">
                    <div class="price-netto">${utils.formatCurrency(costs.shipping?.netto || 0)} netto</div>
                    <div class="price-brutto">${utils.formatCurrency(costs.shipping?.brutto || 0)}</div>
                </div>
            </div>
            <div class="mobile-summary-item total">
                <span>RAZEM:</span>
                <div class="mobile-price-stack">
                    <div class="price-netto">${utils.formatCurrency(costs.total?.netto || 0)} netto</div>
                    <div class="price-brutto">${utils.formatCurrency(costs.total?.brutto || 0)}</div>
                </div>
            </div>
        </div>
    </div>
    `;
    },

    /**
    * Renderuje porównanie wariantów na desktop
    */
    desktopComparison() {
        const tbody = document.getElementById('desktopComparisonBody');
        if (!tbody || !globalState.quoteData) return;

        const variants = this.getUniqueVariants();

        // POPRAWKA: Pobierz pierwszy produkt jako bazę do porównania
        const firstProduct = this.groupProductsByIndex()[0];
        if (!firstProduct) return;

        tbody.innerHTML = variants.map(variant => {
            // POPRAWKA: Znajdź wariant dla pierwszego produktu
            const variantForProduct = firstProduct.variants.find(v => v.variant_code === variant.code);
            if (!variantForProduct) return '';

            // Oblicz ceny dla tego konkretnego wariantu
            const totalBrutto = variantForProduct.final_price_brutto || variantForProduct.unit_price_brutto || 0;
            const totalNetto = variantForProduct.final_price_netto || variantForProduct.unit_price_netto || 0;

            // Sprawdź czy jest wybrany
            const isSelected = globalState.selectedVariants.get(firstProduct.index) === variantForProduct.id;

            // Oblicz różnicę względem aktualnie wybranego
            const selectedVariantId = globalState.selectedVariants.get(firstProduct.index);
            const selectedVariant = firstProduct.variants.find(v => v.id === selectedVariantId);
            const selectedTotal = selectedVariant ? (selectedVariant.final_price_brutto || selectedVariant.unit_price_brutto || 0) : 0;
            const difference = totalBrutto - selectedTotal;

            return `
            <tr class="${isSelected ? 'selected-row' : ''}">
                <td>${variant.name}</td>
                <td class="price-cell">${utils.formatCurrency(totalNetto)}</td>
                <td class="price-cell">${utils.formatCurrency(totalBrutto)}</td>
                <td class="price-cell">
                    ${difference !== 0 ? (difference > 0 ?
                    `+${utils.formatCurrency(difference)}` :
                    `${utils.formatCurrency(difference)}`
                ) : '-'}
                </td>
            </tr>
        `;
        }).filter(row => row !== '').join('');
    },

    /**
     * Pobiera wybrane pozycje wyceny
     */
    getSelectedItems() {
        if (!globalState.quoteData?.items) return [];
        return globalState.quoteData.items.filter(item => item.is_selected);
    },

    /**
     * Pobiera produkt według indeksu
     */
    getProductByIndex(index) {
        const products = this.groupProductsByIndex();
        return products.find(p => p.index === index);
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
                // POPRAWKA: Użyj final_price zamiast price
                const priceBrutto = variant.final_price_brutto || variant.unit_price_brutto || 0;
                const priceNetto = variant.final_price_netto || variant.unit_price_netto || 0;

                totalNetto += priceNetto * product.quantity;
                totalBrutto += priceBrutto * product.quantity;
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
                // POPRAWKA: Użyj final_price zamiast price
                const priceBrutto = variant.final_price_brutto || variant.unit_price_brutto || 0;
                const priceNetto = variant.final_price_netto || variant.unit_price_netto || 0;

                totalNetto += priceNetto * product.quantity;
                totalBrutto += priceBrutto * product.quantity;
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
    },

    /**
     * Odświeża wszystkie elementy UI
     */
    refreshUI() {
        this.productTabs();
        this.productSections();
        this.comparison();
        this.mobileSummary();
        this.desktopSummary();
        this.desktopComparison();
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

        // POPRAWKA: Sprawdź czy już wybrany wariant
        const currentlySelected = globalState.selectedVariants.get(productIndex);
        if (currentlySelected === variantId) {
            console.log('Wariant już wybrany, nie pokazuj przycisku');
            return; // Nie rób nic jeśli kliknięto już wybrany wariant
        }

        // Zaktualizuj stan lokalny BEZ wywoływania API
        globalState.selectedVariants.set(productIndex, variantId);
        globalState.hasUnsavedChanges = true;

        // Odśwież UI żeby pokazać nowy wybór i przycisk Zapisz
        render.productSections();
        render.comparison();
        render.mobileSummary();
        render.desktopSummary();
        render.desktopComparison();

        // Pokaż przycisk zapisz
        this.showSaveButton();

        utils.showAlert('Wariant został wybrany. Kliknij "Zapisz" aby potwierdzić.', 'info');
    },

    // NOWA funkcja zapisywania zmian:
    async saveChanges() {
        if (!globalState.hasUnsavedChanges || globalState.isLoading) return;

        const saveButton = document.querySelector('.btn-save-changes');
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = 'Zapisywanie...';
        }

        try {
            utils.setLoading(true);

            // Znajdź ostatnio zmieniony wariant
            const changes = [];
            globalState.selectedVariants.forEach((variantId, productIndex) => {
                changes.push({ productIndex, variantId });
            });

            // Zapisz każdą zmianę przez API
            for (const change of changes) {
                await api.updateVariant(window.QUOTE_TOKEN, change.variantId);
            }

            // Oznacz zmiany jako zapisane
            globalState.hasUnsavedChanges = false;

            // Ukryj przycisk
            this.hideSaveButton();

            // Odśwież dane z serwera
            await init.loadQuoteData();

            utils.showAlert('Zmiany zostały zapisane!', 'success');

        } catch (error) {
            console.error('Błąd przy zapisywaniu zmian:', error);
            utils.showAlert('Błąd przy zapisywaniu zmian', 'error');

            // Przywróć przycisk w przypadku błędu
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.textContent = 'Zapisz zmiany';
            }
        } finally {
            utils.setLoading(false);
        }
    },

    // NOWE funkcje pomocnicze:
    showSaveButton() {
        document.querySelectorAll('.save-changes-section').forEach(section => {
            section.classList.remove('hidden');

            // Opóźnienie żeby animacja zadziałała
            requestAnimationFrame(() => {
                section.classList.add('visible');
            });
        });
    },

    hideSaveButton() {
        document.querySelectorAll('.save-changes-section').forEach(section => {
            section.classList.remove('visible');

            // Opóźnienie przed ukryciem
            setTimeout(() => {
                section.classList.add('hidden');
            }, 400);
        });
    },

    /**
 * Otwiera podgląd 3D
 * @param {number} productIndex - Indeks produktu
 */
    open3DViewer(productIndex) {
        const modal = document.getElementById('viewerModal');
        const iframe = document.getElementById('viewerFrame');

        if (!modal || !iframe) {
            console.error('Modal lub iframe nie zostały znalezione');
            return;
        }

        // Przygotuj dane wszystkich wariantów dla produktu
        const products = render.groupProductsByIndex();
        const product = products.find(p => p.index === productIndex);
        if (!product) {
            console.error('Nie znaleziono produktu:', productIndex);
            return;
        }

        // Pobierz wszystkie warianty dla tego produktu z globalState
        const allVariants = globalState.quoteData.items
            .filter(item => item.product_index === productIndex)
            .map(item => ({
                id: item.id,
                variant_code: item.variant_code,
                length_cm: item.length_cm,
                width_cm: item.width_cm,
                thickness_cm: item.thickness_cm,
                dimensions: `${item.length_cm} × ${item.width_cm} × ${item.thickness_cm} cm`,
                is_selected: item.is_selected,
                price: item.final_price_brutto
            }));

        console.log('Warianty dla produktu', productIndex, ':', allVariants);

        // Znajdź aktualnie wybrany wariant
        const currentVariantId = globalState.selectedVariants.get(productIndex) ||
            allVariants.find(v => v.is_selected)?.id ||
            allVariants[0]?.id;

        // Ustaw URL iframe z wszystkimi wariantami
        const params = new URLSearchParams({
            quote: window.QUOTE_NUMBER,
            product: productIndex,
            token: window.QUOTE_TOKEN,
            variants: JSON.stringify(allVariants),
            current_variant: currentVariantId
        });

        const viewerUrl = `/preview3d-ar/quote/${window.QUOTE_NUMBER}?${params}`;
        console.log('Otwieranie 3D viewer:', viewerUrl);

        iframe.src = viewerUrl;
        modal.classList.add('active');

        // Dodaj komunikację z iframe
        this.setupIframeCommunication(iframe, productIndex);

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
     * Konfiguruje komunikację z iframe 3D viewer
     */
    setupIframeCommunication(iframe, productIndex) {
        const messageHandler = (event) => {
            // Sprawdź pochodzenie i typ wiadomości
            if (!event.data || event.data.type !== '3d_viewer_message') return;

            const { action, variantId } = event.data;

            if (action === 'variant_changed') {
                console.log('Wariant zmieniony z 3D viewer na:', variantId);

                // Aktualizuj wybrany wariant w głównej aplikacji
                handlers.switchVariant(productIndex, variantId);

                // Opcjonalnie: pokaż alert o zmianie
                utils.showAlert('Wariant został zmieniony', 'info');
            }

            if (action === 'viewer_ready') {
                console.log('3D viewer gotowy do pracy');
            }

            if (action === 'viewer_error') {
                console.error('Błąd w 3D viewer:', event.data.error);
                utils.showAlert('Błąd ładowania modelu 3D', 'error');
            }
        };

        // Dodaj listener dla wiadomości z iframe
        window.addEventListener('message', messageHandler);

        // Zapisz referencję do message handler dla późniejszego usunięcia
        iframe._messageHandler = messageHandler;
    },

    /**
     * Zamyka podgląd 3D i czyści event listenery
     */
    close3DViewer() {
        const modal = document.getElementById('viewerModal');
        const iframe = document.getElementById('viewerFrame');

        if (modal) modal.classList.remove('active');

        if (iframe) {
            // Usuń message handler
            if (iframe._messageHandler) {
                window.removeEventListener('message', iframe._messageHandler);
                delete iframe._messageHandler;
            }

            // Wyczyść src po krótkiej chwili (dla animacji)
            setTimeout(() => {
                iframe.src = '';
            }, 300);
        }
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
            if (!modal) {
                console.error('QR Modal not found');
                return;
            }
            modal.classList.add('active');

            setTimeout(() => {
                const currentUrl = window.location.href;
                console.log('Generating QR code for URL:', currentUrl);

                const qrContainer = document.getElementById('qrCode');
                if (qrContainer) {
                    // BARDZIEJ AGRESYWNE CZYSZCZENIE
                    qrContainer.innerHTML = '';
                    qrContainer.textContent = '';

                    // Usuń wszystkie dzieci
                    while (qrContainer.firstChild) {
                        qrContainer.removeChild(qrContainer.firstChild);
                    }

                    // Sprawdź czy biblioteka QRCode jest załadowana
                    if (typeof QRCode !== 'undefined') {
                        try {
                            // Generuj bezpośrednio w qrContainer
                            new QRCode(qrContainer, {
                                text: currentUrl,
                                width: 200,
                                height: 200,
                                colorDark: '#000000',
                                colorLight: '#ffffff',
                                correctLevel: QRCode.CorrectLevel.H
                            });
                            console.log('QR code generated successfully');

                            // NAPRAWKA - usuń dublowane elementy
                            setTimeout(() => {
                                const canvases = qrContainer.querySelectorAll('canvas');
                                canvases.forEach(canvas => canvas.remove());

                                // Upewnij się, że IMG jest wyśrodkowany
                                const img = qrContainer.querySelector('img');
                                if (img) {
                                    img.style.display = 'block';
                                    img.style.margin = '0 auto';
                                }

                                console.log('Cleaned up duplicate elements');
                            }, 100);

                        } catch (error) {
                            console.error('Error generating QR code:', error);
                        }
                    } else {
                        console.error('QRCode library not loaded');
                    }
                }

                // Pokaż URL
                const urlEl = document.getElementById('qrUrl');
                if (urlEl) {
                    urlEl.textContent = currentUrl;
                }
            }, 300);
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
        render.desktopSummary();
        render.desktopComparison();

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

        // DODANE: Close QR modal on click outside
        const qrModal = document.getElementById('qrModal');
        if (qrModal) {
            qrModal.addEventListener('click', (e) => {
                if (e.target === qrModal) {
                    handlers.closeModal('qrModal');
                }
            });
        }

        // DODANE: Close QR modal on ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const activeModal = document.querySelector('.modal-overlay.active');
                if (activeModal) {
                    handlers.closeModal(activeModal.id);
                }
            }
        });

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