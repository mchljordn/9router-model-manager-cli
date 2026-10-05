#!/usr/bin/env node
// 9router DB CRUD CLI — manages combos, providers, models in the 9router SQLite DB.
// Zero deps beyond better-sqlite3 (resolved from the 9router runtime install).

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

function getDefaultAppDir() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
}

const APPDATA = getDefaultAppDir();
const DB_PATH = process.env.NR_DB || path.join(APPDATA, '9router', 'db', 'data.sqlite');
const RUNTIME = process.env.NR_RUNTIME || path.join(APPDATA, '9router', 'runtime', 'node_modules');
const API_URL = process.env.NR_API || 'http://localhost:20128';

let db;

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
  fail(`better-sqlite3 not found. Run "npm install better-sqlite3" or set NR_RUNTIME.`);
}

function initDb(dbPath = process.env.NR_DB || DB_PATH) {
  if (db) return db;
  if (!fs.existsSync(dbPath)) {
    fail(`DB not found: ${dbPath}`);
  }
  const Database = loadDatabase();
  db = new Database(dbPath, { readonly: false });
  db.pragma('journal_mode = WAL');
  return db;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fail(msg) { console.error('error: ' + msg); process.exit(1); }
function now() { return new Date().toISOString(); }
function getCombo(name) {
  const row = db.prepare('SELECT id, name, kind, models, createdAt, updatedAt FROM combos WHERE name = ?').get(name);
  if (!row) fail(`combo "${name}" not found`);
  row.models = JSON.parse(row.models);
  return row;
}
function saveCombo(combo, models) {
  const next = [...new Set(models)].sort();
  db.prepare('UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?')
    .run(JSON.stringify(next), now(), combo.id);
  return next;
}
function countByPrefix(models) {
  const m = new Map();
  for (const id of models) {
    const p = id.includes('/') ? id.split('/')[0] : id;
    m.set(p, (m.get(p) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function apiModels() {
  const raw = httpGetSync(API_URL + '/v1/models');
  if (!raw) fail(`no response from API at ${API_URL} — is the 9router server running?`);
  let j;
  try { j = JSON.parse(raw); } catch { fail(`unparseable API response (first 120 chars): ${raw.slice(0, 120)}`); }
  const list = (j.data || j.models || []).map(x => x.id).filter(Boolean);
  if (!list.length) fail('API returned an empty model list');
  return list;
}
function httpGetSync(url) {
  const code = `require("http").get(${JSON.stringify(url)},r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>process.stdout.write(d))}).on("error",()=>process.stdout.write(""))`;
  try {
    return execFileSync(process.execPath, ['-e', code], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 20000 });
  } catch {
    return '';
  }
}
function bold(s) { return '\x1b[1m' + s + '\x1b[0m'; }
function dim(s) { return '\x1b[2m' + s + '\x1b[0m'; }

// ── Commands ───────────────────────────────────────────────────────────────────
function ts(v) {
  if (!v) return '-';
  // app stores ISO strings; our own writes also use ISO
  if (typeof v === 'string' && /^\d{4}-/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}
function tsFull(v) {
  if (!v) return '-';
  if (typeof v === 'string' && /^\d{4}-/.test(v)) return v.slice(0, 19).replace('T', ' ');
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 19).replace('T', ' ');
}
function listCombos() {
  const rows = db.prepare('SELECT name, kind, models, updatedAt FROM combos ORDER BY name').all();
  const w = Math.max(...rows.map(r => r.name.length));
  for (const r of rows) {
    const n = JSON.parse(r.models).length;
    console.log(`${bold(r.name.padEnd(w))}  ${String(n).padStart(4)}  ${dim(r.kind || 'custom')}  ${ts(r.updatedAt)}`);
  }
  console.log(dim(`\n${rows.length} combos`));
}

function showCombo(name) {
  const c = getCombo(name);
  console.log(bold(`${name}`) + dim(`  (${c.kind || 'custom'})  ${c.models.length} models  updated ${tsFull(c.updatedAt)}`));
  for (const [p, n] of countByPrefix(c.models)) {
    console.log(`  ${p.padEnd(14)} ${n}`);
  }
  console.log();
  for (const m of c.models) console.log('  ' + m);
}

function createCombo(name, modelsArg, kind = 'custom') {
  const exists = db.prepare('SELECT id FROM combos WHERE name = ?').get(name);
  if (exists) fail(`combo "${name}" already exists — use add/remove to edit`);
  const models = [...new Set(modelsArg.split(',').map(s => s.trim()).filter(Boolean))];
  const id = 'combo-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + now().toString(36);
  db.prepare('INSERT INTO combos (id, name, kind, models, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run(id, name, kind, JSON.stringify(models.sort()), now(), now());
  console.log(`created ${bold(name)} with ${models.length} models`);
}

function deleteCombo(name) {
  const c = getCombo(name);
  db.prepare('DELETE FROM combos WHERE id = ?').run(c.id);
  console.log(`deleted ${bold(name)} (${c.models.length} models)`);
}

function addModels(name, modelsArg) {
  const c = getCombo(name);
  const add = modelsArg.split(',').map(s => s.trim()).filter(Boolean);
  const before = c.models.length;
  const next = saveCombo(c, [...c.models, ...add]);
  console.log(`${bold(name)}: ${before} -> ${next.length} (+${next.length - before})`);
  if (next.length - before < add.length) console.log(dim(`  ${add.length - (next.length - before)} already present`));
}

function removeModels(name, modelsArg) {
  const c = getCombo(name);
  const rm = modelsArg.split(',').map(s => s.trim()).filter(Boolean);
  const before = c.models.length;
  const next = saveCombo(c, c.models.filter(m => !rm.includes(m)));
  console.log(`${bold(name)}: ${before} -> ${next.length} (-${before - next.length})`);
  const missed = rm.filter(m => c.models.includes(m) === false);
  if (missed.length) console.log(dim(`  not present: ${missed.join(', ')}`));
}

function removePrefix(name, prefix) {
  const c = getCombo(name);
  const before = c.models.length;
  const next = saveCombo(c, c.models.filter(m => !m.startsWith(prefix)));
  console.log(`${bold(name)}: ${before} -> ${next.length} (-${before - next.length} matching "${prefix}")`);
}

function purgeModel(model) {
  const rows = db.prepare('SELECT id, name, models FROM combos').all();
  let hit = 0;
  for (const r of rows) {
    const m = JSON.parse(r.models);
    if (m.includes(model)) {
      saveCombo(r, m.filter(x => x !== model));
      hit++;
    }
  }
  console.log(`purged ${bold(model)} from ${hit} combo(s)`);
}

function searchModels(query) {
  const q = query.toLowerCase();
  const rows = db.prepare('SELECT name, models FROM combos ORDER BY name').all();
  const seen = new Set();
  let total = 0;
  for (const r of rows) {
    const hits = JSON.parse(r.models).filter(m => m.toLowerCase().includes(q));
    for (const m of hits) {
      if (seen.has(m)) continue;
      seen.add(m);
      total++;
    }
  }
  const sorted = [...seen].sort();
  for (const m of sorted) console.log('  ' + m);
  console.log(dim(`\n${total} unique models match "${query}"`));
}

function whereModel(model) {
  const rows = db.prepare('SELECT name, models FROM combos ORDER BY name').all();
  const inCombos = rows.filter(r => JSON.parse(r.models).includes(model)).map(r => r.name);
  if (!inCombos.length) { console.log(dim(`"${model}" is not in any combo`)); return; }
  console.log(`${bold(model)} is in: ${inCombos.join(', ')}`);
}

function listProviders() {
  const nodes = db.prepare('SELECT id, name, data, updatedAt FROM providerNodes ORDER BY name').all();
  const w = Math.max(...nodes.map(n => n.name.length), 8);
  for (const n of nodes) {
    let prefix = '', apiType = '';
    try { const d = JSON.parse(n.data); prefix = d.prefix || ''; apiType = d.apiType || d.type || ''; } catch {}
    console.log(`${bold(n.name.padEnd(w))}  prefix=${(prefix || '-').padEnd(14)} ${dim(apiType)}`);
  }
  console.log(dim(`\n${nodes.length} provider nodes`));
}

function comboStats(name) {
  const c = getCombo(name);
  const api = apiModels();
  const apiSet = new Set(api);
  const dead = c.models.filter(m => !apiSet.has(m));
  const missing = api.filter(m => !c.models.includes(m));
  console.log(bold(`${name}`) + `  ${c.models.length} models`);
  console.log(`  API reports ${api.length} models`);
  if (dead.length) {
    console.log(`  ${bold('not in API')} (${dead.length}):`);
    for (const m of dead.slice(0, 50)) console.log('    ' + m);
    if (dead.length > 50) console.log(dim(`    ... +${dead.length - 50} more`));
  } else {
    console.log(dim('  all models present in live API'));
  }
  console.log(`  ${dim(`in API but not combo: ${missing.length}`)}`);
}

function syncCombo(name) {
  const c = getCombo(name);
  const api = apiModels();
  const apiSet = new Set(api);
  const before = c.models.length;
  // drop dead models, keep order
  const kept = c.models.filter(m => apiSet.has(m));
  const next = saveCombo(c, kept);
  console.log(`${bold(name)}: ${before} -> ${next.length} (-${before - next.length} dead removed)`);
}

function listApiModels(filter) {
  const api = apiModels();
  const f = filter ? filter.toLowerCase() : null;
  const rows = f ? api.filter(m => m.toLowerCase().includes(f)) : api;
  const groups = countByPrefix(rows);
  for (const [p, n] of groups) console.log(`  ${p.padEnd(14)} ${n}`);
  console.log(dim(`\n${rows.length} models${f ? ` matching "${filter}"` : ''} (total ${api.length})`));
}

function exportCombo(name, file) {
  const c = getCombo(name);
  const payload = { name: c.name, kind: c.kind, models: c.models, exportedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`exported ${bold(name)} (${c.models.length} models) -> ${file}`);
}

function importCombo(file, name) {
  if (!fs.existsSync(file)) fail(`file not found: ${file}`);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const target = name || payload.name;
  if (!target) fail('no name given (arg or "name" field in file)');
  const exists = db.prepare('SELECT id FROM combos WHERE name = ?').get(target);
  if (exists) {
    addModels(target, (payload.models || []).join(','));
    console.log(dim(`merged into existing ${target}`));
  } else {
    createCombo(target, (payload.models || []).join(','), payload.kind || 'custom');
  }
}

function dbInfo() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t => t.name);
  const combos = db.prepare('SELECT count(*) n FROM combos').get().n;
  const nodes = db.prepare('SELECT count(*) n FROM providerNodes').get().n;
  const conns = db.prepare('SELECT count(*) n FROM providerConnections').get().n;
  console.log(bold('9router DB') + dim(`  ${DB_PATH}`));
  console.log(`  combos:            ${combos}`);
  console.log(`  provider nodes:    ${nodes}`);
  console.log(`  provider conns:    ${conns}`);
  console.log(`  tables:            ${tables.join(', ')}`);
}

function ping(target, flags) {
  const https = require('https');
  const http = require('http');

  // parse flags
  const direct = flags.includes('--direct');
  const failuresOnly = flags.includes('--failures');
  const limitIdx = flags.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(flags[limitIdx + 1]) : Infinity;
  const timeoutIdx = flags.indexOf('--timeout');
  const timeoutMs = timeoutIdx >= 0 ? parseInt(flags[timeoutIdx + 1]) : 30000;
  const concIdx = flags.indexOf('--concurrency');
  const concurrency = concIdx >= 0 ? parseInt(flags[concIdx + 1]) : 3;
  const purgeFlag = flags.includes('--purge');

  // ── resolve target to model list ───────────────────────────────────────────
  const combos = db.prepare('SELECT name, models FROM combos').all();
  const nodes = db.prepare('SELECT id, name, data FROM providerNodes').all();

  // check if target is a combo name
  const comboMatch = combos.find(c => c.name === target);
  // check if target is a provider prefix or node name
  const prefixMatch = nodes.find(n => {
    try { const d = JSON.parse(n.data); return d.prefix === target || n.name === target; } catch { return false; }
  });
  // check if target is a model id
  const allModelsSet = new Set();
  const modelInCombos = {};
  for (const c of combos) {
    for (const m of JSON.parse(c.models)) {
      allModelsSet.add(m);
      if (!modelInCombos[m]) modelInCombos[m] = [];
      modelInCombos[m].push(c.name);
    }
  }
  const isExactModel = allModelsSet.has(target);

  let models = [];
  let mode = '';
  if (comboMatch) {
    models = JSON.parse(comboMatch.models);
    mode = `combo:${target}`;
  } else if (prefixMatch) {
    let pfx;
    try { pfx = JSON.parse(prefixMatch.data).prefix || prefixMatch.name; } catch { pfx = prefixMatch.name; }
    models = [...allModelsSet].filter(m => m.startsWith(pfx + '/'));
    mode = `provider:${target}`;
  } else if (isExactModel) {
    models = [target];
    mode = `model:${target}`;
  } else if (target) {
    // fuzzy: treat as prefix substring
    models = [...allModelsSet].filter(m => m.startsWith(target + '/') || m.startsWith(target));
    if (!models.length) fail(`"${target}" is not a combo, provider, or model id`);
    mode = `prefix:${target}`;
  } else {
    fail('ping requires a target: <combo|provider|model>');
  }

  if (limit < Infinity) models = models.slice(0, limit);
  if (!models.length) fail(`no models found for target "${target}"`);

  console.log(dim(`ping ${mode}  ${models.length} models  ${direct ? 'direct' : 'via 9router'}  timeout=${timeoutMs}ms  concurrency=${concurrency}`));
  console.log();

  // ── http helper (async, handles http + https) ───────────────────────────────
  function doRequest(url, method, headers, body) {
    return new Promise((resolve) => {
      const mod = url.startsWith('https') ? https : http;
      const data = body ? JSON.stringify(body) : null;
      if (data) headers['Content-Length'] = Buffer.byteLength(data);
      const r = mod.request(url, { method: method || 'GET', headers }, (res) => {
        let s = '';
        res.on('data', c => s += c);
        res.on('end', () => resolve({ status: res.statusCode, body: s }));
      });
      r.on('error', e => resolve({ status: 0, body: e.message }));
      r.setTimeout(timeoutMs, () => { r.destroy(); resolve({ status: 0, body: 'TIMEOUT' }); });
      if (data) r.write(data);
      r.end();
    });
  }

  // ── build pinger based on mode ──────────────────────────────────────────────
  function makeViaRouter(modelId) {
    // use first active apiKey
    
    const keyRow = db.prepare("SELECT key FROM apiKeys WHERE isActive=1 ORDER BY createdAt LIMIT 1").get();
    if (!keyRow) fail('no active apiKey found in DB — check apiKeys table');
    const key = keyRow.key;
    return async () => {
      const res = await doRequest(API_URL + '/v1/chat/completions', 'POST', {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      }, { model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8, stream: false });
      let ok = false, note = '';
      try {
        const j = JSON.parse(res.body);
        if (res.status === 200) {
          ok = Array.isArray(j.choices) && j.choices.length > 0;
          note = (j.choices?.[0]?.message?.content || '').slice(0, 50).replace(/\n/g, ' ');
        } else {
          note = j.error?.message?.slice(0, 120) || j.message?.slice(0, 120) || res.body.slice(0, 120);
        }
      } catch { note = res.body.slice(0, 120); }
      return { ok, status: res.status, note };
    };
  }

  function makeDirectPinger(modelId) {
    // find the prefix
    const pfx = modelId.includes('/') ? modelId.split('/')[0] : null;
    if (!pfx) return null;
    const node = nodes.find(n => { try { return JSON.parse(n.data).prefix === pfx; } catch { return false; } });
    if (!node) return null;
    let nodeData;
    try { nodeData = JSON.parse(node.data); } catch { return null; }
    const baseUrl = nodeData.baseUrl?.replace(/\/$/, '');
    if (!baseUrl) return null;
    // find matching connection for this node
    const conn = db.prepare("SELECT data FROM providerConnections WHERE provider=? AND isActive=1 ORDER BY priority LIMIT 1").get(node.id);
    if (!conn) return null;
    let connData;
    try { connData = JSON.parse(conn.data); } catch { return null; }
    const key = connData.apiKey || connData.accessToken;
    if (!key) return null;
    const rawModel = modelId.slice(pfx.length + 1);
    const apiType = nodeData.apiType || 'chat';

    return async () => {
      let url, headers, body, res, ok = false, note = '';
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
      if (apiType === 'responses') {
        url = baseUrl + '/responses';
        body = { model: rawModel, input: 'ping', max_output_tokens: 8 };
      } else if (node.type === 'anthropic-compatible') {
        url = baseUrl + '/messages';
        headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
        body = { model: rawModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 };
      } else {
        url = baseUrl + '/chat/completions';
        body = { model: rawModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8, stream: false };
      }
      res = await doRequest(url, 'POST', headers, body);
      try {
        const j = JSON.parse(res.body);
        if (res.status === 200) {
          if (apiType === 'responses') {
            ok = Array.isArray(j.output) && j.output.length > 0;
            note = (j.output?.[0]?.content?.[0]?.text || '').slice(0, 50).replace(/\n/g, ' ');
          } else if (node.type === 'anthropic-compatible') {
            ok = Array.isArray(j.content) && j.content.length > 0;
            note = (j.content?.[0]?.text || '').slice(0, 50).replace(/\n/g, ' ');
          } else {
            ok = Array.isArray(j.choices) && j.choices.length > 0;
            note = (j.choices?.[0]?.message?.content || '').slice(0, 50).replace(/\n/g, ' ');
          }
        } else {
          note = j.error?.message?.slice(0, 120) || j.message?.slice(0, 120) || res.body.slice(0, 120);
        }
      } catch { note = res.body.slice(0, 120); }
      return { ok, status: res.status, note };
    };
  }

  // ── run with concurrency ────────────────────────────────────────────────────
  async function run() {
    const results = [];
    let i = 0;
    async function next() {
      while (i < models.length) {
        const modelId = models[i++];
        const pinger = direct ? makeDirectPinger(modelId) : makeViaRouter(modelId);
        if (!pinger) {
          results.push({ modelId, ok: false, status: 0, ms: 0, note: direct ? 'no direct config (node/connection not found)' : 'pinger init failed' });
          if (!failuresOnly) console.log(`${dim('SKIP')} ${dim('---')}     ${modelId}  ${dim('no direct config')}`);
          continue;
        }
        const t0 = Date.now();
        let r;
        try { r = await pinger(); } catch (e) { r = { ok: false, status: 0, note: e.message }; }
        const ms = Date.now() - t0;
        results.push({ modelId, ...r, ms });
        if (!failuresOnly || !r.ok) {
          const tag = r.ok ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mFAIL\x1b[0m';
          const latency = String(ms + 'ms').padStart(7);
          const statusStr = String(r.status).padStart(3);
          console.log(`${tag} ${statusStr} ${latency}  ${modelId}  ${dim(r.note || '')}`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, next));

    // summary
    const ok = results.filter(r => r.ok);
    const fail = results.filter(r => !r.ok);
    console.log();
    console.log(bold(`${ok.length}/${results.length} OK`) + (fail.length ? `  ${fail.length} failed` : ''));

    // --purge
    if (purgeFlag && fail.length) {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const failIds = fail.map(r => r.modelId);
      rl.question(`\nPurge ${fail.length} failing model(s) from all combos? [y/N] `, (ans) => {
        rl.close();
        if (ans.toLowerCase() === 'y') {
          backup();
          for (const m of failIds) purgeModel(m);
          console.log(dim(`purged ${failIds.length} models`));
        } else {
          console.log(dim('skipped purge'));
        }
        if (fail.length) process.exit(1);
      });
    } else {
      if (fail.length) process.exit(1);
    }
  }

  run().catch(e => fail(e.message));
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let dest = file || path.join(process.cwd(), `9router-backup-${stamp}.sqlite`);
  try {
    fs.copyFileSync(DB_PATH, dest);
  } catch (e) {
    if (file) fail(`cannot write backup to ${file}: ${e.code}`);
    // cwd not writable (e.g. C:\) — fall back to temp
    dest = path.join(require('os').tmpdir(), `9router-backup-${stamp}.sqlite`);
    fs.copyFileSync(DB_PATH, dest);
  }
  console.log(`backed up DB -> ${dest}`);
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const USAGE = `9router Model Manager CLI

Usage: r9 <command> [args]

Combos:
  list                            list all combos with model counts
  show <combo>                    show models in a combo (+ breakdown by prefix)
  stats <combo>                   compare combo against live API, list dead models
  sync <combo>                    remove models not present in live API
  create <combo> <m1,m2,...>      create a new combo
  delete <combo>                  delete a combo
  add <combo> <m1,m2,...>         add models to a combo
  remove <combo> <m1,m2,...>      remove models from a combo
  rmprefix <combo> <prefix>       remove all models with a prefix (e.g. "hv/")
  export <combo> <file.json>      export combo to JSON
  import <file.json> [name]       import/merge combo from JSON

Models:
  search <query>                  find models across all combos
  where <model>                   show which combos contain a model
  purge <model>                   remove a model from every combo
  api [filter]                    list models from the live API (optionally filtered)

Providers:
  providers                       list provider nodes with prefixes
  ping <target> [flags]           test models via chat/completions
    target: combo name, provider prefix/name, or exact model id
    --direct       hit upstream provider directly (needs node+connection in DB)
    --limit N      max models to ping
    --timeout N    ms per request (default 30000)
    --concurrency N parallel requests (default 3)
    --failures     only print failures
    --purge        prompt to purge failing models after run

DB:
  info                            DB summary (paths, counts, tables)
  backup [file]                   copy the DB to a backup file

Env overrides:
  NR_DB       path to data.sqlite
  NR_RUNTIME  node_modules containing better-sqlite3
  NR_API      base URL of the 9router API (default http://localhost:20128)
`;

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(USAGE); return; }
  if (cmd === '--version' || cmd === '-v') {
    const pkg = require('./package.json');
    console.log(pkg.version);
    return;
  }

  initDb();

  switch (cmd) {
    case 'list': case 'ls': return listCombos();
    case 'show': return showCombo(args[0]);
    case 'stats': return comboStats(args[0]);
    case 'sync': return syncCombo(args[0]);
    case 'create': return createCombo(args[0], args[1], args[2]);
    case 'delete': return deleteCombo(args[0]);
    case 'add': return addModels(args[0], args[1]);
    case 'remove': case 'rm': return removeModels(args[0], args[1]);
    case 'rmprefix': return removePrefix(args[0], args[1]);
    case 'export': return exportCombo(args[0], args[1]);
    case 'import': return importCombo(args[0], args[1]);
    case 'search': return searchModels(args[0]);
    case 'where': return whereModel(args[0]);
    case 'purge': return purgeModel(args[0]);
    case 'api': return listApiModels(args[0]);
    case 'providers': return listProviders();
    case 'ping': return ping(args[0], args.slice(1));
    case 'info': return dbInfo();
    case 'backup': return backup(args[0]);
    default: fail(`unknown command: ${cmd}\n\n${USAGE}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  initDb,
  loadDatabase,
  getCombo,
  saveCombo,
  listCombos,
  showCombo,
  createCombo,
  deleteCombo,
  addModels,
  removeModels,
  removePrefix,
  purgeModel,
  searchModels,
  whereModel,
  listProviders,
  comboStats,
  syncCombo,
  listApiModels,
  exportCombo,
  importCombo,
  dbInfo,
  ping,
  backup,
  USAGE
};
