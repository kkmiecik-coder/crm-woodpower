document.addEventListener('DOMContentLoaded', function() {
    console.log('[Production] Inicjalizacja modułu produkcyjnego...');
    
    // === ZMIENNE GLOBALNE ===
    let refreshTimer = null;
    let refreshCountdown = 30;
    let currentFilters = {};
    
    // === INICJALIZACJA ===
    initTabs();
    initRefreshSystem();
    initDashboard();
    initProductionList();
    initSettings();
    initReports();
    
    console.log('[Production] Moduł produkcyjny zainicjalizowany pomyślnie');
    
    // ============================================================================
    // SYSTEM TABÓW
    // ============================================================================
    
    function initTabs() {
        const tabs = document.querySelectorAll('.prod-module-tab');
        const tabContents = document.querySelectorAll('.prod-module-tab-content');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', function() {
                const targetTab = this.getAttribute('data-tab');
                
                // Usuń aktywne klasy
                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                // Dodaj aktywne klasy
                this.classList.add('active');
                document.getElementById(targetTab).classList.add('active');
                
                // Załaduj dane dla aktywnego taba
                loadTabData(targetTab);
                
                console.log(`[Production] Przełączono na tab: ${targetTab}`);
            });
        });
    }
    
    function loadTabData(tabName) {
        switch(tabName) {
            case 'dashboard':
                loadDashboardData();
                break;
            case 'production-list':
                loadProductionList();
                break;
            case 'settings':
                loadSettingsData();
                break;
            case 'reports':
                // Raporty ładują się na żądanie
                break;
        }
    }
    
    // ============================================================================
    // SYSTEM ODŚWIEŻANIA
    // ============================================================================
    
    function initRefreshSystem() {
        const refreshButton = document.getElementById('refreshButton');
        const refreshTimerSpan = document.getElementById('refreshTimer');
        
        if (refreshButton) {
            refreshButton.addEventListener('click', function() {
                refreshAllData();
            });
        }
        
        // Auto-refresh co 30 sekund
        startRefreshTimer();
        
        function startRefreshTimer() {
            refreshTimer = setInterval(() => {
                refreshCountdown--;
                if (refreshTimerSpan) {
                    refreshTimerSpan.textContent = `(${refreshCountdown}s)`;
                }
                
                if (refreshCountdown <= 0) {
                    refreshAllData();
                    refreshCountdown = 300;
                }
            }, 1000);
        }
        
        function refreshAllData() {
            console.log('[Production] Odświeżanie danych...');
            
            const refreshIcon = document.querySelector('.prod-module-refresh-icon');
            if (refreshIcon) {
                refreshIcon.classList.add('spinning');
                setTimeout(() => refreshIcon.classList.remove('spinning'), 1000);
            }
            
            // Odśwież dane w zależności od aktywnego taba
            const activeTab = document.querySelector('.prod-module-tab.active');
            if (activeTab) {
                loadTabData(activeTab.getAttribute('data-tab'));
            }
            
            refreshCountdown = 300;
        }
    }
    
    // ============================================================================
    // DASHBOARD
    // ============================================================================
    
    function initDashboard() {
        const refreshQueueBtn = document.getElementById('refreshQueueBtn');
        const syncOrdersBtn = document.getElementById('syncOrdersBtn');
        
        if (refreshQueueBtn) {
            refreshQueueBtn.addEventListener('click', loadQueueData);
        }
        
        if (syncOrdersBtn) {
            syncOrdersBtn.addEventListener('click', syncOrders);
        }
        
        // Załaduj dane dashboardu przy starcie
        loadDashboardData();
    }
    
    function loadDashboardData() {
        console.log('[Production] Ładowanie danych dashboardu...');
        
        // NOWE: Zapisz pozycję scroll tylko jeśli jesteśmy na tabie dashboard
        const activeTab = document.querySelector('.prod-module-tab.active');
        const scrollPosition = (activeTab && activeTab.getAttribute('data-tab') === 'dashboard') ? 
            (window.scrollY || window.pageYOffset) : 0;
        
        fetch('/production/api/dashboard')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    updateStats(data.data.stats);
                    updateStations(data.data.stations);
                    updateQueue(data.data.queue_preview);
                    
                    // NOWE: Przywróć scroll tylko dla dashboard
                    if (activeTab && activeTab.getAttribute('data-tab') === 'dashboard' && scrollPosition > 0) {
                        setTimeout(() => {
                            window.scrollTo(0, scrollPosition);
                        }, 10);
                    }
                } else {
                    console.error('[Production] Błąd ładowania dashboardu:', data.error);
                }
            })
            .catch(error => {
                console.error('[Production] Błąd połączenia dashboardu:', error);
            });
    }
    
    function updateStats(stats) {
        const elements = {
            pendingItems: document.getElementById('pendingItems'),
            inProgressItems: document.getElementById('inProgressItems'),
            completedItems: document.getElementById('completedItems'),
            overdueItems: document.getElementById('overdueItems')
        };
        
        if (elements.pendingItems) elements.pendingItems.textContent = stats.pending_items || 0;
        if (elements.inProgressItems) elements.inProgressItems.textContent = stats.in_progress_items || 0;
        if (elements.completedItems) elements.completedItems.textContent = stats.completed_items || 0;
        if (elements.overdueItems) elements.overdueItems.textContent = stats.overdue_items || 0;
        
        console.log('[Production] Statystyki zaktualizowane:', stats);
    }
    
    function updateStations(stations) {
        const stationsGrid = document.getElementById('stationsGrid');
        if (!stationsGrid) return;
        
        if (!stations || stations.length === 0) {
            stationsGrid.innerHTML = '<div class="prod-module-station-placeholder">Brak danych</div>';
            return;
        }
        
        stationsGrid.innerHTML = '';
        
        stations.forEach(station => {
            const stationCard = createStationCard(station);
            stationsGrid.appendChild(stationCard);
        });
        
        console.log('[Production] Stanowiska zaktualizowane:', stations.length);
    }
    
    function createStationCard(station) {
        const card = document.createElement('div');
        const isBusy = station.current_item_id !== null;
        const statusClass = isBusy ? 'busy' : 'free';
        const statusText = isBusy ? 'Zajęte' : 'Wolne';
        
        card.className = `prod-module-station-card ${statusClass}`;
        
        let workingTimeHtml = '';
        if (isBusy && station.working_time_seconds) {
            const minutes = Math.floor(station.working_time_seconds / 60);
            const seconds = station.working_time_seconds % 60;
            const timeClass = station.is_overtime ? 'overtime' : '';
            workingTimeHtml = `
                <div class="prod-module-station-time ${timeClass}">
                    Czas pracy: ${minutes}:${seconds.toString().padStart(2, '0')}
                    ${station.is_overtime ? ' (NADGODZINY!)' : ''}
                </div>
            `;
        }
        
        card.innerHTML = `
            <div class="prod-module-station-header">
                <div class="prod-module-station-name">${station.name}</div>
                <div class="prod-module-station-status ${statusClass}">${statusText}</div>
            </div>
            <div class="prod-module-station-current">
                ${isBusy && station.current_item ? 
                    `Produkuje: ${station.current_item.product_name.substring(0, 40)}...` : 
                    'Brak aktywnej produkcji'
                }
            </div>
            ${workingTimeHtml}
        `;
        
        return card;
    }
    
    function updateQueue(queueItems) {
        const queueContainer = document.getElementById('queueContainer');
        if (!queueContainer) return;
        
        if (!queueItems || queueItems.length === 0) {
            queueContainer.innerHTML = '<div class="prod-module-queue-placeholder">Brak danych</div>';
            return;
        }
        
        // Grupuj produkty według zamówień
        const orderGroups = {};
        queueItems.forEach(item => {
            const orderId = item.baselinker_order_id;
            if (!orderGroups[orderId]) {
                orderGroups[orderId] = [];
            }
            orderGroups[orderId].push(item);
        });
        
        queueContainer.innerHTML = '';
        
        Object.keys(orderGroups).forEach((orderId, index) => {
            const orderItems = orderGroups[orderId];
            const orderBox = createOrderBox(orderId, orderItems, index + 1);
            queueContainer.appendChild(orderBox);
        });
        
        console.log('[Production] Kolejka zaktualizowana:', Object.keys(orderGroups).length, 'zamówień');
    }
    
    function createOrderBox(orderId, orderItems, orderPosition) {
        const orderBox = document.createElement('div');
        const highestPriority = Math.max(...orderItems.map(item => item.priority_score));
        const priorityLevel = getPriorityLevel(highestPriority);
        const totalQuantity = orderItems.reduce((sum, item) => sum + item.quantity, 0);
        
        orderBox.className = `prod-module-order-box priority-${priorityLevel}`;
        
        // Nagłówek zamówienia
        const orderHeader = document.createElement('div');
        orderHeader.className = 'prod-module-order-header';
        orderHeader.innerHTML = `
            <div class="prod-module-order-info">
                <div class="prod-module-order-number">#${orderPosition} Zamówienie ${orderId}</div>
                <div class="prod-module-order-meta">${orderItems.length} produktów, ${totalQuantity} szt.</div>
            </div>
            <div class="prod-module-order-priority ${priorityLevel}">${highestPriority}</div>
        `;
        
        // Lista produktów w zamówieniu - uproszczona
        const productsList = document.createElement('div');
        productsList.className = 'prod-module-order-products';
        
        orderItems.forEach(item => {
            const productItem = document.createElement('div');
            productItem.className = 'prod-module-order-product';
            
            const statusClass = getStatusClass(item.status?.name);
            
            productItem.innerHTML = `
                <div class="prod-module-product-row">
                    <div class="prod-module-product-name" title="${item.product_name}">
                        ${item.product_name.length > 60 ? item.product_name.substring(0, 60) + '...' : item.product_name}
                    </div>
                    <div class="prod-module-product-status">
                        <span class="prod-module-status-badge prod-module-status-${statusClass}">
                            ${item.status?.display_name || 'N/A'}
                        </span>
                    </div>
                </div>
            `;
            
            productsList.appendChild(productItem);
        });
        
        orderBox.appendChild(orderHeader);
        orderBox.appendChild(productsList);
        
        return orderBox;
    }
    
    function loadQueueData() {
        console.log('[Production] Odświeżanie kolejki...');
        
        fetch('/production/api/queue?limit=10')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    updateQueue(data.data);
                } else {
                    console.error('[Production] Błąd ładowania kolejki:', data.error);
                }
            })
            .catch(error => {
                console.error('[Production] Błąd połączenia kolejki:', error);
            });
    }
    
    function syncOrders() {
        console.log('[Production] Synchronizacja zamówień...');
        
        const syncBtn = document.getElementById('syncOrdersBtn');
        if (syncBtn) {
            syncBtn.disabled = true;
            syncBtn.innerHTML = '<span class="prod-module-loading"></span> Synchronizacja...';
        }
        
        fetch('/production/api/sync-orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Production] Synchronizacja zakończona:', data.result);
                loadDashboardData(); // Odśwież dashboard
                showNotification('Synchronizacja zakończona pomyślnie', 'success');
            } else {
                console.error('[Production] Błąd synchronizacji:', data.error);
                showNotification('Błąd synchronizacji: ' + data.error, 'error');
            }
        })
        .catch(error => {
            console.error('[Production] Błąd połączenia synchronizacji:', error);
            showNotification('Błąd połączenia podczas synchronizacji', 'error');
        })
        .finally(() => {
            if (syncBtn) {
                syncBtn.disabled = false;
                syncBtn.innerHTML = '📥 Synchronizuj zamówienia';
            }
        });
    }
    
    // modules/production/static/js/production.js - ZAKTUALIZOWANE FUNKCJE LISTY PRODUKCYJNEJ

    // ZASTĄP SEKCJĘ "LISTA PRODUKCYJNA" (około linia 200-400) tym kodem:

    // ============================================================================
    // LISTA PRODUKCYJNA - NOWA WERSJA BEZ PAGINACJI Z DRAG&DROP
    // ============================================================================

    function initProductionList() {
        const applyFiltersBtn = document.getElementById('applyFiltersBtn');
        const clearFiltersBtn = document.getElementById('clearFiltersBtn');
        
        if (applyFiltersBtn) {
            applyFiltersBtn.addEventListener('click', applyFilters);
        }
        
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', clearFilters);
        }
        
        // Załaduj listę bez paginacji
        loadProductionList();
    }

    function loadProductionList() {
        console.log('[Production] Ładowanie pełnej listy produkcyjnej...');
        
        const params = new URLSearchParams({
            ...currentFilters
        });
        
        // Pokazuj loading
        showTableLoading();
        
        fetch(`/production/api/items?${params}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    updateProductionTable(data.data);
                    updateFiltersInfo(data);
                    
                    // Inicjalizuj drag&drop po załadowaniu danych
                    if (data.data.length > 0) {
                        initDragAndDrop();
                    }
                } else {
                    console.error('[Production] Błąd ładowania listy:', data.error);
                    showTableError('Błąd ładowania danych: ' + data.error);
                }
            })
            .catch(error => {
                console.error('[Production] Błąd połączenia listy:', error);
                showTableError('Błąd połączenia z serwerem');
            });
    }
    // Tworzy mapę kolorów dla zamówień
    function createOrderColorMap(items) {
        const uniqueOrders = [...new Set(items.map(item => item.baselinker_order_id))];
        const orderColors = {};

        uniqueOrders.forEach((orderId, index) => {
            orderColors[orderId] = index % 16; // Cykl 16 kolorów
        });

        return orderColors;
    }

    function updateProductionTable(items) {
        const tableBody = document.getElementById('productionTableBody');
        if (!tableBody) return;

        if (!items || items.length === 0) {
            tableBody.innerHTML = `
            <tr>
                <td colspan="13" class="prod-module-table-loading">
                    ${Object.keys(currentFilters).length > 0 ?
                    'Brak produktów spełniających kryteria filtrowania' :
                    'Brak produktów w kolejce produkcyjnej'
                }
                </td>
            </tr>
        `;
            return;
        }

        tableBody.innerHTML = '';

        // Stwórz mapę kolorów dla zamówień
        const orderColors = createOrderColorMap(items);

        items.forEach((item, index) => {
            const row = createProductionTableRow(item, index, orderColors);
            tableBody.appendChild(row);
        });

        // Dodaj event listenery dla hover efektów
        addOrderHoverEffects();

        console.log('[Production] Tabela produkcyjna zaktualizowana:', items.length, 'produktów');
    }

    function createProductionTableRow(item, index, orderColors) {
        const row = document.createElement('tr');
        const statusClass = getStatusClass(item.status?.name);

        // Dodaj data attributes dla drag&drop i grupowania
        row.setAttribute('data-item-id', item.id);
        row.setAttribute('data-priority-score', item.priority_score);
        row.setAttribute('data-order-id', item.baselinker_order_id);
        row.setAttribute('data-order-color', orderColors[item.baselinker_order_id] || 0);
        row.className = 'prod-module-table-row';

        // Ikona drag handle
        const dragHandle = `
        <span class="prod-module-drag-handle" title="Przeciągnij aby zmienić pozycję">
            ≡
        </span>
    `;

        // Sformatowana pozycja (001, 002, 003...)
        const formattedPosition = item.formatted_priority || String(item.priority_score || 0).padStart(3, '0');

        // Link do zamówienia w Baselinker
        const baselinkerOrderLink = item.baselinker_order_id ? `
        <a href="https://panel-f.baselinker.com/orders.php#order:${item.baselinker_order_id}" 
           target="_blank" 
           class="prod-module-baselinker-link"
           title="Otwórz zamówienie ${item.baselinker_order_id} w Baselinker">
            ${item.baselinker_order_id}
            <span class="prod-module-link-icon">🔗</span>
        </a>
    ` : '-';

        // Tooltip z informacją o zamówieniu
        const orderTooltip = `
        <div class="prod-module-order-tooltip">
            Zamówienie #${item.baselinker_order_id}
        </div>
    `;

        row.innerHTML = `
        <td class="prod-module-drag-cell">${dragHandle}</td>
        <td class="prod-module-priority-cell">
            ${orderTooltip}
            <span class="prod-module-priority-number">${formattedPosition}</span>
        </td>
        <td class="prod-module-order-cell">${baselinkerOrderLink}</td>
        <td class="prod-module-product-name-cell" title="${item.product_name}">
            ${item.product_name.length > 60 ?
                item.product_name.substring(0, 60) + '...' : item.product_name}
        </td>
        <td>${item.wood_species || '-'}</td>
        <td>${item.wood_technology || '-'}</td>
        <td>${item.wood_class || '-'}</td>
        <td>${item.finish_type || '-'}</td>
        <td>${formatDimensions(item)}</td>
        <td>${item.quantity}</td>
        <td>${formatDate(item.deadline_date)}</td>
        <td>
            <span class="prod-module-status-badge prod-module-status-${statusClass}">
                ${item.status?.display_name || 'N/A'}
            </span>
        </td>
    `;

        return row;
    }

    // Dodaje event listenery dla hover efektów
    function addOrderHoverEffects() {
        const rows = document.querySelectorAll('.prod-module-table-row[data-order-id]');

        rows.forEach(row => {
            const orderId = row.getAttribute('data-order-id');

            row.addEventListener('mouseenter', () => {
                // Znajdź wszystkie wiersze z tym samym zamówieniem
                const sameOrderRows = document.querySelectorAll(`[data-order-id="${orderId}"]`);

                // Dodaj klasę hover do wszystkich pozycji z tego zamówienia
                sameOrderRows.forEach(orderRow => {
                    orderRow.classList.add('order-hover');
                });
            });

            row.addEventListener('mouseleave', () => {
                // Znajdź wszystkie wiersze z tym samym zamówieniem
                const sameOrderRows = document.querySelectorAll(`[data-order-id="${orderId}"]`);

                // Usuń klasę hover ze wszystkich pozycji z tego zamówienia
                sameOrderRows.forEach(orderRow => {
                    orderRow.classList.remove('order-hover');
                });
            });
        });
    }

    function initDragAndDrop() {
        const tableBody = document.getElementById('productionTableBody');
        if (!tableBody) {
            console.warn('[Production] Nie znaleziono tabeli do drag&drop');
            return;
        }
        
        // Sprawdź czy SortableJS jest dostępne
        if (typeof Sortable === 'undefined') {
            console.warn('[Production] SortableJS nie jest załadowany - drag&drop wyłączony');
            addSortableJSScript();
            return;
        }
        
        // Zniszcz poprzednie instancje Sortable
        if (tableBody._sortable) {
            tableBody._sortable.destroy();
        }
        
        // Inicjalizuj nową instancję Sortable
        const sortable = new Sortable(tableBody, {
            handle: '.prod-module-drag-handle',
            animation: 150,
            ghostClass: 'prod-module-sortable-ghost',
            chosenClass: 'prod-module-sortable-chosen',
            dragClass: 'prod-module-sortable-drag',
            
            onStart: function(evt) {
                console.log('[Production] Rozpoczęto przeciąganie produktu', evt.oldIndex + 1);
            },
            
            onEnd: function(evt) {
                const oldIndex = evt.oldIndex;
                const newIndex = evt.newIndex;
                
                if (oldIndex === newIndex) {
                    console.log('[Production] Pozycja nie zmieniła się');
                    return;
                }
                
                const itemId = parseInt(evt.item.getAttribute('data-item-id'));
                const newPosition = newIndex + 1; // Pozycje są 1-indexed
                
                console.log('[Production] Przeniesiono produkt', {
                    itemId: itemId,
                    oldPosition: oldIndex + 1,
                    newPosition: newPosition
                });
                
                // Wyślij żądanie do API
                reorderItemByDragDrop(itemId, newPosition, evt);
            }
        });
        
        // Zapisz referencję dla przyszłego czyszczenia
        tableBody._sortable = sortable;
        
        console.log('[Production] Drag&Drop zainicjalizowany pomyślnie');
    }

    function addSortableJSScript() {
        // Sprawdź czy script już istnieje
        if (document.querySelector('script[src*="sortable"]')) {
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js';
        script.onload = function() {
            console.log('[Production] SortableJS załadowany - inicjalizacja drag&drop');
            initDragAndDrop();
        };
        script.onerror = function() {
            console.error('[Production] Nie można załadować SortableJS');
            showNotification('Nie można załadować biblioteki drag&drop', 'warning');
        };
        document.head.appendChild(script);
    }

    function reorderItemByDragDrop(itemId, newPosition, dragEvent) {
        // Pokazuj loading na przeciąganym elemencie
        const draggedRow = dragEvent.item;
        const originalContent = draggedRow.innerHTML;
        
        // Tymczasowo pokaż loading
        const priorityCell = draggedRow.querySelector('.prod-module-priority-cell');
        if (priorityCell) {
            priorityCell.innerHTML = '<span class="prod-module-loading-small">⏳</span>';
        }
        
        fetch(`/production/api/items/${itemId}/reorder`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                new_position: newPosition
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Production] Pozycja zmieniona pomyślnie:', data.result);
                showNotification(`Produkt przeniesiony na pozycję ${newPosition}`, 'success');
                
                // Odśwież całą listę żeby pokazać nowe pozycje wszystkich produktów
                setTimeout(() => {
                    loadProductionList();
                }, 500);
                
            } else {
                console.error('[Production] Błąd zmiany pozycji:', data.error);
                showNotification('Błąd zmiany pozycji: ' + data.error, 'error');
                
                // Przywróć oryginalną zawartość i pozycję
                draggedRow.innerHTML = originalContent;
                loadProductionList(); // Przywróć oryginalną kolejność
            }
        })
        .catch(error => {
            console.error('[Production] Błąd połączenia zmiany pozycji:', error);
            showNotification('Błąd połączenia podczas zmiany pozycji', 'error');
            
            // Przywróć oryginalną zawartość i pozycję
            draggedRow.innerHTML = originalContent;
            loadProductionList(); // Przywróć oryginalną kolejność
        });
    }

    function showChangePositionModal(itemId, currentPosition) {
        const newPosition = prompt(`Wprowadź nową pozycję w kolejce:\n\n(Aktualnie: ${currentPosition})`);
        
        if (newPosition === null) return; // Anulowano
        
        const positionNum = parseInt(newPosition);
        if (isNaN(positionNum) || positionNum < 1) {
            showNotification('Pozycja musi być liczbą większą od 0', 'warning');
            return;
        }
        
        if (positionNum === currentPosition) {
            showNotification('Nowa pozycja jest taka sama jak aktualna', 'info');
            return;
        }
        
        console.log('[Production] Zmiana pozycji przez modal:', {itemId, currentPosition, newPosition: positionNum});
        
        fetch(`/production/api/items/${itemId}/reorder`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                new_position: positionNum
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Production] Pozycja zmieniona pomyślnie:', data.result);
                showNotification(`Produkt przeniesiony z pozycji ${data.result.old_position} na ${data.result.new_position}`, 'success');
                
                // Odśwież listę
                loadProductionList();
                
            } else {
                console.error('[Production] Błąd zmiany pozycji:', data.error);
                showNotification('Błąd zmiany pozycji: ' + data.error, 'error');
            }
        })
        .catch(error => {
            console.error('[Production] Błąd połączenia zmiany pozycji:', error);
            showNotification('Błąd połączenia podczas zmiany pozycji', 'error');
        });
    }

    function showPriorityExplanation(itemId) {
        console.log('[Production] Pokazywanie wyjaśnienia priorytetu:', itemId);
        
        fetch(`/production/api/priority-explanation/${itemId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    displayPriorityExplanationModal(data.item, data.explanation);
                } else {
                    console.error('[Production] Błąd pobierania wyjaśnienia:', data.error);
                    showNotification('Błąd pobierania wyjaśnienia priorytetu', 'error');
                }
            })
            .catch(error => {
                console.error('[Production] Błąd połączenia wyjaśnienia:', error);
                showNotification('Błąd połączenia', 'error');
            });
    }

    function displayPriorityExplanationModal(item, explanation) {
        // Utwórz modal z wyjaśnieniem priorytetu
        const modalContent = createPriorityExplanationContent(item, explanation);
        
        // Usuń poprzedni modal jeśli istnieje
        const existingModal = document.getElementById('priorityExplanationModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Utwórz nowy modal
        const modal = document.createElement('div');
        modal.id = 'priorityExplanationModal';
        modal.className = 'prod-module-modal';
        modal.innerHTML = `
            <div class="prod-module-modal-backdrop">
                <div class="prod-module-modal-content">
                    <div class="prod-module-modal-header">
                        <h3>Wyjaśnienie priorytetu</h3>
                        <button class="prod-module-modal-close">&times;</button>
                    </div>
                    <div class="prod-module-modal-body">
                        ${modalContent}
                    </div>
                    <div class="prod-module-modal-footer">
                        <button class="prod-module-btn prod-module-btn-secondary prod-module-modal-close">
                            Zamknij
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Dodaj style modala jeśli nie istnieją
        addModalStyles();
        
        // Event listenery zamknięcia
        const closeButtons = modal.querySelectorAll('.prod-module-modal-close');
        closeButtons.forEach(btn => {
            btn.addEventListener('click', () => modal.remove());
        });
        
        // Zamknij po kliknięciu w backdrop
        modal.querySelector('.prod-module-modal-backdrop').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                modal.remove();
            }
        });
        
        // Dodaj do strony i pokaż
        document.body.appendChild(modal);
        
        // Animacja pojawienia się
        setTimeout(() => modal.classList.add('show'), 10);
    }

    function addModalStyles() {
        // Sprawdź czy style już istnieją
        if (document.getElementById('prod-module-modal-styles')) {
            return;
        }
        
        const modalStyles = `
            .prod-module-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 1000;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.3s ease, visibility 0.3s ease;
            }
            
            .prod-module-modal.show {
                opacity: 1;
                visibility: visible;
            }
            
            .prod-module-modal-backdrop {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            
            .prod-module-modal-content {
                background: white;
                border-radius: 8px;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
                max-width: 600px;
                width: 100%;
                max-height: 90vh;
                overflow-y: auto;
            }
            
            .prod-module-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px;
                border-bottom: 1px solid #eee;
            }
            
            .prod-module-modal-header h3 {
                margin: 0;
                color: #2c3e50;
            }
            
            .prod-module-modal-close {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #7f8c8d;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .prod-module-modal-close:hover {
                background-color: #f8f9fa;
                color: #495057;
            }
            
            .prod-module-modal-body {
                padding: 20px;
            }
            
            .prod-module-modal-footer {
                padding: 20px;
                border-top: 1px solid #eee;
                text-align: right;
            }
        `;
        
        const styleElement = document.createElement('style');
        styleElement.id = 'prod-module-modal-styles';
        styleElement.textContent = modalStyles;
        document.head.appendChild(styleElement);
    }

    function createPriorityExplanationContent(item, explanation) {
        if (explanation.error) {
            return `<p class="prod-module-error">Błąd: ${explanation.error}</p>`;
        }
        
        const currentPosition = String(item.current_priority_score || 0).padStart(3, '0');
        
        let content = `
            <div class="prod-module-explanation-container">
                <div class="prod-module-explanation-header">
                    <h4>${item.product_name}</h4>
                    <div class="prod-module-current-position">
                        Aktualna pozycja: <span class="prod-module-position-number">${currentPosition}</span>
                    </div>
                    <div class="prod-module-priority-group">
                        Grupa: <code>${item.priority_group || 'brak'}</code>
                    </div>
                </div>
                
                <div class="prod-module-explanation-sections">
                    <div class="prod-module-explanation-section">
                        <h5>📅 Deadline</h5>
                        <div class="prod-module-explanation-content">
                            <strong>Wynik:</strong> ${explanation.deadline?.score || 0} punktów<br>
                            <strong>Powód:</strong> ${explanation.deadline?.reason || 'Brak danych'}
                        </div>
                    </div>
                    
                    <div class="prod-module-explanation-section">
                        <h5>🪵 Gatunek drewna</h5>
                        <div class="prod-module-explanation-content">
                            <strong>Wynik:</strong> ${explanation.species?.score || 0} punktów<br>
                            <strong>Powód:</strong> ${explanation.species?.reason || 'Brak danych'}
                        </div>
                    </div>
                    
                    <div class="prod-module-explanation-section">
                        <h5>🔧 Technologia</h5>
                        <div class="prod-module-explanation-content">
                            <strong>Wynik:</strong> ${explanation.technology?.score || 0} punktów<br>
                            <strong>Powód:</strong> ${explanation.technology?.reason || 'Brak danych'}
                        </div>
                    </div>
                    
                    <div class="prod-module-explanation-section">
                        <h5>⭐ Klasa drewna</h5>
                        <div class="prod-module-explanation-content">
                            <strong>Wynik:</strong> ${explanation.class?.score || 0} punktów<br>
                            <strong>Powód:</strong> ${explanation.class?.reason || 'Brak danych'}
                        </div>
                    </div>
                    
                    <div class="prod-module-explanation-section">
                        <h5>📦 Wielkość zamówienia</h5>
                        <div class="prod-module-explanation-content">
                            <strong>Wynik:</strong> ${explanation.order_size?.score || 0} punktów<br>
                            <strong>Powód:</strong> ${explanation.order_size?.reason || 'Brak danych'}
                        </div>
                    </div>
                    
                    <div class="prod-module-explanation-total">
                        <strong>ŁĄCZNY WYNIK: ${explanation.total_score || 0} punktów</strong>
                    </div>
                </div>
            </div>
        `;
        
        return content;
    }

    function updateFiltersInfo(data) {
        // Usuń starą sekcję filtrów jeśli istnieje
        const oldFiltersInfo = document.getElementById('filtersInfo');
        if (oldFiltersInfo) {
            oldFiltersInfo.remove();
        }
        
        // Zaktualizuj licznik produktów w prawym górnym rogu filtrów
        updateProductsCounter(data.total_count, data.has_filters);
        
        // Pokaż aktywne filtry tylko gdy są aktywne
        if (data.has_filters && data.applied_filters) {
            showActiveFiltersBar(data.applied_filters);
        }
    }

    function updateProductsCounter(totalCount, hasFilters) {
        // Znajdź kontener filtrów
        const filtersContainer = document.querySelector('.prod-module-filters');
        if (!filtersContainer) return;
        
        // Usuń istniejący licznik
        const existingCounter = document.getElementById('productsCounter');
        if (existingCounter) {
            existingCounter.remove();
        }
        
        // Utwórz nowy licznik
        const counterBox = document.createElement('div');
        counterBox.id = 'productsCounter';
        counterBox.className = 'prod-module-products-counter';
        
        const statusText = hasFilters ? 'Znalezionych produktów:' : 'Wszystkie produkty w kolejce:';
        const counterClass = hasFilters ? 'filtered' : 'total';
        
        counterBox.innerHTML = `
            <div class="prod-module-counter-label">${statusText}</div>
            <div class="prod-module-counter-number ${counterClass}">${totalCount}</div>
        `;
        
        // Dodaj na końcu kontenera filtrów
        filtersContainer.appendChild(counterBox);
    }

    function showActiveFiltersBar(appliedFilters) {
        // Znajdź miejsce dla paska filtrów (przed tabelą)
        const tableContainer = document.querySelector('.prod-module-table-container');
        if (!tableContainer) return;
        
        // Usuń istniejący pasek
        const existingBar = document.getElementById('activeFiltersBar');
        if (existingBar) {
            existingBar.remove();
        }
        
        // Utwórz pasek aktywnych filtrów
        const filtersBar = document.createElement('div');
        filtersBar.id = 'activeFiltersBar';
        filtersBar.className = 'prod-module-active-filters-bar';
        
        const activeFilters = [];
        if (appliedFilters.status) activeFilters.push(`Status: <strong>${appliedFilters.status}</strong>`);
        if (appliedFilters.wood_species) activeFilters.push(`Gatunek: <strong>${appliedFilters.wood_species}</strong>`);
        if (appliedFilters.wood_technology) activeFilters.push(`Technologia: <strong>${appliedFilters.wood_technology}</strong>`);
        
        filtersBar.innerHTML = `
            <div class="prod-module-filters-bar-content">
                <span class="prod-module-filters-icon">🔍</span>
                <span class="prod-module-filters-text">Aktywne filtry: ${activeFilters.join(' • ')}</span>
                <button class="prod-module-clear-filters-btn" onclick="clearFilters()">
                    ✕ Wyczyść wszystkie
                </button>
            </div>
        `;
        
        // Wstaw przed tabelą
        tableContainer.parentNode.insertBefore(filtersBar, tableContainer);
    }

    function showTableLoading() {
        const tableBody = document.getElementById('productionTableBody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="11" class="prod-module-table-loading">
                        <span class="prod-module-loading"></span> Ładowanie danych...
                    </td>
                </tr>
            `;
        }
    }

    function showTableError(message) {
        const tableBody = document.getElementById('productionTableBody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="11" class="prod-module-table-loading prod-module-table-error">
                        ❌ ${message}
                    </td>
                </tr>
            `;
        }
    }

    function applyFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const speciesFilter = document.getElementById('speciesFilter');
        const technologyFilter = document.getElementById('technologyFilter');
        const clearBtn = document.getElementById('clearFiltersBtn');
        
        currentFilters = {};
        let hasFilters = false;
        
        if (statusFilter && statusFilter.value) {
            currentFilters.status = statusFilter.value;
            hasFilters = true;
        }
        
        if (speciesFilter && speciesFilter.value) {
            currentFilters.wood_species = speciesFilter.value;
            hasFilters = true;
        }
        
        if (technologyFilter && technologyFilter.value) {
            currentFilters.wood_technology = technologyFilter.value;
            hasFilters = true;
        }
        
        // Pokaż/ukryj przycisk "Wyczyść"
        if (clearBtn) {
            if (hasFilters) {
                clearBtn.classList.remove('prod-module-hidden');
            } else {
                clearBtn.classList.add('prod-module-hidden');
            }
        }
        
        loadProductionList();
        
        console.log('[Production] Filtry zastosowane:', currentFilters);
    }

    function clearFilters() {
        const statusFilter = document.getElementById('statusFilter');
        const speciesFilter = document.getElementById('speciesFilter');
        const technologyFilter = document.getElementById('technologyFilter');
        const clearBtn = document.getElementById('clearFiltersBtn');
        
        if (statusFilter) statusFilter.value = '';
        if (speciesFilter) speciesFilter.value = '';
        if (technologyFilter) technologyFilter.value = '';
        
        // Ukryj przycisk "Wyczyść"
        if (clearBtn) {
            clearBtn.classList.add('prod-module-hidden');
        }
        
        currentFilters = {};
        loadProductionList();
        
        console.log('[Production] Filtry wyczyszczone');
    }
    
    // ============================================================================
    // USTAWIENIA
    // ============================================================================
    
    function initSettings() {
        const saveTimeSettingsBtn = document.getElementById('saveTimeSettingsBtn');
        const recalculatePrioritiesBtn = document.getElementById('recalculatePrioritiesBtn');
        const reparseProductsBtn = document.getElementById('reparseProductsBtn');
        const testBaselinkerBtn = document.getElementById('testBaselinkerBtn');
        
        if (saveTimeSettingsBtn) {
            saveTimeSettingsBtn.addEventListener('click', saveTimeSettings);
        }
        
        if (recalculatePrioritiesBtn) {
            recalculatePrioritiesBtn.addEventListener('click', recalculatePriorities);
        }
        
        if (reparseProductsBtn) {
            reparseProductsBtn.addEventListener('click', reparseProducts);
        }
        
        if (testBaselinkerBtn) {
            testBaselinkerBtn.addEventListener('click', testBaselinker);
        }
    }
    
    function loadSettingsData() {
        console.log('[Production] Ładowanie danych ustawień...');
        
        // Załaduj prawdziwe dane z API
        fetch('/production/api/settings')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    updateWorkersList(data.data.workers);
                    updateConfigsList(data.data.configs);
                } else {
                    console.error('[Production] Błąd ładowania ustawień:', data.error);
                    const workersList = document.getElementById('workersList');
                    if (workersList) {
                        workersList.innerHTML = '<div class="prod-module-list-placeholder">Błąd ładowania danych</div>';
                    }
                }
            })
            .catch(error => {
                console.error('[Production] Błąd połączenia ustawień:', error);
                const workersList = document.getElementById('workersList');
                if (workersList) {
                    workersList.innerHTML = '<div class="prod-module-list-placeholder">Błąd połączenia</div>';
                }
            });
    }
    
    function updateWorkersList(workers) {
        const workersList = document.getElementById('workersList');
        if (!workersList) return;
        
        if (!workers || workers.length === 0) {
            workersList.innerHTML = '<div class="prod-module-list-placeholder">Brak danych</div>';
            return;
        }
        
        workersList.innerHTML = '';
        
        workers.forEach(worker => {
            const workerItem = createWorkerItem(worker);
            workersList.appendChild(workerItem);
        });
        
        console.log('[Production] Lista pracowników zaktualizowana:', workers.length);
    }
    
    function createWorkerItem(worker) {
        const workerItem = document.createElement('div');
        const statusClass = worker.is_active ? '' : 'inactive';
        const statusText = worker.is_active ? 'Aktywny' : 'Nieaktywny';
        const preferenceText = getPreferenceText(worker.station_type_preference);
        
        workerItem.className = `prod-module-worker-item ${statusClass}`;
        
        workerItem.innerHTML = `
            <div class="prod-module-worker-info">
                <div class="prod-module-worker-name">${worker.name}</div>
                <div class="prod-module-worker-details">Preferencje: ${preferenceText} | ${statusText}</div>
            </div>
            <div class="prod-module-worker-actions">
                <button class="prod-module-btn-icon" onclick="editWorker(${worker.id})" title="Edytuj pracownika">✏️</button>
                <button class="prod-module-btn-icon" onclick="toggleWorkerStatus(${worker.id}, ${worker.is_active})" title="${worker.is_active ? 'Dezaktywuj' : 'Aktywuj'}">
                    ${worker.is_active ? '⏸️' : '▶️'}
                </button>
            </div>
        `;
        
        return workerItem;
    }
    
    function getPreferenceText(preference) {
        const preferenceMap = {
            'gluing': 'Sklejanie',
            'packaging': 'Pakowanie',
            'both': 'Oba'
        };
        return preferenceMap[preference] || 'Nieznane';
    }
    
    function updateConfigsList(configs) {
        // Zaktualizuj pola konfiguracji czasów
        const gluingTimeInput = document.getElementById('gluingTime');
        const maxOvertimeInput = document.getElementById('maxOvertime');
        
        configs.forEach(config => {
            switch(config.config_key) {
                case 'gluing_time_minutes':
                    if (gluingTimeInput) gluingTimeInput.value = config.config_value;
                    break;
                case 'max_overtime_minutes':
                    if (maxOvertimeInput) maxOvertimeInput.value = config.config_value;
                    break;
            }
        });
        
        console.log('[Production] Konfiguracje zaktualizowane:', configs.length);
    }
    
    // Usuń funkcje loadWorkersList i loadStationsList
    
    function saveTimeSettings() {
        const gluingTime = document.getElementById('gluingTime');
        const maxOvertime = document.getElementById('maxOvertime');
        
        const settings = {
            gluing_time_minutes: gluingTime ? gluingTime.value : 20,
            max_overtime_minutes: maxOvertime ? maxOvertime.value : 60
        };
        
        console.log('[Production] Zapisywanie ustawień czasów:', settings);
        showNotification('Ustawienia czasów zapisane', 'success');
    }
    
    function recalculatePriorities() {
        const btn = document.getElementById('recalculatePrioritiesBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="prod-module-loading"></span> Przeliczanie...';
        }
        
        fetch('/production/api/recalculate-priorities', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Production] Priorytety przeliczone:', data.result);
                const updatedCount = data.result.updated_count || 0;
                const totalCount = data.result.total_items || 0;
                showNotification(`Kolejka przeliczona: ${updatedCount} priorytetów zmienione z ${totalCount} produktów`, 'success');
            } else {
                console.error('[Production] Błąd przeliczania priorytetów:', data.error);
                showNotification('Błąd przeliczania priorytetów: ' + data.error, 'error');
            }
        })
        .catch(error => {
            console.error('[Production] Błąd połączenia przeliczania:', error);
            showNotification('Błąd połączenia podczas przeliczania', 'error');
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '🔄 Przelicz priorytety';
            }
        });
    }
    
    function reparseProducts() {
        const btn = document.getElementById('reparseProductsBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="prod-module-loading"></span> Parsowanie...';
        }
        
        fetch('/production/api/reparse-products', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Production] Produkty re-parsowane:', data.result);
                showNotification(`Produkty re-parsowane: ${data.result.updated_count} zaktualizowanych`, 'success');
            } else {
                console.error('[Production] Błąd re-parsowania:', data.error);
                showNotification('Błąd re-parsowania: ' + data.error, 'error');
            }
        })
        .catch(error => {
            console.error('[Production] Błąd połączenia re-parsowania:', error);
            showNotification('Błąd połączenia podczas re-parsowania', 'error');
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '🔍 Ponownie parsuj produkty';
            }
        });
    }
    
    function testBaselinker() {
        const btn = document.getElementById('testBaselinkerBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="prod-module-loading"></span> Testowanie...';
        }
        
        fetch('/production/api/test-baselinker')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Production] Test Baselinker:', data);
                showNotification(`Test Baselinker OK: ${data.orders_found} zamówień`, 'success');
            } else {
                console.error('[Production] Błąd testu Baselinker:', data.error);
                showNotification('Błąd testu Baselinker: ' + data.error, 'error');
            }
        })
        .catch(error => {
            console.error('[Production] Błąd połączenia testu:', error);
            showNotification('Błąd połączenia podczas testu', 'error');
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '🔗 Test Baselinker API';
            }
        });
    }
    
    // ============================================================================
    // RAPORTY
    // ============================================================================
    
    function initReports() {
        const generateReportsBtn = document.getElementById('generateReportsBtn');
        
        if (generateReportsBtn) {
            generateReportsBtn.addEventListener('click', generateReports);
        }
        
        // Ustaw domyślne daty (ostatnie 30 dni)
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
        
        const dateFromInput = document.getElementById('reportDateFrom');
        const dateToInput = document.getElementById('reportDateTo');
        
        if (dateFromInput) {
            dateFromInput.value = thirtyDaysAgo.toISOString().split('T')[0];
        }
        
        if (dateToInput) {
            dateToInput.value = today.toISOString().split('T')[0];
        }
    }
    
    function generateReports() {
        const dateFrom = document.getElementById('reportDateFrom')?.value;
        const dateTo = document.getElementById('reportDateTo')?.value;
        
        if (!dateFrom || !dateTo) {
            showNotification('Wybierz zakres dat', 'warning');
            return;
        }
        
        const btn = document.getElementById('generateReportsBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="prod-module-loading"></span> Generowanie...';
        }
        
        // Równoległe zapytania do API
        Promise.all([
            generateWorkersReport(dateFrom, dateTo),
            generateStationsReport(dateFrom, dateTo),
            generateDelaysReport(dateFrom, dateTo)
        ])
        .then(() => {
            showNotification('Raporty wygenerowane pomyślnie', 'success');
        })
        .catch(error => {
            console.error('[Production] Błąd generowania raportów:', error);
            showNotification('Błąd podczas generowania raportów', 'error');
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '📊 Generuj raporty';
            }
        });
        
        console.log('[Production] Generowanie raportów:', { dateFrom, dateTo });
    }
    
    function generateWorkersReport(dateFrom, dateTo) {
        return new Promise((resolve, reject) => {
            const workersReport = document.getElementById('workersReport');
            if (!workersReport) { resolve(); return; }

            fetch(`/production/api/reports/workers?date_from=${dateFrom}&date_to=${dateTo}`)
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.data.length > 0) {
                        let content = '<div class="prod-module-report-content-filled">';
                        content += '<h4>Wydajność pracowników</h4>';
                        content += '<div class="prod-module-workers-stats">';
                        data.data.forEach(stat => {
                            content += `
                                <div class="prod-module-worker-stat">
                                    <div class="prod-module-worker-name">${stat.worker_name}</div>
                                    <div class="prod-module-worker-metrics">
                                        <span>Produkty: ${stat.completed_items_count}</span>
                                        <span>Średni czas: ${Math.round(stat.average_time_seconds / 60)} min</span>
                                        <span>Wydajność: ${stat.efficiency_percentage}%</span>
                                    </div>
                                </div>
                            `;
                        });
                        content += '</div></div>';
                        workersReport.innerHTML = content;
                    } else {
                        workersReport.innerHTML = `
                            <div class="prod-module-report-empty">
                                <div class="prod-module-report-icon">📊</div>
                                <h4>Raport wydajności pracowników</h4>
                                <p>Brak danych do wyświetlenia w wybranym okresie</p>
                                <small>Raporty będą dostępne po ukończeniu pierwszych produktów</small>
                            </div>
                        `;
                    }
                    resolve();
                })
                .catch(error => {
                    workersReport.innerHTML = `
                        <div class="prod-module-report-error">
                            <h4>Błąd ładowania danych</h4>
                            <p>Nie można pobrać danych dla raportu pracowników</p>
                        </div>
                    `;
                    reject(error);
                });
        });
    }

    function generateStationsReport(dateFrom, dateTo) {
        return new Promise((resolve, reject) => {
            const stationsReport = document.getElementById('stationsReport');
            if (!stationsReport) { resolve(); return; }

            fetch(`/production/api/reports/stations?date_from=${dateFrom}&date_to=${dateTo}`)
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.data.length > 0) {
                        let content = '<div class="prod-module-report-content-filled">';
                        content += '<h4>Wydajność stanowisk</h4>';
                        content += '<div class="prod-module-stations-stats">';
                        data.data.forEach(stat => {
                            content += `
                                <div class="prod-module-station-stat">
                                    <div class="prod-module-station-name">${stat.station_name}</div>
                                    <div class="prod-module-station-metrics">
                                        <span>Produkty: ${stat.completed_items_count}</span>
                                        <span>Średnio dziennie: ${stat.average_items_per_day}</span>
                                        <span>Wykorzystanie: ${stat.utilization_percentage}%</span>
                                    </div>
                                </div>
                            `;
                        });
                        content += '</div></div>';
                        stationsReport.innerHTML = content;
                    } else {
                        stationsReport.innerHTML = `
                            <div class="prod-module-report-empty">
                                <div class="prod-module-report-icon">🏭</div>
                                <h4>Raport wydajności stanowisk</h4>
                                <p>Brak danych stanowisk</p>
                            </div>
                        `;
                    }
                    resolve();
                })
                .catch(error => {
                    stationsReport.innerHTML = `
                        <div class="prod-module-report-error">
                            <h4>Błąd ładowania danych</h4>
                            <p>Nie można pobrać danych stanowisk</p>
                        </div>
                    `;
                    reject(error);
                });
        });
    }
    
    function generateDelaysReport(dateFrom, dateTo) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                const delaysReport = document.getElementById('delaysReport');
                if (delaysReport) {
                    // Analiza opóźnień na podstawie deadline_date
                    fetch('/production/api/dashboard')
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                const stats = data.data.stats;
                                const totalItems = stats.pending_items + stats.in_progress_items + stats.completed_items;
                                const overdueItems = stats.overdue_items || 0;
                                
                                if (totalItems > 0) {
                                    const overduePercent = ((overdueItems / totalItems) * 100).toFixed(1);
                                    
                                    delaysReport.innerHTML = `
                                        <div class="prod-module-report-content-filled">
                                            <h4>Analiza opóźnień</h4>
                                            <div class="prod-module-delays-stats">
                                                <div class="prod-module-delay-metric">
                                                    <div class="prod-module-metric-label">Produkty opóźnione:</div>
                                                    <div class="prod-module-metric-value ${overdueItems > 0 ? 'prod-module-metric-warning' : ''}">${overdueItems} (${overduePercent}%)</div>
                                                </div>
                                                <div class="prod-module-delay-metric">
                                                    <div class="prod-module-metric-label">Produkty w normie:</div>
                                                    <div class="prod-module-metric-value">${totalItems - overdueItems} (${(100 - parseFloat(overduePercent)).toFixed(1)}%)</div>
                                                </div>
                                                <div class="prod-module-delay-metric">
                                                    <div class="prod-module-metric-label">Łącznie produktów:</div>
                                                    <div class="prod-module-metric-value">${totalItems}</div>
                                                </div>
                                            </div>
                                            ${overdueItems > 0 ? `
                                                <div class="prod-module-report-notice">
                                                    <p><strong>Uwaga:</strong> Wykryto ${overdueItems} produktów z przekroczonym deadline. Zaleca się przyspieszenie produkcji.</p>
                                                </div>
                                            ` : `
                                                <div class="prod-module-report-success">
                                                    <p><strong>Świetnie!</strong> Wszystkie produkty są realizowane w terminie.</p>
                                                </div>
                                            `}
                                        </div>
                                    `;
                                } else {
                                    delaysReport.innerHTML = `
                                        <div class="prod-module-report-empty">
                                            <div class="prod-module-report-icon">⏰</div>
                                            <h4>Analiza opóźnień</h4>
                                            <p>Brak produktów w systemie</p>
                                        </div>
                                    `;
                                }
                            }
                            resolve();
                        })
                        .catch(error => {
                            delaysReport.innerHTML = `
                                <div class="prod-module-report-error">
                                    <h4>Błąd ładowania danych</h4>
                                    <p>Nie można przeanalizować opóźnień</p>
                                </div>
                            `;
                            reject(error);
                        });
                } else {
                    resolve();
                }
            }, 1200);
        });
    }
    
    // Usuń starą funkcję updateReportsContent
    
    // ============================================================================
    // FUNKCJE POMOCNICZE
    // ============================================================================
    
    function getPriorityLevel(priorityScore) {
        if (priorityScore >= 800) return 'high';
        if (priorityScore >= 400) return 'medium';
        return 'low';
    }
    
    function getStatusClass(statusName) {
        const statusMap = {
            'pending': 'pending',
            'in_progress': 'in-progress',
            'completed': 'completed',
            'on_hold': 'on-hold'
        };
        return statusMap[statusName] || 'pending';
    }
    
    function formatDate(dateString) {
        if (!dateString) return '-';
        
        const date = new Date(dateString);
        const today = new Date();
        const diffTime = date.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        const formattedDate = date.toLocaleDateString('pl-PL');
        
        if (diffDays < 0) {
            return `<span class="prod-module-before-date">${formattedDate} (${Math.abs(diffDays)} dni temu)</span>`;
        } else if (diffDays === 0) {
            return `<span class="prod-module-today-date">${formattedDate} (dziś)</span>`;
        } else if (diffDays === 1) {
            return `<span class="prod-module-tommorow-date">${formattedDate} (jutro)</span>`;
        } else {
            return `<span class="prod-module-future-date">${formattedDate} (za ${diffDays} dni)</span>`;
        }
    }
    
    function formatDimensions(item) {
        if (item.dimensions_length && item.dimensions_width && item.dimensions_thickness) {
            return `${item.dimensions_length}×${item.dimensions_width}×${item.dimensions_thickness}`;
        }
        return '-';
    }
    
    function showNotification(message, type = 'info') {
        // Usuń istniejące notyfikacje
        const existingNotifications = document.querySelectorAll('.prod-module-notification');
        existingNotifications.forEach(notification => notification.remove());
        
        // Utwórz nową notyfikację
        const notification = document.createElement('div');
        notification.className = `prod-module-notification prod-module-notification-${type}`;
        
        const iconMap = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        notification.innerHTML = `
            <div class="prod-module-notification-content">
                <span class="prod-module-notification-icon">${iconMap[type] || 'ℹ️'}</span>
                <span class="prod-module-notification-message">${message}</span>
                <button class="prod-module-notification-close">×</button>
            </div>
        `;
        
        // Dodaj style dla notyfikacji
        const notificationStyles = `
            .prod-module-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 1000;
                min-width: 300px;
                max-width: 500px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                animation: prod-module-slideIn 0.3s ease;
            }
            
            .prod-module-notification-success {
                border-left: 4px solid #27ae60;
            }
            
            .prod-module-notification-error {
                border-left: 4px solid #e74c3c;
            }
            
            .prod-module-notification-warning {
                border-left: 4px solid #f39c12;
            }
            
            .prod-module-notification-info {
                border-left: 4px solid #3498db;
            }
            
            .prod-module-notification-content {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px;
            }
            
            .prod-module-notification-icon {
                font-size: 20px;
            }
            
            .prod-module-notification-message {
                flex: 1;
                font-size: 14px;
                color: #2c3e50;
            }
            
            .prod-module-notification-close {
                background: none;
                border: none;
                font-size: 18px;
                cursor: pointer;
                color: #7f8c8d;
                padding: 0;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: background-color 0.2s ease;
            }
            
            .prod-module-notification-close:hover {
                background-color: rgba(0,0,0,0.1);
            }
            
            @keyframes prod-module-slideIn {
                from {
                    opacity: 0;
                    transform: translateX(100%);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
        `;
        
        // Dodaj style do head jeśli nie istnieją
        if (!document.getElementById('prod-module-notification-styles')) {
            const styleElement = document.createElement('style');
            styleElement.id = 'prod-module-notification-styles';
            styleElement.textContent = notificationStyles;
            document.head.appendChild(styleElement);
        }
        
        // Dodaj event listener do przycisku zamknięcia
        const closeBtn = notification.querySelector('.prod-module-notification-close');
        closeBtn.addEventListener('click', () => {
            notification.style.animation = 'prod-module-slideIn 0.3s ease reverse';
            setTimeout(() => notification.remove(), 300);
        });
        
        // Dodaj notyfikację do strony
        document.body.appendChild(notification);
        
        // Auto-hide po 5 sekundach
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'prod-module-slideIn 0.3s ease reverse';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, 5000);
        
        console.log(`[Production] Notyfikacja: ${type} - ${message}`);
    }
    
    // ============================================================================
    // FUNKCJE GLOBALNE (dostępne z HTML)
    // ============================================================================
    
    window.editPriority = function(itemId) {
        const newPriority = prompt('Wprowadź nowy priorytet (0-2000):');
        
        if (newPriority === null) return; // Anulowano
        
        const priorityNum = parseInt(newPriority);
        if (isNaN(priorityNum) || priorityNum < 0 || priorityNum > 2000) {
            showNotification('Priorytet musi być liczbą od 0 do 2000', 'warning');
            return;
        }
        
        fetch(`/production/api/items/${itemId}/priority`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                priority_score: priorityNum
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Production] Priorytet zaktualizowany:', data.item);
                showNotification('Priorytet zaktualizowany pomyślnie', 'success');
                loadProductionList(); // Odśwież listę
            } else {
                console.error('[Production] Błąd aktualizacji priorytetu:', data.error);
                showNotification('Błąd aktualizacji priorytetu: ' + data.error, 'error');
            }
        })
        .catch(error => {
            console.error('[Production] Błąd połączenia aktualizacji:', error);
            showNotification('Błąd połączenia podczas aktualizacji', 'error');
        });
    };
    
    window.editWorker = function(workerId) {
        const newName = prompt('Wprowadź nową nazwę pracownika:');
        
        if (newName === null || newName.trim() === '') return; // Anulowano lub puste
        
        // Tutaj będzie implementacja edycji pracownika
        console.log('[Production] Edycja pracownika:', workerId, newName);
        showNotification('Funkcja edycji pracownika w przygotowaniu', 'info');
    };
    
    window.toggleWorkerStatus = function(workerId, currentStatus) {
        const action = currentStatus ? 'dezaktywować' : 'aktywować';
        const confirmed = confirm(`Czy na pewno chcesz ${action} tego pracownika?`);
        
        if (!confirmed) return;
        
        // Tutaj będzie implementacja zmiany statusu pracownika
        console.log('[Production] Zmiana statusu pracownika:', workerId, !currentStatus);
        showNotification('Funkcja zmiany statusu w przygotowaniu', 'info');
    };
    
    // ============================================================================
    // CLEANUP
    // ============================================================================
    
    window.addEventListener('beforeunload', function() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }
    });

    // EKSPORTUJ FUNKCJE dla globalnego dostępu
    window.productionModule = {
        showPriorityExplanation: showPriorityExplanation,
        clearFilters: clearFilters,
        loadProductionList: loadProductionList,
        showChangePositionModal: showChangePositionModal
    };

    console.log('[Production] Funkcje wyeksportowane do globalnego zasięgu');
    
});