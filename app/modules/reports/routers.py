# modules/reports/routers.py
"""
Endpointy Flask dla modułu Reports
"""

from flask import render_template, jsonify, request, session, redirect, url_for, flash, Response
from datetime import datetime, timedelta, date
from functools import wraps
from typing import List, Dict
import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
import pandas as pd
import io
import sys
from extensions import db
from . import reports_bp
from .models import BaselinkerReportOrder, ReportsSyncLog
from .service import BaselinkerReportsService, get_reports_service
from modules.logging import get_structured_logger

# Inicjalizacja loggera
reports_logger = get_structured_logger('reports.routers')

def login_required(func):
    """Dekorator wymagający zalogowania"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        user_email = session.get('user_email')
        if not user_email:
            reports_logger.warning("Próba dostępu bez autoryzacji",
                                 endpoint=request.endpoint,
                                 ip=request.remote_addr)
            flash("Twoja sesja wygasła. Zaloguj się ponownie.", "error")
            return redirect(url_for('login'))
        return func(*args, **kwargs)
    return wrapper


@reports_bp.route('/')
@login_required
def reports_home():
    """
    Główna strona modułu Reports
    """
    user_email = session.get('user_email')
    reports_logger.info("Dostęp do modułu Reports", user_email=user_email)
    
    try:
        # Sprawdź czy są nowe zamówienia w Baselinker
        service = get_reports_service()
        has_new_orders, new_orders_count = service.check_for_new_orders(hours_back=48)
        
        # Pobierz podstawowe statystyki (ostatnie 30 dni) - DOMYŚLNIE AKTYWNE
        date_from = datetime.now().date() - timedelta(days=30)
        date_to = datetime.now().date()
        
        # POPRAWKA: Sprawdź czy są jakiekolwiek dane w bazie
        total_records = BaselinkerReportOrder.query.count()
        
        if total_records == 0:
            # Brak danych w bazie - ustaw puste statystyki
            stats = {
                'total_m3': 0.0,
                'order_amount_net': 0.0,
                'value_net': 0.0,
                'value_gross': 0.0,
                'avg_price_per_m3': 0.0,
                'delivery_cost': 0.0,
                'paid_amount_net': 0.0,
                'balance_due': 0.0,
                'production_volume': 0.0,
                'production_value_net': 0.0,
                'ready_pickup_volume': 0.0
            }
            comparison = {}
        else:
            # Pobierz dane dla domyślnego zakresu dat
            query = BaselinkerReportOrder.get_filtered_orders(
                date_from=date_from,
                date_to=date_to
            )
            
            # Sprawdź czy query zwraca jakieś dane
            query_results = query.all()
            
            if not query_results:
                # Brak danych dla domyślnego zakresu - ustaw puste statystyki
                stats = {
                    'total_m3': 0.0,
                    'order_amount_net': 0.0,
                    'value_net': 0.0,
                    'value_gross': 0.0,
                    'avg_price_per_m3': 0.0,
                    'delivery_cost': 0.0,
                    'paid_amount_net': 0.0,
                    'balance_due': 0.0,
                    'production_volume': 0.0,
                    'production_value_net': 0.0,
                    'ready_pickup_volume': 0.0
                }
                comparison = {}
            else:
                # Oblicz statystyki dla istniejących danych
                stats = BaselinkerReportOrder.get_statistics(query)
                
                # Oblicz porównania tylko jeśli mamy dane i sensowne wartości
                comparison = {}
                if stats.get('total_m3', 0) > 0 or stats.get('order_amount_net', 0) > 0:
                    try:
                        comparison = BaselinkerReportOrder.get_comparison_statistics(
                            {}, date_from, date_to
                        )
                    except Exception as comp_error:
                        reports_logger.warning("Błąd obliczania porównań", error=str(comp_error))
                        comparison = {}
        
        # Pobierz ostatni log synchronizacji
        last_sync = ReportsSyncLog.query.order_by(ReportsSyncLog.sync_date.desc()).first()
        
        context = {
            'user_email': user_email,
            'has_new_orders': has_new_orders,
            'new_orders_count': new_orders_count,
            'stats': stats,
            'comparison': comparison,
            'last_sync': last_sync,
            'default_date_from': date_from.isoformat(),
            'default_date_to': date_to.isoformat(),
            'total_records': total_records  # Dodaj informację o liczbie rekordów
        }
        
        return render_template('reports.html', **context)
        
    except Exception as e:
        reports_logger.error("Błąd ładowania strony Reports", 
                           user_email=user_email, 
                           error=str(e))
        flash("Wystąpił błąd podczas ładowania danych.", "error")
        
        # W przypadku błędu zwróć puste statystyki
        return render_template('reports.html', 
                             user_email=user_email,
                             stats={
                                 'total_m3': 0.0,
                                 'order_amount_net': 0.0,
                                 'value_net': 0.0,
                                 'value_gross': 0.0,
                                 'avg_price_per_m3': 0.0,
                                 'delivery_cost': 0.0,
                                 'paid_amount_net': 0.0,
                                 'balance_due': 0.0,
                                 'production_volume': 0.0,
                                 'production_value_net': 0.0,
                                 'ready_pickup_volume': 0.0
                             },
                             comparison={},
                             default_date_from=date_from.isoformat(),
                             default_date_to=date_to.isoformat(),
                             total_records=0)

@reports_bp.route('/api/data')
@login_required
def api_get_data():
    """
    API endpoint do pobierania danych tabeli z filtrami
    """
    try:
        # Pobierz parametry filtrów
        date_from_str = request.args.get('date_from')
        date_to_str = request.args.get('date_to')
        
        # Parsuj daty
        date_from = None
        date_to = None
        
        if date_from_str:
            try:
                date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
            except ValueError:
                return jsonify({'success': False, 'error': 'Nieprawidłowy format daty początkowej'}), 400
                
        if date_to_str:
            try:
                date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
            except ValueError:
                return jsonify({'success': False, 'error': 'Nieprawidłowy format daty końcowej'}), 400
        
        # Pobierz filtry kolumn (obsługa multiple values)
        column_filters = {}
        for key, values in request.args.items(multi=True):
            if key.startswith('filter_') and values:
                column_name = key.replace('filter_', '')
                if hasattr(BaselinkerReportOrder, column_name):
                    # Grupuj wartości dla tego samego filtra
                    if column_name not in column_filters:
                        column_filters[column_name] = []
                    column_filters[column_name].extend(values if isinstance(values, list) else [values])
        
        # Wyczyść puste wartości
        for column_name in list(column_filters.keys()):
            column_filters[column_name] = [v for v in column_filters[column_name] if v and v.strip()]
            if not column_filters[column_name]:
                del column_filters[column_name]
        
        reports_logger.debug("Pobieranie danych z filtrami",
                           date_from=date_from.isoformat() if date_from else None,
                           date_to=date_to.isoformat() if date_to else None,
                           filters=column_filters)
        
        try:
            # Pobierz dane z bazy
            query = BaselinkerReportOrder.get_filtered_orders(
                filters=column_filters,
                date_from=date_from,
                date_to=date_to
            )
            
            orders = query.all()
            
        except Exception as db_error:
            # Jeśli błąd bazy danych, spróbuj ponownie
            reports_logger.warning("Błąd bazy danych, ponowna próba", error=str(db_error))
            try:
                # Zamknij połączenie i spróbuj ponownie
                db.session.close()
                db.engine.dispose()
                
                query = BaselinkerReportOrder.get_filtered_orders(
                    filters=column_filters,
                    date_from=date_from,
                    date_to=date_to
                )
                orders = query.all()
                
            except Exception as retry_error:
                reports_logger.error("Błąd bazy danych przy ponownej próbie", error=str(retry_error))
                return jsonify({
                    'success': False,
                    'error': f'Błąd bazy danych: {str(retry_error)}'
                }), 500
        
        # Konwertuj na JSON
        data = [order.to_dict() for order in orders]
        
        # Oblicz statystyki dla przefiltrowanych danych
        stats = BaselinkerReportOrder.get_statistics(query)
        
        # Oblicz statystyki porównawcze jeśli mamy daty
        comparison = {}
        if date_from and date_to:
            try:
                comparison = BaselinkerReportOrder.get_comparison_statistics(
                    column_filters, date_from, date_to
                )
            except Exception as comp_error:
                reports_logger.warning("Błąd obliczania porównań", error=str(comp_error))
                comparison = {}
        
        reports_logger.info("Pobrano dane tabeli",
                          orders_count=len(data),
                          date_from=date_from.isoformat() if date_from else None,
                          date_to=date_to.isoformat() if date_to else None)
        
        return jsonify({
            'success': True,
            'data': data,
            'stats': stats,
            'comparison': comparison,
            'total_count': len(data)
        })
        
    except Exception as e:
        reports_logger.error("Błąd pobierania danych API", error=str(e))
        return jsonify({
            'success': False,
            'error': f'Błąd serwera: {str(e)}'
        }), 500


@reports_bp.route('/api/sync', methods=['POST'])
@login_required
def api_sync_with_baselinker():
    """
    API endpoint do synchronizacji z Baselinker
    """
    user_email = session.get('user_email')
    
    try:
        # Pobierz parametry
        data = request.get_json() or {}
        date_from_str = data.get('date_from')
        date_to_str = data.get('date_to')
        selected_orders = data.get('selected_orders', [])  # Lista ID zamówień do synchronizacji
        
        # Parsuj daty jeśli podane
        date_from = None
        if date_from_str:
            try:
                date_from = datetime.strptime(date_from_str, '%Y-%m-%d')
            except ValueError:
                date_from = datetime.now() - timedelta(days=30)
        else:
            date_from = datetime.now() - timedelta(days=30)
        
        reports_logger.info("Rozpoczęcie synchronizacji z Baselinker",
                          user_email=user_email,
                          date_from=date_from.isoformat() if date_from else None,
                          selected_orders_count=len(selected_orders),
                          selected_orders=selected_orders)
        
        # Pobierz serwis
        service = get_reports_service()
        
        if selected_orders and len(selected_orders) > 0:
            # Synchronizuj wybrane zamówienia
            reports_logger.info("Synchronizowanie wybranych zamówień", 
                              selected_orders=selected_orders)
            result = _sync_selected_orders(service, selected_orders)
        else:
            # Brak wybranych zamówień
            reports_logger.warning("Brak wybranych zamówień", 
                                 selected_orders=selected_orders,
                                 data=data)
            result = {
                'success': False,
                'error': f'Nie wybrano żadnych zamówień do synchronizacji. Otrzymano: {selected_orders}'
            }
        
        reports_logger.info("Synchronizacja zakończona",
                          user_email=user_email,
                          success=result.get('success'),
                          orders_added=result.get('orders_added', 0))
        
        return jsonify(result)
        
    except Exception as e:
        reports_logger.error("Błąd synchronizacji",
                           user_email=user_email,
                           error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@reports_bp.route('/api/check-new-orders')
@login_required
def api_check_new_orders():
    """
    API endpoint do sprawdzania nowych zamówień przed synchronizacją
    """
    try:
        date_from_str = request.args.get('date_from')
        date_to_str = request.args.get('date_to')
        
        # Parsuj daty
        if date_from_str:
            try:
                date_from = datetime.strptime(date_from_str, '%Y-%m-%d')
            except ValueError:
                date_from = datetime.now() - timedelta(days=30)
        else:
            date_from = datetime.now() - timedelta(days=30)
        
        service = get_reports_service()
        
        # Pobierz zamówienia z Baselinker
        orders = service.fetch_orders_from_baselinker(date_from=date_from)
        
        if not orders:
            return jsonify({
                'success': True,
                'has_new_orders': False,
                'message': 'Brak nowych zamówień'
            })
        
        # Sprawdź które zamówienia są nowe
        order_ids = [order['order_id'] for order in orders]
        existing_ids = service._get_existing_order_ids(order_ids)
        
        new_orders = []
        for order in orders:
            if order['order_id'] not in existing_ids:
                # Przygotuj podstawowe informacje do wyświetlenia
                customer_name = (
                    order.get('delivery_fullname') or 
                    order.get('delivery_company') or 
                    order.get('user_login') or 
                    'Nieznany klient'
                )
                
                # Oblicz wartości brutto i netto
                total_gross = sum(p.get('price_brutto', 0) * p.get('quantity', 1) for p in order.get('products', [])) + order.get('delivery_price', 0)
                total_net = total_gross / 1.23
                
                order_info = {
                    'order_id': order['order_id'],
                    'date_add': datetime.fromtimestamp(order['date_add']).strftime('%d-%m-%Y %H:%M') if order.get('date_add') else '',
                    'customer_name': customer_name,
                    'products_count': len(order.get('products', [])),
                    'total_gross': total_gross,
                    'total_net': total_net,
                    'delivery_price': order.get('delivery_price', 0),
                    'internal_number': order.get('extra_field_1', ''),
                    'products': [p.get('name') for p in order.get('products', [])]
                }
                new_orders.append(order_info)
        
        reports_logger.info("Sprawdzenie nowych zamówień",
                          total_orders=len(orders),
                          new_orders=len(new_orders))
        
        return jsonify({
            'success': True,
            'has_new_orders': len(new_orders) > 0,
            'new_orders': new_orders,
            'total_orders': len(orders),
            'existing_orders': len(existing_ids)
        })
        
    except Exception as e:
        reports_logger.error("Błąd sprawdzania nowych zamówień", error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@reports_bp.route('/api/add-manual-row', methods=['POST'])
@login_required
def api_add_manual_row():
    """
    API endpoint do dodawania ręcznego wiersza
    """
    user_email = session.get('user_email')
    
    try:
        data = request.get_json()
        
        reports_logger.info("Dodawanie ręcznego wiersza",
                          user_email=user_email)
        
        # Utwórz nowy rekord
        record = BaselinkerReportOrder(
            is_manual=True,
            date_created=datetime.strptime(data.get('date_created'), '%Y-%m-%d').date() if data.get('date_created') else date.today(),
            internal_order_number=data.get('internal_order_number'),
            customer_name=data.get('customer_name'),
            delivery_postcode=data.get('delivery_postcode'),
            delivery_city=data.get('delivery_city'),
            delivery_address=data.get('delivery_address'),
            delivery_state=data.get('delivery_state'),
            phone=data.get('phone'),
            caretaker=user_email,  # Automatycznie wpisz użytkownika dodającego
            delivery_method=data.get('delivery_method'),
            order_source=data.get('order_source'),
            group_type=data.get('group_type'),
            product_type=data.get('product_type', 'deska'),  # Domyślnie deska
            finish_state=data.get('finish_state', 'surowy'),
            wood_species=data.get('wood_species'),
            technology=data.get('technology'),
            wood_class=data.get('wood_class'),
            length_cm=float(data.get('length_cm', 0)) if data.get('length_cm') else None,
            width_cm=float(data.get('width_cm', 0)) if data.get('width_cm') else None,
            thickness_cm=float(data.get('thickness_cm', 0)) if data.get('thickness_cm') else None,
            quantity=int(data.get('quantity', 1)) if data.get('quantity') else 1,
            price_gross=float(data.get('price_gross', 0)) if data.get('price_gross') else None,
            delivery_cost=float(data.get('delivery_cost', 0)) if data.get('delivery_cost') else None,
            payment_method=data.get('payment_method'),
            paid_amount_net=float(data.get('paid_amount_net', 0)) if data.get('paid_amount_net') else 0,
            current_status=data.get('current_status', 'Nowe - opłacone'),  # Domyślnie opłacone dla ręcznych
            order_amount_net=float(data.get('price_gross', 0)) / 1.23 if data.get('price_gross') else 0  # Oblicz order_amount_net
        )
        
        # Oblicz pola pochodne
        record.calculate_fields()
        
        # Zapisz do bazy
        db.session.add(record)
        db.session.commit()
        
        reports_logger.info("Dodano ręczny wiersz",
                          user_email=user_email,
                          record_id=record.id)
        
        return jsonify({
            'success': True,
            'message': 'Wiersz został dodany',
            'record_id': record.id
        })
        
    except Exception as e:
        db.session.rollback()
        reports_logger.error("Błąd dodawania ręcznego wiersza",
                           user_email=user_email,
                           error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@reports_bp.route('/api/update-manual-row', methods=['POST'])
@login_required
def api_update_manual_row():
    """
    API endpoint do edycji ręcznego wiersza
    """
    user_email = session.get('user_email')
    
    try:
        data = request.get_json()
        record_id = data.get('record_id')
        
        if not record_id:
            return jsonify({'success': False, 'error': 'Brak ID rekordu'}), 400
        
        # Pobierz rekord
        record = BaselinkerReportOrder.query.get_or_404(record_id)
        
        # Sprawdź czy to rekord ręczny
        if not record.is_manual:
            return jsonify({
                'success': False, 
                'error': 'Można edytować tylko rekordy dodane ręcznie'
            }), 403
        
        reports_logger.info("Edycja ręcznego wiersza",
                          user_email=user_email,
                          record_id=record_id)
        
        # Aktualizuj pola
        for field, value in data.items():
            if field == 'record_id':
                continue
            if hasattr(record, field):
                if field.endswith('_cm') and value:
                    setattr(record, field, float(value))
                elif field in ['quantity'] and value:
                    setattr(record, field, int(value))
                elif field in ['price_gross', 'delivery_cost', 'paid_amount_net'] and value:
                    setattr(record, field, float(value))
                elif field == 'date_created' and value:
                    setattr(record, field, datetime.strptime(value, '%Y-%m-%d').date())
                else:
                    setattr(record, field, value)
        
        # Przelicz order_amount_net dla ręcznych rekordów
        if record.price_gross:
            record.order_amount_net = float(record.price_gross) / 1.23
        
        # Przelicz pola pochodne
        record.calculate_fields()
        record.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        reports_logger.info("Zaktualizowano ręczny wiersz",
                          user_email=user_email,
                          record_id=record_id)
        
        return jsonify({
            'success': True,
            'message': 'Wiersz został zaktualizowany'
        })
        
    except Exception as e:
        db.session.rollback()
        reports_logger.error("Błąd edycji ręcznego wiersza",
                           user_email=user_email,
                           record_id=record_id if 'record_id' in locals() else None,
                           error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@reports_bp.route('/api/export-excel')
@login_required
def api_export_excel():
    """
    API endpoint do eksportu danych do Excel
    """
    user_email = session.get('user_email')
    
    try:
        # Pobierz parametry filtrów
        date_from_str = request.args.get('date_from')
        date_to_str = request.args.get('date_to')
        
        # Parsuj daty
        date_from = None
        date_to = None
        
        if date_from_str:
            try:
                date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
            except ValueError:
                pass
                
        if date_to_str:
            try:
                date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
            except ValueError:
                pass
        
        # Pobierz filtry kolumn
        column_filters = {}
        for key, values in request.args.items(multi=True):
            if key.startswith('filter_') and values:
                column_name = key.replace('filter_', '')
                if hasattr(BaselinkerReportOrder, column_name):
                    if column_name not in column_filters:
                        column_filters[column_name] = []
                    column_filters[column_name].extend(values if isinstance(values, list) else [values])
        
        # Wyczyść puste wartości
        for column_name in list(column_filters.keys()):
            column_filters[column_name] = [v for v in column_filters[column_name] if v and v.strip()]
            if not column_filters[column_name]:
                del column_filters[column_name]
        
        reports_logger.info("Eksport do Excel",
                          user_email=user_email,
                          date_from=date_from.isoformat() if date_from else None,
                          date_to=date_to.isoformat() if date_to else None,
                          filters_count=len(column_filters))
        
        # Pobierz dane
        query = BaselinkerReportOrder.get_filtered_orders(
            filters=column_filters,
            date_from=date_from,
            date_to=date_to
        )
        orders = query.all()
        
        if not orders:
            return jsonify({
                'success': False,
                'error': 'Brak danych do eksportu'
            }), 400
        
        # Przygotuj dane do DataFrame
        excel_data = []
        for order in orders:
            excel_data.append({
                'Data': order.date_created.strftime('%d-%m-%Y') if order.date_created else '',
                'TTL m3': float(order.total_volume or 0),
                'Kwota zamówień netto': float(order.order_amount_net or 0),
                'Numer zamówienia Baselinker': order.baselinker_order_id or '',
                'Numer wew. zamówienia': order.internal_order_number or '',
                'Imię i nazwisko': order.customer_name or '',
                'Kod pocztowy dostawy': order.delivery_postcode or '',
                'Miejscowość dostawy': order.delivery_city or '',
                'Ulica i numer': order.delivery_address or '',
                'Województwo dostawy': order.delivery_state or '',
                'Numer telefonu': order.phone or '',
                'Opiekun': order.caretaker or '',
                'Metoda dostawy': order.delivery_method or '',
                'Źródło zamówienia': order.order_source or '',
                'Grupa': order.group_type or '',
                'Rodzaj': order.product_type or '',
                'Stan': order.finish_state or '',
                'Gatunek': order.wood_species or '',
                'Technologia': order.technology or '',
                'Klasa': order.wood_class or '',
                'Długość': float(order.length_cm or 0),
                'Szerokość': float(order.width_cm or 0),
                'Grubość': float(order.thickness_cm or 0),
                'Ilość': order.quantity or 0,
                'Cena brutto': float(order.price_gross or 0),
                'Cena netto': float(order.price_net or 0),
                'Wartość brutto': float(order.value_gross or 0),
                'Wartość netto': float(order.value_net or 0),
                'Objętość 1 szt.': float(order.volume_per_piece or 0),
                'Objętość TTL': float(order.total_volume or 0),
                'Cena za m3': float(order.price_per_m3 or 0),
                'Data realizacji': order.realization_date.strftime('%d-%m-%Y') if order.realization_date else '',
                'Status': order.current_status or '',
                'Koszt kuriera': float(order.delivery_cost or 0),
                'Sposób płatności': order.payment_method or '',
                'Zapłacono TTL netto': float(order.paid_amount_net or 0),
                'Saldo': float(order.balance_due or 0),
                'Ilość w produkcji': float(order.production_volume or 0),
                'Wartość netto w produkcji': float(order.production_value_net or 0),
                'Ilość gotowa do odbioru': float(order.ready_pickup_volume or 0)
            })
        
        # Utwórz DataFrame
        df = pd.DataFrame(excel_data)
        
        # Utwórz plik Excel w pamięci
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='Raporty', index=False)
        
        output.seek(0)
        
        # Nazwa pliku
        filename = f"raporty_sprzedazy_{datetime.now().strftime('%d-%m-%Y_%H%M%S')}.xlsx"
        
        reports_logger.info("Wygenerowano eksport Excel",
                          user_email=user_email,
                          records_count=len(excel_data),
                          filename=filename)
        
        return Response(
            output.getvalue(),
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"',
                'Content-Length': len(output.getvalue())
            }
        )
        
    except Exception as e:
        reports_logger.error("Błąd eksportu Excel",
                           user_email=user_email,
                           error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@reports_bp.route('/api/dropdown-values/<field_name>')
@login_required
def api_get_dropdown_values(field_name):
    """
    API endpoint do pobierania unikalnych wartości dla dropdown'ów
    """
    try:
        if not hasattr(BaselinkerReportOrder, field_name):
            return jsonify({'success': False, 'error': 'Nieprawidłowe pole'}), 400
        
        # Pobierz unikalne wartości z bazy (wykluczając anulowane i nieopłacone)
        excluded_statuses = ['Zamówienie anulowane', 'Nowe - nieopłacone']
        column = getattr(BaselinkerReportOrder, field_name)
        
        query = db.session.query(column)\
            .filter(column.isnot(None))\
            .filter(~BaselinkerReportOrder.current_status.in_(excluded_statuses))\
            .distinct()
        
        values = query.all()
        
        # Wyciągnij wartości z tupli
        unique_values = sorted([value[0] for value in values if value[0]])
        
        return jsonify({
            'success': True,
            'values': unique_values
        })
        
    except Exception as e:
        reports_logger.error("Błąd pobierania dropdown values",
                           field_name=field_name,
                           error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ===== FUNKCJE POMOCNICZE =====

def _sync_selected_orders(service: BaselinkerReportsService, order_ids: List[int]) -> Dict:
    """
    Synchronizuje wybrane zamówienia
    """
    try:
        orders = []
        for order_id in order_ids:
            order = service.get_order_details(order_id)
            if order:
                orders.append(order)
        
        if orders:
            added_count = service.add_orders_to_database(orders)
            return {
                'success': True,
                'message': f'Zsynchronizowano {len(orders)} zamówień',
                'orders_processed': len(orders),
                'orders_added': added_count,
                'orders_updated': 0
            }
        else:
            return {
                'success': False,
                'error': 'Nie udało się pobrać wybranych zamówień'
            }
            
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

# Synchronizacja statusów
@reports_bp.route('/api/sync-statuses', methods=['POST'])
@login_required
def api_sync_statuses():
    """
    API endpoint do synchronizacji statusów zamówień z Baselinker
    """
    user_email = session.get('user_email')
    
    try:
        reports_logger.info("Rozpoczęcie synchronizacji statusów",
                          user_email=user_email)
        
        # Pobierz serwis
        service = get_reports_service()
        
        # Pobierz zamówienia które mogą być synchronizowane (bez finalnych statusów)
        excluded_statuses = [
            'Dostarczona - kurier',
            'Dostarczona - trans. WoodPower', 
            'Dostarczona - transport WoodPower',
            'Odebrane',
            'Odebrana',
            'Zamówienie anulowane',
            'Anulowane'
        ]
        
        # Pobierz zamówienia z bazy które nie mają finalnego statusu
        orders_to_sync = BaselinkerReportOrder.query.filter(
            BaselinkerReportOrder.baselinker_order_id.isnot(None),
            ~BaselinkerReportOrder.current_status.in_(excluded_statuses)
        ).all()
        
        if not orders_to_sync:
            return jsonify({
                'success': True,
                'message': 'Brak zamówień do synchronizacji statusów',
                'orders_processed': 0,
                'orders_updated': 0
            })
        
        # Grupuj zamówienia według baselinker_order_id
        unique_order_ids = list(set(order.baselinker_order_id for order in orders_to_sync))
        
        reports_logger.info("Synchronizacja statusów zamówień",
                          unique_orders=len(unique_order_ids),
                          total_records=len(orders_to_sync))
        
        # Synchronizuj statusy
        updated_count = 0
        processed_count = 0
        payment_updated_count = 0
        status_updated_count = 0
        sync_start = datetime.utcnow()
        
        for order_id in unique_order_ids:
            try:
                # Pobierz aktualny status z Baselinker
                order_details = service.get_order_details(order_id)
                
                if order_details:
                    # Pobierz nowy status
                    new_status_id = order_details.get('order_status_id')
                    new_status = service.status_map.get(new_status_id, f'Status {new_status_id}')
                    
                    # Pobierz kwotę zapłaconą (brutto -> netto)
                    payment_done_gross = order_details.get('payment_done', 0)
                    new_paid_amount_net = float(payment_done_gross) / 1.23 if payment_done_gross else 0
                    
                    # Pobierz sposób płatności
                    payment_method = order_details.get('payment_method', '')
                    
                    # Sprawdź czy status lub płatność się zmieniły
                    order_records = BaselinkerReportOrder.query.filter_by(
                        baselinker_order_id=order_id
                    ).all()
                    
                    for record in order_records:
                        record_updated = False
                        
                        # Sprawdź zmianę statusu
                        if record.current_status != new_status:
                            record.current_status = new_status
                            record.baselinker_status_id = new_status_id
                            record.updated_at = datetime.utcnow()
                            
                            # Przelicz pola produkcji na podstawie nowego statusu
                            record.update_production_fields()
                            
                            record_updated = True
                            status_updated_count += 1
                            
                            reports_logger.info(f"Zaktualizowano status zamówienia {order_id}: {record.current_status} -> {new_status}")
                        
                        # Sprawdź zmianę płatności (tolerance 0.01 zł)
                        current_paid = float(record.paid_amount_net or 0)
                        if abs(current_paid - new_paid_amount_net) > 0.01:
                            old_paid = record.paid_amount_net
                            record.paid_amount_net = new_paid_amount_net
                            record.updated_at = datetime.utcnow()
                            
                            # Przelicz saldo (kwota zamówienia netto - zapłacono netto)
                            if record.order_amount_net is not None:
                                record.balance_due = float(record.order_amount_net) - new_paid_amount_net
                            
                            record_updated = True
                            payment_updated_count += 1
                            
                            reports_logger.info(f"Zaktualizowano płatność zamówienia {order_id}: {old_paid} -> {new_paid_amount_net} zł netto")
                        
                        # Sprawdź zmianę metody płatności
                        if record.payment_method != payment_method and payment_method:
                            record.payment_method = payment_method
                            record.updated_at = datetime.utcnow()
                            record_updated = True
                            
                            reports_logger.info(f"Zaktualizowano metodę płatności zamówienia {order_id}: {payment_method}")
                        
                        if record_updated:
                            updated_count += 1
                    
                    processed_count += 1
                    
                    # Commit co 10 zamówień dla lepszej wydajności
                    if processed_count % 10 == 0:
                        db.session.commit()
                        reports_logger.info(f"Przetworzono {processed_count}/{len(unique_order_ids)} zamówień...")
                        
                else:
                    reports_logger.warning("Nie udało się pobrać szczegółów zamówienia",
                                         order_id=order_id)
                    
            except Exception as e:
                reports_logger.error("Błąd synchronizacji zamówienia",
                                   order_id=order_id,
                                   error=str(e))
                continue
        
        # Finalny commit
        db.session.commit()
        
        # Zapisz log synchronizacji z dodatkowymi informacjami
        duration = int((datetime.utcnow() - sync_start).total_seconds())
        sync_log = ReportsSyncLog(
            sync_type='status_sync',
            orders_processed=processed_count,
            orders_added=0,
            orders_updated=updated_count,
            status='success',
            duration_seconds=duration
        )
        db.session.add(sync_log)
        db.session.commit()
        
        reports_logger.info("Synchronizacja statusów i płatności zakończona",
                          user_email=user_email,
                          orders_processed=processed_count,
                          orders_updated=updated_count,
                          status_updated=status_updated_count,
                          payment_updated=payment_updated_count)
        
        return jsonify({
            'success': True,
            'message': f'Synchronizacja zakończona pomyślnie',
            'orders_processed': processed_count,
            'orders_updated': updated_count,
            'status_updated': status_updated_count,
            'payment_updated': payment_updated_count,
            'unique_orders': len(unique_order_ids)
        })
        
    except Exception as e:
        # Zapisz błąd do logów
        duration = int((datetime.utcnow() - sync_start).total_seconds()) if 'sync_start' in locals() else 0
        sync_log = ReportsSyncLog(
            sync_type='status_sync',
            status='error',
            error_message=str(e),
            duration_seconds=duration
        )
        db.session.add(sync_log)
        db.session.commit()
        
        reports_logger.error("Błąd synchronizacji statusów",
                           user_email=user_email,
                           error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500