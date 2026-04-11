from flask import Blueprint, request, jsonify, session
from db import get_all_messages, save_message
from auth import register_user, login_user
from utils import process_message_with_context
from instagram_api import fetch_mock_messages

api = Blueprint("api", __name__)

@api.route("/register", methods=["POST"])
def register():
    data = request.json
    success, msg = register_user(data["email"], data["password"])
    return jsonify({"success": success, "message": msg})

@api.route("/login", methods=["POST"])
def login():
    data = request.json
    success, user = login_user(data["email"], data["password"])
    if success:
        session["user"] = user["email"]
        return jsonify({"success": True})
    return jsonify({"success": False})

@api.route("/logout")
def logout():
    session.clear()
    return jsonify({"success": True})

@api.route("/dashboard")
def dashboard_data():
    # Run collector to process mock data every time
    messages = fetch_mock_messages()
    for msg in messages:
        msg = process_message_with_context(msg)
        save_message(msg)

    # Get all from DB
    all_msgs = get_all_messages()

    # Clean _id field (MongoDB ObjectId not serializable)
    clean = []
    for m in all_msgs:
        m.pop("_id", None)
        clean.append(m)

    total = len(clean)
    risky = len([m for m in clean if m.get("is_risky")])

    return jsonify({
        "report": {
            "total_messages": total,
            "risky_messages": risky,
            "safe_messages": total - risky,
            "risk_percentage": round((risky / total * 100), 1) if total else 0
        },
        "messages": clean
    })