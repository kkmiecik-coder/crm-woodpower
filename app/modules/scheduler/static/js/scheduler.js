/**
 * SCHEDULER MODULE - JavaScript functionality
 * Obsługuje interfejs administracyjny dla systemu automatyzacji
 */

// Globalne zmienne
let currentQuoteLogsPage = 1;
let currentAllLogsPage = 1;
const LOGS_PER_PAGE = 20;

const FRIENDLY_MESSAGES = {
    // Konfiguracja
    config: {
        'quote_reminder_enabled': {
            true: '✅ Automatyczne przypomnienia o wycenach zostały włączone',
            false: '⏸️ Automatyczne przypomnienia o wycenach zostały wyłączone'
        },
        'quote_reminder_days': (value) => `📅 Przypomnienia będą wysyłane po ${value} ${value == 1 ? 'dniu' : value < 5 ? 'dniach' : 'dniach'}`,
        'daily_check_hour': (value) => `⏰ Codzienne sprawdzanie wycen ustawione na ${value}:00`,
        'max_reminder_attempts': (value) => `🔄 Maksymalna liczba prób wysłania: ${value}`
    },

    // Nazwy zadań
    jobs: {
        'quote_reminders_daily': 'Sprawdzanie przypomnień o wycenach',
        'weekly_report': 'Cotygodniowy raport',
        'monthly_cleanup': 'Miesięczne czyszczenie danych',
        'system_health_check': 'Sprawdzanie stanu systemu'
    },

    // Akcje zadań
    actions: {
        trigger: {
            success: (jobName) => `🚀 Zadanie "${jobName}" zostało uruchomione pomyślnie`,
            error: (jobName) => `❌ Nie udało się uruchomić zadania "${jobName}"`
        },
        pause: {
            success: (jobName) => `⏸️ Zadanie "${jobName}" zostało wstrzymane`,
            error: (jobName) => `❌ Nie udało się wstrzymać zadania "${jobName}"`
        },
        resume: {
            success: (jobName) => `▶️ Zadanie "${jobName}" zostało wznowione`,
            error: (jobName) => `❌ Nie udało się wznowić zadania "${jobName}"`
        }
    },

    // Błędy ogólne
    errors: {
        network: '🌐 Błąd połączenia z serwerem. Sprawdź połączenie internetowe.',
        timeout: '⏱️ Przekroczono limit czasu. Spróbuj ponownie.',
        unauthorized: '🔒 Brak uprawnień do wykonania tej akcji.',
        server_error: '🔧 Wystąpił błąd serwera. Skontaktuj się z administratorem.',
        validation: '📝 Wprowadzone dane są nieprawidłowe.'
    },

    // Potwierdzenia
    confirmations: {
        trigger_job: (jobName) => `Czy na pewno chcesz uruchomić zadanie "${jobName}"?`,
        pause_job: (jobName) => `Czy na pewno chcesz wstrzymać zadanie "${jobName}"?`,
        test_reminders: '⚠️ UWAGA: Test może wysłać rzeczywiste emaile do klientów!\n\nCzy na pewno chcesz kontynuować?'
    }
};

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', function () {
    initializeTabs();
    loadQuoteLogs();
    loadAllLogs();
    initializeAutoRefresh();

    // Dodaj event listenery dla filtrów
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
        statusFilter.addEventListener('change', function () {
            currentQuoteLogsPage = 1;
            loadQuoteLogs();
        });
    }

    const logStatusFilter = document.getElementById('logStatusFilter');
    if (logStatusFilter) {
        logStatusFilter.addEventListener('change', function () {
            currentAllLogsPage = 1;
            loadAllLogs();
        });
    }

    const logTypeFilter = document.getElementById('logTypeFilter');
    if (logTypeFilter) {
        logTypeFilter.addEventListener('change', function () {
            currentAllLogsPage = 1;
            loadAllLogs();
        });
    }
});

/**
 * Inicjalizacja systemu zakładek
 */
function initializeTabs() {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', function () {
            const targetTab = this.getAttribute('data-tab');

            // Usuń aktywne klasy
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));

            // Dodaj aktywne klasy
            this.classList.add('active');
            const targetContent = document.getElementById(targetTab);
            if (targetContent) {
                targetContent.classList.add('active');

                // Załaduj dane dla konkretnej zakładki
                if (targetTab === 'quotes-tab') {
                    loadQuoteLogs();
                } else if (targetTab === 'logs-tab') {
                    loadAllLogs();
                }
            }
        });
    });
}

/**
 * Uruchomienie zadania ręcznie
 */
function triggerJob(jobId) {
    const jobName = FRIENDLY_MESSAGES.jobs[jobId] || jobId;

    if (!confirm(FRIENDLY_MESSAGES.confirmations.trigger_job(jobName))) {
        return;
    }

    showMessage('🔄 Uruchamianie zadania...', 'info');

    fetch(`/scheduler/api/job/trigger/${jobId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showMessage(FRIENDLY_MESSAGES.actions.trigger.success(jobName), 'success');
                setTimeout(refreshSchedulerStatus, 2000);
            } else {
                showMessage(FRIENDLY_MESSAGES.actions.trigger.error(jobName), 'error');
            }
        })
        .catch(error => {
            console.error('Błąd uruchamiania zadania:', error);
            showMessage(FRIENDLY_MESSAGES.errors.network, 'error');
        });
}

/**
 * Wstrzymanie zadania
 */
function pauseJob(jobId) {
    const jobName = FRIENDLY_MESSAGES.jobs[jobId] || jobId;

    if (!confirm(FRIENDLY_MESSAGES.confirmations.pause_job(jobName))) {
        return;
    }

    showMessage('⏸️ Wstrzymywanie zadania...', 'info');

    fetch(`/scheduler/api/job/pause/${jobId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showMessage(FRIENDLY_MESSAGES.actions.pause.success(jobName), 'success');
                setTimeout(refreshSchedulerStatus, 1000);
            } else {
                showMessage(FRIENDLY_MESSAGES.actions.pause.error(jobName), 'error');
            }
        })
        .catch(error => {
            console.error('Błąd wstrzymywania zadania:', error);
            showMessage(FRIENDLY_MESSAGES.errors.network, 'error');
        });
}

/**
 * Wznowienie zadania
 */
function resumeJob(jobId) {
    const jobName = FRIENDLY_MESSAGES.jobs[jobId] || jobId;

    showMessage('▶️ Wznawianie zadania...', 'info');

    fetch(`/scheduler/api/job/resume/${jobId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showMessage(FRIENDLY_MESSAGES.actions.resume.success(jobName), 'success');
                setTimeout(refreshSchedulerStatus, 1000);
            } else {
                showMessage(FRIENDLY_MESSAGES.actions.resume.error(jobName), 'error');
            }
        })
        .catch(error => {
            console.error('Błąd wznawiania zadania:', error);
            showMessage(FRIENDLY_MESSAGES.errors.network, 'error');
        });
}

/**
 * Aktualizacja konfiguracji
 */
function updateConfig(key, value) {
    // Konwertuj boolean na string dla checkboxów
    if (typeof value === 'boolean') {
        value = value ? 'true' : 'false';
    }

    fetch('/scheduler/api/config/update', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            key: key,
            value: value
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Użyj przyjaznych komunikatów
                let message;
                const configMessages = FRIENDLY_MESSAGES.config[key];

                if (typeof configMessages === 'object' && configMessages[value]) {
                    message = configMessages[value];
                } else if (typeof configMessages === 'function') {
                    message = configMessages(value);
                } else {
                    message = '✅ Ustawienie zostało zaktualizowane pomyślnie';
                }

                showMessage(message, 'success');
            } else {
                showMessage('❌ ' + data.message, 'error');
                revertConfigField(key);
            }
        })
        .catch(error => {
            console.error('Błąd aktualizacji konfiguracji:', error);
            showMessage(FRIENDLY_MESSAGES.errors.network, 'error');
            revertConfigField(key);
        });
}

/**
 * Przywrócenie poprzedniej wartości pola konfiguracji przy błędzie
 */
function revertConfigField(key) {
    // Ta funkcja mogłaby przywrócić poprzednią wartość,
    // ale dla uproszczenia po prostu odświeżamy stronę
    setTimeout(() => {
        location.reload();
    }, 2000);
}

/**
 * Ładowanie logów przypomnień o wycenach
 */
function loadQuoteLogs() {
    const container = document.getElementById('quoteLogs');
    if (!container) return;

    const statusFilter = document.getElementById('statusFilter');
    const status = statusFilter ? statusFilter.value : '';

    container.innerHTML = '<div class="loading-spinner">Ładowanie logów...</div>';

    const params = new URLSearchParams({
        page: currentQuoteLogsPage,
        per_page: LOGS_PER_PAGE,
        status: status
    });

    fetch(`/scheduler/api/logs/quotes?${params}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                renderQuoteLogs(data.logs, data.pagination);
            } else {
                container.innerHTML = `<div class="error-message">${data.message}</div>`;
            }
        })
        .catch(error => {
            console.error('Błąd ładowania logów:', error);
            container.innerHTML = '<div class="error-message">Błąd ładowania logów</div>';
        });
}

/**
 * Renderowanie tabeli logów wycen
 */
function renderQuoteLogs(logs, pagination) {
    const container = document.getElementById('quoteLogs');

    if (logs.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Brak logów do wyświetlenia</p></div>';
        return;
    }

    let html = `
        <div class="logs-table-container">
            <table class="styled-table">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Wycena</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Błąd</th>
                    </tr>
                </thead>
                <tbody>
    `;

    logs.forEach(log => {
        html += `
            <tr>
                <td>${log.sent_at}</td>
                <td>${log.quote_number}</td>
                <td>${log.recipient_email}</td>
                <td><span class="status-badge status-${log.status}">${log.status}</span></td>
                <td>${log.error_message || '-'}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    // Dodaj paginację jeśli potrzebna
    if (pagination.pages > 1) {
        html += renderPagination(pagination, 'quote');
    }

    container.innerHTML = html;
}

/**
 * Ładowanie wszystkich logów systemu
 */
function loadAllLogs() {
    const container = document.getElementById('allLogs');
    if (!container) return;

    const statusFilter = document.getElementById('logStatusFilter');
    const typeFilter = document.getElementById('logTypeFilter');

    const status = statusFilter ? statusFilter.value : '';
    const type = typeFilter ? typeFilter.value : '';

    container.innerHTML = '<div class="loading-spinner">Ładowanie logów...</div>';

    const params = new URLSearchParams({
        page: currentAllLogsPage,
        per_page: LOGS_PER_PAGE,
        status: status,
        type: type
    });

    fetch(`/scheduler/api/logs/quotes?${params}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                renderAllLogs(data.logs, data.pagination);
            } else {
                container.innerHTML = `<div class="error-message">${data.message}</div>`;
            }
        })
        .catch(error => {
            console.error('Błąd ładowania logów:', error);
            container.innerHTML = '<div class="error-message">Błąd ładowania logów</div>';
        });
}

/**
 * Renderowanie tabeli wszystkich logów
 */
function renderAllLogs(logs, pagination) {
    const container = document.getElementById('allLogs');

    if (logs.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Brak logów do wyświetlenia</p></div>';
        return;
    }

    let html = `
        <div class="logs-table-container">
            <table class="styled-table">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Typ</th>
                        <th>Wycena</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Błąd</th>
                    </tr>
                </thead>
                <tbody>
    `;

    logs.forEach(log => {
        const emailType = log.email_type === 'quote_reminder_7_days' ? 'Przypomnienie 7-dni' : log.email_type;
        html += `
            <tr>
                <td>${log.sent_at}</td>
                <td>${emailType}</td>
                <td>${log.quote_number}</td>
                <td>${log.recipient_email}</td>
                <td><span class="status-badge status-${log.status}">${log.status}</span></td>
                <td>${log.error_message || '-'}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    // Dodaj paginację jeśli potrzebna
    if (pagination.pages > 1) {
        html += renderPagination(pagination, 'all');
    }

    container.innerHTML = html;
}

/**
 * Renderowanie paginacji
 */
function renderPagination(pagination, type) {
    let html = '<div class="pagination">';

    // Przycisk poprzedni
    if (pagination.has_prev) {
        html += `<button onclick="changePage(${pagination.page - 1}, '${type}')">← Poprzednia</button>`;
    } else {
        html += `<button disabled>← Poprzednia</button>`;
    }

    // Numery stron (tylko kilka around current page)
    const startPage = Math.max(1, pagination.page - 2);
    const endPage = Math.min(pagination.pages, pagination.page + 2);

    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === pagination.page ? ' active' : '';
        html += `<button class="${activeClass}" onclick="changePage(${i}, '${type}')">${i}</button>`;
    }

    // Przycisk następny
    if (pagination.has_next) {
        html += `<button onclick="changePage(${pagination.page + 1}, '${type}')">Następna →</button>`;
    } else {
        html += `<button disabled>Następna →</button>`;
    }

    html += '</div>';
    return html;
}

/**
 * Zmiana strony w paginacji
 */
function changePage(page, type) {
    if (type === 'quote') {
        currentQuoteLogsPage = page;
        loadQuoteLogs();
    } else if (type === 'all') {
        currentAllLogsPage = page;
        loadAllLogs();
    }
}

/**
 * Odświeżenie logów wycen
 */
function refreshQuoteLogs() {
    currentQuoteLogsPage = 1;
    loadQuoteLogs();
}

/**
 * Odświeżenie wszystkich logów
 */
function refreshAllLogs() {
    currentAllLogsPage = 1;
    loadAllLogs();
}

/**
 * Odświeżenie statusu schedulera
 */
function refreshSchedulerStatus() {
    fetch('/scheduler/api/stats/refresh')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Moglibyśmy zaktualizować konkretne elementy na stronie
                // Dla uproszczenia, po prostu pokazujemy komunikat
                showMessage('Status odświeżony', 'success');
            }
        })
        .catch(error => {
            console.error('Błąd odświeżania statusu:', error);
        });
}

/**
 * Automatyczne odświeżanie co 30 sekund (tylko dla zakładki przegląd)
 */
function initializeAutoRefresh() {
    setInterval(() => {
        const activeTab = document.querySelector('.tab.active');
        if (activeTab && activeTab.getAttribute('data-tab') === 'overview-tab') {
            refreshSchedulerStatus();
        }
    }, 30000); // 30 sekund
}

/**
 * Wyświetlanie komunikatów flash
 */
function showMessage(message, type) {
    // Usuń istniejące komunikaty
    const existingMessages = document.querySelectorAll('.temp-flash-message');
    existingMessages.forEach(msg => msg.remove());

    // Utwórz nowy komunikat
    const messageDiv = document.createElement('div');
    messageDiv.className = `temp-flash-message flash flash-${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1000;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideInRight 0.3s ease;
    `;

    // Dodaj style dla różnych typów
    if (type === 'success') {
        messageDiv.style.backgroundColor = '#d4edda';
        messageDiv.style.color = '#155724';
        messageDiv.style.border = '1px solid #c3e6cb';
    } else if (type === 'error') {
        messageDiv.style.backgroundColor = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.style.border = '1px solid #f5c6cb';
    } else {
        messageDiv.style.backgroundColor = '#d1ecf1';
        messageDiv.style.color = '#0c5460';
        messageDiv.style.border = '1px solid #bee5eb';
    }

    document.body.appendChild(messageDiv);

    // Usuń komunikat po 4 sekundach
    setTimeout(() => {
        messageDiv.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
            }
        }, 300);
    }, 4000);
}

// Dodaj animacje CSS dla komunikatów
if (!document.getElementById('scheduler-animations')) {
    const style = document.createElement('style');
    style.id = 'scheduler-animations';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Funkcje pomocnicze do debugowania (tylko dev)
 */
window.schedulerDebug = {
    triggerJob: triggerJob,
    loadQuoteLogs: loadQuoteLogs,
    refreshStatus: refreshSchedulerStatus,
    showMessage: showMessage
};