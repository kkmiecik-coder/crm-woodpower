function loadWorkersFromAPI() {
        // Przykład jak będzie wyglądać zapytanie do API pracowników
        // fetch('/production/api/workers')
        //     .then(response => response.json())
        //     .then(data => {
        //         if (data.success) {
        //             updateWorkersList(data.data);
        //         }
        //     })
        //     .catch(error => console.error('Error loading workers:', error));
        
        // Tymczasowo - brak danych
        const workersList = document.getElementById('workersList');
        if (workersList) {
            workersList.innerHTML = '<div class="prod-module-list-placeholder">Brak danych</div>';
        }
    }
    
    // Usuń funkcje loadWorkersList i loadStationsList// ===== PRODUCTION MODULE JAVASCRIPT =====

document.addEventListener('DOMContentLoaded', function() {
    console.log('[Production] Inicjalizacja modułu produkcyjnego...');
    
    // === ZMIENNE GLOBALNE ===
    let refreshTimer = null;
    let refreshCountdown = 30;
    let currentPage = 1;
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
                    refreshCountdown = 30;
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
            
            refreshCountdown = 30;
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
        
        fetch('/production/api/dashboard')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    updateStats(data.data.stats);
                    updateStations(data.data.stations);
                    updateQueue(data.data.queue_preview);
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
    
    // ============================================================================
    // LISTA PRODUKCYJNA
    // ============================================================================
    
    function initProductionList() {
        const applyFiltersBtn = document.getElementById('applyFiltersBtn');
        const clearFiltersBtn = document.getElementById('clearFiltersBtn');
        const prevPageBtn = document.getElementById('prevPageBtn');
        const nextPageBtn = document.getElementById('nextPageBtn');
        
        if (applyFiltersBtn) {
            applyFiltersBtn.addEventListener('click', applyFilters);
        }
        
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', clearFilters);
        }
        
        if (prevPageBtn) {
            prevPageBtn.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    loadProductionList();
                }
            });
        }
        
        if (nextPageBtn) {
            nextPageBtn.addEventListener('click', () => {
                currentPage++;
                loadProductionList();
            });
        }
    }
    
    function loadProductionList() {
        console.log('[Production] Ładowanie listy produkcyjnej...');
        
        const params = new URLSearchParams({
            page: currentPage,
            per_page: 50,
            ...currentFilters
        });
        
        fetch(`/production/api/items?${params}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    updateProductionTable(data.data);
                    updatePagination(data.pagination);
                } else {
                    console.error('[Production] Błąd ładowania listy:', data.error);
                }
            })
            .catch(error => {
                console.error('[Production] Błąd połączenia listy:', error);
            });
    }
    
    function updateProductionTable(items) {
        const tableBody = document.getElementById('productionTableBody');
        if (!tableBody) return;
        
        if (!items || items.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="11" class="prod-module-table-loading">
                        Brak produktów spełniających kryteria
                    </td>
                </tr>
            `;
            return;
        }
        
        tableBody.innerHTML = '';
        
        items.forEach(item => {
            const row = createProductionTableRow(item);
            tableBody.appendChild(row);
        });
        
        console.log('[Production] Tabela produkcyjna zaktualizowana:', items.length);
    }
    
    function createProductionTableRow(item) {
        const row = document.createElement('tr');
        const statusClass = getStatusClass(item.status?.name);
        
        row.innerHTML = `
            <td>${item.id}</td>
            <td title="${item.product_name}">${item.product_name.substring(0, 40)}${item.product_name.length > 40 ? '...' : ''}</td>
            <td>${item.wood_species || '-'}</td>
            <td>${item.wood_technology || '-'}</td>
            <td>${item.wood_class || '-'}</td>
            <td>${formatDimensions(item)}</td>
            <td>${item.quantity}</td>
            <td>${item.priority_score}</td>
            <td>${formatDate(item.deadline_date)}</td>
            <td>
                <span class="prod-module-status-badge prod-module-status-${statusClass}">
                    ${item.status?.display_name || 'N/A'}
                </span>
            </td>
            <td>
                <button class="prod-module-btn-icon" onclick="editPriority(${item.id})" title="Edytuj priorytet">
                    ✏️
                </button>
            </td>
        `;
        
        return row;
    }
    
    function updatePagination(pagination) {
        const pageInfo = document.getElementById('pageInfo');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        
        if (pageInfo) {
            pageInfo.textContent = `Strona ${pagination.page} z ${pagination.pages}`;
        }
        
        if (prevBtn) {
            prevBtn.disabled = !pagination.has_prev;
        }
        
        if (nextBtn) {
            nextBtn.disabled = !pagination.has_next;
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
        
        currentPage = 1;
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
        currentPage = 1;
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
                showNotification(`Priorytety przeliczone: ${data.result.updated_count} produktów`, 'success');
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
            // Na razie symulacja - w przyszłości będzie API call
            setTimeout(() => {
                const workersReport = document.getElementById('workersReport');
                if (workersReport) {
                    // Sprawdź czy są dane w systemie
                    fetch('/production/api/dashboard')
                        .then(response => response.json())
                        .then(data => {
                            if (data.success && data.data.stats.completed_items > 0) {
                                // Są ukończone produkty - pokaż przykładowe dane
                                workersReport.innerHTML = `
                                    <div class="prod-module-report-content-filled">
                                        <h4>Wydajność pracowników</h4>
                                        <div class="prod-module-report-notice">
                                            <p><strong>Uwaga:</strong> To są przykładowe dane. Pełne raporty wydajności będą dostępne po wdrożeniu stanowisk sklejania.</p>
                                        </div>
                                        <div class="prod-module-workers-stats">
                                            <div class="prod-module-worker-stat">
                                                <div class="prod-module-worker-name">Pracownik A</div>
                                                <div class="prod-module-worker-metrics">
                                                    <span>Produkty: 12</span>
                                                    <span>Średni czas: 18 min</span>
                                                    <span>Wydajność: 111%</span>
                                                </div>
                                            </div>
                                            <div class="prod-module-worker-stat">
                                                <div class="prod-module-worker-name">Pracownik B</div>
                                                <div class="prod-module-worker-metrics">
                                                    <span>Produkty: 8</span>
                                                    <span>Średni czas: 22 min</span>
                                                    <span>Wydajność: 91%</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            } else {
                                // Brak ukończonych produktów
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
                } else {
                    resolve();
                }
            }, 500);
        });
    }
    
    function generateStationsReport(dateFrom, dateTo) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                const stationsReport = document.getElementById('stationsReport');
                if (stationsReport) {
                    // Pobierz dane stanowisk
                    fetch('/production/api/stations/status')
                        .then(response => response.json())
                        .then(data => {
                            if (data.success && data.data.length > 0) {
                                let stationsHtml = '<h4>Wydajność stanowisk</h4>';
                                
                                // Sprawdź czy są aktywne stanowiska
                                const activeStations = data.data.filter(station => station.is_active);
                                
                                if (activeStations.length > 0) {
                                    stationsHtml += `
                                        <div class="prod-module-report-notice">
                                            <p><strong>Uwaga:</strong> Raporty wykorzystania będą dostępne po rozpoczęciu produkcji na stanowiskach.</p>
                                        </div>
                                        <div class="prod-module-stations-stats">
                                    `;
                                    
                                    activeStations.forEach(station => {
                                        const utilizationPercent = Math.floor(Math.random() * 40) + 60; // 60-100%
                                        stationsHtml += `
                                            <div class="prod-module-station-stat">
                                                <div class="prod-module-station-name">${station.name}</div>
                                                <div class="prod-module-station-metrics">
                                                    <span>Status: ${station.current_item_id ? 'Zajęte' : 'Wolne'}</span>
                                                    <span>Wykorzystanie: ${utilizationPercent}%</span>
                                                    <span>Typ: ${station.station_type === 'gluing' ? 'Sklejanie' : 'Pakowanie'}</span>
                                                </div>
                                            </div>
                                        `;
                                    });
                                    
                                    stationsHtml += '</div>';
                                } else {
                                    stationsHtml += '<p>Brak aktywnych stanowisk</p>';
                                }
                                
                                stationsReport.innerHTML = `<div class="prod-module-report-content-filled">${stationsHtml}</div>`;
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
                } else {
                    resolve();
                }
            }, 800);
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
            return `${formattedDate} (${Math.abs(diffDays)}d temu)`;
        } else if (diffDays === 0) {
            return `${formattedDate} (dziś)`;
        } else if (diffDays === 1) {
            return `${formattedDate} (jutro)`;
        } else {
            return `${formattedDate} (za ${diffDays}d)`;
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
    
});