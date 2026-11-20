# 🧬 Clinical Genomics & ML Variant Pathogenicity Platform

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Scikit-Learn](https://img.shields.io/badge/scikit--learn-ML%20Pipelines-F7931E?logo=scikit-learn&logoColor=white)](https://scikit-learn.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An enterprise-grade, end-to-end clinical genomics web application and machine learning engine for **Variant Call Format (VCF v4.x)** inspection, genomic feature engineering, and automated **Pathogenicity Prediction** (Pathogenic vs. Benign).

Developed with **Zero External Node Dependencies** (pure Node.js 22 built-ins + native SQLite) coupled with a dedicated **Python 3.11 Scikit-Learn ML Lab**.

---

## 🌟 Key Capabilities

### 1. 🧬 High-Performance VCF Streaming & Quality Control
- **Strict 100 MB Guardrails**: Client-side validation, server-side `Content-Length` enforcement, and chunk-level streaming guards to terminate rogue transfers.
- **VCF v4.x & vCard Ingestion**: On-the-fly Gzip decompression (`.vcf.gz`), chromosome syntax validation, multi-sample genotype parsing (`FORMAT` & sample columns).
- **Embedded SQLite Genomic Store**: Fully persisted metadata, audit logs, and variant indices using native `node:sqlite`.

### 2. 🔬 Genomic Feature Engineering Engine
Extracts sample-level and variant-level biological features directly from uploaded VCF records:
- **Ti/Tv Ratio**: Nucleotide transition vs. transversion mechanics.
- **Variant Burden & Types**: SNV, insertion, deletion counts and deletion burden.
- **Genotype Distribution**: Heterozygous to homozygous alternate (`Het/Hom`) ratio.
- **Biological Effect Annotation**: Missense, frameshift, splice donor/acceptor, synonymous consequence classification.
- **Functional Impact Scores**: CADD Phred, REVEL, SIFT, SpliceAI, and population Allele Frequency (AF).

### 3. 🤖 Machine Learning Inference & Training Lab (`ml-lab/`)
- **Supervised Learning (Random Forest Classifier)**:
  - Trained on 1,000 clinically annotated variants.
  - **Metrics**: 83.50% Accuracy, 93.69% Recall, 0.9245 ROC-AUC.
  - Automatically flags high-risk mutations (e.g., *BRCA1*, *BRCA2*, *BRAF*, *TP53*).
- **Unsupervised Learning (K-Means Clustering, k=2)**:
  - Discovers natural genomic clustering (High-Risk/Damaging vs. Tolerated/Benign clusters) without ground-truth labels.
  - Silhouette Score: `0.3242`.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Web Client / UI                     │
│    Drag-and-Drop VCF Ingestion & Interactive Dashboard  │
└──────────────────────────┬─────────────────────────────┘
                           │ (HTTP Streaming)
┌──────────────────────────▼─────────────────────────────┐
│             Node.js 22 Core Server (Port 3000)          │
│   • 100 MB Stream Limiter       • Auth & Session Mgr   │
│   • VCF Parser & QC Engine      • Native SQLite DB     │
└──────────────────────────┬─────────────────────────────┘
                           │ (Subprocess Pipe / JSON)
┌──────────────────────────▼─────────────────────────────┐
│            Python 3.11 Machine Learning Lab            │
│   • Feature Extractor           • Variant Pathogenicity│
│   • Scikit-Learn Pipeline       • K-Means Clustering   │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start with Docker (Recommended)

The easiest way to run the entire stack (Node.js 22 + Python ML environment) is using Docker:

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

### 1. Clone the Repository
```bash
git clone https://github.com/sreenivasbonala/vcf-genomics-ml-platform.git
cd vcf-genomics-ml-platform
```

### 2. Run with Docker Compose
```bash
docker compose up -d --build
```
Your application will immediately be live at:
👉 **http://localhost:3000**

To view logs or stop the container:
```bash
docker compose logs -f
docker compose down
```

### 3. Or Run with Plain Docker CLI
```bash
# Build the image
docker build -t vcf-genomics-ml-app .

# Run the container
docker run -d -p 3000:3000 --name vcf-platform vcf-genomics-ml-app
```

---

## 💻 Local Development Setup (Without Docker)

### Prerequisites
- **Node.js** >= v22.5.0 (requires native `node:sqlite`)
- **Python** >= 3.10 with `pip`

### Step 1: Install Python ML Dependencies
```bash
pip install -r requirements.txt
```

### Step 2: Train or Verify ML Models
```bash
cd ml-lab
python train_variant_model.py
cd ..
```

### Step 3: Start Node.js Application
```bash
npm start
# or: node server.js
```
Open **http://localhost:3000** in your browser.

---

## 📡 API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/health` | `GET` | Health status, uptime, storage stats, and database check |
| `/api/upload` | `POST` | Streams and inspects uploaded VCF files up to 100 MB |
| `/api/ml/predict` | `POST` | Runs Random Forest & K-Means prediction on variant list |
| `/api/ml/metrics` | `GET` | Returns trained model accuracy, ROC-AUC, confusion matrix |
| `/api/samples/:file`| `GET` | Downloads sample VCFs (`sample_variants.vcf`, etc.) |
| `/api/auth/login` | `POST` | Authenticates clinical analyst credentials |

---

## 📁 Repository Structure

```
├── Dockerfile                   # Multi-runtime Dockerfile (Node 22 + Python 3.11 venv)
├── docker-compose.yml           # Compose specification with volume persistence
├── requirements.txt             # Python ML dependencies (scikit-learn, pandas, numpy)
├── package.json                 # Node.js service scripts
├── server.js                    # Streaming HTTP engine, router, and ML integration
├── db.js                        # Native SQLite genomic database access layer
├── ml-lab/                      # Machine Learning Subsystem
│   ├── train_variant_model.py   # Training script for Random Forest & K-Means
│   ├── predict_variants.py      # Inference interface invoked by server.js
│   ├── variant_pathogenicity_pipeline.joblib  # Trained model weights
│   ├── variant_kmeans.joblib    # Trained cluster model
│   └── ml_metrics.json          # Model benchmark statistics
├── public/                      # Responsive frontend web application
│   ├── index.html               # Genomics dashboard UI
│   ├── style.css                # Visual theme & dark mode
│   └── app.js                   # Client-side streaming & chart rendering
└── test-samples/                # Valid & invalid VCF 4.2 datasets for automated QC
```

---

## 🛡️ License
Distributed under the MIT License. Developed for clinical genomics research and bioinformatics workflows.
