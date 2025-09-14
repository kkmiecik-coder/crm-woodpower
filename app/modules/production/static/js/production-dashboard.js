/**
 * Production Dashboard JavaScript - SYSTEM TABÓW
 * ===============================================
 * 
 * Nowy JavaScript dedykowany dla systemu tabów AJAX.
 * Zastępuje stary system przycisków.
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 3.0 - System tabów
 * Data: 2025-09-14
 */

// ============================================================================
// KONFIGURACJA GLOBALNA
// ============================================================================

const TabDashboard = {
    // Stan aplikacji
    state: {
        currentActiveTab: 'dashboard-tab',
        refreshInterval: null,
        isLoading: false,
        retryCount: 0
    },
    
    // Konfiguracja
    config: {
        refreshIntervalMs: 180000, // 3 minuty
        maxRetries: 3,
        retryDelayMs: 2000
    },
    
    // Endpointy - będą ustawione z window.productionConfig
    endpoints: {}
};

// ============================================================================
// INICJALIZACJA
// ============================================================================

/**
 * Główna funkcja inicjalizacji - uruchamiana po załadowaniu DOM
 */
function initTabDashboard() {
    console.log('[Tab Dashboard] Inicjalizacja systemu tabów...');
    
    // Sprawdź dostępność konfiguracji
    if (typeof window.productionConfig !== 'undefined') {
        TabDashboard.endpoints = window.productionConfig.endpoints;
        console.log('[Tab Dashboard] Załadowano endpointy:', TabDashboard.endpoints);
    } else {
        console.error('[Tab Dashboard] Brak window.productionConfig - używam fallback');
        TabDashboard.endpoints = {
            dashboardTabContent: '/production/api/dashboard-tab-content',
            productsTabContent: '/production/api/products-tab-content',
            reportsTabContent: '/production/api/reports-tab-content',
            stationsTabContent: '/production/api/stations-tab-content',
            configTabContent: '/production/api/config-tab-content'
        };
    }
    
    // Inicjalizuj komponenty
    initTabEventListeners();
    setupAutoRefresh();
    updateSystemStatus('loading', 'Inicjalizacja systemu...');
    
    // Załaduj pierwszy tab
    loadTabContent('dashboard-tab');
    
    console.log('[Tab Dashboard] Inicjalizacja zakończona');
}

/**
 * Inicjalizuje event listenery dla tabów
 */
function initTabEventListeners() {
    // Tab buttons
    document.querySelectorAll('[data-bs-toggle="tab"]').forEach(tabButton => {
        tabButton.addEventListener('click', handleTabClick);
    });
    
    // System refresh button
    const refreshBtn = document.getElementById('refresh-system-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', handleSystemRefresh);
    }
    
    // Obsługa ukrywania/pokazywania strony
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    console.log('[Tab Dashboard] Event listenery zainicjalizowane');
}

/**
 * Ustawia auto-refresh dla aktywnego taba
 */
function setupAutoRefresh() {
    // Wyczyść poprzedni interval
    if (TabDashboard.state.refreshInterval) {
        clearInterval(TabDashboard.state.refreshInterval);
    }
    
    // Ustaw nowy interval
    TabDashboard.state.refreshInterval = setInterval(() => {
        if (!document.hidden && !TabDashboard.state.isLoading) {
            console.log(`[Tab Dashboard] Auto-refresh dla taba: ${TabDashboard.state.currentActiveTab}`);
            loadTabContent(TabDashboard.state.currentActiveTab, true); // silent refresh
        }
    }, TabDashboard.config.refreshIntervalMs);
    
    console.log(`[Tab Dashboard] Auto-refresh ustawiony na ${TabDashboard.config.refreshIntervalMs/1000/60} minut`);
}

// ============================================================================
// ŁADOWANIE TABÓW AJAX
// ============================================================================

/**
 * Główna funkcja ładowania zawartości tabów przez AJAX
 */
async function loadTabContent(tabName, silentRefresh = false) {
    console.log(`[Tab Dashboard] Ładowanie taba: ${tabName}, silent: ${silentRefresh}`);
    
    // Ustaw aktywny tab
    TabDashboard.state.currentActiveTab = tabName;
    
    // Elementy DOM
    const loadingElement = document.getElementById(`${tabName}-loading`);
    const wrapperElement = document.getElementById(`${tabName}-wrapper`);
    const errorElement = document.getElementById(`${tabName}-error`);
    
    if (!loadingElement || !wrapperElement || !errorElement) {
        console.error(`[Tab Dashboard] Nie znaleziono elementów DOM dla taba: ${tabName}`);
        return;
    }
    
    // Pokaż loading tylko jeśli nie jest to silent refresh
    if (!silentRefresh) {
        loadingElement.style.display = 'block';
        wrapperElement.style.display = 'none';
        errorElement.style.display = 'none';
        TabDashboard.state.isLoading = true;
    }
    
    try {
        // Określ endpoint
        const endpointKey = getEndpointKey(tabName);
        const endpoint = TabDashboard.endpoints[endpointKey];
        
        if (!endpoint) {
            throw new Error(`Brak endpointu dla taba: ${tabName}`);
        }
        
        console.log(`[Tab Dashboard] Wywołuję endpoint: ${endpoint}`);
        
        // Wywołaj API
        const response = await fetch(endpoint, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Nieznany błąd API');
        }
        
        // Wstaw HTML do kontenera
        wrapperElement.innerHTML = data.html;
        
        // Ukryj loading, pokaż zawartość
        loadingElement.style.display = 'none';
        wrapperElement.style.display = 'block';
        errorElement.style.display = 'none';
        
        // Wywołaj callback dla taba
        executeTabCallback(tabName, data);
        
        // Reset retry counter
        TabDashboard.state.retryCount = 0;
        
        // Aktualizuj status systemu
        if (!silentRefresh) {
            updateSystemStatus('active', 'System aktywny');
        }
        
        console.log(`[Tab Dashboard] Tab ${tabName} załadowany pomyślnie`);
        
    } catch (error) {
        console.error(`[Tab Dashboard] Błąd ładowania taba ${tabName}:`, error);
        handleTabLoadError(tabName, error, silentRefresh);
    } finally {
        TabDashboard.state.isLoading = false;
    }
}

/**
 * Obsługuje błędy ładowania tabów
 */
function handleTabLoadError(tabName, error, silentRefresh) {
    const loadingElement = document.getElementById(`${tabName}-loading`);
    const wrapperElement = document.getElementById(`${tabName}-wrapper`);
    const errorElement = document.getElementById(`${tabName}-error`);
    const errorMessageElement = document.getElementById(`${tabName}-error-message`);
    
    if (!silentRefresh) {
        // Pokaż błąd tylko jeśli nie jest to silent refresh
        loadingElement.style.display = 'none';
        wrapperElement.style.display = 'none';
        errorElement.style.display = 'block';
        
        if (errorMessageElement) {
            errorMessageElement.textContent = error.message;
        }
        
        updateSystemStatus('error', `Błąd ładowania: ${error.message}`);
    }
    
    // Retry logic
    TabDashboard.state.retryCount++;
    
    if (TabDashboard.state.retryCount < TabDashboard.config.maxRetries) {
        console.log(`[Tab Dashboard] Ponowna próba ${TabDashboard.state.retryCount}/${TabDashboard.config.maxRetries} za ${TabDashboard.config.retryDelayMs}ms`);
        
        setTimeout(() => {
            loadTabContent(tabName, silentRefresh);
        }, TabDashboard.config.retryDelayMs);
    } else {
        console.error(`[Tab Dashboard] Przekroczono maksymalną liczbę prób dla taba: ${tabName}`);
    }
}

/**
 * Wykonuje callback dla załadowanego taba
 */
function executeTabCallback(tabName, data) {
    const callbackName = getTabCallbackName(tabName);
    
    if (typeof window[callbackName] === 'function') {
        console.log(`[Tab Dashboard] Wykonuję callback: ${callbackName}`);
        try {
            window[callbackName](data);
        } catch (error) {
            console.error(`[Tab Dashboard] Błąd callbacku ${callbackName}:`, error);
        }
    } else {
        console.log(`[Tab Dashboard] Brak callbacku ${callbackName} - pomijam`);
    }
}

// ============================================================================
// OBSŁUGA ZDARZEŃ
// ============================================================================

/**
 * Obsługuje kliknięcia w taby
 */
function handleTabClick(event) {
    const tabButton = event.currentTarget;
    const targetId = tabButton.getAttribute('data-bs-target');
    
    if (!targetId) {
        console.error('[Tab Dashboard] Brak data-bs-target w przycisku taba');
        return;
    }
    
    // Wyciągnij nazwę taba z ID (np. "#dashboard-tab-content" -> "dashboard-tab")
    const tabName = targetId.replace('#', '').replace('-content', '');
    
    console.log(`[Tab Dashboard] Kliknięto tab: ${tabName}`);
    
    // Załaduj zawartość taba
    loadTabContent(tabName);
}

/**
 * Obsługuje odświeżanie systemu
 */
async function handleSystemRefresh() {
    console.log('[Tab Dashboard] Odświeżanie systemu...');
    
    const refreshBtn = document.getElementById('refresh-system-btn');
    const refreshIcon = refreshBtn?.querySelector('.refresh-icon');
    const refreshText = refreshBtn?.querySelector('.refresh-text');
    const refreshTimer = document.getElementById('refresh-timer');
    
    // Wyłącz przycisk
    if (refreshBtn) refreshBtn.disabled = true;
    if (refreshIcon) refreshIcon.textContent = '⏳';
    if (refreshText) refreshText.textContent = 'Odświeżanie...';
    
    try {
        // Odśwież aktywny tab
        await loadTabContent(TabDashboard.state.currentActiveTab);
        
        showNotification('System odświeżony pomyślnie', 'success');
        
        // Uruchom timer cooldown
        startRefreshCooldown();
        
    } catch (error) {
        console.error('[Tab Dashboard] Błąd odświeżania:', error);
        showNotification('Błąd odświeżania systemu', 'error');
    } finally {
        // Przywróć przycisk
        if (refreshBtn) refreshBtn.disabled = false;
        if (refreshIcon) refreshIcon.textContent = '🔄';
        if (refreshText) refreshText.textContent = 'Odśwież system';
    }
}

/**
 * Obsługuje zmianę widoczności strony
 */
function handleVisibilityChange() {
    if (document.hidden) {
        console.log('[Tab Dashboard] Strona ukryta - wstrzymanie auto-refresh');
    } else {
        console.log('[Tab Dashboard] Strona widoczna - wznowienie auto-refresh');
        // Odśwież aktywny tab po powrocie
        if (!TabDashboard.state.isLoading) {
            loadTabContent(TabDashboard.state.currentActiveTab, true);
        }
    }
}

// ============================================================================
// FUNKCJE POMOCNICZE
// ============================================================================

/**
 * Zwraca klucz endpointu na podstawie nazwy taba
 */
function getEndpointKey(tabName) {
    const mapping = {
        'dashboard-tab': 'dashboardTabContent',
        'products-tab': 'productsTabContent',
        'reports-tab': 'reportsTabContent',
        'stations-tab': 'stationsTabContent',
        'config-tab': 'configTabContent'
    };
    
    return mapping[tabName];
}

/**
 * Zwraca nazwę callbacku na podstawie nazwy taba
 */
function getTabCallbackName(tabName) {
    const mapping = {
        'dashboard-tab': 'onDashboardTabLoaded',
        'products-tab': 'onProductsTabLoaded',
        'reports-tab': 'onReportsTabLoaded',
        'stations-tab': 'onStationsTabLoaded',
        'config-tab': 'onConfigTabLoaded'
    };
    
    return mapping[tabName];
}

/**
 * Aktualizuje status systemu w headerze
 */
function updateSystemStatus(status, message) {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    
    if (indicator) {
        indicator.className = `status-indicator ${status}`;
    }
    
    if (text) {
        text.textContent = message;
    }
    
    console.log(`[Tab Dashboard] Status: ${status} - ${message}`);
}

/**
 * Pokazuje notyfikację użytkownikowi
 */
function showNotification(message, type = 'info') {
    console.log(`[Tab Dashboard] Notyfikacja ${type.toUpperCase()}: ${message}`);
    
    // Sprawdź czy istnieje globalny system notyfikacji
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else if (typeof alert !== 'undefined') {
        // Fallback - zwykły alert
        alert(message);
    }
}

/**
 * Uruchamia cooldown timer po odświeżeniu
 */
function startRefreshCooldown() {
    const refreshTimer = document.getElementById('refresh-timer');
    const refreshBtn = document.getElementById('refresh-system-btn');
    
    if (!refreshTimer || !refreshBtn) return;
    
    let seconds = 5;
    refreshTimer.style.display = 'inline';
    refreshTimer.textContent = `(${seconds}s)`;
    refreshBtn.disabled = true;
    
    const countdown = setInterval(() => {
        seconds--;
        refreshTimer.textContent = `(${seconds}s)`;
        
        if (seconds <= 0) {
            clearInterval(countdown);
            refreshTimer.style.display = 'none';
            refreshBtn.disabled = false;
        }
    }, 1000);
}

// ============================================================================
// FUNKCJE CALLBACKÓW TABÓW
// ============================================================================

/**
 * Callback dla taba Dashboard
 */
window.onDashboardTabLoaded = function(data) {
    console.log('[Dashboard Tab] Callback wykonany, dane:', data);
    
    // Inicjalizuj komponenty dashboard
    if (typeof initDashboardWidgets === 'function') {
        initDashboardWidgets();
    }
    
    // Inicjalizuj wykresy dla adminów
    if (window.productionConfig?.currentUser?.role === 'admin') {
        if (typeof createDailyPerformanceChart === 'function') {
            createDailyPerformanceChart();
        }
    }
};

/**
 * Callback dla taba Produkty
 */
window.onProductsTabLoaded = function(data) {
    console.log('[Products Tab] Callback wykonany, dane:', data);
    
    // Inicjalizuj filtry produktów
    if (typeof initProductFilters === 'function') {
        initProductFilters();
    }
    
    // Inicjalizuj drag&drop dla adminów
    if (window.productionConfig?.currentUser?.role === 'admin') {
        if (typeof initDragAndDrop === 'function') {
            initDragAndDrop();
        }
    }
};

/**
 * Callback dla taba Raporty
 */
window.onReportsTabLoaded = function(data) {
    console.log('[Reports Tab] Callback wykonany, dane:', data);
    
    // Inicjalizuj wykresy raportów
    if (typeof initReportsCharts === 'function') {
        initReportsCharts(data);
    }
};

/**
 * Callback dla taba Stanowiska
 */
window.onStationsTabLoaded = function(data) {
    console.log('[Stations Tab] Callback wykonany, dane:', data);
    
    // Inicjalizuj interfejs stanowisk
    if (typeof initStationsInterface === 'function') {
        initStationsInterface();
    }
};

/**
 * Callback dla taba Konfiguracja
 */
window.onConfigTabLoaded = function(data) {
    console.log('[Config Tab] Callback wykonany, dane:', data);
    
    // Inicjalizuj formularze konfiguracji
    if (typeof initConfigForms === 'function') {
        initConfigForms();
    }
    
    // Inicjalizuj drag&drop dla priorytetów
    if (typeof initPriorityDragDrop === 'function') {
        initPriorityDragDrop();
    }
};

// ============================================================================
// PLACEHOLDER FUNCTIONS
// ============================================================================

/**
 * Placeholder functions - będą zaimplementowane później
 */
window.initDashboardWidgets = function() {
    console.log('[Dashboard] TODO: Inicjalizacja widgetów dashboard');
};

window.initProductFilters = function() {
    console.log('[Products] TODO: Inicjalizacja filtrów produktów');
};

window.initDragAndDrop = function() {
    console.log('[Products] TODO: Inicjalizacja drag&drop');
};

window.initReportsCharts = function(data) {
    console.log('[Reports] TODO: Inicjalizacja wykresów raportów');
};

window.initStationsInterface = function() {
    console.log('[Stations] TODO: Inicjalizacja interfejsu stanowisk');
};

window.initConfigForms = function() {
    console.log('[Config] TODO: Inicjalizacja formularzy konfiguracji');
};

window.initPriorityDragDrop = function() {
    console.log('[Config] TODO: Inicjalizacja drag&drop priorytetów');
};

// ============================================================================
// EKSPORT I INICJALIZACJA
// ============================================================================

// Udostępnij główne funkcje globalnie
window.loadTabContent = loadTabContent;
window.TabDashboard = TabDashboard;

// Auto-inicjalizacja po załadowaniu DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabDashboard);
} else {
    initTabDashboard();
}

console.log('[Tab Dashboard] Moduł załadowany - system tabów gotowy!');