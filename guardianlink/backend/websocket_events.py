"""
websocket_events.py  –  Guardian Link
Flask-SocketIO handlers for live risk feedback.

The socketio instance is created in app.py and imported here lazily (via
`register_socket_events(socketio)`) so we avoid circular imports.

Client contract
---------------
Client → Server
    "join_session"   { session_id }    → joins room "monitor:<sid>"
    "leave_session"  { session_id }    → leaves room
    "ping_session"   { session_id }    → server replies with last risk state

Server → Client
    "connected"      { sid }           → on connect
    "joined"         { session_id }    → ack
    "risk_update"    { ...risk dict }  → every processed chunk
    "alert"          { message, ... }  → escalation events
    "error"          { error }         → user-facing errors
"""

from __future__ import annotations

from typing import Optional
from flask import session

# We bind these in register_socket_events().
_socketio = None


# ─────────────────────────────────────────────────────────────────────────────
#  Registration
# ─────────────────────────────────────────────────────────────────────────────

def register_socket_events(socketio) -> None:
    """Wire up handlers. Called once from app.py after SocketIO() is built."""
    global _socketio
    _socketio = socketio

    from flask_socketio import join_room, leave_room, emit

    @socketio.on("connect")
    def _on_connect():
        # Auth gate: only authenticated users can open sockets.
        if not session.get("user"):
            emit("error", {"error": "not_logged_in"})
            return False                                       # rejects the connection
        emit("connected", {"ok": True})

    @socketio.on("disconnect")
    def _on_disconnect():
        # Nothing to clean up — SocketIO drops room membership on disconnect.
        pass

    @socketio.on("join_session")
    def _on_join(data):
        session_id = (data or {}).get("session_id")
        if not session_id:
            emit("error", {"error": "missing_session_id"})
            return

        # Reuse the video_monitor store to verify ownership.
        from video_monitor import _get_session
        sess = _get_session(session_id)
        if sess is None:
            emit("error", {"error": "unknown_session"})
            return
        if sess["user"] != session.get("user"):
            emit("error", {"error": "forbidden"})
            return

        join_room(f"monitor:{session_id}")
        emit("joined", {
            "session_id": session_id,
            "last":       sess.get("last_result"),
        })

    @socketio.on("leave_session")
    def _on_leave(data):
        session_id = (data or {}).get("session_id")
        if session_id:
            leave_room(f"monitor:{session_id}")
            emit("left", {"session_id": session_id})

    @socketio.on("ping_session")
    def _on_ping(data):
        session_id = (data or {}).get("session_id")
        if not session_id:
            return
        from video_monitor import _get_session
        sess = _get_session(session_id)
        if sess and sess["user"] == session.get("user"):
            emit("risk_update", {
                **(sess.get("last_result") or {}),
                "session_id": session_id,
            })


# ─────────────────────────────────────────────────────────────────────────────
#  Server-initiated emits (called from video_monitor.py)
# ─────────────────────────────────────────────────────────────────────────────

def emit_risk_update(session_id: str, payload: dict) -> None:
    """Broadcast a risk update to everyone watching this session."""
    if _socketio is None:
        return
    _socketio.emit("risk_update", payload, room=f"monitor:{session_id}")

    # If the server flagged escalation, also fire a dedicated "alert" event
    # so the UI can render something more visible than a badge tick.
    if payload.get("escalate"):
        _socketio.emit(
            "alert",
            {
                "session_id":  session_id,
                "level":       payload.get("level", "HIGH"),
                "threat_type": payload.get("threat_type"),
                "message":     f"Escalation: {payload.get('threat_type')} "
                               f"(score {payload.get('smoothed_score')})",
            },
            room=f"monitor:{session_id}",
        )
