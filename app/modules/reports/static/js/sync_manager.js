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

        console.log('[SyncManager] Event listeners setup complete');
    }

    /**
     * Pokazanie modala synchronizacji
     */
    async showSyncModal() {
        console.log('[SyncManager] Showing sync modal...');

        if (!this.syncModal) {
            console.error('[SyncManager] Sync modal not found');
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

        // NIE resetuj danych tutaj - przenieś na koniec synchronizacji
        // this.newOrders = [];
        // this.selectedOrders = [];
    }

    /**
     * Sprawdzenie nowych zamówień
     */
    async checkNewOrders() {
        console.log('[SyncManager] Checking for new orders...');

        try {
            // Pobierz aktualny zakres dat
            const dateRange = window.reportsManager ? window.reportsManager.getDateRange() : 'last_month';

            const response = await fetch(`/reports/api/check-new-orders?date_range=${dateRange}`);
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
     * Renderowanie pojedynczego zamówienia
     */
    renderOrderItem(order) {
        const totalNetFormatted = this.formatCurrency(order.total_net);
        const totalGrossFormatted = this.formatCurrency(order.total_gross);
        const deliveryFormatted = this.formatCurrency(order.delivery_price);

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
                        <i class="fas fa-calendar"></i> ${order.date_add} |
                        <i class="fas fa-user"></i> ${order.customer_name} |
                        <i class="fas fa-box"></i> ${order.products_count} produktów
                    </div>
                    
                    <div class="sync-order-products">
                        <strong>Produkty:</strong> ${order.products.join(', ')}
                    </div>
                </div>
                
                <div class="sync-order-summary">
                    <div class="sync-order-amount">
                        ${totalGrossFormatted} brutto
                    </div>
                    <div class="sync-order-amount text-muted">
                        ${totalNetFormatted} netto
                    </div>
                    ${order.delivery_price > 0 ? `
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
                this.toggleOrder(e.target.dataset.orderId, e.target.checked);
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
            this.toggleOrder(checkbox.dataset.orderId, checked);
        });

        this.updateConfirmButton();
    }

    /**
     * Zaznaczenie/odznaczenie pojedynczego zamówienia
     */
    toggleOrder(orderId, checked) {
        const orderIdNum = parseInt(orderId);

        console.log('[SyncManager] toggleOrder called:', { orderId, orderIdNum, checked, currentSelected: this.selectedOrders });

        if (checked) {
            if (!this.selectedOrders.includes(orderIdNum)) {
                this.selectedOrders.push(orderIdNum);
            }
        } else {
            const index = this.selectedOrders.indexOf(orderIdNum);
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
     * Wykonanie synchronizacji
     */
    async performSync() {
        // Skopiuj selectedOrders na początku - zabezpieczenie przed wyczyszczeniem
        const ordersToSync = [...this.selectedOrders];

        console.log('[SyncManager] Performing sync with orders:', ordersToSync);
        console.log('[SyncManager] this.selectedOrders:', this.selectedOrders);

        if (ordersToSync.length === 0) {
            this.showError('Nie wybrano żadnych zamówień do synchronizacji');
            return;
        }

        // Ukryj modal
        this.hideSyncModal();

        // Pokaż loading overlay
        this.showSyncLoading('Synchronizowanie zamówień...');

        try {
            const requestData = {
                date_range: window.reportsManager ? window.reportsManager.getDateRange() : 'last_month',
                selected_orders: ordersToSync  // Użyj kopii zamiast this.selectedOrders
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
            const result = await response.json();
            console.log('[SyncManager] Response data:', result);

            if (result.success) {
                console.log('[SyncManager] Sync completed successfully:', result);

                // Pokaż komunikat sukcesu
                this.showSyncLoading(`Synchronizacja zakończona pomyślnie!<br>
                    Dodano: ${result.orders_added || 0} zamówień<br>
                    Zaktualizowano: ${result.orders_updated || 0} zamówień`);

                // Ukryj loading po 3 sekundach
                setTimeout(() => {
                    this.hideSyncLoading();

                    // Reset danych po udanej synchronizacji
                    this.newOrders = [];
                    this.selectedOrders = [];

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
            const response = await fetch('/reports/api/check-new-orders?date_range=today');
            const result = await response.json();

            if (result.success && result.has_new_orders) {
                console.log('[SyncManager] Found new orders in background:', result.new_orders.length);

                // Można tutaj dodać notyfikację badge lub toast
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
}

// Export dla global scope
window.SyncManager = SyncManager;