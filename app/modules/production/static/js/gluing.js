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
    lastSync: null
};

// === INICJALIZACJA ===
document.addEventListener('DOMContentLoaded', function () {
    initializeGluingDashboard();
});

/**
 * Główna funkcja inicjalizująca
 */
function initializeGluingDashboard() {
    console.log('🚀 Inicjalizacja Gluing Dashboard');

    // Binduj eventy
    bindEvents();

    bindEventsAddition();

    // Załaduj dane początkowe
    loadInitialData();

    // Uruchom odświeżanie
    startAutoRefresh();


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
 * Ładowanie danych początkowych
 */
async function loadInitialData() {
    showLoadingState();

    try {
        // Równoległe ładowanie wszystkich danych
        const [stationsResult, workersResult, productsResult] = await Promise.all([
            fetchStations(),
            fetchWorkers(),
            fetchProducts()
        ]);

        if (stationsResult.success && workersResult.success && productsResult.success) {
            gluingState.stations = stationsResult.data;
            gluingState.workers = workersResult.data;
            gluingState.products = productsResult.data;

            renderStations();
            renderProducts();
            updateLastSyncTime();

            showToast('success', 'Dane zostały załadowane pomyślnie');
        } else {
            throw new Error('Błąd podczas ładowania danych');
        }

    } catch (error) {
        console.error('❌ Błąd ładowania danych:', error);
        showToast('error', 'Błąd podczas ładowania danych');
        showErrorState();
    }
}

/**
 * Odświeżanie wszystkich danych
 */
async function refreshAllData() {
    const refreshBtn = document.getElementById('refreshBtn');
    const originalIcon = refreshBtn?.querySelector('i');

    if (originalIcon) {
        originalIcon.className = 'fas fa-spinner fa-spin';
    }

    try {
        await loadInitialData();
    } finally {
        if (originalIcon) {
            originalIcon.className = 'fas fa-sync-alt';
        }
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
    gluingState.stations = newProductsData;

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
                    <div class="prod-mod-prod-card-info-label">GATUNEK</div>
                    <div class="prod-mod-prod-card-info-value">${product.wood_species || '-'}</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column ${technologyClass}">
                    <div class="prod-mod-prod-card-info-label">TECHNOLOGIA</div>
                    <div class="prod-mod-prod-card-info-value">${product.wood_technology || '-'}</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column ${classTypeClass}">
                    <div class="prod-mod-prod-card-info-label">KLASA</div>
                    <div class="prod-mod-prod-card-info-value">${product.wood_class || '-'}</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column prod-mod-prod-card-spec-dimensions">
                    <div class="prod-mod-prod-card-info-label">WYMIARY</div>
                    <div class="prod-mod-prod-card-info-value">${dimensions}</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column prod-mod-prod-card-quantity-column">
                    <div class="prod-mod-prod-card-info-label">ILOŚĆ</div>
                    <div class="prod-mod-prod-card-info-value">${product.quantity || 1} szt.</div>
                </div>
                
                <div class="prod-mod-prod-card-info-column ${deadlineClass}">
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
 * Inteligentne odświeżanie danych
 */
async function refreshDataIncrementally() {
    console.log('🔄 Inteligentne odświeżanie danych...');

    try {
        // 1. Odśwież statusy stanowisk (zawsze)
        const stationsResult = await fetchStations();
        if (stationsResult.success) {
            updateStationsData(stationsResult.data);
        }

        // 2. Sprawdź czy są nowe produkty
        const productsResult = await fetchProducts();
        if (productsResult.success) {
            updateProductsData(productsResult.data);
        }

        updateLastSyncTime();

    } catch (error) {
        console.error('❌ Błąd inteligentnego odświeżania:', error);
    }
}

/**
 * Automatyczne odświeżanie
 */
function startAutoRefresh() {
    if (gluingState.refreshTimer) {
        clearInterval(gluingState.refreshTimer);
    }

    gluingState.refreshTimer = setInterval(() => {
        // Inteligentne odświeżanie co 3 minuty
        refreshDataIncrementally();
    }, GLUING_CONFIG.refreshInterval);

    // Timery aktualizuj co sekundę
    setInterval(updateStationTimers, GLUING_CONFIG.timerInterval);
}

// === API CALLS ===

/**
 * Pobieranie statusu stanowisk
 */
async function fetchStations() {
    try {
        const response = await fetch(GLUING_CONFIG.apiEndpoints.stations);
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        return { success: true, data: data.data || [] }; // ZMIANA: data.data zamiast data.stations
    } catch (error) {
        console.error('❌ Błąd pobierania stanowisk:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Pobieranie listy pracowników
 */
async function fetchWorkers() {
    try {
        const response = await fetch('/production/api/workers');
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        return { success: true, data: data.workers || [] };
    } catch (error) {
        console.error('❌ Błąd pobierania pracowników:', error);
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
        if (station.is_busy) {
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
                        <div class="prod-mod-prod-card-info-label">GATUNEK</div>
                        <div class="prod-mod-prod-card-info-value">${product.wood_species || '-'}</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column ${technologyClass}">
                        <div class="prod-mod-prod-card-info-label">TECHNOLOGIA</div>
                        <div class="prod-mod-prod-card-info-value">${product.wood_technology || '-'}</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column ${classTypeClass}">
                        <div class="prod-mod-prod-card-info-label">KLASA</div>
                        <div class="prod-mod-prod-card-info-value">${product.wood_class || '-'}</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column prod-mod-prod-card-spec-dimensions">
                        <div class="prod-mod-prod-card-info-label">WYMIARY</div>
                        <div class="prod-mod-prod-card-info-value">${dimensions}</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column prod-mod-prod-card-quantity-column">
                        <div class="prod-mod-prod-card-info-label">ILOŚĆ</div>
                        <div class="prod-mod-prod-card-info-value">${product.quantity || 1} szt.</div>
                    </div>
                    
                    <div class="prod-mod-prod-card-info-column ${deadlineClass}">
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
 * Formatowanie wymiarów produktu
 */
function formatProductDimensions(product) {
    // Sprawdź czy jest pole dimensions
    if (product.dimensions && product.dimensions !== 'Brak wymiarów') {
        return product.dimensions;
    }

    // Stwórz wymiary z poszczególnych pól
    const length = product.dimensions_length || 0;
    const width = product.dimensions_width || 0;  
    const thickness = product.dimensions_thickness || 0;

    if (length && width && thickness) {
        return `${length}×${width}×${thickness}`;
    }
    
    if (length && width) {
        return `${length}×${width}`;
    }

    return '-';
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
 * Renderowanie modala wyboru stanowiska i pracownika
 */
function renderStationWorkerModal(product) {
    // Informacje o produkcie
    const productInfoElement = document.getElementById('modalProductInfo');
    if (productInfoElement && product) {
        document.getElementById('modalProductName').textContent = product.product_name || 'Produkt bez nazwy';
        document.getElementById('modalProductBadges').innerHTML = renderProductBadges(product);
        document.getElementById('modalProductDimensions').textContent = product.dimensions || 'Brak wymiarów';
    }

    // Stanowiska - TYLKO stanowiska sklejania
    const stationsContainer = document.getElementById('modalStationsGrid');
    if (stationsContainer) {
        const gluingStations = gluingState.stations.filter(station =>
            station.station_type === 'gluing' && station.is_active
        );

        stationsContainer.innerHTML = gluingStations.map(station => {
            const isAvailable = !station.is_busy; // ZMIANA: logika dostępności
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

    // Pracownicy - TYLKO pracownicy sklejania
    const workersContainer = document.getElementById('modalWorkersGrid');
    if (workersContainer) {
        const gluingWorkers = gluingState.workers.filter(worker =>
            worker.station_type_preference === 'gluing' || worker.station_type_preference === 'both'
        );

        workersContainer.innerHTML = gluingWorkers.map(worker => {
            const isAvailable = worker.is_active !== false;
            const disabledClass = isAvailable ? '' : 'disabled';

            return `
                <div class="prod-work-selection-item ${disabledClass}" 
                     data-worker-id="${worker.id}" 
                     ${isAvailable ? 'onclick="selectWorker(' + worker.id + ')"' : ''}>
                    <div class="prod-work-selection-item-name">${worker.name}</div>
                </div>
            `;
        }).join('');
    }
}

// === EVENT HANDLERS ===

/**
 * Pokazanie modala wyboru stanowiska i pracownika
 */
function showStationWorkerModal(productId, preselectedStationId = null) {
    const product = productId ? gluingState.products.find(p => p.id === productId) : null;

    if (productId && !product) {
        showToast('error', 'Nie znaleziono produktu');
        return;
    }

    gluingState.selectedProduct = product;
    gluingState.selectedStation = null;
    gluingState.selectedWorker = null;

    // Ustaw ID produktu w ukrytym polu
    if (productId) {
        document.getElementById('selectedProductId').value = productId;
    }

    renderStationWorkerModal(product);

    // Jeśli jest preselected station, wybierz go automatycznie
    if (preselectedStationId) {
        setTimeout(() => selectStation(preselectedStationId), 100);
    }

    const modal = new bootstrap.Modal(document.getElementById('stationWorkerModal'));
    modal.show();
}

/**
 * Wybór stanowiska
 */
function selectStation(stationId) {
    // Usuń poprzedni wybór
    document.querySelectorAll('#modalStationsGrid .prod-work-selection-item').forEach(item => {
        item.classList.remove('selected');
    });

    // Zaznacz nowe stanowisko
    const stationElement = document.querySelector(`#modalStationsGrid [data-station-id="${stationId}"]`);
    if (stationElement && !stationElement.classList.contains('disabled')) {
        stationElement.classList.add('selected');
        gluingState.selectedStation = gluingState.stations.find(s => s.id == stationId);

        document.getElementById('selectedStationId').value = stationId;
        updateModalSummary();
    }
}

/**
 * Wybór pracownika
 */
function selectWorker(workerId) {
    // Usuń poprzedni wybór
    document.querySelectorAll('#modalWorkersGrid .prod-work-selection-item').forEach(item => {
        item.classList.remove('selected');
    });

    // Zaznacz nowego pracownika
    const workerElement = document.querySelector(`#modalWorkersGrid [data-worker-id="${workerId}"]`);
    if (workerElement && !workerElement.classList.contains('disabled')) {
        workerElement.classList.add('selected');
        gluingState.selectedWorker = gluingState.workers.find(w => w.id == workerId);

        document.getElementById('selectedWorkerId').value = workerId;
        updateModalSummary();
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

            showToast('success', 'Produkcja została rozpoczęta');
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

    document.getElementById('selectedProductId').value = '';
    document.getElementById('selectedStationId').value = '';
    document.getElementById('selectedWorkerId').value = '';

    document.getElementById('selectionSummary').style.display = 'none';
    document.getElementById('startProductionBtn').disabled = true;
}

// === TIMERY ===

/**
 * Aktualizacja timerów stanowisk
 */
function updateStationTimers() {
    const standardTimeMinutes = parseInt(document.querySelector('[data-config-gluing-time]')?.value) || 2;
    const standardTimeSeconds = standardTimeMinutes * 60;

    gluingState.stations.forEach(station => {
        if (station.is_busy && station.working_time_seconds !== undefined) {
            station.working_time_seconds++;
            const remainingSeconds = standardTimeSeconds - station.working_time_seconds;

            const timerElement = document.getElementById(`timer-${station.id}`);
            if (timerElement) {
                timerElement.textContent = formatCountdownTimer(remainingSeconds);

                const stationElement = timerElement.closest('.prod-work-station');

                // Usuń poprzednie klasy
                stationElement.classList.remove('active', 'overtime-warning', 'overtime');

                if (remainingSeconds <= 0) {
                    stationElement.classList.add('overtime');
                } else if (remainingSeconds <= 60) {
                    stationElement.classList.add('overtime-warning');
                } else {
                    stationElement.classList.add('active');
                }
            }
        }
    });
}

// === UTILITY FUNCTIONS ===

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
    const stationsContainer = document.getElementById('stationsGrid');
    const productsContainer = document.getElementById('productsGrid');

    if (stationsContainer) {
        stationsContainer.innerHTML = `
            <div class="prod-work-station-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Ładowanie stanowisk...</span>
            </div>
        `;
    }

    if (productsContainer) {
        productsContainer.innerHTML = `
            <div class="prod-work-products-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Ładowanie produktów...</span>
            </div>
        `;
    }
}

/**
 * Pokazanie stanu błędu
 */
function showErrorState() {
    const stationsContainer = document.getElementById('stationsGrid');
    const productsContainer = document.getElementById('productsGrid');

    if (stationsContainer) {
        stationsContainer.innerHTML = `
            <div class="prod-work-station-loading">
                <i class="fas fa-exclamation-triangle text-danger"></i>
                <span>Błąd ładowania stanowisk</span>
            </div>
        `;
    }

    if (productsContainer) {
        productsContainer.innerHTML = `
            <div class="prod-work-products-loading">
                <i class="fas fa-exclamation-triangle text-danger"></i>
                <span>Błąd ładowania produktów</span>
            </div>
        `;
    }
}

/**
 * Aktualizacja czasu ostatniej synchronizacji
 */
function updateLastSyncTime() {
    const syncElement = document.getElementById('lastSyncTime');
    if (syncElement) {
        const now = new Date();
        const timeString = now.toLocaleTimeString('pl-PL', {
            hour: '2-digit',
            minute: '2-digit'
        });
        syncElement.textContent = timeString;
        gluingState.lastSync = now;
    }
}

/**
 * Pokazanie toast notification
 */
function showToast(type, message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toastId = 'toast-' + Date.now();
    const iconClass = getToastIcon(type);

    const toastHTML = `
        <div class="toast ${type}" role="alert" id="${toastId}" data-bs-autohide="true" data-bs-delay="5000">
            <div class="toast-header">
                <i class="${iconClass} me-2"></i>
                <strong class="me-auto">${getToastTitle(type)}</strong>
                <small class="text-muted">${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</small>
                <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', toastHTML);

    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement);
    toast.show();

    // Usuń element po ukryciu
    toastElement.addEventListener('hidden.bs.toast', function () {
        toastElement.remove();
    });
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