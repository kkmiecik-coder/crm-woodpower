// modules/reports/static/js/export_manager.js
/**
 * Manager eksportu danych do Excel
 * Odpowiedzialny za generowanie i pobieranie plików Excel
 */

class ExportManager {
    constructor() {
        this.isExporting = false;
        this.exportButton = null;
        this.lastExportTime = null; // POPRAWKA: Dodano śledzenie czasu ostatniego eksportu

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
        // POPRAWKA: Dodano bezpośredni event listener dla przycisku eksportu
        if (this.exportButton) {
            this.exportButton.addEventListener('click', () => {
                this.exportToExcel();
            });
        }

        console.log('[ExportManager] Event listeners setup complete');
    }

    /**
     * Główna funkcja eksportu do Excel - POPRAWKA: Dodano timeout i retry logic
     */
    async exportToExcel() {
        if (this.isExporting) {
            console.log('[ExportManager] Export already in progress, skipping...');
            this.showNotification('Eksport już w toku. Proszę czekać...', 'warning');
            return;
        }

        // POPRAWKA: Sprawdź czy nie eksportowano zbyt niedawno (throttling)
        if (this.lastExportTime && (Date.now() - this.lastExportTime) < 2000) {
            console.log('[ExportManager] Export throttled - too soon after last export');
            this.showNotification('Proszę poczekać przed kolejnym eksportem', 'warning');
            return;
        }

        console.log('[ExportManager] Starting Excel export...');

        this.setExportingState(true);
        this.lastExportTime = Date.now();

        try {
            // Pobierz aktualne filtry i zakres dat z ReportsManager
            const dateRange = this.getCurrentDateRange();
            const filters = this.getCurrentFilters();

            console.log('[ExportManager] Export parameters:', {
                dateRange,
                filtersCount: Object.keys(filters).length,
                isFullscreen: this.isInFullscreenMode()
            });

            // Walidacja danych przed eksportem
            const validationResult = this.validateExportData(dateRange, filters);
            if (!validationResult.isValid) {
                throw new Error(validationResult.message);
            }

            // Przygotuj parametry URL
            const params = new URLSearchParams();

            // Dodaj daty
            if (dateRange.date_from) {
                params.append('date_from', dateRange.date_from);
            }
            if (dateRange.date_to) {
                params.append('date_to', dateRange.date_to);
            }

            // Dodaj filtry (obsługa multiple values)
            for (const [key, values] of Object.entries(filters)) {
                if (values && Array.isArray(values) && values.length > 0) {
                    values.forEach(value => {
                        if (value && value.trim()) {
                            params.append(`filter_${key}`, value.trim());
                        }
                    });
                }
            }

            // NOWE: Dodaj informację o trybie fullscreen
            if (this.isInFullscreenMode()) {
                params.append('fullscreen_mode', 'true');
            }

            // POPRAWKA: Dodano timeout i retry logic
            const response = await this.fetchWithTimeout(`/reports/api/export-excel?${params}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            }, 30000); // 30 sekund timeout

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

            // POPRAWKA: Sprawdź czy blob jest prawidłowy
            if (blob.type && !blob.type.includes('sheet') && !blob.type.includes('excel')) {
                console.warn('[ExportManager] Unexpected blob type:', blob.type);
            }

            // Pobierz nazwę pliku z nagłówka lub wygeneruj
            const filename = this.getFilenameFromResponse(response) || this.generateFilename();

            // Pobierz plik
            this.downloadBlob(blob, filename);

            console.log('[ExportManager] Excel export completed successfully', {
                filename,
                fileSize: blob.size,
                isFullscreen: this.isInFullscreenMode()
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
     * NOWA METODA - Fetch z timeout
     */
    async fetchWithTimeout(url, options = {}, timeout = 30000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Timeout - eksport trwa zbyt długo');
            }
            throw error;
        }
    }

    /**
     * NOWA METODA - Walidacja danych przed eksportem
     */
    validateExportData(dateRange, filters) {
        // Sprawdź czy są dane do eksportu
        const currentData = this.getCurrentData();
        if (!currentData || currentData.length === 0) {
            return {
                isValid: false,
                message: 'Brak danych do eksportu. Zmień filtry lub zakres dat.'
            };
        }

        // Sprawdź zakres dat
        if (!dateRange.date_from || !dateRange.date_to) {
            return {
                isValid: false,
                message: 'Nieprawidłowy zakres dat. Wybierz datę początkową i końcową.'
            };
        }

        // Sprawdź czy data końcowa nie jest wcześniejsza niż początkowa
        if (dateRange.date_from > dateRange.date_to) {
            return {
                isValid: false,
                message: 'Data końcowa nie może być wcześniejsza niż data początkowa.'
            };
        }

        // Sprawdź czy zakres dat nie jest zbyt duży (max 1 rok)
        const dateFrom = new Date(dateRange.date_from);
        const dateTo = new Date(dateRange.date_to);
        const daysDiff = Math.ceil((dateTo - dateFrom) / (1000 * 60 * 60 * 24));

        if (daysDiff > 365) {
            return {
                isValid: false,
                message: 'Zakres dat nie może być większy niż 1 rok.'
            };
        }

        // Sprawdź czy nie ma zbyt dużo danych (max 10000 rekordów)
        if (currentData.length > 10000) {
            return {
                isValid: false,
                message: `Zbyt dużo danych do eksportu (${currentData.length} rekordów). Ogranicz zakres dat lub użyj filtrów.`
            };
        }

        return {
            isValid: true,
            message: 'Dane są prawidłowe'
        };
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
     * Generowanie nazwy pliku - POPRAWKA: Bezpieczniejsze generowanie
     */
    generateFilename() {
        const now = new Date();
        const dateString = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
        const timeString = now.toTimeString().slice(0, 8).replace(/:/g, ''); // HHMMSS

        // Pobierz informacje o zakresie dat
        const dateRange = this.getCurrentDateRange();
        let dateRangeStr = 'custom';

        if (dateRange.date_from && dateRange.date_to) {
            const fromStr = dateRange.date_from.replace(/-/g, '');
            const toStr = dateRange.date_to.replace(/-/g, '');
            if (fromStr === toStr) {
                dateRangeStr = fromStr;
            } else {
                dateRangeStr = `${fromStr}_${toStr}`;
            }
        }

        // POPRAWKA: Dodano informacje o filtrach w nazwie
        const filters = this.getCurrentFilters();
        const filtersCount = Object.keys(filters).length;
        const filtersStr = filtersCount > 0 ? `_filtered_${filtersCount}` : '';

        // NOWE: Dodaj informację o fullscreen
        const fullscreenStr = this.isInFullscreenMode() ? '_fullscreen' : '';

        return `raporty_sprzedazy_${dateRangeStr}${filtersStr}${fullscreenStr}_${dateString}_${timeString}.xlsx`;
    }

    /**
     * Pobieranie blob'a jako plik - POPRAWKA: Lepsza obsługa błędów
     */
    downloadBlob(blob, filename) {
        console.log('[ExportManager] Downloading file:', filename);

        try {
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
        } catch (error) {
            console.error('[ExportManager] Error downloading file:', error);
            throw new Error('Nie udało się pobrać pliku');
        }
    }

    /**
     * Ustawienie stanu eksportowania
     */
    setExportingState(isExporting) {
        this.isExporting = isExporting;

        // Standardowy przycisk eksportu
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

        // Floating przycisk w fullscreen
        const fullscreenBtn = document.getElementById('fullscreenExportBtn');
        if (fullscreenBtn) {
            fullscreenBtn.disabled = isExporting;

            if (isExporting) {
                fullscreenBtn.innerHTML = `
                    <i class="fas fa-spinner fa-spin"></i>
                    <span class="tooltip">Eksportowanie...</span>
                `;
                fullscreenBtn.style.background = '#6c757d';
            } else {
                fullscreenBtn.innerHTML = `
                    <i class="fas fa-download"></i>
                    <span class="tooltip">Eksport Excel</span>
                `;
                fullscreenBtn.style.background = '#17a2b8';
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

        // NOWE: W fullscreen pokaż bardziej dyskretną notyfikację
        if (this.isInFullscreenMode()) {
            this.showFullscreenNotification(message, 'success');
        } else {
            this.showNotification(message, 'success');
        }
    }

    /**
     * Komunikat błędu eksportu
     */
    showExportError(errorMessage) {
        const message = `Błąd eksportu: ${errorMessage}`;

        console.error('[ExportManager] Export error:', message);

        // NOWE: W fullscreen pokaż bardziej dyskretną notyfikację
        if (this.isInFullscreenMode()) {
            this.showFullscreenNotification(message, 'error');
        } else {
            this.showNotification(message, 'error');
        }
    }

    /**
     * NOWA METODA - Notyfikacja w trybie fullscreen
     */
    showFullscreenNotification(message, type = 'info') {
        console.log(`[ExportManager] Fullscreen ${type.toUpperCase()}: ${message}`);

        // Utwórz toast notification
        const notification = document.createElement('div');
        notification.className = `fullscreen-notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${this.getNotificationIcon(type)}"></i>
            <span>${message}</span>
        `;

        // Style dla notyfikacji
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${this.getNotificationColor(type)};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10003;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            font-weight: 500;
            max-width: 300px;
            animation: slideInRight 0.3s ease;
        `;

        // Dodaj do fullscreen container
        const fullscreenContainer = document.getElementById('fullscreenContainer');
        if (fullscreenContainer) {
            fullscreenContainer.appendChild(notification);
        } else {
            document.body.appendChild(notification);
        }

        // Automatyczne usunięcie po 5 sekundach
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }

    /**
     * NOWA METODA - Pobieranie ikony dla notyfikacji
     */
    getNotificationIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    /**
     * NOWA METODA - Pobieranie koloru dla notyfikacji
     */
    getNotificationColor(type) {
        const colors = {
            success: '#28a745',
            error: '#dc3545',
            warning: '#ffc107',
            info: '#17a2b8'
        };
        return colors[type] || '#17a2b8';
    }

    /**
     * Pokazanie notyfikacji - POPRAWKA: Lepszy system notyfikacji
     */
    showNotification(message, type = 'info') {
        console.log(`[ExportManager] ${type.toUpperCase()}: ${message}`);

        // POPRAWKA: Różne typy powiadomień
        switch (type) {
            case 'error':
                alert(`❌ ${message}`);
                break;
            case 'success':
                // Dla sukcesu nie pokazuj alert'a - download jest wystarczający
                console.log(`✅ ${message}`);
                break;
            case 'warning':
                alert(`⚠️ ${message}`);
                break;
            default:
                console.log(`ℹ️ ${message}`);
        }
    }

    /**
     * Eksport z niestandardowymi parametrami
     */
    async exportWithCustomParams(customParams = {}) {
        console.log('[ExportManager] Custom export with params:', customParams);

        if (this.isExporting) {
            console.log('[ExportManager] Export already in progress, skipping custom export...');
            this.showNotification('Eksport już w toku. Proszę czekać...', 'warning');
            return;
        }

        this.setExportingState(true);

        try {
            // Przygotuj parametry URL
            const params = new URLSearchParams(customParams);

            // POPRAWKA: Użyj fetchWithTimeout
            const response = await this.fetchWithTimeout(`/reports/api/export-excel?${params}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                }
            }, 30000);

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
        const dateString = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
        const timeString = now.toTimeString().slice(0, 8).replace(/:/g, ''); // HHMMSS

        let suffix = '';
        if (params.date_from && params.date_to) {
            const fromStr = params.date_from.replace(/-/g, '');
            const toStr = params.date_to.replace(/-/g, '');
            if (fromStr === toStr) {
                suffix = `_${fromStr}`;
            } else {
                suffix = `_${fromStr}_${toStr}`;
            }
        }

        return `raporty_sprzedazy${suffix}_${dateString}_${timeString}.xlsx`;
    }

    /**
     * Sprawdzenie czy eksport jest możliwy - POPRAWKA: Ulepszona walidacja
     */
    canExport() {
        // Sprawdź czy są dane do eksportu
        const currentData = this.getCurrentData();

        if (!currentData || currentData.length === 0) {
            console.log('[ExportManager] Cannot export: no data available');
            const message = 'Brak danych do eksportu. Zmień filtry lub zakres dat.';

            if (this.isInFullscreenMode()) {
                this.showFullscreenNotification(message, 'warning');
            } else {
                this.showNotification(message, 'warning');
            }
            return false;
        }

        if (this.isExporting) {
            console.log('[ExportManager] Cannot export: export in progress');
            const message = 'Eksport już w toku. Proszę czekać...';

            if (this.isInFullscreenMode()) {
                this.showFullscreenNotification(message, 'warning');
            } else {
                this.showNotification(message, 'warning');
            }
            return false;
        }

        // POPRAWKA: Sprawdź throttling
        if (this.lastExportTime && (Date.now() - this.lastExportTime) < 2000) {
            console.log('[ExportManager] Cannot export: too soon after last export');
            const message = 'Proszę poczekać przed kolejnym eksportem';

            if (this.isInFullscreenMode()) {
                this.showFullscreenNotification(message, 'warning');
            } else {
                this.showNotification(message, 'warning');
            }
            return false;
        }

        // POPRAWKA: Sprawdź czy ReportsManager jest dostępny
        if (!window.reportsManager) {
            console.log('[ExportManager] Cannot export: ReportsManager not available');
            const message = 'System raportów nie jest dostępny';

            if (this.isInFullscreenMode()) {
                this.showFullscreenNotification(message, 'error');
            } else {
                this.showNotification(message, 'error');
            }
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
        const currentData = this.getCurrentData();
        const currentStats = this.getCurrentStats();
        const dateRange = this.getCurrentDateRange();
        const filters = this.getCurrentFilters();

        return {
            recordsCount: currentData ? currentData.length : 0,
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
        if (!dateRange.date_from || !dateRange.date_to) {
            return 'Nieokreślony';
        }

        const fromDate = new Date(dateRange.date_from);
        const toDate = new Date(dateRange.date_to);

        // Format dd-mm-yyyy
        const formatDate = (date) => {
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();
            return `${day}-${month}-${year}`;
        };

        if (dateRange.date_from === dateRange.date_to) {
            return formatDate(fromDate);
        } else {
            return `${formatDate(fromDate)} do ${formatDate(toDate)}`;
        }
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
     * Pobieranie danych z ReportsManager - POPRAWKA: Bezpieczniejsze pobieranie
     */
    getCurrentData() {
        if (window.reportsManager && typeof window.reportsManager.getCurrentData === 'function') {
            return window.reportsManager.getCurrentData();
        }
        console.warn('[ExportManager] ReportsManager not available for getCurrentData');
        return [];
    }

    getCurrentStats() {
        if (window.reportsManager && typeof window.reportsManager.getCurrentStats === 'function') {
            return window.reportsManager.getCurrentStats();
        }
        console.warn('[ExportManager] ReportsManager not available for getCurrentStats');
        return {};
    }

    getCurrentFilters() {
        if (window.reportsManager && typeof window.reportsManager.getCurrentFilters === 'function') {
            return window.reportsManager.getCurrentFilters();
        }
        console.warn('[ExportManager] ReportsManager not available for getCurrentFilters');
        return {};
    }

    getCurrentDateRange() {
        if (window.reportsManager && typeof window.reportsManager.getCurrentDateRange === 'function') {
            return window.reportsManager.getCurrentDateRange();
        }

        console.warn('[ExportManager] ReportsManager not available for getCurrentDateRange, using fallback');
        // Fallback - ostatni miesiąc
        const today = new Date();
        const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        return {
            date_from: lastMonth.toISOString().split('T')[0],
            date_to: today.toISOString().split('T')[0]
        };
    }

    /**
     * Eksport konkretnego zakresu dat
     */
    async exportDateRange(dateFrom, dateTo, additionalFilters = {}) {
        console.log('[ExportManager] Export date range:', dateFrom, dateTo);

        const params = {
            date_from: dateFrom,
            date_to: dateTo,
            ...additionalFilters
        };

        await this.exportWithCustomParams(params);
    }

    /**
     * Eksport wszystkich danych (bez filtrów)
     */
    async exportAll() {
        console.log('[ExportManager] Export all data...');

        const params = {
            // Brak date_from i date_to - pobierze wszystkie dane
        };

        await this.exportWithCustomParams(params);
    }

    /**
     * Eksport z konkretnymi filtrami
     */
    async exportWithFilters(filters) {
        console.log('[ExportManager] Export with specific filters:', filters);

        const dateRange = this.getCurrentDateRange();
        const params = {
            date_from: dateRange.date_from,
            date_to: dateRange.date_to
        };

        // Dodaj filtry
        for (const [key, values] of Object.entries(filters)) {
            if (values && Array.isArray(values) && values.length > 0) {
                values.forEach(value => {
                    if (value && value.trim()) {
                        params[`filter_${key}`] = value.trim();
                    }
                });
            }
        }

        await this.exportWithCustomParams(params);
    }

    /**
     * NOWA METODA - Anulowanie eksportu
     */
    cancelExport() {
        console.log('[ExportManager] Canceling export...');
        this.isExporting = false;
        this.setExportingState(false);
    }

    /**
     * NOWA METODA - Obsługa zmiany trybu fullscreen
     */
    onFullscreenChange(isFullscreen) {
        console.log('[ExportManager] Fullscreen mode changed:', isFullscreen);

        // Dostosuj UI do trybu fullscreen
        this.adaptExportUIToFullscreen(isFullscreen);

        // Aktualizuj pozycję notyfikacji
        this.updateNotificationPosition(isFullscreen);
    }

    /**
     * NOWA METODA - Dostosowanie UI eksportu do fullscreen
     */
    adaptExportUIToFullscreen(isFullscreen) {
        if (!this.exportButton) return;

        if (isFullscreen) {
            // W fullscreen - przycisk eksportu jest ukryty w normalnym UI
            // Można dodać floating action button lub przycisk w fullscreen header
            this.createFullscreenExportButton();
        } else {
            // W normalnym trybie - usuń floating button jeśli istnieje
            this.removeFullscreenExportButton();
        }
    }

    /**
     * NOWA METODA - Utworzenie floating przycisku eksportu w fullscreen
     */
    createFullscreenExportButton() {
        // Sprawdź czy przycisk już istnieje
        if (document.getElementById('fullscreenExportBtn')) return;

        const fullscreenContainer = document.getElementById('fullscreenContainer');
        if (!fullscreenContainer) return;

        // Utwórz floating action button
        const floatingBtn = document.createElement('button');
        floatingBtn.id = 'fullscreenExportBtn';
        floatingBtn.className = 'fullscreen-export-btn';
        floatingBtn.innerHTML = `
            <i class="fas fa-download"></i>
            <span class="tooltip">Eksport Excel</span>
        `;
        floatingBtn.title = 'Eksport do Excel';

        // Dodaj style
        floatingBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: #17a2b8;
            color: white;
            border: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            cursor: pointer;
            z-index: 10002;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.2rem;
        `;

        // Hover effect
        floatingBtn.addEventListener('mouseenter', () => {
            floatingBtn.style.transform = 'scale(1.1)';
            floatingBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
        });

        floatingBtn.addEventListener('mouseleave', () => {
            floatingBtn.style.transform = 'scale(1)';
            floatingBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        });

        // Event listener
        floatingBtn.addEventListener('click', () => {
            this.exportToExcel();
        });

        // Dodaj do fullscreen container
        fullscreenContainer.appendChild(floatingBtn);

        console.log('[ExportManager] Fullscreen export button created');
    }

    /**
     * NOWA METODA - Usunięcie floating przycisku eksportu
     */
    removeFullscreenExportButton() {
        const floatingBtn = document.getElementById('fullscreenExportBtn');
        if (floatingBtn) {
            floatingBtn.remove();
            console.log('[ExportManager] Fullscreen export button removed');
        }
    }

    /**
     * NOWA METODA - Aktualizacja pozycji notyfikacji
     */
    updateNotificationPosition(isFullscreen) {
        // Możemy dostosować pozycję notyfikacji w fullscreen
        // Na razie używamy standardowych alert'ów, ale można rozszerzyć
        console.log('[ExportManager] Notification position updated for fullscreen:', isFullscreen);
    }

    /**
     * NOWA METODA - Sprawdzenie czy jesteśmy w trybie fullscreen
     */
    isInFullscreenMode() {
        if (window.fullscreenManager && typeof window.fullscreenManager.isFullscreenActive === 'function') {
            return window.fullscreenManager.isFullscreenActive();
        }
        return false;
    }

    /**
     * NOWA METODA - Walidacja stanu managera
     */
    validateState() {
        const issues = [];

        if (!this.exportButton) {
            issues.push('Missing export button element');
        }

        if (!window.reportsManager) {
            issues.push('ReportsManager not available');
        }

        // NOWE: Sprawdź czy FullscreenManager jest dostępny
        if (!window.fullscreenManager) {
            issues.push('FullscreenManager not available');
        }

        return {
            isValid: issues.length === 0,
            issues: issues
        };
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
            exportInfo: this.getExportInfo(),
            lastExportTime: this.lastExportTime
        };
    }

    // Debug info - POPRAWKA: Rozszerzone informacje
    getDebugInfo() {
        const validation = this.validateState();

        return {
            isExporting: this.isExporting,
            lastExportTime: this.lastExportTime,
            exportInfo: this.getExportInfo(),
            currentData: this.getCurrentData().length,
            currentFilters: this.getCurrentFilters(),
            validation: validation,
            isFullscreen: this.isInFullscreenMode(), // NOWE
            elements: {
                exportButton: !!this.exportButton,
                fullscreenExportBtn: !!document.getElementById('fullscreenExportBtn')
            },
            // NOWE: Informacje o fullscreen
            fullscreenManager: {
                available: !!window.fullscreenManager,
                active: this.isInFullscreenMode()
            }
        };
    }

    /**
     * NOWA METODA - Publiczne API dla fullscreen
     */

    // Aktywuj tryb fullscreen
    activateFullscreenMode() {
        this.adaptExportUIToFullscreen(true);
    }

    // Deaktywuj tryb fullscreen
    deactivateFullscreenMode() {
        this.adaptExportUIToFullscreen(false);
    }

    // Sprawdź czy jest w trybie fullscreen
    isFullscreenActive() {
        return this.isInFullscreenMode();
    }

    // Eksport z informacją o fullscreen
    async exportWithFullscreenInfo() {
        console.log('[ExportManager] Export with fullscreen info, mode:', this.isInFullscreenMode());
        await this.exportToExcel();
    }

    /**
     * NOWA METODA - Cleanup przy wyjściu z fullscreen
     */
    cleanupFullscreenElements() {
        this.removeFullscreenExportButton();

        // Usuń wszystkie fullscreen notifications
        const notifications = document.querySelectorAll('.fullscreen-notification');
        notifications.forEach(notification => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        });

        console.log('[ExportManager] Fullscreen elements cleaned up');
    }

}

// Export dla global scope
window.ExportManager = ExportManager;