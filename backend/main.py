import google.generativeai as genai 
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import models
from database import engine, Base, SessionLocal
from routers import mse_onboarding, transaction_ledger, products, snps, matching, analytics, claims, documents, conflicts, partnerships, notifications, system_logs, auth, ai
from sqlalchemy import text
from pydantic import BaseModel
Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI-Driven MSE Onboarding and Strategic Partner Mapping Ecosystem API")
genai.configure(api_key=os.getenv("GENAI_API_KEY"))
model = genai.GenerativeModel("gemini-pro")

class ChatRequest(BaseModel):
    message: str

@app.post("/ai")
async def chat(request: ChatRequest):
    try:
        print("user message:", request.message)#debug
        response=model.generate_content(request.message)
        print("AI response:", response)#debug
        return {
            "reply":response.text
        }
    except Exception as e:
        print("ERROR:", str(e))                  # DEBUG
        return {
            "reply": str(e)
        }

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure unhandled 500 errors still carry CORS headers so browsers surface the real error
@app.middleware("http")
async def cors_on_server_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        origin = request.headers.get("origin", "")
        allowed = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"]
        headers = {"Access-Control-Allow-Origin": origin if origin in allowed else ""} if origin in allowed else {}
        return JSONResponse(status_code=500, content={"detail": "Internal server error"}, headers=headers)

@app.on_event("startup")
async def startup_event():
    # Tables are created/migrated via standalone script for reliability
    pass

app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(snps.router, prefix="/api/v1/snps", tags=["SNP Management"])
app.include_router(matching.router, prefix="/api/v1/matching", tags=["Matching AI"])
app.include_router(products.router, prefix="/api/v1/products", tags=["Product Catalogue"])
app.include_router(mse_onboarding.router, prefix="/api/v1/mses", tags=["MSE Onboarding"])
app.include_router(ai.router, prefix="/api/v1/ai", tags=["AI Services"])
app.include_router(transaction_ledger.router, prefix="/api/v1/transactions", tags=["Transaction Ledger"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["Analytics"])
app.include_router(claims.router, prefix="/api/v1/claims", tags=["NSIC Claims"])
app.include_router(documents.router, prefix="/api/v1/documents", tags=["OCR Documents"])
app.include_router(conflicts.router, prefix="/api/v1/conflicts", tags=["Conflict Resolution"])
app.include_router(partnerships.router, prefix="/api/v1/partnerships", tags=["Partnership Management"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["In-App Notifications"])
app.include_router(system_logs.router, prefix="/api/v1", tags=["System Audit Logs"])

@app.get("/")
def read_root():
    return {"message": "Welcome to the AI-Driven MSE Onboarding and Strategic Partner Mapping Ecosystem API"}

from fastapi import Body


