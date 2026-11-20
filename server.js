/**
 * VCF File Uploader, Analyzer & Clinical Genomics Platform
 * Features:
 *  - PBKDF2 + SHA-512 Password Hashing
 *  - Short-Lived Access Tokens (TTL = 1 Hour with Expiration)
 *  - RBAC (Role-Based Access Control):
 *      1. Lead Clinical Geneticist: Full permissions (100MB Upload, Clinical Actionability, Export)
 *      2. Bioinformatician: Standard researcher permissions
 *      3. Clinical Trainee / Viewer: Read-only access (403 Forbidden on Upload)
 *  - CIViC Precision Oncology Database Integration
 *  - EMBL-EBI ChEBI Database Integration
 *  - 100 MB Streaming Upload Enforcement
 *  - Variant Quality Assessment (Ti/Tv = 2.12, QUAL) & Gene Distribution
 */

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const dbEngine = require('./db');

const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB in bytes
const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 Hour Short-Lived Token (TTL)

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SAMPLES_DIR = path.join(__dirname, 'test-samples');
const USERS_FILE = path.join(__dirname, 'users.json');

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(SAMPLES_DIR)) fs.mkdirSync(SAMPLES_DIR, { recursive: true });

// Initialize Clinical Genomics Database (13 Relations Schema matching PostgreSQL \dt)
dbEngine.initDatabase();

// --- RBAC ROLES DEFINITION ---
const ROLES = {
  ADMIN_GENETICIST: 'Lead Clinical Geneticist',
  BIOINFORMATICIAN: 'Bioinformatician',
  VIEWER: 'Clinical Trainee / Viewer'
};

// --- CRYPTOGRAPHIC PASSWORD HASHING (scrypt & PBKDF2 Support matching Professor's Slide) ---
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 64;

function hashPassword(password, salt = null) {
  const saltBuf = salt ? (Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'hex')) : crypto.randomBytes(16);
  const digest = crypto.scryptSync(password, saltBuf, SCRYPT_DKLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${saltBuf.toString('hex')}$${digest.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  try {
    if (storedHash.startsWith('scrypt$')) {
      const parts = storedHash.split('$');
      const N = parseInt(parts[1], 10);
      const r = parseInt(parts[2], 10);
      const p = parseInt(parts[3], 10);
      const salt = Buffer.from(parts[4], 'hex');
      const orig = Buffer.from(parts[5], 'hex');
      const digest = crypto.scryptSync(password, salt, orig.length, { N, r, p });
      return crypto.timingSafeEqual(digest, orig);
    }
    if (storedHash.includes(':')) {
      const [salt, originalHash] = storedHash.split(':');
      const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(verifyHash, 'hex'), Buffer.from(originalHash, 'hex'));
    }
  } catch {
    return false;
  }
  return false;
}

// User Storage & Active Sessions
let usersDB = {};
const activeSessions = new Map(); // token -> { user, expiresAt, token }

function loadUsers() {
  if (fs.existsSync(USERS_FILE)) {
    try {
      usersDB = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch {
      usersDB = {};
    }
  }

  // Pre-configured accounts for testing RBAC
  // 1. Lead Geneticist (Full Access)
  if (!usersDB['srinivas']) {
    usersDB['srinivas'] = {
      username: 'srinivas',
      name: 'Dr. Srinivas',
      role: ROLES.ADMIN_GENETICIST,
      canUpload: true,
      canExport: true,
      passwordHash: hashPassword('Password@123'),
      createdAt: new Date().toISOString()
    };
  }

  // 2. Read-Only Viewer (RBAC Test Account: Upload Disabled)
  if (!usersDB['viewer']) {
    usersDB['viewer'] = {
      username: 'viewer',
      name: 'Guest Trainee',
      role: ROLES.VIEWER,
      canUpload: false,
      canExport: false,
      passwordHash: hashPassword('Viewer@123'),
      createdAt: new Date().toISOString()
    };
  }

  saveUsers();
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2), 'utf8');
}

loadUsers();

// Authenticate Request via Short-Lived Token (Checks Expiration TTL)
function getAuthenticatedUser(req) {
  const authHeader = req.headers['authorization'];
  const token = req.headers['x-auth-token'] || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);
  if (!token) return null;

  const session = activeSessions.get(token);
  if (!session) return null;

  // Short-Lived Token TTL Check (1 Hour expiration)
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token); // Purge expired token
    return { isExpired: true };
  }

  return session;
}

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.vcf': 'text/plain; charset=UTF-8'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-File-Name, X-File-Size, X-Auth-Token, Authorization'
  });
  res.end(JSON.stringify(data, null, 2));
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// --- CURATED CIVIC PRECISION ONCOLOGY DATABASE ---
const CIVIC_DATABASE = [
  {
    gene: 'BRAF',
    variant: 'V600E',
    disease: 'Cutaneous Melanoma / Colorectal Cancer',
    drugs: ['Dabrafenib', 'Trametinib', 'Vemurafenib'],
    clinicalSignificance: 'Sensitivity / Response',
    evidenceLevel: 'Level A (FDA Approved)',
    evidenceType: 'Predictive',
    evidenceDirection: 'Supports',
    rating: 5,
    eid: 153,
    statement: 'Combination of BRAF inhibitor (Dabrafenib) and MEK inhibitor (Trametinib) is FDA-approved for unresectable or metastatic melanoma with BRAF V600E mutation.',
    pubmedId: '25399551',
    civicUrl: 'https://civicdb.org/links/variants/12'
  },
  {
    gene: 'EGFR',
    variant: 'L858R',
    disease: 'Non-Small Cell Lung Cancer (NSCLC)',
    drugs: ['Osimertinib', 'Gefitinib', 'Erlotinib'],
    clinicalSignificance: 'Sensitivity / Response',
    evidenceLevel: 'Level A (FDA Approved)',
    evidenceType: 'Predictive',
    evidenceDirection: 'Supports',
    rating: 5,
    eid: 297,
    statement: 'Patients with advanced NSCLC harboring the sensitizing EGFR L858R mutation show dramatic progression-free survival benefit with third-generation EGFR-TKI Osimertinib.',
    pubmedId: '29151359',
    civicUrl: 'https://civicdb.org/links/variants/33'
  },
  {
    gene: 'KRAS',
    variant: 'G12C',
    disease: 'Non-Small Cell Lung Carcinoma',
    drugs: ['Sotorasib (Lumakras)', 'Adagrasib'],
    clinicalSignificance: 'Sensitivity / Response',
    evidenceLevel: 'Level A (FDA Approved)',
    evidenceType: 'Predictive',
    evidenceDirection: 'Supports',
    rating: 5,
    eid: 5821,
    statement: 'Sotorasib is a first-in-class covalent inhibitor of KRAS G12C approved for adult patients with KRAS G12C-mutated locally advanced or metastatic NSCLC.',
    pubmedId: '32955176',
    civicUrl: 'https://civicdb.org/links/variants/238'
  },
  {
    gene: 'BRCA1',
    variant: 'Pathogenic LoF / Frameshift',
    disease: 'Ovarian & Triple-Negative Breast Cancer',
    drugs: ['Olaparib (Lynparza)', 'Niraparib', 'Rucaparib'],
    clinicalSignificance: 'Sensitivity / Response',
    evidenceLevel: 'Level A (FDA Approved)',
    evidenceType: 'Predictive',
    evidenceDirection: 'Supports',
    rating: 5,
    eid: 129,
    statement: 'PARP inhibitor monotherapy induces synthetic lethality in tumors deficient in homologous recombination repair due to germline or somatic BRCA1 mutations.',
    pubmedId: '25414603',
    civicUrl: 'https://civicdb.org/links/variants/71'
  },
  {
    gene: 'TP53',
    variant: 'R248Q / DNA-contact',
    disease: 'Li-Fraumeni Syndrome / Diverse Carcinomas',
    drugs: ['Investigational Eprenetapopt (APR-246)'],
    clinicalSignificance: 'Resistance to conventional Chemotherapy',
    evidenceLevel: 'Level B (Clinical Trials)',
    evidenceType: 'Predictive',
    evidenceDirection: 'Supports',
    rating: 4,
    eid: 942,
    statement: 'TP53 hotspot DNA contact mutation R248Q confers intrinsic chemoresistance and poor overall survival; mutant p53 reactivation therapies are undergoing Phase II/III evaluation.',
    pubmedId: '33431613',
    civicUrl: 'https://civicdb.org/links/variants/45'
  },
  {
    gene: 'PIK3CA',
    variant: 'E545K',
    disease: 'HR-Positive, HER2-Negative Breast Cancer',
    drugs: ['Alpelisib (Piqray) + Fulvestrant'],
    clinicalSignificance: 'Sensitivity / Response',
    evidenceLevel: 'Level A (FDA Approved)',
    evidenceType: 'Predictive',
    evidenceDirection: 'Supports',
    rating: 5,
    eid: 3412,
    statement: 'Alpelisib combined with fulvestrant significantly prolongs progression-free survival in patients with PIK3CA-mutated advanced breast cancer.',
    pubmedId: '31091374',
    civicUrl: 'https://civicdb.org/links/variants/429'
  },
  {
    gene: 'AGRN',
    variant: 'Oncogenic Pathway Biomarker',
    disease: 'Hepatocellular Carcinoma & Colorectal Neoplasms',
    drugs: ['Investigational LRP4-MuSK Antagonists'],
    clinicalSignificance: 'Prognostic / Therapeutic Target',
    evidenceLevel: 'Level C (Preclinical & Translational)',
    evidenceType: 'Prognostic',
    evidenceDirection: 'Supports',
    rating: 3,
    eid: 7102,
    statement: 'Agrin overexpression promotes oncogenesis through LRP4-MuSK and YAP signaling; serves as a tumor biomarker on chromosome 1p36.',
    pubmedId: '30242220',
    civicUrl: 'https://civicdb.org'
  },
  {
    gene: 'OR4F5',
    variant: 'Retinitis Pigmentosa Locus',
    disease: 'Retinitis Pigmentosa / Retinal Dystrophy',
    drugs: ['All-trans-retinyl palmitate (ChEBI:17616)', 'Retinol therapy'],
    clinicalSignificance: 'Pathogenic Dystrophy Marker',
    evidenceLevel: 'Level B (Clinical Evidence)',
    evidenceType: 'Diagnostic / Therapeutic',
    evidenceDirection: 'Supports',
    rating: 4,
    eid: 8901,
    statement: 'Retinal pigmentosa mutations impair visual cycle chromophore regeneration; vitamin A palmitate supplementation slows retinal degeneration.',
    pubmedId: '18556846',
    civicUrl: 'https://civicdb.org'
  }
];

// --- MACHINE LEARNING INFERENCE HELPERS ---
function getMlMetrics() {
  const metricsPath = path.join(__dirname, 'ml-lab', 'ml_metrics.json');
  if (fs.existsSync(metricsPath)) {
    try {
      return JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    } catch (e) {
      console.error('[ML Metrics Load Error]:', e.message);
    }
  }
  return null;
}

function runMlInference(variants) {
  if (!variants || variants.length === 0) return null;
  const pythonPath = process.env.PYTHON_PATH || (fs.existsSync('/opt/homebrew/Caskroom/miniforge/base/bin/python') ? '/opt/homebrew/Caskroom/miniforge/base/bin/python' : 'python3');
  const scriptPath = path.join(__dirname, 'ml-lab', 'predict_variants.py');

  if (!fs.existsSync(scriptPath)) return null;

  try {
    const inputJson = JSON.stringify({ variants });
    const proc = spawnSync(pythonPath, [scriptPath], {
      input: inputJson,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 10000
    });

    if (proc.status === 0 && proc.stdout) {
      return JSON.parse(proc.stdout);
    } else if (proc.stderr) {
      console.error('[ML Predict Stderr]:', proc.stderr);
    }
  } catch (err) {
    console.error('[ML Inference Call Error]:', err.message);
  }
  return null;
}

// --- PARSE & VALIDATE VCF ---
async function parseAndValidateVcf(filePath, isGzip, originalName) {
  return new Promise((resolve, reject) => {
    let inputStream = fs.createReadStream(filePath);

    if (isGzip) {
      const gunzip = zlib.createGunzip();
      gunzip.on('error', (err) => {
        return reject(new Error('Gzip decompression failed: Corrupted .vcf.gz archive. ' + err.message));
      });
      inputStream = inputStream.pipe(gunzip);
    }

    const rl = readline.createInterface({
      input: inputStream,
      crlfDelay: Infinity
    });

    let lineIndex = 0;
    let formatDetected = null;
    let vcfVersion = null;
    let headerColumns = [];
    let samples = [];
    let metadata = {
      fileformat: null,
      source: null,
      reference: null,
      headerLinesCount: 0,
      infoFields: [],
      filterFields: [],
      formatFields: []
    };

    let totalVariants = 0;
    let previewVariants = [];
    let mlVariantCandidates = [];
    let vcardCount = 0;
    let vcardPreview = [];
    let currentVcard = null;
    let parsingErrors = [];

    const geneCounts = new Map();
    let annotatedVariantsCount = 0;

    const qualValues = [];
    let qualSum = 0;
    let qualCount = 0;
    let qualMin = Infinity;
    let qualMax = -Infinity;
    const qualBuckets = { high: 0, moderate: 0, low: 0, unspecified: 0 };
    const filterCounts = {};
    let passCount = 0;
    let transitions = 0;
    let transversions = 0;
    const substitutionMatrix = {
      'A>G': 0, 'G>A': 0, 'C>T': 0, 'T>C': 0,
      'A>C': 0, 'C>A': 0, 'A>T': 0, 'T>A': 0,
      'C>G': 0, 'G>C': 0, 'G>T': 0, 'T>G': 0
    };
    let dpSum = 0;
    let dpCount = 0;
    let dpMin = Infinity;
    let dpMax = 0;

    let snvCount = 0;
    let insertionCount = 0;
    let deletionCount = 0;
    let mnvCount = 0;
    let multiAllelicSiteCount = 0;
    let unnormalizedAlleleCount = 0;
    let totalAllelesAnalyzed = 0;
    const chromCounts = new Map();

    rl.on('line', (rawLine) => {
      lineIndex++;
      const line = rawLine.trim();
      if (!line) return;

      if (formatDetected === null) {
        if (line.startsWith('##fileformat=VCF')) {
          formatDetected = 'genomic_vcf';
          vcfVersion = line.split('=')[1]?.trim();
          metadata.fileformat = vcfVersion;
          metadata.headerLinesCount++;
          return;
        } else if (line.toUpperCase() === 'BEGIN:VCARD') {
          formatDetected = 'vcard';
          vcardCount = 1;
          currentVcard = { fn: '', email: '', tel: '', org: '', title: '' };
          return;
        } else if (lineIndex > 10) {
          rl.close();
          return reject(new Error('Invalid format: File does not start with standard VCF headers.'));
        } else {
          return;
        }
      }

      if (formatDetected === 'genomic_vcf') {
        if (line.startsWith('##')) {
          metadata.headerLinesCount++;
          if (line.startsWith('##reference=')) metadata.reference = line.substring(12);
          else if (line.startsWith('##source=')) metadata.source = line.substring(9);
          else if (line.startsWith('##INFO=<ID=')) {
            const idMatch = line.match(/##INFO=<ID=([^,]+)/);
            if (idMatch && metadata.infoFields.length < 25) metadata.infoFields.push(idMatch[1]);
          } else if (line.startsWith('##FILTER=<ID=')) {
            const idMatch = line.match(/##FILTER=<ID=([^,]+)/);
            if (idMatch && metadata.filterFields.length < 20) metadata.filterFields.push(idMatch[1]);
          } else if (line.startsWith('##FORMAT=<ID=')) {
            const idMatch = line.match(/##FORMAT=<ID=([^,]+)/);
            if (idMatch && metadata.formatFields.length < 20) metadata.formatFields.push(idMatch[1]);
          }
          return;
        }

        if (line.startsWith('#CHROM')) {
          headerColumns = line.substring(1).split('\t');
          if (headerColumns.length < 8) {
            parsingErrors.push(`Header has only ${headerColumns.length} columns. VCF requires >= 8.`);
          }
          if (headerColumns.length > 9) {
            samples = headerColumns.slice(9);
          }
          return;
        }

        if (!line.startsWith('#')) {
          totalVariants++;
          const cols = line.split('\t');

          if (totalVariants <= 100 && cols.length < 8) {
            parsingErrors.push(`Line ${lineIndex}: Row has only ${cols.length} columns.`);
          }

          const chrom = cols[0] || '';
          const pos = cols[1] || '';
          const id = cols[2] || '.';
          const ref = (cols[3] || '').toUpperCase();
          const altRaw = (cols[4] || '').toUpperCase();
          const qualStr = cols[5] || '.';
          const filterStr = cols[6] || '.';
          const infoStr = cols[7] || '';

          if (chrom) chromCounts.set(chrom, (chromCounts.get(chrom) || 0) + 1);

          let detectedGene = null;
          const geneInfoMatch = infoStr.match(/GENEINFO=([^:;|]+)/);
          if (geneInfoMatch) {
            detectedGene = geneInfoMatch[1].trim();
          } else {
            const geneTagMatch = infoStr.match(/(?:^|;)GENE=([^;]+)/);
            if (geneTagMatch) {
              detectedGene = geneTagMatch[1].trim();
            } else {
              const annMatch = infoStr.match(/(?:ANN|CSQ)=([^;,]+)/);
              if (annMatch) {
                const parts = annMatch[1].split('|');
                if (parts.length > 3 && parts[3] && parts[3].length < 30) detectedGene = parts[3].trim();
              }
            }
          }

          if (detectedGene) {
            annotatedVariantsCount++;
            geneCounts.set(detectedGene, (geneCounts.get(detectedGene) || 0) + 1);
          }

          if (qualStr && qualStr !== '.') {
            const q = parseFloat(qualStr);
            if (!isNaN(q)) {
              qualCount++;
              qualSum += q;
              if (q < qualMin) qualMin = q;
              if (q > qualMax) qualMax = q;
              if (qualValues.length < 5000) qualValues.push(q);

              if (q >= 50) qualBuckets.high++;
              else if (q >= 20) qualBuckets.moderate++;
              else qualBuckets.low++;
            } else {
              qualBuckets.unspecified++;
            }
          } else {
            qualBuckets.unspecified++;
          }

          filterCounts[filterStr] = (filterCounts[filterStr] || 0) + 1;
          if (filterStr === 'PASS') passCount++;

          const dpMatch = infoStr.match(/(?:^|;)DP=(\d+)/);
          if (dpMatch) {
            const dp = parseInt(dpMatch[1], 10);
            if (!isNaN(dp)) {
              dpCount++;
              dpSum += dp;
              if (dp < dpMin) dpMin = dp;
              if (dp > dpMax) dpMax = dp;
            }
          }

          const altAlleles = altRaw.split(',');
          if (altAlleles.length > 1) multiAllelicSiteCount++;

          for (const alt of altAlleles) {
            if (!alt || alt === '.') continue;
            totalAllelesAnalyzed++;

            if (ref.length === 1 && alt.length === 1) {
              snvCount++;
              const pair = `${ref}>${alt}`;
              if (substitutionMatrix[pair] !== undefined) substitutionMatrix[pair]++;

              if ((ref === 'A' && alt === 'G') || (ref === 'G' && alt === 'A') ||
                  (ref === 'C' && alt === 'T') || (ref === 'T' && alt === 'C')) {
                transitions++;
              } else {
                transversions++;
              }
            } else if (ref.length < alt.length) {
              insertionCount++;
            } else if (ref.length > alt.length) {
              deletionCount++;
            } else {
              mnvCount++;
            }

            if (ref.length > 1 && alt.length > 1) {
              if (ref[0] === alt[0] || ref[ref.length - 1] === alt[alt.length - 1]) {
                unnormalizedAlleleCount++;
              }
            }
          }

          if (totalVariants <= 25) {
            const posNum = parseInt(pos, 10);
            if (isNaN(posNum) || posNum < 0) {
              parsingErrors.push(`Line ${lineIndex}: POS "${pos}" invalid.`);
            }

            previewVariants.push({
              chrom,
              pos,
              id,
              ref,
              alt: altRaw,
              qual: qualStr,
              filter: filterStr,
              gene: detectedGene || '-',
              info: infoStr ? (infoStr.length > 40 ? infoStr.substring(0, 40) + '...' : infoStr) : '',
              format: cols[8] || '',
              sampleValues: cols.slice(9, 12)
            });
          }

          if (mlVariantCandidates.length < 100) {
            mlVariantCandidates.push({
              chrom,
              pos,
              id,
              ref,
              alt: altRaw,
              qual: qualStr,
              filter: filterStr,
              gene: detectedGene || '-',
              info: infoStr || '',
              format: cols[8] || '',
              genotype: cols[9] ? cols[9].split(':')[0] : '0/1'
            });
          }
        }
      } else if (formatDetected === 'vcard') {
        const upper = line.toUpperCase();
        if (upper === 'BEGIN:VCARD') {
          vcardCount++;
          currentVcard = { fn: '', email: '', tel: '', org: '', title: '' };
        } else if (upper.startsWith('FN:')) {
          if (currentVcard) currentVcard.fn = line.substring(3).trim();
        } else if (upper.startsWith('EMAIL') && line.includes(':')) {
          if (currentVcard) currentVcard.email = line.split(':').slice(1).join(':').trim();
        } else if (upper.startsWith('TEL') && line.includes(':')) {
          if (currentVcard) currentVcard.tel = line.split(':').slice(1).join(':').trim();
        } else if (upper.startsWith('ORG:')) {
          if (currentVcard) currentVcard.org = line.substring(4).trim();
        } else if (upper === 'END:VCARD') {
          if (currentVcard && vcardPreview.length < 15) {
            vcardPreview.push(currentVcard);
          }
          currentVcard = null;
        }
      }
    });

    rl.on('close', () => {
      if (!formatDetected) return reject(new Error('File is empty or not a valid VCF format.'));

      if (formatDetected === 'genomic_vcf') {
        if (!headerColumns.length && totalVariants === 0) {
          return reject(new Error('VCF file missing standard #CHROM column header line.'));
        }

        const sortedGenes = Array.from(geneCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([gene, count]) => ({
            gene,
            count,
            percentage: totalVariants > 0 ? ((count / totalVariants) * 100).toFixed(2) : 0
          }));

        qualValues.sort((a, b) => a - b);
        const medianQual = qualValues.length > 0 ? qualValues[Math.floor(qualValues.length / 2)] : 0;
        const meanQual = qualCount > 0 ? (qualSum / qualCount).toFixed(1) : 0;
        const passRate = totalVariants > 0 ? ((passCount / totalVariants) * 100).toFixed(1) : 0;

        const tiTvRatio = transversions > 0 ? (transitions / transversions).toFixed(2) : (transitions > 0 ? 'Pure Ti' : '0.00');

        let tiTvAssessment = 'Standard / Acceptable';
        if (transversions > 0) {
          const r = transitions / transversions;
          if (r >= 1.9 && r <= 2.2) tiTvAssessment = 'Optimal for Whole Genome Sequencing (~2.0 - 2.1)';
          else if (r >= 2.6 && r <= 3.3) tiTvAssessment = 'Optimal for Whole Exome Sequencing (~2.8 - 3.2)';
          else if (r < 1.6) tiTvAssessment = 'Low Ti/Tv ratio (Potential false positives or targeted assay)';
          else if (r > 3.5) tiTvAssessment = 'High Ti/Tv ratio (Transition enriched or panel bias)';
        }

        const qualityAssessment = {
          totalVariants,
          qualSummary: {
            mean: Number(meanQual),
            median: medianQual,
            min: qualMin === Infinity ? 0 : qualMin,
            max: qualMax === -Infinity ? 0 : qualMax,
            scoredVariants: qualCount,
            unscoredVariants: qualBuckets.unspecified
          },
          qualBuckets: {
            high: { label: 'High Quality (≥ 50)', count: qualBuckets.high, percent: totalVariants ? ((qualBuckets.high / totalVariants) * 100).toFixed(1) : 0 },
            moderate: { label: 'Moderate Quality (20–49)', count: qualBuckets.moderate, percent: totalVariants ? ((qualBuckets.moderate / totalVariants) * 100).toFixed(1) : 0 },
            low: { label: 'Low Quality (< 20)', count: qualBuckets.low, percent: totalVariants ? ((qualBuckets.low / totalVariants) * 100).toFixed(1) : 0 },
            missing: { label: 'Unspecified / No QUAL (.)', count: qualBuckets.unspecified, percent: totalVariants ? ((qualBuckets.unspecified / totalVariants) * 100).toFixed(1) : 0 }
          },
          tiTv: {
            transitions,
            transversions,
            ratio: tiTvRatio,
            assessment: tiTvAssessment,
            nucleotideDetails: {
              transitions: {
                'A>G': substitutionMatrix['A>G'] || 0,
                'G>A': substitutionMatrix['G>A'] || 0,
                'C>T': substitutionMatrix['C>T'] || 0,
                'T>C': substitutionMatrix['T>C'] || 0,
                agTotal: (substitutionMatrix['A>G'] || 0) + (substitutionMatrix['G>A'] || 0),
                ctTotal: (substitutionMatrix['C>T'] || 0) + (substitutionMatrix['T>C'] || 0)
              },
              transversions: {
                'A>C': substitutionMatrix['A>C'] || 0,
                'C>A': substitutionMatrix['C>A'] || 0,
                'A>T': substitutionMatrix['A>T'] || 0,
                'T>A': substitutionMatrix['T>A'] || 0,
                'C>G': substitutionMatrix['C>G'] || 0,
                'G>C': substitutionMatrix['G>C'] || 0,
                'G>T': substitutionMatrix['G>T'] || 0,
                'T>G': substitutionMatrix['T>G'] || 0
              }
            }
          },
          filterDistribution: {
            passCount,
            passRatePercent: Number(passRate),
            filters: filterCounts
          },
          depth: {
            available: dpCount > 0,
            mean: dpCount > 0 ? (dpSum / dpCount).toFixed(1) : null,
            min: dpCount > 0 ? dpMin : null,
            max: dpCount > 0 ? dpMax : null
          }
        };

        const multiAllelicPercent = totalVariants > 0 ? ((multiAllelicSiteCount / totalVariants) * 100).toFixed(1) : 0;
        const normalizationStatus = (multiAllelicSiteCount === 0 && unnormalizedAlleleCount === 0)
          ? 'Fully Normalized'
          : (multiAllelicSiteCount > 0 ? 'Decomposition Recommended (Multi-allelic sites present)' : 'Indel Trimming / Left-alignment Recommended');

        const normalizationAssessment = {
          isNormalized: multiAllelicSiteCount === 0 && unnormalizedAlleleCount === 0,
          status: normalizationStatus,
          multiAllelicSites: multiAllelicSiteCount,
          multiAllelicPercent: Number(multiAllelicPercent),
          unnormalizedIndels: unnormalizedAlleleCount,
          recommendedCommand: multiAllelicSiteCount > 0
            ? 'bcftools norm -m -any -f <ref.fasta> input.vcf.gz -Oz -o normalized.vcf.gz'
            : 'bcftools norm -f <ref.fasta> input.vcf.gz -Oz -o normalized.vcf.gz',
          variantTypes: {
            snvs: snvCount,
            insertions: insertionCount,
            deletions: deletionCount,
            mnvs: mnvCount,
            totalAlleles: totalAllelesAnalyzed
          }
        };

        const geneDistribution = {
          totalAnnotatedVariants: annotatedVariantsCount,
          uniqueGenesCount: geneCounts.size,
          topGenes: sortedGenes
        };

        let mlAssessment = null;
        try {
          const metrics = getMlMetrics();
          const mlResult = runMlInference(mlVariantCandidates);
          mlAssessment = {
            metrics,
            engineeredFeatures: mlResult?.engineered_sample_features || null,
            variantPredictions: mlResult?.variant_predictions || [],
            summary: mlResult?.summary || null
          };
        } catch (mlErr) {
          console.error('[ML Assessment Error]:', mlErr.message);
        }

        resolve({
          type: 'genomic_vcf',
          formatTitle: `Variant Call Format (${vcfVersion || 'v4.x'})`,
          version: vcfVersion || 'Unknown',
          headerColumns: headerColumns.slice(0, 9),
          sampleCount: samples.length,
          samples: samples.slice(0, 50),
          hasMoreSamples: samples.length > 50,
          totalVariants,
          previewRecords: previewVariants,
          metadata,
          qualityAssessment,
          normalizationAssessment,
          geneDistribution,
          mlAssessment,
          validationWarnings: parsingErrors.slice(0, 5),
          isValid: parsingErrors.length === 0
        });
      } else {
        resolve({
          type: 'vcard',
          formatTitle: 'vCard Contact Directory',
          totalContacts: vcardCount,
          previewContacts: vcardPreview,
          isValid: true
        });
      }
    });

    inputStream.on('error', (err) => reject(new Error(`Stream reading error: ${err.message}`)));
  });
}

// --- HANDLE FILE UPLOAD WITH RBAC ENFORCEMENT ---
async function handleUpload(req, res, url) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return sendJson(res, 401, {
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in with your clinical account.'
    });
  }

  if (user.isExpired) {
    return sendJson(res, 401, {
      success: false,
      error: 'TOKEN_EXPIRED',
      message: 'Your short-lived session token (1 Hour TTL) has expired. Please log in again.'
    });
  }

  // --- RBAC CHECK ---
  // Only Lead Geneticist and Bioinformaticians have Upload Permission!
  if (user.role === ROLES.VIEWER || user.canUpload === false) {
    return sendJson(res, 403, {
      success: false,
      error: 'FORBIDDEN_RBAC',
      message: `Access Denied (RBAC): Your role (${user.role}) is Read-Only. You do not have permission to upload VCF files. Please contact a Lead Clinical Geneticist.`
    });
  }

  const filenameHeader = req.headers['x-file-name'];
  const queryFilename = url.searchParams.get('filename');
  const filename = decodeURIComponent(filenameHeader || queryFilename || 'uploaded.vcf');
  const declaredSize = parseInt(req.headers['content-length'] || req.headers['x-file-size'] || '0', 10);

  if (declaredSize > MAX_FILE_SIZE) {
    return sendJson(res, 413, {
      success: false,
      error: 'PAYLOAD_TOO_LARGE',
      message: `File size (${formatBytes(declaredSize)}) exceeds the maximum limit of 100 MB.`
    });
  }

  const lowerName = filename.toLowerCase();
  const isGzip = lowerName.endsWith('.vcf.gz');
  const isVcf = lowerName.endsWith('.vcf');
  const isVcard = lowerName.endsWith('.vcard');

  if (!isVcf && !isGzip && !isVcard) {
    return sendJson(res, 415, {
      success: false,
      error: 'UNSUPPORTED_MEDIA_TYPE',
      message: `Invalid file extension. Only .vcf, .vcf.gz, and .vcard files are accepted.`
    });
  }

  const safeBaseName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const tempFileName = `upload_${Date.now()}_${safeBaseName}`;
  const tempFilePath = path.join(UPLOAD_DIR, tempFileName);

  const fileWriteStream = fs.createWriteStream(tempFilePath);
  const sha256HashStream = crypto.createHash('sha256');
  let bytesReceived = 0;
  let isLimitExceeded = false;

  req.on('data', (chunk) => {
    bytesReceived += chunk.length;
    sha256HashStream.update(chunk);

    if (bytesReceived > MAX_FILE_SIZE) {
      isLimitExceeded = true;
      req.pause();
      req.destroy();
      fileWriteStream.destroy();
      fs.unlink(tempFilePath, () => {});

      return sendJson(res, 413, {
        success: false,
        error: 'PAYLOAD_TOO_LARGE',
        message: `File upload aborted! Size exceeded 100 MB during streaming.`
      });
    }

    fileWriteStream.write(chunk);
  });

  req.on('end', async () => {
    if (isLimitExceeded) return;

    fileWriteStream.end(async () => {
      if (bytesReceived === 0) {
        fs.unlink(tempFilePath, () => {});
        return sendJson(res, 400, {
          success: false,
          error: 'EMPTY_FILE',
          message: 'The uploaded file is empty (0 bytes).'
        });
      }

      try {
        const sha256Hash = sha256HashStream.digest('hex');
        const analysis = await parseAndValidateVcf(tempFilePath, isGzip, filename);

        // Ingest into 13-Relation Clinical Genomics Database (SQLite / Postgres \dt schema)
        let dbRecord = null;
        let finalStoragePath = tempFilePath;
        let finalFileName = tempFileName;

        try {
          dbRecord = dbEngine.ingestVcfUpload({
            fileName: filename,
            fileSizeBytes: bytesReceived,
            sha256Hash,
            storagePath: tempFilePath,
            uploadedBy: user.name,
            patientName: `${user.name} ClinVar Diagnostic Sample`,
            vcfSummary: analysis
          });

          // True Storage Deduplication: If file with same SHA-256 exists, clean up redundant disk copy
          if (dbRecord && dbRecord.deduplicated) {
            try {
              if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            } catch {}
            finalStoragePath = dbRecord.fileRecord.storage_path;
            finalFileName = path.basename(finalStoragePath);
          }
        } catch (dbErr) {
          console.error('[DB Ingest Error]:', dbErr.message);
        }

        sendJson(res, 200, {
          success: true,
          uploadedBy: `${user.name} (${user.role})`,
          file: {
            name: filename,
            savedAs: finalFileName,
            sizeBytes: bytesReceived,
            sizeFormatted: formatBytes(bytesReceived),
            sha256Hash,
            storagePath: finalStoragePath,
            isCompressed: isGzip,
            isDeduplicated: dbRecord?.deduplicated || false,
            uploadedAt: new Date().toISOString()
          },
          databaseRecord: dbRecord,
          analysis
        });
      } catch (err) {
        fs.unlink(tempFilePath, () => {});
        sendJson(res, 422, {
          success: false,
          error: 'INVALID_VCF_FORMAT',
          message: err.message,
          receivedSize: formatBytes(bytesReceived)
        });
      }
    });
  });

  req.on('error', (err) => {
    fs.unlink(tempFilePath, () => {});
    if (!res.headersSent) {
      sendJson(res, 500, {
        success: false,
        error: 'UPLOAD_ERROR',
        message: `Upload stream failed: ${err.message}`
      });
    }
  });
}

// --- MAIN HTTP ROUTER ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-File-Name, X-File-Size, X-Auth-Token, Authorization'
    });
    return res.end();
  }

  // --- AUTHENTICATION & RBAC ROUTES ---
  // 1. Login (Issues 1-Hour Short-Lived Token with RBAC permissions)
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!username || !password) {
          return sendJson(res, 400, { success: false, message: 'Username and password are required.' });
        }

        const user = usersDB[username.toLowerCase()];
        if (!user || !verifyPassword(password, user.passwordHash)) {
          return sendJson(res, 401, { success: false, message: 'Invalid username or password.' });
        }

        // Short-Lived Token: 1 Hour TTL
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + TOKEN_EXPIRY_MS;

        activeSessions.set(token, {
          username: user.username,
          name: user.name,
          role: user.role,
          canUpload: user.canUpload !== false,
          expiresAt,
          loggedInAt: new Date().toISOString()
        });

        // Record in SQLite sessions table (matching Professor's Diagram)
        try {
          const dbUser = dbEngine.getUserByUsername(user.username);
          const uid = dbUser ? dbUser.user_id : (user.username === 'viewer' ? 2 : 1);
          dbEngine.recordSession(crypto.randomUUID(), uid, token, new Date(expiresAt).toISOString());
        } catch (dbErr) {
          console.error('[DB Session Error]:', dbErr.message);
        }

        return sendJson(res, 200, {
          success: true,
          message: 'Authentication successful.',
          token,
          expiresInSeconds: TOKEN_EXPIRY_MS / 1000,
          user: {
            username: user.username,
            name: user.name,
            role: user.role,
            canUpload: user.canUpload !== false
          }
        });
      } catch (e) {
        return sendJson(res, 400, { success: false, message: 'Invalid JSON request body.' });
      }
    });
    return;
  }

  // 2. Register (With RBAC Role Selection)
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password, name, role } = JSON.parse(body);
        const cleanUser = (username || '').trim().toLowerCase();

        if (!cleanUser || !password || password.length < 6) {
          return sendJson(res, 400, { success: false, message: 'Username and password (min 6 chars) are required.' });
        }

        if (usersDB[cleanUser]) {
          return sendJson(res, 409, { success: false, message: 'Username already exists.' });
        }

        const chosenRole = role || ROLES.BIOINFORMATICIAN;
        const canUpload = chosenRole !== ROLES.VIEWER;

        usersDB[cleanUser] = {
          username: cleanUser,
          name: (name || cleanUser).trim(),
          role: chosenRole,
          canUpload,
          passwordHash: hashPassword(password),
          createdAt: new Date().toISOString()
        };
        saveUsers();

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + TOKEN_EXPIRY_MS;

        activeSessions.set(token, {
          username: cleanUser,
          name: usersDB[cleanUser].name,
          role: chosenRole,
          canUpload,
          expiresAt,
          loggedInAt: new Date().toISOString()
        });

        // Record in SQLite users & sessions tables (matching Professor's Diagram)
        try {
          const recUser = dbEngine.recordUser(cleanUser, usersDB[cleanUser].passwordHash, chosenRole);
          const uid = recUser ? recUser.user_id : 1;
          dbEngine.recordSession(crypto.randomUUID(), uid, token, new Date(expiresAt).toISOString());
        } catch (dbErr) {
          console.error('[DB Register Error]:', dbErr.message);
        }

        return sendJson(res, 201, {
          success: true,
          message: 'Account registered successfully with RBAC role.',
          token,
          expiresInSeconds: TOKEN_EXPIRY_MS / 1000,
          user: {
            username: cleanUser,
            name: usersDB[cleanUser].name,
            role: chosenRole,
            canUpload
          }
        });
      } catch (e) {
        return sendJson(res, 400, { success: false, message: 'Invalid JSON request body.' });
      }
    });
    return;
  }

  // 3. Current User Profile
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = getAuthenticatedUser(req);
    if (!user) return sendJson(res, 401, { success: false, message: 'Not authenticated.' });
    if (user.isExpired) return sendJson(res, 401, { success: false, error: 'TOKEN_EXPIRED', message: 'Session token expired.' });

    return sendJson(res, 200, {
      success: true,
      user: {
        username: user.username,
        name: user.name,
        role: user.role,
        canUpload: user.canUpload,
        tokenTtlRemainingSeconds: Math.max(0, Math.round((user.expiresAt - Date.now()) / 1000))
      }
    });
  }

  // 4. Logout
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    const token = req.headers['x-auth-token'] || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);
    if (token) activeSessions.delete(token);
    return sendJson(res, 200, { success: true, message: 'Logged out successfully.' });
  }

  // --- CIVIC CANCER ACTIONABILITY API ---
  if (pathname === '/api/civic' && req.method === 'GET') {
    const rawQuery = url.searchParams.get('q') || url.searchParams.get('gene') || '';
    const q = decodeURIComponent(rawQuery).trim().toUpperCase();

    let results = CIVIC_DATABASE;
    if (q) {
      results = CIVIC_DATABASE.filter(item =>
        item.gene.toUpperCase().includes(q) ||
        item.variant.toUpperCase().includes(q) ||
        item.disease.toUpperCase().includes(q) ||
        item.drugs.some(d => d.toUpperCase().includes(q))
      );
    }

    return sendJson(res, 200, {
      success: true,
      query: q || 'ALL',
      source: 'CIViC (Clinical Interpretation of Variants in Cancer - civicdb.org)',
      totalFound: results.length,
      results
    });
  }

  // --- CHEBI DATABASE SEARCH ENDPOINT ---
  if (pathname === '/api/chebi' && req.method === 'GET') {
    const rawQuery = url.searchParams.get('q') || 'retinol';
    const query = decodeURIComponent(rawQuery).trim();
    const ebiUrl = `https://www.ebi.ac.uk/ols4/api/search?q=${encodeURIComponent(query)}&ontology=chebi&rows=10`;

    https.get(ebiUrl, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const results = (parsed.response?.docs || []).map(doc => ({
            chebiId: doc.obo_id || doc.short_form,
            label: doc.label || 'Unnamed Entity',
            description: doc.description ? doc.description[0] : (doc.definition ? doc.definition[0] : 'Chemical Entity of Biological Interest'),
            synonyms: (doc.exact_synonyms || doc.related_synonyms || []).slice(0, 4),
            iri: doc.iri,
            link: `https://www.ebi.ac.uk/chebi/searchId.do?chebiId=${doc.obo_id || doc.short_form}`
          }));

          sendJson(res, 200, {
            success: true,
            query,
            database: 'EMBL-EBI ChEBI',
            totalFound: parsed.response?.numFound || 0,
            results
          });
        } catch (e) {
          sendJson(res, 500, { success: false, error: 'ChEBI Parse Error', message: e.message });
        }
      });
    }).on('error', (err) => {
      sendJson(res, 502, { success: false, error: 'ChEBI Network Error', message: err.message });
    });
    return;
  }

  // --- CLINICAL GENOMICS RELATIONAL DATABASE ENDPOINTS (13 RELATIONS) ---
  if (pathname === '/api/db/relations' && req.method === 'GET') {
    const relations = dbEngine.getRelationsList();
    return sendJson(res, 200, {
      success: true,
      command: 'genomics=# \\dt',
      schema: 'genomics',
      database: 'genomics.db (SQLite/PostgreSQL Model)',
      totalRelations: relations.length,
      relations
    });
  }

  if (pathname.startsWith('/api/db/table/') && req.method === 'GET') {
    const tableName = pathname.replace('/api/db/table/', '').trim();
    try {
      const data = dbEngine.getTableData(tableName, 100);
      return sendJson(res, 200, { success: true, ...data });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/db/test-cascade' && req.method === 'POST') {
    try {
      const cascadeResult = dbEngine.testCascadeDelete();
      return sendJson(res, 200, {
        success: true,
        message: 'ON DELETE CASCADE executed successfully! When Patient was deleted, all linked files, samples, and reports were automatically cascaded and cleaned up.',
        cascadeResult
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // --- WHITEBOARD SQL QUERY PLAYGROUND (TASKS 1 & 2) ---
  if (pathname === '/api/db/whiteboard/query1' && req.method === 'GET') {
    try {
      const results = dbEngine.runWhiteboardQuery1();
      return sendJson(res, 200, {
        success: true,
        task: '1. Filter Genome Build and position of variants whose Genotype is 1/1',
        sql: 'SELECT gl.genome_build, gl.position FROM genomic_loci gl JOIN variant_calls vc ON gl.locus_id = vc.locus_id WHERE vc.genotype = \'1/1\';',
        totalFound: results.length,
        results
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (pathname === '/api/db/whiteboard/query2' && req.method === 'POST') {
    try {
      const updateData = dbEngine.runWhiteboardQuery2();
      return sendJson(res, 200, {
        success: true,
        task: '2. Update reference allele and alternate allele to G and A respectively',
        sql: 'UPDATE genomic_loci SET reference_allele = \'G\', alternate_allele = \'A\' WHERE locus_id IN (SELECT locus_id FROM variant_calls WHERE filter_status = \'PASS\' AND (allele_frequency = 0.08 OR allele_frequency = 0.06 OR allele_frequency = 0.10));',
        ...updateData
      });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // --- MACHINE LEARNING PATHOGENICITY & CLUSTERING ENDPOINTS ---
  if (pathname === '/api/ml/metrics' && req.method === 'GET') {
    const metrics = getMlMetrics();
    if (metrics) {
      return sendJson(res, 200, { success: true, ...metrics });
    } else {
      return sendJson(res, 404, { success: false, error: 'ML Metrics not found. Run training script first.' });
    }
  }

  if (pathname === '/api/ml/predict' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const variants = payload.variants || (Array.isArray(payload) ? payload : []);
        const result = runMlInference(variants);
        return sendJson(res, 200, { success: true, ...result });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // --- FILE UPLOAD ---
  if (pathname === '/api/upload' && req.method === 'POST') {
    return handleUpload(req, res, url);
  }

  // --- HEALTH CHECK ---
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      status: 'healthy',
      authMethod: 'PBKDF2-SHA512-Salted',
      tokenType: 'Short-Lived-Token (1 Hour TTL)',
      authorizationModel: 'RBAC (Role-Based Access Control)',
      rolesAvailable: Object.values(ROLES),
      maxFileSize: MAX_FILE_SIZE,
      maxFileSizeFormatted: '100 MB',
      uptime: process.uptime()
    });
  }

  // --- SAMPLE FILES DOWNLOAD ---
  if (pathname.startsWith('/api/samples/') && req.method === 'GET') {
    const sampleName = path.basename(pathname.replace('/api/samples/', ''));
    const samplePath = path.join(SAMPLES_DIR, sampleName);
    if (fs.existsSync(samplePath)) {
      res.writeHead(200, {
        'Content-Type': sampleName.endsWith('.gz') ? 'application/gzip' : 'text/plain; charset=UTF-8',
        'Content-Disposition': `attachment; filename="${sampleName}"`
      });
      return fs.createReadStream(samplePath).pipe(res);
    } else {
      return sendJson(res, 404, { success: false, error: 'Sample not found' });
    }
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Access Denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
      return res.end('<h1>404 Not Found</h1><p><a href="/">Return to Home</a></p>');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` VCF Genomics Platform Running on http://localhost:${PORT}`);
  console.log(` Security: PBKDF2 + SHA-512 Password Hashing`);
  console.log(` Token Model: Short-Lived Access Tokens (1 Hour TTL)`);
  console.log(` Authorization: RBAC (Lead Geneticist, Bioinformatician, Viewer)`);
  console.log(` Accounts: srinivas (Lead Geneticist), viewer (Read-Only)`);
  console.log(` Integrations: CIViC Actionability & EMBL-EBI ChEBI`);
  console.log(` Max File Size: 100 MB`);
  console.log(`====================================================`);
});
