// app/modules/preview3d_ar/static/js/quote-3d.js
// KOMPLETNA WERSJA z obsługą Reality format

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
        this.currentTitleEl = document.getElementById('current-product-title');
        this.currentDimensionsEl = document.getElementById('current-product-dimensions');
        this.loadingEl = document.getElementById('loading');
        this.errorEl = document.getElementById('error-message');
        this.errorTextEl = document.getElementById('error-text');

        console.log('[Quote3D] Inicjalizacja handlera - Reality format v5.0');
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

            console.log('[Quote3D] Viewer zainicjalizowany pomyślnie - Reality ready');

        } catch (error) {
            console.error('[Quote3D] Błąd inicjalizacji:', error);
            this.showError(`Błąd inicjalizacji: ${error.message}`);
        }
    }

    /**
     * Konfiguruje event listenery
     */
    setupEventListeners() {
        // Obsługa „pending" wyboru wariantu
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

        // Przygotuj przycisk AR - ZAKTUALIZOWANY
        this.setupARButton();

        console.log('[Quote3D] Event listenery skonfigurowane');
    }

    /**
     * ZAKTUALIZOWANA metoda obsługi AR z Reality format
     */
    async handleARClick() {
        console.log('[Quote3D] handleARClick start - Reality format v5.0');

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

        // 3) Sprawdź czy to iOS Safari (Reality wymaga iOS)
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

        if (!isIOS || !isSafari) {
            alert('AR z formatem Reality działa tylko w Safari na iPhone/iPad z iOS 12+');
            return;
        }

        // 4) Przygotuj dane produktu
        const arProductData = {
            variant_code: this.currentProduct.variant_code,
            dimensions: {
                length: this.currentProduct.dimensions.length,
                width: this.currentProduct.dimensions.width,
                thickness: this.currentProduct.dimensions.thickness
            },
            quantity: this.currentProduct.quantity || 1
        };

        console.log('[Quote3D] Dane produktu dla Reality AR:', arProductData);

        // 5) Zablokuj przycisk
        this.btnAr.disabled = true;
        this.btnAr.textContent = 'Ładowanie Reality...';

        try {
            // 6) NOWE: Sprawdź czy Reality jest już w cache
            let realityUrl = this.currentProduct.realityUrl;

            if (!realityUrl) {
                console.log('[Quote3D] Generowanie nowego pliku Reality...');
                realityUrl = await window.ARHandler.generateRealityFile(arProductData);
                this.currentProduct.realityUrl = realityUrl;
            }

            console.log('[Quote3D] URL Reality:', realityUrl);

            // 7) Sprawdź dostępność pliku Reality
            const headResponse = await fetch(realityUrl, { method: 'HEAD' });
            if (!headResponse.ok) {
                throw new Error(`Plik Reality niedostępny: ${headResponse.status}`);
            }

            const contentType = headResponse.headers.get('content-type');
            const fileSize = headResponse.headers.get('content-length');

            console.log('[Quote3D] Sprawdzenie pliku Reality:', {
                status: headResponse.status,
                contentType: contentType,
                size: fileSize
            });

            // 8) Sprawdź MIME type dla Reality
            if (contentType && !contentType.includes('reality') && !contentType.includes('usdz')) {
                console.warn('[Quote3D] Nieoczekiwany MIME type:', contentType);
            }

            // 9) NOWE: Otwórz AR różnymi metodami zoptymalizowanymi dla Reality
            await this.openRealityARWithMultipleMethods(realityUrl, arProductData);

        } catch (error) {
            console.error('[Quote3D] Błąd Reality AR:', error);

            // Fallback do USDZ jeśli Reality nie działa
            console.log('[Quote3D] Próba fallback do USDZ...');
            try {
                const usdzUrl = await window.ARHandler.generateUSDZFile(arProductData);
                await this.openRealityARWithMultipleMethods(usdzUrl, arProductData);
                console.log('[Quote3D] Fallback USDZ zadziałał');
            } catch (fallbackError) {
                console.error('[Quote3D] Fallback USDZ też nie działa:', fallbackError);
                alert(`Błąd uruchamiania AR: ${error.message}`);
            }
        } finally {
            // 10) Odblokuj przycisk
            this.btnAr.disabled = false;
            this.btnAr.textContent = 'AR';
        }
    }

    /**
     * NOWA METODA: Otwiera Reality AR różnymi zoptymalizowanymi metodami
     */
    async openRealityARWithMultipleMethods(modelUrl, productData) {
        console.log('[Quote3D] openRealityARWithMultipleMethods - Enhanced dla Reality');

        // Wykryj format
        const isReality = modelUrl.includes('.reality');
        const format = isReality ? 'Reality' : 'USDZ';

        console.log('[Quote3D] Używam formatu:', format);

        // Metoda 1: rel="ar" link zoptymalizowany dla Reality (preferowana)
        this.createAndClickRealityARLink(modelUrl, productData, format);

        // Metoda 2: window.open (fallback po 2 sekundach)
        setTimeout(() => {
            console.log('[Quote3D] Fallback: window.open dla', format);
            window.open(modelUrl, '_blank');
        }, 2000);

        // Metoda 3: Direct navigation (ostateczny fallback po 5 sekundach)
        setTimeout(() => {
            console.log('[Quote3D] Ostateczny fallback: location.href');
            const userConfirm = confirm(`AR ${format} nie uruchomił się automatycznie. Przekierować do pliku?`);
            if (userConfirm) {
                window.location.href = modelUrl;
            }
        }, 5000);
    }

    /**
     * NOWA METODA: Tworzy i klika w link AR zoptymalizowany dla Reality
     */
    createAndClickRealityARLink(modelUrl, productData, format = 'Reality') {
        console.log('[Quote3D] Tworzenie zoptymalizowanego linka', format, 'AR');

        // Usuń stary link
        const oldLink = document.getElementById('ar-quote-link');
        if (oldLink) {
            oldLink.remove();
        }

        // Utwórz nowy link
        const link = document.createElement('a');
        link.id = 'ar-quote-link';
        link.href = modelUrl;
        link.rel = 'ar';

        // KLUCZOWE: Ustaw prawidłowy MIME type dla formatu
        if (format === 'Reality') {
            link.type = 'model/vnd.reality';
        } else {
            link.type = 'model/vnd.usdz+zip';
        }

        // Metadane zoptymalizowane dla Reality
        const variant = productData.variant_code || 'Wood Panel';
        const dims = productData.dimensions || {};

        link.setAttribute('data-ar-title', variant);
        link.setAttribute('data-ar-subtitle', `${dims.length}×${dims.width}×${dims.thickness} cm`);
        link.setAttribute('data-ar-placement', 'floor');
        link.setAttribute('data-ar-scale', 'auto');

        // NOWE: Dodatkowe atrybuty dla Reality
        if (format === 'Reality') {
            link.setAttribute('data-ar-format', 'Reality');
            link.setAttribute('data-ar-version', '1.0');
            link.setAttribute('data-ar-engine', 'RealityKit');
        }

        // Ukryj link
        link.style.display = 'none';
        link.style.position = 'absolute';
        link.style.left = '-9999px';

        // Dodaj do DOM
        document.body.appendChild(link);

        console.log('[Quote3D] Link Reality utworzony:', {
            href: link.href,
            rel: link.rel,
            type: link.type,
            format: format
        });

        // ULEPSZONE: Wielostopniowe kliknięcie dla Reality
        this._performEnhancedRealityClick(link);
    }

    /**
     * NOWA METODA: Ulepszone kliknięcie dla Reality format
     */
    _performEnhancedRealityClick(link) {
        console.log('[Quote3D] _performEnhancedRealityClick start');

        try {
            // Krok 1: Natychmiastowe kliknięcie
            link.click();
            console.log('[Quote3D] Reality click 1: Native wykonany');

            // Krok 2: MouseEvent po 50ms
            setTimeout(() => {
                const event = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    detail: 1
                });
                link.dispatchEvent(event);
                console.log('[Quote3D] Reality click 2: MouseEvent wykonany');
            }, 50);

            // Krok 3: Touch events dla iOS po 100ms
            setTimeout(() => {
                try {
                    // TouchStart
                    const touchStartEvent = new TouchEvent('touchstart', {
                        bubbles: true,
                        cancelable: true,
                        touches: []
                    });
                    link.dispatchEvent(touchStartEvent);

                    // TouchEnd po krótkiej chwili
                    setTimeout(() => {
                        const touchEndEvent = new TouchEvent('touchend', {
                            bubbles: true,
                            cancelable: true,
                            touches: []
                        });
                        link.dispatchEvent(touchEndEvent);
                        console.log('[Quote3D] Reality click 3: Touch events wykonane');
                    }, 10);

                } catch (e) {
                    console.log('[Quote3D] TouchEvent not supported');
                }
            }, 100);

            // Krok 4: Focus + programmatyczne wsparcie po 150ms
            setTimeout(() => {
                try {
                    link.focus();

                    // Dodaj event listener na focus
                    link.addEventListener('focus', () => {
                        console.log('[Quote3D] Link otrzymał focus');
                    }, { once: true });

                    console.log('[Quote3D] Reality click 4: Focus wykonany');
                } catch (e) {
                    console.log('[Quote3D] Focus failed');
                }
            }, 150);

        } catch (error) {
            console.error('[Quote3D] Błąd enhanced Reality click:', error);
        }
    }

    /**
     * Obsługuje wybór wariantu
     */
    async selectVariant(btn) {
        try {
            console.log('[Quote3D] Wybrano wariant:', btn.dataset);

            // Usuń poprzednie oznaczenia "currently viewing"
            document.querySelectorAll('.variant-btn').forEach(variantBtn => {
                variantBtn.classList.remove('currently-viewing');
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
            await this.loadProduct(productData);
            console.log('[Quote3D] Wariant wybrany i załadowany pomyślnie');

        } catch (error) {
            console.error('[Quote3D] Błąd wyboru wariantu:', error);
            this.showError(`Błąd wyboru wariantu: ${error.message}`);
        }
    }

    /**
     * ZAKTUALIZOWANA: Ładuje produkt w viewer'ze z prefetch Reality
     */
    async loadProduct(productData) {
        if (this.isLoading) return;
        this.isLoading = true;
        this.showLoading();

        try {
            await this.viewer.loadProduct(productData);
            this.updateProductInfo(productData);
            this.currentProduct = productData;

            // --- NOWE: PREFETCH REALITY zamiast USDZ ---
            try {
                console.log('[Quote3D] Prefetch Reality file...');
                const realityUrl = await window.ARHandler.generateRealityFile(productData);
                this.currentProduct.realityUrl = realityUrl;

                // Utwórz/zaktualizuj hidden link dla Reality
                let arLink = document.getElementById('ar-link');
                if (!arLink) {
                    arLink = document.createElement('a');
                    arLink.id = 'ar-link';
                    arLink.rel = 'ar';
                    arLink.type = 'model/vnd.reality';
                    arLink.style.display = 'none';
                    document.body.appendChild(arLink);
                }
                arLink.href = realityUrl;
                arLink.type = 'model/vnd.reality';

                console.log('[Quote3D] Reality prefetched:', realityUrl);

                // Backup: prefetch USDZ jako fallback
                try {
                    const usdzUrl = await window.ARHandler.generateUSDZFile(productData);
                    this.currentProduct.usdzUrl = usdzUrl; // zachowaj jako backup
                    console.log('[Quote3D] USDZ backup prefetched:', usdzUrl);
                } catch (usdzError) {
                    console.warn('[Quote3D] USDZ backup prefetch failed:', usdzError);
                }

            } catch (prefetchError) {
                console.warn('[Quote3D] Reality prefetch failed:', prefetchError);
                // Spróbuj przynajmniej USDZ backup
                try {
                    const usdzUrl = await window.ARHandler.generateUSDZFile(productData);
                    this.currentProduct.usdzUrl = usdzUrl;
                    console.log('[Quote3D] Fallback USDZ prefetched:', usdzUrl);
                } catch (usdzError) {
                    console.warn('[Quote3D] Wszystkie formaty AR failed:', usdzError);
                }
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
     * ZAKTUALIZOWANA: Setup AR button z obsługą Reality
     */
    setupARButton() {
        if (!this.btnAr) return;
        console.log('[Quote3D] Konfiguracja przycisku AR - Reality format');

        const handler = e => {
            e.preventDefault();
            e.stopPropagation();
            this.handleARClick();
        };

        this.btnAr.addEventListener('click', handler);
        this.btnAr.addEventListener('touchstart', handler);

        // Ulepsz UX dla touch
        this.btnAr.style.cursor = 'pointer';
        this.btnAr.style.userSelect = 'none';
        this.btnAr.style.webkitTouchCallout = 'none';
        this.btnAr.style.webkitUserSelect = 'none';

        // Dodaj informację o Reality format (opcjonalnie)
        if (this.btnAr.title) {
            this.btnAr.title = this.btnAr.title + ' (Reality format)';
        } else {
            this.btnAr.title = 'Rzeczywistość rozszerzona (Reality format)';
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
     * Sprawdza obsługę AR - ZAKTUALIZOWANA
     */
    isARSupported() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
        const iosMatch = navigator.userAgent.match(/OS (\d+)_/);
        const iosVersion = iosMatch ? parseInt(iosMatch[1]) : 0;

        // Reality wymaga iOS 12+ i Safari
        return isIOS && isSafari && iosVersion >= 12;
    }

    /**
     * ZAKTUALIZOWANA: Debug status z informacjami o Reality
     */
    getStatus() {
        const isARSupported = this.isARSupported();

        return {
            version: '5.0 - Reality format',
            isInitialized: !!this.viewer,
            currentProduct: this.currentProduct,
            isLoading: this.isLoading,
            viewerStatus: this.viewer ? this.viewer.getStatus() : null,
            ar: {
                supported: isARSupported,
                primaryFormat: 'Reality',
                fallbackFormat: 'USDZ',
                prefetched: {
                    reality: !!this.currentProduct?.realityUrl,
                    usdz: !!this.currentProduct?.usdzUrl
                }
            },
            elements: {
                loading: !!this.loadingEl,
                error: !!this.errorEl,
                canvas: !!this.canvasEl,
                arButton: !!this.btnAr
            },
            cache: {
                realityUrl: this.currentProduct?.realityUrl,
                usdzUrl: this.currentProduct?.usdzUrl
            }
        };
    }

    /**
     * NOWA METODA: Test Reality AR (dla debugowania)
     */
    async testRealityAR() {
        console.log('[Quote3D] Test Reality AR...');

        if (!this.currentProduct) {
            console.error('[Quote3D] Brak produktu do testowania');
            return;
        }

        try {
            const realityUrl = await window.ARHandler.generateRealityFile(this.currentProduct);
            console.log('[Quote3D] Test Reality URL:', realityUrl);

            // Otwórz bezpośrednio
            window.open(realityUrl, '_blank');

        } catch (error) {
            console.error('[Quote3D] Test Reality AR failed:', error);
        }
    }

    /**
     * NOWA METODA: Porównanie formatów (dla debugowania)
     */
    async compareFormats() {
        if (!this.currentProduct) {
            console.error('[Quote3D] Brak produktu do porównania');
            return;
        }

        try {
            console.log('[Quote3D] Porównanie formatów AR...');

            // Test Reality
            const realityStart = performance.now();
            const realityUrl = await window.ARHandler.generateRealityFile(this.currentProduct);
            const realityTime = performance.now() - realityStart;

            // Test USDZ
            const usdzStart = performance.now();
            const usdzUrl = await window.ARHandler.generateUSDZFile(this.currentProduct);
            const usdzTime = performance.now() - usdzStart;

            // Pobierz rozmiary plików
            const realitySize = await this._getFileSize(realityUrl);
            const usdzSize = await this._getFileSize(usdzUrl);

            console.log('[Quote3D] Porównanie formatów:');
            console.table({
                Reality: {
                    url: realityUrl,
                    generationTime: `${realityTime.toFixed(2)}ms`,
                    fileSize: `${realitySize} bytes`,
                    fileSizeMB: `${(realitySize / 1024 / 1024).toFixed(2)} MB`
                },
                USDZ: {
                    url: usdzUrl,
                    generationTime: `${usdzTime.toFixed(2)}ms`,
                    fileSize: `${usdzSize} bytes`,
                    fileSizeMB: `${(usdzSize / 1024 / 1024).toFixed(2)} MB`
                }
            });

        } catch (error) {
            console.error('[Quote3D] Błąd porównania formatów:', error);
        }
    }

    /**
     * Pomocnicza metoda do pobierania rozmiaru pliku
     */
    async _getFileSize(url) {
        try {
            const response = await fetch(url, { method: 'HEAD' });
            return parseInt(response.headers.get('content-length') || '0');
        } catch (error) {
            console.error('[Quote3D] Błąd pobierania rozmiaru pliku:', error);
            return 0;
        }
    }

    /**
     * NOWA METODA: Force Reality AR (dla debugowania)
     */
    async forceRealityAR() {
        console.log('[Quote3D] Force Reality AR - bezpośrednie wywołanie');

        if (!this.currentProduct) {
            alert('Brak produktu - wybierz wariant najpierw');
            return;
        }

        try {
            const realityUrl = await window.ARHandler.generateRealityFile(this.currentProduct);

            // Bezpośrednie przekierowanie
            window.location.href = realityUrl;

        } catch (error) {
            console.error('[Quote3D] Force Reality AR failed:', error);
            alert(`Błąd: ${error.message}`);
        }
    }

    /**
     * NOWA METODA: Clear cache AR
     */
    clearARCache() {
        console.log('[Quote3D] Czyszczenie cache AR...');

        if (this.currentProduct) {
            delete this.currentProduct.realityUrl;
            delete this.currentProduct.usdzUrl;
        }

        // Wyczyść cache ARHandler
        if (window.ARHandler && window.ARHandler.modelCache) {
            window.ARHandler.modelCache.clear();
        }

        // Usuń hidden links
        const arLink = document.getElementById('ar-link');
        if (arLink) {
            arLink.remove();
        }

        console.log('[Quote3D] Cache AR wyczyszczony');
    }
}

// Inicjalizacja po załadowaniu DOM - ZAKTUALIZOWANA
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[Quote3D] DOM załadowany, inicjalizacja Reality v5.0...');

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

    if (typeof window.ARHandler === 'undefined') {
        console.error('[Quote3D] ARHandler nie jest załadowany!');
        alert('Błąd: ARHandler nie jest załadowany. Sprawdź pliki JavaScript.');
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
    console.log('[Quote3D] ARHandler status:', window.ARHandler.getStatus());

    // Utwórz i zainicjalizuj handler
    try {
        const quote3D = new Quote3DHandler();
        window.quote3DHandler = quote3D; // Dla debugowania

        console.log('[Quote3D] Rozpoczęcie inicjalizacji handlera Reality...');
        await quote3D.init();
        console.log('[Quote3D] Handler Reality zainicjalizowany pomyślnie');

        // Dodaj metody debug do window dla łatwego testowania
        window.testRealityAR = () => quote3D.testRealityAR();
        window.compareFormats = () => quote3D.compareFormats();
        window.getQuote3DStatus = () => quote3D.getStatus();
        window.forceRealityAR = () => quote3D.forceRealityAR();
        window.clearARCache = () => quote3D.clearARCache();

        console.log('[Quote3D] Debug methods available:');
        console.log('  - testRealityAR() - Test bezpośredniego AR');
        console.log('  - compareFormats() - Porównanie Reality vs USDZ');
        console.log('  - getQuote3DStatus() - Status aplikacji');
        console.log('  - forceRealityAR() - Wymuś Reality AR');
        console.log('  - clearARCache() - Wyczyść cache AR');

    } catch (error) {
        console.error('[Quote3D] Błąd inicjalizacji handlera:', error);
        alert(`Błąd inicjalizacji Reality: ${error.message}`);
    }
});

// Export dla compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Quote3DHandler;
}

console.log('[Quote3D] Script załadowany - Reality format v5.0 - Complete!');