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

// Apply saved theme on load
if (localStorage.getItem("theme") === "light") {
  document.body.classList.add("light");
  const btn = document.getElementById("theme-btn");
  if (btn) btn.textContent = "🌙 Dark";
}
function renderSentiment(messages) {
  const list = document.getElementById("sentiment-list");
  const badge = document.getElementById("sentiment-badge");
  if (!list || !messages) return;

  // Only show messages that have sentiment data
  const withSentiment = messages.filter(m => m.dominant_emotion && m.dominant_emotion !== "neutral");

  if (badge) {
    badge.textContent = withSentiment.length;
    badge.style.display = withSentiment.length ? "inline" : "none";
  }

  if (!withSentiment.length) {
    list.innerHTML = '<div class="empty">No sentiment data yet — sentiment analysis runs on flagged messages.</div>';
    return;
  }

  list.innerHTML = withSentiment.map(m => {
    const emotionColor = m.emotion_color || "#7f8c8d";
    const emotionBg    = m.emotion_bg    || "rgba(127,140,141,0.15)";
    const riskFlag     = m.emotion_risky
      ? `<span style="font-size:11px;padding:3px 8px;border-radius:6px;
           background:rgba(192,57,43,0.2);color:#e74c3c;font-weight:600;margin-left:8px;">
           ⚠ Manipulation signal
         </span>`
      : "";

    // Render top-3 emotion scores as small bars
    const scores = m.sentiment_scores || {};
    const sortedScores = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const scoreBars = sortedScores.map(([emotion, score]) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="font-size:11px;width:64px;color:rgba(255,255,255,0.5);text-transform:capitalize;">
          ${emotion}
        </span>
        <div style="flex:1;height:5px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${Math.round(score * 100)}%;
            background:${emotion === m.dominant_emotion ? emotionColor : 'rgba(255,255,255,0.2)'};
            border-radius:4px;transition:width 0.6s ease;"></div>
        </div>
        <span style="font-size:11px;color:rgba(255,255,255,0.3);width:34px;text-align:right;">
          ${Math.round(score * 100)}%
        </span>
      </div>
    `).join("");

    // AI explanation block
    const explanation = m.risk_explanation
      ? `<div style="
           margin-top:12px;
           padding:10px 14px;
           background:rgba(26,188,156,0.08);
           border-left:3px solid #1ABC9C;
           border-radius:0 8px 8px 0;
           font-size:12px;
           color:rgba(255,255,255,0.6);
           line-height:1.6;">
           <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;
             color:#1ABC9C;font-weight:600;display:block;margin-bottom:4px;">AI explanation</span>
           ${m.risk_explanation}
         </div>`
      : "";

    return `
      <div class="alert-card" style="flex-direction:column;align-items:flex-start;gap:10px;">
        <div style="display:flex;align-items:center;gap:12px;width:100%;">
          <div class="alert-user">${m.display_name || m.sender_id}</div>
          <div class="alert-message" style="flex:1;">${m.message}</div>
          <span style="
            font-size:12px;padding:4px 10px;border-radius:20px;font-weight:600;
            background:${emotionBg};color:${emotionColor};">
            ${m.emotion_label || "Unknown"}
          </span>
          ${riskFlag}
        </div>
        <div style="width:100%;padding-left:4px;">${scoreBars}</div>
        ${explanation}
      </div>
    `;
  }).join("");
}


// ── CHILDREN / GUARDIAN PROFILE ───────────────────────────────────────────────

function loadChildren() {
  fetch("/api/children")
    .then(r => r.json())
    .then(data => {
      const list = document.getElementById("children-list");
      if (!list) return;

      if (!data.children || !data.children.length) {
        list.innerHTML = '<div class="empty">No children linked yet. Add one above.</div>';
        return;
      }

      list.innerHTML = data.children.map(c => `
        <div class="alert-card" style="align-items:center;">
          <div style="
            width:40px;height:40px;border-radius:50%;
            background:rgba(26,188,156,0.15);
            display:flex;align-items:center;justify-content:center;
            font-size:18px;flex-shrink:0;">
            👶
          </div>
          <div style="flex:1;">
            <div style="font-size:15px;font-weight:600;margin-bottom:2px;">${c.display_name}</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#1ABC9C;">
              ${c.child_username}
            </div>
          </div>
          <button onclick="removeChild('${c.child_username}', '${c.display_name}')"
            style="
              background:rgba(192,57,43,0.15);border:1px solid rgba(192,57,43,0.3);
              color:#e74c3c;padding:6px 14px;border-radius:8px;cursor:pointer;
              font-size:12px;font-family:'DM Sans',sans-serif;">
            Remove
          </button>
        </div>
      `).join("");
    })
    .catch(() => showToast("Could not load children"));
}

function addChild() {
  const username    = (document.getElementById("child-username")?.value || "").trim();
  const displayName = (document.getElementById("child-displayname")?.value || "").trim();

  if (!username || !displayName) {
    showToast("Please fill both fields");
    return;
  }

  fetch("/api/children/add", {
    method: "POST",
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