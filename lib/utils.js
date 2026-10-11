function bold(s) { return '\x1b[1m' + s + '\x1b[0m'; }
function dim(s) { return '\x1b[2m' + s + '\x1b[0m'; }

function ts(v) {
  if (!v) return '-';
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

function countByPrefix(models) {
  const m = new Map();
  for (const id of models) {
    const slash = id.indexOf('/');
    const p = slash !== -1 ? id.slice(0, slash) : id;
    m.set(p, (m.get(p) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

module.exports = { bold, dim, ts, tsFull, countByPrefix };
