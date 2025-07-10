/**
 * Tablet Interface JavaScript
 * Wood Power CRM - Production Module
 * Optimized for 10-13" tablets on production workstations
 */

class TabletInterface {
    constructor() {
        this.config = {
            refreshInterval: 15000, // 15 seconds - more frequent for tablets
            apiEndpoint: '/production/api',
            maxRetries: 5, // More retries for tablet environment
            retryDelay: 1000,
            heartbeatInterval: 30000, // 30 seconds heartbeat
            taskUpdateDelay: 500, // Delay for task action feedback
            connectionTimeout: 10000 // 10 seconds timeout
        };
        
        this.state = {
            workstationId: null,
            tabletId: null,
            isOnline: navigator.onLine,
            lastHeartbeat: null,
            currentTaskId: null,
            isProcessing: false,
            retryCount: 0,
            tasks: [],
            currentBatch: null
        };
        
        this.timers = {
            refresh: null,
            heartbeat: null,
            connectionCheck: null
        };

        this.touchHandlers = new Map();
        this.wakeLock = null;
        
        console.log('[TabletInterface] Initialized');
    }

    /**
     * Initialize tablet interface
     */
    init(config = {}) {
        console.log('[TabletInterface] Starting initialization...');
        
        // Merge configuration
        Object.assign(this.config, config);
        this.state.workstationId = config.workstationId;
        this.state.tabletId = config.tabletId;
        
        try {
            this.setupTabletOptimizations();
            this.bindEvents();
            this.startHeartbeat();
            this.loadTasks();
            this.startAutoRefresh();
            this.requestWakeLock();
            
            console.log('[TabletInterface] Initialization complete');
        } catch (error) {
            console.error('[TabletInterface] Initialization failed:', error);
            this.showError('Błąd inicjalizacji interfejsu tabletu');
        }
    }

    /**
     * Setup tablet-specific optimizations
     */
    setupTabletOptimizations() {
        // Prevent text selection
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
        
        // Prevent zoom on input focus (iOS)
        const viewport = document.querySelector('meta[name=viewport]');
        if (viewport) {
            viewport.setAttribute('content', 
                'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'
            );
        }
        
        // Disable context menu
        document.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Prevent default touch behaviors
        document.addEventListener('touchstart', (e) => {
            if (e.target.closest('.tablet-btn, .reason-btn')) {
                // Allow touch for buttons
                return;
            }
        }, { passive: false });
        
        // Disable pull-to-refresh
        document.body.style.overscrollBehavior = 'none';
        
        console.log('[TabletInterface] Tablet optimizations applied');
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Connection status handlers
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // Page visibility handlers
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseRefresh();
            } else {
                this.resumeRefresh();
                this.immediateRefresh();
            }
        });
        
        // Touch event optimizations
        this.setupTouchOptimizations();
        
        // Error handlers
        window.addEventListener('error', (event) => {
            console.error('[TabletInterface] Global error:', event.error);
            this.handleError(event.error);
        });
        
        window.addEventListener('unhandledrejection', (event) => {
            console.error('[TabletInterface] Unhandled promise rejection:', event.reason);
            this.handleError(event.reason);
        });
    }

    /**
     * Setup touch optimizations
     */
    setupTouchOptimizations() {
        // Add touch feedback for buttons
        const buttons = document.querySelectorAll('.tablet-btn, .reason-btn, .refresh-btn');
        
        buttons.forEach(button => {
            this.addTouchFeedback(button);
        });
    }

    /**
     * Add touch feedback to element
     */
    addTouchFeedback(element) {
        const touchHandler = {
            start: (e) => {
                element.classList.add('touching');
                element.style.transform = 'scale(0.95)';
            },
            end: (e) => {
                element.classList.remove('touching');
                element.style.transform = '';
            }
        };

        element.addEventListener('touchstart', touchHandler.start, { passive: true });
        element.addEventListener('touchend', touchHandler.end, { passive: true });
        element.addEventListener('touchcancel', touchHandler.end, { passive: true });
        
        this.touchHandlers.set(element, touchHandler);
    }

    /**
     * Request wake lock to prevent screen from sleeping
     */
    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('[TabletInterface] Wake lock acquired');
                
                this.wakeLock.addEventListener('release', () => {
                    console.log('[TabletInterface] Wake lock released');
                });
            } catch (error) {
                console.warn('[TabletInterface] Wake lock failed:', error);
            }
        }
    }

    /**
     * Start heartbeat to maintain connection
     */
    startHeartbeat() {
        this.timers.heartbeat = setInterval(() => {
            this.sendHeartbeat();
        }, this.config.heartbeatInterval);
        
        // Send initial heartbeat
        this.sendHeartbeat();
    }

    /**
     * Send heartbeat to server
     */
    async sendHeartbeat() {
        try {
            const response = await this.apiCall('/tablet/heartbeat', {
                method: 'POST',
                body: JSON.stringify({
                    tablet_id: this.state.tabletId,
                    workstation_id: this.state.workstationId,
                    timestamp: new Date().toISOString()
                })
            });
            
            this.state.lastHeartbeat = new Date();
            this.updateConnectionStatus(true);
            
        } catch (error) {
            console.warn('[TabletInterface] Heartbeat failed:', error);
            this.updateConnectionStatus(false);
        }
    }

    /**
     * Load tasks for workstation
     */
    async loadTasks() {
        if (!this.state.workstationId) {
            console.warn('[TabletInterface] No workstation ID provided');
            return;
        }

        try {
            this.showLoading('Ładowanie zadań...');
            
            const response = await this.apiCall(`/workstation/${this.state.workstationId}/tasks`);
            
            this.state.tasks = response.tasks || [];
            this.updateTasksDisplay();
            
            // Update tasks count in status bar
            this.updateTasksCount(this.state.tasks.length);
            
            console.log('[TabletInterface] Tasks loaded:', this.state.tasks.length);
            
        } catch (error) {
            console.error('[TabletInterface] Failed to load tasks:', error);
            this.showError('Błąd ładowania zadań');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Update tasks display
     */
    updateTasksDisplay() {
        // Update current task
        if (this.state.tasks.length > 0) {
            this.updateCurrentTask(this.state.tasks[0]);
            this.updateNextTasks(this.state.tasks.slice(1, 6)); // Show up to 5 next tasks
        } else {
            this.showNoTasksState();
        }
    }

    /**
     * Update current task display
     */
    updateCurrentTask(task) {
        const currentTaskCard = document.querySelector('.current-task-card');
        if (!currentTaskCard) return;

        // Update task ID
        currentTaskCard.setAttribute('data-task-id', task.id);
        this.state.currentTaskId = task.id;

        // Update product name
        const productName = currentTaskCard.querySelector('.task-product h3');
        if (productName) {
            productName.textContent = task.product_name;
        }

        // Update specs
        this.updateTaskSpecs(currentTaskCard, task);
        
        // Update status
        this.updateTaskStatus(currentTaskCard, task);
        
        // Update coating requirements
        this.updateCoatingRequirements(currentTaskCard, task);
        
        // Update action buttons
        this.updateActionButtons(currentTaskCard, task);
    }

    /**
     * Update task specifications
     */
    updateTaskSpecs(container, task) {
        const specsContainer = container.querySelector('.product-specs');
        if (!specsContainer) return;

        const specs = [
            { icon: 'fas fa-ruler-combined', text: task.dimensions },
            { icon: 'fas fa-tree', text: `${task.wood_species} ${task.technology}` },
            { icon: 'fas fa-hashtag', text: `${task.quantity} szt.` }
        ];

        if (task.wood_class) {
            specs.push({ icon: 'fas fa-star', text: `Klasa ${task.wood_class}` });
        }

        specsContainer.innerHTML = specs.map(spec => `
            <span class="spec-item">
                <i class="${spec.icon}"></i>
                ${spec.text}
            </span>
        `).join('');
    }

    /**
     * Update task status
     */
    updateTaskStatus(container, task) {
        const statusContainer = container.querySelector('.task-status-display');
        if (!statusContainer) return;

        const currentProgress = this.getCurrentProgress(task);
        if (!currentProgress) return;

        let statusClass, statusIcon, statusText, statusDetails = '';

        switch (currentProgress.status) {
            case 'pending':
                statusClass = 'status-waiting';
                statusIcon = 'fas fa-clock';
                statusText = 'Oczekuje na rozpoczęcie';
                break;
            case 'in_progress':
                statusClass = 'status-active';
                statusIcon = 'fas fa-play';
                statusText = 'W trakcie realizacji';
                if (currentProgress.started_at) {
                    const startTime = new Date(currentProgress.started_at);
                    statusDetails = `<small>od ${startTime.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</small>`;
                }
                break;
            case 'completed':
                statusClass = 'status-done';
                statusIcon = 'fas fa-check';
                statusText = 'Ukończone';
                break;
            default:
                statusClass = 'status-waiting';
                statusIcon = 'fas fa-question';
                statusText = 'Nieznany status';
        }

        statusContainer.innerHTML = `
            <div class="status-indicator ${statusClass}">
                <i class="${statusIcon}"></i>
                <span>${statusText}</span>
                ${statusDetails}
            </div>
        `;
    }

    /**
     * Update coating requirements
     */
    updateCoatingRequirements(container, task) {
        const coatingContainer = container.querySelector('.coating-requirements');
        
        if (!task.needs_coating) {
            if (coatingContainer) {
                coatingContainer.style.display = 'none';
            }
            return;
        }

        if (!coatingContainer) return;

        coatingContainer.style.display = 'block';
        
        const details = [];
        if (task.coating_type) details.push(task.coating_type);
        if (task.coating_color) details.push(task.coating_color);
        if (task.coating_gloss) details.push(task.coating_gloss);

        const detailsHtml = details.map(detail => `
            <span class="coating-type">${detail}</span>
        `).join('');

        const notesHtml = task.coating_notes ? `
            <div class="coating-notes">
                <i class="fas fa-info-circle"></i>
                ${task.coating_notes}
            </div>
        ` : '';

        coatingContainer.querySelector('.coating-details').innerHTML = detailsHtml;
        
        const existingNotes = coatingContainer.querySelector('.coating-notes');
        if (existingNotes) {
            existingNotes.remove();
        }
        if (notesHtml) {
            coatingContainer.insertAdjacentHTML('beforeend', notesHtml);
        }
    }

    /**
     * Update action buttons
     */
    updateActionButtons(container, task) {
        const actionsContainer = container.querySelector('.tablet-actions');
        if (!actionsContainer) return;

        const currentProgress = this.getCurrentProgress(task);
        if (!currentProgress) return;

        let buttonsHtml = '';

        switch (currentProgress.status) {
            case 'pending':
                buttonsHtml = `
                    <button class="tablet-btn tablet-btn-start" onclick="TabletInterface.instance.startTask(${task.id})">
                        <i class="fas fa-play"></i>
                        <span>ROZPOCZNIJ</span>
                    </button>
                `;
                break;
                
            case 'in_progress':
                buttonsHtml = `
                    <button class="tablet-btn tablet-btn-complete" onclick="TabletInterface.instance.completeTask(${task.id})">
                        <i class="fas fa-check"></i>
                        <span>ZAKOŃCZ</span>
                    </button>
                    <button class="tablet-btn tablet-btn-pause" onclick="TabletInterface.instance.pauseTask(${task.id})">
                        <i class="fas fa-pause"></i>
                        <span>PAUZA</span>
                    </button>
                `;
                break;
                
            default:
                buttonsHtml = `
                    <button class="tablet-btn tablet-btn-disabled" disabled>
                        <i class="fas fa-hourglass-half"></i>
                        <span>CZEKA NA POPRZEDNI ETAP</span>
                    </button>
                `;
        }

        actionsContainer.innerHTML = buttonsHtml;
        
        // Add touch feedback to new buttons
        const newButtons = actionsContainer.querySelectorAll('.tablet-btn');
        newButtons.forEach(button => {
            if (!button.disabled) {
                this.addTouchFeedback(button);
            }
        });
    }

    /**
     * Update next tasks list
     */
    updateNextTasks(nextTasks) {
        const nextTasksList = document.querySelector('.next-tasks-list');
        if (!nextTasksList || nextTasks.length === 0) {
            const nextTasksSection = document.querySelector('.next-tasks-section');
            if (nextTasksSection) {
                nextTasksSection.style.display = 'none';
            }
            return;
        }

        const nextTasksSection = document.querySelector('.next-tasks-section');
        if (nextTasksSection) {
            nextTasksSection.style.display = 'block';
        }

        const tasksHtml = nextTasks.map((task, index) => {
            const urgencyClass = this.getTaskUrgency(task);
            const urgencyText = this.getTaskUrgencyText(task);

            return `
                <div class="next-task-item">
                    <div class="task-priority">
                        <span class="priority-number">#${index + 2}</span>
                    </div>
                    <div class="task-info">
                        <div class="task-name">${this.truncateText(task.product_name, 40)}</div>
                        <div class="task-specs">
                            ${task.dimensions} | ${task.wood_species} ${task.technology}
                            ${task.needs_coating ? ` | ${task.coating_type}` : ''}
                        </div>
                    </div>
                    <div class="task-eta">
                        <span class="${urgencyClass}">${urgencyText}</span>
                    </div>
                </div>
            `;
        }).join('');

        nextTasksList.innerHTML = tasksHtml;

        // Show "more tasks" indicator if needed
        const totalTasks = this.state.tasks.length;
        if (totalTasks > 6) {
            const moreTasksHtml = `
                <div class="more-tasks">
                    <i class="fas fa-ellipsis-h"></i>
                    <span>i ${totalTasks - 6} więcej...</span>
                </div>
            `;
            nextTasksList.insertAdjacentHTML('beforeend', moreTasksHtml);
        }
    }

    /**
     * Show no tasks state
     */
    showNoTasksState() {
        const content = document.querySelector('.tablet-content');
        if (!content) return;

        content.innerHTML = `
            <div class="no-tasks-state">
                <div class="no-tasks-content">
                    <i class="fas fa-check-circle"></i>
                    <h2>Wszystkie zadania ukończone!</h2>
                    <p>Stanowisko jest gotowe na nowe zlecenia.</p>
                    <button class="tablet-btn tablet-btn-secondary" onclick="TabletInterface.instance.refreshTasks()">
                        <i class="fas fa-sync"></i>
                        <span>SPRAWDŹ NOWE ZADANIA</span>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Get current progress for task on this workstation
     */
    getCurrentProgress(task) {
        if (!task.progress_records) return null;
        
        return task.progress_records.find(progress => 
            progress.workstation_id === this.state.workstationId
        );
    }

    /**
     * Get task urgency class
     */
    getTaskUrgency(task) {
        if (!task.estimated_completion_date) return 'eta-normal';
        
        const deadline = new Date(task.estimated_completion_date);
        const now = new Date();
        const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
        
        if (daysLeft < 0) return 'eta-urgent';
        if (daysLeft === 0) return 'eta-today';
        if (daysLeft === 1) return 'eta-urgent';
        return 'eta-normal';
    }

    /**
     * Get task urgency text
     */
    getTaskUrgencyText(task) {
        if (!task.estimated_completion_date) return '';
        
        const deadline = new Date(task.estimated_completion_date);
        const now = new Date();
        const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
        
        if (daysLeft < 0) return 'Pilne!';
        if (daysLeft === 0) return 'Dzisiaj';
        if (daysLeft === 1) return 'Jutro';
        return `${daysLeft}d`;
    }

    /**
     * Start task
     */
    async startTask(taskId) {
        if (this.state.isProcessing) return;
        
        this.state.isProcessing = true;
        this.showLoading('Rozpoczynam zadanie...');
        
        try {
            const result = await this.executeAction('start', taskId, {
                tablet_identifier: this.state.tabletId
            });
            
            if (result.success) {
                this.showToast('Zadanie rozpoczęte!', 'success');
                await this.delay(this.config.taskUpdateDelay);
                await this.refreshTasks();
            } else {
                this.showToast(result.error || 'Błąd rozpoczęcia zadania', 'error');
            }
            
        } catch (error) {
            console.error('[TabletInterface] Start task failed:', error);
            this.showToast('Błąd rozpoczęcia zadania', 'error');
        } finally {
            this.state.isProcessing = false;
            this.hideLoading();
        }
    }

    /**
     * Complete task
     */
    async completeTask(taskId) {
        this.state.currentTaskId = taskId;
        this.showCompleteModal();
    }

    /**
     * Pause task
     */
    async pauseTask(taskId) {
        this.state.currentTaskId = taskId;
        this.showPauseModal();
    }

    /**
     * Execute task action
     */
    async executeAction(action, taskId, data = {}) {
        const response = await this.apiCall(`/task/${taskId}/${action}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        
        return response;
    }

    /**
     * Show complete modal
     */
    showCompleteModal() {
        const modal = document.getElementById('completeModal');
        if (modal) {
            modal.style.display = 'flex';
            
            // Clear previous notes
            const notesField = document.getElementById('completionNotes');
            if (notesField) {
                notesField.value = '';
            }
        }
    }

    /**
     * Show pause modal
     */
    showPauseModal() {
        const modal = document.getElementById('pauseModal');
        if (modal) {
            modal.style.display = 'flex';
            
            // Clear previous selections
            const reasonButtons = modal.querySelectorAll('.reason-btn');
            reasonButtons.forEach(btn => btn.classList.remove('selected'));
            
            const notesField = document.getElementById('pauseNotes');
            if (notesField) {
                notesField.value = '';
            }
            
            const confirmBtn = document.getElementById('confirmPauseBtn');
            if (confirmBtn) {
                confirmBtn.disabled = true;
            }
        }
    }

    /**
     * Update tasks count in status bar
     */
    updateTasksCount(count) {
        const tasksCountElement = document.getElementById('tasksInQueue');
        if (tasksCountElement) {
            tasksCountElement.textContent = `${count} zadań w kolejce`;
        }
    }

    /**
     * Update connection status
     */
    updateConnectionStatus(isConnected) {
        const statusElement = document.getElementById('connectionStatus');
        if (!statusElement) return;
        
        this.state.isOnline = isConnected;
        
        const icon = statusElement.querySelector('i');
        const text = statusElement.querySelector('span');
        
        if (isConnected) {
            statusElement.className = 'status-item connection-status connected';
            icon.className = 'fas fa-wifi';
            text.textContent = 'Połączono';
        } else {
            statusElement.className = 'status-item connection-status disconnected';
            icon.className = 'fas fa-wifi-slash';
            text.textContent = 'Brak połączenia';
        }
    }

    /**
     * Start auto-refresh
     */
    startAutoRefresh() {
        this.timers.refresh = setInterval(() => {
            if (!this.state.isProcessing) {
                this.refreshTasks();
            }
        }, this.config.refreshInterval);
        
        console.log('[TabletInterface] Auto-refresh started');
    }

    /**
     * Pause refresh
     */
    pauseRefresh() {
        if (this.timers.refresh) {
            clearInterval(this.timers.refresh);
            this.timers.refresh = null;
        }
    }

    /**
     * Resume refresh
     */
    resumeRefresh() {
        if (!this.timers.refresh) {
            this.startAutoRefresh();
        }
    }

    /**
     * Immediate refresh
     */
    async immediateRefresh() {
        if (!this.state.isProcessing) {
            await this.refreshTasks();
        }
    }

    /**
     * Refresh tasks
     */
    async refreshTasks() {
        try {
            await this.loadTasks();
        } catch (error) {
            console.warn('[TabletInterface] Refresh failed:', error);
        }
    }

    /**
     * Handle online event
     */
    handleOnline() {
        console.log('[TabletInterface] Connection restored');
        this.updateConnectionStatus(true);
        this.resumeRefresh();
        this.startHeartbeat();
        this.immediateRefresh();
        this.showToast('Połączenie przywrócone', 'success');
    }

    /**
     * Handle offline event
     */
    handleOffline() {
        console.log('[TabletInterface] Connection lost');
        this.updateConnectionStatus(false);
        this.pauseRefresh();
        this.showToast('Utracono połączenie', 'warning');
    }

    /**
     * Handle errors
     */
    handleError(error) {
        console.error('[TabletInterface] Error:', error);
        
        if (!this.state.isOnline) {
            this.showToast('Brak połączenia internetowego', 'error');
        } else {
            this.showToast('Wystąpił błąd systemu', 'error');
        }
    }

    /**
     * Check connection status
     */
    checkConnection() {
        const isOnline = navigator.onLine && this.state.lastHeartbeat && 
                         (new Date() - this.state.lastHeartbeat) < (this.config.heartbeatInterval * 2);
        
        this.updateConnectionStatus(isOnline);
        return isOnline;
    }

    /**
     * API call with tablet-specific handling
     */
    async apiCall(endpoint, options = {}) {
        const url = `${this.config.apiEndpoint}${endpoint}`;
        const defaultOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-Tablet-ID': this.state.tabletId
            },
            timeout: this.config.connectionTimeout,
            ...options
        };

        // Add retry logic for tablets
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.config.connectionTimeout);
                
                const response = await fetch(url, {
                    ...defaultOptions,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.error || 'API returned error');
                }
                
                // Reset retry count on success
                this.state.retryCount = 0;
                
                return data;
                
            } catch (error) {
                console.warn(`[TabletInterface] API call failed (attempt ${attempt}):`, error);
                
                if (attempt === this.config.maxRetries) {
                    this.state.retryCount++;
                    throw error;
                }
                
                // Progressive delay
                await this.delay(this.config.retryDelay * attempt);
            }
        }
    }

    /**
     * Show loading
     */
    showLoading(message = 'Przetwarzanie...') {
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
     * Hide loading
     */
    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info', duration = 3000) {
        // Get or create toast container
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        // Create toast
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const iconClass = {
            'success': 'fas fa-check-circle',
            'error': 'fas fa-times-circle',
            'warning': 'fas fa-exclamation-triangle',
            'info': 'fas fa-info-circle'
        }[type] || 'fas fa-info-circle';

        toast.innerHTML = `
            <i class="${iconClass}"></i>
            <span class="toast-message">${this.escapeHtml(message)}</span>
        `;

        container.appendChild(toast);

        // Auto remove
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
     * Show error
     */
    showError(message) {
        this.showToast(message, 'error', 5000);
    }

    /**
     * Utility functions
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cleanup resources
     */
    destroy() {
        // Clear timers
        Object.values(this.timers).forEach(timer => {
            if (timer) clearInterval(timer);
        });

        // Release wake lock
        if (this.wakeLock) {
            this.wakeLock.release();
        }

        // Remove touch handlers
        this.touchHandlers.forEach((handler, element) => {
            element.removeEventListener('touchstart', handler.start);
            element.removeEventListener('touchend', handler.end);
            element.removeEventListener('touchcancel', handler.end);
        });
        this.touchHandlers.clear();

        console.log('[TabletInterface] Destroyed');
    }
}

// Global functions for modal interactions
window.closeCompleteModal = function() {
    const modal = document.getElementById('completeModal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    if (TabletInterface.instance) {
        TabletInterface.instance.state.currentTaskId = null;
    }
};

window.confirmComplete = async function() {
    const instance = TabletInterface.instance;
    if (!instance || !instance.state.currentTaskId) return;

    const notes = document.getElementById('completionNotes')?.value || '';
    
    instance.state.isProcessing = true;
    instance.showLoading('Kończę zadanie...');
    
    try {
        const result = await instance.executeAction('complete', instance.state.currentTaskId, {
            tablet_identifier: instance.state.tabletId,
            notes: notes
        });
        
        window.closeCompleteModal();
        
        if (result.success) {
            instance.showToast(`Zadanie ukończone! Następny etap: ${result.next_station}`, 'success', 4000);
            await instance.delay(instance.config.taskUpdateDelay);
            await instance.refreshTasks();
        } else {
            instance.showToast(result.error || 'Błąd kończenia zadania', 'error');
        }
        
    } catch (error) {
        console.error('[TabletInterface] Complete task failed:', error);
        instance.showToast('Błąd kończenia zadania', 'error');
        window.closeCompleteModal();
    } finally {
        instance.state.isProcessing = false;
        instance.hideLoading();
    }
};

window.closePauseModal = function() {
    const modal = document.getElementById('pauseModal');
    if (modal) {
        modal.style.display = 'none';
        
        // Clear selections
        modal.querySelectorAll('.reason-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        const notesField = document.getElementById('pauseNotes');
        if (notesField) {
            notesField.value = '';
        }
    }
    
    if (TabletInterface.instance) {
        TabletInterface.instance.state.currentTaskId = null;
    }
};

window.selectPauseReason = function(reason) {
    // Remove previous selections
    document.querySelectorAll('.reason-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Select clicked reason
    const reasonBtn = document.querySelector(`[data-reason="${reason}"]`);
    if (reasonBtn) {
        reasonBtn.classList.add('selected');
    }
    
    // Enable confirm button
    const confirmBtn = document.getElementById('confirmPauseBtn');
    if (confirmBtn) {
        confirmBtn.disabled = false;
    }
    
    // Store selected reason
    if (TabletInterface.instance) {
        TabletInterface.instance.selectedPauseReason = reason;
    }
};

window.confirmPause = async function() {
    const instance = TabletInterface.instance;
    if (!instance || !instance.state.currentTaskId || !instance.selectedPauseReason) {
        return;
    }

    const notes = document.getElementById('pauseNotes')?.value || '';
    const fullReason = notes ? `${instance.selectedPauseReason}: ${notes}` : instance.selectedPauseReason;
    
    instance.state.isProcessing = true;
    instance.showLoading('Wstrzymuję zadanie...');
    
    try {
        const result = await instance.executeAction('pause', instance.state.currentTaskId, {
            tablet_identifier: instance.state.tabletId,
            reason: fullReason
        });
        
        window.closePauseModal();
        
        if (result.success) {
            instance.showToast('Zadanie wstrzymane', 'info');
            await instance.delay(instance.config.taskUpdateDelay);
            await instance.refreshTasks();
        } else {
            instance.showToast(result.error || 'Błąd wstrzymania zadania', 'error');
        }
        
    } catch (error) {
        console.error('[TabletInterface] Pause task failed:', error);
        instance.showToast('Błąd wstrzymania zadania', 'error');
        window.closePauseModal();
    } finally {
        instance.state.isProcessing = false;
        instance.hideLoading();
        instance.selectedPauseReason = null;
    }
};

// Setup reason button handlers when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Add click handlers to reason buttons
    document.querySelectorAll('.reason-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const reason = this.getAttribute('data-reason');
            if (reason) {
                window.selectPauseReason(reason);
            }
        });
    });
    
    // Add touch feedback to modal buttons
    document.querySelectorAll('.tablet-btn').forEach(btn => {
        btn.addEventListener('touchstart', function() {
            this.style.transform = 'scale(0.95)';
        }, { passive: true });
        
        btn.addEventListener('touchend', function() {
            this.style.transform = '';
        }, { passive: true });
    });
});

// Add CSS for touch feedback
const style = document.createElement('style');
style.textContent = `
    .touching {
        transform: scale(0.95) !important;
        transition: transform 0.1s ease !important;
    }
    
    .tablet-btn:active,
    .reason-btn:active {
        transform: scale(0.95) !important;
    }
    
    .toast {
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        padding: 20px 25px;
        display: flex;
        align-items: center;
        gap: 15px;
        min-width: 300px;
        border-left: 4px solid var(--tablet-primary);
        animation: slideInRight 0.3s ease;
        margin-bottom: 10px;
    }
    
    .toast.success {
        border-left-color: var(--tablet-success);
    }
    
    .toast.error {
        border-left-color: var(--tablet-danger);
    }
    
    .toast.warning {
        border-left-color: var(--tablet-warning);
    }
    
    .toast.info {
        border-left-color: var(--tablet-info);
    }
    
    .toast i {
        font-size: 20px;
        color: var(--tablet-primary);
    }
    
    .toast.success i { color: var(--tablet-success); }
    .toast.error i { color: var(--tablet-danger); }
    .toast.warning i { color: var(--tablet-warning); }
    .toast.info i { color: var(--tablet-info); }
    
    .toast-message {
        flex: 1;
        font-size: 16px;
        font-weight: 600;
        color: var(--tablet-gray-800);
    }
    
    .toast-container {
        position: fixed;
        top: 100px;
        right: 30px;
        z-index: 1100;
        display: flex;
        flex-direction: column;
        max-width: 400px;
    }
    
    @keyframes slideInRight {
        from {
            opacity: 0;
            transform: translateX(100%);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }
    
    @keyframes slideOutRight {
        from {
            opacity: 1;
            transform: translateX(0);
        }
        to {
            opacity: 0;
            transform: translateX(100%);
        }
    }
    
    /* Connection status colors */
    .connection-status.connected {
        color: var(--tablet-success) !important;
    }
    
    .connection-status.disconnected {
        color: var(--tablet-danger) !important;
    }
    
    /* Tablet-specific optimizations */
    .tablet-interface * {
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        user-select: none;
    }
    
    .tablet-interface input,
    .tablet-interface textarea {
        -webkit-user-select: text;
        user-select: text;
    }
    
    /* Prevent zoom on inputs for iOS */
    @supports (-webkit-overflow-scrolling: touch) {
        .tablet-interface input,
        .tablet-interface textarea,
        .tablet-interface select {
            font-size: 16px !important;
        }
    }
    
    /* Loading overlay for tablet */
    .tablet-loading {
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(4px);
    }
    
    .loading-content {
        background: white;
        padding: 40px;
        border-radius: 16px;
        text-align: center;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        max-width: 300px;
    }
    
    .loading-spinner i {
        font-size: 48px;
        color: var(--tablet-primary);
        margin-bottom: 20px;
        animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    
    /* High contrast mode for better visibility */
    @media (prefers-contrast: high) {
        .tablet-btn {
            border: 2px solid currentColor;
        }
        
        .status-indicator {
            border: 1px solid currentColor;
        }
    }
    
    /* Reduce motion for accessibility */
    @media (prefers-reduced-motion: reduce) {
        .tablet-btn,
        .toast,
        .loading-spinner i {
            animation: none !important;
            transition: none !important;
        }
    }
`;
document.head.appendChild(style);

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
    // TabletInterface will be initialized from the HTML template
    // with specific configuration
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TabletInterface;
}

// Global instance reference
window.TabletInterface = TabletInterface;