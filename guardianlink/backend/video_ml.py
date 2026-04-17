"""
video_ml.py  –  Guardian Link
ML pipeline for video-chunk risk detection.

Design notes
------------
* This module is intentionally framework-agnostic — it exposes `analyze_chunk()`
  which takes raw chunk bytes + metadata and returns a structured risk report.
* The actual model is pluggable. We ship a `HeuristicDetector` (no external
  weights, fast, CPU-only) so the pipeline runs out of the box. You can swap
  in a real torch/onnx model by implementing the `BaseDetector` interface.
* Frame decoding uses OpenCV. If OpenCV cannot decode a chunk (common for
  webm/opus streams where the first chunk lacks a keyframe), we fail softly
  and return a low-confidence "indeterminate" score rather than crashing.
* Everything here is synchronous and pure — concurrency is handled by the
  caller (the Flask route / SocketIO handler runs this in a thread).
"""

from __future__ import annotations

import io
import os
import tempfile
import time
from dataclasses import dataclass, field, asdict
from typing import List, Optional

import numpy as np

# OpenCV is optional at import time — we degrade gracefully.
try:
    import cv2
    _CV2_OK = True
except Exception:                                         # pragma: no cover
    cv2 = None
    _CV2_OK = False


# ─────────────────────────────────────────────────────────────────────────────
#  Data contracts
# ─────────────────────────────────────────────────────────────────────────────

THREAT_TYPES = ("none", "grooming", "explicit", "unknown_face", "abnormal")


@dataclass
class RiskReport:
    """What analyze_chunk() returns."""
    risk_score: int                     # 0-100
    threat_type: str                    # one of THREAT_TYPES
    confidence: float                   # 0.0-1.0
    frames_analyzed: int
    processing_ms: int
    reasons: List[str] = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def level(self) -> str:
        if self.risk_score >= 75:
            return "HIGH"
        if self.risk_score >= 40:
            return "MEDIUM"
        return "LOW"


# ─────────────────────────────────────────────────────────────────────────────
#  Frame decoding
# ─────────────────────────────────────────────────────────────────────────────

def _decode_chunk_to_frames(
    chunk_bytes: bytes,
    max_frames: int = 5,
) -> List[np.ndarray]:
    """
    Decode a raw video chunk (webm/mp4/etc) into a list of BGR frames.

    Browser MediaRecorder produces webm with vp8/vp9. OpenCV needs a file
    path, so we write the chunk to a tempfile and let ffmpeg (bundled with
    opencv-python) handle container parsing.

    Returns [] on any failure — callers must handle empty lists.
    """
    if not _CV2_OK or not chunk_bytes:
        return []

    tmp_path = None
    try:
        # Write to a tempfile (OpenCV can't read from a BytesIO directly).
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            tmp.write(chunk_bytes)
            tmp_path = tmp.name

        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            return []

        frames: List[np.ndarray] = []
        # Sample up to max_frames evenly from the chunk.
        while len(frames) < max_frames:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)

        cap.release()
        return frames

    except Exception:
        return []

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ─────────────────────────────────────────────────────────────────────────────
#  Detector interface + default heuristic implementation
# ─────────────────────────────────────────────────────────────────────────────

class BaseDetector:
    """Interface. Implement `score(frames)` → RiskReport-compatible dict."""

    name: str = "base"

    def score(self, frames: List[np.ndarray]) -> dict:
        raise NotImplementedError


class HeuristicDetector(BaseDetector):
    """
    Lightweight, dependency-free detector used as the default.

    Heuristics (illustrative — replace with a trained model in production):
      1. Very dark frames for a sustained period → possible occlusion /
         concealment (bumps score).
      2. Very low motion (frame-to-frame delta) for multiple chunks → the
         user may have walked away or been restrained (bumps score mildly).
      3. High motion + high skin-tone ratio → flagged as potential explicit
         content (placeholder — a real NSFW classifier belongs here).
      4. Face-cascade hit count (if available) → used for "unknown face"
         flagging in conjunction with the optional face-recognition stub.

    All of these are intentionally crude. The point is to show the shape of
    the output and give the UI something to react to; swap in a real model
    without changing any other file.
    """

    name = "heuristic_v1"

    # Optional Haar cascade for face detection — loaded lazily.
    _face_cascade = None

    def _get_face_cascade(self):
        if not _CV2_OK:
            return None
        if self._face_cascade is None:
            try:
                xml = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
                self._face_cascade = cv2.CascadeClassifier(xml)
            except Exception:
                self._face_cascade = False      # sentinel: tried and failed
        return self._face_cascade or None

    def score(self, frames: List[np.ndarray]) -> dict:
        if not frames:
            return {
                "risk_score": 5,
                "threat_type": "none",
                "confidence": 0.2,
                "reasons": ["no_frames_decoded"],
            }

        reasons: List[str] = []
        score = 10.0                # baseline — nothing is ever 0
        threat_type = "none"

        # ── 1. Brightness analysis ───────────────────────────────────
        brightness_vals = [float(np.mean(f)) for f in frames]
        avg_brightness = float(np.mean(brightness_vals))
        if avg_brightness < 25:
            score += 25
            reasons.append("very_dark_frames")
            threat_type = "abnormal"

        # ── 2. Motion analysis ───────────────────────────────────────
        motion = 0.0
        if len(frames) >= 2:
            diffs = []
            for a, b in zip(frames[:-1], frames[1:]):
                if a.shape == b.shape:
                    diffs.append(float(np.mean(cv2.absdiff(a, b)))
                                 if _CV2_OK else float(np.mean(np.abs(a - b))))
            motion = float(np.mean(diffs)) if diffs else 0.0

        if motion < 0.5:
            score += 5
            reasons.append("low_motion")
        elif motion > 30:
            score += 10
            reasons.append("high_motion")

        # ── 3. Skin-tone ratio (very rough NSFW signal) ──────────────
        #     Only meaningful as a *combined* signal with high motion.
        if _CV2_OK:
            skin_ratios = []
            for f in frames:
                hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
                lo = np.array([0,  40, 60], dtype=np.uint8)
                hi = np.array([25, 180, 255], dtype=np.uint8)
                mask = cv2.inRange(hsv, lo, hi)
                skin_ratios.append(float(np.mean(mask > 0)))
            skin = float(np.mean(skin_ratios))
            if skin > 0.35 and motion > 10:
                score += 35
                reasons.append("high_skin_tone_with_motion")
                threat_type = "explicit"

        # ── 4. Face count ────────────────────────────────────────────
        faces_seen = 0
        cascade = self._get_face_cascade()
        if cascade is not None:
            for f in frames:
                gray = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
                rects = cascade.detectMultiScale(gray, 1.3, 5)
                faces_seen = max(faces_seen, len(rects))
            if faces_seen >= 2:
                score += 10
                reasons.append(f"multiple_faces_detected:{faces_seen}")
            elif faces_seen == 1:
                reasons.append("single_face_detected")

        # ── Optional face-recognition stub ───────────────────────────
        # If a real face_recognition model is plugged in, it can flip
        # threat_type → "unknown_face" here. Left as a documented hook.

        score = int(max(0, min(100, round(score))))
        confidence = 0.5 + min(len(reasons) * 0.08, 0.4)

        return {
            "risk_score": score,
            "threat_type": threat_type,
            "confidence": round(confidence, 2),
            "reasons": reasons,
        }


# ─────────────────────────────────────────────────────────────────────────────
#  Public entry point
# ─────────────────────────────────────────────────────────────────────────────

# Singleton detector. Replace this line to swap models.
_DETECTOR: BaseDetector = HeuristicDetector()


def set_detector(detector: BaseDetector) -> None:
    """Swap the active detector at runtime (e.g. in tests)."""
    global _DETECTOR
    _DETECTOR = detector


def analyze_chunk(chunk_bytes: bytes, *, source: str = "camera") -> RiskReport:
    """
    Main entry point. Decodes a chunk and runs the active detector.

    Parameters
    ----------
    chunk_bytes : bytes
        Raw bytes of one MediaRecorder chunk (webm/mp4).
    source : str
        "camera" | "screen"  — currently used only for reason-tagging, but
        lets a future model weight sources differently.

    Returns
    -------
    RiskReport
    """
    t0 = time.perf_counter()
    frames = _decode_chunk_to_frames(chunk_bytes)
    result = _DETECTOR.score(frames)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    reasons = result.get("reasons", [])
    reasons.append(f"source:{source}")
    reasons.append(f"detector:{_DETECTOR.name}")

    return RiskReport(
        risk_score=int(result["risk_score"]),
        threat_type=str(result.get("threat_type", "none")),
        confidence=float(result.get("confidence", 0.5)),
        frames_analyzed=len(frames),
        processing_ms=elapsed_ms,
        reasons=reasons,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Optional: session-level smoothing / escalation
# ─────────────────────────────────────────────────────────────────────────────

class SessionRiskTracker:
    """
    Per-session rolling state. Smooths spiky per-chunk scores with an
    EMA and escalates threat level when several consecutive chunks come
    back HIGH.

    Use one instance per session_id.
    """

    EMA_ALPHA = 0.4
    HIGH_THRESHOLD = 75
    ESCALATE_AFTER = 3          # N consecutive HIGHs → escalate

    def __init__(self) -> None:
        self.ema_score: float = 0.0
        self.consecutive_high: int = 0
        self.reports: List[RiskReport] = []

    def update(self, report: RiskReport) -> dict:
        self.reports.append(report)
        if len(self.reports) > 50:
            self.reports.pop(0)

        self.ema_score = (
            self.EMA_ALPHA * report.risk_score
            + (1 - self.EMA_ALPHA) * self.ema_score
        )

        if report.risk_score >= self.HIGH_THRESHOLD:
            self.consecutive_high += 1
        else:
            self.consecutive_high = 0

        escalate = self.consecutive_high >= self.ESCALATE_AFTER
        smoothed = int(round(self.ema_score))
        level = (
            "HIGH"   if smoothed >= 75 else
            "MEDIUM" if smoothed >= 40 else
            "LOW"
        )

        return {
            "smoothed_score": smoothed,
            "instant_score":  report.risk_score,
            "level":          level,
            "escalate":       escalate,
            "threat_type":    report.threat_type,
            "confidence":     report.confidence,
            "reasons":        report.reasons,
            "frames":         report.frames_analyzed,
            "processing_ms":  report.processing_ms,
        }
