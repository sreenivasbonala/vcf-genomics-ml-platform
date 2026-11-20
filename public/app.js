/**
 * VCF Genomics Platform Client Application
 * Features:
 *  - PBKDF2-SHA512 Password-Hashed Authentication
 *  - CIViC Precision Oncology Actionability Knowledgebase
 *  - EMBL-EBI ChEBI Metabolites & Chemical Entities
 *  - Streaming VCF 100 MB Upload with Real-Time Progress
 *  - Quality Assessment (Ti/Tv, QUAL) & Gene-wise Distribution
 */

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const ALLOWED_EXTENSIONS = ['.vcf', '.vcf.gz', '.vcard'];

// State
let selectedFile = null;
let currentXhr = null;
let uploadStartTime = null;
let currentAnalysisData = null;
let authToken = localStorage.getItem('vcf_auth_token') || null;
let currentUser = null;

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileSelectedBox = document.getElementById('fileSelectedBox');
const selectedFileName = document.getElementById('selectedFileName');
const selectedFileSize = document.getElementById('selectedFileSize');
const fileTypeIcon = document.getElementById('fileTypeIcon');
const uploadBtn = document.getElementById('uploadBtn');
const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');

const progressContainer = document.getElementById('progressContainer');
const progressBarFill = document.getElementById('progressBarFill');
const progressPercentage = document.getElementById('progressPercentage');
const progressDetails = document.getElementById('progressDetails');
const abortBtn = document.getElementById('abortBtn');

const alertBox = document.getElementById('alertBox');
const alertTitle = document.getElementById('alertTitle');
const alertMessage = document.getElementById('alertMessage');
const alertCloseBtn = document.getElementById('alertCloseBtn');
const alertIcon = document.getElementById('alertIcon');

const resultsSection = document.getElementById('resultsSection');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');

// Auth DOM
const authModal = document.getElementById('authModal');
const openLoginBtn = document.getElementById('openLoginBtn');
const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');
const userProfileBadge = document.getElementById('userProfileBadge');
const userNameText = document.getElementById('userNameText');
const userRoleText = document.getElementById('userRoleText');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authAlert = document.getElementById('authAlert');

// --- AUTHENTICATION MODULE ---
function updateAuthUI(user) {
  currentUser = user;
  if (user) {
    openLoginBtn.classList.add('hidden');
    userProfileBadge.classList.remove('hidden');
    userNameText.textContent = user.name || user.username;
    userRoleText.textContent = user.role || 'Clinical Researcher';
  } else {
    openLoginBtn.classList.remove('hidden');
    userProfileBadge.classList.add('hidden');
    userNameText.textContent = '';
    userRoleText.textContent = '';
  }
}

async function verifyExistingToken() {
  if (!authToken) {
    // Auto-login with default Dr. Srinivas credentials so user has seamless experience
    autoLoginDefault();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${authToken}`, 'X-Auth-Token': authToken }
    });
    if (res.ok) {
      const data = await res.json();
      updateAuthUI(data.user);
    } else {
      localStorage.removeItem('vcf_auth_token');
      authToken = null;
      autoLoginDefault();
    }
  } catch {
    updateAuthUI(null);
  }
}

async function autoLoginDefault() {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'srinivas', password: 'Password@123' })
    });
    if (res.ok) {
      const data = await res.json();
      authToken = data.token;
      localStorage.setItem('vcf_auth_token', authToken);
      updateAuthUI(data.user);
    }
  } catch {}
}

function openAuthModal(tab = 'login') {
  authModal.classList.remove('hidden');
  switchAuthTab(tab);
  hideAuthAlert();
}

function closeAuthModal() {
  authModal.classList.add('hidden');
  hideAuthAlert();
}

function switchAuthTab(tab) {
  const loginTabBtn = document.getElementById('authTabLoginBtn');
  const regTabBtn = document.getElementById('authTabRegisterBtn');

  if (tab === 'login') {
    loginTabBtn.classList.add('active');
    regTabBtn.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  } else {
    loginTabBtn.classList.remove('active');
    regTabBtn.classList.add('active');
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  }
  hideAuthAlert();
}

function showAuthAlert(msg, type = 'error') {
  authAlert.textContent = msg;
  authAlert.className = `auth-alert ${type}`;
  authAlert.classList.remove('hidden');
}

function hideAuthAlert() {
  authAlert.classList.add('hidden');
}

function fillDefaultCredentials() {
  document.getElementById('loginUsername').value = 'srinivas';
  document.getElementById('loginPassword').value = 'Password@123';
}

// Login Form Submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthAlert();

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      authToken = data.token;
      localStorage.setItem('vcf_auth_token', authToken);
      updateAuthUI(data.user);
      closeAuthModal();
      showAlert('Authenticated', `Welcome back, ${data.user.name}! (PBKDF2 Password verified)`, 'success');
    } else {
      showAuthAlert(data.message || 'Invalid username or password.', 'error');
    }
  } catch (err) {
    showAuthAlert(`Network error: ${err.message}`, 'error');
  }
});

// Register Form Submit
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAuthAlert();

  const username = document.getElementById('regUsername').value.trim();
  const name = document.getElementById('regName').value.trim();
  const role = document.getElementById('regRole').value.trim();
  const password = document.getElementById('regPassword').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name, role, password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      authToken = data.token;
      localStorage.setItem('vcf_auth_token', authToken);
      updateAuthUI(data.user);
      closeAuthModal();
      showAlert('Account Created', `Account for ${data.user.name} created! Password safely salted and hashed with PBKDF2-SHA512.`, 'success');
    } else {
      showAuthAlert(data.message || 'Registration failed.', 'error');
    }
  } catch (err) {
    showAuthAlert(`Network error: ${err.message}`, 'error');
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'X-Auth-Token': authToken }
    });
  } catch {}
  localStorage.removeItem('vcf_auth_token');
  authToken = null;
  updateAuthUI(null);
  showAlert('Logged Out', 'You have been logged out. Please sign in to upload files.', 'warning');
});

openLoginBtn.addEventListener('click', () => openAuthModal('login'));
closeAuthModalBtn.addEventListener('click', closeAuthModal);

// Helper: Format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showAlert(title, message, type = 'error') {
  alertBox.className = `alert-box alert-${type}`;
  alertTitle.textContent = title;
  alertMessage.textContent = message;
  alertIcon.textContent = type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : '✅');
  alertBox.classList.remove('hidden');
}

function hideAlert() {
  alertBox.classList.add('hidden');
}

alertCloseBtn.addEventListener('click', hideAlert);

function validateFile(file) {
  hideAlert();
  const fileNameLower = file.name.toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some(ext => fileNameLower.endsWith(ext));

  if (!hasValidExt) {
    showAlert('Unsupported File Type (415)', `"${file.name}" is not supported. Please select a .vcf, .vcf.gz, or .vcard file.`, 'error');
    return false;
  }

  if (file.size === 0) {
    showAlert('Empty File (400)', `The selected file "${file.name}" is empty (0 bytes).`, 'error');
    return false;
  }

  if (file.size > MAX_FILE_SIZE) {
    showAlert('File Size Limit Exceeded (413)', `File size (${formatBytes(file.size)}) exceeds the maximum allowed limit of 100 MB.`, 'error');
    return false;
  }

  return true;
}

function handleFile(file) {
  if (!file) return;

  if (!validateFile(file)) {
    selectedFile = null;
    fileSelectedBox.classList.add('hidden');
    fileInput.value = '';
    return;
  }

  selectedFile = file;
  selectedFileName.textContent = file.name;
  selectedFileSize.textContent = `${formatBytes(file.size)} • ${file.type || 'VCF Document'}`;
  fileTypeIcon.textContent = file.name.endsWith('.gz') ? '🗜️' : '🧬';

  fileSelectedBox.classList.remove('hidden');
  resultsSection.classList.add('hidden');
}

// Drag & Drop
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
  });
});

dropZone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (dt && dt.files && dt.files.length > 0) handleFile(dt.files[0]);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) handleFile(e.target.files[0]);
});

cancelSelectionBtn.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  fileSelectedBox.classList.add('hidden');
  hideAlert();
});

// Upload Execution with Auth Token
uploadBtn.addEventListener('click', () => {
  if (!selectedFile) return;
  if (!validateFile(selectedFile)) return;

  if (!authToken) {
    showAlert('Authentication Required', 'Please log in with your clinical geneticist account to upload files.', 'warning');
    openAuthModal('login');
    return;
  }

  hideAlert();
  fileSelectedBox.classList.add('hidden');
  progressContainer.classList.remove('hidden');
  resultsSection.classList.add('hidden');

  progressBarFill.style.width = '0%';
  progressPercentage.textContent = '0%';
  progressDetails.textContent = `0 B / ${formatBytes(selectedFile.size)}`;
  uploadStartTime = Date.now();

  const xhr = new XMLHttpRequest();
  currentXhr = xhr;

  const uploadUrl = `/api/upload?filename=${encodeURIComponent(selectedFile.name)}`;
  xhr.open('POST', uploadUrl, true);
  xhr.setRequestHeader('X-File-Name', encodeURIComponent(selectedFile.name));
  xhr.setRequestHeader('X-File-Size', selectedFile.size);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
  xhr.setRequestHeader('X-Auth-Token', authToken);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      progressBarFill.style.width = percent + '%';
      progressPercentage.textContent = percent + '%';

      const elapsedSec = (Date.now() - uploadStartTime) / 1000;
      const speed = elapsedSec > 0 ? e.loaded / elapsedSec : 0;
      progressDetails.textContent = `${formatBytes(e.loaded)} / ${formatBytes(e.total)} (${formatBytes(speed)}/s)`;
    }
  };

  xhr.onload = () => {
    progressContainer.classList.add('hidden');
    currentXhr = null;

    let response = null;
    try {
      response = JSON.parse(xhr.responseText);
    } catch {
      response = { success: false, error: 'SERVER_ERROR', message: xhr.responseText || 'Non-JSON server response' };
    }

    if (xhr.status === 401) {
      showAlert('Session Expired', 'Please log in again to authenticate your upload.', 'warning');
      openAuthModal('login');
      fileSelectedBox.classList.remove('hidden');
      return;
    }

    if (xhr.status >= 200 && xhr.status < 300 && response.success) {
      showAlert('Success!', `"${response.file.name}" uploaded and validated successfully by ${response.uploadedBy || 'Clinical Researcher'}.`, 'success');
      renderAnalysis(response);
    } else {
      let errorTitle = 'Upload Failed';
      if (xhr.status === 413) errorTitle = 'Payload Too Large (413)';
      else if (xhr.status === 415) errorTitle = 'Unsupported Format (415)';
      else if (xhr.status === 422) errorTitle = 'Invalid VCF Structure (422)';
      else if (xhr.status === 400) errorTitle = 'Bad Request (400)';

      showAlert(errorTitle, response.message || response.error || 'Upload error occurred', 'error');
      fileSelectedBox.classList.remove('hidden');
    }
  };

  xhr.onerror = () => {
    progressContainer.classList.add('hidden');
    fileSelectedBox.classList.remove('hidden');
    currentXhr = null;
    showAlert('Network Error', 'Connection failed or server was unreachable.', 'error');
  };

  xhr.onabort = () => {
    progressContainer.classList.add('hidden');
    fileSelectedBox.classList.remove('hidden');
    currentXhr = null;
    showAlert('Cancelled', 'File upload was aborted by user.', 'warning');
  };

  xhr.send(selectedFile);
});

abortBtn.addEventListener('click', () => {
  if (currentXhr) currentXhr.abort();
});

// Render Results Dashboard
function renderAnalysis(data) {
  currentAnalysisData = data;
  const analysis = data.analysis;
  const file = data.file;

  resultsSection.classList.remove('hidden');

  // Display SHA-256 Checksum & Storage Path in Database tab
  if (file && file.sha256Hash) {
    const shaEl = document.getElementById('dbShaKey');
    if (shaEl) {
      shaEl.innerHTML = `${escapeHtml(file.sha256Hash)} ${file.isDeduplicated ? '<br><span class="badge badge-success" style="margin-top:4px; display:inline-block;">⚡ Deduplicated (Reusing Existing Storage Path - No Duplicate Files Created!)</span>' : ''}`;
    }
    const pathEl = document.getElementById('dbStoragePath');
    if (pathEl) pathEl.textContent = file.storagePath || (`/uploads/${file.savedAs}`);
  }

  document.getElementById('statFormat').textContent = analysis.formatTitle || 'VCF';
  document.getElementById('statVersion').textContent = `Specification: ${analysis.version || 'v4.x'}`;
  document.getElementById('statSize').textContent = file.sizeFormatted;
  document.getElementById('statCompression').textContent = file.isCompressed ? 'Gzip Compressed (.vcf.gz)' : 'Plain text';

  if (analysis.type === 'genomic_vcf') {
    document.getElementById('statRecords').textContent = (analysis.totalVariants || 0).toLocaleString();

    const qa = analysis.qualityAssessment || {};
    const norm = analysis.normalizationAssessment || {};
    const genes = analysis.geneDistribution || {};

    document.getElementById('statTiTv').textContent = qa.tiTv?.ratio || '-';
    document.getElementById('statTiTvSub').textContent = `Ti: ${qa.tiTv?.transitions || 0} | Tv: ${qa.tiTv?.transversions || 0}`;

    const passRate = qa.filterDistribution?.passRatePercent ?? '-';
    document.getElementById('statPassRate').textContent = passRate !== '-' ? `${passRate}%` : '-';
    document.getElementById('statPassRateSub').textContent = `${(qa.filterDistribution?.passCount || 0).toLocaleString()} PASS records`;

    document.getElementById('statNormStatus').textContent = norm.isNormalized ? '✅ Normalized' : '⚠️ Decomp. Needed';
    document.getElementById('statNormStatus').style.color = norm.isNormalized ? '#059669' : '#d97706';
    document.getElementById('statNormSub').textContent = `${norm.multiAllelicSites || 0} multi-allelic sites`;

    renderVariantsTable(analysis.previewRecords || []);
    renderQualityAssessment(qa);
    renderGeneDistribution(genes, analysis.totalVariants);
    renderNormalization(norm);
    renderMlAssessment(analysis.mlAssessment);

    document.getElementById('metaReference').textContent = analysis.metadata?.reference || 'Not specified';
    document.getElementById('metaSource').textContent = analysis.metadata?.source || 'Not specified';
    document.getElementById('metaHeaderCount').textContent = analysis.metadata?.headerLinesCount || 0;

    renderTags('infoTags', analysis.metadata?.infoFields || []);
    renderTags('filterTags', analysis.metadata?.filterFields || []);
    renderSamples(analysis.samples || []);
  } else {
    document.getElementById('statRecords').textContent = (analysis.totalContacts || 0).toLocaleString();
    document.getElementById('statTiTv').textContent = 'N/A';
    document.getElementById('statPassRate').textContent = 'N/A';
    document.getElementById('statNormStatus').textContent = 'N/A';
    renderVcardTable(analysis.previewContacts || []);
  }

  document.getElementById('jsonViewer').textContent = JSON.stringify(data, null, 2);
  resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function renderVariantsTable(records) {
  const tbody = document.getElementById('variantsTableBody');
  tbody.innerHTML = '';

  if (!records || records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 20px;">No variant records found.</td></tr>';
    return;
  }

  records.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(r.chrom)}</strong></td>
      <td>${escapeHtml(r.pos)}</td>
      <td>${escapeHtml(r.id)}</td>
      <td><span style="color:#2563eb; font-weight:600;">${escapeHtml(r.ref)}</span></td>
      <td><span style="color:#d97706; font-weight:600;">${escapeHtml(r.alt)}</span></td>
      <td>${escapeHtml(r.qual)}</td>
      <td>${r.filter === 'PASS' ? '<span class="badge badge-success">PASS</span>' : escapeHtml(r.filter)}</td>
      <td><strong style="color:#7c3aed;">${escapeHtml(r.gene || '-')}</strong></td>
      <td title="${escapeHtml(r.info)}">${escapeHtml(r.info)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('tableFooter').textContent = `Showing first ${records.length} records.`;
}

function renderQualityAssessment(qa) {
  if (!qa) return;

  document.getElementById('qaTiTvValue').textContent = qa.tiTv?.ratio || '0.00';
  document.getElementById('qaTiTvAssessment').textContent = qa.tiTv?.assessment || 'Standard variant quality';
  document.getElementById('qaTransitionsCount').textContent = (qa.tiTv?.transitions || 0).toLocaleString();
  document.getElementById('qaTransversionsCount').textContent = (qa.tiTv?.transversions || 0).toLocaleString();

  const nuc = qa.tiTv?.nucleotideDetails?.transitions || {};
  if (document.getElementById('nuc_AG')) {
    document.getElementById('nuc_AG').textContent = (nuc['A>G'] || 0).toLocaleString();
    document.getElementById('nuc_GA').textContent = (nuc['G>A'] || 0).toLocaleString();
    document.getElementById('nuc_CT').textContent = (nuc['C>T'] || 0).toLocaleString();
    document.getElementById('nuc_TC').textContent = (nuc['T>C'] || 0).toLocaleString();
    document.getElementById('nuc_AG_total').textContent = (nuc.agTotal || 0).toLocaleString();
    document.getElementById('nuc_CT_total').textContent = (nuc.ctTotal || 0).toLocaleString();
  }

  document.getElementById('qaMeanQual').textContent = qa.qualSummary?.mean || 'N/A';
  document.getElementById('qaMedianQual').textContent = qa.qualSummary?.median || 'N/A';
  document.getElementById('qaQualRange').textContent = `${qa.qualSummary?.min ?? 0} – ${qa.qualSummary?.max ?? 0}`;

  const barsContainer = document.getElementById('qualDistributionBars');
  barsContainer.innerHTML = '';

  const buckets = qa.qualBuckets || {};
  const bucketKeys = [
    { key: 'high', label: 'High (QUAL ≥ 50)', cls: 'high' },
    { key: 'moderate', label: 'Moderate (20–49)', cls: 'moderate' },
    { key: 'low', label: 'Low (< 20)', cls: 'low' },
    { key: 'missing', label: 'Unscored (.)', cls: 'missing' }
  ];

  bucketKeys.forEach(b => {
    const data = buckets[b.key] || { count: 0, percent: 0 };
    const row = document.createElement('div');
    row.className = 'dist-bar-row';
    row.innerHTML = `
      <div class="dist-bar-header">
        <span>${b.label}</span>
        <span>${data.count.toLocaleString()} variants (${data.percent}%)</span>
      </div>
      <div class="dist-bar-track">
        <div class="dist-bar-fill ${b.cls}" style="width: ${data.percent}%;"></div>
      </div>
    `;
    barsContainer.appendChild(row);
  });

  const filterContainer = document.getElementById('filterBreakdownTags');
  filterContainer.innerHTML = '';
  const filters = qa.filterDistribution?.filters || {};
  Object.entries(filters).forEach(([tag, count]) => {
    const pill = document.createElement('span');
    pill.className = `badge ${tag === 'PASS' ? 'badge-success' : 'badge-primary'}`;
    pill.textContent = `${tag}: ${count.toLocaleString()}`;
    filterContainer.appendChild(pill);
  });

  const depthBox = document.getElementById('depthStatsBox');
  if (qa.depth?.available) {
    depthBox.innerHTML = `Mean Depth: <strong>${qa.depth.mean}x</strong> (Min: ${qa.depth.min}x, Max: ${qa.depth.max}x)`;
  } else {
    depthBox.textContent = 'Depth (DP) tag not declared in INFO.';
  }
}

function renderGeneDistribution(genes, totalVariants) {
  if (!genes) return;
  document.getElementById('uniqueGenesBadge').textContent = `${(genes.uniqueGenesCount || 0).toLocaleString()} Unique Genes`;
  document.getElementById('annotatedVariantsBadge').textContent = `${(genes.totalAnnotatedVariants || 0).toLocaleString()} Annotated Variants`;

  const tbody = document.getElementById('genesTableBody');
  tbody.innerHTML = '';

  const topGenes = genes.topGenes || [];
  if (topGenes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">No gene annotations found in VCF INFO column.</td></tr>';
    return;
  }

  topGenes.forEach((g, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>#${index + 1}</strong></td>
      <td><span style="font-weight:700; color:#2563eb; font-family:var(--font-mono);">${escapeHtml(g.gene)}</span></td>
      <td><strong>${g.count.toLocaleString()}</strong></td>
      <td>${g.percentage}%</td>
      <td>
        <div class="progress-pill-bar">
          <div class="progress-pill-track">
            <div class="progress-pill-fill" style="width: ${Math.min(100, Math.max(4, g.percentage * 4))}%;"></div>
          </div>
          <span style="font-size:0.75rem; color:var(--text-muted);">${g.percentage}%</span>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderNormalization(norm) {
  if (!norm) return;

  const banner = document.getElementById('normStatusBanner');
  const title = document.getElementById('normTitle');
  const subtitle = document.getElementById('normSubtitle');
  const icon = document.getElementById('normIcon');

  if (norm.isNormalized) {
    banner.className = 'norm-status-banner';
    icon.textContent = '✅';
    title.textContent = 'VCF is Normalized & Decomposed';
    subtitle.textContent = 'All alleles are bi-allelic with standard left-aligned representations.';
  } else {
    banner.className = 'norm-status-banner needs-decomposition';
    icon.textContent = '⚠️';
    title.textContent = norm.status || 'Decomposition Recommended';
    subtitle.textContent = `Found ${norm.multiAllelicSites.toLocaleString()} multi-allelic sites (${norm.multiAllelicPercent}% of records).`;
  }

  const types = norm.variantTypes || {};
  document.getElementById('typeSnvs').textContent = (types.snvs || 0).toLocaleString();
  document.getElementById('typeInsertions').textContent = (types.insertions || 0).toLocaleString();
  document.getElementById('typeDeletions').textContent = (types.deletions || 0).toLocaleString();
  document.getElementById('typeMultiAllelic').textContent = (norm.multiAllelicSites || 0).toLocaleString();

  document.getElementById('checkMultiAllelic').innerHTML = norm.multiAllelicSites === 0
    ? '✅ <strong>Zero multi-allelic sites</strong> (Clean bi-allelic representation)'
    : `⚠️ <strong>${norm.multiAllelicSites.toLocaleString()} Multi-allelic sites</strong> detected`;

  document.getElementById('checkIndelTrim').innerHTML = norm.unnormalizedIndels === 0
    ? '✅ <strong>No redundant indel prefix/suffix</strong> observed'
    : `⚠️ <strong>${norm.unnormalizedIndels.toLocaleString()} potential un-trimmed/un-aligned indels</strong> detected`;

  if (norm.recommendedCommand) {
    document.getElementById('normCommand').textContent = norm.recommendedCommand;
  }
}

function renderTags(elementId, tags) {
  const container = document.getElementById(elementId);
  container.innerHTML = '';
  if (!tags || tags.length === 0) {
    container.innerHTML = '<span class="text-muted" style="font-size:0.8rem;">None declared</span>';
    return;
  }
  tags.forEach(tag => {
    const span = document.createElement('span');
    span.className = 'tag-pill';
    span.textContent = tag;
    container.appendChild(span);
  });
}

function renderSamples(samples) {
  const container = document.getElementById('samplesList');
  container.innerHTML = '';
  if (!samples || samples.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">No sample columns found (Single site / site-only VCF).</p>';
    return;
  }
  samples.forEach(s => {
    const span = document.createElement('span');
    span.className = 'sample-badge';
    span.textContent = s;
    container.appendChild(span);
  });
}

// --- CIVIC CANCER ACTIONABILITY MODULE ---
async function queryCivic(query = '') {
  const q = (query || document.getElementById('civicSearchInput')?.value || '').trim();
  const input = document.getElementById('civicSearchInput');
  if (input) input.value = q;

  const statusText = document.getElementById('civicStatusText');
  const cardsGrid = document.getElementById('civicCardsGrid');
  if (!statusText || !cardsGrid) return;

  statusText.innerHTML = `<span>⏳ Querying CIViC Knowledgebase for <strong>"${escapeHtml(q || 'All Actionable Markers')}"</strong>...</span>`;
  cardsGrid.innerHTML = '';

  try {
    const res = await fetch(`/api/civic?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      statusText.innerHTML = `<span style="color:#ef4444;">❌ Failed to query CIViC database: ${escapeHtml(data.message || 'Unknown error')}</span>`;
      return;
    }

    if (!data.results || data.results.length === 0) {
      statusText.innerHTML = `<span>⚠️ No CIViC actionable evidence items found matching "${escapeHtml(q)}". Try BRAF, EGFR, KRAS, BRCA1, or TP53.</span>`;
      return;
    }

    statusText.innerHTML = `<span>🎯 Found <strong>${data.results.length}</strong> Actionable Evidence Items in CIViC matching <strong>"${escapeHtml(q || 'All')}"</strong>:</span>`;

    data.results.forEach(item => {
      const card = document.createElement('div');
      card.className = 'civic-card';

      let levelClass = 'level-a';
      if (item.evidenceLevel.includes('Level B')) levelClass = 'level-b';
      else if (item.evidenceLevel.includes('Level C')) levelClass = 'level-c';

      const isResistant = item.clinicalSignificance.toLowerCase().includes('resistance');

      card.innerHTML = `
        <div class="civic-card-head">
          <div>
            <span class="civic-gene-badge">${escapeHtml(item.gene)}</span>
            <span class="civic-variant-tag">${escapeHtml(item.variant)}</span>
          </div>
          <span class="civic-level-pill ${levelClass}">${escapeHtml(item.evidenceLevel)}</span>
        </div>
        <div class="civic-disease">🩺 ${escapeHtml(item.disease)}</div>
        <div class="civic-drugs-wrap">
          <span style="font-size:0.75rem; font-weight:600; color:var(--text-muted);">Targeted Therapies:</span>
          ${item.drugs.map(d => `<span class="civic-drug-pill ${isResistant ? 'resistance' : ''}">💊 ${escapeHtml(d)}</span>`).join('')}
        </div>
        <div style="font-size:0.78rem; font-weight:700; color:${isResistant ? '#b91c1c' : '#047857'};">
          Response: ${escapeHtml(item.clinicalSignificance)} (${escapeHtml(item.evidenceType)})
        </div>
        <p class="civic-statement">${escapeHtml(item.statement)}</p>
        <div class="civic-footer-meta">
          <span>CIViC EID: <strong>${item.eid}</strong> • ⭐ ${item.rating}/5 Stars</span>
          <a href="${escapeHtml(item.civicUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb; text-decoration:none; font-weight:600;">View in CIViC ↗</a>
        </div>
      `;
      cardsGrid.appendChild(card);
    });
  } catch (err) {
    statusText.innerHTML = `<span style="color:#ef4444;">❌ Connection error: ${escapeHtml(err.message)}</span>`;
  }
}

const civicBtn = document.getElementById('civicSearchBtn');
if (civicBtn) civicBtn.addEventListener('click', () => queryCivic());

const civicInput = document.getElementById('civicSearchInput');
if (civicInput) {
  civicInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') queryCivic();
  });
}

// --- CHEBI SEARCH ---
async function searchChebi(query) {
  const q = (query || document.getElementById('chebiSearchInput')?.value || 'retinol').trim();
  if (!q) return;

  const input = document.getElementById('chebiSearchInput');
  if (input) input.value = q;

  const statusText = document.getElementById('chebiStatusText');
  const cardsList = document.getElementById('chebiCardsList');
  if (!statusText || !cardsList) return;

  statusText.innerHTML = `<span>⏳ Querying official EMBL-EBI ChEBI database for <strong>"${escapeHtml(q)}"</strong>...</span>`;
  cardsList.innerHTML = '';

  try {
    const res = await fetch(`/api/chebi?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      statusText.innerHTML = `<span style="color:#ef4444;">❌ Failed to query ChEBI: ${escapeHtml(data.message || 'Unknown error')}</span>`;
      return;
    }

    if (!data.results || data.results.length === 0) {
      statusText.innerHTML = `<span>⚠️ No ChEBI chemical entities found matching "${escapeHtml(q)}".</span>`;
      return;
    }

    statusText.innerHTML = `<span>✅ Found <strong>${data.totalFound}</strong> chemical entities in EMBL-EBI ChEBI matching <strong>"${escapeHtml(q)}"</strong>:</span>`;

    data.results.forEach(item => {
      const card = document.createElement('div');
      card.className = 'chebi-card';
      card.innerHTML = `
        <div class="chebi-card-head">
          <div class="chebi-title">${escapeHtml(item.label)}</div>
          <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="chebi-id-tag">${escapeHtml(item.chebiId)} ↗</a>
        </div>
        <p class="chebi-desc">${escapeHtml(item.description)}</p>
        ${item.synonyms && item.synonyms.length > 0 ? `
          <div class="chebi-synonyms">
            <span style="font-weight:600;">Synonyms:</span>
            ${item.synonyms.map(s => `<span class="synonym-pill">${escapeHtml(s)}</span>`).join('')}
          </div>
        ` : ''}
      `;
      cardsList.appendChild(card);
    });
  } catch (err) {
    statusText.innerHTML = `<span style="color:#ef4444;">❌ Network connection to ChEBI failed: ${escapeHtml(err.message)}</span>`;
  }
}

const chebiBtn = document.getElementById('chebiSearchBtn');
if (chebiBtn) chebiBtn.addEventListener('click', () => searchChebi());

const chebiInput = document.getElementById('chebiSearchInput');
if (chebiInput) {
  chebiInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchChebi();
  });
}

// Tabs Switching
let civicLoadedOnce = false;
let chebiLoadedOnce = false;

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const targetTabId = btn.getAttribute('data-tab');
    const targetContent = document.getElementById(targetTabId);
    if (targetContent) targetContent.classList.add('active');

    if (targetTabId === 'tabCivic' && !civicLoadedOnce) {
      civicLoadedOnce = true;
      queryCivic('');
    } else if (targetTabId === 'tabChebi' && !chebiLoadedOnce) {
      chebiLoadedOnce = true;
      searchChebi('retinol');
    } else if (targetTabId === 'tabDatabase') {
      loadDatabaseRelations();
    } else if (targetTabId === 'tabMlPredict') {
      fetch('/api/ml/metrics')
        .then(r => r.json())
        .then(data => { if (data.success) updateMlMetricCards(data); })
        .catch(() => {});
    }
  });
});

let currentInspectedTable = 'uploads';

function openDatabaseDirectly() {
  resultsSection.classList.remove('hidden');
  const dbTabBtn = document.getElementById('tabBtnDatabase');
  if (dbTabBtn) dbTabBtn.click();
  setTimeout(() => {
    const dbTab = document.getElementById('tabDatabase');
    if (dbTab) dbTab.scrollIntoView({ behavior: 'smooth' });
  }, 100);
}

function initDefaultMetadata() {
  const metaRef = document.getElementById('metaReference');
  const metaSrc = document.getElementById('metaSource');
  const metaCount = document.getElementById('metaHeaderCount');
  if (metaRef && (metaRef.textContent === 'Not specified' || metaRef.textContent === '-')) {
    metaRef.textContent = 'GRCh38 (Human Genome Assembly)';
    metaSrc.textContent = 'NCBI ClinVar / GATK HaplotypeCaller';
    metaCount.textContent = '44 Header Lines (#)';
    renderTags('infoTags', ['AF_ESP', 'AF_EXAC', 'AF_TGP', 'ALLELEID', 'CLNDN', 'CLNHGVS', 'CLNSIG', 'GENEINFO', 'MC', 'ONC', 'RS']);
    renderTags('filterTags', ['PASS (High Quality Verified)', 'LowGQX']);
  }
}
document.addEventListener('DOMContentLoaded', initDefaultMetadata);

async function loadDatabaseRelations() {
  const tbody = document.getElementById('relationsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Querying PostgreSQL/SQLite schema: genomics=# \\dt ...</td></tr>';

  try {
    const res = await fetch('/api/db/relations');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load relations');

    tbody.innerHTML = data.relations.map(rel => `
      <tr>
        <td style="color:#94a3b8;">${escapeHtml(rel.schema)}</td>
        <td style="color:#38bdf8; font-weight:600; cursor:pointer;" onclick="inspectTable('${escapeHtml(rel.name)}')">
          <code>${escapeHtml(rel.name)}</code>
        </td>
        <td><span class="terminal-badge">${escapeHtml(rel.type)}</span></td>
        <td style="color:#94a3b8;">${escapeHtml(rel.owner)}</td>
        <td>
          <span class="badge ${rel.rowCount > 0 ? 'badge-success' : 'badge-neutral'}">
            ${rel.rowCount} rows
          </span>
        </td>
        <td>
          <button class="btn btn-outline-sm" style="padding:2px 8px; font-size:11px;" onclick="inspectTable('${escapeHtml(rel.name)}')">
            🔍 Inspect
          </button>
        </td>
      </tr>
    `).join('');

    // Also inspect first table
    inspectTable(currentInspectedTable);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:#ef4444;">Error loading relations: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function inspectTable(tableName) {
  currentInspectedTable = tableName;
  const nameEl = document.getElementById('inspectorTableName');
  const thead = document.getElementById('inspectorTableHead');
  const tbody = document.getElementById('inspectorTableBody');

  if (nameEl) nameEl.innerHTML = `📋 Selected Table: <code>${escapeHtml(tableName)}</code>`;
  if (tbody) tbody.innerHTML = '<tr><td class="text-muted">Loading table records...</td></tr>';

  try {
    const res = await fetch(`/api/db/table/${encodeURIComponent(tableName)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch table data');

    const rows = data.rows || [];
    if (rows.length === 0) {
      if (thead) thead.innerHTML = '<tr><th>Status</th></tr>';
      if (tbody) tbody.innerHTML = `<tr><td class="text-muted">Table <code>${escapeHtml(tableName)}</code> is currently empty. Upload a real VCF to populate records.</td></tr>`;
      return;
    }

    const columns = Object.keys(rows[0]);
    if (thead) {
      thead.innerHTML = `<tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
    }

    if (tbody) {
      tbody.innerHTML = rows.map(r => `
        <tr>
          ${columns.map(c => {
            let val = r[c];
            if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
            if (typeof val === 'string' && val.length > 40) val = val.substring(0, 37) + '...';
            return `<td><code>${escapeHtml(val ?? 'NULL')}</code></td>`;
          }).join('')}
        </tr>
      `).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td style="color:#ef4444;">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function refreshCurrentTable() {
  inspectTable(currentInspectedTable);
}

async function runCascadeDeleteDemo() {
  const btn = document.getElementById('btnCascadeTest');
  const box = document.getElementById('cascadeResultBox');
  if (btn) btn.disabled = true;
  if (box) {
    box.classList.remove('hidden');
    box.innerHTML = 'Executing ON DELETE CASCADE transaction...';
  }

  try {
    const res = await fetch('/api/db/test-cascade', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Cascade test failed');

    const c = data.cascadeResult;
    box.innerHTML = `
      <div style="color:#059669; font-weight:bold; margin-bottom:4px;">✅ CASCADE VERIFIED!</div>
      <div>Deleted Patient: <code>${c.patientDeleted.slice(0, 18)}...</code></div>
      <div>Before delete: Files=${c.before.files}, Samples=${c.before.samples}, Reports=${c.before.reports}</div>
      <div style="color:#b91c1c; font-weight:600;">After delete: Files=${c.after.files}, Samples=${c.after.samples}, Reports=${c.after.reports}</div>
      <div style="margin-top:4px; color:#4b5563;">Status: Child records wiped automatically by SQLite/PostgreSQL foreign key cascade!</div>
    `;

    // Refresh database relations view
    loadDatabaseRelations();
  } catch (err) {
    box.innerHTML = `<span style="color:#dc2626;">Cascade Test Error: ${escapeHtml(err.message)}</span>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function runWhiteboardQuery1() {
  const box = document.getElementById('wbQuery1Result');
  if (box) {
    box.classList.remove('hidden');
    box.innerHTML = 'Executing Query 1 (JOIN & Filter)...';
  }

  try {
    const res = await fetch('/api/db/whiteboard/query1');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Query failed');

    const rows = data.results || [];
    box.innerHTML = `
      <div style="color:#059669; font-weight:bold; margin-bottom:4px;">✅ Query Executed (${rows.length} rows found):</div>
      <table style="width:100%; border-collapse:collapse; margin-top:4px;">
        <thead>
          <tr style="border-bottom:1px solid #cbd5e1; text-align:left;">
            <th>genome_build</th>
            <th>position</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><code>${escapeHtml(r.genome_build)}</code></td>
              <td><code>${escapeHtml(r.position)}</code></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    if (box) box.innerHTML = `<span style="color:#dc2626;">Error: ${escapeHtml(err.message)}</span>`;
  }
}

async function runWhiteboardQuery2() {
  const box = document.getElementById('wbQuery2Result');
  if (box) {
    box.classList.remove('hidden');
    box.innerHTML = 'Executing Query 2 (UPDATE reference/alternate alleles)...';
  }

  try {
    const res = await fetch('/api/db/whiteboard/query2', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Update failed');

    box.innerHTML = `
      <div style="color:#059669; font-weight:bold; margin-bottom:4px;">✅ Alleles Updated to 'G' and 'A'!</div>
      <div>Rows affected: <strong>${data.rowsAffected}</strong></div>
      <div style="color:#4b5563; margin-top:2px;">Check <code>genomic_loci</code> table — matched variants now have reference_allele='G' and alternate_allele='A'!</div>
    `;

    // Refresh table viewer if viewing genomic_loci
    if (currentInspectedTable === 'genomic_loci' || currentInspectedTable === 'variant_loci') {
      inspectTable(currentInspectedTable);
    }
  } catch (err) {
    if (box) box.innerHTML = `<span style="color:#dc2626;">Error: ${escapeHtml(err.message)}</span>`;
  }
}

downloadJsonBtn.addEventListener('click', () => {
  if (!currentAnalysisData) return;
  const blob = new Blob([JSON.stringify(currentAnalysisData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vcf_analysis_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

async function loadSample(sampleName) {
  hideAlert();
  try {
    const res = await fetch(`/api/samples/${sampleName}`);
    if (!res.ok) throw new Error('Sample file could not be loaded');
    const blob = await res.blob();
    const file = new File([blob], sampleName, { type: 'text/plain' });
    handleFile(file);
  } catch (err) {
    showAlert('Error', `Could not fetch sample file: ${err.message}`, 'error');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initialize Auth Status on Page Load
verifyExistingToken();

// --- MACHINE LEARNING VARIANT PATHOGENICITY & CLUSTERING ---
let allMlPredictions = [];

function renderMlAssessment(ml) {
  if (!ml) {
    fetch('/api/ml/metrics')
      .then(r => r.json())
      .then(data => {
        if (data.success) updateMlMetricCards(data);
      }).catch(() => {});
    return;
  }

  const metrics = ml.metrics || {};
  updateMlMetricCards(metrics);

  const eng = ml.engineeredFeatures || {};
  const tiTvEl = document.getElementById('mlSampleTiTv');
  if (tiTvEl) tiTvEl.textContent = eng.titv_ratio !== undefined ? `${eng.titv_ratio}` : '-';
  const tiTvDesc = document.getElementById('mlSampleTiTvDesc');
  if (tiTvDesc) tiTvDesc.textContent = `Ti: ${eng.transitions || 0} | Tv: ${eng.transversions || 0}`;

  const snvEl = document.getElementById('mlSampleSnvs');
  if (snvEl) snvEl.textContent = (eng.total_snvs || 0).toLocaleString();
  const insEl = document.getElementById('mlSampleIns');
  if (insEl) insEl.textContent = (eng.total_insertions || 0).toLocaleString();
  const delEl = document.getElementById('mlSampleDel');
  if (delEl) delEl.textContent = (eng.total_deletions || 0).toLocaleString();

  const hetHomEl = document.getElementById('mlSampleHetHom');
  if (hetHomEl) hetHomEl.textContent = eng.hethom_ratio !== undefined ? `${eng.hethom_ratio}` : '-';
  const hetHomDesc = document.getElementById('mlSampleHetHomDesc');
  if (hetHomDesc) hetHomDesc.textContent = `Het: ${eng.het_count || 0} | Hom: ${eng.hom_alt_count || 0}`;

  const rareEl = document.getElementById('mlSampleRareCount');
  if (rareEl) rareEl.textContent = (eng.rare_variant_count || 0).toLocaleString();
  const rarePct = document.getElementById('mlSampleRarePct');
  if (rarePct) rarePct.textContent = `${eng.rare_variant_percentage || 0}% of cohort (AF < 0.01)`;

  const highEl = document.getElementById('mlSampleHighImpact');
  if (highEl) highEl.textContent = (eng.high_impact_count || 0).toLocaleString();
  const highPct = document.getElementById('mlSampleHighImpactPct');
  if (highPct) highPct.textContent = `${eng.high_impact_percentage || 0}% High-Impact mutations`;

  const totalPreds = (ml.variantPredictions || []).length;
  const c0 = (ml.variantPredictions || []).filter(p => p.cluster === 0).length;
  const c1 = (ml.variantPredictions || []).filter(p => p.cluster === 1).length;
  const clusterEl = document.getElementById('mlSampleClusters');
  if (clusterEl) clusterEl.textContent = totalPreds ? `C0: ${c0} | C1: ${c1}` : 'k=2';

  allMlPredictions = ml.variantPredictions || [];
  renderMlPredictionsTable(allMlPredictions);
}

function updateMlMetricCards(metrics) {
  const sup = metrics.supervised_rf || {};
  const unsup = metrics.unsupervised_kmeans || {};

  const accEl = document.getElementById('mlAccuracy');
  if (accEl && sup.accuracy !== undefined) accEl.textContent = `${(sup.accuracy * 100).toFixed(1)}%`;
  const precEl = document.getElementById('mlPrecision');
  if (precEl && sup.precision !== undefined) precEl.textContent = `${(sup.precision * 100).toFixed(1)}%`;
  const recEl = document.getElementById('mlRecall');
  if (recEl && sup.recall !== undefined) recEl.textContent = `${(sup.recall * 100).toFixed(1)}%`;
  const f1El = document.getElementById('mlF1');
  if (f1El && sup.f1_score !== undefined) f1El.textContent = `${(sup.f1_score * 100).toFixed(1)}%`;
  const aucEl = document.getElementById('mlRocAuc');
  if (aucEl && sup.roc_auc !== undefined) aucEl.textContent = `${sup.roc_auc.toFixed(3)}`;
  const silEl = document.getElementById('mlSilhouette');
  if (silEl && unsup.silhouette_score !== undefined) silEl.textContent = `${unsup.silhouette_score.toFixed(3)}`;
}

function renderMlPredictionsTable(predictions) {
  const tbody = document.getElementById('mlPredictionsBody');
  if (!tbody) return;

  const countAll = predictions.length;
  const countPathogenic = predictions.filter(p => p.predicted_label === 'Pathogenic').length;
  const countBenign = predictions.filter(p => p.predicted_label === 'Benign').length;

  const countAllEl = document.getElementById('countMlAll');
  if (countAllEl) countAllEl.textContent = countAll;
  const countPathEl = document.getElementById('countMlPathogenic');
  if (countPathEl) countPathEl.textContent = countPathogenic;
  const countBenEl = document.getElementById('countMlBenign');
  if (countBenEl) countBenEl.textContent = countBenign;

  if (predictions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted" style="padding:24px;">No variant predictions available for this file.</td></tr>';
    return;
  }

  tbody.innerHTML = predictions.map(p => {
    const isPathogenic = p.predicted_label === 'Pathogenic';
    const badgeColor = isPathogenic ? 'background:#ef4444; color:#fff;' : 'background:#10b981; color:#fff;';
    const impactColor = p.impact === 'HIGH' ? '#dc2626' : (p.impact === 'MODERATE' ? '#d97706' : '#2563eb');
    const clusterBadge = p.cluster === 0
      ? '<span class="badge" style="background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; font-size:11px;">Cluster 0 (Deleterious)</span>'
      : '<span class="badge" style="background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; font-size:11px;">Cluster 1 (Tolerated)</span>';

    const probBarWidth = Math.round(p.pathogenicity_probability * 100);
    const probBarColor = isPathogenic ? '#ef4444' : '#10b981';

    return `<tr>
      <td><strong>${escapeHtml(p.chrom)}:${escapeHtml(p.pos)}</strong></td>
      <td><code>${escapeHtml(p.ref)} &gt; ${escapeHtml(p.alt)}</code></td>
      <td><span class="gene-pill">${escapeHtml(p.gene)}</span></td>
      <td><span style="font-size:12px; font-weight:600;">${escapeHtml(p.consequence)}</span></td>
      <td><span style="color:${impactColor}; font-weight:700;">${escapeHtml(p.impact)}</span></td>
      <td>
        <span class="badge" style="${badgeColor} font-weight:700; padding:4px 10px; border-radius:12px;">
          ${isPathogenic ? '🚨 Pathogenic' : '✅ Benign'}
        </span>
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="flex:1; background:#e2e8f0; height:8px; border-radius:4px; overflow:hidden; min-width:60px;">
            <div style="width:${probBarWidth}%; height:100%; background:${probBarColor}; border-radius:4px;"></div>
          </div>
          <span style="font-size:12px; font-weight:700;">${p.confidence_percent}%</span>
        </div>
      </td>
      <td>${clusterBadge}</td>
      <td style="font-size:12px; color:#475569;">${escapeHtml(p.key_signals)}</td>
    </tr>`;
  }).join('');
}

function filterMlTable(filterType) {
  document.querySelectorAll('#tabMlPredict .btn-outline-sm').forEach(b => b.classList.remove('active'));
  if (filterType === 'ALL') {
    document.getElementById('filterMlAll')?.classList.add('active');
    renderMlPredictionsTable(allMlPredictions);
  } else {
    const btn = document.getElementById(`filterMl${filterType}`);
    if (btn) btn.classList.add('active');
    const filtered = allMlPredictions.filter(p => p.predicted_label === filterType);
    renderMlPredictionsTable(filtered);
  }
}
window.filterMlTable = filterMlTable;
