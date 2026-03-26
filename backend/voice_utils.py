# Lightweight version for production deploy
import os

def transcribe_audio(audio_path: str):
    """Disabled for Render free tier - returns mock response"""
    return {"text": "Audio processing disabled (add ML later)", "chunks": []}

def classify_intent(text: str):
    """Simple keyword intent classification"""
    text = text.lower().strip()
    keywords = {
        "go to ledger": ["ledger", "khata", "accounts"],
        "go to dashboard": ["home", "dashboard"],
        "go to product catalog": ["product", "catalog"],
        "go to network snps": ["snp", "network"],
        "unknown": []
    }
    
    for intent, keys in keywords.items():
        if any(k in text for k in keys):
            return {"intent": intent, "confidence": 1.0}
    
    return {"intent": "unknown", "confidence": 0.0}