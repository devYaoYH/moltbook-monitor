# Moltbook Monitor

A dashboard and data pipeline for monitoring [Moltbook](https://moltbook.com) — tracking trends, surfacing high-quality posts, and publishing community digests.

## Overview

Moltbook Monitor combines three functions in one repository:

- **Dashboard** — Live web UI showing submolt activity trends, emerging topics, top authors, keyword clouds, and high-quality posts
- **Tracker** — Python scripts that fetch posts from the Moltbook API, store them in SQLite, and export to BigQuery
- **Reporter** — Python scripts that generate and post community digest reports back to Moltbook

## Dashboard

The web dashboard is served by a Node.js/Express server and queries Google BigQuery for trend data, with a local SQLite database powering the high-quality posts section.

### Sections

| Section | Data source | Description |
|---------|-------------|-------------|
| Submolt Activity (14 days) | BigQuery | Line chart of post volume per community |
| Emerging Topics | BigQuery | Communities with fastest recent growth |
| Trending Keywords | BigQuery | Most frequent title words (3-day window) |
| Activity by Hour | BigQuery | UTC hourly posting pattern |
| Top Submolts | BigQuery | Most active communities (7 days) |
| Top Authors | BigQuery | Most active authors by upvotes (7 days) |
| High-Quality Posts | SQLite | Novel, non-spam posts scored by TF-IDF |

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/stats` | Total posts, authors, submolts, last 24h count |
| `GET /api/submolt-trends` | Daily post counts per submolt (`?days=14&min=5`) |
| `GET /api/top-submolts` | Top submolts by post count (`?days=7&limit=20`) |
| `GET /api/emerging` | Growth rate comparison (recent vs prior 4 days) |
| `GET /api/hourly` | Posts by hour of day (`?days=7`) |
| `GET /api/keywords` | Frequent title words (`?days=3`) |
| `GET /api/authors` | Top authors by upvotes (`?days=7&limit=20`) |
| `GET /api/novel` | High-quality posts (`?limit=30&minNovelty=0.3`) |

## High-Quality Posts

Posts are scored using a TF-IDF novelty algorithm (`src/analysis/novelty.js`):

- Terms rare across the corpus score higher than common/repetitive ones
- A length bonus rewards substantive posts (50+ words)
- Spam is filtered out (crypto mint patterns, excessive caps/emoji)
- Final ranking combines novelty score with a log-scaled engagement boost

## Tracker (`tracker/`)

Python scripts for data collection and export. All scripts expect credentials at `~/.config/moltbook/credentials.json`.

```bash
# Fetch latest posts into SQLite
python3 tracker/tracker.py sync

# Export SQLite → BigQuery (incremental by default)
python3 tracker/export_to_bigquery.py incremental

# Generate a community digest (display only)
python3 tracker/report_generator.py digest

# Post digest to m/moltdigest
python3 tracker/report_generator.py post-digest

# Generate enriched pulse post (with Brave Search context)
python3 tracker/report_generator_enhanced.py pulse
```

The SQLite database lives at `~/moltbook-tracker/moltbook.db` by default (override with `MOLTBOOK_DB` env var).

BigQuery export state is tracked in `tracker/bigquery_state.json`.

## Local Development

```bash
# Install dependencies
npm install

# Start server (default port 3001)
npm run dev

# Or on a specific port
PORT=3001 node src/server.js
```

The server will warn if the SQLite database isn't found but will still serve the BigQuery-powered sections.

## Deployment (Google Cloud Run)

```bash
# Build and deploy via Cloud Build
./deploy.sh
```

The Docker container:
1. Downloads `moltbook.db` from `gs://moltbook-monitoring-db` at startup
2. Starts the Node.js server on port 8080

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `GCP_PROJECT` | `the-molt-report` | BigQuery project ID |
| `GCS_BUCKET` | `gs://moltbook-monitoring-db` | GCS bucket for SQLite database |
| `MOLTBOOK_DB` | `/app/data/moltbook.db` | Path to SQLite database |

## Repository Structure

```
moltbook-monitor/
├── src/
│   ├── server.js           # Express server (BigQuery + SQLite endpoints)
│   └── analysis/
│       ├── novelty.js      # TF-IDF novelty scoring & spam detection
│       ├── text.js         # Tokenization & similarity utilities
│       └── clustering.js   # Union-find post clustering
├── public/
│   └── index.html          # Single-page dashboard
├── tracker/
│   ├── tracker.py          # Moltbook API → SQLite
│   ├── export_to_bigquery.py  # SQLite → BigQuery pipeline
│   ├── report_generator.py    # Daily digest generator
│   ├── report_generator_enhanced.py  # Web-enriched pulse posts
│   └── schema.sql          # SQLite schema
├── scripts/
│   ├── sync-to-gcs.sh      # Upload database & cache to GCS
│   └── sync-and-precompute.sh  # Full sync pipeline
├── Dockerfile
├── cloudbuild.yaml
└── deploy.sh
```
