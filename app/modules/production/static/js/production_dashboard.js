/**
 * Production Dashboard JavaScript
 * Wood Power CRM - Production Module
 * Handles main dashboard functionality, workstation monitoring, and real-time updates
 */

class ProductionDashboard {
    constructor() {
        this.config = {
            refreshInterval: 30000, // 30 seconds
            apiEndpoint: '/production/api',
            maxRetries: 3,
            retryDelay: 2000
        };
        
        this.state = {
            isLoading: false,
            lastUpdate: null,
            retryCount: 0,
            workstations: new Map(),
            alerts: new Map()
        };
        
        this.timers = {
            refresh: null,
            workstationUpdate: null,
            alertsUpdate: null
        };
        
        console.log('[ProductionDashboard] Initialized');
    }

    /**
     * Initialize the dashboard
     */
    init() {
        console.log('[ProductionDashboard] Starting initialization...');
        
        try {
            this.bindEvents();
            this.loadInitialData();
            this.startAutoRefresh();
            
            console.log('[ProductionDashboard] Initialization complete');
        } catch (error) {
            console.error('[ProductionDashboard] Initialization failed:', error);
            this.showError('Błąd inicjalizacji dashboardu');
        }
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Global error handler
        window.addEventListener('error', (event) => {
            console.error('[ProductionDashboard] Global error:', event.error);
        });

        // Visibility change handler (pause refresh when tab is hidden)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseAutoRefresh();
            } else {
                this.resumeAutoRefresh();
            }
        });

        // Online/offline handlers
        window.addEventListener('online', () => {
            console.log('[ProductionDashboard] Connection restored');
            this.handleConnectionRestore();
        });

        window.addEventListener('offline', () => {
            console.log('[ProductionDashboard] Connection lost');
            this.handleConnectionLoss();
        });
    }

    /**
     * Load initial dashboard data
     */
    async loadInitialData() {
        this.showLoading('Ładowanie danych dashboardu...');
        
        try {
            const [statsData, workstationsData, alertsData] = await Promise.allSettled([
                this.fetchStats(),
                this.fetchWorkstationsStatus(),
                this.fetchAlerts()
            ]);

            // Process stats
            if (statsData.status === 'fulfilled') {
                this.updateStatsDisplay(statsData.value);
            } else {
                console.warn('[ProductionDashboard] Failed to load stats:', statsData.reason);
            }

            // Process workstations
            if (workstationsData.status === 'fulfilled') {
                this.updateWorkstationsDisplay(workstationsData.value);
            } else {
                console.warn('[ProductionDashboard] Failed to load workstations:', workstationsData.reason);
            }

            // Process alerts
            if (alertsData.status === 'fulfilled') {
                this.updateAlertsDisplay(alertsData.value);
            } else {
                console.warn('[ProductionDashboard] Failed to load alerts:', alertsData.reason);
            }

            this.state.lastUpdate = new Date();
            this.state.retryCount = 0;
            
        } catch (error) {
            console.error('[ProductionDashboard] Failed to load initial data:', error);
            this.handleLoadError(error);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Fetch production statistics
     */
    async fetchStats() {
        const response = await this.apiCall('/stats/overview');
        return response.stats;
    }

    /**
     * Fetch workstations status
     */
    async fetchWorkstationsStatus() {
        const response = await this.apiCall('/workstations/status');
        return response.workstations;
    }

    /**
     * Fetch alerts
     */
    async fetchAlerts() {
        const response = await this.apiCall('/alerts?unread_only=true&limit=10');
        return response.alerts;
    }

    /**
     * Generic API call with error handling and retries
     */
    async apiCall(endpoint, options = {}) {
        const url = `${this.config.apiEndpoint}${endpoint}`;
        const defaultOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            ...options
        };

        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                console.log(`[ProductionDashboard] API call to ${endpoint} (attempt ${attempt})`);
                
                const response = await fetch(url, defaultOptions);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.error || 'API returned error');
                }
                
                return data;
                
            } catch (error) {
                console.warn(`[ProductionDashboard] API call failed (attempt ${attempt}):`, error);
                
                if (attempt === this.config.maxRetries) {
                    throw error;
                }
                
                // Wait before retry
                await this.delay(this.config.retryDelay * attempt);
            }
        }
    }

    /**
     * Update statistics display
     */
    updateStatsDisplay(stats) {
        const statElements = {
            'tasks_pending': document.querySelector('.stat-card:nth-child(1) h3'),
            'tasks_in_progress': document.querySelector('.stat-card:nth-child(2) h3'),
            'tasks_completed_today': document.querySelector('.stat-card:nth-child(3) h3'),
            'active_alerts': document.querySelector('.stat-card:nth-child(4) h3')
        };

        Object.entries(statElements).forEach(([key, element]) => {
            if (element && stats[key] !== undefined) {
                this.animateNumber(element, parseInt(element.textContent) || 0, stats[key]);
            }
        });

        console.log('[ProductionDashboard] Stats updated:', stats);
    }

    /**
     * Update workstations display
     */
    updateWorkstationsDisplay(workstations) {
        workstations.forEach(workstation => {
            this.state.workstations.set(workstation.id, workstation);
            this.updateWorkstationCard(workstation);
        });

        console.log('[ProductionDashboard] Workstations updated:', workstations.length);
    }

    /**
     * Update individual workstation card
     */
    updateWorkstationCard(workstation) {
        const card = document.querySelector(`[data-workstation-id="${workstation.id}"]`);
        if (!card) return;

        // Update status
        const statusElement = card.querySelector(`#workstation-status-${workstation.id}`);
        if (statusElement) {
            const statusIndicator = statusElement.querySelector('.status-indicator');
            const statusIcon = statusIndicator.querySelector('i');
            const statusText = statusIndicator.querySelector('span');

            // Remove old status classes
            statusIcon.className = statusIcon.className.replace(/status-\w+/g, '');
            
            // Add new status class and update text
            switch (workstation.status) {
                case 'idle':
                    statusIcon.classList.add('fas', 'fa-circle', 'status-idle');
                    statusText.textContent = 'Bezczynny';
                    break;
                case 'active':
                    statusIcon.classList.add('fas', 'fa-circle', 'status-active');
                    statusText.textContent = 'Aktywny';
                    break;
                case 'busy':
                    statusIcon.classList.add('fas', 'fa-circle', 'status-busy');
                    statusText.textContent = 'Zajęty';
                    break;
                case 'error':
                    statusIcon.classList.add('fas', 'fa-circle', 'status-error');
                    statusText.textContent = 'Błąd';
                    break;
                default:
                    statusIcon.classList.add('fas', 'fa-circle', 'status-idle');
                    statusText.textContent = 'Nieznany';
            }
        }

        // Update tasks count
        const tasksElement = card.querySelector(`#workstation-tasks-${workstation.id}`);
        if (tasksElement) {
            const tasksSpan = tasksElement.querySelector('span');
            if (tasksSpan) {
                const count = workstation.tasks_count || 0;
                tasksSpan.textContent = `${count} zadań w kolejce`;
            }
        }

        // Add pulse animation for active workstations
        if (workstation.status === 'active') {
            card.classList.add('workstation-active');
        } else {
            card.classList.remove('workstation-active');
        }
    }

    /**
     * Update alerts display
     */
    updateAlertsDisplay(alerts) {
        const alertsList = document.querySelector('.alerts-list');
        if (!alertsList) return;

        // Clear existing alerts
        alertsList.innerHTML = '';

        if (alerts.length === 0) {
            alertsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>Brak nowych alertów</p>
                </div>
            `;
            return;
        }

        // Add new alerts
        alerts.forEach(alert => {
            const alertElement = this.createAlertElement(alert);
            alertsList.appendChild(alertElement);
            this.state.alerts.set(alert.id, alert);
        });

        console.log('[ProductionDashboard] Alerts updated:', alerts.length);
    }

    /**
     * Create alert DOM element
     */
    createAlertElement(alert) {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert-item alert-${alert.alert_type}`;
        alertDiv.setAttribute('data-alert-id', alert.id);

        const iconClass = this.getAlertIcon(alert.alert_type);
        const timeString = new Date(alert.created_at).toLocaleString('pl-PL');

        alertDiv.innerHTML = `
            <div class="alert-icon">
                <i class="${iconClass}"></i>
            </div>
            <div class="alert-content">
                <h4>${this.escapeHtml(alert.title)}</h4>
                <p>${this.escapeHtml(alert.message.substring(0, 100))}${alert.message.length > 100 ? '...' : ''}</p>
                <span class="alert-time">${timeString}</span>
            </div>
            <div class="alert-actions">
                <button class="btn btn-small btn-ghost" onclick="ProductionDashboard.instance.markAlertRead(${alert.id})">
                    <i class="fas fa-check"></i>
                </button>
            </div>
        `;

        return alertDiv;
    }

    /**
     * Get appropriate icon for alert type
     */
    getAlertIcon(alertType) {
        const icons = {
            'delay': 'fas fa-clock',
            'bottleneck': 'fas fa-exclamation-triangle',
            'completion': 'fas fa-check-circle',
            'error': 'fas fa-times-circle'
        };
        return icons[alertType] || 'fas fa-info-circle';
    }

    /**
     * Mark alert as read
     */
    async markAlertRead(alertId) {
        try {
            await this.apiCall(`/alert/${alertId}/read`, { method: 'POST' });
            
            // Remove alert from UI
            const alertElement = document.querySelector(`[data-alert-id="${alertId}"]`);
            if (alertElement) {
                alertElement.style.animation = 'fadeOut 0.3s ease-out';
                setTimeout(() => alertElement.remove(), 300);
            }
            
            // Remove from state
            this.state.alerts.delete(alertId);
            
            this.showToast('Alert oznaczony jako przeczytany', 'success');
            
        } catch (error) {
            console.error('[ProductionDashboard] Failed to mark alert as read:', error);
            this.showToast('Błąd oznaczania alertu', 'error');
        }
    }

    /**
     * Start auto-refresh timers
     */
    startAutoRefresh() {
        // Main refresh timer
        this.timers.refresh = setInterval(() => {
            this.refreshData();
        }, this.config.refreshInterval);

        // Workstation status refresh (more frequent)
        this.timers.workstationUpdate = setInterval(() => {
            this.refreshWorkstationStatus();
        }, this.config.refreshInterval / 2);

        console.log('[ProductionDashboard] Auto-refresh started');
    }

    /**
     * Pause auto-refresh
     */
    pauseAutoRefresh() {
        Object.values(this.timers).forEach(timer => {
            if (timer) clearInterval(timer);
        });
        console.log('[ProductionDashboard] Auto-refresh paused');
    }

    /**
     * Resume auto-refresh
     */
    resumeAutoRefresh() {
        this.startAutoRefresh();
        console.log('[ProductionDashboard] Auto-refresh resumed');
    }

    /**
     * Refresh all data
     */
    async refreshData() {
        if (this.state.isLoading) return;

        try {
            await this.loadInitialData();
        } catch (error) {
            console.error('[ProductionDashboard] Refresh failed:', error);
            this.handleRefreshError(error);
        }
    }

    /**
     * Refresh only workstation status
     */
    async refreshWorkstationStatus() {
        try {
            const workstations = await this.fetchWorkstationsStatus();
            this.updateWorkstationsDisplay(workstations);
        } catch (error) {
            console.warn('[ProductionDashboard] Workstation refresh failed:', error);
        }
    }

    /**
     * Refresh only alerts
     */
    async refreshAlerts() {
        try {
            const alerts = await this.fetchAlerts();
            this.updateAlertsDisplay(alerts);
        } catch (error) {
            console.warn('[ProductionDashboard] Alerts refresh failed:', error);
        }
    }

    /**
     * Handle connection restore
     */
    handleConnectionRestore() {
        this.state.retryCount = 0;
        this.resumeAutoRefresh();
        this.refreshData();
        this.showToast('Połączenie przywrócone', 'success');
    }

    /**
     * Handle connection loss
     */
    handleConnectionLoss() {
        this.pauseAutoRefresh();
        this.showToast('Utracono połączenie', 'warning');
    }

    /**
     * Handle load errors
     */
    handleLoadError(error) {
        this.state.retryCount++;
        
        if (this.state.retryCount >= this.config.maxRetries) {
            this.showError('Błąd ładowania danych. Sprawdź połączenie internetowe.');
        } else {
            this.showToast(`Błąd ładowania (próba ${this.state.retryCount})`, 'warning');
        }
    }

    /**
     * Handle refresh errors
     */
    handleRefreshError(error) {
        if (this.state.retryCount === 0) {
            this.showToast('Błąd odświeżania danych', 'warning');
        }
        this.state.retryCount++;
    }

    /**
     * Animate number change
     */
    animateNumber(element, from, to, duration = 1000) {
        const startTime = performance.now();
        const difference = to - from;

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function
            const easeOutCubic = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(from + (difference * easeOutCubic));
            
            element.textContent = current;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    }

    /**
     * Show loading overlay
     */
    showLoading(message = 'Ładowanie...') {
        this.state.isLoading = true;
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            const messageElement = overlay.querySelector('p');
            if (messageElement) {
                messageElement.textContent = message;
            }
            overlay.style.display = 'flex';
        }
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        this.state.isLoading = false;
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info', duration = 3000) {
        // Create toast container if it doesn't exist
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
            `;
            document.body.appendChild(container);
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.cssText = `
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            padding: 16px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 300px;
            border-left: 4px solid var(--production-primary);
            animation: slideInRight 0.3s ease;
        `;

        const iconClass = {
            'success': 'fas fa-check-circle',
            'error': 'fas fa-times-circle',
            'warning': 'fas fa-exclamation-triangle',
            'info': 'fas fa-info-circle'
        }[type] || 'fas fa-info-circle';

        toast.innerHTML = `
            <i class="${iconClass}"></i>
            <span>${this.escapeHtml(message)}</span>
        `;

        container.appendChild(toast);

        // Auto-remove toast
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, duration);
    }

    /**
     * Show error message
     */
    showError(message) {
        this.showToast(message, 'error', 5000);
        console.error('[ProductionDashboard] Error:', message);
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.pauseAutoRefresh();
        console.log('[ProductionDashboard] Destroyed');
    }
}

// Global functions for HTML event handlers
window.reorganizeQueue = async function() {
    const dashboard = ProductionDashboard.instance;
    if (!dashboard) return;

    if (confirm('Czy na pewno chcesz zreorganizować kolejność produkcji?')) {
        dashboard.showLoading('Reorganizacja kolejności...');
        
        try {
            await dashboard.apiCall('/reorganize-queue', { method: 'POST' });
            dashboard.showToast('Kolejność została zreorganizowana', 'success');
            await dashboard.refreshData();
        } catch (error) {
            dashboard.showToast('Błąd reorganizacji kolejności', 'error');
        } finally {
            dashboard.hideLoading();
        }
    }
};

window.syncOrders = async function() {
    const dashboard = ProductionDashboard.instance;
    if (!dashboard) return;

    dashboard.showLoading('Synchronizacja z Baselinker...');
    
    try {
        const result = await dashboard.apiCall('/sync/baselinker', { method: 'POST' });
        dashboard.showToast(`Zsynchronizowano ${result.orders_processed || 0} zamówień`, 'success');
        await dashboard.refreshData();
    } catch (error) {
        dashboard.showToast('Błąd synchronizacji z Baselinker', 'error');
    } finally {
        dashboard.hideLoading();
    }
};

window.refreshWorkstations = function() {
    const dashboard = ProductionDashboard.instance;
    if (dashboard) {
        dashboard.refreshWorkstationStatus();
    }
};

window.viewWorkstationDetails = function(workstationId) {
    window.location.href = `/production/worker?workstation_id=${workstationId}`;
};

window.markAllAlertsRead = async function() {
    const dashboard = ProductionDashboard.instance;
    if (!dashboard) return;

    if (confirm('Czy na pewno chcesz oznaczyć wszystkie alerty jako przeczytane?')) {
        try {
            await dashboard.apiCall('/alerts/mark-all-read', { method: 'POST' });
            dashboard.showToast('Wszystkie alerty oznaczone jako przeczytane', 'success');
            await dashboard.refreshAlerts();
        } catch (error) {
            dashboard.showToast('Błąd oznaczania alertów', 'error');
        }
    }
};

// CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { opacity: 0; transform: translateX(100%); }
        to { opacity: 1; transform: translateX(0); }
    }
    
    @keyframes slideOutRight {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(100%); }
    }
    
    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
    
    .workstation-active {
        border-color: var(--production-primary) !important;
        box-shadow: 0 0 0 2px rgba(237, 107, 36, 0.2) !important;
    }
    
    .toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
`;
document.head.appendChild(style);

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (typeof ProductionDashboard !== 'undefined') {
        ProductionDashboard.instance = new ProductionDashboard();
        // Note: init() will be called from the HTML template
    }
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProductionDashboard;
}