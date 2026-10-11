const path = require('path');
const fs = require('fs');
const os = require('os');

function getDefaultAppDir() {
  const home = os.homedir();
  if (process.platform === 'win32') return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
}

const APPDATA = getDefaultAppDir();
const DB_PATH = process.env.NR_DB || path.join(APPDATA, '9router', 'db', 'data.sqlite');
const RUNTIME = process.env.NR_RUNTIME || path.join(APPDATA, '9router', 'runtime', 'node_modules');

let db;
const stmts = new Map();

function fail(msg) { console.error('error: ' + msg); process.exit(1); }
function now() { return new Date().toISOString(); }

function loadDatabase() {
  try {
    const mod = require('better-sqlite3');
    const ctor = typeof mod === 'function' ? mod : (mod.default || mod.Database);
    if (typeof ctor === 'function') return ctor;
  } catch {}
  const cands = [
    path.join(RUNTIME, 'better-sqlite3'),
    path.join(RUNTIME, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  ];
  for (const c of cands) {
    try {
      const mod = require(c);
      const ctor = typeof mod === 'function' ? mod : (mod.default || mod.Database);
      if (typeof ctor === 'function') return ctor;
    } catch {}
  }
  fail('better-sqlite3 not found. Run "npm install better-sqlite3" or set NR_RUNTIME.');
}

function initDb(dbPath = DB_PATH) {
  if (db) return db;
  if (!fs.existsSync(dbPath)) fail(`DB not found: ${dbPath}`);
  const Database = loadDatabase();
  db = new Database(dbPath, { readonly: false });
  db.pragma('journal_mode = WAL');
  stmts.clear();
  return db;
}

function getDb() {
  if (!db) fail('DB not initialized — call initDb() first');
  return db;
}

function query(sql) {
  let s = stmts.get(sql);
  if (!s) { s = getDb().prepare(sql); stmts.set(sql, s); }
  return s;
}

module.exports = { DB_PATH, RUNTIME, initDb, getDb, query, fail, now, loadDatabase };
