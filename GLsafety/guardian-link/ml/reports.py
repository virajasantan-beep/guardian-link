from db import get_all_messages

def generate_risk_report():
    messages = get_all_messages()
    total = len(messages)
    risky = len([m for m in messages if m["is_risky"]])

    return {
        "total_messages": total,
        "risky_messages": risky,
        "safe_messages": total - risky,
        "risk_percentage": (risky / total * 100) if total else 0
    }
