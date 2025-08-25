document.addEventListener('DOMContentLoaded', function () {
    console.log('[Work Gluing] Inicjalizacja listy produktów do sklejenia...');

    // Inicjalizuj zegar
    initClock();

    // Spróbuj włączyć tryb pełnoekranowy
    setTimeout(tryEnterFullscreen, 2000);

    // Auto-odświeżanie listy co 30 sekund
    setInterval(refreshProductList, 30000);

    console.log('[Work Gluing] Lista produktów zainicjalizowana');
});

/**
 * Inicjalizuje zegar w prawym górnym rogu
 */
function initClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

/**
 * Aktualizuje zegar
 */
function updateClock() {
    const now = new Date();

    // Formatuj datę
    const dateOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };
    const dateStr = now.toLocaleDateString('pl-PL', dateOptions);

    // Formatuj czas
    const timeStr = now.toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    // Aktualizuj elementy
    const dateElement = document.getElementById('currentDate');
    const timeElement = document.getElementById('currentTime');

    if (dateElement) {
        dateElement.textContent = dateStr;
    }

    if (timeElement) {
        timeElement.textContent = timeStr;
    }
}

/**
 * Próbuje włączyć tryb pełnoekranowy
 */
function tryEnterFullscreen() {
    try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
            document.documentElement.requestFullscreen()
                .then(() => {
                    console.log('[Work Gluing] Tryb pełnoekranowy włączony');
                })
                .catch(err => {
                    console.log('[Work Gluing] Nie udało się włączyć trybu pełnoekranowego');
                });
        }
    } catch (error) {
        console.log('[Work Gluing] Przeglądarka nie obsługuje trybu pełnoekranowego');
    }
}

/**
 * Rozpoczyna produkcję konkretnego produktu
 */
function startProduction(itemId) {
    console.log('[Work Gluing] Rozpoczynanie produkcji produktu:', itemId);

    // Znajdź przycisk i dodaj loading state
    const button = document.querySelector(`[data-item-id="${itemId}"] .action-button`);
    if (button) {
        button.classList.add('loading');
        button.textContent = 'ŁADOWANIE...';
        button.disabled = true;
    }

    // Przekieruj do ekranu wyboru stanowiska i pracownika
    const startUrl = `/production/work/gluing/start/${itemId}`;

    setTimeout(() => {
        window.location.href = startUrl;
    }, 500);
}

/**
 * Odświeża listę produktów (bez przeładowania strony)
 */
function refreshProductList() {
    console.log('[Work Gluing] Odświeżanie listy produktów...');

    fetch('/production/work/gluing', {
        method: 'GET',
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
        .then(response => {
            if (response.ok) {
                return response.text();
            }
            throw new Error('Błąd odświeżania');
        })
        .then(html => {
            // Znajdź kontener produktów w nowej zawartości
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            const newProductsContainer = tempDiv.querySelector('#productsContainer');

            if (newProductsContainer) {
                // Zastąp zawartość kontenera
                const currentContainer = document.getElementById('productsContainer');
                if (currentContainer) {
                    currentContainer.innerHTML = newProductsContainer.innerHTML;
                    console.log('[Work Gluing] Lista produktów odświeżona');
                }
            }
        })
        .catch(error => {
            console.log('[Work Gluing] Błąd podczas odświeżania:', error);
            // Nie pokazuj błędu użytkownikowi - to automatyczne odświeżanie
        });
}

/**
 * Pokazuje komunikat o braku produktów
 */
function showEmptyState() {
    const container = document.getElementById('productsContainer');
    if (container) {
        container.innerHTML = `
            <div class="empty-state">
                <h2>Brak produktów do wyświetlenia</h2>
                <p>W kolejce nie ma obecnie żadnych produktów do sklejenia.</p>
            </div>
        `;
    }
}

// Obsługa klawiatury
document.addEventListener('keydown', function (e) {
    // F11 - toggle fullscreen
    if (e.key === 'F11') {
        e.preventDefault();
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            tryEnterFullscreen();
        }
    }

    // F5 - odśwież listę
    if (e.key === 'F5') {
        e.preventDefault();
        refreshProductList();
    }

    // Escape - wróć do wyboru stanowiska
    if (e.key === 'Escape') {
        if (confirm('Czy chcesz wrócić do wyboru stanowiska?')) {
            window.location.href = '/production/work';
        }
    }
});

// Obsługa gestów na tabletech (opcjonalnie)
let touchStartY = 0;
let touchEndY = 0;

document.addEventListener('touchstart', function (e) {
    touchStartY = e.changedTouches[0].screenY;
}, false);

document.addEventListener('touchend', function (e) {
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
}, false);

function handleSwipe() {
    const swipeDistance = touchStartY - touchEndY;
    const minSwipeDistance = 150;

    // Swipe w dół - odśwież listę
    if (swipeDistance < -minSwipeDistance) {
        console.log('[Work Gluing] Gesture: Swipe down - odświeżanie listy');
        refreshProductList();
    }
}

// Export funkcji dla globalnego dostępu
window.startProduction = startProduction;
window.refreshProductList = refreshProductList;

// Zapobiegnij przypadkowemu zamknięciu
window.addEventListener('beforeunload', function (e) {
    // Opcjonalnie: zapytaj przed wyjściem tylko gdy są aktywne operacje
    // e.preventDefault();
    // e.returnValue = '';
});