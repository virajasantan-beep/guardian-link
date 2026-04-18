from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017/")
db = client["guardian_link"]
collection = db["messages"]


def save_message(msg):
    exists = collection.find_one({
        "sender_id": msg["sender_id"],
        "timestamp": msg["timestamp"]
    })

    if not exists:
        collection.insert_one(msg)


def get_all_messages():
    return list(collection.find())