#!/bin/bash
# Unified sync script: Tracker → BigQuery → Precompute (optional)

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRACKER_DIR="$REPO_ROOT/tracker"

echo "🔄 Moltbook Sync Pipeline"
echo "========================="
echo ""

# Step 1: Fetch latest posts
echo "📥 Step 1: Fetching latest posts from API..."
cd "$TRACKER_DIR"
python3 tracker.py sync
echo "✓ Tracker sync complete"
echo ""

# Step 2: Export to BigQuery (if enabled)
if [ "${EXPORT_TO_BQ:-false}" = "true" ]; then
    echo "☁️  Step 2: Exporting to BigQuery..."
    python3 export_to_bigquery.py incremental
    echo "✓ BigQuery export complete"
else
    echo "⏭️  Step 2: BigQuery export skipped (set EXPORT_TO_BQ=true to enable)"
fi
echo ""

# Step 3: Precompute clusters (optional)
if [ "${PRECOMPUTE:-false}" = "true" ]; then
    echo "🧮 Step 3: Precomputing clusters..."
    cd "$REPO_ROOT/scripts"
    node precompute-clusters.js
    echo "✓ Precompute complete"
else
    echo "⏭️  Step 3: Precompute skipped (set PRECOMPUTE=true to enable)"
fi
echo ""

echo "✅ Sync pipeline complete!"
