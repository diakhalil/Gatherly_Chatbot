# This db.py file is the database access layer for the SQL agent.
# It handles connecting to MySQL and provides two helper functions to run queries.


from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path

import pymysql
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]    

load_dotenv(REPO_ROOT / ".env")
# It loads database credentials from the project’s .env using load_dotenv(REPO_ROOT / ".env")

def get_connection():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "localhost"),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASS", ""),
        database=os.getenv("DB_NAME", "Gatherly"),
        port=int(os.getenv("DB_PORT", "3306")),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


@contextmanager
def db_cursor():
    # opens a connection
    conn = get_connection()
    # Creates a cursor (cur) and yields it to the caller
    try:
        with conn.cursor() as cur:
            yield cur
    finally:
        conn.close()


def fetch_all(sql: str, params: tuple | list = ()):
    # return all rows
    with db_cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_one(sql: str, params: tuple | list = ()):
    # return one row
    with db_cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()
