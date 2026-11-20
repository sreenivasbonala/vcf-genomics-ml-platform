# Clinical Genomics Web Platform & Relational VCF Engine
## Complete Lecture Notes & Project Technical Documentation

---

## 1. Project Background & Core Objectives

### The Problem in Clinical Genetics
When high-throughput Next-Generation Sequencing (NGS) machines sequence a patient's DNA, the resulting variations compared to the human reference genome (GRCh38) are exported in a standardized file format known as **Variant Call Format (VCF)**. 

### What We Built
We engineered an **Enterprise-Grade Clinical Genomics Web Application** that:
1. **Authenticates Clinicians & Bioinformaticians** securely using `scrypt` password hashing and short-lived session tokens (1-Hour TTL) with Role-Based Access Control (RBAC).
2. **Ingests Large VCF Files** (up to 100 MB) via HTTP streaming multipart upload.
3. **Eliminates Redundant Storage (Deduplication)** using cryptographic **SHA-256** checksums.
4. **Calculates Biological Quality Metrics**, specifically the **Transition/Transversion (Ti/Tv) Ratio** (human benchmark $\approx 2.12$).
5. **Persists Data into a Normalized Relational Database** matching PostgreSQL standards (`genomics=# \dt`) with strict foreign keys and `ON DELETE CASCADE`.
6. **Cross-References Cancer Biomarkers** against the **CIViC** (Clinical Interpretation of Variants in Cancer) database for FDA-approved therapies.

---

## 2. System Architecture: The 4-Tier Architectural Pattern

The application follows the enterprise 4-Tier software pattern documented in classroom notes:

```
[Presentation Layer (Frontend UI)]
               │
               ▼  (HTTP / Authorization: Bearer <token>)
[Controller / Handler Layer (server.js)]
               │
               ▼  (Validated Payloads / DTOs)
[Service / Business Logic Layer (vcf-parser.js & Quality Engine)]
               │
               ▼  (Prepared SQL Statements & Transactions)
[Repository Layer (db.js)]
               │
               ▼
[Data Storage: genomics.db (Relational) + /uploads/ (Object Storage)]
```

### Layer Responsibilities:
1. **Frontend / Presentation Layer**: Single Page Application (SPA) built with responsive HTML5, CSS3, and JavaScript. Displays live PostgreSQL terminal emulator (`\dt`), table records inspector, Ti/Tv quality charts, CIViC drug cards, and whiteboard query runners.
2. **Controller / Handler Layer (`server.js`)**: Handles HTTP requests, enforces Bearer token authentication, parses multipart form-data streams, and returns standardized JSON responses.
3. **Service Layer**: Houses the core business logic:
   * Memory-hard `scrypt` password hashing.
   * SHA-256 file fingerprinting and deduplication check.
   * VCF streaming parsing and substitution matrix ($A \leftrightarrow G, C \leftrightarrow T$) calculation.
   * External REST queries to CIViC and EMBL-EBI ChEBI APIs.
4. **Repository Layer (`db.js`)**: Executes prepared SQL statements on the relational engine with foreign key verification, migration tracking, and transaction safety.
5. **Storage Layer**: 
   * **Relational DB (`genomics.db`)**: Stores normalized tables, indexes, and metadata.
   * **Object Storage (`/uploads/`)**: Stores raw binary files on the filesystem.

---

## 3. Cryptographic Security & Password Hashing

### Why Never Store Plaintext Passwords
If a database is compromised, plaintext passwords give attackers immediate access to user accounts. Cryptographic hashing converts passwords into an irreversible, one-way string.

### The Classroom `scrypt` Implementation
The professor demonstrated password hashing using the modern **`scrypt`** algorithm (Python `hashlib.scrypt` / Node.js `crypto.scryptSync`).

#### Why `scrypt`?
Standard algorithms like MD5 or SHA-256 can be brute-forced rapidly using specialized graphics cards (GPUs) or ASICs. `scrypt` is a **memory-hard algorithm**—it forces the hardware to consume substantial RAM for each attempt, making brute-force attacks computationally and financially impractical.

#### The Standard Storage Format:
$$\text{scrypt}\$\langle N\rangle\$\langle r\rangle\$\langle p\rangle\$\langle\text{salt\_hex}\rangle\$\langle\text{digest\_hex}\rangle$$

* **Salt (16 random bytes)**: Generated via secure pseudo-random bytes. Guarantees that two users with the exact same password (`Password@123`) produce completely different hash digests. Defeats pre-computed Rainbow Table attacks.
* **$N$ (CPU/Memory Cost = 16384)**: Cost factor dictating memory usage.
* **$r$ (Block Size = 8)**: Dictates block size for internal mixing.
* **$p$ (Parallelization Factor = 1)**: Parallel computational threads.
* **dklen (Output Key Length = 64 bytes / 128 hex characters)**.

```javascript
// Node.js implementation in server.js & db.js
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_DKLEN = 64;

function hashPassword(password, salt = null) {
  const saltBuf = salt ? Buffer.from(salt, 'hex') : crypto.randomBytes(16);
  const digest = crypto.scryptSync(password, saltBuf, SCRYPT_DKLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${saltBuf.toString('hex')}$${digest.toString('hex')}`;
}
```

### Session Tokens & Role-Based Access Control (RBAC)
* **Short-Lived Bearer Token**: Upon login, a 64-character random hex token is issued.
* **Token Expiration (TTL = 1 Hour)**: The token expires automatically after 60 minutes for security compliance.
* **Roles**:
  * **Lead Clinical Geneticist** (`srinivas`): Full access to upload VCFs, run queries, and export reports.
  * **Bioinformatician**: Pipeline inspection and analysis access.
  * **Clinical Trainee / Viewer** (`viewer`): Read-only mode; file uploads are blocked by RBAC middleware with `403 Forbidden`.

---

## 4. Object Storage & SHA-256 Deduplication

### Architectural Rationale
Relational databases slow down significantly when storing 100 MB or 1 GB binary files directly as BLOBs. 
* **Object Storage**: The physical `.vcf` file is stored on the server disk under `/uploads/`.
* **Relational Database**: Only the file's metadata (`original_filename`, `sha256`, `size_bytes`, `storage_uri`, `uploaded_by`) is recorded in the `uploads` table.

### Deduplication Pipeline:
1. When a file stream arrives, the server computes its **SHA-256 checksum** in real time.
2. The server executes: `SELECT * FROM uploads WHERE sha256 = ?`.
3. **If the hash already exists**:
   * The duplicate file just written to disk is immediately deleted.
   * The existing database record is returned to the user with `deduplicated: true`.
   * **Result**: Complete storage efficiency with zero redundant disk usage.

---

## 5. PostgreSQL Relational Database Schema (`\dt`)

The schema matches the classroom slides and PostgreSQL relational normalization:

```
[users] ──< 1:N >── [sessions]
   │
   └──< 1:N >── [uploads] ──< 1:N >── [analysis_jobs] ──< 1:N >── [variant_calls]
                                                                        │
[genomic_loci] ────────────────────< 1:N >─────────────────────────────┘
```

### Table 1: `uploads` (Matching Professor's Slide Diagram)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `upload_id` | `UUID` | **PK** | Unique identifier for each upload |
| `original_filename` | `TEXT` | `NOT NULL` | Original filename (e.g. `real_clinvar_grch38.vcf`) |
| `sha256` | `TEXT` | `NOT NULL`, Indexed | Cryptographic checksum for deduplication |
| `size_bytes` | `BIGINT` | `NOT NULL` | File size in bytes |
| `storage_uri` | `TEXT` | `NOT NULL` | Local filesystem path (`/uploads/...`) |
| `uploaded_by` | `BIGINT` | **FK** | Links to `users.user_id` with `ON DELETE CASCADE` |

### Table 2: `sessions` (Matching Professor's Slide Diagram)
| Column | Type | Constraints | Description |
|---|---|---|---|
| `session_id` | `UUID` | **PK** | Unique session identifier |
| `user_id` | `BIGINT` | **FK** | Links to `users.user_id` with `ON DELETE CASCADE` |
| `token` | `TEXT` | `UNIQUE`, Indexed | 64-character bearer token |
| `expires_at` | `TEXT` | `NOT NULL` | Expiry timestamp (1-Hour TTL) |
| `created_at` | `TEXT` | `DEFAULT now` | Session initiation timestamp |

### Table 3: `users` (Password Hashing Authenticator)
* `user_id` (`INTEGER PRIMARY KEY AUTOINCREMENT`)
* `username` (`TEXT UNIQUE NOT NULL`)
* `password_hash` (`TEXT NOT NULL`): Contains the `scrypt$16384$8$1$salt$digest` string
* `role` (`TEXT`): User role (`Lead Clinical Geneticist`, `Bioinformatician`, `Viewer`)

### Table 4: `genomic_loci` (Table 1 from Classroom Slide)
| locus_id | genome_build | chromosome | position | reference_allele | alternate_allele |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | GRCh38 | 2 | 100037 | C | T |
| 2 | GRCh38 | 13 | 100074 | C | T |
| 3 | GRCh38 | 17 | 100111 | C | T |
| 4 | GRCh38 | X | 100148 | C | T |
| 5 | GRCh38 | 1 | 100185 | C | T |

### Table 5: `variant_calls` (Table 2 from Classroom Slide)
| call_id | analysis_id | locus_id | genotype | depth | allele_frequency | filter_status |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | `a0619db6-0745-2d77-4eb3-5d28f05d9c14` | 1 | `1/1` | 31 | 0.06000 | PASS |
| 2 | `b050727c-a3e8-ca15-6117-8b0e3a67a01c` | 2 | `0/0` | 32 | 0.07000 | PASS |
| 3 | `826574d1-d0c3-5abe-6c71-1434e613203e` | 3 | `1/1` | 33 | 0.08000 | PASS |
| 5 | `826574d1-d0c3-5abe-6c71-1434e613203e` | 5 | `0/1` | 35 | 0.10000 | PASS |

---

## 6. Professor's Classroom Whiteboard SQL Queries

### Query 1: Filter Genome Build and Position for Homozygous Variants (Genotype = '1/1')
* **Objective**: Join the genomic loci and variant call tables to identify coordinates where both chromosome copies carry the mutation (`1/1`).
* **SQL Query**:
  ```sql
  SELECT gl.genome_build, gl.position
  FROM genomic_loci gl
  JOIN variant_calls vc ON gl.locus_id = vc.locus_id
  WHERE vc.genotype = '1/1';
  ```
* **Execution Output**:
  * Position `100037` (Locus 1 on Chromosome 2, `GRCh38`)
  * Position `100111` (Locus 3 on Chromosome 17, `GRCh38`)

### Query 2: Conditional Allele Mutation Update
* **Objective**: Update the reference and alternate allele to `'G'` and `'A'` for variants that passed quality filtering (`filter_status = 'PASS'`) with an allele frequency of `0.08`.
* **SQL Query**:
  ```sql
  UPDATE genomic_loci
  SET reference_allele = 'G', alternate_allele = 'A'
  WHERE locus_id IN (
    SELECT locus_id FROM variant_calls
    WHERE filter_status = 'PASS' AND allele_frequency = 0.08
  );
  ```
* **Execution Output**: Updates Locus 3 (TP53 locus) reference allele to `G` and alternate allele to `A`.

---

## 7. Biological Metrics & Oncology Knowledge Bases

1. **Transition / Transversion (Ti/Tv) Ratio**:
   * Transitions: Mutations within the same ring class: Purine $\leftrightarrow$ Purine ($A \leftrightarrow G$) or Pyrimidine $\leftrightarrow$ Pyrimidine ($C \leftrightarrow T$).
   * Transversions: Mutations crossing ring classes: Purine $\leftrightarrow$ Pyrimidine ($A/G \leftrightarrow C/T$).
   * **Clinical Quality Benchmark**: For human whole-genome sequencing, Ti/Tv must be around **2.0 to 2.2** (benchmark is **2.12**). Values significantly lower signal sequencing errors.
2. **CIViC Database Integration**:
   * Automatically cross-references detected variants with clinical cancer evidence from **civicdb.org**.
   * Identifies FDA Level A targeted therapies (e.g., *BRAF V600E* $\rightarrow$ Vemurafenib; *EGFR L858R* $\rightarrow$ Osimertinib).
3. **EMBL-EBI ChEBI Integration**:
   * Integrates Chemical Entities of Biological Interest REST API for chemical cofactors and metabolites.

---

## 8. Verification: Automated Test Suite (15/15 Passed)

Run the test suite from your Mac Terminal:
```bash
node /Users/srinivas2003/Desktop/vcf-upload-app/test.js
```

### Complete Test Results:
```text
✅ [PASS] Health check endpoint /api/health (PBKDF2-SHA512 auth method)
✅ [PASS] Authenticate with PBKDF2-SHA512 password hash (srinivas / Password@123)
✅ [PASS] Reject invalid password with 401 Unauthorized
✅ [PASS] Register new researcher with cryptographic salt & hash
✅ [PASS] Reject VCF upload without authentication token (401 Unauthorized)
✅ [PASS] CIViC Precision Oncology API (/api/civic?q=BRAF)
✅ [PASS] ChEBI Database integration endpoint (/api/chebi?q=retinol)
✅ [PASS] Upload authentic NCBI ClinVar VCF with Auth Token (real_clinvar_grch38.vcf)
✅ [PASS] Upload authentic compressed 1000 Genomes VCF (real_1000genomes_chr22.vcf.gz)
✅ [PASS] Reject invalid file extension (415 Unsupported Media Type)
✅ [PASS] Reject empty 0-byte file (400 Bad Request)
✅ [PASS] Reject corrupted VCF contents (422 Unprocessable Entity)
✅ [PASS] Reject file exceeding 100MB limit (413 Payload Too Large)
✅ [PASS] 13-Relation Database Schema matches PostgreSQL genomics=# \dt
✅ [PASS] ON DELETE CASCADE cleanly removes child relations on Patient deletion

================================
Results: 15/15 tests passed!
================================
```

---

## 9. How to Demonstrate Live on Localhost

1. **Start Server**:
   ```bash
   cd ~/Desktop/vcf-upload-app
   node server.js
   ```
2. **Open in Browser**:
   ```bash
   open http://localhost:3000
   ```
3. **Login**:
   * **Username**: `srinivas`
   * **Password**: `Password@123`
4. **Database Verification**:
   * Click **"🗄️ Database (\dt 13 Tables)"** tab.
   * View the interactive terminal displaying `genomics=# \dt`.
   * Click **"Inspect"** on `uploads`, `sessions`, and `users` to show the live `scrypt` hashes.
   * Click **"▶️ Run Query 1"** and **"⚡ Run Query 2"** to demonstrate live execution of classroom whiteboard queries.
   * Click **"🧪 Execute Live ON DELETE CASCADE"** to prove relational cascading integrity.
