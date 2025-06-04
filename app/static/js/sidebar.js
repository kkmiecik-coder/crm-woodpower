document.addEventListener('DOMContentLoaded', function () {
    const sidebarLinks = document.querySelectorAll('.menu-options a');

    sidebarLinks.forEach(link => {
        link.addEventListener('click', function (event) {
            const url = this.getAttribute('href');

            // Aktywacja stylu klikniętego menu
            document.querySelectorAll('.menu-options').forEach(item => item.classList.remove('active'));
            const parentOption = this.closest('.menu-options');
            if (parentOption) parentOption.classList.add('active');

            // Wymuszenie pełnego przeładowania strony
            window.location.href = url;
        });
    });

    const footerOptionsIcon = document.querySelector('.footer-options-icon');
    const footerOptionsPanel = document.querySelector('.footer-options-panel');

    if (footerOptionsIcon && footerOptionsPanel) {
        footerOptionsPanel.classList.remove('open');
        footerOptionsIcon.style.transform = 'rotate(0deg)';

        footerOptionsIcon.addEventListener('click', function () {
            if (footerOptionsPanel.classList.contains('open')) {
                footerOptionsPanel.classList.remove('open');
                footerOptionsIcon.style.transform = 'rotate(0deg)';
            } else {
                footerOptionsPanel.classList.add('open');
                footerOptionsIcon.style.transform = 'rotate(180deg)';
            }
        });
    }
});
