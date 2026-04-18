const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

const DB_PATH = path.join(
  app.getPath('userData'),
  'nstreams.db'
);

let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate();
    seed();
  }
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#6366f1',
      mal_username TEXT,
      mal_access_token TEXT,
      mal_refresh_token TEXT,
      mal_token_expires INTEGER,
      anilist_user_id INTEGER,
      anilist_access_token TEXT,
      last_mal_sync DATETIME,
      last_anilist_sync DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER,
      mal_id INTEGER,
      anilist_id INTEGER,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      poster_path TEXT,
      backdrop_path TEXT,
      overview TEXT,
      release_year INTEGER,
      rating REAL,
      genres TEXT,
      cast_list TEXT,
      total_seasons INTEGER,
      total_episodes INTEGER,
      status TEXT,
      is_anime INTEGER DEFAULT 0,
      added_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      content_id INTEGER REFERENCES content(id),
      watch_status TEXT DEFAULT 'plan_to_watch',
      current_season INTEGER DEFAULT 1,
      current_episode INTEGER DEFAULT 0,
      total_watched_episodes INTEGER DEFAULT 0,
      user_rating INTEGER,
      notes TEXT,
      start_date DATE,
      finish_date DATE,
      source TEXT DEFAULT 'manual',
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, content_id)
    );

    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      logo_url TEXT,
      description TEXT,
      is_free INTEGER DEFAULT 1,
      requires_vpn INTEGER DEFAULT 0,
      quality TEXT DEFAULT 'HD',
      added_by INTEGER REFERENCES users(id),
      upvotes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS content_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER REFERENCES content(id),
      site_id INTEGER REFERENCES sites(id),
      direct_url TEXT,
      added_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(content_id, site_id)
    );

    CREATE TABLE IF NOT EXISTS watching_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      content_id INTEGER REFERENCES content(id),
      site_id INTEGER REFERENCES sites(id),
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      episode_before INTEGER,
      season_before INTEGER,
      finished_episode INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS activity_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      content_id INTEGER REFERENCES content(id),
      activity_type TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
    CREATE INDEX IF NOT EXISTS idx_watchlist_content ON watchlist(content_id);
    CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_feed(user_id);
    CREATE INDEX IF NOT EXISTS idx_content_tmdb ON content(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_content_mal ON content(mal_id);
    CREATE INDEX IF NOT EXISTS idx_content_anilist ON content(anilist_id);
  `);
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, display_name, avatar_color)
      VALUES (?, ?, ?)
    `);
    insertUser.run('keshawn', "Ke'Shawn", '#FF69B4');
    insertUser.run('sean', 'Sean', '#2E8B57');
    insertUser.run('amari', 'Amari', '#FFD700');
    insertUser.run('dart', 'Dart', '#722F37');
  }

  const siteCount = db.prepare('SELECT COUNT(*) as c FROM sites').get().c;

  if (siteCount === 0) {
    const insertSite = db.prepare(`
      INSERT INTO sites (name, url, category, is_free, quality, logo_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const sites = [
      ['Netflix', 'https://netflix.com', 'streaming', 0, '4K'],
      ['Hulu', 'https://hulu.com', 'streaming', 0, 'HD'],
      ['Disney+', 'https://disneyplus.com', 'streaming', 0, '4K'],
      ['Max', 'https://max.com', 'streaming', 0, '4K'],
      ['Prime Video', 'https://primevideo.com', 'streaming', 0, '4K'],
      ['Crunchyroll', 'https://crunchyroll.com', 'anime', 0, 'HD'],
      ['Peacock', 'https://peacocktv.com', 'streaming', 0, 'HD'],
      ['Paramount+', 'https://paramountplus.com', 'streaming', 0, 'HD'],
      ['YouTube', 'https://youtube.com', 'general', 1, 'HD'],
      ['Tubi', 'https://tubitv.com', 'streaming', 1, 'HD'],
      ['Pluto TV', 'https://pluto.tv', 'streaming', 1, 'HD']
    ];
    sites.forEach(([name, url, cat, isFree, quality]) => {
      const domain = url.replace(/https?:\/\//, '').split('/')[0];
      const logo = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
      insertSite.run(name, url, cat, isFree, quality, logo);
    });
  }
}

module.exports = { getDB };
