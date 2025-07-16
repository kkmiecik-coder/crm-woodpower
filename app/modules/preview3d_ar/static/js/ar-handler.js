// app/modules/preview3d_ar/static/js/ar-handler.js
// POPRAWIONA WERSJA z popup potwierdzającym

class ARHandler {
    constructor() {
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        this.isAndroid = /Android/.test(navigator.userAgent);
        this.isMobile = this.isIOS || this.isAndroid;

        this.iosVersion = this.getIOSVersion();
        this.isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

        // Punkt końcowy API
        this.apiEndpoint = '/preview3d-ar/api';

        // Cache URL-i
        this.modelCache = new Map();

        console.log('[ARHandler] Inicjalizacja AR Handler z popup');
        console.log('[ARHandler] iOS:', this.iosVersion, 'Safari:', this.isSafari);
    }

    /**
     * NOWA: Główna metoda z popup potwierdzającym
     */
    async initiateAR(productData) {
        console.log('[ARHandler] Inicjowanie AR z popup dla produktu:', productData);

        if (!this.isMobile) {
            this.showDesktopMessage();
            return;
        }

        if (!productData) {
            this.showError('Brak danych produktu do wyświetlenia w AR');
            return;
        }

        // NOWE: Pokaż popup potwierdzający
        this.showARConfirmationPopup(productData);
    }

    /**
     * NOWA METODA: Popup potwierdzający AR
     */
    showARConfirmationPopup(productData) {
        const variant = productData.variant_code || 'Produkt';
        const dims = productData.dimensions || {};
        const dimensions = `${dims.length || 0}×${dims.width || 0}×${dims.thickness || 0} cm`;

        const modal = this.createARModal('Otwórz w rzeczywistości rozszerzonej', {
            icon: '📱',
            title: 'Czy chcesz otworzyć model w AR?',
            message: `Model: ${variant}\nWymiary: ${dimensions}`,
            details: [
                '📱 Wymagane: iPhone/iPad z iOS 12+',
                '🌐 Potrzebne: Safari (nie Chrome)',
                '🚀 Technologia: Apple QuickLook AR',
                '⚡ Model zostanie pobrany automatycznie'
            ],
            buttons: [
                {
                    text: 'Anuluj',
                    action: () => this.closeModal(),
                    primary: false
                },
                {
                    text: 'Otwórz AR',
                    action: () => this.confirmOpenAR(productData),
                    primary: true
                }
            ]
        });

        this.showModal(modal);
    }

    /**
     * NOWA METODA: Potwierdzenie otwarcia AR
     */
    async confirmOpenAR(productData) {
        console.log('[ARHandler] Użytkownik potwierdził otwarcie AR');

        // Zamknij popup
        this.closeModal();

        // Sprawdź kompatybilność
        if (!this.isIOS || this.iosVersion < 12 || !this.isSafari) {
            this.showUnsupportedMessage();
            return;
        }

        try {
            // Pokaż loading
            this.showLoadingModal('Przygotowywanie modelu AR...');

            // Wygeneruj i otwórz AR
            await this.initiateIOSAR(productData);

        } catch (err) {
            this.hideLoadingModal();
            console.error('[ARHandler] Błąd AR:', err);
            this.showError('Błąd generowania modelu AR: ' + err.message);
        }
    }

    /**
     * POPRAWIONA: AR dla iOS z lepszym plikiem USDZ
     */
    async initiateIOSAR(productData) {
        console.log('[ARHandler] iOS AR - generowanie poprawnego USDZ');

        try {
            // Użyj USDZ zamiast Reality (bardziej stabilne)
            const usdzUrl = await this.generateUSDZFile(productData);

            this.hideLoadingModal();

            // BEZPOŚREDNIE uruchomienie AR bez przekierowań
            this.openQuickLookARDirect(usdzUrl, productData);

        } catch (err) {
            this.hideLoadingModal();
            console.error('[ARHandler] Błąd iOS AR:', err);
            this.showError('Błąd generowania modelu AR: ' + err.message);
        }
    }

    /**
     * POPRAWIONA: Generowanie USDZ z lepszymi parametrami
     */
    async generateUSDZFile(productData) {
        const key = this._getCacheKey(productData, 'usdz');
        if (this.modelCache.has(key)) {
            console.log('[ARHandler] USDZ z cache:', this.modelCache.get(key));
            return this.modelCache.get(key);
        }

        console.log('[ARHandler] Generowanie nowego pliku USDZ...');

        const requestData = {
            variant_code: productData.variant_code,
            dimensions: {
                length: productData.dimensions.length,
                width: productData.dimensions.width,
                thickness: productData.dimensions.thickness
            },
            // NOWE: Dodatkowe parametry dla lepszej jakości
            quality: 'high',
            format: 'usdz',
            optimize_for_ar: true
        };

        const res = await fetch(`${this.apiEndpoint}/generate-usdz`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error('[ARHandler] USDZ API error:', res.status, errorText);
            throw new Error(`Błąd API (${res.status}): ${errorText}`);
        }

        const result = await res.json();
        console.log('[ARHandler] USDZ API response:', result);

        if (!result.success || !result.usdz_url) {
            throw new Error('Brak usdz_url w odpowiedzi API');
        }

        // Sprawdź czy plik istnieje
        await this.validateARFile(result.usdz_url);

        this.modelCache.set(key, result.usdz_url);
        console.log('[ARHandler] USDZ file wygenerowany:', result.usdz_url);

        return result.usdz_url;
    }

    /**
     * NOWA METODA: Walidacja pliku AR
     */
    async validateARFile(fileUrl) {
        console.log('[ARHandler] Walidacja pliku AR:', fileUrl);

        try {
            const response = await fetch(fileUrl, { method: 'HEAD' });

            if (!response.ok) {
                throw new Error(`Plik AR niedostępny (${response.status})`);
            }

            const contentType = response.headers.get('content-type');
            const contentLength = response.headers.get('content-length');

            console.log('[ARHandler] Plik AR - Type:', contentType, 'Size:', contentLength);

            // Sprawdź MIME type
            if (!contentType || (!contentType.includes('usdz') && !contentType.includes('octet-stream'))) {
                console.warn('[ARHandler] Nieprawidłowy MIME type:', contentType);
            }

            // Sprawdź rozmiar
            if (!contentLength || parseInt(contentLength) < 1000) {
                throw new Error('Plik AR jest za mały (prawdopodobnie uszkodzony)');
            }

            console.log('[ARHandler] Plik AR zwalidowany pomyślnie');

        } catch (error) {
            console.error('[ARHandler] Błąd walidacji pliku AR:', error);
            throw error;
        }
    }

    /**
     * POPRAWIONA: Bezpośrednie otwarcie QuickLook AR
     */
    openQuickLookARDirect(modelUrl, productData) {
        console.log('[ARHandler] Bezpośrednie otwarcie QuickLook AR:', modelUrl);

        // Usuń stary link jeśli istnieje
        const existingLink = document.getElementById('ar-quicklook-link');
        if (existingLink) {
            existingLink.remove();
        }

        // Utwórz nowy link AR
        const link = document.createElement('a');
        link.id = 'ar-quicklook-link';
        link.href = modelUrl;
        link.rel = 'ar';
        link.type = 'model/vnd.usdz+zip';

        // Metadane AR
        const variant = productData?.variant_code || 'Wood Panel';
        const dims = productData?.dimensions || {};
        const subtitle = `${dims.length || 0}×${dims.width || 0}×${dims.thickness || 0} cm`;

        link.setAttribute('data-ar-title', variant);
        link.setAttribute('data-ar-subtitle', subtitle);
        link.setAttribute('data-ar-placement', 'floor');
        link.setAttribute('data-ar-scale', 'auto');

        // KRYTYCZNE: Link musi być widoczny dla iOS
        link.style.position = 'fixed';
        link.style.top = '-1000px';
        link.style.left = '-1000px';
        link.style.width = '1px';
        link.style.height = '1px';
        link.style.opacity = '0';
        link.style.pointerEvents = 'none';

        // Dodaj do DOM
        document.body.appendChild(link);

        console.log('[ARHandler] Link AR utworzony:', {
            href: link.href,
            rel: link.rel,
            type: link.type
        });

        // NATYCHMIASTOWE kliknięcie
        setTimeout(() => {
            try {
                console.log('[ARHandler] Kliknięcie w link AR...');

                // Metoda 1: Native click
                link.click();

                // Metoda 2: Dispatch event (fallback)
                setTimeout(() => {
                    const clickEvent = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    link.dispatchEvent(clickEvent);

                    console.log('[ARHandler] AR click events wykonane');
                }, 100);

                // Cleanup po 3 sekundach
                setTimeout(() => {
                    if (document.body.contains(link)) {
                        document.body.removeChild(link);
                    }
                }, 3000);

            } catch (error) {
                console.error('[ARHandler] Błąd kliknięcia AR:', error);
            }
        }, 50);
    }

    /**
     * Pomocnicze metody UI
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
            '<div class="ar-modal-message" style="white-space: pre-line;">' + options.message + '</div>' +
            (detailsHtml ? '<div class="ar-modal-details">' + detailsHtml + '</div>' : '') +
            '</div>' +
            '<div class="ar-modal-footer">' +
            buttonsHtml +
            '</div>' +
            '</div>';

        // Event listenery dla przycisków
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

    hideLoadingModal() {
        const modal = document.getElementById('ar-loading-modal');
        if (modal) {
            modal.remove();
        }
    }

    showModal(modal) {
        this.closeModal();
        modal.id = 'ar-modal';
        document.body.appendChild(modal);

        // ESC key handler
        this._escHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        };
        document.addEventListener('keydown', this._escHandler);

        // Click outside handler
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeModal();
            }
        });
    }

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

    showDesktopMessage() {
        const modal = this.createARModal('AR dostępne na urządzeniach mobilnych', {
            icon: '🖥️',
            title: 'Rzeczywistość rozszerzona wymaga urządzenia mobilnego',
            message: 'Funkcja AR działa na iPhone i iPad z iOS 12+ oraz Safari.',
            details: [
                '📱 iPhone/iPad z iOS 12+',
                '🌐 Safari (nie Chrome)',
                '🔧 Viewer 3D działa na wszystkich urządzeniach'
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

    showUnsupportedMessage() {
        let details = [];
        let message = 'Twoje urządzenie nie spełnia wymagań dla rzeczywistości rozszerzonej.';

        if (!this.isIOS) {
            details.push('❌ Wykryto: ' + (this.isAndroid ? 'Android' : 'Desktop'));
            details.push('✅ Wymagane: iPhone/iPad');
        } else if (this.iosVersion < 12) {
            details.push('❌ iOS ' + this.iosVersion + ' (za stara wersja)');
            details.push('✅ Wymagane: iOS 12 lub nowszy');
        } else if (!this.isSafari) {
            details.push('❌ Wykryta przeglądarka: ' + this.getBrowserName());
            details.push('✅ Wymagana: Safari');
            message = 'AR działa tylko w przeglądarce Safari na iOS.';
        }

        const modal = this.createARModal('AR nie jest obsługiwane', {
            icon: '⚠️',
            title: 'Urządzenie nie obsługuje AR',
            message: message,
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

    // Pomocnicze metody
    getIOSVersion() {
        if (!this.isIOS) return 0;
        const match = navigator.userAgent.match(/OS (\d+)_/);
        return match ? parseInt(match[1]) : 0;
    }

    getBrowserName() {
        const ua = navigator.userAgent;
        if (ua.includes('Chrome')) return 'Chrome';
        if (ua.includes('Firefox')) return 'Firefox';
        if (ua.includes('Safari')) return 'Safari';
        if (ua.includes('Edge')) return 'Edge';
        return 'Nieznana';
    }

    _getCacheKey(productData, format) {
        const variant = productData.variant_code || 'unknown';
        const dims = productData.dimensions || {};
        const l = dims.length || 0;
        const w = dims.width || 0;
        const t = dims.thickness || 0;
        return `${variant}-${l}x${w}x${t}-${format}`;
    }

    getStatus() {
        return {
            platform: this.isIOS ? `iOS ${this.iosVersion}` : 'Other',
            browser: this.getBrowserName(),
            safari: this.isSafari,
            arSupported: this.isIOS && this.iosVersion >= 12 && this.isSafari,
            cacheSize: this.modelCache.size,
            apiEndpoint: this.apiEndpoint
        };
    }

    // Debug methods
    clearCache() {
        this.modelCache.clear();
        console.log('[ARHandler] Cache wyczyszczony');
    }

    debugInfo() {
        console.log('[ARHandler] Debug Info:', this.getStatus());
        return this.getStatus();
    }
}

// Globalna instancja
window.ARHandler = new ARHandler();

console.log('[ARHandler] AR Handler z popup załadowany');

// Debug methods
window.debugARHandler = () => window.ARHandler.debugInfo();
window.clearARCache = () => window.ARHandler.clearCache();