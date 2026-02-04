# Moltbook Monitor — GCP Architecture

## Overview

Lambda-style architecture for continuous data collection with separation of live vs historical data.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Cloud Scheduler                              │
│                    (every 30 min / hourly)                          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Cloud Function: Scraper                          │
│   • Fetches new posts from Moltbook API                             │
│   • Writes to Firestore (live transactional data)                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Firestore (Live Data)                            │
│   • Collection: posts                                               │
│   • Rolling window: last 24-48 hours                                │
│   • Indexed for real-time queries                                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        │                                             │
        ▼                                             ▼
┌───────────────────────┐               ┌─────────────────────────────┐
│  Cloud Run: Frontend  │               │ Cloud Function: Compactor   │
│  • Serves dashboard   │               │ • Runs daily at 00:00 UTC   │
│  • Queries Firestore  │               │ • Exports yesterday's data  │
│    for live data      │               │   to SQLite file            │
│  • Loads historical   │               │ • Uploads to GCS bucket     │
│    SQLite from GCS    │               │ • Deletes old Firestore     │
└───────────────────────┘               │   records (>48h)            │
        │                               └──────────────┬──────────────┘
        │                                              │
        ▼                                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                   Cloud Storage Bucket                             │
│   moltbook-data/                                                   │
│   ├── historical/                                                  │
│   │   ├── 2026-01-28.sqlite                                       │
│   │   ├── 2026-01-29.sqlite                                       │
│   │   └── ...                                                      │
│   ├── exports/                                                     │
│   │   └── full-dataset.sqlite (weekly full dump)                  │
│   └── public/                                                      │
│       └── latest-snapshot.json (for researchers)                  │
└───────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Cloud Function: Scraper (`moltbook-scraper`)

**Trigger:** Cloud Scheduler (every 30 minutes)
**Runtime:** Node.js 20
**Memory:** 256MB
**Timeout:** 60s

```javascript
// Pseudo-code
exports.scrape = async (event, context) => {
  const moltbookApi = new MoltbookAPI(process.env.MOLTBOOK_API_KEY);
  const firestore = new Firestore();
  
  // Fetch hot, new, top posts
  const posts = await Promise.all([
    moltbookApi.getPosts({ sort: 'hot', limit: 50 }),
    moltbookApi.getPosts({ sort: 'new', limit: 50 }),
    moltbookApi.getPosts({ sort: 'top', limit: 50 })
  ]);
  
  // Dedupe and upsert to Firestore
  const batch = firestore.batch();
  for (const post of dedupe(posts.flat())) {
    batch.set(firestore.doc(`posts/${post.id}`), post, { merge: true });
  }
  await batch.commit();
  
  return { stored: posts.length };
};
```

### 2. Firestore Collections

```
posts/
  {post_id}/
    id: string
    title: string
    content: string
    author: string
    submolt: string
    upvotes: number
    downvotes: number
    comment_count: number
    created_at: timestamp
    fetched_at: timestamp
    _scraped_at: timestamp  # For compaction

daily_stats/
  {date}/
    total_posts: number
    unique_authors: number
    total_upvotes: number
    compacted: boolean
```

### 3. Cloud Function: Compactor (`moltbook-compactor`)

**Trigger:** Cloud Scheduler (daily at 00:30 UTC)
**Runtime:** Node.js 20
**Memory:** 512MB
**Timeout:** 300s

```javascript
exports.compact = async (event, context) => {
  const yesterday = getYesterdayDate();
  const firestore = new Firestore();
  const storage = new Storage();
  
  // Query all posts from yesterday
  const posts = await firestore
    .collection('posts')
    .where('created_at', '>=', yesterdayStart)
    .where('created_at', '<', todayStart)
    .get();
  
  // Create SQLite file in /tmp
  const db = new Database('/tmp/data.sqlite');
  db.exec(SCHEMA);
  const insert = db.prepare(INSERT_STMT);
  for (const doc of posts.docs) {
    insert.run(doc.data());
  }
  db.close();
  
  // Upload to GCS
  await storage
    .bucket('moltbook-data')
    .upload('/tmp/data.sqlite', {
      destination: `historical/${yesterday}.sqlite`
    });
  
  // Delete old Firestore records (>48h)
  // ... batch delete
  
  return { compacted: posts.size, date: yesterday };
};
```

### 4. Cloud Run: Frontend (`moltbook-monitor`)

**Container:** Node.js 20 + Express
**Memory:** 512MB
**CPU:** 1
**Min instances:** 0 (scale to zero)
**Max instances:** 3

The frontend aggregates:
1. **Live data** — Query Firestore for posts < 48h old
2. **Historical data** — Download SQLite files from GCS, query with better-sqlite3

```javascript
// Aggregation strategy
async function getPosts(startDate, endDate) {
  const results = [];
  
  // Determine which sources to query
  const today = new Date();
  const cutoff = new Date(today - 48 * 60 * 60 * 1000);
  
  if (endDate > cutoff) {
    // Query Firestore for recent data
    results.push(...await queryFirestore(Math.max(startDate, cutoff), endDate));
  }
  
  if (startDate < cutoff) {
    // Load historical SQLite files
    const dates = getDateRange(startDate, Math.min(endDate, cutoff));
    for (const date of dates) {
      const sqliteFile = await downloadFromGCS(`historical/${date}.sqlite`);
      results.push(...await querySQLite(sqliteFile));
    }
  }
  
  return results;
}
```

### 5. Cloud Storage Bucket

**Bucket:** `moltbook-data`
**Location:** us-central1 (same as functions)
**Storage class:** Standard (frequently accessed)
**Public access:** Selective (exports folder)

```
moltbook-data/
├── historical/           # Daily SQLite compactions (private)
│   ├── 2026-01-28.sqlite
│   └── ...
├── exports/              # Public dataset exports
│   ├── full-dataset.sqlite
│   └── latest.json
└── cache/                # Frontend cache files
    └── ...
```

## Cost Estimate (at current volume)

| Component | Usage | Monthly Cost |
|-----------|-------|--------------|
| Cloud Functions | ~1,500 invocations | ~$0.00 (free tier) |
| Firestore | ~100K reads, ~100K writes | ~$0.50 |
| Cloud Storage | ~5GB | ~$0.10 |
| Cloud Run | ~10K requests, ~5 CPU-hours | ~$0.50 |
| Cloud Scheduler | 50 jobs | ~$0.00 (free tier) |
| **Total** | | **~$1-2/month** |

## Setup Checklist

### What you need to do in GCP Console:

1. **Create a new GCP project** (or use existing)
   - Name suggestion: `moltbook-monitor`

2. **Enable APIs:**
   ```
   gcloud services enable \
     cloudfunctions.googleapis.com \
     cloudscheduler.googleapis.com \
     run.googleapis.com \
     firestore.googleapis.com \
     storage.googleapis.com
   ```

3. **Create Firestore database:**
   - Go to Firestore → Create database
   - Mode: Native
   - Location: `us-central1`

4. **Create Cloud Storage bucket:**
   - Name: `moltbook-data-{project-id}` (must be globally unique)
   - Location: `us-central1`
   - Storage class: Standard

5. **Create a service account** (for local development):
   - IAM → Service Accounts → Create
   - Name: `moltbook-dev`
   - Roles: Firestore User, Storage Object Admin
   - Create key (JSON) → download to `~/.config/gcloud/moltbook-sa.json`

6. **Store the Moltbook API key:**
   ```
   gcloud secrets create moltbook-api-key \
     --data-file=/path/to/api-key.txt
   ```

### What I can automate:

Once you give me:
- GCP project ID
- Service account key (or run `gcloud auth application-default login`)
- Bucket name

I can:
- Write all the Cloud Function code
- Create the Dockerfile for Cloud Run
- Write Terraform configs (optional) or gcloud deploy scripts
- Set up the Cloud Scheduler jobs
- Migrate existing SQLite data to the new architecture

## Alternative: Simpler Architecture

If the lambda architecture feels over-engineered for current scale:

**Option B: Just SQLite on Cloud Storage**
- Keep current architecture
- Cloud Function syncs to SQLite every 30 min
- Upload SQLite to GCS after each sync
- Cloud Run downloads latest SQLite on startup + periodic refresh
- No Firestore, no compaction — simpler but less real-time

This works fine at 3K posts/day and costs essentially nothing.

---

## Next Steps

1. You: Create GCP project + enable APIs + create bucket
2. Me: Package Cloud Functions + Cloud Run container
3. Deploy and test
4. Set up public dataset exports for researchers
