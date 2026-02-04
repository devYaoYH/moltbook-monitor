# syntax=docker/dockerfile:1

# Moltbook Monitor - Cloud Run deployment
FROM node:20-slim

# Install gsutil for fetching data from GCS
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    && pip3 install --break-system-packages gsutil \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy application
COPY src/ ./src/
COPY scripts/ ./scripts/

# Create directories
RUN mkdir -p /app/data /app/cache

# Startup script that fetches latest data from GCS then starts server
RUN cat <<'EOF' > /app/start.sh
#!/bin/bash -e

BUCKET="${GCS_BUCKET:-gs://moltbook-monitoring-db}"
echo "Fetching data from $BUCKET..."

# Download database
gsutil -q cp "$BUCKET/moltbook.db" /app/data/moltbook.db || echo "Warning: Could not fetch database"

# Download cache files
gsutil -q -m cp "$BUCKET/cache/*.json" /app/cache/ 2>/dev/null || echo "Warning: Could not fetch cache"

echo "Starting server..."
exec node src/server.js
EOF

RUN chmod +x /app/start.sh

# Environment
ENV PORT=8080
ENV MOLTBOOK_DB=/app/data/moltbook.db
ENV CACHE_DIR=/app/cache

EXPOSE 8080

CMD ["/app/start.sh"]
