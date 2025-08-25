document.addEventListener('DOMContentLoaded', function () {
    console.log('[Work Timer] Inicjalizacja timera sklejania...');

    // Sprawdź czy mamy konfigurację
    if (!window.TIMER_CONFIG) {
        console.error('[Work Timer] Brak konfiguracji timera');
        alert('Błąd konfiguracji timera');
        return;
    }

    // Inicjalizuj timer
    initTimer();

    // Inicjalizuj zegar
    initClock();

    // Spróbuj włączyć tryb pełnoekranowy
    setTimeout(tryEnterFullscreen, 1000);

    // Ukryj kursor po 5 sekundach bezczynności
    initCursorHiding();

    console.log('[Work Timer] Timer zainicjalizowany', window.TIMER_CONFIG);
});

// Zmienne globalne
let timerInterval = null;
let standardTimeSeconds = 0;
let elapsedSeconds = 0;
let startTime = null;
let cursorHideTimeout = null;

/**
 * Inicjalizuje główny timer
 */
function initTimer() {
    const config = window.TIMER_CONFIG;

    standardTimeSeconds = config.standardTimeMinutes * 60;

    if (config.startedAt) {
        // Timer już działa - oblicz elapsed time
        startTime = new Date(config.startedAt);
        const now = new Date();
        elapsedSeconds = Math.floor((now - startTime) / 1000);
        console.log('[Work Timer] Kontynuacja timera, elapsed:', elapsedSeconds);
    } else {
        // Nowy timer - rozpocznij teraz
        startTime = new Date();
        elapsedSeconds = 0;
        console.log('[Work Timer] Nowy timer rozpoczęty');
    }

    // Rozpocznij odliczanie
    updateDisplay();
    timerInterval = setInterval(updateTimer, 1000);
}

/**
 * Aktualizuje timer co sekundę
 */
function updateTimer() {
    elapsedSeconds++;
    updateDisplay();
}

/**
 * Aktualizuje wyświetlanie timera
 */
function updateDisplay() {
    const timerDisplay = document.getElementById('timerDisplay');
    const timerStatus = document.getElementById('timerStatus');
    const timerBody = document.getElementById('timerBody');
    const overtimeWarning = document.getElementById('overtimeWarning');

    let displaySeconds;
    let statusText;
    let bodyClass;

    if (elapsedSeconds <= standardTimeSeconds) {
        // Normalny czas - odliczanie w dół
        displaySeconds = standardTimeSeconds - elapsedSeconds;
        statusText = 'Normalny czas sklejania';

        // Zmień kolor w ostatnich 60 sekundach
        if (displaySeconds <= 60) {
            bodyClass = 'warning-time';
            statusText = 'Uwaga - kończy się czas!';
        } else {
            bodyClass = 'normal-time';
        }

        if (overtimeWarning) {
            overtimeWarning.style.display = 'none';
        }

    } else {
        // Overtime - liczenie w górę
        displaySeconds = elapsedSeconds - standardTimeSeconds;
        statusText = 'PRZEKROCZONO CZAS STANDARDOWY!';
        bodyClass = 'overtime';

        if (overtimeWarning) {
            overtimeWarning.style.display = 'block';
        }

        // Dodaj pulsowanie do displayu
        if (timerDisplay) {
            timerDisplay.classList.add('overtime');
        }
    }

    // Aktualizuj wyświetlanie czasu
    const minutes = Math.floor(displaySeconds / 60);
    const seconds = displaySeconds % 60;
    const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:00`;

    if (timerDisplay) {
        timerDisplay.textContent = timeString;
    }

    if (timerStatus) {
        timerStatus.textContent = statusText;
    }

    // Aktualizuj kolor tła
    if (timerBody) {
        timerBody.className = bodyClass;
    }

    console.log(`[Work Timer] ${elapsedSeconds}s elapsed, display: ${timeString}, status: ${statusText}`);
}

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
    const timeStr = now.toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const timeElement = document.getElementById('currentTime');
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
                    console.log('[Work Timer] Tryb pełnoekranowy włączony');
                })
                .catch(err => {
                    console.log('[Work Timer] Nie udało się włączyć trybu pełnoekranowego');
                });
        }
    } catch (error) {
        console.log('[Work Timer] Przeglądarka nie obsługuje trybu pełnoekranowego');
    }
}

/**
 * Inicjalizuje ukrywanie kursora po bezczynności
 */
function initCursorHiding() {
    const body = document.body;

    function resetCursorHide() {
        body.classList.remove('hide-cursor');
        clearTimeout(cursorHideTimeout);
        cursorHideTimeout = setTimeout(() => {
            body.classList.add('hide-cursor');
        }, 5000);
    }

    // Pokaż kursor przy ruchu myszy lub dotyku
    document.addEventListener('mousemove', resetCursorHide);
    document.addEventListener('touchstart', resetCursorHide);
    document.addEventListener('click', resetCursorHide);

    // Ukryj kursor po 5 sekundach
    cursorHideTimeout = setTimeout(() => {
        body.classList.add('hide-cursor');
    }, 5000);
}

/**
 * Kończy produkcję
 */
function completeProduction() {
    const config = window.TIMER_CONFIG;

    if (!config || !config.itemId) {
        console.error('[Work Timer] Brak ID produktu');
        alert('Błąd: Brak ID produktu');
        return;
    }

    console.log('[Work Timer] Kończenie produkcji produktu:', config.itemId);

    const completeButton = document.getElementById('completeButton');
    if (completeButton) {
        completeButton.classList.add('loading');
        completeButton.textContent = 'KOŃCZĘ...';
        completeButton.disabled = true;
    }

    // Zatrzymaj timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // Wyślij żądanie do API
    fetch('/production/api/work/gluing/complete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            item_id: config.itemId
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Work Timer] Produkcja zakończona pomyślnie');

                // Przekieruj do podsumowania
                setTimeout(() => {
                    window.location.href = data.redirect_url;
                }, 1000);

            } else {
                console.error('[Work Timer] Błąd kończenia produkcji:', data.error);
                alert('Błąd kończenia produkcji: ' + data.error);

                // Przywróć timer i przycisk
                restoreTimer();
            }
        })
        .catch(error => {
            console.error('[Work Timer] Błąd połączenia:', error);
            alert('Błąd połączenia z serwerem');

            // Przywróć timer i przycisk
            restoreTimer();
        });
}

/**
 * Przywraca timer po błędzie
 */
function restoreTimer() {
    const completeButton = document.getElementById('completeButton');
    if (completeButton) {
        completeButton.classList.remove('loading');
        completeButton.textContent = 'ZAKOŃCZ';
        completeButton.disabled = false;
    }

    // Wznów timer jeśli został zatrzymany
    if (!timerInterval) {
        timerInterval = setInterval(updateTimer, 1000);
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

    // Spacja lub Enter - zakończ produkcję
    if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        completeProduction();
    }

    // Escape - ostrzeżenie przed wyjściem
    if (e.key === 'Escape') {
        e.preventDefault();
        const confirmed = confirm('Czy na pewno chcesz przerwać timer i wrócić do listy produktów?\nProdukcja nie zostanie zapisana jako ukończona.');
        if (confirmed) {
            window.location.href = '/production/work/gluing';
        }
    }
});

// Zapobiegnij przypadkowemu zamknięciu
window.addEventListener('beforeunload', function (e) {
    e.preventDefault();
    e.returnValue = 'Timer jest aktywny. Czy na pewno chcesz opuścić stronę?';
    return e.returnValue;
});

// Export funkcji dla globalnego dostępu
window.completeProduction = completeProduction;