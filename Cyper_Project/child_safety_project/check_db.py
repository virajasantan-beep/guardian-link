import sqlite3

conn = sqlite3.connect("child_safety.db")
cur = conn.cursor()

tables = ["users", "child_links", "social_accounts", "incidents", "evidence"]

for table in tables:
    print(f"\n--- {table} ---")
    cur.execute(f"PRAGMA table_info({table})")
    print(cur.fetchall())

conn.close()