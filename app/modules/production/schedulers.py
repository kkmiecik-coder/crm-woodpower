import logging
import json
import smtplib
from datetime import datetime, date, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Dict, Optional

from extensions import db, mail
from flask_mail import Message
from flask import current_app

from .models import (
    ProductionTask, ProductionProgress, ProductionBatch, ProductionBatchTask,
    ProductionAlert, ProductionWorkflow, Workstation
)
from .services import ProductionService
from .analyzers import ProductAnalyzer

logger = logging.getLogger(__name__)

class ProductionScheduler:
    """Klasa zarządzająca zadaniami cyklicznymi modułu production"""
    
    ALERT_EMAIL = "biuro@woodpower.pl"
    
    @staticmethod
    def sync_paid_orders_from_baselinker():
        """
        Zadanie cykliczne (co 6h): Pobiera nowe opłacone zamówienia z Baselinker
        Wywoływane przez cron job lub scheduler aplikacji
        """
        try:
            logger.info("Rozpoczęcie synchronizacji opłaconych zamówień z Baselinker")
            
            # Pobierz konfigurację Baselinker
            with open('config/config.json', 'r', encoding='utf-8') as f:
                config = json.load(f)
            
            baselinker_config = config.get('baselinker', {})
            api_token = baselinker_config.get('api_token')
            
            if not api_token:
                logger.error("Brak tokenu API Baselinker w konfiguracji")
                return {'success': False, 'error': 'Brak konfiguracji Baselinker'}
            
            # Pobierz zamówienia ze statusem "opłacone" z ostatnich 24h
            date_from = datetime.now() - timedelta(hours=24)
            
            orders_data = ProductionScheduler._fetch_paid_orders_from_baselinker(
                api_token, date_from
            )
            
            if not orders_data:
                logger.info("Brak nowych opłaconych zamówień")
                return {'success': True, 'orders_processed': 0}
            
            # Przetwórz każde zamówienie
            total_tasks_created = 0
            orders_processed = 0
            
            for order in orders_data:
                order_id = order.get('order_id')
                
                # Sprawdź czy zamówienie już nie zostało przetworzone
                existing_tasks = ProductionTask.query.filter_by(
                    baselinker_order_id=order_id
                ).first()
                
                if existing_tasks:
                    logger.info(f"Zamówienie {order_id} już przetworzone, pomijam")
                    continue
                
                # Utwórz zadania produkcyjne
                tasks_created = ProductionService.create_production_tasks_from_order(order)
                total_tasks_created += len(tasks_created)
                orders_processed += 1
                
                logger.info(f"Przetworzono zamówienie {order_id}: {len(tasks_created)} zadań")
            
            # Jeśli utworzono nowe zadania, zreorganizuj kolejność
            if total_tasks_created > 0:
                ProductionService.reorganize_production_queue()
                
                # Wyślij powiadomienie o nowych zamówieniach
                ProductionScheduler._send_new_orders_notification(
                    orders_processed, total_tasks_created
                )
            
            logger.info(f"Synchronizacja zakończona: {orders_processed} zamówień, {total_tasks_created} zadań")
            
            return {
                'success': True,
                'orders_processed': orders_processed,
                'tasks_created': total_tasks_created
            }
            
        except Exception as e:
            logger.error(f"Błąd synchronizacji z Baselinker: {str(e)}")
            ProductionScheduler._create_system_alert(
                'error',
                'Błąd synchronizacji z Baselinker',
                f'Wystąpił błąd podczas synchronizacji: {str(e)}'
            )
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    def reorganize_production_priorities():
        """
        Zadanie cykliczne (co 6h): Reorganizuje priorytety produkcji
        """
        try:
            logger.info("Rozpoczęcie reorganizacji priorytetów produkcji")
            
            result = ProductionService.reorganize_production_queue()
            tasks_updated = result.get('tasks_updated', 0)
            
            if tasks_updated > 0:
                logger.info(f"Zreorganizowano priorytety {tasks_updated} zadań")
                
                # Sprawdź czy reorganizacja spowodowała zmiany w kolejności
                ProductionScheduler._check_for_priority_conflicts()
            else:
                logger.info("Brak zadań do reorganizacji")
            
            return {
                'success': True,
                'tasks_updated': tasks_updated
            }
            
        except Exception as e:
            logger.error(f"Błąd reorganizacji priorytetów: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    def check_delays_and_send_alerts():
        """
        Zadanie cykliczne (codziennie): Sprawdza opóźnienia i wysyła alerty
        """
        try:
            logger.info("Rozpoczęcie sprawdzania opóźnień")
            
            today = date.today()
            alerts_sent = 0
            
            # Sprawdź zadania z różnymi terminami
            delay_checks = [
                (today + timedelta(days=2), 'warning', '2 dni przed terminem'),
                (today, 'urgent', 'w dniu terminu'),
                (today - timedelta(days=1), 'critical', '1 dzień po terminie'),
                (today - timedelta(days=2), 'critical', '2 dni po terminie')
            ]
            
            for check_date, alert_level, description in delay_checks:
                tasks_at_risk = ProductionTask.query.filter(
                    ProductionTask.estimated_completion_date == check_date,
                    ProductionTask.status.in_(['pending', 'in_progress'])
                ).all()
                
                for task in tasks_at_risk:
                    # Sprawdź czy alert już nie został wysłany
                    existing_alert = ProductionAlert.query.filter(
                        ProductionAlert.related_task_id == task.id,
                        ProductionAlert.alert_type == 'delay',
                        ProductionAlert.created_at >= datetime.combine(check_date, datetime.min.time())
                    ).first()
                    
                    if not existing_alert:
                        ProductionScheduler._create_delay_alert(task, alert_level, description)
                        alerts_sent += 1
            
            # Sprawdź wąskie gardła w produkcji
            bottlenecks = ProductionScheduler._detect_production_bottlenecks()
            for bottleneck in bottlenecks:
                ProductionScheduler._create_bottleneck_alert(bottleneck)
                alerts_sent += 1
            
            logger.info(f"Sprawdzanie opóźnień zakończone: {alerts_sent} alertów")
            
            return {
                'success': True,
                'alerts_created': alerts_sent
            }
            
        except Exception as e:
            logger.error(f"Błąd sprawdzania opóźnień: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    def cleanup_old_completed_tasks():
        """
        Zadanie cykliczne (co tydzień): Czyści stare ukończone zadania
        """
        try:
            logger.info("Rozpoczęcie czyszczenia starych zadań")
            
            # Usuń zadania ukończone ponad 90 dni temu
            cutoff_date = datetime.now() - timedelta(days=90)
            
            old_tasks = ProductionTask.query.filter(
                ProductionTask.status == 'completed',
                ProductionTask.actual_completion_date < cutoff_date
            ).all()
            
            # Przed usunięciem zadań, usuń powiązane rekordy
            for task in old_tasks:
                # Usuń rekordy postępu
                ProductionProgress.query.filter_by(production_task_id=task.id).delete()
                
                # Usuń powiązania z partiami
                ProductionBatchTask.query.filter_by(production_task_id=task.id).delete()
                
                # Usuń alerty
                ProductionAlert.query.filter_by(related_task_id=task.id).delete()
                
                # Usuń zadanie
                db.session.delete(task)
            
            # Usuń stare alerty (ponad 30 dni)
            alert_cutoff = datetime.now() - timedelta(days=30)
            old_alerts = ProductionAlert.query.filter(
                ProductionAlert.created_at < alert_cutoff,
                ProductionAlert.is_read == True
            ).delete()
            
            # Usuń puste partie
            empty_batches = ProductionBatch.query.filter_by(task_count=0).all()
            for batch in empty_batches:
                db.session.delete(batch)
            
            db.session.commit()
            
            logger.info(f"Czyszczenie zakończone: {len(old_tasks)} zadań, {old_alerts} alertów, {len(empty_batches)} partii")
            
            return {
                'success': True,
                'tasks_cleaned': len(old_tasks),
                'alerts_cleaned': old_alerts,
                'batches_cleaned': len(empty_batches)
            }
            
        except Exception as e:
            logger.error(f"Błąd czyszczenia danych: {str(e)}")
            db.session.rollback()
            return {'success': False, 'error': str(e)}
    
    @staticmethod
    def _fetch_paid_orders_from_baselinker(api_token: str, date_from: datetime) -> List[Dict]:
        """Pobiera opłacone zamówienia z Baselinker API"""
        try:
            import requests
            
            url = "https://api.baselinker.com/connector.php"
            headers = {
                'X-BLToken': api_token,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
            
            # Status 155824 = "Nowe - opłacone" w Baselinker
            data = {
                'method': 'getOrders',
                'parameters': json.dumps({
                    'date_confirmed_from': int(date_from.timestamp()),
                    'status_id': 155824,  # Status "opłacone"
                    'get_unconfirmed_orders': False
                })
            }
            
            response = requests.post(url, headers=headers, data=data, timeout=60)
            response.raise_for_status()
            
            result = response.json()
            
            if result.get('status') == 'SUCCESS':
                return result.get('orders', [])
            else:
                logger.error(f"Błąd API Baselinker: {result}")
                return []
                
        except Exception as e:
            logger.error(f"Błąd pobierania zamówień z Baselinker: {str(e)}")
            return []
    
    @staticmethod
    def _create_delay_alert(task: ProductionTask, alert_level: str, description: str):
        """Tworzy alert o opóźnieniu zadania"""
        try:
            # Określ tytuł i treść alertu
            if alert_level == 'warning':
                title = f"⚠️ OSTRZEŻENIE: Zadanie #{task.id} - {description}"
                alert_type = 'delay'
            elif alert_level == 'urgent':
                title = f"🚨 PILNE: Zadanie #{task.id} - {description}"
                alert_type = 'delay'
            else:  # critical
                title = f"🔴 KRYTYCZNE: Zadanie #{task.id} - {description}"
                alert_type = 'delay'
            
            current_station = task.get_current_workstation()
            station_name = current_station.name if current_station else "UKOŃCZONE"
            
            message = f"""
Zadanie produkcyjne wymaga uwagi:

Produkt: {task.product_name}
Wymiary: {task.dimensions}
Gatunek: {task.wood_species} {task.technology}
Termin: {task.estimated_completion_date}
Aktualny etap: {station_name}
Postęp: {task.get_completion_percentage()}%

Status: {description.upper()}
Wymaga interwencji!
            """.strip()
            
            # Utwórz alert w bazie
            alert = ProductionAlert(
                alert_type=alert_type,
                title=title,
                message=message,
                related_task_id=task.id
            )
            
            db.session.add(alert)
            db.session.commit()
            
            # Wyślij email (tylko dla pilnych i krytycznych)
            if alert_level in ['urgent', 'critical']:
                ProductionScheduler._send_alert_email(title, message)
            
        except Exception as e:
            logger.error(f"Błąd tworzenia alertu opóźnienia: {str(e)}")
    
    @staticmethod
    def _detect_production_bottlenecks() -> List[Dict]:
        """Wykrywa wąskie gardła w produkcji"""
        bottlenecks = []
        
        try:
            # Sprawdź każde stanowisko
            workstations = Workstation.query.filter_by(is_active=True).all()
            
            for workstation in workstations:
                # Policz zadania oczekujące na tym stanowisku
                pending_tasks = db.session.query(ProductionTask).join(
                    ProductionProgress
                ).filter(
                    ProductionProgress.workstation_id == workstation.id,
                    ProductionProgress.status == 'pending',
                    ProductionTask.status.in_(['pending', 'in_progress'])
                ).count()
                
                # Policz zadania w trakcie
                in_progress_tasks = db.session.query(ProductionTask).join(
                    ProductionProgress
                ).filter(
                    ProductionProgress.workstation_id == workstation.id,
                    ProductionProgress.status == 'in_progress'
                ).count()
                
                # Jeśli więcej niż 5 zadań oczekuje, to wąskie gardło
                if pending_tasks > 5:
                    bottlenecks.append({
                        'workstation': workstation,
                        'pending_tasks': pending_tasks,
                        'in_progress_tasks': in_progress_tasks,
                        'type': 'queue_overload'
                    })
                
                # Jeśli zadanie w trakcie trwa ponad 4 godziny, to potencjalny problem
                long_running = db.session.query(ProductionProgress).filter(
                    ProductionProgress.workstation_id == workstation.id,
                    ProductionProgress.status == 'in_progress',
                    ProductionProgress.started_at < datetime.now() - timedelta(hours=4)
                ).first()
                
                if long_running:
                    bottlenecks.append({
                        'workstation': workstation,
                        'long_running_task': long_running,
                        'type': 'stuck_task'
                    })
            
        except Exception as e:
            logger.error(f"Błąd wykrywania wąskich gardeł: {str(e)}")
        
        return bottlenecks
    
    @staticmethod
    def _create_bottleneck_alert(bottleneck: Dict):
        """Tworzy alert o wąskim gardle"""
        try:
            workstation = bottleneck['workstation']
            bottleneck_type = bottleneck['type']
            
            if bottleneck_type == 'queue_overload':
                title = f"🚧 WĄSKIE GARDŁO: {workstation.name}"
                message = f"""
Wykryto wąskie gardło w produkcji:

Stanowisko: {workstation.name}
Zadania oczekujące: {bottleneck['pending_tasks']}
Zadania w trakcie: {bottleneck['in_progress_tasks']}

Rekomendacja: Sprawdź czy stanowisko potrzebuje wsparcia lub dodatkowych zasobów.
                """.strip()
            
            elif bottleneck_type == 'stuck_task':
                title = f"⏰ ZADANIE BLOKUJĄCE: {workstation.name}"
                message = f"""
Zadanie blokuje stanowisko:

Stanowisko: {workstation.name}
Czas trwania: ponad 4 godziny
Zadanie ID: {bottleneck['long_running_task'].production_task_id}

Rekomendacja: Sprawdź status zadania i przyczynę opóźnienia.
                """.strip()
            
            else:
                return
            
            alert = ProductionAlert(
                alert_type='bottleneck',
                title=title,
                message=message
            )
            
            db.session.add(alert)
            db.session.commit()
            
        except Exception as e:
            logger.error(f"Błąd tworzenia alertu wąskiego gardła: {str(e)}")
    
    @staticmethod
    def _create_system_alert(alert_type: str, title: str, message: str):
        """Tworzy alert systemowy"""
        try:
            alert = ProductionAlert(
                alert_type=alert_type,
                title=title,
                message=message
            )
            
            db.session.add(alert)
            db.session.commit()
            
        except Exception as e:
            logger.error(f"Błąd tworzenia alertu systemowego: {str(e)}")
    
    @staticmethod
    def _send_alert_email(title: str, message: str):
        """Wysyła alert emailem"""
        try:
            msg = Message(
                subject=f"[Wood Power Production] {title}",
                recipients=[ProductionScheduler.ALERT_EMAIL],
                body=message
            )
            
            mail.send(msg)
            logger.info(f"Wysłano alert email: {title}")
            
        except Exception as e:
            logger.error(f"Błąd wysyłania alertu email: {str(e)}")
    
    @staticmethod
    def _send_new_orders_notification(orders_count: int, tasks_count: int):
        """Wysyła powiadomienie o nowych zamówieniach"""
        try:
            title = f"✅ Nowe zamówienia w produkcji: {orders_count}"
            message = f"""
Automatycznie dodano nowe zamówienia do produkcji:

Liczba zamówień: {orders_count}
Liczba zadań: {tasks_count}
Data: {datetime.now().strftime('%d.%m.%Y %H:%M')}

Kolejność produkcji została automatycznie zoptymalizowana.
            """.strip()
            
            ProductionScheduler._create_system_alert('completion', title, message)
            
        except Exception as e:
            logger.error(f"Błąd wysyłania powiadomienia o nowych zamówieniach: {str(e)}")
    
    @staticmethod
    def _check_for_priority_conflicts():
        """Sprawdza konflikty priorytetów po reorganizacji"""
        try:
            # Sprawdź czy nie ma zadań z identycznymi priorytetami
            duplicates = db.session.query(
                ProductionTask.priority_order
            ).filter(
                ProductionTask.status.in_(['pending', 'in_progress'])
            ).group_by(
                ProductionTask.priority_order
            ).having(
                db.func.count(ProductionTask.id) > 1
            ).all()
            
            if duplicates:
                logger.warning(f"Znaleziono {len(duplicates)} konfliktów priorytetów")
                
                # Napraw konflikty
                for (priority,) in duplicates:
                    tasks = ProductionTask.query.filter_by(priority_order=priority).all()
                    for i, task in enumerate(tasks[1:], 1):  # Pozostaw pierwszy, zmień resztę
                        task.priority_order = priority + i
                
                db.session.commit()
                logger.info("Naprawiono konflikty priorytetów")
            
        except Exception as e:
            logger.error(f"Błąd sprawdzania konfliktów priorytetów: {str(e)}")

# Funkcje pomocnicze do integracji z systemami cron/scheduler

def run_sync_orders():
    """Funkcja uruchamiana przez cron - synchronizacja zamówień"""
    return ProductionScheduler.sync_paid_orders_from_baselinker()

def run_reorganize_priorities():
    """Funkcja uruchamiana przez cron - reorganizacja priorytetów"""
    return ProductionScheduler.reorganize_production_priorities()

def run_check_delays():
    """Funkcja uruchamiana przez cron - sprawdzanie opóźnień"""
    return ProductionScheduler.check_delays_and_send_alerts()

def run_cleanup():
    """Funkcja uruchamiana przez cron - czyszczenie danych"""
    return ProductionScheduler.cleanup_old_completed_tasks()