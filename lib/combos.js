const { query, fail, now } = require('./db');
const { bold, dim, ts, tsFull, countByPrefix } = require('./utils');

function getCombo(name) {
  const row = query('SELECT id, name, kind, models, createdAt, updatedAt FROM combos WHERE name = ?').get(name);
  if (!row) fail(`combo "${name}" not found`);
  row.models = JSON.parse(row.models);
  return row;
}

function saveCombo(combo, models) {
  const next = [...new Set(models)].sort();
  query('UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?')
    .run(JSON.stringify(next), now(), combo.id);
  return next;
}

function listCombos() {
  const rows = query('SELECT name, kind, models, updatedAt FROM combos ORDER BY name').all();
  if (!rows.length) { console.log(dim('0 combos')); return; }
  const w = Math.max(...rows.map(r => r.name.length), 4);
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
  const exists = query('SELECT id FROM combos WHERE name = ?').get(name);
  if (exists) fail(`combo "${name}" already exists — use add/remove to edit`);
  const models = [...new Set(modelsArg.split(',').map(s => s.trim()).filter(Boolean))];
  const id = 'combo-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
  query('INSERT INTO combos (id, name, kind, models, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
    .run(id, name, kind, JSON.stringify(models.sort()), now(), now());
  console.log(`created ${bold(name)} with ${models.length} models`);
}

function deleteCombo(name) {
  const c = getCombo(name);
  query('DELETE FROM combos WHERE id = ?').run(c.id);
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
  const missed = rm.filter(m => !c.models.includes(m));
  if (missed.length) console.log(dim(`  not present: ${missed.join(', ')}`));
}

function removePrefix(name, prefix) {
  const c = getCombo(name);
  const before = c.models.length;
  const next = saveCombo(c, c.models.filter(m => !m.startsWith(prefix)));
  console.log(`${bold(name)}: ${before} -> ${next.length} (-${before - next.length} matching "${prefix}")`);
}

function removePrefixAll(prefix, except = []) {
  const rows = query('SELECT id, name, models FROM combos ORDER BY name').all();
  let totalRemoved = 0;
  for (const r of rows) {
    if (except.includes(r.name)) { console.log(dim(`  skip ${r.name} (excepted)`)); continue; }
    const models = JSON.parse(r.models);
    const filtered = models.filter(m => !m.startsWith(prefix));
    const removed = models.length - filtered.length;
    if (removed === 0) { console.log(dim(`  ${r.name}: none`)); continue; }
    query('UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify([...new Set(filtered)].sort()), now(), r.id);
    console.log(`  ${bold(r.name)}: -${removed} (${models.length} -> ${filtered.length})`);
    totalRemoved += removed;
  }
  console.log(dim(`\ntotal removed: ${totalRemoved} models matching "${prefix}" across ${rows.length - except.length} combos`));
}

function purgeModel(model) {
  const rows = query('SELECT id, name, models FROM combos WHERE models LIKE ?').all(`%${model}%`);
  let hit = 0;
  const updateStmt = query('UPDATE combos SET models = ?, updatedAt = ? WHERE id = ?');
  const runTx = require('./db').getDb().transaction((targets) => {
    for (const r of targets) {
      const m = JSON.parse(r.models);
      if (m.includes(model)) {
        updateStmt.run(JSON.stringify(m.filter(x => x !== model)), now(), r.id);
        hit++;
      }
    }
  });
  runTx(rows);
  console.log(`purged ${bold(model)} from ${hit} combo(s)`);
}

function searchModels(queryStr) {
  const q = queryStr.toLowerCase();
  const rows = query('SELECT models FROM combos WHERE models LIKE ?').all(`%${queryStr}%`);
  const seen = new Set();
  for (const r of rows) {
    for (const m of JSON.parse(r.models)) {
      if (m.toLowerCase().includes(q)) seen.add(m);
    }
  }
  const sorted = [...seen].sort();
  for (const m of sorted) console.log('  ' + m);
  console.log(dim(`\n${sorted.length} unique models match "${queryStr}"`));
}

function whereModel(model) {
  const rows = query('SELECT name, models FROM combos WHERE models LIKE ? ORDER BY name').all(`%${model}%`);
  const inCombos = rows.filter(r => JSON.parse(r.models).includes(model)).map(r => r.name);
  if (!inCombos.length) { console.log(dim(`"${model}" is not in any combo`)); return; }
  console.log(`${bold(model)} is in: ${inCombos.join(', ')}`);
}

function exportCombo(name, file) {
  const fs = require('fs');
  const c = getCombo(name);
  const payload = { name: c.name, kind: c.kind, models: c.models, exportedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`exported ${bold(name)} (${c.models.length} models) -> ${file}`);
}

function importCombo(file, name) {
  const fs = require('fs');
  if (!fs.existsSync(file)) fail(`file not found: ${file}`);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const target = name || payload.name;
  if (!target) fail('no name given (arg or "name" field in file)');
  const exists = query('SELECT id FROM combos WHERE name = ?').get(target);
  if (exists) {
    addModels(target, (payload.models || []).join(','));
    console.log(dim(`merged into existing ${target}`));
  } else {
    createCombo(target, (payload.models || []).join(','), payload.kind || 'custom');
  }
}

module.exports = {
  getCombo, saveCombo, listCombos, showCombo, createCombo, deleteCombo,
  addModels, removeModels, removePrefix, removePrefixAll,
  purgeModel, searchModels, whereModel, exportCombo, importCombo,
};
