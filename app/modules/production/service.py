# modules/production/service.py
"""
Serwis do komunikacji z Baselinker API i logika biznesowa modułu Production
"""

import requests
import json
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta, date
from flask import current_app
from extensions import db
from .models import (
    ProductionItem, ProductionStatus, ProductionStation, 
    Worker, ProductionConfig, ProductionOrderSummary
)
from .utils import ProductionPriorityCalculator, ProductionNameParser
from modules.logging import get_structured_logger

# Inicjalizacja loggera
production_logger = get_structured_logger('production.service')
production_logger.info("✅ production_logger zainicjowany poprawnie w service.py")


class ProductionService:
    """
    Główny serwis modułu produkcyjnego
    """
    
    def __init__(self):
        self.api_key = current_app.config.get('API_BASELINKER', {}).get('api_key')
        self.endpoint = current_app.config.get('API_BASELINKER', {}).get('endpoint')
        self.logger = get_structured_logger('production.service')
        self.priority_calculator = ProductionPriorityCalculator()
        self.name_parser = ProductionNameParser()
        
        # Statusy zamówień do pobierania z Baselinker
        self.target_statuses = [138619, 155824]  # W produkcji - surowe, Nowe - opłacone
        
        # Mapowanie statusów Baselinker (opcjonalne - na przyszłość)
        self.status_map = {
            138619: "W produkcji - surowe",
            155824: "Nowe - opłacone"
        }
    
    def _make_baselinker_request(self, method: str, parameters: dict) -> dict:
        """
        Wykonuje żądanie do API Baselinker
        
        Args:
            method: Nazwa metody API
            parameters: Parametry żądania
            
        Returns:
            dict: Odpowiedź z API
        """
        if not self.api_key or not self.endpoint:
            raise ValueError("Brak konfiguracji API Baselinker")
        
        data = {
            'token': self.api_key,
            'method': method,
            'parameters': json.dumps(parameters)
        }
        
        try:
            response = requests.post(self.endpoint, data=data, timeout=30)
            response.raise_for_status()
            
            result = response.json()
            
            if result.get('status') == 'ERROR':
                error_message = result.get('error_message', 'Nieznany błąd API')
                self.logger.error("Błąd API Baselinker",
                                method=method, error=error_message)
                raise Exception(f"Baselinker API error: {error_message}")
            
            self.logger.debug("Pomyślne żądanie Baselinker API",
                            method=method, response_size=len(str(result)))
            
            return result
            
        except requests.exceptions.RequestException as e:
            self.logger.error("Błąd połączenia z Baselinker API",
                            method=method, error=str(e), error_type=type(e).__name__)
            raise Exception(f"Błąd połączenia z Baselinker: {str(e)}")
    
    def get_orders_by_status(self, status_id: int, date_from: str = None, date_to: str = None) -> List[dict]:
        """
        Pobiera zamówienia z Baselinker według statusu
        
        Args:
            status_id: ID statusu w Baselinker
            date_from: Data od (YYYY-MM-DD)
            date_to: Data do (YYYY-MM-DD)
            
        Returns:
            List[dict]: Lista zamówień
        """
        parameters = {
            'status_id': status_id,
            'get_unconfirmed_orders': True,
            'include_custom_extra_fields': True
        }
        
        if date_from:
            date_from_timestamp = int(datetime.strptime(date_from, '%Y-%m-%d').timestamp())
            parameters['date_confirmed_from'] = date_from_timestamp
        
        if date_to:
            date_to_timestamp = int(datetime.strptime(date_to, '%Y-%m-%d').timestamp())
            parameters['date_confirmed_to'] = date_to_timestamp
        
        try:
            result = self._make_baselinker_request('getOrders', parameters)
            orders = result.get('orders', [])
            
            self.logger.info("Pobrano zamówienia z Baselinker",
                           status_id=status_id, orders_count=len(orders),
                           date_from=date_from, date_to=date_to)
            
            return orders
            
        except Exception as e:
            self.logger.error("Błąd podczas pobierania zamówień",
                            status_id=status_id, error=str(e))
            raise
    
    def get_order_products(self, order_id: int) -> List[dict]:
        """
        Pobiera produkty z konkretnego zamówienia
        
        Args:
            order_id: ID zamówienia w Baselinker
            
        Returns:
            List[dict]: Lista produktów
        """
        parameters = {'order_id': order_id}
        
        try:
            result = self._make_baselinker_request('getOrderProducts', parameters)
            products = result.get('products', [])
            
            self.logger.debug("Pobrano produkty zamówienia",
                            order_id=order_id, products_count=len(products))
            
            return products
            
        except Exception as e:
            self.logger.error("Błąd podczas pobierania produktów zamówienia",
                            order_id=order_id, error=str(e))
            raise
    
    def process_order_from_baselinker(self, order_data: dict) -> dict:
        """
        Przetwarza zamówienie z Baselinker i tworzy ProductionItems
        
        Args:
            order_data: Dane zamówienia z Baselinker API
            
        Returns:
            dict: Statystyki przetwarzania
        """
        order_id = order_data.get('order_id')
        
        if not order_id:
            raise ValueError("Brak order_id w danych zamówienia")
        
        self.logger.info("Przetwarzanie zamówienia z Baselinker", order_id=order_id)
        
        try:
            # Sprawdź czy zamówienie już istnieje w systemie
            existing_items = ProductionItem.query.filter_by(
                baselinker_order_id=order_id
            ).all()
            
            existing_product_ids = {item.baselinker_order_product_id for item in existing_items}
            
            # Pobierz produkty z zamówienia
            products = order_data.get('products', [])
            
            if not products:
                self.logger.warning("Zamówienie bez produktów", order_id=order_id)
                return {'added': 0, 'updated': 0, 'skipped': 0}
            
            # Pobierz statusy produkcji
            pending_status = ProductionStatus.query.filter_by(name='pending').first()
            if not pending_status:
                raise ValueError("Brak statusu 'pending' w bazie danych")
            
            stats = {'added': 0, 'updated': 0, 'skipped': 0}
            
            # Przetwórz każdy produkt
            for product in products:
                product_id = product.get('order_product_id')
                
                if not product_id:
                    self.logger.warning("Produkt bez order_product_id", order_id=order_id)
                    stats['skipped'] += 1
                    continue
                
                # Sprawdź czy produkt już istnieje
                if product_id in existing_product_ids:
                    self.logger.debug("Produkt już istnieje w systemie",
                                    order_id=order_id, product_id=product_id)
                    stats['skipped'] += 1
                    continue
                
                # Parsuj nazwę produktu
                product_name = product.get('name', '')
                parsed_data = self.name_parser.parse_product_name(product_name)
                
                # Oblicz deadline (order_date + 14 dni)
                order_date = datetime.fromtimestamp(order_data.get('date_add', 0)).date()
                deadline_date = order_date + timedelta(days=14)
                
                # Oblicz priorytet i grupę
                priority_data = self.priority_calculator.calculate_priority(
                    wood_species=parsed_data.get('wood_species'),
                    wood_technology=parsed_data.get('wood_technology'),
                    wood_class=parsed_data.get('wood_class'),
                    deadline_date=deadline_date,
                    order_size=len(products)
                )

                # DODAJ NOWY KOD - automatyczne ustawienie pozycji w kolejce:
                # Znajdź ostatnią pozycję w kolejce i dodaj 1
                last_item = ProductionItem.query.join(ProductionStatus).filter(
                    ProductionStatus.name == 'pending'
                ).order_by(ProductionItem.priority_score.desc()).first()

                next_position = (last_item.priority_score + 1) if last_item else 1

                # Utwórz ProductionItem
                production_item = ProductionItem(
                    baselinker_order_id=order_id,
                    baselinker_order_product_id=product_id,
                    product_name=product_name,
                    quantity=product.get('quantity', 1),
    
                    # Parsowane dane
                    wood_species=parsed_data.get('wood_species'),
                    wood_technology=parsed_data.get('wood_technology'),
                    wood_class=parsed_data.get('wood_class'),
                    dimensions_length=parsed_data.get('dimensions_length'),
                    dimensions_width=parsed_data.get('dimensions_width'),
                    dimensions_thickness=parsed_data.get('dimensions_thickness'),
                    finish_type=parsed_data.get('finish_type'),
    
                    # Priorytety - ZMIENIONE
                    deadline_date=deadline_date,
                    priority_score=next_position,  # Kolejna pozycja zamiast obliczonego priority_score
                    priority_group=priority_data['priority_group'],
    
                    # Status
                    status_id=pending_status.id,
    
                    # Metadane
                    imported_from_baselinker_at=datetime.utcnow()
                )
                
                db.session.add(production_item)
                stats['added'] += 1
                
                self.logger.debug("Utworzono ProductionItem",
                                order_id=order_id, product_id=product_id,
                                product_name=product_name[:50])
            
            # Utwórz lub zaktualizuj podsumowanie zamówienia
            customer_name = order_data.get('delivery_fullname') or order_data.get('invoice_fullname')
            internal_order_number = order_data.get('extra_field_1')
            
            ProductionOrderSummary.create_or_update_from_items(
                baselinker_order_id=order_id,
                customer_name=customer_name,
                internal_order_number=internal_order_number
            )
            
            db.session.commit()
            
            self.logger.info("Zamówienie przetworzone pomyślnie",
                           order_id=order_id, stats=stats)
            
            return stats
            
        except Exception as e:
            self.logger.error("Błąd podczas przetwarzania zamówienia",
                            order_id=order_id, error=str(e), error_type=type(e).__name__)
            db.session.rollback()
            raise
    
    def sync_orders_by_status(self, status_id: int, date_from: str = None, date_to: str = None) -> dict:
        """
        Synchronizuje zamówienia z konkretnym statusem
        
        Args:
            status_id: ID statusu w Baselinker
            date_from: Data od
            date_to: Data do
            
        Returns:
            dict: Statystyki synchronizacji
        """
        self.logger.info("Rozpoczęcie synchronizacji zamówień",
                       status_id=status_id, date_from=date_from, date_to=date_to)
        
        try:
            # Pobierz zamówienia z Baselinker
            orders = self.get_orders_by_status(status_id, date_from, date_to)
            
            total_stats = {'orders_processed': 0, 'orders_added': 0, 'orders_updated': 0, 'items_added': 0}
            
            for order in orders:
                try:
                    stats = self.process_order_from_baselinker(order)
                    total_stats['orders_processed'] += 1
                    
                    if stats['added'] > 0:
                        total_stats['orders_added'] += 1
                        total_stats['items_added'] += stats['added']
                    
                    if stats['updated'] > 0:
                        total_stats['orders_updated'] += 1
                        
                except Exception as e:
                    self.logger.error("Błąd przetwarzania pojedynczego zamówienia",
                                    order_id=order.get('order_id'), error=str(e))
                    continue
            
            self.logger.info("Synchronizacja zamówień zakończona",
                           status_id=status_id, stats=total_stats)
            
            return total_stats
            
        except Exception as e:
            self.logger.error("Błąd podczas synchronizacji zamówień",
                            status_id=status_id, error=str(e))
            raise
    
    def sync_new_orders(self) -> dict:
        """
        Synchronizuje nowe zamówienia ze wszystkich target statusów
        
        Returns:
            dict: Statystyki synchronizacji
        """
        self.logger.info("Rozpoczęcie synchronizacji nowych zamówień",
                       target_statuses=self.target_statuses)
        
        total_stats = {'orders_processed': 0, 'orders_added': 0, 'orders_updated': 0, 'items_added': 0}
        
        for status_id in self.target_statuses:
            try:
                # Synchronizuj zamówienia z ostatnich 7 dni
                date_from = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
                date_to = datetime.now().strftime('%Y-%m-%d')
                
                stats = self.sync_orders_by_status(status_id, date_from, date_to)
                
                # Dodaj do łącznych statystyk
                for key in total_stats:
                    total_stats[key] += stats.get(key, 0)
                    
            except Exception as e:
                self.logger.error("Błąd synchronizacji statusu",
                                status_id=status_id, error=str(e))
                continue
        
        self.logger.info("Synchronizacja nowych zamówień zakończona",
                       stats=total_stats)

        # Jeśli dodano nowe produkty, przenumeruj całą kolejkę
        if total_stats.get('items_added', 0) > 0:
            try:
                self.logger.info("Przenumerowywanie kolejki po synchronizacji",
                               items_added=total_stats['items_added'])
            
                # Użyj kalkulatora priorytetów do przenumerowania
                result = self.priority_calculator.renumber_production_queue()
            
                if result.get('success'):
                    total_stats['queue_renumbered'] = True
                    total_stats['renumbered_items'] = result.get('renumbered', 0)
                    self.logger.info("Kolejka przenumerowana po synchronizacji",
                                   renumbered=result.get('renumbered', 0))
                else:
                    self.logger.warning("Nie udało się przenumerować kolejki",
                                      error=result.get('error'))
                
            except Exception as e:
                self.logger.error("Błąd podczas przenumerowania kolejki po synchronizacji",
                                error=str(e))
                # Nie przerywamy procesu - synchronizacja się udała
    
        self.logger.info("Synchronizacja nowych zamówień zakończona",
                       stats=total_stats)
        
        return total_stats
    
    def sync_orders_by_date(self, date_from: str = None, date_to: str = None) -> dict:
        """
        Synchronizuje zamówienia z określonego zakresu dat
        
        Args:
            date_from: Data od (YYYY-MM-DD)
            date_to: Data do (YYYY-MM-DD)
            
        Returns:
            dict: Statystyki synchronizacji
        """
        # Domyślnie ostatnie 30 dni
        if not date_from:
            date_from = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        if not date_to:
            date_to = datetime.now().strftime('%Y-%m-%d')
        
        self.logger.info("Rozpoczęcie synchronizacji zamówień według dat",
                       date_from=date_from, date_to=date_to)
        
        total_stats = {'orders_processed': 0, 'orders_added': 0, 'orders_updated': 0, 'items_added': 0}
        
        for status_id in self.target_statuses:
            try:
                stats = self.sync_orders_by_status(status_id, date_from, date_to)
                
                # Dodaj do łącznych statystyk
                for key in total_stats:
                    total_stats[key] += stats.get(key, 0)
                    
            except Exception as e:
                self.logger.error("Błąd synchronizacji statusu według dat",
                                status_id=status_id, error=str(e))
                continue
        
        self.logger.info("Synchronizacja zamówień według dat zakończona",
                       date_from=date_from, date_to=date_to, stats=total_stats)
        
        if total_stats.get('items_added', 0) > 0:
            try:
                self.logger.info("Przenumerowywanie kolejki po synchronizacji według dat")
                result = self.priority_calculator.renumber_production_queue()
                if result.get('success'):
                    total_stats['queue_renumbered'] = True
                    total_stats['renumbered_items'] = result.get('renumbered', 0)
            except Exception as e:
                self.logger.error("Błąd przenumerowania po synchronizacji", error=str(e))
    
        return total_stats
    
    def start_production(self, item_id: int, worker_id: int, station_id: int) -> dict:
        """
        Rozpoczyna produkcję produktu na stanowisku
        
        Args:
            item_id: ID produktu
            worker_id: ID pracownika
            station_id: ID stanowiska
            
        Returns:
            dict: Rezultat operacji
        """
        self.logger.info("Rozpoczynanie produkcji",
                       item_id=item_id, worker_id=worker_id, station_id=station_id)
        
        try:
            # Pobierz obiekty
            item = ProductionItem.query.get_or_404(item_id)
            worker = Worker.query.get_or_404(worker_id)
            station = ProductionStation.query.get_or_404(station_id)
            
            # Sprawdź czy stanowisko jest dostępne
            if station.is_busy:
                raise ValueError(f"Stanowisko {station.name} jest zajęte")
            
            # Sprawdź czy pracownik może pracować na tym stanowisku
            if (worker.station_type_preference != 'both' and 
                worker.station_type_preference != station.station_type):
                self.logger.warning("Pracownik przypisany do nieodpowiedniego stanowiska",
                                  worker_id=worker_id, worker_preference=worker.station_type_preference,
                                  station_type=station.station_type)
            
            # Pobierz status "in_progress"
            in_progress_status = ProductionStatus.query.filter_by(name='in_progress').first()
            if not in_progress_status:
                raise ValueError("Brak statusu 'in_progress' w bazie danych")
            
            # Rozpocznij produkcję na poziomie produktu
            item.start_gluing(worker_id, station_id)
            item.status_id = in_progress_status.id
            
            # Ustaw produkt na stanowisku - bezpośrednio bez rekursji
            station.current_item_id = item_id
            station.last_activity_at = datetime.utcnow()
            
            db.session.commit()
            
            result = {
                'item_id': item.id,
                'worker_name': worker.name,
                'station_name': station.name,
                'started_at': item.gluing_started_at.isoformat() if item.gluing_started_at else None
            }
            
            self.logger.info("Produkcja rozpoczęta pomyślnie",
                           item_id=item_id, worker_id=worker_id, station_id=station_id)
            
            return result
            
        except Exception as e:
            self.logger.error("Błąd podczas rozpoczynania produkcji",
                            item_id=item_id, worker_id=worker_id, station_id=station_id,
                            error=str(e), error_type=type(e).__name__)
            db.session.rollback()
            raise
    
    def complete_production(self, item_id: int) -> dict:
        """
        Kończy produkcję produktu
        
        Args:
            item_id: ID produktu
            
        Returns:
            dict: Rezultat operacji
        """
        self.logger.info("Kończenie produkcji", item_id=item_id)
        
        try:
            # Pobierz produkt
            item = ProductionItem.query.get_or_404(item_id)
            
            if not item.gluing_started_at:
                raise ValueError("Produkt nie ma rozpoczętej produkcji")
            
            # Pobierz status "completed"
            completed_status = ProductionStatus.query.filter_by(name='completed').first()
            if not completed_status:
                raise ValueError("Brak statusu 'completed' w bazie danych")
            
            # Zakończ produkcję na poziomie produktu
            item.complete_gluing()
            item.status_id = completed_status.id
            
            # Zwolnij stanowisko
            if item.glued_at_station_id:
                station = ProductionStation.query.get(item.glued_at_station_id)
                if station and station.current_item_id == item_id:
                    station.current_item_id = None
                    station.last_activity_at = datetime.utcnow()
            
            # Zaktualizuj podsumowanie zamówienia
            order_summary = ProductionOrderSummary.query.filter_by(
                baselinker_order_id=item.baselinker_order_id
            ).first()
            if order_summary:
                order_summary.update_completion_status()
            
            db.session.commit()
            
            result = {
                'item': item.to_dict(),
                'duration_seconds': item.gluing_duration_seconds,
                'overtime_seconds': item.gluing_overtime_seconds,
                'completed_at': item.gluing_completed_at.isoformat(),
                'order_completion': order_summary.to_dict() if order_summary else None
            }
            
            self.logger.info("Produkcja zakończona pomyślnie",
                           item_id=item_id, 
                           duration_seconds=item.gluing_duration_seconds,
                           overtime_seconds=item.gluing_overtime_seconds)
            
            return result
            
        except Exception as e:
            self.logger.error("Błąd podczas kończenia produkcji",
                            item_id=item_id, error=str(e), error_type=type(e).__name__)
            db.session.rollback()
            raise
    
    def recalculate_priorities(self) -> dict:
        """
        Przelicza priorytety wszystkich produktów oczekujących
        
        Returns:
            dict: Statystyki przeliczenia
        """
        self.logger.info("Rozpoczęcie przeliczania priorytetów")
        
        try:
            # Pobierz produkty oczekujące
            pending_items = ProductionItem.query.join(ProductionStatus).filter(
                ProductionStatus.name == 'pending'
            ).all()
            
            updated_count = 0
            
            for item in pending_items:
                # Pobierz liczbę produktów w zamówieniu
                order_size = ProductionItem.query.filter_by(
                    baselinker_order_id=item.baselinker_order_id
                ).count()
                
                # Przelicz priorytet
                priority_data = self.priority_calculator.calculate_priority(
                    wood_species=item.wood_species,
                    wood_technology=item.wood_technology,
                    wood_class=item.wood_class,
                    deadline_date=item.deadline_date,
                    order_size=order_size
                )
                
                # Aktualizuj jeśli się zmienił
                if (item.priority_score != priority_data['priority_score'] or 
                    item.priority_group != priority_data['priority_group']):
                    
                    item.priority_score = priority_data['priority_score']
                    item.priority_group = priority_data['priority_group']
                    updated_count += 1
            
            db.session.commit()
            
            self.logger.info("Przeliczanie priorytetów zakończone",
                           total_items=len(pending_items), updated_count=updated_count)
            
            return {
                'total_items': len(pending_items),
                'updated_count': updated_count
            }
            
        except Exception as e:
            self.logger.error("Błąd podczas przeliczania priorytetów", error=str(e))
            db.session.rollback()
            raise

    def get_orders_ready_for_packaging(self):
        """
        Pobiera zamówienia gotowe do pakowania
        (wszystkie produkty sklejone, status waiting/in_progress)
        """
        try:
            production_logger.info("Pobieranie zamówień gotowych do pakowania")
            
            # Zamówienia z wszystkimi produktami sklejonymi
            orders = ProductionOrderSummary.query.filter(
                ProductionOrderSummary.all_items_glued == True,
                ProductionOrderSummary.packaging_status.in_(['waiting', 'in_progress'])
            ).order_by(
                ProductionOrderSummary.created_at.asc()
            ).all()
            
            result = []
            
            for order in orders:
                # Pobierz produkty zamówienia
                products = ProductionItem.query.filter_by(
                    baselinker_order_id=order.baselinker_order_id
                ).all()
                
                # Weryfikuj czy rzeczywiście wszystkie produkty sklejone
                completed_products = [p for p in products if p.status.name == 'completed']
                
                if len(completed_products) != len(products):
                    production_logger.warning(
                        f"Zamówienie {order.baselinker_order_id} ma błędny status all_items_glued"
                    )
                    # Popraw status
                    order.all_items_glued = False
                    db.session.commit()
                    continue
                
                # Oblicz priorytet na podstawie deadline
                priority_info = self._calculate_packaging_priority(products)
                
                order_data = {
                    'order_summary': order,
                    'products': products,
                    'priority': priority_info['priority'],
                    'deadline': priority_info['deadline'],
                    'days_until_deadline': priority_info['days_until_deadline']
                }
                
                result.append(order_data)
            
            # Sortuj według priorytetu i deadline
            result.sort(key=lambda x: (
                {'urgent': 0, 'medium': 1, 'normal': 2}[x['priority']],
                x['deadline'] or date.max,
                x['order_summary'].created_at
            ))
            
            production_logger.info(f"Znaleziono {len(result)} zamówień gotowych do pakowania")
            return result
            
        except Exception as e:
            production_logger.error("Błąd pobierania zamówień do pakowania", error=str(e))
            return []

    def _calculate_packaging_priority(self, products):
        """Oblicza priorytet pakowania na podstawie produktów zamówienia"""
        
        if not products:
            return {
                'priority': 'normal',
                'deadline': None,
                'days_until_deadline': None
            }
        
        # Znajdź najwcześniejszy deadline
        deadlines = [p.deadline_date for p in products if p.deadline_date]
        
        if not deadlines:
            return {
                'priority': 'normal', 
                'deadline': None,
                'days_until_deadline': None
            }
        
        earliest_deadline = min(deadlines)
        today = date.today()
        days_diff = (earliest_deadline - today).days
        
        # Ustal priorytet
        if days_diff < 0:
            priority = 'urgent'  # Opóźnione
        elif days_diff <= 1:
            priority = 'urgent'  # Dziś lub jutro  
        elif days_diff <= 3:
            priority = 'medium'  # Do 3 dni
        else:
            priority = 'normal'  # Powyżej 3 dni
        
        return {
            'priority': priority,
            'deadline': earliest_deadline,
            'days_until_deadline': days_diff
        }

    def complete_packaging(self, order_id, update_baselinker=True):
        """
        Oznacza zamówienie jako spakowane
        
        Args:
            order_id (int): ID zamówienia w tabeli ProductionOrderSummary
            update_baselinker (bool): Czy aktualizować status w Baselinker
            
        Returns:
            dict: Wynik operacji
        """
        try:
            production_logger.info(f"Rozpoczęcie pakowania zamówienia {order_id}")
            
            # Pobierz zamówienie
            order_summary = ProductionOrderSummary.query.get(order_id)
            if not order_summary:
                return {
                    'success': False,
                    'error': f'Nie znaleziono zamówienia {order_id}'
                }
            
            # Sprawdź czy można pakować
            if not order_summary.all_items_glued:
                return {
                    'success': False,
                    'error': 'Nie wszystkie produkty zostały sklejone'
                }
            
            if order_summary.packaging_status == 'completed':
                return {
                    'success': False,
                    'error': 'Zamówienie zostało już spakowane'
                }
            
            # Pobierz wszystkie produkty zamówienia
            products = ProductionItem.query.filter_by(
                baselinker_order_id=order_summary.baselinker_order_id
            ).all()
            
            # Aktualizuj status pakowania
            packaging_time = datetime.utcnow()
            
            order_summary.packaging_status = 'completed'
            order_summary.updated_at = packaging_time
            
            # Ustaw czasy pakowania dla produktów
            for product in products:
                if product.packaging_completed_at is None:
                    product.packaging_completed_at = packaging_time
                
                if product.packaging_started_at is None:
                    product.packaging_started_at = packaging_time
            
            # Zapisz zmiany
            db.session.commit()
            
            production_logger.info(f"Zamówienie {order_id} oznaczone jako spakowane w bazie")
            
            # Aktualizuj status w Baselinker
            baselinker_result = {'success': True, 'error': None}
            
            if update_baselinker:
                try:
                    baselinker_success = self.update_order_status_to_shipped(
                        order_summary.baselinker_order_id
                    )
                    
                    if baselinker_success:
                        production_logger.info(
                            f"Status zamówienia {order_summary.baselinker_order_id} "
                            f"zaktualizowany w Baselinker"
                        )
                    else:
                        baselinker_result = {
                            'success': False,
                            'error': 'Błąd aktualizacji statusu w Baselinker'
                        }
                        production_logger.error(baselinker_result['error'])
                
                except Exception as e:
                    baselinker_result = {
                        'success': False, 
                        'error': f'Wyjątek podczas aktualizacji Baselinker: {str(e)}'
                    }
                    production_logger.error("Błąd aktualizacji Baselinker", error=str(e))
            
            return {
                'success': True,
                'message': 'Zamówienie zostało spakowane',
                'order_id': order_id,
                'baselinker_order_id': order_summary.baselinker_order_id,
                'packaging_completed_at': packaging_time.isoformat(),
                'products_count': len(products),
                'baselinker_updated': baselinker_result['success'],
                'baselinker_error': baselinker_result['error']
            }
            
        except Exception as e:
            db.session.rollback()
            production_logger.error(f"Błąd podczas pakowania zamówienia {order_id}", error=str(e))
            return {
                'success': False,
                'error': str(e)
            }

    def update_order_status_to_shipped(self, baselinker_order_id):
        """
        Aktualizuje status zamówienia w Baselinker na "Wysłane"
        
        Args:
            baselinker_order_id (int): ID zamówienia w Baselinker
            
        Returns:
            bool: True jeśli sukces, False jeśli błąd
        """
        try:
            production_logger.info(f"Aktualizacja statusu zamówienia {baselinker_order_id} w Baselinker")
            
            # Status "Wysłane" w Baselinker (może się różnić - sprawdź w panelu)
            SHIPPED_STATUS_ID = 138620  # TODO: Sprawdź prawidłowy ID statusu "Wysłane"
            
            # Przygotuj dane do API
            api_data = {
                'token': self.api_token,
                'method': 'setOrderStatus',
                'parameters': json.dumps({
                    'order_id': baselinker_order_id,
                    'status_id': SHIPPED_STATUS_ID
                })
            }
            
            # Wywołaj API Baselinker
            response = requests.post(
                self.api_url,
                data=api_data,
                timeout=30
            )
            
            if response.status_code != 200:
                production_logger.error(
                    f"HTTP {response.status_code} podczas aktualizacji statusu zamówienia "
                    f"{baselinker_order_id}"
                )
                return False
            
            result = response.json()
            
            if result.get('status') == 'SUCCESS':
                production_logger.info(
                    f"Status zamówienia {baselinker_order_id} zaktualizowany na 'Wysłane'"
                )
                return True
            else:
                error_msg = result.get('error_message', 'Nieznany błąd')
                production_logger.error(
                    f"Błąd API Baselinker przy aktualizacji statusu: {error_msg}"
                )
                return False
                
        except requests.exceptions.Timeout:
            production_logger.error("Timeout podczas aktualizacji statusu w Baselinker")
            return False
            
        except requests.exceptions.RequestException as e:
            production_logger.error("Błąd połączenia z Baselinker", error=str(e))
            return False
            
        except Exception as e:
            production_logger.error("Nieoczekiwany błąd aktualizacji Baselinker", error=str(e))
            return False

    def get_packaging_stats(self, date_from=None, date_to=None):
        """
        Pobiera statystyki pakowania
        
        Args:
            date_from (date): Data początkowa (domyślnie dzisiaj)
            date_to (date): Data końcowa (domyślnie dzisiaj)
            
        Returns:
            dict: Statystyki pakowania
        """
        try:
            if date_from is None:
                date_from = date.today()
            if date_to is None:
                date_to = date.today()
                
            production_logger.info(f"Pobieranie statystyk pakowania {date_from} - {date_to}")
            
            # Zamówienia oczekujące
            orders_waiting = ProductionOrderSummary.query.filter(
                ProductionOrderSummary.all_items_glued == True,
                ProductionOrderSummary.packaging_status == 'waiting'
            ).count()
            
            # Zamówienia w trakcie pakowania
            orders_in_progress = ProductionOrderSummary.query.filter(
                ProductionOrderSummary.packaging_status == 'in_progress'
            ).count()
            
            # Zamówienia spakowane w okresie
            orders_completed = ProductionOrderSummary.query.filter(
                ProductionOrderSummary.packaging_status == 'completed',
                func.date(ProductionOrderSummary.updated_at) >= date_from,
                func.date(ProductionOrderSummary.updated_at) <= date_to
            ).count()
            
            # Produkty spakowane w okresie
            products_packed = ProductionItem.query.filter(
                func.date(ProductionItem.packaging_completed_at) >= date_from,
                func.date(ProductionItem.packaging_completed_at) <= date_to
            ).count()
            
            # Średni czas od sklejenia do spakowania (w godzinach)
            avg_waiting_time = None
            try:
                waiting_times = db.session.query(
                    func.avg(
                        func.extract('epoch', 
                            ProductionItem.packaging_completed_at - 
                            ProductionItem.gluing_completed_at
                        ) / 3600.0
                    )
                ).filter(
                    func.date(ProductionItem.packaging_completed_at) >= date_from,
                    func.date(ProductionItem.packaging_completed_at) <= date_to,
                    ProductionItem.gluing_completed_at.isnot(None),
                    ProductionItem.packaging_completed_at.isnot(None)
                ).scalar()
                
                if waiting_times:
                    avg_waiting_time = round(float(waiting_times), 1)
                    
            except Exception as e:
                production_logger.warning("Błąd obliczania średniego czasu oczekiwania", error=str(e))
            
            stats = {
                'date_from': date_from.isoformat(),
                'date_to': date_to.isoformat(),
                'orders_waiting': orders_waiting,
                'orders_in_progress': orders_in_progress,
                'orders_completed': orders_completed,
                'products_packed': products_packed,
                'avg_waiting_time_hours': avg_waiting_time
            }
            
            production_logger.info("Statystyki pakowania pobrane", stats=stats)
            return stats
            
        except Exception as e:
            production_logger.error("Błąd pobierania statystyk pakowania", error=str(e))
            return {
                'error': str(e),
                'orders_waiting': 0,
                'orders_in_progress': 0, 
                'orders_completed': 0,
                'products_packed': 0,
                'avg_waiting_time_hours': None
            }

    def refresh_packaging_queue(self):
        """
        Odświeża kolejkę pakowania - sprawdza czy nowe zamówienia są gotowe
        """
        try:
            production_logger.info("Odświeżanie kolejki pakowania")
            
            # Znajdź zamówienia które mogą być gotowe do pakowania
            orders_to_check = ProductionOrderSummary.query.filter(
                ProductionOrderSummary.all_items_glued == False,
                ProductionOrderSummary.packaging_status == 'waiting'
            ).all()
            
            updated_count = 0
            
            for order in orders_to_check:
                # Sprawdź czy wszystkie produkty zamówienia są sklejone
                total_products = ProductionItem.query.filter_by(
                    baselinker_order_id=order.baselinker_order_id
                ).count()
                
                completed_products = ProductionItem.query.join(ProductionStatus).filter(
                    ProductionItem.baselinker_order_id == order.baselinker_order_id,
                    ProductionStatus.name == 'completed'
                ).count()
                
                if completed_products == total_products and total_products > 0:
                    # Wszystkie produkty sklejone - oznacz jako gotowe do pakowania
                    order.completed_items_count = completed_products
                    order.all_items_glued = True
                    order.updated_at = datetime.utcnow()
                    updated_count += 1
                    
                    production_logger.info(
                        f"Zamówienie {order.baselinker_order_id} gotowe do pakowania "
                        f"({completed_products}/{total_products} produktów)"
                    )
                else:
                    # Aktualizuj licznik ukończonych produktów
                    order.completed_items_count = completed_products
            
            if updated_count > 0:
                db.session.commit()
                production_logger.info(f"Zaktualizowano {updated_count} zamówień w kolejce pakowania")
            
            return {
                'success': True,
                'updated_orders': updated_count
            }
            
        except Exception as e:
            db.session.rollback()
            production_logger.error("Błąd odświeżania kolejki pakowania", error=str(e))
            return {
                'success': False,
                'error': str(e),
                'updated_orders': 0
            }


def get_production_service() -> ProductionService:
    """
    Factory function do pobierania instancji ProductionService
    
    Returns:
        ProductionService: Instancja serwisu
    """
    return ProductionService()