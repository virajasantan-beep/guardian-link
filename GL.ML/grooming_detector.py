# grooming_detector.py

from collections import defaultdict

# 🎯 Categorized patterns
GROOMING_PATTERNS = {
    "trust": [
        "trust me", "i care about you", "i understand you",
        "only i understand you"
    ],
    "isolation": [
        "are you alone", "where are your parents",
        "is anyone with you"
    ],
    "secrecy": [
        "don't tell anyone", "keep this secret",
        "this is between us", "our secret"
    ],
    "control": [
        "delete this", "don't talk to others",
        "only talk to me"
    ],
    "escalation": [
        "send me a photo", "send pic", "meet me",
        "come alone", "video call me"
    ]
}

# Stage weights (IMPORTANT)
STAGE_WEIGHTS = {
    "trust": 0.2,
    "isolation": 0.3,
    "secrecy": 0.5,
    "control": 0.6,
    "escalation": 0.8
}


def detect_patterns(text):
    text = text.lower()
    detected = []

    for stage, phrases in GROOMING_PATTERNS.items():
        for phrase in phrases:
            if phrase in text:
                detected.append(stage)

    return detected


def calculate_grooming_score(messages):
    """
    messages = list of message texts (conversation history)
    """

    stage_counts = defaultdict(int)
    total_score = 0

    for msg in messages:
        detected = detect_patterns(msg)

        for stage in detected:
            stage_counts[stage] += 1
            total_score += STAGE_WEIGHTS[stage]

    # Normalize
    total_score = min(total_score, 1.0)

    # Escalation logic
    escalation_flag = (
        stage_counts["secrecy"] > 0 and
        stage_counts["isolation"] > 0 and
        stage_counts["escalation"] > 0
    )

    is_grooming = total_score >= 0.6 or escalation_flag

    return {
        "score": total_score,
        "is_grooming": is_grooming,
        "stages_detected": dict(stage_counts),
        "escalation_flag": escalation_flag
    }
    