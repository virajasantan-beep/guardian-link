import json
import requests
from config import IG_ACCESS_TOKEN, IG_USER_ID


# ✅ Mock data (for testing)
def fetch_mock_messages():
    with open("mock_data.json", "r") as f:
        data = json.load(f)
        print("DEBUG: Loaded mock data:", data)
        return data


# ✅ Instagram API (real data)
def fetch_ig_messages():
    url = f"https://graph.facebook.com/v17.0/{IG_USER_ID}/conversations?access_token={IG_ACCESS_TOKEN}"
    response = requests.get(url)
    data = response.json()

    messages = []
    for convo in data.get("data", []):
        messages.append({
            "sender_id": convo.get("id"),
            "message": convo.get("snippet"),
            "timestamp": convo.get("updated_time")
        })

    return messages