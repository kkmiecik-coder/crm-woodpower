console.log("calculator.js załadowany!");
// global edge‑settings and 3D root handle
window.edgeSettings = {};
let edge3dRoot = null;

const { createRoot } = ReactDOM;

// Globalne deklaracje, aby były widoczne we wszystkich częściach skryptu
let quoteFormsContainer = null;
let activeQuoteForm = null;
let productTabs = null; // Dodana globalna zmienna dla zakładek produktów

document.addEventListener('DOMContentLoaded', function () {
    console.log("DOMContentLoaded in calculator.js");
    function prepareNewProductForm(form, index) {
        // Ustawiamy nowe ID i name dla wariantów
        const variantRadios = form.querySelectorAll('.variants input[type="radio"]');
        variantRadios.forEach((radio, i) => {
            const oldId = radio.id; // ⬅️ zapamiętujemy stare ID zanim je zmienimy
            const baseId = radio.value;
            const newId = `${baseId}-${index}`;
            const label = form.querySelector(`label[for="${oldId}"]`); // ⬅️ szukamy labela po starym ID

            radio.id = newId;
            radio.name = `variantOption-${index}`;
            radio.checked = false;

            if (label) {
                label.setAttribute('for', newId);
            }
        });

        // Usunięcie klas .active z przycisków wykończenia
        form.querySelectorAll('.finishing-btn.active').forEach(btn => btn.classList.remove('active'));

        // Zaznaczenie domyślnie "Brak"
        const defaultFinishing = form.querySelector('.finishing-btn[data-finishing-type="Brak"]');
        if (defaultFinishing) {
            defaultFinishing.classList.add('active');
        }

        // Ukrycie sekcji koloru i połysku
        form.querySelectorAll('.finishing-colors, .finishing-gloss').forEach(el => {
            el.style.display = 'none';
        });

        // Zerowanie danych produktu
        form.dataset.orderBrutto = '';
        form.dataset.orderNetto = '';
        form.dataset.finishingType = 'Brak';
        form.dataset.finishingBrutto = '';
        form.dataset.finishingNetto = '';

        // Zresetowanie wartości inputów
        form.querySelectorAll('input[data-field]').forEach(input => input.value = '');
        form.querySelectorAll('select[data-field]').forEach(select => select.selectedIndex = 0);

        // Usunięcie zaznaczenia opcji wykończenia
        form.querySelectorAll('.variants span').forEach(span => {
            const isHeader = span.classList.contains('header-title') ||
                span.classList.contains('header-unit-brutto') ||
                span.classList.contains('header-unit-netto') ||
                span.classList.contains('header-total-brutto') ||
                span.classList.contains('header-total-netto');

            if (!span.classList.contains('out-of-stock-tag') && !isHeader) {
                span.textContent = '---.-- PLN';
            }
        });

        // Usunięcie zaznaczenia wyboru wariantu
        form.querySelectorAll('.variants div').forEach(variant => {
            variant.style.backgroundColor = '';
            variant.querySelectorAll('*').forEach(el => el.style.color = '');
        });

        // Zaktualizuj dane przycisków (jeśli trzeba)
        updateCalculateDeliveryButtonState();
    }

    // Ensure the overlay is hidden on page load
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none'; // Explicitly hide the overlay
    }

    // Pobranie danych z osadzonego tagu <script id="prices-data">
    const pricesDataEl = document.getElementById('prices-data');
    if (!pricesDataEl) {
        console.error("Brak elementu #prices-data");
        return;
    }
    const pricesFromDatabase = JSON.parse(pricesDataEl.textContent);
    console.log("Dane cennika:", pricesFromDatabase);

    // Odczytaj rolę i mnożnik użytkownika
    const userRole = document.body.dataset.role;
    const userMultiplier = parseFloat(document.body.dataset.multiplier || "1.0");
    const isPartner = userRole === "partner";

    console.log("Rola użytkownika:", userRole);
    console.log("Mnożnik użytkownika:", userMultiplier);

    // Pobranie mnożników z osadzonego tagu <script id="multipliers-data">
    const multipliersDataEl = document.getElementById('multipliers-data');
    const multiplierMapping = {};

    if (multipliersDataEl) {
        const multipliersFromDB = JSON.parse(multipliersDataEl.textContent);
        multipliersFromDB.forEach(m => {
            multiplierMapping[m.label] = m.value;
        });
        console.log("Pobrane mnożniki:", multiplierMapping);
    } else {
        console.warn("Brak #multipliers-data – nie załadowano mnożników.");
    }

    const populateMultiplierSelects = () => {
        const selects = document.querySelectorAll('select[data-field="clientType"]');
        selects.forEach(select => {
            select.innerHTML = '<option value="" disabled selected hidden>Wybierz grupę</option>';
            Object.entries(multiplierMapping).forEach(([label, value]) => {
                const option = document.createElement('option');
                option.value = label;
                option.textContent = `${label} (${value})`;
                select.appendChild(option);
            });
        });
    };

    populateMultiplierSelects();
    if (isPartner) {
        document.querySelectorAll('select[data-field="clientType"]').forEach(el => {
            const wrapper = el.closest('.client-type');
            if (wrapper) wrapper.remove();
        });
    }

    // Mapping wariantów – odpowiadający wartościom input radio
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

    const inputFields = ['length', 'width', 'thickness', 'quantity'];
    const variantSelectors = document.querySelectorAll('.variants div');
    console.log("Liczba wariantów znalezionych:", variantSelectors.length);

    // Funkcja obliczająca objętość pojedynczego produktu (m³)
    function calculateSingleVolume(length, width, thickness) {
        const vol = (length / 100) * (width / 100) * (thickness / 100);
        return vol;
    }

    // Formatujemy wartość do formatu PLN
    function formatPLN(value) {
        return value.toFixed(2) + ' PLN';
    }

    // Zaokrąglamy wartość do podanego kroku (domyślnie 1)
    function roundUp(value, step = 1) {
        return Math.ceil(value / step) * step;
    }

    // Funkcja wyszukująca cenę z cennika dla danego wariantu, na podstawie wymiarów produktu
    function getPrice(species, technology, wood_class, thickness, length) {
        const roundedThickness = roundUp(thickness, 0.1);
        const roundedLength = roundUp(length, 1);
        const found = pricesFromDatabase.find(entry =>
            entry.species === species &&
            entry.technology === technology &&
            entry.wood_class === wood_class &&
            roundedThickness >= entry.thickness_min &&
            roundedThickness <= entry.thickness_max &&
            roundedLength >= entry.length_min &&
            roundedLength <= entry.length_max
        );
        return found;
    }

    // NEW: Attach input and select listeners to a form if not already attached
    function attachFormListeners(form) {
        if (!form || form.dataset.listenersAttached) return;

        // Listener dla inputów z atrybutem data-field
        form.querySelectorAll('input[data-field]').forEach(input => {
            input.addEventListener('input', updatePrices);
        });

        // Listener dla wszystkich radio buttonów w formularzu
        form.querySelectorAll('input[type="radio"]').forEach(radio => {
            radio.addEventListener('change', updatePrices);
        });

        // Listener dla selecta typu clientType (jeśli istnieje)
        const clientTypeSelect = form.querySelector('select[data-field="clientType"]');
        if (clientTypeSelect) {
            clientTypeSelect.addEventListener('change', updatePrices);
        }

        attachFinishingListenersToForm(form);
        attachFinishingUIListeners(form);
        form.dataset.listenersAttached = "true";
    }

    // Funkcja aktualizująca ceny – wywoływana przy zmianie danych wejściowych
    function updatePrices() {
        if (!activeQuoteForm) return;
        const lengthEl = activeQuoteForm.querySelector('input[data-field="length"]');
        const widthEl = activeQuoteForm.querySelector('input[data-field="width"]');
        const thicknessEl = activeQuoteForm.querySelector('input[data-field="thickness"]');
        const quantityEl = activeQuoteForm.querySelector('input[data-field="quantity"]');
        if (!lengthEl || !widthEl || !thicknessEl || !quantityEl) return;

        const length = parseFloat(lengthEl.value);
        const width = parseFloat(widthEl.value);
        const thickness = parseFloat(thicknessEl.value);
        let quantity = parseInt(quantityEl.value);
        if (isNaN(quantity)) {
            quantity = 1;
            quantityEl.value = 1;
        }

        // Pobranie selecta i jego wartości
        const clientTypeEl = activeQuoteForm.querySelector('select[data-field="clientType"]');
        const clientType = clientTypeEl ? clientTypeEl.value : "";
        console.log("Debug: clientType =", clientType);

        // Sprawdzanie poprawności danych – dodanie/ usunięcie klasy error-outline
        if (clientTypeEl) {
            if (!clientType) {
                clientTypeEl.classList.add('error-outline');
            } else {
                clientTypeEl.classList.remove('error-outline');
            }
        }
        if (lengthEl) {
            if (isNaN(length)) {
                lengthEl.classList.add('error-outline');
            } else {
                lengthEl.classList.remove('error-outline');
            }
        }
        if (widthEl) {
            if (isNaN(width)) {
                widthEl.classList.add('error-outline');
            } else {
                widthEl.classList.remove('error-outline');
            }
        }
        if (thicknessEl) {
            if (isNaN(thickness)) {
                thicknessEl.classList.add('error-outline');
            } else {
                thicknessEl.classList.remove('error-outline');
            }
        }
        if (quantityEl) {
            if (isNaN(quantity)) {
                quantityEl.classList.add('error-outline');
            } else {
                quantityEl.classList.remove('error-outline');
            }
        }

        let multiplierAdjusted = false;
        let multiplier = 1.0;
        console.log("Debug: Czy partner? isPartner =", isPartner, "userMultiplier =", userMultiplier);
        let errorMsg = "";

        // Ustalenie mnożnika w zależności od roli
        if (isPartner) {
            multiplier = userMultiplier;
        } else {
            if (!clientType) {
                errorMsg = "Brak grupy";
            } else {
                multiplier = multiplierMapping[clientType] || 1.0;
            }
        }
        console.log("Debug: Finalny multiplier =", multiplier);

        // Przerwanie działania tylko dla zwykłego usera, jeśli nie wybrał grupy
        if (!isPartner && errorMsg) {
            return;
        }

        // Sprawdzanie poprawności pozostałych danych
        if (isNaN(length)) {
            errorMsg = "Brak dług.";
        } else if (isNaN(width)) {
            errorMsg = "Brak szer.";
        } else if (isNaN(thickness)) {
            errorMsg = "Brak grub.";
        }

        const variantContainer = activeQuoteForm.querySelector('.variants');
        if (errorMsg) {
            variantContainer.querySelectorAll('div').forEach(variant => {
                ['.unit-brutto', '.unit-netto', '.total-brutto', '.total-netto'].forEach(sel => {
                    const span = variant.querySelector(sel);
                    if (span) span.textContent = errorMsg;
                });
            });
            // Czyszczenie danych zamówienia, aby updateGlobalSummary ustawiło "Wybierz opcje"
            activeQuoteForm.dataset.orderBrutto = "";
            activeQuoteForm.dataset.orderNetto = "";
            updateGlobalSummary(); // Aktualizujemy podsumowanie nawet przy błędzie
            return;
        }

        const singleVolume = calculateSingleVolume(length, width, thickness);
        const activeVariantSelectors = Array.from(variantContainer.children)
            .filter(child => child.querySelector('input[type="radio"]'));
        activeVariantSelectors.forEach(variant => {
            const radio = variant.querySelector('input[type="radio"]');
            if (!radio) {
                console.warn("Brak input radio w wariancie:", variant);
                return;
            }
            const id = radio.value;
            const config = variantMapping[id];
            if (!config) {
                console.warn("Brak mappingu dla wariantu:", id);
                return;
            }
            const match = getPrice(config.species, config.technology, config.wood_class, thickness, length);
            const unitBruttoSpan = variant.querySelector('.unit-brutto');
            const unitNettoSpan = variant.querySelector('.unit-netto');
            const totalBruttoSpan = variant.querySelector('.total-brutto');
            const totalNettoSpan = variant.querySelector('.total-netto');
            if (match && unitBruttoSpan && unitNettoSpan && totalBruttoSpan && totalNettoSpan) {
                const basePrice = match.price_per_m3;
                console.log(`Debug: basePrice = ${basePrice}, volume = ${singleVolume}, multiplier = ${multiplier}`);
                let effectiveMultiplier = multiplier;
                let unitNetto = singleVolume * basePrice * effectiveMultiplier;
                if (clientType === "Detal" && unitNetto < 1000) {
                    effectiveMultiplier = 1.5;
                    multiplierAdjusted = true;
                    unitNetto = singleVolume * basePrice * effectiveMultiplier;
                    variant.style.backgroundColor = "#FFECEC";
                } else {
                    variant.style.backgroundColor = "";
                }
                const unitBrutto = unitNetto * 1.23;
                const totalNetto = unitNetto * quantity;
                const totalBrutto = unitBrutto * quantity;
                radio.dataset.totalNetto = totalNetto;
                console.log(`Przypisuję totalNetto=${totalNetto} do wariantu ${id}`);
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
            console.error("updatePrices: Invalid tabIndex. Skipping further execution.");
            return;
        }

        const groupRadios = activeQuoteForm.querySelectorAll(`input[name^="variantOption-${tabIndex}"], input[name^="selected-${tabIndex}"]`);
        groupRadios.forEach(radio => {
            if (radio.checked) {
                radio.name = `selected-${tabIndex}`;
            } else {
                radio.name = `variantOption-${tabIndex}`;
            }
            console.log("updatePrices: Updated radio", radio.id, "name =", radio.name);
        });

        const expectedName = `selected-${tabIndex}`;
        const selectedRadio = activeQuoteForm.querySelector(`input[name="${expectedName}"]:checked`);
        activeVariantSelectors.forEach(variant => {
            variant.querySelectorAll('*').forEach(element => {
                element.style.color = "";
            });
        });

        if (selectedRadio && selectedRadio.dataset.totalBrutto && selectedRadio.dataset.totalNetto) {
            activeQuoteForm.dataset.orderBrutto = selectedRadio.dataset.totalBrutto;
            activeQuoteForm.dataset.orderNetto = selectedRadio.dataset.totalNetto;
            const selectedVariant = selectedRadio.closest('div');
            if (selectedVariant) {
                selectedVariant.querySelectorAll('*').forEach(element => {
                    element.style.color = "#ED6B24";
                });
            }
        } else {
            activeQuoteForm.dataset.orderBrutto = "";
            activeQuoteForm.dataset.orderNetto = "";
        }
        const msgEl = activeQuoteForm.querySelector('.multiplier-message');
        if (msgEl) {
            if (multiplierAdjusted) {
                msgEl.textContent = "Zmieniono mnożnik dla niektórych wariantów.";
                msgEl.style.color = "#C00000";
                msgEl.style.fontSize = "14px";
            } else {
                msgEl.textContent = "";
            }
        }
        calculateFinishingCost(activeQuoteForm);
        updateGlobalSummary();
    }

    // Funkcja odpowiedzialna za aktualizację stanu przycisku "Oblicz wysyłkę" i "Zapisz wycenę""
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
                btn.style.backgroundColor = "#bfbfbf";
                btn.style.cursor = "default";
                btn.disabled = true;
            } else {
                btn.style.backgroundColor = "";
                btn.style.cursor = "pointer";
                btn.disabled = false;
            }
        });
    }

    // Nadpisana funkcja updateGlobalSummary z logami debugującymi ❤️
    function updateGlobalSummary() {
        let globalOrderBrutto = 0;
        let globalOrderNetto = 0;
        let globalFinishingBrutto = 0;
        let globalFinishingNetto = 0;
        let allSelected = true;
        let showEnterDimensions = false;
        let showChooseVariant = false;

        const forms = quoteFormsContainer.querySelectorAll('.quote-form');
        forms.forEach((form, index) => {
            const length = parseFloat(form.querySelector('input[data-field="length"]')?.value);
            const width = parseFloat(form.querySelector('input[data-field="width"]')?.value);
            const thickness = parseFloat(form.querySelector('input[data-field="thickness"]')?.value);
            const quantity = parseInt(form.querySelector('input[data-field="quantity"]')?.value);
            const clientType = form.querySelector('select[data-field="clientType"]')?.value;

            const orderBrutto = parseFloat(form.dataset.orderBrutto);
            const orderNetto = parseFloat(form.dataset.orderNetto);

            // Zerujemy wykończenie jeśli wybrano "Brak"
            const finishingTypeBtn = form.querySelector('.finishing-btn[data-finishing-type].active');
            const finishingType = finishingTypeBtn ? finishingTypeBtn.dataset.finishingType : 'Brak';
            if (finishingType === 'Brak') {
                form.dataset.finishingBrutto = 0;
                form.dataset.finishingNetto = 0;
            }

            const finishingBrutto = parseFloat(form.dataset.finishingBrutto) || 0;
            const finishingNetto = parseFloat(form.dataset.finishingNetto) || 0;

            const hasDimensions = !isNaN(length) && !isNaN(width) && !isNaN(thickness) && !isNaN(quantity);
            const hasClientType = isPartner ? true : !!clientType;

            console.log(`>>> form[${index}] - orderBrutto: ${orderBrutto}, orderNetto: ${orderNetto}, clientType: ${clientType}`);
            if (!hasDimensions || !hasClientType) {
                showEnterDimensions = true;
            } else if (isNaN(orderBrutto) || isNaN(orderNetto)) {
                showChooseVariant = true;
            } else {
                globalOrderBrutto += orderBrutto;
                globalOrderNetto += orderNetto;
                globalFinishingBrutto += finishingBrutto;
                globalFinishingNetto += finishingNetto;
            }

            if (isNaN(orderBrutto) || isNaN(orderNetto)) {
                allSelected = false;
            }
        });

        const orderSummary = document.querySelector('.quote-summary .order-summary');
        const deliverySummary = document.querySelector('.quote-summary .delivery-summary');
        const finalSummary = document.querySelector('.quote-summary .final-summary');

        if (showEnterDimensions) {
            orderSummary.querySelector('.order-brutto').textContent = "Wpisz wymiary";
            orderSummary.querySelector('.order-netto').textContent = "Wpisz wymiary";
            deliverySummary.querySelector('.courier').textContent = "Wpisz wymiary";
            deliverySummary.querySelector('.delivery-brutto').textContent = "Wpisz wymiary";
            deliverySummary.querySelector('.delivery-netto').textContent = "Wpisz wymiary";
            finalSummary.querySelector('.final-brutto').textContent = "Wpisz wymiary";
            finalSummary.querySelector('.final-netto').textContent = "Wpisz wymiary";
        } else if (showChooseVariant) {
            orderSummary.querySelector('.order-brutto').textContent = "Wybierz wariant";
            orderSummary.querySelector('.order-netto').textContent = "Wybierz wariant";
            deliverySummary.querySelector('.courier').textContent = "Oblicz wysyłkę";
            deliverySummary.querySelector('.delivery-brutto').textContent = "Oblicz wysyłkę";
            deliverySummary.querySelector('.delivery-netto').textContent = "Oblicz wysyłkę";
            finalSummary.querySelector('.final-brutto').textContent = "Wybierz wariant";
            finalSummary.querySelector('.final-netto').textContent = "Wybierz wariant";
        } else {
            orderSummary.querySelector('.order-brutto').textContent = formatPLN(globalOrderBrutto);
            orderSummary.querySelector('.order-netto').textContent = formatPLN(globalOrderNetto);

            const finishingBruttoEl = document.querySelector('.quote-summary .finishing-brutto');
            const finishingNettoEl = document.querySelector('.quote-summary .finishing-netto');
            if (finishingBruttoEl && finishingNettoEl) {
                finishingBruttoEl.textContent = formatPLN(globalFinishingBrutto);
                finishingNettoEl.textContent = formatPLN(globalFinishingNetto);
            }

            const deliveryBruttoText = deliverySummary.querySelector('.delivery-brutto').textContent;
            const deliveryNettoText = deliverySummary.querySelector('.delivery-netto').textContent;

            let deliveryB = 0;
            let deliveryN = 0;

            if (deliveryBruttoText.endsWith('PLN')) {
                deliveryB = parseFloat(deliveryBruttoText.replace(" PLN", "")) || 0;
            }
            if (deliveryNettoText.endsWith('PLN')) {
                deliveryN = parseFloat(deliveryNettoText.replace(" PLN", "")) || 0;
            }

            finalSummary.querySelector('.final-brutto').textContent = formatPLN(globalOrderBrutto + globalFinishingBrutto + deliveryB);
            finalSummary.querySelector('.final-netto').textContent = formatPLN(globalOrderNetto + globalFinishingNetto + deliveryN);
        }

        updateCalculateDeliveryButtonState();
    }

    window.updateGlobalSummary = updateGlobalSummary;

    // Podpinamy event listenery do pól wejściowych i radio
    variantSelectors.forEach(variant => {
        const radio = variant.querySelector('input[type="radio"]');
        if (radio) {
            radio.addEventListener('change', updatePrices);
        }
    });

    // Upewnij się, że productTabs jest globalne – teraz przypisujemy je
    productTabs = document.querySelector('.product-tabs');

    const addProductBtn = document.querySelector('.add-product');
    const removeProductBtn = document.querySelector('.remove-product');

    // Setup quoteFormsContainer (jeśli jeszcze nie ustawione)
    quoteFormsContainer = document.querySelector('.quote-forms');
    if (!quoteFormsContainer) {
        quoteFormsContainer = document.createElement('div');
        quoteFormsContainer.className = 'quote-forms';
        const calcMain = document.querySelector('.calculator-main');
        calcMain.insertBefore(quoteFormsContainer, calcMain.firstElementChild);
        const initialQuoteForm = document.querySelector('.quote-form');
        if (initialQuoteForm) quoteFormsContainer.appendChild(initialQuoteForm);
    }

    // Funkcja aktualizująca widoczny formularz według indeksu zakładki
    function updateActiveQuoteForm(index) {
        const forms = quoteFormsContainer.querySelectorAll('.quote-form');
        forms.forEach((form, i) => {
            form.style.display = (i === index) ? 'flex' : 'none';
        });
    }

    // Helper: pobranie indeksu klikniętej zakładki
    function getTabIndex(tab) {
        const tabs = Array.from(productTabs.querySelectorAll('.product-number'));
        const index = tabs.indexOf(tab);
        console.log("getTabIndex: Calculated index =", index, "for tab =", tab);
        if (index === -1) {
            console.error("getTabIndex: Tab element not found in product tabs. Ensure the correct element is passed.");
        }
        return index;
    }

    // Funkcja ustawiająca aktywną zakładkę i formularz
    function setActiveTab(clickedTab) {
        productTabs.querySelectorAll('.product-number').forEach(tab => {
            tab.classList.remove('active');
        });
        clickedTab.classList.add('active');
        const index = getTabIndex(clickedTab);
        updateActiveQuoteForm(index);
        activeQuoteForm = quoteFormsContainer.querySelectorAll('.quote-form')[index];
        console.log("setActiveTab: activeQuoteForm set to index", index);
        attachFormListeners(activeQuoteForm);
        updatePrices();
    }

    // Ustaw pierwszą zakładkę aktywną przy starcie
    const firstTab = productTabs.querySelector('.product-number');
    if (firstTab) setActiveTab(firstTab);

    // Nasłuchiwanie kliknięć na zakładkach (delegacja)
    productTabs.addEventListener('click', function (e) {
        if (e.target.classList.contains('number')) {
            setActiveTab(e.target.parentElement);
        }
    });

    // Dodaj listener dla przycisku dodawania produktu
    addProductBtn.addEventListener('click', function () {
        const productNumbers = productTabs.querySelectorAll('.product-number');
        const newIndex = productNumbers.length + 1;
        const newTab = document.createElement('div');
        newTab.classList.add('product-number');
        newTab.innerHTML = '<button class="number">' + newIndex + '</button>';
        const addContainer = productTabs.querySelector('.add-product-container');
        productTabs.insertBefore(newTab, addContainer);
        updateRemoveButtonVisibility();

        const templateForm = quoteFormsContainer.querySelector('.quote-form');
        const newQuoteForm = templateForm.cloneNode(true);

        // Kopiowanie wartości "Grupa cenowa"
        const clientTypeSelect = templateForm.querySelector('select[data-field="clientType"]');
        const newClientTypeSelect = newQuoteForm.querySelector('select[data-field="clientType"]');
        if (clientTypeSelect && newClientTypeSelect) {
            newClientTypeSelect.value = clientTypeSelect.value;
        }

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

        newQuoteForm.dataset.listenersAttached = "";
        attachFormListeners(newQuoteForm);
        prepareNewProductForm(newQuoteForm, newIndex - 1);
        quoteFormsContainer.appendChild(newQuoteForm);
        setActiveTab(newTab);
    });

    // Globalny listener dla przycisków usuwania
    document.addEventListener('click', function (e) {
        const removeBtn = e.target.closest('.remove-product');
        if (removeBtn) {

            // Usuwamy formularz, który jest aktualnie aktywny
            if (!activeQuoteForm) {
                console.log("Brak aktywnego formularza (activeQuoteForm).");
                return;
            }
            console.log("Usuwam aktywny formularz:", activeQuoteForm);

            const forms = Array.from(quoteFormsContainer.querySelectorAll('.quote-form'));
            const index = forms.indexOf(activeQuoteForm);
            if (index === -1) {
                console.log("activeQuoteForm nie jest w tablicy formularzy?");
                return;
            }

            // Usuwamy formularz z DOM
            activeQuoteForm.remove();

            // Usuwamy zakładkę o tym samym indeksie
            const tabs = Array.from(productTabs.querySelectorAll('.product-number'));
            if (tabs[index]) {
                tabs[index].remove();
                console.log("Usunięto zakładkę nr", index + 1);
            }

            // Aktualizacja numeracji zakładek
            productTabs.querySelectorAll('.product-number .number').forEach((btn, idx) => {
                btn.textContent = idx + 1;
            });

            updateRemoveButtonVisibility();

            // Ustawiamy nowy aktywny formularz (poprzedni lub pierwszy)
            const remainingTabs = Array.from(productTabs.querySelectorAll('.product-number'));
            let newIndex;
            if (index > 0) {
                newIndex = index - 1;
            } else {
                newIndex = 0;
            }
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
        if (productNumbers.length > 1) {
            document.querySelector('.remove-product-container').style.display = 'flex';
        } else {
            document.querySelector('.remove-product-container').style.display = 'none';
        }
    }

    updateRemoveButtonVisibility();
    updateActiveQuoteForm(0);

    // Listener do przycisku zamknięcia modalboxa
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', function () {
            const modal = document.getElementById('deliveryModal');
            modal.style.display = 'none';
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.style.display = 'none';
        });
    }

    // Kliknięcie poza modalboxa zamyka modal i overlay
    document.addEventListener('click', function (e) {
        const modal = document.getElementById('deliveryModal');
        if (modal.style.display === 'block' && !modal.contains(e.target)) {
            modal.style.display = 'none';
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.style.display = 'none';
        }
    });
    // Część do uruchamiania 3D i obróbki krawędzi

    // 0) Utility: pokaż/ukryj nagłówek kolumny "Kąt"
    function toggleAngleColumn(show) {
        const table = document.getElementById('edge3d-table');
        if (!table) return;
        const headerCell = table.querySelector('.edge3d-header .edge3d-cell:nth-child(4)');
        if (headerCell) headerCell.style.visibility = show ? 'visible' : 'hidden';
    }

    // 1) Lista nazw krawędzi
    const edgesList = [
        "top-front", "top-back", "top-left", "top-right",
        "bottom-front", "bottom-back", "bottom-left", "bottom-right",
        "left-front", "left-back", "right-front", "right-back"
    ];

    // 2) Funkcje do podświetlania/resetu krawędzi w modelu
    function highlightEdge3D(key) {
        if (typeof window.highlightEdge === 'function') {
            window.highlightEdge(key, '#ED6B24', 2);
        }
    }
    function resetEdge3D(key) {
        if (typeof window.resetEdge === 'function') {
            window.resetEdge(key);
        }
    }

    // 2a) Handler dla zmiany/kliknięcia inputów (delegowany)
    function onEdgeInputChange(e) {
        const input = e.target;
        const row = input.closest('.edge3d-row');
        if (!row) return;
        const key = row.querySelector('.edge3d-cell').textContent.trim();
        console.log(`→ DOM event: edge input change — key="${key}", value="${input.value}", id="${input.id}"`);
        console.log('Edge input event:', key, input.value);
        highlightEdge3D(key);

        // update our global settings
        window.edgeSettings[key] = window.edgeSettings[key] || {};
        window.edgeSettings[key].value = parseFloat(input.value) || 0;
 
        // recompute dims for this render
        const dims = {
            length: parseFloat(document.getElementById('length').value) || 0,
            width: parseFloat(document.getElementById('width').value) || 0,
            height: parseFloat(document.getElementById('thickness').value) || 0
        };
        // re-render via non‑JSX API
        edge3dRoot.render(
            React.createElement(Edge3DViewer, { dimensions: dims, edgeSettings: window.edgeSettings })
        );
    }   


    // 3) Handler kliknięcia przycisku typu obróbki
    function onTypeButtonClick(e) {
        const btn = e.currentTarget;
        const key = btn.dataset.edgeKey;
        const type = btn.dataset.type;
        console.log(`→ DOM event: type button click — key="${key}", type="${type}"`);

        // update settings
        window.edgeSettings[key] = window.edgeSettings[key] || {};
        window.edgeSettings[key].type = type;

        // pokaż kolumnę kąta tylko dla fazowania
        toggleAngleColumn(type === 'fazowana');

        // recompute dims & re-render via React.createElement
        const dims = {
            length: parseFloat(document.getElementById('length').value) || 0,
            width: parseFloat(document.getElementById('width').value) || 0,
            height: parseFloat(document.getElementById('thickness').value) || 0
        };
        edge3dRoot.render(
            React.createElement(Edge3DViewer, { dimensions: dims, edgeSettings: window.edgeSettings })
        );
    }


    // 4) Renderowanie tabeli z wierszami
    function renderEdgeInputs() {
        const table = document.getElementById('edge3d-table');
        if (!table) return console.error("Brak #edge3d-table w DOM");
        table.style.display = 'flex';
        table.style.flexDirection = 'column';
        table.style.alignItems = 'flex-start';

        // Nagłówek
        table.innerHTML = `
        <div class="edge3d-row edge3d-header" style="display:flex; gap:12px; padding: 0 12px;">
            <div class="edge3d-cell" style="width:120px;">Krawędź</div>
            <div class="edge3d-cell" style="width:172px;">Typ</div>
            <div class="edge3d-cell" style="width:140px;">Wartość [mm]</div>
            <div class="edge3d-cell" style="width:200px; visibility:hidden;">Kąt [°]</div>
        </div>
    `;

        const basePath = '/calculator/static/images/edges';
        const iconMap = { frezowana: 'frezowanie.svg', fazowana: 'fazowanie.svg' };

        edgesList.forEach(key => {
            const row = document.createElement('div');
            row.className = 'edge3d-row';
            row.style.display = 'flex';
            row.style.gap = '12px';
            row.style.alignItems = 'center';
            row.style.padding = '0 12px';

            // hover podświetlenie
            row.addEventListener('mouseenter', () => {
                row.style.background = '#FFE6D9';
                highlightEdge3D(key);
            });
            row.addEventListener('mouseleave', () => {
                row.style.background = '';
                resetEdge3D(key);
            });

            // Komórki: nazwa, typ, wartość, kąt
            const nameCell = `<div class="edge3d-cell" style="width:120px;">${key}</div>`;

            const typeBtns = ['frezowana', 'fazowana'].map(type => `
            <button type="button"
                    class="edge-type-btn"
                    data-edge-key="${key}"
                    data-type="${type}">
                <img src="${basePath}/${iconMap[type]}" alt="${type}" />
            </button>
        `).join('');
            const typeCell = `<div class="edge3d-cell" style="display:flex; gap:8px; width:160px;">
            ${typeBtns}
        </div>`;

            const valueCell = `<div class="edge3d-cell" style="width:140px;">
            <input type="number"
                   id="edge-value-${key}"
                   class="input-small"
                   style="width:100%;"
                   min="0" />
        </div>`;

            const angleCell = `
            <div class="edge3d-cell"
                 style="width:200px; visibility:hidden; display:flex; align-items:center;">
                <input type="range"
                       id="edge-angle-${key}"
                       class="input-range"
                       min="0" max="90" step="1"
                       oninput="document.getElementById('angle-display-${key}').textContent=this.value+'°'"/>
                <span id="angle-display-${key}"
                      style="margin-left:8px; width:40px;">45°</span>
            </div>
        `;

            row.innerHTML = nameCell + typeCell + valueCell + angleCell;
            table.appendChild(row);
        });
    }

    window.renderEdgeInputs = renderEdgeInputs;

    // 5) Init pod przyciskiem
    const openEdgesBtn = document.getElementById('openEdgesModal');
    if (openEdgesBtn) {
        openEdgesBtn.addEventListener('click', () => {
            renderEdgeInputs();

            // Pokaż modal
            document.querySelector('.modal-3d-overlay').style.display = 'flex';

            // Podczep handler kliknięć typów obróbki
            document.querySelectorAll('.edge-type-btn').forEach(btn =>
                btn.addEventListener('click', onTypeButtonClick)
            );

            // Ukryj domyślnie kolumnę kąta
            toggleAngleColumn(false);

            // Pokaż overlay
            document.querySelector('.modal-3d-overlay').style.display = 'flex';

            // Pobierz wymiary z formularza
            const dims = {
              length: parseFloat(document.getElementById('length').value) || 0,
              width:  parseFloat(document.getElementById('width').value)  || 0,
              height: parseFloat(document.getElementById('thickness').value) || 0,
            };

            // Renderuj Reacta
            const container = document.getElementById('edge3d-root');
            if (!edge3dRoot) {
                edge3dRoot = createRoot(container);
            }
            edge3dRoot.render(
                React.createElement(Edge3DViewer, { dimensions: dims, edgeSettings: window.edgeSettings })
            );

            // ————————————————————————
            // Delegacja eventów na inputy:
            const table = document.getElementById('edge3d-table');
            if (table && !table._listenersAttached) {
                table._listenersAttached = true;
                ['input', 'change', 'click'].forEach(evtName => {
                    table.addEventListener(evtName, e => {
                        if (e.target.tagName.toLowerCase() === 'input') {
                            console.log(`Delegated ${evtName} on`, e.target.id, e.target.value);
                            onEdgeInputChange(e);
                        }
                    });
                });
            }
            // ————————————————————————
        });
    } else {
        console.warn("Nie znaleziono przycisku #openEdgesModal");
    }

    const closeModalBtn = document.getElementById("closeDownloadModal");
    if (closeModalBtn) {
        closeModalBtn.addEventListener("click", () => {
            const modal = document.getElementById("download-modal");
            const iframe = document.getElementById("quotePreview");
            if (modal && iframe) {
                iframe.src = "";
                modal.style.display = "none";
            }
        });
    }
});

document.addEventListener('DOMContentLoaded', function () {
    console.log("Calculator.js – moduł wysyłki załadowany (wersja pośrednicząca)");
    const shippingPackingMultiplier = 1.3;

    function computeAggregatedData() {
        // Pobieramy wszystkie formularze produktu (wszystkie quote-form)
        const forms = quoteFormsContainer.querySelectorAll('.quote-form');
        if (forms.length === 0) {
            console.error("Brak formularzy .quote-form");
            return null;
        }

        // Inicjalizujemy zmienne
        let maxLength = 0;
        let maxWidth = 0;
        let totalThickness = 0;
        let totalWeight = 0;

        // Przechodzimy po każdym formularzu
        forms.forEach(form => {
            // Pobieramy dane z formularza
            const lengthVal = parseFloat(form.querySelector('input[data-field="length"]').value) || 0;
            const widthVal = parseFloat(form.querySelector('input[data-field="width"]').value) || 0;
            const thicknessVal = parseFloat(form.querySelector('input[data-field="thickness"]').value) || 0;
            const quantityVal = parseInt(form.querySelector('input[data-field="quantity"]').value) || 1;

            // Aktualizujemy maksymalną długość i szerokość
            if (lengthVal > maxLength) {
                maxLength = lengthVal;
            }
            if (widthVal > maxWidth) {
                maxWidth = widthVal;
            }
            // Sumujemy grubość (każdy produkt może mieć inną grubość, a przy ilości >1 mnożymy)
            totalThickness += thicknessVal * quantityVal;

            // Obliczamy objętość pojedynczego produktu (w m³)
            const volume = (lengthVal / 100) * (widthVal / 100) * (thicknessVal / 100);
            // Obliczamy wagę produktu (m³ * 800) i mnożymy przez ilość
            const productWeight = volume * 800 * quantityVal;
            totalWeight += productWeight;
        });

        // Dodajemy 5 cm do każdego wymiaru
        const aggregatedLength = maxLength + 5;
        const aggregatedWidth = maxWidth + 5;
        const aggregatedThickness = totalThickness + 5;

        console.log("Aggregated dimensions:", {
            aggregatedLength,
            aggregatedWidth,
            aggregatedThickness,
            totalWeight
        });

        return {
            length: aggregatedLength,
            width: aggregatedWidth,
            height: aggregatedThickness, // interpretujemy grubość jako wysokość
            weight: totalWeight,
            quantity: 1, // zakładamy jedną przesyłkę
            senderCountryId: "1",   // domyślne ustawienia
            receiverCountryId: "1"  // domyślne ustawienia
        };
    }
    
    function attachClearListeners() {
        const inputs = document.querySelectorAll('.quote-form input[data-field], .quote-form select[data-field]');
        inputs.forEach(input => {
            input.addEventListener('input', updateGlobalSummary);
            input.addEventListener('change', updateGlobalSummary);
        });
    }
    attachClearListeners();

    async function calculateDelivery() {
        console.log("Przycisk 'Oblicz wysyłkę' kliknięty");
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.innerHTML = '<div class="spinner"></div><div class="loading-text">Wyceniam wysyłkę, proszę czekać.</div>';
            overlay.style.display = 'flex';
            console.log("Overlay wyświetlony z spinnerem i napisem 'wyceniam wysyłkę'");
        }
        const shippingParams = computeAggregatedData();
        if (!shippingParams) {
            console.error("Brak danych wysyłki");
            if (overlay) overlay.style.display = 'none';
            return;
        }
        try {
            const response = await fetch('/calculator/shipping_quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(shippingParams)
            });
            if (response.ok) {
                let quotesData = await response.json();
                console.log("Pełna odpowiedź API:", quotesData);
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
                console.log("Otrzymane wyceny wysyłki (wszystkie opcje):", quotes);
                if (quotes.length === 0) {
                    showDeliveryErrorModal("Brak dostępnych metod dostawy.");
                    return;
                }
                showDeliveryModal(quotes);
            } else {
                console.error("Błąd w żądaniu wyceny wysyłki:", response.status);
            }
        } catch (error) {
            console.error("Wyjątek przy wycenie wysyłki:", error);
        }
    }

    function showDeliveryModal(quotes) {
        quotes.sort((a, b) => a.grossPrice - b.grossPrice);
        const modal = document.getElementById('deliveryModal');
        if (!modal) {
            console.error("Modalbox 'deliveryModal' nie został znaleziony.");
            return;
        }
        const deliveryList = modal.querySelector('.modal-delivery-list');
        if (!deliveryList) {
            console.error("Lista opcji dostawy 'modal-delivery-list' nie została znaleziona.");
            return;
        }
        deliveryList.innerHTML = '';
        quotes.forEach((quote, index) => {
            console.log(`Przetwarzanie opcji dostawy [${index}]:`, quote);
            if (!quote.grossPrice || !quote.netPrice || !quote.carrierName) {
                console.warn(`Pominięto opcję dostawy z powodu brakujących danych:`, quote);
                return;
            }
            const listItem = document.createElement('div');
            listItem.className = 'delivery-option';
            listItem.innerHTML = `
                <input type="radio" name="deliveryOption" value="${quote.carrierName}" data-gross="${quote.grossPrice}" data-net="${quote.netPrice}">
                <img src="${quote.carrierLogoLink}" style="width: 30px; height: auto;" alt="${quote.carrierName} logo">
                <div class="delivery-option-text">
                    <div class="prices-adjusted">
                        <div class="option-title-delivery">${quote.carrierName}</div>
                        <div class="delivery-prices">
                            <div class="unit-brutto-delivery">${quote.grossPrice.toFixed(2)} PLN</div>
                            <div class="unit-netto-delivery">${quote.netPrice.toFixed(2)} PLN</div>
                        </div>
                    </div>
                    <div class="delivery-prices">
                        <div class="unit-brutto-delivery">${quote.rawGrossPrice.toFixed(2)} PLN</div>
                        <div class="unit-netto-delivery">${quote.rawNetPrice.toFixed(2)} PLN</div>
                    </div>
                </div>
            `;
            deliveryList.appendChild(listItem);
            listItem.addEventListener('click', function (e) {
                const radio = listItem.querySelector('input[type="radio"]');
                if (radio && !radio.checked) {
                    radio.checked = true;
                    radio.dispatchEvent(new Event('change'));
                }
            });
        });

        if (deliveryList.innerHTML === '') {
            deliveryList.innerHTML = '<p>Brak dostępnych opcji dostawy.</p>';
        }

        const packingInfoEl = modal.querySelector('#packingInfo');
        if (packingInfoEl) {
            const percent = Math.round((shippingPackingMultiplier - 1) * 100);
            packingInfoEl.textContent = `Do cen wysyłki została doliczona kwota ${percent}% wysyłki na pakowanie.`;
            const headerAdjusted = modal.querySelector('#delivery-header-adjusted');
            if (headerAdjusted) {
                headerAdjusted.textContent = `Cena + ${percent}%`;
            }
        }

        modal.style.display = 'block';

        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.innerHTML = '';
        }
        console.log("Modalbox z opcjami wysyłki został wyświetlony, a overlay został oczyszczony.");
    }

    function showDeliveryErrorModal(errorMessage) {
        const modal = document.getElementById('deliveryModal');
        if (!modal) {
            console.error("Modalbox 'deliveryModal' nie został znaleziony.");
            return;
        }
        const deliveryList = modal.querySelector('.couriers-options');
        if (!deliveryList) {
            console.error("Lista opcji dostawy 'modal-delivery-list' nie została znaleziona.");
            return;
        }
        // Wyczyść poprzednie elementy i wstaw komunikat błędu
        deliveryList.innerHTML = `<p class="modal-error-msg">${errorMessage}</p>`;

        // Ukryj ewentualne informacje o pakowaniu / cennikach
        const packingInfoEl = modal.querySelector('#packingInfo');
        if (packingInfoEl) {
            packingInfoEl.textContent = "";
        }
        const headerAdjusted = modal.querySelector('#delivery-header-adjusted');
        if (headerAdjusted) {
            headerAdjusted.textContent = "";
        }

        // Zmień tekst przycisku modalConfirmBtn na "Zamknij" i zmień zachowanie
        const modalConfirmBtn = document.getElementById('modalConfirmBtn');
        if (modalConfirmBtn) {
            modalConfirmBtn.textContent = "Zamknij";
            // Ustaw handler, który po kliknięciu zamyka modal, bez sprawdzania wyboru
            modalConfirmBtn.onclick = function () {
                modal.style.display = 'none';
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) {
                    overlay.style.display = 'none';
                }
                // Przywracamy domyślny tekst przycisku (jeśli modal zostanie ponownie użyty do wyceny)
                modalConfirmBtn.textContent = "Wybierz";
            };
        }

        // Pokaż modal
        modal.style.display = 'block';
        // Wyczyść overlay (jeśli używasz spinnera)
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.innerHTML = '';
        }
        console.log("Modalbox z komunikatem błędu został wyświetlony.");
    }

    const modalConfirmBtn = document.getElementById('modalConfirmBtn');
    if (modalConfirmBtn) {
        modalConfirmBtn.addEventListener('click', function () {
            const modal = document.getElementById('deliveryModal');
            // Jeśli modal zawiera element z komunikatem błędu, to po prostu zamknij modal
            if (modal.querySelector('.modal-error-msg')) {
                modal.style.display = 'none';
                const overlay = document.getElementById('loadingOverlay');
                if (overlay) {
                    overlay.style.display = 'none';
                }
                return;
            }
            const selectedOption = modal.querySelector('input[name="deliveryOption"]:checked');
            if (!selectedOption) {
                alert("Proszę wybrać metodę dostawy.");
                return;
            }
            const courier = selectedOption.value;
            const gross = selectedOption.dataset.gross;
            const net = selectedOption.dataset.net;
            document.getElementById('delivery-brutto').textContent = `${parseFloat(gross).toFixed(2)} PLN`;
            document.getElementById('delivery-netto').textContent = `${parseFloat(net).toFixed(2)} PLN`;
            document.getElementById('courier-name').textContent = courier;
            updateGlobalSummary();
            modal.style.display = 'none';
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) {
                overlay.style.display = 'none';
            }
        });
    }

    const calculateDeliveryBtn = document.querySelector('.calculate-delivery');
    if (calculateDeliveryBtn) {
        calculateDeliveryBtn.addEventListener('click', calculateDelivery);
        console.log("Podpięty event listener do .calculate-delivery");
    } else {
        console.error("Brak przycisku .calculate-delivery w DOM");
    }
});

document.addEventListener('DOMContentLoaded', function () {
    const lengthInput = document.getElementById('length');
    const widthInput = document.getElementById('width');

    if (lengthInput) {
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

    if (widthInput) {
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
});

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

            container.innerHTML = data.map(q => `
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
                        <button class="quotes-btn-download" data-id="${q.id}">
                            <i class="fa fa-download"></i> Pobierz
                        </button>
                        <button class="order" data-id="${q.id}">Zamów</button>
                    </div>
                </div>
            `).join('');

            console.log("[loadLatestQuotes] Wyrenderowano HTML z ostatnimi wycenami");

            document.querySelectorAll('.quotes-btn-download').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    console.log(`[quotes-btn-download] Klik na przycisk pobierz – ID: ${id}`);

                    const modal = document.getElementById("download-modal");
                    const iframe = document.getElementById("quotePreview");

                    if (modal && iframe) {
                        iframe.src = `/quotes/api/quotes/${id}/pdf.pdf`;
                        modal.style.display = "flex";
                    }
                });
            });
        })
        .catch(err => {
            console.error("[loadLatestQuotes] Błąd podczas ładowania wycen:", err);
        });
}

document.addEventListener('DOMContentLoaded', loadLatestQuotes);

document.addEventListener('DOMContentLoaded', function () {
    const typeButtons = document.querySelectorAll('[data-finishing-type]');
    const variantButtons = document.querySelectorAll('[data-finishing-variant]');
    const glossButtons = document.querySelectorAll('[data-finishing-gloss]');
    const colorButtons = document.querySelectorAll('[data-finishing-color]');

    const variantWrapper = document.getElementById('finishing-variant-wrapper');
    const glossWrapper = document.getElementById('finishing-gloss-wrapper');
    const colorWrapper = document.getElementById('finishing-color-wrapper');

    let currentType = 'Brak';
    let currentVariant = 'Brak';

    function resetButtons(buttons) {
        buttons.forEach(btn => btn.classList.remove('active'));
    }

    function show(element) {
        if (element) element.style.display = 'flex';
    }

    function hide(element) {
        if (element) element.style.display = 'none';
    }

    function updateVisibility() {
        if (currentType === 'Brak') {
            hide(variantWrapper);
            hide(glossWrapper);
            hide(colorWrapper);
            return;
        }

        show(variantWrapper);

        if (currentVariant === 'Barwne') {
            show(colorWrapper);
        } else {
            hide(colorWrapper);
        }

        if (currentType === 'Lakierowanie') {
            show(glossWrapper);
        } else {
            hide(glossWrapper);
        }
    }

    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            resetButtons(typeButtons);
            btn.classList.add('active');
            currentType = btn.dataset.finishingType;
            updateVisibility();
        });
    });

    variantButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            resetButtons(variantButtons);
            btn.classList.add('active');
            currentVariant = btn.dataset.finishingVariant;
            updateVisibility();
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
});

// Obliczanie ceny wykończenia i aktualizacja interfejsu
// Modyfikacja calculateFinishingCost – dodanie zapisu danych do form.dataset
function calculateFinishingCost(form) {
    console.log('🧪 calculateFinishingCost called for:', form);
    const formScope = form || document.querySelector('.quote-form[data-listeners-attached="true"]');
    if (!formScope) return { netto: null, brutto: null };

    const finishingTypeBtn = formScope.querySelector('.finishing-btn[data-finishing-type].active');
    const finishingVariantBtn = formScope.querySelector('.finishing-btn[data-finishing-variant].active');

    const finishingType = finishingTypeBtn ? finishingTypeBtn.dataset.finishingType : 'Brak';
    const finishingVariant = finishingVariantBtn ? finishingVariantBtn.dataset.finishingVariant : 'Brak';

    const lengthInput = document.querySelector('#length');
    const widthInput = document.querySelector('#width');
    const thicknessInput = document.querySelector('#thickness');
    const quantityInput = document.querySelector('#quantity');

    const length = parseFloat(lengthInput?.value) * 10;
    const width = parseFloat(widthInput?.value) * 10;
    const thickness = parseFloat(thicknessInput?.value) * 10;
    const quantity = parseInt(quantityInput?.value) || 1;

    const finishingBruttoEl = document.getElementById('finishing-brutto');
    const finishingNettoEl = document.getElementById('finishing-netto');

    if (finishingType === 'Brak') {
        formScope.dataset.finishingBrutto = 0;
        formScope.dataset.finishingNetto = 0;
        if (finishingBruttoEl) finishingBruttoEl.textContent = '0.00 PLN';
        if (finishingNettoEl) finishingNettoEl.textContent = '0.00 PLN';
        updateGlobalSummary();
        return { netto: 0, brutto: 0 };
    }

    if (!lengthInput?.value || !widthInput?.value || !thicknessInput?.value) {
        return { netto: null, brutto: null };
    }

    const area_mm2 = 2 * (length * width + length * thickness + width * thickness);
    const area_m2 = area_mm2 / 1_000_000;
    const total_area = area_m2 * quantity;

    let pricePerM2 = 0;
    if (finishingVariant === 'Bezbarwne') pricePerM2 = 200;
    else if (finishingVariant === 'Barwne') pricePerM2 = 250;

    console.log('lengthInput:', lengthInput, 'formScope:', formScope);
    console.log('🎯 Final area:', total_area)

    const finishingPriceBrutto = +(total_area * pricePerM2).toFixed(2);
    const finishingPriceNetto = +(finishingPriceBrutto / 1.23).toFixed(2);

    console.log('🧪 finishingNetto =', finishingPriceNetto);
    console.log('🧪 finishingBrutto =', finishingPriceBrutto);

    formScope.dataset.finishingBrutto = finishingPriceBrutto;
    formScope.dataset.finishingNetto = finishingPriceNetto;

    if (finishingBruttoEl) finishingBruttoEl.textContent = finishingPriceBrutto.toFixed(2) + ' PLN';
    if (finishingNettoEl) finishingNettoEl.textContent = finishingPriceNetto.toFixed(2) + ' PLN';

    updateGlobalSummary();
    return {
        netto: finishingPriceNetto,
        brutto: finishingPriceBrutto
    };
}

window.calculateFinishingCost = calculateFinishingCost;

// Domyślna inicjalizacja na starcie i obsługa zmian
function attachFinishingListenersToForm(form) {
    const inputs = form.querySelectorAll('#length, #width, #thickness, #quantity');
    inputs.forEach(input => {
        input.addEventListener('input', () => calculateFinishingCost(form));
    });

    form.querySelectorAll('.finishing-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setTimeout(() => calculateFinishingCost(form), 10);
        });
    });
}

function attachFinishingUIListeners(form) {
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

        if (currentVariant === 'Barwne') {
            show(colorWrapper);
        } else {
            hide(colorWrapper);
        }

        if (currentType === 'Lakierowanie') {
            show(glossWrapper);
        } else {
            hide(glossWrapper);
        }
    }

    typeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            resetButtons(typeButtons);
            btn.classList.add('active');
            currentType = btn.dataset.finishingType;
            updateVisibility();
            setTimeout(() => calculateFinishingCost(form), 10);
        });
    });

    variantButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            resetButtons(variantButtons);
            btn.classList.add('active');
            currentVariant = btn.dataset.finishingVariant;
            updateVisibility();
            setTimeout(() => calculateFinishingCost(form), 10);
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

document.addEventListener('DOMContentLoaded', () => {
    quoteFormsContainer = document.querySelector('.quote-forms');

    document.querySelectorAll('.quote-form').forEach((form, index) => {
        prepareNewProductForm(form, index);
        attachFormListeners(form);
        attachFinishingListenersToForm(form);
        calculateFinishingCost(form);
    });

    document.querySelector('.add-product').addEventListener('click', () => {
        const lastForm = quoteFormsContainer.querySelector('.quote-form:last-of-type');
        const newForm = lastForm.cloneNode(true);

        const index = quoteFormsContainer.querySelectorAll('.quote-form').length;

        newForm.querySelectorAll('input[data-field], select[data-field]').forEach(el => el.value = '');
        newForm.querySelectorAll('input[type="radio"]').forEach(radio => {
            radio.checked = false;
            const nameBase = radio.name.split('-')[0];
            radio.name = `${nameBase}-${index}`;
        });

        newForm.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
        newForm.dataset.index = index;

        prepareNewProductForm(newForm, index);
        attachFormListeners(newForm);
        attachFinishingListenersToForm(newForm);
        calculateFinishingCost(newForm);

        quoteFormsContainer.appendChild(newForm);
    });
});