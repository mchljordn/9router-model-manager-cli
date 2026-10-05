# 9router Model Manager CLI (`r9`)

Fast CLI tool to manage and audit the [9router](https://github.com/anomalyco/antigravity) SQLite database (`data.sqlite`).

Provides direct commands to manage model combos, search model allocations, verify provider connectivity, benchmark latency, prune dead models, and perform database backups.

---

## Features

- **Combo Management**: Create, inspect, modify, export, and import model combos.
- **Model Audits**: Search models across combos, locate combo mappings, and purge defunct models globally.
- **Provider Probing (`ping`)**: Test live completion latency directly against upstream providers or via the 9router local gateway with concurrency and failure filtering.
- **API Synchronization**: Compare combos with live API endpoints and strip dead models automatically.
- **Database Utilities**: View metadata metrics, table statistics, and make instant SQLite backups.

---

## Installation

### Method 1: Zero-Install (if 9router is already installed)

If 9router is installed on your system, `r9` resolves the bundled `better-sqlite3` driver automatically from the 9router runtime directory.

Clone this repository and link or alias it:

```bash
git clone https://github.com/mchljordn/9router-model-manager-cli.git
cd 9router-model-manager-cli
npm link
```

### Method 2: Global Install

```bash
npm install -g 9router-model-manager-cli
```

### Method 3: Standalone Dependencies

```bash
npm install
node 9router.js help
```

---

## Environment Variables

| Variable | Default (Windows) | Description |
|---|---|---|
| `NR_DB` | `%APPDATA%\9router\db\data.sqlite` | Absolute path to the 9router SQLite file. |
| `NR_RUNTIME` | `%APPDATA%\9router\runtime\node_modules` | Directory containing `better-sqlite3` native bindings. |
| `NR_API` | `http://localhost:20128` | Base URL of the running 9router API service. |

On macOS, paths default to `~/Library/Application Support/9router/...`.  
On Linux, paths default to `~/.config/9router/...`.

---

## Command Reference

### Combos

```bash
# List all combos and model counts
r9 list

# Inspect models in a combo grouped by provider prefix
r9 show <combo>

# Create a new combo
r9 create <combo> <model1,model2,...>

# Add models to an existing combo
r9 add <combo> <model1,model2,...>

# Remove models from a combo
r9 remove <combo> <model1,model2,...>

# Remove all models matching a prefix (e.g., "google/")
r9 rmprefix <combo> <prefix>

# Delete a combo
r9 delete <combo>

# Export combo definition to JSON
r9 export <combo> <file.json>

# Import combo from JSON (merges if combo exists)
r9 import <file.json> [name]
```

### Models

```bash
# Search models across all combos
r9 search <query>

# Identify which combos include a specific model
r9 where <model>

# Remove a model from every combo across the database
r9 purge <model>

# List models from the live 9router API (with optional filter)
r9 api [filter]
```

### Providers & Health Testing

```bash
# List all configured provider nodes and their prefixes
r9 providers

# Ping models to verify availability and measure latency
r9 ping <target> [flags]
```

**Target options:** combo name, provider prefix/name, or exact model ID.

**Ping flags:**
- `--direct`: Query upstream provider endpoints directly using stored provider connection keys.
- `--limit <N>`: Max models to test.
- `--timeout <N>`: Milliseconds per request (default `30000`).
- `--concurrency <N>`: Number of parallel requests (default `3`).
- `--failures`: Output failed models only.
- `--purge`: Interactive prompt to purge unresponsive models after test completion.

### Sync & API Comparison

```bash
# Compare combo against live API and list missing or dead models
r9 stats <combo>

# Strip models from combo that are absent in live API
r9 sync <combo>
```

### Database Maintenance

```bash
# Show database table counts, record stats, and file paths
r9 info

# Create timestamped database backup
r9 backup [destination-path.sqlite]
```

---

## Common Workflows

### 1. Pruning Unresponsive Models

Probe all models in a combo and purge failures in one step:

```bash
r9 ping heavy-models --direct --failures --purge
```

### 2. Syncing Combos After Provider Removal

When a provider is retired from 9router:

```bash
# 1. Back up database
r9 backup

# 2. Check dead models
r9 stats my-combo

# 3. Clean up dead models
r9 sync my-combo
```

---

## Development & Testing

Run unit tests against an isolated temporary database schema:

```bash
npm test
```

---

## License

[MIT](LICENSE)
