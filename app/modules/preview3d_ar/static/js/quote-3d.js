// app/modules/preview3d_ar/static/js/quote-3d.js

/**
 * Quote 3D Viewer - obsługa wycen z wieloma produktami
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
        this.arNoticeEl = document.getElementById('ar-notice');

        console.log('[Quote3D] Inicjalizacja handlera');
    }

    /**
     * Inicjalizuje viewer - wywołaj po załadowaniu DOM
     */
    async init() {
        try {
            console.log('[Quote3D] Inicjalizacja viewer\'a');

            this.setupEventListeners();
            this.detectARSupport();

            // Załaduj domyślny produkt jeśli dostępny
            if (window.Quote3DConfig && window.Quote3DConfig.defaultProduct) {
                await this.loadProduct(window.Quote3DConfig.defaultProduct);
            } else {
                this.showError('Brak dostępnych produktów z teksturami');
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
        // Kliknięcia w warianty
        document.querySelectorAll('.variant-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (item.classList.contains('disabled')) {
                    return;
                }

                this.selectVariant(item);
            });
        });

        // Przycisk Reset
        if (this.btnReset) {
            this.btnReset.addEventListener('click', () => {
                if (this.viewer && typeof this.viewer.resetCamera === 'function') {
                    this.viewer.resetCamera();
                }
            });
        }

        // Przycisk AR
        if (this.btnAr) {
            this.btnAr.addEventListener('click', () => {
                if (this.currentProduct) {
                    this.initiateAR(this.currentProduct);
                }
            });
        }

        console.log('[Quote3D] Event listenery skonfigurowane');
    }

    /**
     * Wybiera wariant i ładuje produkt
     */
    async selectVariant(variantElement) {
        try {
            // Usuń poprzednie zaznaczenie
            document.querySelectorAll('.variant-item').forEach(item => {
                item.classList.remove('selected');
            });

            // Zaznacz nowy wariant
            variantElement.classList.add('selected');

            // Pobierz dane produktu
            const productData = {
                product_index: parseInt(variantElement.dataset.productIndex),
                variant_code: variantElement.dataset.variantCode,
                dimensions: {
                    length: parseFloat(variantElement.dataset.length),
                    width: parseFloat(variantElement.dataset.width),
                    thickness: parseFloat(variantElement.dataset.thickness)
                },
                quantity: parseInt(variantElement.dataset.quantity)
            };

            console.log('[Quote3D] Wybrano wariant:', productData);
            await this.loadProduct(productData);

        } catch (error) {
            console.error('[Quote3D] Błąd wyboru wariantu:', error);
            this.showError(`Błąd wyboru wariantu: ${error.message}`);
        }
    }

    /**
     * Ładuje produkt do viewer'a 3D
     */
    async loadProduct(productData) {
        if (this.isLoading) return;

        try {
            this.isLoading = true;
            this.showLoading();
            this.hideError();

            console.log('[Quote3D] Ładowanie produktu:', productData);

            // Aktualizuj interfejs
            this.updateProductInfo(productData);

            // Jeśli viewer nie istnieje, stwórz go
            if (!this.viewer) {
                await this.initializeViewer();
            }

            // Przygotuj dane dla API
            const apiData = {
                variant_code: productData.variant_code,
                length_cm: productData.dimensions.length,
                width_cm: productData.dimensions.width,
                thickness_cm: productData.dimensions.thickness,
                quantity: productData.quantity
            };

            // Wywołaj API
            const response = await fetch(window.Quote3DConfig.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(apiData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const result = await response.json();
            console.log('[Quote3D] Odpowiedź API:', result);

            // Załaduj do viewer'a
            await this.viewer.loadProduct(apiData);

            this.currentProduct = productData;
            this.hideLoading();

            console.log('[Quote3D] Produkt załadowany pomyślnie');

        } catch (error) {
            console.error('[Quote3D] Błąd ładowania produktu:', error);
            this.showError(`Błąd ładowania produktu: ${error.message}`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Inicjalizuje WoodViewer
     */
    async initializeViewer() {
        try {
            if (!this.canvasEl) {
                throw new Error('Canvas element not found');
            }

            if (typeof THREE === 'undefined') {
                throw new Error('THREE.js library not loaded');
            }

            if (typeof WoodViewer === 'undefined') {
                throw new Error('WoodViewer class not loaded');
            }

            console.log('[Quote3D] Tworzenie WoodViewer...');
            this.viewer = new WoodViewer(this.canvasEl);

            console.log('[Quote3D] Inicjalizacja sceny Three.js...');
            await this.viewer.init();

            // Sprawdź czy wszystko jest zainicjalizowane
            if (!this.viewer.scene) {
                throw new Error('Scene nie została zainicjalizowana');
            }
            if (!this.viewer.camera) {
                throw new Error('Camera nie została zainicjalizowana');
            }
            if (!this.viewer.renderer) {
                throw new Error('Renderer nie został zainicjalizowany');
            }

            console.log('[Quote3D] WoodViewer zainicjalizowany pomyślnie');

            // Zapisz referencję globalnie dla debugowania
            window.currentViewer = this.viewer;

        } catch (error) {
            console.error('[Quote3D] Błąd inicjalizacji viewer\'a:', error);
            throw error;
        }
    }

    /**
     * Aktualizuje informacje o produkcie w headerze
     */
    updateProductInfo(productData) {
        if (this.currentTitleEl) {
            this.currentTitleEl.textContent = productData.variant_code.toUpperCase();
        }

        if (this.currentDimensionsEl) {
            this.currentDimensionsEl.textContent =
                `${productData.dimensions.length.toFixed(0)}×${productData.dimensions.width.toFixed(0)}×${productData.dimensions.thickness.toFixed(1)} cm`;
        }
    }

    /**
     * Wykrywa obsługę AR
     */
    detectARSupport() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isAndroid = /Android/.test(navigator.userAgent);
        const hasARCore = 'xr' in navigator;

        console.log('[Quote3D] Wykrywanie AR:', { isIOS, isAndroid, hasARCore });

        if (isIOS || (isAndroid && hasARCore)) {
            if (this.btnAr) {
                this.btnAr.style.display = 'flex';
            }
            if (this.arNoticeEl) {
                this.arNoticeEl.classList.add('visible');
            }
        }
    }

    /**
     * Inicjuje AR
     */
    initiateAR(productData) {
        console.log('[Quote3D] Inicjowanie AR dla:', productData);

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

        if (isIOS) {
            this.initiateIOSAR(productData);
        } else {
            this.initiateAndroidAR(productData);
        }
    }

    /**
     * AR dla iOS (USDZ)
     */
    initiateIOSAR(productData) {
        // TODO: Implementacja generowania pliku USDZ
        alert('Funkcja AR dla iOS będzie dostępna wkrótce!\n\nPlatforma: iOS\nProdukt: ' + productData.variant_code);
    }

    /**
     * AR dla Android (WebXR)
     */
    initiateAndroidAR(productData) {
        // TODO: Implementacja WebXR
        alert('Funkcja AR dla Android będzie dostępna wkrótce!\n\nPlatforma: Android\nProdukt: ' + productData.variant_code);
    }

    /**
     * Pokazuje loading
     */
    showLoading() {
        if (this.loadingEl) {
            this.loadingEl.style.display = 'block';
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
        this.hideLoading();
        if (this.errorTextEl) {
            this.errorTextEl.textContent = message;
        }
        if (this.errorEl) {
            this.errorEl.style.display = 'block';
        }
        console.error('[Quote3D]', message);
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
     * Debug helper
     */
    debug() {
        return {
            config: window.Quote3DConfig,
            currentProduct: this.currentProduct,
            viewer: this.viewer,
            isLoading: this.isLoading,
            elements: {
                canvas: this.canvasEl,
                loading: this.loadingEl,
                error: this.errorEl
            },
            canvasSize: this.canvasEl ? {
                width: this.canvasEl.clientWidth,
                height: this.canvasEl.clientHeight
            } : null
        };
    }
}

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', async function () {
    console.log('[Quote3D] DOM załadowany, inicjalizacja...');

    // Sprawdź czy wszystkie biblioteki są załadowane
    if (typeof THREE === 'undefined') {
        console.error('[Quote3D] THREE.js nie jest załadowane!');
        return;
    }

    if (typeof WoodViewer === 'undefined') {
        console.error('[Quote3D] WoodViewer nie jest załadowany!');
        return;
    }

    // Sprawdź czy jest konfiguracja
    if (typeof window.Quote3DConfig === 'undefined') {
        console.error('[Quote3D] Brak konfiguracji Quote3DConfig!');
        return;
    }

    // Utwórz i zainicjalizuj handler
    const quote3D = new Quote3DHandler();
    window.quote3DHandler = quote3D; // Dla debugowania

    await quote3D.init();
});

// Export dla compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Quote3DHandler;
}

console.log('[Quote3D] Script załadowany');