#from transformers import pipeline
import os
#import torch
#import numpy as np
import librosa
import soundfile as sf
from product_utils import get_classifier

_asr_pipeline = None

def get_asr_model():
    global _asr_pipeline
    if _asr_pipeline is None:
        try:
            print("Loading ASR Model (Whisper)...")
            _asr_pipeline = pipeline(
                "automatic-speech-recognition",
                model="openai/whisper-tiny",
                chunk_length_s=30,
                device="cuda" if torch.cuda.is_available() else "cpu"
            )
        except Exception as e:
            print(f"Error loading ASR model: {e}")
    return _asr_pipeline

def transcribe_audio(audio_path: str):
    asr_pipeline = get_asr_model()
    if asr_pipeline is None:
        return {"error": "ASR model not loaded"}

    if not os.path.exists(audio_path):
        return {"error": "Audio file not found"}

    try:
        audio_data, samplerate = sf.read(audio_path)
        if samplerate != 16000:
            audio_data = librosa.resample(audio_data, orig_sr=samplerate, target_sr=16000)
        
        result = asr_pipeline(audio_data)
        return {"text": result["text"], "chunks": result.get("chunks", [])}
    except Exception as e:
        print(f"Transcription Error: {e}")
        return {"error": str(e)}

def classify_intent(text: str):
    text = text.lower().strip()
    keywords = {
        "go to ledger": ["ledger", "khata", "accounts", "बही", "లెడ్జర్", "లేజర్", "பேரேடு"],
        "go to matching partners": ["partner", "match", "साझेदार", "భాగస్వామి", "অংশীদার"],
        "go to dashboard": ["home", "dashboard", "मख्य", "హోమ్", "হোম"],
        "go to product catalog": ["product", "catalog", "सूची", "కేటలాగ్", "পণ্য"],
        "go to network snps": ["snp", "network", "नेटवर्क", "నెట్‌వర్క్", "নেটওয়ার্ক"],
        "change language to hindi": ["hindi", "हिंदी"],
        "change language to english": ["english", "अंग्रेजी"],
        "change language to tamil": ["tamil", "तमिल", "தமிழ்"],
        "change language to telugu": ["telugu", "तेलुगु", "తెలుగు"]
    }

    for intent, keys in keywords.items():
        if any(k in text for k in keys):
            return {"intent": intent, "confidence": 1.0}

    classifier = get_classifier()
    if classifier is None:
        return {"intent": "unknown", "confidence": 0.0}

    try:
        candidate_labels = list(keywords.keys())
        result = classifier(text, candidate_labels, multi_label=False)
        return {"intent": result['labels'][0], "confidence": result['scores'][0]}
    except Exception as e:
        print(f"Intent Classification Error: {e}")
        return {"intent": "unknown", "confidence": 0.0}
 