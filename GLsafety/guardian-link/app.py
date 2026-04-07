from flask import Flask, render_template, request, redirect, session, jsonify
import sqlite3

# ML IMPORTS
from ml.utils import process_message_with_context
from ml.reports import generate_risk_report
from ml.risk_engine import calculate_user_risk
from ml.alerts import trigger_alert

app = Flask(__name__)
app.secret_key = "secret123"

DB = "database.db"


# ================= DB =================
def get_db():
    return sqlite3.connect(DB)


# ================= AUTH =================
@app.route("/", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user = request.form["username"]
        role = request.form["role"]

        session["user"] = user
        session["role"] = role

        if role == "child":
            return redirect("/child")
        else:
            return redirect("/parent")

    return render_template("login.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    return render_template("register.html")


# ================= CHILD DASHBOARD =================
@app.route("/child", methods=["GET", "POST"])
def child_dashboard():
    result = None

    if request.method == "POST":
        text = request.form["message"]

        msg = {
            "sender_id": session["user"],
            "message": text,
            "timestamp": "now"
        }

        msg = process_message_with_context(msg)

        if msg["is_risky"]:
            trigger_alert(msg)

        result = msg

    return render_template("child_dashboard.html", result=result)


# ================= PARENT DASHBOARD =================
@app.route("/parent")
def parent_dashboard():
    report = generate_risk_report()
    users = calculate_user_risk()

    return render_template("parent_dashboard.html",
                           report=report,
                           users=users)


# ================= API (OPTIONAL) =================
@app.route("/api/check", methods=["POST"])
def check():
    data = request.json

    msg = {
        "sender_id": "api_user",
        "message": data["text"],
        "timestamp": "now"
    }

    msg = process_message_with_context(msg)

    return jsonify(msg)


# ================= RUN =================
if __name__ == "__main__":
    app.run(debug=True)