// modules/analytics/static/js/clients_analytics.js

/**
 * CLIENTS ANALYTICS - Moduł zakładki klientów
 * Obsługuje: top klientów, geografię, źródła, wykresy, mapę Polski
 */

class ClientsAnalytics {
    constructor() {
        this.data = {
            top_clients: null,
            geography: null
        };
        this.charts = {
            cities: null,
            sources: null
        };
        this.map = null; // Mapa Polski
        this.isInitialized = false;
        this.currentLimit = 20;

        this.init();
    }

    init() {
        console.log('[ClientsAnalytics] Inicjalizacja...');

        this.setupEventListeners();
        this.isInitialized = true;

        console.log('[ClientsAnalytics] Gotowe!');
    }

    /**
     * Ładowanie danych klientów
     */
    async loadData() {
        console.log('[ClientsAnalytics] Ładowanie danych klientów...');

        try {
            const response = await fetch('/analytics/data/clients');
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Błąd ładowania danych klientów');
            }

            this.data.top_clients = result.top_clients;
            this.data.geography = result.geography;

            this.updateClientsTable();
            this.updateGeographyCharts();

            console.log('[ClientsAnalytics] Dane klientów załadowane:', this.data);

        } catch (error) {
            console.error('[ClientsAnalytics] Błąd ładowania:', error);
            this.showError('Nie można załadować danych klientów: ' + error.message);
        }
    }

    /**
     * Aktualizacja tabeli top klientów
     */
    updateClientsTable() {
        if (!this.data.top_clients) return;

        const tbody = document.querySelector('#top-clients-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (this.data.top_clients.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="analytics-empty-state">
                        <div class="empty-icon">👤</div>
                        <h3>Brak danych o klientach</h3>
                        <p>Nie znaleziono żadnych klientów z ofertami.</p>
                    </td>
                </tr>
            `;
            return;
        }

        this.data.top_clients.forEach((client, index) => {
            const row = document.createElement('tr');

            // Ranking position
            const position = index + 1;
            let positionBadge = '';
            if (position === 1) positionBadge = '🥇';
            else if (position === 2) positionBadge = '🥈';
            else if (position === 3) positionBadge = '🥉';

            row.innerHTML = `
                <td>
                    <div class="client-info">
                        ${positionBadge}
                        <strong>${window.AnalyticsUtils.truncateText(client.client_name, 30)}</strong>
                        <br>
                        <small class="text-muted">ID: ${client.client_id}</small>
                    </div>
                </td>
                <td>
                    <span class="analytics-tooltip" data-tooltip="Miasto dostawy">
                        📍 ${client.delivery_city}
                    </span>
                </td>
                <td>
                    <span class="analytics-badge badge-info">
                        ${client.source}
                    </span>
                </td>
                <td>
                    <span class="analytics-badge badge-success">
                        ${window.AnalyticsUtils.formatNumber(client.quotes_count)}
                    </span>
                </td>
                <td>
                    <strong class="value-high">
                        ${window.AnalyticsUtils.formatCurrency(client.total_value)}
                    </strong>
                    <br>
                    <small class="text-muted">
                        Śr: ${window.AnalyticsUtils.formatCurrency(client.avg_value)}
                    </small>
                </td>
                <td>
                    <span class="${window.AnalyticsUtils.getConversionClass(client.conversion_accepted)}">
                        ${window.AnalyticsUtils.formatPercent(client.conversion_accepted)}
                    </span>
                    <div class="analytics-progress">
                        <div class="analytics-progress-bar ${this.getProgressBarClass(client.conversion_accepted)}" 
                             style="width: ${Math.min(client.conversion_accepted, 100)}%"></div>
                    </div>
                </td>
                <td>
                    <span class="${window.AnalyticsUtils.getConversionClass(client.conversion_baselinker)}">
                        ${window.AnalyticsUtils.formatPercent(client.conversion_baselinker)}
                    </span>
                    <div class="analytics-progress">
                        <div class="analytics-progress-bar ${this.getProgressBarClass(client.conversion_baselinker)}" 
                             style="width: ${Math.min(client.conversion_baselinker, 100)}%"></div>
                    </div>
                </td>
            `;

            tbody.appendChild(row);
        });

        console.log('[ClientsAnalytics] Tabela klientów zaktualizowana');
    }

    /**
     * Aktualizacja wykresów geograficznych + MAPA
     */
    updateGeographyCharts() {
        if (!this.data.geography) return;

        this.updateCitiesChart();
        this.updateSourcesChart();
        this.updatePolandMap(); // MAPA POLSKI

        console.log('[ClientsAnalytics] Wykresy geograficzne i mapa zaktualizowane');
    }

    /**
     * MAPA POLSKI - główna funkcja
     */
    updatePolandMap() {
        if (!this.data.geography || !this.data.geography.cities) return;

        // Sprawdź czy Leaflet jest dostępny
        if (typeof L === 'undefined') {
            console.warn('[ClientsAnalytics] Leaflet nie jest załadowany - mapa niedostępna');
            return;
        }

        // Inicjalizuj mapę jeśli nie istnieje
        if (!this.map) {
            const mapContainer = document.getElementById('poland-map');
            if (!mapContainer) {
                console.warn('[ClientsAnalytics] Kontener mapy #poland-map nie istnieje');
                return;
            }

            try {
                this.map = L.map('poland-map').setView([52.0693, 19.4803], 6); // Centrum Polski

                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors',
                    maxZoom: 18
                }).addTo(this.map);

                console.log('[ClientsAnalytics] Mapa Polski zainicjalizowana');
            } catch (error) {
                console.error('[ClientsAnalytics] Błąd inicjalizacji mapy:', error);
                return;
            }
        }

        // Wyczyść poprzednie markery
        this.map.eachLayer((layer) => {
            if (layer instanceof L.CircleMarker) {
                this.map.removeLayer(layer);
            }
        });

        // Dodaj markery dla miast
        this.data.geography.cities.forEach(city => {
            this.geocodeAndAddMarker(city);
        });

        console.log('[ClientsAnalytics] Markery miast dodane do mapy');
    }

    /**
     * Geokodowanie i dodawanie markerów
     */
    async geocodeAndAddMarker(cityData) {
        try {
            // Geokodowanie przez Nominatim API
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&country=Poland&city=${encodeURIComponent(cityData.city)}&limit=1`,
                {
                    headers: {
                        'User-Agent': 'WoodPowerCRM/1.0'
                    }
                }
            );
            const results = await response.json();

            if (results.length > 0) {
                const lat = parseFloat(results[0].lat);
                const lon = parseFloat(results[0].lon);

                // Dodaj marker na mapę
                const marker = L.circleMarker([lat, lon], {
                    radius: this.getMarkerSize(cityData.quotes_count),
                    fillColor: this.getMarkerColor(cityData.quotes_count),
                    color: 'white',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.8
                }).addTo(this.map);

                // Popup z informacjami o mieście
                marker.bindPopup(`
                    <div class="map-popup">
                        <h4 style="margin: 0 0 8px 0; color: #ED6B24;">📍 ${cityData.city}</h4>
                        <div style="font-size: 13px; line-height: 1.4;">
                            <p style="margin: 4px 0;"><strong>Klienci:</strong> ${cityData.clients_count}</p>
                            <p style="margin: 4px 0;"><strong>Oferty:</strong> ${cityData.quotes_count}</p>
                            <p style="margin: 4px 0;"><strong>Wartość:</strong> ${window.AnalyticsUtils.formatCurrency(cityData.total_value)}</p>
                        </div>
                    </div>
                `);

                // Tooltip na hover
                marker.bindTooltip(
                    `${cityData.city}: ${cityData.quotes_count} ofert`,
                    {
                        permanent: false,
                        direction: 'top',
                        className: 'city-tooltip'
                    }
                );

            } else {
                console.warn(`[ClientsAnalytics] Nie znaleziono współrzędnych dla miasta: ${cityData.city}`);
            }
        } catch (error) {
            console.error(`[ClientsAnalytics] Błąd geokodowania dla ${cityData.city}:`, error);
        }
    }

    /**
     * Rozmiar markera na podstawie liczby ofert
     */
    getMarkerSize(quotesCount) {
        if (quotesCount >= 20) return 20;
        if (quotesCount >= 10) return 15;
        if (quotesCount >= 5) return 10;
        return 6;
    }

    /**
     * Kolor markera na podstawie liczby ofert
     */
    getMarkerColor(quotesCount) {
        if (quotesCount >= 20) return '#dc3545'; // Czerwony - bardzo dużo
        if (quotesCount >= 10) return '#ED6B24'; // Pomarańczowy - dużo
        if (quotesCount >= 5) return '#ffc107';  // Żółty - średnio
        return '#28a745'; // Zielony - mało
    }

    /**
     * Wykres top miast
     */
    updateCitiesChart() {
        const canvas = document.getElementById('citiesChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        if (this.charts.cities) {
            this.charts.cities.destroy();
        }

        // Przygotuj dane - top 10 miast
        const topCities = this.data.geography.cities.slice(0, 10);
        const labels = topCities.map(city => city.city);
        const quotesData = topCities.map(city => city.quotes_count);

        const config = {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Liczba ofert',
                    data: quotesData,
                    backgroundColor: [
                        '#ED6B24',
                        '#007bff',
                        '#28a745',
                        '#ffc107',
                        '#dc3545',
                        '#6f42c1',
                        '#20c997',
                        '#fd7e14',
                        '#e83e8c',
                        '#6c757d'
                    ],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                ...window.AnalyticsUtils.getChartDefaults(),
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            generateLabels: function (chart) {
                                const data = chart.data;
                                if (data.labels.length && data.datasets.length) {
                                    return data.labels.map((label, index) => {
                                        const value = data.datasets[0].data[index];
                                        const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                                        const percentage = ((value / total) * 100).toFixed(1);

                                        return {
                                            text: `${label}: ${value} (${percentage}%)`,
                                            fillStyle: data.datasets[0].backgroundColor[index],
                                            index: index
                                        };
                                    });
                                }
                                return [];
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return `${context.label}: ${context.parsed} ofert (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        };

        this.charts.cities = new Chart(ctx, config);
    }

    /**
     * Wykres źródeł klientów
     */
    updateSourcesChart() {
        const canvas = document.getElementById('sourcesChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        if (this.charts.sources) {
            this.charts.sources.destroy();
        }

        const sources = this.data.geography.sources;
        const labels = sources.map(source => source.source);
        const quotesData = sources.map(source => source.quotes_count);

        const config = {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Liczba ofert',
                    data: quotesData,
                    backgroundColor: 'rgba(0, 123, 255, 0.8)',
                    borderColor: '#007bff',
                    borderWidth: 1
                }]
            },
            options: {
                ...window.AnalyticsUtils.getChartDefaults(),
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.parsed.y} ofert`;
                            },
                            afterLabel: function (context) {
                                const source = sources[context.dataIndex];
                                return [
                                    `Klienci: ${source.clients_count}`,
                                    `Wartość: ${window.AnalyticsUtils.formatCurrency(source.total_value)}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Liczba ofert'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Źródło'
                        }
                    }
                }
            }
        };

        this.charts.sources = new Chart(ctx, config);
    }

    /**
     * Event listeners
     */
    setupEventListeners() {
        // Selektor limitu klientów
        const limitSelect = document.getElementById('clients-limit-select');
        if (limitSelect) {
            limitSelect.addEventListener('change', (e) => {
                const limit = parseInt(e.target.value);
                this.loadClientsData(limit);
            });
        }

        console.log('[ClientsAnalytics] Event listeners skonfigurowane');
    }

    /**
     * Ładowanie klientów z limitem
     */
    async loadClientsData(limit = 20) {
        console.log(`[ClientsAnalytics] Ładowanie klientów z limitem ${limit}...`);
        this.currentLimit = limit;

        try {
            const response = await fetch(`/analytics/api/clients/top?limit=${limit}`);
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Błąd ładowania klientów');
            }

            this.data.top_clients = result.clients;
            this.updateClientsTable();

            console.log(`[ClientsAnalytics] Klienci załadowani z limitem ${limit}`);

        } catch (error) {
            console.error('[ClientsAnalytics] Błąd ładowania klientów:', error);
            this.showError('Nie można załadować klientów: ' + error.message);
        }
    }

    /**
     * Pomocnicze funkcje
     */
    getProgressBarClass(value) {
        if (value >= 70) return 'success';
        if (value >= 40) return 'warning';
        return 'danger';
    }

    /**
     * Wyświetlanie błędów
     */
    showError(message) {
        console.error(`[ClientsAnalytics] ${message}`);

        const errorDiv = document.createElement('div');
        errorDiv.className = 'analytics-error alert alert-danger';
        errorDiv.innerHTML = `
            <strong>Błąd:</strong> ${message}
            <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
        `;

        const clientsTab = document.getElementById('clients-analytics');
        if (clientsTab) {
            clientsTab.insertBefore(errorDiv, clientsTab.firstChild);
        }
    }

    /**
     * Odświeżenie danych
     */
    async refresh() {
        console.log('[ClientsAnalytics] Odświeżanie danych...');
        await this.loadData();
    }

    /**
     * Cleanup przy przełączaniu zakładek
     */
    cleanup() {
        // Zniszcz wykresy
        Object.values(this.charts).forEach(chart => {
            if (chart) {
                chart.destroy();
            }
        });

        this.charts = {
            cities: null,
            sources: null
        };

        // Zniszcz mapę
        if (this.map) {
            this.map.remove();
            this.map = null;
        }

        console.log('[ClientsAnalytics] Cleanup wykonany');
    }

    /**
     * Pobierz dane do exportu
     */
    getExportData() {
        return {
            top_clients: this.data.top_clients,
            geography: this.data.geography,
            current_limit: this.currentLimit
        };
    }
}

/**
 * Inicjalizacja
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('[ClientsAnalytics] Inicjalizacja modułu...');

    window.ClientsAnalytics = new ClientsAnalytics();

    console.log('[ClientsAnalytics] Moduł gotowy!');
});