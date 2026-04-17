import smtplib
from email.mime.text import MIMEText

# ===== CONFIGURE EMAIL (OPTIONAL) =====
EMAIL_ALERTS = True   # Set True to enable email alerts
SENDER_EMAIL = "viraja.santan@gmail.com"
SENDER_PASSWORD = "fdbr njmo xzcq jyaw"
RECEIVER_EMAIL = "guardian_email@gmail.com"


def send_email_alert(message):
    """Send alert via email (optional)"""
    try:
        msg = MIMEText(message)
        msg["Subject"] = "🚨 Guardian Link Alert"
        msg["From"] = SENDER_EMAIL
        msg["To"] = RECEIVER_EMAIL

        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.sendmail(SENDER_EMAIL, RECEIVER_EMAIL, msg.as_string())
        server.quit()

        print("📧 Email alert sent!")

    except Exception as e:
        print(f"Email failed: {e}")


def trigger_alert(message):
    """Trigger alert when risky content is detected"""
    alert_msg = f"🚨 ALERT: Risky message detected!\n\nUser: {message['sender_id']}\nMessage: {message['message']}\nRisk Score: {message['risk_score']:.2f}"

    print("\n" + "="*50)
    print(alert_msg)
    print("="*50 + "\n")

    if EMAIL_ALERTS:
        send_email_alert(alert_msg)