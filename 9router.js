#!/usr/bin/env node
const cli = require('./lib/cli');

if (require.main === module) {
  cli.main().catch(e => { console.error('error: ' + e.message); process.exit(1); });
}

module.exports = {
  ...require('./lib/db'),
  ...require('./lib/utils'),
  ...require('./lib/combos'),
  ...require('./lib/api'),
  ...require('./lib/providers'),
  ...require('./lib/ping'),
  USAGE: require('./lib/usage').USAGE,
};
