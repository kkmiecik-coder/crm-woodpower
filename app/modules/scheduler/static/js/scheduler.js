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
// ZARZĄDZANIE ZADANIAMI - NOWE FUNKCJE
// ==========================================

/**
 * NOWA FUNKCJA: Aktualizuje pojedynczy wiersz zadania w tabeli
 */
function updateJobRow(jobId, newJobData) {
    debugLog('🔄 Aktualizuję wiersz zadania', { jobId, newJobData });

    // Znajdź wiersz z tym zadaniem w tabeli
    const table = document.querySelector('.jobs-table-container table tbody');
    if (!table) {
        debugLog('❌ Nie znaleziono tabeli zadań');
        return;
    }

    // Znajdź wiersz z odpowiednim job ID
    const rows = table.querySelectorAll('tr');
    let targetRow = null;

    for (let row of rows) {
        const jobIdCell = row.querySelector('td:nth-child(1) small');
        if (jobIdCell && jobIdCell.textContent.includes(`ID: ${jobId}`)) {
            targetRow = row;
            break;
        }
    }

    if (!targetRow) {
        debugLog('❌ Nie znaleziono wiersza dla zadania', { jobId });
        return;
    }

    debugLog('✅ Znaleziono wiersz zadania - aktualizuję', { jobId });

    // Aktualizuj komórki
    const cells = targetRow.querySelectorAll('td');

    // Komórka 2: Kolejne sprawdzenie
    if (cells[1]) {
        if (newJobData.is_paused) {
            cells[1].innerHTML = `
                <span style="color: #ff6b35; font-weight: 600;">
                    ⏸️ Wstrzymane
                </span>
            `;
        } else {
            cells[1].innerHTML = `
                <span style="color: #28a745; font-weight: 600;">
                    ${newJobData.next_run}
                </span>
            `;
        }
    }

    // Komórka 4: Status
    if (cells[3]) {
        if (newJobData.is_paused) {
            cells[3].innerHTML = `
                <span class="status-badge" style="background: #fff3cd; color: #856404; border: 1px solid #ffeaa7;">
                    ⏸️ Zatrzymane
                </span>
            `;
        } else {
            cells[3].innerHTML = `
                <span class="status-badge status-success">
                    ▶️ Aktywne
                </span>
            `;
        }
    }

    // Komórka 5: Przyciski akcji
    if (cells[4]) {
        const jobName = FRIENDLY_MESSAGES.jobs[jobId] || jobId;

        if (newJobData.is_paused) {
            // Zadanie wstrzymane - pokaż Wznów i Uruchom teraz
            cells[4].innerHTML = `
                <button class="btn-small btn-orange" onclick="resumeJob('${jobId}')">
                    ▶️ Wznów
                </button>
                <button class="btn-small" style="background: #17a2b8; color: white;" onclick="triggerJob('${jobId}')">
                    🚀 Uruchom teraz
                </button>
            `;
        } else {
            // Zadanie aktywne - pokaż Wstrzymaj i Uruchom teraz
            cells[4].innerHTML = `
                <button class="btn-small btn-gray" onclick="pauseJob('${jobId}')">
                    ⏸️ Wstrzymaj
                </button>
                <button class="btn-small btn-orange" onclick="triggerJob('${jobId}')">
                    🚀 Uruchom teraz
                </button>
            `;
        }
    }

    debugLog('✅ Zaktualizowano wiersz zadania', { jobId });
}

/**
 * NOWA FUNKCJA: Pobiera aktualne dane pojedynczego zadania
 */
function refreshSingleJob(jobId) {
    debugLog('🔄 Pobieram aktualne dane zadania', { jobId });

    return fetch('/scheduler/api/job/status/' + jobId)
        .then(response => {
            debugLog('🔄 Odpowiedź serwera na status zadania', { jobId, status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('🔄 Dane zadania z serwera', { jobId, data });
            if (data.success) {
                return data.job;
            } else {
                throw new Error(data.message || 'Nie udało się pobrać danych zadania');
            }
        })
        .catch(error => {
            debugLog('❌ Błąd pobierania danych zadania', { jobId, error: error.message });
            // Fallback - odśwież całą stronę jeśli nie można pobrać pojedynczego zadania
            console.error('Błąd pobierania danych zadania, odświeżam całą stronę:', error);
            location.reload();
            throw error;
        });
}

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

                // NOWE: Aktualizuj tylko ten konkretny wiersz zadania
                setTimeout(() => {
                    debugLog('⏸️ Aktualizuję wiersz zadania po wstrzymaniu');
                    refreshSingleJob(jobId).then(jobData => {
                        updateJobRow(jobId, jobData);
                    }).catch(error => {
                        debugLog('❌ Błąd aktualizacji wiersza, odświeżam całą stronę');
                        location.reload();
                    });
                }, 500);
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

                // NOWE: Aktualizuj tylko ten konkretny wiersz zadania
                setTimeout(() => {
                    debugLog('▶️ Aktualizuję wiersz zadania po wznowieniu');
                    refreshSingleJob(jobId).then(jobData => {
                        updateJobRow(jobId, jobData);
                    }).catch(error => {
                        debugLog('❌ Błąd aktualizacji wiersza, odświeżam całą stronę');
                        location.reload();
                    });
                }, 500);
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
    debugLog('💾 Rozpoczynam zapisywanie parametrów schedulera');

    const form = document.getElementById('schedulerSettingsForm');
    const saveBtn = document.getElementById('saveSettingsBtn');
    const statusDiv = document.getElementById('settingsStatus');

    // Pobierz dane z formularza - ROZSZERZONE o minuty
    const formData = new FormData(form);
    const settings = {};

    // USUNIĘTO: quote_reminder_enabled (kontrolowane przez wstrzymanie/wznowienie zadań)
    settings['quote_reminder_days'] = formData.get('quote_reminder_days');
    settings['quote_reminder_max_days'] = formData.get('quote_reminder_max_days');
    settings['daily_check_hour'] = formData.get('daily_check_hour');
    settings['daily_check_minute'] = formData.get('daily_check_minute');  // NOWE
    settings['email_send_delay'] = formData.get('email_send_delay');
    settings['max_reminder_attempts'] = formData.get('max_reminder_attempts');

    debugLog('💾 Pobrane parametry z formularza', settings);

    // ROZSZERZONA WALIDACJA - dodano minuty
    const reminderDays = parseInt(settings['quote_reminder_days']);
    const reminderMaxDays = parseInt(settings['quote_reminder_max_days']);
    const checkHour = parseInt(settings['daily_check_hour']);
    const checkMinute = parseInt(settings['daily_check_minute']);  // NOWE
    const emailDelay = parseInt(settings['email_send_delay']);
    const maxAttempts = parseInt(settings['max_reminder_attempts']);

    debugLog('💾 Walidacja parametrów', { reminderDays, reminderMaxDays, checkHour, checkMinute, emailDelay, maxAttempts });

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

    // ROZSZERZONA walidacja czasu
    if (checkHour < 0 || checkHour > 23) {
        debugLog('❌ Walidacja nieudana - nieprawidłowa godzina', { checkHour });
        showSettingsStatus('❌ Godzina musi być z zakresu 0-23', 'error');
        return;
    }

    if (checkMinute < 0 || checkMinute > 59) {
        debugLog('❌ Walidacja nieudana - nieprawidłowa minuta', { checkMinute });
        showSettingsStatus('❌ Minuta musi być z zakresu 0-59', 'error');
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
    showSettingsStatus('💾 Zapisywanie parametrów...', 'info');

    debugLog('💾 Rozpoczynam wysyłanie parametrów do serwera');

    // Wyślij wszystkie ustawienia jednocześnie
    saveAllSettings(settings)
        .then(results => {
            debugLog('💾 Otrzymano wyniki zapisywania', results);

            // Sprawdź czy wszystkie zapisały się pomyślnie
            const allSuccess = results.every(result => result.success);

            if (allSuccess) {
                debugLog('✅ Wszystkie parametry zapisane pomyślnie');
                showSettingsStatus('✅ Wszystkie parametry zostały zapisane pomyślnie', 'success');

                // NOWE: Sprawdź czy zmieniono czas i odśwież zadania
                const timeChanged = results.some(r => r.key === 'daily_check_hour') ||
                    results.some(r => r.key === 'daily_check_minute') ||
                    results.some(r => r.key === 'email_send_delay');

                if (timeChanged) {
                    debugLog('⏰ Wykryto zmianę czasu - odświeżam zadania');

                    // Pokaż komunikat o aktualizacji
                    const newTime = `${checkHour.toString().padStart(2, '0')}:${checkMinute.toString().padStart(2, '0')}`;
                    setTimeout(() => {
                        showSettingsStatus(`⏰ Harmonogram sprawdzania został zaktualizowany na ${newTime}`, 'info');
                    }, 4000);

                    // NOWE: Odśwież listę zadań po 2 sekundach
                    setTimeout(() => {
                        debugLog('🔄 Odświeżam listę zadań po zmianie harmonogramu');
                        refreshJobsList();
                    }, 2000);

                    if (results.some(r => r.key === 'email_send_delay')) {
                        setTimeout(() => {
                            showSettingsStatus('📧 Opóźnienie wysyłki zostało zaktualizowane', 'info');
                        }, 7000);
                    }
                }
            } else {
                const errors = results.filter(r => !r.success);
                debugLog('❌ Błędy podczas zapisywania', errors);
                showSettingsStatus(`❌ Błąd zapisywania: ${errors[0].message}`, 'error');
            }
        })
        .catch(error => {
            debugLog('❌ Krytyczny błąd podczas zapisywania parametrów', { error: error.message });
            console.error('Błąd zapisywania parametrów:', error);
            showSettingsStatus('🔧 Wystąpił błąd połączenia. Spróbuj ponownie.', 'error');
        })
        .finally(() => {
            debugLog('💾 Zakończono proces zapisywania - przywracam interfejs');
            // Przywróć przycisk
            saveBtn.disabled = false;
            saveBtn.innerHTML = '💾 Zapisz parametry';
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

    // NOWY TIMING - dłuższe wyświetlanie
    let hideAfter = 6000; // domyślnie 6 sekund

    if (type === 'success') {
        hideAfter = 8000; // sukces - 8 sekund
    } else if (type === 'error') {
        hideAfter = 10000; // błędy - 10 sekund (nie ukrywaj automatycznie)
        return; // Błędy nie znikają automatycznie
    } else if (type === 'info') {
        hideAfter = 6000; // info - 6 sekund
    }

    debugLog('💭 Ustawiono czas ukrywania komunikatu', { type, hideAfter });

    // Ukryj komunikat po określonym czasie (tylko dla success i info)
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            debugLog(`💭 Ukrywam komunikat status po ${hideAfter}ms`);
            statusDiv.innerHTML = '';
        }, hideAfter);
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

/**
 * NOWA FUNKCJA: Odświeża tylko listę zadań w harmonogramie
 */
function refreshJobsList() {
    debugLog('🔄 Rozpoczynam odświeżanie listy zadań');

    fetch('/scheduler/api/stats/refresh')
        .then(response => {
            debugLog('🔄 Odpowiedź serwera na odświeżenie zadań', { status: response.status });
            return response.json();
        })
        .then(data => {
            debugLog('🔄 Dane odświeżenia zadań', data);

            if (data.success && data.scheduler_status && data.scheduler_status.jobs) {
                updateJobsTable(data.scheduler_status.jobs);
                showMessage('🔄 Harmonogram zadań został zaktualizowany', 'info');
            } else {
                debugLog('❌ Błąd w danych odświeżenia zadań', data);
                // Fallback - odśwież całą stronę
                setTimeout(() => {
                    debugLog('🔄 Fallback - odświeżam całą stronę');
                    location.reload();
                }, 1000);
            }
        })
        .catch(error => {
            debugLog('❌ Błąd odświeżania listy zadań', { error: error.message });
            console.error('Błąd odświeżania zadań:', error);

            // Fallback - odśwież całą stronę po 2 sekundach
            setTimeout(() => {
                debugLog('🔄 Fallback po błędzie - odświeżam całą stronę');
                location.reload();
            }, 2000);
        });
}

/**
 * NOWA FUNKCJA: Aktualizuje tylko tabelę zadań bez przeładowania strony
 */
function updateJobsTable(jobs) {
    debugLog('🔄 Aktualizuję tabelę zadań', { jobsCount: jobs.length });

    const tableContainer = document.querySelector('.jobs-table-container');
    if (!tableContainer) {
        debugLog('❌ Nie znaleziono kontenera tabeli zadań');
        return;
    }

    const tableBody = tableContainer.querySelector('table tbody');
    if (!tableBody) {
        debugLog('❌ Nie znaleziono tbody tabeli zadań');
        return;
    }

    // Wyczyść aktualne wiersze
    tableBody.innerHTML = '';

    // Dodaj zaktualizowane wiersze
    jobs.forEach((job, index) => {
        debugLog(`🔄 Aktualizuję zadanie ${index + 1}`, {
            jobId: job.id,
            nextRun: job.next_run,
            isPaused: job.is_paused
        });

        const row = document.createElement('tr');

        // Kolumna 1: Nazwa zadania
        const nameCell = document.createElement('td');
        nameCell.innerHTML = `
            <strong>${job.name}</strong>
            <br><small style="color: #666;">ID: ${job.id}</small>
        `;
        row.appendChild(nameCell);

        // Kolumna 2: Kolejne sprawdzenie
        const nextRunCell = document.createElement('td');
        if (job.is_paused) {
            nextRunCell.innerHTML = `
                <span style="color: #ff6b35; font-weight: 600;">
                    ⏸️ Wstrzymane
                </span>
            `;
        } else {
            nextRunCell.innerHTML = `
                <span style="color: #28a745; font-weight: 600;">
                    ${job.next_run}
                </span>
            `;
        }
        row.appendChild(nextRunCell);

        // Kolumna 3: Częstotliwość
        const triggerCell = document.createElement('td');
        triggerCell.textContent = job.trigger;
        row.appendChild(triggerCell);

        // Kolumna 4: Status
        const statusCell = document.createElement('td');
        if (job.is_paused) {
            statusCell.innerHTML = `
                <span class="status-badge" style="background: #fff3cd; color: #856404; border: 1px solid #ffeaa7;">
                    ⏸️ Zatrzymane
                </span>
            `;
        } else {
            statusCell.innerHTML = `
                <span class="status-badge status-success">
                    ▶️ Aktywne
                </span>
            `;
        }
        row.appendChild(statusCell);

        // Kolumna 5: Przyciski akcji
        const actionsCell = document.createElement('td');
        if (job.is_paused) {
            // Zadanie wstrzymane - pokaż Wznów i Uruchom teraz
            actionsCell.innerHTML = `
                <button class="btn-small btn-orange" onclick="resumeJob('${job.id}')">
                    ▶️ Wznów
                </button>
                <button class="btn-small" style="background: #17a2b8; color: white;" onclick="triggerJob('${job.id}')">
                    🚀 Uruchom teraz
                </button>
            `;
        } else {
            // Zadanie aktywne - pokaż Wstrzymaj i Uruchom teraz
            actionsCell.innerHTML = `
                <button class="btn-small btn-gray" onclick="pauseJob('${job.id}')">
                    ⏸️ Wstrzymaj
                </button>
                <button class="btn-small btn-orange" onclick="triggerJob('${job.id}')">
                    🚀 Uruchom teraz
                </button>
            `;
        }
        row.appendChild(actionsCell);

        tableBody.appendChild(row);
    });

    debugLog('✅ Tabela zadań została zaktualizowana', { updatedJobs: jobs.length });
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

    // NOWY TIMING - różny dla różnych typów komunikatów
    let displayTime = 4000; // domyślnie 4 sekundy

    if (type === 'success') {
        displayTime = 5000; // komunikaty sukcesu - 5 sekund
    } else if (type === 'error') {
        displayTime = 7000; // komunikaty błędów - 7 sekund (dłużej bo ważne)
    } else {
        displayTime = 4000; // info - 4 sekundy
    }

    debugLog('💬 Ustawiono czas wyświetlania komunikatu', { type, displayTime });

    // Usuń komunikat po określonym czasie
    setTimeout(() => {
        debugLog(`💬 Ukrywam komunikat po ${displayTime}ms`);
        messageDiv.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
                debugLog('💬 Komunikat usunięty z DOM');
            }
        }, 300);
    }, displayTime);
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

/**
 * Wymusza restart schedulera - usuwa lock file i restartuje
 */
async function forceRestartScheduler() {
    debugLog('🔥 Wymuszanie restartu schedulera');

    // Potwierdzenie
    const confirmed = confirm(
        '🔥 FORCE RESTART SCHEDULERA\n\n' +
        'Ta operacja:\n' +
        '• Usuwa blokady scheduler\n' +
        '• Zatrzymuje obecny scheduler\n' +
        '• Uruchamia nowy scheduler\n\n' +
        'Czy na pewno chcesz kontynuować?'
    );

    if (!confirmed) {
        debugLog('🔥 Force restart anulowany przez użytkownika');
        return;
    }

    try {
        // Wyświetl status ładowania
        const statusDiv = document.getElementById('settingsStatus');
        if (statusDiv) {
            statusDiv.innerHTML = '<span style="color: #dc3545;">🔥 Restartowanie schedulera...</span>';
        }

        debugLog('🔥 Wysyłanie żądania force restart');

        const response = await fetch('/scheduler/force_restart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        const data = await response.json();
        debugLog('🔥 Odpowiedź serwera:', data);

        if (data.success) {
            // Sukces
            if (statusDiv) {
                statusDiv.innerHTML = '<span style="color: #28a745;">✅ ' + data.message + '</span>';
            }

            // Prostsze powiadomienie bez showFriendlyMessage
            console.log('🔥 Scheduler został zrestartowany pomyślnie!');

            // Odśwież status schedulera po 2 sekundach
            setTimeout(() => {
                if (typeof loadSchedulerStatus === 'function') {
                    loadSchedulerStatus();
                }
                if (statusDiv) {
                    statusDiv.innerHTML = '';
                }
            }, 2000);

        } else {
            // Błąd
            if (statusDiv) {
                statusDiv.innerHTML = '<span style="color: #dc3545;">❌ ' + data.message + '</span>';
            }

            console.error('❌ Błąd restartu: ' + data.message);
        }

    } catch (error) {
        debugLog('🔥 Błąd force restart:', error);

        const statusDiv = document.getElementById('settingsStatus');
        if (statusDiv) {
            statusDiv.innerHTML = '<span style="color: #dc3545;">❌ Błąd połączenia</span>';
        }

        console.error('❌ Błąd połączenia z serwerem');
    }
}

// DODAJ DO app/static/js/main.js lub jako nowy plik admin_settings.js

// === FUNKCJE KOLEJKI PRODUKCYJNEJ ===

// Inicjalizacja po załadowaniu strony
document.addEventListener('DOMContentLoaded', function() {
    // Sprawdź czy jesteśmy na stronie ustawień
    if (window.location.pathname === '/settings') {
        initProductionQueueControls();
    }
});

function initProductionQueueControls() {
    console.log('[Settings] Inicjalizacja kontrolek kolejki produkcyjnej');
    
    // Event listenery dla przycisków
    const manualRenumberBtn = document.getElementById('manualRenumberBtn');
    const queueStructureBtn = document.getElementById('queueStructureBtn');
    const refreshQueueStatsBtn = document.getElementById('refreshQueueStatsBtn');
    
    if (manualRenumberBtn) {
        manualRenumberBtn.addEventListener('click', manualRenumberProductionQueue);
    }
    
    if (queueStructureBtn) {
        queueStructureBtn.addEventListener('click', showQueueStructure);
    }
    
    if (refreshQueueStatsBtn) {
        refreshQueueStatsBtn.addEventListener('click', refreshProductionQueueStats);
    }
    
    // Załaduj początkowe dane
    refreshProductionQueueStats();
    refreshProductionJobStatus();
    
    // Auto-refresh co 30 sekund
    setInterval(() => {
        refreshProductionQueueStats();
        refreshProductionJobStatus();
    }, 30000);
}

function refreshProductionQueueStats() {
    console.log('[Settings] Odświeżanie statystyk kolejki produkcyjnej');
    
    fetch('/scheduler/api/production-queue/stats')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateProductionQueueStats(data.data);
            } else {
                console.error('[Settings] Błąd pobierania statystyk kolejki:', data.error);
                showErrorToast('Błąd pobierania statystyk kolejki');
            }
        })
        .catch(error => {
            console.error('[Settings] Błąd połączenia statystyk kolejki:', error);
        });
}

function updateProductionQueueStats(stats) {
    // Aktualizuj podstawowe statystyki
    const queueLengthElement = document.getElementById('queueLength');
    const lastRenumberElement = document.getElementById('lastRenumber');
    const priorityRangeElement = document.getElementById('priorityRange');
    
    if (queueLengthElement) {
        queueLengthElement.textContent = stats.queue_length || 0;
    }
    
    if (lastRenumberElement) {
        if (stats.last_renumber) {
            const lastRenumberDate = new Date(stats.last_renumber);
            lastRenumberElement.textContent = lastRenumberDate.toLocaleString('pl-PL');
        } else {
            lastRenumberElement.textContent = 'Nigdy';
        }
    }
    
    if (priorityRangeElement) {
        if (stats.priority_range && stats.priority_range.min && stats.priority_range.max) {
            const min = String(stats.priority_range.min).padStart(3, '0');
            const max = String(stats.priority_range.max).padStart(3, '0');
            priorityRangeElement.textContent = `${min} - ${max}`;
        } else {
            priorityRangeElement.textContent = 'Brak danych';
        }
    }
    
    console.log('[Settings] Statystyki kolejki zaktualizowane:', stats);
}

function manualRenumberProductionQueue() {
    const btn = document.getElementById('manualRenumberBtn');
    
    // Potwierdzenie
    if (!confirm('Czy na pewno chcesz przenumerować kolejkę produkcyjną?\n\nTa operacja może potrwać kilka sekund.')) {
        return;
    }
    
    // Wyłącz przycisk
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Przenumerowywanie...';
    }
    
    console.log('[Settings] Ręczne przenumerowanie kolejki');
    
    fetch('/scheduler/api/production-queue/renumber', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log('[Settings] Przenumerowanie zakończone:', data.result);
            showSuccessToast(data.message);
            
            // Odśwież statystyki
            setTimeout(() => {
                refreshProductionQueueStats();
            }, 1000);
            
        } else {
            console.error('[Settings] Błąd przenumerowania:', data.error);
            showErrorToast('Błąd przenumerowania: ' + data.error);
        }
    })
    .catch(error => {
        console.error('[Settings] Błąd połączenia przenumerowania:', error);
        showErrorToast('Błąd połączenia podczas przenumerowania');
    })
    .finally(() => {
        // Przywróć przycisk
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sort-numeric-down"></i> Przenumeruj kolejkę';
        }
    });
}

function showQueueStructure() {
    console.log('[Settings] Pokazywanie struktury kolejki');
    
    fetch('/production/api/queue-structure')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displayQueueStructureModal(data.data);
            } else {
                console.error('[Settings] Błąd pobierania struktury:', data.error);
                showErrorToast('Błąd pobierania struktury kolejki');
            }
        })
        .catch(error => {
            console.error('[Settings] Błąd połączenia struktury:', error);
            showErrorToast('Błąd połączenia');
        });
}

function displayQueueStructureModal(structure) {
    // Utwórz modal z strukturą kolejki
    const modalContent = createQueueStructureContent(structure);
    
    // Usuń poprzedni modal jeśli istnieje
    const existingModal = document.getElementById('queueStructureModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Utwórz nowy modal
    const modal = document.createElement('div');
    modal.id = 'queueStructureModal';
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Struktura kolejki produkcyjnej</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    ${modalContent}
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Zamknij</button>
                </div>
            </div>
        </div>
    `;
    
    // Dodaj do strony i pokaż
    document.body.appendChild(modal);
    
    // Inicjalizuj Bootstrap modal (jeśli używa Bootstrap)
    if (typeof bootstrap !== 'undefined') {
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    } else {
        // Fallback - pokaż jako zwykły div
        modal.style.display = 'block';
        modal.style.position = 'fixed';
        modal.style.top = '10%';
        modal.style.left = '10%';
        modal.style.width = '80%';
        modal.style.height = '80%';
        modal.style.backgroundColor = 'white';
        modal.style.border = '1px solid #ccc';
        modal.style.zIndex = '1000';
        modal.style.padding = '20px';
        modal.style.overflow = 'auto';
        
        // Dodaj przycisk zamknięcia
        const closeBtn = modal.querySelector('.btn-close');
        if (closeBtn) {
            closeBtn.onclick = () => modal.remove();
        }
    }
}

function createQueueStructureContent(structure) {
    if (!structure || Object.keys(structure).length === 0) {
        return '<p class="text-muted">Brak danych w kolejce produkcyjnej.</p>';
    }
    
    let content = '<div class="queue-structure-container">';
    
    // Sortuj grupy według nazwy
    const sortedGroups = Object.entries(structure).sort(([a], [b]) => a.localeCompare(b));
    
    sortedGroups.forEach(([groupName, groupData]) => {
        const [deadlineGroup, materialBatch] = groupName.split('_', 2);
        const restOfName = groupName.substring(deadlineGroup.length + 1);
        
        // Kolor dla grupy deadline
        const deadlineColor = getDeadlineColor(deadlineGroup);
        
        content += `
            <div class="queue-group" style="border-left: 4px solid ${deadlineColor}; margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 6px;">
                <div class="group-header">
                    <h6 style="margin: 0; color: #495057;">
                        <span class="deadline-badge" style="background: ${deadlineColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-right: 10px;">
                            ${deadlineGroup}
                        </span>
                        ${restOfName.replace(/_/g, ' → ')}
                    </h6>
                    <div class="group-stats" style="font-size: 14px; color: #6c757d; margin-top: 5px;">
                        Pozycje: ${groupData.range} | Produkty: ${groupData.count}
                    </div>
                </div>
                
                <div class="group-items" style="margin-top: 10px;">
                    ${groupData.sample_items.map(item => `
                        <div class="queue-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; margin: 3px 0; background: white; border-radius: 4px; font-size: 13px;">
                            <span class="item-position" style="font-weight: 600; color: #007bff; min-width: 40px;">
                                ${String(item.position).padStart(3, '0')}
                            </span>
                            <span class="item-name" style="flex: 1; margin-left: 15px;">
                                ${item.product_name}
                            </span>
                        </div>
                    `).join('')}
                    ${groupData.count > 3 ? `
                        <div style="text-align: center; padding: 8px; color: #6c757d; font-style: italic; font-size: 12px;">
                            ... i ${groupData.count - 3} innych produktów
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    });
    
    content += '</div>';
    
    return content;
}

function getDeadlineColor(deadlineGroup) {
    switch(deadlineGroup) {
        case 'URGENT': return '#dc3545';    // Czerwony
        case 'NORMAL': return '#ffc107';    // Żółty
        case 'LATER': return '#28a745';     // Zielony
        default: return '#6c757d';          // Szary
    }
}

function refreshProductionJobStatus() {
    console.log('[Settings] Odświeżanie statusu zadania kolejki');
    
    fetch('/scheduler/api/jobs/production-queue')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateProductionJobStatus(data.data);
            } else {
                console.error('[Settings] Błąd pobierania statusu zadania:', data.error);
            }
        })
        .catch(error => {
            console.error('[Settings] Błąd połączenia statusu zadania:', error);
        });
}

function updateProductionJobStatus(jobData) {
    const statusIndicator = document.getElementById('jobStatusIndicator');
    const statusText = document.getElementById('jobStatusText');
    const recentExecutions = document.getElementById('recentExecutions');
    
    // Aktualizuj status zadania
    if (statusIndicator && statusText) {
        if (!jobData.scheduler_running) {
            statusIndicator.textContent = '❌';
            statusText.textContent = 'Scheduler nie działa';
            statusText.style.color = '#dc3545';
        } else if (!jobData.job_configured) {
            statusIndicator.textContent = '⚠️';
            statusText.textContent = 'Zadanie nie skonfigurowane';
            statusText.style.color = '#ffc107';
        } else {
            statusIndicator.textContent = '✅';
            statusText.textContent = 'Zadanie aktywne';
            statusText.style.color = '#28a745';
        }
    }
    
    // Aktualizuj ostatnie wykonania
    if (recentExecutions) {
        if (jobData.recent_executions && jobData.recent_executions.length > 0) {
            const executionsHtml = jobData.recent_executions.map(execution => {
                const executedDate = new Date(execution.executed_at);
                const statusClass = execution.status === 'sent' ? 'success' : 'error';
                
                return `
                    <div class="execution-item">
                        <div class="execution-content">
                            <div>${execution.content}</div>
                            ${execution.error ? `<div style="color: #dc3545; font-size: 12px; margin-top: 3px;">${execution.error}</div>` : ''}
                        </div>
                        <div class="execution-meta">
                            <div class="execution-status ${statusClass}">${execution.status}</div>
                            <div class="execution-time">${executedDate.toLocaleString('pl-PL')}</div>
                        </div>
                    </div>
                `;
            }).join('');
            
            recentExecutions.innerHTML = `
                <h5 style="margin: 15px 0 10px 0; font-size: 14px; color: #495057;">Ostatnie wykonania:</h5>
                ${executionsHtml}
            `;
        } else {
            recentExecutions.innerHTML = `
                <h5 style="margin: 15px 0 10px 0; font-size: 14px; color: #495057;">Ostatnie wykonania:</h5>
                <p class="text-muted" style="font-size: 14px;">Brak danych o wykonaniach</p>
            `;
        }
    }
    
    console.log('[Settings] Status zadania zaktualizowany:', jobData);
}

// === FUNKCJE POMOCNICZE TOAST'ÓW ===

function showSuccessToast(message) {
    showToast(message, 'success');
}

function showErrorToast(message) {
    showToast(message, 'error');
}

function showToast(message, type = 'info') {
    // Usuń istniejące toasty
    const existingToasts = document.querySelectorAll('.settings-toast');
    existingToasts.forEach(toast => toast.remove());
    
    // Utwórz nowy toast
    const toast = document.createElement('div');
    toast.className = `settings-toast settings-toast-${type}`;
    
    const iconMap = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    toast.innerHTML = `
        <div class="settings-toast-content">
            <span class="settings-toast-icon">${iconMap[type] || 'ℹ️'}</span>
            <span class="settings-toast-message">${message}</span>
            <button class="settings-toast-close">×</button>
        </div>
    `;
    
    // Style toast'a
    const toastStyles = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        min-width: 300px;
        max-width: 500px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideInRight 0.3s ease;
    `;
    
    toast.style.cssText = toastStyles;
    
    // Dodaj style dla typu
    switch(type) {
        case 'success':
            toast.style.borderLeft = '4px solid #28a745';
            break;
        case 'error':
            toast.style.borderLeft = '4px solid #dc3545';
            break;
        case 'warning':
            toast.style.borderLeft = '4px solid #ffc107';
            break;
        case 'info':
            toast.style.borderLeft = '4px solid #17a2b8';
            break;
    }
    
    // Style dla zawartości
    const content = toast.querySelector('.settings-toast-content');
    content.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
    `;
    
    const icon = toast.querySelector('.settings-toast-icon');
    icon.style.fontSize = '20px';
    
    const messageEl = toast.querySelector('.settings-toast-message');
    messageEl.style.cssText = `
        flex: 1;
        font-size: 14px;
        color: #495057;
    `;
    
    const closeBtn = toast.querySelector('.settings-toast-close');
    closeBtn.style.cssText = `
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        color: #6c757d;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s ease;
    `;
    
    // Event listenery
    closeBtn.addEventListener('click', () => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    });
    
    // Dodaj style animacji jeśli nie istnieją
    if (!document.getElementById('toast-animations')) {
        const animationStyles = document.createElement('style');
        animationStyles.id = 'toast-animations';
        animationStyles.textContent = `
            @keyframes slideInRight {
                from {
                    opacity: 0;
                    transform: translateX(100%);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
            
            @keyframes slideOutRight {
                from {
                    opacity: 1;
                    transform: translateX(0);
                }
                to {
                    opacity: 0;
                    transform: translateX(100%);
                }
            }
            
            .settings-toast-close:hover {
                background-color: rgba(0,0,0,0.1) !important;
            }
        `;
        document.head.appendChild(animationStyles);
    }
    
    // Dodaj toast do strony
    document.body.appendChild(toast);
    
    // Auto-hide po 5 sekundach
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }
    }, 5000);
    
    console.log(`[Settings] Toast: ${type} - ${message}`);
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
    updateJobRow: updateJobRow,
    refreshSingleJob: refreshSingleJob,
    toggleDebug: function () {
        window.DEBUG_ENABLED = !DEBUG_ENABLED;
        console.log(`Debug logowanie ${DEBUG_ENABLED ? 'włączone' : 'wyłączone'}`);
    }
};

debugLog('🎉 Moduł scheduler całkowicie załadowany i gotowy do użycia');