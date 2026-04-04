from pymongo import MongoClient
from config import MONGO_URI, DB_NAME, COLLECTION_NAME

client = MongoClient(MONGO_URI)
db = client[DB_NAME]
collection = db[COLLECTION_NAME]

def save_message(message):
    """Save message to MongoDB"""
    collection.insert_one(message)

def get_all_messages():
    """Get all stored messages"""
    return list(collection.find())

def get_recent_messages(sender_id, n):
    """Get last n messages from a sender"""
    return list(collection.find({"sender_id": sender_id}).sort("timestamp", -1).limit(n))