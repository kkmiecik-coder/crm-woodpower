// station-packaging.js - Dedykowana logika dla stanowiska pakowania
// Wersja: 2.0 - Kompletna implementacja z checkboxami i localStorage

/**
 * LocalStorage key prefix for checkbox states
 */
const STORAGE_PREFIX = 'packaging_order_';

/**
 * Initialize Packaging Station
 */
function initPackagingStation() {
    console.log('[Packaging] Initializing station...');

    // Load config
    const config = window.StationCommon.loadStationConfig();

    if (!config) {
        console.error('[Packaging] Failed to load config');
        window.StationCommon.showError('Błąd konfiguracji stanowiska');
        return;
    }

    // Check if orders list exists
    const ordersList = document.getElementById('orders-list');
    if (!ordersList) {
        console.warn('[Packaging] No orders list found - probably empty state');
    } else {
        // Attach event listeners to existing order cards
        const existingCards = document.querySelectorAll('.order-card');
        console.log(`[Packaging] Attaching listeners to ${existingCards.length} existing order cards`);
        existingCards.forEach(card => {
            attachOrderCardListeners(card);
        });
    }

    // Start auto-refresh
    if (config.autoRefreshEnabled) {
        window.StationCommon.startAutoRefresh(autoRefreshCallback);
        console.log(`[Packaging] Auto-refresh started (${config.refreshInterval}s interval)`);
    } else {
        console.log('[Packaging] Auto-refresh disabled in config');
    }

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Setup visibility change handler
    document.addEventListener('visibilitychange', handleVisibilityChange);

    console.log('[Packaging] Station initialized successfully');
    window.StationCommon.showInfo('Stanowisko pakowania gotowe do pracy');
}

/**
 * Auto-refresh callback
 */
async function autoRefreshCallback() {
    if (window.STATION_STATE.isRefreshing) {
        console.log('[Packaging] Refresh already in progress, skipping');
        return;
    }

    if (!window.StationCommon.isOnline()) {
        console.warn('[Packaging] Offline - skipping refresh');
        window.StationCommon.showWarning('Brak połączenia - pominięto odświeżanie');
        return;
    }

    window.STATION_STATE.isRefreshing = true;

    try {
        const stationCode = window.STATION_STATE.config.stationCode;
        console.log(`[Packaging] Fetching products for station: ${stationCode}`);

        const data = await window.StationCommon.fetchProducts(stationCode, 'priority');

        if (!data || !data.products) {
            throw new Error('Invalid response data');
        }

        console.log(`[Packaging] Received ${data.products.length} products`);

        // Update stats bar (count orders, not products)
        if (data.stats) {
            updatePackagingStats(data);
        }

        // Update last refresh time
        window.StationCommon.updateLastRefreshTime();

        console.log('[Packaging] Auto-refresh completed successfully');
    } catch (error) {
        console.error('[Packaging] Auto-refresh failed:', error);
        window.StationCommon.showError(`Błąd odświeżania: ${error.message}`);
    } finally {
        window.STATION_STATE.isRefreshing = false;
    }
}

/**
 * Update packaging-specific stats (orders, not products)
 */
function updatePackagingStats(data) {
    // Group products by order to count orders
    const orderNumbers = new Set();
    data.products.forEach(product => {
        if (product.internal_order_number) {
            orderNumbers.add(product.internal_order_number);
        }
    });

    const totalOrders = orderNumbers.size;
    const totalVolume = data.products.reduce((sum, p) => sum + (p.volume_m3 || 0), 0);

    const totalElement = document.getElementById('total-orders');
    const volumeElement = document.getElementById('total-volume');
    const criticalElement = document.getElementById('critical-count');
    const overdueElement = document.getElementById('overdue-count');

    if (totalElement) totalElement.textContent = totalOrders;
    if (volumeElement) volumeElement.textContent = totalVolume.toFixed(4);
    if (criticalElement) criticalElement.textContent = data.stats.high_priority_count || 0;
    if (overdueElement) overdueElement.textContent = data.stats.overdue_count || 0;
}

/**
 * Attach event listeners to order card
 */
function attachOrderCardListeners(card) {
    if (!card) {
        console.warn('[Packaging] Cannot attach listeners to null card');
        return;
    }

    const orderNumber = card.dataset.orderNumber;
    console.log(`[Packaging] Attaching listeners to order: ${orderNumber}`);

    // Get all checkboxes in this order
    const checkboxes = card.querySelectorAll('.product-check');
    const packageBtn = card.querySelector('.btn-package');

    if (!packageBtn) {
        console.warn(`[Packaging] Package button not found in order: ${orderNumber}`);
        return;
    }

    // Load saved checkbox states from localStorage
    loadCheckboxStates(orderNumber, checkboxes);

    // Attach checkbox change listeners
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function () {
            // POPRAWKA: Pobieraj aktualny przycisk z DOM
            const currentBtn = card.querySelector('.btn-package');
            handleCheckboxChange(orderNumber, card, checkboxes, currentBtn);
        });
    });

    // Attach package button listener
    packageBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        handlePackageClick(card, orderNumber);
    });

    // Initial button state check
    updatePackageButtonState(card, checkboxes, packageBtn);
}

/**
 * Load checkbox states from localStorage
 */
function loadCheckboxStates(orderNumber, checkboxes) {
    const storageKey = STORAGE_PREFIX + orderNumber;
    const savedStates = localStorage.getItem(storageKey);

    if (!savedStates) {
        console.log(`[Packaging] No saved states for order: ${orderNumber}`);
        return;
    }

    try {
        const states = JSON.parse(savedStates);
        console.log(`[Packaging] Loading saved states for order: ${orderNumber}`, states);

        checkboxes.forEach(checkbox => {
            const productId = checkbox.dataset.productId;
            if (states[productId] !== undefined && !checkbox.disabled) {
                checkbox.checked = states[productId];
            }
        });
    } catch (error) {
        console.error(`[Packaging] Failed to load states for ${orderNumber}:`, error);
    }
}

/**
 * Save checkbox states to localStorage
 */
function saveCheckboxStates(orderNumber, checkboxes) {
    const storageKey = STORAGE_PREFIX + orderNumber;
    const states = {};

    checkboxes.forEach(checkbox => {
        const productId = checkbox.dataset.productId;
        // Only save enabled checkboxes
        if (!checkbox.disabled) {
            states[productId] = checkbox.checked;
        }
    });

    try {
        localStorage.setItem(storageKey, JSON.stringify(states));
        console.log(`[Packaging] Saved states for order: ${orderNumber}`, states);
    } catch (error) {
        console.error(`[Packaging] Failed to save states for ${orderNumber}:`, error);
    }
}

/**
 * Handle checkbox change
 */
function handleCheckboxChange(orderNumber, card, checkboxes, packageBtn) {
    console.log(`[Packaging] Checkbox changed in order: ${orderNumber}`);

    // Save states to localStorage
    saveCheckboxStates(orderNumber, checkboxes);

    // Update button state
    updatePackageButtonState(card, checkboxes, packageBtn);
}

/**
 * Update package button state (enabled/disabled)
 */
function updatePackageButtonState(card, checkboxes, packageBtn) {
    // Check if any product is not ready (disabled checkbox)
    const hasNotReady = Array.from(checkboxes).some(cb => cb.disabled);

    // Check if all enabled checkboxes are checked
    const allEnabledChecked = Array.from(checkboxes)
        .filter(cb => !cb.disabled)
        .every(cb => cb.checked);

    // Button is enabled ONLY when:
    // 1. All products are ready (no disabled checkboxes)
    // 2. All enabled checkboxes are checked
    const shouldEnable = !hasNotReady && allEnabledChecked;

    // KRYTYCZNE: Zmień atrybut disabled
    if (shouldEnable) {
        packageBtn.removeAttribute('disabled');
        packageBtn.disabled = false;
    } else {
        packageBtn.setAttribute('disabled', 'disabled');
        packageBtn.disabled = true;
    }

    console.log(`[Packaging] Button state: hasNotReady=${hasNotReady}, allChecked=${allEnabledChecked}, enabled=${shouldEnable}, disabled=${packageBtn.disabled}`);
}

/**
 * Handle package button click
 */
function handlePackageClick(card, orderNumber) {
    console.log(`[Packaging] Package clicked: ${orderNumber}`);

    // Check if already in progress
    if (card.dataset.inProgress === 'true') {
        console.warn(`[Packaging] Order already in progress: ${orderNumber}`);
        return;
    }

    // Validate card state
    if (!card || !card.parentElement) {
        console.error(`[Packaging] Invalid card state: ${orderNumber}`);
        return;
    }

    // Mark card as in progress
    card.dataset.inProgress = 'true';

    // Start countdown
    startPackageCountdown(card, orderNumber);
}

/**
 * Start 10-second countdown before packaging
 */
function startPackageCountdown(card, orderNumber) {
    const packageBtn = card.querySelector('.btn-package');

    if (!packageBtn) {
        console.error(`[Packaging] Missing button for ${orderNumber}`);
        return;
    }

    // Change button to processing state
    setButtonProcessing(packageBtn);

    // Countdown state
    let secondsLeft = 10;
    let timerId = null;

    // Update button text
    const updateCountdown = () => {
        if (!packageBtn || !packageBtn.parentElement) {
            console.warn(`[Packaging] Button removed during countdown: ${orderNumber}`);
            if (timerId) clearInterval(timerId);
            return;
        }

        packageBtn.innerHTML = `
      <span class="spinner"></span>
      KOŃCZENIE... ${secondsLeft}s
    `;
    };

    updateCountdown();

    // Start countdown timer
    timerId = setInterval(() => {
        secondsLeft--;

        if (secondsLeft > 0) {
            updateCountdown();
        } else {
            // Countdown finished
            clearInterval(timerId);
            window.STATION_STATE.countdownTimers.delete(orderNumber);

            // Execute completion
            onCountdownComplete(card, orderNumber);
        }
    }, 1000);

    // Store timer ID
    window.STATION_STATE.countdownTimers.set(orderNumber, timerId);

    console.log(`[Packaging] Countdown started for ${orderNumber} (10s)`);
}

/**
 * Execute order packaging after countdown
 */
async function onCountdownComplete(card, orderNumber) {
    console.log(`[Packaging] Completing order: ${orderNumber}`);

    const packageBtn = card.querySelector('.btn-package');

    // Validate card still exists
    if (!card || !card.parentElement) {
        console.error(`[Packaging] Card removed during countdown: ${orderNumber}`);
        return;
    }

    try {
        // Show processing state
        if (packageBtn) {
            packageBtn.innerHTML = '<span class="spinner"></span> ZAPISYWANIE...';
        }

        // Collect checked product IDs
        const checkboxes = card.querySelectorAll('.product-check:not(:disabled):checked');
        const completedProducts = Array.from(checkboxes).map(cb => ({
            product_id: cb.dataset.productId,
            confirmed: true
        }));

        console.log(`[Packaging] Completing ${completedProducts.length} products`, completedProducts);

        // Call API
        const response = await completePackaging(orderNumber, completedProducts);

        console.log(`[Packaging] Order completed successfully: ${orderNumber}`, response);

        // Show success state (1 second)
        if (packageBtn) {
            setButtonSuccess(packageBtn);
        }

        // Success notification
        window.StationCommon.showSuccess(`Zamówienie ${orderNumber} spakowane`);

        // Clear localStorage for this order
        const storageKey = STORAGE_PREFIX + orderNumber;
        localStorage.removeItem(storageKey);
        console.log(`[Packaging] Cleared localStorage for ${orderNumber}`);

        // Wait 1 second, then remove card
        setTimeout(() => {
            if (card && card.parentElement) {
                card.classList.add('removing');
                setTimeout(() => {
                    card.remove();
                    console.log(`[Packaging] Removed card: ${orderNumber}`);

                    // Update stats
                    updateStatsAfterCompletion();

                    // Check if empty
                    const remainingCards = document.querySelectorAll('.order-card');
                    if (remainingCards.length === 0) {
                        showEmptyState();
                    }
                }, 300);
            }
        }, 1000);

    } catch (error) {
        console.error(`[Packaging] Failed to complete order: ${orderNumber}`, error);

        const errorMessage = error.message || 'Nieznany błąd';
        window.StationCommon.showError(`Nie udało się spakować: ${errorMessage}`);

        // Reset card on error
        if (card && card.parentElement) {
            card.dataset.inProgress = 'false';

            if (packageBtn) {
                setButtonInitial(packageBtn);
            }
        }
    }
}

/**
 * Complete packaging API call
 */
async function completePackaging(orderNumber, completedProducts) {
    try {
        const config = window.STATION_STATE.config;
        const url = `${config.apiBaseUrl}/complete-packaging`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                internal_order_number: orderNumber,
                completed_products: completedProducts
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Packaging completion failed');
        }

        return data;
    } catch (error) {
        console.error('[Packaging] API call failed:', error);
        throw error;
    }
}

/**
 * Update stats after completion
 */
function updateStatsAfterCompletion() {
    const totalElement = document.getElementById('total-orders');
    if (totalElement) {
        const current = parseInt(totalElement.textContent) || 0;
        if (current > 0) {
            totalElement.textContent = current - 1;
        }
    }
}

/**
 * Show empty state
 */
function showEmptyState() {
    const ordersList = document.getElementById('orders-list');
    if (!ordersList) return;

    ordersList.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">✅</div>
      <h2>Brak zamówień do zapakowania</h2>
      <p>Świetna robota! Wszystkie zamówienia zostały spakowane.</p>
    </div>
  `;
}

/**
 * Set button to processing state
 */
function setButtonProcessing(button) {
    if (!button) return;
    button.classList.add('processing');
    button.classList.remove('success');
    button.disabled = true;
}

/**
 * Set button to success state
 */
function setButtonSuccess(button) {
    if (!button) return;
    button.classList.remove('processing');
    button.classList.add('success');
    button.innerHTML = 'SPAKOWANO ✓';
    button.disabled = true;
}

/**
 * Set button to initial state
 */
function setButtonInitial(button) {
    if (!button) return;
    button.classList.remove('processing', 'success');
    button.textContent = 'SPAKOWANE';
    button.disabled = false;
}

/**
 * Setup keyboard shortcuts
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
        // Debug shortcut: Ctrl+Shift+D
        if (event.ctrlKey && event.shiftKey && event.key === 'D') {
            toggleDebugMode();
        }

        // Clear localStorage: Ctrl+Shift+C
        if (event.ctrlKey && event.shiftKey && event.key === 'C') {
            clearAllCheckboxStates();
        }
    });
}

/**
 * Clear all checkbox states from localStorage
 */
function clearAllCheckboxStates() {
    const keys = Object.keys(localStorage).filter(key => key.startsWith(STORAGE_PREFIX));
    keys.forEach(key => localStorage.removeItem(key));
    console.log(`[Packaging] Cleared ${keys.length} localStorage entries`);
    window.StationCommon.showInfo('Wyczyszczono zapisane stany checkboxów');
    location.reload();
}

/**
 * Toggle debug mode
 */
function toggleDebugMode() {
    const debugBtn = document.getElementById('debug-toggle');
    if (debugBtn) {
        debugBtn.style.display = debugBtn.style.display === 'none' ? 'block' : 'none';
    }

    console.log('[Packaging] Debug mode toggled');
    console.log('State:', window.STATION_STATE);
    console.log('LocalStorage:', Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX)));
    window.StationCommon.showInfo('Debug mode toggled (check console)');
}

/**
 * Handle visibility change
 */
function handleVisibilityChange() {
    if (document.hidden) {
        console.log('[Packaging] Tab hidden');
    } else {
        console.log('[Packaging] Tab visible');
        if (window.STATION_STATE.config?.autoRefreshEnabled) {
            setTimeout(autoRefreshCallback, 1000);
        }
    }
}

/**
 * Initialize on DOM ready
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPackagingStation);
} else {
    initPackagingStation();
}

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
    console.log('[Packaging] Cleaning up...');
    window.StationCommon.stopAutoRefresh();

    window.STATION_STATE.countdownTimers.forEach((timerId, orderNumber) => {
        clearInterval(timerId);
        console.log(`[Packaging] Cleared timer for ${orderNumber}`);
    });
    window.STATION_STATE.countdownTimers.clear();
});

/**
 * Debug helpers
 */
window.PackagingDebug = {
    getState: () => window.STATION_STATE,
    getConfig: () => window.STATION_STATE.config,
    triggerRefresh: autoRefreshCallback,
    listOrders: () => {
        const cards = document.querySelectorAll('.order-card');
        console.table(Array.from(cards).map(c => ({
            order: c.dataset.orderNumber,
            priority: c.dataset.priorityRank,
            products: c.dataset.totalProducts,
            inProgress: c.dataset.inProgress
        })));
    },
    getCheckboxStates: (orderNumber) => {
        const key = STORAGE_PREFIX + orderNumber;
        return JSON.parse(localStorage.getItem(key) || '{}');
    },
    clearAllStates: clearAllCheckboxStates,
    simulatePackage: (orderNumber) => {
        const card = document.querySelector(`[data-order-number="${orderNumber}"]`);
        if (card) {
            handlePackageClick(card, orderNumber);
        } else {
            console.error(`Order not found: ${orderNumber}`);
        }
    }
};

console.log('[Packaging] Station module loaded');
console.log('[Packaging] Debug commands available via window.PackagingDebug');