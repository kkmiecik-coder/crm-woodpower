from flask import render_template, jsonify, request, session, redirect, url_for, flash
from functools import wraps
from datetime import datetime, date, timedelta
import json
import logging

from . import production_bp
from .models import (
    ProductionTask, ProductionProgress, ProductionBatch, ProductionBatchTask,
    ProductionAlert, ProductionWorkflow, Workstation, User
)
from .services import ProductionService
from .analyzers import ProductAnalyzer
from extensions import db

logger = logging.getLogger(__name__)

# -------------------------
# DECORATORS
# -------------------------

def login_required(func):
    """Wymaga zalogowania użytkownika"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            flash("Twoja sesja wygasła. Zaloguj się ponownie.", "info")
            return redirect(url_for('login'))
        return func(*args, **kwargs)
    return wrapper

def production_access_required(func):
    """Wymaga dostępu do modułu production (admin/user/worker)"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            return redirect(url_for('login'))
        
        user = User.query.filter_by(email=user_email).first()
        if not user or user.role not in ['admin', 'user', 'worker']:
            flash("Nie masz uprawnień do tego modułu.", "error")
            return redirect(url_for('dashboard'))
        
        return func(*args, **kwargs)
    return wrapper

def admin_required(func):
    """Wymaga uprawnień administratora lub użytkownika (nie worker)"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            return redirect(url_for('login'))
        
        user = User.query.filter_by(email=user_email).first()
        if not user or not user.can_access_production_admin():
            flash("Nie masz uprawnień administratora.", "error")
            return redirect(url_for('production.worker_dashboard'))
        
        return func(*args, **kwargs)
    return wrapper

# -------------------------
# WIDOKI GŁÓWNE
# -------------------------

@production_bp.route('/dashboard')
@login_required
@admin_required
def production_dashboard():
    """Główny dashboard zarządzania produkcją dla adminów/userów"""
    try:
        # Pobierz podstawowe statystyki
        stats = ProductionService.get_production_statistics()
        
        # Aktywne alerty
        active_alerts = ProductionAlert.query.filter_by(is_read=False).order_by(
            ProductionAlert.created_at.desc()
        ).limit(5).all()
        
        # Aktualne partie w produkcji
        active_batches = ProductionBatch.query.filter(
            ProductionBatch.status.in_(['planned', 'in_progress'])
        ).order_by(ProductionBatch.planned_start_date).all()
        
        # Stan stanowisk pracy
        workstations = Workstation.query.filter_by(is_active=True).order_by(
            Workstation.sequence_order
        ).all()
        
        user_email = session.get('user_email')
        
        return render_template('production_dashboard.html',
                             stats=stats,
                             active_alerts=active_alerts,
                             active_batches=active_batches,
                             workstations=workstations,
                             user_email=user_email)
        
    except Exception as e:
        logger.error(f"Błąd w production_dashboard: {str(e)}")
        flash("Wystąpił błąd podczas ładowania dashboardu.", "error")
        return redirect(url_for('dashboard'))

@production_bp.route('/worker')
@login_required
@production_access_required
def worker_dashboard():
    """Dashboard dla pracowników - widok swojego stanowiska"""
    try:
        user_email = session.get('user_email')
        user = User.query.filter_by(email=user_email).first()
        
        # Jeśli admin/user wchodzi w tryb worker, pokaż opcję wyboru stanowiska
        if user.can_access_production_admin():
            workstations = Workstation.query.filter_by(is_active=True).order_by(
                Workstation.sequence_order
            ).all()
            selected_workstation_id = request.args.get('workstation_id', type=int)
            
            if selected_workstation_id:
                workstation = Workstation.query.get(selected_workstation_id)
            else:
                workstation = workstations[0] if workstations else None
        else:
            # Worker ma przypisane stanowisko
            workstation = user.assigned_workstation
            workstations = [workstation] if workstation else []
        
        if not workstation:
            flash("Nie masz przypisanego stanowiska pracy.", "error")
            return redirect(url_for('dashboard'))
        
        # Pobierz zadania dla tego stanowiska
        tasks = ProductionService.get_workstation_tasks(workstation.id)
        
        return render_template('worker_dashboard.html',
                             workstation=workstation,
                             workstations=workstations,
                             tasks=tasks,
                             user=user)
        
    except Exception as e:
        logger.error(f"Błąd w worker_dashboard: {str(e)}")
        flash("Wystąpił błąd podczas ładowania dashboardu pracownika.", "error")
        return redirect(url_for('dashboard'))

@production_bp.route('/tablet/<tablet_identifier>')
@production_access_required
def tablet_interface(tablet_identifier):
    """Interfejs tabletu dla stanowiska pracy"""
    try:
        # Znajdź stanowisko na podstawie identyfikatora tabletu
        workstation = Workstation.query.filter_by(
            tablet_identifier=tablet_identifier,
            is_active=True
        ).first()
        
        if not workstation:
            return jsonify({'error': 'Nieznany identyfikator tabletu'}), 404
        
        # Pobierz aktualne zadania dla stanowiska
        tasks = ProductionService.get_workstation_tasks(workstation.id, limit=10)
        
        # Pobierz aktualną partię
        current_batch = ProductionService.get_current_batch_for_workstation(workstation.id)
        
        return render_template('tablet_interface.html',
                             workstation=workstation,
                             tasks=tasks,
                             current_batch=current_batch,
                             tablet_identifier=tablet_identifier)
        
    except Exception as e:
        logger.error(f"Błąd w tablet_interface: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

# -------------------------
# ZARZĄDZANIE PARTIAMI
# -------------------------

@production_bp.route('/batches')
@login_required
@admin_required
def batch_management():
    """Zarządzanie partiami produkcyjnymi"""
    try:
        # Pobierz wszystkie partie z ostatnich 30 dni
        date_from = date.today() - timedelta(days=30)
        batches = ProductionBatch.query.filter(
            ProductionBatch.batch_date >= date_from
        ).order_by(ProductionBatch.created_at.desc()).all()
        
        # Statystyki partii
        batch_stats = ProductionService.get_batch_statistics()
        
        return render_template('batch_management.html',
                             batches=batches,
                             batch_stats=batch_stats)
        
    except Exception as e:
        logger.error(f"Błąd w batch_management: {str(e)}")
        flash("Wystąpił błąd podczas ładowania zarządzania partiami.", "error")
        return redirect(url_for('production.production_dashboard'))

@production_bp.route('/priorities')
@login_required
@admin_required
def priority_management():
    """Zarządzanie priorytetami zadań (drag & drop)"""
    try:
        # Pobierz zadania oczekujące i w trakcie
        pending_tasks = ProductionTask.query.filter(
            ProductionTask.status.in_(['pending', 'in_progress'])
        ).order_by(ProductionTask.priority_order).all()
        
        # Pogrupuj według gatunku drewna
        tasks_by_species = {}
        for task in pending_tasks:
            species = task.wood_species
            if species not in tasks_by_species:
                tasks_by_species[species] = []
            tasks_by_species[species].append(task)
        
        return render_template('priority_management.html',
                             tasks_by_species=tasks_by_species,
                             pending_tasks=pending_tasks)
        
    except Exception as e:
        logger.error(f"Błąd w priority_management: {str(e)}")
        flash("Wystąpił błąd podczas ładowania zarządzania priorytetami.", "error")
        return redirect(url_for('production.production_dashboard'))

@production_bp.route('/analytics')
@login_required
@admin_required
def analytics_dashboard():
    """Dashboard analityki produkcji"""
    try:
        # Analityka czasów wykonania
        time_analytics = ProductionService.get_time_analytics()
        
        # Wydajność stanowisk
        workstation_performance = ProductionService.get_workstation_performance()
        
        # Analityka pracowników
        worker_performance = ProductionService.get_worker_performance()
        
        return render_template('analytics_dashboard.html',
                             time_analytics=time_analytics,
                             workstation_performance=workstation_performance,
                             worker_performance=worker_performance)
        
    except Exception as e:
        logger.error(f"Błąd w analytics_dashboard: {str(e)}")
        flash("Wystąpił błąd podczas ładowania analityki.", "error")
        return redirect(url_for('production.production_dashboard'))

# -------------------------
# API ENDPOINTS - WEBHOOK
# -------------------------

@production_bp.route('/api/webhook/order-paid', methods=['POST'])
def webhook_order_paid():
    """Webhook wywoływany przez Baselinker po opłaceniu zamówienia"""
    try:
        data = request.get_json()
        logger.info(f"Otrzymano webhook order-paid: {data}")
        
        if not data or 'order_id' not in data:
            return jsonify({'error': 'Brak order_id w danych'}), 400
        
        order_id = data['order_id']
        
        # Pobierz szczegóły zamówienia z Baselinker
        order_data = ProductionService.fetch_order_from_baselinker(order_id)
        
        if not order_data:
            logger.error(f"Nie można pobrać zamówienia {order_id} z Baselinker")
            return jsonify({'error': 'Nie można pobrać zamówienia'}), 400
        
        # Utwórz zadania produkcyjne
        tasks_created = ProductionService.create_production_tasks_from_order(order_data)
        
        logger.info(f"Utworzono {len(tasks_created)} zadań produkcyjnych dla zamówienia {order_id}")
        
        return jsonify({
            'success': True,
            'order_id': order_id,
            'tasks_created': len(tasks_created),
            'message': f'Utworzono {len(tasks_created)} zadań produkcyjnych'
        })
        
    except Exception as e:
        logger.error(f"Błąd w webhook order-paid: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

# -------------------------
# API ENDPOINTS - TABLET
# -------------------------

@production_bp.route('/api/task/<int:task_id>/start', methods=['POST'])
def start_task(task_id):
    """Rozpocznij zadanie na stanowisku (tablet)"""
    try:
        data = request.get_json() or {}
        tablet_id = data.get('tablet_identifier')
        worker_id = data.get('worker_id')
        
        result = ProductionService.start_task(task_id, worker_id, tablet_id)
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Błąd w start_task: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

@production_bp.route('/api/task/<int:task_id>/complete', methods=['POST'])
def complete_task(task_id):
    """Zakończ zadanie na stanowisku (tablet)"""
    try:
        data = request.get_json() or {}
        tablet_id = data.get('tablet_identifier')
        notes = data.get('notes', '')
        
        result = ProductionService.complete_task(task_id, tablet_id, notes)
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Błąd w complete_task: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

@production_bp.route('/api/task/<int:task_id>/pause', methods=['POST'])
def pause_task(task_id):
    """Wstrzymaj zadanie na stanowisku (tablet)"""
    try:
        data = request.get_json() or {}
        tablet_id = data.get('tablet_identifier')
        reason = data.get('reason', '')
        
        result = ProductionService.pause_task(task_id, tablet_id, reason)
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Błąd w pause_task: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

# -------------------------
# API ENDPOINTS - ZARZĄDZANIE
# -------------------------

@production_bp.route('/api/tasks', methods=['GET'])
@admin_required
def get_tasks():
    """Pobierz listę zadań z filtrami"""
    try:
        # Parametry filtrowania
        status = request.args.get('status')
        wood_species = request.args.get('wood_species')
        workstation_id = request.args.get('workstation_id', type=int)
        limit = request.args.get('limit', 50, type=int)
        
        tasks = ProductionService.get_filtered_tasks(
            status=status,
            wood_species=wood_species,
            workstation_id=workstation_id,
            limit=limit
        )
        
        return jsonify({
            'success': True,
            'tasks': [ProductionService.task_to_dict(task) for task in tasks]
        })
        
    except Exception as e:
        logger.error(f"Błąd w get_tasks: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

@production_bp.route('/api/reorganize-queue', methods=['POST'])
@admin_required
def reorganize_queue():
    """Reorganizuj kolejność produkcji"""
    try:
        result = ProductionService.reorganize_production_queue()
        
        return jsonify({
            'success': True,
            'message': 'Kolejność produkcji została zreorganizowana',
            'tasks_updated': result.get('tasks_updated', 0)
        })
        
    except Exception as e:
        logger.error(f"Błąd w reorganize_queue: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

@production_bp.route('/api/batch/<int:batch_id>/priority', methods=['PUT'])
@admin_required
def update_batch_priority(batch_id):
    """Aktualizuj priorytet partii"""
    try:
        data = request.get_json()
        new_priority = data.get('priority')
        
        if new_priority is None:
            return jsonify({'error': 'Brak parametru priority'}), 400
        
        result = ProductionService.update_batch_priority(batch_id, new_priority)
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Błąd w update_batch_priority: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

@production_bp.route('/api/priorities/update', methods=['POST'])
@admin_required
def update_task_priorities():
    """Aktualizuj kolejność zadań (drag & drop)"""
    try:
        data = request.get_json()
        task_priorities = data.get('task_priorities', [])
        
        if not task_priorities:
            return jsonify({'error': 'Brak danych o priorytetach'}), 400
        
        result = ProductionService.update_task_priorities(task_priorities)
        
        return jsonify({
            'success': True,
            'message': f'Zaktualizowano priorytety {result["updated_count"]} zadań'
        })
        
    except Exception as e:
        logger.error(f"Błąd w update_task_priorities: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

# -------------------------
# API ENDPOINTS - ALERTY
# -------------------------

@production_bp.route('/api/alerts', methods=['GET'])
@admin_required
def get_alerts():
    """Pobierz listę alertów"""
    try:
        unread_only = request.args.get('unread_only', 'false').lower() == 'true'
        limit = request.args.get('limit', 20, type=int)
        
        query = ProductionAlert.query
        
        if unread_only:
            query = query.filter_by(is_read=False)
        
        alerts = query.order_by(ProductionAlert.created_at.desc()).limit(limit).all()
        
        return jsonify({
            'success': True,
            'alerts': [ProductionService.alert_to_dict(alert) for alert in alerts]
        })
        
    except Exception as e:
        logger.error(f"Błąd w get_alerts: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

@production_bp.route('/api/alert/<int:alert_id>/read', methods=['POST'])
@admin_required
def mark_alert_read(alert_id):
    """Oznacz alert jako przeczytany"""
    try:
        alert = ProductionAlert.query.get_or_404(alert_id)
        alert.is_read = True
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Alert oznaczony jako przeczytany'
        })
        
    except Exception as e:
        logger.error(f"Błąd w mark_alert_read: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

# -------------------------
# API ENDPOINTS - STATYSTYKI
# -------------------------

@production_bp.route('/api/stats/overview', methods=['GET'])
@admin_required
def get_stats_overview():
    """Pobierz przegląd statystyk produkcji"""
    try:
        stats = ProductionService.get_production_statistics()
        return jsonify({'success': True, 'stats': stats})
        
    except Exception as e:
        logger.error(f"Błąd w get_stats_overview: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500

@production_bp.route('/api/workstation/<int:workstation_id>/tasks', methods=['GET'])
def get_workstation_tasks_api(workstation_id):
    """Pobierz zadania dla stanowiska (API dla tabletów)"""
    try:
        limit = request.args.get('limit', 10, type=int)
        tasks = ProductionService.get_workstation_tasks(workstation_id, limit)
        
        return jsonify({
            'success': True,
            'workstation_id': workstation_id,
            'tasks': [ProductionService.task_to_dict(task) for task in tasks]
        })
        
    except Exception as e:
        logger.error(f"Błąd w get_workstation_tasks_api: {str(e)}")
        return jsonify({'error': 'Wystąpił błąd serwera'}), 500