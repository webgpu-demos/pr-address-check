// RFC 4180 CSV: quoted fields, embedded commas, quotes and newlines.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

/** Rows as objects keyed by header. */
export function parseCsvObjects(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { header: [], rows: [] };
  const keys = header.map((h) => h.trim());
  return { header: keys, rows: rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()]))) };
}

function cell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Guard spreadsheet formula injection in exported files.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** Guess which column holds the address, by header name first, then by content. */
export function guessAddressColumn(header, rows) {
  const byName = header.find((h) => /^(input|address|direccion|dirección|full_address|address_line|physical_address)$/i.test(h))
    ?? header.find((h) => /addr|direcc/i.test(h));
  if (byName) return byName;
  let best = header[0]; let score = -1;
  for (const h of header) {
    const sample = rows.slice(0, 20).map((r) => r[h] ?? '');
    const s = sample.filter((v) => /\d/.test(v) && /[a-z]{3}/i.test(v) && v.length > 10).length;
    if (s > score) { score = s; best = h; }
  }
  return best;
}
