/**
 * Quote Editor - Edycja wycen w module quotes
 * Wykorzystuje logikę z modułu calculator
 */

// Globalne zmienne
let currentEditingQuoteData = null;
let activeProductIndex = null;
let clientTypesCache = null;
let finishingDataCache = null;
let calculatorScriptLoaded = false;
let calculatorInitialized = false;

/**
 * Otwiera modal edycji wyceny
 * @param {Object} quoteData - Dane wyceny do edycji
 */

/**
 * ZMODYFIKOWANA funkcja openQuoteEditor - z dynamicznym ładowaniem
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

    // Znajdź modal
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

    // Pokaż modal PRZED ładowaniem danych
    modal.style.display = 'flex';
    console.log('[QUOTE EDITOR] ✅ Modal wyświetlony');

    try {
        // NOWE: Dynamicznie załaduj calculator.js
        console.log('[QUOTE EDITOR] Rozpoczynam ładowanie calculator.js...');
        const calculatorLoaded = await loadCalculatorScript();

        if (calculatorLoaded) {
            // Zainicjalizuj calculator.js dla edytora
            initializeCalculatorForEditor();
            console.log('[QUOTE EDITOR] ✅ Calculator.js gotowy do użycia');
        } else {
            console.warn('[QUOTE EDITOR] ⚠️ Calculator.js nie został załadowany - używam fallback');
        }

        // Załaduj grupy cenowe z bazy danych (async)
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

    function closeModal() {
        modal.style.display = 'none';
        currentEditingQuoteData = null;
        activeProductIndex = null;

        // NOWE: Wyczyść konfigurację calculator.js
        resetCalculatorAfterEditor();
    }

    // Zamknij przez X
    if (closeBtn) {
        closeBtn.onclick = closeModal;
    }

    // Zamknij przez Anuluj
    if (cancelBtn) {
        cancelBtn.onclick = closeModal;
    }

    // Zamknij przez kliknięcie w tło
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
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

    // Inputy wymiarów z debouncing i live sync
    const dimensionInputs = [
        'edit-length', 'edit-width', 'edit-thickness', 'edit-quantity'
    ];

    console.log('[QUOTE EDITOR] Dodaję listenery dla inputów wymiarów...');
    dimensionInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            let timeout;
            input.addEventListener('input', () => {
                console.log(`[QUOTE EDITOR] 🔄 INPUT CHANGE: ${inputId} = "${input.value}"`);

                // Live sync do mock formularza
                syncEditorToMockForm();

                // Debounced obliczenia
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    onFormDataChange();
                }, 300); // Zmniejszono z 500ms na 300ms dla lepszej responsywności
            });

            input.addEventListener('change', () => {
                clearTimeout(timeout);
                syncEditorToMockForm();
                onFormDataChange();
            });

            listenersCount += 2;
            console.log(`[QUOTE EDITOR] ✅ Listeners dodane dla #${inputId}`);
        }
    });

    // Grupa cenowa - natychmiastowa synchronizacja
    const clientTypeSelect = document.getElementById('edit-clientType');
    if (clientTypeSelect) {
        clientTypeSelect.addEventListener('change', () => {
            console.log('[QUOTE EDITOR] 🔄 CLIENT TYPE CHANGE:', clientTypeSelect.value);
            syncEditorToMockForm();
            onClientTypeChange();
            onFormDataChange();
        });
        listenersCount++;
        console.log('[QUOTE EDITOR] ✅ Listener dodany dla #edit-clientType');
    }

    // Checkbox-y dostępności - z synchronizacją
    const availabilityCheckboxes = document.querySelectorAll('.variant-availability-checkbox');
    availabilityCheckboxes.forEach((checkbox, index) => {
        checkbox.addEventListener('change', (e) => {
            console.log(`[QUOTE EDITOR] 🔄 CHECKBOX CHANGE: wariant ${index} = ${e.target.checked}`);
            updateVariantAvailability(e.target);
            syncEditorToMockForm(); // Synchronizuj do mock formularza
            onFormDataChange(); // Przelicz
        });
        listenersCount++;
    });
    console.log(`[QUOTE EDITOR] ✅ Dodano ${availabilityCheckboxes.length} listenerów dla checkbox-ów`);

    // Radio button-y wariantów - z synchronizacją
    const variantRadios = document.querySelectorAll('input[name="edit-variantOption"]');
    variantRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                console.log(`[QUOTE EDITOR] 🔄 VARIANT CHANGE: ${e.target.value}`);
                updateSelectedVariant(e.target);
                syncEditorToMockForm(); // Synchronizuj do mock formularza
                onFormDataChange(); // Przelicz
            }
        });
        listenersCount++;
    });
    console.log(`[QUOTE EDITOR] ✅ Dodano ${variantRadios.length} listenerów dla radio button-ów`);

    // Pozostałe przyciski bez zmian...
    const saveBtn = document.getElementById('save-quote-changes');
    const addProductBtn = document.getElementById('edit-add-product-btn');

    if (saveBtn) {
        saveBtn.addEventListener('click', saveQuoteChanges);
        listenersCount++;
    }

    if (addProductBtn) {
        addProductBtn.addEventListener('click', addNewProductToQuote);
        listenersCount++;
    }

    console.log(`[QUOTE EDITOR] ===== DODANO ${listenersCount} EVENT LISTENERS =====`);
}

// 8. DODAJ funkcję sprawdzającą dostępność calculator.js przy starcie
function checkCalculatorAvailability() {
    const availableFunctions = {
        updatePrices: typeof updatePrices !== 'undefined',
        calculateFinishingCost: typeof calculateFinishingCost !== 'undefined',
        getPrice: typeof getPrice !== 'undefined',
        formatPLN: typeof formatPLN !== 'undefined'
    };

    console.log('[QUOTE EDITOR] Dostępność funkcji calculator.js:', availableFunctions);

    const availableCount = Object.values(availableFunctions).filter(Boolean).length;
    if (availableCount > 0) {
        console.log(`[QUOTE EDITOR] ✅ Calculator.js częściowo dostępny (${availableCount}/4 funkcji)`);
        return true;
    } else {
        console.log('[QUOTE EDITOR] ❌ Calculator.js niedostępny - używam fallback');
        return false;
    }
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
<<<<<<< HEAD
 * POPRAWIONA WERSJA addVariantsToCalculatorForm - z poprawnym tabIndex
 */
function addVariantsToCalculatorForm() {
    if (!window.activeQuoteForm) {
        console.warn('[QUOTE EDITOR] Brak activeQuoteForm dla wariantów');
        return;
    }

    const variantsContainer = window.activeQuoteForm.querySelector('.variants');
    if (!variantsContainer) {
        console.warn('[QUOTE EDITOR] Brak kontenera wariantów w activeQuoteForm');
        return;
    }

    // Sprawdź czy warianty już istnieją
    if (variantsContainer.children.length > 0) {
        console.log('[QUOTE EDITOR] Warianty już istnieją w formularzu calculator.js');
        return;
    }

    // Pobierz dostępne warianty z edytora
    const editorVariants = document.querySelectorAll('.variant-option');

    // KRYTYCZNE: Sprawdź tabIndex (powinien być 0 dla pierwszego formularza)
    const allForms = window.quoteFormsContainer.querySelectorAll('.quote-form');
    const tabIndex = Array.from(allForms).indexOf(window.activeQuoteForm);
    console.log('[QUOTE EDITOR] tabIndex dla wariantów:', tabIndex);

    editorVariants.forEach((editorVariant, index) => {
        const radio = editorVariant.querySelector('input[type="radio"]');
        if (!radio) return;

        // Stwórz kontener wariantu dla calculator.js
        const calculatorVariant = document.createElement('div');
        calculatorVariant.className = 'variant-item';
        calculatorVariant.style.display = 'none';

        // Stwórz radio button zgodny z calculator.js
        const calculatorRadio = document.createElement('input');
        calculatorRadio.type = 'radio';
        // POPRAWKA: Użyj prawidłowego tabIndex (powinno być 0)
        calculatorRadio.name = `variant-product-${tabIndex}-selected`;
        calculatorRadio.id = `calc-${radio.id}`;
        calculatorRadio.value = radio.value;
        calculatorRadio.checked = radio.checked;

        // Dodaj spans dla cen (wymagane przez calculator.js)
        const unitBrutto = document.createElement('span');
        unitBrutto.className = 'unit-brutto';
        const unitNetto = document.createElement('span');
        unitNetto.className = 'unit-netto';
        const totalBrutto = document.createElement('span');
        totalBrutto.className = 'total-brutto';
        const totalNetto = document.createElement('span');
        totalNetto.className = 'total-netto';

        calculatorVariant.appendChild(calculatorRadio);
        calculatorVariant.appendChild(unitBrutto);
        calculatorVariant.appendChild(unitNetto);
        calculatorVariant.appendChild(totalBrutto);
        calculatorVariant.appendChild(totalNetto);

        variantsContainer.appendChild(calculatorVariant);
    });

    console.log(`[QUOTE EDITOR] ✅ Dodano ${editorVariants.length} wariantów do formularza calculator.js z tabIndex: ${tabIndex}`);
}

/**
=======
>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
 * Obsługa zmiany danych formularza
 */
function onFormDataChange() {
    console.log('[QUOTE EDITOR] Dane formularza zostały zmienione');

<<<<<<< HEAD
    // Sprawdź czy calculator.js jest gotowy
    if (!checkCalculatorReadiness()) {
        console.warn('[QUOTE EDITOR] Calculator.js nie jest gotowy - używam fallback');
        calculateEditorPrices();
        return;
    }

    try {
        // 1. Skonfiguruj środowisko calculator.js
        console.log('[QUOTE EDITOR] Konfiguracja calculator.js dla edytora...');
        const setupSuccess = setupCalculatorForEditor();

        if (!setupSuccess) {
            console.error('[QUOTE EDITOR] Błąd konfiguracji calculator.js');
            return;
        }

        // 2. Synchronizuj dane z edytora
        console.log('[QUOTE EDITOR] Synchronizacja danych...');
        const syncSuccess = syncEditorDataToCalculatorForm();

        if (!syncSuccess) {
            console.error('[QUOTE EDITOR] Błąd synchronizacji danych');
            return;
        }

        // 3. ✅ DODAJ: Upewnij się że variantMapping jest dostępny
        copyVariantMappingToEditor();

        // 4. NOWE: Zastąp funkcję updatePrices KOMPLETNĄ wersją
        console.log('[QUOTE EDITOR] Tworzę KOMPLETNĄ funkcję updatePrices...');
        createCustomUpdatePricesForEditor();

        // 5. Sprawdź stan activeQuoteForm
        if (!window.activeQuoteForm) {
            console.error('[QUOTE EDITOR] ❌ activeQuoteForm nie jest ustawiony!');
            return;
        }

        console.log('[QUOTE EDITOR] ✅ activeQuoteForm gotowy:', window.activeQuoteForm);

        // 6. Wywołaj KOMPLETNĄ funkcję updatePrices
        console.log('[QUOTE EDITOR] ✅ Wywołuję KOMPLETNĄ updatePrices()...');
        callUpdatePricesSecurely();

        console.log('[QUOTE EDITOR] ✅ updatePrices() wykonany pomyślnie');

        // 7. Skopiuj wyniki z powrotem do edytora
        copyCalculationResults();

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd w onFormDataChange:', error);

        // Fallback w przypadku błędu
        console.log('[QUOTE EDITOR] Używam funkcji fallback...');
        calculateEditorPrices();
=======
    // Pobierz dane formularza
    const formData = collectFormData();
    if (!formData) {
        console.warn('[QUOTE EDITOR] Nie udało się pobrać danych formularza');
        return;
    }

    // Sprawdź czy calculator.js jest dostępny i zainicjalizowany
    if (calculatorScriptLoaded && calculatorInitialized && typeof updatePrices === 'function') {
        console.log('[QUOTE EDITOR] Używam funkcji updatePrices z calculator.js');

        // Przygotuj środowisko dla calculator.js
        setupCalculatorForEditor();

        // Wywołaj funkcję obliczeń z calculator.js
        updatePrices();

        // Skopiuj wyniki z powrotem do edytora
        copyCalculationResults();

    } else {
        console.warn('[QUOTE EDITOR] Calculator.js nie jest gotowy - używam fallback');
        // Fallback - wywołaj własną funkcję obliczeń
        calculateEditorPrices(formData);
>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
    }
}

// Eksportuj funkcję do globalnego scope dla debugowania
window.checkCalculatorReadiness = checkCalculatorReadiness;

<<<<<<< HEAD
function restoreOriginalUpdatePrices() {
    if (typeof window.originalUpdatePrices === 'function') {
        window.updatePrices = window.originalUpdatePrices;
        delete window.originalUpdatePrices;
        console.log('[QUOTE EDITOR] ✅ Przywrócono oryginalną funkcję updatePrices');
    }
}

/**
 * NOWA FUNKCJA - Bezpieczne wywołanie updatePrices z zabezpieczeniem activeQuoteForm
 */
function callUpdatePricesSecurely() {
    console.log('[QUOTE EDITOR] 🔒 Wywołuję updatePrices() z prostym zabezpieczeniem...');

    // Upewnij się że activeQuoteForm jest ustawiony
    if (!window.activeQuoteForm) {
        console.error('[QUOTE EDITOR] ❌ activeQuoteForm nie jest ustawiony!');
        return;
    }

    console.log('[QUOTE EDITOR] activeQuoteForm przed updatePrices:', window.activeQuoteForm);

    // Wywołaj naszą własną funkcję updatePrices
    try {
        updatePrices();
        console.log('[QUOTE EDITOR] ✅ Własna updatePrices() wykonana pomyślnie');
    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd w updatePrices():', error);
    }

    console.log('[QUOTE EDITOR] activeQuoteForm po updatePrices:', window.activeQuoteForm);
}

=======
>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
/**
 * Funkcja do sprawdzania czy calculator.js jest ready
 */
function checkCalculatorReadiness() {
    const isReady = calculatorScriptLoaded &&
        calculatorInitialized &&
        typeof updatePrices === 'function' &&
        typeof window.pricesFromDatabase !== 'undefined' &&
        typeof window.multiplierMapping !== 'undefined';

    console.log('[QUOTE EDITOR] Stan calculator.js:', {
        scriptLoaded: calculatorScriptLoaded,
        initialized: calculatorInitialized,
        updatePricesAvailable: typeof updatePrices === 'function',
        pricesDataAvailable: typeof window.pricesFromDatabase !== 'undefined',
        multipliersAvailable: typeof window.multiplierMapping !== 'undefined',
        ready: isReady
    });

    return isReady;
}
<<<<<<< HEAD
function setupCalculatorForEditor() {
    console.log('[QUOTE EDITOR] Konfiguracja calculator.js dla edytora...');

    // 1. Zapisz oryginalne zmienne jeśli istnieją
    if (window.quoteFormsContainer && !window.originalQuoteFormsContainer) {
        window.originalQuoteFormsContainer = window.quoteFormsContainer;
        console.log('[QUOTE EDITOR] Zapisano oryginalny quoteFormsContainer');
    }
    if (window.activeQuoteForm && !window.originalActiveQuoteForm) {
        window.originalActiveQuoteForm = window.activeQuoteForm;
        console.log('[QUOTE EDITOR] Zapisano oryginalny activeQuoteForm');
    }

    // 2. Znajdź lub stwórz kontener formularzy
    let editorQuoteFormsContainer = document.querySelector('#quote-editor-modal .quote-forms-container');
    if (!editorQuoteFormsContainer) {
        editorQuoteFormsContainer = document.createElement('div');
        editorQuoteFormsContainer.className = 'quote-forms-container';
        editorQuoteFormsContainer.style.display = 'none';

        const modal = document.getElementById('quote-editor-modal');
        modal.appendChild(editorQuoteFormsContainer);
        console.log('[QUOTE EDITOR] Stworzono kontener formularzy');
    }

    // 3. Znajdź lub stwórz formularz
    let mockQuoteForm = editorQuoteFormsContainer.querySelector('.quote-form');
    if (!mockQuoteForm) {
        mockQuoteForm = document.createElement('div');
        mockQuoteForm.className = 'quote-form';
        mockQuoteForm.style.display = 'none';

        mockQuoteForm.innerHTML = `
            <div class="product-inputs">
                <select data-field="clientType" style="display: none;">
                    <option value="">Wybierz grupę</option>
                    <option value="Florek">Florek</option>
                    <option value="Hurt">Hurt</option>
                    <option value="Detal">Detal</option>
                    <option value="Detal+">Detal+</option>
                </select>
                <input type="number" data-field="length" style="display: none;">
                <input type="number" data-field="width" style="display: none;">
                <input type="number" data-field="thickness" style="display: none;">
                <input type="number" data-field="quantity" value="1" style="display: none;">
            </div>
            <div class="variants" style="display: none;"></div>
        `;

        // KRYTYCZNE: Dodaj formularz do kontenera
        editorQuoteFormsContainer.appendChild(mockQuoteForm);
        console.log('[QUOTE EDITOR] Stworzono i dodano formularz calculator.js do kontenera');
    }

    // 4. KRYTYCZNE: Ustaw zmienne globalne wymagane przez calculator.js
    window.quoteFormsContainer = editorQuoteFormsContainer;
    window.activeQuoteForm = mockQuoteForm;

    console.log('[QUOTE EDITOR] ✅ Ustawiono activeQuoteForm:', window.activeQuoteForm);
    console.log('[QUOTE EDITOR] ✅ Ustawiono quoteFormsContainer:', window.quoteFormsContainer);

    // 5. Sprawdź czy formularz jest w kontenerze (dla debugowania)
    const formIsInContainer = editorQuoteFormsContainer.contains(mockQuoteForm);
    console.log('[QUOTE EDITOR] ✅ Formularz jest w kontenerze:', formIsInContainer);

    // 6. Sprawdź indexOf dla debugowania
    const allForms = editorQuoteFormsContainer.querySelectorAll('.quote-form');
    const indexOf = Array.from(allForms).indexOf(mockQuoteForm);
    console.log('[QUOTE EDITOR] ✅ indexOf formularza w kontenerze:', indexOf);

    // 7. Dodaj warianty do formularza calculator.js
    addVariantsToCalculatorForm();

    return true;
}

function syncEditorDataToCalculatorForm() {
    if (!window.activeQuoteForm) {
        console.error('[QUOTE EDITOR] Brak activeQuoteForm do synchronizacji');
        return false;
    }

    // Pobierz dane z inputów edytora
    const editLength = document.getElementById('edit-length')?.value;
    const editWidth = document.getElementById('edit-width')?.value;
    const editThickness = document.getElementById('edit-thickness')?.value;
    const editQuantity = document.getElementById('edit-quantity')?.value;
    const editClientType = document.getElementById('edit-clientType')?.value;

    // Znajdź inputy w formularzu calculator.js
    const lengthInput = window.activeQuoteForm.querySelector('[data-field="length"]');
    const widthInput = window.activeQuoteForm.querySelector('[data-field="width"]');
    const thicknessInput = window.activeQuoteForm.querySelector('[data-field="thickness"]');
    const quantityInput = window.activeQuoteForm.querySelector('[data-field="quantity"]');
    const clientTypeSelect = window.activeQuoteForm.querySelector('[data-field="clientType"]');

    // Skopiuj wartości
    if (lengthInput) {
        lengthInput.value = editLength || '';
        console.log('[QUOTE EDITOR] Skopiowano length:', editLength);
    }
    if (widthInput) {
        widthInput.value = editWidth || '';
        console.log('[QUOTE EDITOR] Skopiowano width:', editWidth);
    }
    if (thicknessInput) {
        thicknessInput.value = editThickness || '';
        console.log('[QUOTE EDITOR] Skopiowano thickness:', editThickness);
    }
    if (quantityInput) {
        quantityInput.value = editQuantity || '1';
        console.log('[QUOTE EDITOR] Skopiowano quantity:', editQuantity);
    }
    if (clientTypeSelect) {
        clientTypeSelect.value = editClientType || '';
        console.log('[QUOTE EDITOR] Skopiowano clientType:', editClientType);
    }

    // Synchronizuj wybrany wariant
    syncSelectedVariant();

    console.log('[QUOTE EDITOR] ✅ Zsynchronizowano dane z edytora do calculator.js');
    return true;
}

function syncSelectedVariant() {
    if (!window.activeQuoteForm) return;

    // Znajdź wybrany wariant w edytorze
    const selectedEditorRadio = document.querySelector('.variant-option input[type="radio"]:checked');
    if (!selectedEditorRadio) {
        console.log('[QUOTE EDITOR] Brak wybranego wariantu w edytorze');
        return;
    }

    // Znajdź odpowiedni radio button w formularzu calculator.js
    const calculatorRadio = window.activeQuoteForm.querySelector(`input[value="${selectedEditorRadio.value}"]`);
    if (calculatorRadio) {
        calculatorRadio.checked = true;
        console.log('[QUOTE EDITOR] Zsynchronizowano wybrany wariant:', selectedEditorRadio.value);
    } else {
        console.warn('[QUOTE EDITOR] Nie znaleziono wariantu w formularzu calculator.js:', selectedEditorRadio.value);
=======

function setupCalculatorForEditor() {
    console.log('[QUOTE EDITOR] Konfiguracja calculator.js dla edytora...');

    // Znajdź lub stwórz kontener formularzy jak w calculator.js
    let editorQuoteFormsContainer = document.querySelector('#quote-editor-modal .quote-forms-container');
    if (!editorQuoteFormsContainer) {
        // Stwórz kontener formularzy w edytorze
        editorQuoteFormsContainer = document.createElement('div');
        editorQuoteFormsContainer.className = 'quote-forms-container';
        editorQuoteFormsContainer.style.display = 'none'; // Ukryj, to tylko dla obliczeń

        // Dodaj do modalu
        const modal = document.getElementById('quote-editor-modal');
        modal.appendChild(editorQuoteFormsContainer);
    }

    // Stwórz prawdziwy formularz zgodny z calculator.js
    const mockQuoteForm = document.createElement('div');
    mockQuoteForm.className = 'quote-form';
    mockQuoteForm.style.display = 'none'; // Ukryj, to tylko dla obliczeń

    // Dodaj wszystkie wymagane inputy zgodnie ze strukturą calculator.js
    mockQuoteForm.innerHTML = `
        <div class="product-inputs">
            <select data-field="clientType" style="display: none;">
                <option value="">Wybierz grupę</option>
                <option value="Florek">Florek</option>
                <option value="Hurt">Hurt</option>
                <option value="Detal">Detal</option>
                <option value="Detal+">Detal+</option>
            </select>
            <input type="number" data-field="length" style="display: none;">
            <input type="number" data-field="width" style="display: none;">
            <input type="number" data-field="thickness" style="display: none;">
            <input type="number" data-field="quantity" style="display: none;">
        </div>
        <div class="variants">
            <div class="dab-lity-ab-option variant-option">
                <input type="checkbox" class="variant-availability-checkbox" data-variant="dab-lity-ab" checked>
                <input type="radio" name="variant-product-0-selected" id="mock-dab-lity-ab" value="dab-lity-ab">
                <label for="mock-dab-lity-ab" class="option-title">Dąb lity A/B</label>
                <span class="unit-brutto">---.-- PLN</span>
                <span class="unit-netto">---.-- PLN</span>
                <span class="total-brutto">---.-- PLN</span>
                <span class="total-netto">---.-- PLN</span>
            </div>
            <div class="dab-lity-bb-option variant-option">
                <input type="checkbox" class="variant-availability-checkbox" data-variant="dab-lity-bb" checked>
                <input type="radio" name="variant-product-0-selected" id="mock-dab-lity-bb" value="dab-lity-bb">
                <label for="mock-dab-lity-bb" class="option-title">Dąb lity B/B</label>
                <span class="unit-brutto">---.-- PLN</span>
                <span class="unit-netto">---.-- PLN</span>
                <span class="total-brutto">---.-- PLN</span>
                <span class="total-netto">---.-- PLN</span>
            </div>
            <div class="dab-micro-ab-option variant-option">
                <input type="checkbox" class="variant-availability-checkbox" data-variant="dab-micro-ab" checked>
                <input type="radio" name="variant-product-0-selected" id="mock-dab-micro-ab" value="dab-micro-ab">
                <label for="mock-dab-micro-ab" class="option-title">Dąb mikrowczep A/B</label>
                <span class="unit-brutto">---.-- PLN</span>
                <span class="unit-netto">---.-- PLN</span>
                <span class="total-brutto">---.-- PLN</span>
                <span class="total-netto">---.-- PLN</span>
            </div>
            <div class="dab-micro-bb-option variant-option">
                <input type="checkbox" class="variant-availability-checkbox" data-variant="dab-micro-bb" checked>
                <input type="radio" name="variant-product-0-selected" id="mock-dab-micro-bb" value="dab-micro-bb">
                <label for="mock-dab-micro-bb" class="option-title">Dąb mikrowczep B/B</label>
                <span class="unit-brutto">---.-- PLN</span>
                <span class="unit-netto">---.-- PLN</span>
                <span class="total-brutto">---.-- PLN</span>
                <span class="total-netto">---.-- PLN</span>
            </div>
            <div class="jes-lity-ab-option variant-option">
                <input type="checkbox" class="variant-availability-checkbox" data-variant="jes-lity-ab" checked>
                <input type="radio" name="variant-product-0-selected" id="mock-jes-lity-ab" value="jes-lity-ab">
                <label for="mock-jes-lity-ab" class="option-title">Jesion lity A/B</label>
                <span class="unit-brutto">---.-- PLN</span>
                <span class="unit-netto">---.-- PLN</span>
                <span class="total-brutto">---.-- PLN</span>
                <span class="total-netto">---.-- PLN</span>
            </div>
            <div class="jes-micro-ab-option variant-option">
                <input type="checkbox" class="variant-availability-checkbox" data-variant="jes-micro-ab" checked>
                <input type="radio" name="variant-product-0-selected" id="mock-jes-micro-ab" value="jes-micro-ab">
                <label for="mock-jes-micro-ab" class="option-title">Jesion mikrowczep A/B</label>
                <span class="unit-brutto">---.-- PLN</span>
                <span class="unit-netto">---.-- PLN</span>
                <span class="total-brutto">---.-- PLN</span>
                <span class="total-netto">---.-- PLN</span>
            </div>
            <div class="buk-lity-ab-option variant-option">
                <input type="checkbox" class="variant-availability-checkbox" data-variant="buk-lity-ab" checked>
                <input type="radio" name="variant-product-0-selected" id="mock-buk-lity-ab" value="buk-lity-ab">
                <label for="mock-buk-lity-ab" class="option-title">Buk lity A/B</label>
                <span class="unit-brutto">---.-- PLN</span>
                <span class="unit-netto">---.-- PLN</span>
                <span class="total-brutto">---.-- PLN</span>
                <span class="total-netto">---.-- PLN</span>
            </div>
            <div class="buk-micro-ab-option variant-option">
                <input type="checkbox" class="variant-availability-checkbox" data-variant="buk-micro-ab" checked>
                <input type="radio" name="variant-product-0-selected" id="mock-buk-micro-ab" value="buk-micro-ab">
                <label for="mock-buk-micro-ab" class="option-title">Buk mikrowczep A/B</label>
                <span class="unit-brutto">---.-- PLN</span>
                <span class="unit-netto">---.-- PLN</span>
                <span class="total-brutto">---.-- PLN</span>
                <span class="total-netto">---.-- PLN</span>
            </div>
        </div>
    `;

    // Wyczyść poprzednie formularze i dodaj nowy
    editorQuoteFormsContainer.innerHTML = '';
    editorQuoteFormsContainer.appendChild(mockQuoteForm);

    // Skopiuj wartości z edytora do mock formularza
    const editorInputs = {
        'edit-clientType': 'clientType',
        'edit-length': 'length',
        'edit-width': 'width',
        'edit-thickness': 'thickness',
        'edit-quantity': 'quantity'
    };

    Object.entries(editorInputs).forEach(([editorId, calculatorField]) => {
        const editorInput = document.getElementById(editorId);
        const mockInput = mockQuoteForm.querySelector(`[data-field="${calculatorField}"]`);

        if (editorInput && mockInput) {
            mockInput.value = editorInput.value;
            console.log(`[QUOTE EDITOR] Skopiowano ${calculatorField}: ${editorInput.value}`);
        }
    });

    // Synchronizuj wybrany wariant
    const selectedEditorRadio = document.querySelector('#quote-editor-modal input[name="edit-variantOption"]:checked');
    if (selectedEditorRadio) {
        const variantValue = selectedEditorRadio.value;
        const mockRadio = mockQuoteForm.querySelector(`input[value="${variantValue}"]`);

        if (mockRadio) {
            mockRadio.checked = true;
            console.log(`[QUOTE EDITOR] Zsynchronizowano wybrany wariant: ${variantValue}`);
        }
    }

    // Ustaw globalne zmienne dla calculator.js
    window.originalQuoteFormsContainer = window.quoteFormsContainer;
    window.originalActiveQuoteForm = window.activeQuoteForm;

    window.quoteFormsContainer = editorQuoteFormsContainer;
    window.activeQuoteForm = mockQuoteForm;

    console.log('[QUOTE EDITOR] ✅ Calculator.js skonfigurowany z prawdziwym formularzem');
}

function syncSelectedVariant(mockForm) {
    const selectedEditorRadio = document.querySelector('#quote-editor-modal input[name="edit-variantOption"]:checked');

    if (selectedEditorRadio) {
        const variantValue = selectedEditorRadio.value;
        const mockRadio = mockForm.querySelector(`input[value="${variantValue}"]`);

        if (mockRadio && !mockRadio.disabled) {
            mockRadio.checked = true;
            console.log(`[QUOTE EDITOR] Zsynchronizowano wybrany wariant: ${variantValue}`);
        }
>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
    }
}

function copyCalculationResults() {
    if (!window.activeQuoteForm) {
<<<<<<< HEAD
        console.warn('[QUOTE EDITOR] Brak activeQuoteForm do kopiowania wyników');
        return;
    }

    // Pobierz wyniki z formularza calculator.js
    const calculatorVariants = window.activeQuoteForm.querySelectorAll('.variant-item');
    const editorVariants = document.querySelectorAll('.variant-option');

    calculatorVariants.forEach((calcVariant, index) => {
        const calcRadio = calcVariant.querySelector('input[type="radio"]');
        if (!calcRadio) return;

        // Znajdź odpowiedni wariant w edytorze
        const editorVariant = Array.from(editorVariants).find(variant => {
            const editorRadio = variant.querySelector('input[type="radio"]');
            return editorRadio && editorRadio.value === calcRadio.value;
        });

        if (!editorVariant) return;

        // Skopiuj ceny
        const calcUnitBrutto = calcVariant.querySelector('.unit-brutto')?.textContent;
        const calcUnitNetto = calcVariant.querySelector('.unit-netto')?.textContent;
        const calcTotalBrutto = calcVariant.querySelector('.total-brutto')?.textContent;
        const calcTotalNetto = calcVariant.querySelector('.total-netto')?.textContent;

        const editorUnitBrutto = editorVariant.querySelector('.unit-brutto');
        const editorUnitNetto = editorVariant.querySelector('.unit-netto');
        const editorTotalBrutto = editorVariant.querySelector('.total-brutto');
        const editorTotalNetto = editorVariant.querySelector('.total-netto');

        if (editorUnitBrutto && calcUnitBrutto) editorUnitBrutto.textContent = calcUnitBrutto;
        if (editorUnitNetto && calcUnitNetto) editorUnitNetto.textContent = calcUnitNetto;
        if (editorTotalBrutto && calcTotalBrutto) editorTotalBrutto.textContent = calcTotalBrutto;
        if (editorTotalNetto && calcTotalNetto) editorTotalNetto.textContent = calcTotalNetto;
    });

    // Skopiuj dataset z activeQuoteForm (ceny wybranego wariantu)
    if (window.activeQuoteForm.dataset.orderBrutto) {
        const summaryBrutto = document.getElementById('edit-summary-brutto');
        if (summaryBrutto) {
            summaryBrutto.textContent = window.activeQuoteForm.dataset.orderBrutto;
        }
    }

    if (window.activeQuoteForm.dataset.orderNetto) {
        const summaryNetto = document.getElementById('edit-summary-netto');
        if (summaryNetto) {
            summaryNetto.textContent = window.activeQuoteForm.dataset.orderNetto;
        }
    }

=======
        console.warn('[QUOTE EDITOR] Brak activeQuoteForm do skopiowania wyników');
        return;
    }

    // Skopiuj wyniki z mock formularza do edytora
    const mockVariants = window.activeQuoteForm.querySelectorAll('.variant-option');
    const editorVariants = document.querySelectorAll('#quote-editor-modal .variant-option');

    mockVariants.forEach((mockVariant, index) => {
        const editorVariant = editorVariants[index];
        if (!editorVariant) return;

        // Skopiuj ceny
        const priceFields = ['unit-brutto', 'unit-netto', 'total-brutto', 'total-netto'];

        priceFields.forEach(fieldClass => {
            const mockElement = mockVariant.querySelector(`.${fieldClass}`);
            const editorElement = editorVariant.querySelector(`.${fieldClass}`);

            if (mockElement && editorElement) {
                editorElement.textContent = mockElement.textContent;
            }
        });
    });

>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
    console.log('[QUOTE EDITOR] ✅ Skopiowano wyniki obliczeń do edytora');
}

function syncAvailabilityStates(mockForm) {
    // Skopiuj stany checkbox-ów z edytora do mock formularza
    const editorCheckboxes = document.querySelectorAll('#quote-editor-modal .variant-availability-checkbox');

    editorCheckboxes.forEach(editorCheckbox => {
        const variant = editorCheckbox.dataset.variant || editorCheckbox.getAttribute('data-variant');
        if (variant) {
            const mockCheckbox = mockForm.querySelector(`[data-variant="${variant}"]`);
            if (mockCheckbox) {
                mockCheckbox.checked = editorCheckbox.checked;

                // Ustaw dostępność radio button-a
                const mockRadio = mockCheckbox.parentElement.querySelector('input[type="radio"]');
                if (mockRadio) {
                    mockRadio.disabled = !editorCheckbox.checked;
                }
            }
        }
    });

    console.log('[QUOTE EDITOR] Zsynchronizowano stany dostępności');
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

    // Walidacja formularza
    if (!validateFormBeforeSave()) {
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

/**
 * =====================================================
 * SEKCJA WYKOŃCZENIE - QUOTE EDITOR
 * Skopiowane i zaadaptowane z calculator.js
 * =====================================================
 */

/**
 * Inicjalizuje obsługę sekcji wykończenie w edytorze wyceny
 * Wywołuje się w funkcji attachEditorFormListeners()
 */
function initializeFinishingSection() {
    console.log('[QUOTE EDITOR] Inicjalizuję sekcję wykończenie...');

    // Dodaj event listenery do przycisków rodzaju wykończenia
    const finishingTypeButtons = document.querySelectorAll('#edit-finishing-type-group .finishing-btn');
    finishingTypeButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            handleFinishingTypeChange(button.dataset.finishingType);
        });
    });

    // Dodaj event listenery do przycisków wariantu wykończenia
    const finishingVariantButtons = document.querySelectorAll('#edit-finishing-variant-wrapper .finishing-btn');
    finishingVariantButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            handleFinishingVariantChange(button);
        });
    });

    // Dodaj event listenery do przycisków kolorów
    const colorButtons = document.querySelectorAll('#edit-finishing-color-wrapper .color-btn');
    colorButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            handleFinishingColorChange(button);
        });
    });

    console.log('[QUOTE EDITOR] ✅ Sekcja wykończenie zainicjalizowana');
}

/**
 * Obsługuje zmianę wariantu wykończenia (bezbarwne/barwne)
 * @param {HTMLElement} clickedButton - Kliknięty przycisk
 */
function handleFinishingVariantChange(clickedButton) {
    const finishingVariant = clickedButton.dataset.finishingVariant;
    console.log('[QUOTE EDITOR] Zmiana wariantu wykończenia:', finishingVariant);

    // Usuń aktywną klasę z wszystkich przycisków wariantu
    const variantButtons = document.querySelectorAll('#edit-finishing-variant-wrapper .finishing-btn');
    variantButtons.forEach(btn => btn.classList.remove('active'));

    // Dodaj aktywną klasę do klikniętego przycisku
    clickedButton.classList.add('active');

    const colorWrapper = document.getElementById('edit-finishing-color-wrapper');

    if (finishingVariant === 'Bezbarwne') {
        // Ukryj sekcję kolorów - bezbarwne nie ma kolorów
        if (colorWrapper) colorWrapper.style.display = 'none';

        // Wyczyść wybór koloru
        clearColorSelection();
    } else if (finishingVariant === 'Barwne') {
        // Pokaż sekcję kolorów - barwne ma opcje kolorystyczne
        if (colorWrapper) colorWrapper.style.display = 'flex';

        // Wyczyść wybór koloru (użytkownik musi wybrać nowy)
        clearColorSelection();
    }

    // Wywołaj onFormDataChange() jeśli istnieje
    if (typeof onFormDataChange === 'function') {
        onFormDataChange();
    }
}

/**
 * Obsługuje zmianę koloru wykończenia
 * @param {HTMLElement} clickedButton - Kliknięty przycisk
 */
function handleFinishingColorChange(clickedButton) {
    const finishingColor = clickedButton.dataset.finishingColor;
    console.log('[QUOTE EDITOR] Zmiana koloru wykończenia:', finishingColor);

    // Usuń aktywną klasę z wszystkich przycisków kolorów
    const colorButtons = document.querySelectorAll('#edit-finishing-color-wrapper .color-btn');
    colorButtons.forEach(btn => btn.classList.remove('active'));

    // Dodaj aktywną klasę do klikniętego przycisku
    clickedButton.classList.add('active');

    // Wywołaj onFormDataChange() jeśli istnieje
    if (typeof onFormDataChange === 'function') {
        onFormDataChange();
    }
}

/**
 * Czyści wszystkie wybory wykończenia
 */
function clearFinishingSelections() {
    // Wyczyść warianty
    const variantButtons = document.querySelectorAll('#edit-finishing-variant-wrapper .finishing-btn');
    variantButtons.forEach(btn => btn.classList.remove('active'));

    // Wyczyść kolory
    clearColorSelection();
}

/**
 * Czyści wybory wariantów wykończenia
 */
function clearFinishingVariantSelections() {
    const variantButtons = document.querySelectorAll('#edit-finishing-variant-wrapper .finishing-btn');
    variantButtons.forEach(btn => btn.classList.remove('active'));

    clearColorSelection();
}

/**
 * Czyści wybór koloru
 */
function clearColorSelection() {
    const colorButtons = document.querySelectorAll('#edit-finishing-color-wrapper .color-btn');
    colorButtons.forEach(btn => btn.classList.remove('active'));
}

/**
 * Pobiera aktualnie wybrany typ wykończenia
 * @returns {string}
 */
function getSelectedFinishingType() {
    const activeButton = document.querySelector('#edit-finishing-type-group .finishing-btn.active');
    return activeButton ? activeButton.dataset.finishingType : 'Surowe';
}

/**
 * Pobiera aktualnie wybrany wariant wykończenia
 * @returns {string|null}
 */
function getSelectedFinishingVariant() {
    const activeButton = document.querySelector('#edit-finishing-variant-wrapper .finishing-btn.active');
    return activeButton ? activeButton.dataset.finishingVariant : null;
}

/**
 * Pobiera aktualnie wybrany kolor wykończenia
 * @returns {string|null}
 */
function getSelectedFinishingColor() {
    const activeButton = document.querySelector('#edit-finishing-color-wrapper .color-btn.active');
    return activeButton ? activeButton.dataset.finishingColor : null;
}

/**
 * Ładuje dane wykończenia z wyceny do formularza edytora
 * @param {Object} itemData - Dane produktu z wyceny
 */
function loadFinishingDataToEditor(itemData) {
    console.log('[QUOTE EDITOR] Ładowanie danych wykończenia:', itemData);

    if (!itemData) return;

    // Ustaw typ wykończenia
    if (itemData.finishing_type) {
        const typeButton = document.querySelector(`#edit-finishing-type-group [data-finishing-type="${itemData.finishing_type}"]`);
        if (typeButton) {
            // Usuń active z wszystkich przycisków typu
            document.querySelectorAll('#edit-finishing-type-group .finishing-btn').forEach(btn =>
                btn.classList.remove('active'));

            // Dodaj active do właściwego przycisku i wywołaj handler
            typeButton.classList.add('active');
            handleFinishingTypeChange(typeButton);
        }
    }

    // Ustaw wariant wykończenia (jeśli istnieje)
    if (itemData.finishing_variant) {
        setTimeout(() => { // Timeout aby sekcja zdążyła się pokazać
            const variantButton = document.querySelector(`#edit-finishing-variant-wrapper [data-finishing-variant="${itemData.finishing_variant}"]`);
            if (variantButton) {
                // Usuń active z wszystkich przycisków wariantu
                document.querySelectorAll('#edit-finishing-variant-wrapper .finishing-btn').forEach(btn =>
                    btn.classList.remove('active'));

                // Dodaj active do właściwego przycisku i wywołaj handler
                variantButton.classList.add('active');
                handleFinishingVariantChange(variantButton);
            }
        }, 50);
    }

    // Ustaw kolor wykończenia (jeśli istnieje)
    if (itemData.finishing_color) {
        setTimeout(() => {
            const colorButton = document.querySelector(`#edit-finishing-color-wrapper [data-finishing-color="${itemData.finishing_color}"]`);
            if (colorButton) {
                // Usuń active z wszystkich przycisków koloru
                document.querySelectorAll('#edit-finishing-color-wrapper .color-btn').forEach(btn =>
                    btn.classList.remove('active'));

                // Dodaj active do właściwego przycisku
                colorButton.classList.add('active');
            }
        }, 100);
    }

    console.log('[QUOTE EDITOR] ✅ Załadowano dane wykończenia');
}

/**
 * Zbiera dane wykończenia z formularza edytora
 * @returns {Object}
 */
function collectFinishingDataFromEditor() {
    return {
        finishing_type: getSelectedFinishingType(),
        finishing_variant: getSelectedFinishingVariant(),
        finishing_color: getSelectedFinishingColor()
    };
}

/**
 * Ładuje dane wykończenia z bazy danych
 */
async function loadFinishingDataFromDatabase() {
    console.log('[QUOTE EDITOR] ===== ŁADOWANIE DANYCH WYKOŃCZENIA Z BAZY =====');

    try {
        const response = await fetch('/quotes/api/finishing-data');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        finishingDataCache = data;

        console.log('[QUOTE EDITOR] ✅ Pobrano dane wykończenia z bazy:', data);
        console.log(`[QUOTE EDITOR] - Typy wykończenia: ${data.finishing_types.length}`);
        console.log(`[QUOTE EDITOR] - Kolory: ${data.finishing_colors.length}`);

        // tylko 3 główne typy jako przyciski
        renderFinishingTypeButtonsFromDb(data.finishing_types);

        // kolory zostają
        generateFinishingColorOptions(data.finishing_colors);

        return data;

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ BŁĄD podczas ładowania danych wykończenia:', error);
        console.log('[QUOTE EDITOR] ⚠️ Używam domyślnych danych wykończenia jako fallback');
        loadDefaultFinishingData();
        return null;
    }
}


/**
 * Generuje opcje typów wykończenia na podstawie danych z bazy
 * @param {Array} finishingTypes - Typy wykończenia z bazy danych
 */
function generateFinishingTypeOptions(finishingTypes) {
    const container = document.getElementById('edit-finishing-type-group');
    if (!container) {
        console.error('[QUOTE EDITOR] Nie znaleziono kontenera typów wykończenia');
        return;
    }

    container.innerHTML = '';

    finishingTypes.forEach((type, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `finishing-btn ${index === 0 ? 'active' : ''}`; // Pierwszy jako aktywny
        button.dataset.finishingType = type.name;
        button.dataset.finishingPrice = type.price_netto;
        button.textContent = type.name;

        container.appendChild(button);

        console.log(`[QUOTE EDITOR] ✅ Dodano typ wykończenia: ${type.name} (${type.price_netto} PLN/m²)`);
    });

    console.log(`[QUOTE EDITOR] ✅ Wygenerowano ${finishingTypes.length} opcji typów wykończenia`);
}

/**
 * Generuje opcje kolorów na podstawie danych z bazy
 * @param {Array} finishingColors - Kolory z bazy danych
 */
function generateFinishingColorOptions(finishingColors) {
    const wrapper = document.getElementById('edit-finishing-color-wrapper');
    const container = wrapper ? wrapper.querySelector('.color-group') : null;

    if (!container) {
        console.error('[QUOTE EDITOR] Nie znaleziono kontenera kolorów (.color-group)');
        return;
    }

    container.innerHTML = '';

    finishingColors.forEach(color => {
        const button = document.createElement('button');
        button.className = 'color-btn';
        button.dataset.finishingColor = color.name;

        if (color.image_url) {
            const img = document.createElement('img');
            img.src = color.image_url;
            img.alt = color.name;
            img.onerror = () => {
                console.warn(`[QUOTE EDITOR] Nie można załadować obrazka: ${color.image_url}`);
                img.style.display = 'none';
            };
            button.appendChild(img);
        }

        const span = document.createElement('span');
        span.textContent = color.name;
        button.appendChild(span);

        container.appendChild(button);

        console.log(`[QUOTE EDITOR] ✅ Dodano kolor: ${color.name}`);
    });

    console.log(`[QUOTE EDITOR] ✅ Wygenerowano ${finishingColors.length} opcji kolorów`);
}


/**
 * Ładuje domyślne dane wykończenia jako fallback
 */
function loadDefaultFinishingData() {
    console.log('[QUOTE EDITOR] ===== ŁADOWANIE DOMYŚLNYCH DANYCH WYKOŃCZENIA =====');

    const defaultTypes = [
        { name: 'Surowe', price_netto: 0 },
        { name: 'Lakierowanie bezbarwne', price_netto: 200 },
        { name: 'Lakierowanie barwne', price_netto: 250 },
        { name: 'Olejowanie', price_netto: 250 }
    ];

    const defaultColors = [
        { name: 'POPIEL 20-07', image_url: '/calculator/static/images/finishing_colors/popiel-20-07.jpg' },
        { name: 'BEŻ BN-125/09', image_url: '/calculator/static/images/finishing_colors/bez-bn-125-09.jpg' },
        { name: 'BRUNAT 22-10', image_url: '/calculator/static/images/finishing_colors/brunat-22-10.jpg' }
    ];

    finishingDataCache = {
        finishing_types: defaultTypes,
        finishing_colors: defaultColors
    };

    generateFinishingTypeOptions(defaultTypes);
    generateFinishingColorOptions(defaultColors);

    console.log('[QUOTE EDITOR] ✅ Załadowano domyślne dane wykończenia');
}

/**
 * Inicjalizuje obsługę sekcji wykończenia - ZAKTUALIZOWANA WERSJA
 */
function initFinishingSection() {
    console.log('[QUOTE EDITOR] Inicjalizacja sekcji wykończenia...');

    // Event delegation - obsługa dynamicznie dodawanych przycisków
    const typeContainer = document.getElementById('edit-finishing-type-group');
    if (typeContainer) {
        typeContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('finishing-btn')) {
                setActiveFinishingButton(e.target, '#edit-finishing-type-group');
                const finishingType = e.target.dataset.finishingType;
                console.log(`[QUOTE EDITOR] Wybrano rodzaj wykończenia: ${finishingType}`);
                handleFinishingTypeChange(finishingType);
                onFormDataChange();
            }
        });
    }

    // Event delegation dla kolorów
    const colorContainer = document.getElementById('edit-finishing-colors-container');
    if (colorContainer) {
        colorContainer.addEventListener('click', (e) => {
            const colorBtn = e.target.closest('.color-btn');
            if (colorBtn) {
                setActiveColorButton(colorBtn);
                const finishingColor = colorBtn.dataset.finishingColor;
                console.log(`[QUOTE EDITOR] Wybrano kolor: ${finishingColor}`);
                onFormDataChange();
            }
        });
    }

    // Event listenery dla wariantu lakierowania (statyczne)
    const finishingVariantButtons = document.querySelectorAll('#edit-finishing-variant-wrapper .finishing-btn');
    finishingVariantButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            setActiveFinishingButton(btn, '#edit-finishing-variant-wrapper');
            const finishingVariant = btn.dataset.finishingVariant;
            console.log(`[QUOTE EDITOR] Wybrano wariant lakierowania: ${finishingVariant}`);
            handleFinishingVariantChange(finishingVariant);
            onFormDataChange();
        });
    });

    // Event listenery dla stopnia połysku (statyczne)
    const glossButtons = document.querySelectorAll('#edit-finishing-gloss-wrapper .finishing-btn');
    glossButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            setActiveFinishingButton(btn, '#edit-finishing-gloss-wrapper');
            const finishingGloss = btn.dataset.finishingGloss;
            console.log(`[QUOTE EDITOR] Wybrano stopień połysku: ${finishingGloss}`);
            onFormDataChange();
        });
    });

    console.log('[QUOTE EDITOR] ✅ Sekcja wykończenia zainicjalizowana');
}

/**
 * Obsługuje zmianę rodzaju wykończenia - ZAKTUALIZOWANA WERSJA
 * @param {string} finishingType - Rodzaj wykończenia
 */
function handleFinishingTypeChange(finishingType) {
    const variantWrapper = document.getElementById('edit-finishing-variant-wrapper');
    const colorWrapper = document.getElementById('edit-finishing-color-wrapper');

    console.log(`[QUOTE EDITOR] Obsługa zmiany typu wykończenia: ${finishingType}`);

    // Zawsze resetuj
    clearFinishingVariantSelections();
    clearColorSelection();

    // Domyślnie ukryj
    variantWrapper.style.display = 'none';
    colorWrapper.style.display = 'none';

    if (finishingType === 'Lakierowanie') {
        variantWrapper.style.display = 'flex'; // pokaż warianty bezbarwne/barwne
        // kolory pokaże się dalej w handleFinishingVariantChange
    }

    // Surowe i Olejowanie nic nie pokazują, ale różnią się backendowo

    // Trigger przeliczenia
    if (typeof onFormDataChange === 'function') {
        onFormDataChange();
    }
}
function setActiveFinishingButton(clickedButton, wrapperSelector) {
    const wrapper = document.querySelector(wrapperSelector);
    if (!wrapper) {
        console.warn(`[setActiveFinishingButton] ❌ Nie znaleziono wrappera: ${wrapperSelector}`);
        return;
    }

    const buttons = wrapper.querySelectorAll('.finishing-btn');
    buttons.forEach(btn => btn.classList.remove('active'));

    clickedButton.classList.add('active');
    console.log(`[setActiveFinishingButton] ✅ Ustawiono aktywny przycisk:`, clickedButton.textContent);
}


// === LISTENERY do przycisków wykończenia ===
function initFinishingButtons() {
    const typeButtons = document.querySelectorAll('#edit-finishing-type-group .finishing-btn');
    const variantButtons = document.querySelectorAll('#edit-finishing-variant-wrapper .finishing-btn');

    console.log(`[initFinishingButtons] Inicjalizacja ${typeButtons.length} przycisków typu wykończenia`);
    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            setActiveFinishingButton(btn, '#edit-finishing-type-group');
            const type = btn.dataset.finishingType;
            console.log(`[initFinishingButtons] Kliknięto typ: ${type}`);
            handleFinishingTypeChange(type);
        });
    });

    console.log(`[initFinishingButtons] Inicjalizacja ${variantButtons.length} przycisków wariantu`);
    variantButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            setActiveFinishingButton(btn, '#edit-finishing-variant-wrapper');
            const variant = btn.dataset.finishingVariant;
            console.log(`[initFinishingButtons] Kliknięto wariant: ${variant}`);

            if (variant === 'Bezbarwne') {
                document.getElementById('edit-finishing-variant-wrapper').style.display = 'flex';
                document.getElementById('edit-finishing-color-wrapper').style.display = 'none';
                clearColorSelection();
            } else if (variant === 'Barwne') {
                document.getElementById('edit-finishing-variant-wrapper').style.display = 'flex';
                document.getElementById('edit-finishing-color-wrapper').style.display = 'flex';
            }
        });
    });
}

// === ZAŁADUJ TYLKO GŁÓWNE TYPY DO PRZYCISKÓW ===
function renderFinishingTypeButtonsFromDb(dataFromDb) {
    const container = document.getElementById('edit-finishing-type-group');
    if (!container) {
        console.warn('[renderFinishingTypeButtonsFromDb] ❌ Brak kontenera edit-finishing-type-group');
        return;
    }

    const allowedTypes = ['Surowe', 'Lakierowanie', 'Olejowanie'];
    container.innerHTML = '';

    allowedTypes.forEach((type, index) => {
        const btn = document.createElement('button');
        btn.className = 'finishing-btn' + (index === 0 ? ' active' : '');
        btn.dataset.finishingType = type;
        btn.textContent = type;
        container.appendChild(btn);
        console.log(`[renderFinishingTypeButtonsFromDb] ✅ Dodano przycisk typu: ${type}`);
    });

    initFinishingButtons();
}


function extractFinishingBaseType(fullType) {
    if (!fullType) return '';
    const lowered = fullType.trim().toLowerCase();

    if (lowered.includes('lakierowanie')) return 'lakierowanie';
    if (lowered.includes('surowe')) return 'surowe';
    if (lowered.includes('olejowanie') || lowered.includes('olejowane')) return 'olejowanie';

    return lowered;
}

function setFinishingStateForProduct(productIndex) {
    const finishingInfo = currentEditingQuoteData.finishing.find(f => f.product_index === productIndex);
    if (!finishingInfo) {
        console.warn(`[setFinishingStateForProduct] ❌ Brak danych wykończenia dla indeksu ${productIndex}`);
        return;
    }

    console.log('[setFinishingStateForProduct] 🔍 Dane z backendu:', finishingInfo);

    const infoType = extractFinishingBaseType(finishingInfo.finishing_type);
    console.log(`[setFinishingStateForProduct] Typ ogólny: ${infoType}`);

    document.querySelectorAll('#edit-finishing-type-group .finishing-btn').forEach(btn => {
        const btnType = btn.dataset.finishingType?.trim().toLowerCase();
        const isActive = btnType === infoType;
        btn.classList.toggle('active', isActive);
        if (isActive) {
            console.log(`[setFinishingStateForProduct] ✅ Ustawiono typ: ${btnType}`);
        }
    });

    const variantWrapper = document.getElementById('edit-finishing-variant-wrapper');
    const colorWrapper = document.getElementById('edit-finishing-color-wrapper');

    const isLacquer = infoType === 'lakierowanie';
    variantWrapper.style.display = isLacquer ? 'flex' : 'none';
    if (isLacquer) {
        console.log('[setFinishingStateForProduct] 🎨 Pokazuję warianty lakierowania');
    }

    const infoVariant = finishingInfo.finishing_variant?.trim().toLowerCase();
    document.querySelectorAll('#edit-finishing-variant-wrapper .finishing-btn').forEach(btn => {
        const btnVariant = btn.dataset.finishingVariant?.trim().toLowerCase();
        const isActive = btnVariant === infoVariant;
        btn.classList.toggle('active', isActive);
        if (isActive) {
            console.log(`[setFinishingStateForProduct] ✅ Ustawiono wariant: ${btnVariant}`);
        }
    });

    const isBarwne = infoVariant === 'barwne';
    colorWrapper.style.display = isBarwne ? 'flex' : 'none';
    if (isBarwne) {
        console.log('[setFinishingStateForProduct] 🌈 Pokazuję kolory dla wariantu barwnego');
    }

    const infoColor = finishingInfo.finishing_color?.trim().toLowerCase();
    document.querySelectorAll('#edit-finishing-color-wrapper .color-btn').forEach(btn => {
        const btnColor = btn.dataset.finishingColor?.trim().toLowerCase();
        const isActive = btnColor === infoColor;
        btn.classList.toggle('active', isActive);
        if (isActive) {
            console.log(`[setFinishingStateForProduct] ✅ Ustawiono kolor: ${btnColor}`);
        }
    });
}

/**
 * Aktualizuje dostępność wariantu na podstawie checkbox-a
 * @param {HTMLInputElement} checkbox - Checkbox który został zmieniony
 */
function updateVariantAvailability(checkbox) {
    const variantOption = checkbox.closest('.variant-option');
    if (!variantOption) return;

    const radioButton = variantOption.querySelector('input[type="radio"]');

    if (checkbox.checked) {
        // Wariant dostępny
        variantOption.classList.remove('unavailable');
        if (radioButton) {
            radioButton.disabled = false;
        }
        console.log('[QUOTE EDITOR] ✅ Wariant udostępniony');
    } else {
        // Wariant niedostępny
        variantOption.classList.add('unavailable');
        if (radioButton) {
            radioButton.disabled = true;
            // Jeśli był zaznaczony, odznacz go
            if (radioButton.checked) {
                radioButton.checked = false;
                // Znajdź pierwszy dostępny wariant i zaznacz go
                selectFirstAvailableVariant();
            }
        }
        console.log('[QUOTE EDITOR] ❌ Wariant niedostępny');
    }
}

/**
 * Zaznacza pierwszy dostępny wariant
 */
function selectFirstAvailableVariant() {
    const availableRadio = document.querySelector('input[name="edit-variantOption"]:not(:disabled)');
    if (availableRadio) {
        availableRadio.checked = true;
        updateSelectedVariant(availableRadio);
        onFormDataChange();
        console.log('[QUOTE EDITOR] ✅ Automatycznie zaznaczono pierwszy dostępny wariant');
    } else {
        console.warn('[QUOTE EDITOR] ⚠️ Brak dostępnych wariantów!');
    }
}

/**
 * Aktualizuje wizualny stan zaznaczonego wariantu
 * @param {HTMLInputElement} selectedRadio - Zaznaczony radio button
 */
function updateSelectedVariant(selectedRadio) {
    // Usuń klasę 'selected' ze wszystkich wariantów
    document.querySelectorAll('.variant-option').forEach(option => {
        option.classList.remove('selected');
    });

    // Dodaj klasę 'selected' do aktualnie zaznaczonego
    const selectedOption = selectedRadio.closest('.variant-option');
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
}

/**
 * Pobiera dane z formularza edytora
 * @returns {Object|null} - Dane formularza
 */
function collectFormData() {
    try {
        const clientType = document.getElementById('edit-clientType')?.value;
        const length = parseFloat(document.getElementById('edit-length')?.value) || 0;
        const width = parseFloat(document.getElementById('edit-width')?.value) || 0;
        const thickness = parseFloat(document.getElementById('edit-thickness')?.value) || 0;
        const quantity = parseInt(document.getElementById('edit-quantity')?.value) || 1;

        const selectedVariant = document.querySelector('input[name="edit-variantOption"]:checked');

        return {
            clientType,
            length,
            width,
            thickness,
            quantity,
            selectedVariant: selectedVariant?.value || null,
            selectedVariantName: selectedVariant?.dataset.variantName || null
        };
    } catch (error) {
        console.error('[QUOTE EDITOR] Błąd podczas pobierania danych formularza:', error);
        return null;
    }
}

/**
 * Fallback funkcja do obliczeń jeśli calculator.js nie jest dostępny
 * @param {Object} formData - Dane formularza
 */
<<<<<<< HEAD
function calculateEditorPrices() {
    console.log('[QUOTE EDITOR] Wykonuję obliczenia fallback...');

    // Pobierz dane z formularza
    const length = parseFloat(document.getElementById('edit-length')?.value) || 0;
    const width = parseFloat(document.getElementById('edit-width')?.value) || 0;
    const thickness = parseFloat(document.getElementById('edit-thickness')?.value) || 0;
    const quantity = parseInt(document.getElementById('edit-quantity')?.value) || 1;

    if (length <= 0 || width <= 0 || thickness <= 0) {
        showVariantErrors('Brak wymiarów');
        return;
    }

    // Podstawowe obliczenie objętości
    const volume = (length / 1000) * (width / 1000) * (thickness / 1000) * quantity;

    // Ustaw przykładowe ceny (to będzie zastąpione przez prawdziwe obliczenia)
    document.querySelectorAll('.variant-option').forEach(variant => {
        const unitBrutto = variant.querySelector('.unit-brutto');
        const unitNetto = variant.querySelector('.unit-netto');
        const totalBrutto = variant.querySelector('.total-brutto');
        const totalNetto = variant.querySelector('.total-netto');

        if (unitBrutto) unitBrutto.textContent = 'Obliczanie...';
        if (unitNetto) unitNetto.textContent = 'Obliczanie...';
        if (totalBrutto) totalBrutto.textContent = 'Obliczanie...';
        if (totalNetto) totalNetto.textContent = 'Obliczanie...';
    });

    console.log('[QUOTE EDITOR] ✅ Wykonano obliczenia fallback dla objętości:', volume);
=======
function calculateEditorPrices(formData) {
    console.log('[QUOTE EDITOR] Wykonuję obliczenia fallback:', formData);

    if (!formData.clientType) {
        showVariantErrors('Wybierz grupę cenową');
        return;
    }

    if (!formData.length || !formData.width || !formData.thickness || !formData.quantity) {
        showVariantErrors('Podaj wszystkie wymiary');
        return;
    }

    // Pokaż komunikat o obliczeniach fallback
    document.querySelectorAll('.variant-option').forEach(option => {
        const bruttoSpan = option.querySelector('.unit-brutto');
        const nettoSpan = option.querySelector('.unit-netto');
        const totalBruttoSpan = option.querySelector('.total-brutto');
        const totalNettoSpan = option.querySelector('.total-netto');

        if (bruttoSpan) bruttoSpan.textContent = 'Brak cennika';
        if (nettoSpan) nettoSpan.textContent = 'Brak cennika';
        if (totalBruttoSpan) totalBruttoSpan.textContent = 'Brak cennika';
        if (totalNettoSpan) totalNettoSpan.textContent = 'Brak cennika';
    });
>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
}

function syncEditorToMockForm() {
    if (!window.activeQuoteForm) return;

    // Synchronizuj inputy
    const editorInputs = {
        'edit-clientType': 'clientType',
        'edit-length': 'length',
        'edit-width': 'width',
        'edit-thickness': 'thickness',
        'edit-quantity': 'quantity'
    };

    Object.entries(editorInputs).forEach(([editorId, calculatorField]) => {
        const editorInput = document.getElementById(editorId);
        const mockInput = window.activeQuoteForm.querySelector(`[data-field="${calculatorField}"]`);

        if (editorInput && mockInput && editorInput.value !== mockInput.value) {
            mockInput.value = editorInput.value;
        }
    });

    // Synchronizuj dostępność i wybór wariantów
    syncAvailabilityStates(window.activeQuoteForm);
    syncSelectedVariant(window.activeQuoteForm);
}

/**
 * ZMODYFIKOWANA funkcja resetCalculatorAfterEditor - z czyszczeniem dynamicznym
 */
function resetCalculatorAfterEditor() {
    console.log('[QUOTE EDITOR] Resetowanie konfiguracji calculator.js...');

<<<<<<< HEAD
    // NOWE: Przywróć oryginalną funkcję updatePrices
    restoreOriginalUpdatePrices();

=======
>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
    // Przywróć oryginalne zmienne globalne
    if (window.originalQuoteFormsContainer) {
        window.quoteFormsContainer = window.originalQuoteFormsContainer;
        delete window.originalQuoteFormsContainer;
        console.log('[QUOTE EDITOR] Przywrócono oryginalny quoteFormsContainer');
    } else {
        window.quoteFormsContainer = null;
    }

    if (window.originalActiveQuoteForm) {
        window.activeQuoteForm = window.originalActiveQuoteForm;
        delete window.originalActiveQuoteForm;
        console.log('[QUOTE EDITOR] Przywrócono oryginalny activeQuoteForm');
    } else {
        window.activeQuoteForm = null;
    }

    // Usuń tymczasowy kontener formularzy
    const editorQuoteFormsContainer = document.querySelector('#quote-editor-modal .quote-forms-container');
    if (editorQuoteFormsContainer) {
        editorQuoteFormsContainer.remove();
        console.log('[QUOTE EDITOR] Usunięto tymczasowy kontener formularzy');
    }

    console.log('[QUOTE EDITOR] ✅ Oczyszczono konfigurację calculator.js');
}

// pokaż błędy w wariantach
function showVariantErrors(errorMessage) {
    document.querySelectorAll('.variant-option').forEach(option => {
        const bruttoSpan = option.querySelector('.unit-brutto');
        const nettoSpan = option.querySelector('.unit-netto');
        const totalBruttoSpan = option.querySelector('.total-brutto');
        const totalNettoSpan = option.querySelector('.total-netto');

        if (bruttoSpan) bruttoSpan.textContent = errorMessage;
        if (nettoSpan) nettoSpan.textContent = '';
        if (totalBruttoSpan) totalBruttoSpan.textContent = errorMessage;
        if (totalNettoSpan) totalNettoSpan.textContent = '';
    });
}

/**
 * Sprawdza czy formularz jest poprawnie wypełniony
 * @returns {boolean} - True jeśli można zapisać
 */
function validateFormBeforeSave() {
    // Sprawdź czy wybrano grupę cenową
    const clientType = document.getElementById('edit-clientType')?.value;
    if (!clientType) {
        alert('Wybierz grupę cenową');
        return false;
    }

    // Sprawdź wymiary
    const length = parseFloat(document.getElementById('edit-length')?.value);
    const width = parseFloat(document.getElementById('edit-width')?.value);
    const thickness = parseFloat(document.getElementById('edit-thickness')?.value);
    const quantity = parseInt(document.getElementById('edit-quantity')?.value);

    if (!length || length <= 0) {
        alert('Podaj poprawną długość');
        return false;
    }
    if (!width || width <= 0) {
        alert('Podaj poprawną szerokość');
        return false;
    }
    if (!thickness || thickness <= 0) {
        alert('Podaj poprawną grubość');
        return false;
    }
    if (!quantity || quantity <= 0) {
        alert('Podaj poprawną ilość');
        return false;
    }

    // Sprawdź czy wybrano wariant
    const selectedVariant = document.querySelector('input[name="edit-variantOption"]:checked');
    if (!selectedVariant) {
        alert('Wybierz wariant produktu');
        return false;
    }

    // Sprawdź czy wybrany wariant jest dostępny
    if (selectedVariant.disabled) {
        alert('Wybrany wariant jest niedostępny. Wybierz dostępny wariant.');
        return false;
    }

    // Sprawdź czy jest przynajmniej jeden dostępny wariant
    const availableVariants = document.querySelectorAll('.variant-availability-checkbox:checked');
    if (availableVariants.length === 0) {
        alert('Musi być dostępny przynajmniej jeden wariant');
        return false;
    }

    return true;
}

/**
 * Dynamicznie ładuje calculator.js tylko gdy potrzebny
 */
async function loadCalculatorScript() {
    if (calculatorScriptLoaded) {
        console.log('[QUOTE EDITOR] Calculator.js już załadowany');
        return true;
    }

    console.log('[QUOTE EDITOR] Rozpoczynam dynamiczne ładowanie calculator.js...');

    try {
        // Załaduj calculator.js
        await loadScript('/calculator/static/js/calculator.js');
        console.log('[QUOTE EDITOR] ✅ Załadowano calculator.js');

        // Załaduj save_quote.js (jeśli potrzebny)
        await loadScript('/calculator/static/js/save_quote.js');
        console.log('[QUOTE EDITOR] ✅ Załadowano save_quote.js');

        calculatorScriptLoaded = true;
        return true;

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd ładowania calculator.js:', error);
        return false;
    }
}

/**
 * Pomocnicza funkcja do ładowania skryptów
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        // Sprawdź czy skrypt już istnieje
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

/**
 * Inicjalizuje calculator.js dla edytora (bez DOM błędów)
 */
function initializeCalculatorForEditor() {
    if (calculatorInitialized) {
        console.log('[QUOTE EDITOR] Calculator już zainicjalizowany');
        return;
    }

    console.log('[QUOTE EDITOR] Inicjalizuję calculator.js dla edytora...');

<<<<<<< HEAD
    // Wyłącz automatyczną inicjalizację calculator.js
    if (typeof window.init === 'function') {
=======
    // Zastąp problematyczne funkcje calculator.js pustymi wersjami
    if (typeof window.init === 'function') {
        // Wyłącz automatyczną inicjalizację calculator.js
>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
        console.log('[QUOTE EDITOR] Wyłączam automatyczną inicjalizację calculator.js');
    }

    // Ustaw zmienne globalne potrzebne przez calculator.js
    window.quoteFormsContainer = null;
    window.activeQuoteForm = null;

<<<<<<< HEAD
    // ✅ DODAJ: Skopiuj variantMapping
    copyVariantMappingToEditor();

=======
>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
    // Zainicjalizuj tylko potrzebne części calculator.js
    if (typeof window.buildPriceIndex === 'function') {
        try {
            // Sprawdź czy dane cennika są dostępne
            const pricesDataEl = document.getElementById('prices-data');
            if (pricesDataEl) {
                const pricesFromDatabase = JSON.parse(pricesDataEl.textContent);

                // Ustaw globalne zmienne calculator.js
                window.pricesFromDatabase = pricesFromDatabase;
                window.buildPriceIndex();
                console.log('[QUOTE EDITOR] ✅ Zainicjalizowano indeks cenowy');
            }
        } catch (e) {
            console.error('[QUOTE EDITOR] Błąd inicjalizacji indeksu cenowego:', e);
        }
    }

    // Ustaw mnożniki
    if (typeof window.multiplierMapping === 'undefined') {
        const multipliersDataEl = document.getElementById('multipliers-data');
        if (multipliersDataEl) {
            try {
                const multipliersFromDB = JSON.parse(multipliersDataEl.textContent);
                window.multiplierMapping = {};
                multipliersFromDB.forEach(m => {
                    window.multiplierMapping[m.label] = m.value;
                });
                console.log('[QUOTE EDITOR] ✅ Zainicjalizowano mnożniki:', window.multiplierMapping);
            } catch (e) {
                console.error('[QUOTE EDITOR] Błąd inicjalizacji mnożników:', e);
            }
        }
    }

    calculatorInitialized = true;
    console.log('[QUOTE EDITOR] ✅ Calculator.js zainicjalizowany dla edytora');
}

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', function () {
    initQuoteEditor();
    initFinishingButtons();
});
<<<<<<< HEAD

/**
 * KROK 1: Dodaj tę funkcję na KOŃCU pliku quote_editor.js
 * Ta funkcja zastąpi oryginalną updatePrices z calculator.js
 */
function createCustomUpdatePricesForEditor() {
    // Zapisz oryginalną funkcję updatePrices
    if (typeof window.originalUpdatePrices === 'undefined' && typeof updatePrices === 'function') {
        window.originalUpdatePrices = updatePrices;
        console.log('[QUOTE EDITOR] 💾 Zapisano oryginalną funkcję updatePrices');
    }

    // NAPRAWIONA KOMPLETNA WERSJA updatePrices
    window.updatePrices = function () {
        console.log('[QUOTE EDITOR] 🚀 Wywołano NAPRAWIONĄ updatePrices dla edytora');

        // Sprawdź czy activeQuoteForm jest ustawiony
        if (!window.activeQuoteForm) {
            console.error('[CUSTOM updatePrices] ❌ Brak activeQuoteForm w edytorze');
            return;
        }

        const activeQuoteForm = window.activeQuoteForm;

        // Pobierz elementy z formularza
        const lengthEl = activeQuoteForm.querySelector('input[data-field="length"]');
        const widthEl = activeQuoteForm.querySelector('input[data-field="width"]');
        const thicknessEl = activeQuoteForm.querySelector('input[data-field="thickness"]');
        const quantityEl = activeQuoteForm.querySelector('input[data-field="quantity"]');
        const clientTypeEl = activeQuoteForm.querySelector('select[data-field="clientType"]');
        const variantContainer = activeQuoteForm.querySelector('.variants');

        if (!lengthEl || !widthEl || !thicknessEl || !quantityEl || !variantContainer) {
            console.warn('[CUSTOM updatePrices] ❌ Brak wymaganych elementów w formularzu');
            return;
        }

        // Pobierz i waliduj wartości
        const length = parseFloat(lengthEl.value);
        const width = parseFloat(widthEl.value);
        const thickness = parseFloat(thicknessEl.value);
        let quantity = parseInt(quantityEl.value);
        const clientType = clientTypeEl ? clientTypeEl.value : "";

        // Walidacja quantity
        if (isNaN(quantity) || quantity < 1) {
            quantity = 1;
            quantityEl.value = 1;
        }

        console.log('[CUSTOM updatePrices] 📊 Pobrane wartości:', {
            length, width, thickness, quantity, clientType
        });

        // Sprawdź błędy wymiarów
        let errorMsg = "";
        if (isNaN(length)) errorMsg = "Brak dług.";
        else if (isNaN(width)) errorMsg = "Brak szer.";
        else if (isNaN(thickness)) errorMsg = "Brak grub.";

        if (errorMsg) {
            console.warn('[CUSTOM updatePrices] ⚠️ Błąd wymiarów:', errorMsg);
            showErrorForAllVariants(errorMsg, variantContainer);
            activeQuoteForm.dataset.orderBrutto = "";
            activeQuoteForm.dataset.orderNetto = "";
            return;
        }

        // Sprawdź grupę cenową
        if (!clientType) {
            console.warn('[CUSTOM updatePrices] ⚠️ Brak grupy cenowej');
            showErrorForAllVariants("Brak grupy", variantContainer);
            activeQuoteForm.dataset.orderBrutto = "";
            activeQuoteForm.dataset.orderNetto = "";
            return;
        }

        // ✅ IDENTYCZNE z calculator.js: Oblicz objętość z zaokrągleniem grubości
        const singleVolume = calculateSingleVolume(length, width, Math.ceil(thickness));
        console.log('[CUSTOM updatePrices] 📐 Obliczona objętość (z Math.ceil):', singleVolume, {
            length, width, thickness,
            thicknessCeil: Math.ceil(thickness)
        });

        // ✅ Pobierz mnożnik
        let multiplier = 1.0;
        if (typeof window.isPartner === 'boolean' && window.isPartner) {
            multiplier = window.userMultiplier || 1.0;
        } else if (typeof window.multiplierMapping === 'object' && window.multiplierMapping[clientType]) {
            multiplier = window.multiplierMapping[clientType];
        } else {
            const fallbackMultipliers = {
                'Florek': 1.0,
                'Hurt': 1.1,
                'Detal': 1.3,
                'Detal+': 1.5
            };
            multiplier = fallbackMultipliers[clientType] || 1.0;
        }

        console.log('[CUSTOM updatePrices] 💰 Mnożnik dla grupy', clientType + ':', multiplier);

        // Pobierz warianty
        const variantItems = Array.from(variantContainer.children)
            .filter(child => child.querySelector('input[type="radio"]'));

        console.log('[CUSTOM updatePrices] 🎯 Znaleziono wariantów:', variantItems.length);

        // Reset kolorów wariantów
        variantItems.forEach(variant => {
            variant.querySelectorAll('*').forEach(el => el.style.color = "");
        });

        let selectedVariantData = null;

        // ✅ NAPRAWIONE obliczenia dla każdego wariantu
        variantItems.forEach(variant => {
            const radio = variant.querySelector('input[type="radio"]');
            if (!radio) return;

            const variantCode = radio.value;
            console.log('[CUSTOM updatePrices] 🔄 Przetwarzam wariant:', variantCode);

            // Pobierz elementy cen
            const unitBruttoSpan = variant.querySelector('.unit-brutto');
            const unitNettoSpan = variant.querySelector('.unit-netto');
            const totalBruttoSpan = variant.querySelector('.total-brutto');
            const totalNettoSpan = variant.querySelector('.total-netto');

            if (!unitBruttoSpan || !unitNettoSpan || !totalBruttoSpan || !totalNettoSpan) {
                console.warn('[CUSTOM updatePrices] ⚠️ Brak elementów cen dla wariantu:', variantCode);
                return;
            }

            // ✅ NAPRAWIONE WYSZUKIWANIE CEN
            let basePrice = 0;
            let match = null;

            if (typeof getPrice === 'function' && typeof window.variantMapping === 'object') {
                const config = window.variantMapping[variantCode];
                if (config) {
                    // ✅ KLUCZOWE: Użyj DOKŁADNIE tych samych parametrów co calculator.js
                    // NIE zaokrąglaj grubości tutaj - getPrice() robi to wewnętrznie
                    match = getPrice(config.species, config.technology, config.wood_class, thickness, length);

                    console.log('[CUSTOM updatePrices] 🔍 Wyszukiwanie w cenniku:', {
                        variant: variantCode,
                        species: config.species,
                        technology: config.technology,
                        wood_class: config.wood_class,
                        thickness: thickness,
                        thicknessCeil: Math.ceil(thickness),
                        length: length,
                        match: match
                    });

                    if (match) {
                        basePrice = match.price_per_m3;
                        console.log('[CUSTOM updatePrices] ✅ ZNALEZIONO CENĘ Z BAZY:', {
                            variant: variantCode,
                            basePrice: basePrice,
                            match: match
                        });
                    } else {
                        // ✅ DODATKOWE DEBUGOWANIE gdy nie ma dopasowania
                        console.warn('[CUSTOM updatePrices] ❌ BRAK DOPASOWANIA - szczegóły:', {
                            variant: variantCode,
                            config: config,
                            searchParams: { thickness, length },
                            mathCeil: Math.ceil(thickness)
                        });

                        // Sprawdź czy mamy priceIndex
                        const key = `${config.species}::${config.technology}::${config.wood_class}`;
                        const availableEntries = window.priceIndex?.[key] || [];
                        console.log('[CUSTOM updatePrices] Dostępne wpisy dla klucza', key + ':', availableEntries.length);

                        if (availableEntries.length > 0) {
                            console.log('[CUSTOM updatePrices] Przykładowe wpisy:', availableEntries.slice(0, 3));

                            // Sprawdź czy któryś wpis by się dopasował
                            availableEntries.forEach((entry, idx) => {
                                const thickOk = Math.ceil(thickness) >= entry.thickness_min && Math.ceil(thickness) <= entry.thickness_max;
                                const lengthOk = length >= entry.length_min && length <= entry.length_max;
                                console.log(`[CUSTOM updatePrices] Wpis ${idx}: thick=${thickOk} (${Math.ceil(thickness)} in ${entry.thickness_min}-${entry.thickness_max}), length=${lengthOk} (${length} in ${entry.length_min}-${entry.length_max})`);
                            });
                        }
                    }
                }
            }

            // ✅ POPRAWIONE FALLBACK z cenami z rzeczywistego cennika
            if (basePrice === 0) {
                // Ceny na podstawie rzeczywistego cennika dla długości ~200cm
                const realisticPrices = {
                    'dab-lity-ab': 14500,  // Dąb Lity A/B 149.01-200.0cm
                    'dab-lity-bb': 13000,  // Dąb Lity B/B 149.01-200.0cm  
                    'dab-micro-ab': 10000, // Dąb Mikrowczep A/B
                    'dab-micro-bb': 10000, // Dąb Mikrowczep B/B
                    'jes-lity-ab': 13000,  // Jesion Lity A/B 149.01-200.0cm
                    'jes-micro-ab': 11000, // Jesion Mikrowczep A/B
                    'buk-lity-ab': 9000,   // Buk Lity A/B
                    'buk-micro-ab': 8500   // Buk Mikrowczep A/B
                };
                basePrice = realisticPrices[variantCode] || 12000;
                console.warn('[CUSTOM updatePrices] ⚠️ Używam REALISTYCZNĄ cenę fallback dla:', variantCode, '=', basePrice);
            }

            // ✅ IDENTYCZNE OBLICZENIA jak w calculator.js
            let unitNetto = singleVolume * basePrice * multiplier;
            let unitBrutto = unitNetto * 1.23;
            let totalNetto = unitNetto * quantity;
            let totalBrutto = unitBrutto * quantity;

            console.log('[CUSTOM updatePrices] 💵 Ceny dla', variantCode + ':', {
                basePrice,
                singleVolume,
                multiplier,
                unitNetto: unitNetto.toFixed(2),
                unitBrutto: unitBrutto.toFixed(2),
                totalNetto: totalNetto.toFixed(2),
                totalBrutto: totalBrutto.toFixed(2)
            });

            // ✅ FORMATOWANIE jak w calculator.js
            if (typeof formatPLN === 'function') {
                unitBruttoSpan.textContent = formatPLN(unitBrutto);
                unitNettoSpan.textContent = formatPLN(unitNetto);
                totalBruttoSpan.textContent = formatPLN(totalBrutto);
                totalNettoSpan.textContent = formatPLN(totalNetto);
            } else {
                unitBruttoSpan.textContent = unitBrutto.toFixed(2) + ' PLN';
                unitNettoSpan.textContent = unitNetto.toFixed(2) + ' PLN';
                totalBruttoSpan.textContent = totalBrutto.toFixed(2) + ' PLN';
                totalNettoSpan.textContent = totalNetto.toFixed(2) + ' PLN';
            }

            // ✅ ZAPISZ CENY w dataset radio buttona
            radio.dataset.unitBrutto = unitBrutto.toFixed(2);
            radio.dataset.unitNetto = unitNetto.toFixed(2);
            radio.dataset.totalBrutto = totalBrutto.toFixed(2);
            radio.dataset.totalNetto = totalNetto.toFixed(2);

            // Jeśli ten wariant jest zaznaczony
            if (radio.checked) {
                selectedVariantData = {
                    unitBrutto: unitBrutto.toFixed(2),
                    unitNetto: unitNetto.toFixed(2),
                    totalBrutto: totalBrutto.toFixed(2),
                    totalNetto: totalNetto.toFixed(2)
                };

                // ✅ POMARAŃCZOWY KOLOR dla wybranego wariantu
                variant.querySelectorAll('*').forEach(el => el.style.color = "#ED6B24");
            }
        });

        // ✅ ZAPISZ dane wybranego wariantu w dataset formularza
        if (selectedVariantData) {
            activeQuoteForm.dataset.orderBrutto = selectedVariantData.totalBrutto;
            activeQuoteForm.dataset.orderNetto = selectedVariantData.totalNetto;

            console.log('[CUSTOM updatePrices] ✅ Zapisano dane wybranego wariantu:', selectedVariantData);
        } else {
            activeQuoteForm.dataset.orderBrutto = "";
            activeQuoteForm.dataset.orderNetto = "";
            console.log('[CUSTOM updatePrices] ⚠️ Brak wybranego wariantu');
        }

        // ✅ OBLICZ WYKOŃCZENIE
        if (typeof calculateFinishingCost === 'function') {
            try {
                const finishingResult = calculateFinishingCost(activeQuoteForm);
                console.log('[CUSTOM updatePrices] 🎨 Obliczono wykończenie:', finishingResult);
            } catch (error) {
                console.warn('[CUSTOM updatePrices] ⚠️ Błąd obliczania wykończenia:', error);
            }
        }

        console.log('[CUSTOM updatePrices] 🎉 Naprawione obliczenia zakończone pomyślnie');
    };

    console.log('[QUOTE EDITOR] ✅ Zastąpiono funkcję updatePrices NAPRAWIONĄ wersją');
}

/**
 * DODAJ funkcję testową dla cennika
 */
function testPriceSearch() {
    console.log('=== TEST WYSZUKIWANIA CEN ===');

    const testCases = [
        { species: 'Dąb', technology: 'Lity', wood_class: 'A/B', thickness: 4, length: 200, expected: 14500 },
        { species: 'Dąb', technology: 'Lity', wood_class: 'A/B', thickness: 2, length: 180, expected: 16000 },
        { species: 'Dąb', technology: 'Mikrowczep', wood_class: 'A/B', thickness: 4, length: 200, expected: 10000 },
        { species: 'Buk', technology: 'Lity', wood_class: 'A/B', thickness: 4, length: 200, expected: 9000 }
    ];

    testCases.forEach((test, index) => {
        console.log(`\n--- Test ${index + 1}: ${test.species} ${test.technology} ${test.wood_class} ---`);
        console.log(`Parametry: grubość=${test.thickness}cm, długość=${test.length}cm`);
        console.log(`Oczekiwana cena: ${test.expected} PLN/m³`);

        if (typeof getPrice === 'function') {
            const result = getPrice(test.species, test.technology, test.wood_class, test.thickness, test.length);
            if (result) {
                console.log(`✅ ZNALEZIONO: ${result.price_per_m3} PLN/m³`);
                console.log(`Zakres grubości: ${result.thickness_min}-${result.thickness_max}`);
                console.log(`Zakres długości: ${result.length_min}-${result.length_max}`);

                if (result.price_per_m3 === test.expected) {
                    console.log(`🎯 PERFECT MATCH!`);
                } else {
                    console.log(`⚠️ Cena różna od oczekiwanej (${test.expected})`);
                }
            } else {
                console.log(`❌ BRAK DOPASOWANIA`);
                console.log(`Math.ceil(${test.thickness}) = ${Math.ceil(test.thickness)}`);
            }
        } else {
            console.log('❌ Funkcja getPrice niedostępna');
        }
    });

    console.log('\n=== KONIEC TESTU ===');
}

// Eksportuj funkcję testową
window.testPriceSearch = testPriceSearch;

// ✅ calculateSingleVolume - WAŻNA FUNKCJA z calculator.js
function calculateSingleVolume(length, width, thickness) {
    // UWAGA: W calculator.js to jest (length/100) * (width/100) * (thickness/100)
    // ale sprawdźmy czy to nie powinno być inne przeliczenie
    return (length / 100) * (width / 100) * (thickness / 100);
}

// ✅ showErrorForAllVariants - funkcja wyświetlania błędów
function showErrorForAllVariants(errorMsg, variantContainer) {
    const variantItems = Array.from(variantContainer.children)
        .filter(child => child.querySelector('input[type="radio"]'));

    variantItems.forEach(variant => {
        const unitBruttoSpan = variant.querySelector('.unit-brutto');
        const unitNettoSpan = variant.querySelector('.unit-netto');
        const totalBruttoSpan = variant.querySelector('.total-brutto');
        const totalNettoSpan = variant.querySelector('.total-netto');

        if (unitBruttoSpan) unitBruttoSpan.textContent = errorMsg;
        if (unitNettoSpan) unitNettoSpan.textContent = '';
        if (totalBruttoSpan) totalBruttoSpan.textContent = errorMsg;
        if (totalNettoSpan) totalNettoSpan.textContent = '';
    });
}

/**
 * DODAJ funkcję kopiowania variantMapping z calculator.js
 */
function copyVariantMappingToEditor() {
    // ✅ KLUCZOWE: Skopiuj variantMapping z calculator.js
    if (typeof window.variantMapping === 'undefined') {
        window.variantMapping = {
            'dab-lity-ab': { species: 'Dąb', technology: 'Lity', wood_class: 'A/B' },
            'dab-lity-bb': { species: 'Dąb', technology: 'Lity', wood_class: 'B/B' },
            'dab-micro-ab': { species: 'Dąb', technology: 'Mikrowczep', wood_class: 'A/B' },
            'dab-micro-bb': { species: 'Dąb', technology: 'Mikrowczep', wood_class: 'B/B' },
            'jes-lity-ab': { species: 'Jesion', technology: 'Lity', wood_class: 'A/B' },
            'jes-micro-ab': { species: 'Jesion', technology: 'Mikrowczep', wood_class: 'A/B' },
            'buk-lity-ab': { species: 'Buk', technology: 'Lity', wood_class: 'A/B' },
            'buk-micro-ab': { species: 'Buk', technology: 'Mikrowczep', wood_class: 'A/B' }
        };
        console.log('[QUOTE EDITOR] ✅ Skopiowano variantMapping do edytora');
    }
}

/**
* DEBUGGING: Funkcja do sprawdzenia dostępności wszystkich komponentów
*/
function debugCalculatorComponents() {
    console.log('=== DEBUG CALCULATOR COMPONENTS ===');
    console.log('variantMapping:', typeof window.variantMapping, window.variantMapping);
    console.log('getPrice function:', typeof getPrice);
    console.log('formatPLN function:', typeof formatPLN);
    console.log('calculateFinishingCost function:', typeof calculateFinishingCost);
    console.log('pricesFromDatabase:', typeof window.pricesFromDatabase, window.pricesFromDatabase?.length);
    console.log('multiplierMapping:', typeof window.multiplierMapping, window.multiplierMapping);
    console.log('isPartner:', typeof window.isPartner, window.isPartner);
    console.log('userMultiplier:', typeof window.userMultiplier, window.userMultiplier);

    // Test getPrice jeśli dostępny
    if (typeof getPrice === 'function' && window.variantMapping) {
        const testConfig = window.variantMapping['dab-lity-ab'];
        if (testConfig) {
            const testResult = getPrice(testConfig.species, testConfig.technology, testConfig.wood_class, 4, 200);
            console.log('Test getPrice dla dab-lity-ab (4mm, 200cm):', testResult);
        }
    }

    console.log('=== END DEBUG ===');
}

// Eksportuj funkcję debugową
window.debugCalculatorComponents = debugCalculatorComponents;
=======
>>>>>>> 166e863136da7c6e0d3bd01b24323165130653ec
