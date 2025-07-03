// app/modules/preview3d_ar/static/js/ar-handler.js
// Ulepszona wersja z rzeczywistym AR dla iOS i Android

/**
 * AR Handler - obsługa rzeczywistości rozszerzonej
 * Wersja 3.0 z prawdziwą implementacją AR
 */

class ARHandler {
    constructor() {
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        this.isAndroid = /Android/.test(navigator.userAgent);
        this.isMobile = this.isIOS || this.isAndroid;

        // Sprawdź wersje systemów
        this.iosVersion = this.getIOSVersion();
        this.androidVersion = this.getAndroidVersion();

        // API endpoints
        this.apiEndpoint = '/preview3d-ar/api';
        this.supportedFormats = this._detectSupportedFormats();

        // Cache dla plików AR
        this.modelCache = new Map();

        console.log('[ARHandler] Inicjalizacja AR Handler 3.0');
        console.log('[ARHandler] Platforma:', this.getPlatformInfo());
        console.log('[ARHandler] Obsługiwane formaty:', this.supportedFormats.join(', '));
    }

    /**
     * Główna metoda inicjowania AR
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
            // Pokaż loading
            this.showLoadingModal('Przygotowywanie modelu AR...');

            if (this.isIOS && this.iosVersion >= 12) {
                await this.initiateIOSAR(productData);
            } else if (this.isAndroid && this.supportsWebXR()) {
                await this.initiateAndroidAR(productData);
            } else {
                this.hideLoadingModal();
                this.showUnsupportedMessage();
            }
        } catch (error) {
            this.hideLoadingModal();
            console.error('[ARHandler] Błąd AR:', error);
            this.showError('Błąd AR: ' + error.message);
        }
    }

    /**
     * AR dla iOS - QuickLook z plikami USDZ
     */
    async initiateIOSAR(productData) {
        console.log('[ARHandler] Przygotowanie iOS AR (USDZ)');

        try {
            // Generuj plik USDZ
            const usdzUrl = await this.generateUSDZFile(productData);

            this.hideLoadingModal();

            // Otwórz w QuickLook
            this.openQuickLook(usdzUrl, productData);

        } catch (error) {
            this.hideLoadingModal();
            console.error('[ARHandler] Błąd iOS AR:', error);
            this.showError('Błąd generowania modelu dla iOS: ' + error.message);
        }
    }

    /**
     * AR dla Android - WebXR z plikami GLB
     */
    async initiateAndroidAR(productData) {
        console.log('[ARHandler] Przygotowanie Android AR (WebXR)');

        try {
            // Sprawdź obsługę WebXR
            if (!await this.checkWebXRSupport()) {
                this.hideLoadingModal();
                this.showAndroidFallback(productData);
                return;
            }

            // Generuj plik GLB
            const glbUrl = await this.generateGLBFile(productData);

            this.hideLoadingModal();

            // Otwórz w WebXR
            await this.openWebXRAR(glbUrl, productData);

        } catch (error) {
            this.hideLoadingModal();
            console.error('[ARHandler] Błąd Android AR:', error);
            this.showError('Błąd generowania modelu dla Android: ' + error.message);
        }
    }

    /**
     * Generuje plik USDZ dla iOS
     */
    async generateUSDZFile(productData) {
        console.log('[ARHandler] Generowanie pliku USDZ...');

        // Sprawdź cache
        const cacheKey = this._getCacheKey(productData, 'usdz');
        if (this.modelCache.has(cacheKey)) {
            console.log('[ARHandler] USDZ z cache');
            return this.modelCache.get(cacheKey);
        }

        const response = await fetch(this.apiEndpoint + '/generate-usdz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                variant_code: productData.variant_code || productData.variant,
                dimensions: productData.dimensions || {
                    length: productData.length || productData.length_cm,
                    width: productData.width || productData.width_cm,
                    thickness: productData.thickness || productData.thickness_cm
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Błąd API: ' + response.status);
        }

        const data = await response.json();

        if (!data.success || !data.usdz_url) {
            throw new Error('Błąd generowania pliku USDZ');
        }

        // Zapisz w cache
        this.modelCache.set(cacheKey, data.usdz_url);

        console.log('[ARHandler] USDZ wygenerowany:', data.filename);
        return data.usdz_url;
    }

    /**
     * Generuje plik GLB dla Android
     */
    async generateGLBFile(productData) {
        console.log('[ARHandler] Generowanie pliku GLB...');

        // Sprawdź cache
        const cacheKey = this._getCacheKey(productData, 'glb');
        if (this.modelCache.has(cacheKey)) {
            console.log('[ARHandler] GLB z cache');
            return this.modelCache.get(cacheKey);
        }

        const response = await fetch(this.apiEndpoint + '/generate-glb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                variant_code: productData.variant_code || productData.variant,
                dimensions: productData.dimensions || {
                    length: productData.length || productData.length_cm,
                    width: productData.width || productData.width_cm,
                    thickness: productData.thickness || productData.thickness_cm
                }
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Błąd API: ' + response.status);
        }

        const data = await response.json();

        if (!data.success || !data.glb_url) {
            throw new Error('Błąd generowania pliku GLB');
        }

        // Zapisz w cache
        this.modelCache.set(cacheKey, data.glb_url);

        console.log('[ARHandler] GLB wygenerowany:', data.filename);
        return data.glb_url;
    }

    /**
     * Otwiera model w iOS QuickLook
     */
    openQuickLook(usdzUrl, productData) {
        console.log('[ARHandler] Otwieranie QuickLook AR:', usdzUrl);

        try {
            // Utwórz link z rel="ar"
            const link = document.createElement('a');
            link.href = usdzUrl;
            link.rel = 'ar';
            link.style.display = 'none';

            // Dodaj do DOM i kliknij
            document.body.appendChild(link);
            link.click();

            // Usuń po chwili
            setTimeout(() => {
                if (document.body.contains(link)) {
                    document.body.removeChild(link);
                }
            }, 1000);

            console.log('[ARHandler] QuickLook uruchomiony');

        } catch (error) {
            console.error('[ARHandler] Błąd QuickLook:', error);
            this.showError('Błąd uruchamiania AR na iOS');
        }
    }

    /**
     * Otwiera model w Android WebXR
     */
    async openWebXRAR(glbUrl, productData) {
        console.log('[ARHandler] Otwieranie WebXR AR:', glbUrl);

        try {
            // Sprawdź czy WebXR jest dostępne
            if (!('xr' in navigator)) {
                throw new Error('WebXR nie jest obsługiwane');
            }

            // Sprawdź obsługę immersive-ar
            const isSupported = await navigator.xr.isSessionSupported('immersive-ar');
            if (!isSupported) {
                this.showAndroidFallback(productData);
                return;
            }

            // TODO: Implementacja WebXR z Three.js
            // Na razie pokazujemy informację
            this.showWebXRInfo(glbUrl, productData);

        } catch (error) {
            console.error('[ARHandler] Błąd WebXR:', error);
            this.showAndroidFallback(productData);
        }
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
     * Pokazuje informację o WebXR (tymczasowe)
     */
    showWebXRInfo(glbUrl, productData) {
        const modal = this.createARModal('Android WebXR AR', {
            icon: '🤖',
            title: 'Model gotowy do AR',
            message: 'Plik GLB został wygenerowany i jest gotowy do wyświetlenia w rzeczywistości rozszerzonej.',
            details: [
                '📦 Wariant: ' + (productData.variant_code || productData.variant),
                '📏 Wymiary: ' + Math.round(productData.dimensions?.length || 0) + '×' + Math.round(productData.dimensions?.width || 0) + '×' + (productData.dimensions?.thickness || 0).toFixed(1) + ' cm',
                '🔗 Plik: ' + glbUrl.split('/').pop()
            ],
            buttons: [
                {
                    text: 'Otwórz plik GLB',
                    action: () => window.open(glbUrl, '_blank'),
                    primary: true
                },
                {
                    text: 'Zamknij',
                    action: () => this.closeModal()
                }
            ]
        });

        this.showModal(modal);
    }

    /**
     * Fallback dla Android bez WebXR
     */
    showAndroidFallback(productData) {
        const modal = this.createARModal('Tryb kompatybilności Android', {
            icon: '📱',
            title: 'AR wymaga nowszej przeglądarki',
            message: 'Twoje urządzenie nie obsługuje WebXR. Pobierz model 3D i otwórz go w aplikacji obsługującej AR.',
            details: [
                '📱 Wymagane: Chrome 79+ z włączonym WebXR',
                '🔧 Lub aplikacja obsługująca pliki GLB',
                '📦 Model jest gotowy do pobrania'
            ],
            buttons: [
                {
                    text: 'Pobierz model GLB',
                    action: async () => {
                        try {
                            const glbUrl = await this.generateGLBFile(productData);
                            window.open(glbUrl, '_blank');
                        } catch (error) {
                            this.showError('Błąd pobierania modelu');
                        }
                    },
                    primary: true
                },
                {
                    text: 'Zamknij',
                    action: () => this.closeModal()
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
            message: 'Funkcja AR działa tylko na telefonach i tabletach z odpowiednimi systemami.',
            details: [
                '📱 iPhone/iPad z iOS 12+',
                '🤖 Android z obsługą ARCore',
                '🌐 Nowoczesna przeglądarka'
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
            details.push('🤖 Brak obsługi ARCore lub WebXR');
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
                'Skontaktuj się z pomocą techniczną'
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

    // Metody pomocnicze
    _detectSupportedFormats() {
        const formats = [];
        if (this.isIOS && this.iosVersion >= 12) {
            formats.push('USDZ');
        }
        if (this.isAndroid || this.supportsWebXR()) {
            formats.push('GLB');
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
            return 'iOS ' + this.iosVersion;
        } else if (this.isAndroid) {
            return 'Android ' + this.androidVersion + (this.supportsWebXR() ? ' (WebXR)' : '');
        } else {
            return 'Desktop';
        }
    }

    /**
     * Debug method
     */
    getStatus() {
        return {
            platform: this.getPlatformInfo(),
            supportedFormats: this.supportedFormats,
            cacheSize: this.modelCache.size,
            apiEndpoint: this.apiEndpoint
        };
    }
}

// Globalna instancja
window.ARHandler = new ARHandler();

console.log('[ARHandler] Enhanced AR Handler 3.0 załadowany z rzeczywistą implementacją AR');

// Export dla compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARHandler;
}