# Guardian Link — Live Video Monitor Integration

This document describes the real-time video monitoring feature added to your
existing GuardianLink project. **Nothing in the original codebase was
rewritten** — this integration only adds files and makes small, surgical edits
to three existing files.

---

## 1. File Manifest

### New files (drop into the matching paths)

| File | Purpose |
|---|---|
| `backend/video_ml.py` | Frame decoder (OpenCV) + pluggable ML detector + session-level score smoothing |
| `backend/video_monitor.py` | Flask blueprint: REST endpoints for session lifecycle and chunk upload |
| `backend/websocket_events.py` | Flask-SocketIO handlers for live risk pushes |
| `frontend/static/js/monitor.js` | `MediaRecorder` + Socket.IO client (namespaced under `window.GLMonitor`) |
| `frontend/static/css/monitor.css` | Styling for the Live Monitor section |

### Modified files (3 files, small edits)

| File | Change |
|---|---|
| `backend/app.py` | +6 lines: import SocketIO, create instance, register blueprint + handlers, use `socketio.run()` |
| `frontend/templates/base.html` | +3 lines: load `monitor.css`, Socket.IO CDN, `monitor.js` |
| `frontend/templates/dashboard.html` | Adds 1 sidebar nav item + 1 `<section>` (patch shown in `dashboard.patch.html`) |
| `requirements.txt` | +2 lines: `opencv-python-headless`, `numpy` |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           BROWSER (dashboard.html)                   │
│                                                                      │
│   ┌──────────────┐     ┌──────────────┐     ┌───────────────────┐   │
│   │ getUserMedia │     │ getDisplay-  │     │ Risk pill + bar   │   │
│   │ (camera)     │     │   Media      │     │ Live alerts feed  │   │
│   └──────┬───────┘     └──────┬───────┘     └─────────▲─────────┘   │
│          │                    │                        │             │
│          └────────┬───────────┘                        │             │
│                   ▼                                    │             │
│          ┌─────────────────┐                           │             │
│          │ MediaRecorder   │                           │             │
│          │ slice: 1500 ms  │                           │             │
│          └────────┬────────┘                           │             │
│                   │ Blob (webm/vp9)                    │             │
│                   ▼                                    │             │
│          ┌─────────────────┐             ┌─────────────┴──────────┐  │
│          │ POST multipart  │             │ Socket.IO client       │  │
│          │ /upload-chunk   │             │ 'risk_update', 'alert' │  │
│          └────────┬────────┘             └─────────────▲──────────┘  │
└───────────────────┼──────────────────────────────────────┼───────────┘
                    │ HTTP/1.1                             │ WS
                    ▼                                      │
┌─────────────────────────────────────────────────────────────────────┐
│                          FLASK SERVER (app.py)                       │
│                                                                      │
│   ┌──────────────────────────────┐   ┌──────────────────────────┐   │
│   │ Blueprint: video_api         │   │ SocketIO                 │   │
│   │  /api/monitor/start-session  │   │  register_socket_events  │   │
│   │  /api/monitor/upload-chunk   │   │   - join_session         │   │
│   │  /api/monitor/risk-status    │   │   - leave_session        │   │
│   │  /api/monitor/stop-session   │   │   - emits risk_update    │   │
│   └───────────┬──────────────────┘   └────────────▲─────────────┘   │
│               │                                    │                 │
│               ▼                                    │                 │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │ video_ml.py                                                  │  │
│   │                                                              │  │
│   │   analyze_chunk(bytes)                                       │  │
│   │     → _decode_chunk_to_frames (OpenCV VideoCapture)          │  │
│   │     → BaseDetector.score(frames)   [swap me for a real NN]   │  │
│   │         └── HeuristicDetector (default, CPU-only)            │  │
│   │             brightness · motion · skin-tone · face cascade   │  │
│   │                                                              │  │
│   │   SessionRiskTracker                                         │  │
│   │     → EMA smoothing (α=0.4)                                  │  │
│   │     → Escalation after 3 consecutive HIGH chunks             │  │
│   └─────────────┬────────────────────────────────────────────────┘  │
│                 │                                                    │
│                 ▼                                                    │
│   ┌──────────────────────┐      ┌─────────────────────────────┐     │
│   │ alerts.trigger_alert │      │ MongoDB: video_events       │     │
│   │ (existing module)    │      │  session_id, level, reasons │     │
│   │  → email alert       │      │  (joins the reports flow)   │     │
│   └──────────────────────┘      └─────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data flow per chunk

1. Browser records 1.5 s of video → `MediaRecorder.ondataavailable` fires
2. `fetch('/api/monitor/upload-chunk', { body: FormData })` posts the blob
3. Server writes chunk to a temp file, `cv2.VideoCapture` decodes up to 5 frames
4. `HeuristicDetector.score()` returns `{ risk_score, threat_type, confidence, reasons }`
5. `SessionRiskTracker.update()` applies EMA and checks escalation
6. Result is persisted to `video_events` collection
7. `socketio.emit('risk_update', …, room='monitor:<sid>')` pushes to the client
8. If `escalate=true`, `alerts.trigger_alert()` fires (existing email pipeline)
9. Browser receives `risk_update` → updates pill, bar, alerts feed

Why POST chunks instead of streaming over the WebSocket? Simpler backpressure,
cleaner error semantics, reuses Flask's existing file-upload plumbing, and keeps
the WebSocket channel unidirectional (server → client) which makes reasoning
about ordering much easier.

---

## 3. REST API Reference

All endpoints require an authenticated session (reuses `session["user"]` from
your existing `auth.py`). Unauthenticated calls return **401**.

### POST `/api/monitor/start-session`

Create a new monitoring session.

**Request**
```json
{ "source": "camera", "child_id": "user3" }
```
`source` ∈ `"camera" | "screen" | "both"` (optional, default `camera`).
`child_id` optional — links the session to a child account for the reports flow.

**Response**
```json
{
  "success": true,
  "session_id": "8f2c1a9e4b7d4a3aab5d2f7e1c6a9b30",
  "ws_room": "monitor:8f2c1a9e4b7d4a3aab5d2f7e1c6a9b30"
}
```

### POST `/api/monitor/upload-chunk`

Upload one MediaRecorder chunk.

**Request** — `multipart/form-data`
| field | type | required | notes |
|---|---|---|---|
| `session_id` | text | yes | from `start-session` |
| `source` | text | no | `camera` \| `screen` |
| `chunk` | file | yes | webm/mp4 blob |

**Response**
```json
{
  "success": true,
  "instant_score": 42,
  "smoothed_score": 31,
  "level": "MEDIUM",
  "threat_type": "abnormal",
  "confidence": 0.74,
  "escalate": false,
  "reasons": ["very_dark_frames", "low_motion", "source:camera", "detector:heuristic_v1"],
  "frames": 4,
  "processing_ms": 38
}
```

**Errors**
| HTTP | `error` | meaning |
|---|---|---|
| 400 | `missing_session_id` / `missing_chunk` / `empty_chunk` | malformed request |
| 401 | `not_logged_in` | no session cookie |
| 403 | `forbidden` | session belongs to another user |
| 404 | `unknown_session` | bad `session_id` |
| 409 | `session_closed` | already stopped |

### GET `/api/monitor/risk-status/<session_id>`

Poll the latest state for a session (useful for recovery or for tests).

**Response**
```json
{
  "success": true,
  "session_id": "8f2c1a9e…",
  "active": true,
  "started_at": "2026-04-17T09:12:04.231000+00:00",
  "chunks_received": 17,
  "source": "camera",
  "last": {
    "instant_score": 22, "smoothed_score": 18,
    "level": "LOW", "threat_type": "none",
    "confidence": 0.58, "escalate": false, "reasons": [...],
    "frames": 5, "processing_ms": 31
  }
}
```

### POST `/api/monitor/stop-session/<session_id>`

Close the session. Idempotent-ish (second call returns `session_closed`).

**Response**
```json
{ "success": true, "session_id": "...", "chunks_received": 42 }
```

### GET `/api/monitor/my-sessions`

List the caller's sessions (active + past). Handy on page reload.

---

## 4. WebSocket Protocol

Transport: **Socket.IO v4** (over the same Flask process; default path `/socket.io`).

### Client → Server

| Event | Payload | Purpose |
|---|---|---|
| `connect`        | —                              | Auth gate (401 if not logged in) |
| `join_session`   | `{ session_id }`               | Subscribe to this session's room |
| `leave_session`  | `{ session_id }`               | Unsubscribe |
| `ping_session`   | `{ session_id }`               | Ask server to re-send last state |

### Server → Client

| Event | Payload | When |
|---|---|---|
| `connected`    | `{ ok: true }`                                | After successful auth |
| `joined`       | `{ session_id, last }`                        | After `join_session` |
| `risk_update`  | full risk object + `session_id`               | After every processed chunk |
| `alert`        | `{ session_id, level, threat_type, message }` | When `escalate=true` |
| `error`        | `{ error }`                                   | Auth / validation failures |

---

## 5. Integrating a real ML model

Swap the detector without touching any other file:

```python
# your_custom_detector.py
from video_ml import BaseDetector, set_detector
import torch

class MyNSFWDetector(BaseDetector):
    name = "nsfw_resnet_v2"
    def __init__(self):
        self.model = torch.load("nsfw.pt").eval()
    def score(self, frames):
        if not frames: return {"risk_score": 5, "threat_type": "none",
                               "confidence": 0.2, "reasons": ["no_frames"]}
        # ... run inference, return the same dict shape
        return { "risk_score": 0..100, "threat_type": "explicit|grooming|...",
                 "confidence": 0.0..1.0, "reasons": [...] }

# Call once at app startup, e.g. at the bottom of app.py:
from your_custom_detector import MyNSFWDetector
set_detector(MyNSFWDetector())
```

The REST/WS contract stays identical — the UI will light up the moment your
model starts returning higher scores.

### Optional hooks mentioned in the code
* **Face recognition**: `HeuristicDetector` already runs a Haar cascade and tags
  `single_face_detected` / `multiple_faces_detected`. Plug `face_recognition` or
  `dlib` into the marked stub block to flip `threat_type` → `"unknown_face"`.
* **Toxicity (text/audio)**: out of scope for this integration, but
  `MediaRecorder` can be configured to include audio — route the audio track
  into Whisper for transcription, then into your existing
  `sentiment.py` / `grooming_detector.py`.

---

## 6. Run Instructions

### Prerequisites
* Python 3.9+
* MongoDB running on `localhost:27017` (matches existing `db.py`)
* Modern Chrome / Firefox / Edge (Safari `getDisplayMedia` works on macOS 13+)

### Install

```bash
cd fixed-project
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

pip install -r requirements.txt
```

If the OpenCV install is slow on Raspberry-Pi-class hardware, use
`opencv-python-headless` directly (it's what we pin) — no GUI deps.

### Run

```bash
cd backend
python app.py
```

You should see:
```
 * Running on http://127.0.0.1:5000
 * Serving Flask-SocketIO app 'app'
```

### Use

1. Open `http://127.0.0.1:5000` → register → log in
2. In the sidebar click **🎥 Live Monitor**
3. Pick Camera or Screen → **Start recording**
4. Grant the browser permission (camera / screen-share prompt)
5. Watch the risk bar update every ~1.5 s and alerts stream into the feed
6. Press **Stop** to end — the session is closed and the tracks released

### Dev tips
* `debug=True` means Flask's reloader will restart the server on file save —
  the `allow_unsafe_werkzeug=True` flag is required by Flask-SocketIO 5.x.
* Chunks land in a tempfile and are deleted after decoding; nothing persists
  to disk unless you add it explicitly.
* If you see `Socket.IO client not loaded` in the alerts feed, check that the
  `socket.io.min.js` CDN URL in `base.html` isn't blocked.

### Scaling past a single worker
`_SESSIONS` in `video_monitor.py` is in-process. If you move to multiple
gunicorn workers, replace it with Redis-backed storage *and* switch SocketIO's
`message_queue` parameter in `app.py` to your Redis URL. Both changes are
one-liners.

---

## 7. Security & Safety notes

* **Auth**: every REST endpoint and the WS `connect` gate check
  `session.get("user")`. Cross-user session access returns 403.
* **Media retention**: chunks are deleted after decoding. Only numeric scores
  and reason tags hit MongoDB (`video_events`). No raw video is ever
  persisted by this code.
* **CORS**: `SocketIO(cors_allowed_origins="*")` is dev-friendly; for
  production change to your actual origin.
* **Rate limiting**: not added. If you expose this publicly, put a reverse
  proxy (Nginx/Cloudflare) in front and rate-limit `/api/monitor/upload-chunk`
  per user — MediaRecorder will happily send a chunk every 1.5 s indefinitely.
* **Existing credential leak** (⚠️ NOT part of this integration but found during
  review): `backend/alerts.py` lines 7–8 contain a real Gmail address and an
  app password in plain text. Please rotate that password immediately and move
  both values to environment variables before deploying anywhere public.

---

## 8. Verification checklist

After applying the changes:

- [ ] `python -m py_compile backend/*.py` passes
- [ ] `python backend/app.py` starts without errors
- [ ] Logging in and opening `/dashboard` shows the **🎥 Live Monitor** sidebar item
- [ ] Clicking **Start recording** opens the browser permission prompt
- [ ] Within ~2 s, the risk bar starts moving and the status pill updates
- [ ] Browser DevTools → Network → WS shows `socket.io` open and receiving
      `risk_update` events
- [ ] MongoDB shows growing `video_events` collection:
      `use guardian_link; db.video_events.find().limit(3).pretty()`
- [ ] Pointing the camera at a dark area for several seconds pushes the level
      to MEDIUM / HIGH and eventually fires an `alert` event (and an email if
      `EMAIL_ALERTS=True` in `alerts.py`).
