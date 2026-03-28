from transformers import pipeline
import os

_classifier = None

def get_classifier():
    global _classifier
    if _classifier is None:
        try:
            print("Loading Zero-Shot Classifier...")
            _classifier = pipeline("zero-shot-classification", model="facebook/bart-large-mnli")
        except Exception as e:
            print(f"Error loading Product Categorization model: {e}")
    return _classifier

def categorize_product_ai(product_name: str, description: str, candidate_labels: list):
    classifier = get_classifier()
    if classifier is None:
        return None

    text_to_classify = f"{product_name} {description}"
    try:
        result = classifier(text_to_classify, candidate_labels, multi_label=False)
        suggestions = []
        for label, score in zip(result['labels'], result['scores']):
            suggestions.append({"category_name": label, "confidence": score})
        return suggestions
    except Exception as e:
        print(f"AI Categorization Error: {e}")
        return None
 