document.addEventListener('DOMContentLoaded', function () {
    console.log('[Work Start] Inicjalizacja ekranu wyboru stanowiska i pracownika...');

    // Inicjalizuj zegar
    initClock();

    // Spr�buj w��czy� tryb pe�noekranowy
    setTimeout(enableFullscreenOnGesture, 2000);

    // Inicjalizuj walidacj�
    updateValidation();

    console.log('[Work Start] Ekran wyboru zainicjalizowany');
});

// Zmienne globalne dla wybranych opcji
let selectedStationId = null;
let selectedWorkerId = null;
let itemId = null;

/**
 * Inicjalizuje zegar w prawym g�rnym rogu
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
 * W��cza pe�ny ekran na gest u�ytkownika
 */
function enableFullscreenOnGesture() {
    try {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
            document.documentElement.requestFullscreen()
                .then(() => {
                    console.log('[Work Start] Tryb pe�noekranowy w��czony');
                })
                .catch(err => {
                    console.log('[Work Start] Nie uda�o si� w��czy� trybu pe�noekranowego');
                });
        }
    } catch (error) {
        console.log('[Work Start] Przegl�darka nie obs�uguje trybu pe�noekranowego');
    }
}

/**
 * Wybiera stanowisko
 */
function selectStation(stationId) {
    console.log('[Work Start] Wybrano stanowisko:', stationId);

    // Usu� zaznaczenie z poprzednio wybranego stanowiska
    const previousSelected = document.querySelector('[data-station-id].selected');
    if (previousSelected) {
        previousSelected.classList.remove('selected');
    }

    // Zaznacz nowe stanowisko
    const stationButton = document.querySelector(`[data-station-id="${stationId}"]`);
    if (stationButton && !stationButton.classList.contains('disabled')) {
        stationButton.classList.add('selected');
        selectedStationId = stationId;

        // Aktualizuj walidacj�
        updateValidation();

        console.log('[Work Start] Stanowisko wybrane:', stationId);
    }
}

/**
 * Wybiera pracownika
 */
function selectWorker(workerId) {
    console.log('[Work Start] Wybrano pracownika:', workerId);

    // Usu� zaznaczenie z poprzednio wybranego pracownika
    const previousSelected = document.querySelector('[data-worker-id].selected');
    if (previousSelected) {
        previousSelected.classList.remove('selected');
    }

    // Zaznacz nowego pracownika
    const workerButton = document.querySelector(`[data-worker-id="${workerId}"]`);
    if (workerButton) {
        workerButton.classList.add('selected');
        selectedWorkerId = workerId;

        // Aktualizuj walidacj�
        updateValidation();

        console.log('[Work Start] Pracownik wybrany:', workerId);
    }
}

/**
 * Aktualizuje walidacj� i stan przycisku
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
                validationMessage.textContent = 'Wybierz stanowisko i pracownika aby kontynuowa�';
            } else if (!selectedStationId) {
                validationMessage.textContent = 'Wybierz stanowisko aby kontynuowa�';
            } else if (!selectedWorkerId) {
                validationMessage.textContent = 'Wybierz pracownika aby kontynuowa�';
            }
        }
    }
}

/**
 * Rozpoczyna produkcj�
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
        console.error('[Work Start] Nie mo�na pobra� ID produktu z URL');
        alert('B��d: Nie mo�na pobra� ID produktu');
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

    // Wy�lij ��danie do API
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
                console.log('[Work Start] Produkcja rozpocz�ta pomy�lnie');

                // Przekieruj do ekranu timera
                setTimeout(() => {
                    window.location.href = data.redirect_url;
                }, 1000);

            } else {
                console.error('[Work Start] B��d rozpoczynania produkcji:', data.error);
                alert('B��d rozpoczynania produkcji: ' + data.error);

                // Przywr�� przycisk
                if (startButton) {
                    startButton.classList.remove('loading');
                    startButton.disabled = false;
                    updateValidation();
                }
            }
        })
        .catch(error => {
            console.error('[Work Start] B��d po��czenia:', error);
            alert('B��d po��czenia z serwerem');

            // Przywr�� przycisk
            if (startButton) {
                startButton.classList.remove('loading');
                startButton.disabled = false;
                updateValidation();
            }
        });
}

// Obs�uga klawiatury
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

    // Escape - wr�� do listy produkt�w
    if (e.key === 'Escape') {
        if (confirm('Czy chcesz wr�ci� do listy produkt�w?')) {
            window.location.href = '/production/work/gluing';
        }
    }

    // Enter - rozpocznij produkcj� (je�li wszystko wybrane)
    if (e.key === 'Enter') {
        if (selectedStationId && selectedWorkerId) {
            startProduction();
        }
    }

    // Cyfry 1-9 dla szybkiego wyboru stanowiska/pracownika
    if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;

        // Je�li nie wybrano stanowiska, wybierz stanowisko
        if (!selectedStationId) {
            const stations = document.querySelectorAll('[data-station-id]:not(.disabled)');
            if (stations[index]) {
                const stationId = stations[index].getAttribute('data-station-id');
                selectStation(parseInt(stationId));
            }
        }
        // Je�li stanowisko ju� wybrane, wybierz pracownika
        else if (!selectedWorkerId) {
            const workers = document.querySelectorAll('[data-worker-id]');
            if (workers[index]) {
                const workerId = workers[index].getAttribute('data-worker-id');
                selectWorker(parseInt(workerId));
            }
        }
    }
});

// Dodaj listener na pierwszy klik dla pe�nego ekranu
document.addEventListener('click', function firstClickHandler() {
    enableFullscreenOnGesture();
    // Usu� listener po pierwszym u�yciu
    document.removeEventListener('click', firstClickHandler);
}, { once: true });

// Export funkcji dla globalnego dost�pu
window.selectStation = selectStation;
window.selectWorker = selectWorker;
window.startProduction = startProduction;