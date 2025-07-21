// calculator.js - Zoptymalizowana wersja
console.log("calculator.js załadowany!");

// ============================================
// GLOBALNE ZMIENNE I KONFIGURACJA
// ============================================

const DEBUG = true;
const dbg = (...args) => DEBUG && console.log(...args);

// Stałe konfiguracyjne
const SHIPPING_PACKING_MULTIPLIER = 1.3;
const VAT_RATE = 1.23;
const WOOD_DENSITY = 800; // kg/m³

// Wiadomości ładowania wysyłki
const shippingMessages = [
    { text: "Wyceniam wysyłkę, proszę czekać...", delay: 0 },
    { text: "Sprawdzam dostępnych kurierów...", delay: 3000 },
    { text: "Wycena mniejszych produktów trwa zwykle dłużej...", delay: 6000 },
    { text: "Jeszcze chwilka...", delay: 9000 },
    { text: "Już widzę kuriera! 🚚", delay: 12000 },
    { text: "Negocjuję najlepszą cenę...", delay: 15000 },
    { text: "Prawie gotowe...", delay: 18000 }
];

// Mapowanie wariantów
const variantMapping = {
    'dab-lity-ab': { species: 'Dąb', technology: 'Lity', wood_class: 'A/B' },
    'dab-lity-bb': { species: 'Dąb', technology: 'Lity', wood_class: 'B/B' },
    'dab-micro-ab': { species: 'Dąb', technology: 'Mikrowczep', wood_class: 'A/B' },
    'dab-micro-bb': { species: 'Dąb', technology: 'Mikrowczep', wood_class: 'B/B' },
    'jes-lity-ab': { species: 'Jesion', technology: 'Lity', wood_class: 'A/B' },
    'jes-micro-ab': { species: 'Jesion', technology: 'Mikrowczep', wood_class: 'A/B' },
    'buk-lity-ab': { species: 'Buk', technology: 'Lity', wood_class: 'A/B' },
    'buk-micro-ab': { species: 'Buk', technology: 'Mikrowczep', wood_class: 'A/B' }
};

// Domyślna dostępność wariantów
const defaultVariantAvailability = {
    'dab-lity-ab': true, 'dab-lity-bb': true, 'dab-micro-ab': true, 'dab-micro-bb': true,
    'jes-lity-ab': true, 'jes-micro-ab': false, 'buk-lity-ab': true, 'buk-micro-ab': false
};

const edgesList = [
    "top-front", "top-back", "top-left", "top-right",
    "bottom-front", "bottom-back", "bottom-left", "bottom-right",
    "left-front", "left-back", "right-front", "right-back"
];

// Zmienne globalne
let messageTimeouts = [];
let currentClientType = '';
let currentMultiplier = 1.0;
let isPartner = false;
let userMultiplier = 1.0;
let multiplierMapping = {};
let pricesFromDatabase = [];
let priceIndex = {};

// Elementy DOM
let quoteFormsContainer = null;
let productSummaryContainer = null;
let activeQuoteForm = null;
let edge3dRoot = null;
let mainContainer = null;

// Elementy podsumowania
let orderSummaryEls = {};
let deliverySummaryEls = {};
let finalSummaryEls = {};
let finishingSummaryEls = {};

// ============================================
// FUNKCJE POMOCNICZE
// ============================================

const formatPLN = (value) => `${value.toFixed(2)} PLN`;
const calculateSingleVolume = (length, width, thickness) => (length / 100) * (width / 100) * (thickness / 100);

function buildPriceIndex() {
    priceIndex = {};
    pricesFromDatabase.forEach(entry => {
        const key = `${entry.species}::${entry.technology}::${entry.wood_class}`;
        if (!priceIndex[key]) priceIndex[key] = [];
        priceIndex[key].push(entry);
    });
}

function getPrice(species, technology, wood_class, thickness, length) {
    const roundedThickness = Math.ceil(thickness);
    const key = `${species}::${technology}::${wood_class}`;
    const arr = priceIndex[key] || [];
    return arr.find(entry =>
        roundedThickness >= entry.thickness_min &&
        roundedThickness <= entry.thickness_max &&
        length >= entry.length_min &&
        length <= entry.length_max
    );
}

// ============================================
// ŁADOWANIE I OBSŁUGA CEN WYKOŃCZEŃ
// ============================================

async function loadFinishingPrices() {
    try {
        const response = await fetch('/calculator/api/finishing-prices');
        if (response.ok) {
            const prices = await response.json();
            window.finishingPrices = {};
            prices.forEach(price => {
                window.finishingPrices[price.name] = parseFloat(price.price_netto);
            });
            console.log('Załadowano ceny wykończeń:', window.finishingPrices);
        } else {
            throw new Error('Błąd pobierania cen wykończeń');
        }
    } catch (error) {
        console.error('Błąd pobierania cen wykończeń:', error);
        // Domyślne ceny jako fallback
        window.finishingPrices = {
            'Surowe': 0,
            'Lakierowane bezbarwne': 200,
            'Lakierowane barwne': 250,
            'Olejowanie': 250
        };
    }
}

// ============================================
// OBSŁUGA ROTUJĄCYCH KOMUNIKATÓW
// ============================================

function showRotatingMessages(overlay) {
    messageTimeouts.forEach(timeout => clearTimeout(timeout));
    messageTimeouts = [];

    overlay.innerHTML = `
        <div class="spinner"></div>
        <div class="loading-text">${shippingMessages[0].text}</div>
    `;

    shippingMessages.slice(1).forEach((message) => {
        const timeout = setTimeout(() => {
            const loadingText = overlay.querySelector('.loading-text');
            if (loadingText) {
                loadingText.style.opacity = '0';
                setTimeout(() => {
                    loadingText.textContent = message.text;
                    loadingText.style.opacity = '1';
                }, 300);
            }
        }, message.delay);
        messageTimeouts.push(timeout);
    });
}

function stopRotatingMessages() {
    messageTimeouts.forEach(timeout => clearTimeout(timeout));
    messageTimeouts = [];
}

// ============================================
// KALKULACJA WYSYŁKI
// ============================================

async function calculateDelivery() {
    dbg("Przycisk 'Oblicz wysyłkę' kliknięty");
    const overlay = document.getElementById('loadingOverlay');

    if (overlay) {
        overlay.style.display = 'flex';
        showRotatingMessages(overlay);
    }

    const shippingParams = computeAggregatedData();
    if (!shippingParams) {
        console.error("Brak danych wysyłki");
        if (overlay) {
            stopRotatingMessages();
            overlay.style.display = 'none';
        }
        return;
    }

    try {
        const response = await fetch('/calculator/shipping_quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(shippingParams)
        });

        if (response.ok) {
            const quotesData = await response.json();
            const quotesList = Array.isArray(quotesData) ? quotesData : [quotesData];
            const quotes = quotesList.map(option => ({
                carrierName: option.carrierName,
                rawGrossPrice: option.grossPrice,
                rawNetPrice: option.netPrice,
                grossPrice: option.grossPrice * SHIPPING_PACKING_MULTIPLIER,
                netPrice: option.netPrice * SHIPPING_PACKING_MULTIPLIER,
                carrierLogoLink: option.carrierLogoLink || ""
            }));

            dbg("Otrzymane wyceny wysyłki:", quotes);

            if (quotes.length === 0) {
                showDeliveryErrorModal("Brak dostępnych metod dostawy.");
            } else {
                const packingInfo = {
                    multiplier: SHIPPING_PACKING_MULTIPLIER,
                    message: `Do cen wysyłki została doliczona kwota ${Math.round((SHIPPING_PACKING_MULTIPLIER - 1) * 100)}% na pakowanie.`
                };
                showDeliveryModal(quotes, packingInfo);
            }
        } else {
            console.error("Błąd w żądaniu wyceny wysyłki:", response.status);
            showDeliveryErrorModal("Błąd serwera przy wycenie wysyłki.");
        }
    } catch (error) {
        console.error("Wyjątek przy wycenie wysyłki:", error);
        showDeliveryErrorModal("Błąd sieci przy wycenie wysyłki.");
    } finally {
        stopRotatingMessages();
        if (overlay) overlay.style.display = 'none';
    }
}

function computeAggregatedData() {
    const forms = quoteFormsContainer.querySelectorAll('.quote-form');
    if (forms.length === 0) {
        console.error("Brak formularzy .quote-form");
        return null;
    }

    let maxLength = 0, maxWidth = 0, totalThickness = 0, totalWeight = 0;

    forms.forEach(form => {
        const lengthVal = parseFloat(form.querySelector('input[data-field="length"]').value) || 0;
        const widthVal = parseFloat(form.querySelector('input[data-field="width"]').value) || 0;
        const thicknessVal = parseFloat(form.querySelector('input[data-field="thickness"]').value) || 0;
        const quantityVal = parseInt(form.querySelector('input[data-field="quantity"]').value) || 1;

        maxLength = Math.max(maxLength, lengthVal);
        maxWidth = Math.max(maxWidth, widthVal);
        totalThickness += thicknessVal * quantityVal;

        const volume = calculateSingleVolume(lengthVal, widthVal, thicknessVal);
        totalWeight += volume * WOOD_DENSITY * quantityVal;
    });

    const aggregatedData = {
        length: maxLength + 5,
        width: maxWidth + 5,
        height: totalThickness + 5,
        weight: totalWeight,
        quantity: 1,
        senderCountryId: "1",
        receiverCountryId: "1"
    };

    dbg("Aggregated dims for shipping:", aggregatedData);
    return aggregatedData;
}

// ============================================
// AKTUALIZACJA PODSUMOWAŃ
// ============================================

function updateGlobalSummary() {
    if (!quoteFormsContainer) return;

    // Sprawdź czy wszystkie wymagane elementy istnieją
    const requiredElements = [
        orderSummaryEls.brutto, orderSummaryEls.netto,
        finishingSummaryEls.brutto, finishingSummaryEls.netto,
        deliverySummaryEls.brutto, deliverySummaryEls.netto,
        finalSummaryEls.brutto, finalSummaryEls.netto
    ];

    if (requiredElements.some(el => !el)) {
        console.warn('updateGlobalSummary: Brakuje wymaganych elementów DOM');
        return;
    }

    // Aktualizuj dane dla aktywnego formularza
    if (activeQuoteForm) {
        const orderBruttoVal = parseFloat(activeQuoteForm.dataset.orderBrutto) || 0;
        const orderNettoVal = parseFloat(activeQuoteForm.dataset.orderNetto) || 0;
        const finBruttoVal = parseFloat(activeQuoteForm.dataset.finishingBrutto) || 0;
        const finNettoVal = parseFloat(activeQuoteForm.dataset.finishingNetto) || 0;

        orderSummaryEls.brutto.textContent = orderBruttoVal ? formatPLN(orderBruttoVal) : "0.00 PLN";
        orderSummaryEls.netto.textContent = orderNettoVal ? formatPLN(orderNettoVal) : "0.00 PLN";
        finishingSummaryEls.brutto.textContent = finBruttoVal ? formatPLN(finBruttoVal) : "0.00 PLN";
        finishingSummaryEls.netto.textContent = finNettoVal ? formatPLN(finNettoVal) : "0.00 PLN";
    } else {
        orderSummaryEls.brutto.textContent = "0.00 PLN";
        orderSummaryEls.netto.textContent = "0.00 PLN";
        finishingSummaryEls.brutto.textContent = "0.00 PLN";
        finishingSummaryEls.netto.textContent = "0.00 PLN";
    }

    // Oblicz sumę globalną
    let sumOrderBrutto = 0, sumOrderNetto = 0, sumFinishingBrutto = 0, sumFinishingNetto = 0;

    quoteFormsContainer.querySelectorAll('.quote-form').forEach(form => {
        sumOrderBrutto += parseFloat(form.dataset.orderBrutto) || 0;
        sumOrderNetto += parseFloat(form.dataset.orderNetto) || 0;
        sumFinishingBrutto += parseFloat(form.dataset.finishingBrutto) || 0;
        sumFinishingNetto += parseFloat(form.dataset.finishingNetto) || 0;
    });

    // Odczytaj koszt kuriera (jeśli elementy istnieją)
    const deliveryBruttoText = deliverySummaryEls.brutto ? deliverySummaryEls.brutto.textContent : '';
    const deliveryNettoText = deliverySummaryEls.netto ? deliverySummaryEls.netto.textContent : '';
    const deliveryBruttoVal = deliveryBruttoText.endsWith('PLN') ?
        parseFloat(deliveryBruttoText.replace(" PLN", "")) || 0 : 0;
    const deliveryNettoVal = deliveryNettoText.endsWith('PLN') ?
        parseFloat(deliveryNettoText.replace(" PLN", "")) || 0 : 0;

    // Oblicz sumy finalne
    const totalBrutto = sumOrderBrutto + sumFinishingBrutto + deliveryBruttoVal;
    const totalNetto = sumOrderNetto + sumFinishingNetto + deliveryNettoVal;

    finalSummaryEls.brutto.textContent = totalBrutto > 0 ? formatPLN(totalBrutto) : "0.00 PLN";
    finalSummaryEls.netto.textContent = totalNetto > 0 ? formatPLN(totalNetto) : "0.00 PLN";

    updateCalculateDeliveryButtonState();
    generateProductsSummary();
}

// ============================================
// AKTUALIZACJA CEN
// ============================================

function updatePrices() {
    dbg("updatePrices: start");

    if (!activeQuoteForm) {
        console.warn("updatePrices: Brak aktywnego formularza");
        return;
    }

    const elements = {
        length: activeQuoteForm.querySelector('input[data-field="length"]'),
        width: activeQuoteForm.querySelector('input[data-field="width"]'),
        thickness: activeQuoteForm.querySelector('input[data-field="thickness"]'),
        quantity: activeQuoteForm.querySelector('input[data-field="quantity"]'),
        clientType: activeQuoteForm.querySelector('select[data-field="clientType"]'),
        variants: activeQuoteForm.querySelector('.variants')
    };

    if (!Object.values(elements).every(el => el)) {
        console.warn("updatePrices: Brak wymaganych elementów w formularzu");
        return;
    }

    // Pobierz i waliduj wartości
    const values = {
        length: parseFloat(elements.length.value),
        width: parseFloat(elements.width.value),
        thickness: parseFloat(elements.thickness.value),
        quantity: Math.max(parseInt(elements.quantity.value) || 1, 1),
        clientType: elements.clientType.value
    };

    // Walidacja i error handling
    const validation = validateInputs(elements, values);
    if (!validation.isValid) {
        showErrorForAllVariants(validation.errorMsg, elements.variants);
        clearFormData(activeQuoteForm);
        updateGlobalSummary();
        return;
    }

    // Oblicz ceny dla wariantów
    calculateVariantPrices(elements.variants, values);

    // Aktualizuj wykończenie i podsumowania
    calculateFinishingCost(activeQuoteForm);
    updateGlobalSummary();

    // Przelicz inne produkty jeśli fokus na wymiarach
    if (['length', 'width', 'thickness', 'quantity'].some(field =>
        elements[field].matches(':focus'))) {
        updatePricesInOtherProducts();
    }

    dbg("← updatePrices end");
}

function validateInputs(elements, values) {
    const { length, width, thickness, quantity, clientType } = values;

    // Walidacja quantity
    if (elements.quantity.value !== quantity.toString()) {
        elements.quantity.value = quantity;
    }

    // Walidacja grupy cenowej
    if (elements.clientType) {
        elements.clientType.classList.toggle('error-outline', !clientType);
    }

    if (!isPartner && !clientType) {
        return { isValid: false, errorMsg: "Brak grupy" };
    }

    // Walidacja wymiarów
    const dimensionFields = [
        { element: elements.length, value: length, name: "dług." },
        { element: elements.width, value: width, name: "szer." },
        { element: elements.thickness, value: thickness, name: "grub." },
        { element: elements.quantity, value: quantity, name: "il." }
    ];

    for (const field of dimensionFields) {
        const isValid = !isNaN(field.value) && field.value > 0;
        field.element.classList.toggle('error-outline', !isValid);

        if (!isValid) {
            return { isValid: false, errorMsg: `Brak ${field.name}` };
        }
    }

    return { isValid: true };
}

function calculateVariantPrices(variantContainer, values) {
    const { length, width, thickness, quantity, clientType } = values;
    const singleVolume = calculateSingleVolume(length, width, Math.ceil(thickness));
    const multiplier = isPartner ? userMultiplier : (multiplierMapping[clientType] || 1.0);

    const variantItems = Array.from(variantContainer.children)
        .filter(child => child.querySelector('input[type="radio"]'));

    // Reset kolorów wariantów
    variantItems.forEach(variant => {
        variant.querySelectorAll('*').forEach(el => el.style.color = "");
    });

    // Oblicz ceny dla wszystkich wariantów
    variantItems.forEach(variant => {
        const radio = variant.querySelector('input[type="radio"]');
        if (!radio) return;

        const config = variantMapping[radio.value];
        if (!config) return;

        const match = getPrice(config.species, config.technology, config.wood_class, thickness, length);
        const spans = {
            unitBrutto: variant.querySelector('.unit-brutto'),
            unitNetto: variant.querySelector('.unit-netto'),
            totalBrutto: variant.querySelector('.total-brutto'),
            totalNetto: variant.querySelector('.total-netto')
        };

        if (match && Object.values(spans).every(span => span)) {
            const basePrice = match.price_per_m3;
            const unitNetto = singleVolume * basePrice * multiplier;
            const unitBrutto = unitNetto * VAT_RATE;
            const totalNetto = unitNetto * quantity;
            const totalBrutto = unitBrutto * quantity;

            // Ustaw dataset dla radio button
            Object.assign(radio.dataset, {
                totalNetto, totalBrutto, volumeM3: singleVolume,
                pricePerM3: basePrice, multiplier, finalPrice: unitNetto
            });

            // Aktualizuj teksty
            spans.unitBrutto.textContent = formatPLN(unitBrutto);
            spans.unitNetto.textContent = formatPLN(unitNetto);
            spans.totalBrutto.textContent = formatPLN(totalBrutto);
            spans.totalNetto.textContent = formatPLN(totalNetto);

            variant.style.backgroundColor = "";
        } else {
            // Brak ceny
            Object.values(spans).forEach(span => {
                if (span) span.textContent = 'Brak ceny';
            });
        }
    });

    // Obsłuż zaznaczony wariant
    const selectedRadio = activeQuoteForm.querySelector('input[type="radio"]:checked');
    if (selectedRadio && selectedRadio.dataset.totalBrutto && selectedRadio.dataset.totalNetto) {
        activeQuoteForm.dataset.orderBrutto = selectedRadio.dataset.totalBrutto;
        activeQuoteForm.dataset.orderNetto = selectedRadio.dataset.totalNetto;

        // Pokoloruj wybrany wariant
        const selectedVariant = selectedRadio.closest('div');
        if (selectedVariant) {
            selectedVariant.querySelectorAll('*').forEach(el => el.style.color = "#ED6B24");
        }
    } else {
        clearFormData(activeQuoteForm);
    }
}

function showErrorForAllVariants(errorMsg, variantContainer) {
    const variantItems = Array.from(variantContainer.children)
        .filter(child => child.querySelector('input[type="radio"]'));

    variantItems.forEach(variant => {
        ['.unit-brutto', '.unit-netto', '.total-brutto', '.total-netto'].forEach(sel => {
            const span = variant.querySelector(sel);
            if (span) span.textContent = errorMsg;
        });
    });
}

function clearFormData(form) {
    form.dataset.orderBrutto = "";
    form.dataset.orderNetto = "";
}

function updatePricesInOtherProducts() {
    if (!quoteFormsContainer) return;

    const allForms = quoteFormsContainer.querySelectorAll('.quote-form');
    const originalActiveForm = activeQuoteForm;

    allForms.forEach(form => {
        if (form === originalActiveForm) return;

        // Sprawdź czy produkt ma wypełnione wymiary
        const hasDimensions = ['length', 'width', 'thickness'].every(field =>
            form.querySelector(`[data-field="${field}"]`)?.value
        );

        if (hasDimensions) {
            activeQuoteForm = form;
            updatePrices();
        }
    });

    activeQuoteForm = originalActiveForm;
    console.log('✅ Przeliczono ceny we wszystkich produktach');
}

// ============================================
// KALKULACJA WYKOŃCZEŃ
// ============================================

function calculateFinishingCost(form) {
    if (!form || !form.closest('.quote-form')) return { netto: null, brutto: null };

    const finishingTypeBtn = form.querySelector('.finishing-btn[data-finishing-type].active');
    const finishingVariantBtn = form.querySelector('.finishing-btn[data-finishing-variant].active');

    const finishingType = finishingTypeBtn?.dataset.finishingType || 'Surowe';
    const finishingVariant = finishingVariantBtn?.dataset.finishingVariant || 'Surowe';

    // Znajdź elementy wykończenia
    const finishingElements = {
        brutto: form.querySelector('.finishing-brutto') || document.getElementById('finishing-brutto'),
        netto: form.querySelector('.finishing-netto') || document.getElementById('finishing-netto')
    };

    if (finishingType === 'Surowe') {
        form.dataset.finishingBrutto = 0;
        form.dataset.finishingNetto = 0;
        if (finishingElements.brutto) finishingElements.brutto.textContent = '0.00 PLN';
        if (finishingElements.netto) finishingElements.netto.textContent = '0.00 PLN';
        updateGlobalSummary();
        return { netto: 0, brutto: 0 };
    }

    // Pobierz wymiary
    const dimensions = {
        length: parseFloat(form.querySelector('input[data-field="length"]')?.value),
        width: parseFloat(form.querySelector('input[data-field="width"]')?.value),
        thickness: parseFloat(form.querySelector('input[data-field="thickness"]')?.value),
        quantity: parseInt(form.querySelector('input[data-field="quantity"]')?.value) || 1
    };

    if (Object.values(dimensions).some(val => !val || isNaN(val))) {
        return { netto: null, brutto: null };
    }

    // Oblicz powierzchnię w mm²
    const lengthMm = dimensions.length * 10;
    const widthMm = dimensions.width * 10;
    const thicknessMm = dimensions.thickness * 10;

    const area_mm2 = 2 * (lengthMm * widthMm + lengthMm * thicknessMm + widthMm * thicknessMm);
    const area_m2 = area_mm2 / 1_000_000;
    const total_area = area_m2 * dimensions.quantity;

    // Określ cenę za m²
    let pricePerM2 = 0;
    if (finishingType === 'Lakierowanie' && finishingVariant === 'Bezbarwne') {
        pricePerM2 = window.finishingPrices?.['Lakierowane bezbarwne'] || 200;
    } else if (finishingType === 'Lakierowanie' && finishingVariant === 'Barwne') {
        pricePerM2 = window.finishingPrices?.['Lakierowane barwne'] || 250;
    } else if (finishingType === 'Olejowanie') {
        pricePerM2 = window.finishingPrices?.['Olejowanie'] || 250;
    }

    const finishingPriceNetto = +(total_area * pricePerM2).toFixed(2);
    const finishingPriceBrutto = +(finishingPriceNetto * VAT_RATE).toFixed(2);

    // Zapisz wyniki
    form.dataset.finishingBrutto = finishingPriceBrutto;
    form.dataset.finishingNetto = finishingPriceNetto;

    if (finishingElements.brutto) finishingElements.brutto.textContent = formatPLN(finishingPriceBrutto);
    if (finishingElements.netto) finishingElements.netto.textContent = formatPLN(finishingPriceNetto);

    updateGlobalSummary();
    generateProductsSummary();

    return { netto: finishingPriceNetto, brutto: finishingPriceBrutto };
}

// ============================================
// ZARZĄDZANIE FORMULARZAMI I EVENT LISTENERAMI
// ============================================

function attachFormListeners(form) {
    if (!form || form.dataset.listenersAttached === "true") return;

    console.log(`[attachFormListeners] Dodaję listenery dla formularza`);

    // Dodaj listenery dla inputów i selectów
    form.querySelectorAll('input[data-field], select[data-field]').forEach(input => {
        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);

        const eventType = newInput.matches('select') ? 'change' : 'input';
        newInput.addEventListener(eventType, updatePrices);
    });

    // Dodaj listenery dla radio buttons
    form.querySelectorAll('input[type="radio"]').forEach(radio => {
        const newRadio = radio.cloneNode(true);
        radio.parentNode.replaceChild(newRadio, radio);
        newRadio.addEventListener('change', updatePrices);
    });

    // Dodaj listenery dla przycisków wykończenia
    form.querySelectorAll('.finishing-btn, .color-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', function () {
            const parentForm = this.closest('.quote-form');
            if (!parentForm) return;

            // Usuń active z innych przycisków tego samego typu
            const selector = this.dataset.finishingType ?
                `[data-finishing-type="${this.dataset.finishingType}"]` :
                this.dataset.finishingVariant ? '[data-finishing-variant]' :
                    this.dataset.finishingGloss ? '[data-finishing-gloss]' :
                        '.color-btn';

            parentForm.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            updatePrices();
            generateProductsSummary();
        });
    });

    form.dataset.listenersAttached = "true";
    attachFinishingUIListeners(form);
}

function attachFinishingUIListeners(form) {
    if (!form) return;

    const formIndex = Array.from(quoteFormsContainer.children).indexOf(form);
    const wrappers = {
        variant: form.querySelector(`#finishing-variant-wrapper-${formIndex}`) ||
            form.querySelector('#finishing-variant-wrapper'),
        gloss: form.querySelector(`#finishing-gloss-wrapper-${formIndex}`) ||
            form.querySelector('#finishing-gloss-wrapper'),
        color: form.querySelector(`#finishing-color-wrapper-${formIndex}`) ||
            form.querySelector('#finishing-color-wrapper')
    };

    const show = el => { if (el) el.style.display = 'flex'; };
    const hide = el => { if (el) el.style.display = 'none'; };

    function updateVisibility() {
        const currentType = form.querySelector('.finishing-btn[data-finishing-type].active')?.dataset.finishingType || 'Surowe';
        const currentVariant = form.querySelector('.finishing-btn[data-finishing-variant].active')?.dataset.finishingVariant || 'Surowe';

        if (currentType === 'Surowe' || currentType === 'Olejowanie') {
            hide(wrappers.variant);
            hide(wrappers.color);
            return;
        }

        if (currentType === 'Lakierowanie') {
            show(wrappers.variant);
            if (currentVariant === 'Barwne') {
                show(wrappers.color);
            } else {
                hide(wrappers.color);
            }
        }
    }

    // Dodaj event listenery dla przycisków wykończenia
    ['finishing-type', 'finishing-variant', 'finishing-gloss'].forEach(type => {
        form.querySelectorAll(`.finishing-btn[data-${type}]`).forEach(btn => {
            btn.removeEventListener('click', btn._formSpecificHandler);
            btn._formSpecificHandler = () => {
                form.querySelectorAll(`.finishing-btn[data-${type}]`).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                updateVisibility();
                calculateFinishingCost(form);
                generateProductsSummary();
            };
            btn.addEventListener('click', btn._formSpecificHandler);
        });
    });

    form.querySelectorAll('.color-btn[data-finishing-color]').forEach(btn => {
        btn.removeEventListener('click', btn._formSpecificHandler);
        btn._formSpecificHandler = () => {
            form.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            generateProductsSummary();
        };
        btn.addEventListener('click', btn._formSpecificHandler);
    });

    updateVisibility();
}

// ============================================
// ZARZĄDZANIE PRODUKTAMI
// ============================================

function checkProductCompleteness(form) {
    if (!form) return false;

    const requiredFields = ['length', 'width', 'thickness', 'quantity'];
    const hasAllFields = requiredFields.every(field =>
        form.querySelector(`[data-field="${field}"]`)?.value
    );

    const hasVariant = form.querySelector('input[type="radio"]:checked');

    return hasAllFields && hasVariant;
}

function areAllProductsComplete() {
    const allForms = quoteFormsContainer.querySelectorAll('.quote-form');

    for (let form of allForms) {
        if (!checkProductCompleteness(form)) {
            return false;
        }
    }

    return allForms.length > 0;
}

function updateCalculateDeliveryButtonState() {
    const allComplete = areAllProductsComplete();

    ['.calculate-delivery', '.save-quote'].forEach(selector => {
        const btn = document.querySelector(selector);
        if (btn) {
            btn.classList.toggle('btn-disabled', !allComplete);
            btn.disabled = !allComplete;
        }
    });
}

// ============================================
// SYNCHRONIZACJA GRUP CENOWYCH
// ============================================

function syncClientTypeAcrossProducts(selectedType, sourceForm) {
    console.log(`[syncClientType] Synchronizuję grupę ${selectedType} na wszystkich produktach`);

    currentClientType = selectedType;
    currentMultiplier = multiplierMapping[selectedType] || 1.0;

    // Zachowaj stany zaznaczonych wariantów
    const allForms = quoteFormsContainer.querySelectorAll('.quote-form');
    const preservedStates = Array.from(allForms).map((form, index) => {
        const checkedRadios = Array.from(form.querySelectorAll('.variants input[type="radio"]:checked'))
            .map(radio => ({
                value: radio.value,
                totalBrutto: radio.dataset.totalBrutto,
                totalNetto: radio.dataset.totalNetto
            }));

        return { form, index, checkedRadios };
    });

    // Aktualizuj selecty w innych formularzach
    allForms.forEach(form => {
        if (form === sourceForm) return;

        const select = form.querySelector('select[data-field="clientType"]');
        if (select && select.value !== selectedType) {
            select.value = selectedType;
        }
    });

    // Przelicz ceny
    const originalActiveForm = activeQuoteForm;
    allForms.forEach(form => {
        activeQuoteForm = form;
        updatePrices();
    });
    activeQuoteForm = originalActiveForm;

    // Przywróć zaznaczenia
    preservedStates.forEach(state => {
        state.checkedRadios.forEach(radioData => {
            const radio = state.form.querySelector(`input[value="${radioData.value}"]`);
            if (radio) {
                radio.checked = true;
                radio.name = `variant-product-${state.index}-selected`;

                if (radio.dataset.totalBrutto && radio.dataset.totalNetto) {
                    state.form.dataset.orderBrutto = radio.dataset.totalBrutto;
                    state.form.dataset.orderNetto = radio.dataset.totalNetto;
                }

                const selectedVariant = radio.closest('div');
                if (selectedVariant) {
                    selectedVariant.querySelectorAll('*').forEach(el => el.style.color = "#ED6B24");
                }
            }
        });
    });

    console.log('✅ Zsynchronizowano grupę cenową z zachowaniem selekcji');
}

// ============================================
// ZARZĄDZANIE DOSTĘPNOŚCI WARIANTÓW
// ============================================

function initializeVariantAvailability() {
    console.log("[initializeVariantAvailability] Inicjalizuję dostępność wariantów...");

    document.querySelectorAll('.quote-form').forEach((form, formIndex) => {
        Object.entries(defaultVariantAvailability).forEach(([variantCode, isAvailable]) => {
            const checkbox = form.querySelector(`[data-variant="${variantCode}"]`);
            if (checkbox) {
                checkbox.checked = isAvailable;
                updateVariantAvailability(form, variantCode, isAvailable);
            }
        });

        attachVariantAvailabilityListeners(form);
    });
}

function attachVariantAvailabilityListeners(form) {
    form.querySelectorAll('.variant-availability-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const variantCode = e.target.dataset.variant;
            const isAvailable = e.target.checked;

            if (!isAvailable && !checkAtLeastOneAvailable(form, variantCode)) {
                e.preventDefault();
                e.target.checked = true;
                alert('Przynajmniej jeden wariant musi być dostępny!');
                return;
            }

            updateVariantAvailability(form, variantCode, isAvailable);

            if (!isAvailable) {
                const radio = form.querySelector(`input[type="radio"][value="${variantCode}"]`);
                if (radio && radio.checked) {
                    radio.checked = false;
                    clearFormData(form);
                    updateGlobalSummary();
                    generateProductsSummary();
                }
            }
        });
    });
}

function updateVariantAvailability(form, variantCode, isAvailable) {
    const variantElement = form.querySelector(`[data-variant="${variantCode}"]`).closest('.variant-option');
    const radio = form.querySelector(`input[type="radio"][value="${variantCode}"]`);

    if (isAvailable) {
        variantElement.classList.remove('unavailable');
        radio.disabled = false;
        radio.style.pointerEvents = 'auto';
    } else {
        variantElement.classList.add('unavailable');
        radio.disabled = true;
        radio.style.pointerEvents = 'none';
        if (radio.checked) radio.checked = false;
    }
}

function checkAtLeastOneAvailable(form, excludeVariant = null) {
    const checkboxes = form.querySelectorAll('.variant-availability-checkbox');
    return Array.from(checkboxes).some(checkbox =>
        checkbox.dataset.variant !== excludeVariant && checkbox.checked
    );
}

// ============================================
// GENEROWANIE I ZARZĄDZANIE PANELEM PRODUKTÓW
// ============================================

function generateProductDescription(form, index) {
    if (!form) return { main: `Błąd formularza`, sub: "" };

    const isComplete = checkProductCompleteness(form);
    if (!isComplete) {
        return { main: `Dokończ wycenę produktu`, sub: "" };
    }

    // Pobierz podstawowe dane
    const data = {
        length: form.querySelector('[data-field="length"]')?.value,
        width: form.querySelector('[data-field="width"]')?.value,
        thickness: form.querySelector('[data-field="thickness"]')?.value,
        quantity: form.querySelector('[data-field="quantity"]')?.value
    };

    // Pobierz nazwę wariantu
    const variantRadio = form.querySelector('input[type="radio"]:checked');
    const variantLabel = variantRadio ? form.querySelector(`label[for="${variantRadio.id}"]`) : null;
    const variantName = variantLabel ?
        variantLabel.textContent.replace(/BRAK/g, '').trim() :
        'Nieznany wariant';

    // Pobierz opis wykończenia
    const finishingDescription = getFinishingDescriptionWithGloss(form);

    // Utwórz główny opis
    let mainDescription = `${variantName} ${data.length}×${data.width}×${data.thickness} cm | ${data.quantity} szt.`;
    if (finishingDescription) {
        mainDescription += ` | ${finishingDescription}`;
    }

    // Oblicz objętość i wagę
    const volume = calculateProductVolume(form);
    const weight = calculateProductWeight(form);
    const subDescription = volume > 0 ? `${formatVolume(volume)} | ${formatWeight(weight)}` : "";

    return { main: mainDescription, sub: subDescription };
}

function getFinishingDescriptionWithGloss(form) {
    if (!form) return null;

    const finishingTypeBtn = form.querySelector('.finishing-btn[data-finishing-type].active');
    const finishingVariantBtn = form.querySelector('.finishing-btn[data-finishing-variant].active');

    if (!finishingTypeBtn || finishingTypeBtn.dataset.finishingType === 'Surowe') {
        return null;
    }

    let description = finishingTypeBtn.dataset.finishingType;

    if (finishingVariantBtn) {
        description += ` ${finishingVariantBtn.dataset.finishingVariant}`;

        if (finishingVariantBtn.dataset.finishingVariant === 'Barwne') {
            const colorBtn = form.querySelector('.color-btn.active');
            if (colorBtn) {
                description += ` (${colorBtn.dataset.finishingColor})`;
            }
        }
    }

    if (finishingTypeBtn.dataset.finishingType === 'Lakierowanie') {
        const glossBtn = form.querySelector('.finishing-btn[data-finishing-gloss].active');
        if (glossBtn) {
            description += ` ${glossBtn.dataset.finishingGloss}`;
        }
    }

    return description;
}

function calculateProductVolume(form) {
    const length = parseFloat(form.querySelector('[data-field="length"]')?.value) || 0;
    const width = parseFloat(form.querySelector('[data-field="width"]')?.value) || 0;
    const thickness = parseFloat(form.querySelector('[data-field="thickness"]')?.value) || 0;
    const quantity = parseInt(form.querySelector('[data-field="quantity"]')?.value) || 1;

    if (length <= 0 || width <= 0 || thickness <= 0) return 0;

    return calculateSingleVolume(length, width, thickness) * quantity;
}

function calculateProductWeight(form) {
    return calculateProductVolume(form) * WOOD_DENSITY;
}

function formatVolume(volume) {
    return volume === 0 ? "0.000 m³" : `${volume.toFixed(3)} m³`;
}

function formatWeight(weight) {
    if (weight === 0) return "0.0 kg";
    return weight >= 1000 ? `${(weight / 1000).toFixed(2)} t` : `${weight.toFixed(1)} kg`;
}

function calculateTotalVolumeAndWeight() {
    const forms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));
    let totalVolume = 0, totalWeight = 0;

    forms.forEach(form => {
        if (checkProductCompleteness(form)) {
            totalVolume += calculateProductVolume(form);
            totalWeight += calculateProductWeight(form);
        }
    });

    return { totalVolume, totalWeight };
}

function generateProductsSummary() {
    if (!productSummaryContainer) return;

    const forms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));
    productSummaryContainer.innerHTML = '';

    const summaryMainContainer = productSummaryContainer.parentElement ||
        document.querySelector('.products-summary-main');

    // Usuń istniejące podsumowanie
    if (summaryMainContainer) {
        const existingSummary = summaryMainContainer.querySelector('.products-total-summary');
        if (existingSummary) existingSummary.remove();
    }

    if (forms.length === 0) {
        productSummaryContainer.innerHTML = '<div class="no-products">Brak produktów</div>';
        return;
    }

    // Generuj karty produktów
    forms.forEach((form, index) => {
        const descriptionData = generateProductDescription(form, index);
        const isComplete = checkProductCompleteness(form);
        const isActive = form === activeQuoteForm;

        const productCard = document.createElement('div');
        productCard.className = `product-card ${isActive ? 'active' : ''} ${!isComplete ? 'error' : ''}`;
        productCard.dataset.index = index;

        const removeButton = forms.length > 1 ? `
            <button class="remove-product-btn" data-index="${index}" title="Usuń produkt">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        ` : '';

        productCard.innerHTML = `
            <div class="product-card-content">
                <div class="product-card-number">${index + 1}</div>
                <div class="product-card-details">
                    <div class="product-card-main-info">${descriptionData.main}</div>
                    ${descriptionData.sub ? `<div class="product-card-sub-info">${descriptionData.sub}</div>` : ''}
                </div>
                <button class="duplicate-product-btn" data-index="${index}" title="Duplikuj produkt">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>
            </div>
            ${removeButton}
        `;

        productCard.addEventListener('click', (e) => {
            if (!e.target.closest('.remove-product-btn, .duplicate-product-btn')) {
                activateProductCard(index);
            }
        });

        productSummaryContainer.appendChild(productCard);
    });

    // Dodaj podsumowanie objętości i wagi
    const { totalVolume, totalWeight } = calculateTotalVolumeAndWeight();
    if (forms.length > 0 && (totalVolume > 0 || totalWeight > 0) && summaryMainContainer) {
        const summaryCard = document.createElement('div');
        summaryCard.className = 'products-total-summary';
        summaryCard.innerHTML = `
            <div class="products-total-title">Łączne podsumowanie:</div>
            <div class="products-total-details">
                <span class="products-total-volume">${formatVolume(totalVolume)}</span>
                <span class="products-total-weight">${formatWeight(totalWeight)}</span>
            </div>
        `;
        summaryMainContainer.appendChild(summaryCard);
    }

    attachProductCardListeners();
    updateCalculateDeliveryButtonState();
}

function attachProductCardListeners() {
    if (productSummaryContainer._listenersAttached) return;

    productSummaryContainer.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-product-btn');
        if (removeBtn) {
            e.stopPropagation();
            removeProduct(parseInt(removeBtn.dataset.index));
            return;
        }

        const duplicateBtn = e.target.closest('.duplicate-product-btn');
        if (duplicateBtn) {
            e.stopPropagation();
            duplicateProduct(parseInt(duplicateBtn.dataset.index));
            return;
        }
    });

    productSummaryContainer._listenersAttached = true;
}

// ============================================
// OPERACJE NA PRODUKTACH (DODAJ/USUŃ/DUPLIKUJ)
// ============================================

function activateProductCard(index) {
    console.log(`[activateProductCard] Aktywuję produkt ${index + 1}`);

    const forms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));

    if (index < 0 || index >= forms.length) {
        console.error(`[activateProductCard] Nieprawidłowy index: ${index}`);
        return;
    }

    // Zapisz stan zaznaczonych wariantów
    const selectedVariants = {};
    forms.forEach((form, formIndex) => {
        const selectedRadio = form.querySelector('input[type="radio"]:checked');
        if (selectedRadio) {
            selectedVariants[formIndex] = {
                id: selectedRadio.id,
                value: selectedRadio.value
            };
        }
    });

    // Ukryj wszystkie formularze i pokaż wybrany
    forms.forEach((form, i) => {
        form.style.display = (i === index) ? 'flex' : 'none';
    });

    activeQuoteForm = forms[index];

    if (activeQuoteForm) {
        attachFormListeners(activeQuoteForm);

        if (checkFormHasValidDimensions(activeQuoteForm)) {
            updatePrices();
        }
    }

    // Przywróć zaznaczenia
    Object.entries(selectedVariants).forEach(([formIndex, variant]) => {
        const form = forms[parseInt(formIndex)];
        if (form) {
            const radio = form.querySelector(`#${variant.id}`);
            if (radio && !radio.checked) {
                radio.checked = true;

                const selectedVariant = radio.closest('div');
                if (selectedVariant) {
                    selectedVariant.querySelectorAll('*').forEach(el => el.style.color = "#ED6B24");
                }

                if (radio.dataset.totalBrutto && radio.dataset.totalNetto) {
                    form.dataset.orderBrutto = radio.dataset.totalBrutto;
                    form.dataset.orderNetto = radio.dataset.totalNetto;
                }
            }
        }
    });

    generateProductsSummary();
}

function checkFormHasValidDimensions(form) {
    if (!form) return false;

    const dimensions = ['length', 'width', 'thickness'].map(field =>
        parseFloat(form.querySelector(`[data-field="${field}"]`)?.value || 0)
    );

    const clientType = form.querySelector('[data-field="clientType"]')?.value;
    const hasValidDimensions = dimensions.every(dim => !isNaN(dim) && dim > 0);
    const hasClientType = isPartner || clientType;

    return hasValidDimensions && hasClientType;
}

function addNewProduct() {
    console.log("[addNewProduct] Rozpoczynam dodawanie nowego produktu...");

    const firstForm = quoteFormsContainer.querySelector('.quote-form');
    if (!firstForm) {
        console.error("[addNewProduct] Nie znaleziono pierwszego formularza!");
        return;
    }

    // Zapisz stan zaznaczonych wariantów
    const allForms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));
    const selectedStates = allForms.map((form, index) => {
        const selectedRadio = form.querySelector('input[type="radio"]:checked');
        return {
            formIndex: index,
            selectedVariant: selectedRadio ? {
                id: selectedRadio.id,
                value: selectedRadio.value,
                orderBrutto: form.dataset.orderBrutto,
                orderNetto: form.dataset.orderNetto
            } : null
        };
    });

    const currentClientType = firstForm?.querySelector('select[data-field="clientType"]')?.value;
    const newIndex = allForms.length;

    // Sklonuj i przygotuj nowy formularz
    const newForm = firstForm.cloneNode(true);
    newForm.style.display = 'none';
    quoteFormsContainer.appendChild(newForm);

    prepareNewProductForm(newForm, newIndex);

    // Przywróć grupę cenową
    if (currentClientType) {
        const select = newForm.querySelector('select[data-field="clientType"]');
        if (select) select.value = currentClientType;
    }

    attachFormListeners(newForm);

    // Przywróć zaznaczenia w starych formularzach
    selectedStates.forEach(state => {
        if (state.selectedVariant) {
            const form = allForms[state.formIndex];
            if (form) {
                const radioToCheck = form.querySelector(`input[type="radio"][value="${state.selectedVariant.value}"]`);
                if (radioToCheck && !radioToCheck.checked) {
                    radioToCheck.checked = true;
                    form.dataset.orderBrutto = state.selectedVariant.orderBrutto || '';
                    form.dataset.orderNetto = state.selectedVariant.orderNetto || '';
                }
            }
        }
    });

    activateProductCard(newIndex);

    setTimeout(() => {
        updateGlobalSummary();
        generateProductsSummary();
        scrollToLatestProduct();
    }, 100);

    console.log(`[addNewProduct] ✅ Pomyślnie dodano produkt ${newIndex + 1}`);
}

function scrollToLatestProduct() {
    const container = document.getElementById('products-summary-container');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function removeProduct(index) {
    const forms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));

    if (forms.length <= 1) {
        console.log("Nie można usunąć ostatniego produktu");
        return;
    }

    const formToRemove = forms[index];
    if (!formToRemove) return;

    formToRemove.remove();

    const remainingForms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));
    if (remainingForms.length > 0) {
        const newIndex = index > 0 ? index - 1 : 0;
        activateProductCard(Math.min(newIndex, remainingForms.length - 1));
    }

    generateProductsSummary();
    updateGlobalSummary();
}

function duplicateProduct(sourceIndex) {
    console.log(`[duplicateProduct] Rozpoczynam duplikowanie produktu ${sourceIndex + 1}...`);

    const forms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));
    const sourceForm = forms[sourceIndex];

    if (!sourceForm) {
        console.error(`[duplicateProduct] Nie znaleziono formularza o indeksie ${sourceIndex}`);
        return;
    }

    // Pobierz dane z formularza źródłowego
    const sourceData = {
        length: sourceForm.querySelector('[data-field="length"]')?.value || '',
        width: sourceForm.querySelector('[data-field="width"]')?.value || '',
        thickness: sourceForm.querySelector('[data-field="thickness"]')?.value || '',
        quantity: sourceForm.querySelector('[data-field="quantity"]')?.value || '',
        clientType: sourceForm.querySelector('[data-field="clientType"]')?.value || '',
        selectedVariant: null,
        finishingType: sourceForm.querySelector('.finishing-btn[data-finishing-type].active')?.dataset.finishingType,
        finishingColor: sourceForm.querySelector('.color-btn.active')?.dataset.finishingColor,
        finishingGloss: sourceForm.querySelector('.finishing-btn[data-finishing-gloss].active')?.dataset.finishingGloss
    };

    const sourceSelectedRadio = sourceForm.querySelector('input[type="radio"]:checked');
    if (sourceSelectedRadio) {
        sourceData.selectedVariant = {
            value: sourceSelectedRadio.value,
            orderBrutto: sourceForm.dataset.orderBrutto,
            orderNetto: sourceForm.dataset.orderNetto
        };
    }

    const newIndex = forms.length;
    addNewProduct();

    // Wypełnij nowy formularz danymi
    setTimeout(() => {
        const newForms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));
        const newForm = newForms[newIndex];

        if (!newForm) return;

        // Wypełnij wymiary
        Object.entries(sourceData).forEach(([key, value]) => {
            if (['length', 'width', 'thickness', 'quantity', 'clientType'].includes(key) && value) {
                const input = newForm.querySelector(`[data-field="${key}"]`);
                if (input) input.value = value;
            }
        });

        // Aktywuj wykończenia
        if (sourceData.finishingType) {
            const finishingBtn = newForm.querySelector(`[data-finishing-type="${sourceData.finishingType}"]`);
            if (finishingBtn) {
                finishingBtn.click();

                setTimeout(() => {
                    if (sourceData.finishingColor) {
                        const colorBtn = newForm.querySelector(`[data-finishing-color="${sourceData.finishingColor}"]`);
                        if (colorBtn) colorBtn.click();
                    }

                    if (sourceData.finishingGloss) {
                        const glossBtn = newForm.querySelector(`[data-finishing-gloss="${sourceData.finishingGloss}"]`);
                        if (glossBtn) glossBtn.click();
                    }
                }, 100);
            }
        }

        // Przelicz ceny i zaznacz wariant
        if (Object.values(sourceData).slice(0, 4).every(v => v)) {
            setTimeout(() => {
                updatePrices();

                if (sourceData.selectedVariant) {
                    const radioToSelect = newForm.querySelector(`input[type="radio"][value="${sourceData.selectedVariant.value}"]`);
                    if (radioToSelect) radioToSelect.click();
                }

                updateGlobalSummary();
                generateProductsSummary();
            }, 200);
        }

        console.log(`[duplicateProduct] ✅ Pomyślnie zduplikowano produkt ${sourceIndex + 1}`);
    }, 100);
}

function prepareNewProductForm(form, index) {
    if (!form) return;

    console.log(`[prepareNewProductForm] Przygotowuję formularz dla produktu ${index + 1}`);

    const currentClientType = form.querySelector('select[data-field="clientType"]')?.value;

    // Ustaw unikalne ID i name dla radio buttons
    form.querySelectorAll('.variants input[type="radio"]').forEach((radio, radioIndex) => {
        const baseId = radio.value || `variant-${radioIndex}`;
        const newId = `${baseId}-product-${index}`;
        const newName = `variantOption-product-${index}`;
        const oldId = radio.id;

        radio.id = newId;
        radio.name = newName;
        radio.checked = false;

        const label = form.querySelector(`label[for="${oldId}"]`);
        if (label) label.setAttribute('for', newId);
    });

    // Resetuj inputy (zachowaj quantity = 1)
    form.querySelectorAll('input[data-field]').forEach(input => {
        if (input.dataset.field !== 'quantity') {
            input.value = '';
        }
    });

    // Resetuj selecty ale zachowaj grupę cenową
    form.querySelectorAll('select[data-field]').forEach(select => {
        if (select.dataset.field === 'clientType' && currentClientType) {
            select.value = currentClientType;
        } else {
            select.selectedIndex = 0;
        }
    });

    // Resetuj wykończenie
    form.querySelectorAll('.finishing-btn.active').forEach(btn => btn.classList.remove('active'));

    const defaultFinishing = form.querySelector('.finishing-btn[data-finishing-type="Surowe"]');
    if (defaultFinishing) defaultFinishing.classList.add('active');

    // Ukryj sekcje wykończenia
    ['#finishing-variant-wrapper', '#finishing-gloss-wrapper', '#finishing-color-wrapper'].forEach(selector => {
        const wrapper = form.querySelector(selector);
        if (wrapper) wrapper.style.display = 'none';
    });

    // Wyczyść dataset formularza
    Object.assign(form.dataset, {
        orderBrutto: '', orderNetto: '', finishingType: 'Surowe',
        finishingBrutto: '', finishingNetto: ''
    });

    // Resetuj wyświetlanie cen w wariantach
    form.querySelectorAll('.variants span').forEach(span => {
        const isHeader = span.classList.contains('header-title') ||
            span.classList.contains('header-unit-brutto') ||
            span.classList.contains('header-unit-netto') ||
            span.classList.contains('header-total-brutto') ||
            span.classList.contains('header-total-netto') ||
            span.classList.contains('header-availability') ||
            span.closest('.variants-header') !== null ||
            span.classList.contains('out-of-stock-tag');

        if (!isHeader) {
            span.textContent = 'Brak danych';
        }
    });

    // Resetuj kolory wariantów
    form.querySelectorAll('.variants div').forEach(variant => {
        variant.style.backgroundColor = '';
        variant.querySelectorAll('*').forEach(el => el.style.color = '');
    });

    // Ustaw dostępność wariantów
    Object.entries(defaultVariantAvailability).forEach(([variantCode, isAvailable]) => {
        const checkbox = form.querySelector(`[data-variant="${variantCode}"]`);
        if (checkbox) {
            checkbox.checked = isAvailable;
            updateVariantAvailability(form, variantCode, isAvailable);
        }
    });

    delete form.dataset.listenersAttached;

    console.log(`[prepareNewProductForm] ✅ Zakończono przygotowanie formularza dla produktu ${index + 1}`);
}

// ============================================
// FUNKCJE OBSŁUGI EDGE 3D
// ============================================

function initEdge3D() {
    const openEdgesBtn = document.getElementById('openEdgesModal');
    if (!openEdgesBtn) return;

    openEdgesBtn.addEventListener('click', () => {
        renderEdgeInputs();
        document.querySelector('.modal-3d-overlay').style.display = 'flex';
        toggleAngleColumn(false);

        const dims = {
            length: parseFloat(document.querySelector('input[data-field="length"]').value) || 0,
            width: parseFloat(document.querySelector('input[data-field="width"]').value) || 0,
            height: parseFloat(document.querySelector('input[data-field="thickness"]').value) || 0
        };

        const container = document.getElementById('edge3d-root');
        if (!edge3dRoot) {
            edge3dRoot = ReactDOM.createRoot(container);
        }
        edge3dRoot.render(React.createElement(Edge3DViewer, { dimensions: dims, edgeSettings: window.edgeSettings }));
    });
}

function toggleAngleColumn(show) {
    const table = document.getElementById('edge3d-table');
    if (!table) return;
    const headerCell = table.querySelector('.edge3d-header .edge3d-cell:nth-child(4)');
    if (headerCell) headerCell.style.visibility = show ? 'visible' : 'hidden';
}

function renderEdgeInputs() {
    const table = document.getElementById('edge3d-table');
    if (!table) return;

    const frag = document.createDocumentFragment();
    const header = document.createElement('div');
    header.className = 'edge3d-row edge3d-header';
    header.innerHTML = `
        <div class="edge3d-cell" style="width:120px;">Krawędź</div>
        <div class="edge3d-cell" style="width:172px;">Typ</div>
        <div class="edge3d-cell" style="width:140px;">Wartość [mm]</div>
        <div class="edge3d-cell" style="width:200px; visibility:hidden;">Kąt [°]</div>
    `;
    frag.appendChild(header);

    const basePath = '/calculator/static/images/edges';
    const iconMap = { frezowana: 'frezowanie.svg', fazowana: 'fazowanie.svg' };

    edgesList.forEach(key => {
        const row = document.createElement('div');
        row.className = 'edge3d-row';
        row.style.cssText = 'display: flex; gap: 12px; align-items: center; padding: 0 12px;';

        row.addEventListener('mouseenter', () => {
            row.classList.add('edge-row-hover');
            if (typeof window.highlightEdge === 'function') {
                window.highlightEdge(key, '#ED6B24', 2);
            }
        });

        row.addEventListener('mouseleave', () => {
            row.classList.remove('edge-row-hover');
            if (typeof window.resetEdge === 'function') {
                window.resetEdge(key);
            }
        });

        // Nazwa krawędzi
        const nameCell = document.createElement('div');
        nameCell.className = 'edge3d-cell';
        nameCell.style.width = '120px';
        nameCell.textContent = key;
        row.appendChild(nameCell);

        // Przyciski typu
        const typeCell = document.createElement('div');
        typeCell.className = 'edge3d-cell';
        typeCell.style.cssText = 'display: flex; gap: 8px; width: 160px;';

        Object.keys(iconMap).forEach(type => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'edge-type-btn';
            btn.dataset.edgeKey = key;
            btn.dataset.type = type;

            const img = document.createElement('img');
            img.src = `${basePath}/${iconMap[type]}`;
            img.alt = type;
            btn.appendChild(img);

            btn.addEventListener('click', onTypeButtonClick);
            typeCell.appendChild(btn);
        });
        row.appendChild(typeCell);

        // Input wartości
        const valueCell = document.createElement('div');
        valueCell.className = 'edge3d-cell';
        valueCell.style.width = '140px';

        const input = document.createElement('input');
        input.type = 'number';
        input.id = `edge-value-${key}`;
        input.className = 'input-small';
        input.style.width = '100%';
        input.min = 0;
        input.addEventListener('input', onEdgeInputChange);
        valueCell.appendChild(input);
        row.appendChild(valueCell);

        // Kąt (ukryty domyślnie)
        const angleCell = document.createElement('div');
        angleCell.className = 'edge3d-cell';
        angleCell.style.cssText = 'width: 200px; visibility: hidden; display: flex; align-items: center;';

        const range = document.createElement('input');
        range.type = 'range';
        range.id = `edge-angle-${key}`;
        range.className = 'input-range';
        range.min = 0;
        range.max = 90;
        range.step = 1;

        const angleDisplay = document.createElement('span');
        angleDisplay.id = `angle-display-${key}`;
        angleDisplay.style.cssText = 'margin-left: 8px; width: 40px;';
        angleDisplay.textContent = '45°';

        range.oninput = function () {
            angleDisplay.textContent = this.value + '°';
        };

        angleCell.appendChild(range);
        angleCell.appendChild(angleDisplay);
        row.appendChild(angleCell);

        frag.appendChild(row);
    });

    table.innerHTML = '';
    table.appendChild(frag);
}

function onEdgeInputChange(e) {
    const input = e.target;
    const row = input.closest('.edge3d-row');
    if (!row) return;

    const key = row.querySelector('.edge3d-cell').textContent.trim();

    if (typeof window.highlightEdge === 'function') {
        window.highlightEdge(key, '#ED6B24', 2);
    }

    window.edgeSettings = window.edgeSettings || {};
    window.edgeSettings[key] = window.edgeSettings[key] || {};
    window.edgeSettings[key].value = parseFloat(input.value) || 0;

    const dims = {
        length: parseFloat(document.querySelector('input[data-field="length"]').value) || 0,
        width: parseFloat(document.querySelector('input[data-field="width"]').value) || 0,
        height: parseFloat(document.querySelector('input[data-field="thickness"]').value) || 0
    };

    maybeRender3D(dims, window.edgeSettings);
}

function onTypeButtonClick(e) {
    const btn = e.currentTarget;
    const key = btn.dataset.edgeKey;
    const type = btn.dataset.type;

    window.edgeSettings = window.edgeSettings || {};
    window.edgeSettings[key] = window.edgeSettings[key] || {};

    if (window.edgeSettings[key].type === type) return;

    window.edgeSettings[key].type = type;
    toggleAngleColumn(type === 'fazowana');

    const dims = {
        length: parseFloat(document.querySelector('input[data-field="length"]').value) || 0,
        width: parseFloat(document.querySelector('input[data-field="width"]').value) || 0,
        height: parseFloat(document.querySelector('input[data-field="thickness"]').value) || 0
    };

    maybeRender3D(dims, window.edgeSettings);
}

let lastDims = { length: 0, width: 0, height: 0 };
let lastSettingsJSON = JSON.stringify({});

function maybeRender3D(dims, settings) {
    const dimsChanged = Object.keys(dims).some(key => dims[key] !== lastDims[key]);
    const settingsJSON = JSON.stringify(settings);
    const settingsChanged = settingsJSON !== lastSettingsJSON;

    if (!dimsChanged && !settingsChanged) return;

    lastDims = { ...dims };
    lastSettingsJSON = settingsJSON;

    if (edge3dRoot) {
        edge3dRoot.render(React.createElement(Edge3DViewer, { dimensions: dims, edgeSettings: settings }));
    }
}

// ============================================
// OBSŁUGA DOSTAW I MODALI
// ============================================

function updateDeliverySelection(selection) {
    console.log('Wybrano dostawę:', selection);

    if (!deliverySummaryEls.courier || !deliverySummaryEls.brutto || !deliverySummaryEls.netto) {
        console.error('Brakuje elementów deliverySummaryEls - nie można zaktualizować podsumowania dostawy');
        return;
    }

    deliverySummaryEls.courier.textContent = selection.carrierName;
    deliverySummaryEls.brutto.textContent = formatPLN(selection.grossPrice);
    deliverySummaryEls.netto.textContent = formatPLN(selection.netPrice);

    updateGlobalSummary();
}

// Simplified Delivery Modal Class
class DeliveryModal {
    constructor() {
        this.modal = document.getElementById('deliveryModal');
        this.quotes = [];
        this.selectedOption = null;
        this.VAT_RATE = 0.23;
        this.MARGIN_RATE = 0.30;

        if (this.modal) this.bindEvents();
    }

    bindEvents() {
        // Podstawowe event listenery
        const closeBtn = document.getElementById('deliveryModalClose');
        const cancelBtn = document.getElementById('deliveryModalCancel');

        closeBtn?.addEventListener('click', () => this.hide());
        cancelBtn?.addEventListener('click', () => this.hide());

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hide();
        });

        const confirmBtn = document.getElementById('deliveryModalConfirm');
        confirmBtn?.addEventListener('click', () => this.confirmSelection());
    }

    updateConfirmButton() {
        console.log(`[DeliveryModal] updateConfirmButton wywołane, selectedOption:`, this.selectedOption);

        const confirmBtn = document.getElementById('deliveryModalConfirm');
        const confirmText = document.getElementById('deliveryConfirmText');

        console.log(`[DeliveryModal] Elementy przycisku:`, {
            confirmBtn: !!confirmBtn,
            confirmText: !!confirmText
        });

        if (!confirmBtn) {
            console.warn('[DeliveryModal] Nie znaleziono przycisku deliveryModalConfirm');
            return;
        }

        const hasSelection = !!this.selectedOption;

        console.log(`[DeliveryModal] hasSelection: ${hasSelection}`);

        confirmBtn.disabled = !hasSelection;

        if (hasSelection) {
            confirmBtn.classList.remove('btn-disabled');
        } else {
            confirmBtn.classList.add('btn-disabled');
        }

        if (confirmText) {
            confirmText.textContent = hasSelection ? 'Zapisz' : 'Wybierz opcję';
        }

        console.log(`[DeliveryModal] Przycisk zaktualizowany - disabled: ${confirmBtn.disabled}, hasClass btn-disabled: ${confirmBtn.classList.contains('btn-disabled')}`);
    }

    show(quotes, packingInfo = null) {
        this.quotes = quotes || [];
        this.selectedOption = null; // Reset zaznaczenia
        this.quotes.sort((a, b) => (a.grossPrice || 0) - (b.grossPrice || 0));

        this.renderOptions();
        this.updatePackingInfo(packingInfo);
        this.updateConfirmButton(); // Aktualizuj przycisk na początku

        this.modal.style.display = 'flex';
        requestAnimationFrame(() => this.modal.classList.add('active'));
    }

    hide() {
        this.modal.classList.remove('active');
        setTimeout(() => this.modal.style.display = 'none', 300);
    }

    renderOptions() {
        const listEl = document.getElementById('deliveryOptionsList');
        if (!listEl) return;

        listEl.innerHTML = '';

        this.quotes.forEach((quote, index) => {
            const optionEl = this.createOptionElement(quote, index);
            listEl.appendChild(optionEl);
        });
    }

    createOptionElement(quote, index) {
        const div = document.createElement('div');
        div.className = 'delivery-modal-option';
        div.dataset.index = index;

        const radioId = `delivery-option-${index}`;

        div.innerHTML = `
            <input type="radio" name="deliveryOption" id="${radioId}"
                value="${quote.carrierName}" 
                data-gross="${quote.grossPrice}" 
                data-net="${quote.netPrice}"
                data-raw-gross="${quote.rawGrossPrice || quote.grossPrice}"
                data-raw-net="${quote.rawNetPrice || quote.netPrice}">
            
            <div class="delivery-modal-name-container">
                <img src="${quote.carrierLogoLink || '/static/images/default-carrier.png'}" 
                    class="delivery-modal-logo" alt="${quote.carrierName} logo"
                    onerror="this.src='/static/images/default-carrier.png'">
                <div class="delivery-modal-name">${quote.carrierName}</div>
            </div>
            
            <div class="delivery-modal-price">
                <div class="delivery-modal-price-brutto">${(quote.grossPrice || 0).toFixed(2)} PLN</div>
                <div class="delivery-modal-price-netto">${(quote.netPrice || 0).toFixed(2)} PLN netto</div>
            </div>
            
            <div class="delivery-modal-price">
                <div class="delivery-modal-price-brutto">${(quote.rawGrossPrice || quote.grossPrice || 0).toFixed(2)} PLN</div>
                <div class="delivery-modal-price-netto">${(quote.rawNetPrice || quote.netPrice || 0).toFixed(2)} PLN netto</div>
            </div>
        `;

        const radio = div.querySelector('input[type="radio"]');

        // Event listener dla całego div - ZAWSZE wywołaj selectOption
        div.addEventListener('click', (e) => {
            console.log(`[DeliveryModal] Kliknięto na opcję ${index}: ${quote.carrierName}`);

            // Zaznacz radio button
            radio.checked = true;

            // Wywołaj selectOption zawsze po kliknięciu
            this.selectOption(quote, index);
        });

        // Event listener dla radio button jako backup
        radio.addEventListener('change', (e) => {
            console.log(`[DeliveryModal] Radio zmieniony ${index}: ${quote.carrierName}, checked: ${radio.checked}`);
            if (radio.checked) {
                this.selectOption(quote, index);
            }
        });

        return div;
    }

    selectOption(quote, index) {
        console.log(`[DeliveryModal] selectOption wywołane dla: ${quote.carrierName}, index: ${index}`);

        // Usuń poprzednie zaznaczenie
        document.querySelectorAll('.delivery-modal-option').forEach(el =>
            el.classList.remove('selected')
        );

        // Zaznacz nową opcję
        const optionEl = document.querySelector(`[data-index="${index}"]`);
        if (optionEl) {
            optionEl.classList.add('selected');
            console.log(`[DeliveryModal] Dodano klasę 'selected' do elementu ${index}`);
        } else {
            console.warn(`[DeliveryModal] Nie znaleziono elementu o data-index="${index}"`);
        }

        // Ustaw selectedOption
        this.selectedOption = {
            carrierName: quote.carrierName,
            grossPrice: quote.grossPrice,
            netPrice: quote.netPrice,
            rawGrossPrice: quote.rawGrossPrice || quote.grossPrice,
            rawNetPrice: quote.rawNetPrice || quote.netPrice,
            carrierLogoLink: quote.carrierLogoLink,
            type: 'api'
        };

        console.log(`[DeliveryModal] selectedOption ustawiony na:`, this.selectedOption);

        // KLUCZOWE: Wywołaj updateConfirmButton()
        this.updateConfirmButton();
    }

    updatePackingInfo(packingInfo) {
        const packingInfoEl = document.getElementById('deliveryPackingInfo');

        if (packingInfo && packingInfoEl) {
            const percent = Math.round((packingInfo.multiplier - 1) * 100);
            packingInfoEl.innerHTML = `ℹ️ ${packingInfo.message || `Do cen wysyłki została doliczona kwota ${percent}% na pakowanie.`}`;
            packingInfoEl.classList.remove('delivery-modal-hidden');
        }
    }

    confirmSelection() {
        if (!this.selectedOption) {
            alert('Proszę wybrać opcję dostawy.');
            return;
        }

        if (typeof updateDeliverySelection === 'function') {
            updateDeliverySelection(this.selectedOption);
        }

        const event = new CustomEvent('deliverySelected', { detail: this.selectedOption });
        document.dispatchEvent(event);

        this.hide();
    }
}

// Inicjalizacja delivery modal
let deliveryModalInstance = null;

function showDeliveryModal(quotes, packingInfo = null) {
    if (!deliveryModalInstance) {
        deliveryModalInstance = new DeliveryModal();
    }

    const formattedQuotes = quotes.map(quote => ({
        carrierName: quote.carrierName || 'Nieznany kurier',
        grossPrice: quote.grossPrice || 0,
        netPrice: quote.netPrice || 0,
        rawGrossPrice: quote.rawGrossPrice || quote.grossPrice || 0,
        rawNetPrice: quote.rawNetPrice || quote.netPrice || 0,
        carrierLogoLink: quote.carrierLogoLink || '/static/images/default-carrier.png'
    }));

    deliveryModalInstance.show(formattedQuotes, packingInfo);
}

function showDeliveryErrorModal(errorMessage) {
    if (!deliveryModalInstance) {
        deliveryModalInstance = new DeliveryModal();
    }

    deliveryModalInstance.show([], null);
    // Można dodać obsługę błędów jeśli potrzebna
}

// ============================================
// FUNKCJE POMOCNICZE I OSTATNIE WYCENY
// ============================================

function loadLatestQuotes() {
    const container = document.getElementById('latestQuotesList');
    if (!container) return;

    fetch('/calculator/latest_quotes')
        .then(res => res.json())
        .then(data => {
            if (!data.length) {
                container.innerHTML = '<p>Brak wycen do wyświetlenia.</p>';
                return;
            }

            const html = data.map(q => `
                <div class="quote-row">
                    <div class="quote-cell">${q.quote_number}</div>
                    <div class="quote-cell">${q.created_at}</div>
                    <div class="quote-cell">${q.client_name}</div>
                    <div class="quote-cell">${q.quote_source}</div>
                    <div class="quote-cell">
                        <span class="quote-status" style="background-color: ${q.status_color};">${q.status}</span>
                    </div>
                    <div class="quote-actions">
                        <button class="go-ahead" data-id="${q.id}">Przejdź</button>
                        <button class="quotes-btn-download" data-token="${q.public_token}">Pobierz</button>
                    </div>
                </div>
            `).join('');

            container.innerHTML = html;

            // Obsługa przycisku "Przejdź"
            container.querySelectorAll('.go-ahead').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    sessionStorage.setItem('openQuoteId', id);
                    window.location.href = `/quotes?open_quote=${id}`;
                });
            });
        })
        .catch(err => console.error("Błąd podczas ładowania wycen:", err));
}

function attachGoToQuoteListeners() {
    const latestQuotesList = document.getElementById('latestQuotesList');

    if (latestQuotesList) {
        latestQuotesList.addEventListener('click', (e) => {
            if (e.target.classList.contains('go-ahead')) {
                e.preventDefault();
                const quoteId = e.target.dataset.id;

                if (quoteId) {
                    sessionStorage.setItem('openQuoteModal', quoteId);
                    window.location.href = '/quotes/';
                }
            }
        });
    }
}

// Funkcje walidacji i pomocnicze
function attachLengthValidation() {
    const lengthInput = document.querySelector('input[data-field="length"]');
    if (!lengthInput) return;

    lengthInput.addEventListener('input', function () {
        const val = parseFloat(this.value);
        let errorSpan = this.parentNode.querySelector('.error-message-length');

        if (!errorSpan) {
            errorSpan = document.createElement('span');
            errorSpan.classList.add('error-message-length');
            errorSpan.style.cssText = 'color: red; font-size: 12px;';
            this.parentNode.appendChild(errorSpan);
        }

        errorSpan.textContent = (!isNaN(val) && val > 450) ?
            "Długość poza odpowiednim zakresem 0-450 cm." : "";
    });
}

function attachWidthValidation() {
    const widthInput = document.querySelector('input[data-field="width"]');
    if (!widthInput) return;

    widthInput.addEventListener('input', function () {
        const val = parseFloat(this.value);
        let errorSpan = this.parentNode.querySelector('.error-message-width');

        if (!errorSpan) {
            errorSpan = document.createElement('span');
            errorSpan.classList.add('error-message-width');
            errorSpan.style.cssText = 'color: red; font-size: 12px;';
            this.parentNode.appendChild(errorSpan);
        }

        errorSpan.textContent = (!isNaN(val) && val > 120) ?
            "Szerokość poza odpowiednim zakresem 0-120 cm." : "";
    });
}

function attachCalculateDeliveryListener() {
    const calculateDeliveryBtn = document.querySelector('.calculate-delivery');
    if (!calculateDeliveryBtn) {
        console.error("Brak przycisku .calculate-delivery w DOM");
        return;
    }
    calculateDeliveryBtn.addEventListener('click', calculateDelivery);
}

// ============================================
// INICJALIZACJA GŁÓWNA
// ============================================

function initMainContainer() {
    mainContainer = document.querySelector('.products-summary-main');
    if (!mainContainer) {
        console.warn('[initMainContainer] Nie znaleziono .products-summary-main');
    }
}

function populateMultiplierSelects() {
    document.querySelectorAll('select[data-field="clientType"]').forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '';

        // Placeholder opcja
        const placeholderOption = document.createElement('option');
        Object.assign(placeholderOption, {
            value: '', disabled: true, hidden: true, textContent: 'Wybierz grupę'
        });
        select.appendChild(placeholderOption);

        // Opcje grup cenowych
        Object.entries(multiplierMapping).forEach(([label, value]) => {
            const option = document.createElement('option');
            option.value = label;
            option.textContent = `${label} (${value})`;
            select.appendChild(option);
        });

        // Przywróć wartość
        if (currentValue) {
            select.value = currentValue;
        } else if (isPartner && currentClientType) {
            select.value = currentClientType;
        }
    });
}

function initializeAddProductButton() {
    const addProductBtn = document.getElementById('add-product-btn');
    if (addProductBtn) {
        addProductBtn.addEventListener('click', addNewProduct);
        console.log('[initializeAddProductButton] Przycisk dodawania produktu został zainicjalizowany');
    }
}

// Główna funkcja inicjalizacyjna
function init() {
    console.log("DOMContentLoaded – inicjalizacja calculator.js");

    // Ładowanie podstawowych danych
    loadFinishingPrices();

    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';

    // Ładowanie cen z bazy danych
    const pricesDataEl = document.getElementById('prices-data');
    if (!pricesDataEl) {
        console.error("Brak elementu #prices-data");
        return;
    }

    try {
        pricesFromDatabase = JSON.parse(pricesDataEl.textContent);
        buildPriceIndex();
        dbg("Dane cennika:", pricesFromDatabase);
    } catch (e) {
        console.error("Niepoprawny JSON w #prices-data", e);
    }

    // Konfiguracja użytkownika
    const userRole = document.body.dataset.role;
    userMultiplier = parseFloat(document.body.dataset.multiplier || "1.0");
    isPartner = userRole === "partner";

    if (isPartner) {
        currentClientType = 'Partner';
        currentMultiplier = userMultiplier;
    }

    // Ładowanie mnożników
    const multipliersDataEl = document.getElementById('multipliers-data');
    if (multipliersDataEl) {
        try {
            const multipliersFromDB = JSON.parse(multipliersDataEl.textContent);
            multipliersFromDB.forEach(m => {
                multiplierMapping[m.label] = m.value;
            });
        } catch (e) {
            console.warn("Niepoprawny JSON w #multipliers-data", e);
        }
    }

    // Inicjalizacja elementów DOM
    initMainContainer();

    // Inicjalizacja elementów podsumowania
    orderSummaryEls.brutto = document.querySelector('.quote-summary .order-summary .order-brutto');
    orderSummaryEls.netto = document.querySelector('.quote-summary .order-summary .order-netto');
    deliverySummaryEls.courier = document.querySelector('.quote-summary .delivery-summary .courier');
    deliverySummaryEls.brutto = document.querySelector('.quote-summary .delivery-summary .delivery-brutto');
    deliverySummaryEls.netto = document.querySelector('.quote-summary .delivery-summary .delivery-netto');
    finalSummaryEls.brutto = document.querySelector('.quote-summary .final-summary .final-brutto');
    finalSummaryEls.netto = document.querySelector('.quote-summary .final-summary .final-netto');
    finishingSummaryEls.brutto = document.querySelector('.quote-summary .finishing-brutto');
    finishingSummaryEls.netto = document.querySelector('.quote-summary .finishing-netto');

    // Sprawdź czy wszystkie elementy zostały znalezione
    const missingElements = [];
    [
        ['orderSummaryEls.brutto', orderSummaryEls.brutto],
        ['orderSummaryEls.netto', orderSummaryEls.netto],
        ['deliverySummaryEls.courier', deliverySummaryEls.courier],
        ['deliverySummaryEls.brutto', deliverySummaryEls.brutto],
        ['deliverySummaryEls.netto', deliverySummaryEls.netto],
        ['finalSummaryEls.brutto', finalSummaryEls.brutto],
        ['finalSummaryEls.netto', finalSummaryEls.netto],
        ['finishingSummaryEls.brutto', finishingSummaryEls.brutto],
        ['finishingSummaryEls.netto', finishingSummaryEls.netto]
    ].forEach(([name, element]) => {
        if (!element) missingElements.push(name);
    });

    if (missingElements.length > 0) {
        console.warn('Nie znaleziono elementów podsumowania:', missingElements);
    }

    populateMultiplierSelects();

    // Ukryj selecty grup cenowych dla partnerów
    if (isPartner) {
        document.querySelectorAll('select[data-field="clientType"]').forEach(el => {
            const wrapper = el.closest('.client-type');
            if (wrapper) wrapper.remove();
        });
    }

    // Inicjalizacja kontenerów
    productSummaryContainer = document.getElementById('products-summary-container');
    quoteFormsContainer = document.querySelector('.quote-forms');

    if (!quoteFormsContainer) {
        quoteFormsContainer = document.createElement('div');
        quoteFormsContainer.className = 'quote-forms';
        const calcMain = document.querySelector('.calculator-main');
        calcMain.insertBefore(quoteFormsContainer, calcMain.firstElementChild);
        const initialQuoteForm = document.querySelector('.quote-form');
        if (initialQuoteForm) quoteFormsContainer.appendChild(initialQuoteForm);
    }

    // Event listenery
    document.addEventListener('change', e => {
        if (e.target.matches('select[data-field="clientType"]')) {
            const selectedType = e.target.value;
            const sourceForm = e.target.closest('.quote-form');

            if (selectedType && sourceForm) {
                syncClientTypeAcrossProducts(selectedType, sourceForm);
            }
        }
    });

    // Inicjalizacja komponentów
    initEdge3D();
    attachCalculateDeliveryListener();
    loadLatestQuotes();
    attachLengthValidation();
    attachWidthValidation();
    attachGoToQuoteListeners();
    initializeAddProductButton();
    initializeVariantAvailability();

    // Przygotowanie istniejących formularzy
    quoteFormsContainer.querySelectorAll('.quote-form').forEach((form, index) => {
        prepareNewProductForm(form, index);
        attachFormListeners(form);
        calculateFinishingCost(form);
    });

    // Aktywuj pierwszy produkt
    if (quoteFormsContainer.querySelector('.quote-form')) {
        activateProductCard(0);
    }

    generateProductsSummary();

    // Export globalnych zmiennych
    Object.assign(window, {
        multiplierMapping, isPartner, userMultiplier,
        calculateFinishingCost, addNewProduct
    });

    console.log("✅ Inicjalizacja calculator.js zakończona");
}

// Event listener dla compatibility z istniejącym kodem
document.addEventListener('deliverySelected', (event) => {
    if (typeof updateDeliverySelection === 'function') {
        updateDeliverySelection(event.detail);
    }
});

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', () => {
    init();

    // Auto-inicjalizacja delivery modal
    if (!deliveryModalInstance) {
        deliveryModalInstance = new DeliveryModal();
    }

    // Dodatkowa inicjalizacja przycisków po krótkim opóźnieniu
    setTimeout(() => {
        if (typeof updateCalculateDeliveryButtonState === 'function') {
            updateCalculateDeliveryButtonState();
        }
        initializeAddProductButton();
    }, 500);
});

console.log("✅ Zoptymalizowany calculator.js został załadowany!");