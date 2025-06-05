// static/js/clients.js

let clients = [];
let currentPage = 1;
let rowsPerPage = 20;
let currentSortKey = 'client_name';
let currentSortAsc = true;
let quotesPerPage = 10;
let currentQuotePage = 1;
let allQuotes = [];
let editedClientId = null;

const tableBody = document.getElementById('clients-table-body');
const searchInput = document.getElementById('search-input');
const rowsSelect = document.getElementById('rows-per-page');
const paginationControls = document.getElementById('pagination-controls');

function fetchClients() {
    fetch('/clients/api/clients')
        .then(res => res.json())
        .then(data => {
            clients = data;
            renderTable();
        });
}

function renderTable() {
    const filtered = clients.filter(c => {
        const query = searchInput.value.toLowerCase();
        return (
            (c.client_number || '').toLowerCase().includes(query) ||
            (c.client_name || '').toLowerCase().includes(query) ||
            (c.client_delivery_name || '').toLowerCase().includes(query) ||
            (c.email || '').toLowerCase().includes(query) ||
            (c.phone || '').toLowerCase().includes(query)
        );
    });

    filtered.sort((a, b) => {
        const valA = a[currentSortKey] || '';
        const valB = b[currentSortKey] || '';
        return currentSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const pageItems = filtered.slice(start, end);

    tableBody.innerHTML = '';
    pageItems.forEach(client => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${client.client_number || '-'}</td>
            <td>${client.client_name || '-'}</td>
            <td>${client.email || '-'}</td>
            <td>${client.phone || '-'}</td>
            <td class="clients-actions"></td>
        `;

        const actionsCell = row.querySelector('.clients-actions');

        const detailsBtn = document.createElement("button");
        detailsBtn.textContent = "Szczegóły";
        detailsBtn.className = "clients-btn-detail";
        detailsBtn.addEventListener("click", () => showClientDetails(client.id));

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edytuj";
        editBtn.className = "clients-btn-edit";
        editBtn.addEventListener("click", () => showEditModal(client.id));

        actionsCell.appendChild(detailsBtn);
        actionsCell.appendChild(editBtn);

        tableBody.appendChild(row);
    });

    renderPagination(filtered.length);
}

function renderPagination(total) {
    const pageCount = Math.ceil(total / rowsPerPage);
    paginationControls.innerHTML = '';
    for (let i = 1; i <= pageCount; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        if (i === currentPage) btn.classList.add('active');
        btn.addEventListener('click', () => {
            currentPage = i;
            renderTable();
        });
        paginationControls.appendChild(btn);
    }
}

searchInput.addEventListener('input', renderTable);
rowsSelect.addEventListener('change', () => {
    rowsPerPage = parseInt(rowsSelect.value);
    currentPage = 1;
    renderTable();
});

function showClientDetails(clientId) {
    fetch(`/clients/${clientId}/data`)
        .then(res => res.json())
        .then(client => {
            document.getElementById('detailClientName').textContent = client.client_number || '---';
            document.getElementById('detailClientDeliveryName').textContent = client.client_name || '---';
            document.getElementById('detailClientEmail').textContent = client.email || '---';
            document.getElementById('detailClientPhone').textContent = client.phone || '---';
            loadClientQuotes(clientId);
            document.getElementById('clients-details-modal').style.display = 'flex';
        });
}

document.getElementById('clientsDetailsCloseBtn').addEventListener('click', () => {
    document.getElementById('clients-details-modal').style.display = 'none';
});

function loadClientQuotes(clientId) {
    fetch(`/clients/${clientId}/quotes`)
        .then(res => res.json())
        .then(data => {
            allQuotes = data;
            currentQuotePage = 1;

            const noQuotesMsg = document.getElementById('clients-no-quotes');
            const quotesTable = document.querySelector('.clients-quotes-table');
            const tbody = document.getElementById('clients-quotes-body');

            if (!data.length) {
                noQuotesMsg.style.display = 'block';
                quotesTable.style.display = 'none';
                document.getElementById('quotes-pagination-controls').innerHTML = '';
                return;
            }

            noQuotesMsg.style.display = 'none';
            quotesTable.style.display = 'table';
            tbody.innerHTML = '';

            renderQuotesTable();
        });
}

function renderQuotesTable() {
    const tbody = document.getElementById('clients-quotes-body');
    tbody.innerHTML = '';

    const start = (currentQuotePage - 1) * quotesPerPage;
    const end = start + quotesPerPage;
    const visibleQuotes = allQuotes.slice(start, end);

    visibleQuotes.forEach(quote => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${quote.id}</td>
            <td>${quote.date}</td>
            <td>${quote.status}</td>
            <td>
                <a href="/quote/${quote.id}" class="clients-quote-link">
                    Przejdź <img src="/clients/clients/static/img/arrow.svg" alt="→" class="clients-link-icon">
                </a>
            </td>
        `;
        tbody.appendChild(tr);
    });

    renderQuotesPagination();
}

function renderQuotesPagination() {
    const paginationContainer = document.getElementById('quotes-pagination-controls');
    paginationContainer.innerHTML = '';
    const totalPages = Math.ceil(allQuotes.length / quotesPerPage);

    for (let i = 1; i <= totalPages; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        if (i === currentQuotePage) pageBtn.classList.add('active');
        pageBtn.addEventListener('click', () => {
            currentQuotePage = i;
            renderQuotesTable();
        });
        paginationContainer.appendChild(pageBtn);
    }
}

function showEditModal(clientId) {
    editedClientId = clientId;
    fetch(`/clients/${clientId}/data`)
        .then(res => res.json())
        .then(client => {
            document.getElementById('editClientName').value = client.client_name || '';
            document.getElementById('editClientDeliveryName').value = client.client_delivery_name || '';
            document.getElementById('editClientEmail').value = client.email || '';
            document.getElementById('editClientPhone').value = client.phone || '';

            document.getElementById('editDeliveryName').value = client.delivery.name || '';
            document.getElementById('editDeliveryCompany').value = client.delivery.company || '';
            document.getElementById('editDeliveryAddress').value = client.delivery.address || '';
            document.getElementById('editDeliveryZip').value = client.delivery.zip || '';
            document.getElementById('editDeliveryCity').value = client.delivery.city || '';
            document.getElementById('editDeliveryRegion').value = client.delivery.region || '';
            document.getElementById('editDeliveryCountry').value = client.delivery.country || 'Polska';

            document.getElementById('editInvoiceName').value = client.invoice.name || '';
            document.getElementById('editInvoiceCompany').value = client.invoice.company || '';
            document.getElementById('editInvoiceAddress').value = client.invoice.address || '';
            document.getElementById('editInvoiceZip').value = client.invoice.zip || '';
            document.getElementById('editInvoiceCity').value = client.invoice.city || '';
            document.getElementById('editInvoiceNIP').value = client.invoice.nip || '';

            document.getElementById('clients-edit-modal').style.display = 'flex';
        });
}

document.getElementById('clientsCancelBtn').addEventListener('click', () => {
    document.getElementById('clients-edit-modal').style.display = 'none';
});

document.getElementById('clientsSaveBtn').addEventListener('click', () => {
    if (!editedClientId) return;

    const payload = {
        client_name: document.getElementById('editClientName').value,
        client_delivery_name: document.getElementById('editClientDeliveryName').value,
        email: document.getElementById('editClientEmail').value,
        phone: document.getElementById('editClientPhone').value,
        source: '',
        delivery: {
            name: document.getElementById('editDeliveryName').value,
            company: document.getElementById('editDeliveryCompany').value,
            address: document.getElementById('editDeliveryAddress').value,
            zip: document.getElementById('editDeliveryZip').value,
            city: document.getElementById('editDeliveryCity').value,
            region: document.getElementById('editDeliveryRegion').value,
            country: document.getElementById('editDeliveryCountry').value
        },
        invoice: {
            name: document.getElementById('editInvoiceName').value,
            company: document.getElementById('editInvoiceCompany').value,
            address: document.getElementById('editInvoiceAddress').value,
            zip: document.getElementById('editInvoiceZip').value,
            city: document.getElementById('editInvoiceCity').value,
            nip: document.getElementById('editInvoiceNIP').value
        }
    };

    fetch(`/clients/${editedClientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(res => {
            if (!res.ok) throw new Error('Błąd zapisu klienta');
            return res.json();
        })
        .then(() => {
            showToast('Zapisano dane klienta ✔');
            document.getElementById('clients-edit-modal').style.display = 'none';
            fetchClients();
        })
        .catch(err => {
            console.error('❌ Błąd podczas zapisu:', err);
            showToast('Nie udało się zapisać zmian ❌', false);
        });
});


// ========== DOMContentLoaded ========== //
document.addEventListener('DOMContentLoaded', () => {
    fetchClients();

    const addBtn = document.getElementById('addClientBtn');
    const addModal = document.getElementById('clients-add-modal');

    if (addBtn && addModal) {
        addBtn.addEventListener('click', () => {
            addModal.style.display = 'flex';
        });
    }

    const cancelAddBtn = document.getElementById('clientsAddCancelBtn');
    if (cancelAddBtn && addModal) {
        cancelAddBtn.addEventListener('click', () => {
            addModal.style.display = 'none';
        });
    }

    const saveAddBtn = document.getElementById('clientsAddSaveBtn');
    if (saveAddBtn && addModal) {
        saveAddBtn.addEventListener('click', () => {
            const inputs = document.querySelectorAll('.clients-input');
            inputs.forEach(input => input.classList.remove('input-error-border', 'input-success-border'));

            const name = document.getElementById('addClientName');
            const email = document.getElementById('addClientEmail');
            const phone = document.getElementById('addClientPhone');
            const zip = document.getElementById('addInvoiceZip');
            const nip = document.getElementById('addInvoiceNIP');

            let valid = true;

            if (!name.value.trim()) {
                name.classList.add('input-error-border');
                valid = false;
            }

            if (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
                email.classList.add('input-error-border');
                valid = false;
            }

            if (phone.value.trim() && !/^[0-9+\s]+$/.test(phone.value)) {
                phone.classList.add('input-error-border');
                valid = false;
            }

            if (zip.value.trim() && !/^(\d{2}-\d{3}|\d{5})$/.test(zip.value)) {
                zip.classList.add('input-error-border');
                valid = false;
            }

            if (nip.value.trim() && !/^\d+$/.test(nip.value)) {
                nip.classList.add('input-error-border');
                document.getElementById('error-addInvoiceNIP').textContent = "Nieprawidłowy NIP";
                valid = false;
            } else {
                document.getElementById('error-addInvoiceNIP').textContent = "";
            }

            if (!valid) return;

            const payload = {
                client_name: name.value.trim(),
                client_delivery_name: document.getElementById('addClientDeliveryName').value,
                email: email.value.trim(),
                phone: phone.value.trim(),
                delivery: {
                    name: document.getElementById('addDeliveryName').value,
                    company: document.getElementById('addDeliveryCompany').value,
                    address: document.getElementById('addDeliveryAddress').value,
                    zip: document.getElementById('addDeliveryZip').value,
                    city: document.getElementById('addDeliveryCity').value,
                    region: document.getElementById('addDeliveryRegion').value,
                    country: document.getElementById('addDeliveryCountry').value
                },
                invoice: {
                    name: document.getElementById('addInvoiceName').value,
                    company: document.getElementById('addInvoiceCompany').value,
                    address: document.getElementById('addInvoiceAddress').value,
                    zip: zip.value.trim(),
                    city: document.getElementById('addInvoiceCity').value,
                    nip: nip.value.trim()
                }
            };

            fetch('/clients/api/add_client', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(res => {
                    if (!res.ok) throw new Error('Błąd zapisu klienta');
                    addModal.style.display = 'none';
                    showToast("Dodano nowego klienta", "success");
                    fetchClients();
                })
                .catch(err => {
                    console.error(err);
                    showToast("Wystąpił błąd podczas zapisu klienta", "error");
                });
        });

        document.querySelectorAll('.clients-input').forEach(input => {
            input.addEventListener('blur', () => {
                const value = input.value.trim();
                let isValid = true;

                if (input.type === 'email') {
                    isValid = !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
                } else if (input.id.includes('Phone')) {
                    isValid = !value || /^[0-9+\s]+$/.test(value);
                } else if (input.id.includes('Zip')) {
                    isValid = !value || /^(\d{2}-\d{3}|\d{5})$/.test(value);
                } else if (input.id.includes('NIP')) {
                    isValid = !value || /^\d+$/.test(value);
                } else if (input.required || input.id === 'addClientName') {
                    isValid = !!value;
                }

                input.classList.remove('input-error-border', 'input-success-border');
                if (!isValid) {
                    input.classList.add('input-error-border');
                } else if (value) {
                    input.classList.add('input-success-border');
                }
            });
        });

        const gusBtn = document.getElementById('gusLookupBtn');
        if (gusBtn) {
            gusBtn.addEventListener('click', () => {
                const nipInput = document.getElementById('addInvoiceNIP');
                const nip = nipInput.value.trim();
                const nipError = document.getElementById('error-addInvoiceNIP');

                nipInput.classList.remove('input-error-border');
                nipError.textContent = '';

                if (!/^\d{10}$/.test(nip)) {
                    nipInput.classList.add('input-error-border');
                    nipError.textContent = "Podaj prawidłowy NIP (10 cyfr)";
                    return;
                }

                gusBtn.classList.add('loading');
                gusBtn.innerText = 'Ładowanie...';

                fetch(`/clients/api/gus_lookup?nip=${nip}`)
                    .then(res => res.json())
                    .then(data => {
                        console.log('[GUS API response]', data);
                        gusBtn.classList.remove('loading');
                        gusBtn.innerText = 'Pobrano dane ✅';
                        setTimeout(() => {
                            gusBtn.innerText = 'Pobierz z GUS';
                        }, 3000);

                        if (data && data.name) {
                            const address = data.address || '';
                            const addressParts = address.split(',');
                            const street = addressParts[0] || '';
                            const zipCity = addressParts[1] || '';
                            const zipMatch = zipCity.match(/\d{2}-\d{3}/);
                            const city = zipCity.replace(/\d{2}-\d{3}/, '').trim();

                            document.getElementById('addInvoiceName').value = data.name;
                            document.getElementById('addInvoiceCompany').value = data.company;
                            document.getElementById('addInvoiceAddress').value = street.trim();
                            document.getElementById('addInvoiceZip').value = zipMatch ? zipMatch[0] : '';
                            document.getElementById('addInvoiceCity').value = city;
                        } else {
                            nipError.textContent = "Nie znaleziono danych dla podanego NIP";
                        }
                    })
                    .catch(err => {
                        console.error('[GUS Lookup Error]', err);
                        gusBtn.classList.remove('loading');
                        gusBtn.innerText = 'Pobierz z GUS';
                        nipError.textContent = "Błąd połączenia z API GUS";
                    });
            });
        }
    }

    document.querySelectorAll('.clients-modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
            }
        });
    });
});

function showToast(message, isSuccess = true) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + (isSuccess ? 'toast-success' : 'toast-error');
    toast.style.display = 'block';
    toast.style.opacity = '1';

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.style.display = 'none', 400);
    }, 5000);
}
