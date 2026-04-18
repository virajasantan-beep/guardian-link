"""
app.py  –  Guardian Link
Add social_auth blueprint alongside existing ones.
Replace your current app.py with this file.

CHANGES vs original:
  + import flask_socketio.SocketIO
  + import video_monitor blueprint
  + import register_socket_events
  + wrap app in SocketIO
  + register video_api blueprint under /api/monitor
  + register socket event handlers
  + use socketio.run() instead of app.run() when executed directly
"""

from flask import Flask, render_template
from flask_cors import CORS
from flask_socketio import SocketIO                       # NEW

import os

from routes import api
from auth import bcrypt
from instagram_api import fetch_mock_messages
from utils import process_message_with_context
from db import save_message
from children import children_api
from routes_additions import report_api
from report_generator import start_weekly_report_scheduler

# ── Social OAuth blueprint ──
from social_auth import social_api

# ── NEW: live video monitor ──
from video_monitor import video_api
from websocket_events import register_socket_events


app = Flask(
    __name__,
    template_folder="../frontend/templates",
    static_folder="../frontend/static",
)

# IMPORTANT: use a real random secret in production!
app.secret_key = os.getenv("FLASK_SECRET_KEY", "CHANGE_ME_IN_PRODUCTION")
CORS(app)
bcrypt.init_app(app)

# ── SocketIO: cors_allowed_origins="*" is fine in dev; tighten for prod ──
# async_mode="threading" keeps the dev path simple (no eventlet/gevent needed).
# If you later use gunicorn with eventlet workers, change this to "eventlet".
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ── Existing blueprints ──
app.register_blueprint(api,          url_prefix="/api")
app.register_blueprint(children_api, url_prefix="/api")
app.register_blueprint(report_api,   url_prefix="/api")

# ── Social accounts blueprint ──
app.register_blueprint(social_api,   url_prefix="/api/social")

# ── NEW: video monitor blueprint ──
app.register_blueprint(video_api,    url_prefix="/api/monitor")

# ── NEW: register WebSocket handlers ──
register_socket_events(socketio)

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
    # CHANGED: must use socketio.run() instead of app.run() so the
    # WebSocket upgrade path works. Everything else is unchanged.
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True)
