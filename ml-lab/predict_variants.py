#!/usr/bin/env python3
"""
predict_variants.py
===================
Inference Engine for Variant Pathogenicity & Feature Engineering

Features Extracted from VCF:
1. Transition / Transversion Classification
2. Ti/Tv Ratio
3. Total SNVs Count
4. Total Insertions Count
5. Total Deletions Count
6. Het/Hom Ratio (0/1 vs 1/1)
7. Rare Variant Count (AF < 0.01)
8. High-Impact Mutation Count (Frameshift, Stop-Gained, Splice Sites)

Provides CLI & JSON stdin interface for Node.js backend integration.
"""

import sys
import os
import json
import numpy as np
import pandas as pd
import joblib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'variant_pathogenicity_pipeline.joblib')
KMEANS_PATH = os.path.join(BASE_DIR, 'variant_kmeans.joblib')
METRICS_PATH = os.path.join(BASE_DIR, 'ml_metrics.json')

# Load models once
pipeline = None
kmeans = None

def load_models():
    global pipeline, kmeans
    if pipeline is None and os.path.exists(MODEL_PATH):
        pipeline = joblib.load(MODEL_PATH)
    if kmeans is None and os.path.exists(KMEANS_PATH):
        kmeans = joblib.load(KMEANS_PATH)

def infer_variant_type(ref, alt):
    ref_len = len(ref)
    alt_len = len(alt)
    if ref_len == 1 and alt_len == 1:
        return 'SNV', 1
    elif ref_len < alt_len:
        return 'insertion', alt_len - ref_len
    elif ref_len > alt_len:
        return 'deletion', ref_len - alt_len
    else:
        return 'SNV', 1

def infer_consequence_and_impact(v_type, info_str=""):
    info_upper = (info_str or "").upper()
    
    # Check for splice, stop, frameshift in info
    if 'SPLICE_ACCEPTOR' in info_upper or 'SPLICEACCEPTOR' in info_upper:
        return 'splice_acceptor_variant', 'HIGH'
    if 'SPLICE_DONOR' in info_upper or 'SPLICEDONOR' in info_upper:
        return 'splice_donor_variant', 'HIGH'
    if 'STOP_GAINED' in info_upper or 'STOPGAINED' in info_upper or 'NONSENSE' in info_upper:
        return 'stop_gained', 'HIGH'
    if 'FRAMESHIFT' in info_upper:
        return 'frameshift_variant', 'HIGH'
    if 'SYNONYMOUS' in info_upper:
        return 'synonymous_variant', 'LOW'
    if 'INTRON' in info_upper:
        return 'intron_variant', 'MODIFIER'
    if 'MISSENSE' in info_upper:
        return 'missense_variant', 'MODERATE'

    # Fallback heuristic based on variant type
    if v_type in ('insertion', 'deletion'):
        return 'frameshift_variant', 'HIGH'
    return 'missense_variant', 'MODERATE'

def parse_allele_frequency(info_str):
    if not info_str:
        return 0.005
    for tag in ['AF=', 'AF_TGP=', 'AF_EXAC=', 'AF_ESP=']:
        if tag in info_str:
            try:
                part = info_str.split(tag)[1].split(';')[0].split(',')[0]
                val = float(part)
                if 0 <= val <= 1:
                    return val
            except:
                pass
    return 0.005

def parse_cadd(info_str, default=21.0):
    if 'CADD=' in info_str or 'CADD_PHRED=' in info_str:
        try:
            tag = 'CADD=' if 'CADD=' in info_str else 'CADD_PHRED='
            return float(info_str.split(tag)[1].split(';')[0])
        except:
            pass
    return default

def parse_qual(qual_str, default=85.0):
    try:
        if qual_str and qual_str != '.':
            return float(qual_str)
    except:
        pass
    return default

def engineer_sample_features(variants):
    """
    Computes the 8 sample-level features requested by the instructor:
    1. Transitions / Transversions classification
    2. Ti/Tv ratio
    3. Total SNVs count
    4. Total insertions count
    5. Total deletions count
    6. Het/Hom ratio (0/1 vs 1/1)
    7. Rare variant count (AF < 0.01)
    8. High-impact count (HIGH severity)
    """
    transitions = 0
    transversions = 0
    snv_count = 0
    ins_count = 0
    del_count = 0
    het_count = 0
    hom_alt_count = 0
    hom_ref_count = 0
    rare_count = 0
    high_impact_count = 0

    ti_pairs = {('A', 'G'), ('G', 'A'), ('C', 'T'), ('T', 'C')}

    for v in variants:
        ref = (v.get('ref') or '').upper()
        alt = (v.get('alt') or '').upper()
        info = v.get('info') or ''
        genotype = v.get('genotype') or '0/1'

        # SNV / Indel
        v_type, length = infer_variant_type(ref, alt)
        if v_type == 'SNV':
            snv_count += 1
            if len(ref) == 1 and len(alt) == 1:
                if (ref, alt) in ti_pairs:
                    transitions += 1
                else:
                    transversions += 1
        elif v_type == 'insertion':
            ins_count += 1
        elif v_type == 'deletion':
            del_count += 1

        # Genotype & Het/Hom
        if '0/1' in genotype or '1/0' in genotype:
            het_count += 1
        elif '1/1' in genotype:
            hom_alt_count += 1
        elif '0/0' in genotype:
            hom_ref_count += 1
        else:
            het_count += 1

        # Rare variants
        af = parse_allele_frequency(info)
        if af < 0.01:
            rare_count += 1

        # High impact
        consequence, impact = infer_consequence_and_impact(v_type, info)
        if impact == 'HIGH':
            high_impact_count += 1

    titv_ratio = round(transitions / transversions, 2) if transversions > 0 else (transitions if transitions > 0 else 0.0)
    hethom_ratio = round(het_count / hom_alt_count, 2) if hom_alt_count > 0 else het_count

    return {
        "transitions": transitions,
        "transversions": transversions,
        "titv_ratio": titv_ratio,
        "total_snvs": snv_count,
        "total_insertions": ins_count,
        "total_deletions": del_count,
        "het_count": het_count,
        "hom_alt_count": hom_alt_count,
        "hethom_ratio": hethom_ratio,
        "rare_variant_count": rare_count,
        "rare_variant_percentage": round((rare_count / max(1, len(variants))) * 100, 1),
        "high_impact_count": high_impact_count,
        "high_impact_percentage": round((high_impact_count / max(1, len(variants))) * 100, 1)
    }

def predict_on_variants(variants_input):
    load_models()
    if pipeline is None:
        raise RuntimeError("Trained pipeline model not found. Run train_variant_model.py first.")

    rows = []
    metadata_list = []

    for v in variants_input:
        ref = (v.get('ref') or 'A').upper()
        alt = (v.get('alt') or 'G').upper().split(',')[0]
        v_type, v_len = infer_variant_type(ref, alt)
        info_str = v.get('info') or ''

        consequence, impact = infer_consequence_and_impact(v_type, info_str)
        af = v.get('allele_frequency')
        if af is None or pd.isna(af):
            af = parse_allele_frequency(info_str)

        qual = v.get('qual')
        qual_val = parse_qual(qual)

        cadd = v.get('CADD_phred')
        if cadd is None or pd.isna(cadd):
            cadd = parse_cadd(info_str)

        revel = v.get('REVEL_score')
        if revel is None or pd.isna(revel):
            revel = 0.85 if impact == 'HIGH' else (0.55 if impact == 'MODERATE' else 0.15)

        sift = v.get('SIFT_score')
        if sift is None or pd.isna(sift):
            sift = 0.02 if impact == 'HIGH' else (0.15 if impact == 'MODERATE' else 0.65)

        spliceai = v.get('SpliceAI_score')
        if spliceai is None or pd.isna(spliceai):
            spliceai = 0.75 if 'splice' in consequence else 0.05

        filter_val = v.get('filter') or 'PASS'
        genotype = v.get('genotype') or '0/1'
        zygosity = 'heterozygous' if ('0/1' in genotype or '1/0' in genotype) else ('homozygous_alt' if '1/1' in genotype else 'homozygous_ref')

        row = {
            'variant_length': int(v_len),
            'CADD_phred': float(cadd),
            'REVEL_score': float(revel),
            'SIFT_score': float(sift),
            'SpliceAI_score': float(spliceai),
            'allele_frequency': float(af),
            'QUAL': float(qual_val),
            'variant_type': v_type,
            'consequence': consequence,
            'impact': impact,
            'FILTER': filter_val,
            'genotype': genotype,
            'zygosity': zygosity
        }
        rows.append(row)
        metadata_list.append({
            'chrom': v.get('chrom') or 'chr1',
            'pos': v.get('pos') or '0',
            'id': v.get('id') or '.',
            'ref': ref,
            'alt': alt,
            'gene': v.get('gene') or '-'
        })

    df_inf = pd.DataFrame(rows)
    probs = pipeline.predict_proba(df_inf)[:, 1]
    preds = (probs >= 0.5).astype(int)

    # K-Means clustering
    clusters = [0] * len(df_inf)
    if kmeans is not None:
        try:
            preprocessor = pipeline.named_steps['preprocessor']
            X_trans = preprocessor.transform(df_inf)
            clusters = kmeans.predict(X_trans).tolist()
        except Exception as e:
            pass

    results = []
    for i in range(len(df_inf)):
        prob = float(probs[i])
        pred_label = "Pathogenic" if preds[i] == 1 else "Benign"
        conf_pct = round((prob if preds[i] == 1 else 1.0 - prob) * 100, 1)

        # Build rational key signals
        signals = []
        if df_inf.loc[i, 'CADD_phred'] >= 25:
            signals.append(f"CADD Phred {df_inf.loc[i, 'CADD_phred']:.1f} (Deleterious)")
        if df_inf.loc[i, 'impact'] == 'HIGH':
            signals.append(f"High Impact ({df_inf.loc[i, 'consequence']})")
        if df_inf.loc[i, 'allele_frequency'] < 0.001:
            signals.append(f"Ultra-Rare AF ({df_inf.loc[i, 'allele_frequency']:.5f})")
        if df_inf.loc[i, 'REVEL_score'] >= 0.6:
            signals.append(f"REVEL {df_inf.loc[i, 'REVEL_score']:.2f} (Pathogenic range)")
        if not signals:
            signals.append("Benign / Synonymous Profile")

        res_item = {
            "chrom": metadata_list[i]['chrom'],
            "pos": metadata_list[i]['pos'],
            "id": metadata_list[i]['id'],
            "ref": metadata_list[i]['ref'],
            "alt": metadata_list[i]['alt'],
            "gene": metadata_list[i]['gene'],
            "consequence": df_inf.loc[i, 'consequence'],
            "impact": df_inf.loc[i, 'impact'],
            "predicted_label": pred_label,
            "pathogenicity_probability": round(prob, 4),
            "confidence_percent": conf_pct,
            "cluster": int(clusters[i]),
            "cadd_score": round(float(df_inf.loc[i, 'CADD_phred']), 1),
            "revel_score": round(float(df_inf.loc[i, 'REVEL_score']), 3),
            "allele_frequency": float(df_inf.loc[i, 'allele_frequency']),
            "key_signals": ", ".join(signals)
        }
        results.append(res_item)

    # Compute overall sample features
    engineered_sample_features = engineer_sample_features(variants_input)

    return {
        "engineered_sample_features": engineered_sample_features,
        "variant_predictions": results,
        "summary": {
            "total_tested": len(results),
            "predicted_pathogenic": sum(1 for r in results if r['predicted_label'] == 'Pathogenic'),
            "predicted_benign": sum(1 for r in results if r['predicted_label'] == 'Benign')
        }
    }

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--metrics':
        if os.path.exists(METRICS_PATH):
            with open(METRICS_PATH, 'r') as f:
                print(f.read())
        else:
            print(json.dumps({"error": "Metrics file not found. Run training first."}))
        return

    # Read JSON array of variants from stdin
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print(json.dumps({"error": "Empty stdin input"}))
            return
        input_data = json.loads(raw_input)
        if isinstance(input_data, dict) and "variants" in input_data:
            variants = input_data["variants"]
        elif isinstance(input_data, list):
            variants = input_data
        else:
            variants = [input_data]

        output = predict_on_variants(variants)
        print(json.dumps(output, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
