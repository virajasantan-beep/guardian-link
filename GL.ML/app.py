import time
from alerts import trigger_alert
from risk_engine import detect_high_risk_message, calculate_user_risk
from instagram_api import fetch_mock_messages
from db import save_message
from utils import process_message_with_context, log_message
from reports import generate_risk_report

INTERVAL = 60


def run_collector():
    messages = fetch_mock_messages()

    print(f"\nDEBUG: Loaded {len(messages)} messages")

    for msg in messages:
        print("\n==============================")
        print("🚀 LOOP EXECUTING")

        msg = process_message_with_context(msg)

        print("📦 PROCESSED MESSAGE:", msg)

        log_message(msg)
        save_message(msg)

        if msg["is_risky"]:
            print("🚨 ABUSE DETECTED")
            trigger_alert(msg)

        if msg["is_grooming"]:
            print("🚨 GROOMING DETECTED!")

        if msg["escalation_flag"]:
            print("🔥 ESCALATION PATTERN DETECTED!")

        if detect_high_risk_message(msg):
            print("⚠️ HIGH RISK MESSAGE DETECTED!")

    report = generate_risk_report()
    print("\n=== System Risk Report ===")
    print(report)

    user_risk = calculate_user_risk()
    print("\n=== User Risk Analysis ===")

    for user, data in user_risk.items():
        status = "HIGH RISK USER" if data["is_high_risk"] else "NORMAL"
        print(f"{user} -> {status} ({data['risk_ratio']:.2f})")


if __name__ == "__main__":
    print("🚀 App started")

    while True:
        run_collector()
        print("\nWaiting...\n")
        time.sleep(INTERVAL)