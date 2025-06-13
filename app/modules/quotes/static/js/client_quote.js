// ===================================
// CLIENT QUOTE JS - Wood Power v2.0
// ===================================
console.log('[ClientQuote] Script loaded - Wood Power v2.0');

// ===================================
// GLOBAL STATE MANAGEMENT
let globalState = {
    quoteData: null,
    isLoading: false,
    isMobileView: false,
    isMobilePanelExpanded: false,
    selectedVariants: new Map(),
    cachedElements: new Map(),
    isQuoteAccepted: false,
    isQuoteEditable: true
};

// ===================================
// DATA SYNCHRONIZATION
// Synchronizacja danych między desktop a mobile
// ===================================

/**
 * DataSync - synchronizuje dane między różnymi widokami
 * Zapewnia spójność między desktop sidebar a mobile panel
 */
const dataSync = {
    /**
     * Synchronizuje wszystkie dane między desktop a mobile
     */
    syncAll: () => {
        if (!globalState.quoteData) return;

        dataSync.syncBasicInfo();
        dataSync.syncProductsBreakdown();
        dataSync.syncPriceSummary();
        dataSync.syncMobilePanelSummary();
    },

    /**
     * Synchronizuje podstawowe informacje o wycenie
     */
    syncBasicInfo: () => {
        const data = globalState.quoteData;
        if (!data) return;

        // Desktop elements
        const desktopElements = {
            clientName: utils.getCachedElement('client-name'),
            employeeName: utils.getCachedElement('employee-name'),
            quoteCreatedDate: utils.getCachedElement('quote-created-date'),
            courierName: utils.getCachedElement('courier-name')
        };

        // Mobile elements (z prefiksem mobile-)
        const mobileElements = {
            clientName: utils.getCachedElement('mobile-client-name'),
            employeeName: utils.getCachedElement('mobile-employee-name'),
            quoteCreatedDate: utils.getCachedElement('mobile-quote-created-date'),
            courierName: utils.getCachedElement('mobile-courier-name')
        };

        // Przygotowujemy dane
        const syncData = {
            clientName: data.client?.client_name || '-',
            employeeName: `${data.user?.first_name || ''} ${data.user?.last_name || ''}`.trim() || '-',
            quoteCreatedDate: utils.formatDate(data.created_at),
            courierName: data.courier_name || '-'
        };

        // Synchronizujemy desktop
        Object.keys(desktopElements).forEach(key => {
            const element = desktopElements[key];
            if (element) {
                element.textContent = syncData[key];
            }
        });

        // Synchronizujemy mobile
        Object.keys(mobileElements).forEach(key => {
            const element = mobileElements[key];
            if (element) {
                element.textContent = syncData[key];
            }
        });
    },

    /**
     * Synchronizuje breakdown produktów
     */
    syncProductsBreakdown: () => {
        const data = globalState.quoteData;
        if (!data || !data.items) return;

        // Grupujemy produkty według product_index
        const groupedProducts = {};
        data.items.forEach(item => {
            if (!groupedProducts[item.product_index]) {
                groupedProducts[item.product_index] = [];
            }
            groupedProducts[item.product_index].push(item);
        });

        const breakdownHTML = dataSync.generateProductsBreakdownHTML(groupedProducts);

        // Aktualizujemy desktop
        const desktopBreakdown = utils.getCachedElement('products-breakdown');
        if (desktopBreakdown) {
            desktopBreakdown.innerHTML = breakdownHTML;
        }

        // Aktualizujemy mobile
        const mobileBreakdown = utils.getCachedElement('mobile-products-breakdown');
        if (mobileBreakdown) {
            mobileBreakdown.innerHTML = breakdownHTML;
        }
    },

    /**
     * Generuje HTML dla breakdown produktów
     * @param {Object} groupedProducts - Produkty zgrupowane według indeksu
     * @returns {string} HTML breakdown
     */
    generateProductsBreakdownHTML: (groupedProducts) => {
        return Object.keys(groupedProducts)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(productIndex => {
                const items = groupedProducts[productIndex];
                const selectedItem = items.find(item => item.is_selected) || items[0];

                if (!selectedItem) return '';

                const variantName = utils.translateVariantCode(selectedItem.variant_code);
                const dimensions = `${selectedItem.length_cm}×${selectedItem.width_cm}×${selectedItem.thickness_cm} cm`;
                
                // NOWE: Pobierz ilość z finishing details
                const finishing = globalState.quoteData.finishing?.find(f => f.product_index === parseInt(productIndex));
                const quantity = finishing?.quantity || 1;
                
                // NOWE: Użyj wartości całkowitych (cena × ilość)
                const unitPriceBrutto = selectedItem.price_brutto || selectedItem.final_price_brutto || 0;
                const unitPriceNetto = selectedItem.price_netto || selectedItem.final_price_netto || 0;
                const totalPriceBrutto = unitPriceBrutto * quantity;
                const totalPriceNetto = unitPriceNetto * quantity;
                
                const priceBrutto = utils.formatCurrency(totalPriceBrutto);
                const priceNetto = utils.formatCurrency(totalPriceNetto);

                return `
                    <div class="product-breakdown-item">
                        <div class="product-breakdown-info">
                            <div class="product-breakdown-name">Produkt ${productIndex}: ${dimensions}</div>
                            <div class="product-breakdown-details">${variantName}, ${quantity} szt.</div>
                        </div>
                        <div class="product-breakdown-price">
                            <span class="breakdown-price-brutto">${priceBrutto}</span>
                            <span class="breakdown-price-netto">${priceNetto} netto</span>
                        </div>
                    </div>
                `;
            }).join('');
    },

    /**
     * Synchronizuje podsumowanie cen
     */
    syncPriceSummary: () => {
        const data = globalState.quoteData;
        if (!data || !data.costs) return;

        const costs = data.costs;

        // Desktop elements
        const desktopElements = {
            finishingBrutto: utils.getCachedElement('finishing-price-brutto'),
            finishingNetto: utils.getCachedElement('finishing-price-netto'),
            shippingBrutto: utils.getCachedElement('shipping-price-brutto'),
            shippingNetto: utils.getCachedElement('shipping-price-netto'),
            totalBrutto: utils.getCachedElement('total-price-brutto'),
            totalNetto: utils.getCachedElement('total-price-netto')
        };

        // Mobile elements
        const mobileElements = {
            finishingBrutto: utils.getCachedElement('mobile-finishing-price-brutto'),
            finishingNetto: utils.getCachedElement('mobile-finishing-price-netto'),
            shippingBrutto: utils.getCachedElement('mobile-shipping-price-brutto'),
            shippingNetto: utils.getCachedElement('mobile-shipping-price-netto'),
            totalBrutto: utils.getCachedElement('mobile-total-price-brutto'),
            totalNetto: utils.getCachedElement('mobile-total-price-netto')
        };

        // Przygotowujemy dane
        const syncData = {
            finishingBrutto: utils.formatCurrency(costs.finishing?.brutto),
            finishingNetto: utils.formatCurrency(costs.finishing?.netto),
            shippingBrutto: utils.formatCurrency(costs.shipping?.brutto),
            shippingNetto: utils.formatCurrency(costs.shipping?.netto),
            totalBrutto: utils.formatCurrency(costs.total?.brutto),
            totalNetto: utils.formatCurrency(costs.total?.netto)
        };

        // Synchronizujemy desktop
        Object.keys(desktopElements).forEach(key => {
            const element = desktopElements[key];
            if (element) {
                element.textContent = syncData[key];
            }
        });

        // Synchronizujemy mobile
        Object.keys(mobileElements).forEach(key => {
            const element = mobileElements[key];
            if (element) {
                element.textContent = syncData[key];
            }
        });
    },

    /**
     * Synchronizuje podsumowanie w mobile panel
     */
    syncMobilePanelSummary: () => {
        const data = globalState.quoteData;
        if (!data) return;

        const mobileTotal = utils.getCachedElement('mobile-total');
        const mobileItemsCount = utils.getCachedElement('mobile-items-count');

        if (mobileTotal && data.costs?.total?.brutto) {
            mobileTotal.textContent = utils.formatCurrency(data.costs.total.brutto);
        }

        if (mobileItemsCount && data.items) {
            // Liczmy unikalne produkty (product_index)
            const uniqueProducts = new Set(data.items.map(item => item.product_index));
            const count = uniqueProducts.size;
            mobileItemsCount.textContent = `${count} ${count === 1 ? 'produkt' : count < 5 ? 'produkty' : 'produktów'}`;
        }
    }
};

// ===================================
// QUOTE DATA MANAGEMENT
// Zarządzanie danymi wyceny
// ===================================

/**
 * Quote module - zarządza danymi wyceny i ich wyświetlaniem
 * Główny moduł odpowiedzialny za logikę biznesową wyceny
 */


const quote = {
    /**
     * Ładuje dane wyceny z API
     */
    load: async () => {
        try {
            utils.setLoading(true);
            alerts.clear();

            const token = window.QUOTE_TOKEN;
            if (!token) {
                throw new Error('Brak tokenu wyceny');
            }

            console.log('[Quote] Loading data for token:', token);
            globalState.quoteData = await api.getQuoteData(token);

            console.log('[Quote] Data loaded:', globalState.quoteData);
            
            // SPRAWDZENIE: Upewnij się że mamy token w danych
            if (!globalState.quoteData.public_token) {
                console.warn('[Quote] Brak public_token w danych - dodaję z window.QUOTE_TOKEN');
                globalState.quoteData.public_token = token;
            }

            // Aktualizujemy stan aplikacji na podstawie danych
            quote.updateApplicationState();

            // Inicjalizujemy mapę wybranych wariantów
            quote.initializeSelectedVariants();

            // Renderujemy interfejs
            quote.render();

        } catch (error) {
            console.error('[Quote] Failed to load data:', error);
            quote.handleError(error);
        } finally {
            utils.setLoading(false);
        }
    },

    /**
     * Aktualizuje stan aplikacji na podstawie załadowanych danych
     */
    updateApplicationState: () => {
        const data = globalState.quoteData;
        if (!data) return;

        // Sprawdzamy czy wycena jest zaakceptowana
        globalState.isQuoteAccepted = !data.is_client_editable;
        globalState.isQuoteEditable = data.is_client_editable;

        // Aktualizujemy klasę body dla CSS
        const body = document.body;
        if (globalState.isQuoteAccepted) {
            body.classList.add('quote-accepted');
        } else {
            body.classList.remove('quote-accepted');
        }

        console.log('[Quote] Application state updated:', {
            isAccepted: globalState.isQuoteAccepted,
            isEditable: globalState.isQuoteEditable,
            hasToken: !!globalState.quoteData.public_token
        });
    },

    /**
     * Inicjalizuje mapę wybranych wariantów
     */
    initializeSelectedVariants: () => {
        globalState.selectedVariants.clear();

        if (globalState.quoteData && globalState.quoteData.items) {
            globalState.quoteData.items.forEach(item => {
                if (item.is_selected) {
                    globalState.selectedVariants.set(item.product_index, item.id);
                }
            });
        }

        console.log('[Quote] Selected variants initialized:', globalState.selectedVariants);
    },

    render: () => {
        if (!globalState.quoteData) return;

        console.log('[Quote] Rendering interface');

        // Renderujemy wszystkie sekcje
        quote.renderHeader();
        quote.renderStatusBanner();
        quote.renderSellerNotes();
        quote.renderProducts();

        // Synchronizujemy dane między desktop a mobile
        dataSync.syncAll();

        // Pokazujemy odpowiednie sekcje
        quote.showSections();

        // Ustawiamy odpowiedni stan akceptacji
        quote.handleAcceptanceState();
    },

    /**
     * Renderuje header z podstawowymi informacjami
     */
    renderHeader: () => {
        const data = globalState.quoteData;
        if (!data) return;

        // Aktualizujemy numer wyceny w header
        const quoteNumber = utils.getCachedElement('quote-number');
        if (quoteNumber) {
            quoteNumber.textContent = data.quote_number || window.QUOTE_NUMBER;
        }

        // Aktualizujemy datę w header
        const quoteDate = utils.getCachedElement('quote-date');
        if (quoteDate) {
            quoteDate.textContent = utils.formatShortDate(data.created_at);
        }
    },

    /**
     * Renderuje banner statusu wyceny
     */
    renderStatusBanner: () => {
        const data = globalState.quoteData;
        const banner = utils.getCachedElement('quote-status-banner');

        if (!banner || !data) return;

        const statusTitle = utils.getCachedElement('status-title');
        const statusDescription = utils.getCachedElement('status-description');

        let statusClass = 'status-pending';
        let title = 'Wycena aktywna';
        let description = 'Wycena oczekuje na Twoją akceptację.';

        if (globalState.isQuoteAccepted) {
            statusClass = 'status-accepted';
            title = 'Wycena zaakceptowana';
            description = 'Dziękujemy! Wycena została zaakceptowana i przekazana do realizacji.';
        }

        // Aktualizujemy klasy CSS
        banner.className = `quote-status-banner ${statusClass}`;

        // Aktualizujemy teksty
        if (statusTitle) {
            statusTitle.textContent = title;
        }
        if (statusDescription) {
            statusDescription.textContent = description;
        }

        // Pokazujemy banner
        banner.style.display = 'flex';
    },

    /**
     * Renderuje notatki sprzedawcy jeśli istnieją
     */
    renderSellerNotes: () => {
        const data = globalState.quoteData;
        const notesSection = utils.getCachedElement('seller-notes');
        const notesContent = utils.getCachedElement('seller-notes-content');

        if (!notesSection || !notesContent) return;

        // Sprawdzamy czy są notatki sprzedawcy (będzie dodane w backend)
        if (data.seller_notes && data.seller_notes.trim()) {
            notesContent.innerHTML = data.seller_notes.replace(/\n/g, '<br>');
            notesSection.style.display = 'block';
        } else {
            notesSection.style.display = 'none';
        }
    },

    /**
     * Renderuje sekcję produktów
     */
    renderProducts: () => {
        const container = utils.getCachedElement('products-container');
        if (!container || !globalState.quoteData) return;

        console.log('[Quote] Rendering products');

        // Grupujemy pozycje według product_index
        const groupedItems = {};
        globalState.quoteData.items.forEach(item => {
            if (!groupedItems[item.product_index]) {
                groupedItems[item.product_index] = [];
            }
            groupedItems[item.product_index].push(item);
        });

        // Czyścimy kontener
        container.innerHTML = '';

        // Renderujemy każdą grupę produktów
        Object.keys(groupedItems)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .forEach(productIndex => {
                const items = groupedItems[productIndex];
                const productGroup = quote.createProductGroup(parseInt(productIndex), items);
                container.appendChild(productGroup);
            });
    },

    /**
     * Tworzy grupę produktów (jeden produkt z wariantami)
     * @param {number} productIndex - Indeks produktu
     * @param {Array} items - Lista wariantów produktu
     * @returns {HTMLElement} Element grupy produktów
     */
    createProductGroup: (productIndex, items) => {
        const selectedItem = items.find(item => item.is_selected) || items[0];
        const finishing = globalState.quoteData.finishing?.find(f => f.product_index === productIndex);

        const group = document.createElement('div');
        group.className = 'product-group';

        // Header produktu z podstawowymi informacjami
        const headerHTML = quote.createProductHeaderHTML(productIndex, selectedItem, finishing);

        // Grid wariantów
        const variantsHTML = items.map(item => quote.createVariantCardHTML(item)).join('');

        group.innerHTML = `
            ${headerHTML}
            <div class="product-variants">
                <div class="variant-grid">
                    ${variantsHTML}
                </div>
            </div>
        `;

        return group;
    },

    /**
     * Tworzy HTML nagłówka produktu
     * @param {number} productIndex - Indeks produktu
     * @param {Object} selectedItem - Wybrany wariant
     * @param {Object} finishing - Dane wykończenia
     * @returns {string} HTML nagłówka
     */
    createProductHeaderHTML: (productIndex, selectedItem, finishing) => {
        const dimensions = `${selectedItem.length_cm}×${selectedItem.width_cm}×${selectedItem.thickness_cm} cm`;
        const volume = selectedItem.volume_m3?.toFixed(3) || '0.000';
        
        // NOWE: Pobierz ilość z finishing details
        const quantity = finishing?.quantity || 1;

        let finishingHTML = '';
        if (finishing) {
            const finishingParts = [
                finishing.variant,
                finishing.type,
                finishing.color,
                finishing.gloss
            ].filter(Boolean);

            const finishingDisplay = finishingParts.length > 0 ? finishingParts.join(' - ') : 'Brak wykończenia';
            finishingHTML = `<div><strong>Wykończenie:</strong> ${finishingDisplay}</div>`;
        }

        // NOWE: Dodaj informacje o cenach brutto/netto (jednostkowych i całkowitych)
        const unitPriceBrutto = selectedItem.price_brutto || selectedItem.final_price_brutto || 0;
        const unitPriceNetto = selectedItem.price_netto || selectedItem.final_price_netto || 0;
        const totalPriceBrutto = unitPriceBrutto * quantity;
        const totalPriceNetto = unitPriceNetto * quantity;

        const priceHTML = `
            <div class="product-pricing">
                <div class="pricing-row">
                    <span class="price-label"><strong>Cena:</strong></span>
                    <div class="price-values">
                        <span class="price-brutto">${utils.formatCurrency(unitPriceBrutto)} brutto</span>
                        <span class="price-netto">${utils.formatCurrency(unitPriceNetto)} netto</span>
                    </div>
                </div>
                <div class="pricing-row">
                    <span class="price-label"><strong>Wartość:</strong></span>
                    <div class="price-values">
                        <span class="price-brutto">${utils.formatCurrency(totalPriceBrutto)} brutto</span>
                        <span class="price-netto">${utils.formatCurrency(totalPriceNetto)} netto</span>
                    </div>
                </div>
            </div>
        `;

        return `
            <div class="product-header">
                <div class="product-title">Produkt ${productIndex}</div>
                <div class="product-summary">
                    <div class="product-details">
                        <div><strong>Wymiary:</strong> ${dimensions}</div>
                        <div><strong>Objętość:</strong> ${volume} m³</div>
                        ${finishingHTML}
                        <div><strong>Ilość:</strong> ${quantity} szt.</div>
                    </div>
                    ${priceHTML}
                </div>
            </div>
        `;
    },

    /**
     * Tworzy HTML karty wariantu - KOMPAKTOWY DESIGN
     * @param {Object} item - Dane wariantu
     * @returns {string} HTML karty wariantu
     */
    createVariantCardHTML: (item) => {
        const isSelected = globalState.selectedVariants.get(item.product_index) === item.id;
        const variantName = utils.translateVariantCode(item.variant_code);
        
        // NOWE: Pobierz ilość z finishing details
        const finishing = globalState.quoteData.finishing?.find(f => f.product_index === item.product_index);
        const quantity = finishing?.quantity || 1;

        // Sprawdzamy czy wariant ma rabat
        const hasDiscount = item.discount_percentage && item.discount_percentage !== 0;
        const originalPriceBrutto = hasDiscount ? (item.original_price_brutto || item.final_price_brutto) : null;
        const originalPriceNetto = hasDiscount ? (item.original_price_netto || item.final_price_netto) : null;
        
        // Ceny jednostkowe
        const unitPriceBrutto = item.price_brutto || item.final_price_brutto || 0;
        const unitPriceNetto = item.price_netto || item.final_price_netto || 0;
        
        // Wartości całkowite
        const totalPriceBrutto = unitPriceBrutto * quantity;
        const totalPriceNetto = unitPriceNetto * quantity;

        // NOWE: Badge tylko dla wybranego wariantu w zaakceptowanej wycenie
        let badgeHTML = '';
        if (globalState.isQuoteAccepted) {
            // W zaakceptowanej wycenie tylko wybrany wariant ma badge
            if (isSelected) {
                badgeHTML = `<div class="variant-badge selected">Wybrany wariant</div>`;
            }
        } else {
            // W aktywnej wycenie standardowe labele
            const badgeText = isSelected ? 'Wybrany wariant' : 'Wybierz';
            const badgeClass = isSelected ? 'selected' : 'available';
            badgeHTML = `<div class="variant-badge ${badgeClass}">${badgeText}</div>`;
        }

        // NOWE: Wyświetlanie cen jak w modalu szczegółów wyceny
        let priceHTML = '';
        if (hasDiscount && originalPriceBrutto) {
            // Z rabatem - pokazuj oryginalne i końcowe ceny
            const originalTotalBrutto = originalPriceBrutto * quantity;
            const originalTotalNetto = originalPriceNetto * quantity;
            
            priceHTML = `
                <div class="variant-pricing">
                    <div class="pricing-section">
                        <div class="pricing-label">Cena:</div>
                        <div class="pricing-values">
                            <div class="price-original">${utils.formatCurrency(originalPriceBrutto)} brutto</div>
                            <div class="price-original netto">${utils.formatCurrency(originalPriceNetto)} netto</div>
                        </div>
                    </div>
                    <div class="pricing-section">
                        <div class="pricing-label">Po rabacie ${item.discount_percentage}%:</div>
                        <div class="pricing-values">
                            <div class="price-final">${utils.formatCurrency(unitPriceBrutto)} brutto</div>
                            <div class="price-final netto">${utils.formatCurrency(unitPriceNetto)} netto</div>
                        </div>
                    </div>
                    <div class="pricing-section">
                        <div class="pricing-label">Wartość:</div>
                        <div class="pricing-values">
                            <div class="price-final">${utils.formatCurrency(totalPriceBrutto)} brutto</div>
                            <div class="price-final netto">${utils.formatCurrency(totalPriceNetto)} netto</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Bez rabatu - standardowe wyświetlanie
            priceHTML = `
                <div class="variant-pricing">
                    <div class="pricing-section">
                        <div class="pricing-label">Cena:</div>
                        <div class="pricing-values">
                            <div class="price-final">${utils.formatCurrency(unitPriceBrutto)} brutto</div>
                            <div class="price-final netto">${utils.formatCurrency(unitPriceNetto)} netto</div>
                        </div>
                    </div>
                    <div class="pricing-section">
                        <div class="pricing-label">Wartość:</div>
                        <div class="pricing-values">
                            <div class="price-final">${utils.formatCurrency(totalPriceBrutto)} brutto</div>
                            <div class="price-final netto">${utils.formatCurrency(totalPriceNetto)} netto</div>
                        </div>
                    </div>
                </div>
            `;
        }

        // Sprawdzamy czy wariant jest edytowalny
        const isEditable = globalState.isQuoteEditable ? 'true' : 'false';
        const clickHandler = globalState.isQuoteEditable ? `onclick="quote.selectVariant(${item.id}, ${item.product_index})"` : '';

        return `
            <div class="variant-card ${isSelected ? 'selected' : ''}" 
                data-item-id="${item.id}" 
                data-product-index="${item.product_index}"
                data-editable="${isEditable}"
                ${clickHandler}>
                
                <div class="variant-header">
                    <div class="variant-name">${variantName}</div>
                    ${badgeHTML}
                </div>
                
                ${priceHTML}
            </div>
        `;
    },

    /**
     * Wybiera wariant produktu
     * @param {number} itemId - ID wariantu do wybrania
     * @param {number} productIndex - Indeks produktu
     */
    selectVariant: async (itemId, productIndex) => {
        // Sprawdzamy czy wycena jest edytowalna
        if (!globalState.isQuoteEditable) {
            alerts.show('Wycena została już zaakceptowana i nie można jej modyfikować.', 'info');
            return;
        }

        if (globalState.isLoading) return;

        // Sprawdzamy czy wariant jest już wybrany
        if (globalState.selectedVariants.get(productIndex) === itemId) {
            console.log('[Quote] Variant already selected');
            return;
        }

        try {
            console.log(`[Quote] Selecting variant ${itemId} for product ${productIndex}`);

            // Ustawiamy stan loading dla karty wariantu
            const variantCard = document.querySelector(`[data-item-id="${itemId}"]`);
            if (variantCard) {
                variantCard.setAttribute('data-loading', 'true');
            }

            // Wykonujemy żądanie API
            await api.updateVariant(window.QUOTE_TOKEN, itemId);

            // Aktualizujemy lokalny stan
            globalState.selectedVariants.set(productIndex, itemId);

            // Przeładowujemy dane wyceny dla zaktualizowanych cen
            await quote.load();

            console.log('[Quote] Variant changed successfully');
            alerts.show('Wariant został zmieniony', 'success');

        } catch (error) {
            console.error('[Quote] Failed to select variant:', error);
            alerts.show(error.message || 'Nie udało się zmienić wariantu', 'error');

            // Usuwamy stan loading
            const variantCard = document.querySelector(`[data-item-id="${itemId}"]`);
            if (variantCard) {
                variantCard.removeAttribute('data-loading');
            }
        }
    },

    /**
     * Pokazuje odpowiednie sekcje po załadowaniu danych
     */
    showSections: () => {
        // Zawsze pokazujemy sekcję produktów
        const productsSection = utils.getCachedElement('products-section');
        if (productsSection) {
            productsSection.style.display = 'block';
        }

        // Pokazujemy sidebar (desktop) lub mobile panel
        const sidebar = utils.getCachedElement('summary-sidebar');
        const mobilePanel = utils.getCachedElement('mobile-summary-panel');

        if (utils.isMobileView()) {
            // Mobile view
            if (sidebar) sidebar.style.display = 'none';
            if (mobilePanel) mobilePanel.style.display = 'block';
        } else {
            // Desktop view
            if (sidebar) sidebar.style.display = 'block';
            if (mobilePanel) mobilePanel.style.display = 'none';
        }
    },

    /**
     * Obsługuje stan akceptacji wyceny
     */
    handleAcceptanceState: () => {
        const isMobile = utils.isMobileView();

        if (globalState.isQuoteAccepted) {
            // Wycena zaakceptowana - pokazujemy sekcję accepted
            quote.showAcceptedSections(isMobile);
        } else {
            // Wycena edytowalna - pokazujemy formularz akceptacji
            quote.showAcceptanceSections(isMobile);
        }
    },

    /**
     * Pokazuje sekcje po akceptacji wyceny
     * @param {boolean} isMobile - Czy to widok mobilny
     */
    showAcceptedSections: (isMobile) => {
        if (isMobile) {
            const mobileAcceptedSection = utils.getCachedElement('mobile-accepted-section');
            if (mobileAcceptedSection) {
                mobileAcceptedSection.style.display = 'block';
            }

            // Ukrywamy formularz akceptacji
            const mobileAcceptSection = utils.getCachedElement('mobile-accept-section');
            if (mobileAcceptSection) {
                mobileAcceptSection.style.display = 'none';
            }
        } else {
            const sidebarAcceptedSection = utils.getCachedElement('sidebar-accepted-section');
            if (sidebarAcceptedSection) {
                sidebarAcceptedSection.style.display = 'block';
            }

            // Ukrywamy formularz akceptacji w sidebar
            const sidebarAcceptSection = utils.getCachedElement('sidebar-accept-section');
            if (sidebarAcceptSection) {
                sidebarAcceptSection.style.display = 'none';
            }
        }

        // Pokazujemy notatki klienta jeśli istnieją
        quote.showClientNotes();
    },

    /**
     * Pokazuje sekcje z formularzem akceptacji
     * @param {boolean} isMobile - Czy to widok mobilny
     */
    showAcceptanceSections: (isMobile) => {
        if (isMobile) {
            const mobileAcceptSection = utils.getCachedElement('mobile-accept-section');
            if (mobileAcceptSection) {
                mobileAcceptSection.style.display = 'block';
            }

            // Ukrywamy sekcję accepted
            const mobileAcceptedSection = utils.getCachedElement('mobile-accepted-section');
            if (mobileAcceptedSection) {
                mobileAcceptedSection.style.display = 'none';
            }
        } else {
            const sidebarAcceptSection = utils.getCachedElement('sidebar-accept-section');
            if (sidebarAcceptSection) {
                sidebarAcceptSection.style.display = 'block';
            }

            // Ukrywamy sekcję accepted w sidebar
            const sidebarAcceptedSection = utils.getCachedElement('sidebar-accepted-section');
            if (sidebarAcceptedSection) {
                sidebarAcceptedSection.style.display = 'none';
            }
        }
    },

    /**
     * Pokazuje notatki klienta po akceptacji
     */
    showClientNotes: () => {
        const data = globalState.quoteData;
        if (!data || !data.client_comments) return;

        // Desktop - sidebar
        const sidebarClientNotes = utils.getCachedElement('sidebar-client-notes');
        const sidebarClientNotesContent = utils.getCachedElement('sidebar-client-notes-content');

        if (sidebarClientNotes && sidebarClientNotesContent) {
            sidebarClientNotesContent.innerHTML = data.client_comments.replace(/\n/g, '<br>');
            sidebarClientNotes.style.display = 'block';
        }

        // Mobile
        const mobileClientNotes = utils.getCachedElement('mobile-client-notes');
        const mobileClientNotesContent = utils.getCachedElement('mobile-client-notes-content');

        if (mobileClientNotes && mobileClientNotesContent) {
            mobileClientNotesContent.innerHTML = data.client_comments.replace(/\n/g, '<br>');
            mobileClientNotes.style.display = 'block';
        }
    },

    /**
     * Obsługuje błędy ładowania wyceny
     * @param {Error} error - Błąd do obsłużenia
     */
    handleError: (error) => {
        console.error('[Quote] Error:', error);

        let message = 'Wystąpił błąd podczas ładowania wyceny';
        let type = 'error';

        if (error.message) {
            if (error.message.includes('not_found')) {
                message = 'Wycena nie została znaleziona';
            } else if (error.message.includes('already_accepted')) {
                message = 'Ta wycena została już zaakceptowana';
                type = 'info';
            } else if (error.message.includes('expired')) {
                message = 'Link do wyceny wygasł';
            } else {
                message = error.message;
            }
        }

        alerts.show(message, type, 0); // Nie ukrywaj automatycznie błędów
    }
};

// ===================================
// UTILITY FUNCTIONS
const utils = {
    formatCurrency: (amount) => {
        if (amount == null) return "0.00 PLN";
        return `${parseFloat(amount).toFixed(2)} PLN`;
    },
    formatDate: (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('pl-PL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    },
    formatShortDate: (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('pl-PL');
    },
    translateVariantCode: (code) => {
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
    },
    isValidEmail: (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },
    isValidPhone: (phone) => {
        const phoneRegex = /^[0-9+\s\-()]{7,}$/;
        return phoneRegex.test(phone.trim());
    },
    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    isMobileView: () => window.innerWidth <= 1024,
    getCachedElement: (id) => {
        if (globalState.cachedElements.has(id)) {
            return globalState.cachedElements.get(id);
        }
        const element = document.getElementById(id);
        if (element) {
            globalState.cachedElements.set(id, element);
        }
        return element;
    },
    setLoading: (loading) => {
        globalState.isLoading = loading;
        const overlay = utils.getCachedElement('loading-overlay');
        if (overlay) {
            if (loading) overlay.classList.remove('hide');
            else overlay.classList.add('hide');
        }
    }
};

// ===================================
// ALERT SYSTEM
const alerts = {
    show: (message, type = 'info', duration = 5000) => {
        const container = utils.getCachedElement('alert-container');
        if (!container) return;
        console.log(`[Alert] ${type.toUpperCase()}: ${message}`);
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        const icon = alerts.getIcon(type);
        alert.innerHTML = `
            ${icon}
            <div class="alert-content"><p>${message}</p></div>
            <button class="alert-close" aria-label="Zamknij alert">
                <svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0
                          111.414 1.414L11.414 10l4.293 4.293a1 1 0
                          01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0
                          01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clip-rule="evenodd"/>
                </svg>
            </button>
        `;
        const closeBtn = alert.querySelector('.alert-close');
        closeBtn.addEventListener('click', () => alerts.hide(alert));
        container.appendChild(alert);
        if (duration > 0) {
            setTimeout(() => alerts.hide(alert), duration);
        }
        return alert;
    },
    hide: (alertElement) => {
        if (alertElement && alertElement.parentNode) {
            alertElement.style.opacity = '0';
            alertElement.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                if (alertElement.parentNode) {
                    alertElement.parentNode.removeChild(alertElement);
                }
            }, 300);
        }
    },
    clear: () => {
        const container = utils.getCachedElement('alert-container');
        if (container) container.innerHTML = '';
    },
    getIcon: (type) => {
        const icons = {
            success: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0
                                00-1.414-1.414L9 10.586 7.707 9.293a1 1 0
                                00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                clip-rule="evenodd"/>
                      </svg>`,
            error: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd"
                                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1
                                0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0
                                102 0V6a1 1 0 00-1-1z"
                                clip-rule="evenodd"/>
                      </svg>`,
            warning: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486
                                0l5.58 9.92c.75 1.334-.213 2.98-1.742
                                2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11
                                13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0
                                00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clip-rule="evenodd"/>
                      </svg>`,
            info: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd"
                                d="M18 10a8 8 0 11-16 0 8 8 0 0116
                                0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9
                                9a1 1 0 000 2v3a1 1 0 001 1h1a1
                                1 0 100-2v-3a1 1 0 00-1-1H9z"
                                clip-rule="evenodd"/>
                      </svg>`
        };
        return icons[type] || icons.info;
    }
};


// ===================================
// API COMMUNICATION
// Komunikacja z backendem
// ===================================

/**
 * API module - obsługuje komunikację z serwerem
 * Wszystkie żądania HTTP przechodzą przez ten moduł
 */
const api = {
    /**
     * Bazowa funkcja do wykonywania żądań API
     * @param {string} url - URL endpointu
     * @param {Object} options - Opcje żądania (method, body, etc.)
     * @returns {Promise} Promise z odpowiedzią API
     */
    call: async (url, options = {}) => {
        try {
            console.log(`[API] ${options.method || 'GET'} ${url}`);

            const defaultOptions = {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            };

            const response = await fetch(url, { ...defaultOptions, ...options });

            // Próbujemy sparsować JSON, ale obsługujemy też inne formaty
            let data;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = await response.text();
            }

            if (!response.ok) {
                console.error(`[API] Error ${response.status}:`, data);
                const errorMessage = typeof data === 'object' && data.message
                    ? data.message
                    : `Błąd serwera (${response.status})`;
                throw new Error(errorMessage);
            }

            console.log(`[API] Success:`, data);
            return data;
        } catch (error) {
            console.error(`[API] Request failed:`, error);
            throw error;
        }
    },

    /**
     * Pobiera dane wyceny dla klienta
     * @param {string} token - Token publiczny wyceny
     * @returns {Promise} Dane wyceny
     */
    getQuoteData: async (token) => {
        return api.call(`/quotes/api/client/quote/${token}`);
    },

    /**
     * Aktualizuje wybór wariantu (tylko item_id, bez walidacji email/telefon)
     * @param {string} token - Token publiczny wyceny
     * @param {number} itemId - ID pozycji do wybrania
     * @returns {Promise} Odpowiedź serwera
     */
    updateVariant: async (token, itemId) => {
        return api.call(`/quotes/api/client/quote/${token}/update-variant`, {
            method: 'PATCH',
            body: JSON.stringify({
                item_id: itemId
            })
        });
    },

    /**
     * Akceptuje wycenę przez klienta
     * @param {string} token - Token publiczny wyceny
     * @param {string} emailOrPhone - Email lub telefon do weryfikacji
     * @param {string} comments - Komentarze klienta (opcjonalne)
     * @returns {Promise} Odpowiedź serwera
     */
    acceptQuote: async (token, emailOrPhone, comments = '') => {
        return api.call(`/quotes/api/client/quote/${token}/accept`, {
            method: 'POST',
            body: JSON.stringify({
                email_or_phone: emailOrPhone,
                comments: comments
            })
        });
    }
};


// ===================================
// FORM HANDLING (teraz korzysta z utils i alerts)
const form = {
    init: () => {
        console.log('[Form] Initializing forms');
        form.initDesktopForm();
        form.initMobileForm();
    },
    initDesktopForm: () => {
        const desktopForm = utils.getCachedElement('sidebar-acceptance-form');
        const emailInput = utils.getCachedElement('sidebar-email-phone');
        const commentsInput = utils.getCachedElement('sidebar-comments');
        if (desktopForm) {
            desktopForm.addEventListener('submit', form.handleDesktopSubmit);
        }
        if (emailInput) {
            emailInput.addEventListener('input', utils.debounce(() => form.validateEmailPhone('sidebar'), 300));
            emailInput.addEventListener('blur', () => form.validateEmailPhone('sidebar'));
        }
        if (commentsInput) {
            form.setupCharacterCounter('sidebar');
        }
    },
    initMobileForm: () => {
        const mobileForm = utils.getCachedElement('mobile-acceptance-form');
        const emailInput = utils.getCachedElement('mobile-email-phone');
        const commentsInput = utils.getCachedElement('mobile-comments');
        if (mobileForm) {
            mobileForm.addEventListener('submit', form.handleMobileSubmit);
        }
        if (emailInput) {
            emailInput.addEventListener('input', utils.debounce(() => form.validateEmailPhone('mobile'), 300));
            emailInput.addEventListener('blur', () => form.validateEmailPhone('mobile'));
        }
        if (commentsInput) {
            form.setupCharacterCounter('mobile');
        }
    },
    handleDesktopSubmit: async (event) => {
        event.preventDefault();
        await form.handleSubmit('sidebar');
    },
    handleMobileSubmit: async (event) => {
        event.preventDefault();
        await form.handleSubmit('mobile');
    },
    handleSubmit: async (prefix) => {
        if (globalState.isLoading) return;
        console.log(`[Form] Submitting ${prefix} acceptance form`);
        if (!form.validate(prefix)) return;
        try {
            form.setSubmitting(prefix, true);
            alerts.clear();
            const emailOrPhone = utils.getCachedElement(`${prefix}-email-phone`).value.trim();
            const comments = utils.getCachedElement(`${prefix}-comments`)?.value?.trim() || '';
            await api.acceptQuote(window.QUOTE_TOKEN, emailOrPhone, comments);
            console.log('[Form] Quote accepted successfully');
            await quote.load();
            alerts.show('Dziękujemy! Wycena została zaakceptowana i przekazana do realizacji.', 'success');
        } catch (error) {
            console.error('[Form] Acceptance failed:', error);
            alerts.show(error.message || 'Nie udało się zaakceptować wyceny', 'error');
        } finally {
            form.setSubmitting(prefix, false);
        }
    },
    validate: (prefix) => {
        let isValid = true;
        if (!form.validateEmailPhone(prefix)) isValid = false;
        return isValid;
    },
    validateEmailPhone: (prefix) => {
        const input = utils.getCachedElement(`${prefix}-email-phone`);
        const errorElement = utils.getCachedElement(`${prefix}-email-phone-error`);
        if (!input) return true;
        const value = input.value.trim();
        input.classList.remove('error');
        if (errorElement) errorElement.classList.remove('show');
        if (!value) {
            form.showFieldError(prefix, 'email-phone', 'To pole jest wymagane');
            return false;
        }
        const isEmail = value.includes('@');
        if (isEmail) {
            if (!utils.isValidEmail(value)) {
                form.showFieldError(prefix, 'email-phone', 'Wprowadź prawidłowy adres email');
                return false;
            }
        } else {
            if (!utils.isValidPhone(value)) {
                form.showFieldError(prefix, 'email-phone', 'Wprowadź prawidłowy numer telefonu');
                return false;
            }
        }
        return true;
    },
    showFieldError: (prefix, fieldName, message) => {
        const field = utils.getCachedElement(`${prefix}-${fieldName}`);
        const errorElement = utils.getCachedElement(`${prefix}-${fieldName}-error`);
        if (field) field.classList.add('error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
    },
    setSubmitting: (prefix, submitting) => {
        const btn = utils.getCachedElement(`${prefix}-accept-btn`);
        if (!btn) return;
        btn.disabled = submitting;
        const btnText = btn.querySelector('.btn-text');
        const btnLoading = btn.querySelector('.btn-loading');
        if (btnText && btnLoading) {
            if (submitting) {
                btnText.style.display = 'none';
                btnLoading.style.display = 'flex';
            } else {
                btnText.style.display = 'inline';
                btnLoading.style.display = 'none';
            }
        }
    },
    setupCharacterCounter: (prefix) => {
        const textarea = utils.getCachedElement(`${prefix}-comments`);
        const counter = utils.getCachedElement(`${prefix}-char-count`);
        if (!textarea || !counter) return;
        const maxLength = 500;
        textarea.setAttribute('maxlength', maxLength);
        textarea.addEventListener('input', () => {
            const count = textarea.value.length;
            counter.textContent = count;
            const counterElement = counter.parentElement;
            if (counterElement) {
                counterElement.classList.toggle('near-limit', count > maxLength * 0.9);
            }
        });
    }
};

// ===================================
// MOBILE PANEL MANAGEMENT
const mobilePanel = {
    init: () => {
        const panel = utils.getCachedElement('mobile-summary-panel');
        const toggleBtn = utils.getCachedElement('panel-expand-btn');
        if (!panel || !toggleBtn) return;
        toggleBtn.addEventListener('click', mobilePanel.toggle);
        console.log('[MobilePanel] Initialized');
    },
    toggle: () => {
        const panel = utils.getCachedElement('mobile-summary-panel');
        if (!panel) return;
        globalState.isMobilePanelExpanded = !globalState.isMobilePanelExpanded;
        if (globalState.isMobilePanelExpanded) panel.classList.add('expanded');
        else panel.classList.remove('expanded');
        console.log('[MobilePanel] Toggled:', globalState.isMobilePanelExpanded);
    }
};

// ===================================
// PDF FUNCTIONALITY
const pdf = {
    init: () => {
        const desktopBtn = utils.getCachedElement('download-pdf-btn');
        if (desktopBtn) desktopBtn.addEventListener('click', () => pdf.download('pdf'));
        const mobileBtn = utils.getCachedElement('mobile-download-pdf-btn');
        if (mobileBtn) mobileBtn.addEventListener('click', () => pdf.download('pdf'));
        const sidebarFinalBtn = utils.getCachedElement('sidebar-download-final-pdf');
        if (sidebarFinalBtn) sidebarFinalBtn.addEventListener('click', () => pdf.download('pdf'));
        const mobileFinalBtn = utils.getCachedElement('mobile-download-final-pdf');
        if (mobileFinalBtn) mobileFinalBtn.addEventListener('click', () => pdf.download('pdf'));
        console.log('[PDF] Initialized with token-based security');
    },
    download: (format = 'pdf') => {
        if (!globalState.quoteData) {
            alerts.show('Brak danych wyceny do pobrania', 'error');
            return;
        }
        
        // ZMIANA: Użyj tokenu zamiast ID wyceny
        const token = globalState.quoteData.public_token || window.QUOTE_TOKEN;
        if (!token) {
            console.error('[PDF] Brak tokenu do pobierania PDF');
            alerts.show('Błąd: brak tokenu zabezpieczającego', 'error');
            return;
        }
        
        console.log(`[PDF] Downloading ${format} with token: ${token}`);
        // ZMIANA: Nowy URL z tokenem
        const url = `/quotes/api/quotes/${token}/pdf.${format}`;
        window.open(url, '_blank');
    }
};

// ===================================
// RESPONSIVE BEHAVIOR
const responsive = {
    init: () => {
        responsive.handleResize();
        window.addEventListener('resize', utils.debounce(responsive.handleResize, 250));
        console.log('[Responsive] Initialized');
    },
    handleResize: () => {
        const wasMobile = globalState.isMobileView;
        globalState.isMobileView = utils.isMobileView();
        if (wasMobile !== globalState.isMobileView) {
            console.log('[Responsive] View changed to:', globalState.isMobileView ? 'mobile' : 'desktop');
            responsive.toggleViewElements();
            if (globalState.quoteData) {
                quote.handleAcceptanceState();
            }
        }
    },
    toggleViewElements: () => {
        const sidebar = utils.getCachedElement('summary-sidebar');
        const mobilePanelEl = utils.getCachedElement('mobile-summary-panel');
        if (globalState.isMobileView) {
            if (sidebar) sidebar.style.display = 'none';
            if (mobilePanelEl) mobilePanelEl.style.display = 'block';
        } else {
            if (sidebar) sidebar.style.display = 'block';
            if (mobilePanelEl) mobilePanelEl.style.display = 'none';
            if (globalState.isMobilePanelExpanded) {
                mobilePanelEl?.classList.remove('expanded');
                globalState.isMobilePanelExpanded = false;
            }
        }
    }
};

// ===================================
// APPLICATION INITIALIZATION
const initializeApp = async () => {
    console.log('[ClientQuote] Initializing application...');
    try {
        responsive.init();
        mobilePanel.init();
        pdf.init();
        form.init();
        await quote.load();
        console.log('[ClientQuote] Application initialized successfully');
    } catch (error) {
        console.error('[ClientQuote] Application initialization failed:', error);
        alerts.show('Wystąpił błąd podczas inicjalizacji aplikacji', 'error');
    }
};

document.addEventListener('DOMContentLoaded', initializeApp);
window.addEventListener('error', (event) => {
    console.error('[ClientQuote] Global error:', event.error);
});
window.addEventListener('unhandledrejection', (event) => {
    console.error('[ClientQuote] Unhandled promise rejection:', event.reason);
});

// ===================================
// EVENT LISTENERS & DOM READY
// Nasłuchiwanie eventów i inicjalizacja po załadowaniu DOM
// ===================================

/**
 * Inicjalizacja po załadowaniu DOM
 */
document.addEventListener('DOMContentLoaded', initializeApp);

/**
 * Obsługa błędów JavaScript
 */
window.addEventListener('error', (event) => {
    console.error('[ClientQuote] Global error:', event.error);
    // Nie pokazujemy alertu dla każdego błędu JS, tylko logujemy
});

/**
 * Obsługa niezłapanych Promise rejection
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('[ClientQuote] Unhandled promise rejection:', event.reason);
    // Nie pokazujemy alertu dla każdego błędu Promise, tylko logujemy
});

// ===================================
// GLOBAL FUNCTIONS
// Funkcje globalne dostępne z HTML
// ===================================

/**
 * Globalna funkcja do wyboru wariantu - wywoływana z HTML
 * @param {number} itemId - ID wariantu
 * @param {number} productIndex - Indeks produktu
 */
window.selectVariant = (itemId, productIndex) => {
    quote.selectVariant(itemId, productIndex);
};

// ===================================
// DEBUG HELPERS
// Pomocne funkcje do debugowania (tylko w development)
// ===================================

if (typeof window !== 'undefined') {
    // Dodajemy debug helpers do window dla łatwiejszego debugowania
    window.ClientQuoteDebug = {
        globalState,
        utils,
        alerts,
        api,
        quote,
        form,
        dataSync,
        
        // Funkcje pomocnicze
        reloadQuote: () => quote.load(),
        showTestAlert: (message, type) => alerts.show(message, type),
        clearAlerts: () => alerts.clear(),
        toggleMobileView: () => {
            globalState.isMobileView = !globalState.isMobileView;
            responsive.handleResize();
        }
    };
    
    console.log('[ClientQuote] Debug helpers available at window.ClientQuoteDebug');
}

console.log("=== CLIENT QUOTE PDF SECURITY UPDATE ===");
console.log("✅ PDF download now uses tokens instead of quote IDs");
console.log("✅ Token automatically retrieved from quote data or window.QUOTE_TOKEN");
console.log("✅ Enhanced security for client-side PDF access");
console.log("🔒 URL format changed: /quotes/api/quotes/{token}/pdf.{format}");

// SPRAWDZENIE TOKENU PRZY INICJALIZACJI
document.addEventListener('DOMContentLoaded', () => {
    const token = window.QUOTE_TOKEN;
    if (!token) {
        console.error('❌ BRAK TOKENU: window.QUOTE_TOKEN nie jest zdefiniowany!');
        alerts.show('Błąd bezpieczeństwa: brak tokenu dostępu', 'error');
    } else {
        console.log('✅ Token zabezpieczający załadowany:', token.substring(0, 8) + '...');
    }
});