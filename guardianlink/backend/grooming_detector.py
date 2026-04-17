"""
grooming_detector.py  –  Guardian Link

BUGS FIXED vs original:
  1. Stage double-counting: detect_patterns() returned one entry per
     matching phrase. A message with two phrases from the same stage
     counted that stage twice. Fixed: each stage is detected at most once
     per message (break after first hit).

  2. escalation_flag formula too strict: required secrecy + isolation +
     escalation all > 0. A predator who goes trust → isolation → secrecy
     (classic 3-stage grooming) never tripped the flag, nor did one who
     sent "send me a photo, our secret" without an explicit isolation line.
     Fixed: flag fires on any TWO of the high-risk trio (isolation,
     secrecy, escalation) OR all three of the original combo.

  3. calculate_grooming_score() failed on dict inputs (dict has no
     .lower()). utils.py currently passes strings, but fixed defensively.
"""

from collections import defaultdict

# ── Grooming stage patterns ────────────────────────────────────────────────

GROOMING_PATTERNS = {
    "trust": [
        "trust me", "i care about you", "i understand you",
        "only i understand you", "i understand you better",
        "you can trust",
    ],
    "isolation": [
        "are you alone", "where are your parents",
        "is anyone with you", "home alone", "when no one is around",
        "no one around", "when no one",
    ],
    "secrecy": [
        "don't tell anyone", "dont tell anyone", "keep this secret",
        "this is between us", "our secret", "delete this",
        "delete the chat", "delete this chat",
    ],
    "control": [
        "don't talk to others", "dont talk to others",
        "only talk to me", "don't talk to anyone else",
        "only talk to",
    ],
    "escalation": [
        "send me a photo", "send pic", "send nude", "send nudes",
        "meet me", "come alone", "video call me", "video call",
    ],
}

STAGE_WEIGHTS = {
    "trust":      0.2,
    "isolation":  0.3,
    "secrecy":    0.5,
    "control":    0.5,
    "escalation": 0.8,
}


def detect_patterns(text: str) -> list[str]:
    """
    Return a deduplicated list of stage names found in text.
    Each stage appears at most once regardless of how many of its
    phrases appear in the message.
    """
    text_lower = text.lower()
    detected = []
    for stage, phrases in GROOMING_PATTERNS.items():
        for phrase in phrases:
            if phrase in text_lower:
                detected.append(stage)
                break   # BUG FIX 1: only count each stage once per message
    return detected


def calculate_grooming_score(messages: list) -> dict:
    """
    Score a conversation (list of str or dict) for grooming signals.

    escalation_flag fires when ANY TWO of {isolation, secrecy, escalation}
    are present in the conversation, OR the classic all-three combo.
    This covers:
      - Classic full-cycle: trust → isolation → secrecy → escalation
      - Secrecy + escalation: "send me a photo / our secret"
      - Isolation + escalation: "are you alone? / video call me"
      - Isolation + secrecy alone (trust-building then secrecy, no photo yet)
    """
    stage_counts: dict[str, int] = defaultdict(int)
    total_score = 0.0

    for item in messages:
        # BUG FIX 3: accept both str and dict
        text = item.get("message", "") if isinstance(item, dict) else str(item)

        detected = detect_patterns(text)
        for stage in detected:
            stage_counts[stage] += 1
            total_score += STAGE_WEIGHTS[stage]

    total_score = min(round(total_score, 4), 1.0)

    has_escalation = stage_counts["escalation"] > 0
    has_secrecy    = stage_counts["secrecy"]    > 0
    has_isolation  = stage_counts["isolation"]  > 0

    # BUG FIX 2: any two of the high-risk trio triggers the flag
    high_risk_count = sum([has_escalation, has_secrecy, has_isolation])
    escalation_flag = high_risk_count >= 2

    is_grooming = total_score >= 0.5 or escalation_flag

    return {
        "score":           total_score,
        "is_grooming":     is_grooming,
        "stages_detected": dict(stage_counts),
        "escalation_flag": escalation_flag,
    }
