// app/modules/preview3d_ar/static/js/ar-handler.js

/**
 * AR Handler - obsługa rzeczywistości rozszerzonej
 * Wersja 2.0 z lepszym UX i przygotowaniem pod prawdziwy AR
 */

class ARHandler {
    constructor() {
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        this.isAndroid = /Android/.test(navigator.userAgent);
        this.isMobile = this.isIOS || this.isAndroid;
        
        // Sprawdź wersje systemów
        this.iosVersion = this.getIOSVersion();
        this.androidVersion = this.getAndroidVersion();
        
        console.log('[ARHandler] Inicjalizacja AR Handler 2.0');
        console.log(`[ARHandler] Platforma: ${this.getPlatformInfo()}`);
    }

    /**
     * Główna metoda inicjowania AR
     * @param {Object} productData - dane produktu
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
            if (this.isIOS && this.iosVersion >= 12) {
                await this.initiateIOSAR(productData);
            } else if (this.isAndroid && this.supportsWebXR()) {
                await this.initiateAndroidAR(productData);
            } else {
                this.showUnsupportedMessage();
            }
        } catch (error) {
            console.error('[ARHandler] Błąd AR:', error);
            this.showError(`Błąd AR: ${error.message}`);
        }
    }

    /**
     * AR dla iOS - przygotowanie pod USDZ
     * @param {Object} productData
     */
    async initiateIOSAR(productData) {
        console.log('[ARHandler] Przygotowanie iOS AR (USDZ)');

        // TODO: Po implementacji backendu do generowania USDZ
        // const usdzUrl = await this.generateUSDZFile(productData);
        // this.openUSDZFile(usdzUrl);

        // Na razie pokazujemy informację
        this.showIOSARPreview(productData);
    }

    /**
     * AR dla Android - przygotowanie pod WebXR/Model Viewer
     * @param {Object} productData
     */
    async initiateAndroidAR(productData) {
        console.log('[ARHandler] Przygotowanie Android AR (WebXR)');

        // TODO: Po implementacji WebXR
        // const glbUrl = await this.generateGLBFile(productData);
        // this.openWebXRAR(glbUrl);

        // Na razie pokazujemy informację
        this.showAndroidARPreview(productData);
    }

    /**
     * Pokazuje podgląd dla iOS AR
     */
    showIOSARPreview(productData) {
        const modal = this.createARPreviewModal('iOS QuickLook AR', productData, {
            icon: '📱',
            description: 'Wybierz "Wyświetl w AR" w prawym górnym rogu',
            features: [
                '🎯 Automatyczne wykrywanie powierzchni',
                '👆 Gestów dotykowe do manipulacji',
                '📏 Skalowanie w czasie rzeczywistym',
                '🔄 Obracanie dwoma palcami'
            ],
            requirements: 'iPhone/iPad z iOS 12+ i procesorem A9+',
            comingSoon: true
        });

        this.showModal(modal);
    }

    /**
     * Pokazuje podgląd dla Android AR
     */
    showAndroidARPreview(productData) {
        const modal = this.createARPreviewModal('Android WebXR AR', productData, {
            icon: '🤖',
            description: 'AR uruchomi się w przeglądarce z obsługą WebXR',
            features: [
                '🎯 Wykrywanie płaskich powierzchni',
                '👆 Dotknij aby umieścić model',
                '🎮 Kontrolki AR w przeglądarce',
                '📐 Pomiary w czasie rzeczywistym'
            ],
            requirements: 'Android 7.0+ z Google Play Services for AR',
            comingSoon: true
        });

        this.showModal(modal);
    }

    /**
     * Tworzy modal podglądu AR
     */
    createARPreviewModal(title, productData, options) {
        const modal = document.createElement('div');
        modal.className = 'ar-preview-modal';
        
        const productInfo = `${productData.variant_code?.toUpperCase() || 'Wariant'} - ${Math.round(productData.dimensions?.length || 0)}×${Math.round(productData.dimensions?.width || 0)}×${(productData.dimensions?.thickness || 0).toFixed(1)} cm`;

        modal.innerHTML = `
            <div class="ar-preview-content">
                <div class="ar-preview-header">
                    <div class="ar-icon">${options.icon}</div>
                    <h2>${title}</h2>
                    <button class="ar-close-btn" onclick="this.closest('.ar-preview-modal').remove()">×</button>
                </div>
                
                <div class="ar-preview-body">
                    <div class="product-preview">
                        <div class="product-swatch"></div>
                        <div class="product-details">
                            <h3>${productInfo}</h3>
                            <p>${options.description}</p>
                        </div>
                    </div>

                    ${options.comingSoon ? `
                        <div class="coming-soon-banner">
                            🚀 <strong>Funkcja dostępna wkrótce!</strong>
                            <p>Pracujemy nad implementacją pełnej obsługi AR</p>
                        </div>
                    ` : ''}

                    <div class="ar-features">
                        <h4>Funkcje AR:</h4>
                        <ul>
                            ${options.features.map(feature => `<li>${feature}</li>`).join('')}
                        </ul>
                    </div>

                    <div class="ar-requirements">
                        <h4>Wymagania:</h4>
                        <p>${options.requirements}</p>
                    </div>
                </div>

                <div class="ar-preview-footer">
                    ${options.comingSoon ? `
                        <button class="btn-ar-demo" onclick="this.closest('.ar-preview-modal').remove()">
                            Rozumiem
                        </button>
                        <button class="btn-ar-notify">
                            Powiadom o dostępności
                        </button>
                    ` : `
                        <button class="btn-ar-cancel" onclick="this.closest('.ar-preview-modal').remove()">
                            Anuluj
                        </button>
                        <button class="btn-ar-start">
                            Uruchom AR
                        </button>
                    `}
                </div>
            </div>
        `;

        // Dodaj style inline (lepiej byłoby w CSS)
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex; align-items: center; justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.3s ease;
        `;

        return modal;
    }

    /**
     * Pokazuje modal
     */
    showModal(modal) {
        document.body.appendChild(modal);
        
        // Dodaj obsługę zamykania na ESC
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Dodaj obsługę kliknięcia w tło
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                document.removeEventListener('keydown', handleEscape);
            }
        });
    }

    /**
     * Pokazuje komunikat dla komputerów
     */
    showDesktopMessage() {
        const message = `
            🖥️ Rzeczywistość rozszerzona (AR) jest dostępna tylko na urządzeniach mobilnych.
            
            Obsługiwane urządzenia:
            📱 iPhone/iPad z iOS 12+
            🤖 Android z obsługą ARCore
            
            Użyj telefonu lub tabletu, aby skorzystać z funkcji AR.
        `;
        
        alert(message);
    }

    /**
     * Pokazuje komunikat o braku obsługi
     */
    showUnsupportedMessage() {
        let message = '❌ AR nie jest obsługiwane na tym urządzeniu.\n\n';
        
        if (this.isIOS && this.iosVersion < 12) {
            message += `📱 Wykryto iOS ${this.iosVersion}. Wymagane iOS 12+.\n`;
        } else if (this.isAndroid && !this.supportsWebXR()) {
            message += '🤖 Twoje urządzenie Android nie obsługuje WebXR.\n';
        }
        
        message += '\nSkontaktuj się z pomocą techniczną, jeśli uważasz, że to błąd.';
        
        alert(message);
    }

    /**
     * Pokazuje błąd AR
     */
    showError(message) {
        alert(`🚫 ${message}\n\nSpróbuj ponownie lub skontaktuj się z pomocą techniczną.`);
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
     * Sprawdza czy urządzenie ma LiDAR
     */
    hasLiDAR() {
        if (!this.isIOS) return false;
        
        const lidarModels = [
            'iPhone13,3', 'iPhone13,4',  // iPhone 12 Pro/Pro Max
            'iPhone14,2', 'iPhone14,3',  // iPhone 13 Pro/Pro Max  
            'iPhone15,2', 'iPhone15,3',  // iPhone 14 Pro/Pro Max
            'iPhone16,1', 'iPhone16,2',  // iPhone 15 Pro/Pro Max
            'iPad13,4', 'iPad13,5', 'iPad13,6', 'iPad13,7'  // iPad Pro 2020+
        ];
        
        return lidarModels.some(model => navigator.userAgent.includes(model));
    }

    /**
     * Zwraca informacje o platformie
     */
    getPlatformInfo() {
        if (this.isIOS) {
            return `iOS ${this.iosVersion}${this.hasLiDAR() ? ' (LiDAR)' : ''}`;
        } else if (this.isAndroid) {
            return `Android ${this.androidVersion}${this.supportsWebXR() ? ' (WebXR)' : ''}`;
        } else {
            return 'Desktop';
        }
    }

    // TODO: Metody do implementacji po stronie backendu

    /**
     * Generuje plik USDZ dla iOS (TODO)
     */
    async generateUSDZFile(productData) {
        const params = new URLSearchParams({
            variant: productData.variant_code,
            length: productData.dimensions.length,
            width: productData.dimensions.width,
            thickness: productData.dimensions.thickness
        });

        const response = await fetch(`/preview3d-ar/api/generate-usdz?${params}`);
        if (!response.ok) throw new Error('Błąd generowania pliku USDZ');
        
        return response.url;
    }

    /**
     * Generuje plik GLB dla Android (TODO)
     */
    async generateGLBFile(productData) {
        const params = new URLSearchParams({
            variant: productData.variant_code,
            length: productData.dimensions.length,
            width: productData.dimensions.width,
            thickness: productData.dimensions.thickness
        });

        const response = await fetch(`/preview3d-ar/api/generate-glb?${params}`);
        if (!response.ok) throw new Error('Błąd generowania pliku GLB');
        
        return response.url;
    }

    /**
     * Otwiera plik USDZ w QuickLook (TODO)
     */
    openUSDZFile(usdzUrl) {
        const link = document.createElement('a');
        link.href = usdzUrl;
        link.rel = 'ar';
        link.click();
    }

    /**
     * Uruchamia WebXR AR (TODO)
     */
    async openWebXRAR(glbUrl) {
        if (!this.supportsWebXR()) {
            throw new Error('WebXR nie jest obsługiwane');
        }
        
        // Implementacja WebXR AR
        const session = await navigator.xr.requestSession('immersive-ar');
        // ... kod WebXR
    }
}

// Globalna instancja
window.ARHandler = new ARHandler();

// Dodaj style CSS dla modali AR (można przenieść do osobnego pliku CSS)
const arStyles = document.createElement('style');
arStyles.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    .ar-preview-content {
        background: white;
        border-radius: 16px;
        max-width: 500px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        animation: slideUp 0.3s ease;
    }

    @keyframes slideUp {
        from { transform: translateY(50px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }

    .ar-preview-header {
        display: flex;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid #eee;
        background: #f8f9fa;
        border-radius: 16px 16px 0 0;
    }

    .ar-icon {
        font-size: 24px;
        margin-right: 12px;
    }

    .ar-preview-header h2 {
        flex: 1;
        margin: 0;
        font-size: 18px;
        font-weight: 600;
    }

    .ar-close-btn {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
        width: 32px;
        height: 32px;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .ar-close-btn:hover {
        background: #e9ecef;
    }

    .ar-preview-body {
        padding: 20px;
    }

    .product-preview {
        display: flex;
        align-items: center;
        margin-bottom: 20px;
        padding: 16px;
        background: #f8f9fa;
        border-radius: 8px;
    }

    .product-swatch {
        width: 48px;
        height: 48px;
        background: linear-gradient(135deg, #8B4513, #A0522D);
        border-radius: 8px;
        margin-right: 16px;
        border: 2px solid #dee2e6;
    }

    .product-details h3 {
        margin: 0 0 4px 0;
        font-size: 16px;
        font-weight: 600;
    }

    .product-details p {
        margin: 0;
        color: #6c757d;
        font-size: 14px;
    }

    .coming-soon-banner {
        background: linear-gradient(135deg, #ED6B24, #ff8c42);
        color: white;
        padding: 16px;
        border-radius: 8px;
        text-align: center;
        margin-bottom: 20px;
    }

    .coming-soon-banner strong {
        display: block;
        margin-bottom: 4px;
    }

    .ar-features, .ar-requirements {
        margin-bottom: 20px;
    }

    .ar-features h4, .ar-requirements h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
        color: #495057;
    }

    .ar-features ul {
        margin: 0;
        padding-left: 0;
        list-style: none;
    }

    .ar-features li {
        padding: 4px 0;
        font-size: 14px;
        color: #6c757d;
    }

    .ar-requirements p {
        margin: 0;
        font-size: 14px;
        color: #6c757d;
        background: #f8f9fa;
        padding: 12px;
        border-radius: 6px;
    }

    .ar-preview-footer {
        padding: 20px;
        border-top: 1px solid #eee;
        display: flex;
        gap: 12px;
        justify-content: flex-end;
    }

    .ar-preview-footer button {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .btn-ar-demo, .btn-ar-cancel {
        background: #6c757d;
        color: white;
    }

    .btn-ar-demo:hover, .btn-ar-cancel:hover {
        background: #5a6268;
    }

    .btn-ar-notify, .btn-ar-start {
        background: #ED6B24;
        color: white;
    }

    .btn-ar-notify:hover, .btn-ar-start:hover {
        background: #d8571a;
    }

    @media (max-width: 768px) {
        .ar-preview-content {
            margin: 20px;
            max-width: none;
        }

        .ar-preview-footer {
            flex-direction: column;
        }

        .ar-preview-footer button {
            width: 100%;
        }
    }
`;

document.head.appendChild(arStyles);

console.log('[ARHandler] AR Handler 2.0 załadowany z nowoczesnymi modalami');

// Export dla compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARHandler;
}