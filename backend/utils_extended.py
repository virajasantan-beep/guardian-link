from utils import process_message_with_context          # original — untouched
from sentiment import enrich_message_sentiment          # NEW: HuggingFace emotion
from explainer import enrich_message_explanation        # NEW: Claude explanation
from children import get_child_display_name             # NEW: friendly name lookup


def process_message_full(msg: dict) -> dict:
    """
    Full enrichment pipeline:
      1. Original ML risk + grooming scoring  (utils.py — unchanged)
      2. Sentiment / emotion analysis          (sentiment.py)
      3. Plain-English risk explanation        (explainer.py)
      4. Child display name resolution         (children.py)

    Returns the enriched message dict.
    """
    # Step 1 — original pipeline (never modified)
    msg = process_message_with_context(msg)

    # Step 2 — emotion detection
    msg = enrich_message_sentiment(msg)

    # Step 3 — LLM explanation (only fires for flagged messages, saves API cost)
    msg = enrich_message_explanation(msg)

    # Step 4 — resolve sender_id to a guardian-set display name if available
    display = get_child_display_name(msg.get("sender_id", ""))
    msg["display_name"] = display or msg.get("sender_id", "unknown")

    return msg
