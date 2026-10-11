const { query } = require('./db');
const { bold, dim } = require('./utils');

function listProviders() {
  const nodes = query('SELECT id, name, data, updatedAt FROM providerNodes ORDER BY name').all();
  if (!nodes.length) { console.log(dim('0 provider nodes')); return; }
  const w = Math.max(...nodes.map(n => n.name.length), 8);
  for (const n of nodes) {
    let prefix = '', apiType = '';
    try { const d = JSON.parse(n.data); prefix = d.prefix || ''; apiType = d.apiType || d.type || ''; } catch {}
    console.log(`${bold(n.name.padEnd(w))}  prefix=${(prefix || '-').padEnd(14)} ${dim(apiType)}`);
  }
  console.log(dim(`\n${nodes.length} provider nodes`));
}

function getNodes() {
  return query('SELECT id, name, data FROM providerNodes').all();
}

module.exports = { listProviders, getNodes };
