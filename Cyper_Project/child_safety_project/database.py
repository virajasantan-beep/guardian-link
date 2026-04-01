import sqlite3

DB_NAME = "child_safety.db"

def get_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

CREATE_USERS = """
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('parent','child')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""

CREATE_CHILD_LINKS = """
CREATE TABLE IF NOT EXISTS child_links (
    link_id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER NOT NULL,
    child_id INTEGER NOT NULL,
    relation_status TEXT DEFAULT 'linked',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (child_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(parent_id, child_id)
);
"""

CREATE_ACCOUNTS = """
CREATE TABLE IF NOT EXISTS social_accounts (
    account_id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (child_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(child_id, platform, username)
);
"""

CREATE_INCIDENTS = """
CREATE TABLE IF NOT EXISTS incidents (
    incident_id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    sender_handle TEXT,
    incident_type TEXT NOT NULL,
    message_text TEXT,
    severity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (child_id) REFERENCES users(user_id) ON DELETE CASCADE
);
"""

CREATE_EVIDENCE = """
CREATE TABLE IF NOT EXISTS evidence (
    evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_hash TEXT,
    media_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (incident_id) REFERENCES incidents(incident_id) ON DELETE CASCADE
);
"""

def create_tables():
    conn = get_connection()
    cur = conn.cursor()
    for sql in [CREATE_USERS, CREATE_CHILD_LINKS, CREATE_ACCOUNTS, CREATE_INCIDENTS, CREATE_EVIDENCE]:
        cur.execute(sql)
    conn.commit()
    conn.close()