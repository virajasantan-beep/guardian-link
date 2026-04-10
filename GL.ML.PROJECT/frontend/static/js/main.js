function register() {
  fetch("/api/register", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      email: document.getElementById("email").value,
      password: document.getElementById("password").value
    })
  })
  .then(res => res.json())
  .then(data => {
    alert(data.message);
  });
}

function login() {
  fetch("/api/login", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      email: document.getElementById("email").value,
      password: document.getElementById("password").value
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      window.location.href = "/dashboard";
    } else {
      alert("Invalid email or password");
    }
  });
}

function showToast(msg) {
  let t = document.createElement("div");
  t.className = "toast";
  t.innerText = msg;
  document.body.appendChild(t);

  setTimeout(() => t.remove(), 3000);
}




function loadDashboard() {
  fetch("/api/dashboard")
    .then(r => r.json())
    .then(data => {

      // REPORT
      document.getElementById("report").innerHTML = `
        <h3>Total: ${data.report.total_messages}</h3>
        <h3>Risky: ${data.report.risky_messages}</h3>
      `;

      // MESSAGES
      let html = "";
      let riskyCount = 0;

      data.messages.forEach(m => {
        if (m.is_risky) {
          riskyCount++;
          showToast("🚨 Risky message detected!");
        }

        html += `
          <div class="card">
            <b>${m.sender_id}</b>
            <p>${m.message}</p>
            <p>Risk: ${m.risk_score.toFixed(2)}</p>
          </div>
        `;
      });

      document.getElementById("messages").innerHTML = html;

      // CHART
      renderChart(data.messages.length, riskyCount);
    });
}


function renderChart(total, risky) {
  const ctx = document.getElementById("chart");

  if (window.chart) {
    window.chart.destroy();
  }

  window.chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Safe", "Risky"],
      datasets: [{
        data: [total - risky, risky],
      }]
    }
  });
}


function startAutoRefresh() {
  loadDashboard();
  setInterval(loadDashboard, 5000);
}


function logout() {
  fetch("/api/logout").then(() => location = "/");
}