/*  monitor.js  –  Guardian Link
 *  Screen / camera recording with precise OCR harmful-text detection.
 *  Works at any laptop/desktop resolution — adaptive, not fixed.
 */
(function () {
  "use strict";

  // ── Harmful pattern rules ──────────────────────────────────────────
  const RULES = [
    { re:/send\s+me\s+a?\s*(photo|pic|picture|image|nude|nudes)/i,          label:"Photo request",     level:"HIGH",   stage:"escalation", score:0.95 },
    { re:/send\s+(pic|photo|nude)s?\b/i,                                      label:"Photo request",     level:"HIGH",   stage:"escalation", score:0.95 },
    { re:/video\s+call\s+me/i,                                                label:"Video call demand", level:"HIGH",   stage:"escalation", score:0.90 },
    { re:/meet\s+me\s+(alone|tonight|secretly|after\s+school)/i,              label:"Secret meetup",     level:"HIGH",   stage:"escalation", score:0.90 },
    { re:/come\s+alone\b/i,                                                   label:"Isolation demand",  level:"HIGH",   stage:"escalation", score:0.88 },
    { re:/don.?t\s+tell\s+(anyone|your\s+parents|your\s+mum|your\s+mom)/i,   label:"Secrecy demand",    level:"HIGH",   stage:"secrecy",    score:0.85 },
    { re:/our\s+secret|keep\s+this\s+secret|this\s+is\s+between\s+us/i,      label:"Secrecy pact",      level:"HIGH",   stage:"secrecy",    score:0.85 },
    { re:/delete\s+this\s+(chat|message|conversation)/i,                      label:"Evidence deletion", level:"HIGH",   stage:"secrecy",    score:0.80 },
    { re:/are\s+you\s+alone(\s+right\s+now)?/i,                               label:"Alone check",       level:"MEDIUM", stage:"isolation",  score:0.65 },
    { re:/where\s+are\s+your\s+parents/i,                                     label:"Parent location",   level:"MEDIUM", stage:"isolation",  score:0.65 },
    { re:/is\s+anyone\s+(home|with\s+you)/i,                                  label:"Home alone check",  level:"MEDIUM", stage:"isolation",  score:0.60 },
    { re:/home\s+alone\b/i,                                                   label:"Home alone",        level:"MEDIUM", stage:"isolation",  score:0.60 },
    { re:/when\s+no\s+one\s+is\s+around/i,                                   label:"Alone timing",      level:"MEDIUM", stage:"isolation",  score:0.58 },
    { re:/only\s+talk\s+to\s+me\b/i,                                         label:"Control tactic",    level:"MEDIUM", stage:"control",    score:0.62 },
    { re:/don.?t\s+talk\s+to\s+(others|anyone\s+else)/i,                     label:"Control tactic",    level:"MEDIUM", stage:"control",    score:0.62 },
    { re:/you\s+can\s+trust\s+me|trust\s+me\b/i,                             label:"Trust manipulation",level:"LOW",    stage:"trust",      score:0.35 },
    { re:/i\s+care\s+about\s+you|i\s+understand\s+you\s+better/i,            label:"Trust manipulation",level:"LOW",    stage:"trust",      score:0.35 },
    { re:/only\s+i\s+understand\s+you/i,                                      label:"Trust manipulation",level:"LOW",    stage:"trust",      score:0.38 },
  ];

  const SAFE_PATTERNS = [
    /\bhomework\b/i, /\bschool\b/i, /\bclass\b/i, /\bstudy\b/i,
    /\bfriend\b/i,   /\bparty\b/i,  /\bgame\b/i,  /\bsports\b/i,
    /\bhello\b|\bhi\b|\bhey\b/i,    /\blol\b|\bhaha\b/i,
    /\bthanks\b|\bthank\s+you\b/i,  /\bsorry\b/i,  /\bplease\b/i,
  ];

  // ── OCR garbage filter ─────────────────────────────────────────────
  // These regexes match common UI chrome, browser toolbar clutter, etc.
  const NOISE_PATTERNS = [
    /^[^a-zA-Z]*$/,                          // no letters at all
    /^[\W\d\s]{0,6}$/,                       // too short / no words
    /https?:\/\//i,                           // URLs
    /^(www\.|http)/i,
    /^\d+[\s:./\-]\d+/,                      // timestamps / coordinates
    /^[A-Z\s]{1,4}$/,                        // single-char or short caps (UI icons)
    /ENG|UTC|GMT|AM|PM/,                     // system tray / clock
    /(\w)\1{3,}/,                            // repeated char spam: "aaaa"
    /[^\x20-\x7E]/,                          // non-printable chars
    /^[|\/\\=_\-~*#@\[\](){}<>^]{2,}/,      // symbol lines
    /search|address bar|enter web/i,         // browser chrome text
    /new tab|newtab/i,
    /^\s*(x|\+|\-|=|>|<|\|)\s*$/,           // single symbol lines
  ];

  // Min meaningful English words in a sentence to be processed
  const MIN_WORDS = 3;

  function isGarbage(text) {
    if (!text || text.trim().length < 6) return true;
    // Must have at least MIN_WORDS alphabetic words
    const words = text.match(/[a-zA-Z]{3,}/g) || [];
    if (words.length < MIN_WORDS) return true;
    // Check noise patterns
    for (const p of NOISE_PATTERNS) if (p.test(text.trim())) return true;
    // Reject if > 25% non-ASCII
    const nonAscii = (text.match(/[^\x20-\x7E]/g) || []).length;
    if (nonAscii / text.length > 0.25) return true;
    return false;
  }

  function classify(sentence) {
    if (isGarbage(sentence)) return null;
    for (const rule of RULES) {
      if (rule.re.test(sentence)) return { ...rule, sentence };
    }
    for (const pat of SAFE_PATTERNS) {
      if (pat.test(sentence)) return { label:"Safe", level:"SAFE", stage:null, score:0.05, sentence };
    }
    return { label:"Neutral", level:"NEUTRAL", stage:null, score:0.0, sentence };
  }

  // ── Dashboard injection ────────────────────────────────────────────
  let _ocrInjected = new Set();

  function injectIntoDashboard(match) {
    if (_ocrInjected.has(match.sentence)) return;
    _ocrInjected.add(match.sentence);

    const synthetic = {
      sender_id:       "screen_ocr",
      display_name:    "Screen (OCR)",
      message:         match.sentence,
      timestamp:       new Date().toISOString(),
      risk_score:      match.score,
      is_risky:        match.score >= 0.5,
      grooming_score:  match.score * 0.9,
      is_grooming:     !!match.stage,
      grooming_stages: match.stage ? { [match.stage]: 1 } : {},
      escalation_flag: match.level === "HIGH",
      dominant_emotion: match.level === "HIGH" ? "fear" : match.level === "MEDIUM" ? "anger" : "neutral",
      emotion_label:   match.level === "HIGH" ? "Fear" : match.level === "MEDIUM" ? "Anger" : "Neutral",
      emotion_color:   match.level === "HIGH" ? "#e67e22" : match.level === "MEDIUM" ? "#e74c3c" : "#7f8c8d",
      emotion_bg:      match.level === "HIGH" ? "rgba(230,126,34,0.15)" : match.level === "MEDIUM" ? "rgba(231,76,60,0.15)" : "rgba(127,140,141,0.15)",
      emotion_risky:   match.level === "HIGH" || match.level === "MEDIUM",
      sentiment_scores:{ fear:0.45, anger:0.30, disgust:0.10, neutral:0.10, joy:0.02, sadness:0.02, surprise:0.01 },
      risk_explanation:`Screen OCR: [${match.label}] — "${match.sentence.slice(0,100)}"`,
    };

    try {
      const all = [synthetic, ...(window._lastDashMsgs || [])];
      if (typeof renderAlerts    === "function") renderAlerts(all);
      if (typeof renderGrooming  === "function") renderGrooming(all);
      if (typeof renderSentiment === "function") renderSentiment(all);
    } catch (e) { /* non-fatal */ }
  }

  // ── State ──────────────────────────────────────────────────────────
  const S = {
    stream:null, recorder:null, socket:null, sessionId:null,
    source:"screen", chunkMs:2000, running:false,
    ocrWorker:null, ocrReady:false, ocrBusy:false,
    frameCanvas:null, frameCtx:null, frameInterval:null,
    seenSentences: new Set(),
  };

  const $ = id => document.getElementById(id);

  // ── UI ─────────────────────────────────────────────────────────────
  function setStatus(text, kind) {
    const el = $("gl-monitor-status");
    if (!el) return;
    el.textContent = text;
    el.className = "gl-monitor-status" + (kind ? " "+kind : "");
  }

  function setLevel(level, smoothed, instant) {
    const pill = $("gl-risk-pill");
    if (pill) { pill.classList.remove("low","medium","high"); pill.classList.add((level||"LOW").toLowerCase()); }
    if ($("gl-risk-level"))   $("gl-risk-level").textContent   = level||"LOW";
    const fill = $("gl-risk-bar-fill");
    if (fill) fill.style.width = Math.max(0,Math.min(100,smoothed||0))+"%";
    if ($("gl-risk-smoothed")) $("gl-risk-smoothed").textContent = smoothed??0;
    if ($("gl-risk-instant"))  $("gl-risk-instant").textContent  = instant??0;
  }

  function pushAlert(msg, kind, isOcr) {
    const list = $("gl-alerts-list");
    if (!list) return;
    const item = document.createElement("div");
    item.className = `gl-alert-item ${kind||"info"}${isOcr?" gl-ocr-alert":""}`;
    item.innerHTML = `<span class="gl-alert-time">${new Date().toLocaleTimeString()}</span>
                      <span class="gl-alert-text">${esc(msg)}</span>`;
    list.prepend(item);
    while (list.children.length > 40) list.removeChild(list.lastChild);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  // ── Sentence log ───────────────────────────────────────────────────
  const _log = [];   // { text, level, label }

  function addToLog(text, level, label) {
    // Don't add exact duplicates consecutively
    if (_log.length && _log[0].text === text) return;
    _log.unshift({ text, level, label });
    if (_log.length > 80) _log.pop();
    renderLog();
  }

  function renderLog() {
    const el = $("gl-sentence-log");
    if (!el) return;
    if (!_log.length) {
      el.innerHTML = '<div class="gl-sentence-empty">No text captured yet.</div>';
      return;
    }
    el.innerHTML = _log.map(r => {
      const cls = r.level==="HIGH"?"gl-sentence-high":r.level==="MEDIUM"?"gl-sentence-medium":
                  r.level==="LOW"?"gl-sentence-low":r.level==="SAFE"?"gl-sentence-safe":"gl-sentence-neutral";
      const badge = (r.level!=="NEUTRAL"&&r.level!=="SAFE")
        ? `<span class="gl-sentence-badge gl-badge-${r.level.toLowerCase()}">${r.level}</span>
           <span class="gl-sentence-label">${esc(r.label)}</span>`
        : r.level==="SAFE" ? `<span class="gl-sentence-badge gl-badge-safe">SAFE</span>` : "";
      return `<div class="gl-sentence ${cls}">${badge}<span class="gl-sentence-text">${esc(r.text)}</span></div>`;
    }).join("");
  }

  // ── Refresh button logic ───────────────────────────────────────────
  function refreshLog() {
    // Re-render the sentence log from buffer
    renderLog();
    // Also reload dashboard data to show injected OCR messages
    if (typeof loadDashboard === "function") loadDashboard();
    setStatus("Log refreshed — " + _log.length + " sentences captured", "ok");
  }

  function showRefreshBtn(show) {
    const btn = $("gl-refresh-btn");
    if (btn) btn.style.display = show ? "inline-flex" : "none";
  }

  // ── OCR init ───────────────────────────────────────────────────────
  async function initOCR() {
    if (S.ocrWorker) return;
    const ocrEl = $("gl-ocr-status");
    if (ocrEl) ocrEl.textContent = "⏳ Loading OCR…";
    if (typeof Tesseract === "undefined") {
      if (ocrEl) ocrEl.textContent = "⚠ OCR library not loaded";
      return;
    }
    try {
      S.ocrWorker = await Tesseract.createWorker("eng", 1, {
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
        corePath:   "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js",
        logger: m => {
          if (m.status === "recognizing text" && ocrEl)
            ocrEl.textContent = `🔍 OCR ${Math.round((m.progress||0)*100)}%`;
        },
      });
      // Whitelist: only recognise standard English characters
      await S.ocrWorker.setParameters({
        tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?'\"()-:;",
        tessedit_pageseg_mode: "6",   // assume uniform block of text
      });
      S.ocrReady = true;
      if (ocrEl) ocrEl.textContent = "✅ OCR ready";
    } catch (e) {
      if (ocrEl) ocrEl.textContent = "⚠ OCR unavailable";
    }
  }

  // ── OCR frame scan ─────────────────────────────────────────────────
  async function runOCR() {
    if (!S.ocrReady || S.ocrBusy || !S.stream) return;
    const video = $("gl-preview");
    if (!video || !video.videoWidth) return;

    S.ocrBusy = true;
    try {
      if (!S.frameCanvas) {
        S.frameCanvas = document.createElement("canvas");
        S.frameCtx    = S.frameCanvas.getContext("2d", { willReadFrequently: true });
      }

      // Adaptive: use actual video dimensions (whatever the laptop/browser captures)
      // Scale down for OCR speed if very large (> 1440px wide)
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = vw > 1440 ? 1440 / vw : 1;
      S.frameCanvas.width  = Math.round(vw * scale);
      S.frameCanvas.height = Math.round(vh * scale);
      S.frameCtx.drawImage(video, 0, 0, S.frameCanvas.width, S.frameCanvas.height);

      const { data } = await S.ocrWorker.recognize(S.frameCanvas);
      const raw = (data.text || "").trim();
      if (!raw) { S.ocrBusy = false; return; }

      // Split by newlines and punctuation into candidate sentences
      const candidates = raw
        .split(/[\n\r.!?;|]+/)
        .map(s => s.replace(/\s+/g," ").trim())
        .filter(s => s.length >= 10);

      const ocrEl = $("gl-ocr-status");
      let goodCount = 0;

      candidates.forEach(sentence => {
        const match = classify(sentence);
        if (!match) return;   // garbage or non-English
        goodCount++;

        if (S.seenSentences.has(sentence)) return;
        S.seenSentences.add(sentence);

        addToLog(sentence, match.level, match.label);

        if (match.level === "HIGH") {
          pushAlert(`🔴 [${match.label}] "${sentence.slice(0,90)}"`, "danger", true);
          injectIntoDashboard(match);
        } else if (match.level === "MEDIUM") {
          pushAlert(`🟡 [${match.label}] "${sentence.slice(0,90)}"`, "warn", true);
          injectIntoDashboard(match);
        } else if (match.level === "LOW") {
          pushAlert(`🔵 [${match.label}] "${sentence.slice(0,90)}"`, "info", true);
          injectIntoDashboard(match);
        }
        // SAFE / NEUTRAL: sentence log only, no push alert
      });

      if (ocrEl) ocrEl.textContent = goodCount > 0
        ? `✅ OCR — ${goodCount} sentences`
        : "🔍 OCR — no English text found";

    } catch (e) {
      /* non-fatal */
    } finally {
      S.ocrBusy = false;
    }
  }

  // ── Stream capture — adaptive resolution ───────────────────────────
  async function acquireStream(source) {
    if (source === "screen") {
      return await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal:10, max:15 }, cursor:"always" },
        audio: false,
      });
    }
    return await navigator.mediaDevices.getUserMedia({
      video: { frameRate: { ideal:10 } },
      audio: false,
    });
  }

  function pickMime() {
    for (const m of ["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm","video/mp4"])
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    return "";
  }

  // ── Session REST ───────────────────────────────────────────────────
  async function startSession() {
    const r = await fetch("/api/monitor/start-session", {
      method:"POST", credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ source: S.source }),
    });
    if (!r.ok) throw new Error("start-session " + r.status);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    return j.session_id;
  }

  async function stopSession(sid) {
    try { await fetch(`/api/monitor/stop-session/${sid}`,{method:"POST",credentials:"same-origin"}); } catch(_){}
  }

  async function uploadChunk(sid, blob, src) {
    if (!blob?.size) return;
    const fd = new FormData();
    fd.append("session_id",sid); fd.append("source",src);
    fd.append("chunk", blob, `chunk_${Date.now()}.webm`);
    try {
      const r = await fetch("/api/monitor/upload-chunk",{method:"POST",credentials:"same-origin",body:fd});
      if (!r.ok) pushAlert(`Upload error (${r.status})`,"warn");
    } catch(_){ pushAlert("Network error uploading chunk","warn"); }
  }

  // ── WebSocket ──────────────────────────────────────────────────────
  function connectSocket(sid) {
    if (typeof io !== "function") return null;
    const s = io({transports:["websocket","polling"]});
    s.on("connect",     () => s.emit("join_session",{session_id:sid}));
    s.on("joined",      d  => { setStatus("Live — scanning for harmful text…","ok"); if(d?.last) setLevel(d.last.level,d.last.smoothed_score,d.last.instant_score); });
    s.on("risk_update", p  => { setLevel(p.level,p.smoothed_score,p.instant_score); });
    s.on("alert",       p  => pushAlert(`🚨 ${p.message||p.threat_type}`,"danger"));
    s.on("error",       p  => pushAlert("Socket: "+(p.error||"?"),"warn"));
    s.on("disconnect",  () => { if(S.running) setStatus("Socket disconnected","warn"); });
    return s;
  }

  // ── Start ──────────────────────────────────────────────────────────
  async function start() {
    if (S.running) return;
    const startBtn = $("gl-start-btn");
    if (startBtn) startBtn.disabled = true;
    showRefreshBtn(false);
    setStatus("Requesting screen permission…");
    S.seenSentences.clear();
    _log.length = 0;
    _ocrInjected.clear();
    renderLog();

    try { S.stream = await acquireStream(S.source); }
    catch (e) {
      setStatus("Permission denied — please allow screen capture","error");
      pushAlert("Screen capture denied","warn");
      if (startBtn) startBtn.disabled = false;
      return;
    }

    const video = $("gl-preview");
    if (video) { video.srcObject = S.stream; video.play().catch(()=>{}); }

    try { S.sessionId = await startSession(); }
    catch (e) {
      setStatus("Could not start session — log in first","error");
      stopTracks(); if (startBtn) startBtn.disabled = false; return;
    }

    S.socket = connectSocket(S.sessionId);

    const mime = pickMime();
    try { S.recorder = new MediaRecorder(S.stream, mime?{mimeType:mime}:undefined); }
    catch (e) {
      setStatus("MediaRecorder not supported","error");
      stopTracks(); if (startBtn) startBtn.disabled = false; return;
    }

    S.recorder.ondataavailable = ev => { if(ev.data?.size) uploadChunk(S.sessionId,ev.data,S.source); };
    S.recorder.onstop = () => setStatus("Recording stopped — click Refresh to reload dashboard");
    S.stream.getTracks().forEach(t => { t.onended = () => stop(); });
    S.recorder.start(S.chunkMs);
    S.running = true;

    await initOCR();
    S.frameInterval = setInterval(runOCR, 3000);

    setStatus("▶ Recording — scanning for harmful English text every 3 s","ok");
    if ($("gl-stop-btn"))      $("gl-stop-btn").disabled      = false;
    if ($("gl-toggle-source")) $("gl-toggle-source").disabled = true;
    if (startBtn)              startBtn.disabled              = true;
  }

  // ── Stop ───────────────────────────────────────────────────────────
  function stopTracks() {
    S.stream?.getTracks().forEach(t => { try{t.stop();}catch(_){} });
    S.stream = null;
    const v = $("gl-preview"); if(v) v.srcObject = null;
  }

  async function stop() {
    if (!S.running) return;
    S.running = false;
    clearInterval(S.frameInterval); S.frameInterval = null;
    if (S.recorder?.state !== "inactive") { try{S.recorder.stop();}catch(_){} }
    S.recorder = null;
    stopTracks();
    if (S.sessionId) await stopSession(S.sessionId);
    if (S.socket) {
      try{S.socket.emit("leave_session",{session_id:S.sessionId});}catch(_){}
      try{S.socket.disconnect();}catch(_){}
      S.socket = null;
    }
    S.sessionId = null;
    setStatus(`Stopped — ${_log.length} sentences captured. Click Refresh to update dashboard.`);
    if ($("gl-start-btn"))     $("gl-start-btn").disabled      = false;
    if ($("gl-stop-btn"))      $("gl-stop-btn").disabled        = true;
    if ($("gl-toggle-source")) $("gl-toggle-source").disabled   = false;
    // Show Refresh button
    showRefreshBtn(true);
  }

  function toggleSource(src) {
    if (S.running) return;
    S.source = src === "camera" ? "camera" : "screen";
    const lbl = $("gl-source-label");
    if (lbl) lbl.textContent = S.source === "screen" ? "Screen" : "Camera";
    document.querySelectorAll("[data-gl-source]").forEach(b =>
      b.classList.toggle("active", b.dataset.glSource === S.source));
  }

  window.GLMonitor = { start, stop, toggleSource, refreshLog };

  // Patch loadDashboard to cache messages for OCR injection
  window.addEventListener("load", () => {
    const _orig = window.loadDashboard;
    if (typeof _orig !== "function") return;
    window.loadDashboard = function () {
      return fetch("/api/dashboard")
        .then(r => r.json())
        .then(data => {
          window._lastDashMsgs = data.messages || [];
          updateStats(data);
          renderAlerts(data.messages);
          renderGrooming(data.messages);
          renderReports(data.report, data.messages);
          renderSentiment(data.messages);
        })
        .catch(() => showToast("Could not load data"));
    };
  });

})();
