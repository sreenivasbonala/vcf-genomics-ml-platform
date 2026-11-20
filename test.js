/**
 * Automated Test Suite for VCF Genomics Platform
 * Covers:
 *  - PBKDF2 Password Hashing & Authentication (Login, Register, Logout)
 *  - Protected Upload (401 without token, 200 with token)
 *  - CIViC Precision Oncology Endpoint (/api/civic)
 *  - ChEBI Database Endpoint (/api/chebi)
 *  - Real Clinical VCFs & Quality Assessment (Ti/Tv, QUAL)
 *  - 100 MB Limit (413), 0-byte (400), Invalid Extension (415), Corrupt Format (422)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 3899;
const BASE_URL = `http://localhost:${PORT}`;

let authToken = '';

function makeRequest(method, endpoint, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${endpoint}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function makeUploadRequest(filename, buffer, token = authToken) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(filename),
      'X-File-Size': buffer.length,
      'Content-Length': buffer.length
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-Auth-Token'] = token;
    }

    const req = http.request(`${BASE_URL}/api/upload?filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
}

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      await new Promise((resolve, reject) => {
        const r = http.get(`${BASE_URL}/api/health`, (res) => {
          if (res.statusCode === 200) resolve();
          else reject();
        });
        r.on('error', reject);
        r.setTimeout(500, () => { r.destroy(); reject(); });
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error('Server failed to start in time');
}

async function runTests() {
  console.log('🚀 Spawning test server on port', PORT);
  const serverProc = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe'
  });

  serverProc.stderr.on('data', d => console.error('Server err:', d.toString()));

  try {
    await waitForServer();
    console.log('✅ Server is ready! Starting test assertions...\n');

    let passed = 0;
    let total = 0;

    async function assertTest(name, fn) {
      total++;
      try {
        await fn();
        console.log(`✅ [PASS] ${name}`);
        passed++;
      } catch (err) {
        console.error(`❌ [FAIL] ${name}:`, err.message);
      }
    }

    // 1. Health check
    await assertTest('Health check endpoint /api/health (PBKDF2-SHA512 auth method)', async () => {
      const res = await makeRequest('GET', '/api/health');
      if (res.status !== 200 || res.body.status !== 'healthy') throw new Error(`Unexpected status ${res.status}`);
      if (res.body.authMethod !== 'PBKDF2-SHA512-Salted') throw new Error('Auth method missing');
    });

    // 2. Authentication: Password Hashing & Login
    await assertTest('Authenticate with PBKDF2-SHA512 password hash (srinivas / Password@123)', async () => {
      const res = await makeRequest('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, {
        username: 'srinivas',
        password: 'Password@123'
      });
      if (res.status !== 200 || !res.body.success || !res.body.token) throw new Error(`Login failed: ${JSON.stringify(res.body)}`);
      authToken = res.body.token;
    });

    // 3. Authentication: Reject invalid password
    await assertTest('Reject invalid password with 401 Unauthorized', async () => {
      const res = await makeRequest('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, {
        username: 'srinivas',
        password: 'WrongPassword999'
      });
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    });

    // 4. Authentication: Register new researcher account
    await assertTest('Register new researcher with cryptographic salt & hash', async () => {
      const testUser = `geneticist_${Date.now()}`;
      const res = await makeRequest('POST', '/api/auth/register', { 'Content-Type': 'application/json' }, {
        username: testUser,
        name: 'Dr. Test Geneticist',
        role: 'Bioinformatician',
        password: 'SecurePassword!@#'
      });
      if (res.status !== 201 || !res.body.token) throw new Error(`Registration failed: ${JSON.stringify(res.body)}`);
    });

    // 5. Protected Route: Reject upload without auth token (401)
    await assertTest('Reject VCF upload without authentication token (401 Unauthorized)', async () => {
      const buf = fs.readFileSync(path.join(__dirname, 'test-samples', 'sample_variants.vcf'));
      const res = await makeUploadRequest('sample_variants.vcf', buf, null);
      if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
      if (res.body.error !== 'UNAUTHORIZED') throw new Error(`Expected UNAUTHORIZED, got ${res.body.error}`);
    });

    // 6. CIViC Precision Oncology Endpoint
    await assertTest('CIViC Precision Oncology API (/api/civic?q=BRAF)', async () => {
      const res = await makeRequest('GET', '/api/civic?q=BRAF');
      if (res.status !== 200 || !res.body.success) throw new Error(`Unexpected status ${res.status}`);
      if (!Array.isArray(res.body.results) || res.body.results.length === 0) throw new Error('No CIViC evidence returned');
      const braf = res.body.results[0];
      if (braf.gene !== 'BRAF' || !braf.drugs.includes('Dabrafenib')) throw new Error('CIViC record validation failed');
    });

    // 7. ChEBI Database API
    await assertTest('ChEBI Database integration endpoint (/api/chebi?q=retinol)', async () => {
      const res = await makeRequest('GET', '/api/chebi?q=retinol');
      if (res.status !== 200 || !res.body.success) throw new Error(`Unexpected status ${res.status}`);
      if (!Array.isArray(res.body.results) || res.body.results.length === 0) throw new Error('No ChEBI results returned');
    });

    // 8. Authenticated Real NCBI ClinVar VCF Upload
    await assertTest('Upload authentic NCBI ClinVar VCF with Auth Token (real_clinvar_grch38.vcf)', async () => {
      const buf = fs.readFileSync(path.join(__dirname, 'test-samples', 'real_clinvar_grch38.vcf'));
      const res = await makeUploadRequest('real_clinvar_grch38.vcf', buf, authToken);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      if (res.body.analysis.totalVariants < 100) throw new Error(`Expected >100 variants, got ${res.body.analysis.totalVariants}`);
      if (!res.body.analysis.qualityAssessment || !res.body.analysis.qualityAssessment.tiTv) throw new Error('Missing Ti/Tv');
      if (!res.body.analysis.qualityAssessment.tiTv.nucleotideDetails) throw new Error('Missing nucleotideDetails');
    });

    // 9. Authenticated Compressed 1000 Genomes Upload
    await assertTest('Upload authentic compressed 1000 Genomes VCF (real_1000genomes_chr22.vcf.gz)', async () => {
      const buf = fs.readFileSync(path.join(__dirname, 'test-samples', 'real_1000genomes_chr22.vcf.gz'));
      const res = await makeUploadRequest('real_1000genomes_chr22.vcf.gz', buf, authToken);
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (res.body.analysis.sampleCount === 0) throw new Error('Expected samples detected');
    });

    // 10. Unsupported Media Type (415)
    await assertTest('Reject invalid file extension (415 Unsupported Media Type)', async () => {
      const buf = Buffer.from('some dummy content');
      const res = await makeUploadRequest('data.pdf', buf, authToken);
      if (res.status !== 415) throw new Error(`Expected 415, got ${res.status}`);
    });

    // 11. Empty File (400)
    await assertTest('Reject empty 0-byte file (400 Bad Request)', async () => {
      const buf = Buffer.alloc(0);
      const res = await makeUploadRequest('empty.vcf', buf, authToken);
      if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    });

    // 12. Invalid VCF format (422)
    await assertTest('Reject corrupted VCF contents (422 Unprocessable Entity)', async () => {
      const buf = fs.readFileSync(path.join(__dirname, 'test-samples', 'sample_invalid.vcf'));
      const res = await makeUploadRequest('sample_invalid.vcf', buf, authToken);
      if (res.status !== 422) throw new Error(`Expected 422, got ${res.status}`);
    });

    // 13. Size limit header check (>100MB declared) (413)
    await assertTest('Reject file exceeding 100MB limit (413 Payload Too Large)', async () => {
      const oversizedDeclared = 105 * 1024 * 1024;
      const res = await new Promise((resolve, reject) => {
        const req = http.request(`${BASE_URL}/api/upload?filename=huge.vcf`, {
          method: 'POST',
          agent: false,
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': 'huge.vcf',
            'Content-Length': oversizedDeclared,
            'Authorization': `Bearer ${authToken}`,
            'X-Auth-Token': authToken,
            'Connection': 'close'
          }
        }, (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(d) }));
        });
        req.on('error', () => {});
        req.end();
      });

      if (res.status !== 413) throw new Error(`Expected 413, got ${res.status}`);
    });

    // 14. 13-Relation Database Schema Check (\dt)
    await assertTest('13-Relation Database Schema matches PostgreSQL genomics=# \\dt', async () => {
      const res = await new Promise((resolve, reject) => {
        const req = http.request(`${BASE_URL}/api/db/relations`, { method: 'GET', agent: false, headers: { 'Connection': 'close' } }, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(d) }));
        });
        req.on('error', reject);
        req.end();
      });

      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (res.body.totalRelations < 13) throw new Error(`Expected at least 13 relations, got ${res.body.totalRelations}`);
      const tableNames = res.body.relations.map(r => r.name);
      if (!tableNames.includes('uploaded_files') || !tableNames.includes('variant_loci') || !tableNames.includes('annotation_assertions')) {
        throw new Error('Missing core genomic tables in relation list');
      }
    });

    // 15. ON DELETE CASCADE Verification
    await assertTest('ON DELETE CASCADE cleanly removes child relations on Patient deletion', async () => {
      const res = await new Promise((resolve, reject) => {
        const req = http.request(`${BASE_URL}/api/db/test-cascade`, { method: 'POST' }, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(d) }));
        });
        req.on('error', reject);
        req.end();
      });

      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!res.body.cascadeResult || !res.body.cascadeResult.cascadeSuccess) {
        throw new Error('Cascade delete did not report success');
      }
    });

    console.log(`\n================================`);
    console.log(`Results: ${passed}/${total} tests passed!`);
    console.log(`================================\n`);

    if (passed !== total) process.exitCode = 1;
  } finally {
    serverProc.kill();
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
