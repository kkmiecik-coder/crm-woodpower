// modules/calculator/static/js/save_quote.js

document.addEventListener('DOMContentLoaded', function () {
    const modal = document.getElementById('saveQuoteModal');
    const openBtn = document.querySelector('.save-quote');
    const closeBtn = document.getElementById('closeSaveQuoteModal');
    const switchToAddClient = document.getElementById('switchToAddClient');
    const searchInput = document.getElementById('clientSearchInput');

    // POPRAWIONA FUNKCJA: Obsługa zmiany źródła zapytania
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
            
            // 🆕 KLUCZOWA POPRAWKA: Usuń atrybut required z pól
            if (phoneField) {
                phoneField.removeAttribute('required');
                phoneField.setAttribute('data-olx-optional', 'true');
            }
            if (emailField) {
                emailField.removeAttribute('required');
                emailField.setAttribute('data-olx-optional', 'true');
            }
            
            // Aktualizuj tekst informacyjny
            const noteElement = document.querySelector('.input-note');
            if (noteElement) {
                noteElement.innerHTML = `
                    <span style="color: red">*</span> - wymagane pola<br>
                    <span style="color: #999">Dla OLX telefon i e-mail są opcjonalne</span>
                `;
            }
            
            console.log('[handleSourceChange] Usunięto wymagania dla OLX (włącznie z atrybutem required)');
        } else {
            // Dla innych źródeł przywróć wymagania
            if (phoneLabel && !phoneLabel.innerHTML.includes('*')) {
                phoneLabel.innerHTML = phoneLabel.innerHTML.replace('Telefon', 'Telefon <span style="color: #E2B007">*</span>');
            }
            if (emailLabel && !emailLabel.innerHTML.includes('*')) {
                emailLabel.innerHTML = emailLabel.innerHTML.replace('E-mail', 'E-mail <span style="color: #E2B007">*</span>');
            }
            
            // 🆕 KLUCZOWA POPRAWKA: Przywróć logikę "jedno z pól wymagane"
            if (phoneField) {
                phoneField.removeAttribute('data-olx-optional');
                // Nie dodajemy required="required" tutaj, bo to jest logika "jedno z pól"
            }
            if (emailField) {
                emailField.removeAttribute('data-olx-optional');
                // Nie dodajemy required="required" tutaj, bo to jest logika "jedno z pól"
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

    // 🆕 NOWA FUNKCJA: Niestandardowa walidacja uwzględniająca źródło OLX
    function validateEmailPhoneFields() {
        const sourceSelect = document.querySelector('[name="quote_source"]');
        const phoneField = document.querySelector('[name="client_phone"]');
        const emailField = document.querySelector('[name="client_email"]');
        
        if (!sourceSelect || !phoneField || !emailField) {
            return true; // Jeśli brak pól, nie blokuj
        }
        
        const selectedSource = sourceSelect.value.toLowerCase();
        const isOlxSource = selectedSource.includes('olx');
        
        const phoneValue = phoneField.value.trim();
        const emailValue = emailField.value.trim();
        
        if (isOlxSource) {
            // Dla OLX pola są opcjonalne - zawsze przejdź
            console.log('[validateEmailPhoneFields] OLX: pola opcjonalne, walidacja przeszła');
            clearFieldValidationError(phoneField);
            clearFieldValidationError(emailField);
            return true;
        } else {
            // Dla innych źródeł: wymagany email LUB telefon
            const hasEmailOrPhone = phoneValue || emailValue;
            
            if (!hasEmailOrPhone) {
                // Pokaż błąd na obu polach
                showFieldValidationError(phoneField, 'Wymagany jest telefon lub e-mail');
                showFieldValidationError(emailField, 'Wymagany jest telefon lub e-mail');
                console.log('[validateEmailPhoneFields] Standardowe źródło: brak telefonu i e-maila');
                return false;
            }
            
            // Wyczyść ewentualne błędy
            clearFieldValidationError(phoneField);
            clearFieldValidationError(emailField);
            console.log('[validateEmailPhoneFields] Standardowe źródło: walidacja przeszła');
            return true;
        }
    }

    // 🆕 FUNKCJE POMOCNICZE: Obsługa błędów walidacji
    function showFieldValidationError(field, message) {
        // Usuń poprzednie błędy
        clearFieldValidationError(field);
        
        // Dodaj klasę błędu
        field.classList.add('error');
        
        // Utwórz element błędu
        const errorElement = document.createElement('div');
        errorElement.className = 'field-error';
        errorElement.textContent = message;
        errorElement.style.color = 'red';
        errorElement.style.fontSize = '12px';
        errorElement.style.marginTop = '4px';
        
        // Wstaw po polu
        field.parentNode.insertBefore(errorElement, field.nextSibling);
    }

    function clearFieldValidationError(field) {
        field.classList.remove('error');
        
        // Usuń element błędu jeśli istnieje
        const errorElement = field.nextSibling;
        if (errorElement && errorElement.classList && errorElement.classList.contains('field-error')) {
            errorElement.remove();
        }
    }

    // 🆕 ZMODYFIKOWANA FUNKCJA: Główna walidacja formularza przed zapisem
    function validateSaveQuoteForm() {
        console.log('[validateSaveQuoteForm] Rozpoczynam walidację...');
        
        // 🆕 POPRAWKA: Pola są bezpośrednio w modalu, nie w tagu <form>
        const modal = document.querySelector('#saveQuoteModal');
        if (!modal) {
            console.log('[validateSaveQuoteForm] Brak modala!');
            return false;
        }
        
        const requiredFields = modal.querySelectorAll('[required]');
        let isValid = true;
        
        console.log(`[validateSaveQuoteForm] Znaleziono ${requiredFields.length} pól required:`);
        
        // Sprawdź wszystkie standardowe wymagane pola
        requiredFields.forEach((field, index) => {
            const value = field.value.trim();
            const fieldName = field.name || field.id || `pole-${index}`;
            
            if (!value) {
                field.classList.add('error');
                isValid = false;
                console.log(`[validateSaveQuoteForm] ❌ Pole "${fieldName}" jest puste (required)`);
            } else {
                field.classList.remove('error');
                console.log(`[validateSaveQuoteForm] ✅ Pole "${fieldName}" = "${value}"`);
            }
        });
        
        // 🆕 KLUCZOWA ZMIANA: Niestandardowa walidacja email/telefon
        if (!validateEmailPhoneFields()) {
            isValid = false;
            console.log('[validateSaveQuoteForm] ❌ Walidacja email/telefon nie przeszła');
        } else {
            console.log('[validateSaveQuoteForm] ✅ Walidacja email/telefon przeszła');
        }

        // NOWA WALIDACJA: Sprawdź dostępność wariantów
        if (window.variantAvailability && !window.variantAvailability.validate()) {
            console.log('[validateSaveQuoteForm] Walidacja dostępności wariantów nie powiodła się');
            return false;
        }

        // Sprawdź czy wszystkie produkty mają przynajmniej jeden dostępny wariant
        const forms = Array.from(document.querySelectorAll('.quote-form'));
        for (let i = 0; i < forms.length; i++) {
            const form = forms[i];
            const availableVariants = window.variantAvailability ?
                window.variantAvailability.getAvailable(form) : [];

            if (availableVariants.length === 0) {
                alert(`Produkt ${i + 1} nie ma żadnych dostępnych wariantów.`);
                return false;
            }

            // Sprawdź czy zaznaczony wariant jest dostępny
            const selectedRadio = form.querySelector('input[type="radio"]:checked');
            if (selectedRadio && !availableVariants.includes(selectedRadio.value)) {
                alert(`Produkt ${i + 1} ma zaznaczony niedostępny wariant.`);
                return false;
            }
        }

        console.log(`[validateSaveQuoteForm] Wynik końcowy: ${isValid ? 'PRZESZŁA' : 'NIE PRZESZŁA'}`);
        return isValid;
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

    // 🆕 ZMODYFIKOWANY EVENT LISTENER dla przycisku zapisz
    saveQuoteBtn?.addEventListener('click', () => {
        console.log("[save_quote.js] Kliknięto Zapisz wycenę");

        // 🆕 NAJPIERW: Walidacja uwzględniająca źródło OLX
        if (!validateSaveQuoteForm()) {
            console.log('[save_quote.js] Walidacja formularza nie przeszła');
            const err = document.createElement('p');
            err.textContent = 'Uzupełnij wszystkie wymagane pola.';
            err.style.color = 'red';
            renderFeedback(err);
            return;
        }

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

        // 🆕 ZMODYFIKOWANA WALIDACJA: Uwzględnij źródło OLX
        const sourceSelect = document.querySelector('[name="quote_source"]');
        const isOlxSource = sourceSelect && sourceSelect.value.toLowerCase().includes('olx');
        
        if (!isOlxSource && !clientPhone && !clientEmail) {
            const err = document.createElement('p');
            err.textContent = 'Podaj telefon lub e-mail klienta.';
            err.style.color = 'red';
            renderFeedback(err);
            console.warn("[save_quote.js] Brak telefonu lub e-maila dla źródła innego niż OLX – przerywamy zapis");
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
    console.log("[collectQuoteData] Rozpoczynam zbieranie danych wyceny...");

    const forms = Array.from(document.querySelectorAll('.quote-form'));
    const products = [];
    let sumProductBrutto = 0;
    let sumProductNetto = 0;
    let sumFinishingBrutto = 0;
    let sumFinishingNetto = 0;

    forms.forEach((form, index) => {
        console.log(`[collectQuoteData] Przetwarzam produkt ${index + 1}:`);

        const checkboxes = form.querySelectorAll('.variant-availability-checkbox');
        const variants = [];

        checkboxes.forEach(checkbox => {
            const variantCode = checkbox.dataset.variant;
            const isAvailable = checkbox.checked; // Stan checkboxa = widoczność na stronie klienta
            const radio = form.querySelector(`input[type="radio"][value="${variantCode}"]`);
            const isSelected = radio && radio.checked;

            console.log(`  - Wariant ${variantCode}: show_on_client_page=${isAvailable}, is_selected=${isSelected}`);

            // ZMIANA: Dodajemy WSZYSTKIE warianty do payloadu, niezależnie od stanu checkboxa
            // ZMIANA: Pobierz ceny z obliczonych wartości wariantów
            let finalPriceNetto = 0;
            let finalPriceBrutto = 0;

            if (isSelected) {
                // Znajdź odpowiedni element z ceną dla zaznaczonego wariantu
                const selectedRadio = form.querySelector(`input[type="radio"][value="${variantCode}"]:checked`);
                if (selectedRadio) {
                    const variantRow = selectedRadio.closest('.variant-option');
                    if (variantRow) {
                        // Pobierz ceny z wyświetlanych elementów
                        const totalBruttoElement = variantRow.querySelector('.total-brutto');
                        const totalNettoElement = variantRow.querySelector('.total-netto');

                        if (totalBruttoElement) {
                            const bruttoText = totalBruttoElement.textContent.replace(/[^0-9.,]/g, '');
                            finalPriceBrutto = parseFloat(bruttoText.replace(',', '.')) || 0;
                        }

                        if (totalNettoElement) {
                            const nettoText = totalNettoElement.textContent.replace(/[^0-9.,]/g, '');
                            finalPriceNetto = parseFloat(nettoText.replace(',', '.')) || 0;
                        }
                    }
                }
            }

            const variantData = {
                variant_code: variantCode,
                is_selected: isSelected,
                show_on_client_page: isAvailable, // NOWE POLE: checkbox określa widoczność na stronie klienta
                // Wymiary pobieramy z formularza, a nie z wariantów
                length_cm: parseInt(form.querySelector('[data-field="length"]')?.value) || 0,
                width_cm: parseInt(form.querySelector('[data-field="width"]')?.value) || 0,
                thickness_cm: parseInt(form.querySelector('[data-field="thickness"]')?.value) || 0,
                volume_m3: parseFloat(form.dataset.volumeM3) || 0,
                price_per_m3: parseFloat(form.dataset.pricePerM3) || 0,
                multiplier: parseFloat(form.dataset.multiplier) || 1,
                final_price_netto: finalPriceNetto,
                final_price_brutto: finalPriceBrutto
            };

            variants.push(variantData);

            // Dodaj do sum tylko zaznaczone warianty (niezależnie od widoczności)
            if (isSelected) {
                sumProductBrutto += variantData.final_price_brutto;
                sumProductNetto += variantData.final_price_netto;
            }
        });

        // Pobierz dane wykończenia
        const finishingData = {
            finishing_type: form.querySelector('.finishing-type-select')?.value || '',
            finishing_variant: form.querySelector('.finishing-variant-select')?.value || '',
            finishing_color: form.querySelector('.finishing-color-select')?.value || '',
            finishing_gloss_level: form.querySelector('.finishing-gloss-select')?.value || '',
            finishing_price_netto: parseFloat(form.dataset.finishingPriceNetto) || 0,
            finishing_price_brutto: parseFloat(form.dataset.finishingPriceBrutto) || 0
        };

        // Dodaj wykończenie do sum
        sumFinishingBrutto += finishingData.finishing_price_brutto;
        sumFinishingNetto += finishingData.finishing_price_netto;

        products.push({
            product_index: index,
            variants: variants,
            finishing: finishingData
        });
    });

    // Pobierz dane kuriera z DOM
    let courierName = '';
    let shippingBrutto = 0;
    let shippingNetto = 0;

    // Spróbuj pobrać dane kuriera z elementów DOM
    const courierNameElement = document.getElementById('courier-name');
    const shippingBruttoElement = document.getElementById('delivery-brutto');
    const shippingNettoElement = document.getElementById('delivery-netto');

    if (courierNameElement) {
        courierName = courierNameElement.textContent.trim();
    }

    if (shippingBruttoElement) {
        const bruttoText = shippingBruttoElement.textContent.replace(/[^0-9.,]/g, '');
        shippingBrutto = parseFloat(bruttoText.replace(',', '.')) || 0;
    }

    if (shippingNettoElement) {
        const nettoText = shippingNettoElement.textContent.replace(/[^0-9.,]/g, '');
        shippingNetto = parseFloat(nettoText.replace(',', '.')) || 0;
    }

    // Fallback - jeśli courierModal jest dostępny, użyj go
    if (typeof courierModal !== 'undefined' && courierModal.getSelectedCourier) {
        const selectedCourier = courierModal.getSelectedCourier();
        if (selectedCourier) {
            courierName = selectedCourier.name || courierName;
            shippingBrutto = selectedCourier.grossPrice || shippingBrutto;
            shippingNetto = selectedCourier.netPrice || shippingNetto;
        }
    }

    // Pobierz dane grupy cenowej
    const clientTypeSelect = document.getElementById('client-type-select');
    let selectedClientType = clientTypeSelect?.value || '';
    const selectedOption = clientTypeSelect?.options[clientTypeSelect.selectedIndex];
    const selectedMultiplier = selectedOption ? parseFloat(selectedOption.dataset.multiplier) : 1.0;

    // Fallback dla przypadku gdy grupa cenowa nie została wybrana
    if (!selectedClientType) {
        selectedClientType = "Partner"; // Domyślnie ustawiamy na "Partner" 
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

function logVariantAvailability() {
    console.log("[logVariantAvailability] Stan dostępności wariantów:");

    const forms = Array.from(document.querySelectorAll('.quote-form'));
    forms.forEach((form, index) => {
        console.log(`  Produkt ${index + 1}:`);

        const checkboxes = form.querySelectorAll('.variant-availability-checkbox');
        checkboxes.forEach(checkbox => {
            const variantCode = checkbox.dataset.variant;
            const isAvailable = checkbox.checked;
            const radio = form.querySelector(`input[type="radio"][value="${variantCode}"]`);
            const isSelected = radio && radio.checked;

            console.log(`    ${variantCode}: ${isAvailable ? 'dostępny' : 'niedostępny'}${isSelected ? ' (zaznaczony)' : ''}`);
        });
    });
}

// Eksportuj funkcję do debugowania
window.logVariantAvailability = logVariantAvailability;