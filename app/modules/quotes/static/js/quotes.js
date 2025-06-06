// modules/quotes/static/js/quotes.js

console.log("quotes.js załadowany");

let allStatuses = {};
let allQuotes = [];
let activeStatus = null;
let currentPage = 1;
let resultsPerPage = 20;
let allUsers = [];
let currentEditingItem = null;
let currentQuoteData = null;
let discountReasons = [];
let originalPrices = {};

document.addEventListener("DOMContentLoaded", () => {
    console.log("[DOMContentLoaded] Inicjalizacja komponentów");
    fetchQuotes();
    fetchQuotes().then(() => {
        initDownloadModal();
    });
    initStatusPanel();
    fetchUsers();
    initClearFiltersButton();
    updateClearFiltersButtonState();
    initEditModals();

    // Event listeners dla modala
    const closeBtn = document.getElementById("close-details-modal");
    const modal = document.getElementById("quote-details-modal");
    if (closeBtn && modal) {
        closeBtn.addEventListener("click", () => {
            modal.classList.remove("active");
        });
    }

    const toggleFullscreenBtn = document.getElementById("toggle-fullscreen-modal");
    const modalOverlay = document.getElementById("quote-details-modal");
    const downloadBtn = document.getElementById("download-details-btn");

    if (toggleFullscreenBtn && modalOverlay) {
        toggleFullscreenBtn.addEventListener("click", () => {
            modalOverlay.classList.toggle("fullscreen");
        });
    }

    if (downloadBtn) {
        downloadBtn.addEventListener("click", () => {
            const id = downloadBtn.dataset.id;
            if (!id) return;
            const triggerBtn = document.querySelector(`.quotes-btn-download[data-id='${id}']`);
            if (triggerBtn) triggerBtn.click();
        });
    }
});

// Inicjalizacja modali edycji - dodaj do DOMContentLoaded
function initEditModals() {
    console.log("[initEditModals] Inicjalizacja modali edycji");

    // Pobierz powody rabatów
    fetchDiscountReasons();

    // Event listeners dla modali
    setupVariantEditModal();
    setupTotalDiscountModal();
}

function initDownloadModal() {
    const modal = document.getElementById("download-modal");
    const closeBtn = document.getElementById("closeDownloadModal");
    const iframe = document.getElementById("quotePreview");
    const downloadPDF = document.getElementById("downloadPDF");
    const downloadPNG = document.getElementById("downloadPNG");

    document.addEventListener("click", (e) => {
        const downloadBtn = e.target.closest(".quotes-btn-download");
        if (downloadBtn) {
            const quoteId = downloadBtn.dataset.id;
            console.log(`[DownloadModal] Klik dla ID: ${quoteId}`);

            if (!quoteId) {
                console.warn("❗️Brak quoteId – dataset.id undefined!");
                return;
            }

            if (!iframe) {
                console.warn("❗️Brak #quotePreview w DOM!");
                return;
            }

            iframe.src = `/quotes/api/quotes/${quoteId}/pdf.pdf`;

            downloadPDF.dataset.id = quoteId;
            downloadPNG.dataset.id = quoteId;

            modal.style.display = "flex";
        }
    });

    closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
        iframe.src = "";
    });

    // Pobieranie PDF
    downloadPDF.addEventListener("click", () => {
        const quoteId = downloadPDF.dataset.id;
        window.open(`/quotes/api/quotes/${quoteId}/pdf.pdf`, "_blank");
    });

    // Pobieranie PNG
    downloadPNG.addEventListener("click", () => {
        const quoteId = downloadPNG.dataset.id;
        window.open(`/quotes/api/quotes/${quoteId}/pdf.png`, "_blank");
    });

    // Zamykanie modal po kliknięciu tła
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.style.display = "none";
            iframe.src = "";
        }
    });
}

function fetchQuotes() {
    console.info("[fetchQuotes] Pobieranie wycen z /quotes/api/quotes");

    return fetch("/quotes/api/quotes")
        .then(res => res.json())
        .then(data => {
            allQuotes = data;
            if (data.length > 0) {
                allStatuses = data[0].all_statuses;
            }
            filterQuotes();
        })
        .catch(err => {
            console.error("[fetchQuotes] Błąd pobierania wycen:", err);
        });
}

function fetchUsers() {
    fetch("/quotes/api/users")
        .then(res => res.json())
        .then(data => {
            allUsers = data;
            const select = document.getElementById("employee-filter");
            if (!select) return;

            // Reset opcji przed dodaniem nowych
            select.innerHTML = '<option value="">Wszyscy</option>';

            data.forEach(user => {
                const opt = document.createElement("option");
                opt.value = user.id;
                opt.textContent = user.name;
                select.appendChild(opt);
            });
        })
        .catch(err => console.error("Błąd pobierania użytkowników:", err));
}

function showDetailsModal(quoteData) {
    console.log('[MODAL] Otwieranie szczegółów wyceny:', quoteData);

    const modal = document.getElementById('quote-details-modal');
    const itemsContainer = document.getElementById('quotes-details-modal-items-body');
    const tabsContainer = document.getElementById('quotes-details-tabs');
    const dropdownWrap = document.getElementById('quotes-details-modal-status-dropdown');
    const selectedDiv = document.getElementById('custom-status-selected');
    const optionsContainer = document.getElementById('custom-status-options');

    if (!modal || !itemsContainer || !tabsContainer || !dropdownWrap || !selectedDiv || !optionsContainer) {
        console.warn('[MODAL] Brakuje elementów w DOM!');
        return;
    }

    // POPRAWIONE dane klienta - właściwe mapowanie pól
    document.getElementById('quotes-details-modal-client-number').textContent = quoteData.client?.client_number || '-';
    document.getElementById('quotes-details-modal-client-name').textContent = quoteData.client?.client_name || '-';
    document.getElementById('quotes-details-modal-client-fullname').textContent = quoteData.client?.client_delivery_name || '-';
    document.getElementById('quotes-details-modal-client-email').textContent = quoteData.client?.email || '-';
    document.getElementById('quotes-details-modal-client-phone').textContent = quoteData.client?.phone || '-';
    document.getElementById('quotes-details-modal-client-company').textContent = quoteData.client?.company || '-';

    // Dane wyceny
    const parsedDate = quoteData.created_at ? new Date(quoteData.created_at).toLocaleDateString("pl-PL") : '-';
    document.getElementById('quotes-details-modal-quote-number').textContent = quoteData.quote_number || '-';
    document.getElementById('quotes-details-modal-quote-date').textContent = parsedDate;
    document.getElementById('quotes-details-modal-quote-source').textContent = quoteData.source || '-';

    // POPRAWIONE dane pracownika
    const employeeName = `${quoteData.user?.first_name || ''} ${quoteData.user?.last_name || ''}`.trim() || '-';
    document.getElementById('quotes-details-modal-employee-name').textContent = employeeName;

    document.getElementById("download-details-btn").dataset.id = quoteData.id;

    // Reszta funkcji pozostaje bez zmian...
    updateCostsDisplay(quoteData);
    setupStatusDropdown(quoteData, optionsContainer, selectedDiv, dropdownWrap);
    setupProductTabs(quoteData, tabsContainer, itemsContainer);
    addTotalDiscountButton(quoteData);

    const summaryContainer = document.getElementById("quotes-details-selected-summary");
    if (summaryContainer) {
        const grouped = groupItemsByProductIndex(quoteData.items || []);
        renderSelectedSummary(grouped, summaryContainer);
    }

    modal.classList.add('active');
    console.log('[MODAL] Modal powinien być teraz widoczny!');

    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.remove("active");
            console.log('[MODAL] Zamykam modal przez kliknięcie tła');
        }
    });

    // Client page functionality for employee interface
    const clientPageIntegration = {
        // Generate client page URL
        generateClientUrl: (quoteNumber, token) => {
            const baseUrl = window.location.origin;
            return `${baseUrl}/quotes/wycena/${quoteNumber}/${token}`;
        },

        // Open client page in new tab
        openClientPage: (quoteNumber, token) => {
            if (!quoteNumber || !token) {
                console.error('[ClientPage] Missing quote number or token');
                showToast('Brak danych do wygenerowania strony klienta', 'error');
                return;
            }

            const url = clientPageIntegration.generateClientUrl(quoteNumber, token);
            console.log('[ClientPage] Opening client page:', url);

            // Open in new tab
            window.open(url, '_blank', 'noopener,noreferrer');

            // Show toast notification
            showToast('Otwarto stronę klienta w nowej karcie', 'success');
        },

        // Copy client page link to clipboard
        copyClientLink: async (quoteNumber, token) => {
            if (!quoteNumber || !token) {
                console.error('[ClientPage] Missing quote number or token');
                showToast('Brak danych do skopiowania linku', 'error');
                return;
            }

            const url = clientPageIntegration.generateClientUrl(quoteNumber, token);

            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    // Modern clipboard API
                    await navigator.clipboard.writeText(url);
                    showToast('Link do strony klienta skopiowany! 📋', 'success');
                } else {
                    // Fallback for older browsers
                    clientPageIntegration.fallbackCopyToClipboard(url);
                }

                console.log('[ClientPage] Link copied to clipboard:', url);

                // Add visual feedback to button
                const copyBtn = document.getElementById('quote-link-copy-btn');
                if (copyBtn) {
                    copyBtn.classList.add('copy-success');
                    copyBtn.innerHTML = '<span>✅</span>';
                    setTimeout(() => {
                        copyBtn.classList.remove('copy-success');
                        copyBtn.innerHTML = '<span>🔗</span>';
                    }, 2000);
                }

            } catch (error) {
                console.error('[ClientPage] Failed to copy link:', error);
                showToast('Nie udało się skopiować linku', 'error');
            }
        },

        // Fallback copy method for older browsers
        fallbackCopyToClipboard: (text) => {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            textArea.style.top = '-9999px';

            document.body.appendChild(textArea);
            textArea.select();
            textArea.setSelectionRange(0, 99999);

            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    showToast('Link do strony klienta skopiowany! 📋', 'success');
                } else {
                    throw new Error('Copy command failed');
                }
            } catch (error) {
                console.error('[ClientPage] Fallback copy failed:', error);
                showToast('Skopiuj link ręcznie: ' + text.substring(0, 50) + '...', 'info');
            }

            document.body.removeChild(textArea);
        },

        // Initialize client page buttons
        initializeButtons: (quoteData) => {
            const clientPageBtn = document.getElementById('quote-client-page-btn');
            const copyLinkBtn = document.getElementById('quote-link-copy-btn');

            if (!quoteData || !quoteData.public_url) {
                console.warn('[ClientPage] No public URL available for quote');

                // Disable buttons if no public URL
                if (clientPageBtn) {
                    clientPageBtn.disabled = true;
                    clientPageBtn.title = 'Wycena nie ma publicznego linku';
                    clientPageBtn.style.opacity = '0.5';
                }
                if (copyLinkBtn) {
                    copyLinkBtn.disabled = true;
                    copyLinkBtn.title = 'Wycena nie ma publicznego linku';
                    copyLinkBtn.style.opacity = '0.5';
                }
                return;
            }

            // Extract quote number and token from public URL
            const urlMatch = quoteData.public_url.match(/\/wycena\/([^\/]+)\/([^\/]+)$/);
            if (!urlMatch) {
                console.error('[ClientPage] Cannot parse public URL:', quoteData.public_url);
                return;
            }

            const [, quoteNumber, token] = urlMatch;

            console.log('[ClientPage] Initializing buttons for quote:', quoteNumber);

            // Setup client page button
            if (clientPageBtn) {
                clientPageBtn.dataset.quoteNumber = quoteNumber;
                clientPageBtn.dataset.token = token;
                clientPageBtn.disabled = false;
                clientPageBtn.style.opacity = '1';
                clientPageBtn.title = 'Otwórz stronę klienta w nowej karcie';

                // Remove existing event listeners
                clientPageBtn.replaceWith(clientPageBtn.cloneNode(true));
                const newClientPageBtn = document.getElementById('quote-client-page-btn');

                newClientPageBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    clientPageIntegration.openClientPage(quoteNumber, token);
                });
            }

            // Setup copy link button
            if (copyLinkBtn) {
                copyLinkBtn.dataset.quoteNumber = quoteNumber;
                copyLinkBtn.dataset.token = token;
                copyLinkBtn.disabled = false;
                copyLinkBtn.style.opacity = '1';
                copyLinkBtn.title = 'Skopiuj link do strony klienta';

                // Remove existing event listeners
                copyLinkBtn.replaceWith(copyLinkBtn.cloneNode(true));
                const newCopyLinkBtn = document.getElementById('quote-link-copy-btn');

                newCopyLinkBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    clientPageIntegration.copyClientLink(quoteNumber, token);
                });
            }
        },

        // Check if quote is client-accessible
        isClientAccessible: (quoteData) => {
            return quoteData &&
                quoteData.public_url &&
                quoteData.is_client_editable !== false;
        },

        // Update button states based on quote status
        updateButtonStates: (quoteData) => {
            const clientPageBtn = document.getElementById('quote-client-page-btn');
            const copyLinkBtn = document.getElementById('quote-link-copy-btn');

            const isAccessible = clientPageIntegration.isClientAccessible(quoteData);

            if (!isAccessible) {
                // Show disabled state for accepted quotes
                if (clientPageBtn) {
                    clientPageBtn.disabled = true;
                    clientPageBtn.title = 'Wycena została już zaakceptowana';
                    clientPageBtn.style.opacity = '0.5';
                    clientPageBtn.innerHTML = '<span>Zaakceptowana</span>';
                }
                if (copyLinkBtn) {
                    copyLinkBtn.disabled = true;
                    copyLinkBtn.title = 'Wycena została już zaakceptowana';
                    copyLinkBtn.style.opacity = '0.5';
                }
            }
        }
    };
}

// POPRAWIONA funkcja wyświetlania kosztów
function updateCostsDisplay(quoteData) {
    console.log('[updateCostsDisplay] Aktualizuję wyświetlanie kosztów', quoteData);

    // Sprawdź czy istnieją elementy DOM dla nowej struktury
    const productsBrutto = document.getElementById('quotes-details-modal-cost-products-brutto');
    const productsNetto = document.getElementById('quotes-details-modal-cost-products-netto');

    if (productsBrutto && productsNetto) {
        // NOWA STRUKTURA - elementy istnieją
        if (quoteData.costs) {
            // Użyj nowej struktury z backendu
            const costs = quoteData.costs;

            document.getElementById('quotes-details-modal-cost-products-brutto').textContent = `${costs.products.brutto.toFixed(2)} PLN`;
            document.getElementById('quotes-details-modal-cost-products-netto').textContent = `${costs.products.netto.toFixed(2)} PLN`;

            document.getElementById('quotes-details-modal-cost-finishing-brutto').textContent = `${costs.finishing.brutto.toFixed(2)} PLN`;
            document.getElementById('quotes-details-modal-cost-finishing-netto').textContent = `${costs.finishing.netto.toFixed(2)} PLN`;

            document.getElementById('quotes-details-modal-cost-shipping-brutto').textContent = `${costs.shipping.brutto.toFixed(2)} PLN`;
            document.getElementById('quotes-details-modal-cost-shipping-netto').textContent = `${costs.shipping.netto.toFixed(2)} PLN`;

            document.getElementById('quotes-details-modal-cost-total-brutto').textContent = `${costs.total.brutto.toFixed(2)} PLN`;
            document.getElementById('quotes-details-modal-cost-total-netto').textContent = `${costs.total.netto.toFixed(2)} PLN`;
        } else {
            // Oblicz VAT po stronie frontend
            const costs = calculateCostsClientSide(quoteData);

            document.getElementById('quotes-details-modal-cost-products-brutto').textContent = `${costs.products.brutto.toFixed(2)} PLN`;
            document.getElementById('quotes-details-modal-cost-products-netto').textContent = `${costs.products.netto.toFixed(2)} PLN`;

            document.getElementById('quotes-details-modal-cost-finishing-brutto').textContent = `${costs.finishing.brutto.toFixed(2)} PLN`;
            document.getElementById('quotes-details-modal-cost-finishing-netto').textContent = `${costs.finishing.netto.toFixed(2)} PLN`;

            document.getElementById('quotes-details-modal-cost-shipping-brutto').textContent = `${costs.shipping.brutto.toFixed(2)} PLN`;
            document.getElementById('quotes-details-modal-cost-shipping-netto').textContent = `${costs.shipping.netto.toFixed(2)} PLN`;

            document.getElementById('quotes-details-modal-cost-total-brutto').textContent = `${costs.total.brutto.toFixed(2)} PLN`;
            document.getElementById('quotes-details-modal-cost-total-netto').textContent = `${costs.total.netto.toFixed(2)} PLN`;
        }
    } else {
        // STARA STRUKTURA - fallback do starych elementów
        console.warn('[updateCostsDisplay] Używam starej struktury DOM');

        const costs = quoteData.costs || calculateCostsClientSide(quoteData);

        // Spróbuj znaleźć stare elementy
        const oldProducts = document.getElementById('quotes-details-modal-cost-products');
        const oldFinishing = document.getElementById('quotes-details-modal-cost-finishing');
        const oldShipping = document.getElementById('quotes-details-modal-cost-shipping');
        const oldTotal = document.getElementById('quotes-details-modal-cost-total');

        if (oldProducts) oldProducts.textContent = `${costs.products?.brutto?.toFixed(2) || '0.00'} PLN`;
        if (oldFinishing) oldFinishing.textContent = `${costs.finishing?.brutto?.toFixed(2) || '0.00'} PLN`;
        if (oldShipping) oldShipping.textContent = `${costs.shipping?.brutto?.toFixed(2) || '0.00'} PLN`;
        if (oldTotal) oldTotal.textContent = `${costs.total?.brutto?.toFixed(2) || '0.00'} PLN`;
    }

    // Kurier
    const courierElement = document.getElementById('quotes-details-modal-courier-name');
    if (courierElement) {
        courierElement.textContent = quoteData.courier_name || '-';
    }
}

function calculateCostsClientSide(quoteData) {
    const VAT_RATE = 0.23;

    const costProducts = parseFloat(quoteData.cost_products || 0);
    const costFinishing = parseFloat(quoteData.cost_finishing || 0);
    const costShipping = parseFloat(quoteData.cost_shipping || 0);

    // Oblicz brutto dla produktów i wykończenia (zakładamy że są netto)
    const productsBrutto = costProducts * (1 + VAT_RATE);
    const finishingBrutto = costFinishing * (1 + VAT_RATE);

    // Dla wysyłki zakładamy że jest brutto, więc oblicz netto
    const shippingNetto = costShipping / (1 + VAT_RATE);

    const totalNetto = costProducts + costFinishing + shippingNetto;
    const totalBrutto = productsBrutto + finishingBrutto + costShipping;

    return {
        products: { netto: costProducts, brutto: productsBrutto },
        finishing: { netto: costFinishing, brutto: finishingBrutto },
        shipping: { netto: shippingNetto, brutto: costShipping },
        total: { netto: totalNetto, brutto: totalBrutto }
    };
}

function setupStatusDropdown(quoteData, optionsContainer, selectedDiv, dropdownWrap) {
    optionsContainer.innerHTML = '';
    Object.values(quoteData.all_statuses).forEach(s => {
        const opt = document.createElement('div');
        opt.className = 'option';
        opt.textContent = s.name;
        opt.style.backgroundColor = s.color || '#999';
        opt.dataset.name = s.name;
        optionsContainer.appendChild(opt);

        if (s.name === quoteData.status_name) {
            selectedDiv.textContent = s.name;
            selectedDiv.style.backgroundColor = s.color || '#999';
        }
    });

    dropdownWrap.classList.remove('open');

    // Event handlers
    optionsContainer.onclick = (e) => {
        const opt = e.target.closest('.option');
        if (!opt) return;
        const newStatus = opt.dataset.name;
        if (!confirm(`Na pewno zmienić status na: ${newStatus}?`)) return;

        fetch(`/quotes/api/quotes/${quoteData.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status_id: getStatusIdByName(newStatus, quoteData.all_statuses) })
        })
            .then(() => fetch(`/quotes/api/quotes/${quoteData.id}`))
            .then(res => res.json())
            .then(fullData => {
                showDetailsModal(fullData);
            })
            .catch(err => console.error('[MODAL] Błąd zmiany statusu:', err));
    };

    selectedDiv.onclick = (e) => {
        e.stopPropagation();
        dropdownWrap.classList.toggle('open');
    };

    document.addEventListener('click', (e) => {
        if (!dropdownWrap.contains(e.target)) {
            dropdownWrap.classList.remove('open');
        }
    });
}

function getStatusIdByName(name, statuses) {
    for (const key in statuses) {
        if (statuses[key].name === name) return statuses[key].id;
    }
    return null;
}

function groupItemsByProductIndex(items) {
    const grouped = {};
    items.forEach(item => {
        if (!grouped[item.product_index]) grouped[item.product_index] = [];
        grouped[item.product_index].push(item);
    });
    return grouped;
}
/**
 * Zwraca URL do pliku edit.svg na podstawie URL skryptu quotes.js
 */
function getEditIconURL() {
    const scripts = document.querySelectorAll('script');
    for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src;
        if (!src) continue;
        if (src.match(/\/js\/quotes\.js(\?.*)?$/) || src.match(/quotes\.js(\?.*)?$/)) {
            return src.replace(/\/js\/quotes\.js(\?.*)?$/, '/img/edit.svg');
        }
    }
    return '/quotes/static/img/edit.svg';
}

/**
 * Główna funkcja budująca zakładki produktów i listę wariantów
 */
function setupProductTabs(quoteData, tabsContainer, itemsContainer) {
    const items = quoteData.items || [];
    const grouped = groupItemsByProductIndex(items);

    tabsContainer.innerHTML = '';
    itemsContainer.innerHTML = '';

    // Wyliczamy URL do SVG raz i użyjemy dalej
    const editIconURL = getEditIconURL();

    const indexes = Object.keys(grouped);
    indexes.forEach((index, idx) => {
        // ——— 1. Tworzenie przycisku zakładki ———
        const tabBtn = document.createElement('button');
        tabBtn.className = 'tab-button';
        tabBtn.textContent = `Produkt ${idx + 1}`;
        tabBtn.dataset.tabIndex = index;
        if (idx === 0) tabBtn.classList.add('active');
        tabsContainer.appendChild(tabBtn);

        // ——— 2. Tworzenie kontenera z zawartością zakładki ———
        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';
        tabContent.style.display = idx === 0 ? 'block' : 'none';
        tabContent.dataset.tabIndex = index;

        // Jeżeli istnieje nagłówek z podsumowaniem wariantów
        const summaryHeader = renderVariantSummary(grouped[index], quoteData, index);
        if (summaryHeader) {
            tabContent.appendChild(summaryHeader);
        }

        // ——— 3. Lista wariantów ———
        const list = document.createElement('ul');
        list.className = 'variant-list';

        grouped[index].forEach(item => {
            const li = document.createElement('li');

            // Dodaj klasę jeśli wariant ma rabat
            if (item.has_discount) {
                li.classList.add('has-discount');
            }

            // — Dane wariantu: nazwa i ceny — 
            const variantName = translateVariantCode(item.variant_code);
            const pricePerM3 = item.price_per_m3
                ? `${item.price_per_m3.toFixed(2)} PLN`
                : 'Brak informacji';

            // Sprawdź czy są oryginalne ceny (czy był rabat)
            const hasOriginalPrices = item.original_price_netto && item.original_price_brutto;

            let priceDisplay = '';
            if (hasOriginalPrices && item.discount_percentage !== 0) {
                // Pokaż oryginalne i obecne ceny
                priceDisplay = `
                <p><strong>Cena brutto:</strong>
                        <span class="discounted-price">${item.final_price_brutto.toFixed(2)} PLN</span>
                        <span class="original-price">${item.original_price_brutto.toFixed(2)} PLN</span>
                    </p>
                    <p><strong>Cena netto:</strong> 
                        <span class="discounted-price">${item.final_price_netto.toFixed(2)} PLN</span>
                        <span class="original-price">${item.original_price_netto.toFixed(2)} PLN</span>
                    </p>
                    
                `;
            } else {
                // Pokaż zwykłe ceny
                const netto = item.final_price_netto !== null
                    ? `${item.final_price_netto.toFixed(2)} PLN`
                    : 'Brak informacji';
                const brutto = item.final_price_brutto !== null
                    ? `${item.final_price_brutto.toFixed(2)} PLN`
                    : 'Brak informacji';

                priceDisplay = `
                    <p><strong>Cena netto:</strong> ${netto}</p>
                    <p><strong>Cena brutto:</strong> ${brutto}</p>
                `;
            }

            li.innerHTML = `
                <p><strong>Wariant:</strong> ${variantName}</p>
                <p><strong>Cena za m³:</strong> ${pricePerM3}</p>
                ${priceDisplay}
            `;

            // Dodaj etykietę "Edytowane" jeśli wariant ma rabat
            if (item.has_discount && item.discount_percentage !== 0) {
                const editedBadge = document.createElement('div');
                editedBadge.className = 'edited-badge';
                editedBadge.textContent = 'Edytowane';
                li.appendChild(editedBadge);
            }

            // Dodaj informacje o rabacie jeśli istnieje
            if (item.discount_percentage !== 0) {
                const discountInfo = document.createElement('div');
                discountInfo.className = 'discount-info';
                discountInfo.innerHTML = `
                    <span class="discount-label">Rabat: ${item.discount_percentage}%</span>
                    ${item.discount_reason_id ? `<br><small>Powód: ${getDiscountReasonName(item.discount_reason_id)}</small>` : ''}
                `;
                li.appendChild(discountInfo);
            }

            // ——— 4. Wrapper na przyciski + oznaczenie ———
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'variant-actions';

            // (a) jeśli wariant nie jest wybrany → dodajemy przycisk "Ustaw jako wybrany"
            if (!item.is_selected) {
                const chooseBtn = document.createElement('button');
                chooseBtn.className = 'choose-btn';
                chooseBtn.textContent = 'Ustaw jako wybrany';
                chooseBtn.onclick = () => {
                    if (!confirm('Na pewno zmienić wybór wariantu?')) return;
                    fetch(`/quotes/api/quote_items/${item.id}/select`, { method: 'PATCH' })
                        .then(res => res.json())
                        .then(() => fetch(`/quotes/api/quotes/${quoteData.id}`))
                        .then(res => res.json())
                        .then(fullData => showDetailsModal(fullData))
                        .catch(err => console.error('[MODAL] Błąd zmiany wariantu:', err));
                };
                actionsDiv.appendChild(chooseBtn);
            }

            // (b) zawsze dodajemy oznaczenie „Wybrany wariant" do środka actionsDiv,
            //     ale tylko gdy item.is_selected === true
            if (item.is_selected) {
                const selectedTag = document.createElement('p');
                selectedTag.className = 'selected-tag';
                selectedTag.textContent = '✓ Wybrany wariant';
                actionsDiv.appendChild(selectedTag);
            }

            // (c) zawsze dopisujemy przycisk z ikoną SVG edycji
            const editBtn = document.createElement('button');
            editBtn.className = 'edit-btn';
            editBtn.innerHTML = `
                <img 
                    src="${editIconURL}" 
                    alt="Edytuj wariant"
                    title="Edytuj rabat wariantu"
                >
            `;

            // NOWA FUNKCJONALNOŚĆ: Podłączenie do modala edycji
            editBtn.onclick = () => {
                console.log('[EDIT] Kliknięto edycję wariantu:', item);
                openVariantEditModal(item, quoteData);
            };

            actionsDiv.appendChild(editBtn);

            // ——— 5. Dopinamy wrapper actionsDiv do <li> i <li> do <ul> ———
            li.appendChild(actionsDiv);
            list.appendChild(li);
        });

        tabContent.appendChild(list);
        itemsContainer.appendChild(tabContent);
    });

    // ——— 6. Obsługa przełączania zakładek ———
    tabsContainer.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const activeIdx = btn.dataset.tabIndex;
            tabsContainer.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            itemsContainer.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

            btn.classList.add('active');
            const activeContent = itemsContainer.querySelector(`.tab-content[data-tab-index='${activeIdx}']`);
            if (activeContent) {
                activeContent.style.display = 'block';
            }
        });
    });
}
function filterQuotes() {
    console.log("Filtrujemy wyceny...");

    const quoteNumber = document.getElementById("quote-number-filter")?.value?.toLowerCase() || "";
    const clientNumber = document.getElementById("client-number-filter")?.value?.toLowerCase() || "";
    const clientName = document.getElementById("client-name-filter")?.value?.toLowerCase() || "";
    const source = document.getElementById("source-filter")?.value || "";
    const employee = document.getElementById("employee-filter")?.value || "";
    const dateFrom = document.getElementById("date-from-filter")?.value;
    const dateTo = document.getElementById("date-to-filter")?.value;

    const filtered = allQuotes.filter(q => {
        const createdDate = new Date(q.created_at);
        const matchDateFrom = !dateFrom || createdDate >= new Date(dateFrom);
        const matchDateTo = !dateTo || createdDate <= new Date(dateTo);

        return (!quoteNumber || q.quote_number?.toLowerCase().startsWith(quoteNumber)) &&
            (!clientNumber || (q.client_number || "").toLowerCase().includes(clientNumber)) &&
            (!clientName || (q.client_name || "").toLowerCase().includes(clientName)) &&
            (!source || q.source === source) &&
            (!employee || q.user_id == employee) &&
            matchDateFrom &&
            matchDateTo &&
            (!activeStatus || q.status_name === activeStatus);
    });

    console.log(`[filterQuotes] Wszystkich wyników: ${filtered.length}, currentPage: ${currentPage}, resultsPerPage: ${resultsPerPage}`);
    const paginated = filtered.slice((currentPage - 1) * resultsPerPage, currentPage * resultsPerPage);

    renderQuotesTable(paginated);
    renderPagination(filtered.length);
}

function renderQuotesTable(quotes) {
    const wrapper = document.getElementById("quotes-table-body");
    const noResults = document.getElementById("no-results-message");
    wrapper.innerHTML = "";
    if (noResults) noResults.remove();

    if (quotes.length === 0) {
        const msg = document.createElement("div");
        msg.id = "no-results-message";
        msg.className = "no-results-message";
        msg.innerHTML = `<div style="text-align: center; width: 100%;">Brak pasujących wyników</div>`;
        wrapper.appendChild(msg);
        return;
    }

    quotes.forEach(quote => {
        const card = document.createElement("div");
        card.className = "quote-card";

        const statusPill = `
            <div class="quote-status-pill" style="background-color: ${quote.status_color}">
                ${quote.status_name}
            </div>
        `;

        card.innerHTML = `
            <div class="quote-field">${quote.quote_number}</div>
            <div class="quote-field">${new Date(quote.created_at).toLocaleDateString()}</div>
            <div class="quote-field">${quote.client_number || "-"}</div>
            <div class="quote-field">${quote.client_name || "-"}</div>
            <div class="quote-field">${quote.source || "-"}</div>
            <div class="quote-field">${statusPill}</div>
            <div class="quote-field">
                <button class="quotes-btn quotes-btn-detail" data-id="${quote.id}">
                    <span>Szczegóły</span>
                </button>
                <button class="quotes-btn quotes-btn-download" data-id="${quote.id}">
                    <span>Pobierz</span>
                </button>
            </div>
        `;
        wrapper.appendChild(card);
    });

    document.querySelectorAll(".quotes-btn-detail").forEach(btn => {
        btn.addEventListener("click", async e => {
            const id = e.target.closest("button").dataset.id;

            try {
                const res = await fetch(`/quotes/api/quotes/${id}`);
                if (!res.ok) throw new Error("Błąd pobierania szczegółów wyceny");
                const data = await res.json();
                showDetailsModal(data);
            } catch (err) {
                console.error("[MODAL] Błąd ładowania danych:", err);
                alert("Nie udało się załadować szczegółów wyceny.");
            }
        });
    });

    document.querySelectorAll(".quotes-btn-download").forEach(btn => {
        btn.addEventListener("click", e => {
            const id = e.target.closest("button").dataset.id;
            console.log(`Kliknięto pobierz dla ID ${id}`);
        });
    });
}

function renderStatusButton(name, count, color, isActive = false) {
    const btn = document.createElement("div");
    btn.className = "status-button";
    if (isActive) btn.classList.add("active");

    const countSpan = document.createElement("span");
    countSpan.className = "status-count";
    countSpan.textContent = count > 0 ? count : "-";

    if (color) {
        countSpan.style.backgroundColor = color;
    }

    const labelSpan = document.createElement("span");
    labelSpan.textContent = name;

    btn.appendChild(countSpan);
    btn.appendChild(labelSpan);

    btn.addEventListener("click", () => {
        document.querySelectorAll(".status-button").forEach(b => {
            b.classList.remove("active");
        });
        btn.classList.add("active");

        activeStatus = name === "Wszystkie" ? null : name;
        filterQuotes();
    });

    return btn;
}

async function initStatusPanel() {
    const statusPanel = document.getElementById("status-filters-container");
    statusPanel.innerHTML = "";

    try {
        const [counts, statuses] = await Promise.all([
            fetch("/quotes/api/quotes/status-counts").then(res => res.json()),
            fetch("/quotes/api/quotes").then(res => res.json())
        ]);

        const totalCount = counts.reduce((sum, s) => sum + s.count, 0);
        const allBtn = renderStatusButton("Wszystkie", totalCount, "#999", true);
        statusPanel.appendChild(allBtn);

        counts.forEach(status => {
            const btn = renderStatusButton(status.name, status.count, status.color);
            statusPanel.appendChild(btn);
        });
    } catch (error) {
        console.error("Błąd inicjalizacji panelu statusów:", error);
    }
}

// Event listeners dla filtrów
document.addEventListener("DOMContentLoaded", () => {
    ["quote-number-filter", "client-number-filter", "client-name-filter", "source-filter"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const evt = el.tagName === "SELECT" ? "change" : "input";
            el.addEventListener(evt, filterQuotes);
        }
    });

    ["date-from-filter", "date-to-filter", "employee-filter"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", filterQuotes);
        }
    });
});

function renderPagination(total) {
    console.log(`[renderPagination] Łącznie wyników: ${total}, resultsPerPage: ${resultsPerPage}`);

    let container = document.getElementById("pagination-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "pagination-container";
        container.className = "quotes-pagination";
        document.querySelector(".quotes-main").appendChild(container);
    }

    container.innerHTML = "";

    const totalPages = Math.ceil(total / resultsPerPage);

    // Selektor ilości wyników na stronę
    const select = document.createElement("select");
    select.className = "pagination-select";

    [20, 50, 100, 200].forEach(n => {
        const opt = document.createElement("option");
        opt.value = n;
        opt.textContent = `${n}`;
        if (n === resultsPerPage) opt.selected = true;
        select.appendChild(opt);
    });

    select.addEventListener("change", () => {
        resultsPerPage = parseInt(select.value);
        currentPage = 1;
        filterQuotes();
    });

    // Paginacja
    const pagination = document.createElement("div");
    pagination.className = "quotes-pagination";

    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement("button");
        btn.textContent = i;
        if (i === currentPage) btn.classList.add("active");
        btn.addEventListener("click", () => {
            currentPage = i;
            filterQuotes();
        });
        pagination.appendChild(btn);
    }

    container.appendChild(pagination);
    container.appendChild(select);
}

function initClearFiltersButton() {
    const btn = document.getElementById("clear-filters");
    if (!btn) {
        console.warn("Przycisk #clear-filters nie znaleziony");
        return;
    }

    btn.addEventListener("click", () => {
        ["quote-number-filter", "client-number-filter", "client-name-filter", "source-filter", "employee-filter"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

        document.getElementById("date-from-filter").value = "";
        document.getElementById("date-to-filter").value = "";

        document.querySelectorAll(".status-button").forEach(btn => btn.classList.remove("active"));
        activeStatus = null;

        filterQuotes();
        updateClearFiltersButtonState();
    });

    // Event listeners dla aktualizacji stanu przycisku
    ["quote-number-filter", "client-number-filter", "client-name-filter", "source-filter", "employee-filter", "date-from-filter", "date-to-filter"]
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener("input", updateClearFiltersButtonState);
                el.addEventListener("change", updateClearFiltersButtonState);
            }
        });
}

function updateClearFiltersButtonState() {
    const filters = [
        "quote-number-filter", "client-number-filter", "client-name-filter",
        "source-filter", "employee-filter", "date-from-filter", "date-to-filter"
    ];

    const anyActive = filters.some(id => {
        const el = document.getElementById(id);
        return el && el.value !== "";
    });

    const btn = document.getElementById("clear-filters");
    if (!btn) return;

    if (anyActive || activeStatus !== null) {
        btn.classList.remove("hidden");
        btn.classList.add("active");
    } else {
        btn.classList.remove("active");
        btn.classList.add("hidden");
    }
}

function renderSelectedSummary(groupedItems, container) {
    container.innerHTML = "";
    Object.keys(groupedItems).forEach((index, idx) => {
        const selected = groupedItems[index].find(i => i.is_selected) || groupedItems[index][0];
        if (!selected) return;

        const variant = translateVariantCode(selected.variant_code) || "Nieznany wariant";
        const dims = `${selected.length_cm}×${selected.width_cm}×${selected.thickness_cm} cm`;
        const price = selected.final_price_brutto ? `${selected.final_price_brutto.toFixed(2)} PLN brutto` : '-';
        const net = selected.final_price_netto ? `${selected.final_price_netto.toFixed(2)} PLN netto` : '-';

        const p = document.createElement("p");
        p.className = "selected-summary-item";
        p.innerHTML = `<span class='dot'></span><span style="font-size: 14px; font-weight: 600;">Produkt ${parseInt(index)}:</span><span style="font-size: 12px; font-weight: 400;"> ${variant} ${dims} • ${price} • ${net}</span>`;
        container.appendChild(p);
    });
}

function renderVariantSummary(groupedItemsForIndex, quoteData, productIndex) {
    const item = groupedItemsForIndex.find(i => i.is_selected) || groupedItemsForIndex[0];
    if (!item) return null;

    const wrap = document.createElement('div');
    wrap.className = 'variant-summary-header';

    const dims = `${item.length_cm} × ${item.width_cm} × ${item.thickness_cm} cm`;
    const volume = item.volume_m3 ? `${item.volume_m3.toFixed(3)} m³` : '-';

    const finishing = (quoteData.finishing || []).find(f => f.product_index == productIndex);
    let finishingHTML = '';

    if (finishing) {
        // Nowa kolejność: variant - type - color - gloss
        const finishingParts = [
            finishing.variant,
            finishing.type,
            finishing.color,
            finishing.gloss
        ].filter(Boolean);

        const finishingDisplay = finishingParts.length > 0 ? finishingParts.join(' - ') : 'Brak wykończenia';
        const brutto = finishing.brutto?.toFixed(2) || '0.00';
        const netto = finishing.netto?.toFixed(2) || '0.00';

        finishingHTML = `
            <div>
                <strong>Wykończenie:</strong> ${finishingDisplay}
            </div>
            <div>
                <strong>Koszt wykończenia:</strong> 
                <span>${brutto} PLN</span>
                <span class="cost-netto">${netto} PLN</span>
            </div>
        `;
    } else {
        finishingHTML = `
            <div><strong>Wykończenie:</strong> Brak wykończenia</div>
            <div>
                <strong>Koszt wykończenia:</strong> 
                <span>0.00 PLN</span>
                <span class="cost-netto">0.00 PLN</span>
            </div>
        `;
    }

    wrap.innerHTML = `
        <div><strong>Wymiary:</strong> ${dims}</div>
        ${finishingHTML}
        <div><strong>Objętość:</strong> ${volume}</div>
    `;

    return wrap;
}

function translateVariantCode(code) {
    const dict = {
        'dab-lity-ab': 'Dąb lity A/B',
        'dab-lity-bb': 'Dąb lity B/B',
        'dab-micro-ab': 'Dąb mikrowczep A/B',
        'dab-micro-bb': 'Dąb mikrowczep B/B',
        'jes-lity-ab': 'Jesion lity A/B',
        'jes-micro-ab': 'Jesion mikrowczep A/B',
        'buk-lity-ab': 'Buk lity A/B',
        'buk-micro-ab': 'Buk mikrowczep A/B'
    };
    return dict[code] || code || 'Nieznany wariant';
}

// Pobieranie powodów rabatów z API
async function fetchDiscountReasons() {
    try {
        const response = await fetch('/quotes/api/discount-reasons');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Sprawdź czy response zawiera błąd
        if (data.error) {
            console.error("[fetchDiscountReasons] Błąd z API:", data.error);
            discountReasons = [];
            return;
        }

        // Sprawdź czy data jest tablicą
        if (!Array.isArray(data)) {
            console.error("[fetchDiscountReasons] Nieprawidłowy format danych - oczekiwano tablicy:", data);
            discountReasons = [];
            return;
        }

        discountReasons = data;
        console.log("[fetchDiscountReasons] Pobrano powody rabatów:", discountReasons);

    } catch (error) {
        console.error("[fetchDiscountReasons] Błąd pobierania powodów rabatów:", error);
        discountReasons = [];
    }
}

// Konfiguracja modala edycji wariantu
function setupVariantEditModal() {
    const modal = document.getElementById('edit-variant-modal');
    const closeBtn = document.getElementById('close-edit-variant-modal');
    const saveBtn = document.getElementById('save-variant-changes');
    const cancelBtn = document.getElementById('cancel-variant-changes');
    const discountInput = document.getElementById('discount-percentage');

    if (!modal) return;

    // Zamykanie modala
    closeBtn?.addEventListener('click', () => closeVariantEditModal());
    cancelBtn?.addEventListener('click', () => closeVariantEditModal());

    // Zapisywanie zmian
    saveBtn?.addEventListener('click', () => saveVariantChanges());

    // Live preview cen podczas wpisywania rabatu
    discountInput?.addEventListener('input', () => updatePricePreview());

    // Zamykanie przez kliknięcie tła
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeVariantEditModal();
        }
    });
}

// Konfiguracja modala rabatu całkowitego
function setupTotalDiscountModal() {
    const modal = document.getElementById('edit-total-discount-modal');
    const closeBtn = document.getElementById('close-edit-total-discount-modal');
    const saveBtn = document.getElementById('save-total-discount');
    const cancelBtn = document.getElementById('cancel-total-discount');
    const discountInput = document.getElementById('total-discount-percentage');
    const finishingCheckbox = document.getElementById('include-finishing-discount');

    if (!modal) return;

    // Zamykanie modala
    closeBtn?.addEventListener('click', () => closeTotalDiscountModal());
    cancelBtn?.addEventListener('click', () => closeTotalDiscountModal());

    // Zapisywanie zmian
    saveBtn?.addEventListener('click', () => saveTotalDiscount());

    // Live preview cen
    discountInput?.addEventListener('input', () => updateTotalPricePreview());
    finishingCheckbox?.addEventListener('change', () => updateTotalPricePreview());

    // Zamykanie przez kliknięcie tła
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeTotalDiscountModal();
        }
    });
}

// Otwieranie modala edycji wariantu
function openVariantEditModal(item, quoteData) {
    console.log("[openVariantEditModal] Otwieranie modala dla wariantu:", item);

    currentEditingItem = item;
    currentQuoteData = quoteData;

    // Zapisz oryginalne ceny
    originalPrices = {
        netto: item.original_price_netto || item.final_price_netto,
        brutto: item.original_price_brutto || item.final_price_brutto
    };

    // Wypełnij informacje o wariancie
    document.getElementById('edit-variant-name').textContent = translateVariantCode(item.variant_code);
    document.getElementById('edit-variant-dimensions').textContent = `${item.length_cm}×${item.width_cm}×${item.thickness_cm} cm`;
    document.getElementById('edit-variant-volume').textContent = `${item.volume_m3?.toFixed(3) || '0.000'} m³`;

    // Wypełnij formularz
    document.getElementById('discount-percentage').value = item.discount_percentage || 0;
    document.getElementById('show-on-client-page').checked = item.show_on_client_page !== false;

    // Wypełnij dropdown powodów
    populateDiscountReasons('discount-reason', item.discount_reason_id);

    // Aktualizuj podgląd cen
    updatePricePreview();

    // Pokaż modal
    const modal = document.getElementById('edit-variant-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
}

// Otwieranie modala rabatu całkowitego
function openTotalDiscountModal(quoteData) {
    console.log("[openTotalDiscountModal] Otwieranie modala rabatu całkowitego");

    currentQuoteData = quoteData;

    // Teraz bierzemy pod uwagę WSZYSTKIE pozycje (warianty) w wycenie, a nie tylko te z is_selected
    const allItems = quoteData.items;

    // Grupujemy po product_index, żeby zobaczyć, ile unikalnych produktów w wycenie
    const allProductsCount = [...new Set(allItems.map(item => item.product_index))].length;

    console.log(`[openTotalDiscountModal] Wszystkich wariantów: ${allItems.length}, Unikalnych produktów: ${allProductsCount}`);

    // Wypełnij podstawowe informacje w modalu
    document.getElementById('total-quote-number').textContent = quoteData.quote_number;
    // Pokazujemy, że liczymy rabat od wszystkich produktów (np. "3 z 3")
    document.getElementById('total-products-count').textContent = `${allProductsCount} z ${allProductsCount}`;

    // Jeżeli w HTML jest element służący do ostrzeżenia o niewybranych wariantach,
    // teraz go ukrywamy, bo robimy rabat na wszystkie.
    const warningBox = document.getElementById('products-selection-warning');
    if (warningBox) {
        warningBox.style.display = 'none';
    }

    // Oblicz oryginalną wartość BRUTTO dla wszystkich wariantów:
    const originalValue = allItems.reduce((sum, item) => {
        // Jeśli item.original_price_brutto jest undefined, użyjemy item.final_price_brutto
        return sum + (item.original_price_brutto || item.final_price_brutto || 0);
    }, 0);

    document.getElementById('total-original-value').textContent = `${originalValue.toFixed(2)} PLN`;

    // Zerujemy pole procentu rabatu
    document.getElementById('total-discount-percentage').value = 0;

    // Wypełnij dropdown powodów (jak dotychczas)
    populateDiscountReasons('total-discount-reason');

    // Wywołaj updateTotalPricePreview(), aby uaktualnić podgląd
    updateTotalPricePreview();

    // Pokaż modal
    const modal = document.getElementById('edit-total-discount-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
}


// Wypełnianie dropdown powodów rabatu
function populateDiscountReasons(selectId, selectedReasonId = null) {
    const select = document.getElementById(selectId);
    if (!select) {
        console.warn(`[populateDiscountReasons] Element #${selectId} nie znaleziony`);
        return;
    }

    // Wyczyść opcje
    select.innerHTML = '<option value="">Wybierz powód...</option>';

    // Sprawdź czy discountReasons jest tablicą
    if (!Array.isArray(discountReasons)) {
        console.warn("[populateDiscountReasons] discountReasons nie jest tablicą:", discountReasons);

        // Dodaj opcję informującą o błędzie
        const errorOption = document.createElement('option');
        errorOption.value = '';
        errorOption.textContent = 'Błąd ładowania powodów rabatów';
        errorOption.disabled = true;
        select.appendChild(errorOption);
        return;
    }

    // Sprawdź czy mamy powody rabatów
    if (discountReasons.length === 0) {
        const noDataOption = document.createElement('option');
        noDataOption.value = '';
        noDataOption.textContent = 'Brak dostępnych powodów';
        noDataOption.disabled = true;
        select.appendChild(noDataOption);
        return;
    }

    // Dodaj powody rabatów
    discountReasons.forEach(reason => {
        if (!reason || typeof reason !== 'object') {
            console.warn("[populateDiscountReasons] Nieprawidłowy obiekt powodu:", reason);
            return;
        }

        const option = document.createElement('option');
        option.value = reason.id || '';
        option.textContent = reason.name || 'Nieznany powód';

        if (reason.id === selectedReasonId) {
            option.selected = true;
        }

        select.appendChild(option);
    });
}

// Aktualizacja podglądu cen dla pojedynczego wariantu
function updatePricePreview() {
    const discountPercentage = parseFloat(document.getElementById('discount-percentage').value) || 0;

    const originalNetto = originalPrices.netto || 0;
    const originalBrutto = originalPrices.brutto || 0;

    const discountMultiplier = 1 - (discountPercentage / 100);
    const finalNetto = originalNetto * discountMultiplier;
    const finalBrutto = originalBrutto * discountMultiplier;

    // Aktualizuj wyświetlanie
    document.getElementById('original-price-netto').textContent = `${originalNetto.toFixed(2)} PLN`;
    document.getElementById('original-price-brutto').textContent = `${originalBrutto.toFixed(2)} PLN`;
    document.getElementById('final-price-netto').textContent = `${finalNetto.toFixed(2)} PLN`;
    document.getElementById('final-price-brutto').textContent = `${finalBrutto.toFixed(2)} PLN`;

    // Pokaż/ukryj różnicę
    const discountAmount = document.getElementById('discount-amount');
    const discountValue = document.getElementById('discount-value');

    if (discountPercentage !== 0) {
        const difference = originalBrutto - finalBrutto;
        discountValue.textContent = `${Math.abs(difference).toFixed(2)} PLN ${difference >= 0 ? '(oszczędność)' : '(dopłata)'}`;
        discountAmount.style.display = 'block';
    } else {
        discountAmount.style.display = 'none';
    }
}

// Aktualizacja podglądu cen dla rabatu całkowitego
function updateTotalPricePreview() {
    const discountPercentage = parseFloat(document.getElementById('total-discount-percentage').value) || 0;
    const includeFinishing = document.getElementById('include-finishing-discount').checked;

    if (!currentQuoteData) return;

    // **Użyj wszystkich pozycji, nie tylko is_selected**
    const allItems = currentQuoteData.items;

    // Oblicz oryginalne wartości NETTO i BRUTTO dla wszystkich produktów:
    const originalNetto = allItems.reduce((sum, item) => {
        return sum + (item.original_price_netto || item.final_price_netto || 0);
    }, 0);

    const originalBrutto = allItems.reduce((sum, item) => {
        return sum + (item.original_price_brutto || item.final_price_brutto || 0);
    }, 0);

    const discountMultiplier = 1 - (discountPercentage / 100);
    const finalNetto = originalNetto * discountMultiplier;
    const finalBrutto = originalBrutto * discountMultiplier;

    document.getElementById('total-original-products-netto').textContent = `${originalNetto.toFixed(2)} PLN`;
    document.getElementById('total-original-products-brutto').textContent = `${originalBrutto.toFixed(2)} PLN`;
    document.getElementById('total-final-products-netto').textContent = `${finalNetto.toFixed(2)} PLN`;
    document.getElementById('total-final-products-brutto').textContent = `${finalBrutto.toFixed(2)} PLN`;

    // Wykończenie - z rabatem lub bez, w zależności od checkboxa
    let finishingCost = currentQuoteData.costs?.finishing?.brutto || 0;
    if (includeFinishing && discountPercentage !== 0) {
        finishingCost = finishingCost * discountMultiplier;
    }

    // Wysyłka ZAWSZE bez rabatu
    const shippingCost = currentQuoteData.costs?.shipping?.brutto || 0;

    // Suma końcowa
    const totalFinal = finalBrutto + finishingCost + shippingCost;

    document.getElementById('total-finishing-cost').textContent = `${finishingCost.toFixed(2)} PLN`;
    document.getElementById('total-shipping-cost').textContent = `${shippingCost.toFixed(2)} PLN`;
    document.getElementById('total-final-value').textContent = `${totalFinal.toFixed(2)} PLN`;

    // Pokaż/ukryj oszczędności - tylko na produktach
    const discountAmount = document.getElementById('total-discount-amount');
    const discountValue = document.getElementById('total-discount-value');

    if (discountPercentage !== 0) {
        let totalSavings = originalBrutto - finalBrutto;

        // Dodaj oszczędności z wykończenia jeśli jest checkbox
        if (includeFinishing) {
            const originalFinishing = currentQuoteData.costs?.finishing?.brutto || 0;
            const finishingSavings = originalFinishing - finishingCost;
            totalSavings += finishingSavings;
        }

        discountValue.textContent = `${Math.abs(totalSavings).toFixed(2)} PLN ${totalSavings >= 0 ? '(oszczędność)' : '(dopłata)'}`;
        discountAmount.style.display = 'block';
    } else {
        discountAmount.style.display = 'none';
    }
}

// Zapisywanie zmian wariantu
async function saveVariantChanges() {
    if (!currentEditingItem || !currentQuoteData) return;

    const saveBtn = document.getElementById('save-variant-changes');
    const discountPercentage = parseFloat(document.getElementById('discount-percentage').value) || 0;
    const reasonId = document.getElementById('discount-reason').value || null;
    const showOnClientPage = document.getElementById('show-on-client-page').checked;

    // Walidacja
    if (Math.abs(discountPercentage) > 100) {
        showToast('Rabat nie może być większy niż 100% lub mniejszy niż -100%', 'error');
        return;
    }

    // Disable przycisk i pokaż loading
    saveBtn.disabled = true;
    saveBtn.querySelector('.btn-text').style.display = 'none';
    saveBtn.querySelector('.btn-loading').style.display = 'inline';

    try {
        const response = await fetch(`/quotes/api/quotes/${currentQuoteData.id}/variant/${currentEditingItem.id}/discount`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                discount_percentage: discountPercentage,
                reason_id: reasonId,
                show_on_client_page: showOnClientPage
            })
        });

        if (!response.ok) {
            throw new Error('Błąd podczas zapisywania zmian');
        }

        const result = await response.json();
        console.log("[saveVariantChanges] Zapisano zmiany:", result);

        // Zamknij modal
        closeVariantEditModal();

        // Odśwież modal szczegółów wyceny
        refreshQuoteDetailsModal();

        // Pokaż toast sukcesu
        showToast('Zmiany zostały zapisane pomyślnie', 'success');

    } catch (error) {
        console.error("[saveVariantChanges] Błąd:", error);
        showToast('Błąd podczas zapisywania zmian', 'error');
    } finally {
        // Przywróć przycisk
        saveBtn.disabled = false;
        saveBtn.querySelector('.btn-text').style.display = 'inline';
        saveBtn.querySelector('.btn-loading').style.display = 'none';
    }
}

// Zapisywanie rabatu całkowitego
async function saveTotalDiscount() {
    if (!currentQuoteData) {
        console.error("[saveTotalDiscount] Brak currentQuoteData");
        return;
    }

    const saveBtn = document.getElementById('save-total-discount');
    const discountPercentage = parseFloat(document.getElementById('total-discount-percentage').value) || 0;
    const reasonId = document.getElementById('total-discount-reason').value || null;
    const includeFinishing = document.getElementById('include-finishing-discount').checked;

    // DODAJ logowanie aby sprawdzić ID wyceny
    console.log(`[saveTotalDiscount] Zapisuję rabat dla wyceny ID: ${currentQuoteData.id} (${currentQuoteData.quote_number})`);

    // Walidacja
    if (Math.abs(discountPercentage) > 100) {
        showToast('Rabat nie może być większy niż 100% lub mniejszy niż -100%', 'error');
        return;
    }

    if (discountPercentage !== 0 && !reasonId) {
        showToast('Wybierz powód zmiany ceny', 'warning');
        return;
    }

    // Confirm action
    let confirmMessage = `Na pewno zastosować rabat ${discountPercentage}% do wszystkich produktów w wycenie ${currentQuoteData.quote_number}?`;
    if (includeFinishing) {
        confirmMessage += '\n\nRabat zostanie również zastosowany do wykończenia.';
    }

    if (!confirm(confirmMessage)) {
        return;
    }

    // Disable przycisk i pokaż loading
    saveBtn.disabled = true;
    saveBtn.querySelector('.btn-text').style.display = 'none';
    saveBtn.querySelector('.btn-loading').style.display = 'inline';

    try {
        const response = await fetch(`/quotes/api/quotes/${currentQuoteData.id}/apply-total-discount`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                discount_percentage: discountPercentage,
                reason_id: reasonId,
                include_finishing: includeFinishing
            })
        });

        if (!response.ok) {
            throw new Error('Błąd podczas stosowania rabatu');
        }

        const result = await response.json();
        console.log("[saveTotalDiscount] Zastosowano rabat:", result);

        // Zamknij modal
        closeTotalDiscountModal();

        // UPEWNIJ SIĘ, że odświeżamy tę samą wycenę
        await refreshQuoteDetailsModal();

        // Pokaż toast sukcesu
        let message = `Rabat został zastosowany do ${result.affected_items} pozycji`;
        if (includeFinishing) {
            message += ' (włącznie z wykończeniem)';
        }
        showToast(message, 'success');

    } catch (error) {
        console.error("[saveTotalDiscount] Błąd:", error);
        showToast('Błąd podczas stosowania rabatu', 'error');
    } finally {
        // Przywróć przycisk
        saveBtn.disabled = false;
        saveBtn.querySelector('.btn-text').style.display = 'inline';
        saveBtn.querySelector('.btn-loading').style.display = 'none';
    }
}

// Zamykanie modala edycji wariantu
function closeVariantEditModal() {
    const modal = document.getElementById('edit-variant-modal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        currentEditingItem = null;
    }, 300);
}

// Zamykanie modala rabatu całkowitego
function closeTotalDiscountModal() {
    const modal = document.getElementById('edit-total-discount-modal');
    modal.classList.remove('active');
    setTimeout(() => {
        modal.style.display = 'none';
        currentQuoteData = null;
    }, 300);
}

// Odświeżanie modala szczegółów wyceny
async function refreshQuoteDetailsModal() {
    // SPRAWDŹ czy currentQuoteData jest ustawiona prawidłowo
    if (!currentQuoteData || !currentQuoteData.id) {
        console.error("[refreshQuoteDetailsModal] Brak currentQuoteData lub currentQuoteData.id");
        return;
    }

    const quoteId = currentQuoteData.id;
    console.log(`[refreshQuoteDetailsModal] Odświeżam modal dla wyceny ID: ${quoteId}`);

    try {
        const response = await fetch(`/quotes/api/quotes/${quoteId}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const updatedData = await response.json();

        // UPEWNIJ SIĘ, że odświeżamy ten sam modal
        console.log(`[refreshQuoteDetailsModal] Otrzymano dane dla wyceny: ${updatedData.quote_number}`);

        // Aktualizuj currentQuoteData
        currentQuoteData = updatedData;

        showDetailsModal(updatedData);

    } catch (error) {
        console.error("[refreshQuoteDetailsModal] Błąd:", error);
        showToast('Błąd podczas odświeżania danych wyceny', 'error');
    }
}

// Funkcja toast notifications
function showToast(message, type = 'success') {
    // Usuń istniejące toasty
    const existingToasts = document.querySelectorAll('.toast-notification');
    existingToasts.forEach(toast => toast.remove());

    // Utwórz nowy toast
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    // Pokaż toast
    setTimeout(() => toast.classList.add('show'), 100);

    // Ukryj toast po 3 sekundach
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Funkcja do pobierania nazwy powodu rabatu
function getDiscountReasonName(reasonId) {
    if (!reasonId || !discountReasons.length) return 'Nie podano';

    const reason = discountReasons.find(r => r.id === reasonId);
    return reason ? reason.name : 'Nieznany powód';
}

// Funkcja dodawania przycisku rabatu całkowitego
function addTotalDiscountButton(quoteData) {
    // Sprawdź czy przycisk już istnieje
    let totalDiscountBtn = document.getElementById('total-discount-btn');

    if (!totalDiscountBtn) {
        // Znajdź kontener dla przycisków w headerze
        const headerActions = document.querySelector('.quotes-details-modal-header-actions');

        if (headerActions) {
            // Utwórz przycisk
            totalDiscountBtn = document.createElement('button');
            totalDiscountBtn.id = 'total-discount-btn';
            totalDiscountBtn.className = 'quotes-btn total-discount-btn';
            totalDiscountBtn.innerHTML = '<span>Rabat całkowity</span>';
            totalDiscountBtn.title = 'Zastosuj rabat do wszystkich produktów';

            // Dodaj event listener
            totalDiscountBtn.onclick = () => {
                console.log('[TOTAL DISCOUNT] Otwieranie modala rabatu całkowitego');
                openTotalDiscountModal(quoteData);
            };

            // Wstaw przycisk przed przyciskiem "Pełny ekran"
            const fullscreenBtn = document.getElementById('toggle-fullscreen-modal');
            if (fullscreenBtn) {
                headerActions.insertBefore(totalDiscountBtn, fullscreenBtn);
            } else {
                headerActions.appendChild(totalDiscountBtn);
            }
        }
    }
}