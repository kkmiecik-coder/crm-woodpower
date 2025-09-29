// station-cutting.js - Dedykowana logika dla stanowiska wycinania

/**
 * Initialize Cutting Station
 */
function initCuttingStation() {
    console.log('[Cutting] Initializing station...');

    // Load config
    const config = window.StationCommon.loadStationConfig();

    if (!config) {
        console.error('[Cutting] Failed to load config');
        window.StationCommon.showError('Błąd konfiguracji stanowiska');
        return;
    }

    // Attach event listeners to existing cards
    const existingCards = document.querySelectorAll('.product-card');
    existingCards.forEach(card => {
        attachCardEventListeners(card);
    });

    // Start auto-refresh
    if (config.autoRefreshEnabled) {
        window.StationCommon.startAutoRefresh(autoRefreshCallback);
        console.log(`[Cutting] Auto-refresh started (${config.refreshInterval}s)`);
    }

    console.log('[Cutting] Station initialized successfully');
}

/**
 * Auto-refresh callback
 */
async function autoRefreshCallback() {
    if (window.STATION_STATE.isRefreshing) {
        console.log('[Cutting] Refresh already in progress, skipping');
        return;
    }

    window.STATION_STATE.isRefreshing = true;

    try {
        const stationCode = window.STATION_STATE.config.stationCode;
        const data = await window.StationCommon.fetchProducts(stationCode, 'priority');

        // Smart merge - add only new cards, don't touch cards in progress
        window.StationCommon.smartMergeProducts(data.products);

        // Update stats bar
        window.StationCommon.updateStatsBar(data.stats);

        // Update last refresh time
        window.StationCommon.updateLastRefreshTime();

        console.log('[Cutting] Auto-refresh completed');
    } catch (error) {
        console.error('[Cutting] Auto-refresh failed:', error);
    } finally {
        window.STATION_STATE.isRefreshing = false;
    }
}

/**
 * Attach event listeners to a card
 * @param {HTMLElement} card - Product card element
 */
function attachCardEventListeners(card) {
    const completeBtn = card.querySelector('[data-action="complete"]');

    if (!completeBtn) {
        console.warn('[Cutting] Complete button not found in card:', card.dataset.productId);
        return;
    }

    // Remove existing listeners (prevent duplicates)
    const newBtn = completeBtn.cloneNode(true);
    completeBtn.parentNode.replaceChild(newBtn, completeBtn);

    // Add click listener
    newBtn.addEventListener('click', function () {
        const productId = card.dataset.productId;
        handleCompleteClick(card, productId);
    });
}

/**
 * Handle complete button click
 * @param {HTMLElement} card - Card element
 * @param {string} productId - Product ID
 */
function handleCompleteClick(card, productId) {
    console.log(`[Cutting] Complete clicked: ${productId}`);

    // Mark card as in progress (prevents auto-refresh from touching it)
    card.dataset.inProgress = 'true';
    card.classList.add('processing');

    // Start countdown
    startCompleteCountdown(card, productId);
}

/**
 * Start 10-second countdown before completion
 * @param {HTMLElement} card - Card element
 * @param {string} productId - Product ID
 */
function startCompleteCountdown(card, productId) {
    const completeBtn = card.querySelector('.btn-complete');
    const actionContainer = card.querySelector('.card-action');

    if (!completeBtn || !actionContainer) return;

    // Change button to processing state
    setButtonProcessing(completeBtn);

    // Create cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-cancel';
    cancelBtn.textContent = 'ANULUJ';
    cancelBtn.dataset.action = 'cancel';
    actionContainer.appendChild(cancelBtn);

    // Countdown state
    let secondsLeft = 10;

    // Update button text
    const updateCountdown = () => {
        completeBtn.innerHTML = `
      <span class="spinner"></span>
      KOŃCZENIE... ${secondsLeft}s
    `;
    };

    updateCountdown();

    // Start countdown timer
    const timerId = setInterval(() => {
        secondsLeft--;

        if (secondsLeft > 0) {
            updateCountdown();
        } else {
            // Countdown finished
            clearInterval(timerId);
            window.STATION_STATE.countdownTimers.delete(productId);

            // Remove cancel button
            cancelBtn.remove();

            // Execute completion
            onCountdownComplete(card, productId);
        }
    }, 1000);

    // Store timer ID
    window.STATION_STATE.countdownTimers.set(productId, timerId);

    // Cancel button listener
    cancelBtn.addEventListener('click', () => {
        cancelCountdown(card, productId, timerId);
    });
}

/**
 * Cancel countdown and reset card
 * @param {HTMLElement} card - Card element
 * @param {string} productId - Product ID
 * @param {number} timerId - Timer ID
 */
function cancelCountdown(card, productId, timerId) {
    console.log(`[Cutting] Countdown cancelled: ${productId}`);

    // Clear timer
    clearInterval(timerId);
    window.STATION_STATE.countdownTimers.delete(productId);

    // Reset card state
    card.dataset.inProgress = 'false';
    card.classList.remove('processing');

    // Reset button
    const completeBtn = card.querySelector('.btn-complete');
    setButtonInitial(completeBtn);

    // Remove cancel button
    const cancelBtn = card.querySelector('.btn-cancel');
    if (cancelBtn) {
        cancelBtn.remove();
    }
}

/**
 * Execute task completion after countdown
 * @param {HTMLElement} card - Card element
 * @param {string} productId - Product ID
 */
async function onCountdownComplete(card, productId) {
    console.log(`[Cutting] Completing task: ${productId}`);

    const completeBtn = card.querySelector('.btn-complete');
    const stationCode = window.STATION_STATE.config.stationCode;

    try {
        // Call API
        const response = await window.StationCommon.completeTask(productId, stationCode);

        console.log(`[Cutting] Task completed successfully: ${productId}`);

        // Show success state (1 second)
        setButtonSuccess(completeBtn);

        // Wait 1 second, then remove card
        setTimeout(() => {
            window.StationCommon.removeProductCard(productId);

            // Update stats (approximate - will be corrected on next refresh)
            updateStatsAfterCompletion();
        }, 1000);

    } catch (error) {
        console.error(`[Cutting] Failed to complete task: ${productId}`, error);
        window.StationCommon.showError(`Nie udało się ukończyć zadania: ${error.message}`);

        // Reset card on error
        card.dataset.inProgress = 'false';
        card.classList.remove('processing');
        setButtonInitial(completeBtn);
    }
}

/**
 * Update stats after completion (approximate)
 */
function updateStatsAfterCompletion() {
    const totalElement = document.getElementById('total-products');
    if (totalElement) {
        const current = parseInt(totalElement.textContent) || 0;
        if (current > 0) {
            totalElement.textContent = current - 1;
        }
    }
}

/**
 * Set button to processing state (orange, countdown)
 * @param {HTMLElement} button - Button element
 */
function setButtonProcessing(button) {
    if (!button) return;
    button.classList.add('processing');
    button.classList.remove('success');
}

/**
 * Set button to success state (green, checkmark)
 * @param {HTMLElement} button - Button element
 */
function setButtonSuccess(button) {
    if (!button) return;
    button.classList.remove('processing');
    button.classList.add('success');
    button.innerHTML = 'ZAKOŃCZONO ✓';
}

/**
 * Set button to initial state (blue, ready)
 * @param {HTMLElement} button - Button element
 */
function setButtonInitial(button) {
    if (!button) return;
    button.classList.remove('processing', 'success');
    button.textContent = 'ZAKOŃCZ';
}

/**
 * Override attachCardEventListeners in common
 */
window.StationCommon.attachCardEventListeners = attachCardEventListeners;

/**
 * Initialize on DOM ready
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCuttingStation);
} else {
    initCuttingStation();
}

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
    console.log('[Cutting] Cleaning up...');
    window.StationCommon.stopAutoRefresh();

    // Clear all countdown timers
    window.STATION_STATE.countdownTimers.forEach((timerId, productId) => {
        clearInterval(timerId);
        console.log(`[Cutting] Cleared timer for ${productId}`);
    });
    window.STATION_STATE.countdownTimers.clear();
});

/**
 * Debug helpers (only if debug mode enabled)
 */
if (window.STATION_STATE.config?.debugMode) {
    window.CuttingDebug = {
        getState: () => window.STATION_STATE,
        triggerRefresh: autoRefreshCallback,
        simulateComplete: (productId) => {
            const card = document.querySelector(`[data-product-id="${productId}"]`);
            if (card) {
                handleCompleteClick(card, productId);
            }
        },
        cancelAll: () => {
            window.STATION_STATE.countdownTimers.forEach((timerId, productId) => {
                const card = document.querySelector(`[data-product-id="${productId}"]`);
                if (card) {
                    cancelCountdown(card, productId, timerId);
                }
            });
        }
    };

    console.log('[Cutting] Debug mode enabled. Access via window.CuttingDebug');
}