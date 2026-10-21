// Verification gate: nothing the model says reaches the record until it passes here.
// Checks: schema, source text really in the input, vocabulary, and consistency with the rule parser.

import { INTERPRETATION_SCHEMA, validate } from './schema.js';
import { locateSourceText, sameValue, squash, canonical } from './text.js';
import { findMunicipio, STREET_TYPES, isPrZip } from './vocab.js';
import { fold } from './text.js';

const KEY_FIELDS = ['structure_number', 'street_name', 'zip', 'city', 'urbanization', 'barrio'];
const MAX_VALUE = 120;

export function runGate(input, modelData, rulesParse) {
  const errors = validate(INTERPRETATION_SCHEMA, modelData);
  if (errors.length) {
    return { ok: false, reason: 'SCHEMA', errors, components: [], flags: [], dropped: [], disagreements: [] };
  }
  const dropped = [];
  const components = [];
  for (const c of modelData.components) {
    const comp = { ...c, value: squash(c.value), source: 'model', span: null };
    if (!comp.value) { dropped.push({ component: c, reason: 'EMPTY' }); continue; }
    if (comp.value.length > MAX_VALUE) { dropped.push({ component: c, reason: 'TOO_LONG' }); continue; }
    if (c.inferred_from === 'model' || !c.source_text) {
      // The only inference allowed: state PR.
      if (c.name === 'state' && fold(comp.value) === 'pr') { comp.value = 'PR'; comp.source = 'model'; components.push(comp); }
      else dropped.push({ component: c, reason: 'INFERRED' });
      continue;
    }
    const loc = locateSourceText(input, c.source_text);
    if (!loc.found) { dropped.push({ component: c, reason: 'SOURCE_TEXT_NOT_FOUND' }); continue; }
    comp.span = loc.span;
    // The value must be a reading of its own source text, not new content.
    if (!valueFitsSource(comp)) { dropped.push({ component: c, reason: 'VALUE_NOT_IN_SOURCE' }); continue; }
    // Vocabulary.
    if (comp.name === 'street_type') comp.value = STREET_TYPES.get(fold(comp.value).replace(/\.$/, '')) ?? comp.value;
    if (comp.name === 'zip') {
      comp.value = comp.value.replace(/\D/g, '').slice(0, 5);
      if (!/^\d{5}$/.test(comp.value)) { dropped.push({ component: c, reason: 'BAD_ZIP' }); continue; }
    }
    if (comp.name === 'city') {
      const m = findMunicipio(comp.value);
      if (m) comp.value = m.name;
      else if (comp.role === 'municipality') comp.role = 'postal_city'; // not a municipio, so it cannot be the municipality
    }
    if (comp.name === 'state' && /^(pr|p\.?\s?r\.?|puerto rico)$/i.test(comp.value)) comp.value = 'PR';
    components.push(comp);
  }

  const flags = modelData.flags.map((f) => ({ ...f, source: 'model' }));
  const zip = components.find((c) => c.name === 'zip');
  if (zip && !isPrZip(zip.value) && !flags.some((f) => f.code === 'ZIP_OUT_OF_RANGE')) {
    flags.push({ code: 'ZIP_OUT_OF_RANGE', note: 'The ZIP is not a Puerto Rico ZIP.', source: 'gate' });
  }

  const disagreements = compareParses(components, rulesParse?.components ?? []);
  const total = modelData.components.length;
  const ok = components.length > 0 && dropped.length <= Math.max(1, Math.floor(total / 3));
  return {
    ok,
    reason: ok ? '' : (components.length ? 'TOO_MANY_DROPPED' : 'NOTHING_VERIFIED'),
    errors: [],
    address_class: modelData.address_class,
    components,
    flags,
    dropped,
    disagreements,
    geocode_plan: modelData.geocode_plan.filter((q) => q.query && q.query.length < 300).slice(0, 3),
    user_prompts: modelData.user_prompts.slice(0, 6),
    missing_required: modelData.missing_required,
  };
}

function valueFitsSource(c) {
  const v = canonical(c.value);
  const s = canonical(c.source_text);
  if (!v) return false;
  if (s.includes(v) || sameValue(c.value, c.source_text)) return true;
  if (c.name === 'street_type' || c.name === 'state') return true; // standard forms of short tokens
  if (c.name === 'city') return Boolean(findMunicipio(c.value)) && fold(c.source_text).includes(fold(c.value).split(' ')[0].slice(0, 3));
  // Allow token-level matches after canonicalization ("Bo. Jagüeyes" -> "Jagüeyes").
  const sWords = new Set(s.split(' '));
  return v.split(' ').every((w) => sWords.has(w));
}

/** Where the model and the rule parser read the same field differently. */
export function compareParses(modelComps, rulesComps) {
  const out = [];
  for (const name of KEY_FIELDS) {
    const m = pick(modelComps, name);
    const r = pick(rulesComps, name);
    if (!m && !r) continue;
    if (m && r && sameValue(m.value, r.value)) continue;
    if (!m || !r) {
      // One side missing is a disagreement only for the fields that decide location.
      if (!['structure_number', 'street_name', 'city'].includes(name)) continue;
    }
    out.push({ name, model: m?.value ?? '', rules: r?.value ?? '' });
  }
  return out;
}

function pick(comps, name) {
  if (name === 'city') {
    return comps.find((c) => c.name === 'city' && c.role === 'municipality')
      ?? comps.find((c) => c.name === 'city' && c.role !== 'postal_city')
      ?? comps.find((c) => c.name === 'city');
  }
  return comps.find((c) => c.name === name);
}
