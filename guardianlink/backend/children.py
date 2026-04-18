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


@children_api.route("/children/with-stats", methods=["GET"])
def list_children_with_stats():
    """
    Returns all linked children for the logged-in guardian,
    each enriched with per-child message stats from the messages collection:
      - total_messages, risky_messages, grooming_messages
      - max_risk_score, dominant_emotion, escalation_flag
      - last_seen timestamp
    """
    guardian = _current_guardian()
    if not guardian:
        return jsonify({"success": False, "message": "Not logged in"}), 401

    records = list(children_col.find({"guardian_email": guardian}))

    messages_col = db["messages"]
    enriched = []
    for r in records:
        r.pop("_id", None)
        sid = r["child_username"]

        msgs = list(messages_col.find({"sender_id": sid}))
        total   = len(msgs)
        risky   = sum(1 for m in msgs if m.get("is_risky"))
        groomed = sum(1 for m in msgs if m.get("is_grooming"))
        escal   = any(m.get("escalation_flag") for m in msgs)
        max_risk = round(max((m.get("risk_score", 0) for m in msgs), default=0), 2)

        # dominant emotion across all messages for this child
        from collections import Counter
        emotions = [m.get("dominant_emotion") for m in msgs if m.get("dominant_emotion")]
        dom_emotion = Counter(emotions).most_common(1)[0][0] if emotions else None

        # last message timestamp
        timestamps = [m.get("timestamp") for m in msgs if m.get("timestamp")]
        last_seen = sorted(timestamps)[-1] if timestamps else None

        r["stats"] = {
            "total_messages":   total,
            "risky_messages":   risky,
            "grooming_messages": groomed,
            "escalation_flag":  escal,
            "max_risk_score":   max_risk,
            "dominant_emotion": dom_emotion,
            "last_seen":        last_seen,
        }
        enriched.append(r)

    return jsonify({"success": True, "children": enriched})


@children_api.route("/children/seed-from-mock", methods=["POST"])
def seed_from_mock():
    """
    Reads mock_data.json, extracts every unique sender_id, and
    bulk-inserts them as child profiles for the logged-in guardian.
    Already-linked usernames are skipped (no duplicates).

    Auto-generates display names:
        user1 → Child 1, user2 → Child 2, etc.
    Custom name can be provided via request body:
        { "names": { "user1": "Alex", "user2": "Jordan" } }
    """
    guardian = _current_guardian()
    if not guardian:
        return jsonify({"success": False, "message": "Not logged in"}), 401

    import json, os
    mock_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock_data.json")
    try:
        with open(mock_path) as f:
            mock_messages = json.load(f)
    except Exception as e:
        return jsonify({"success": False, "message": f"Could not read mock_data.json: {e}"}), 500

    # Extract unique sender_ids in the order they first appear
    seen = []
    for m in mock_messages:
        sid = m.get("sender_id", "").strip()
        if sid and sid not in seen:
            seen.append(sid)

    # Optional custom names from request body
    custom_names = (request.json or {}).get("names", {})

    # Default name generator: user1 → Child 1, user2 → Child 2, @alex → Alex, etc.
    def _default_name(sid, idx):
        if custom_names.get(sid):
            return custom_names[sid]
        # Strip "user" prefix and turn into "Child N"
        import re
        num = re.sub(r"^user", "", sid)
        if num.isdigit():
            return f"Child {num}"
        # e.g. @alex_ig → Alex Ig
        clean = re.sub(r"[@_]", " ", sid).title().strip()
        return clean or f"Child {idx + 1}"

    added, skipped = [], []
    seen_with_names = {}
    for m in mock_messages:
        sid = m.get("sender_id", "").strip()
        if not sid or sid in seen_with_names:
            continue
        # Use display_name embedded in mock_data if present
        seen_with_names[sid] = m.get("display_name") or None

    for idx, (sid, embedded_name) in enumerate(seen_with_names.items()):
        existing = children_col.find_one({"guardian_email": guardian, "child_username": sid})
        if existing:
            skipped.append(sid)
            continue
        display = custom_names.get(sid) or embedded_name or _default_name(sid, idx)
        children_col.insert_one({
            "guardian_email": guardian,
            "child_username": sid,
            "display_name":   display,
        })
        added.append({"child_username": sid, "display_name": display})

    return jsonify({
        "success": True,
        "added":   added,
        "skipped": skipped,
        "message": f"{len(added)} child account(s) linked from mock data"
                   + (f", {len(skipped)} already existed" if skipped else ""),
    })


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
