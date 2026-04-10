from ml_model import analyze_risk
from db import get_recent_messages
from config import CONTEXT_WINDOW
from grooming_detector import calculate_grooming_score


def process_message(message):
    score, is_risky = analyze_risk(message["message"])
    message["risk_score"] = score
    message["is_risky"] = is_risky
    return message


def process_message_with_context(message):
    sender_id = message["sender_id"]
    previous_msgs = get_recent_messages(sender_id, CONTEXT_WINDOW)

    history = [msg["message"] for msg in reversed(previous_msgs)]
    history.append(message["message"])

    combined_text = " ".join(history)

    # ML risk detection
    risk_score, is_risky = analyze_risk(combined_text)

    # Grooming detection (pro-level)
    grooming_data = calculate_grooming_score(history)

    message["risk_score"] = risk_score
    message["is_risky"] = is_risky

    message["grooming_score"] = grooming_data["score"]
    message["is_grooming"] = grooming_data["is_grooming"]
    message["grooming_stages"] = grooming_data["stages_detected"]
    message["escalation_flag"] = grooming_data["escalation_flag"]

    return message


def log_message(message):
    status = "RISKY" if message["is_risky"] else "SAFE"
    grooming_flag = "🚨 GROOMING" if message.get("is_grooming") else "OK"

    print("\n" + "=" * 60)
    print(f"👤 USER ID        : {message['sender_id']}")
    print(f"💬 MESSAGE        : {message['message']}")
    print(f"⏰ TIME           : {message['timestamp']}")
    print(f"⚠️ ABUSE STATUS   : {status}")
    print(f"📊 RISK SCORE     : {message['risk_score']:.2f}")

    print("\n🧠 GROOMING ANALYSIS")
    print(f"Score             : {message.get('grooming_score', 0):.2f}")
    print(f"Flag              : {grooming_flag}")
    print(f"Stages Detected   : {message.get('grooming_stages', {})}")
    print(f"Escalation        : {message.get('escalation_flag', False)}")

    print("=" * 60)