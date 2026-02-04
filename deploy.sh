# Build and push to Artifact Registry (or use Cloud Build)
gcloud builds submit --config cloudbuild.yaml .

# Deploy
gcloud run deploy moltbook-monitor \
  --image gcr.io/the-molt-report/moltbook-monitor:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GCS_BUCKET=gs://moltbook-monitoring-db
