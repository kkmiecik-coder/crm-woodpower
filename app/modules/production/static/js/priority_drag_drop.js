/**
 * Priority Drag & Drop JavaScript
 * Wood Power CRM - Production Module
 * Handles drag & drop priority management with SortableJS
 */

class PriorityDragDrop {
    constructor() {
        this.config = {
            apiEndpoint: '/production/api',
            autoSaveDelay: 2000, // 2 seconds delay before auto-save
            maxRetries: 3,
            retryDelay: 1000,
            animationDuration: 300
        };
        
        this.state = {
            originalOrder: new Map(),
            currentOrder: new Map(),
            hasChanges: false,
            isLoading: false,
            isSaving: false,
            sortableInstances: [],
            selectedSpecies: null,
            draggedElement: null,
            changeTimer: null
        };
        
        this.elements = {
            saveBtn: null,
            resetBtn: null,
            changesInfo: null,
            changesText: null,
            speciesFilter: null,
            urgencyFilter: null
        };
        
        console.log('[PriorityDragDrop] Initialized');
    }

    /**
     * Initialize priority management
     */
    init() {
        console.log('[PriorityDragDrop] Starting initialization...');
        
        try {
            this.cacheElements();
            this.initializeSortable();
            this.bindEvents();
            this.saveOriginalOrder();
            this.setupKeyboardShortcuts();
            
            console.log('[PriorityDragDrop] Initialization complete');
        } catch (error) {
            console.error('[PriorityDragDrop] Initialization failed:', error);
            this.showError('Błąd inicjalizacji zarządzania priorytetami');
        }
    }

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            saveBtn: document.getElementById('saveBtn'),
            resetBtn: document.getElementById('resetBtn'),
            changesInfo: document.getElementById('changesInfo'),
            changesText: document.getElementById('changesText'),
            speciesFilter: document.getElementById('speciesFilter'),
            urgencyFilter: document.getElementById('urgencyFilter'),
            sortableContainers: document.querySelectorAll('.sortable-container')
        };
        
        // Validate required elements
        if (!this.elements.saveBtn || !this.elements.resetBtn) {
            throw new Error('Required elements not found');
        }
    }

    /**
     * Initialize SortableJS for all containers
     */
    initializeSortable() {
        this.elements.sortableContainers.forEach((container, index) => {
            try {
                const sortable = Sortable.create(container, {
                    group: {
                        name: 'shared',
                        pull: true,
                        put: true
                    },
                    animation: this.config.animationDuration,
                    handle: '.drag-handle',
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    dragClass: 'sortable-drag',
                    forceFallback: true,
                    fallbackClass: 'sortable-fallback',
                    fallbackOnBody: true,
                    swapThreshold: 0.65,
                    
                    onStart: (evt) => this.handleDragStart(evt),
                    onEnd: (evt) => this.handleDragEnd(evt),
                    onMove: (evt) => this.handleDragMove(evt),
                    onUpdate: (evt) => this.handleDragUpdate(evt),
                    onAdd: (evt) => this.handleDragAdd(evt),
                    onRemove: (evt) => this.handleDragRemove(evt)
                });
                
                this.state.sortableInstances.push({
                    instance: sortable,
                    container: container,
                    species: container.dataset.species
                });
                
                console.log(`[PriorityDragDrop] Initialized sortable for ${container.dataset.species}`);
                
            } catch (error) {
                console.error(`[PriorityDragDrop] Failed to initialize sortable for container ${index}:`, error);
            }
        });
        
        if (this.state.sortableInstances.length === 0) {
            throw new Error('No sortable instances created');
        }
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // Save and reset buttons
        if (this.elements.saveBtn) {
            this.elements.saveBtn.addEventListener('click', () => this.saveChanges());
        }
        
        if (this.elements.resetBtn) {
            this.elements.resetBtn.addEventListener('click', () => this.resetChanges());
        }
        
        // Filter handlers
        if (this.elements.speciesFilter) {
            this.elements.speciesFilter.addEventListener('change', () => this.applyFilters());
        }
        
        if (this.elements.urgencyFilter) {
            this.elements.urgencyFilter.addEventListener('change', () => this.applyFilters());
        }
        
        // Prevent accidental page leave
        window.addEventListener('beforeunload', (e) => {
            if (this.state.hasChanges && !this.state.isSaving) {
                e.preventDefault();
                e.returnValue = 'Masz niezapisane zmiany. Czy na pewno chcesz opuścić stronę?';
                return e.returnValue;
            }
        });
        
        // Global error handler
        window.addEventListener('error', (event) => {
            console.error('[PriorityDragDrop] Global error:', event.error);
        });
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+S to save
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                if (this.state.hasChanges) {
                    this.saveChanges();
                }
            }
            
            // Ctrl+Z to reset
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                if (this.state.hasChanges) {
                    this.resetChanges();
                }
            }
            
            // Escape to clear filters
            if (e.key === 'Escape') {
                this.clearFilters();
            }
        });
    }

    /**
     * Save original order for comparison
     */
    saveOriginalOrder() {
        this.state.originalOrder.clear();
        this.state.currentOrder.clear();
        
        document.querySelectorAll('.priority-task-card').forEach((card, globalIndex) => {
            const taskId = parseInt(card.dataset.taskId);
            const priority = parseInt(card.dataset.priority);
            const species = card.dataset.species;
            const container = card.closest('.sortable-container');
            const localIndex = Array.from(container.children).indexOf(card);
            
            const taskData = {
                taskId,
                priority,
                species,
                globalIndex,
                localIndex,
                container: container.dataset.species
            };
            
            this.state.originalOrder.set(taskId, { ...taskData });
            this.state.currentOrder.set(taskId, { ...taskData });
        });
        
        console.log(`[PriorityDragDrop] Saved original order for ${this.state.originalOrder.size} tasks`);
    }

    /**
     * Handle drag start
     */
    handleDragStart(evt) {
        this.state.draggedElement = evt.item;
        document.body.classList.add('dragging');
        
        // Add visual feedback
        evt.item.classList.add('dragging-item');
        
        // Store original position
        evt.item.dataset.originalIndex = evt.oldIndex;
        evt.item.dataset.originalContainer = evt.from.dataset.species;
        
        console.log('[PriorityDragDrop] Drag started:', {
            taskId: evt.item.dataset.taskId,
            from: evt.from.dataset.species,
            index: evt.oldIndex
        });
    }

    /**
     * Handle drag end
     */
    handleDragEnd(evt) {
        document.body.classList.remove('dragging');
        
        if (this.state.draggedElement) {
            this.state.draggedElement.classList.remove('dragging-item');
            this.state.draggedElement = null;
        }
        
        console.log('[PriorityDragDrop] Drag ended:', {
            taskId: evt.item.dataset.taskId,
            to: evt.to.dataset.species,
            newIndex: evt.newIndex
        });
        
        // Update order and check for changes
        this.updateCurrentOrder();
        this.detectChanges();
    }

    /**
     * Handle drag move (validation)
     */
    handleDragMove(evt) {
        // Allow all moves by default
        // Can add validation logic here if needed
        return true;
    }

    /**
     * Handle drag update (same container)
     */
    handleDragUpdate(evt) {
        this.updatePriorityNumbers();
        console.log('[PriorityDragDrop] Item moved within container');
    }

    /**
     * Handle drag add (item added to container)
     */
    handleDragAdd(evt) {
        this.updatePriorityNumbers();
        console.log('[PriorityDragDrop] Item added to container:', evt.to.dataset.species);
    }

    /**
     * Handle drag remove (item removed from container)
     */
    handleDragRemove(evt) {
        this.updatePriorityNumbers();
        console.log('[PriorityDragDrop] Item removed from container:', evt.from.dataset.species);
    }

    /**
     * Update current order state
     */
    updateCurrentOrder() {
        this.state.currentOrder.clear();
        
        let globalIndex = 0;
        
        // Process all containers in order
        this.state.sortableInstances.forEach(({ container }) => {
            const cards = container.querySelectorAll('.priority-task-card');
            
            cards.forEach((card, localIndex) => {
                const taskId = parseInt(card.dataset.taskId);
                const species = container.dataset.species;
                
                this.state.currentOrder.set(taskId, {
                    taskId,
                    species,
                    globalIndex: globalIndex++,
                    localIndex,
                    container: species
                });
            });
        });
        
        console.log(`[PriorityDragDrop] Updated current order for ${this.state.currentOrder.size} tasks`);
    }

    /**
     * Update priority numbers in UI
     */
    updatePriorityNumbers() {
        this.state.sortableInstances.forEach(({ container }) => {
            const cards = container.querySelectorAll('.priority-task-card');
            
            cards.forEach((card, index) => {
                const priorityBadge = card.querySelector('.priority-badge');
                if (priorityBadge) {
                    priorityBadge.textContent = index + 1;
                }
            });
        });
    }

    /**
     * Detect changes and update UI
     */
    detectChanges() {
        this.state.hasChanges = false;
        let changeCount = 0;
        
        // Compare current order with original
        for (const [taskId, currentData] of this.state.currentOrder) {
            const originalData = this.state.originalOrder.get(taskId);
            
            if (!originalData || 
                originalData.globalIndex !== currentData.globalIndex ||
                originalData.container !== currentData.container) {
                this.state.hasChanges = true;
                changeCount++;
            }
        }
        
        // Update UI
        this.updateChangeIndicators(changeCount);
        
        // Auto-save after delay if enabled
        if (this.state.hasChanges && this.config.autoSaveDelay > 0) {
            this.scheduleAutoSave();
        }
        
        console.log(`[PriorityDragDrop] Changes detected: ${changeCount} tasks changed`);
    }

    /**
     * Update change indicators in UI
     */
    updateChangeIndicators(changeCount) {
        // Update buttons
        if (this.elements.saveBtn) {
            this.elements.saveBtn.disabled = !this.state.hasChanges;
            this.elements.saveBtn.classList.toggle('btn-primary', this.state.hasChanges);
            this.elements.saveBtn.classList.toggle('btn-outline', !this.state.hasChanges);
        }
        
        if (this.elements.resetBtn) {
            this.elements.resetBtn.disabled = !this.state.hasChanges;
        }
        
        // Update changes info
        if (this.elements.changesInfo) {
            if (this.state.hasChanges) {
                this.elements.changesInfo.style.display = 'flex';
                if (this.elements.changesText) {
                    this.elements.changesText.textContent = 
                        `Zmieniono kolejność ${changeCount} zadań`;
                }
            } else {
                this.elements.changesInfo.style.display = 'none';
            }
        }
        
        // Visual feedback on changed cards
        this.highlightChangedTasks();
    }

    /**
     * Highlight tasks that have changed position
     */
    highlightChangedTasks() {
        document.querySelectorAll('.priority-task-card').forEach(card => {
            const taskId = parseInt(card.dataset.taskId);
            const currentData = this.state.currentOrder.get(taskId);
            const originalData = this.state.originalOrder.get(taskId);
            
            if (currentData && originalData &&
                (currentData.globalIndex !== originalData.globalIndex ||
                 currentData.container !== originalData.container)) {
                card.classList.add('task-changed');
            } else {
                card.classList.remove('task-changed');
            }
        });
    }

    /**
     * Schedule auto-save
     */
    scheduleAutoSave() {
        if (this.state.changeTimer) {
            clearTimeout(this.state.changeTimer);
        }
        
        this.state.changeTimer = setTimeout(() => {
            if (this.state.hasChanges && !this.state.isSaving) {
                console.log('[PriorityDragDrop] Auto-saving changes...');
                this.saveChanges(true);
            }
        }, this.config.autoSaveDelay);
    }

    /**
     * Save changes to server
     */
    async saveChanges(isAutoSave = false) {
        if (!this.state.hasChanges || this.state.isSaving) {
            return;
        }
        
        this.state.isSaving = true;
        
        try {
            this.showLoading('Zapisywanie zmian...');
            
            // Prepare task priorities data
            const taskPriorities = [];
            let priority = 10; // Start with 10, increment by 10
            
            for (const [taskId, data] of this.state.currentOrder) {
                taskPriorities.push({
                    task_id: taskId,
                    priority: priority
                });
                priority += 10;
            }
            
            // Send to server
            const response = await this.apiCall('/priorities/update', {
                method: 'POST',
                body: JSON.stringify({ task_priorities: taskPriorities })
            });
            
            if (response.success) {
                // Update original order to current
                this.state.originalOrder.clear();
                for (const [taskId, data] of this.state.currentOrder) {
                    this.state.originalOrder.set(taskId, { ...data });
                }
                
                this.state.hasChanges = false;
                this.updateChangeIndicators(0);
                
                const message = isAutoSave ? 
                    'Zmiany zostały automatycznie zapisane' : 
                    'Kolejność zadań została zaktualizowana';
                    
                this.showToast(message, 'success');
                
                console.log(`[PriorityDragDrop] Successfully saved ${taskPriorities.length} task priorities`);
                
            } else {
                throw new Error(response.error || 'Server returned error');
            }
            
        } catch (error) {
            console.error('[PriorityDragDrop] Save failed:', error);
            this.showError('Błąd zapisywania zmian');
            
            // Revert on error if auto-save
            if (isAutoSave) {
                this.resetChanges();
            }
            
        } finally {
            this.state.isSaving = false;
            this.hideLoading();
        }
    }

    /**
     * Reset changes to original order
     */
    resetChanges() {
        if (!this.state.hasChanges) {
            return;
        }
        
        if (!confirm('Czy na pewno chcesz cofnąć wszystkie zmiany?')) {
            return;
        }
        
        try {
            this.showLoading('Przywracanie zmian...');
            
            // Group tasks by their original containers
            const tasksByContainer = new Map();
            
            for (const [taskId, originalData] of this.state.originalOrder) {
                const container = originalData.container;
                if (!tasksByContainer.has(container)) {
                    tasksByContainer.set(container, []);
                }
                tasksByContainer.get(container).push({
                    taskId,
                    localIndex: originalData.localIndex,
                    element: document.querySelector(`[data-task-id="${taskId}"]`)
                });
            }
            
            // Restore original order in each container
            for (const [containerSpecies, tasks] of tasksByContainer) {
                const container = document.querySelector(`[data-species="${containerSpecies}"]`);
                if (!container) continue;
                
                // Sort tasks by original local index
                tasks.sort((a, b) => a.localIndex - b.localIndex);
                
                // Reorder elements
                tasks.forEach(({ element }) => {
                    if (element && element.parentNode !== container) {
                        container.appendChild(element);
                    }
                });
                
                // Sort within container
                const sortableInstance = this.state.sortableInstances.find(
                    s => s.container === container
                )?.instance;
                
                if (sortableInstance) {
                    sortableInstance.sort(tasks.map(t => t.element));
                }
            }
            
            // Update state
            this.updateCurrentOrder();
            this.updatePriorityNumbers();
            this.state.hasChanges = false;
            this.updateChangeIndicators(0);
            
            this.showToast('Przywrócono oryginalną kolejność', 'info');
            
            console.log('[PriorityDragDrop] Successfully reset changes');
            
        } catch (error) {
            console.error('[PriorityDragDrop] Reset failed:', error);
            this.showError('Błąd przywracania zmian');
            
            // Fallback: reload page
            setTimeout(() => {
                window.location.reload();
            }, 2000);
            
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Apply filters
     */
    applyFilters() {
        const speciesFilter = this.elements.speciesFilter?.value || '';
        const urgencyFilter = this.elements.urgencyFilter?.value || '';
        
        // Filter species groups
        document.querySelectorAll('.species-group').forEach(group => {
            const species = group.dataset.species;
            const shouldShow = !speciesFilter || species === speciesFilter;
            group.style.display = shouldShow ? 'block' : 'none';
        });
        
        // Filter urgency
        if (urgencyFilter) {
            document.querySelectorAll('.priority-task-card').forEach(card => {
                const isUrgent = card.dataset.urgent === 'true';
                let shouldShow = true;
                
                if (urgencyFilter === 'urgent' && !isUrgent) {
                    shouldShow = false;
                } else if (urgencyFilter === 'normal' && isUrgent) {
                    shouldShow = false;
                }
                
                card.style.display = shouldShow ? 'flex' : 'none';
            });
        } else {
            // Show all cards
            document.querySelectorAll('.priority-task-card').forEach(card => {
                card.style.display = 'flex';
            });
        }
        
        console.log('[PriorityDragDrop] Applied filters:', { speciesFilter, urgencyFilter });
    }

    /**
     * Clear all filters
     */
    clearFilters() {
        if (this.elements.speciesFilter) {
            this.elements.speciesFilter.value = '';
        }
        
        if (this.elements.urgencyFilter) {
            this.elements.urgencyFilter.value = '';
        }
        
        this.applyFilters();
        this.showToast('Filtry zostały wyczyszczone', 'info');
    }

    /**
     * Move task to top of its container
     */
    moveToTop(taskId) {
        const card = document.querySelector(`[data-task-id="${taskId}"]`);
        if (!card) return;
        
        const container = card.closest('.sortable-container');
        if (!container) return;
        
        // Move to first position
        container.insertBefore(card, container.firstChild);
        
        this.updateCurrentOrder();
        this.updatePriorityNumbers();
        this.detectChanges();
        
        // Visual feedback
        card.classList.add('task-moved');
        setTimeout(() => card.classList.remove('task-moved'), 1000);
        
        this.showToast('Zadanie przeniesione na górę', 'success');
    }

    /**
     * Move task to bottom of its container
     */
    moveToBottom(taskId) {
        const card = document.querySelector(`[data-task-id="${taskId}"]`);
        if (!card) return;
        
        const container = card.closest('.sortable-container');
        if (!container) return;
        
        // Move to last position
        container.appendChild(card);
        
        this.updateCurrentOrder();
        this.updatePriorityNumbers();
        this.detectChanges();
        
        // Visual feedback
        card.classList.add('task-moved');
        setTimeout(() => card.classList.remove('task-moved'), 1000);
        
        this.showToast('Zadanie przeniesione na dół', 'success');
    }

    /**
     * Auto-optimize priorities
     */
    async autoOptimize() {
        if (!confirm('Czy na pewno chcesz automatycznie zoptymalizować kolejność? Bieżące zmiany zostaną utracone.')) {
            return;
        }
        
        try {
            this.showLoading('Optymalizacja kolejności...');
            
            const response = await this.apiCall('/reorganize-queue', {
                method: 'POST'
            });
            
            if (response.success) {
                this.showToast('Kolejność została zoptymalizowana', 'success');
                
                // Reload page to show new order
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
                
            } else {
                throw new Error(response.error || 'Optimization failed');
            }
            
        } catch (error) {
            console.error('[PriorityDragDrop] Auto-optimize failed:', error);
            this.showError('Błąd optymalizacji kolejności');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Toggle group visibility
     */
    toggleGroup(species) {
        const content = document.getElementById(`group-${species}`);
        const toggle = document.querySelector(`[onclick*="toggleGroup('${species}')"] .group-toggle`);
        
        if (!content || !toggle) return;
        
        const isVisible = content.style.display !== 'none';
        
        content.style.display = isVisible ? 'none' : 'block';
        toggle.style.transform = isVisible ? 'rotate(-90deg)' : 'rotate(0deg)';
        
        // Store preference in localStorage
        try {
            const preferences = JSON.parse(localStorage.getItem('priority_groups') || '{}');
            preferences[species] = !isVisible;
            localStorage.setItem('priority_groups', JSON.stringify(preferences));
        } catch (error) {
            console.warn('Failed to save group preference:', error);
        }
    }

    /**
     * Expand all groups
     */
    expandAllGroups() {
        document.querySelectorAll('.group-content').forEach(content => {
            content.style.display = 'block';
        });
        
        document.querySelectorAll('.group-toggle').forEach(toggle => {
            toggle.style.transform = 'rotate(0deg)';
        });
        
        this.showToast('Rozwinięto wszystkie grupy', 'info');
    }

    /**
     * Collapse all groups
     */
    collapseAllGroups() {
        document.querySelectorAll('.group-content').forEach(content => {
            content.style.display = 'none';
        });
        
        document.querySelectorAll('.group-toggle').forEach(toggle => {
            toggle.style.transform = 'rotate(-90deg)';
        });
        
        this.showToast('Zwinięto wszystkie grupy', 'info');
    }

    /**
     * API call with error handling
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
                console.warn(`[PriorityDragDrop] API call failed (attempt ${attempt}):`, error);
                
                if (attempt === this.config.maxRetries) {
                    throw error;
                }
                
                await this.delay(this.config.retryDelay * attempt);
            }
        }
    }

    /**
     * Show loading overlay
     */
    showLoading(message = 'Przetwarzanie...') {
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
        // Implementation similar to other modules
        console.log(`[PriorityDragDrop] Toast [${type}]: ${message}`);
        
        // Create toast if toast system is available
        if (typeof ProductionDashboard !== 'undefined' && ProductionDashboard.instance) {
            ProductionDashboard.instance.showToast(message, type, duration);
        }
    }

    /**
     * Show error message
     */
    showError(message) {
        this.showToast(message, 'error', 5000);
        console.error('[PriorityDragDrop] Error:', message);
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
        // Clear timers
        if (this.state.changeTimer) {
            clearTimeout(this.state.changeTimer);
        }
        
        // Destroy sortable instances
        this.state.sortableInstances.forEach(({ instance }) => {
            if (instance && typeof instance.destroy === 'function') {
                instance.destroy();
            }
        });
        
        this.state.sortableInstances = [];
        
        console.log('[PriorityDragDrop] Destroyed');
    }
}

// Global functions for HTML event handlers
window.moveToTop = function(taskId) {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.moveToTop(taskId);
    }
};

window.moveToBottom = function(taskId) {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.moveToBottom(taskId);
    }
};

window.autoOptimize = function() {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.autoOptimize();
    }
};

window.toggleGroup = function(species) {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.toggleGroup(species);
    }
};

window.expandAllGroups = function() {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.expandAllGroups();
    }
};

window.collapseAllGroups = function() {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.collapseAllGroups();
    }
};

window.applyFilters = function() {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.applyFilters();
    }
};

window.clearFilters = function() {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.clearFilters();
    }
};

window.saveChanges = function() {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.saveChanges();
    }
};

window.resetChanges = function() {
    if (PriorityDragDrop.instance) {
        PriorityDragDrop.instance.resetChanges();
    }
};

// CSS for drag & drop visual feedback
const style = document.createElement('style');
style.textContent = `
    /* Drag & Drop States */
    .dragging {
        cursor: grabbing !important;
    }
    
    .dragging * {
        cursor: grabbing !important;
    }
    
    .dragging-item {
        opacity: 0.8;
        transform: rotate(3deg);
        z-index: 1000;
    }
    
    .sortable-ghost {
        opacity: 0.4;
        background: var(--production-primary-light) !important;
        border: 2px dashed var(--production-primary) !important;
    }
    
    .sortable-chosen {
        box-shadow: 0 8px 24px rgba(237, 107, 36, 0.3) !important;
    }
    
    .sortable-drag {
        opacity: 1 !important;
        transform: rotate(3deg) !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3) !important;
    }
    
    .sortable-fallback {
        opacity: 0.8;
        background: white;
        border: 2px solid var(--production-primary);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    }
    
    /* Task Change Indicators */
    .task-changed {
        border-left: 4px solid var(--production-primary) !important;
        background: rgba(237, 107, 36, 0.05) !important;
        animation: highlightChange 2s ease-out;
    }
    
    .task-moved {
        animation: taskMoved 1s ease-out;
    }
    
    @keyframes highlightChange {
        0% {
            background: rgba(237, 107, 36, 0.2) !important;
            transform: scale(1.02);
        }
        100% {
            background: rgba(237, 107, 36, 0.05) !important;
            transform: scale(1);
        }
    }
    
    @keyframes taskMoved {
        0% {
            background: var(--production-primary-light);
            transform: translateX(-5px);
        }
        50% {
            background: var(--production-primary-light);
            transform: translateX(5px);
        }
        100% {
            background: transparent;
            transform: translateX(0);
        }
    }
    
    /* Drag Handle */
    .drag-handle {
        cursor: grab;
        color: var(--gray-400);
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s ease;
    }
    
    .drag-handle:hover {
        color: var(--production-primary);
        background: var(--production-primary-light);
    }
    
    .drag-handle:active {
        cursor: grabbing;
    }
    
    /* Priority Badge */
    .priority-badge {
        transition: all 0.3s ease;
    }
    
    .task-changed .priority-badge {
        background: var(--production-primary) !important;
        color: white !important;
        animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
        0%, 100% {
            transform: scale(1);
        }
        50% {
            transform: scale(1.1);
        }
    }
    
    /* Changes Info Bar */
    .changes-info {
        background: linear-gradient(135deg, var(--production-primary-light), rgba(255, 230, 217, 0.8));
        border: 1px solid var(--production-primary);
        border-radius: 8px;
        padding: 12px 20px;
        margin-bottom: 20px;
        display: none;
        align-items: center;
        gap: 15px;
        animation: slideDown 0.3s ease-out;
    }
    
    .changes-content {
        display: flex;
        align-items: center;
        gap: 15px;
        flex: 1;
    }
    
    .changes-content i {
        color: var(--production-primary);
        font-size: 18px;
    }
    
    .changes-content span {
        color: var(--production-primary-dark);
        font-weight: 600;
        font-size: 14px;
    }
    
    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateY(-20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    /* Group Toggle */
    .group-toggle {
        transition: transform 0.3s ease;
    }
    
    .group-header {
        cursor: pointer;
        transition: background 0.2s ease;
    }
    
    .group-header:hover {
        background: rgba(237, 107, 36, 0.05);
    }
    
    /* Filter Indicators */
    .filter-active {
        background: var(--production-primary-light) !important;
        border-color: var(--production-primary) !important;
    }
    
    /* Button States */
    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
    }
    
    .btn-primary:not(:disabled) {
        animation: readyToSave 2s ease-in-out infinite;
    }
    
    @keyframes readyToSave {
        0%, 100% {
            box-shadow: 0 4px 8px rgba(237, 107, 36, 0.2);
        }
        50% {
            box-shadow: 0 6px 16px rgba(237, 107, 36, 0.4);
        }
    }
    
    /* Sortable Container */
    .sortable-container {
        min-height: 100px;
        border: 2px dashed transparent;
        border-radius: 8px;
        padding: 10px;
        transition: all 0.3s ease;
    }
    
    .sortable-container.drag-over {
        border-color: var(--production-primary);
        background: var(--production-primary-light);
    }
    
    /* Empty Container */
    .sortable-container:empty::after {
        content: "Przeciągnij tutaj zadania";
        display: block;
        text-align: center;
        color: var(--gray-400);
        font-style: italic;
        padding: 40px 20px;
        border: 2px dashed var(--gray-300);
        border-radius: 8px;
        background: var(--gray-50);
    }
    
    /* Responsive adjustments */
    @media (max-width: 768px) {
        .drag-handle {
            padding: 8px;
        }
        
        .priority-task-card {
            flex-direction: column;
            gap: 12px;
        }
        
        .task-actions {
            justify-content: center;
        }
    }
    
    /* High contrast mode */
    @media (prefers-contrast: high) {
        .sortable-ghost {
            border-width: 3px !important;
        }
        
        .task-changed {
            border-left-width: 6px !important;
        }
        
        .drag-handle:hover {
            outline: 2px solid var(--production-primary);
        }
    }
    
    /* Reduced motion */
    @media (prefers-reduced-motion: reduce) {
        .task-changed,
        .task-moved,
        .priority-badge,
        .group-toggle,
        .changes-info,
        .btn-primary {
            animation: none !important;
            transition: none !important;
        }
        
        .sortable-chosen,
        .sortable-drag {
            transform: none !important;
        }
    }
    
    /* Print styles */
    @media print {
        .drag-handle,
        .task-actions,
        .changes-info {
            display: none !important;
        }
        
        .priority-task-card {
            break-inside: avoid;
        }
    }
`;
document.head.appendChild(style);

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for SortableJS to load
    if (typeof Sortable !== 'undefined') {
        PriorityDragDrop.instance = new PriorityDragDrop();
        // init() will be called from the HTML template
    } else {
        console.error('[PriorityDragDrop] SortableJS not loaded');
    }
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PriorityDragDrop;
}