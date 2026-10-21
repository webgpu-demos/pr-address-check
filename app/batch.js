// Batch mode: run a CSV through one or more modes under a concurrency cap, then score it if it has labels.

import { scoreRow, report, BUCKETS } from '../core/score.js';
import { MODES } from '../core/pipeline.js';
import { esc, fmtCost, fmtMs } from './render.js';

export const RESULT_COLUMNS = ['id', 'input', 'mode', 'provider', 'model', 'prompt_version', 'compliance', 'location', 'reasons',
  'structure_number', 'street_type', 'street_name', 'unit', 'urbanization', 'complex', 'barrio', 'barrio_typed', 'barrio_type',
  'city', 'city_role', 'state', 'zip', 'municipality', 'municipio_fips', 'municipality_type', 'zcta', 'usng', 'lat', 'lon',
  'full_address', 'matched_address', 'geocoder', 'geocode_stage', 'fallback', 'cost', 'latency_ms'];

export function resultRow(id, r) {
  return {
    id, input: r.input, mode: r.mode, provider: r.provider, model: r.model, prompt_version: r.prompt_version,
    compliance: r.compliance, location: r.location_label, reasons: r.reasons.map((x) => x.code).join(';'),
    ...r.record, geocode_stage: r.geocode_stage, fallback: r.fallback?.used ? r.fallback.reason : '',
    cost: r.cost ?? '', latency_ms: r.latency_ms ?? '',
  };
}

export const hasLabels = (header) => header.some((h) => /^expected_/.test(h));

/** Runs jobs (row × mode), interleaved by row so a stopped run still compares modes on the same rows. */
export async function runBatch({ rows, addressCol, idCol, modes, concurrency, signal, runOne, onResult }) {
  const jobs = [];
  rows.forEach((row, i) => modes.forEach((mode) => jobs.push({ row, i, mode })));
  let next = 0;
  const out = [];
  async function worker() {
    while (next < jobs.length && !signal.aborted) {
      const job = jobs[next++];
      const input = String(job.row[addressCol] ?? '');
      const id = (idCol && job.row[idCol]) || `row-${job.i + 1}`;
      let entry;
      try {
        const result = await runOne(input, job.mode, signal);
        entry = { id, i: job.i, row: job.row, mode: job.mode, result };
      } catch (err) {
        if (signal.aborted) break;
        entry = { id, i: job.i, row: job.row, mode: job.mode, error: String(err.message ?? err) };
      }
      out.push(entry);
      onResult?.(entry, out.length, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
  return out;
}

export function scoreAll(entries, addressCol) {
  return entries.filter((e) => e.result).map((e) => scoreRow({ ...e.row, id: e.id, input: e.row[addressCol] }, e.result));
}

const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(0)}%`);
const cell = (rt) => (rt && rt.n ? `${pct(rt.rate)}<span class="ci">${pct(rt.ci[0])}–${pct(rt.ci[1])} · n ${rt.n}</span>` : '—');

export function renderReport(scored) {
  if (!scored.length) return '';
  const rep = report(scored);
  const head = `<tr><th>Arm</th>${BUCKETS.map((b) => `<th title="${esc(b.label)}">${esc(b.id.replace('_', ' '))}</th>`).join('')}</tr>`;
  const loc = rep.map((a) => `<tr><td>${esc(armLabel(a.arm))}</td>${BUCKETS.map((b) => `<td>${cell(a.summary.buckets[b.id])}</td>`).join('')}</tr>`).join('');
  const parse = rep.map((a) => {
    const s = a.summary;
    return `<tr><td>${esc(armLabel(a.arm))}</td><td>${cell(s.compliance)}</td><td>${cell(s.fields.structure_number)}</td><td>${cell(s.fields.street_name)}</td>
      <td>${cell(s.fields.missing)}</td><td>${s.flags.recall === null ? '—' : `${pct(s.flags.recall)}<span class="ci">P ${pct(s.flags.precision)}</span>`}</td>
      <td>${cell(s.wrongButConfident)}</td></tr>`;
  }).join('');
  const ops = rep.map((a) => {
    const s = a.summary;
    return `<tr><td>${esc(armLabel(a.arm))}</td><td>${cell(s.censusFirstHit)}</td><td>${cell(s.fallback)}</td><td>${cell(s.disagreement)}</td>
      <td>${s.sourceTextFailureRate === null ? '—' : pct(s.sourceTextFailureRate)}</td>
      <td>${s.cost.per1000 === null || a.arm.startsWith('rules') ? '—' : `$${s.cost.per1000.toFixed(2)}`}</td><td>${fmtMs(s.latency.p50)}<span class="ci">p95 ${fmtMs(s.latency.p95)}</span></td></tr>`;
  }).join('');
  const tags = [...new Set(rep.flatMap((a) => Object.keys(a.byTag)))].sort();
  const tagRows = tags.map((t) => `<tr><td>${esc(t)}</td>${rep.map((a) => {
    const s = a.byTag[t];
    return `<td>${s ? `${pct(s.compliance.rate)}<span class="ci">unit ${pct(s.buckets.unit.rate)} · n ${s.n}</span>` : '—'}</td>`;
  }).join('')}</tr>`).join('');
  return `
    <h3>Where the point lands</h3>
    <table><thead>${head}</thead><tbody>${loc}</tbody></table>
    <p class="note">Unit ≤50 m, neighborhood ≤500 m of the true point. Rates with 95% Wilson intervals.</p>
    <h3>Reading the address</h3>
    <table><thead><tr><th>Arm</th><th>Compliance</th><th>Number</th><th>Street</th><th>Missing</th><th>Flag recall</th><th title="Wrong field or wrong area, yet reported compliant">Confident wrong</th></tr></thead><tbody>${parse}</tbody></table>
    <h3>Operations</h3>
    <table><thead><tr><th>Arm</th><th>Census first</th><th>Fallback</th><th>Disagree</th><th title="Model parts not found in the input">Invented</th><th>$ / 1,000</th><th>Latency</th></tr></thead><tbody>${ops}</tbody></table>
    ${tags.length > 1 ? `<details><summary class="small">By mutation type (compliance accuracy)</summary><table><thead><tr><th>Tag</th>${rep.map((a) => `<th>${esc(armLabel(a.arm))}</th>`).join('')}</tr></thead><tbody>${tagRows}</tbody></table></details>` : ''}`;
}

function armLabel(arm) {
  const [mode, provider, model] = arm.split(' · ');
  return [MODES[mode]?.label ?? mode, model !== '—' ? model : ''].filter(Boolean).join(' · ');
}

export function renderBatchList(entries, filter) {
  const list = entries.filter((e) => filter === 'All' || (e.error ? filter === 'Errors' : filter === 'Not located' ? e.result.location === 'none' : e.result.compliance === filter));
  return list.slice(0, 500).map((e) => {
    const idx = entries.indexOf(e);
    if (e.error) return `<div class="brow" data-idx="${idx}"><div><div class="in">${esc(e.row ? Object.values(e.row)[0] : '')}</div><div class="tag">${esc(MODES[e.mode]?.label)} · error</div></div><div class="st">${esc(e.error.slice(0, 60))}</div></div>`;
    const r = e.result;
    return `<div class="brow" data-idx="${idx}"><div><div class="in" title="${esc(r.input)}">${esc(r.input)}</div><div class="tag">${esc(e.id)} · ${esc(MODES[r.mode]?.label)}${r.cost ? ` · ${fmtCost(r.cost)}` : ''}</div></div>
      <div class="st"><span class="sv">${esc(r.compliance)}</span><span class="tag">${esc(r.location_label)}</span></div></div>`;
  }).join('') + (list.length > 500 ? `<div class="brow"><div class="tag">Showing 500 of ${list.length}. Export for the rest.</div></div>` : '');
}

export const FILTERS = ['All', 'Compliant', 'Compliant with warnings', 'Not compliant', 'Needs review', 'Postal only', 'Not located', 'Errors'];
