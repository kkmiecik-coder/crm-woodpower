from extensions import db
from datetime import datetime

class ChangelogEntry(db.Model):
    __tablename__ = 'changelog_entries'
    
    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.String(20), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    is_visible = db.Column(db.Boolean, default=True)
    
    # Relacje
    items = db.relationship('ChangelogItem', backref='entry', cascade='all, delete-orphan', order_by='ChangelogItem.sort_order')
    creator = db.relationship('User', backref='changelog_entries')
    
    @staticmethod
    def get_next_version():
        """Automatycznie generuje następną wersję"""
        latest = ChangelogEntry.query.order_by(ChangelogEntry.version.desc()).first()
        if not latest:
            return "1.0.0"
        
        # Parsuj aktualną wersję
        version_parts = latest.version.split('.')
        if len(version_parts) == 2:  # X.Y format
            major, minor = int(version_parts[0]), int(version_parts[1])
            return f"{major}.{minor}.1"
        elif len(version_parts) == 3:  # X.Y.Z format
            major, minor, patch = int(version_parts[0]), int(version_parts[1]), int(version_parts[2])
            return f"{major}.{minor}.{patch + 1}"
        else:
            return "1.0.0"
    
    @staticmethod
    def validate_version(version, current_id=None):
        """Waliduje czy wersja jest poprawna"""
        import re
        
        # Sprawdź format
        if not re.match(r'^\d+\.\d+(\.\d+)?$', version):
            return False, "Niepoprawny format wersji. Użyj X.Y lub X.Y.Z"
        
        # Sprawdź czy wersja już istnieje
        query = ChangelogEntry.query.filter_by(version=version)
        if current_id:
            query = query.filter(ChangelogEntry.id != current_id)
        
        if query.first():
            return False, "Ta wersja już istnieje"
        
        # Sprawdź czy nie cofamy się w wersji
        latest = ChangelogEntry.query.order_by(ChangelogEntry.version.desc()).first()
        if latest and current_id != latest.id:
            if version_compare(version, latest.version) <= 0:
                return False, f"Nie możesz utworzyć wersji starszej niż {latest.version}"
        
        return True, None

class ChangelogItem(db.Model):
    __tablename__ = 'changelog_items'
    
    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey('changelog_entries.id'), nullable=False)
    section_type = db.Column(db.Enum('added', 'improved', 'fixed', 'custom'), nullable=False)
    custom_section_name = db.Column(db.String(100))
    item_text = db.Column(db.Text, nullable=False)
    sort_order = db.Column(db.Integer, default=0)

def version_compare(v1, v2):
    """Porównuje wersje. Zwraca: -1 (v1<v2), 0 (v1==v2), 1 (v1>v2)"""
    def normalize(v):
        parts = v.split('.')
        while len(parts) < 3:
            parts.append('0')
        return [int(x) for x in parts]
    
    v1_parts = normalize(v1)
    v2_parts = normalize(v2)
    
    for i in range(3):
        if v1_parts[i] < v2_parts[i]:
            return -1
        elif v1_parts[i] > v2_parts[i]:
            return 1
    return 0