# Moltbook Monitor

**All-in-one moltbook infrastructure:** Scraper, BigQuery sync, and trends dashboard.

## Components

### 1. Tracker (Python)
Scrapes moltbook API → SQLite → BigQuery

**Location:** `tracker/`

**Key files:**
- `tracker.py` - Fetch posts from moltbook API
- `export_to_bigquery.py` - Sync SQLite → BigQuery
- `report_generator.py` - Generate pulse/digest reports
- `moltbook.db` - SQLite database (gitignored, 1GB+)

**Setup:**
```bash
cd tracker
pip3 install -r requirements.txt

# Configure credentials
mkdir -p ~/.config/moltbook
echo '{"api_key": "YOUR_API_KEY"}' > ~/.config/moltbook/credentials.json

# Fetch posts
./tracker.py sync

# Export to BigQuery (optional)
./export_to_bigquery.py incremental
```

### 2. Dashboard (Node.js)
BigQuery-backed trends visualization

**Location:** `dashboard/`

**Features:**
- Submolt activity trends (14-day chart)
- Emerging topics (growth detection)
- Trending keywords from titles
- Hourly activity patterns
- Top submolts and authors

**Local development:**
```bash
cd dashboard
npm install
npm start  # http://localhost:3002
```

**Deploy to Cloud Run:**
```bash
cd dashboard
gcloud builds submit --tag gcr.io/the-molt-report/moltbook-trends
gcloud run deploy moltbook-trends \
  --image gcr.io/the-molt-report/moltbook-trends \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

**Public URL:** https://moltbook-trends-366966696644.us-central1.run.app

### 3. Scripts (Optional)
Offline pipelines for aggregation and analysis

**Location:** `scripts/`

- `sync-all.sh` - Run tracker → BigQuery export → precompute
- `precompute-clusters.js` - Clustering and novelty scoring (optional)

## Quick Start

### Initial Setup
```bash
# Clone repo
git clone git@github.com:devYaoYH/moltbook-monitor.git ~/moltbook-monitor
cd ~/moltbook-monitor

# Setup tracker
cd tracker
pip3 install -r requirements.txt

# Setup dashboard
cd ../dashboard
npm install

# Start dashboard
npm start
```

### Cron Job (Automated Sync)
Add to crontab or use OpenClaw cron:
```bash
# Every 30 minutes: sync posts + export to BigQuery
*/30 * * * * cd ~/moltbook-monitor && ./scripts/sync-all.sh
```

## Architecture

```
Moltbook API → tracker.py → SQLite (moltbook.db)
                              ↓
                     export_to_bigquery.py
                              ↓
                         BigQuery (posts table)
                              ↓
                      Dashboard (port 3002)
                      Queries BigQuery for analytics
```

## API Endpoints

Dashboard exposes:
- `GET /api/stats` - Overall statistics
- `GET /api/submolt-trends?days=14` - Time series data
- `GET /api/emerging` - Topics with growth/decline
- `GET /api/keywords?days=3` - Trending keywords
- `GET /api/hourly` - Activity by hour
- `GET /api/top-submolts` - Leaderboard
- `GET /api/authors` - Top contributors

## BigQuery Setup

**Project:** `the-molt-report`  
**Dataset:** `moltbook`  
**Table:** `posts`

Schema managed by `tracker/export_to_bigquery.py` (creates table if missing).

## Development

**Tracker:**
```bash
cd tracker
python3 tracker.py sync     # Fetch latest posts
python3 export_to_bigquery.py full  # Full export
```

**Dashboard:**
```bash
cd dashboard
npm run dev  # Watch mode
```

## Deployment

**Dashboard to Cloud Run:**
```bash
cd dashboard
./deploy.sh  # Builds + deploys
```

Dockerfile and cloudbuild.yaml included.

## Credentials

**Required:**
- `~/.config/moltbook/credentials.json` - Moltbook API key
- `~/.config/gcloud/` - Google Cloud credentials (for BigQuery)

**Never commit credentials to git!**

## File Structure

```
moltbook-monitor/
├── tracker/              ← Python scraper + BigQuery sync
│   ├── tracker.py
│   ├── export_to_bigquery.py
│   ├── report_generator.py
│   ├── schema.sql
│   └── requirements.txt
├── dashboard/            ← Trends visualization (port 3002)
│   ├── server.js
│   ├── package.json
│   ├── public/
│   ├── Dockerfile
│   └── cloudbuild.yaml
├── scripts/              ← Optional offline pipelines
│   ├── sync-all.sh
│   └── precompute-clusters.js
├── .gitignore
└── README.md
```

---

**Repository:** https://github.com/devYaoYH/moltbook-monitor  
**Dashboard:** https://moltbook-trends-366966696644.us-central1.run.app  
**Agent:** Ethan (MoltReporter)
