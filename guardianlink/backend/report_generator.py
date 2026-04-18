import io
import os
from datetime import datetime, timedelta
from collections import defaultdict

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT

# APScheduler for weekly cron
from apscheduler.schedulers.background import BackgroundScheduler

# Reuse existing app modules
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from db import get_all_messages
from alerts import send_email_alert, RECEIVER_EMAIL, EMAIL_ALERTS

# ── COLOUR PALETTE (matches dashboard) ───────────────────────────────────────
RED    = colors.HexColor("#C0392B")
TEAL   = colors.HexColor("#1ABC9C")
DARK   = colors.HexColor("#0B1628")
MID    = colors.HexColor("#1C2B3A")
LIGHT  = colors.HexColor("#F0F4F8")
MUTED  = colors.HexColor("#94a3b8")
WHITE  = colors.white


# ── PDF BUILDER ───────────────────────────────────────────────────────────────

def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title", fontName="Helvetica-Bold", fontSize=22,
            textColor=WHITE, alignment=TA_LEFT, spaceAfter=4
        ),
        "subtitle": ParagraphStyle(
            "subtitle", fontName="Helvetica", fontSize=11,
            textColor=colors.HexColor("#94a3b8"), alignment=TA_LEFT, spaceAfter=16
        ),
        "section": ParagraphStyle(
            "section", fontName="Helvetica-Bold", fontSize=13,
            textColor=colors.HexColor("#0B1628"), spaceBefore=14, spaceAfter=6
        ),
        "body": ParagraphStyle(
            "body", fontName="Helvetica", fontSize=10,
            textColor=colors.HexColor("#334155"), spaceAfter=4, leading=15
        ),
        "caption": ParagraphStyle(
            "caption", fontName="Helvetica", fontSize=9,
            textColor=colors.HexColor("#64748b"), alignment=TA_CENTER
        ),
    }


def _stat_table(stats: dict, styles: dict):
    """Renders the 4-stat summary row."""
    data = [[
        Paragraph(f"<b>{stats['total']}</b><br/><font size=8>Total messages</font>", styles["body"]),
        Paragraph(f"<b>{stats['risky']}</b><br/><font size=8>Risky messages</font>", styles["body"]),
        Paragraph(f"<b>{stats['pct']}%</b><br/><font size=8>Risk percentage</font>", styles["body"]),
        Paragraph(f"<b>{stats['escalations']}</b><br/><font size=8>Escalation flags</font>", styles["body"]),
    ]]
    t = Table(data, colWidths=[40*mm]*4)
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), LIGHT),
        ("BOX",           (0, 0), (-1, -1), 0.5, MUTED),
        ("INNERGRID",     (0, 0), (-1, -1), 0.5, MUTED),
        ("ROWBACKGROUNDS",(0, 0), (-1, -1), [LIGHT]),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("FONTNAME",      (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 0), (-1, -1), 12),
        ("TEXTCOLOR",     (0, 0), (-1, -1), DARK),
    ]))
    return t


def _user_table(user_rows: list, styles: dict):
    """Renders the per-user risk breakdown table."""
    header = ["User ID", "Total", "Risky", "Risk %", "Status"]
    rows = [header] + user_rows

    t = Table(rows, colWidths=[50*mm, 20*mm, 20*mm, 25*mm, 40*mm])
    style = [
        ("BACKGROUND",    (0, 0), (-1, 0),  MID),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  WHITE),
        ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [WHITE, LIGHT]),
        ("GRID",          (0, 0), (-1, -1), 0.3, MUTED),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
    ]
    # Colour HIGH RISK cells red
    for i, row in enumerate(user_rows, start=1):
        if row[-1] == "HIGH RISK":
            style.append(("TEXTCOLOR", (4, i), (4, i), RED))
            style.append(("FONTNAME",  (4, i), (4, i), "Helvetica-Bold"))

    t.setStyle(TableStyle(style))
    return t


def _grooming_table(grooming_rows: list, styles: dict):
    """Renders flagged messages with grooming stage detail."""
    header = ["User", "Message preview", "Score", "Stages"]
    rows = [header] + grooming_rows

    t = Table(rows, colWidths=[30*mm, 70*mm, 20*mm, 40*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  MID),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  WHITE),
        ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [WHITE, LIGHT]),
        ("GRID",          (0, 0), (-1, -1), 0.3, MUTED),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def generate_pdf_report() -> bytes:
    """
    Pulls all messages from MongoDB, builds a weekly safety report PDF,
    and returns the raw bytes.  Call this anywhere — it has no side effects.
    """
    s = _styles()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=16*mm, bottomMargin=16*mm
    )

    messages = get_all_messages()
    now = datetime.now()
    week_ago = now - timedelta(days=7)

    # ── Stats ─────────────────────────────────────────────────────────────────
    total = len(messages)
    risky = sum(1 for m in messages if m.get("is_risky"))
    escalations = sum(1 for m in messages if m.get("escalation_flag"))
    pct = round(risky / total * 100, 1) if total else 0.0

    stats = {"total": total, "risky": risky, "pct": pct, "escalations": escalations}

    # ── Per-user breakdown ────────────────────────────────────────────────────
    users = defaultdict(lambda: {"total": 0, "risky": 0})
    for m in messages:
        uid = m.get("sender_id", "unknown")
        users[uid]["total"] += 1
        if m.get("is_risky"):
            users[uid]["risky"] += 1

    user_rows = []
    for uid, d in sorted(users.items(), key=lambda x: -x[1]["risky"]):
        r = d["risky"] / d["total"] if d["total"] else 0
        user_rows.append([
            uid,
            str(d["total"]),
            str(d["risky"]),
            f"{round(r*100)}%",
            "HIGH RISK" if r >= 0.6 else "Normal"
        ])

    # ── Grooming flags ────────────────────────────────────────────────────────
    grooming_msgs = [m for m in messages if m.get("is_grooming") or m.get("escalation_flag")]
    grooming_rows = []
    for m in grooming_msgs[:20]:  # Cap at 20 rows
        stages = m.get("grooming_stages", {})
        stage_str = ", ".join(k for k, v in stages.items() if v > 0) or "—"
        preview = (m.get("message", "")[:55] + "…") if len(m.get("message","")) > 55 else m.get("message","")
        grooming_rows.append([
            m.get("sender_id", "?"),
            preview,
            f"{m.get('grooming_score', 0):.2f}",
            stage_str
        ])

    # ── AI explanations summary ───────────────────────────────────────────────
    explanations = [
        (m.get("sender_id", "?"), m.get("risk_explanation", ""))
        for m in messages
        if m.get("risk_explanation")
    ][:5]  # Top 5 to keep the report concise

    # ── Build PDF elements ───────────────────────────────────────────────────
    story = []

    # Header banner (simulated with coloured table)
    banner_data = [[
        Paragraph(
            f'<font color="white"><b>Guardian Link</b></font>',
            ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=20, textColor=WHITE)
        ),
        Paragraph(
            f'<font color="#94a3b8">Weekly Safety Report<br/>'
            f'{now.strftime("%d %B %Y")}</font>',
            ParagraphStyle("hs", fontName="Helvetica", fontSize=10,
                           textColor=MUTED, alignment=2)
        )
    ]]
    banner = Table(banner_data, colWidths=[100*mm, 60*mm])
    banner.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), DARK),
        ("TOPPADDING",    (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("ROUNDEDCORNERS", [4]),
    ]))
    story.append(banner)
    story.append(Spacer(1, 10*mm))

    # Overview stats
    story.append(Paragraph("Overview", s["section"]))
    story.append(_stat_table(stats, s))
    story.append(Spacer(1, 6*mm))

    # User risk table
    if user_rows:
        story.append(Paragraph("User risk breakdown", s["section"]))
        story.append(_user_table(user_rows, s))
        story.append(Spacer(1, 6*mm))

    # Grooming flags
    if grooming_rows:
        story.append(Paragraph("Grooming detection flags", s["section"]))
        story.append(
            Paragraph(
                "Messages below were flagged by the grooming pattern detector. "
                "Review each one and contact authorities if you believe a child is at risk.",
                s["body"]
            )
        )
        story.append(Spacer(1, 3*mm))
        story.append(_grooming_table(grooming_rows, s))
        story.append(Spacer(1, 6*mm))

    # AI explanations
    if explanations:
        story.append(Paragraph("AI risk explanations", s["section"]))
        story.append(
            Paragraph(
                "The following plain-English explanations were generated for the highest-risk messages.",
                s["body"]
            )
        )
        story.append(Spacer(1, 3*mm))
        for uid, text in explanations:
            story.append(
                Paragraph(f"<b>{uid}:</b> {text}", s["body"])
            )
            story.append(HRFlowable(width="100%", thickness=0.3, color=MUTED))
            story.append(Spacer(1, 2*mm))

    # Footer
    story.append(Spacer(1, 8*mm))
    story.append(
        Paragraph(
            "This report was generated automatically by Guardian Link. "
            "If you believe a child is in immediate danger, contact local authorities.",
            s["caption"]
        )
    )

    doc.build(story)
    return buffer.getvalue()


# ── EMAIL DELIVERY ────────────────────────────────────────────────────────────

def send_pdf_report():
    """
    Generates the PDF and sends it as an email attachment.
    Called by the scheduler (or manually).
    """
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.mime.base import MIMEBase
    from email import encoders
    from alerts import SENDER_EMAIL, SENDER_PASSWORD, RECEIVER_EMAIL

    if not EMAIL_ALERTS:
        print("[report] EMAIL_ALERTS is False — skipping send.")
        return

    print("[report] Generating weekly PDF report…")
    try:
        pdf_bytes = generate_pdf_report()
        filename = f"guardian_link_report_{datetime.now().strftime('%Y%m%d')}.pdf"

        msg = MIMEMultipart()
        msg["Subject"] = "📊 Guardian Link — Weekly Safety Report"
        msg["From"] = SENDER_EMAIL
        msg["To"] = RECEIVER_EMAIL

        body = MIMEText(
            "Please find your weekly Guardian Link safety report attached.\n\n"
            "Review flagged messages and grooming alerts inside.\n\n"
            "— Guardian Link",
            "plain"
        )
        msg.attach(body)

        part = MIMEBase("application", "octet-stream")
        part.set_payload(pdf_bytes)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
        msg.attach(part)

        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(SENDER_EMAIL, SENDER_PASSWORD)
        server.sendmail(SENDER_EMAIL, RECEIVER_EMAIL, msg.as_string())
        server.quit()
        print(f"[report] Weekly report sent as {filename}")

    except Exception as e:
        print(f"[report] Failed to send report: {e}")


# ── SCHEDULER ─────────────────────────────────────────────────────────────────

def start_weekly_report_scheduler(app=None):
    """
    Starts a background APScheduler that fires send_pdf_report()
    every Monday at 08:00.

    Call this once from app.py:
        from report_generator import start_weekly_report_scheduler
        start_weekly_report_scheduler(app)

    It is safe to call inside the `if __name__ == '__main__'` guard or
    directly in the module body — APScheduler handles duplicate starts.
    """
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        func=send_pdf_report,
        trigger="cron",
        day_of_week="mon",
        hour=8,
        minute=0,
        id="weekly_report",
        replace_existing=True
    )
    scheduler.start()
    print("[report] Weekly report scheduler started — fires every Monday 08:00")
    return scheduler
