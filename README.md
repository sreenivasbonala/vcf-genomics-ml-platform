# 🧬 VCF File Uploader & Inspector

A robust, high-performance web application designed to upload, validate, and inspect **VCF (Variant Call Format v4.x)** and **vCard** files with strict **100 MB** size limits and comprehensive error handling.

Built with **Zero External Dependencies** (runs on standard Node.js built-ins: `http`, `stream`, `zlib`, `readline`, `fs`).

---

## 🚀 Key Features

- **Strict 100 MB Limit Enforcement**:
  - **Client-Side:** Immediate file size check before upload begins; warns users instantly.
  - **Server-Side Header Check:** Upfront `Content-Length` validation drops oversized requests before buffering.
  - **Streaming Guard:** Chunk-by-chunk stream counting immediately aborts transfer, terminates the connection, and deletes the partial file if the stream exceeds 100 MB.
- **Comprehensive Error Handling**:
  - `400 Bad Request`: Empty (0 bytes) file, missing filename.
  - `413 Payload Too Large`: Upload exceeding 100 MB (104,857,600 bytes).
  - `415 Unsupported Media Type`: Files with disallowed extensions (accepts only `.vcf`, `.vcf.gz`, `.vcard`).
  - `422 Unprocessable Entity`: Corrupted gzip archives, missing `##fileformat=VCF` or `BEGIN:VCARD` headers, malformed chromosome coordinate lines.
  - `500 Internal Server Error`: Stream read/write failures.
- **Genomic VCF & vCard Support**:
  - Automatic detection of Genomic Variant Call Format (`##fileformat=VCFv4.x`) or Contact Directory (`BEGIN:VCARD`).
  - Gzip decompression on the fly for compressed archives (`.vcf.gz`).
  - Column inspection (`#CHROM`, `POS`, `ID`, `REF`, `ALT`, `QUAL`, `FILTER`, `INFO`, `FORMAT`).
  - Sample ID discovery and count (e.g. `NA00001`, `NA00002`).
  - Metadata parsing (`##reference`, `##source`, `##INFO`, `##FILTER`).
- **Modern User Interface**:
  - Drag-and-drop zone with animated feedback.
  - Real-time progress bar with upload speed, bytes transferred, and percentage.
  - Cancel / Abort upload button.
  - Interactive Preview Table for variants and contacts.
  - One-click sample test files to verify all valid and invalid scenarios.
  - Exportable JSON inspection report.

---

## 🛠️ Quick Start

### 1. Start the Server
Navigate to the project folder on your Desktop and start the server:

```bash
cd ~/Desktop/vcf-upload-app
npm start
# or: node server.js
```

The application will be running at:
👉 **http://localhost:3000**

### 2. Run Automated Test Suite
To run the automated tests covering all error conditions and file formats:

```bash
node test.js
```

---

## 📡 API Reference

### `POST /api/upload`
Streams and inspects a VCF file.

- **Headers:**
  - `Content-Type: application/octet-stream`
  - `X-File-Name: <filename.vcf>`
  - `X-File-Size: <bytes>`
- **Query Params:** `?filename=<filename.vcf>`
- **Responses:**
  - `200 OK`: File successfully validated and parsed.
  - `400 Bad Request`: Empty file or bad parameters.
  - `413 Payload Too Large`: Exceeds 100 MB.
  - `415 Unsupported Media Type`: Non-VCF extension.
  - `422 Unprocessable Entity`: Malformed VCF headers or syntax.

### `GET /api/health`
Returns system status, max file size, and uptime.

### `GET /api/samples/:filename`
Downloads bundled sample test files (`sample_variants.vcf`, `sample_multisample.vcf`, `sample_contacts.vcf`, `sample_invalid.vcf`).

---

## 📂 Project Structure

```
~/Desktop/vcf-upload-app/
├── server.js               # Node.js streaming server with 100MB limit & VCF parser
├── test.js                 # Test suite covering 200, 400, 413, 415, 422 cases
├── package.json            # Scripts: start, test
├── README.md               # Documentation & guide
├── public/
│   ├── index.html          # Modern HTML5 responsive dashboard
│   ├── style.css           # Modern CSS variables, dark/light styling
│   └── app.js              # Client validation, progress tracking, table rendering
├── test-samples/
│   ├── sample_variants.vcf     # Standard VCF 4.2
│   ├── sample_multisample.vcf  # Multi-sample VCF with genotypes
│   ├── sample_contacts.vcf     # vCard contact format
│   └── sample_invalid.vcf      # Malformed file for testing error responses
└── uploads/                # Directory where uploaded files are safely processed
```
