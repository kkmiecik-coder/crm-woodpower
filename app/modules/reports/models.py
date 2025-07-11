# modules/reports/models.py
"""
Modele bazy danych dla modułu Reports
"""

from extensions import db
from datetime import datetime, timedelta
from sqlalchemy import Index
import re

class BaselinkerReportOrder(db.Model):
    """
    Model dla tabeli raportów zamówień z Baselinker
    Każdy wiersz = jeden produkt w zamówieniu
    """
    __tablename__ = 'baselinker_reports_orders'
    
    # === PODSTAWOWE POLA ===
    id = db.Column(db.Integer, primary_key=True)
    is_manual = db.Column(db.Boolean, default=False, nullable=False, comment="Czy rekord dodany ręcznie")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # === DANE ZAMÓWIENIA (kolumny 1-14) ===
    date_created = db.Column(db.Date, nullable=False, comment="1. Data")
    total_m3 = db.Column(db.Numeric(10, 4), nullable=True, comment="2. TTL m3 (obliczane)")
    order_amount_net = db.Column(db.Numeric(10, 2), nullable=True, comment="3. Kwota zamówień netto")
    baselinker_order_id = db.Column(db.Integer, nullable=True, unique=False, comment="4. Numer zamówienia Baselinker")
    internal_order_number = db.Column(db.String(50), nullable=True, comment="5. Numer wew. zamówienia (extra_field_1)")
    customer_name = db.Column(db.String(200), nullable=True, comment="6. Imię i nazwisko")
    delivery_postcode = db.Column(db.String(20), nullable=True, comment="7. Kod pocztowy dostawy")
    delivery_city = db.Column(db.String(100), nullable=True, comment="8. Miejscowość dostawy")
    delivery_address = db.Column(db.String(250), nullable=True, comment="9. Ulica i numer domu/mieszkania")
    delivery_state = db.Column(db.String(50), nullable=True, comment="10. Województwo dostawy")
    phone = db.Column(db.String(100), nullable=True, comment="11. Numer telefonu")
    caretaker = db.Column(db.String(100), nullable=True, comment="12. Opiekun (kto złożył zamówienie)")
    delivery_method = db.Column(db.String(100), nullable=True, comment="13. Metoda dostawy")
    order_source = db.Column(db.String(50), nullable=True, comment="14. Źródło zamówienia")
    
    # === DANE PRODUKTU (kolumny 15-24) ===
    group_type = db.Column(db.Enum('towar', 'usługa', name='group_type_enum'), nullable=True, comment="15. Grupa")
    product_type = db.Column(db.Enum('klejonka', 'deska', name='product_type_enum'), nullable=True, comment="16. Rodzaj")
    finish_state = db.Column(db.String(50), nullable=True, comment="17. Stan (wykończenie)")
    wood_species = db.Column(db.String(50), nullable=True, comment="18. Gatunek")
    technology = db.Column(db.String(50), nullable=True, comment="19. Technologia")
    wood_class = db.Column(db.String(10), nullable=True, comment="20. Klasa")
    length_cm = db.Column(db.Numeric(10, 2), nullable=True, comment="21. Długość")
    width_cm = db.Column(db.Numeric(10, 2), nullable=True, comment="22. Szerokość")
    thickness_cm = db.Column(db.Numeric(10, 2), nullable=True, comment="23. Grubość")
    quantity = db.Column(db.Integer, nullable=True, comment="24. Ilość")
    
    # === CENY I WARTOŚCI (kolumny 25-32) ===
    price_gross = db.Column(db.Numeric(10, 2), nullable=True, comment="25. Cena brutto")
    price_net = db.Column(db.Numeric(10, 2), nullable=True, comment="26. Cena netto")
    value_gross = db.Column(db.Numeric(10, 2), nullable=True, comment="27. Wartość brutto")
    value_net = db.Column(db.Numeric(10, 2), nullable=True, comment="28. Wartość netto")
    volume_per_piece = db.Column(db.Numeric(10, 4), nullable=True, comment="29. Objętość 1 szt.")
    total_volume = db.Column(db.Numeric(10, 4), nullable=True, comment="30. Objętość TTL")
    price_per_m3 = db.Column(db.Numeric(10, 2), nullable=True, comment="31. Cena za m3")
    realization_date = db.Column(db.Date, nullable=True, comment="32. Data realizacji")
    
    # === STATUS I PŁATNOŚCI (kolumny 33-37) ===
    current_status = db.Column(db.String(100), nullable=True, comment="33. Status")
    delivery_cost = db.Column(db.Numeric(10, 2), nullable=True, comment="34. Koszt kuriera dla klienta")
    payment_method = db.Column(db.String(100), nullable=True, comment="35. Sposób płatności")
    paid_amount_net = db.Column(db.Numeric(10, 2), default=0.00, comment="36. Zapłacono TTL netto")
    balance_due = db.Column(db.Numeric(10, 2), nullable=True, comment="37. Saldo")
    
    # === PRODUKCJA I ODBIÓR (kolumny 38-40) ===
    production_volume = db.Column(db.Numeric(10, 4), default=0.00, comment="38. Ilość w produkcji")
    production_value_net = db.Column(db.Numeric(10, 2), default=0.00, comment="39. Wartość netto w produkcji")
    ready_pickup_volume = db.Column(db.Numeric(10, 4), default=0.00, comment="40. Ilość gotowa do odbioru")
    
    # === POLA TECHNICZNE (nie wyświetlane w tabeli) ===
    baselinker_status_id = db.Column(db.Integer, nullable=True, comment="ID statusu z Baselinker")
    raw_product_name = db.Column(db.Text, nullable=True, comment="Oryginalna nazwa produktu z Baselinker")
    email = db.Column(db.String(150), nullable=True, comment="Email klienta")
    
    # === INDEKSY ===
    __table_args__ = (
        Index('idx_baselinker_order_id', 'baselinker_order_id'),
        Index('idx_date_created', 'date_created'),
        Index('idx_is_manual', 'is_manual'),
        Index('idx_internal_order_number', 'internal_order_number'),
    )
    
    def __repr__(self):
        return f'<BaselinkerReportOrder {self.id}: Order {self.baselinker_order_id}, {self.customer_name}>'
    
    
    @classmethod
    def get_filtered_orders(cls, filters=None, date_from=None, date_to=None):
        """
        Pobiera zamówienia z filtrami

        Args:
            filters (dict): Słownik filtrów {kolumna: lista_wartości}
            date_from (date): Data od
            date_to (date): Data do
    
        Returns:
            Query: SQLAlchemy Query object
        """
        query = cls.query

        # Filtr daty
        if date_from:
            query = query.filter(cls.date_created >= date_from)
        if date_to:
            query = query.filter(cls.date_created <= date_to)
    
        # ZMIENIONE FILTRY STATUSÓW: wykluczamy tylko statusy 105112 i 138625
        # 105112 = "Nowe - nieopłacone"
        # 138625 = "Zamówienie anulowane"
        excluded_status_ids = [105112, 138625]
        query = query.filter(~cls.baselinker_status_id.in_(excluded_status_ids))
    
        # Dodatkowo wykluczamy na podstawie nazw statusów (fallback)
        excluded_status_names = ['Nowe - nieopłacone', 'Zamówienie anulowane']
        query = query.filter(~cls.current_status.in_(excluded_status_names))
    
        # Dodatkowe filtry (obsługa multiple values)
        if filters:
            for column, values in filters.items():
                if values and hasattr(cls, column):
                    column_attr = getattr(cls, column)
                    if isinstance(values, list) and values:
                        # Multiple values - użyj IN
                        query = query.filter(column_attr.in_(values))
                    elif isinstance(values, str) and values.strip():
                        # Single value - użyj LIKE
                        query = query.filter(column_attr.like(f'%{values.strip()}%'))

        # POPRAWIONE SORTOWANIE: najpierw po baselinker_order_id (malejąco), potem po dacie
        from sqlalchemy import case, desc, asc

        return query.order_by(
            # Najpierw ręczne wpisy (is_manual = True) na końcu
            cls.is_manual.asc(),
            # Potem sortuj po baselinker_order_id malejąco (NULL na końcu)
            desc(case(
                (cls.baselinker_order_id.is_(None), 0),  # NULL = 0 (najniższy priorytet)
                else_=cls.baselinker_order_id  # Nie-NULL sortowane malejąco
            )),
            # Na końcu po dacie malejąco (najnowsze na górze)
            desc(cls.date_created),
            # Dodatkowo po ID dla stabilności sortowania
            desc(cls.id)
        )
    
    @classmethod
    def get_orders_by_date_range(cls, days_back=None):
        """
        Pobiera zamówienia z ostatnich X dni lub wszystkie jeśli days_back=None
    
        Args:
            days_back (int): Ile dni wstecz (None = wszystkie zamówienia)
        
        Returns:
            List[BaselinkerReportOrder]: Lista zamówień
        """
        query = cls.query
    
        # ZMIANA: Tylko jeśli podano days_back, dodaj filtr daty
        if days_back is not None:
            date_from = datetime.now().date() - timedelta(days=days_back)
            query = query.filter(cls.date_created >= date_from)
    
        # Zastosuj te same filtry statusów co w get_filtered_orders
        excluded_status_ids = [105112, 138625]  # Nowe - nieopłacone, Zamówienie anulowane
        query = query.filter(~cls.baselinker_status_id.in_(excluded_status_ids))
    
        excluded_status_names = ['Nowe - nieopłacone', 'Zamówienie anulowane']
        query = query.filter(~cls.current_status.in_(excluded_status_names))
    
        return query.order_by(cls.date_created.desc()).all()
    
    @classmethod
    def get_statistics(cls, filtered_query=None):
        """
        Oblicza statystyki dla widocznych (przefiltrowanych) zamówień
        
        Args:
            filtered_query: Query object z filtrami
            
        Returns:
            dict: Słownik ze statystykami
        """
        if filtered_query is None:
            filtered_query = cls.query
            
        orders = filtered_query.all()
        
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
        
        if not orders:
            return stats
            
        # Grupuj zamówienia by uniknąć duplikowania order_amount_net
        orders_by_baselinker_id = {}
        for order in orders:
            bl_id = order.baselinker_order_id or f"manual_{order.id}"
            if bl_id not in orders_by_baselinker_id:
                orders_by_baselinker_id[bl_id] = []
            orders_by_baselinker_id[bl_id].append(order)
        
        # Sumuj wartości
        for order in orders:
            stats['total_m3'] += float(order.total_volume or 0)
            stats['value_net'] += float(order.value_net or 0)
            stats['value_gross'] += float(order.value_gross or 0)
            stats['delivery_cost'] += float(order.delivery_cost or 0)
            stats['paid_amount_net'] += float(order.paid_amount_net or 0)
            stats['balance_due'] += float(order.balance_due or 0)
            stats['production_volume'] += float(order.production_volume or 0)
            stats['production_value_net'] += float(order.production_value_net or 0)
            stats['ready_pickup_volume'] += float(order.ready_pickup_volume or 0)
        
        # Oblicz order_amount_net bez duplikowania na poziomie zamówienia
        for bl_id, order_products in orders_by_baselinker_id.items():
            # Weź order_amount_net z pierwszego produktu (wszystkie mają tę samą wartość)
            if order_products:
                stats['order_amount_net'] += float(order_products[0].order_amount_net or 0)
        
        # Oblicz średnią cenę za m3
        if stats['total_m3'] > 0:
            stats['avg_price_per_m3'] = stats['value_net'] / stats['total_m3']
            
        return stats
    
    @classmethod
    def get_comparison_statistics(cls, current_filters=None, current_date_from=None, current_date_to=None):
        """
        Oblicza statystyki porównawcze dla poprzedniego okresu
        
        Args:
            current_filters: Filtry dla bieżącego okresu
            current_date_from: Data początkowa bieżącego okresu
            current_date_to: Data końcowa bieżącego okresu
            
        Returns:
            dict: Słownik z procentowymi zmianami
        """
        if not current_date_from or not current_date_to:
            return {}
            
        # Oblicz długość okresu
        period_length = (current_date_to - current_date_from).days + 1
        
        # Oblicz datę końcową poprzedniego okresu (dzień przed current_date_from)
        prev_date_to = current_date_from - timedelta(days=1)
        prev_date_from = prev_date_to - timedelta(days=period_length - 1)
        
        # Pobierz statystyki dla bieżącego okresu
        current_query = cls.get_filtered_orders(current_filters, current_date_from, current_date_to)
        current_stats = cls.get_statistics(current_query)
        
        # Pobierz statystyki dla poprzedniego okresu
        prev_query = cls.get_filtered_orders(current_filters, prev_date_from, prev_date_to)
        prev_stats = cls.get_statistics(prev_query)
        
        # Oblicz procentowe zmiany
        comparison = {}
        for key in current_stats.keys():
            current_val = float(current_stats[key] or 0)
            prev_val = float(prev_stats[key] or 0)
            
            if prev_val > 0:
                change_percent = ((current_val - prev_val) / prev_val) * 100
                comparison[key] = {
                    'change_percent': round(change_percent, 1),
                    'is_positive': change_percent >= 0
                }
            else:
                # Jeśli poprzednia wartość = 0, ale obecna > 0, to 100% wzrost
                if current_val > 0:
                    comparison[key] = {
                        'change_percent': 100.0,
                        'is_positive': True
                    }
                else:
                    comparison[key] = {
                        'change_percent': 0.0,
                        'is_positive': True
                    }
        
        return comparison
    
    def calculate_fields(self):
        """
        Oblicza pola pochodne (objętości, wartości, daty realizacji)
        """
        # Oblicz objętość 1 sztuki (długość × szerokość × grubość w m3)
        if self.length_cm and self.width_cm and self.thickness_cm:
            length = float(self.length_cm)
            width = float(self.width_cm) 
            thickness = float(self.thickness_cm)
            self.volume_per_piece = (length * width * thickness) / 1000000
        
        # Oblicz całkowitą objętość
        if self.volume_per_piece and self.quantity:
            self.total_volume = self.volume_per_piece * self.quantity
            
        # Oblicz cenę netto z brutto (VAT 23%)
        if self.price_gross:
            self.price_net = float(self.price_gross) / 1.23
            
        # Oblicz wartości
        if self.price_gross and self.quantity:
            self.value_gross = float(self.price_gross) * self.quantity
        if self.price_net and self.quantity:
            self.value_net = float(self.price_net) * self.quantity
            
        # Oblicz cenę za m3
        if self.price_net and self.volume_per_piece and self.volume_per_piece > 0:
            self.price_per_m3 = float(self.price_net) / self.volume_per_piece
            
        # Oblicz datę realizacji (data + 14 dni, pomiń weekendy)
        if self.date_created:
            target_date = self.date_created + timedelta(days=14)
            # Jeśli wypada w sobotę (5) lub niedzielę (6), przesuń na poniedziałek
            while target_date.weekday() >= 5:  # 5=sobota, 6=niedziela
                target_date += timedelta(days=1)
            self.realization_date = target_date
            
        # Oblicz saldo (wartość netto zamówienia - zapłacono netto)
        # POPRAWKA: Saldo obliczane na podstawie order_amount_net (całe zamówienie netto)
        if self.order_amount_net is not None and self.paid_amount_net is not None:
            self.balance_due = float(self.order_amount_net) - float(self.paid_amount_net)
            
        # Oblicz produkcję i odbiór na podstawie statusu
        self.update_production_fields()
        
        # Normalizuj województwo
        self.normalize_delivery_state()
        
        # Ustaw domyślny product_type na 'deska' jeśli nie ma
        if not self.product_type:
            self.product_type = 'deska'
    
    def normalize_delivery_state(self):
        """
        Normalizuje nazwę województwa do standardowego formatu
        """
        if not self.delivery_state:
            return
            
        state_lower = self.delivery_state.lower().strip()
        
        # Mapowanie województw
        states_map = {
            'dolnośląskie': 'Dolnośląskie',
            'dolnoslaskie': 'Dolnośląskie',
            'kujawsko-pomorskie': 'Kujawsko-Pomorskie',
            'kujawsko pomorskie': 'Kujawsko-Pomorskie',
            'lubelskie': 'Lubelskie',
            'lubuskie': 'Lubuskie',
            'łódzkie': 'Łódzkie',
            'lodzkie': 'Łódzkie',
            'małopolskie': 'Małopolskie',
            'malopolskie': 'Małopolskie',
            'mazowieckie': 'Mazowieckie',
            'opolskie': 'Opolskie',
            'podkarpackie': 'Podkarpackie',
            'podlaskie': 'Podlaskie',
            'pomorskie': 'Pomorskie',
            'śląskie': 'Śląskie',
            'slaskie': 'Śląskie',
            'świętokrzyskie': 'Świętokrzyskie',
            'swietokrzyskie': 'Świętokrzyskie',
            'warmińsko-mazurskie': 'Warmińsko-Mazurskie',
            'warminsko-mazurskie': 'Warmińsko-Mazurskie',
            'warminsko mazurskie': 'Warmińsko-Mazurskie',
            'wielkopolskie': 'Wielkopolskie',
            'zachodniopomorskie': 'Zachodniopomorskie'
        }
        
        # Sprawdź czy istnieje mapowanie
        normalized = states_map.get(state_lower)
        if normalized:
            self.delivery_state = normalized
        else:
            # Capitalize pierwszą literę jeśli nie ma mapowania
            self.delivery_state = self.delivery_state.strip().capitalize()
    
    def update_production_fields(self):
        """
        Aktualizuje pola produkcji na podstawie aktualnego statusu
        """
        if not self.current_status:
            return
            
        status_lower = self.current_status.lower()
        
        # Reset wartości
        self.production_volume = 0.0
        self.production_value_net = 0.0
        self.ready_pickup_volume = 0.0
        
        # Jeśli status zawiera "w produkcji"
        if 'w produkcji' in status_lower:
            self.production_volume = float(self.total_volume or 0.0)
            self.production_value_net = float(self.value_net or 0.0)
            
        # Jeśli status to "Czeka na odbiór osobisty"
        elif 'czeka na odbiór osobisty' in status_lower:
            self.ready_pickup_volume = float(self.total_volume or 0.0)
    
    def to_dict(self):
        """
        Konwertuje obiekt do słownika (dla JSON)
        """
        return {
            'id': self.id,
            'is_manual': self.is_manual,
            'date_created': self.date_created.strftime('%d-%m-%Y') if self.date_created else None,
            'total_m3': float(self.total_volume or 0),
            'order_amount_net': float(self.order_amount_net or 0),
            'baselinker_order_id': self.baselinker_order_id,
            'internal_order_number': self.internal_order_number,
            'customer_name': self.customer_name,
            'delivery_postcode': self.delivery_postcode,
            'delivery_city': self.delivery_city,
            'delivery_address': self.delivery_address,
            'delivery_state': self.delivery_state,
            'phone': self.phone,
            'caretaker': self.caretaker,
            'delivery_method': self.delivery_method,
            'order_source': self.order_source,
            'group_type': self.group_type,
            'product_type': self.product_type,
            'finish_state': self.finish_state,
            'wood_species': self.wood_species,
            'technology': self.technology,
            'wood_class': self.wood_class,
            'length_cm': float(self.length_cm or 0),
            'width_cm': float(self.width_cm or 0),
            'thickness_cm': float(self.thickness_cm or 0),
            'quantity': self.quantity,
            'price_gross': float(self.price_gross or 0),
            'price_net': float(self.price_net or 0),
            'value_gross': float(self.value_gross or 0),
            'value_net': float(self.value_net or 0),
            'volume_per_piece': float(self.volume_per_piece or 0),
            'total_volume': float(self.total_volume or 0),
            'price_per_m3': float(self.price_per_m3 or 0),
            'realization_date': self.realization_date.strftime('%d-%m-%Y') if self.realization_date else None,
            'current_status': self.current_status,
            'delivery_cost': float(self.delivery_cost or 0),
            'payment_method': self.payment_method,
            'paid_amount_net': float(self.paid_amount_net or 0),
            'balance_due': float(self.balance_due or 0),
            'production_volume': float(self.production_volume or 0),
            'production_value_net': float(self.production_value_net or 0),
            'ready_pickup_volume': float(self.ready_pickup_volume or 0)
        }


class ReportsSyncLog(db.Model):
    """
    Log synchronizacji z Baselinker
    """
    __tablename__ = 'reports_sync_log'
    
    id = db.Column(db.Integer, primary_key=True)
    sync_date = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    sync_type = db.Column(db.Enum('manual', 'auto', 'status_sync', name='sync_type_enum'), nullable=False)
    orders_processed = db.Column(db.Integer, default=0)
    orders_added = db.Column(db.Integer, default=0)
    orders_updated = db.Column(db.Integer, default=0)
    errors_count = db.Column(db.Integer, default=0)
    status = db.Column(db.Enum('success', 'error', 'partial', name='sync_status_enum'), nullable=False)
    error_message = db.Column(db.Text, nullable=True)
    duration_seconds = db.Column(db.Integer, nullable=True)
    
    def __repr__(self):
        return f'<ReportsSyncLog {self.id}: {self.sync_date}, {self.status}>'