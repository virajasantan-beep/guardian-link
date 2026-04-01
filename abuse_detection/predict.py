import joblib
import string

# Load model
model = joblib.load("model.pkl")
vectorizer = joblib.load("vectorizer.pkl")

# Dangerous keywords (customize this!)
abuse_keywords = [
    "kill", "die", "stupid", "idiot", "loser",
    "hate you", "worthless", "ugly", "dumb"
]

def keyword_check(text):
    text_lower = text.lower()
    for word in abuse_keywords:
        if word in text_lower:
            return True
    return False

def preprocess(text):
    text = text.lower()
    text = ''.join([c for c in text if c not in string.punctuation])
    return text

def predict_text(text):
    # Step 1: Keyword detection
    if keyword_check(text):
        print("⚠️ Keyword Alert: Potential Abuse Detected!")

    # Step 2: ML prediction
    clean = preprocess(text)
    vec = vectorizer.transform([clean])
    prediction = model.predict(vec)[0]

    return prediction

# Test input
while True:
    user_input = input("\nEnter text (or type 'exit'): ")
    if user_input.lower() == 'exit':
        break

    result = predict_text(user_input)
    print("Prediction:", result)
    