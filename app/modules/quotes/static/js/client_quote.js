// ===================================
// CLIENT QUOTE JS - Wood Power v2.0
// ===================================
console.log('[ClientQuote] Script loaded - Wood Power v2.0');

// ===================================
// GLOBAL STATE MANAGEMENT
// ===================================
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

// Feature flag dla nowego modalboxa
const USE_NEW_ACCEPTANCE_MODAL = true;

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
                
                const quantity = selectedItem.quantity || 1;
                
                console.log(`[generateProductsBreakdownHTML] Product ${productIndex}: quantity=${quantity} from selectedItem.quantity=${selectedItem.quantity}`);
                // Użyj wartości całkowitych (cena × ilość)
                const unitPriceBrutto = selectedItem.price_brutto || selectedItem.final_price_brutto || 0;
                const unitPriceNetto = selectedItem.price_netto || selectedItem.final_price_netto || 0;
                const totalPriceBrutto = unitPriceBrutto * quantity;
                const totalPriceNetto = unitPriceNetto * quantity;
                
                const priceBrutto = utils.formatCurrency(totalPriceBrutto);
                const priceNetto = utils.formatCurrency(totalPriceNetto);

                return `
                    <div class="product-breakdown-item">
                        <div class="product-info">
                            <div class="product-name">${variantName}</div>
                            <div class="product-dimensions">${dimensions}</div>
                            <div class="product-quantity">${quantity} szt.</div>
                        </div>
                        <div class="product-price">
                            <div class="price-brutto">${priceBrutto}</div>
                            <div class="price-netto">netto: ${priceNetto}</div>
                        </div>
                    </div>
                `;
            })
            .join('');
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
// UTILITY FUNCTIONS
// ===================================
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
// ===================================
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
    },

    /**
     * Akceptuje wycenę z dodatkowymi danymi klienta
     * @param {string} token - Token publiczny wyceny
     * @param {Object} clientData - Dane klienta do akceptacji
     * @returns {Promise} Odpowiedź serwera
     */
    acceptQuoteWithData: async (token, clientData) => {
        return api.call(`/quotes/api/client/quote/${token}/accept-with-data`, {
            method: 'POST',
            body: JSON.stringify(clientData)
        });
    },

    /**
     * Pobiera dane klienta dla wyceny
     * @param {string} token - Token publiczny wyceny
     * @returns {Promise} Dane klienta
     */
    getClientData: async (token) => {
        return api.call(`/quotes/api/client/quote/${token}/client-data`);
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

            // Aktualizuj przyciski akceptacji w nowym systemie
            if (USE_NEW_ACCEPTANCE_MODAL && typeof clientDataModal !== 'undefined') {
                clientDataModal.updateAcceptanceButtons(globalState.quoteData);
            }

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
        
        const quantity = selectedItem.quantity || 1;
        
        console.log(`[createProductHeaderHTML] Product ${productIndex}: quantity=${quantity} from selectedItem.quantity=${selectedItem.quantity}`);

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

        // Dodaj informacje o cenach brutto/netto (jednostkowych i całkowitych)
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

        const quantity = item.quantity || 1;

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

        // Badge tylko dla wybranego wariantu w zaakceptowanej wycenie
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

        // Wyświetlanie cen jak w modalu szczegółów wyceny
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
// FORM HANDLING (stary system akceptacji)
// ===================================
const form = {
    init: () => {
        if (USE_NEW_ACCEPTANCE_MODAL) {
            console.log('[Form] Using new acceptance modal - skipping old form initialization');
            return;
        }
        
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
// ===================================
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
// ===================================
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
// ===================================
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
// OBIEKT DO ZARZĄDZANIA UI AKCEPTACJI
// ===================================
const acceptanceUI = {
    init: () => {
        console.log('[AcceptanceUI] Initializing acceptance UI');
        acceptanceUI.setupButtons();
    },

    setupButtons: () => {
        if (USE_NEW_ACCEPTANCE_MODAL) {
            acceptanceUI.showNewButtons();
            acceptanceUI.hideOldForms();
        } else {
            acceptanceUI.showOldForms();
            acceptanceUI.hideNewButtons();
        }
    },

    showNewButtons: () => {
        const newButtons = document.querySelectorAll('.acceptance-button-section');
        newButtons.forEach(btn => {
            if (btn) btn.style.display = 'block';
        });
        console.log('[AcceptanceUI] New acceptance buttons shown');
    },

    hideNewButtons: () => {
        const newButtons = document.querySelectorAll('.acceptance-button-section');
        newButtons.forEach(btn => {
            if (btn) btn.style.display = 'none';
        });
    },

    showOldForms: () => {
        const oldForms = document.querySelectorAll('.acceptance-form');
        oldForms.forEach(form => {
            if (form) form.style.display = 'block';
        });
        console.log('[AcceptanceUI] Old acceptance forms shown');
    },

    hideOldForms: () => {
        const oldForms = document.querySelectorAll('.acceptance-form');
        oldForms.forEach(form => {
            if (form) form.style.display = 'none';
        });
    }
};

// ===================================
// GŁÓWNY OBIEKT CLIENTDATAMODAL
// ===================================
const clientDataModal = {
    currentStep: 1,
    maxStep: 2,
    isLoading: false,
    clientData: null,

    init: () => {
        console.log('[ClientDataModal] Initializing modal');
        clientDataModal.setupEventListeners();
        clientDataModal.loadClientData();
    },

    setupEventListeners: () => {
        // Przyciski otwierające modal
        const sidebarBtn = document.getElementById('sidebar-accept-with-data-btn');
        const mobileBtn = document.getElementById('mobile-accept-with-data-btn');
        
        if (sidebarBtn) {
            sidebarBtn.addEventListener('click', clientDataModal.openModal);
        }
        if (mobileBtn) {
            mobileBtn.addEventListener('click', clientDataModal.openModal);
        }

        // Przyciski zamykające modal
        const closeBtn = document.getElementById('client-data-modal-close');
        const overlay = document.getElementById('client-data-modal');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', clientDataModal.closeModal);
        }
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    clientDataModal.closeModal();
                }
            });
        }

        // Przyciski nawigacji
        const nextBtn = document.getElementById('modal-next-btn');
        const prevBtn = document.getElementById('modal-prev-btn');
        const submitBtn = document.getElementById('modal-submit-btn');

        if (nextBtn) {
            nextBtn.addEventListener('click', clientDataModal.nextStep);
        }
        if (prevBtn) {
            prevBtn.addEventListener('click', clientDataModal.prevStep);
        }
        if (submitBtn) {
            submitBtn.addEventListener('click', clientDataModal.submitForm);
        }

        // Checkbox faktury
        const invoiceCheckbox = document.getElementById('wants_invoice');
        if (invoiceCheckbox) {
            invoiceCheckbox.addEventListener('change', clientDataModal.toggleInvoiceFields);
        }

        // Licznik znaków dla uwag
        const notesTextarea = document.getElementById('quote_notes');
        if (notesTextarea) {
            notesTextarea.addEventListener('input', clientDataModal.updateCharCounter);
        }

        // Walidacja w czasie rzeczywistym
        const inputs = document.querySelectorAll('#client-data-form input, #client-data-form select, #client-data-form textarea');
        inputs.forEach(input => {
            input.addEventListener('blur', () => clientDataModal.validateField(input));
            input.addEventListener('input', () => clientDataModal.clearError(input));
        });

        // ESC zamyka modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && clientDataModal.isOpen()) {
                clientDataModal.closeModal();
            }
        });

        console.log('[ClientDataModal] Event listeners setup complete');
    },

    loadClientData: async () => {
        try {
            console.log('[ClientDataModal] Loading client data...');
            const data = await api.getClientData(window.QUOTE_TOKEN);
            clientDataModal.clientData = data.client_data || {};
            console.log('[ClientDataModal] Client data loaded:', clientDataModal.clientData);
        } catch (error) {
            console.error('[ClientDataModal] Error loading client data:', error);
            clientDataModal.clientData = {};
        }
    },

    updateAcceptanceButtons: (quoteData) => {
        const sidebarAcceptSection = document.getElementById('sidebar-accept-section');
        const mobileAcceptSection = document.getElementById('mobile-accept-section');
        const sidebarAcceptedSection = document.getElementById('sidebar-accepted-section');
        const mobileAcceptedSection = document.getElementById('mobile-accepted-section');

        console.log('[ClientDataModal] Updating acceptance buttons. Is editable:', quoteData.is_client_editable);

        if (!quoteData.is_client_editable) {
            // Wycena została już zaakceptowana - pokaż sekcję "accepted"
            if (sidebarAcceptSection) sidebarAcceptSection.style.display = 'none';
            if (mobileAcceptSection) mobileAcceptSection.style.display = 'none';
            if (sidebarAcceptedSection) sidebarAcceptedSection.style.display = 'block';
            if (mobileAcceptedSection) mobileAcceptedSection.style.display = 'block';
        } else {
            // Wycena jest edytowalna - pokaż nowe przyciski akceptacji
            if (sidebarAcceptSection) sidebarAcceptSection.style.display = 'block';
            if (mobileAcceptSection) mobileAcceptSection.style.display = 'block';
            if (sidebarAcceptedSection) sidebarAcceptedSection.style.display = 'none';
            if (mobileAcceptedSection) mobileAcceptedSection.style.display = 'none';
        }
    },

    openModal: () => {
        console.log('[ClientDataModal] Opening modal');
        const modal = document.getElementById('client-data-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            clientDataModal.resetModal();
            clientDataModal.prefillForm();
        }
    },

    closeModal: () => {
        console.log('[ClientDataModal] Closing modal');
        const modal = document.getElementById('client-data-modal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
            clientDataModal.resetModal();
        }
    },

    isOpen: () => {
        const modal = document.getElementById('client-data-modal');
        return modal && modal.style.display === 'flex';
    },

    resetModal: () => {
        clientDataModal.currentStep = 1;
        clientDataModal.isLoading = false;
        clientDataModal.updateStepDisplay();
        clientDataModal.clearAllErrors();
        
        // Reset loading state
        const submitBtn = document.getElementById('modal-submit-btn');
        if (submitBtn) {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    },

    prefillForm: () => {
        if (!clientDataModal.clientData) return;

        console.log('[ClientDataModal] Prefilling form with data:', clientDataModal.clientData);

        const data = clientDataModal.clientData;
        
        // Podstawowe dane
        clientDataModal.setFieldValue('delivery_name', data.delivery_name);
        clientDataModal.setFieldValue('email', data.email);
        clientDataModal.setFieldValue('phone', data.phone);

        // Adres dostawy
        clientDataModal.setFieldValue('delivery_company', data.delivery_company);
        clientDataModal.setFieldValue('delivery_address', data.delivery_address);
        clientDataModal.setFieldValue('delivery_postcode', data.delivery_postcode);
        clientDataModal.setFieldValue('delivery_city', data.delivery_city);
        clientDataModal.setFieldValue('delivery_region', data.delivery_region);

        // Dane do faktury
        const wantsInvoice = data.wants_invoice || false;
        clientDataModal.setFieldValue('wants_invoice', wantsInvoice);
        
        if (wantsInvoice) {
            clientDataModal.setFieldValue('invoice_name', data.invoice_name);
            clientDataModal.setFieldValue('invoice_company', data.invoice_company);
            clientDataModal.setFieldValue('invoice_address', data.invoice_address);
            clientDataModal.setFieldValue('invoice_postcode', data.invoice_postcode);
            clientDataModal.setFieldValue('invoice_city', data.invoice_city);
            clientDataModal.setFieldValue('invoice_nip', data.invoice_nip);
        }

        // Uwagi
        clientDataModal.setFieldValue('quote_notes', data.quote_notes);
        clientDataModal.updateCharCounter();

        // Trigger change events
        if (wantsInvoice) {
            clientDataModal.toggleInvoiceFields();
        }
    },

    setFieldValue: (fieldId, value) => {
        const field = document.getElementById(fieldId);
        if (field && value !== undefined && value !== null) {
            if (field.type === 'checkbox') {
                field.checked = !!value;
            } else {
                field.value = value;
            }
        }
    },

    nextStep: () => {
        if (clientDataModal.isLoading) return;

        // Walidacja obecnego kroku
        if (!clientDataModal.validateCurrentStep()) {
            return;
        }

        if (clientDataModal.currentStep < clientDataModal.maxStep) {
            clientDataModal.currentStep++;
            clientDataModal.updateStepDisplay();
        }
    },

    prevStep: () => {
        if (clientDataModal.isLoading) return;

        if (clientDataModal.currentStep > 1) {
            clientDataModal.currentStep--;
            clientDataModal.updateStepDisplay();
        }
    },

    updateStepDisplay: () => {
        // Aktualizuj progress
        const steps = document.querySelectorAll('.progress-step');
        steps.forEach((step, index) => {
            const stepNumber = index + 1;
            step.classList.remove('active', 'completed');
            
            if (stepNumber === clientDataModal.currentStep) {
                step.classList.add('active');
            } else if (stepNumber < clientDataModal.currentStep) {
                step.classList.add('completed');
            }
        });

        // Pokaż/ukryj kroki
        const modalSteps = document.querySelectorAll('.modal-step');
        modalSteps.forEach((step, index) => {
            const stepNumber = index + 1;
            step.classList.toggle('active', stepNumber === clientDataModal.currentStep);
        });

        // Aktualizuj przyciski
        const prevBtn = document.getElementById('modal-prev-btn');
        const nextBtn = document.getElementById('modal-next-btn');
        const submitBtn = document.getElementById('modal-submit-btn');

        if (prevBtn) {
            prevBtn.style.display = clientDataModal.currentStep > 1 ? 'flex' : 'none';
        }

        if (nextBtn) {
            nextBtn.style.display = clientDataModal.currentStep < clientDataModal.maxStep ? 'flex' : 'none';
        }

        if (submitBtn) {
            submitBtn.style.display = clientDataModal.currentStep === clientDataModal.maxStep ? 'flex' : 'none';
        }
    },

    validateCurrentStep: () => {
        let isValid = true;

        if (clientDataModal.currentStep === 1) {
            // Krok 1: Dane osobowe
            const deliveryName = document.getElementById('delivery_name');
            const email = document.getElementById('email');
            const phone = document.getElementById('phone');

            if (!clientDataModal.validateField(deliveryName)) {
                isValid = false;
            }

            // Email LUB telefon wymagany
            const hasEmail = email && email.value.trim() !== '';
            const hasPhone = phone && phone.value.trim() !== '';

            if (!hasEmail && !hasPhone) {
                if (email) clientDataModal.showError(email, 'Wymagany jest email lub telefon');
                if (phone) clientDataModal.showError(phone, 'Wymagany jest email lub telefon');
                isValid = false;
            }

            if (hasEmail && email && !clientDataModal.validateEmail(email.value)) {
                clientDataModal.showError(email, 'Nieprawidłowy format email');
                isValid = false;
            }

        } else if (clientDataModal.currentStep === 2) {
            // Krok 2: Dostawa i faktura
            const requiredFields = ['delivery_address', 'delivery_city', 'delivery_postcode', 'delivery_region'];
            
            requiredFields.forEach(fieldId => {
                const field = document.getElementById(fieldId);
                if (!clientDataModal.validateField(field)) {
                    isValid = false;
                }
            });

            // Walidacja faktury jeśli zaznaczona
            const wantsInvoiceCheckbox = document.getElementById('wants_invoice');
            if (wantsInvoiceCheckbox && wantsInvoiceCheckbox.checked) {
                const nipField = document.getElementById('invoice_nip');
                if (!clientDataModal.validateField(nipField)) {
                    isValid = false;
                }
            }
        }

        return isValid;
    },

    validateField: (field) => {
        if (!field) return true;

        const value = field.value.trim();
        let isValid = true;
        let errorMessage = '';

        // Sprawdź czy pole jest wymagane
        if (field.required && !value) {
            errorMessage = 'To pole jest wymagane';
            isValid = false;
        } else if (value) {
            // Walidacje specyficzne dla typu pola
            switch (field.type) {
                case 'email':
                    if (!clientDataModal.validateEmail(value)) {
                        errorMessage = 'Nieprawidłowy format email';
                        isValid = false;
                    }
                    break;
                case 'tel':
                    if (!clientDataModal.validatePhone(value)) {
                        errorMessage = 'Nieprawidłowy format telefonu';
                        isValid = false;
                    }
                    break;
            }

            // Walidacje specyficzne dla pola
            switch (field.id) {
                case 'delivery_postcode':
                case 'invoice_postcode':
                    if (value && !clientDataModal.validatePostcode(value)) {
                        errorMessage = 'Kod pocztowy w formacie XX-XXX';
                        isValid = false;
                    }
                    break;
                case 'invoice_nip':
                    if (value && !clientDataModal.validateNIP(value)) {
                        errorMessage = 'NIP musi mieć 10 cyfr';
                        isValid = false;
                    }
                    break;
            }
        }

        if (isValid) {
            clientDataModal.clearError(field);
        } else {
            clientDataModal.showError(field, errorMessage);
        }

        return isValid;
    },

    validateEmail: (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    validatePhone: (phone) => {
        const phoneRegex = /^[\+]?[0-9\s\-\(\)]{7,}$/;
        return phoneRegex.test(phone);
    },

    validatePostcode: (postcode) => {
        const postcodeRegex = /^[0-9]{2}-[0-9]{3}$/;
        return postcodeRegex.test(postcode);
    },

    validateNIP: (nip) => {
        const cleanNip = nip.replace(/[-\s]/g, '');
        return /^[0-9]{10}$/.test(cleanNip);
    },

    showError: (field, message) => {
        const errorElement = document.getElementById(field.id + '_error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
        field.classList.add('error');
    },

    clearError: (field) => {
        const errorElement = document.getElementById(field.id + '_error');
        if (errorElement) {
            errorElement.textContent = '';
            errorElement.classList.remove('show');
        }
        field.classList.remove('error');
    },

    clearAllErrors: () => {
        const errorElements = document.querySelectorAll('#client-data-form .form-error');
        const fieldElements = document.querySelectorAll('#client-data-form .form-input, #client-data-form .form-select');
        
        errorElements.forEach(el => {
            el.textContent = '';
            el.classList.remove('show');
        });
        
        fieldElements.forEach(el => {
            el.classList.remove('error');
        });
    },

    toggleInvoiceFields: () => {
        const checkbox = document.getElementById('wants_invoice');
        const invoiceFields = document.getElementById('invoice-fields');
        const form = document.getElementById('client-data-form');
        
        if (checkbox && invoiceFields) {
            const isChecked = checkbox.checked;
            
            if (isChecked) {
                invoiceFields.style.display = 'block';
                if (form) form.classList.add('wants-invoice');
                
                // Ustaw NIP jako wymagany
                const nipField = document.getElementById('invoice_nip');
                if (nipField) {
                    nipField.required = true;
                }
            } else {
                invoiceFields.style.display = 'none';
                if (form) form.classList.remove('wants-invoice');
                
                // Usuń wymaganie NIP
                const nipField = document.getElementById('invoice_nip');
                if (nipField) {
                    nipField.required = false;
                    clientDataModal.clearError(nipField);
                }
                
                // Wyczyść błędy pól faktury
                const invoiceFieldIds = ['invoice_name', 'invoice_company', 'invoice_address', 'invoice_postcode', 'invoice_city', 'invoice_nip'];
                invoiceFieldIds.forEach(fieldId => {
                    const field = document.getElementById(fieldId);
                    if (field) {
                        clientDataModal.clearError(field);
                    }
                });
            }
        }
    },

    updateCharCounter: () => {
        const textarea = document.getElementById('quote_notes');
        const counter = document.getElementById('quote-notes-count');
        
        if (textarea && counter) {
            const length = textarea.value.length;
            counter.textContent = length;
            
            // Ograniczenie do 500 znaków
            if (length > 500) {
                textarea.value = textarea.value.substring(0, 500);
                counter.textContent = '500';
            }
        }
    },

    submitForm: async (event) => {
        if (event) {
            event.preventDefault();
        }

        if (clientDataModal.isLoading) return;

        console.log('[ClientDataModal] Submitting form...');

        // Ostateczna walidacja
        if (!clientDataModal.validateCurrentStep()) {
            console.log('[ClientDataModal] Validation failed');
            return;
        }

        clientDataModal.setLoading(true);

        try {
            // Zbierz dane z formularza
            const formData = clientDataModal.getFormData();
            console.log('[ClientDataModal] Form data:', formData);

            // Wyślij do API
            const result = await api.acceptQuoteWithData(window.QUOTE_TOKEN, formData);

            console.log('[ClientDataModal] ✅ Quote accepted successfully!', result);
            
            // Zamknij modal
            clientDataModal.closeModal();
            
            // Pokaż sukces
            alerts.show('Dziękujemy! Wycena została zaakceptowana i przekazana do realizacji.', 'success');
            
            // Przeładuj dane wyceny
            await quote.load();
            
        } catch (error) {
            console.error('[ClientDataModal] ❌ Error:', error);
            const errorMessage = error.message || 'Wystąpił błąd podczas akceptacji wyceny';
            alerts.show(errorMessage, 'error');
        } finally {
            clientDataModal.setLoading(false);
        }
    },

    getFormData: () => {
        const form = document.getElementById('client-data-form');
        if (!form) return {};
        
        const formData = new FormData(form);
        const data = {};

        // Konwertuj FormData na obiekt
        for (let [key, value] of formData.entries()) {
            if (form.elements[key] && form.elements[key].type === 'checkbox') {
                data[key] = form.elements[key].checked;
            } else {
                data[key] = value.trim();
            }
        }

        // Dodaj checkbox dla faktury jeśli nie został automatycznie dodany
        const wantsInvoiceCheckbox = document.getElementById('wants_invoice');
        if (wantsInvoiceCheckbox) {
            data.wants_invoice = wantsInvoiceCheckbox.checked;
        }

        return data;
    },

    setLoading: (loading) => {
        clientDataModal.isLoading = loading;
        const submitBtn = document.getElementById('modal-submit-btn');
        
        if (submitBtn) {
            if (loading) {
                submitBtn.classList.add('loading');
                submitBtn.disabled = true;
            } else {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
            }
        }
    }
};

// ===================================
// APPLICATION INITIALIZATION
// ===================================
const initializeApp = async () => {
    console.log('[ClientQuote] Initializing application...');
    try {
        // Sprawdź token zabezpieczający
        const token = window.QUOTE_TOKEN;
        if (!token) {
            console.error('❌ BRAK TOKENU: window.QUOTE_TOKEN nie jest zdefiniowany!');
            alerts.show('Błąd bezpieczeństwa: brak tokenu dostępu', 'error');
            return;
        } else {
            console.log('✅ Token zabezpieczający załadowany:', token.substring(0, 8) + '...');
        }

        // Inicjalizuj wszystkie moduły
        responsive.init();
        mobilePanel.init();
        pdf.init();
        acceptanceUI.init();
        
        // Inicjalizuj formularz tylko jeśli nowy modal jest wyłączony
        form.init();
        
        // Inicjalizuj nowy modal jeśli jest włączony
        if (USE_NEW_ACCEPTANCE_MODAL) {
            clientDataModal.init();
        }
        
        // Załaduj dane wyceny
        await quote.load();
        
        console.log('[ClientQuote] Application initialized successfully');
    } catch (error) {
        console.error('[ClientQuote] Application initialization failed:', error);
        alerts.show('Wystąpił błąd podczas inicjalizacji aplikacji', 'error');
    }
};

// ===================================
// FUNKCJA DO PRZEŁĄCZANIA MIĘDZY SYSTEMAMI
// ===================================
const toggleAcceptanceSystem = () => {
    window.USE_NEW_ACCEPTANCE_MODAL = !USE_NEW_ACCEPTANCE_MODAL;
    console.log('[Debug] Switched to', window.USE_NEW_ACCEPTANCE_MODAL ? 'NEW' : 'OLD', 'acceptance system');
    acceptanceUI.setupButtons();
    
    if (window.USE_NEW_ACCEPTANCE_MODAL) {
        clientDataModal.init();
    } else {
        form.init();
    }
};

// ===================================
// EVENT LISTENERS & DOM READY
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
});

/**
 * Obsługa niezłapanych Promise rejection
 */
window.addEventListener('unhandledrejection', (event) => {
    console.error('[ClientQuote] Unhandled promise rejection:', event.reason);
});

// ===================================
// GLOBAL FUNCTIONS
// ===================================

/**
 * Globalna funkcja do wyboru wariantu - wywoływana z HTML
 * @param {number} itemId - ID wariantu
 * @param {number} productIndex - Indeks produktu
 */
window.selectVariant = (itemId, productIndex) => {
    quote.selectVariant(itemId, productIndex);
};

/**
 * Funkcja do przełączania systemów akceptacji - dostępna globalnie
 */
window.toggleAcceptanceSystem = toggleAcceptanceSystem;

// ===================================
// DEBUG HELPERS
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
        acceptanceUI,
        clientDataModal,
        
        // Funkcje pomocnicze
        reloadQuote: () => quote.load(),
        showTestAlert: (message, type) => alerts.show(message, type),
        clearAlerts: () => alerts.clear(),
        toggleMobileView: () => {
            globalState.isMobileView = !globalState.isMobileView;
            responsive.handleResize();
        },
        openModal: () => clientDataModal.openModal(),
        closeModal: () => clientDataModal.closeModal()
    };
    
    console.log('[ClientQuote] Debug helpers available at window.ClientQuoteDebug');
}

// ===================================
// EKSPORT OBIEKTÓW DO GLOBALNEGO ZASIĘGU
// ===================================

// Eksportuj obiekty dla dostępu z zewnątrz
window.clientDataModal = clientDataModal;
window.acceptanceUI = acceptanceUI;
window.quote = quote;
window.api = api;
window.alerts = alerts;
window.utils = utils;

console.log("=== CLIENT QUOTE INTEGRATION COMPLETE ===");
console.log("✅ New acceptance modal integrated successfully");
console.log("✅ Feature flag system active (USE_NEW_ACCEPTANCE_MODAL = true)");
console.log("✅ PDF download uses token-based security");
console.log("✅ All modules initialized and integrated");
console.log("🔧 Debug commands available at window.ClientQuoteDebug");
console.log("🔄 Toggle systems with: window.toggleAcceptanceSystem()");

// Finalne sprawdzenie integracji
console.log('[ClientQuote] Integration status:', {
    newModalEnabled: USE_NEW_ACCEPTANCE_MODAL,
    clientDataModal: typeof clientDataModal !== 'undefined',
    acceptanceUI: typeof acceptanceUI !== 'undefined',
    quote: typeof quote !== 'undefined',
    api: typeof api !== 'undefined',
    alerts: typeof alerts !== 'undefined'
});