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
        this.ordersWithDimensionIssues = new Map(); // NOWE: Mapa zamówień z problemami wymiarów

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

        // KROK 2 - Modal zamówień
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

        // KROK 3 - Modal wymiarów
        this.dimensionsModal = document.getElementById('dimensionsModal');
        this.dimensionsList = document.getElementById('dimensionsList');
        this.dimensionsBackBtn = document.getElementById('dimensionsBack');
        this.dimensionsSkipBtn = document.getElementById('dimensionsSkip');
        this.dimensionsSaveBtn = document.getElementById('dimensionsSave');
        this.dimensionsCloseBtn = document.getElementById('dimensionsModalClose');

        // POPRAWKA: Loading overlay - dodaj brakujące elementy
        this.globalLoading = document.getElementById('syncLoadingOverlay');
        this.globalLoadingTitle = document.getElementById('syncLoadingTitle');
        this.globalLoadingText = document.getElementById('syncLoadingText');

        // Templates
        this.orderTemplate = document.getElementById('orderTemplate');
        this.dimensionOrderTemplate = document.getElementById('dimensionOrderTemplate');
        this.dimensionProductTemplate = document.getElementById('dimensionProductTemplate');

        // Walidacja podstawowych elementów
        const requiredElements = [
            'daysModal', 'daysSelect', 'daysConfirmBtn',
            'ordersModal', 'ordersLoadingState', 'ordersListContainer', 'ordersList',
            'ordersCount', 'selectAllBtn', 'deselectAllBtn', 'ordersSaveBtn',
            'dimensionsModal', 'dimensionsList', 'dimensionsBackBtn', 
            'dimensionsSkipBtn', 'dimensionsSaveBtn',
            'globalLoading', 'orderTemplate'
        ];

        const missingElements = requiredElements.filter(element => !this[element]);
        if (missingElements.length > 0) {
            console.error('[SyncManager] ❌ Brakujące wymagane elementy DOM:', missingElements);
            throw new Error(`Brakujące elementy DOM: ${missingElements.join(', ')}`);
        }

        console.log('[SyncManager] ✅ Wszystkie elementy DOM zacachowane');
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
        this.selectAllBtn.addEventListener('click', () => {
            console.log('[SyncManager] ☑️ Zaznaczanie wszystkich zamówień');
            this.selectAllOrders();
        });

        this.deselectAllBtn.addEventListener('click', () => {
            console.log('[SyncManager] ☐ Odznaczanie wszystkich zamówień');
            this.deselectAllOrders();
        });

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

        this.ordersSaveBtn.addEventListener('click', () => {
            console.log('[SyncManager] 💾 Zapisywanie wybranych zamówień');
            this.handleOrdersSave();
        });

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
        
        this.daysModal.style.display = 'flex';
        setTimeout(() => {
            this.daysModal.classList.add('show');
        }, 10);
    }

    hideDaysModal() {
        console.log('[SyncManager] 📅 Ukrywanie modala wyboru dni');
        
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
        console.log('[SyncManager] 📦 Pokazywanie modala zamówień');
        
        this.ordersModal.style.display = 'flex';
        setTimeout(() => {
            this.ordersModal.classList.add('show');
        }, 10);
        
        this.showOrdersLoading();
    }

    hideOrdersModal() {
        console.log('[SyncManager] 📦 Ukrywanie modala zamówień');
        
        this.ordersModal.classList.remove('show');
        setTimeout(() => {
            this.ordersModal.style.display = 'none';
        }, 300);
    }

    showOrdersLoading() {
        console.log('[SyncManager] ⏳ Pokazywanie loading state');
        
        this.ordersLoadingState.style.display = 'block';
        this.ordersListContainer.style.display = 'none';
        this.ordersEmptyState.style.display = 'none';
        this.ordersErrorState.style.display = 'none';
    }

    showOrdersList() {
        console.log('[SyncManager] 📋 Pokazywanie listy zamówień');
        
        this.ordersLoadingState.style.display = 'none';
        this.ordersListContainer.style.display = 'block';
        this.ordersEmptyState.style.display = 'none';
        this.ordersErrorState.style.display = 'none';
    }

    showOrdersEmpty() {
        console.log('[SyncManager] 📭 Pokazywanie pustego stanu');
        
        this.ordersLoadingState.style.display = 'none';
        this.ordersListContainer.style.display = 'none';
        this.ordersEmptyState.style.display = 'block';
        this.ordersErrorState.style.display = 'none';
    }

    showOrdersError(message) {
        console.log('[SyncManager] ❌ Pokazywanie stanu błędu:', message);
        
        this.ordersLoadingState.style.display = 'none';
        this.ordersListContainer.style.display = 'none';
        this.ordersEmptyState.style.display = 'none';
        this.ordersErrorState.style.display = 'block';
        
        const errorMessageEl = document.getElementById('errorMessage');
        if (errorMessageEl) {
            errorMessageEl.textContent = message;
        }
    }

    async fetchOrders() {
        console.log('[SyncManager] 🌐 Rozpoczęcie pobierania zamówień z automatyczną paginacją');
        console.log('[SyncManager] 📊 Parametry zapytania:', {
            dateFrom: this.dateFrom,
            dateTo: this.dateTo,
            selectedDays: this.selectedDays
        });

        try {
            const requestData = {
                date_from: this.dateFrom,
                date_to: this.dateTo,
                days_count: this.selectedDays,
                get_all_statuses: true
            };

            console.log('[SyncManager] 📤 Wysyłanie zapytania z paginacją:', requestData);

            const response = await fetch('/reports/api/fetch-orders-for-selection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });

            console.log('[SyncManager] 📥 Odpowiedź z serwera - status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[SyncManager] 📊 Dane z serwera (z paginacją):', result);

            if (result.success) {
                this.fetchedOrders = result.orders || [];
                console.log('[SyncManager] ✅ Pobrano zamówienia z paginacją:', this.fetchedOrders.length);
                
                if (result.pagination_info) {
                    console.log('[SyncManager] 📄 Info o paginacji:', result.pagination_info);
                }
                
                // Sprawdź problemy z wymiarami
                const ordersWithIssues = this.fetchedOrders.filter(order => order.has_dimension_issues);
                console.log('[SyncManager] ⚠️ Zamówienia z problemami wymiarów:', ordersWithIssues.length);
                
                if (this.fetchedOrders.length === 0) {
                    this.showOrdersEmpty();
                } else {
                    this.renderOrdersList();
                    this.showOrdersList();
                }
            } else {
                throw new Error(result.error || 'Błąd pobierania zamówień');
            }

        } catch (error) {
            console.error('[SyncManager] ❌ Błąd pobierania zamówień:', error);
            this.showOrdersError(`Błąd pobierania zamówień: ${error.message}`);
        }
    }

    renderOrdersList() {
        console.log('[SyncManager] 🎨 Renderowanie listy zamówień:', this.fetchedOrders.length);

        if (!this.orderTemplate) {
            console.error('[SyncManager] ❌ Brak template dla zamówień');
            return;
        }

        this.ordersList.innerHTML = '';
        this.selectedOrderIds.clear();

        this.fetchedOrders.forEach((order, index) => {
            console.log(`[SyncManager] 🎨 Renderowanie zamówienia ${index + 1}:`, order);
            this.renderSingleOrder(order);
        });

        this.updateOrdersCount();
        this.updateSaveButton();

        console.log('[SyncManager] ✅ Lista zamówień wyrenderowana');
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

    renderProductsList(orderElement, order) {
        const productsCountText = orderElement.querySelector('.products-count-text');
        const productsToggle = orderElement.querySelector('.products-toggle');
        const productsList = orderElement.querySelector('.products-list');

        if (!order.products || !Array.isArray(order.products)) {
            if (productsCountText) {
                productsCountText.textContent = 'Brak danych o produktach';
            }
            if (productsToggle) {
                productsToggle.style.display = 'none';
            }
            return;
        }

        const productsCount = order.products.length;
        const problemProducts = order.products_with_issues?.length || 0;

        // Ustaw licznik produktów
        if (productsCountText) {
            let countText = `${productsCount} ${productsCount === 1 ? 'produkt' : 'produktów'}`;
            if (problemProducts > 0) {
                countText += ` (${problemProducts} bez wymiarów)`;
            }
            productsCountText.textContent = countText;
        }

        // Ustaw toggle dla pokazywania/ukrywania produktów
        if (productsToggle && productsList) {
            productsToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = productsToggle.classList.contains('expanded');

                if (isExpanded) {
                    // Ukryj produkty
                    productsList.style.display = 'none';
                    productsToggle.classList.remove('expanded');
                    productsToggle.querySelector('.toggle-text').textContent = 'Pokaż produkty';
                } else {
                    // Pokaż produkty
                    productsList.style.display = 'block';
                    productsToggle.classList.add('expanded');
                    productsToggle.querySelector('.toggle-text').textContent = 'Ukryj produkty';

                    // Renderuj produkty jeśli jeszcze nie zostały wyrenderowane
                    if (productsList.children.length === 0) {
                        this.renderProductsInList(productsList, order);
                    }
                }
            });
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
        let productsTotal = 0;
        let deliveryPrice = parseFloat(order.delivery_price) || 0;

        // Oblicz sumę produktów z order.products jeśli istnieje
        if (order.products && Array.isArray(order.products)) {
            productsTotal = order.products.reduce((sum, product) => {
                const price = parseFloat(product.price_brutto) || 0;
                const quantity = parseInt(product.quantity) || 1;
                return sum + (price * quantity);
            }, 0);
        } else {
            // Jeśli nie ma szczegółów produktów, użyj order_value minus dostawa
            const orderValue = parseFloat(order.order_value) || 0;
            productsTotal = orderValue - deliveryPrice;
            if (productsTotal < 0) productsTotal = orderValue; // zabezpieczenie
        }

        const totalAmount = productsTotal + deliveryPrice;

        // Formatowanie kwot
        const formatCurrency = (amount) => {
            return `${amount.toFixed(2)} PLN`;
        };

        const result = {
            productsAmount: formatCurrency(productsTotal),
            deliveryAmount: formatCurrency(deliveryPrice),
            totalAmount: formatCurrency(totalAmount),
            productsTotal: productsTotal,
            deliveryPrice: deliveryPrice,
            totalAmountNum: totalAmount
        };

        console.log(`[SyncManager] 💰 Kwoty zamówienia ${order.order_id}:`, result);

        return result;
    }

    handleOrderCheckboxChange(orderId, isChecked) {
        console.log(`[SyncManager] ☑️ Zmiana checkbox zamówienia ${orderId}:`, isChecked);

        if (isChecked) {
            this.selectedOrderIds.add(orderId);
        } else {
            this.selectedOrderIds.delete(orderId);
        }

        this.updateSaveButton();
        console.log('[SyncManager] 📊 Aktualnie wybrane zamówienia:', Array.from(this.selectedOrderIds));
    }

    selectAllOrders() {
        console.log('[SyncManager] ☑️ Zaznaczanie wszystkich dostępnych zamówień');

        const availableCheckboxes = this.ordersList.querySelectorAll('.order-select:not(:disabled)');
        
        availableCheckboxes.forEach(checkbox => {
            checkbox.checked = true;
            this.selectedOrderIds.add(checkbox.getAttribute('data-order-id'));
        });

        this.updateSaveButton();
        console.log('[SyncManager] ✅ Zaznaczono wszystkie:', Array.from(this.selectedOrderIds));
    }

    deselectAllOrders() {
        console.log('[SyncManager] ☐ Odznaczanie wszystkich zamówień');

        const allCheckboxes = this.ordersList.querySelectorAll('.order-select');
        
        allCheckboxes.forEach(checkbox => {
            checkbox.checked = false;
        });

        this.selectedOrderIds.clear();
        this.updateSaveButton();
        console.log('[SyncManager] ✅ Odznaczono wszystkie zamówienia');
    }

    updateOrdersCount() {
        if (this.ordersCount) {
            this.ordersCount.textContent = this.fetchedOrders.length;
        }
    }

    updateSaveButton() {
        const selectedCount = this.selectedOrderIds.size;
        
        if (this.ordersSaveBtn) {
            this.ordersSaveBtn.disabled = selectedCount === 0;
            this.ordersSaveBtn.textContent = `Zapisz rekordy (${selectedCount})`;
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
        // Znajdź wszystkie inputy dla tego produktu
        const inputs = this.dimensionsList.querySelectorAll(
            `.dimension-input[data-order-id="${orderId}"][data-product-id="${productId}"]`
        );
        
        const dimensions = {};
        let hasAllDimensions = true;
        
        inputs.forEach(input => {
            const dimension = input.getAttribute('data-dimension');
            const value = parseFloat(input.value);
            
            if (!isNaN(value) && value > 0) {
                dimensions[dimension] = value;
            } else {
                hasAllDimensions = false;
            }
        });
        
        // Zapisz poprawki
        if (!this.dimensionFixes[orderId]) {
            this.dimensionFixes[orderId] = {};
        }
        this.dimensionFixes[orderId][productId] = dimensions;
        
        // Oblicz objętość jeśli mamy wszystkie wymiary
        const volumeElement = inputs[0].closest('.dimension-product-item').querySelector('.calculated-volume');
        
        if (hasAllDimensions && dimensions.length_cm && dimensions.width_cm && dimensions.thickness_cm) {
            const volume = (dimensions.length_cm / 100) * (dimensions.width_cm / 100) * (dimensions.thickness_cm / 100) * quantity;
            volumeElement.textContent = volume.toFixed(4) + ' m³';
            volumeElement.style.color = '#28a745';
        } else {
            volumeElement.textContent = 'Brak danych';
            volumeElement.style.color = '#6c757d';
        }
    }

    async saveSelectedOrders() {
        console.log('[SyncManager] 💾 Rozpoczynanie zapisu wybranych zamówień');

        if (this.selectedOrderIds.size === 0) {
            alert('Proszę wybrać co najmniej jedno zamówienie do zapisania.');
            return;
        }

        if (this.isProcessing) {
            console.log('[SyncManager] ⏳ Przetwarzanie już w toku, ignorowanie');
            return;
        }

        this.isProcessing = true;

        try {
            // Pobierz wybrane zamówienia
            const selectedOrders = this.fetchedOrders.filter(order =>
                this.selectedOrderIds.has(order.order_id.toString())
            );

            console.log('[SyncManager] 📊 Wybrane zamówienia do zapisu:', selectedOrders.length);

            // WAŻNE: Sprawdź czy są zamówienia z problemami wymiarów
            const ordersWithIssues = selectedOrders.filter(order => order.has_dimension_issues);

            if (ordersWithIssues.length > 0) {
                console.log('[SyncManager] ⚠️ Znaleziono zamówienia z problemami wymiarów:', ordersWithIssues.length);

                // Pokaż modal wymiarów (jeśli istnieje implementacja)
                alert(`Znaleziono ${ordersWithIssues.length} zamówień z problemami wymiarów. Funkcja modala wymiarów zostanie wdrożona.`);

                // TODO: Implementacja modala wymiarów
                // this.showDimensionsModal(ordersWithIssues);
                return;
            }

            // Jeśli nie ma problemów z wymiarami, zapisz normalnie
            await this.saveSelectedOrdersWithoutIssues(selectedOrders);

        } catch (error) {
            console.error('[SyncManager] ❌ Błąd podczas zapisu:', error);
            alert(`Wystąpił błąd: ${error.message}`);
        } finally {
            this.isProcessing = false;
        }
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
        
        let message = 'Synchronizacja zakończona pomyślnie!\n\n';
        message += `Zapisano: ${result.orders_added || 0} nowych zamówień\n`;
        message += `Zaktualizowano: ${result.orders_updated || 0} zamówień\n`;
        message += `Przetworzono łącznie: ${result.orders_processed || 0} zamówień`;
        
        alert(message);
        
        // Zamknij wszystkie modale i odśwież stronę
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
    }

    handleSaveError(error) {
        console.error('[SyncManager] ❌ Błąd zapisywania:', error);
        alert(`Błąd podczas zapisywania zamówień:\n${error.message}`);
    }

    // =====================================================
    // ZAPISYWANIE ZAMÓWIEŃ Z OBSŁUGĄ PROBLEMÓW WYMIARÓW
    // =====================================================

    async handleOrdersSave() {
        if (this.selectedOrderIds.size === 0) {
            console.warn('[SyncManager] ⚠️ Brak wybranych zamówień do zapisania');
            return;
        }

        if (this.isProcessing) {
            console.warn('[SyncManager] ⚠️ Proces zapisywania już trwa');
            return;
        }

        const selectedOrdersList = Array.from(this.selectedOrderIds);
        const ordersWithIssues = selectedOrdersList.filter(orderId => {
            const order = this.fetchedOrders.find(o => o.order_id == orderId);
            return order && order.has_dimension_issues;
        });

        console.log('[SyncManager] 📊 Analiza wybranych zamówień:', {
            total: selectedOrdersList.length,
            withIssues: ordersWithIssues.length
        });

        if (ordersWithIssues.length > 0) {
            console.log('[SyncManager] ⚠️ Znaleziono zamówienia z problemami wymiarów - pokazuję modal');
            this.showDimensionsModal(ordersWithIssues);
        } else {
            console.log('[SyncManager] ✅ Brak problemów z wymiarami - zapisuję bezpośrednio');
            await this.saveOrdersWithoutDimensions(selectedOrdersList);
        }
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

    showGlobalLoading(title, text) {
        if (this.globalLoading) {
            if (this.globalLoadingTitle) this.globalLoadingTitle.textContent = title;
            if (this.globalLoadingText) this.globalLoadingText.textContent = text;
            this.globalLoading.style.display = 'flex';
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
}

// =====================================================
// INICJALIZACJA GLOBALNEGO OBIEKTU
// =====================================================

console.log('[SyncManager] 🌟 Kompletny nowy SyncManager z obsługą wymiarów załadowany - gotowy do użycia');