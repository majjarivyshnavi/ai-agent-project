from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import sqlalchemy
from database import get_db
import models, schemas, auth
from typing import List

router = APIRouter()

@router.get("/mse/{mse_id}", response_model=List[schemas.PartnershipResponse], dependencies=[Depends(auth.RoleChecker(["mse", "nsic", "admin"]))])
def get_mse_partnerships(mse_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    if current_user["role"] == "mse":
        mse = db.query(models.MSE).filter(models.MSE.email == current_user["email"]).first()
        if not mse or mse.mse_id != mse_id:
            raise HTTPException(status_code=403, detail="Not authorized to view partnerships for this MSE")
    return db.query(models.Partnership).filter(models.Partnership.mse_id == mse_id).options(sqlalchemy.orm.joinedload(models.Partnership.snp), sqlalchemy.orm.joinedload(models.Partnership.mse)).all()

@router.get("/{snp_id}", response_model=List[schemas.PartnershipResponse], dependencies=[Depends(auth.RoleChecker(["snp", "nsic", "admin"]))])
def get_snp_partnerships(snp_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    if current_user["role"] == "snp":
        if current_user.get("profile_id") != snp_id:
            raise HTTPException(status_code=403, detail="Not authorized to view partnerships for this SNP")
    return db.query(models.Partnership).filter(models.Partnership.snp_id == snp_id).options(sqlalchemy.orm.joinedload(models.Partnership.mse)).all()
from .notifications import send_external_notification
from typing import Literal

@router.post("/{partnership_id}/action", dependencies=[Depends(auth.RoleChecker(["mse", "snp"]))])
def update_partnership_status(
    partnership_id: int, 
    action: Literal["approve", "reject"], 
    current_user: dict = Depends(auth.get_current_user), 
    db: Session = Depends(get_db)
):
    partnership = db.query(models.Partnership).filter(models.Partnership.partnership_id == partnership_id).first()
    if not partnership:
        raise HTTPException(status_code=404, detail="Partnership not found")

    # Enforce role from JWT — never trust caller-supplied role
    user_role = current_user["role"]

    # Ownership check: caller must be a party to this partnership
    if user_role == "mse":
        mse = db.query(models.MSE).filter(models.MSE.email == current_user["email"]).first()
        if not mse or mse.mse_id != partnership.mse_id:
            raise HTTPException(status_code=403, detail="Not authorized to act on this partnership")
    elif user_role == "snp":
        if current_user.get("profile_id")!=partnership.snp_id:
            raise HTTPException(status_code=403, detail="Not authorized to act on this partnership")

    if action == "approve":
        if partnership.status == models.PartnershipStatus.rejected or partnership.status == models.PartnershipStatus.closed:
             raise HTTPException(status_code=400, detail="Cannot approve a rejected or closed partnership. Request a new recommendation.")

        if user_role == "mse":
            partnership.mse_consent = True
        elif user_role == "snp":
            partnership.snp_consent = True
        
        # Truly activate only when both consent
        if partnership.mse_consent and partnership.snp_consent:
            # Capacity Check (MATCH-02)
            if partnership.snp.current_load >= partnership.snp.capacity:
                # Revert consent if at capacity
                if user_role == "mse": partnership.mse_consent = False
                else: partnership.snp_consent = False
                raise HTTPException(status_code=400, detail=f"Fulfillment partner {partnership.snp.name} is currently at maximum capacity.")

            partnership.status = models.PartnershipStatus.active
            partnership.snp.current_load += 1
            
            # Proof of Partnership Audit
            partnership.approved_by = user_role
            partnership.approved_at = sqlalchemy.func.now()
            
            # Notify Both in-app
            db.add(models.Notification(
                user_role="mse",
                user_id=partnership.mse_id,
                title="Partnership Activated",
                message=f"You are now formally integrated with {partnership.snp.name}.",
                type="success"
            ))
            db.add(models.Notification(
                user_role="snp",
                user_id=partnership.snp_id,
                title="Entity Integrated",
                message=f"MSE Node #{partnership.mse_id} has completed the handshake.",
                type="success"
            ))

            # NOT-02: Simulated SMS/Email Outer-Loop notification
            send_external_notification(
                db, 
                partnership.mse_id, 
                "mse", 
                "SMS", 
                f"ONDC Alert: Your partnership with {partnership.snp.name} is now ACTIVE. You can now start fulfilling orders."
            )
            send_external_notification(
                db, 
                partnership.snp_id, 
                "snp", 
                "EMAIL", 
                f"Protocol Integration Complete: MSE Node {partnership.mse.name} is now integrated into your fulfillment registry."
            )
    elif action == "reject":
        if partnership.status == models.PartnershipStatus.active:
            # Decrement load before changing status
            if partnership.snp.current_load > 0:
                partnership.snp.current_load -= 1

            # Consent Withdrawal: Revert to pending and clear consent
            partnership.status = models.PartnershipStatus.pending
            if user_role == "mse":
                partnership.mse_consent = False
            else:
                partnership.snp_consent = False
            
            # Notify the other party about withdrawal
            notify_role = "snp" if user_role == "mse" else "mse"
            notify_id = partnership.snp_id if user_role == "mse" else partnership.mse_id
            db.add(models.Notification(
                user_role=notify_role,
                user_id=notify_id,
                title="Partnership Paused",
                message=f"Consent has been withdrawn for your partnership with {partnership.mse.name if user_role == 'snp' else partnership.snp.name}.",
                type="warning"
            ))
        else:
            # Hard rejection
            partnership.status = models.PartnershipStatus.rejected
            partnership.mse_consent = False
            partnership.snp_consent = False

    db.commit()
    return {"status": "success", "new_status": partnership.status, "mse_consent": partnership.mse_consent, "snp_consent": partnership.snp_consent}

@router.post("/{partnership_id}/feedback", dependencies=[Depends(auth.RoleChecker(["mse"]))])
def provide_partnership_feedback(
    partnership_id: int, 
    feedback: schemas.PartnershipFeedback, 
    current_user: dict = Depends(auth.get_current_user), 
    db: Session = Depends(get_db)
):
    """
    Rate and provide feedback for a partnership.
    """
    partnership = db.query(models.Partnership).filter(models.Partnership.partnership_id == partnership_id).first()
    if not partnership:
        raise HTTPException(status_code=404, detail="Partnership not found")
    
    if partnership.status != models.PartnershipStatus.active:
        raise HTTPException(status_code=400, detail="Feedback can only be provided for active partnerships")

    # Ownership check
    mse = db.query(models.MSE).filter(models.MSE.email == current_user["email"]).first()
    if not mse or mse.mse_id != partnership.mse_id:
        raise HTTPException(status_code=403, detail="Not authorized to provide feedback for this partnership")

    partnership.feedback_rating = feedback.rating
    partnership.feedback_text = feedback.feedback_text
    
    # Update SNP overall rating (simple average logic for simulation)
    snp = partnership.snp
    all_feedbacks = db.query(models.Partnership).filter(
        models.Partnership.snp_id == snp.snp_id,
        models.Partnership.feedback_rating != None
    ).all()
    
    if all_feedbacks:
        total_rating = sum([f.feedback_rating for f in all_feedbacks])
        snp.rating = round(total_rating / len(all_feedbacks), 1)

    db.commit()
    return {"message": "Feedback submitted successfully", "new_snp_rating": snp.rating}

@router.post("/recommend/{mse_id}", dependencies=[Depends(auth.RoleChecker(["mse", "admin"]))])
def recommend_partners(mse_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    # This would normally be called by the Matching AI
    # For now, let's create mock recommendations for this MSE
    snps = db.query(models.SNP).limit(3).all()
    created = []
    for snp in snps:
        existing = db.query(models.Partnership).filter(
            models.Partnership.mse_id == mse_id,
            models.Partnership.snp_id == snp.snp_id
        ).first()
        if not existing:
            p = models.Partnership(
                mse_id=mse_id,
                snp_id=snp_id,
                match_score=85.0 + (snp.rating * 2), # Normalized to ~95%
                ai_reasoning=f"High alignment with {snp.name}'s sectoral expertise in {snp.supported_sectors}.",
                status=models.PartnershipStatus.pending,
                mse_consent=False,
                snp_consent=False,
                initiated_by="system",
                initiated_at=sqlalchemy.func.now()
            )
            db.add(p)
            created.append(p)
    db.commit()
    return {"message": f"Created {len(created)} partner recommendations"}
