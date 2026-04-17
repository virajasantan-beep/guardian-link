"""
app.py  –  Guardian Link
Add social_auth blueprint alongside existing ones.
Replace your current app.py with this file.
"""

from flask import Flask, render_template
from flask_cors import CORS

import os

from routes import api
from auth import bcrypt
from instagram_api import fetch_mock_messages
from utils import process_message_with_context
from db import save_message
from children import children_api
from routes_additions import report_api
from report_generator import start_weekly_report_scheduler

# ── NEW: social OAuth blueprint ──
from social_auth import social_api


app = Flask(
    __name__,
    template_folder="../frontend/templates",
    static_folder="../frontend/static",
)

# IMPORTANT: use a real random secret in production!
app.secret_key = os.getenv("FLASK_SECRET_KEY", "CHANGE_ME_IN_PRODUCTION")
CORS(app)
bcrypt.init_app(app)

# ── Existing blueprints ──
app.register_blueprint(api,         url_prefix="/api")
app.register_blueprint(children_api, url_prefix="/api")
app.register_blueprint(report_api,  url_prefix="/api")

# ── Social accounts blueprint ──
app.register_blueprint(social_api,  url_prefix="/api/social")

start_weekly_report_scheduler(app)


# ── ML collector (unchanged) ──
def run_collector():
    print("🔄 Running ML collector once...")
    messages = fetch_mock_messages()
    for msg in messages:
        msg = process_message_with_context(msg)
        save_message(msg)


# ── Routes (unchanged) ──
@app.route("/")
def home():
    return render_template("login.html")


@app.route("/register")
def register_page():
    return render_template("register.html")


@app.route("/dashboard")
def dashboard_page():
    return render_template("dashboard.html")


if __name__ == "__main__":
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        run_collector()
    app.run(debug=True)
