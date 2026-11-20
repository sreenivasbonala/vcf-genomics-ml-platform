"""
Machine Learning End-to-End Pipeline (Iris Dataset)
Matches Professor's Classroom Code:
1. Imports & Dataset
2. Inspect Data Quality
3. Train/Test Split (Stratified)
4. Build Pipelines & Candidate Models
5. Train & Compare Models
6. Confusion Matrix & Classification Report
7. Cross-Validation (Stratified 5-Fold)
8. K-Means Clustering (Unsupervised)
9. Save & Reload Complete Pipeline (joblib & pickle)
"""

import os
import pickle
import joblib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")  # Non-interactive backend for clean terminal execution
import matplotlib.pyplot as plt

from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import SelectKBest, mutual_info_classif
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    ConfusionMatrixDisplay,
    silhouette_score,
)
from sklearn.cluster import KMeans
from sklearn.base import clone

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

print("=" * 65)
print("1. IMPORTS AND DATASET")
print("=" * 65)
data = load_iris(as_frame=True)
X = data.data.copy()
y = data.target.copy()  # integer-encoded species: 0, 1, 2
class_names = list(data.target_names)
print("Shape:", X.shape)
print("Features:", list(X.columns))
print("Species:", class_names)
print("Samples per species:\n", y.map(dict(enumerate(class_names))).value_counts())

print("\n" + "=" * 65)
print("2. INSPECT DATA QUALITY")
print("=" * 65)
print(X.head().to_string())
print("\nTypes:\n", X.dtypes.value_counts())
print("Missing values:", int(X.isna().sum().sum()))
print("Duplicate feature rows:", int(X.duplicated().sum()))
print("\nClass balance:\n", y.map(dict(enumerate(class_names))).value_counts().rename("sample_count"))

print("\n" + "=" * 65)
print("3. TRAIN/TEST SPLIT (STRATIFIED 80/20)")
print("=" * 65)
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.20, random_state=42, stratify=y
)
print("Training shape:", X_train.shape, "Testing shape:", X_test.shape)
print("Training class counts:\n", y_train.map(dict(enumerate(class_names))).value_counts())
print("Testing class counts:\n", y_test.map(dict(enumerate(class_names))).value_counts())

print("\n" + "=" * 65)
print("4. BUILD PIPELINES AND CANDIDATE MODELS")
print("=" * 65)
def make_pipeline(model, scale=True):
    steps = [("imputer", SimpleImputer(strategy="median"))]
    if scale:
        steps.append(("scaler", StandardScaler()))
    # Select 3 of the 4 measurements. Selection is fitted only on training data.
    steps.append(("select", SelectKBest(score_func=mutual_info_classif, k=3)))
    steps.append(("model", model))
    return Pipeline(steps)

models = {
    "Logistic Regression": make_pipeline(LogisticRegression(max_iter=3000)),
    "Decision Tree": make_pipeline(DecisionTreeClassifier(max_depth=4, min_samples_leaf=3, random_state=42), scale=False),
    "Random Forest": make_pipeline(RandomForestClassifier(n_estimators=200, min_samples_leaf=2, random_state=42), scale=False),
    "SVM (RBF)": make_pipeline(SVC(kernel="rbf", C=1.0, probability=True, random_state=42)),
}
print("Candidate models:", list(models))

print("\n" + "=" * 65)
print("5. TRAIN AND COMPARE")
print("=" * 65)
results, fitted = [], {}
for name, pipe in models.items():
    pipe.fit(X_train, y_train)
    pred = pipe.predict(X_test)
    fitted[name] = pipe
    results.append({
        "model": name,
        "accuracy": accuracy_score(y_test, pred),
        "precision_macro": precision_score(y_test, pred, average="macro", zero_division=0),
        "recall_macro": recall_score(y_test, pred, average="macro", zero_division=0),
        "f1_macro": f1_score(y_test, pred, average="macro", zero_division=0),
    })

results_df = pd.DataFrame(results).sort_values("f1_macro", ascending=False)
print(results_df.round(3).to_string(index=False))

print("\n" + "=" * 65)
print("6. CONFUSION MATRIX AND CLASSIFICATION REPORT")
print("=" * 65)
best_name = results_df.iloc[0]["model"]
best_model = fitted[best_name]
pred = best_model.predict(X_test)
print("Best Model:", best_name)
print(classification_report(y_test, pred, target_names=class_names, zero_division=0))

fig, ax = plt.subplots(figsize=(6, 5))
ConfusionMatrixDisplay.from_predictions(
    y_test, pred, display_labels=class_names, xticks_rotation=25, ax=ax
)
plt.title(f"Confusion Matrix - {best_name}")
plt.tight_layout()
cm_path = os.path.join(OUT_DIR, "confusion_matrix.png")
plt.savefig(cm_path, dpi=150)
plt.close(fig)
print(f"Saved Confusion Matrix chart to: {cm_path}")

print("\n" + "=" * 65)
print("7. CROSS VALIDATION WITHIN TRAINING DATA (5-FOLD)")
print("=" * 65)
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
scores = cross_val_score(clone(models["Logistic Regression"]), X_train, y_train, cv=cv, scoring="f1_macro")
print("Fold macro-F1:", np.round(scores, 3))
print("Mean macro-F1:", round(scores.mean(), 3))

print("\n" + "=" * 65)
print("8. K-MEANS CLUSTERING (UNSUPERVISED)")
print("=" * 65)
prep = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())])
X_train_scaled = prep.fit_transform(X_train)
km = KMeans(n_clusters=3, n_init=20, random_state=42)
clusters = km.fit_predict(X_train_scaled)
print("Silhouette:", round(silhouette_score(X_train_scaled, clusters), 3))
ct = pd.crosstab(
    pd.Series(clusters, name="cluster"),
    pd.Series(y_train.map(dict(enumerate(class_names))).values, name="known species (for interpretation only)")
)
print(ct.to_string())

print("\n" + "=" * 65)
print("9. SAVE AND RELOAD THE COMPLETE PIPELINE (JOBLIB & PICKLE)")
print("=" * 65)
joblib_path = os.path.join(OUT_DIR, "iris_demo_pipeline.joblib")
pickle_path = os.path.join(OUT_DIR, "iris_demo_pipeline.pkl")

joblib.dump(best_model, joblib_path)
loaded = joblib.load(joblib_path)
sample = X_test.iloc[[0]]
print("Before save:  ", class_names[int(best_model.predict(sample)[0])])
print("After joblib: ", class_names[int(loaded.predict(sample)[0])])

# Pickle alternative (only load trusted artifacts)
with open(pickle_path, "wb") as f:
    pickle.dump(best_model, f)
with open(pickle_path, "rb") as f:
    loaded_pickle = pickle.load(f)
print("After pickle: ", class_names[int(loaded_pickle.predict(sample)[0])])
print(f"\nSaved models:\n  - {joblib_path}\n  - {pickle_path}")
