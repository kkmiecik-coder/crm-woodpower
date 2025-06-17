// calculator.js
console.log("calculator.js załadowany!");

// ------------------------------
// GLOBAL STATE & CACHING SETUP
// ------------------------------

const DEBUG = true;
function dbg(...args) { if (DEBUG) console.log(...args); }

// Dodaj na początku pliku
const shippingMessages = [
    { text: "Wyceniam wysyłkę, proszę czekać...", delay: 0 },
    { text: "Sprawdzam dostępnych kurierów...", delay: 3000 },
    { text: "Wycena mniejszych produktów trwa zwykle dłużej...", delay: 6000 },
    { text: "Jeszcze chwilka...", delay: 9000 },
    { text: "Już widzę kuriera! 🚚", delay: 12000 },
    { text: "Negocjuję najlepszą cenę...", delay: 15000 },
    { text: "Prawie gotowe...", delay: 18000 }
];

let messageTimeouts = [];
let currentClientType = '';
let currentMultiplier = 1.0;

// Funkcja do pokazywania rotujących komunikatów
function showRotatingMessages(overlay) {
    // Wyczyść poprzednie timeouty
    messageTimeouts.forEach(timeout => clearTimeout(timeout));
    messageTimeouts = [];

    // Pokaż pierwszy komunikat od razu
    overlay.innerHTML = `
        <div class="spinner"></div>
        <div class="loading-text">${shippingMessages[0].text}</div>
    `;

    // Zaplanuj kolejne komunikaty
    shippingMessages.slice(1).forEach((message, index) => {
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

// Funkcja do zatrzymania komunikatów
function stopRotatingMessages() {
    messageTimeouts.forEach(timeout => clearTimeout(timeout));
    messageTimeouts = [];
}

// Zmodyfikowana funkcja calculateDelivery
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
            const quotes = quotesList.map(option => {
                const rawGross = option.grossPrice;
                const rawNet = option.netPrice;
                return {
                    carrierName: option.carrierName,
                    rawGrossPrice: rawGross,
                    rawNetPrice: rawNet,
                    grossPrice: rawGross * shippingPackingMultiplier,
                    netPrice: rawNet * shippingPackingMultiplier,
                    carrierLogoLink: option.carrierLogoLink || ""
                };
            });

            dbg("Otrzymane wyceny wysyłki:", quotes);

            if (quotes.length === 0) {
                showDeliveryErrorModal("Brak dostępnych metod dostawy.");
            } else {
                // ✅ DODAJ packingInfo:
                const packingInfo = {
                    multiplier: shippingPackingMultiplier,
                    message: `Do cen wysyłki została doliczona kwota ${Math.round((shippingPackingMultiplier - 1) * 100)}% na pakowanie.`
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
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
}

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

const edgesList = [
    "top-front", "top-back", "top-left", "top-right",
    "bottom-front", "bottom-back", "bottom-left", "bottom-right",
    "left-front", "left-back", "right-front", "right-back"
];

let isPartner = false;
let userMultiplier = 1.0;
let multiplierMapping = {};
let pricesFromDatabase = [];
let priceIndex = {};

let quoteFormsContainer = null;
let productTabs = null;
let activeQuoteForm = null;

let edge3dRoot = null;

let orderSummaryEls = {};
let deliverySummaryEls = {};
let finalSummaryEls = {};
let finishingSummaryEls = {};

const shippingPackingMultiplier = 1.3;

/**
 * Oblicza objętość pojedynczego produktu w m³
 */
function calculateSingleVolume(length, width, thickness) {
    return (length / 100) * (width / 100) * (thickness / 100);
}

/**
 * Formatuje liczbę do formatu PLN
 */
function formatPLN(value) {
    return value.toFixed(2) + ' PLN';
}

/**
 * Buduje indeks cenowy (priceIndex) na podstawie pricesFromDatabase
 */
function buildPriceIndex() {
    priceIndex = {};
    pricesFromDatabase.forEach(entry => {
        const key = `${entry.species}::${entry.technology}::${entry.wood_class}`;
        if (!priceIndex[key]) priceIndex[key] = [];
        priceIndex[key].push(entry);
    });
}

/**
 * Pobiera cenę z priceIndex zamiast liniowego .find na całej tablicy
 */
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

/**
 * Aktualizuje globalne podsumowanie
 */
/**
 * Aktualizuje globalne podsumowanie oraz pojedynczy koszt aktywnego formularza
 */
function updateGlobalSummary() {
    dbg("→ updateGlobalSummary start");

    if (!quoteFormsContainer) return;

    // 1) Pokaż w "Koszt surowego" i "Koszty wykończenia" dane tylko dla activeQuoteForm
    if (activeQuoteForm) {
        // Surowy z activeQuoteForm
        const orderBruttoVal = parseFloat(activeQuoteForm.dataset.orderBrutto) || 0;
        const orderNettoVal = parseFloat(activeQuoteForm.dataset.orderNetto) || 0;
        orderSummaryEls.brutto.textContent = orderBruttoVal ? formatPLN(orderBruttoVal) : "0.00 PLN";
        orderSummaryEls.netto.textContent = orderNettoVal ? formatPLN(orderNettoVal) : "0.00 PLN";

        // Wykończenie dla activeQuoteForm
        const finBruttoVal = parseFloat(activeQuoteForm.dataset.finishingBrutto) || 0;
        const finNettoVal = parseFloat(activeQuoteForm.dataset.finishingNetto) || 0;
        finishingSummaryEls.brutto.textContent = finBruttoVal ? formatPLN(finBruttoVal) : "0.00 PLN";
        finishingSummaryEls.netto.textContent = finNettoVal ? formatPLN(finNettoVal) : "0.00 PLN";
    } else {
        // Jeśli nie ma aktywnego, pokaż puste / domyślne
        orderSummaryEls.brutto.textContent = "0.00 PLN";
        orderSummaryEls.netto.textContent = "0.00 PLN";
        finishingSummaryEls.brutto.textContent = "0.00 PLN";
        finishingSummaryEls.netto.textContent = "0.00 PLN";
    }

    // 2) Oblicz sumę globalną: surowy + wykończenie ze wszystkich formularzy
    let sumOrderBrutto = 0;
    let sumOrderNetto = 0;
    let sumFinishingBrutto = 0;
    let sumFinishingNetto = 0;

    const forms = quoteFormsContainer.querySelectorAll('.quote-form');
    forms.forEach(form => {
        const oBr = parseFloat(form.dataset.orderBrutto) || 0;
        const oNt = parseFloat(form.dataset.orderNetto) || 0;
        const fBr = parseFloat(form.dataset.finishingBrutto) || 0;
        const fNt = parseFloat(form.dataset.finishingNetto) || 0;
        sumOrderBrutto += oBr;
        sumOrderNetto += oNt;
        sumFinishingBrutto += fBr;
        sumFinishingNetto += fNt;
    });

    // 3) Teraz odczytaj koszt kuriera (delivery) – zakładamy, że został ustawiony w DOM przez showDeliveryModal
    let deliveryBruttoVal = 0;
    let deliveryNettoVal = 0;
    const deliveryBruttoText = deliverySummaryEls.brutto.textContent;
    const deliveryNettoText = deliverySummaryEls.netto.textContent;
    if (deliveryBruttoText.endsWith('PLN')) {
        deliveryBruttoVal = parseFloat(deliveryBruttoText.replace(" PLN", "")) || 0;
    }
    if (deliveryNettoText.endsWith('PLN')) {
        deliveryNettoVal = parseFloat(deliveryNettoText.replace(" PLN", "")) || 0;
    }

    // 4) Wstaw do sekcji "Koszt wysyłki" nazwę i wartości brutto/netto (jeżeli nie wyliczone, zostaw poprzedni tekst)
    //    (zakładamy, że deliverySummaryEls.courier, .brutto i .netto już wcześniej wypełniono przez showDeliveryModal / showDeliveryErrorModal)

    // 5) W sekcji „Suma” zsumuj:
    //    SUMA_BRUTTO = sumOrderBrutto + sumFinishingBrutto + deliveryBruttoVal
    //    SUMA_NETTO  = sumOrderNetto  + sumFinishingNetto  + deliveryNettoVal
    const totalBrutto = sumOrderBrutto + sumFinishingBrutto + deliveryBruttoVal;
    const totalNetto = sumOrderNetto + sumFinishingNetto + deliveryNettoVal;
    finalSummaryEls.brutto.textContent = (totalBrutto > 0) ? formatPLN(totalBrutto) : "0.00 PLN";
    finalSummaryEls.netto.textContent = (totalNetto > 0) ? formatPLN(totalNetto) : "0.00 PLN";

    updateCalculateDeliveryButtonState();
    dbg("← updateGlobalSummary end");
}


/**
 * Aktualizuje ceny jednostkowe i sumaryczne dla aktywnego formularza
 */
function updatePrices() {
    if (!activeQuoteForm) return;
    dbg("→ updatePrices start");

    const lengthEl = activeQuoteForm.querySelector('input[data-field="length"]');
    const widthEl = activeQuoteForm.querySelector('input[data-field="width"]');
    const thicknessEl = activeQuoteForm.querySelector('input[data-field="thickness"]');
    const quantityEl = activeQuoteForm.querySelector('input[data-field="quantity"]');
    const clientTypeEl = activeQuoteForm.querySelector('select[data-field="clientType"]');
    const variantContainer = activeQuoteForm.querySelector('.variants');

    if (!lengthEl || !widthEl || !thicknessEl || !quantityEl || !variantContainer) return;

    const length = parseFloat(lengthEl.value);
    const width = parseFloat(widthEl.value);
    const thickness = parseFloat(thicknessEl.value);
    let quantity = parseInt(quantityEl.value);

    if (isNaN(quantity) || quantity < 1) {
        quantity = 1;
        quantityEl.value = 1;
    }

    const clientType = clientTypeEl ? clientTypeEl.value : "";
    if (clientTypeEl) {
        if (!clientType) clientTypeEl.classList.add('error-outline');
        else clientTypeEl.classList.remove('error-outline');
    }
    if (!isPartner && !clientType) {
        showErrorForAllVariants("Brak grupy", variantContainer);
        activeQuoteForm.dataset.orderBrutto = "";
        activeQuoteForm.dataset.orderNetto = "";
        updateGlobalSummary();
        return;
    }

    let errorMsg = "";
    if (isNaN(length)) errorMsg = "Brak dług.";
    else if (isNaN(width)) errorMsg = "Brak szer.";
    else if (isNaN(thickness)) errorMsg = "Brak grub.";

    if (lengthEl) {
        if (isNaN(length)) lengthEl.classList.add('error-outline');
        else lengthEl.classList.remove('error-outline');
    }
    if (widthEl) {
        if (isNaN(width)) widthEl.classList.add('error-outline');
        else widthEl.classList.remove('error-outline');
    }
    if (thicknessEl) {
        if (isNaN(thickness)) thicknessEl.classList.add('error-outline');
        else thicknessEl.classList.remove('error-outline');
    }
    if (quantityEl) {
        if (isNaN(quantity)) quantityEl.classList.add('error-outline');
        else quantityEl.classList.remove('error-outline');
    }

    if (errorMsg) {
        showErrorForAllVariants(errorMsg, variantContainer);
        activeQuoteForm.dataset.orderBrutto = "";
        activeQuoteForm.dataset.orderNetto = "";
        updateGlobalSummary();
        return;
    }

    const singleVolume = calculateSingleVolume(length, width, Math.ceil(thickness));
    let multiplier = isPartner ? userMultiplier : (multiplierMapping[clientType] || 1.0);
    let multiplierAdjusted = false;

    const variantItems = Array.from(variantContainer.children)
        .filter(child => child.querySelector('input[type="radio"]'));
    variantItems.forEach(variant => {
        const radio = variant.querySelector('input[type="radio"]');
        if (!radio) return;
        const id = radio.value;
        const config = variantMapping[id];
        if (!config) return;

        const match = getPrice(config.species, config.technology, config.wood_class, thickness, length);
        const unitBruttoSpan = variant.querySelector('.unit-brutto');
        const unitNettoSpan = variant.querySelector('.unit-netto');
        const totalBruttoSpan = variant.querySelector('.total-brutto');
        const totalNettoSpan = variant.querySelector('.total-netto');

        if (match && unitBruttoSpan && unitNettoSpan && totalBruttoSpan && totalNettoSpan) {
            const basePrice = match.price_per_m3;
            dbg("→ obliczenia:", { basePrice, singleVolume, multiplier });
            let effectiveMultiplier = multiplier;
            let unitNetto = singleVolume * basePrice * effectiveMultiplier;

            if (!isPartner && clientType === "Detal" && unitNetto < 1000) {
                effectiveMultiplier = 1.5;
                multiplierAdjusted = true;
                unitNetto = singleVolume * basePrice * effectiveMultiplier;
                variant.style.backgroundColor = "#FFECEC"; // przywrócenie inline background dla widoczności
            } else {
                variant.style.backgroundColor = "";
            }

            const unitBrutto = unitNetto * 1.23;
            const totalNetto = unitNetto * quantity;
            const totalBrutto = unitBrutto * quantity;

            radio.dataset.totalNetto = totalNetto;
            radio.dataset.totalBrutto = totalBrutto;
            radio.dataset.volumeM3 = singleVolume;
            radio.dataset.pricePerM3 = basePrice;

            unitBruttoSpan.textContent = formatPLN(unitBrutto);
            unitNettoSpan.textContent = formatPLN(unitNetto);
            totalBruttoSpan.textContent = formatPLN(totalBrutto);
            totalNettoSpan.textContent = formatPLN(totalNetto);
        } else {
            if (unitBruttoSpan) unitBruttoSpan.textContent = 'Brak ceny';
            if (unitNettoSpan) unitNettoSpan.textContent = 'Brak ceny';
            if (totalBruttoSpan) totalBruttoSpan.textContent = 'Brak ceny';
            if (totalNettoSpan) totalNettoSpan.textContent = 'Brak ceny';
        }
    });

    const tabIndex = Array.from(quoteFormsContainer.querySelectorAll('.quote-form')).indexOf(activeQuoteForm);
    if (tabIndex === -1) {
        console.error("updatePrices: Invalid tabIndex.");
        return;
    }
    const groupRadios = activeQuoteForm.querySelectorAll(
        `input[name^="variantOption-${tabIndex}"], input[name^="selected-${tabIndex}"]`
    );
    groupRadios.forEach(radio => {
        if (radio.checked) radio.name = `selected-${tabIndex}`;
        else radio.name = `variantOption-${tabIndex}`;
    });

    variantItems.forEach(variant => {
        variant.querySelectorAll('*').forEach(el => el.style.color = "");
    });

    const expectedName = `selected-${tabIndex}`;
    const selectedRadio = activeQuoteForm.querySelector(`input[name="${expectedName}"]:checked`);
    if (selectedRadio && selectedRadio.dataset.totalBrutto && selectedRadio.dataset.totalNetto) {
        activeQuoteForm.dataset.orderBrutto = selectedRadio.dataset.totalBrutto;
        activeQuoteForm.dataset.orderNetto = selectedRadio.dataset.totalNetto;
        const selectedVariant = selectedRadio.closest('div');
        if (selectedVariant) {
            selectedVariant.querySelectorAll('*').forEach(el => el.style.color = "#ED6B24");
        }
    } else {
        activeQuoteForm.dataset.orderBrutto = "";
        activeQuoteForm.dataset.orderNetto = "";
    }

    const msgEl = activeQuoteForm.querySelector('.multiplier-message');
    if (msgEl) {
        if (multiplierAdjusted) {
            msgEl.textContent = "Zmieniono mnożnik dla niektórych wariantów.";
            msgEl.classList.add('multiplier-warning');
        } else {
            msgEl.textContent = "";
            msgEl.classList.remove('multiplier-warning');
        }
    }

    calculateFinishingCost(activeQuoteForm);
    updateGlobalSummary();
    dbg("← updatePrices end");
}

/**
 * Pokazuje komunikat błędu we wszystkich wariantach
 */
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

/**
 * Oblicza cenę wykończenia i aktualizuje UI oraz dataset podformularza
 */
function calculateFinishingCost(form) {
    dbg("🧪 calculateFinishingCost start:", form);
    // Jeśli form jest falsy albo nie jest elementem .quote-form, przerywamy
    if (!form || !form.closest('.quote-form')) return { netto: null, brutto: null };

    const finishingTypeBtn = form.querySelector('.finishing-btn[data-finishing-type].active');
    const finishingVariantBtn = form.querySelector('.finishing-btn[data-finishing-variant].active');

    const finishingType = finishingTypeBtn ? finishingTypeBtn.dataset.finishingType : 'Brak';
    const finishingVariant = finishingVariantBtn ? finishingVariantBtn.dataset.finishingVariant : 'Brak';

    const lengthInput = form.querySelector('input[data-field="length"]');
    const widthInput = form.querySelector('input[data-field="width"]');
    const thicknessInput = form.querySelector('input[data-field="thickness"]');
    const quantityInput = form.querySelector('input[data-field="quantity"]');

    const finishingBruttoEl = document.getElementById('finishing-brutto');
    const finishingNettoEl = document.getElementById('finishing-netto');

    if (finishingType === 'Brak') {
        form.dataset.finishingBrutto = 0;
        form.dataset.finishingNetto = 0;
        if (finishingBruttoEl) finishingBruttoEl.textContent = '0.00 PLN';
        if (finishingNettoEl) finishingNettoEl.textContent = '0.00 PLN';
        updateGlobalSummary();
        dbg("🧪 calculateFinishingCost end: brak");
        return { netto: 0, brutto: 0 };
    }

    // Jeśli nie ma wymiarów, przerywamy
    if (!lengthInput?.value || !widthInput?.value || !thicknessInput?.value) {
        dbg("🧪 calculateFinishingCost end: brak wymiarów");
        return { netto: null, brutto: null };
    }

    const lengthVal = parseFloat(lengthInput.value);
    const widthVal = parseFloat(widthInput.value);
    const thicknessVal = parseFloat(thicknessInput.value);
    const quantityVal = parseInt(quantityInput.value) || 1;

    // Przeliczamy z cm na mm (x10)
    const length = lengthVal * 10;
    const width = widthVal * 10;
    const thickness = thicknessVal * 10;

    const area_mm2 = 2 * (length * width + length * thickness + width * thickness);
    const area_m2 = area_mm2 / 1_000_000;
    const total_area = area_m2 * quantityVal;

    let pricePerM2 = 0;
    if (finishingVariant === 'Bezbarwne') pricePerM2 = 200;
    else if (finishingVariant === 'Barwne') pricePerM2 = 250;

    const finishingPriceBrutto = +(total_area * pricePerM2).toFixed(2);
    const finishingPriceNetto = +(finishingPriceBrutto / 1.23).toFixed(2);

    form.dataset.finishingBrutto = finishingPriceBrutto;
    form.dataset.finishingNetto = finishingPriceNetto;

    if (finishingBruttoEl) finishingBruttoEl.textContent = finishingPriceBrutto.toFixed(2) + ' PLN';
    if (finishingNettoEl) finishingNettoEl.textContent = finishingPriceNetto.toFixed(2) + ' PLN';

    updateGlobalSummary();
    dbg("🧪 calculateFinishingCost end:", { finishingPriceNetto, finishingPriceBrutto });
    return { netto: finishingPriceNetto, brutto: finishingPriceBrutto };
}
/**
 * Aktualizuje stan przycisków "Oblicz wysyłkę" i "Zapisz wycenę"
 */
function updateCalculateDeliveryButtonState() {
    if (!activeQuoteForm) return;

    const productInputs = activeQuoteForm.querySelectorAll('.product-inputs input, .product-inputs select');
    let allFilled = true;
    productInputs.forEach(input => {
        if (!input.value || input.value.trim() === "") {
            allFilled = false;
        }
    });

    const calcDeliveryBtn = document.querySelector('.calculate-delivery');
    const saveQuoteBtn = document.querySelector('.save-quote');

    [calcDeliveryBtn, saveQuoteBtn].forEach(btn => {
        if (!btn) return;
        if (!allFilled) {
            btn.classList.add('btn-disabled');
            btn.disabled = true;
        } else {
            btn.classList.remove('btn-disabled');
            btn.disabled = false;
        }
    });
}

/**
 * Dodaje listener dla wykończenia (inputy + kliknięcia)
 */
function attachFinishingListenersToForm(form) {
    if (!form) return;
    const inputs = form.querySelectorAll(
        'input[data-field="length"], input[data-field="width"], input[data-field="thickness"], input[data-field="quantity"]'
    );
    inputs.forEach(input => {
        input.addEventListener('input', () => calculateFinishingCost(form));
    });

    form.querySelectorAll('.finishing-btn').forEach(btn => {
        btn.addEventListener('click', () => calculateFinishingCost(form));
    });
}


/**
 * Dodaje listener dla UI wykończenia (widoczność opcji)
 */
function attachFinishingUIListeners(form) {
    if (!form) return;
    const typeButtons = form.querySelectorAll('[data-finishing-type]');
    const variantButtons = form.querySelectorAll('[data-finishing-variant]');
    const glossButtons = form.querySelectorAll('[data-finishing-gloss]');
    const colorButtons = form.querySelectorAll('[data-finishing-color]');

    const variantWrapper = form.querySelector('#finishing-variant-wrapper');
    const glossWrapper = form.querySelector('#finishing-gloss-wrapper');
    const colorWrapper = form.querySelector('#finishing-color-wrapper');

    let currentType = form.querySelector('.finishing-btn[data-finishing-type].active')?.dataset.finishingType || 'Brak';
    let currentVariant = form.querySelector('.finishing-btn[data-finishing-variant].active')?.dataset.finishingVariant || 'Brak';

    const resetButtons = buttons => buttons.forEach(btn => btn.classList.remove('active'));
    const show = el => { if (el) el.style.display = 'flex'; };
    const hide = el => { if (el) el.style.display = 'none'; };

    function updateVisibility() {
        if (currentType === 'Brak') {
            hide(variantWrapper);
            hide(glossWrapper);
            hide(colorWrapper);
            return;
        }
        show(variantWrapper);

        if (currentVariant === 'Barwne') show(colorWrapper);
        else hide(colorWrapper);

        if (currentType === 'Lakierowanie') show(glossWrapper);
        else hide(glossWrapper);
    }

    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            resetButtons(typeButtons);
            btn.classList.add('active');
            currentType = btn.dataset.finishingType;
            updateVisibility();
            calculateFinishingCost(form);
        });
    });

    variantButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            resetButtons(variantButtons);
            btn.classList.add('active');
            currentVariant = btn.dataset.finishingVariant;
            updateVisibility();
            calculateFinishingCost(form);
        });
    });

    glossButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            resetButtons(glossButtons);
            btn.classList.add('active');
        });
    });

    colorButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            resetButtons(colorButtons);
            btn.classList.add('active');
        });
    });

    updateVisibility();
}

function attachFormListeners(form) {
    if (!form || form.dataset.listenersAttached) return;

    // Dodaj listenery dla podstawowych inputów
    form.querySelectorAll('input[data-field]').forEach(input => {
        input.addEventListener('input', updatePrices);
    });

    form.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', updatePrices);
    });

    // SPECJALNA OBSŁUGA dla select grupy cenowej
    const clientTypeSelect = form.querySelector('select[data-field="clientType"]');
    if (clientTypeSelect) {
        // Usuń poprzedni listener jeśli istnieje
        clientTypeSelect.removeEventListener('change', updatePrices);
        
        // Dodaj tylko updatePrices - synchronizacja jest obsługiwana przez globalny listener w init()
        clientTypeSelect.addEventListener('change', updatePrices);
    }

    attachFinishingListenersToForm(form);
    attachFinishingUIListeners(form);

    form.dataset.listenersAttached = "true";
}

/**
 * Przygotowuje klonowany formularz (ustawia ID, name, resetuje wartości)
 */
function prepareNewProductForm(form, index) {
    if (!form) return;

    form.querySelectorAll('.variants input[type="radio"]').forEach(radio => {
        const oldId = radio.id;
        const baseId = radio.value;
        const newId = `${baseId}-${index}`;
        const label = form.querySelector(`label[for="${oldId}"]`);
        radio.id = newId;
        radio.name = `variantOption-${index}`;
        radio.checked = false;
        if (label) label.setAttribute('for', newId);
    });

    form.querySelectorAll('.finishing-btn.active').forEach(btn => btn.classList.remove('active'));
    const defaultFinishing = form.querySelector('.finishing-btn[data-finishing-type="Brak"]');
    if (defaultFinishing) defaultFinishing.classList.add('active');

    form.querySelectorAll('.finishing-colors, .finishing-gloss').forEach(el => el.style.display = 'none');

    form.dataset.orderBrutto = '';
    form.dataset.orderNetto = '';
    form.dataset.finishingType = 'Brak';
    form.dataset.finishingBrutto = '';
    form.dataset.finishingNetto = '';

    form.querySelectorAll('input[data-field]').forEach(input => input.value = '');
    form.querySelectorAll('select[data-field]').forEach(select => select.selectedIndex = 0);

    form.querySelectorAll('.variants span').forEach(span => {
        const isHeader = span.classList.contains('header-title') ||
            span.classList.contains('header-unit-brutto') ||
            span.classList.contains('header-unit-netto') ||
            span.classList.contains('header-total-brutto') ||
            span.classList.contains('header-total-netto');
        if (!span.classList.contains('out-of-stock-tag') && !isHeader) {
            span.textContent = '0.00 PLN';
        }
    });

    form.querySelectorAll('.variants div').forEach(variant => {
        variant.style.backgroundColor = '';
        variant.querySelectorAll('*').forEach(el => el.style.color = '');
    });

    updateCalculateDeliveryButtonState();
}

/**
 * Toggles visibility of the angle column in the edge3d table
 */
function toggleAngleColumn(show) {
    const table = document.getElementById('edge3d-table');
    if (!table) return;
    const headerCell = table.querySelector('.edge3d-header .edge3d-cell:nth-child(4)');
    if (headerCell) headerCell.style.visibility = show ? 'visible' : 'hidden';
}

/**
 * Delegation: highlight edge in 3D and update edgeSettings on input change
 */
function onEdgeInputChange(e) {
    const input = e.target;
    const row = input.closest('.edge3d-row');
    if (!row) return;
    const key = row.querySelector('.edge3d-cell').textContent.trim();
    console.log(`→ onEdgeInputChange — key="${key}", value="${input.value}"`);

    if (typeof window.highlightEdge === 'function') {
        window.highlightEdge(key, '#ED6B24', 2);
    }

    window.edgeSettings[key] = window.edgeSettings[key] || {};
    window.edgeSettings[key].value = parseFloat(input.value) || 0;

    const dims = {
        length: parseFloat(document.querySelector('input[data-field="length"]').value) || 0,
        width: parseFloat(document.querySelector('input[data-field="width"]').value) || 0,
        height: parseFloat(document.querySelector('input[data-field="thickness"]').value) || 0
    };

    maybeRender3D(dims, window.edgeSettings);
}

/**
 * Delegation: ustaw typ obróbki krawędzi i renderuj ponownie
 */
function onTypeButtonClick(e) {
    const btn = e.currentTarget;
    const key = btn.dataset.edgeKey;
    const type = btn.dataset.type;
    console.log(`→ onTypeButtonClick — key="${key}", type="${type}"`);

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

/**
 * Renderuje 3D tylko wtedy, gdy wymiary lub settings się zmieniły
 */
function maybeRender3D(dims, settings) {
    const dimsChanged = dims.length !== lastDims.length ||
        dims.width !== lastDims.width ||
        dims.height !== lastDims.height;
    const settingsJSON = JSON.stringify(settings);
    const settingsChanged = settingsJSON !== lastSettingsJSON;

    if (!dimsChanged && !settingsChanged) return;

    lastDims = { ...dims };
    lastSettingsJSON = settingsJSON;

    if (edge3dRoot) {
        edge3dRoot.render(
            React.createElement(Edge3DViewer, { dimensions: dims, edgeSettings: settings })
        );
    }
}

/**
 * Renderuje tabelę edge3d przy pomocy DocumentFragment
 */
function renderEdgeInputs() {
    const table = document.getElementById('edge3d-table');
    if (!table) return console.error("Brak #edge3d-table w DOM");

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
        row.style.display = 'flex';
        row.style.gap = '12px';
        row.style.alignItems = 'center';
        row.style.padding = '0 12px';

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

        const nameCell = document.createElement('div');
        nameCell.className = 'edge3d-cell';
        nameCell.style.width = '120px';
        nameCell.textContent = key;
        row.appendChild(nameCell);

        const typeCell = document.createElement('div');
        typeCell.className = 'edge3d-cell';
        typeCell.style.display = 'flex';
        typeCell.style.gap = '8px';
        typeCell.style.width = '160px';
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

        const angleCell = document.createElement('div');
        angleCell.className = 'edge3d-cell';
        angleCell.style.width = '200px';
        angleCell.style.visibility = 'hidden';
        angleCell.style.display = 'flex';
        angleCell.style.alignItems = 'center';
        const range = document.createElement('input');
        range.type = 'range';
        range.id = `edge-angle-${key}`;
        range.className = 'input-range';
        range.min = 0;
        range.max = 90;
        range.step = 1;
        range.oninput = function () {
            angleDisplay.textContent = this.value + '°';
        };
        const angleDisplay = document.createElement('span');
        angleDisplay.id = `angle-display-${key}`;
        angleDisplay.style.marginLeft = '8px';
        angleDisplay.style.width = '40px';
        angleDisplay.textContent = '45°';
        angleCell.appendChild(range);
        angleCell.appendChild(angleDisplay);
        row.appendChild(angleCell);

        frag.appendChild(row);
    });

    table.innerHTML = '';
    table.appendChild(frag);
}

/**
 * Inicjalizuje edge3d przy kliknięciu przycisku
 */
function initEdge3D() {
    const openEdgesBtn = document.getElementById('openEdgesModal');
    if (!openEdgesBtn) return console.warn("Nie znaleziono przycisku #openEdgesModal");
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
        edge3dRoot.render(
            React.createElement(Edge3DViewer, { dimensions: dims, edgeSettings: window.edgeSettings })
        );
    });
}

/**
 * Oblicza zagregowane dane do wyceny wysyłki
 */
function computeAggregatedData() {
    const forms = quoteFormsContainer.querySelectorAll('.quote-form');
    if (forms.length === 0) {
        console.error("Brak formularzy .quote-form");
        return null;
    }

    let maxLength = 0;
    let maxWidth = 0;
    let totalThickness = 0;
    let totalWeight = 0;

    forms.forEach(form => {
        const lengthVal = parseFloat(form.querySelector('input[data-field="length"]').value) || 0;
        const widthVal = parseFloat(form.querySelector('input[data-field="width"]').value) || 0;
        const thicknessVal = parseFloat(form.querySelector('input[data-field="thickness"]').value) || 0;
        const quantityVal = parseInt(form.querySelector('input[data-field="quantity"]').value) || 1;

        if (lengthVal > maxLength) maxLength = lengthVal;
        if (widthVal > maxWidth) maxWidth = widthVal;

        totalThickness += thicknessVal * quantityVal;
        const volume = (lengthVal / 100) * (widthVal / 100) * (thicknessVal / 100);
        const productWeight = volume * 800 * quantityVal;
        totalWeight += productWeight;
    });

    const aggregatedLength = maxLength + 5;
    const aggregatedWidth = maxWidth + 5;
    const aggregatedThickness = totalThickness + 5;

    dbg("Aggregated dims for shipping:", { aggregatedLength, aggregatedWidth, aggregatedThickness, totalWeight });

    return {
        length: aggregatedLength,
        width: aggregatedWidth,
        height: aggregatedThickness,
        weight: totalWeight,
        quantity: 1,
        senderCountryId: "1",
        receiverCountryId: "1"
    };
}

function updateDeliverySelection(selection) {
    console.log('Wybrano dostawę:', selection);
    
    // Sprawdź czy elementy istnieją
    if (!deliverySummaryEls.courier || !deliverySummaryEls.brutto || !deliverySummaryEls.netto) {
        console.error('Brakuje elementów deliverySummaryEls');
        return;
    }
    
    // Aktualizuj elementy podsumowania
    deliverySummaryEls.courier.textContent = selection.carrierName;
    deliverySummaryEls.brutto.textContent = formatPLN(selection.grossPrice);
    deliverySummaryEls.netto.textContent = formatPLN(selection.netPrice);
    
    // Przelicz całe podsumowanie
    updateGlobalSummary();
}

/**
 * Attaches the calculateDelivery button listener
 */
function attachCalculateDeliveryListener() {
    const calculateDeliveryBtn = document.querySelector('.calculate-delivery');
    if (!calculateDeliveryBtn) {
        console.error("Brak przycisku .calculate-delivery w DOM");
        return;
    }
    calculateDeliveryBtn.addEventListener('click', calculateDelivery);
    dbg("Podpięty event listener do .calculate-delivery");
}

/**
 * Ładuje najnowsze wyceny i wyświetla w #latestQuotesList
 */
function loadLatestQuotes() {
    console.info("[loadLatestQuotes] Startuję ładowanie ostatnich wycen...");
    const container = document.getElementById('latestQuotesList');
    if (!container) {
        console.warn("[loadLatestQuotes] Brak kontenera #latestQuotesList – przerywam");
        return;
    }

    fetch('/calculator/latest_quotes')
        .then(res => res.json())
        .then(data => {
            console.info(`[loadLatestQuotes] Otrzymano ${data.length} wycen`);
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
                        <button class="quotes-btn-download" data-token="${q.public_token}">
                            Pobierz
                        </button>
                    </div>
                </div>
            `).join('');

            container.innerHTML = html;
            console.log("[loadLatestQuotes] Wyrenderowano HTML z ostatnimi wycenami");

            // TYLKO obsługa przycisku "Przejdź" - pobieranie jest obsługiwane przez initCalculatorDownloadModal()
            container.querySelectorAll('.go-ahead').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    console.log(`[go-ahead] Klik na przycisk przejdź – ID: ${id}`);

                    // BACKUP: Zapisz ID do sessionStorage
                    sessionStorage.setItem('openQuoteId', id);
                    console.log(`[go-ahead] Zapisano do sessionStorage: openQuoteId=${id}`);

                    // Przekieruj do quotes z parametrem aby otworzyć modal
                    const targetUrl = `/quotes?open_quote=${id}`;
                    console.log(`[go-ahead] Przekierowanie do:`, targetUrl);
                    window.location.href = targetUrl;
                });
            });
        })
        .catch(err => {
            console.error("[loadLatestQuotes] Błąd podczas ładowania wycen:", err);
        });
}

/**
 * Dodaje listener zamykania modala "download-modal" po kliknięciu w "x" lub poza modal
 */
function attachDownloadModalClose() {
    const modal = document.getElementById("download-modal");
    if (!modal) return;
    const closeBtn = modal.querySelector('.close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            const iframe = document.getElementById("quotePreview");
            if (iframe) iframe.src = "";
        });
    }
    document.addEventListener('click', e => {
        if (modal.style.display === 'flex' && !modal.contains(e.target)) {
            modal.style.display = 'none';
            const iframe = document.getElementById("quotePreview");
            if (iframe) iframe.src = "";
        }
    });
}

/**
 * Dodaje funkcjonalność przyciskom PDF i PNG w modalu "download-modal"
 */
function attachDownloadFormatButtons() {
    const pdfBtn = document.getElementById('pdf-btn');
    const pngBtn = document.getElementById('png-btn');
    const iframe = document.getElementById("quotePreview");
    if (pdfBtn && iframe) {
        pdfBtn.addEventListener('click', () => {
            const src = iframe.src;
            if (src) {
                const a = document.createElement('a');
                a.href = src;
                a.download = 'quote.pdf';
                a.click();
            }
        });
    }
    if (pngBtn && iframe) {
        pngBtn.addEventListener('click', () => {
            // Zakładamy, że iframe wyświetla PDF; konwersja do PNG wymaga backendu lub biblioteki na stronie.
            // Tutaj wykonamy prosty fallback: otworzymy PDF w nowej karcie, by użytkownik mógł zapisać jako obraz.
            const src = iframe.src;
            if (src) {
                window.open(src, '_blank');
            }
        });
    }
}

/**
 * Walidacja długości (max 450 cm)
 */
function attachLengthValidation() {
    const lengthInput = document.querySelector('input[data-field="length"]');
    if (!lengthInput) return;
    lengthInput.addEventListener('input', function () {
        const val = parseFloat(this.value);
        let errorSpan = this.parentNode.querySelector('.error-message-length');
        if (!errorSpan) {
            errorSpan = document.createElement('span');
            errorSpan.classList.add('error-message-length');
            errorSpan.style.color = 'red';
            errorSpan.style.fontSize = '12px';
            this.parentNode.appendChild(errorSpan);
        }
        if (!isNaN(val) && val > 450) {
            errorSpan.textContent = "Długość poza odpowiednim zakresem 0-450 cm.";
        } else {
            errorSpan.textContent = "";
        }
    });
}

/**
 * Walidacja szerokości (max 120 cm)
 */
function attachWidthValidation() {
    const widthInput = document.querySelector('input[data-field="width"]');
    if (!widthInput) return;
    widthInput.addEventListener('input', function () {
        const val = parseFloat(this.value);
        let errorSpan = this.parentNode.querySelector('.error-message-width');
        if (!errorSpan) {
            errorSpan = document.createElement('span');
            errorSpan.classList.add('error-message-width');
            errorSpan.style.color = 'red';
            errorSpan.style.fontSize = '12px';
            this.parentNode.appendChild(errorSpan);
        }
        if (!isNaN(val) && val > 120) {
            errorSpan.textContent = "Szerokość poza odpowiednim zakresem 0-120 cm.";
        } else {
            errorSpan.textContent = "";
        }
    });
}

/**
 * Walidacja i kolorowanie pól (klasa .error-outline)
 */
function attachGlobalValidationListeners() {
    const inputs = document.querySelectorAll('.quote-form input[data-field], .quote-form select[data-field]');
    inputs.forEach(input => {
        input.addEventListener('input', updateGlobalSummary);
        input.addEventListener('change', updateGlobalSummary);
    });
}

/**
 * Main init on DOMContentLoaded
 */
function init() {
    console.log("DOMContentLoaded – inicjalizacja calculator.js");

    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';

    const pricesDataEl = document.getElementById('prices-data');
    if (!pricesDataEl) {
        console.error("Brak elementu #prices-data");
        return;
    }
    try {
        pricesFromDatabase = JSON.parse(pricesDataEl.textContent);
        dbg("Dane cennika:", pricesFromDatabase);
        buildPriceIndex();
    } catch (e) {
        console.error("Niepoprawny JSON w #prices-data", e);
    }

    const userRole = document.body.dataset.role;
    userMultiplier = parseFloat(document.body.dataset.multiplier || "1.0");
    isPartner = userRole === "partner";
    dbg("Rola użytkownika:", userRole, "Mnożnik:", userMultiplier);

    // NOWA LOGIKA: Ustaw domyślną grupę cenową dla partnerów
    if (isPartner) {
        currentClientType = 'Partner';
        currentMultiplier = userMultiplier;
    }

    multiplierMapping = {};
    const multipliersDataEl = document.getElementById('multipliers-data');
    if (multipliersDataEl) {
        try {
            const multipliersFromDB = JSON.parse(multipliersDataEl.textContent);
            multipliersFromDB.forEach(m => {
                multiplierMapping[m.label] = m.value;
            });
            dbg("Pobrane mnożniki:", multiplierMapping);
        } catch (e) {
            console.warn("Niepoprawny JSON w #multipliers-data", e);
        }
    } else {
        console.warn("Brak #multipliers-data – nie załadowano mnożników.");
    }

    orderSummaryEls.brutto = document.querySelector('.quote-summary .order-summary .order-brutto');
    orderSummaryEls.netto = document.querySelector('.quote-summary .order-summary .order-netto');
    deliverySummaryEls.courier = document.querySelector('.quote-summary .delivery-summary .courier');
    deliverySummaryEls.brutto = document.querySelector('.quote-summary .delivery-summary .delivery-brutto');
    deliverySummaryEls.netto = document.querySelector('.quote-summary .delivery-summary .delivery-netto');
    finalSummaryEls.brutto = document.querySelector('.quote-summary .final-summary .final-brutto');
    finalSummaryEls.netto = document.querySelector('.quote-summary .final-summary .final-netto');
    finishingSummaryEls.brutto = document.querySelector('.quote-summary .finishing-brutto');
    finishingSummaryEls.netto = document.querySelector('.quote-summary .finishing-netto');

    const populateMultiplierSelects = () => {
        console.log("[populateMultiplierSelects] Wypełniam opcje grup cenowych");
        
        document.querySelectorAll('select[data-field="clientType"]').forEach(select => {
            const currentValue = select.value; // Zachowaj aktualną wartość
            
            // Stwórz opcje bez resetowania selected
            select.innerHTML = '';
            
            // Dodaj placeholder opcję
            const placeholderOption = document.createElement('option');
            placeholderOption.value = '';
            placeholderOption.disabled = true;
            placeholderOption.hidden = true;
            placeholderOption.textContent = 'Wybierz grupę';
            // NIE ustawiaj selected na placeholder
            select.appendChild(placeholderOption);
            
            // Dodaj opcje grup cenowych
            Object.entries(multiplierMapping).forEach(([label, value]) => {
                const option = document.createElement('option');
                option.value = label;
                option.textContent = `${label} (${value})`;
                select.appendChild(option);
            });
            
            // Przywróć wartość jeśli była ustawiona
            if (currentValue) {
                select.value = currentValue;
                console.log(`[populateMultiplierSelects] Przywrócono wartość: ${currentValue}`);
            }
            
            // Ustaw domyślną wartość dla partnerów
            if (isPartner && currentClientType && !currentValue) {
                select.value = currentClientType;
                console.log(`[populateMultiplierSelects] Ustawiono domyślną dla partnera: ${currentClientType}`);
            }
        });
    };
    populateMultiplierSelects();

    if (isPartner) {
        document.querySelectorAll('select[data-field="clientType"]').forEach(el => {
            const wrapper = el.closest('.client-type');
            if (wrapper) wrapper.remove();
        });
    }

    productTabs = document.querySelector('.product-tabs');
    quoteFormsContainer = document.querySelector('.quote-forms');
    if (!quoteFormsContainer) {
        quoteFormsContainer = document.createElement('div');
        quoteFormsContainer.className = 'quote-forms';
        const calcMain = document.querySelector('.calculator-main');
        calcMain.insertBefore(quoteFormsContainer, calcMain.firstElementChild);
        const initialQuoteForm = document.querySelector('.quote-form');
        if (initialQuoteForm) quoteFormsContainer.appendChild(initialQuoteForm);
    }

    function updateActiveQuoteForm(index) {
        const forms = quoteFormsContainer.querySelectorAll('.quote-form');
        forms.forEach((form, i) => {
            form.style.display = (i === index) ? 'flex' : 'none';
        });
    }

    function getTabIndex(tab) {
        const tabs = Array.from(productTabs.querySelectorAll('.product-number'));
        const index = tabs.indexOf(tab);
        if (index === -1) {
            console.error("getTabIndex: Tab element not found in product tabs.");
        }
        return index;
    }

    function setActiveTab(clickedTab) {
        productTabs.querySelectorAll('.product-number').forEach(tab => tab.classList.remove('active'));
        clickedTab.classList.add('active');
        const index = getTabIndex(clickedTab);
        updateActiveQuoteForm(index);
        activeQuoteForm = quoteFormsContainer.querySelectorAll('.quote-form')[index];
        dbg("setActiveTab: activeQuoteForm set to index", index);
        attachFormListeners(activeQuoteForm);
        updatePrices();
    }

    const firstTab = productTabs.querySelector('.product-number');
    if (firstTab) setActiveTab(firstTab);

    productTabs.addEventListener('click', e => {
        if (e.target.classList.contains('number')) {
            setActiveTab(e.target.parentElement);
        }
    });

    const addProductBtn = document.querySelector('.add-product');
    addProductBtn.addEventListener('click', () => {
        console.log("[addProduct] Dodaję nowy produkt...");
        
        // Pobierz aktualną grupę cenową z pierwszego formularza
        const firstForm = quoteFormsContainer.querySelector('.quote-form');
        const currentClientType = firstForm?.querySelector('select[data-field="clientType"]')?.value || null;
        
        console.log(`[addProduct] Aktualna grupa cenowa do skopiowania: ${currentClientType}`);

        const productNumbers = productTabs.querySelectorAll('.product-number');
        const newIndex = productNumbers.length + 1;

        const newTab = document.createElement('div');
        newTab.classList.add('product-number');
        newTab.innerHTML = `<button class="number">${newIndex}</button>`;
        const addContainer = productTabs.querySelector('.add-product-container');
        productTabs.insertBefore(newTab, addContainer);
        updateRemoveButtonVisibility();

        const templateForm = quoteFormsContainer.querySelector('.quote-form');
        const newQuoteForm = templateForm.cloneNode(true);

        // POPRAWIONA LOGIKA: Wypełnij opcje dla WSZYSTKICH selectów
        populateMultiplierSelects();
        
        // POTEM ustaw wartość w nowym selecte
        const newClientTypeSelect = newQuoteForm.querySelector('select[data-field="clientType"]');
        if (currentClientType && newClientTypeSelect) {
            // Dodaj opcje do nowego selecta jeśli ich nie ma
            if (newClientTypeSelect.options.length === 0) {
                // Ręcznie wypełnij opcje dla nowego selecta
                const placeholderOption = document.createElement('option');
                placeholderOption.value = '';
                placeholderOption.disabled = true;
                placeholderOption.hidden = true;
                placeholderOption.textContent = 'Wybierz grupę';
                newClientTypeSelect.appendChild(placeholderOption);
                
                Object.entries(multiplierMapping).forEach(([label, value]) => {
                    const option = document.createElement('option');
                    option.value = label;
                    option.textContent = `${label} (${value})`;
                    newClientTypeSelect.appendChild(option);
                });
            }
            
            newClientTypeSelect.value = currentClientType;
            console.log(`[addProduct] Skopiowano grupę cenową: ${currentClientType}`);
        }

        // Resetuj inne pola
        // Resetuj inne pola
        newQuoteForm.querySelectorAll('input').forEach(input => {
            if (input.type === 'radio') {
                input.checked = false;
                input.setAttribute('name', `variantOption-${newIndex - 1}`);
            } else {
                input.value = '';
            }
            input.removeAttribute('id');
        });

        newQuoteForm.querySelectorAll('.variants *').forEach(element => {
            element.style.color = '';
            element.style.backgroundColor = '';
        });

        // Resetuj listenery
        newQuoteForm.dataset.listenersAttached = "";

        // Przygotuj formularz
        prepareNewProductForm(newQuoteForm, newIndex - 1);
        attachFormListeners(newQuoteForm);

        // Dodaj do kontenera
        quoteFormsContainer.appendChild(newQuoteForm);

        // KRYTYCZNE: Ustaw grupę cenową PO dodaniu do DOM-u
        if (currentClientType) {
            // Znajdź select w DOM-ie (już dodanym)
            const selectInDOM = newQuoteForm.querySelector('select[data-field="clientType"]');
            if (selectInDOM) {
                selectInDOM.value = currentClientType;
                console.log(`[addProduct] Ustawiono grupę cenową w DOM: ${currentClientType}`);
                
                // Sprawdź czy się ustawiło
                if (selectInDOM.value === currentClientType) {
                    console.log(`[addProduct] ✅ Grupa cenowa została poprawnie ustawiona: ${selectInDOM.value}`);
                } else {
                    console.log(`[addProduct] ❌ Grupa cenowa NIE została ustawiona. Aktualna wartość: ${selectInDOM.value}`);
                }
            }
        }

        setActiveTab(newTab);

        // Synchronizuj wszystkie formularze
        if (currentClientType) {
            console.log(`[addProduct] Synchronizuję grupę cenową ${currentClientType} na wszystkich produktach`);
            syncClientTypeAcrossProducts(currentClientType, newQuoteForm);
        }
    });
    // NOWA FUNKCJA: Obsługa synchronizacji grup cenowych
    function syncClientTypeAcrossProducts(selectedType, sourceForm) {
        console.log(`[syncClientType] Synchronizuję grupę ${selectedType} na wszystkich produktach`);
        
        // Zaktualizuj zmienne globalne
        currentClientType = selectedType;
        currentMultiplier = multiplierMapping[selectedType] || 1.0;
        
        const allForms = quoteFormsContainer.querySelectorAll('.quote-form');
        allForms.forEach(form => {
            if (form === sourceForm) return; // Pomiń formularz źródłowy
            
            const select = form.querySelector('select[data-field="clientType"]');
            if (select && select.value !== selectedType) {
                select.value = selectedType;
                console.log(`[syncClientType] Zaktualizowano select w formularzu:`, form);
            }
        });
        
        // Przelicz ceny we wszystkich formularzach
        allForms.forEach(form => {
            const tempActive = activeQuoteForm;
            activeQuoteForm = form;
            updatePrices();
            activeQuoteForm = tempActive;
        });
    }

    document.addEventListener('click', e => {
        const removeBtn = e.target.closest('.remove-product');
        if (removeBtn) {
            if (!activeQuoteForm) {
                console.log("Brak aktywnego formularza.");
                return;
            }
            const forms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));
            const index = forms.indexOf(activeQuoteForm);
            if (index === -1) {
                console.log("activeQuoteForm nie jest w tablicy formularzy.");
                return;
            }

            activeQuoteForm.remove();

            const tabs = Array.from(productTabs.querySelectorAll('.product-number'));
            if (tabs[index]) {
                tabs[index].remove();
                console.log("Usunięto zakładkę nr", index + 1);
            }

            productTabs.querySelectorAll('.product-number .number').forEach((btn, idx) => {
                btn.textContent = idx + 1;
            });

            updateRemoveButtonVisibility();

            const remainingTabs = Array.from(productTabs.querySelectorAll('.product-number'));
            let newIndex;
            if (index > 0) newIndex = index - 1;
            else newIndex = 0;

            if (remainingTabs[newIndex]) {
                console.log("Ustawiam aktywny tab nr", newIndex + 1);
                setActiveTab(remainingTabs[newIndex]);
            } else {
                console.log("Brak zakładek do ustawienia jako aktywna.");
            }
        }
    });

    function updateRemoveButtonVisibility() {
        const productNumbers = productTabs.querySelectorAll('.product-number');
        const removeContainer = document.querySelector('.remove-product-container');
        if (!removeContainer) return;
        if (productNumbers.length > 1) {
            removeContainer.style.display = 'flex';
        } else {
            removeContainer.style.display = 'none';
        }
    }
    updateRemoveButtonVisibility();
    updateActiveQuoteForm(0);

    const modalCloseBtn = document.getElementById('modalCloseBtn');
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => {
            const modal = document.getElementById('deliveryModal');
            if (modal) modal.style.display = 'none';
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.style.display = 'none';
        });
    }

    document.addEventListener('click', e => {
        const modal = document.getElementById('deliveryModal');
        if (modal && modal.style.display === 'block' && !modal.contains(e.target)) {
            modal.style.display = 'none';
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.style.display = 'none';
        }
    });

    initEdge3D();
    attachCalculateDeliveryListener();
    loadLatestQuotes();
    initCalculatorDownloadModal();
    attachDownloadModalClose();
    attachDownloadFormatButtons();
    attachLengthValidation();
    attachWidthValidation();
    attachGlobalValidationListeners();
    attachGoToQuoteListeners();

    quoteFormsContainer.querySelectorAll('.quote-form').forEach((form, index) => {
        prepareNewProductForm(form, index);
        attachFormListeners(form);
        calculateFinishingCost(form);
    });

    // NOWA FUNKCJA: Dodaj event listener do synchronizacji grup cenowych
    document.addEventListener('change', e => {
        if (e.target.matches('select[data-field="clientType"]')) {
            const selectedType = e.target.value;
            const sourceForm = e.target.closest('.quote-form');
            
            console.log(`[clientTypeChange] Zmiana grupy cenowej na: ${selectedType}`);
            
            if (selectedType && sourceForm) {
                syncClientTypeAcrossProducts(selectedType, sourceForm);
            }
        }
    });

    window.multiplierMapping = multiplierMapping;
    window.isPartner = isPartner;
    window.userMultiplier = userMultiplier;
    
    console.log("[init] Udostępniono globalne zmienne:", {
        multiplierMapping: window.multiplierMapping,
        isPartner: window.isPartner,
        userMultiplier: window.userMultiplier
    });

}

function initCalculatorDownloadModal() {
    // Spróbuj znaleźć modal z różnymi możliwymi ID
    const modal = document.getElementById("download-modal") ||
        document.getElementById("downloadModal") ||
        document.querySelector(".download-modal");

    // Spróbuj znaleźć różne możliwe elementy
    const closeBtn = document.getElementById("closeDownloadModal") ||
        document.getElementById("close-download-modal") ||
        document.querySelector(".close-download-modal") ||
        modal?.querySelector(".close-modal");

    const iframe = document.getElementById("quotePreview") ||
        document.getElementById("quote-preview") ||
        modal?.querySelector("iframe");

    const downloadPDF = document.getElementById("downloadPDF") ||
        document.getElementById("pdf-btn") ||
        modal?.querySelector(".download-pdf");

    const downloadPNG = document.getElementById("downloadPNG") ||
        document.getElementById("png-btn") ||
        modal?.querySelector(".download-png");

    console.log("[initCalculatorDownloadModal] Znalezione elementy:", {
        modal: !!modal,
        closeBtn: !!closeBtn,
        iframe: !!iframe,
        downloadPDF: !!downloadPDF,
        downloadPNG: !!downloadPNG
    });

    if (!modal) {
        console.warn("[initCalculatorDownloadModal] Nie znaleziono modala pobierania");
        return;
    }

    if (!iframe) {
        console.warn("[initCalculatorDownloadModal] Nie znaleziono iframe w modalu");
        return;
    }

    // NOWA WERSJA - bez nieskończonej pętli
    let currentQuoteToken = null; // ZMIANA: przechowujemy token zamiast ID
    let loadingTimeout = null;
    let isLoadingPdf = false;

    // Event listener dla przycisków pobierz w ostatnich wycenach
    document.addEventListener("click", (e) => {
        const downloadBtn = e.target.closest(".quotes-btn-download");
        if (downloadBtn) {
            e.preventDefault();
            // ZMIANA: Pobieramy token zamiast ID
            const quoteToken = downloadBtn.dataset.token;
            console.log(`[Calculator DownloadModal] Klik dla TOKEN: ${quoteToken}`);

            if (!quoteToken) {
                console.warn("❗️Brak quoteToken – dataset.token undefined!");
                return;
            }

            // Ustaw nowy quote token
            currentQuoteToken = quoteToken;
            isLoadingPdf = true;

            // ZMIANA: Przygotuj URL PDF z tokenem
            const pdfUrl = `/quotes/api/quotes/${quoteToken}/pdf.pdf`;
            console.log(`[Calculator DownloadModal] Ustawianie URL PDF: ${pdfUrl}`);

            // DEBUGOWANIE iframe
            console.log(`[Calculator DownloadModal] iframe attributes:`, {
                id: iframe.id,
                src: iframe.src,
                width: iframe.width,
                height: iframe.height,
                sandbox: iframe.sandbox.toString(),
                loading: iframe.loading,
                name: iframe.name
            });

            // Wyczyść poprzednie timeouty
            if (loadingTimeout) {
                clearTimeout(loadingTimeout);
            }

            // Dodaj loading indicator
            iframe.style.background = "linear-gradient(45deg, #f0f0f0 25%, transparent 25%), linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0f0f0 75%), linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)";
            iframe.style.backgroundSize = "20px 20px";
            iframe.style.backgroundPosition = "0 0, 0 10px, 10px -10px, -10px 0px";
            iframe.style.animation = "loading 1s linear infinite";

            // Ustaw URL PDF w iframe
            iframe.src = pdfUrl;
            console.log(`[Calculator DownloadModal] iframe.src ustawiony na: ${iframe.src}`);

            // DODAJ obserwatora zmian iframe.src
            const srcObserver = setInterval(() => {
                if (isLoadingPdf && currentQuoteToken) {
                    const currentSrc = iframe.src;
                    if (currentSrc && !currentSrc.includes('/pdf.pdf') && !currentSrc.includes('about:blank')) {
                        console.log(`[Calculator DownloadModal] WYKRYTO RESET iframe.src z ${currentSrc} - przywracam PDF`);
                        iframe.src = pdfUrl;
                    }
                } else {
                    clearInterval(srcObserver);
                }
            }, 500);

            // Wyczyść obserwatora po 15 sekundach
            setTimeout(() => {
                clearInterval(srcObserver);
            }, 15000);

            // Backup timeout na ukrycie loadingu (jeśli load event nie zadziała)
            loadingTimeout = setTimeout(() => {
                console.log(`[Calculator DownloadModal] Backup timeout - ukrywam loading po 10 sekundach`);
                iframe.style.background = "none";
                iframe.style.animation = "none";
                isLoadingPdf = false;
            }, 10000); // Zwiększono do 10 sekund

            // ZMIANA: Ustaw token dla przycisków pobierania
            if (downloadPDF) downloadPDF.dataset.token = quoteToken;
            if (downloadPNG) downloadPNG.dataset.token = quoteToken;

            // Pokaż modal
            modal.style.display = "flex";
            modal.classList.add("active");

            console.log(`[Calculator DownloadModal] Modal powinien być widoczny - display: ${modal.style.display}`);
        }
    });

    // Funkcja czyszczenia modala
    function cleanupModal() {
        if (loadingTimeout) {
            clearTimeout(loadingTimeout);
            loadingTimeout = null;
        }
        iframe.src = "";
        iframe.style.background = "none";
        iframe.style.animation = "none";
        currentQuoteToken = null; // ZMIANA: czyszczenie tokenu
        isLoadingPdf = false;

        // Usuń fallback jeśli istnieje
        const fallback = modal.querySelector('.iframe-fallback');
        if (fallback) {
            fallback.remove();
        }
    }

    // Zamykanie modala
    if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
            e.preventDefault();
            modal.style.display = "none";
            modal.classList.remove("active");
            cleanupModal();
            console.log(`[Calculator DownloadModal] Modal zamknięty`);
        });
    }

    // ZMIANA: Pobieranie PDF z tokenem
    if (downloadPDF) {
        downloadPDF.addEventListener("click", (e) => {
            e.preventDefault();
            const quoteToken = downloadPDF.dataset.token || currentQuoteToken;
            if (quoteToken) {
                console.log(`[Calculator DownloadModal] Pobieranie PDF dla TOKEN: ${quoteToken}`);
                const pdfUrl = `/quotes/api/quotes/${quoteToken}/pdf.pdf`;
                window.open(pdfUrl, "_blank");
            }
        });
    }

    // ZMIANA: Pobieranie PNG z tokenem
    if (downloadPNG) {
        downloadPNG.addEventListener("click", (e) => {
            e.preventDefault();
            const quoteToken = downloadPNG.dataset.token || currentQuoteToken;
            if (quoteToken) {
                console.log(`[Calculator DownloadModal] Pobieranie PNG dla TOKEN: ${quoteToken}`);
                const pngUrl = `/quotes/api/quotes/${quoteToken}/pdf.png`;
                window.open(pngUrl, "_blank");
            }
        });
    }

    // Zamykanie przez kliknięcie tła
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.style.display = "none";
            modal.classList.remove("active");
            cleanupModal();
            console.log(`[Calculator DownloadModal] Modal zamknięty przez kliknięcie tła`);
        }
    });

    // POPRAWIONA detekcja ładowania - z ochroną przed resetowaniem
    iframe.addEventListener('load', function handleIframeLoad() {
        console.log(`[Calculator DownloadModal] iframe load event triggered`);
        console.log(`[Calculator DownloadModal] iframe.src: ${iframe.src}`);
        console.log(`[Calculator DownloadModal] isLoadingPdf: ${isLoadingPdf}`);

        // Sprawdź czy to nasze PDF i czy aktualnie ładujemy
        if (isLoadingPdf && iframe.src.includes('/pdf.pdf') && currentQuoteToken) {
            console.log(`[Calculator DownloadModal] PDF załadowany pomyślnie dla TOKEN: ${currentQuoteToken}`);
            iframe.style.background = "none";
            iframe.style.animation = "none";
            isLoadingPdf = false;

            if (loadingTimeout) {
                clearTimeout(loadingTimeout);
                loadingTimeout = null;
            }
        } else if (isLoadingPdf && (iframe.src === window.location.href || iframe.src.includes('/calculator/'))) {
            // Jeśli iframe zostało zresetowane, przywróć PDF URL
            console.log(`[Calculator DownloadModal] iframe zostało zresetowane, przywracam PDF URL`);
            const pdfUrl = `/quotes/api/quotes/${currentQuoteToken}/pdf.pdf`;
            console.log(`[Calculator DownloadModal] Przywracam URL: ${pdfUrl}`);

            // Dodaj krótkie opóźnienie aby uniknąć natychmiastowego ponownego resetu
            setTimeout(() => {
                if (isLoadingPdf && currentQuoteToken) {
                    iframe.src = pdfUrl;
                    console.log(`[Calculator DownloadModal] URL przywrócony: ${iframe.src}`);
                }
            }, 100);
        }
    });

    console.log("[initCalculatorDownloadModal] Modal pobierania zainicjalizowany z obsługą tokenów");
}

/**
 * Funkcja pomocnicza - sprawdza czy iframe się załadował
 */
function checkIframeLoading(iframe, pdfUrl) {
    try {
        // Sprawdź czy iframe wydaje się pusty
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;

        if (!iframeDoc || iframeDoc.body.children.length === 0 ||
            iframeDoc.body.innerHTML.trim() === '' ||
            iframeDoc.documentElement.innerHTML.includes('error') ||
            iframeDoc.documentElement.innerHTML.includes('404')) {

            console.log(`[Calculator DownloadModal] iframe wydaje się pusty lub z błędem, pokazuję fallback`);
            showIframeFallback(iframe, pdfUrl);
        } else {
            console.log(`[Calculator DownloadModal] iframe wydaje się załadowany poprawnie`);
        }
    } catch (e) {
        console.log(`[Calculator DownloadModal] Nie można sprawdzić zawartości iframe (CORS), assumuje że działa:`, e);
        // W przypadku CORS nie możemy sprawdzić zawartości, więc zakładamy że działa
    }
}

/**
 * Funkcja pomocnicza - pokazuje fallback gdy iframe nie działa
 */
function showIframeFallback(iframe, pdfUrl) {
    console.log(`[Calculator DownloadModal] Pokazuję fallback dla PDF`);

    // Usuń poprzedni fallback jeśli istnieje
    const existingFallback = iframe.parentNode.querySelector('.iframe-fallback');
    if (existingFallback) {
        existingFallback.remove();
    }

    // Ukryj iframe
    iframe.style.display = 'none';

    // Utwórz fallback
    const fallbackDiv = document.createElement('div');
    fallbackDiv.className = 'iframe-fallback';
    fallbackDiv.style.cssText = `
        text-align: center; 
        padding: 50px; 
        background: #f9f9f9; 
        border: 2px dashed #ccc; 
        border-radius: 8px;
        height: 700px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    `;

    fallbackDiv.innerHTML = `
        <div style="max-width: 400px;">
            <svg style="width: 64px; height: 64px; margin-bottom: 20px; fill: #ED6B24;" viewBox="0 0 24 24">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
            </svg>
            <h3 style="color: #333; margin-bottom: 15px;">Podgląd wyceny PDF</h3>
            <p style="color: #666; margin-bottom: 25px; line-height: 1.4;">
                Nie można wyświetlić podglądu PDF w przeglądarce.<br>
                Kliknij poniżej aby otworzyć plik w nowej karcie.
            </p>
            <a href="${pdfUrl}" target="_blank" style="
                background: #ED6B24; 
                color: white; 
                padding: 12px 24px; 
                text-decoration: none; 
                border-radius: 6px;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-weight: 500;
                transition: background 0.2s;
            " onmouseover="this.style.background='#d85d20'" onmouseout="this.style.background='#ED6B24'">
                <svg style="width: 16px; height: 16px; fill: currentColor;" viewBox="0 0 24 24">
                    <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z"/>
                </svg>
                Otwórz PDF w nowej karcie
            </a>
        </div>
    `;

    // Wstaw fallback po iframe
    iframe.parentNode.insertBefore(fallbackDiv, iframe.nextSibling);
}

document.addEventListener('DOMContentLoaded', init);

window.calculateFinishingCost = calculateFinishingCost;

/**
 * Przekierowuje do modułu quotes i otwiera modal szczegółów wyceny
 * @param {number} quoteId - ID wyceny
 */
function redirectToQuoteDetails(quoteId) {
    console.log(`[redirectToQuoteDetails] Przekierowanie do wyceny ID: ${quoteId}`);
    
    if (!quoteId) {
        console.error("[redirectToQuoteDetails] Brak ID wyceny");
        return;
    }
    
    // Zapisz ID wyceny w sessionStorage, aby móc ją otworzyć po załadowaniu strony
    sessionStorage.setItem('openQuoteModal', quoteId);
    
    // Przekieruj do modułu quotes
    window.location.href = '/quotes/';
}

/**
 * Przekierowuje do modułu quotes na podstawie numeru wyceny
 * @param {string} quoteNumber - Numer wyceny (np. "01/12/24/W")
 */
function redirectToQuoteDetailsByNumber(quoteNumber) {
    console.log(`[redirectToQuoteDetailsByNumber] Przekierowanie do wyceny: ${quoteNumber}`);
    
    if (!quoteNumber) {
        console.error("[redirectToQuoteDetailsByNumber] Brak numeru wyceny");
        return;
    }
    
    // Zapisz numer wyceny w sessionStorage
    sessionStorage.setItem('openQuoteModalByNumber', quoteNumber);
    
    // Przekieruj do modułu quotes
    window.location.href = '/quotes/';
}

/**
 * Funkcja do obsługi przycisku "Przejdź" w modalu sukcesu zapisu wyceny
 */
function handleGoToQuoteFromModal() {
    const quoteNumberDisplay = document.querySelector('.quote-number-display');
    
    if (!quoteNumberDisplay || !quoteNumberDisplay.textContent) {
        console.error("[handleGoToQuoteFromModal] Brak numeru wyceny w modalu");
        alert("Błąd: nie znaleziono numeru wyceny");
        return;
    }
    
    const quoteNumber = quoteNumberDisplay.textContent.trim();
    console.log(`[handleGoToQuoteFromModal] Przechodzę do wyceny: ${quoteNumber}`);
    
    redirectToQuoteDetailsByNumber(quoteNumber);
}

/**
 * Dodaj obsługę przycisków "Przejdź" w ostatnich wycenach
 */
function attachGoToQuoteListeners() {
    // Delegacja eventów dla przycisków "Przejdź" w ostatnich wycenach
    const latestQuotesList = document.getElementById('latestQuotesList');
    
    if (latestQuotesList) {
        latestQuotesList.addEventListener('click', (e) => {
            if (e.target.classList.contains('go-ahead')) {
                e.preventDefault();
                const quoteId = e.target.dataset.id;
                
                if (quoteId) {
                    console.log(`[latestQuotes] Przechodzę do wyceny ID: ${quoteId}`);
                    redirectToQuoteDetails(parseInt(quoteId));
                } else {
                    console.error("[latestQuotes] Brak ID wyceny w data-id");
                }
            }
        });
    }
}

/**
 * Modernizowany modal opcji dostawy
 * Obsługuje paginację, własnych kurierów i lepsze UX
 */

class DeliveryModal {
    constructor() {
        this.modal = null;
        this.quotes = [];
        this.currentPage = 1;
        this.itemsPerPage = 8;
        this.selectedOption = null;
        this.customCarrier = null;
        this.isCustomMode = false;
        this.VAT_RATE = 0.23;
        this.MARGIN_RATE = 0.30;
        
        this.init();
    }

    init() {
        this.modal = document.getElementById('deliveryModal');
        if (!this.modal) {
            console.error('Delivery modal not found');
            return;
        }

        this.bindEvents();
    }

    bindEvents() {
        // Zamknięcie modala
        const closeBtn = document.getElementById('deliveryModalClose');
        const cancelBtn = document.getElementById('deliveryModalCancel');
        
        closeBtn?.addEventListener('click', () => this.hide());
        cancelBtn?.addEventListener('click', () => this.hide());
        
        // Zamknięcie przez kliknięcie w tło
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hide();
            }
        });

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.classList.contains('active')) {
                this.hide();
            }
        });

        // Przycisk dodania własnego kuriera
        const addCustomBtn = document.getElementById('addCustomCarrier');
        addCustomBtn?.addEventListener('click', () => this.showCustomForm());

        // Powrót do listy
        const backBtn = document.getElementById('backToDeliveryList');
        backBtn?.addEventListener('click', () => this.showMainView());

        // Paginacja
        const prevBtn = document.getElementById('deliveryPrevPage');
        const nextBtn = document.getElementById('deliveryNextPage');
        
        prevBtn?.addEventListener('click', () => this.goToPreviousPage());
        nextBtn?.addEventListener('click', () => this.goToNextPage());

        // Formularz własnego kuriera
        this.bindCustomFormEvents();

        // Potwierdzenie wyboru
        const confirmBtn = document.getElementById('deliveryModalConfirm');
        confirmBtn?.addEventListener('click', () => this.confirmSelection());
    }

    bindCustomFormEvents() {
        const nettoInput = document.getElementById('customCarrierNetto');
        const bruttoInput = document.getElementById('customCarrierBrutto');
        const nameInput = document.getElementById('customCarrierName');

        // Auto-kalkulacja netto <-> brutto
        nettoInput?.addEventListener('input', (e) => {
            const netto = parseFloat(e.target.value) || 0;
            const brutto = netto * (1 + this.VAT_RATE);
            bruttoInput.value = brutto.toFixed(2);
            this.updateCalculator(brutto);
            this.validateCustomForm();
        });

        bruttoInput?.addEventListener('input', (e) => {
            const brutto = parseFloat(e.target.value) || 0;
            const netto = brutto / (1 + this.VAT_RATE);
            nettoInput.value = netto.toFixed(2);
            this.updateCalculator(brutto);
            this.validateCustomForm();
        });

        nameInput?.addEventListener('input', () => {
            this.validateCustomForm();
        });
    }

    show(quotes, packingInfo = null) {
        this.quotes = quotes || [];
        this.currentPage = 1;
        this.selectedOption = null;
        this.customCarrier = null;

        // Sortuj opcje po cenie
        this.quotes.sort((a, b) => (a.grossPrice || 0) - (b.grossPrice || 0));

        this.showMainView();
        this.renderOptions();
        this.updatePackingInfo(packingInfo);
        this.updateConfirmButton();

        // Pokaż modal z animacją
        this.modal.style.display = 'flex';
        requestAnimationFrame(() => {
            this.modal.classList.add('active');
        });
    }

    hide() {
        this.modal.classList.remove('active');
        setTimeout(() => {
            this.modal.style.display = 'none';
        }, 300);
    }

    showError(message) {
        this.hideAllStates();
        
        const errorEl = document.getElementById('deliveryError');
        const errorMsgEl = document.getElementById('deliveryErrorMessage');
        
        if (errorEl && errorMsgEl) {
            errorMsgEl.textContent = message;
            errorEl.classList.remove('delivery-modal-hidden');
        }

        this.updateConfirmButton();
    }

    showMainView() {
        this.isCustomMode = false;
        
        const mainView = document.getElementById('deliveryMainView');
        const customView = document.getElementById('deliveryCustomView');
        
        if (mainView) {
            mainView.classList.remove('delivery-modal-hidden');
        }
        
        if (customView) {
            customView.classList.add('delivery-modal-hidden');
            customView.style.display = 'none';
        }
        
        // Aktualizuj tytuł
        const title = document.querySelector('.delivery-modal-title');
        if (title) {
            title.textContent = 'Wybierz sposób dostawy';
        }

        this.updateConfirmButton();
    }

    showCustomForm() {
        this.isCustomMode = true;
        
        // ✅ POPRAWKA: Ukryj główny widok i pokaż formularz
        const mainView = document.getElementById('deliveryMainView');
        const customView = document.getElementById('deliveryCustomView');
        
        if (mainView) {
            mainView.classList.add('delivery-modal-hidden');
        }
        
        if (customView) {
            customView.classList.remove('delivery-modal-hidden');
            customView.style.display = 'block';  // ✅ DODAJ to!
            // LUB dodaj klasę active:
            // customView.classList.add('active');
        }
        
        // Aktualizuj tytuł
        const title = document.querySelector('.delivery-modal-title');
        if (title) {
            title.textContent = 'Dodaj własnego kuriera';
        }

        // Wyczyść formularz
        const nameInput = document.getElementById('customCarrierName');
        const nettoInput = document.getElementById('customCarrierNetto');
        const bruttoInput = document.getElementById('customCarrierBrutto');
        
        if (nameInput) nameInput.value = '';
        if (nettoInput) nettoInput.value = '';
        if (bruttoInput) bruttoInput.value = '';
        
        this.updateCalculator(0);
        
        this.selectedOption = null;
        this.customCarrier = null;
        this.updateConfirmButton();
    }

    renderOptions() {
        if (this.quotes.length === 0) {
            this.showEmptyState();
            return;
        }

        this.hideAllStates();
        
        const listEl = document.getElementById('deliveryOptionsList');
        if (!listEl) return;

        // Oblicz paginację
        const totalPages = Math.ceil(this.quotes.length / this.itemsPerPage);
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const currentQuotes = this.quotes.slice(startIndex, endIndex);

        // Wyczyść listę
        listEl.innerHTML = '';

        // Renderuj opcje
        currentQuotes.forEach((quote, index) => {
            const optionEl = this.createOptionElement(quote, startIndex + index);
            listEl.appendChild(optionEl);
        });

        // Aktualizuj paginację
        this.updatePagination(totalPages);

        // Pokaż listę
        document.getElementById('deliveryOptionsList').classList.remove('delivery-modal-hidden');
    }

    createOptionElement(quote, index) {
        const div = document.createElement('div');
        div.className = 'delivery-modal-option';
        div.dataset.index = index;

        const radioId = `delivery-option-${index}`;
        
        div.innerHTML = `
            <input type="radio" 
                name="deliveryOption" 
                id="${radioId}"
                value="${quote.carrierName}" 
                data-gross="${quote.grossPrice}" 
                data-net="${quote.netPrice}"
                data-raw-gross="${quote.rawGrossPrice || quote.grossPrice}"
                data-raw-net="${quote.rawNetPrice || quote.netPrice}">
            
            <div class="delivery-modal-name-container">
                <img src="${quote.carrierLogoLink || '/static/images/default-carrier.png'}" 
                    class="delivery-modal-logo" 
                    alt="${quote.carrierName} logo"
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

        // Event listenery
        const radio = div.querySelector('input[type="radio"]');
        
        div.addEventListener('click', () => {
            if (radio && !radio.checked) {
                radio.checked = true;
                this.selectOption(quote, index);
            }
        });

        radio.addEventListener('change', () => {
            if (radio.checked) {
                this.selectOption(quote, index);
            }
        });

        return div;
    }

    selectOption(quote, index) {
        // Usuń poprzednie zaznaczenie
        document.querySelectorAll('.delivery-modal-option').forEach(el => {
            el.classList.remove('selected');
        });

        // Zaznacz nową opcję
        const optionEl = document.querySelector(`[data-index="${index}"]`);
        if (optionEl) {
            optionEl.classList.add('selected');
        }

        this.selectedOption = {
            carrierName: quote.carrierName,
            grossPrice: quote.grossPrice,
            netPrice: quote.netPrice,
            rawGrossPrice: quote.rawGrossPrice || quote.grossPrice,
            rawNetPrice: quote.rawNetPrice || quote.netPrice,
            carrierLogoLink: quote.carrierLogoLink,
            type: 'api'
        };

        this.customCarrier = null;
        this.updateConfirmButton();
    }

    updatePagination(totalPages) {
        const paginationEl = document.getElementById('deliveryPagination');
        const prevBtn = document.getElementById('deliveryPrevPage');
        const nextBtn = document.getElementById('deliveryNextPage');
        const pageNumbersEl = document.getElementById('deliveryPageNumbers');

        if (!paginationEl) return;

        // Pokaż/ukryj paginację
        if (totalPages <= 1) {
            paginationEl.classList.add('delivery-modal-hidden');
            return;
        }

        paginationEl.classList.remove('delivery-modal-hidden');

        // Aktualizuj przyciski
        if (prevBtn) {
            prevBtn.disabled = this.currentPage <= 1;
        }
        if (nextBtn) {
            nextBtn.disabled = this.currentPage >= totalPages;
        }

        // Generuj numery stron
        if (pageNumbersEl) {
            pageNumbersEl.innerHTML = '';
            
            for (let i = 1; i <= totalPages; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = 'delivery-modal-page-btn';
                pageBtn.textContent = i;
                pageBtn.dataset.page = i;
                
                if (i === this.currentPage) {
                    pageBtn.classList.add('active');
                }

                pageBtn.addEventListener('click', () => {
                    this.goToPage(i);
                });

                pageNumbersEl.appendChild(pageBtn);
            }
        }
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.quotes.length / this.itemsPerPage);
        if (page < 1 || page > totalPages) return;

        this.currentPage = page;
        this.renderOptions();
    }

    goToPreviousPage() {
        this.goToPage(this.currentPage - 1);
    }

    goToNextPage() {
        this.goToPage(this.currentPage + 1);
    }

    updateCalculator(bruttoAmount) {
        const baseBruttoEl = document.getElementById('calcBaseBrutto');
        const marginEl = document.getElementById('calcMargin');
        const finalPriceEl = document.getElementById('calcFinalPrice');

        if (!baseBruttoEl || !marginEl || !finalPriceEl) return;

        const margin = bruttoAmount * this.MARGIN_RATE;
        const finalPrice = bruttoAmount + margin;

        baseBruttoEl.textContent = `${bruttoAmount.toFixed(2)} PLN`;
        marginEl.textContent = `${margin.toFixed(2)} PLN`;
        finalPriceEl.textContent = `${finalPrice.toFixed(2)} PLN`;
    }

    validateCustomForm() {
        const nameInput = document.getElementById('customCarrierName');
        const nettoInput = document.getElementById('customCarrierNetto');
        const bruttoInput = document.getElementById('customCarrierBrutto');

        if (!nameInput || !nettoInput || !bruttoInput) return false;

        const name = nameInput.value.trim();
        const netto = parseFloat(nettoInput.value) || 0;
        const brutto = parseFloat(bruttoInput.value) || 0;

        // Resetuj style błędów
        [nameInput, nettoInput, bruttoInput].forEach(input => {
            input.classList.remove('error');
        });

        let isValid = true;

        // Walidacja nazwy
        if (!name) {
            nameInput.classList.add('error');
            isValid = false;
        }

        // Walidacja kwot
        if (netto <= 0 || brutto <= 0) {
            if (netto <= 0) nettoInput.classList.add('error');
            if (brutto <= 0) bruttoInput.classList.add('error');
            isValid = false;
        }

        if (isValid) {
            // Oblicz końcową cenę z marżą
            const finalPrice = brutto * (1 + this.MARGIN_RATE);
            
            this.customCarrier = {
                carrierName: name,
                grossPrice: finalPrice,
                netPrice: finalPrice / (1 + this.VAT_RATE),
                rawGrossPrice: brutto,
                rawNetPrice: netto,
                type: 'custom'
            };
        } else {
            this.customCarrier = null;
        }

        this.updateConfirmButton();
        return isValid;
    }

    updateConfirmButton() {
        const confirmBtn = document.getElementById('deliveryModalConfirm');
        const confirmText = document.getElementById('deliveryConfirmText');
        
        if (!confirmBtn || !confirmText) return;

        const hasSelection = this.selectedOption || this.customCarrier;
        
        confirmBtn.disabled = !hasSelection;
        
        if (this.isCustomMode) {
            confirmText.textContent = this.customCarrier ? 'Dodaj kuriera' : 'Uzupełnij dane';
        } else {
            confirmText.textContent = this.selectedOption ? 'Zapisz' : 'Zapisz';
        }
    }

    updatePackingInfo(packingInfo) {
        const packingInfoEl = document.getElementById('deliveryPackingInfo');
        const headerAdjustedEl = document.getElementById('deliveryHeaderAdjusted');
        
        if (packingInfo && packingInfoEl) {
            const percent = Math.round((packingInfo.multiplier - 1) * 100);
            packingInfoEl.innerHTML = `ℹ️ ${packingInfo.message || `Do cen wysyłki została doliczona kwota ${percent}% na pakowanie.`}`;
            packingInfoEl.classList.remove('delivery-modal-hidden');
            
            if (headerAdjustedEl) {
                headerAdjustedEl.textContent = `Cena + ${percent}%`;
            }
        } else {
            packingInfoEl?.classList.add('delivery-modal-hidden');
        }
    }

    hideAllStates() {
        const states = ['deliveryLoading', 'deliveryEmpty', 'deliveryError'];
        states.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('delivery-modal-hidden');
        });
    }

    showEmptyState() {
        this.hideAllStates();
        const emptyEl = document.getElementById('deliveryEmpty');
        if (emptyEl) {
            emptyEl.classList.remove('delivery-modal-hidden');
        }
        this.updateConfirmButton();
    }

    showLoadingState() {
        this.hideAllStates();
        const loadingEl = document.getElementById('deliveryLoading');
        if (loadingEl) {
            loadingEl.classList.remove('delivery-modal-hidden');
        }
    }

    confirmSelection() {
        const selection = this.isCustomMode ? this.customCarrier : this.selectedOption;
        
        if (!selection) {
            alert('Proszę wybrać opcję dostawy lub uzupełnić dane własnego kuriera.');
            return;
        }

        // Wywołaj callback lub event
        this.onSelectionConfirmed(selection);
        this.hide();
    }

    onSelectionConfirmed(selection) {
        // Ta metoda powinna być nadpisana lub można dodać event listener
        console.log('Wybrano opcję dostawy:', selection);
        
        // Kompatybilność z istniejącym kodem
        if (typeof window.handleDeliverySelection === 'function') {
            window.handleDeliverySelection(selection);
        }
        
        // Wywołaj event
        const event = new CustomEvent('deliverySelected', {
            detail: selection
        });
        document.dispatchEvent(event);
    }
}

// Inicjalizacja
let deliveryModalInstance = null;

// Funkcje kompatybilności z istniejącym kodem
function showDeliveryModal(quotes, packingInfo = null) {
    if (!deliveryModalInstance) {
        deliveryModalInstance = new DeliveryModal();
    }
    
    // Przekształć dane do nowego formatu jeśli potrzeba
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
    deliveryModalInstance.showError(errorMessage);
}

// Event listener dla backward compatibility
document.addEventListener('deliverySelected', (event) => {
    const selection = event.detail;
    
    // Kompatybilność z istniejącym kodem calculator.js
    if (typeof updateDeliverySelection === 'function') {
        updateDeliverySelection(selection);
    }
});

// Auto-inicjalizacja gdy DOM jest gotowy
document.addEventListener('DOMContentLoaded', () => {
    if (!deliveryModalInstance) {
        deliveryModalInstance = new DeliveryModal();
    }
});