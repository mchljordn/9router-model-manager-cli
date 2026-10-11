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
  rmprefix <combo> <prefix>       remove all models with a prefix from one combo
  rmprefix-all <prefix> [combos]  remove all models with a prefix from every combo
                                  (optional: list combos to keep, e.g. "ag/ premium-everything")
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
  testall [flags]                 curl-test every provider and report response times
    --limit N      models per provider (default 5)
    --timeout N    ms per request (default 20000)
    --concurrency N parallel requests (default 5)
    --json         emit machine-readable JSON instead of a table

DB:
  info                            DB summary (paths, counts, tables)
  backup [file]                   copy the DB to a backup file

Env overrides:
  NR_DB       path to data.sqlite
  NR_RUNTIME  node_modules containing better-sqlite3
  NR_API      base URL of the 9router API (default http://localhost:20128)
`;

module.exports = { USAGE };
