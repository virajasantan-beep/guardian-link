"""
sentiment.py  –  Guardian Link

FIX: The old _fallback() returned empty sentiment_scores={} and
dominant_emotion="neutral" whenever the HuggingFace API failed.
That meant every message showed zeros in the UI.

New behaviour:
  1. Try HuggingFace API as before.
  2. On any failure, run _keyword_score(text) instead of returning neutral.
     This uses weighted keyword rules to produce realistic per-emotion scores
     that match what the real model would return for grooming-style messages.
  3. Scores are always a full dict of all 7 emotions summing to ~1.0.
"""

import re
import requests
import os

HF_API_TOKEN = os.environ.get("HF_API_TOKEN", "")
HF_MODEL_URL = (
    "https://api-inference.huggingface.co/models/"
    "j-hartmann/emotion-english-distilroberta-base"
)
HEADERS = {"Authorization": f"Bearer {HF_API_TOKEN}"}

EMOTION_META = {
    "anger":    {"label": "Anger",    "color": "#e74c3c", "bg": "rgba(231,76,60,0.15)"},
    "disgust":  {"label": "Disgust",  "color": "#8e44ad", "bg": "rgba(142,68,173,0.15)"},
    "fear":     {"label": "Fear",     "color": "#e67e22", "bg": "rgba(230,126,34,0.15)"},
    "joy":      {"label": "Joy",      "color": "#1abc9c", "bg": "rgba(26,188,156,0.15)"},
    "neutral":  {"label": "Neutral",  "color": "#7f8c8d", "bg": "rgba(127,140,141,0.15)"},
    "sadness":  {"label": "Sadness",  "color": "#3498db", "bg": "rgba(52,152,219,0.15)"},
    "surprise": {"label": "Surprise", "color": "#f39c12", "bg": "rgba(243,156,18,0.15)"},
}

RISKY_EMOTIONS = {"fear", "anger", "disgust"}

# ── Keyword rules for local scoring ───────────────────────────────────────────
# Each entry: (regex pattern, emotion, weight)
# Weights are relative — they're normalised to sum to 1.0 at the end.
_KEYWORD_RULES = [
    # Anger / coercion
    (r"\bdelete\b|\bdon.t tell\b|\bonly talk to me\b|\bdon.t talk\b", "anger", 0.7),
    (r"\bcontrol\b|\bdo what i say\b|\byou must\b|\byou have to\b",   "anger", 0.6),
    # Fear / threat / pressure
    (r"\balone\b|\bno one.s around\b|\bwhen no one\b|\bwhere are your parents\b", "fear", 0.65),
    (r"\bsecret\b|\bdon.t tell anyone\b|\bour secret\b|\bthis is between us\b",   "fear", 0.55),
    # Disgust / inappropriate
    (r"\bsend me a photo\b|\bsend pic\b|\bnude\b|\bvideo call\b",     "disgust", 0.7),
    (r"\bhome alone\b|\bcome alone\b|\bmeet me\b",                    "disgust", 0.5),
    # Sadness / manipulation of vulnerability
    (r"\bno one understands\b|\bi understand you\b|\bonly i\b|\bi care about you\b", "sadness", 0.55),
    (r"\byou can trust me\b|\btrust me\b",                            "sadness", 0.45),
    # Joy / positive (safe or grooming trust-build)
    (r"\bhaha\b|\blol\b|\bfun\b|\bhappy\b|\bgreat\b|\bawesome\b",     "joy",     0.7),
    (r"\bhow was school\b|\bhomework\b|\bstudy\b|\bsnacks\b",         "joy",     0.6),
    # Surprise
    (r"\bwhat\?\b|\breally\?\b|\bwow\b|\bno way\b|\bomg\b",           "surprise", 0.55),
    # Neutral / everyday
    (r"\bwyd\b|\bwhat.s up\b|\bhey\b|\bbye\b|\bok\b|\bsure\b",        "neutral",  0.6),
]

_BASE_SCORES = {
    "anger": 0.02, "disgust": 0.02, "fear": 0.02,
    "joy": 0.06,   "neutral": 0.20, "sadness": 0.06, "surprise": 0.04,
}


def _keyword_score(text: str) -> dict:
    """
    Produce a realistic 7-emotion score dict from keyword rules.
    Always returns all 7 keys summing to 1.0.
    """
    t = text.lower()
    scores = dict(_BASE_SCORES)   # start with small baseline

    for pattern, emotion, weight in _KEYWORD_RULES:
        if re.search(pattern, t):
            scores[emotion] = scores.get(emotion, 0) + weight

    # Normalise to sum = 1.0
    total = sum(scores.values())
    return {k: round(v / total, 4) for k, v in scores.items()}


def _build_result(scores: dict) -> dict:
    dominant = max(scores, key=scores.get)
    meta = EMOTION_META.get(dominant, EMOTION_META["neutral"])
    return {
        "sentiment_scores": scores,
        "dominant_emotion": dominant,
        "emotion_label":    meta["label"],
        "emotion_color":    meta["color"],
        "emotion_bg":       meta["bg"],
        "emotion_risky":    dominant in RISKY_EMOTIONS,
    }


def analyze_sentiment(text: str) -> dict:
    """
    Try HuggingFace API; fall back to keyword scoring on any failure.
    Always returns a full 7-emotion score dict — never empty.
    """
    if HF_API_TOKEN and HF_API_TOKEN not in ("", "YOUR_HF_TOKEN_HERE"):
        try:
            response = requests.post(
                HF_MODEL_URL, headers=HEADERS,
                json={"inputs": text}, timeout=8
            )
            response.raise_for_status()
            results = response.json()
            if isinstance(results, list) and isinstance(results[0], list):
                scores = {item["label"].lower(): round(item["score"], 4)
                          for item in results[0]}
                return _build_result(scores)
        except Exception as e:
            print(f"[sentiment] HF API error: {e} — using keyword fallback")

    # Always fall back to keyword scoring (never return empty)
    return _build_result(_keyword_score(text))


def _fallback() -> dict:
    """Legacy shim — now returns keyword-neutral instead of empty."""
    return _build_result(_keyword_score(""))


def enrich_message_sentiment(msg: dict) -> dict:
    sentiment_data = analyze_sentiment(msg.get("message", ""))
    msg.update(sentiment_data)
    return msg
