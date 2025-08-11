/**
 * Quote Editor - Edycja wycen w module quotes
 * Wykorzystuje logikę z modułu calculator
 * ZOPTYMALIZOWANA WERSJA
 */

// ==================== ZMIENNE GLOBALNE ====================
let currentEditingQuoteData = null;
let activeProductIndex = null;
let clientTypesCache = null;
let finishingDataCache = null;
let calculatorScriptLoaded = false;
let calculatorInitialized = false;

// Optimized logging - centralized debug control
const DEBUG_LOGS = {
    editor: true,
    calculator: true,
    finishing: true,
    sync: true
};

// Centralized logger to reduce repetitive logging
function log(category, message, data = null) {
    if (DEBUG_LOGS[category] || DEBUG_LOGS.editor) {
        const prefix = `[QUOTE EDITOR ${category.toUpperCase()}]`;
        if (data) {
            console.log(prefix, message, data);
        } else {
            console.log(prefix, message);
        }
    }
}

// ==================== GŁÓWNE FUNKCJE EDYTORA ====================

/**
 * Główna funkcja otwierania edytora - zoptymalizowana
 */
async function openQuoteEditor(quoteData) {
    log('editor', '===== OTWIERANIE EDYTORA WYCENY =====');

    // Walidacja wstępna
    if (!validateQuoteData(quoteData)) return;

    // Przygotowanie środowiska
    currentEditingQuoteData = quoteData;
    const modal = initializeModal();
    if (!modal) return;

    // Batch operations - grupuj operacje DOM
    updateModalHeader(quoteData);
    modal.style.display = 'flex';

    try {
        // Asynchroniczne ładowanie w odpowiedniej kolejności
        await Promise.all([
            loadCalculatorIfNeeded(),
            loadClientTypesFromDatabase()
        ]);

        await initializeFinishingPrices();

        // Synchroniczne operacje po załadowaniu danych
        loadQuoteDataToEditor(quoteData);
        initializeEventListeners();

        // Finalizacja
        setupModalCloseHandlers();
        performInitialCalculations(quoteData);

        log('editor', '✅ Edytor wyceny otwarty pomyślnie');

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ BŁĄD podczas ładowania:', error);
    }
}

/**
 * Walidacja danych wyceny - wydzielona funkcja
 */
function validateQuoteData(quoteData) {
    if (!quoteData?.id) {
        console.error('[QUOTE EDITOR] ❌ Brak danych wyceny');
        alert('Błąd: Brak danych wyceny do edycji');
        return false;
    }

    if (!canEditQuote(quoteData)) {
        console.warn('[QUOTE EDITOR] ⚠️ Wycena nie może być edytowana');
        alert(`Ta wycena nie może być edytowana (status: ${quoteData.status_name || 'nieznany'})`);
        return false;
    }

    return true;
}

/**
 * Inicjalizacja modalu - wydzielona funkcja
 */
function initializeModal() {
    const modal = document.getElementById('quote-editor-modal');
    if (!modal) {
        console.error('[QUOTE EDITOR] ❌ Nie znaleziono modalu edytora');
        return null;
    }
    return modal;
}

/**
 * Aktualizacja nagłówka modalu - batch DOM operations
 */
function updateModalHeader(quoteData) {
    const updates = [
        { id: 'edit-quote-number', text: `Wycena: ${quoteData.quote_number || 'N/A'}` },
        { id: 'edit-client-name', text: `Klient: ${quoteData.client?.client_name || quoteData.client?.client_number || 'N/A'}` }
    ];

    updates.forEach(({ id, text }) => {
        const element = document.getElementById(id);
        if (element) element.textContent = text;
    });
}

/**
 * Zoptymalizowane ładowanie calculator.js
 */
async function loadCalculatorIfNeeded() {
    if (calculatorScriptLoaded) {
        log('calculator', 'Calculator.js już załadowany');
        return true;
    }

    try {
        // Parallel loading of scripts
        await Promise.all([
            loadScript('/calculator/static/js/calculator.js'),
            loadScript('/calculator/static/js/save_quote.js')
        ]);

        calculatorScriptLoaded = true;
        initializeCalculatorForEditor();
        return true;

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd ładowania calculator.js:', error);
        return false;
    }
}

/**
 * Zoptymalizowana inicjalizacja event listeners
 */
function initializeEventListeners() {
    log('editor', 'Inicjalizacja event listeners...');

    // Użyj event delegation zamiast pojedynczych listeners
    const modal = document.getElementById('quote-editor-modal');

    // Single event listener dla wszystkich inputów wymiarów
    modal.addEventListener('input', handleInputChange);
    modal.addEventListener('change', handleSelectChange);
    modal.addEventListener('click', handleButtonClick);

    log('editor', '✅ Event listeners zainicjalizowane');
}

/**
 * Centralizowana obsługa zmian w inputach - debounced
 */
const handleInputChange = debounce((e) => {
    const target = e.target;

    if (target.matches('#edit-length, #edit-width, #edit-thickness, #edit-quantity')) {
        log('sync', `Input change: ${target.id} = "${target.value}"`);
        syncEditorToMockForm();
        onFormDataChange();
    }
}, 300);

/**
 * Centralizowana obsługa zmian w select-ach
 */
function handleSelectChange(e) {
    const radio = e.target;
    if (radio.type !== 'radio' || radio.name !== 'edit-variantOption') return;

    log('sync', `Variant change: ${radio.value}`);

    // Wywołaj oryginalną logikę
    onFormDataChange();

    // DODANE: Synchronizuj dataset po zmianie wariantu
    setTimeout(() => {
        syncRadioDatasetWithMockForm();
        // Odśwież podsumowanie po synchronizacji
        updateQuoteSummary();
    }, 100);
}

/**
 * Centralizowana obsługa kliknięć w przyciski
 */
function handleButtonClick(e) {
    const target = e.target;

    // Color buttons (check first in case they contain inner elements)
    const colorButton = target.closest('.color-btn');
    if (colorButton) {
        handleColorButtonClick(colorButton);
        return;
    }

    // Finishing buttons
    const finishingButton = target.closest('.finishing-btn');
    if (finishingButton) {
        handleFinishingButtonClick(finishingButton);
        return;
    }

    // Product cards
    const productCard = target.closest('.product-card');
    if (productCard && !target.closest('.remove-product-btn')) {
        const productIndex = parseInt(productCard.dataset.index);
        activateProductInEditor(productIndex);
        return;
    }

    // Remove product buttons
    const removeBtn = target.closest('.remove-product-btn');
    if (removeBtn) {
        e.stopPropagation();
        const productIndex = parseInt(removeBtn.dataset.index);
        removeProductFromQuote(productIndex);
        return;
    }

    // Action buttons
    if (target.id === 'save-quote-changes') {
        saveQuoteChanges();
        return;
    }

    if (target.id === 'edit-add-product-btn') {
        addNewProductToQuote();
    }
}

// ==================== OPTIMIZED CALCULATOR INTEGRATION ====================

/**
 * Zoptymalizowana konfiguracja kalkulatora - NAPRAWIONA KOLEJNOŚĆ
 */
function setupCalculatorForEditor() {
    log('calculator', 'Konfiguracja calculator.js...');

    try {
        backupOriginalCalculatorState();
        const container = findOrCreateContainer();
        if (!container) return false;

        window.quoteFormsContainer = container;
        const form = findOrCreateForm();
        if (!form) return false;

        window.activeQuoteForm = form;

        // ✅ POPRAWKA: Inicjalizacja przycisków wykończenia z error handling
        try {
            if (typeof attachFinishingUIListeners === 'function') {
                attachFinishingUIListeners(form);
                log('calculator', 'Zainicjalizowano przyciski wykończenia w mock formularzu');
            }
        } catch (error) {
            log('calculator', '⚠️ Błąd inicjalizacji przycisków wykończenia:', error);
            // Nie blokuj dalszej konfiguracji
        }

        addVariantsToCalculatorForm();
        log('calculator', '✅ Calculator.js skonfigurowany pomyślnie');
        return true;

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd konfiguracji calculator.js:', error);
        return false;
    }
}

/**
 * Znajdź lub stwórz kontener - POPRAWIONA WERSJA z lepszym error handling
 */
function findOrCreateContainer() {
    const modal = document.getElementById('quote-editor-modal');
    if (!modal) {
        console.error('[QUOTE EDITOR] Nie znaleziono modalu edytora');
        return null;
    }

    let container = modal.querySelector('.quote-forms-container');

    if (!container) {
        container = createElement('div', {
            className: 'quote-forms-container',
            style: 'display: none'
        });
        modal.appendChild(container);
        log('calculator', 'Utworzono nowy kontener formularzy');
    }

    return container;
}

/**
 * Znajdź lub stwórz formularz - POPRAWIONA WERSJA
 */
function findOrCreateForm() {
    // Najpierw upewnij się że container istnieje
    const container = window.quoteFormsContainer || findOrCreateContainer();
    if (!container) {
        console.error('[QUOTE EDITOR] Nie można znaleźć ani utworzyć kontenera');
        return null;
    }

    let form = container.querySelector('.quote-form');

    if (!form) {
        form = createElement('div', {
            className: 'quote-form',
            style: 'display: none',
            innerHTML: createMockFormHTML()
        });
        container.appendChild(form);
        log('calculator', 'Utworzono nowy formularz calculator.js');
    }

    return form;
}

/**
 * Helper do tworzenia elementów DOM
 */
function createElement(tag, options = {}) {
    const element = document.createElement(tag);

    Object.entries(options).forEach(([key, value]) => {
        if (key === 'style' && typeof value === 'string') {
            element.style.cssText = value;
        } else {
            element[key] = value;
        }
    });

    return element;
}

/**
 * Generowanie HTML dla mock formularza
 */
function createMockFormHTML() {
    return `
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
        
        <!-- ✅ SEKCJA WYKOŃCZENIA - KLUCZOWA POPRAWKA -->
        <div class="finishing-section" style="display: none;">
            <div class="finishing-type-group">
                <button type="button" class="finishing-btn active" data-finishing-type="Surowe">Surowe</button>
                <button type="button" class="finishing-btn" data-finishing-type="Lakierowanie">Lakierowanie</button>
                <button type="button" class="finishing-btn" data-finishing-type="Olejowanie">Olejowanie</button>
            </div>
            
            <div class="finishing-variant-wrapper" style="display: none;">
                <button type="button" class="finishing-btn" data-finishing-variant="Bezbarwne">Bezbarwne</button>
                <button type="button" class="finishing-btn" data-finishing-variant="Barwne">Barwne</button>
            </div>
            
            <div class="finishing-color-wrapper" style="display: none;">
                <div class="color-group">
                    <!-- Kolory będą dodane dynamicznie -->
                </div>
            </div>
            
            <div class="finishing-gloss-wrapper" style="display: none;">
                <button type="button" class="finishing-btn" data-finishing-gloss="Matowy">Matowy</button>
                <button type="button" class="finishing-btn" data-finishing-gloss="Półmatowy">Półmatowy</button>
                <button type="button" class="finishing-btn" data-finishing-gloss="Połysk">Połysk</button>
            </div>
        </div>
    `;
}

// ==================== OPTIMIZED DATA LOADING ====================

/**
 * Zoptymalizowane ładowanie danych wyceny
 */
function loadQuoteDataToEditor(quoteData) {
    log('editor', 'Ładowanie danych do edytora...');

    // Ustal pierwszy produkt na podstawie items
    if (quoteData.items?.length > 0) {
        const firstItem = quoteData.items
            .sort((a, b) => a.product_index - b.product_index)[0];
        if (firstItem) {
            activeProductIndex = firstItem.product_index;
            loadProductDataToForm(firstItem);
        }
    }

    // Batch update form fields
    updateFormFields(quoteData);

    // Load products and costs
    loadProductsToEditor(quoteData);
    loadCostsToSummary(quoteData);

    // KLUCZOWE DODANIE: Ustaw wybrane warianty z wyceny
    setSelectedVariantsByQuote(quoteData);

    log('editor', '✅ Dane wyceny załadowane do edytora');
}

/**
 * Batch update form fields
 */
function updateFormFields(quoteData) {
    const updates = [
        { id: 'edit-clientType', value: quoteData.quote_client_type },
        { id: 'edit-courier-name', textContent: quoteData.courier_name }
    ];

    updates.forEach(({ id, value, textContent }) => {
        const element = document.getElementById(id);
        if (!element) return;
        if (textContent !== undefined && textContent !== null) {
            element.textContent = textContent;
        } else if (value !== undefined && value !== null) {
            element.value = value;
        }
    });
}

/**
 * Zoptymalizowane ładowanie kosztów do podsumowania
 */
function loadCostsToSummary(quoteData) {
    const { costs } = quoteData;
    if (!costs) return;

    // Oblicz sumę za produkt
    const productTotalBrutto = costs.products.brutto + costs.finishing.brutto;
    const productTotalNetto = costs.products.netto + costs.finishing.netto;

    // Batch DOM updates z nową strukturą
    const costUpdates = [
        { selector: '.edit-order-brutto', value: costs.products.brutto },
        { selector: '.edit-order-netto', value: costs.products.netto, suffix: ' netto' },
        { selector: '.edit-finishing-brutto', value: costs.finishing.brutto },
        { selector: '.edit-finishing-netto', value: costs.finishing.netto, suffix: ' netto' },

        // NOWE: Suma za produkt
        { selector: '.edit-product-total-brutto', value: productTotalBrutto },
        { selector: '.edit-product-total-netto', value: productTotalNetto, suffix: ' netto' },

        { selector: '.edit-delivery-brutto', value: costs.shipping.brutto },
        { selector: '.edit-delivery-netto', value: costs.shipping.netto, suffix: ' netto' },
        { selector: '.edit-final-brutto', value: costs.total.brutto },
        { selector: '.edit-final-netto', value: costs.total.netto, suffix: ' netto' }
    ];

    // Single DOM update cycle
    requestAnimationFrame(() => {
        costUpdates.forEach(({ selector, value, suffix = '' }) => {
            const element = document.querySelector(selector);
            if (element) {
                element.textContent = `${value.toFixed(2)} PLN${suffix}`;
            }
        });
    });
}

// ==================== OPTIMIZED PRODUCT MANAGEMENT ====================

/**
 * Zoptymalizowane ładowanie produktów
 */
function loadProductsToEditor(quoteData) {
    const { items } = quoteData;
    if (!items?.length) return;

    const container = document.getElementById('edit-products-summary-container');
    if (!container) return;

    // Clear and rebuild in one operation
    const fragment = document.createDocumentFragment();
    const groupedProducts = groupProductsByIndex(items);

    Object.keys(groupedProducts)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .forEach((productIndex, displayIndex) => {
            const productCard = createProductCard(
                groupedProducts[productIndex],
                productIndex,
                displayIndex + 1
            );
            fragment.appendChild(productCard);
        });

    // Single DOM operation
    container.innerHTML = '';
    container.appendChild(fragment);

    updateProductsSummaryTotals();

    log('editor', `✅ Załadowano ${Object.keys(groupedProducts).length} produktów`);
}

/**
 * Helper - grupowanie produktów po indeksie
 */
function groupProductsByIndex(items) {
    return items.reduce((groups, item) => {
        const index = item.product_index;
        if (!groups[index]) groups[index] = [];
        groups[index].push(item);
        return groups;
    }, {});
}

/**
 * Tworzenie karty produktu - zoptymalizowane
 */
function createProductCard(productItems, productIndex, displayNumber) {
    const firstItem = productItems[0];
    const description = generateProductDescriptionForQuote(firstItem, productItems);
    const isActive = parseInt(productIndex) === activeProductIndex;
    const isComplete = checkProductCompletenessForQuote(firstItem);

    const card = createElement('div', {
        className: `product-card ${isActive ? 'active' : ''} ${!isComplete ? 'error' : ''}`,
        innerHTML: `
            <div class="product-card-content">
                <div class="product-card-number">${displayNumber}</div>
                <div class="product-card-details">
                    <div class="product-card-main-info">${description.main}</div>
                    ${description.sub ? `<div class="product-card-sub-info">${description.sub}</div>` : ''}
                </div>
            </div>
            <button class="remove-product-btn" data-index="${productIndex}" title="Usuń produkt">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `
    });

    card.dataset.index = productIndex;
    return card;
}

// ==================== OPTIMIZED CALCULATION FUNCTIONS ====================

/**
 * ULEPSZONA funkcja onFormDataChange z lepszym error handling
 */
function onFormDataChange() {
    log('sync', 'Dane formularza zostały zmienione');

    if (!checkCalculatorReadiness()) {
        log('sync', 'Calculator.js nie gotowy - używam fallback');
        calculateEditorPrices();
        updateQuoteSummary();
        return;
    }

    try {
        // ✅ POPRAWKA: Sprawdź setup PRZED dalszymi operacjami
        if (!setupCalculatorForEditor()) {
            log('calculator', 'Setup calculator.js nie powiódł się - fallback');
            calculateEditorPrices();
            updateQuoteSummary();
            return;
        }

        // ✅ POPRAWKA: Sprawdź sync PRZED calculation
        if (!syncEditorDataToCalculatorForm()) {
            log('sync', 'Sync danych nie powiódł się - fallback');
            calculateEditorPrices();
            updateQuoteSummary();
            return;
        }

        // ✅ POPRAWKA: Bezpieczne wywołania
        copyVariantMappingToEditor();
        createCustomUpdatePricesForEditor();

        // ✅ KLUCZOWA POPRAWKA: Synchronizuj wykończenie PRZED calculation
        syncFinishingStateToMockForm();

        callUpdatePricesSecurely();
        copyCalculationResults();
        updateQuoteSummary();

        log('calculator', '✅ Obliczenia zakończone pomyślnie');

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd w obliczeniach:', error);
        log('editor', 'Używam fallback z powodu błędu');
        calculateEditorPrices();
        updateQuoteSummary();
    }
}

/**
 * DODAJ funkcję do bezpiecznego wyszukiwania elementów z fallback
 */
function safeQuerySelector(container, selector, context = 'unknown') {
    if (!container) {
        log('editor', `❌ Container undefined w ${context}`);
        return null;
    }

    if (typeof container.querySelector !== 'function') {
        log('editor', `❌ Container nie ma querySelector w ${context}:`, container);
        return null;
    }

    try {
        return container.querySelector(selector);
    } catch (error) {
        log('editor', `❌ Błąd querySelector w ${context}:`, error);
        return null;
    }
}

/**
 * POPRAWIONA funkcja syncEditorDataToCalculatorForm z lepszym error handling
 */
function syncEditorDataToCalculatorForm() {
    if (!window.activeQuoteForm) {
        log('sync', '❌ Brak activeQuoteForm do synchronizacji');
        return false;
    }

    const syncMappings = [
        { editorId: 'edit-length', calculatorField: 'length' },
        { editorId: 'edit-width', calculatorField: 'width' },
        { editorId: 'edit-thickness', calculatorField: 'thickness' },
        { editorId: 'edit-quantity', calculatorField: 'quantity' },
        { editorId: 'edit-clientType', calculatorField: 'clientType' }
    ];

    let syncedCount = 0;

    // Single loop for all syncing z lepszym error handling
    syncMappings.forEach(({ editorId, calculatorField }) => {
        const editorElement = document.getElementById(editorId);
        const calculatorElement = safeQuerySelector(
            window.activeQuoteForm,
            `[data-field="${calculatorField}"]`,
            `sync ${calculatorField}`
        );

        if (editorElement && calculatorElement) {
            calculatorElement.value = editorElement.value || '';
            syncedCount++;
            if (DEBUG_LOGS.sync) {
                log('sync', `✅ ${calculatorField}: ${editorElement.value}`);
            }
        } else {
            log('sync', `⚠️ Nie można zsynchronizować ${calculatorField}`);
        }
    });

    if (syncedCount === 0) {
        log('sync', '❌ Żadne pole nie zostało zsynchronizowane');
        return false;
    }

    syncSelectedVariant();
    log('sync', `✅ Zsynchronizowano ${syncedCount}/${syncMappings.length} pól`);
    return true;
}

// ==================== OPTIMIZED FINISHING SECTION ====================

/**
 * Zoptymalizowana obsługa wykończenia
 */
function handleFinishingButtonClick(button) {
    const finishingType = button.dataset.finishingType;
    const finishingVariant = button.dataset.finishingVariant;
    const finishingGloss = button.dataset.finishingGloss;

    // Determine button group and handle accordingly
    if (finishingType) {
        setActiveFinishingButton(button, '#edit-finishing-type-group');
        handleFinishingTypeChange(finishingType);
    } else if (finishingVariant) {
        setActiveFinishingButton(button, '#edit-finishing-variant-wrapper');
        handleFinishingVariantChange(finishingVariant);
    } else if (finishingGloss) {
        setActiveFinishingButton(button, '#edit-finishing-gloss-wrapper');
        // Dodaj przeliczenie po zmianie połysku
        syncFinishingStateToMockForm();
        if (typeof calculateFinishingCost === 'function' && window.activeQuoteForm) {
            try {
                calculateFinishingCost(window.activeQuoteForm);
            } catch (err) {
                log('finishing', 'Błąd przeliczania po zmianie połysku', err);
            }
        }
        updateQuoteSummary();
    }

    // ✅ ZAWSZE wywołaj onFormDataChange po kliknięciu przycisku wykończenia
    onFormDataChange();
}

/**
 * Zoptymalizowana obsługa kolorów
 */
function handleColorButtonClick(button) {
    setActiveColorButton(button);
    log('finishing', `Wybrano kolor: ${button.dataset.finishingColor}`);
    onFormDataChange();
}

/**
 * Zoptymalizowana obsługa typu wykończenia
 */
function handleFinishingTypeChange(finishingType) {
    const elements = {
        variantWrapper: document.getElementById('edit-finishing-variant-wrapper'),
        colorWrapper: document.getElementById('edit-finishing-color-wrapper')
    };

    // Reset state
    clearFinishingSelections();

    // Hide all by default
    Object.values(elements).forEach(el => {
        if (el) el.style.display = 'none';
    });

    // Show relevant sections based on type
    if (finishingType === 'Lakierowanie' && elements.variantWrapper) {
        elements.variantWrapper.style.display = 'flex';
    }

    log('finishing', `Typ wykończenia: ${finishingType}`);

    // ✅ KLUCZOWA POPRAWKA: Synchronizuj do mock formularza
    syncFinishingStateToMockForm();

    // ✅ KLUCZOWA POPRAWKA: Przelicz koszty po zmianie typu
    if (typeof calculateFinishingCost === 'function' && window.activeQuoteForm) {
        try {
            calculateFinishingCost(window.activeQuoteForm);
            log('finishing', 'Przeliczono koszty wykończenia po zmianie typu');
        } catch (err) {
            log('finishing', 'Błąd przeliczania wykończenia po zmianie typu', err);
        }
    }

    // ✅ KLUCZOWA POPRAWKA: Aktualizuj podsumowanie
    updateQuoteSummary();
}

/**
 * Obsługa zmiany wariantu wykończenia
 */
function handleFinishingVariantChange(variant) {
    const colorWrapper = document.getElementById('edit-finishing-color-wrapper');
    if (!colorWrapper) return;

    // Reset active color buttons
    colorWrapper.querySelectorAll('.color-btn').forEach(btn => btn.classList.remove('active'));

    // Show colors only for "Barwne" variant
    colorWrapper.style.display = variant === 'Barwne' ? 'flex' : 'none';

    log('finishing', `Wariant wykończenia: ${variant}`);

    // ✅ DODAJ: Synchronizuj i przelicz
    syncFinishingStateToMockForm();

    if (typeof calculateFinishingCost === 'function' && window.activeQuoteForm) {
        try {
            calculateFinishingCost(window.activeQuoteForm);
            log('finishing', 'Przeliczono koszty wykończenia po zmianie wariantu');
        } catch (err) {
            log('finishing', 'Błąd przeliczania wykończenia po zmianie wariantu', err);
        }
    }

    updateQuoteSummary();
}

/**
 * Uniwersalna funkcja ustawiania aktywnego przycisku
 */
function setActiveFinishingButton(clickedButton, wrapperSelector) {
    const wrapper = document.querySelector(wrapperSelector);
    if (!wrapper) return;

    // Batch class updates
    const buttons = wrapper.querySelectorAll('.finishing-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    clickedButton.classList.add('active');
}

/**
 * Uniwersalna funkcja ustawiania aktywnego koloru
 */
function setActiveColorButton(clickedButton) {
    const colorButtons = document.querySelectorAll('#edit-finishing-color-wrapper .color-btn');
    colorButtons.forEach(btn => btn.classList.remove('active'));
    clickedButton.classList.add('active');
}

// ==================== OPTIMIZED DATA MANAGEMENT ====================

/**
 * Zoptymalizowane ładowanie grup cenowych
 */
async function loadClientTypesFromDatabase() {
    if (clientTypesCache) {
        log('editor', 'Używam cache grup cenowych');
        populateClientTypeSelect(clientTypesCache);
        return clientTypesCache;
    }

    try {
        const response = await fetch('/quotes/api/multipliers');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const multipliers = await response.json();
        clientTypesCache = multipliers; // Cache result

        populateClientTypeSelect(multipliers);
        log('editor', `✅ Załadowano ${multipliers.length} grup cenowych`);

        return multipliers;

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd ładowania grup cenowych:', error);
        loadDefaultClientTypes();
        return null;
    }
}

/**
 * Wypełnianie select-a grup cenowych - zoptymalizowane
 */
function populateClientTypeSelect(multipliers) {
    const select = document.getElementById('edit-clientType');
    if (!select) return;

    // Create fragment for batch DOM operations
    const fragment = document.createDocumentFragment();

    // Add placeholder
    const placeholder = createElement('option', {
        value: '',
        disabled: true,
        selected: true,
        textContent: 'Wybierz grupę'
    });
    fragment.appendChild(placeholder);

    // Add options
    multipliers.forEach(multiplier => {
        const option = createElement('option', {
            value: multiplier.client_type,
            textContent: `${multiplier.client_type} (${multiplier.multiplier})`
        });
        option.dataset.multiplierValue = multiplier.multiplier;
        option.dataset.multiplierId = multiplier.id;
        fragment.appendChild(option);
    });

    // Single DOM operation
    select.innerHTML = '';
    select.appendChild(fragment);
}

// ==================== OPTIMIZED CALCULATION CORE ====================

/**
 * Zoptymalizowana funkcja updatePrices dla edytora
 */
function createCustomUpdatePricesForEditor() {
    // Backup original function once
    if (!window.originalUpdatePrices && typeof updatePrices === 'function') {
        window.originalUpdatePrices = updatePrices;
    }

    // Create optimized version
    window.updatePrices = function () {
        log('calculator', 'Wywołano zoptymalizowaną updatePrices');

        const form = window.activeQuoteForm;
        if (!form) return;

        // Get form data in one pass
        const formData = extractFormData(form);
        if (!formData.isValid) {
            showErrorForAllVariants(formData.error, form.querySelector('.variants'));
            clearFormDataset(form);
            return;
        }

        // Process variants efficiently
        processVariantsOptimized(form, formData);

        // Calculate finishing costs if available
        if (typeof calculateFinishingCost === 'function') {
            try {
                calculateFinishingCost(form);
            } catch (error) {
                log('calculator', 'Błąd obliczania wykończenia:', error);
            }
        }
    };
}

/**
 * Ekstraktowanie danych formularza - zoptymalizowane
 */
function extractFormData(form) {
    const selectors = {
        length: 'input[data-field="length"]',
        width: 'input[data-field="width"]',
        thickness: 'input[data-field="thickness"]',
        quantity: 'input[data-field="quantity"]',
        clientType: 'select[data-field="clientType"]'
    };

    const data = {};
    let error = "";

    // Extract all values in one loop
    Object.entries(selectors).forEach(([key, selector]) => {
        const element = form.querySelector(selector);
        if (element) {
            data[key] = key === 'clientType' ? element.value : parseFloat(element.value);
        }
    });

    // Validation
    if (isNaN(data.length)) error = "Brak dług.";
    else if (isNaN(data.width)) error = "Brak szer.";
    else if (isNaN(data.thickness)) error = "Brak grub.";
    else if (!data.clientType) error = "Brak grupy";

    // Fix quantity
    if (isNaN(data.quantity) || data.quantity < 1) {
        data.quantity = 1;
        const quantityEl = form.querySelector(selectors.quantity);
        if (quantityEl) quantityEl.value = 1;
    }

    return {
        ...data,
        isValid: !error,
        error,
        volume: error ? 0 : calculateSingleVolume(data.length, data.width, Math.ceil(data.thickness)),
        multiplier: getMultiplierValue(data.clientType)
    };
}

/**
 * Zoptymalizowane przetwarzanie wariantów
 */
function processVariantsOptimized(form, formData) {
    const variants = form.querySelectorAll('.variants .variant-item');
    let selectedVariantData = null;

    // Process all variants in single loop
    variants.forEach(variant => {
        const radio = variant.querySelector('input[type="radio"]');
        if (!radio) return;

        const result = calculateVariantPrice(radio.value, formData);
        updateVariantDisplay(variant, result);

        if (radio.checked) {
            selectedVariantData = result;
            // Highlight selected variant
            variant.querySelectorAll('*').forEach(el => el.style.color = "#ED6B24");
        }
    });

    // Update form dataset
    if (selectedVariantData) {
        form.dataset.orderBrutto = selectedVariantData.totalBrutto.toFixed(2);
        form.dataset.orderNetto = selectedVariantData.totalNetto.toFixed(2);
    } else {
        clearFormDataset(form);
    }
}

/**
 * Obliczanie ceny wariantu - zoptymalizowane
 */
function calculateVariantPrice(variantCode, formData) {
    const config = window.variantMapping?.[variantCode];
    if (!config) {
        return { unitBrutto: 0, unitNetto: 0, totalBrutto: 0, totalNetto: 0 };
    }

    let basePrice = 0;

    // Try to get price from database
    if (window.priceIndex) {
        const match = getEditorPrice(config.species, config.technology, config.wood_class, formData.thickness, formData.length);
        if (match) {
            basePrice = match.price_per_m3;
        }
    }

    // Fallback prices if needed
    if (basePrice === 0) {
        const fallbackPrices = {
            'dab-lity-ab': 14500, 'dab-lity-bb': 13000, 'dab-micro-ab': 10000, 'dab-micro-bb': 10000,
            'jes-lity-ab': 13000, 'jes-micro-ab': 11000, 'buk-lity-ab': 9000, 'buk-micro-ab': 8500
        };
        basePrice = fallbackPrices[variantCode] || 10000;
    }

    // Calculate prices
    const unitNetto = formData.volume * basePrice * formData.multiplier;
    const unitBrutto = unitNetto * 1.23;
    const totalNetto = unitNetto * formData.quantity;
    const totalBrutto = unitBrutto * formData.quantity;

    return { unitNetto, unitBrutto, totalNetto, totalBrutto };
}

/**
 * Aktualizacja wyświetlania wariantu - zoptymalizowane
 */
function updateVariantDisplay(variant, prices) {
    const elements = {
        unitBrutto: variant.querySelector('.unit-brutto'),
        unitNetto: variant.querySelector('.unit-netto'),
        totalBrutto: variant.querySelector('.total-brutto'),
        totalNetto: variant.querySelector('.total-netto')
    };

    // Batch DOM updates
    Object.entries(elements).forEach(([key, element]) => {
        if (element) {
            const value = prices[key];
            element.textContent = formatPLN ? formatPLN(value) : `${value.toFixed(2)} PLN`;
        }
    });
}

/**
 * Pomocnicze funkcje dla obliczeń
 */
function getMultiplierValue(clientType) {
    if (typeof window.isPartner === 'boolean' && window.isPartner) {
        return window.userMultiplier || 1.0;
    }

    if (window.multiplierMapping?.[clientType]) {
        return window.multiplierMapping[clientType];
    }

    const fallback = { 'Florek': 1.0, 'Hurt': 1.1, 'Detal': 1.3, 'Detal+': 1.5 };
    return fallback[clientType] || 1.0;
}

function clearFormDataset(form) {
    form.dataset.orderBrutto = "";
    form.dataset.orderNetto = "";
}

function calculateSingleVolume(length, width, thickness) {
    return (length / 100) * (width / 100) * (thickness / 100);
}

// ==================== OPTIMIZED SUMMARY UPDATES ====================

/**
 * Zoptymalizowane odświeżanie podsumowania
 */
function updateQuoteSummary() {
    log('editor', 'Odświeżanie podsumowania...');

    try {
        // Calculate all costs
        const productsCosts = calculateProductsCosts();
        const finishingCosts = calculateFinishingCosts();
        const shippingCosts = getShippingCosts();

        const totalCosts = {
            brutto: productsCosts.brutto + finishingCosts.brutto + shippingCosts.brutto,
            netto: productsCosts.netto + finishingCosts.netto + shippingCosts.netto
        };

        // ✅ KLUCZOWA POPRAWKA: Bezpośrednia aktualizacja UI
        updateSummaryDisplay(productsCosts, finishingCosts, shippingCosts, totalCosts);

        // Dodatkowo zaktualizuj obiekty dla logowania
        const summaryObject = {
            aktywny_surowe: { brutto: productsCosts.brutto, netto: productsCosts.netto },
            aktywny_wykończenie: { brutto: finishingCosts.brutto, netto: finishingCosts.netto },
            aktywny_suma: { brutto: productsCosts.brutto + finishingCosts.brutto, netto: productsCosts.netto + finishingCosts.netto },
            wszystkie_produkty_łącznie: { brutto: totalCosts.brutto, netto: totalCosts.netto },
            dostawa: { brutto: shippingCosts.brutto, netto: shippingCosts.netto },
            suma_zamówienia: { brutto: totalCosts.brutto, netto: totalCosts.netto }
        };

        log('editor', 'Podsumowanie zaktualizowane:', summaryObject);

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd odświeżania podsumowania:', error);
    }
}

function debugFinishingData() {
    console.log('=== DEBUG WYKOŃCZENIA ===');
    console.log('1. Stan przycisków edytora:');
    console.log('   - Typ:', getSelectedFinishingType());
    console.log('   - Wariant:', getSelectedFinishingVariant());
    console.log('   - Kolor:', getSelectedFinishingColor());

    console.log('2. Dataset mock formularza:');
    if (window.activeQuoteForm) {
        console.log('   - finishingBrutto:', window.activeQuoteForm.dataset.finishingBrutto);
        console.log('   - finishingNetto:', window.activeQuoteForm.dataset.finishingNetto);
    } else {
        console.log('   - BRAK activeQuoteForm!');
    }

    console.log('3. Elementy UI:');
    const bruttoEl = document.querySelector('.edit-finishing-brutto');
    const nettoEl = document.querySelector('.edit-finishing-netto');
    console.log('   - .edit-finishing-brutto:', bruttoEl?.textContent);
    console.log('   - .edit-finishing-netto:', nettoEl?.textContent);

    console.log('4. Obliczenia funkcji:');
    const calculated = calculateFinishingCosts();
    console.log('   - calculateFinishingCosts():', calculated);

    console.log('5. Mock formularz (przyciski):');
    if (window.activeQuoteForm) {
        const mockButtons = window.activeQuoteForm.querySelectorAll('.finishing-btn');
        console.log('   - Liczba przycisków w mock:', mockButtons.length);
        mockButtons.forEach((btn, i) => {
            console.log(`   - Przycisk ${i}:`, btn.dataset.finishingType || btn.dataset.finishingVariant, btn.classList.contains('active') ? 'ACTIVE' : 'inactive');
        });
    }
}

/**
 * NOWA funkcja - aktualizuj elementy z nową strukturą
 */
function updateSummaryElementsFixed(activeProductCosts, activeFinishingCosts, activeProductTotal, shippingCosts, finalOrderTotal) {
    const updates = [
        // Pokazuj koszty tylko aktywnego produktu w górnych wierszach
        { selector: '.edit-order-brutto', value: activeProductCosts.brutto },
        { selector: '.edit-order-netto', value: activeProductCosts.netto, suffix: ' netto' },
        { selector: '.edit-finishing-brutto', value: activeFinishingCosts.brutto },
        { selector: '.edit-finishing-netto', value: activeFinishingCosts.netto, suffix: ' netto' },

        // Suma za aktywny produkt
        { selector: '.edit-product-total-brutto', value: activeProductTotal.brutto },
        { selector: '.edit-product-total-netto', value: activeProductTotal.netto, suffix: ' netto' },

        // Dostawa (bez zmian)
        { selector: '.edit-delivery-brutto', value: shippingCosts.brutto },
        { selector: '.edit-delivery-netto', value: shippingCosts.netto, suffix: ' netto' },

        // POPRAWKA: Suma zamówienia = WSZYSTKIE produkty + dostawa
        { selector: '.edit-final-brutto', value: finalOrderTotal.brutto },
        { selector: '.edit-final-netto', value: finalOrderTotal.netto, suffix: ' netto' }
    ];

    // Batch DOM update
    requestAnimationFrame(() => {
        updates.forEach(({ selector, value, suffix = '' }) => {
            const element = document.querySelector(selector);
            if (element) {
                element.textContent = `${value.toFixed(2)} PLN${suffix}`;
            }
        });
    });
}

/**
 * DEBUGOWANIE - funkcja do sprawdzania danych produktów
 */
function debugProductPrices() {
    console.log('=== DEBUG CEN PRODUKTÓW ===');

    if (!currentEditingQuoteData?.items) {
        console.log('Brak produktów w danych wyceny');
        return;
    }

    console.log('Produkty w wycenie:');
    currentEditingQuoteData.items.forEach(item => {
        console.log(`Produkt ${item.product_index}:`, {
            is_selected: item.is_selected,
            quantity: item.quantity,
            // Ceny jednostkowe
            unit_price_netto: item.unit_price_netto,
            unit_price_brutto: item.unit_price_brutto,
            price_netto: item.price_netto,
            price_brutto: item.price_brutto,
            // Ceny całkowite
            final_price_netto: item.final_price_netto,
            final_price_brutto: item.final_price_brutto
        });
    });

    if (currentEditingQuoteData.finishing) {
        console.log('Wykończenia w wycenie:');
        currentEditingQuoteData.finishing.forEach(finishing => {
            console.log(`Wykończenie produktu ${finishing.product_index}:`, {
                finishing_price_netto: finishing.finishing_price_netto,
                finishing_price_brutto: finishing.finishing_price_brutto,
                quantity: finishing.quantity
            });
        });
    }
}

/**
 * Zoptymalizowane obliczanie kosztów produktów
 */
function calculateProductsCosts() {
    log('editor', '=== OBLICZANIE KOSZTÓW WSZYSTKICH PRODUKTÓW ===');

    try {
        // OPCJA 1: Sprawdź aktualnie wybrany radio button w edytorze
        const selectedRadio = document.querySelector('input[name="edit-variantOption"]:checked');
        if (selectedRadio && selectedRadio.dataset) {
            const radioBrutto = parseFloat(selectedRadio.dataset.orderBrutto) || 0;
            const radioNetto = parseFloat(selectedRadio.dataset.orderNetto) || 0;

            if (radioBrutto > 0 || radioNetto > 0) {
                log('editor', `Produkt 1: używam radio button = ${radioBrutto.toFixed(2)} PLN brutto, ${radioNetto.toFixed(2)} PLN netto`);
                return { brutto: radioBrutto, netto: radioNetto };
            }
        }

        // OPCJA 2: Sprawdź dataset z activeQuoteForm (calculator)
        if (window.activeQuoteForm?.dataset) {
            const formBrutto = parseFloat(window.activeQuoteForm.dataset.orderBrutto) || 0;
            const formNetto = parseFloat(window.activeQuoteForm.dataset.orderNetto) || 0;

            if (formBrutto > 0 || formNetto > 0) {
                log('editor', `Produkt 1: używam activeQuoteForm = ${formBrutto.toFixed(2)} PLN brutto, ${formNetto.toFixed(2)} PLN netto`);
                return { brutto: formBrutto, netto: formNetto };
            }
        }

        // OPCJA 3: Fallback - sprawdź oryginalny dataset z aktualnie wybranego wariantu
        if (currentEditingQuoteData?.items?.length > 0) {
            const selectedItem = currentEditingQuoteData.items.find(item => item.is_selected);
            if (selectedItem) {
                const quantity = selectedItem.quantity || 1;
                const brutto = (selectedItem.final_price_brutto || selectedItem.unit_price_brutto || 0) * quantity;
                const netto = (selectedItem.final_price_netto || selectedItem.unit_price_netto || 0) * quantity;

                log('editor', `Produkt 1: używam fallback = ${brutto.toFixed(2)} PLN brutto, ${netto.toFixed(2)} PLN netto`);
                return { brutto, netto };
            }
        }

        // OPCJA 4: Ostateczny fallback
        log('editor', 'Produkt 1: używam final_price = 0.00 PLN (brak danych)');
        return { brutto: 0, netto: 0 };

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd obliczania kosztów produktów:', error);
        return { brutto: 0, netto: 0 };
    }
}

/**
 * DODATKOWA FUNKCJA: Synchronizacja dataset radio button z mock form
 * Ta funkcja powinna być wywoływana po każdej zmianie wariantu
 */
function syncRadioDatasetWithMockForm() {
    const selectedRadio = document.querySelector('input[name="edit-variantOption"]:checked');
    const mockForm = window.activeQuoteForm;

    if (selectedRadio && mockForm && mockForm.dataset) {
        // Kopiuj dane z mock form do radio button
        selectedRadio.dataset.orderBrutto = mockForm.dataset.orderBrutto || '0';
        selectedRadio.dataset.orderNetto = mockForm.dataset.orderNetto || '0';

        log('sync', `✅ Zsynchronizowano dataset wariantu: ${selectedRadio.value}`);
        log('sync', `   - Brutto: ${selectedRadio.dataset.orderBrutto} PLN`);
        log('sync', `   - Netto: ${selectedRadio.dataset.orderNetto} PLN`);
    }
}

/**
 * POPRAWIONE obliczanie kosztów wykończenia z prawidłową geometrią
 * Uwzględnia: wymiary w cm → powierzchnia w m² → koszt z bazy danych
 */
function calculateFinishingCosts() {
    // Priorytet: dane z calculator.js
    if (window.activeQuoteForm?.dataset) {
        const finishingBrutto = parseFloat(window.activeQuoteForm.dataset.finishingBrutto) || 0;
        const finishingNetto = parseFloat(window.activeQuoteForm.dataset.finishingNetto) || 0;

        if (finishingBrutto > 0 || finishingNetto > 0) {
            log('finishing', `Koszty z calculator: ${finishingBrutto} PLN brutto`);
            return { brutto: finishingBrutto, netto: finishingNetto };
        }
    }

    // Fallback calculation z poprawnymi obliczeniami
    const finishingType = getSelectedFinishingType();
    const finishingVariant = getSelectedFinishingVariant();

    log('finishing', `Obliczam fallback: typ=${finishingType}, wariant=${finishingVariant}`);

    if (finishingType === 'Surowe') {
        log('finishing', 'Surowe wykończenie - koszt 0');
        return { brutto: 0, netto: 0 };
    }

    const dimensions = getCurrentDimensions();
    if (!dimensions.isValid) {
        log('finishing', 'Nieprawidłowe wymiary - koszt 0');
        return { brutto: 0, netto: 0 };
    }

    // ✅ POPRAWKA: Prawidłowe przeliczenie cm→m (podziel przez 100, nie 1000!)
    const lengthM = dimensions.length / 100;
    const widthM = dimensions.width / 100;
    const thicknessM = dimensions.thickness / 100;

    // Wzór na powierzchnię prostopadłościanu: 2(lw + lh + wh)
    const surfaceAreaM2 = 2 * (lengthM * widthM + lengthM * thicknessM + widthM * thicknessM) * dimensions.quantity;

    const finishingPrice = getFinishingPrice(finishingType, finishingVariant);

    if (finishingPrice > 0) {
        const netto = surfaceAreaM2 * finishingPrice;
        const brutto = netto * 1.23;

        log('finishing', `Obliczono fallback POPRAWNIE: ${brutto.toFixed(2)} PLN brutto (${surfaceAreaM2.toFixed(4)} m² × ${finishingPrice} PLN/m²)`);

        return { brutto, netto };
    }

    log('finishing', 'Brak ceny wykończenia - koszt 0');
    return { brutto: 0, netto: 0 };
}

/**
 * NOWA funkcja - oblicza sumę produktów dla aktywnego produktu (do wyświetlenia w formularzu)
 */
function calculateActiveProductCosts() {
    log('editor', '=== OBLICZANIE KOSZTÓW AKTYWNEGO PRODUKTU ===');

    // Sprawdź dane z calculator.js dla aktywnego formularza
    if (window.activeQuoteForm?.dataset) {
        const formBrutto = parseFloat(window.activeQuoteForm.dataset.orderBrutto) || 0;
        const formNetto = parseFloat(window.activeQuoteForm.dataset.orderNetto) || 0;

        if (formBrutto > 0 || formNetto > 0) {
            log('editor', `Aktywny produkt (z calculator): ${formBrutto.toFixed(2)} PLN brutto`);
            return { brutto: formBrutto, netto: formNetto };
        }
    }

    // Fallback - znajdź aktywny produkt w danych wyceny
    if (activeProductIndex !== null && currentEditingQuoteData?.items) {
        const activeItem = currentEditingQuoteData.items.find(item =>
            item.product_index === activeProductIndex && item.is_selected
        );

        if (activeItem) {
            let itemBrutto = 0;
            let itemNetto = 0;

            // Użyj final_price jeśli dostępne (już zawiera quantity)
            if (activeItem.final_price_brutto && activeItem.final_price_netto) {
                itemBrutto = parseFloat(activeItem.final_price_brutto);
                itemNetto = parseFloat(activeItem.final_price_netto);
            } else {
                // Oblicz z ceny jednostkowej
                const quantity = activeItem.quantity || 1;
                itemBrutto = parseFloat(activeItem.unit_price_brutto || activeItem.price_brutto || 0) * quantity;
                itemNetto = parseFloat(activeItem.unit_price_netto || activeItem.price_netto || 0) * quantity;
            }

            log('editor', `Aktywny produkt ${activeProductIndex}: ${itemBrutto.toFixed(2)} PLN brutto`);
            return { brutto: itemBrutto, netto: itemNetto };
        }
    }

    log('editor', 'Brak danych aktywnego produktu');
    return { brutto: 0, netto: 0 };
}

/**
 * NOWA funkcja - oblicza wykończenie tylko dla aktywnego produktu
 */
function calculateActiveProductFinishingCosts() {
    log('finishing', '=== OBLICZANIE WYKOŃCZENIA AKTYWNEGO PRODUKTU ===');

    // Sprawdź dane z calculator.js
    if (window.activeQuoteForm?.dataset) {
        const finishingBrutto = parseFloat(window.activeQuoteForm.dataset.finishingBrutto) || 0;
        const finishingNetto = parseFloat(window.activeQuoteForm.dataset.finishingNetto) || 0;

        if (finishingBrutto > 0 || finishingNetto > 0) {
            log('finishing', `Wykończenie aktywnego produktu (z calculator): ${finishingBrutto.toFixed(2)} PLN brutto`);
            return { brutto: finishingBrutto, netto: finishingNetto };
        }
    }

    // Fallback - znajdź wykończenie aktywnego produktu w danych wyceny
    if (activeProductIndex !== null && currentEditingQuoteData?.finishing) {
        const activeFinishing = currentEditingQuoteData.finishing.find(f =>
            f.product_index === activeProductIndex
        );

        if (activeFinishing) {
            // finishing_price to już wartość całkowita dla produktu
            const finishingBrutto = parseFloat(activeFinishing.finishing_price_brutto || 0);
            const finishingNetto = parseFloat(activeFinishing.finishing_price_netto || 0);

            log('finishing', `Wykończenie aktywnego produktu ${activeProductIndex}: ${finishingBrutto.toFixed(2)} PLN brutto`);
            return { brutto: finishingBrutto, netto: finishingNetto };
        }
    }

    log('finishing', 'Brak wykończenia dla aktywnego produktu');
    return { brutto: 0, netto: 0 };
}

/**
 * Pobiera cenę wykończenia z bazy danych (załadowanej do window.finishingPrices)
 */
function getFinishingPriceFromDatabase(finishingType, finishingVariant) {
    if (!window.finishingPrices) {
        console.warn('[QUOTE EDITOR] Brak załadowanych cen wykończenia');
        return 0;
    }

    let priceKey = '';

    // Mapowanie typów i wariantów na klucze w bazie danych
    if (finishingType === 'Surowe') {
        priceKey = 'Surowe';
    } else if (finishingType === 'Lakierowanie') {
        if (finishingVariant === 'Bezbarwne') {
            priceKey = 'Lakierowane bezbarwne';
        } else if (finishingVariant === 'Barwne') {
            priceKey = 'Lakierowane barwne';
        }
    } else if (finishingType === 'Olejowanie') {
        priceKey = 'Olejowanie';
    }

    const price = window.finishingPrices[priceKey] || 0;

    log('finishing', 'Pobieranie ceny z bazy:', {
        finishingType,
        finishingVariant,
        priceKey,
        price
    });

    return price;
}

/**
 * Fallback - domyślne ceny jeśli nie udało się załadować z bazy
 */
function loadDefaultFinishingData() {
    console.warn('[QUOTE EDITOR] Używam domyślnych cen wykończenia jako fallback');

    window.finishingPrices = {
        'Surowe': 0,
        'Lakierowane bezbarwne': 200,
        'Lakierowane barwne': 250,
        'Olejowanie': 250
    };

    // Zbuduj podstawowe dane dla interfejsu
    const defaultData = {
        finishing_types: [
            { id: 1, name: 'Surowe', price_netto: 0 },
            { id: 2, name: 'Lakierowane bezbarwne', price_netto: 200 },
            { id: 3, name: 'Lakierowane barwne', price_netto: 250 },
            { id: 4, name: 'Olejowanie', price_netto: 250 }
        ],
        finishing_colors: [
            { id: 1, name: 'Brak', image_path: null, image_url: null },
            { id: 2, name: 'Biały', image_path: 'images/colors/white.jpg', image_url: '/calculator/static/images/colors/white.jpg' },
            { id: 3, name: 'Czarny', image_path: 'images/colors/black.jpg', image_url: '/calculator/static/images/colors/black.jpg' }
        ]
    };

    renderFinishingUI(defaultData);
    finishingDataCache = defaultData;

    log('finishing', 'Załadowano domyślne dane wykończenia');
}

/**
 * Pomocnicze funkcje dla obliczeń
 */
function getCurrentDimensions() {
    const length = parseFloat(document.getElementById('edit-length')?.value) || 0;
    const width = parseFloat(document.getElementById('edit-width')?.value) || 0;
    const thickness = parseFloat(document.getElementById('edit-thickness')?.value) || 0;
    const quantity = parseInt(document.getElementById('edit-quantity')?.value) || 1;

    return {
        length,
        width,
        thickness,
        quantity,
        isValid: length > 0 && width > 0 && thickness > 0 && quantity > 0
    };
}

function getShippingCosts() {
    if (currentEditingQuoteData?.shipping_cost_brutto || currentEditingQuoteData?.shipping_cost_netto) {
        return {
            brutto: parseFloat(currentEditingQuoteData.shipping_cost_brutto) || 0,
            netto: parseFloat(currentEditingQuoteData.shipping_cost_netto) || 0
        };
    }
    if (currentEditingQuoteData?.costs?.shipping) {
        return {
            brutto: parseFloat(currentEditingQuoteData.costs.shipping.brutto) || 0,
            netto: parseFloat(currentEditingQuoteData.costs.shipping.netto) || 0
        };
    }
    if (currentEditingQuoteData?.cost_shipping) {
        const brutto = parseFloat(currentEditingQuoteData.cost_shipping) || 0;
        return { brutto, netto: brutto / 1.23 };
    }
    return { brutto: 0, netto: 0 };
}

// ==================== OPTIMIZED UTILITY FUNCTIONS ====================

/**
 * Uniwersalna funkcja debounce
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Uniwersalne funkcje getter dla wykończenia
 */
function getSelectedFinishingType() {
    const activeBtn = document.querySelector('#edit-finishing-type-group .finishing-btn.active');
    return activeBtn?.dataset.finishingType || 'Surowe';
}

function getSelectedFinishingVariant() {
    const activeBtn = document.querySelector('#edit-finishing-variant-wrapper .finishing-btn.active');
    return activeBtn?.dataset.finishingVariant || null;
}

function getSelectedFinishingColor() {
    const activeBtn = document.querySelector('#edit-finishing-color-wrapper .color-btn.active');
    return activeBtn?.dataset.finishingColor || null;
}

/**
 * Zoptymalizowane czyszczenie selekcji
 */
function clearFinishingSelections() {
    const selectors = [
        '#edit-finishing-variant-wrapper .finishing-btn',
        '#edit-finishing-color-wrapper .color-btn'
    ];

    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(btn => btn.classList.remove('active'));
    });

    // ✅ KLUCZOWA POPRAWKA: Resetuj koszty wykończenia w mock formularzu
    if (window.activeQuoteForm) {
        window.activeQuoteForm.dataset.finishingBrutto = '0';
        window.activeQuoteForm.dataset.finishingNetto = '0';

        // Aktualizuj wyświetlanie w formularzu (jeśli istnieją elementy)
        const finishingBruttoEl = window.activeQuoteForm.querySelector('.finishing-brutto');
        const finishingNettoEl = window.activeQuoteForm.querySelector('.finishing-netto');

        if (finishingBruttoEl) finishingBruttoEl.textContent = '0.00 PLN';
        if (finishingNettoEl) finishingNettoEl.textContent = '0.00 PLN';

        log('finishing', 'Zresetowano koszty wykończenia w formularzu');
    }
}

function safeAttachFinishingUIListeners(form) {
    if (!form) {
        log('calculator', '❌ Brak formularza dla attachFinishingUIListeners');
        return;
    }

    try {
        // Sprawdź czy formularz ma klasę quote-form
        if (!form.classList.contains('quote-form')) {
            form.classList.add('quote-form');
        }

        // Znajdź przyciski w formularzu
        const typeButtons = form.querySelectorAll('.finishing-btn[data-finishing-type]');
        const variantButtons = form.querySelectorAll('.finishing-btn[data-finishing-variant]');
        const colorButtons = form.querySelectorAll('.color-btn[data-finishing-color]');

        log('calculator', `Znaleziono przyciski: ${typeButtons.length} typów, ${variantButtons.length} wariantów, ${colorButtons.length} kolorów`);

        // Dodaj event listenery bez błędów
        typeButtons.forEach(btn => {
            btn.addEventListener('click', function () {
                // Reset innych przycisków typu
                typeButtons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Wywołaj calculation
                if (typeof calculateFinishingCost === 'function') {
                    calculateFinishingCost(form);
                }
            });
        });

        variantButtons.forEach(btn => {
            btn.addEventListener('click', function () {
                // Reset innych przycisków wariantu
                variantButtons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Wywołaj calculation
                if (typeof calculateFinishingCost === 'function') {
                    calculateFinishingCost(form);
                }
            });
        });

        colorButtons.forEach(btn => {
            btn.addEventListener('click', function () {
                // Reset innych przycisków koloru
                colorButtons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
            });
        });

        log('calculator', '✅ Event listenery wykończenia dodane pomyślnie');

    } catch (error) {
        log('calculator', '❌ Błąd w safeAttachFinishingUIListeners:', error);
    }
}

/**
 * Uniwersalna funkcja ładowania skryptów
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }

        const script = createElement('script', { src });
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load: ${src}`));
        document.head.appendChild(script);
    });
}

// ==================== BATCH DOM OPERATIONS ====================

/**
 * Batch update summary display - zoptymalizowane
 */
function updateSummaryDisplay(productsCosts, finishingCosts, shippingCosts, totalCosts) {
    const summaryUpdates = [
        { selector: '.edit-order-brutto', value: productsCosts.brutto },
        { selector: '.edit-order-netto', value: productsCosts.netto, suffix: ' netto' },
        { selector: '.edit-finishing-brutto', value: finishingCosts.brutto },
        { selector: '.edit-finishing-netto', value: finishingCosts.netto, suffix: ' netto' },
        { selector: '.edit-delivery-brutto', value: shippingCosts.brutto },
        { selector: '.edit-delivery-netto', value: shippingCosts.netto, suffix: ' netto' },
        { selector: '.edit-final-brutto', value: totalCosts.brutto },
        { selector: '.edit-final-netto', value: totalCosts.netto, suffix: ' netto' }
    ];

    // Single DOM update cycle
    requestAnimationFrame(() => {
        summaryUpdates.forEach(({ selector, value, suffix = '' }) => {
            const element = document.querySelector(selector);
            if (element) {
                element.textContent = `${value.toFixed(2)} PLN${suffix}`;
            }
        });
    });
}

// ==================== VARIANT MANAGEMENT ====================

/**
 * Zoptymalizowane zarządzanie wariantami
 */
function updateEditorVariantAvailability(checkbox) {
    const variantOption = checkbox.closest('.variant-option');
    if (!variantOption) return;

    const radioButton = variantOption.querySelector('input[type="radio"]');
    const isAvailable = checkbox.checked;

    // Batch class and state updates
    variantOption.classList.toggle('unavailable', !isAvailable);
    if (radioButton) {
        radioButton.disabled = !isAvailable;

        if (!isAvailable && radioButton.checked) {
            radioButton.checked = false;
            selectFirstAvailableVariant();
        }
    }

    log('sync', `Wariant ${checkbox.dataset.variant}: ${isAvailable ? 'dostępny' : 'niedostępny'}`);
}

function selectFirstAvailableVariant() {
    const availableRadio = document.querySelector('input[name="edit-variantOption"]:not(:disabled)');
    if (availableRadio) {
        availableRadio.checked = true;
        updateSelectedVariant(availableRadio);
        onFormDataChange();
    }
}

function updateSelectedVariant(selectedRadio) {
    // Batch class updates
    document.querySelectorAll('.variant-option').forEach(option => {
        option.classList.remove('selected');
    });

    const selectedOption = selectedRadio.closest('.variant-option');
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }

    // ✅ KLUCZOWA POPRAWKA: Po zmianie wariantu skopiuj ceny z mock formularza
    setTimeout(() => {
        copyCalculationResults();
        updateQuoteSummary();
        log('sync', `✅ Zaktualizowano ceny po zmianie wariantu: ${selectedRadio.value}`);
    }, 100); // Krótki delay żeby calculator.js zdążył przeliczyć
}
// ==================== OPTIMIZED CALCULATOR INTEGRATION ====================

/**
 * Zoptymalizowana synchronizacja do mock form
 */
function syncEditorToMockForm() {
    if (!window.activeQuoteForm) return;

    const syncMappings = [
        { editor: 'edit-clientType', calculator: '[data-field="clientType"]' },
        { editor: 'edit-length', calculator: '[data-field="length"]' },
        { editor: 'edit-width', calculator: '[data-field="width"]' },
        { editor: 'edit-thickness', calculator: '[data-field="thickness"]' },
        { editor: 'edit-quantity', calculator: '[data-field="quantity"]' }
    ];

    // Single loop synchronization
    syncMappings.forEach(({ editor, calculator }) => {
        const editorEl = document.getElementById(editor);
        const calcEl = window.activeQuoteForm.querySelector(calculator);

        if (editorEl && calcEl && editorEl.value !== calcEl.value) {
            calcEl.value = editorEl.value;
        }
    });

    syncAvailabilityStates(window.activeQuoteForm);
    syncSelectedVariant();
}

/**
 * Zoptymalizowana kopia results
 */
function copyCalculationResults() {
    if (!window.activeQuoteForm) {
        log('sync', '❌ Brak activeQuoteForm do kopiowania wyników');
        return;
    }

    const calculatorVariants = window.activeQuoteForm.querySelectorAll('.variant-item');
    const editorVariants = document.querySelectorAll('.variant-option');

    log('sync', `Kopiowanie wyników: ${calculatorVariants.length} calculator → ${editorVariants.length} editor`);

    // Create mapping for efficient lookup
    const editorVariantMap = new Map();
    editorVariants.forEach(variant => {
        const radio = variant.querySelector('input[type="radio"]');
        if (radio) editorVariantMap.set(radio.value, variant);
    });

    let copiedCount = 0;

    // Copy prices between variants
    calculatorVariants.forEach(calcVariant => {
        const calcRadio = calcVariant.querySelector('input[type="radio"]');
        if (!calcRadio) return;

        const editorVariant = editorVariantMap.get(calcRadio.value);
        if (!editorVariant) return;

        const copied = copyPricesBetweenVariants(calcVariant, editorVariant);
        if (copied) copiedCount++;
    });

    log('sync', `✅ Skopiowano ceny dla ${copiedCount} wariantów`);

    // ✅ DODAJ: Skopiuj dataset z wybranego wariantu
    copySelectedVariantDataset();
}

function copyPricesBetweenVariants(source, target) {
    const priceFields = ['unit-brutto', 'unit-netto', 'total-brutto', 'total-netto'];
    let copiedFields = 0;

    priceFields.forEach(field => {
        const sourceEl = source.querySelector(`.${field}`);
        const targetEl = target.querySelector(`.${field}`);

        if (sourceEl && targetEl && sourceEl.textContent !== 'Obliczanie...') {
            targetEl.textContent = sourceEl.textContent;
            copiedFields++;
        }
    });

    return copiedFields > 0;
}

/**
 * NOWA funkcja kopiowania datasetu wybranego wariantu
 */
function copySelectedVariantDataset() {
    if (!window.activeQuoteForm) return;

    const selectedMockRadio = window.activeQuoteForm.querySelector('input[type="radio"]:checked');
    const selectedEditorRadio = document.querySelector('input[name="edit-variantOption"]:checked');

    if (selectedMockRadio && selectedEditorRadio) {
        // Skopiuj dataset z mock radio do editor radio
        const datasetFields = ['totalBrutto', 'totalNetto', 'unitBrutto', 'unitNetto'];

        datasetFields.forEach(field => {
            if (selectedMockRadio.dataset[field]) {
                selectedEditorRadio.dataset[field] = selectedMockRadio.dataset[field];
            }
        });

        log('sync', `✅ Skopiowano dataset wariantu: ${selectedEditorRadio.value}`);
    }
}

function copySummaryData() {
    const summaryMappings = [
        { dataset: 'orderBrutto', elementId: 'edit-summary-brutto' },
        { dataset: 'orderNetto', elementId: 'edit-summary-netto' }
    ];

    summaryMappings.forEach(({ dataset, elementId }) => {
        if (window.activeQuoteForm.dataset[dataset]) {
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = window.activeQuoteForm.dataset[dataset];
            }
        }
    });
}

// ==================== OPTIMIZED VALIDATION ====================

/**
 * Zoptymalizowana walidacja formularza
 */
function validateFormBeforeSave() {
    const validationRules = [
        { field: 'edit-clientType', message: 'Wybierz grupę cenową', validator: (v) => !!v },
        { field: 'edit-length', message: 'Podaj poprawną długość', validator: (v) => v > 0 },
        { field: 'edit-width', message: 'Podaj poprawną szerokość', validator: (v) => v > 0 },
        { field: 'edit-thickness', message: 'Podaj poprawną grubość', validator: (v) => v > 0 },
        { field: 'edit-quantity', message: 'Podaj poprawną ilość', validator: (v) => v > 0 }
    ];

    // Check all fields in single loop
    for (const rule of validationRules) {
        const element = document.getElementById(rule.field);
        const value = element?.value;
        const numValue = parseFloat(value);

        if (!rule.validator(rule.field === 'edit-clientType' ? value : numValue)) {
            alert(rule.message);
            return false;
        }
    }

    // Validate variant selection
    const selectedVariant = document.querySelector('input[name="edit-variantOption"]:checked');
    if (!selectedVariant) {
        alert('Wybierz wariant produktu');
        return false;
    }

    if (selectedVariant.disabled) {
        alert('Wybrany wariant jest niedostępny. Wybierz dostępny wariant.');
        return false;
    }

    // Check available variants
    const availableVariants = document.querySelectorAll('.variant-availability-checkbox:checked');
    if (availableVariants.length === 0) {
        alert('Musi być dostępny przynajmniej jeden wariant');
        return false;
    }

    return true;
}

// ==================== OPTIMIZED HELPER FUNCTIONS ====================

/**
 * Sprawdzanie gotowości kalkulatora - zoptymalizowane
 */
function checkCalculatorReadiness() {
    const requirements = [
        calculatorScriptLoaded,
        calculatorInitialized,
        typeof updatePrices === 'function',
        typeof window.pricesFromDatabase !== 'undefined',
        typeof window.multiplierMapping !== 'undefined'
    ];

    const isReady = requirements.every(Boolean);

    if (DEBUG_LOGS.calculator) {
        log('calculator', 'Stan calculator.js:', {
            scriptLoaded: calculatorScriptLoaded,
            initialized: calculatorInitialized,
            updatePricesAvailable: typeof updatePrices === 'function',
            pricesDataAvailable: typeof window.pricesFromDatabase !== 'undefined',
            multipliersAvailable: typeof window.multiplierMapping !== 'undefined',
            ready: isReady
        });
    }

    return isReady;
}

/**
 * Sprawdzanie czy wycena może być edytowana - zoptymalizowane
 */
function canEditQuote(quoteData) {
    const nonEditableStatuses = ['Zaakceptowane', 'Zamówione', 'Zrealizowane', 'Anulowane'];

    if (nonEditableStatuses.includes(quoteData.status_name)) {
        return false;
    }

    if (quoteData.accepted_by_email && quoteData.acceptance_date) {
        return false;
    }

    return true;
}

/**
 * Zoptymalizowana inicjalizacja kalkulatora
 */
function initializeCalculatorForEditor() {
    if (calculatorInitialized) return;

    // Batch initialization
    const initTasks = [
        initializePriceIndex,
        initializeMultiplierMapping,
        copyVariantMappingToEditor
    ];

    initTasks.forEach(task => {
        try {
            task();
        } catch (error) {
            console.warn(`[QUOTE EDITOR] Błąd w ${task.name}:`, error);
        }
    });

    calculatorInitialized = true;
    log('calculator', '✅ Calculator.js zainicjalizowany');
}

function initializePriceIndex() {
    const pricesDataEl = document.getElementById('prices-data');
    if (pricesDataEl) {
        const pricesFromDatabase = JSON.parse(pricesDataEl.textContent);
        window.pricesFromDatabase = pricesFromDatabase;

        // Build index efficiently
        window.priceIndex = pricesFromDatabase.reduce((index, entry) => {
            const key = `${entry.species}::${entry.technology}::${entry.wood_class}`;
            if (!index[key]) index[key] = [];
            index[key].push(entry);
            return index;
        }, {});

        log('calculator', '✅ Zainicjalizowano priceIndex');
    }
}

function initializeMultiplierMapping() {
    if (typeof window.multiplierMapping === 'undefined') {
        const multipliersDataEl = document.getElementById('multipliers-data');
        if (multipliersDataEl) {
            const multipliersFromDB = JSON.parse(multipliersDataEl.textContent);
            window.multiplierMapping = multipliersFromDB.reduce((mapping, m) => {
                mapping[m.label] = m.value;
                return mapping;
            }, {});

            log('calculator', '✅ Zainicjalizowano multiplierMapping');
        }
    }
}

function copyVariantMappingToEditor() {
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
        log('calculator', '✅ Skopiowano variantMapping');
    }
}

// ==================== OPTIMIZED PRODUCT MANAGEMENT ====================

/**
 * Zoptymalizowana aktywacja produktu
 */
function activateProductInEditor(productIndex) {
    if (!currentEditingQuoteData) return;

    const productItem = currentEditingQuoteData.items.find(item => item.product_index === productIndex);
    if (!productItem) return;

    activeProductIndex = productIndex;

    // Batch UI updates
    updateProductCardStates(productIndex);
    loadProductDataToForm(productItem);

    // DODAJ TO: Ustaw odpowiedni wariant dla aktywnego produktu
    if (currentEditingQuoteData) {
        setSelectedVariantForActiveProduct(productIndex);
    }

    log('editor', `Aktywowano produkt: ${productIndex}`);
}

function updateProductCardStates(activeIndex) {
    const cards = document.querySelectorAll('.product-card');
    cards.forEach(card => {
        card.classList.toggle('active', parseInt(card.dataset.index) === activeIndex);
    });
}

/**
 * Zoptymalizowane ładowanie danych produktu
 */
function loadProductDataToForm(productItem) {
    const fieldMappings = [
        { field: 'edit-length', value: productItem.length_cm },
        { field: 'edit-width', value: productItem.width_cm },
        { field: 'edit-thickness', value: productItem.thickness_cm },
        { field: 'edit-quantity', value: productItem.quantity || 1 }
    ];

    // Batch field updates
    fieldMappings.forEach(({ field, value }) => {
        const element = document.getElementById(field);
        if (element) element.value = value || '';
    });

    // Handle variant selection
    if (productItem.variant_code) {
        selectVariantByCode(productItem.variant_code);
    }
}

/**
 * DODAJ TĘ FUNKCJĘ - Główna funkcja ustawiająca wybrane warianty na podstawie danych z wyceny
 */
function setSelectedVariantsByQuote(quoteData) {
    log('editor', 'Ustawianie wybranych wariantów z wyceny...');

    if (!quoteData?.items?.length) {
        log('editor', 'Brak pozycji w wycenie - używam domyślnych ustawień');
        setDefaultVariantSelection();
        return;
    }

    // Zbierz wybrane warianty dla każdego produktu
    const selectedVariantsByProduct = new Map();

    quoteData.items.forEach(item => {
        if (item.is_selected && item.variant_code) {
            selectedVariantsByProduct.set(item.product_index, item.variant_code);
            log('editor', `Produkt ${item.product_index}: wybrany wariant ${item.variant_code}`);
        }
    });

    // Jeśli nie ma wybranych wariantów, ustaw domyślne
    if (selectedVariantsByProduct.size === 0) {
        log('editor', 'Brak wybranych wariantów - używam domyślnych');
        setDefaultVariantSelection();
        return;
    }

    // Ustaw warianty w interfejsie edytora
    setVariantsInEditor(selectedVariantsByProduct);
}

/**
 * DODAJ TĘ FUNKCJĘ - Ustawia warianty w interfejsie edytora na podstawie mapy wybranych wariantów
 */
function setVariantsInEditor(selectedVariantsByProduct) {
    // Najpierw wyczyść wszystkie zaznaczenia
    clearAllVariantSelections();

    // Dla aktywnego produktu ustaw odpowiedni wariant
    if (activeProductIndex !== null && selectedVariantsByProduct.has(activeProductIndex)) {
        const variantCode = selectedVariantsByProduct.get(activeProductIndex);
        selectVariantByCode(variantCode);
        log('editor', `Ustawiono wariant ${variantCode} dla aktywnego produktu ${activeProductIndex}`);
    } else {
        // Jeśli aktywny produkt nie ma wybranego wariantu, ustaw pierwszy dostępny
        selectFirstAvailableVariant();
        log('editor', 'Ustawiono pierwszy dostępny wariant dla aktywnego produktu');
    }
}

/**
 * DODAJ TĘ FUNKCJĘ - Wyczyść wszystkie zaznaczenia wariantów
 */
function clearAllVariantSelections() {
    document.querySelectorAll('input[name="edit-variantOption"]').forEach(radio => {
        radio.checked = false;
    });

    // Usuń klasy selected z variant-option
    document.querySelectorAll('.variant-option').forEach(option => {
        option.classList.remove('selected');
    });

    log('editor', 'Wyczyszczono wszystkie zaznaczenia wariantów');
}

/**
 * DODAJ TĘ FUNKCJĘ - Ustawianie domyślnego wariantu (gdy brak danych z wyceny)
 */
function setDefaultVariantSelection() {
    log('editor', 'Ustawianie domyślnego wariantu...');

    // Sprawdź czy istnieje preferowany wariant "dab-lity-ab"
    const defaultVariant = document.querySelector('input[name="edit-variantOption"][value="dab-lity-ab"]');

    if (defaultVariant && !defaultVariant.disabled) {
        defaultVariant.checked = true;
        updateSelectedVariant(defaultVariant);
        log('editor', 'Ustawiono domyślny wariant: dab-lity-ab');
    } else {
        // Jeśli domyślny wariant nie jest dostępny, wybierz pierwszy dostępny
        selectFirstAvailableVariant();
        log('editor', 'Domyślny wariant niedostępny - wybrano pierwszy dostępny');
    }
}

/**
 * DODAJ TĘ FUNKCJĘ - Pomocnicza funkcja do sprawdzania wybranych wariantów
 */
function getSelectedVariantForProduct(quoteData, productIndex) {
    if (!quoteData?.items) return null;

    const selectedItem = quoteData.items.find(item =>
        item.product_index === productIndex && item.is_selected
    );

    return selectedItem?.variant_code || null;
}

/**
 * DODAJ TĘ FUNKCJĘ - Funkcja do sprawdzania czy wariant jest dostępny w edytorze
 */
function isVariantAvailableInEditor(variantCode) {
    const radioButton = document.querySelector(`input[name="edit-variantOption"][value="${variantCode}"]`);
    return radioButton && !radioButton.disabled;
}

/**
 * DODAJ TĘ FUNKCJĘ - Funkcja pomocnicza dla aktywnego produktu - ustaw odpowiedni wariant
 */
function setSelectedVariantForActiveProduct(productIndex) {
    // Znajdź wybrany wariant dla tego produktu
    const selectedVariant = getSelectedVariantForProduct(currentEditingQuoteData, productIndex);

    if (selectedVariant && isVariantAvailableInEditor(selectedVariant)) {
        selectVariantByCode(selectedVariant);
        log('editor', `Ustawiono wariant ${selectedVariant} dla produktu ${productIndex}`);
    } else {
        // Fallback - ustaw pierwszy dostępny wariant
        selectFirstAvailableVariant();
        log('editor', `Nie znaleziono wybranego wariantu - ustawiono pierwszy dostępny dla produktu ${productIndex}`);
    }
}

function selectVariantByCode(variantCode) {
    if (!variantCode) {
        log('editor', 'Brak kodu wariantu - pomijam selekcję');
        return;
    }

    // Wyczyść poprzednie zaznaczenia
    clearAllVariantSelections();

    // Znajdź odpowiedni radio button
    const radioButton = document.querySelector(`input[name="edit-variantOption"][value="${variantCode}"]`);

    if (radioButton) {
        // Sprawdź czy wariant jest dostępny
        if (radioButton.disabled) {
            log('editor', `Wariant ${variantCode} jest niedostępny - wybierz pierwszy dostępny`);
            selectFirstAvailableVariant();
            return;
        }

        // Zaznacz wariant
        radioButton.checked = true;
        updateSelectedVariant(radioButton);

        // Wywołaj event change dla aktualizacji cen
        radioButton.dispatchEvent(new Event('change', { bubbles: true }));

        log('editor', `✅ Wybrano wariant: ${variantCode}`);
    } else {
        log('editor', `❌ Nie znaleziono radio button dla wariantu: ${variantCode}`);
        selectFirstAvailableVariant();
    }
}

// ==================== OPTIMIZED MODAL MANAGEMENT ====================

/**
 * Zoptymalizowana konfiguracja zamykania modalu
 */
function setupModalCloseHandlers() {
    const modal = document.getElementById('quote-editor-modal');
    const closeElements = [
        '#close-quote-editor',
        '#cancel-quote-edit'
    ];

    const closeModal = () => {
        modal.style.display = 'none';
        resetEditorState();
    };

    // Attach close handlers
    closeElements.forEach(selector => {
        const element = document.querySelector(selector);
        if (element) element.onclick = closeModal;
    });

    // Background click to close
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
}

function resetEditorState() {
    currentEditingQuoteData = null;
    activeProductIndex = null;
    resetCalculatorAfterEditor();
}

/**
 * Zoptymalizowany reset kalkulatora
 */
function resetCalculatorAfterEditor() {
    log('calculator', 'Reset konfiguracji calculator.js...');

    // Restore original functions
    const restoreFunctions = [
        { backup: 'originalUpdatePrices', target: 'updatePrices' },
        { backup: 'originalUpdateVariantAvailability', target: 'updateVariantAvailability' }
    ];

    restoreFunctions.forEach(({ backup, target }) => {
        if (window[backup]) {
            window[target] = window[backup];
            delete window[backup];
        }
    });

    // Restore original variables
    const restoreVariables = [
        { backup: 'originalQuoteFormsContainer', target: 'quoteFormsContainer' },
        { backup: 'originalActiveQuoteForm', target: 'activeQuoteForm' }
    ];

    restoreVariables.forEach(({ backup, target }) => {
        if (window[backup]) {
            window[target] = window[backup];
            delete window[backup];
        } else {
            window[target] = null;
        }
    });

    // Remove temporary container
    const tempContainer = document.querySelector('#quote-editor-modal .quote-forms-container');
    if (tempContainer) tempContainer.remove();
}

// ==================== OPTIMIZED SAVE FUNCTIONALITY ====================

/**
 * Zoptymalizowane zapisywanie zmian
 */
function saveQuoteChanges() {
    log('editor', 'Zapisywanie zmian w wycenie...');

    if (!currentEditingQuoteData) {
        alert('Błąd: Brak danych wyceny do zapisu');
        return;
    }

    if (!validateFormBeforeSave()) return;

    const updatedData = collectUpdatedQuoteData();
    if (!updatedData) {
        alert('Błąd: Nie udało się zebrać danych z formularza');
        return;
    }

    log('editor', 'Dane do zapisu:', updatedData);

    // TODO: Implement actual save to backend
    alert('Zapisywanie zmian będzie dostępne wkrótce!\n\nZebrane dane:\n' + JSON.stringify(updatedData, null, 2));
}

/**
 * Zbieranie danych do zapisu - zoptymalizowane
 */
function collectUpdatedQuoteData() {
    try {
        const formFields = ['edit-clientType', 'edit-length', 'edit-width', 'edit-thickness', 'edit-quantity'];
        const data = {};

        formFields.forEach(fieldId => {
            const element = document.getElementById(fieldId);
            if (element) {
                const key = fieldId.replace('edit-', '');
                data[key] = fieldId === 'edit-clientType' ? element.value : parseFloat(element.value) || 0;
            }
        });

        const selectedVariant = document.querySelector('input[name="edit-variantOption"]:checked');

        return {
            quote_id: currentEditingQuoteData.id,
            client_type: data.clientType,
            active_product: {
                index: activeProductIndex,
                length_cm: data.length,
                width_cm: data.width,
                thickness_cm: data.thickness,
                quantity: parseInt(data.quantity) || 1,
                variant_code: selectedVariant?.value || null,
                variant_name: selectedVariant?.dataset.variantName || null
            }
        };
    } catch (error) {
        console.error('[QUOTE EDITOR] Błąd zbierania danych:', error);
        return null;
    }
}

// ==================== OPTIMIZED FINISHING DATA LOADING ====================

/**
 * Zoptymalizowane ładowanie danych wykończenia z pobraniem cen z bazy danych
 */
async function loadFinishingDataFromDatabase() {
    if (finishingDataCache) {
        log('finishing', 'Używam cache danych wykończenia');
        renderFinishingUI(finishingDataCache);
        return finishingDataCache;
    }

    try {
        // Pobierz dane wykończenia z quotes API (zawiera więcej informacji)
        const response = await fetch('/quotes/api/finishing-data');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        finishingDataCache = data; // Cache result

        // Przygotuj mapę cen dla łatwego dostępu
        window.finishingPrices = {};
        data.finishing_types.forEach(type => {
            window.finishingPrices[type.name] = parseFloat(type.price_netto);
        });

        renderFinishingUI(data);
        log('finishing', `✅ Załadowano dane wykończenia z bazy danych (${data.finishing_types.length} typów, ${data.finishing_colors.length} kolorów)`);
        log('finishing', 'Ceny wykończeń z bazy:', window.finishingPrices);

        return data;

    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd ładowania danych wykończenia:', error);
        loadDefaultFinishingData();
        return null;
    }
}

/**
 * Inicjalizacja ładowania cen wykończenia przy starcie edytora
 */
async function initializeFinishingPrices() {
    log('finishing', 'Inicjalizacja cen wykończenia...');

    try {
        await loadFinishingDataFromDatabase();
        log('finishing', '✅ Ceny wykończenia zainicjalizowane');
    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd inicjalizacji cen wykończenia:', error);
        loadDefaultFinishingData();
    }
}

function renderFinishingUI(data) {
    renderFinishingTypeButtonsFromDb(data.finishing_types);
    generateFinishingColorOptions(data.finishing_colors);
}

function renderFinishingTypeButtonsFromDb(finishingTypes) {
    const container = document.getElementById('edit-finishing-type-group');
    if (!container) return;

    const allowedTypes = ['Surowe', 'Lakierowanie', 'Olejowanie'];
    const fragment = document.createDocumentFragment();

    allowedTypes.forEach((type, index) => {
        const btn = createElement('button', {
            className: `finishing-btn${index === 0 ? ' active' : ''}`,
            textContent: type
        });
        btn.dataset.finishingType = type;
        fragment.appendChild(btn);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

/**
 * Zoptymalizowane generowanie opcji kolorów
 */
function generateFinishingColorOptions(finishingColors) {
    const container = document.querySelector('#edit-finishing-color-wrapper .color-group');
    if (!container) return;

    const fragment = document.createDocumentFragment();

    finishingColors.forEach(color => {
        const button = createElement('button', {
            className: 'color-btn'
        });
        button.dataset.finishingColor = color.name;

        if (color.image_url) {
            const img = createElement('img', {
                src: color.image_url,
                alt: color.name
            });
            img.onerror = () => img.style.display = 'none';
            button.appendChild(img);
        }

        const span = createElement('span', {
            textContent: color.name
        });
        button.appendChild(span);

        fragment.appendChild(button);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

// ==================== OPTIMIZED VARIANT MANAGEMENT ====================

/**
 * Zoptymalizowane dodawanie wariantów do formularza kalkulatora
 */
function addVariantsToCalculatorForm() {
    if (!window.activeQuoteForm) return;

    const variantsContainer = window.activeQuoteForm.querySelector('.variants');
    if (!variantsContainer || variantsContainer.children.length > 0) return;

    const editorVariants = document.querySelectorAll('.variant-option');
    const allForms = window.quoteFormsContainer.querySelectorAll('.quote-form');
    const tabIndex = Array.from(allForms).indexOf(window.activeQuoteForm);

    const fragment = document.createDocumentFragment();

    editorVariants.forEach(editorVariant => {
        const radio = editorVariant.querySelector('input[type="radio"]');
        if (!radio) return;

        const calculatorVariant = createCalculatorVariant(radio, tabIndex);
        fragment.appendChild(calculatorVariant);
    });

    variantsContainer.appendChild(fragment);
    log('calculator', `✅ Dodano ${editorVariants.length} wariantów do kalkulatora (tabIndex: ${tabIndex})`);
}

function createCalculatorVariant(sourceRadio, tabIndex) {
    const container = createElement('div', {
        className: 'variant-item',
        style: 'display: none'
    });

    // ✅ POPRAWKA: Poprawna nazwa radio button
    const radio = createElement('input', {
        type: 'radio',
        name: `variant-product-${tabIndex}-selected`, // Prawidłowa nazwa
        id: `calc-${sourceRadio.id}-${tabIndex}`, // Unikalne ID
        value: sourceRadio.value,
        checked: sourceRadio.checked
    });

    // Create price spans
    const priceSpans = ['unit-brutto', 'unit-netto', 'total-brutto', 'total-netto'];
    const elements = [radio];

    priceSpans.forEach(className => {
        elements.push(createElement('span', {
            className,
            textContent: 'Obliczanie...' // Domyślny tekst
        }));
    });

    elements.forEach(el => container.appendChild(el));
    return container;
}

// ==================== OPTIMIZED SYNC FUNCTIONS ====================

/**
 * Zoptymalizowana synchronizacja stanów dostępności
 */
function syncAvailabilityStates(mockForm) {
    const editorCheckboxes = document.querySelectorAll('#quote-editor-modal .variant-availability-checkbox');

    editorCheckboxes.forEach(editorCheckbox => {
        const variant = editorCheckbox.dataset.variant;
        if (!variant) return;

        const mockCheckbox = mockForm.querySelector(`[data-variant="${variant}"]`);
        if (mockCheckbox) {
            mockCheckbox.checked = editorCheckbox.checked;

            const mockRadio = mockCheckbox.parentElement.querySelector('input[type="radio"]');
            if (mockRadio) {
                mockRadio.disabled = !editorCheckbox.checked;
            }
        }
    });
}

function syncSelectedVariant() {
    if (!window.activeQuoteForm) return;

    const selectedEditorRadio = document.querySelector('.variant-option input[type="radio"]:checked');
    if (!selectedEditorRadio) return;

    const calculatorRadio = window.activeQuoteForm.querySelector(`input[value="${selectedEditorRadio.value}"]`);
    if (calculatorRadio) {
        calculatorRadio.checked = true;
    }
}

// ==================== OPTIMIZED PRICE CALCULATION ====================

/**
 * Zoptymalizowana funkcja getEditorPrice
 */
function getEditorPrice(species, technology, wood_class, thickness, length) {
    const roundedThickness = Math.ceil(thickness);
    const key = `${species}::${technology}::${wood_class}`;
    const entries = window.priceIndex?.[key] || [];

    if (entries.length === 0) return null;

    // Optimized search - break early when found
    for (const entry of entries) {
        const thickOk = roundedThickness >= entry.thickness_min && roundedThickness <= entry.thickness_max;
        const lengthOk = length >= entry.length_min && length <= entry.length_max;

        if (thickOk && lengthOk) {
            return entry;
        }
    }

    return null;
}

/**
 * Zoptymalizowana funkcja getFinishingPrice
 */
function getFinishingPrice(finishingType, finishingVariant) {
    // Spróbuj użyć globalnych cen
    if (window.finishingPrices) {
        if (finishingType === 'Lakierowanie' && finishingVariant === 'Bezbarwne') {
            return window.finishingPrices['Lakierowane bezbarwne'] || 200;
        } else if (finishingType === 'Lakierowanie' && finishingVariant === 'Barwne') {
            return window.finishingPrices['Lakierowane barwne'] || 250;
        } else if (finishingType === 'Olejowanie') {
            return window.finishingPrices['Olejowanie'] || 250;
        }
    }

    // Fallback prices
    const defaultPrices = {
        'Lakierowanie': {
            'Bezbarwne': 200,
            'Barwne': 250
        },
        'Olejowanie': 250
    };

    if (finishingType === 'Olejowanie') {
        return defaultPrices.Olejowanie;
    }

    if (finishingType === 'Lakierowanie' && finishingVariant) {
        return defaultPrices.Lakierowanie[finishingVariant] || 0;
    }

    return 0;
}

function syncFinishingStateToMockForm() {
    if (!window.activeQuoteForm) return;

    const finishingType = getSelectedFinishingType();
    const finishingVariant = getSelectedFinishingVariant();
    const finishingColor = getSelectedFinishingColor();

    // Reset wszystkich przycisków w mock formularzu
    const mockForm = window.activeQuoteForm;
    mockForm.querySelectorAll('.finishing-btn.active').forEach(btn => {
        btn.classList.remove('active');
    });

    // Ustaw active dla odpowiednich przycisków
    if (finishingType) {
        const typeBtn = mockForm.querySelector(`[data-finishing-type="${finishingType}"]`);
        if (typeBtn) {
            typeBtn.classList.add('active');
            log('finishing', `Zsynchronizowano typ: ${finishingType}`);
        }
    }

    if (finishingVariant) {
        const variantBtn = mockForm.querySelector(`[data-finishing-variant="${finishingVariant}"]`);
        if (variantBtn) {
            variantBtn.classList.add('active');
            log('finishing', `Zsynchronizowano wariant: ${finishingVariant}`);
        }
    }

    if (finishingColor) {
        const colorBtn = mockForm.querySelector(`[data-finishing-color="${finishingColor}"]`);
        if (colorBtn) {
            colorBtn.classList.add('active');
            log('finishing', `Zsynchronizowano kolor: ${finishingColor}`);
        }
    }

    log('finishing', `✅ Zsynchronizowano wykończenie do mock form: ${finishingType}/${finishingVariant}/${finishingColor}`);
}

// ==================== OPTIMIZED HELPER FUNCTIONS ====================

/**
 * Zoptymalizowane funkcje pomocnicze
 */
function translateVariantCode(variantCode) {
    if (!variantCode) return 'Nieznany wariant';

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

    return translations[variantCode] || variantCode;
}

function generateProductDescriptionForQuote(item, productItems) {
    const translatedVariant = translateVariantCode(item.variant_code);
    const dimensions = `${item.length_cm}×${item.width_cm}×${item.thickness_cm} cm`;

    let finishing = '';
    if (item.finishing_type && item.finishing_type !== 'Surowe') {
        finishing = ` | ${item.finishing_type}`;
        if (item.finishing_color) {
            finishing += ` ${item.finishing_color}`;
        }
    }

    const quantity = ` | ${item.quantity} szt.`;
    const main = `${translatedVariant} ${dimensions}${finishing}${quantity}`;

    // POPRAWKA: Oblicz objętość i wagę jeśli nie są dostępne
    const volume = item.volume_m3 || calculateProductVolumeFromItem(item);
    const weight = item.weight_kg || calculateProductWeightFromItem(item);

    const volumeText = volume ? `${volume.toFixed(3)} m³` : '0.000 m³';
    const weightText = formatWeightDisplay(weight);
    const sub = `${volumeText} | ${weightText}`;

    return { main, sub };
}

/**
 * NOWA funkcja - oblicza objętość produktu na podstawie danych z item
 */
function calculateProductVolumeFromItem(item) {
    if (!item.length_cm || !item.width_cm || !item.thickness_cm || !item.quantity) {
        return 0;
    }

    const length = parseFloat(item.length_cm) || 0;
    const width = parseFloat(item.width_cm) || 0;
    const thickness = parseFloat(item.thickness_cm) || 0;
    const quantity = parseInt(item.quantity) || 1;

    if (length <= 0 || width <= 0 || thickness <= 0) {
        return 0;
    }

    // Oblicz objętość: wymiary w cm → metry → m³
    const singleVolumeM3 = (length / 100) * (width / 100) * (thickness / 100);
    const totalVolumeM3 = singleVolumeM3 * quantity;

    return totalVolumeM3;
}

/**
 * NOWA funkcja - oblicza wagę produktu na podstawie objętości
 */
function calculateProductWeightFromItem(item) {
    const volume = item.volume_m3 || calculateProductVolumeFromItem(item);

    if (!volume || volume <= 0) {
        return 0;
    }

    // Gęstość drewna: 800 kg/m³ (tak samo jak w calculator.js)
    const WOOD_DENSITY = 800; // kg/m³
    const weight = volume * WOOD_DENSITY;

    return weight;
}

/**
 * NOWA funkcja - aktualizuje podsumowanie objętości i wagi w edytorze wyceny
 * Można wywołać po zmianie danych produktu
 */
function updateProductsSummaryTotals() {
    if (!currentEditingQuoteData) return;

    const { totalVolume, totalWeight } = calculateTotalVolumeAndWeightFromQuote(currentEditingQuoteData);

    // Znajdź lub utwórz element podsumowania
    let summaryElement = document.querySelector('.products-total-summary');

    if (!summaryElement && (totalVolume > 0 || totalWeight > 0)) {
        // Utwórz element podsumowania jeśli nie istnieje
        const container = document.getElementById('edit-products-summary-container');
        if (container) {
            summaryElement = document.createElement('div');
            summaryElement.className = 'products-total-summary';
            container.appendChild(summaryElement);
        }
    }

    if (summaryElement) {
        summaryElement.innerHTML = `
            <div class="products-total-title">Łączne podsumowanie:</div>
            <div class="products-total-details">
                <span class="products-total-volume">${formatVolumeDisplay(totalVolume)}</span>
                <span class="products-total-weight">${formatWeightDisplay(totalWeight)}</span>
            </div>
        `;
    }

    log('editor', `Zaktualizowano podsumowanie: ${formatVolumeDisplay(totalVolume)} | ${formatWeightDisplay(totalWeight)}`);
}

/**
 * POPRAWIONA funkcja dla modułu quotes - skopiowana z calculator.js
 * Oblicza łączną objętość i wagę wszystkich produktów w wycenie
 */
function calculateTotalVolumeAndWeightFromQuote(quoteData) {
    if (!quoteData?.items?.length) {
        return { totalVolume: 0, totalWeight: 0 };
    }

    let totalVolume = 0;
    let totalWeight = 0;

    // Iteruj przez wszystkie elementy wyceny
    quoteData.items.forEach(item => {
        // Sprawdź czy produkt jest kompletny (ma wszystkie wymagane dane)
        const isComplete = checkProductCompletenessForQuote(item);

        if (isComplete) {
            // Oblicz objętość i wagę dla tego produktu
            const itemVolume = item.volume_m3 || calculateProductVolumeFromItem(item);
            const itemWeight = item.weight_kg || calculateProductWeightFromItem(item);

            totalVolume += itemVolume;
            totalWeight += itemWeight;
        }
    });

    return {
        totalVolume: Math.round(totalVolume * 1000) / 1000, // Zaokrągl do 3 miejsc po przecinku
        totalWeight: Math.round(totalWeight * 10) / 10      // Zaokrągl do 1 miejsca po przecinku
    };
}

/**
 * NOWA funkcja - formatuje wagę do wyświetlenia
 */
function formatWeightDisplay(weight) {
    if (!weight || weight <= 0) {
        return "0.0 kg";
    }

    // Jeśli waga >= 1000 kg, pokaż w tonach
    if (weight >= 1000) {
        return `${(weight / 1000).toFixed(2)} t`;
    }

    return `${weight.toFixed(1)} kg`;
}

/**
 * NOWA funkcja - formatuje objętość do wyświetlenia
 */
function formatVolumeDisplay(volume) {
    if (!volume || volume <= 0) {
        return "0.000 m³";
    }

    return `${volume.toFixed(3)} m³`;
}

function checkProductCompletenessForQuote(item) {
    const requiredFields = [
        item.length_cm, item.width_cm, item.thickness_cm, item.quantity,
        item.variant_code, item.finishing_type,
        item.final_price_netto, item.final_price_brutto
    ];

    return requiredFields.every(field => !!field);
}

// ==================== FALLBACK FUNCTIONS ====================

/**
 * Domyślne dane wykończenia
 */
function loadDefaultFinishingData() {
    const defaultData = {
        finishing_types: [
            { name: 'Surowe', price_netto: 0 },
            { name: 'Lakierowanie bezbarwne', price_netto: 200 },
            { name: 'Lakierowanie barwne', price_netto: 250 },
            { name: 'Olejowanie', price_netto: 250 }
        ],
        finishing_colors: [
            { name: 'POPIEL 20-07', image_url: '/calculator/static/images/finishing_colors/popiel-20-07.jpg' },
            { name: 'BEŻ BN-125/09', image_url: '/calculator/static/images/finishing_colors/bez-bn-125-09.jpg' },
            { name: 'BRUNAT 22-10', image_url: '/calculator/static/images/finishing_colors/brunat-22-10.jpg' }
        ]
    };

    finishingDataCache = defaultData;
    renderFinishingUI(defaultData);
}

function loadDefaultClientTypes() {
    const defaultGroups = [
        { client_type: 'Partner', multiplier: 1.0 },
        { client_type: 'Hurt', multiplier: 1.1 },
        { client_type: 'Detal', multiplier: 1.3 },
        { client_type: 'Detal+', multiplier: 1.5 }
    ];

    clientTypesCache = defaultGroups;
    populateClientTypeSelect(defaultGroups);
}

/**
 * Fallback calculation gdy calculator.js niedostępny
 */
function calculateEditorPrices() {
    log('editor', 'Wykonuję obliczenia fallback...');

    const dimensions = getCurrentDimensions();
    if (!dimensions.isValid) {
        showVariantErrors('Brak wymiarów');
        return;
    }

    const volume =
        (dimensions.length / 1000) *
        (dimensions.width / 1000) *
        (dimensions.thickness / 1000) *
        dimensions.quantity;

    // Show calculating state
    document.querySelectorAll('.variant-option').forEach(variant => {
        const priceElements = variant.querySelectorAll('.unit-brutto, .unit-netto, .total-brutto, .total-netto');
        priceElements.forEach(el => el.textContent = 'Obliczanie...');
    });

    log('editor', `✅ Fallback calculation - objętość: ${volume}`);
}

function showVariantErrors(errorMessage) {
    document.querySelectorAll('.variant-option').forEach(option => {
        const priceElements = option.querySelectorAll('.unit-brutto, .total-brutto');
        priceElements.forEach(el => el.textContent = errorMessage);

        const emptyElements = option.querySelectorAll('.unit-netto, .total-netto');
        emptyElements.forEach(el => el.textContent = '');
    });
}

// ==================== BACKUP AND RESTORE FUNCTIONS ====================

/**
 * Backup original calculator state
 */
function backupOriginalCalculatorState() {
    const backups = [
        { original: 'quoteFormsContainer', backup: 'originalQuoteFormsContainer' },
        { original: 'activeQuoteForm', backup: 'originalActiveQuoteForm' },
        { original: 'updatePrices', backup: 'originalUpdatePrices' },
        { original: 'updateVariantAvailability', backup: 'originalUpdateVariantAvailability' }
    ];

    backups.forEach(({ original, backup }) => {
        if (window[original] && !window[backup]) {
            window[backup] = window[original];
        }
    });
}

// ==================== INITIALIZATION AND CLEANUP ====================

/**
 * Zoptymalizowane operacje początkowe
 */
function performInitialCalculations(quoteData) {
    // Batch initial operations
    const operations = [
        () => triggerSyntheticRecalc(),
        () => applyHiddenVariantsFromQuoteData(quoteData),
        () => initializeSummaryUpdates()
    ];

    operations.forEach((operation, index) => {
        setTimeout(operation, index * 100); // Staggered execution
    });
}

function triggerSyntheticRecalc() {
    // Trigger events on all inputs at once
    const inputs = document.querySelectorAll('#quote-editor-modal input, #quote-editor-modal select');
    const events = ['input', 'change'];

    inputs.forEach(el => {
        events.forEach(eventType => {
            el.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
    });

    // Call recalculation function if available
    const recalcFunctions = ['recalculateEditorTotals', 'onFormDataChange'];
    for (const funcName of recalcFunctions) {
        if (typeof window[funcName] === 'function') {
            window[funcName]();
            break;
        }
    }
}

function applyHiddenVariantsFromQuoteData(quoteData) {
    if (!quoteData?.products) return;

    quoteData.products.forEach(prod => {
        if (!Array.isArray(prod.variants)) return;

        prod.variants.forEach(variant => {
            const code = variant.code || variant.variant_code;
            if (!code) return;

            const selectors = [
                `.variant-availability-checkbox[data-variant="${code}"][data-product-index="${prod.index}"]`,
                `.variant-availability-checkbox[data-variant="${code}"]`
            ];

            for (const selector of selectors) {
                const checkbox = document.querySelector(selector);
                if (checkbox) {
                    const isHidden = variant.hidden === true || variant.show_on_client_page === false;
                    checkbox.checked = !isHidden;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        });
    });
}

/**
 * Zoptymalizowana inicjalizacja automatycznego odświeżania
 */
function initializeSummaryUpdates() {
    log('editor', 'Inicjalizacja automatycznego odświeżania...');

    // Single timeout for initial summary update
    setTimeout(updateQuoteSummary, 500);
}

// ==================== CLIENT TYPE MANAGEMENT ====================

/**
 * Zoptymalizowana obsługa zmiany grupy cenowej
 */
function onClientTypeChange() {
    const clientTypeSelect = document.getElementById('edit-clientType');
    if (!clientTypeSelect) return;

    const selectedOption = clientTypeSelect.options[clientTypeSelect.selectedIndex];
    if (!selectedOption) return;

    const multiplierValue = selectedOption.dataset.multiplierValue;
    const clientType = selectedOption.value;

    log('sync', `Zmiana grupy cenowej: ${clientType} (mnożnik: ${multiplierValue})`);
    onFormDataChange();
}

// ==================== PLACEHOLDER FUNCTIONS (TODO) ====================

/**
 * Placeholder functions - to be implemented
 */
function addNewProductToQuote() {
    log('editor', 'Dodawanie nowego produktu...');
    alert('Funkcja dodawania produktów będzie dostępna wkrótce!');
}

function removeProductFromQuote(productIndex) {
    log('editor', `Usuwanie produktu: ${productIndex}`);

    if (!confirm('Czy na pewno chcesz usunąć ten produkt?')) return;

    alert(`Usuwanie produktu ${productIndex} będzie dostępne wkrótce!`);
}

// ==================== ERROR HANDLING ====================

/**
 * Centralized error display
 */
function showErrorForAllVariants(errorMsg, variantContainer) {
    const variantItems = Array.from(variantContainer.children)
        .filter(child => child.querySelector('input[type="radio"]'));

    const priceSelectors = ['.unit-brutto', '.total-brutto'];
    const emptySelectors = ['.unit-netto', '.total-netto'];

    variantItems.forEach(variant => {
        priceSelectors.forEach(selector => {
            const el = variant.querySelector(selector);
            if (el) el.textContent = errorMsg;
        });

        emptySelectors.forEach(selector => {
            const el = variant.querySelector(selector);
            if (el) el.textContent = '';
        });
    });
}

// ==================== MAIN INITIALIZATION ====================

/**
 * Zoptymalizowana inicjalizacja modułu
 */
function initQuoteEditor() {
    log('editor', 'Inicjalizacja modułu Quote Editor');

    const modal = document.getElementById('quote-editor-modal');
    if (!modal) {
        console.warn('[QUOTE EDITOR] Modal edytora nie został znaleziony');
        return;
    }

    log('editor', '✅ Quote Editor gotowy do użycia');
}

// ==================== REMAINING HELPER FUNCTIONS ====================

/**
 * Pozostałe funkcje pomocnicze zachowane dla kompatybilności
 */
function getUniqueProductsCount(items) {
    if (!items?.length) return 0;
    return new Set(items.map(item => item.product_index)).size;
}

function callUpdatePricesSecurely() {
    if (!window.activeQuoteForm) {
        console.error('[QUOTE EDITOR] ❌ activeQuoteForm nie jest ustawiony!');
        return;
    }

    try {
        updatePrices();
        log('calculator', '✅ updatePrices() wykonany pomyślnie');
    } catch (error) {
        console.error('[QUOTE EDITOR] ❌ Błąd w updatePrices():', error);
    }
}

function fixPriceIndexAccess() {
    if (typeof priceIndex !== 'undefined' && priceIndex && Object.keys(priceIndex).length > 0) {
        window.priceIndex = priceIndex;
        return true;
    }

    if (window.pricesFromDatabase?.length) {
        window.priceIndex = window.pricesFromDatabase.reduce((index, entry) => {
            const key = `${entry.species}::${entry.technology}::${entry.wood_class}`;
            if (!index[key]) index[key] = [];
            index[key].push(entry);
            return index;
        }, {});
        return true;
    }

    return false;
}

// ==================== INITIALIZATION ====================

/**
 * DOM Content Loaded - zoptymalizowana inicjalizacja
 */
document.addEventListener('DOMContentLoaded', function () {
    initQuoteEditor();

    // Load finishing data if needed
    if (!finishingDataCache) {
        loadFinishingDataFromDatabase().catch(() => {
            log('finishing', 'Używam domyślnych danych wykończenia');
        });
    }
});

// ==================== EXPORT FUNCTIONS ====================

/**
 * Export głównych funkcji dla kompatybilności
 */
window.QuoteEditor = {
    open: openQuoteEditor,
    close: () => {
        const modal = document.getElementById('quote-editor-modal');
        if (modal) modal.style.display = 'none';
        resetEditorState();
    },
    save: saveQuoteChanges,
    updateSummary: updateQuoteSummary,
    handleFinishingVariantChange,
    // Debug helpers
    setDebugLevel: (category, enabled) => {
        DEBUG_LOGS[category] = enabled;
    },
    getState: () => ({
        currentQuote: currentEditingQuoteData,
        activeProduct: activeProductIndex,
        calculatorReady: checkCalculatorReadiness()
    })
};

// Override attachFinishingUIListeners z calculator.js
window.originalAttachFinishingUIListeners = window.attachFinishingUIListeners;
window.attachFinishingUIListeners = safeAttachFinishingUIListeners;

window.debugFinishingEditor = function () {
    console.log('=== DEBUG EDYTORA WYKOŃCZENIA ===');

    console.log('1. Stan przycisków edytora:');
    console.log('   - Typ:', getSelectedFinishingType());
    console.log('   - Wariant:', getSelectedFinishingVariant());
    console.log('   - Kolor:', getSelectedFinishingColor());

    console.log('2. Mock formularz:');
    if (window.activeQuoteForm) {
        console.log('   - finishingBrutto:', window.activeQuoteForm.dataset.finishingBrutto);
        console.log('   - finishingNetto:', window.activeQuoteForm.dataset.finishingNetto);

        const mockButtons = window.activeQuoteForm.querySelectorAll('.finishing-btn');
        console.log('   - Liczba przycisków w mock:', mockButtons.length);
        mockButtons.forEach((btn, i) => {
            const type = btn.dataset.finishingType || btn.dataset.finishingVariant || btn.dataset.finishingGloss;
            const active = btn.classList.contains('active') ? 'ACTIVE' : 'inactive';
            console.log(`   - Przycisk ${i}: ${type} (${active})`);
        });
    } else {
        console.log('   - BRAK activeQuoteForm!');
    }

    console.log('3. Elementy UI:');
    const bruttoEl = document.querySelector('.edit-finishing-brutto');
    const nettoEl = document.querySelector('.edit-finishing-netto');
    console.log('   - .edit-finishing-brutto:', bruttoEl?.textContent);
    console.log('   - .edit-finishing-netto:', nettoEl?.textContent);

    console.log('4. Obliczenia:');
    const calculated = calculateFinishingCosts();
    console.log('   - calculateFinishingCosts():', calculated);

    console.log('5. Warianty:');
    const variants = document.querySelectorAll('.variant-option input[type="radio"]');
    console.log('   - Liczba wariantów w edytorze:', variants.length);
    variants.forEach((radio, i) => {
        if (radio.checked) {
            console.log(`   - Wybrany wariant ${i}: ${radio.value}`);
        }
    });

    if (window.activeQuoteForm) {
        const mockRadios = window.activeQuoteForm.querySelectorAll('input[type="radio"]');
        console.log('   - Liczba radio w mock formularzu:', mockRadios.length);
        mockRadios.forEach((radio, i) => {
            if (radio.checked) {
                console.log(`   - Wybrany w mock ${i}: ${radio.value} (name: ${radio.name})`);
            }
        });
    }
};

window.monitorVariantChanges = function () {
    console.log('=== MONITORING ZMIAN WARIANTÓW ===');

    // Dodaj temporary listener do monitorowania
    const radios = document.querySelectorAll('input[name="edit-variantOption"]');

    radios.forEach(radio => {
        radio.addEventListener('change', function () {
            console.log(`📡 VARIANT CHANGE DETECTED: ${this.value} (checked: ${this.checked})`);

            setTimeout(() => {
                // Sprawdź co się stało z cenami
                const option = this.closest('.variant-option');
                const bruttoEl = option.querySelector('.total-brutto');
                const nettoEl = option.querySelector('.total-netto');

                console.log(`💰 Ceny po zmianie wariantu:`);
                console.log(`   - Brutto: ${bruttoEl?.textContent}`);
                console.log(`   - Netto: ${nettoEl?.textContent}`);

                // Sprawdź mock formularz
                if (window.activeQuoteForm) {
                    const mockRadio = window.activeQuoteForm.querySelector(`input[value="${this.value}"]`);
                    console.log(`🎭 Mock formularz:`);
                    console.log(`   - Radio checked: ${mockRadio?.checked}`);
                    console.log(`   - Dataset orderBrutto: ${window.activeQuoteForm.dataset.orderBrutto}`);
                    console.log(`   - Dataset orderNetto: ${window.activeQuoteForm.dataset.orderNetto}`);
                }

                // Sprawdź podsumowanie
                const summaryBrutto = document.querySelector('.edit-order-brutto');
                const summaryNetto = document.querySelector('.edit-order-netto');
                console.log(`📊 Podsumowanie:`);
                console.log(`   - Koszt surowego brutto: ${summaryBrutto?.textContent}`);
                console.log(`   - Koszt surowego netto: ${summaryNetto?.textContent}`);

            }, 200);
        });
    });

    console.log(`✅ Monitoring włączony dla ${radios.length} radio buttons`);
    console.log('Kliknij teraz inne warianty i obserwuj logi...');
};