// app/modules/preview3d_ar/static/js/ar-handler.js

/**
 * AR Handler - obsługa rzeczywistości rozszerzonej
 * Obsługuje AR dla iOS (USDZ) i Android (WebXR/ModelViewer)
 */

class ARHandler {
    constructor() {
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        this.isAndroid = /Android/.test(navigator.userAgent);
        this.hasWebXR = 'xr' in navigator;

        console.log('[ARHandler] Inicjalizacja:', {
            isIOS: this.isIOS,
            isAndroid: this.isAndroid,
            hasWebXR: this.hasWebXR
        });
    }

    /**
     * Sprawdza czy AR jest obsługiwane na tym urządzeniu
     * @returns {boolean}
     */
    isSupported() {
        return this.isIOS || (this.isAndroid && this.hasWebXR);
    }

    /**
     * Zwraca typ obsługiwanego AR
     * @returns {string} 'ios', 'android', lub 'none'
     */
    getSupportedType() {
        if (this.isIOS) return 'ios';
        if (this.isAndroid && this.hasWebXR) return 'android';
        return 'none';
    }

    /**
     * Inicjuje AR dla danego produktu
     * @param {Object} productData - Dane produktu (variant_code, dimensions, etc.)
     */
    async initiateAR(productData) {
        console.log('[ARHandler] Inicjowanie AR dla:', productData);

        if (!this.isSupported()) {
            this.showUnsupportedMessage();
            return;
        }

        try {
            if (this.isIOS) {
                await this.initiateIOSAR(productData);
            } else if (this.isAndroid) {
                await this.initiateAndroidAR(productData);
            }
        } catch (error) {
            console.error('[ARHandler] Błąd inicjowania AR:', error);
            this.showErrorMessage(error.message);
        }
    }

    /**
     * AR dla iOS - używa plików USDZ
     * @param {Object} productData
     */
    async initiateIOSAR(productData) {
        console.log('[ARHandler] Inicjowanie iOS AR');

        // TODO: Implementacja generowania/pobierania pliku USDZ
        // Na razie pokazujemy informację

        const message = `AR dla iOS\n\nProdukt: ${productData.variant_code}\nWymiary: ${productData.dimensions.length}×${productData.dimensions.width}×${productData.dimensions.thickness} cm\n\nFunkcja będzie dostępna wkrótce.\nIOS obsługuje pliki USDZ z QuickLook.`;

        if (confirm(message + '\n\nCzy chcesz zobaczyć instrukcję obsługi AR na iOS?')) {
            this.showIOSInstructions();
        }
    }

    /**
     * AR dla Android - używa WebXR lub Model Viewer
     * @param {Object} productData
     */
    async initiateAndroidAR(productData) {
        console.log('[ARHandler] Inicjowanie Android AR');

        // TODO: Implementacja WebXR lub Model Viewer
        // Na razie pokazujemy informację

        const message = `AR dla Android\n\nProdukt: ${productData.variant_code}\nWymiary: ${productData.dimensions.length}×${productData.dimensions.width}×${productData.dimensions.thickness} cm\n\nFunkcja będzie dostępna wkrótce.\nAndroid obsługuje WebXR lub Model Viewer.`;

        if (confirm(message + '\n\nCzy chcesz zobaczyć instrukcję obsługi AR na Android?')) {
            this.showAndroidInstructions();
        }
    }

    /**
     * Pokazuje komunikat o braku obsługi AR
     */
    showUnsupportedMessage() {
        const message = `Rzeczywistość rozszerzona (AR) nie jest obsługiwana na tym urządzeniu.\n\nObsługiwane platformy:\n• iOS 12+ (iPhone/iPad)\n• Android z obsługą ARCore\n\nTwoje urządzenie: ${navigator.userAgent}`;

        alert(message);
    }

    /**
     * Pokazuje komunikat o błędzie AR
     * @param {string} errorMessage
     */
    showErrorMessage(errorMessage) {
        alert(`Błąd AR: ${errorMessage}\n\nSpróbuj ponownie lub skontaktuj się z pomocą techniczną.`);
    }

    /**
     * Pokazuje instrukcje dla iOS
     */
    showIOSInstructions() {
        const instructions = `Instrukcja AR dla iOS:\n\n1. Pliki USDZ otwierają się automatycznie w QuickLook\n2. Dotknij ikonę AR w prawym górnym rogu\n3. Skieruj kamerę na płaską powierzchnię\n4. Dotknij aby umieścić model\n5. Użyj gestów do manipulacji:\n   • Przeciągnij - przesuń\n   • Uszczypnij - skaluj\n   • Obróć dwoma palcami - obróć\n\nUwaga: Wymaga iOS 12+ i urządzenia z procesorem A9+`;

        alert(instructions);
    }

    /**
     * Pokazuje instrukcje dla Android
     */
    showAndroidInstructions() {
        const instructions = `Instrukcja AR dla Android:\n\n1. Upewnij się że Google Play Services for AR jest zainstalowane\n2. Model zostanie załadowany w przeglądarce\n3. Dotknij przycisk AR\n4. Skieruj kamerę na płaską powierzchnię\n5. Dotknij aby umieścić model\n6. Użyj gestów do manipulacji\n\nUwaga: Wymaga Android 7.0+ i obsługi ARCore`;

        alert(instructions);
    }

    /**
     * Generuje URL dla pliku USDZ (iOS)
     * @param {Object} productData
     * @returns {string}
     */
    generateUSDZUrl(productData) {
        // TODO: Implementacja generowania USDZ
        const baseUrl = '/preview3d-ar/api/generate-usdz';
        const params = new URLSearchParams({
            variant: productData.variant_code,
            length: productData.dimensions.length,
            width: productData.dimensions.width,
            thickness: productData.dimensions.thickness
        });

        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * Generuje URL dla modelu GLB (Android)
     * @param {Object} productData
     * @returns {string}
     */
    generateGLBUrl(productData) {
        // TODO: Implementacja generowania GLB
        const baseUrl = '/preview3d-ar/api/generate-glb';
        const params = new URLSearchParams({
            variant: productData.variant_code,
            length: productData.dimensions.length,
            width: productData.dimensions.width,
            thickness: productData.dimensions.thickness
        });

        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * Sprawdza czy urządzenie ma LiDAR (iOS)
     * @returns {boolean}
     */
    hasLiDAR() {
        // Heurystyka - LiDAR dostępny na:
        // - iPhone 12 Pro/Pro Max (2020)
        // - iPhone 13 Pro/Pro Max (2021)
        // - iPhone 14 Pro/Pro Max (2022)
        // - iPhone 15 Pro/Pro Max (2023)
        // - iPad Pro 4th gen+ (2020+)

        if (!this.isIOS) return false;

        // Sprawdź user agent dla modeli z LiDAR
        const userAgent = navigator.userAgent;
        const hasLiDARModels = [
            'iPhone13,3', 'iPhone13,4',  // iPhone 12 Pro/Pro Max
            'iPhone14,2', 'iPhone14,3',  // iPhone 13 Pro/Pro Max
            'iPhone15,2', 'iPhone15,3',  // iPhone 14 Pro/Pro Max
            'iPhone16,1', 'iPhone16,2',  // iPhone 15 Pro/Pro Max
            'iPad13,4', 'iPad13,5', 'iPad13,6', 'iPad13,7'  // iPad Pro 2020+
        ];

        return hasLiDARModels.some(model => userAgent.includes(model));
    }
}

// Globalna instancja
window.ARHandler = new ARHandler();

console.log('[ARHandler] Załadowano obsługę AR');

// Export dla compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ARHandler;
}