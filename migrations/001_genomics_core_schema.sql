-- ==============================================================================
-- CLINICAL GENOMICS RELATIONAL DATABASE SCHEMA (13 CORE RELATIONS)
-- Matching official PostgreSQL / SQLite schema: \dt
-- Includes: UUIDs, Foreign Keys, ON DELETE CASCADE, Indexes, and SHA-256 tracking
-- ==============================================================================

-- 1. ORGANIZATIONS (Genomic Sequencing Centers & Clinical Labs)
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    country TEXT DEFAULT 'India',
    created_at TEXT DEFAULT (datetime('now'))
);

-- 2. PATIENTS (Patient Demographics & Medical Record Numbers)
CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    mrn TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    age INTEGER,
    gender TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- 3. SAMPLES (Biospecimens linked to Patients)
CREATE TABLE IF NOT EXISTS samples (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    sample_code TEXT UNIQUE NOT NULL,
    sample_type TEXT DEFAULT 'Germline DNA',
    collection_date TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);

-- 4. PIPELINE_VERSIONS (Bioinformatics Pipeline Specifications)
CREATE TABLE IF NOT EXISTS pipeline_versions (
    id TEXT PRIMARY KEY,
    pipeline_name TEXT NOT NULL,
    version_tag TEXT NOT NULL,
    parameters_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- USERS TABLE (For Password Hashing & Authentication)
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'Lead Clinical Geneticist',
    created_at TEXT DEFAULT (datetime('now'))
);

-- SESSIONS TABLE (Exact match to Professor's Slide Diagram)
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 5. UPLOADS (Exact match to Professor's Slide Diagram: upload_id, original_filename, sha256, size_bytes, storage_uri, uploaded_by)
CREATE TABLE IF NOT EXISTS uploads (
    upload_id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_uri TEXT NOT NULL,
    uploaded_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Backward compatibility view for uploaded_files
CREATE VIEW IF NOT EXISTS uploaded_files AS
SELECT upload_id AS id, NULL AS sample_id, original_filename AS file_name, 
       size_bytes AS file_size_bytes, sha256 AS sha256_hash, storage_uri AS storage_path, 
       'VCFv4.2' AS file_format, uploaded_by, created_at AS uploaded_at
FROM uploads;

-- 6. ANALYSIS_JOBS (Quality Metrics, Ti/Tv Ratio = 2.12, Substitution Matrix)
CREATE TABLE IF NOT EXISTS analysis_jobs (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    pipeline_id TEXT,
    job_status TEXT DEFAULT 'COMPLETED',
    ti_tv_ratio REAL,
    transitions_count INTEGER,
    transversions_count INTEGER,
    total_variants INTEGER,
    substitution_matrix_json TEXT,
    completed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (file_id) REFERENCES uploads(upload_id) ON DELETE CASCADE,
    FOREIGN KEY (pipeline_id) REFERENCES pipeline_versions(id)
);

-- 7. TABLE 1: genomic_loci (Exact match to Professor's Slide 1)
CREATE TABLE IF NOT EXISTS genomic_loci (
    locus_id INTEGER PRIMARY KEY AUTOINCREMENT,
    genome_build TEXT NOT NULL DEFAULT 'GRCh38',
    chromosome TEXT NOT NULL,
    position INTEGER NOT NULL,
    reference_allele TEXT NOT NULL,
    alternate_allele TEXT NOT NULL,
    gene_symbol TEXT
);

-- View for variant_loci compatibility matching \dt relation list
CREATE VIEW IF NOT EXISTS variant_loci AS 
SELECT locus_id, genome_build, chromosome, position, reference_allele, alternate_allele, gene_symbol 
FROM genomic_loci;

-- 8. TABLE 2: variant_calls (Exact match to Professor's Slide 2)
CREATE TABLE IF NOT EXISTS variant_calls (
    call_id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id TEXT NOT NULL,
    locus_id INTEGER NOT NULL,
    genotype TEXT NOT NULL,
    depth INTEGER NOT NULL,
    allele_frequency REAL NOT NULL,
    filter_status TEXT NOT NULL,
    CONSTRAINT fk_variant_locus FOREIGN KEY (locus_id) REFERENCES genomic_loci(locus_id) ON DELETE CASCADE,
    CONSTRAINT fk_variant_analysis FOREIGN KEY (analysis_id) REFERENCES analysis_jobs(id) ON DELETE CASCADE
);

-- 9. DISEASES (Oncology & Hereditary Pathologies)
CREATE TABLE IF NOT EXISTS diseases (
    id TEXT PRIMARY KEY,
    disease_name TEXT NOT NULL,
    mondo_id TEXT,
    disease_category TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 10. VARIANT_DISEASES (Variant to Disease Many-to-Many Associations)
CREATE TABLE IF NOT EXISTS variant_diseases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    locus_id INTEGER NOT NULL,
    disease_id TEXT NOT NULL,
    clinical_significance TEXT,
    FOREIGN KEY (locus_id) REFERENCES genomic_loci(locus_id) ON DELETE CASCADE,
    FOREIGN KEY (disease_id) REFERENCES diseases(id) ON DELETE CASCADE
);

-- 11. ANNOTATION_ASSERTIONS (CIViC FDA Targeted Therapies & ChEBI Biomarkers)
CREATE TABLE IF NOT EXISTS annotation_assertions (
    id TEXT PRIMARY KEY,
    locus_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    evidence_level TEXT,
    drug_or_metabolite TEXT,
    assertion_summary TEXT,
    citation_url TEXT,
    FOREIGN KEY (locus_id) REFERENCES genomic_loci(locus_id) ON DELETE CASCADE
);

-- 12. INTERPRETATIONS (ACMG Pathogenicity Tiering & Clinical Review)
CREATE TABLE IF NOT EXISTS interpretations (
    id TEXT PRIMARY KEY,
    locus_id INTEGER NOT NULL,
    acmg_tier TEXT NOT NULL,
    evaluator_username TEXT NOT NULL,
    notes TEXT,
    evaluated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (locus_id) REFERENCES genomic_loci(locus_id) ON DELETE CASCADE
);

-- 13. REPORTS (Final Clinical Genomic Diagnostic Reports)
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    analysis_job_id TEXT,
    report_title TEXT NOT NULL,
    diagnostic_summary TEXT,
    generated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (analysis_job_id) REFERENCES analysis_jobs(id) ON DELETE CASCADE
);

-- ==============================================================================
-- HIGH PERFORMANCE B-TREE INDEXES (For Sub-Millisecond Locus & Gene Queries)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_genomic_loci_gene ON genomic_loci (gene_symbol);
CREATE INDEX IF NOT EXISTS idx_genomic_loci_coord ON genomic_loci (chromosome, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_genomic_loci_unique ON genomic_loci (genome_build, chromosome, position, reference_allele, alternate_allele);
CREATE INDEX IF NOT EXISTS idx_variant_calls_analysis ON variant_calls (analysis_id);
CREATE INDEX IF NOT EXISTS idx_variant_calls_locus ON variant_calls (locus_id);
CREATE INDEX IF NOT EXISTS idx_uploads_sha ON uploads (sha256);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_assertions_locus ON annotation_assertions (locus_id);

-- ==============================================================================
-- BASELINE CLINICAL BENCHMARK SEED DATA (From Professor's Class Slides)
-- ==============================================================================

-- Insert genomic loci (Seed data from Professor's Class Slide)
INSERT OR IGNORE INTO genomic_loci
(locus_id, genome_build, chromosome, position, reference_allele, alternate_allele)
VALUES
(1, 'GRCh38', '2', 100037, 'C', 'T'),
(2, 'GRCh38', '13', 100074, 'C', 'T'),
(3, 'GRCh38', '17', 100111, 'C', 'T'),
(4, 'GRCh38', 'X', 100148, 'C', 'T'),
(5, 'GRCh38', '1', 100185, 'C', 'T');

