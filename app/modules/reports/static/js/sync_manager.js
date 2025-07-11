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
            // ZMIANA: Nie używaj żadnych filtrów dat - sprawdź wszystkie zamówienia
            console.log('[SyncManager] Sprawdzanie wszystkich nowych zamówień (bez filtrów dat)');

            // Wywołaj API bez żadnych parametrów dat
            const url = '/reports/api/check-new-orders';
            console.log('[SyncManager] Checking new orders URL:', url);

            const response = await fetch(url);

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
            console.log('[SyncManager] Sprawdzono wszystkie zamówienia w Baselinker (bez ograniczeń dat)');

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
        // ZMIANA: SyncManager zawsze sprawdza wszystkie zamówienia
        // Ignoruje filtry dat ustawione przez użytkownika w interfejsie
        console.log('[SyncManager] SyncManager ignoruje filtry dat - sprawdza wszystkie zamówienia');

        return {
            date_from: null,
            date_to: null
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

            // NOWE: Dodaj obsługę przycisku "Odśwież wszystkie zamówienia"
            this.setupRefreshAllButton();
        } else {
            // Mamy nowe zamówienia
            this.syncModalContent.innerHTML = this.renderNewOrdersList(result);
            this.updateModalButtons(true);
            this.setupOrderSelection();
        }
    }

    /**
     * NOWA METODA: Konfiguracja przycisku odświeżania wszystkich zamówień
     */
    setupRefreshAllButton() {
        const refreshBtn = document.getElementById('syncAllOrdersBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.performRefreshAllOrders();
            });
            console.log('[SyncManager] Setup refresh all orders button');
        }
    }

    /**
     * NOWA METODA: Wykonanie odświeżenia wszystkich zamówień
     */
    async performRefreshAllOrders() {
        console.log('[SyncManager] Performing refresh all orders...');

        // POPRAWKA: Sprawdź czy już trwa synchronizacja
        if (this.isSync) {
            console.log('[SyncManager] Sync already in progress');
            this.showError('Synchronizacja już trwa');
            return;
        }

        // Ustaw flagę synchronizacji
        this.isSync = true;

        // Ukryj modal
        this.hideSyncModal();

        // Pokaż loading overlay
        this.showSyncLoading('Odświeżanie wszystkich zamówień...');

        try {
            // Wyślij zapytanie bez selected_orders (synchronizuj wszystkie)
            const requestData = {
                selected_orders: [] // Puste - oznacza wszystkie zamówienia
            };

            console.log('[SyncManager] Sending refresh all request');

            const response = await fetch('/reports/api/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });

            console.log('[SyncManager] Refresh response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.success) {
                this.showSyncLoading(`
                <div style="text-align: center;">
                    <i class="fas fa-check-circle" style="color: #28a745; font-size: 2rem; margin-bottom: 1rem;"></i>
                    <h4>Odświeżenie zakończone!</h4>
                    <p>Wszystkie zamówienia zostały zsynchronizowane</p>
                    <p>Przetworzono: ${result.orders_processed || 0} zamówień</p>
                    <p>Dodano: ${result.orders_added || 0} nowych rekordów</p>
                    <p>Zaktualizowano: ${result.orders_updated || 0} zamówień</p>
                </div>
            `);

                setTimeout(() => {
                    this.hideSyncLoading();
                    if (window.reportsManager) {
                        window.reportsManager.refreshData();
                    }
                }, 3000);

            } else {
                throw new Error(result.error || 'Błąd odświeżania');
            }

        } catch (error) {
            console.error('[SyncManager] Refresh all error:', error);
            this.hideSyncLoading();
            this.showError('Błąd odświeżania zamówień: ' + error.message);
        } finally {
            // POPRAWKA: Zawsze resetuj flagę synchronizacji
            this.isSync = false;
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
            <p>Wszystkie zamówienia są już zsynchronizowane lub nie ma nowych zamówień w Baselinker.</p>
            <div class="sync-options" style="margin-top: 1rem;">
                <button id="syncAllOrdersBtn" class="btn btn-primary">
                    <i class="fas fa-sync-alt"></i>
                    Odśwież wszystkie zamówienia
                </button>
            </div>
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
     * Wykonanie synchronizacji - POPRAWKA: Ignoruje filtry dat przy synchronizacji
     */
    async performSync() {
        // Skopiuj selectedOrders na początku - zabezpieczenie przed wyczyszczeniem
        const ordersToSync = [...this.selectedOrders];

        console.log('[SyncManager] Performing sync with orders:', ordersToSync);

        // ZMIANA: Jeśli nie ma wybranych zamówień, synchronizuj wszystkie
        if (ordersToSync.length === 0) {
            console.log('[SyncManager] No selected orders - syncing all orders');
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
        const loadingMessage = ordersToSync.length > 0 ?
            `Synchronizowanie ${ordersToSync.length} zamówień...` :
            'Synchronizowanie wszystkich zamówień...';
        this.showSyncLoading(loadingMessage);

        try {
            // ZMIANA: Nie wysyłaj żadnych filtrów dat - synchronizuj wszystkie
            const requestData = {
                selected_orders: ordersToSync
                // USUNIĘTO: date_from i date_to - SyncManager ignoruje filtry dat
            };

            console.log('[SyncManager] Sending request data (bez filtrów dat):', requestData);

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

            if (result.success) {
                // ZMIANA: Lepsze komunikaty w zależności od wyniku synchronizacji
                let message;
                let detailsHtml = '';

                const ordersProcessed = result.orders_processed || 0;
                const ordersAdded = result.orders_added || 0;
                const ordersUpdated = result.orders_updated || 0;
                const missingOrders = result.missing_orders_count || 0;
                const failedOrders = result.failed_orders_count || 0;

                if (ordersToSync.length > 0) {
                    // Synchronizacja wybranych zamówień
                    if (ordersProcessed > 0) {
                        message = `Zsynchronizowano ${ordersProcessed} z ${ordersToSync.length} wybranych zamówień`;
                    } else if (missingOrders > 0) {
                        message = `Zamówienia już nie istnieją w Baselinker`;
                        detailsHtml = `<p style="color: #856404;">Wszystkie ${missingOrders} zamówień zostało usuniętych z Baselinker lub ma wykluczony status</p>`;
                    } else {
                        message = `Sprawdzono ${ordersToSync.length} wybranych zamówień`;
                    }
                } else {
                    // Synchronizacja wszystkich zamówień
                    if (ordersProcessed > 0) {
                        message = `Zsynchronizowano wszystkie zamówienia`;
                    } else {
                        message = `Sprawdzono wszystkie zamówienia`;
                    }
                }

                // ZMIANA: Lepsze szczegóły z informacją o nieistniejących zamówieniach
                if (ordersProcessed > 0) {
                    detailsHtml = `
                    <p>Dodano: ${ordersAdded} nowych rekordów</p>
                    <p>Zaktualizowano: ${ordersUpdated} zamówień</p>
                `;

                    if (missingOrders > 0) {
                        detailsHtml += `<p style="color: #856404;">Nieistniejące w Baselinker: ${missingOrders}</p>`;
                    }
                    if (failedOrders > 0) {
                        detailsHtml += `<p style="color: #dc3545;">Błędy pobierania: ${failedOrders}</p>`;
                    }
                } else if (missingOrders > 0 && failedOrders === 0) {
                    // Wszystkie zamówienia nieistniejące
                    detailsHtml = `<p style="color: #856404;">Te zamówienia zostały usunięte z Baselinker lub mają wykluczony status (anulowane/nieopłacone)</p>`;
                }

                this.showSyncLoading(`
                <div style="text-align: center;">
                    <i class="fas fa-check-circle" style="color: #28a745; font-size: 2rem; margin-bottom: 1rem;"></i>
                    <h4>Synchronizacja zakończona!</h4>
                    <p><strong>${message}</strong></p>
                    ${detailsHtml}
                </div>
            `);

                setTimeout(() => {
                    this.hideSyncLoading();
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
 * Formatowanie waluty z separatorami tysięcy
 */
    formatCurrency(value) {
        if (value === null || value === undefined) return '0.00 PLN';

        const num = parseFloat(value);
        if (isNaN(num)) return '0.00 PLN';

        // Formatuj z 2 miejscami po przecinku
        const formatted = num.toFixed(2);
        const parts = formatted.split('.');

        // Dodaj spacje co 3 cyfry od prawej strony
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

        return parts.join('.') + ' PLN';
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