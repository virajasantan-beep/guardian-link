from db import get_all_messages

def generate_risk_report():
    """Generate a summary report of risky messages"""
    messages = get_all_messages()
    total = len(messages)
    risky = len([m for m in messages if m["is_risky"]])
    safe = total - risky
    report = {
        "total_messages": total,
        "risky_messages": risky,
        "safe_messages": safe,
        "risky_percentage": (risky/total*100) if total else 0
    }
    return report
