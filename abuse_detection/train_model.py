import pandas as pd
import string
import joblib
import nltk

from nltk.corpus import stopwords
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

# Download stopwords (only first time)
nltk.download('stopwords')

# Load dataset
data = pd.read_csv("dataset.csv")

# Preprocessing
stop_words = set(stopwords.words('english'))

def preprocess(text):
    text = str(text).lower()
    text = ''.join([c for c in text if c not in string.punctuation])
    words = text.split()
    words = [w for w in words if w not in stop_words]
    return " ".join(words)

# Apply preprocessing
data['clean_text'] = data['text'].apply(preprocess)

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    data['clean_text'], data['label'], test_size=0.2, random_state=42
)

# Vectorization
vectorizer = TfidfVectorizer()
X_train_vec = vectorizer.fit_transform(X_train)

# Train model
model = LogisticRegression()
model.fit(X_train_vec, y_train)

# ✅ SAVE FILES HERE
joblib.dump(model, "model.pkl")
joblib.dump(vectorizer, "vectorizer.pkl")

print("✅ model.pkl and vectorizer.pkl created successfully!")