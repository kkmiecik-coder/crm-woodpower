// app/modules/preview3d_ar/static/js/quote-3d.js

class Quote3DHandler {
    constructor() {
        this.config = window.Quote3DConfig;
        this.viewer = null;
        this.currentProduct = null;
        this.isLoading = false;

        // Elementy DOM
        this.canvasEl = document.getElementById('wood-canvas');
        this.btnReset = document.getElementById('btn-reset');
        this.btnAr = document.getElementById('btn-ar');
        this.currentTitleEl = document.getElementById('current-title');
        this.currentDimensionsEl = document.getElementById('current-dimensions');
        this.loadingEl = document.getElementById('loading');
        this.errorEl = document.getElementById('error-message');
        this.errorTextEl = document.getElementById('error-text');

        console.log('[Quote3D] Inicjalizacja handlera - uproszczona wersja');
    }

    /**
     * Główna metoda inicjalizacji
     */
    async init() {
        try {
            console.log('[Quote3D] Inicjalizacja viewer\'a');
            await this.initializeViewer();

            console.log('[Quote3D] Konfiguracja event listenerów');
            this.setupEventListeners();

            // Załaduj domyślny produkt
            if (this.config.defaultProduct) {
                console.log('[Quote3D] Ładowanie domyślnego produktu');
                await this.loadProduct(this.config.defaultProduct);
            }

            console.log('[Quote3D] Viewer zainicjalizowany pomyślnie');

        } catch (error) {
            console.error('[Quote3D] Błąd inicjalizacji:', error);
            this.showError(`Błąd inicjalizacji: ${error.message}`);
        }
    }

    /**
     * Konfiguruje event listenery
     */
    setupEventListeners() {
        // Obsługa „pending” wyboru wariantu
        if (window.pendingVariantSelection) {
            this.selectVariant(window.pendingVariantSelection);
            window.pendingVariantSelection = null;
        }

        // Reset kamery
        if (this.btnReset) {
            this.btnReset.addEventListener('click', () => {
                if (this.viewer && typeof this.viewer.resetCamera === 'function') {
                    this.viewer.resetCamera();
                }
            });
        }

        // Przygotuj przycisk AR
        this.setupARButton();

        console.log('[Quote3D] Event listenery skonfigurowane');
    }

    async handleARClick() {
        console.log('[Quote3D] handleARClick start');

        // 1) Upewnij się, że wybrano produkt
        if (!this.currentProduct) {
            alert('Najpierw wybierz wariant produktu');
            return;
        }

        // 2) Sprawdź, czy ARHandler jest załadowany
        if (typeof window.ARHandler === 'undefined') {
            console.error('[Quote3D] ARHandler nie jest załadowany');
            alert('Błąd: Moduł AR nie jest dostępny. Odśwież stronę.');
            return;
        }

        // 3) Przygotuj dane dla ARHandler
        const arProductData = {
            variant_code: this.currentProduct.variant_code,
            dimensions: {
                length: this.currentProduct.dimensions.length,
                width: this.currentProduct.dimensions.width,
                thickness: this.currentProduct.dimensions.thickness
            },
            quantity: this.currentProduct.quantity || 1
        };

        console.log('[Quote3D] Generowanie USDZ przez ARHandler...', arProductData);

        // 4) Zablokuj przycisk na czas generowania
        this.btnAr.disabled = true;

        try {
            // 5) Pobierz URL do pliku USDZ
            const usdzUrl = await window.ARHandler.generateUSDZFile(arProductData);
            console.log('[Quote3D] generateUSDZFile zwróciło URL:', usdzUrl);

            // 6) Utwórz link <a rel="ar"> i kliknij w nim
            const link = document.createElement('a');
            link.href = usdzUrl;
            link.rel = 'ar';
            link.type = 'model/vnd.usd+zip';
            link.style.display = 'none';
            document.body.appendChild(link);

            console.log('[Quote3D] Wywołuję link.click()');
            link.click();

            // 7) Posprzątaj
            setTimeout(() => {
                document.body.removeChild(link);
            }, 1000);

            console.log('[Quote3D] Quick Look powinien się otworzyć');

        } catch (error) {
            console.error('[Quote3D] Błąd AR:', error);
            alert(`Błąd uruchamiania AR: ${error.message}`);
        } finally {
            // 8) Odblokuj przycisk
            this.btnAr.disabled = false;
        }
    }


    /**
    * Dodaje click/touch listener tylko do handleARClick()
    */
    setupARButton() {
        if (!this.btnAr) return;
        console.log('[Quote3D] Konfiguracja przycisku AR');
        const handler = e => {
            e.preventDefault();
            e.stopPropagation();
            this.handleARClick();
        };
        this.btnAr.addEventListener('click', handler);
        this.btnAr.addEventListener('touchstart', handler);
        // poprawa UX na dotyku
        this.btnAr.style.cursor = 'pointer';
        this.btnAr.style.userSelect = 'none';
    }

    /**
     * Obsługuje wybór wariantu
     */
    async selectVariant(btn) {
        try {
            console.log('[Quote3D] Wybrano wariant:', btn.dataset);

            // KLUCZOWA ZMIANA: Nie zmieniamy zielonych znaczków ✓ 
            // Zamiast tego używamy wizualnego oznaczenia aktualnie przeglądanego wariantu
            
            // Usuń poprzednie oznaczenia "currently viewing"
            document.querySelectorAll('.variant-btn').forEach(variantBtn => {
                variantBtn.classList.remove('currently-viewing');
                // Usuń badge "obecnie wyświetlany" jeśli istnieje
                const viewingBadge = variantBtn.querySelector('.viewing-badge');
                if (viewingBadge) {
                    viewingBadge.remove();
                }
            });

            // Dodaj oznaczenie "obecnie wyświetlany" do nowego wariantu
            btn.classList.add('currently-viewing');

            // Przygotuj dane produktu do załadowania
            const productData = {
                variant_code: btn.dataset.variantCode,
                product_index: parseInt(btn.dataset.productIndex),
                dimensions: {
                    length: parseFloat(btn.dataset.length),
                    width: parseFloat(btn.dataset.width),
                    thickness: parseFloat(btn.dataset.thickness)
                },
                quantity: parseInt(btn.dataset.quantity),
                has_textures: btn.dataset.hasTextures === 'true'
            };

            console.log('[Quote3D] Ładowanie produktu:', productData);

            // Załaduj produkt w viewer'ze
            await this.loadProduct(productData);

            console.log('[Quote3D] Wariant wybrany i załadowany pomyślnie');

        } catch (error) {
            console.error('[Quote3D] Błąd wyboru wariantu:', error);
            this.showError(`Błąd wyboru wariantu: ${error.message}`);
        }
    }

    /**
     * Ładuje produkt w viewer'ze
     */
    async loadProduct(productData) {
        if (this.isLoading) return;
        this.isLoading = true;
        this.showLoading();
        try {
            await this.viewer.loadProduct(productData);
            this.updateProductInfo(productData);
            this.currentProduct = productData;

            // --- PREFETCH USDZ ---
            try {
                const usdzUrl = await window.ARHandler.generateUSDZFile(productData);
                this.currentProduct.usdzUrl = usdzUrl;
                let arLink = document.getElementById('ar-link');
                if (!arLink) {
                    arLink = document.createElement('a');
                    arLink.id = 'ar-link';
                    arLink.rel = 'ar';
                    arLink.type = 'model/vnd.usd+zip';
                    arLink.style.display = 'none';
                    document.body.appendChild(arLink);
                }
                arLink.href = usdzUrl;
                console.log('[Quote3D] USDZ prefetched:', usdzUrl);
            } catch (prefetchError) {
                console.warn('[Quote3D] Prefetch USDZ failed:', prefetchError);
            }

        } catch (err) {
            this.showError(`Błąd ładowania produktu: ${err.message}`);
        } finally {
            this.hideLoading();
            this.isLoading = false;
        }
    }

    /**
     * Inicjalizuje WoodViewer
     */
    async initializeViewer() {
        try {
            console.log('[Quote3D] Tworzenie WoodViewer...');
            
            if (typeof WoodViewer === 'undefined') {
                throw new Error('WoodViewer nie jest załadowany');
            }

            this.viewer = new WoodViewer(this.canvasEl);
            await this.viewer.init();

            // Sprawdź czy wszystko zostało zainicjalizowane
            if (!this.viewer.scene || !this.viewer.camera || !this.viewer.renderer) {
                throw new Error('Błąd inicjalizacji sceny 3D');
            }

            console.log('[Quote3D] WoodViewer zainicjalizowany');

            // Zapisz referencję globalnie dla debugowania
            window.currentViewer = this.viewer;

        } catch (error) {
            console.error('[Quote3D] Błąd inicjalizacji viewera:', error);
            throw error;
        }
    }

    /**
     * Aktualizuje informacje o produkcie w headerze
     */
    updateProductInfo(productData) {
        console.log('[Quote3D] Aktualizacja informacji produktu:', productData);
        
        if (this.currentTitleEl) {
            // Użyj funkcji tłumaczenia jeśli jest dostępna
            const translatedName = window.translateVariantCode ? 
                window.translateVariantCode(productData.variant_code) : 
                productData.variant_code;
            
            this.currentTitleEl.textContent = translatedName;
            console.log('[Quote3D] Zaktualizowano tytuł na:', translatedName);
        }

        if (this.currentDimensionsEl && productData.dimensions) {
            const { length, width, thickness } = productData.dimensions;
            const dimensionsText = `${length}×${width}×${thickness} cm`;
            this.currentDimensionsEl.textContent = dimensionsText;
            console.log('[Quote3D] Zaktualizowano wymiary na:', dimensionsText);
        }
    }

    /**
     * Pokazuje komunikat o ładowaniu
     */
    showLoading() {
        console.log('[Quote3D] Pokazano loading...');
        if (this.loadingEl) {
            this.loadingEl.style.display = 'flex';
        }
    }

    /**
     * Ukrywa komunikat o ładowaniu
     */
    hideLoading() {
        console.log('[Quote3D] Ukryto loading...');
        if (this.loadingEl) {
            this.loadingEl.style.display = 'none';
        }
    }

    /**
     * Pokazuje błąd
     */
    showError(message) {
        console.error('[Quote3D] Error:', message);
        
        if (this.errorTextEl) {
            this.errorTextEl.textContent = message;
        }
        
        if (this.errorEl) {
            this.errorEl.style.display = 'block';
        }

        this.hideLoading();
        
        // Pokazuj alert tylko dla krytycznych błędów
        if (message.includes('nie jest załadowany') || message.includes('nie jest zainicjalizowany')) {
            alert(`Błąd aplikacji: ${message}\n\nSpróbuj odświeżyć stronę.`);
        }
    }

    /**
     * Ukrywa błąd
     */
    hideError() {
        if (this.errorEl) {
            this.errorEl.style.display = 'none';
        }
    }

    /**
     * Sprawdza obsługę AR
     */
    isARSupported() {
        return 'xr' in navigator && 'isSessionSupported' in navigator.xr;
    }

    /**
     * Debug: Status aplikacji
     */
    getStatus() {
        return {
            isInitialized: !!this.viewer,
            currentProduct: this.currentProduct,
            isLoading: this.isLoading,
            viewerStatus: this.viewer ? this.viewer.getStatus() : null,
            elements: {
                loading: !!this.loadingEl,
                error: !!this.errorEl,
                canvas: !!this.canvasEl
            }
        };
    }
}

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Quote3D] DOM załadowany, inicjalizacja...');

    // Sprawdź zależności
    if (typeof THREE === 'undefined') {
        console.error('[Quote3D] Three.js nie jest załadowany!');
        alert('Błąd: Three.js nie jest załadowany. Odśwież stronę.');
        return;
    }

    if (typeof WoodViewer === 'undefined') {
        console.error('[Quote3D] WoodViewer nie jest załadowany!');
        alert('Błąd: WoodViewer nie jest załadowany. Sprawdź pliki JavaScript.');
        return;
    }

    // Sprawdź czy jest konfiguracja
    if (typeof window.Quote3DConfig === 'undefined') {
        console.error('[Quote3D] Brak konfiguracji Quote3DConfig!');
        alert('Błąd: Brak konfiguracji aplikacji.');
        return;
    }

    console.log('[Quote3D] Wszystkie zależności załadowane poprawnie');
    console.log('[Quote3D] Konfiguracja:', window.Quote3DConfig);

    // Utwórz i zainicjalizuj handler
    try {
        const quote3D = new Quote3DHandler();
        window.quote3DHandler = quote3D; // Dla debugowania

        console.log('[Quote3D] Rozpoczęcie inicjalizacji handlera...');
        await quote3D.init();
        console.log('[Quote3D] Handler zainicjalizowany pomyślnie');
        
    } catch (error) {
        console.error('[Quote3D] Błąd inicjalizacji handlera:', error);
        alert(`Błąd inicjalizacji: ${error.message}`);
    }
});

// Export dla compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Quote3DHandler;
}

console.log('[Quote3D] Script załadowany - uproszczona wersja');