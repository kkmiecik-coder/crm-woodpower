// ============================================================================
// PARTNER ACADEMY - LEARNING PLATFORM JAVASCRIPT
// Zarządzanie krokami, progressem, quizami, session management
// ============================================================================

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const LearningPlatform = {
    // Session
    sessionId: null,
    isAuthenticated: false,
    
    // Progress
    currentStep: '1.1',
    completedSteps: [],
    lockedSteps: ['1.2', '1.3', '1.4', 'M1', '2.1', '2.2', '2.3', '2.4', 'M2', '3.1'],
    
    // Quiz data
    quizResults: {},
    quizAttempts: {
        'M1': 0,
        'M2': 0
    },
    
    // Time tracking
    totalTimeSpent: 0,
    stepTimes: {},
    
    // Constants
    CORRECT_PIN: '3846',
    TOTAL_STEPS: 11,
    
    // Quiz answers (prawdziwe odpowiedzi - można przenieść do osobnego pliku)
    correctAnswers: {
        'M1': {
            'q1': 'B',
            'q2': ['A', 'C', 'D'],
            'q3': 'B'
        },
        'M2': {
            // Tutaj dodasz odpowiedzi dla M2
        }
    }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('[Learning] Inicjalizacja platformy...');
    
    // Sprawdź czy PIN już został zweryfikowany
    checkPINAuthentication();
    
    // Jeśli nie, pokaż PIN gate
    if (!LearningPlatform.isAuthenticated) {
        showPINGate();
    } else {
        // Załaduj sesję i pokaż platformę
        initializePlatform();
    }
});

// ============================================================================
// PIN AUTHENTICATION
// ============================================================================

function checkPINAuthentication() {
    // Sprawdź localStorage
    const authenticated = localStorage.getItem('learning_pin_authenticated');
    const timestamp = localStorage.getItem('learning_pin_timestamp');
    
    if (authenticated === 'true' && timestamp) {
        // Sprawdź czy sesja nie wygasła (24h)
        const now = Date.now();
        const elapsed = now - parseInt(timestamp);
        const hours = elapsed / (1000 * 60 * 60);
        
        if (hours < 24) {
            LearningPlatform.isAuthenticated = true;
            return true;
        } else {
            // Sesja wygasła
            localStorage.removeItem('learning_pin_authenticated');
            localStorage.removeItem('learning_pin_timestamp');
        }
    }
    
    return false;
}

function showPINGate() {
    const pinOverlay = document.getElementById('pinGateOverlay');
    const pinForm = document.getElementById('pinForm');
    const pinInputs = document.querySelectorAll('.pin-digit');
    
    if (!pinOverlay || !pinForm) return;
    
    pinOverlay.style.display = 'flex';
    
    // Auto-focus pierwszy input
    pinInputs[0].focus();
    
    // Obsługa wpisywania cyfr
    pinInputs.forEach((input, index) => {
        // Tylko cyfry + auto-focus
        input.addEventListener('input', function(e) {
            const value = e.target.value;
            
            // Usuń wszystko co nie jest cyfrą
            if (!/^\d$/.test(value)) {
                e.target.value = '';
                return;
            }
            
            // Oznacz jako filled
            e.target.classList.add('filled');
            
            // Auto-focus następny input
            if (value && index < pinInputs.length - 1) {
                pinInputs[index + 1].focus();
                pinInputs[index + 1].select(); // ← DODAJ to dla pewności
            }
            
            // Jeśli ostatni input - automatycznie sprawdź PIN
            if (index === pinInputs.length - 1 && value) {
                setTimeout(() => validatePIN(), 300);
            }
        });
        
        // Backspace - cofnij do poprzedniego
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace') {
                if (!e.target.value && index > 0) {
                    // Jeśli pusty, cofnij focus
                    pinInputs[index - 1].focus();
                    pinInputs[index - 1].value = '';
                    pinInputs[index - 1].classList.remove('filled');
                } else {
                    // Jeśli ma wartość, usuń ją
                    e.target.value = '';
                    e.target.classList.remove('filled');
                }
            }
            
            // Arrow keys navigation
            if (e.key === 'ArrowLeft' && index > 0) {
                e.preventDefault();
                pinInputs[index - 1].focus();
                pinInputs[index - 1].select();
            }
            
            if (e.key === 'ArrowRight' && index < pinInputs.length - 1) {
                e.preventDefault();
                pinInputs[index + 1].focus();
                pinInputs[index + 1].select();
            }
        });
        
        // Focus - zaznacz zawartość
        input.addEventListener('focus', function() {
            this.select();
        });
        
        // Paste - wklej cały PIN
        input.addEventListener('paste', function(e) {
            e.preventDefault();
            const pastedData = e.clipboardData.getData('text').trim();
            
            if (/^\d{4}$/.test(pastedData)) {
                pinInputs.forEach((inp, i) => {
                    inp.value = pastedData[i];
                    inp.classList.add('filled');
                });
                pinInputs[3].focus(); // Focus ostatni
                setTimeout(() => validatePIN(), 300);
            }
        });
    });
    
    // Submit form
    const pinSubmitBtn = document.getElementById('pinSubmit');
    if (pinSubmitBtn) {
        pinSubmitBtn.addEventListener('click', function(e) {
            e.preventDefault();
            validatePIN();
        });
    }
}

function validatePIN() {
    const pinInputs = document.querySelectorAll('.pin-digit');
    const pinError = document.getElementById('pinError');
    
    // Zbierz PIN
    let enteredPIN = '';
    pinInputs.forEach(input => {
        enteredPIN += input.value;
    });
    
    // Walidacja
    if (enteredPIN.length !== 4) {
        showPINError('Wprowadź wszystkie 4 cyfry');
        return;
    }
    
    if (enteredPIN === LearningPlatform.CORRECT_PIN) {
        // Prawidłowy PIN
        pinError.style.display = 'none';
        pinInputs.forEach(input => {
            input.classList.remove('error');
            input.classList.add('filled');
        });
        
        // Zapisz w localStorage
        localStorage.setItem('learning_pin_authenticated', 'true');
        localStorage.setItem('learning_pin_timestamp', Date.now().toString());
        
        LearningPlatform.isAuthenticated = true;
        
        // Animacja success i przejście do platformy
        setTimeout(() => {
            hidePINGate();
            initializePlatform();
        }, 500);
        
    } else {
        // Błędny PIN
        showPINError('Nieprawidłowy kod PIN. Spróbuj ponownie.');
        
        pinInputs.forEach(input => {
            input.classList.add('error');
            input.value = '';
            input.classList.remove('filled');
        });
        
        // Focus pierwszy input
        setTimeout(() => {
            pinInputs.forEach(input => input.classList.remove('error'));
            pinInputs[0].focus();
        }, 600);
    }
}

function showPINError(message) {
    const pinError = document.getElementById('pinError');
    if (pinError) {
        pinError.textContent = message;
        pinError.style.display = 'block';
    }
}

function hidePINGate() {
    const pinOverlay = document.getElementById('pinGateOverlay');
    if (pinOverlay) {
        pinOverlay.style.opacity = '0';
        setTimeout(() => {
            pinOverlay.style.display = 'none';
        }, 300);
    }
}

// ============================================================================
// PLATFORM INITIALIZATION
// ============================================================================

function initializePlatform() {
    console.log('[Learning] Inicjalizacja platformy...');
    
    // Pokaż platformę
    const platform = document.getElementById('learningPlatform');
    if (platform) {
        platform.style.display = 'block';
    }
    
    // Generuj lub pobierz session_id
    LearningPlatform.sessionId = getOrCreateSessionId();
    
    // Załaduj progress z backendu
    loadProgress();
    
    // Inicjalizuj event listeners
    initEventListeners();
    
    // Pokaż pierwszy krok
    showStep(LearningPlatform.currentStep);
    
    // Aktualizuj UI
    updateProgressUI();
    updateNavigationUI();
    
    console.log('[Learning] Platforma zainicjalizowana');
}

function getOrCreateSessionId() {
    let sessionId = localStorage.getItem('learning_session_id');
    
    if (!sessionId) {
        // Generuj nowy session_id
        sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('learning_session_id', sessionId);
        console.log('[Learning] Utworzono nową sesję:', sessionId);
    } else {
        console.log('[Learning] Wczytano sesję:', sessionId);
    }
    
    return sessionId;
}

// ============================================================================
// PROGRESS MANAGEMENT
// ============================================================================

async function loadProgress() {
    showLoading(true);
    
    try {
        const response = await fetch('/partner-academy/api/progress/load', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: LearningPlatform.sessionId
            })
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            // Załaduj stan z backendu
            LearningPlatform.currentStep = result.data.current_step || '1.1';
            LearningPlatform.completedSteps = result.data.completed_steps || [];
            LearningPlatform.lockedSteps = result.data.locked_steps || [];
            LearningPlatform.quizResults = result.data.quiz_results || {};
            LearningPlatform.totalTimeSpent = result.data.total_time_spent || 0;
            LearningPlatform.stepTimes = result.data.step_times || {};
            
            console.log('[Learning] Progress załadowany:', result.data);
            
            // Aktualizuj UI
            updateProgressUI();
            updateNavigationUI();
            showStep(LearningPlatform.currentStep);
        }
        
    } catch (error) {
        console.error('[Learning] Błąd ładowania progressu:', error);
        // Kontynuuj z domyślnymi wartościami
    } finally {
        showLoading(false);
    }
}

async function saveProgress(action, completedStep = null) {
    try {
        const response = await fetch('/partner-academy/api/progress/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session_id: LearningPlatform.sessionId,
                action: action,
                completed_step: completedStep
            })
        });
        
        const result = await response.json();
        
        if (result.success && result.data) {
            // Aktualizuj lokalny stan
            LearningPlatform.currentStep = result.data.current_step;
            LearningPlatform.completedSteps = result.data.completed_steps;
            LearningPlatform.lockedSteps = result.data.locked_steps;
            
            console.log('[Learning] Progress zapisany');
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error('[Learning] Błąd zapisu progressu:', error);
        return false;
    }
}

// ============================================================================
// STEP NAVIGATION
// ============================================================================

function showStep(stepId) {
    // Ukryj wszystkie kroki
    document.querySelectorAll('.step-container').forEach(container => {
        container.classList.remove('active');
    });
    
    // Pokaż wybrany krok
    const stepContainer = document.querySelector(`.step-container[data-step="${stepId}"]`);
    if (stepContainer) {
        stepContainer.classList.add('active');
        LearningPlatform.currentStep = stepId;
        
        // Scroll na górę
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        // Aktualizuj UI
        updateNavigationUI();
        updateProgressUI();
        
        console.log('[Learning] Pokazano krok:', stepId);
    }
}

function nextStep() {
    const allSteps = ['1.1', '1.2', '1.3', '1.4', 'M1', '2.1', '2.2', '2.3', '2.4', 'M2', '3.1'];
    const currentIndex = allSteps.indexOf(LearningPlatform.currentStep);
    
    if (currentIndex < allSteps.length - 1) {
        const nextStepId = allSteps[currentIndex + 1];
        
        // Sprawdź czy następny krok jest odblokowany
        if (!LearningPlatform.lockedSteps.includes(nextStepId)) {
            showStep(nextStepId);
        } else {
            alert('Musisz ukończyć obecny krok, aby przejść dalej');
        }
    }
}

function prevStep() {
    const allSteps = ['1.1', '1.2', '1.3', '1.4', 'M1', '2.1', '2.2', '2.3', '2.4', 'M2', '3.1'];
    const currentIndex = allSteps.indexOf(LearningPlatform.currentStep);
    
    if (currentIndex > 0) {
        const prevStepId = allSteps[currentIndex - 1];
        showStep(prevStepId);
    }
}

function completeStep(stepId) {
    // Oznacz jako ukończony
    if (!LearningPlatform.completedSteps.includes(stepId)) {
        LearningPlatform.completedSteps.push(stepId);
    }
    
    // Odblokuj następny krok
    const allSteps = ['1.1', '1.2', '1.3', '1.4', 'M1', '2.1', '2.2', '2.3', '2.4', 'M2', '3.1'];
    const currentIndex = allSteps.indexOf(stepId);
    
    if (currentIndex < allSteps.length - 1) {
        const nextStepId = allSteps[currentIndex + 1];
        const lockedIndex = LearningPlatform.lockedSteps.indexOf(nextStepId);
        
        if (lockedIndex > -1) {
            LearningPlatform.lockedSteps.splice(lockedIndex, 1);
        }
    }
    
    // Zapisz w backendzie
    saveProgress('complete_step', stepId);
    
    // Aktualizuj UI
    updateProgressUI();
    updateNavigationUI();
    
    console.log('[Learning] Ukończono krok:', stepId);
}

// ============================================================================
// QUIZ HANDLING
// ============================================================================

function submitQuiz(quizId) {
    const quizContainer = document.getElementById(`quiz${quizId}`);
    if (!quizContainer) return;
    
    // Zbierz odpowiedzi
    const answers = {};
    const questions = quizContainer.querySelectorAll('.quiz-question');
    
    questions.forEach(question => {
        const questionId = question.dataset.question;
        const radioInputs = question.querySelectorAll('input[type="radio"]:checked');
        const checkboxInputs = question.querySelectorAll('input[type="checkbox"]:checked');
        
        if (radioInputs.length > 0) {
            // Single choice
            answers[questionId] = radioInputs[0].value;
        } else if (checkboxInputs.length > 0) {
            // Multiple choice
            answers[questionId] = Array.from(checkboxInputs).map(inp => inp.value);
        }
    });
    
    // Zwiększ licznik prób
    LearningPlatform.quizAttempts[quizId]++;
    updateQuizAttempts(quizId);
    
    // Waliduj odpowiedzi
    const correctAnswers = LearningPlatform.correctAnswers[quizId];
    let allCorrect = true;
    const results = {};
    
    Object.keys(correctAnswers).forEach(questionId => {
        const userAnswer = answers[questionId];
        const correctAnswer = correctAnswers[questionId];
        
        let isCorrect = false;
        
        if (Array.isArray(correctAnswer)) {
            // Multiple choice - porównaj tablice
            isCorrect = JSON.stringify(userAnswer?.sort()) === JSON.stringify(correctAnswer.sort());
        } else {
            // Single choice
            isCorrect = userAnswer === correctAnswer;
        }
        
        results[questionId] = isCorrect;
        
        if (!isCorrect) {
            allCorrect = false;
        }
        
        // Pokaż feedback
        showQuestionFeedback(quizId, questionId, isCorrect);
    });
    
    if (allCorrect) {
        // Quiz zaliczony
        setTimeout(() => {
            showQuizSuccess(quizId);
            completeStep(quizId);
        }, 1000);
    } else {
        // Spróbuj ponownie
        alert('Niektóre odpowiedzi są nieprawidłowe. Spróbuj ponownie!');
    }
}

function showQuestionFeedback(quizId, questionId, isCorrect) {
    const question = document.querySelector(`#quiz${quizId} .quiz-question[data-question="${questionId}"]`);
    if (!question) return;
    
    const feedback = question.querySelector('.question-feedback');
    const options = question.querySelectorAll('.quiz-option');
    
    // Oznacz opcje jako correct/incorrect
    options.forEach(option => {
        option.classList.remove('correct', 'incorrect');
        const input = option.querySelector('input');
        
        if (input.checked) {
            if (isCorrect) {
                option.classList.add('correct');
            } else {
                option.classList.add('incorrect');
            }
        }
    });
    
    // Pokaż feedback message
    if (feedback) {
        feedback.classList.add('show');
        feedback.classList.remove('correct', 'incorrect');
        
        if (isCorrect) {
            feedback.classList.add('correct');
            feedback.textContent = '✓ Prawidłowa odpowiedź!';
        } else {
            feedback.classList.add('incorrect');
            feedback.textContent = '✗ Nieprawidłowa odpowiedź. Spróbuj ponownie.';
        }
    }
}

function showQuizSuccess(quizId) {
    const quizContainer = document.getElementById(`quiz${quizId}`);
    if (!quizContainer) return;
    
    const quizResult = quizContainer.querySelector('.quiz-result');
    if (quizResult) {
        quizResult.style.display = 'block';
        
        // Scroll do result
        quizResult.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function updateQuizAttempts(quizId) {
    const attemptsCount = document.getElementById('attemptsCount');
    if (attemptsCount) {
        attemptsCount.textContent = LearningPlatform.quizAttempts[quizId];
    }
}

// ============================================================================
// UI UPDATES
// ============================================================================

function updateProgressUI() {
    // Progress bar
    const progressFill = document.getElementById('globalProgressFill');
    const progressText = document.getElementById('globalProgressText');
    const stepsCounter = document.getElementById('stepsCounter');
    
    const percentage = Math.round((LearningPlatform.completedSteps.length / LearningPlatform.TOTAL_STEPS) * 100);
    
    if (progressFill) {
        progressFill.style.width = percentage + '%';
    }
    
    if (progressText) {
        progressText.textContent = percentage + '%';
    }
    
    if (stepsCounter) {
        stepsCounter.textContent = `${LearningPlatform.completedSteps.length}/${LearningPlatform.TOTAL_STEPS} kroków`;
    }
    
    // Sidebar items
    document.querySelectorAll('.step-item').forEach(item => {
        const stepId = item.dataset.step;
        
        // Remove all classes
        item.classList.remove('active', 'completed', 'locked');
        
        // Add appropriate class
        if (stepId === LearningPlatform.currentStep) {
            item.classList.add('active');
        } else if (LearningPlatform.completedSteps.includes(stepId)) {
            item.classList.add('completed');
            item.querySelector('.step-status').textContent = '✓';
        } else if (LearningPlatform.lockedSteps.includes(stepId)) {
            item.classList.add('locked');
        }
    });
}

function updateNavigationUI() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    const allSteps = ['1.1', '1.2', '1.3', '1.4', 'M1', '2.1', '2.2', '2.3', '2.4', 'M2', '3.1'];
    const currentIndex = allSteps.indexOf(LearningPlatform.currentStep);
    
    // Prev button
    if (prevBtn) {
        prevBtn.disabled = currentIndex === 0;
    }
    
    // Next button
    if (nextBtn) {
        const isLastStep = currentIndex === allSteps.length - 1;
        nextBtn.disabled = isLastStep;
        
        if (isLastStep) {
            nextBtn.textContent = 'Ukończono';
        }
    }
}

function updateTimeSpent() {
    const timeElement = document.getElementById('totalTimeSpent');
    if (!timeElement) return;
    
    const minutes = Math.floor(LearningPlatform.totalTimeSpent / 60);
    timeElement.textContent = minutes + ' min';
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function initEventListeners() {
    // Navigation buttons
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', prevStep);
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            completeStep(LearningPlatform.currentStep);
            nextStep();
        });
    }
    
    // Sidebar navigation
    document.querySelectorAll('.step-item').forEach(item => {
        item.addEventListener('click', function() {
            const stepId = this.dataset.step;
            
            // Sprawdź czy krok jest odblokowany
            if (!this.classList.contains('locked')) {
                showStep(stepId);
            }
        });
    });
    
    // Menu toggle (mobile)
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('learningSidebar');
    const closeSidebar = document.getElementById('closeSidebar');
    
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.add('open');
        });
    }
    
    if (closeSidebar && sidebar) {
        closeSidebar.addEventListener('click', () => {
            sidebar.classList.remove('open');
        });
    }
    
    // Quiz submit buttons
    const submitQuizM1 = document.getElementById('submitQuizBtn');
    if (submitQuizM1) {
        submitQuizM1.addEventListener('click', () => submitQuiz('M1'));
    }
    
    // Continue after quiz
    const continueAfterQuiz = document.getElementById('continueAfterQuiz');
    if (continueAfterQuiz) {
        continueAfterQuiz.addEventListener('click', nextStep);
    }
    
    // Certificate download
    const downloadCertificate = document.getElementById('downloadCertificate');
    if (downloadCertificate) {
        downloadCertificate.addEventListener('click', () => {
            alert('Funkcja pobierania certyfikatu będzie dostępna wkrótce!');
        });
    }
    
    // Review content
    const reviewContent = document.getElementById('reviewContent');
    if (reviewContent) {
        reviewContent.addEventListener('click', () => {
            showStep('1.1');
        });
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showLoading(show) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        if (show) {
            loadingOverlay.classList.add('active');
        } else {
            loadingOverlay.classList.remove('active');
        }
    }
}

// ============================================================================
// EXPORT (jeśli używasz modułów)
// ============================================================================

window.LearningPlatform = LearningPlatform;
window.showStep = showStep;
window.completeStep = completeStep;
window.submitQuiz = submitQuiz;