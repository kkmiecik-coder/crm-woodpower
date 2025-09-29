// station-common.js - Wspólne utility functions dla wszystkich stanowisk
// Wersja: 2.0 - Kompletna implementacja bez TODO

/**
 * Global State Management
 */
window.STATION_STATE = {
    config: null,
    stationCode: null,
    products: [],
    activeFilters: {},
    countdownTimers: new Map(), // productId -> timerId
    lastRefreshTime: null,
    isRefreshing: false,
    refreshIntervalId: null,
    refreshTimerIntervalId: null
};

/**
 * Load station configuration from embedded script
 */
function loadStationConfig() {
    try {
        const configElement = document.getElementById('station-config');
        if (!configElement) {
            throw new Error('Config element not found');
        }

        const config = JSON.parse(configElement.textContent);
        window.STATION_STATE.config = config;
        window.STATION_STATE.stationCode = config.stationCode;

        console.log('[Station] Config loaded:', config);
        return config;
    } catch (error) {
        console.error('[Station] Failed to load config:', error);
        // Fallback config
        const fallbackConfig = {
            stationCode: 'cutting',
            refreshInterval: 30,
            autoRefreshEnabled: true,
            debugMode: false,
            apiBaseUrl: '/production/api',
            ajaxBaseUrl: '/production/stations/ajax'
        };
        window.STATION_STATE.config = fallbackConfig;
        return fallbackConfig;
    }
}

/**
 * Get refresh interval in milliseconds
 */
function getRefreshInterval() {
    const config = window.STATION_STATE.config;
    return (config?.refreshInterval || 30) * 1000;
}

/**
 * Fetch products for current station
 * @param {string} stationCode - Station code (cutting, assembly, packaging)
 * @param {string} sortBy - Sort parameter (priority, deadline, created_at)
 * @returns {Promise<Object>} Response with products and stats
 */
async function fetchProducts(stationCode, sortBy = 'priority') {
    try {
        const config = window.STATION_STATE.config;
        const url = `${config.ajaxBaseUrl}/products/${stationCode}?sort=${sortBy}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Unknown error');
        }

        return data.data;
    } catch (error) {
        console.error('[Station] Failed to fetch products:', error);
        throw error;
    }
}

/**
 * Complete a task (cut, assemble, package)
 * @param {string} productId - Product ID
 * @param {string} stationCode - Station code
 * @returns {Promise<Object>} Response
 */
async function completeTask(productId, stationCode) {
    try {
        const config = window.STATION_STATE.config;
        const url = `${config.apiBaseUrl}/complete-task`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                product_id: productId,
                station_code: stationCode
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Task completion failed');
        }

        return data;
    } catch (error) {
        console.error('[Station] Failed to complete task:', error);
        throw error;
    }
}

/**
 * Start auto-refresh mechanism
 * @param {Function} callback - Function to call on each refresh
 */
function startAutoRefresh(callback) {
    const config = window.STATION_STATE.config;

    if (!config.autoRefreshEnabled) {
        console.log('[Station] Auto-refresh disabled');
        return;
    }

    const interval = getRefreshInterval();
    console.log(`[Station] Starting auto-refresh (${interval / 1000}s interval)`);

    // Clear existing interval if any
    if (window.STATION_STATE.refreshIntervalId) {
        clearInterval(window.STATION_STATE.refreshIntervalId);
    }

    // Set new interval
    window.STATION_STATE.refreshIntervalId = setInterval(() => {
        console.log('[Station] Auto-refresh triggered');
        callback();
    }, interval);

    // Start countdown timer (shows time until next refresh)
    startRefreshCountdownTimer();
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh() {
    if (window.STATION_STATE.refreshIntervalId) {
        clearInterval(window.STATION_STATE.refreshIntervalId);
        window.STATION_STATE.refreshIntervalId = null;
        console.log('[Station] Auto-refresh stopped');
    }

    if (window.STATION_STATE.refreshTimerIntervalId) {
        clearInterval(window.STATION_STATE.refreshTimerIntervalId);
        window.STATION_STATE.refreshTimerIntervalId = null;
    }
}

/**
 * Start refresh countdown timer (counts DOWN, not up)
 * Shows "Odświeżanie za: Xs" instead of "Xs temu"
 */
function startRefreshCountdownTimer() {
    const refreshInterval = getRefreshInterval();
    window.STATION_STATE.lastRefreshTime = Date.now();

    // Clear existing timer
    if (window.STATION_STATE.refreshTimerIntervalId) {
        clearInterval(window.STATION_STATE.refreshTimerIntervalId);
    }

    // Update every second
    window.STATION_STATE.refreshTimerIntervalId = setInterval(() => {
        const elapsed = Date.now() - window.STATION_STATE.lastRefreshTime;
        const secondsUntilNext = Math.max(0, Math.floor((refreshInterval - elapsed) / 1000));

        const refreshElement = document.getElementById('last-refresh');
        if (refreshElement) {
            if (secondsUntilNext === 0) {
                refreshElement.textContent = 'Odświeżanie...';
            } else {
                refreshElement.textContent = `${secondsUntilNext}s`;
            }
        }
    }, 1000);
}

/**
 * Smart merge algorithm - add only new cards, update existing
 * @param {Array} newProducts - Fresh products from API
 */
function smartMergeProducts(newProducts) {
    const grid = document.getElementById('products-grid');
    
    if (!grid) {
        console.warn('[Station] Products grid not found');
        return;
    }

    // Get existing cards
    const existingCards = Array.from(grid.querySelectorAll('.product-card'));
    const existingIds = existingCards.map(card => card.dataset.productId);

    console.log(`[Station] Smart merge: ${existingIds.length} existing, ${newProducts.length} new`);

    // Find NEW products (not in DOM)
    const toAdd = newProducts.filter(p => !existingIds.includes(p.id));

    // ✅ DODANE: Ukryj empty state jeśli dodajemy nowe karty
    if (toAdd.length > 0) {
        const emptyState = grid.querySelector('.empty-state');
        if (emptyState) {
            emptyState.style.display = 'none';
            console.log('[Station] Hidden empty state');
        }
    }

    // Add new cards
    toAdd.forEach(product => {
        const cardHTML = createProductCard(product);
        grid.insertAdjacentHTML('beforeend', cardHTML);

        // Attach event listeners to new card
        const newCard = grid.querySelector(`[data-product-id="${product.id}"]`);
        if (newCard) {
            attachCardEventListeners(newCard);
        }
    });

    // Update priority_rank for existing cards if changed
    newProducts.forEach(product => {
        const existingCard = grid.querySelector(`[data-product-id="${product.id}"]`);

        if (existingCard) {
            // Don't touch cards in progress
            if (existingCard.dataset.inProgress === 'true') {
                console.log(`[Station] Skipping card in progress: ${product.id}`);
                return;
            }

            const currentRank = parseInt(existingCard.dataset.priorityRank);
            if (currentRank !== product.priority_rank) {
                console.log(`[Station] Updating priority: ${product.id} ${currentRank} -> ${product.priority_rank}`);
                updateCardPriority(existingCard, product);
            }
        }
    });

    // ✅ DODANE: Pokaż empty state jeśli usunięto wszystkie karty
    if (newProducts.length === 0 && existingCards.length > 0) {
        const emptyState = grid.querySelector('.empty-state');
        if (emptyState) {
            // Usuń wszystkie karty produktów
            existingCards.forEach(card => card.remove());
            emptyState.style.display = 'block';
            console.log('[Station] Showed empty state - no products');
        }
    }

    if (toAdd.length > 0) {
        console.log(`[Station] Added ${toAdd.length} new cards`);
        showToast(`Dodano ${toAdd.length} nowych produktów`, 'info');
    }
}

/**
 * Create HTML for a product card
 * @param {Object} product - Product data
 * @returns {string} HTML string
 */
function createProductCard(product) {
    // Priority badge class
    const priorityClass = getPriorityClass(product.priority_rank);

    // Badges HTML
    const speciesBadge = product.wood_species
        ? `<span class="badge badge-species" data-badge="species">${escapeHtml(product.wood_species)}</span>`
        : '';
    const techBadge = product.technology
        ? `<span class="badge badge-technology" data-badge="technology">${escapeHtml(product.technology)}</span>`
        : '';
    const classBadge = product.wood_class
        ? `<span class="badge badge-class" data-badge="wood_class">${escapeHtml(product.wood_class)}</span>`
        : '';

    return `
    <div class="product-card" 
         data-product-id="${escapeHtml(product.id)}"
         data-priority-rank="${product.priority_rank}"
         data-in-progress="false"
         data-species="${escapeHtml(product.wood_species || '')}"
         data-technology="${escapeHtml(product.technology || '')}"
         data-wood-class="${escapeHtml(product.wood_class || '')}">
      
      <div class="card-header">
        <div class="priority-badge ${priorityClass}">
          #${product.priority_rank} ${escapeHtml(product.priority_label)}
        </div>
        <div class="product-id">ID: ${escapeHtml(product.id)}</div>
      </div>
      
      <div class="card-body">
        <div class="product-name">${escapeHtml(product.original_name)}</div>
        <div class="dimensions-badge-large">${escapeHtml(product.dimensions)}</div>
        <div class="product-badges">
          ${speciesBadge}
          ${techBadge}
          ${classBadge}
        </div>
      </div>
      
      <div class="card-footer">
        <div class="footer-info">
          <span class="deadline-info">📅 ${escapeHtml(product.display_deadline)}</span>
          <span class="volume-info">${product.volume_m3.toFixed(4)} m³</span>
        </div>
      </div>
      
      <div class="card-action">
        <button class="btn btn-complete" data-action="complete">
          ZAKOŃCZ
        </button>
      </div>
    </div>
  `;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Get priority CSS class from rank
 * @param {number} rank - Priority rank
 * @returns {string} CSS class name
 */
function getPriorityClass(rank) {
    if (rank <= 10) return 'priority-critical';
    if (rank <= 50) return 'priority-high';
    if (rank <= 100) return 'priority-normal';
    return 'priority-low';
}

/**
 * Update card priority display
 * @param {HTMLElement} card - Card element
 * @param {Object} product - Updated product data
 */
function updateCardPriority(card, product) {
    const priorityBadge = card.querySelector('.priority-badge');
    if (!priorityBadge) return;

    // Update class
    priorityBadge.className = `priority-badge ${getPriorityClass(product.priority_rank)}`;

    // Update text
    priorityBadge.textContent = `#${product.priority_rank} ${product.priority_label}`;

    // Update dataset
    card.dataset.priorityRank = product.priority_rank;
}

/**
 * Remove product card from DOM with animation
 * @param {string} productId - Product ID
 */
function removeProductCard(productId) {
    const card = document.querySelector(`[data-product-id="${productId}"]`);
    if (card) {
        card.classList.add('removing');
        setTimeout(() => {
            card.remove();
            console.log(`[Station] Removed card: ${productId}`);
        }, 300); // Match animation duration in CSS
    }
}

/**
 * Update stats bar with new data
 * @param {Object} stats - Stats object
 * @param {Array} products - Products array (optional, for calculating total_volume)
 */
function updateStatsBar(stats, products = null) {
    const totalElement = document.getElementById('total-products');
    const volumeElement = document.getElementById('total-volume');
    const criticalElement = document.getElementById('critical-count');
    const overdueElement = document.getElementById('overdue-count');

    if (totalElement) totalElement.textContent = stats.total_products || 0;

    // ✅ POPRAWKA: Zawsze licz volume z kart w DOM (rzeczywisty stan)
    if (volumeElement) {
        const cardsInDOM = document.querySelectorAll('.product-card');
        let totalVolume = 0;
        
        cardsInDOM.forEach(card => {
            const volumeSpan = card.querySelector('.volume-info');
            if (volumeSpan) {
                // Wyciągnij liczbę z tekstu "0.0264 m³"
                const volumeText = volumeSpan.textContent.trim();
                const volumeMatch = volumeText.match(/[\d.]+/);
                if (volumeMatch) {
                    totalVolume += parseFloat(volumeMatch[0]);
                }
            }
        });
        
        volumeElement.textContent = totalVolume.toFixed(4);
        console.log(`[Station] Calculated volume from ${cardsInDOM.length} cards: ${totalVolume.toFixed(4)} m³`);
    }

    if (criticalElement) criticalElement.textContent = stats.high_priority_count || 0;
    if (overdueElement) overdueElement.textContent = stats.overdue_count || 0;
}

/**
 * Update last refresh timestamp (resets countdown)
 */
function updateLastRefreshTime() {
    window.STATION_STATE.lastRefreshTime = Date.now();
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (default: 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
    // Remove existing toasts
    const existingToasts = document.querySelectorAll('.toast-notification');
    existingToasts.forEach(toast => toast.remove());

    // Create toast container if it doesn't exist
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 400px;
    `;
        document.body.appendChild(container);
    }

    // Create toast
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.style.cssText = `
    padding: 16px 20px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideIn 0.3s ease-out;
    cursor: pointer;
  `;

    // Type-specific styles
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8'
    };
    toast.style.background = colors[type] || colors.info;

    // Icon based on type
    const icons = {
        success: '✓',
        error: '✗',
        warning: '⚠',
        info: 'ℹ'
    };
    const icon = icons[type] || icons.info;

    toast.innerHTML = `<span style="margin-right: 8px; font-weight: bold;">${icon}</span>${escapeHtml(message)}`;

    // Add animation keyframes if not exists
    if (!document.getElementById('toast-animations')) {
        const style = document.createElement('style');
        style.id = 'toast-animations';
        style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
        document.head.appendChild(style);
    }

    container.appendChild(toast);

    // Click to dismiss
    toast.addEventListener('click', () => {
        toast.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    });

    // Auto-dismiss
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}

/**
 * Show success notification
 * @param {string} message - Message to display
 */
function showSuccess(message) {
    console.log(`[Station] Success: ${message}`);
    showToast(message, 'success');
}

/**
 * Show error notification
 * @param {string} message - Error message
 */
function showError(message) {
    console.error(`[Station] Error: ${message}`);
    showToast(message, 'error', 5000); // Longer duration for errors
}

/**
 * Show warning notification
 * @param {string} message - Warning message
 */
function showWarning(message) {
    console.warn(`[Station] Warning: ${message}`);
    showToast(message, 'warning');
}

/**
 * Show info notification
 * @param {string} message - Info message
 */
function showInfo(message) {
    console.log(`[Station] Info: ${message}`);
    showToast(message, 'info');
}

/**
 * Attach event listeners - to be overridden by station-specific files
 * @param {HTMLElement} card - Card element
 */
function attachCardEventListeners(card) {
    console.warn('[Station] attachCardEventListeners not implemented - use station-specific JS');
}

/**
 * Format date for display
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(dateString) {
    if (!dateString) return 'Brak daty';

    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);

    const diffTime = date - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        return `⚠️ ${Math.abs(diffDays)} dni temu`;
    } else if (diffDays === 0) {
        return '🔥 Dziś!';
    } else if (diffDays === 1) {
        return '⚡ Jutro';
    } else if (diffDays <= 7) {
        return `📅 Za ${diffDays} dni`;
    } else {
        return `📅 ${date.toLocaleDateString('pl-PL')}`;
    }
}

/**
 * Validate product data
 * @param {Object} product - Product object
 * @returns {boolean} True if valid
 */
function validateProduct(product) {
    if (!product) return false;
    if (!product.id) return false;
    if (typeof product.priority_rank !== 'number') return false;
    if (!product.original_name) return false;
    return true;
}

/**
 * Get all cards currently in DOM
 * @returns {Array<HTMLElement>} Array of card elements
 */
function getAllCards() {
    return Array.from(document.querySelectorAll('.product-card'));
}

/**
 * Get card by product ID
 * @param {string} productId - Product ID
 * @returns {HTMLElement|null} Card element or null
 */
function getCardById(productId) {
    return document.querySelector(`[data-product-id="${productId}"]`);
}

/**
 * Check if network is online
 * @returns {boolean} True if online
 */
function isOnline() {
    return navigator.onLine;
}

// Export functions to global scope
window.StationCommon = {
    loadStationConfig,
    getRefreshInterval,
    fetchProducts,
    completeTask,
    startAutoRefresh,
    stopAutoRefresh,
    smartMergeProducts,
    createProductCard,
    getPriorityClass,
    updateCardPriority,
    removeProductCard,
    updateStatsBar,
    updateLastRefreshTime,
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    attachCardEventListeners,
    formatDate,
    validateProduct,
    escapeHtml,
    getAllCards,
    getCardById,
    isOnline
};

// Monitor network status
window.addEventListener('online', () => {
    showInfo('Połączenie przywrócone');
    console.log('[Station] Network: Online');
});

window.addEventListener('offline', () => {
    showWarning('Brak połączenia z siecią');
    console.log('[Station] Network: Offline');
});

console.log('[Station] Common utilities loaded');