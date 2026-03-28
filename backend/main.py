import os
import google.generativeai as genai
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import models
from database import engine, Base
from routers import (
    mse_onboarding,
    transaction_ledger,
    products,
    snps,
    matching,
    analytics,
    claims,
    documents,
    conflicts,
    partnerships,
    notifications,
    system_logs,
    auth,
    ai,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI-Driven MSE Onboarding and Strategic Partner Mapping Ecosystem API")

# Gemini setup
GENAI_API_KEY = os.getenv("GENAI_API_KEY", "")
if GENAI_API_KEY:
    genai.configure(api_key=GENAI_API_KEY)
    model = genai.GenerativeModel("gemini-1.5-flash")
else:
    model = None

class ChatRequest(BaseModel):
    message: str

@app.post("/ai")
async def chat(request: ChatRequest):
    try:
        if not model:
            return {"reply": "GENAI_API_KEY is not configured in the environment."}

        response = model.generate_content(request.message)
        return {"reply": response.text}
    except Exception as e:
        print("ERROR:", str(e))
        return {"reply": str(e)}

# CORS
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
)
allowed_origins = [origin.strip() for origin in CORS_ORIGINS.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def cors_on_server_errors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        print("Unhandled server error:", str(e))
        origin = request.headers.get("origin", "")
        headers = {}
        if origin and (origin in allowed_origins or "*" in allowed_origins):
            headers["Access-Control-Allow-Origin"] = origin
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
            headers=headers,
        )

@app.on_event("startup")
async def startup_event():
    print("Application started successfully")

# API routes
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

@app.get("/health")
def health_check():
    return {"status": "ok"}

# ---------- Frontend static hosting ----------
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST_DIR = BASE_DIR / "frontend_dist"

if FRONTEND_DIST_DIR.exists():
    assets_dir = FRONTEND_DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    public_files = ["vite.svg", "logo.svg"]
    for file_name in public_files:
        file_path = FRONTEND_DIST_DIR / file_name
        if file_path.exists():
            @app.get(f"/{file_name}")
            async def serve_public_file(file_name=file_name):
                return FileResponse(str(FRONTEND_DIST_DIR / file_name))

@app.get("/")
def read_root():
    index_file = FRONTEND_DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "Welcome to the AI-Driven MSE Onboarding and Strategic Partner Mapping Ecosystem API"}

# SPA fallback route
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    # Don't intercept API/docs/openapi routes
    blocked_prefixes = ("api/", "docs", "openapi.json", "redoc")
    if full_path.startswith(blocked_prefixes):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})

    target_file = FRONTEND_DIST_DIR / full_path
    index_file = FRONTEND_DIST_DIR / "index.html"

    if target_file.exists() and target_file.is_file():
        return FileResponse(str(target_file))

    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse(status_code=404, content={"detail": "Frontend build not found"})