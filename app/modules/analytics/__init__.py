from flask import Blueprint

analytics_bp = Blueprint(
    "analytics",
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/analytics/static"
)

from . import routers
