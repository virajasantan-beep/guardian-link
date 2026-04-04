import json
import requests
from config import IG_ACCESS_TOKEN, IG_USER_ID

def fetch_mock_messages():
    """Load mock messages for testing"""
    with open("mock_data.json", "r") as f:
        return json.load(f)

def fetch_ig_messages():
    """Fetch Instagram messages via Graph API (Business accounts only)"""
    url = f"https://graph.facebook.com/v17.0/{IG_USER_ID}/conversations?access_token={IG_ACCESS_TOKEN}"
    response = requests.get(url)
    data = response.json()
    messages = []

    for convo in data.get("data", []):
        messages.append({
            "sender_id": convo.get("id"),
            "message": convo.get("snippet"),
            "timestamp": convo.get("updated_time"),
            "risk_score": None,
            "is_risky": False
        })
    return messages