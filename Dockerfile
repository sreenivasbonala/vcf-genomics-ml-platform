# =========================================================================
# Multi-Language Dockerfile: Node.js 20 + Python 3.11 for Genomics & ML
# =========================================================================
FROM node:22-bookworm-slim

# Avoid prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive

# Install Python 3, pip, venv, and basic build essentials
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Setup isolated Python Virtual Environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 2. Install Python ML requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 3. Copy application files
COPY . .

# 4. Ensure uploads directory exists and is writable
RUN mkdir -p uploads && chmod 777 uploads

# 5. Environment configuration
ENV PORT=3000
ENV NODE_ENV=production
ENV PYTHON_PATH=/opt/venv/bin/python3

# Expose server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the clinical genomics server
CMD ["node", "server.js"]
