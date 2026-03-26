#from transformers import pipeline  # ← Already commented
import os
# import torch                        # ← ADD #
# import numpy as np                  # ← ADD #
import librosa
import soundfile as sf
from product_utils import get_classifier

_asr_pipeline = None

def get_asr_model():
    global _asr_pipeline
    if _asr_pipeline is None:
        try:
            print("ASR model disabled for production")
            return None  # ← CHANGE ee line
        except Exception as e:
            print(f"Error loading ASR model: {e}")
    return _asr_pipeline

def transcribe_audio(audio_path: str):
    return {"text": "Audio transcription disabled", "chunks": []}  # ← REPLACE entire function

def classify_intent(text: str):
    # Simple keyword matching only (no ML)
    text = text.lower().strip()
    keywords = {
        "go to ledger": ["ledger", "khata"],
        "go to dashboard": ["home", "dashboard"],
        "go to product catalog": ["product", "catalog"],
        "unknown": []  # default
    }
    
    for intent, keys in keywords.items():
        if any(k in text for k in keys):
            return {"intent": intent, "confidence": 1.0}
    
    return {"intent": "unknown", "confidence": 0.0}  # ← REPLACE entire function