from flask import Blueprint, request, jsonify, session
from db import get_all_messages, save_message
from auth import register_user, login_user
from utils_extended import process_message_full
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
    # BUG FIX: wrapped each message processing in try/except so a single
    # bad message (e.g. HuggingFace 403 or Anthropic error) never breaks
    # the entire dashboard response. Failed messages are still saved with
    # whatever fields were populated before the error.
    messages = fetch_mock_messages()
    for msg in messages:
        try:
            msg = process_message_full(msg)
        except Exception as e:
            print(f"[dashboard] processing error for {msg.get('sender_id')}: {e}")
            # Ensure minimum required fields exist so save_message works
            msg.setdefault("risk_score", 0.0)
            msg.setdefault("is_risky", False)
            msg.setdefault("grooming_score", 0.0)
            msg.setdefault("is_grooming", False)
            msg.setdefault("grooming_stages", {})
            msg.setdefault("escalation_flag", False)
            msg.setdefault("risk_explanation", None)
        save_message(msg)

    # Get all processed messages from DB
    all_msgs = get_all_messages()

    # Clean _id field (MongoDB ObjectId not JSON-serialisable)
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
