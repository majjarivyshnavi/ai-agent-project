from fastapi import APIRouter, HTTPException, UploadFile, File
import uuid
import os
from voice_utils import transcribe_audio, classify_intent
from product_utils import categorize_product_ai
from transformers import pipeline
import shutil
router = APIRouter()

@router.post("/transcribe-command")
async def transcribe_command(file: UploadFile = File(...)):
    if not os.path.exists("uploads"):
        os.makedirs("uploads")

    ext=os.path.splitext(file.filename)[1] or ".webm"
    temp_filename = f"cmd_{uuid.uuid4()}{ext}"
    file_path = os.path.join("uploads", temp_filename)
    
    try:
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
            
        trans_result = transcribe_audio(file_path)
        if "error" in trans_result:
            raise HTTPException(status_code=500, detail=trans_result["error"])
            
        text = trans_result["text"]
        intent_result = classify_intent(text)
        
        return {
            "transcript": text,
            "intent": intent_result["intent"] if intent_result else "unknown",
            "confidence": intent_result["confidence"] if intent_result else 0.0
        }
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

@router.post("/transcribe")
async def transcribe_voice(file: UploadFile = File(...)):
    if not os.path.exists("uploads"):
        os.makedirs("uploads")

    ext=os.path.splitext(file.filename)[1] or ".webm"    
    temp_filename = f"voice_{uuid.uuid4()}{ext}"
    file_path = os.path.join("uploads", temp_filename)
    
    try:
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
            
        result = transcribe_audio(file_path)
        if "error" in result:
            raise HTTPException(status_code=500, detail=result["error"])
            
        return {"transcript": result["text"]}
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)
