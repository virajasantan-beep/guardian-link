from db import get_all_messages

HIGH_RISK_THRESHOLD = 0.85


def calculate_user_risk():
    """Aggregate risk per user"""
    messages = get_all_messages()
    user_scores = {}

    for msg in messages:
        user = msg["sender_id"]

        if user not in user_scores:
            user_scores[user] = {"total": 0, "risky": 0}

        user_scores[user]["total"] += 1
        if msg["is_risky"]:
            user_scores[user]["risky"] += 1

    results = {}
    for user, data in user_scores.items():
        risk_ratio = data["risky"] / data["total"]
        results[user] = {
            "risk_ratio": risk_ratio,
            "is_high_risk": risk_ratio >= 0.6
        }

    return results


def detect_high_risk_message(message):
    """Immediate escalation check"""
    return message["risk_score"] >= HIGH_RISK_THRESHOLD