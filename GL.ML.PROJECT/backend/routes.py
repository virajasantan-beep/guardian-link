from flask import Blueprint, request, jsonify, session
from db import get_all_messages
from auth import register_user, login_user

api = Blueprint("api", __name__)

# REGISTER
@api.route("/register", methods=["POST"])
def register():
    data = request.json
    success, msg = register_user(data["email"], data["password"])
    return jsonify({"success": success, "message": msg})


# LOGIN (IMPORTANT)
@api.route("/login", methods=["POST"])
def login():
    data = request.json
    success, user = login_user(data["email"], data["password"])

    if success:
        session["user"] = user["email"]
        return jsonify({"success": True})

    return jsonify({"success": False})