from flask import Blueprint, send_file, jsonify
import io
from report_generator import generate_pdf_report, send_pdf_report
from datetime import datetime

report_api = Blueprint("report_api", __name__)


@report_api.route("/report/download", methods=["GET"])
def download_report():
    """Generates the PDF and streams it as a file download."""
    try:
        pdf_bytes = generate_pdf_report()
        filename = f"guardian_link_report_{datetime.now().strftime('%Y%m%d')}.pdf"
        return send_file(
            io.BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@report_api.route("/report/email", methods=["POST"])
def email_report():
    """Triggers an immediate email of the PDF report."""
    try:
        send_pdf_report()
        return jsonify({"success": True, "message": "Report sent to your email!"})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500
