/**
 * GLUING DASHBOARD - JavaScript Logic
 * Obsługuje interfejs stanowiska sklejania
 */

// === KONFIGURACJA ===
const GLUING_CONFIG = {
    refreshInterval: 180000, // ZMIANA: 3 minuty zamiast 30 sekund
    timerInterval: 1000,     // 1 sekunda - aktualizacja timerów
    apiEndpoints: {
        queue: '/production/api/queue',
        stations: '/production/api/stations/status',
        workers: '/production/api/workers',
        startProduction: '/production/api/item/{itemId}/start',
        completeProduction: '/production/api/item/{itemId}/complete'
    }
};

// === WALIDACJA STANU ===
function validateAndRefreshData() {
    console.log('🔍 Walidacja stanu danych...');

    // Sprawdź czy mamy podstawowe dane
    if (!gluingState.stations.length || !gluingState.workers.length) {
        console.warn('Debug info:', {
            stations: gluingState.stations,
            workers: gluingState.workers,
            lastSync: new Date(gluingState.lastSync),
            timeDiff: gluingState.lastSync ? Date.now() - gluingState.lastSync : 'brak'
        });
        return loadInitialData();
    }

    return Promise.resolve();
}

// === ZMIENNE GLOBALNE ===
let gluingState = {
    stations: [],
    workers: [],
    products: [],
    selectedProduct: null,
    selectedStation: null,
    selectedWorker: null,
    timers: {},
    refreshTimer: null,
    uiTimer: null,
    lastSync: null,
    lastActiveStationsCount: 0
};

// === INICJALIZACJA ===
document.addEventListener('DOMContentLoaded', function () {
    initializeGluingDashboard();
});

/**
 * Obsługa zmiany widoczności strony
 */
document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
        console.log('⏸️ Strona przeszła w tło - wstrzymuję niektóre operacje');
    } else {
        console.log('▶️ Strona wróciła na pierwszy plan - wznawiam operacje');

        // Sprawdź czy dane nie są za stare
        if (gluingState.lastSync) {
            const timeDiff = Date.now() - gluingState.lastSync;
            const threshold = 5 * 60 * 1000; // 5 minut

            if (timeDiff > threshold) {
                console.log('🔄 Dane przestarzałe - odświeżam...');
                refreshAllData();
            }
        }
    }
});

// NOWY KOD - dodaj funkcję resetowania stanu
/**
 * Resetowanie stanu aplikacji
 */
function resetGluingState() {
    gluingState.stations = [];
    gluingState.workers = [];
    gluingState.products = [];
    gluingState.selectedProduct = null;
    gluingState.selectedStation = null;
    gluingState.selectedWorker = null;
    gluingState.timers = {};
    gluingState.lastSync = null;
    gluingState.lastActiveStationsCount = 0;

    console.log('🔄 Stan aplikacji zresetowany');
}

// NOWY KOD - dodaj funkcję ładowania z retry
/**
 * Ładowanie danych z mechanizmem retry
 */
async function loadInitialDataWithRetry(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`🔄 Próba ładowania danych: ${attempt}/${maxRetries}`);

        try {
            await loadInitialData();
            console.log('✅ Dane załadowane pomyślnie');
            return; // Sukces - wyjdź z pętli

        } catch (error) {
            console.error(`❌ Próba ${attempt} nieudana:`, error);

            if (attempt === maxRetries) {
                // Ostatnia próba nieudana
                console.error('❌ Wszystkie próby nieudane - przechodzę w tryb offline');
                showOfflineMode();
                return;
            }

            // Czekaj przed kolejną próbą
            const delay = attempt * 2000; // 2s, 4s, 6s
            console.log(`⏳ Czekam ${delay}ms przed kolejną próbą...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// NOWY KOD - dodaj tryb offline
/**
 * Pokazanie trybu offline z możliwością odświeżenia
 */
function showOfflineMode() {
    const container = document.querySelector('.prod-work-container');
    if (container) {
        container.innerHTML = `
            <div class="prod-work-offline-mode">
                <div class="prod-work-offline-content">
                    <i class="fas fa-wifi-slash fa-3x"></i>
                    <h3>Brak połączenia z serwerem</h3>
                    <p>Nie można pobrać danych ze stanowisk i pracowników.</p>
                    <div class="prod-work-offline-actions">
                        <button class="prod-work-btn prod-work-btn-primary" onclick="window.location.reload()">
                            <i class="fas fa-refresh"></i>
                            Odśwież stronę
                        </button>
                        <button class="prod-work-btn prod-work-btn-secondary" onclick="retryConnection()">
                            <i class="fas fa-sync"></i>
                            Spróbuj ponownie
                        </button>
                    </div>
                    <small class="text-muted">
                        Sprawdź połączenie internetowe lub skontaktuj się z administratorem
                    </small>
                </div>
            </div>
        `;
    }

    showToast('error', 'Brak połączenia z serwerem', 10000);
}

// NOWY KOD - dodaj funkcję ponowienia połączenia
/**
 * Ponowienie próby połączenia
 */
function retryConnection() {
    showToast('info', 'Próba ponownego połączenia...');
    showLoadingState();
    loadInitialDataWithRetry();
}

/**
 * Główna funkcja inicjalizująca - POPRAWIONA WERSJA
 */
function initializeGluingDashboard() {
    console.log('🚀 Inicjalizacja Gluing Dashboard v2.0');

    // Wyczyść poprzednie timery jeśli istnieją
    if (gluingState.refreshTimer) {
        clearInterval(gluingState.refreshTimer);
    }
    if (gluingState.uiTimer) {
        clearInterval(gluingState.uiTimer);
    }

    // Reset stanu
    resetGluingState();

    // Binduj eventy
    bindEvents();
    bindEventsAddition();

    // Załaduj dane początkowe z retry
    loadInitialDataWithRetry();

    // Uruchom odświeżanie z opóźnieniem
    setTimeout(() => {
        startAutoRefresh();
    }, 2000);

    console.log('✅ Gluing Dashboard zainicjalizowany');
}

/**
 * Bindowanie eventów do elementów
 */
function bindEvents() {
    // Przycisk odświeżania
    document.getElementById('refreshBtn')?.addEventListener('click', function () {
        refreshAllData();
    });

    // Modal - przycisk rozpoczęcia produkcji
    document.getElementById('startProductionBtn')?.addEventListener('click', startProduction);

    // Modal - przycisk następnego produktu
    document.getElementById('nextProductBtn')?.addEventListener('click', function () {
        const modal = bootstrap.Modal.getInstance(document.getElementById('completionModal'));
        modal.hide();

        // Otwórz modal wyboru dla kolejnego produktu
        setTimeout(() => {
            if (gluingState.selectedStation) {
                showStationWorkerModal(null, gluingState.selectedStation.id);
            }
        }, 300);
    });

    // Obsługa zamknięcia modali
    document.getElementById('stationWorkerModal')?.addEventListener('hidden.bs.modal', function () {
        resetModalState();
    });
}

/**
 * Ładowanie danych początkowych - POPRAWIONA WERSJA z lepszym error handling
 */
async function loadInitialData() {
    console.log('🔄 Ładowanie danych początkowych...');
    showLoadingState();

    try {
        // Równoległe ładowanie wszystkich danych z timeout
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout - zbyt długie oczekiwanie na dane')), 15000)
        );

        const dataPromise = Promise.all([
            fetchStations(),
            fetchWorkers(),
            fetchProducts()
        ]);

        const [stationsResult, workersResult, productsResult] = await Promise.race([
            dataPromise,
            timeout
        ]);

        // Sprawdź czy wszystkie żądania zakończyły się sukcesem
        const allSuccess = stationsResult.success && workersResult.success && productsResult.success;

        if (allSuccess) {
            gluingState.stations = stationsResult.data || [];
            gluingState.workers = workersResult.data || [];
            gluingState.products = productsResult.data || [];

            // Walidacja krytycznych danych
            const hasStations = gluingState.stations.filter(s => s.station_type === 'gluing').length > 0;
            const hasWorkers = gluingState.workers.filter(w =>
                w.station_type_preference === 'gluing' || w.station_type_preference === 'both'
            ).length > 0;

            if (!hasStations) {
                showToast('warning', 'Brak stanowisk sklejania - skontaktuj się z administratorem');
            }
            if (!hasWorkers) {
                showToast('warning', 'Brak pracowników dla sklejania - skontaktuj się z administratorem');
            }

            renderStations();
            renderProducts();
            updateLastSyncTime();

            console.log('✅ Dane załadowane pomyślnie', {
                stations: gluingState.stations.length,
                workers: gluingState.workers.length,
                products: gluingState.products.length
            });

        } else {
            // Częściowy sukces - wyświetl konkretne błędy
            const errors = [];
            if (!stationsResult.success) errors.push('stanowiska');
            if (!workersResult.success) errors.push('pracownicy');
            if (!productsResult.success) errors.push('produkty');

            throw new Error(`Błąd ładowania: ${errors.join(', ')}`);
        }

    } catch (error) {
        console.error('❌ Błąd ładowania danych:', error);

        if (error.message.includes('Timeout')) {
            showToast('error', 'Przekroczono czas oczekiwania - sprawdź połączenie');
        } else if (error.message.includes('401') || error.message.includes('403')) {
            showToast('error', 'Sesja wygasła - strona zostanie odświeżona');
            setTimeout(() => window.location.reload(), 2000);
        } else {
            showToast('error', 'Błąd podczas ładowania danych - spróbuj ponownie');
        }

        showErrorState();
    }
}

/**
 * Odświeżanie wszystkich danych - POPRAWIONA WERSJA z walidacją
 */
async function refreshAllData() {
    const refreshBtn = document.getElementById('refreshBtn');
    const originalIcon = refreshBtn?.querySelector('i');

    if (originalIcon) {
        originalIcon.className = 'fas fa-spinner fa-spin';
    }

    try {
        console.log('🔄 Odświeżanie wszystkich danych...');

        // Sprawdź czy stanowiska i pracownicy nadal istnieją
        const validationResult = await validateExistingData();

        if (!validationResult.valid) {
            console.warn('⚠️ Dane nieważne:', validationResult.reason);
            showToast('warning', 'Odnawianie danych: ' + validationResult.reason);
        }

        // Pobierz świeże dane
        const [stationsResult, workersResult, productsResult] = await Promise.all([
            fetchStations(),
            fetchWorkers(),
            fetchProducts()
        ]);

        let hasChanges = false;
        let successCount = 0;

        // Aktualizuj stanowiska jeśli sukces
        if (stationsResult.success) {
            const oldCount = gluingState.stations.length;
            gluingState.stations = stationsResult.data || [];

            if (gluingState.stations.length !== oldCount) {
                hasChanges = true;
                console.log(`📊 Stanowiska: ${oldCount} → ${gluingState.stations.length}`);
            }
            successCount++;
        }

        // Aktualizuj pracowników jeśli sukces
        if (workersResult.success) {
            const oldCount = gluingState.workers.length;
            gluingState.workers = workersResult.data || [];

            if (gluingState.workers.length !== oldCount) {
                hasChanges = true;
                console.log(`👥 Pracownicy: ${oldCount} → ${gluingState.workers.length}`);
            }
            successCount++;
        }

        // Aktualizuj produkty jeśli sukces
        if (productsResult.success) {
            const oldCount = gluingState.products.length;
            gluingState.products = productsResult.data || [];

            if (gluingState.products.length !== oldCount) {
                hasChanges = true;
                console.log(`📦 Produkty: ${oldCount} → ${gluingState.products.length}`);
            }
            successCount++;
        }

        // Renderuj jeśli były zmiany lub if force refresh
        if (hasChanges || successCount < 3) {
            renderStations();
            renderProducts();
        }

        updateLastSyncTime();

        // Pokaż status odświeżania
        if (successCount === 3) {
            console.log('✅ Wszystkie dane odświeżone pomyślnie');
        } else {
            console.warn(`⚠️ Częściowe odświeżenie: ${successCount}/3`);
            showToast('warning', `Częściowe odświeżenie danych (${successCount}/3)`);
        }

    } catch (error) {
        console.error('❌ Błąd odświeżania danych:', error);
        showToast('error', 'Błąd odświeżania: ' + error.message);

    } finally {
        if (originalIcon) {
            originalIcon.className = 'fas fa-sync-alt';
        }
    }
}

/**
 * Walidacja czy obecne dane są nadal aktualne
 */
async function validateExistingData() {
    try {
        // Sprawdź podstawowe warunki
        if (!gluingState.stations.length || !gluingState.workers.length) {
            return { valid: false, reason: 'Brak podstawowych danych' };
        }

        // Sprawdź czy minęło dużo czasu od ostatniej synchronizacji
        if (gluingState.lastSync) {
            const timeDiff = Date.now() - gluingState.lastSync;
            const maxAge = 15 * 60 * 1000; // 15 minut

            if (timeDiff > maxAge) {
                return { valid: false, reason: 'Dane starsze niż 15 minut' };
            }
        }

        return { valid: true };

    } catch (error) {
        return { valid: false, reason: 'Błąd walidacji' };
    }
}

/**
 * Aktualizuj dane stanowisk bez przeładowania
 */
function updateStationsData(newStationsData) {
    const oldStations = [...gluingState.stations];
    gluingState.stations = newStationsData;

    // Sprawdź zmiany i aktualizuj tylko różniące się stanowiska
    newStationsData.forEach(newStation => {
        const oldStation = oldStations.find(s => s.id === newStation.id);

        if (!oldStation || hasStationChanged(oldStation, newStation)) {
            updateSingleStation(newStation);
        }
    });
}

/**
 * Sprawdź czy stanowisko się zmieniło
 */
function hasStationChanged(oldStation, newStation) {
    return (
        oldStation.is_busy !== newStation.is_busy ||
        oldStation.current_item_id !== newStation.current_item_id ||
        oldStation.working_time_seconds !== newStation.working_time_seconds
    );
}

/**
 * Aktualizuj pojedyncze stanowisko
 */
function updateSingleStation(station) {
    const stationElement = document.querySelector(`[data-station-id="${station.id}"]`);
    if (!stationElement) return;

    if (station.is_busy) {
        const statusClass = getStationStatusClass('active');
        stationElement.className = `prod-work-station ${statusClass}`;
        stationElement.innerHTML = renderActiveStationContent(station);
    } else {
        stationElement.className = 'prod-work-station idle';
        stationElement.innerHTML = `
            <div class="prod-work-station-name">${station.name}</div>
            <div class="prod-work-station-status">Bezczynny</div>
        `;
    }
}

/**
 * Aktualizuj dane produktów bez przeładowania
 */
function updateProductsData(newProductsData) {
    const oldProducts = [...gluingState.products];
    gluingState.products = newProductsData;

    // Sprawdź czy są nowe produkty
    const newProductIds = newProductsData.map(p => p.id);
    const oldProductIds = oldProducts.map(p => p.id);

    const addedProducts = newProductsData.filter(p => !oldProductIds.includes(p.id));
    const removedProductIds = oldProductIds.filter(id => !newProductIds.includes(id));

    // Dodaj nowe produkty na początku listy
    if (addedProducts.length > 0) {
        addedProducts.forEach(product => {
            addProductToGrid(product, true); // true = dodaj na początku
        });
        showToast('info', `Dodano ${addedProducts.length} nowych produktów`);
    }

    // Usuń zakończone produkty
    if (removedProductIds.length > 0) {
        removedProductIds.forEach(productId => {
            removeProductFromGrid(productId);
        });
    }

    // Aktualizuj licznik
    document.getElementById('queueCount').textContent = newProductsData.length;
    gluingState.products = newProductsData;
}

/**
 * DODAJ OBSŁUGĘ EVENT LISTENERA dla przycisków akcji
 */
function bindEventsAddition() {
    // Dodaj do istniejącej funkcji bindEvents() - na końcu tej funkcji
    
    // Obsługa przycisków rozpocznij z loading state
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('prod-mod-prod-card-action-button') || 
            e.target.closest('.prod-mod-prod-card-action-button')) {
            
            const button = e.target.classList.contains('prod-mod-prod-card-action-button') ? 
                          e.target : e.target.closest('.prod-mod-prod-card-action-button');
            
            // Dodaj loading state
            const originalContent = button.innerHTML;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ŁADOWANIE...';
            button.disabled = true;
            button.style.background = '#6c757d';
            
            // Przywróć oryginalny stan po 2 sekundach (gdyby coś poszło nie tak)
            setTimeout(() => {
                if (button.disabled) {
                    button.innerHTML = originalContent;
                    button.disabled = false;
                    button.style.background = '#28a745';
                }
            }, 2000);
        }
    });
}

/**
 * Dodaj produkt do gridu
 */
function addProductToGrid(product, prepend = false) {
    const container = document.getElementById('productsGrid');
    if (!container) return;

    const priorityClass = getPriorityClass(product);
    const priorityNumber = product.priority_score || 0;
    
    // Określ klasy CSS dla specyfikacji
    const woodSpeciesClass = getWoodSpeciesClass(product.wood_species);
    const technologyClass = getTechnologyClass(product.wood_technology);
    const classTypeClass = getClassTypeClass(product.wood_class);
    const deadlineClass = getDeadlineClass(product.deadline_date);
    
    // Formatuj wymiary
    const dimensions = formatProductDimensions(product);
    
    const productHTML = `
        <div class="prod-mod-prod-card-product-box prod-mod-prod-card-${priorityClass}" data-product-id="${product.id}">
            <div class="prod-mod-prod-card-priority-box">${priorityNumber}</div>
            
            <div class="prod-mod-prod-card-product-name">${product.product_name || 'Produkt bez nazwy'}</div>
            
            <div class="prod-mod-prod-card-specifications-container">
                <div class="prod-mod-prod-card-info-column ${woodSpeciesClass}">
                    <div class="prod-mod-prod-card-info-value">${product.wood_species || '-'}</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column ${technologyClass}">
                    <div class="prod-mod-prod-card-info-value">${product.wood_technology || '-'}</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column ${classTypeClass}">
                    <div class="prod-mod-prod-card-info-value">${product.wood_class || '-'}</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column prod-mod-prod-card-spec-dimensions" style="min-width: 210px;">
                    <div class="prod-mod-prod-card-info-value">${dimensions}</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column prod-mod-prod-card-quantity-column">
                    <div class="prod-mod-prod-card-info-value">${product.quantity || 1} szt.</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column ${deadlineClass}" style="padding: 12px;">
                    <div class="prod-mod-prod-card-info-label">TERMIN</div>
                    <div class="prod-mod-prod-card-info-value">${formatDeadlineText(product.deadline_date)}</div>
                </div>
            </div>
            
            <button type="button" class="prod-mod-prod-card-action-button" onclick="showStationWorkerModal(${product.id})">
                <i class="fas fa-play"></i>
                ROZPOCZNIJ
            </button>
        </div>
    `;

    if (prepend && container.firstChild) {
        container.insertAdjacentHTML('afterbegin', productHTML);
    } else {
        container.insertAdjacentHTML('beforeend', productHTML);
    }
}

/**
 * NOWY KOD - Określa klasę CSS dla gatunku drewna
 */
function getWoodSpeciesClass(species) {
    if (!species) return '';
    
    const speciesLower = species.toLowerCase();
    if (speciesLower.includes('dąb') || speciesLower.includes('dab')) {
        return 'prod-mod-prod-card-spec-wood-dab';
    }
    if (speciesLower.includes('buk')) {
        return 'prod-mod-prod-card-spec-wood-buk';
    }
    if (speciesLower.includes('jesion')) {
        return 'prod-mod-prod-card-spec-wood-jesion';
    }
    if (speciesLower.includes('sosna')) {
        return 'prod-mod-prod-card-spec-wood-sosna';
    }
    return '';
}

/**
 * NOWY KOD - Określa klasę CSS dla technologii
 */
function getTechnologyClass(technology) {
    if (!technology) return '';
    
    const techLower = technology.toLowerCase();
    if (techLower.includes('lita') || techLower.includes('lity')) {
        return 'prod-mod-prod-card-spec-tech-lita';
    }
    if (techLower.includes('mikrowczep')) {
        return 'prod-mod-prod-card-spec-tech-mikrowczep';
    }
    return '';
}

/**
 * NOWY KOD - Określa klasę CSS dla klasy drewna
 */
function getClassTypeClass(woodClass) {
    if (!woodClass) return '';
    
    const classLower = woodClass.toLowerCase().replace(/[\/\s]/g, '');
    if (classLower === 'aa' || classLower === 'a/a') {
        return 'prod-mod-prod-card-spec-class-aa';
    }
    if (classLower === 'ab' || classLower === 'a/b') {
        return 'prod-mod-prod-card-spec-class-ab';
    }
    if (classLower === 'bb' || classLower === 'b/b') {
        return 'prod-mod-prod-card-spec-class-bb';
    }
    if (classLower.includes('rustic')) {
        return 'prod-mod-prod-card-spec-class-rustic';
    }
    return '';
}

/**
 * NOWY KOD - Określa klasę CSS dla terminu realizacji
 */
function getDeadlineClass(deadlineDate) {
    if (!deadlineDate) return 'prod-mod-prod-card-deadline-future';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const deadline = new Date(deadlineDate);
    deadline.setHours(0, 0, 0, 0);
    
    const diffTime = deadline.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
        return 'prod-mod-prod-card-deadline-past';
    } else if (diffDays === 0) {
        return 'prod-mod-prod-card-deadline-today';
    } else if (diffDays === 1) {
        return 'prod-mod-prod-card-deadline-tomorrow';
    } else {
        return 'prod-mod-prod-card-deadline-future';
    }
}

/**
 * NOWY KOD - Formatuje tekst terminu realizacji
 */
function formatDeadlineText(deadlineDate) {
    if (!deadlineDate) return 'brak terminu';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const deadline = new Date(deadlineDate);
    deadline.setHours(0, 0, 0, 0);
    
    const diffTime = deadline.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
        const daysPast = Math.abs(diffDays);
        if (daysPast === 1) {
            return 'wczoraj';
        } else {
            return `${daysPast} dni temu`;
        }
    } else if (diffDays === 0) {
        return 'DZIŚ!';
    } else if (diffDays === 1) {
        return 'JUTRO';
    } else if (diffDays <= 90) {
        return `za ${diffDays} dni`;
    } else {
        return formatDate(deadlineDate);
    }
}

/**
 * Usuń produkt z gridu
 */
function removeProductFromGrid(productId) {
    const productElement = document.querySelector(`[data-product-id="${productId}"]`);
    if (productElement) {
        productElement.remove();
    }
}

/**
 * Inteligentne odświeżanie danych - POPRAWIONA WERSJA z zachowaniem timerów
 */
async function refreshDataIncrementally() {
    console.log('🔄 [API] Rozpoczęcie inteligentnego odświeżania...');

    try {
        // Zapisz aktualny stan timerów przed aktualizacją
        const currentTimerStates = {};
        gluingState.stations.forEach(station => {
            if (station.status === 'busy' && station.current_item_id) {
                currentTimerStates[station.id] = {
                    working_time_seconds: station.working_time_seconds,
                    current_item_id: station.current_item_id,
                    start_time: station.start_time
                };
            }
        });

        console.log(`💾 [TIMER] Zapisano stan ${Object.keys(currentTimerStates).length} aktywnych stacji`);

        // 1. Odśwież statusy stanowisk (zawsze)
        const stationsResult = await fetchStations();
        if (stationsResult.success) {
            // Przywróć lokalne timery dla stacji, które nadal pracują nad tym samym produktem
            const updatedStations = stationsResult.data.map(station => {
                const savedTimer = currentTimerStates[station.id];

                if (savedTimer &&
                    station.status === 'busy' &&
                    station.current_item_id === savedTimer.current_item_id &&
                    station.start_time === savedTimer.start_time) {

                    // Zachowaj lokalny stan timera
                    station.working_time_seconds = savedTimer.working_time_seconds;
                    console.log(`⏱️ [TIMER] Przywrócono lokalny timer dla stacji ${station.id}`);
                } else if (station.status === 'busy' && station.current_item_id) {
                    console.log(`🔄 [TIMER] Nowy timer dla stacji ${station.id} (produkt: ${station.current_item_id})`);
                }

                return station;
            });

            updateStationsData(updatedStations);
        }

        // 2. Sprawdź czy są nowe produkty
        const productsResult = await fetchProducts();
        if (productsResult.success) {
            updateProductsData(productsResult.data);
        }

        updateLastSyncTime();
        console.log('✅ [API] Inteligentne odświeżanie zakończone');

    } catch (error) {
        console.error('❌ [API] Błąd inteligentnego odświeżania:', error);
    }
}

/**
 * Uruchomienie automatycznego odświeżania - POPRAWIONA WERSJA
 */
function startAutoRefresh() {
    console.log('🔄 Uruchamianie auto-refresh...');

    // Wyczyść poprzednie timery
    if (gluingState.refreshTimer) {
        clearInterval(gluingState.refreshTimer);
    }
    if (gluingState.uiTimer) {
        clearInterval(gluingState.uiTimer);
    }

    // Timer głównego odświeżania danych (co 3 minuty)
    gluingState.refreshTimer = setInterval(async () => {
        console.log('🔄 Auto-refresh danych...');

        try {
            // Sprawdź czy strona jest aktywna (nie w tle)
            if (document.hidden) {
                console.log('⏸️ Strona w tle - pomijam odświeżenie');
                return;
            }

            await refreshAllData();

        } catch (error) {
            console.error('❌ Błąd auto-refresh:', error);

            // Jeśli błąd 401/403, odśwież stronę
            if (error.message && (error.message.includes('401') || error.message.includes('403'))) {
                showToast('warning', 'Sesja wygasła - odświeżanie strony...');
                setTimeout(() => window.location.reload(), 2000);
            }
        }
    }, GLUING_CONFIG.refreshInterval);

    // ZMIANA: Timer UI (co 1 sekundę) - tylko liczniki czasu i aktualizacja sync time
    gluingState.uiTimer = setInterval(() => {
        if (!document.hidden) {
            updateStationTimers(); // Aktualizuj liczniki co sekundę

            // Aktualizuj czas synchronizacji tylko co 5 sekund
            const now = Math.floor(Date.now() / 1000);
            if (now % 5 === 0) {
                updateLastSyncTime();
            }
        }
    }, 1000); // ZMIANA: 1000ms zamiast 5000ms

    console.log('✅ Auto-refresh uruchomiony - dane co 3min, UI co 1s');
}

// === API CALLS ===

/**
 * Pobieranie listy stanowisk - POPRAWIONA WERSJA z walidacją
 */
async function fetchStations() {
    try {
        console.log('📡 Pobieranie stanowisk...');
        const response = await fetch('/production/api/stations/status', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ Otrzymane dane stanowisk:', data);

        if (data.data && Array.isArray(data.data)) {
            console.log('Stations API response valid - count:', data.data.length);
            if (data.data.length > 0) {
                console.log('Sample station fields:', Object.keys(data.data[0]));
            }
        } else {
            console.warn('Unexpected stations API response structure:', data);
        }

        // Walidacja struktury odpowiedzi
        if (!data || !data.success) {
            throw new Error('Nieprawidłowa struktura odpowiedzi API');
        }

        const stations = data.data || [];

        // Walidacja czy są stanowiska sklejania
        const gluingStations = stations.filter(s =>
            s.station_type === 'gluing' && s.is_active !== false
        );

        if (gluingStations.length === 0) {
            console.warn('⚠️ Brak dostępnych stanowisk sklejania');
        }

        return { success: true, data: stations };

    } catch (error) {
        console.error('❌ Błąd pobierania stanowisk:', error);

        // Sprawdź czy to błąd sesji/autoryzacji
        if (error.message.includes('401') || error.message.includes('403')) {
            showToast('error', 'Sesja wygasła - odśwież stronę');
            setTimeout(() => window.location.reload(), 2000);
        }

        return { success: false, error: error.message };
    }
}

/**
 * Pobieranie listy pracowników - POPRAWIONA WERSJA z walidacją
 */
async function fetchWorkers() {
    try {
        console.log('👥 Pobieranie pracowników...');
        const response = await fetch('/production/api/workers', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ Otrzymane dane pracowników:', data);

        // Walidacja struktury odpowiedzi
        if (!data || !data.success) {
            throw new Error('Nieprawidłowa struktura odpowiedzi API');
        }

        const workers = data.data || [];

        // Walidacja czy są pracownicy dla sklejania
        const gluingWorkers = workers.filter(w =>
            w.is_active !== false &&
            (w.station_type_preference === 'gluing' || w.station_type_preference === 'both')
        );

        if (gluingWorkers.length === 0) {
            console.warn('⚠️ Brak dostępnych pracowników dla sklejania');
        }

        return { success: true, data: workers };

    } catch (error) {
        console.error('❌ Błąd pobierania pracowników:', error);

        // Sprawdź czy to błąd sesji/autoryzacji
        if (error.message.includes('401') || error.message.includes('403')) {
            showToast('error', 'Sesja wygasła - odśwież stronę');
            setTimeout(() => window.location.reload(), 2000);
        }

        return { success: false, error: error.message };
    }
}

/**
 * Pobieranie kolejki produktów (wszystkie nieukończone)
 */
async function fetchProducts() {
    try {
        // Pobierz wszystkie produkty oprócz completed
        const response = await fetch('/production/api/items?status=pending&status=in_progress');
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        return { success: true, data: data.data || [] };
    } catch (error) {
        console.error('❌ Błąd pobierania produktów:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Rozpoczęcie produkcji
 */
async function startProductionAPI(itemId, stationId, workerId) {
    try {
        const url = GLUING_CONFIG.apiEndpoints.startProduction.replace('{itemId}', itemId);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                station_id: stationId,
                worker_id: workerId
            })
        });

        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        return { success: true, data: data };
    } catch (error) {
        console.error('❌ Błąd rozpoczęcia produkcji:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Zakończenie produkcji
 */
async function completeProductionAPI(itemId) {
    try {
        const url = GLUING_CONFIG.apiEndpoints.completeProduction.replace('{itemId}', itemId);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        return { success: true, data: data };
    } catch (error) {
        console.error('❌ Błąd zakończenia produkcji:', error);
        return { success: false, error: error.message };
    }
}

// === RENDERING ===

/**
 * Renderowanie stanowisk
 */
function renderStations() {
    const container = document.getElementById('stationsGrid');
    if (!container) return;

    const gluingStations = gluingState.stations.filter(station =>
        station.station_type === 'gluing' && station.is_active
    );

    if (!gluingStations.length) {
        container.innerHTML = `
            <div class="prod-work-station-loading">
                <i class="fas fa-exclamation-circle"></i>
                <span>Brak dostępnych stanowisk sklejania</span>
            </div>
        `;
        return;
    }

    container.innerHTML = gluingStations.map(station => {
        const isWorking = station.current_item_id && station.current_item_id > 0;
        if (isWorking) {
            // Aktywne stanowisko - tylko zawartość bez nazwy i statusu
            const statusClass = getStationStatusClass('active');
            return `
                <div class="prod-work-station ${statusClass}" data-station-id="${station.id}">
                    ${renderActiveStationContent(station)}
                </div>
            `;
        } else {
            // Bezczynne stanowisko - z nazwą i statusem
            return `
                <div class="prod-work-station idle" data-station-id="${station.id}">
                    <div class="prod-work-station-name">${station.name}</div>
                    <div class="prod-work-station-status">Bezczynny</div>
                </div>
            `;
        }
    }).join('');
}

/**
 * Renderowanie zawartości aktywnego stanowiska (bez nazwy stanowiska)
 */
function renderActiveStationContent(station) {
    const standardTimeMinutes = parseInt(document.querySelector('[data-config-gluing-time]')?.value) || 2;
    const standardTimeSeconds = standardTimeMinutes * 60;

    const workingSeconds = station.working_time_seconds || 0;
    const remainingSeconds = standardTimeSeconds - workingSeconds;

    // Format produktu z dużej litery na początku gatunku
    let productInfo = 'Produkt';
    if (station.current_product) {
        const product = station.current_product;
        const species = product.wood_species ? product.wood_species.charAt(0).toUpperCase() + product.wood_species.slice(1) : '';
        const technology = product.wood_technology || '';
        const woodClass = product.wood_class || '';
        const dimensions = product.dimensions || `${product.dimensions_length || 0}×${product.dimensions_width || 0}×${product.dimensions_thickness || 0}`;

        productInfo = `${species} ${technology} ${woodClass} ${dimensions} cm`.trim();
    }

    const workerName = station.current_worker ? station.current_worker.name : 'Pracownik';

    return `
        <div class="prod-work-station-header">
            <div class="prod-work-station-product-info">${productInfo}</div>
            <div class="prod-work-station-worker-info">${workerName}</div>
        </div>
        <div class="prod-work-station-timer" id="timer-${station.id}">
            ${formatCountdownTimer(remainingSeconds)}
        </div>
        <button type="button" class="prod-work-station-btn" onclick="completeProduction(${station.current_item_id || 0})">
            ZAKOŃCZ
        </button>
    `;
}

/**
 * Formatowanie timera odliczającego (MM:SS lub +MM:SS dla overtime)
 */
function formatCountdownTimer(remainingSeconds) {
    if (remainingSeconds > 0) {
        // Normalny czas - odliczanie w dół
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
        // Overtime - liczenie czasu przekroczenia
        const overtimeSeconds = Math.abs(remainingSeconds);
        const minutes = Math.floor(overtimeSeconds / 60);
        const seconds = overtimeSeconds % 60;
        return `+${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

/**
 * Renderowanie produktów
 */
function renderProducts() {
    const container = document.getElementById('productsGrid');
    const countElement = document.getElementById('queueCount');

    if (!container) return;

    if (countElement) {
        countElement.textContent = gluingState.products.length;
    }

    if (!gluingState.products.length) {
        container.innerHTML = `
            <div class="prod-work-products-loading">
                <i class="fas fa-inbox"></i>
                <span>Brak produktów w kolejce</span>
            </div>
        `;
        return;
    }

    // Renderuj wszystkie produkty używając nowego designu
    container.innerHTML = gluingState.products.map(product => {
        const priorityClass = getPriorityClass(product);
        const priorityNumber = product.priority_score || 0;
        
        // Określ klasy CSS dla specyfikacji
        const woodSpeciesClass = getWoodSpeciesClass(product.wood_species);
        const technologyClass = getTechnologyClass(product.wood_technology);
        const classTypeClass = getClassTypeClass(product.wood_class);
        const deadlineClass = getDeadlineClass(product.deadline_date);
        
        // Formatuj wymiary
        const dimensions = formatProductDimensions(product);
        
        return `
            <div class="prod-mod-prod-card-product-box prod-mod-prod-card-${priorityClass}" data-product-id="${product.id}">
                <div class="prod-mod-prod-card-priority-box">${priorityNumber}</div>
                
                <div class="prod-mod-prod-card-product-name">${product.product_name || 'Produkt bez nazwy'}</div>
                
                <div class="prod-mod-prod-card-specifications-container">
                    <div class="prod-mod-prod-card-info-column ${woodSpeciesClass}">
                        <div class="prod-mod-prod-card-info-value">${product.wood_species || '-'}</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column ${technologyClass}">
                        <div class="prod-mod-prod-card-info-value">${product.wood_technology || '-'}</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column ${classTypeClass}">
                        <div class="prod-mod-prod-card-info-value">${product.wood_class || '-'}</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column prod-mod-prod-card-spec-dimensions" style="min-width: 210px;">
                        <div class="prod-mod-prod-card-info-value">${dimensions}</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column prod-mod-prod-card-quantity-column">
                        <div class="prod-mod-prod-card-info-value">${product.quantity || 1} szt.</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column ${deadlineClass}" style="padding: 12px;">
                        <div class="prod-mod-prod-card-info-label">TERMIN</div>
                        <div class="prod-mod-prod-card-info-value">${formatDeadlineText(product.deadline_date)}</div>
                    </div>
                </div>
                
                <button type="button" class="prod-mod-prod-card-action-button" onclick="showStationWorkerModal(${product.id})">
                    <i class="fas fa-play"></i>
                    ROZPOCZNIJ
                </button>
            </div>
        `;
    }).join('');
}

/**
 * Renderowanie badge'ów produktu z wymiarami
 */
function renderProductBadges(product) {
    const badges = [];

    if (product.wood_species) {
        badges.push(`<span class="prod-work-badge species-${normalizeValue(product.wood_species)}">${product.wood_species}</span>`);
    }

    if (product.wood_technology) {
        badges.push(`<span class="prod-work-badge tech-${normalizeValue(product.wood_technology)}">${product.wood_technology}</span>`);
    }

    if (product.wood_class) {
        badges.push(`<span class="prod-work-badge class-${normalizeValue(product.wood_class)}">${product.wood_class}</span>`);
    }

    return badges.join('');
}

/**
 * Renderowanie modala wyboru stanowiska i pracownika - NOWA WERSJA
 */
function renderStationWorkerModal(product) {
    console.log('🎨 Renderowanie modala...', {
        product,
        stationsCount: gluingState.stations.length,
        workersCount: gluingState.workers.length
    });

    // Informacje o produkcie
    const productInfoContainer = document.getElementById('modalProductInfo');
    if (productInfoContainer && product) {
        // Nazwa produktu
        const productNameEl = document.getElementById('modalProductName');
        if (productNameEl) {
            productNameEl.textContent = product.product_name || 'Produkt bez nazwy';
        }

        // Wymiary
        const productDimensionsEl = document.getElementById('modalProductDimensions');
        if (productDimensionsEl) {
            const dimensions = formatProductDimensions(product);
            productDimensionsEl.textContent = dimensions;
        }

        // Gatunek drewna
        const productSpeciesEl = document.getElementById('modalProductSpecies');
        if (productSpeciesEl) {
            productSpeciesEl.textContent = product.wood_species || 'Nieznany';
        }

        // Technologia
        const productTechnologyEl = document.getElementById('modalProductTechnology');
        if (productTechnologyEl) {
            productTechnologyEl.textContent = product.wood_technology || 'Nieznana';
        }

        // Klasa drewna
        const productClassEl = document.getElementById('modalProductClass');
        if (productClassEl) {
            productClassEl.textContent = product.wood_class || 'Nieznana';
        }

        // Ilość
        const productQuantityEl = document.getElementById('modalProductQuantity');
        if (productQuantityEl) {
            productQuantityEl.textContent = `${product.quantity || 0} szt.`;
        }

        // Deadline
        const productDeadlineEl = document.getElementById('modalProductDeadline');
        if (productDeadlineEl) {
            if (product.deadline_date) {
                const deadline = new Date(product.deadline_date);
                const today = new Date();
                const diffTime = deadline.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                let deadlineText;
                if (diffDays < 0) {
                    deadlineText = `${Math.abs(diffDays)} dni temu`;
                } else if (diffDays === 0) {
                    deadlineText = 'Dziś';
                } else if (diffDays === 1) {
                    deadlineText = 'Jutro';
                } else {
                    deadlineText = `Za ${diffDays} dni`;
                }
                
                productDeadlineEl.textContent = deadlineText;
            } else {
                productDeadlineEl.textContent = 'Brak terminu';
            }
        }
    }

    // STANOWISKA - POPRAWIONE z lepszą walidacją
    const stationsContainer = document.getElementById('modalStationsGrid');
    if (stationsContainer) {
        // Waliduj dostępność danych stanowisk
        if (!gluingState.stations || gluingState.stations.length === 0) {
            console.warn('⚠️ Brak danych stanowisk w modal render');
            stationsContainer.innerHTML = `
                <div class="prod-work-modal-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Brak dostępnych stanowisk</span>
                    <button class="prod-work-btn prod-work-btn-sm" onclick="refreshAllData()">
                        <i class="fas fa-sync"></i> Odśwież
                    </button>
                </div>
            `;
            return;
        }

        renderModalStations();
    }

    // PRACOWNICY - POPRAWIONE z lepszą walidacją
    const workersContainer = document.getElementById('modalWorkersGrid');
    if (workersContainer) {
        // Waliduj dostępność danych pracowników
        if (!gluingState.workers || gluingState.workers.length === 0) {
            console.warn('⚠️ Brak danych pracowników w modal render');
            workersContainer.innerHTML = `
                <div class="prod-work-modal-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Brak dostępnych pracowników</span>
                    <button class="prod-work-btn prod-work-btn-sm" onclick="refreshAllData()">
                        <i class="fas fa-sync"></i> Odśwież
                    </button>
                </div>
            `;
            return;
        }

        const gluingWorkers = gluingState.workers.filter(worker =>
            worker.is_active !== false &&
            (worker.station_type_preference === 'gluing' || worker.station_type_preference === 'both')
        );

        if (gluingWorkers.length === 0) {
            workersContainer.innerHTML = `
                <div class="prod-work-modal-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Brak dostępnych pracowników dla sklejania</span>
                    <button class="prod-work-btn prod-work-btn-sm" onclick="refreshAllData()">
                        <i class="fas fa-sync"></i> Odśwież
                    </button>
                </div>
            `;
        } else {
            workersContainer.innerHTML = gluingWorkers.map(worker => {
                const isAvailable = worker.is_active !== false;
                const disabledClass = isAvailable ? '' : 'disabled';

                return `
                    <div class="prod-work-selection-item ${disabledClass}" 
                         data-worker-id="${worker.id}" 
                         ${isAvailable ? 'onclick="selectWorker(' + worker.id + ')"' : ''}>
                        <div class="prod-work-selection-item-name">${worker.name}</div>
                        <div class="prod-work-selection-item-status">
                            ${isAvailable ? 'Dostępny' : 'Niedostępny'}
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}

/**
 * Renderowanie stanowisk w modalu
 */
function renderModalStations() {
    const stationsContainer = document.getElementById('modalStationsGrid');
    if (!stationsContainer) return;

    if (!gluingState.stations || gluingState.stations.length === 0) {
        stationsContainer.innerHTML = `
            <div class="prod-work-modal-error">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Brak dostępnych stanowisk - odśwież dane</span>
                <button class="prod-work-btn prod-work-btn-sm" onclick="refreshAllData()">
                    <i class="fas fa-sync"></i> Odśwież
                </button>
            </div>
        `;
        return;
    }

    const gluingStations = gluingState.stations.filter(station =>
        station.station_type === 'gluing' && station.is_active !== false
    );

    if (gluingStations.length === 0) {
        stationsContainer.innerHTML = `
            <div class="prod-work-modal-error">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Brak aktywnych stanowisk sklejania</span>
                <button class="prod-work-btn prod-work-btn-sm" onclick="refreshAllData()">
                    <i class="fas fa-sync"></i> Odśwież
                </button>
            </div>
        `;
        return;
    }

    stationsContainer.innerHTML = gluingStations.map(station => {
        // Sprawdź różne sposoby oznaczania zajętości
        const isBusy = station.is_busy || station.current_item_id || station.status === 'busy';
        const isAvailable = !isBusy && station.is_active !== false;
        const disabledClass = isAvailable ? '' : 'disabled';

        return `
            <div class="prod-work-selection-item ${disabledClass}" 
                 data-station-id="${station.id}" 
                 ${isAvailable ? 'onclick="selectStation(' + station.id + ')"' : ''}>
                <div class="prod-work-selection-item-name">${station.name}</div>
                <div class="prod-work-selection-item-status">
                    ${isAvailable ? 'Dostępne' : 'Zajęte'}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * NOWA FUNKCJA: Formatowanie wymiarów produktu
 */
function formatProductDimensions(product) {
    // Sprawdź różne sposoby przechowywania wymiarów
    if (product.dimensions && product.dimensions !== '-') {
        return product.dimensions;
    }

    const length = product.dimensions_length;
    const width = product.dimensions_width; 
    const thickness = product.dimensions_thickness;

    if (length && width && thickness) {
        return `${length} × ${width} × ${thickness}`;
    }

    if (length && width) {
        return `${length} × ${width}`;
    }

    if (length) {
        return `${length}`;
    }

    // Sprawdź czy wymiary są w nazwie produktu
    const dimensionMatch = product.product_name?.match(/(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)/);
    if (dimensionMatch) {
        return `${dimensionMatch[1]} × ${dimensionMatch[2]} × ${dimensionMatch[3]}`;
    }

    return 'Brak wymiarów';
}

// === EVENT HANDLERS ===

/**
 * Pokazanie modala wyboru stanowiska i pracownika - POPRAWIONA WERSJA
 */
function showStationWorkerModal(productId, preselectedStationId = null) {
    console.log('🔄 Otwieranie modala wyboru...', { productId, preselectedStationId });

    // Waliduj czy mamy dane
    if (!gluingState.stations.length || !gluingState.workers.length) {
        console.warn('⚠️ Brak danych - wymuszam odświeżenie przed otwarciem modala');
        showToast('info', 'Odświeżanie danych...');

        loadInitialData().then(() => {
            // Spróbuj ponownie po załadowaniu
            setTimeout(() => showStationWorkerModal(productId, preselectedStationId), 500);
        });
        return;
    }

    const product = productId ? gluingState.products.find(p => p.id === productId) : null;

    if (productId && !product) {
        showToast('error', 'Nie znaleziono produktu o ID: ' + productId);
        console.error('Produkt nie znaleziony:', productId, 'Dostępne produkty:', gluingState.products);
        return;
    }

    // Reset stanu modala
    resetModalState();

    // Ustaw nowe wartości
    gluingState.selectedProduct = product;

    // Ustaw ID produktu w ukrytym polu
    if (productId) {
        const productIdField = document.getElementById('selectedProductId');
        if (productIdField) {
            productIdField.value = productId;
        }
    }

    // Render modala z walidacją
    renderStationWorkerModal(product);

    // Jeśli jest preselected station, wybierz go automatycznie
    if (preselectedStationId) {
        setTimeout(() => selectStation(preselectedStationId), 100);
    }

    // Pokaż modal
    try {
        const modalElement = document.getElementById('stationWorkerModal');
        if (modalElement) {
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        } else {
            console.error('❌ Modal element not found: stationWorkerModal');
            showToast('error', 'Błąd: Nie można otworzyć modala - odśwież stronę');
        }
    } catch (error) {
        console.error('❌ Błąd otwierania modala:', error);
        showToast('error', 'Błąd otwierania modala wyboru - odśwież stronę');
    }
}

/**
 * Wybór stanowiska - POPRAWIONA WERSJA z walidacją
 */
function selectStation(stationId) {
    console.log('🏭 Wybór stanowiska:', stationId);

    // Waliduj czy stanowisko istnieje i jest dostępne
    const station = gluingState.stations.find(s => s.id == stationId);
    if (!station) {
        console.error('❌ Stanowisko nie znalezione:', stationId);
        showToast('error', 'Stanowisko nie zostało znalezione');
        return;
    }

    const isBusy = station.is_busy || station.current_item_id || station.status === 'busy';
    if (isBusy) {
        console.warn('⚠️ Stanowisko zajęte:', stationId);
        showToast('warning', 'To stanowisko jest obecnie zajęte');
        return;
    }

    if (!station.is_active) {
        console.warn('⚠️ Stanowisko nieaktywne:', stationId);
        showToast('warning', 'To stanowisko jest nieaktywne');
        return;
    }

    // Usuń poprzedni wybór
    document.querySelectorAll('#modalStationsGrid .prod-work-selection-item').forEach(item => {
        item.classList.remove('selected');
    });

    // Zaznacz nowe stanowisko
    const stationElement = document.querySelector(`#modalStationsGrid [data-station-id="${stationId}"]`);
    if (stationElement && !stationElement.classList.contains('disabled')) {
        stationElement.classList.add('selected');
        gluingState.selectedStation = station;
        document.getElementById('selectedStationId').value = stationId;

        updateStartButtonState();
        console.log('✅ Stanowisko wybrane:', station.name);
    } else {
        console.error('❌ Element stanowiska nie znaleziony lub jest wyłączony');
        showToast('error', 'Nie można wybrać tego stanowiska');
    }
}

/**
 * Debounce function - opóźnia wykonanie funkcji
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function - ogranicza częstotliwość wykonania funkcji
 */
function throttle(func, limit) {
    let inThrottle;
    return function () {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

/**
 * Bezpieczne parsowanie JSON
 */
function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str);
    } catch (error) {
        console.warn('⚠️ Błąd parsowania JSON:', error);
        return defaultValue;
    }
}

/**
 * Aktualizacja stanu przycisku rozpoczęcia produkcji
 */
function updateStartButtonState() {
    const startButton = document.getElementById('startProductionBtn');
    if (!startButton) return;

    const hasStation = gluingState.selectedStation && gluingState.selectedStation.id;
    const hasWorker = gluingState.selectedWorker && gluingState.selectedWorker.id;
    const hasProduct = gluingState.selectedProduct && gluingState.selectedProduct.id;

    const canStart = hasStation && hasWorker && (hasProduct || !gluingState.selectedProduct);

    startButton.disabled = !canStart;

    // Aktualizuj tekst przycisku
    if (!hasStation && !hasWorker) {
        startButton.innerHTML = '<i class="fas fa-exclamation-circle"></i> Wybierz stanowisko i pracownika';
    } else if (!hasStation) {
        startButton.innerHTML = '<i class="fas fa-exclamation-circle"></i> Wybierz stanowisko';
    } else if (!hasWorker) {
        startButton.innerHTML = '<i class="fas fa-exclamation-circle"></i> Wybierz pracownika';
    } else {
        startButton.innerHTML = '<i class="fas fa-play"></i> Rozpocznij Produkcję';
    }

    console.log('🔄 Stan przycisku start:', { canStart, hasStation, hasWorker, hasProduct });
}

/**
 * Wybór pracownika - POPRAWIONA WERSJA z walidacją
 */
function selectWorker(workerId) {
    console.log('👤 Wybór pracownika:', workerId);

    // Waliduj czy pracownik istnieje i jest dostępny
    const worker = gluingState.workers.find(w => w.id == workerId);
    if (!worker) {
        console.error('❌ Pracownik nie znaleziony:', workerId);
        showToast('error', 'Pracownik nie został znaleziony');
        return;
    }

    if (worker.is_active === false) {
        console.warn('⚠️ Pracownik nieaktywny:', workerId);
        showToast('warning', 'Ten pracownik jest obecnie niedostępny');
        return;
    }

    // Usuń poprzedni wybór
    document.querySelectorAll('#modalWorkersGrid .prod-work-selection-item').forEach(item => {
        item.classList.remove('selected');
    });

    // Zaznacz nowego pracownika
    const workerElement = document.querySelector(`#modalWorkersGrid [data-worker-id="${workerId}"]`);
    if (workerElement && !workerElement.classList.contains('disabled')) {
        workerElement.classList.add('selected');
        gluingState.selectedWorker = worker;
        document.getElementById('selectedWorkerId').value = workerId;

        updateStartButtonState();
        console.log('✅ Pracownik wybrany:', worker.name);
    } else {
        console.error('❌ Element pracownika nie znaleziony lub jest wyłączony');
        showToast('error', 'Nie można wybrać tego pracownika');
    }
}

/**
 * Aktualizacja stanu przycisku po wyborach w modalu
 */
function updateModalSummary() {
    const startButton = document.getElementById('startProductionBtn');

    if (gluingState.selectedStation && gluingState.selectedWorker) {
        // Aktywuj przycisk start
        startButton.disabled = false;
    } else {
        // Deaktywuj przycisk start
        startButton.disabled = true;
    }
}

/**
 * Rozpoczęcie produkcji
 */
async function startProduction() {
    const productId = document.getElementById('selectedProductId').value;
    const stationId = document.getElementById('selectedStationId').value;
    const workerId = document.getElementById('selectedWorkerId').value;

    if (!productId || !stationId || !workerId) {
        showToast('error', 'Wybierz wszystkie wymagane opcje');
        return;
    }

    const startButton = document.getElementById('startProductionBtn');
    startButton.disabled = true;
    startButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rozpoczynam...';

    try {
        const result = await startProductionAPI(productId, stationId, workerId);

        if (result.success) {
            // Zamknij modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('stationWorkerModal'));
            modal.hide();

            // NOWE: Odśwież wszystkie dane
            showToast('info', 'Odświeżam dane...');
            await loadInitialData();

        } else {
            throw new Error(result.error || 'Błąd rozpoczęcia produkcji');
        }

    } catch (error) {
        console.error('❌ Błąd rozpoczęcia produkcji:', error);
        showToast('error', 'Błąd: ' + error.message);
    } finally {
        startButton.disabled = false;
        startButton.innerHTML = '<i class="fas fa-play"></i> Rozpocznij Produkcję';
    }
}

/**
 * Zakończenie produkcji (bez modali)
 */
async function completeProduction(itemId) {
    try {
        const result = await completeProductionAPI(itemId);

        if (result.success) {
            await loadInitialData();
            showToast('success', 'Produkcja zakończona');
        } else {
            throw new Error(result.error || 'Błąd zakończenia produkcji');
        }

    } catch (error) {
        console.error('❌ Błąd zakończenia produkcji:', error);
        showToast('error', 'Błąd: ' + error.message);
    }
}

/**
 * Reset stanu modala
 */
function resetModalState() {
    gluingState.selectedProduct = null;
    gluingState.selectedStation = null;
    gluingState.selectedWorker = null;

    // Bezpieczne resetowanie pól formularza
    const productIdField = document.getElementById('selectedProductId');
    const stationIdField = document.getElementById('selectedStationId');
    const workerIdField = document.getElementById('selectedWorkerId');
    const startButton = document.getElementById('startProductionBtn');

    if (productIdField) productIdField.value = '';
    if (stationIdField) stationIdField.value = '';
    if (workerIdField) workerIdField.value = '';
    if (startButton) startButton.disabled = true;

    // Usuń zaznaczenia z elementów
    document.querySelectorAll('.prod-work-selection-item.selected').forEach(item => {
        item.classList.remove('selected');
    });

    console.log('Modal state reset');
}

// === TIMERY ===

/**
 * Aktualizuje timery na stanowiskach - UPROSZCZONA WERSJA
 */
function updateStationTimers() {
    const currentTime = Math.floor(Date.now() / 1000);
    let activeStations = 0;

    gluingState.stations.forEach(station => {
        // Sprawdzaj current_item zamiast is_busy
        if (station.current_item_id && station.current_item && station.current_item.gluing_started_at) {
            activeStations++;

            // Oblicz czas pracy na podstawie gluing_started_at z serwera
            const startTimestamp = Math.floor(new Date(station.current_item.gluing_started_at).getTime() / 1000);
            const workingTimeSeconds = currentTime - startTimestamp;

            // Aktualizuj czas pracy w stanie stanowiska
            station.working_time_seconds = workingTimeSeconds;

            // Użyj konfiguracji czasu z HTML - sprawdź różne możliwe selektory
            let standardTimeMinutes = 20; // wartość domyślna

            // Sprawdź różne sposoby przechowywania konfiguracji czasu
            const configElements = [
                document.querySelector('#gluingTimeConfig'),
                document.querySelector('[data-config-gluing-time]'),
                document.querySelector('[data-gluing-time]')
            ];

            for (const element of configElements) {
                if (element) {
                    const timeValue = element.getAttribute('data-config-gluing-time') ||
                        element.getAttribute('data-gluing-time') ||
                        element.value;
                    if (timeValue) {
                        standardTimeMinutes = parseInt(timeValue);
                        break;
                    }
                }
            }

            const standardTimeSeconds = standardTimeMinutes * 60;
            const remainingSeconds = standardTimeSeconds - workingTimeSeconds;

            const timerElement = document.getElementById(`timer-${station.id}`);
            if (timerElement) {
                // Aktualizuj tekst timera
                timerElement.textContent = formatCountdownTimer(remainingSeconds);

                const stationElement = timerElement.closest('.prod-work-station');
                if (stationElement) {
                    // Usuń poprzednie klasy
                    stationElement.classList.remove('active', 'overtime-warning', 'overtime');

                    // Dodaj odpowiednią klasę na podstawie czasu
                    if (remainingSeconds <= 0) {
                        stationElement.classList.add('overtime');
                    } else if (remainingSeconds <= 60) {
                        stationElement.classList.add('overtime-warning');
                    } else {
                        stationElement.classList.add('active');
                    }
                }
            }
        }
    });

    // Loguj tylko co 30 sekund żeby nie zaśmiecać konsoli
    if (currentTime % 30 === 0 || (gluingState.lastActiveStationsCount !== activeStations)) {
        console.log(`⏱️ [UI] Timer update - aktywnych stacji: ${activeStations}, czas: ${new Date().toLocaleTimeString()}`);
        gluingState.lastActiveStationsCount = activeStations;
    }
}

/**
 * NOWY KOD - Zatrzymanie wszystkich timerów
 */
function stopAllTimers() {
    console.log('⏹️ [TIMER] Zatrzymywanie wszystkich timerów...');

    if (gluingState.refreshTimer) {
        clearInterval(gluingState.refreshTimer);
        gluingState.refreshTimer = null;
        console.log('⏹️ [TIMER] Timer odświeżania danych zatrzymany');
    }

    if (gluingState.uiTimer) {
        clearInterval(gluingState.uiTimer);
        gluingState.uiTimer = null;
        console.log('⏹️ [TIMER] Timer UI zatrzymany');
    }
}

/**
 * NOWY KOD - Restart timerów (przydatne przy debugowaniu)
 */
function restartTimers() {
    console.log('🔄 [TIMER] Restart timerów...');
    stopAllTimers();
    setTimeout(() => {
        startAutoRefresh();
    }, 100);
}

/**
 * Formatowanie timera (sekundy -> MM:SS)
 */
function formatTimer(seconds) {
    if (seconds <= 0) {
        const overtime = Math.abs(seconds);
        const minutes = Math.floor(overtime / 60);
        const secs = overtime % 60;
        return `+${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formatowanie czasu (sekundy -> tekst)
 */
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formatowanie daty na względny czas z kolorami
 */
function formatDate(dateString) {
    if (!dateString) return '';

    const deadlineDate = new Date(dateString);
    const today = new Date();

    // Ustaw dzisiejszą datę na początek dnia
    today.setHours(0, 0, 0, 0);
    deadlineDate.setHours(0, 0, 0, 0);

    const diffTime = deadlineDate.getTime() - today.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let text, className;

    if (diffDays < 0) {
        // Przeszłe - czerwony
        const daysPast = Math.abs(diffDays);
        text = daysPast === 1 ? 'wczoraj' : `${daysPast} dni temu`;
        className = 'deadline-past';
    } else if (diffDays === 0) {
        // Dziś - żółty
        text = 'dziś';
        className = 'deadline-today';
    } else if (diffDays === 1) {
        // Jutro - żółty
        text = 'jutro';
        className = 'deadline-tomorrow';
    } else {
        // Przyszłe - niebieski
        text = `za ${diffDays} dni`;
        className = 'deadline-future';
    }

    return `<span class="${className}">${text}</span>`;
}

/**
 * Normalizacja wartości do klasy CSS
 */
function normalizeValue(value) {
    if (!value) return '';
    return value.toLowerCase()
        .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
        .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
        .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Pobieranie klasy CSS dla statusu stanowiska
 */
function getStationStatusClass(status) {
    switch (status) {
        case 'active': return 'active';
        case 'maintenance': return 'maintenance';
        case 'idle':
        default: return 'idle';
    }
}

/**
 * Pobieranie tekstu statusu stanowiska
 */
function getStationStatusText(status) {
    switch (status) {
        case 'active': return 'W produkcji';
        case 'maintenance': return 'Konserwacja';
        case 'idle':
        default: return 'Bezczynny';
    }
}

/**
 * Pobieranie klasy CSS dla priorytetu na podstawie daty deadline
 */
function getPriorityClass(product) {
    if (!product.deadline_date) {
        return 'priority-low'; // Brak deadline = niski priorytet
    }

    const deadlineDate = new Date(product.deadline_date);
    const today = new Date();

    // Ustaw dzisiejszą datę na początek dnia
    today.setHours(0, 0, 0, 0);
    deadlineDate.setHours(0, 0, 0, 0);

    const diffTime = deadlineDate.getTime() - today.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        // Przeszłe - wysoki priorytet (czerwony)
        return 'priority-high';
    } else if (diffDays <= 1) {
        // Dziś/jutro - średni priorytet (żółty)
        return 'priority-medium';
    } else {
        // Przyszłe - niski priorytet (niebieski)
        return 'priority-low';
    }
}

/**
 * Pokazanie stanu ładowania
 */
function showLoadingState() {
    const stationsGrid = document.getElementById('stationsGrid');
    const productsGrid = document.getElementById('productsGrid');

    if (stationsGrid) {
        stationsGrid.innerHTML = `
            <div class="prod-work-station-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Ładowanie stanowisk...</span>
            </div>
        `;
    }

    if (productsGrid) {
        productsGrid.innerHTML = `
            <div class="prod-work-products-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Ładowanie produktów...</span>
            </div>
        `;
    }

    console.log('⏳ Pokazano stan ładowania');
}

/**
 * Pokazanie stanu błędu
 */
function showErrorState() {
    const stationsGrid = document.getElementById('stationsGrid');
    const productsGrid = document.getElementById('productsGrid');

    if (stationsGrid) {
        stationsGrid.innerHTML = `
            <div class="prod-work-modal-error">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Błąd ładowania stanowisk</span>
                <button class="prod-work-btn prod-work-btn-primary" onclick="retryConnection()">
                    <i class="fas fa-sync"></i>
                    Spróbuj ponownie
                </button>
            </div>
        `;
    }

    if (productsGrid) {
        productsGrid.innerHTML = `
            <div class="prod-work-modal-error">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Błąd ładowania produktów</span>
                <button class="prod-work-btn prod-work-btn-primary" onclick="retryConnection()">
                    <i class="fas fa-sync"></i>
                    Spróbuj ponownie
                </button>
            </div>
        `;
    }

    console.log('❌ Pokazano stan błędu');
}

/**
 * Aktualizacja czasu ostatniej synchronizacji - POPRAWIONA WERSJA
 */
function updateLastSyncTime() {
    const syncElement = document.getElementById('lastSyncTime');
    if (syncElement) {
        const now = new Date();
        gluingState.lastSync = now.getTime();

        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');

        syncElement.textContent = `${hours}:${minutes}:${seconds}`;
        syncElement.title = `Ostatnia synchronizacja: ${now.toLocaleString()}`;
    }
}

/**
 * Sprawdzenie połączenia z serwerem
 */
async function checkServerConnection() {
    try {
        const response = await fetch('/production/api/health-check', {
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache' },
            signal: AbortSignal.timeout(5000) // 5 sekund timeout
        });

        return response.ok;

    } catch (error) {
        console.error('❌ Błąd sprawdzania połączenia:', error);
        return false;
    }
}

/**
 * Pokazanie stanu połączenia
 */
function showConnectionStatus(status) {
    let statusElement = document.querySelector('.prod-work-connection-status');

    if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.className = 'prod-work-connection-status';
        document.body.appendChild(statusElement);
    }

    const messages = {
        online: 'Połączono z serwerem',
        offline: 'Brak połączenia',
        reconnecting: 'Próba ponownego połączenia...'
    };

    statusElement.className = `prod-work-connection-status ${status}`;
    statusElement.innerHTML = `
        <i class="fas fa-${status === 'online' ? 'check' : status === 'offline' ? 'times' : 'sync fa-spin'}"></i>
        ${messages[status]}
    `;

    // Auto-hide dla status online
    if (status === 'online') {
        setTimeout(() => {
            if (statusElement.parentElement) {
                statusElement.style.opacity = '0';
                setTimeout(() => statusElement.remove(), 300);
            }
        }, 3000);
    }
}

/**
 * Pokazanie toast notification - POPRAWIONA WERSJA
 */
function showToast(type, message, duration = 3000) {
    // Utwórz kontener jeśli nie istnieje
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // Ikony dla różnych typów
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };

    // Utwórz toast
    const toast = document.createElement('div');
    toast.className = `prod-work-toast ${type}`;
    toast.innerHTML = `
        <div class="prod-work-toast-content">
            <i class="prod-work-toast-icon ${icons[type] || icons.info}"></i>
            <div class="prod-work-toast-message">${message}</div>
            <button class="prod-work-toast-close" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

    container.appendChild(toast);

    // Pokaż toast
    setTimeout(() => toast.classList.add('show'), 100);

    // Auto-remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 300);
    }, duration);

    console.log(`📢 Toast [${type.toUpperCase()}]: ${message}`);
}

/**
 * Pobieranie ikony dla toast
 */
function getToastIcon(type) {
    switch (type) {
        case 'success': return 'fas fa-check-circle text-success';
        case 'error': return 'fas fa-exclamation-circle text-danger';
        case 'warning': return 'fas fa-exclamation-triangle text-warning';
        case 'info': return 'fas fa-info-circle text-info';
        default: return 'fas fa-info-circle text-info';
    }
}

/**
 * Pobieranie tytułu dla toast
 */
function getToastTitle(type) {
    switch (type) {
        case 'success': return 'Sukces';
        case 'error': return 'Błąd';
        case 'warning': return 'Ostrzeżenie';
        case 'info': return 'Informacja';
        default: return 'Powiadomienie';
    }
}

// === CLEANUP ===

/**
 * Czyszczenie przy zamknięciu strony
 */
window.addEventListener('beforeunload', function () {
    if (gluingState.refreshTimer) {
        clearInterval(gluingState.refreshTimer);
    }
});

/**
 * Cleanup przy opuszczaniu strony
 */
window.addEventListener('beforeunload', function () {
    console.log('🧹 Cleanup timers...');

    if (gluingState.refreshTimer) {
        clearInterval(gluingState.refreshTimer);
    }
    if (gluingState.uiTimer) {
        clearInterval(gluingState.uiTimer);
    }
});
