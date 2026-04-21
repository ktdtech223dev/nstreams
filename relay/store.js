// Optional persistence layer for the relay.
// If DATA_DIR is set (or /data exists), opens a SQLite DB there and persists
// party history + chat logs. Otherwise runs in-memory only.

const fs = require('fs');
const path = require('path');

let db = null;

function init() {
  const dir = process.env.DATA_DIR
    || (fs.existsSync('/data') ? '/data' : null);
  if (!dir) {
    console.log('[store] no DATA_DIR set — running in memory only');
    return null;
  }
  // better-sqlite3 is an optionalDependency — may not be installed if
  // the build host can't compile it. Fall back to memory if missing.
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.warn('[store] better-sqlite3 not available — memory only:', e.message);
    return null;
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(path.join(dir, 'relay.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS parties (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE,
        host_id TEXT,
        content TEXT,     -- JSON
        site TEXT,        -- JSON
        created_at INTEGER,
        ended_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS party_members (
        party_id TEXT,
        user_id TEXT,
        name TEXT,
        color TEXT,
        joined_at INTEGER,
        left_at INTEGER,
        PRIMARY KEY (party_id, user_id, joined_at)
      );
      CREATE TABLE IF NOT EXISTS party_messages (
        id TEXT PRIMARY KEY,
        party_id TEXT,
        user_id TEXT,
        name TEXT,
        color TEXT,
        text TEXT,
        ts INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_msg_party ON party_messages(party_id, ts);
      CREATE INDEX IF NOT EXISTS idx_party_code ON parties(code);
    `);
    console.log(`[store] SQLite persistence at ${path.join(dir, 'relay.db')}`);
    return db;
  } catch (e) {
    console.warn('[store] failed to init SQLite — falling back to memory:', e.message);
    db = null;
    return null;
  }
}

function enabled() { return !!db; }

function saveParty(p) {
  if (!db) return;
  db.prepare(`
    INSERT OR REPLACE INTO parties (id, code, host_id, content, site, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    p.id, p.code, p.host_id,
    p.content ? JSON.stringify(p.content) : null,
    p.site ? JSON.stringify(p.site) : null,
    p.created_at
  );
}

function endParty(id) {
  if (!db) return;
  db.prepare('UPDATE parties SET ended_at = ? WHERE id = ?').run(Date.now(), id);
}

function recordMember(partyId, user) {
  if (!db) return;
  db.prepare(`
    INSERT OR IGNORE INTO party_members (party_id, user_id, name, color, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(partyId, user.id, user.name, user.color, user.joined_at);
}

function memberLeft(partyId, userId) {
  if (!db) return;
  db.prepare(`
    UPDATE party_members SET left_at = ?
    WHERE party_id = ? AND user_id = ? AND left_at IS NULL
  `).run(Date.now(), partyId, userId);
}

function recordMessage(partyId, m) {
  if (!db) return;
  db.prepare(`
    INSERT OR REPLACE INTO party_messages (id, party_id, user_id, name, color, text, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(m.id, partyId, m.user_id, m.name, m.color, m.text, m.ts);
}

function loadParty(id) {
  if (!db) return null;
  const row = db.prepare('SELECT * FROM parties WHERE id = ? OR code = ?').get(id, id);
  if (!row) return null;
  const messages = db.prepare(`
    SELECT id, user_id, name, color, text, ts FROM party_messages
    WHERE party_id = ? ORDER BY ts ASC LIMIT 500
  `).all(row.id);
  return {
    id: row.id,
    code: row.code,
    host_id: row.host_id,
    content: row.content ? JSON.parse(row.content) : null,
    site: row.site ? JSON.parse(row.site) : null,
    created_at: row.created_at,
    ended_at: row.ended_at,
    messages
  };
}

function listHistory(limit = 50) {
  if (!db) return [];
  return db.prepare(`
    SELECT p.*, COUNT(m.user_id) as member_count
    FROM parties p LEFT JOIN party_members m ON m.party_id = p.id
    GROUP BY p.id ORDER BY p.created_at DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  init, enabled, saveParty, endParty,
  recordMember, memberLeft, recordMessage,
  loadParty, listHistory
};
