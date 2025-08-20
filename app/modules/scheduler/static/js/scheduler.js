/**
 * SCHEDULER MODULE - JavaScript functionality
 * Obsługuje interfejs administracyjny dla systemu automatyzacji
 */

// ==========================================
// SYSTEM LOGOWANIA - KONFIGURACJA
// ==========================================
const DEBUG_ENABLED = true; // Zmień na true aby włączyć logi

function debugLog(message, data = null) {
    if (DEBUG_ENABLED) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] [SCHEDULER] ${message}`, data || '');
    }
}

debugLog('🚀 Inicjalizacja modułu scheduler');

// ==========================================
// GLOBALNE ZMIENNE
// ==========================================
let currentQuoteLogsPage = 1;
let currentAllLogsPage = 1;
const LOGS_PER_PAGE = 20;

debugLog('📊 Ustawione zmienne globalne', {
    LOGS_PER_PAGE,
    currentQuoteLogsPage,
    currentAllLogsPage
});

// ==========================================
// KOMUNIKATY I KONFIGURACJA
// ==========================================
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
        'quote_check_daily': 'Sprawdzanie wycen do przypomnienia',
        'email_send_daily': 'Wysyłka zaplanowanych emaili',  // ZMIENIONE z 'email_send_hourly'
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

debugLog('💬 Załadowane komunikaty systemowe', { messagesCount: Object.keys(FRIENDLY_MESSAGES).length });

// ==========================================
// INICJALIZACJA PO ZAŁADOWANIU DOM
// ==========================================
// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', function () {
    debugLog('🔄 DOM załadowany - rozpoczynam inicjalizację');

    initializeTabs();
    loadQuoteLogs();
    loadAllLogs();
    initializeAutoRefresh();

    // Event listenery dla filtrów
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
        debugLog('🔍 Dodaję listener dla filtru statusu');
        statusFilter.addEventListener('change', function () {
            debugLog('🔍 Zmiana filtru statusu', { newValue: this.value });
            currentQuoteLogsPage = 1;
            loadQuoteLogs();
        });
    }

    const logStatusFilter = document.getElementById('logStatusFilter');
    if (logStatusFilter) {
        debugLog('🔍 Dodaję listener dla filtru statusu logów');
        logStatusFilter.addEventListener('change', function () {
            debugLog('🔍 Zmiana filtru statusu logów', { newValue: this.value });
            currentAllLogsPage = 1;
            loadAllLogs();
        });
    }

    const logTypeFilter = document.getElementById('logTypeFilter');
    if (logTypeFilter) {
        debugLog('🔍 Dodaję listener dla filtru typu logów');
        logTypeFilter.addEventListener('change', function () {
            debugLog('🔍 Zmiana filtru typu logów', { newValue: this.value });
            currentAllLogsPage = 1;
            loadAllLogs();
        });
    }

    debugLog('✅ Inicjalizacja zakończona pomyślnie');
});

// ==========================================
// SYSTEM ZAKŁADEK
// ==========================================
/**
 * Prosta inicjalizacja zakładek schedulera
 */
function initializeSchedulerTabs() {
    debugLog('📑 Inicjalizacja prostych zakładek schedulera');

    // Znajdź wszystkie zakładki schedulera
    const schedulerTabs = document.querySelectorAll('.scheduler-tab');

    debugLog('📑 Znalezione zakładki schedulera', { count: schedulerTabs.length });

    if (schedulerTabs.length === 0) {
        debugLog('📑 Brak zakładek schedulera');
        return;
    }

    schedulerTabs.forEach((tab, index) => {
        tab.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const targetId = this.getAttribute('data-scheduler-target');
            debugLog('📑 Kliknięto zakładkę schedulera', { targetId, index });

            // Usuń aktywne klasy ze wszystkich zakładek schedulera
            schedulerTabs.forEach(t => {
                t.classList.remove('scheduler-tab-active');
                t.style.background = '#f8f9fa';
                t.style.color = '#666';
            });

            // Ukryj wszystkie contentery schedulera
            document.querySelectorAll('.scheduler-content').forEach(content => {
                content.style.display = 'none';
                content.classList.remove('scheduler-content-active');
            });

            // Aktywuj klikniętą zakładkę
            this.classList.add('scheduler-tab-active');
            this.style.background = '#ED6B24';
            this.style.color = 'white';

            // Pokaż odpowiedni content
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.style.display = 'block';
                targetContent.classList.add('scheduler-content-active');
                debugLog('📑 Pokazano content schedulera', { targetId });

                // Załaduj dane jeśli potrzebne
                if (targetId === 'scheduler-content-quotes') {
                    debugLog('📑 Ładowanie logów wycen');
                    loadQuoteLogs();
                } else if (targetId === 'scheduler-content-logs') {
                    debugLog('📑 Ładowanie wszystkich logów');
                    loadAllLogs();
                }
            } else {
                debugLog('❌ Nie znaleziono content schedulera', { targetId });
            }
        });
    });

    debugLog('✅ Zakładki schedulera zainicjalizowane');
}

/**
 * STARA FUNKCJA - teraz tylko wywołuje nową
 */
function initializeTabs() {
    initializeSchedulerTabs();
}

/**
 * Upewnia się że główna zakładka "Automatyzacje" pozostaje aktywna
 */
function maintainMainTabActive() {
    debugLog('🔒 Sprawdzam czy główna zakładka Automatyzacje jest aktywna');

    // Znajdź główną zakładkę Automatyzacje
    const mainAutomationTab = document.querySelector('.tab[data-tab="scheduler-settings"]');
    const mainAutomationContent = document.getElementById('scheduler-settings');

    if (mainAutomationTab && mainAutomationContent) {
        // Upewnij się że główna zakładka jest aktywna
        if (!mainAutomationTab.classList.contains('active')) {
            debugLog('🔒 Przywracam aktywność głównej zakładki Automatyzacje');

            // Usuń active ze wszystkich głównych zakładek
            document.querySelectorAll('.tabs .tab').forEach(tab => {
                tab.classList.remove('active');
            });

            // Ukryj wszystkie główne content
            document.querySelectorAll('.tab-content').forEach(content => {
                if (!content.classList.contains('scheduler-tab-content')) { // Nie dotykaj zakładek schedulera
                    content.classList.remove('active');
                }
            });

            // Aktywuj zakładkę Automatyzacje
            mainAutomationTab.classList.add('active');
            mainAutomationContent.classList.add('active');

            debugLog('✅ Przywrócono aktywność głównej zakładki Automatyzacje');
        } else {
            debugLog('✅ Główna zakładka Automatyzacje już aktywna');
        }
    } else {
        debugLog('❌ Nie znaleziono głównej zakładki Automatyzacje');
    }
}



// ==========================================
// ZARZĄDZANIE ZADANIAMI
// ==========================================
function triggerJob(jobId) {
    debugLog('🚀 Rozpoczynam uruchamianie zadania', { jobId });

    const jobName = FRIENDLY_MESSAGES.jobs[jobId] || jobId;
    debugLog('🚀 Nazwa zadania', { jobName });

    if (!confirm(FRIENDLY_MESSAGES.confirmations.trigger_job(jobName))) {
        debugLog('🚀 Użytkownik anulował uruchomienie zadania');
        return;
    }

    showMessage('🔄 Uruchamianie zadania...', 'info');

    fetch(`/scheduler/api/job/trigger/${jobId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => {
            debugLog('🚀 Odpowiedź serwera na trigger job', { status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('🚀 Dane z serwera trigger job', data);
            if (data.success) {
                showMessage(FRIENDLY_MESSAGES.actions.trigger.success(jobName), 'success');
                setTimeout(() => {
                    debugLog('🚀 Odświeżam status po uruchomieniu zadania');
                    refreshSchedulerStatus();
                }, 2000);
            } else {
                showMessage(FRIENDLY_MESSAGES.actions.trigger.error(jobName), 'error');
            }
        })
        .catch(error => {
            debugLog('❌ Błąd podczas uruchamiania zadania', { error: error.message });
            console.error('Błąd uruchamiania zadania:', error);
            showMessage(FRIENDLY_MESSAGES.errors.network, 'error');
        });
}

function pauseJob(jobId) {
    debugLog('⏸️ Rozpoczynam wstrzymywanie zadania', { jobId });

    const jobName = FRIENDLY_MESSAGES.jobs[jobId] || jobId;

    if (!confirm(FRIENDLY_MESSAGES.confirmations.pause_job(jobName))) {
        debugLog('⏸️ Użytkownik anulował wstrzymanie zadania');
        return;
    }

    showMessage('⏸️ Wstrzymywanie zadania...', 'info');

    fetch(`/scheduler/api/job/pause/${jobId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => {
            debugLog('⏸️ Odpowiedź serwera na pause job', { status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('⏸️ Dane z serwera pause job', data);
            if (data.success) {
                showMessage(FRIENDLY_MESSAGES.actions.pause.success(jobName), 'success');

                // AUTOMATYCZNE ODŚWIEŻENIE PO 1 SEKUNDZIE
                setTimeout(() => {
                    debugLog('⏸️ Automatyczne odświeżenie strony po wstrzymaniu zadania');
                    location.reload();
                }, 1000);
            } else {
                showMessage(FRIENDLY_MESSAGES.actions.pause.error(jobName), 'error');
            }
        })
        .catch(error => {
            debugLog('❌ Błąd podczas wstrzymywania zadania', { error: error.message });
            console.error('Błąd wstrzymywania zadania:', error);
            showMessage(FRIENDLY_MESSAGES.errors.network, 'error');
        });
}

function resumeJob(jobId) {
    debugLog('▶️ Rozpoczynam wznawianie zadania', { jobId });

    const jobName = FRIENDLY_MESSAGES.jobs[jobId] || jobId;

    showMessage('▶️ Wznawianie zadania...', 'info');

    fetch(`/scheduler/api/job/resume/${jobId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => {
            debugLog('▶️ Odpowiedź serwera na resume job', { status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('▶️ Dane z serwera resume job', data);
            if (data.success) {
                showMessage(FRIENDLY_MESSAGES.actions.resume.success(jobName), 'success');

                // AUTOMATYCZNE ODŚWIEŻENIE PO 1 SEKUNDZIE
                setTimeout(() => {
                    debugLog('▶️ Automatyczne odświeżenie strony po wznowieniu zadania');
                    location.reload();
                }, 1000);
            } else {
                showMessage(FRIENDLY_MESSAGES.actions.resume.error(jobName), 'error');
            }
        })
        .catch(error => {
            debugLog('❌ Błąd podczas wznawiania zadania', { error: error.message });
            console.error('Błąd wznawiania zadania:', error);
            showMessage(FRIENDLY_MESSAGES.errors.network, 'error');
        });
}

// ==========================================
// ZARZĄDZANIE USTAWIENIAMI
// ==========================================
function saveSchedulerSettings(event) {
    event.preventDefault();
    debugLog('💾 Rozpoczynam zapisywanie ustawień schedulera');

    const form = document.getElementById('schedulerSettingsForm');
    const saveBtn = document.getElementById('saveSettingsBtn');
    const statusDiv = document.getElementById('settingsStatus');

    // Pobierz dane z formularza
    const formData = new FormData(form);
    const settings = {};

    // Konwertuj dane formularza - DODANO NOWE POLA
    settings['quote_reminder_enabled'] = formData.get('quote_reminder_enabled') ? 'true' : 'false';
    settings['quote_reminder_days'] = formData.get('quote_reminder_days');
    settings['quote_reminder_max_days'] = formData.get('quote_reminder_max_days');  // NOWE
    settings['daily_check_hour'] = formData.get('daily_check_hour');
    settings['email_send_delay'] = formData.get('email_send_delay');  // NOWE
    settings['max_reminder_attempts'] = formData.get('max_reminder_attempts');

    debugLog('💾 Pobrane ustawienia z formularza', settings);

    // ROZSZERZONA WALIDACJA
    const reminderDays = parseInt(settings['quote_reminder_days']);
    const reminderMaxDays = parseInt(settings['quote_reminder_max_days']);
    const checkHour = parseInt(settings['daily_check_hour']);
    const emailDelay = parseInt(settings['email_send_delay']);
    const maxAttempts = parseInt(settings['max_reminder_attempts']);

    debugLog('💾 Walidacja ustawień', { reminderDays, reminderMaxDays, checkHour, emailDelay, maxAttempts });

    // Walidacja zakresu dni
    if (reminderDays < 1 || reminderDays > 30) {
        debugLog('❌ Walidacja nieudana - nieprawidłowa liczba dni minimum', { reminderDays });
        showSettingsStatus('❌ Minimum dni musi być z zakresu 1-30', 'error');
        return;
    }

    if (reminderMaxDays < 7 || reminderMaxDays > 90) {
        debugLog('❌ Walidacja nieudana - nieprawidłowa liczba dni maksimum', { reminderMaxDays });
        showSettingsStatus('❌ Maksimum dni musi być z zakresu 7-90', 'error');
        return;
    }

    // Sprawdź logikę min/max
    if (reminderDays >= reminderMaxDays) {
        debugLog('❌ Walidacja nieudana - minimum >= maksimum', { reminderDays, reminderMaxDays });
        showSettingsStatus('❌ Minimum dni musi być mniejsze niż maksimum', 'error');
        return;
    }

    if (checkHour < 0 || checkHour > 23) {
        debugLog('❌ Walidacja nieudana - nieprawidłowa godzina', { checkHour });
        showSettingsStatus('❌ Godzina musi być z zakresu 0-23', 'error');
        return;
    }

    if (emailDelay < 1 || emailDelay > 24) {
        debugLog('❌ Walidacja nieudana - nieprawidłowe opóźnienie', { emailDelay });
        showSettingsStatus('❌ Opóźnienie musi być z zakresu 1-24 godzin', 'error');
        return;
    }

    if (maxAttempts < 1 || maxAttempts > 10) {
        debugLog('❌ Walidacja nieudana - nieprawidłowa liczba prób', { maxAttempts });
        showSettingsStatus('❌ Liczba prób musi być z zakresu 1-10', 'error');
        return;
    }

    debugLog('✅ Walidacja przeszła pomyślnie');

    // Wyłącz przycisk i pokaż loading
    saveBtn.disabled = true;
    saveBtn.innerHTML = '⏳ Zapisywanie...';
    showSettingsStatus('💾 Zapisywanie ustawień...', 'info');

    debugLog('💾 Rozpoczynam wysyłanie ustawień do serwera');

    // Wyślij wszystkie ustawienia jednocześnie
    saveAllSettings(settings)
        .then(results => {
            debugLog('💾 Otrzymano wyniki zapisywania', results);

            // Sprawdź czy wszystkie zapisały się pomyślnie
            const allSuccess = results.every(result => result.success);

            if (allSuccess) {
                debugLog('✅ Wszystkie ustawienia zapisane pomyślnie');
                showSettingsStatus('✅ Wszystkie ustawienia zostały zapisane pomyślnie', 'success');

                // Komunikaty o zmianach
                if (results.some(r => r.key === 'daily_check_hour')) {
                    setTimeout(() => {
                        showSettingsStatus('⏰ Harmonogram sprawdzania został zaktualizowany', 'info');
                    }, 2000);
                }

                if (results.some(r => r.key === 'email_send_delay')) {
                    setTimeout(() => {
                        showSettingsStatus('📧 Opóźnienie wysyłki zostało zaktualizowane', 'info');
                    }, 3000);
                }
            } else {
                const errors = results.filter(r => !r.success);
                debugLog('❌ Błędy podczas zapisywania', errors);
                showSettingsStatus(`❌ Błąd zapisywania: ${errors[0].message}`, 'error');
            }
        })
        .catch(error => {
            debugLog('❌ Krytyczny błąd podczas zapisywania ustawień', { error: error.message });
            console.error('Błąd zapisywania ustawień:', error);
            showSettingsStatus('🔧 Wystąpił błąd połączenia. Spróbuj ponownie.', 'error');
        })
        .finally(() => {
            debugLog('💾 Zakończono proces zapisywania - przywracam interfejs');
            // Przywróć przycisk
            saveBtn.disabled = false;
            saveBtn.innerHTML = '💾 Zapisz ustawienia';
        });
}

async function saveAllSettings(settings) {
    debugLog('💾 Zapisuję wszystkie ustawienia równolegle');
    const promises = [];

    for (const [key, value] of Object.entries(settings)) {
        debugLog('💾 Przygotowuję zapytanie dla ustawienia', { key, value });

        const promise = fetch('/scheduler/api/config/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                key: key,
                value: value
            })
        })
            .then(response => {
                debugLog('💾 Odpowiedź dla ustawienia', { key, status: response.status });
                return response.json();
            })
            .then(data => {
                debugLog('💾 Dane z serwera dla ustawienia', { key, data });
                return { ...data, key: key };
            })
            .catch(error => {
                debugLog('❌ Błąd dla ustawienia', { key, error: error.message });
                return {
                    success: false,
                    message: `Błąd dla ${key}: ${error.message}`,
                    key: key
                };
            });

        promises.push(promise);
    }

    const results = await Promise.all(promises);
    debugLog('💾 Wszystkie zapytania zakończone', { resultsCount: results.length });
    return results;
}

function resetSettingsForm() {
    debugLog('🔄 Resetowanie formularza ustawień');

    if (!confirm('Czy na pewno chcesz przywrócić pierwotne wartości? Niezapisane zmiany zostaną utracone.')) {
        debugLog('🔄 Użytkownik anulował reset formularza');
        return;
    }

    const form = document.getElementById('schedulerSettingsForm');
    form.reset();

    debugLog('✅ Formularz zresetowany');
    showSettingsStatus('🔄 Formularz został zresetowany', 'info');
}

function showSettingsStatus(message, type) {
    debugLog('💭 Pokazuję status ustawień', { message, type });

    const statusDiv = document.getElementById('settingsStatus');

    // Ustal kolory dla różnych typów
    let color = '#666';
    if (type === 'success') color = '#28a745';
    else if (type === 'error') color = '#dc3545';
    else if (type === 'info') color = '#17a2b8';

    statusDiv.innerHTML = message;
    statusDiv.style.color = color;
    statusDiv.style.fontWeight = '500';

    // Ukryj komunikat po 5 sekundach (tylko dla success i info)
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            debugLog('💭 Ukrywam komunikat status', { afterSeconds: 5 });
            statusDiv.innerHTML = '';
        }, 5000);
    }
}

// ==========================================
// ŁADOWANIE LOGÓW
// ==========================================
function loadQuoteLogs() {
    debugLog('📄 Rozpoczynam ładowanie logów wycen');

    const container = document.getElementById('quoteLogs');
    if (!container) {
        debugLog('❌ Nie znaleziono kontenera quoteLogs');
        return;
    }

    const statusFilter = document.getElementById('statusFilter');
    const status = statusFilter ? statusFilter.value : '';

    debugLog('📄 Parametry ładowania logów wycen', {
        page: currentQuoteLogsPage,
        perPage: LOGS_PER_PAGE,
        status
    });

    container.innerHTML = '<div class="loading-spinner">Ładowanie logów...</div>';

    const params = new URLSearchParams({
        page: currentQuoteLogsPage,
        per_page: LOGS_PER_PAGE,
        status: status
    });

    fetch(`/scheduler/api/logs/quotes?${params}`)
        .then(response => {
            debugLog('📄 Odpowiedź serwera na logi wycen', { status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('📄 Dane logów wycen z serwera', {
                success: data.success,
                logsCount: data.logs ? data.logs.length : 0
            });

            if (data.success) {
                renderQuoteLogs(data.logs, data.pagination);
            } else {
                container.innerHTML = `<div class="error-message">${data.message}</div>`;
            }
        })
        .catch(error => {
            debugLog('❌ Błąd ładowania logów wycen', { error: error.message });
            console.error('Błąd ładowania logów:', error);
            container.innerHTML = '<div class="error-message">Błąd ładowania logów</div>';
        });
}

function renderQuoteLogs(logs, pagination) {
    debugLog('🎨 Renderowanie logów wycen', {
        logsCount: logs.length,
        currentPage: pagination.page,
        totalPages: pagination.pages
    });

    const container = document.getElementById('quoteLogs');

    if (logs.length === 0) {
        debugLog('📄 Brak logów do wyświetlenia');
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

    logs.forEach((log, index) => {
        debugLog(`🎨 Renderowanie loga ${index + 1}`, {
            quoteNumber: log.quote_number,
            status: log.status
        });

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
        debugLog('🎨 Dodaję paginację', { totalPages: pagination.pages });
        html += renderPagination(pagination, 'quote');
    }

    container.innerHTML = html;
    debugLog('✅ Logi wycen wyrenderowane pomyślnie');
}

function loadAllLogs() {
    debugLog('📄 Rozpoczynam ładowanie wszystkich logów');

    const container = document.getElementById('allLogs');
    if (!container) {
        debugLog('❌ Nie znaleziono kontenera allLogs');
        return;
    }

    const statusFilter = document.getElementById('logStatusFilter');
    const typeFilter = document.getElementById('logTypeFilter');

    const status = statusFilter ? statusFilter.value : '';
    const type = typeFilter ? typeFilter.value : '';

    debugLog('📄 Parametry ładowania wszystkich logów', {
        page: currentAllLogsPage,
        perPage: LOGS_PER_PAGE,
        status,
        type
    });

    container.innerHTML = '<div class="loading-spinner">Ładowanie logów...</div>';

    const params = new URLSearchParams({
        page: currentAllLogsPage,
        per_page: LOGS_PER_PAGE,
        status: status,
        type: type
    });

    fetch(`/scheduler/api/logs/quotes?${params}`)
        .then(response => {
            debugLog('📄 Odpowiedź serwera na wszystkie logi', { status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('📄 Dane wszystkich logów z serwera', {
                success: data.success,
                logsCount: data.logs ? data.logs.length : 0
            });

            if (data.success) {
                renderAllLogs(data.logs, data.pagination);
            } else {
                container.innerHTML = `<div class="error-message">${data.message}</div>`;
            }
        })
        .catch(error => {
            debugLog('❌ Błąd ładowania wszystkich logów', { error: error.message });
            console.error('Błąd ładowania logów:', error);
            container.innerHTML = '<div class="error-message">Błąd ładowania logów</div>';
        });
}

function renderAllLogs(logs, pagination) {
    debugLog('🎨 Renderowanie wszystkich logów', {
        logsCount: logs.length,
        currentPage: pagination.page,
        totalPages: pagination.pages
    });

    const container = document.getElementById('allLogs');

    if (logs.length === 0) {
        debugLog('📄 Brak wszystkich logów do wyświetlenia');
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

    logs.forEach((log, index) => {
        const emailType = log.email_type === 'quote_reminder_7_days' ? 'Przypomnienie 7-dni' : log.email_type;

        debugLog(`🎨 Renderowanie wszystkich logów ${index + 1}`, {
            type: emailType,
            status: log.status
        });

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
        debugLog('🎨 Dodaję paginację dla wszystkich logów', { totalPages: pagination.pages });
        html += renderPagination(pagination, 'all');
    }

    container.innerHTML = html;
    debugLog('✅ Wszystkie logi wyrenderowane pomyślnie');
}

// ==========================================
// PAGINACJA
// ==========================================
function renderPagination(pagination, type) {
    debugLog('🔢 Renderowanie paginacji', { type, currentPage: pagination.page, totalPages: pagination.pages });

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
    debugLog('✅ Paginacja wyrenderowana');
    return html;
}

function changePage(page, type) {
    debugLog('🔢 Zmiana strony', { page, type });

    if (type === 'quote') {
        currentQuoteLogsPage = page;
        debugLog('🔢 Ładowanie nowej strony logów wycen', { page });
        loadQuoteLogs();
    } else if (type === 'all') {
        currentAllLogsPage = page;
        debugLog('🔢 Ładowanie nowej strony wszystkich logów', { page });
        loadAllLogs();
    }
}

// ==========================================
// ODŚWIEŻANIE DANYCH
// ==========================================
function refreshQuoteLogs() {
    debugLog('🔄 Odświeżanie logów wycen');
    currentQuoteLogsPage = 1;
    loadQuoteLogs();
}

function refreshAllLogs() {
    debugLog('🔄 Odświeżanie wszystkich logów');
    currentAllLogsPage = 1;
    loadAllLogs();
}

function refreshSchedulerStatus() {
    debugLog('🔄 Odświeżanie statusu schedulera');

    fetch('/scheduler/api/stats/refresh')
        .then(response => {
            debugLog('🔄 Odpowiedź serwera na odświeżenie statusu', { status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('🔄 Dane odświeżenia statusu', data);
            if (data.success) {
                showMessage('Status odświeżony', 'success');
            }
        })
        .catch(error => {
            debugLog('❌ Błąd odświeżania statusu', { error: error.message });
            console.error('Błąd odświeżania statusu:', error);
        });
}

// ==========================================
// AUTO-ODŚWIEŻANIE
// ==========================================
function initializeAutoRefresh() {
    debugLog('⏰ Inicjalizacja auto-odświeżania (co 30s)');

    setInterval(() => {
        const activeTab = document.querySelector('.tab.active');
        if (activeTab && activeTab.getAttribute('data-tab') === 'overview-tab') {
            debugLog('⏰ Auto-odświeżanie statusu schedulera');
            refreshSchedulerStatus();
        }
    }, 30000); // 30 sekund
}

// ==========================================
// SYSTEM KOMUNIKATÓW
// ==========================================
function showMessage(message, type) {
    debugLog('💬 Pokazuję komunikat', { message, type });

    // Usuń istniejące komunikaty
    const existingMessages = document.querySelectorAll('.temp-flash-message');
    if (existingMessages.length > 0) {
        debugLog('💬 Usuwam istniejące komunikaty', { count: existingMessages.length });
        existingMessages.forEach(msg => msg.remove());
    }

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
    debugLog('💬 Komunikat dodany do DOM');

    // Usuń komunikat po 4 sekundach
    setTimeout(() => {
        debugLog('💬 Ukrywam komunikat po 4 sekundach');
        messageDiv.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
                debugLog('💬 Komunikat usunięty z DOM');
            }
        }, 300);
    }, 4000);
}

// ==========================================
// STYLOWANIE ANIMACJI
// ==========================================
if (!document.getElementById('scheduler-animations')) {
    debugLog('🎨 Dodaję style animacji komunikatów');

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
    debugLog('✅ Style animacji dodane');
}

// ==========================================
// FUNKCJE LEGACY (DLA KOMPATYBILNOŚCI)
// ==========================================
function updateConfig(key, value) {
    debugLog('⚠️ Użycie przestarzałej funkcji updateConfig', { key, value });
    console.warn('updateConfig() jest przestarzałe. Użyj saveSchedulerSettings() zamiast tego.');

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
        .then(response => {
            debugLog('⚠️ Odpowiedź legacy updateConfig', { status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('⚠️ Dane legacy updateConfig', data);
            if (data.success) {
                showMessage(data.message, 'success');
            } else {
                showMessage('❌ ' + data.message, 'error');
            }
        })
        .catch(error => {
            debugLog('❌ Błąd legacy updateConfig', { error: error.message });
            console.error('Błąd aktualizacji konfiguracji:', error);
            showMessage(FRIENDLY_MESSAGES.errors.network, 'error');
        });
}

// ==========================================
// NOWE FUNKCJE - WYSYŁANIE PRÓBNEGO MAILA
// ==========================================
function sendTestEmail() {
    debugLog('📧 Rozpoczynam wysyłanie próbnego maila przypomnienia o wycenie');

    const quoteId = prompt('Podaj ID wyceny do wysłania próbnego przypomnienia:');
    if (!quoteId) {
        debugLog('📧 Użytkownik anulował wysyłanie próbnego maila');
        return;
    }

    // Walidacja czy to liczba
    const quoteIdNum = parseInt(quoteId);
    if (isNaN(quoteIdNum) || quoteIdNum <= 0) {
        debugLog('❌ Nieprawidłowe ID wyceny', { quoteId });
        showMessage('❌ ID wyceny musi być liczbą większą od 0', 'error');
        return;
    }

    if (!confirm(`Czy na pewno chcesz wysłać próbne przypomnienie o wycenie ID: ${quoteIdNum}?\n\nMail zostanie wysłany na prawdziwy adres klienta z tej wyceny!`)) {
        debugLog('📧 Użytkownik anulował potwierdzenie wysyłki próbnego maila');
        return;
    }

    debugLog('📧 Wysyłam próbny mail przypomnienia o wycenie', { quoteId: quoteIdNum });
    showMessage('📧 Wysyłanie próbnego przypomnienia o wycenie...', 'info');

    fetch('/scheduler/api/test/send-quote-reminder', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            quote_id: quoteIdNum
        })
    })
        .then(response => {
            debugLog('📧 Odpowiedź serwera na próbny mail wyceny', { status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('📧 Dane próbnego maila wyceny z serwera', data);
            if (data.success) {
                showMessage(`✅ ${data.message}`, 'success');
            } else {
                showMessage(`❌ Błąd: ${data.message}`, 'error');
            }
        })
        .catch(error => {
            debugLog('❌ Błąd wysyłania próbnego maila wyceny', { error: error.message });
            console.error('Błąd wysyłania próbnego maila wyceny:', error);
            showMessage('🔧 Wystąpił błąd podczas wysyłania maila', 'error');
        });
}

// ==========================================
// FUNKCJE DEBUGOWANIA (DEV ONLY)
// ==========================================
window.schedulerDebug = {
    triggerJob: triggerJob,
    loadQuoteLogs: loadQuoteLogs,
    refreshStatus: refreshSchedulerStatus,
    showMessage: showMessage,
    sendTestEmail: sendTestEmail,
    saveSettings: saveSchedulerSettings,
    toggleDebug: function () {
        window.DEBUG_ENABLED = !DEBUG_ENABLED;
        console.log(`Debug logowanie ${DEBUG_ENABLED ? 'włączone' : 'wyłączone'}`);
    }
};

debugLog('🎉 Moduł scheduler całkowicie załadowany i gotowy do użycia');