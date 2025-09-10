/**
 * Priority Config JavaScript
 * ==========================
 * 
 * Funkcjonalność dla zarządzania priorytetami i listy produktów:
 * - Drag & Drop dla adminów (SortableJS)
 * - Filtrowanie i wyszukiwanie produktów
 * - Modal szczegółów produktu
 * - Ustawianie priorytetów
 * - Real-time aktualizacja listy
 * - Export funkcjonalność
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 1.0
 * Data: 2025-01-10
 */

// ============================================================================
// KONFIGURACJA I ZMIENNE GLOBALNE
// ============================================================================

const ProductsList = {
    // Konfiguracja
    config: {
        refreshInterval: 60000, // 1 minuta
        filterDelay: 300, // Delay dla wyszukiwania
        maxPriority: 200,
        minPriority: 0
    },

    // Stan aplikacji
    state: {
        isLoading: false,
        originalOrder: [],
        currentFilters: {
            status: 'all',
            station: 'all',
            deadline: 'all',
            search: '',
            sortBy: 'priority'
        },
        sortable: null,
        unsavedChanges: false,
        currentProduct: null
    },

    // API endpoints
    endpoints: {
        updatePriority: '/production/api/update-priority',
        productDetails: '/production/api/product-details',
        exportProducts: '/production/api/export-products'
    }
};

// ============================================================================
// INICJALIZACJA
// ============================================================================

/**
 * Inicjalizuje listę produktów
 */
function initProductsList() {
    console.log('[Products List] Inicjalizacja...');

    // Sprawdź dostępność danych
    if (typeof window.productsData === 'undefined') {
        console.warn('[Products List] Brak danych produktów');
        window.productsData = { products: [], isAdmin: false };
    }

    // Zapisz oryginalne dane
    ProductsList.state.originalOrder = [...window.productsData.products];

    // Inicjalizacja komponentów
    initEventListeners();
    initFilterHandlers();

    // Załaduj filtry z URL/localStorage
    loadFiltersFromStorage();

    // Zastosuj filtry
    applyAllFilters();

    console.log('[Products List] Inicjalizacja zakończona');
}

/**
 * Inicjalizuje drag & drop dla adminów
 */
function initDragAndDrop() {
    if (!window.productsData.isAdmin || typeof Sortable === 'undefined') {
        console.log('[Products List] Drag & drop niedostępny');
        return;
    }

    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;

    console.log('[Products List] Inicjalizacja drag & drop...');

    ProductsList.state.sortable = new Sortable(tbody, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',

        onStart: function (evt) {
            console.log('[Drag & Drop] Start:', evt.oldIndex);
            document.body.classList.add('sorting-active');
        },

        onEnd: function (evt) {
            console.log('[Drag & Drop] End:', evt.oldIndex, '->', evt.newIndex);
            document.body.classList.remove('sorting-active');

            if (evt.oldIndex !== evt.newIndex) {
                handlePriorityReorder(evt.oldIndex, evt.newIndex);
            }
        },

        onMove: function (evt) {
            // Opcjonalnie: logika podczas przeciągania
            return true;
        }
    });

    console.log('[Products List] Drag & drop zainicjalizowany');
}

/**
 * Inicjalizuje event listenery
 */
function initEventListeners() {
    // Refresh button
    const refreshBtn = document.getElementById('refresh-products-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshProductsList);
    }

    // Save priorities button
    const savePrioritiesBtn = document.getElementById('save-priorities-btn');
    if (savePrioritiesBtn) {
        savePrioritiesBtn.addEventListener('click', savePriorities);
    }

    // Export button
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportProducts);
    }

    // Modal events
    const priorityModal = document.getElementById('priorityModal');
    if (priorityModal) {
        priorityModal.addEventListener('hidden.bs.modal', function () {
            ProductsList.state.currentProduct = null;
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Przed opuszczeniem strony
    window.addEventListener('beforeunload', handleBeforeUnload);

    console.log('[Products List] Event listenery zainicjalizowane');
}

/**
 * Inicjalizuje handlery filtrów
 */
function initFilterHandlers() {
    // Search input - z debounce
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function () {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                ProductsList.state.currentFilters.search = this.value;
                applyAllFilters();
                saveFiltersToStorage();
            }, ProductsList.config.filterDelay);
        });
    }

    // Select filters
    const filterSelects = ['status-filter', 'station-filter', 'deadline-filter', 'sort-by'];
    filterSelects.forEach(filterId => {
        const element = document.getElementById(filterId);
        if (element) {
            element.addEventListener('change', function () {
                const filterType = filterId.replace('-filter', '').replace('-', '');
                if (filterType === 'sortby') {
                    ProductsList.state.currentFilters.sortBy = this.value;
                } else {
                    ProductsList.state.currentFilters[filterType] = this.value;
                }
                applyAllFilters();
                saveFiltersToStorage();
            });
        }
    });
}

// ============================================================================
// FILTROWANIE I SORTOWANIE
// ============================================================================

/**
 * Stosuje wszystkie filtry do tabeli
 */
function applyAllFilters() {
    const rows = document.querySelectorAll('#products-tbody .product-row');
    let visibleCount = 0;
    let overdueCount = 0;
    let urgentCount = 0;

    rows.forEach(row => {
        const shouldShow = shouldShowRow(row);

        row.style.display = shouldShow ? '' : 'none';

        if (shouldShow) {
            visibleCount++;

            // Policz alerty deadline
            const deadlineCell = row.querySelector('.deadline-remaining');
            if (deadlineCell) {
                if (deadlineCell.classList.contains('deadline-overdue')) {
                    overdueCount++;
                } else if (deadlineCell.classList.contains('deadline-urgent')) {
                    urgentCount++;
                }
            }
        }
    });

    // Sortowanie widocznych wierszy
    sortVisibleRows();

    // Aktualizuj statystyki
    updateFilterStats(visibleCount, overdueCount, urgentCount);

    // Aktualizuj stan przycisków
    updateActionButtons();
}

/**
 * Sprawdza czy wiersz powinien być widoczny
 */
function shouldShowRow(row) {
    const filters = ProductsList.state.currentFilters;

    // Filtr statusu
    if (filters.status !== 'all') {
        const status = row.dataset.status;
        if (status !== filters.status) return false;
    }

    // Filtr stanowiska
    if (filters.station !== 'all') {
        const status = row.dataset.status;
        const stationMap = {
            'cutting': 'czeka_na_wyciecie',
            'assembly': 'czeka_na_skladanie',
            'packaging': 'czeka_na_pakowanie'
        };
        if (status !== stationMap[filters.station]) return false;
    }

    // Filtr deadline
    if (filters.deadline !== 'all') {
        const deadlineStr = row.dataset.deadline;
        if (!deadlineStr && filters.deadline !== 'all') return false;

        if (deadlineStr) {
            const deadline = new Date(deadlineStr);
            const today = new Date();
            const diffTime = deadline.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            switch (filters.deadline) {
                case 'overdue':
                    if (diffDays >= 0) return false;
                    break;
                case 'urgent':
                    if (diffDays < 0 || diffDays > 2) return false;
                    break;
                case 'soon':
                    if (diffDays < 0 || diffDays > 7) return false;
                    break;
                case 'normal':
                    if (diffDays <= 7) return false;
                    break;
            }
        }
    }

    // Filtr wyszukiwania
    if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        const orderId = row.dataset.orderId.toLowerCase();
        const client = row.dataset.client.toLowerCase();
        const productName = row.querySelector('.product-name').textContent.toLowerCase();

        if (!orderId.includes(searchTerm) &&
            !client.includes(searchTerm) &&
            !productName.includes(searchTerm)) {
            return false;
        }
    }

    return true;
}

/**
 * Sortuje widoczne wiersze
 */
function sortVisibleRows() {
    const tbody = document.getElementById('products-tbody');
    const rows = Array.from(tbody.querySelectorAll('.product-row[style=""], .product-row:not([style])'));
    const sortBy = ProductsList.state.currentFilters.sortBy;

    rows.sort((a, b) => {
        switch (sortBy) {
            case 'priority':
                return parseInt(b.dataset.priority) - parseInt(a.dataset.priority);
            case 'deadline':
                const aDeadline = a.dataset.deadline ? new Date(a.dataset.deadline) : new Date('2099-12-31');
                const bDeadline = b.dataset.deadline ? new Date(b.dataset.deadline) : new Date('2099-12-31');
                return aDeadline - bDeadline;
            case 'created_at':
                return new Date(b.dataset.created) - new Date(a.dataset.created);
            case 'order_id':
                return a.dataset.orderId.localeCompare(b.dataset.orderId);
            default:
                return 0;
        }
    });

    // Przebuduj DOM
    rows.forEach(row => tbody.appendChild(row));
}

/**
 * Aktualizuje statystyki filtrów
 */
function updateFilterStats(visible, overdue, urgent) {
    const visibleElement = document.getElementById('visible-count');
    const overdueElement = document.getElementById('overdue-count');
    const urgentElement = document.getElementById('urgent-count');

    if (visibleElement) visibleElement.textContent = visible;
    if (overdueElement) overdueElement.textContent = overdue;
    if (urgentElement) urgentElement.textContent = urgent;
}

/**
 * Aktualizuje stan przycisków akcji
 */
function updateActionButtons() {
    const savePrioritiesBtn = document.getElementById('save-priorities-btn');
    if (savePrioritiesBtn) {
        savePrioritiesBtn.style.display = ProductsList.state.unsavedChanges ? '' : 'none';
    }
}

// ============================================================================
// DRAG & DROP FUNCTIONALITY
// ============================================================================

/**
 * Obsługuje zmianę kolejności priorytetów
 */
function handlePriorityReorder(oldIndex, newIndex) {
    console.log('[Priority Reorder] Zmiana:', oldIndex, '->', newIndex);

    const rows = document.querySelectorAll('#products-tbody .product-row[style=""], #products-tbody .product-row:not([style])');
    const totalRows = rows.length;

    // Przelicz nowe priorytety na podstawie pozycji
    rows.forEach((row, index) => {
        const newPriority = Math.round(200 - (index / Math.max(totalRows - 1, 1)) * 200);
        const priorityElement = row.querySelector('.priority-score');
        const priorityBar = row.querySelector('.priority-fill');

        if (priorityElement) {
            priorityElement.textContent = newPriority;
            row.dataset.priority = newPriority;
        }

        if (priorityBar) {
            priorityBar.style.width = (newPriority / 2) + '%';
        }
    });

    // Oznacz jako niezapisane zmiany
    ProductsList.state.unsavedChanges = true;
    updateActionButtons();

    // Pokaż notyfikację
    showNotification('Priorytety zostały zmienione. Pamiętaj o zapisaniu!', 'info');
}

/**
 * Zapisuje zmiany priorytetów
 */
async function savePriorities() {
    if (!ProductsList.state.unsavedChanges) {
        showNotification('Brak zmian do zapisania', 'info');
        return;
    }

    const savePrioritiesBtn = document.getElementById('save-priorities-btn');
    if (savePrioritiesBtn) {
        savePrioritiesBtn.disabled = true;
        savePrioritiesBtn.innerHTML = '<span class="quick-action-icon">⏳</span>Zapisywanie...';
    }

    try {
        // Zbierz wszystkie zmiany priorytetów
        const priorities = [];
        const rows = document.querySelectorAll('#products-tbody .product-row');

        rows.forEach(row => {
            const productId = row.dataset.productId;
            const currentPriority = parseInt(row.dataset.priority);
            const originalPriority = parseInt(row.querySelector('.priority-score').dataset.original);

            if (currentPriority !== originalPriority) {
                priorities.push({
                    product_id: productId,
                    new_priority: currentPriority,
                    old_priority: originalPriority
                });
            }
        });

        if (priorities.length === 0) {
            showNotification('Brak zmian do zapisania', 'info');
            return;
        }

        console.log('[Save Priorities] Zapisywanie:', priorities.length, 'zmian');

        const response = await fetch(ProductsList.endpoints.updatePriority, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin',
            body: JSON.stringify({
                priorities: priorities,
                reason: 'Drag & drop reorder'
            })
        });

        const data = await response.json();

        if (data.success) {
            // Zaktualizuj oryginalne wartości
            rows.forEach(row => {
                const priorityScore = row.querySelector('.priority-score');
                if (priorityScore) {
                    priorityScore.dataset.original = row.dataset.priority;
                }
            });

            ProductsList.state.unsavedChanges = false;
            updateActionButtons();

            showNotification(`Zapisano ${priorities.length} zmian priorytetów`, 'success');
        } else {
            throw new Error(data.error || 'Błąd zapisywania priorytetów');
        }

    } catch (error) {
        console.error('[Save Priorities] Błąd:', error);
        showNotification('Błąd zapisywania priorytetów: ' + error.message, 'error');
    } finally {
        if (savePrioritiesBtn) {
            savePrioritiesBtn.disabled = false;
            savePrioritiesBtn.innerHTML = '<span class="quick-action-icon">💾</span>Zapisz Priorytety';
        }
    }
}

// ============================================================================
// MODAL FUNCTIONALITY
// ============================================================================

/**
 * Wyświetla szczegóły produktu
 */
async function viewProduct(productId) {
    console.log('[View Product] ID:', productId);

    const modal = new bootstrap.Modal(document.getElementById('productModal'));
    const modalBody = document.getElementById('productModalBody');

    // Pokaż loading
    modalBody.innerHTML = '<div class="text-center p-4"><div class="spinner-border" role="status"></div><p>Ładowanie szczegółów...</p></div>';
    modal.show();

    try {
        const response = await fetch(`${ProductsList.endpoints.productDetails}/${productId}`, {
            credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
            modalBody.innerHTML = generateProductDetailsHtml(data.product);
        } else {
            throw new Error(data.error || 'Błąd ładowania szczegółów');
        }

    } catch (error) {
        console.error('[View Product] Błąd:', error);
        modalBody.innerHTML = `<div class="alert alert-danger">Błąd ładowania szczegółów: ${error.message}</div>`;
    }
}

/**
 * Generuje HTML dla szczegółów produktu
 */
function generateProductDetailsHtml(product) {
    return `
        <div class="product-details">
            <div class="row">
                <div class="col-md-6">
                    <h6>Informacje podstawowe</h6>
                    <dl class="row">
                        <dt class="col-sm-4">ID zamówienia:</dt>
                        <dd class="col-sm-8">${product.internal_order_number}</dd>
                        <dt class="col-sm-4">Baselinker ID:</dt>
                        <dd class="col-sm-8">${product.baselinker_order_id || 'Brak'}</dd>
                        <dt class="col-sm-4">Status:</dt>
                        <dd class="col-sm-8"><span class="badge status-${product.current_status?.replace('_', '-')}">${getStatusDisplay(product.current_status)}</span></dd>
                        <dt class="col-sm-4">Priorytet:</dt>
                        <dd class="col-sm-8">${product.priority_score || 0}</dd>
                    </dl>
                </div>
                <div class="col-md-6">
                    <h6>Terminy</h6>
                    <dl class="row">
                        <dt class="col-sm-4">Utworzono:</dt>
                        <dd class="col-sm-8">${formatDateTime(product.created_at)}</dd>
                        <dt class="col-sm-4">Deadline:</dt>
                        <dd class="col-sm-8">${product.deadline_date ? formatDate(product.deadline_date) : 'Brak'}</dd>
                        <dt class="col-sm-4">Ostatnia aktualizacja:</dt>
                        <dd class="col-sm-8">${formatDateTime(product.updated_at)}</dd>
                    </dl>
                </div>
            </div>
            <div class="row mt-3">
                <div class="col-12">
                    <h6>Produkt</h6>
                    <p><strong>${product.original_product_name}</strong></p>
                    ${product.parsed_data ? generateParsedDataHtml(product.parsed_data) : ''}
                </div>
            </div>
        </div>
    `;
}

/**
 * Otwiera modal ustawiania priorytetu
 */
function setPriority(productId) {
    console.log('[Set Priority] ID:', productId);

    ProductsList.state.currentProduct = productId;

    const row = document.querySelector(`[data-product-id="${productId}"]`);
    const currentPriority = row ? parseInt(row.dataset.priority) : 0;

    const priorityInput = document.getElementById('priorityValue');
    const priorityReason = document.getElementById('priorityReason');

    if (priorityInput) priorityInput.value = currentPriority;
    if (priorityReason) priorityReason.value = '';

    const modal = new bootstrap.Modal(document.getElementById('priorityModal'));
    modal.show();
}

/**
 * Zapisuje zmianę priorytetu
 */
async function savePriorityChange() {
    const productId = ProductsList.state.currentProduct;
    const priorityInput = document.getElementById('priorityValue');
    const priorityReason = document.getElementById('priorityReason');

    if (!productId || !priorityInput) return;

    const newPriority = parseInt(priorityInput.value);
    const reason = priorityReason.value.trim();

    if (newPriority < ProductsList.config.minPriority || newPriority > ProductsList.config.maxPriority) {
        showNotification(`Priorytet musi być między ${ProductsList.config.minPriority} a ${ProductsList.config.maxPriority}`, 'error');
        return;
    }

    try {
        const response = await fetch(ProductsList.endpoints.updatePriority, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin',
            body: JSON.stringify({
                priorities: [{
                    product_id: productId,
                    new_priority: newPriority
                }],
                reason: reason || 'Manual priority change'
            })
        });

        const data = await response.json();

        if (data.success) {
            // Zaktualizuj UI
            const row = document.querySelector(`[data-product-id="${productId}"]`);
            if (row) {
                const priorityScore = row.querySelector('.priority-score');
                const priorityBar = row.querySelector('.priority-fill');

                if (priorityScore) {
                    priorityScore.textContent = newPriority;
                    priorityScore.dataset.original = newPriority;
                }

                if (priorityBar) {
                    priorityBar.style.width = (newPriority / 2) + '%';
                }

                row.dataset.priority = newPriority;
            }

            // Zamknij modal
            bootstrap.Modal.getInstance(document.getElementById('priorityModal')).hide();

            // Przefiltruj i posortuj
            applyAllFilters();

            showNotification('Priorytet został zaktualizowany', 'success');
        } else {
            throw new Error(data.error || 'Błąd aktualizacji priorytetu');
        }

    } catch (error) {
        console.error('[Save Priority] Błąd:', error);
        showNotification('Błąd aktualizacji priorytetu: ' + error.message, 'error');
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Odświeża listę produktów
 */
async function refreshProductsList() {
    const refreshBtn = document.getElementById('refresh-products-btn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<span class="quick-action-icon">⏳</span>Odświeżanie...';
    }

    try {
        // Przeładuj stronę z zachowaniem filtrów
        const url = new URL(window.location);
        url.searchParams.set('refresh', Date.now());
        window.location.href = url.toString();

    } catch (error) {
        console.error('[Refresh Products] Błąd:', error);
        showNotification('Błąd odświeżania listy', 'error');
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<span class="quick-action-icon">🔄</span>Odśwież';
        }
    }
}

/**
 * Eksportuje listę produktów
 */
async function exportProducts() {
    console.log('[Export Products] Start...');

    try {
        const response = await fetch(ProductsList.endpoints.exportProducts, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'same-origin',
            body: JSON.stringify({
                filters: ProductsList.state.currentFilters
            })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `produkty_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showNotification('Lista produktów została wyeksportowana', 'success');
        } else {
            throw new Error('Błąd eksportu');
        }

    } catch (error) {
        console.error('[Export Products] Błąd:', error);
        showNotification('Błąd eksportu listy produktów', 'error');
    }
}

/**
 * Czyści wszystkie filtry
 */
function clearAllFilters() {
    const searchInput = document.getElementById('search-input');
    const statusFilter = document.getElementById('status-filter');
    const stationFilter = document.getElementById('station-filter');
    const deadlineFilter = document.getElementById('deadline-filter');
    const sortBy = document.getElementById('sort-by');

    if (searchInput) searchInput.value = '';
    if (statusFilter) statusFilter.value = 'all';
    if (stationFilter) stationFilter.value = 'all';
    if (deadlineFilter) deadlineFilter.value = 'all';
    if (sortBy) sortBy.value = 'priority';

    ProductsList.state.currentFilters = {
        status: 'all',
        station: 'all',
        deadline: 'all',
        search: '',
        sortBy: 'priority'
    };

    applyAllFilters();
    saveFiltersToStorage();
}

/**
 * Czyści wyszukiwanie
 */
function clearSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = '';
        ProductsList.state.currentFilters.search = '';
        applyAllFilters();
        saveFiltersToStorage();
    }
}

/**
 * Aktualizuje statystyki produktów
 */
function updateProductsStats() {
    const totalProducts = window.productsData.products.length;
    const productsCountElement = document.getElementById('products-count');

    if (productsCountElement) {
        productsCountElement.textContent = `${totalProducts} produktów`;
    }

    // Zaktualizuj timestamp
    const updatedElement = document.getElementById('products-updated');
    if (updatedElement) {
        updatedElement.textContent = `Aktualizacja: ${formatTime(new Date())}`;
    }
}

/**
 * Obsługuje skróty klawiszowe
 */
function handleKeyboardShortcuts(event) {
    // Ctrl + R - refresh
    if (event.ctrlKey && event.key === 'r') {
        event.preventDefault();
        refreshProductsList();
        return;
    }

    // Ctrl + S - save priorities (dla adminów)
    if (event.ctrlKey && event.key === 's' && window.productsData.isAdmin) {
        event.preventDefault();
        if (ProductsList.state.unsavedChanges) {
            savePriorities();
        }
        return;
    }

    // Escape - clear search
    if (event.key === 'Escape') {
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput === document.activeElement) {
            clearSearch();
        }
    }
}

/**
 * Obsługuje przed opuszczeniem strony
 */
function handleBeforeUnload(event) {
    if (ProductsList.state.unsavedChanges) {
        event.preventDefault();
        event.returnValue = 'Masz niezapisane zmiany priorytetów. Czy na pewno chcesz opuścić stronę?';
    }
}

/**
 * Zapisuje filtry do localStorage
 */
function saveFiltersToStorage() {
    try {
        localStorage.setItem('production_filters', JSON.stringify(ProductsList.state.currentFilters));
    } catch (error) {
        console.warn('[Storage] Błąd zapisywania filtrów:', error);
    }
}

/**
 * Ładuje filtry z localStorage
 */
function loadFiltersFromStorage() {
    try {
        const saved = localStorage.getItem('production_filters');
        if (saved) {
            const filters = JSON.parse(saved);
            ProductsList.state.currentFilters = { ...ProductsList.state.currentFilters, ...filters };

            // Zastosuj do UI
            const searchInput = document.getElementById('search-input');
            const statusFilter = document.getElementById('status-filter');
            const stationFilter = document.getElementById('station-filter');
            const deadlineFilter = document.getElementById('deadline-filter');
            const sortBy = document.getElementById('sort-by');

            if (searchInput && filters.search) searchInput.value = filters.search;
            if (statusFilter && filters.status) statusFilter.value = filters.status;
            if (stationFilter && filters.station) stationFilter.value = filters.station;
            if (deadlineFilter && filters.deadline) deadlineFilter.value = filters.deadline;
            if (sortBy && filters.sortBy) sortBy.value = filters.sortBy;
        }
    } catch (error) {
        console.warn('[Storage] Błąd ładowania filtrów:', error);
    }
}

/**
 * Formatuje datę i czas
 */
function formatDateTime(dateString) {
    if (!dateString) return 'Brak';
    const date = new Date(dateString);
    return date.toLocaleString('pl-PL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Formatuje datę
 */
function formatDate(dateString) {
    if (!dateString) return 'Brak';
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL');
}

/**
 * Formatuje czas
 */
function formatTime(date) {
    return date.toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Zwraca wyświetlaną nazwę statusu
 */
function getStatusDisplay(status) {
    const statusMap = {
        'czeka_na_wyciecie': 'Czeka na wycięcie',
        'czeka_na_skladanie': 'Czeka na składanie',
        'czeka_na_pakowanie': 'Czeka na pakowanie',
        'spakowane': 'Spakowane',
        'wstrzymane': 'Wstrzymane'
    };
    return statusMap[status] || status || 'Nieznany';
}

/**
 * Generuje HTML dla sparsowanych danych produktu
 */
function generateParsedDataHtml(parsedData) {
    let html = '<div class="parsed-data mt-2"><h6>Dane sparsowane:</h6><dl class="row">';

    if (parsedData.dimensions) {
        html += `<dt class="col-sm-3">Wymiary:</dt><dd class="col-sm-9">${parsedData.dimensions}</dd>`;
    }

    if (parsedData.volume_m3) {
        html += `<dt class="col-sm-3">Objętość:</dt><dd class="col-sm-9">${parsedData.volume_m3} m³</dd>`;
    }

    if (parsedData.wood_species) {
        html += `<dt class="col-sm-3">Gatunek:</dt><dd class="col-sm-9">${parsedData.wood_species}</dd>`;
    }

    if (parsedData.wood_class) {
        html += `<dt class="col-sm-3">Klasa:</dt><dd class="col-sm-9">${parsedData.wood_class}</dd>`;
    }

    if (parsedData.finish_state) {
        html += `<dt class="col-sm-3">Wykończenie:</dt><dd class="col-sm-9">${parsedData.finish_state}</dd>`;
    }

    html += '</dl></div>';
    return html;
}

/**
 * Pokazuje notyfikację użytkownikowi
 */
function showNotification(message, type = 'info') {
    // Sprawdź czy istnieje system notyfikacji w głównej aplikacji
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    } else {
        // Fallback - prosty alert lub console
        console.log(`[Notification ${type.toUpperCase()}] ${message}`);

        // Możemy dodać prosty toast fallback
        createSimpleToast(message, type);
    }
}

/**
 * Tworzy prosty toast jako fallback
 */
function createSimpleToast(message, type) {
    // Sprawdź czy container już istnieje
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(container);
    }

    // Utwórz toast
    const toast = document.createElement('div');
    toast.style.cssText = `
        background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff'};
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        font-size: 14px;
        max-width: 300px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;

    // Dodaj style animacji jeśli nie istnieją
    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(toast);

    // Usuń po 3 sekundach
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                container.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// ============================================================================
// EXPORT / GLOBAL ACCESS
// ============================================================================

// Udostępnij funkcje globalnie (dla onclick w HTML)
window.filterProducts = applyAllFilters;
window.sortProducts = applyAllFilters;
window.refreshProductsList = refreshProductsList;
window.exportProducts = exportProducts;
window.clearAllFilters = clearAllFilters;
window.clearSearch = clearSearch;
window.viewProduct = viewProduct;
window.editProduct = function (productId) {
    console.log('[Edit Product] ID:', productId, '- funkcja do implementacji');
    showNotification('Funkcja edycji produktu w przygotowaniu', 'info');
};
window.setPriority = setPriority;
window.savePriorities = savePriorities;
window.savePriorityChange = savePriorityChange;

// Eksport głównego obiektu
window.ProductsList = ProductsList;

console.log('[Priority Config] Moduł załadowany pomyślnie');