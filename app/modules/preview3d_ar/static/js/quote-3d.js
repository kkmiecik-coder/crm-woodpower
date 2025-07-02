// app/modules/preview3d_ar/static/js/quote-3d.js

/**
 * Quote 3D Viewer - obsługa wycen z wieloma wariantami
 * Uproszczona wersja skupiona na wyborze wariantów
 */

class Quote3DHandler {
    constructor() {
        this.viewer = null;
        this.currentProduct = null;
        this.isLoading = false;

        // Elementy DOM
        this.loadingEl = document.getElementById('loading');
        this.errorEl = document.getElementById('error-message');
        this.errorTextEl = document.getElementById('error-text');
        this.currentTitleEl = document.getElementById('current-product-title');
        this.currentDimensionsEl = document.getElementById('current-product-dimensions');
        this.canvasEl = document.getElementById('wood-canvas');
        this.btnReset = document.getElementById('btn-reset');
        this.btnAr = document.getElementById('btn-ar');
        this.arInfoEl = document.getElementById('ar-info');

        console.log('[Quote3D] Inicjalizacja handlera - uproszczona wersja');
    }

    /**
     * Inicjalizuje viewer - wywołaj po załadowaniu DOM
     */
    async init() {
        try {
            console.log('[Quote3D] Inicjalizacja viewer\'a');

            this.setupEventListeners();
            this.setupARButton();

            // Załaduj domyślny produkt jeśli dostępny
            if (window.Quote3DConfig && window.Quote3DConfig.defaultProduct) {
                await this.loadProduct(window.Quote3DConfig.defaultProduct);
            } else {
                this.showError('Brak dostępnych wariantów z teksturami');
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

        console.log('[Quote3D] Event listenery skonfigurowane');
    }

    /**
     * Konfiguruje przycisk AR
     */
    setupARButton() {
        if (!this.btnAr) return;

        const isARSupported = this.isARSupported();
        
        if (isARSupported) {
            this.btnAr.addEventListener('click', () => {
                this.handleARClick();
            });
        } else {
            // Ukryj przycisk AR jeśli nie jest obsługiwany
            this.btnAr.style.display = 'none';
        }
    }

    /**
     * Obsługuje wybór wariantu
     */
    async selectVariant(card) {
        try {
            // Usuń zaznaczenie z poprzedniego wariantu
            document.querySelectorAll('.variant-card.selected').forEach(c => {
                c.classList.remove('selected');
            });

            // Zaznacz nowy wariant
            card.classList.add('selected');

            // Pobierz dane produktu z atrybutów
            const productData = {
                variant_code: card.dataset.variantCode,
                product_index: parseInt(card.dataset.productIndex),
                dimensions: {
                    length: parseFloat(card.dataset.length),
                    width: parseFloat(card.dataset.width),
                    thickness: parseFloat(card.dataset.thickness)
                },
                quantity: parseInt(card.dataset.quantity),
                has_textures: card.dataset.hasTextures === 'true'
            };

            console.log('[Quote3D] Wybrano wariant:', productData);

            // Załaduj produkt
            await this.loadProduct(productData);

        } catch (error) {
            console.error('[Quote3D] Błąd wyboru wariantu:', error);
            this.showError(`Błąd ładowania wariantu: ${error.message}`);
        }
    }

    /**
     * Ładuje produkt w viewerze
     */
    async loadProduct(productData) {
        if (this.isLoading) return;

        try {
            this.isLoading = true;
            this.showLoading();
            this.hideError();

            console.log('[Quote3D] Ładowanie produktu:', productData);

            // Aktualizuj informacje w headerze
            this.updateProductInfo(productData);

            // Inicjalizuj viewer jeśli jeszcze nie istnieje
            if (!this.viewer) {
                await this.initializeViewer();
            }

            // Załaduj produkt w viewerze
            await this.viewer.loadProduct(productData);

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
                productData.variant_code?.toUpperCase() || 'Nieznany wariant';
            
            this.currentTitleEl.textContent = translatedName;
            console.log('[Quote3D] Zaktualizowano tytuł na:', translatedName);
        }

        if (this.currentDimensionsEl) {
            const dimensions = productData.dimensions;
            if (dimensions) {
                const length = Math.round(dimensions.length);
                const width = Math.round(dimensions.width);
                const thickness = dimensions.thickness.toFixed(1);
                const dimensionsText = `${length}×${width}×${thickness} cm`;
                this.currentDimensionsEl.textContent = dimensionsText;
                console.log('[Quote3D] Zaktualizowano wymiary na:', dimensionsText);
            } else {
                this.currentDimensionsEl.textContent = '--- × --- × --- cm';
            }
        }
    }

    /**
     * Sprawdza czy AR jest obsługiwane
     */
    isARSupported() {
        const userAgent = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(userAgent);
        const isAndroid = /Android/.test(userAgent);
        
        return isIOS || isAndroid;
    }

    /**
     * Obsługuje kliknięcie przycisku AR
     */
    handleARClick() {
        if (!this.currentProduct) {
            alert('Wybierz najpierw wariant do wyświetlenia w AR.');
            return;
        }

        // Pokazuje informację o AR (na razie)
        this.showARInfo();

        const userAgent = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(userAgent);
        const isAndroid = /Android/.test(userAgent);

        if (isIOS) {
            this.showARComingSoon('iOS', 'QuickLook AR będzie dostępny wkrótce!');
        } else if (isAndroid) {
            this.showARComingSoon('Android', 'WebXR AR będzie dostępny wkrótce!');
        } else {
            alert('AR jest dostępny tylko na urządzeniach mobilnych (iOS/Android).');
        }
    }

    /**
     * Pokazuje informację o nadchodzącej funkcji AR
     */
    showARComingSoon(platform, message) {
        const productInfo = this.currentProduct ? 
            `\n\nWariant: ${this.currentProduct.variant_code}\nWymiary: ${Math.round(this.currentProduct.dimensions.length)}×${Math.round(this.currentProduct.dimensions.width)}×${this.currentProduct.dimensions.thickness.toFixed(1)} cm` : '';

        alert(`${message}${productInfo}\n\nPlatforma: ${platform}\n\nWkrótce będziesz mógł wyświetlić ten wariant w rzeczywistości rozszerzonej!`);
    }

    /**
     * Pokazuje informację AR w interfejsie
     */
    showARInfo() {
        if (this.arInfoEl) {
            this.arInfoEl.classList.add('visible');
            
            // Ukryj po 5 sekundach
            setTimeout(() => {
                this.arInfoEl.classList.remove('visible');
            }, 5000);
        }
    }

    /**
     * Pokazuje komunikat o niedostępności wariantu
     */
    showVariantUnavailableMessage() {
        alert('Ten wariant nie ma dostępnych tekstur 3D.\n\nWybierz inny wariant z listy.');
    }

    /**
     * Pokazuje loading
     */
    showLoading() {
        if (this.loadingEl) {
            this.loadingEl.style.display = 'flex';
        }
    }

    /**
     * Ukrywa loading
     */
    hideLoading() {
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
            this.errorEl.classList.add('visible');
        }

        this.hideLoading();
    }

    /**
     * Ukrywa błąd
     */
    hideError() {
        if (this.errorEl) {
            this.errorEl.classList.remove('visible');
        }
    }
}

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Quote3D] DOM załadowany, inicjalizacja...');

    // Sprawdź czy Three.js jest załadowany
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