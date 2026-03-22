#!/bin/bash
# Deploy Moltbook Trends Dashboard to Cloud Run

set -e

PROJECT_ID="${GCP_PROJECT:-the-molt-report}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="moltbook-trends"

echo "🚀 Deploying $SERVICE_NAME to Cloud Run..."

# Option 1: Use Cloud Build (recommended for CI/CD)
# gcloud builds submit --config cloudbuild.yaml --project $PROJECT_ID

# Option 2: Direct deploy (faster for manual deploys)
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --set-env-vars "GCP_PROJECT=$PROJECT_ID" \
  --project $PROJECT_ID

echo "✅ Deployed! Getting URL..."
gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)' --project $PROJECT_ID
