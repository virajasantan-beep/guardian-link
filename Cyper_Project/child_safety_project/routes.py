import os
from flask import Blueprint, render_template, request, redirect, url_for, session, flash
from werkzeug.utils import secure_filename
from models import (
    create_user, verify_user, get_user_by_email, link_parent_child,
    add_social_account, add_incident, add_evidence,
    get_parent_children, get_child_incidents, get_child_accounts, get_incident_evidence,
    delete_user, insert_dummy_data, delete_all_for_parent
)

routes_bp = Blueprint("routes_bp", __name__)

def login_required():
    return "user_id" in session

def role_required(role):
    return session.get("role") == role

@routes_bp.route("/")
def index():
    return render_template("welcome.html")

@routes_bp.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        full_name = request.form.get("full_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        role = request.form.get("role", "")

        if not full_name or not email or not password or role not in ["parent", "child"]:
            flash("Please fill all fields correctly.", "danger")
            return render_template("register.html")

        try:
            create_user(full_name, email, password, role)
            flash("Registration successful. Please login.", "success")
            return redirect(url_for("routes_bp.login"))
        except Exception:
            flash("Email already exists or invalid data.", "danger")
            return render_template("register.html")

    return render_template("register.html")

@routes_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        user = verify_user(email, password)
        if not user:
            flash("Invalid email or password.", "danger")
            return render_template("login.html")

        session["user_id"] = user["user_id"]
        session["role"] = user["role"]
        session["full_name"] = user["full_name"]
        session["email"] = user["email"]

        if user["role"] == "parent":
            return redirect(url_for("routes_bp.parent_dashboard"))
        return redirect(url_for("routes_bp.child_dashboard"))

    return render_template("login.html")

@routes_bp.route("/logout")
def logout():
    session.clear()
    flash("Logged out successfully.", "success")
    return redirect(url_for("routes_bp.login"))

@routes_bp.route("/welcome")
def welcome():
    return render_template("welcome.html")

@routes_bp.route("/parent/dashboard")
def parent_dashboard():
    if not login_required() or not role_required("parent"):
        return redirect(url_for("routes_bp.login"))

    parent_id = session["user_id"]
    children = get_parent_children(parent_id)

    all_threats = []
    all_photos = []

    for child in children:
        child_incidents = get_child_incidents(child["user_id"])
        all_threats.extend(child_incidents)
        for incident in child_incidents:
            all_photos.extend(get_incident_evidence(incident["incident_id"]))

    return render_template("parent_dashboard.html", children=children, threats=all_threats, photos=all_photos)

@routes_bp.route("/child/dashboard")
def child_dashboard():
    if not login_required() or not role_required("child"):
        return redirect(url_for("routes_bp.login"))

    child_id = session["user_id"]
    incidents = get_child_incidents(child_id)
    accounts = get_child_accounts(child_id)
    return render_template("child_dashboard.html", incidents=incidents, accounts=accounts)

@routes_bp.route("/link-child", methods=["POST"])
def link_child():
    if not login_required() or not role_required("parent"):
        return redirect(url_for("routes_bp.login"))

    child_email = request.form.get("child_email", "").strip().lower()
    child = get_user_by_email(child_email)

    if not child or child["role"] != "child":
        flash("Child account not found.", "danger")
        return redirect(url_for("routes_bp.parent_dashboard"))

    try:
        link_parent_child(session["user_id"], child["user_id"])
        flash("Child linked successfully.", "success")
    except Exception:
        flash("Child already linked or link failed.", "danger")

    return redirect(url_for("routes_bp.parent_dashboard"))

@routes_bp.route("/add-account", methods=["POST"])
def add_account_route():
    if not login_required() or not role_required("child"):
        return redirect(url_for("routes_bp.login"))

    platform = request.form.get("platform", "").strip()
    username = request.form.get("username", "").strip()

    if platform and username:
        add_social_account(session["user_id"], platform, username)
        flash("Social account added.", "success")
    else:
        flash("Please fill all account fields.", "danger")

    return redirect(url_for("routes_bp.child_dashboard"))

@routes_bp.route("/add-incident", methods=["POST"])
def add_incident_route():
    if not login_required() or not role_required("child"):
        return redirect(url_for("routes_bp.login"))

    platform = request.form.get("platform", "").strip()
    sender_handle = request.form.get("sender_handle", "").strip()
    incident_type = request.form.get("incident_type", "").strip()
    message_text = request.form.get("message_text", "").strip()
    severity = int(request.form.get("severity", 1))

    add_incident(session["user_id"], platform, sender_handle, incident_type, message_text, severity)
    flash("Incident reported.", "success")
    return redirect(url_for("routes_bp.child_dashboard"))

@routes_bp.route("/add-evidence", methods=["POST"])
def add_evidence_route():
    if not login_required() or not role_required("child"):
        return redirect(url_for("routes_bp.login"))

    incident_id = request.form.get("incident_id")
    file_path = request.form.get("file_path", "").strip()
    file_hash = request.form.get("file_hash", "").strip()
    media_type = request.form.get("media_type", "").strip()

    if incident_id and file_path:
        add_evidence(incident_id, file_path, file_hash, media_type)
        flash("Evidence added.", "success")
    else:
        flash("Please provide incident and file path.", "danger")

    return redirect(url_for("routes_bp.child_dashboard"))

@routes_bp.route("/upload-photo", methods=["POST"])
def upload_photo():
    if not login_required() or not role_required("child"):
        return redirect(url_for("routes_bp.login"))

    if "photo" not in request.files:
        flash("No photo selected!", "danger")
        return redirect(url_for("routes_bp.child_dashboard"))

    photo = request.files["photo"]
    incident_id = request.form.get("incident_id", "1")

    if photo.filename:
        filename = secure_filename(photo.filename)
        os.makedirs("static/uploads", exist_ok=True)
        photo.save(os.path.join("static/uploads", filename))
        add_evidence(incident_id, filename, "jpg_hash", "image/jpeg")
        flash(f"{filename} uploaded!", "success")

    return redirect(url_for("routes_bp.child_dashboard"))

@routes_bp.route("/delete-account", methods=["POST"])
def delete_account():
    if "user_id" not in session:
        return redirect(url_for("routes_bp.login"))

    user_id = session["user_id"]
    delete_user(user_id)
    session.clear()
    flash("Account deleted successfully.", "success")
    return redirect(url_for("routes_bp.register"))

@routes_bp.route("/delete-all-confirm", methods=["GET", "POST"])
def delete_all_confirm():
    if not login_required() or not role_required("parent"):
        return redirect(url_for("routes_bp.login"))

    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        if email != session.get("email"):
            flash("Email confirmation does not match.", "danger")
            return render_template("delete_confirm.html")

        user = verify_user(email, password)
        if not user:
            flash("Password confirmation failed.", "danger")
            return render_template("delete_confirm.html")

        parent_id = session["user_id"]
        delete_all_for_parent(parent_id)
        session.clear()
        flash("All data deleted successfully.", "success")
        return redirect(url_for("routes_bp.register"))

    return render_template("delete_confirm.html")

@routes_bp.route("/load-dummy-data", methods=["POST"])
def load_dummy_data():
    if "user_id" not in session or session.get("role") != "child":
        return redirect(url_for("routes_bp.login"))

    insert_dummy_data(session["user_id"])
    flash("Dummy data added successfully.", "success")
    return redirect(url_for("routes_bp.child_dashboard"))