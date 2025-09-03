// ========================================
// REGISTER MODULE - REFRESHED JAVASCRIPT
// ========================================

// Global state
let currentPage = 1;
let currentSortBy = 'company_name';
let currentSortDir = 'asc';
let searchResults = [];
let currentCompanies = [];

// Configuration
const ITEMS_PER_PAGE = 20;

// DOM Elements
const elements = {
    // Buttons
    openSearchModal: document.getElementById('openSearchModal'),
    applyFilters: document.getElementById('applyFilters'),
    startSearch: document.getElementById('startSearch'),
    saveSelected: document.getElementById('saveSelected'),
    cancelSearch: document.getElementById('cancelSearch'),
    closeModal: document.getElementById('closeModal'),
    backToSearch: document.getElementById('backToSearch'),
    modalClose: document.getElementById('modalClose'),
    detailsClose: document.getElementById('detailsClose'),
    selectAllResults: document.getElementById('selectAllResults'),

    // Filters
    filterNip: document.getElementById('filterNip'),
    filterName: document.getElementById('filterName'),
    filterPkd: document.getElementById('filterPkd'),
    filterDateFrom: document.getElementById('filterDateFrom'),
    filterDateTo: document.getElementById('filterDateTo'),

    // Search form
    searchRegister: document.getElementById('searchRegister'),
    searchNip: document.getElementById('searchNip'),
    searchRegon: document.getElementById('searchRegon'),
    searchName: document.getElementById('searchName'),
    searchPkd: document.getElementById('searchPkd'),
    searchDateFrom: document.getElementById('searchDateFrom'),
    searchDateTo: document.getElementById('searchDateTo'),

    // Content areas
    companiesTableBody: document.getElementById('companiesTableBody'),
    searchResultsBody: document.getElementById('searchResultsBody'),
    detailsTableBody: document.getElementById('detailsTableBody'),
    pagination: document.getElementById('pagination'),
    searchInfo: document.getElementById('searchInfo'),

    // Modals
    searchModal: document.getElementById('searchModal'),
    detailsModal: document.getElementById('detailsModal'),
    searchStep1: document.getElementById('searchStep1'),
    searchStep2: document.getElementById('searchStep2'),
    modalTitle: document.getElementById('modalTitle'),

    // Overlays
    loadingOverlay: document.getElementById('loadingOverlay'),
    toast: document.getElementById('toast')
};

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    console.log('Initializing Register Module...');

    // Load initial data
    loadCompanies();

    // Setup event listeners
    setupEventListeners();

    console.log('Register Module initialized successfully');
}

function setupEventListeners() {
    // Main action buttons
    elements.openSearchModal?.addEventListener('click', openSearchModal);
    elements.applyFilters?.addEventListener('click', () => loadCompanies(1));

    // Search modal actions
    elements.startSearch?.addEventListener('click', startSearch);
    elements.saveSelected?.addEventListener('click', saveSelectedCompanies);
    elements.selectAllResults?.addEventListener('change', toggleAllResults);

    // Modal controls
    elements.cancelSearch?.addEventListener('click', closeSearchModal);
    elements.closeModal?.addEventListener('click', closeSearchModal);
    elements.modalClose?.addEventListener('click', closeSearchModal);
    elements.backToSearch?.addEventListener('click', showSearchStep1);
    elements.detailsClose?.addEventListener('click', closeDetailsModal);

    // Modal backdrop clicks
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-backdrop')) {
            if (elements.searchModal.style.display !== 'none') {
                closeSearchModal();
            }
            if (elements.detailsModal.style.display !== 'none') {
                closeDetailsModal();
            }
        }
    });

    // Table sorting
    setupTableSorting();

    // Keyboard shortcuts
    setupKeyboardShortcuts();
}

function setupTableSorting() {
    const sortableHeaders = document.querySelectorAll('.data-table th.sortable');

    sortableHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const sortField = header.getAttribute('data-sort');
            if (!sortField) return;

            // Update sort direction
            if (currentSortBy === sortField) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortBy = sortField;
                currentSortDir = 'asc';
            }

            // Update UI indicators
            updateSortIndicators(header, currentSortDir);

            // Reload data
            loadCompanies(1);
        });
    });
}

function updateSortIndicators(activeHeader, direction) {
    // Reset all sort indicators
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.style.transform = 'translateY(-50%) rotate(0deg)';
        icon.style.opacity = '0.5';
    });

    // Update active indicator
    const activeIcon = activeHeader.querySelector('.sort-icon');
    if (activeIcon) {
        activeIcon.style.opacity = '1';
        activeIcon.style.transform = direction === 'desc'
            ? 'translateY(-50%) rotate(180deg)'
            : 'translateY(-50%) rotate(0deg)';
    }
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Escape key closes modals
        if (e.key === 'Escape') {
            if (elements.searchModal.style.display !== 'none') {
                closeSearchModal();
            }
            if (elements.detailsModal.style.display !== 'none') {
                closeDetailsModal();
            }
        }

        // Ctrl+F opens search modal
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            openSearchModal();
        }
    });
}

// ========================================
// DATA LOADING FUNCTIONS
// ========================================

async function loadCompanies(page = currentPage) {
    currentPage = page;
    showLoading(true);

    try {
        const params = buildCompanyFilterParams();
        const response = await fetch(`/register/api/companies?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
            currentCompanies = data.data.companies || [];
            
            // DODAJ TEN LOG:
            console.log(`🔍 DEBUG: Loaded ${currentCompanies.length} companies from database`);
            if (currentCompanies.length > 0) {
                const sample = currentCompanies[0];
                console.log('📊 Sample company from database:', {
                    name: sample.company_name,
                    nip: sample.nip,
                    pkd_main: sample.pkd_main,
                    industry_desc: sample.industry_desc,
                    phone: sample.phone,
                    email: sample.email,
                    allKeys: Object.keys(sample)
                });
            }
            
            populateCompanyTable(currentCompanies);
            setupPagination(data.data.total_pages || 1, data.data.page || 1);

            console.log(`Loaded ${currentCompanies.length} companies`);
        } else {
            showToast(data.error || 'Błąd pobierania firm', 'error');
            console.error('API Error:', data.error);
        }
    } catch (error) {
        console.error('Network Error:', error);
        showToast('Błąd połączenia z serwerem', 'error');
    } finally {
        showLoading(false);
    }
}

function buildCompanyFilterParams() {
    const params = new URLSearchParams({
        limit: ITEMS_PER_PAGE,
        offset: (currentPage - 1) * ITEMS_PER_PAGE,
        sort_by: currentSortBy,
        sort_dir: currentSortDir,
    });

    // Add filters if they have values
    const filters = {
        nip: elements.filterNip?.value,
        company_name: elements.filterName?.value,
        pkd_code: elements.filterPkd?.value,
        foundation_date_from: elements.filterDateFrom?.value,
        foundation_date_to: elements.filterDateTo?.value
    };

    Object.entries(filters).forEach(([key, value]) => {
        if (value && value.trim()) {
            params.append(key, value.trim());
        }
    });

    return params;
}

function populateCompanyTable(companies) {
    if (!elements.companiesTableBody) {
        console.error('Table body element not found');
        return;
    }

    elements.companiesTableBody.innerHTML = '';

    if (companies.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td colspan="9" style="text-align: center; padding: 40px; color: #6b7280;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="#d1d5db">
                        <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.1 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>
                    </svg>
                    <span>Brak firm spełniających kryteria wyszukiwania</span>
                </div>
            </td>
        `;
        elements.companiesTableBody.appendChild(emptyRow);
        return;
    }

    companies.forEach((company, index) => {
        const row = createCompanyRow(company, index);
        elements.companiesTableBody.appendChild(row);
    });
}

function createCompanyRow(company, index) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${sanitizeText(company.nip || '')}</td>
        <td>${sanitizeText(company.company_name || '')}</td>
        <td>${sanitizeText(company.pkd_main || '')}</td>
        <td>${sanitizeText(company.industry_desc || '')}</td>
        <td>${formatPhone(company.phone)}</td>
        <td>${formatEmail(company.email)}</td>
        <td>${formatDate(company.foundation_date)}</td>
        <td>${formatStatus(company.status)}</td>
        <td class="actions-col">
            <button class="info-btn" data-index="${index}" aria-label="Szczegóły firmy ${company.company_name || 'bez nazwy'}" title="Zobacz szczegóły">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                </svg>
            </button>
        </td>
    `;

    // Add click handler for info button
    const infoBtn = row.querySelector('.info-btn');
    infoBtn.addEventListener('click', () => openCompanyDetails(index));

    return row;
}

// ========================================
// SEARCH FUNCTIONALITY
// ========================================

function openSearchModal() {
    if (!elements.searchModal) return;

    elements.searchModal.style.display = 'flex';
    showSearchStep1();

    // Focus first input
    setTimeout(() => {
        elements.searchRegister?.focus();
    }, 100);
}

function closeSearchModal() {
    if (!elements.searchModal) return;

    elements.searchModal.style.display = 'none';
    clearSearchForm();
}

function showSearchStep1() {
    if (!elements.searchStep1 || !elements.searchStep2) return;

    elements.searchStep1.style.display = 'block';
    elements.searchStep2.style.display = 'none';

    if (elements.modalTitle) {
        elements.modalTitle.textContent = 'Wyszukaj firmę';
    }
}

function showSearchStep2() {
    if (!elements.searchStep1 || !elements.searchStep2) return;

    elements.searchStep1.style.display = 'none';
    elements.searchStep2.style.display = 'block';

    if (elements.modalTitle) {
        elements.modalTitle.textContent = 'Wyniki wyszukiwania';
    }
}

async function startSearch() {
    const searchParams = buildSearchParams();

    if (!validateSearchParams(searchParams)) {
        showToast('Podaj co najmniej jedno kryterium wyszukiwania', 'warning');
        return;
    }

    // DODAJ TEN LOG:
    console.log('🔍 DEBUG: Search parameters:', searchParams);

    showLoading(true);

    try {
        const response = await fetch('/register/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(searchParams)
        });

        const data = await response.json();

        if (data.success) {
            searchResults = data.data.companies || [];

            // DODAJ TEN LOG:
            console.log(`🔍 DEBUG: Search found ${searchResults.length} companies from API`);
            if (searchResults.length > 0) {
                const sample = searchResults[0];
                console.log('📊 Sample company from search API:', {
                    register_type: sample.register_type,
                    name: sample.company_name,
                    nip: sample.nip,
                    regon: sample.regon,
                    pkd_main: sample.pkd_main,
                    industry_desc: sample.industry_desc,
                    phone: sample.phone,
                    email: sample.email,
                    pkd_codes: sample.pkd_codes,
                    foundation_date: sample.foundation_date,
                    status: sample.status,
                    allKeys: Object.keys(sample)
                });
            }

            // Check which companies already exist in our database
            await markExistingCompanies(searchResults);

            // Display results
            displaySearchResults(searchResults);
            showSearchStep2();

            updateSearchInfo(searchResults.length, data.data.limit_exceeded);

            console.log(`Found ${searchResults.length} companies`);
        } else {
            showToast(data.error || 'Błąd wyszukiwania', 'error');
            console.error('Search API Error:', data.error);
        }
    } catch (error) {
        console.error('Search Network Error:', error);
        showToast('Błąd połączenia podczas wyszukiwania', 'error');
    } finally {
        showLoading(false);
    }
}

function buildSearchParams() {
    const params = {
        register_type: elements.searchRegister?.value || undefined,
        nip: elements.searchNip?.value || undefined,
        regon: elements.searchRegon?.value || undefined,
        company_name: elements.searchName?.value || undefined,
        pkd_code: elements.searchPkd?.value || undefined,
        foundation_date_from: elements.searchDateFrom?.value || undefined,
        foundation_date_to: elements.searchDateTo?.value || undefined,
    };

    // Remove undefined values
    Object.keys(params).forEach(key => {
        if (params[key] === undefined || params[key] === '') {
            delete params[key];
        }
    });

    return params;
}

function validateSearchParams(params) {
    // Exclude register_type from validation
    const { register_type, ...searchCriteria } = params;

    // Check if at least one search criterion is provided
    return Object.values(searchCriteria).some(value =>
        value !== undefined && value !== '' && value.toString().trim() !== ''
    );
}

async function markExistingCompanies(companies) {
    for (const company of companies) {
        if (!company.nip) {
            company.exists = false;
            continue;
        }

        try {
            const response = await fetch(`/register/api/companies?nip=${encodeURIComponent(company.nip)}`);
            const data = await response.json();

            company.exists = data.success &&
                data.data &&
                data.data.companies &&
                data.data.companies.length > 0;
        } catch (error) {
            console.warn(`Failed to check existence for NIP ${company.nip}:`, error);
            company.exists = false;
        }
    }
}

function displaySearchResults(results) {
    if (!elements.searchResultsBody) return;

    elements.searchResultsBody.innerHTML = '';

    if (results.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
            <td colspan="7" style="text-align: center; padding: 40px; color: #6b7280;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="#d1d5db">
                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    </svg>
                    <span>Nie znaleziono firm spełniających kryteria</span>
                </div>
            </td>
        `;
        elements.searchResultsBody.appendChild(emptyRow);
        return;
    }

    results.forEach((company, index) => {
        const row = createSearchResultRow(company, index);
        elements.searchResultsBody.appendChild(row);
    });
}

function createSearchResultRow(company, index) {
    const row = document.createElement('tr');

    if (company.exists) {
        row.classList.add('exists');
        row.title = 'Ta firma już istnieje w bazie danych';
    }

    row.innerHTML = `
        <td class="checkbox-col">
            <input type="checkbox" data-index="${index}" ${company.exists ? '' : 'checked'} 
                   aria-label="Wybierz firmę ${company.company_name || 'bez nazwy'}">
        </td>
        <td>${sanitizeText(company.nip || '')}</td>
        <td>${sanitizeText(company.company_name || '')}</td>
        <td>${sanitizeText(company.pkd_main || '')}</td>
        <td>${sanitizeText(company.industry_desc || '')}</td>
        <td>${formatDate(company.foundation_date)}</td>
        <td>${formatStatus(company.status)}</td>
    `;

    return row;
}

function updateSearchInfo(count, limitExceeded) {
    if (!elements.searchInfo) return;

    let message = `Znaleziono ${count} wyników`;

    if (limitExceeded) {
        message += ` (pokazano maksymalnie ${ITEMS_PER_PAGE} pierwszych)`;
    }

    elements.searchInfo.textContent = message;
}

function toggleAllResults(event) {
    const checkboxes = document.querySelectorAll('#searchResultsBody input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = event.target.checked;
    });
}

async function saveSelectedCompanies() {
    const selectedCheckboxes = document.querySelectorAll('#searchResultsBody input[type="checkbox"]:checked');

    if (selectedCheckboxes.length === 0) {
        showToast('Wybierz co najmniej jedną firmę do zapisania', 'warning');
        return;
    }

    const selectedCompanies = Array.from(selectedCheckboxes).map(checkbox => {
        const index = parseInt(checkbox.getAttribute('data-index'));
        return searchResults[index];
    });

    // DODAJ TEN LOG:
    console.log(`💾 DEBUG: Saving ${selectedCompanies.length} companies`);
    if (selectedCompanies.length > 0) {
        const sample = selectedCompanies[0];
        console.log('📊 Sample company being saved:', {
            register_type: sample.register_type,
            name: sample.company_name,
            nip: sample.nip,
            regon: sample.regon,
            pkd_main: sample.pkd_main,
            industry_desc: sample.industry_desc,
            phone: sample.phone,
            email: sample.email,
            pkd_codes: sample.pkd_codes,
            foundation_date: sample.foundation_date,
            status: sample.status,
            allKeys: Object.keys(sample)
        });
    }

    showLoading(true);

    try {
        const response = await fetch('/register/api/save-companies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                companies: selectedCompanies,
                update_existing: false
            })
        });

        const data = await response.json();

        // DODAJ TEN LOG:
        console.log('💾 DEBUG: Save response:', {
            success: data.success,
            message: data.message,
            error: data.error,
            stats: data.data
        });

        if (data.success) {
            showToast(data.message || `Zapisano ${selectedCompanies.length} firm`, 'success');

            // Refresh the main table
            loadCompanies();

            // Close modal
            closeSearchModal();

            console.log('Companies saved successfully:', data.data);
        } else {
            showToast(data.error || 'Błąd podczas zapisywania firm', 'error');
            console.error('Save API Error:', data.error);
        }
    } catch (error) {
        console.error('Save Network Error:', error);
        showToast('Błąd połączenia podczas zapisywania', 'error');
    } finally {
        showLoading(false);
    }
}

// ========================================
// COMPANY DETAILS
// ========================================

function openCompanyDetails(index) {
    const company = currentCompanies[index];
    if (!company) {
        console.error('Company not found at index:', index);
        return;
    }

    populateDetailsModal(company);

    if (elements.detailsModal) {
        elements.detailsModal.style.display = 'flex';
    }
}

function closeDetailsModal() {
    if (elements.detailsModal) {
        elements.detailsModal.style.display = 'none';
    }
}

function populateDetailsModal(company) {
    if (!elements.detailsTableBody) return;

    elements.detailsTableBody.innerHTML = '';

    const fieldOrder = [
        'id', 'register_type', 'nip', 'regon', 'company_name',
        'address', 'postal_code', 'city', 'legal_form', 'status',
        'pkd_main', 'pkd_codes', 'industry_desc', 'phone', 'email',
        'foundation_date', 'last_update_date'
    ];

    const fieldLabels = {
        id: 'ID',
        register_type: 'Rejestr',
        nip: 'NIP',
        regon: 'REGON',
        company_name: 'Nazwa firmy',
        address: 'Adres',
        postal_code: 'Kod pocztowy',
        city: 'Miasto',
        legal_form: 'Forma prawna',
        status: 'Status',
        pkd_main: 'Główny PKD',
        pkd_codes: 'Kody PKD',
        industry_desc: 'Branża',
        phone: 'Telefon',
        email: 'Email',
        foundation_date: 'Data utworzenia',
        last_update_date: 'Ostatnia aktualizacja'
    };

    const excludeFields = ['company_id', 'full_data', 'created_at', 'updated_at', 'created_by'];

    fieldOrder.forEach(field => {
        if (excludeFields.includes(field)) return;

        let value = company[field];

        // Format specific fields
        if (field === 'pkd_codes' && Array.isArray(value)) {
            value = value.length > 0 ? value.join(', ') : 'Brak danych';
        } else if (field === 'phone' && value) {
            value = `<a href="tel:${value}" class="phone-link">${value}</a>`;
        } else if (field === 'email' && value) {
            value = `<a href="mailto:${value}" class="email-link">${value}</a>`;
        } else if (field === 'foundation_date' || field === 'last_update_date') {
            value = formatDate(value);
        } else if (field === 'status') {
            value = formatStatus(value);
        }

        // Handle empty values
        if (value === undefined || value === null || value === '') {
            value = '<span style="color: #9ca3af; font-style: italic;">Brak danych</span>';
        }

        const row = document.createElement('tr');
        row.innerHTML = `
            <th>${fieldLabels[field] || field}</th>
            <td>${value}</td>
        `;

        elements.detailsTableBody.appendChild(row);
    });
}

// ========================================
// PAGINATION
// ========================================

function setupPagination(totalPages, currentPageNum) {
    if (!elements.pagination) return;

    elements.pagination.innerHTML = '';

    if (totalPages <= 1) return;

    // Previous button
    if (currentPageNum > 1) {
        const prevBtn = createPaginationButton('‹', currentPageNum - 1);
        prevBtn.setAttribute('aria-label', 'Poprzednia strona');
        elements.pagination.appendChild(prevBtn);
    }

    // Page numbers
    const startPage = Math.max(1, currentPageNum - 2);
    const endPage = Math.min(totalPages, currentPageNum + 2);

    if (startPage > 1) {
        elements.pagination.appendChild(createPaginationButton(1, 1));
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '8px 4px';
            ellipsis.style.color = '#6b7280';
            elements.pagination.appendChild(ellipsis);
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = createPaginationButton(i, i);
        if (i === currentPageNum) {
            btn.classList.add('active');
            btn.setAttribute('aria-current', 'page');
        }
        elements.pagination.appendChild(btn);
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '8px 4px';
            ellipsis.style.color = '#6b7280';
            elements.pagination.appendChild(ellipsis);
        }
        elements.pagination.appendChild(createPaginationButton(totalPages, totalPages));
    }

    // Next button
    if (currentPageNum < totalPages) {
        const nextBtn = createPaginationButton('›', currentPageNum + 1);
        nextBtn.setAttribute('aria-label', 'Następna strona');
        elements.pagination.appendChild(nextBtn);
    }
}

function createPaginationButton(text, page) {
    const button = document.createElement('button');
    button.textContent = text;
    button.setAttribute('aria-label', `Strona ${page}`);
    button.addEventListener('click', () => loadCompanies(page));
    return button;
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function showLoading(show) {
    if (!elements.loadingOverlay) return;
    elements.loadingOverlay.style.display = show ? 'flex' : 'none';
}

function showToast(message, type = 'info') {
    if (!elements.toast) return;

    elements.toast.textContent = message;
    elements.toast.className = `toast toast-${type}`;
    elements.toast.style.display = 'block';

    // Auto-hide after 4 seconds
    setTimeout(() => {
        elements.toast.style.display = 'none';
    }, 4000);

    console.log(`Toast (${type}):`, message);
}

function clearSearchForm() {
    const searchInputs = [
        'searchRegister', 'searchNip', 'searchRegon',
        'searchName', 'searchPkd', 'searchDateFrom', 'searchDateTo'
    ];

    searchInputs.forEach(inputId => {
        const element = elements[inputId];
        if (element) {
            element.value = '';
        }
    });
}

// Text formatting functions
function sanitizeText(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(dateString) {
    if (!dateString) return '';

    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;

        return date.toLocaleDateString('pl-PL', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    } catch (error) {
        return dateString;
    }
}

function formatPhone(phone) {
    if (!phone) return '';
    return `<a href="tel:${phone}" class="phone-link" title="Zadzwoń">${sanitizeText(phone)}</a>`;
}

function formatEmail(email) {
    if (!email) return '';
    return `<a href="mailto:${email}" class="email-link" title="Wyślij email">${sanitizeText(email)}</a>`;
}

function formatStatus(status) {
    if (!status) return '';

    const statusClasses = {
        'Aktywna': 'status-active',
        'Wykreślona': 'status-inactive',
        'Zawieszona': 'status-suspended',
        'Oczekuje na rozpoczęcie': 'status-pending'
    };

    const statusClass = statusClasses[status] || 'status-default';
    return `<span class="status-badge ${statusClass}">${sanitizeText(status)}</span>`;
}

// Export functions for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        sanitizeText,
        formatDate,
        formatPhone,
        formatEmail,
        formatStatus
    };
}