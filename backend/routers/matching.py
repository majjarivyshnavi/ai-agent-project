from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import models, schemas, auth
from database import get_db
import json
import logging
import re
from matching_utils import compute_semantic_similarity
from datetime import datetime
router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/{mse_id}", response_model=schemas.MatchingResponse, dependencies=[Depends(auth.RoleChecker(["mse", "nsic", "admin"]))])
def match_mse_to_snps(mse_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    # Ownership Check (UM-03)
    if current_user["role"] == "mse":
        target_mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
        if not target_mse or target_mse.email != current_user["email"]:
            raise HTTPException(status_code=403, detail="Not authorized to view matching for this MSE")
    
    mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
    if not mse:
        raise HTTPException(status_code=404, detail="MSE not found")
        
    products = db.query(models.Product).filter(models.Product.mse_id == mse_id).all()
    
    # 1. Build a semantic context of the MSE
    mse_text = f"{mse.sector} {mse.description}".lower()
    for p in products:
        mse_text += f" {p.product_name} {p.description}".lower()
    
    # Filter active SNPs with available capacity
    snps = db.query(models.SNP).filter(
        models.SNP.status == models.SNPStatus.active,
        models.SNP.current_load < models.SNP.capacity
    ).all()
    results = []

    for snp in snps:
        reasons = []
        
        # Signal 1: Category Fit (Semantic) - 35%
        # Use Hugging Face Sentence Transformer
        snp_text = f"{snp.type} {snp.supported_sectors}".lower()
        semantic_similarity = compute_semantic_similarity(mse_text, snp_text)
        
        # Normalize: similarity is 0.0-1.0, map to 0-35 points
        # boost the score slightly as raw cosine similarity can be conservative
        semantic_score = min(35.0, semantic_similarity * 35 * 1.5) 
        
        if semantic_score > 25: reasons.append("Elite Sector Alignment")
        elif semantic_score > 10: reasons.append("Sector Overlap")

        # Signal 2: Geo-proximity - 15%
        location_score = 0
        if snp.pincode_expertise:
            try:
                expert_pincodes = json.loads(snp.pincode_expertise)
                if mse.pincode in expert_pincodes:
                    location_score = 15
                    reasons.append("Hyper-local Edge Node")
            except Exception as e:
                logger.warning(
                    "Invalid SNP pincode_expertise JSON",
                    extra={"snp_id": snp.snp_id, "error": str(e), "value": snp.pincode_expertise}
                )
        if location_score == 0 and mse.city.lower() in snp.city.lower():
            location_score = 10
            reasons.append("City-level Proximity")

        # Signal 3: Capacity (Available vs Total) - 15%
        # Requirement: MATCH-02, capacity signals
        capacity_ratio = (snp.capacity - snp.current_load) / max(1, snp.capacity)
        capacity_score = max(0, capacity_ratio * 15)
        if capacity_ratio > 0.8: reasons.append("High Available Bandwidth")
        elif capacity_ratio < 0.2: reasons.append("Near Capacity (High Demand)")

        # Signal 4: Cost (Onboarding + Commission) - 15%
        # Lower fee/commission = higher score
        fee_impact = (snp.onboarding_fee / 5000) * 5 # Normalized against 5k base
        comm_impact = (snp.commission_rate / 15) * 10 # Normalized against 15% cap
        cost_score = max(0, 15 - (fee_impact + comm_impact))
        if snp.commission_rate <= 5.0: reasons.append("Economical Commission")

        # Signal 5: Historical Performance - 20%
        # Requirement: Settlement speed, Fulfillment reliability
        performance_score = ((snp.settlement_speed + snp.fulfillment_reliability) / 2) * 20
        if snp.fulfillment_reliability > 0.95: reasons.append("Top-tier Reliability")
        if snp.settlement_speed > 0.9: reasons.append("Rapid Settlement Cycle")

        # Composite Final Score
        final_score = semantic_score + location_score + capacity_score + cost_score + performance_score
        
        # Check for existing partnership
        partnership = db.query(models.Partnership).filter(
            models.Partnership.mse_id == mse_id,
            models.Partnership.snp_id == snp.snp_id
        ).first()

        if final_score > 0 or partnership:
            results.append({
                "snp_id": snp.snp_id,
                "snp_name": snp.name,
                "score": round(min(final_score, 100.0), 2),
                "reason": " • ".join(reasons) if reasons else "Network Standard",
                "partnership_status": partnership.status.value if partnership else None,
                "partnership_id": partnership.partnership_id if partnership else None,
                "mse_consent": partnership.mse_consent if partnership else False,
                "snp_consent": partnership.snp_consent if partnership else False
            })

    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)
    
    return {"matches": results}

@router.get("/{mse_id}/insights", dependencies=[Depends(auth.RoleChecker(["mse", "nsic", "admin"]))])
def get_mse_insights(mse_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
    if not mse:
        raise HTTPException(status_code=404, detail="MSE not found")
    
    products = db.query(models.Product).filter(models.Product.mse_id == mse_id).all()
    
    insights = []
    
    # Sector based strategic insight
    if mse.sector and "Handicrafts" in mse.sector:
        insights.append({
            "type": "expansion",
            "title": "Market Trend",
            "content": f"Handicraft demand in {mse.city} is up 15%. Your profile is highly competitive for the 'Varanasi-Lucknow' corridor.",
            "color": "teal"
        })
    elif mse.sector and "Agri" in mse.sector:
        insights.append({
            "type": "expansion",
            "title": "Supply Chain Optimisation",
            "content": "Fresh produce visibility is currently peaking in metro clusters. Map with 'Bharat Logistics' for cold-chain support.",
            "color": "teal"
        })
    else:
        insights.append({
            "type": "expansion",
            "title": "Network Growth",
            "content": f"New Seller Apps are joining ONDC in {mse.state}. Updating your catalogue will increase search rankings.",
            "color": "teal"
        })

    # Inventory based insight
    if len(products) < 3:
        insights.append({
            "type": "compliance",
            "title": "Catalogue Coverage",
            "content": "You have only listed a few items. Diversifying your digital catalogue increases trust score by 12%.",
            "color": "amber",
            "action": "Add Items"
        })
    else:
        # Check for description quality (mock logic)
        poor_desc = [p for p in products if len(p.description) < 20]
        if poor_desc:
            insights.append({
                "type": "compliance",
                "title": "SEO Weakness",
                "content": f"{len(poor_desc)} products have thin descriptions. Enhance them to improve ONDC buyer app conversion.",
                "color": "amber",
                "action": "Polish Now"
            })

    # Trust based insight
    unverified_tx = db.query(models.Transaction).filter(
        models.Transaction.mse_id == mse_id, 
        models.Transaction.status == "pending"
    ).count()
    
    if unverified_tx > 0:
        insights.append({
            "type": "compliance",
            "title": "Trust Score Risk",
            "content": f"You have {unverified_tx} unverified claims. Delays in verification reduce your 'Settlement Speed' rating.",
            "color": "amber",
            "action": "Verify Now"
        })

    return insights

@router.get("/{mse_id}/history", response_model=List[schemas.MatchingScore], dependencies=[Depends(auth.RoleChecker(["mse", "nsic", "admin"]))])
def get_matching_history(mse_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """
    Past match recommendations and their current status.
    """
    # Ownership Check
    if current_user["role"] == "mse":
        target_mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
        if not target_mse or target_mse.email != current_user["email"]:
            raise HTTPException(status_code=403, detail="Not authorized to view matching history for this MSE")

    partnerships = db.query(models.Partnership).filter(models.Partnership.mse_id == mse_id).all()
    
    history = []
    for p in partnerships:
        history.append({
            "snp_id": p.snp_id,
            "snp_name": p.snp.name,
            "score": p.match_score,
            "reason": p.ai_reasoning,
            "partnership_status": p.status.value,
            "partnership_id": p.partnership_id,
            "mse_consent": p.mse_consent,
            "snp_consent": p.snp_consent
        })
    
    return history

from .notifications import send_external_notification

@router.post("/assign", dependencies=[Depends(auth.RoleChecker(["mse"]))])
def assign_mse_to_snp(mse_id: int, snp_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
    snp = db.query(models.SNP).filter(models.SNP.snp_id == snp_id).first()
    
    if not mse or not snp:
        raise HTTPException(status_code=404, detail="MSE or SNP not found")
    
    # Capacity Check (MATCH-02)
    if snp.current_load >= snp.capacity:
        raise HTTPException(status_code=400, detail=f"Fulfillment partner {snp.name} is currently at maximum capacity and cannot accept new requests.")

    # Check if exists
    existing = db.query(models.Partnership).filter(
        models.Partnership.mse_id == mse_id,
        models.Partnership.snp_id == snp_id
    ).first()
    
    if not existing:
        partnership = models.Partnership(
            mse_id=mse_id,
            snp_id=snp_id,
            match_score=85.0, # Normalized simulated score
            ai_reasoning="User-initiated mapping from AI Recommendation Feed.",
            status=models.PartnershipStatus.pending,
            mse_consent=True,
            snp_consent=False,
            initiated_by="mse",
            initiated_at=datetime.utcnow()
        )
        db.add(partnership)
        
        # Notify SNP in-app
        db.add(models.Notification(
            user_role="snp",
            user_id=snp_id,
            title="New Mapping Request",
            message=f"{mse.name} has requested a partnership based on high sectoral alignment.",
            type="info"
        ))

        # NOT-02: Simulated Email to SNP about the new request
        send_external_notification(
            db, 
            snp_id, 
            "snp", 
            "EMAIL", 
            f"New ONDC Partnership Request: {mse.name} has requested to integrate with your seller node. Please review and approve in your dashboard."
        )
        
        db.commit()

    return {"status": "success", "message": f"Successfully mapped {mse.name} to {snp.name} node."}
