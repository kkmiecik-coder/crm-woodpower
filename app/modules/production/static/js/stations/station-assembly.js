// station-assembly.js - Dedykowana logika dla stanowiska składania
// Wersja: 2.0 - Kompletna implementacja

/**
 * Initialize Assembly Station
 */
function initAssemblyStation() {
    console.log('[Assembly] Initializing station...');

    // Load config
    const config = window.StationCommon.loadStationConfig();

    if (!config) {
        console.error('[Assembly] Failed to load config');
        window.StationCommon.showError('Błąd konfiguracji stanowiska');
        return;
    }

    // Check if products grid exists
    const grid = document.getElementById('products-grid');
    if (!grid) {
        console.warn('[Assembly] No products grid found - probably empty state');
    } else {
        // Attach event listeners to existing cards
        const existingCards = document.querySelectorAll('.product-card');
        console.log(`[Assembly] Attaching listeners to ${existingCards.length} existing cards`);
        existingCards.forEach(card => {
            attachCardEventListeners(card);
        });
    }

    // Start auto-refresh
    if (config.autoRefreshEnabled) {
        window.StationCommon.startAutoRefresh(autoRefreshCallback);
        console.log(`[Assembly] Auto-refresh started (${config.refreshInterval}s interval)`);
    } else {
        console.log('[Assembly] Auto-refresh disabled in config');
    }

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Setup visibility change handler (pause/resume when tab not active)
    document.addEventListener('visibilitychange', handleVisibilityChange);

    console.log('[Assembly] Station initialized successfully');
    window.StationCommon.showInfo('Stanowisko składania gotowe do pracy');
}

/**
 * Auto-refresh callback
 */
async function autoRefreshCallback() {
    // Check if already refreshing
    if (window.STATION_STATE.isRefreshing) {
        console.log('[Assembly] Refresh already in progress, skipping');
        return;
    }

    // Check network status
    if (!window.StationCommon.isOnline()) {
        console.warn('[Assembly] Offline - skipping refresh');
        window.StationCommon.showWarning('Brak połączenia - pominięto odświeżanie');
        return;
    }

    window.STATION_STATE.isRefreshing = true;

    try {
        const stationCode = window.STATION_STATE.config.stationCode;
        console.log(`[Assembly] Fetching products for station: ${stationCode}`);

        const data = await window.StationCommon.fetchProducts(stationCode, 'priority');

        // Validate data
        if (!data || !data.products) {
            throw new Error('Invalid response data');
        }

        console.log(`[Assembly] Received ${data.products.length} products`);

        // Smart merge - add only new cards, don't touch cards in progress
        window.StationCommon.smartMergeProducts(data.products);

        // Update stats bar (pass products for volume calculation)
        if (data.stats) {
            window.StationCommon.updateStatsBar(data.stats, data.products);
        }

        // Update last refresh time (resets countdown)
        window.StationCommon.updateLastRefreshTime();

        console.log('[Assembly] Auto-refresh completed successfully');
    } catch (error) {
        console.error('[Assembly] Auto-refresh failed:', error);
        window.StationCommon.showError(`Błąd odświeżania: ${error.message}`);
    } finally {
        window.STATION_STATE.isRefreshing = false;
    }
}

/**
 * Attach event listeners to a card
 * @param {HTMLElement} card - Product card element
 */
function attachCardEventListeners(card) {
    if (!card) {
        console.warn('[Assembly] Cannot attach listeners to null card');
        return;
    }

    const productId = card.dataset.productId;
    const completeBtn = card.querySelector('[data-action="complete"]');

    if (!completeBtn) {
        console.warn(`[Assembly] Complete button not found in card: ${productId}`);
        return;
    }

    // Remove existing listeners (prevent duplicates)
    const newBtn = completeBtn.cloneNode(true);
    completeBtn.parentNode.replaceChild(newBtn, completeBtn);

    // Add click listener
    newBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        handleCompleteClick(card, productId);
    });

    // Add keyboard support (Enter or Space when focused)
    newBtn.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleCompleteClick(card, productId);
        }
    });
}

/**
 * Handle complete button click
 * @param {HTMLElement} card - Card element
 * @param {string} productId - Product ID
 */
function handleCompleteClick(card, productId) {
    console.log(`[Assembly] Complete clicked: ${productId}`);

    // Check if already in progress
    if (card.dataset.inProgress === 'true') {
        console.warn(`[Assembly] Card already in progress: ${productId}`);
        return;
    }

    // Validate card state
    if (!card || !card.parentElement) {
        console.error(`[Assembly] Invalid card state: ${productId}`);
        return;
    }

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

    if (!completeBtn || !actionContainer) {
        console.error(`[Assembly] Missing button/container for ${productId}`);
        return;
    }

    // Change button to processing state
    setButtonProcessing(completeBtn);

    // Create cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-cancel';
    cancelBtn.textContent = 'ANULUJ';
    cancelBtn.dataset.action = 'cancel';
    cancelBtn.type = 'button'; // Prevent form submission

    // IMPORTANT: Ensure button is clickable
    cancelBtn.style.pointerEvents = 'auto';
    cancelBtn.style.position = 'relative';
    cancelBtn.style.zIndex = '10';

    actionContainer.appendChild(cancelBtn);

    // Countdown state
    let secondsLeft = 10;
    let timerId = null;

    // Update button text
    const updateCountdown = () => {
        if (!completeBtn || !completeBtn.parentElement) {
            console.warn(`[Assembly] Button removed during countdown: ${productId}`);
            if (timerId) clearInterval(timerId);
            return;
        }

        completeBtn.innerHTML = `
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
            window.STATION_STATE.countdownTimers.delete(productId);

            // Remove cancel button
            if (cancelBtn && cancelBtn.parentElement) {
                cancelBtn.remove();
            }

            // Execute completion
            onCountdownComplete(card, productId);
        }
    }, 1000);

    // Store timer ID
    window.STATION_STATE.countdownTimers.set(productId, timerId);

    // Cancel button listener - MULTIPLE EVENTS for reliability
    const cancelHandler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        console.log(`[Assembly] Cancel button clicked for ${productId}`);
        cancelCountdown(card, productId, timerId);
    };

    cancelBtn.addEventListener('click', cancelHandler);
    cancelBtn.addEventListener('touchstart', cancelHandler, { passive: false });

    // Keyboard support for cancel button
    cancelBtn.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            cancelCountdown(card, productId, timerId);
        }
    });

    console.log(`[Assembly] Countdown started for ${productId} (10s)`);
}

/**
 * Cancel countdown and reset card
 * @param {HTMLElement} card - Card element
 * @param {string} productId - Product ID
 * @param {number} timerId - Timer ID
 */
function cancelCountdown(card, productId, timerId) {
    console.log(`[Assembly] Countdown cancelled: ${productId}`);

    // Clear timer
    if (timerId) {
        clearInterval(timerId);
        window.STATION_STATE.countdownTimers.delete(productId);
    }

    // Validate card still exists
    if (!card || !card.parentElement) {
        console.warn(`[Assembly] Card no longer exists: ${productId}`);
        return;
    }

    // Reset card state
    card.dataset.inProgress = 'false';
    card.classList.remove('processing');

    // Reset button
    const completeBtn = card.querySelector('.btn-complete');
    if (completeBtn) {
        setButtonInitial(completeBtn);
    }

    // Remove cancel button
    const cancelBtn = card.querySelector('.btn-cancel');
    if (cancelBtn && cancelBtn.parentElement) {
        cancelBtn.remove();
    }

    window.StationCommon.showInfo('Anulowano ukończenie zadania');
}

/**
 * Execute task completion after countdown
 * @param {HTMLElement} card - Card element
 * @param {string} productId - Product ID
 */
async function onCountdownComplete(card, productId) {
    console.log(`[Assembly] Completing task: ${productId}`);

    const completeBtn = card.querySelector('.btn-complete');
    const stationCode = window.STATION_STATE.config.stationCode;

    // Validate card still exists
    if (!card || !card.parentElement) {
        console.error(`[Assembly] Card removed during countdown: ${productId}`);
        return;
    }

    try {
        // Show processing state
        if (completeBtn) {
            completeBtn.innerHTML = '<span class="spinner"></span> ZAPISYWANIE...';
        }

        // Call API
        const response = await window.StationCommon.completeTask(productId, stationCode);

        console.log(`[Assembly] Task completed successfully: ${productId}`, response);

        // Show success state (1 second)
        if (completeBtn) {
            setButtonSuccess(completeBtn);
        }

        // Success notification
        window.StationCommon.showSuccess(`Produkt ${productId} ukończony`);

        // Wait 1 second, then remove card
        setTimeout(() => {
            // Double-check card still exists before removing
            if (card && card.parentElement) {
                window.StationCommon.removeProductCard(productId);

                // Update stats (approximate - will be corrected on next refresh)
                updateStatsAfterCompletion();
            }
        }, 1000);

    } catch (error) {
        console.error(`[Assembly] Failed to complete task: ${productId}`, error);

        // Show detailed error
        const errorMessage = error.message || 'Nieznany błąd';
        window.StationCommon.showError(`Nie udało się ukończyć: ${errorMessage}`);

        // Reset card on error
        if (card && card.parentElement) {
            card.dataset.inProgress = 'false';
            card.classList.remove('processing');

            if (completeBtn) {
                setButtonInitial(completeBtn);
            }
        }
    }
}

/**
 * Update stats after completion (approximate, before next refresh)
 */
function updateStatsAfterCompletion() {
    const totalElement = document.getElementById('total-products');
    if (totalElement) {
        const current = parseInt(totalElement.textContent) || 0;
        if (current > 0) {
            totalElement.textContent = current - 1;
        }
    }

    // If no products left, might want to show empty state
    const remainingCards = window.StationCommon.getAllCards();
    if (remainingCards.length === 0) {
        console.log('[Assembly] No more products - showing empty state');
        showEmptyState();
    }
}

/**
 * Show empty state when no products
 */
function showEmptyState() {
    const grid = document.getElementById('products-grid');
    if (!grid) return;

    grid.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">✅</div>
      <h2>Brak produktów do złożenia</h2>
      <p>Świetna robota! Wszystkie produkty zostały przetworzone.</p>
    </div>
  `;
}

/**
 * Set button to processing state (orange, countdown)
 * @param {HTMLElement} button - Button element
 */
function setButtonProcessing(button) {
    if (!button) return;
    button.classList.add('processing');
    button.classList.remove('success');
    button.disabled = true; // Prevent double-clicks
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
    button.disabled = true;
}

/**
 * Set button to initial state (blue, ready)
 * @param {HTMLElement} button - Button element
 */
function setButtonInitial(button) {
    if (!button) return;
    button.classList.remove('processing', 'success');
    button.textContent = 'ZAKOŃCZ';
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

        // Refresh shortcut: F5 or Ctrl+R (default browser behavior, but log it)
        if (event.key === 'F5' || (event.ctrlKey && event.key === 'r')) {
            console.log('[Assembly] Manual refresh triggered');
        }

        // Cancel all countdowns: Escape
        if (event.key === 'Escape') {
            const activeTimers = window.STATION_STATE.countdownTimers;
            if (activeTimers.size > 0) {
                console.log(`[Assembly] Escape pressed - cancelling ${activeTimers.size} countdowns`);
                activeTimers.forEach((timerId, productId) => {
                    const card = window.StationCommon.getCardById(productId);
                    if (card) {
                        cancelCountdown(card, productId, timerId);
                    }
                });
            }
        }
    });
}

/**
 * Toggle debug mode
 */
function toggleDebugMode() {
    const debugBtn = document.getElementById('debug-toggle');
    if (debugBtn) {
        debugBtn.style.display = debugBtn.style.display === 'none' ? 'block' : 'none';
    }

    console.log('[Assembly] Debug mode toggled');
    console.log('State:', window.STATION_STATE);
    window.StationCommon.showInfo('Debug mode toggled (check console)');
}

/**
 * Handle visibility change (pause/resume when tab inactive)
 */
function handleVisibilityChange() {
    if (document.hidden) {
        console.log('[Assembly] Tab hidden - pausing auto-refresh');
        // Could pause auto-refresh here if needed
    } else {
        console.log('[Assembly] Tab visible - resuming');
        // Trigger immediate refresh when returning
        if (window.STATION_STATE.config?.autoRefreshEnabled) {
            setTimeout(autoRefreshCallback, 1000);
        }
    }
}

/**
 * Override attachCardEventListeners in common
 */
window.StationCommon.attachCardEventListeners = attachCardEventListeners;

/**
 * Initialize on DOM ready
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAssemblyStation);
} else {
    // DOM already loaded
    initAssemblyStation();
}

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
    console.log('[Assembly] Cleaning up...');

    // Stop auto-refresh
    window.StationCommon.stopAutoRefresh();

    // Clear all countdown timers
    window.STATION_STATE.countdownTimers.forEach((timerId, productId) => {
        clearInterval(timerId);
        console.log(`[Assembly] Cleared timer for ${productId}`);
    });
    window.STATION_STATE.countdownTimers.clear();
});

/**
 * Debug helpers (always available)
 */
window.AssemblyDebug = {
    getState: () => window.STATION_STATE,
    getConfig: () => window.STATION_STATE.config,
    triggerRefresh: autoRefreshCallback,
    simulateComplete: (productId) => {
        const card = window.StationCommon.getCardById(productId);
        if (card) {
            handleCompleteClick(card, productId);
        } else {
            console.error(`Card not found: ${productId}`);
        }
    },
    cancelAll: () => {
        window.STATION_STATE.countdownTimers.forEach((timerId, productId) => {
            const card = window.StationCommon.getCardById(productId);
            if (card) {
                cancelCountdown(card, productId, timerId);
            }
        });
    },
    listCards: () => {
        const cards = window.StationCommon.getAllCards();
        console.table(cards.map(c => ({
            id: c.dataset.productId,
            priority: c.dataset.priorityRank,
            inProgress: c.dataset.inProgress
        })));
    },
    forceComplete: async (productId) => {
        try {
            const result = await window.StationCommon.completeTask(
                productId,
                window.STATION_STATE.config.stationCode
            );
            console.log('Force complete result:', result);
            window.StationCommon.removeProductCard(productId);
        } catch (error) {
            console.error('Force complete failed:', error);
        }
    }
};

console.log('[Assembly] Station module loaded');
console.log('[Assembly] Debug commands available via window.AssemblyDebug');