"""
Practice L1 (Lasso), L2 (Ridge), and Elastic Net Regularizations
Synthetic Gene Expression Dataset (300 samples x 500 genes, 15 informative)
Fixes typos from classroom handout: Display -> print/display, Solver -> solver.
"""

import os
import warnings
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
)

warnings.filterwarnings("ignore")
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

print("=" * 65)
print("1. GENERATE SYNTHETIC GENE EXPRESSION DATA")
print("=" * 65)
X, y = make_classification(
    n_samples=300,
    n_features=500,
    n_informative=15,
    n_redundant=20,
    n_repeated=0,
    n_classes=2,
    random_state=42,
)

gene_names = [f"Gene_{i+1}" for i in range(500)]
df = pd.DataFrame(X, columns=gene_names)
df["Class"] = y
print("Dataset shape:", df.shape)
print(df.iloc[:5, :6].to_string(), " ... + Class column")
print("Class counts:\n", df["Class"].value_counts().to_string())

print("\n" + "=" * 65)
print("2. SPLIT DATASET (80/20 STRATIFIED)")
print("=" * 65)
X = df.drop("Class", axis=1)
y = df["Class"]
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42,
    stratify=y,
)
print("Training samples:", X_train.shape)
print("Testing samples:", X_test.shape)

print("\n" + "=" * 65)
print("3. TRAIN 3 DIFFERENT REGULARIZED MODELS (L1, L2, ELASTIC NET)")
print("=" * 65)
models = {
    "L1 (Lasso)": LogisticRegression(
        penalty="l1",
        solver="saga",
        C=0.1,
        max_iter=10000,
        random_state=42,
    ),
    "L2 (Ridge)": LogisticRegression(
        penalty="l2",
        solver="saga",
        C=0.1,
        max_iter=10000,
        random_state=42,
    ),
    "Elastic Net": LogisticRegression(
        penalty="elasticnet",
        solver="saga",
        C=0.1,
        l1_ratio=0.5,
        max_iter=10000,
        random_state=42,
    ),
}

trained_models = {}
for name, model in models.items():
    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", model),
    ])
    pipeline.fit(X_train, y_train)
    trained_models[name] = pipeline
    print(f"  ✓ {name} training completed")

print("\n" + "=" * 65)
print("4. COMPARE MODEL PERFORMANCE RESULTS")
print("=" * 65)
results = []
for name, model in trained_models.items():
    predictions = model.predict(X_test)
    results.append({
        "Model": name,
        "Accuracy": accuracy_score(y_test, predictions),
        "Precision": precision_score(y_test, predictions, zero_division=0),
        "Recall": recall_score(y_test, predictions, zero_division=0),
        "F1 Score": f1_score(y_test, predictions, zero_division=0),
    })

results_df = pd.DataFrame(results)
print(results_df.round(3).to_string(index=False))

print("\n" + "=" * 65)
print("5. VISUALISE FEATURE SELECTION (NON-ZERO COEFFICIENTS)")
print("=" * 65)
coefficient_data = {}
feature_counts = {}
for name, model in trained_models.items():
    coefficients = model.named_steps["classifier"].coef_[0]
    coefficient_data[name] = coefficients
    nonzero = int(np.sum(np.abs(coefficients) > 1e-6))
    feature_counts[name] = nonzero
    print(f"  {name:15s} Non-zero features: {nonzero:3d} / 500")

# Plot 1: Feature Retention Bar Chart
fig1, ax1 = plt.subplots(figsize=(9, 5))
colors = ["#2563eb", "#059669", "#7c3aed"]
bars = ax1.bar(feature_counts.keys(), feature_counts.values(), color=colors)
for bar in bars:
    h = bar.get_height()
    ax1.text(bar.get_x() + bar.get_width() / 2, h + 8, f"{int(h)} / 500", ha="center", fontweight="bold")
ax1.set_ylabel("Number of non-zero coefficients")
ax1.set_title("Feature retention: L1 (Lasso) vs L2 (Ridge) vs Elastic Net (C=0.1)")
ax1.set_ylim(0, 560)
plt.tight_layout()
plot1_path = os.path.join(OUT_DIR, "feature_retention_comparison.png")
plt.savefig(plot1_path, dpi=150)
plt.close(fig1)
print(f"Saved chart 1: {plot1_path}")

print("\n" + "=" * 65)
print("6. EFFECT OF REGULARIZATION STRENGTH (C VALUES ON L1)")
print("=" * 65)
C_values = [0.001, 0.01, 0.1, 1, 10, 100]
nonzero_counts = []
for C_value in C_values:
    model = Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(
            penalty="l1",
            solver="saga",
            C=C_value,
            max_iter=10000,
            random_state=42,
        )),
    ])
    model.fit(X_train, y_train)
    coefficients = model.named_steps["classifier"].coef_[0]
    cnt = int(np.sum(np.abs(coefficients) > 1e-6))
    nonzero_counts.append(cnt)
    print(f"  C = {str(C_value):6s} -> Non-zero features: {cnt:3d} / 500")

# Plot 2: Effect of C on L1
fig2, ax2 = plt.subplots(figsize=(9, 5))
ax2.plot(C_values, nonzero_counts, marker="o", linewidth=2, color="#dc2626")
for x_val, y_val in zip(C_values, nonzero_counts):
    ax2.annotate(str(y_val), (x_val, y_val), textcoords="offset points", xytext=(0, 8), ha="center", fontweight="bold")
ax2.set_xscale("log")
ax2.set_xlabel("C (inverse regularization strength: smaller C = stronger penalty)")
ax2.set_ylabel("Number of non-zero coefficients")
ax2.set_title("Effect of Regularization Strength (C) on L1 (Lasso) Feature Selection")
ax2.grid(True, alpha=0.4)
plt.tight_layout()
plot2_path = os.path.join(OUT_DIR, "l1_regularization_strength.png")
plt.savefig(plot2_path, dpi=150)
plt.close(fig2)
print(f"Saved chart 2: {plot2_path}")
