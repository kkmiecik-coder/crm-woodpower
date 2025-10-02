// ============================================================================
// RECRUITMENT.JS - Partner Academy Recruitment Logic
// ============================================================================

// Globalne zmienne
let currentStep = 1;
const totalSteps = 7;
const stepLabels = [
    'Początek',
    'Proces',
    'Kim jesteśmy',
    'Korzyści',
    'Produkty',
    'Zespół',
    'Formularz'
];

let uploadedFile = null;
let formData = {};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function () {
    setupCooperationCardSelector();
    updateProgress();
    updateNavigationButtons();
    renderMobileProgress();
    setupFileUpload();
    setupFormValidation();
});

// ============================================================================
// COOPERATION TYPE CARD SELECTOR
// ============================================================================

function setupCooperationCardSelector() {
    const radioButtons = document.querySelectorAll('input[name="cooperation_type"]');
    const cards = document.querySelectorAll('.cooperation-card');
    const b2bFields = document.getElementById('b2bFields');
    
    if (!radioButtons.length || !b2bFields) return;
    
    radioButtons.forEach(radio => {
        radio.addEventListener('change', function() {
            // Usuń active z wszystkich kart
            cards.forEach(card => card.classList.remove('active'));
            
            // Dodaj active do wybranej karty
            const selectedCard = this.closest('.cooperation-card');
            if (selectedCard) {
                selectedCard.classList.add('active');
            }
            
            // Pokaż/ukryj pola B2B
            if (this.value === 'b2b') {
                b2bFields.style.display = 'block';
                // Animacja
                setTimeout(() => {
                    b2bFields.classList.add('show');
                }, 10);
                
                // Ustaw required dla pól B2B
                setB2BFieldsRequired(true);
            } else {
                b2bFields.classList.remove('show');
                setTimeout(() => {
                    b2bFields.style.display = 'none';
                }, 400);
                
                // Usuń required z pól B2B i wyczyść błędy
                setB2BFieldsRequired(false);
                clearB2BFieldsErrors();
            }
        });
    });
    
    // Kliknięcie w całą kartę zaznacza radio
    cards.forEach(card => {
        card.addEventListener('click', function(e) {
            if (e.target.type !== 'radio') {
                const radio = this.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    radio.dispatchEvent(new Event('change'));
                }
            }
        });
    });
}

function setB2BFieldsRequired(required) {
    const b2bInputs = ['company_name', 'nip', 'company_address', 'company_city', 'company_postal_code'];
    
    b2bInputs.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            if (required) {
                field.setAttribute('required', 'required');
            } else {
                field.removeAttribute('required');
                field.value = ''; // Wyczyść wartość
            }
        }
    });
}

function clearB2BFieldsErrors() {
    const b2bInputs = ['company_name', 'nip', 'regon', 'company_address', 'company_city', 'company_postal_code'];
    
    b2bInputs.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        const errorSpan = document.getElementById(`error_${fieldId}`);
        
        if (field) {
            field.classList.remove('error');
        }
        if (errorSpan) {
            errorSpan.textContent = '';
            errorSpan.style.display = 'none';
        }
    });
}

// ============================================================================
// STEP NAVIGATION
// ============================================================================

function nextStep() {
    // Jeśli jesteśmy na ostatnim kroku (formularz), wywołaj submitForm
    if (currentStep === totalSteps) {
        submitForm();
        return;
    }

    if (currentStep < totalSteps) {
        const oldStep = currentStep;
        currentStep++;
        transitionStep(oldStep, currentStep, 'next');
    }
}

function prevStep() {
    if (currentStep > 1) {
        const oldStep = currentStep;
        currentStep--;
        transitionStep(oldStep, currentStep, 'prev');
    }
}

function goToStep(step) {
    if (step !== currentStep && step >= 1 && step <= totalSteps) {
        const oldStep = currentStep;
        currentStep = step;
        const direction = step > oldStep ? 'next' : 'prev';
        transitionStep(oldStep, currentStep, direction);
    }
}

function transitionStep(oldStep, newStep, direction) {
    const oldContent = document.querySelector(`.step-content[data-step="${oldStep}"]`);
    const newContent = document.querySelector(`.step-content[data-step="${newStep}"]`);

    if (!oldContent || !newContent) return;

    // Usuń poprzednie klasy animacji
    oldContent.classList.remove('slide-in-left', 'slide-in-right', 'slide-out-left', 'slide-out-right');
    newContent.classList.remove('slide-in-left', 'slide-in-right', 'slide-out-left', 'slide-out-right');

    // Dodaj animację wyjścia
    if (direction === 'next') {
        oldContent.classList.add('slide-out-left');
    } else {
        oldContent.classList.add('slide-out-right');
    }

    setTimeout(() => {
        oldContent.classList.remove('active', 'slide-out-left', 'slide-out-right');

        // Dodaj animację wejścia
        if (direction === 'next') {
            newContent.classList.add('slide-in-right');
        } else {
            newContent.classList.add('slide-in-left');
        }

        newContent.classList.add('active');
        updateProgress();
        updateNavigationButtons();
        renderMobileProgress();

        // Scroll do góry
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 500);
}

function updateNavigationButtons() {
    const btnBack = document.getElementById('btnBack');
    const btnNext = document.getElementById('btnNext');

    if (!btnBack || !btnNext) return;

    if (currentStep === 1) {
        btnBack.style.display = 'none';
        btnNext.textContent = 'Rozpocznij';
    } else if (currentStep === totalSteps) {
        btnBack.style.display = 'flex';
        btnNext.textContent = 'Wyślij aplikację';
    } else {
        btnBack.style.display = 'flex';
        btnNext.textContent = 'Następny krok';
    }
}

function updateProgress() {
    const steps = document.querySelectorAll('.progress-step');
    const progressFill = document.getElementById('progressFill');

    if (!progressFill) return;

    steps.forEach((step, index) => {
        const stepNumber = index + 1;
        step.classList.remove('active', 'completed');

        if (stepNumber === currentStep) {
            step.classList.add('active');
        } else if (stepNumber < currentStep) {
            step.classList.add('completed');
        }
    });

    const progressPercentage = ((currentStep - 1) / (totalSteps - 1)) * 100;
    progressFill.style.width = `${progressPercentage}%`;
}

function renderMobileProgress() {
    const track = document.getElementById('mobileProgressTrack');
    if (!track) return;

    track.innerHTML = '';

    const steps = [currentStep - 1, currentStep, currentStep + 1].filter(s => s >= 1 && s <= totalSteps);

    steps.forEach(stepNum => {
        const stepDiv = document.createElement('div');
        stepDiv.className = 'mobile-step';

        if (stepNum < currentStep) {
            stepDiv.classList.add('prev');
        } else if (stepNum === currentStep) {
            stepDiv.classList.add('current');
        } else {
            stepDiv.classList.add('next');
        }

        stepDiv.innerHTML = `
            <div class="mobile-step-number">Krok ${stepNum} z ${totalSteps}</div>
            <div class="mobile-step-label">${stepLabels[stepNum - 1]}</div>
        `;

        track.appendChild(stepDiv);
    });
}

// ============================================================================
// FORM VALIDATION
// ============================================================================

function setupFormValidation() {
    const form = document.getElementById('applicationForm');
    if (!form) return;

    // Walidacja w czasie rzeczywistym dla każdego pola
    const fields = form.querySelectorAll('input, textarea, select');
    fields.forEach(field => {
        field.addEventListener('blur', function () {
            validateField(this);
        });

        field.addEventListener('input', function () {
            // Usuń błąd podczas wpisywania
            const errorSpan = document.getElementById(`error_${this.id}`);
            if (errorSpan) {
                errorSpan.textContent = '';
                errorSpan.style.display = 'none';
            }
            this.classList.remove('error');
        });
    });
}

function validateField(field) {
    const fieldValue = field.value.trim();
    const errorSpan = document.getElementById(`error_${field.id}`);

    if (!errorSpan) return true;

    // Wyczyść poprzedni błąd
    errorSpan.textContent = '';
    errorSpan.style.display = 'none';
    field.classList.remove('error');

    // Sprawdź czy pole jest wymagane i puste
    if (field.hasAttribute('required') && !fieldValue) {
        errorSpan.textContent = 'To pole jest wymagane';
        errorSpan.style.display = 'block';
        field.classList.add('error');
        return false;
    }

    // Walidacja email
    if (field.type === 'email' && fieldValue) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(fieldValue)) {
            errorSpan.textContent = 'Nieprawidłowy format email';
            errorSpan.style.display = 'block';
            field.classList.add('error');
            return false;
        }
    }

    // Walidacja telefonu
    if (field.id === 'phone' && fieldValue) {
        const phoneRegex = /^[\d\s\+\-\(\)]+$/;
        if (!phoneRegex.test(fieldValue) || fieldValue.replace(/\D/g, '').length < 9) {
            errorSpan.textContent = 'Nieprawidłowy numer telefonu';
            errorSpan.style.display = 'block';
            field.classList.add('error');
            return false;
        }
    }

    // Walidacja PESEL
    if (field.id === 'pesel' && fieldValue) {
        if (!/^\d{11}$/.test(fieldValue)) {
            errorSpan.textContent = 'PESEL musi zawierać 11 cyfr';
            errorSpan.style.display = 'block';
            field.classList.add('error');
            return false;
        }
    }

    // Walidacja kodu pocztowego (osobisty)
    if (field.id === 'postal_code' && fieldValue) {
        if (!/^\d{2}-\d{3}$/.test(fieldValue)) {
            errorSpan.textContent = 'Format: 00-000';
            errorSpan.style.display = 'block';
            field.classList.add('error');
            return false;
        }
    }

    // Walidacja NIP
    if (field.id === 'nip' && fieldValue) {
        const nipClean = fieldValue.replace(/\D/g, '');
        if (!/^\d{10}$/.test(nipClean)) {
            errorSpan.textContent = 'NIP musi zawierać 10 cyfr';
            errorSpan.style.display = 'block';
            field.classList.add('error');
            return false;
        }
    }

    // Walidacja kodu pocztowego firmy
    if (field.id === 'company_postal_code' && fieldValue) {
        if (!/^\d{2}-\d{3}$/.test(fieldValue)) {
            errorSpan.textContent = 'Format: 00-000';
            errorSpan.style.display = 'block';
            field.classList.add('error');
            return false;
        }
    }

    return true;
}

function validateForm() {
    const form = document.getElementById('applicationForm');
    if (!form) return false;

    let isValid = true;
    const fields = form.querySelectorAll('input[required], textarea[required]');

    fields.forEach(field => {
        if (!validateField(field)) {
            isValid = false;
        }
    });

    // Sprawdź zgodę RODO
    const consentCheckbox = document.getElementById('data_processing_consent');
    if (consentCheckbox && !consentCheckbox.checked) {
        alert('Musisz wyrazić zgodę na przetwarzanie danych osobowych');
        isValid = false;
    }

    return isValid;
}

// ============================================================================
// FILE UPLOAD
// ============================================================================

function setupFileUpload() {
    const uploadArea = document.getElementById('fileUploadArea');
    const fileInput = document.getElementById('ndaFile');

    if (!uploadArea || !fileInput) return;

    fileInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    uploadArea.addEventListener('dragover', function (e) {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', function (e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', function (e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');

        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });
}

function handleFile(file) {
    const maxSize = 5 * 1024 * 1024; // 5MB
    const allowedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text'
    ];

    if (file.size > maxSize) {
        alert(`Plik jest za duży (${(file.size / 1024 / 1024).toFixed(1)} MB). Maksymalny rozmiar to 5 MB.`);
        return;
    }

    if (!allowedTypes.includes(file.type)) {
        alert('Niedozwolony typ pliku. Akceptowane formaty: PDF, JPG, PNG, DOCX, ODT');
        return;
    }

    uploadedFile = file;

    // Pokaż preview
    const uploadArea = document.getElementById('fileUploadArea');
    const filePreview = document.getElementById('filePreview');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');

    if (!uploadArea || !filePreview || !fileName || !fileSize) return;

    uploadArea.style.display = 'none';
    filePreview.style.display = 'block';
    fileName.textContent = file.name;
    fileSize.textContent = `(${(file.size / 1024).toFixed(1)} KB)`;
}

function handleFileSelect(event) {
    if (event.target.files.length > 0) {
        handleFile(event.target.files[0]);
    }
}

function removeFile() {
    uploadedFile = null;
    const fileInput = document.getElementById('ndaFile');
    const uploadArea = document.getElementById('fileUploadArea');
    const filePreview = document.getElementById('filePreview');

    if (fileInput) fileInput.value = '';
    if (uploadArea) uploadArea.style.display = 'block';
    if (filePreview) filePreview.style.display = 'none';
}

// ============================================================================
// NDA GENERATION
// ============================================================================

async function generateNDA() {
    // Waliduj formularz najpierw
    if (!validateForm()) {
        alert('Proszę poprawnie wypełnić wszystkie wymagane pola formularza przed wygenerowaniem NDA');
        return;
    }

    const form = document.getElementById('applicationForm');
    const formDataObj = new FormData(form);

    // Konwertuj do JSON
    const data = {};
    formDataObj.forEach((value, key) => {
        data[key] = value;
    });

    // Zapisz dane globalnie
    formData = data;

    const button = event.target;
    const originalText = button.textContent;
    button.textContent = 'Generowanie PDF...';
    button.disabled = true;

    try {
        const response = await fetch('/partner-academy/api/application/generate-nda', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `NDA_${data.last_name}_${data.first_name}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            alert('PDF został pobrany. Proszę podpisać i załączyć powyżej.');
        } else {
            const errorData = await response.json();
            alert(errorData.error || 'Wystąpił błąd podczas generowania PDF. Spróbuj ponownie.');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Wystąpił błąd podczas generowania PDF. Spróbuj ponownie.');
    } finally {
        button.textContent = originalText;
        button.disabled = false;
    }
}

// ============================================================================
// FORM SUBMISSION
// ============================================================================

async function submitForm() {
    // Walidacja formularza
    if (!validateForm()) {
        alert('Proszę poprawnie wypełnić wszystkie wymagane pola');
        return;
    }

    // Sprawdź czy plik NDA został załączony
    if (!uploadedFile) {
        alert('Proszę załączyć podpisaną umowę NDA');
        return;
    }

    const form = document.getElementById('applicationForm');
    const submitButton = document.getElementById('btnNext');

    // Przygotuj FormData
    const formDataToSend = new FormData(form);
    formDataToSend.append('nda_file', uploadedFile);

    // Ustaw stan przycisku
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Wysyłanie...';
    submitButton.disabled = true;

    try {
        const response = await fetch('/partner-academy/api/application/submit', {
            method: 'POST',
            body: formDataToSend
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // Sukces - pokaż komunikat i przekieruj lub zresetuj
            alert('Aplikacja została wysłana pomyślnie! Skontaktujemy się z Tobą w ciągu 48 godzin.');

            // Opcjonalnie: przekieruj na stronę podziękowania
            // window.location.href = '/partner-academy/thank-you';

            // Lub zresetuj formularz i wróć do kroku 1
            form.reset();
            uploadedFile = null;
            removeFile();
            currentStep = 1;
            goToStep(1);

        } else {
            // Błąd walidacji lub inny błąd
            alert(result.error || 'Wystąpił błąd podczas wysyłania formularza. Spróbuj ponownie.');

            // Jeśli są szczegółowe błędy walidacji, pokaż je
            if (result.errors) {
                Object.keys(result.errors).forEach(fieldName => {
                    const errorSpan = document.getElementById(`error_${fieldName}`);
                    const field = document.getElementById(fieldName);
                    if (errorSpan && field) {
                        errorSpan.textContent = result.errors[fieldName];
                        errorSpan.style.display = 'block';
                        field.classList.add('error');
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Wystąpił błąd podczas wysyłania formularza. Spróbuj ponownie.');
    } finally {
        submitButton.textContent = originalText;
        submitButton.disabled = false;
    }
}

// ============================================================================
// PRIVACY MODAL
// ============================================================================

function showPrivacyModal() {
    const modal = document.getElementById('privacyModal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closePrivacyModal() {
    const modal = document.getElementById('privacyModal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    }
}

// Zamknij modal po kliknięciu w tło
window.onclick = function (event) {
    const modal = document.getElementById('privacyModal');
    if (event.target === modal) {
        closePrivacyModal();
    }
}

// ============================================================================
// KEYBOARD NAVIGATION
// ============================================================================

document.addEventListener('keydown', function (e) {
    // Nie reaguj jeśli użytkownik pisze w polu
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }

    // Strzałka w prawo lub Enter - następny krok
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
        nextStep();
    }

    // Strzałka w lewo - poprzedni krok
    if (e.key === 'ArrowLeft') {
        prevStep();
    }
});