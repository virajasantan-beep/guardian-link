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