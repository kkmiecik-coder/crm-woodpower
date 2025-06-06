// ===================================
// CLIENT QUOTE JS - Wood Power
// Main logic for client quote page
// ===================================

console.log("[ClientQuote] Script loaded");

// Global state
let quoteData = null;
let isLoading = false;
let selectedVariants = new Map(); // product_index -> item_id

// DOM elements
const elements = {
    loadingOverlay: null,
    alertContainer: null,
    quoteSummary: null,
    productsSection: null,
    acceptSection: null,
    successSection: null,

    // Summary elements
    quoteNumber: null,
    quoteStatus: null,
    quoteDate: null,
    clientName: null,
    employeeName: null,
    courierName: null,
    quoteCreatedDate: null,
    productsPrice: null,
    finishingPrice: null,
    shippingPrice: null,
    totalPrice: null,

    // Products
    productsContainer: null,

    // Form elements
    acceptanceForm: null,
    emailPhoneInput: null,
    commentsInput: null,
    acceptBtn: null,

    // PDF buttons
    downloadPdfBtn: null,
    downloadFinalPdf: null
};

// Utility functions
const utils = {
    // Format currency
    formatCurrency: (amount) => {
        if (amount === null || amount === undefined) return "0.00 PLN";
        return `${parseFloat(amount).toFixed(2)} PLN`;
    },

    // Format date
    formatDate: (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('pl-PL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    },

    // Format short date
    formatShortDate: (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('pl-PL');
    },

    // Translate variant codes
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

    // Validate email
    isValidEmail: (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    // Validate phone
    isValidPhone: (phone) => {
        const phoneRegex = /^[0-9+\s\-()]{7,}$/;
        return phoneRegex.test(phone.trim());
    },

    // Debounce function
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

    // Show/hide loading overlay
    setLoading: (loading) => {
        isLoading = loading;
        if (elements.loadingOverlay) {
            if (loading) {
                elements.loadingOverlay.classList.remove('hide');
            } else {
                elements.loadingOverlay.classList.add('hide');
            }
        }
    }
};

// Alert system
const alerts = {
    show: (message, type = 'info', duration = 5000) => {
        if (!elements.alertContainer) return;

        console.log(`[Alert] ${type.toUpperCase()}: ${message}`);

        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;

        const icon = alerts.getIcon(type);

        alert.innerHTML = `
            ${icon}
            <div class="alert-content">
                <p>${message}</p>
            </div>
            <button class="alert-close" aria-label="Zamknij alert">
                <svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                </svg>
            </button>
        `;

        // Add close functionality
        const closeBtn = alert.querySelector('.alert-close');
        closeBtn.addEventListener('click', () => alerts.hide(alert));

        elements.alertContainer.appendChild(alert);

        // Auto-hide after duration
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
        if (elements.alertContainer) {
            elements.alertContainer.innerHTML = '';
        }
    },

    getIcon: (type) => {
        const icons = {
            success: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>`,
            error: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>`,
            warning: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>`,
            info: `<svg class="alert-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
            </svg>`
        };
        return icons[type] || icons.info;
    }
};

// API functions
const api = {
    // Base API call with error handling
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
            const data = await response.json();

            if (!response.ok) {
                console.error(`[API] Error ${response.status}:`, data);
                throw new Error(data.message || `HTTP error ${response.status}`);
            }

            console.log(`[API] Success:`, data);
            return data;
        } catch (error) {
            console.error(`[API] Request failed:`, error);
            throw error;
        }
    },

    // Get quote data
    getQuoteData: async (token) => {
        return api.call(`/quotes/api/client/quote/${token}`);
    },

    // Update variant selection (tylko item_id)
    updateVariant: async (token, itemId) => {
        return api.call(`/quotes/api/client/quote/${token}/update-variant`, {
            method: 'PATCH',
            body: JSON.stringify({
                item_id: itemId
            })
        });
    },

    // Accept quote
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

// Quote data management
const quote = {
    // Load quote data from API
    load: async () => {
        try {
            utils.setLoading(true);
            alerts.clear();

            const token = window.QUOTE_TOKEN;
            if (!token) {
                throw new Error('Brak tokenu wyceny');
            }

            quoteData = await api.getQuoteData(token);
            console.log('[Quote] Data loaded:', quoteData);

            // Initialize selected variants map
            selectedVariants.clear();
            if (quoteData.items) {
                quoteData.items.forEach(item => {
                    if (item.is_selected) {
                        selectedVariants.set(item.product_index, item.id);
                    }
                });
            }

            quote.render();

        } catch (error) {
            console.error('[Quote] Failed to load data:', error);
            quote.handleError(error);
        } finally {
            utils.setLoading(false);
        }
    },

    // Render quote data to DOM
    render: () => {
        if (!quoteData) return;

        console.log('[Quote] Rendering data');

        // Update summary
        quote.renderSummary();

        // Update products
        quote.renderProducts();

        // Show sections
        quote.showSections();
    },

    // Render summary section
    renderSummary: () => {
        if (!quoteData) return;

        // Basic info
        if (elements.quoteNumber) elements.quoteNumber.textContent = quoteData.quote_number || '-';
        if (elements.quoteStatus) elements.quoteStatus.textContent = quoteData.status_name || 'Aktywna';
        if (elements.quoteDate) elements.quoteDate.textContent = utils.formatShortDate(quoteData.created_at);

        // Client and employee info
        if (elements.clientName) elements.clientName.textContent = quoteData.client?.client_name || '-';
        if (elements.employeeName) {
            const firstName = quoteData.user?.first_name || '';
            const lastName = quoteData.user?.last_name || '';
            elements.employeeName.textContent = `${firstName} ${lastName}`.trim() || '-';
        }
        if (elements.courierName) elements.courierName.textContent = quoteData.courier_name || '-';
        if (elements.quoteCreatedDate) elements.quoteCreatedDate.textContent = utils.formatDate(quoteData.created_at);

        // Pricing
        if (quoteData.costs) {
            if (elements.productsPrice) elements.productsPrice.textContent = utils.formatCurrency(quoteData.costs.products?.brutto);
            if (elements.finishingPrice) elements.finishingPrice.textContent = utils.formatCurrency(quoteData.costs.finishing?.brutto);
            if (elements.shippingPrice) elements.shippingPrice.textContent = utils.formatCurrency(quoteData.costs.shipping?.brutto);
            if (elements.totalPrice) elements.totalPrice.textContent = utils.formatCurrency(quoteData.costs.total?.brutto);
        }
    },

    // Render products section
    renderProducts: () => {
        if (!quoteData || !elements.productsContainer) return;

        console.log('[Quote] Rendering products');

        // Group items by product_index
        const groupedItems = {};
        quoteData.items.forEach(item => {
            if (!groupedItems[item.product_index]) {
                groupedItems[item.product_index] = [];
            }
            groupedItems[item.product_index].push(item);
        });

        // Clear container
        elements.productsContainer.innerHTML = '';

        // Render each product group
        Object.keys(groupedItems).sort((a, b) => parseInt(a) - parseInt(b)).forEach(productIndex => {
            const items = groupedItems[productIndex];
            const productGroup = quote.createProductGroup(parseInt(productIndex), items);
            elements.productsContainer.appendChild(productGroup);
        });
    },

    // Create product group element
    createProductGroup: (productIndex, items) => {
        const selectedItem = items.find(item => item.is_selected) || items[0];
        const finishing = quoteData.finishing?.find(f => f.product_index === productIndex);

        const group = document.createElement('div');
        group.className = 'product-group';
        group.innerHTML = `
            <div class="product-header">
                <h3 class="product-title">Produkt ${productIndex}</h3>
                <div class="product-summary">
                    <div><strong>Wymiary:</strong> ${selectedItem.length_cm}×${selectedItem.width_cm}×${selectedItem.thickness_cm} cm</div>
                    <div><strong>Objętość:</strong> ${selectedItem.volume_m3?.toFixed(3) || '0.000'} m³</div>
                    ${finishing ? `<div><strong>Wykończenie:</strong> ${quote.formatFinishing(finishing)}</div>` : ''}
                </div>
            </div>
            <div class="product-variants">
                <div class="variant-grid" id="variants-${productIndex}">
                    ${items.map(item => quote.createVariantCard(item)).join('')}
                </div>
            </div>
        `;

        return group;
    },

    // Create variant card element
    createVariantCard: (item) => {
        const isSelected = selectedVariants.get(item.product_index) === item.id;
        const variantName = utils.translateVariantCode(item.variant_code);

        // Calculate prices
        const hasDiscount = item.discount_percentage && item.discount_percentage !== 0;
        const originalPrice = hasDiscount ? (item.original_price_brutto || item.final_price_brutto) : null;
        const finalPrice = item.final_price_brutto;

        return `
            <div class="variant-card ${isSelected ? 'selected' : ''}" 
                 data-item-id="${item.id}" 
                 data-product-index="${item.product_index}"
                 onclick="quote.selectVariant(${item.id}, ${item.product_index})">
                
                <div class="variant-header">
                    <div>
                        <div class="variant-name">${variantName}</div>
                    </div>
                    <div class="variant-badge ${isSelected ? 'selected' : 'available'}">
                        ${isSelected ? 'Wybrane' : 'Dostępne'}
                    </div>
                </div>
                
                <div class="variant-details">
                    <div class="variant-detail">
                        <span class="detail-label">Cena za m³</span>
                        <span class="detail-value">${utils.formatCurrency(item.price_per_m3)}</span>
                    </div>
                    <div class="variant-detail">
                        <span class="detail-label">Objętość</span>
                        <span class="detail-value">${item.volume_m3?.toFixed(3) || '0.000'} m³</span>
                    </div>
                    <div class="variant-detail">
                        <span class="detail-label">Wymiary</span>
                        <span class="detail-value">${item.length_cm}×${item.width_cm}×${item.thickness_cm} cm</span>
                    </div>
                    <div class="variant-detail">
                        <span class="detail-label">Mnożnik</span>
                        <span class="detail-value">${item.multiplier || '1.0'}</span>
                    </div>
                </div>
                
                <div class="variant-price">
                    ${hasDiscount && originalPrice ? `
                        <div class="price-original">${utils.formatCurrency(originalPrice)}</div>
                        <div class="price-discount">Rabat ${item.discount_percentage}%</div>
                    ` : ''}
                    <div class="price-final">${utils.formatCurrency(finalPrice)}</div>
                </div>
            </div>
        `;
    },

    // Format finishing details
    formatFinishing: (finishing) => {
        const parts = [
            finishing.variant,
            finishing.type,
            finishing.color,
            finishing.gloss
        ].filter(Boolean);

        return parts.length > 0 ? parts.join(' - ') : 'Brak wykończenia';
    },

    // Select variant
    selectVariant: async (itemId, productIndex) => {
        if (isLoading) return;

        // Check if already selected
        if (selectedVariants.get(productIndex) === itemId) {
            console.log('[Quote] Variant already selected');
            return;
        }

        try {
            console.log(`[Quote] Selecting variant ${itemId} for product ${productIndex}`);

            // Set loading state for variant card
            const variantCard = document.querySelector(`[data-item-id="${itemId}"]`);
            if (variantCard) {
                variantCard.setAttribute('data-loading', 'true');
            }

            // Make API call (tylko item_id, bez email/phone)
            await api.updateVariant(window.QUOTE_TOKEN, itemId);

            // Update local state
            selectedVariants.set(productIndex, itemId);

            // Reload quote data to get updated prices
            await quote.load();

            console.log('[Quote] Variant changed successfully');
            alerts.show('Wariant został zmieniony', 'success');

        } catch (error) {
            console.error('[Quote] Failed to select variant:', error);
            alerts.show(error.message || 'Nie udało się zmienić wariantu', 'error');

            // Remove loading state
            const variantCard = document.querySelector(`[data-item-id="${itemId}"]`);
            if (variantCard) {
                variantCard.removeAttribute('data-loading');
            }
        }
    },

    // Show sections after data is loaded
    showSections: () => {
        if (elements.quoteSummary) elements.quoteSummary.style.display = 'block';
        if (elements.productsSection) elements.productsSection.style.display = 'block';
        if (elements.acceptSection) elements.acceptSection.style.display = 'block';
    },

    // Handle API errors
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

        alerts.show(message, type, 0); // Don't auto-hide error messages
    }
};

// Form handling
const form = {
    // Initialize form
    init: () => {
        if (!elements.acceptanceForm) return;

        console.log('[Form] Initializing');

        // Add event listeners
        elements.acceptanceForm.addEventListener('submit', form.handleSubmit);

        if (elements.emailPhoneInput) {
            elements.emailPhoneInput.addEventListener('input', utils.debounce(form.validateEmailPhone, 300));
            elements.emailPhoneInput.addEventListener('blur', form.validateEmailPhone);
        }
    },

    // Handle form submission
    handleSubmit: async (event) => {
        event.preventDefault();

        if (isLoading) return;

        console.log('[Form] Submitting acceptance form');

        // Validate form
        if (!form.validate()) {
            return;
        }

        try {
            // Set loading state
            form.setSubmitting(true);
            alerts.clear();

            const emailOrPhone = elements.emailPhoneInput.value.trim();
            const comments = elements.commentsInput?.value?.trim() || '';

            // Submit acceptance
            await api.acceptQuote(window.QUOTE_TOKEN, emailOrPhone, comments);

            console.log('[Form] Quote accepted successfully');

            // Show success section
            form.showSuccess();

            alerts.show('Dziękujemy! Wycena została zaakceptowana i przekazana do realizacji.', 'success');

        } catch (error) {
            console.error('[Form] Acceptance failed:', error);
            alerts.show(error.message || 'Nie udało się zaakceptować wyceny', 'error');
        } finally {
            form.setSubmitting(false);
        }
    },

    // Validate entire form
    validate: () => {
        let isValid = true;

        // Validate email/phone
        if (!form.validateEmailPhone()) {
            isValid = false;
        }

        return isValid;
    },

    // Validate email/phone field
    validateEmailPhone: () => {
        if (!elements.emailPhoneInput) return true;

        const value = elements.emailPhoneInput.value.trim();
        const errorElement = document.getElementById('email-phone-error');

        // Clear previous error
        elements.emailPhoneInput.classList.remove('error');
        if (errorElement) errorElement.classList.remove('show');

        if (!value) {
            form.showFieldError('email-phone', 'To pole jest wymagane');
            return false;
        }

        // Check if it's email or phone
        const isEmail = value.includes('@');

        if (isEmail) {
            if (!utils.isValidEmail(value)) {
                form.showFieldError('email-phone', 'Wprowadź prawidłowy adres email');
                return false;
            }
        } else {
            if (!utils.isValidPhone(value)) {
                form.showFieldError('email-phone', 'Wprowadź prawidłowy numer telefonu');
                return false;
            }
        }

        return true;
    },

    // Show field error
    showFieldError: (fieldId, message) => {
        const field = document.getElementById(fieldId);
        const errorElement = document.getElementById(`${fieldId}-error`);

        if (field) field.classList.add('error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
    },

    // Set form submitting state
    setSubmitting: (submitting) => {
        if (!elements.acceptBtn) return;

        elements.acceptBtn.disabled = submitting;

        const btnText = elements.acceptBtn.querySelector('.btn-text');
        const btnLoading = elements.acceptBtn.querySelector('.btn-loading');

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

    // Show success section
    showSuccess: () => {
        // Hide other sections
        if (elements.quoteSummary) elements.quoteSummary.style.display = 'none';
        if (elements.productsSection) elements.productsSection.style.display = 'none';
        if (elements.acceptSection) elements.acceptSection.style.display = 'none';

        // Show success section
        if (elements.successSection) {
            elements.successSection.style.display = 'block';
            elements.successSection.scrollIntoView({ behavior: 'smooth' });
        }
    }
};

// PDF functionality
const pdf = {
    // Download PDF
    download: (type = 'pdf') => {
        if (!quoteData) return;

        console.log(`[PDF] Downloading ${type}`);

        const url = `/quotes/api/quotes/${quoteData.id}/pdf.${type}`;
        window.open(url, '_blank');
    },

    // Initialize PDF buttons
    init: () => {
        if (elements.downloadPdfBtn) {
            elements.downloadPdfBtn.addEventListener('click', () => pdf.download('pdf'));
        }

        if (elements.downloadFinalPdf) {
            elements.downloadFinalPdf.addEventListener('click', () => pdf.download('pdf'));
        }
    }
};

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[ClientQuote] DOM ready, initializing...');

    // Cache DOM elements
    elements.loadingOverlay = document.getElementById('loading-overlay');
    elements.alertContainer = document.getElementById('alert-container');
    elements.quoteSummary = document.getElementById('quote-summary');
    elements.productsSection = document.getElementById('products-section');
    elements.acceptSection = document.getElementById('accept-section');
    elements.successSection = document.getElementById('success-section');

    // Summary elements
    elements.quoteNumber = document.getElementById('quote-number');
    elements.quoteStatus = document.getElementById('quote-status');
    elements.quoteDate = document.getElementById('quote-date');
    elements.clientName = document.getElementById('client-name');
    elements.employeeName = document.getElementById('employee-name');
    elements.courierName = document.getElementById('courier-name');
    elements.quoteCreatedDate = document.getElementById('quote-created-date');
    elements.productsPrice = document.getElementById('products-price');
    elements.finishingPrice = document.getElementById('finishing-price');
    elements.shippingPrice = document.getElementById('shipping-price');
    elements.totalPrice = document.getElementById('total-price');

    // Products
    elements.productsContainer = document.getElementById('products-container');

    // Form elements
    elements.acceptanceForm = document.getElementById('acceptance-form');
    elements.emailPhoneInput = document.getElementById('email-phone');
    elements.commentsInput = document.getElementById('comments');
    elements.acceptBtn = document.getElementById('accept-btn');

    // PDF buttons
    elements.downloadPdfBtn = document.getElementById('download-pdf-btn');
    elements.downloadFinalPdf = document.getElementById('download-final-pdf');

    // Initialize modules
    form.init();
    pdf.init();

    // Load quote data
    await quote.load();

    console.log('[ClientQuote] Initialization complete');
});

// Global functions for inline event handlers
window.quote = quote;

// Error handling for unhandled promise rejections
window.addEventListener('unhandledrejection', event => {
    console.error('[ClientQuote] Unhandled promise rejection:', event.reason);
    alerts.show('Wystąpił nieoczekiwany błąd', 'error');
});

// ===================================
// ADDITIONAL FEATURES - Wood Power
// Copy link, Progress indicator, Tooltips
// ===================================

// Dodaj do client_quote.js (na końcu pliku, przed debug helpers)

// Link copying functionality
const linkCopy = {
    // Copy current page URL to clipboard
    copyCurrentLink: async () => {
        try {
            const url = window.location.href;

            if (navigator.clipboard && navigator.clipboard.writeText) {
                // Modern clipboard API
                await navigator.clipboard.writeText(url);
                alerts.show('Link został skopiowany do schowka! 📋', 'success', 3000);
            } else {
                // Fallback for older browsers
                linkCopy.fallbackCopyTextToClipboard(url);
            }

            console.log('[LinkCopy] URL copied to clipboard:', url);

        } catch (error) {
            console.error('[LinkCopy] Failed to copy:', error);
            alerts.show('Nie udało się skopiować linku', 'error');
        }
    },

    // Fallback method for older browsers
    fallbackCopyTextToClipboard: async (text) => {
        // Jeżeli dostępne jest nowoczesne API, użyj go
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                alerts.show('Link został skopiowany do schowka! 📋', 'success', 3000);
                return;
            } catch (err) {
                console.error('[LinkCopy] Clipboard API failed:', err);
                // Przejdź dalej do manualnego kopiowania
            }
        }

        // Fallback do execCommand
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            // @ts-ignore: potrzebne dla starszych przeglądarek, mimo że execCommand jest deprecated
            const successful = document.execCommand('copy');
            if (successful) {
                alerts.show('Link został skopiowany do schowka! 📋', 'success', 3000);
            } else {
                throw new Error('Copy command failed');
            }
        } catch (error) {
            console.error('[LinkCopy] Fallback copy failed:', error);

            // Pokaż instrukcję ręcznego kopiowania
            const shortUrl = text.length > 50 ? text.substring(0, 50) + '...' : text;
            alerts.show(`Skopiuj link ręcznie: ${shortUrl}`, 'info', 8000);
        }

        document.body.removeChild(textArea);
    },

    // Initialize copy link functionality
    init: () => {
        // Add copy button to header if not exists
        const headerActions = document.querySelector('.summary-actions');
        if (headerActions && !document.getElementById('copy-link-btn')) {
            const copyBtn = document.createElement('button');
            copyBtn.id = 'copy-link-btn';
            copyBtn.className = 'btn btn-secondary';
            copyBtn.title = 'Skopiuj link do wyceny';
            copyBtn.innerHTML = `
                <svg class="btn-icon" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>
                    <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/>
                </svg>
                Kopiuj link
            `;
            copyBtn.addEventListener('click', linkCopy.copyCurrentLink);
            headerActions.appendChild(copyBtn);
        }

        // Add keyboard shortcut (Ctrl+K or Cmd+K)
        document.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
                event.preventDefault();
                linkCopy.copyCurrentLink();
            }
        });

        console.log('[LinkCopy] Initialized (Ctrl+K to copy)');
    }
};

// Progress indicator for multi-step process
const progressIndicator = {
    steps: [
        { id: 'review', label: 'Przeglądanie', description: 'Sprawdź szczegóły wyceny' },
        { id: 'select', label: 'Wybór wariantów', description: 'Wybierz odpowiednie warianty produktów' },
        { id: 'accept', label: 'Akceptacja', description: 'Zaakceptuj wycenę i złóż zamówienie' },
        { id: 'complete', label: 'Zakończone', description: 'Wycena została zaakceptowana' }
    ],

    currentStep: 0,

    // Create progress indicator HTML
    create: () => {
        const progressHTML = `
            <div class="progress-indicator" id="progress-indicator">
                ${progressIndicator.steps.map((step, index) => `
                    <div class="progress-step ${index === 0 ? 'active' : ''}" data-step="${step.id}">
                        <div class="progress-dot"></div>
                        <span class="progress-label">${step.label}</span>
                    </div>
                    ${index < progressIndicator.steps.length - 1 ? '<div class="progress-line"></div>' : ''}
                `).join('')}
            </div>
        `;

        return progressHTML;
    },

    // Update progress step
    setStep: (stepIndex) => {
        if (stepIndex < 0 || stepIndex >= progressIndicator.steps.length) return;

        progressIndicator.currentStep = stepIndex;
        const indicator = document.getElementById('progress-indicator');
        if (!indicator) return;

        const steps = indicator.querySelectorAll('.progress-step');
        steps.forEach((step, index) => {
            step.classList.remove('active', 'completed');

            if (index < stepIndex) {
                step.classList.add('completed');
            } else if (index === stepIndex) {
                step.classList.add('active');
            }
        });

        console.log(`[Progress] Step ${stepIndex}: ${progressIndicator.steps[stepIndex].label}`);
    },

    // Initialize progress indicator
    init: () => {
        // Add progress indicator to page
        const mainContent = document.querySelector('.client-main .container');
        if (mainContent && !document.getElementById('progress-indicator')) {
            const progressDiv = document.createElement('div');
            progressDiv.innerHTML = progressIndicator.create();

            // Insert after breadcrumb
            const breadcrumb = document.querySelector('.breadcrumb');
            if (breadcrumb) {
                breadcrumb.parentNode.insertBefore(progressDiv.firstElementChild, breadcrumb.nextSibling);
            } else {
                mainContent.insertBefore(progressDiv.firstElementChild, mainContent.firstChild);
            }
        }

        // Set initial step
        progressIndicator.setStep(0);

        console.log('[Progress] Initialized');
    },

    // Auto-advance based on user actions
    autoAdvance: () => {
        // Advance to step 1 (Select) when user scrolls to products
        const productsSection = document.getElementById('products-section');
        if (productsSection) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && progressIndicator.currentStep === 0) {
                        progressIndicator.setStep(1);
                    }
                });
            }, { threshold: 0.3 });

            observer.observe(productsSection);
        }

        // Advance to step 2 (Accept) when user scrolls to form
        const acceptSection = document.getElementById('accept-section');
        if (acceptSection) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && progressIndicator.currentStep <= 1) {
                        progressIndicator.setStep(2);
                    }
                });
            }, { threshold: 0.3 });

            observer.observe(acceptSection);
        }
    }
};

// Enhanced tooltips system
const tooltips = {
    // Add tooltip to element
    add: (element, text, position = 'top') => {
        if (!element) return;

        element.setAttribute('data-tooltip', text);
        element.setAttribute('data-tooltip-position', position);
        element.classList.add('tooltip');

        // Add event listeners
        element.addEventListener('mouseenter', tooltips.show);
        element.addEventListener('mouseleave', tooltips.hide);
        element.addEventListener('focus', tooltips.show);
        element.addEventListener('blur', tooltips.hide);
    },

    // Show tooltip
    show: (event) => {
        const element = event.target;
        const text = element.getAttribute('data-tooltip');
        const position = element.getAttribute('data-tooltip-position') || 'top';

        if (!text) return;

        // Remove existing tooltip
        tooltips.hide();

        // Create tooltip element
        const tooltip = document.createElement('div');
        tooltip.className = `tooltip-popup tooltip-${position}`;
        tooltip.textContent = text;
        tooltip.id = 'active-tooltip';

        document.body.appendChild(tooltip);

        // Position tooltip
        const rect = element.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let top, left;

        switch (position) {
            case 'top':
                top = rect.top - tooltipRect.height - 8;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'bottom':
                top = rect.bottom + 8;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'left':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.left - tooltipRect.width - 8;
                break;
            case 'right':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.right + 8;
                break;
        }

        // Keep tooltip within viewport
        top = Math.max(8, Math.min(top, window.innerHeight - tooltipRect.height - 8));
        left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;

        // Animate in
        requestAnimationFrame(() => {
            tooltip.classList.add('visible');
        });
    },

    // Hide tooltip
    hide: () => {
        const existingTooltip = document.getElementById('active-tooltip');
        if (existingTooltip) {
            existingTooltip.classList.remove('visible');
            setTimeout(() => {
                if (existingTooltip.parentNode) {
                    existingTooltip.parentNode.removeChild(existingTooltip);
                }
            }, 200);
        }
    },

    // Initialize tooltips for common elements
    init: () => {
        // Add tooltips to buttons
        const downloadBtn = document.getElementById('download-pdf-btn');
        if (downloadBtn) {
            tooltips.add(downloadBtn, 'Pobierz wycenę w formacie PDF');
        }

        const copyBtn = document.getElementById('copy-link-btn');
        if (copyBtn) {
            tooltips.add(copyBtn, 'Skopiuj link do tej wyceny (Ctrl+K)');
        }

        // Add tooltips to variant cards (will be added dynamically)
        document.addEventListener('click', (event) => {
            if (event.target.closest('.variant-card')) {
                const card = event.target.closest('.variant-card');
                if (!card.getAttribute('data-tooltip')) {
                    tooltips.add(card, 'Kliknij, aby wybrać ten wariant', 'bottom');
                }
            }
        });

        console.log('[Tooltips] Initialized');
    }
};

// Enhanced form experience
const formEnhancements = {
    // Add form progress saving
    saveProgress: () => {
        if (!elements.emailPhoneInput) return;

        const formData = {
            emailPhone: elements.emailPhoneInput.value,
            comments: elements.commentsInput?.value || '',
            timestamp: Date.now()
        };

        try {
            localStorage.setItem('quoteFormProgress', JSON.stringify(formData));
        } catch (error) {
            console.warn('[FormEnhancements] Could not save progress:', error);
        }
    },

    // Restore form progress
    restoreProgress: () => {
        try {
            const saved = localStorage.getItem('quoteFormProgress');
            if (!saved) return;

            const formData = JSON.parse(saved);
            const ageHours = (Date.now() - formData.timestamp) / (1000 * 60 * 60);

            // Only restore if less than 24 hours old
            if (ageHours > 24) {
                localStorage.removeItem('quoteFormProgress');
                return;
            }

            if (elements.emailPhoneInput && formData.emailPhone) {
                elements.emailPhoneInput.value = formData.emailPhone;
            }

            if (elements.commentsInput && formData.comments) {
                elements.commentsInput.value = formData.comments;
            }

            console.log('[FormEnhancements] Progress restored');

        } catch (error) {
            console.warn('[FormEnhancements] Could not restore progress:', error);
            localStorage.removeItem('quoteFormProgress');
        }
    },

    // Add real-time character counter for comments
    addCharacterCounter: () => {
        if (!elements.commentsInput) return;

        const maxLength = 500;
        const counter = document.createElement('div');
        counter.className = 'character-counter';
        counter.innerHTML = `<span id="char-count">0</span>/${maxLength}`;

        elements.commentsInput.parentNode.appendChild(counter);
        elements.commentsInput.setAttribute('maxlength', maxLength);

        elements.commentsInput.addEventListener('input', () => {
            const count = elements.commentsInput.value.length;
            document.getElementById('char-count').textContent = count;

            counter.classList.toggle('near-limit', count > maxLength * 0.9);
        });
    },

    // Initialize form enhancements
    init: () => {
        // Restore previous progress
        formEnhancements.restoreProgress();

        // Save progress on input
        if (elements.emailPhoneInput) {
            elements.emailPhoneInput.addEventListener('input',
                utils.debounce(formEnhancements.saveProgress, 1000)
            );
        }

        if (elements.commentsInput) {
            elements.commentsInput.addEventListener('input',
                utils.debounce(formEnhancements.saveProgress, 1000)
            );
        }

        // Add character counter
        formEnhancements.addCharacterCounter();

        // Clear saved progress on successful submission
        const originalShowSuccess = form.showSuccess;
        form.showSuccess = () => {
            localStorage.removeItem('quoteFormProgress');
            originalShowSuccess();
        };

        console.log('[FormEnhancements] Initialized');
    }
};

// Performance monitoring
const performance = {
    startTime: Date.now(),

    // Mark performance milestones
    mark: (label) => {
        const time = Date.now() - performance.startTime;
        console.log(`[Performance] ${label}: ${time}ms`);

        // Send to analytics if available
        if (window.gtag) {
            window.gtag('event', 'timing_complete', {
                name: label,
                value: time
            });
        }
    },

    // Monitor page load performance
    init: () => {
        // Mark when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                performance.mark('DOM_Ready');
            });
        } else {
            performance.mark('DOM_Ready');
        }

        // Mark when page is fully loaded
        if (document.readyState === 'complete') {
            performance.mark('Page_Loaded');
        } else {
            window.addEventListener('load', () => {
                performance.mark('Page_Loaded');
            });
        }

        // Mark when quote data is loaded
        const originalLoad = quote.load;
        quote.load = async () => {
            const start = Date.now();
            const result = await originalLoad();
            performance.mark('Quote_Data_Loaded');
            return result;
        };
    }
};

// Initialize all additional features
const additionalFeatures = {
    init: () => {
        console.log('[AdditionalFeatures] Initializing...');

        // Initialize all features
        linkCopy.init();
        progressIndicator.init();
        tooltips.init();
        formEnhancements.init();
        performance.init();

        // Setup auto-advance for progress indicator
        setTimeout(() => {
            progressIndicator.autoAdvance();
        }, 1000);

        // Mark initialization complete
        performance.mark('Additional_Features_Ready');

        console.log('[AdditionalFeatures] All features initialized');
    }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', additionalFeatures.init);
} else {
    additionalFeatures.init();
}

// Expose for external use
window.ClientQuote = {
    ...window.ClientQuote,
    copyLink: linkCopy.copyCurrentLink,
    setProgress: progressIndicator.setStep,
    showTooltip: tooltips.show,
    hideTooltip: tooltips.hide
};

// Debug helpers (only in development)
if (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1')) {
    window.clientQuoteDebug = {
        quoteData: () => quoteData,
        selectedVariants: () => selectedVariants,
        elements: () => elements,
        utils,
        alerts,
        api,
        quote,
        form,
        pdf
    };
    console.log('[ClientQuote] Debug helpers available at window.clientQuoteDebug');
}

// Expose minimal global API for external use
window.ClientQuote = {
    reload: quote.load,
    showAlert: alerts.show,
    isLoading: () => isLoading
};