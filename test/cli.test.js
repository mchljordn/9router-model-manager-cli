const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r9-test-'));
const testDb = path.join(tmpDir, 'data.sqlite');
const cliPath = path.resolve(__dirname, '..', '9router.js');

function runCli(...args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, NR_DB: testDb },
    encoding: 'utf8',
  });
}

before(() => {
  const r9 = require('../9router.js');
  const Database = r9.loadDatabase();
  const db = new Database(testDb);
  db.exec(`
    CREATE TABLE combos (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      kind TEXT,
      models TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE providerNodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      data TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE providerConnections (
      id TEXT PRIMARY KEY,
      provider TEXT,
      data TEXT,
      isActive INTEGER,
      priority INTEGER,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE apiKeys (
      id TEXT PRIMARY KEY,
      key TEXT,
      isActive INTEGER,
      createdAt TEXT,
      updatedAt TEXT
    );
    INSERT INTO combos (id, name, kind, models, createdAt, updatedAt)
    VALUES ('c1', 'default', 'custom', '["openai/gpt-4o","anthropic/claude-3-5-sonnet"]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  `);
  db.close();
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

test('cli help and version flag without crashing', () => {
  const helpOut = runCli('--help');
  assert.match(helpOut, /Usage: r9 <command> \[args\]/);

  const verOut = runCli('--version');
  assert.equal(verOut.trim(), '1.0.0');
});

test('db info lists table summary', () => {
  const out = runCli('info');
  assert.match(out, /9router DB/);
  assert.match(out, /combos:\s+1/);
});

test('combo listing and show', () => {
  const listOut = runCli('list');
  assert.match(listOut, /default/);

  const showOut = runCli('show', 'default');
  assert.match(showOut, /openai\/gpt-4o/);
  assert.match(showOut, /anthropic\/claude-3-5-sonnet/);
});

test('create, modify, search, and delete combo', () => {
  runCli('create', 'tier-mini', 'google/gemini-flash,meta/llama-3');
  const showOut = runCli('show', 'tier-mini');
  assert.match(showOut, /google\/gemini-flash/);
  assert.match(showOut, /meta\/llama-3/);

  runCli('add', 'tier-mini', 'mistral/large');
  const addShow = runCli('show', 'tier-mini');
  assert.match(addShow, /mistral\/large/);

  runCli('remove', 'tier-mini', 'google/gemini-flash');
  const rmShow = runCli('show', 'tier-mini');
  assert.doesNotMatch(rmShow, /google\/gemini-flash/);

  const searchOut = runCli('search', 'llama');
  assert.match(searchOut, /meta\/llama-3/);

  const whereOut = runCli('where', 'meta/llama-3');
  assert.match(whereOut, /tier-mini/);

  runCli('purge', 'meta/llama-3');
  const purgeWhere = runCli('where', 'meta/llama-3');
  assert.match(purgeWhere, /is not in any combo/);

  runCli('add', 'tier-mini', 'mistral/large,mistral/small');
  runCli('rmprefix', 'tier-mini', 'mistral/');
  const rmPrefixShow = runCli('show', 'tier-mini');
  assert.doesNotMatch(rmPrefixShow, /mistral\//);

  runCli('delete', 'tier-mini');
  assert.throws(() => runCli('show', 'tier-mini'));
});

test('providers command lists provider nodes', () => {
  const r9 = require('../9router.js');
  const Database = r9.loadDatabase();
  const db = new Database(testDb);
  db.prepare(`
    INSERT INTO providerNodes (id, name, data, createdAt, updatedAt)
    VALUES ('p1', 'openai-direct', '{"prefix":"openai","apiType":"chat"}', '2026-01-01', '2026-01-01')
  `).run();
  db.close();

  const out = runCli('providers');
  assert.match(out, /openai-direct/);
  assert.match(out, /prefix=openai/);
});

test('export and import combo', () => {
  const exportFile = path.join(tmpDir, 'exported.json');
  runCli('export', 'default', exportFile);
  assert.equal(fs.existsSync(exportFile), true);

  runCli('import', exportFile, 'default-clone');
  const showClone = runCli('show', 'default-clone');
  assert.match(showClone, /openai\/gpt-4o/);
});

test('db backup creates sqlite snapshot', () => {
  const backupFile = path.join(tmpDir, 'backup.sqlite');
  runCli('backup', backupFile);
  assert.equal(fs.existsSync(backupFile), true);
  assert.ok(fs.statSync(backupFile).size > 0);
});
