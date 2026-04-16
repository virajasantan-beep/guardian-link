from flask import Blueprint, request, jsonify, session
from pymongo import MongoClient

# ── DB SETUP ─────────────────────────────────────────────────────────────────
# Reuses the same MongoDB instance as the rest of the app
client = MongoClient("mongodb://localhost:27017/")
db = client["guardian_link"]
children_col = db["children"]

children_api = Blueprint("children_api", __name__)


# ── HELPERS ───────────────────────────────────────────────────────────────────

def _current_guardian() -> str | None:
    """Returns logged-in guardian email from Flask session."""
    return session.get("user")


def get_child_display_name(sender_id: str) -> str | None:
    """
    Looks up a sender_id across ALL guardian accounts and returns the
    display_name if found.  Used by routes.py to annotate messages.

    Returns None if the sender_id is not linked to any child profile.
    """
    record = children_col.find_one({"child_username": sender_id})
    return record["display_name"] if record else None


def resolve_sender_labels(messages: list) -> list:
    """
    Enriches a list of message dicts with a 'display_name' field where
    a matching child profile exists.

    Drop-in helper — call it on the clean message list in routes.py:
        from children import resolve_sender_labels
        clean = resolve_sender_labels(clean)
    """
    for msg in messages:
        label = get_child_display_name(msg.get("sender_id", ""))
        msg["display_name"] = label or msg.get("sender_id", "unknown")
    return messages


# ── ROUTES ───────────────────────────────────────────────────────────────────

@children_api.route("/children", methods=["GET"])
def list_children():
    """Returns all child profiles for the logged-in guardian."""
    guardian = _current_guardian()
    if not guardian:
        return jsonify({"success": False, "message": "Not logged in"}), 401

    records = list(children_col.find({"guardian_email": guardian}))
    for r in records:
        r.pop("_id", None)

    return jsonify({"success": True, "children": records})


@children_api.route("/children/add", methods=["POST"])
def add_child():
    """
    Links a child username to the logged-in guardian account.

    Expected JSON body:
    {
        "child_username": "user3",
        "display_name":   "Alex"
    }
    """
    guardian = _current_guardian()
    if not guardian:
        return jsonify({"success": False, "message": "Not logged in"}), 401

    data = request.json or {}
    child_username = (data.get("child_username") or "").strip()
    display_name = (data.get("display_name") or "").strip()

    if not child_username or not display_name:
        return jsonify({"success": False, "message": "Both fields are required"}), 400

    # Prevent duplicate entries for the same guardian
    existing = children_col.find_one({
        "guardian_email": guardian,
        "child_username": child_username
    })
    if existing:
        return jsonify({"success": False, "message": "Child already linked"}), 409

    children_col.insert_one({
        "guardian_email":  guardian,
        "child_username":  child_username,
        "display_name":    display_name,
    })

    return jsonify({"success": True, "message": f"{display_name} linked successfully"})


@children_api.route("/children/remove", methods=["POST"])
def remove_child():
    """
    Removes a child profile.

    Expected JSON body:
    { "child_username": "user3" }
    """
    guardian = _current_guardian()
    if not guardian:
        return jsonify({"success": False, "message": "Not logged in"}), 401

    child_username = (request.json or {}).get("child_username", "").strip()
    if not child_username:
        return jsonify({"success": False, "message": "child_username required"}), 400

    result = children_col.delete_one({
        "guardian_email": guardian,
        "child_username": child_username
    })

    if result.deleted_count:
        return jsonify({"success": True, "message": "Child removed"})
    return jsonify({"success": False, "message": "Child not found"}), 404
