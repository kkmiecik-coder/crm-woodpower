// app/modules/preview3d_ar/static/js/ar-handler.js
// KOMPLETNA WERSJA dla Reality format z debugiem tekstur

/**
 * AR Handler - obsługa rzeczywistości rozszerzonej z Reality format
 * Wersja 5.1 z obsługą nowego formatu Reality i debugiem tekstur
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

        // Cache URL-i modeli
        this.modelCache = new Map();

        // Debug mode
        this.debugMode = false;

        console.log('[ARHandler] Inicjalizacja AR Handler 5.1 - Reality format + texture debug');
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
     * AR dla iOS - Reality files
     */
    async initiateIOSAR(productData) {
        console.log('[ARHandler] iOS AR - używam nowego formatu Reality');
        try {
            // Użyj Reality format zamiast USDZ
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
     * Generuje plik Reality z debugiem tekstur
     */
    async generateRealityFile(productData) {
        const key = this._getCacheKey(productData, 'reality');
        if (this.modelCache.has(key)) {
            console.log('[ARHandler] Reality z cache:', this.modelCache.get(key));
            
            // Debug cached file
            if (this.debugMode) {
                await this.debugUSDZTextures(this.modelCache.get(key));
            }
            
            return this.modelCache.get(key);
        }

        console.log('[ARHandler] Generowanie nowego pliku Reality...');

        // Debug tekstur przed generowaniem
        const textureDebug = await this.debugVariantTextures(productData.variant_code);
        
        if (textureDebug && textureDebug.summary.existing_files === 0) {
            console.warn('[ARHandler] ⚠️ Brak tekstur na dysku - model będzie bez tekstur');
        }

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

        // Debug wygenerowanego pliku
        const fileDebug = await this.debugUSDZTextures(result.reality_url);
        
        if (fileDebug && !fileDebug.diagnosis.has_textures) {
            console.error('[ARHandler] ❌ Wygenerowany plik Reality nie zawiera tekstur!');
            
            // Pokaż szczegółowe info o problemie
            if (textureDebug) {
                console.log('[ARHandler] Analiza problemu z teksturami:');
                console.table({
                    'Tekstury na serwerze': textureDebug.summary.existing_files > 0 ? '✅' : '❌',
                    'Folder tekstur istnieje': textureDebug.base_directory.exists ? '✅' : '❌',
                    'Face texture': textureDebug.summary.has_face_texture ? '✅' : '❌',
                    'Pliki w USDZ': fileDebug.diagnosis.total_files,
                    'Tekstury w USDZ': fileDebug.diagnosis.texture_count
                });
            }
        } else {
            console.log('[ARHandler] ✅ Reality file zawiera tekstury:', fileDebug?.diagnosis.texture_count || 0);
        }

        return result.reality_url;
    }

    /**
     * Generuje plik USDZ (fallback)
     */
    async generateUSDZFile(productData) {
        const key = this._getCacheKey(productData, 'usdz');
        if (this.modelCache.has(key)) {
            const cachedUrl = this.modelCache.get(key);
            
            // Debug cached file
            if (this.debugMode) {
                await this.debugUSDZTextures(cachedUrl);
            }
            
            return cachedUrl;
        }

        console.log('[ARHandler] Generowanie USDZ fallback...');

        // Debug tekstur przed generowaniem
        await this.debugVariantTextures(productData.variant_code);

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
        if (!success || !usdz_url) {
            throw new Error('Brak usdz_url w odpowiedzi');
        }
        
        this.modelCache.set(key, usdz_url);
        
        // Debug wygenerowanego pliku
        await this.debugUSDZTextures(usdz_url);
        
        return usdz_url;
    }

    /**
     * Debug helper dla tekstur w USDZ
     */
    async debugUSDZTextures(usdzUrl) {
        if (!this.debugMode && !window.location.search.includes('debug=1')) {
            return null; // Skip debug jeśli nie jest włączony
        }

        console.log('[AR Debug] Sprawdzanie tekstur w USDZ:', usdzUrl);
        
        try {
            // Pobierz informacje o pliku
            const response = await fetch(usdzUrl, { method: 'HEAD' });
            console.log('[AR Debug] USDZ Headers:', Object.fromEntries(response.headers.entries()));
            
            // Sprawdź zawartość przez debug endpoint
            const filename = usdzUrl.split('/').pop();
            const debugResponse = await fetch(`/preview3d-ar/api/debug-usdz-content/${filename}`);
            
            if (debugResponse.ok) {
                const debugData = await debugResponse.json();
                console.log('[AR Debug] USDZ Content:', debugData);
                
                // Sprawdź czy ma tekstury
                if (!debugData.diagnosis.has_textures) {
                    console.error('[AR Debug] ❌ USDZ nie zawiera tekstur!');
                    console.log('[AR Debug] Files in USDZ:', debugData.file_info.files);
                    
                    // Sprawdź czy USD zawiera referencje do tekstur
                    if (debugData.usd_content_preview) {
                        const hasTextureReferences = debugData.usd_content_preview.includes('UsdUVTexture') || 
                                                   debugData.usd_content_preview.includes('inputs:file') ||
                                                   debugData.usd_content_preview.includes('DiffuseTexture');
                        
                        if (!hasTextureReferences) {
                            console.error('[AR Debug] ❌ USD nie zawiera referencji do tekstur!');
                            console.log('[AR Debug] USD preview:', debugData.usd_content_preview.substring(0, 500));
                        } else {
                            console.log('[AR Debug] ✅ USD zawiera referencje do tekstur');
                        }
                    }
                } else {
                    console.log('[AR Debug] ✅ USDZ zawiera tekstury:', debugData.diagnosis.texture_count);
                    
                    // Lista tekstur
                    const textures = debugData.file_info.files.filter(f => f.type === 'Texture');
                    console.log('[AR Debug] Texture files:', textures.map(t => t.name));
                }
                
                return debugData;
            } else {
                console.error('[AR Debug] Błąd debug endpoint:', debugResponse.status);
            }
            
        } catch (error) {
            console.error('[AR Debug] Błąd debugowania USDZ:', error);
        }
        
        return null;
    }

    /**
     * Debug helper dla tekstur wariantu
     */
    async debugVariantTextures(variantCode) {
        if (!this.debugMode && !window.location.search.includes('debug=1')) {
            return null; // Skip debug jeśli nie jest włączony
        }

        console.log('[AR Debug] Sprawdzanie tekstur wariantu:', variantCode);
        
        try {
            const response = await fetch(`/preview3d-ar/api/debug-textures/${variantCode}`);
            
            if (response.ok) {
                const debugData = await response.json();
                console.log('[AR Debug] Textures Debug:', debugData);
                
                // Sprawdź czy są dostępne tekstury
                if (debugData.summary.total_variants === 0) {
                    console.error('[AR Debug] ❌ Brak konfiguracji tekstur dla wariantu:', variantCode);
                    console.log('[AR Debug] Expected folder:', debugData.base_directory.path);
                } else if (debugData.summary.existing_files === 0) {
                    console.error('[AR Debug] ❌ Pliki tekstur nie istnieją na dysku');
                    console.log('[AR Debug] Expected directory:', debugData.base_directory.path);
                    console.log('[AR Debug] Directory exists:', debugData.base_directory.exists);
                    console.log('[AR Debug] Files in directory:', debugData.base_directory.files);
                } else {
                    console.log('[AR Debug] ✅ Znaleziono tekstury:', debugData.summary.existing_files, 'plików');
                    console.table({
                        'Face texture': debugData.summary.has_face_texture ? '✅' : '❌',
                        'Edge texture': debugData.summary.has_edge_texture ? '✅' : '❌',
                        'Side texture': debugData.summary.has_side_texture ? '✅' : '❌'
                    });
                    
                    // Szczegóły plików
                    console.log('[AR Debug] Texture files detail:');
                    Object.entries(debugData.local_paths).forEach(([surface, paths]) => {
                        console.log(`  ${surface}:`, paths.map(p => ({
                            file: p.rel_path,
                            exists: p.exists,
                            size: p.size
                        })));
                    });
                }
                
                return debugData;
            } else {
                console.error('[AR Debug] Błąd API tekstur:', response.status, await response.text());
            }
            
        } catch (error) {
            console.error('[AR Debug] Błąd sprawdzania tekstur:', error);
        }
        
        return null;
    }

    /**
     * Otwiera model w iOS QuickLook AR
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
     * Tworzy prawidłowy link AR z obsługą Reality
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

        // Ustaw prawidłowy MIME type na podstawie formatu
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

        // Dodaj atrybuty specyficzne dla Reality
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
     * Wielostopniowe kliknięcie dla lepszej kompatybilności
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

    // Metody pomocnicze
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
     * Debug method
     */
    getStatus() {
        return {
            platform: this.getPlatformInfo(),
            supportedFormats: this.supportedFormats,
            cacheSize: this.modelCache.size,
            apiEndpoint: this.apiEndpoint,
            primaryFormat: this.isIOS ? 'Reality' : 'GLB (planned)',
            iosVersion: this.iosVersion,
            debugMode: this.debugMode,
            capabilities: {
                reality: this.isIOS && this.iosVersion >= 12,
                usdz: this.isIOS && this.iosVersion >= 12,
                webxr: this.supportsWebXR(),
                glb: false // planned
            }
        };
    }

    /**
     * Clear cache AR
     */
    clearCache() {
        console.log('[ARHandler] Czyszczenie cache AR...');
        this.modelCache.clear();
        console.log('[ARHandler] Cache wyczyszczony');
    }

    /**
     * Włącz/wyłącz debug mode
     */
    enableDebug(enabled = true) {
        this.debugMode = enabled;
        console.log('[ARHandler] Debug mode:', enabled ? 'ENABLED' : 'DISABLED');
        
        if (enabled) {
            console.log('[ARHandler] Debug commands available:');
            console.log('  - debugARTextures("variant-code")');
            console.log('  - debugARFile("filename.reality")');
            console.log('  - window.ARHandler.getStatus()');
        }
    }

    /**
     * Test Reality AR (dla debugowania)
     */
    async testRealityAR(productData) {
        console.log('[ARHandler] Test Reality AR...');

        if (!productData) {
            console.error('[ARHandler] Brak danych produktu do testowania');
            return;
        }

        try {
            this.enableDebug(true);
            const realityUrl = await this.generateRealityFile(productData);
            console.log('[ARHandler] Test Reality URL:', realityUrl);

            // Otwórz bezpośrednio
            window.open(realityUrl, '_blank');

        } catch (error) {
            console.error('[ARHandler] Test Reality AR failed:', error);
        }
    }

    /**
     * Porównanie formatów (dla debugowania)
     */
    async compareFormats(productData) {
        if (!productData) {
            console.error('[ARHandler] Brak produktu do porównania');
            return;
        }

        try {
            console.log('[ARHandler] Porównanie formatów AR...');
            this.enableDebug(true);

            // Test Reality
            const realityStart = performance.now();
            const realityUrl = await this.generateRealityFile(productData);
            const realityTime = performance.now() - realityStart;

            // Test USDZ
            const usdzStart = performance.now();
            const usdzUrl = await this.generateUSDZFile(productData);
            const usdzTime = performance.now() - usdzStart;

            // Pobierz rozmiary plików
            const realitySize = await this._getFileSize(realityUrl);
            const usdzSize = await this._getFileSize(usdzUrl);

            // Debug info
            const realityDebug = await this.debugUSDZTextures(realityUrl);
            const usdzDebug = await this.debugUSDZTextures(usdzUrl);

            console.log('[ARHandler] Porównanie formatów:');
            console.table({
                Reality: {
                    url: realityUrl,
                    generationTime: `${realityTime.toFixed(2)}ms`,
                    fileSize: `${realitySize} bytes`,
                    fileSizeMB: `${(realitySize / 1024 / 1024).toFixed(2)} MB`,
                    hasTextures: realityDebug?.diagnosis.has_textures ? '✅' : '❌',
                    textureCount: realityDebug?.diagnosis.texture_count || 0
                },
                USDZ: {
                    url: usdzUrl,
                    generationTime: `${usdzTime.toFixed(2)}ms`,
                    fileSize: `${usdzSize} bytes`,
                    fileSizeMB: `${(usdzSize / 1024 / 1024).toFixed(2)} MB`,
                    hasTextures: usdzDebug?.diagnosis.has_textures ? '✅' : '❌',
                    textureCount: usdzDebug?.diagnosis.texture_count || 0
                }
            });

            return {
                reality: { url: realityUrl, time: realityTime, size: realitySize, debug: realityDebug },
                usdz: { url: usdzUrl, time: usdzTime, size: usdzSize, debug: usdzDebug }
            };

        } catch (error) {
            console.error('[ARHandler] Błąd porównania formatów:', error);
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
            console.error('[ARHandler] Błąd pobierania rozmiaru pliku:', error);
            return 0;
        }
    }

    /**
     * Force Reality AR (dla debugowania)
     */
    async forceRealityAR(productData) {
        console.log('[ARHandler] Force Reality AR - bezpośrednie wywołanie');

        if (!productData) {
            alert('Brak produktu - wybierz wariant najpierw');
            return;
        }

        try {
            this.enableDebug(true);
            const realityUrl = await this.generateRealityFile(productData);

            // Bezpośrednie przekierowanie
            window.location.href = realityUrl;

        } catch (error) {
            console.error('[ARHandler] Force Reality AR failed:', error);
            alert(`Błąd: ${error.message}`);
        }
    }

    /**
     * Validate AR file
     */
    async validateARFile(url) {
        console.log('[ARHandler] Walidacja pliku AR:', url);
        
        try {
            // Sprawdź dostępność
            const headResponse = await fetch(url, { method: 'HEAD' });
            if (!headResponse.ok) {
                throw new Error(`Plik niedostępny: ${headResponse.status}`);
            }

            const contentType = headResponse.headers.get('content-type');
            const fileSize = headResponse.headers.get('content-length');
            
            console.log('[ARHandler] File validation:');
            console.log('  Status:', headResponse.status);
            console.log('  Content-Type:', contentType);
            console.log('  Size:', fileSize, 'bytes');
            
            // Sprawdź MIME type
            const isValidMime = contentType && (
                contentType.includes('reality') || 
                contentType.includes('usdz') || 
                contentType.includes('model')
            );
            
            if (!isValidMime) {
                console.warn('[ARHandler] ⚠️ Nieoczekiwany MIME type:', contentType);
            }
            
            // Sprawdź zawartość jeśli to debug
            if (this.debugMode) {
                await this.debugUSDZTextures(url);
            }
            
            return {
                valid: headResponse.ok,
                contentType: contentType,
                size: parseInt(fileSize || '0'),
                accessible: true
            };
            
        } catch (error) {
            console.error('[ARHandler] Validation failed:', error);
            return {
                valid: false,
                error: error.message,
                accessible: false
            };
        }
    }

    /**
     * Health check całego systemu AR
     */
    async healthCheck() {
        console.log('[ARHandler] Health check systemu AR...');
        
        const health = {
            platform: this.getPlatformInfo(),
            arSupported: this.isIOS && this.iosVersion >= 12,
            apiEndpoint: this.apiEndpoint,
            cacheSize: this.modelCache.size,
            timestamp: new Date().toISOString()
        };
        
        // Test połączenia z API
        try {
            const testResponse = await fetch(`${this.apiEndpoint}/ar-info`);
            health.apiConnected = testResponse.ok;
            
            if (testResponse.ok) {
                const apiInfo = await testResponse.json();
                health.apiInfo = apiInfo;
            }
        } catch (error) {
            health.apiConnected = false;
            health.apiError = error.message;
        }
        
        // Test tekstur przykładowych
        try {
            const textureTest = await this.debugVariantTextures('dab-lity-ab');
            health.texturesAvailable = textureTest ? textureTest.summary.existing_files > 0 : false;
        } catch (error) {
            health.texturesAvailable = false;
            health.textureError = error.message;
        }
        
        console.log('[ARHandler] Health check result:');
        console.table(health);
        
        return health;
    }

    /**
     * Debug info kompletny
     */
    debugInfo() {
        console.log('[ARHandler] === DEBUG INFO ===');
        console.log('Platform:', this.getPlatformInfo());
        console.log('Supported Formats:', this.supportedFormats);
        console.log('Cache Size:', this.modelCache.size);
        console.log('API Endpoint:', this.apiEndpoint);
        console.log('iOS Version:', this.iosVersion);
        console.log('Debug Mode:', this.debugMode);
        console.log('Capabilities:', {
            reality: this.isIOS && this.iosVersion >= 12,
            usdz: this.isIOS && this.iosVersion >= 12,
            webxr: this.supportsWebXR()
        });
        
        if (this.modelCache.size > 0) {
            console.log('Cached models:');
            this.modelCache.forEach((url, key) => {
                console.log(`  ${key}: ${url}`);
            });
        }

        return this.getStatus();
    }
}

// Globalna instancja
window.ARHandler = new ARHandler();

// Globalne funkcje debug dla łatwego dostępu
window.debugARTextures = async (variantCode) => {
    window.ARHandler.enableDebug(true);
    return await window.ARHandler.debugVariantTextures(variantCode);
};

window.debugARFile = async (filename) => {
    window.ARHandler.enableDebug(true);
    const usdzUrl = `/preview3d-ar/ar-models/${filename}`;
    return await window.ARHandler.debugUSDZTextures(usdzUrl);
};

window.validateARFile = async (url) => {
    return await window.ARHandler.validateARFile(url);
};

window.arHealthCheck = async () => {
    return await window.ARHandler.healthCheck();
};

window.clearARCache = () => {
    window.ARHandler.clearCache();
};

window.enableARDebug = (enabled = true) => {
    window.ARHandler.enableDebug(enabled);
};

window.testRealityAR = async (productData) => {
    return await window.ARHandler.testRealityAR(productData);
};

window.compareARFormats = async (productData) => {
    return await window.ARHandler.compareFormats(productData);
};

window.forceRealityAR = async (productData) => {
    return await window.ARHandler.forceRealityAR(productData);
};

window.getARStatus = () => {
    return window.ARHandler.getStatus();
};

window.debugARHandler = () => {
    return window.ARHandler.debugInfo();
};

// Auto-enable debug jeśli jest parametr URL
if (window.location.search.includes('debug=1')) {
    window.ARHandler.enableDebug(true);
    console.log('[ARHandler] Auto-enabled debug mode from URL parameter');
}

console.log('[ARHandler] Enhanced AR Handler 5.1 załadowany z obsługą Reality format + texture debugging - COMPLETE!');

console.log('[ARHandler] Available debug commands:');
console.log('  debugARTextures("dab-lity-ab") - Check variant textures');
console.log('  debugARFile("filename.reality") - Check USDZ content');
console.log('  validateARFile(url) - Validate AR file');
console.log('  arHealthCheck() - Full system health check');
console.log('  enableARDebug(true) - Enable debug mode');
console.log('  testRealityAR(productData) - Test Reality generation');
console.log('  compareARFormats(productData) - Compare Reality vs USDZ');
console.log('  forceRealityAR(productData) - Force Reality AR');
console.log('  getARStatus() - Get system status');
console.log('  debugARHandler() - Full debug info');
console.log('  clearARCache() - Clear model cache');

// Export dla compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARHandler;
}