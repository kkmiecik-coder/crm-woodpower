// modules/calculator/static/js/save_quote.js

document.addEventListener('DOMContentLoaded', function () {
    const modal = document.getElementById('saveQuoteModal');
    const openBtn = document.querySelector('.save-quote');
    const closeBtn = document.getElementById('closeSaveQuoteModal');
    const switchToAddClient = document.getElementById('switchToAddClient');
    const searchInput = document.getElementById('clientSearchInput');

    // NOWA FUNKCJA: Obsługa zmiany źródła zapytania
    function handleSourceChange() {
        const sourceSelect = document.querySelector('[name="quote_source"]');
        const phoneField = document.querySelector('[name="client_phone"]');
        const emailField = document.querySelector('[name="client_email"]');
        const phoneLabel = phoneField?.parentElement.querySelector('span');
        const emailLabel = emailField?.parentElement.querySelector('span');
        
        if (!sourceSelect) return;
        
        const selectedSource = sourceSelect.value.toLowerCase();
        const isOlxSource = selectedSource.includes('olx');
        
        console.log(`[handleSourceChange] Wybrano źródło: ${selectedSource}, isOLX: ${isOlxSource}`);
        
        if (isOlxSource) {
            // Dla OLX usuń wymagania i gwiazdki
            if (phoneLabel) {
                phoneLabel.innerHTML = phoneLabel.innerHTML.replace('<span style="color: #E2B007">*</span>', '');
            }
            if (emailLabel) {
                emailLabel.innerHTML = emailLabel.innerHTML.replace('<span style="color: #E2B007">*</span>', '');
            }
            
            // Aktualizuj tekst informacyjny
            const noteElement = document.querySelector('.input-note');
            if (noteElement) {
                noteElement.innerHTML = `
                    <span style="color: red">*</span> - wymagane pola<br>
                    <span style="color: #999">Dla OLX telefon i e-mail są opcjonalne</span>
                `;
            }
            
            console.log('[handleSourceChange] Usunięto wymagania dla OLX');
        } else {
            // Dla innych źródeł przywróć wymagania
            if (phoneLabel && !phoneLabel.innerHTML.includes('*')) {
                phoneLabel.innerHTML = phoneLabel.innerHTML.replace('Telefon', 'Telefon <span style="color: #E2B007">*</span>');
            }
            if (emailLabel && !emailLabel.innerHTML.includes('*')) {
                emailLabel.innerHTML = emailLabel.innerHTML.replace('E-mail', 'E-mail <span style="color: #E2B007">*</span>');
            }
            
            // Przywróć standardowy tekst informacyjny
            const noteElement = document.querySelector('.input-note');
            if (noteElement) {
                noteElement.innerHTML = `
                    <span style="color: red">*</span> - wymagane pola<br>
                    <span style="color: #E2B007">*</span> - jedno z pól jest wymagane
                `;
            }
            
            console.log('[handleSourceChange] Przywrócono standardowe wymagania');
        }
    }

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

            // POPRAWKA: Nowa struktura HTML z lepszą obsługą email/telefon
            resultsBox.innerHTML = data.map(client => {
                // Sprawdź czy mamy email i/lub telefon
                const hasEmail = client.email && client.email.trim() !== '';
                const hasPhone = client.phone && client.phone.trim() !== '';

                let contactInfo = '';
                if (hasEmail && hasPhone) {
                    // Oba - email nad telefonem
                    contactInfo = `${client.email}<br>${client.phone}`;
                } else if (hasEmail) {
                    // Tylko email
                    contactInfo = client.email;
                } else if (hasPhone) {
                    // Tylko telefon
                    contactInfo = client.phone;
                }
                // Jeśli ani email ani telefon - contactInfo pozostaje pusty

                return `
                <div class="search-client-result" 
                     data-id="${client.id}"
                     data-email="${client.email || ''}"
                     data-phone="${client.phone || ''}">
                    <strong>${client.name}</strong>
                    ${contactInfo ? `<span class="client-contact">${contactInfo}</span>` : ''}
                </div>
            `;
            }).join('');

            resultsBox.style.display = 'block';

            // POPRAWKA: Nowa obsługa kliknięcia - używamy data-attributes zamiast parsowania tekstu
            document.querySelectorAll('.search-client-result').forEach(el => {
                el.addEventListener('click', () => {
                    const clientId = el.dataset.id;
                    const clientName = el.querySelector('strong')?.textContent;
                    const clientEmail = el.dataset.email || '';
                    const clientPhone = el.dataset.phone || '';

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
                    document.querySelector('[name="client_email"]').value = clientEmail;
                    document.querySelector('[name="client_phone"]').value = clientPhone;

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

        // Użyj collectQuoteData() dla wszystkich danych
        const quoteData = collectQuoteData();
        const { 
            products, 
            summary, 
            courier_name, 
            shipping_cost_brutto, 
            shipping_cost_netto, 
            quote_client_type, 
            quote_multiplier 
        } = quoteData;
        
        const total_price = summary.total_brutto || 0.0;

        if (products.length === 0) {
            const err = document.createElement('p');
            err.textContent = 'Wycena nie może być pusta. Dodaj produkty.';
            err.style.color = 'red';
            renderFeedback(err);
            console.warn("[save_quote.js] Brak produktów – przerywamy zapis");
            return;
        }

        // Pobierz wykończenie z pierwszego formularza
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
            // Dane kuriera
            courier_name: courier_name,
            shipping_cost_netto: shipping_cost_netto,
            shipping_cost_brutto: shipping_cost_brutto,
            // Dane grupy cenowej
            quote_client_type: quote_client_type,
            quote_multiplier: quote_multiplier
        };

        console.log("[save_quote.js] Wysyłany payload:", payload);
        console.log("[save_quote.js] Dane kuriera:", { 
            courier_name, 
            shipping_cost_netto, 
            shipping_cost_brutto 
        });
        console.log("[save_quote.js] Grupa cenowa:", { 
            quote_client_type, 
            quote_multiplier 
        });
        
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

                        // Przyciski modala sukcesu
                        const newQuoteBtn = document.getElementById('newQuoteBtn');
                        if (newQuoteBtn) {
                            newQuoteBtn.onclick = () => window.location.reload();
                        }
                        
                        const closeBtn = document.getElementById('closeModalBtn2');
                        if (closeBtn) {
                            closeBtn.onclick = () => modal.style.display = 'none';
                        }
                        
                        const goToQuoteBtn = document.getElementById('goToQuoteBtn');
                        if (goToQuoteBtn && data.quote_id) {
                            goToQuoteBtn.onclick = () => {
                                console.log(`[save_quote] Przekierowanie do wyceny ID: ${data.quote_id}`);
                                window.location.href = `/quotes?open_quote=${data.quote_id}`;
                            };
                        }

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

    // NOWY EVENT LISTENER: Obsługa zmiany źródła zapytania
    document.addEventListener('change', function(e) {
        if (e.target.matches('[name="quote_source"]')) {
            handleSourceChange();
        }
    });

    // NOWY EVENT LISTENER: Obsługa przy pierwszym otwarciu modala
    document.addEventListener('click', function(e) {
        if (e.target.matches('#switchToAddClient')) {
            // Opóźnienie pozwala DOM się załadować
            setTimeout(handleSourceChange, 100);
        }
    });
});

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

    // Pobierz dane wysyłki z DOM
    const shippingBrutto = parseFloat(document.getElementById('delivery-brutto')?.textContent.replace(" PLN", "")) || 0;
    const shippingNetto = parseFloat(document.getElementById('delivery-netto')?.textContent.replace(" PLN", "")) || 0;
    const courierName = document.getElementById('courier-name')?.textContent.trim() || null;

    // Pobierz dane grupy cenowej z pierwszego formularza
    const firstForm = forms[0];
    const clientTypeSelect = firstForm?.querySelector('select[data-field="clientType"]');
    const selectedClientType = clientTypeSelect?.value || null;
    
    // Pobierz multiplier z globalnej zmiennej multiplierMapping
    let selectedMultiplier = 1.0;
    if (selectedClientType && window.multiplierMapping && window.multiplierMapping[selectedClientType]) {
        selectedMultiplier = window.multiplierMapping[selectedClientType];
    } else if (window.isPartner && window.userMultiplier) {
        selectedMultiplier = window.userMultiplier;
        // Dla partnerów nie ustawiamy selectedClientType na "Partner" 
        // bo to może nie być w tabeli multipliers
    }

    console.log(`[collectQuoteData] SUMA produktów brutto=${sumProductBrutto}, netto=${sumProductNetto}`);
    console.log(`[collectQuoteData] SUMA wykończenia brutto=${sumFinishingBrutto}, netto=${sumFinishingNetto}`);
    console.log(`[collectQuoteData] SUMA wysyłki brutto=${shippingBrutto}, netto=${shippingNetto}`);
    console.log(`[collectQuoteData] Kurier: ${courierName}`);
    console.log(`[collectQuoteData] Grupa cenowa: ${selectedClientType} (mnożnik: ${selectedMultiplier})`);

    const result = {
        products,
        // Dane kuriera
        courier_name: courierName,
        shipping_cost_brutto: shippingBrutto,
        shipping_cost_netto: shippingNetto,
        // Dane grupy cenowej
        quote_client_type: selectedClientType,
        quote_multiplier: selectedMultiplier,
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