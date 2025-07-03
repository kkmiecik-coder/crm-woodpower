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
        // Event listenery dla wariantów są już dodane w HTML
        // Sprawdzamy czy jest pending selection
        if (window.pendingVariantSelection) {
            console.log('[Quote3D] Wykonanie pending selection');
            this.selectVariant(window.pendingVariantSelection);
            window.pendingVariantSelection = null;
        }

        // Przycisk Reset
        if (this.btnReset) {
            this.btnReset.addEventListener('click', () => {
                if (this.viewer && typeof this.viewer.resetCamera === 'function') {
                    this.viewer.resetCamera();
                }
            });
        }

        this.setupARButton();

        console.log('[Quote3D] Event listenery skonfigurowane');
    }

    /**
    * Konfiguruje przycisk AR - ROZSZERZONA WERSJA Z TOUCH SUPPORT
    */
    setupARButton() {
        if (!this.btnAr) return;

        console.log('[Quote3D] Konfiguracja przycisku AR');

        // Dodaj event listenery dla różnych typów eventów
        const handleARClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Quote3D] AR button clicked/touched');
            this.handleARClick();
        };

        // Mouse events (desktop)
        this.btnAr.addEventListener('click', handleARClick);

        // Touch events (mobile iOS/Android)
        this.btnAr.addEventListener('touchstart', handleARClick);
        this.btnAr.addEventListener('touchend', (e) => {
            e.preventDefault(); // Zapobiega podwójnemu wywołaniu
        });

        // Dodaj dodatkowe style dla lepszej responsywności
        this.btnAr.style.cursor = 'pointer';
        this.btnAr.style.userSelect = 'none';
        this.btnAr.style.webkitUserSelect = 'none';
        this.btnAr.style.webkitTouchCallout = 'none';

        console.log('[Quote3D] Event listenery AR dodane (click + touch)');
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
        if (this.isLoading) {
            console.log('[Quote3D] Ładowanie w toku, ignoruj żądanie');
            return;
        }

        try {
            this.isLoading = true;
            this.showLoading();

            console.log('[Quote3D] Ładowanie produktu:', productData);

            // Sprawdź czy viewer jest gotowy
            if (!this.viewer) {
                throw new Error('Viewer nie jest zainicjalizowany');
            }

            // Załaduj produkt przez WoodViewer
            await this.viewer.loadProduct(productData);

            // Zaktualizuj informacje o produkcie
            this.updateProductInfo(productData);

            // Zapisz aktualny produkt
            this.currentProduct = productData;
            this.hideLoading();

            console.log('[Quote3D] Produkt załadowany pomyślnie');

        } catch (error) {
            console.error('[Quote3D] Błąd ładowania produktu:', error);
            this.showError(`Błąd ładowania: ${error.message}`);
        } finally {
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
    * Obsługuje kliknięcie w AR - ZAKTUALIZOWANA WERSJA
    */
    async handleARClick() {
        try {
            console.log('[Quote3D] Kliknięcie przycisku AR');

            if (!this.currentProduct) {
                alert('Najpierw wybierz wariant produktu');
                return;
            }

            console.log('[Quote3D] Dane produktu dla AR:', this.currentProduct);

            // Sprawdź czy ARHandler jest dostępny
            if (typeof window.ARHandler === 'undefined') {
                console.error('[Quote3D] ARHandler nie jest załadowany');
                alert('Błąd: Moduł AR nie jest dostępny. Odśwież stronę.');
                return;
            }

            // Przygotuj dane produktu w formacie oczekiwanym przez ARHandler
            const arProductData = {
                variant_code: this.currentProduct.variant_code,
                dimensions: {
                    length: this.currentProduct.dimensions.length,
                    width: this.currentProduct.dimensions.width,
                    thickness: this.currentProduct.dimensions.thickness
                },
                quantity: this.currentProduct.quantity || 1
            };

            console.log('[Quote3D] Wywołanie ARHandler.initiateAR');

            // Wywołaj ARHandler
            await window.ARHandler.initiateAR(arProductData);

        } catch (error) {
            console.error('[Quote3D] Błąd AR:', error);
            alert(`Błąd uruchamiania AR: ${error.message}`);
        }
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