# modules/reports/routers.py
"""
Endpointy Flask dla modułu Reports
"""
import csv
import re
import os
os.environ['OPENBLAS_NUM_THREADS'] = '1'
import pandas as pd
import io
import sys
from flask import render_template, jsonify, request, session, redirect, url_for, flash, Response, make_response
from datetime import datetime, timedelta, date
from functools import wraps
from typing import List, Dict
from extensions import db
from . import reports_bp
from .models import BaselinkerReportOrder, ReportsSyncLog
from .service import BaselinkerReportsService, get_reports_service
from modules.logging import get_structured_logger
from collections import defaultdict

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
        # ZMIANA: Sprawdź wszystkie nowe zamówienia, nie tylko z ostatnich 48h
        service = get_reports_service()
        
        # Sprawdź nowe zamówienia z ostatnich 4 dni
        try:
            # Pobierz wszystkie zamówienia z Baselinker
            date_from_4_days = datetime.now() - timedelta(days=4)
            orders = service.fetch_orders_from_baselinker(date_from=date_from_4_days)
            
            if orders:
                # Sprawdź które są nowe
                order_ids = [order['order_id'] for order in orders]
                existing_ids = service._get_existing_order_ids(order_ids)
                new_orders_count = len(order_ids) - len(existing_ids)
                has_new_orders = new_orders_count > 0
                
                reports_logger.info("Sprawdzenie nowych zamówień na stronie głównej",
                                  user_email=user_email,
                                  total_orders_from_baselinker=len(orders),
                                  existing_in_database=len(existing_ids),
                                  new_orders_count=new_orders_count,
                                  has_new_orders=has_new_orders,
                                  api_limit_reached=len(orders) >= 100)
                
                # UWAGA: Jeśli API zwrócił 100 zamówień, może być więcej
                if len(orders) >= 100:
                    reports_logger.warning("Limit API Baselinker osiągnięty na stronie głównej (4 dni)",
                                         user_email=user_email,
                                         orders_returned=len(orders),
                                         api_limit=100,
                                         info="Może być więcej nowych zamówień z ostatnich 4 dni niż pokazane")
            else:
                has_new_orders = False
                new_orders_count = 0
                reports_logger.info("Brak zamówień w Baselinker", user_email=user_email)
                
        except Exception as e:
            # POPRAWKA: Nie resetuj has_new_orders w przypadku błędu logowania
            reports_logger.error("Błąd sprawdzania nowych zamówień na stronie głównej",
                               user_email=user_email,
                               error=str(e),
                               error_type=type(e).__name__)
            
            # ZMIANA: W przypadku błędu, spróbuj prostszą metodę
            try:
                # Pobierz ostatnie 24h jako fallback
                date_from_fallback = datetime.now() - timedelta(hours=24)
                orders_fallback = service.fetch_orders_from_baselinker(date_from=date_from_fallback)
                
                if orders_fallback:
                    order_ids = [order['order_id'] for order in orders_fallback]
                    existing_ids = service._get_existing_order_ids(order_ids)
                    new_orders_count = len(order_ids) - len(existing_ids)
                    has_new_orders = new_orders_count > 0
                    
                    reports_logger.info("Fallback: Sprawdzenie zamówień z ostatnich 4 dni",
                                      user_email=user_email,
                                      fallback_orders=len(orders_fallback),
                                      new_orders_count=new_orders_count,
                                      has_new_orders=has_new_orders)
                else:
                    has_new_orders = False
                    new_orders_count = 0
                    
            except Exception as fallback_error:
                reports_logger.error("Błąd fallback sprawdzania zamówień",
                                   user_email=user_email,
                                   error=str(fallback_error))
                has_new_orders = False
                new_orders_count = 0
        
        # Pobierz podstawowe statystyki - ZMIANA: Domyślnie wszystkie dane
        date_from = None  # datetime.now().date() - timedelta(days=30)
        date_to = None    # datetime.now().date()
        
        reports_logger.info("Ładowanie statystyk Reports",
                          user_email=user_email,
                          date_from=date_from.isoformat() if date_from else "wszystkie",
                          date_to=date_to.isoformat() if date_to else "wszystkie")
        
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
            reports_logger.info("Brak danych w bazie - wyświetlanie pustych statystyk",
                              user_email=user_email)
        else:
            # Pobierz dane dla całej bazy lub wybranego zakresu dat
            query = BaselinkerReportOrder.get_filtered_orders(
                date_from=date_from,
                date_to=date_to
            )
            
            # Sprawdź czy query zwraca jakieś dane
            query_results = query.all()
            
            if not query_results:
                # Brak danych dla wybranego zakresu - ustaw puste statystyki
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
                reports_logger.info("Brak danych dla wybranego zakresu",
                                  user_email=user_email,
                                  total_records_in_db=total_records)
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
                        reports_logger.warning("Błąd obliczania porównań", 
                                             user_email=user_email,
                                             error=str(comp_error))
                        comparison = {}
                
                reports_logger.info("Obliczono statystyki",
                                  user_email=user_email,
                                  records_count=len(query_results),
                                  total_m3=stats.get('total_m3', 0),
                                  order_amount_net=stats.get('order_amount_net', 0))
        
        # Pobierz ostatni log synchronizacji
        last_sync = ReportsSyncLog.query.order_by(ReportsSyncLog.sync_date.desc()).first()
        
        # ZMIANA: Domyślne daty do wyświetlenia w interfejsie - ostatnie 30 dni dla wygody
        default_date_from = datetime.now().date() - timedelta(days=30)
        default_date_to = datetime.now().date()
        
        context = {
            'user_email': user_email,
            'has_new_orders': has_new_orders,
            'new_orders_count': new_orders_count,
            'api_limit_reached': len(orders) >= 100 if 'orders' in locals() else False,  # NOWE
            'stats': stats,
            'comparison': comparison,
            'last_sync': last_sync,
            'default_date_from': default_date_from.isoformat(),
            'default_date_to': default_date_to.isoformat(),
            'total_records': total_records
        }
        
        return render_template('reports.html', **context)
        
    except Exception as e:
        reports_logger.error("Błąd ładowania strony Reports", 
                           user_email=user_email, 
                           error=str(e),
                           error_type=type(e).__name__)
        flash("Wystąpił błąd podczas ładowania danych.")
        return redirect(url_for('home'))

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

            # DEBUGOWANIE SORTOWANIA - DODAJ TO:
            print(f"DEBUG SORTOWANIE: Sprawdzenie SQL query:")
            print(str(query))

            orders = query.all()

            print(f"DEBUG SORTOWANIE: Pierwsze 10 rekordów z bazy:")
            for i, order in enumerate(orders[:10]):
                print(f"  {i+1}. ID: {order.id}, is_manual: {order.is_manual}, data: {order.date_created}, baselinker_id: {order.baselinker_order_id}")

            # DEBUG: Dodane rozszerzone logowanie
            manual_orders = [o for o in orders if o.is_manual]
            all_manual_in_db = BaselinkerReportOrder.query.filter(BaselinkerReportOrder.is_manual == True).all()
            print(f"DEBUG: Zapytanie zwróciło {len(orders)} rekordów, z czego {len(manual_orders)} ręcznych")
            print(f"DEBUG: W całej bazie jest {len(all_manual_in_db)} rekordów ręcznych")
            print(f"DEBUG: Sortowanie - pierwsze 5 rekordów:")
            for i, order in enumerate(orders[:5]):
                print(f"  {i+1}. ID: {order.id}, is_manual: {order.is_manual}, status: {order.current_status}, data: {order.date_created}, klient: {order.customer_name}")

            if all_manual_in_db:
                print(f"DEBUG: Wszystkie rekordy ręczne w bazie:")
                for order in all_manual_in_db[-3:]:  # Ostatnie 3
                    print(f"  - ID: {order.id}, status: {order.current_status}, data: {order.date_created}")
            
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
        
        # ZMIANA: Parsuj daty tylko jeśli podane, nie używaj domyślnie 30 dni
        date_from = None
        if date_from_str:
            try:
                date_from = datetime.strptime(date_from_str, '%Y-%m-%d')
                reports_logger.info("Użyto podanej daty rozpoczęcia", 
                                  date_from=date_from.isoformat())
            except ValueError as e:
                reports_logger.warning("Błędny format daty, pominięto filtr daty",
                                     date_from_str=date_from_str,
                                     error=str(e))
                date_from = None
        
        reports_logger.info("Rozpoczęcie synchronizacji z Baselinker",
                          user_email=user_email,
                          date_from=date_from.isoformat() if date_from else "wszystkie zamówienia",
                          selected_orders_count=len(selected_orders),
                          selected_orders=selected_orders[:10])  # Loguj tylko pierwsze 10 ID
        
        # Pobierz serwis
        service = get_reports_service()
        
        if selected_orders and len(selected_orders) > 0:
            # Synchronizuj wybrane zamówienia
            reports_logger.info("Synchronizowanie wybranych zamówień", 
                              selected_orders_count=len(selected_orders))
            result = _sync_selected_orders(service, selected_orders)
        else:
            # ZMIANA: Synchronizuj wszystkie zamówienia (bez ograniczenia 30 dni)
            reports_logger.info("Synchronizowanie wszystkich zamówień",
                              has_date_filter=date_from is not None)
            result = service.sync_orders(date_from=date_from, sync_type='manual')
        
        reports_logger.info("Synchronizacja zakończona",
                          user_email=user_email,
                          success=result.get('success'),
                          orders_processed=result.get('orders_processed', 0),
                          orders_added=result.get('orders_added', 0),
                          orders_updated=result.get('orders_updated', 0))
        
        return jsonify(result)
        
    except Exception as e:
        reports_logger.error("Błąd synchronizacji",
                           user_email=user_email,
                           error=str(e),
                           error_type=type(e).__name__)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reports_bp.route('/api/add-manual-row', methods=['POST'])
@login_required
def api_add_manual_row():
    """
    ZAKTUALIZOWANY: API endpoint do dodawania ręcznego wiersza z obsługą produktów
    """
    user_email = session.get('user_email')
    
    try:
        data = request.get_json()
        
        reports_logger.info("Dodawanie ręcznego wiersza",
                          user_email=user_email,
                          data_keys=list(data.keys()) if data else None)
        
        # DEBUG: Wyloguj otrzymane dane
        reports_logger.debug("Otrzymane dane formularza",
                           user_email=user_email,
                           data=data)
        
        # NOWA LOGIKA: Obsługa produktów z nowej struktury
        products_data = data.get('products', [])
        
        if not products_data:
            # FALLBACK: Jeśli brak produktów, spróbuj stara struktura
            reports_logger.warning("Brak produktów w nowej strukturze, używam fallback",
                                 user_email=user_email)
            
            # Utwórz pojedynczy rekord (stara metoda)
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
                caretaker=user_email,
                delivery_method=data.get('delivery_method'),
                order_source=data.get('order_source'),
                group_type=data.get('group_type'),
                product_type=data.get('product_type', 'klejonka'),
                finish_state=data.get('finish_state', 'surowy'),
                wood_species=data.get('wood_species'),
                technology=data.get('technology'),
                wood_class=data.get('wood_class'),
                length_cm=float(data.get('length_cm', 0)) if data.get('length_cm') else None,
                width_cm=float(data.get('width_cm', 0)) if data.get('width_cm') else None,
                thickness_cm=float(data.get('thickness_cm', 0)) if data.get('thickness_cm') else None,
                quantity=int(data.get('quantity', 1)) if data.get('quantity') else 1,
                # ZMIANA: Obsługa price_net zamiast price_gross
                price_net=float(data.get('price_net', 0)) if data.get('price_net') else None,
                price_gross=float(data.get('price_net', 0)) * 1.23 if data.get('price_net') else None,
                delivery_cost=float(data.get('delivery_cost', 0)) if data.get('delivery_cost') else None,
                payment_method=data.get('payment_method'),
                paid_amount_net=float(data.get('paid_amount_net', 0)) if data.get('paid_amount_net') else 0,
                current_status=data.get('current_status', 'Nowe - opłacone'),
                order_amount_net=float(data.get('price_net', 0)) * int(data.get('quantity', 1)) if data.get('price_net') else 0
            )
            
            # Oblicz pola pochodne
            record.calculate_fields()
            
            # Zapisz do bazy
            db.session.add(record)
            db.session.commit()

            # DEBUG: Sprawdź zapisany rekord
            created_records = [record]
            for record in created_records:
                print(f"  - ID: {record.id}, is_manual: {record.is_manual}, status: {record.current_status}, data: {record.date_created}")

            # Sprawdź czy rekordy są w bazie
            fresh_records = BaselinkerReportOrder.query.filter(
                BaselinkerReportOrder.id.in_([r.id for r in created_records])
            ).all()
            
            reports_logger.info("Dodano ręczny wiersz (fallback)",
                              user_email=user_email,
                              record_id=record.id)
            
            return jsonify({
                'success': True,
                'message': 'Wiersz został dodany',
                'record_id': record.id
            })
            
        else:
            # NOWA LOGIKA: Obsługa wielu produktów
            reports_logger.info("Dodawanie zamówienia z produktami",
                              user_email=user_email,
                              products_count=len(products_data))
            
            created_records = []
            
            for i, product_data in enumerate(products_data):
                reports_logger.debug(f"Przetwarzanie produktu {i+1}",
                                   user_email=user_email,
                                   product_data=product_data)
                
                # Utwórz rekord dla każdego produktu
                record = BaselinkerReportOrder(
                    is_manual=True,
                    
                    # Wspólne dane zamówienia
                    date_created=datetime.strptime(data.get('date_created'), '%Y-%m-%d').date() if data.get('date_created') else date.today(),
                    internal_order_number=data.get('internal_order_number'),
                    customer_name=data.get('customer_name'),
                    delivery_postcode=data.get('delivery_postcode'),
                    delivery_city=data.get('delivery_city'),
                    delivery_address=data.get('delivery_address'),
                    delivery_state=data.get('delivery_state'),
                    phone=data.get('phone'),
                    caretaker=user_email,
                    delivery_method=data.get('delivery_method'),
                    order_source=data.get('order_source'),
                    delivery_cost=float(data.get('delivery_cost', 0)) if data.get('delivery_cost') else None,
                    payment_method=data.get('payment_method'),
                    paid_amount_net=float(data.get('paid_amount_net', 0)) if data.get('paid_amount_net') else 0,
                    current_status=data.get('current_status', 'Nowe - opłacone'),
                    
                    # Dane produktu
                    group_type=product_data.get('group_type'),
                    product_type=product_data.get('product_type'),
                    finish_state=product_data.get('finish_state', 'surowy'),
                    wood_species=product_data.get('wood_species'),
                    technology=product_data.get('technology'),
                    wood_class=product_data.get('wood_class'),
                    length_cm=float(product_data.get('length_cm', 0)) if product_data.get('length_cm') else None,
                    width_cm=float(product_data.get('width_cm', 0)) if product_data.get('width_cm') else None,
                    thickness_cm=float(product_data.get('thickness_cm', 0)) if product_data.get('thickness_cm') else None,
                    quantity=int(product_data.get('quantity', 1)) if product_data.get('quantity') else 1,
                    
                    # ZMIANA: Obsługa price_net z produktu
                    price_net=float(product_data.get('price_net', 0)) if product_data.get('price_net') else None,
                    price_gross=float(product_data.get('price_net', 0)) * 1.23 if product_data.get('price_net') else None,
                    order_amount_net=float(product_data.get('price_net', 0)) * int(product_data.get('quantity', 1)) if product_data.get('price_net') else 0
                )
                
                # Oblicz pola pochodne
                record.calculate_fields()
                
                # Dodaj do sesji
                db.session.add(record)
                created_records.append(record)
            
            # Zapisz wszystkie rekordy
            db.session.commit()

            # Sprawdź czy rekordy są w bazie
            fresh_records = BaselinkerReportOrder.query.filter(
                BaselinkerReportOrder.id.in_([r.id for r in created_records])
            ).all()
            
            # Pobierz ID wszystkich utworzonych rekordów
            record_ids = [record.id for record in created_records]
            
            reports_logger.info("Dodano zamówienie wieloproduktowe",
                              user_email=user_email,
                              products_count=len(created_records),
                              record_ids=record_ids)
            
            return jsonify({
                'success': True,
                'message': f'Zamówienie z {len(created_records)} produktami zostało dodane',
                'record_ids': record_ids,
                'products_count': len(created_records)
            })
        
    except Exception as e:
        db.session.rollback()
        reports_logger.error("Błąd dodawania ręcznego wiersza",
                           user_email=user_email,
                           error=str(e),
                           error_type=type(e).__name__)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reports_bp.route('/api/update-manual-row', methods=['POST'])
@login_required
def api_update_manual_row():
    """
    ZAKTUALIZOWANY: API endpoint do edycji rekordów z obsługą wielu produktów
    """
    user_email = session.get('user_email')
    
    try:
        data = request.get_json()
        record_id = data.get('record_id')
        
        if not record_id:
            return jsonify({'success': False, 'error': 'Brak ID rekordu'}), 400
        
        # Pobierz główny rekord
        main_record = BaselinkerReportOrder.query.get_or_404(record_id)
        
        record_type = "ręczny" if main_record.is_manual else "z Baselinker"
        reports_logger.info(f"Edycja rekordu ({record_type})",
                          user_email=user_email,
                          record_id=record_id)
        
        # NOWA LOGIKA: Obsługa wielu produktów
        products_data = data.get('products', [])

        if products_data and len(products_data) > 1:
            # WIELOPRODUKTOWE ZAMÓWIENIE (głównie z Baselinker)
            reports_logger.info(f"Aktualizacja zamówienia wieloproduktowego",
                              user_email=user_email,
                              record_id=record_id,
                              products_count=len(products_data))
            
            # Pobierz wszystkie rekordy tego zamówienia
            if main_record.baselinker_order_id:
                all_order_records = BaselinkerReportOrder.query.filter_by(
                    baselinker_order_id=main_record.baselinker_order_id
                ).all()
            else:
                all_order_records = [main_record]
            
            # Utwórz mapę istniejących rekordów po ID
            existing_records_map = {record.id: record for record in all_order_records}
            
            updated_records = []
            
            for product_data in products_data:
                product_record_id = product_data.get('record_id')
                
                if product_record_id and product_record_id in existing_records_map:
                    # Aktualizuj istniejący rekord produktu
                    record = existing_records_map[product_record_id]
                    
                    # Aktualizuj wspólne dane zamówienia (z pierwszego produktu)
                    if record == main_record:
                        _update_order_common_fields(record, data)
                    
                    # Aktualizuj dane produktu
                    _update_product_fields(record, product_data)
                    
                    updated_records.append(record)
                    
                else:
                    # TO-DO: Obsługa nowych produktów (jeśli będzie potrzebna)
                    reports_logger.warning("Próba dodania nowego produktu do istniejącego zamówienia",
                                         user_email=user_email,
                                         main_record_id=record_id,
                                         product_data=product_data)
            
            # Przelicz pola dla wszystkich zaktualizowanych rekordów
            for record in updated_records:
                record.calculate_fields()
                record.updated_at = datetime.utcnow()
            
            db.session.commit()
            
            reports_logger.info("Zaktualizowano zamówienie wieloproduktowe",
                              user_email=user_email,
                              main_record_id=record_id,
                              updated_products_count=len(updated_records))
            
            return jsonify({
                'success': True,
                'message': f'Zamówienie z {len(updated_records)} produktami zostało zaktualizowane',
                'updated_products': len(updated_records)
            })
            
        else:
            # JEDNOPRODUKTOWE ZAMÓWIENIE (ręczne lub pojedynczy produkt z Baselinker)
            _update_order_common_fields(main_record, data)
            
            if products_data and len(products_data) > 0:
                _update_product_fields(main_record, products_data[0])
            
            # Przelicz pola
            main_record.calculate_fields()
            main_record.updated_at = datetime.utcnow()
            
            db.session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Rekord został zaktualizowany',
                'record_id': main_record.id
            })
        
    except Exception as e:
        db.session.rollback()
        reports_logger.error("Błąd aktualizacji rekordu",
                           user_email=user_email,
                           record_id=record_id,
                           error=str(e))
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def _update_order_common_fields(record, data):
    """
    Pomocnicza funkcja do aktualizacji wspólnych pól zamówienia
    """
    common_fields = [
        'date_created', 'baselinker_order_id', 'internal_order_number', 'customer_name', 
        'delivery_postcode', 'delivery_city', 'delivery_address', 'delivery_state',
        'phone', 'caretaker', 'delivery_method', 'order_source',
        'delivery_cost', 'payment_method', 'paid_amount_net', 'current_status'
    ]
    
    for field in common_fields:
        if field in data and data[field] is not None:
            value = data[field]
            if field == 'date_created' and value:
                setattr(record, field, datetime.strptime(value, '%Y-%m-%d').date())
            elif field in ['delivery_cost', 'paid_amount_net'] and value:
                setattr(record, field, float(value))
            else:
                setattr(record, field, value)

def _update_product_fields(record, product_data):
    """
    Pomocnicza funkcja do aktualizacji pól produktu
    """
    product_fields = {
        'group_type': str,
        'product_type': str,
        'wood_species': str,
        'technology': str,
        'wood_class': str,
        'finish_state': str,
        'length_cm': float,
        'width_cm': float,
        'thickness_cm': float,
        'quantity': int,
        'price_net': float,
        # NOWE POLA:
        'price_type': str,                      # Typ ceny: 'netto', 'brutto', ''
        'original_amount_from_baselinker': float  # Oryginalna kwota z BL
    }
    
    for field, field_type in product_fields.items():
        if field in product_data and product_data[field] is not None:
            value = product_data[field]
            
            if field == 'price_net' and value:
                # Konwersja price_net na price_gross
                price_net = float(value)
                setattr(record, 'price_gross', price_net * 1.23)
                # Ustaw order_amount_net na podstawie price_net i quantity
                quantity = int(product_data.get('quantity', record.quantity or 1))
                setattr(record, 'order_amount_net', price_net * quantity)
            elif field == 'original_amount_from_baselinker' and value:
                # NOWE: Obsługa oryginalnej kwoty z Baselinker
                setattr(record, field, float(value))
            elif field == 'price_type' and value:
                # NOWE: Obsługa typu ceny
                # Normalizuj wartość
                normalized_value = value.strip().lower()
                if normalized_value in ['netto', 'brutto', '']:
                    setattr(record, field, normalized_value)
                else:
                    # Jeśli nieznana wartość, ustaw jako puste
                    setattr(record, field, '')
            elif field_type == float and value:
                setattr(record, field, float(value))
            elif field_type == int and value:
                setattr(record, field, int(value))
            elif field_type == str:
                setattr(record, field, str(value) if value else None)

@reports_bp.route('/api/export-excel')
@login_required
def api_export_excel():
    """
    API endpoint do eksportu danych do Excel z zaawansowanym formatowaniem
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
        
        # Utwórz plik Excel w pamięci
        output = io.BytesIO()
        
        # Import dla stylow Excel
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils.dataframe import dataframe_to_rows
        from openpyxl.utils import get_column_letter
        from openpyxl.worksheet.table import Table, TableStyleInfo
        
        # Utwórz workbook
        workbook = Workbook()
        
        # ===== ARKUSZ 1: DANE SZCZEGÓŁOWE =====
        ws_details = workbook.active
        ws_details.title = "Dane szczegółowe"

        # NOWE: Oblicz TTL m³ dla każdego zamówienia
        order_volumes = {}
        for order in orders:
            # Identyfikator zamówienia (Baselinker ID lub manual ID)
            order_key = order.baselinker_order_id or f"manual_{order.id}"

            if order_key not in order_volumes:
                order_volumes[order_key] = 0.0

            # Dodaj objętość tego produktu do sumy zamówienia
            order_volumes[order_key] += float(order.total_volume or 0)

        # Przygotuj dane do DataFrame
        excel_data = []
        for order in orders:
            # TUTAJ definiuj calculated_ttl_m3 dla każdego rekordu
            order_key = order.baselinker_order_id or f"manual_{order.id}"
            calculated_ttl_m3 = order_volumes.get(order_key, 0.0)
    
            excel_data.append({
                'Data': order.date_created.strftime('%d-%m-%Y') if order.date_created else '',
                'TTL m³': calculated_ttl_m3,  # TERAZ TO BĘDZIE DZIAŁAĆ
                'Kwota zamówień netto': float(order.order_amount_net or 0),
                'Nr Baselinker': order.baselinker_order_id or '',
                'Nr wew.': order.internal_order_number or '',
                'Imię i nazwisko': order.customer_name or '',
                'Kod pocztowy': order.delivery_postcode or '',
                'Miejscowość': order.delivery_city or '',
                'Ulica': order.delivery_address or '',
                'Województwo': order.delivery_state or '',
                'Telefon': order.phone or '',
                'Opiekun': order.caretaker or '',
                'Dostawa': order.delivery_method or '',
                'Źródło': order.order_source or '',
                'Grupa': order.group_type or '',
                'Rodzaj': order.product_type or '',
                'Wykończenie': order.finish_state or '',
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
                'Cena za m³': float(order.price_per_m3 or 0),
                'Data realizacji': order.realization_date.strftime('%d-%m-%Y') if order.realization_date else '',
                'Status': order.current_status or '',
                'Koszt kuriera': float(order.delivery_cost or 0),
                'Sposób płatności': order.payment_method or '',
                'Zapłacono netto': float(order.paid_amount_net or 0),
                'Saldo': float(order.balance_due or 0),
                'Ilość w produkcji': float(order.production_volume or 0),
                'Wartość w produkcji': float(order.production_value_net or 0),
                'Gotowe do odbioru': float(order.ready_pickup_volume or 0)
            })
        
        # Utwórz DataFrame
        df = pd.DataFrame(excel_data)
        
        # ===== DEFINICJA KOLORÓW (PASTELOWE) =====
        COLORS = {
            'order_data': 'E3F2FD',      # Jasny niebieski
            'customer_data': 'E8F5E8',   # Jasny zielony  
            'logistics_data': 'FFF9C4',  # Jasny żółty
            'product_data': 'FFE0B2',    # Jasny pomarańczowy
            'financial_data': 'F3E5F5',  # Jasny fioletowy
            'production_data': 'F5F5F5'  # Jasny szary
        }
        
        # Mapowanie kolumn do kolorów
        COLUMN_COLORS = {
            'Data': 'order_data',
            'TTL m³': 'order_data',
            'Kwota zamówień netto': 'order_data',
            'Nr Baselinker': 'order_data',
            'Nr wew.': 'order_data',
            'Imię i nazwisko': 'customer_data',
            'Kod pocztowy': 'customer_data',
            'Miejscowość': 'customer_data',
            'Ulica': 'customer_data',
            'Województwo': 'customer_data',
            'Telefon': 'customer_data',
            'Opiekun': 'customer_data',
            'Dostawa': 'logistics_data',
            'Źródło': 'logistics_data',
            'Status': 'logistics_data',
            'Sposób płatności': 'logistics_data',
            'Grupa': 'product_data',
            'Rodzaj': 'product_data',
            'Wykończenie': 'product_data',
            'Gatunek': 'product_data',
            'Technologia': 'product_data',
            'Klasa': 'product_data',
            'Długość': 'product_data',
            'Szerokość': 'product_data',
            'Grubość': 'product_data',
            'Ilość': 'product_data',
            'Cena brutto': 'financial_data',
            'Cena netto': 'financial_data',
            'Wartość brutto': 'financial_data',
            'Wartość netto': 'financial_data',
            'Cena za m³': 'financial_data',
            'Koszt kuriera': 'financial_data',
            'Zapłacono netto': 'financial_data',
            'Saldo': 'financial_data',
            'Objętość 1 szt.': 'production_data',
            'Objętość TTL': 'production_data',
            'Data realizacji': 'production_data',
            'Ilość w produkcji': 'production_data',
            'Wartość w produkcji': 'production_data',
            'Gotowe do odbioru': 'production_data'
        }
        
        # Kolumny liczbowe dla formuł podsumowania
        NUMERIC_COLUMNS = {
            'TTL m³': 'SUM',
            'Kwota zamówień netto': 'SUM',
            'Długość': 'AVERAGE',
            'Szerokość': 'AVERAGE', 
            'Grubość': 'AVERAGE',
            'Ilość': 'SUM',
            'Cena brutto': 'SUM',
            'Cena netto': 'SUM',
            'Wartość brutto': 'SUM',
            'Wartość netto': 'SUM',
            'Objętość 1 szt.': 'AVERAGE',
            'Objętość TTL': 'SUM',
            'Cena za m³': 'AVERAGE',
            'Koszt kuriera': 'SUM',
            'Zapłacono netto': 'SUM',
            'Saldo': 'SUM',
            'Ilość w produkcji': 'SUM',
            'Wartość w produkcji': 'SUM',
            'Gotowe do odbioru': 'SUM'
        }
        
        # Stylizacja
        header_font = Font(bold=True, color='FFFFFF')
        summary_font = Font(bold=True, color='333333')
        header_alignment = Alignment(horizontal='center', vertical='center')
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        # ===== FORMATOWANIE ARKUSZA GŁÓWNEGO =====
        def format_details_sheet(worksheet, dataframe):
            # Wyczyść arkusz
            worksheet.delete_rows(1, worksheet.max_row)
            
            expected_columns = [
            'Data', 'TTL m³', 'Kwota zamówień netto', 'Nr Baselinker', 'Nr wew.',
            'Imię i nazwisko', 'Kod pocztowy', 'Miejscowość', 'Ulica', 'Województwo',
            'Telefon', 'Opiekun', 'Dostawa', 'Źródło', 'Grupa', 'Rodzaj',
            'Wykończenie', 'Gatunek', 'Technologia', 'Klasa', 'Długość', 'Szerokość',
            'Grubość', 'Ilość', 'Cena brutto', 'Cena netto', 'Wartość brutto', 'Wartość netto',
            'Objętość 1 szt.', 'Objętość TTL', 'Cena za m³', 'Data realizacji', 'Status',
            'Koszt kuriera', 'Sposób płatności', 'Zapłacono netto', 'Saldo',
            'Ilość w produkcji', 'Wartość w produkcji', 'Gotowe do odbioru'
            ]
        
            # Sprawdź czy kolumny się zgadzają
            actual_columns = list(dataframe.columns)
            if actual_columns != expected_columns:
                print(f"UWAGA: Kolejność kolumn nie zgadza się!")
                print(f"Oczekiwane: {expected_columns}")
                print(f"Aktualne: {actual_columns}")

            # WIERSZ 1: NAGŁÓWKI
            headers = list(dataframe.columns)
            for col_idx, header in enumerate(headers, 1):
                cell = worksheet.cell(row=1, column=col_idx, value=header)
                cell.font = header_font
                cell.alignment = header_alignment
                cell.border = border
                
                # Kolor tła nagłówka
                color_key = COLUMN_COLORS.get(header, 'order_data')
                # Ciemniejszy odcień dla nagłówka
                header_colors = {
                    'order_data': '1976D2',
                    'customer_data': '388E3C',
                    'logistics_data': 'F57C00',
                    'product_data': 'F57C00',
                    'financial_data': '7B1FA2',
                    'production_data': '616161'
                }
                cell.fill = PatternFill(start_color=header_colors[color_key], end_color=header_colors[color_key], fill_type='solid')
            
            # WIERSZ 2: PODSUMOWANIA (FORMUŁY)
            data_start_row = 4  # Dane zaczynają się od wiersza 4
            data_end_row = data_start_row + len(dataframe) - 1
            
            for col_idx, header in enumerate(headers, 1):
                cell = worksheet.cell(row=2, column=col_idx)
                cell.font = summary_font
                cell.border = border
                
                # Kolor tła podsumowania (jaśniejszy niż nagłówek)
                color_key = COLUMN_COLORS.get(header, 'order_data')
                cell.fill = PatternFill(start_color=COLORS[color_key], end_color=COLORS[color_key], fill_type='solid')
                
                # Dodaj formułę dla kolumn liczbowych
                if header in NUMERIC_COLUMNS:
                    formula_type = NUMERIC_COLUMNS[header]
                    col_letter = get_column_letter(col_idx)
                    
                    # POPRAWKA: Specjalne formuły dla pól które mogą być duplikowane per zamówienie
                    scalable_fields = ['Kwota zamówień netto', 'Koszt kuriera', 'Zapłacono netto', 'Saldo']
                    
                    if header in scalable_fields and formula_type == 'SUM':
                        # Użyj SUMPRODUCT z COUNTIFS żeby sumować tylko raz na zamówienie
                        # Zakładamy że kolumna D (4) to Nr Baselinker
                        cell.value = f'=SUMPRODUCT((COUNTIFS($D${data_start_row}:$D${data_end_row},$D${data_start_row}:$D${data_end_row})=1)*({col_letter}{data_start_row}:{col_letter}{data_end_row}))'
                    elif formula_type == 'SUM':
                        cell.value = f'=SUM({col_letter}{data_start_row}:{col_letter}{data_end_row})'
                    elif formula_type == 'AVERAGE':
                        cell.value = f'=AVERAGE({col_letter}{data_start_row}:{col_letter}{data_end_row})'
                    
                    # Format liczbowy
                    if 'zł' in header or 'Kwota' in header or 'Wartość' in header or 'Cena' in header or 'Koszt' in header or 'Zapłacono' in header or 'Saldo' in header:
                        cell.number_format = '#,##0.00" zł"'
                    elif 'm³' in header or 'Objętość' in header:
                        cell.number_format = '#,##0.0000'
                    else:
                        cell.number_format = '#,##0.00'
                else:
                    # Dla kolumn tekstowych - informacje opisowe
                    if header == 'Data':
                        period_text = f"Okres: {date_from.strftime('%d-%m-%Y') if date_from else 'wszystkie'} - {date_to.strftime('%d-%m-%Y') if date_to else 'wszystkie'}"
                        cell.value = period_text
                    elif header == 'Imię i nazwisko':
                        # Formuła do liczenia unikalnych klientów
                        cell.value = f'=SUMPRODUCT(1/COUNTIF({get_column_letter(col_idx)}{data_start_row}:{get_column_letter(col_idx)}{data_end_row},{get_column_letter(col_idx)}{data_start_row}:{get_column_letter(col_idx)}{data_end_row}))'
                    elif header == 'Status':
                        # Liczba unikalnych zamówień na podstawie Nr Baselinker (kolumna D)
                        cell.value = f'=SUMPRODUCT(1/COUNTIF($D${data_start_row}:$D${data_end_row},$D${data_start_row}:$D${data_end_row}))'
            
            # WIERSZ 3: PUSTY SEPARATOR
            
            # WIERSZE 4+: DANE
            for row_idx, row_data in enumerate(dataframe.itertuples(index=False), 4):
                for col_idx, value in enumerate(row_data, 1):
                    cell = worksheet.cell(row=row_idx, column=col_idx, value=value)
                    cell.border = border
                    
                    # Kolor tła danych (bardzo jasny)
                    header = headers[col_idx - 1]
                    color_key = COLUMN_COLORS.get(header, 'order_data')
                    light_colors = {
                        'order_data': 'F3F8FF',
                        'customer_data': 'F1F8F1',
                        'logistics_data': 'FFFEF7',
                        'product_data': 'FFF8F0',
                        'financial_data': 'FAF4FB',
                        'production_data': 'FAFAFA'
                    }
                    cell.fill = PatternFill(start_color=light_colors[color_key], end_color=light_colors[color_key], fill_type='solid')
                    
                    # Format liczbowy dla danych
                    if isinstance(value, (int, float)) and value != 0:
                        if 'zł' in header or 'Kwota' in header or 'Wartość' in header or 'Cena' in header or 'Koszt' in header or 'Zapłacono' in header or 'Saldo' in header:
                            cell.number_format = '#,##0.00" zł"'
                        elif 'm³' in header or 'Objętość' in header:
                            cell.number_format = '#,##0.0000'
                        elif header in ['Długość', 'Szerokość', 'Grubość']:
                            cell.number_format = '#,##0.00'
            
            # AUTO-DOPASOWANIE SZEROKOŚCI KOLUMN I UKRYWANIE
            for col_idx, header in enumerate(headers, 1):
                col_letter = get_column_letter(col_idx)
        
                # Oblicz maksymalną szerokość na podstawie zawartości
                max_length = len(header)
                for row in worksheet.iter_rows(min_col=col_idx, max_col=col_idx, min_row=1, max_row=worksheet.max_row):
                    for cell in row:
                        if cell.value:
                            max_length = max(max_length, len(str(cell.value)))
        
                # Ustaw szerokość (minimum 10, maksimum 30)
                width = min(max(max_length + 2, 10), 30)
                worksheet.column_dimensions[col_letter].width = width
        
                # UKRYWANIE WYBRANYCH KOLUMN
                columns_to_hide = [
                    'Nr Baselinker',
                    'Nr wew.',
                    'Imię i nazwisko',
                    'Kod pocztowy',
                    'Miejscowość',
                    'Ulica',
                    'Województwo',
                    'Telefon',
                    'Opiekun',
                    'Dostawa',
                    'Źródło',
                    'Grupa',
                    'Rodzaj',
                    'Długość',
                    'Szerokość',
                    'Ilość',
                    'Cena brutto',
                    'Cena netto',
                    'Wartość brutto',
                    'Wartość netto',
                    'Objętość 1 szt.',
                    'Objętość TTL',
                    'Data realizacji',
                    'Status',
                    'Sposób płatności',
                    'Zapłacono netto'
                ]
        
                # Ukryj kolumnę jeśli jest na liście
                if header in columns_to_hide:
                    worksheet.column_dimensions[col_letter].hidden = True
            
            # ZAMROŻENIE PANELI (pierwsze 3 wiersze i pierwsze 5 kolumn)
            worksheet.freeze_panes = 'F4'
            
            # FILTRY AUTOMATYCZNE
            worksheet.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{worksheet.max_row}"
        
        # Zastosuj formatowanie do arkusza głównego
        format_details_sheet(ws_details, df)

        def add_cell_merging():
            """Scala komórki dla pól zamówienia - tylko do kolumny L z wyrównaniem do lewej i góry"""
    
            # Grupuj dane po zamówieniach
            orders_grouped = {}
            for idx, order in enumerate(orders):
                order_id = order.baselinker_order_id or f"manual_{order.id}"
                if order_id not in orders_grouped:
                    orders_grouped[order_id] = []
                orders_grouped[order_id].append(idx + 4)  # +4 bo dane zaczynają się od wiersza 4
    
            # Definicja kolumn do scalenia - TYLKO DO KOLUMNY L (12)
            merge_columns = {
                'A': 'Data',                    # Data (kolumna 1)
                'B': 'TTL m³',                  # TTL m³ (kolumna 2)
                'C': 'Kwota zamówień netto',    # Kwota zamówień netto (kolumna 3)
                'D': 'Nr Baselinker',           # Nr Baselinker (kolumna 4)
                'E': 'Nr wew.',                 # Nr wew. (kolumna 5)
                'F': 'Imię i nazwisko',         # Imię i nazwisko (kolumna 6)
                'G': 'Kod pocztowy',            # Kod pocztowy (kolumna 7)
                'H': 'Miejscowość',             # Miejscowość (kolumna 8)
                'I': 'Ulica',                   # Ulica (kolumna 9)
                'J': 'Województwo',             # Województwo (kolumna 10)
                'K': 'Telefon',                 # Telefon (kolumna 11)
                'L': 'Opiekun',                 # Opiekun (kolumna 12)
                'AH': 'Koszt kuriera',          # Kolumna 34
                'AJ': 'Zapłacono netto',        # Kolumna 36  
                'AK': 'Saldo'                   # Kolumna 37
            }
    
            # KROK 1: Ustaw wyrównanie dla WSZYSTKICH komórek PRZED scalaniem
            for row_idx in range(4, ws_details.max_row + 1):  # Od wiersza 4 do końca
                for col_letter in merge_columns.keys():
                    try:
                        cell = ws_details[f'{col_letter}{row_idx}']
                        cell.alignment = Alignment(horizontal='left', vertical='top')
                    except Exception:
                        continue
    
            # KROK 2: Scalaj komórki dla każdego zamówienia
            for order_id, row_indices in orders_grouped.items():
                if len(row_indices) > 1:  # Scalaj tylko jeśli zamówienie ma więcej niż 1 produkt
                    start_row = min(row_indices)
                    end_row = max(row_indices)
            
                    for col_letter in merge_columns.keys():
                        try:
                            merge_range = f'{col_letter}{start_row}:{col_letter}{end_row}'
                            ws_details.merge_cells(merge_range)
                    
                            # KROK 3: Ponownie ustaw wyrównanie dla scalonej komórki
                            merged_cell = ws_details[f'{col_letter}{start_row}']
                            merged_cell.alignment = Alignment(horizontal='left', vertical='top')
                            
                        except Exception as e:
                            # Ignoruj błędy scalania
                            continue
        
        # Wywołaj funkcję scalania
        add_cell_merging()
        
        # ===== WSPÓLNE FUNKCJE POMOCNICZE DLA WSZYSTKICH ARKUSZY =====
        # Stylizacja dla arkuszy podsumowań
        title_font = Font(size=16, bold=True, color='1976D2')
        section_font = Font(size=12, bold=True, color='333333')
        label_font = Font(size=10, bold=True)
        value_font = Font(size=10)
        
        title_fill = PatternFill(start_color='E3F2FD', end_color='E3F2FD', fill_type='solid')
        section_fill = PatternFill(start_color='F5F5F5', end_color='F5F5F5', fill_type='solid')
        
        def add_title(worksheet, row, title):
            cell = worksheet.cell(row=row, column=1, value=title)
            cell.font = title_font
            cell.fill = title_fill
            worksheet.merge_cells(f'A{row}:D{row}')
            return row + 2
        
        def add_section(worksheet, row, title):
            cell = worksheet.cell(row=row, column=1, value=title)
            cell.font = section_font
            cell.fill = section_fill
            worksheet.merge_cells(f'A{row}:D{row}')
            return row + 1
        
        def add_stat_row(worksheet, row, label, value, format_type='number'):
            # Etykieta
            label_cell = worksheet.cell(row=row, column=1, value=label)
            label_cell.font = label_font
            label_cell.border = border
            
            # Wartość
            value_cell = worksheet.cell(row=row, column=2, value=value)
            value_cell.font = value_font
            value_cell.border = border
            
            # Formatowanie wartości
            if format_type == 'currency':
                value_cell.number_format = '#,##0.00" zł"'
            elif format_type == 'volume':
                value_cell.number_format = '#,##0.0000" m³"'
            elif format_type == 'percent':
                value_cell.number_format = '0.0%'
            elif format_type == 'days':
                value_cell.number_format = '#,##0" dni"'
            else:
                value_cell.number_format = '#,##0.00'
            
            return row + 1
        
        # ===== ARKUSZ 2: PODSUMOWANIE I STATYSTYKI =====
        ws_summary = workbook.create_sheet(title="Podsumowanie")
        
        # Oblicz statystyki
        stats = BaselinkerReportOrder.get_statistics(query)
        
        # Dodatkowe statystyki
        unique_customers = len(set(order.customer_name for order in orders if order.customer_name))
        orders_grouped = {}
        for order in orders:
            order_id = order.baselinker_order_id or f"manual_{order.id}"
            if order_id not in orders_grouped:
                orders_grouped[order_id] = []
            orders_grouped[order_id].append(order)
        unique_orders = len(orders_grouped)
        total_products = len(orders)
        avg_order_value = stats['order_amount_net'] / unique_orders if unique_orders > 0 else 0
        avg_products_per_order = total_products / unique_orders if unique_orders > 0 else 0
        
        # Statystyki po statusach
        status_stats = {}
        for order in orders:
            status = order.current_status or 'Brak statusu'
            if status not in status_stats:
                status_stats[status] = {'count': 0, 'value': 0}
            status_stats[status]['count'] += 1
            status_stats[status]['value'] += float(order.value_net or 0)
        
        # Statystyki po województwach
        state_stats = {}
        for order in orders:
            state = order.delivery_state or 'Brak danych'
            if state not in state_stats:
                state_stats[state] = {'count': 0, 'value': 0}
            state_stats[state]['count'] += 1
            state_stats[state]['value'] += float(order.value_net or 0)
        
        current_row = 1
        
        # TYTUŁ GŁÓWNY
        current_row = add_title(ws_summary, current_row, "📊 RAPORT SPRZEDAŻY - PODSUMOWANIE")
        
        # Informacje o okresie
        period_text = f"Okres: {date_from.strftime('%d-%m-%Y') if date_from else 'wszystkie dane'} - {date_to.strftime('%d-%m-%Y') if date_to else 'wszystkie dane'}"
        ws_summary.cell(row=current_row, column=1, value=period_text).font = Font(size=10, italic=True)
        ws_summary.cell(row=current_row + 1, column=1, value=f"Wygenerowano: {datetime.now().strftime('%d-%m-%Y %H:%M:%S')}").font = Font(size=10, italic=True)
        current_row += 3
        
        # ===== STATYSTYKI GŁÓWNE =====
        current_row = add_section(ws_summary, current_row, "📈 STATYSTYKI GŁÓWNE")
        current_row = add_stat_row(ws_summary, current_row, "Liczba zamówień:", unique_orders)
        current_row = add_stat_row(ws_summary, current_row, "Liczba produktów:", total_products)
        current_row = add_stat_row(ws_summary, current_row, "Liczba klientów:", unique_customers)
        current_row = add_stat_row(ws_summary, current_row, "Średnia produktów na zamówienie:", avg_products_per_order)
        current_row += 1
        
        # ===== STATYSTYKI FINANSOWE =====
        current_row = add_section(ws_summary, current_row, "💰 STATYSTYKI FINANSOWE")
        current_row = add_stat_row(ws_summary, current_row, "Kwota zamówień netto:", stats['order_amount_net'], 'currency')
        current_row = add_stat_row(ws_summary, current_row, "Wartość netto produktów:", stats['value_net'], 'currency')
        current_row = add_stat_row(ws_summary, current_row, "Wartość brutto produktów:", stats['value_gross'], 'currency')
        current_row = add_stat_row(ws_summary, current_row, "Średnia wartość zamówienia:", avg_order_value, 'currency')
        current_row = add_stat_row(ws_summary, current_row, "Koszt kuriera łącznie:", stats['delivery_cost'], 'currency')
        current_row = add_stat_row(ws_summary, current_row, "Zapłacono łącznie:", stats['paid_amount_net'], 'currency')
        current_row = add_stat_row(ws_summary, current_row, "Saldo łączne:", stats['balance_due'], 'currency')
        current_row += 1
        
        # ===== STATYSTYKI PRODUKCJI =====
        current_row = add_section(ws_summary, current_row, "🏭 STATYSTYKI PRODUKCJI")
        current_row = add_stat_row(ws_summary, current_row, "Łączna objętość:", stats['total_m3'], 'volume')
        current_row = add_stat_row(ws_summary, current_row, "Średnia cena za m³:", stats['avg_price_per_m3'], 'currency')
        current_row = add_stat_row(ws_summary, current_row, "Objętość w produkcji:", stats['production_volume'], 'volume')
        current_row = add_stat_row(ws_summary, current_row, "Wartość w produkcji:", stats['production_value_net'], 'currency')
        current_row = add_stat_row(ws_summary, current_row, "Gotowe do odbioru:", stats['ready_pickup_volume'], 'volume')
        current_row += 1
        
        # ===== TABELA STATUSÓW =====
        current_row = add_section(ws_summary, current_row, "📋 ROZKŁAD WEDŁUG STATUSÓW")
        
        # Nagłówki tabeli
        headers = ['Status', 'Liczba produktów', 'Wartość netto', 'Udział %']
        for col, header in enumerate(headers, 1):
            cell = ws_summary.cell(row=current_row, column=col, value=header)
            cell.font = Font(bold=True, color='FFFFFF')
            cell.fill = PatternFill(start_color='1976D2', end_color='1976D2', fill_type='solid')
            cell.border = border
            cell.alignment = Alignment(horizontal='center')
        current_row += 1
        
        # Dane statusów (posortowane po wartości)
        sorted_statuses = sorted(status_stats.items(), key=lambda x: x[1]['value'], reverse=True)
        total_value = stats['value_net']
        
        for status, data in sorted_statuses:
            percentage = (data['value'] / total_value * 100) if total_value > 0 else 0
            
            ws_summary.cell(row=current_row, column=1, value=status).border = border
            ws_summary.cell(row=current_row, column=2, value=data['count']).border = border
            
            value_cell = ws_summary.cell(row=current_row, column=3, value=data['value'])
            value_cell.number_format = '#,##0.00" zł"'
            value_cell.border = border
            
            percent_cell = ws_summary.cell(row=current_row, column=4, value=percentage/100)
            percent_cell.number_format = '0.0%'
            percent_cell.border = border
            
            current_row += 1
        
        current_row += 1
        
        # ===== TABELA WOJEWÓDZTW (TOP 10) =====
        current_row = add_section(ws_summary, current_row, "🗺️ TOP 10 WOJEWÓDZTW")
        
        # Nagłówki tabeli
        for col, header in enumerate(headers, 1):
            cell = ws_summary.cell(row=current_row, column=col, value=header.replace('Status', 'Województwo'))
            cell.font = Font(bold=True, color='FFFFFF')
            cell.fill = PatternFill(start_color='388E3C', end_color='388E3C', fill_type='solid')
            cell.border = border
            cell.alignment = Alignment(horizontal='center')
        current_row += 1
        
        # Dane województw (top 10 po wartości)
        sorted_states = sorted(state_stats.items(), key=lambda x: x[1]['value'], reverse=True)[:10]
        
        for state, data in sorted_states:
            percentage = (data['value'] / total_value * 100) if total_value > 0 else 0
            
            ws_summary.cell(row=current_row, column=1, value=state).border = border
            ws_summary.cell(row=current_row, column=2, value=data['count']).border = border
            
            value_cell = ws_summary.cell(row=current_row, column=3, value=data['value'])
            value_cell.number_format = '#,##0.00" zł"'
            value_cell.border = border
            
            percent_cell = ws_summary.cell(row=current_row, column=4, value=percentage/100)
            percent_cell.number_format = '0.0%'
            percent_cell.border = border
            
            current_row += 1
        
        # AUTO-DOPASOWANIE SZEROKOŚCI KOLUMN dla arkusza podsumowań
        for col in range(1, 5):
            col_letter = get_column_letter(col)
            max_length = 0
            for row in ws_summary.iter_rows(min_col=col, max_col=col):
                for cell in row:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
            
            # Minimalna szerokość 15, maksymalna 40
            width = min(max(max_length + 2, 15), 40)
            ws_summary.column_dimensions[col_letter].width = width

        # ===== ARKUSZ 3: ANALIZA KLIENTÓW =====
        ws_customers = workbook.create_sheet(title="Analiza klientów")
        
        # Przygotowanie danych klientów
        customer_data = {}
        
        for order in orders:
            customer_name = order.customer_name or 'Nieznany klient'
            
            if customer_name not in customer_data:
                customer_data[customer_name] = {
                    'orders_count': set(),  # Używamy set do unikalnych zamówień
                    'products_count': 0,
                    'total_value_net': 0,
                    'total_value_gross': 0,
                    'total_volume': 0,
                    'total_paid': 0,
                    'total_balance': 0,
                    'delivery_cost': 0,
                    'first_order_date': None,
                    'last_order_date': None,
                    'delivery_state': order.delivery_state or 'Brak danych',
                    'delivery_city': order.delivery_city or 'Brak danych',
                    'phone': order.phone or 'Brak danych',
                    'caretaker': order.caretaker or 'Brak danych',
                    'order_sources': set(),
                    'statuses': set(),
                    'product_types': set()
                }
            
            # Aktualizuj dane klienta
            client = customer_data[customer_name]
            
            # Dodaj zamówienie do setu (unikalne ID)
            if order.baselinker_order_id:
                client['orders_count'].add(order.baselinker_order_id)
            else:
                client['orders_count'].add(f"manual_{order.id}")
            
            # Liczba produktów
            client['products_count'] += 1
            
            # Wartości finansowe
            client['total_value_net'] += float(order.value_net or 0)
            client['total_value_gross'] += float(order.value_gross or 0)
            client['total_volume'] += float(order.total_volume or 0)
            
            # Płatności (tylko unikalne zamówienia - podobnie jak w statystykach głównych)
            # Sprawdź czy to pierwsze wystąpienie tego zamówienia
            order_id = order.baselinker_order_id or f"manual_{order.id}"
            orders_for_customer = [o for o in orders if (o.customer_name == customer_name)]
            first_occurrence = next((o for o in orders_for_customer if (o.baselinker_order_id or f"manual_{o.id}") == order_id), None)
            
            if order == first_occurrence:  # Tylko przy pierwszym wystąpieniu zamówienia
                client['total_paid'] += float(order.paid_amount_net or 0)
                client['total_balance'] += float(order.balance_due or 0)
                client['delivery_cost'] += float(order.delivery_cost or 0)
            
            # Daty
            order_date = order.date_created
            if order_date:
                if client['first_order_date'] is None or order_date < client['first_order_date']:
                    client['first_order_date'] = order_date
                if client['last_order_date'] is None or order_date > client['last_order_date']:
                    client['last_order_date'] = order_date
            
            # Kolekcje
            if order.order_source:
                client['order_sources'].add(order.order_source)
            if order.current_status:
                client['statuses'].add(order.current_status)
            if order.product_type:
                client['product_types'].add(order.product_type)
        
        # Konwertuj sety na liczby i stringi
        for client_name, data in customer_data.items():
            data['orders_count'] = len(data['orders_count'])
            data['order_sources'] = ', '.join(sorted(data['order_sources']))
            data['statuses'] = ', '.join(sorted(data['statuses']))
            data['product_types'] = ', '.join(sorted(data['product_types']))
            
            # Oblicz dodatkowe metryki
            data['avg_order_value'] = data['total_value_net'] / data['orders_count'] if data['orders_count'] > 0 else 0
            data['avg_products_per_order'] = data['products_count'] / data['orders_count'] if data['orders_count'] > 0 else 0
            
            # Dni między pierwszym a ostatnim zamówieniem
            if data['first_order_date'] and data['last_order_date']:
                data['customer_lifespan'] = (data['last_order_date'] - data['first_order_date']).days
            else:
                data['customer_lifespan'] = 0
        
        # Posortuj klientów po wartości (najważniejsi pierwsi)
        sorted_customers = sorted(customer_data.items(), key=lambda x: x[1]['total_value_net'], reverse=True)
        
        current_row = 1
        
        # ===== TYTUŁ I PODSUMOWANIE =====
        current_row = add_title(ws_customers, current_row, "👥 ANALIZA KLIENTÓW")
        
        # Statystyki ogólne klientów
        top_customer_value = sorted_customers[0][1]['total_value_net'] if sorted_customers else 0
        top_10_value = sum(data['total_value_net'] for _, data in sorted_customers[:10])
        total_customer_value = sum(data['total_value_net'] for _, data in sorted_customers)
        top_10_percentage = (top_10_value / total_customer_value * 100) if total_customer_value > 0 else 0
        
        ws_customers.cell(row=current_row, column=1, value=f"Łączna liczba klientów: {len(customer_data)}").font = Font(size=10, italic=True)
        ws_customers.cell(row=current_row + 1, column=1, value=f"TOP 10 klientów stanowi {top_10_percentage:.1f}% wartości").font = Font(size=10, italic=True)
        current_row += 3
        
        # ===== TABELA GŁÓWNA KLIENTÓW =====
        current_row = add_section(ws_customers, current_row, "📊 RANKING KLIENTÓW (TOP 50)")
        
        # Nagłówki tabeli
        customer_headers = [
            'Lp.', 'Klient', 'Zamówienia', 'Produkty', 'Wartość netto', 'Śr. wartość zamówienia',
            'Zapłacono', 'Saldo', 'Koszt kuriera', 'Pierwsze zamówienie', 'Ostatnie zamówienie',
            'Okres [dni]', 'Województwo', 'Miasto', 'Telefon', 'Opiekun', 'Źródła', 'Rodzaje produktów'
        ]
        
        for col, header in enumerate(customer_headers, 1):
            cell = ws_customers.cell(row=current_row, column=col, value=header)
            cell.font = Font(bold=True, color='FFFFFF', size=9)
            cell.fill = PatternFill(start_color='7B1FA2', end_color='7B1FA2', fill_type='solid')
            cell.border = border
            cell.alignment = Alignment(horizontal='center', vertical='center')
        current_row += 1
        
        # Dane klientów (TOP 50)
        for rank, (client_name, data) in enumerate(sorted_customers[:50], 1):
            row_data = [
                rank,
                client_name,
                data['orders_count'],
                data['products_count'],
                data['total_value_net'],
                data['avg_order_value'],
                data['total_paid'],
                data['total_balance'],
                data['delivery_cost'],
                data['first_order_date'].strftime('%d-%m-%Y') if data['first_order_date'] else '',
                data['last_order_date'].strftime('%d-%m-%Y') if data['last_order_date'] else '',
                data['customer_lifespan'],
                data['delivery_state'],
                data['delivery_city'],
                data['phone'],
                data['caretaker'],
                data['order_sources'][:50] + '...' if len(data['order_sources']) > 50 else data['order_sources'],
                data['product_types'][:50] + '...' if len(data['product_types']) > 50 else data['product_types']
            ]
            
            for col, value in enumerate(row_data, 1):
                cell = ws_customers.cell(row=current_row, column=col, value=value)
                cell.border = border
                cell.font = Font(size=9)
                
                # Formatowanie specjalne
                if col == 5 or col == 6 or col == 7 or col == 8 or col == 9:  # Kwoty
                    cell.number_format = '#,##0.00" zł"'
                elif col == 3 or col == 4 or col == 12:  # Liczby całkowite
                    cell.number_format = '#,##0'
                
                # Kolorowanie na podstawie pozycji w rankingu
                if rank <= 5:  # TOP 5 - złoty
                    cell.fill = PatternFill(start_color='FFF8E1', end_color='FFF8E1', fill_type='solid')
                elif rank <= 10:  # TOP 10 - srebrny
                    cell.fill = PatternFill(start_color='F3E5F5', end_color='F3E5F5', fill_type='solid')
                elif rank <= 20:  # TOP 20 - brązowy
                    cell.fill = PatternFill(start_color='F1F8E9', end_color='F1F8E9', fill_type='solid')
                else:  # Pozostali - białe tło
                    cell.fill = PatternFill(start_color='FFFFFF', end_color='FFFFFF', fill_type='solid')
            
            current_row += 1
        
        current_row += 2
        
        # ===== STATYSTYKI DODATKOWE =====
        current_row = add_section(ws_customers, current_row, "📈 STATYSTYKI KLIENTÓW")
        
        # Oblicz dodatkowe statystyki
        if sorted_customers:
            avg_orders_per_customer = sum(data['orders_count'] for _, data in sorted_customers) / len(sorted_customers)
            avg_value_per_customer = sum(data['total_value_net'] for _, data in sorted_customers) / len(sorted_customers)
            
            # Klienci jednorazowi vs stali
            one_time_customers = sum(1 for _, data in sorted_customers if data['orders_count'] == 1)
            returning_customers = len(sorted_customers) - one_time_customers
            
            # Średni okres współpracy
            active_customers = [data for _, data in sorted_customers if data['customer_lifespan'] > 0]
            avg_lifespan = sum(data['customer_lifespan'] for data in active_customers) / len(active_customers) if active_customers else 0
            
            current_row = add_stat_row(ws_customers, current_row, "Średnia zamówień na klienta:", avg_orders_per_customer)
            current_row = add_stat_row(ws_customers, current_row, "Średnia wartość na klienta:", avg_value_per_customer, 'currency')
            current_row = add_stat_row(ws_customers, current_row, "Klienci jednorazowi:", one_time_customers)
            current_row = add_stat_row(ws_customers, current_row, "Klienci stali (2+ zamówienia):", returning_customers)
            current_row = add_stat_row(ws_customers, current_row, "Średni okres współpracy:", avg_lifespan, 'days')
            
            # Procent stałych klientów
            returning_percentage = (returning_customers / len(sorted_customers) * 100) if sorted_customers else 0
            current_row = add_stat_row(ws_customers, current_row, "% klientów stałych:", returning_percentage/100, 'percent')
        
        # AUTO-DOPASOWANIE SZEROKOŚCI KOLUMN dla arkusza klientów
        for col in range(1, len(customer_headers) + 1):
            col_letter = get_column_letter(col)
            
            # Specjalne szerokości dla niektórych kolumn
            if col == 2:  # Nazwa klienta
                width = 25
            elif col in [17, 18]:  # Źródła, Rodzaje produktów
                width = 20
            elif col in [13, 14, 15, 16]:  # Województwo, Miasto, Telefon, Opiekun
                width = 15
            else:
                # Standardowe dopasowanie
                max_length = len(customer_headers[col-1])
                for row in ws_customers.iter_rows(min_col=col, max_col=col, min_row=current_row-20, max_row=current_row):
                    for cell in row:
                        if cell.value:
                            max_length = max(max_length, len(str(cell.value)))
                width = min(max(max_length + 1, 8), 18)
            
            ws_customers.column_dimensions[col_letter].width = width
        
        # Zamrożenie paneli dla arkusza klientów (nagłówek i pierwsze 2 kolumny)
        ws_customers.freeze_panes = 'C8'
        
        # Zapisz do pamięci
        workbook.save(output)
        output.seek(0)
        
        # Nazwa pliku
        date_suffix = ""
        if date_from and date_to:
            if date_from == date_to:
                date_suffix = f"_{date_from.strftime('%d-%m-%Y')}"
            else:
                date_suffix = f"_{date_from.strftime('%d-%m-%Y')}_{date_to.strftime('%d-%m-%Y')}"
        
        filename = f"raporty_sprzedazy{date_suffix}_{datetime.now().strftime('%d-%m-%Y_%H%M%S')}.xlsx"
        
        reports_logger.info("Wygenerowano ulepszony eksport Excel",
                          user_email=user_email,
                          records_count=len(excel_data),
                          filename=filename)
        
        return Response(
            output.getvalue(),
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"'
            }
        )
        
    except Exception as e:
        reports_logger.error("Błąd eksportu Excel",
                           user_email=user_email,
                           error=str(e))
        return jsonify({
            'success': False,
            'error': f'Błąd eksportu: {str(e)}'
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
    Synchronizuje wybrane zamówienia - pobiera pełne informacje i aktualizuje wszystkie dane
    
    Args:
        service: Serwis Baselinker
        order_ids: Lista ID zamówień do synchronizacji
        
    Returns:
        Dict: Wynik synchronizacji
    """
    try:
        reports_logger.info("Rozpoczęcie synchronizacji wybranych zamówień",
                          order_ids_count=len(order_ids),
                          order_ids=order_ids[:10])  # Loguj pierwsze 10
        
        orders = []
        failed_orders = []
        
        # Pobierz pełne dane każdego zamówienia
        for order_id in order_ids:
            try:
                order = service.get_order_details(order_id)
                if order:
                    orders.append(order)
                    reports_logger.debug("Pobrano szczegóły zamówienia",
                                       order_id=order_id,
                                       products_count=len(order.get('products', [])))
                else:
                    failed_orders.append(order_id)
                    reports_logger.warning("Nie udało się pobrać zamówienia",
                                         order_id=order_id)
            except Exception as e:
                failed_orders.append(order_id)
                reports_logger.error("Błąd pobierania zamówienia",
                                   order_id=order_id,
                                   error=str(e))
        
        if not orders:
            error_msg = f'Nie udało się pobrać żadnego z wybranych zamówień. Nieudane: {failed_orders}'
            reports_logger.error("Brak pobranych zamówień", 
                               failed_orders=failed_orders,
                               total_requested=len(order_ids))
            return {
                'success': False,
                'error': error_msg
            }
        
        # ZMIANA: Używamy pełnej synchronizacji zamiast tylko dodawania
        # To oznacza że aktualizowane są wszystkie informacje w istniejących rekordach
        reports_logger.info("Rozpoczęcie pełnej synchronizacji zamówień",
                          orders_to_sync=len(orders),
                          failed_orders_count=len(failed_orders))
        
        # Użyj metody sync_orders która obsługuje aktualizacje
        result = service.sync_orders(orders_list=orders, sync_type='selected')
        
        # Dodaj informacje o nieudanych zamówieniach do wyniku
        result['failed_orders'] = failed_orders
        result['failed_orders_count'] = len(failed_orders)
        
        if failed_orders:
            success_count = result.get('orders_processed', 0)
            total_requested = len(order_ids)
            result['message'] = f'Zsynchronizowano {success_count} z {total_requested} zamówień. Nieudane: {len(failed_orders)}'
            
            reports_logger.warning("Synchronizacja częściowo nieudana",
                                 success_count=success_count,
                                 total_requested=total_requested,
                                 failed_count=len(failed_orders),
                                 failed_orders=failed_orders)
        else:
            reports_logger.info("Synchronizacja wybranych zamówień zakończona pomyślnie",
                              orders_processed=result.get('orders_processed', 0),
                              orders_added=result.get('orders_added', 0),
                              orders_updated=result.get('orders_updated', 0))
        
        return result
            
    except Exception as e:
        reports_logger.error("Błąd synchronizacji wybranych zamówień",
                           error=str(e),
                           error_type=type(e).__name__,
                           order_ids_count=len(order_ids))
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
        
        # ZMIANA: Pobierz zamówienia które mogą być synchronizowane (wykluczamy tylko 105112 i 138625)
        # 105112 = "Nowe - nieopłacone"
        # 138625 = "Zamówienie anulowane"
        excluded_status_ids = [105112, 138625]
        excluded_status_names = [
            'Nowe - nieopłacone',
            'Zamówienie anulowane'
        ]
        
        # Pobierz zamówienia z bazy które nie mają wykluczonych statusów
        orders_to_sync = BaselinkerReportOrder.query.filter(
            BaselinkerReportOrder.baselinker_order_id.isnot(None),
            ~BaselinkerReportOrder.baselinker_status_id.in_(excluded_status_ids),
            ~BaselinkerReportOrder.current_status.in_(excluded_status_names)
        ).all()
        
        if not orders_to_sync:
            reports_logger.info("Brak zamówień do synchronizacji statusów",
                              user_email=user_email,
                              excluded_status_ids=excluded_status_ids,
                              excluded_status_names=excluded_status_names)
            return jsonify({
                'success': True,
                'message': 'Brak zamówień do synchronizacji statusów',
                'orders_processed': 0,
                'orders_updated': 0
            })
        
        # Grupuj zamówienia według baselinker_order_id
        unique_order_ids = list(set(order.baselinker_order_id for order in orders_to_sync))
        
        reports_logger.info("Synchronizacja statusów zamówień",
                          user_email=user_email,
                          unique_orders=len(unique_order_ids),
                          total_records=len(orders_to_sync),
                          excluded_status_ids=excluded_status_ids)
        
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
                    new_paid_amount_net = float(payment_done_gross) / 1.23 if payment_done_gross else 0.0
                    
                    # Aktualizuj wszystkie rekordy tego zamówienia
                    records_updated = BaselinkerReportOrder.query.filter_by(
                        baselinker_order_id=order_id
                    ).update({
                        'current_status': new_status,
                        'baselinker_status_id': new_status_id,
                        'paid_amount_net': new_paid_amount_net,
                        'updated_at': datetime.utcnow()
                    })
                    
                    if records_updated > 0:
                        updated_count += records_updated
                        status_updated_count += 1
                        if new_paid_amount_net > 0:
                            payment_updated_count += 1
                            
                        reports_logger.debug("Zaktualizowano status zamówienia",
                                           order_id=order_id,
                                           new_status=new_status,
                                           new_status_id=new_status_id,
                                           paid_amount_net=new_paid_amount_net,
                                           records_updated=records_updated)
                    
                    processed_count += 1
                else:
                    reports_logger.warning("Nie udało się pobrać szczegółów zamówienia",
                                         order_id=order_id)
                    
            except Exception as e:
                reports_logger.error("Błąd synchronizacji statusu zamówienia",
                                   order_id=order_id,
                                   error=str(e))
                continue
        
        # Zapisz zmiany
        db.session.commit()
        
        duration = (datetime.utcnow() - sync_start).total_seconds()
        
        reports_logger.info("Synchronizacja statusów zakończona",
                          user_email=user_email,
                          processed_orders=processed_count,
                          updated_records=updated_count,
                          status_updated_count=status_updated_count,
                          payment_updated_count=payment_updated_count,
                          duration_seconds=duration)
        
        return jsonify({
            'success': True,
            'message': f'Zsynchronizowano statusy {processed_count} zamówień',
            'orders_processed': processed_count,
            'orders_updated': status_updated_count,
            'records_updated': updated_count,
            'payment_updated_count': payment_updated_count
        })
        
    except Exception as e:
        db.session.rollback()
        reports_logger.error("Błąd synchronizacji statusów",
                           user_email=user_email,
                           error=str(e),
                           error_type=type(e).__name__)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reports_bp.route('/api/delete-manual-row', methods=['POST'])
@login_required
def api_delete_manual_row():
    """
    API endpoint do usuwania rekordów z bazy danych
    Obsługuje usuwanie pojedynczych rekordów oraz całych zamówień wieloproduktowych
    """
    user_email = session.get('user_email')
    
    try:
        data = request.get_json()
        record_id = data.get('record_id')
        delete_all_products = data.get('delete_all_products', False)
        
        if not record_id:
            return jsonify({'success': False, 'error': 'Brak ID rekordu'}), 400
        
        reports_logger.info("Rozpoczęcie usuwania rekordu",
                          user_email=user_email,
                          record_id=record_id,
                          delete_all_products=delete_all_products)
        
        # Pobierz główny rekord
        main_record = BaselinkerReportOrder.query.get_or_404(record_id)
        
        records_to_delete = []
        
        if delete_all_products and main_record.baselinker_order_id:
            # Usuń wszystkie produkty tego zamówienia z Baselinker
            all_order_records = BaselinkerReportOrder.query.filter_by(
                baselinker_order_id=main_record.baselinker_order_id
            ).all()
            
            records_to_delete = all_order_records
            
            reports_logger.info("Usuwanie całego zamówienia wieloproduktowego",
                              user_email=user_email,
                              baselinker_order_id=main_record.baselinker_order_id,
                              products_count=len(all_order_records))
        else:
            # Usuń tylko pojedynczy rekord
            records_to_delete = [main_record]
            
            reports_logger.info("Usuwanie pojedynczego rekordu",
                              user_email=user_email,
                              record_id=record_id,
                              is_manual=main_record.is_manual)
        
        # Zbierz informacje o usuwanych rekordach (dla logowania)
        deleted_info = []
        for record in records_to_delete:
            deleted_info.append({
                'id': record.id,
                'customer_name': record.customer_name,
                'is_manual': record.is_manual,
                'baselinker_order_id': record.baselinker_order_id,
                'date_created': record.date_created.isoformat() if record.date_created else None
            })
        
        # Usuń rekordy z bazy danych
        deleted_count = 0
        for record in records_to_delete:
            db.session.delete(record)
            deleted_count += 1
        
        # Zatwierdź transakcję
        db.session.commit()
        
        reports_logger.info("Pomyślnie usunięto rekordy",
                          user_email=user_email,
                          deleted_count=deleted_count,
                          deleted_records=deleted_info)
        
        # Przygotuj komunikat zwrotny
        if deleted_count > 1:
            message = f'Usunięto zamówienie z {deleted_count} produktami'
        else:
            record_type = "ręczny rekord" if main_record.is_manual else "rekord z Baselinker"
            message = f'Usunięto {record_type}'
        
        return jsonify({
            'success': True,
            'message': message,
            'deleted_count': deleted_count,
            'deleted_records': [info['id'] for info in deleted_info]
        })
        
    except Exception as e:
        db.session.rollback()
        reports_logger.error("Błąd usuwania rekordu",
                           user_email=user_email,
                           record_id=record_id,
                           error=str(e),
                           error_type=type(e).__name__)
        return jsonify({
            'success': False,
            'error': f'Błąd usuwania rekordu: {str(e)}'
        }), 500
    
@reports_bp.route('/api/fetch-orders-for-selection', methods=['POST'])
@login_required
def api_fetch_orders_for_selection():
    """
    POPRAWIONY ENDPOINT: Pobiera zamówienia z Baselinker dla wybranego zakresu dat
    z mechanizmem automatycznej paginacji gdy jest >90 zamówień
    DOMYŚLNIE WYKLUCZAJĄCY STATUSY 105112 i 138625
    """
    user_email = session.get('user_email')
    
    try:
        data = request.get_json()
        if not data:
            reports_logger.error("Brak danych w zapytaniu fetch-orders-for-selection", 
                               user_email=user_email)
            return jsonify({
                'success': False,
                'error': 'Brak danych w zapytaniu'
            }), 400

        date_from = data.get('date_from')
        date_to = data.get('date_to')
        days_count = data.get('days_count')
        # POPRAWKA: Domyślnie FALSE, żeby wykluczać anulowane i nieopłacone
        get_all_statuses = data.get('get_all_statuses', False)

        if not all([date_from, date_to, days_count]):
            return jsonify({
                'success': False,
                'error': 'Brak wymaganych parametrów: date_from, date_to, days_count'
            }), 400

        reports_logger.info("Pobieranie zamówień do wyboru",
                          user_email=user_email,
                          date_from=date_from,
                          date_to=date_to,
                          days_count=days_count,
                          get_all_statuses=get_all_statuses)

        service = get_reports_service()
        
        # NOWA LOGIKA: Mechanizm automatycznej paginacji
        all_orders = []
        current_date_from = datetime.fromisoformat(date_from).date()
        end_date = datetime.fromisoformat(date_to).date()
        
        # Pobierz istniejące zamówienia z bazy aby nie duplikować
        existing_orders = BaselinkerReportOrder.query.filter(
            BaselinkerReportOrder.baselinker_order_id.isnot(None)
        ).with_entities(BaselinkerReportOrder.baselinker_order_id).distinct().all()
        existing_order_ids = {order[0] for order in existing_orders}
        
        reports_logger.info("Załadowano istniejące zamówienia", 
                          existing_count=len(existing_order_ids))
        
        iteration = 0
        max_iterations = 20  # Zabezpieczenie przed nieskończoną pętlą
        
        while current_date_from <= end_date and iteration < max_iterations:
            iteration += 1
            
            reports_logger.info(f"Iteracja {iteration} pobierania zamówień",
                              current_date_from=current_date_from.isoformat(),
                              end_date=end_date.isoformat(),
                              include_excluded_statuses=get_all_statuses)
            
            # POPRAWKA: Pobierz zamówienia z kontrolą nad filtrowaniem statusów
            batch_orders = service.fetch_orders_from_baselinker(
                date_from=datetime.combine(current_date_from, datetime.min.time()),
                max_orders=100,  # Limit API Baselinker
                include_excluded_statuses=get_all_statuses  # Przekaż parametr filtrowania
            )
            
            if not batch_orders:
                reports_logger.info(f"Brak zamówień w iteracji {iteration}")
                break
                
            reports_logger.info(f"Pobrano {len(batch_orders)} zamówień w iteracji {iteration}")
            
            # Dodaj nowe zamówienia do listy z dodatkowym filtrowaniem
            new_orders_in_batch = 0
            for order in batch_orders:
                order_id = order['order_id']
                
                # Sprawdź czy zamówienie już istnieje
                if order_id not in existing_order_ids:
                    # DODATKOWA OCHRONA: Filtruj wykluczane statusy po stronie aplikacji
                    status_id = order.get('order_status_id')
                    
                    if not get_all_statuses and status_id in [105112, 138625]:
                        reports_logger.debug("Wykluczono zamówienie ze względu na status",
                                           order_id=order_id,
                                           status_id=status_id,
                                           status_name=service.status_map.get(status_id, f'Status {status_id}'))
                        continue
                    
                    all_orders.append(order)
                    new_orders_in_batch += 1
            
            reports_logger.info(f"Nowe zamówienia w iteracji {iteration}: {new_orders_in_batch}")
            
            # Jeśli pobrano mniej niż 90 zamówień, prawdopodobnie to koniec
            if len(batch_orders) < 90:
                reports_logger.info("Pobrano mniej niż 90 zamówień - koniec paginacji")
                break
            
            # Znajdź najstarszą datę w tym batch'u
            oldest_date = None
            for order in batch_orders:
                date_add = order.get('date_add')
                # gdy Baselinker zwraca timestamp (int/float)
                if isinstance(date_add, (int, float)):
                    order_date = datetime.fromtimestamp(date_add).date()
                else:
                    # gdy to string – próbujemy isoformat
                    try:
                        order_date = datetime.fromisoformat(str(date_add)).date()
                    except (TypeError, ValueError):
                        reports_logger.warning(
                            "Niepoprawny format pola date_add",
                            order_id=order.get('order_id'),
                            raw_value=date_add
                        )
                        continue
                if oldest_date is None or order_date < oldest_date:
                    oldest_date = order_date
            reports_logger.info(f"Najstarsza data w iteracji {iteration}: {oldest_date}")
            
            if oldest_date:
                # Przesuń date_from do najstarszej daty - 1 dzień
                current_date_from = oldest_date - timedelta(days=1)
                reports_logger.info(f"Przesunięcie date_from do: {current_date_from}")
            else:
                break

        # DODATKOWE FILTROWANIE PO STRONIE APLIKACJI (backup safety)
        if not get_all_statuses:
            original_count = len(all_orders)
            all_orders = [order for order in all_orders 
                         if order.get('order_status_id') not in [105112, 138625]]
            filtered_count = original_count - len(all_orders)
            
            if filtered_count > 0:
                reports_logger.info("Dodatkowe filtrowanie statusów po stronie aplikacji",
                                  original_count=original_count,
                                  filtered_out=filtered_count,
                                  final_count=len(all_orders),
                                  excluded_statuses=[105112, 138625])
        
        # Przygotuj response z informacjami o wymiarach
        # Pobierz mapę statusów z serwisu
        status_map = {
            s['status_id']: s['status_name']
            for s in service.fetch_order_statuses()
        }

        # Przygotuj response z informacjami o wymiarach
        orders_with_info = []
        
        for order in all_orders:
            products_with_issues = []
            has_dimension_issues = False
            
            custom_fields = order.get('custom_extra_fields', {})
            price_type_from_api = custom_fields.get('106169', '').strip().lower()
    
            # Normalizuj typ ceny
            if price_type_from_api == 'netto':
                price_type = 'netto'
            elif price_type_from_api == 'brutto':
                price_type = 'brutto'
            else:
                price_type = ''  # Puste lub nieznane

            # Sprawdź każdy produkt w zamówieniu
            for product in order.get('products', []):
                product_name = product.get('name', '')
                parsed_data = service.parser.parse_product_name(product_name)
                
                # Sprawdź czy brakuje wymiarów
                missing_dimensions = []
                if not parsed_data.get('length_cm'):
                    missing_dimensions.append('długość')
                if not parsed_data.get('width_cm'):
                    missing_dimensions.append('szerokość')
                if not parsed_data.get('thickness_cm'):
                    missing_dimensions.append('grubość')
                
                if missing_dimensions:
                    has_dimension_issues = True
                    products_with_issues.append({
                        'product_id': product.get('product_id'),
                        'name': product_name,
                        'quantity': product.get('quantity'),
                        'missing_dimensions': missing_dimensions,
                        'current_dimensions': parsed_data
                    })
            
            # Sprawdź czy zamówienie już istnieje w bazie
            exists_in_db = order['order_id'] in existing_order_ids
            
            orders_with_info.append({
                'order_id': order['order_id'],
                'date_add': order['date_add'],
                'delivery_fullname': order.get('delivery_fullname', ''),
                'customer_name': order.get('delivery_fullname', ''),
                'delivery_city': order.get('delivery_city', ''),
                'delivery_postcode': order.get('delivery_postcode', ''),
                'order_status_id': order.get('order_status_id'),
                'order_status': status_map.get(order.get('order_status_id'), ''),
                'order_source_id': order.get('order_source_id'),
                'products': order.get('products', []),
                'products_count': len(order.get('products', [])),
                'order_value': sum(
                    float(p.get('price_brutto', 0)) * int(p.get('quantity', 1))
                    for p in order.get('products', [])
                ),
                'delivery_price': float(order.get('delivery_price', 0)),
                'exists_in_db': exists_in_db,
                'has_dimension_issues': has_dimension_issues,
                'products_with_issues': products_with_issues if has_dimension_issues else [],
                'price_type': price_type  # NOWE POLE
            })

        # Sortuj zamówienia według daty (najnowsze pierwsze)
        orders_with_info.sort(key=lambda x: x['date_add'], reverse=True)

        reports_logger.info("Pobieranie zamówień zakończone",
                          total_orders=len(orders_with_info),
                          iterations=iteration,
                          orders_with_dimension_issues=len([o for o in orders_with_info if o['has_dimension_issues']]),
                          filtered_excluded_statuses=not get_all_statuses)

        return jsonify({
            'success': True,
            'orders': orders_with_info,
            'total_found': len(orders_with_info),
            'pagination_info': {
                'iterations': iteration,
                'max_iterations_reached': iteration >= max_iterations,
                'filtered_excluded_statuses': not get_all_statuses,
                'excluded_status_ids': [105112, 138625] if not get_all_statuses else []
            }
        })
        
    except Exception as e:
        reports_logger.error("Błąd pobierania zamówień do wyboru",
                           user_email=user_email,
                           error=str(e),
                           error_type=type(e).__name__)
        return jsonify({
            'success': False,
            'error': f'Błąd pobierania zamówień: {str(e)}'
        }), 500
    
@reports_bp.route('/api/save-selected-orders-with-dimensions', methods=['POST'])
@login_required
def api_save_selected_orders_with_dimensions():
    """
    NOWY ENDPOINT: Zapisuje wybrane zamówienia z opcjonalnym uzupełnieniem wymiarów
    """
    user_email = session.get('user_email')
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'Brak danych w zapytaniu'
            }), 400

        order_ids = data.get('order_ids', [])
        dimension_fixes = data.get('dimension_fixes', {})  # {order_id: {product_id: {length_cm: X, width_cm: Y, thickness_mm: Z}}}

        if not order_ids:
            return jsonify({
                'success': False,
                'error': 'Brak wybranych zamówień do zapisania'
            }), 400

        reports_logger.info("Rozpoczęcie zapisywania zamówień z wymiarami",
                          user_email=user_email,
                          order_ids_count=len(order_ids),
                          has_dimension_fixes=bool(dimension_fixes))

        # Walidacja ID zamówień
        try:
            order_ids = [int(order_id) for order_id in order_ids]
        except (ValueError, TypeError) as e:
            return jsonify({
                'success': False,
                'error': 'Błędne ID zamówień'
            }), 400

        # Sprawdź które zamówienia już istnieją w bazie
        existing_orders = BaselinkerReportOrder.query.filter(
            BaselinkerReportOrder.baselinker_order_id.in_(order_ids)
        ).with_entities(BaselinkerReportOrder.baselinker_order_id).distinct().all()
        existing_order_ids = {order.baselinker_order_id for order in existing_orders}

        # Filtruj tylko nowe zamówienia
        new_order_ids = [order_id for order_id in order_ids if order_id not in existing_order_ids]

        if not new_order_ids:
            return jsonify({
                'success': True,
                'message': 'Wszystkie wybrane zamówienia już istnieją w bazie danych',
                'orders_saved': 0,
                'orders_skipped': len(order_ids)
            })

        # Pobierz service
        service = get_reports_service()
        
        # Zastosuj poprawki wymiarów jeśli zostały podane
        if dimension_fixes:
            service.set_dimension_fixes(dimension_fixes)
            reports_logger.info("Zastosowano poprawki wymiarów", 
                              fixes_count=len(dimension_fixes))

        # Synchronizuj wybrane zamówienia
        result = _sync_selected_orders(service, new_order_ids)
        
        # Wyczyść poprawki wymiarów
        if dimension_fixes:
            service.clear_dimension_fixes()

        if result.get('success'):
            reports_logger.info("Zapisywanie zamówień z wymiarami zakończone pomyślnie",
                              orders_processed=result.get('orders_processed', 0),
                              orders_added=result.get('orders_added', 0))
            return jsonify(result)
        else:
            return jsonify(result), 500
            
    except Exception as e:
        reports_logger.error("Błąd zapisywania zamówień z wymiarami",
                           user_email=user_email,
                           error=str(e))
        return jsonify({
            'success': False,
            'error': f'Błąd zapisywania zamówień: {str(e)}'
        }), 500

def check_product_dimensions(product_name):
    """
    NOWA FUNKCJA: Sprawdza czy nazwa produktu zawiera wymiary
    NAPRAWIONE: Obsługuje liczby z przecinkami i kropkami
    
    Args:
        product_name (str): Nazwa produktu
        
    Returns:
        bool: True jeśli produkt ma wymiary, False jeśli nie
    """
    if not product_name:
        return False
    
    name_lower = product_name.lower()
    
    # NAPRAWIONE: Wzorce obsługujące liczby z przecinkami i kropkami
    dimension_patterns = [
        # Klasyczne formaty 3 wymiarów (z kropkami i przecinkami)
        r'\d+[,.]?\d*\s*x\s*\d+[,.]?\d*\s*x\s*\d+[,.]?\d*',  # 200,4x89x4.5
        r'\d+[,.]?\d*\s*×\s*\d+[,.]?\d*\s*×\s*\d+[,.]?\d*',  # 200,4×89×4.5
        
        # Format 2 wymiarów (z kropkami i przecinkami)
        r'\d+[,.]?\d*\s*x\s*\d+[,.]?\d*(?!\s*x)',  # 200,4x89 (ale nie x coś dalej)
        r'\d+[,.]?\d*\s*×\s*\d+[,.]?\d*(?!\s*×)',  # 200,4×89
        
        # Z jednostkami cm/mm
        r'\d+[,.]?\d*\s*cm\s*x\s*\d+[,.]?\d*\s*cm',  # 200,4cm x 89cm
        r'\d+[,.]?\d*\s*mm\s*x\s*\d+[,.]?\d*\s*mm',  # 200,4mm x 89mm
        r'\d+[,.]?\d*\s*cm\s*×\s*\d+[,.]?\d*\s*cm',  # 200,4cm × 89cm
        
        # Wymiary w tekście
        r'długość\s*:?\s*\d+[,.]?\d*',  # "długość: 200,4"
        r'szerokość\s*:?\s*\d+[,.]?\d*',  # "szerokość: 89"
        r'grubość\s*:?\s*\d+[,.]?\d*',  # "grubość: 4,5"
        r'wysokość\s*:?\s*\d+[,.]?\d*',  # "wysokość: 4,5"
        r'głębokość\s*:?\s*\d+[,.]?\d*',  # "głębokość: 4,5"
        
        # Dodatkowe formaty
        r'\d+[,.]?\d*\s*/\s*\d+[,.]?\d*\s*/\s*\d+[,.]?\d*',  # 200,4/89/4.5
        r'\d+[,.]?\d*-\d+[,.]?\d*-\d+[,.]?\d*',  # 200,4-89-4.5
        
        # Wymiary w nawiasach
        r'\(\s*\d+[,.]?\d*\s*x\s*\d+[,.]?\d*.*?\)',  # (200,4 x 89)
        r'\[\s*\d+[,.]?\d*\s*x\s*\d+[,.]?\d*.*?\]',  # [200,4 x 89]
    ]
    
    import re
    for pattern in dimension_patterns:
        if re.search(pattern, name_lower):
            print(f"[DEBUG] Znaleziono wymiary w '{product_name}' przy użyciu wzorca: {pattern}")
            return True
    
    # Dodatkowe sprawdzenia heurystyczne
    has_numbers = any(char.isdigit() for char in product_name)
    has_dimension_separators = any(sep in name_lower for sep in ['x', '×', '/', '-'])
    has_units = any(unit in name_lower for unit in ['cm', 'mm', 'm'])
    
    # Jeśli ma liczby i separatory wymiarów lub jednostki
    if has_numbers and (has_dimension_separators or has_units):
        # Dodatkowa walidacja - sprawdź czy to nie jest tylko data lub numer zamówienia
        date_patterns = [
            r'\d{1,2}[.-/]\d{1,2}[.-/]\d{2,4}',  # Daty
            r'\d{4,}',  # Długie numery (prawdopodobnie ID)
        ]
        
        is_probably_date_or_id = any(re.search(pattern, product_name) for pattern in date_patterns)
        
        if not is_probably_date_or_id:
            print(f"[DEBUG] Prawdopodobnie wymiary w '{product_name}' (heurystyka)")
            return True
    
    print(f"[DEBUG] Brak wymiarów w '{product_name}'")
    return False

@reports_bp.route('/api/save-selected-orders', methods=['POST'])
@login_required
def api_save_selected_orders():
    """
    NOWY ENDPOINT: Zapisuje wybrane zamówienia do bazy danych
    """
    user_email = session.get('user_email')
    
    try:
        data = request.get_json()
        if not data:
            reports_logger.error("Brak danych w zapytaniu save-selected-orders",
                               user_email=user_email)
            return jsonify({
                'success': False,
                'error': 'Brak danych w zapytaniu'
            }), 400

        order_ids = data.get('order_ids', [])
        date_from = data.get('date_from')
        date_to = data.get('date_to')

        if not order_ids:
            return jsonify({
                'success': False,
                'error': 'Brak wybranych zamówień do zapisania'
            }), 400

        reports_logger.info("Rozpoczęcie zapisywania wybranych zamówień",
                          user_email=user_email,
                          order_ids_count=len(order_ids),
                          order_ids=order_ids,
                          date_from=date_from,
                          date_to=date_to)

        # Walidacja ID zamówień
        try:
            order_ids = [int(order_id) for order_id in order_ids]
        except (ValueError, TypeError) as e:
            reports_logger.error("Błędne ID zamówień",
                               user_email=user_email,
                               order_ids=order_ids,
                               error=str(e))
            return jsonify({
                'success': False,
                'error': 'Błędne ID zamówień'
            }), 400

        # Sprawdź które zamówienia już istnieją w bazie
        existing_orders = BaselinkerReportOrder.query.filter(
            BaselinkerReportOrder.baselinker_order_id.in_(order_ids)
        ).with_entities(BaselinkerReportOrder.baselinker_order_id).distinct().all()
        existing_order_ids = {order.baselinker_order_id for order in existing_orders}

        # Filtruj tylko nowe zamówienia
        new_order_ids = [order_id for order_id in order_ids if order_id not in existing_order_ids]

        reports_logger.info("Analiza zamówień do zapisania",
                          total_requested=len(order_ids),
                          existing_in_db=len(existing_order_ids),
                          new_to_save=len(new_order_ids),
                          existing_order_ids=list(existing_order_ids),
                          new_order_ids=new_order_ids)

        if not new_order_ids:
            reports_logger.warning("Wszystkie wybrane zamówienia już istnieją w bazie",
                                 user_email=user_email,
                                 requested_orders=order_ids)
            return jsonify({
                'success': True,
                'message': 'Wszystkie wybrane zamówienia już istnieją w bazie danych',
                'orders_saved': 0,
                'orders_skipped': len(order_ids),
                'existing_orders': order_ids
            })

        # Użyj istniejącej funkcji synchronizacji dla wybranych zamówień
        service = get_reports_service()
        
        reports_logger.info("Wywołanie synchronizacji dla wybranych zamówień",
                          new_order_ids=new_order_ids)

        # Użyj funkcji _sync_selected_orders (może trzeba będzie ją zmodyfikować)
        result = _sync_selected_orders(service, new_order_ids)

        if result.get('success'):
            reports_logger.info("Zapisywanie wybranych zamówień zakończone pomyślnie",
                              user_email=user_email,
                              orders_requested=len(order_ids),
                              orders_saved=result.get('orders_added', 0),
                              orders_updated=result.get('orders_updated', 0),
                              orders_processed=result.get('orders_processed', 0))

            return jsonify({
                'success': True,
                'message': f'Pomyślnie zapisano {result.get("orders_added", 0)} zamówień',
                'orders_saved': result.get('orders_added', 0),
                'orders_updated': result.get('orders_updated', 0),
                'orders_processed': result.get('orders_processed', 0),
                'orders_skipped': len(existing_order_ids),
                'existing_orders': list(existing_order_ids)
            })
        else:
            error_msg = result.get('error', 'Nieznany błąd synchronizacji')
            reports_logger.error("Błąd podczas zapisywania wybranych zamówień",
                               user_email=user_email,
                               error=error_msg)
            return jsonify({
                'success': False,
                'error': f'Błąd zapisywania: {error_msg}'
            }), 500

    except Exception as e:
        reports_logger.error("Błąd zapisywania wybranych zamówień",
                           user_email=user_email,
                           error=str(e),
                           error_type=type(e).__name__)
        return jsonify({
            'success': False,
            'error': f'Błąd serwera: {str(e)}'
        }), 500

@reports_bp.route('/api/export-routimo', methods=['GET'])
@login_required
def export_routimo():
    """
    Eksport danych do formatu Routimo CSV
    Tylko zamówienia ze statusem transport WoodPower
    """
    try:
        user_email = session.get('user_email')
        reports_logger.info("Rozpoczęcie eksportu Routimo", user_email=user_email)
        
        # Pobierz parametry filtrowania
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
        
        # KLUCZOWE: Filtruj tylko statusy transport WoodPower
        routimo_statuses = [
            'Wysłane - transport WoodPower',
            'Wysł. - trans. WP'
        ]
        
        # Używaj SQLAlchemy ORM jak reszta modułu
        query = BaselinkerReportOrder.query
        
        # Filtruj po dacie
        if date_from:
            query = query.filter(BaselinkerReportOrder.date_created >= date_from)
        if date_to:
            query = query.filter(BaselinkerReportOrder.date_created <= date_to)
            
        # Filtruj po statusie - TYLKO transport WoodPower
        query = query.filter(BaselinkerReportOrder.current_status.in_(routimo_statuses))
        
        # Sortuj po dacie i ID zamówienia
        query = query.order_by(
            BaselinkerReportOrder.date_created.desc(),
            BaselinkerReportOrder.baselinker_order_id
        )
        
        # Wykonaj zapytanie
        orders = query.all()
        
        if not orders:
            return jsonify({
                'success': False,
                'error': 'Brak zamówień ze statusem "Wysłane - transport WoodPower" w wybranym okresie. Sprawdź filtry i statusy zamówień.'
            }), 400
        
        reports_logger.info("Pobrano dane do eksportu Routimo",
                          user_email=user_email,
                          raw_records=len(orders),
                          date_from=date_from.isoformat() if date_from else None,
                          date_to=date_to.isoformat() if date_to else None)
            
        # Grupuj dane po zamówieniach
        grouped_orders = group_orders_for_routimo(orders)
        
        # Generuj CSV
        csv_content = generate_routimo_csv(grouped_orders)
        
        # Przygotuj response
        filename = f"routimo_export_{datetime.now().strftime('%Y-%m-%d')}.csv"
        
        response = make_response(csv_content)
        response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
        response.headers['Content-Type'] = 'text/csv; charset=utf-8'
        
        reports_logger.info("Wygenerowano eksport Routimo",
                          user_email=user_email,
                          grouped_orders=len(grouped_orders),
                          filename=filename)
        
        return response
        
    except Exception as e:
        reports_logger.error("Błąd eksportu Routimo",
                           user_email=user_email if 'user_email' in locals() else 'unknown',
                           error=str(e))
        return jsonify({
            'success': False,
            'error': f'Błąd eksportu Routimo: {str(e)}'
        }), 500


def group_orders_for_routimo(orders):
    """
    Grupuje dane po zamówieniach dla eksportu Routimo
    Jedno zamówienie = jeden wiersz w CSV
    
    Args:
        orders (List[BaselinkerReportOrder]): Lista rekordów z bazy danych
        
    Returns:
        List[Dict]: Lista zamówień zgrupowanych
    """
    grouped = defaultdict(lambda: {
        'records': [],
        'baselinker_order_id': None,
        'customer_name': None,
        'delivery_address': None,
        'delivery_postcode': None,
        'delivery_city': None,
        'delivery_state': None,
        'phone': None,
        'email': None,
        'total_quantity': 0,
        'total_volume': 0,
        'total_value_net': 0,
        'current_status': None
    })
    
    for order in orders:
        # Klucz grupowania - baselinker_order_id lub manual_id
        if order.baselinker_order_id:
            order_key = f"bl_{order.baselinker_order_id}"
        else:
            order_key = f"manual_{order.id}"
            
        order_group = grouped[order_key]
        order_group['records'].append(order)
        
        # Ustaw dane zamówienia (z pierwszego rekordu)
        if not order_group['customer_name']:
            order_group['baselinker_order_id'] = order.baselinker_order_id or f"Manual_{order.id}"
            order_group['customer_name'] = order.customer_name or ''
            order_group['delivery_address'] = order.delivery_address or ''
            order_group['delivery_postcode'] = order.delivery_postcode or ''
            order_group['delivery_city'] = order.delivery_city or ''
            order_group['delivery_state'] = order.delivery_state or ''
            order_group['phone'] = order.phone or ''
            order_group['email'] = order.email or ''
            order_group['current_status'] = order.current_status or ''
        
        # Sumuj wartości - POPRAWKA: używaj właściwości SQLAlchemy
        order_group['total_quantity'] += float(order.quantity or 0)
        order_group['total_volume'] += float(order.total_volume or 0)
        order_group['total_value_net'] += float(order.value_net or 0)
    
    # Konwertuj na listę
    result = []
    for order_key, order_data in grouped.items():
        result.append(order_data)
    
    reports_logger.info("Zgrupowano zamówienia dla Routimo",
                      raw_records=len(orders),
                      grouped_orders=len(result))
    
    return result


def extract_house_and_apartment_number(address):
    """
    Wyciąga numer domu i mieszkania z adresu oraz zwraca oczyszczoną ulicę
    Obsługuje formaty: "ul. Nazwa 123", "123 Nazwa ulicy", "Nazwa 123/45"
    
    Args:
        address (str): Pełny adres
        
    Returns:
        tuple: (house_number, apartment_number, clean_street)
    """
    if not address or not isinstance(address, str):
        return '', '', address or ''
        
    original_address = address.strip()
    
    # WZORCE - NUMER PO NAZWIE ULICY (tradycyjne)
    traditional_patterns = [
        # "ul. Nazwa 123/45" 
        {
            'pattern': r'^(.+?)\s+(\d+[A-Za-z]*)\/(\d+[A-Za-z]*)$',
            'has_apartment': True,
            'street_group': 1,
            'house_group': 2,
            'apartment_group': 3
        },
        # "ul. Nazwa 123 / 45" (ze spacjami)  
        {
            'pattern': r'^(.+?)\s+(\d+[A-Za-z]*)\s*\/\s*(\d+[A-Za-z]*)$',
            'has_apartment': True,
            'street_group': 1,
            'house_group': 2,
            'apartment_group': 3
        },
        # "ul. Nazwa 123m45"
        {
            'pattern': r'^(.+?)\s+(\d+[A-Za-z]*)\s*m\.?\s*(\d+[A-Za-z]*)$',
            'has_apartment': True,
            'street_group': 1,
            'house_group': 2,
            'apartment_group': 3
        },
        # "ul. Nazwa 123" (tylko dom)
        {
            'pattern': r'^(.+?)\s+(\d+[A-Za-z]*)\s*$',
            'has_apartment': False,
            'street_group': 1,
            'house_group': 2,
            'apartment_group': None
        }
    ]
    
    # WZORCE - NUMER PRZED NAZWĄ ULICY (odwrócone)
    reversed_patterns = [
        # "123/45 Nazwa ulicy"
        {
            'pattern': r'^(\d+[A-Za-z]*)\/(\d+[A-Za-z]*)\s+(.+)$',
            'has_apartment': True,
            'street_group': 3,
            'house_group': 1,
            'apartment_group': 2
        },
        # "123 / 45 Nazwa ulicy" (ze spacjami)
        {
            'pattern': r'^(\d+[A-Za-z]*)\s*\/\s*(\d+[A-Za-z]*)\s+(.+)$',
            'has_apartment': True,
            'street_group': 3,
            'house_group': 1,
            'apartment_group': 2
        },
        # "123m45 Nazwa ulicy"
        {
            'pattern': r'^(\d+[A-Za-z]*)\s*m\.?\s*(\d+[A-Za-z]*)\s+(.+)$',
            'has_apartment': True,
            'street_group': 3,
            'house_group': 1,
            'apartment_group': 2
        },
        # "123 Nazwa ulicy" (tylko dom)
        {
            'pattern': r'^(\d+[A-Za-z]*)\s+(.+)$',
            'has_apartment': False,
            'street_group': 2,
            'house_group': 1,
            'apartment_group': None
        }
    ]
    
    # Sprawdź wszystkie wzorce - najpierw tradycyjne, potem odwrócone
    all_patterns = traditional_patterns + reversed_patterns
    
    for pattern_info in all_patterns:
        match = re.search(pattern_info['pattern'], original_address, re.IGNORECASE)
        if match:
            groups = match.groups()
            
            # Wyciągnij komponenty według grup
            street = groups[pattern_info['street_group'] - 1].strip()
            house = groups[pattern_info['house_group'] - 1].strip()
            apartment = ''
            
            if pattern_info['has_apartment'] and pattern_info['apartment_group']:
                apartment = groups[pattern_info['apartment_group'] - 1].strip()
            
            # Sprawdź czy ulica nie jest pusta
            if not street:
                continue
                
            # Oczyść ulicę delikatnie
            clean_street = clean_street_name(street)
            
            # Jeśli po czyszczeniu ulica jest pusta, spróbuj następny wzorzec
            if not clean_street:
                continue
                
            return house, apartment, clean_street
    
    # Fallback - nie znaleziono wzorca, zwróć oryginalny adres
    return '', '', original_address


def clean_street_name(street):
    """
    Delikatnie czyści nazwę ulicy z niepotrzebnych elementów
    POPRAWKA: Nie usuwa "Aleja" jeśli to część nazwy ulicy
    
    Args:
        street (str): Surowa nazwa ulicy
        
    Returns:
        str: Oczyszczona nazwa ulicy
    """
    if not street:
        return ''
    
    # Usuń zbędne białe znaki
    street = street.strip()
    
    # Usuń końcowe przecinki i kropki
    street = re.sub(r'[,\.]+$', '', street).strip()
    
    # Usuń miasto z początku (tylko jeśli po przecinku jest coś więcej)
    # "Warszawa, ul. Nowa" → "ul. Nowa"
    city_pattern = r'^([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)\s*,\s*(.+)$'
    city_match = re.match(city_pattern, street)
    if city_match and city_match.group(2).strip():
        street = city_match.group(2).strip()
    
    # POPRAWKA: Usuń prefiksy TYLKO jeśli są na początku i po nich jest jeszcze tekst
    # ALE zachowaj "Aleja Nazwa" jako całość - nie traktuj "Aleja" jako prefiksu do usunięcia
    
    # Lista prefixów do usunięcia TYLKO jeśli są na samym początku
    prefixes_to_remove = ['ul', 'ulica']  # Skróciłem listę!
    
    for prefix in prefixes_to_remove:
        # Usuń tylko "ul." lub "ulica" na początku, ale zostaw "al.", "pl.", "os."
        pattern = rf'^{prefix}\.?\s+(.+)$'
        match = re.match(pattern, street, re.IGNORECASE)
        if match and match.group(1).strip():
            street = match.group(1).strip()
            break  # Usuń tylko pierwszy pasujący prefiks
    
    return street

def generate_routimo_csv(grouped_orders):
    """
    Generuje CSV w formacie Routimo
    """
    # Nagłówki pozostają bez zmian...
    headers = [
        'Nazwa', 'Klient', 'Nazwa przesyłki', 'Ulica', 'Numer domu', 'Numer mieszkania',
        'Kod pocztowy', 'Miasto', 'Kraj', 'Region', 'Numer telefonu', 'Email',
        'Email klienta', 'Nip klienta', 'Początek okna czasowego', 'Koniec okna czasowego',
        'Okno czasowe', 'Czas na wykonanie zadania', 'Oczekiwana data realizacji',
        'Harmonogram', 'Pojazd', 'Typy pojazdów', 'Liczba przesyłek', 'Wielkość przesyłki',
        'Waga przesyłki', 'Wartość przesyłki', 'Forma płatności', 'Waluta',
        'Szerokość geograficzna', 'Długość geograficzna', 'Komentarz', 'Komentarz 2',
        'Uwagi', 'Dodatkowe 1', 'Dodatkowe 2'
    ]
    
    output = io.StringIO()
    writer = csv.writer(output, delimiter=',', quotechar='"', quoting=csv.QUOTE_MINIMAL)
    writer.writerow(headers)
    
    for order in grouped_orders:
        # ZMIANA: Używaj nowej funkcji z czyszczeniem ulicy
        house_number, apartment_number, clean_street = extract_house_and_apartment_number(order['delivery_address'])
        
        # Oblicz wagę
        weight = round(order['total_volume'] * 800, 2)
        
        row = [
            order['customer_name'],                    # A - Nazwa
            order['customer_name'],                    # B - Klient
            order['baselinker_order_id'],              # C - Nazwa przesyłki
            clean_street,                              # D - Ulica (OCZYSZCZONA!)
            house_number,                              # E - Numer domu
            apartment_number,                          # F - Numer mieszkania
            order['delivery_postcode'],                # G - Kod pocztowy
            order['delivery_city'],                    # H - Miasto
            'Polska',                                  # I - Kraj
            order['delivery_state'],                   # J - Region
            order['phone'],                            # K - Numer telefonu
            '',                                        # L - Email (puste)
            order['email'],                            # M - Email klienta
            '',                                        # N - Nip klienta (puste)
            '',                                        # O - Początek okna czasowego (puste)
            '',                                        # P - Koniec okna czasowego (puste)
            '',                                        # Q - Okno czasowe (puste)
            '',                                        # R - Czas na wykonanie zadania (puste)
            '',                                        # S - Oczekiwana data realizacji (puste)
            '',                                        # T - Harmonogram (puste)
            '',                                        # U - Pojazd (puste)
            '',                                        # V - Typy pojazdów (puste)
            int(order['total_quantity']),              # W - Liczba przesyłek
            round(order['total_volume'], 4),           # X - Wielkość przesyłki (m³)
            weight,                                    # Y - Waga przesyłki (kg)
            round(order['total_value_net'], 2),        # Z - Wartość przesyłki
            '',                                        # AA - Forma płatności (puste)
            'PLN',                                     # AB - Waluta
            '',                                        # AC - Szerokość geograficzna (puste)
            '',                                        # AD - Długość geograficzna (puste)
            '',                                        # AE - Komentarz (puste)
            '',                                        # AF - Komentarz 2 (puste)
            '',                                        # AG - Uwagi (puste)
            '',                                        # AH - Dodatkowe 1 (puste)
            '',                                        # AI - Dodatkowe 2 (puste)
        ]
        
        writer.writerow(row)
    
    csv_content = output.getvalue()
    output.close()
    
    reports_logger.info("Wygenerowano CSV dla Routimo z oczyszczonymi adresami",
                      orders_count=len(grouped_orders))
    
    return csv_content