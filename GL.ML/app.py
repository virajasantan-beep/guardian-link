from instagram_api import fetch_mock_messages  # or fetch_ig_messages
from db import save_message
from utils import process_message_with_context, log_message
from reports import generate_risk_report

def run_collector():
    """Fetch messages, process, store, and log"""
    messages = fetch_mock_messages() # Replace with fetch_ig_messages() for real IG
    for msg in messages:
        msg = process_message_with_context(msg)
        save_message(msg)
        log_message(msg)

    report = generate_risk_report()
    print("\n=== Risk Report ===")
    print(report)

if __name__ == "__main__":
    run_collector()