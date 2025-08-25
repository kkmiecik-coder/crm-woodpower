document.addEventListener('DOMContentLoaded', function () {
    console.log('[Work Complete] Inicjalizacja ekranu podsumowania...');

    // Spróbuj włączyć tryb pełnoekranowy
    setTimeout(tryEnterFullscreen, 1000);

    // Inicjalizuj obsługę przycisków
    initButtons();

    // Auto-przekierowanie po 30 sekundach bezczynności (opcjonalne)
    // initAutoRedirect();

    console.log('[Work Complete] Ekran podsumowania zainicjalizowany');
});

/**
 * Próbuje włączyć tryb pełnoekranowy
 */
function tryEnterFullscreen() {
    try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
            document.documentElement.requestFullscreen()
                .then(() => {
                    console.log('[Work Complete] Tryb pełnoekranowy włączony');
                })
                .catch(err => {
                    console.log('[Work Complete] Nie udało się włączyć trybu pełnoekranowego');
                });
        }
    } catch (error) {
        console.log('[Work Complete] Przeglądarka nie obsługuje trybu pełnoekranowego');
    }
}

/**
 * Inicjalizuje obsługę przycisków
 */
function initButtons() {
    const nextProductButton = document.getElementById('nextProductButton');

    if (nextProductButton) {
        nextProductButton.addEventListener('click', function (e) {
            // Dodaj loading state
            this.classList.add('loading');
            this.innerHTML = '🔄 Ładowanie...';

            console.log('[Work Complete] Przekierowanie do kolejnego produktu...');
            // Normalnie przekieruje przez href
        });
    }

    // Obsługa wszystkich przycisków akcji
    const actionButtons = document.querySelectorAll('.action-button');
    actionButtons.forEach(button => {
        button.addEventListener('click', function () {
            if (!this.classList.contains('loading')) {
                this.style.opacity = '0.8';
                console.log('[Work Complete] Kliknięto przycisk:', this.textContent.trim());
            }
        });
    });
}

/**
 * Inicjalizuje auto-przekierowanie po bezczynności (opcjonalne)
 */
function initAutoRedirect() {
    let inactivityTimeout;
    let countdownInterval;
    let countdownSeconds = 30;

    function resetInactivityTimer() {
        clearTimeout(inactivityTimeout);
        clearInterval(countdownInterval);

        // Usuń komunikat odliczania jeśli istnieje
        const countdownElement = document.getElementById('autoRedirectCountdown');
        if (countdownElement) {
            countdownElement.remove();
        }

        // Rozpocznij nowy timer
        inactivityTimeout = setTimeout(startAutoRedirectCountdown, 30000); // 30 sekund
    }

    function startAutoRedirectCountdown() {
        console.log('[Work Complete] Rozpoczęcie auto-przekierowania za bezczynność');

        // Utwórz element odliczania
        const countdownElement = document.createElement('div');
        countdownElement.id = 'autoRedirectCountdown';
        countdownElement.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 15px 25px;
            border-radius: 10px;
            font-size: 16px;
            text-align: center;
            z-index: 1000;
        `;

        document.body.appendChild(countdownElement);

        // Odliczanie
        countdownInterval = setInterval(() => {
            countdownSeconds--;
            countdownElement.innerHTML = `
                Auto-powrót do listy za: <strong>${countdownSeconds}s</strong><br>
                <small>Kliknij gdziekolwiek aby anulować</small>
            `;

            if (countdownSeconds <= 0) {
                clearInterval(countdownInterval);
                window.location.href = '/production/work/gluing';
            }
        }, 1000);
    }

    // Resetuj timer przy aktywności
    document.addEventListener('click', resetInactivityTimer);
    document.addEventListener('mousemove', resetInactivityTimer);
    document.addEventListener('touchstart', resetInactivityTimer);
    document.addEventListener('keydown', resetInactivityTimer);

    // Rozpocznij pierwszy timer
    resetInactivityTimer();
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

    // Enter - przejdź do kolejnego produktu (jeśli dostępny)
    if (e.key === 'Enter') {
        const nextProductButton = document.getElementById('nextProductButton');
        if (nextProductButton) {
            nextProductButton.click();
        }
    }

    // Escape - powrót do listy
    if (e.key === 'Escape') {
        window.location.href = '/production/work/gluing';
    }

    // Spacja - powrót do wyboru stanowiska
    if (e.key === ' ') {
        e.preventDefault();
        window.location.href = '/production/work';
    }

    // Cyfra 1 - widok listy
    if (e.key === '1') {
        window.location.href = '/production/work/gluing';
    }

    // Cyfra 2 - kolejny produkt (jeśli dostępny)
    if (e.key === '2') {
        const nextProductButton = document.getElementById('nextProductButton');
        if (nextProductButton) {
            nextProductButton.click();
        }
    }
});

// Pokaż komunikat o skrótach klawiszowych (opcjonalnie)
function showKeyboardShortcuts() {
    const shortcuts = `
        Skróty klawiszowe:
        • Enter lub 2 - Kolejny produkt
        • Esc lub 1 - Widok listy  
        • Spacja - Wybór stanowiska
        • F11 - Pełny ekran
    `;

    console.log('[Work Complete] Dostępne skróty klawiszowe:', shortcuts);
}

// Wywołaj po załadowaniu
setTimeout(showKeyboardShortcuts, 2000);