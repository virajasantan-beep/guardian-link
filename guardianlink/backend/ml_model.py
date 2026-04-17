"""
ml_model.py  –  Guardian Link
Lightweight risk scorer for text messages.

Fixes vs previous version:
  * The old threshold (0.7) required TWO risky words to fire — most single-
    risky messages silently scored below threshold. Lowered to 0.4 so any
    single clear risk signal trips is_risky=True.
  * The old 3-word list ("alone", "secret", "photo") missed most grooming
    vocabulary. Expanded to match the phrases grooming_detector.py already
    recognises.
  * Score could exceed 1.0. Now clamped to [0.0, 1.0].
  * Uses word-boundary matching for single words so "alone" doesn't
    accidentally fire on "loneliness". Multi-word phrases are matched as
    substrings because that's the sensible thing for short phrases.
"""

import re


# Risk vocabularies, aligned with grooming_detector.GROOMING_PATTERNS so the
# two modules agree on what counts as risky.

_HIGH_RISK_PHRASES = [
    # Escalation stage
    "send me a photo", "send pic", "send nude", "send nudes",
    "meet me", "come alone", "video call me",
    # Secrecy
    "don't tell anyone", "dont tell anyone", "keep this secret",
    "this is between us", "our secret",
    # Control
    "delete this", "delete the chat", "don't talk to others",
    "only talk to me",
]

_MEDIUM_RISK_PHRASES = [
    # Isolation
    "are you alone", "where are your parents", "is anyone with you",
    "home alone",
    # Trust-building
    "trust me", "i care about you", "only i understand you",
    "i understand you",
]

# Single words that are suspicious on their own (word-boundary matched).
_RISKY_WORDS= [
    "trust me",
    "don't tell anyone",
    "secret",
    "keep this secret",
    "are you alone",
    "alone right now",
    "talk privately",
    "private chat",
    "send me a photo",
    "send a selfie",
    "send your picture",
    "what are you wearing",
    "share this chat",
    "don't share this",
    "tell me your address",
    "where you live",
    "your address",
    "send me your number",
    "phone number",
    "personal details",
    "something personal",
    "know your secrets",
    "your secrets",
    "meet you alone",
    "meet in private",
    "late at night",
    "talk late night",
    "don't tell your parents",
    "don't block me",
    "please don't ignore me",
    "i feel lonely",
    "i feel close to you",
    "trust you with a secret",
    "keep this between us",
    "promise i won't tell",
    "stay online",
    "reply fast",
    "send something private"
]


def _contains_word(word, text):
    """Match a single word on word boundaries so 'alone' != 'loneliness'."""
    return re.search(rf"\b{re.escape(word)}\b", text) is not None


def analyze_risk(text):
    """
    Score a message for risk.

    Returns
    -------
    tuple (float, bool)
        score    : 0.0 .. 1.0
        is_risky : True iff score >= 0.4
    """
    if not text:
        return 0.0, False

    t = text.lower()
    score = 0.1                           # baseline — nothing is ever 0

    # High-risk phrase: single hit is already enough (+0.6)
    for phrase in _HIGH_RISK_PHRASES:
        if phrase in t:
            score += 0.6
            break                         # don't double-count

    # Medium-risk phrase (+0.4)
    for phrase in _MEDIUM_RISK_PHRASES:
        if phrase in t:
            score += 0.4
            break

    # Single risky words (+0.25 each, capped at 0.5 total)
    word_hits = sum(1 for w in _RISKY_WORDS if _contains_word(w, t))
    score += min(word_hits * 0.25, 0.5)

    # Clamp
    score = max(0.0, min(1.0, score))

    # Threshold: any single clear signal now trips is_risky.
    # 0.4 chosen so a single medium-risk phrase (0.1 + 0.4 = 0.5) fires,
    # while one mildly-risky word alone (0.1 + 0.25 = 0.35) does not.
    return score, score >= 0.4
