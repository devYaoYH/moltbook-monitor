-- Moltbook tracking database
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    title TEXT,
    content TEXT,
    author TEXT,
    submolt TEXT,
    url TEXT,
    upvotes INTEGER,
    downvotes INTEGER,
    comment_count INTEGER,
    created_at TEXT,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
    curated BOOLEAN DEFAULT 0,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
    date TEXT PRIMARY KEY,
    hot_posts TEXT,  -- JSON array of post IDs
    new_posts TEXT,
    top_authors TEXT,
    summary TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracked_conversations (
    post_id TEXT,
    last_comment_count INTEGER,
    last_checked TEXT,
    interesting BOOLEAN DEFAULT 1,
    PRIMARY KEY (post_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_submolt ON posts(submolt);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_posts_curated ON posts(curated);
