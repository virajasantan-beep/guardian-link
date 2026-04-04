from mlmodel import analyze_risk
from db import get_recent_messages
from config import CONTEXT_WINDOW

def process_message(message):
    """Process a single message with risk detection"""
    score, is_risky = analyze_risk(message["message"])
    message["risk_score"] = score
    message["is_risky"] = is_risky
    return message

def process_message_with_context(message):
    """
    Analyze message in context of previous messages for multi-turn risk detection
    """
    sender_id = message["sender_id"]
    previous_msgs = get_recent_messages(sender_id, CONTEXT_WINDOW)
    combined_text = " ".join([msg["message"] for msg in reversed(previous_msgs)] + [message["message"]])
    score, is_risky = analyze_risk(combined_text)
    message["risk_score"] = score
    message["is_risky"] = is_risky
    return message

def log_message(message):
    """Print log for monitoring"""
    status = "RISKY" if message["is_risky"] else "SAFE"
    print(f"[{message['timestamp']}] From {message['sender_id']}: {message['message']} -> {status} ({message['risk_score']:.2f})")