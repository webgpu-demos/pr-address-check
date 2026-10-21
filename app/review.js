// Review queue: decisions kept in this browser, exported as labeled test cases.

import { toCsv } from '../core/csv.js';
import { CASE_COLUMNS } from '../core/mutate.js';
import { esc } from './render.js';
import { MODES } from '../core/pipeline.js';

const KEY = 'prac.review.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const write = (items) => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage full or blocked */ } };

export function addToQueue(r) {
  const items = read();
  items.unshift({
    id: `rev-${Date.now().toString(36)}`,
    added: new Date().toISOString(),
    input: r.input,
    mode: r.mode,
    model: r.model,
    compliance: r.compliance,
    location: r.location_label,
    reasons: r.reasons.map((x) => x.code),
    record: r.record,
    point: r.best ? { lat: r.best.lat, lon: r.best.lon, manual: r.best.provider === 'manual' } : null,
    decision: '',
    expected_compliance: '',
    note: '',
  });
  write(items.slice(0, 500));
  return items.length;
}

export const queueSize = () => read().length;

export function renderQueue(el, { onOpen }) {
  const items = read();
  if (!items.length) { el.innerHTML = '<p class="small">Nothing queued. Use “Add to review” on a result.</p>'; return; }
  el.innerHTML = items.map((it, i) => `
    <div class="rev" data-i="${i}">
      <div class="in">${esc(it.input)}</div>
      <div class="meta2">${esc(MODES[it.mode]?.label ?? it.mode)}${it.model ? ` · ${esc(it.model)}` : ''} · said <b>${esc(it.compliance)}</b> · ${esc(it.location)}${it.point?.manual ? ' · point picked by hand' : ''}</div>
      <div class="dec">
        ${it.decision ? `<span class="decided">${esc(it.decision)}</span>` : ''}
        <select data-act="expected" aria-label="Correct compliance">
          <option value="">Correct status…</option>
          ${['Compliant', 'Compliant with warnings', 'Not compliant', 'Needs review', 'Postal only'].map((s) => `<option ${it.expected_compliance === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button type="button" data-act="agree">Agree</button>
        <button type="button" data-act="disagree">Disagree</button>
        <button type="button" data-act="open">Open</button>
        <button type="button" data-act="remove">Remove</button>
      </div>
      <textarea data-act="note" rows="2" placeholder="What is actually right?">${esc(it.note)}</textarea>
    </div>`).join('');
  el.onclick = (e) => {
    const act = e.target.dataset.act;
    const i = Number(e.target.closest('.rev')?.dataset.i);
    if (!act || Number.isNaN(i)) return;
    const list = read();
    if (act === 'remove') list.splice(i, 1);
    else if (act === 'agree') { list[i].decision = 'agree'; list[i].expected_compliance ||= list[i].compliance; }
    else if (act === 'disagree') list[i].decision = 'disagree';
    else if (act === 'open') { onOpen?.(list[i]); return; }
    else return;
    write(list);
    renderQueue(el, { onOpen });
  };
  el.onchange = (e) => {
    const i = Number(e.target.closest('.rev')?.dataset.i);
    const list = read();
    if (e.target.dataset.act === 'expected') list[i].expected_compliance = e.target.value;
    if (e.target.dataset.act === 'note') list[i].note = e.target.value;
    write(list);
  };
}

/** Labeled cases in the same columns tools/make-cases.mjs writes, so they join the suite. */
export function exportCases() {
  const rows = read().filter((it) => it.decision).map((it) => ({
    id: it.id,
    input: it.input,
    tags: 'reviewed',
    expected_compliance: it.expected_compliance || (it.decision === 'agree' ? it.compliance : ''),
    expected_flags: '',
    expected_missing: '',
    expected_structure_number: it.decision === 'agree' ? it.record.structure_number : '',
    expected_street_name: it.decision === 'agree' ? it.record.street_name : '',
    expected_zip: it.decision === 'agree' ? it.record.zip : '',
    expected_municipio: it.decision === 'agree' || it.point?.manual ? it.record.municipality : '',
    expected_barrio: it.decision === 'agree' || it.point?.manual ? it.record.barrio : '',
    expected_lat: it.point && (it.decision === 'agree' || it.point.manual) ? it.point.lat : '',
    expected_lon: it.point && (it.decision === 'agree' || it.point.manual) ? it.point.lon : '',
    note: it.note,
  }));
  return toCsv(rows, [...CASE_COLUMNS, 'note']);
}

export function clearQueue() { write([]); }
