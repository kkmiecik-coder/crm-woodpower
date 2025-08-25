document.addEventListener('DOMContentLoaded', function () {
    console.log('[Work Station] Inicjalizacja ekranu wyboru stanowiska...');

    // Spróbuj włączyć tryb pełnoekranowy po 3 sekundach
    setTimeout(function () {
        tryEnterFullscreen();
    }, 3000);

    // Inicjalizuj przyciski
    initButtons();
});

/**
 * Próbuje włączyć tryb pełnoekranowy
 */
function tryEnterFullscreen() {
    try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
            document.documentElement.requestFullscreen()
                .then(() => {
                    console.log('[Work Station] Tryb pełnoekranowy włączony');
                })
                .catch(err => {
                    console.log('[Work Station] Nie udało się włączyć trybu pełnoekranowego');
                });
        }
    } catch (error) {
        console.log('[Work Station] Przeglądarka nie obsługuje trybu pełnoekranowego');
    }
}

/**
 * Inicjalizuje obsługę przycisków
 */
function initButtons() {
    const gluingButton = document.getElementById('gluingStation');
    const packagingButton = document.getElementById('packagingStation');

    if (gluingButton) {
        gluingButton.addEventListener('click', function (e) {
            // Pokaż loading
            this.classList.add('loading');
            console.log('[Work Station] Przekierowanie do stanowiska sklejania...');
            // Normalnie przekieruje przez href
        });
    }

    if (packagingButton) {
        packagingButton.addEventListener('click', function () {
            showSimpleMessage();
        });
    }
}

/**
 * Pokazuje prostą wiadomość o funkcji w przygotowaniu
 */
function showSimpleMessage() {
    alert('Stanowisko pakowania będzie dostępne wkrótce.');
}

// Obsługa klawisza F11 dla trybu pełnoekranowego
document.addEventListener('keydown', function (e) {
    if (e.key === 'F11') {
        e.preventDefault();
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            tryEnterFullscreen();
        }
    }
});