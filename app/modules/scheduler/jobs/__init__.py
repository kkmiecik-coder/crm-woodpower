# Plik __init__.py dla jobs - importy dostępnych zadań

from .quote_reminders import check_quote_reminders, send_quote_reminder_email

# Lista wszystkich dostępnych jobów dla łatwego importowania
__all__ = [
    'check_quote_reminders',
    'send_quote_reminder_email'
]