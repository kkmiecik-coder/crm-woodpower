// app/modules/preview3d_ar/static/js/ar-handler.js
// Ulepszona wersja z rzeczywistym AR dla iOS i Android

/**
 * AR Handler - obsługa rzeczywistości rozszerzonej
 * Wersja 4.0 z prawdziwą implementacją AR i poprawkami iOS
 */

class ARHandler {
    constructor() {
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        this.isAndroid = /Android/.test(navigator.userAgent);
        this.isMobile = this.isIOS || this.isAndroid;

        this.iosVersion = this.getIOSVersion();
        this.androidVersion = this.getAndroidVersion();

        // Punkt końcowy API
        this.apiEndpoint = '/preview3d-ar/api';
        this.supportedFormats = this._detectSupportedFormats();

        // Prosty cache URL-i
        this.modelCache = new Map();

        console.log('[ARHandler] Inicjalizacja AR Handler 4.0');
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
            this.showLoadingModal('Przygotowywanie modelu AR…');

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
     * AR dla iOS - QuickLook z plikami USDZ
     */
    async initiateIOSAR(productData) {
        console.log('[ARHandler] iOS AR (USDZ)');
        try {
            const usdzUrl = await this.generateUSDZFile(productData);
            this.hideLoadingModal();
            this.openQuickLookAR(usdzUrl);
        } catch (err) {
            this.hideLoadingModal();
            console.error('[ARHandler] Błąd iOS AR:', err);
            this.showError('Błąd generowania modelu dla iOS: ' + err.message);
        }
    }

    /**
     * AR dla Android - WebXR z plikami GLB
     */
    async initiateAndroidAR(productData) {
        console.log('[ARHandler] Android AR (WebXR)');
        try {
            if (!await this.supportsWebXR()) {
                this.hideLoadingModal();
                this.showAndroidFallback(productData);
                return;
            }
            const glbUrl = await this.generateGLBFile(productData);
            this.hideLoadingModal();
            await this.openWebXRAR(glbUrl);
        } catch (err) {
            this.hideLoadingModal();
            console.error('[ARHandler] Błąd Android AR:', err);
            this.showError('Błąd generowania modelu dla Android: ' + err.message);
        }
    }

    /**
     * Generuje plik USDZ dla iOS
     */
    async generateUSDZFile(productData) {
        const key = this._getCacheKey(productData, 'usdz');
        if (this.modelCache.has(key)) return this.modelCache.get(key);

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
     * Generuje plik GLB dla Android
     */
    async generateGLBFile(productData) {
        const key = this._getCacheKey(productData, 'glb');
        if (this.modelCache.has(key)) return this.modelCache.get(key);

        const res = await fetch(`${this.apiEndpoint}/generate-glb`, {
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
        const { success, glb_url } = await res.json();
        if (!success || !glb_url) throw new Error('Brak glb_url w odpowiedzi');
        this.modelCache.set(key, glb_url);
        return glb_url;
    }

    /**
     * POPRAWKA: Otwiera model w iOS QuickLook AR z różnymi metodami
     */
    openQuickLookAR(usdzUrl, productData) {
        console.log('[ARHandler] openQuickLookAR()', usdzUrl);
        // Otwórz model USDZ w nowej karcie — Safari automatycznie przełączy na Quick Look
        window.open(usdzUrl, '_blank');
    }

    openWithRelAR(usdzUrl, productData) {
        console.log('[ARHandler] openWithRelAR() fallback', usdzUrl);
        try {
            const link = document.createElement('a');
            link.href = usdzUrl;
            link.rel = 'ar';
            link.type = 'model/vnd.usd+zip';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => document.body.removeChild(link), 3000);
        } catch (e) {
            console.error('[ARHandler] Błąd rel="ar":', e);
            this.showError('Błąd uruchamiania AR na iOS. Sprawdź czy masz iOS 12+ i Safari.');
        }
    }

    /**
     * POPRAWKA: Dodatkowa metoda z rzeczywistym przyciskiem AR
     */
    createARButton(usdzUrl, productData) {
        console.log('[ARHandler] Tworzenie przycisku AR');

        // Utwórz widoczny przycisk AR
        const arButton = document.createElement('button');
        arButton.innerHTML = '📱 Otwórz AR';
        arButton.style.position = 'fixed';
        arButton.style.bottom = '20px';
        arButton.style.right = '20px';
        arButton.style.zIndex = '10000';
        arButton.style.padding = '15px 25px';
        arButton.style.backgroundColor = '#007AFF';
        arButton.style.color = 'white';
        arButton.style.border = 'none';
        arButton.style.borderRadius = '25px';
        arButton.style.fontSize = '16px';
        arButton.style.fontWeight = 'bold';
        arButton.style.cursor = 'pointer';
        arButton.style.boxShadow = '0 4px 15px rgba(0,122,255,0.3)';

        // Event handler
        arButton.addEventListener('click', () => {
            console.log('[ARHandler] Kliknięto przycisk AR');

            // Utwórz link i aktywuj
            const link = document.createElement('a');
            link.href = usdzUrl;
            link.rel = 'ar';
            link.click();

            // Usuń przycisk po kliknięciu
            setTimeout(() => {
                if (document.body.contains(arButton)) {
                    document.body.removeChild(arButton);
                }
            }, 1000);
        });

        // Dodaj do DOM
        document.body.appendChild(arButton);

        // Automatycznie usuń po 10 sekundach
        setTimeout(() => {
            if (document.body.contains(arButton)) {
                document.body.removeChild(arButton);
            }
        }, 10000);
    }

    /**
     * Otwiera model w Android WebXR
     */
    async openWebXRAR(glbUrl, productData) {
        console.log('[Debug][ARHandler] openWebXRAR()', { glbUrl, productData });

        try {
            if (!('xr' in navigator)) {
                console.log('[Debug][ARHandler] brak „xr” w navigator');
                throw new Error('WebXR nie jest obsługiwane');
            }
            const isSupported = await navigator.xr.isSessionSupported('immersive-ar');
            if (!isSupported) {
                console.log('[Debug][ARHandler] immersive-ar nieobsługiwane');
                this.showAndroidFallback(productData);
                return;
            }
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
                'Upewnij się, że używasz Safari na iOS',
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

    openQuickLookAR(usdzUrl) {
        console.log('[ARHandler] Otwarcie QuickLook AR przez link rel="ar":', usdzUrl);
        let link = document.getElementById('ar-link');
        if (!link) {
            link = document.createElement('a');
            link.id = 'ar-link';
            link.rel = 'ar';
            link.type = 'model/vnd.usdz+zip';
            link.style.display = 'none';
            document.body.appendChild(link);
        }
        link.href = usdzUrl;
        link.click();
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

console.log('[ARHandler] Enhanced AR Handler 4.0 załadowany z poprawkami iOS');

// Export dla compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARHandler;
}