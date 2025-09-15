/**
 * Shared Services dla Production Module
 * ====================================
 * 
 * Wspólne serwisy używane przez wszystkie moduły:
 * - ApiClient: Unified API communication
 * - ToastSystem: Notifications system
 * - LoadingManager: Loading states management
 * - EventBus: Inter-module communication
 * 
 * Autor: Konrad Kmiecik
 * Wersja: 1.0
 * Data: 2025-01-15
 */

// ============================================================================
// EVENT BUS - Komunikacja między modułami
// ============================================================================

class EventBus {
    constructor() {
        this.events = new Map();
        this.debugMode = false;
    }

    on(eventName, handler, context = null) {
        if (!this.events.has(eventName)) {
            this.events.set(eventName, []);
        }

        const listener = { handler, context };
        this.events.get(eventName).push(listener);

        if (this.debugMode) {
            console.log(`[EventBus] Registered listener for: ${eventName}`);
        }

        // Return unsubscribe function
        return () => {
            const listeners = this.events.get(eventName);
            if (listeners) {
                const index = listeners.indexOf(listener);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        };
    }

    emit(eventName, data = null) {
        if (this.debugMode) {
            console.log(`[EventBus] Emitting event: ${eventName}`, data);
        }

        const listeners = this.events.get(eventName);
        if (!listeners) return;

        listeners.forEach(({ handler, context }) => {
            try {
                if (context) {
                    handler.call(context, data);
                } else {
                    handler(data);
                }
            } catch (error) {
                console.error(`[EventBus] Error in event handler for ${eventName}:`, error);
            }
        });
    }

    off(eventName, handler = null) {
        if (!handler) {
            // Remove all listeners for event
            this.events.delete(eventName);
        } else {
            // Remove specific handler
            const listeners = this.events.get(eventName);
            if (listeners) {
                const filtered = listeners.filter(l => l.handler !== handler);
                this.events.set(eventName, filtered);
            }
        }
    }

    clear() {
        this.events.clear();
    }

    enableDebug() {
        this.debugMode = true;
    }
}

// ============================================================================
// API CLIENT - Unified API communication
// ============================================================================

class ApiClient {
    constructor() {
        this.baseUrl = '/production/api';
        this.defaultHeaders = {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        };
        this.requestCache = new Map();
        this.cacheTimeout = 30000; // 30 seconds
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            headers: { ...this.defaultHeaders, ...options.headers },
            ...options
        };

        // Check cache for GET requests
        if ((!options.method || options.method === 'GET') && !options.skipCache) {
            const cached = this.getFromCache(url);
            if (cached) {
                return cached;
            }
        }

        try {
            const response = await fetch(url, config);
            const result = await this.handleResponse(response);

            // Cache successful GET responses
            if ((!options.method || options.method === 'GET') && result.success) {
                this.setCache(url, result);
            }

            return result;

        } catch (error) {
            console.error(`[ApiClient] Request failed: ${endpoint}`, error);
            throw error;
        }
    }

    async handleResponse(response) {
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const contentType = response.headers.get('Content-Type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return { success: true, data: await response.text() };
        }
    }

    getFromCache(url) {
        const cached = this.requestCache.get(url);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            console.log(`[ApiClient] Using cached response for: ${url}`);
            return cached.data;
        }
        return null;
    }

    setCache(url, data) {
        this.requestCache.set(url, {
            data: data,
            timestamp: Date.now()
        });
    }

    clearCache() {
        this.requestCache.clear();
    }

    // Convenience methods for common endpoints
    async getDashboardStats() {
        return this.request('/dashboard-stats');
    }

    async getDashboardTabContent() {
        return this.request('/dashboard-tab-content');
    }

    async getProductsTabContent(filters = {}) {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== null && value !== '' && value !== 'all') {
                params.append(key, value);
            }
        });

        const endpoint = `/products-tab-content${params.toString() ? '?' + params.toString() : ''}`;
        return this.request(endpoint);
    }

    async getStationsTabContent() {
        return this.request('/stations-tab-content');
    }

    async getReportsTabContent() {
        return this.request('/reports-tab-content');  
    }

    async getConfigTabContent() {
        return this.request('/config-tab-content');
    }

    async getFilteredProducts(filters) {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== null && value !== '' && value !== 'all') {
                params.append(key, value);
            }
        });

        return this.request(`/products-filtered?${params.toString()}`);
    }

    async updateProductPriority(productId, priority) {
        return this.request('/update-priority', {
            method: 'POST',
            body: JSON.stringify({
                product_id: productId,
                new_priority: priority
            })
        });
    }

    async triggerManualSync() {
        return this.request('/manual-sync', {
            method: 'POST'
        });
    }
}

// ============================================================================
// TOAST SYSTEM - Unified notifications
// ============================================================================

class ToastSystem {
    constructor() {
        this.container = null;
        this.toasts = new Map();
        this.nextId = 1;
        this.maxToasts = 5;
        this.defaultDuration = 5000;

        this.init();
    }

    init() {
        this.createContainer();
        this.addStyles();
    }

    createContainer() {
        if (document.getElementById('toast-container')) return;

        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.className = 'toast-container';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            max-width: 400px;
            pointer-events: none;
        `;

        document.body.appendChild(this.container);
    }

    addStyles() {
        if (document.getElementById('toast-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'toast-styles';
        styles.textContent = `
            .toast-item {
                pointer-events: auto;
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                margin-bottom: 10px;
                padding: 16px;
                display: flex;
                align-items: flex-start;
                gap: 12px;
                opacity: 0;
                transform: translateX(100%);
                transition: all 0.3s ease;
                border-left: 4px solid #ddd;
                word-wrap: break-word;
            }
            
            .toast-item.show {
                opacity: 1;
                transform: translateX(0);
            }
            
            .toast-item.success { border-left-color: #10b981; }
            .toast-item.error { border-left-color: #ef4444; }
            .toast-item.warning { border-left-color: #f59e0b; }
            .toast-item.info { border-left-color: #3b82f6; }
            
            .toast-icon {
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
            }
            
            .toast-icon.success { background: #10b981; }
            .toast-icon.error { background: #ef4444; }
            .toast-icon.warning { background: #f59e0b; }
            .toast-icon.info { background: #3b82f6; }
            
            .toast-content {
                flex: 1;
                min-width: 0;
            }
            
            .toast-title {
                font-weight: 600;
                font-size: 14px;
                color: #1f2937;
                margin-bottom: 4px;
            }
            
            .toast-message {
                font-size: 13px;
                color: #6b7280;
                line-height: 1.4;
            }
            
            .toast-close {
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
            }
            
            .toast-close:hover {
                color: #ef4444;
                background: #fef2f2;
            }
        `;

        document.head.appendChild(styles);
    }

    show(message, type = 'info', options = {}) {
        const id = this.nextId++;
        const duration = options.duration || this.defaultDuration;

        const toast = this.createToast(id, message, type, options);
        this.toasts.set(id, toast);

        this.container.appendChild(toast.element);

        // Animate in
        setTimeout(() => {
            toast.element.classList.add('show');
        }, 50);

        // Auto-hide
        if (duration > 0 && !options.persistent) {
            setTimeout(() => {
                this.hide(id);
            }, duration);
        }

        this.enforceMaxToasts();

        return id;
    }

    createToast(id, message, type, options) {
        const element = document.createElement('div');
        element.className = `toast-item ${type}`;
        element.style.position = 'relative';

        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };

        const titles = {
            success: 'Sukces',
            error: 'Błąd',
            warning: 'Ostrzeżenie',
            info: 'Informacja'
        };

        element.innerHTML = `
            <div class="toast-icon ${type}">${icons[type] || icons.info}</div>
            <div class="toast-content">
                <div class="toast-title">${titles[type] || titles.info}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="ProductionShared.toastSystem.hide(${id})">×</button>
        `;

        return {
            id,
            element,
            type,
            message,
            persistent: options.persistent
        };
    }

    hide(id) {
        const toast = this.toasts.get(id);
        if (!toast) return;

        toast.element.classList.remove('show');

        setTimeout(() => {
            if (toast.element.parentNode) {
                toast.element.parentNode.removeChild(toast.element);
            }
            this.toasts.delete(id);
        }, 300);
    }

    enforceMaxToasts() {
        if (this.toasts.size <= this.maxToasts) return;

        const sortedToasts = Array.from(this.toasts.values())
            .filter(toast => !toast.persistent)
            .sort((a, b) => a.id - b.id);

        const toRemove = sortedToasts.slice(0, this.toasts.size - this.maxToasts);
        toRemove.forEach(toast => this.hide(toast.id));
    }

    clearAll() {
        Array.from(this.toasts.keys()).forEach(id => this.hide(id));
    }
}

// ============================================================================
// LOADING MANAGER - Loading states management
// ============================================================================

class LoadingManager {
    constructor() {
        this.activeLoaders = new Set();
        this.globalSpinner = null;
        this.createGlobalSpinner();
    }

    createGlobalSpinner() {
        if (document.getElementById('global-spinner')) return;

        this.globalSpinner = document.createElement('div');
        this.globalSpinner.id = 'global-spinner';
        this.globalSpinner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            flex-direction: column;
            gap: 20px;
        `;

        this.globalSpinner.innerHTML = `
            <div style="
                width: 50px;
                height: 50px;
                border: 4px solid #f3f3f3;
                border-top: 4px solid #3498db;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
            <div id="spinner-message" style="
                color: white;
                font-size: 16px;
                font-weight: 500;
            ">Ładowanie...</div>
        `;

        // Add spin animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(this.globalSpinner);
    }

    show(context, message = 'Ładowanie...') {
        this.activeLoaders.add(context);

        const messageElement = document.getElementById('spinner-message');
        if (messageElement) {
            messageElement.textContent = message;
        }

        this.globalSpinner.style.display = 'flex';

        console.log(`[LoadingManager] Loading started: ${context}`);
    }

    hide(context) {
        this.activeLoaders.delete(context);

        if (this.activeLoaders.size === 0) {
            this.globalSpinner.style.display = 'none';
        }

        console.log(`[LoadingManager] Loading finished: ${context}`);
    }

    isLoading(context = null) {
        if (context) {
            return this.activeLoaders.has(context);
        }
        return this.activeLoaders.size > 0;
    }

    clear() {
        this.activeLoaders.clear();
        this.globalSpinner.style.display = 'none';
    }
}

// ============================================================================
// GLOBAL NAMESPACE - Shared services
// ============================================================================

window.ProductionShared = {
    eventBus: new EventBus(),
    apiClient: new ApiClient(),
    toastSystem: new ToastSystem(),
    loadingManager: new LoadingManager(),

    // Utility functions
    utils: {
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        formatDate(dateString) {
            if (!dateString) return '-';
            try {
                const date = new Date(dateString);
                return date.toLocaleDateString('pl-PL');
            } catch (error) {
                return dateString;
            }
        },

        formatCurrency(amount) {
            if (amount === null || amount === undefined) return '-';
            try {
                return new Intl.NumberFormat('pl-PL', {
                    style: 'currency',
                    currency: 'PLN'
                }).format(amount);
            } catch (error) {
                return amount + ' PLN';
            }
        }
    }
};

// Enable debug mode if needed
if (window.PRODUCTION_CONFIG && window.PRODUCTION_CONFIG.debug) {
    ProductionShared.eventBus.enableDebug();
}

console.log('[Shared Services] Initialized successfully');