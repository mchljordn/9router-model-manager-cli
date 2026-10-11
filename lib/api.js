const { query } = require('./db');
const { bold, dim } = require('./utils');

const API_URL = process.env.NR_API || 'http://localhost:20128';

async function apiModels() {
  let res;
  try {
    res = await fetch(API_URL + '/v1/models', { signal: AbortSignal.timeout(20000) });
  } catch {
    const { fail } = require('./db');
    fail(`no response from API at ${API_URL} — is the 9router server running?`);
  }
  if (!res.ok) { const { fail } = require('./db'); fail(`API returned HTTP ${res.status}`); }
  let j;
  try { j = await res.json(); } catch { const { fail } = require('./db'); fail('unparseable API response'); }
  const list = (j.data || j.models || []).map(x => x.id).filter(Boolean);
  if (!list.length) { const { fail } = require('./db'); fail('API returned an empty model list'); }
  return list;
}

async function listApiModels(filter) {
  const { countByPrefix } = require('./utils');
  const api = await apiModels();
  const f = filter ? filter.toLowerCase() : null;
  const rows = f ? api.filter(m => m.toLowerCase().includes(f)) : api;
  const groups = countByPrefix(rows);
  for (const [p, n] of groups) console.log(`  ${p.padEnd(14)} ${n}`);
  console.log(dim(`\n${rows.length} models${f ? ` matching "${filter}"` : ''} (total ${api.length})`));
}

async function comboStats(name) {
  const { getCombo } = require('./combos');
  const c = getCombo(name);
  const api = await apiModels();
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

async function syncCombo(name) {
  const { getCombo, saveCombo } = require('./combos');
  const c = getCombo(name);
  const api = await apiModels();
  const apiSet = new Set(api);
  const before = c.models.length;
  const kept = c.models.filter(m => apiSet.has(m));
  const next = saveCombo(c, kept);
  console.log(`${bold(name)}: ${before} -> ${next.length} (-${before - next.length} dead removed)`);
}

module.exports = { API_URL, apiModels, listApiModels, comboStats, syncCombo };
