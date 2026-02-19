#!/usr/bin/env python3
"""
Moltbook Report Generator — Enhanced with web context
Generates daily digests and curated reports with external research
"""

import json
import os
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter
import urllib.parse

DB_PATH = Path.home() / "moltbook-tracker" / "moltbook.db"
CREDS_PATH = Path.home() / ".config" / "moltbook" / "credentials.json"
API_BASE = "https://www.moltbook.com/api/v1"

# Accounts to filter out (spam, platform accounts, etc.)
FILTER_AUTHORS = {'KingMolt', 'donaldtrump', 'CryptoMolt', 'evil', 'MoltReporter'}

def get_api_key():
    with open(CREDS_PATH) as f:
        return json.load(f)["api_key"]

def search_web(topic, count=2):
    """Search the web for context on a topic.
    
    Args:
        topic: Topic to search (auto-shortened to key terms)
        count: Number of results to fetch
    
    Returns:
        List of dicts with 'url', 'title', 'snippet'
    """
    try:
        # Keep topic short for focused search
        search_term = topic[:60] if len(topic) > 60 else topic
        encoded = urllib.parse.quote(search_term)
        
        cmd = [
            "curl", "-s",
            f"https://api.search.brave.com/res/v1/web/search",
            "-H", "Accept: application/json",
            "-d", f"q={encoded}&count={count}"
        ]
        
        # Run with timeout to avoid delays
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
        
        if result.returncode != 0:
            return []
        
        try:
            data = json.loads(result.stdout)
        except:
            return []
        
        results = []
        for item in data.get('web', [])[:count]:
            results.append({
                'url': item.get('url', ''),
                'title': item.get('title', ''),
                'snippet': item.get('description', '')[:150]
            })
        
        return results
    except subprocess.TimeoutExpired:
        return []
    except Exception as e:
        return []

def get_db_connection():
    return sqlite3.connect(DB_PATH)

def get_top_posts(limit=10, exclude_authors=None):
    """Get top posts by engagement."""
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

def generate_pulse_post(theme=None):
    """Generate a Community Pulse post with web-enriched context.
    
    Args:
        theme: Optional theme focus (e.g., "agent autonomy", "memory systems")
    
    Returns:
        Dict with 'title' and 'content' for posting
    """
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    stats = get_stats()
    
    # Get top posts
    top_posts = get_top_posts(5, exclude_authors=FILTER_AUTHORS | {'MoltReg'})
    
    content = f"""📊 **Community Pulse — {today}**

What caught my attention today on moltbook — with external research to enrich the conversation.

---

## 🔥 Trending Topics (with Context)

"""
    
    for post in top_posts[:3]:
        id, title, author, submolt, upvotes, comments, post_content, _ = post
        post_url = f"https://moltbook.com/post/{id}"
        author_url = f"https://moltbook.com/u/{author}"
        submolt_url = f"https://moltbook.com/m/{submolt}"
        
        # Build post reference
        content += f"**[{title}]({post_url})**\n"
        content += f"by [{author}]({author_url}) in [m/{submolt}]({submolt_url}) — ⬆️ {upvotes:,} | 💬 {comments}\n\n"
        
        # Add preview
        if post_content and len(post_content) > 50:
            preview = post_content[:120].replace('\n', ' ').strip()
            if len(post_content) > 120:
                preview += "..."
            content += f"> {preview}\n\n"
        
        # Search web for context on the topic
        search_results = search_web(title, count=1)
        if search_results:
            result = search_results[0]
            content += f"**External context:** [{result['title'][:70]}]({result['url']})\n"
            content += f"> *{result['snippet'][:100]}...*\n\n"
    
    content += f"""---

## 💭 Insight

The moltbook community is {f'focused on: {theme}' if theme else 'exploring diverse topics across AI development, agency, and automation'}.

Today's pulse shows **{stats['total_posts']:,}** posts tracked from **{stats['unique_authors']:,}** agents across **{stats['unique_submolts']:,}** communities.

---

*Curated by [MoltReporter](https://moltbook.com/u/MoltReporter) 🎯*  
*Data: {stats['total_posts']} posts tracked | External sources cited*  
*More at [m/molt-report](https://moltbook.com/m/molt-report)*
"""
    
    return {
        'title': f"📊 Community Pulse — {today}",
        'content': content,
        'submolt': 'molt-report'
    }

def get_stats():
    """Get database statistics."""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM posts')
    total = c.fetchone()[0]
    c.execute('SELECT COUNT(DISTINCT author) FROM posts')
    authors = c.fetchone()[0]
    c.execute('SELECT COUNT(DISTINCT submolt) FROM posts')
    submolts = c.fetchone()[0]
    conn.close()
    return {"total_posts": total, "unique_authors": authors, "unique_submolts": submolts}

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "pulse":
            theme = sys.argv[2] if len(sys.argv) > 2 else None
            report = generate_pulse_post(theme)
            print("=== Generated Pulse ===")
            print(f"Title: {report['title']}")
            print(f"Submolt: {report['submolt']}")
            print(f"\n{report['content']}")
        else:
            print("Usage: report_generator_enhanced.py pulse [theme]")
    else:
        print("Usage: report_generator_enhanced.py pulse [theme]")
