from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Dict, Any
import models, schemas, auth
from database import get_db
from product_utils import categorize_product_ai
#from product_utils import categorize_product_ai

router = APIRouter()

import re

# Unified Product Taxonomy (UPT-2026 Reference)
TAXONOMY = {
    "Textiles & Apparel": {
        "nodes": ["Handloom", "Silk", "Cotton", "Fabric", "Garments"],
        "hsn_prefix": "50",
        "attributes": ["Material", "Weave Type", "Thread Count", "Dye Method"]
    },
    "Handicrafts & Decor": {
        "nodes": ["Woodwork", "Metalcraft", "Pottery", "Terracotta", "Jute"],
        "hsn_prefix": "44",
        "attributes": ["Craft Type", "Region Origin", "Finish", "Artisanal Certified"]
    },
    "Agri & Food": {
        "nodes": ["Organic", "Spices", "Tea", "Coffee", "Grains"],
        "hsn_prefix": "09",
        "attributes": ["Shelf Life", "Certifications", "Moisture Content", "Processing Type"]
    }
}

@router.post("/categorize", response_model=schemas.CategorizeResponse, dependencies=[Depends(auth.RoleChecker(["mse"]))])
def categorize_product(data: dict, current_user: dict = Depends(auth.get_current_user)):
    description = data.get("description", "")
    product_name = data.get("product_name", "")
    
    # 1. Get candidate labels from our TAXONOMY
    candidate_labels = list(TAXONOMY.keys())
    
    # 2. Call AI Categorization
    ai_suggestions = categorize_product_ai(product_name, description, candidate_labels)
    
    # 3. Enhanced logic for attribute extraction
    text_corpus = f"{product_name} {description}".lower()
    extracted_attributes: Dict[str, Any] = {}
    
    dim_match = re.search(r'(\d+(?:\.\d+)?\s*(?:m|cm|inch|ft|mm)(?:\s*x\s*\d+(?:\.\d+)?\s*(?:m|cm|inch|ft|mm))?)', text_corpus)
    if dim_match: extracted_attributes["Dimensions"] = dim_match.group(1).strip()
    
    wt_match = re.search(r'(\d+(?:\.\d+)?\s*(?:kg|g|lb|oz))', text_corpus)
    if wt_match: extracted_attributes["Weight"] = wt_match.group(1).strip()

    # 4. Map AI labels back to our TAXONOMY metadata and structure the response
    final_suggestions = []
    
    if ai_suggestions:
        for sug in ai_suggestions:
            category_name = sug["category_name"]
            meta = TAXONOMY.get(category_name, {})
            
            # Category ID (using 1-based index from our static TAXONOMY keys)
            cat_id = list(TAXONOMY.keys()).index(category_name) + 1
            
            # Pre-fill category specific attributes
            cat_attrs: Dict[str, Any] = {attr: "Detecting..." for attr in meta.get("attributes", [])}
            cat_attrs.update(extracted_attributes)
            cat_attrs["HSN_Prefix"] = meta.get("hsn_prefix", "00")
            
            # Simple keyword check for "Detected_Nodes" within the AI suggestion
            hits = [node for node in meta.get("nodes", []) if node.lower() in text_corpus]
            if hits:
                cat_attrs["Detected_Nodes"] = ", ".join(hits)
                # Boost confidence if we find specific keywords
                sug["confidence"] = min(0.99, sug["confidence"] + (len(hits) * 0.1))

            final_suggestions.append({
                "category_id": cat_id,
                "category_name": category_name,
                "confidence": min(0.98, sug["confidence"]),
                "attributes": cat_attrs
            })

    # Fallback to general if AI fails or no suggestions
    if not final_suggestions:
        final_suggestions.append({
            "category_id": 4,
            "category_name": "General Merchandise",
            "confidence": 0.45,
            "attributes": extracted_attributes
        })
    
    # Sort by confidence
    final_suggestions.sort(key=lambda x: x["confidence"], reverse=True)
    return {"suggestions": final_suggestions}

@router.get("/categories", response_model=List[schemas.CategoryResponse], dependencies=[Depends(auth.RoleChecker(["mse", "nsic", "admin", "snp"]))])
def get_categories(db: Session = Depends(get_db)):
    return db.query(models.Category).all()

@router.post("/{mse_id}/products", response_model=schemas.ProductResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(auth.RoleChecker(["mse"]))])
def add_product(mse_id: int, product: schemas.ProductBase, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    # Ownership Check (UM-03)
    target_mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
    if not target_mse:
        raise HTTPException(status_code=404, detail="MSE profile not found")
        
    # Check if this user owns the profile via user_id or email
    # current_user["id"] is the User table ID
    is_owner = (target_mse.user_id == current_user["id"]) or (target_mse.email == current_user["email"])
    
    if not is_owner:
        raise HTTPException(status_code=403, detail="Not authorized to add products for this MSE")
    
    # Duplicate Check
    existing = db.query(models.Product).filter(
        models.Product.mse_id == mse_id,
        models.Product.product_name == product.product_name
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Product '{product.product_name}' already exists in your catalogue")

    db_product = models.Product(
        mse_id=mse_id,
        product_name=product.product_name,
        description=product.description,
        category_id=product.category_id,
        attributes=product.attributes,
        price=product.price,
        unit=product.unit
    )
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product

@router.get("/{mse_id}/products", response_model=List[schemas.ProductResponse], dependencies=[Depends(auth.RoleChecker(["mse", "nsic", "admin"]))])
def get_mse_products(mse_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    # Ownership Check if role is 'mse'
    if current_user["role"] == "mse":
        target_mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
        if not target_mse:
            raise HTTPException(status_code=404, detail="MSE profile not found")
            
        is_owner = (target_mse.user_id == current_user["id"]) or (target_mse.email == current_user["email"])
        if not is_owner:
            raise HTTPException(status_code=403, detail="Not authorized to view products for this MSE")
    
    products = db.query(models.Product).filter(models.Product.mse_id == mse_id).all()
    return products

import json

@router.put("/{product_id}", response_model=schemas.ProductResponse, dependencies=[Depends(auth.RoleChecker(["mse"]))])
def update_product(product_id: int, product: schemas.ProductBase, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    db_product = db.query(models.Product).filter(models.Product.product_id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    owner_mse = db.query(models.MSE).filter(models.MSE.mse_id == db_product.mse_id).first()
    if not owner_mse or owner_mse.email != current_user["email"]:
        raise HTTPException(status_code=403, detail="Not authorized to update this product")

    # Save current state to ProductVersion (PRO-02)
    current_version_count = db.query(models.ProductVersion).filter(models.ProductVersion.product_id == product_id).count()
    
    snapshot = {
        "product_name": db_product.product_name,
        "description": db_product.description,
        "category_id": db_product.category_id,
        "attributes": db_product.attributes,
        "price": db_product.price,
        "unit": db_product.unit
    }
    version = models.ProductVersion(
        product_id=product_id,
        version_number=current_version_count + 1,
        product_data=json.dumps(snapshot),
    )
    db.add(version)

    # Update new fields
    db_product.product_name = product.product_name
    db_product.description = product.description
    db_product.category_id = product.category_id
    db_product.attributes = product.attributes
    db_product.price = product.price
    db_product.unit = product.unit
    
    db.commit()
    db.refresh(db_product)
    return db_product

@router.delete("/{product_id}", dependencies=[Depends(auth.RoleChecker(["mse"]))])
def delete_product(product_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.product_id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    owner_mse = db.query(models.MSE).filter(models.MSE.mse_id == product.mse_id).first()
    if not owner_mse or owner_mse.email != current_user["email"]:
        raise HTTPException(status_code=403, detail="Not authorized to delete this product")

    db.delete(product)
    db.commit()
    return {"message": "Product removed from ONDC catalogue"}

@router.get("/{product_id}/versions", response_model=List[schemas.ProductVersionResponse], dependencies=[Depends(auth.RoleChecker(["mse", "nsic", "admin"]))])
def get_product_versions(product_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """
    Get change history for a specific product.
    """
    db_product = db.query(models.Product).filter(models.Product.product_id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    if current_user["role"] == "mse":
        owner_mse = db.query(models.MSE).filter(models.MSE.mse_id == db_product.mse_id).first()
        if not owner_mse or owner_mse.email != current_user["email"]:
            raise HTTPException(status_code=403, detail="Not authorized to view versions for this product")

    return db.query(models.ProductVersion).filter(models.ProductVersion.product_id == product_id).order_by(models.ProductVersion.version_number.desc()).all()

@router.delete("/{product_id}/versions/{version_id}", dependencies=[Depends(auth.RoleChecker(["mse"]))])
def rollback_product_version(product_id: int, version_id: int, current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """
    Rollback product to a specific historical version.
    """
    db_product = db.query(models.Product).filter(models.Product.product_id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    owner_mse = db.query(models.MSE).filter(models.MSE.mse_id == db_product.mse_id).first()
    if not owner_mse or owner_mse.email != current_user["email"]:
        raise HTTPException(status_code=403, detail="Not authorized to rollback this product")

    version = db.query(models.ProductVersion).filter(
        models.ProductVersion.version_id == version_id,
        models.ProductVersion.product_id == product_id
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    # Restore data from version
    data = json.loads(version.product_data)
    db_product.product_name = data["product_name"]
    db_product.description = data["description"]
    db_product.category_id = data["category_id"]
    db_product.attributes = data["attributes"]
    db_product.price = data["price"]
    db_product.unit = data["unit"]

    # Delete this and all versions newer than this one (since we rolled back to it)
    db.query(models.ProductVersion).filter(
        models.ProductVersion.product_id == product_id,
        models.ProductVersion.version_number >= version.version_number
    ).delete()

    db.commit()
    return {"message": f"Product rolled back to version {version.version_number}"}

@router.post("/{mse_id}/bulk", response_model=List[schemas.ProductResponse], dependencies=[Depends(auth.RoleChecker(["mse"]))])
def bulk_upload_products(mse_id: int, products: List[schemas.ProductCreate], current_user: dict = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    # Ownership Check
    target_mse = db.query(models.MSE).filter(models.MSE.mse_id == mse_id).first()
    if not target_mse or target_mse.email != current_user["email"]:
        raise HTTPException(status_code=403, detail="Not authorized for bulk upload for this MSE")
    
    db_products = []
    for p in products:
        # Duplicate Check
        existing = db.query(models.Product).filter(
            models.Product.mse_id == mse_id,
            models.Product.product_name == p.product_name
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"Product '{p.product_name}' already exists in your catalogue. Bulk upload aborted.")

        db_product = models.Product(
            mse_id=mse_id,
            product_name=p.product_name,
            description=p.description,
            price=p.price,
            unit=p.unit,
            category_id=p.category_id,
            attributes=p.attributes
        )
        db.add(db_product)
        db_products.append(db_product)
    
    db.commit()
    for p in db_products:
        db.refresh(p)
    return db_products
