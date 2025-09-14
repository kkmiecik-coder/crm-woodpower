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

let lastApiCall = null;
window.lastApiCall = lastApiCall;

// ============================================================================
// INICJALIZACJA
// ============================================================================

/**
 * Główna funkcja inicjalizacji - uruchamiana po załadowaniu DOM
 */
function initTabDashboard() {
    console.log('[Tab Dashboard] Inicjalizacja systemu tabów...');
    updateSystemStatus('loading', 'Sprawdzanie konfiguracji...');
    
    // Sprawdź dostępność konfiguracji
    if (typeof window.productionConfig !== 'undefined') {
        TabDashboard.endpoints = window.productionConfig.endpoints;
        console.log('[Tab Dashboard] Załadowano endpointy:', TabDashboard.endpoints);
        updateSystemStatus('loading', 'Konfiguracja załadowana...');
    } else {
        console.error('[Tab Dashboard] Brak window.productionConfig - używam fallback');
        updateSystemStatus('warning', 'Używam konfiguracji fallback...');
        TabDashboard.endpoints = {
            dashboardTabContent: '/production/api/dashboard-tab-content',
            productsTabContent: '/production/api/products-tab-content',
            reportsTabContent: '/production/api/reports-tab-content',
            stationsTabContent: '/production/api/stations-tab-content',
            configTabContent: '/production/api/config-tab-content'
        };
    }
    
    // Inicjalizuj komponenty
    updateSystemStatus('loading', 'Inicjalizacja komponentów...');
    initTabEventListeners();
    
    updateSystemStatus('loading', 'Konfiguracja auto-refresh...');
    setupAutoRefresh();
    
    updateSystemStatus('loading', 'Ładowanie dashboard...');
    // Załaduj pierwszy tab
    loadTabContent('dashboard-tab');

    setTimeout(() => {
        checkSystemOverallHealth();
    }, 2000); // Sprawdź po 2 sekundach
    
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

function initStationCards() {
    document.querySelectorAll('.station-card').forEach(card => {
        card.addEventListener('click', function() {
            const stationUrl = this.getAttribute('data-station-url');
            if (stationUrl) {
                window.location.href = stationUrl;
            }
        });
    });
}

function updateTodayTotals(totals) {
    console.log('[Dashboard] Aktualizacja dzisiejszych statystyk:', totals);
    
    if (!totals || typeof totals !== 'object') {
        console.warn('[Dashboard] Brak danych today_totals');
        return;
    }
    
    // Aktualizuj ukończone zamówienia
    updateTodayValue('today-completed', totals.completed_orders || 0, 'liczba');
    
    // Aktualizuj całkowity wolumen
    updateTodayValue('today-total-m3', totals.total_m3 || 0, 'm3');
    
    // Aktualizuj średni deadline
    updateTodayValue('today-avg-deadline', totals.avg_deadline_distance || 0, 'dni');
    
    // Aktualizuj datę w header
    updateTodayDate();
    
    console.log('[Dashboard] Dzisiejsze statystyki zaktualizowane');
}

function updateTodayValue(elementId, value, type) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn(`[Dashboard] Element ${elementId} nie znaleziony`);
        return;
    }
    
    let displayValue;
    let colorClass = '';
    
    // Formatowanie wartości w zależności od typu
    switch (type) {
        case 'liczba':
            displayValue = Math.round(value);
            // Kolorowanie na podstawie ilości
            if (value === 0) colorClass = 'text-muted';
            else if (value >= 10) colorClass = 'text-success';
            else if (value >= 5) colorClass = 'text-info';
            else colorClass = 'text-warning';
            break;
            
        case 'm3':
            displayValue = value.toFixed(1);
            // Kolorowanie na podstawie wolumenu
            if (value === 0) colorClass = 'text-muted';
            else if (value >= 50) colorClass = 'text-success';
            else if (value >= 20) colorClass = 'text-info';
            else colorClass = 'text-warning';
            break;
            
        case 'dni':
            displayValue = Math.round(value);
            // Kolorowanie na podstawie deadline (mniej dni = gorszy)
            if (value <= 0) colorClass = 'text-danger';
            else if (value <= 3) colorClass = 'text-warning';
            else if (value <= 7) colorClass = 'text-info';
            else colorClass = 'text-success';
            break;
            
        default:
            displayValue = value;
    }
    
    // Animacja aktualizacji z liczbą
    updateNumberWithAnimation(element, displayValue);
    
    // Dodaj klasę koloru
    setTimeout(() => {
        element.className = element.className.replace(/text-(muted|success|info|warning|danger)/g, '');
        if (colorClass) {
            element.classList.add(colorClass);
        }
    }, 200);
}

function updateTodayDate() {
    const dateElement = document.getElementById('today-date');
    if (dateElement) {
        const today = new Date();
        const dateString = today.toLocaleDateString('pl-PL', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        dateElement.textContent = dateString;
    }
}

function updateDeadlineAlerts(alerts) {
    console.log('[Dashboard] Aktualizacja alertów deadline:', alerts);
    
    const alertsCountElement = document.getElementById('alerts-count');
    const alertsListElement = document.getElementById('alerts-list');
    
    if (!alertsListElement) {
        console.warn('[Dashboard] Element alerts-list nie znaleziony');
        return;
    }
    
    // Aktualizuj licznik alertów
    if (alertsCountElement) {
        alertsCountElement.textContent = alerts ? alerts.length : 0;
        
        // Kolorowanie licznika
        alertsCountElement.className = 'alert-count';
        if (alerts && alerts.length > 0) {
            if (alerts.length >= 5) {
                alertsCountElement.classList.add('alert-count-critical');
            } else if (alerts.length >= 3) {
                alertsCountElement.classList.add('alert-count-warning');
            } else {
                alertsCountElement.classList.add('alert-count-info');
            }
        }
    }
    
    // Wyczyść poprzednią zawartość
    alertsListElement.innerHTML = '';
    
    // Sprawdź czy są alerty
    if (!alerts || alerts.length === 0) {
        alertsListElement.innerHTML = `
            <div class="no-alerts-state">
                <div class="no-alerts-icon">✅</div>
                <p class="no-alerts-text">Brak pilnych alertów</p>
                <small class="text-muted">Wszystkie produkty są na czasie</small>
            </div>
        `;
        return;
    }
    
    // Renderuj listę alertów
    alerts.forEach(alert => {
        const alertElement = createAlertElement(alert);
        alertsListElement.appendChild(alertElement);
    });
    
    console.log(`[Dashboard] ${alerts.length} alertów deadline renderowanych`);
}

function updateSystemHealth(health) {
    console.log('[Dashboard] Aktualizacja statusu systemu:', health);
    
    if (!health || typeof health !== 'object') {
        console.warn('[Dashboard] Brak danych system_health');
        return;
    }
    
    // Aktualizuj wskaźnik główny
    updateHealthIndicator(health);
    
    // Aktualizuj ostatnią synchronizację
    updateLastSync(health.last_sync, health.sync_status);
    
    // Aktualizuj status bazy danych
    updateDatabaseStatus(health.database_status);
    
    // Aktualizuj błędy systemu
    updateSystemErrors(health.errors_24h);

    checkBaselinkerAPIStatus().then(baselinkerData => {
        updateBaselinkerStatus(baselinkerData);
    }).catch(error => {
        console.error('[Baselinker] Błąd aktualizacji statusu:', error);
        updateBaselinkerStatus(null);
    });
    
    console.log('[Dashboard] Status systemu zaktualizowany');
}

function updateHealthIndicator(health) {
    const indicator = document.getElementById('health-indicator');
    if (!indicator) return;
    
    // Określ ogólny status systemu
    let overallStatus = 'healthy';
    let statusText = 'System działa poprawnie';
    let statusIcon = '✅';
    
    // Logika określania statusu
    if (health.database_status !== 'connected') {
        overallStatus = 'critical';
        statusText = 'Problemy z bazą danych';
        statusIcon = '🚨';
    } else if (health.sync_status !== 'success') {
        overallStatus = 'warning';
        statusText = 'Problemy z synchronizacją';
        statusIcon = '⚠️';
    } else if (health.errors_24h && health.errors_24h > 5) {
        overallStatus = 'warning';
        statusText = 'Wykryto błędy systemu';
        statusIcon = '⚠️';
    } else if (health.errors_24h && health.errors_24h > 0) {
        overallStatus = 'info';
        statusText = 'Drobne błędy systemu';
        statusIcon = 'ℹ️';
    }
    
    // Aktualizuj klasę i zawartość
    indicator.className = `health-indicator health-${overallStatus}`;
    indicator.innerHTML = `${statusIcon} ${statusText}`;
    indicator.title = `Status systemu: ${statusText}`;
}

function updateLastSync(lastSync, syncStatus) {
    const element = document.getElementById('last-sync-time'); // ZMIENIONE ID
    if (!element) return;
    
    let syncText = 'Brak danych';
    let syncClass = 'sync-unknown';
    
    if (lastSync) {
        const syncDate = new Date(lastSync);
        const now = new Date();
        const diffHours = Math.floor((now - syncDate) / (1000 * 60 * 60));
        
        // Format daty
        const timeText = syncDate.toLocaleString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Określ status na podstawie czasu i statusu
        if (syncStatus === 'success') {
            if (diffHours < 2) {
                syncClass = 'sync-recent';
                syncText = `${timeText} (${diffHours}h temu)`;
            } else if (diffHours < 24) {
                syncClass = 'sync-normal';
                syncText = `${timeText} (${diffHours}h temu)`;
            } else {
                syncClass = 'sync-old';
                syncText = `${timeText} (${Math.floor(diffHours/24)} dni temu)`;
            }
        } else {
            syncClass = 'sync-error';
            syncText = `Błąd: ${timeText}`;
        }
    }
    
    element.className = `health-value ${syncClass}`;
    element.textContent = syncText;
    
    // Aktualizuj także status sync
    const statusElement = document.getElementById('sync-status');
    if (statusElement) {
        statusElement.className = `health-status ${syncClass}`;
        statusElement.textContent = syncStatus === 'success' ? 'OK' : 'Błąd';
    }
}

function updateDatabaseStatus(dbStatus) {
    const valueElement = document.getElementById('db-response-time'); // ZMIENIONE ID
    const statusElement = document.getElementById('db-status');
    
    if (valueElement) {
        valueElement.textContent = dbStatus === 'connected' ? 'Połączona' : 'Rozłączona';
    }
    
    if (statusElement) {
        let statusClass = 'db-unknown';
        let statusText = 'Nieznany';
        
        switch (dbStatus) {
            case 'connected':
                statusText = 'OK';
                statusClass = 'db-connected';
                break;
            case 'disconnected':
                statusText = 'Błąd';
                statusClass = 'db-error';
                break;
            case 'slow':
                statusText = 'Wolna';
                statusClass = 'db-warning';
                break;
        }
        
        statusElement.className = `health-status ${statusClass}`;
        statusElement.textContent = statusText;
    }
}

function updateSystemErrors(errorCount) {
    const valueElement = document.getElementById('error-count'); // ZMIENIONE ID
    const statusElement = document.getElementById('errors-status');
    
    if (valueElement) {
        valueElement.textContent = errorCount || 0;
        
        // Kolorowanie licznika błędów
        valueElement.className = 'health-value';
        if (errorCount > 10) {
            valueElement.classList.add('errors-critical');
        } else if (errorCount > 5) {
            valueElement.classList.add('errors-warning');
        } else if (errorCount > 0) {
            valueElement.classList.add('errors-info');
        }
    }
    
    if (statusElement) {
        let statusClass = 'errors-ok';
        let statusText = 'Brak';
        
        if (errorCount > 10) {
            statusClass = 'errors-critical';
            statusText = 'Krytyczne';
        } else if (errorCount > 5) {
            statusClass = 'errors-warning';
            statusText = 'Ostrzeżenia';
        } else if (errorCount > 0) {
            statusClass = 'errors-info';
            statusText = 'Drobne';
        }
        
        statusElement.className = `health-status ${statusClass}`;
        statusElement.textContent = statusText;
    }
}

function showSystemErrorsModal() {
    console.log('[Dashboard] Otwórz modal błędów systemu');
    
    // Sprawdź czy modal istnieje w HTML
    const modal = document.getElementById('systemErrorsModal');
    if (modal) {
        // Użyj Bootstrap modal
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    } else {
        // Fallback - otwórz w nowym oknie
        window.open('/production/api/system-errors', '_blank', 'width=800,height=600,scrollbars=yes');
    }
}

function createAlertElement(alert) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert-item';
    
    // Określ klasę CSS na podstawie dni remaining
    let urgencyClass = 'alert-normal';
    let urgencyIcon = '⏰';
    
    if (alert.days_remaining <= 0) {
        urgencyClass = 'alert-overdue';
        urgencyIcon = '🚨';
    } else if (alert.days_remaining <= 1) {
        urgencyClass = 'alert-critical';
        urgencyIcon = '⚠️';
    } else if (alert.days_remaining <= 2) {
        urgencyClass = 'alert-warning';
        urgencyIcon = '⏳';
    }
    
    alertDiv.classList.add(urgencyClass);
    
    // Format daty
    let dateText = 'Brak daty';
    if (alert.deadline_date) {
        const date = new Date(alert.deadline_date);
        dateText = date.toLocaleDateString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
    
    // Format dni remaining
    let daysText = '';
    if (alert.days_remaining <= 0) {
        daysText = `Spóźnione o ${Math.abs(alert.days_remaining)} dni`;
    } else {
        daysText = `${alert.days_remaining} dni pozostało`;
    }
    
    // HTML alertu
    alertDiv.innerHTML = `
        <div class="alert-icon">${urgencyIcon}</div>
        <div class="alert-content">
            <div class="alert-header">
                <span class="alert-product-id">${alert.short_product_id || 'ID nieznany'}</span>
                <span class="alert-days ${urgencyClass}">${daysText}</span>
            </div>
            <div class="alert-details">
                <span class="alert-deadline">Termin: ${dateText}</span>
                <span class="alert-station">Na: ${formatStationName(alert.current_station)}</span>
            </div>
        </div>
        <div class="alert-actions">
            <button class="btn btn-sm btn-outline-primary" onclick="viewProductDetails('${alert.short_product_id}')">
                <i class="fas fa-eye"></i>
            </button>
        </div>
    `;
    
    return alertDiv;
}

function formatStationName(station) {
    const stationNames = {
        'cutting': 'Wycinanie',
        'assembly': 'Składanie', 
        'packaging': 'Pakowanie',
        'wyciecie': 'Wycinanie',
        'skladanie': 'Składanie',
        'pakowanie': 'Pakowanie'
    };
    
    return stationNames[station] || station || 'Nieznane';
}

function viewProductDetails(productId) {
    console.log('[Dashboard] Wyświetl szczegóły produktu:', productId);
    
    if (!productId) {
        console.warn('[Dashboard] Brak ID produktu');
        return;
    }
    
    // Sprawdź czy mamy endpoint do szczegółów produktu
    const detailsUrl = `/production/products/details/${productId}`;
    
    // Otwórz w nowym oknie/zakładce
    window.open(detailsUrl, '_blank', 'width=1000,height=700,scrollbars=yes,resizable=yes');
}

function updateStationsStats(stations) {
    console.log('[Dashboard Tab] Aktualizacja statystyk stanowisk:', stations);
    
    if (!stations || typeof stations !== 'object') {
        console.warn('[Dashboard Tab] Brak danych stanowisk');
        return;
    }
    
    updateSingleStationCard('cutting', stations.cutting, '🪚', 'Wycinanie');
    updateSingleStationCard('assembly', stations.assembly, '🔧', 'Składanie'); 
    updateSingleStationCard('packaging', stations.packaging, '📦', 'Pakowanie');
    
    updateLastRefreshTime('stations-updated');
}

function updateSingleStationCard(stationType, stationData, icon, displayName) {
    if (!stationData) return;
    
    const pendingElement = document.getElementById(`${stationType}-pending`);
    const volumeElement = document.getElementById(`${stationType}-today-m3`);
    const statusElement = document.getElementById(`${stationType}-status`);
    const cardElement = document.querySelector(`.station-card.${stationType}-station`);
    
    if (!pendingElement || !volumeElement) return;
    
    updateNumberWithAnimation(pendingElement, stationData.pending_count || 0);
    updateNumberWithAnimation(volumeElement, (stationData.today_m3 || 0).toFixed(1));
    
    updateStationStatus(statusElement, cardElement, stationData);
}

function updateNumberWithAnimation(element, newValue) {
    if (!element) return;
    
    const currentValue = element.textContent || '0';
    const numericNewValue = parseFloat(newValue) || 0;
    const numericCurrentValue = parseFloat(currentValue) || 0;
    
    if (numericCurrentValue === numericNewValue) return;
    
    const duration = 800;
    const steps = 20;
    const stepValue = (numericNewValue - numericCurrentValue) / steps;
    const stepTime = duration / steps;
    
    let currentStep = 0;
    
    const animate = () => {
        currentStep++;
        const intermediateValue = numericCurrentValue + (stepValue * currentStep);
        
        if (currentStep < steps) {
            if (newValue.toString().includes('.')) {
                element.textContent = intermediateValue.toFixed(1);
            } else {
                element.textContent = Math.round(intermediateValue);
            }
            setTimeout(animate, stepTime);
        } else {
            element.textContent = newValue;
            element.style.background = '#28a745';
            element.style.color = 'white';
            element.style.borderRadius = '4px';
            element.style.padding = '2px 6px';
            element.style.transition = 'all 0.3s ease';
            
            setTimeout(() => {
                element.style.background = '';
                element.style.color = '';
                element.style.borderRadius = '';
                element.style.padding = '';
            }, 600);
        }
    };
    
    animate();
}

function updateStationStatus(statusElement, cardElement, stationData) {
    if (!statusElement || !cardElement) return;
    
    const pendingCount = stationData.pending_count || 0;
    const todayVolume = stationData.today_m3 || 0;
    
    let statusClass = 'status-normal';
    
    if (pendingCount === 0) {
        statusClass = 'status-idle';
    } else if (pendingCount > 20) {
        statusClass = 'status-overloaded';  
    } else if (pendingCount > 10) {
        statusClass = 'status-busy';
    } else if (todayVolume > 30) {
        statusClass = 'status-productive';
    }
    
    statusElement.className = statusElement.className.replace(/status-\w+/g, '');
    cardElement.className = cardElement.className.replace(/status-\w+/g, '');
    
    statusElement.classList.add(statusClass);
    cardElement.classList.add(statusClass);
}

function updateLastRefreshTime(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('pl-PL', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        element.textContent = `Aktualizacja: ${timeString}`;
    }
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
 * Sprawdza ogólny stan systemu i aktualizuje header
 */
function checkSystemOverallHealth() {
    console.log('[System Health] Sprawdzanie ogólnego stanu systemu...');
    
    let issues = [];
    let overallStatus = 'success';
    let statusMessage = 'System działa poprawnie';
    
    // Sprawdź czy są błędy w localStorage
    const errors = localStorage.getItem('system_errors');
    if (errors && JSON.parse(errors).length > 0) {
        issues.push('Błędy systemu');
        overallStatus = 'warning';
    }
    
    // Sprawdź czy ostatni tab się załadował poprawnie
    if (TabDashboard.state.retryCount > 0) {
        issues.push('Problemy z ładowaniem');
        overallStatus = 'warning';
    }
    
    // Sprawdź czy są problemy z endpointami
    if (!TabDashboard.endpoints || Object.keys(TabDashboard.endpoints).length === 0) {
        issues.push('Brak konfiguracji');
        overallStatus = 'error';
    }
    
    // Ustaw odpowiedni status
    if (issues.length > 0) {
        if (overallStatus === 'error') {
            statusMessage = `Błąd krytyczny: ${issues.join(', ')}`;
        } else {
            statusMessage = `Ostrzeżenia: ${issues.join(', ')}`;
        }
    }
    
    updateSystemStatus(overallStatus, statusMessage);
    console.log(`[System Health] Status: ${overallStatus}, Wiadomość: ${statusMessage}`);
}

/**
 * Główna funkcja ładowania zawartości tabów przez AJAX
 */
async function loadTabContent(tabName, silentRefresh = false) {
    console.log(`[Tab Dashboard] Ładowanie taba: ${tabName}, silent: ${silentRefresh}`);
    updateSystemStatus('loading', `Ładowanie taba ${tabName}...`);
    
    window.lastApiCall = `${new Date().toLocaleTimeString()} (${tabName})`;
    
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
            updateSystemStatus('success', 'System gotowy');
        } else {
            updateSystemStatus('success', `${tabName} odświeżony`);
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
 * Sprawdza status Baselinker API z inteligentnym cache
 */
async function checkBaselinkerAPIStatus() {
    const cacheKey = 'baselinker_api_status';
    const timestampKey = 'baselinker_last_check';
    const CACHE_DURATION = 15 * 60 * 1000; // 15 minut w ms
    
    const lastCheck = localStorage.getItem(timestampKey);
    const cachedStatus = localStorage.getItem(cacheKey);
    const now = Date.now();
    
    // Sprawdź czy cache jest świeży
    if (lastCheck && cachedStatus && (now - parseInt(lastCheck)) < CACHE_DURATION) {
        console.log('[Baselinker] Używam cache:', JSON.parse(cachedStatus));
        return JSON.parse(cachedStatus);
    }
    
    console.log('[Baselinker] Cache wygasł, sprawdzam API...');
    
    try {
        window.lastApiCall = `${new Date().toLocaleTimeString()} (Baselinker)`;
        // Wywołaj dedykowany endpoint do sprawdzenia Baselinker
        const response = await fetch('/production/api/baselinker-health', {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        // Zapisz w cache
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(timestampKey, now.toString());
        
        console.log('[Baselinker] Status zaktualizowany:', result);
        return result;
        
    } catch (error) {
        console.error('[Baselinker] Błąd sprawdzania API:', error);
        
        // W przypadku błędu, zwróć ostatni znany status lub domyślny
        if (cachedStatus) {
            console.log('[Baselinker] Używam ostatni znany status z cache');
            return JSON.parse(cachedStatus);
        }
        
        return { 
            status: 'unknown', 
            error: error.message,
            response_time: null 
        };
    }
}

/**
 * Aktualizuje status Baselinker API w interfejsie
 */
function updateBaselinkerStatus(baselinkerData) {
    const valueElement = document.getElementById('api-response-time');
    const statusElement = document.getElementById('api-status');
    
    if (!valueElement || !statusElement) {
        console.warn('[Baselinker] Elementy HTML nie znalezione');
        return;
    }
    
    if (!baselinkerData) {
        valueElement.textContent = '-';
        statusElement.className = 'health-status api-unknown';
        statusElement.textContent = 'Nieznany';
        return;
    }
    
    // Aktualizuj wartość (response time lub błąd)
    if (baselinkerData.response_time !== null && baselinkerData.response_time !== undefined) {
        const responseTimeMs = Math.round(baselinkerData.response_time * 1000);
        valueElement.textContent = `${responseTimeMs}ms`;
    } else if (baselinkerData.error) {
        valueElement.textContent = 'Błąd połączenia';
    } else {
        valueElement.textContent = 'Nieznany';
    }
    
    // Aktualizuj status i kolorowanie
    let statusClass = 'api-unknown';
    let statusText = 'Nieznany';
    
    switch (baselinkerData.status) {
        case 'connected':
            statusClass = 'api-connected';
            statusText = 'OK';
            break;
        case 'slow':
            statusClass = 'api-warning';
            statusText = 'Wolny';
            break;
        case 'error':
            statusClass = 'api-error';
            statusText = 'Błąd';
            break;
        case 'unknown':
        default:
            statusClass = 'api-unknown';
            statusText = 'Nieznany';
    }
    
    statusElement.className = `health-status ${statusClass}`;
    statusElement.textContent = statusText;
    
    // Dodaj tooltip z dodatkowymi informacjami
    if (baselinkerData.error) {
        statusElement.title = `Błąd: ${baselinkerData.error}`;
    } else if (baselinkerData.response_time) {
        statusElement.title = `Czas odpowiedzi: ${Math.round(baselinkerData.response_time * 1000)}ms`;
    }
}

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
        // Usuń wszystkie klasy statusu
        indicator.className = indicator.className.replace(/\b(loading|active|warning|error|success)\b/g, '');
        
        // Dodaj nową klasę statusu
        indicator.classList.add('status-indicator', status);
    }
    
    if (text) {
        text.textContent = message;
    }
    
    console.log(`[Tab Dashboard] Header Status: ${status} - ${message}`);
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
    
    // Inicjalizuj komponenty dashboard Z PRZEKAZANIEM DANYCH
    if (typeof initDashboardWidgets === 'function') {
        initDashboardWidgets(data);  // PRZEKAŻ DANE!
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
window.initDashboardWidgets = function(data) {
    console.log('[Dashboard] Inicjalizacja widgetów dashboard - IMPLEMENTACJA');
    
    initStationCards();
    
    // Użyj danych przekazanych z callbacku
    if (data && data.stats) {
        console.log('[Dashboard] Używam danych z API:', data.stats);
        
        if (data.stats.stations) {
            updateStationsStats(data.stats.stations);
        }
        
        if (data.stats.today_totals) {
            updateTodayTotals(data.stats.today_totals);
        }

        if (data.stats.deadline_alerts) {
            updateDeadlineAlerts(data.stats.deadline_alerts);
        }

        if (data.stats.system_health) {
            updateSystemHealth(data.stats.system_health);
        }
    }
    
    console.log('[Dashboard] Widgety dashboard zainicjalizowane');
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

setInterval(() => {
    if (!document.hidden && !TabDashboard.state.isLoading) {
        checkSystemOverallHealth();
    }
}, 30000); // Co 30 sekund