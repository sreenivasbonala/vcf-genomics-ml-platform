/**
 * test_ml_pipeline.js
 * Verifies ML Variant Pathogenicity Prediction & Feature Engineering Pipeline
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3898;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, PORT }
    });

    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('VCF Genomics Platform Running')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (d) => {
      // console.error('[Server Err]:', d.toString());
    });

    setTimeout(() => resolve(), 2000);
  });
}

async function runTests() {
  console.log(`🚀 Starting ML Pipeline Test Server on port ${PORT}...`);
  await startServer();
  console.log(`✅ Test server running! Executing ML assertions...\n`);

  let passed = 0;
  let total = 0;

  async function assertTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  // 1. GET /api/ml/metrics
  await assertTest('GET /api/ml/metrics returns RF & KMeans performance metrics', async () => {
    const res = await fetch(`${BASE_URL}/api/ml/metrics`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('API success is false');
    if (typeof data.supervised_rf?.accuracy !== 'number' || data.supervised_rf.accuracy < 0.75) {
      throw new Error(`Unexpected accuracy: ${data.supervised_rf?.accuracy}`);
    }
    if (typeof data.unsupervised_kmeans?.silhouette_score !== 'number') {
      throw new Error('Missing silhouette score');
    }
  });

  // 2. Login to get token for upload
  let authToken = '';
  await assertTest('Obtain Lead Geneticist session token (srinivas)', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'srinivas', password: 'Password@123' })
    });
    const data = await res.json();
    if (!data.success || !data.token) throw new Error('Login failed');
    authToken = data.token;
  });

  // 3. Upload real ClinVar VCF and verify ML Assessment is attached
  await assertTest('Upload ClinVar VCF and verify 8 Engineered Features + Pathogenicity Predictions', async () => {
    const vcfPath = path.join(__dirname, 'test-samples', 'real_clinvar_grch38.vcf');
    const vcfBuffer = fs.readFileSync(vcfPath);

    const res = await fetch(`${BASE_URL}/api/upload?filename=real_clinvar_grch38.vcf`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'text/plain',
        'x-file-name': 'real_clinvar_grch38.vcf',
        'content-length': String(vcfBuffer.length)
      },
      body: vcfBuffer
    });

    if (!res.ok) throw new Error(`Upload returned status ${res.status}`);
    const data = await res.json();
    const ml = data.analysis?.mlAssessment;
    if (!ml) throw new Error('mlAssessment missing from analysis response');

    // Verify 8 engineered features
    const eng = ml.engineeredFeatures;
    if (!eng) throw new Error('engineeredFeatures missing from mlAssessment');
    if (typeof eng.transitions !== 'number') throw new Error('Missing transitions count');
    if (typeof eng.transversions !== 'number') throw new Error('Missing transversions count');
    if (typeof eng.titv_ratio !== 'number') throw new Error('Missing Ti/Tv ratio');
    if (typeof eng.total_snvs !== 'number') throw new Error('Missing total_snvs');
    if (typeof eng.total_insertions !== 'number') throw new Error('Missing total_insertions');
    if (typeof eng.total_deletions !== 'number') throw new Error('Missing total_deletions');
    if (typeof eng.hethom_ratio === 'undefined') throw new Error('Missing hethom_ratio');
    if (typeof eng.rare_variant_count !== 'number') throw new Error('Missing rare_variant_count');
    if (typeof eng.high_impact_count !== 'number') throw new Error('Missing high_impact_count');

    // Verify variant predictions
    if (!Array.isArray(ml.variantPredictions) || ml.variantPredictions.length === 0) {
      throw new Error('variantPredictions empty or not an array');
    }

    const first = ml.variantPredictions[0];
    if (!first.predicted_label || !['Pathogenic', 'Benign'].includes(first.predicted_label)) {
      throw new Error(`Invalid predicted_label: ${first.predicted_label}`);
    }
    if (typeof first.pathogenicity_probability !== 'number') {
      throw new Error('Missing pathogenicity_probability');
    }
    if (typeof first.cluster === 'undefined') {
      throw new Error('Missing cluster assignment');
    }
  });

  // 4. POST /api/ml/predict with arbitrary variant payload
  await assertTest('POST /api/ml/predict on ad-hoc genomic variants', async () => {
    const testVariants = [
      { chrom: 'chr17', pos: '43044295', ref: 'T', alt: 'G', qual: '99', info: 'MC=splice_donor_variant;CADD=35.0;AF=0.00005', gene: 'BRCA1' },
      { chrom: 'chr13', pos: '32315474', ref: 'A', alt: 'G', qual: '90', info: 'MC=synonymous_variant;CADD=2.1;AF=0.15', gene: 'BRCA2' }
    ];

    const res = await fetch(`${BASE_URL}/api/ml/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variants: testVariants })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Prediction failed');
    if (data.variant_predictions?.length !== 2) throw new Error('Expected 2 variant predictions');

    const brca1 = data.variant_predictions[0];
    const brca2 = data.variant_predictions[1];

    if (brca1.predicted_label !== 'Pathogenic') throw new Error(`Expected BRCA1 Pathogenic, got ${brca1.predicted_label}`);
    if (brca2.predicted_label !== 'Benign') throw new Error(`Expected BRCA2 Benign, got ${brca2.predicted_label}`);
  });

  console.log(`\n================================`);
  console.log(`ML Pipeline Results: ${passed}/${total} tests passed!`);
  console.log(`================================\n`);

  if (serverProcess) serverProcess.kill();
  process.exit(passed === total ? 0 : 1);
}

runTests().catch(e => {
  console.error(e);
  if (serverProcess) serverProcess.kill();
  process.exit(1);
});
