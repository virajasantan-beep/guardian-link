from ml_model import analyze_risk
from grooming_detector import calculate_grooming_score

def process_message_with_context(msg):
    # ML risk scoring
    score, risky = analyze_risk(msg["message"])
    msg["risk_score"] = score
    msg["is_risky"] = risky

    # Grooming detection
    grooming_data = calculate_grooming_score([msg["message"]])
    msg["grooming_score"] = grooming_data["score"]
    msg["is_grooming"] = grooming_data["is_grooming"]
    msg["grooming_stages"] = grooming_data["stages_detected"]
    msg["escalation_flag"] = grooming_data["escalation_flag"]

    return msg