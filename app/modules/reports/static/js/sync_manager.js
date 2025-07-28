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

        // KROK 2 - Modal z zamówieniami
        this.ordersModal = document.getElementById('syncOrdersModal');
        this.ordersLoadingState = document.getElementById('ordersLoadingState');
        this.ordersListContainer = document.getElementById('ordersListContainer');
        this.ordersList = document.getElementById('ordersList');
        this.ordersEmptyState = document.getElementById('ordersEmptyState');
        this.ordersErrorState = document.getElementById('ordersErrorState');
        this.ordersCount = document.getElementById('ordersCount');
        this.selectAllBtn = document.getElementById('selectAllOrders');
        this.deselectAllBtn = document.getElementById('deselectAllOrders');
        this.ordersBackBtn = document.getElementById('syncOrdersBack');
        this.ordersCancelBtn = document.getElementById('syncOrdersCancel');
        this.ordersSaveBtn = document.getElementById('syncOrdersSave');
        this.ordersCloseBtn = document.getElementById('syncOrdersModalClose');

        // Global loading
        this.globalLoading = document.getElementById('syncGlobalLoading');
        this.globalLoadingTitle = document.getElementById('syncGlobalLoadingTitle');
        this.globalLoadingText = document.getElementById('syncGlobalLoadingText');

        // Template
        this.orderTemplate = document.getElementById('orderItemTemplate');

        // Walidacja kluczowych elementów
        const requiredElements = [
            'daysModal', 'daysSelect', 'daysConfirmBtn',
            'ordersModal', 'ordersList', 'ordersSaveBtn'
        ];

        const missingElements = requiredElements.filter(elementName => !this[elementName]);
        
        if (missingElements.length > 0) {
            throw new Error(`Brakuje elementów DOM: ${missingElements.join(', ')}`);
        }

        console.log('[SyncManager] ✅ Wszystkie elementy DOM zostały znalezione');
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
        console.log('[SyncManager] 🌐 Rozpoczęcie pobierania zamówień z API');
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

            console.log('[SyncManager] 📤 Wysyłanie zapytania:', requestData);

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
            console.log('[SyncManager] 📊 Dane z serwera:', result);

            if (result.success) {
                this.fetchedOrders = result.orders || [];
                console.log('[SyncManager] ✅ Pobrano zamówienia:', this.fetchedOrders.length);
                
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
        orderItem.setAttribute('data-order-id', order.order_id);
        
        // NOWE: Obsługa zamówień z problemami wymiarów
        if (order.has_dimension_issues) {
            orderItem.classList.add('has-dimension-issues');
            console.log(`[SyncManager] ⚠️ Zamówienie ${order.order_id} ma problemy z wymiarami:`, order.products_with_issues);
            
            this.ordersWithDimensionIssues.set(order.order_id, {
                order: order,
                products_with_issues: order.products_with_issues || []
            });
        }
        
        const checkbox = orderElement.querySelector('.order-select');
        checkbox.setAttribute('data-order-id', order.order_id);
        
        if (order.exists_in_db) {
            console.log(`[SyncManager] ⚠️ Zamówienie ${order.order_id} już istnieje w bazie`);
            orderItem.classList.add('disabled');
            checkbox.disabled = true;
            orderElement.querySelector('.exists-badge').style.display = 'flex';
        } else {
            checkbox.addEventListener('change', (e) => {
                this.handleOrderCheckboxChange(order.order_id, e.target.checked);
            });
        }

        // Wypełnij dane zamówienia
        orderElement.querySelector('.order-number').textContent = order.order_id;
        
        // NOWE: Dodaj badge z problemami wymiarów
        const orderIdContainer = orderElement.querySelector('.order-id');
        if (order.has_dimension_issues) {
            const dimensionBadge = document.createElement('span');
            dimensionBadge.className = 'dimension-issues-badge';
            dimensionBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Brak wymiarów';
            orderIdContainer.appendChild(dimensionBadge);
        }
        
        orderElement.querySelector('.order-date-text').textContent = this.formatDateTime(order.date_add);
        orderElement.querySelector('.customer-name').textContent = order.customer_name || 'Brak danych';
        
        const productsListElement = orderElement.querySelector('.products-list');
        productsListElement.textContent = order.products_summary || 'Brak produktów';
        
        orderElement.querySelector('.products-amount').textContent = this.formatMoney(order.order_value || 0);
        orderElement.querySelector('.delivery-amount').textContent = this.formatMoney(order.delivery_price || 0);
        orderElement.querySelector('.total-amount').textContent = this.formatMoney((order.order_value || 0) + (order.delivery_price || 0));
        
        const statusBadge = orderElement.querySelector('.order-status-badge');
        statusBadge.textContent = order.order_status || 'Nieznany';
        statusBadge.style.backgroundColor = this.getStatusColor(order.order_status);

        // Przycisk Baselinker
        const baselinkerBtn = orderElement.querySelector('.baselinker-btn');
        if (baselinkerBtn) {
            baselinkerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const baselinkerUrl = `https://panel-f.baselinker.com/orders.php#order:${order.order_id}`;
                window.open(baselinkerUrl, '_blank');
                console.log(`[SyncManager] 🔗 Otwieranie Baselinker dla zamówienia ${order.order_id}`);
            });
        }

        this.ordersList.appendChild(orderElement);
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
        const ordersWithIssues = selectedOrdersList.filter(orderId => 
            this.ordersWithDimensionIssues.has(orderId)
        );

        console.log('[SyncManager] 📋 Analiza wybranych zamówień:', {
            total: selectedOrdersList.length,
            withIssues: ordersWithIssues.length,
            problemOrders: ordersWithIssues
        });

        if (ordersWithIssues.length > 0) {
            console.log('[SyncManager] ⚠️ Znaleziono zamówienia z problemami wymiarów - pokazuję modal uzupełnienia');
            this.showDimensionFixModal(ordersWithIssues, selectedOrdersList);
            return;
        }

        console.log('[SyncManager] ✅ Wszystkie zamówienia mają wymiary - zapisuję bezpośrednio');
        await this.performOrdersSave(selectedOrdersList);
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
                            <small class="volume-help">Wpisz objętość dla tej pozycji w m³</small>
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
        console.log('[SyncManager] ⏳ Pokazywanie globalnego loading:', title);

        if (this.globalLoadingTitle) this.globalLoadingTitle.textContent = title;
        if (this.globalLoadingText) this.globalLoadingText.textContent = text;
        
        if (this.globalLoading) {
            this.globalLoading.style.display = 'flex';
        }
    }

    hideGlobalLoading() {
        console.log('[SyncManager] ⏳ Ukrywanie globalnego loading');

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