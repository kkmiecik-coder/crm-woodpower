/**
 * PACKAGING DASHBOARD - JavaScript Logic
 * Obsługuje interfejs stanowiska pakowania
 */

// === KONFIGURACJA ===
const PACKAGING_CONFIG = {
    refreshInterval: 30000, // 30 sekund - auto-refresh
    apiEndpoints: {
        queue: '/production/api/packaging/queue',
        complete: '/production/api/packaging/complete/{orderId}',
        sync: '/production/api/sync-orders'
    }
};

// === ZMIENNE GLOBALNE ===
let packagingState = {
    orders: [],
    refreshTimer: null,
    lastSync: null,
    isLoading: false
};

// === INICJALIZACJA ===
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 Inicjalizacja Packaging Dashboard');
    initializePackagingDashboard();
});

/**
 * Główna funkcja inicjalizująca
 */
function initializePackagingDashboard() {
    // Binduj eventy
    bindEvents();
    
    // Załaduj dane początkowe
    loadInitialData();
    
    // Uruchom odświeżanie
    startAutoRefresh();
    
    console.log('✅ Packaging Dashboard zainicjalizowany');
}

/**
 * Bindowanie eventów do elementów
 */
function bindEvents() {
    // Przycisk odświeżania
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            refreshAllData();
        });
    }

    // Obsługa błędów globalnych
    window.addEventListener('error', function(event) {
        console.error('Błąd JavaScript:', event.error);
        showNotification('Wystąpił nieoczekiwany błąd', 'error');
    });

    console.log('✅ Eventy zbindowane');
}

/**
 * Ładowanie danych początkowych
 */
async function loadInitialData() {
    console.log('📡 Ładowanie danych początkowych...');
    
    try {
        showLoadingState();
        const orders = await loadPackagingQueue();
        
        if (orders) {
            packagingState.orders = orders;
            renderOrders(orders);
            updateLastSyncTime();
        } else {
            // Fallback - użyj danych testowych jeśli API nie działa
            console.warn('⚠️ API niedostępne, używam danych testowych');
            loadMockData();
        }
        
    } catch (error) {
        console.error('❌ Błąd ładowania danych:', error);
        loadMockData();
        showNotification('Błąd połączenia z serwerem. Używam danych testowych.', 'warning');
    }
}

/**
 * Ładowanie danych testowych (fallback)
 */
function loadMockData() {
    console.log('🔧 Ładowanie danych testowych...');
    
    const mockOrders = [
        {
            id: 1,
            baselinker_order_id: 12345,
            order_number: "2024/08/001",
            customer_name: "Zamówienie #001",
            deadline: "2025-08-29",
            priority: "urgent",
            total_items_count: 5,
            products: [
                { name: "Klejonka dębowa lita A/A 120×30×2.5 cm surowa", qty: 2 },
                { name: "Klejonka bukowa lita B/B 80×25×2.0 cm olejowana", qty: 2 },
                { name: "Klejonka jesionowa mikrowczep A/B 100×35×3.0 cm surowa", qty: 1 }
            ],
            packaging_status: "waiting",
            all_items_glued: true
        },
        {
            id: 2,
            baselinker_order_id: 12346,
            order_number: "2024/08/002", 
            customer_name: "Zamówienie #002",
            deadline: "2025-08-30",
            priority: "medium",
            total_items_count: 3,
            products: [
                { name: "Klejonka dębowa lita A/A 150×40×3.0 cm olejowana", qty: 1 },
                { name: "Klejonka bukowa mikrowczep B/B 90×30×2.5 cm surowa", qty: 2 }
            ],
            packaging_status: "waiting",
            all_items_glued: true
        },
        {
            id: 3,
            baselinker_order_id: 12347,
            order_number: "2024/08/003",
            customer_name: "Zamówienie #003", 
            deadline: "2025-09-02",
            priority: "normal",
            total_items_count: 2,
            products: [
                { name: "Klejonka jesionowa lita A/A 110×35×2.8 cm surowa", qty: 1 },
                { name: "Klejonka dębowa mikrowczep B/B 85×28×2.2 cm olejowana", qty: 1 }
            ],
            packaging_status: "waiting",
            all_items_glued: true
        }
    ];

    setTimeout(() => {
        packagingState.orders = mockOrders;
        renderOrders(mockOrders);
        updateLastSyncTime();
    }, 1000);
}

/**
 * Pobieranie kolejki pakowania z API
 */
async function loadPackagingQueue() {
    try {
        console.log('📡 Pobieranie kolejki pakowania z API...');
        
        const response = await fetch(PACKAGING_CONFIG.apiEndpoints.queue);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('✅ Kolejka pakowania pobrana:', data);
        
        return data.orders || data || [];
        
    } catch (error) {
        console.error('❌ Błąd pobierania kolejki pakowania:', error);
        return null;
    }
}

/**
 * Renderowanie listy zamówień
 */
function renderOrders(orders) {
    const ordersGrid = document.getElementById('ordersGrid');
    const queueCount = document.getElementById('queueCount');
    
    if (!ordersGrid || !queueCount) {
        console.error('❌ Nie znaleziono elementów DOM');
        return;
    }

    // Filtruj tylko zamówienia oczekujące na pakowanie
    const waitingOrders = orders.filter(order => 
        order.all_items_glued === true && order.packaging_status !== 'completed'
    );

    if (waitingOrders.length === 0) {
        ordersGrid.innerHTML = `
            <div class="prod-work-orders-empty">
                <i class="fas fa-inbox"></i>
                <h3>Brak zamówień do pakowania</h3>
                <p>Wszystkie zamówienia zostały spakowane lub czekają na ukończenie produkcji.</p>
            </div>
        `;
        queueCount.textContent = '0';
        return;
    }

    // Sortuj według priorytetu i deadline
    waitingOrders.sort((a, b) => {
        const priorityOrder = { 'urgent': 1, 'medium': 2, 'normal': 3 };
        const priorityDiff = (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
        
        if (priorityDiff !== 0) return priorityDiff;
        
        // Jeśli ten sam priorytet, sortuj według deadline
        return new Date(a.deadline) - new Date(b.deadline);
    });

    ordersGrid.innerHTML = waitingOrders.map(order => `
        <div class="prod-work-order ${order.packaging_status === 'completed' ? 'packed' : ''}" data-order-id="${order.id}">
            <div class="prod-work-order-content">
                <div class="prod-work-order-header">
                    <div class="prod-work-order-number">${order.customer_name}</div>
                    <div class="prod-work-order-deadline ${order.priority}">
                        ${order.packaging_status === 'completed' ? 'SPAKOWANO' : formatDeadline(order.deadline)}
                    </div>
                </div>
                
                <div class="prod-work-order-products">
                    <div class="prod-work-order-products-title">
                        Produkty (${order.total_items_count || getTotalQuantity(order.products)} szt.)
                    </div>
                    ${order.products.map(product => `
                        <div class="prod-work-product-item">
                            <span class="prod-work-product-name">${product.name}</span>
                            <span class="prod-work-product-qty">${product.qty}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="prod-work-order-actions">
                <button class="prod-work-pack-btn" 
                        onclick="markAsPacked(${order.id}, ${order.baselinker_order_id})" 
                        ${order.packaging_status === 'completed' ? 'disabled' : ''}>
                    <i class="fas fa-check"></i>
                    <span>SPAKOWANO</span>
                </button>
            </div>
        </div>
    `).join('');

    queueCount.textContent = waitingOrders.length;
    console.log(`✅ Wyrenderowano ${waitingOrders.length} zamówień`);
}

/**
 * Formatowanie deadline na czytelny tekst
 */
function formatDeadline(deadline) {
    if (!deadline) return 'BRAK';
    
    const date = new Date(deadline);
    const today = new Date();
    
    // Resetuj czas do porównywania tylko dat
    date.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    const diffTime = date - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'OPÓŹNIONE';
    if (diffDays === 0) return 'DZIŚ';
    if (diffDays === 1) return 'JUTRO';
    return `${diffDays} dni`;
}

/**
 * Obliczanie łącznej ilości produktów
 */
function getTotalQuantity(products) {
    if (!products || !Array.isArray(products)) return 0;
    return products.reduce((sum, product) => sum + (product.qty || 0), 0);
}

/**
 * Oznaczenie zamówienia jako spakowane
 */
function markAsPacked(orderId, baselinkerOrderId) {
    console.log(`📦 Pakowanie zamówienia ${orderId} (Baselinker: ${baselinkerOrderId})`);
    
    if (!confirm(`Czy na pewno chcesz oznaczyć zamówienie jako spakowane?`)) {
        return;
    }

    const orderElement = document.querySelector(`[data-order-id="${orderId}"]`);
    const button = orderElement?.querySelector('.prod-work-pack-btn');
    
    if (!orderElement || !button) {
        console.error('❌ Nie znaleziono elementów zamówienia');
        return;
    }

    // Wyłącz przycisk i pokaż loading
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>ZAPISYWANIE...</span>';
    
    // Wykonaj API call
    completePackaging(orderId, baselinkerOrderId)
        .then(success => {
            if (success) {
                // Sukces - oznacz wizualnie jako spakowane
                orderElement.classList.add('packed');
                
                // Zmień deadline na "SPAKOWANO"
                const deadline = orderElement.querySelector('.prod-work-order-deadline');
                if (deadline) {
                    deadline.textContent = 'SPAKOWANO';
                    deadline.className = 'prod-work-order-deadline normal';
                }
                
                // Przywróć przycisk z nowym tekstem
                button.innerHTML = '<i class="fas fa-check"></i><span>SPAKOWANO</span>';
                
                // Aktualizuj licznik kolejki
                const currentCount = parseInt(document.getElementById('queueCount')?.textContent || '0');
                const queueCount = document.getElementById('queueCount');
                if (queueCount) {
                    queueCount.textContent = Math.max(0, currentCount - 1);
                }
                
                // Aktualizuj stan lokalny
                const orderIndex = packagingState.orders.findIndex(o => o.id === orderId);
                if (orderIndex !== -1) {
                    packagingState.orders[orderIndex].packaging_status = 'completed';
                }
                
                showNotification(`Zamówienie ${orderId} zostało spakowane!`, 'success');
                console.log(`✅ Zamówienie ${orderId} spakowane pomyślnie`);
                
            } else {
                // Błąd - przywróć przycisk
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-check"></i><span>SPAKOWANO</span>';
                showNotification('Błąd podczas pakowania zamówienia', 'error');
                console.error(`❌ Błąd pakowania zamówienia ${orderId}`);
            }
        })
        .catch(error => {
            // Błąd - przywróć przycisk
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-check"></i><span>SPAKOWANO</span>';
            showNotification('Błąd komunikacji z serwerem', 'error');
            console.error('❌ Błąd pakowania:', error);
        });
}

/**
 * API call - oznacz zamówienie jako spakowane
 */
async function completePackaging(orderId, baselinkerOrderId) {
    try {
        const url = PACKAGING_CONFIG.apiEndpoints.complete.replace('{orderId}', orderId);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                order_id: orderId,
                baselinker_order_id: baselinkerOrderId,
                action: 'complete_packaging',
                update_baselinker: true,
                timestamp: new Date().toISOString()
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('✅ Pakowanie ukończone:', result);
        
        return result.success === true;
        
    } catch (error) {
        console.error('❌ Błąd API complete packaging:', error);
        return false;
    }
}

/**
 * Odświeżanie wszystkich danych
 */
async function refreshAllData() {
    if (packagingState.isLoading) {
        console.log('⏳ Odświeżanie już w toku...');
        return;
    }

    console.log('🔄 Odświeżanie danych...');
    packagingState.isLoading = true;
    
    const refreshBtn = document.getElementById('refreshBtn');
    const icon = refreshBtn?.querySelector('i');
    
    // Animacja przycisku
    if (icon) {
        icon.classList.add('fa-spin');
    }
    
    try {
        const orders = await loadPackagingQueue();
        
        if (orders) {
            packagingState.orders = orders;
            renderOrders(orders);
            updateLastSyncTime();
            console.log('✅ Dane odświeżone pomyślnie');
        } else {
            console.warn('⚠️ Brak nowych danych');
        }
        
    } catch (error) {
        console.error('❌ Błąd odświeżania:', error);
        showNotification('Błąd odświeżania danych', 'error');
    } finally {
        // Zatrzymaj animację
        if (icon) {
            icon.classList.remove('fa-spin');
        }
        
        packagingState.isLoading = false;
    }
}

/**
 * Automatyczne odświeżanie danych
 */
function startAutoRefresh() {
    // Wyczyść poprzedni timer jeśli istnieje
    if (packagingState.refreshTimer) {
        clearInterval(packagingState.refreshTimer);
    }
    
    packagingState.refreshTimer = setInterval(() => {
        console.log('🔄 Auto-refresh...');
        refreshAllData();
    }, PACKAGING_CONFIG.refreshInterval);
    
    console.log(`✅ Auto-refresh uruchomiony (${PACKAGING_CONFIG.refreshInterval/1000}s)`);
}

/**
 * Aktualizacja czasu ostatniej synchronizacji
 */
function updateLastSyncTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pl-PL', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
    });
    
    const lastSyncElement = document.getElementById('lastSyncTime');
    if (lastSyncElement) {
        lastSyncElement.textContent = timeString;
    }
    
    packagingState.lastSync = now;
    console.log(`🕐 Sync time updated: ${timeString}`);
}

/**
 * Pokazanie stanu ładowania
 */
function showLoadingState() {
    const ordersGrid = document.getElementById('ordersGrid');
    if (ordersGrid) {
        ordersGrid.innerHTML = `
            <div class="prod-work-orders-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Ładowanie zamówień...</span>
            </div>
        `;
    }
}

/**
 * Wyświetlanie powiadomień toast
 */
function showNotification(message, type = 'info') {
    // Usuń poprzednie powiadomienia
    const existingNotifications = document.querySelectorAll('.packaging-notification');
    existingNotifications.forEach(n => n.remove());
    
    const notification = document.createElement('div');
    notification.className = 'packaging-notification';
    
    const bgColor = {
        'success': '#28a745',
        'error': '#dc3545', 
        'warning': '#ffc107',
        'info': '#17a2b8'
    }[type] || '#17a2b8';
    
    const textColor = type === 'warning' ? '#212529' : '#ffffff';
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${bgColor};
        color: ${textColor};
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        font-weight: 600;
        font-size: 14px;
        max-width: 350px;
        word-wrap: break-word;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Auto-remove po 4 sekundach
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 4000);
    
    console.log(`📢 Notification (${type}): ${message}`);
}

/**
 * Cleanup przy opuszczeniu strony
 */
window.addEventListener('beforeunload', function() {
    if (packagingState.refreshTimer) {
        clearInterval(packagingState.refreshTimer);
        console.log('🧹 Auto-refresh zatrzymany');
    }
});

// === EKSPORT DLA DEBUGOWANIA ===
if (typeof window !== 'undefined') {
    window.packagingDebug = {
        state: packagingState,
        config: PACKAGING_CONFIG,
        refreshData: refreshAllData,
        loadQueue: loadPackagingQueue,
        mockData: loadMockData
    };
}