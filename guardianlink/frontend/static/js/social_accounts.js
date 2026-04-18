/**
 * social_accounts.js  –  Guardian Link
 * Real Facebook / Instagram OAuth connect + auto screen-record trigger.
 */

const socialState = {
  facebook:  { is_connected: false, account_name: null },
  instagram: { is_connected: false, account_name: null },
};

// ── Bootstrap ─────────────────────────────────────────────────────
async function initSocialAccounts() {
  await fetchSocialStatus();
  checkOAuthRedirectResult();
}

// ── Load status ───────────────────────────────────────────────────
async function fetchSocialStatus() {
  try {
    const res  = await fetch("/api/social/status");
    const data = await res.json();
    if (!data.success) return;
    socialState.facebook  = data.status.facebook;
    socialState.instagram = data.status.instagram;
    renderSocialUI("facebook");
    renderSocialUI("instagram");

    // If Instagram is connected, start watching for abnormal chat
    if (socialState.instagram?.is_connected) {
      _startAbnormalChatWatcher();
    }
  } catch (err) {
    console.warn("Could not load social status:", err);
  }
}

// ── Render card UI ────────────────────────────────────────────────
function renderSocialUI(platform) {
  const acc       = socialState[platform];
  const connected = acc && acc.is_connected;
  const name      = acc && acc.account_name ? acc.account_name : null;

  const statusEl = document.getElementById(`${platform}-status`);
  const nameEl   = document.getElementById(`${platform}-name`);
  const btnEl    = document.getElementById(`${platform}-btn`);
  const dotEl    = document.getElementById(`${platform}-dot`);
  if (!statusEl) return;

  if (connected) {
    statusEl.textContent = "Connected";
    statusEl.className   = "social-status connected";
    if (dotEl)  dotEl.className = "social-dot connected";
    if (nameEl) { nameEl.textContent = name ? `@${name}` : ""; nameEl.style.display = name ? "block" : "none"; }
    if (btnEl)  { btnEl.textContent = "Disconnect"; btnEl.className = "btn-social-disconnect"; btnEl.onclick = () => disconnectPlatform(platform); }
  } else {
    statusEl.textContent = "Not connected";
    statusEl.className   = "social-status disconnected";
    if (dotEl)  dotEl.className = "social-dot disconnected";
    if (nameEl) { nameEl.textContent = ""; nameEl.style.display = "none"; }
    if (platform === "facebook") {
      if (btnEl) { btnEl.textContent = "Connect Facebook"; btnEl.className = "btn-social-connect"; btnEl.onclick = () => connectFacebookDirect(); }
    } else {
      if (btnEl) { btnEl.textContent = "Connect Instagram"; btnEl.className = "btn-social-connect instagram"; btnEl.onclick = () => connectInstagramDirect(); }
    }
  }
}

// ── REAL Facebook OAuth — direct redirect ─────────────────────────
async function connectFacebookDirect() {
  const btnEl = document.getElementById("facebook-btn");
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Opening Facebook…"; }
  try {
    const res  = await fetch("/api/social/connect/facebook", { method: "POST" });
    const data = await res.json();
    if (data.success && data.oauth_url) {
      // Full page redirect to Facebook login
      window.location.href = data.oauth_url;
    } else {
      showToast(data.message || "Facebook App not configured — see .env");
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Connect Facebook"; }
    }
  } catch (err) {
    showToast("Network error");
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Connect Facebook"; }
  }
}

// ── REAL Instagram — links via Facebook ──────────────────────────
async function connectInstagramDirect() {
  // Instagram Business must come via Facebook first
  if (!socialState.facebook?.is_connected) {
    showToast("⚠️ Connect Facebook first — Instagram links through your Facebook Page.");
    return;
  }
  const btnEl = document.getElementById("instagram-btn");
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Linking…"; }
  try {
    const res  = await fetch("/api/social/connect/instagram", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      socialState.instagram = { is_connected: true, account_name: data.account_name };
      renderSocialUI("instagram");
      showToast(`✅ Instagram @${data.account_name} connected!`);
      _startAbnormalChatWatcher();
    } else {
      showToast(data.message || "Could not connect Instagram");
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Connect Instagram"; }
    }
  } catch (err) {
    showToast("Network error");
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Connect Instagram"; }
  }
}

// ── Disconnect ────────────────────────────────────────────────────
async function disconnectPlatform(platform) {
  if (!confirm(`Disconnect ${capitalize(platform)}? Guardian Link will stop monitoring this account.`)) return;
  const btnEl = document.getElementById(`${platform}-btn`);
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Disconnecting…"; }
  try {
    const res  = await fetch(`/api/social/disconnect/${platform}`, { method: "POST" });
    const data = await res.json();
    if (data.success) {
      socialState[platform] = { is_connected: false, account_name: null };
      renderSocialUI(platform);
      showToast(`${capitalize(platform)} disconnected`);
      if (platform === "facebook") {
        socialState.instagram = { is_connected: false, account_name: null };
        renderSocialUI("instagram");
      }
    } else {
      showToast(data.message || "Error disconnecting");
      renderSocialUI(platform);
    }
  } catch (err) {
    showToast("Network error");
    renderSocialUI(platform);
  }
}

// ── OAuth redirect result handler ─────────────────────────────────
function checkOAuthRedirectResult() {
  const params  = new URLSearchParams(window.location.search);
  const success = params.get("social_connected");
  const error   = params.get("social_error");
  if (success) {
    showToast(`✅ ${capitalize(success)} connected successfully!`);
    fetchSocialStatus();
    window.history.replaceState({}, "", "/dashboard");
  }
  if (error) {
    showToast(`⚠️ ${decodeURIComponent(error).replace(/_/g, " ")}`);
    window.history.replaceState({}, "", "/dashboard");
  }
}

// ── Abnormal chat watcher — auto screen-record prompt ────────────
// Polls /api/dashboard every 30s. If a new HIGH-risk message appears
// from a connected Instagram/Facebook user, prompts for screen recording.

let _watcherInterval   = null;
let _lastRiskyCount    = 0;
let _recordingPrompted = false;

function _startAbnormalChatWatcher() {
  if (_watcherInterval) return;   // already running
  console.log("[SocialWatch] Starting abnormal chat watcher");

  _watcherInterval = setInterval(async () => {
    try {
      const res  = await fetch("/api/dashboard");
      const data = await res.json();
      const msgs = data.messages || [];

      const highRisk = msgs.filter(m =>
        (m.risk_score >= 0.7 || m.escalation_flag) && m.is_risky
      );

      if (highRisk.length > _lastRiskyCount && !_recordingPrompted) {
        _lastRiskyCount    = highRisk.length;
        _recordingPrompted = true;
        _showScreenRecordPrompt(highRisk[highRisk.length - 1]);
        setTimeout(() => { _recordingPrompted = false; }, 60000);  // re-arm after 1 min
      }
      _lastRiskyCount = Math.max(_lastRiskyCount, highRisk.length);
    } catch (_) {}
  }, 30000);
}

function _showScreenRecordPrompt(triggerMsg) {
  // Remove any existing prompt
  const old = document.getElementById("gl-screen-prompt");
  if (old) old.remove();

  const panel = document.createElement("div");
  panel.id = "gl-screen-prompt";
  panel.className = "gl-screen-prompt";
  panel.innerHTML = `
    <div class="gl-screen-prompt-inner">
      <div class="gl-screen-prompt-icon">🚨</div>
      <div class="gl-screen-prompt-content">
        <div class="gl-screen-prompt-title">Suspicious chat detected on Instagram</div>
        <div class="gl-screen-prompt-msg">
          "<em>${escHtmlSocial(String(triggerMsg?.message || "").slice(0, 80))}</em>"<br>
          <span class="gl-screen-prompt-sub">
            Risk score: <strong>${Math.round((triggerMsg?.risk_score||0)*100)}%</strong>
            &nbsp;·&nbsp; User: <strong>${escHtmlSocial(triggerMsg?.sender_id || "unknown")}</strong>
          </span>
        </div>
        <div class="gl-screen-prompt-title" style="margin-top:8px;font-size:13px;">
          Start screen recording to capture what the child is seeing?
        </div>
      </div>
      <div class="gl-screen-prompt-actions">
        <button class="gl-screen-prompt-yes" onclick="
          document.getElementById('gl-screen-prompt').remove();
          showSection('monitor');
          document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
          GLMonitor.start();
        ">▶ Start Recording</button>
        <button class="gl-screen-prompt-no" onclick="document.getElementById('gl-screen-prompt').remove()">
          Dismiss
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Auto-dismiss after 30s
  setTimeout(() => panel.remove(), 30000);
}

function escHtmlSocial(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("section-social")) initSocialAccounts();
});
