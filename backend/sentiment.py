import requests
import os

# ── CONFIG ──────────────────────────────────────────────────────────────────
HF_API_TOKEN = os.environ.get("HF_API_TOKEN", "YOUR_HF_TOKEN_HERE")
HF_MODEL_URL = (
    "https://api-inference.huggingface.co/models/"
    "j-hartmann/emotion-english-distilroberta-base"
)

HEADERS = {"Authorization": f"Bearer {HF_API_TOKEN}"}

# Maps model emotion labels → display-friendly names + badge colours
EMOTION_META = {
    "anger":    {"label": "Anger",        "color": "#e74c3c", "bg": "rgba(231,76,60,0.15)"},
    "disgust":  {"label": "Disgust",      "color": "#8e44ad", "bg": "rgba(142,68,173,0.15)"},
    "fear":     {"label": "Fear",         "color": "#e67e22", "bg": "rgba(230,126,34,0.15)"},
    "joy":      {"label": "Joy",          "color": "#1abc9c", "bg": "rgba(26,188,156,0.15)"},
    "neutral":  {"label": "Neutral",      "color": "#7f8c8d", "bg": "rgba(127,140,141,0.15)"},
    "sadness":  {"label": "Sadness",      "color": "#3498db", "bg": "rgba(52,152,219,0.15)"},
    "surprise": {"label": "Surprise",     "color": "#f39c12", "bg": "rgba(243,156,18,0.15)"},
}

# Emotions that indicate potential manipulation / grooming tactics
RISKY_EMOTIONS = {"fear", "anger", "disgust"}


def analyze_sentiment(text: str) -> dict:
    """
    Calls HuggingFace emotion classifier on a single message text.
    Returns a dict ready to be merged into the message object.

    Return shape:
    {
        "sentiment_scores": {"joy": 0.9, "neutral": 0.05, ...},
        "dominant_emotion": "joy",
        "emotion_label":    "Joy",
        "emotion_color":    "#1abc9c",
        "emotion_bg":       "rgba(26,188,156,0.15)",
        "emotion_risky":    False
    }
    On API error, returns safe fallback values so the rest of the pipeline
    is never blocked.
    """
    try:
        response = requests.post(
            HF_MODEL_URL,
            headers=HEADERS,
            json={"inputs": text},
            timeout=8
        )
        response.raise_for_status()
        results = response.json()

        # HF returns [[{label, score}, ...]]
        if isinstance(results, list) and isinstance(results[0], list):
            scores = {item["label"].lower(): round(item["score"], 4)
                      for item in results[0]}
        else:
            return _fallback()

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

    except Exception as e:
        print(f"[sentiment] API error: {e}")
        return _fallback()


def _fallback() -> dict:
    """Returns a neutral fallback so the pipeline never breaks."""
    meta = EMOTION_META["neutral"]
    return {
        "sentiment_scores": {},
        "dominant_emotion": "neutral",
        "emotion_label":    meta["label"],
        "emotion_color":    meta["color"],
        "emotion_bg":       meta["bg"],
        "emotion_risky":    False,
    }


def enrich_message_sentiment(msg: dict) -> dict:
    """
    Convenience wrapper: enriches a message dict in-place and returns it.
    Call this AFTER process_message_with_context() in utils.py — or wire it
    into the new utils_extended.py (see that file).

    Usage:
        from sentiment import enrich_message_sentiment
        msg = enrich_message_sentiment(msg)
    """
    sentiment_data = analyze_sentiment(msg.get("message", ""))
    msg.update(sentiment_data)
    return msg
