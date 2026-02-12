#!/bin/bash
# Sync SQLite database and cache files to GCS bucket, then export to BigQuery
# Run this after sync-and-precompute.sh

set -e

BUCKET="gs://moltbook-monitoring-db"
DB_PATH="$HOME/moltbook-tracker/moltbook.db"
CACHE_DIR="$HOME/moltbook-monitor/cache"
EXPORT_SCRIPT="$HOME/moltbook-tracker/export_to_bigquery.py"
VENV_PYTHON="$HOME/moltbook-tracker/venv/bin/python"

# Export to BigQuery (incremental) - optional, set EXPORT_TO_BQ=true
EXPORT_TO_BQ="${EXPORT_TO_BQ:-true}"

echo "$(date '+%Y-%m-%d %H:%M:%S') Syncing to GCS..."

# Upload the SQLite database
echo "Uploading database..."
gsutil -q cp -a public-read "$DB_PATH" "$BUCKET/moltbook.db"

# Upload cache files
echo "Uploading cache files..."
gsutil -q -m cp "$CACHE_DIR"/*.json "$BUCKET/cache/"

# Generate metadata
echo "{\"lastSync\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"dbSize\": $(stat -c%s "$DB_PATH")}" > /tmp/sync-meta.json
gsutil -q cp /tmp/sync-meta.json "$BUCKET/sync-meta.json"

echo "$(date '+%Y-%m-%d %H:%M:%S') GCS sync complete!"

# Export to BigQuery (incremental)
if [ "$EXPORT_TO_BQ" = "true" ] && [ -f "$EXPORT_SCRIPT" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') Exporting to BigQuery (incremental)..."
  "$VENV_PYTHON" "$EXPORT_SCRIPT" incremental 2>&1 || echo "BigQuery export failed (non-fatal)"
  echo "$(date '+%Y-%m-%d %H:%M:%S') BigQuery export complete!"
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') All syncs complete!"
