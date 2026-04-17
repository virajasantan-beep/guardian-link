# Guardian Link — Social Auth Integration Guide

## Table of Contents
1. [Facebook Developer App Setup](#1-facebook-developer-app-setup)
2. [Instagram Business Account Setup](#2-instagram-business-account-setup)
3. [Environment Variables](#3-environment-variables)
4. [Installing Dependencies](#4-installing-dependencies)
5. [File Integration Checklist](#5-file-integration-checklist)
6. [API Reference](#6-api-reference)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Facebook Developer App Setup

### Step 1 — Create a Facebook App
1. Go to **https://developers.facebook.com/apps**
2. Click **Create App**
3. Select **Business** (or "Consumer" for testing)
4. Enter App Name: `Guardian Link`
5. Enter Contact Email → Click **Create App**

### Step 2 — Add Facebook Login product
1. In your app dashboard → **Add a Product**
2. Find **Facebook Login** → click **Set Up**
3. Choose **Web**
4. Enter Site URL: `http://localhost:5000` (or your production domain)

### Step 3 — Configure OAuth Redirect URIs
1. Left sidebar → **Facebook Login** → **Settings**
2. Under **Valid OAuth Redirect URIs** add:
   ```
   http://localhost:5000/api/social/callback/facebook
   ```
   *(For production, also add your HTTPS domain)*
3. Click **Save Changes**

### Step 4 — Get App Credentials
1. Left sidebar → **Settings** → **Basic**
2. Copy **App ID** → paste as `FACEBOOK_APP_ID` in `.env`
3. Click **Show** next to App Secret → copy → paste as `FACEBOOK_APP_SECRET` in `.env`

### Step 5 — Add Required Permissions
1. Left sidebar → **App Review** → **Permissions and Features**
2. Request the following permissions (some are auto-approved for development):

| Permission | Purpose |
|---|---|
| `public_profile` | Read user's name and FB ID |
| `instagram_basic` | Read Instagram Business account info |
| `instagram_manage_messages` | Read/send Instagram DMs |
| `pages_show_list` | List Facebook Pages the user manages |
| `pages_read_engagement` | Read Page content |

> **For testing (Development Mode):** All permissions work for users added as Testers/Developers in your app.  
> **For production:** Submit each permission for App Review before going live.

### Step 6 — Add Test Users (Development Mode)
1. Left sidebar → **Roles** → **Test Users**
2. Add users who will test the integration
3. Or add yourself as a **Developer** under **Roles → Roles**

---

## 2. Instagram Business Account Setup

Instagram monitoring requires:
- A **Facebook Page** (any Page you manage)
- An **Instagram Business** or **Creator** account
- The Instagram account **linked to** that Facebook Page

### Step-by-step linking:
1. Open **Instagram** → Profile → ☰ Menu → **Settings** → **Account**
2. Tap **Switch to Professional Account** → choose **Business** or **Creator**
3. Open **Facebook** → go to your **Page** → **Settings** → **Instagram**
4. Click **Connect Account** → log in with Instagram credentials
5. Done — the link is now visible to the Graph API

> Guardian Link auto-detects the Instagram account during Facebook OAuth callback.  
> If no IG account is found, a manual "Connect Instagram" button re-checks after Facebook is already linked.

---

## 3. Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Generate the Fernet encryption key (run once):
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste the output as `FERNET_KEY=` in your `.env`.

Load `.env` before starting Flask:
```bash
# Option A — python-dotenv (recommended)
pip install python-dotenv
# Then add to app.py top:
#   from dotenv import load_dotenv; load_dotenv()

# Option B — shell export
export $(cat .env | xargs)
```

---

## 4. Installing Dependencies

```bash
pip install cryptography requests
```

Full requirements additions:
```
cryptography>=42.0.0
requests>=2.31.0
```

---

## 5. File Integration Checklist

### Backend
- [ ] Copy `backend/social_auth.py` into your `backend/` folder
- [ ] Replace `backend/app.py` with the new version (adds `social_api` blueprint)
- [ ] Copy `.env.example` to `.env` and fill in values

### Frontend
- [ ] Copy `frontend/static/js/social_accounts.js` to `frontend/static/js/`
- [ ] Copy `frontend/static/css/social_accounts.css` to `frontend/static/css/`
- [ ] In `base.html` — add these two lines inside `<head>`:
  ```html
  <link rel="stylesheet" href="{{ url_for('static', filename='css/social_accounts.css') }}">
  ```
- [ ] In `base.html` — add before `</body>`:
  ```html
  <script src="{{ url_for('static', filename='js/social_accounts.js') }}"></script>
  ```
- [ ] In `dashboard.html` — add the nav item from `social_accounts_section.html` (Part A)
- [ ] In `dashboard.html` — add the section block from `social_accounts_section.html` (Part B)

---

## 6. API Reference

All endpoints require an active session (user must be logged in).

### GET `/api/social/status`
Returns connection status for all platforms. Tokens are never included.

**Response:**
```json
{
  "success": true,
  "status": {
    "facebook":  { "is_connected": true,  "account_name": "Jane Smith", "account_id": "123456" },
    "instagram": { "is_connected": false, "account_name": null,         "account_id": null }
  }
}
```

---

### POST `/api/social/connect/facebook`
Returns the Facebook OAuth URL. Frontend redirects the user to it.

**Response:**
```json
{
  "success": true,
  "oauth_url": "https://www.facebook.com/v19.0/dialog/oauth?client_id=..."
}
```

---

### GET `/api/social/callback/facebook`
Facebook redirects here after the user grants permission.  
Stores tokens encrypted in MongoDB, then redirects to `/dashboard?social_connected=facebook`.

**On error:** redirects to `/dashboard?social_error=<description>`

---

### POST `/api/social/disconnect/facebook`
Clears Facebook token and marks `is_connected = false`.

**Response:**
```json
{ "success": true, "message": "Facebook disconnected" }
```

---

### POST `/api/social/connect/instagram`
Looks up the Instagram Business account linked to the already-connected Facebook account.

**Success response:**
```json
{
  "success": true,
  "account_name": "guardian_link_test",
  "message": "Instagram @guardian_link_test connected!"
}
```

**Error (Facebook not connected):**
```json
{
  "success": false,
  "message": "Please connect Facebook first — Instagram links through your Facebook Page."
}
```

---

### POST `/api/social/disconnect/instagram`
Clears Instagram token.

**Response:**
```json
{ "success": true, "message": "Instagram disconnected" }
```

---

## 7. Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `"Facebook App ID not configured"` | `.env` not loaded or wrong key | Check `FACEBOOK_APP_ID` is set |
| `"invalid_state"` error on callback | CSRF state mismatch (session lost) | Use HTTPS in production; ensure session persists |
| Instagram not found after Facebook connect | IG not a Business account, or not linked to a Page | Follow Section 2 above |
| `InvalidToken` from Fernet | `FERNET_KEY` changed after tokens were stored | Re-generate key and re-connect accounts |
| `OAuth redirect_uri mismatch` | URI in `.env` doesn't match Facebook App settings | Copy the exact URI from Facebook App → Facebook Login → Settings |
| Permissions denied in production | App in Development Mode | Add real users as Testers, or submit permissions for App Review |
