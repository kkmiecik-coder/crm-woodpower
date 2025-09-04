// Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function () {
    console.log('[Dashboard] Inicjalizacja dashboard.js');
    console.log('[Dashboard] Stats from server:', window.dashboardStats);

    // Inicjalizacja komponentów
    initActivityTabs();
    initChangelogWidget();
    initWeatherWidget();

    // Odśwież dane co 5 minut
    setInterval(refreshDashboardData, 5 * 60 * 1000);
});

/**
 * Inicjalizacja tabów w Recent Activity Widget
 */
function initActivityTabs() {
    const activityTabs = document.querySelectorAll('.activity-tab');
    const activityContents = document.querySelectorAll('.activity-content');

    if (!activityTabs.length || !activityContents.length) {
        console.log('[Dashboard] Brak elementów activity tabs');
        return;
    }

    activityTabs.forEach(tab => {
        tab.addEventListener('click', function () {
            const targetTab = this.getAttribute('data-tab');

            // Usuń active z wszystkich tabów
            activityTabs.forEach(t => t.classList.remove('active'));

            // Ukryj wszystkie contenty
            activityContents.forEach(content => {
                content.classList.add('hidden');
            });

            // Aktywuj kliknięty tab
            this.classList.add('active');

            // Pokaż odpowiedni content
            const targetContent = document.getElementById(targetTab + '-content');
            if (targetContent) {
                targetContent.classList.remove('hidden');
            }
        });
    });
}

/**
 * Inicjalizacja widgetu changelog (rozwijane sekcje)
 */
function initChangelogWidget() {
    const toggleEntries = document.querySelectorAll('.toggle-entry');

    if (!toggleEntries.length) {
        console.log('[Dashboard] Brak elementów changelog');
        return;
    }

    toggleEntries.forEach(entry => {
        entry.addEventListener('click', () => {
            const parent = entry.closest('.changelog-entry');
            const content = parent.querySelector('.animated-toggle');
            const allEntries = document.querySelectorAll('.changelog-entry');

            // Zamknij wszystkie inne wpisy
            allEntries.forEach(other => {
                if (other !== parent && other.classList.contains('open')) {
                    const otherContent = other.querySelector('.animated-toggle');
                    otherContent.style.maxHeight = otherContent.scrollHeight + 'px';
                    requestAnimationFrame(() => {
                        otherContent.style.maxHeight = '0';
                    });
                    other.classList.remove('open');
                }
            });

            // Toggle kliknięty wpis
            if (parent.classList.contains('open')) {
                // Zamykanie
                content.style.maxHeight = content.scrollHeight + 'px';
                requestAnimationFrame(() => {
                    content.style.maxHeight = '0';
                });
                parent.classList.remove('open');
            } else {
                // Otwieranie
                content.style.maxHeight = content.scrollHeight + 'px';
                parent.classList.add('open');
            }
        });
    });
}

/**
 * Inicjalizacja widgetu pogodowego
 */
function initWeatherWidget() {
    const weatherWidget = document.getElementById('weather-widget');
    if (!weatherWidget) {
        console.log('[Dashboard] Brak widgetu pogodowego');
        return;
    }

    // Pobierz dane pogodowe
    loadWeatherData();
}

/**
 * Ładowanie danych pogodowych z API
 */
function loadWeatherData() {
    const apiKey = 'b51440a74a7cc3b6e342b57a9f9ff22e';
    const weatherWidget = document.getElementById('weather-widget');

    if (!weatherWidget) return;

    const iconElement = weatherWidget.querySelector('.weather-icon');
    const tempElement = weatherWidget.querySelector('.temp');
    const locationElement = weatherWidget.querySelector('.location');
    const descElement = weatherWidget.querySelector('.desc');
    const feelsElement = weatherWidget.querySelector('.feels');
    const windElement = weatherWidget.querySelector('.wind');
    const humidityElement = weatherWidget.querySelector('.humidity');
    const pressureElement = weatherWidget.querySelector('.pressure');
    const sunriseElement = weatherWidget.querySelector('.sunrise');
    const sunsetElement = weatherWidget.querySelector('.sunset');

    // Koordynaty miast
    const rzeszowCoords = { lat: 50.0413, lon: 21.9990 };
    const bachorzCoords = { lat: 49.8427, lon: 22.3636 };

    // Wykrywanie lokalizacji użytkownika
    detectUserLocation();

    function detectUserLocation() {
        if (!navigator.geolocation) {
            console.warn("[Pogodav2] Geolokalizacja niedostępna – fallback: IP");
            fetchLocationByIP();
            return;
        }

        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude, longitude } = position.coords;
                console.log("[Pogodav2] Współrzędne:", latitude, longitude);

                const distanceToRzeszow = getDistance(latitude, longitude, rzeszowCoords.lat, rzeszowCoords.lon);
                const distanceToBachorz = getDistance(latitude, longitude, bachorzCoords.lat, bachorzCoords.lon);

                const selectedCity = distanceToRzeszow < distanceToBachorz ? 'Rzeszów' : 'Bachórz';
                console.log(`[Pogodav2] Wybrano: ${selectedCity}`);
                fetchWeather(selectedCity);
            },
            error => {
                console.warn("[Pogodav2] Geolokalizacja odrzucona. Kod:", error.code);
                fetchLocationByIP();
            }
        );
    }

    function fetchLocationByIP() {
        fetch('https://ipapi.co/json/')
            .then(response => response.json())
            .then(data => {
                const lat = parseFloat(data.latitude);
                const lon = parseFloat(data.longitude);

                if (!isNaN(lat) && !isNaN(lon)) {
                    const distanceToRzeszow = getDistance(lat, lon, rzeszowCoords.lat, rzeszowCoords.lon);
                    const distanceToBachorz = getDistance(lat, lon, bachorzCoords.lat, bachorzCoords.lon);
                    const selectedCity = distanceToRzeszow < distanceToBachorz ? 'Rzeszów' : 'Bachórz';
                    console.log(`[Pogodav2] IP-based location: ${data.city} -> using ${selectedCity}`);
                    fetchWeather(selectedCity);
                } else {
                    const fallbackCity = ['Rzeszów', 'Bachórz'].includes(data.city) ? data.city : 'Rzeszów';
                    console.log(`[Pogodav2] IP-based location (no coords): ${data.city} -> using ${fallbackCity}`);
                    fetchWeather(fallbackCity);
                }
            })
            .catch(err => {
                console.warn('[Pogodav2] IP location failed:', err);
                fetchWeather('Rzeszów');
            });
    }

    function getDistance(lat1, lon1, lat2, lon2) {
        const toRad = x => (x * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function formatTime(unixTimestamp) {
        const date = new Date(unixTimestamp * 1000);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    function fetchWeather(city) {
        console.log("[Pogodav2] Fetch dla:", city);
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&lang=pl&appid=${apiKey}`;

        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (data.cod === 200) {
                    tempElement.textContent = `${Math.round(data.main.temp)}°C`;
                    locationElement.textContent = data.name;
                    descElement.textContent = data.weather[0].description;

                    feelsElement.textContent = `${Math.round(data.main.feels_like)}°C`;
                    windElement.textContent = `${data.wind.speed} m/s`;
                    humidityElement.textContent = `${data.main.humidity}%`;
                    pressureElement.textContent = `${data.main.pressure} hPa`;

                    const iconCode = data.weather[0].icon;
                    iconElement.src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
                    iconElement.alt = data.weather[0].description;

                    sunriseElement.textContent = formatTime(data.sys.sunrise);
                    sunsetElement.textContent = formatTime(data.sys.sunset);
                } else {
                    console.warn("[Pogodav2] Odpowiedź API:", data);
                    showWeatherError('Błąd API');
                }
            })
            .catch(err => {
                console.error("[Pogodav2] Fetch error:", err);
                showWeatherError('Brak połączenia');
            });
    }

    function showWeatherError(msg) {
        tempElement.textContent = '--°C';
        locationElement.textContent = msg || 'Błąd';
        descElement.textContent = 'Nie udało się pobrać danych';
        feelsElement.textContent = '--°C';
        windElement.textContent = '-- m/s';
        humidityElement.textContent = '--%';
        pressureElement.textContent = '-- hPa';
        iconElement.src = '';
        iconElement.alt = '';
        sunriseElement.textContent = '--:--';
        sunsetElement.textContent = '--:--';
    }
}

/**
 * Odświeżanie danych dashboard (wywołane co 5 minut)
 */
function refreshDashboardData() {
    console.log('[Dashboard] Odświeżanie danych...');

    // Odśwież pogodę
    loadWeatherData();

    // Tutaj można dodać inne odświeżenia danych
    // np. fetch('/dashboard/api/refresh-stats')
}