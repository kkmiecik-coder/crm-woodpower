// ============================================================================
// PARTNER ACADEMY - TRACKING & ANALYTICS
// Time tracking, event logging, session monitoring, analytics
// ============================================================================

// ============================================================================
// TRACKING STATE
// ============================================================================

const Tracking = {
    // Time tracking
    sessionStartTime: null,
    currentStepStartTime: null,
    lastHeartbeat: null,
    heartbeatInterval: null,
    
    // Visibility tracking
    isPageVisible: true,
    lastVisibilityChange: null,
    
    // Event buffer (offline support)
    eventBuffer: [],
    isOnline: true,
    
    // Configuration
    HEARTBEAT_INTERVAL: 10000, // 10 sekund
    SYNC_RETRY_DELAY: 5000,    // 5 sekund
    MAX_BUFFER_SIZE: 100,
    
    // Statistics
    stats: {
        totalClicks: 0,
        totalScrolls: 0,
        videoPlays: 0,
        quizAttempts: 0
    }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    // Czekaj aż LearningPlatform będzie gotowy
    if (typeof LearningPlatform !== 'undefined' && LearningPlatform.isAuthenticated) {
        initTracking();
    } else {
        // Sprawdź co sekundę czy platforma jest gotowa
        const checkInterval = setInterval(() => {
            if (typeof LearningPlatform !== 'undefined' && LearningPlatform.isAuthenticated) {
                clearInterval(checkInterval);
                initTracking();
            }
        }, 1000);
    }
});

function initTracking() {
    console.log('[Tracking] Inicjalizacja trackingu...');
    
    // Ustaw czas rozpoczęcia sesji
    Tracking.sessionStartTime = Date.now();
    Tracking.currentStepStartTime = Date.now();
    
    // Visibility API
    initVisibilityTracking();
    
    // Event listeners
    initEventTracking();
    
    // Heartbeat (sync czasu co 10s)
    startHeartbeat();
    
    // Network status monitoring
    initNetworkMonitoring();
    
    // Scroll tracking
    initScrollTracking();
    
    // Przed opuszczeniem strony - ostatni sync
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    console.log('[Tracking] Tracking zainicjalizowany');
}

// ============================================================================
// TIME TRACKING
// ============================================================================

function startHeartbeat() {
    // Pierwszy heartbeat natychmiast
    sendHeartbeat();
    
    // Następne co 10 sekund
    Tracking.heartbeatInterval = setInterval(() => {
        if (Tracking.isPageVisible) {
            sendHeartbeat();
        }
    }, Tracking.HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (Tracking.heartbeatInterval) {
        clearInterval(Tracking.heartbeatInterval);
        Tracking.heartbeatInterval = null;
    }
}

async function sendHeartbeat() {
    if (!LearningPlatform.sessionId) return;
    
    const now = Date.now();
    const timeIncrement = Tracking.lastHeartbeat 
        ? Math.floor((now - Tracking.lastHeartbeat) / 1000) 
        : Math.floor((now - Tracking.sessionStartTime) / 1000);
    
    Tracking.lastHeartbeat = now;
    
    // Aktualizuj lokalny czas
    LearningPlatform.totalTimeSpent += timeIncrement;
    
    // Aktualizuj UI
    if (typeof updateTimeSpent === 'function') {
        updateTimeSpent();
    }
    
    // Wyślij do backendu
    try {
        const response = await fetch('/partner-academy/api/time/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: LearningPlatform.sessionId,
                step: LearningPlatform.currentStep,
                time_increment: timeIncrement
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('[Tracking] Heartbeat wysłany:', timeIncrement + 's');
            
            // Wyślij buforowane eventy jeśli są
            if (Tracking.eventBuffer.length > 0) {
                await flushEventBuffer();
            }
        }
        
    } catch (error) {
        console.error('[Tracking] Błąd heartbeat:', error);
        // Zapisz w buforze jeśli offline
        addToEventBuffer('heartbeat', { time_increment: timeIncrement });
    }
}

function calculateStepTime(stepId) {
    const now = Date.now();
    const timeSpent = Math.floor((now - Tracking.currentStepStartTime) / 1000);
    
    // Zapisz czas dla kroku
    if (!LearningPlatform.stepTimes[stepId]) {
        LearningPlatform.stepTimes[stepId] = 0;
    }
    LearningPlatform.stepTimes[stepId] += timeSpent;
    
    // Zresetuj timer dla nowego kroku
    Tracking.currentStepStartTime = now;
    
    console.log('[Tracking] Czas na kroku', stepId + ':', timeSpent + 's');
    
    return timeSpent;
}

// ============================================================================
// VISIBILITY TRACKING (Page Visibility API)
// ============================================================================

function initVisibilityTracking() {
    let hidden, visibilityChange;
    
    if (typeof document.hidden !== 'undefined') {
        hidden = 'hidden';
        visibilityChange = 'visibilitychange';
    } else if (typeof document.webkitHidden !== 'undefined') {
        hidden = 'webkitHidden';
        visibilityChange = 'webkitvisibilitychange';
    }
    
    if (typeof document[hidden] !== 'undefined') {
        document.addEventListener(visibilityChange, handleVisibilityChange, false);
    }
}

function handleVisibilityChange() {
    const now = Date.now();
    
    if (document.hidden) {
        // Użytkownik opuścił kartę
        Tracking.isPageVisible = false;
        Tracking.lastVisibilityChange = now;
        
        console.log('[Tracking] Karta ukryta - pause tracking');
        
        // Wyślij ostatni heartbeat przed pauzą
        sendHeartbeat();
        
        // Loguj event
        logEvent('page_hidden', {
            step: LearningPlatform.currentStep
        });
        
    } else {
        // Użytkownik wrócił do karty
        Tracking.isPageVisible = true;
        
        const awayTime = now - Tracking.lastVisibilityChange;
        const awayMinutes = Math.floor(awayTime / 60000);
        
        console.log('[Tracking] Karta widoczna - resume tracking (away:', awayMinutes + 'min)');
        
        // Loguj event
        logEvent('page_visible', {
            step: LearningPlatform.currentStep,
            away_time_seconds: Math.floor(awayTime / 1000)
        });
        
        // Zresetuj timer kroku (nie liczymy czasu gdy karta ukryta)
        Tracking.currentStepStartTime = now;
        Tracking.lastHeartbeat = now;
    }
}

// ============================================================================
// EVENT TRACKING
// ============================================================================

function initEventTracking() {
    // Navigation clicks
    document.addEventListener('click', handleClick, true);
    
    // Step changes
    if (typeof LearningPlatform !== 'undefined') {
        const originalShowStep = window.showStep;
        window.showStep = function(stepId) {
            // Oblicz czas poprzedniego kroku
            calculateStepTime(LearningPlatform.currentStep);
            
            // Loguj zmianę kroku
            logEvent('step_change', {
                from_step: LearningPlatform.currentStep,
                to_step: stepId
            });
            
            // Wywołaj oryginalną funkcję
            if (originalShowStep) {
                originalShowStep(stepId);
            }
        };
        
        // Step completion
        const originalCompleteStep = window.completeStep;
        window.completeStep = function(stepId) {
            logEvent('step_completed', {
                step: stepId,
                time_spent: LearningPlatform.stepTimes[stepId] || 0
            });
            
            if (originalCompleteStep) {
                originalCompleteStep(stepId);
            }
        };
        
        // Quiz submission
        const originalSubmitQuiz = window.submitQuiz;
        window.submitQuiz = function(quizId) {
            Tracking.stats.quizAttempts++;
            
            logEvent('quiz_attempt', {
                quiz_id: quizId,
                attempt_number: LearningPlatform.quizAttempts[quizId] + 1
            });
            
            if (originalSubmitQuiz) {
                originalSubmitQuiz(quizId);
            }
        };
    }
}

function handleClick(event) {
    const target = event.target;
    
    // Sidebar navigation
    if (target.closest('.step-item')) {
        const stepItem = target.closest('.step-item');
        const stepId = stepItem.dataset.step;
        
        logEvent('sidebar_click', {
            step: stepId,
            is_locked: stepItem.classList.contains('locked')
        });
        
        Tracking.stats.totalClicks++;
    }
    
    // Navigation buttons
    if (target.id === 'nextBtn' || target.closest('#nextBtn')) {
        logEvent('next_button_click', {
            current_step: LearningPlatform.currentStep
        });
        Tracking.stats.totalClicks++;
    }
    
    if (target.id === 'prevBtn' || target.closest('#prevBtn')) {
        logEvent('prev_button_click', {
            current_step: LearningPlatform.currentStep
        });
        Tracking.stats.totalClicks++;
    }
    
    // Quiz answers
    if (target.closest('.quiz-option')) {
        logEvent('quiz_answer_click', {
            question: target.closest('.quiz-question')?.dataset.question,
            step: LearningPlatform.currentStep
        });
    }
}

// ============================================================================
// SCROLL TRACKING
// ============================================================================

function initScrollTracking() {
    let scrollTimeout;
    let maxScrollDepth = 0;
    
    window.addEventListener('scroll', function() {
        clearTimeout(scrollTimeout);
        
        scrollTimeout = setTimeout(() => {
            const scrollPercentage = Math.round(
                (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
            );
            
            if (scrollPercentage > maxScrollDepth) {
                maxScrollDepth = scrollPercentage;
                
                // Loguj co 25%
                if (scrollPercentage >= 25 && scrollPercentage < 50 && maxScrollDepth < 50) {
                    logEvent('scroll_depth', { depth: '25%', step: LearningPlatform.currentStep });
                } else if (scrollPercentage >= 50 && scrollPercentage < 75 && maxScrollDepth < 75) {
                    logEvent('scroll_depth', { depth: '50%', step: LearningPlatform.currentStep });
                } else if (scrollPercentage >= 75 && scrollPercentage < 100 && maxScrollDepth < 100) {
                    logEvent('scroll_depth', { depth: '75%', step: LearningPlatform.currentStep });
                } else if (scrollPercentage >= 100) {
                    logEvent('scroll_depth', { depth: '100%', step: LearningPlatform.currentStep });
                }
            }
            
            Tracking.stats.totalScrolls++;
        }, 200);
    });
}

// ============================================================================
// EVENT LOGGING
// ============================================================================

function logEvent(eventType, data = {}) {
    const event = {
        type: eventType,
        timestamp: Date.now(),
        session_id: LearningPlatform.sessionId,
        step: LearningPlatform.currentStep,
        data: data
    };
    
    console.log('[Tracking] Event:', eventType, data);
    
    // Zapisz lokalnie
    saveEventToLocalStorage(event);
    
    // Wyślij do backendu (lub buforuj jeśli offline)
    if (Tracking.isOnline) {
        sendEventToBackend(event);
    } else {
        addToEventBuffer(eventType, data);
    }
}

function saveEventToLocalStorage(event) {
    try {
        const events = JSON.parse(localStorage.getItem('learning_events') || '[]');
        events.push(event);
        
        // Zachowaj tylko ostatnie 50 eventów
        if (events.length > 50) {
            events.splice(0, events.length - 50);
        }
        
        localStorage.setItem('learning_events', JSON.stringify(events));
    } catch (error) {
        console.error('[Tracking] Błąd zapisu do localStorage:', error);
    }
}

async function sendEventToBackend(event) {
    // Opcjonalnie - możesz stworzyć dedykowany endpoint do logowania eventów
    // Na razie pomijamy, żeby nie zaśmiecać backendu
    // W produkcji możesz wysyłać do Google Analytics, Mixpanel, etc.
    
    // Przykład:
    /*
    try {
        await fetch('/partner-academy/api/analytics/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
        });
    } catch (error) {
        console.error('[Tracking] Błąd wysyłki eventu:', error);
    }
    */
}

// ============================================================================
// OFFLINE SUPPORT
// ============================================================================

function initNetworkMonitoring() {
    Tracking.isOnline = navigator.onLine;
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
}

function handleOnline() {
    console.log('[Tracking] Połączenie przywrócone');
    Tracking.isOnline = true;
    
    // Wyślij buforowane eventy
    flushEventBuffer();
}

function handleOffline() {
    console.log('[Tracking] Brak połączenia - tryb offline');
    Tracking.isOnline = false;
}

function addToEventBuffer(eventType, data) {
    const event = {
        type: eventType,
        timestamp: Date.now(),
        session_id: LearningPlatform.sessionId,
        step: LearningPlatform.currentStep,
        data: data
    };
    
    Tracking.eventBuffer.push(event);
    
    // Ogranicz rozmiar bufora
    if (Tracking.eventBuffer.length > Tracking.MAX_BUFFER_SIZE) {
        Tracking.eventBuffer.shift();
    }
    
    console.log('[Tracking] Event dodany do bufora:', eventType, '(bufor:', Tracking.eventBuffer.length + ')');
}

async function flushEventBuffer() {
    if (Tracking.eventBuffer.length === 0) return;
    
    console.log('[Tracking] Wysyłanie buforowanych eventów:', Tracking.eventBuffer.length);
    
    const eventsToSend = [...Tracking.eventBuffer];
    Tracking.eventBuffer = [];
    
    // Tutaj możesz wysłać wszystkie eventy jednym request
    // Na razie tylko logujemy
    console.log('[Tracking] Bufor wyczyszczony');
    
    // Przykład batch send:
    /*
    try {
        await fetch('/partner-academy/api/analytics/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events: eventsToSend })
        });
    } catch (error) {
        // Przywróć do bufora jeśli nie udało się wysłać
        Tracking.eventBuffer = [...eventsToSend, ...Tracking.eventBuffer];
    }
    */
}

// ============================================================================
// CLEANUP
// ============================================================================

function handleBeforeUnload() {
    // Ostatni heartbeat
    if (Tracking.isPageVisible) {
        sendHeartbeat();
    }
    
    // Loguj opuszczenie
    logEvent('session_end', {
        total_time: LearningPlatform.totalTimeSpent,
        completed_steps: LearningPlatform.completedSteps.length,
        current_step: LearningPlatform.currentStep
    });
    
    // Stop heartbeat
    stopHeartbeat();
    
    console.log('[Tracking] Sesja zakończona');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getTrackingStats() {
    return {
        ...Tracking.stats,
        totalTime: LearningPlatform.totalTimeSpent,
        completedSteps: LearningPlatform.completedSteps.length,
        currentStep: LearningPlatform.currentStep,
        sessionDuration: Date.now() - Tracking.sessionStartTime
    };
}

function resetTracking() {
    Tracking.stats = {
        totalClicks: 0,
        totalScrolls: 0,
        videoPlays: 0,
        quizAttempts: 0
    };
    
    Tracking.eventBuffer = [];
    
    console.log('[Tracking] Stats zresetowane');
}

// ============================================================================
// EXPORT
// ============================================================================

window.Tracking = Tracking;
window.logEvent = logEvent;
window.getTrackingStats = getTrackingStats;
window.resetTracking = resetTracking;

console.log('[Tracking] Moduł tracking załadowany');