/**
 * Menedżer zapisywania i przywracania wycen przez cookies
 * Automatycznie zapisuje stan wyceny i oferuje przywrócenie po odświeżeniu strony
 */
class QuoteDraftManager {
    constructor(userId) {
        this.COOKIE_NAME = `quote_draft_${userId || 'anonymous'}`;
        this.EXPIRY_MINUTES = 3;
        this.VERSION = '1.0';
        this.autosaveInterval = null;
        this.isEnabled = true;

        console.log('[QuoteDraft] Inicjalizacja menedżera dla użytkownika:', userId);
    }

    /**
     * Zapisuje aktualny stan wyceny do cookie
     */
    saveDraft() {
        try {
            const currentData = this.collectCurrentQuoteData();

            // Sprawdź czy dane są warte zapisania
            if (!this.hasValidQuoteData(currentData)) {
                console.log('[QuoteDraft] Brak danych wartych zapisania');
                return;
            }

            // Sprawdź czy istniejący draft ma inną grupę cenową
            const existingDraft = this.loadDraft();
            if (existingDraft && !this.hasClientGroupChanged(existingDraft)) {
                // Jeśli grupa się nie zmieniła, zaktualizuj tylko inne dane
                currentData.quote_client_type = existingDraft.quote_client_type;
                console.log('[QuoteDraft] Zachowano grupę cenową z istniejącego draft:', existingDraft.quote_client_type);
            }

            // Kompresja i zapis
            const compressedData = this.compressData(JSON.stringify(currentData));

            // Utwórz cookie z długim czasem wygaśnięcia
            const expireDate = new Date();
            expireDate.setMinutes(expireDate.getMinutes() + this.EXPIRY_MINUTES);

            document.cookie = `${this.COOKIE_NAME}=${compressedData}; expires=${expireDate.toUTCString()}; path=/; SameSite=Lax`;

            console.log('[QuoteDraft] Draft zapisany z grupą cenową:', currentData.quote_client_type);

        } catch (error) {
            console.error('[QuoteDraft] Błąd przy zapisywaniu draft:', error);
        }
    }

    /**
     * Ładuje draft z cookie
     */
    loadDraft() {
        try {
            const cookieValue = this.getCookie(this.COOKIE_NAME);

            if (!cookieValue) {
                return null;
            }

            // Dekompresja i parsowanie
            const decompressedData = this.decompressData(cookieValue);
            const draftData = JSON.parse(decompressedData);

            // Walidacja draft
            if (this.isValidDraft(draftData)) {
                console.log('[QuoteDraft] Załadowano draft z', this.formatTimeAgo(draftData.timestamp));
                return draftData;
            } else {
                console.log('[QuoteDraft] Draft nieważny, usuwam');
                this.clearDraft();
            }

        } catch (error) {
            console.error('[QuoteDraft] Błąd przy ładowaniu draft:', error);
            this.clearDraft();
        }

        return null;
    }

    /**
     * Usuwa draft cookie
     */
    clearDraft() {
        document.cookie = `${this.COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        console.log('[QuoteDraft] Usunięto draft cookie');
    }

    /**
     * Sprawdza czy draft zawiera jakieś istotne dane
     */
    hasValidQuoteData(data) {
        if (!data) return false;

        // Sprawdź produkty - musi mieć wymiary WIĘKSZE OD 0
        const hasValidProducts = data.products && data.products.some(product =>
            product.variants && product.variants.some(variant =>
                (variant.length > 0 && variant.width > 0 && variant.thickness > 0) ||
                (variant.quantity > 1) // lub ilość większa niż domyślna 1
            )
        );

        // Sprawdź dane klienta - muszą być niepuste
        const hasClientData = (data.client_name && data.client_name.trim()) ||
            (data.client_email && data.client_email.trim()) ||
            (data.client_phone && data.client_phone.trim()) ||
            (data.client_id && data.client_id.toString().trim());

        // Sprawdź źródło wyceny - musi być wybrane
        const hasSource = data.quote_source && data.quote_source.trim() && data.quote_source !== '';

        // Grupa cenowa inna niż domyślna
        const hasNonDefaultGroup = data.quote_client_type && data.quote_client_type !== 'Florek';

        const isValid = hasValidProducts || hasClientData || hasSource || hasNonDefaultGroup;

        console.log('[QuoteDraft] Walidacja draft:', {
            hasValidProducts,
            hasClientData,
            hasSource,
            hasNonDefaultGroup,
            isValid
        });

        return isValid;
    }

    /**
     * Waliduje czy draft jest prawidłowy i aktualny
     */
    isValidDraft(draftData) {
        if (!draftData || !draftData.timestamp || !draftData.version) {
            return false;
        }

        // Sprawdź wersję
        if (draftData.version !== this.VERSION) {
            console.log('[QuoteDraft] Niekompatybilna wersja draft:', draftData.version);
            return false;
        }

        // Sprawdź wiek (dodatkowa ochrona oprócz wygaśnięcia cookie)
        const now = Date.now();
        const age = now - draftData.timestamp;
        const maxAge = this.EXPIRY_MINUTES * 60 * 1000;

        if (age > maxAge) {
            console.log('[QuoteDraft] Draft wygasł');
            return false;
        }

        // Sprawdź czy to ta sama strona
        if (draftData.page_url !== window.location.pathname) {
            console.log('[QuoteDraft] Draft z innej strony');
            return false;
        }

        return true;
    }

    /**
     * Pobiera wartość cookie
     */
    getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) {
            return parts.pop().split(';').shift();
        }
        return null;
    }

    /**
     * Kompresja danych (prosty Base64 + URL encoding)
     */
    compressData(data) {
        try {
            return btoa(encodeURIComponent(data));
        } catch (error) {
            console.error('[QuoteDraft] Błąd kompresji:', error);
            return data;
        }
    }

    /**
     * Dekompresja danych
     */
    decompressData(data) {
        try {
            return decodeURIComponent(atob(data));
        } catch (error) {
            console.error('[QuoteDraft] Błąd dekompresji:', error);
            return data;
        }
    }

    /**
     * Zbiera TYLKO najważniejsze dane wyceny do zapisania w cookie
     */
    collectCurrentQuoteData() {
        const minimalData = {
            // Dane klienta
            client_name: this.getInputValue('[name="client_name"]'),
            client_email: this.getInputValue('[name="client_email"]'),
            client_phone: this.getInputValue('[name="client_phone"]'),
            client_id: this.getInputValue('[name="client_id"]'),
            quote_source: this.getSelectValue('[name="quote_source"]'),

            // Grupa cenowa
            quote_client_type: this.getSelectValue('[name="quote_client_type"]') || this.detectClientGroup(),

            // Produkty - TYLKO podstawowe dane
            products: this.collectMinimalProducts(),

            // Wybrane wykończenie (jeśli globalne)
            global_finishing: this.getGlobalFinishing(),

            timestamp: Date.now()
        };

        console.log('[QuoteDraft] Zebrano minimalne dane:', minimalData);
        return minimalData;
    }

    /**
     * Zbiera TYLKO kluczowe dane produktów - POPRAWIONA WERSJA
     */
    collectMinimalProducts() {
        const products = [];

        // Znajdź wszystkie formularze produktów
        const productForms = document.querySelectorAll('.quote-form');
        console.log('[QuoteDraft] Znaleziono', productForms.length, 'formularzy produktów');

        productForms.forEach((form, productIndex) => {
            const productData = {
                variants: []
            };

            // Znajdź pola wymiarów po ID (z Twojego debug)
            const lengthInput = form.querySelector('#length');
            const widthInput = form.querySelector('#width');
            const thicknessInput = form.querySelector('#thickness');
            const quantityInput = form.querySelector('#quantity');

            // Znajdź zaznaczony wariant (radio button)
            const selectedVariant = form.querySelector('input[type="radio"]:checked');

            // Znajdź select grupy cenowej
            const clientTypeSelect = form.querySelector('#clientType');

            console.log('[QuoteDraft] Formularz', productIndex + 1, '- wymiary:', {
                length: lengthInput?.value,
                width: widthInput?.value,
                thickness: thicknessInput?.value,
                quantity: quantityInput?.value,
                selectedVariant: selectedVariant?.value,
                clientType: clientTypeSelect?.value
            });

            // Jeśli są jakieś dane, dodaj wariant
            if (lengthInput || widthInput || thicknessInput || selectedVariant) {
                const variant = {
                    // Podstawowe wymiary
                    length: parseFloat(lengthInput?.value) || 0,
                    width: parseFloat(widthInput?.value) || 0,
                    thickness: parseFloat(thicknessInput?.value) || 0,
                    quantity: parseFloat(quantityInput?.value) || 1,

                    // Wariant drewna z zaznaczonego radio
                    variant_key: selectedVariant?.value || '',

                    // Wykończenie - zawsze Surowe jako domyślne
                    finishing_type: 'Surowe'
                };

                // Dodaj tylko jeśli ma jakieś istotne dane
                if (variant.length > 0 || variant.width > 0 || variant.thickness > 0 || variant.variant_key) {
                    productData.variants.push(variant);
                    console.log('[QuoteDraft] Dodano wariant:', variant);
                }
            }

            // Dodaj produkt tylko jeśli ma warianty
            if (productData.variants.length > 0) {
                products.push(productData);
            }
        });

        console.log('[QuoteDraft] Zebrano', products.length, 'produktów z', products.reduce((sum, p) => sum + p.variants.length, 0), 'wariantami');
        return products;
    }

    /**
     * Pomocnicza funkcja do znajdywania select w konkretnym formularzu
     */
    getSelectValueInForm(form, selector) {
        const element = form.querySelector(selector);
        return element ? element.value : '';
    }

    /**
     * Pobiera wartość numeryczną z elementu
     */
    getNumericValue(container, selector) {
        const element = container.querySelector(selector);
        if (!element) return 0;

        const value = parseFloat(element.value) || 0;
        return value;
    }

    /**
     * Pobiera wartość select z określonego kontenera
     */
    getSelectValue(selector, container = document) {
        const element = container.querySelector(selector);
        return element ? element.value : '';
    }


    /**
     * Ulepszone wykrywanie grupy cenowej
     */
    detectClientGroup() {
        // 1. Najpierw sprawdź select #clientType z formularza
        const clientTypeSelect = document.querySelector('#clientType');
        if (clientTypeSelect && clientTypeSelect.value && clientTypeSelect.value !== '') {
            console.log('[QuoteDraft] Wykryto grupę cenową z #clientType:', clientTypeSelect.value);
            return clientTypeSelect.value;
        }

        // 2. Sprawdź wszystkie selecty grup cenowych w formularzach produktów
        const productForms = document.querySelectorAll('.quote-form');
        for (const form of productForms) {
            const select = form.querySelector('select[data-field="clientType"]');
            if (select && select.value && select.value !== '') {
                console.log('[QuoteDraft] Wykryto grupę cenową z formularza produktu:', select.value);
                return select.value;
            }
        }

        // 3. Sprawdź zmienną globalną currentClientType
        if (typeof currentClientType !== 'undefined' && currentClientType && currentClientType !== '') {
            console.log('[QuoteDraft] Wykryto grupę cenową z currentClientType:', currentClientType);
            return currentClientType;
        }

        // 4. Z logów widzę że masz zmienną multiplierMapping
        if (typeof multiplierMapping !== 'undefined' && typeof userMultiplier !== 'undefined') {
            // Znajdź aktualnie wybraną grupę na podstawie userMultiplier
            const currentMultiplier = userMultiplier || 1;
            for (const [groupName, multiplier] of Object.entries(multiplierMapping)) {
                if (Math.abs(multiplier - currentMultiplier) < 0.001) { // Porównanie z tolerancją
                    console.log('[QuoteDraft] Wykryto grupę cenową z multiplierMapping:', groupName);
                    return groupName;
                }
            }
        }

        // 5. Sprawdź inne możliwe selektory
        const groupSelectors = [
            'select[name="quote_client_type"]',
            'select[name="client_group"]',
            '.client-group-select'
        ];

        for (const selector of groupSelectors) {
            const element = document.querySelector(selector);
            if (element && element.value && element.value !== '') {
                console.log('[QuoteDraft] Wykryto grupę cenową z selecta:', element.value);
                return element.value;
            }
        }

        // 6. TYLKO w ostateczności użyj domyślnej grupy
        console.warn('[QuoteDraft] Nie znaleziono grupy cenowej, używam domyślnej: Florek');
        return 'Florek';
    }

    hasClientGroupChanged(draftData) {
        if (!draftData || !draftData.quote_client_type) {
            return true; // Brak danych w draft - zawsze zapisz
        }

        const currentGroup = this.detectClientGroup();
        const savedGroup = draftData.quote_client_type;

        const hasChanged = currentGroup !== savedGroup;

        if (hasChanged) {
            console.log('[QuoteDraft] Grupa cenowa się zmieniła:', savedGroup, '->', currentGroup);
        }

        return hasChanged;
    }

    /**
     * Pobiera globalne ustawienia wykończenia
     */
    getGlobalFinishing() {
        return {
            type: this.getSelectValue('select[name="global_finishing_type"]'),
            variant: this.getSelectValue('select[name="global_finishing_variant"]'),
            color: this.getSelectValue('select[name="global_finishing_color"]')
        };
    }

    /**
     * Pomocnicze funkcje do zbierania danych z formularza
     */
    getInputValue(selector) {
        const element = document.querySelector(selector);
        return element ? element.value.trim() : '';
    }

    getSelectValue(selector) {
        const element = document.querySelector(selector);
        return element ? element.value : '';
    }

    collectProducts() {
        // Fallback - używa nowej metody minimalnych produktów
        return this.collectMinimalProducts();
    }

    /**
     * Formatuje czas "x minut temu"
     */
    formatTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        if (minutes < 1) {
            if (seconds < 10) return 'przed chwilą';
            return `${seconds} sekund temu`;
        }
        if (minutes === 1) return 'minutę temu';
        if (minutes < 5) return `${minutes} minut temu`;
        return `${minutes} minut temu`;
    }

    /**
     * Włącza/wyłącza autosave
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        console.log('[QuoteDraft] Autosave', enabled ? 'włączony' : 'wyłączony');
    }

    /**
     * Uruchamia okresowy autosave
     */
    startPeriodicSave(intervalSeconds = 30) {
        if (this.autosaveInterval) {
            clearInterval(this.autosaveInterval);
        }

        this.autosaveInterval = setInterval(() => {
            this.saveDraft();
        }, intervalSeconds * 1000);

        console.log('[QuoteDraft] Uruchomiono okresowy zapis co', intervalSeconds, 'sekund');
    }

    /**
     * Zatrzymuje okresowy autosave
     */
    stopPeriodicSave() {
        if (this.autosaveInterval) {
            clearInterval(this.autosaveInterval);
            this.autosaveInterval = null;
            console.log('[QuoteDraft] Zatrzymano okresowy zapis');
        }
    }

    /**
     * Funkcja testowa do debugowania selektorów - ULEPSZONA
     */
    debugSelectors() {
        console.log('=== SZCZEGÓŁOWY DEBUG SELEKTORÓW ===');

        const forms = document.querySelectorAll('.quote-form');
        console.log('Formularze (.quote-form):', forms.length);

        forms.forEach((form, i) => {
            console.log(`--- SZCZEGÓŁY FORMULARZA ${i + 1} ---`);

            // Wszystkie inputy w formularzu
            const allInputs = form.querySelectorAll('input');
            console.log('Wszystkie inputy:', allInputs.length);

            allInputs.forEach((input, j) => {
                console.log(`Input ${j + 1}:`, {
                    type: input.type,
                    name: input.name,
                    id: input.id,
                    placeholder: input.placeholder,
                    value: input.value,
                    className: input.className,
                    element: input
                });
            });

            // Wszystkie selecty
            const allSelects = form.querySelectorAll('select');
            console.log('Wszystkie selecty:', allSelects.length);

            allSelects.forEach((select, k) => {
                console.log(`Select ${k + 1}:`, {
                    name: select.name,
                    id: select.id,
                    value: select.value,
                    className: select.className,
                    element: select
                });
            });

            // Sprawdź czy są jakieś data-atrybuty
            const elementsWithData = form.querySelectorAll('[data-dimension], [data-field], [data-type]');
            console.log('Elementy z data-*:', elementsWithData.length);

            elementsWithData.forEach((el, m) => {
                console.log(`Data element ${m + 1}:`, {
                    dataset: el.dataset,
                    tagName: el.tagName,
                    element: el
                });
            });
        });

        console.log('=== KONIEC SZCZEGÓŁOWEGO DEBUG ===');
    }

    /**
     * Sprawdza i usuwa draft jeśli nie ma istotnych danych przy starcie
     */
    cleanupEmptyDraft() {
        const draft = this.loadDraft();
        if (draft && !this.hasValidQuoteData(draft.data)) {
            console.log('[QuoteDraft] Usuwam pusty draft przy starcie');
            this.clearDraft();
            return null;
        }
        return draft;
    }

}

