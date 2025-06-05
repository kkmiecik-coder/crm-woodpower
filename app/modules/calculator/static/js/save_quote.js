// modules/calculator/static/js/save_quote.js

document.addEventListener('DOMContentLoaded', function () {
    const modal = document.getElementById('saveQuoteModal');
    const openBtn = document.querySelector('.save-quote');
    const closeBtn = document.getElementById('closeSaveQuoteModal');
    const switchToAddClient = document.getElementById('switchToAddClient');
    const searchInput = document.getElementById('clientSearchInput');

    searchInput?.addEventListener('input', async () => {
        const query = searchInput.value.trim();
        console.log("[search_clients] Wpisany tekst:", query);

        if (!resultsBox) {
            console.warn("[search_clients] Brak elementu #clientSearchResults!");
            return;
        }

        if (query.length < 3) {
            console.log("[search_clients] Mniej niż 3 znaki – czyszczę wyniki");
            resultsBox.innerHTML = '';
            return;
        }

        try {
            console.log("[search_clients] Wysyłam zapytanie do /calculator/search_clients");
            const res = await fetch(`/calculator/search_clients?q=${encodeURIComponent(query)}`);
            const data = await res.json();

            if (!data || data.length === 0) {
                resultsBox.innerHTML = '<p class="no-results">Brak wyników.</p>';
                return;
            }

            resultsBox.innerHTML = data.map(client => `
            <div class="search-client-result" data-id="${client.id}">
                <strong>${client.name}</strong>
                <span>
                    ${(client.email || '')}${client.email && client.phone ? ' | ' : ''}
                    ${(client.phone || '')}
                </span>
            </div>
        `).join('');

        resultsBox.style.display = 'block';

            // Obsługa kliknięcia w wynik
            document.querySelectorAll('.search-client-result').forEach(el => {
                el.addEventListener('click', () => {
                    const clientId = el.dataset.id;
                    const clientName = el.querySelector('strong')?.textContent;
                    const clientInfo = el.querySelector('span')?.textContent || "";
                    const [email, phone] = clientInfo.split('|').map(x => x.trim());

                    // Przeskocz do kroku 2
                    stepSelect.style.display = 'none';
                    stepAdd.style.display = 'block';
                    stepSummary.style.display = 'block';
                    stepSuccess.style.display = 'none';

                    // Ustaw dane klienta
                    document.querySelector('[name="client_id"]')?.remove(); // usunięcie poprzedniego
                    const hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.name = 'client_id';
                    hiddenInput.value = clientId;
                    document.querySelector('.form-section')?.prepend(hiddenInput);

                    document.querySelector('[name="client_login"]').value = clientName;
                    document.querySelector('[name="client_name"]').value = clientName;
                    document.querySelector('[name="client_email"]').value = email || '';
                    document.querySelector('[name="client_phone"]').value = phone || '';

                    renderSummaryValues();

                    console.log("[search_clients] Wybrano klienta ID:", clientId, clientName);
                });
            });

        } catch (err) {
            console.error("[search_clients] Błąd fetch:", err);
        }
    });

    const resultsBox = document.getElementById('clientSearchResults');
    const feedbackBox = document.getElementById('quoteSaveFeedback');
    const saveQuoteBtn = document.getElementById('confirmSaveQuote');

    const stepSelect = document.querySelector('.step-select-client');
    const stepAdd = document.querySelector('.step-add-client');
    const stepSummary = document.querySelector('.step-summary');
    const stepSuccess = document.querySelector('.step-success');

    const loadingText = document.createElement('p');
    loadingText.textContent = 'Zapisywanie wyceny...';

    const renderFeedback = (html) => {
        feedbackBox.innerHTML = '';
        feedbackBox.appendChild(html);
    };

    openBtn?.addEventListener('click', () => {
        modal.style.display = 'flex';
        stepSelect.style.display = 'block';
        stepAdd.style.display = 'none';
        stepSummary.style.display = 'none';
        stepSuccess.style.display = 'none';
        searchInput.value = '';
        resultsBox.innerHTML = '';
        console.log("[save_quote.js] Otworzono modal zapisu wyceny");
    });

    closeBtn?.addEventListener('click', () => {
        modal.style.display = 'none';
        console.log("[save_quote.js] Zamknięto modal zapisu wyceny");
    });

    switchToAddClient?.addEventListener('click', () => {
        stepSelect.style.display = 'none';
        stepAdd.style.display = 'block';
        stepSummary.style.display = 'block';
        stepSuccess.style.display = 'none';
        renderSummaryValues();
        console.log("[save_quote.js] Przełączono do formularza dodawania klienta");
    });

    function renderSummaryValues() {
        const data = collectQuoteData();
        if (!data || !data.summary) {
            console.error("[renderSummaryValues] Brak danych summary z collectQuoteData()");
            return;
        }

        const summary = data.summary;
        console.log("[renderSummaryValues] Podsumowanie:", summary);

        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = `${value.toFixed(2)} PLN`;
            } else {
                console.warn(`[renderSummaryValues] Element o id '${id}' nie istnieje`);
            }
        };

        // Sprawdź czy są jakieś wybrane produkty
        const hasSelectedProducts = data.products.some(p => p.variants.length > 0);

        if (!hasSelectedProducts) {
            setText("summary-products-brutto", 0);
            const elNet = document.getElementById("summary-products-netto");
            if (elNet) elNet.textContent = "0.00 PLN";
        } else {
            setText("summary-products-brutto", summary.products_brutto);
            setText("summary-products-netto", summary.products_netto);
        }

        setText("summary-finishing-brutto", summary.finishing_brutto);
        setText("summary-finishing-netto", summary.finishing_netto);

        if (summary.shipping_netto > 0 && summary.shipping_brutto > 0) {
            setText("summary-shipping-brutto", summary.shipping_brutto);
            setText("summary-shipping-netto", summary.shipping_netto);
        } else {
            const elBrutto = document.getElementById("summary-shipping-brutto");
            const elNetto = document.getElementById("summary-shipping-netto");
            if (elBrutto) elBrutto.textContent = "0.00 PLN";
            if (elNetto) elNetto.textContent = "0.00 PLN";
        }

        setText("summary-total-brutto", summary.total_brutto);
        setText("summary-total-netto", summary.total_netto);
    }


    saveQuoteBtn?.addEventListener('click', () => {
        console.log("[save_quote.js] Kliknięto Zapisz wycenę");

        // Sprawdź czy wszystkie formularze mają wybrane warianty
        const forms = document.querySelectorAll('.quote-form');
        let allVariantsSelected = true;
        let missingVariants = [];

        forms.forEach((form, index) => {
            const selectedRadio = form.querySelector('.variants input[type="radio"]:checked');
            if (!selectedRadio) {
                allVariantsSelected = false;
                missingVariants.push(index + 1);
            }
        });

        if (!allVariantsSelected) {
            const err = document.createElement('p');
            err.textContent = `Wybierz wariant dla produktu: ${missingVariants.join(', ')}`;
            err.style.color = 'red';
            renderFeedback(err);
            console.warn("[save_quote.js] Brak wybranych wariantów dla produktów:", missingVariants);
            return;
        }

        renderFeedback(loadingText);

        const clientIdInput = document.querySelector('[name="client_id"]');
        const client_id = clientIdInput?.value?.trim();

        const clientLogin = document.querySelector('[name="client_login"]')?.value?.trim();
        const clientName = document.querySelector('[name="client_name"]')?.value?.trim() || null;
        const clientPhone = document.querySelector('[name="client_phone"]')?.value?.trim() || null;
        const clientEmail = document.querySelector('[name="client_email"]')?.value?.trim() || null;
        const quoteSource = document.querySelector('[name="quote_source"]')?.value?.trim() || null;

        if (!client_id && !clientLogin) {
            const err = document.createElement('p');
            err.textContent = 'Wpisz nazwę klienta przed zapisem';
            err.style.color = 'red';
            renderFeedback(err);
            console.warn("[save_quote.js] Brak client_id i client_login – przerywamy zapis");
            return;
        }

        // Sprawdź czy telefon lub e-mail zostały podane
        if (!clientPhone && !clientEmail) {
            const err = document.createElement('p');
            err.textContent = 'Podaj telefon lub e-mail klienta.';
            err.style.color = 'red';
            renderFeedback(err);
            console.warn("[save_quote.js] Brak telefonu lub e-maila – przerywamy zapis");
            return;
        }

        const { products, summary } = collectQuoteData();
        const total_price = window.totalPrice || 0.0;

        if (products.length === 0) {
            const err = document.createElement('p');
            err.textContent = 'Wycena nie może być pusta. Dodaj produkty.';
            err.style.color = 'red';
            renderFeedback(err);
            console.warn("[save_quote.js] Brak produktów – przerywamy zapis");
            return;
        }

        const deliveryCostText = document.getElementById('delivery-brutto').textContent;
        const isValidCourier = /^\d+(\.\d{1,2})?\s*PLN$/.test(deliveryCostText);
        const firstForm = document.querySelector('.quote-form');
        const finishing_type = firstForm?.querySelector('[data-finishing-type].active')?.dataset.finishingType || null;
        const finishing_variant = firstForm?.querySelector('[data-finishing-variant].active')?.dataset.finishingVariant || null;
        const finishing_color = firstForm?.querySelector('[data-finishing-color].active')?.dataset.finishingColor || null;
        const finishing_gloss_level = firstForm?.querySelector('[data-finishing-gloss].active')?.dataset.finishingGloss || null;

        const payload = {
            client_id,
            client_login: clientLogin,
            client_name: clientName,
            client_phone: clientPhone,
            client_email: clientEmail,
            quote_source: quoteSource,
            products,
            total_price,
            finishing_type,
            finishing_variant,
            finishing_color,
            finishing_gloss_level,
            courier_name: isValidCourier ? document.getElementById('courier-name').textContent.trim() : null,
            shipping_cost_netto: parseFloat(document.querySelector('#delivery-netto')?.textContent.replace(" PLN", "")) || 0.0,
            shipping_cost_brutto: parseFloat(document.querySelector('#delivery-brutto')?.textContent.replace(" PLN", "")) || 0.0
        };

        console.log("[save_quote.js] Wysyłany payload:", payload);
        console.log(products)
        fetch('/calculator/save_quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(async res => {
                const text = await res.text();
                try {
                    const data = JSON.parse(text);
                    if (data.error) {
                        const err = document.createElement('p');
                        err.textContent = 'Błąd: ' + data.error;
                        err.style.color = 'red';
                        renderFeedback(err);
                        console.error("[save_quote.js] Błąd z backendu:", data.error);
                    } else {
                        stepSelect.style.display = 'none';
                        stepAdd.style.display = 'none';
                        stepSummary.style.display = 'none';
                        stepSuccess.style.display = 'block';

                        setTimeout(() => {
                            const display = document.querySelector('.quote-number-display');
                            if (display && data.quote_number) {
                                display.textContent = data.quote_number;
                            }
                        }, 100);

                        document.getElementById('newQuoteBtn')?.addEventListener('click', () => window.location.reload());
                        document.getElementById('closeModalBtn2')?.addEventListener('click', () => modal.style.display = 'none');

                        console.log("[save_quote.js] Wycena zapisana pomyślnie");
                    }
                } catch (err) {
                    const errMsg = document.createElement('p');
                    errMsg.textContent = 'Wystąpił błąd po stronie serwera. Odpowiedź nie była w formacie JSON.';
                    errMsg.style.color = 'red';
                    renderFeedback(errMsg);
                    console.error("[save_quote.js] Niepoprawny JSON z serwera:", text);
                }
            })
            .catch(err => {
                const errMsg = document.createElement('p');
                errMsg.textContent = 'Wystąpił błąd sieci lub serwera.';
                errMsg.style.color = 'red';
                renderFeedback(errMsg);
                console.error("[save_quote.js] Błąd fetch:", err);
            });
    });
});

// [save_quote.js] - Zbieranie danych z formularzy do zapisu wyceny (wersja z wariantami)
// Poprawiona funkcja collectQuoteData() w save_quote.js
// Poprawiona funkcja collectQuoteData() - zbiera wszystkie warianty, ale sumuje tylko wybrane
function collectQuoteData() {
    console.log("[collectQuoteData] Start zbierania danych z formularzy");

    const forms = document.querySelectorAll('.quote-form');
    const products = [];

    let sumProductBrutto = 0;
    let sumProductNetto = 0;
    let sumFinishingBrutto = 0;
    let sumFinishingNetto = 0;

    forms.forEach((form, index) => {
        const length = parseFloat(form.querySelector('[data-field="length"]')?.value || 0);
        const width = parseFloat(form.querySelector('[data-field="width"]')?.value || 0);
        const thickness = parseFloat(form.querySelector('[data-field="thickness"]')?.value || 0);
        const quantity = parseInt(form.querySelector('[data-field="quantity"]')?.value || 1);

        const finishingType = form.querySelector('[data-finishing-type].active')?.dataset.finishingType || null;
        const finishingVariant = form.querySelector('[data-finishing-variant].active')?.dataset.finishingVariant || null;
        const finishingColor = form.querySelector('[data-finishing-color].active')?.dataset.finishingColor || null;
        const finishingGloss = form.querySelector('[data-finishing-gloss].active')?.dataset.finishingGloss || null;

        // Zbierz WSZYSTKIE warianty do zapisu
        const variants = Array.from(form.querySelectorAll('.variants input[type="radio"]')).map(radio => {
            const brutto = parseFloat(radio.dataset.totalBrutto || 0);
            const netto = parseFloat(radio.dataset.totalNetto || 0);
            const volume = (length / 100) * (width / 100) * (thickness / 100);

            // Jeśli to wybrany wariant, dodaj do sumy
            if (radio.checked) {
                sumProductBrutto += brutto;
                sumProductNetto += netto;
            }

            return {
                variant_code: radio.value,
                is_selected: radio.checked,
                price_per_m3: parseFloat(radio.dataset.pricePerM3 || 0),
                volume_m3: volume,
                multiplier: parseFloat(radio.dataset.multiplier || 1),
                final_price: parseFloat(radio.dataset.finalPrice || 0),
                final_price_netto: netto,
                final_price_brutto: brutto,
                finishing_type: finishingType,
                finishing_variant: finishingVariant,
                finishing_color: finishingColor,
                finishing_gloss_level: finishingGloss,
                finishing_brutto: parseFloat(form.dataset.finishingBrutto || 0),
                finishing_netto: parseFloat(form.dataset.finishingNetto || 0)
            };
        });

        // Dodaj koszty wykończenia do sumy
        if (form.dataset.finishingBrutto) sumFinishingBrutto += parseFloat(form.dataset.finishingBrutto);
        if (form.dataset.finishingNetto) sumFinishingNetto += parseFloat(form.dataset.finishingNetto);

        products.push({
            index,
            length,
            width,
            thickness,
            quantity,
            variants: variants // Wszystkie warianty
        });
    });

    const shippingBrutto = parseFloat(document.getElementById('delivery-brutto')?.textContent.replace(" PLN", "")) || 0;
    const shippingNetto = parseFloat(document.getElementById('delivery-netto')?.textContent.replace(" PLN", "")) || 0;

    console.log(`[collectQuoteData] SUMA produktów brutto=${sumProductBrutto}, netto=${sumProductNetto}`);
    console.log(`[collectQuoteData] SUMA wykończenia brutto=${sumFinishingBrutto}, netto=${sumFinishingNetto}`);
    console.log(`[collectQuoteData] SUMA wysyłki brutto=${shippingBrutto}, netto=${shippingNetto}`);

    const result = {
        products,
        summary: {
            products_brutto: sumProductBrutto,
            products_netto: sumProductNetto,
            finishing_brutto: sumFinishingBrutto,
            finishing_netto: sumFinishingNetto,
            shipping_brutto: shippingBrutto,
            shipping_netto: shippingNetto,
            total_brutto: sumProductBrutto + sumFinishingBrutto + shippingBrutto,
            total_netto: sumProductNetto + sumFinishingNetto + shippingNetto
        }
    };

    console.log("[collectQuoteData] Zwracam podsumowanie:", result);
    return result;
}