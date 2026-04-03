from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File
from sqlalchemy.orm import Session
import models, schemas, auth
from database import get_db
import re, uuid, logging, os
from voice_utils import transcribe_audio, classify_intent

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/parse-voice")
def parse_voice(data: dict):
    transcript = data.get("transcript", "").strip()

    import re

    result = {
        "name": "",
        "contact_person": "",
        "phone": "",
        "email": "",
        "description": "",
        "sector": "",
        "address": "",
        "city": "",
        "state": "",
        "pincode": ""
    }

    normalized = " ".join(transcript.split())

    # Enterprise / business name
    name_match = re.search(
        r"(business name|enterprise name)\s+(.+?)(?=\s+(contact person|authorised official|authorized official|phone|phone number|email|description|business objective|sector|address|city|state|pincode|postal pincode)\b|$)",
        normalized,
        re.IGNORECASE
    )
    if name_match:
        result["name"] = name_match.group(2).strip(" ,.")

    # Contact person / authorised official
    contact_match = re.search(
        r"(contact person|authorised official|authorized official)\s+(.+?)(?=\s+(phone|phone number|email|description|business objective|sector|address|city|state|pincode|postal pincode)\b|$)",
        normalized,
        re.IGNORECASE
    )
    if contact_match:
        result["contact_person"] = contact_match.group(2).strip(" ,.")

    # Phone
    phone_match = re.search(r"([6-9]\d{9})", normalized)
    if phone_match:
        result["phone"] = phone_match.group(1)

    # Email
    email_match = re.search(r"([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})", normalized)
    if email_match:
        result["email"] = email_match.group(1)

    # Description
    desc_match = re.search(
        r"(description|business objective)\s+(.+?)(?=\s+(sector|address|city|state|pincode|postal pincode)\b|$)",
        normalized,
        re.IGNORECASE
    )
    if desc_match:
        result["description"] = desc_match.group(2).strip(" ,.")

    # Sector
    sector_match = re.search(
        r"(sector|industrial sector)\s+(.+?)(?=\s+(address|city|state|pincode|postal pincode)\b|$)",
        normalized,
        re.IGNORECASE
    )
    if sector_match:
        result["sector"] = sector_match.group(2).strip(" ,.")

    # Address
    address_match = re.search(
        r"(address|registered address)\s+(.+?)(?=\s+(city|state|pincode|postal pincode)\b|$)",
        normalized,
        re.IGNORECASE
    )
    if address_match:
        result["address"] = address_match.group(2).strip(" ,.")

    # City
    city_match = re.search(
        r"(city)\s+(.+?)(?=\s+(state|pincode|postal pincode)\b|$)",
        normalized,
        re.IGNORECASE
    )
    if city_match:
        result["city"] = city_match.group(2).strip(" ,.")

    # State
    state_match = re.search(
        r"(state)\s+(.+?)(?=\s+(pincode|postal pincode)\b|$)",
        normalized,
        re.IGNORECASE
    )
    if state_match:
        result["state"] = state_match.group(2).strip(" ,.")

    # Pincode
    pincode_match = re.search(r"\b(\d{6})\b", normalized)
    if pincode_match:
        result["pincode"] = pincode_match.group(1)

    return result


@router.post("/register", response_model=schemas.RegistrationResponse, status_code=status.HTTP_201_CREATED)
def register_mse(mse: schemas.MSESubmit, db: Session = Depends(get_db)):
    # Check if business/user already exists
    existing_mse = db.query(models.MSE).filter(models.MSE.email == mse.email).first()
    existing_user = db.query(models.User).filter(models.User.email == mse.email).first()
    
    if existing_mse or existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email is already registered. Please login to access your account."
        )
        
    # Create both User and MSE in a single transaction (UM-03 atomicity)
    try:
        # Create corresponding User record
        db_user = models.User(
            email=mse.email,
            hashed_password=auth.get_password_hash(mse.password),
            role="mse"
        )
        db.add(db_user)
        db.flush() # Get user ID before committing

        db_mse = models.MSE(
            user_id=db_user.id,
            name=mse.name,
            contact_person=mse.contact_person,
            email=mse.email,
            phone=mse.phone,
            address=mse.address,
            city=mse.city,
            state=mse.state,
            pincode=mse.pincode,
            sector=mse.sector,
            description=mse.description
        )
        db.add(db_mse)
        db.commit()
        db.refresh(db_mse)
        db.refresh(db_user)
    except Exception as e:
        db.rollback()
        logger.error(f"Registration failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during registration. Please try again."
        )

    # Generate token immediately for seamless onboarding (UM-03 compliance via identity)
    access_token = auth.create_access_token(
        data={"sub": db_user.email, "role": db_user.role, "id": db_user.id, "profile_id": db_mse.mse_id}
    )
    
    return {
        "mse": schemas.MSEResponse.model_validate(db_mse),
        "user": schemas.UserResponse.model_validate(db_user),
        "access_token": access_token,
        "token_type": "bearer"
    }

@router.post("/profile", response_model=schemas.MSEResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(auth.RoleChecker(["mse"]))])
def complete_mse_profile(mse: schemas.MSEProfileCreate, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    db_mse = db.query(models.MSE).filter(models.MSE.email == current_user["email"]).first()
    
    if db_mse:
        # Update existing profile instead of erroring (Fix UM-03 UX)
        db_mse.name = mse.name
        if mse.contact_person: db_mse.contact_person = mse.contact_person
        if mse.phone: db_mse.phone = mse.phone
        if mse.address: db_mse.address = mse.address
        if mse.city: db_mse.city = mse.city
        if mse.state: db_mse.state = mse.state
        if mse.pincode: db_mse.pincode = mse.pincode
        if mse.sector: db_mse.sector = mse.sector.value
        if mse.description: db_mse.description = mse.description
    else:
        # Create new profile
        db_mse = models.MSE(
            user_id=current_user["id"],
            name=mse.name,
            contact_person=mse.contact_person,
            email=current_user["email"],
            phone=mse.phone,
            address=mse.address,
            city=mse.city,
            state=mse.state,
            pincode=mse.pincode,
            sector=mse.sector.value if mse.sector else "Other",
            description=mse.description
        )
        db.add(db_mse)
    
    db.commit()
    db.refresh(db_mse)
    return db_mse

@router.get("/", response_model=list[schemas.MSEResponse], dependencies=[Depends(auth.RoleChecker(["nsic", "admin"]))])
def list_mses(skip: int = 0, limit: int = 20, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    return db.query(models.MSE).offset(skip).limit(limit).all()

@router.get("/{mse_id}", response_model=schemas.MSEResponse, dependencies=[Depends(auth.RoleChecker(["mse", "nsic", "admin"]))])
def get_mse(mse_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    db_mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
    if not db_mse:
        raise HTTPException(status_code=404, detail="MSE not found")
    
    # Ownership Check
    if current_user["role"] == "mse" and db_mse.email != current_user["email"]:
        raise HTTPException(status_code=403, detail="Not authorized to access this MSE profile")
        
    return db_mse

@router.put("/{mse_id}", response_model=schemas.MSEResponse, dependencies=[Depends(auth.RoleChecker(["mse", "admin"]))])
def update_mse(mse_id: int, mse: schemas.MSEUpdate, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    db_mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
    if not db_mse:
        raise HTTPException(status_code=404, detail="MSE not found")
    
    # Ownership Check (UM-03)
    if current_user["role"] == "mse" and db_mse.email != current_user["email"]:
        raise HTTPException(status_code=403, detail="Not authorized to update this MSE profile")
    
    # Check for email conflict if email is being changed
    if mse.email and mse.email != db_mse.email:
        if db.query(models.MSE).filter(models.MSE.email == mse.email).first():
            raise HTTPException(status_code=400, detail="Email already in use by another profile")

    # Partial update logic
    update_data = mse.model_dump(exclude_unset=True)
    
    if "password" in update_data:
        password = update_data.pop("password")
        # Find user record and update password
        db_user = db.query(models.User).filter(models.User.email == db_mse.email).first()
        if db_user:
            db_user.hashed_password = auth.get_password_hash(password)

    for key, value in update_data.items():
        if key == "sector" and value is not None:
            setattr(db_mse, key, value.value)
        else:
            setattr(db_mse, key, value)

    db.commit()
    db.refresh(db_mse)
    return db_mse

@router.delete("/{mse_id}", dependencies=[Depends(auth.RoleChecker(["mse", "admin"]))])
def delete_mse(request: Request, mse_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """
    Remove an MSE profile and its user record.
    """
    db_mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
    if not db_mse:
        raise HTTPException(status_code=404, detail="MSE not found")

    # Ownership check
    if current_user["role"] == "mse" and db_mse.email != current_user["email"]:
        raise HTTPException(status_code=403, detail="Not authorized to delete this MSE profile")

    # Admin Audit Log
    if current_user["role"] == "admin":
        audit = models.SystemAuditLog(
            user_role="admin",
            user_id=current_user["id"],
            action="ADMIN_DELETE_MSE",
            details=f"Admin deleted MSE profile: {db_mse.name} (ID: {mse_id}, Email: {db_mse.email})",
            ip_address=request.client.host if request.client else "unknown"
        )
        db.add(audit)

    # Remove corresponding user record
    db_user = db.query(models.User).filter(models.User.email == db_mse.email).first()
    if db_user:
        db.delete(db_user)

    db.delete(db_mse)
    db.commit()
    return {"message": "MSE profile and user record deleted successfully"}
