#!/bin/bash
# Sync moltbook data, precompute clusters, and optionally upload to GCS
# Run this on a cron schedule (e.g., every 30 minutes)

set -e

UPLOAD_TO_GCS="${UPLOAD_TO_GCS:-false}"

echo "$(date '+%Y-%m-%d %H:%M:%S') Starting sync..."

# Step 1: Sync posts from Moltbook API
cd ~/moltbook-tracker
python3 tracker.py sync

# Step 2: Precompute clusters
cd ~/moltbook-monitor
node scripts/precompute-clusters.js

# Step 3: Upload to GCS (if enabled)
if [ "$UPLOAD_TO_GCS" = "true" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') Uploading to GCS..."
  bash scripts/sync-to-gcs.sh
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Sync complete!"
