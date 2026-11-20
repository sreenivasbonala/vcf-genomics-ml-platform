import streamlit as st
import pandas as pd
import numpy as np
import os
import sys
import json
import gzip
from pathlib import Path

# Add ml-lab to path for predictor
BASE_DIR = Path(__file__).resolve().parent
ML_LAB_DIR = BASE_DIR / "ml-lab"
if str(ML_LAB_DIR) not in sys.path:
    sys.path.append(str(ML_LAB_DIR))

try:
    import predict_variants
    predict_variants.load_models()
except Exception as e:
    st.error(f"Error loading ML models: {e}")

# Page Configuration
st.set_page_config(
    page_title="Genomics ML - Variant Pathogenicity",
    page_icon="🧬",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom Styling
st.markdown("""
<style>
    .metric-card {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 18px;
        text-align: center;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .metric-val {
        font-size: 26px;
        font-weight: 700;
        color: #0f172a;
    }
    .metric-lbl {
        font-size: 13px;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .badge-pathogenic {
        background-color: #fee2e2;
        color: #991b1b;
        padding: 4px 10px;
        border-radius: 9999px;
        font-weight: 600;
        font-size: 13px;
    }
    .badge-benign {
        background-color: #dcfce7;
        color: #166534;
        padding: 4px 10px;
        border-radius: 9999px;
        font-weight: 600;
        font-size: 13px;
    }
</style>
""", unsafe_allow_html=True)

# Helper function to parse VCF lines
def parse_vcf_content(lines):
    variants = []
    for line in lines:
        if isinstance(line, bytes):
            line = line.decode('utf-8', errors='ignore')
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) < 5:
            continue
        
        info_str = parts[7] if len(parts) > 7 else ""
        qual_val = parts[5] if len(parts) > 5 else "100"
        filter_val = parts[6] if len(parts) > 6 else "PASS"
        format_str = parts[8] if len(parts) > 8 else "GT"
        sample_str = parts[9] if len(parts) > 9 else "0/1"

        # Infer gene from info if present
        gene = "-"
        if "GENE=" in info_str:
            gene = info_str.split("GENE=")[1].split(";")[0]
        elif "SYMBOL=" in info_str:
            gene = info_str.split("SYMBOL=")[1].split(";")[0]

        variants.append({
            "chrom": parts[0],
            "pos": parts[1],
            "id": parts[2],
            "ref": parts[3],
            "alt": parts[4],
            "qual": qual_val,
            "filter": filter_val,
            "info": info_str,
            "genotype": sample_str.split(":")[0] if ":" in sample_str else sample_str,
            "gene": gene
        })
    return variants

# Demo Sample Datasets
DEMO_VARIANTS_CLINICAL = [
    {"chrom": "chr17", "pos": "43044295", "id": "rs80357906", "ref": "T", "alt": "G", "gene": "BRCA1", "info": "MC=splice_donor_variant;CADD=35.0;AF=0.00005;CLNSIG=Pathogenic"},
    {"chrom": "chr13", "pos": "32315474", "id": "rs11571833", "ref": "A", "alt": "G", "gene": "BRCA2", "info": "MC=synonymous_variant;CADD=2.1;AF=0.15;CLNSIG=Benign"},
    {"chrom": "chr7",  "pos": "140753336", "id": "rs113488022", "ref": "A", "alt": "T", "gene": "BRAF",  "info": "MC=missense_variant;CADD=29.4;AF=0.0002;CLNSIG=Pathogenic"},
    {"chrom": "chr17", "pos": "7674220",  "id": "rs121912651", "ref": "C", "alt": "T", "gene": "TP53",  "info": "MC=stop_gained;CADD=38.0;AF=0.00001;CLNSIG=Pathogenic"},
    {"chrom": "chr1",  "pos": "115256529", "id": "rs1042522",   "ref": "C", "alt": "G", "gene": "NRAS",  "info": "MC=synonymous_variant;CADD=4.5;AF=0.35;CLNSIG=Benign"}
]

# Sidebar
with st.sidebar:
    st.image("https://img.icons8.com/fluency/96/dna-helix.png", width=64)
    st.title("🧬 Genomics AI Lab")
    st.markdown("**Variant Pathogenicity Predictor**")
    st.markdown("Automated clinical variant interpretation using Random Forest & K-Means.")
    
    st.divider()
    st.subheader("Model Benchmarks")
    m1, m2 = st.columns(2)
    m1.metric("RF Accuracy", "83.5%")
    m2.metric("Recall", "93.7%")
    m3, m4 = st.columns(2)
    m3.metric("ROC-AUC", "0.925")
    m4.metric("F1-Score", "0.863")
    
    st.divider()
    st.subheader("Quick Test Samples")
    run_demo = st.button("⚡ Load Clinical Oncology Demo (5 Variants)", use_container_width=True)

# Main Title Area
st.title("🧬 Clinical Genomics & ML Variant Pathogenicity Engine")
st.markdown("Upload any **VCF (Variant Call Format v4.x)** file to automatically engineer sample-level genomic features and predict mutation pathogenicity.")

tab1, tab2, tab3 = st.tabs(["🚀 VCF Inspection & ML Classifier", "📊 Model Performance & Explainability", "🧪 Single Variant Playground"])

# State handling
variants_to_process = None
source_name = ""

with tab1:
    col_up, col_info = st.columns([2, 1])
    with col_up:
        uploaded_file = st.file_uploader("Upload VCF File (.vcf, .vcf.gz)", type=["vcf", "gz", "txt"])
    with col_info:
        st.info("💡 **Supported Features:**\n- Transition / Transversion (Ti/Tv)\n- InDel & SNV Burden\n- Het/Hom Genotype Ratios\n- CADD Phred & REVEL Ensemble\n- Allele Frequency (AF) Thresholds")

    if run_demo:
        variants_to_process = DEMO_VARIANTS_CLINICAL
        source_name = "Clinical Oncology Benchmark Demo"
    elif uploaded_file is not None:
        source_name = uploaded_file.name
        if uploaded_file.name.endswith(".gz"):
            content = gzip.decompress(uploaded_file.read()).decode("utf-8", errors="ignore").splitlines()
        else:
            content = uploaded_file.read().decode("utf-8", errors="ignore").splitlines()
        variants_to_process = parse_vcf_content(content)

    if variants_to_process:
        st.success(f"Loaded **{len(variants_to_process)}** variants from `{source_name}`")
        
        with st.spinner("Engineering genomic features and computing ML predictions..."):
            res = predict_variants.predict_on_variants(variants_to_process)
            sample_feats = res["engineered_sample_features"]
            preds = res["variant_predictions"]
            summary = res["summary"]

        st.subheader("1. Sample-Level Genomic Feature Engineering")
        f1, f2, f3, f4, f5, f6 = st.columns(6)
        f1.metric("Ti/Tv Ratio", f"{sample_feats['titv_ratio']:.2f}", help="Transitions / Transversions ratio")
        f2.metric("Total SNVs", sample_feats["total_snvs"], help="Single Nucleotide Variants")
        f3.metric("Insertions", sample_feats["total_insertions"])
        f4.metric("Deletions", sample_feats["total_deletions"])
        f5.metric("Het/Hom Ratio", f"{sample_feats['hethom_ratio']:.2f}", help="Heterozygous vs Homozygous Alternate")
        f6.metric("Rare Variant %", f"{sample_feats['rare_variant_percentage']}%", help="AF < 0.01 threshold")

        st.divider()
        st.subheader("2. Machine Learning Pathogenicity Interpretation")
        s1, s2, s3 = st.columns(3)
        s1.metric("Total Variants Evaluated", summary["total_tested"])
        s2.metric("🔴 Predicted Pathogenic", summary["predicted_pathogenic"])
        s3.metric("🟢 Predicted Benign", summary["predicted_benign"])

        # Create interactive dataframe
        table_rows = []
        for p in preds:
            table_rows.append({
                "Chr": p["chrom"],
                "Position": p["pos"],
                "Gene": p["gene"],
                "Ref": p["ref"],
                "Alt": p["alt"],
                "Consequence": p["consequence"],
                "Impact": p["impact"],
                "CADD": p["cadd_score"],
                "REVEL": p["revel_score"],
                "AF": p["allele_frequency"],
                "Prediction": p["predicted_label"],
                "Confidence": f"{p['confidence_percent']}%",
                "K-Means Cluster": f"Cluster {p['cluster']}",
                "Key Signals": p["key_signals"]
            })
        
        df_display = pd.DataFrame(table_rows)

        # Style highlight (supports both modern pandas .map and legacy .applymap)
        def highlight_pathogenicity(val):
            if val == "Pathogenic":
                return "background-color: #fee2e2; color: #991b1b; font-weight: bold;"
            elif val == "Benign":
                return "background-color: #dcfce7; color: #166534; font-weight: bold;"
            return ""

        try:
            if hasattr(df_display.style, "map"):
                styled_df = df_display.style.map(highlight_pathogenicity, subset=["Prediction"])
            else:
                styled_df = df_display.style.applymap(highlight_pathogenicity, subset=["Prediction"])
            st.dataframe(styled_df, use_container_width=True, height=350)
        except Exception:
            st.dataframe(df_display, use_container_width=True, height=350)

        # Download Report
        csv = df_display.to_csv(index=False).encode('utf-8')
        st.download_button(
            label="📥 Download Clinical Predictions CSV",
            data=csv,
            file_name="variant_pathogenicity_predictions.csv",
            mime="text/csv",
        )

with tab2:
    st.subheader("Model Performance & Feature Importance")
    c1, c2 = st.columns(2)
    
    with c1:
        st.markdown("### 🏆 Top Genomic Feature Importance")
        st.markdown("Derived from Gini impurity reduction across 100 Random Forest estimators:")
        feature_importance_data = {
            "CADD Phred": 0.2142,
            "REVEL Score": 0.1733,
            "Allele Frequency (AF)": 0.1468,
            "SIFT Score": 0.0861,
            "HIGH Impact (Frameshift/Splice)": 0.0703,
            "Synonymous Consequence": 0.0627,
            "LOW Impact": 0.0485,
            "SpliceAI Score": 0.0432,
            "MODIFIER Impact": 0.0368,
            "Read Quality (QUAL)": 0.0250
        }
        df_feat = pd.DataFrame(list(feature_importance_data.items()), columns=["Feature", "Importance"]).sort_values("Importance", ascending=True)
        st.bar_chart(df_feat.set_index("Feature"), horizontal=True)

    with c2:
        st.markdown("### 🎯 Supervised vs Unsupervised Performance")
        st.markdown("""
        * **Random Forest Classifier**:
          - **Test Accuracy**: 83.50%
          - **Sensitivity / Recall**: 93.69% (Prioritizes catching pathogenic mutations)
          - **Precision**: 80.00%
          - **ROC-AUC**: 0.9245
        
        * **K-Means Clustering (k=2)**:
          - **Silhouette Score**: 0.3242
          - Discovers high-deleteriousness clusters (Cluster 0: 717 mutations, 77.3% pathogenic) vs low-deleteriousness clusters (Cluster 1: 99.6% benign).
        """)
        
        cm_path = ML_LAB_DIR / "confusion_matrix.png"
        if cm_path.exists():
            st.image(str(cm_path), caption="Supervised Confusion Matrix (Test Set N=200)", width=420)

with tab3:
    st.subheader("Interactive Single Variant Predictor")
    st.markdown("Manually input genomic coordinates and annotation scores to test predictions on-the-fly:")
    
    with st.form("single_variant_form"):
        p_c1, p_c2, p_c3, p_c4 = st.columns(4)
        f_chrom = p_c1.text_input("Chromosome", "17")
        f_pos = p_c2.text_input("Position", "43044295")
        f_ref = p_c3.text_input("Reference Allele (REF)", "T")
        f_alt = p_c4.text_input("Alternate Allele (ALT)", "G")
        
        p_c5, p_c6, p_c7, p_c8 = st.columns(4)
        f_gene = p_c5.text_input("Gene Symbol", "BRCA1")
        f_consequence = p_c6.selectbox("Consequence", ["splice_donor_variant", "missense_variant", "frameshift_variant", "synonymous_variant", "stop_gained", "intron_variant"])
        f_cadd = p_c7.slider("CADD Phred Score", 0.0, 45.0, 35.0, 0.5)
        f_af = p_c8.number_input("Population Allele Frequency (AF)", 0.0, 1.0, 0.00005, format="%.5f")
        
        submit_btn = st.form_submit_button("🔮 Predict Pathogenicity", use_container_width=True)

    if submit_btn:
        test_var = [{
            "chrom": f_chrom,
            "pos": f_pos,
            "ref": f_ref,
            "alt": f_alt,
            "gene": f_gene,
            "info": f"MC={f_consequence};CADD={f_cadd};AF={f_af}"
        }]
        res_single = predict_variants.predict_on_variants(test_var)
        pred_item = res_single["variant_predictions"][0]
        
        st.divider()
        if pred_item["predicted_label"] == "Pathogenic":
            st.error(f"### 🔴 Prediction: PATHOGENIC ({pred_item['confidence_percent']}% Confidence)")
        else:
            st.success(f"### 🟢 Prediction: BENIGN ({pred_item['confidence_percent']}% Confidence)")
            
        st.markdown(f"**Unsupervised K-Means**: Assigned to `Cluster {pred_item['cluster']}`")
        st.markdown(f"**Biological Signals**: {pred_item['key_signals']}")
