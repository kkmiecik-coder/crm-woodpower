// ============================================================================
// PARTNER ACADEMY - RECRUITMENT JAVASCRIPT
// Multi-step wizard, form validation, file upload, AJAX submission
// ============================================================================

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let currentStep = 1;
const totalSteps = 8;
let formData = {};
let uploadedFile = null;

// ============================================================================
// STEP NAVIGATION
// ============================================================================

function nextStep() {
    if (validateCurrentStep()) {
        if (currentStep < totalSteps) {
            hideStep(currentStep);
            currentStep++;
            showStep(currentStep);
            updateProgressBar();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }
}

function prevStep() {
    if (currentStep > 1) {
        hideStep(currentStep);
        currentStep--;
        showStep(currentStep);
        updateProgressBar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function goToStep(step) {
    if (step >= 1 && step <= totalSteps) {
        hideStep(currentStep);
        currentStep = step;
        showStep(currentStep);
        updateProgressBar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function showStep(step) {
    const stepElement = document.querySelector(`.step-content[data-step="${step}"]`);
    if (stepElement) {
        stepElement.classList.add('active');
        stepElement.style.display = 'block'; // Dodaj to

        // Animuj statystyki jeśli step 2
        if (step === 2) {
            animateStats();
        }
    }
}

function hideStep(step) {
    const stepElement = document.querySelector(`.step-content[data-step="${step}"]`);
    if (stepElement) {
        stepElement.classList.remove('active');
        stepElement.style.display = 'none'; // Dodaj to
    }
}

function updateProgressBar() {
    const steps = document.querySelectorAll('.progress-step');
    steps.forEach((step, index) => {
        const stepNumber = index + 1;

        if (stepNumber < currentStep) {
            step.classList.add('completed');
            step.classList.remove('active');
        } else if (stepNumber === currentStep) {
            step.classList.add('active');
            step.classList.remove('completed');
        } else {
            step.classList.remove('completed', 'active');
        }
    });
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateCurrentStep() {
    // Step 7: Walidacja nie jest potrzebna (tylko sprawdza przycisk)
    // Step 8: Nie ma dodatkowej walidacji (już wszystko sprawdzone)
    return true;
}

function validateForm() {
    const form = document.getElementById('applicationForm');
    let isValid = true;

    // Wyczyść poprzednie błędy
    document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('input, select, textarea').forEach(el => el.classList.remove('error'));

    // Pola wymagane
    const requiredFields = {
        'first_name': 'Imię jest wymagane',
        'last_name': 'Nazwisko jest wymagane',
        'email': 'Email jest wymagany',
        'phone': 'Telefon jest wymagany',
        'city': 'Miasto jest wymagane',
        'locality': 'Miejscowość jest wymagana'
    };

    // Sprawdź wymagane pola
    Object.keys(requiredFields).forEach(fieldName => {
        const field = form.elements[fieldName];
        if (!field.value.trim()) {
            showError(fieldName, requiredFields[fieldName]);
            isValid = false;
        }
    });

    // Walidacja email
    const email = form.elements['email'].value;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email && !emailRegex.test(email)) {
        showError('email', 'Nieprawidłowy format adresu email');
        isValid = false;
    }

    // Walidacja telefonu (polski format)
    const phone = form.elements['phone'].value;
    const phoneClean = phone.replace(/[\s\-()]/g, '');
    const phoneRegex = /^(\+?48)?[0-9]{9}$/;
    if (phone && !phoneRegex.test(phoneClean)) {
        showError('phone', 'Nieprawidłowy format numeru telefonu (wymagane 9 cyfr)');
        isValid = false;
    }

    // Zgoda RODO (wymagana)
    const consent = form.elements['data_processing_consent'];
    if (!consent.checked) {
        alert('Zgoda na przetwarzanie danych osobowych jest wymagana');
        isValid = false;
    }

    return isValid;
}

function showError(fieldName, message) {
    const errorElement = document.getElementById(`error_${fieldName}`);
    const fieldElement = document.getElementById(fieldName);

    if (errorElement) {
        errorElement.textContent = message;
    }
    if (fieldElement) {
        fieldElement.classList.add('error');
    }
}

// ============================================================================
// REAL-TIME VALIDATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('applicationForm');

    if (form) {
        // Walidacja real-time na blur
        const inputs = form.querySelectorAll('input[required], input[type="email"], input[type="tel"]');

        inputs.forEach(input => {
            input.addEventListener('blur', function () {
                validateFieldRealtime(this);
            });

            // Usuń błąd gdy użytkownik zaczyna pisać
            input.addEventListener('input', function () {
                const errorElement = document.getElementById(`error_${this.name}`);
                if (errorElement) {
                    errorElement.textContent = '';
                }
                this.classList.remove('error');
            });
        });
    }
});

async function validateFieldRealtime(field) {
    const fieldName = field.name;
    const value = field.value.trim();

    if (!value) return; // Nie waliduj pustych pól (tylko required przy submit)

    try {
        const response = await fetch('/partner-academy/api/application/validate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                field: fieldName,
                value: value
            })
        });

        const result = await response.json();

        if (!result.valid && result.message) {
            showError(fieldName, result.message);
        }
    } catch (error) {
        console.error('Validation error:', error);
    }
}

// ============================================================================
// ANIMATIONS
// ============================================================================

function animateStats() {
    const stats = document.querySelectorAll('.stat-number');
    stats.forEach(stat => {
        const target = parseInt(stat.getAttribute('data-count'));
        animateValue(stat, 0, target, 2000);
    });
}

function animateValue(element, start, end, duration) {
    let startTimestamp = null;

    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const current = Math.floor(progress * (end - start) + start);
        element.textContent = current.toLocaleString('pl-PL');

        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };

    window.requestAnimationFrame(step);
}

// ============================================================================
// NDA GENERATION
// ============================================================================

async function generateNDA() {
    // Waliduj formularz najpierw
    if (!validateForm()) {
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
    window.applicationFormData = data;

    // Znajdź przycisk w nowym layoucie
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
            alert('Wystąpił błąd podczas generowania PDF. Spróbuj ponownie.');
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
// FILE UPLOAD - INLINE VERSION
// ============================================================================

function handleFileUpload(file) {
    // Walidacja client-side
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

    // Pokaż preview inline
    const previewContainer = document.getElementById('filePreview');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');

    fileName.textContent = file.name;
    fileSize.textContent = `${(file.size / 1024).toFixed(1)} KB`;

    previewContainer.style.display = 'flex';

    // Sprawdź czy można kontynuować
    checkCanContinue();
}

function removeFile() {
    uploadedFile = null;
    document.getElementById('filePreview').style.display = 'none';
    document.getElementById('ndaFile').value = '';
    checkCanContinue();
}

// ============================================================================
// PROCEED TO SUMMARY (Step 7 → Step 8)
// ============================================================================

function proceedToSummary() {
    if (!validateForm()) {
        return;
    }

    if (!uploadedFile) {
        alert('Proszę załączyć podpisaną umowę NDA');
        return;
    }

    // Zapisz dane
    const form = document.getElementById('applicationForm');
    const formDataObj = new FormData(form);

    const data = {};
    formDataObj.forEach((value, key) => {
        data[key] = value;
    });

    window.applicationFormData = data;

    // Wypełnij podsumowanie
    fillSummary(data);

    // Przejdź do kroku 8
    nextStep();
}

// ============================================================================
// FILL SUMMARY (Step 8)
// ============================================================================

function fillSummary(data) {
    // Dane osobowe
    document.getElementById('summary_name').textContent = `${data.first_name} ${data.last_name}`;
    document.getElementById('summary_email').textContent = data.email;
    document.getElementById('summary_phone').textContent = data.phone;
    document.getElementById('summary_location').textContent = `${data.city}, ${data.locality}`;

    // Doświadczenie (jeśli wybrane)
    if (data.experience_level) {
        document.getElementById('summary_experience').textContent = data.experience_level;
        document.getElementById('summary_experience_container').style.display = 'flex';
    } else {
        document.getElementById('summary_experience_container').style.display = 'none';
    }

    // O sobie (jeśli wypełnione)
    if (data.about_text && data.about_text.trim()) {
        document.getElementById('summary_about').textContent = data.about_text;
        document.getElementById('summary_about_container').style.display = 'block';
    } else {
        document.getElementById('summary_about_container').style.display = 'none';
    }

    // Plik
    if (uploadedFile) {
        document.getElementById('summary_filename').textContent = uploadedFile.name;
        document.getElementById('summary_filesize').textContent = `${(uploadedFile.size / 1024).toFixed(1)} KB`;
    }
}

// ============================================================================
// CHECK CAN CONTINUE (Enable/Disable Button)
// ============================================================================

function checkCanContinue() {
    const form = document.getElementById('applicationForm');
    const continueBtn = document.getElementById('continueBtn');

    if (!form || !continueBtn) return;

    const requiredFields = ['first_name', 'last_name', 'email', 'phone', 'city', 'locality'];
    const allFilled = requiredFields.every(field => form.elements[field]?.value.trim());
    const consentChecked = form.elements['data_processing_consent']?.checked;
    const fileAttached = !!uploadedFile;

    continueBtn.disabled = !(allFilled && consentChecked && fileAttached);
}

// ============================================================================
// FORM SUBMISSION
// ============================================================================

async function submitApplication() {
    if (!uploadedFile) {
        alert('Proszę załączyć podpisaną umowę NDA');
        return;
    }

    // Pokaż loading
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wysyłanie...';

    // Przygotuj FormData
    const formData = new FormData();

    // Dodaj dane z formularza
    const data = window.applicationFormData || {};
    Object.keys(data).forEach(key => {
        // SKIP checkbox - dodamy go osobno
        if (key !== 'data_processing_consent') {
            formData.append(key, data[key]);
        }
    });

    // WAŻNE: Dodaj checkbox jawnie jako 'true'
    const form = document.getElementById('applicationForm');
    const consentChecked = form.elements['data_processing_consent']?.checked;
    formData.append('data_processing_consent', consentChecked ? 'true' : 'false');

    // Dodaj plik
    formData.append('nda_file', uploadedFile);

    try {
        const response = await fetch('/partner-academy/api/application/submit', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            // Przejdź do Step 9 (success)
            hideStep(currentStep);
            currentStep = 9;
            showStep(currentStep);
            updateProgressBar();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            // Pokaż szczegółowe błędy jeśli są
            if (result.errors) {
                const errorMessages = Object.values(result.errors).join('\n');
                alert(errorMessages);
            } else {
                alert(result.message || 'Wystąpił błąd podczas wysyłania aplikacji');
            }
            submitBtn.disabled = false;
            submitBtn.textContent = 'Wyślij aplikację';
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Wystąpił błąd podczas wysyłania aplikacji. Spróbuj ponownie.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Wyślij aplikację';
    }
}

// ============================================================================
// PRIVACY MODAL
// ============================================================================

function showPrivacyModal() {
    const modal = document.getElementById('privacyModal');
    modal.style.display = 'flex';
}

function closePrivacyModal() {
    const modal = document.getElementById('privacyModal');
    modal.style.display = 'none';
}

// Zamknij modal klikając poza nim
window.addEventListener('click', function (event) {
    const modal = document.getElementById('privacyModal');
    if (event.target === modal) {
        closePrivacyModal();
    }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function () {
    // Ustaw pierwszy krok jako aktywny
    updateProgressBar();

    // Dodaj listenery do formularza
    const form = document.getElementById('applicationForm');

    if (form) {
        form.addEventListener('input', checkCanContinue);
        form.addEventListener('change', checkCanContinue);
    }

    // Upload zone inline
    const uploadZoneInline = document.getElementById('uploadZoneInline');
    const fileInput = document.getElementById('ndaFile');

    if (uploadZoneInline && fileInput) {
        uploadZoneInline.addEventListener('click', () => fileInput.click());

        uploadZoneInline.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZoneInline.classList.add('drag-over');
        });

        uploadZoneInline.addEventListener('dragleave', () => {
            uploadZoneInline.classList.remove('drag-over');
        });

        uploadZoneInline.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZoneInline.classList.remove('drag-over');

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFileUpload(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
            }
        });
    }

    console.log('PartnerAcademy Recruitment initialized');
});