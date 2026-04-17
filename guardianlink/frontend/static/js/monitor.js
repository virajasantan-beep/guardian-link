/*  monitor.js  –  Guardian Link
 *  Live camera/screen recording + Socket.IO risk feedback.
 *
 *  This file is loaded by base.html after main.js. It does NOT modify any
 *  existing globals; everything is namespaced under window.GLMonitor.
 *
 *  Public surface (called from dashboard.html buttons):
 *      GLMonitor.toggleSource('camera' | 'screen')
 *      GLMonitor.start()
 *      GLMonitor.stop()
 *
 *  Socket.IO client is loaded from CDN in dashboard.html.
 */

(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────────────────
  const state = {
    stream:      null,
    recorder:    null,
    socket:      null,
    sessionId:   null,
    source:      "camera",       // "camera" | "screen"
    chunkMs:     1500,           // slice size
    running:     false,
    lastScore:   0,
    alertsBuf:   [],
  };

  // ── DOM helpers ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  function setStatus(text, kind) {
    const el = $("gl-monitor-status");
    if (!el) return;
    el.textContent = text;
    el.className = "gl-monitor-status " + (kind || "");
  }

  function setLevel(level, smoothed, instant) {
    const pill = $("gl-risk-pill");
    const bar  = $("gl-risk-bar-fill");
    const lvl  = $("gl-risk-level");
    const sv   = $("gl-risk-smoothed");
    const iv   = $("gl-risk-instant");
    if (!pill || !bar) return;

    pill.classList.remove("low", "medium", "high");
    pill.classList.add((level || "LOW").toLowerCase());
    lvl.textContent = level || "LOW";

    const pct = Math.max(0, Math.min(100, smoothed || 0));
    bar.style.width = pct + "%";
    sv.textContent = smoothed ?? 0;
    iv.textContent = instant  ?? 0;
  }

  function pushAlert(msg, kind) {
    const list = $("gl-alerts-list");
    if (!list) return;
    const entry = {
      text: msg,
      kind: kind || "info",
      time: new Date().toLocaleTimeString(),
    };
    state.alertsBuf.unshift(entry);
    if (state.alertsBuf.length > 20) state.alertsBuf.pop();
    list.innerHTML = state.alertsBuf.map(a =>
      `<div class="gl-alert-item ${a.kind}">
         <span class="gl-alert-time">${a.time}</span>
         <span class="gl-alert-text">${escapeHtml(a.text)}</span>
       </div>`
    ).join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }

  // ── Capture ───────────────────────────────────────────────────────────
  async function acquireStream(source) {
    if (source === "screen") {
      return await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
    }
    return await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: 15 },
      audio: false,
    });
  }

  function pickMimeType() {
    const candidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ];
    for (const m of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  }

  // ── Session lifecycle ────────────────────────────────────────────────
  async function startSessionOnServer() {
    const r = await fetch("/api/monitor/start-session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: state.source }),
    });
    if (!r.ok) throw new Error("start-session failed: " + r.status);
    const j = await r.json();
    if (!j.success) throw new Error(j.error || "start-session failed");
    return j.session_id;
  }

  async function stopSessionOnServer(sessionId) {
    try {
      await fetch(`/api/monitor/stop-session/${sessionId}`, {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (e) { /* best-effort */ }
  }

  async function uploadChunk(sessionId, blob, source) {
    if (!blob || !blob.size) return;
    const fd = new FormData();
    fd.append("session_id", sessionId);
    fd.append("source", source);
    fd.append("chunk", blob, `chunk_${Date.now()}.webm`);
    try {
      const r = await fetch("/api/monitor/upload-chunk", {
        method: "POST",
        credentials: "same-origin",
        body: fd,
      });
      if (!r.ok) {
        // Non-fatal: recorder keeps running. Surface to the user.
        const txt = await r.text();
        console.warn("[GLMonitor] upload failed", r.status, txt);
        pushAlert(`Upload failed (${r.status})`, "warn");
      }
      // The REST response also carries the risk result — but we rely on
      // the WebSocket push for UI updates to keep one code path.
    } catch (e) {
      console.warn("[GLMonitor] upload error", e);
      pushAlert("Network error while uploading chunk", "warn");
    }
  }

  // ── WebSocket (Socket.IO) ────────────────────────────────────────────
  function connectSocket(sessionId) {
    if (typeof io !== "function") {
      pushAlert("Socket.IO client not loaded", "warn");
      return null;
    }
    const s = io({ transports: ["websocket", "polling"] });

    s.on("connect", () => {
      s.emit("join_session", { session_id: sessionId });
    });

    s.on("joined", (data) => {
      setStatus("Live — waiting for first risk update…", "ok");
      if (data && data.last) {
        setLevel(data.last.level, data.last.smoothed_score, data.last.instant_score);
      }
    });

    s.on("risk_update", (payload) => {
      state.lastScore = payload.smoothed_score || 0;
      setLevel(payload.level, payload.smoothed_score, payload.instant_score);
      if (Array.isArray(payload.reasons) && payload.reasons.length) {
        const interesting = payload.reasons.filter(r =>
          !r.startsWith("source:") && !r.startsWith("detector:"));
        if (interesting.length) {
          pushAlert(
            `${payload.level}: ${interesting.join(", ")} ` +
            `(score ${payload.smoothed_score}, ${payload.threat_type})`,
            payload.level === "HIGH" ? "danger" :
              payload.level === "MEDIUM" ? "warn" : "info"
          );
        }
      }
    });

    s.on("alert", (payload) => {
      pushAlert(
        `🚨 ESCALATION — ${payload.message || payload.threat_type}`,
        "danger"
      );
    });

    s.on("error", (payload) => {
      pushAlert("Socket error: " + (payload.error || "unknown"), "warn");
    });

    s.on("disconnect", () => {
      if (state.running) setStatus("Socket disconnected", "warn");
    });

    return s;
  }

  // ── Public: start / stop / toggle ────────────────────────────────────
  async function start() {
    if (state.running) return;
    const btn = $("gl-start-btn");
    if (btn) btn.disabled = true;
    setStatus("Requesting permission…");

    try {
      state.stream = await acquireStream(state.source);
    } catch (e) {
      setStatus("Permission denied or device unavailable", "error");
      pushAlert("Capture permission denied", "warn");
      if (btn) btn.disabled = false;
      return;
    }

    // Show preview
    const video = $("gl-preview");
    if (video) {
      video.srcObject = state.stream;
      video.play().catch(() => {});
    }

    try {
      state.sessionId = await startSessionOnServer();
    } catch (e) {
      setStatus("Could not start session (are you logged in?)", "error");
      stopTracks();
      if (btn) btn.disabled = false;
      return;
    }

    state.socket = connectSocket(state.sessionId);

    const mimeType = pickMimeType();
    try {
      state.recorder = new MediaRecorder(
        state.stream,
        mimeType ? { mimeType } : undefined
      );
    } catch (e) {
      setStatus("MediaRecorder not supported in this browser", "error");
      stopTracks();
      if (btn) btn.disabled = false;
      return;
    }

    state.recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) {
        uploadChunk(state.sessionId, ev.data, state.source);
      }
    };
    state.recorder.onerror = (ev) => {
      console.error("[GLMonitor] recorder error", ev);
      pushAlert("Recorder error", "warn");
    };
    state.recorder.onstop = () => {
      setStatus("Stopped", "");
    };

    // Stop if the user ends screen-share from the browser UI.
    state.stream.getTracks().forEach(t => {
      t.onended = () => stop();
    });

    state.recorder.start(state.chunkMs);
    state.running = true;
    setStatus(`Recording (${state.source}) — chunks every ${state.chunkMs}ms`, "ok");

    $("gl-stop-btn") && ($("gl-stop-btn").disabled = false);
    if (btn) btn.disabled = true;
    const tgl = $("gl-toggle-source");
    if (tgl) tgl.disabled = true;
  }

  function stopTracks() {
    if (state.stream) {
      state.stream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      state.stream = null;
    }
    const video = $("gl-preview");
    if (video) { video.srcObject = null; }
  }

  async function stop() {
    if (!state.running) return;
    state.running = false;

    if (state.recorder && state.recorder.state !== "inactive") {
      try { state.recorder.stop(); } catch (e) {}
    }
    state.recorder = null;

    stopTracks();

    if (state.sessionId) {
      await stopSessionOnServer(state.sessionId);
    }

    if (state.socket) {
      try { state.socket.emit("leave_session", { session_id: state.sessionId }); } catch (e) {}
      try { state.socket.disconnect(); } catch (e) {}
      state.socket = null;
    }

    state.sessionId = null;
    setStatus("Stopped", "");
    const startBtn = $("gl-start-btn");
    const stopBtn  = $("gl-stop-btn");
    const tgl      = $("gl-toggle-source");
    if (startBtn) startBtn.disabled = false;
    if (stopBtn)  stopBtn.disabled  = true;
    if (tgl)      tgl.disabled      = false;
  }

  function toggleSource(src) {
    if (state.running) return;        // only switch while idle
    state.source = (src === "screen") ? "screen" : "camera";
    const lbl = $("gl-source-label");
    if (lbl) lbl.textContent = state.source === "screen" ? "Screen" : "Camera";
    const radios = document.querySelectorAll("[data-gl-source]");
    radios.forEach(r => {
      r.classList.toggle("active", r.dataset.glSource === state.source);
    });
  }

  // ── Expose ──────────────────────────────────────────────────────────
  window.GLMonitor = { start, stop, toggleSource };
})();
