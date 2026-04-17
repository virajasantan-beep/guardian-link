/*  monitor.js  –  Guardian Link
 *  Live screen/camera recording with:
 *  - Full 1920×1080 screen capture
 *  - Tesseract.js OCR — every sentence extracted from screen
 *  - Harmful sentence detection (grooming keyword matching)
 *  - Real-time alerts for harmful content found on-screen
 *  - Socket.IO risk feedback
 *
 *  Namespace: window.GLMonitor
 */

(function () {
  "use strict";

  // ── Harmful patterns for on-screen OCR detection ──────────────────
  const HARMFUL_PATTERNS = [
    // Escalation
    { re: /send\s+me\s+a?\s*(photo|pic|picture|image|nude)/i,  label: "Photo request",    level: "HIGH"   },
    { re: /video\s+call\s+me/i,                                label: "Video call demand", level: "HIGH"   },
    { re: /meet\s+me\s+(alone|tonight|secretly)/i,             label: "Secret meetup",     level: "HIGH"   },
    { re: /come\s+alone/i,                                     label: "Isolation request", level: "HIGH"   },
    // Secrecy
    { re: /don.?t\s+tell\s+(anyone|your\s+parents)/i,          label: "Secrecy demand",    level: "HIGH"   },
    { re: /our\s+secret|keep\s+this\s+secret/i,                label: "Secrecy pact",      level: "HIGH"   },
    { re: /delete\s+this\s+(chat|message)/i,                   label: "Evidence deletion", level: "HIGH"   },
    // Isolation
    { re: /are\s+you\s+alone|where\s+are\s+your\s+parents/i,  label: "Isolation check",   level: "MEDIUM" },
    { re: /is\s+anyone\s+(home|with\s+you)/i,                  label: "Isolation check",   level: "MEDIUM" },
    { re: /home\s+alone/i,                                     label: "Alone check",       level: "MEDIUM" },
    // Control
    { re: /only\s+talk\s+to\s+me/i,                            label: "Control tactic",    level: "MEDIUM" },
    { re: /don.?t\s+talk\s+to\s+(others|anyone\s+else)/i,     label: "Control tactic",    level: "MEDIUM" },
    // Trust-building
    { re: /trust\s+me|i\s+care\s+about\s+you/i,               label: "Trust manipulation",level: "LOW"    },
    { re: /i\s+understand\s+you\s+better/i,                    label: "Trust manipulation",level: "LOW"    },
  ];

  // ── State ──────────────────────────────────────────────────────────
  const state = {
    stream:         null,
    recorder:       null,
    socket:         null,
    sessionId:      null,
    source:         "screen",   // default to screen for this monitor
    chunkMs:        2000,
    running:        false,
    lastScore:      0,
    alertsBuf:      [],
    ocrWorker:      null,
    ocrReady:       false,
    ocrBusy:        false,
    frameCanvas:    null,
    frameCtx:       null,
    frameInterval:  null,
    detectedSentences: [],
  };

  const $ = id => document.getElementById(id);

  // ── Status + level UI ─────────────────────────────────────────────
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
    if (lvl) lvl.textContent = level || "LOW";
    const pct = Math.max(0, Math.min(100, smoothed || 0));
    bar.style.width = pct + "%";
    if (sv) sv.textContent = smoothed ?? 0;
    if (iv) iv.textContent = instant  ?? 0;
  }

  // ── Alert feed ────────────────────────────────────────────────────
  function pushAlert(msg, kind, isOcr) {
    const list = $("gl-alerts-list");
    if (!list) return;
    state.alertsBuf.unshift({
      text: msg, kind: kind || "info",
      time: new Date().toLocaleTimeString(),
      isOcr: !!isOcr,
    });
    if (state.alertsBuf.length > 30) state.alertsBuf.pop();
    renderAlertFeed();
  }

  function renderAlertFeed() {
    const list = $("gl-alerts-list");
    if (!list) return;
    list.innerHTML = state.alertsBuf.map(a => `
      <div class="gl-alert-item ${a.kind} ${a.isOcr ? "gl-ocr-alert" : ""}">
        <span class="gl-alert-time">${a.time}</span>
        <span class="gl-alert-text">${escHtml(a.text)}</span>
      </div>`).join("");
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  // ── OCR: Tesseract.js ─────────────────────────────────────────────
  async function initOCR() {
    if (state.ocrWorker) return;
    const ocrStatus = $("gl-ocr-status");
    if (ocrStatus) ocrStatus.textContent = "⏳ Loading OCR engine…";

    try {
      // Load Tesseract from CDN (loaded in base.html)
      if (typeof Tesseract === "undefined") {
        if (ocrStatus) ocrStatus.textContent = "⚠ OCR not loaded";
        return;
      }
      state.ocrWorker = await Tesseract.createWorker("eng", 1, {
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
        corePath:   "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js",
        logger: m => {
          if (m.status === "recognizing text" && ocrStatus) {
            ocrStatus.textContent = `🔍 OCR: ${Math.round((m.progress||0)*100)}%`;
          }
        },
      });
      state.ocrReady = true;
      if (ocrStatus) ocrStatus.textContent = "✅ OCR ready";
    } catch (e) {
      console.warn("[OCR] init failed:", e);
      if (ocrStatus) ocrStatus.textContent = "⚠ OCR unavailable";
    }
  }

  // Capture one frame from the live stream and run OCR on it
  async function runOCRFrame() {
    if (!state.ocrReady || state.ocrBusy || !state.stream) return;
    const video = $("gl-preview");
    if (!video || !video.videoWidth) return;

    state.ocrBusy = true;
    try {
      // Draw current video frame to offscreen canvas at full resolution
      if (!state.frameCanvas) {
        state.frameCanvas = document.createElement("canvas");
        state.frameCtx    = state.frameCanvas.getContext("2d");
      }
      // Use actual video resolution (up to 1920×1080)
      state.frameCanvas.width  = Math.min(video.videoWidth,  1920);
      state.frameCanvas.height = Math.min(video.videoHeight, 1080);
      state.frameCtx.drawImage(video, 0, 0,
        state.frameCanvas.width, state.frameCanvas.height);

      const { data } = await state.ocrWorker.recognize(state.frameCanvas);
      const rawText = data.text || "";

      // Split into sentences and lines, filter empties
      const sentences = rawText
        .split(/[\n.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 8);  // skip very short fragments

      // Update sentence log
      _updateSentenceLog(sentences, rawText);

      // Scan each sentence for harmful patterns
      _scanForHarm(sentences);

      const ocrStatus = $("gl-ocr-status");
      if (ocrStatus && sentences.length > 0) {
        ocrStatus.textContent = `✅ OCR: ${sentences.length} sentences read`;
      }
    } catch (e) {
      console.warn("[OCR] frame error:", e);
    } finally {
      state.ocrBusy = false;
    }
  }

  function _updateSentenceLog(sentences, rawText) {
    const el = $("gl-sentence-log");
    if (!el) return;

    // Keep last 40 unique sentences
    sentences.forEach(s => {
      if (!state.detectedSentences.includes(s)) {
        state.detectedSentences.unshift(s);
      }
    });
    if (state.detectedSentences.length > 40) {
      state.detectedSentences = state.detectedSentences.slice(0, 40);
    }

    if (!state.detectedSentences.length) {
      el.innerHTML = '<div class="gl-sentence-empty">No text detected on screen yet…</div>';
      return;
    }

    el.innerHTML = state.detectedSentences.map(s => {
      // Check if this sentence is harmful
      const match = HARMFUL_PATTERNS.find(p => p.re.test(s));
      if (match) {
        return `<div class="gl-sentence gl-sentence-${match.level.toLowerCase()}">
          <span class="gl-sentence-badge gl-badge-${match.level.toLowerCase()}">${match.level}</span>
          <span class="gl-sentence-label">${escHtml(match.label)}</span>
          <span class="gl-sentence-text">"${escHtml(s)}"</span>
        </div>`;
      }
      return `<div class="gl-sentence">
        <span class="gl-sentence-text">${escHtml(s)}</span>
      </div>`;
    }).join("");
  }

  function _scanForHarm(sentences) {
    sentences.forEach(s => {
      HARMFUL_PATTERNS.forEach(p => {
        if (p.re.test(s)) {
          const short = s.length > 60 ? s.slice(0, 60) + "…" : s;
          pushAlert(
            `👁 Screen: [${p.label}] "${short}"`,
            p.level === "HIGH" ? "danger" : p.level === "MEDIUM" ? "warn" : "info",
            true
          );
        }
      });
    });
  }

  // ── Stream acquisition — 1920×1080 ───────────────────────────────
  async function acquireStream(source) {
    if (source === "screen") {
      return await navigator.mediaDevices.getDisplayMedia({
        video: {
          width:     { ideal: 1920, max: 1920 },
          height:    { ideal: 1080, max: 1080 },
          frameRate: { ideal: 15,  max: 30  },
          cursor:    "always",
        },
        audio: false,
        preferCurrentTab: false,   // capture full window, not just the tab
      });
    }
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: 15 },
      audio: false,
    });
  }

  function pickMimeType() {
    for (const m of [
      "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"
    ]) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  }

  // ── Session REST ───────────────────────────────────────────────────
  async function startSessionOnServer() {
    const r = await fetch("/api/monitor/start-session", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: state.source }),
    });
    if (!r.ok) throw new Error("start-session " + r.status);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    return j.session_id;
  }

  async function stopSessionOnServer(sid) {
    try {
      await fetch(`/api/monitor/stop-session/${sid}`,
        { method: "POST", credentials: "same-origin" });
    } catch (_) {}
  }

  async function uploadChunk(sid, blob, src) {
    if (!blob || !blob.size) return;
    const fd = new FormData();
    fd.append("session_id", sid);
    fd.append("source", src);
    fd.append("chunk", blob, `chunk_${Date.now()}.webm`);
    try {
      const r = await fetch("/api/monitor/upload-chunk",
        { method: "POST", credentials: "same-origin", body: fd });
      if (!r.ok) pushAlert(`Upload failed (${r.status})`, "warn");
    } catch (e) {
      pushAlert("Network error uploading chunk", "warn");
    }
  }

  // ── WebSocket ─────────────────────────────────────────────────────
  function connectSocket(sid) {
    if (typeof io !== "function") return null;
    const s = io({ transports: ["websocket", "polling"] });
    s.on("connect",     ()   => s.emit("join_session", { session_id: sid }));
    s.on("joined",      d    => { setStatus("Live — monitoring screen…", "ok");
                                   if (d?.last) setLevel(d.last.level, d.last.smoothed_score, d.last.instant_score); });
    s.on("risk_update", p    => {
      state.lastScore = p.smoothed_score || 0;
      setLevel(p.level, p.smoothed_score, p.instant_score);
      const tags = (p.reasons || []).filter(r => !r.startsWith("source:") && !r.startsWith("detector:"));
      if (tags.length) pushAlert(`${p.level}: ${tags.join(", ")} (score ${p.smoothed_score})`,
        p.level==="HIGH"?"danger":p.level==="MEDIUM"?"warn":"info");
    });
    s.on("alert",       p    => pushAlert(`🚨 ESCALATION — ${p.message || p.threat_type}`, "danger"));
    s.on("error",       p    => pushAlert("Socket: " + (p.error||"unknown"), "warn"));
    s.on("disconnect",  ()   => { if (state.running) setStatus("Socket disconnected", "warn"); });
    return s;
  }

  // ── Start ─────────────────────────────────────────────────────────
  async function start() {
    if (state.running) return;
    const btn = $("gl-start-btn");
    if (btn) btn.disabled = true;
    setStatus("Requesting screen permission…");

    try { state.stream = await acquireStream(state.source); }
    catch (e) {
      setStatus("Permission denied or cancelled", "error");
      pushAlert("Screen capture permission denied", "warn");
      if (btn) btn.disabled = false;
      return;
    }

    // Show preview
    const video = $("gl-preview");
    if (video) { video.srcObject = state.stream; video.play().catch(()=>{}); }

    // Show resolution
    video?.addEventListener("loadedmetadata", () => {
      const res = $("gl-resolution");
      if (res) res.textContent = `${video.videoWidth}×${video.videoHeight}`;
    }, { once: true });

    try { state.sessionId = await startSessionOnServer(); }
    catch (e) {
      setStatus("Could not start session (log in first)", "error");
      stopTracks(); if (btn) btn.disabled = false; return;
    }

    state.socket = connectSocket(state.sessionId);

    // MediaRecorder
    const mime = pickMimeType();
    try {
      state.recorder = new MediaRecorder(state.stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      setStatus("MediaRecorder not supported", "error");
      stopTracks(); if (btn) btn.disabled = false; return;
    }

    state.recorder.ondataavailable = ev => {
      if (ev.data?.size) uploadChunk(state.sessionId, ev.data, state.source);
    };
    state.recorder.onstop = () => setStatus("Stopped");
    state.stream.getTracks().forEach(t => { t.onended = () => stop(); });
    state.recorder.start(state.chunkMs);
    state.running = true;

    // OCR frame scan every 4 seconds
    await initOCR();
    state.frameInterval = setInterval(runOCRFrame, 4000);

    setStatus(`Recording screen at up to 1920×1080 — OCR scanning every 4s`, "ok");
    if ($("gl-stop-btn"))   $("gl-stop-btn").disabled  = false;
    if (btn)                btn.disabled = true;
    if ($("gl-toggle-source")) $("gl-toggle-source").disabled = true;
  }

  // ── Stop ──────────────────────────────────────────────────────────
  function stopTracks() {
    state.stream?.getTracks().forEach(t => { try { t.stop(); } catch(_){} });
    state.stream = null;
    const v = $("gl-preview"); if (v) v.srcObject = null;
  }

  async function stop() {
    if (!state.running) return;
    state.running = false;
    clearInterval(state.frameInterval); state.frameInterval = null;

    if (state.recorder?.state !== "inactive") {
      try { state.recorder.stop(); } catch(_) {}
    }
    state.recorder = null;
    stopTracks();
    if (state.sessionId) await stopSessionOnServer(state.sessionId);
    if (state.socket) {
      try { state.socket.emit("leave_session", { session_id: state.sessionId }); } catch(_) {}
      try { state.socket.disconnect(); } catch(_) {}
      state.socket = null;
    }
    state.sessionId = null;
    setStatus("Stopped");
    if ($("gl-start-btn"))     $("gl-start-btn").disabled      = false;
    if ($("gl-stop-btn"))      $("gl-stop-btn").disabled        = true;
    if ($("gl-toggle-source")) $("gl-toggle-source").disabled   = false;
  }

  function toggleSource(src) {
    if (state.running) return;
    state.source = src === "camera" ? "camera" : "screen";
    const lbl = $("gl-source-label");
    if (lbl) lbl.textContent = state.source === "screen" ? "Screen" : "Camera";
    document.querySelectorAll("[data-gl-source]").forEach(b =>
      b.classList.toggle("active", b.dataset.glSource === state.source));
  }

  window.GLMonitor = { start, stop, toggleSource };
})();
