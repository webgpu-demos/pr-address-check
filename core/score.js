// Scoring: one row per case and arm, then a report per arm (mode + provider + model).

import { metersBetween } from './geocode/orchestrate.js';
import { canonical, sameValue } from './text.js';
import { FLAG_CODES } from './schema.js';

const FLAGS = new Set([...FLAG_CODES, 'ZIP_OUT_OF_RANGE']);

export const BUCKETS = [
  { id: 'unit', label: 'Correct unit (≤50 m)', max: 50 },
  { id: 'neighborhood', label: 'Correct complex or neighborhood (≤500 m)', max: 500 },
  { id: 'wrong_area', label: 'Wrong area (>500 m)', max: Infinity },
  { id: 'not_located', label: 'Not located' },
];

export function armKey(r) { return [r.mode, r.provider || '—', r.model || '—'].join(' · '); }

export function predictedFlags(result) {
  const codes = new Set();
  for (const r of result.reasons ?? []) {
    const c = r.code.replace(/^AI_/, '');
    if (FLAGS.has(c)) codes.add(c);
  }
  return codes;
}

const listOf = (s) => new Set(String(s ?? '').split(/[;|]/).map((x) => x.trim()).filter(Boolean));

/** One scored row. */
export function scoreRow(kase, result) {
  const row = {
    id: kase.id, tags: kase.tags ?? '', input: kase.input, mode: result.mode, provider: result.provider, model: result.model,
    prompt_version: result.prompt_version, compliance: result.compliance, expected_compliance: kase.expected_compliance ?? '',
    location: result.location_label, municipality: result.record.municipality, expected_municipio: kase.expected_municipio ?? '',
    distance_m: '', bucket: '', cost: result.cost ?? '', latency_ms: result.latency_ms ?? '',
    geocode_stage: result.geocode_stage, fallback: result.fallback?.used ? result.fallback.reason : '',
  };
  const lat = Number(kase.expected_lat); const lon = Number(kase.expected_lon);
  if (kase.expected_lat !== '' && kase.expected_lat !== undefined && Number.isFinite(lat) && Number.isFinite(lon)) {
    if (result.record.lat === '' || result.location === 'none' || result.location === 'outside') row.bucket = 'not_located';
    else {
      const d = metersBetween({ lat, lon }, { lat: result.record.lat, lon: result.record.lon });
      row.distance_m = Math.round(d);
      row.bucket = d <= 50 ? 'unit' : d <= 500 ? 'neighborhood' : 'wrong_area';
    }
  }
  // Fields as read from the input.
  const f = result.fields ?? {};
  const fieldCheck = (exp, got) => (exp ? (got ? sameValue(exp, got) || canonical(got).replace(/\s/g, '') === canonical(exp).replace(/\s/g, '') : false) : null);
  row.ok_structure_number = fieldCheck(kase.expected_structure_number, f.structure_number?.value);
  row.ok_street_name = fieldCheck(kase.expected_street_name, f.street_name?.value ?? f.route_number?.value);
  row.ok_zip = kase.expected_zip && !String(kase.expected_missing ?? '').includes('zip') ? fieldCheck(kase.expected_zip, f.zip?.source === 'typed' ? f.zip.value : '') : null;
  row.ok_municipio = kase.expected_municipio && result.record.municipality ? sameValue(kase.expected_municipio, result.record.municipality) : null;
  row.ok_compliance = kase.expected_compliance ? result.compliance === kase.expected_compliance : null;
  const exp = listOf(kase.expected_flags);
  const got = predictedFlags(result);
  row.expected_flags = [...exp].join(';');
  row.flags = [...got].join(';');
  row.flag_tp = [...exp].filter((x) => got.has(x)).length;
  row.flag_fn = [...exp].filter((x) => !got.has(x)).length;
  row.flag_fp = [...got].filter((x) => !exp.has(x)).length;
  const expMissing = listOf(kase.expected_missing);
  const gotMissing = new Set(result.missing_required ?? []);
  row.ok_missing = kase.expected_missing !== undefined && kase.expected_compliance !== 'Postal only'
    ? [...expMissing].every((x) => gotMissing.has(x)) && [...gotMissing].every((x) => expMissing.has(x)) : null;
  row.disagreement = (result.gate?.disagreements?.length ?? 0) > 0;
  row.source_text_failures = (result.gate?.dropped ?? []).filter((d) => d.reason === 'SOURCE_TEXT_NOT_FOUND' || d.reason === 'VALUE_NOT_IN_SOURCE').length;
  row.model_components = result.gate?.raw?.components?.length ?? 0;
  row.flagged_disagreement = (result.reasons ?? []).some((r) => r.code === 'PARSE_DISAGREEMENT');
  row.row_wrong = row.ok_structure_number === false || row.ok_street_name === false || row.bucket === 'wrong_area' || row.ok_municipio === false;
  return row;
}

/** Wilson score interval for k of n, 95%. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

function rate(rows, pred) {
  const scoped = rows.filter((r) => pred(r) !== null && pred(r) !== undefined);
  const k = scoped.filter((r) => pred(r) === true).length;
  return { k, n: scoped.length, rate: scoped.length ? k / scoped.length : null, ci: wilson(k, scoped.length) };
}

function pct(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}

export function summarize(rows) {
  const located = rows.filter((r) => r.bucket);
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b.id, rate(located, (r) => r.bucket === b.id)]));
  const tp = rows.reduce((s, r) => s + r.flag_tp, 0);
  const fn = rows.reduce((s, r) => s + r.flag_fn, 0);
  const fp = rows.reduce((s, r) => s + r.flag_fp, 0);
  const costs = rows.map((r) => Number(r.cost)).filter(Number.isFinite);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  const modelRows = rows.filter((r) => r.model_components > 0);
  const disagreeRows = rows.filter((r) => r.flagged_disagreement);
  return {
    n: rows.length,
    buckets,
    medianDistance: pct(located.map((r) => Number(r.distance_m)).filter((d) => d !== 0 || true), 50),
    fields: {
      structure_number: rate(rows, (r) => r.ok_structure_number),
      street_name: rate(rows, (r) => r.ok_street_name),
      zip: rate(rows, (r) => r.ok_zip),
      municipio: rate(rows, (r) => r.ok_municipio),
      missing: rate(rows, (r) => r.ok_missing),
    },
    compliance: rate(rows, (r) => r.ok_compliance),
    flags: { tp, fn, fp, recall: tp + fn ? tp / (tp + fn) : null, precision: tp + fp ? tp / (tp + fp) : null, recallCi: wilson(tp, tp + fn) },
    censusFirstHit: rate(rows.filter((r) => r.geocode_stage), (r) => r.geocode_stage === 'census'),
    esriFallback: rate(rows.filter((r) => r.geocode_stage), (r) => r.geocode_stage === 'esri'),
    fallback: rate(rows.filter((r) => r.mode === 'ai_first'), (r) => Boolean(r.fallback)),
    sourceTextFailureRate: modelRows.length ? modelRows.reduce((s, r) => s + r.source_text_failures, 0) / modelRows.reduce((s, r) => s + r.model_components, 0) : null,
    disagreement: rate(rows.filter((r) => r.mode === 'ai_first'), (r) => r.disagreement),
    disagreementMarksError: rate(disagreeRows, (r) => r.row_wrong),
    wrongButConfident: rate(rows, (r) => r.row_wrong && (r.compliance === 'Compliant' || r.compliance === 'Compliant with warnings')),
    cost: { total: costs.length ? totalCost : null, per1000: costs.length ? (totalCost / costs.length) * 1000 : null },
    latency: { p50: pct(rows.map((r) => Number(r.latency_ms)), 50), p95: pct(rows.map((r) => Number(r.latency_ms)), 95) },
  };
}

export function report(rows) {
  const arms = {};
  for (const r of rows) (arms[armKey(r)] ??= []).push(r);
  const out = [];
  for (const [arm, list] of Object.entries(arms)) {
    const byTag = {};
    for (const r of list) for (const t of String(r.tags || 'untagged').split(';')) (byTag[t] ??= []).push(r);
    const byMuni = {};
    for (const r of list) (byMuni[r.expected_municipio || '—'] ??= []).push(r);
    out.push({
      arm,
      summary: summarize(list),
      byTag: Object.fromEntries(Object.entries(byTag).map(([k, v]) => [k, summarize(v)])),
      byMunicipio: Object.fromEntries(Object.entries(byMuni).map(([k, v]) => [k, summarize(v)])),
    });
  }
  return out;
}
