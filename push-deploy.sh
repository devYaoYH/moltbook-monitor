#!/bin/bash
# Push to remote and deploy to Cloud Run
# Usage: ./push-deploy.sh [branch]

BRANCH=${1:-main}

echo "📤 Pushing to origin/$BRANCH..."
git push origin "$BRANCH"

if [ $? -eq 0 ]; then
    echo ""
    echo "🚀 Push successful! Running deploy..."
    ./deploy.sh
else
    echo "❌ Push failed!"
    exit 1
fi
