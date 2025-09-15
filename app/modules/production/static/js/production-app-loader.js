/**
 * Production App Loader - Główny kontroler aplikacji
 * ==================================================
 * 
 * Odpowiedzialności:
 * - Inicjalizacja aplikacji
 * - Zarządzanie systemem tabów AJAX
 * - Ładowanie modułów na żądanie
 * - Koordynacja między modułami
 * - Zarządzanie stanem globalnym
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 1.0
 * Data: 2025-01-15
 */

// ============================================================================
// MAIN APPLICATION CLASS
// ============================================================================

class ProductionApp {
    constructor() {
        this.state = {
            currentTab: 'dashboard-tab',
            isInitialized: false,
            loadedModules: new Map(),
            isLoading: false
        };

        this.config = window.PRODUCTION_CONFIG || {};
        this.shared = window.ProductionShared;

        // Bind methods
        this.handleTabClick = this.handleTabClick.bind(this);
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
        this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    async init() {
        if (this.state.isInitialized) {
            console.warn('[ProductionApp] Already initialized');
            return;
        }

        console.log('[ProductionApp] Initializing application...');

        try {
            // 1. Setup global event listeners
            this.setupEventListeners();

            // 2. Initialize tab system
            this.initTabSystem();

            // 3. Setup automatic refresh
            this.setupAutoRefresh();

            // 4. Load initial tab (dashboard)
            await this.loadInitialTab();

            // 5. Mark as initialized
            this.state.isInitialized = true;

            // 6. Emit ready event
            this.shared.eventBus.emit('app:ready', {
                currentTab: this.state.currentTab,
                user: this.config.user
            });

            console.log('[ProductionApp] Application initialized successfully');

        } catch (error) {
            console.error('[ProductionApp] Initialization failed:', error);
            this.shared.toastSystem.show(
                'Błąd inicjalizacji aplikacji: ' + error.message,
                'error'
            );
        }
    }

    setupEventListeners() {
        // Tab navigation
        document.addEventListener('click', this.handleTabClick);

        // Page visibility changes
        document.addEventListener('visibilitychange', this.handleVisibilityChange);

        // Before page unload
        window.addEventListener('beforeunload', this.handleBeforeUnload);

        // Global shortcuts
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));

        console.log('[ProductionApp] Global event listeners attached');
    }

    // ========================================================================
    // TAB SYSTEM
    // ========================================================================

    initTabSystem() {
        // Find all tab buttons
        const tabButtons = document.querySelectorAll('[data-bs-toggle="tab"]');

        tabButtons.forEach(button => {
            // Remove any existing listeners to avoid conflicts
            button.removeEventListener('click', this.handleTabClick);

            // Add our custom handler
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const tabName = this.extractTabNameFromButton(button);
                if (tabName) {
                    this.switchToTab(tabName);
                }
            });
        });

        console.log(`[ProductionApp] Tab system initialized (${tabButtons.length} tabs)`);
    }

    extractTabNameFromButton(button) {
        const target = button.getAttribute('data-bs-target');
        if (target) {
            return target.replace('#', '').replace('-content', '');
        }
        return button.id?.replace('-tab', '') || null;
    }

    async switchToTab(tabName) {
        if (this.state.isLoading) {
            console.log('[ProductionApp] Tab switch ignored - currently loading');
            return;
        }

        if (this.state.currentTab === tabName) {
            console.log(`[ProductionApp] Already on tab: ${tabName}`);
            return;
        }

        console.log(`[ProductionApp] Switching from ${this.state.currentTab} to ${tabName}`);

        try {
            this.state.isLoading = true;

            // 1. Cleanup previous tab
            await this.cleanupTab(this.state.currentTab);

            // 2. Update UI state
            this.updateTabUI(tabName);

            // 3. Load new tab content
            await this.loadTabContent(tabName);

            // 4. Update state
            this.state.currentTab = tabName;

            // 5. Emit event
            this.shared.eventBus.emit('tab:changed', {
                from: this.state.currentTab,
                to: tabName
            });

        } catch (error) {
            console.error(`[ProductionApp] Error switching to tab ${tabName}:`, error);
            this.shared.toastSystem.show(
                `Błąd ładowania zakładki: ${error.message}`,
                'error'
            );
        } finally {
            this.state.isLoading = false;
        }
    }

    updateTabUI(tabName) {
        // Update tab buttons
        document.querySelectorAll('[data-bs-toggle="tab"]').forEach(button => {
            const buttonTabName = this.extractTabNameFromButton(button);
            if (buttonTabName === tabName) {
                button.classList.add('active');
                button.setAttribute('aria-selected', 'true');
            } else {
                button.classList.remove('active');
                button.setAttribute('aria-selected', 'false');
            }
        });

        // Update tab content containers
        document.querySelectorAll('.tab-pane').forEach(pane => {
            if (pane.id === `${tabName}-content`) {
                pane.classList.add('show', 'active');
            } else {
                pane.classList.remove('show', 'active');
            }
        });
    }

    async loadTabContent(tabName) {
        const loadingContext = `tab-${tabName}`;

        try {
            this.shared.loadingManager.show(loadingContext, `Ładowanie ${tabName}...`);

            // Show tab-specific loading state
            this.showTabLoading(tabName);

            switch (tabName) {
                case 'dashboard-tab':
                    await this.loadDashboardTab();
                    break;

                case 'products-tab':
                    await this.loadProductsTab();
                    break;

                case 'reports-tab':
                    await this.loadReportsTab();
                    break;

                case 'stations-tab':
                    await this.loadStationsTab();
                    break;

                case 'config-tab':
                    await this.loadConfigTab();
                    break;

                default:
                    throw new Error(`Unknown tab: ${tabName}`);
            }

            this.hideTabLoading(tabName);

        } catch (error) {
            this.hideTabLoading(tabName);
            this.showTabError(tabName, error.message);
            throw error;
        } finally {
            this.shared.loadingManager.hide(loadingContext);
        }
    }

    // ========================================================================
    // TAB LOADERS
    // ========================================================================

    async loadDashboardTab() {
        console.log('[ProductionApp] Loading dashboard tab...');

        // Check if dashboard module is already loaded
        if (!this.state.loadedModules.has('dashboard')) {
            // Load dashboard module
            const { DashboardModule } = await import('./modules/dashboard-module.js');
            const dashboardModule = new DashboardModule(this.shared, this.config);

            this.state.loadedModules.set('dashboard', dashboardModule);
        }

        const dashboardModule = this.state.loadedModules.get('dashboard');
        await dashboardModule.load();
    }

    async loadProductsTab() {
        console.log('[ProductionApp] Loading products tab...');

        // For now, load via AJAX (later will be replaced with standalone module)
        const response = await this.shared.apiClient.getProductsTabContent();

        if (response.success) {
            const wrapper = document.getElementById('products-tab-wrapper');
            if (wrapper) {
                wrapper.innerHTML = response.html;
                wrapper.style.display = 'block';
            }

            // Initialize products module if needed
            if (typeof window.initProductsList === 'function') {
                window.initProductsList();
            }
        } else {
            throw new Error(response.error || 'Failed to load products');
        }
    }

    async loadReportsTab() {
        console.log('[ProductionApp] Loading reports tab...');

        // TODO: Implement reports module
        const wrapper = document.getElementById('reports-tab-wrapper');
        if (wrapper) {
            wrapper.innerHTML = `
                <div class="alert alert-info">
                    <h5>Raporty</h5>
                    <p>Moduł raportów będzie dostępny wkrótce.</p>
                </div>
            `;
            wrapper.style.display = 'block';
        }
    }

    async loadStationsTab() {
        console.log('[ProductionApp] Loading stations tab...');

        // TODO: Implement stations module
        const wrapper = document.getElementById('stations-tab-wrapper');
        if (wrapper) {
            wrapper.innerHTML = `
                <div class="alert alert-info">
                    <h5>Stanowiska</h5>
                    <p>Moduł zarządzania stanowiskami będzie dostępny wkrótce.</p>
                </div>
            `;
            wrapper.style.display = 'block';
        }
    }

    async loadConfigTab() {
        console.log('[ProductionApp] Loading config tab...');

        // Admin only
        if (!this.config.user || this.config.user.role !== 'admin') {
            throw new Error('Brak uprawnień administratora');
        }

        // TODO: Implement config module
        const wrapper = document.getElementById('config-tab-wrapper');
        if (wrapper) {
            wrapper.innerHTML = `
                <div class="alert alert-info">
                    <h5>Konfiguracja</h5>
                    <p>Panel konfiguracji będzie dostępny wkrótce.</p>
                </div>
            `;
            wrapper.style.display = 'block';
        }
    }

    // ========================================================================
    // TAB LIFECYCLE
    // ========================================================================

    async cleanupTab(tabName) {
        const module = this.state.loadedModules.get(tabName.replace('-tab', ''));
        if (module && typeof module.unload === 'function') {
            await module.unload();
        }

        // Hide any tab-specific loading/error states
        this.hideTabLoading(tabName);
        this.hideTabError(tabName);
    }

    showTabLoading(tabName) {
        const loadingElement = document.getElementById(`${tabName}-loading`);
        const wrapperElement = document.getElementById(`${tabName}-wrapper`);
        const errorElement = document.getElementById(`${tabName}-error`);

        if (loadingElement) loadingElement.style.display = 'block';
        if (wrapperElement) wrapperElement.style.display = 'none';
        if (errorElement) errorElement.style.display = 'none';
    }

    hideTabLoading(tabName) {
        const loadingElement = document.getElementById(`${tabName}-loading`);
        if (loadingElement) loadingElement.style.display = 'none';
    }

    showTabError(tabName, message) {
        const errorElement = document.getElementById(`${tabName}-error`);
        const messageElement = document.getElementById(`${tabName}-error-message`);

        if (errorElement) {
            errorElement.style.display = 'block';
            if (messageElement) {
                messageElement.textContent = message;
            }
        }
    }

    hideTabError(tabName) {
        const errorElement = document.getElementById(`${tabName}-error`);
        if (errorElement) errorElement.style.display = 'none';
    }

    // ========================================================================
    // AUTO REFRESH
    // ========================================================================

    setupAutoRefresh() {
        // Auto-refresh every 3 minutes if page is visible
        setInterval(() => {
            if (!document.hidden && !this.state.isLoading) {
                this.refreshCurrentTab();
            }
        }, 180000); // 3 minutes

        console.log('[ProductionApp] Auto-refresh setup complete');
    }

    async refreshCurrentTab() {
        if (this.state.isLoading) return;

        console.log(`[ProductionApp] Auto-refreshing current tab: ${this.state.currentTab}`);

        try {
            await this.loadTabContent(this.state.currentTab);
            console.log('[ProductionApp] Auto-refresh completed');
        } catch (error) {
            console.error('[ProductionApp] Auto-refresh failed:', error);
        }
    }

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================

    handleTabClick(event) {
        // Let Bootstrap handle the visual tab switching
        // We'll override the content loading
        const button = event.target.closest('[data-bs-toggle="tab"]');
        if (!button) return;

        // Extract tab name and load content
        const tabName = this.extractTabNameFromButton(button);
        if (tabName && tabName !== this.state.currentTab) {
            // Prevent default Bootstrap behavior for content loading
            event.preventDefault();

            // Handle tab switch ourselves
            this.switchToTab(tabName);
        }
    }

    handleVisibilityChange() {
        if (document.hidden) {
            console.log('[ProductionApp] Page hidden - pausing auto-refresh');
        } else {
            console.log('[ProductionApp] Page visible - resuming auto-refresh');
            // Refresh current tab after returning to page
            setTimeout(() => {
                this.refreshCurrentTab();
            }, 1000);
        }
    }

    handleBeforeUnload(event) {
        // Cleanup loaded modules
        this.state.loadedModules.forEach(async (module, name) => {
            if (typeof module.cleanup === 'function') {
                try {
                    await module.cleanup();
                } catch (error) {
                    console.warn(`[ProductionApp] Cleanup error for ${name}:`, error);
                }
            }
        });
    }

    handleKeyboardShortcuts(event) {
        // Ctrl+R - refresh current tab
        if (event.ctrlKey && event.key === 'r') {
            event.preventDefault();
            this.refreshCurrentTab();
        }

        // Tab navigation shortcuts (Ctrl+1, Ctrl+2, etc.)
        if (event.ctrlKey && event.key >= '1' && event.key <= '5') {
            event.preventDefault();
            const tabIndex = parseInt(event.key) - 1;
            const tabs = ['dashboard-tab', 'products-tab', 'reports-tab', 'stations-tab', 'config-tab'];

            if (tabs[tabIndex]) {
                this.switchToTab(tabs[tabIndex]);
            }
        }
    }

    // ========================================================================
    // INITIALIZATION HELPERS
    // ========================================================================

    async loadInitialTab() {
        // Determine initial tab from URL hash or active tab
        let initialTab = 'dashboard-tab';

        // Check URL hash
        if (window.location.hash) {
            const hashTab = window.location.hash.substring(1);
            if (hashTab.endsWith('-tab')) {
                initialTab = hashTab;
            } else {
                initialTab = hashTab + '-tab';
            }
        }

        // Check for active tab in DOM
        const activeTab = document.querySelector('[data-bs-toggle="tab"].active');
        if (activeTab) {
            const tabName = this.extractTabNameFromButton(activeTab);
            if (tabName) {
                initialTab = tabName;
            }
        }

        console.log(`[ProductionApp] Loading initial tab: ${initialTab}`);
        await this.switchToTab(initialTab);
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    getCurrentTab() {
        return this.state.currentTab;
    }

    getLoadedModules() {
        return Array.from(this.state.loadedModules.keys());
    }

    isTabLoaded(tabName) {
        return this.state.loadedModules.has(tabName.replace('-tab', ''));
    }

    async forceRefresh() {
        await this.refreshCurrentTab();
    }
}

// ============================================================================
// AUTO-INITIALIZATION
// ============================================================================

let productionApp = null;

function initProductionApp() {
    if (productionApp) {
        console.warn('[ProductionApp] Already initialized');
        return productionApp;
    }

    // Wait for shared services
    if (typeof window.ProductionShared === 'undefined') {
        console.error('[ProductionApp] Shared services not loaded');
        return null;
    }

    productionApp = new ProductionApp();

    // Make available globally for debugging
    window.ProductionApp = productionApp;

    // Initialize
    productionApp.init().catch(error => {
        console.error('[ProductionApp] Failed to initialize:', error);
    });

    return productionApp;
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProductionApp);
} else {
    // DOM already loaded
    setTimeout(initProductionApp, 100);
}

// Export for manual initialization if needed
window.initProductionApp = initProductionApp;