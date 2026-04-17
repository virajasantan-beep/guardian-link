

"""
social_auth.py  –  Guardian Link
Facebook / Instagram OAuth + connection management
"""

import os
import secrets
import urllib.parse
from datetime import datetime, timezone
from functools import wraps

import requests
from cryptography.fernet import Fernet
from flask import Blueprint, jsonify, redirect, request, session, url_for
from pymongo import MongoClient

# ──────────────────────────────────────────────
# DB setup  (reuses the same guardian_link DB)
# ──────────────────────────────────────────────
_client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017/"))
_db = _client["guardian_link"]
social_accounts = _db["social_accounts"]

# Compound unique index: one row per (user_id, platform)
social_accounts.create_index(
    [("user_id", 1), ("platform", 1)], unique=True
)

# ──────────────────────────────────────────────
# Encryption helper  (token-at-rest encryption)
# ──────────────────────────────────────────────
# Generate once and store in .env:  FERNET_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
_FERNET_KEY = os.getenv("FERNET_KEY")
_fernet: Fernet | None = Fernet(_FERNET_KEY.encode()) if _FERNET_KEY else None


def _encrypt(token: str) -> str:
    if _fernet:
        return _fernet.encrypt(token.encode()).decode()
    return token  # fallback (dev only)


def _decrypt(token: str) -> str:
    if _fernet:
        return _fernet.decrypt(token.encode()).decode()
    return token


# ──────────────────────────────────────────────
# Facebook / Instagram credentials  (from .env)
# ──────────────────────────────────────────────
FB_APP_ID = os.getenv("FACEBOOK_APP_ID", "")
FB_APP_SECRET = os.getenv("FACEBOOK_APP_SECRET", "")
FB_REDIRECT_URI = os.getenv(
    "FACEBOOK_REDIRECT_URI",
    "http://localhost:5000/api/social/callback/facebook",
)

FB_SCOPES = [
    "public_profile",
    "instagram_basic",
    "instagram_manage_messages",
    "pages_show_list",
    "pages_read_engagement",
]

GRAPH_API = "https://graph.facebook.com/v19.0"

# ──────────────────────────────────────────────
# Auth guard decorator
# ──────────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "user" not in session:
            return jsonify({"success": False, "message": "Not authenticated"}), 401
        return f(*args, **kwargs)
    return wrapper


# ──────────────────────────────────────────────
# DB helpers
# ──────────────────────────────────────────────
def _upsert_account(user_id: str, platform: str, data: dict):
    """Insert or replace a social account record."""
    social_accounts.update_one(
        {"user_id": user_id, "platform": platform},
        {"$set": {**data, "user_id": user_id, "platform": platform}},
        upsert=True,
    )


def _get_account(user_id: str, platform: str) -> dict | None:
    doc = social_accounts.find_one({"user_id": user_id, "platform": platform})
    if doc:
        doc.pop("_id", None)
    return doc


def _get_all_accounts(user_id: str) -> list[dict]:
    docs = list(social_accounts.find({"user_id": user_id}))
    for d in docs:
        d.pop("_id", None)
        d.pop("access_token", None)   # never expose tokens
        d.pop("refresh_token", None)
    return docs


# ──────────────────────────────────────────────
# Facebook Graph helpers
# ──────────────────────────────────────────────
def _exchange_code_for_token(code: str) -> dict:
    """Exchange short-lived code → long-lived user access token."""
    # Step 1 – short-lived token
    r = requests.get(
        f"{GRAPH_API}/oauth/access_token",
        params={
            "client_id": FB_APP_ID,
            "redirect_uri": FB_REDIRECT_URI,
            "client_secret": FB_APP_SECRET,
            "code": code,
        },
        timeout=10,
    )
    r.raise_for_status()
    short = r.json()

    # Step 2 – exchange for long-lived token (60-day)
    r2 = requests.get(
        f"{GRAPH_API}/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": FB_APP_ID,
            "client_secret": FB_APP_SECRET,
            "fb_exchange_token": short["access_token"],
        },
        timeout=10,
    )
    r2.raise_for_status()
    return r2.json()  # {access_token, token_type, expires_in}


def _fetch_fb_profile(access_token: str) -> dict:
    r = requests.get(
        f"{GRAPH_API}/me",
        params={"fields": "id,name,email", "access_token": access_token},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def _fetch_instagram_account(fb_access_token: str) -> dict | None:
    """
    Walk the user's Facebook Pages to find a linked Instagram Business account.
    Returns the first IG account found, or None.
    """
    # 1 – get Pages the user manages
    r = requests.get(
        f"{GRAPH_API}/me/accounts",
        params={"access_token": fb_access_token, "fields": "id,name,access_token"},
        timeout=10,
    )
    r.raise_for_status()
    pages = r.json().get("data", [])

    for page in pages:
        # 2 – check each page for a connected IG account
        r2 = requests.get(
            f"{GRAPH_API}/{page['id']}",
            params={
                "fields": "instagram_business_account",
                "access_token": page["access_token"],
            },
            timeout=10,
        )
        ig_data = r2.json().get("instagram_business_account")
        if ig_data:
            ig_id = ig_data["id"]
            # 3 – fetch IG username
            r3 = requests.get(
                f"{GRAPH_API}/{ig_id}",
                params={
                    "fields": "id,username,name",
                    "access_token": page["access_token"],
                },
                timeout=10,
            )
            r3.raise_for_status()
            ig_info = r3.json()
            return {
                "account_id": ig_id,
                "account_name": ig_info.get("username") or ig_info.get("name", ""),
                "page_token": page["access_token"],  # page-scoped token for IG API calls
            }
    return None


# ──────────────────────────────────────────────
# Blueprint
# ──────────────────────────────────────────────
social_api = Blueprint("social_api", __name__)


# ── GET /api/social/status ────────────────────
@social_api.route("/status", methods=["GET"])
@login_required
def get_status():
    """Returns connection status for all platforms (no tokens exposed)."""
    user_id = session["user"]
    accounts = _get_all_accounts(user_id)

    # Build a clean status map
    status = {
        "facebook": {"is_connected": False, "account_name": None, "account_id": None},
        "instagram": {"is_connected": False, "account_name": None, "account_id": None},
    }
    for acc in accounts:
        p = acc.get("platform")
        if p in status:
            status[p] = {
                "is_connected": acc.get("is_connected", False),
                "account_name": acc.get("account_name"),
                "account_id": acc.get("account_id"),
            }

    return jsonify({"success": True, "status": status})


# ── POST /api/social/connect/facebook ────────
@social_api.route("/connect/facebook", methods=["POST"])
@login_required
def connect_facebook():
    """
    Returns the Facebook OAuth URL.
    The frontend opens this URL (redirect or popup).
    """
    if not FB_APP_ID:
        return jsonify({"success": False, "message": "Facebook App ID not configured"}), 500

    state = secrets.token_urlsafe(32)
    session["fb_oauth_state"] = state  # CSRF protection

    params = {
        "client_id": FB_APP_ID,
        "redirect_uri": FB_REDIRECT_URI,
        "scope": ",".join(FB_SCOPES),
        "state": state,
        "response_type": "code",
    }
    oauth_url = "https://www.facebook.com/v19.0/dialog/oauth?" + urllib.parse.urlencode(params)
    return jsonify({"success": True, "oauth_url": oauth_url})


# ── GET /api/social/callback/facebook ────────
@social_api.route("/callback/facebook", methods=["GET"])
def facebook_callback():
    """
    Facebook redirects here after user grants permission.
    Stores tokens, then redirects the user back to the dashboard.
    """
    error = request.args.get("error")
    if error:
        return redirect("/dashboard?social_error=" + urllib.parse.quote(error))

    code = request.args.get("code")
    state = request.args.get("state")

    # CSRF check
    if not state or state != session.pop("fb_oauth_state", None):
        return redirect("/dashboard?social_error=invalid_state")

    if "user" not in session:
        return redirect("/?social_error=not_logged_in")

    user_id = session["user"]

    try:
        token_data = _exchange_code_for_token(code)
        access_token = token_data["access_token"]
        expires_in = token_data.get("expires_in", 5184000)  # default 60 days

        profile = _fetch_fb_profile(access_token)
        fb_id = profile["id"]
        fb_name = profile.get("name", "")

        expiry_ts = datetime.now(timezone.utc).timestamp() + expires_in

        _upsert_account(
            user_id,
            "facebook",
            {
                "access_token": _encrypt(access_token),
                "refresh_token": None,
                "token_expiry": expiry_ts,
                "account_id": fb_id,
                "account_name": fb_name,
                "is_connected": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )

        # Also attempt to auto-link Instagram
        ig = _fetch_instagram_account(access_token)
        if ig:
            _upsert_account(
                user_id,
                "instagram",
                {
                    "access_token": _encrypt(ig["page_token"]),
                    "refresh_token": None,
                    "token_expiry": expiry_ts,
                    "account_id": ig["account_id"],
                    "account_name": ig["account_name"],
                    "is_connected": True,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )

        return redirect("/dashboard?social_connected=facebook")

    except Exception as e:
        return redirect("/dashboard?social_error=" + urllib.parse.quote(str(e)))


# ── POST /api/social/disconnect/facebook ─────
@social_api.route("/disconnect/facebook", methods=["POST"])
@login_required
def disconnect_facebook():
    user_id = session["user"]
    social_accounts.update_one(
        {"user_id": user_id, "platform": "facebook"},
        {"$set": {"is_connected": False, "access_token": None, "refresh_token": None}},
    )
    return jsonify({"success": True, "message": "Facebook disconnected"})


# ── POST /api/social/connect/instagram ───────
@social_api.route("/connect/instagram", methods=["POST"])
@login_required
def connect_instagram():
    """
    Instagram Business accounts must be linked via Facebook.
    Check if Facebook is already connected; if so, re-fetch IG account.
    """
    user_id = session["user"]
    fb_acc = _get_account(user_id, "facebook")

    if not fb_acc or not fb_acc.get("is_connected"):
        return jsonify({
            "success": False,
            "message": "Please connect Facebook first — Instagram links through your Facebook Page.",
        }), 400

    try:
        raw_token = _decrypt(fb_acc["access_token"])
        ig = _fetch_instagram_account(raw_token)

        if not ig:
            return jsonify({
                "success": False,
                "message": (
                    "No Instagram Business account found. "
                    "Make sure your IG account is a Business/Creator account "
                    "linked to a Facebook Page you manage."
                ),
            }), 404

        _upsert_account(
            user_id,
            "instagram",
            {
                "access_token": _encrypt(ig["page_token"]),
                "refresh_token": None,
                "token_expiry": fb_acc.get("token_expiry"),
                "account_id": ig["account_id"],
                "account_name": ig["account_name"],
                "is_connected": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        return jsonify({
            "success": True,
            "account_name": ig["account_name"],
            "message": f"Instagram @{ig['account_name']} connected!",
        })

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


# ── POST /api/social/disconnect/instagram ────
@social_api.route("/disconnect/instagram", methods=["POST"])
@login_required
def disconnect_instagram():
    user_id = session["user"]
    social_accounts.update_one(
        {"user_id": user_id, "platform": "instagram"},
        {"$set": {"is_connected": False, "access_token": None, "refresh_token": None}},
    )
    return jsonify({"success": True, "message": "Instagram disconnected"})


# ── Utility: get decrypted token for internal use ──
def get_platform_token(user_id: str, platform: str) -> str | None:
    """
    Used by other backend modules (e.g. instagram_api.py) to retrieve
    a valid, decrypted access token for API calls.
    Returns None if not connected or token expired.
    """
    acc = _get_account(user_id, platform)
    if not acc or not acc.get("is_connected"):
        return None

    expiry = acc.get("token_expiry")
    if expiry and datetime.now(timezone.utc).timestamp() > expiry:
        # Mark expired
        social_accounts.update_one(
            {"user_id": user_id, "platform": platform},
            {"$set": {"is_connected": False}},
        )
        return None

    raw = acc.get("access_token")
    return _decrypt(raw) if raw else None
