document.addEventListener('DOMContentLoaded', function () {
    const tabs = document.querySelectorAll('.tab[data-tab]');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', function () {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            this.classList.add('active');
            const tabId = this.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });
});

document.addEventListener('DOMContentLoaded', function () {
    // Znajdź przyciski "Edytuj"
    const editButtons = document.querySelectorAll('.open-edit-modal');
    const modalOverlay = document.getElementById('modal-overlay');
    const editModal = document.getElementById('editModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');

    // Pola formularza w modalu
    const editUserId = document.getElementById('editUserId');
    const editFirstName = document.getElementById('editFirstName');
    const editLastName = document.getElementById('editLastName');
    const editRole = document.getElementById('editRole');
    const editEmail = document.getElementById('editEmail');

    editButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            // Pobierz dane z data-*
            const userId = this.dataset.userId;
            const firstName = this.dataset.firstName || '';
            const lastName = this.dataset.lastName || '';
            const role = this.dataset.role || 'user';
            const email = this.dataset.email || '';

            // Ustaw w formularzu
            editUserId.value = userId;
            editFirstName.value = firstName;
            editLastName.value = lastName;
            editRole.value = role;
            editEmail.value = email;

            // Pokaż modal
            modalOverlay.style.display = 'block';
            editModal.style.display = 'block';
        });
    });

    // Zamknięcie modala (X lub Anuluj)
    function closeModal() {
        modalOverlay.style.display = 'none';
        editModal.style.display = 'none';
    }
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeModal);
});

document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.querySelector('.upload-avatar');
    const ownPreview = document.querySelector('.own-preview');
    const ownPreviewImg = document.getElementById('ownPreviewImg');
    const defaultAvatars = document.querySelectorAll('.avatar-default');
    const defaultAvatarField = document.getElementById('defaultAvatarField');

    if (fileInput && ownPreview && ownPreviewImg) {
        fileInput.addEventListener('change', function() {
            if (fileInput.files && fileInput.files[0]) {
                // Usuń zaznaczenie domyślnych avatarów
                defaultAvatars.forEach(avatar => avatar.classList.remove('selected'));
                if (defaultAvatarField) {
                    defaultAvatarField.value = "";
                }
                const reader = new FileReader();
                reader.onload = function(e) {
                    ownPreviewImg.src = e.target.result;
                    ownPreview.style.display = 'block';
                };
                reader.readAsDataURL(fileInput.files[0]);
            } else {
                ownPreview.style.display = 'none';
            }
        });
    }

    // Obsługa kliknięcia w domyślne avatary
    if (defaultAvatars && defaultAvatarField) {
        defaultAvatars.forEach(avatar => {
            avatar.addEventListener('click', function() {
                // Wyczyść input pliku
                if (fileInput) {
                    fileInput.value = "";
                }
                // Odznacz wszystkie, a zaznacz kliknięty
                defaultAvatars.forEach(a => a.classList.remove('selected'));
                this.classList.add('selected');
                // Ustaw wartość w ukrytym polu
                defaultAvatarField.value = this.dataset.avatarValue;
                // Ukryj podgląd własnego avatara
                if (ownPreview) {
                    ownPreview.style.display = 'none';
                }
            });
        });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Znajdź pola dla nowych haseł w formularzu zmiany hasła
    const newPasswordInput = document.getElementById('new_password');
    const confirmPasswordInput = document.getElementById('confirm_password');

    // Zakładamy, że w HTML obok pola potwierdzenia hasła mamy element,
    // w którym będzie komunikat błędu – nadajmy mu np. id "confirmPasswordError"
    const confirmPasswordErrorMsg = document.getElementById('confirmPasswordError');

    // Funkcja walidująca, czy nowe hasła są identyczne
    function validateNewPasswords() {
        const newPass = newPasswordInput.value.trim();
        const confirmPass = confirmPasswordInput.value.trim();

        // Jeśli oba pola nie są puste, sprawdzamy równość
        if (newPass !== '' && confirmPass !== '') {
            if (newPass !== confirmPass) {
                // Wyświetlamy komunikat błędu
                if (confirmPasswordErrorMsg) {
                    confirmPasswordErrorMsg.textContent = 'Hasła muszą być identyczne.';
                    confirmPasswordErrorMsg.style.display = 'block';
                }
                // Możemy dodać klasę błędu do kontenera, jeśli potrzebujemy
                confirmPasswordInput.classList.add('error');
            } else {
                // Usuwamy komunikat błędu, jeśli hasła się zgadzają
                if (confirmPasswordErrorMsg) {
                    confirmPasswordErrorMsg.style.display = 'none';
                }
                confirmPasswordInput.classList.remove('error');
            }
        } else {
            // Gdy jedno z pól jest puste, ukrywamy komunikat błędu
            if (confirmPasswordErrorMsg) {
                confirmPasswordErrorMsg.style.display = 'none';
            }
            confirmPasswordInput.classList.remove('error');
        }
    }

    // Podpinamy walidację na zdarzenia "input"
    if (newPasswordInput && confirmPasswordInput) {
        newPasswordInput.addEventListener('input', validateNewPasswords);
        confirmPasswordInput.addEventListener('input', validateNewPasswords);
    }
});

window.addEventListener('load', function () {
    const apiKey = 'b51440a74a7cc3b6e342b57a9f9ff22e';
    const weatherWidget = document.getElementById('weather-widget');
    if (!weatherWidget) return;

    const iconElement = weatherWidget.querySelector('.weather-icon');
    const tempElement = weatherWidget.querySelector('.temp');
    const locationElement = weatherWidget.querySelector('.location');
    const descElement = weatherWidget.querySelector('.desc');
    const feelsElement = weatherWidget.querySelector('.feels');
    const windElement = weatherWidget.querySelector('.wind');
    const humidityElement = weatherWidget.querySelector('.humidity');
    const pressureElement = weatherWidget.querySelector('.pressure');
    const sunriseElement = weatherWidget.querySelector('.sunrise');
    const sunsetElement = weatherWidget.querySelector('.sunset');

    const rzeszowCoords = { lat: 50.0413, lon: 21.9990 };
    const bachorzCoords = { lat: 49.8427, lon: 22.3636 };

    detectUserLocation();

    function detectUserLocation() {
        if (!navigator.geolocation) {
            console.warn("[Pogoda] Geolokalizacja niedostępna – fallback: Rzeszów");
            fetchWeather('Rzeszów');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude, longitude } = position.coords;
                console.log("[Pogoda] Współrzędne:", latitude, longitude);

                const distanceToRzeszow = getDistance(latitude, longitude, rzeszowCoords.lat, rzeszowCoords.lon);
                const distanceToBachorz = getDistance(latitude, longitude, bachorzCoords.lat, bachorzCoords.lon);

                const selectedCity = distanceToRzeszow < distanceToBachorz ? 'Rzeszów' : 'Bachórz';
                console.log(`[Pogoda] Wybrano: ${selectedCity}`);
                fetchWeather(selectedCity);
            },
            error => {
                console.warn("[Pogoda] Geolokalizacja odrzucona. Kod:", error.code);
                if (error.code === 1) console.log("Użytkownik zablokował dostęp");
                if (error.code === 2) console.log("Pozycja niedostępna");
                if (error.code === 3) console.log("Timeout");
                fetchWeather('Rzeszów');
            }
        );
    }

    function getDistance(lat1, lon1, lat2, lon2) {
        const toRad = x => (x * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function formatTime(unixTimestamp) {
        const date = new Date(unixTimestamp * 1000);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    function fetchWeather(city) {
        console.log("[Pogoda] Fetch dla:", city);
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&lang=pl&appid=${apiKey}`;
        console.log("[Pogoda] URL:", url);

        fetch(url)
            .then(response => response.json())
            .then(data => {
                if (data.cod === 200) {
                    tempElement.textContent = `${Math.round(data.main.temp)}°C`;
                    locationElement.textContent = data.name;
                    descElement.textContent = data.weather[0].description;

                    feelsElement.textContent = `${Math.round(data.main.feels_like)}°C`;
                    windElement.textContent = `${data.wind.speed} m/s`;
                    humidityElement.textContent = `${data.main.humidity}%`;
                    pressureElement.textContent = `${data.main.pressure} hPa`;

                    const iconCode = data.weather[0].icon;
                    iconElement.src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
                    iconElement.alt = data.weather[0].description;

                    sunriseElement.textContent = formatTime(data.sys.sunrise);
                    sunsetElement.textContent = formatTime(data.sys.sunset);
                } else {
                    console.warn("[Pogoda] Odpowiedź API:", data);
                    showWeatherError('Błąd API');
                }
            })
            .catch(err => {
                console.error("[Pogoda] Fetch error:", err);
                showWeatherError('Brak połączenia');
            });
    }

    function showWeatherError(msg) {
        tempElement.textContent = '--°C';
        locationElement.textContent = msg || 'Błąd';
        descElement.textContent = 'Nie udało się pobrać danych';
        feelsElement.textContent = '--°C';
        windElement.textContent = '-- m/s';
        humidityElement.textContent = '--%';
        pressureElement.textContent = '-- hPa';
        iconElement.src = '';
        iconElement.alt = '';
        sunriseElement.textContent = '--:--';
        sunsetElement.textContent = '--:--';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.toggle-entry').forEach(entry => {
        entry.addEventListener('click', () => {
            const parent = entry.closest('.changelog-entry');
            const content = parent.querySelector('.animated-toggle');
            const allEntries = document.querySelectorAll('.changelog-entry');

            allEntries.forEach(other => {
                if (other !== parent && other.classList.contains('open')) {
                    const otherContent = other.querySelector('.animated-toggle');
                    otherContent.style.maxHeight = otherContent.scrollHeight + 'px';
                    requestAnimationFrame(() => {
                        otherContent.style.maxHeight = '0';
                    });
                    other.classList.remove('open');
                }
            });

            if (parent.classList.contains('open')) {
                // Zamykanie klikniętego
                content.style.maxHeight = content.scrollHeight + 'px';
                requestAnimationFrame(() => {
                    content.style.maxHeight = '0';
                });
                parent.classList.remove('open');
            } else {
                // Otwieranie nowego
                content.style.maxHeight = content.scrollHeight + 'px';
                parent.classList.add('open');
            }
        });
    });
});


document.addEventListener('DOMContentLoaded', function () {
    const inviteRole = document.getElementById('invite_role');
    const inviteMultiplierRow = document.getElementById('inviteMultiplierRow');
    const editRole = document.getElementById('editRole');
    const editMultiplierRow = document.getElementById('partnerMultiplierRow');

    if (inviteRole) {
        inviteRole.addEventListener('change', function () {
            inviteMultiplierRow.style.display = this.value === 'partner' ? 'block' : 'none';
        });

        // Pokaż od razu, jeśli "partner" jest domyślnie wybrane (np. po błędzie formularza)
        if (inviteRole.value === 'partner') {
            inviteMultiplierRow.style.display = 'block';
        }
    }

    if (editRole) {
        editRole.addEventListener('change', function () {
            editMultiplierRow.style.display = this.value === 'partner' ? 'block' : 'none';
        });

        // Pokaż od razu, jeśli "partner" jest ustawione
        if (editRole.value === 'partner') {
            editMultiplierRow.style.display = 'block';
        }
    }
});