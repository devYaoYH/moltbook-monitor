# Dual-Write Strategy for Moltbook Monitor

**Question:** Can I run the tracker on multiple instances without conflicts?

**Answer:** Yes! The tracker is designed for **incremental, idempotent syncs**.

## How It Works

### 1. Database Structure

The tracker uses SQLite with `INSERT OR REPLACE`:

```sql
INSERT OR REPLACE INTO posts (id, title, author, ...)
VALUES (?, ?, ?, ...)
```

**Key points:**
- Post ID is the primary key (unique constraint)
- If post exists → UPDATE
- If post doesn't exist → INSERT
- **No conflicts** - just deduplication

### 2. Migration Scenarios

#### Scenario A: Fresh Start (No Database)

Start tracker on new instance **without copying the database**:

```bash
# New instance
cd ~/moltbook-monitor/tracker
python3 tracker.py sync
```

**What happens:**
- Creates fresh `moltbook.db`
- Fetches latest posts from API (hot/new/rising/top ~200 posts)
- Starts building history incrementally

**Limitation:** You only get recent posts (last ~200), not full 810K history

**Use case:** Testing, development, or if you only care about new content

---

#### Scenario B: Full History Migration (Copy Database)

Copy existing database to new instance:

```bash
# Old instance
cd ~/moltbook-monitor/tracker
gzip moltbook.db  # Compress: 1GB → ~200MB

# Transfer
scp moltbook.db.gz new-instance:~/moltbook-monitor/tracker/
ssh new-instance "cd ~/moltbook-monitor/tracker && gunzip moltbook.db.gz"

# New instance - continue where you left off
cd ~/moltbook-monitor/tracker
python3 tracker.py sync
```

**What happens:**
- Starts with full 810K+ post history
- Incremental syncs add new posts
- Existing posts are updated (upvotes, comment_count)

**Use case:** Production migration - preserve full historical data

---

#### Scenario C: Dual-Write (Both Instances Running)

Run tracker on **both instances simultaneously**:

**Old instance:**
```bash
*/30 * * * * cd ~/moltbook-monitor/tracker && python3 tracker.py sync
```

**New instance (after copying DB):**
```bash
*/30 * * * * cd ~/moltbook-monitor/tracker && python3 tracker.py sync
```

**What happens:**
- Both instances fetch same posts from API
- `INSERT OR REPLACE` deduplicates automatically
- Both databases converge to same state

**Outcome:** Safe! No conflicts, just redundant fetches.

**Use case:** Blue-green deployment, gradual migration, backup redundancy

---

## Database Path Configuration

The tracker now supports flexible paths:

**Default:** Uses `~/moltbook-monitor/tracker/moltbook.db` (relative to script)

**Override with environment variable:**
```bash
export MOLTBOOK_DB="/custom/path/moltbook.db"
python3 tracker.py sync
```

**Legacy compatibility:**
The old hardcoded path `~/moltbook-tracker/moltbook.db` is no longer used.

---

## BigQuery Export

BigQuery export also works incrementally:

```bash
# Full export (first time)
python3 export_to_bigquery.py full

# Incremental (only new/updated rows)
python3 export_to_bigquery.py incremental
```

**State tracking:** `bigquery_state.json` tracks last export timestamp

**Dual-write safety:**
- Multiple instances can export to same BigQuery table
- BigQuery uses post ID as primary key
- Last-write-wins (safe because posts are immutable after creation)

---

## Recommended Migration Strategy

**For production with full history:**

1. **On old instance:**
   ```bash
   cd ~/moltbook-monitor/tracker
   python3 tracker.py sync  # Final sync
   gzip moltbook.db
   ```

2. **Transfer:**
   ```bash
   scp ~/moltbook-monitor/tracker/moltbook.db.gz new-instance:~/
   ```

3. **On new instance:**
   ```bash
   cd ~/moltbook-monitor/tracker
   gunzip ~/moltbook.db.gz && mv ~/moltbook.db ./
   python3 tracker.py sync  # Verify it works
   ```

4. **Setup cron on new instance:**
   ```bash
   */30 * * * * cd ~/moltbook-monitor/tracker && python3 tracker.py sync
   ```

5. **Disable old instance cron** (or keep both running if you want redundancy!)

**Total downtime:** ~0 minutes (overlap is safe!)

---

## Storage Notes

**Database size:** ~1GB uncompressed, ~200MB gzipped

**Growth rate:** ~10-15MB/day (30K posts/day * ~500 bytes/post)

**Retention:** No auto-cleanup - historical data preserved forever

**BigQuery:** Separate from SQLite, can be rebuilt from SQLite anytime

---

## FAQ

**Q: What if both instances sync at the exact same time?**  
A: Safe! API returns same posts, `INSERT OR REPLACE` deduplicates.

**Q: Do I lose data if I start fresh without copying the DB?**  
A: You only lose historical posts (810K archive). New posts sync normally.

**Q: Can I run tracker + BigQuery export on different schedules?**  
A: Yes! Tracker can run every 30min, BigQuery export can run daily.

**Q: What happens if API is down during a sync?**  
A: Sync fails gracefully, next cron retry in 30 minutes.

**Q: How do I verify the database migrated correctly?**  
A:
```bash
sqlite3 ~/moltbook-monitor/tracker/moltbook.db \
  "SELECT COUNT(*) as posts, COUNT(DISTINCT author) as authors FROM posts;"
```

Expected: ~810K posts, ~80K authors

---

**Summary:** The tracker is designed for safe dual-write. You can copy the DB for full history, or start fresh for new-posts-only. No conflicts either way!
