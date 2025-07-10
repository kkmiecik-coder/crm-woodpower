import json
import requests
import logging
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Any
from sqlalchemy import and_, or_, desc, asc
from sqlalchemy.orm import joinedload

from extensions import db, mail
from flask_mail import Message
from flask import current_app

from .models import (
    ProductionTask, ProductionProgress, ProductionBatch, ProductionBatchTask,
    ProductionAlert, ProductionWorkflow, Workstation, User
)
from .analyzers import ProductAnalyzer

logger = logging.getLogger(__name__)

class ProductionService:
    """Główny serwis logiki biznesowej modułu production"""
    
    @staticmethod
    def fetch_order_from_baselinker(order_id: int) -> Optional[Dict]:
        """Pobiera szczegóły zamówienia z Baselinker API"""
        try:
            # Wczytaj konfigurację Baselinker z config.json
            with open('config/core.json', 'r', encoding='utf-8') as f:
                config = json.load(f)
        
            baselinker_config = config.get('API_BASELINKER', {})
            api_token = baselinker_config.get('api_key')
            endpoint = baselinker_config.get('endpoint')
        
            if not api_token or not endpoint:
                logger.error("Brak konfiguracji API Baselinker")
                return None
        
            # Wywołanie API Baselinker
            headers = {
                'X-BLToken': api_token,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        
            data = {
                'method': 'getOrders',
                'parameters': json.dumps({
                    'order_id': order_id
                })
            }
        
            response = requests.post(endpoint, headers=headers, data=data, timeout=30)
            response.raise_for_status()
        
            result = response.json()
        
            if result.get('status') == 'SUCCESS' and result.get('orders'):
                logger.info(f"Pobrano szczegóły zamówienia {order_id} z Baselinker")
                return result['orders'][0]  # Pierwszy (jedyny) zamówienie
            else:
                logger.error(f"Błąd API Baselinker: {result}")
                return None
            
        except Exception as e:
            logger.error(f"Błąd pobierania zamówienia {order_id} z Baselinker: {str(e)}")
            return None
    
    @staticmethod
    def create_production_tasks_from_order(order_data: Dict) -> List[ProductionTask]:
        """Tworzy zadania produkcyjne z rzeczywistych danych zamówienia Baselinker"""
        try:
            tasks = []
            order_id = order_data.get('order_id')
        
            logger.info(f"Tworzenie zadań produkcyjnych dla zamówienia {order_id}")
        
            # Przetwórz produkty w zamówieniu
            products = order_data.get('products', [])
        
            for product in products:
                try:
                    # Wyciągnij podstawowe informacje o produkcie
                    product_name = product.get('name', 'Nieznany produkt')
                    quantity = int(product.get('quantity', 1))
                
                    # Parsuj nazwę produktu żeby wyciągnąć właściwości
                    parsed_product = ProductionService._parse_product_name(product_name)
                
                    # Utwórz zadanie produkcyjne
                    task = ProductionTask(
                        baselinker_order_id=order_id,
                        baselinker_product_id=product.get('product_id', 0),
                        product_name=product_name,
                        dimensions=parsed_product.get('dimensions', ''),
                        quantity=quantity,
                        wood_species=parsed_product.get('wood_species', 'nieznany'),
                        technology=parsed_product.get('technology', 'standard'),
                        needs_coating=parsed_product.get('needs_coating', False),
                        coating_type=parsed_product.get('coating_type'),
                        status='pending',
                        priority_order=999  # Niska wartość dla nowych zadań
                    )
                
                    db.session.add(task)
                    tasks.append(task)
                
                    logger.debug(f"Utworzono zadanie dla produktu: {product_name}")
                
                except Exception as e:
                    logger.error(f"Błąd tworzenia zadania dla produktu {product.get('name')}: {str(e)}")
                    continue
        
            # Zapisz wszystkie zadania
            if tasks:
                db.session.commit()
                logger.info(f"Zapisano {len(tasks)} zadań dla zamówienia {order_id}")
        
            return tasks
        
        except Exception as e:
            logger.error(f"Błąd tworzenia zadań produkcyjnych: {str(e)}")
            db.session.rollback()
            return []

    @staticmethod
    def _parse_product_name(product_name: str) -> Dict:
        """Parsuje nazwę produktu i wyciąga właściwości produkcyjne"""
        try:
            name_lower = product_name.lower()
            result = {
                'dimensions': '',
                'wood_species': 'nieznany',
                'technology': 'standard',
                'needs_coating': False,
                'coating_type': None
            }
        
            # Wyciągnij wymiary (np. "180x70x3", "98.0×40.0×2.0cm")
            import re
            dimension_patterns = [
                r'(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*cm',
                r'(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)'
            ]
        
            for pattern in dimension_patterns:
                match = re.search(pattern, product_name)
                if match:
                    result['dimensions'] = f"{match.group(1)}x{match.group(2)}x{match.group(3)} cm"
                    break
        
            # Rozpoznaj gatunek drewna
            wood_species_map = {
                'dąb': 'dąb', 'dębowy': 'dąb', 'dębowa': 'dąb',
                'buk': 'buk', 'bukowy': 'buk', 'bukowa': 'buk',
                'jesion': 'jesion', 'jesionowy': 'jesion', 'jesionowa': 'jesion'
            }
        
            for key, value in wood_species_map.items():
                if key in name_lower:
                    result['wood_species'] = value
                    break
        
            # Rozpoznaj technologię
            if 'lity' in name_lower or 'lita' in name_lower:
                result['technology'] = 'lity'
            elif 'mikrowczep' in name_lower:
                result['technology'] = 'mikrowczep'
        
            # Rozpoznaj wykończenie
            if any(word in name_lower for word in ['lakier', 'lakierowany', 'lakierowana']):
                result['needs_coating'] = True
                result['coating_type'] = 'lakier'
            elif any(word in name_lower for word in ['olej', 'olejowany', 'olejowana']):
                result['needs_coating'] = True
                result['coating_type'] = 'olej'
            elif 'surowy' not in name_lower and 'surowa' not in name_lower:
                # Jeśli nie ma słowa "surowy", prawdopodobnie wymaga wykończenia
                result['needs_coating'] = True
        
            return result
        
        except Exception as e:
            logger.error(f"Błąd parsowania nazwy produktu '{product_name}': {str(e)}")
            return {
                'dimensions': '',
                'wood_species': 'nieznany',
                'technology': 'standard',
                'needs_coating': False,
                'coating_type': None
            }
    
    @staticmethod
    def _calculate_estimated_completion_date(workflow: Dict) -> date:
        """Oblicza szacowaną datę ukończenia na podstawie workflow"""
        # Pobierz szacowany czas wykonania z workflow
        estimated_minutes = workflow.get('estimated_time_minutes', {})
        total_minutes = sum(estimated_minutes.values()) if estimated_minutes else 480  # 8h domyślnie
        
        # Dodaj czas do aktualnej daty (zakładając 8h pracy dziennie)
        days_needed = max(1, total_minutes // 480)  # 480 min = 8h
        
        return date.today() + timedelta(days=days_needed)
    
    @staticmethod
    def _create_progress_records_for_task(task: ProductionTask, workflow: Dict):
        """Tworzy rekordy postępu dla zadania na podstawie workflow"""
        workstation_sequence = workflow.get('workstation_sequence', [1, 2, 3, 4, 6])  # Domyślny workflow surowy
        
        for workstation_id in workstation_sequence:
            progress = ProductionProgress(
                production_task_id=task.id,
                workstation_id=workstation_id,
                status='pending'
            )
            db.session.add(progress)
    
    @staticmethod
    def group_tasks_into_batches(tasks: List[ProductionTask]) -> List[ProductionBatch]:
        """Grupuje zadania w partie według gatunku drewna i technologii"""
        try:
            batches_created = []
            
            # Pogrupuj zadania według gatunku i technologii
            groups = {}
            for task in tasks:
                key = f"{task.wood_species}-{task.technology}"
                if key not in groups:
                    groups[key] = []
                groups[key].append(task)
            
            # Utwórz partie dla każdej grupy
            for group_key, group_tasks in groups.items():
                species, technology = group_key.split('-')
                
                # Wygeneruj nazwę partii
                today = date.today()
                batch_count = ProductionBatch.query.filter(
                    ProductionBatch.batch_date == today,
                    ProductionBatch.wood_species == species,
                    ProductionBatch.technology == technology
                ).count()
                
                batch_name = f"{species.upper()}-{technology.upper()[:3]}-{batch_count + 1:03d}"
                
                # Utwórz partię
                batch = ProductionBatch(
                    name=batch_name,
                    wood_species=species,
                    technology=technology,
                    batch_date=today,
                    planned_start_date=today,
                    task_count=len(group_tasks),
                    status='planned'
                )
                
                db.session.add(batch)
                db.session.flush()
                
                # Przypisz zadania do partii
                for i, task in enumerate(group_tasks):
                    batch_task = ProductionBatchTask(
                        batch_id=batch.id,
                        production_task_id=task.id,
                        sequence_in_batch=i + 1
                    )
                    db.session.add(batch_task)
                
                batches_created.append(batch)
            
            db.session.commit()
            logger.info(f"Utworzono {len(batches_created)} partii produkcyjnych")
            return batches_created
            
        except Exception as e:
            logger.error(f"Błąd grupowania zadań w partie: {str(e)}")
            db.session.rollback()
            return []
    
    @staticmethod
    def reorganize_production_queue():
        """Reorganizuje kolejność produkcji według priorytetów"""
        try:
            # Pobierz wszystkie zadania oczekujące i w trakcie
            tasks = ProductionTask.query.filter(
                ProductionTask.status.in_(['pending', 'in_progress'])
            ).all()
            
            # Sortuj według kryteriów priorytetów
            sorted_tasks = sorted(tasks, key=lambda t: (
                t.estimated_completion_date or date.max,  # Termin realizacji (najpilniejsze pierwsze)
                t.wood_species,  # Gatunek drewna (grupowanie)
                0 if t.technology == 'lity' else 1,  # Technologia (lity przed mikrowczepem)
                0 if t.wood_class == 'A/B' else 1,  # Klasa (A/B przed B/B)
                -t.quantity,  # Wielkość zamówienia (większe pierwsze)
            ))
            
            # Przypisz nowe priorytety
            for i, task in enumerate(sorted_tasks):
                task.priority_order = (i + 1) * 10  # Odstępy co 10 dla łatwego wstawiania
            
            db.session.commit()
            
            logger.info(f"Zreorganizowano kolejność {len(sorted_tasks)} zadań")
            return {'tasks_updated': len(sorted_tasks)}
            
        except Exception as e:
            logger.error(f"Błąd reorganizacji kolejności: {str(e)}")
            db.session.rollback()
            return {'tasks_updated': 0}
    
    @staticmethod
    def get_workstation_tasks(workstation_id: int, limit: int = 20) -> List[ProductionTask]:
        """Pobiera zadania dla konkretnego stanowiska"""
        try:
            # Znajdź zadania które są na tym stanowisku lub czekają na nie
            tasks = db.session.query(ProductionTask).join(
                ProductionProgress
            ).filter(
                ProductionProgress.workstation_id == workstation_id,
                ProductionProgress.status.in_(['pending', 'in_progress']),
                ProductionTask.status.in_(['pending', 'in_progress'])
            ).order_by(
                ProductionTask.priority_order
            ).limit(limit).all()
            
            return tasks
            
        except Exception as e:
            logger.error(f"Błąd pobierania zadań dla stanowiska {workstation_id}: {str(e)}")
            return []
    
    @staticmethod
    def start_task(task_id: int, worker_id: Optional[int] = None, tablet_id: Optional[str] = None) -> Dict:
        """Rozpoczyna zadanie na stanowisku"""
        try:
            task = ProductionTask.query.get(task_id)
            if not task:
                return {'success': False, 'error': 'Zadanie nie zostało znalezione'}
            
            # Znajdź aktualny rekord postępu
            current_progress = None
            for progress in task.progress_records:
                if progress.status == 'pending':
                    current_progress = progress
                    break
            
            if not current_progress:
                return {'success': False, 'error': 'Brak oczekujących etapów dla tego zadania'}
            
            # Rozpocznij pracę
            current_progress.start_work(worker_id, tablet_id)
            
            # Zaktualizuj status zadania
            if task.status == 'pending':
                task.status = 'in_progress'
                task.actual_start_date = datetime.utcnow()
            
            db.session.commit()
            
            return {
                'success': True,
                'message': f'Rozpoczęto pracę na stanowisku {current_progress.workstation.name}',
                'workstation': current_progress.workstation.name
            }
            
        except Exception as e:
            logger.error(f"Błąd rozpoczynania zadania {task_id}: {str(e)}")
            db.session.rollback()
            return {'success': False, 'error': 'Wystąpił błąd serwera'}
    
    @staticmethod
    def complete_task(task_id: int, tablet_id: Optional[str] = None, notes: str = '') -> Dict:
        """Kończy zadanie na stanowisku"""
        try:
            task = ProductionTask.query.get(task_id)
            if not task:
                return {'success': False, 'error': 'Zadanie nie zostało znalezione'}
            
            # Znajdź aktualny rekord postępu
            current_progress = None
            for progress in task.progress_records:
                if progress.status == 'in_progress':
                    current_progress = progress
                    break
            
            if not current_progress:
                return {'success': False, 'error': 'Brak zadania w trakcie na tym stanowisku'}
            
            # Zakończ pracę
            current_progress.complete_work(notes)
            
            # Sprawdź czy to był ostatni etap
            remaining_steps = [p for p in task.progress_records if p.status == 'pending']
            
            if not remaining_steps:
                # Zadanie ukończone
                task.status = 'completed'
                task.actual_completion_date = datetime.utcnow()
                
                # Aktualizuj statystyki partii
                ProductionService._update_batch_statistics(task)
                
                # Synchronizuj status z Baselinker
                ProductionService._sync_status_to_baselinker(task)
            
            db.session.commit()
            
            next_station = remaining_steps[0].workstation.name if remaining_steps else "UKOŃCZONE"
            
            return {
                'success': True,
                'message': f'Ukończono etap {current_progress.workstation.name}',
                'next_station': next_station,
                'task_completed': len(remaining_steps) == 0
            }
            
        except Exception as e:
            logger.error(f"Błąd kończenia zadania {task_id}: {str(e)}")
            db.session.rollback()
            return {'success': False, 'error': 'Wystąpił błąd serwera'}
    
    @staticmethod
    def pause_task(task_id: int, tablet_id: Optional[str] = None, reason: str = '') -> Dict:
        """Wstrzymuje zadanie na stanowisku"""
        try:
            task = ProductionTask.query.get(task_id)
            if not task:
                return {'success': False, 'error': 'Zadanie nie zostało znalezione'}
            
            # Znajdź aktualny rekord postępu
            current_progress = None
            for progress in task.progress_records:
                if progress.status == 'in_progress':
                    current_progress = progress
                    break
            
            if not current_progress:
                return {'success': False, 'error': 'Brak zadania w trakcie na tym stanowisku'}
            
            # Wstrzymaj zadanie
            current_progress.status = 'pending'  # Powrót do oczekiwania
            if reason:
                current_progress.notes = f"WSTRZYMANE: {reason}"
            
            task.status = 'on_hold'
            
            db.session.commit()
            
            return {
                'success': True,
                'message': f'Wstrzymano zadanie na stanowisku {current_progress.workstation.name}',
                'reason': reason
            }
            
        except Exception as e:
            logger.error(f"Błąd wstrzymywania zadania {task_id}: {str(e)}")
            db.session.rollback()
            return {'success': False, 'error': 'Wystąpił błąd serwera'}
    
    @staticmethod
    def _update_batch_statistics(task: ProductionTask):
        """Aktualizuje statystyki partii po ukończeniu zadania"""
        try:
            # Znajdź partię zawierającą to zadanie
            batch_relation = ProductionBatchTask.query.filter_by(
                production_task_id=task.id
            ).first()
            
            if batch_relation:
                batch = batch_relation.batch
                batch.update_task_counts()
                
                # Jeśli wszystkie zadania ukończone, oznacz partię jako ukończoną
                if batch.completed_task_count >= batch.task_count:
                    batch.status = 'completed'
                    batch.actual_completion_date = date.today()
                    
        except Exception as e:
            logger.error(f"Błąd aktualizacji statystyk partii: {str(e)}")
    
    @staticmethod
    def _sync_status_to_baselinker(task: ProductionTask):
        """Synchronizuje status zadania z Baselinker"""
        try:
            # TODO: Implementacja synchronizacji z Baselinker
            # Zaktualizuj status zamówienia w Baselinker na "W realizacji" lub "Gotowe"
            logger.info(f"TODO: Sync task {task.id} status to Baselinker order {task.baselinker_order_id}")
            
        except Exception as e:
            logger.error(f"Błąd synchronizacji z Baselinker: {str(e)}")
    
    @staticmethod
    def get_production_statistics() -> Dict:
        """Pobiera podstawowe statystyki produkcji"""
        try:
            today = date.today()
            
            # Zadania dzisiaj
            tasks_today = ProductionTask.query.filter(
                ProductionTask.created_at >= today
            ).count()
            
            # Zadania oczekujące
            tasks_pending = ProductionTask.query.filter_by(status='pending').count()
            
            # Zadania w trakcie
            tasks_in_progress = ProductionTask.query.filter_by(status='in_progress').count()
            
            # Zadania ukończone dzisiaj
            tasks_completed_today = ProductionTask.query.filter(
                ProductionTask.status == 'completed',
                ProductionTask.actual_completion_date >= datetime.combine(today, datetime.min.time())
            ).count()
            
            # Aktywne alerty
            active_alerts = ProductionAlert.query.filter_by(is_read=False).count()
            
            # Aktywne partie
            active_batches = ProductionBatch.query.filter(
                ProductionBatch.status.in_(['planned', 'in_progress'])
            ).count()
            
            return {
                'tasks_today': tasks_today,
                'tasks_pending': tasks_pending,
                'tasks_in_progress': tasks_in_progress,
                'tasks_completed_today': tasks_completed_today,
                'active_alerts': active_alerts,
                'active_batches': active_batches
            }
            
        except Exception as e:
            logger.error(f"Błąd pobierania statystyk: {str(e)}")
            return {}
    
    @staticmethod
    def get_current_batch_for_workstation(workstation_id: int) -> Optional[ProductionBatch]:
        """Pobiera aktualną partię dla stanowiska"""
        try:
            return ProductionBatch.query.filter_by(
                current_workstation_id=workstation_id,
                status='in_progress'
            ).first()
            
        except Exception as e:
            logger.error(f"Błąd pobierania partii dla stanowiska {workstation_id}: {str(e)}")
            return None
    
    @staticmethod
    def get_filtered_tasks(status=None, wood_species=None, workstation_id=None, limit=50) -> List[ProductionTask]:
        """Pobiera zadania z filtrami"""
        try:
            query = ProductionTask.query
            
            if status:
                query = query.filter(ProductionTask.status == status)
            
            if wood_species:
                query = query.filter(ProductionTask.wood_species == wood_species)
            
            if workstation_id:
                query = query.join(ProductionProgress).filter(
                    ProductionProgress.workstation_id == workstation_id
                )
            
            return query.order_by(ProductionTask.priority_order).limit(limit).all()
            
        except Exception as e:
            logger.error(f"Błąd filtrowania zadań: {str(e)}")
            return []
    
    @staticmethod
    def task_to_dict(task: ProductionTask) -> Dict:
        """Konwertuje zadanie do słownika"""
        return {
            'id': task.id,
            'product_name': task.product_name,
            'dimensions': task.dimensions,
            'quantity': task.quantity,
            'wood_species': task.wood_species,
            'technology': task.technology,
            'needs_coating': task.needs_coating,
            'status': task.status,
            'priority_order': task.priority_order,
            'estimated_completion_date': task.estimated_completion_date.isoformat() if task.estimated_completion_date else None,
            'completion_percentage': task.get_completion_percentage(),
            'current_workstation': task.get_current_workstation().name if task.get_current_workstation() else None
        }
    
    @staticmethod
    def alert_to_dict(alert: ProductionAlert) -> Dict:
        """Konwertuje alert do słownika"""
        return {
            'id': alert.id,
            'alert_type': alert.alert_type,
            'title': alert.title,
            'message': alert.message,
            'is_read': alert.is_read,
            'created_at': alert.created_at.isoformat()
        }
    
    @staticmethod
    def update_batch_priority(batch_id: int, new_priority: int) -> Dict:
        """Aktualizuje priorytet partii"""
        try:
            batch = ProductionBatch.query.get(batch_id)
            if not batch:
                return {'success': False, 'error': 'Partia nie została znaleziona'}
            
            # Aktualizuj priorytety zadań w partii
            for batch_task in batch.task_relations:
                task = batch_task.task
                task.priority_order = new_priority + batch_task.sequence_in_batch
            
            db.session.commit()
            
            return {'success': True, 'message': 'Priorytet partii został zaktualizowany'}
            
        except Exception as e:
            logger.error(f"Błąd aktualizacji priorytetu partii {batch_id}: {str(e)}")
            db.session.rollback()
            return {'success': False, 'error': 'Wystąpił błąd serwera'}
    
    @staticmethod
    def update_task_priorities(task_priorities: List[Dict]) -> Dict:
        """Aktualizuje priorytety zadań (drag & drop)"""
        try:
            updated_count = 0
            
            for item in task_priorities:
                task_id = item.get('task_id')
                new_priority = item.get('priority')
                
                if task_id and new_priority is not None:
                    task = ProductionTask.query.get(task_id)
                    if task:
                        task.priority_order = new_priority
                        updated_count += 1
            
            db.session.commit()
            
            return {'updated_count': updated_count}
            
        except Exception as e:
            logger.error(f"Błąd aktualizacji priorytetów zadań: {str(e)}")
            db.session.rollback()
            return {'updated_count': 0}
    
    @staticmethod
    def get_batch_statistics() -> Dict:
        """Pobiera statystyki partii"""
        try:
            today = date.today()
            week_ago = today - timedelta(days=7)
            
            return {
                'total_batches': ProductionBatch.query.count(),
                'active_batches': ProductionBatch.query.filter(
                    ProductionBatch.status.in_(['planned', 'in_progress'])
                ).count(),
                'completed_this_week': ProductionBatch.query.filter(
                    ProductionBatch.status == 'completed',
                    ProductionBatch.actual_completion_date >= week_ago
                ).count()
            }
            
        except Exception as e:
            logger.error(f"Błąd pobierania statystyk partii: {str(e)}")
            return {}
    
    @staticmethod
    def get_time_analytics() -> Dict:
        """Pobiera analitykę czasów wykonania"""
        try:
            # TODO: Implementacja analityki czasów
            return {
                'avg_completion_time': 480,  # w minutach
                'fastest_workstation': 'Cięcie',
                'slowest_workstation': 'Lakierowanie'
            }
            
        except Exception as e:
            logger.error(f"Błąd pobierania analityki czasów: {str(e)}")
            return {}
    
    @staticmethod
    def get_workstation_performance() -> Dict:
        """Pobiera wydajność stanowisk"""
        try:
            # TODO: Implementacja analityki stanowisk
            return {
                'workstation_efficiency': {},
                'bottlenecks': []
            }
            
        except Exception as e:
            logger.error(f"Błąd pobierania wydajności stanowisk: {str(e)}")
            return {}
    
    @staticmethod
    def get_worker_performance() -> Dict:
        """Pobiera wydajność pracowników"""
        try:
            # TODO: Implementacja analityki pracowników
            return {
                'worker_productivity': {},
                'top_performers': []
            }
            
        except Exception as e:
            logger.error(f"Błąd pobierania wydajności pracowników: {str(e)}")
            return {}

    @staticmethod
    def get_workstation_tasks(workstation_id: int, limit: int = 10) -> List[ProductionTask]:
        """Pobiera zadania dla stanowiska"""
        try:
            # Pobierz zadania przypisane do tego stanowiska
            tasks = db.session.query(ProductionTask).join(
                ProductionProgress
            ).filter(
                ProductionProgress.workstation_id == workstation_id,
                ProductionTask.status.in_(['pending', 'in_progress'])
            ).order_by(ProductionTask.priority_order).limit(limit).all()
        
            return tasks
        
        except Exception as e:
            logger.error(f"Błąd pobierania zadań dla stanowiska {workstation_id}: {str(e)}")
            return []

    @staticmethod
    def reorganize_production_queue() -> Dict:
        """Reorganizuje kolejność produkcji"""
        try:
            # Pobierz wszystkie zadania oczekujące
            pending_tasks = ProductionTask.query.filter_by(status='pending').all()
        
            # Posortuj według typu drewna (grupowanie podobnych produktów)
            # i priorytetu
            pending_tasks.sort(key=lambda x: (x.wood_species, x.priority_order))
        
            # Przypisz nowe priorytety
            for i, task in enumerate(pending_tasks):
                task.priority_order = i + 1
        
            db.session.commit()
        
            return {
                'success': True,
                'tasks_updated': len(pending_tasks),
                'message': f'Zreorganizowano kolejność {len(pending_tasks)} zadań'
            }
        
        except Exception as e:
            logger.error(f"Błąd reorganizacji kolejności: {str(e)}")
            db.session.rollback()
            return {
                'success': False,
                'tasks_updated': 0,
                'error': 'Wystąpił błąd podczas reorganizacji'
            }

    @staticmethod
    def create_production_tasks_from_order(order_data: Dict) -> List[ProductionTask]:
        """Tworzy zadania produkcyjne z rzeczywistych danych zamówienia Baselinker"""
        try:
            tasks = []
            order_id = order_data.get('order_id')
        
            logger.info(f"Tworzenie zadań produkcyjnych dla zamówienia {order_id}")
            logger.debug(f"Struktura zamówienia: {list(order_data.keys())}")
        
            # Przetwórz produkty w zamówieniu
            products = order_data.get('products', [])
            logger.info(f"Znaleziono {len(products)} produktów w zamówieniu {order_id}")
        
            if not products:
                logger.warning(f"Brak produktów w zamówieniu {order_id}")
                return []
        
            for i, product in enumerate(products):
                try:
                    # Wyciągnij podstawowe informacje o produkcie
                    product_name = product.get('name', 'Nieznany produkt')
                    quantity = int(product.get('quantity', 1))
                    product_id = product.get('product_id', 0)
                
                    logger.debug(f"Przetwarzam produkt {i+1}: {product_name} (ID: {product_id}, ilość: {quantity})")
                
                    # Parsuj nazwę produktu żeby wyciągnąć właściwości
                    parsed_product = ProductionService._parse_product_name(product_name)
                    logger.debug(f"Parsed properties: {parsed_product}")
                
                    # Utwórz zadanie produkcyjne
                    task = ProductionTask(
                        baselinker_order_id=order_id,
                        baselinker_product_id=product_id,
                        product_name=product_name,
                        dimensions=parsed_product.get('dimensions', ''),
                        quantity=quantity,
                        wood_species=parsed_product.get('wood_species', 'nieznany'),
                        technology=parsed_product.get('technology', 'standard'),
                        needs_coating=parsed_product.get('needs_coating', False),
                        coating_type=parsed_product.get('coating_type'),
                        status='pending',
                        priority_order=999  # Niska wartość dla nowych zadań
                    )
                
                    db.session.add(task)
                    tasks.append(task)
                
                    logger.debug(f"Utworzono zadanie dla produktu: {product_name}")
                
                except Exception as e:
                    logger.error(f"Błąd tworzenia zadania dla produktu {product.get('name')}: {str(e)}")
                    logger.error(f"Dane produktu: {product}")
                    continue
        
            # Zapisz wszystkie zadania
            if tasks:
                try:
                    db.session.commit()
                    logger.info(f"Zapisano {len(tasks)} zadań dla zamówienia {order_id}")
                
                    # Po utworzeniu zadań, utwórz progress entries dla workflow
                    for task in tasks:
                        ProductionService._create_workflow_progress(task)
                
                except Exception as e:
                    logger.error(f"Błąd zapisywania zadań do bazy: {str(e)}")
                    db.session.rollback()
                    return []
            else:
                logger.warning(f"Nie utworzono żadnych zadań dla zamówienia {order_id}")
        
            return tasks
        
        except Exception as e:
            logger.error(f"Błąd tworzenia zadań produkcyjnych: {str(e)}")
            logger.error(f"Dane zamówienia: {order_data}")
            db.session.rollback()
            return []

    @staticmethod
    def fetch_order_from_baselinker(order_id: str) -> Optional[Dict]:
        """Pobiera dane zamówienia z Baselinker"""
        try:
            # TO DO: Implementacja połączenia z Baselinker API
            # Na razie zwracamy przykładowe dane
            return {
                'order_id': order_id,
                'products': [
                    {
                        'name': 'Blat dębowy',
                        'dimensions': '200x80x4',
                        'quantity': 1,
                        'wood_species': 'dąb',
                        'technology': 'lity',
                        'needs_coating': True
                    }
                ]
            }
        
        except Exception as e:
            logger.error(f"Błąd pobierania zamówienia z Baselinker {order_id}: {str(e)}")
            return None

    @staticmethod
    def sync_orders_from_baselinker(date_from: datetime) -> Dict:
        """Synchronizuje opłacone zamówienia z Baselinker i tworzy zadania produkcyjne"""
        try:
            logger.info(f"Rozpoczęcie synchronizacji zamówień z Baselinker od {date_from}")
    
            # Wczytaj konfigurację Baselinker
            try:
                with open('config/core.json', 'r', encoding='utf-8') as f:  # POPRAWIONA ŚCIEŻKA
                    config = json.load(f)
        
                baselinker_config = config.get('API_BASELINKER', {})
                api_token = baselinker_config.get('api_key')
                endpoint = baselinker_config.get('endpoint')
        
                if not api_token or not endpoint:
                    logger.error("Brak konfiguracji API Baselinker")
                    return {
                        'success': False,
                        'error': 'Brak konfiguracji API Baselinker (api_key lub endpoint)'
                    }
            except Exception as e:
                logger.error(f"Błąd wczytywania konfiguracji: {str(e)}")
                return {
                    'success': False,
                    'error': 'Błąd wczytywania konfiguracji'
                }
    
            # Pobierz zamówienia z Baselinker
            orders = ProductionService._fetch_paid_orders_from_baselinker(api_token, endpoint, date_from)
    
            if not orders:
                logger.info("Brak nowych opłaconych zamówień do synchronizacji")
                return {
                    'success': True,
                    'orders_processed': 0,
                    'tasks_created': 0,
                    'message': 'Brak nowych zamówień'
                }
    
            # Przetwórz zamówienia i utwórz zadania produkcyjne
            tasks_created = 0
            orders_processed = 0
    
            for order in orders:
                try:
                    # Sprawdź czy zamówienie już zostało przetworzone
                    existing_tasks = ProductionTask.query.filter_by(
                        baselinker_order_id=order['order_id']
                    ).first()
            
                    if existing_tasks:
                        logger.debug(f"Zamówienie {order['order_id']} już przetworzone, pomijam")
                        continue
            
                    # Utwórz zadania produkcyjne dla tego zamówienia
                    order_tasks = ProductionService.create_production_tasks_from_order(order)
                    tasks_created += len(order_tasks)
                    orders_processed += 1
            
                    logger.info(f"Utworzono {len(order_tasks)} zadań dla zamówienia {order['order_id']}")
            
                except Exception as e:
                    logger.error(f"Błąd przetwarzania zamówienia {order.get('order_id')}: {str(e)}")
                    continue
    
            logger.info(f"Synchronizacja zakończona: {orders_processed} zamówień, {tasks_created} zadań")
    
            return {
                'success': True,
                'orders_processed': orders_processed,
                'tasks_created': tasks_created,
                'message': f'Zsynchronizowano {orders_processed} zamówień'
            }
    
        except Exception as e:
            logger.error(f"Błąd synchronizacji zamówień: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }

    @staticmethod
    def _fetch_paid_orders_from_baselinker(api_token: str, endpoint: str, date_from: datetime) -> List[Dict]:
        """Pobiera zamówienia wymagające produkcji z Baselinker API"""
        try:
            headers = {
                'X-BLToken': api_token,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        
            # Statusy zamówień które wymagają produkcji
            production_statuses = [
                155824,  # "Nowe - opłacone"
                138619,  # "W produkcji - surowe"
                148830,  # "W produkcji - lakierowanie"
                148831,  # "W produkcji - bejcowanie"
                148832,  # "W produkcji - olejowanie"
            ]
        
            all_orders = []
        
            for status_id in production_statuses:
                data = {
                    'method': 'getOrders',
                    'parameters': json.dumps({
                        'date_confirmed_from': int(date_from.timestamp()),
                        'status_id': status_id,
                        'get_unconfirmed_orders': False
                    })
                }
            
                response = requests.post(endpoint, headers=headers, data=data, timeout=30)
                response.raise_for_status()
            
                result = response.json()
            
                if result.get('status') == 'SUCCESS':
                    orders = result.get('orders', [])
                    logger.info(f"Status {status_id}: {len(orders)} zamówień")
                    all_orders.extend(orders)
                else:
                    logger.error(f"Błąd API Baselinker dla statusu {status_id}: {result}")
        
            # Usuń duplikaty (to samo zamówienie może mieć różne statusy w czasie)
            unique_orders = {}
            for order in all_orders:
                order_id = order.get('order_id')
                if order_id not in unique_orders:
                    unique_orders[order_id] = order
        
            final_orders = list(unique_orders.values())
            logger.info(f"Pobrano łącznie {len(final_orders)} unikalnych zamówień z Baselinker")
            return final_orders
        
        except Exception as e:
            logger.error(f"Błąd pobierania zamówień z Baselinker: {str(e)}")
            return []

    @staticmethod
    def _create_workflow_progress(task: ProductionTask):
        """Tworzy progress entries dla zadania na podstawie workflow"""
        try:
            # Znajdź odpowiedni workflow
            workflow = ProductionWorkflow.query.filter_by(
                wood_species=task.wood_species,
                technology=task.technology,
                needs_coating=task.needs_coating
            ).first()
        
            if not workflow:
                # Użyj domyślnego workflow - wszystkie stanowiska
                workstations = Workstation.query.filter_by(is_active=True).order_by(
                    Workstation.sequence_order
                ).all()
            
                for i, workstation in enumerate(workstations):
                    if not task.needs_coating and workstation.name == 'Lakierowanie':
                        continue  # Pomiń lakierowanie dla produktów surowych
                
                    progress = ProductionProgress(
                        production_task_id=task.id,
                        workstation_id=workstation.id,
                        sequence_order=i + 1,
                        status='pending'
                    )
                    db.session.add(progress)
            else:
                # Użyj workflow z bazy danych
                workstation_sequence = workflow.workstation_sequence or []
                estimated_times = workflow.estimated_time_minutes or {}
            
                for i, workstation_id in enumerate(workstation_sequence):
                    estimated_time = estimated_times.get(str(workstation_id))
                
                    progress = ProductionProgress(
                        production_task_id=task.id,
                        workstation_id=workstation_id,
                        sequence_order=i + 1,
                        status='pending',
                        estimated_duration_minutes=estimated_time
                    )
                    db.session.add(progress)
        
            db.session.commit()
            logger.debug(f"Utworzono workflow progress dla zadania {task.id}")
        
        except Exception as e:
            logger.error(f"Błąd tworzenia workflow progress dla zadania {task.id}: {str(e)}")
            db.session.rollback()