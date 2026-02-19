#!/usr/bin/env python3
"""
Moltbook Tracker - Fetch, store, and curate posts from moltbook.
"""

import json
import os
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

DB_PATH = Path.home() / "moltbook-tracker" / "moltbook.db"
CREDS_PATH = Path.home() / ".config" / "moltbook" / "credentials.json"
API_BASE = "https://www.moltbook.com/api/v1"

def get_api_key():
    with open(CREDS_PATH) as f:
        return json.load(f)["api_key"]

def api_call(endpoint, method="GET", data=None):
    """Make an API call to moltbook."""
    api_key = get_api_key()
    cmd = ["curl", "-s", f"{API_BASE}{endpoint}", "-H", f"Authorization: Bearer {api_key}"]
    if method == "POST":
        cmd.extend(["-X", "POST", "-H", "Content-Type: application/json"])
        if data:
            cmd.extend(["-d", json.dumps(data)])
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)

def fetch_posts(sort="hot", limit=50, submolt=None):
    """Fetch posts from moltbook."""
    endpoint = f"/posts?sort={sort}&limit={limit}"
    if submolt:
        endpoint += f"&submolt={submolt}"
    return api_call(endpoint).get("posts", [])

def fetch_new_posts(limit=50):
    """Fetch newest posts."""
    return fetch_posts(sort="new", limit=limit)

def store_posts(posts):
    """Store posts in the database."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    stored = 0
    for post in posts:
        try:
            c.execute('''
                INSERT OR REPLACE INTO posts 
                (id, title, content, author, submolt, url, upvotes, downvotes, comment_count, created_at, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                post["id"],
                post.get("title"),
                post.get("content"),
                post.get("author", {}).get("name"),
                post.get("submolt", {}).get("name"),
                post.get("url"),
                post.get("upvotes", 0),
                post.get("downvotes", 0),
                post.get("comment_count", 0),
                post.get("created_at"),
                datetime.utcnow().isoformat()
            ))
            stored += 1
        except Exception as e:
            print(f"Error storing post {post.get('id')}: {e}")
    conn.commit()
    conn.close()
    return stored

def mark_curated(post_id, notes=None):
    """Mark a post as curated for reporting."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('UPDATE posts SET curated = 1, notes = ? WHERE id = ?', (notes, post_id))
    conn.commit()
    conn.close()

def get_curated_posts(date=None):
    """Get curated posts, optionally filtered by date."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    if date:
        c.execute('SELECT * FROM posts WHERE curated = 1 AND date(created_at) = ?', (date,))
    else:
        c.execute('SELECT * FROM posts WHERE curated = 1')
    posts = c.fetchall()
    conn.close()
    return posts

def get_stats():
    """Get database statistics."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM posts')
    total = c.fetchone()[0]
    c.execute('SELECT COUNT(*) FROM posts WHERE curated = 1')
    curated = c.fetchone()[0]
    c.execute('SELECT COUNT(DISTINCT author) FROM posts')
    authors = c.fetchone()[0]
    c.execute('SELECT COUNT(DISTINCT submolt) FROM posts')
    submolts = c.fetchone()[0]
    conn.close()
    return {"total_posts": total, "curated": curated, "unique_authors": authors, "unique_submolts": submolts}

def fetch_topic(topic: str, limit: int = 50) -> int:
    """Fetch using api for `limit` posts under `topic`."""
    print(f"Fetching {topic} posts...")
    posts = fetch_posts(sort=topic, limit=limit)
    stored_posts = store_posts(posts)
    return stored_posts

def sync():
    """Sync latest posts from moltbook."""
    topics = [
        "hot",
        "new",
        "rising",
        "top",
    ]

    num_total_stored_posts = 0
    for topic in topics:
        num_total_stored_posts += fetch_topic(topic)
    
    stats = get_stats()
    print(f"\n✅ Synced! Stored {num_total_stored_posts} posts")
    print(f"📊 Total: {stats['total_posts']} posts | {stats['curated']} curated | {stats['unique_authors']} authors | {stats['unique_submolts']} submolts")
    return stats

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "sync":
            sync()
        elif cmd == "stats":
            print(json.dumps(get_stats(), indent=2))
        else:
            print(f"Unknown command: {cmd}")
    else:
        sync()
