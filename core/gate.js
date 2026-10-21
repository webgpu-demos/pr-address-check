// Verification gate: nothing the model says reaches the record until it passes here.
// Checks: schema, source text really in the input, vocabulary, and consistency with the rule parser.

import { INTERPRETATION_SCHEMA, validate, normalizeEnums } from './schema.js';
import { locateSourceText, sameValue, squash, canonical } from './text.js';
import { findMunicipio, STREET_TYPES, isPrZip, MUNICIPIOS } from './vocab.js';

const MUNICIPIO_WORDS = MUNICIPIOS.map((m) => m.key);
import { fold } from './text.js';
import { derivedFlags, mergeFlags, DERIVED } from './flags.js';
import { titleCase } from './rules.js';

const KEY_FIELDS = ['structure_number', 'street_name', 'zip', 'city', 'urbanization', 'barrio'];
const MAX_VALUE = 120;

export function runGate(input, rawModelData, rulesParse) {
  const modelData = normalizeEnums(INTERPRETATION_SCHEMA, rawModelData);
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
    if (!valueFitsSource(comp)) {
      // A place name the model "corrected" (Río Piedras -> San Juan) keeps what was typed, as a postal city.
      if (comp.name === 'city') {
        dropped.push({ component: c, reason: 'VALUE_NOT_IN_SOURCE', salvaged: true });
        comp.value = titleCase(squash(c.source_text));
        comp.role = findMunicipio(comp.value) ? (comp.role === 'municipality' ? 'municipality' : 'unknown') : 'postal_city';
      } else { dropped.push({ component: c, reason: 'VALUE_NOT_IN_SOURCE' }); continue; }
    }
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

  // A lone municipio name is not known to be a postal city; only the point can say that.
  const cities = components.filter((c) => c.name === 'city');
  if (cities.length === 1 && cities[0].role === 'postal_city' && findMunicipio(cities[0].value)) cities[0].role = 'unknown';
  // "Municipality" needs the text to say so ("X Municipio") or a second place to contrast with.
  for (const c of cities) {
    if (c.role === 'municipality' && !/municipio/i.test(c.source_text) && cities.length === 1) c.role = 'unknown';
  }

  // Structural flags come from code over the verified parts; the model's flags must agree or are set aside.
  const derived = derivedFlags(input, components);
  const droppedFlags = [];
  const modelFlags = [];
  for (const f of modelData.flags) {
    const ok = DERIVED.has(f.code) ? derived.some((d) => d.code === f.code) : flagSupported(f.code, components);
    if (ok) modelFlags.push({ ...f, source: 'model' }); else droppedFlags.push(f);
  }
  const flags = mergeFlags(derived, modelFlags);
  const zip = components.find((c) => c.name === 'zip');
  if (zip && !isPrZip(zip.value) && !flags.some((f) => f.code === 'ZIP_OUT_OF_RANGE')) {
    flags.push({ code: 'ZIP_OUT_OF_RANGE', note: 'The ZIP is not a Puerto Rico ZIP.', source: 'gate' });
  }

  const disagreements = compareParses(components, rulesParse?.components ?? []);
  const total = modelData.components.length;
  const hardDrops = dropped.filter((d) => !d.salvaged).length;
  const ok = components.length > 0 && hardDrops <= Math.max(1, Math.floor(total / 3));
  return {
    ok,
    reason: ok ? '' : (components.length ? 'TOO_MANY_DROPPED' : 'NOTHING_VERIFIED'),
    errors: [],
    address_class: modelData.address_class,
    components,
    flags,
    dropped,
    droppedFlags,
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

function flagSupported(code, comps) {
  const get = (n) => comps.filter((c) => c.name === n);
  switch (code) {
    case 'KM_PRESENT': return get('km_hm').length > 0;
    case 'NON_ADDRESS_TEXT': return get('label_text').length > 0;
    case 'STREET_NAMED_AFTER_MUNICIPALITY':
      return get('street_name').some((c) => MUNICIPIO_WORDS.some((m) => ` ${fold(c.value)} `.includes(` ${m} `)));
    case 'AMBIGUOUS_NUMBER': return get('structure_number').some((c) => /[a-z]|-/i.test(c.value));
    case 'UNLABELED_LOCALITY': return get('urbanization').some((c) => !/\b(urb|urbanizaci[oó]n|urbanization)\b/i.test(c.source_text));
    case 'POSTAL_CITY_DIFFERS': return get('city').some((c) => c.role === 'postal_city' || !findMunicipio(c.value)) || get('city').length > 1;
    default: return true;
  }
}
