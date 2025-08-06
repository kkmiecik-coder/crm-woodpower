// app/modules/reports/static/js/sync_manager.js
/**
 * KOMPLETNIE NOWY SyncManager - System synchronizacji z obsługą problemów wymiarów
 * Obsługuje dwuetapowy proces: wybór dni -> wybór zamówień -> opcjonalne uzupełnienie wymiarów -> zapis
 */

class SyncManager {
    constructor() {
        console.log('[SyncManager] 🚀 Inicjalizacja nowego SyncManager z obsługą wymiarów');
        
        // === ELEMENTY DOM - KROK 1 (wybór dni) ===
        this.daysModal = null;
        this.daysSelect = null;
        this.datePreview = null;
        this.dateFromPreview = null;
        this.dateToPreview = null;
        this.daysConfirmBtn = null;
        this.daysCancelBtn = null;
        this.daysCloseBtn = null;

        // === ELEMENTY DOM - KROK 2 (lista zamówień) ===
        this.ordersModal = null;
        this.ordersLoadingState = null;
        this.ordersListContainer = null;
        this.ordersList = null;
        this.ordersEmptyState = null;
        this.ordersErrorState = null;
        this.ordersCount = null;
        this.selectAllBtn = null;
        this.deselectAllBtn = null;
        this.ordersBackBtn = null;
        this.ordersCancelBtn = null;
        this.ordersSaveBtn = null;
        this.ordersCloseBtn = null;

        // === ELEMENTY DOM - Loading overlay ===
        this.globalLoading = null;
        this.globalLoadingTitle = null;
        this.globalLoadingText = null;

        // === Template ===
        this.orderTemplate = null;

        // === STAN APLIKACJI ===
        this.selectedDays = null;
        this.dateFrom = null;
        this.dateTo = null;
        this.fetchedOrders = [];
        this.selectedOrderIds = new Set();
        this.isProcessing = false;

        // === NOWE ELEMENTY DOM - KROK 3 (modal wymiarów) ===
        this.dimensionsModal = null;
        this.dimensionsList = null;
        this.dimensionsBackBtn = null;
        this.dimensionsSkipBtn = null;
        this.dimensionsSaveBtn = null;
        this.dimensionsCloseBtn = null;
        
        // === NOWE TEMPLATES ===
        this.dimensionOrderTemplate = null;
        this.dimensionProductTemplate = null;
        
        // === NOWY STAN ===
        this.ordersWithDimensionIssues = new Map();
        this.dimensionFixes = {};  // {order_id: {product_id: {length_cm: X, width_cm: Y, thickness_mm: Z}}}

        this.statusMap = {
            105112: 'Nowe - nieopłacone',
            155824: 'Nowe - opłacone',
            138619: 'W produkcji - surowe',
            148832: 'W produkcji - olejowanie',
            148831: 'W produkcji - bejcowanie',
            148830: 'W produkcji - lakierowanie',
            138620: 'Produkcja zakończona',
            138623: 'Zamówienie spakowane',
            105113: 'Paczka zgłoszona do wysyłki',
            105114: 'Wysłane - kurier',
            149763: 'Wysłane - transport WoodPower',
            149777: 'Czeka na odbiór osobisty',
            138624: 'Dostarczona - kurier',
            149778: 'Dostarczona - transport WoodPower',
            149779: 'Odebrane',
            138625: 'Zamówienie anulowane'
        };

        // NOWE właściwości dla obsługi objętości
        this.productsNeedingVolume = [];
        this.volumeModal = null;

        console.log('[SyncManager] ✅ Konstruktor zakończony');
    }

    // =====================================================
    // INICJALIZACJA
    // =====================================================

    init() {
        console.log('[SyncManager] 🔧 Rozpoczęcie inicjalizacji...');

        try {
            this.cacheElements();
            this.setupEventListeners();
            console.log('[SyncManager] ✅ Inicjalizacja zakończona pomyślnie');
        } catch (error) {
            console.error('[SyncManager] ❌ Błąd podczas inicjalizacji:', error);
        }

        this.bindEvents();

        // NOWA inicjalizacja: sprawdź dostępność VolumeManager
        this.initVolumeSupport();

    }

    initVolumeSupport() {
        // Poczekaj na załadowanie VolumeManager
        const checkVolumeManager = () => {
            if (window.volumeManager) {
                console.log('[SyncManager] VolumeManager dostępny');
                this.volumeManager = window.volumeManager;
            } else {
                setTimeout(checkVolumeManager, 100);
            }
        };
        checkVolumeManager();
    }

    cacheElements() {
        console.log('[SyncManager] 📋 Cachowanie elementów DOM...');

        // KROK 1 - Modal wyboru dni
        this.daysModal = document.getElementById('syncDaysModal');
        this.daysSelect = document.getElementById('daysSelect');
        this.datePreview = document.getElementById('datePreview');
        this.dateFromPreview = document.getElementById('dateFromPreview');
        this.dateToPreview = document.getElementById('dateToPreview');
        this.daysConfirmBtn = document.getElementById('syncDaysConfirm');
        this.daysCancelBtn = document.getElementById('syncDaysCancel');
        this.daysCloseBtn = document.getElementById('syncDaysModalClose');

        // DEBUG: Sprawdź które elementy nie zostały znalezione
        const step1Elements = {
            'daysModal': this.daysModal,
            'daysSelect': this.daysSelect,
            'datePreview': this.datePreview,
            'dateFromPreview': this.dateFromPreview,
            'dateToPreview': this.dateToPreview,
            'daysConfirmBtn': this.daysConfirmBtn,
            'daysCancelBtn': this.daysCancelBtn,
            'daysCloseBtn': this.daysCloseBtn
        };

        const missingStep1 = Object.entries(step1Elements)
            .filter(([name, element]) => !element)
            .map(([name]) => name);

        if (missingStep1.length > 0) {
            console.error('[SyncManager] ❌ BRAKUJĄCE ELEMENTY KROK 1:', missingStep1);
            console.log('[SyncManager] 🔍 Wszystkie elementy z id="sync*":',
                Array.from(document.querySelectorAll('[id*="sync"]')).map(el => el.id));
        }

        // KROK 2 - Modal zamówień (reszta kodu bez zmian)
        this.ordersModal = document.getElementById('syncOrdersModal');
        this.ordersLoadingState = document.getElementById('ordersLoadingState');
        this.ordersListContainer = document.getElementById('ordersListContainer');
        this.ordersList = document.getElementById('ordersList');
        this.ordersEmptyState = document.getElementById('ordersEmptyState');
        this.ordersErrorState = document.getElementById('ordersErrorState');
        this.ordersCount = document.getElementById('ordersCount');
        this.selectAllBtn = document.getElementById('selectAllOrders');
        this.deselectAllBtn = document.getElementById('deselectAllOrders');
        this.ordersBackBtn = document.getElementById('ordersBack');
        this.ordersCancelBtn = document.getElementById('ordersCancel');
        this.ordersSaveBtn = document.getElementById('ordersSave');
        this.ordersCloseBtn = document.getElementById('syncOrdersModalClose');

        // DEBUG: Sprawdź elementy KROK 2
        const step2Elements = {
            'ordersModal': this.ordersModal,
            'ordersLoadingState': this.ordersLoadingState,
            'ordersListContainer': this.ordersListContainer,
            'ordersList': this.ordersList,
            'ordersCount': this.ordersCount,
            'selectAllBtn': this.selectAllBtn,
            'deselectAllBtn': this.deselectAllBtn,
            'ordersBackBtn': this.ordersBackBtn,
            'ordersCancelBtn': this.ordersCancelBtn,
            'ordersSaveBtn': this.ordersSaveBtn,
            'ordersCloseBtn': this.ordersCloseBtn
        };

        const missingStep2 = Object.entries(step2Elements)
            .filter(([name, element]) => !element)
            .map(([name]) => name);

        if (missingStep2.length > 0) {
            console.error('[SyncManager] ❌ BRAKUJĄCE ELEMENTY KROK 2:', missingStep2);
        }

        // Reszta elementów...
        this.globalLoading = document.getElementById('syncLoadingOverlay');
        this.globalLoadingTitle = document.getElementById('syncLoadingTitle');
        this.globalLoadingText = document.getElementById('syncLoadingText');

        this.orderTemplate = document.getElementById('modalBlSyncOrderTemplate');
        if (!this.orderTemplate) {
            console.error('[SyncManager] ❌ Brak template modalBlSyncOrderTemplate');
            throw new Error('Brakujący template: modalBlSyncOrderTemplate');
        }
        console.log('[SyncManager] ✅ Template modalBlSyncOrderTemplate znaleziony');

        // Walidacja podstawowych elementów
        const requiredElements = [
            'daysModal', 'daysSelect', 'daysConfirmBtn',
            'ordersModal', 'ordersLoadingState', 'ordersListContainer', 'ordersList',
            'ordersCount', 'selectAllBtn', 'deselectAllBtn', 'ordersSaveBtn',
            'globalLoading'
        ];

        const missingElements = requiredElements.filter(element => !this[element]);
        if (missingElements.length > 0) {
            console.error('[SyncManager] ❌ BRAKUJĄCE WYMAGANE ELEMENTY DOM:', missingElements);

            // Dodatkowy debug - sprawdź cały DOM
            console.log('[SyncManager] 🔍 PEŁNY DEBUG DOM:');
            requiredElements.forEach(elementName => {
                const element = this[elementName];
                console.log(`  ${elementName}: ${element ? '✅ znaleziony' : '❌ BRAK'}`);
            });

            throw new Error(`Brakujące elementy DOM: ${missingElements.join(', ')}`);
        }

        console.log('[SyncManager] ✅ Wszystkie elementy DOM zacachowane');
    }

    bindEvents() {
        // Ta metoda może być pusta na razie lub zawierać podstawowe event listenery
        console.log('[SyncManager] 🔗 bindEvents - metoda dodana, ale podstawowa, bez kodu');
    }

    setupEventListeners() {
        console.log('[SyncManager] 🔗 Ustawianie event listenerów...');

        // === KROK 1: Wybór dni ===
        this.daysSelect.addEventListener('change', (e) => {
            console.log('[SyncManager] 📅 Zmiana wyboru dni:', e.target.value);
            this.handleDaysChange(e.target.value);
        });

        this.daysConfirmBtn.addEventListener('click', () => {
            console.log('[SyncManager] ✅ Potwierdzenie wyboru dni');
            this.handleDaysConfirm();
        });

        this.daysCancelBtn.addEventListener('click', () => {
            console.log('[SyncManager] ❌ Anulowanie wyboru dni');
            this.hideDaysModal();
        });

        this.daysCloseBtn.addEventListener('click', () => {
            console.log('[SyncManager] ❌ Zamykanie modala dni (X)');
            this.hideDaysModal();
        });

        // === KROK 2: Lista zamówień ===
        this.ordersBackBtn.addEventListener('click', () => {
            console.log('[SyncManager] ⬅️ Powrót do wyboru dni');
            this.hideOrdersModal();
            this.showDaysModal();
        });

        this.ordersCancelBtn.addEventListener('click', () => {
            console.log('[SyncManager] ❌ Anulowanie wyboru zamówień');
            this.hideOrdersModal();
        });

        this.ordersCloseBtn.addEventListener('click', () => {
            console.log('[SyncManager] ❌ Zamykanie modala zamówień (X)');
            this.hideOrdersModal();
        });

        // === PROGRESSIVE LOADING EVENT LISTENERS ===
        // Przycisk "Zaznacz wszystkie"
        if (this.selectAllBtn) {
            this.selectAllBtn.addEventListener('click', () => {
                this.selectAllOrders();
            });
        }

        // Przycisk "Odznacz wszystkie"  
        if (this.deselectAllBtn) {
            this.deselectAllBtn.addEventListener('click', () => {
                this.deselectAllOrders();
            });
        }

        // Przycisk zapisz zamówienia - będzie kierować do wymiarów lub zapisywać
        if (this.ordersSaveBtn) {
            this.ordersSaveBtn.addEventListener('click', async () => {
                await this.handleOrdersSave();
            });
        }

        // === KROK 3: Modal wymiarów (jeśli istnieje) ===
        if (this.dimensionsBackBtn) {
            this.dimensionsBackBtn.addEventListener('click', () => this.handleDimensionsBack());
        }

        if (this.dimensionsSkipBtn) {
            this.dimensionsSkipBtn.addEventListener('click', () => this.handleDimensionsSkip());
        }

        if (this.dimensionsSaveBtn) {
            this.dimensionsSaveBtn.addEventListener('click', () => this.handleDimensionsSave());
        }

        if (this.dimensionsCloseBtn) {
            this.dimensionsCloseBtn.addEventListener('click', () => this.hideDimensionsModal());
        }

        // === Globalne event listenery ===
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.ordersModal && this.ordersModal.classList.contains('show')) {
                    console.log('[SyncManager] ⌨️ Escape - zamykanie modala zamówień');
                    this.hideOrdersModal();
                } else if (this.daysModal && this.daysModal.classList.contains('show')) {
                    console.log('[SyncManager] ⌨️ Escape - zamykanie modala dni');
                    this.hideDaysModal();
                }
            }
        });

        // Zamykanie przez kliknięcie w overlay
        this.daysModal.addEventListener('click', (e) => {
            if (e.target === this.daysModal || e.target.classList.contains('sync-modal-overlay')) {
                console.log('[SyncManager] 🖱️ Kliknięcie w overlay - zamykanie modala dni');
                this.hideDaysModal();
            }
        });

        this.ordersModal.addEventListener('click', (e) => {
            if (e.target === this.ordersModal || e.target.classList.contains('sync-modal-overlay')) {
                console.log('[SyncManager] 🖱️ Kliknięcie w overlay - zamykanie modala zamówień');
                this.hideOrdersModal();
            }
        });

        // Zamykanie przez kliknięcie w overlay - modal wymiarów
        if (this.dimensionsModal) {
            this.dimensionsModal.addEventListener('click', (e) => {
                if (e.target === this.dimensionsModal || e.target.classList.contains('sync-modal-overlay')) {
                    console.log('[SyncManager] 🖱️ Kliknięcie w overlay - zamykanie modala wymiarów');
                    this.hideDimensionsModal();
                }
            });
        }

        console.log('[SyncManager] ✅ Event listenery ustawione');
    }

    // =====================================================
    // PUBLICZNE API
    // =====================================================

    showSyncModal() {
        console.log('[SyncManager] 🎯 Rozpoczęcie procesu synchronizacji');
        
        if (this.isProcessing) {
            console.warn('[SyncManager] ⚠️ Proces już trwa - ignorowanie');
            return;
        }

        this.resetState();
        this.showDaysModal();
    }

    // =====================================================
    // KROK 1: WYBÓR ILOŚCI DNI
    // =====================================================

    showDaysModal() {
        console.log('[SyncManager] 📅 Pokazywanie modala wyboru dni');

        // WALIDACJA: Sprawdź czy element istnieje
        if (!this.daysModal) {
            console.error('[SyncManager] ❌ Element daysModal nie istnieje! Sprawdzam DOM...');

            // Spróbuj ponownie znaleźć element
            this.daysModal = document.getElementById('syncDaysModal');

            if (!this.daysModal) {
                console.error('[SyncManager] ❌ syncDaysModal nadal nie istnieje w DOM');
                console.log('[SyncManager] 🔍 Dostępne elementy:',
                    Array.from(document.querySelectorAll('[id*="sync"]')).map(el => el.id));
                alert('Błąd: Modal synchronizacji nie został znaleziony. Odśwież stronę.');
                return;
            }

            console.log('[SyncManager] ✅ Element daysModal znaleziony ponownie');
        }

        // POPRAWKA: Usuń konfliktujące klasy i ustaw wszystkie style na raz
        this.daysModal.className = 'sync-modal'; // Reset klas

        // Wymusz wszystkie style inline z najwyższym priorytetem
        this.daysModal.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 9999 !important;
        opacity: 0 !important;
        visibility: visible !important;
        transition: opacity 0.3s ease !important;
    `;

        const modalContent = this.daysModal.querySelector('.sync-modal-content');
        if (modalContent) {
            modalContent.style.position = 'relative';
            modalContent.style.margin = 'auto';
        }

        // Dodaj klasę show i animuj opacity
        setTimeout(() => {
            this.daysModal.classList.add('show');
            this.daysModal.style.opacity = '1';
        }, 10);
    }

    hideDaysModal() {
        console.log('[SyncManager] 📅 Ukrywanie modala wyboru dni');

        // Animuj opacity przed ukryciem
        this.daysModal.style.opacity = '0';
        this.daysModal.classList.remove('show');

        setTimeout(() => {
            this.daysModal.style.display = 'none';
        }, 300);
    }

    handleDaysChange(selectedDays) {
        console.log('[SyncManager] 📊 Przetwarzanie zmiany dni:', selectedDays);

        if (!selectedDays || selectedDays === '') {
            console.log('[SyncManager] ❌ Brak wyboru - ukrywanie preview');
            this.hideDatePreview();
            this.daysConfirmBtn.disabled = true;
            return;
        }

        this.selectedDays = parseInt(selectedDays);
        this.calculateDateRange();
        this.showDatePreview();
        this.daysConfirmBtn.disabled = false;

        console.log('[SyncManager] ✅ Wybór dni zaktualizowany:', {
            selectedDays: this.selectedDays,
            dateFrom: this.dateFrom,
            dateTo: this.dateTo
        });
    }

    calculateDateRange() {
        const today = new Date();
        this.dateTo = this.formatDate(today);
        
        const fromDate = new Date(today);
        fromDate.setDate(today.getDate() - this.selectedDays + 1);
        this.dateFrom = this.formatDate(fromDate);

        console.log('[SyncManager] 📊 Obliczony zakres dat:', {
            from: this.dateFrom,
            to: this.dateTo,
            days: this.selectedDays
        });
    }

    showDatePreview() {
        if (this.dateFromPreview && this.dateToPreview && this.datePreview) {
            this.dateFromPreview.textContent = this.dateFrom;
            this.dateToPreview.textContent = this.dateTo;
            this.datePreview.style.display = 'block';
            
            console.log('[SyncManager] 👁️ Preview dat wyświetlony');
        }
    }

    hideDatePreview() {
        if (this.datePreview) {
            this.datePreview.style.display = 'none';
            console.log('[SyncManager] 👁️ Preview dat ukryty');
        }
    }

    async handleDaysConfirm() {
        console.log('[SyncManager] ✅ Potwierdzenie wyboru dni - przechodzę do pobierania zamówień');

        if (!this.selectedDays || !this.dateFrom || !this.dateTo) {
            console.error('[SyncManager] ❌ Brak wymaganych danych do pobrania zamówień');
            this.showError('Błąd: Nie wybrano prawidłowego zakresu dat');
            return;
        }

        this.hideDaysModal();
        this.showOrdersModal();
        await this.fetchOrders();
    }

    // =====================================================
    // KROK 2: LISTA ZAMÓWIEŃ
    // =====================================================

    showOrdersModal() {
        console.log('[SyncManager] 📦 Pokazywanie nowego modala zamówień');

        const modal = document.getElementById('syncOrdersModal');
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(() => {
                modal.classList.add('show');
            }, 10);

            // Aktualizuj zakres dat w headerze
            this.updateModalDateRange();
        }
    }

    hideOrdersModal() {
        console.log('[SyncManager] 📦 Ukrywanie nowego modala zamówień');

        const modal = document.getElementById('syncOrdersModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);
        }
    }

    updateModalDateRange() {
        const dateRangeElement = document.getElementById('modalBlSyncDateRange');
        if (dateRangeElement && this.dateFrom && this.dateTo) {
            // Konwertuj format daty z YYYY-MM-DD na DD.MM.YYYY
            const formatDisplayDate = (dateStr) => {
                const date = new Date(dateStr);
                return date.toLocaleDateString('pl-PL');
            };

            const fromFormatted = formatDisplayDate(this.dateFrom);
            const toFormatted = formatDisplayDate(this.dateTo);

            dateRangeElement.textContent = `${fromFormatted} - ${toFormatted}`;
        }
    }

    showOrdersLoading() {
        console.log('[SyncManager] ⏳ Pokazywanie loading state (nowy styl)');

        const loadingState = document.getElementById('ordersLoadingState');
        const listContainer = document.getElementById('ordersListContainer');
        const emptyState = document.getElementById('ordersEmptyState');
        const errorState = document.getElementById('ordersErrorState');

        if (loadingState) loadingState.style.display = 'block';
        if (listContainer) listContainer.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
        if (errorState) errorState.style.display = 'none';
    }

    showOrdersList() {
        console.log('[SyncManager] 📋 Pokazywanie listy zamówień (nowy styl)');

        const loadingState = document.getElementById('ordersLoadingState');
        const listContainer = document.getElementById('ordersListContainer');
        const emptyState = document.getElementById('ordersEmptyState');
        const errorState = document.getElementById('ordersErrorState');

        if (loadingState) loadingState.style.display = 'none';
        if (listContainer) listContainer.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';
        if (errorState) errorState.style.display = 'none';
    }

    showOrdersEmptyState() {
        console.log('[SyncManager] 📭 Pokazywanie pustego stanu');

        this.ordersLoadingState.style.display = 'none';
        this.ordersListContainer.style.display = 'none';
        this.ordersEmptyState.style.display = 'block';
        this.ordersErrorState.style.display = 'none';
    }

    showOrdersError(errorMessage) {
        console.log('[SyncManager] ❌ Pokazywanie błędu:', errorMessage);

        this.ordersLoadingState.style.display = 'none';
        this.ordersListContainer.style.display = 'none';
        this.ordersEmptyState.style.display = 'none';
        this.ordersErrorState.style.display = 'block';

        // Aktualizuj tekst błędu jeśli element istnieje
        const errorText = this.ordersErrorState.querySelector('.error-message');
        if (errorText) {
            errorText.textContent = errorMessage;
        }
    }

    async fetchOrders() {
        console.log('[SyncManager] 📡 Pobieranie zamówień z progressive loading');

        try {
            // KROK 1: Łączenie z Baselinker
            this.showProgressiveLoading('Łączenie z Baselinker...', 1);

            // POPRAWKA: Używaj tej samej struktury danych co w działającej wersji
            const requestData = {
                date_from: this.dateFrom,
                date_to: this.dateTo,
                days_count: this.selectedDays,           // DODANE - brakował ten parametr!
                get_all_statuses: false                  // DODANE - wykluczamy anulowane i nieopłacone
            };

            console.log('[SyncManager] 📤 Wysyłanie zapytania z analizą objętości:', requestData);

            // Rzeczywiste połączenie z API
            const response = await fetch('/reports/api/fetch-orders-for-selection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });

            // KROK 2: Pobieranie zamówień
            this.updateProgressiveLoading('Pobieranie zamówień...', 2);

            console.log('[SyncManager] 📥 Odpowiedź z serwera - status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[SyncManager] 📊 Dane z serwera (z analizą objętości):', result);

            if (result.success) {
                // KROK 3: Analizowanie produktów
                this.updateProgressiveLoading('Analizowanie produktów...', 3);

                this.fetchedOrders = result.orders || [];
                console.log('[SyncManager] ✅ Pobrano zamówienia z analizą objętości:', this.fetchedOrders.length);

                // Symuluj czas analizowania (żeby użytkownik widział krok 3)
                await new Promise(resolve => setTimeout(resolve, 500));

                // KROK 4: Przygotowywanie listy
                this.updateProgressiveLoading('Przygotowywanie listy...', 4);

                // ZACHOWANA LOGIKA: Sprawdź problemy z objętością i wymiarami
                const ordersWithVolumeIssues = this.fetchedOrders.filter(order => order.has_volume_issues);
                console.log('[SyncManager] ⚠️ Zamówienia z problemami objętości:', ordersWithVolumeIssues.length);

                const ordersWithDimensionIssues = this.fetchedOrders.filter(order => order.has_dimension_issues);
                console.log('[SyncManager] ⚠️ Zamówienia z problemami wymiarów:', ordersWithDimensionIssues.length);

                // Analiza problemów z wymiarami (dla kompatybilności z progressive loading)
                this.analyzeOrdersForDimensionIssues();

                // Krótka pauza przed pokazaniem rezultatu
                await new Promise(resolve => setTimeout(resolve, 300));

                // Ukryj progressive loading
                this.hideProgressiveLoading();

                // Pokaż rezultat - ZACHOWANA LOGIKA z działającej wersji
                if (this.fetchedOrders.length === 0) {
                    this.showOrdersEmptyState();
                } else {
                    this.showOrdersListSuccess();

                    // ZACHOWANE: Pokaż informację o problemach z objętością
                    if (result.volume_issues_count > 0) {
                        this.showVolumeIssuesInfo(result.volume_issues_count);
                    }
                }

                // Obsługa paginacji jeśli istnieje
                if (result.pagination_info) {
                    console.log('[SyncManager] 📄 Info o paginacji:', result.pagination_info);
                }

            } else {
                // API zwróciło błąd
                this.hideProgressiveLoading();
                this.showOrdersError(result.error || result.message || 'Nieznany błąd API');
            }

        } catch (error) {
            console.error('[SyncManager] ❌ Błąd pobierania zamówień:', error);
            this.hideProgressiveLoading();
            this.showOrdersError(`Błąd połączenia: ${error.message}`);
        }
    }

    showOrdersListSuccess() {
        console.log('[SyncManager] ✅ Pokazywanie listy zamówień');

        // Ukryj loading, pokaż listę
        this.ordersLoadingState.style.display = 'none';
        this.ordersListContainer.style.display = 'flex';
        this.ordersEmptyState.style.display = 'none';
        this.ordersErrorState.style.display = 'none';

        // Aktualizuj licznik
        this.updateOrdersCount();

        // Renderuj zamówienia
        this.renderOrdersList();
    }

    // NOWA METODA: Analiza problemów z wymiarami
    analyzeOrdersForDimensionIssues() {
        console.log('[SyncManager] 🔍 Analizowanie problemów z wymiarami');

        this.ordersWithDimensionIssues.clear();

        this.fetchedOrders.forEach(order => {
            let hasIssues = false;
            const issueDetails = [];

            if (order.products) {
                order.products.forEach(product => {
                    // Sprawdź czy brakuje wymiarów
                    if (!product.length_cm || !product.width_cm || !product.thickness_mm) {
                        hasIssues = true;
                        issueDetails.push({
                            product_id: product.id || product.product_id,
                            product_name: product.name,
                            missing_dimensions: {
                                length: !product.length_cm,
                                width: !product.width_cm,
                                thickness: !product.thickness_mm
                            }
                        });
                    }

                    // Sprawdź czy wymiary są zerowe lub ujemne
                    if (product.length_cm <= 0 || product.width_cm <= 0 || product.thickness_mm <= 0) {
                        hasIssues = true;
                        if (!issueDetails.find(issue => issue.product_id === (product.id || product.product_id))) {
                            issueDetails.push({
                                product_id: product.id || product.product_id,
                                product_name: product.name,
                                invalid_dimensions: true
                            });
                        }
                    }
                });
            }

            if (hasIssues) {
                // POPRAWKA: Używaj order.order_id (z danych API) zamiast order.id
                const orderId = order.order_id || order.id;
                this.ordersWithDimensionIssues.set(orderId, {
                    order: order,
                    issues: issueDetails
                });

                // POPRAWKA: Używaj order.order_id dla logów
                console.log(`[SyncManager] ⚠️ Zamówienie ${order.order_id} ma problemy z wymiarami:`, issueDetails);
            }
        });

        console.log(`[SyncManager] 📊 Znaleziono ${this.ordersWithDimensionIssues.size} zamówień z problemami wymiarów`);
    }

    // NOWA metoda: pokazuje informację o problemach z objętością
    showVolumeIssuesInfo(count) {
        const container = document.getElementById('ordersListContainer');
        if (!container) return;

        // Usuń poprzednie powiadomienie jeśli istnieje
        const existingAlert = container.querySelector('.volume-issues-alert');
        if (existingAlert) {
            existingAlert.remove();
        }

        // Utwórz nowe powiadomienie
        const alert = document.createElement('div');
        alert.className = 'volume-issues-alert';
        alert.innerHTML = `
            <div class="alert alert-warning" style="margin-bottom: 20px;">
                <div class="alert-content">
                    <div class="alert-icon">⚠️</div>
                    <div class="alert-text">
                        <strong>Uwaga:</strong> ${count} produktów wymaga uzupełnienia objętości.
                        <br><small>Po wybraniu zamówień zostaniesz poproszony o wprowadzenie objętości dla produktów bez wymiarów.</small>
                    </div>
                </div>
            </div>
        `;

        // Wstaw na początku kontenera
        container.insertBefore(alert, container.firstChild);
    }

    // NOWA METODA: Renderowanie listy zamówień
    renderOrdersList() {
        console.log('[SyncManager] 🎨 Renderowanie listy zamówień');

        if (!this.ordersList || !this.orderTemplate) {
            console.error('[SyncManager] ❌ Brak ordersList lub orderTemplate');
            return;
        }

        // Wyczyść listę
        this.ordersList.innerHTML = '';

        this.fetchedOrders.forEach(order => {
            // POPRAWKA: Używaj createNewOrderElement zamiast createOrderElement
            const orderElement = this.createNewOrderElement(order);
            this.ordersList.appendChild(orderElement);
        });

        setTimeout(() => {
            this.selectAllOrders();
        }, 100);

        console.log(`[SyncManager] ✅ Wyrenderowano ${this.fetchedOrders.length} zamówień`);
    }

    createNewOrderElement(order) {
        console.log(`[SyncManager] 🏗️ Tworzenie nowego elementu zamówienia ${order.order_id}`);

        const template = document.getElementById('modalBlSyncOrderTemplate');
        if (!template) {
            console.error('[SyncManager] ❌ Brak template modalBlSyncOrderTemplate');
            return document.createElement('div');
        }

        const clone = template.content.cloneNode(true);
        const orderCard = clone.querySelector('.modal-bl-sync-order-card');

        if (!orderCard) {
            console.error('[SyncManager] ❌ Brak .modal-bl-sync-order-card w template');
            return clone;
        }

        // Ustaw ID zamówienia
        orderCard.setAttribute('data-order-id', order.order_id);

        // Ustaw checkbox
        const checkbox = clone.querySelector('.modal-bl-sync-checkbox');
        if (checkbox) {
            checkbox.setAttribute('data-order-id', order.order_id);
            checkbox.id = `order_${order.order_id}`;

            // Event listener dla nowego checkboxa
            checkbox.addEventListener('change', (e) => this.handleOrderSelection(e));
        }

        // Wypełnij dane zamówienia
        this.setNewOrderElementData(clone, order);

        // Wyłącz checkbox jeśli zamówienie już istnieje w bazie
        if (order.exists_in_database && checkbox) {
            checkbox.disabled = true;
            orderCard.classList.add('disabled');
        }

        console.log(`[SyncManager] ✅ Nowy element zamówienia ${order.order_id} utworzony`);
        return clone;
    }

    setNewOrderElementData(clone, order) {
        console.log(`[SyncManager] 🎨 Wypełnianie danych nowego zamówienia ${order.order_id}`);

        // Podstawowe elementy
        const orderNumber = clone.querySelector('.order-number');
        const customerName = clone.querySelector('.customer-name');
        const deliveryInfo = clone.querySelector('.delivery-info');
        const statusBadge = clone.querySelector('.order-status-badge');
        const statusBadgeContainer = clone.querySelector('.modal-bl-sync-status-badge');
        const baselinkerBtn = clone.querySelector('.baselinker-link');

        // Elementy kwot
        const paidAmount = clone.querySelector('.paid-amount');
        const remainingAmount = clone.querySelector('.remaining-amount');
        const productsAmount = clone.querySelector('.products-amount');
        const deliveryAmount = clone.querySelector('.delivery-amount');
        const totalAmount = clone.querySelector('.total-amount');

        // Daty zamówienia
        const dateAdd = clone.querySelector('.date-add');
        const dateConfirmed = clone.querySelector('.date-confirmed');
        const dateStatus = clone.querySelector('.date-status');

        // Ustaw podstawowe dane
        if (orderNumber) orderNumber.textContent = order.order_id || 'Brak ID';
        if (customerName) customerName.textContent = order.customer_name || order.delivery_fullname || 'Nieznany klient';

        // Informacje o dostawie  
        if (deliveryInfo) {
            const info = `${order.delivery_postcode || ''} ${order.delivery_city || ''}`.trim();
            deliveryInfo.textContent = info || 'Brak danych dostawy';
        }

        // Status zamówienia z kolorami
        if (statusBadge && statusBadgeContainer) {
            const statusId = order.order_status_id;
            const statusName = this.getStatusName(statusId);
            statusBadge.textContent = statusName;

            // Reset klas i dodaj odpowiednią
            statusBadgeContainer.className = 'modal-bl-sync-status-badge';
            if (statusId === 105112) {
                statusBadgeContainer.classList.add('status-new-unpaid');
            } else if (statusId === 155824) {
                statusBadgeContainer.classList.add('status-new-paid');
            } else if ([138619, 148832, 148831, 148830].includes(statusId)) {
                statusBadgeContainer.classList.add('status-in-production');
            } else if ([105113, 105114, 149763].includes(statusId)) {
                statusBadgeContainer.classList.add('status-shipped');
            } else if ([138624, 149778, 149779].includes(statusId)) {
                statusBadgeContainer.classList.add('status-delivered');
            } else if (statusId === 138625) {
                statusBadgeContainer.classList.add('status-cancelled');
            }
        }

        // Oblicz kwoty finansowe
        const financialData = this.calculateOrderAmounts(order);

        // Ustaw kwoty podsumowania
        if (productsAmount) productsAmount.textContent = financialData.productsAmount;
        if (deliveryAmount) deliveryAmount.textContent = financialData.deliveryAmount;
        if (totalAmount) totalAmount.textContent = financialData.totalAmount;

        // Ustaw kwoty płatności
        if (paidAmount) paidAmount.textContent = financialData.paidAmount;
        if (remainingAmount) {
            remainingAmount.textContent = financialData.remainingAmount;

            // Zmień kolor w zależności od kwoty
            if (financialData.remainingAmountNum > 0) {
                remainingAmount.classList.add('unpaid');
                // Dodaj też klasę do labela "Do zapłaty"
                const paymentLabel = remainingAmount.parentElement.querySelector('.modal-bl-sync-payment-label');
                if (paymentLabel && paymentLabel.textContent.includes('Do zapłaty')) {
                    paymentLabel.style.color = '#DC3545';
                }
            } else {
                remainingAmount.classList.remove('unpaid');
                remainingAmount.textContent = '0.00 PLN';
            }
        }

        // POPRAWKA: Link do Baselinker - prawidłowy schemat URL
        if (baselinkerBtn) {
            const correctUrl = `https://panel-f.baselinker.com/orders.php#order:${order.order_id}`;
            baselinkerBtn.href = correctUrl;
            baselinkerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(correctUrl, '_blank');
                console.log(`[SyncManager] 🔗 Otwieranie Baselinker: ${correctUrl}`);
            });
        }

        // Ustaw daty - NOWE
        if (dateAdd) {
            dateAdd.textContent = order.date_add ? this.formatDateTime(order.date_add) : 'Brak';
        }
        if (dateConfirmed) {
            dateConfirmed.textContent = order.date_confirmed ? this.formatDateTime(order.date_confirmed) : 'Brak';
        }
        if (dateStatus) {
            dateStatus.textContent = order.date_in_status ? this.formatDateTime(order.date_in_status) : 'Brak';
        }

        // Renderuj listę produktów w nowym stylu
        this.renderNewProductsList(clone, order);
    }

    renderNewProductsList(clone, order) {
        console.log(`[SyncManager] 📦 Renderowanie listy produktów (nowy styl) dla zamówienia ${order.order_id}`);

        const productsList = clone.querySelector('.modal-bl-sync-products-list');

        if (!order.products || !Array.isArray(order.products)) {
            console.log(`[SyncManager] ⚠️ Brak produktów dla zamówienia ${order.order_id}`);
            if (productsList) {
                productsList.innerHTML = '<div class="modal-bl-sync-product-item"><span class="modal-bl-sync-product-name">Brak danych o produktach</span></div>';
            }
            return;
        }

        // Wyczyść listę produktów
        if (productsList) {
            productsList.innerHTML = '';

            // Dodaj produkty do listy
            order.products.forEach((product) => {
                const productDiv = document.createElement('div');
                productDiv.className = 'modal-bl-sync-product-item';

                const productName = product.name || 'Nieznany produkt';
                const quantity = parseInt(product.quantity) || 1;
                const price = parseFloat(product.price_brutto) || 0;
                const totalPrice = price * quantity;

                const nameWithQuantity = `${productName} <span style="padding: 1px 5px; background-color: #EEEEEE; border-radius: 6px; font-size: 10px;">${quantity} szt.</span>`;

                productDiv.innerHTML = `
                <span class="modal-bl-sync-product-name">${nameWithQuantity}</span>
                <span class="modal-bl-sync-product-price">${totalPrice.toFixed(2)} PLN</span>
            `;

                productsList.appendChild(productDiv);
            });

            console.log(`[SyncManager] 📦 Wyrenderowano ${order.products.length} produktów dla zamówienia ${order.order_id}`);
        }
    }

    updateOrdersCount() {
        console.log('[SyncManager] 🔄 Aktualizacja licznika zamówień (nowy styl)');

        // Pobierz rzeczywisty stan checkboxów
        const actuallySelectedOrderIds = this.getActuallySelectedOrderIds();
        const selectedCount = actuallySelectedOrderIds.length;
        const totalCount = this.fetchedOrders.length;

        // Synchronizuj selectedOrderIds z rzeczywistym stanem
        this.selectedOrderIds.clear();
        actuallySelectedOrderIds.forEach(id => this.selectedOrderIds.add(id));

        console.log(`[SyncManager] 📊 Rzeczywisty stan: ${selectedCount}/${totalCount} zamówień zaznaczonych`);

        // Aktualizuj licznik znalezionych zamówień
        const counter = document.getElementById('ordersCount');
        if (counter) {
            counter.textContent = `Znaleziono ${totalCount} ${totalCount === 1 ? 'zamówienie' : totalCount < 5 ? 'zamówienia' : 'zamówień'}`;
        }

        // Aktualizuj przycisk zapisu z prawidłową liczbą
        const saveBtn = document.getElementById('ordersSave');
        if (saveBtn) {
            saveBtn.disabled = selectedCount === 0;
            saveBtn.textContent = `Wybierz zamówienia`;

            console.log(`[SyncManager] 💾 Przycisk zaktualizowany: "Zapisz zamówienia (${selectedCount})"`);
        }
    }

    // ZAKTUALIZOWANA metoda tworzenia elementu zamówienia z oznaczeniem problemów objętości
    createOrderElement(order) {
        console.log(`[SyncManager] 🏗️ FALLBACK - createOrderElement dla zamówienia ${order.order_id}`);

        // POPRAWKA: Przekieruj do createNewOrderElement
        return this.createNewOrderElement(order);
    }

    getStatusText(status) {
        const statusMap = {
            'new': 'Nowe',
            'confirmed': 'Potwierdzone',
            'in_production': 'W produkcji',
            'ready': 'Gotowe',
            'sent': 'Wysłane',
            'delivered': 'Dostarczone',
            'cancelled': 'Anulowane',
            'returned': 'Zwrócone'
        };

        return statusMap[status] || status;
    }

    async startFetchingOrders() {
        console.log('[SyncManager] 🚀 Rozpoczynanie pobierania zamówień');

        if (this.isProcessing) {
            console.log('[SyncManager] ⏳ Już w trakcie pobierania, pomijam');
            return;
        }

        this.isProcessing = true;

        try {
            // Ukryj modal dni, pokaż modal zamówień
            this.hideDaysModal();
            this.showOrdersModal();

            // Pokaż stan loading w modal zamówień
            this.showOrdersLoadingState();

            // Rozpocznij pobieranie z progressive loading
            await this.fetchOrders();

        } catch (error) {
            console.error('[SyncManager] ❌ Błąd w startFetchingOrders:', error);
            this.hideProgressiveLoading();
            this.showOrdersError(`Nieoczekiwany błąd: ${error.message}`);
        } finally {
            this.isProcessing = false;
        }
    }

    initProgressiveLoadingEventListeners() {
        console.log('[SyncManager] 🔗 Inicjalizacja event listenerów progressive loading');

        // Przycisk "Zaznacz wszystkie"
        if (this.selectAllBtn) {
            this.selectAllBtn.addEventListener('click', () => {
                this.selectAllOrders();
            });
        }

        // Przycisk "Odznacz wszystkie"  
        if (this.deselectAllBtn) {
            this.deselectAllBtn.addEventListener('click', () => {
                this.deselectAllOrders();
            });
        }

        // Przycisk zapisz zamówienia - będzie kierować do wymiarów lub zapisywać
        if (this.ordersSaveBtn) {
            this.ordersSaveBtn.addEventListener('click', async () => {
                await this.handleOrdersSave();
            });
        }
    }

    // NOWA METODA: Pokazywanie stanu loading w modal zamówień
    showOrdersLoadingState() {
        if (this.ordersLoadingState) {
            this.ordersLoadingState.style.display = 'block';
        }
        if (this.ordersListContainer) {
            this.ordersListContainer.style.display = 'none';
        }
        if (this.ordersEmptyState) {
            this.ordersEmptyState.style.display = 'none';
        }
        if (this.ordersErrorState) {
            this.ordersErrorState.style.display = 'none';
        }
    }

    handleOrderSelection(event) {
        const checkbox = event.target;
        const orderId = checkbox.getAttribute('data-order-id');
        const isSelected = checkbox.checked;

        console.log(`[SyncManager] 📋 Zmiana selekcji zamówienia ${orderId}: ${isSelected}`);

        if (isSelected) {
            this.selectedOrderIds.add(orderId);
            console.log(`[SyncManager] ✅ Zaznaczono zamówienie: ${orderId}`);
        } else {
            this.selectedOrderIds.delete(orderId);
            console.log(`[SyncManager] ❌ Odznaczono zamówienie: ${orderId}`);
        }

        // Aktualizuj UI
        this.updateOrdersCount();
        this.updateOrdersSaveButton();
    }

    updateOrdersSaveButton() {
        if (this.ordersSaveBtn) {
            const hasSelected = this.selectedOrderIds.size > 0;
            this.ordersSaveBtn.disabled = !hasSelected;

            if (hasSelected) {
                // POPRAWKA: Sprawdź problemy używając order.order_id (string)
                const hasProblems = Array.from(this.selectedOrderIds).some(id =>
                    this.ordersWithDimensionIssues.has(id) // id już jest stringiem
                );

                if (hasProblems) {
                    this.ordersSaveBtn.textContent = `Dalej (${this.selectedOrderIds.size}) - wymiary wymagane`;
                    this.ordersSaveBtn.classList.add('btn-warning');
                    this.ordersSaveBtn.classList.remove('btn-primary');
                } else {
                    this.ordersSaveBtn.textContent = `Zapisz zamówienia (${this.selectedOrderIds.size})`;
                    this.ordersSaveBtn.classList.add('btn-primary');
                    this.ordersSaveBtn.classList.remove('btn-warning');
                }
            } else {
                this.ordersSaveBtn.textContent = 'Wybierz zamówienia';
                this.ordersSaveBtn.classList.remove('btn-primary', 'btn-warning');
            }
        }
    }

    setOrderElementData(clone, order) {
        console.log(`[SyncManager] 🎨 Wypełnianie danych zamówienia ${order.order_id}`);

        // Podstawowe dane zamówienia
        const orderNumber = clone.querySelector('.order-number');
        const customerName = clone.querySelector('.customer-name');
        const orderDate = clone.querySelector('.order-date');
        const deliveryInfo = clone.querySelector('.delivery-info');

        // Elementy statusu i kwot
        const statusBadge = clone.querySelector('.order-status-badge');
        const productsAmount = clone.querySelector('.products-amount');
        const deliveryAmount = clone.querySelector('.delivery-amount');
        const totalAmount = clone.querySelector('.total-amount');
        const paidAmount = clone.querySelector('.paid-amount');
        const remainingAmount = clone.querySelector('.remaining-amount');
        const baselinkerLink = clone.querySelector('.baselinker-link');

        // Ustaw podstawowe dane
        if (orderNumber) orderNumber.textContent = order.order_id || 'Brak ID';
        if (customerName) customerName.textContent = order.customer_name || order.delivery_fullname || 'Nieznany klient';

        // Data - konwersja timestamp
        if (orderDate) {
            const date = order.date_add ?
                new Date(order.date_add * 1000).toLocaleDateString('pl-PL') : 'Brak daty';
            orderDate.textContent = date;
        }

        // Informacje o dostawie  
        if (deliveryInfo) {
            const info = `${order.delivery_postcode || ''} ${order.delivery_city || ''}`.trim();
            deliveryInfo.textContent = info || 'Brak danych dostawy';
        }

        // Status zamówienia
        if (statusBadge) {
            const statusId = order.order_status_id;
            const statusName = this.getStatusName(statusId);
            statusBadge.textContent = statusName;

            // Reset klas i dodaj odpowiednią
            statusBadge.className = 'order-status-badge';
            if (statusId === 105112) {
                statusBadge.classList.add('status-new-unpaid');
            } else if (statusId === 155824) {
                statusBadge.classList.add('status-new-paid');
            } else if ([138619, 148832, 148831, 148830].includes(statusId)) {
                statusBadge.classList.add('status-in-production');
            } else if ([105113, 105114, 149763].includes(statusId)) {
                statusBadge.classList.add('status-shipped');
            } else if ([138624, 149778, 149779].includes(statusId)) {
                statusBadge.classList.add('status-delivered');
            } else if (statusId === 138625) {
                statusBadge.classList.add('status-cancelled');
            }
        }

        // Kwoty finansowe
        const financialData = this.calculateOrderAmounts(order);
        if (productsAmount) productsAmount.textContent = financialData.productsAmount;
        if (deliveryAmount) deliveryAmount.textContent = financialData.deliveryAmount;
        if (totalAmount) totalAmount.textContent = financialData.totalAmount;
        if (paidAmount) paidAmount.textContent = financialData.paidAmount;
        if (remainingAmount) remainingAmount.textContent = financialData.remainingAmount;

        // POPRAWKA: Link do Baselinker - prawidłowy schemat URL
        if (baselinkerLink) {
            const correctUrl = `https://panel-f.baselinker.com/orders.php#order:${order.order_id}`;
            baselinkerLink.href = correctUrl;
            baselinkerLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(correctUrl, '_blank');
                console.log(`[SyncManager] 🔗 Otwieranie Baselinker: ${correctUrl}`);
            });
        }

        // Renderuj listę produktów
        this.renderProductsList(clone, order);

    }

    // NOWA metoda: dodaje oznaczenie problemów z objętością
    addVolumeIssueBadge(orderItem, order) {
        const badge = orderItem.querySelector('.volume-issue-badge');
        if (badge) {
            const volumeProductsCount = order.products?.filter(p => p.needs_manual_volume)?.length || 0;
            badge.textContent = `📏 Brak objętości (${volumeProductsCount})`;
            badge.style.display = 'block';
            badge.title = `${volumeProductsCount} produktów wymaga uzupełnienia objętości`;
        }
    }

    // NOWA metoda: dodaje oznaczenie istniejącego zamówienia
    addExistsBadge(orderItem) {
        const existsBadge = orderItem.querySelector('.exists-badge');
        if (existsBadge) {
            existsBadge.style.display = 'block';
        }
    }

    // NOWA metoda: pokazuje stan postępu zapisu
    showSaveProgress(message = 'Zapisywanie...') {
        const saveBtn = document.getElementById('ordersSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${message}`;
        }

        // Pokaż overlay ładowania jeśli istnieje
        const loadingOverlay = document.getElementById('syncLoadingOverlay');
        if (loadingOverlay) {
            const title = document.getElementById('syncLoadingTitle');
            const text = document.getElementById('syncLoadingText');

            if (title) title.textContent = message;
            if (text) text.textContent = 'Proszę czekać...';

            loadingOverlay.style.display = 'flex';
        }
    }

    // NOWA metoda: ukrywa stan postępu zapisu
    hideSaveProgress() {
        const saveBtn = document.getElementById('ordersSave');
        if (saveBtn) {
            saveBtn.disabled = this.selectedOrderIds.size === 0;
            this.updateOrdersCounter(); // Przywróć oryginalny tekst
        }

        // Ukryj overlay ładowania
        const loadingOverlay = document.getElementById('syncLoadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }

    // NOWA metoda: pokazuje komunikat sukcesu
    showSuccessMessage(result) {
        const message = result.message || 'Zamówienia zostały pomyślnie zapisane';

        // Użyj toast jeśli dostępny, w przeciwnym razie alert
        if (window.showToast) {
            window.showToast(message, 'success');
        } else {
            alert(message);
        }

        console.log('[SyncManager] ✅ Sukces:', message);
    }

    validateSelectedOrders() {
        const selectedOrders = this.fetchedOrders.filter(order =>
            this.selectedOrderIds.has(order.order_id.toString())
        );

        const ordersWithIssues = selectedOrders.filter(order => order.has_volume_issues);

        return {
            valid: ordersWithIssues.length === 0,
            ordersWithIssues: ordersWithIssues,
            totalSelected: selectedOrders.length
        };
    }

    // NOWA metoda: czyści dane po zakończeniu procesu
    clearSyncData() {
        this.fetchedOrders = [];
        this.selectedOrderIds.clear();
        this.productsNeedingVolume = [];
        this.isProcessing = false;
    }

    // NOWA METODA: Automatyczne zaznaczanie nowych zamówień
    autoSelectNewOrders() {
        console.log('[SyncManager] 🔄 Automatyczne zaznaczanie nowych zamówień');

        let autoSelectedCount = 0;
        let totalNewOrders = 0;

        // Znajdź wszystkie checkboxy dla zamówień które nie istnieją w bazie
        const checkboxes = this.ordersList.querySelectorAll('.order-select');

        checkboxes.forEach(checkbox => {
            const orderId = checkbox.getAttribute('data-order-id');

            // Znajdź odpowiadające zamówienie w danych
            const order = this.fetchedOrders.find(o => o.order_id == orderId);

            if (order && !order.exists_in_db) {
                totalNewOrders++;

                if (!checkbox.disabled) {
                    // Zaznacz zamówienie które nie istnieje w bazie i nie jest zablokowane
                    checkbox.checked = true;
                    this.selectedOrderIds.add(orderId);
                    autoSelectedCount++;

                    console.log(`[SyncManager] ✅ Auto-zaznaczono nowe zamówienie: ${orderId}`);
                } else {
                    console.log(`[SyncManager] ⚠️ Zamówienie ${orderId} jest nowe, ale zablokowane (prawdopodobnie problemy z wymiarami)`);
                }
            }
        });

        console.log(`[SyncManager] 📊 Automatyczne zaznaczanie zakończone:`, {
            totalNewOrders: totalNewOrders,
            autoSelectedCount: autoSelectedCount,
            skippedCount: totalNewOrders - autoSelectedCount
        });

        // Zapisz statystyki do użycia w innych metodach
        this.autoSelectionStats = {
            totalNewOrders: totalNewOrders,
            autoSelectedCount: autoSelectedCount,
            skippedCount: totalNewOrders - autoSelectedCount
        };
    }

    renderSingleOrder(order) {
        const orderElement = this.orderTemplate.content.cloneNode(true);

        const orderItem = orderElement.querySelector('.order-item');
        if (orderItem) {
            orderItem.setAttribute('data-order-id', order.order_id);
        }

        // WAŻNE: Sprawdź problemy z wymiarami i zaznacz wizualnie
        console.log(`[SyncManager] 🔍 Sprawdzanie wymiarów zamówienia ${order.order_id}:`, {
            has_dimension_issues: order.has_dimension_issues,
            products_with_issues: order.products_with_issues
        });

        if (order.has_dimension_issues) {
            if (orderItem) {
                orderItem.classList.add('has-dimension-issues');
            }
            console.log(`[SyncManager] ⚠️ Zamówienie ${order.order_id} ma problemy z wymiarami:`, order.products_with_issues);

            this.ordersWithDimensionIssues.set(order.order_id, {
                order: order,
                products_with_issues: order.products_with_issues || []
            });

            // Pokaż badge problemów z wymiarami
            const dimensionsBadge = orderElement.querySelector('.dimensions-issue-badge');
            if (dimensionsBadge) {
                dimensionsBadge.style.display = 'block';
                const issuesCount = order.products_with_issues?.length || 0;
                dimensionsBadge.textContent = `⚠️ Brak wymiarów (${issuesCount})`;
            }
        }

        // === NOWY KOD: Obsługa price type badge ===
        const priceTypeBadge = orderElement.querySelector('.price-type-badge');
        const priceTypeText = orderElement.querySelector('.price-type-text');

        if (priceTypeBadge && priceTypeText && order.price_type) {
            priceTypeBadge.style.display = 'block';

            // Usuń poprzednie klasy
            priceTypeBadge.classList.remove('netto', 'brutto', 'unknown');

            if (order.price_type === 'netto') {
                priceTypeBadge.classList.add('netto');
                priceTypeText.textContent = 'Netto';
            } else if (order.price_type === 'brutto') {
                priceTypeBadge.classList.add('brutto');
                priceTypeText.textContent = 'Brutto';
            } else {
                priceTypeBadge.classList.add('unknown');
                priceTypeText.textContent = 'Nieznane';
            }

            console.log(`[SyncManager] ℹ️ Zamówienie ${order.order_id} ma typ ceny: ${order.price_type}`);
        } else if (priceTypeBadge) {
            // Brak informacji o price_type - ukryj badge
            priceTypeBadge.style.display = 'none';
        }

        const checkbox = orderElement.querySelector('.order-select');
        if (checkbox) {
            checkbox.setAttribute('data-order-id', order.order_id);
        }

        if (order.exists_in_db) {
            console.log(`[SyncManager] ⚠️ Zamówienie ${order.order_id} już istnieje w bazie`);
            if (orderItem) {
                orderItem.classList.add('disabled');
            }
            if (checkbox) {
                checkbox.disabled = true;
            }
            const existsBadge = orderElement.querySelector('.exists-badge');
            if (existsBadge) {
                existsBadge.style.display = 'block';
            }
        } else {
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    this.handleOrderCheckboxChange(order.order_id, e.target.checked);
                });
            }
        }

        // Ustawianie statusu
        const statusBadge = orderElement.querySelector('.order-status-badge');
        if (statusBadge) {
            const statusId = order.order_status_id;
            const statusName = this.getStatusName(statusId);

            statusBadge.textContent = statusName;
            statusBadge.className = 'order-status-badge';

            // Dodaj klasę CSS w zależności od statusu
            if (statusId === 105112) {
                statusBadge.classList.add('status-new-unpaid');
            } else if (statusId === 155824) {
                statusBadge.classList.add('status-new-paid');
            } else if ([138619, 148832, 148831, 148830].includes(statusId)) {
                statusBadge.classList.add('status-in-production');
            } else if ([105113, 105114, 149763].includes(statusId)) {
                statusBadge.classList.add('status-shipped');
            } else if ([138624, 149778, 149779].includes(statusId)) {
                statusBadge.classList.add('status-delivered');
            } else if (statusId === 138625) {
                statusBadge.classList.add('status-cancelled');
            }

            console.log(`[SyncManager] 📊 Status zamówienia ${order.order_id}: ${statusName} (ID: ${statusId})`);
        }

        // Obliczanie kwot finansowych
        const financialData = this.calculateOrderAmounts(order);

        // Bezpieczne ustawianie tekstu
        const safeSetText = (selector, text, fallback = 'Brak danych') => {
            const element = orderElement.querySelector(selector);
            if (element) {
                element.textContent = text || fallback;
            }
        };

        // Wypełnij podstawowe informacje
        safeSetText('.order-number', order.order_id);
        safeSetText('.customer-name', order.customer_name || order.delivery_fullname);

        // Data - konwersja timestamp na datę
        const orderDate = order.date_add ? new Date(order.date_add * 1000).toLocaleDateString('pl-PL') : 'Brak daty';
        safeSetText('.order-date', orderDate);

        // Informacje o dostawie
        const deliveryInfo = `${order.delivery_postcode || ''} ${order.delivery_city || ''}`.trim();
        safeSetText('.delivery-info', deliveryInfo);

        // NOWE: Renderuj listę produktów
        this.renderProductsList(orderElement, order);

        // Wypełnij szczegółowe kwoty
        safeSetText('.products-amount', financialData.productsAmount);
        safeSetText('.delivery-amount', financialData.deliveryAmount);
        safeSetText('.total-amount', financialData.totalAmount);

        // Link do Baselinker
        const baselinkerLink = orderElement.querySelector('.baselinker-link');
        if (baselinkerLink) {
            baselinkerLink.addEventListener('click', (e) => {
                e.preventDefault();
                const url = `https://panel.baselinker.com/orders.php?action=order_details&order_id=${order.order_id}`;
                window.open(url, '_blank');
                console.log(`[SyncManager] 🔗 Otwieranie Baselinker dla zamówienia ${order.order_id}`);
            });
        }

        // Dodaj element do listy
        if (this.ordersList) {
            this.ordersList.appendChild(orderElement);
        }
    }

    renderProductsList(clone, order) {
        console.log(`[SyncManager] 📦 Renderowanie listy produktów dla zamówienia ${order.order_id}`);

        const productsSection = clone.querySelector('.products-section');
        const productsCountText = clone.querySelector('.products-count-text');
        const productsList = clone.querySelector('.products-list');

        if (!order.products || !Array.isArray(order.products)) {
            console.log(`[SyncManager] ⚠️ Brak produktów dla zamówienia ${order.order_id}`);
            if (productsCountText) {
                productsCountText.textContent = 'Brak danych o produktach';
            }
            if (productsSection) {
                productsSection.style.display = 'none';
            }
            return;
        }

        const productsCount = order.products.length;
        const problemProducts = order.products.filter(p =>
            p.has_dimension_issues || p.needs_manual_volume
        ).length;

        // Ustaw licznik produktów
        if (productsCountText) {
            let countText = `${productsCount} ${productsCount === 1 ? 'produkt' :
                productsCount < 5 ? 'produkty' : 'produktów'}`;

            if (problemProducts > 0) {
                countText += ` (${problemProducts} wymaga uzupełnienia)`;
            }

            productsCountText.textContent = countText;
            productsCountText.style.color = problemProducts > 0 ? '#dc3545' : '#495057';
            productsCountText.style.fontWeight = problemProducts > 0 ? '600' : '500';
        }

        // Wyczyść listę produktów
        if (productsList) {
            productsList.innerHTML = '';

            // Dodaj produkty do listy
            order.products.forEach((product, index) => {
                const productDiv = document.createElement('div');
                productDiv.className = 'product-item';
                productDiv.style.cssText = `
                padding: 8px 12px;
                border-bottom: 1px solid #f1f3f4;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 12px;
            `;

                // Usuń border z ostatniego elementu
                if (index === order.products.length - 1) {
                    productDiv.style.borderBottom = 'none';
                }

                // Oznacz produkty z problemami
                const hasDimensionIssues = product.has_dimension_issues;
                const hasVolumeIssues = product.needs_manual_volume;

                if (hasDimensionIssues || hasVolumeIssues) {
                    productDiv.classList.add('has-dimension-issues');
                    productDiv.style.backgroundColor = '#fff5f5';
                    productDiv.style.borderLeft = '3px solid #dc3545';
                    productDiv.style.paddingLeft = '8px';
                }

                const productName = product.name || 'Nieznany produkt';
                const quantity = parseInt(product.quantity) || 1;
                const price = parseFloat(product.price_brutto) || 0;
                const totalPrice = price * quantity;

                // Określ ikonę problemu
                let problemIcon = '';
                if (hasDimensionIssues && hasVolumeIssues) {
                    problemIcon = '⚠️📏 ';
                } else if (hasDimensionIssues) {
                    problemIcon = '⚠️ ';
                } else if (hasVolumeIssues) {
                    problemIcon = '📏 ';
                }

                productDiv.innerHTML = `
                <div class="product-name" style="flex: 1; color: ${hasDimensionIssues || hasVolumeIssues ? '#dc3545' : '#2c3e50'}; margin-right: 10px; line-height: 1.3; font-weight: ${hasDimensionIssues || hasVolumeIssues ? '500' : 'normal'};">
                    ${problemIcon}${productName}
                </div>
                <div class="product-details" style="display: flex; gap: 12px; align-items: center; color: #6c757d; white-space: nowrap;">
                    <span class="product-quantity" style="font-weight: 500;">${quantity} szt.</span>
                    <span class="product-price" style="font-weight: 500;">${totalPrice.toFixed(2)} PLN</span>
                </div>
            `;

                productsList.appendChild(productDiv);
            });

            console.log(`[SyncManager] 📦 Wyrenderowano ${order.products.length} produktów dla zamówienia ${order.order_id}`);
        }
    }

    updateRemainingAmount(clone, financialData) {
        const remainingAmount = clone.querySelector('.remaining-amount');
        if (remainingAmount) {
            remainingAmount.textContent = financialData.remainingAmount;

            // Zmień kolor w zależności od kwoty
            if (financialData.remainingAmountNum > 0) {
                remainingAmount.style.color = '#dc3545'; // Czerwony jeśli jest do zapłaty
            } else {
                remainingAmount.style.color = '#28a745'; // Zielony jeśli opłacone
                remainingAmount.textContent = 'Opłacone';
            }
        }
    }

    addOrderBadges(orderItem, order) {
        console.log(`[SyncManager] 🏷️ Dodawanie badge'ów dla zamówienia ${order.order_id}`);

        // Priorytet badge'ów (tylko jeden na raz):
        // 1. Zamówienie już w bazie (zielony)
        // 2. Problemy z wymiarami (czerwony) 
        // 3. Problemy z objętością (pomarańczowy)

        if (order.exists_in_database) {
            this.addExistsBadge(orderItem);
            console.log(`[SyncManager] 🏷️ Zamówienie ${order.order_id}: badge "W bazie"`);
            return;
        }

        if (order.has_dimension_issues) {
            this.addDimensionIssueBadge(orderItem, order);
            console.log(`[SyncManager] 🏷️ Zamówienie ${order.order_id}: badge "Brak wymiarów"`);
            return;
        }

        if (order.has_volume_issues) {
            this.addVolumeIssueBadge(orderItem, order);
            console.log(`[SyncManager] 🏷️ Zamówienie ${order.order_id}: badge "Brak objętości"`);
        }
    }

    addDimensionIssueBadge(orderItem, order) {
        const badge = orderItem.querySelector('.dimensions-issue-badge');
        if (badge) {
            const issuesCount = order.products_with_issues?.length ||
                order.products?.filter(p => p.has_dimension_issues)?.length || 0;
            badge.textContent = `⚠️ Brak wymiarów (${issuesCount})`;
            badge.style.display = 'block';
            badge.title = `${issuesCount} produktów nie ma wymiarów w nazwie`;
        }
    }

    // NOWA METODA: Renderowanie pojedynczych produktów w liście
    renderProductsInList(productsList, order) {
        if (!order.products || !Array.isArray(order.products)) {
            return;
        }

        // Stwórz mapę produktów z problemami wymiarów dla szybkiego dostępu
        const problemProductsMap = new Map();
        if (order.products_with_issues) {
            order.products_with_issues.forEach(problemProduct => {
                // Użyj nazwy produktu jako klucza, bo product_id może nie być unikalne
                problemProductsMap.set(problemProduct.name, problemProduct);
            });
        }

        order.products.forEach((product, index) => {
            const productDiv = document.createElement('div');
            productDiv.className = 'product-item';

            const productName = product.name || 'Nieznany produkt';
            const quantity = parseInt(product.quantity) || 1;
            const price = parseFloat(product.price_brutto) || 0;
            const totalPrice = price * quantity;

            // Sprawdź czy produkt ma problemy z wymiarami
            const hasDimensionIssues = problemProductsMap.has(productName);
            if (hasDimensionIssues) {
                productDiv.classList.add('has-dimension-issues');
            }

            productDiv.innerHTML = `
            <div class="product-name">
                ${hasDimensionIssues ? '⚠️ ' : ''}${productName}
            </div>
            <div class="product-details">
                <span class="product-quantity">${quantity} szt.</span>
                <span class="product-price">${totalPrice.toFixed(2)} PLN</span>
            </div>
        `;

            productsList.appendChild(productDiv);
        });

        console.log(`[SyncManager] 📦 Wyrenderowano ${order.products.length} produktów dla zamówienia ${order.order_id}`);
    }

    getStatusName(statusId) {
        if (!this.statusMap) {
            this.statusMap = {
                105112: 'NOWE - NIEOPŁACONE',
                155824: 'NOWE - OPŁACONE',
                138619: 'W PRODUKCJI - SUROWE',
                148832: 'W PRODUKCJI - OLEJOWANIE',
                148831: 'W PRODUKCJI - BEJCOWANIE',
                148830: 'W PRODUKCJI - LAKIEROWANIE',
                138620: 'PRODUKCJA ZAKOŃCZONA',
                138623: 'ZAMÓWIENIE SPAKOWANE',
                105113: 'PACZKA ZGŁOSZONA DO WYSYŁKI',
                105114: 'WYSŁANE - KURIER',
                149763: 'WYSŁANE - TRANSPORT WOODPOWER',
                149777: 'CZEKA NA ODBIÓR OSOBISTY',
                138624: 'DOSTARCZONA - KURIER',
                149778: 'DOSTARCZONA - TRANSPORT WOODPOWER',
                149779: 'ODEBRANE',
                138625: 'ZAMÓWIENIE ANULOWANE'
            };
        }

        return this.statusMap[statusId] || `STATUS ${statusId}` || 'NIEZNANY';
    }

    // Obliczanie kwot zamówienia
    calculateOrderAmounts(order) {
        console.log(`[SyncManager] 💰 Obliczanie kwot dla zamówienia ${order.order_id}`);

        let productsTotal = 0;
        let deliveryPrice = parseFloat(order.delivery_price) || 0;

        // Oblicz sumę produktów z order.products jeśli istnieje (preferowane)
        if (order.products && Array.isArray(order.products)) {
            productsTotal = order.products.reduce((sum, product) => {
                const price = parseFloat(product.price_brutto) || 0;
                const quantity = parseInt(product.quantity) || 1;
                return sum + (price * quantity);
            }, 0);
            console.log(`[SyncManager] 📊 Suma z produktów: ${productsTotal} PLN`);
        } else {
            // Fallback: jeśli nie ma szczegółów produktów, użyj order_value minus dostawa
            const orderValue = parseFloat(order.order_value) || 0;
            productsTotal = Math.max(0, orderValue - deliveryPrice); // zabezpieczenie przed ujemną wartością
            console.log(`[SyncManager] 📊 Suma fallback (order_value - delivery): ${productsTotal} PLN`);
        }

        const totalAmount = productsTotal + deliveryPrice;

        // NOWE: Obsługa payment_done i obliczanie pozostałej kwoty
        const paymentDone = parseFloat(order.payment_done) || 0;
        const remainingAmount = Math.max(0, totalAmount - paymentDone);

        // Formatowanie kwot
        const formatCurrency = (amount) => {
            return `${amount.toFixed(2)} PLN`;
        };

        const result = {
            productsAmount: formatCurrency(productsTotal),
            deliveryAmount: formatCurrency(deliveryPrice),
            totalAmount: formatCurrency(totalAmount),
            paidAmount: formatCurrency(paymentDone),
            remainingAmount: formatCurrency(remainingAmount),

            // Surowe wartości do obliczeń
            productsTotal: productsTotal,
            deliveryPrice: deliveryPrice,
            totalAmountNum: totalAmount,
            paidAmountNum: paymentDone,
            remainingAmountNum: remainingAmount
        };

        console.log(`[SyncManager] 💰 Kwoty zamówienia ${order.order_id}:`, {
            produkty: productsTotal,
            dostawa: deliveryPrice,
            razem: totalAmount,
            zapłacono: paymentDone,
            pozostało: remainingAmount
        });

        return result;
    }

    handleOrderCheckboxChange(orderId, isChecked) {
        console.log(`[SyncManager] ☑️ Zmiana checkbox zamówienia ${orderId}:`, isChecked);

        // Konwertuj na string aby być spójnym z resztą kodu
        const orderIdStr = String(orderId);

        if (isChecked) {
            this.selectedOrderIds.add(orderIdStr);
        } else {
            this.selectedOrderIds.delete(orderIdStr);
        }

        // DODANE: Sprawdź czy checkbox rzeczywiście został zaznaczony/odznaczony
        const checkbox = this.ordersList.querySelector(`[data-order-id="${orderIdStr}"]`);
        if (checkbox && checkbox.checked !== isChecked) {
            console.warn(`[SyncManager] ⚠️ Niezgodność stanu checkbox dla ${orderIdStr}: checkbox.checked=${checkbox.checked}, isChecked=${isChecked}`);
        }

        this.updateSaveButton();
        console.log('[SyncManager] 📊 Aktualnie wybrane zamówienia:', Array.from(this.selectedOrderIds));
    }

    // POPRAWKA 3: Dodaj walidację czy zamówienia netto powinny iść do modala wymiarów
    shouldCheckDimensions(order) {
        // Zamówienia netto nie wymagają sprawdzania wymiarów
        if (order.price_type === 'netto') {
            console.log(`[SyncManager] ℹ️ Zamówienie ${order.order_id} jest typu NETTO - pomijam sprawdzanie wymiarów`);
            return false;
        }

        // Tylko zamówienia brutto lub bez typu wymagają sprawdzania wymiarów
        return order.has_dimension_issues === true;
    }

    selectAllOrders() {
        console.log('[SyncManager] ✅ Zaznaczanie wszystkich zamówień');

        this.selectedOrderIds.clear();

        // POPRAWKA: Używaj order.order_id (to co przychodzi z API)
        this.fetchedOrders.forEach(order => {
            const orderId = String(order.order_id); // order_id z API
            this.selectedOrderIds.add(orderId);
        });

        // Aktualizuj checkboxy - znajdź po data-order-id
        const checkboxes = this.ordersList.querySelectorAll('.modal-bl-sync-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = true;
        });

        this.updateOrdersCount();
        this.updateOrdersSaveButton();
    }

    deselectAllOrders() {
        console.log('[SyncManager] ❌ Odznaczanie wszystkich zamówień');

        this.selectedOrderIds.clear();

        // Aktualizuj checkboxy - znajdź po właściwej klasie
        const checkboxes = this.ordersList.querySelectorAll('.modal-bl-sync-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });

        this.updateOrdersCount();
        this.updateOrdersSaveButton();
    }

    showEmptyState() {
        console.log('[SyncManager] 📭 Pokazywanie empty state (nowy styl)');

        const loadingState = document.getElementById('ordersLoadingState');
        const listContainer = document.getElementById('ordersListContainer');
        const emptyState = document.getElementById('ordersEmptyState');
        const errorState = document.getElementById('ordersErrorState');

        if (loadingState) loadingState.style.display = 'none';
        if (listContainer) listContainer.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        if (errorState) errorState.style.display = 'none';
    }

    updateSaveButton() {
        const selectedCount = this.selectedOrderIds.size;
        
        if (this.ordersSaveBtn) {
            this.ordersSaveBtn.disabled = selectedCount === 0;
            this.ordersSaveBtn.textContent = `Zapisz zamówienia (${selectedCount})`;
        }

        console.log('[SyncManager] 🔄 Przycisk zapisz zaktualizowany:', selectedCount);
    }

    showDimensionsModal(orderIdsWithIssues) {
        console.log('[SyncManager] 📐 Pokazywanie modala wymiarów:', orderIdsWithIssues);
        
        this.hideOrdersModal();
        this.renderDimensionsList(orderIdsWithIssues);
        
        this.dimensionsModal.style.display = 'flex';
        setTimeout(() => {
            this.dimensionsModal.classList.add('show');
        }, 10);
    }

    hideDimensionsModal() {
        console.log('[SyncManager] 📐 Ukrywanie modala wymiarów');
        
        this.dimensionsModal.classList.remove('show');
        setTimeout(() => {
            this.dimensionsModal.style.display = 'none';
        }, 300);
    }

    renderDimensionsList(orderIdsWithIssues) {
        console.log('[SyncManager] 🎨 Renderowanie listy wymiarów dla zamówień:', orderIdsWithIssues);
        
        if (!this.dimensionsList || !this.dimensionOrderTemplate || !this.dimensionProductTemplate) {
            console.error('[SyncManager] ❌ Brak wymaganych elementów do renderowania wymiarów');
            return;
        }

        this.dimensionsList.innerHTML = '';
        this.dimensionFixes = {};

        orderIdsWithIssues.forEach(orderId => {
            const order = this.fetchedOrders.find(o => o.order_id == orderId);
            if (order && order.has_dimension_issues) {
                this.renderSingleOrderDimensions(order);
            }
        });

        console.log('[SyncManager] ✅ Lista wymiarów wyrenderowana');
    }

    renderSingleOrderDimensions(order) {
        const orderElement = this.dimensionOrderTemplate.content.cloneNode(true);
        
        // Wypełnij header zamówienia
        orderElement.querySelector('.order-number').textContent = order.order_id;
        orderElement.querySelector('.customer-name').textContent = order.delivery_fullname || 'Brak nazwy';
        orderElement.querySelector('.order-date').textContent = new Date(order.date_add).toLocaleDateString('pl-PL');
        
        const productsContainer = orderElement.querySelector('.dimension-products-list');
        
        // Renderuj produkty z problemami wymiarów
        order.products_with_issues.forEach(product => {
            const productElement = this.renderSingleProductDimensions(order.order_id, product);
            productsContainer.appendChild(productElement);
        });
        
        this.dimensionsList.appendChild(orderElement);
    }

    renderSingleProductDimensions(orderId, product) {
        const productElement = this.dimensionProductTemplate.content.cloneNode(true);
        
        // Wypełnij informacje o produkcie
        productElement.querySelector('.product-name').textContent = product.name;
        productElement.querySelector('.product-quantity span').textContent = product.quantity;
        productElement.querySelector('.missing-list').textContent = product.missing_dimensions.join(', ');
        
        // Ustaw obecne wartości wymiarów
        const currentDimensions = product.current_dimensions || {};
        const inputs = productElement.querySelectorAll('.dimension-input');

        const volumeInput = productElement.querySelector('.calculated-volume');
        // Ustaw data-attributes analogicznie do pozostałych:
        volumeInput.setAttribute('data-order-id', orderId);
        volumeInput.setAttribute('data-product-id', product.product_id);
        // Obsługa ręcznej zmiany objętości:
        volumeInput.addEventListener('input', () => {
            const manualValue = parseFloat(volumeInput.value);
            if (!isNaN(manualValue) && manualValue > 0) {
                // Nadpisz w tymczasowych poprawkach
                if (!this.dimensionFixes[orderId]) this.dimensionFixes[orderId] = {};
                if (!this.dimensionFixes[orderId][product.product_id]) this.dimensionFixes[orderId][product.product_id] = {};
                this.dimensionFixes[orderId][product.product_id]['volume_m3'] = manualValue;
            }
        });
        
        inputs.forEach(input => {
            const dimension = input.getAttribute('data-dimension');
            const currentValue = currentDimensions[dimension];
            
            if (currentValue) {
                input.value = currentValue;
            }
            
            // Dodaj data attributes dla identyfikacji
            input.setAttribute('data-order-id', orderId);
            input.setAttribute('data-product-id', product.product_id);
            
            // Obsługa zmiany wartości
            input.addEventListener('input', () => {
                this.handleDimensionChange(orderId, product.product_id, product.quantity);
            });
        });
        
        return productElement;
    }

    handleDimensionChange(orderId, productId, quantity) {
        const container = this.dimensionsList.querySelector(
            `.dimension-product-item input[data-order-id="${orderId}"][data-product-id="${productId}"]`
        ).closest('.dimension-product-item');
        const inputs = container.querySelectorAll('.dimension-input');
        const volumeInput = container.querySelector('.calculated-volume');

        const dims = {};
        let hasAll = true;
        inputs.forEach(input => {
            const key = input.getAttribute('data-dimension');
            const val = parseFloat(input.value);
            if (!isNaN(val) && val > 0) dims[key] = val;
            else hasAll = false;

            // Zapiszę w poprawkach wymiary
            if (!this.dimensionFixes[orderId]) this.dimensionFixes[orderId] = {};
            if (!this.dimensionFixes[orderId][productId]) this.dimensionFixes[orderId][productId] = {};
            this.dimensionFixes[orderId][productId][key] = val;
        });

        // Jeżeli wymiary zmienione, usuń ewentualne manualne nadpisanie objętości
        if (this.dimensionFixes[orderId] && this.dimensionFixes[orderId][productId]) {
            delete this.dimensionFixes[orderId][productId]['volume_m3'];
        }

        // Automatyczne obliczenie objętości
        if (hasAll && dims.length_cm && dims.width_cm && dims.thickness_mm) {
            const lengthM = dims.length_cm / 100;
            const widthM = dims.width_cm / 100;
            const thicknessM = dims.thickness_mm / 1000;
            const computed = lengthM * widthM * thicknessM * quantity;
            volumeInput.value = computed.toFixed(4);
        } else {
            volumeInput.value = '';
        }
    }

    async saveSelectedOrders() {
        console.log('[SyncManager] 💾 Zapisywanie zaznaczonych zamówień');
        try {
            // Pokaż globalny loading
            this.showGlobalLoading('Zapisywanie zamówień...');

            // POPRAWKA: Przygotuj order_ids zamiast całych obiektów
            const orderIds = Array.from(this.selectedOrderIds);

            console.log('[SyncManager] 📦 Zamówienia do zapisania:', orderIds.length);

            // POPRAWKA: Używaj tego samego endpointu co performSaveOrders()
            const response = await fetch('/reports/api/save-selected-orders-with-dimensions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    order_ids: orderIds,                    // tablica ID zamówień
                    dimension_fixes: this.dimensionFixes || {}   // poprawki wymiarów (może być puste)
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.success) {
                console.log('[SyncManager] ✅ Zamówienia zapisane pomyślnie');

                // Ukryj modal i odśwież tabelę
                this.hideAllModals();

                // Odśwież tabelę raportów jeśli istnieje
                if (window.reportsManager && typeof window.reportsManager.refreshTable === 'function') {
                    window.reportsManager.refreshTable();
                }

                // Pokaż komunikat sukcesu
                this.showSuccessMessage({
                    message: result.message || `Zapisano ${orderIds.length} zamówień`
                });
            } else {
                throw new Error(result.error || 'Błąd zapisu zamówień');
            }
        } catch (error) {
            console.error('[SyncManager] ❌ Błąd zapisywania:', error);
            this.showErrorMessage(`Błąd zapisu: ${error.message}`);
        } finally {
            this.hideGlobalLoading();
        }
    }

    hideAllModals() {
        if (this.daysModal) this.daysModal.style.display = 'none';
        if (this.ordersModal) this.ordersModal.style.display = 'none';
        if (this.dimensionsModal) this.dimensionsModal.style.display = 'none';
    }

    // Pomocnicza metoda dla zamówień bez problemów
    async saveSelectedOrdersWithoutIssues(selectedOrders) {
        // Implementacja zapisu bez poprawek wymiarów
        console.log('[SyncManager] ✅ Zapisywanie zamówień bez problemów z wymiarami');
        // Tu będzie logika zapisu do bazy...
    }

    async handleDimensionsBack() {
        console.log('[SyncManager] ⬅️ Powrót z modala wymiarów do listy zamówień');
        this.hideDimensionsModal();
        this.showOrdersModal();
    }

    async handleDimensionsSkip() {
        console.log('[SyncManager] ⏭️ Pomiń wymiary i zapisz zamówienia');
        
        if (!confirm('Czy na pewno chcesz pominąć uzupełnianie wymiarów? Produkty bez wymiarów nie będą miały obliczonej objętości (m³).')) {
            return;
        }
        
        const selectedOrdersList = Array.from(this.selectedOrderIds);
        this.hideDimensionsModal();
        await this.saveOrdersWithoutDimensions(selectedOrdersList);
    }

    async handleDimensionsSave() {
        console.log('[SyncManager] 💾 Zapisz zamówienia z uzupełnionymi wymiarami');
        
        const selectedOrdersList = Array.from(this.selectedOrderIds);
        this.hideDimensionsModal();
        await this.saveOrdersWithDimensions(selectedOrdersList, this.dimensionFixes);
    }

    async saveOrdersWithoutDimensions(orderIds) {
        console.log('[SyncManager] 💾 Zapisywanie zamówień bez poprawek wymiarów');
        await this.performSaveOrders(orderIds, {});
    }

    async saveOrdersWithDimensions(orderIds, dimensionFixes) {
        console.log('[SyncManager] 💾 Zapisywanie zamówień z poprawkami wymiarów:', dimensionFixes);
        await this.performSaveOrders(orderIds, dimensionFixes);
    }

    async performSaveOrders(orderIds, dimensionFixes = {}) {
        if (this.isProcessing) {
            console.warn('[SyncManager] ⚠️ Proces zapisywania już trwa');
            return;
        }

        this.isProcessing = true;
        this.showGlobalLoading('Zapisywanie zamówień...', 'Przetwarzanie wybranych zamówień');

        try {
            const requestData = {
                order_ids: orderIds,
                dimension_fixes: dimensionFixes
            };

            console.log('[SyncManager] 📤 Wysyłanie zamówień do zapisania:', requestData);

            const response = await fetch('/reports/api/save-selected-orders-with-dimensions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[SyncManager] 📥 Wynik zapisywania:', result);

            if (result.success) {
                this.handleSaveSuccess(result);
            } else {
                throw new Error(result.error || 'Błąd zapisywania zamówień');
            }

        } catch (error) {
            console.error('[SyncManager] ❌ Błąd zapisywania zamówień:', error);
            this.handleSaveError(error);
        } finally {
            this.isProcessing = false;
            this.hideGlobalLoading();
        }
    }

    handleSaveSuccess(result) {
        console.log('[SyncManager] ✅ Zamówienia zapisane pomyślnie');

        // Przygotuj wiadomość dla toast'a
        let message = '🎉 Synchronizacja zakończona pomyślnie!';

        // Dodaj szczegóły jeśli są dostępne
        const details = [];
        if (result.orders_added > 0) {
            details.push(`✅ Zapisano ${result.orders_added} produktów`);
        }
        if (result.orders_updated > 0) {
            details.push(`🔄 Zaktualizowano ${result.orders_updated} zamówień`);
        }
        if (result.orders_processed > 0) {
            details.push(`📊 Przetworzono ${result.orders_processed} zamówień`);
        }

        // Połącz wiadomość główną ze szczegółami
        if (details.length > 0) {
            message += ' ' + details.join(', ');
        }

        // Użyj toast zamiast alert
        this.showSuccessMessage({ message: message });

        // Zamknij wszystkie modale po krótkim opóźnieniu (żeby toast był widoczny)
        setTimeout(() => {
            this.resetState();
            this.hideDaysModal();
            this.hideOrdersModal();
            this.hideDimensionsModal();

            // Odśwież dane na stronie
            if (window.reportsManager && typeof window.reportsManager.refreshData === 'function') {
                window.reportsManager.refreshData();
            } else {
                window.location.reload();
            }
        }, 1000); // 1 sekunda żeby toast był widoczny
    }

    handleSaveError(error) {
        console.error('[SyncManager] ❌ Błąd zapisywania:', error);

        // Użyj toast zamiast alert dla błędów
        this.showErrorMessage(`Błąd podczas zapisywania zamówień: ${error.message}`);
    }

    // =====================================================
    // ZAPISYWANIE ZAMÓWIEŃ Z OBSŁUGĄ PROBLEMÓW WYMIARÓW
    // =====================================================

    async handleOrdersSave() {
        console.log('[SyncManager] 💾 Obsługa zapisywania zamówień');

        if (this.selectedOrderIds.size === 0) {
            console.log('[SyncManager] ⚠️ Brak zaznaczonych zamówień');
            return;
        }

        // POPRAWKA: Sprawdź problemy używając order.order_id (string)
        const selectedWithProblems = Array.from(this.selectedOrderIds).filter(id =>
            this.ordersWithDimensionIssues.has(id) // id już jest stringiem z API
        );

        if (selectedWithProblems.length > 0) {
            console.log(`[SyncManager] ⚠️ ${selectedWithProblems.length} zaznaczonych zamówień ma problemy z wymiarami`);

            // Przejdź do kroku wymiarów
            this.proceedToDimensionsStep();
        } else {
            console.log('[SyncManager] ✅ Wszystkie zaznaczone zamówienia mają poprawne wymiary, zapisuję');

            // Zapisz bezpośrednio
            await this.saveSelectedOrders();
        }
    }

    proceedToDimensionsStep() {
        console.log('[SyncManager] 📐 Przejście do kroku wymiarów');

        // Tu będzie logika przejścia do kroku 3 (modal wymiarów)
        // Na razie placeholder
        alert('Przejście do uzupełnienia wymiarów - do implementacji w następnym kroku');
    }

    // NOWA metoda: pokazuje modal objętości
    async showVolumeModal(productsNeedingVolume) {
        console.log('[SyncManager] 📏 Pokazywanie modala objętości');

        // Sprawdź czy modal objętości istnieje
        if (!this.dimensionsModal) {
            console.warn('[SyncManager] ⚠️ Modal objętości niedostępny - używam fallback');
            alert(`Znaleziono ${productsNeedingVolume.length} produktów wymagających objętości. Modal objętości nie jest jeszcze zaimplementowany.`);
            // Zapisz bez objętości
            const selectedOrders = this.fetchedOrders.filter(order =>
                Array.from(this.selectedOrderIds).includes(order.order_id.toString())
            );
            await this.saveOrdersDirectly(selectedOrders);
            return;
        }

        // Ukryj modal zamówień
        this.hideOrdersModal();

        // Sprawdź dostępność VolumeManager
        if (!this.volumeManager) {
            console.error('[SyncManager] VolumeManager nie jest dostępny');
            alert('Błąd: moduł obsługi objętości nie jest dostępny. Odśwież stronę i spróbuj ponownie.');
            this.showOrdersModal();
            return;
        }

        // Zapisz produkty do późniejszego użycia
        this.productsNeedingVolume = productsNeedingVolume;

        // Pokaż modal objętości
        this.volumeManager.showModal(productsNeedingVolume);
    }

    // NOWA metoda: bezpośredni zapis zamówień (bez problemów z objętością)
    async saveOrdersDirectly(selectedOrders) {
        console.log('[SyncManager] 💾 Bezpośredni zapis zamówień bez problemów z objętością');

        try {
            this.showSaveProgress('Zapisywanie zamówień...');

            const orderIds = selectedOrders.map(order => order.order_id);

            const response = await fetch('/reports/api/save-selected-orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    order_ids: orderIds
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccessMessage(result);
                this.hideOrdersModal();

                // Odśwież tabelę raportów
                if (window.reportsManager) {
                    window.reportsManager.refreshData();
                }
            } else {
                throw new Error(result.error || 'Nieznany błąd');
            }

        } catch (error) {
            console.error('[SyncManager] Błąd bezpośredniego zapisu:', error);
            throw error;
        } finally {
            this.hideSaveProgress();
        }
    }

    // NOWA metoda: pokazuje stan postępu zapisu
    showSaveProgress(message = 'Zapisywanie...') {
        const saveBtn = document.getElementById('ordersSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" style="width: 1rem; height: 1rem;"></span>${message}`;
        }

        // Pokaż overlay ładowania jeśli istnieje
        if (this.globalLoading) {
            if (this.globalLoadingTitle) this.globalLoadingTitle.textContent = message;
            if (this.globalLoadingText) this.globalLoadingText.textContent = 'Proszę czekać...';
            this.globalLoading.style.display = 'flex';
        }
    }

    // NOWA metoda: ukrywa stan postępu zapisu
    hideSaveProgress() {
        const saveBtn = document.getElementById('ordersSave');
        if (saveBtn) {
            saveBtn.disabled = this.selectedOrderIds.size === 0;
            this.updateSaveButton(); // Przywróć oryginalny tekst
        }

        // Ukryj overlay ładowania
        if (this.globalLoading) {
            this.globalLoading.style.display = 'none';
        }
    }

    // NOWA metoda: pokazuje komunikat sukcesu
    showSuccessMessage(result) {
        const message = result.message || 'Zamówienia zostały pomyślnie zapisane';

        // Użyj toast jeśli dostępny, w przeciwnym razie alert
        if (window.showToast) {
            window.showToast(message, 'success');
        } else {
            alert(message);
        }

        console.log('[SyncManager] ✅ Sukces:', message);
    }

    // NOWA metoda: pokazuje komunikat błędu
    showErrorMessage(message) {
        // Użyj toast jeśli dostępny, w przeciwnym razie alert
        if (window.showToast) {
            window.showToast(message, 'error');
        } else {
            alert(message);
        }
        console.error('[SyncManager] ❌ Błąd:', message);
    }

    extractProductsNeedingVolume(selectedOrders) {
        const productsNeedingVolume = [];

        selectedOrders.forEach(order => {
            order.products.forEach(product => {
                if (product.needs_manual_volume) {
                    productsNeedingVolume.push({
                        order_id: order.order_id,
                        product_id: product.product_id || 'unknown',
                        product_name: product.name,
                        quantity: product.quantity || 1,
                        order_info: {
                            customer_name: order.customer_name,
                            date: order.date_created
                        },
                        analysis: product.volume_analysis
                    });
                }
            });
        });

        return productsNeedingVolume;
    }

    // NOWA metoda: pokazuje modal objętości
    async showVolumeModal(productsNeedingVolume) {
        console.log('[SyncManager] 📏 Pokazywanie modala objętości');

        // Ukryj modal zamówień
        this.hideOrdersModal();

        // Sprawdź dostępność VolumeManager
        if (!this.volumeManager) {
            console.error('[SyncManager] VolumeManager nie jest dostępny');
            alert('Błąd: moduł obsługi objętości nie jest dostępny. Odśwież stronę i spróbuj ponownie.');
            this.showOrdersModal();
            return;
        }

        // Zapisz produkty do późniejszego użycia
        this.productsNeedingVolume = productsNeedingVolume;

        // Pokaż modal objętości
        this.volumeManager.showModal(productsNeedingVolume);
    }

    // NOWA metoda: bezpośredni zapis zamówień (bez problemów z objętością)
    async saveOrdersDirectly(selectedOrders) {
        console.log('[SyncManager] 💾 Bezpośredni zapis zamówień bez problemów z objętością');

        try {
            this.showSaveProgress('Zapisywanie zamówień...');

            const orderIds = selectedOrders.map(order => order.order_id);

            const response = await fetch('/reports/api/save-selected-orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    order_ids: orderIds
                })
            });

            const result = await response.json();

            if (result.success) {
                this.showSuccessMessage(result);
                this.hideOrdersModal();

                // Odśwież tabelę raportów
                if (window.reportsManager) {
                    window.reportsManager.refreshTable();
                }
            } else {
                throw new Error(result.error || 'Nieznany błąd');
            }

        } catch (error) {
            console.error('[SyncManager] Błąd bezpośredniego zapisu:', error);
            throw error;
        } finally {
            this.hideSaveProgress();
        }
    }

    // NOWA metoda: wyodrębnia produkty wymagające ręcznego wprowadzenia objętości
    extractProductsNeedingVolume(selectedOrders) {
        const productsNeedingVolume = [];

        selectedOrders.forEach(order => {
            if (order.products && Array.isArray(order.products)) {
                order.products.forEach(product => {
                    if (product.needs_manual_volume) {
                        productsNeedingVolume.push({
                            order_id: order.order_id,
                            product_id: product.product_id || 'unknown',
                            product_name: product.name,
                            quantity: product.quantity || 1,
                            order_info: {
                                customer_name: order.customer_name || order.delivery_fullname,
                                date: new Date(order.date_add * 1000).toLocaleDateString('pl-PL')
                            },
                            analysis: product.volume_analysis
                        });
                    }
                });
            }
        });

        return productsNeedingVolume;
    }

    getActuallySelectedOrderIds() {
        const selectedIds = [];
        const checkboxes = document.querySelectorAll('#ordersList .modal-bl-sync-checkbox:checked');

        checkboxes.forEach(checkbox => {
            const orderId = checkbox.getAttribute('data-order-id');
            if (orderId) {
                selectedIds.push(orderId);
            }
        });

        console.log('[SyncManager] 🔍 Rzeczywisty stan checkboxów:', selectedIds);
        return selectedIds;
    }

    showDimensionFixModal(ordersWithIssues, allSelectedOrders) {
        console.log('[SyncManager] 🔧 Tworzenie modala uzupełnienia wymiarów dla zamówień:', ordersWithIssues);
        
        this.hideOrdersModal();
        
        const issuesData = ordersWithIssues.map(orderId => {
            const issueInfo = this.ordersWithDimensionIssues.get(orderId);
            return {
                orderId: orderId,
                order: issueInfo.order,
                products: issueInfo.products_with_issues
            };
        });

        this.createDimensionFixModal(issuesData, allSelectedOrders);
    }

    createDimensionFixModal(issuesData, allSelectedOrders) {
        console.log('[SyncManager] 🏗️ Tworzenie modala uzupełnienia wymiarów');

        const existingModal = document.getElementById('dimensionFixModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'dimensionFixModal';
        modal.className = 'sync-modal show';
        
        let productsHtml = '';
        
        issuesData.forEach(issue => {
            const order = issue.order;
            
            productsHtml += `
                <div class="dimension-fix-order">
                    <div class="dimension-fix-order-header">
                        <h4>Zamówienie #${order.order_id}</h4>
                        <span class="order-customer">👤 ${order.customer_name}</span>
                    </div>
                    <div class="dimension-fix-products">
            `;
            
            issue.products.forEach(product => {
                productsHtml += `
                    <div class="dimension-fix-product" data-order-id="${order.order_id}" data-product-index="${product.index}">
                        <div class="product-info">
                            <strong>${product.index}. ${product.name}</strong>
                            <span class="product-quantity">Ilość: ${product.quantity} szt.</span>
                        </div>
                        
                        <!-- Opcjonalne pola wymiarów jeśli chcemy umożliwić ich wpisanie -->
                        <div class="optional-dimensions" style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px;">
                            <h6 style="margin: 0 0 10px 0; color: #6c757d;">Opcjonalnie - wpisz wymiary aby auto-obliczyć objętość:</h6>
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                                <div>
                                    <label style="font-size: 12px;">Długość (cm):</label>
                                    <input type="number" step="0.1" class="dimension-input" 
                                        data-dimension="length_cm" 
                                        style="width: 100%; padding: 5px; border: 1px solid #ddd; border-radius: 3px;">
                                </div>
                                <div>
                                    <label style="font-size: 12px;">Szerokość (cm):</label>
                                    <input type="number" step="0.1" class="dimension-input" 
                                        data-dimension="width_cm"
                                        style="width: 100%; padding: 5px; border: 1px solid #ddd; border-radius: 3px;">
                                </div>
                                <div>
                                    <label style="font-size: 12px;">Grubość (cm):</label>
                                    <input type="number" step="0.1" class="dimension-input" 
                                        data-dimension="thickness_cm"
                                        style="width: 100%; padding: 5px; border: 1px solid #ddd; border-radius: 3px;">
                                </div>
                            </div>
                        </div>
                        
                        <div class="volume-input-group">
                            <label>Objętość (m³):</label>
                            <input type="number" 
                                step="0.0001" 
                                min="0" 
                                class="volume-input" 
                                data-order-id="${order.order_id}" 
                                data-product-index="${product.index}"
                                placeholder="np. 0.0640"
                                required>
                            <small class="volume-help">Wpisz objętość lub podaj wymiary powyżej</small>
                        </div>
                    </div>
                `;
            });
            
            productsHtml += `
                    </div>
                </div>
            `;
        });

        modal.innerHTML = `
            <div class="sync-modal-overlay">
                <div class="sync-modal-content sync-modal-large">
                    <div class="sync-modal-header">
                        <h3>Uzupełnij objętości produktów</h3>
                        <button class="sync-modal-close" id="dimensionFixClose">&times;</button>
                    </div>
                    
                    <div class="sync-modal-body">
                        <div class="dimension-fix-info">
                            <div class="info-icon">⚠️</div>
                            <div class="info-text">
                                <p><strong>Niektóre produkty nie mają wymiarów w nazwie.</strong></p>
                                <p>Uzupełnij objętość (m³) dla każdego produktu, aby system mógł poprawnie obliczyć statystyki.</p>
                            </div>
                        </div>
                        
                        <div class="dimension-fix-list">
                            ${productsHtml}
                        </div>
                    </div>
                    
                    <div class="sync-modal-footer">
                        <button id="dimensionFixBack" class="btn btn-secondary">Wstecz</button>
                        <button id="dimensionFixCancel" class="btn btn-secondary">Anuluj</button>
                        <button id="dimensionFixSave" class="btn btn-primary">Zapisz z uzupełnionymi objętościami</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.setupDimensionFixModalEvents(modal, allSelectedOrders);
        
        console.log('[SyncManager] ✅ Modal uzupełnienia wymiarów utworzony');
    }

    // NOWA metoda: pokazuje informację o problemach z objętością
    showVolumeIssuesInfo(count) {
        const container = document.getElementById('ordersListContainer');
        if (!container) return;

        // Usuń poprzednie powiadomienie jeśli istnieje
        const existingAlert = container.querySelector('.volume-issues-alert');
        if (existingAlert) {
            existingAlert.remove();
        }

        // Utwórz nowe powiadomienie
        const alert = document.createElement('div');
        alert.className = 'volume-issues-alert';
        alert.innerHTML = `
            <div class="alert alert-warning" style="margin-bottom: 20px; padding: 15px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px;">
                <div class="alert-content" style="display: flex; align-items: flex-start; gap: 12px;">
                    <div class="alert-icon" style="font-size: 20px;">⚠️</div>
                    <div class="alert-text">
                        <strong>Uwaga:</strong> ${count} produktów wymaga uzupełnienia objętości.
                        <br><small style="color: #856404;">Po wybraniu zamówień zostaniesz poproszony o wprowadzenie objętości dla produktów bez wymiarów.</small>
                    </div>
                </div>
            </div>
        `;

        // Wstaw na początku kontenera
        container.insertBefore(alert, container.firstChild);
    }

    setupDimensionFixModalEvents(modal, allSelectedOrders) {
        console.log('[SyncManager] 🔗 Ustawianie event listenerów dla modala wymiarów');

        const closeBtn = modal.querySelector('#dimensionFixClose');
        const cancelBtn = modal.querySelector('#dimensionFixCancel');
        const backBtn = modal.querySelector('#dimensionFixBack');
        const saveBtn = modal.querySelector('#dimensionFixSave');

        const closeModal = () => {
            modal.remove();
            this.showOrdersModal();
        };

        closeBtn?.addEventListener('click', closeModal);
        cancelBtn?.addEventListener('click', closeModal);
        backBtn?.addEventListener('click', closeModal);

        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleKeydown);
            }
        };
        document.addEventListener('keydown', handleKeydown);

        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.classList.contains('sync-modal-overlay')) {
                closeModal();
            }
        });

        saveBtn?.addEventListener('click', async () => {
            console.log('[SyncManager] 💾 Zapisywanie z uzupełnionymi objętościami');
            
            const volumeInputs = modal.querySelectorAll('.volume-input');
            const volumeOverrides = {};
            let allValid = true;

            volumeInputs.forEach(input => {
                const orderId = input.getAttribute('data-order-id');
                const productIndex = input.getAttribute('data-product-index');
                const volume = parseFloat(input.value);

                if (!input.value || isNaN(volume) || volume < 0) {
                    input.classList.add('error');
                    allValid = false;
                } else {
                    input.classList.remove('error');
                    
                    if (!volumeOverrides[orderId]) {
                        volumeOverrides[orderId] = {};
                    }
                    volumeOverrides[orderId][productIndex] = volume;
                }
            });

            if (!allValid) {
                this.showError('Wszystkie pola objętości muszą być wypełnione poprawnymi wartościami');
                return;
            }

            console.log('[SyncManager] 📊 Zebrane objętości:', volumeOverrides);

            modal.remove();
            document.removeEventListener('keydown', handleKeydown);
            
            await this.performOrdersSave(allSelectedOrders, volumeOverrides);
        });

        const volumeInputs = modal.querySelectorAll('.volume-input');
        volumeInputs.forEach(input => {
            input.addEventListener('input', () => {
                const value = parseFloat(input.value);
                if (input.value && (!isNaN(value) && value >= 0)) {
                    input.classList.remove('error');
                } else if (input.value) {
                    input.classList.add('error');
                }
            });
        });
        this.setupVolumeCalculation(modal);
        console.log('[SyncManager] 🔧 Event listenery dla modala wymiarów ustawione');
    }

    setupVolumeCalculation(modal) {
        console.log('[SyncManager] 🔧 Ustawianie automatycznego obliczania objętości');

        // Znajdź wszystkie grupy produktów z inputami wymiarów i objętości
        const productGroups = modal.querySelectorAll('.dimension-fix-product');
        
        productGroups.forEach(productGroup => {
            const orderId = productGroup.getAttribute('data-order-id');
            const productIndex = productGroup.getAttribute('data-product-index');
            
            // Sprawdź czy istnieją pola wymiarów (w niektórych modalach mogą być)
            const lengthInput = productGroup.querySelector('.dimension-input[data-dimension="length_cm"]');
            const widthInput = productGroup.querySelector('.dimension-input[data-dimension="width_cm"]');
            const thicknessInput = productGroup.querySelector('.dimension-input[data-dimension="thickness_cm"]');
            const volumeInput = productGroup.querySelector('.volume-input');
            
            if (!volumeInput) return;
            
            // Funkcja obliczająca objętość z wymiarów
            const calculateAndUpdateVolume = () => {
                if (lengthInput && widthInput && thicknessInput && volumeInput) {
                    const length = parseFloat(lengthInput.value) || 0;
                    const width = parseFloat(widthInput.value) || 0;
                    const thickness = parseFloat(thicknessInput.value) || 0;
                    
                    if (length > 0 && width > 0 && thickness > 0) {
                        // Konwersja z cm na m³
                        const volume = (length / 100) * (width / 100) * (thickness / 100);
                        
                        // Znajdź ilość produktu
                        const quantityElement = productGroup.querySelector('.product-quantity');
                        let quantity = 1;
                        if (quantityElement) {
                            const quantityMatch = quantityElement.textContent.match(/(\d+)/);
                            if (quantityMatch) {
                                quantity = parseInt(quantityMatch[1]);
                            }
                        }
                        
                        const totalVolume = volume * quantity;
                        volumeInput.value = totalVolume.toFixed(4);
                        
                        // Dodaj wizualną informację o automatycznym obliczeniu
                        volumeInput.style.backgroundColor = '#e8f5e8';
                        volumeInput.title = `Automatycznie obliczone z wymiarów: ${length}×${width}×${thickness} cm × ${quantity} szt.`;
                    }
                }
            };
            
            // Dodaj event listenery do pól wymiarów
            if (lengthInput && widthInput && thicknessInput) {
                [lengthInput, widthInput, thicknessInput].forEach(input => {
                    input.addEventListener('input', calculateAndUpdateVolume);
                    input.addEventListener('change', calculateAndUpdateVolume);
                });
            }
            
            // Dodaj event listener do pola objętości - usuń auto-obliczenie gdy użytkownik wpisuje ręcznie
            volumeInput.addEventListener('input', () => {
                volumeInput.style.backgroundColor = '';
                volumeInput.title = 'Wartość wpisana ręcznie';
            });
        });
    }

    async performOrdersSave(selectedOrdersList, volumeOverrides = null) {
        console.log('[SyncManager] 💾 Rozpoczęcie faktycznego zapisywania zamówień:', selectedOrdersList);

        this.isProcessing = true;
        
        this.showGlobalLoading('Zapisywanie zamówień...', 'Proszę czekać, trwa zapisywanie wybranych zamówień do bazy danych.');

        try {
            const requestData = {
                order_ids: selectedOrdersList,
                date_from: this.dateFrom,
                date_to: this.dateTo,
                volume_overrides: volumeOverrides || {}
            };

            console.log('[SyncManager] 📤 Wysyłanie zamówień do zapisania:', requestData);

            const response = await fetch('/reports/api/save-selected-orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[SyncManager] 📥 Wynik zapisywania:', result);

            if (result.success) {
                this.showGlobalLoading('Sukces!', `Pomyślnie zapisano ${result.orders_saved || selectedOrdersList.length} zamówień do bazy danych.`);
                
                setTimeout(() => {
                    this.hideGlobalLoading();
                    this.resetState();
                    
                    if (window.reportsManager) {
                        window.reportsManager.refreshData();
                    }
                }, 3000);

            } else {
                throw new Error(result.error || 'Błąd zapisywania zamówień');
            }

        } catch (error) {
            console.error('[SyncManager] ❌ Błąd zapisywania zamówień:', error);
            this.hideGlobalLoading();
            this.showError(`Błąd zapisywania zamówień: ${error.message}`);
        } finally {
            this.isProcessing = false;
        }
    }

    // =====================================================
    // GLOBALNY LOADING
    // =====================================================

    showGlobalLoading(text = 'Przetwarzanie...') {
        if (this.globalLoading) {
            this.globalLoading.style.display = 'flex';
        }
        if (this.globalLoadingText) {
            this.globalLoadingText.textContent = text;
        }
    }

    hideGlobalLoading() {
        if (this.globalLoading) {
            this.globalLoading.style.display = 'none';
        }
    }

    // =====================================================
    // FUNKCJE POMOCNICZE
    // =====================================================

    resetState() {
        console.log('[SyncManager] 🔄 Resetowanie stanu aplikacji');

        this.selectedDays = null;
        this.dateFrom = null;
        this.dateTo = null;
        this.fetchedOrders = [];
        this.selectedOrderIds.clear();
        this.ordersWithDimensionIssues.clear();
        this.isProcessing = false;

        if (this.daysSelect) this.daysSelect.value = '';
        if (this.daysConfirmBtn) this.daysConfirmBtn.disabled = true;
        this.hideDatePreview();
        this.ordersWithDimensionIssues.clear();
        this.dimensionFixes = {};
    }

    formatDate(date) {
        return date.toISOString().split('T')[0];
    }

    formatDateTime(dateString) {
        if (!dateString) return 'Brak daty';
        
        try {
            let date;
            
            if (typeof dateString === 'number') {
                console.log(`[SyncManager] 📅 Formatowanie timestamp: ${dateString}`);
                date = new Date(dateString * 1000);
            } else if (typeof dateString === 'string') {
                if (dateString.match(/^\d+$/)) {
                    console.log(`[SyncManager] 📅 Formatowanie timestamp jako string: ${dateString}`);
                    date = new Date(parseInt(dateString) * 1000);
                } else {
                    console.log(`[SyncManager] 📅 Formatowanie string daty: ${dateString}`);
                    date = new Date(dateString);
                }
            } else {
                date = new Date(dateString);
            }

            if (isNaN(date.getTime())) {
                console.warn(`[SyncManager] ⚠️ Nieprawidłowa data: ${dateString}`);
                return `Błędna data: ${dateString}`;
            }

            console.log(`[SyncManager] 🔍 Debug formatowania daty:`, {
                input: dateString,
                inputType: typeof dateString,
                parsedDate: date.toISOString(),
                year: date.getFullYear()
            });

            if (date.getFullYear() < 2000) {
                console.warn(`[SyncManager] ⚠️ Podejrzany rok w dacie: ${date.getFullYear()}`);
                if (typeof dateString === 'number' && dateString > 1000000000000) {
                    date = new Date(dateString);
                    console.log(`[SyncManager] 🔧 Próba naprawy - używam timestamp w ms: ${date.toISOString()}`);
                }
            }

            const formattedDate = date.toLocaleDateString('pl-PL') + ' ' + date.toLocaleTimeString('pl-PL', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });

            console.log(`[SyncManager] ✅ Sformatowana data: ${formattedDate}`);
            return formattedDate;
            
        } catch (error) {
            console.error('[SyncManager] ❌ Błąd formatowania daty:', dateString, error);
            return `Błąd: ${dateString}`;
        }
    }

    formatMoney(amount) {
        if (amount === null || amount === undefined || isNaN(amount)) {
            return '0,00 zł';
        }
        
        return parseFloat(amount).toLocaleString('pl-PL', {
            style: 'currency',
            currency: 'PLN',
            minimumFractionDigits: 2
        });
    }

    getStatusColor(status) {
        const statusColors = {
            'new': '#28a745',
            'processing': '#ffc107',
            'shipped': '#17a2b8',
            'delivered': '#6f42c1',
            'cancelled': '#dc3545',
            'paid': '#20c997',
            'unpaid': '#fd7e14'
        };

        return statusColors[status?.toLowerCase()] || '#6c757d';
    }

    showError(message) {
        console.error('[SyncManager] 💥 Wyświetlanie błędu:', message);
        
        alert(message);
        
        if (window.reportsManager && window.reportsManager.showError) {
            window.reportsManager.showError(message);
        }
    }

    // =====================================================
    // PUBLICZNE API DLA KOMPATYBILNOŚCI
    // =====================================================

    isInProgress() {
        return this.isProcessing;
    }

    reset() {
        console.log('[SyncManager] 🔄 Manualny reset przez publiczne API');
        this.resetState();
        this.hideDaysModal();
        this.hideOrdersModal();
        this.hideGlobalLoading();
        
        // Usuń modal wymiarów jeśli istnieje
        const dimensionModal = document.getElementById('dimensionFixModal');
        if (dimensionModal) {
            dimensionModal.remove();
        }
    }

    debugSelectionState() {
        const checkboxes = document.querySelectorAll('#ordersList .order-select');
        const checkedBoxes = document.querySelectorAll('#ordersList .order-select:checked');

        console.log('[SyncManager] 🐛 DEBUG - Stan zaznaczenia:', {
            totalCheckboxes: checkboxes.length,
            checkedCheckboxes: checkedBoxes.length,
            selectedOrderIds: Array.from(this.selectedOrderIds),
            selectedOrderIdsSize: this.selectedOrderIds.size,
            actuallyChecked: Array.from(checkedBoxes).map(cb => cb.getAttribute('data-order-id'))
        });

        // Sprawdź czy są rozbieżności
        const actuallyChecked = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-order-id'));
        const selectedArray = Array.from(this.selectedOrderIds);

        const mismatch = selectedArray.length !== actuallyChecked.length ||
            !selectedArray.every(id => actuallyChecked.includes(id));

        if (mismatch) {
            console.warn('[SyncManager] ⚠️ ROZBIEŻNOŚĆ w stanie zaznaczenia!', {
                selectedOrderIds: selectedArray,
                actuallyChecked: actuallyChecked
            });
        }

        return {
            mismatch: mismatch,
            selectedOrderIds: selectedArray,
            actuallyChecked: actuallyChecked
        };
    }

    // NOWA METODA: Pokazywanie progressive loading
    showProgressiveLoading(stepText = 'Łączenie z Baselinker...', stepNumber = 1) {
        console.log(`[SyncManager] 🔄 Progressive loading: ${stepText} (krok ${stepNumber})`);

        const loadingOverlay = document.getElementById('modalBlSyncProgressiveLoading');
        const loadingText = document.getElementById('modalBlSyncLoadingText');
        const stepLabel = document.getElementById('modalBlSyncStepLabel');

        if (loadingOverlay) {
            loadingOverlay.style.display = 'flex';
        }

        if (loadingText) {
            loadingText.textContent = stepText;
        }

        if (stepLabel) {
            stepLabel.textContent = `Krok ${stepNumber} z 4`;
        }

        // Aktualizuj progress dots
        this.updateProgressDots(stepNumber);
    }

    // NOWA METODA: Aktualizacja progressive loading
    updateProgressiveLoading(stepText, stepNumber) {
        console.log(`[SyncManager] 🔄 Aktualizacja loading: ${stepText} (krok ${stepNumber})`);

        const loadingText = document.getElementById('modalBlSyncLoadingText');
        const stepLabel = document.getElementById('modalBlSyncStepLabel');

        if (loadingText) {
            // Smooth transition tekstu
            loadingText.style.opacity = '0.5';
            setTimeout(() => {
                loadingText.textContent = stepText;
                loadingText.style.opacity = '1';
            }, 150);
        }

        if (stepLabel) {
            stepLabel.textContent = `Krok ${stepNumber} z 4`;
        }

        // Aktualizuj progress dots
        this.updateProgressDots(stepNumber);
    }

    // NOWA METODA: Aktualizacja progress dots
    updateProgressDots(currentStep) {
        const dots = document.querySelectorAll('#modalBlSyncProgressDots .modal-bl-sync-progress-dot');

        dots.forEach((dot, index) => {
            const stepNumber = index + 1;

            // Usuń wszystkie klasy
            dot.classList.remove('active', 'completed');

            if (stepNumber < currentStep) {
                // Ukończone kroki
                dot.classList.add('completed');
            } else if (stepNumber === currentStep) {
                // Aktualny krok
                dot.classList.add('active');
            }
            // Pozostałe pozostają w domyślnym stanie (szare)
        });
    }

    // NOWA METODA: Ukrywanie progressive loading
    hideProgressiveLoading() {
        console.log('[SyncManager] ✅ Ukrywanie progressive loading');

        const loadingOverlay = document.getElementById('modalBlSyncProgressiveLoading');

        if (loadingOverlay) {
            // Płynne zniknięcie
            loadingOverlay.style.opacity = '0';
            setTimeout(() => {
                loadingOverlay.style.display = 'none';
                loadingOverlay.style.opacity = '1'; // Reset dla następnego użycia
            }, 300);
        }
    }

}

// =====================================================
// INICJALIZACJA GLOBALNEGO OBIEKTU
// =====================================================

// Aktualizacja inicializacji - sprawdź czy VolumeManager jest załadowany
document.addEventListener('DOMContentLoaded', function () {
    if (window.syncManager) return;
    // Poczekaj na załadowanie wszystkich zależności
    const initSyncManager = () => {
        if (window.volumeManager || document.getElementById('volumeModal')) {
            window.syncManager = new SyncManager();
            window.syncManager.init();
            console.log('[SyncManager] Inicjalizacja zakończona z obsługą objętości');
        } else {
            setTimeout(initSyncManager, 100);
        }
    };

    initSyncManager();
});

console.log('[SyncManager] 🌟 Kompletny nowy SyncManager z obsługą wymiarów załadowany - gotowy do użycia');