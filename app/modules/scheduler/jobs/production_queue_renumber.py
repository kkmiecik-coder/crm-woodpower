# modules/scheduler/jobs/production_queue_renumber.py
"""
Zadanie schedulera do codziennego przenumerowywania kolejki produkcyjnej
"""

from datetime import datetime, timedelta
from modules.logging import get_structured_logger
from modules.scheduler.models import EmailLog

# Inicjalizacja loggera
scheduler_logger = get_structured_logger('scheduler.production_queue')


def renumber_production_queue_job():
    """
    Zadanie schedulera: Przenumerowanie kolejki produkcyjnej
    Uruchamiane codziennie o 00:01
    """
    job_start_time = datetime.utcnow()
    scheduler_logger.info("Rozpoczęcie zadania przenumerowania kolejki produkcyjnej")
    
    try:
        # Import tutaj żeby uniknąć circular imports
        from modules.production.utils import ProductionPriorityCalculator
        
        # Utwórz kalkulator i przenumeruj kolejkę
        calculator = ProductionPriorityCalculator()
        result = calculator.renumber_production_queue()
        
        # Oblicz czas wykonania
        job_duration = (datetime.utcnow() - job_start_time).total_seconds()
        
        # Zaloguj wynik
        scheduler_logger.info("Zadanie przenumerowania kolejki zakończone pomyślnie",
                            duration_seconds=job_duration,
                            total_items=result.get('total_items', 0),
                            renumbered_items=result.get('renumbered', 0),
                            queue_structure=result.get('queue_structure', {}))
        
        # Opcjonalnie: zapisz log do bazy danych (dla kompatybilności z systemem email logów)
        try:
            email_log = EmailLog(
                quote_id=None,  # Brak quote_id dla zadań systemowych
                email_type='system_job',
                job_type='production_queue_renumber',  # NOWE: typ zadania
                recipient_email='admin@woodpower.pl',
                subject='Przenumerowanie kolejki produkcyjnej',  # NOWE: temat
                content=f"Kolejka przenumerowana pomyślnie. Zaktualizowano {result.get('renumbered', 0)} produktów z {result.get('total_items', 0)} w kolejce.",
                status='sent',
                sent_at=datetime.utcnow()
            )
            
            from extensions import db
            db.session.add(email_log)
            db.session.commit()
            
        except Exception as log_error:
            scheduler_logger.warning("Nie można zapisać loga zadania do bazy",
                                   error=str(log_error))
        
        return {
            'success': True,
            'message': f'Kolejka przenumerowana pomyślnie. Zaktualizowano {result.get("renumbered", 0)} produktów.',
            'duration_seconds': job_duration,
            'result': result
        }
        
    except Exception as e:
        job_duration = (datetime.utcnow() - job_start_time).total_seconds()
        
        scheduler_logger.error("Błąd podczas przenumerowania kolejki produkcyjnej",
                             error=str(e),
                             error_type=type(e).__name__,
                             duration_seconds=job_duration)
        
        # Zapisz błąd do logów
        try:
            error_log = EmailLog(
                recipient_email='admin@woodpower.pl',
                subject='BŁĄD: Przenumerowanie kolejki produkcyjnej',
                content=f"Błąd podczas przenumerowania kolejki: {str(e)}",
                status='failed',
                sent_at=datetime.utcnow(),
                job_type='production_queue_renumber',
                error_message=str(e)
            )
            
            from extensions import db
            db.session.add(error_log)
            db.session.commit()
            
        except Exception as log_error:
            scheduler_logger.error("Nie można zapisać loga błędu do bazy",
                                 error=str(log_error))
        
        return {
            'success': False,
            'error': str(e),
            'duration_seconds': job_duration
        }


def get_production_queue_stats():
    """
    Pobiera statystyki kolejki produkcyjnej dla panelu administratora
    
    Returns:
        dict: Statystyki kolejki
    """
    try:
        from modules.production.models import ProductionItem, ProductionStatus
        from modules.production.utils import ProductionPriorityCalculator
        
        # Pobierz produkty oczekujące
        pending_items = ProductionItem.query.join(ProductionStatus).filter(
            ProductionStatus.name == 'pending'
        ).order_by(ProductionItem.priority_score.asc()).all()
        
        if not pending_items:
            return {
                'queue_length': 0,
                'last_renumber': None,
                'batch_groups': {},
                'priority_range': None
            }
        
        # Grupuj według priority_group
        batch_groups = {}
        for item in pending_items:
            group = item.priority_group
            if group not in batch_groups:
                batch_groups[group] = 0
            batch_groups[group] += 1
        
        # Znajdź ostatnie przenumerowanie (z logów)
        last_renumber_log = EmailLog.query.filter(
            EmailLog.job_type == 'production_queue_renumber',
            EmailLog.status == 'sent'
        ).order_by(EmailLog.sent_at.desc()).first()
        
        stats = {
            'queue_length': len(pending_items),
            'last_renumber': last_renumber_log.sent_at.isoformat() if last_renumber_log else None,
            'batch_groups': batch_groups,
            'priority_range': {
                'min': pending_items[0].priority_score if pending_items else None,
                'max': pending_items[-1].priority_score if pending_items else None
            },
            'top_3_items': [
                {
                    'position': item.priority_score,
                    'product_name': item.product_name[:50] + '...' if len(item.product_name) > 50 else item.product_name,
                    'priority_group': item.priority_group
                } for item in pending_items[:3]
            ]
        }
        
        return stats
        
    except Exception as e:
        scheduler_logger.error("Błąd podczas pobierania statystyk kolejki", error=str(e))
        return {
            'queue_length': 0,
            'error': str(e),
            'last_renumber': None,
            'batch_groups': {},
            'priority_range': None
        }


def manual_renumber_production_queue():
    """
    Ręczne uruchomienie przenumerowania kolejki (dla panelu admin)
    
    Returns:
        dict: Rezultat operacji
    """
    scheduler_logger.info("Ręczne uruchomienie przenumerowania kolejki")
    return renumber_production_queue_job()