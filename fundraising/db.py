import os
import sqlite3
from pathlib import Path

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS organizations (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
 currency TEXT NOT NULL CHECK(length(currency) = 3), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
 organization_id INTEGER NOT NULL REFERENCES organizations(id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('owner','admin','fundraiser','accountant','viewer')),
 PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE IF NOT EXISTS donors (
 id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 name TEXT NOT NULL CHECK(length(trim(name)) > 0), email TEXT NOT NULL DEFAULT '',
 UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS campaigns (
 id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 name TEXT NOT NULL CHECK(length(trim(name)) > 0), UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS pledges (
 id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 donor_id INTEGER NOT NULL, campaign_id INTEGER NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), due_date TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(organization_id,donor_id) REFERENCES donors(organization_id,id),
 FOREIGN KEY(organization_id,campaign_id) REFERENCES campaigns(organization_id,id)
);
CREATE TABLE IF NOT EXISTS accounts (
 id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 code TEXT NOT NULL, name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('asset','liability','equity','income','expense')),
 UNIQUE(organization_id,code), UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS journals (
 id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id),
 description TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,id)
);
CREATE TABLE IF NOT EXISTS journal_lines (
 id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL, journal_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL, debit_minor INTEGER NOT NULL DEFAULT 0 CHECK(debit_minor >= 0),
 credit_minor INTEGER NOT NULL DEFAULT 0 CHECK(credit_minor >= 0),
 CHECK((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
 FOREIGN KEY(organization_id,journal_id) REFERENCES journals(organization_id,id),
 FOREIGN KEY(organization_id,account_id) REFERENCES accounts(organization_id,id)
);
"""


def connect(path=None):
    path = path or os.environ.get('FUNDRAISING_DB', '.local/fundraising.sqlite3')
    if path != ':memory:':
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    return db


def post_journal(db, organization_id, description, lines):
    """Atomically post a balanced journal. Amounts are integer minor units."""
    if len(lines) < 2 or any(type(d) is not int or type(c) is not int or d < 0 or c < 0 or (d > 0) == (c > 0) for _, d, c in lines):
        raise ValueError('Journal requires at least two valid debit/credit lines.')
    if sum(d for _, d, _ in lines) != sum(c for _, _, c in lines):
        raise ValueError('Debits must equal credits.')
    with db:
        journal = db.execute('INSERT INTO journals(organization_id, description) VALUES (?,?)', (organization_id, description)).lastrowid
        db.executemany('INSERT INTO journal_lines(organization_id,journal_id,account_id,debit_minor,credit_minor) VALUES (?,?,?,?,?)', [(organization_id, journal, a, d, c) for a, d, c in lines])
    return journal
