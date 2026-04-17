/**
 * social_accounts.js  –  Guardian Link
 * Handles the "Connected Accounts" dashboard section.
 * Drop this file in frontend/static/js/ and include it in base.html.
 */

// ── State ─────────────────────────────────────────────────────────────
const socialState = {
  facebook:  { is_connected: false, account_name: null },
  instagram: { is_connected: false, account_name: null },
};

// ── Bootstrap: called once when the dashboard loads ───────────────────
async function initSocialAccounts() {
  await fetchSocialStatus();
  checkOAuthRedirectResult();   // handle ?social_connected / ?social_error
}

// ── Load status from backend ──────────────────────────────────────────
async function fetchSocialStatus() {
  try {
    const res  = await fetch("/api/social/status");
    const data = await res.json();
    if (!data.success) return;

    socialState.facebook  = data.status.facebook;
    socialState.instagram = data.status.instagram;

    renderSocialUI("facebook");
    renderSocialUI("instagram");
  } catch (err) {
    console.warn("Could not load social status:", err);
  }
}

// ── Render a platform card ────────────────────────────────────────────
function renderSocialUI(platform) {
  const acc        = socialState[platform];
  const connected  = acc && acc.is_connected;
  const name       = acc && acc.account_name ? acc.account_name : null;

  const statusEl   = document.getElementById(`${platform}-status`);
  const nameEl     = document.getElementById(`${platform}-name`);
  const btnEl      = document.getElementById(`${platform}-btn`);
  const dotEl      = document.getElementById(`${platform}-dot`);

  if (!statusEl) return;   // section not in DOM yet

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
    if (btnEl)  { btnEl.textContent = `Connect ${capitalize(platform)}`; btnEl.className = "btn-social-connect"; btnEl.onclick = () => connectPlatform(platform); }
  }
}

// ── Connect a platform ────────────────────────────────────────────────
async function connectPlatform(platform) {
  const btnEl = document.getElementById(`${platform}-btn`);
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Connecting…"; }

  try {
    if (platform === "facebook") {
      const res  = await fetch("/api/social/connect/facebook", { method: "POST" });
      const data = await res.json();
      if (!data.success) { showToast(data.message || "Could not start Facebook login"); resetBtn(platform); return; }
      // Redirect to Facebook OAuth dialog (full page redirect)
      window.location.href = data.oauth_url;

    } else if (platform === "instagram") {
      // Instagram links through an already-connected Facebook account
      const res  = await fetch("/api/social/connect/instagram", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        socialState.instagram = { is_connected: true, account_name: data.account_name };
        renderSocialUI("instagram");
        showToast(`✅ Instagram connected: @${data.account_name}`);
      } else {
        showToast(data.message || "Could not connect Instagram");
        resetBtn(platform);
      }
    }
  } catch (err) {
    showToast("Network error — please try again");
    resetBtn(platform);
  }
}

// ── Disconnect a platform ─────────────────────────────────────────────
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

      // If Facebook is disconnected, also clear Instagram UI (tokens no longer valid)
      if (platform === "facebook") {
        socialState.instagram = { is_connected: false, account_name: null };
        renderSocialUI("instagram");
      }
    } else {
      showToast(data.message || "Error disconnecting");
      resetBtn(platform);
    }
  } catch (err) {
    showToast("Network error — please try again");
    resetBtn(platform);
  }
}

// ── Handle redirect back from Facebook OAuth ──────────────────────────
function checkOAuthRedirectResult() {
  const params  = new URLSearchParams(window.location.search);
  const success = params.get("social_connected");
  const error   = params.get("social_error");

  if (success) {
    showToast(`✅ ${capitalize(success)} connected successfully!`);
    // Re-fetch status so Instagram card updates too (auto-linked during FB callback)
    fetchSocialStatus();
    // Clean URL
    window.history.replaceState({}, "", "/dashboard");
  }
  if (error) {
    const msg = decodeURIComponent(error).replace(/_/g, " ");
    showToast(`⚠️ ${msg}`);
    window.history.replaceState({}, "", "/dashboard");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function resetBtn(platform) {
  const btnEl = document.getElementById(`${platform}-btn`);
  if (!btnEl) return;
  btnEl.disabled = false;
  renderSocialUI(platform);   // re-render resets text + handler
}

// ── Auto-init when DOM is ready ───────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Only run on the dashboard page
  if (document.getElementById("section-social")) {
    initSocialAccounts();
  }
});
