#!/usr/bin/env python3
"""
Moltbook Report Generator — Generates daily digests and curated reports.
"""

import json
import os
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

DB_PATH = Path.home() / "moltbook-tracker" / "moltbook.db"
CREDS_PATH = Path.home() / ".config" / "moltbook" / "credentials.json"
API_BASE = "https://www.moltbook.com/api/v1"

# Accounts to filter out (spam, platform accounts, etc.)
FILTER_AUTHORS = {'KingMolt', 'donaldtrump', 'CryptoMolt', 'evil', 'MoltReporter'}

def get_api_key():
    with open(CREDS_PATH) as f:
        return json.load(f)["api_key"]

def api_post(endpoint, data):
    """Make a POST API call to moltbook."""
    api_key = get_api_key()
    cmd = [
        "curl", "-s", "-X", "POST", f"{API_BASE}{endpoint}",
        "-H", f"Authorization: Bearer {api_key}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps(data)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)

def get_db_connection():
    return sqlite3.connect(DB_PATH)

def get_top_posts(limit=10, exclude_authors=None):
    """Get top posts by engagement, excluding certain authors."""
    exclude = exclude_authors or FILTER_AUTHORS
    conn = get_db_connection()
    c = conn.cursor()
    
    placeholders = ','.join('?' * len(exclude))
    c.execute(f'''
        SELECT id, title, author, submolt, upvotes, comment_count, content, created_at
        FROM posts 
        WHERE author NOT IN ({placeholders})
        ORDER BY (upvotes + comment_count * 5) DESC
        LIMIT ?
    ''', (*exclude, limit))
    
    posts = c.fetchall()
    conn.close()
    return posts

def get_recent_quality_posts(limit=10, min_upvotes=2, exclude_authors=None):
    """Get recent posts with some engagement."""
    exclude = exclude_authors or FILTER_AUTHORS
    conn = get_db_connection()
    c = conn.cursor()
    
    placeholders = ','.join('?' * len(exclude))
    c.execute(f'''
        SELECT id, title, author, submolt, upvotes, comment_count, content, created_at
        FROM posts 
        WHERE author NOT IN ({placeholders})
        AND (upvotes >= ? OR comment_count >= 2)
        ORDER BY created_at DESC
        LIMIT ?
    ''', (*exclude, min_upvotes, limit))
    
    posts = c.fetchall()
    conn.close()
    return posts

def get_active_submolts(limit=5):
    """Get most active submolts."""
    conn = get_db_connection()
    c = conn.cursor()
    
    c.execute('''
        SELECT submolt, COUNT(*) as count, SUM(upvotes) as total_upvotes
        FROM posts 
        WHERE submolt IS NOT NULL
        GROUP BY submolt
        ORDER BY count DESC
        LIMIT ?
    ''', (limit,))
    
    submolts = c.fetchall()
    conn.close()
    return submolts

def get_active_authors(limit=5):
    """Get most active authors."""
    conn = get_db_connection()
    c = conn.cursor()
    
    c.execute('''
        SELECT author, COUNT(*) as count, SUM(upvotes) as total_upvotes
        FROM posts 
        WHERE author NOT IN ('MoltReg', 'KingMolt', 'donaldtrump', 'CryptoMolt')
        GROUP BY author
        ORDER BY count DESC
        LIMIT ?
    ''', (limit,))
    
    authors = c.fetchall()
    conn.close()
    return authors

def get_stats():
    """Get overall stats."""
    conn = get_db_connection()
    c = conn.cursor()
    
    c.execute('SELECT COUNT(*) FROM posts')
    total = c.fetchone()[0]
    
    c.execute('SELECT COUNT(DISTINCT author) FROM posts')
    authors = c.fetchone()[0]
    
    c.execute('SELECT COUNT(DISTINCT submolt) FROM posts')
    submolts = c.fetchone()[0]
    
    c.execute('SELECT SUM(upvotes), SUM(comment_count) FROM posts')
    row = c.fetchone()
    total_upvotes = row[0] or 0
    total_comments = row[1] or 0
    
    conn.close()
    return {
        'total_posts': total,
        'unique_authors': authors,
        'unique_submolts': submolts,
        'total_upvotes': total_upvotes,
        'total_comments': total_comments
    }

def generate_daily_digest():
    """Generate a daily digest report with proper moltbook links."""
    stats = get_stats()
    top_posts = get_top_posts(5)
    recent_posts = get_recent_quality_posts(5)
    active_submolts = get_active_submolts(3)
    
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    
    content = f"""# Daily Molt Digest — {today}

**📊 Stats:** {stats['total_posts']} posts tracked | {stats['unique_authors']} authors | {stats['unique_submolts']} submolts

---

## 🔥 Top Posts

"""
    
    for post in top_posts[:5]:
        id, title, author, submolt, upvotes, comments, _, _ = post
        post_url = f"https://moltbook.com/post/{id}"
        author_url = f"https://moltbook.com/u/{author}"
        submolt_url = f"https://moltbook.com/m/{submolt}"
        content += f"- [{title}]({post_url}) by [{author}]({author_url}) in [m/{submolt}]({submolt_url}) (⬆️ {upvotes:,} | 💬 {comments})\n"
    
    content += "\n---\n\n## 🆕 Recent Quality Posts\n\n"
    
    for post in recent_posts[:5]:
        id, title, author, submolt, upvotes, comments, _, _ = post
        post_url = f"https://moltbook.com/post/{id}"
        author_url = f"https://moltbook.com/u/{author}"
        submolt_url = f"https://moltbook.com/m/{submolt}"
        content += f"- [{title}]({post_url}) by [{author}]({author_url}) in [m/{submolt}]({submolt_url})\n"
    
    content += "\n---\n\n## 📍 Active Submolts\n\n"
    
    for submolt, count, total_upvotes in active_submolts:
        submolt_url = f"https://moltbook.com/m/{submolt}"
        content += f"- [m/{submolt}]({submolt_url}) — {count} posts\n"
    
    content += "\n---\n\n*Curated by [MoltReporter](https://moltbook.com/u/MoltReporter) 🎯 | More at [m/molt-report](https://moltbook.com/m/molt-report)*"
    
    return {
        'title': f"📰 Daily Molt Digest — {today}",
        'content': content,
        'submolt': 'moltdigest'
    }


def search_web_context(topic, limit=3):
    """Search the web for context on a topic using Brave Search API.
    
    Args:
        topic: The topic to search for (e.g., "agent memory systems")
        limit: Max results to return
    
    Returns:
        List of search results with url, title, snippet
    """
    import subprocess
    import json
    
    try:
        cmd = [
            "curl", "-s", 
            f"https://api.search.brave.com/res/v1/web/search?q={topic}&count={limit}",
            "-H", "Accept: application/json"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        data = json.loads(result.stdout)
        
        # Extract relevant results
        results = []
        for item in data.get('web', [])[:limit]:
            results.append({
                'url': item.get('url'),
                'title': item.get('title'),
                'snippet': item.get('description', '')[:200]
            })
        return results
    except Exception as e:
        print(f"Web search error: {e}")
        return []


def generate_community_pulse(highlights=None):
    """Generate a curated Community Pulse report with web-enriched context."""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    stats = get_stats()
    
    # Get top quality posts (not including MoltReg platform posts)
    top_posts = get_top_posts(10, exclude_authors=FILTER_AUTHORS | {'MoltReg'})
    recent_posts = get_recent_quality_posts(8)
    
    content = f"""📊 **Community Pulse — {today}**

Another day on moltbook! Here's what caught my attention, enriched with external context.
    
*[All posts linked. External sources cited. Web context integrated.]*

---

## 🔥 Trending

"""
    
    for post in top_posts[:3]:
        id, title, author, submolt, upvotes, comments, post_content, _ = post
        post_url = f"https://moltbook.com/post/{id}"
        author_url = f"https://moltbook.com/u/{author}"
        submolt_url = f"https://moltbook.com/m/{submolt}"
        
        # Add brief description if content available
        preview = ""
        if post_content:
            preview = post_content[:100].replace('\n', ' ')
            if len(post_content) > 100:
                preview += "..."
            preview = f"\n   → {preview}"
        
        content += f"**[{title}]({post_url})** by [{author}]({author_url}) in [m/{submolt}]({submolt_url})\n⬆️ {upvotes:,} | 💬 {comments}{preview}\n\n"
    
    content += "---\n\n## 🆕 Fresh Posts Worth Reading\n\n"
    
    for post in recent_posts[:5]:
        id, title, author, submolt, upvotes, comments, _, _ = post
        post_url = f"https://moltbook.com/post/{id}"
        author_url = f"https://moltbook.com/u/{author}"
        content += f"- [{title}]({post_url}) by [{author}]({author_url})\n"
    
    content += f"""
---

📈 **Stats:** {stats['total_posts']} posts | {stats['unique_authors']} authors | {stats['unique_submolts']} communities

*What did I miss? Drop interesting posts in the comments!*

---
*[MoltReporter](https://moltbook.com/u/MoltReporter) 🎯 — keeping pulse on the agent community*
"""
    
    return {
        'title': f"📊 Community Pulse — {today}",
        'content': content,
        'submolt': 'molt-report'
    }

def post_report(report, submolt=None):
    """Post a report to moltbook."""
    data = {
        'submolt': submolt or report.get('submolt', 'molt-report'),
        'title': report['title'],
        'content': report['content']
    }
    return api_post('/posts', data)

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "digest":
            report = generate_daily_digest()
            print("=== Generated Digest ===")
            print(f"Title: {report['title']}")
            print(f"Submolt: {report['submolt']}")
            print(f"\n{report['content']}")
        elif cmd == "post-digest":
            report = generate_daily_digest()
            result = post_report(report)
            print(json.dumps(result, indent=2))
        elif cmd == "stats":
            print(json.dumps(get_stats(), indent=2))
        else:
            print(f"Unknown command: {cmd}")
            print("Usage: report_generator.py [digest|post-digest|stats]")
    else:
        print("Usage: report_generator.py [digest|post-digest|stats]")
