/**
 * Quote Editor - Edycja wycen w module quotes
 * Wykorzystuje logikę z modułu calculator
 */

// Globalne zmienne
let currentEditingQuoteData = null;
let activeProductIndex = null;
let clientTypesCache = null;


/**
 * Otwiera modal edycji wyceny
 * @param {Object} quoteData - Dane wyceny do edycji
 */
async function openQuoteEditor(quoteData) {
    console.log('[QUOTE EDITOR] ===== OTWIERANIE EDYTORA WYCENY =====');
    console.log('[QUOTE EDITOR] Dane wyceny:', quoteData);

    if (!quoteData || !quoteData.id) {
        console.error('[QUOTE EDITOR] ❌ BŁĄD: Brak danych wyceny do edycji');
        alert('Błąd: Brak danych wyceny do edycji');
        return;
    }

    if (!canEditQuote(quoteData)) {
        console.warn('[QUOTE EDITOR] ⚠️ Wycena nie może być edytowana');
        alert('Ta wycena nie może być edytowana (status: ' + (quoteData.status_name || 'nieznany') + ')');
        return;
    }

    // Zapisz dane globalnie
    currentEditingQuoteData = quoteData;
    console.log('[QUOTE EDITOR] ✅ Zapisano dane wyceny do zmiennej globalnej');

    // Otwórz modal
    const modal = document.getElementById('quote-editor-modal');
    if (!modal) {
        console.error('[QUOTE EDITOR] ❌ BŁĄD: Nie znaleziono modalu edytora (#quote-editor-modal)');
        return;
    }

    console.log('[QUOTE EDITOR] ✅ Modal edytora znaleziony');

    // Wypełnij podstawowe dane w headerze
    const quoteNumberEl = document.getElementById('edit-quote-number');
    const clientNameEl = document.getElementById('edit-client-name');

    if (quoteNumberEl) {
        quoteNumberEl.textContent = 'Wycena: ' + (quoteData.quote_number || 'N/A');
        console.log('[QUOTE EDITOR] ✅ Ustawiono numer wyceny:', quoteData.quote_number);
    }

    if (clientNameEl) {
        const clientName = quoteData.client?.client_name || quoteData.client?.client_number || 'N/A';
        clientNameEl.textContent = 'Klient: ' + clientName;
        console.log('[QUOTE EDITOR] ✅ Ustawiono nazwę klienta:', clientName);
    }

    // Stwórz strukturę wariantów
    console.log('[QUOTE EDITOR] Tworzenie struktury wariantów...');
    createVariantsStructure();

    // Pokaż modal PRZED ładowaniem danych (żeby użytkownik widział że coś się dzieje)
    modal.style.display = 'flex';
    console.log('[QUOTE EDITOR] ✅ Modal wyświetlony');

    try {
        // ZAŁADUJ GRUPY CENOWE Z BAZY DANYCH (async)
        console.log('[QUOTE EDITOR] Rozpoczynam ładowanie grup cenowych...');
        await loadClientTypesFromDatabase();

        // Po załadowaniu grup cenowych, załaduj dane z wyceny
        console.log('[QUOTE EDITOR] Rozpoczynam ładowanie danych wyceny...');
        loadQuoteDataToEditor(quoteData);

        // Dodaj event listenery
        console.log('[QUOTE EDITOR] Dodaję event listenery...');
        attachEditorFormListeners();

        console.log('[QUOTE EDITOR] ✅ Wszystkie dane załadowane pomyślnie');

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ BŁĄD podczas ładowania danych:', error);
        // Modal pozostaje otwarty, ale użytkownik zobaczy błąd w konsoli
    }

    // Dodaj obsługę zamykania
    setupModalCloseHandlers();

    console.log('[QUOTE EDITOR] ===== EDYTOR WYCENY OTWARTY =====');
}

/**
 * DODATKOWA funkcja do synchronizacji wartości mnożnika
 * Wywołaj ją gdy użytkownik zmieni grupę cenową
 */
function onClientTypeChange() {
    const clientTypeSelect = document.getElementById('edit-clientType');
    if (!clientTypeSelect) return;

    const selectedOption = clientTypeSelect.options[clientTypeSelect.selectedIndex];
    if (!selectedOption) return;

    const multiplierValue = selectedOption.dataset.multiplierValue;
    const clientType = selectedOption.value;

    console.log(`[QUOTE EDITOR] 🔄 ZMIANA GRUPY CENOWEJ: ${clientType} (mnożnik: ${multiplierValue})`);

    // TODO: Tutaj można dodać logikę przeliczania cen na podstawie nowego mnożnika
    onFormDataChange();
}

/**
 * Konfiguruje obsługę zamykania modalu
 */
function setupModalCloseHandlers() {
    const modal = document.getElementById('quote-editor-modal');
    const closeBtn = document.getElementById('close-quote-editor');
    const cancelBtn = document.getElementById('cancel-quote-edit');

    // Zamknij przez X
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
            currentEditingQuoteData = null;
            activeProductIndex = null;
        };
    }

    // Zamknij przez Anuluj
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            currentEditingQuoteData = null;
            activeProductIndex = null;
        };
    }

    // Zamknij przez kliknięcie w tło
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            currentEditingQuoteData = null;
            activeProductIndex = null;
        }
    };
}

/**
 * Sprawdza czy wycena może być edytowana
 * @param {Object} quoteData - Dane wyceny
 * @returns {boolean}
 */
function canEditQuote(quoteData) {
    // Lista statusów uniemożliwiających edycję
    const nonEditableStatuses = [
        'Zaakceptowane',
        'Zamówione',
        'Zrealizowane',
        'Anulowane'
    ];

    const currentStatus = quoteData.status_name;

    // Sprawdź status
    if (nonEditableStatuses.includes(currentStatus)) {
        console.warn('[QUOTE EDITOR] Wycena ma status uniemożliwiający edycję:', currentStatus);
        return false;
    }

    // Sprawdź czy nie została już zaakceptowana przez klienta
    if (quoteData.accepted_by_email && quoteData.acceptance_date) {
        console.warn('[QUOTE EDITOR] Wycena została już zaakceptowana przez klienta');
        return false;
    }

    return true;
}

/**
 * Tworzy podstawową strukturę wariantów w edytorze
 */
function createVariantsStructure() {
    const variantsContainer = document.getElementById('edit-variants');
    if (!variantsContainer) return;

    // Header wariantów
    const header = document.createElement('div');
    header.className = 'variants-header';
    header.innerHTML = `
        <span class="header-availability">Dostępny</span>
        <span class="header-title">Wariant</span>
        <span class="header-unit-brutto">Cena brutto</span>
        <span class="header-unit-netto">Cena netto</span>
        <span class="header-total-brutto">Wartość brutto</span>
        <span class="header-total-netto">Wartość netto</span>
    `;

    // Podstawowe warianty
    const variants = [
        { code: 'dab-lity-ab', name: 'Dąb lity A/B' },
        { code: 'dab-lity-bb', name: 'Dąb lity B/B' },
        { code: 'dab-micro-ab', name: 'Dąb mikrowczep A/B' },
        { code: 'dab-micro-bb', name: 'Dąb mikrowczep B/B' },
        { code: 'jes-lity-ab', name: 'Jesion lity A/B' },
        { code: 'jes-micro-ab', name: 'Jesion mikrowczep A/B' },
        { code: 'buk-lity-ab', name: 'Buk lity A/B' },
        { code: 'buk-micro-ab', name: 'Buk mikrowczep A/B' }
    ];

    variantsContainer.innerHTML = '';
    variantsContainer.appendChild(header);

    variants.forEach((variant, index) => {
        const variantRow = document.createElement('div');
        variantRow.className = 'variant-option';
        variantRow.innerHTML = `
            <input type="checkbox" class="variant-availability-checkbox" checked>
            <input type="radio" name="edit-variantOption" id="edit-variant-${index}" value="${variant.code}" data-variant-name="${variant.name}">
            <label for="edit-variant-${index}" class="option-title">${variant.name}</label>
            <span class="unit-brutto">---.-- PLN</span>
            <span class="unit-netto">---.-- PLN</span>
            <span class="total-brutto">---.-- PLN</span>
            <span class="total-netto">---.-- PLN</span>
        `;

        variantsContainer.appendChild(variantRow);
    });
}

/**
 * Ładuje dane z wyceny do formularza edytora
 * @param {Object} quoteData - Dane wyceny
 */
function loadQuoteDataToEditor(quoteData) {
    console.log('[QUOTE EDITOR] Ładowanie danych do edytora:', quoteData);

    // 1. ZAŁADUJ GRUPĘ CENOWĄ
    if (quoteData.quote_client_type) {
        const clientTypeSelect = document.getElementById('edit-clientType');
        if (clientTypeSelect) {
            clientTypeSelect.value = quoteData.quote_client_type;
            console.log('[QUOTE EDITOR] Załadowano grupę cenową:', quoteData.quote_client_type);
        }
    }

    // 2. ZAŁADUJ PIERWSZY PRODUKT (jeśli istnieje) - POPRAWIONE
    if (quoteData.items && quoteData.items.length > 0) {
        // Znajdź pierwszy produkt (product_index = 0 lub najmniejszy)
        const sortedItems = quoteData.items.sort((a, b) => a.product_index - b.product_index);
        const firstItem = sortedItems[0];

        if (firstItem) {
            console.log('[QUOTE EDITOR] Ładuję dane pierwszego produktu:', firstItem);

            // Wymiary - SPRAWDŹ CZY ELEMENTY ISTNIEJĄ
            const lengthInput = document.getElementById('edit-length');
            const widthInput = document.getElementById('edit-width');
            const thicknessInput = document.getElementById('edit-thickness');
            const quantityInput = document.getElementById('edit-quantity');

            if (lengthInput) lengthInput.value = firstItem.length_cm || '';
            if (widthInput) widthInput.value = firstItem.width_cm || '';
            if (thicknessInput) thicknessInput.value = firstItem.thickness_cm || '';
            if (quantityInput) quantityInput.value = firstItem.quantity || 1;

            console.log('[QUOTE EDITOR] Załadowano wymiary:', {
                length: firstItem.length_cm,
                width: firstItem.width_cm,
                thickness: firstItem.thickness_cm,
                quantity: firstItem.quantity
            });

            // Wybierz wariant w radio buttons - POPRAWIONE WYSZUKIWANIE
            if (firstItem.variant_code) {
                // Spróbuj znaleźć radio button na różne sposoby
                let radioButton = document.querySelector(`input[name="edit-variantOption"][value="${firstItem.variant_code}"]`);

                if (!radioButton) {
                    // Fallback - znajdź po części nazwy
                    radioButton = document.querySelector(`input[name="edit-variantOption"][value*="${firstItem.variant_code.replace('-', '')}"]`);
                }

                if (radioButton) {
                    radioButton.checked = true;
                    console.log('[QUOTE EDITOR] Wybrano wariant:', firstItem.variant_code);
                } else {
                    console.warn('[QUOTE EDITOR] Nie znaleziono radio button dla wariantu:', firstItem.variant_code);

                    // DEBUG: pokaż dostępne radio buttony
                    const allRadios = document.querySelectorAll('input[name="edit-variantOption"]');
                    console.log('[QUOTE EDITOR] Dostępne warianty:', Array.from(allRadios).map(r => r.value));
                }
            }

            // Ustaw aktywny produkt
            activeProductIndex = firstItem.product_index;
        }
    }

    // 3. ZAŁADUJ WSZYSTKIE PRODUKTY DO SEKCJI "PRODUKTY W WYCENIE"
    loadProductsToEditor(quoteData);

    // 4. ZAŁADUJ DANE DOSTAWY
    if (quoteData.courier_name) {
        const courierElement = document.getElementById('edit-courier-name');
        if (courierElement) {
            courierElement.textContent = quoteData.courier_name;
        }
    }

    // 5. ZAŁADUJ KOSZTY (jako podgląd)
    loadCostsToSummary(quoteData);
}

/**
 * Ładuje koszty do sekcji podsumowania - POPRAWIONE FORMATOWANIE
 */
function loadCostsToSummary(quoteData) {
    console.log('[QUOTE EDITOR] Ładowanie kosztów do podsumowania...');
    const costs = quoteData.costs;
    if (!costs) {
        console.warn('[QUOTE EDITOR] Brak danych kosztów');
        return;
    }

    // Koszt surowego
    const orderBruttoEl = document.querySelector('.edit-order-brutto');
    const orderNettoEl = document.querySelector('.edit-order-netto');
    if (orderBruttoEl) orderBruttoEl.textContent = `${costs.products.brutto.toFixed(2)} PLN`;
    if (orderNettoEl) orderNettoEl.textContent = `${costs.products.netto.toFixed(2)} PLN netto`;

    // Koszty wykończenia
    const finishingBruttoEl = document.querySelector('.edit-finishing-brutto');
    const finishingNettoEl = document.querySelector('.edit-finishing-netto');
    if (finishingBruttoEl) finishingBruttoEl.textContent = `${costs.finishing.brutto.toFixed(2)} PLN`;
    if (finishingNettoEl) finishingNettoEl.textContent = `${costs.finishing.netto.toFixed(2)} PLN netto`;

    // Koszt wysyłki
    const deliveryBruttoEl = document.querySelector('.edit-delivery-brutto');
    const deliveryNettoEl = document.querySelector('.edit-delivery-netto');
    if (deliveryBruttoEl) deliveryBruttoEl.textContent = `${costs.shipping.brutto.toFixed(2)} PLN`;
    if (deliveryNettoEl) deliveryNettoEl.textContent = `${costs.shipping.netto.toFixed(2)} PLN netto`;

    // Suma
    const finalBruttoEl = document.querySelector('.edit-final-brutto');
    const finalNettoEl = document.querySelector('.edit-final-netto');
    if (finalBruttoEl) finalBruttoEl.textContent = `${costs.total.brutto.toFixed(2)} PLN`;
    if (finalNettoEl) finalNettoEl.textContent = `${costs.total.netto.toFixed(2)} PLN netto`;

    console.log('[QUOTE EDITOR] ✅ Załadowano koszty do podsumowania');
}

/**
 * Ładuje produkty do sekcji "Produkty w wycenie"
 * @param {Object} quoteData - Dane wyceny
 */
function loadProductsToEditor(quoteData) {
    console.log('[QUOTE EDITOR] Ładowanie produktów do edytora...');

    if (!quoteData.items || quoteData.items.length === 0) {
        console.log('[QUOTE EDITOR] Brak produktów do załadowania');
        return;
    }

    const productsContainer = document.getElementById('edit-products-summary-container');
    if (!productsContainer) {
        console.error('[QUOTE EDITOR] Nie znaleziono kontenera produktów');
        return;
    }

    // Wyczyść kontener
    productsContainer.innerHTML = '';

    // Grupuj produkty po product_index
    const groupedProducts = {};
    quoteData.items.forEach(item => {
        if (!groupedProducts[item.product_index]) {
            groupedProducts[item.product_index] = [];
        }
        groupedProducts[item.product_index].push(item);
    });

    // Stwórz karty produktów
    let displayProductNumber = 1;
    const sortedIndices = Object.keys(groupedProducts).sort((a, b) => parseInt(a) - parseInt(b));

    sortedIndices.forEach(productIndex => {
        const productItems = groupedProducts[productIndex];
        const firstItem = productItems[0]; // Pierwszy wariant jako reprezentatywny

        // Generuj opis produktu
        const descriptionData = generateProductDescriptionForQuote(firstItem, productItems);

        const productCard = document.createElement('div');
        const isActive = parseInt(productIndex) === activeProductIndex;
        const isComplete = checkProductCompletenessForQuote(firstItem);

        productCard.className = `product-card ${isActive ? 'active' : ''} ${!isComplete ? 'error' : ''}`;
        productCard.dataset.index = productIndex;

        // STRUKTURA HTML Z CALCULATOR
        productCard.innerHTML = `
            <div class="product-card-content">
                <div class="product-card-number">${displayProductNumber}</div>
                <div class="product-card-details">
                    <div class="product-card-main-info">${descriptionData.main}</div>
                    ${descriptionData.sub ? `<div class="product-card-sub-info">${descriptionData.sub}</div>` : ''}
                </div>
            </div>
            <button class="remove-product-btn" data-index="${productIndex}" title="Usuń produkt">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;

        // Dodaj event listener dla klikania karty
        productCard.addEventListener('click', (e) => {
            // Nie aktywuj jeśli kliknięto przycisk usuwania
            if (e.target.closest('.remove-product-btn')) return;

            activateProductInEditor(parseInt(productIndex));
        });

        productsContainer.appendChild(productCard);
        displayProductNumber++;
    });

    // Dodaj event listenery dla przycisków usuwania
    attachRemoveProductListeners();

    console.log(`[QUOTE EDITOR] Załadowano ${Object.keys(groupedProducts).length} produktów`);
}

/**
 * Aktywuje wybrany produkt w edytorze
 * @param {number} productIndex - Index produktu do aktywacji
 */
function activateProductInEditor(productIndex) {
    console.log('[QUOTE EDITOR] Aktywuję produkt:', productIndex);

    if (!currentEditingQuoteData) return;

    // Znajdź produkt w danych
    const productItem = currentEditingQuoteData.items.find(item => item.product_index === productIndex);
    if (!productItem) {
        console.error('[QUOTE EDITOR] Nie znaleziono produktu o indeksie:', productIndex);
        return;
    }

    // Zaktualizuj aktywny index
    activeProductIndex = productIndex;

    // Zaktualizuj UI kart produktów
    const allCards = document.querySelectorAll('.product-card');
    allCards.forEach(card => {
        if (parseInt(card.dataset.index) === productIndex) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });

    // Załaduj dane produktu do formularza
    loadProductDataToForm(productItem);
}

/**
 * Ładuje dane produktu do formularza edycji
 * @param {Object} productItem - Dane produktu
 */
function loadProductDataToForm(productItem) {
    console.log('[QUOTE EDITOR] Ładuję dane produktu do formularza:', productItem);

    // Wymiary
    const lengthInput = document.getElementById('edit-length');
    const widthInput = document.getElementById('edit-width');
    const thicknessInput = document.getElementById('edit-thickness');
    const quantityInput = document.getElementById('edit-quantity');

    if (lengthInput) lengthInput.value = productItem.length_cm || '';
    if (widthInput) widthInput.value = productItem.width_cm || '';
    if (thicknessInput) thicknessInput.value = productItem.thickness_cm || '';
    if (quantityInput) quantityInput.value = productItem.quantity || 1;

    // Wariant
    if (productItem.variant_code) {
        const radioButton = document.querySelector(`input[name="edit-variantOption"][value="${productItem.variant_code}"]`);
        if (radioButton) {
            // Odznacz wszystkie
            document.querySelectorAll('input[name="edit-variantOption"]').forEach(r => r.checked = false);
            // Zaznacz właściwy
            radioButton.checked = true;
        }
    }
}

/**
 * Sprawdza kompletność produktu w wycenie
 * @param {Object} item - Element wyceny
 * @returns {boolean}
 */
function checkProductCompletenessForQuote(item) {
    // Sprawdź czy ma wszystkie wymagane dane
    const hasBasicData = item.length_cm && item.width_cm && item.thickness_cm && item.quantity;
    const hasVariant = item.variant_code;
    const hasFinishing = item.finishing_type;
    const hasPrices = item.final_price_netto && item.final_price_brutto;

    return hasBasicData && hasVariant && hasFinishing && hasPrices;
}

/**
 * Generuje opis produktu dla wyceny
 * @param {Object} item - Pierwszy wariant produktu
 * @param {Array} productItems - Wszystkie warianty produktu
 * @returns {Object} - {main, sub}
 */
function generateProductDescriptionForQuote(item, productItems) {
    // Tłumacz kod wariantu
    const translatedVariant = translateVariantCode(item.variant_code);

    // Wymiary
    const dimensions = `${item.length_cm}×${item.width_cm}×${item.thickness_cm} cm`;

    // Wykończenie (jeśli inne niż surowe)
    let finishing = '';
    if (item.finishing_type && item.finishing_type !== 'Surowe') {
        finishing = ` | ${item.finishing_type}`;
        if (item.finishing_color) {
            finishing += ` ${item.finishing_color}`;
        }
    }

    // Ilość
    const quantity = ` | ${item.quantity} szt.`;

    // Główna linia: kod wariantu + wymiary + wykończenie + ilość
    const main = `${translatedVariant} ${dimensions}${finishing}${quantity}`;

    // Podlinia: objętość i waga
    const volume = item.volume_m3 ? `${item.volume_m3.toFixed(3)} m³` : '0.000 m³';
    const weight = item.weight_kg ? `${item.weight_kg.toFixed(1)} kg` : '0.0 kg';
    const sub = `${volume} | ${weight}`;

    return { main, sub };
}

/**
 * Tłumaczy kod wariantu na czytelną nazwę
 * @param {string} variantCode - Kod wariantu (np. "dab-lity-ab")
 * @returns {string} - Przetłumaczona nazwa (np. "Dąb lity A/B")
 */
function translateVariantCode(variantCode) {
    if (!variantCode) return 'Nieznany wariant';

    const translations = {
        'dab-lity-ab': 'Dąb lity A/B',
        'dab-lity-bb': 'Dąb lity B/B',
        'dab-mikrowzor-ab': 'Dąb mikrowzór A/B',
        'dab-mikrowzor-bb': 'Dąb mikrowzór B/B',
        'jesion-lity-ab': 'Jesion lity A/B',
        'jesion-mikrowzor-ab': 'Jesion mikrowzór A/B',
        'buk-lity-ab': 'Buk lity A/B',
        'buk-mikrowzor-ab': 'Buk mikrowzór A/B'
    };

    return translations[variantCode] || variantCode;
}

/**
 * Dodaje event listenery do formularza edytora
 */
function attachEditorFormListeners() {
    console.log('[QUOTE EDITOR] ===== DODAWANIE EVENT LISTENERS =====');

    let listenersCount = 0;

    // Inputy wymiarów
    const dimensionInputs = [
        'edit-length', 'edit-width', 'edit-thickness', 'edit-quantity'
    ];

    console.log('[QUOTE EDITOR] Dodaję listenery dla inputów wymiarów...');
    dimensionInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener('input', () => {
                console.log(`[QUOTE EDITOR] 🔄 INPUT CHANGE: ${inputId} = "${input.value}"`);
                onFormDataChange();
            });
            listenersCount++;
            console.log(`[QUOTE EDITOR] ✅ Listener dodany dla #${inputId}`);
        } else {
            console.error(`[QUOTE EDITOR] ❌ BŁĄD: Nie znaleziono elementu #${inputId}`);
        }
    });

    // Grupa cenowa - POPRAWIONA obsługa
    console.log('[QUOTE EDITOR] Dodaję listener dla grupy cenowej...');
    const clientTypeSelect = document.getElementById('edit-clientType');
    if (clientTypeSelect) {
        clientTypeSelect.addEventListener('change', () => {
            const selectedOption = clientTypeSelect.options[clientTypeSelect.selectedIndex];
            const clientType = selectedOption?.value;
            const multiplier = selectedOption?.dataset.multiplierValue;

            console.log(`[QUOTE EDITOR] 🔄 CLIENT TYPE CHANGE: "${clientType}" (mnożnik: ${multiplier})`);
            onClientTypeChange(); // Wywołaj dedykowaną funkcję
        });
        listenersCount++;
        console.log('[QUOTE EDITOR] ✅ Listener dodany dla grupy cenowej z obsługą mnożnika');
    } else {
        console.error('[QUOTE EDITOR] ❌ BŁĄD: Nie znaleziono elementu #edit-clientType');
    }

    // Radio buttons wariantów
    console.log('[QUOTE EDITOR] Dodaję listenery dla wariantów...');
    const variantRadios = document.querySelectorAll('input[name="edit-variantOption"]');
    console.log(`[QUOTE EDITOR] Znaleziono ${variantRadios.length} radio buttons wariantów`);

    variantRadios.forEach((radio, index) => {
        radio.addEventListener('change', () => {
            if (radio.checked) {
                console.log(`[QUOTE EDITOR] 🔄 VARIANT CHANGE: "${radio.value}" (${radio.dataset.variantName})`);
                onFormDataChange();
            }
        });
        listenersCount++;
        console.log(`[QUOTE EDITOR] ✅ Listener ${index + 1} dodany dla wariantu: ${radio.value}`);
    });

    // Przyciski
    console.log('[QUOTE EDITOR] Dodaję listenery dla przycisków...');
    const saveBtn = document.getElementById('save-quote-changes');
    const addProductBtn = document.getElementById('edit-add-product-btn');

    if (saveBtn) {
        saveBtn.addEventListener('click', saveQuoteChanges);
        listenersCount++;
        console.log('[QUOTE EDITOR] ✅ Listener dodany dla przycisku "Zapisz zmiany"');
    } else {
        console.error('[QUOTE EDITOR] ❌ BŁĄD: Nie znaleziono przycisku #save-quote-changes');
    }

    if (addProductBtn) {
        addProductBtn.addEventListener('click', addNewProductToQuote);
        listenersCount++;
        console.log('[QUOTE EDITOR] ✅ Listener dodany dla przycisku "Dodaj produkt"');
    } else {
        console.error('[QUOTE EDITOR] ❌ BŁĄD: Nie znaleziono przycisku #edit-add-product-btn');
    }

    console.log(`[QUOTE EDITOR] ===== DODANO ${listenersCount} EVENT LISTENERS =====`);
}

/**
 * Dodaje event listenery dla przycisków usuwania produktów
 */
function attachRemoveProductListeners() {
    const removeButtons = document.querySelectorAll('.remove-product-btn');
    removeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Nie aktywuj karty
            const productIndex = parseInt(btn.dataset.index);
            removeProductFromQuote(productIndex);
        });
    });
}

/**
 * Obsługa zmiany danych formularza
 */
function onFormDataChange() {
    console.log('[QUOTE EDITOR] Dane formularza zostały zmienione');
    // TODO: Tutaj będzie logika przeliczania cen na żywo
    // Na razie tylko logowanie
}

/**
 * Dodaje nowy produkt do wyceny
 */
function addNewProductToQuote() {
    console.log('[QUOTE EDITOR] Dodawanie nowego produktu...');
    alert('Funkcja dodawania produktów będzie dostępna wkrótce!');
    // TODO: Implementacja dodawania produktów
}

/**
 * Usuwa produkt z wyceny
 * @param {number} productIndex - Index produktu do usunięcia
 */
function removeProductFromQuote(productIndex) {
    console.log('[QUOTE EDITOR] Usuwanie produktu:', productIndex);

    if (!confirm('Czy na pewno chcesz usunąć ten produkt?')) {
        return;
    }

    // TODO: Implementacja usuwania produktów
    alert(`Usuwanie produktu ${productIndex} będzie dostępne wkrótce!`);
}

/**
 * Zapisuje zmiany w wycenie
 */
function saveQuoteChanges() {
    console.log('[QUOTE EDITOR] Zapisywanie zmian w wycenie...');

    if (!currentEditingQuoteData) {
        alert('Błąd: Brak danych wyceny do zapisu');
        return;
    }

    // Zbierz dane z formularza
    const updatedData = collectUpdatedQuoteData();

    if (!updatedData) {
        alert('Błąd: Nie udało się zebrać danych z formularza');
        return;
    }

    console.log('[QUOTE EDITOR] Dane do zapisu:', updatedData);

    // TODO: Wysłanie danych do backend
    alert('Zapisywanie zmian będzie dostępne wkrótce!\n\nZebrane dane:\n' + JSON.stringify(updatedData, null, 2));
}

/**
 * Zbiera zaktualizowane dane z formularza
 * @returns {Object|null} - Zaktualizowane dane wyceny
 */
function collectUpdatedQuoteData() {
    try {
        const clientType = document.getElementById('edit-clientType')?.value;
        const length = document.getElementById('edit-length')?.value;
        const width = document.getElementById('edit-width')?.value;
        const thickness = document.getElementById('edit-thickness')?.value;
        const quantity = document.getElementById('edit-quantity')?.value;

        const selectedVariant = document.querySelector('input[name="edit-variantOption"]:checked');

        return {
            quote_id: currentEditingQuoteData.id,
            client_type: clientType,
            active_product: {
                index: activeProductIndex,
                length_cm: parseFloat(length) || 0,
                width_cm: parseFloat(width) || 0,
                thickness_cm: parseFloat(thickness) || 0,
                quantity: parseInt(quantity) || 1,
                variant_code: selectedVariant?.value || null,
                variant_name: selectedVariant?.dataset.variantName || null
            }
        };
    } catch (error) {
        console.error('[QUOTE EDITOR] Błąd podczas zbierania danych:', error);
        return null;
    }
}

/**
 * Liczy unikalne produkty (grupuje po product_index)
 */
function getUniqueProductsCount(items) {
    if (!items || !Array.isArray(items)) return 0;

    const uniqueProducts = new Set();
    items.forEach(item => {
        if (item.product_index !== undefined) {
            uniqueProducts.add(item.product_index);
        }
    });

    return uniqueProducts.size;
}

/**
 * Inicjalizacja modułu Quote Editor
 */
function initQuoteEditor() {
    console.log('[QUOTE EDITOR] Moduł zainicjalizowany');

    // Sprawdź czy potrzebne elementy istnieją
    const modal = document.getElementById('quote-editor-modal');
    if (!modal) {
        console.warn('[QUOTE EDITOR] Modal edytora nie został znaleziony');
        return;
    }

    console.log('[QUOTE EDITOR] ✅ Modal edytora znaleziony, gotowy do użycia');
}

/**
 * Pobiera grupy cenowe z bazy danych i wypełnia dropdown
 */
async function loadClientTypesFromDatabase() {
    console.log('[QUOTE EDITOR] ===== ŁADOWANIE GRUP CENOWYCH Z BAZY =====');

    try {
        const response = await fetch('/quotes/api/multipliers');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const multipliers = await response.json();
        console.log('[QUOTE EDITOR] ✅ Pobrano grupy cenowe z bazy:', multipliers);

        // Znajdź dropdown
        const clientTypeSelect = document.getElementById('edit-clientType');
        if (!clientTypeSelect) {
            console.error('[QUOTE EDITOR] ❌ BŁĄD: Nie znaleziono elementu #edit-clientType');
            return null;
        }

        // Wyczyść istniejące opcje (zostaw tylko placeholder)
        const placeholder = clientTypeSelect.querySelector('option[disabled]');
        clientTypeSelect.innerHTML = '';

        // Dodaj placeholder z powrotem
        if (placeholder) {
            clientTypeSelect.appendChild(placeholder);
        } else {
            // Stwórz nowy placeholder jeśli nie było
            const placeholderOption = document.createElement('option');
            placeholderOption.value = '';
            placeholderOption.disabled = true;
            placeholderOption.selected = true;
            placeholderOption.textContent = 'Wybierz grupę';
            clientTypeSelect.appendChild(placeholderOption);
        }

        // Dodaj opcje z bazy danych
        let addedCount = 0;
        multipliers.forEach(multiplier => {
            const option = document.createElement('option');
            option.value = multiplier.client_type;  // POPRAWKA: client_type zamiast label
            option.textContent = `${multiplier.client_type} (${multiplier.multiplier})`; // POPRAWKA: multiplier zamiast value
            option.dataset.multiplierValue = multiplier.multiplier; // POPRAWKA: multiplier zamiast value  
            option.dataset.multiplierId = multiplier.id;

            clientTypeSelect.appendChild(option);
            addedCount++;

            console.log(`[QUOTE EDITOR] ✅ Dodano grupę: ${multiplier.client_type} (${multiplier.multiplier})`);
        });

        console.log(`[QUOTE EDITOR] ✅ Załadowano ${addedCount} grup cenowych z bazy danych`);
        console.log('[QUOTE EDITOR] ===== KONIEC ŁADOWANIA GRUP CENOWYCH =====');

        return multipliers;

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ BŁĄD podczas ładowania grup cenowych:', error);
        console.error('[QUOTE EDITOR] Stack trace:', error.stack);

        // Fallback - użyj domyślnych wartości
        console.log('[QUOTE EDITOR] ⚠️ Używam domyślnych grup cenowych jako fallback');
        loadDefaultClientTypes();

        return null;
    }
}

/**
 * Ładuje domyślne grupy cenowe jako fallback
 */
function loadDefaultClientTypes() {
    console.log('[QUOTE EDITOR] ===== ŁADOWANIE DOMYŚLNYCH GRUP CENOWYCH =====');

    const clientTypeSelect = document.getElementById('edit-clientType');
    if (!clientTypeSelect) {
        console.error('[QUOTE EDITOR] ❌ BŁĄD: Nie znaleziono elementu #edit-clientType');
        return;
    }

    const defaultGroups = [
        { client_type: 'Partner', multiplier: 1.0 },
        { client_type: 'Hurt', multiplier: 1.1 },
        { client_type: 'Detal', multiplier: 1.3 },
        { client_type: 'Detal+', multiplier: 1.5 }
    ];

    console.log('[QUOTE EDITOR] Domyślne grupy cenowe:', defaultGroups);

    // Wyczyść i dodaj placeholder
    clientTypeSelect.innerHTML = '<option value="" disabled selected>Wybierz grupę</option>';

    let addedCount = 0;
    defaultGroups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.client_type;
        option.textContent = `${group.client_type} (${group.multiplier})`;
        option.dataset.multiplierValue = group.multiplier;

        clientTypeSelect.appendChild(option);
        addedCount++;

        console.log(`[QUOTE EDITOR] ✅ Dodano domyślną grupę: ${group.client_type} (${group.multiplier})`);
    });

    console.log(`[QUOTE EDITOR] ✅ Załadowano ${addedCount} domyślnych grup cenowych`);
    console.log('[QUOTE EDITOR] ===== KONIEC ŁADOWANIA DOMYŚLNYCH GRUP =====');
}

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', function () {
    initQuoteEditor();
});
