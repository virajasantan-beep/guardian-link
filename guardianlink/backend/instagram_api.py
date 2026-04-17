import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def fetch_mock_messages():
    with open(os.path.join(BASE_DIR, "mock_data.json")) as f:
        return json.load(f)