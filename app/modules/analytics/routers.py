# modules/analytics/routers.py

from flask import Blueprint, render_template, jsonify, current_app, session
from modules.public_calculator.models import PublicSession
from sqlalchemy import func
from extensions import db
import os
import json

analytics_bp = Blueprint("analytics", __name__,
                         template_folder="templates",
                         static_folder="static")

@analytics_bp.route("/analytics")
def analytics_dashboard():
    total_sessions = db.session.query(func.count(PublicSession.id)).scalar()
    avg_duration = db.session.query(func.avg(PublicSession.duration_ms)).scalar() or 0
    avg_duration_sec = round(avg_duration / 1000, 2)
    color_sessions = db.session.query(func.count()).filter(PublicSession.color.isnot(None)).scalar()
    variant_sessions = db.session.query(func.count()).filter(PublicSession.variant.isnot(None)).scalar()
    user_email = session.get("user_email")

    return render_template(
        "analytics.html",
        total_sessions=total_sessions,
        avg_duration_sec=avg_duration_sec,
        color_sessions=color_sessions,
        variant_sessions=variant_sessions,
        user_email=user_email
    )

@analytics_bp.route("/debug_static")
def debug_static():
    static_path = os.path.join(current_app.root_path, "modules", "analytics", "static", "js", "public_analytics.js")
    exists = os.path.exists(static_path)
    return f"Ścieżka: {static_path} | Istnieje: {exists}"

@analytics_bp.route("/data")
def analytics_data():
    print("[analytics_data] Endpoint hit!")

    variants_query = db.session.query(PublicSession.variant, func.count()).group_by(PublicSession.variant).all()
    finishings_query = db.session.query(PublicSession.finishing, func.count()).group_by(PublicSession.finishing).all()
    colors_query = db.session.query(PublicSession.color, func.count()).group_by(PublicSession.color).all()

    # Parsowanie wymiarów z JSON w kolumnie 'inputs'
    dims_raw = db.session.query(PublicSession.inputs).all()
    dims_counter = {}
    for row in dims_raw:
        try:
            data = json.loads(row[0])
            key = f"{data.get('length', '?')}x{data.get('width', '?')}x{data.get('thickness', '?')}"
            dims_counter[key] = dims_counter.get(key, 0) + 1
        except Exception as e:
            print("[analytics_data] Blad parsowania inputs:", e)

    # Formatowanie danych do response
    data = {
        "variants": {
            "label": "Warianty",
            "labels": [v[0] for v in variants_query],
            "values": [v[1] for v in variants_query]
        },
        "finishings": {
            "label": "Wykończenia",
            "labels": [f[0] for f in finishings_query],
            "values": [f[1] for f in finishings_query]
        },
        "colors": {
            "label": "Kolory",
            "labels": [c[0] for c in colors_query],
            "values": [c[1] for c in colors_query]
        },
        "dimensions": {
            "label": "Wymiary",
            "labels": list(dims_counter.keys()),
            "values": list(dims_counter.values())
        }
    }

    print("[analytics_data] Wysylam dane JSON...")

    return jsonify(data)