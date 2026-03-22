#!/usr/bin/env python3
"""
Moltbook BigQuery Export Pipeline

Converts SQLite database to Parquet and loads into BigQuery.
Supports both full exports and incremental updates.

Usage:
    ./export_to_bigquery.py full      # Full table replace
    ./export_to_bigquery.py incremental  # Only new/updated rows (default)
    ./export_to_bigquery.py schema    # Just create/update schema, no data
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# Configuration
DB_PATH = Path.home() / "moltbook-tracker" / "moltbook.db"
PARQUET_PATH = Path.home() / "moltbook-tracker" / "exports"
GCS_BUCKET = "moltbook-monitoring-db"
GCS_PARQUET_PATH = "exports/parquet"
BQ_PROJECT = "the-molt-report"
BQ_DATASET = "moltbook"
BQ_TABLE = "posts"
STATE_FILE = Path.home() / "moltbook-tracker" / "bigquery_state.json"

# Schema is auto-detected from Parquet file


def get_state():
    """Load export state (last successful export timestamp)."""
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"last_export": None, "last_fetched_at": None}


def save_state(state):
    """Save export state."""
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def sqlite_to_dataframe(incremental=False, since_fetched_at=None):
    """Read posts from SQLite into a pandas DataFrame."""
    conn = sqlite3.connect(DB_PATH)
    
    query = "SELECT * FROM posts"
    if incremental and since_fetched_at:
        query += f" WHERE fetched_at > '{since_fetched_at}'"
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    # Convert timestamp strings to proper datetime
    for col in ["created_at", "fetched_at"]:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce", utc=True)
    
    # Convert curated to boolean
    if "curated" in df.columns:
        df["curated"] = df["curated"].astype(bool)
    
    return df


def dataframe_to_parquet(df, output_path):
    """Write DataFrame to Parquet file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Define Arrow schema for proper types
    arrow_schema = pa.schema([
        ("id", pa.string()),
        ("title", pa.string()),
        ("content", pa.string()),
        ("author", pa.string()),
        ("submolt", pa.string()),
        ("url", pa.string()),
        ("upvotes", pa.int64()),
        ("downvotes", pa.int64()),
        ("comment_count", pa.int64()),
        ("created_at", pa.timestamp("us", tz="UTC")),
        ("fetched_at", pa.timestamp("us", tz="UTC")),
        ("curated", pa.bool_()),
        ("notes", pa.string()),
    ])
    
    table = pa.Table.from_pandas(df, schema=arrow_schema, preserve_index=False)
    pq.write_table(table, output_path, compression="snappy")
    
    return output_path


def upload_to_gcs(local_path, gcs_path):
    """Upload file to GCS using gsutil."""
    import subprocess
    
    full_gcs_path = f"gs://{GCS_BUCKET}/{gcs_path}"
    result = subprocess.run(
        ["gsutil", "-q", "cp", str(local_path), full_gcs_path],
        capture_output=True,
        text=True
    )
    
    if result.returncode != 0:
        raise Exception(f"GCS upload failed: {result.stderr}")
    
    return full_gcs_path


def ensure_dataset_exists():
    """Create BigQuery dataset if it doesn't exist using bq CLI."""
    import subprocess
    
    # Check if dataset exists
    result = subprocess.run(
        ["bq", "show", f"{BQ_PROJECT}:{BQ_DATASET}"],
        capture_output=True, text=True
    )
    
    if result.returncode == 0:
        print(f"Dataset {BQ_DATASET} exists")
        return
    
    # Create dataset
    result = subprocess.run(
        ["bq", "mk", "--dataset", f"{BQ_PROJECT}:{BQ_DATASET}"],
        capture_output=True, text=True
    )
    
    if result.returncode == 0:
        print(f"Created dataset {BQ_DATASET}")
    else:
        raise Exception(f"Failed to create dataset: {result.stderr}")


def load_to_bigquery(gcs_uri, mode="full"):
    """Load Parquet from GCS into BigQuery using bq CLI."""
    import subprocess
    
    # Ensure dataset exists
    ensure_dataset_exists()
    
    table_ref = f"{BQ_PROJECT}:{BQ_DATASET}.{BQ_TABLE}"
    
    # Build bq load command
    cmd = [
        "bq", "load",
        "--source_format=PARQUET",
        f"--replace={'true' if mode == 'full' else 'false'}",
        table_ref,
        gcs_uri
    ]
    
    print(f"Loading {gcs_uri} to {table_ref} (mode={mode})...")
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        raise Exception(f"BigQuery load failed: {result.stderr}")
    
    # Get row count
    count_result = subprocess.run(
        ["bq", "query", "--nouse_legacy_sql", "--format=csv",
         f"SELECT COUNT(*) as cnt FROM `{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}`"],
        capture_output=True, text=True
    )
    
    rows = 0
    if count_result.returncode == 0:
        lines = count_result.stdout.strip().split('\n')
        if len(lines) > 1:
            rows = int(lines[1])
    
    print(f"Loaded to {BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE} ({rows} total rows)")
    
    return rows


def get_max_fetched_at():
    """Get the max fetched_at from the database."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(fetched_at) FROM posts")
    result = cursor.fetchone()[0]
    conn.close()
    return result


def run_full_export():
    """Full export: replace entire BigQuery table."""
    print("Starting full export...")
    
    # Read all data
    df = sqlite_to_dataframe(incremental=False)
    print(f"Read {len(df)} rows from SQLite")
    
    # Convert to Parquet
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    parquet_file = PARQUET_PATH / f"posts_full_{timestamp}.parquet"
    dataframe_to_parquet(df, parquet_file)
    print(f"Wrote Parquet to {parquet_file} ({parquet_file.stat().st_size / 1024 / 1024:.1f} MB)")
    
    # Upload to GCS
    gcs_path = f"{GCS_PARQUET_PATH}/posts_full_{timestamp}.parquet"
    gcs_uri = upload_to_gcs(parquet_file, gcs_path)
    print(f"Uploaded to {gcs_uri}")
    
    # Load to BigQuery
    rows = load_to_bigquery(gcs_uri, mode="full")
    
    # Update state
    save_state({
        "last_export": datetime.now(timezone.utc).isoformat(),
        "last_fetched_at": get_max_fetched_at(),
        "mode": "full",
        "rows": rows
    })
    
    print(f"✅ Full export complete: {rows} rows")
    return rows


def run_incremental_export():
    """Incremental export: only new rows since last export."""
    state = get_state()
    
    if not state.get("last_fetched_at"):
        print("No previous export found, running full export instead...")
        return run_full_export()
    
    print(f"Starting incremental export (since {state['last_fetched_at']})...")
    
    # Read only new data
    df = sqlite_to_dataframe(incremental=True, since_fetched_at=state["last_fetched_at"])
    
    if len(df) == 0:
        print("No new rows to export")
        return 0
    
    print(f"Found {len(df)} new rows")
    
    # Convert to Parquet
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    parquet_file = PARQUET_PATH / f"posts_incr_{timestamp}.parquet"
    dataframe_to_parquet(df, parquet_file)
    print(f"Wrote Parquet to {parquet_file}")
    
    # Upload to GCS
    gcs_path = f"{GCS_PARQUET_PATH}/posts_incr_{timestamp}.parquet"
    gcs_uri = upload_to_gcs(parquet_file, gcs_path)
    print(f"Uploaded to {gcs_uri}")
    
    # Load to BigQuery (append mode)
    rows = load_to_bigquery(gcs_uri, mode="incremental")
    
    # Update state
    save_state({
        "last_export": datetime.now(timezone.utc).isoformat(),
        "last_fetched_at": get_max_fetched_at(),
        "mode": "incremental",
        "rows": rows
    })
    
    print(f"✅ Incremental export complete: {rows} new rows")
    return rows


def run_schema_only():
    """Just create the dataset, table will be created on first load."""
    import subprocess
    
    ensure_dataset_exists()
    
    table_ref = f"{BQ_PROJECT}:{BQ_DATASET}.{BQ_TABLE}"
    
    # Check if table exists
    result = subprocess.run(
        ["bq", "show", table_ref],
        capture_output=True, text=True
    )
    
    if result.returncode == 0:
        print(f"Table {table_ref} already exists")
    else:
        print(f"Table {table_ref} will be created on first data load")


def cleanup_old_exports(keep_days=7):
    """Remove local parquet files older than keep_days."""
    import time
    
    cutoff = time.time() - (keep_days * 86400)
    
    if not PARQUET_PATH.exists():
        return
    
    for f in PARQUET_PATH.glob("*.parquet"):
        if f.stat().st_mtime < cutoff:
            print(f"Removing old export: {f.name}")
            f.unlink()


def main():
    parser = argparse.ArgumentParser(description="Export Moltbook SQLite to BigQuery")
    parser.add_argument(
        "mode",
        nargs="?",
        default="incremental",
        choices=["full", "incremental", "schema", "cleanup"],
        help="Export mode (default: incremental)"
    )
    parser.add_argument(
        "--keep-days",
        type=int,
        default=7,
        help="Days to keep old parquet files (for cleanup)"
    )
    
    args = parser.parse_args()
    
    if args.mode == "full":
        run_full_export()
        cleanup_old_exports(args.keep_days)
    elif args.mode == "incremental":
        run_incremental_export()
        cleanup_old_exports(args.keep_days)
    elif args.mode == "schema":
        run_schema_only()
    elif args.mode == "cleanup":
        cleanup_old_exports(args.keep_days)


if __name__ == "__main__":
    main()
