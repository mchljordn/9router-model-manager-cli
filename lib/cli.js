const fs = require('fs');
const { initDb, fail } = require('./db');
const combos = require('./combos');
const api = require('./api');
const providers = require('./providers');
const { ping, testall, backup } = require('./ping');
const { USAGE } = require('./usage');

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(USAGE); return; }
  if (cmd === '--version' || cmd === '-v') {
    const pkg = require('../package.json');
    console.log(pkg.version);
    return;
  }

  initDb();

  switch (cmd) {
    case 'list': case 'ls': return combos.listCombos();
    case 'show': return combos.showCombo(args[0]);
    case 'stats': return await api.comboStats(args[0]);
    case 'sync': return await api.syncCombo(args[0]);
    case 'create': return combos.createCombo(args[0], args[1], args[2]);
    case 'delete': return combos.deleteCombo(args[0]);
    case 'add': return combos.addModels(args[0], args[1]);
    case 'remove': case 'rm': return combos.removeModels(args[0], args[1]);
    case 'rmprefix': return combos.removePrefix(args[0], args[1]);
    case 'rmprefix-all': return combos.removePrefixAll(args[0], args.slice(1).filter(a => !a.startsWith('--')));
    case 'export': return combos.exportCombo(args[0], args[1]);
    case 'import': return combos.importCombo(args[0], args[1]);
    case 'search': return combos.searchModels(args[0]);
    case 'where': return combos.whereModel(args[0]);
    case 'purge': return combos.purgeModel(args[0]);
    case 'api': return await api.listApiModels(args[0]);
    case 'providers': return providers.listProviders();
    case 'ping': return await ping(args[0], args.slice(1));
    case 'testall': return await testall(args.slice(1));
    case 'info': return dbInfo();
    case 'backup': return await backup(args[0]);
    default: fail(`unknown command: ${cmd}\n\n${USAGE}`);
  }
}

function dbInfo() {
  const { DB_PATH } = require('./db');
  const { query } = require('./db');
  const tables = query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t => t.name);
  const c = query('SELECT count(*) n FROM combos').get().n;
  const n = query('SELECT count(*) n FROM providerNodes').get().n;
  const conns = query('SELECT count(*) n FROM providerConnections').get().n;
  const { bold, dim } = require('./utils');
  console.log(bold('9router DB') + dim(`  ${DB_PATH}`));
  console.log(`  combos:            ${c}`);
  console.log(`  provider nodes:    ${n}`);
  console.log(`  provider conns:    ${conns}`);
  console.log(`  tables:            ${tables.join(', ')}`);
}

if (require.main === module) {
  main().catch(e => fail(e.message));
}

module.exports = { main, dbInfo };
