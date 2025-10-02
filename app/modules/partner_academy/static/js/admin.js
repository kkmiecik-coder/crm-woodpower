// admin.js - Panel administracyjny PartnerAcademy

// ============================================================================
// CONSTANTS & STATE
// ============================================================================

const STATUS_TRANSLATION = {
    'pending': 'Oczekująca',
    'contacted': 'Kontakt nawiązany',
    'accepted': 'Zaakceptowana',
    'rejected': 'Odrzucona'
};

const STATUS_BADGES = {
    'pending': 'status-pending',
    'contacted': 'status-contacted',
    'accepted': 'status-accepted',
    'rejected': 'status-rejected'
};

let currentPage = 1;
let totalPages = 1;
let currentFilters = {
    status: '',
    search: ''
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function () {
    console.log('[ADMIN] Inicjalizacja panelu admina...');
    loadStats();
    loadApplications();

    // Zamknij modal kliknięciem poza nim
    document.getElementById('applicationModal').addEventListener('click', function (e) {
        if (e.target.classList.contains('modal-overlay')) {
            closeModal();
        }
    });
    console.log('[ADMIN] Panel zainicjalizowany');
});

// ============================================================================
// STATS - DASHBOARD
// ============================================================================

async function loadStats() {
    console.log('[ADMIN] Ładowanie statystyk...');
    try {
        const response = await fetch('/partner-academy/admin/api/stats');
        console.log('[ADMIN] Stats response status:', response.status);

        const result = await response.json();
        console.log('[ADMIN] Stats result:', result);

        if (result.success) {
            const data = result.data;
            document.getElementById('stat-total').textContent = data.total_applications;
            document.getElementById('stat-pending').textContent = data.pending_count;
            document.getElementById('stat-accepted').textContent = data.accepted_count;
            document.getElementById('stat-in-progress').textContent = data.in_progress_count;
            document.getElementById('stat-completed').textContent = data.completed_count;
            document.getElementById('stat-avg-time').textContent = data.avg_time_hours;
            console.log('[ADMIN] Statystyki załadowane');
        } else {
            console.error('[ADMIN] Błąd ładowania statystyk:', result.message);
        }
    } catch (error) {
        console.error('[ADMIN] Error loading stats:', error);
    }
}

// ============================================================================
// APPLICATIONS - TABLE
// ============================================================================

async function loadApplications(page = 1) {
    console.log('[ADMIN] Ładowanie aplikacji, strona:', page);
    try {
        currentPage = page;
        const params = new URLSearchParams({
            page: page,
            per_page: 20,
            status: currentFilters.status,
            search: currentFilters.search
        });

        const url = `/partner-academy/admin/api/applications?${params}`;
        console.log('[ADMIN] Fetch URL:', url);

        const response = await fetch(url);
        console.log('[ADMIN] Applications response status:', response.status);

        const result = await response.json();
        console.log('[ADMIN] Applications result:', result);

        if (result.success) {
            renderApplicationsTable(result.data.applications);
            renderPagination(result.data.pagination);
            console.log('[ADMIN] Aplikacje załadowane:', result.data.applications.length);
        } else {
            console.error('[ADMIN] Błąd:', result.message);
        }
    } catch (error) {
        console.error('[ADMIN] Error loading applications:', error);
        document.getElementById('applicationsTableBody').innerHTML =
            '<tr><td colspan="7" class="loading-cell">Błąd ładowania danych</td></tr>';
    }
}

function renderApplicationsTable(applications) {
    const tbody = document.getElementById('applicationsTableBody');

    if (applications.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Brak wyników</td></tr>';
        return;
    }

    tbody.innerHTML = applications.map(app => `
        <tr>
            <td>${app.id}</td>
            <td>${app.created_at}</td>
            <td>${app.first_name} ${app.last_name}</td>
            <td>${app.email}</td>
            <td>${app.phone}</td>
            <td>
                <span class="status-badge ${STATUS_BADGES[app.status]}">
                    ${STATUS_TRANSLATION[app.status]}
                </span>
            </td>
            <td>
                <button class="btn-view" onclick="openModal(${app.id})">
                    Zobacz
                </button>
            </td>
        </tr>
    `).join('');
}

function renderPagination(pagination) {
    totalPages = pagination.pages;
    const container = document.getElementById('pagination');

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';

    // Previous button
    html += `<button onclick="loadApplications(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
        ← Poprzednia
    </button>`;

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            html += `<button onclick="loadApplications(${i})" ${i === currentPage ? 'class="active"' : ''}>
                ${i}
            </button>`;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            html += '<span>...</span>';
        }
    }

    // Next button
    html += `<button onclick="loadApplications(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
        Następna →
    </button>`;

    container.innerHTML = html;
}

// ============================================================================
// FILTERS
// ============================================================================

function filterApplications() {
    const statusFilter = document.getElementById('statusFilter').value;
    const searchInput = document.getElementById('searchInput').value;

    currentFilters.status = statusFilter;
    currentFilters.search = searchInput;

    // Reset to page 1
    loadApplications(1);
}

// ============================================================================
// MODAL - APPLICATION DETAILS
// ============================================================================

async function openModal(applicationId) {
    console.log('[ADMIN] Otwieranie modala dla aplikacji:', applicationId);

    // Otwórz modal natychmiast ze spinnerem
    const modalContent = document.getElementById('modalContent');
    modalContent.innerHTML = `
        <div style="text-align: center; padding: 60px 20px;">
            <div class="spinner"></div>
            <p style="margin-top: 20px; color: var(--text-gray);">Ładowanie danych...</p>
        </div>
    `;
    document.getElementById('applicationModal').style.display = 'flex';

    try {
        const response = await fetch(`/partner-academy/admin/api/applications/${applicationId}`);
        console.log('[ADMIN] Modal data response status:', response.status);

        const result = await response.json();
        console.log('[ADMIN] Modal data result:', result);

        if (result.success) {
            renderModalContent(result.data);
            console.log('[ADMIN] Modal wyrenderowany');
        } else {
            modalContent.innerHTML = `<p style="color: red;">Błąd: ${result.message}</p>`;
        }
    } catch (error) {
        console.error('[ADMIN] Error loading application details:', error);
        modalContent.innerHTML = `<p style="color: red;">Błąd ładowania szczegółów</p>`;
        showToast('Błąd ładowania szczegółów', 'error');
    }
}

function closeModal() {
    document.getElementById('applicationModal').style.display = 'none';
}

function renderModalContent(data) {
    const modalContent = document.getElementById('modalContent');

    const filesizeKB = data.nda_filesize ? (data.nda_filesize / 1024).toFixed(2) : 0;

    modalContent.innerHTML = `
        <h2>Aplikacja #${data.id}</h2>
        
        <!-- Status Control -->
        <div class="modal-section">
            <h3>Status</h3>
            <div class="status-control">
                <select id="statusSelect" data-app-id="${data.id}">
                    <option value="pending" ${data.status_raw === 'pending' ? 'selected' : ''}>Oczekująca</option>
                    <option value="contacted" ${data.status_raw === 'contacted' ? 'selected' : ''}>Kontakt nawiązany</option>
                    <option value="accepted" ${data.status_raw === 'accepted' ? 'selected' : ''}>Zaakceptowana</option>
                    <option value="rejected" ${data.status_raw === 'rejected' ? 'selected' : ''}>Odrzucona</option>
                </select>
                <button class="btn-save" onclick="updateStatus(${data.id})">Zapisz</button>
            </div>
        </div>
        
        <!-- Personal Data -->
        <div class="modal-section">
            <h3>Dane osobowe</h3>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Imię i nazwisko</span>
                    <span class="detail-value">${data.first_name} ${data.last_name}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Email</span>
                    <span class="detail-value">${data.email}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Telefon</span>
                    <span class="detail-value">${data.phone}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Lokalizacja</span>
                    <span class="detail-value">${data.city}, ${data.locality}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Doświadczenie</span>
                    <span class="detail-value">${data.experience_level}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Data aplikacji</span>
                    <span class="detail-value">${data.created_at}</span>
                </div>
            </div>
        </div>
        
        ${data.about_text ? `
        <div class="modal-section">
            <h3>Dlaczego chce zostać partnerem</h3>
            <div class="about-text">${data.about_text}</div>
        </div>
        ` : ''}
        
        <!-- NDA File -->
        <div class="modal-section">
            <h3>Dokumenty</h3>
            <div class="detail-item">
                <span class="detail-label">Plik NDA</span>
                <span class="detail-value">
                    <a href="/partner-academy/admin/api/applications/${data.id}/nda" 
                       target="_blank" 
                       style="color: var(--primary-color); text-decoration: underline;">
                        📄 ${data.nda_filename} (${filesizeKB} KB)
                    </a>
                </span>
            </div>
        </div>
        
        <!-- RODO -->
        <div class="modal-section">
            <h3>Zgody</h3>
            <div class="detail-item">
                <span class="detail-value">✓ Zgoda na przetwarzanie danych osobowych</span>
            </div>
        </div>
        
        <!-- Metadata -->
        <div class="modal-section">
            <h3>Metadata</h3>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Adres IP</span>
                    <span class="detail-value">${data.ip_address || 'N/A'}</span>
                </div>
            </div>
        </div>
        
        <!-- Notes -->
        <div class="modal-section notes-section">
            <h3>Notatki</h3>
            <div class="note-input-group">
                <textarea id="noteTextarea" placeholder="Dodaj notatkę..."></textarea>
                <button class="btn-add-note" onclick="addNote(${data.id})">Dodaj</button>
            </div>
            <div class="notes-list" id="notesList">
                ${renderNotes(data.notes)}
            </div>
        </div>
    `;
}

function renderNotes(notes) {
    if (!notes || notes.length === 0) {
        return '<div class="no-notes">Brak notatek</div>';
    }

    return notes.map(note => {
        const date = new Date(note.timestamp);
        const formattedDate = date.toLocaleString('pl-PL');

        return `
            <div class="note-item">
                <div class="note-header">
                    <span>${note.author}</span>
                    <span>${formattedDate}</span>
                </div>
                <div class="note-text">${note.text}</div>
            </div>
        `;
    }).join('');
}

// ============================================================================
// STATUS UPDATE
// ============================================================================

async function updateStatus(applicationId) {
    try {
        const select = document.getElementById('statusSelect');
        const newStatus = select.value;

        const response = await fetch(`/partner-academy/admin/api/applications/${applicationId}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: newStatus })
        });

        const result = await response.json();

        if (result.success) {
            showToast('Status zaktualizowany', 'success');
            loadApplications(currentPage); // Odśwież tabelę
        } else {
            showToast('Błąd aktualizacji statusu', 'error');
        }
    } catch (error) {
        console.error('Error updating status:', error);
        showToast('Błąd aktualizacji statusu', 'error');
    }
}

// ============================================================================
// NOTES
// ============================================================================

async function addNote(applicationId) {
    try {
        const textarea = document.getElementById('noteTextarea');
        const text = textarea.value.trim();

        if (!text) {
            showToast('Treść notatki jest wymagana', 'error');
            return;
        }

        const response = await fetch(`/partner-academy/admin/api/applications/${applicationId}/notes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: text })
        });

        const result = await response.json();

        if (result.success) {
            showToast('Notatka dodana', 'success');
            textarea.value = '';

            // Odśwież notatki
            const notesResponse = await fetch(`/partner-academy/admin/api/applications/${applicationId}`);
            const notesResult = await notesResponse.json();
            if (notesResult.success) {
                document.getElementById('notesList').innerHTML = renderNotes(notesResult.data.notes);
            }
        } else {
            showToast(result.message || 'Błąd dodawania notatki', 'error');
        }
    } catch (error) {
        console.error('Error adding note:', error);
        showToast('Błąd dodawania notatki', 'error');
    }
}

// ============================================================================
// EXPORT
// ============================================================================

function exportToXLSX() {
    const params = new URLSearchParams({
        status: currentFilters.status,
        search: currentFilters.search
    });

    window.location.href = `/partner-academy/admin/api/export?${params}`;
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================

function showToast(message, type = 'info') {
    // Utwórz kontener jeśli nie istnieje
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // Utwórz toast
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Pokaż toast
    setTimeout(() => toast.classList.add('show'), 100);

    // Auto-remove po 3 sekundach
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================================
// LINK ACTIONS - COPY/OPEN
// ============================================================================

let lastClickTime = 0;
let lastClickedPath = null;

function handleLinkAction(path) {
    const fullUrl = window.location.origin + path;
    const currentTime = Date.now();

    // Sprawdź czy to drugie kliknięcie w ciągu 1 sekundy
    if (lastClickedPath === path && (currentTime - lastClickTime) < 1000) {
        // Drugie kliknięcie - otwórz w nowej karcie
        window.open(fullUrl, '_blank');
        console.log('[ADMIN] Otwarto link w nowej karcie:', fullUrl);
        lastClickTime = 0;
        lastClickedPath = null;
    } else {
        // Pierwsze kliknięcie - skopiuj do schowka
        navigator.clipboard.writeText(fullUrl).then(() => {
            showToast('Link skopiowany do schowka', 'success');
            console.log('[ADMIN] Skopiowano link:', fullUrl);
        }).catch(err => {
            showToast('Błąd kopiowania linku', 'error');
            console.error('[ADMIN] Błąd kopiowania:', err);
        });
        lastClickTime = currentTime;
        lastClickedPath = path;
    }
}