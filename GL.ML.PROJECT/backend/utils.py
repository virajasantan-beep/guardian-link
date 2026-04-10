from ml_model import analyze_risk


def process_message_with_context(msg):
    score, risky = analyze_risk(msg["message"])

    msg["risk_score"] = score
    msg["is_risky"] = risky

    return msg