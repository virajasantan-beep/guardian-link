from flask_bcrypt import Bcrypt
from pymongo import MongoClient

bcrypt = Bcrypt()

client = MongoClient("mongodb://localhost:27017/")
db = client["guardian_link"]
users = db["users"]


def register_user(email, password):
    if users.find_one({"email": email}):
        return False, "User exists"

    hashed = bcrypt.generate_password_hash(password).decode("utf-8")

    users.insert_one({
        "email": email,
        "password": hashed
    })

    return True, "Registered"


def login_user(email, password):
    user = users.find_one({"email": email})

    if user and bcrypt.check_password_hash(user["password"], password):
        return True, user

    return False, None