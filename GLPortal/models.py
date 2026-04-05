from werkzeug.security import generate_password_hash, check_password_hash
from database import get_connection


def create_user(full_name, email, password, role):
    password_hash = generate_password_hash(password)
    sql = """
    INSERT INTO users (full_name, email, password_hash, role)
    VALUES (?, ?, ?, ?)
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (full_name, email, password_hash, role))
    conn.commit()
    user_id = cur.lastrowid
    conn.close()
    return user_id


def get_user_by_email(email):
    sql = "SELECT * FROM users WHERE email = ?"
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (email,))
    user = cur.fetchone()
    conn.close()
    return user


def get_user_by_id(user_id):
    sql = "SELECT * FROM users WHERE user_id = ?"
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (user_id,))
    user = cur.fetchone()
    conn.close()
    return user


def verify_user(email, password):
    user = get_user_by_email(email)
    if user and check_password_hash(user["password_hash"], password):
        return user
    return None


def link_parent_child(parent_id, child_id):
    sql = """
    INSERT INTO child_links (parent_id, child_id)
    VALUES (?, ?)
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (parent_id, child_id))
    conn.commit()
    conn.close()


def add_social_account(child_id, platform, username):
    sql = """
    INSERT INTO social_accounts (child_id, platform, username)
    VALUES (?, ?, ?)
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (child_id, platform, username))
    conn.commit()
    conn.close()


def add_incident(child_id, platform, sender_handle, incident_type, message_text, severity):
    sql = """
    INSERT INTO incidents (child_id, platform, sender_handle, incident_type, message_text, severity)
    VALUES (?, ?, ?, ?, ?, ?)
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (child_id, platform, sender_handle, incident_type, message_text, severity))
    conn.commit()
    incident_id = cur.lastrowid
    conn.close()
    return incident_id


def add_evidence(incident_id, file_path, file_hash, media_type):
    sql = """
    INSERT INTO evidence (incident_id, file_path, file_hash, media_type)
    VALUES (?, ?, ?, ?)
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (incident_id, file_path, file_hash, media_type))
    conn.commit()
    conn.close()


def get_parent_children(parent_id):
    sql = """
    SELECT u.user_id, u.full_name, u.email
    FROM child_links cl
    JOIN users u ON u.user_id = cl.child_id
    WHERE cl.parent_id = ?
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (parent_id,))
    rows = cur.fetchall()
    conn.close()
    return rows


def get_child_incidents(child_id):
    sql = """
    SELECT * FROM incidents
    WHERE child_id = ?
    ORDER BY created_at DESC
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (child_id,))
    rows = cur.fetchall()
    conn.close()
    return rows


def get_child_accounts(child_id):
    sql = """
    SELECT * FROM social_accounts
    WHERE child_id = ?
    ORDER BY created_at DESC
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (child_id,))
    rows = cur.fetchall()
    conn.close()
    return rows


def get_incident_evidence(incident_id):
    sql = """
    SELECT * FROM evidence
    WHERE incident_id = ?
    ORDER BY created_at DESC
    """
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (incident_id,))
    rows = cur.fetchall()
    conn.close()
    return rows


def update_incident_status(incident_id, status):
    sql = "UPDATE incidents SET status = ? WHERE incident_id = ?"
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql, (status, incident_id))
    conn.commit()
    conn.close()


def delete_user(user_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        DELETE FROM evidence
        WHERE incident_id IN (
            SELECT incident_id FROM incidents WHERE child_id = ?
        )
    """, (user_id,))
    cur.execute("DELETE FROM incidents WHERE child_id = ?", (user_id,))
    cur.execute("DELETE FROM social_accounts WHERE child_id = ?", (user_id,))
    cur.execute("DELETE FROM child_links WHERE parent_id = ? OR child_id = ?", (user_id, user_id))
    cur.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()


def delete_all_for_parent(parent_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT child_id FROM child_links WHERE parent_id = ?", (parent_id,))
    child_ids = [r["child_id"] for r in cur.fetchall()]

    for child_id in child_ids:
        cur.execute("DELETE FROM evidence WHERE incident_id IN (SELECT incident_id FROM incidents WHERE child_id = ?)", (child_id,))
        cur.execute("DELETE FROM incidents WHERE child_id = ?", (child_id,))
        cur.execute("DELETE FROM social_accounts WHERE child_id = ?", (child_id,))
        cur.execute("DELETE FROM users WHERE user_id = ?", (child_id,))

    cur.execute("DELETE FROM child_links WHERE parent_id = ?", (parent_id,))
    cur.execute("DELETE FROM users WHERE user_id = ?", (parent_id,))
    conn.commit()
    conn.close()


def insert_dummy_data(child_id):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO social_accounts (child_id, platform, username)
        VALUES (?, ?, ?)
    """, (child_id, "Instagram", "test_user123"))

    cur.execute("""
        INSERT INTO incidents (child_id, platform, sender_handle, incident_type, message_text, severity)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (child_id, "Instagram", "bad_actor99", "blackmail",
          "Send money or I will leak your photo.", 5))

    incident_id = cur.lastrowid

    cur.execute("""
        INSERT INTO evidence (incident_id, file_path, file_hash, media_type)
        VALUES (?, ?, ?, ?)
    """, (incident_id, "sample_screenshot.png", "dummyhash123", "image/png"))

    conn.commit()
    conn.close()