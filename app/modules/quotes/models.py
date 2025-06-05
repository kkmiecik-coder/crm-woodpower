# modules/quotes/models.py
from extensions import db

class QuoteStatus(db.Model):
    __tablename__ = 'quote_statuses'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    color_hex = db.Column('color_hex', db.String(20), nullable=True)

    def __repr__(self):
        return f"<QuoteStatus {self.name}>"