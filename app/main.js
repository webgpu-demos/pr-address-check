// App wiring: panels, settings, single validation, batch runs and the review queue.

import { createGis } from '../core/gis/tigerweb.js';
import { arcgisJson, jsonp, fetchJson } from '../core/geocode/transport.js';
import { censusGeocode } from '../core/geocode/census.js';
import { esriGeocode } from '../core/geocode/esri.js';
import { validateAddress, MODES } from '../core/pipeline.js';
import { createProvider, PROVIDERS } from '../core/providers/index.js';
import { MUNICIPIOS, SCHEMA_REQUIRED, FIELD_LABELS } from '../core/vocab.js';
import { parseCsvObjects, toCsv, guessAddressColumn } from '../core/csv.js';
import { hash } from '../core/text.js';
import { PROMPT_VERSION } from '../core/schema.js';
import * as S from './settings.js';
import { createMap } from './map.js';
import { renderResult, esc, fmtCost } from './render.js';
import { runBatch, scoreAll, renderReport, renderBatchList, FILTERS, RESULT_COLUMNS, resultRow, hasLabels } from './batch.js';
import { addToQueue, renderQueue, exportCases, clearQueue, queueSize } from './review.js';
import { report } from '../core/score.js';

const $ = (id) => document.getElementById(id);
const settings = S.loadSettings();
const esriKey = S.getEsriKey();

await Promise.all(['calcite-shell', 'calcite-select', 'calcite-text-area', 'calcite-segmented-control', 'calcite-input-text',
  'calcite-input-number', 'calcite-switch', 'calcite-checkbox', 'calcite-button', 'calcite-panel', 'calcite-action'].map((t) => customElements.whenDefined(t)));

// ---------- helpers ----------
function alertMsg(title, msg, kind = 'danger') {
  const a = $('alert');
  a.kind = kind;
  $('alert-title').textContent = title;
  $('alert-msg').textContent = msg;
  a.open = false;
  requestAnimationFrame(() => { a.open = true; });
}
function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function semaphore(n) {
  let active = 0; const queue = [];
  const next = () => { if (active >= n || !queue.length) return; active++; const { fn, res, rej } = queue.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

// ---------- data services ----------
// One geocode cache for the session, shared by every mode, so modes reuse identical calls.
const geoCache = new Map();
const censusLimit = semaphore(3);
const esriLimit = semaphore(6);
function cached(provider, q, fn) {
  const k = `${provider}|${q.toLowerCase()}`;
  if (!geoCache.has(k)) geoCache.set(k, fn().catch((err) => { geoCache.delete(k); throw err; }));
  return geoCache.get(k);
}
const geocoders = {
  census: (q) => cached('census', q, () => censusLimit(() => censusGeocode(q, { transport: (url) => jsonp(url, { timeoutMs: 15000 }) }))),
  esri: (q) => cached('esri', q, () => esriLimit(() => esriGeocode(q, { transport: (url) => fetchJson(url, { timeoutMs: 15000 }), token: esriKey || undefined }))),
};

let coordFmt = null;
let PointCls = null;
async function usng(lat, lon) {
  if (!coordFmt) {
    [coordFmt, PointCls] = await $arcgis.import(['@arcgis/core/geometry/coordinateFormatter.js', '@arcgis/core/geometry/Point.js']);
    await coordFmt.load();
  }
  return coordFmt.toUsng(new PointCls({ latitude: lat, longitude: lon }), 5, true) ?? '';
}

let mapApi = null;
const gis = createGis({
  transport: (url) => arcgisJson(url, { timeoutMs: 90000 }),
  onProgress: (key, n) => {
    updateBounds();
    if (n > 0 && mapApi) mapApi.addBoundaries(gis);
  },
});
function updateBounds() {
  const st = gis.status();
  const names = { municipio: 'municipios', barrio: 'barrios', zcta: 'ZIP areas' };
  const done = Object.entries(st.loaded).filter(([, n]) => n > 0);
  const failed = Object.keys(st.failed);
  const nav = $('nav-bounds');
  nav.className = `nav-bounds ${failed.length ? 'bad' : done.length === 3 ? 'ok' : ''}`;
  nav.textContent = failed.length ? 'Boundaries: server lookups' : done.length === 3 ? 'Boundaries ready' : `Boundaries ${done.length}/3`;
  $('bounds-status').innerHTML = Object.entries(st.loaded).map(([k, n]) => `${names[k]}: ${n ? `${n} loaded` : st.failed[k] ? `bulk load failed, using per-point server queries (${esc(st.failed[k])})` : 'loading…'}`).join('<br>');
}

function currentProvider() {
  const id = settings.provider;
  const info = PROVIDERS[id];
  if (!info || !['ready', 'experimental'].includes(info.status)) return null;
  const apiKey = S.getKey(id);
  if (!apiKey) return null;
  try {
    return createProvider(id, { apiKey, model: settings.models[id] || info.defaultModel, resource: settings.resource });
  } catch { return null; }
}
function pipelineSettings() {
  return { required: settings.required, allowMapFill: settings.allowMapFill, priceOverrides: settings.priceOverrides };
}

// ---------- panels ----------
const panels = ['validate', 'batch', 'review', 'layers', 'settings'];
function showPanel(name) {
  for (const p of panels) $(`panel-${p}`).hidden = p !== name;
  for (const a of $('actions').querySelectorAll('calcite-action')) a.active = a.dataset.panel === name;
  $('side').collapsed = false;
  if (name === 'review') renderQueue($('rev-list'), { onOpen: openReviewItem });
}
$('actions').addEventListener('click', (e) => {
  const a = e.target.closest('calcite-action');
  if (a?.dataset.panel) showPanel(a.dataset.panel);
});
function updateReviewIndicator() { $('action-review').indicator = queueSize() > 0; }

// ---------- map ----------
mapApi = await createMap($('map'), {
  hasEsriKey: Boolean(esriKey),
  onPick: (pt) => { $('pick-banner').hidden = true; rerunWithPoint(pt); },
  onBatchSelect: (idx) => openBatchEntry(idx),
});
mapApi.setBasemap(settings.basemap);
for (const o of $('basemap').querySelectorAll('calcite-option')) o.selected = o.value === settings.basemap;
gis.preload();
updateBounds();

$('basemap').addEventListener('calciteSelectChange', (e) => {
  const v = e.target.value;
  if (v === 'imagery' && !esriKey) alertMsg('Imagery needs an Esri key', 'Add a referrer-limited key in Settings. Showing the light basemap.', 'warning');
  settings.basemap = v; S.saveSettings(settings);
  mapApi.setBasemap(v);
});
for (const sw of document.querySelectorAll('[data-layer]')) {
  sw.addEventListener('calciteSwitchChange', () => mapApi.setLayerVisible(sw.dataset.layer, sw.checked));
}

// ---------- validate ----------
const addrEl = $('addr');
const modeEl = $('mode');
const muniEl = $('form-muni');
muniEl.innerHTML = `<calcite-option value="">Not set</calcite-option>${MUNICIPIOS.map((m) => `<calcite-option value="${esc(m.name)}">${esc(m.name)}</calcite-option>`).join('')}`;
for (const item of modeEl.querySelectorAll('calcite-segmented-control-item')) item.checked = item.value === settings.mode;

let current = null; // { result, key }
const keyOf = () => hash(`${modeEl.value}|${muniEl.value}|${String(addrEl.value).trim()}`);

function showResult(r, key) {
  current = { result: r, key };
  $('empty').hidden = true;
  const box = $('result');
  box.hidden = false;
  box.innerHTML = renderResult(r, { required: settings.required });
  box.style.opacity = '';
  mapApi.showResult(r);
  $('act-pick').addEventListener('click', () => { mapApi.startPick(); $('pick-banner').hidden = false; });
  $('act-review').addEventListener('click', () => { addToQueue(r); updateReviewIndicator(); alertMsg('Added to review', 'Open the Review panel to record a decision.', 'success'); });
  $('act-copy').addEventListener('click', () => navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).then(() => alertMsg('Copied', 'Result JSON is on the clipboard.', 'success')));
  box.querySelector('#cands')?.addEventListener('click', (e) => {
    const i = e.target.closest('[data-cand]')?.dataset.cand;
    if (i !== undefined) mapApi.zoomToCandidate(r.candidates[Number(i)]);
  });
}

// No result outlives its input: once the address, municipality or mode changes, the old result is marked stale.
function checkStale() {
  if (!current) return;
  const stale = current.key !== keyOf();
  const box = $('result');
  box.style.opacity = stale ? '0.5' : '';
  const banner = box.querySelector('#stale');
  if (banner) banner.hidden = !stale;
  mapApi.showResult(stale ? null : current.result);
}
addrEl.addEventListener('calciteTextAreaInput', checkStale);
muniEl.addEventListener('calciteSelectChange', checkStale);
modeEl.addEventListener('calciteSegmentedControlChange', () => {
  settings.mode = modeEl.value; S.saveSettings(settings);
  checkStale();
});

let running = null;
async function validate({ manualPoint = null, reuse = null } = {}) {
  const input = String(addrEl.value ?? '').trim();
  if (!input) { addrEl.setFocus?.(); return; }
  const mode = modeEl.value;
  const provider = MODES[mode].usesModel ? currentProvider() : null;
  if (MODES[mode].usesModel && !provider) {
    alertMsg('No model set', `${MODES[mode].label} needs a provider, model and key. Add them in Settings, or switch to Rules only.`, 'warning');
    showPanel('settings');
    return;
  }
  running?.abort();
  const ctrl = new AbortController();
  running = ctrl;
  const key = keyOf();
  const go = $('go');
  go.loading = true; go.disabled = true;
  try {
    const r = await validateAddress(input, {
      mode, provider, geocoders, gis, usng, settings: pipelineSettings(), signal: ctrl.signal,
      formMunicipio: muniEl.value, manualPoint,
      priorModel: reuse?.mode === 'ai_first' && reuse.gate?.raw ? { data: reuse.gate.raw, model: reuse.model } : null,
      priorReview: reuse?.mode === 'ai_after' && reuse.review && !reuse.review.error ? { data: reuse.review, model: reuse.model } : null,
    });
    if (ctrl.signal.aborted) return;
    showResult(r, key);
  } catch (err) {
    if (!ctrl.signal.aborted) alertMsg('Validation failed', String(err.message ?? err));
  } finally {
    if (running === ctrl) { go.loading = false; go.disabled = false; running = null; }
  }
}
$('go').addEventListener('click', () => validate());
addrEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); validate(); } });
$('pick-cancel').addEventListener('click', () => { mapApi.cancelPick(); $('pick-banner').hidden = true; });
function rerunWithPoint(pt) {
  if (!current || current.key !== keyOf()) { alertMsg('Run the address first', 'Picking a spot re-checks the current result.', 'warning'); return; }
  validate({ manualPoint: pt, reuse: current.result });
}

// ---------- batch ----------
let csv = null;
let entries = [];
let scored = [];
let batchCtrl = null;
let filter = 'All';

$('csv-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { alertMsg('File too large', 'Keep batch files under 20 MB.'); return; }
  csv = parseCsvObjects(await file.text());
  if (!csv.rows.length) { alertMsg('Empty file', 'No rows found in that CSV.'); return; }
  const guess = guessAddressColumn(csv.header, csv.rows);
  $('csv-col').innerHTML = csv.header.map((h) => `<calcite-option value="${esc(h)}" ${h === guess ? 'selected' : ''}>${esc(h)}</calcite-option>`).join('');
  $('csv-limit').value = String(Math.min(csv.rows.length, 200));
  $('csv-map').hidden = false;
  $('csv-info').textContent = `${csv.rows.length} rows · ${hasLabels(csv.header) ? 'labeled: each run will be scored' : 'no expected_* columns: results only'}`;
});

$('batch-run').addEventListener('click', async () => {
  if (!csv) return;
  const modes = [...document.querySelectorAll('#csv-map calcite-checkbox[data-mode]')].filter((c) => c.checked).map((c) => c.dataset.mode);
  if (!modes.length) { alertMsg('Pick a mode', 'Choose at least one mode to run.', 'warning'); return; }
  const provider = modes.some((m) => MODES[m].usesModel) ? currentProvider() : null;
  if (modes.some((m) => MODES[m].usesModel) && !provider) { alertMsg('No model set', 'AI modes need a provider, model and key in Settings.', 'warning'); showPanel('settings'); return; }
  const addressCol = $('csv-col').value;
  const idCol = csv.header.find((h) => /^id$/i.test(h)) ?? '';
  const limit = Math.max(1, Math.min(csv.rows.length, Number($('csv-limit').value) || csv.rows.length));
  const rows = csv.rows.slice(0, limit);
  entries = []; scored = []; filter = 'All';
  batchCtrl = new AbortController();
  const runCache = new Map();
  $('batch-run').disabled = true; $('batch-stop').disabled = false;
  $('batch-progress').hidden = false; $('batch-out').hidden = false;
  $('batch-report').innerHTML = '';
  let cost = 0; let errors = 0; let lastPaint = 0;
  const started = Date.now();
  const runOne = (input, mode, signal) => {
    // Identical inputs in one run are answered once per mode, so duplicates are not billed twice.
    const k = `${mode}|${input.trim().toLowerCase()}`;
    if (!runCache.has(k)) {
      runCache.set(k, validateAddress(input, { mode, provider: MODES[mode].usesModel ? provider : null, geocoders, gis, usng, settings: pipelineSettings(), signal }));
    }
    return runCache.get(k);
  };
  try {
    entries = await runBatch({
      rows, addressCol, idCol, modes, concurrency: settings.concurrency, signal: batchCtrl.signal, runOne,
      onResult: (entry, done, total) => {
        entries.push(entry);
        if (entry.result?.cost) cost += entry.result.cost;
        if (entry.error) errors++;
        $('batch-bar').value = Math.round((done / total) * 100);
        const rate = done / Math.max(1, (Date.now() - started) / 1000);
        $('batch-status').textContent = `${done} / ${total} · ${fmtCost(cost)} · ${errors} errors · ${rate.toFixed(1)}/s`;
        if (Date.now() - lastPaint > 600) { lastPaint = Date.now(); paintBatch(); }
      },
    });
  } finally {
    $('batch-run').disabled = false; $('batch-stop').disabled = true;
    if (hasLabels(csv.header)) scored = scoreAll(entries, addressCol);
    paintBatch();
    $('batch-report').innerHTML = renderReport(scored);
    mapApi.showBatch(entries);
    showLegend();
  }
});
$('batch-stop').addEventListener('click', () => batchCtrl?.abort());

function paintBatch() {
  const counts = Object.fromEntries(FILTERS.map((f) => [f, 0]));
  for (const e of entries) {
    counts.All++;
    if (e.error) { counts.Errors++; continue; }
    if (counts[e.result.compliance] !== undefined) counts[e.result.compliance]++;
    if (e.result.location === 'none') counts['Not located']++;
  }
  $('batch-filter').innerHTML = FILTERS.filter((f) => f === 'All' || counts[f]).map((f) => `<button type="button" role="tab" aria-selected="${f === filter}" data-f="${esc(f)}">${esc(f === 'Compliant with warnings' ? 'Warnings' : f)}<span class="n">${counts[f]}</span></button>`).join('');
  $('batch-list').innerHTML = renderBatchList(entries, filter);
}
$('batch-filter').addEventListener('click', (e) => {
  const f = e.target.closest('[data-f]')?.dataset.f;
  if (f) { filter = f; paintBatch(); }
});
$('batch-list').addEventListener('click', (e) => {
  const idx = e.target.closest('[data-idx]')?.dataset.idx;
  if (idx !== undefined) openBatchEntry(Number(idx));
});
function openBatchEntry(idx) {
  const e = entries[idx];
  if (!e?.result) return;
  addrEl.value = e.result.input;
  for (const item of modeEl.querySelectorAll('calcite-segmented-control-item')) item.checked = item.value === e.result.mode;
  muniEl.value = '';
  showPanel('validate');
  showResult(e.result, keyOf());
}
function showLegend() {
  const el = $('map-legend');
  el.hidden = !entries.length;
  el.innerHTML = [['Compliant', 'background:#1d5fbf'], ['With warnings', 'border:2px solid #1d5fbf;background:#fff'], ['Not compliant', 'background:#141414'], ['Needs review', 'background:#b4361d']]
    .map(([l, s]) => `<div><i style="${s};border-radius:50%"></i>${l}</div>`).join('');
}
$('exp-results').addEventListener('click', () => download(`results-${stamp()}.csv`, toCsv(entries.filter((e) => e.result).map((e) => resultRow(e.id, e.result)), RESULT_COLUMNS)));
$('exp-scored').addEventListener('click', () => { if (!scored.length) { alertMsg('Nothing scored', 'Scoring needs expected_* columns in the CSV.', 'warning'); return; } download(`scored-${stamp()}.csv`, toCsv(scored)); });
$('exp-report').addEventListener('click', () => download(`report-${stamp()}.json`, JSON.stringify({ prompt_version: PROMPT_VERSION, created: new Date().toISOString(), arms: report(scored) }, null, 2), 'application/json'));

// ---------- review ----------
function openReviewItem(it) {
  addrEl.value = it.input;
  for (const item of modeEl.querySelectorAll('calcite-segmented-control-item')) item.checked = item.value === it.mode;
  showPanel('validate');
  checkStale();
}
$('rev-export').addEventListener('click', () => download(`reviewed-cases-${stamp()}.csv`, exportCases()));
$('rev-clear').addEventListener('click', () => { clearQueue(); renderQueue($('rev-list'), { onOpen: openReviewItem }); updateReviewIndicator(); });
updateReviewIndicator();

// ---------- settings ----------
const provEl = $('set-provider');
provEl.innerHTML = Object.entries(PROVIDERS).map(([id, p]) => `<calcite-option value="${id}" ${id === settings.provider ? 'selected' : ''} ${['backend', 'planned'].includes(p.status) ? 'disabled' : ''}>${esc(p.label)}${p.status === 'experimental' ? ' (experimental)' : p.status === 'backend' ? ' (backend only)' : p.status === 'planned' ? ' (not yet)' : ''}</calcite-option>`).join('');

function paintProvider() {
  const id = settings.provider;
  const p = PROVIDERS[id];
  const model = settings.models[id] || p.defaultModel || '';
  $('set-provider-note').textContent = p.note ?? '';
  $('set-model').value = model;
  $('set-model-list').innerHTML = (p.models ?? []).map((m) => `<button type="button" data-model="${esc(m)}">${esc(m)}</button>`).join('');
  $('set-resource-wrap').hidden = !p.needsResource;
  $('set-resource').value = settings.resource ?? '';
  $('set-key').value = S.getKey(id);
  const price = S.priceFor(settings, id, model);
  $('set-price-in').value = price ? String(price.input) : '';
  $('set-price-out').value = price ? String(price.output) : '';
  $('set-test-out').textContent = '';
  const nav = $('nav-model');
  const ok = Boolean(S.getKey(id));
  nav.textContent = ok ? `${p.label} · ${model}` : 'No model set';
  $('action-settings').indicator = !ok;
}
provEl.addEventListener('calciteSelectChange', () => { settings.provider = provEl.value; S.saveSettings(settings); paintProvider(); });
$('set-model').addEventListener('calciteInputTextChange', (e) => { settings.models[settings.provider] = e.target.value.trim(); S.saveSettings(settings); paintProvider(); });
$('set-model-list').addEventListener('click', (e) => {
  const m = e.target.dataset.model;
  if (m) { settings.models[settings.provider] = m; S.saveSettings(settings); paintProvider(); }
});
$('set-resource').addEventListener('calciteInputTextChange', (e) => { settings.resource = e.target.value.trim(); S.saveSettings(settings); });
$('set-key').addEventListener('calciteInputTextChange', (e) => { S.setKey(settings.provider, e.target.value.trim()); paintProvider(); });
$('set-key-forget').addEventListener('click', () => { S.setKey(settings.provider, ''); paintProvider(); });
const savePrice = () => {
  const id = settings.provider; const model = settings.models[id] || PROVIDERS[id].defaultModel;
  const input = Number($('set-price-in').value); const output = Number($('set-price-out').value);
  if (Number.isFinite(input) && Number.isFinite(output) && $('set-price-in').value !== '') {
    settings.priceOverrides[`${id}:${model}`] = { input, output, cacheRead: input * 0.1, cacheWrite: input * 1.25 };
    S.saveSettings(settings);
  }
};
$('set-price-in').addEventListener('calciteInputNumberChange', savePrice);
$('set-price-out').addEventListener('calciteInputNumberChange', savePrice);
$('set-test').addEventListener('click', async () => {
  const out = $('set-test-out');
  const provider = currentProvider();
  if (!provider) { out.textContent = 'Set a key first.'; return; }
  out.textContent = 'Calling…';
  try {
    const r = await provider.callJson({
      system: 'Answer with {"ok": true}.', user: 'ping', schemaName: 'ping',
      schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    out.textContent = `OK · ${r.model} · ${r.latencyMs} ms · ${r.usage.input + r.usage.cacheRead} in / ${r.usage.output} out`;
  } catch (err) { out.textContent = `Failed: ${err.message}`; }
});
$('set-conc').value = String(settings.concurrency);
$('set-conc').addEventListener('calciteInputNumberChange', (e) => { settings.concurrency = Math.max(1, Math.min(16, Number(e.target.value) || 4)); S.saveSettings(settings); });
$('set-required').innerHTML = SCHEMA_REQUIRED.map((f) => `<calcite-label layout="inline"><calcite-checkbox data-req="${f}" ${settings.required.includes(f) ? 'checked' : ''}></calcite-checkbox>${esc(FIELD_LABELS[f])}</calcite-label>`).join('');
$('set-required').addEventListener('calciteCheckboxChange', () => {
  settings.required = [...$('set-required').querySelectorAll('calcite-checkbox')].filter((c) => c.checked).map((c) => c.dataset.req);
  S.saveSettings(settings); checkStale();
});
$('set-mapfill').checked = settings.allowMapFill;
$('set-mapfill').addEventListener('calciteSwitchChange', (e) => { settings.allowMapFill = e.target.checked; S.saveSettings(settings); });
$('set-esri').value = esriKey;
$('set-esri-apply').addEventListener('click', () => { S.setEsriKey(String($('set-esri').value ?? '').trim()); location.reload(); });
paintProvider();

// Open on Settings the first time, so AI modes have what they need.
if (!S.getKey(settings.provider) && settings.mode !== 'rules') showPanel('settings');
