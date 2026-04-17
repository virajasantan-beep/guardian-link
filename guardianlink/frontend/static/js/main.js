// ── AUTH ──
function togglePassword() {
  const p = document.getElementById("password");
  p.type = p.type === "password" ? "text" : "password";
}

function checkStrength(val) {
  const fill = document.getElementById("strength-fill");
  const label = document.getElementById("strength-label");
  if (!fill) return;
  let strength = 0;
  if (val.length >= 6) strength++;
  if (val.length >= 10) strength++;
  if (/[A-Z]/.test(val)) strength++;
  if (/[0-9!@#$%]/.test(val)) strength++;
  const levels = [
    { w: "25%", bg: "#e74c3c", t: "Weak" },
    { w: "50%", bg: "#F39C12", t: "Fair" },
    { w: "75%", bg: "#f1c40f", t: "Strong" },
    { w: "100%", bg: "#1ABC9C", t: "Very strong" }
  ];
  const l = levels[Math.min(strength, 3)];
  fill.style.width = l.w;
  fill.style.background = l.bg;
  label.textContent = l.t;
}

function register() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  if (!email || !password) { showToast("Please fill all fields"); return; }
  fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  })
  .then(r => r.json())
  .then(data => {
    showToast(data.message);
    if (data.success) setTimeout(() => window.location.href = "/", 1500);
  });
}

function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  if (!email || !password) { showToast("Please fill all fields"); return; }
  fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  })
  .then(r => r.json())
  .then(data => {
    if (data.success) {
      window.location.href = "/dashboard";
    } else {
      showToast("Invalid email or password");
    }
  });
}

function logout() {
  fetch("/api/logout").then(() => window.location.href = "/");
}

// ── DASHBOARD ──
function showSection(name) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("section-" + name).classList.add("active");
  event.currentTarget.classList.add("active");
}

let donutChart = null;

function loadDashboard() {
  fetch("/api/dashboard")
    .then(r => r.json())
    .then(data => {
      updateStats(data);
      renderAlerts(data.messages);
      renderGrooming(data.messages);
      renderReports(data.report, data.messages);
    })
    .catch(() => showToast("Could not load data"));
}

function updateStats(data) {
  const total = data.report.total_messages;
  const risky = data.report.risky_messages;
  const pct = total ? ((risky / total) * 100).toFixed(1) : 0;
  const highRisk = data.messages
    ? data.messages.filter(m => m.risk_score >= 0.85).length : 0;

  animateCount("stat-total", total);
  animateCount("stat-risky", risky);
  document.getElementById("stat-percent").textContent = pct + "%";
  animateCount("stat-highrisk", highRisk);
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let start = 0;
  const step = Math.ceil(target / 30);
  const timer = setInterval(() => {
    start = Math.min(start + step, target);
    el.textContent = start;
    if (start >= target) clearInterval(timer);
  }, 40);
}

function renderAlerts(messages) {
  const list = document.getElementById("alerts-list");
  const badge = document.getElementById("alert-badge");
  const countBadge = document.getElementById("alerts-count");
  if (!messages) return;

  const risky = messages.filter(m => m.is_risky || m.risk_score >= 0.4)
    .sort((a, b) => b.risk_score - a.risk_score);

  if (badge) {
    badge.textContent = risky.length;
    badge.style.display = risky.length ? "inline" : "none";
  }
  if (countBadge) {
    countBadge.textContent = risky.length + " active";
    countBadge.style.display = risky.length ? "inline" : "none";
  }

  if (!risky.length) {
    list.innerHTML = '<div class="empty">No risky messages detected</div>';
    return;
  }

  list.innerHTML = risky.map(m => {
    const level = m.risk_score >= 0.85 ? "high" : "medium";
    const time = m.timestamp ? m.timestamp.split("T")[1]?.slice(0, 5) : "";
    return `
      <div class="alert-card ${level}">
        <div class="alert-user">${m.sender_id}</div>
        <div class="alert-message">${m.message}</div>
        <div class="risk-pill ${level}">${m.risk_score.toFixed(2)}</div>
        <div class="alert-time">${time}</div>
      </div>
    `;
  }).join("");
}

function renderGrooming(messages) {
  const list = document.getElementById("grooming-list");
  if (!messages) return;
  const flagged = messages.filter(m => m.is_grooming || m.escalation_flag);
  if (!flagged.length) {
    list.innerHTML = '<div class="empty">No grooming patterns detected</div>';
    return;
  }
  list.innerHTML = flagged.map(m => {
    const pct = Math.round((m.grooming_score || 0) * 100);
    const stages = m.grooming_stages || {};
    const stageBadges = Object.entries(stages)
      .filter(([, v]) => v > 0)
      .map(([k]) => `<span class="stage-badge stage-${k}">${k}</span>`)
      .join("");
    return `
      <div class="grooming-card ${m.escalation_flag ? "escalation" : ""}">
        <div class="grooming-user">${m.sender_id}</div>
        <div class="grooming-score-row">
          <div class="score-ring" style="--pct:${pct * 3.6}deg">
            <span>${pct}%</span>
          </div>
          <div>
            <div style="font-size:13px;color:rgba(255,255,255,0.6)">Grooming score</div>
            ${m.escalation_flag ? '<div class="escalation-chip">Escalation detected</div>' : ""}
          </div>
        </div>
        <div class="stages">${stageBadges}</div>
      </div>
    `;
  }).join("");
}

function renderReports(report, messages) {
  if (!report) return;
  const safe = report.safe_messages || 0;
  const risky = report.risky_messages || 0;
  const ctx = document.getElementById("donut-chart");
  if (ctx) {
    if (donutChart) donutChart.destroy();
    donutChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Safe", "Risky"],
        datasets: [{
          data: [safe, risky],
          backgroundColor: ["#1ABC9C", "#C0392B"],
          borderWidth: 0
        }]
      },
      options: {
        plugins: { legend: { labels: { color: "rgba(255,255,255,0.6)", font: { size: 12 } } } },
        cutout: "70%"
      }
    });
  }
  const tableEl = document.getElementById("user-table");
  if (!tableEl || !messages) return;
  const users = {};
  messages.forEach(m => {
    if (!users[m.sender_id]) users[m.sender_id] = { total: 0, risky: 0 };
    users[m.sender_id].total++;
    if (m.is_risky) users[m.sender_id].risky++;
  });
  const rows = Object.entries(users)
    .map(([id, d]) => ({ id, ...d, ratio: d.risky / d.total }))
    .sort((a, b) => b.ratio - a.ratio);
  tableEl.innerHTML = `
    <table class="user-table">
      <thead>
        <tr>
          <th>User ID</th><th>Total</th><th>Risky</th><th>Ratio</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.id}</td>
            <td>${r.total}</td>
            <td>${r.risky}</td>
            <td>
              <div class="ratio-bar-wrap">
                <div class="ratio-bar" style="width:${Math.round(r.ratio * 100)}%"></div>
              </div>
            </td>
            <td>
              <span class="status-chip ${r.ratio >= 0.6 ? "status-high" : "status-normal"}">
                ${r.ratio >= 0.6 ? "HIGH RISK" : "NORMAL"}
              </span>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function startAutoRefresh() {
  loadDashboard();
  setInterval(loadDashboard, 60000);
}

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
function toggleTheme() {
  const body = document.body;
  const btn = document.getElementById("theme-btn");
  body.classList.toggle("light");
  btn.textContent = body.classList.contains("light") ? "🌙 Dark" : "☀️ Light";
  localStorage.setItem("theme", body.classList.contains("light") ? "light" : "dark");
}

// Apply saved theme on load — default is LIGHT
(function() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark") {
    document.body.classList.remove("light");
  } else {
    // Default: light mode
    document.body.classList.add("light");
    localStorage.setItem("theme", "light");
  }
  const btn = document.getElementById("theme-btn");
  if (btn) btn.textContent = document.body.classList.contains("light") ? "🌙 Dark" : "☀️ Light";
})();
// ── SENTIMENT DATA ────────────────────────────────────────────────────────────

const EMOTION_META = {
  anger:    { icon: "😡", color: "#e74c3c", bg: "rgba(231,76,60,0.15)",   danger: true,  label: "Anger",    tip: "Indicates aggression or coercion tactics" },
  disgust:  { icon: "🤢", color: "#8e44ad", bg: "rgba(142,68,173,0.15)", danger: true,  label: "Disgust",  tip: "May signal boundary-pushing or inappropriate content" },
  fear:     { icon: "😨", color: "#e67e22", bg: "rgba(230,126,34,0.15)", danger: true,  label: "Fear",     tip: "Child may feel threatened or intimidated" },
  sadness:  { icon: "😢", color: "#3498db", bg: "rgba(52,152,219,0.15)", danger: false, label: "Sadness",  tip: "Emotional vulnerability being exploited" },
  surprise: { icon: "😲", color: "#f39c12", bg: "rgba(243,156,18,0.15)", danger: false, label: "Surprise", tip: "Unexpected or alarming content" },
  joy:      { icon: "😊", color: "#1abc9c", bg: "rgba(26,188,156,0.15)", danger: false, label: "Joy",      tip: "Positive tone — monitor context" },
  neutral:  { icon: "😐", color: "#7f8c8d", bg: "rgba(127,140,141,0.15)",danger: false, label: "Neutral",  tip: "No strong emotional signal detected" },
};

// Active filter state
let _sentimentFilter = "all";
let _sentimentMessages = [];
let _sentimentChart = null;

function renderSentiment(messages) {
  if (!messages) return;
  _sentimentMessages = messages.filter(m => m.dominant_emotion);

  const badge = document.getElementById("sentiment-badge");
  const manipCount = _sentimentMessages.filter(m => m.emotion_risky).length;
  if (badge) {
    badge.textContent = manipCount || _sentimentMessages.length;
    badge.style.display = _sentimentMessages.length ? "inline" : "none";
  }

  // Build per-emotion counts — used by legend + filter buttons
  _emotionUserCounts = _countByEmotion(_sentimentMessages, "users");
  _emotionMsgCounts  = _countByEmotion(_sentimentMessages, "msgs");

  _renderSentimentSummary(_sentimentMessages);
  _renderSentimentChart(_sentimentMessages);
  _renderSentimentLegend(_sentimentMessages);
  _renderFilterButtons(_sentimentMessages);
  _renderSentimentCards();
}

// Per-emotion user/message count tracking
let _emotionUserCounts = {};
let _emotionMsgCounts  = {};

function _countByEmotion(msgs, mode) {
  const result = {};
  Object.keys(EMOTION_META).forEach(e => result[e] = mode === "users" ? new Set() : 0);
  msgs.forEach(m => {
    const e = m.dominant_emotion;
    if (!e || result[e] === undefined) return;
    if (mode === "users") result[e].add(m.sender_id || m.display_name || "?");
    else result[e]++;
  });
  if (mode === "users") Object.keys(result).forEach(e => result[e] = result[e].size);
  return result;
}

function _renderSentimentSummary(msgs) {
  const el = document.getElementById("sent-summary-row");
  if (!el) return;
  const total      = msgs.length;
  const manip      = msgs.filter(m => m.emotion_risky).length;
  const dominant   = _dominantEmotion(msgs);
  const meta       = EMOTION_META[dominant] || EMOTION_META.neutral;
  el.innerHTML = `
    <div class="sent-stat-card">
      <div class="sent-stat-value">${total}</div>
      <div class="sent-stat-label">Messages analysed</div>
    </div>
    <div class="sent-stat-card danger">
      <div class="sent-stat-value">${manip}</div>
      <div class="sent-stat-label">Manipulation signals</div>
    </div>
    <div class="sent-stat-card" style="border-color:${meta.color}33;">
      <div class="sent-stat-value" style="color:${meta.color};">${meta.icon} ${meta.label}</div>
      <div class="sent-stat-label">Most common emotion</div>
    </div>
    <div class="sent-stat-card">
      <div class="sent-stat-value" style="color:#F39C12;">${msgs.filter(m=>m.is_risky||m.is_grooming).length}</div>
      <div class="sent-stat-label">Flagged messages</div>
    </div>
  `;
}

function _dominantEmotion(msgs) {
  const counts = {};
  msgs.forEach(m => {
    if (m.dominant_emotion) counts[m.dominant_emotion] = (counts[m.dominant_emotion] || 0) + 1;
  });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] || "neutral";
}

function _renderSentimentLegend(msgs) {
  // Replace static legend HTML with live counts per emotion
  const el = document.getElementById("sent-legend-dynamic");
  if (!el) return;

  // Order: danger emotions first, then others, skip zeros last
  const order = ["anger","fear","disgust","sadness","surprise","joy","neutral"];
  const rows = order.map(emo => {
    const meta      = EMOTION_META[emo];
    const userCount = _emotionUserCounts[emo] || 0;
    const msgCount  = _emotionMsgCounts[emo]  || 0;
    const isDanger  = meta.danger;
    const hasData   = msgCount > 0;

    return `
      <div class="sent-legend-item ${isDanger ? "danger-emotion" : ""} ${hasData ? "" : "sent-legend-empty"}">
        <span class="sent-legend-icon">${meta.icon}</span>
        <div class="sent-legend-body">
          <div class="sent-legend-name" style="color:${meta.color};">${meta.label}</div>
          <div class="sent-legend-desc">${_LEGEND_DESC[emo]}</div>
        </div>
        <div class="sent-legend-counts">
          <div class="sent-legend-count-chip" style="background:${meta.bg};color:${meta.color};">
            <span class="sent-count-num">${userCount}</span>
            <span class="sent-count-lbl">user${userCount !== 1 ? "s" : ""}</span>
          </div>
          <div class="sent-legend-msg-count">${msgCount} msg${msgCount !== 1 ? "s" : ""}</div>
        </div>
      </div>
      ${emo === "disgust" ? '<div class="sent-legend-divider"></div>' : ""}
    `;
  }).join("");
  el.innerHTML = rows;
}

const _LEGEND_DESC = {
  anger:    "Aggression, coercion or threatening tone from the sender",
  fear:     "Child may feel threatened, pressured or afraid to refuse",
  disgust:  "Boundary-pushing, inappropriate content or grooming escalation",
  sadness:  "Emotional vulnerability — may be exploited to build dependency",
  surprise: "Unexpected or alarming content — review in context",
  joy:      "Positive tone — still monitor for trust-building grooming",
  neutral:  "No strong emotional signal detected",
};

function _renderFilterButtons(msgs) {
  // Update filter button labels to include counts
  const totalManip = msgs.filter(m => m.emotion_risky).length;
  const totalFlag  = msgs.filter(m => m.is_risky || m.is_grooming).length;

  const updates = {
    "all":     `All <span class="sent-fbtn-count">${msgs.length}</span>`,
    "risky":   `⚠ Manipulation <span class="sent-fbtn-count">${totalManip}</span>`,
    "danger":  `🚨 Flagged <span class="sent-fbtn-count">${totalFlag}</span>`,
    "anger":   `😡 Anger <span class="sent-fbtn-count">${_emotionMsgCounts.anger||0}</span>`,
    "fear":    `😨 Fear <span class="sent-fbtn-count">${_emotionMsgCounts.fear||0}</span>`,
    "disgust": `🤢 Disgust <span class="sent-fbtn-count">${_emotionMsgCounts.disgust||0}</span>`,
  };

  document.querySelectorAll(".sent-filter-btn").forEach(btn => {
    const f = btn.dataset.filter;
    if (updates[f]) btn.innerHTML = updates[f];
  });
}

function _renderSentimentChart(msgs) {
  const ctx = document.getElementById("sent-dist-chart");
  if (!ctx) return;
  const counts = {};
  Object.keys(EMOTION_META).forEach(e => counts[e] = 0);
  msgs.forEach(m => { if (m.dominant_emotion) counts[m.dominant_emotion] = (counts[m.dominant_emotion]||0)+1; });
  const labels = Object.keys(counts).filter(e => counts[e] > 0);
  const data   = labels.map(e => counts[e]);
  const colors = labels.map(e => EMOTION_META[e]?.color || "#7f8c8d");
  if (_sentimentChart) _sentimentChart.destroy();
  _sentimentChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels.map(e => EMOTION_META[e]?.label || e),
      datasets: [{ data, backgroundColor: colors, borderRadius: 6, borderWidth: 0 }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "rgba(255,255,255,0.5)", font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: "rgba(255,255,255,0.3)", font: { size: 11 }, stepSize: 1 },
             grid: { color: "rgba(255,255,255,0.05)" } }
      },
      responsive: true, maintainAspectRatio: false,
    }
  });
}

function setSentimentFilter(f) {
  _sentimentFilter = f;
  document.querySelectorAll(".sent-filter-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === f);
  });
  _renderSentimentCards();
}

function _renderSentimentCards() {
  const list = document.getElementById("sentiment-list");
  if (!list) return;

  let msgs = [..._sentimentMessages];
  if (_sentimentFilter === "risky")   msgs = msgs.filter(m => m.emotion_risky);
  if (_sentimentFilter === "danger")  msgs = msgs.filter(m => m.is_risky || m.is_grooming);
  if (_sentimentFilter === "anger")   msgs = msgs.filter(m => m.dominant_emotion === "anger");
  if (_sentimentFilter === "fear")    msgs = msgs.filter(m => m.dominant_emotion === "fear");
  if (_sentimentFilter === "disgust") msgs = msgs.filter(m => m.dominant_emotion === "disgust");

  if (!msgs.length) {
    list.innerHTML = '<div class="empty">No messages match this filter.</div>';
    return;
  }

  list.innerHTML = msgs.map(m => {
    const meta  = EMOTION_META[m.dominant_emotion] || EMOTION_META.neutral;
    const scores = m.sentiment_scores || {};
    const allScores = Object.entries(scores).sort((a,b)=>b[1]-a[1]);

    const scoreBars = allScores.map(([emo, sc]) => {
      const em = EMOTION_META[emo] || EMOTION_META.neutral;
      const isDom = emo === m.dominant_emotion;
      return `
        <div class="sent-bar-row">
          <span class="sent-bar-icon">${em.icon}</span>
          <span class="sent-bar-label">${em.label}</span>
          <div class="sent-bar-track">
            <div class="sent-bar-fill ${isDom ? "dominant" : ""}"
                 style="width:${Math.round(sc*100)}%;background:${isDom ? em.color : "rgba(255,255,255,0.15)"};">
            </div>
          </div>
          <span class="sent-bar-pct">${Math.round(sc*100)}%</span>
          ${isDom ? `<span class="sent-dom-chip" style="background:${em.bg};color:${em.color};">dominant</span>` : ""}
        </div>`;
    }).join("");

    const manipBadge = m.emotion_risky
      ? `<span class="sent-manip-badge">⚠ Manipulation signal</span>` : "";

    const groomBadge = m.is_grooming
      ? `<span class="sent-groom-badge">🧠 Grooming flag</span>` : "";

    const escalBadge = m.escalation_flag
      ? `<span class="sent-escal-badge">🔴 Escalation</span>` : "";

    const stageBadges = m.grooming_stages
      ? Object.entries(m.grooming_stages)
          .filter(([,v])=>v>0)
          .map(([k])=>`<span class="stage-badge stage-${k}">${k}</span>`)
          .join("") : "";

    const explanation = m.risk_explanation
      ? `<div class="sent-explanation">
           <span class="sent-explanation-label">🤖 AI Explanation</span>
           ${m.risk_explanation}
         </div>` : "";

    const tipHtml = meta.danger
      ? `<div class="sent-emotion-tip">💡 ${meta.tip}</div>` : "";

    const time = m.timestamp ? m.timestamp.split("T")[1]?.slice(0,5) : "";
    const riskPct = Math.round((m.risk_score || 0) * 100);

    return `
      <div class="sent-card ${meta.danger ? "sent-card-danger" : ""}">

        <!-- Card header -->
        <div class="sent-card-header">
          <div class="sent-card-left">
            <div class="sent-emotion-pill" style="background:${meta.bg};color:${meta.color};">
              ${meta.icon} ${meta.label}
            </div>
            <div class="sent-user">${m.display_name || m.sender_id}</div>
            ${time ? `<div class="sent-time">${time}</div>` : ""}
          </div>
          <div class="sent-card-badges">
            ${manipBadge}${groomBadge}${escalBadge}
            <div class="sent-risk-score" style="color:${riskPct>=50?"#e74c3c":riskPct>=25?"#F39C12":"#1ABC9C"}">
              Risk ${riskPct}%
            </div>
          </div>
        </div>

        <!-- Message text -->
        <div class="sent-message-text">${m.message}</div>

        ${tipHtml}

        <!-- Full emotion bar breakdown -->
        <div class="sent-bars-section">
          <div class="sent-bars-title">Emotion breakdown</div>
          ${scoreBars}
        </div>

        <!-- Grooming stage tags -->
        ${stageBadges ? `<div class="stages" style="margin-top:10px;">${stageBadges}</div>` : ""}

        <!-- AI explanation -->
        ${explanation}
      </div>
    `;
  }).join("");
}


// ── CHILDREN / GUARDIAN PROFILE ───────────────────────────────────────────────

// Users present in mock_data — shown in the sync preview panel
const MOCK_USERS = [
  {id:"emma_w",    defaultName:"Emma Wilson"},
  {id:"liam_j",    defaultName:"Liam Johnson"},
  {id:"sophia_b",  defaultName:"Sophia Brown"},
  {id:"noah_d",    defaultName:"Noah Davis"},
  {id:"olivia_m",  defaultName:"Olivia Martinez"},
  {id:"ethan_g",   defaultName:"Ethan Garcia"},
  {id:"ava_t",     defaultName:"Ava Taylor"},
  {id:"mason_a",   defaultName:"Mason Anderson"},
  {id:"isabella_h",defaultName:"Isabella Harris"},
  {id:"logan_w",   defaultName:"Logan White"},
  {id:"mia_c",     defaultName:"Mia Clark"},
  {id:"lucas_l",   defaultName:"Lucas Lewis"},
  {id:"amelia_k",  defaultName:"Amelia King"},
  {id:"james_s",   defaultName:"James Scott"},
  {id:"harper_n",  defaultName:"Harper Nelson"},
  {id:"aiden_r",   defaultName:"Aiden Roberts"},
  {id:"evelyn_p",  defaultName:"Evelyn Perez"},
  {id:"elijah_y",  defaultName:"Elijah Young"},
  {id:"abby_h",    defaultName:"Abby Hall"},
  {id:"oliver_c",  defaultName:"Oliver Carter"},
  {id:"charlotte_m",defaultName:"Charlotte Mitchell"},
  {id:"henry_b",   defaultName:"Henry Baker"},
  {id:"ella_g",    defaultName:"Ella Gonzalez"},
  {id:"jack_n",    defaultName:"Jack Nelson"},
  {id:"grace_r",   defaultName:"Grace Rivera"},
  {id:"william_c", defaultName:"William Collins"},
  {id:"lily_st",   defaultName:"Lily Stewart"},
  {id:"ben_m",     defaultName:"Ben Morgan"},
  {id:"chloe_r",   defaultName:"Chloe Rogers"},
  {id:"daniel_w",  defaultName:"Daniel Wood"},
];

const EMOTION_ICONS = {
  anger:"😡", disgust:"🤢", fear:"😨",
  sadness:"😢", surprise:"😲", joy:"😊", neutral:"😐"
};
const EMOTION_COLORS = {
  anger:"#e74c3c", disgust:"#8e44ad", fear:"#e67e22",
  sadness:"#3498db", surprise:"#f39c12", joy:"#1abc9c", neutral:"#7f8c8d"
};

function loadChildren() {
  // Populate sync preview once (idempotent)
  _renderSyncPreview();

  fetch("/api/children/with-stats", { credentials: "same-origin" })
    .then(r => r.json())
    .then(data => {
      const list  = document.getElementById("children-list");
      const badge = document.getElementById("children-count-badge");
      if (!list) return;

      const children = data.children || [];
      if (badge) {
        badge.textContent = children.length;
        badge.style.display = children.length ? "inline" : "none";
      }

      if (!children.length) {
        list.innerHTML = `
          <div class="empty" style="padding:32px;">
            No children linked yet.<br>
            <span style="font-size:12px;opacity:0.6;">
              Use the form above or click "Sync all from mock data".
            </span>
          </div>`;
        return;
      }

      list.innerHTML = `<div class="ch-cards-grid">${children.map(_childCard).join("")}</div>`;
    })
    .catch(() => showToast("Could not load children"));
}

function _childCard(c) {
  const s = c.stats || {};
  const total   = s.total_messages   || 0;
  const risky   = s.risky_messages   || 0;
  const groomed = s.grooming_messages || 0;
  const maxRisk = s.max_risk_score   || 0;
  const escal   = s.escalation_flag;
  const emo     = s.dominant_emotion;
  const lastSeen = s.last_seen ? s.last_seen.split("T")[0] : null;

  const riskPct  = Math.round(maxRisk * 100);
  const riskColor = riskPct >= 70 ? "#e74c3c" : riskPct >= 40 ? "#F39C12" : "#1ABC9C";
  const riskLabel = riskPct >= 70 ? "HIGH" : riskPct >= 40 ? "MEDIUM" : "LOW";

  const emoIcon  = emo ? (EMOTION_ICONS[emo]  || "😐") : "😐";
  const emoColor = emo ? (EMOTION_COLORS[emo] || "#7f8c8d") : "#7f8c8d";
  const emoLabel = emo ? (emo.charAt(0).toUpperCase() + emo.slice(1)) : "—";

  const escalBadge = escal
    ? `<span class="ch-escal-badge">🔴 Escalation detected</span>` : "";

  // Risk bar width
  const barW = Math.min(riskPct, 100);

  // Initials avatar
  const initials = c.display_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return `
    <div class="ch-card ${riskPct >= 70 ? "ch-card-high" : riskPct >= 40 ? "ch-card-medium" : ""}">

      <!-- Card header -->
      <div class="ch-card-header">
        <div class="ch-avatar" style="background:${riskColor}22;color:${riskColor};">${initials}</div>
        <div class="ch-card-identity">
          <div class="ch-display-name">${c.display_name}</div>
          <div class="ch-username">@${c.child_username}</div>
          ${lastSeen ? `<div class="ch-lastseen">Last seen ${lastSeen}</div>` : ""}
        </div>
        <div class="ch-risk-badge ch-risk-${riskLabel.toLowerCase()}">${riskLabel}</div>
      </div>

      ${escalBadge}

      <!-- Stats row -->
      <div class="ch-stats-row">
        <div class="ch-stat">
          <div class="ch-stat-value">${total}</div>
          <div class="ch-stat-label">Messages</div>
        </div>
        <div class="ch-stat ch-stat-danger">
          <div class="ch-stat-value" style="color:${risky>0?"#e74c3c":"#1ABC9C"};">${risky}</div>
          <div class="ch-stat-label">Risky</div>
        </div>
        <div class="ch-stat">
          <div class="ch-stat-value" style="color:${groomed>0?"#9b59b6":"#7f8c8d"};">${groomed}</div>
          <div class="ch-stat-label">Grooming</div>
        </div>
        <div class="ch-stat">
          <div class="ch-stat-value" style="color:${emoColor};">${emoIcon}</div>
          <div class="ch-stat-label" style="color:${emoColor};">${emoLabel}</div>
        </div>
      </div>

      <!-- Risk bar -->
      <div class="ch-risk-bar-label">
        <span>Max risk score</span>
        <span style="color:${riskColor};font-weight:700;">${riskPct}%</span>
      </div>
      <div class="ch-risk-bar-track">
        <div class="ch-risk-bar-fill"
             style="width:${barW}%;background:linear-gradient(90deg,${riskColor}99,${riskColor});">
        </div>
      </div>

      <!-- Remove -->
      <button class="ch-remove-btn" onclick="removeChild('${c.child_username}','${c.display_name}')">
        Remove
      </button>
    </div>
  `;
}

function _renderSyncPreview() {
  const el = document.getElementById("ch-sync-preview");
  if (!el || el.dataset.rendered) return;
  el.dataset.rendered = "1";
  el.innerHTML = MOCK_USERS.map(u => `
    <div class="ch-preview-row">
      <span class="ch-preview-id">@${u.id}</span>
      <span class="ch-preview-arrow">→</span>
      <span class="ch-preview-name">${u.defaultName}</span>
    </div>
  `).join("");
}

function seedChildrenFromMock() {
  const btn  = document.getElementById("ch-sync-btn");
  const note = document.getElementById("ch-sync-note");
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  if (note) note.textContent = "";

  fetch("/api/children/seed-from-mock", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  .then(r => r.json())
  .then(data => {
    if (note) {
      note.textContent = data.message;
      note.className = "ch-sync-note " + (data.success ? "ok" : "err");
    }
    if (data.success) {
      loadChildren();
      showToast(data.message);
    } else {
      showToast(data.message || "Sync failed");
    }
  })
  .catch(() => showToast("Sync request failed"))
  .finally(() => {
    if (btn) { btn.disabled = false; btn.textContent = "🔄 Sync all from mock data"; }
  });
}

function addChild() {
  const username    = (document.getElementById("child-username")?.value || "").trim();
  const displayName = (document.getElementById("child-displayname")?.value || "").trim();

  if (!username || !displayName) { showToast("Please fill both fields"); return; }

  fetch("/api/children/add", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ child_username: username, display_name: displayName })
  })
  .then(r => r.json())
  .then(data => {
    showToast(data.message);
    if (data.success) {
      document.getElementById("child-username").value = "";
      document.getElementById("child-displayname").value = "";
      loadChildren();
    }
  })
  .catch(() => showToast("Failed to link child"));
}

function removeChild(username, displayName) {
  if (!confirm(`Remove ${displayName} from your linked accounts?`)) return;
  fetch("/api/children/remove", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ child_username: username })
  })
  .then(r => r.json())
  .then(data => {
    showToast(data.message);
    if (data.success) loadChildren();
  })
  .catch(() => showToast("Failed to remove child"));
}


// ── PDF REPORT ────────────────────────────────────────────────────────────────

function downloadReport() {
  const btn = document.getElementById("btn-download");
  if (btn) { btn.textContent = "Generating…"; btn.disabled = true; }

  fetch("/api/report/download")
    .then(r => {
      if (!r.ok) throw new Error("Generation failed");
      return r.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `guardian_link_report_${new Date().toISOString().slice(0,10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Report downloaded!");
    })
    .catch(() => showToast("Could not generate report"))
    .finally(() => {
      if (btn) { btn.textContent = "Download PDF"; btn.disabled = false; }
    });
}

function emailReport() {
  const btn = document.getElementById("btn-email");
  if (btn) { btn.textContent = "Sending…"; btn.disabled = true; }

  fetch("/api/report/email", { method: "POST" })
    .then(r => r.json())
    .then(data => showToast(data.message || "Email sent!"))
    .catch(() => showToast("Could not send email"))
    .finally(() => {
      if (btn) { btn.textContent = "Send to my email"; btn.disabled = false; }
    });
}


// ── PATCH loadDashboard to also render new sections ───────────────────────────
// This wraps the existing loadDashboard() without replacing it.
// The original function still runs first; we just hook into its data.

const _originalLoadDashboard = loadDashboard;

loadDashboard = function () {
  fetch("/api/dashboard")
    .then(r => r.json())
    .then(data => {
      // Original rendering (stats, alerts, grooming, reports)
      updateStats(data);
      renderAlerts(data.messages);
      renderGrooming(data.messages);
      renderReports(data.report, data.messages);

      // New sections
      renderSentiment(data.messages);
    })
    .catch(() => showToast("Could not load data"));
};


// ── PATCH showSection to lazy-load children when that tab is opened ───────────
const _originalShowSection = showSection;

showSection = function (name) {
  _originalShowSection.call(this, name);
  if (name === "children") loadChildren();
};