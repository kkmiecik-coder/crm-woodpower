# modules/calculator/models.py

from extensions import db
from datetime import datetime
from sqlalchemy.dialects.mysql import DECIMAL
import secrets
import string

class Multiplier(db.Model):
    __tablename__ = 'multipliers'
    
    id = db.Column(db.Integer, primary_key=True)
    client_type = db.Column(db.String(100))
    multiplier = db.Column(db.Numeric(5, 2))

    def __repr__(self):
        return f"<Multiplier {self.client_type}: {self.multiplier}>"

class Quote(db.Model):
    __tablename__ = 'quotes'
    
    id = db.Column(db.Integer, primary_key=True)
    quote_number = db.Column(db.String(50), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'))
    status_id = db.Column(db.Integer, db.ForeignKey('quote_statuses.id'))
    base_linker_order_id = db.Column(db.String(100))
    source = db.Column(db.String(100))
    total_price = db.Column(db.Numeric(10, 2))
    courier_name = db.Column(db.String(100))
    shipping_cost_netto = db.Column(db.Numeric(10, 2))
    shipping_cost_brutto = db.Column(db.Numeric(10, 2))
    
    # NOWE POLA dla strony klienta i rabatów
    public_token = db.Column(db.String(32), unique=True)
    client_comments = db.Column(db.Text)
    is_client_editable = db.Column(db.Boolean, default=True)
    
    # Relacje
    user = db.relationship('User', backref='quotes')
    client = db.relationship('Client', backref='quotes')
    quote_status = db.relationship('QuoteStatus', backref='quotes')
    items = db.relationship('QuoteItem', back_populates='quote')

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.public_token:
            self.public_token = self.generate_public_token()

    @staticmethod
    def generate_public_token():
        """Generuje unikalny 32-znakowy token"""
        characters = string.ascii_uppercase + string.digits
        while True:
            token = ''.join(secrets.choice(characters) for _ in range(32))
            # Sprawdź czy token już istnieje
            if not Quote.query.filter_by(public_token=token).first():
                return token

    def get_public_url(self):
        """Zwraca URL do publicznej strony wyceny"""
        return f"/wycena/{self.quote_number}/{self.public_token}"

    def disable_client_editing(self):
        """Wyłącza możliwość edycji przez klienta (np. po akceptacji)"""
        self.is_client_editable = False
        db.session.commit()

    def get_selected_items(self):
        """Zwraca tylko wybrane pozycje wyceny"""
        return [item for item in self.items if item.is_selected]

    def get_total_original_price_netto(self):
        """Zwraca oryginalną cenę netto wszystkich wybranych pozycji"""
        selected_items = self.get_selected_items()
        return sum(float(item.original_price_netto or 0) for item in selected_items)

    def get_total_original_price_brutto(self):
        """Zwraca oryginalną cenę brutto wszystkich wybranych pozycji"""
        selected_items = self.get_selected_items()
        return sum(float(item.original_price_brutto or 0) for item in selected_items)

    def get_total_current_price_netto(self):
        """Zwraca aktualną cenę netto wszystkich wybranych pozycji (po rabatach)"""
        selected_items = self.get_selected_items()
        return sum(float(item.final_price_netto or 0) for item in selected_items)

    def get_total_current_price_brutto(self):
        """Zwraca aktualną cenę brutto wszystkich wybranych pozycji (po rabatach)"""
        selected_items = self.get_selected_items()
        return sum(float(item.final_price_brutto or 0) for item in selected_items)

    def get_total_discount_amount_netto(self):
        """Zwraca łączną kwotę rabatu netto"""
        return self.get_total_original_price_netto() - self.get_total_current_price_netto()

    def get_total_discount_amount_brutto(self):
        """Zwraca łączną kwotę rabatu brutto"""
        return self.get_total_original_price_brutto() - self.get_total_current_price_brutto()

    def apply_total_discount(self, discount_percentage, reason_id=None):
        """Zastosowuje rabat do wszystkich wybranych pozycji"""
        selected_items = db.session.query(QuoteItem).filter_by(
        quote_id=self.id, 
        is_selected=True
        ).all()
    
        affected_count = 0
    
        for item in selected_items:
            item.apply_discount(discount_percentage, reason_id)
            affected_count += 1
    
        return affected_count

    def __repr__(self):
        return f"<Quote {self.quote_number}>"


class QuoteItem(db.Model):
    __tablename__ = 'quote_items'
    
    id = db.Column(db.Integer, primary_key=True)
    quote_id = db.Column(db.Integer, db.ForeignKey('quotes.id'))
    product_index = db.Column(db.Integer)
    variant_code = db.Column(db.String(50))
    length_cm = db.Column(db.Numeric(10, 2))
    width_cm = db.Column(db.Numeric(10, 2))
    thickness_cm = db.Column(db.Numeric(10, 2))
    volume_m3 = db.Column(db.Numeric(10, 6))
    price_per_m3 = db.Column(db.Numeric(10, 2))
    multiplier = db.Column(db.Numeric(5, 2))
    is_selected = db.Column(db.Boolean, default=False)
    final_price_netto = db.Column(db.Numeric(10, 2))
    final_price_brutto = db.Column(db.Numeric(10, 2))
    
    # NOWE POLA dla rabatów
    original_price_netto = db.Column(db.Numeric(10, 2))
    original_price_brutto = db.Column(db.Numeric(10, 2))
    discount_percentage = db.Column(db.Numeric(5, 2), default=0)
    show_on_client_page = db.Column(db.Boolean, default=True)
    discount_reason_id = db.Column(db.Integer, db.ForeignKey('discount_reasons.id'))
    
    # Relacje
    quote = db.relationship('Quote', back_populates='items')
    discount_reason = db.relationship('DiscountReason', backref='quote_items')

    def apply_discount(self, discount_percentage, reason_id=None):
        """Zastosowuje rabat do pozycji"""
        # Jeśli nie ma ceny oryginalnej, ustaw obecną jako oryginalną
        if self.original_price_netto is None:
            self.original_price_netto = self.final_price_netto
            self.original_price_brutto = self.final_price_brutto
        
        self.discount_percentage = discount_percentage
        self.discount_reason_id = reason_id
        
        # Oblicz nowe ceny
        discount_multiplier = 1 - (discount_percentage / 100)
        self.final_price_netto = float(self.original_price_netto) * discount_multiplier
        self.final_price_brutto = float(self.original_price_brutto) * discount_multiplier
        
        return self

    def get_discount_amount_netto(self):
        """Zwraca kwotę rabatu netto"""
        if self.original_price_netto and self.final_price_netto:
            return float(self.original_price_netto) - float(self.final_price_netto)
        return 0

    def get_discount_amount_brutto(self):
        """Zwraca kwotę rabatu brutto"""
        if self.original_price_brutto and self.final_price_brutto:
            return float(self.original_price_brutto) - float(self.final_price_brutto)
        return 0

    def has_discount(self):
        """Sprawdza czy pozycja ma zastosowany rabat"""
        return self.discount_percentage != 0

    def reset_discount(self):
        """Resetuje rabat do wartości oryginalnych"""
        if self.original_price_netto is not None:
            self.final_price_netto = self.original_price_netto
            self.final_price_brutto = self.original_price_brutto
            self.discount_percentage = 0
            self.discount_reason_id = None

    def to_dict(self):
        """Konwertuje do słownika dla API"""
        return {
            'id': self.id,
            'product_index': self.product_index,
            'variant_code': self.variant_code,
            'length_cm': float(self.length_cm) if self.length_cm else None,
            'width_cm': float(self.width_cm) if self.width_cm else None,
            'thickness_cm': float(self.thickness_cm) if self.thickness_cm else None,
            'volume_m3': float(self.volume_m3) if self.volume_m3 else None,
            'price_per_m3': float(self.price_per_m3) if self.price_per_m3 else None,
            'multiplier': float(self.multiplier) if self.multiplier else None,
            'is_selected': self.is_selected,
            'show_on_client_page': self.show_on_client_page,
            'original_price_netto': float(self.original_price_netto) if self.original_price_netto else None,
            'original_price_brutto': float(self.original_price_brutto) if self.original_price_brutto else None,
            'final_price_netto': float(self.final_price_netto) if self.final_price_netto else None,
            'final_price_brutto': float(self.final_price_brutto) if self.final_price_brutto else None,
            'discount_percentage': float(self.discount_percentage) if self.discount_percentage else 0,
            'discount_reason_id': self.discount_reason_id,
            'has_discount': self.has_discount()
        }

    def __repr__(self):
        return f"<QuoteItem {self.id} - Quote {self.quote_id}>"

class QuoteItemDetails(db.Model):
    __tablename__ = 'quote_items_details'

    id = db.Column(db.Integer, primary_key=True)
    quote_id = db.Column(db.Integer, db.ForeignKey('quotes.id'))
    product_index = db.Column(db.Integer)
    finishing_type = db.Column(db.String(100))
    finishing_variant = db.Column(db.String(100))
    finishing_color = db.Column(db.String(100))
    finishing_gloss_level = db.Column(db.String(50))
    finishing_price_netto = db.Column(db.Numeric(10, 2))
    finishing_price_brutto = db.Column(db.Numeric(10, 2))

    __table_args__ = (
        db.UniqueConstraint('quote_id', 'product_index', name='uq_quote_product'),
    )

    def __repr__(self):
        return f"<QuoteItemDetails Quote:{self.quote_id} Produkt:{self.product_index}>"

class QuoteCounter(db.Model):
    __tablename__ = 'quote_counters'
    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False)
    month = db.Column(db.Integer, nullable=False)
    current_number = db.Column(db.Integer, nullable=False, default=0)

    def __repr__(self):
        return f"<QuoteCounter {self.month}/{self.year}: {self.current_number}>"

class QuoteLog(db.Model):
    __tablename__ = 'quote_logs'
    id = db.Column(db.Integer, primary_key=True)
    quote_id = db.Column(db.Integer, db.ForeignKey('quotes.id'), nullable=False)
    user_id = db.Column(db.Integer, nullable=False)
    change_time = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    description = db.Column(db.String(255))

    def __repr__(self):
        return f"<QuoteLog Quote:{self.quote_id} ChangedBy:{self.user_id} at {self.change_time}>"

class Price(db.Model):
    __tablename__ = 'prices'

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    species = db.Column(db.String(50), nullable=False)
    technology = db.Column(db.String(50), nullable=False)
    wood_class = db.Column(db.String(10), nullable=False)
    thickness_min = db.Column(DECIMAL(4, 2), nullable=False)
    thickness_max = db.Column(DECIMAL(4, 2), nullable=False)
    length_min = db.Column(DECIMAL(10, 2), nullable=False)
    length_max = db.Column(DECIMAL(10, 2), nullable=False)
    price_per_m3 = db.Column(DECIMAL(10, 2), nullable=False)

    def __repr__(self):
        return f"<Price id={self.id}, {self.species}, {self.wood_class}, {self.price_per_m3} PLN/m³>"

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(50), nullable=False)
    reset_token = db.Column(db.String(255))
    first_name = db.Column(db.String(100))
    last_name = db.Column(db.String(100))
    avatar_path = db.Column(db.String(255))
    active = db.Column(db.Boolean, default=True)
    multiplier_id = db.Column(db.Integer, db.ForeignKey('multipliers.id'))
    
    # Relacja: User → Multiplier
    multiplier = db.relationship('Multiplier', backref='users')

    def __repr__(self):
        return f"<User {self.email}>"

class Invitation(db.Model):
    __tablename__ = 'invitations'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), nullable=False, unique=True)
    token = db.Column(db.String(256), nullable=False, unique=True)
    active = db.Column(db.Boolean, default=True)
    role = db.Column(db.String(20))
    multiplier_id = db.Column(db.Integer, db.ForeignKey('multipliers.id'), nullable=True)
    multiplier = db.relationship('Multiplier')

    def __repr__(self):
        return f'<Invitation {self.email} - {"active" if self.active else "inactive"}>'

class FinishingColor(db.Model):
    __tablename__ = 'finishing_colors'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    image_path = db.Column(db.String(255), nullable=True)
    is_available = db.Column(db.Boolean, default=True)

    def __repr__(self):
        return f'<FinishingColor {self.name}>'