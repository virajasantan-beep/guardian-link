from transformers import pipeline
from config import RISK_THRESHOLD

# Load a pre-trained toxic content detection model
classifier = pipeline("text-classification", model="unitary/toxic-bert")

def analyze_risk(text):
    """
    Analyze single message and return risk score and risky flag
    """
    result = classifier(text)[0]  # [{'label': 'TOXIC', 'score': 0.98}]
    score = result["score"] if result["label"] == "TOXIC" else 1 - result["score"]
    is_risky = score >= RISK_THRESHOLD
    return score, is_risky