document.addEventListener('DOMContentLoaded', function () {
    console.log('[Work Start] Inicjalizacja ekranu wyboru stanowiska i pracownika...');

    // Inicjalizuj zegar
    initClock();

    // Spróbuj w³¹czyæ tryb pe³noekranowy
    setTimeout(enableFullscreenOnGesture, 2000);

    // Inicjalizuj walidacjê
    updateValidation();

    console.log('[Work Start] Ekran wyboru zainicjalizowany');
});

// Zmienne globalne dla wybranych opcji
let selectedStationId = null;
let selectedWorkerId = null;
let itemId = null;

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
 * W³¹cza pe³ny ekran na gest u¿ytkownika
 */
function enableFullscreenOnGesture() {
    try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
            document.documentElement.requestFullscreen()
                .then(() => {
                    console.log('[Work Start] Tryb pe³noekranowy w³¹czony');
                })
                .catch(err => {
                    console.log('[Work Start] Nie uda³o siê w³¹czyæ trybu pe³noekranowego');
                });
        }
    } catch (error) {
        console.log('[Work Start] Przegl¹darka nie obs³uguje trybu pe³noekranowego');
    }
}

/**
 * Wybiera stanowisko
 */
function selectStation(stationId) {
    console.log('[Work Start] Wybrano stanowisko:', stationId);

    // Usuñ zaznaczenie z poprzednio wybranego stanowiska
    const previousSelected = document.querySelector('[data-station-id].selected');
    if (previousSelected) {
        previousSelected.classList.remove('selected');
    }

    // Zaznacz nowe stanowisko
    const stationButton = document.querySelector(`[data-station-id="${stationId}"]`);
    if (stationButton && !stationButton.classList.contains('disabled')) {
        stationButton.classList.add('selected');
        selectedStationId = stationId;

        // Aktualizuj walidacjê
        updateValidation();

        console.log('[Work Start] Stanowisko wybrane:', stationId);
    }
}

/**
 * Wybiera pracownika
 */
function selectWorker(workerId) {
    console.log('[Work Start] Wybrano pracownika:', workerId);

    // Usuñ zaznaczenie z poprzednio wybranego pracownika
    const previousSelected = document.querySelector('[data-worker-id].selected');
    if (previousSelected) {
        previousSelected.classList.remove('selected');
    }

    // Zaznacz nowego pracownika
    const workerButton = document.querySelector(`[data-worker-id="${workerId}"]`);
    if (workerButton) {
        workerButton.classList.add('selected');
        selectedWorkerId = workerId;

        // Aktualizuj walidacjê
        updateValidation();

        console.log('[Work Start] Pracownik wybrany:', workerId);
    }
}

/**
 * Aktualizuje walidacjê i stan przycisku
 */
function updateValidation() {
    const startButton = document.getElementById('startButton');
    const validationMessage = document.getElementById('validationMessage');

    const isValid = selectedStationId && selectedWorkerId;

    if (startButton) {
        startButton.disabled = !isValid;

        if (isValid) {
            startButton.textContent = 'ROZPOCZNIJ ODLICZANIE';
            startButton.style.background = '#28a745';
        } else {
            startButton.textContent = 'WYBIERZ STANOWISKO I PRACOWNIKA';
            startButton.style.background = '#6c757d';
        }
    }

    if (validationMessage) {
        if (isValid) {
            validationMessage.style.display = 'none';
        } else {
            validationMessage.style.display = 'block';

            if (!selectedStationId && !selectedWorkerId) {
                validationMessage.textContent = 'Wybierz stanowisko i pracownika aby kontynuowaæ';
            } else if (!selectedStationId) {
                validationMessage.textContent = 'Wybierz stanowisko aby kontynuowaæ';
            } else if (!selectedWorkerId) {
                validationMessage.textContent = 'Wybierz pracownika aby kontynuowaæ';
            }
        }
    }
}

/**
 * Rozpoczyna produkcjê
 */
function startProduction() {
    if (!selectedStationId || !selectedWorkerId) {
        console.log('[Work Start] Brak wybranych opcji');
        return;
    }

    // Pobierz item_id z URL
    const pathParts = window.location.pathname.split('/');
    itemId = pathParts[pathParts.length - 1];

    if (!itemId || isNaN(itemId)) {
        console.error('[Work Start] Nie mo¿na pobraæ ID produktu z URL');
        alert('B³¹d: Nie mo¿na pobraæ ID produktu');
        return;
    }

    console.log('[Work Start] Rozpoczynanie produkcji:', {
        itemId: itemId,
        stationId: selectedStationId,
        workerId: selectedWorkerId
    });

    const startButton = document.getElementById('startButton');
    if (startButton) {
        startButton.classList.add('loading');
        startButton.textContent = 'ROZPOCZYNANIE...';
        startButton.disabled = true;
    }

    // Wyœlij ¿¹danie do API
    fetch('/production/api/work/gluing/start', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            item_id: parseInt(itemId),
            station_id: selectedStationId,
            worker_id: selectedWorkerId
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[Work Start] Produkcja rozpoczêta pomyœlnie');

                // Przekieruj do ekranu timera
                setTimeout(() => {
                    window.location.href = data.redirect_url;
                }, 1000);

            } else {
                console.error('[Work Start] B³¹d rozpoczynania produkcji:', data.error);
                alert('B³¹d rozpoczynania produkcji: ' + data.error);

                // Przywróæ przycisk
                if (startButton) {
                    startButton.classList.remove('loading');
                    startButton.disabled = false;
                    updateValidation();
                }
            }
        })
        .catch(error => {
            console.error('[Work Start] B³¹d po³¹czenia:', error);
            alert('B³¹d po³¹czenia z serwerem');

            // Przywróæ przycisk
            if (startButton) {
                startButton.classList.remove('loading');
                startButton.disabled = false;
                updateValidation();
            }
        });
}

// Obs³uga klawiatury
document.addEventListener('keydown', function (e) {
    // F11 - toggle fullscreen
    if (e.key === 'F11') {
        e.preventDefault();
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            enableFullscreenOnGesture();
        }
    }

    // Escape - wróæ do listy produktów
    if (e.key === 'Escape') {
        if (confirm('Czy chcesz wróciæ do listy produktów?')) {
            window.location.href = '/production/work/gluing';
        }
    }

    // Enter - rozpocznij produkcjê (jeœli wszystko wybrane)
    if (e.key === 'Enter') {
        if (selectedStationId && selectedWorkerId) {
            startProduction();
        }
    }

    // Cyfry 1-9 dla szybkiego wyboru stanowiska/pracownika
    if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;

        // Jeœli nie wybrano stanowiska, wybierz stanowisko
        if (!selectedStationId) {
            const stations = document.querySelectorAll('[data-station-id]:not(.disabled)');
            if (stations[index]) {
                const stationId = stations[index].getAttribute('data-station-id');
                selectStation(parseInt(stationId));
            }
        }
        // Jeœli stanowisko ju¿ wybrane, wybierz pracownika
        else if (!selectedWorkerId) {
            const workers = document.querySelectorAll('[data-worker-id]');
            if (workers[index]) {
                const workerId = workers[index].getAttribute('data-worker-id');
                selectWorker(parseInt(workerId));
            }
        }
    }
});

// Dodaj listener na pierwszy klik dla pe³nego ekranu
document.addEventListener('click', function firstClickHandler() {
    enableFullscreenOnGesture();
    // Usuñ listener po pierwszym u¿yciu
    document.removeEventListener('click', firstClickHandler);
}, { once: true });

// Export funkcji dla globalnego dostêpu
window.selectStation = selectStation;
window.selectWorker = selectWorker;
window.startProduction = startProduction;