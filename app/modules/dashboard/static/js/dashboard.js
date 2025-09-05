// Modern Dashboard JavaScript - Corrected Version
document.addEventListener('DOMContentLoaded', function () {
    console.log('[Dashboard] Inicjalizacja nowoczesnego dashboard');

    // Inicjalizacja komponentów
    initActivityTabs();
    initWeatherWidget();
    initQuotesChart();
    initQuickActions();
    initChangelogWidget();
    initStatsAnimation();
    initTooltips();
    initUserGreetingAnimation();
    initKeyboardAccessibility();

    // Uruchom animacje po załadowaniu
    setTimeout(triggerFadeInAnimations, 100);

    // Odśwież dane co 5 minut
    setInterval(refreshDashboardData, 5 * 60 * 1000);

    console.log('[Dashboard] Stats from server:', window.dashboardStats);
    console.log('[Dashboard] Weather from server:', window.weatherData);
    console.log('[Dashboard] Chart data from server:', window.chartData);
});

// Globalna funkcja dla modala changelog
window.removeItem = function(button) {
    button.parentElement.remove();
};

/**
 * Inicjalizacja tabów w Recent Activity Widget z animacjami
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

            // Ukryj wszystkie contenty z animacją
            activityContents.forEach(content => {
                content.style.opacity = '0';
                content.style.transform = 'translateY(10px)';
                setTimeout(() => {
                    content.classList.add('hidden');
                }, 150);
            });

            // Aktywuj kliknięty tab
            this.classList.add('active');

            // Pokaż odpowiedni content z animacją
            const targetContent = document.getElementById(targetTab + '-content');
            if (targetContent) {
                setTimeout(() => {
                    targetContent.classList.remove('hidden');
                    targetContent.style.opacity = '0';
                    targetContent.style.transform = 'translateY(10px)';
                    targetContent.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    
                    setTimeout(() => {
                        targetContent.style.opacity = '1';
                        targetContent.style.transform = 'translateY(0)';
                    }, 10);
                }, 150);
            }
        });
    });
    
    console.log(`[Dashboard] Activity tabs zainicjalizowane - ${activityTabs.length} tabów`);
}

/**
 * Inicjalizacja changelog z rozwijaniem/zwijaniem
 */
function initChangelogWidget() {
    console.log('[Dashboard] Inicjalizacja changelog widget');
    
    // Załaduj wpisy changelog
    loadChangelogEntries();
    
    // Inicjalizuj modal
    initChangelogModal();
    
    // Obsługa przycisku dodawania (tylko dla adminów)
    const addBtn = document.getElementById('changelog-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', openChangelogModal);
        console.log('[Dashboard] Przycisk + changelog zainicjalizowany');
    }
}

/**
 * Animacja statystyk z licznikami
 */
function initStatsAnimation() {
    console.log('[Dashboard] Inicjalizacja animacji statystyk');
    
    const statNumbers = document.querySelectorAll('.stat-number');
    
    if (!statNumbers.length) {
        console.log('[Dashboard] Brak elementów stat-number');
        return;
    }
    
    // Intersection Observer - animuj gdy element wejdzie w viewport
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.dataset.animated) {
                animateCounter(entry.target);
                entry.target.dataset.animated = 'true';
            }
        });
    }, { threshold: 0.5 });
    
    statNumbers.forEach(counter => {
        observer.observe(counter);
    });
    
    function animateCounter(element) {
        const text = element.textContent;
        const numberMatch = text.match(/[\d,.\s]+/);
        
        if (!numberMatch) return;
        
        const numberText = numberMatch[0];
        const cleanNumber = parseFloat(numberText.replace(/[^\d.]/g, ''));
        const suffix = text.replace(numberText, '');
        
        if (isNaN(cleanNumber)) return;
        
        let current = 0;
        const increment = cleanNumber / 60; // 60 kroków = ~1 sekunda przy 60fps
        const isDecimal = numberText.includes('.');
        
        const timer = setInterval(() => {
            current += increment;
            
            if (current >= cleanNumber) {
                current = cleanNumber;
                clearInterval(timer);
            }
            
            // Formatowanie liczby
            let displayNumber;
            if (isDecimal) {
                displayNumber = current.toFixed(1);
            } else {
                displayNumber = Math.floor(current).toLocaleString('pl-PL');
            }
            
            element.textContent = displayNumber + suffix;
        }, 16); // ~60fps
    }
    
    console.log(`[Dashboard] Stats animation zainicjalizowana - ${statNumbers.length} liczników`);
}

/**
 * Tooltips dla elementów z data-tooltip
 */
function initTooltips() {
    console.log('[Dashboard] Inicjalizacja tooltips');
    
    const elements = document.querySelectorAll('[data-tooltip]');
    
    if (!elements.length) {
        console.log('[Dashboard] Brak elementów z data-tooltip');
        return;
    }
    
    elements.forEach(element => {
        element.addEventListener('mouseenter', function (e) {
            const tooltipText = this.getAttribute('data-tooltip');
            if (!tooltipText) return;
            
            // Utwórz tooltip
            const tooltip = document.createElement('div');
            tooltip.className = 'dashboard-tooltip';
            tooltip.textContent = tooltipText;
            
            // Style tooltip
            tooltip.style.cssText = `
                position: absolute;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 12px;
                white-space: nowrap;
                z-index: 1000;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s ease;
                backdrop-filter: blur(4px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            `;
            
            document.body.appendChild(tooltip);
            
            // Pozycjonowanie
            const rect = this.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            
            let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
            let top = rect.top - tooltipRect.height - 8;
            
            // Sprawdź czy tooltip mieści się w viewport
            if (left < 8) left = 8;
            if (left + tooltipRect.width > window.innerWidth - 8) {
                left = window.innerWidth - tooltipRect.width - 8;
            }
            if (top < 8) {
                top = rect.bottom + 8; // Pokaż pod elementem
            }
            
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            
            // Animacja pojawiania
            setTimeout(() => {
                tooltip.style.opacity = '1';
            }, 10);
            
            // Usuń tooltip przy opuszczeniu
            const removeTooltip = () => {
                tooltip.remove();
                this.removeEventListener('mouseleave', removeTooltip);
            };
            
            this.addEventListener('mouseleave', removeTooltip);
        });
    });
    
    console.log(`[Dashboard] Tooltips zainicjalizowane - ${elements.length} elementów`);
}

/**
 * User greeting animation
 */
function initUserGreetingAnimation() {
    const greetingElement = document.querySelector('.user-greeting');
    
    if (!greetingElement) {
        console.log('[Dashboard] Brak elementu .user-greeting');
        return;
    }
    
    // Sprawdź czy animacje są włączone
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        console.log('[Dashboard] Animacje wyłączone - prefers-reduced-motion');
        greetingElement.classList.add('expanded');
        return;
    }
    
    console.log('[Dashboard] User greeting animation started');
    
    // Uruchom animację po krótkim opóźnieniu
    setTimeout(() => {
        greetingElement.classList.add('expanded');
    }, 1000);
    
    // Debug clicking for testing
    if (window.dashboardDebug) {
        greetingElement.addEventListener('click', function() {
            this.classList.remove('expanded');
            setTimeout(() => {
                this.classList.add('expanded');
            }, 100);
        });
    }
}

/**
 * Keyboard accessibility
 */
function initKeyboardAccessibility() {
    // Tab navigation dla activity tabs
    const activityTabs = document.querySelectorAll('.activity-tab');
    
    activityTabs.forEach(tab => {
        tab.setAttribute('tabindex', '0');
        tab.setAttribute('role', 'button');
        
        tab.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });
    });
    
    // Changelog entries
    const changelogDates = document.querySelectorAll('.changelog-date.toggle-entry');
    
    changelogDates.forEach(date => {
        date.setAttribute('tabindex', '0');
        date.setAttribute('role', 'button');
        
        date.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });
    });
}

/**
 * Trigger fade-in animations
 */
function triggerFadeInAnimations() {
    // Sprawdź czy animacje są włączone
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    
    // Znajdź wszystkie elementy z klasą fade-in
    const fadeElements = document.querySelectorAll('.fade-in, .widget');
    
    fadeElements.forEach((element, index) => {
        // Dodaj opóźnienie dla każdego elementu
        setTimeout(() => {
            element.style.opacity = '1';
            element.style.transform = 'translateY(0)';
        }, index * 100); // 100ms opóźnienia między elementami
    });
    
    // Dodaj klasę która włącza animacje
    document.body.classList.add('animations-loaded');
    
    console.log(`[Dashboard] Fade-in animations triggered for ${fadeElements.length} elements`);
}

/**
 * API calls dla odświeżania danych
 */
async function refreshStatsData() {
    try {
        console.log('[Dashboard] Odświeżanie statystyk...');
        
        const response = await fetch('/dashboard/api/refresh-stats');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            updateStatsDisplay(data.stats);
            console.log('[Dashboard] Statystyki odświeżone');
        } else {
            console.warn('[Dashboard] Błąd odświeżania statystyk:', data.error);
        }
        
    } catch (error) {
        console.error('[Dashboard] Błąd API refresh-stats:', error);
    }
}

/**
 * Aktualizacja wyświetlania statystyk
 */
function updateStatsDisplay(stats) {
    const elements = {
        monthCount: document.querySelector('[data-stat="month-count"]'),
        weekCount: document.querySelector('[data-stat="week-count"]'),
        monthValue: document.querySelector('[data-stat="month-value"]'),
        acceptanceRate: document.querySelector('[data-stat="acceptance-rate"]'),
        clientsTotal: document.querySelector('[data-stat="clients-total"]')
    };
    
    if (elements.monthCount && stats.quotes) {
        elements.monthCount.textContent = stats.quotes.month_count || 0;
    }
    if (elements.weekCount && stats.quotes) {
        elements.weekCount.textContent = stats.quotes.week_count || 0;
    }
    if (elements.monthValue && stats.quotes) {
        elements.monthValue.textContent = formatCurrency(stats.quotes.month_value || 0);
    }
    if (elements.acceptanceRate && stats.quotes) {
        elements.acceptanceRate.textContent = (stats.quotes.acceptance_rate || 0) + '%';
    }
    if (elements.clientsTotal && stats.clients) {
        elements.clientsTotal.textContent = stats.clients.total_count || 0;
    }
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

    // Jeśli mamy dane z serwera, użyj ich
    if (window.weatherData && window.weatherData.success) {
        updateWeatherDisplay(window.weatherData);
        return;
    }

    // W przeciwnym razie pobierz dane z API
    loadWeatherData();
}

/**
 * Ładowanie danych pogodowych z API
 */
function loadWeatherData() {
    const apiKey = 'b51440a74a7cc3b6e342b57a9f9ff22e';

    // Koordynaty miast
    const rzeszowCoords = { lat: 50.0413, lon: 21.9990 };
    const bachorzCoords = { lat: 49.8427, lon: 22.3636 };

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
 * Inicjalizacja wykresu wycen
 */
function initQuotesChart() {
    console.log('[Dashboard] DEBUG: initQuotesChart called');
    
    // Rysuj prawdziwy wykres
    drawRealChart();
    
    // Aktualizuj metryki
    if (window.chartData) {
        console.log('[Dashboard] DEBUG: Chart data summary:', window.chartData.summary);
        
        const totalElement = document.querySelector('.quotes-metric .metric-dot.total');
        const acceptedElement = document.querySelector('.quotes-metric .metric-dot.accepted');
        const orderedElement = document.querySelector('.quotes-metric .metric-dot.ordered');
        
        if (totalElement && totalElement.nextElementSibling) {
            totalElement.nextElementSibling.textContent = `Wszystkie wyceny: ${window.chartData.summary.total_quotes || 0}`;
        }
        if (acceptedElement && acceptedElement.nextElementSibling) {
            acceptedElement.nextElementSibling.textContent = `Zaakceptowane: ${window.chartData.summary.accepted_quotes || 0}`;
        }
        if (orderedElement && orderedElement.nextElementSibling) {
            orderedElement.nextElementSibling.textContent = `Zamówienia (BL): ${window.chartData.summary.ordered_quotes || 0}`;
        }
    }
}

/**
 * Rysowanie prawdziwego wykresu słupkowego
 */
function drawRealChart() {
    const canvas = document.getElementById('quotes-canvas-chart');
    const container = document.getElementById('real-chart-container');
    const noDataDiv = document.getElementById('chart-no-data');
    
    if (!canvas || !container) {
        console.log('[Dashboard] Brak canvas lub kontenera dla wykresu');
        return;
    }

    // Ustaw rozmiar canvas na podstawie kontenera
    const containerRect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Rozmiar wyświetlania (CSS)
    canvas.style.width = (containerRect.width - 16) + 'px';
    canvas.style.height = (containerRect.height - 16) + 'px';
    
    // Rzeczywisty rozmiar canvas (dla ostrości)
    canvas.width = (containerRect.width - 16) * dpr;
    canvas.height = (containerRect.height - 16) * dpr;
    
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    
    // Sprawdź czy mamy dane
    if (!window.chartData || !window.chartData.labels || window.chartData.labels.length === 0) {
        console.log('[Dashboard] Brak danych dla wykresu');
        canvas.style.display = 'none';
        if (noDataDiv) noDataDiv.style.display = 'block';
        return;
    }

    console.log('[Dashboard] Rysowanie wykresu z danymi:', window.chartData);

    // Ukryj no-data, pokaż canvas
    canvas.style.display = 'block';
    if (noDataDiv) noDataDiv.style.display = 'none';

    // Ustawienia wykresu
    const width = containerRect.width - 16;
    const height = containerRect.height - 16;
    const padding = Math.min(width * 0.08, 50);
    const chartWidth = width - (padding * 2);
    const chartHeight = height - (padding * 2);
    
    const labels = window.chartData.labels;
    const totalQuotes = window.chartData.datasets.total_quotes;
    const acceptedQuotes = window.chartData.datasets.accepted_quotes;
    const orderedQuotes = window.chartData.datasets.ordered_quotes;
    
    // Znajdź maksymalną wartość
    const maxValue = Math.max(
        ...totalQuotes,
        ...acceptedQuotes,
        ...orderedQuotes,
        1
    );
    
    // Wyczyść canvas
    ctx.clearRect(0, 0, width, height);
    
    // Kolory
    const colors = {
        total: '#94a3b8',
        accepted: '#22c55e',
        ordered: '#ED6B24'
    };
    
    // Rysuj tło
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    
    // Szerokość słupka
    const groupWidth = chartWidth / labels.length;
    const barWidth = Math.min(groupWidth / 4, 40);
    const barSpacing = barWidth * 0.1;
    
    // Rysuj słupki dla każdego miesiąca
    labels.forEach((label, monthIndex) => {
        const groupX = padding + (monthIndex * groupWidth);
        const centerX = groupX + groupWidth / 2;
        
        // Pozycje słupków w grupie
        const totalX = centerX - barWidth * 1.5 - barSpacing;
        const acceptedX = centerX - barWidth * 0.5;
        const orderedX = centerX + barWidth * 0.5 + barSpacing;
        
        // Wysokości słupków
        const totalHeight = (totalQuotes[monthIndex] / maxValue) * chartHeight;
        const acceptedHeight = (acceptedQuotes[monthIndex] / maxValue) * chartHeight;
        const orderedHeight = (orderedQuotes[monthIndex] / maxValue) * chartHeight;
        
        // Funkcja rysowania słupka z zaokrąglonymi górami
        function drawRoundedBar(x, y, width, height, color) {
            if (height < 2) return;
            
            ctx.fillStyle = color;
            ctx.fillRect(x, y, width, height);
            
            // Zaokrąglona góra
            ctx.beginPath();
            ctx.arc(x + width/2, y, width/2, 0, Math.PI, true);
            ctx.fill();
        }
        
        // Rysuj wszystkie słupki
        drawRoundedBar(totalX, padding + chartHeight - totalHeight, barWidth, totalHeight, colors.total);
        drawRoundedBar(acceptedX, padding + chartHeight - acceptedHeight, barWidth, acceptedHeight, colors.accepted);
        drawRoundedBar(orderedX, padding + chartHeight - orderedHeight, barWidth, orderedHeight, colors.ordered);
        
        // Etykiety miesięcy
        ctx.fillStyle = '#374151';
        ctx.font = `${Math.min(width/50, 14)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(label, centerX, height - 8);
        
        // Wartości nad słupkami (jeśli są większe niż 0 i słupek jest widoczny)
        ctx.font = `${Math.min(width/60, 12)}px sans-serif`;
        if (totalQuotes[monthIndex] > 0 && totalHeight > 20) {
            ctx.fillStyle = colors.total;
            ctx.fillText(totalQuotes[monthIndex], totalX + barWidth/2, padding + chartHeight - totalHeight - 5);
        }
        if (acceptedQuotes[monthIndex] > 0 && acceptedHeight > 20) {
            ctx.fillStyle = colors.accepted;
            ctx.fillText(acceptedQuotes[monthIndex], acceptedX + barWidth/2, padding + chartHeight - acceptedHeight - 5);
        }
        if (orderedQuotes[monthIndex] > 0 && orderedHeight > 20) {
            ctx.fillStyle = colors.ordered;
            ctx.fillText(orderedQuotes[monthIndex], orderedX + barWidth/2, padding + chartHeight - orderedHeight - 5);
        }
    });
    
    // Rysuj oś Y (skala)
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    const steps = Math.min(Math.floor(maxValue/20), 8);
    
    for (let i = 0; i <= steps; i++) {
        const y = padding + (chartHeight / steps) * i;
        const value = Math.round(maxValue - (maxValue / steps) * i);
        
        // Delikatna linia siatki
        if (i > 0 && i < steps) {
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(padding + chartWidth, y);
            ctx.stroke();
        }
        
        // Etykieta wartości
        ctx.fillStyle = '#6b7280';
        ctx.font = `${Math.min(width/60, 11)}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(value.toString(), padding - 8, y + 4);
    }
    
    console.log('[Dashboard] Wykres narysowany pomyślnie');
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
 * Odświeżanie danych dashboard
 */
function refreshDashboardData() {
    console.log('[Dashboard] Odświeżanie wszystkich danych dashboard...');

    // Odśwież pogodę
    loadWeatherData();
    
    // Odśwież statystyki
    refreshStatsData();
    
    // Jeśli mamy endpoint dla wykresów
    if (typeof refreshChartData === 'function') {
        refreshChartData();
    }
}

/**
 * Obsługa resize dla wykresów
 */
function handleResize() {
    if (window.resizeTimeout) {
        clearTimeout(window.resizeTimeout);
    }
    
    window.resizeTimeout = setTimeout(() => {
        console.log('[Dashboard] Window resized - redrawing charts');
        
        if (typeof drawRealChart === 'function') {
            drawRealChart();
        }
        
        repositionTooltips();
    }, 150);
}

/**
 * Reposition tooltips on resize
 */
function repositionTooltips() {
    const tooltips = document.querySelectorAll('.dashboard-tooltip');
    tooltips.forEach(tooltip => tooltip.remove());
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
 * Debug mode
 */
function enableDebugMode() {
    window.dashboardDebug = true;
    console.log('[Dashboard] Debug mode enabled');

    document.addEventListener('click', function (e) {
        if (window.dashboardDebug) {
            console.log('[Dashboard] Click:', e.target);
        }
    });
}

/**
 * Performance monitoring
 */
function monitorPerformance() {
    if ('performance' in window) {
        window.addEventListener('load', function() {
            setTimeout(() => {
                const perfData = performance.getEntriesByType('navigation')[0];
                console.log('[Dashboard] Load Performance:', {
                    domContentLoaded: Math.round(perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart),
                    loadComplete: Math.round(perfData.loadEventEnd - perfData.loadEventStart),
                    totalTime: Math.round(perfData.loadEventEnd - perfData.navigationStart)
                });
            }, 0);
        });
    }
}

/**
 * NOWA FUNKCJA: Ładowanie wpisów changelog
 */
async function loadChangelogEntries() {
    const container = document.getElementById('changelog-entries');
    if (!container) {
        console.log('[Dashboard] Brak kontenera changelog-entries');
        return;
    }
    
    try {
        // Pokaż loading
        container.innerHTML = '<div class="changelog-loading">Ładowanie nowości...</div>';
        
        // Spróbuj załadować z API
        const response = await fetch('/dashboard/api/changelog-entries');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.entries && data.entries.length > 0) {
            renderChangelogEntries(data.entries);
        } else {
            // Pokaż przykładowe dane jeśli brak wpisów
            renderFallbackChangelog();
        }
        
    } catch (error) {
        console.log('[Changelog] Błąd ładowania z API, pokazuję fallback data:', error);
        renderFallbackChangelog();
    }
}

/**
 * NOWA FUNKCJA: Renderowanie fallback changelog
 */
function renderFallbackChangelog() {
    const container = document.getElementById('changelog-entries');
    if (!container) return;
    
    container.innerHTML = `
        <div class="changelog-entry open">
            <div class="changelog-date toggle-entry">
                <span>05.09.2025 - Dashboard v2.0</span>
                <img src="/static/icons/sidebar-icon/footer-options.svg" alt="Rozwiń" class="changelog-chevron">
            </div>
            <div class="changelog-list animated-toggle">
                <div class="changelog-section">
                    <strong>Dodano</strong>
                    <ul>
                        <li>Nowoczesny moduł Dashboard</li>
                        <li>Widget statystyk z animacjami</li>
                        <li>System tooltips i modali</li>
                    </ul>
                    <strong>Ulepszono</strong>
                    <ul>
                        <li>Interfejs użytkownika</li>
                        <li>Wydajność ładowania</li>
                    </ul>
                </div>
            </div>
        </div>
        <div class="changelog-entry">
            <div class="changelog-date toggle-entry">
                <span>30.08.2025 - System v1.9</span>
                <img src="/static/icons/sidebar-icon/footer-options.svg" alt="Rozwiń" class="changelog-chevron">
            </div>
            <div class="changelog-list animated-toggle">
                <div class="changelog-section">
                    <strong>Naprawiono</strong>
                    <ul>
                        <li>Błędy w module wycen</li>
                        <li>Problemy z synchronizacją</li>
                    </ul>
                </div>
            </div>
        </div>
    `;
    
    // Zainicjalizuj interakcje po renderowaniu
    initChangelogInteractions();
}

/**
 * NOWA FUNKCJA: Renderowanie wpisów z bazy danych
 */
function renderChangelogEntries(entries) {
    const container = document.getElementById('changelog-entries');
    if (!container) return;
    
    let html = '';
    
    entries.forEach((entry, index) => {
        const isOpen = index === 0 ? 'open' : '';
        
        html += `
            <div class="changelog-entry ${isOpen}">
                <div class="changelog-date toggle-entry">
                    <span>${formatChangelogDate(entry.created_at)} - v${entry.version}</span>
                    <img src="/static/icons/sidebar-icon/footer-options.svg" alt="Rozwiń" class="changelog-chevron">
                </div>
                <div class="changelog-list animated-toggle">
                    ${renderChangelogItems(entry.items)}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    initChangelogInteractions();
}

/**
 * NOWA FUNKCJA: Renderowanie elementów wpisu
 */
function renderChangelogItems(items) {
    const sections = {
        'added': { title: 'Dodano', items: [] },
        'improved': { title: 'Ulepszono', items: [] },
        'fixed': { title: 'Naprawiono', items: [] },
        'custom': { title: '', items: [] }
    };
    
    // Grupuj items według typu
    items.forEach(item => {
        if (sections[item.section_type]) {
            sections[item.section_type].items.push(item);
        }
    });
    
    let html = '<div class="changelog-section">';
    
    Object.keys(sections).forEach(sectionType => {
        const section = sections[sectionType];
        if (section.items.length > 0) {
            const title = sectionType === 'custom' && section.items[0].custom_section_name 
                ? section.items[0].custom_section_name 
                : section.title;
                
            html += `<strong>${title}</strong><ul>`;
            section.items.forEach(item => {
                html += `<li>${item.item_text}</li>`;
            });
            html += '</ul>';
        }
    });
    
    html += '</div>';
    return html;
}

/**
 * NOWA FUNKCJA: Formatowanie daty changelog
 */
function formatChangelogDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('pl-PL');
    } catch (error) {
        return dateString;
    }
}

/**
 * NOWA FUNKCJA: Inicjalizacja interakcji changelog
 */
function initChangelogInteractions() {
    const entries = document.querySelectorAll('.changelog-entry');
    
    entries.forEach((entry, index) => {
        const dateElement = entry.querySelector('.changelog-date.toggle-entry');
        const listElement = entry.querySelector('.changelog-list.animated-toggle');
        const chevron = entry.querySelector('.changelog-chevron');
        
        if (dateElement && listElement) {
            dateElement.style.cursor = 'pointer';
            
            // Ustaw początkowy stan
            if (entry.classList.contains('open')) {
                listElement.style.maxHeight = listElement.scrollHeight + 'px';
                listElement.style.opacity = '1';
                if (chevron) chevron.style.transform = 'rotate(180deg)';
            } else {
                listElement.style.maxHeight = '0';
                listElement.style.opacity = '0';
                if (chevron) chevron.style.transform = 'rotate(0deg)';
            }
            
            // Dodaj transition
            listElement.style.transition = 'max-height 0.3s ease, opacity 0.3s ease';
            if (chevron) chevron.style.transition = 'transform 0.3s ease';
            
            dateElement.addEventListener('click', function() {
                const isOpen = entry.classList.contains('open');
                
                if (isOpen) {
                    entry.classList.remove('open');
                    listElement.style.maxHeight = '0';
                    listElement.style.opacity = '0';
                    if (chevron) chevron.style.transform = 'rotate(0deg)';
                } else {
                    entry.classList.add('open');
                    listElement.style.maxHeight = listElement.scrollHeight + 'px';
                    listElement.style.opacity = '1';
                    if (chevron) chevron.style.transform = 'rotate(180deg)';
                }
            });
        }
    });
    
    console.log(`[Dashboard] Changelog interactions zainicjalizowane - ${entries.length} wpisów`);
}

/**
 * NOWA FUNKCJA: Inicjalizacja modala changelog
 */
function initChangelogModal() {
    const modal = document.getElementById('changelog-modal-overlay');
    const closeBtn = document.getElementById('modal-close');
    const cancelBtn = document.getElementById('btn-cancel');
    const form = document.getElementById('changelog-form');
    
    if (!modal) {
        console.log('[Dashboard] Brak modala changelog');
        return;
    }
    
    // Zamykanie modala
    if (closeBtn) {
        closeBtn.addEventListener('click', closeChangelogModal);
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeChangelogModal);
    }
    
    // Zamykanie przez kliknięcie w overlay
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeChangelogModal();
        }
    });
    
    // Obsługa formularza
    if (form) {
        form.addEventListener('submit', handleChangelogSubmit);
    }
    
    // Inicjalizuj przyciski dodawania pozycji
    initAddItemButtons();
    
    console.log('[Dashboard] Modal changelog zainicjalizowany');
}

/**
 * NOWA FUNKCJA: Otwieranie modala
 */
function openChangelogModal() {
    console.log('[Dashboard] Otwieranie modala changelog');
    
    const modal = document.getElementById('changelog-modal-overlay');
    if (!modal) {
        console.error('[Dashboard] Brak modala do otwarcia');
        return;
    }
    
    // Pobierz sugerowaną wersję
    fetchSuggestedVersion();
    
    // Pokaż modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    // Focus na pierwszym polu
    const versionInput = document.getElementById('version-input');
    if (versionInput) {
        setTimeout(() => versionInput.focus(), 100);
    }
    
    console.log('[Dashboard] Modal changelog otwarty');
}

/**
 * NOWA FUNKCJA: Zamykanie modala
 */
function closeChangelogModal() {
    const modal = document.getElementById('changelog-modal-overlay');
    if (!modal) return;
    
    modal.style.display = 'none';
    document.body.style.overflow = '';
    
    // Resetuj formularz
    resetChangelogForm();
    
    console.log('[Dashboard] Modal changelog zamknięty');
}

/**
 * NOWA FUNKCJA: Pobieranie sugerowanej wersji
 */
async function fetchSuggestedVersion() {
    try {
        const response = await fetch('/dashboard/api/changelog-next-version');
        if (response.ok) {
            const data = await response.json();
            const suggestedElement = document.getElementById('suggested-version');
            if (suggestedElement && data.version) {
                suggestedElement.textContent = data.version;
            }
        }
    } catch (error) {
        console.log('[Dashboard] Nie udało się pobrać sugerowanej wersji:', error);
        // Ustaw fallback
        const suggestedElement = document.getElementById('suggested-version');
        if (suggestedElement) {
            suggestedElement.textContent = '1.0.0';
        }
    }
}

/**
 * NOWA FUNKCJA: Inicjalizacja przycisków dodawania pozycji
 */
function initAddItemButtons() {
    const addButtons = document.querySelectorAll('.add-item-btn');
    
    addButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const section = this.getAttribute('data-section');
            addItemToSection(section);
        });
    });
}

/**
 * NOWA FUNKCJA: Dodawanie pozycji do sekcji
 */
function addItemToSection(section) {
    const container = document.getElementById(`${section}-items`);
    if (!container) return;
    
    const itemIndex = container.children.length;
    const itemHtml = `
        <div class="item-input-group">
            <input type="text" name="${section}_items[]" placeholder="Opis zmiany..." required>
            <button type="button" class="remove-item-btn" onclick="removeItem(this)">×</button>
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', itemHtml);
}

/**
 * NOWA FUNKCJA: Usuwanie pozycji
 */
function removeItem(button) {
    button.parentElement.remove();
}

/**
 * NOWA FUNKCJA: Obsługa submitu formularza
 */
async function handleChangelogSubmit(e) {
    e.preventDefault();
    
    console.log('[Dashboard] Wysyłanie formularza changelog');
    
    const formData = new FormData(e.target);
    
    try {
        const response = await fetch('/dashboard/api/changelog-entries', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                console.log('[Dashboard] Changelog zapisany pomyślnie');
                closeChangelogModal();
                // Odśwież listę
                loadChangelogEntries();
                
                // Pokaż toast jeśli dostępny
                if (typeof showToast === 'function') {
                    showToast('Wpis changelog został dodany', 'success');
                }
            } else {
                console.error('[Dashboard] Błąd zapisywania changelog:', data.error);
                alert('Błąd: ' + data.error);
            }
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
        
    } catch (error) {
        console.error('[Dashboard] Błąd wysyłania formularza:', error);
        alert('Wystąpił błąd podczas zapisywania. Spróbuj ponownie.');
    }
}

/**
 * NOWA FUNKCJA: Reset formularza
 */
function resetChangelogForm() {
    const form = document.getElementById('changelog-form');
    if (form) {
        form.reset();
        
        // Wyczyść dynamiczne pozycje
        ['added', 'improved', 'fixed', 'custom'].forEach(section => {
            const container = document.getElementById(`${section}-items`);
            if (container) {
                container.innerHTML = '';
            }
        });
    }
}

// Event Listeners
window.addEventListener('resize', handleResize);
window.addEventListener('error', function (e) {
    console.error('[Dashboard] JavaScript Error:', {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error
    });
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('[Dashboard] Unhandled Promise Rejection:', event.reason);
    
    if (typeof showToast === 'function') {
        showToast('Wystąpił błąd podczas ładowania danych', 'error');
    }
});

// Uruchom monitoring wydajności
monitorPerformance();

// Eksport funkcji do globalnego scope dla debugowania
window.dashboardFunctions = {
    loadWeatherData,
    updateWeatherDisplay,
    refreshDashboardData,
    refreshStatsData,
    updateStatsDisplay,
    formatNumber,
    formatCurrency,
    formatPercentage,
    enableDebugMode,
    initChangelogWidget,
    initStatsAnimation,
    initTooltips,
    triggerFadeInAnimations,
    drawRealChart,
    openChangelogModal,
    closeChangelogModal,
    loadChangelogEntries,
    renderFallbackChangelog
};

console.log('[Dashboard] Enhanced JavaScript loaded successfully');