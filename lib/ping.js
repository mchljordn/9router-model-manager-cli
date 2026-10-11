const path = require('path');
const fs = require('fs');
const os = require('os');
const { query, getDb, fail, now } = require('./db');
const { bold, dim } = require('./utils');
const { API_URL, apiModels } = require('./api');
const { getCombo, saveCombo, purgeModel } = require('./combos');

async function ping(target, flags = []) {
  const direct = flags.includes('--direct');
  const failuresOnly = flags.includes('--failures');
  const limitIdx = flags.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(flags[limitIdx + 1]) : Infinity;
  const timeoutIdx = flags.indexOf('--timeout');
  const timeoutMs = timeoutIdx >= 0 ? parseInt(flags[timeoutIdx + 1]) : 30000;
  const concIdx = flags.indexOf('--concurrency');
  const concurrency = concIdx >= 0 ? parseInt(flags[concIdx + 1]) : 3;
  const purgeFlag = flags.includes('--purge');

  let models = [];
  let mode = '';

  const comboRow = query('SELECT models FROM combos WHERE name = ?').get(target);
  let nodes = null;
  if (comboRow) {
    models = JSON.parse(comboRow.models);
    mode = `combo:${target}`;
  } else {
    nodes = query('SELECT id, name, data FROM providerNodes').all();
    const prefixMatch = nodes.find(n => {
      try { const d = JSON.parse(n.data); return d.prefix === target || n.name === target; } catch { return false; }
    });

    if (prefixMatch) {
      let pfx;
      try { pfx = JSON.parse(prefixMatch.data).prefix || prefixMatch.name; } catch { pfx = prefixMatch.name; }
      const matched = new Set();
      for (const r of query('SELECT models FROM combos WHERE models LIKE ?').all(`%"${pfx}/%`)) {
        for (const m of JSON.parse(r.models)) {
          if (m.startsWith(pfx + '/')) matched.add(m);
        }
      }
      models = [...matched];
      mode = `provider:${target}`;
    } else {
      const matchRow = query('SELECT models FROM combos WHERE models LIKE ?').all(`%${target}%`);
      const matched = new Set();
      for (const r of matchRow) {
        for (const m of JSON.parse(r.models)) {
          if (m === target || m.startsWith(target + '/') || m.startsWith(target)) matched.add(m);
        }
      }
      if (matched.has(target)) {
        models = [target];
        mode = `model:${target}`;
      } else if (matched.size > 0) {
        models = [...matched];
        mode = `prefix:${target}`;
      } else {
        fail(`"${target}" is not a combo, provider, or model id`);
      }
    }
  }

  if (limit < Infinity) models = models.slice(0, limit);
  if (!models.length) fail(`no models found for target "${target}"`);

  console.log(dim(`ping ${mode}  ${models.length} models  ${direct ? 'direct' : 'via 9router'}  timeout=${timeoutMs}ms  concurrency=${concurrency}`));
  console.log();

  async function doRequest(url, method, headers, body) {
    try {
      const res = await fetch(url, {
        method: method || 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await res.text();
      return { status: res.status, body: text };
    } catch (e) {
      const isTimeout = e.name === 'TimeoutError' || e.code === 23;
      return { status: 0, body: isTimeout ? 'TIMEOUT' : e.message };
    }
  }

  function makeViaRouter(modelId) {
    const keyRow = query("SELECT key FROM apiKeys WHERE isActive=1 ORDER BY createdAt LIMIT 1").get();
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
    if (!nodes) nodes = query('SELECT id, name, data FROM providerNodes').all();
    const pfx = modelId.includes('/') ? modelId.split('/')[0] : null;
    if (!pfx) return null;
    const node = nodes.find(n => { try { return JSON.parse(n.data).prefix === pfx; } catch { return false; } });
    if (!node) return null;
    let nodeData;
    try { nodeData = JSON.parse(node.data); } catch { return null; }
    const baseUrl = nodeData.baseUrl?.replace(/\/$/, '');
    if (!baseUrl) return null;
    const conn = query("SELECT data FROM providerConnections WHERE provider=? AND isActive=1 ORDER BY priority LIMIT 1").get(node.id);
    if (!conn) return null;
    let connData;
    try { connData = JSON.parse(conn.data); } catch { return null; }
    const key = connData.apiKey || connData.accessToken;
    if (!key) return null;
    const rawModel = modelId.slice(pfx.length + 1);
    const apiType = nodeData.apiType || 'chat';

    return async () => {
      let url, headers, body;
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
      const res = await doRequest(url, 'POST', headers, body);
      let ok = false, note = '';
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

  const ok = results.filter(r => r.ok);
  const failList = results.filter(r => !r.ok);
  console.log();
  console.log(bold(`${ok.length}/${results.length} OK`) + (failList.length ? `  ${failList.length} failed` : ''));

  if (purgeFlag && failList.length) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const failIds = failList.map(r => r.modelId);
    rl.question(`\nPurge ${failList.length} failing model(s) from all combos? [y/N] `, async (ans) => {
      rl.close();
      if (ans.toLowerCase() === 'y') {
        await backup();
        for (const m of failIds) purgeModel(m);
        console.log(dim(`purged ${failIds.length} models`));
      } else {
        console.log(dim('skipped purge'));
      }
      process.exit(1);
    });
  } else if (failList.length) {
    process.exit(1);
  }
}

async function testall(flags = []) {
  const limitIdx = flags.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(flags[limitIdx + 1]) : 5;
  const timeoutIdx = flags.indexOf('--timeout');
  const timeoutMs = timeoutIdx >= 0 ? parseInt(flags[timeoutIdx + 1]) : 20000;
  const concIdx = flags.indexOf('--concurrency');
  const concurrency = concIdx >= 0 ? parseInt(flags[concIdx + 1]) : 5;
  const jsonOut = flags.includes('--json');

  const comboNames = new Set(query('SELECT name FROM combos').all().map(r => r.name));
  const api = await apiModels();
  const prefixMap = new Map();
  for (const m of api) {
    const p = m.includes('/') ? m.split('/')[0] : m;
    if (!prefixMap.has(p)) prefixMap.set(p, []);
    prefixMap.get(p).push(m);
  }
  const providers = [...prefixMap.keys()].filter(p => !comboNames.has(p)).sort();

  const keyRow = query('SELECT key FROM apiKeys WHERE isActive=1 ORDER BY createdAt LIMIT 1').get();
  if (!keyRow) fail('no active apiKey found in DB — check apiKeys table');
  const key = keyRow.key;

  console.log(dim(`testall ${providers.length} providers  ${limit} models each  timeout=${timeoutMs}ms  concurrency=${concurrency}`));
  console.log();

  const summary = [];
  for (const p of providers) {
    const models = prefixMap.get(p).slice(0, limit);
    const details = [];
    let i = 0;
    async function worker() {
      while (i < models.length) {
        const modelId = models[i++];
        const t0 = Date.now();
        let status = 0, ok = false;
        try {
          const res = await fetch(API_URL + '/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8, stream: false }),
            signal: AbortSignal.timeout(timeoutMs)
          });
          status = res.status;
          ok = res.ok;
          await res.text().catch(() => {});
        } catch (e) {
          status = 0; ok = false;
        }
        details.push({ model: modelId, ok, status, ms: Date.now() - t0 });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, worker));

    const oks = details.filter(d => d.ok);
    const lat = oks.map(d => d.ms).sort((a, b) => a - b);
    const min = lat.length ? lat[0] : null;
    const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
    const max = lat.length ? lat[lat.length - 1] : null;
    const verdict = !oks.length ? 'ALL FAIL' : (oks.length < details.length ? 'PARTIAL' : (avg > 3000 ? 'SLOW' : 'OK'));
    summary.push({ provider: p, models: models.length, ok: oks.length, fail: details.length - oks.length, min, avg, max, verdict, details });

    if (!jsonOut) {
      const tag = !oks.length ? '\x1b[31mALL FAIL\x1b[0m' : (oks.length < details.length ? '\x1b[33mPARTIAL\x1b[0m' : (avg > 3000 ? '\x1b[33mSLOW\x1b[0m' : '\x1b[32mOK\x1b[0m'));
      console.log(`${bold(p.padEnd(16))} ${String(details.length).padStart(3)} models  ${String(oks.length).padStart(3)}/${String(details.length).padStart(3)} ok  ${tag}` +
        (lat.length ? dim(`  ${min}ms / ${avg}ms / ${max}ms`) : ''));
      for (const d of details) {
        if (!d.ok) console.log(`    \x1b[31mFAIL\x1b[0m HTTP ${String(d.status).padEnd(4)} ${d.ms}ms  ${d.model}`);
      }
    }
  }

  console.log();
  const allOk = summary.filter(s => s.ok > 0).length;
  console.log(bold(`${allOk}/${summary.length} providers responding`));

  const ranked = summary.filter(s => s.avg !== null).sort((a, b) => a.avg - b.avg);
  if (ranked.length && !jsonOut) {
    console.log(dim('\nfastest responders:'));
    for (const s of ranked.slice(0, 5)) console.log(dim(`  ${s.provider.padEnd(16)} ${s.avg}ms avg`));
    const dead = summary.filter(s => s.ok === 0);
    if (dead.length) {
      console.log(dim('no response at all:'));
      console.log(dim('  ' + dead.map(s => s.provider).join(', ')));
    }
  }

  if (jsonOut) console.log(JSON.stringify(summary, null, 2));
}

async function backup(file) {
  const { DB_PATH } = require('./db');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let dest = file || path.join(process.cwd(), `9router-backup-${stamp}.sqlite`);
  const db = getDb();
  try {
    if (db && typeof db.backup === 'function') {
      await db.backup(dest);
    } else {
      fs.copyFileSync(DB_PATH, dest);
    }
  } catch (e) {
    if (file) fail(`cannot write backup to ${file}: ${e.code || e.message}`);
    dest = path.join(os.tmpdir(), `9router-backup-${stamp}.sqlite`);
    if (db && typeof db.backup === 'function') {
      await db.backup(dest);
    } else {
      fs.copyFileSync(DB_PATH, dest);
    }
  }
  console.log(`backed up DB -> ${dest}`);
}

module.exports = { ping, testall, backup };
