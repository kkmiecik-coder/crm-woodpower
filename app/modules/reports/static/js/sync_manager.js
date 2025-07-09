// modules/reports/static/js/sync_manager.js
/**
 * Manager synchronizacji z Baselinker
 * Odpowiedzialny za sprawdzanie nowych zamówień i synchronizację
 */

class SyncManager {
    constructor() {
        this.syncModal = null;
        this.syncModalContent = null;
        this.syncLoadingOverlay = null;
        this.syncLoadingText = null;
        this.isSync = false;
        this.newOrders = [];
        this.selectedOrders = [];

        // POPRAWKA: Dodano elementy przycisków
        this.syncModalCancel = null;
        this.syncModalConfirm = null;

        console.log('[SyncManager] Initialized');
    }

    /**
     * Inicjalizacja managera
     */
    init() {
        console.log('[SyncManager] Starting initialization...');

        this.cacheElements();
        this.setupEventListeners();

        console.log('[SyncManager] Initialization complete');
    }

    /**
     * Cache elementów DOM
     */
    cacheElements() {
        this.syncModal = document.getElementById('syncModal');
        this.syncModalContent = document.getElementById('syncModalContent');
        this.syncLoadingOverlay = document.getElementById('syncLoadingOverlay');
        this.syncLoadingText = document.getElementById('syncLoadingText');

        // Przyciski modala
        this.syncModalCancel = document.getElementById('syncModalCancel');
        this.syncModalConfirm = document.getElementById('syncModalConfirm');

        console.log('[SyncManager] Elements cached');
    }

    /**
     * Ustawienie event listenerów
     */
    setupEventListeners() {
        // Zamknięcie modala
        if (this.syncModal) {
            const closeBtn = this.syncModal.querySelector('.close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.hideSyncModal());
            }

            // Kliknięcie poza modalem
            this.syncModal.addEventListener('click', (e) => {
                if (e.target === this.syncModal) {
                    this.hideSyncModal();
                }
            });
        }

        // Przycisk anuluj
        if (this.syncModalCancel) {
            this.syncModalCancel.addEventListener('click', () => {
                this.hideSyncModal();
            });
        }

        // Przycisk synchronizuj
        if (this.syncModalConfirm) {
            this.syncModalConfirm.addEventListener('click', () => {
                this.performSync();
            });
        }

        // POPRAWKA: Dodano obsługę klawisza Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.syncModal && this.syncModal.style.display === 'block') {
                this.hideSyncModal();
            }
        });

        console.log('[SyncManager] Event listeners setup complete');
    }

    /**
     * Pokazanie modala synchronizacji
     */
    async showSyncModal() {
        console.log('[SyncManager] Showing sync modal...');

        if (!this.syncModal) {
            console.error('[SyncManager] Sync modal not found');
            this.showError('Modal synchronizacji nie został znaleziony');
            return;
        }

        // POPRAWKA: Sprawdź czy już trwa synchronizacja
        if (this.isSync) {
            console.log('[SyncManager] Sync already in progress');
            this.showError('Synchronizacja już trwa');
            return;
        }

        // Pokaż loading
        this.showSyncLoading('Sprawdzanie nowych zamówień...');

        try {
            // Sprawdź nowe zamówienia
            await this.checkNewOrders();

            // Ukryj loading
            this.hideSyncLoading();

            // Pokaż modal
            this.syncModal.classList.add('show');
            this.syncModal.style.display = 'block';

        } catch (error) {
            this.hideSyncLoading();
            console.error('[SyncManager] Error showing sync modal:', error);
            this.showError('Błąd sprawdzania nowych zamówień: ' + error.message);
        }
    }

    /**
     * Ukrycie modala synchronizacji
     */
    hideSyncModal() {
        console.log('[SyncManager] Hiding sync modal');

        if (this.syncModal) {
            this.syncModal.classList.remove('show');
            this.syncModal.style.display = 'none';
        }

        // Reset danych po ukryciu modala
        this.newOrders = [];
        this.selectedOrders = [];
        this.isSync = false; // POPRAWKA: Reset flagi synchronizacji
    }

    /**
     * Sprawdzenie nowych zamówień
     */
    async checkNewOrders() {
        console.log('[SyncManager] Checking for new orders...');

        try {
            // Pobierz aktualny zakres dat z ReportsManager
            const dateRange = this.getCurrentDateRange();

            const params = new URLSearchParams();
            if (dateRange.date_from) {
                params.append('date_from', dateRange.date_from);
            }
            if (dateRange.date_to) {
                params.append('date_to', dateRange.date_to);
            }

            const response = await fetch(`/reports/api/check-new-orders?${params}`);

            // POPRAWKA: Sprawdź status HTTP
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Błąd sprawdzania zamówień');
            }

            this.newOrders = result.new_orders || [];
            this.selectedOrders = this.newOrders.map(order => order.order_id); // Domyślnie wszystkie zaznaczone

            console.log('[SyncManager] Found new orders:', this.newOrders.length);

            // Aktualizuj zawartość modala
            this.updateModalContent(result);

            return result;

        } catch (error) {
            console.error('[SyncManager] Error checking new orders:', error);
            throw error;
        }
    }

    /**
     * Pobieranie bieżącego zakresu dat
     */
    getCurrentDateRange() {
        if (window.reportsManager && typeof window.reportsManager.getCurrentDateRange === 'function') {
            return window.reportsManager.getCurrentDateRange();
        }

        // Fallback - ostatni miesiąc
        const today = new Date();
        const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        return {
            date_from: lastMonth.toISOString().split('T')[0],
            date_to: today.toISOString().split('T')[0]
        };
    }

    /**
     * Aktualizacja zawartości modala
     */
    updateModalContent(result) {
        if (!this.syncModalContent) return;

        if (!result.has_new_orders) {
            // Brak nowych zamówień
            this.syncModalContent.innerHTML = this.renderNoNewOrders();
            this.updateModalButtons(false);
        } else {
            // Mamy nowe zamówienia
            this.syncModalContent.innerHTML = this.renderNewOrdersList(result);
            this.updateModalButtons(true);
            this.setupOrderSelection();
        }
    }

    /**
     * Renderowanie komunikatu o braku nowych zamówień
     */
    renderNoNewOrders() {
        return `
            <div class="no-new-orders">
                <i class="fas fa-check-circle"></i>
                <h4>Brak nowych zamówień</h4>
                <p>Wszystkie zamówienia z wybranego zakresu dat są już zsynchronizowane.</p>
            </div>
        `;
    }

    /**
     * Renderowanie listy nowych zamówień
     */
    renderNewOrdersList(result) {
        const { new_orders, total_orders, existing_orders } = result;

        let html = `
            <div class="sync-summary">
                <h4>Znaleziono nowe zamówienia</h4>
                <p>
                    <strong>Łącznie zamówień:</strong> ${total_orders} | 
                    <strong>Już zsynchronizowane:</strong> ${existing_orders} | 
                    <strong>Nowe:</strong> ${new_orders.length}
                </p>
            </div>
            
            <div class="sync-orders-controls">
                <label>
                    <input type="checkbox" id="selectAllOrders" checked>
                    Zaznacz wszystkie
                </label>
            </div>
            
            <div class="sync-orders-list">
        `;

        new_orders.forEach(order => {
            html += this.renderOrderItem(order);
        });

        html += '</div>';

        return html;
    }

    /**
     * Renderowanie pojedynczego zamówienia - POPRAWKA: Bezpieczniejsze renderowanie
     */
    renderOrderItem(order) {
        const totalNetFormatted = this.formatCurrency(order.total_net);
        const totalGrossFormatted = this.formatCurrency(order.total_gross);
        const deliveryFormatted = this.formatCurrency(order.delivery_price);

        // POPRAWKA: Bezpieczne renderowanie produktów
        const products = order.products || [];
        const productsDisplay = products.length > 0 ? products.slice(0, 3).join(', ') : 'Brak produktów';
        const moreProductsIndicator = products.length > 3 ? '...' : '';

        return `
            <div class="sync-order-item">
                <div class="sync-order-checkbox">
                    <input type="checkbox" 
                           class="order-checkbox" 
                           data-order-id="${order.order_id}" 
                           checked>
                </div>
                
                <div class="sync-order-details">
                    <div class="sync-order-title">
                        Zamówienie #${order.order_id}
                        ${order.internal_number ? `(${order.internal_number})` : ''}
                    </div>
                    
                    <div class="sync-order-meta">
                        <i class="fas fa-calendar"></i> ${order.date_add || 'Brak daty'} |
                        <i class="fas fa-user"></i> ${order.customer_name || 'Nieznany klient'} |
                        <i class="fas fa-box"></i> ${products.length} produktów
                    </div>
                    
                    <div class="sync-order-products">
                        <strong>Produkty:</strong> ${productsDisplay}${moreProductsIndicator}
                    </div>
                </div>
                
                <div class="sync-order-summary">
                    <div class="sync-order-amount">
                        ${totalGrossFormatted} brutto
                    </div>
                    <div class="sync-order-amount text-muted">
                        ${totalNetFormatted} netto
                    </div>
                    ${(order.delivery_price && order.delivery_price > 0) ? `
                        <div class="sync-order-delivery">
                            + ${deliveryFormatted} dostawa
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Ustawienie obsługi zaznaczania zamówień
     */
    setupOrderSelection() {
        // Checkbox "Zaznacz wszystkie"
        const selectAllCheckbox = document.getElementById('selectAllOrders');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                this.toggleAllOrders(e.target.checked);
            });
        }

        // Checkboxy poszczególnych zamówień
        const orderCheckboxes = document.querySelectorAll('.order-checkbox');
        orderCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                this.toggleOrder(parseInt(e.target.dataset.orderId), e.target.checked);
                this.updateSelectAllState();
            });
        });

        console.log('[SyncManager] Order selection setup complete');
    }

    /**
     * Zaznaczenie/odznaczenie wszystkich zamówień
     */
    toggleAllOrders(checked) {
        console.log('[SyncManager] Toggle all orders:', checked);

        const orderCheckboxes = document.querySelectorAll('.order-checkbox');
        orderCheckboxes.forEach(checkbox => {
            checkbox.checked = checked;
            this.toggleOrder(parseInt(checkbox.dataset.orderId), checked);
        });

        this.updateConfirmButton();
    }

    /**
     * Zaznaczenie/odznaczenie pojedynczego zamówienia
     */
    toggleOrder(orderId, checked) {
        console.log('[SyncManager] toggleOrder called:', { orderId, checked, currentSelected: this.selectedOrders });

        if (checked) {
            if (!this.selectedOrders.includes(orderId)) {
                this.selectedOrders.push(orderId);
            }
        } else {
            const index = this.selectedOrders.indexOf(orderId);
            if (index > -1) {
                this.selectedOrders.splice(index, 1);
            }
        }

        console.log('[SyncManager] Selected orders after toggle:', this.selectedOrders);
        this.updateConfirmButton();
    }

    /**
     * Aktualizacja stanu checkbox "Zaznacz wszystkie"
     */
    updateSelectAllState() {
        const selectAllCheckbox = document.getElementById('selectAllOrders');
        if (!selectAllCheckbox) return;

        const orderCheckboxes = document.querySelectorAll('.order-checkbox');
        const checkedCount = document.querySelectorAll('.order-checkbox:checked').length;

        if (checkedCount === 0) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        } else if (checkedCount === orderCheckboxes.length) {
            selectAllCheckbox.checked = true;
            selectAllCheckbox.indeterminate = false;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = true;
        }
    }

    /**
     * Aktualizacja przycisków modala
     */
    updateModalButtons(hasNewOrders) {
        if (this.syncModalConfirm) {
            this.syncModalConfirm.style.display = hasNewOrders ? 'block' : 'none';
        }

        if (this.syncModalCancel) {
            this.syncModalCancel.textContent = hasNewOrders ? 'Anuluj' : 'OK';
        }

        this.updateConfirmButton();
    }

    /**
     * Aktualizacja przycisku potwierdzenia
     */
    updateConfirmButton() {
        if (!this.syncModalConfirm) return;

        const selectedCount = this.selectedOrders.length;

        if (selectedCount === 0) {
            this.syncModalConfirm.disabled = true;
            this.syncModalConfirm.textContent = 'Synchronizuj';
        } else {
            this.syncModalConfirm.disabled = false;
            this.syncModalConfirm.textContent = `Synchronizuj (${selectedCount})`;
        }
    }

    /**
     * Wykonanie synchronizacji - POPRAWKA: Lepsza obsługa błędów
     */
    async performSync() {
        // Skopiuj selectedOrders na początku - zabezpieczenie przed wyczyszczeniem
        const ordersToSync = [...this.selectedOrders];

        console.log('[SyncManager] Performing sync with orders:', ordersToSync);

        if (ordersToSync.length === 0) {
            this.showError('Nie wybrano żadnych zamówień do synchronizacji');
            return;
        }

        // POPRAWKA: Sprawdź czy już trwa synchronizacja
        if (this.isSync) {
            console.log('[SyncManager] Sync already in progress');
            return;
        }

        // Ustaw flagę synchronizacji
        this.isSync = true;

        // Ukryj modal
        this.hideSyncModal();

        // Pokaż loading overlay
        this.showSyncLoading('Synchronizowanie zamówień...');

        try {
            // Pobierz zakres dat
            const dateRange = this.getCurrentDateRange();

            const requestData = {
                date_from: dateRange.date_from,
                date_to: dateRange.date_to,
                selected_orders: ordersToSync
            };

            console.log('[SyncManager] Sending request data:', requestData);

            const response = await fetch('/reports/api/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });

            console.log('[SyncManager] Response status:', response.status);

            // POPRAWKA: Sprawdź status HTTP
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[SyncManager] Response data:', result);

            if (result.success) {
                console.log('[SyncManager] Sync completed successfully:', result);

                // Pokaż komunikat sukcesu
                this.showSyncLoading(`
                    <div style="text-align: center;">
                        <i class="fas fa-check-circle" style="color: #28a745; font-size: 2rem; margin-bottom: 1rem;"></i>
                        <h4>Synchronizacja zakończona pomyślnie!</h4>
                        <p>Dodano: ${result.orders_added || 0} zamówień</p>
                        <p>Zaktualizowano: ${result.orders_updated || 0} zamówień</p>
                    </div>
                `);

                // Ukryj loading po 3 sekundach
                setTimeout(() => {
                    this.hideSyncLoading();

                    // Odśwież dane
                    if (window.reportsManager) {
                        window.reportsManager.refreshData();
                    }
                }, 3000);

            } else {
                throw new Error(result.error || 'Błąd synchronizacji');
            }

        } catch (error) {
            console.error('[SyncManager] Sync error:', error);
            this.hideSyncLoading();
            this.showError('Błąd synchronizacji: ' + error.message);
        } finally {
            // POPRAWKA: Zawsze resetuj flagę synchronizacji
            this.isSync = false;
        }
    }

    /**
     * Pokazanie loading overlay
     */
    showSyncLoading(message) {
        if (this.syncLoadingOverlay) {
            this.syncLoadingOverlay.classList.remove('hidden');
        }

        if (this.syncLoadingText) {
            this.syncLoadingText.innerHTML = message;
        }

        console.log('[SyncManager] Showing sync loading:', message);
    }

    /**
     * Ukrycie loading overlay
     */
    hideSyncLoading() {
        if (this.syncLoadingOverlay) {
            this.syncLoadingOverlay.classList.add('hidden');
        }

        console.log('[SyncManager] Hiding sync loading');
    }

    /**
     * Pokazanie błędu
     */
    showError(message) {
        console.error('[SyncManager] Error:', message);
        alert('Błąd: ' + message); // TODO: Lepszy system notyfikacji
    }

    /**
     * Formatowanie waluty
     */
    formatCurrency(value) {
        if (value === null || value === undefined) return '0.00 zł';
        const num = parseFloat(value);
        if (isNaN(num)) return '0.00 zł';
        return num.toFixed(2) + ' zł';
    }

    /**
     * Publiczne API dla automatycznego sprawdzania
     */
    async checkForNewOrdersInBackground() {
        console.log('[SyncManager] Background check for new orders...');

        try {
            // Sprawdź tylko dzisiejsze zamówienia w tle
            const today = new Date().toISOString().split('T')[0];
            const params = new URLSearchParams({
                date_from: today,
                date_to: today
            });

            const response = await fetch(`/reports/api/check-new-orders?${params}`);

            // POPRAWKA: Sprawdź status HTTP
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.success && result.has_new_orders) {
                console.log('[SyncManager] Found new orders in background:', result.new_orders.length);

                // Aktualizuj badge z nowymi zamówieniami
                this.updateNewOrdersBadge(result.new_orders.length);

                return result.new_orders.length;
            }

            return 0;

        } catch (error) {
            console.error('[SyncManager] Background check error:', error);
            return 0;
        }
    }

    /**
     * Aktualizacja badge z nowymi zamówieniami
     */
    updateNewOrdersBadge(count) {
        const badge = document.querySelector('.new-orders-badge');
        if (badge) {
            if (count > 0) {
                badge.textContent = `${count} nowych zamówień`;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }

        console.log('[SyncManager] Updated new orders badge:', count);
    }

    /**
     * Rozpoczęcie automatycznego sprawdzania (co 30 minut)
     */
    startBackgroundCheck() {
        console.log('[SyncManager] Starting background check...');

        // Sprawdź od razu
        this.checkForNewOrdersInBackground();

        // Następnie co 30 minut
        setInterval(() => {
            this.checkForNewOrdersInBackground();
        }, 30 * 60 * 1000); // 30 minut
    }

    /**
     * Synchronizacja z konkretnym zakresem dat - POPRAWKA: Lepsza obsługa błędów
     */
    async syncWithDateRange(dateFrom, dateTo) {
        console.log('[SyncManager] Manual sync with date range:', dateFrom, dateTo);

        // POPRAWKA: Sprawdź czy już trwa synchronizacja
        if (this.isSync) {
            console.log('[SyncManager] Sync already in progress');
            this.showError('Synchronizacja już trwa');
            return;
        }

        this.isSync = true;
        this.showSyncLoading('Synchronizowanie z wybranym zakresem dat...');

        try {
            const requestData = {
                date_from: dateFrom,
                date_to: dateTo,
                selected_orders: [] // Puste - zsynchronizuj wszystkie nowe z zakresu
            };

            const response = await fetch('/reports/api/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });

            // POPRAWKA: Sprawdź status HTTP
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.success) {
                this.showSyncLoading(`
                    <div style="text-align: center;">
                        <i class="fas fa-check-circle" style="color: #28a745; font-size: 2rem; margin-bottom: 1rem;"></i>
                        <h4>Synchronizacja zakończona!</h4>
                        <p>Dodano: ${result.orders_added || 0} zamówień</p>
                    </div>
                `);

                setTimeout(() => {
                    this.hideSyncLoading();
                    if (window.reportsManager) {
                        window.reportsManager.refreshData();
                    }
                }, 2000);

            } else {
                throw new Error(result.error || 'Błąd synchronizacji');
            }

        } catch (error) {
            console.error('[SyncManager] Manual sync error:', error);
            this.hideSyncLoading();
            this.showError('Błąd synchronizacji: ' + error.message);
        } finally {
            // POPRAWKA: Zawsze resetuj flagę synchronizacji
            this.isSync = false;
        }
    }

    /**
     * Sprawdzenie czy synchronizacja jest w toku
     */
    isSyncInProgress() {
        return this.isSync;
    }

    /**
     * NOWA METODA - Anulowanie synchronizacji
     */
    cancelSync() {
        console.log('[SyncManager] Canceling sync...');
        this.isSync = false;
        this.hideSyncLoading();
        this.hideSyncModal();
    }

    /**
     * NOWA METODA - Walidacja stanu managera
     */
    validateState() {
        const issues = [];

        if (!this.syncModal) {
            issues.push('Missing sync modal element');
        }

        if (!this.syncModalContent) {
            issues.push('Missing sync modal content element');
        }

        if (!this.syncLoadingOverlay) {
            issues.push('Missing sync loading overlay element');
        }

        return {
            isValid: issues.length === 0,
            issues: issues
        };
    }

    /**
     * NOWA METODA - Reset stanu managera
     */
    resetState() {
        console.log('[SyncManager] Resetting state...');

        this.isSync = false;
        this.newOrders = [];
        this.selectedOrders = [];
        this.hideSyncModal();
        this.hideSyncLoading();
    }

    /**
     * Debug info - POPRAWKA: Rozszerzone informacje
     */
    getDebugInfo() {
        const validation = this.validateState();

        return {
            newOrders: this.newOrders.length,
            selectedOrders: this.selectedOrders.length,
            isSync: this.isSync,
            modalVisible: this.syncModal ? (this.syncModal.style.display === 'block') : false,
            loadingVisible: this.syncLoadingOverlay ? !this.syncLoadingOverlay.classList.contains('hidden') : false,
            validation: validation,
            elements: {
                syncModal: !!this.syncModal,
                syncModalContent: !!this.syncModalContent,
                syncLoadingOverlay: !!this.syncLoadingOverlay,
                syncModalCancel: !!this.syncModalCancel,
                syncModalConfirm: !!this.syncModalConfirm
            }
        };
    }
}

// Export dla global scope
window.SyncManager = SyncManager;