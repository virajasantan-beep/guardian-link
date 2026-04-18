"""
video_monitor.py  –  Guardian Link
REST endpoints for real-time video monitoring.

Registered as: app.register_blueprint(video_api, url_prefix="/api/monitor")

Endpoints
---------
POST /api/monitor/start-session
POST /api/monitor/upload-chunk
GET  /api/monitor/risk-status/<session_id>
POST /api/monitor/stop-session/<session_id>

WebSocket events (declared in websocket_events.py):
    connect, join_session, leave_session, risk_update, alert
"""

from __future__ import annotations

import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Dict

from flask import Blueprint, request, jsonify, session

from video_ml import analyze_chunk, SessionRiskTracker, RiskReport
from alerts import trigger_alert          # reuse existing alert system
from db import client as mongo_client     # reuse existing mongo client

video_api = Blueprint("video_api", __name__)

# ─────────────────────────────────────────────────────────────────────────────
#  In-memory session registry
# ─────────────────────────────────────────────────────────────────────────────
#  A single-process store is fine for the current dev setup (single gunicorn
#  worker + SocketIO). If you later scale to multiple workers, move this into
#  Redis. The shape is intentionally serializable.

_SESSIONS: Dict[str, dict] = {}
_SESSIONS_LOCK = threading.Lock()

# Mongo collection for persistent history (optional but useful for the
# existing reports/alerts pipeline to pick up video events too).
_video_events = mongo_client["guardian_link"]["video_events"]


# ─────────────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _current_user() -> str | None:
    """Reuse the existing session auth. None if not logged in."""
    return session.get("user")


def _require_login():
    user = _current_user()
    if not user:
        return None, (jsonify({"success": False, "error": "not_logged_in"}), 401)
    return user, None


def _get_session(session_id: str) -> dict | None:
    with _SESSIONS_LOCK:
        return _SESSIONS.get(session_id)


def _emit_risk_update(session_id: str, payload: dict) -> None:
    """
    Push a risk update to any WebSocket clients watching this session.
    Imported lazily to avoid a circular import at module load (socketio
    is created in app.py and imported by websocket_events).
    """
    try:
        from websocket_events import emit_risk_update
        emit_risk_update(session_id, payload)
    except Exception as exc:                                    # pragma: no cover
        # Never let a socket failure break the REST response.
        print(f"[video_monitor] ws emit failed: {exc}")


def _maybe_trigger_alert(session_id: str, user: str, result: dict) -> None:
    """Bridge to the existing alerts.trigger_alert() function."""
    if not result.get("escalate"):
        return
    try:
        trigger_alert({
            "sender_id": f"video:{session_id[:8]}",
            "message":   f"Live video HIGH risk (threat={result['threat_type']})",
            "risk_score": result["smoothed_score"] / 100.0,
        })
    except Exception as exc:                                    # pragma: no cover
        print(f"[video_monitor] alert bridge failed: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
#  POST /start-session
# ─────────────────────────────────────────────────────────────────────────────

@video_api.route("/start-session", methods=["POST"])
def start_session():
    """
    Body (JSON, optional):
        { "source": "camera" | "screen" | "both", "child_id": "..." }

    Returns:
        { "success": true, "session_id": "...", "ws_room": "..." }
    """
    user, err = _require_login()
    if err:
        return err

    body = request.get_json(silent=True) or {}
    source = body.get("source", "camera")
    if source not in ("camera", "screen", "both"):
        return jsonify({"success": False, "error": "invalid_source"}), 400

    session_id = uuid.uuid4().hex
    with _SESSIONS_LOCK:
        _SESSIONS[session_id] = {
            "session_id": session_id,
            "user":       user,
            "child_id":   body.get("child_id"),
            "source":     source,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "chunks_received": 0,
            "tracker":    SessionRiskTracker(),
            "last_result": None,
            "active":     True,
        }

    return jsonify({
        "success":    True,
        "session_id": session_id,
        "ws_room":    f"monitor:{session_id}",
    })


# ─────────────────────────────────────────────────────────────────────────────
#  POST /upload-chunk
# ─────────────────────────────────────────────────────────────────────────────

@video_api.route("/upload-chunk", methods=["POST"])
def upload_chunk():
    """
    Accepts multipart/form-data:
        session_id : str
        source     : "camera" | "screen"   (optional, defaults to session source)
        chunk      : file (webm/mp4 blob from MediaRecorder)

    Returns:
        { "success": true,
          "instant_score": int, "smoothed_score": int,
          "level": "LOW"|"MEDIUM"|"HIGH",
          "threat_type": str, "confidence": float,
          "escalate": bool }
    """
    user, err = _require_login()
    if err:
        return err

    session_id = request.form.get("session_id")
    if not session_id:
        return jsonify({"success": False, "error": "missing_session_id"}), 400

    sess = _get_session(session_id)
    if sess is None:
        return jsonify({"success": False, "error": "unknown_session"}), 404
    if sess["user"] != user:
        return jsonify({"success": False, "error": "forbidden"}), 403
    if not sess["active"]:
        return jsonify({"success": False, "error": "session_closed"}), 409

    chunk_file = request.files.get("chunk")
    if chunk_file is None:
        return jsonify({"success": False, "error": "missing_chunk"}), 400

    chunk_bytes = chunk_file.read()
    if not chunk_bytes:
        return jsonify({"success": False, "error": "empty_chunk"}), 400

    source = request.form.get("source") or sess["source"]
    if source == "both":
        source = "camera"

    # ── ML inference (synchronous here — the Flask worker thread handles
    #    concurrency; analyze_chunk is fully CPU-bound and quick).
    report: RiskReport = analyze_chunk(chunk_bytes, source=source)
    result = sess["tracker"].update(report)

    with _SESSIONS_LOCK:
        sess["chunks_received"] += 1
        sess["last_result"] = result

    # ── Persist for reports pipeline ─────────────────────────────────
    try:
        _video_events.insert_one({
            "session_id":  session_id,
            "user":        user,
            "child_id":    sess.get("child_id"),
            "source":      source,
            "timestamp":   datetime.now(timezone.utc).isoformat(),
            "instant_score":   result["instant_score"],
            "smoothed_score":  result["smoothed_score"],
            "level":       result["level"],
            "threat_type": result["threat_type"],
            "confidence":  result["confidence"],
            "reasons":     result["reasons"],
        })
    except Exception as exc:                                    # pragma: no cover
        print(f"[video_monitor] mongo write failed: {exc}")

    # ── Push live update to WS clients ───────────────────────────────
    _emit_risk_update(session_id, {**result, "session_id": session_id})
    _maybe_trigger_alert(session_id, user, result)

    return jsonify({"success": True, **result})


# ─────────────────────────────────────────────────────────────────────────────
#  GET /risk-status/<session_id>
# ─────────────────────────────────────────────────────────────────────────────

@video_api.route("/risk-status/<session_id>", methods=["GET"])
def risk_status(session_id: str):
    user, err = _require_login()
    if err:
        return err

    sess = _get_session(session_id)
    if sess is None:
        return jsonify({"success": False, "error": "unknown_session"}), 404
    if sess["user"] != user:
        return jsonify({"success": False, "error": "forbidden"}), 403

    return jsonify({
        "success":          True,
        "session_id":       session_id,
        "active":           sess["active"],
        "started_at":       sess["started_at"],
        "chunks_received":  sess["chunks_received"],
        "source":           sess["source"],
        "last":             sess["last_result"],
    })


# ─────────────────────────────────────────────────────────────────────────────
#  POST /stop-session/<session_id>
# ─────────────────────────────────────────────────────────────────────────────

@video_api.route("/stop-session/<session_id>", methods=["POST"])
def stop_session(session_id: str):
    user, err = _require_login()
    if err:
        return err

    with _SESSIONS_LOCK:
        sess = _SESSIONS.get(session_id)
        if sess is None:
            return jsonify({"success": False, "error": "unknown_session"}), 404
        if sess["user"] != user:
            return jsonify({"success": False, "error": "forbidden"}), 403
        sess["active"] = False
        sess["stopped_at"] = datetime.now(timezone.utc).isoformat()

    return jsonify({
        "success":         True,
        "session_id":      session_id,
        "chunks_received": sess["chunks_received"],
    })


# ─────────────────────────────────────────────────────────────────────────────
#  Convenience: list my active sessions (optional, used by UI on reload)
# ─────────────────────────────────────────────────────────────────────────────

@video_api.route("/my-sessions", methods=["GET"])
def my_sessions():
    user, err = _require_login()
    if err:
        return err

    with _SESSIONS_LOCK:
        mine = [
            {
                "session_id":      s["session_id"],
                "source":          s["source"],
                "started_at":      s["started_at"],
                "chunks_received": s["chunks_received"],
                "active":          s["active"],
                "last":            s["last_result"],
            }
            for s in _SESSIONS.values() if s["user"] == user
        ]
    return jsonify({"success": True, "sessions": mine})


# Exposed for tests / admin:
def _reset_sessions_for_tests() -> None:
    with _SESSIONS_LOCK:
        _SESSIONS.clear()
