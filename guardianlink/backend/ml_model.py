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

_RISKY_WORDS = [
    # secrecy / isolation
    "just between us",
    "keep this between you and me",
    "no one needs to know",
    "our little secret",
    "don't mention this",
    "hide this chat",
    "delete our messages",

    # moving to private platforms
    "let's move to whatsapp",
    "talk on telegram",
    "switch to private app",
    "this app is not safe",
    "come to dm",
    "check your inbox",
    "i messaged you privately",

    # personal info extraction
    "what school do you go to",
    "which city are you in",
    "where are you right now",
    "send your location",
    "drop your pin",
    "who do you live with",
    "are your parents home",
    "what's your routine",

    # emotional manipulation
    "you are special to me",
    "i feel connected to you",
    "only you understand me",
    "i trust you a lot",
    "you can trust me completely",
    "i care about you deeply",
    "you mean a lot to me",

    # urgency / pressure
    "answer me now",
    "why are you ignoring me",
    "reply quickly",
    "don't take too long",
    "i need you right now",
    "this is urgent",
    "respond asap",

    # guilt / dependency
    "i'll be sad if you don't reply",
    "you are the only one i have",
    "i feel empty without you",
    "don't leave me alone",
    "i need you to stay",
    "please stay with me",
    "i depend on you",

    # boundary pushing
    "be honest with me",
    "don't lie to me",
    "prove you trust me",
    "why are you shy",
    "you can tell me anything",
    "open up to me",
    "be real with me",

    # inappropriate curiosity
    "what are you doing right now",
    "what are you wearing now",
    "are you in your room",
    "are you in bed",
    "are you alone at home",
    "what time do you sleep",

    # image / media requests
    "send me a quick pic",
    "share your photo",
    "let me see you",
    "send live photo",
    "video call me now",
    "turn on your camera",
    "send me something",

    # meeting attempts
    "let's meet soon",
    "i want to see you in person",
    "come meet me",
    "we should hang out alone",
    "pick a place to meet",
    "i can come to you",
    "don't tell anyone we met",

    # reassurance (positive tone but risky intent)
    "i won't judge you",
    "you are safe with me",
    "i'll protect you",
    "nothing bad will happen",
    "you can rely on me",
    "i'm here for you always",
    "i'll keep you safe",

    # manipulation disguised as care
    "i'm just trying to help you",
    "this is for your good",
    "i care about your privacy",
    "others won't understand",
    "people might judge you",
    "trust me on this",

    # persistence / control
    "why did you stop replying",
    "come back online",
    "stay with me longer",
    "don't go offline",
    "talk to me more",
    "i'm waiting for you",

    # subtle grooming escalation
    "we are good friends now",
    "i feel close to you already",
    "you are different from others",
    "i like talking only to you",
    "you make me happy",
    "we have a connection",

    # compliance testing
    "do what i say",
    "just listen to me",
    "follow my instructions",
    "can you do me a favor",
    "promise me something",
    "swear you won't tell"
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
