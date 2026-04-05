from pymongo import MongoClient
from config import MONGO_URI, DB_NAME, COLLECTION_NAME

# Connect to MongoDB
client = MongoClient(MONGO_URI)
db = client[DB_NAME]
collection = db[COLLECTION_NAME]

# 🔥 Toggle duplicate protection
ALLOW_DUPLICATES = False   # ← change to False in production


def save_message(message):
    """
    Save message to MongoDB
    """
    if ALLOW_DUPLICATES:
        collection.insert_one(message)
        print("💾 Saved (duplicate allowed)")
    else:
        exists = collection.find_one({
            "sender_id": message["sender_id"],
            "timestamp": message["timestamp"],
            "message": message["message"]
        })

        if not exists:
            collection.insert_one(message)
            print("💾 Saved (new message)")
        else:
            print("⚠️ Duplicate skipped")


def get_all_messages():
    """
    Retrieve all messages
    """
    return list(collection.find())


def get_recent_messages(sender_id, n):
    """
    Get last N messages for context
    """
    return list(
        collection.find({"sender_id": sender_id})
        .sort("timestamp", -1)
        .limit(n)
    )