from transformers import pipeline

print("🔄 Loading ML model...")

classifier = pipeline(
    "text-classification",
    model="distilbert-base-uncased-finetuned-sst-2-english"
)

print("✅ Model loaded!")


def analyze_risk(text):
    result = classifier(text)[0]

    label = result["label"]
    score = result["score"]

    if label == "NEGATIVE":
        risk_score = score
    else:
        risk_score = 1 - score

    is_risky = risk_score >= 0.7

    return risk_score, is_risky