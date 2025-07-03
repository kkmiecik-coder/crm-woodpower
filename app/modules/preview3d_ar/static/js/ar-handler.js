// app/modules/preview3d_ar/static/js/ar-handler.js
// KOMPLETNA WERSJA dla Reality format

/**
 * AR Handler - obsługa rzeczywistości rozszerzonej z Reality format
 * Wersja 5.0 z obsługą nowego formatu Reality
 */

class ARHandler {
    constructor() {
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        this.isAndroid = /Android/.test(navigator.userAgent);
        this.isMobile = this.isIOS || this.isAndroid;

        this.iosVersion = this.getIOSVersion();
        this.androidVersion = this.getAndroidVersion();

        // Punkt końcowy API - ZAKTUALIZOWANY
        this.apiEndpoint = '/preview3d-ar/api';
        this.supportedFormats = this._detectSupportedFormats();

        // Prosty cache URL-i
        this.modelCache = new Map();

        console.log('[ARHandler] Inicjalizacja AR Handler 5.0 - Reality format');
        console.log('[ARHandler] Platforma:', this.getPlatformInfo());
        console.log('[ARHandler] Obsługiwane formaty:', this.supportedFormats.join(', '));
    }

    /**
     * Główna metoda inicjowania AR - ZAKTUALIZOWANA
     */
    async initiateAR(productData) {
        console.log('[ARHandler] Inicjowanie AR dla produktu:', productData);

        if (!this.isMobile) {
            this.showDesktopMessage();
            return;
        }
        if (!productData) {
            this.showError('Brak danych produktu do wyświetlenia w AR');
            return;
        }

        try {
            this.showLoadingModal('Przygotowywanie modelu Reality AR…');

            if (this.isIOS && this.iosVersion >= 12) {
                await this.initiateIOSAR(productData);
            } else if (this.isAndroid && await this.supportsWebXR()) {
                await this.initiateAndroidAR(productData);
            } else {
                this.hideLoadingModal();
                this.showUnsupportedMessage();
            }
        } catch (err) {
            this.hideLoadingModal();
            console.error('[ARHandler] Błąd AR:', err);
            this.showError('Błąd AR: ' + err.message);
        }
    }

    /**
     * AR dla iOS - Reality files (nowy format!)
     */
    async initiateIOSAR(productData) {
        console.log('[ARHandler] iOS AR - używam nowego formatu Reality');
        try {
            // NOWE: Użyj Reality format zamiast USDZ
            const realityUrl = await this.generateRealityFile(productData);
            this.hideLoadingModal();
            this.openQuickLookAR(realityUrl, productData);
        } catch (err) {
            this.hideLoadingModal();
            console.error('[ARHandler] Błąd iOS Reality AR:', err);

            // Fallback do USDZ jeśli Reality nie działa
            console.log('[ARHandler] Fallback do USDZ...');
            try {
                const usdzUrl = await this.generateUSDZFile(productData);
                this.openQuickLookAR(usdzUrl, productData);
            } catch (fallbackErr) {
                console.error('[ARHandler] Fallback USDZ też nie działa:', fallbackErr);
                this.showError('Błąd generowania modelu AR: ' + err.message);
            }
        }
    }

    /**
     * NOWA METODA: Generuje plik Reality
     */
    async generateRealityFile(productData) {
        const key = this._getCacheKey(productData, 'reality');
        if (this.modelCache.has(key)) {
            console.log('[ARHandler] Reality z cache:', this.modelCache.get(key));
            return this.modelCache.get(key);
        }

        console.log('[ARHandler] Generowanie nowego pliku Reality...');

        const res = await fetch(`${this.apiEndpoint}/generate-reality`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                variant_code: productData.variant_code,
                dimensions: productData.dimensions
            })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || `HTTP ${res.status}: ${res.statusText}`);
        }

        const result = await res.json();
        console.log('[ARHandler] Reality API response:', result);

        if (!result.success || !result.reality_url) {
            throw new Error('Brak reality_url w odpowiedzi API');
        }

        this.modelCache.set(key, result.reality_url);
        console.log('[ARHandler] Reality file wygenerowany:', result.reality_url);

        return result.reality_url;
    }

    /**
     * ZAKTUALIZOWANA: Generuje plik USDZ (fallback)
     */
    async generateUSDZFile(productData) {
        const key = this._getCacheKey(productData, 'usdz');
        if (this.modelCache.has(key)) return this.modelCache.get(key);

        console.log('[ARHandler] Generowanie USDZ fallback...');

        const res = await fetch(`${this.apiEndpoint}/generate-usdz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                variant_code: productData.variant_code,
                dimensions: productData.dimensions
            })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || res.statusText);
        }
        const { success, usdz_url } = await res.json();
        if (!success || !usdz_url) throw new Error('Brak usdz_url w odpowiedzi');
        this.modelCache.set(key, usdz_url);
        return usdz_url;
    }

    /**
     * ZAKTUALIZOWANA: Otwiera model w iOS QuickLook AR
     */
    openQuickLookAR(modelUrl, productData) {
        console.log('[ARHandler] openQuickLookAR() - Enhanced dla Reality/USDZ', modelUrl);

        // Wykryj format na podstawie URL
        const isReality = modelUrl.includes('.reality');
        const isUSDZ = modelUrl.includes('.usdz');

        console.log('[ARHandler] Format:', isReality ? 'Reality' : isUSDZ ? 'USDZ' : 'Unknown');

        // Strategia 1: Direct link z rel="ar"
        this.createARLink(modelUrl, productData, isReality ? 'reality' : 'usdz');

        // Strategia 2: Fallback - window.open po 1 sekundzie
        setTimeout(() => {
            console.log('[ARHandler] Fallback: window.open()');
            window.open(modelUrl, '_blank', 'noopener,noreferrer');
        }, 1000);
    }

    /**
     * ZAKTUALIZOWANA: Tworzy prawidłowy link AR z obsługą Reality
     */
    createARLink(modelUrl, productData, format = 'reality') {
        console.log('[ARHandler] Tworzenie linka AR -', format.toUpperCase());

        // Usuń stary link jeśli istnieje
        const existingLink = document.getElementById('ar-quicklook-link');
        if (existingLink) {
            existingLink.remove();
        }

        // Utwórz nowy link
        const link = document.createElement('a');
        link.id = 'ar-quicklook-link';
        link.href = modelUrl;
        link.rel = 'ar';

        // NOWE: Ustaw prawidłowy MIME type na podstawie formatu
        if (format === 'reality') {
            link.type = 'model/vnd.reality';
        } else {
            link.type = 'model/vnd.usdz+zip';
        }

        // Dodaj metadane AR
        const variant = productData?.variant_code || 'Wood Panel';
        const dims = productData?.dimensions || {};
        const subtitle = `${dims.length || 0}×${dims.width || 0}×${dims.thickness || 0} cm`;

        link.setAttribute('data-ar-title', variant);
        link.setAttribute('data-ar-subtitle', subtitle);
        link.setAttribute('data-ar-placement', 'floor');
        link.setAttribute('data-ar-scale', 'auto');

        // NOWE: Dodaj atrybuty specyficzne dla Reality
        if (format === 'reality') {
            link.setAttribute('data-ar-format', 'Reality');
            link.setAttribute('data-ar-version', '1.0');
        }

        // Ukryj link
        link.style.display = 'none';
        link.style.position = 'absolute';
        link.style.left = '-9999px';

        // Dodaj do DOM
        document.body.appendChild(link);

        console.log('[ARHandler] Link AR utworzony:', {
            href: link.href,
            rel: link.rel,
            type: link.type,
            title: link.getAttribute('data-ar-title'),
            format: format
        });

        // Wielostopniowe kliknięcie
        this._performMultiStageClick(link);
    }

    /**
     * NOWA METODA: Wielostopniowe kliknięcie dla lepszej kompatybilności
     */
    _performMultiStageClick(link) {
        try {
            // Etap 1: Native click (natychmiast)
            link.click();
            console.log('[ARHandler] Etap 1: Native click wykonany');

            // Etap 2: Dispatch MouseEvent (po 100ms)
            setTimeout(() => {
                const clickEvent = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: 0,
                    clientY: 0
                });
                link.dispatchEvent(clickEvent);
                console.log('[ARHandler] Etap 2: MouseEvent dispatched');
            }, 100);

            // Etap 3: Touch event dla iOS (po 200ms)
            setTimeout(() => {
                try {
                    const touchEvent = new TouchEvent('touchstart', {
                        bubbles: true,
                        cancelable: true,
                        touches: []
                    });
                    link.dispatchEvent(touchEvent);
                    console.log('[ARHandler] Etap 3: TouchEvent dispatched');
                } catch (e) {
                    console.log('[ARHandler] TouchEvent not supported, skipping');
                }
            }, 200);

            // Etap 4: Focus + Enter key (po 300ms)
            setTimeout(() => {
                try {
                    link.focus();
                    const enterEvent = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        bubbles: true
                    });
                    link.dispatchEvent(enterEvent);
                    console.log('[ARHandler] Etap 4: Enter key dispatched');
                } catch (e) {
                    console.log('[ARHandler] Enter key event failed');
                }
            }, 300);

        } catch (error) {
            console.error('[ARHandler] Błąd wielostopniowego kliknięcia:', error);
        }
    }

    /**
     * AR dla Android - WebXR z plikami GLB
     */
    async initiateAndroidAR(productData) {
        console.log('[ARHandler] Android AR (WebXR) - placeholder');
        this.hideLoadingModal();
        this.showAndroidFallback(productData);
    }

    /**
     * Generuje plik GLB dla Android (placeholder)
     */
    async generateGLBFile(productData) {
        throw new Error('GLB generation not implemented yet');
    }

    /**
     * Otwiera model w Android WebXR (placeholder)
     */
    async openWebXRAR(glbUrl, productData) {
        console.log('[ARHandler] WebXR AR - not implemented');
        this.showAndroidFallback(productData);
    }

    /**
     * Sprawdza obsługę WebXR
     */
    async checkWebXRSupport() {
        try {
            if (!('xr' in navigator)) {
                return false;
            }
            return await navigator.xr.isSessionSupported('immersive-ar');
        } catch (error) {
            console.error('[ARHandler] Błąd sprawdzania WebXR:', error);
            return false;
        }
    }

    /**
     * Fallback dla Android bez WebXR
     */
    showAndroidFallback(productData) {
        const modal = this.createARModal('Tryb kompatybilności Android', {
            icon: '📱',
            title: 'AR dla Android w przygotowaniu',
            message: 'Funkcja AR dla Android będzie dostępna wkrótce. Na razie obsługujemy iOS z Safari.',
            details: [
                '📱 iOS 12+ z Safari - pełne wsparcie AR',
                '🤖 Android - w przygotowaniu',
                '🔧 Webowy viewer 3D działa na wszystkich platformach'
            ],
            buttons: [
                {
                    text: 'Rozumiem',
                    action: () => this.closeModal(),
                    primary: true
                }
            ]
        });

        this.showModal(modal);
    }

    /**
     * Pokazuje komunikat dla komputerów
     */
    showDesktopMessage() {
        const modal = this.createARModal('AR dostępne na urządzeniach mobilnych', {
            icon: '🖥️',
            title: 'Rzeczywistość rozszerzona wymaga urządzenia mobilnego',
            message: 'Funkcja AR działa na iPhone i iPad z iOS 12+ oraz Safari.',
            details: [
                '📱 iPhone/iPad z iOS 12+ i Safari',
                '🚀 Nowy format Reality dla lepszej jakości',
                '🌐 Viewer 3D działa na wszystkich urządzeniach'
            ],
            buttons: [
                {
                    text: 'Rozumiem',
                    action: () => this.closeModal(),
                    primary: true
                }
            ]
        });

        this.showModal(modal);
    }

    /**
     * Pokazuje komunikat o braku obsługi
     */
    showUnsupportedMessage() {
        let details = ['❌ AR nie jest obsługiwane na tym urządzeniu'];

        if (this.isIOS && this.iosVersion < 12) {
            details.push('📱 Wykryto iOS ' + this.iosVersion + '. Wymagane iOS 12+');
        } else if (this.isAndroid) {
            details.push('🤖 Android AR w przygotowaniu');
        }

        const modal = this.createARModal('AR nie jest obsługiwane', {
            icon: '⚠️',
            title: 'Urządzenie nie obsługuje AR',
            message: 'Twoje urządzenie nie spełnia wymagań dla rzeczywistości rozszerzonej.',
            details: details,
            buttons: [
                {
                    text: 'Zamknij',
                    action: () => this.closeModal(),
                    primary: true
                }
            ]
        });

        this.showModal(modal);
    }

    /**
     * Pokazuje błąd AR
     */
    showError(message) {
        const modal = this.createARModal('Błąd AR', {
            icon: '🚫',
            title: 'Wystąpił błąd',
            message: message,
            details: [
                'Spróbuj ponownie za chwilę',
                'Sprawdź połączenie internetowe',
                'Upewnij się, że używasz Safari na iOS',
                'Skontaktuj się z pomocą techniczną jeśli problem się powtarza'
            ],
            buttons: [
                {
                    text: 'Zamknij',
                    action: () => this.closeModal(),
                    primary: true
                }
            ]
        });

        this.showModal(modal);
    }

    /**
     * Tworzy modal AR
     */
    createARModal(title, options) {
        const modal = document.createElement('div');
        modal.className = 'ar-modal-overlay';

        const detailsHtml = options.details ? options.details.map(detail =>
            '<div class="ar-detail-item">' + detail + '</div>'
        ).join('') : '';

        const buttonsHtml = options.buttons ? options.buttons.map(btn =>
            '<button class="ar-modal-btn ' + (btn.primary ? 'primary' : '') + '" data-action="' + btn.text + '">' +
            btn.text +
            '</button>'
        ).join('') : '';

        modal.innerHTML =
            '<div class="ar-modal-content">' +
            '<div class="ar-modal-header">' +
            '<div class="ar-modal-icon">' + options.icon + '</div>' +
            '<h2 class="ar-modal-title">' + title + '</h2>' +
            '</div>' +
            '<div class="ar-modal-body">' +
            '<div class="ar-modal-message">' + options.message + '</div>' +
            (detailsHtml ? '<div class="ar-modal-details">' + detailsHtml + '</div>' : '') +
            '</div>' +
            '<div class="ar-modal-footer">' +
            buttonsHtml +
            '</div>' +
            '</div>';

        // Dodaj event listenery
        if (options.buttons) {
            options.buttons.forEach(btn => {
                const btnElement = modal.querySelector('[data-action="' + btn.text + '"]');
                if (btnElement) {
                    btnElement.addEventListener('click', btn.action);
                }
            });
        }

        return modal;
    }

    /**
     * Pokazuje modal loading
     */
    showLoadingModal(message) {
        const modal = document.createElement('div');
        modal.className = 'ar-loading-overlay';
        modal.innerHTML =
            '<div class="ar-loading-content">' +
            '<div class="ar-loading-spinner"></div>' +
            '<div class="ar-loading-message">' + message + '</div>' +
            '</div>';

        modal.id = 'ar-loading-modal';
        document.body.appendChild(modal);
    }

    /**
     * Ukrywa modal loading
     */
    hideLoadingModal() {
        const modal = document.getElementById('ar-loading-modal');
        if (modal) {
            modal.remove();
        }
    }

    /**
     * Pokazuje modal
     */
    showModal(modal) {
        // Usuń poprzedni modal jeśli istnieje
        this.closeModal();

        modal.id = 'ar-modal';
        document.body.appendChild(modal);

        // Dodaj obsługę zamykania na ESC
        this._escHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        };
        document.addEventListener('keydown', this._escHandler);

        // Dodaj obsługę kliknięcia w tło
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeModal();
            }
        });
    }

    /**
     * Zamyka modal
     */
    closeModal() {
        const modal = document.getElementById('ar-modal');
        if (modal) {
            modal.remove();
            if (this._escHandler) {
                document.removeEventListener('keydown', this._escHandler);
                this._escHandler = null;
            }
        }
    }

    // ZAKTUALIZOWANE metody pomocnicze
    _detectSupportedFormats() {
        const formats = [];
        if (this.isIOS && this.iosVersion >= 12) {
            formats.push('Reality', 'USDZ');
        }
        if (this.isAndroid || this.supportsWebXR()) {
            formats.push('GLB (planned)');
        }
        return formats;
    }

    _getCacheKey(productData, format) {
        const variant = productData.variant_code || productData.variant || 'unknown';
        const dims = productData.dimensions || {};
        const l = dims.length || productData.length || productData.length_cm || 0;
        const w = dims.width || productData.width || productData.width_cm || 0;
        const t = dims.thickness || productData.thickness || productData.thickness_cm || 0;
        return variant + '-' + l + 'x' + w + 'x' + t + '-' + format;
    }

    /**
     * Sprawdza wersję iOS
     */
    getIOSVersion() {
        if (!this.isIOS) return 0;

        const match = navigator.userAgent.match(/OS (\d+)_/);
        return match ? parseInt(match[1]) : 0;
    }

    /**
     * Sprawdza wersję Android
     */
    getAndroidVersion() {
        if (!this.isAndroid) return 0;

        const match = navigator.userAgent.match(/Android (\d+)/);
        return match ? parseInt(match[1]) : 0;
    }

    /**
     * Sprawdza obsługę WebXR
     */
    supportsWebXR() {
        return 'xr' in navigator && 'XRSystem' in window;
    }

    /**
     * Zwraca informacje o platformie
     */
    getPlatformInfo() {
        if (this.isIOS) {
            return 'iOS ' + this.iosVersion + ' (Reality/USDZ support)';
        } else if (this.isAndroid) {
            return 'Android ' + this.androidVersion + (this.supportsWebXR() ? ' (WebXR planned)' : ' (limited)');
        } else {
            return 'Desktop (no AR)';
        }
    }

    /**
     * Debug method - ZAKTUALIZOWANY
     */
    getStatus() {
        return {
            platform: this.getPlatformInfo(),
            supportedFormats: this.supportedFormats,
            cacheSize: this.modelCache.size,
            apiEndpoint: this.apiEndpoint,
            primaryFormat: this.isIOS ? 'Reality' : 'GLB (planned)',
            iosVersion: this.iosVersion,
            capabilities: {
                reality: this.isIOS && this.iosVersion >= 12,
                usdz: this.isIOS && this.iosVersion >= 12,
                webxr: this.supportsWebXR(),
                glb: false // planned
            }
        };
    }

    /**
     * NOWA METODA: Clear cache AR
     */
    clearCache() {
        console.log('[ARHandler] Czyszczenie cache AR...');
        this.modelCache.clear();
        console.log('[ARHandler] Cache wyczyszczony');
    }

    /**
     * NOWA METODA: Test Reality AR
     */
    async testRealityAR(productData) {
        console.log('[ARHandler] Test Reality AR...');

        if (!productData) {
            console.error('[ARHandler] Brak danych produktu do testowania');
            return;
        }

        try {
            const realityUrl = await this.generateRealityFile(productData);
            console.log('[ARHandler] Test Reality URL:', realityUrl);

            // Otwórz bezpośrednio
            window.open(realityUrl, '_blank');

        } catch (error) {
            console.error('[ARHandler] Test Reality AR failed:', error);
        }
    }

    /**
     * NOWA METODA: Debug info
     */
    debugInfo() {
        console.log('[ARHandler] Debug Info:');
        console.log('Platform:', this.getPlatformInfo());
        console.log('Supported Formats:', this.supportedFormats);
        console.log('Cache Size:', this.modelCache.size);
        console.log('API Endpoint:', this.apiEndpoint);
        console.log('iOS Version:', this.iosVersion);
        console.log('Capabilities:', {
            reality: this.isIOS && this.iosVersion >= 12,
            usdz: this.isIOS && this.iosVersion >= 12,
            webxr: this.supportsWebXR()
        });

        return this.getStatus();
    }
}

// Globalna instancja
window.ARHandler = new ARHandler();

console.log('[ARHandler] Enhanced AR Handler 5.0 załadowany z obsługą Reality format - COMPLETE!');

// Dodaj globalne metody debug
window.debugARHandler = () => window.ARHandler.debugInfo();
window.clearARCache = () => window.ARHandler.clearCache();

// Export dla compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARHandler;
}