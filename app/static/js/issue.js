function initIssueJS() {
    console.log("[issue.js] initIssueJS() – startuje");

    const form = document.querySelector('.issue-form');
    const overlay = document.getElementById('loadingOverlay');
    const overlayMsg = document.getElementById('overlayMessage');
    const fileInput = document.getElementById('attachment');
    const fileList = document.getElementById('file-list');
    const maxFileSizeMB = 2;

    if (!form) console.warn("[issue.js] Brak .issue-form");
    if (!overlay) console.warn("[issue.js] Brak #loadingOverlay");
    if (!overlayMsg) console.warn("[issue.js] Brak #overlayMessage");
    if (!fileInput) console.warn("[issue.js] Brak #attachment");
    if (!fileList) console.warn("[issue.js] Brak #file-list");

    if (!form || !overlay || !fileInput || !fileList || !overlayMsg) {
        console.warn("[issue.js] Nie wszystkie wymagane elementy są dostępne – initIssueJS przerwane");
        return;
    }

    console.log("[issue.js] Wszystkie elementy znalezione – przypinam eventy");

    fileInput.addEventListener('change', function () {
        console.log("[issue.js] Zmiana plików");

        const files = Array.from(this.files).slice(0, 3);
        const validFiles = files.filter(file => file.size <= maxFileSizeMB * 1024 * 1024);

        fileList.innerHTML = '';

        if (validFiles.length === 0) {
            fileList.innerHTML = '<li class="file-name">Pliki są zbyt duże (max 2 MB).</li>';
            this.value = "";
            return;
        }

        validFiles.forEach(file => {
            const li = document.createElement('li');
            li.className = 'file-name';
            li.textContent = file.name;
            fileList.appendChild(li);
        });

        if (validFiles.length < files.length) {
            const warning = document.createElement('li');
            warning.className = 'file-name';
            warning.style.color = '#E00000';
            warning.textContent = 'Pominięto pliki większe niż 2 MB.';
            fileList.appendChild(warning);
        }
    });

    form.addEventListener('submit', function () {
        console.log("[issue.js] Form submit – pokazuję overlay");
        overlay.style.display = 'flex';
        overlayMsg.textContent = 'Wysyłanie zgłoszenia...';
        setTimeout(() => {
            overlayMsg.textContent = 'Zgłoszenie zostało wysłane ✉️';
        }, 1000);
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 3000);
    });
}
