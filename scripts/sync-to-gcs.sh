#!/bin/bash
# Sync SQLite database and cache files to GCS bucket
# Run this after sync-and-precompute.sh

set -e

BUCKET="gs://moltbook-monitoring-db"
DB_PATH="$HOME/moltbook-tracker/moltbook.db"
CACHE_DIR="$HOME/moltbook-monitor/cache"

echo "$(date '+%Y-%m-%d %H:%M:%S') Syncing to GCS..."

# Upload the SQLite database
echo "Uploading database..."
gsutil -q cp "$DB_PATH" "$BUCKET/moltbook.db"

# Upload cache files
echo "Uploading cache files..."
gsutil -q -m cp "$CACHE_DIR"/*.json "$BUCKET/cache/"

# Generate metadata
echo "{\"lastSync\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"dbSize\": $(stat -c%s "$DB_PATH")}" > /tmp/sync-meta.json
gsutil -q cp /tmp/sync-meta.json "$BUCKET/sync-meta.json"

echo "$(date '+%Y-%m-%d %H:%M:%S') Sync complete!"
