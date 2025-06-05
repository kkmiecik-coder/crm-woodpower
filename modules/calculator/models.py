from extensions import db
from datetime import datetime
from sqlalchemy.dialects.mysql import DECIMAL

class Multiplier(db.Model):
    __tablename__ = 'multipliers'
    id = db.Column(db.Integer, primary_key=True)
    client_type = db.Column(db.String(50), unique=True, nullable=False)
    multiplier = db.Column(db.Float, nullable=False)

    def __repr__(self):
        return f"<Multiplier {self.client_type}: {self.multiplier}>"

class Quote(db.Model):
    __tablename__ = 'quotes'
    id = db.Column(db.Integer, primary_key=True)
    quote_number = db.Column(db.String(20), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'))
    status_id = db.Column(db.Integer, db.ForeignKey('quote_statuses.id'))
    base_linker_order_id = db.Column(db.String(50))
    source = db.Column(db.String(100))
    total_price = db.Column(db.Float)
    courier_name = db.Column(db.String(100))
    shipping_cost_netto = db.Column(db.Float)
    shipping_cost_brutto = db.Column(db.Float)

    # Relacje
    client = db.relationship("Client", backref="quotes", primaryjoin="Quote.client_id == Client.id")
    user = db.relationship("User", backref="quotes", primaryjoin="Quote.user_id == User.id")
    quote_status = db.relationship("QuoteStatus", backref="quotes", foreign_keys=[status_id], lazy="joined")
    items = db.relationship("QuoteItem", backref="quote", lazy="joined")

    def __repr__(self):
        return f"<Quote {self.quote_number} StatusID:{self.status_id}>"


class QuoteItem(db.Model):
    __tablename__ = 'quote_items'
    id = db.Column(db.Integer, primary_key=True)
    quote_id = db.Column(db.Integer, db.ForeignKey('quotes.id'), nullable=False)
    product_index = db.Column(db.Integer, nullable=False)
    variant_code = db.Column(db.String(100))
    length_cm = db.Column(db.Float, nullable=False)
    width_cm = db.Column(db.Float, nullable=False)
    thickness_cm = db.Column(db.Float, nullable=False)
    volume_m3 = db.Column(db.Float)
    price_per_m3 = db.Column(db.Float)
    multiplier = db.Column(db.Float)
    is_selected = db.Column(db.Boolean, default=False)
    final_price_netto = db.Column(db.Float)
    final_price_brutto = db.Column(db.Float)

    def __repr__(self):
        return f"<QuoteItem Produkt #{self.product_index} FinalPrice:{self.final_price}>"

class QuoteItemDetails(db.Model):
    __tablename__ = 'quote_items_details'

    id = db.Column(db.Integer, primary_key=True)
    quote_id = db.Column(db.Integer, db.ForeignKey('quotes.id'), nullable=False)
    product_index = db.Column(db.Integer, nullable=False)
    finishing_type = db.Column(db.String(50))
    finishing_variant = db.Column(db.String(50))
    finishing_color = db.Column(db.String(100))
    finishing_gloss_level = db.Column(db.String(50))
    finishing_price_netto = db.Column(db.Float)
    finishing_price_brutto = db.Column(db.Float)

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
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='user')
    reset_token = db.Column(db.String(256), nullable=True)
    first_name = db.Column(db.String(50))
    last_name = db.Column(db.String(50))
    avatar_path = db.Column(db.String(255))
    active = db.Column(db.Boolean, default=True)
    multiplier_id = db.Column(db.Integer, db.ForeignKey('multipliers.id'))
    multiplier = db.relationship('Multiplier')

    def __repr__(self):
        return f'<User {self.email}>'

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