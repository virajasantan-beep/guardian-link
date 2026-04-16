from flask import Flask, render_template
from flask_cors import CORS

import threading
import os


from routes import api
from auth import bcrypt
from instagram_api import fetch_mock_messages
from utils import process_message_with_context
from db import save_message
from routes import api
from children import children_api
from routes_additions import report_api
from report_generator import start_weekly_report_scheduler


app = Flask(
    __name__,
    template_folder="../frontend/templates",
    static_folder="../frontend/static"
)

app.secret_key = "secret"
CORS(app)
bcrypt.init_app(app)

# Register API


app.register_blueprint(api, url_prefix="/api")
app.register_blueprint(children_api, url_prefix="/api")
app.register_blueprint(report_api,   url_prefix="/api")
start_weekly_report_scheduler(app)

# ============================
# 🔄 RUN ML ONCE
# ============================
def run_collector():
    print("🔄 Running ML collector once...")
    messages = fetch_mock_messages()

    for msg in messages:
        msg = process_message_with_context(msg)
        save_message(msg)


# ============================
# ROUTES
# ============================
@app.route("/")
def home():
    return render_template("login.html")


@app.route("/register")
def register_page():
    return render_template("register.html")


@app.route("/dashboard")
def dashboard_page():
    return render_template("dashboard.html")


# ============================
# START
# ============================
if __name__ == "__main__":
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        run_collector()

    app.run(debug=True)