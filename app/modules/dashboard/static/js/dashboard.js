// Modern Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function () {
    console.log('[Dashboard] Inicjalizacja nowoczesnego dashboard');

    // Inicjalizacja komponentów
    initActivityTabs();
    initWeatherWidget();
    initQuotesChart();
    initQuickActions();

    // Odśwież dane co 5 minut
    setInterval(refreshDashboardData, 5 * 60 * 1000);

    // Uruchom animację powitania
    setTimeout(initGreetingAnimation, 500);

    console.log('[Dashboard] Stats from server:', window.dashboardStats);
    console.log('[Dashboard] Weather from server:', window.weatherData);
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
 * Inicjalizacja widgetu pogodowego - integracja z istniejącym kodem
 */
function initWeatherWidget() {
    const weatherWidget = document.getElementById('weather-widget');
    if (!weatherWidget) {
        console.log('[Dashboard] Brak widgetu pogodowego');
        return;
    }

    // Jeśli mamy dane z serwera, użyj ich
    if (window.weatherData && window.weatherData.success) {
        updateWeatherDisplay(window.weatherData);
        return;
    }

    // W przeciwnym razie pobierz dane z API (jak w oryginalnym kodzie)
    loadWeatherData();
}

/**
 * Ładowanie danych pogodowych z API (z oryginalnego kodu)
 */
function loadWeatherData() {
    const apiKey = 'b51440a74a7cc3b6e342b57a9f9ff22e';

    // Koordynaty miast
    const rzeszowCoords = { lat: 50.0413, lon: 21.9990 };
    const bachorzCoords = { lat: 49.8427, lon: 22.3636 };

    // Wykrywanie lokalizacji użytkownika (jak w oryginalnym kodzie)
    detectUserLocation();

    function detectUserLocation() {
        if (!navigator.geolocation) {
            console.warn("[Weather] Geolokalizacja niedostępna – fallback: IP");
            fetchLocationByIP();
            return;
        }

        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude, longitude } = position.coords;
                console.log("[Weather] Współrzędne:", latitude, longitude);

                const distanceToRzeszow = getDistance(latitude, longitude, rzeszowCoords.lat, rzeszowCoords.lon);
                const distanceToBachorz = getDistance(latitude, longitude, bachorzCoords.lat, bachorzCoords.lon);

                const selectedCity = distanceToRzeszow < distanceToBachorz ? 'Rzeszów' : 'Bachórz';
                console.log(`[Weather] Wybrano: ${selectedCity}`);
                fetchWeather(selectedCity);
            },
            error => {
                console.warn("[Weather] Geolokalizacja odrzucona. Kod:", error.code);
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
                    fetchWeather(selectedCity);
                } else {
                    const fallbackCity = ['Rzeszów', 'Bachórz'].includes(data.city) ? data.city : 'Rzeszów';
                    fetchWeather(fallbackCity);
                }
            })
            .catch(err => {
                console.warn('[Weather] IP location failed:', err);
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

    function fetchWeather(city) {
        console.log("[Weather] Fetch dla:", city);
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&lang=pl&appid=${apiKey}`;

        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (data.cod === 200) {
                    const weatherData = {
                        temperature: Math.round(data.main.temp),
                        feels_like: Math.round(data.main.feels_like),
                        description: data.weather[0].description,
                        city: data.name,
                        humidity: data.main.humidity,
                        pressure: data.main.pressure,
                        wind_speed: data.wind.speed,
                        icon: data.weather[0].icon,
                        sunrise: formatTime(data.sys.sunrise),
                        sunset: formatTime(data.sys.sunset),
                        success: true
                    };

                    updateWeatherDisplay(weatherData);
                } else {
                    console.warn("[Weather] Odpowiedź API:", data);
                    showWeatherError('Błąd API');
                }
            })
            .catch(err => {
                console.error("[Weather] Fetch error:", err);
                showWeatherError('Brak połączenia');
            });
    }

    function formatTime(unixTimestamp) {
        const date = new Date(unixTimestamp * 1000);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }
}

/**
 * Aktualizacja wyświetlania pogody
 */
function updateWeatherDisplay(weatherData) {
    const tempElement = document.getElementById('weather-temp');
    const locationElement = document.getElementById('weather-location');
    const descElement = document.getElementById('weather-desc');
    const humidityElement = document.getElementById('weather-humidity');
    const windElement = document.getElementById('weather-wind');
    const sunriseElement = document.getElementById('weather-sunrise');
    const sunsetElement = document.getElementById('weather-sunset');
    const iconElement = document.getElementById('weather-icon');

    if (weatherData.success) {
        tempElement.textContent = `${weatherData.temperature}°C`;
        locationElement.textContent = weatherData.city;
        descElement.textContent = weatherData.description;
        humidityElement.textContent = `Wilgotność: ${weatherData.humidity}%`;
        windElement.textContent = `Wiatr: ${weatherData.wind_speed} m/s`;
        sunriseElement.textContent = `Wschód: ${weatherData.sunrise}`;
        sunsetElement.textContent = `Zachód: ${weatherData.sunset}`;

        // Ikona pogody - mapowanie kodów API na emoji
        const weatherIcons = {
            '01d': '☀️', '01n': '🌙',
            '02d': '⛅', '02n': '☁️',
            '03d': '☁️', '03n': '☁️',
            '04d': '☁️', '04n': '☁️',
            '09d': '🌧️', '09n': '🌧️',
            '10d': '🌦️', '10n': '🌧️',
            '11d': '⛈️', '11n': '⛈️',
            '13d': '❄️', '13n': '❄️',
            '50d': '🌫️', '50n': '🌫️'
        };

        iconElement.textContent = weatherIcons[weatherData.icon] || '☀️';
    } else {
        showWeatherError(weatherData.message || 'Błąd pobierania danych');
    }
}

/**
 * Wyświetlenie błędu pogody
 */
function showWeatherError(msg) {
    document.getElementById('weather-temp').textContent = '--°C';
    document.getElementById('weather-location').textContent = msg || 'Błąd';
    document.getElementById('weather-desc').textContent = 'Nie udało się pobrać danych';
    document.getElementById('weather-humidity').textContent = 'Wilgotność: --%';
    document.getElementById('weather-wind').textContent = 'Wiatr: -- m/s';
    document.getElementById('weather-sunrise').textContent = 'Wschód: --:--';
    document.getElementById('weather-sunset').textContent = 'Zachód: --:--';
    document.getElementById('weather-icon').textContent = '❓';
}

/**
 * Inicjalizacja wykresu wycen z animacjami
 */
function initQuotesChart() {
    const chartContainer = document.getElementById('quotes-chart-container');
    if (!chartContainer) {
        console.log('[Dashboard] Brak kontenera wykresu');
        return;
    }

    // Intersection Observer dla animacji
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const lines = entry.target.querySelectorAll('.chart-line');
                const points = entry.target.querySelectorAll('.chart-point');

                // Uruchom animacje linii
                lines.forEach((line, index) => {
                    line.style.animationPlayState = 'running';
                });

                // Uruchom animacje punktów
                points.forEach((point, index) => {
                    point.style.animationPlayState = 'running';
                });
            }
        });
    });

    observer.observe(chartContainer);
}

/**
 * Inicjalizacja przycisków szybkich akcji
 */
function initQuickActions() {
    const quickActions = document.querySelectorAll('.quick-action-btn');

    quickActions.forEach(btn => {
        btn.addEventListener('mouseenter', function () {
            this.style.transform = 'translateY(-2px) scale(1.02)';
        });

        btn.addEventListener('mouseleave', function () {
            this.style.transform = 'translateY(0) scale(1)';
        });

        // Dodaj ripple effect przy kliknięciu
        btn.addEventListener('click', function (e) {
            const ripple = document.createElement('span');
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;

            ripple.style.cssText = `
                position: absolute;
                width: ${size}px;
                height: ${size}px;
                left: ${x}px;
                top: ${y}px;
                background: rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                transform: scale(0);
                animation: ripple 0.6s ease-out;
                pointer-events: none;
            `;

            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);

            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });

    // Dodaj style dla ripple animation
    if (!document.getElementById('ripple-styles')) {
        const style = document.createElement('style');
        style.id = 'ripple-styles';
        style.textContent = `
            @keyframes ripple {
                to {
                    transform: scale(2);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Odświeżanie danych dashboard (wywołane co 5 minut)
 */
function refreshDashboardData() {
    console.log('[Dashboard] Odświeżanie danych...');

    // Odśwież pogodę
    loadWeatherData();

    // Można dodać inne odświeżenia danych
    // np. fetch('/dashboard/api/refresh-stats')
}

/**
 * Formatowanie liczb z separatorami tysięcy
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return new Intl.NumberFormat('pl-PL').format(num);
}

/**
 * Formatowanie kwoty w PLN
 */
function formatCurrency(amount) {
    if (amount === null || amount === undefined) return '0 zł';
    return new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency: 'PLN',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

/**
 * Formatowanie procentów
 */
function formatPercentage(value, total) {
    if (total === 0 || !value || !total) return '0%';
    const percentage = (value / total) * 100;
    return `${percentage.toFixed(1)}%`;
}

/**
 * Animacja liczników w statystykach
 */
function animateCounters() {
    const counters = document.querySelectorAll('.stat-number');

    counters.forEach(counter => {
        const target = parseInt(counter.textContent.replace(/[^0-9]/g, ''));
        let current = 0;
        const increment = target / 50; // 50 kroków animacji
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                current = target;
                clearInterval(timer);
            }
            counter.textContent = Math.floor(current).toLocaleString('pl-PL');
        }, 30);
    });
}

/**
 * Inicjalizacja tooltipów
 */
function initTooltips() {
    const elements = document.querySelectorAll('[data-tooltip]');

    elements.forEach(element => {
        element.addEventListener('mouseenter', function (e) {
            const tooltip = document.createElement('div');
            tooltip.className = 'tooltip';
            tooltip.textContent = this.getAttribute('data-tooltip');
            tooltip.style.cssText = `
                position: absolute;
                background: #333;
                color: white;
                padding: 0.5rem;
                border-radius: 4px;
                font-size: 0.75rem;
                white-space: nowrap;
                z-index: 1000;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s;
            `;

            document.body.appendChild(tooltip);

            const rect = this.getBoundingClientRect();
            tooltip.style.left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2) + 'px';
            tooltip.style.top = rect.top - tooltip.offsetHeight - 5 + 'px';

            setTimeout(() => {
                tooltip.style.opacity = '1';
            }, 10);

            this.addEventListener('mouseleave', function () {
                tooltip.remove();
            });
        });
    });
}

/**
 * Obsługa błędów JavaScript
 */
window.addEventListener('error', function (e) {
    console.error('[Dashboard] JavaScript Error:', {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error
    });
});

/**
 * Debug mode - włącza dodatkowe logi
 */
function enableDebugMode() {
    window.dashboardDebug = true;
    console.log('[Dashboard] Debug mode enabled');

    // Loguj wszystkie kliknięcia
    document.addEventListener('click', function (e) {
        if (window.dashboardDebug) {
            console.log('[Dashboard] Click:', e.target);
        }
    });
}

/**
 * Inicjalizacja animacji powitania
 */
function initGreetingAnimation() {
    const greetingContainer = document.getElementById('user-greeting');
    if (!greetingContainer) {
        console.log('[Dashboard] Brak kontenera powitania');
        return;
    }

    // Rozpocznij animację rozszerzenia kontenera po odpowiednim czasie
    setTimeout(() => {
        greetingContainer.classList.add('expanded');
    }, 1400);

    // Opcjonalnie: restart animacji po kliknięciu (do testowania)
    greetingContainer.addEventListener('click', function () {
        if (window.dashboardDebug) {
            restartGreetingAnimation();
        }
    });
}

/**
 * Restart animacji powitania (dla debugowania)
 */
function restartGreetingAnimation() {
    const greetingContainer = document.getElementById('user-greeting');
    if (!greetingContainer) return;

    greetingContainer.classList.remove('expanded');

    // Reset animacji przez usunięcie i ponowne dodanie elementów
    const orangeDot = greetingContainer.querySelector('.orange-dot');
    const avatar = greetingContainer.querySelector('.user-avatar');
    const text = greetingContainer.querySelector('.greeting-text');

    // Resetuj animacje
    [orangeDot, avatar, text].forEach(el => {
        if (el) {
            el.style.animation = 'none';
            el.offsetHeight; // Trigger reflow
            el.style.animation = null;
        }
    });

    // Ponownie uruchom animację rozszerzenia
    setTimeout(() => {
        greetingContainer.classList.add('expanded');
    }, 1400);
}

// Eksport funkcji do globalnego scope dla debugowania
window.dashboardFunctions = {
    loadWeatherData,
    updateWeatherDisplay,
    refreshDashboardData,
    formatNumber,
    formatCurrency,
    formatPercentage,
    animateCounters,
    enableDebugMode,
    initGreetingAnimation,
    restartGreetingAnimation
};