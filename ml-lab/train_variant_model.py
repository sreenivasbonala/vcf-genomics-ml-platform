#!/usr/bin/env python3
"""
train_variant_model.py
======================
Variant Pathogenicity Prediction & Unsupervised Clustering Pipeline

1. Dataset: synthetic_genomic_variant_training_dataset.csv (1000 variants, 20 features)
2. Supervised Learning:
   - Features: CADD_phred, REVEL_score, SIFT_score, SpliceAI_score, allele_frequency,
               QUAL, variant_length, variant_type, consequence, impact, FILTER, genotype, zygosity.
   - Preprocessing: StandardScaler (numeric) + OneHotEncoder (categorical)
   - Classifier: RandomForestClassifier (100 estimators, max_depth=8)
   - Metrics: Accuracy, Precision, Recall, F1 Score, Confusion Matrix, ROC-AUC
3. Unsupervised Learning:
   - Algorithm: KMeans (k=2) on transformed feature space (without labels)
   - Metric: Silhouette Score & Cluster Distribution
4. Export:
   - variant_pathogenicity_pipeline.joblib
   - variant_kmeans.joblib
   - ml_metrics.json
   - PNG plots: confusion_matrix.png, feature_importance.png
"""

import os
import json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import joblib

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.cluster import KMeans
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, confusion_matrix, silhouette_score
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, 'data', 'synthetic_genomic_variant_training_dataset.csv')
MODEL_PATH = os.path.join(BASE_DIR, 'variant_pathogenicity_pipeline.joblib')
KMEANS_PATH = os.path.join(BASE_DIR, 'variant_kmeans.joblib')
METRICS_PATH = os.path.join(BASE_DIR, 'ml_metrics.json')

def train():
    print("=" * 65)
    print("1. LOADING SYNTHETIC GENOMIC VARIANT TRAINING DATASET")
    print("=" * 65)
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f"Training data not found at {DATA_PATH}")

    df = pd.read_csv(DATA_PATH)
    print(f"Dataset Shape: {df.shape[0]} variants, {df.shape[1]} columns")
    print("Class Distribution:")
    print(df['label'].value_counts())

    num_cols = ['variant_length', 'CADD_phred', 'REVEL_score', 'SIFT_score', 'SpliceAI_score', 'allele_frequency', 'QUAL']
    cat_cols = ['variant_type', 'consequence', 'impact', 'FILTER', 'genotype', 'zygosity']

    X = df[num_cols + cat_cols]
    y = (df['label'] == 'Pathogenic').astype(int)

    # 80/20 Stratified Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    print(f"\nTraining set: {X_train.shape[0]} variants")
    print(f"Testing set:  {X_test.shape[0]} variants")

    # ColumnTransformer
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), num_cols),
            ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), cat_cols)
        ]
    )

    print("\n" + "=" * 65)
    print("2. TRAINING SUPERVISED RANDOM FOREST CLASSIFIER")
    print("=" * 65)
    rf = RandomForestClassifier(n_estimators=100, max_depth=8, random_state=42)
    pipeline = Pipeline([
        ('preprocessor', preprocessor),
        ('classifier', rf)
    ])

    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)
    y_prob = pipeline.predict_proba(X_test)[:, 1]

    acc = float(accuracy_score(y_test, y_pred))
    prec = float(precision_score(y_test, y_pred))
    rec = float(recall_score(y_test, y_pred))
    f1 = float(f1_score(y_test, y_pred))
    auc = float(roc_auc_score(y_test, y_prob))
    cm = confusion_matrix(y_test, y_pred).tolist()

    print(f"  ✓ Accuracy:  {acc * 100:.2f}%")
    print(f"  ✓ Precision: {prec * 100:.2f}%")
    print(f"  ✓ Recall:    {rec * 100:.2f}%")
    print(f"  ✓ F1-Score:  {f1 * 100:.2f}%")
    print(f"  ✓ ROC-AUC:   {auc:.4f}")
    print(f"  ✓ Confusion Matrix (TN, FP, FN, TP): {cm}")

    # Feature Importances
    preprocessor_fitted = pipeline.named_steps['preprocessor']
    cat_feature_names = list(preprocessor_fitted.named_transformers_['cat'].get_feature_names_out(cat_cols))
    all_feature_names = num_cols + cat_feature_names
    importances = pipeline.named_steps['classifier'].feature_importances_
    feat_imp = sorted(zip(all_feature_names, importances), key=lambda x: x[1], reverse=True)
    top_features = [{"feature": f, "importance": round(float(imp), 4)} for f, imp in feat_imp[:12]]

    print("\nTop 5 Most Important Genomic Features:")
    for item in top_features[:5]:
        print(f"  - {item['feature']}: {item['importance']}")

    print("\n" + "=" * 65)
    print("3. TRAINING UNSUPERVISED K-MEANS CLUSTERING (k=2)")
    print("=" * 65)
    # Transform full dataset features without label
    X_all_trans = preprocessor.transform(X)
    kmeans = KMeans(n_clusters=2, random_state=42, n_init=10)
    clusters = kmeans.fit_predict(X_all_trans)
    sil_score = float(silhouette_score(X_all_trans, clusters))

    cluster_counts = pd.Series(clusters).value_counts().to_dict()
    # Crosstab with true labels
    ct = pd.crosstab(pd.Series(clusters, name='cluster'), df['label'])
    cluster_breakdown = {
        "cluster_0": {"total": int(cluster_counts.get(0, 0)), "benign": int(ct.loc[0, 'Benign']) if 0 in ct.index and 'Benign' in ct.columns else 0, "pathogenic": int(ct.loc[0, 'Pathogenic']) if 0 in ct.index and 'Pathogenic' in ct.columns else 0},
        "cluster_1": {"total": int(cluster_counts.get(1, 0)), "benign": int(ct.loc[1, 'Benign']) if 1 in ct.index and 'Benign' in ct.columns else 0, "pathogenic": int(ct.loc[1, 'Pathogenic']) if 1 in ct.index and 'Pathogenic' in ct.columns else 0}
    }
    print(f"  ✓ Silhouette Score: {sil_score:.4f}")
    print(f"  ✓ Cluster 0: {cluster_breakdown['cluster_0']}")
    print(f"  ✓ Cluster 1: {cluster_breakdown['cluster_1']}")

    # Save Models
    joblib.dump(pipeline, MODEL_PATH)
    joblib.dump(kmeans, KMEANS_PATH)
    print(f"\nSaved Pipeline to: {MODEL_PATH}")
    print(f"Saved KMeans to:   {KMEANS_PATH}")

    # Save Metrics JSON
    metrics_data = {
        "dataset": {
            "total_variants": len(df),
            "features_count": len(all_feature_names),
            "train_samples": len(X_train),
            "test_samples": len(X_test),
            "pathogenic_count": int((df['label'] == 'Pathogenic').sum()),
            "benign_count": int((df['label'] == 'Benign').sum())
        },
        "supervised_rf": {
            "model_name": "Random Forest Classifier",
            "accuracy": round(acc, 4),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1_score": round(f1, 4),
            "roc_auc": round(auc, 4),
            "confusion_matrix": {
                "true_negative": cm[0][0],
                "false_positive": cm[0][1],
                "false_negative": cm[1][0],
                "true_positive": cm[1][1]
            },
            "top_features": top_features
        },
        "unsupervised_kmeans": {
            "model_name": "K-Means Clustering",
            "n_clusters": 2,
            "silhouette_score": round(sil_score, 4),
            "cluster_breakdown": cluster_breakdown
        }
    }

    with open(METRICS_PATH, 'w') as f:
        json.dump(metrics_data, f, indent=2)
    print(f"Saved Metrics JSON to: {METRICS_PATH}")

    # Generate Visualization Plots
    plot_cm(cm, acc, f1)
    plot_feat_imp(top_features)
    print("Visualizations saved: confusion_matrix.png, feature_importance.png")
    print("=" * 65)

def plot_cm(cm, acc, f1):
    plt.figure(figsize=(6, 5), dpi=150)
    plt.imshow(cm, interpolation='nearest', cmap=plt.cm.Blues)
    plt.title(f'Pathogenicity Confusion Matrix\nAccuracy: {acc*100:.1f}% | F1: {f1*100:.1f}%', fontsize=12, pad=12)
    plt.colorbar()
    tick_marks = np.arange(2)
    plt.xticks(tick_marks, ['Benign (0)', 'Pathogenic (1)'], fontsize=10)
    plt.yticks(tick_marks, ['Benign (0)', 'Pathogenic (1)'], fontsize=10)

    thresh = np.max(cm) / 2.
    for i in range(2):
        for j in range(2):
            val = cm[i][j]
            color = "white" if val > thresh else "black"
            plt.text(j, i, f"{val}", horizontalalignment="center", verticalalignment="center", color=color, fontsize=14, fontweight='bold')

    plt.ylabel('Ground Truth Label', fontsize=11)
    plt.xlabel('Predicted Label (RF Model)', fontsize=11)
    plt.tight_layout()
    plt.savefig(os.path.join(BASE_DIR, 'confusion_matrix.png'))
    plt.close()

def plot_feat_imp(top_features):
    plt.figure(figsize=(8, 5), dpi=150)
    names = [item['feature'].replace('consequence_', '').replace('impact_', 'impact: ') for item in reversed(top_features[:10])]
    vals = [item['importance'] for item in reversed(top_features[:10])]

    bars = plt.barh(names, vals, color='#8b5cf6', edgecolor='#6d28d9', alpha=0.85)
    plt.title('Top 10 Feature Importances for Variant Pathogenicity', fontsize=12, pad=12)
    plt.xlabel('Mean Gini Importance (Random Forest)', fontsize=11)

    for bar, val in zip(bars, vals):
        plt.text(val + 0.003, bar.get_y() + bar.get_height()/2, f"{val:.3f}", va='center', fontsize=9, fontweight='bold', color='#4c1d95')

    plt.xlim(0, max(vals) * 1.15)
    plt.tight_layout()
    plt.savefig(os.path.join(BASE_DIR, 'feature_importance.png'))
    plt.close()

if __name__ == '__main__':
    train()
