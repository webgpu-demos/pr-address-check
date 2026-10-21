// Rendering a result: statuses, the annotated address as typed, reasons, the record ledger and folded details.

import { findSpan } from '../core/text.js';
import { FIELD_LABELS } from '../core/vocab.js';
import { MODES } from '../core/pipeline.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHORT = {
  structure_number: 'number', street_type: 'type', street_name: 'street', route_number: 'route', km_hm: 'km',
  unit: 'unit', urbanization: 'urb.', complex: 'complex', sector: 'sector', barrio: 'barrio', city: 'city',
  state: 'state', zip: 'zip', postal_box: 'box', cadastral_id: 'cadastral', label_text: 'label',
};
const ROLE = { municipality: 'municipio', postal_city: 'postal city' };

const COMPLIANCE_CLASS = {
  'Compliant': 's-ok', 'Compliant with warnings': 's-warn', 'Not compliant': 's-block', 'Needs review': 's-review', 'Postal only': 's-postal',
};
const LOCATION_CLASS = { rooftop: 'loc-good', interpolated: 'loc-good', km: 'loc-weak', street: 'loc-weak', area: 'loc-weak', ambiguous: 'loc-bad', conflict: 'loc-bad', outside: 'loc-none', none: 'loc-none' };

/** The input with each recognized part underlined and labeled. Text nobody claimed stays plain. */
export function annotate(input, components) {
  const spans = [];
  for (const c of components) {
    if (c.source === 'form') continue;
    let span = c.span;
    if (!span && c.source_text) span = findSpan(input, c.source_text) ?? findSpan(input, c.value);
    if (!span) continue;
    let label = SHORT[c.name] ?? c.name;
    if (c.name === 'city' && ROLE[c.role]) label = ROLE[c.role];
    spans.push({ s: span[0], e: span[1], name: c.name, label, by: c.source });
  }
  spans.sort((a, b) => a.s - b.s || b.e - a.e);
  const kept = [];
  let end = -1;
  for (const sp of spans) { if (sp.s >= end) { kept.push(sp); end = sp.e; } }
  let html = '';
  let pos = 0;
  for (const sp of kept) {
    if (sp.s > pos) html += `<span class="gap">${esc(input.slice(pos, sp.s))}</span>`;
    const cls = ['seg', sp.name === 'label_text' ? 'label' : '', ['urbanization', 'complex', 'sector', 'barrio'].includes(sp.name) ? 'locality' : '',
      sp.name === 'structure_number' ? 'number' : ''].filter(Boolean).join(' ');
    html += `<span class="${cls}" title="${esc(`${FIELD_LABELS[sp.name] ?? sp.name} · read by ${sp.by}`)}"><span class="t">${esc(input.slice(sp.s, sp.e))}</span><span class="l">${esc(sp.name === 'label_text' ? 'set aside' : sp.label)}</span></span>`;
    pos = sp.e;
  }
  if (pos < input.length) html += `<span class="gap">${esc(input.slice(pos))}</span>`;
  return html || '<span class="gap">(empty)</span>';
}

export const fmtCost = (c) => (c === null || c === undefined ? '—' : c < 0.01 ? `${(c * 100).toFixed(3)}¢` : `$${c.toFixed(4)}`);
export const fmtMs = (ms) => (ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function renderResult(r, { required = [] } = {}) {
  const loc = r.location;
  const typedHtml = annotate(r.input, r.components);
  const missing = new Set(r.missing_required ?? []);

  const reasons = r.reasons.filter((x) => x.severity !== 'info' || x.source === 'model' || ['POSTAL_ONLY', 'GATE_DROPPED', 'MODEL_FALLBACK', 'COARSE_POINT_ELSEWHERE', 'BARRIO_NOT_OFFICIAL'].includes(x.code));
  const reasonHtml = reasons.map((x) => `<li class="r-${x.severity}"><span class="dot"></span><span>${esc(x.text)}<span class="code">${esc(x.code)}</span>${x.maturity === 'experimental' ? '<span class="exp" title="Experimental check: shown, not yet trusted">exp</span>' : ''}</span></li>`).join('');

  const f = r.fields;
  const row = (name, label = FIELD_LABELS[name] ?? name) => {
    const fld = f[name];
    if (!fld) {
      if (missing.has(name)) return `<tr><td>${esc(label)}</td><td class="val missing">Missing</td><td></td></tr>`;
      if (!required.includes(name)) return '';
      return `<tr><td>${esc(label)}</td><td class="val">—</td><td></td></tr>`;
    }
    const typedAs = fld.source === 'map' && fld.typed ? `<div class="typed-as">typed: ${esc(fld.typed)}</div>` : '';
    const miss = missing.has(name) ? ' <span class="src" title="Not typed; shown from the map">not typed</span>' : '';
    return `<tr><td>${esc(label)}</td><td class="val v-${fld.source}">${esc(fld.value)}${typedAs}</td><td><span class="src ${fld.source}" title="${fld.by ? `read by ${esc(fld.by)}` : ''}">${esc(fld.source)}</span>${miss}</td></tr>`;
  };
  const d = (label, value, cls = '') => (value === '' || value === null || value === undefined ? '' : `<tr><td>${esc(label)}</td><td class="val v-${cls}">${esc(value)}</td><td>${cls === 'map' ? '<span class="src map">map</span>' : ''}</td></tr>`);
  const rec = r.record;
  const ledger = `
    <table class="ledger"><thead><tr><th>Field</th><th>Value</th><th>Source</th></tr></thead><tbody>
      ${row('structure_number')}${row('street_type')}${row('street_name')}${f.route_number && !f.street_name ? row('route_number') : ''}${row('km_hm')}${row('unit')}
      ${row('urbanization')}${row('complex')}${row('sector')}${row('barrio')}${row('city')}${row('state')}${row('zip')}${row('postal_box')}
      ${d('Municipality', rec.municipality, 'map')}${d('Municipal FIPS', rec.municipio_fips, 'map')}${d('Municipality type', rec.municipality_type, 'map')}
      ${d('Barrio type', rec.barrio_type, 'map')}${d('ZIP area (ZCTA)', rec.zcta, 'map')}${d('USNG', rec.usng, 'map')}
      ${rec.lat !== '' ? d('Lat, lon', `${rec.lat}, ${rec.lon}`, 'map') : ''}
      ${rec.full_address ? `<tr class="full"><td>Full address</td><td class="val" colspan="2">${esc(rec.full_address)}</td></tr>` : ''}
    </tbody></table>`;

  const prompts = r.user_prompts?.length && r.compliance !== 'Compliant'
    ? `<div class="prompts"><div class="small">Ask the applicant</div>${r.user_prompts.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : '';

  const checks = r.checks.map((c) => `<div class="check"><span class="st ${c.state}">${c.state === 'na' ? 'n/a' : c.state}</span><span>${esc(c.label)}${c.maturity === 'experimental' ? ' <span class="exp src">exp</span>' : ''}${c.detail ? `<div class="d">${esc(c.detail)}</div>` : ''}</span></div>`).join('');

  const queries = (r.queries ?? []).map((q) => `<tr><td>${esc(q.target)} · ${esc(q.origin)}</td><td class="m">${esc(q.query)}</td></tr>`).join('');
  const cands = (r.candidates ?? []).map((c, i) => `<div class="cand ${r.best && c.lon === r.best.lon && c.lat === r.best.lat ? 'best' : ''}" data-cand="${i}">
      <span class="p">${esc(c.provider)} · ${esc(c.addrType || c.precision)} · ${esc(c.origin ?? '')}</span><br>${esc(c.matched)}
      <span class="small"> ${Object.entries(c.consistency ?? {}).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(' ')}</span></div>`).join('') || '<p class="small">No candidates.</p>';
  const geoErr = (r.geocode_errors ?? []).map((e) => `<p class="small">${esc(e.target)}: ${esc(e.error)}</p>`).join('');

  const g = r.gate;
  const model = r.mode === 'rules' ? '<p class="small">Rules only: no model call.</p>' : `
    <table class="kv">
      <tr><td>Provider · model</td><td class="m">${esc(r.provider || '—')} · ${esc(r.model || '—')}</td></tr>
      <tr><td>Prompt version</td><td class="m">${esc(r.prompt_version || '—')}</td></tr>
      <tr><td>Tokens in / out / cached</td><td class="m">${r.usage ? `${r.usage.input} / ${r.usage.output} / ${r.usage.cacheRead}` : '—'}</td></tr>
      <tr><td>Cost · latency</td><td class="m">${fmtCost(r.cost)} · ${fmtMs(r.latency_ms)}</td></tr>
      ${r.fallback?.used ? `<tr><td>Fallback</td><td class="m">${esc(r.fallback.reason)}: ${esc(r.fallback.detail)}</td></tr>` : ''}
      ${g ? `<tr><td>Gate</td><td class="m">${g.ok ? 'passed' : `failed (${esc(g.reason)})`}${g.dropped?.length ? `; set aside: ${g.dropped.map((x) => `${esc(x.component.name)} "${esc(x.component.source_text || x.component.value)}" (${esc(x.reason)})`).join(', ')}` : ''}</td></tr>` : ''}
      ${g?.droppedFlags?.length ? `<tr><td>Flags set aside</td><td class="m">${g.droppedFlags.map((f) => `${esc(f.code)}: ${esc(f.note)}`).join('<br>')}</td></tr>` : ''}
      ${g?.disagreements?.length ? `<tr><td>Model vs rules</td><td class="m">${g.disagreements.map((x) => `${esc(x.name)}: "${esc(x.model)}" vs "${esc(x.rules)}"${(() => { const w = (g.resolved ?? []).find((k) => k.name === x.name); return w ? ` → ${esc(w.winner)}` : ' → open'; })()}`).join('<br>')}</td></tr>` : ''}
      ${r.review ? `<tr><td>Review summary</td><td>${esc(r.review.summary || r.review.error || '')}</td></tr>` : ''}
    </table>
    ${g?.raw ? `<details><summary class="small">Model output</summary><pre class="json">${esc(JSON.stringify(g.raw, null, 2))}</pre></details>` : ''}`;

  const meta = [MODES[r.mode]?.label, r.mode !== 'rules' && r.model ? r.model : '', fmtMs(r.latency_ms), r.cost !== null ? fmtCost(r.cost) : '', r.geocode_stage ? `answered by ${r.geocode_stage}` : ''].filter(Boolean);

  return `
    <div id="stale" class="stale" hidden>The input changed since this result. Run it again.</div>
    <div class="status-row">
      <div class="status ${COMPLIANCE_CLASS[r.compliance] ?? ''}"><div class="k">Compliance, as typed</div><div class="v">${esc(r.compliance)}</div></div>
      <div class="status ${LOCATION_CLASS[loc] ?? ''}"><div class="k">Location</div><div class="v">${esc(r.location_label)}</div></div>
    </div>
    <div class="meta">${meta.map(esc).join('<span>·</span>')}</div>
    <div class="typed" aria-label="Address as typed, annotated">${typedHtml}</div>
    <div class="legend-src"><span>Underlined: read from the input</span><span>Struck: set aside</span></div>
    ${reasonHtml ? `<ul class="reasons">${reasonHtml}</ul>` : ''}
    ${prompts}
    ${ledger}
    <div class="actions-row">
      <calcite-button id="act-pick" icon-start="pin-plus" appearance="outline" kind="neutral" scale="s">Pick the spot on the map</calcite-button>
      <calcite-button id="act-review" icon-start="check-square" appearance="outline" kind="neutral" scale="s">Add to review</calcite-button>
      <calcite-button id="act-copy" icon-start="copy" appearance="transparent" kind="neutral" scale="s">Copy JSON</calcite-button>
    </div>
    <div class="folds">
      <calcite-block heading="Checks" description="${r.checks.filter((c) => c.state === 'fail').length} failed of ${r.checks.filter((c) => c.state !== 'na').length}" expandable><div class="pad0">${checks}</div></calcite-block>
      <calcite-block heading="Geocoding" description="${esc(`${(r.queries ?? []).length} queries · ${(r.candidates ?? []).length} candidates`)}" expandable>
        <table class="kv">${queries}</table>${geoErr}<div id="cands">${cands}</div>
      </calcite-block>
      <calcite-block heading="Model" description="${esc(r.mode === 'rules' ? 'not used' : `${r.provider} · ${r.model}`)}" expandable>${model}</calcite-block>
    </div>`;
}
