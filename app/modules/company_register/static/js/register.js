// Front-end logic for company register module

document.addEventListener('DOMContentLoaded', () => {
    loadCompanies();
    document.getElementById('applyFilters').addEventListener('click', () => loadCompanies(1));
    document.getElementById('openSearchModal').addEventListener('click', openModal);
    document.getElementById('cancelSearch').addEventListener('click', closeModal);
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('backToSearch').addEventListener('click', showStep1);
    document.getElementById('startSearch').addEventListener('click', startSearch);
    document.getElementById('saveSelected').addEventListener('click', saveSelected);
    document.getElementById('selectAllResults').addEventListener('change', toggleAllResults);
    document.getElementById('detailsClose').addEventListener('click', closeDetails);

    document.querySelectorAll('.register-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const sort = th.dataset.sort;
            if (currentSortBy === sort) {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortBy = sort;
                currentSortDir = 'asc';
            }
            loadCompanies();
        });
    });
});

let currentPage = 1;
let currentSortBy = 'company_name';
let currentSortDir = 'asc';
let searchResults = [];
let currentCompanies = [];

const limit = 20;

function showLoading(show) {
    document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 4000);
}

async function loadCompanies(page = currentPage) {
    currentPage = page;
    showLoading(true);
    try {
        const params = new URLSearchParams({
            limit: limit,
            offset: (currentPage - 1) * limit,
            sort_by: currentSortBy,
            sort_dir: currentSortDir,
        });
        const nip = document.getElementById('filterNip').value;
        const name = document.getElementById('filterName').value;
        const pkd = document.getElementById('filterPkd').value;
        const dateFrom = document.getElementById('filterDateFrom').value;
        const dateTo = document.getElementById('filterDateTo').value;
        if (nip) params.append('nip', nip);
        if (name) params.append('company_name', name);
        if (pkd) params.append('pkd_code', pkd);
        if (dateFrom) params.append('foundation_date_from', dateFrom);
        if (dateTo) params.append('foundation_date_to', dateTo);
        const res = await fetch(`/register/api/companies?${params.toString()}`);
        const data = await res.json();
        if (data.success) {
            currentCompanies = data.data.companies || [];
            populateCompanyTable(currentCompanies);
            setupPagination(data.data.total_pages || 1, data.data.page || 1);
        } else {
            showToast(data.error || 'Błąd pobierania firm');
        }
    } catch (err) {
        console.error(err);
        showToast('Błąd połączenia');
    } finally {
        showLoading(false);
    }
}

function populateCompanyTable(companies) {
    const tbody = document.getElementById('companiesTableBody');
    tbody.innerHTML = '';
    companies.forEach((c, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${c.nip || ''}</td>` +
            `<td>${c.company_name || ''}</td>` +
            `<td>${c.pkd_main || ''}</td>` +
            `<td>${c.industry_desc || ''}</td>` +
            `<td>${c.phone || ''}</td>` +
            `<td>${c.email || ''}</td>` +
            `<td>${c.foundation_date || ''}</td>` +
            `<td>${c.status || ''}</td>`;
        const infoTd = document.createElement('td');
        infoTd.innerHTML = `<button class="info-btn" data-index="${idx}" aria-label="Szczegóły">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm1 14h-2v-6h2v6z"/>
            </svg>
        </button>`;
        tr.appendChild(infoTd);
        tbody.appendChild(tr);
    });
    document.querySelectorAll('.info-btn').forEach(btn => {
        btn.addEventListener('click', () => openDetails(parseInt(btn.dataset.index)));
    });
}

function setupPagination(totalPages, current) {
    const container = document.getElementById('pagination');
    container.innerHTML = '';
    for (let p = 1; p <= totalPages; p++) {
        const btn = document.createElement('button');
        btn.textContent = p;
        if (p === current) btn.classList.add('active');
        btn.addEventListener('click', () => loadCompanies(p));
        container.appendChild(btn);
    }
}

function openModal() {
    document.getElementById('searchModal').style.display = 'flex';
    showStep1();
}

function closeModal() {
    document.getElementById('searchModal').style.display = 'none';
}

function showStep1() {
    document.getElementById('searchStep1').style.display = 'block';
    document.getElementById('searchStep2').style.display = 'none';
    document.getElementById('modalTitle').textContent = 'Wyszukaj firmę';
}

function showStep2() {
    document.getElementById('searchStep1').style.display = 'none';
    document.getElementById('searchStep2').style.display = 'block';
    document.getElementById('modalTitle').textContent = 'Wyniki wyszukiwania';
}

async function startSearch(params) {
    const searchInfo = document.getElementById('searchInfo');
    searchResults = [];

    const foundationDateTo = params.foundation_date_to ? new Date(params.foundation_date_to) : null;
    let page = 1;
    let fetched = 0;
    let keepGoing;

    do {
        keepGoing = false;
        const response = await fetch('/register/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...params, page })
        });

        if (!response.ok) {
            break;
        }

        const result = await response.json();
        if (result.success && result.data && Array.isArray(result.data.companies)) {
            const companies = result.data.companies;
            if (companies.length === 0) {
                break;
            }
            searchResults.push(...companies);
            fetched += companies.length;
            if (searchInfo) {
                searchInfo.textContent = `Pobrano ${fetched} rekordów...`;
            }

            const last = companies[companies.length - 1];
            if (last && last.foundation_date && foundationDateTo) {
                const lastDate = new Date(last.foundation_date);
                if (lastDate > foundationDateTo) {
                    break;
                }
            }

            page += 1;
            keepGoing = true;
        } else {
            break;
        }
    } while (keepGoing);

    if (searchInfo) {
        searchInfo.textContent = `Znaleziono ${searchResults.length} rekordów`;
    }

    if (typeof displayResults === 'function') {
        displayResults(searchResults);
    }
}

async function markExisting(results) {
    for (const r of results) {
        if (!r.nip) continue;
        try {
            const res = await fetch(`/register/api/companies?nip=${r.nip}`);
            const data = await res.json();
            r.exists = data.success && data.data && data.data.companies && data.data.companies.length > 0;
        } catch (e) {
            r.exists = false;
        }
    }
}

function displaySearchResults(results) {
    const tbody = document.getElementById('searchResultsBody');
    tbody.innerHTML = '';
    results.forEach((r, idx) => {
        const tr = document.createElement('tr');
        if (r.exists) tr.classList.add('exists');
        tr.innerHTML = `<td><input type="checkbox" data-index="${idx}" checked></td>` +
            `<td>${r.nip || ''}</td>` +
            `<td>${r.company_name || ''}</td>` +
            `<td>${r.pkd_main || ''}</td>` +
            `<td>${r.industry_desc || ''}</td>` +
            `<td>${r.foundation_date || ''}</td>` +
            `<td>${r.status || ''}</td>`;
        tbody.appendChild(tr);
    });
}

function toggleAllResults(e) {
    document.querySelectorAll('#searchResultsBody input[type="checkbox"]').forEach(cb => cb.checked = e.target.checked);
}

async function saveSelected() {
    const selected = Array.from(document.querySelectorAll('#searchResultsBody input[type="checkbox"]'))
        .filter(cb => cb.checked)
        .map(cb => searchResults[parseInt(cb.dataset.index)]);
    if (selected.length === 0) {
        showToast('Brak wybranych firm');
        return;
    }
    showLoading(true);
    try {
        const res = await fetch('/register/api/save-companies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companies: selected })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message || 'Zapisano firmy');
            loadCompanies();
            closeModal();
        } else {
            showToast(data.error || 'Błąd zapisu');
        }
    } catch (err) {
        console.error(err);
        showToast('Błąd połączenia');
    } finally {
        showLoading(false);
    }
}

function openDetails(idx) {
    const c = currentCompanies[idx];
    const tbody = document.getElementById('detailsTableBody');
    tbody.innerHTML = '';
    if (!c) return;

    const order = [
        'id',
        'register_type',
        'nip',
        'regon',
        'company_name',
        'address',
        'postal_code',
        'city',
        'legal_form',
        'status',
        'pkd_main',
        'pkd_codes',
        'industry_desc',
        'phone',
        'email',
        'foundation_date',
        'last_update_date'
    ];

    const labels = {
        id: 'ID',
        register_type: 'Rejestr',
        nip: 'NIP',
        regon: 'REGON',
        company_name: 'Nazwa',
        address: 'Adres',
        postal_code: 'Kod pocztowy',
        city: 'Miasto',
        legal_form: 'Forma prawna',
        status: 'Status',
        pkd_main: 'PKD',
        pkd_codes: 'Kody PKD',
        industry_desc: 'Branża',
        phone: 'Telefon',
        email: 'Email',
        foundation_date: 'Data utworzenia',
        last_update_date: 'Ostatnia aktualizacja'
    };
    const omit = ['company_id', 'full_data', 'created_at', 'updated_at', 'created_by'];

    order.forEach(key => {
        if (omit.includes(key)) return;
        let value = c[key];
        if (key === 'pkd_codes' && Array.isArray(value)) {
            value = value.join(', ');
        }
        if (key === 'phone' && value) {
            value = `<a href="tel:${value}">${value}</a>`;
        }
        if (key === 'email' && value) {
            value = `<a href="mailto:${value}">${value}</a>`;
        }
        if (value === undefined || value === null) value = '';
        const tr = document.createElement('tr');
        tr.innerHTML = `<th>${labels[key] || key}</th><td>${value}</td>`;
        tbody.appendChild(tr);
    });

    document.getElementById('detailsModal').style.display = 'flex';
}

function closeDetails() {
    document.getElementById('detailsModal').style.display = 'none';
}