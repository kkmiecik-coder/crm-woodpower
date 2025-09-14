/**
 * Production Dashboard JavaScript - KOMPLETNY REFAKTOR Z WYKRESAMI
 * ===============================================================
 * 
 * Zintegrowany system tabów AJAX + Widget wydajności dziennej
 * Przeniesione wszystkie funkcje z HTML do pliku JS
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 4.0 - Kompletny system z wykresami
 * Data: 2025-09-14
 */

// ============================================================================
// KONFIGURACJA GLOBALNA I STAN
// ============================================================================

const TabDashboard = {
    state: {
        currentActiveTab: 'dashboard-tab',
        refreshInterval: null,
        isLoading: false,
        retryCount: 0
    },
    config: {
        refreshIntervalMs: 180000, // 3 minuty
        maxRetries: 3,
        retryDelayMs: 2000
    },
    endpoints: {}
};

// KONFIGURACJA AUTO-REFRESH - CZASY W MILISEKUNDACH
const REFRESH_INTERVALS = {
    dashboard: 180000,       // 3 min - główny dashboard (pełny reload)
    stations: 30000,         // 30s - dane stanowisk (najważniejsze)
    systemHealth: 60000,     // 1 min - status systemu i błędy
    todayTotals: 45000,      // 45s - dzisiejsze podsumowania
    alerts: 90000,           // 1.5 min - alerty deadline
    chart: 300000,           // 5 min - wykresy wydajności
    baselinker: 120000       // 2 min - status API Baselinker
};

// Stan wykresów wydajności
let dailyPerformanceChart = null;
let chartPeriod = 7;
let chartRefreshTimeout = null;
let chartDataCache = new Map();
let autoRefreshInterval = null;

// Cache i zmienne pomocnicze
const CACHE_DURATION = 5 * 60 * 1000; // 5 minut
const AUTO_REFRESH_DELAY = 5 * 60 * 1000; // 5 minut
let lastApiCall = null;

// ============================================================================
// INICJALIZACJA GŁÓWNA
// ============================================================================

/**
 * Główna funkcja inicjalizacji - uruchamiana po załadowaniu DOM
 */
function initTabDashboard() {
    console.log('[Tab Dashboard] Inicjalizacja systemu tabów...');
    
    // Inicjalizuj systemy w odpowiedniej kolejności
    ToastSystem.init();
    
    // POPRAWKA: Sprawdź czy SkeletonSystem istnieje przed inicjalizacją
    if (typeof SkeletonSystem !== 'undefined' && SkeletonSystem.init) {
        SkeletonSystem.init();
        console.log('[Tab Dashboard] SkeletonSystem zainicjalizowany');
    } else {
        console.warn('[Tab Dashboard] SkeletonSystem nie znaleziony - pomijam inicjalizację');
    }

    RefreshManager.init();
    
    updateSystemStatus('loading', 'Sprawdzanie konfiguracji...');
    
    // Załaduj konfigurację z window.productionConfig (ustawiane w HTML)
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
            configTabContent: '/production/api/config-tab-content',
            chartData: '/production/api/chart-data'
        };
    }
    
    // Dodaj endpoint dla wykresów jeśli nie istnieje
    if (!TabDashboard.endpoints.chartData) {
        TabDashboard.endpoints.chartData = '/production/api/chart-data';
    }
    
    initTabEventListeners();
    setupAutoRefresh();
    loadTabContent('dashboard-tab');
    
    setTimeout(() => {
        checkSystemOverallHealth();

        RefreshManager.register('stations', refreshStationsData);
        RefreshManager.register('todayTotals', refreshTodayTotals);
    }, 2000);
    
    console.log('[Tab Dashboard] Inicjalizacja zakończona');
}

/**
 * Inicjalizuje event listenery
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
    
    // Obsługa widoczności strony
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    console.log('[Tab Dashboard] Event listenery zainicjalizowane');
}

// ===========================================================================
// FUNKCJE Toast
// ============================================================================

const ToastSystem = {
    container: null,
    toasts: new Map(),
    persistentToasts: new Set(), // Persistent IDs in localStorage
    nextId: 1,
    
    // Konfiguracja
    config: {
        position: 'top-right',
        autoHideTimeout: 6000, // 6 sekund
        maxToasts: 5,
        spacing: 10,
        slideInDuration: 300,
        slideOutDuration: 200
    },
    
    init() {
        this.createContainer();
        this.loadPersistentToasts();
        console.log('[Toast System] Zainicjalizowany');
    },
    
    createContainer() {
        if (this.container) return;
        
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.className = 'toast-container';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            pointer-events: none;
            max-width: 400px;
        `;
        
        document.body.appendChild(this.container);
    },
    
    show(message, type = 'info', options = {}) {
        const toastId = this.nextId++;
        const persistent = type === 'error' || type === 'warning';
        
        const toast = {
            id: toastId,
            message,
            type,
            persistent,
            timestamp: Date.now(),
            options: { ...options }
        };
        
        if (persistent) {
            this.savePersistentToast(toast);
        }
        
        const toastElement = this.createToastElement(toast);
        this.toasts.set(toastId, { toast, element: toastElement });
        
        this.container.appendChild(toastElement);
        
        const existingToasts = this.toasts.size;
        const delay = existingToasts > 0 ? existingToasts * 100 : 50; // 100ms delay na każdy istniejący toast
        
        setTimeout(() => {
            toastElement.classList.add('toast-show');
        }, delay);
        
        if (!persistent) {
            setTimeout(() => {
                this.hide(toastId);
            }, this.config.autoHideTimeout);
        }
        
        this.enforceMaxToasts();
        
        console.log(`[Toast] Pokazano: ${type} - ${message}`);
        return toastId;
    },
    
    createToastElement(toast) {
        const element = document.createElement('div');
        element.className = `toast toast-${toast.type}`;
        element.setAttribute('data-toast-id', toast.id);
        element.style.cssText = `
            pointer-events: auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            min-height: 60px;
            padding: 16px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            opacity: 0;
            transform: translateX(calc(100% + 40px)); /* ZMIANA: +40px żeby całkowicie wyjść poza ekran */
            transition: all ${this.config.slideInDuration}ms cubic-bezier(0.2, 0, 0.2, 1); /* ZMIANA: lepszy easing */
            border-left: 4px solid ${this.getTypeColor(toast.type)};
            word-wrap: break-word;
            max-width: 100%;
        `;
        
        const icon = this.createIcon(toast.type);
        const content = this.createContent(toast);
        const closeBtn = this.createCloseButton(toast);
        
        element.appendChild(icon);
        element.appendChild(content);
        element.appendChild(closeBtn);
        
        return element;
    },
    
    createIcon(type) {
        const icon = document.createElement('div');
        icon.className = 'toast-icon';
        icon.style.cssText = `
            flex-shrink: 0;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            font-weight: bold;
            color: white;
            background: ${this.getTypeColor(type)};
        `;
        
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        
        icon.textContent = icons[type] || icons.info;
        return icon;
    },
    
    createContent(toast) {
        const content = document.createElement('div');
        content.className = 'toast-content';
        content.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        
        const title = document.createElement('div');
        title.className = 'toast-title';
        title.style.cssText = `
            font-weight: 600;
            font-size: 14px;
            color: #1f2937;
            margin-bottom: 4px;
        `;
        title.textContent = this.getTypeTitle(toast.type);
        
        const message = document.createElement('div');
        message.className = 'toast-message';
        message.style.cssText = `
            font-size: 13px;
            color: #6b7280;
            line-height: 1.4;
        `;
        message.textContent = toast.message;
        
        content.appendChild(title);
        content.appendChild(message);
        
        // Dodaj timestamp dla persistent
        if (toast.persistent) {
            const timestamp = document.createElement('div');
            timestamp.className = 'toast-timestamp';
            timestamp.style.cssText = `
                font-size: 11px;
                color: #9ca3af;
                margin-top: 4px;
            `;
            timestamp.textContent = new Date(toast.timestamp).toLocaleTimeString('pl-PL');
            content.appendChild(timestamp);
        }
        
        return content;
    },
    
    createCloseButton(toast) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            background: none;
            border: none;
            color: #9ca3af;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            padding: 4px;
            border-radius: 4px;
            transition: color 0.2s ease;
        `;
        closeBtn.innerHTML = '×';
        closeBtn.title = 'Zamknij powiadomienie';
        
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.color = '#ef4444';
            closeBtn.style.background = '#fef2f2';
        });
        
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.color = '#9ca3af';
            closeBtn.style.background = 'none';
        });
        
        closeBtn.addEventListener('click', () => {
            this.hide(toast.id);
        });
        
        return closeBtn;
    },
    
    hide(toastId) {
        const toastData = this.toasts.get(toastId);
        if (!toastData) return;
        
        const { toast, element } = toastData;
        
        // ZMIANA: Lepszy slide-out animation
        element.style.opacity = '0';
        element.style.transform = 'translateX(calc(100% + 40px))'; // Wyjdź poza ekran
        element.style.transition = `all ${this.config.slideOutDuration}ms cubic-bezier(0.4, 0, 1, 1)`; // Szybszy easing na wyjście
        
        // ZMIANA: Dodaj height collapse animation
        setTimeout(() => {
            element.style.maxHeight = element.offsetHeight + 'px'; // Zapisz aktualną wysokość
            element.style.overflow = 'hidden';
            
            // Po krótkiej chwili zrób collapse
            setTimeout(() => {
                element.style.maxHeight = '0px';
                element.style.marginBottom = '0px';
                element.style.paddingTop = '0px';
                element.style.paddingBottom = '0px';
                element.style.transition = `max-height 200ms ease-out, margin 200ms ease-out, padding 200ms ease-out`;
            }, 50);
            
        }, this.config.slideOutDuration);
        
        // Usuń element po wszystkich animacjach
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            this.toasts.delete(toastId);
            
            if (toast.persistent) {
                this.removePersistentToast(toastId);
            }
        }, this.config.slideOutDuration + 250); // +250ms na collapse animation
        
        console.log(`[Toast] Ukryto: ${toast.type} - ${toast.message}`);
    },
    
    updateToastPositions() {
        let topOffset = 0;
        const toasts = Array.from(this.toasts.values());
        
        console.log(`[Toast Debug] Pozycjonowanie ${toasts.length} toastów`);
        
        toasts.forEach(({ element }, index) => {
            // ZMIANA: Nie ustawiaj top inline, pozwól CSS margin-bottom działać
            // element.style.top = `${topOffset}px`; // USUŃ TĘ LINIĘ
            
            // Zamiast tego pozwól elementom układać się naturalnie z margin-bottom
            element.style.position = 'relative'; // Upewnij się że to relative, nie absolute
            element.style.top = 'auto'; // Resetuj ewentualne poprzednie top
            
            console.log(`[Toast Debug] Toast ${index}: height=${element.offsetHeight}px`);
            
            // topOffset += element.offsetHeight + this.config.spacing; // NIE POTRZEBNE
        });
    },
    
    enforceMaxToasts() {
        if (this.toasts.size <= this.config.maxToasts) return;
        
        // Usuń najstarsze nie-persistent toasty
        const sortedToasts = Array.from(this.toasts.entries())
            .filter(([_, { toast }]) => !toast.persistent)
            .sort(([_, a], [__, b]) => a.toast.timestamp - b.toast.timestamp);
        
        const toRemove = sortedToasts.slice(0, this.toasts.size - this.config.maxToasts);
        toRemove.forEach(([id]) => this.hide(id));
    },
    
    // Persistent storage dla error/warning
    savePersistentToast(toast) {
        let persistentToasts = this.getPersistentToasts();
        
        // Dodaj toast z unikalnym kluczem (message + type + timestamp dnia)
        const dayKey = new Date().toDateString();
        const toastKey = `${toast.type}_${this.hashString(toast.message)}_${dayKey}`;
        
        persistentToasts[toastKey] = {
            message: toast.message,
            type: toast.type,
            timestamp: toast.timestamp,
            id: toast.id
        };
        
        localStorage.setItem('production_persistent_toasts', JSON.stringify(persistentToasts));
        this.persistentToasts.add(toastKey);
    },
    
    removePersistentToast(toastId) {
        let persistentToasts = this.getPersistentToasts();
        
        // Znajdź i usuń toast po ID
        Object.keys(persistentToasts).forEach(key => {
            if (persistentToasts[key].id === toastId) {
                delete persistentToasts[key];
                this.persistentToasts.delete(key);
            }
        });
        
        localStorage.setItem('production_persistent_toasts', JSON.stringify(persistentToasts));
    },
    
    getPersistentToasts() {
        try {
            return JSON.parse(localStorage.getItem('production_persistent_toasts') || '{}');
        } catch (e) {
            console.warn('[Toast] Błąd parsowania persistent toasts:', e);
            return {};
        }
    },
    
    loadPersistentToasts() {
        const persistentToasts = this.getPersistentToasts();
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
        
        Object.entries(persistentToasts).forEach(([key, toast]) => {
            const toastDate = new Date(toast.timestamp).toDateString();
            
            // Pokaż toasty z dzisiaj i wczoraj
            if (toastDate === today || toastDate === yesterday) {
                // Sprawdź czy toast nie został już pokazany w tej sesji
                if (!this.persistentToasts.has(key)) {
                    setTimeout(() => {
                        const newId = this.show(toast.message, toast.type, { restored: true });
                        // Aktualizuj ID w storage
                        persistentToasts[key].id = newId;
                        localStorage.setItem('production_persistent_toasts', JSON.stringify(persistentToasts));
                    }, 100);
                    
                    this.persistentToasts.add(key);
                }
            } else {
                // Usuń stare toasty
                delete persistentToasts[key];
            }
        });
        
        // Zapisz oczyszczone toasty
        localStorage.setItem('production_persistent_toasts', JSON.stringify(persistentToasts));
    },
    
    // Metody pomocnicze
    getTypeColor(type) {
        const colors = {
            success: '#10b981',
            error: '#ef4444', 
            warning: '#f59e0b',
            info: '#3b82f6'
        };
        return colors[type] || colors.info;
    },
    
    getTypeTitle(type) {
        const titles = {
            success: 'Sukces',
            error: 'Błąd',
            warning: 'Ostrzeżenie', 
            info: 'Informacja'
        };
        return titles[type] || titles.info;
    },
    
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    },
    
    // API publiczne
    clearAll() {
        Array.from(this.toasts.keys()).forEach(id => this.hide(id));
    },
    
    clearPersistent() {
        localStorage.removeItem('production_persistent_toasts');
        this.persistentToasts.clear();
        
        // Usuń aktualne persistent toasty
        Array.from(this.toasts.entries()).forEach(([id, { toast }]) => {
            if (toast.persistent) {
                this.hide(id);
            }
        });
    }
};

// ============================================================================
// WIDGET-LEVEL SKELETON SYSTEM
// ============================================================================

const SkeletonSystem = {
    activeWidgets: new Set(),
    
    config: {
        animationDuration: '1.5s',
        shimmerColor: '#f0f0f0',
        baseColor: '#e0e0e0'
    },
    
    init() {
        this.addSkeletonStyles();
        console.log('[Skeleton System] Zainicjalizowany (widget-level)');
    },
    
    addSkeletonStyles() {
        if (document.getElementById('skeleton-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'skeleton-styles';
        style.textContent = `
            /* Widget skeleton overlay */
            .widget-skeleton {
                position: relative;
                overflow: hidden;
            }
            
            .widget-skeleton::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(90deg, 
                    ${this.config.baseColor} 25%, 
                    ${this.config.shimmerColor} 50%, 
                    ${this.config.baseColor} 75%
                );
                background-size: 200% 100%;
                animation: skeleton-shimmer ${this.config.animationDuration} infinite;
                z-index: 10;
                border-radius: inherit;
            }
            
            .widget-skeleton .widget-content {
                opacity: 0.3;
                pointer-events: none;
            }
            
            @keyframes skeleton-shimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
            
            /* Skeleton placeholder content dla pustych widgetów */
            .skeleton-placeholder {
                padding: 20px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                min-height: 120px;
            }
            
            .skeleton-line {
                height: 16px;
                background: ${this.config.baseColor};
                border-radius: 4px;
                animation: skeleton-pulse 1.5s ease-in-out infinite alternate;
            }
            
            .skeleton-line.short { width: 60%; }
            .skeleton-line.medium { width: 80%; }
            .skeleton-line.long { width: 100%; }
            .skeleton-line.title { height: 20px; width: 40%; margin-bottom: 8px; }
            
            @keyframes skeleton-pulse {
                0% { opacity: 1; }
                100% { opacity: 0.6; }
            }
            
            /* Specific widget skeletons */
            .stations-skeleton .skeleton-placeholder {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 16px;
            }
            
            .station-skeleton {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px;
                border: 2px solid #e5e7eb;
                border-radius: 8px;
            }
            
            .station-skeleton-icon {
                width: 40px;
                height: 40px;
                border-radius: 4px;
                background: ${this.config.baseColor};
            }
            
            .station-skeleton-content {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            
            .chart-skeleton {
                height: 300px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: linear-gradient(45deg, #f9f9f9 25%, transparent 25%),
                           linear-gradient(-45deg, #f9f9f9 25%, transparent 25%),
                           linear-gradient(45deg, transparent 75%, #f9f9f9 75%),
                           linear-gradient(-45deg, transparent 75%, #f9f9f9 75%);
                background-size: 20px 20px;
                background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
                border-radius: 8px;
                animation: skeleton-chart 2s linear infinite;
            }
            
            @keyframes skeleton-chart {
                0% { background-position: 0 0, 0 10px, 10px -10px, -10px 0px; }
                100% { background-position: 20px 20px, 20px 30px, 30px 10px, 10px 20px; }
            }
        `;
        
        document.head.appendChild(style);
    },
    
    // Pokaż skeleton dla całego widgetu
    showWidgetSkeleton(widgetSelector, type = 'generic') {
        const widget = document.querySelector(widgetSelector);
        if (!widget || this.activeWidgets.has(widget)) return;
        
        // Zapisz oryginalną zawartość
        const originalContent = widget.innerHTML;
        widget.setAttribute('data-original-content', originalContent);
        
        // Dodaj klasę skeleton
        widget.classList.add('widget-skeleton');
        
        // Zastąp zawartość placeholder-em na podstawie typu
        widget.innerHTML = this.getSkeletonContent(type);
        
        this.activeWidgets.add(widget);
        console.log(`[Skeleton] Pokazano skeleton dla widgetu: ${widgetSelector} (${type})`);
    },
    
    // Ukryj skeleton i przywróć zawartość
    hideWidgetSkeleton(widgetSelector) {
        const widget = document.querySelector(widgetSelector);
        if (!widget || !this.activeWidgets.has(widget)) return;
        
        const originalContent = widget.getAttribute('data-original-content');
        
        // Usuń klasę skeleton
        widget.classList.remove('widget-skeleton');
        
        // Przywróć oryginalną zawartość
        if (originalContent) {
            widget.innerHTML = originalContent;
            widget.removeAttribute('data-original-content');
        }
        
        this.activeWidgets.delete(widget);
        console.log(`[Skeleton] Ukryto skeleton dla widgetu: ${widgetSelector}`);
    },
    
    // Generuj zawartość skeleton na podstawie typu
    getSkeletonContent(type) {
        switch (type) {
            case 'stations':
                return `
                    <div class="widget-header">
                        <h3>Przegląd stanowisk</h3>
                        <span class="skeleton-line short" style="height: 20px; width: 120px;"></span>
                    </div>
                    <div class="widget-content">
                        <div class="stations-skeleton">
                            <div class="skeleton-placeholder">
                                <div class="station-skeleton">
                                    <div class="station-skeleton-icon"></div>
                                    <div class="station-skeleton-content">
                                        <div class="skeleton-line medium"></div>
                                        <div class="skeleton-line short"></div>
                                    </div>
                                    <div class="skeleton-line" style="width: 12px; height: 12px; border-radius: 50%;"></div>
                                </div>
                                <div class="station-skeleton">
                                    <div class="station-skeleton-icon"></div>
                                    <div class="station-skeleton-content">
                                        <div class="skeleton-line medium"></div>
                                        <div class="skeleton-line short"></div>
                                    </div>
                                    <div class="skeleton-line" style="width: 12px; height: 12px; border-radius: 50%;"></div>
                                </div>
                                <div class="station-skeleton">
                                    <div class="station-skeleton-icon"></div>
                                    <div class="station-skeleton-content">
                                        <div class="skeleton-line medium"></div>
                                        <div class="skeleton-line short"></div>
                                    </div>
                                    <div class="skeleton-line" style="width: 12px; height: 12px; border-radius: 50%;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                
            case 'today-summary':
                return `
                    <div class="widget-header">
                        <h3>Dzisiejsze podsumowanie</h3>
                        <span class="skeleton-line short" style="height: 16px; width: 100px;"></span>
                    </div>
                    <div class="widget-content">
                        <div class="skeleton-placeholder">
                            <div style="display: flex; gap: 20px;">
                                <div style="flex: 1;">
                                    <div class="skeleton-line" style="height: 32px; width: 60px; margin-bottom: 8px;"></div>
                                    <div class="skeleton-line short"></div>
                                </div>
                                <div style="flex: 1;">
                                    <div class="skeleton-line" style="height: 32px; width: 80px; margin-bottom: 8px;"></div>
                                    <div class="skeleton-line medium"></div>
                                </div>
                                <div style="flex: 1;">
                                    <div class="skeleton-line" style="height: 32px; width: 40px; margin-bottom: 8px;"></div>
                                    <div class="skeleton-line short"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                
            case 'alerts':
                return `
                    <div class="widget-header">
                        <h3>Alerty Terminów</h3>
                        <span class="skeleton-line" style="height: 24px; width: 30px; border-radius: 50%;"></span>
                    </div>
                    <div class="widget-content">
                        <div class="skeleton-placeholder">
                            <div style="display: flex; align-items: center; gap: 12px; padding: 12px; border-left: 4px solid #e5e7eb; border-radius: 4px;">
                                <div class="skeleton-line" style="width: 24px; height: 24px; border-radius: 50%;"></div>
                                <div style="flex: 1;">
                                    <div class="skeleton-line medium"></div>
                                    <div class="skeleton-line short" style="margin-top: 4px;"></div>
                                </div>
                                <div class="skeleton-line" style="width: 60px;"></div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 12px; padding: 12px; border-left: 4px solid #e5e7eb; border-radius: 4px;">
                                <div class="skeleton-line" style="width: 24px; height: 24px; border-radius: 50%;"></div>
                                <div style="flex: 1;">
                                    <div class="skeleton-line long"></div>
                                    <div class="skeleton-line medium" style="margin-top: 4px;"></div>
                                </div>
                                <div class="skeleton-line" style="width: 80px;"></div>
                            </div>
                        </div>
                    </div>
                `;
                
            case 'system-health':
                return `
                    <div class="widget-header">
                        <h3>Status systemu</h3>
                        <span class="skeleton-line" style="height: 20px; width: 100px;"></span>
                    </div>
                    <div class="widget-content">
                        <div class="skeleton-placeholder">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div style="display: flex; justify-content: space-between;">
                                    <div class="skeleton-line medium"></div>
                                    <div class="skeleton-line short"></div>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <div class="skeleton-line medium"></div>
                                    <div class="skeleton-line short"></div>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <div class="skeleton-line long"></div>
                                    <div class="skeleton-line short"></div>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <div class="skeleton-line medium"></div>
                                    <div class="skeleton-line short"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                
            case 'chart':
                return `
                    <div class="widget-header">
                        <h3>Wydajność dzienna</h3>
                        <div style="display: flex; gap: 8px;">
                            <div class="skeleton-line" style="height: 32px; width: 120px;"></div>
                            <div class="skeleton-line" style="height: 32px; width: 32px;"></div>
                        </div>
                    </div>
                    <div class="widget-content">
                        <div class="chart-skeleton">
                            <div style="text-align: center; color: #9ca3af;">
                                <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
                                <div>Ładowanie wykresu...</div>
                            </div>
                        </div>
                    </div>
                `;
                
            default:
                return `
                    <div class="skeleton-placeholder">
                        <div class="skeleton-line title"></div>
                        <div class="skeleton-line long"></div>
                        <div class="skeleton-line medium"></div>
                        <div class="skeleton-line short"></div>
                    </div>
                `;
        }
    },
    
    // API convenience methods
    showStationsSkeleton() {
        this.showWidgetSkeleton('.widget.stations-overview', 'stations');
    },
    
    hideStationsSkeleton() {
        this.hideWidgetSkeleton('.widget.stations-overview');
    },
    
    showTodayTotalsSkeleton() {
        this.showWidgetSkeleton('.widget.today-summary', 'today-summary');
    },
    
    hideTodayTotalsSkeleton() {
        this.hideWidgetSkeleton('.widget.today-summary');
    },
    
    showSystemHealthSkeleton() {
        this.showWidgetSkeleton('.widget.system-health', 'system-health');
    },
    
    hideSystemHealthSkeleton() {
        this.hideWidgetSkeleton('.widget.system-health');
    },
    
    showDeadlineAlertsSkeleton() {
        this.showWidgetSkeleton('.widget.deadline-alerts', 'alerts');
    },
    
    hideDeadlineAlertsSkeleton() {
        this.hideWidgetSkeleton('.widget.deadline-alerts');
    },
    
    showChartSkeleton() {
        this.showWidgetSkeleton('.widget.performance-chart', 'chart');
    },
    
    hideChartSkeleton() {
        this.hideWidgetSkeleton('.widget.performance-chart');
    },
    
    // Clear all skeletons
    clearAll() {
        this.activeWidgets.forEach(widget => {
            const originalContent = widget.getAttribute('data-original-content');
            widget.classList.remove('widget-skeleton');
            if (originalContent) {
                widget.innerHTML = originalContent;
                widget.removeAttribute('data-original-content');
            }
        });
        this.activeWidgets.clear();
    }
};

// ============================================================================
// UNIFIED REFRESH SYSTEM - DODAJ PO SKELETONSYSTEM
// ============================================================================

const RefreshManager = {
    intervals: new Map(),
    isActive: true,
    isPaused: false,
    
    init() {
        this.setupVisibilityHandling();
        this.setupBeforeUnload();
        console.log('[Refresh Manager] Zainicjalizowany');
        this.logIntervals();
    },
    
    // Zarejestruj komponent do auto-refresh
    register(componentName, refreshFunction, customInterval = null) {
        if (this.intervals.has(componentName)) {
            console.warn(`[Refresh Manager] Komponent ${componentName} już zarejestrowany`);
            return;
        }
        
        const interval = customInterval || REFRESH_INTERVALS[componentName] || REFRESH_INTERVALS.dashboard;
        
        const registration = {
            name: componentName,
            fn: refreshFunction,
            interval: interval,
            intervalId: null,
            lastRun: Date.now(),
            runCount: 0,
            errors: 0
        };
        
        this.intervals.set(componentName, registration);
        this.start(componentName);
        
        console.log(`[Refresh Manager] Zarejestrowano: ${componentName} (${interval/1000}s)`);
    },
    
    // Uruchom interval dla komponentu
    start(componentName) {
        const registration = this.intervals.get(componentName);
        if (!registration || registration.intervalId) return;
        
        registration.intervalId = setInterval(() => {
            if (!this.isActive || this.isPaused) return;
            
            try {
                console.log(`[Refresh Manager] Odświeżanie: ${componentName}`);
                registration.fn();
                registration.lastRun = Date.now();
                registration.runCount++;
                registration.errors = 0; // Reset errors on success
                
            } catch (error) {
                registration.errors++;
                console.error(`[Refresh Manager] Błąd w ${componentName}:`, error);
                
                // Zatrzymaj component po 3 błędach z rzędu
                if (registration.errors >= 3) {
                    console.error(`[Refresh Manager] Zatrzymuję ${componentName} po 3 błędach`);
                    this.stop(componentName);
                    showNotification(`Auto-refresh ${componentName} zatrzymany z powodu błędów`, 'warning');
                }
            }
        }, registration.interval);
        
        console.log(`[Refresh Manager] Uruchomiono: ${componentName}`);
    },
    
    // Zatrzymaj interval dla komponentu
    stop(componentName) {
        const registration = this.intervals.get(componentName);
        if (!registration || !registration.intervalId) return;
        
        clearInterval(registration.intervalId);
        registration.intervalId = null;
        
        console.log(`[Refresh Manager] Zatrzymano: ${componentName}`);
    },
    
    // Wyrejestruj komponent
    unregister(componentName) {
        this.stop(componentName);
        this.intervals.delete(componentName);
        console.log(`[Refresh Manager] Wyrejestrowano: ${componentName}`);
    },
    
    // Zatrzymaj wszystkie
    pauseAll() {
        this.isPaused = true;
        console.log('[Refresh Manager] Wszystkie intervaly zatrzymane');
    },
    
    // Wznów wszystkie
    resumeAll() {
        this.isPaused = false;
        console.log('[Refresh Manager] Wszystkie intervaly wznowione');
    },
    
    // Restart komponentu z nowym intervalem
    restart(componentName, newInterval = null) {
        const registration = this.intervals.get(componentName);
        if (!registration) return;
        
        this.stop(componentName);
        
        if (newInterval) {
            registration.interval = newInterval;
        }
        
        this.start(componentName);
        console.log(`[Refresh Manager] Restart: ${componentName} (${registration.interval/1000}s)`);
    },
    
    // Jednorazowe odświeżenie komponentu
    refreshNow(componentName) {
        const registration = this.intervals.get(componentName);
        if (!registration) {
            console.warn(`[Refresh Manager] Komponent ${componentName} nie zarejestrowany`);
            return;
        }
        
        try {
            console.log(`[Refresh Manager] Ręczne odświeżenie: ${componentName}`);
            registration.fn();
            registration.lastRun = Date.now();
            registration.runCount++;
            
        } catch (error) {
            console.error(`[Refresh Manager] Błąd ręcznego odświeżenia ${componentName}:`, error);
            showNotification(`Błąd odświeżenia ${componentName}`, 'error');
        }
    },
    
    // Odśwież wszystkie komponenty teraz
    refreshAllNow() {
        console.log('[Refresh Manager] Ręczne odświeżenie wszystkich komponentów');
        
        this.intervals.forEach((registration, componentName) => {
            // Dodaj małe opóźnienia żeby nie przeciążyć
            setTimeout(() => {
                this.refreshNow(componentName);
            }, Math.random() * 2000); // 0-2s delay
        });
        
        showNotification('Odświeżanie wszystkich komponentów...', 'info');
    },
    
    // Obsługa widoczności strony
    setupVisibilityHandling() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseAll();
                console.log('[Refresh Manager] Strona ukryta - wstrzymanie odświeżania');
            } else {
                this.resumeAll();
                console.log('[Refresh Manager] Strona widoczna - wznowienie odświeżania');
                
                // Opcjonalnie: odśwież wszystko po powrocie
                setTimeout(() => {
                    this.refreshAllNow();
                }, 1000);
            }
        });
    },
    
    // Cleanup przed zamknięciem strony
    setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    },
    
    cleanup() {
        this.intervals.forEach((registration, componentName) => {
            this.stop(componentName);
        });
        this.intervals.clear();
        console.log('[Refresh Manager] Cleanup wykonany');
    },
    
    // Status i debugging
    getStatus() {
        const status = {
            isActive: this.isActive,
            isPaused: this.isPaused,
            componentsCount: this.intervals.size,
            components: {}
        };
        
        this.intervals.forEach((registration, name) => {
            status.components[name] = {
                interval: registration.interval,
                isRunning: !!registration.intervalId,
                lastRun: new Date(registration.lastRun).toLocaleTimeString(),
                runCount: registration.runCount,
                errors: registration.errors,
                nextRun: new Date(registration.lastRun + registration.interval).toLocaleTimeString()
            };
        });
        
        return status;
    },
    
    logIntervals() {
        console.log('[Refresh Manager] Konfiguracja intervalów:');
        Object.entries(REFRESH_INTERVALS).forEach(([name, interval]) => {
            console.log(`  ${name}: ${interval/1000}s`);
        });
    }
};

// ============================================================================
// AKTUALIZUJ setupAutoRefresh() - użyj RefreshManager
// ============================================================================

function setupAutoRefresh() {
    // USUNIĘTO: Stary kod z clearInterval
    
    console.log('[Tab Dashboard] Konfiguracja auto-refresh przez RefreshManager');
    
    // Zarejestruj główny refresh dashboard
    RefreshManager.register('dashboard', () => {
        if (TabDashboard.state.currentActiveTab && !TabDashboard.state.isLoading) {
            loadTabContent(TabDashboard.state.currentActiveTab, true);
        }
    });
    
    // Zarejestruj system health check
    RefreshManager.register('systemHealth', () => {
        if (!document.hidden && !TabDashboard.state.isLoading) {
            checkSystemOverallHealth();
        }
    });
    
    console.log('[Tab Dashboard] Auto-refresh skonfigurowany przez RefreshManager');
}

// ============================================================================
// NOWE FUNKCJE REFRESH DLA KONKRETNYCH KOMPONENTÓW
// ============================================================================

// Funkcja do refresh stanowisk (może być wywołana niezależnie)
function refreshStationsData() {
    if (TabDashboard.state.currentActiveTab !== 'dashboard-tab') return;
    
    console.log('[Stations Refresh] Odświeżanie danych stanowisk...');
    
    // Pokaż subtelny loading
    SkeletonSystem.showStationsSkeleton();
    
    fetch('/production/api/dashboard-stats?component=stations', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.stations) {
            SkeletonSystem.hideStationsSkeleton();
            updateStationsStats(data.stations);
            console.log('[Stations Refresh] Dane stanowisk odświeżone');
        }
    })
    .catch(error => {
        console.error('[Stations Refresh] Błąd:', error);
        SkeletonSystem.hideStationsSkeleton();
    });
}

// Funkcja do refresh today totals
function refreshTodayTotals() {
    if (TabDashboard.state.currentActiveTab !== 'dashboard-tab') return;
    
    console.log('[Today Totals Refresh] Odświeżanie dzisiejszych statystyk...');
    
    fetch('/production/api/dashboard-stats?component=today_totals', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.today_totals) {
            updateTodayTotals(data.today_totals);
            console.log('[Today Totals Refresh] Dzisiejsze statystyki odświeżone');
        }
    })
    .catch(error => {
        console.error('[Today Totals Refresh] Błąd:', error);
    });
}

// ============================================================================
// WIDGET WYDAJNOŚCI DZIENNEJ - IMPLEMENTACJA
// ============================================================================

/**
 * Główna funkcja inicjalizacji wykresu wydajności dziennej
 */
function createDailyPerformanceChart() {
    console.log('[Performance Chart] Inicjalizacja wykresu wydajności dziennej');
    
    // Sprawdź uprawnienia
    if (window.productionConfig?.currentUser?.role !== 'admin') {
        console.log('[Performance Chart] Brak uprawnień - widget nie zostanie załadowany');
        return;
    }
    
    // Sprawdź Chart.js
    if (typeof Chart === 'undefined') {
        console.error('[Performance Chart] Chart.js nie jest załadowany');
        showChartError('Błąd: Chart.js nie jest dostępny');
        return;
    }
    
    initChartControls();
    loadChartDataWithRetry(chartPeriod);
    enableAutoRefresh();
}

/**
 * Inicjalizuje kontrolki wykresu
 */
function initChartControls() {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) {
        console.error('[Performance Chart] Widget nie znaleziony');
        return;
    }
    
    let controlsContainer = chartWidget.querySelector('.chart-controls');
    if (!controlsContainer) {
        const widgetHeader = chartWidget.querySelector('.widget-header');
        if (widgetHeader) {
            controlsContainer = document.createElement('div');
            controlsContainer.className = 'chart-controls';
            widgetHeader.appendChild(controlsContainer);
        }
    }
    
    if (controlsContainer) {
        controlsContainer.innerHTML = `
            <select id="chart-period-select" class="form-select form-select-sm">
                <option value="7" ${chartPeriod === 7 ? 'selected' : ''}>Ostatnie 7 dni</option>
                <option value="14" ${chartPeriod === 14 ? 'selected' : ''}>Ostatnie 14 dni</option>
                <option value="30" ${chartPeriod === 30 ? 'selected' : ''}>Ostatnie 30 dni</option>
            </select>
            <button id="chart-refresh-btn" class="btn btn-outline-primary btn-sm" title="Odśwież wykres">
                <i class="fas fa-sync-alt"></i>
            </button>
        `;
        
        // Event listenery
        const periodSelect = document.getElementById('chart-period-select');
        const refreshBtn = document.getElementById('chart-refresh-btn');
        
        if (periodSelect) {
            periodSelect.addEventListener('change', handlePeriodChange);
        }
        
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                clearChartCache();
                loadChartDataWithRetry(chartPeriod);
            });
        }
        
        enhanceChartAccessibility();
    }
}

/**
 * Obsługuje zmianę okresu z debouncing
 */
function handlePeriodChange(event) {
    const newPeriod = parseInt(event.target.value);
    console.log('[Performance Chart] Zmiana okresu na:', newPeriod, 'dni');
    
    if (chartRefreshTimeout) {
        clearTimeout(chartRefreshTimeout);
    }
    
    chartRefreshTimeout = setTimeout(() => {
        chartPeriod = newPeriod;
        clearChartCache();
        loadChartDataWithRetry(chartPeriod);
        trackChartUsage('period_changed', { period: newPeriod });
    }, 300);
}

/**
 * Ładuje dane z retry mechanizmem
 */
async function loadChartDataWithRetry(period, retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000;
    
    try {
        await loadChartDataWithCache(period);
    } catch (error) {
        console.error(`[Performance Chart] Próba ${retryCount + 1} nieudana:`, error);
        
        if (retryCount < maxRetries) {
            console.log(`[Performance Chart] Ponowna próba za ${retryDelay}ms...`);
            showChartRetrying(retryCount + 1, maxRetries);
            
            setTimeout(() => {
                loadChartDataWithRetry(period, retryCount + 1);
            }, retryDelay);
        } else {
            console.error('[Performance Chart] Wszystkie próby wyczerpane');
            showChartError(`Nie udało się załadować danych po ${maxRetries + 1} próbach. Sprawdź połączenie internetowe.`);
            addRetryButton(period);
        }
    }
}

/**
 * Ładuje dane z cache lub API
 */
async function loadChartDataWithCache(period) {
    const cacheKey = `chart_data_${period}`;
    const now = Date.now();
    
    // Sprawdź cache
    if (chartDataCache.has(cacheKey)) {
        const cached = chartDataCache.get(cacheKey);
        if (now - cached.timestamp < CACHE_DURATION) {
            console.log('[Performance Chart] Używam danych z cache dla okresu:', period);
            hideChartLoading();
            createOrUpdateChart(cached.data.chart_data, cached.data.summary);
            updateChartSummary(cached.data.summary);
            return;
        } else {
            chartDataCache.delete(cacheKey);
        }
    }
    
    // Załaduj z API
    await loadChartData(period);
}

/**
 * Pobiera dane z API
 */
async function loadChartData(period) {
    console.log('[Performance Chart] Ładowanie danych dla okresu:', period, 'dni');
    
    try {
        showChartLoading();
        hideChartError();
        
        const endpoint = `${TabDashboard.endpoints.chartData}?period=${period}`;
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Nieznany błąd API');
        }
        
        console.log('[Performance Chart] Otrzymano dane:', data);
        
        // Cache successful response
        const cacheKey = `chart_data_${period}`;
        chartDataCache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
        
        hideChartLoading();
        createOrUpdateChart(data.chart_data, data.summary);
        updateChartSummary(data.summary);
        
        trackChartUsage('chart_loaded', { period: period });
        
    } catch (error) {
        console.error('[Performance Chart] Błąd ładowania danych:', error);
        hideChartLoading();
        throw error; // Re-throw dla retry mechanizmu
    }
}

/**
 * Tworzy lub aktualizuje wykres Chart.js
 */
function createOrUpdateChart(chartData, summary) {
    const canvas = document.getElementById('performance-chart-canvas');
    if (!canvas) {
        console.error('[Performance Chart] Canvas nie znaleziony');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // Zniszcz istniejący wykres
    if (dailyPerformanceChart) {
        dailyPerformanceChart.destroy();
    }
    
    const config = {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: {
                    display: true,
                    text: `Wydajność produkcji (${summary.period_days} dni)`,
                    font: {
                        size: 14,
                        weight: 'bold'
                    }
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            return `Data: ${context[0].label}`;
                        },
                        label: function(context) {
                            const value = context.raw.toFixed(2);
                            return `${context.dataset.label}: ${value} m³`;
                        },
                        footer: function(context) {
                            let sum = 0;
                            context.forEach(function(tooltipItem) {
                                sum += tooltipItem.raw;
                            });
                            return `Łącznie: ${sum.toFixed(2)} m³`;
                        }
                    },
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    footerColor: '#fff',
                    borderColor: '#ddd',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Dzień',
                        font: { weight: 'bold' }
                    },
                    grid: {
                        display: true,
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Objętość (m³)',
                        font: { weight: 'bold' }
                    },
                    beginAtZero: true,
                    grid: {
                        display: true,
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(1) + ' m³';
                        }
                    }
                }
            },
            elements: {
                point: {
                    radius: 4,
                    hoverRadius: 8,
                    borderWidth: 2,
                    hoverBorderWidth: 3
                },
                line: {
                    borderWidth: 3,
                    tension: 0.4
                }
            },
            animation: {
                duration: 750,
                easing: 'easeInOutQuart'
            }
        }
    };
    
    dailyPerformanceChart = new Chart(ctx, config);
    console.log('[Performance Chart] Wykres utworzony pomyślnie');
}

/**
 * Aktualizuje sekcję podsumowania
 */
function updateChartSummary(summary) {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) return;
    
    let summaryContainer = chartWidget.querySelector('.chart-summary');
    if (!summaryContainer) {
        summaryContainer = document.createElement('div');
        summaryContainer.className = 'chart-summary';
        chartWidget.querySelector('.widget-content').appendChild(summaryContainer);
    }
    
    const summaryHTML = `
        <div class="chart-summary-grid">
            <div class="summary-item">
                <span class="summary-label">Łączna objętość</span>
                <span class="summary-value">${summary.total_period_volume} m³</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Śr. dzienna (wycinanie)</span>
                <span class="summary-value">${summary.avg_daily.cutting} m³</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Śr. dzienna (składanie)</span>
                <span class="summary-value">${summary.avg_daily.assembly} m³</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Śr. dzienna (pakowanie)</span>
                <span class="summary-value">${summary.avg_daily.packaging} m³</span>
            </div>
            ${summary.best_day.date ? `
            <div class="summary-item">
                <span class="summary-label">Najlepszy dzień</span>
                <span class="summary-value trend-up">${summary.best_day.date} (${summary.best_day.volume} m³)</span>
            </div>
            ` : ''}
        </div>
    `;
    
    summaryContainer.innerHTML = summaryHTML;
}

// ============================================================================
// FUNKCJE POMOCNICZE WYKRESÓW
// ============================================================================

function showChartLoading() {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) return;
    
    const widgetContent = chartWidget.querySelector('.widget-content');
    if (!widgetContent) return;
    
    const existingLoader = widgetContent.querySelector('.chart-loader');
    if (existingLoader) existingLoader.remove();
    
    const loader = document.createElement('div');
    loader.className = 'chart-loader';
    loader.innerHTML = `
        <div class="spinner"></div>
        <span>Ładowanie danych wykresu...</span>
    `;
    
    widgetContent.appendChild(loader);
    
    const periodSelect = document.getElementById('chart-period-select');
    const refreshBtn = document.getElementById('chart-refresh-btn');
    if (periodSelect) periodSelect.disabled = true;
    if (refreshBtn) refreshBtn.disabled = true;
}

function hideChartLoading() {
    const loader = document.querySelector('.chart-loader');
    if (loader) loader.remove();
    
    const periodSelect = document.getElementById('chart-period-select');
    const refreshBtn = document.getElementById('chart-refresh-btn');
    if (periodSelect) periodSelect.disabled = false;
    if (refreshBtn) refreshBtn.disabled = false;
}

function showChartError(message) {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) return;
    
    const widgetContent = chartWidget.querySelector('.widget-content');
    if (!widgetContent) return;
    
    hideChartError();
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'chart-error alert alert-danger alert-dismissible';
    errorDiv.innerHTML = `
        <strong>Błąd wykresu:</strong> ${message}
        <button type="button" class="btn-close" onclick="hideChartError()"></button>
    `;
    
    widgetContent.appendChild(errorDiv);
}

function hideChartError() {
    const error = document.querySelector('.chart-error');
    if (error) error.remove();
}

function showChartRetrying(currentAttempt, maxAttempts) {
    const chartWidget = document.querySelector('.widget.performance-chart');
    if (!chartWidget) return;
    
    const widgetContent = chartWidget.querySelector('.widget-content');
    if (!widgetContent) return;
    
    hideChartLoading();
    
    const retryLoader = document.createElement('div');
    retryLoader.className = 'chart-loader retry-loader';
    retryLoader.innerHTML = `
        <div class="spinner"></div>
        <span>Ponowna próba ${currentAttempt}/${maxAttempts}...</span>
    `;
    
    widgetContent.appendChild(retryLoader);
}

function addRetryButton(period) {
    const errorDiv = document.querySelector('.chart-error');
    if (!errorDiv) return;
    
    const retryButton = document.createElement('button');
    retryButton.className = 'btn btn-outline-primary btn-sm mt-2';
    retryButton.innerHTML = '<i class="fas fa-redo me-1"></i>Spróbuj ponownie';
    retryButton.onclick = () => {
        hideChartError();
        loadChartDataWithRetry(period);
    };
    
    errorDiv.appendChild(retryButton);
}

function enhanceChartAccessibility() {
    const periodSelect = document.getElementById('chart-period-select');
    const refreshBtn = document.getElementById('chart-refresh-btn');
    const canvas = document.getElementById('performance-chart-canvas');
    
    if (periodSelect) {
        periodSelect.setAttribute('aria-label', 'Wybierz okres wykresu wydajności');
    }
    
    if (refreshBtn) {
        refreshBtn.setAttribute('aria-label', 'Odśwież dane wykresu wydajności');
    }
    
    if (canvas) {
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Wykres wydajności dziennej produkcji');
    }
}

function trackChartUsage(action, data = {}) {
    console.log('[Performance Chart Analytics]', action, data);
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        user_id: window.productionConfig?.currentUser?.id,
        action: action,
        data: data
    };
    
    let logs = JSON.parse(localStorage.getItem('chart_usage_logs') || '[]');
    logs.push(logEntry);
    
    if (logs.length > 100) {
        logs = logs.slice(-100);
    }
    
    localStorage.setItem('chart_usage_logs', JSON.stringify(logs));
}

function enableAutoRefresh() {
    disableAutoRefresh();
    
    autoRefreshInterval = setInterval(() => {
        if (!document.hidden && dailyPerformanceChart) {
            console.log('[Performance Chart] Auto-refresh danych');
            clearChartCache();
            loadChartDataWithRetry(chartPeriod);
            trackChartUsage('auto_refresh', { period: chartPeriod });
        }
    }, AUTO_REFRESH_DELAY);
    
    console.log('[Performance Chart] Auto-refresh włączony (5 min)');
}

function disableAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('[Performance Chart] Auto-refresh wyłączony');
    }
}

function clearChartCache() {
    chartDataCache.clear();
    console.log('[Performance Chart] Cache wyczyszczony');
}

function destroyPerformanceChart() {
    if (dailyPerformanceChart) {
        dailyPerformanceChart.destroy();
        dailyPerformanceChart = null;
    }
    
    if (chartRefreshTimeout) {
        clearTimeout(chartRefreshTimeout);
        chartRefreshTimeout = null;
    }
    
    disableAutoRefresh();
    clearChartCache();
    hideChartLoading();
    hideChartError();
    
    console.log('[Performance Chart] Wykres zniszczony');
}

// ============================================================================
// FUNKCJE DASHBOARD - PRZENIESIONE Z HTML
// ============================================================================

/**
 * Inicjalizuje wszystkie widgety dashboard
 */
function initDashboardWidgets(data) {
    console.log('[Dashboard] Inicjalizacja widgetów dashboard');
    
    // POPRAWKA: Sprawdź czy SkeletonSystem jest dostępny
    const hasSkeletonSystem = typeof SkeletonSystem !== 'undefined' && SkeletonSystem.showStationsSkeleton;
    
    // Pokaż skeletons jeśli brak danych i dostępny system
    if (!data || !data.stats) {
        console.log('[Dashboard] Brak danych - pokazuję widget skeletons');
        
        if (hasSkeletonSystem) {
            SkeletonSystem.showStationsSkeleton();
            SkeletonSystem.showTodayTotalsSkeleton();
            SkeletonSystem.showSystemHealthSkeleton();
            SkeletonSystem.showDeadlineAlertsSkeleton();
        } else {
            console.warn('[Dashboard] SkeletonSystem niedostępny - pomijam skeletons');
        }
        return;
    }
    
    initStationCards();
    console.log('[Dashboard] Używam danych z API:', data.stats);
    
    if (data.stats.stations) {
        if (hasSkeletonSystem) SkeletonSystem.hideStationsSkeleton();
        updateStationsStats(data.stats.stations);
    }
    
    if (data.stats.today_totals) {
        if (hasSkeletonSystem) SkeletonSystem.hideTodayTotalsSkeleton();
        updateTodayTotals(data.stats.today_totals);
    }

    if (data.stats.deadline_alerts) {
        if (hasSkeletonSystem) SkeletonSystem.hideDeadlineAlertsSkeleton();
        updateDeadlineAlerts(data.stats.deadline_alerts);
    }

    if (data.stats.system_health) {
        if (hasSkeletonSystem) SkeletonSystem.hideSystemHealthSkeleton();
        updateSystemHealth(data.stats.system_health);
    }
    
    console.log('[Dashboard] Widgety dashboard zainicjalizowane');
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

// ============================================================================
// FUNKCJE PRZENIESIONE Z production-dashboard.js (GŁÓWNEGO PLIKU)
// ============================================================================

function updateTodayTotals(totals) {
    console.log('[Dashboard] Aktualizacja dzisiejszych statystyk:', totals);
    
    if (!totals || typeof totals !== 'object') {
        console.warn('[Dashboard] Brak danych today_totals');
        return;
    }
    
    updateTodayValue('today-completed', totals.completed_orders || 0, 'liczba');
    updateTodayValue('today-total-m3', totals.total_m3 || 0, 'm3');
    updateTodayValue('today-avg-deadline', totals.avg_deadline_distance || 0, 'dni');
    updateTodayDate();
    
    console.log('[Dashboard] Dzisiejsze statystyki zaktualizowane');
}

function updateTodayValue(elementId, value, type) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn(`[Dashboard] Element ${elementId} nie znaleziony`);
        return;
    }
    
    // WYCZYŚĆ WARTOŚĆ Z BACKENDU
    const cleanValue = cleanBackendValue(value);
    
    let displayValue;
    let colorClass = '';
    
    switch (type) {
        case 'liczba':
            displayValue = cleanValue;
            if (cleanValue === 0) colorClass = 'text-muted';
            else if (cleanValue >= 10) colorClass = 'text-success';
            else if (cleanValue >= 5) colorClass = 'text-info';
            else colorClass = 'text-warning';
            break;
            
        case 'm3':
            displayValue = cleanValue.toFixed(4);
            if (cleanValue === 0) colorClass = 'text-muted';
            else if (cleanValue >= 50) colorClass = 'text-success';
            else if (cleanValue >= 20) colorClass = 'text-info';
            else colorClass = 'text-warning';
            break;
            
        case 'dni':
            displayValue = Math.round(cleanValue);
            if (cleanValue <= 0) colorClass = 'text-danger';
            else if (cleanValue <= 3) colorClass = 'text-warning';
            else if (cleanValue <= 7) colorClass = 'text-info';
            else colorClass = 'text-success';
            break;
            
        default:
            displayValue = cleanValue;
    }
    
    updateNumberWithoutGreenBackground(element, displayValue);
    
    setTimeout(() => {
        element.className = element.className.replace(/text-(muted|success|info|warning|danger)/g, '');
        if (colorClass) {
            element.classList.add(colorClass);
        }
    }, 200);
    
    console.log(`[DEBUG] updateTodayValue ${elementId}:`, {
        original: value,
        cleaned: cleanValue,
        display: displayValue,
        type: type
    });
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
    
    if (alertsCountElement) {
        alertsCountElement.textContent = alerts ? alerts.length : 0;
        
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
    
    alertsListElement.innerHTML = '';
    
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
    
    updateHealthIndicator(health);
    updateLastSync(health.last_sync, health.sync_status);
    updateDatabaseStatus(health.database_status);
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
    
    let overallStatus = 'healthy';
    let statusText = 'System działa poprawnie';
    let statusIcon = '✅';
    
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
    
    indicator.className = `health-indicator health-${overallStatus}`;
    indicator.innerHTML = `${statusIcon} ${statusText}`;
    indicator.title = `Status systemu: ${statusText}`;
}

function updateLastSync(lastSync, syncStatus) {
    const element = document.getElementById('last-sync-time');
    if (!element) return;
    
    let syncText = 'Brak danych';
    let syncClass = 'sync-unknown';
    
    if (lastSync) {
        const syncDate = new Date(lastSync);
        const now = new Date();
        const diffHours = Math.floor((now - syncDate) / (1000 * 60 * 60));
        
        const timeText = syncDate.toLocaleString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        
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
    
    const statusElement = document.getElementById('sync-status');
    if (statusElement) {
        statusElement.className = `health-status ${syncClass}`;
        statusElement.textContent = syncStatus === 'success' ? 'OK' : 'Błąd';
    }
}

function updateDatabaseStatus(dbStatus) {
    const valueElement = document.getElementById('db-response-time');
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
    const valueElement = document.getElementById('error-count');
    const statusElement = document.getElementById('errors-status');
    
    if (valueElement) {
        valueElement.textContent = errorCount || 0;
        
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

function createAlertElement(alert) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert-item';
    
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
    
    let dateText = 'Brak daty';
    if (alert.deadline_date) {
        const date = new Date(alert.deadline_date);
        dateText = date.toLocaleDateString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
    
    let daysText = '';
    if (alert.days_remaining <= 0) {
        daysText = `Spóźnione o ${Math.abs(alert.days_remaining)} dni`;
    } else {
        daysText = `${alert.days_remaining} dni pozostało`;
    }
    
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
    console.log(`[Dashboard] Aktualizacja stanowiska ${stationType}:`, stationData);
    
    if (!stationData) {
        console.warn(`[Dashboard] Brak danych dla stanowiska: ${stationType}`);
        return;
    }
    
    // POPRAWKA: Sprawdź wszystkie elementy przed kontynuowaniem
    const pendingElement = document.getElementById(`${stationType}-pending`);
    const volumeElement = document.getElementById(`${stationType}-today-m3`);
    const statusElement = document.getElementById(`${stationType}-status`);
    const cardElement = document.querySelector(`.station-card.${stationType}-station`);
    
    // KRYTYCZNA POPRAWKA: Dodanie return po sprawdzeniu elementów
    if (!pendingElement || !volumeElement) {
        console.error(`[Dashboard] Nie znaleziono kluczowych elementów dla stanowiska ${stationType}`);
        console.error(`[Dashboard] pendingElement:`, pendingElement);
        console.error(`[Dashboard] volumeElement:`, volumeElement);
        console.error(`[Dashboard] statusElement:`, statusElement);
        console.error(`[Dashboard] cardElement:`, cardElement);
        return; // DODANE: return żeby zakończyć funkcję
    }
    
    // UŻYJ CZYSZCZENIA DANYCH Z BACKENDU (istniejąca funkcja)
    const cleanPending = cleanBackendValue(stationData.pending_count);
    const cleanVolume = cleanBackendValue(stationData.today_m3);
    
    console.log(`[Dashboard] Aktualizowanie DOM dla ${stationType}:`);
    console.log(`[Dashboard] - Pending: ${stationData.pending_count} -> ${cleanPending}`);
    console.log(`[Dashboard] - Volume: ${stationData.today_m3} -> ${cleanVolume}`);
    
    // Aktualizuj wartości liczbowe z animacją (używając istniejącej funkcji)
    updateNumberWithoutGreenBackground(pendingElement, cleanPending);
    updateNumberWithoutGreenBackground(volumeElement, cleanVolume.toFixed(4));
    
    // Przekaż wyczyszczone dane do statusu
    const cleanStationData = {
        ...stationData,
        name: displayName,
        pending_count: cleanPending,
        today_m3: cleanVolume,
        today_completed: cleanBackendValue(stationData.today_completed || 0)
    };
    
    // Aktualizuj status kropki
    if (statusElement && cardElement) {
        updateStationStatus(statusElement, cardElement, cleanStationData);
    }
    
    console.log(`[Dashboard] Zaktualizowano stanowisko ${displayName}:`, {
        original_pending: stationData.pending_count,
        clean_pending: cleanPending,
        original_volume: stationData.today_m3,
        clean_volume: cleanVolume,
        status: statusElement?.classList.toString() || 'brak-elementu'
    });
}

// DODATKOWA FUNKCJA DEBUG: Sprawdź czy wszystkie elementy DOM istnieją
function debugStationElements() {
    const stations = ['cutting', 'assembly', 'packaging'];
    
    console.log('=== DEBUG: Sprawdzanie elementów DOM stanowisk ===');
    
    stations.forEach(station => {
        const pendingElement = document.getElementById(`${station}-pending`);
        const volumeElement = document.getElementById(`${station}-today-m3`);
        const statusElement = document.getElementById(`${station}-status`);
        const cardElement = document.querySelector(`.station-card.${station}-station`);
        
        console.log(`${station.toUpperCase()}:`);
        console.log(`  - Pending element (${station}-pending):`, pendingElement ? '✅' : '❌', pendingElement);
        console.log(`  - Volume element (${station}-today-m3):`, volumeElement ? '✅' : '❌', volumeElement);
        console.log(`  - Status element (${station}-status):`, statusElement ? '✅' : '❌', statusElement);
        console.log(`  - Card element (.${station}-station):`, cardElement ? '✅' : '❌', cardElement);
        
        if (pendingElement) {
            console.log(`  - Current pending text:`, pendingElement.textContent);
        }
        if (volumeElement) {
            console.log(`  - Current volume text:`, volumeElement.textContent);
        }
    });
    
    console.log('=== KONIEC DEBUG ===');
}

// FUNKCJA TESTOWA: Wymuszenie aktualizacji
function forceUpdateAllStations() {
    const testData = {
        cutting: {pending_count: 2, today_m3: 0},
        assembly: {pending_count: 0, today_m3: 0},
        packaging: {pending_count: 0, today_m3: 0}
    };
    
    console.log('=== FORCE UPDATE TEST ===');
    console.log('Dane testowe:', testData);
    
    // Sprawdź elementy DOM
    debugStationElements();
    
    // Wymuszenie aktualizacji
    updateStationsStats(testData);
    
    console.log('=== TEST ZAKOŃCZONY ===');
}

function updateNumberWithoutGreenBackground(element, newValue) {
    if (!element) return;
    
    // POPRAWKA: Safe check czy SkeletonSystem jest zainicjalizowany
    if (typeof SkeletonSystem !== 'undefined' && SkeletonSystem.activeSkeletons && SkeletonSystem.activeSkeletons.has(element)) {
        SkeletonSystem.hideSkeleton(element, newValue.toString());
        return;
    }
    
    const currentValue = element.textContent || '0';
    const newValueStr = newValue.toString();
    
    console.log(`[Update Number] ${element.id}: "${currentValue}" -> "${newValueStr}"`);
    
    if (currentValue === newValueStr) {
        console.log(`[Update Number] ${element.id}: Identyczne wartości, pomijam`);
        return;
    }
    
    // POPRAWKA: Safe check przed pokazaniem skeleton
    if (currentValue === "-") {
        console.log(`[Update Number] ${element.id}: Wymuszenie aktualizacji z myślnika`);
        
        // Bezpieczne sprawdzenie SkeletonSystem
        if (typeof SkeletonSystem !== 'undefined' && SkeletonSystem.showSkeleton) {
            SkeletonSystem.showSkeleton(element, 'stat');
            
            setTimeout(() => {
                if (SkeletonSystem.hideSkeleton) {
                    SkeletonSystem.hideSkeleton(element, newValueStr);
                }
            }, 200);
        } else {
            // Fallback - bezpośrednia aktualizacja
            element.textContent = newValueStr;
            element.style.transform = 'scale(1.05)';
            element.style.transition = 'transform 0.3s ease';
            setTimeout(() => {
                element.style.transform = 'scale(1)';
            }, 300);
        }
        return;
    }
    
    // Standardowa animacja dla zmian numerycznych
    const numericNewValue = parseFloat(newValue) || 0;
    const numericCurrentValue = parseFloat(currentValue) || 0;
    
    if (numericCurrentValue === numericNewValue) {
        console.log(`[Update Number] ${element.id}: Identyczne wartości numeryczne, pomijam`);
        return;
    }
    
    const duration = 800;
    const steps = 20;
    const stepValue = (numericNewValue - numericCurrentValue) / steps;
    const stepTime = duration / steps;
    
    let currentStep = 0;
    
    const animate = () => {
        currentStep++;
        const intermediateValue = numericCurrentValue + (stepValue * currentStep);
        
        if (currentStep < steps) {
            if (newValueStr.includes('.')) {
                element.textContent = intermediateValue.toFixed(4);
            } else {
                element.textContent = Math.round(intermediateValue);
            }
            setTimeout(animate, stepTime);
        } else {
            element.textContent = newValueStr;
            element.style.transform = 'scale(1.05)';
            element.style.transition = 'transform 0.3s ease';
            
            setTimeout(() => {
                element.style.transform = 'scale(1)';
            }, 300);
        }
    };
    
    animate();
}

function updateStationStatus(statusElement, cardElement, stationData) {
    if (!statusElement || !cardElement) return;
    
    const pendingCount = stationData.pending_count || 0;
    const todayVolume = stationData.today_m3 || 0;
    const todayCompleted = stationData.today_completed || 0;
    
    // Znajdź kropkę statusu w HTML
    const statusDot = statusElement.querySelector('.status-dot');
    if (!statusDot) {
        console.warn('[Station Status] Nie znaleziono .status-dot dla', stationData.name);
        return;
    }
    
    let statusClass = 'active'; // ZMIANA: użyj klas z CSS (active, warning, danger)
    
    // Logika statusu - dopasowana do CSS
    if (pendingCount === 0 && todayCompleted === 0 && todayVolume === 0) {
        statusClass = ''; // Brak klasy = szary (domyślny)
    } else if (pendingCount > 25) {
        statusClass = 'danger';     // Czerwony - bardzo przeciążone
    } else if (pendingCount > 15) {
        statusClass = 'warning';    // Żółty - zajęte
    } else {
        statusClass = 'active';     // Zielony - normalna praca
    }
    
    // Usuń wszystkie poprzednie klasy statusu z kropki
    statusDot.classList.remove('active', 'warning', 'danger');
    
    // Dodaj nową klasę tylko jeśli nie jest pusta
    if (statusClass) {
        statusDot.classList.add(statusClass);
    }
    
    console.log(`[Station Status] ${stationData.name || 'Unknown'}: ${statusClass || 'default'} (pending: ${pendingCount}, volume: ${todayVolume})`);
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

// ============================================================================
// AJAX SYSTEM - PRZENIESIONY Z GŁÓWNEGO PLIKU
// ============================================================================

function setupAutoRefresh() {
    if (TabDashboard.state.refreshInterval) {
        clearInterval(TabDashboard.state.refreshInterval);
    }
    
    TabDashboard.state.refreshInterval = setInterval(() => {
        if (!document.hidden && !TabDashboard.state.isLoading) {
            console.log(`[Tab Dashboard] Auto-refresh dla taba: ${TabDashboard.state.currentActiveTab}`);
            loadTabContent(TabDashboard.state.currentActiveTab, true);
        }
    }, TabDashboard.config.refreshIntervalMs);
    
    console.log(`[Tab Dashboard] Auto-refresh ustawiony na ${TabDashboard.config.refreshIntervalMs/1000/60} minut`);
}

async function loadTabContent(tabName, silentRefresh = false) {
    console.log(`[Tab Dashboard] Ładowanie taba: ${tabName}, silent: ${silentRefresh}`);
    updateSystemStatus('loading', `Ładowanie taba ${tabName}...`);
    
    // DODANE: Pokaż skeletons dla dashboard podczas ładowania
    if (tabName === 'dashboard-tab' && !silentRefresh) {
        SkeletonSystem.showStationsSkeleton();
        SkeletonSystem.showTodayTotalsSkeleton();
        SkeletonSystem.showSystemHealthSkeleton();
        SkeletonSystem.showDeadlineAlertsSkeleton();
    }
    
    lastApiCall = `${new Date().toLocaleTimeString()} (${tabName})`;
    window.lastApiCall = lastApiCall;
    
    TabDashboard.state.currentActiveTab = tabName;
    
    const loadingElement = document.getElementById(`${tabName}-loading`);
    const wrapperElement = document.getElementById(`${tabName}-wrapper`);
    const errorElement = document.getElementById(`${tabName}-error`);
    
    if (!loadingElement || !wrapperElement || !errorElement) {
        console.error(`[Tab Dashboard] Nie znaleziono elementów DOM dla taba: ${tabName}`);
        return;
    }
    
    if (!silentRefresh) {
        loadingElement.style.display = 'block';
        wrapperElement.style.display = 'none';
        errorElement.style.display = 'none';
        TabDashboard.state.isLoading = true;
    }
    
    try {
        const endpointKey = getEndpointKey(tabName);
        const endpoint = TabDashboard.endpoints[endpointKey];
        
        if (!endpoint) {
            throw new Error(`Brak endpointu dla taba: ${tabName}`);
        }
        
        console.log(`[Tab Dashboard] Wywołuję endpoint: ${endpoint}`);
        
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
        
        wrapperElement.innerHTML = data.html;
        
        loadingElement.style.display = 'none';
        wrapperElement.style.display = 'block';
        errorElement.style.display = 'none';
        
        executeTabCallback(tabName, data);
        
        TabDashboard.state.retryCount = 0;
        
        if (!silentRefresh) {
            updateSystemStatus('success', 'System gotowy');
        } else {
            updateSystemStatus('success', `${tabName} odświeżony`);
        }
        
        console.log(`[Tab Dashboard] Tab ${tabName} załadowany pomyślnie`);
        
    } catch (error) {
        console.error(`[Tab Dashboard] Błąd ładowania taba ${tabName}:`, error);
        
        // DODANE: Ukryj skeletons przy błędzie
        if (tabName === 'dashboard-tab') {
            SkeletonSystem.clearAll();
        }
        
        handleTabLoadError(tabName, error, silentRefresh);
    } finally {
        TabDashboard.state.isLoading = false;
    }
}

function handleTabLoadError(tabName, error, silentRefresh) {
    const loadingElement = document.getElementById(`${tabName}-loading`);
    const wrapperElement = document.getElementById(`${tabName}-wrapper`);
    const errorElement = document.getElementById(`${tabName}-error`);
    const errorMessageElement = document.getElementById(`${tabName}-error-message`);
    
    if (!silentRefresh) {
        loadingElement.style.display = 'none';
        wrapperElement.style.display = 'none';
        errorElement.style.display = 'block';
        
        if (errorMessageElement) {
            errorMessageElement.textContent = error.message;
        }
        
        updateSystemStatus('error', `Błąd ładowania: ${error.message}`);
    }
    
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
// EVENT HANDLERS
// ============================================================================

function handleTabClick(event) {
    const tabButton = event.currentTarget;
    const targetId = tabButton.getAttribute('data-bs-target');
    
    if (!targetId) {
        console.error('[Tab Dashboard] Brak data-bs-target w przycisku taba');
        return;
    }
    
    const tabName = targetId.replace('#', '').replace('-content', '');
    console.log(`[Tab Dashboard] Kliknięto tab: ${tabName}`);
    
    // Zniszcz wykres jeśli opuszczamy dashboard
    if (TabDashboard.state.currentActiveTab === 'dashboard-tab' && tabName !== 'dashboard-tab') {
        destroyPerformanceChart();
    }
    
    loadTabContent(tabName);
}

async function handleSystemRefresh() {
    console.log('[Tab Dashboard] Odświeżanie systemu...');
    
    const refreshBtn = document.getElementById('refresh-system-btn');
    const refreshIcon = refreshBtn?.querySelector('.refresh-icon');
    const refreshText = refreshBtn?.querySelector('.refresh-text');
    
    if (refreshBtn) refreshBtn.disabled = true;
    if (refreshIcon) refreshIcon.textContent = '⏳';
    if (refreshText) refreshText.textContent = 'Odświeżanie...';
    
    try {
        // Wyczyść cache wykresów przy ręcznym odświeżeniu
        clearChartCache();
        
        await loadTabContent(TabDashboard.state.currentActiveTab);
        
        showNotification('System odświeżony pomyślnie', 'success');
        startRefreshCooldown();
        
    } catch (error) {
        console.error('[Tab Dashboard] Błąd odświeżania:', error);
        showNotification('Błąd odświeżania systemu', 'error');
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
        if (refreshIcon) refreshIcon.textContent = '🔄';
        if (refreshText) refreshText.textContent = 'Odśwież system';
    }
}

function handleVisibilityChange() {
    if (document.hidden) {
        console.log('[Tab Dashboard] Strona ukryta - wstrzymanie auto-refresh');
    } else {
        console.log('[Tab Dashboard] Strona widoczna - wznowienie auto-refresh');
        if (!TabDashboard.state.isLoading) {
            loadTabContent(TabDashboard.state.currentActiveTab, true);
        }
    }
}

// ============================================================================
// FUNKCJE POMOCNICZE
// ============================================================================

function debugAPIResponse(data) {
    console.log('[DEBUG] Surowe dane z API:', data);
    
    if (data.stats && data.stats.stations) {
        Object.keys(data.stats.stations).forEach(stationKey => {
            const station = data.stats.stations[stationKey];
            console.log(`[DEBUG] ${stationKey} RAW data:`, {
                pending_count: station.pending_count,
                today_m3: station.today_m3,
                typeof_pending: typeof station.pending_count,
                typeof_volume: typeof station.today_m3,
                is_string_dash: station.today_m3 === "-",
                is_null: station.today_m3 === null,
                is_undefined: station.today_m3 === undefined
            });
        });
    }
    
    if (data.stats && data.stats.today_totals) {
        console.log('[DEBUG] Today totals RAW:', {
            completed_orders: data.stats.today_totals.completed_orders,
            total_m3: data.stats.today_totals.total_m3,
            typeof_m3: typeof data.stats.today_totals.total_m3,
            is_string_dash: data.stats.today_totals.total_m3 === "-"
        });
    }
}

function cleanBackendValue(value) {
    // Jeśli backend zwraca "-", zamień na 0
    if (value === "-" || value === null || value === undefined || value === "") {
        return 0;
    }
    
    // Jeśli to string z liczbą, przekonwertuj
    if (typeof value === 'string' && !isNaN(parseFloat(value))) {
        return parseFloat(value);
    }
    
    // Jeśli to już liczba, zwróć bez zmian
    if (typeof value === 'number') {
        return value;
    }
    
    // W ostateczności zwróć 0
    return 0;
}

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

function updateSystemStatus(status, message) {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    
    if (indicator) {
        indicator.className = indicator.className.replace(/\b(loading|active|warning|error|success)\b/g, '');
        indicator.classList.add('status-indicator', status);
    }
    
    if (text) {
        text.textContent = message;
    }
    
    console.log(`[Tab Dashboard] Header Status: ${status} - ${message}`);
}

function showNotification(message, type = 'info', options = {}) {
    console.log(`[Toast Notification] ${type.toUpperCase()}: ${message}`);
    
    // Inicjalizuj system jeśli nie został zainicjalizowany
    if (!ToastSystem.container) {
        ToastSystem.init();
    }
    
    return ToastSystem.show(message, type, options);
}

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

function checkSystemOverallHealth() {
    console.log('[System Health] Sprawdzanie ogólnego stanu systemu...');
    
    let issues = [];
    let overallStatus = 'success';
    let statusMessage = 'System działa poprawnie';
    
    const errors = localStorage.getItem('system_errors');
    if (errors && JSON.parse(errors).length > 0) {
        issues.push('Błędy systemu');
        overallStatus = 'warning';
    }
    
    if (TabDashboard.state.retryCount > 0) {
        issues.push('Problemy z ładowaniem');
        overallStatus = 'warning';
    }
    
    if (!TabDashboard.endpoints || Object.keys(TabDashboard.endpoints).length === 0) {
        issues.push('Brak konfiguracji');
        overallStatus = 'error';
    }
    
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

async function checkBaselinkerAPIStatus() {
    const cacheKey = 'baselinker_api_status';
    const timestampKey = 'baselinker_last_check';
    const CACHE_DURATION = 15 * 60 * 1000;
    
    const lastCheck = localStorage.getItem(timestampKey);
    const cachedStatus = localStorage.getItem(cacheKey);
    const now = Date.now();
    
    if (lastCheck && cachedStatus && (now - parseInt(lastCheck)) < CACHE_DURATION) {
        console.log('[Baselinker] Używam cache:', JSON.parse(cachedStatus));
        return JSON.parse(cachedStatus);
    }
    
    console.log('[Baselinker] Cache wygasł, sprawdzam API...');
    
    try {
        lastApiCall = `${new Date().toLocaleTimeString()} (Baselinker)`;
        window.lastApiCall = lastApiCall;
        
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
        
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(timestampKey, now.toString());
        
        console.log('[Baselinker] Status zaktualizowany:', result);
        return result;
        
    } catch (error) {
        console.error('[Baselinker] Błąd sprawdzania API:', error);
        
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
    
    if (baselinkerData.response_time !== null && baselinkerData.response_time !== undefined) {
        const responseTimeMs = Math.round(baselinkerData.response_time * 1000);
        valueElement.textContent = `${responseTimeMs}ms`;
    } else if (baselinkerData.error) {
        valueElement.textContent = 'Błąd połączenia';
    } else {
        valueElement.textContent = 'Nieznany';
    }
    
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
    
    if (baselinkerData.error) {
        statusElement.title = `Błąd: ${baselinkerData.error}`;
    } else if (baselinkerData.response_time) {
        statusElement.title = `Czas odpowiedzi: ${Math.round(baselinkerData.response_time * 1000)}ms`;
    }
}

// ============================================================================
// CALLBACK FUNCTIONS - ZINTEGROWANE
// ============================================================================

window.onDashboardTabLoaded = function(data) {
    console.log('[Dashboard Tab] Callback wykonany, dane:', data);
    
    // DODAJ DEBUGOWANIE
    debugAPIResponse(data);
    
    // Inicjalizuj podstawowe widgety
    initDashboardWidgets(data);
    
    // Inicjalizuj wykresy dla adminów z opóźnieniem dla DOM
    if (window.productionConfig?.currentUser?.role === 'admin') {
        setTimeout(() => {
            createDailyPerformanceChart();
        }, 100);
    }
};

window.onProductsTabLoaded = function(data) {
    console.log('[Products Tab] Callback wykonany, dane:', data);
    
    if (typeof initProductFilters === 'function') {
        initProductFilters();
    }
    
    if (window.productionConfig?.currentUser?.role === 'admin') {
        if (typeof initDragAndDrop === 'function') {
            initDragAndDrop();
        }
    }
};

window.onReportsTabLoaded = function(data) {
    console.log('[Reports Tab] Callback wykonany, dane:', data);
    
    if (typeof initReportsCharts === 'function') {
        initReportsCharts(data);
    }
};

window.onStationsTabLoaded = function(data) {
    console.log('[Stations Tab] Callback wykonany, dane:', data);
    
    if (typeof initStationsInterface === 'function') {
        initStationsInterface();
    }
};

window.onConfigTabLoaded = function(data) {
    console.log('[Config Tab] Callback wykonany, dane:', data);
    
    if (typeof initConfigForms === 'function') {
        initConfigForms();
    }
    
    if (typeof initPriorityDragDrop === 'function') {
        initPriorityDragDrop();
    }
};

// ============================================================================
// PLACEHOLDER FUNCTIONS - POZOSTAŁE DO IMPLEMENTACJI
// ============================================================================

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
// FUNKCJE MODALI I AKCJI - PRZENIESIONE Z HTML
// ============================================================================

function showSystemErrorsModal() {
    console.log('[Dashboard] Otwórz modal błędów systemu');
    
    const modal = document.getElementById('systemErrorsModal');
    if (modal) {
        // Otwórz modal
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
        
        // DODANE: Załaduj błędy po otwarciu modala
        loadSystemErrorsData();
    } else {
        // Fallback - otwórz w nowym oknie
        window.open('/production/admin/ajax/system-errors', '_blank', 'width=800,height=600,scrollbars=yes');
    }
}

function loadSystemErrorsData() {
    console.log('[Modal] Ładowanie danych błędów systemu...');
    
    // Pokaż loading
    showErrorsLoading(true);
    hideErrorsEmpty();
    hideErrorsList();
    
    // Wyczyść poprzednie błędy
    const errorsList = document.getElementById('errors-list');
    if (errorsList) {
        errorsList.innerHTML = '';
    }
    
    // Załaduj błędy z API
    fetch('/production/admin/ajax/system-errors', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => {
        console.log('[Modal] Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} - ${response.statusText}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error(`Oczekiwano JSON, otrzymano: ${contentType}`);
        }
        
        return response.json();
    })
    .then(data => {
        console.log('[Modal] Dane błędów otrzymane:', data);
        
        // Ukryj loading
        showErrorsLoading(false);
        
        if (data.success) {
            if (data.errors && data.errors.length > 0) {
                // Pokaż błędy
                displaySystemErrors(data.errors);
                showErrorsList();
            } else {
                // Brak błędów
                showErrorsEmpty();
            }
        } else {
            throw new Error(data.error || 'Nieznany błąd podczas pobierania danych');
        }
    })
    .catch(error => {
        console.error('[Modal] Błąd ładowania błędów:', error);
        showErrorsLoading(false);
        
        // Pokaż błąd w modalu
        displayErrorInModal(error.message);
    });
}

function displaySystemErrors(errors) {
    console.log('[Modal] Wyświetlanie błędów:', errors.length);
    
    const errorsList = document.getElementById('errors-list');
    if (!errorsList) {
        console.error('[Modal] Element errors-list nie znaleziony!');
        return;
    }
    
    let errorsHTML = '';
    
    errors.forEach((error, index) => {
        const errorDate = error.error_occurred_at ? 
            new Date(error.error_occurred_at).toLocaleString('pl-PL') : 
            'Brak daty';
        
        const isResolved = error.is_resolved;
        const statusClass = isResolved ? 'resolved' : 'unresolved';
        const statusText = isResolved ? 'Rozwiązany' : 'Nierozwiązany';
        const statusIcon = isResolved ? '✅' : '❌';
        
        // Skróć długie komunikaty błędów
        let shortMessage = error.error_message || 'Brak opisu błędu';
        if (shortMessage.length > 100) {
            shortMessage = shortMessage.substring(0, 100) + '...';
        }
        
        errorsHTML += `
            <div class="error-item ${statusClass}" data-error-id="${error.id}">
                <div class="error-header">
                    <div class="error-main-info">
                        <h6 class="error-type">${error.error_type || 'Błąd systemu'}</h6>
                        <p class="error-message">${shortMessage}</p>
                    </div>
                    <div class="error-status">
                        <span class="badge ${isResolved ? 'bg-success' : 'bg-danger'}">
                            ${statusIcon} ${statusText}
                        </span>
                    </div>
                </div>
                <div class="error-details">
                    <small class="text-muted">
                        <i class="fas fa-clock"></i> ${errorDate}
                        ${error.related_product_id ? `| <i class="fas fa-box"></i> Produkt: ${error.related_product_id}` : ''}
                        ${error.error_location ? `| <i class="fas fa-map-marker-alt"></i> ${error.error_location}` : ''}
                    </small>
                </div>
                ${error.error_details ? `
                    <div class="error-expandable mt-2">
                        <button class="btn btn-sm btn-outline-secondary" onclick="toggleErrorDetails(${error.id})">
                            <i class="fas fa-chevron-down"></i> Szczegóły
                        </button>
                        <div class="error-details-content" id="error-details-${error.id}" style="display: none;">
                            <pre class="mt-2 p-2 bg-light border rounded"><code>${JSON.stringify(error.error_details, null, 2)}</code></pre>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    errorsList.innerHTML = errorsHTML;
    console.log('[Modal] Błędy wyświetlone w DOM');
}

function displayErrorInModal(errorMessage) {
    const errorsList = document.getElementById('errors-list');
    if (!errorsList) return;
    
    errorsList.innerHTML = `
        <div class="alert alert-danger">
            <h6><i class="fas fa-exclamation-triangle"></i> Błąd ładowania</h6>
            <p>${errorMessage}</p>
            <button class="btn btn-sm btn-outline-danger" onclick="loadSystemErrorsData()">
                <i class="fas fa-retry"></i> Spróbuj ponownie
            </button>
        </div>
    `;
    
    showErrorsList();
}

function toggleErrorDetails(errorId) {
    const detailsElement = document.getElementById(`error-details-${errorId}`);
    const buttonElement = event.target.closest('button');
    const icon = buttonElement.querySelector('i');
    
    if (detailsElement.style.display === 'none') {
        detailsElement.style.display = 'block';
        icon.className = 'fas fa-chevron-up';
        buttonElement.innerHTML = '<i class="fas fa-chevron-up"></i> Ukryj szczegóły';
    } else {
        detailsElement.style.display = 'none';
        icon.className = 'fas fa-chevron-down';
        buttonElement.innerHTML = '<i class="fas fa-chevron-down"></i> Szczegóły';
    }
}

// FUNKCJE POMOCNICZE DO STANÓW MODALA
function showErrorsLoading(show = true) {
    const loadingElement = document.getElementById('errors-loading');
    if (loadingElement) {
        loadingElement.style.display = show ? 'block' : 'none';
    }
}

function showErrorsEmpty() {
    const emptyElement = document.getElementById('errors-empty');
    if (emptyElement) {
        emptyElement.style.display = 'block';
    }
}

function hideErrorsEmpty() {
    const emptyElement = document.getElementById('errors-empty');
    if (emptyElement) {
        emptyElement.style.display = 'none';
    }
}

function showErrorsList() {
    const listElement = document.getElementById('errors-list');
    if (listElement) {
        listElement.style.display = 'block';
    }
}

function hideErrorsList() {
    const listElement = document.getElementById('errors-list');
    if (listElement) {
        listElement.style.display = 'none';
    }
}

function closeSystemErrorsModal() {
    const modal = document.getElementById('systemErrorsModal');
    if (modal) {
        // Usuń focus z elementów modala przed zamknięciem
        const focusedElement = modal.querySelector(':focus');
        if (focusedElement) {
            focusedElement.blur();
        }
        
        const bootstrapModal = bootstrap.Modal.getInstance(modal);
        if (bootstrapModal) {
            bootstrapModal.hide();
        }
    }
}

function clearSystemErrors() {
    console.log('[Dashboard] Czyszczenie błędów systemu');
    
    // POPRAWKA: Podobny problem może być tutaj
    fetch('/production/admin/ajax/clear-system-errors', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => {
        console.log('[Clear Errors] Response status:', response.status);
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error(`Endpoint zwrócił ${response.status} - ${response.statusText}`);
        }
        
        return response.json();
    })
    .then(data => {
        if (data.success) {
            showNotification('✅ Błędy systemu wyczyszczone', 'success');
            closeSystemErrorsModal();
            
            if (typeof loadTabContent === 'function') {
                loadTabContent('dashboard-tab', true);
            }
        } else {
            showNotification('❌ Błąd czyszczenia: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Błąd czyszczenia błędów:', error);
        showNotification('❌ Błąd połączenia', 'error');
    });
}

function clearAllSystemErrors() {
    console.log('[Dashboard] Czyszczenie wszystkich błędów systemu');
    
    if (confirm('Czy na pewno chcesz wyczyścić wszystkie błędy systemu?')) {
        fetch('/production/admin/ajax/clear-system-errors', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        })
        .then(response => {
            console.log('[Clear Errors] Response status:', response.status);
            
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(`Endpoint zwrócił ${response.status} - ${response.statusText}. Oczekiwano JSON, otrzymano: ${contentType}`);
            }
            
            return response.json();
        })
        .then(data => {
            console.log('[Clear Errors] Response data:', data);
            
            if (data.success) {
                showNotification(`✅ ${data.message || 'Błędy systemu wyczyszczone'}`, 'success');
                
                // DODANE: Odśwież modal zamiast go zamykać
                loadSystemErrorsData();
                
                // Odśwież dashboard
                if (typeof loadTabContent === 'function') {
                    loadTabContent('dashboard-tab', true);
                }
            } else {
                showNotification(`❌ Błąd czyszczenia: ${data.error || 'Nieznany błąd'}`, 'error');
            }
        })
        .catch(error => {
            console.error('Błąd czyszczenia wszystkich błędów:', error);
            showNotification(`❌ Błąd połączenia: ${error.message}`, 'error');
        });
    }
}

function triggerManualSync() {
    console.log('[Dashboard] Uruchamianie ręcznej synchronizacji');
    
    const syncButton = document.getElementById('manual-sync-btn');
    if (syncButton) {
        syncButton.disabled = true;
        syncButton.textContent = 'Synchronizacja...';
    }
    
    fetch('/production/api/manual-sync', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('Synchronizacja zakończona pomyślnie', 'success');
            
            // Odśwież aktywny tab po synchronizacji
            setTimeout(() => {
                loadTabContent(TabDashboard.state.currentActiveTab, true);
            }, 2000);
        } else {
            showNotification('Błąd synchronizacji: ' + data.error, 'error');
        }
    })
    .catch(error => {
        console.error('Błąd ręcznej synchronizacji:', error);
        showNotification('Błąd połączenia podczas synchronizacji', 'error');
    })
    .finally(() => {
        if (syncButton) {
            syncButton.disabled = false;
            syncButton.textContent = 'Ręczna synchronizacja';
        }
    });
}

function viewProductDetails(productId) {
    console.log('[Dashboard] Wyświetl szczegóły produktu:', productId);
    
    if (!productId) {
        console.warn('[Dashboard] Brak ID produktu');
        return;
    }
    
    const detailsUrl = `/production/products/details/${productId}`;
    window.open(detailsUrl, '_blank', 'width=1000,height=700,scrollbars=yes,resizable=yes');
}

// ============================================================================
// FUNKCJE DEBUG PANEL - PRZENIESIONE Z HTML
// ============================================================================

function toggleDebugPanel() {
    const panel = document.getElementById('debug-panel');
    const button = document.querySelector('.debug-toggle');
    
    if (!panel || !button) return;
    
    if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'block';
        button.style.display = 'none';
        updateDebugInfo();
        
        if (!window.debugInterval) {
            window.debugInterval = setInterval(() => {
                if (panel.style.display === 'block') {
                    updateDebugInfo();
                }
            }, 2000);
        }
    } else {
        panel.style.display = 'none';
        button.style.display = 'block';
        if (window.debugInterval) {
            clearInterval(window.debugInterval);
            window.debugInterval = null;
        }
    }
}

function updateDebugInfo() {
    const status = document.getElementById('status-text')?.textContent || 'Nieznany';
    const activeTab = TabDashboard?.state?.currentActiveTab || 'Nieznany';
    const retryCount = TabDashboard?.state?.retryCount || 0;
    const autoRefresh = TabDashboard?.state?.refreshInterval ? 'ON' : 'OFF';
    
    const debugStatus = document.getElementById('debug-status');
    const debugActiveTab = document.getElementById('debug-active-tab');
    const debugRetryCount = document.getElementById('debug-retry-count');
    const debugAutoRefresh = document.getElementById('debug-auto-refresh');
    const debugLastApi = document.getElementById('debug-last-api');
    
    if (debugStatus) debugStatus.textContent = status;
    if (debugActiveTab) debugActiveTab.textContent = activeTab;
    if (debugRetryCount) debugRetryCount.textContent = retryCount;
    if (debugAutoRefresh) debugAutoRefresh.textContent = autoRefresh;
    if (debugLastApi) debugLastApi.textContent = lastApiCall || 'Brak API calls';
}

function refreshSystemWithTimer() {
    const btn = document.getElementById('refresh-system-btn');
    const timer = document.getElementById('refresh-timer');
    
    if (!btn || !timer) return;
    
    btn.disabled = true;
    timer.style.display = 'inline';
    
    let seconds = 5;
    timer.textContent = `(${seconds}s)`;
    
    // Odśwież aktywny tab
    if (TabDashboard?.state?.currentActiveTab) {
        loadTabContent(TabDashboard.state.currentActiveTab);
    }
    
    const countdown = setInterval(() => {
        seconds--;
        timer.textContent = `(${seconds}s)`;
        
        if (seconds <= 0) {
            clearInterval(countdown);
            btn.disabled = false;
            timer.style.display = 'none';
        }
    }, 1000);
}

// ============================================================================
// EKSPORT I INICJALIZACJA KOŃCOWA
// ============================================================================

// Udostępnij główne funkcje globalnie
window.loadTabContent = loadTabContent;
window.TabDashboard = TabDashboard;
window.createDailyPerformanceChart = createDailyPerformanceChart;
window.destroyPerformanceChart = destroyPerformanceChart;
window.hideChartError = hideChartError;
window.clearChartCache = clearChartCache;
window.enableAutoRefresh = enableAutoRefresh;
window.disableAutoRefresh = disableAutoRefresh;
window.showToast = showNotification;
window.ToastSystem = ToastSystem;

// Funkcje modali i akcji
window.showSystemErrorsModal = showSystemErrorsModal;
window.closeSystemErrorsModal = closeSystemErrorsModal;
window.clearSystemErrors = clearSystemErrors;
window.clearAllSystemErrors = clearAllSystemErrors;
window.triggerManualSync = triggerManualSync;
window.viewProductDetails = viewProductDetails;

// Funkcje debug
window.toggleDebugPanel = toggleDebugPanel;
window.updateDebugInfo = updateDebugInfo;
window.refreshSystemWithTimer = refreshSystemWithTimer;

// Funkcja pomocnicza
window.clearAllToasts = () => ToastSystem.clearAll();
window.clearPersistentToasts = () => ToastSystem.clearPersistent();

// Udostępnij RefreshManager globalnie
window.RefreshManager = RefreshManager;
window.refreshAllNow = () => RefreshManager.refreshAllNow();
window.getRefreshStatus = () => RefreshManager.getStatus();

// Debug functions
window.debugRefreshStatus = () => {
    const status = RefreshManager.getStatus();
    console.table(status.components);
    return status;
};

// Auto-inicjalizacja po załadowaniu DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabDashboard);
} else {
    initTabDashboard();
}

// Periodic health check
setInterval(() => {
    if (!document.hidden && !TabDashboard.state.isLoading) {
        checkSystemOverallHealth();
    }
}, 30000); // Co 30 sekund

console.log('[Tab Dashboard] Kompletny moduł załadowany - system tabów + wykresy gotowe!');

// ============================================================================
// CLEANUP I DESTRUKTORY
// ============================================================================

// Cleanup przy opuszczeniu strony
window.addEventListener('beforeunload', () => {
    destroyPerformanceChart();
    
    if (TabDashboard.state.refreshInterval) {
        clearInterval(TabDashboard.state.refreshInterval);
    }
    
    if (window.debugInterval) {
        clearInterval(window.debugInterval);
    }
    
    console.log('[Tab Dashboard] Cleanup wykonany');
});

function debugStationsData(stations) {
    console.log('[Dashboard Debug] Otrzymane dane stanowisk:', stations);
    
    Object.keys(stations || {}).forEach(stationKey => {
        const station = stations[stationKey];
        console.log(`[Dashboard Debug] ${stationKey}:`, {
            pending_count: station?.pending_count,
            today_m3: station?.today_m3,
            today_completed: station?.today_completed,
            hasData: station !== null && station !== undefined
        });
    });
}

function debugSystemsStatus() {
    console.log('=== DEBUG: Status systemów ===');
    console.log('ToastSystem:', typeof ToastSystem !== 'undefined' ? '✅' : '❌');
    console.log('SkeletonSystem:', typeof SkeletonSystem !== 'undefined' ? '✅' : '❌');
    
    if (typeof SkeletonSystem !== 'undefined') {
        console.log('SkeletonSystem.activeWidgets:', SkeletonSystem.activeWidgets ? '✅' : '❌');
        console.log('SkeletonSystem.init:', typeof SkeletonSystem.init === 'function' ? '✅' : '❌');
    }
    
    console.log('TabDashboard:', typeof TabDashboard !== 'undefined' ? '✅' : '❌');
    console.log('=== KONIEC DEBUG ===');
}