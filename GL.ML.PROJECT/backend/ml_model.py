def analyze_risk(text):
    # simple dummy logic (fast)
    risky_words = ["alone", "secret", "photo"]

    score = 0.1
    for word in risky_words:
        if word in text.lower():
            score += 0.4

    return score, score > 0.7