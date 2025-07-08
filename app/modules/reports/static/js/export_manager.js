// modules/reports/static/js/export_manager.js
/**
 * Manager eksportu danych do Excel
 * Odpowiedzialny za generowanie i pobieranie plików Excel
 */

class ExportManager {
    constructor() {
        this.isExporting = false;
        this.exportButton = null;

        console.log('[ExportManager] Initialized');
    }

    /**
     * Inicjalizacja managera
     */
    init() {
        console.log('[ExportManager] Starting initialization...');

        this.cacheElements();
        this.setupEventListeners();

        console.log('[ExportManager] Initialization complete');
    }

    /**
     * Cache elementów DOM
     */
    cacheElements() {
        this.exportButton = document.getElementById('exportExcelBtn');

        console.log('[ExportManager] Elements cached');
    }

    /**
     * Ustawienie event listenerów
     */
    setupEventListeners() {
        // Obsługa skrótu klawiszowego Ctrl+E jest już w ReportsManager

        console.log('[ExportManager] Event listeners setup complete');
    }

    /**
     * Główna funkcja eksportu do Excel
     */
    async exportToExcel() {
        if (this.isExporting) {
            console.log('[ExportManager] Export already in progress, skipping...');
            return;
        }

        console.log('[ExportManager] Starting Excel export...');

        this.setExportingState(true);

        try {
            // Pobierz aktualne filtry i zakres dat
            const filters = window.reportsManager ? window.reportsManager.getCurrentFilters() : {};
            const dateRange = window.reportsManager ? window.reportsManager.getDateRange() : 'last_month';

            console.log('[ExportManager] Export parameters:', {
                dateRange,
                filtersCount: Object.keys(filters).length
            });

            // Przygotuj parametry URL
            const params = new URLSearchParams({
                date_range: dateRange
            });

            // Dodaj filtry
            for (const [key, value] of Object.entries(filters)) {
                if (value && value.trim()) {
                    params.append(`filter_${key}`, value.trim());
                }
            }

            // Wykonaj request do API eksportu
            const response = await fetch(`/reports/api/export-excel?${params}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            });

            if (!response.ok) {
                // Sprawdź czy to JSON z błędem
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorResult = await response.json();
                    throw new Error(errorResult.error || 'Błąd eksportu');
                } else {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            }

            // Pobierz blob z pliku Excel
            const blob = await response.blob();

            if (blob.size === 0) {
                throw new Error('Otrzymano pusty plik');
            }

            // Pobierz nazwę pliku z nagłówka lub wygeneruj
            const filename = this.getFilenameFromResponse(response) || this.generateFilename();

            // Pobierz plik
            this.downloadBlob(blob, filename);

            console.log('[ExportManager] Excel export completed successfully', {
                filename,
                fileSize: blob.size
            });

            // Pokaż komunikat sukcesu
            this.showExportSuccess(filename, blob.size);

        } catch (error) {
            console.error('[ExportManager] Export error:', error);
            this.showExportError(error.message);
        } finally {
            this.setExportingState(false);
        }
    }

    /**
     * Pobranie nazwy pliku z nagłówka odpowiedzi
     */
    getFilenameFromResponse(response) {
        const contentDisposition = response.headers.get('Content-Disposition');
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
                return filenameMatch[1].replace(/['"]/g, '');
            }
        }
        return null;
    }

    /**
     * Generowanie nazwy pliku
     */
    generateFilename() {
        const now = new Date();
        const dateString = now.toISOString().slice(0, 19).replace(/[T:]/g, '_');
        const dateRange = window.reportsManager ? window.reportsManager.getDateRange() : 'unknown';

        return `raporty_sprzedazy_${dateRange}_${dateString}.xlsx`;
    }

    /**
     * Pobieranie blob'a jako plik
     */
    downloadBlob(blob, filename) {
        console.log('[ExportManager] Downloading file:', filename);

        // Sprawdź czy przeglądarka obsługuje download
        if (window.navigator && window.navigator.msSaveOrOpenBlob) {
            // Internet Explorer
            window.navigator.msSaveOrOpenBlob(blob, filename);
        } else {
            // Nowoczesne przeglądarki
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';

            // Dodaj do DOM, kliknij, usuń
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Zwolnij URL po krótkiej chwili
            setTimeout(() => {
                window.URL.revokeObjectURL(url);
            }, 1000);
        }
    }

    /**
     * Ustawienie stanu eksportowania
     */
    setExportingState(isExporting) {
        this.isExporting = isExporting;

        if (this.exportButton) {
            this.exportButton.disabled = isExporting;

            if (isExporting) {
                this.exportButton.innerHTML = `
                    <i class="fas fa-spinner fa-spin"></i>
                    Eksportowanie...
                `;
            } else {
                this.exportButton.innerHTML = `
                    <i class="fas fa-download"></i>
                    Eksport Excel
                `;
            }
        }

        console.log('[ExportManager] Export state changed:', isExporting);
    }

    /**
     * Komunikat sukcesu eksportu
     */
    showExportSuccess(filename, fileSize) {
        const fileSizeKB = Math.round(fileSize / 1024);
        const message = `Plik "${filename}" został pobrany pomyślnie (${fileSizeKB} KB)`;

        console.log('[ExportManager] Export success:', message);

        // TODO: Lepszy system notyfikacji (toast, snackbar)
        this.showNotification(message, 'success');
    }

    /**
     * Komunikat błędu eksportu
     */
    showExportError(errorMessage) {
        const message = `Błąd eksportu: ${errorMessage}`;

        console.error('[ExportManager] Export error:', message);

        this.showNotification(message, 'error');
    }

    /**
     * Pokazanie notyfikacji
     */
    showNotification(message, type = 'info') {
        // Prosta implementacja - można zastąpić lepszym systemem
        console.log(`[ExportManager] ${type.toUpperCase()}: ${message}`);

        if (type === 'error') {
            alert(`Błąd: ${message}`);
        } else {
            // Dla sukcesu można użyć toast'a lub innej metody
            // Na razie console log wystarczy, bo download jest oczywisty dla użytkownika
            console.log(`Success: ${message}`);
        }
    }

    /**
     * Eksport z niestandardowymi parametrami
     */
    async exportWithCustomParams(customParams = {}) {
        console.log('[ExportManager] Custom export with params:', customParams);

        if (this.isExporting) {
            console.log('[ExportManager] Export already in progress, skipping custom export...');
            return;
        }

        this.setExportingState(true);

        try {
            // Przygotuj parametry URL
            const params = new URLSearchParams(customParams);

            // Wykonaj request
            const response = await fetch(`/reports/api/export-excel?${params}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            });

            if (!response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorResult = await response.json();
                    throw new Error(errorResult.error || 'Błąd eksportu');
                } else {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            }

            // Pobierz i zapisz plik
            const blob = await response.blob();
            const filename = this.getFilenameFromResponse(response) || this.generateCustomFilename(customParams);

            this.downloadBlob(blob, filename);
            this.showExportSuccess(filename, blob.size);

        } catch (error) {
            console.error('[ExportManager] Custom export error:', error);
            this.showExportError(error.message);
        } finally {
            this.setExportingState(false);
        }
    }

    /**
     * Generowanie nazwy pliku dla niestandardowego eksportu
     */
    generateCustomFilename(params) {
        const now = new Date();
        const dateString = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const timeString = now.toTimeString().slice(0, 8).replace(/:/g, '-'); // HH-MM-SS

        let suffix = '';
        if (params.date_range) {
            suffix = `_${params.date_range}`;
        }

        return `raporty_sprzedazy${suffix}_${dateString}_${timeString}.xlsx`;
    }

    /**
     * Sprawdzenie czy eksport jest możliwy
     */
    canExport() {
        // Sprawdź czy są dane do eksportu
        const currentData = window.reportsManager ? window.reportsManager.getCurrentData() : [];

        if (currentData.length === 0) {
            console.log('[ExportManager] Cannot export: no data available');
            this.showNotification('Brak danych do eksportu. Zmień filtry lub zakres dat.', 'warning');
            return false;
        }

        if (this.isExporting) {
            console.log('[ExportManager] Cannot export: export in progress');
            this.showNotification('Eksport już w toku. Proszę czekać...', 'warning');
            return false;
        }

        return true;
    }

    /**
     * Eksport z walidacją
     */
    async exportToExcelWithValidation() {
        if (!this.canExport()) {
            return;
        }

        await this.exportToExcel();
    }

    /**
     * Pobieranie informacji o aktualnych danych do eksportu
     */
    getExportInfo() {
        const currentData = window.reportsManager ? window.reportsManager.getCurrentData() : [];
        const currentStats = window.reportsManager ? window.reportsManager.getCurrentStats() : {};
        const dateRange = window.reportsManager ? window.reportsManager.getDateRange() : 'unknown';
        const filters = window.reportsManager ? window.reportsManager.getCurrentFilters() : {};

        return {
            recordsCount: currentData.length,
            dateRange: dateRange,
            filtersCount: Object.keys(filters).length,
            totalValue: currentStats.value_net || 0,
            totalVolume: currentStats.total_m3 || 0
        };
    }

    /**
     * Podgląd danych przed eksportem
     */
    showExportPreview() {
        const info = this.getExportInfo();

        const message = `
Eksport będzie zawierał:
• Liczba rekordów: ${info.recordsCount}
• Zakres dat: ${this.getDateRangeLabel(info.dateRange)}
• Aktywne filtry: ${info.filtersCount}
• Łączna wartość: ${info.totalValue.toFixed(2)} zł netto
• Łączna objętość: ${info.totalVolume.toFixed(2)} m³

Czy chcesz kontynuować eksport?
        `.trim();

        return confirm(message);
    }

    /**
     * Etykiety dla zakresów dat
     */
    getDateRangeLabel(dateRange) {
        const labels = {
            'today': 'Dziś',
            'last_week': 'Ostatni tydzień',
            'last_month': 'Ostatni miesiąc',
            'last_3_months': 'Ostatnie 3 miesiące',
            'last_6_months': 'Ostatnie pół roku',
            'last_year': 'Ostatni rok',
            'all': 'Całość'
        };

        return labels[dateRange] || dateRange;
    }

    /**
     * Eksport z podglądem
     */
    async exportWithPreview() {
        if (!this.canExport()) {
            return;
        }

        if (this.showExportPreview()) {
            await this.exportToExcel();
        }
    }

    /**
     * Publiczne API
     */

    // Główny eksport (używany przez ReportsManager)
    async exportToExcelMain() {
        await this.exportToExcelWithValidation();
    }

    // Eksport z podglądem (można dodać jako opcję)
    async exportWithPreviewMain() {
        await this.exportWithPreview();
    }

    // Sprawdzenie stanu
    isExportInProgress() {
        return this.isExporting;
    }

    // Informacje o eksporcie
    getExportStatus() {
        return {
            isExporting: this.isExporting,
            canExport: this.canExport(),
            exportInfo: this.getExportInfo()
        };
    }
}

// Export dla global scope
window.ExportManager = ExportManager;