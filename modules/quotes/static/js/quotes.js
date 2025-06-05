// modules/quotes/static/js/quotes.js

console.log("quotes.js załadowany");

let allStatuses = {};
let allQuotes = [];
let activeStatus = null;
let currentPage = 1;
let resultsPerPage = 20;
let allUsers = [];

document.addEventListener("DOMContentLoaded", () => {
    console.log("[DOMContentLoaded] Inicjalizacja komponentów");
    fetchQuotes();
    fetchQuotes().then(() => {
        initDownloadModal();
    });
    initStatusPanel();
    fetchUsers();
    initClearFiltersButton();
    updateClearFiltersButtonState();

    // ⬇️ Dodaj ten kod tu na końcu:
    const closeBtn = document.getElementById("close-details-modal");
    const modal = document.getElementById("quote-details-modal");
    if (closeBtn && modal) {
        closeBtn.addEventListener("click", () => {
            modal.classList.remove("active");
        });
    }

    const toggleFullscreenBtn = document.getElementById("toggle-fullscreen-modal");
    const modalOverlay = document.getElementById("quote-details-modal");
    const downloadBtn = document.getElementById("download-details-btn");

    if (toggleFullscreenBtn && modalOverlay) {
        toggleFullscreenBtn.addEventListener("click", () => {
            modalOverlay.classList.toggle("fullscreen");
        });
    }

    if (downloadBtn) {
        downloadBtn.addEventListener("click", () => {
            const id = downloadBtn.dataset.id;
            if (!id) return;
            const triggerBtn = document.querySelector(`.quotes-btn-download[data-id='${id}']`);
            if (triggerBtn) triggerBtn.click();
        });
    }
});

function initDownloadModal() {
    const modal = document.getElementById("download-modal");
    const closeBtn = document.getElementById("closeDownloadModal");
    const iframe = document.getElementById("quotePreview");
    const downloadPDF = document.getElementById("downloadPDF");
    const downloadPNG = document.getElementById("downloadPNG");

    document.addEventListener("click", (e) => {
        const downloadBtn = e.target.closest(".quotes-btn-download");
        if (downloadBtn) {
            const quoteId = downloadBtn.dataset.id;
            console.log(`[DownloadModal] Klik dla ID: ${quoteId}`);

            if (!quoteId) {
                console.warn("❗️Brak quoteId – dataset.id undefined!");
                return;
            }

            if (!iframe) {
                console.warn("❗️Brak #quotePreview w DOM!");
                return;
            }

            iframe.src = `/quotes/api/quotes/${quoteId}/pdf.pdf`;

            downloadPDF.dataset.id = quoteId;
            downloadPNG.dataset.id = quoteId;

            modal.style.display = "flex";
        }
    });

    closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
        iframe.src = "";
    });

    // Pobieranie PDF
    downloadPDF.addEventListener("click", () => {
        const quoteId = downloadPDF.dataset.id;
        window.open(`/quotes/api/quotes/${quoteId}/pdf.pdf`, "_blank");
    });

    // Pobieranie PNG
    downloadPNG.addEventListener("click", () => {
        const quoteId = downloadPNG.dataset.id;
        window.open(`/quotes/api/quotes/${quoteId}/pdf.png`, "_blank");
    });

    // Zamykanie modal po kliknięciu tła
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.style.display = "none";
            iframe.src = "";
        }
    });
}
function fetchQuotes() {
    console.info("[fetchQuotes] Pobieranie wycen z /quotes/api/quotes");

    return fetch("/quotes/api/quotes")
        .then(res => res.json())
        .then(data => {
            allQuotes = data;
            if (data.length > 0) {
                allStatuses = data[0].all_statuses;
            }
            filterQuotes();
        })
        .catch(err => {
            console.error("[fetchQuotes] Błąd pobierania wycen:", err);
        });
}
function fetchUsers() {
    fetch("/quotes/api/users")
        .then(res => res.json())
        .then(data => {
            allUsers = data;
            const select = document.getElementById("employee-filter");
            if (!select) return;

            // 💥 TO BYŁO BRAK – reset opcji przed dodaniem nowych
            select.innerHTML = '<option value="">Wszyscy</option>';

            data.forEach(user => {
                const opt = document.createElement("option");
                opt.value = user.id;
                opt.textContent = user.name;
                select.appendChild(opt);
            });
        })
        .catch(err => console.error("Błąd pobierania użytkowników:", err));
}
// Zakładamy że quoteData zawiera pełne dane z backendu (łącznie z items[])
function showDetailsModal(quoteData) {
    console.log('[MODAL] Otwieranie szczegółów wyceny:', quoteData);

    const modal = document.getElementById('quote-details-modal');
    const itemsContainer = document.getElementById('quotes-details-modal-items-body');
    const tabsContainer = document.getElementById('quotes-details-tabs');
    const dropdownWrap = document.getElementById('quotes-details-modal-status-dropdown');
    const selectedDiv = document.getElementById('custom-status-selected');
    const optionsContainer = document.getElementById('custom-status-options');

    if (!modal || !itemsContainer || !tabsContainer || !dropdownWrap || !selectedDiv || !optionsContainer) {
        console.warn('[MODAL] Brakuje elementów w DOM!');
        return;
    }

    // Dane klienta
    document.getElementById('quotes-details-modal-client-name').textContent = quoteData.client?.client_name || '-';
    document.getElementById('quotes-details-modal-client-fullname').textContent = `${quoteData.user?.first_name || ''} ${quoteData.user?.last_name || ''}`.trim();
    document.getElementById('quotes-details-modal-client-email').textContent = quoteData.client?.email || '-';
    document.getElementById('quotes-details-modal-client-phone').textContent = quoteData.client?.phone || '-';
    document.getElementById('quotes-details-modal-client-company').textContent = quoteData.client?.company || '-';

    // Dane wyceny
    const parsedDate = quoteData.created_at ? new Date(quoteData.created_at).toLocaleDateString("pl-PL") : '-';
    document.getElementById('quotes-details-modal-quote-number').textContent = quoteData.quote_number || '-';
    document.getElementById('quotes-details-modal-quote-date').textContent = parsedDate;
    document.getElementById('quotes-details-modal-quote-source').textContent = quoteData.source || '-';
    document.getElementById("download-details-btn").dataset.id = quoteData.id;

    const costProducts = parseFloat(quoteData.cost_products || 0);
    const costFinishing = parseFloat(quoteData.cost_finishing || 0);
    const costShipping = parseFloat(quoteData.cost_shipping || 0);
    const total = costProducts + costFinishing + costShipping;

    // Koszty
    document.getElementById('quotes-details-modal-courier-name').textContent = quoteData.courier_name || '-';
    document.getElementById('quotes-details-modal-cost-products').textContent = `${quoteData.cost_products?.toFixed(2) || '0.00'} PLN`;
    document.getElementById('quotes-details-modal-cost-finishing').textContent = `${quoteData.cost_finishing?.toFixed(2) || '0.00'} PLN`;
    document.getElementById('quotes-details-modal-cost-shipping').textContent = `${quoteData.cost_shipping?.toFixed(2) || '0.00'} PLN`;
    document.getElementById('quotes-details-modal-cost-total').textContent = `${total.toFixed(2)} PLN`;

    // STATUS – inicjalizacja dropdowna
    optionsContainer.innerHTML = '';
    Object.values(quoteData.all_statuses).forEach(s => {
        const opt = document.createElement('div');
        opt.className = 'option';
        opt.textContent = s.name;
        opt.style.backgroundColor = s.color || '#999';
        opt.dataset.name = s.name;
        optionsContainer.appendChild(opt);

        if (s.name === quoteData.status_name) {
            selectedDiv.textContent = s.name;
            selectedDiv.style.backgroundColor = s.color || '#999';
        }
    });

    dropdownWrap.classList.remove('open');

    // delegacja kliknięcia na opcje statusów
    optionsContainer.onclick = (e) => {
        const opt = e.target.closest('.option');
        if (!opt) return;
        const newStatus = opt.dataset.name;
        if (!confirm(`Na pewno zmienić status na: ${newStatus}?`)) return;

        fetch(`/quotes/api/quotes/${quoteData.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status_id: getStatusIdByName(newStatus, quoteData.all_statuses) })
        })
            .then(() => fetch(`/quotes/api/quotes/${quoteData.id}`))
            .then(res => res.json())
            .then(fullData => {
                showDetailsModal(fullData);
            })
            .catch(err => console.error('[MODAL] Błąd zmiany statusu:', err));
    };

    selectedDiv.onclick = (e) => {
        e.stopPropagation();
        dropdownWrap.classList.toggle('open');
    };

    document.addEventListener('click', (e) => {
        if (!dropdownWrap.contains(e.target)) {
            dropdownWrap.classList.remove('open');
        }
    });

    function getStatusIdByName(name, statuses) {
        for (const key in statuses) {
            if (statuses[key].name === name) return statuses[key].id;
        }
        return null;
    }

    // Produkty
    const items = quoteData.items || [];
    const grouped = {};
    items.forEach(item => {
        if (!grouped[item.product_index]) grouped[item.product_index] = [];
        grouped[item.product_index].push(item);
    });

    tabsContainer.innerHTML = '';
    itemsContainer.innerHTML = '';

    const indexes = Object.keys(grouped);
    indexes.forEach((index, idx) => {
        const tabBtn = document.createElement('button');
        tabBtn.className = 'tab-button';
        tabBtn.textContent = `Produkt ${idx + 1}`;
        tabBtn.dataset.tabIndex = index;
        if (idx === 0) tabBtn.classList.add('active');
        tabsContainer.appendChild(tabBtn);

        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';
        tabContent.style.display = idx === 0 ? 'block' : 'none';
        tabContent.dataset.tabIndex = index;

        const summaryHeader = renderVariantSummary(grouped[index], quoteData, index);
        if (summaryHeader) {
            tabContent.appendChild(summaryHeader);
        }

        const list = document.createElement('ul');
        list.className = 'variant-list';

        grouped[index].forEach(item => {
            const li = document.createElement('li');
            const variantName = translateVariantCode(item.variant_code);
            const pricePerM3 = item.price_per_m3 ? `${item.price_per_m3.toFixed(2)} PLN` : 'Brak informacji';
            const netto = item.final_price_netto !== null ? `${item.final_price_netto.toFixed(2)} PLN` : 'Brak informacji';
            const brutto = item.final_price_brutto !== null ? `${item.final_price_brutto.toFixed(2)} PLN` : 'Brak informacji';

            li.innerHTML = `
                <p><strong>Wariant:</strong> ${variantName}</p>
                <p><strong>Cena za m³:</strong> ${pricePerM3}</p>
                <p><strong>Cena netto:</strong> ${netto}</p>
                <p><strong>Cena brutto:</strong> ${brutto}</p>
            `;

            if (item.is_selected) {
                li.classList.add("selected");
                li.innerHTML += `<p class="selected-tag">✓ Wybrany wariant</p>`;
            } else {
                const btn = document.createElement('button');
                btn.textContent = 'Ustaw jako wybrany';
                btn.onclick = () => {
                    if (!confirm('Na pewno zmienić wybór wariantu?')) return;
                    fetch(`/quotes/api/quote_items/${item.id}/select`, { method: 'PATCH' })
                        .then(res => res.json())
                        .then(() => fetch(`/quotes/api/quotes/${quoteData.id}`))
                        .then(res => res.json())
                        .then(fullData => showDetailsModal(fullData))
                        .catch(err => console.error('[MODAL] Błąd zmiany wariantu:', err));
                };
                li.appendChild(btn);
            }

            list.appendChild(li);
        });

        tabContent.appendChild(list);
        itemsContainer.appendChild(tabContent);
    });

    tabsContainer.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const activeIdx = btn.dataset.tabIndex;
            tabsContainer.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            itemsContainer.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

            btn.classList.add('active');
            itemsContainer.querySelector(`.tab-content[data-tab-index='${activeIdx}']`).style.display = 'block';
        });
    });

    const summaryContainer = document.getElementById("quotes-details-selected-summary");
    renderSelectedSummary(grouped, summaryContainer);

    modal.classList.add('active');
    console.log('[MODAL] Powinien być teraz widoczny!');

    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.remove("active");
            console.log('[MODAL] Kliknięto tło – zamykam szczegóły wyceny');
        }
    });
}

function filterQuotes() {
    console.log("Filtrujemy wyceny...");

    const quoteNumber = document.getElementById("quote-number-filter")?.value?.toLowerCase() || "";
    const clientNumber = document.getElementById("client-number-filter")?.value?.toLowerCase() || "";
    const clientName = document.getElementById("client-name-filter")?.value?.toLowerCase() || "";
    const source = document.getElementById("source-filter")?.value || "";
    const employee = document.getElementById("employee-filter")?.value || "";
    const dateFrom = document.getElementById("date-from-filter")?.value;
    const dateTo = document.getElementById("date-to-filter")?.value;

    const filtered = allQuotes.filter(q => {
        const createdDate = new Date(q.created_at);
        const matchDateFrom = !dateFrom || createdDate >= new Date(dateFrom);
        const matchDateTo = !dateTo || createdDate <= new Date(dateTo);

        return (!quoteNumber || q.quote_number?.toLowerCase().startsWith(quoteNumber)) &&
            (!clientNumber || (q.client_number || "").toLowerCase().includes(clientNumber)) &&
            (!clientName || (q.client_name || "").toLowerCase().includes(clientName)) &&
            (!source || q.source === source) &&
            (!employee || q.user_id == employee) &&
            matchDateFrom &&
            matchDateTo &&
            (!activeStatus || q.status_name === activeStatus);
    });

    console.log(`[filterQuotes] Wszystkich wyników: ${filtered.length}, currentPage: ${currentPage}, resultsPerPage: ${resultsPerPage}`);
    console.log("Filtrujemy daty od:", dateFrom, "do:", dateTo);
    const paginated = filtered.slice((currentPage - 1) * resultsPerPage, currentPage * resultsPerPage);

    renderQuotesTable(paginated);
    renderPagination(filtered.length);
}
function renderQuotesTable(quotes) {
    const wrapper = document.getElementById("quotes-table-body");
    const noResults = document.getElementById("no-results-message");
    wrapper.innerHTML = "";
    if (noResults) noResults.remove();

    if (quotes.length === 0) {
        const msg = document.createElement("div");
        msg.id = "no-results-message";
        msg.className = "no-results-message";
        msg.innerHTML = `<div style="text-align: center; width: 100%;">Brak pasujących wyników</div>`;
        wrapper.appendChild(msg);
        return;
    }

    quotes.forEach(quote => {
        const card = document.createElement("div");
        card.className = "quote-card";

        const statusPill = `
            <div class="quote-status-pill" style="background-color: ${quote.status_color}">
                ${quote.status_name}
            </div>
        `;

        card.innerHTML = `
            <div class="quote-field">${quote.quote_number}</div>
            <div class="quote-field">${new Date(quote.created_at).toLocaleDateString()}</div>
            <div class="quote-field">${quote.client_number || "-"}</div>
            <div class="quote-field">${quote.client_name || "-"}</div>
            <div class="quote-field">${quote.source || "-"}</div>
            <div class="quote-field">${statusPill}</div>
            <div class="quote-field">
                <button class="quotes-btn quotes-btn-detail" data-id="${quote.id}">
                    <span>Szczegóły</span>
                </button>
                <button class="quotes-btn quotes-btn-download" data-id="${quote.id}">
                    <span>Pobierz</span>
                </button>
            </div>
        `;
        wrapper.appendChild(card);
    });

    document.querySelectorAll(".quotes-btn-detail").forEach(btn => {
        btn.addEventListener("click", async e => {
            const id = e.target.closest("button").dataset.id;

            try {
                const res = await fetch(`/quotes/api/quotes/${id}`);
                if (!res.ok) throw new Error("Błąd pobierania szczegółów wyceny");
                const data = await res.json();
                showDetailsModal(data);
            } catch (err) {
                console.error("[MODAL] Błąd ładowania danych:", err);
                alert("Nie udało się załadować szczegółów wyceny.");
            }
        });
    });

    document.querySelectorAll(".quotes-btn-download").forEach(btn => {
        btn.addEventListener("click", e => {
            const id = e.target.closest("button").dataset.id;
            console.log(`Kliknięto pobierz dla ID ${id}`);
        });
    });

    renderPagination(quotes.length);
}
function renderStatusButton(name, count, color, isActive = false) {
    const btn = document.createElement("div");
    btn.className = "status-button";
    if (isActive) btn.classList.add("active");

    const countSpan = document.createElement("span");
    countSpan.className = "status-count";
    countSpan.textContent = count > 0 ? count : "-";

    // Ustaw kolor tła, nawet jeśli liczba to "-"
    if (color) {
        countSpan.style.backgroundColor = color;
    }

    const labelSpan = document.createElement("span");
    labelSpan.textContent = name;

    btn.appendChild(countSpan);
    btn.appendChild(labelSpan);

    btn.addEventListener("click", () => {
        document.querySelectorAll(".status-button").forEach(b => {
            b.classList.remove("active");
        });
        btn.classList.add("active");

        activeStatus = name === "Wszystkie" ? null : name;
        filterQuotes();
    });

    return btn;
}


async function initStatusPanel() {
    const statusPanel = document.getElementById("status-filters-container");

    // Wyczyszczenie kontenera na statusy
    statusPanel.innerHTML = "";

    // FETCH
    const [counts, statuses] = await Promise.all([
        fetch("/quotes/api/quotes/status-counts").then(res => res.json()),
        fetch("/quotes/api/quotes").then(res => res.json())
    ]);

    const allStatusesList = Object.values(statuses[0].all_statuses);

    // PRZYCISK "WSZYSTKIE"
    const totalCount = counts.reduce((sum, s) => sum + s.count, 0);
    const allBtn = renderStatusButton("Wszystkie", totalCount, "#999", true);
    statusPanel.appendChild(allBtn);

    counts.forEach(status => {
        const btn = renderStatusButton(status.name, status.count, status.color);
        statusPanel.appendChild(btn);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    ["quote-number-filter", "client-number-filter", "client-name-filter", "source-filter"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const evt = el.tagName === "SELECT" ? "change" : "input";
            el.addEventListener(evt, filterQuotes);
        }
    });

    ["date-from-filter", "date-to-filter", "employee-filter"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", filterQuotes);
        }
    });
});

function renderPagination(total) {
    console.log(`[renderPagination] Łącznie wyników: ${total}, resultsPerPage: ${resultsPerPage}`);

    let container = document.getElementById("pagination-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "pagination-container";
        container.className = "quotes-pagination";
        document.querySelector(".quotes-main").appendChild(container);
    }

    container.innerHTML = "";

    const totalPages = Math.ceil(total / resultsPerPage);
    console.log(`[renderPagination] Liczba stron: ${totalPages}, Aktualna strona: ${currentPage}`);

    // Selektor ilości wyników na stronę
    const select = document.createElement("select");
    select.className = "pagination-select";

    [20, 50, 100, 200].forEach(n => {
        const opt = document.createElement("option");
        opt.value = n;
        opt.textContent = `${n}`;
        if (n === resultsPerPage) opt.selected = true;
        select.appendChild(opt);
    });

    select.addEventListener("change", () => {
        resultsPerPage = parseInt(select.value);
        currentPage = 1;
        console.log(`[renderPagination] Zmieniono ilość wyników na stronę: ${resultsPerPage}`);
        filterQuotes();
    });

    // Paginacja
    const pagination = document.createElement("div");
    pagination.className = "quotes-pagination";

    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement("button");
        btn.textContent = i;
        if (i === currentPage) btn.classList.add("active");
        btn.addEventListener("click", () => {
            currentPage = i;
            console.log(`[renderPagination] Przełączono na stronę: ${currentPage}`);
            filterQuotes();
        });
        pagination.appendChild(btn);
    }

    container.appendChild(pagination);
    container.appendChild(select);
}
function initClearFiltersButton() {
    const btn = document.getElementById("clear-filters");
    if (!btn) {
        console.warn("Przycisk #clear-filters nie znaleziony");
        return;
    }

    console.log("[initClearFiltersButton] Przycisk znaleziony");

    btn.addEventListener("click", () => {
        console.log("[clear-filters] Czyszczenie filtrów");

        ["quote-number-filter", "client-number-filter", "client-name-filter", "source-filter", "employee-filter"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

        document.getElementById("date-from-filter").value = "";
        document.getElementById("date-to-filter").value = "";

        document.querySelectorAll(".status-button").forEach(btn => btn.classList.remove("active"));
        activeStatus = null;

        filterQuotes();
        updateClearFiltersButtonState();
    });

    // Triggeruje update na zmianę filtrów
    ["quote-number-filter", "client-number-filter", "client-name-filter", "source-filter", "employee-filter", "date-from-filter", "date-to-filter"]
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener("input", updateClearFiltersButtonState);
                el.addEventListener("change", updateClearFiltersButtonState);
            }
        });
}
function updateClearFiltersButtonState() {
    const filters = [
        "quote-number-filter", "client-number-filter", "client-name-filter",
        "source-filter", "employee-filter", "date-from-filter", "date-to-filter"
    ];

    const anyActive = filters.some(id => {
        const el = document.getElementById(id);
        return el && el.value !== "";
    });

    const btn = document.getElementById("clear-filters");
    if (!btn) return;

    if (anyActive || activeStatus !== null) {
        console.log("[updateClearFiltersButtonState] Filtry aktywne – pokazuję przycisk");
        btn.classList.remove("hidden");
        btn.classList.add("active");
    } else {
        console.log("[updateClearFiltersButtonState] Brak aktywnych filtrów – chowam przycisk");
        btn.classList.remove("active");
        btn.classList.add("hidden");
    }
}
function renderSelectedSummary(groupedItems, container) {
    container.innerHTML = "";
    Object.keys(groupedItems).forEach((index, idx) => {
        const selected = groupedItems[index].find(i => i.is_selected) || groupedItems[index][0];
        if (!selected) return;

        const variant = translateVariantCode(selected.variant_code) || "Nieznany wariant";
        const dims = `${selected.length_cm}×${selected.width_cm}×${selected.thickness_cm} cm`;
        const price = selected.final_price_brutto ? `${selected.final_price_brutto.toFixed(2)} PLN brutto` : '-';
        const net = selected.final_price_netto ? `${selected.final_price_netto.toFixed(2)} PLN netto` : '-';

        const p = document.createElement("p");
        p.className = "selected-summary-item";
        p.innerHTML = `<span class='dot'></span><span style="font-size: 14px; font-weight: 600;">Produkt ${parseInt(index)}:</span><span style="font-size: 12px; font-weight: 400;"> ${variant} ${dims} • ${price} • ${net}</span>`;
        container.appendChild(p);
    });
}

function renderVariantSummary(groupedItemsForIndex, quoteData, productIndex) {
    const item = groupedItemsForIndex.find(i => i.is_selected) || groupedItemsForIndex[0];
    if (!item) return null;

    const wrap = document.createElement('div');
    wrap.className = 'variant-summary-header';

    const dims = `${item.length_cm} × ${item.width_cm} × ${item.thickness_cm} cm`;
    const volume = item.volume_m3 ? `${item.volume_m3.toFixed(3)} m³` : '-';

    const finishing = (quoteData.finishing || []).find(f => f.product_index == productIndex);
    let finish = 'Brak wykończenia';
    let finishingHTML = '';
    if (finishing) {
        const parts = [finishing.type, finishing.gloss, finishing.color, finishing.variant].filter(Boolean);
        finish = parts.length > 0 ? parts.join(' • ') : 'Brak wykończenia';
        const brutto = finishing.brutto?.toFixed(2) || '0.00';
        const netto = finishing.netto?.toFixed(2) || '0.00';

        finishingHTML = `
            <div><strong>Wykończenie:</strong> ${brutto} PLN brutto<br>
            <span style="font-size: 12px; color: #777; padding-left: 105px; display: inline-block">${netto} PLN netto</span></div>
        `;
    } else {
        finishingHTML = `<div><strong>Wykończenie:</strong> Brak wykończenia</div>`;
    }

    wrap.innerHTML = `
        <div><strong>Wymiary:</strong> ${dims}</div>
        ${finishingHTML}
        <div><strong>Objętość:</strong> ${volume}</div>
    `;

    return wrap;
}

function translateVariantCode(code) {
    const dict = {
        'dab-lity-ab': 'Dąb lity A/B',
        'dab-lity-bb': 'Dąb lity B/B',
        'dab-micro-ab': 'Dąb mikrowczep A/B',
        'dab-micro-bb': 'Dąb mikrowczep B/B',
        'jes-lity-ab': 'Jesion lity A/B',
        'jes-micro-ab': 'Jesion mikrowczep A/B',
        'buk-lity-ab': 'Buk lity A/B',
        'buk-micro-ab': 'Buk mikrowczep A/B'
    };
    return dict[code] || code || 'Nieznany wariant';
}
