// Verification gate: nothing the model says reaches the record until it passes here.
// Checks: schema, source text really in the input, vocabulary, and consistency with the rule parser.

import { INTERPRETATION_SCHEMA, validate, normalizeEnums } from './schema.js';
import { locateSourceText, sameValue, squash, canonical } from './text.js';
import { findMunicipio, STREET_TYPES, isPrZip, MUNICIPIOS, findPostalPlace } from './vocab.js';
import { isKnownBarrio } from './barrios.js';

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
      // The source text is verified but the value is not a reading of it (a garbled ZIP, a place "corrected" to
      // its municipio). Rebuild the value from what was typed when that can be done by rule; otherwise drop it.
      const rebuilt = valueFromSource(comp.name, c.source_text);
      if (!rebuilt) { dropped.push({ component: c, reason: 'VALUE_NOT_IN_SOURCE' }); continue; }
      dropped.push({ component: c, reason: 'VALUE_NOT_IN_SOURCE', salvaged: true });
      comp.value = rebuilt;
      if (comp.name === 'city') comp.role = findMunicipio(rebuilt) ? (comp.role === 'municipality' ? 'municipality' : 'unknown') : 'postal_city';
    }
    if (comp.name === 'km_hm') comp.value = normalizeKm(comp.value) ?? normalizeKm(c.source_text) ?? comp.value;
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

  // A place the model called a barrio without "Bo." that is no barrio but a known postal place is a postal city.
  for (const c of components) {
    if (c.name === 'barrio' && !/\b(bo|barrio)\b/i.test(fold(c.source_text)) && !isKnownBarrio(c.value) && findPostalPlace(c.value)) {
      c.name = 'city'; c.role = 'postal_city'; c.value = findPostalPlace(c.value).name;
    }
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

  // The class follows the verified parts. The model's label stands only where structure cannot decide
  // (directions, not an address, a complex without a street).
  const has = (n) => components.some((c) => c.name === n);
  let addressClass = modelData.address_class;
  if (has('postal_box')) addressClass = has('street_name') || has('route_number') ? 'mixed' : 'postal_only';
  else if (has('structure_number') && (has('street_name') || has('route_number'))) addressClass = has('route_number') && !has('street_type') ? 'physical_rural' : 'physical_urban';
  else if (has('route_number') || has('km_hm')) addressClass = addressClass === 'descriptive' ? 'descriptive' : 'physical_rural';
  else if (addressClass === 'postal_only' || addressClass === 'mixed') addressClass = 'ambiguous';
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
    address_class: addressClass,
    model_class: modelData.address_class,
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

/** Standard form of a part computed from its own typed text, for parts where a rule can do it. */
export function valueFromSource(name, sourceText) {
  const t = squash(sourceText);
  switch (name) {
    case 'zip': return /\b(00[679]\d{2})/.exec(t)?.[1] ?? null;
    case 'structure_number': return /^#?\s*[a-z0-9-]+$/i.test(t) ? t.replace(/^#\s*/, '').toUpperCase() : null;
    case 'km_hm': return normalizeKm(t);
    case 'street_name': case 'city': return titleCase(t);
    case 'urbanization': case 'barrio': case 'sector': case 'complex':
      return titleCase(t.replace(/^(urb\.?|urbanizaci[oó]n|bo\.?|barrio|sector|sect\.?|res\.?|residencial|cond\.?|condominio)\s+/i, ''));
    default: return null;
  }
}

/** "Km. 10.H 5", "10 Hm 5", "156 Hm 0" -> "10.5", "156.0"; "27.4" stays. */
export function normalizeKm(s) {
  const m = /(\d+(?:[.,]\d+)?)\s*\.?\s*(?:h\.?\s*m?\.?\s*(\d+))?/i.exec(String(s ?? ''));
  if (!m) return null;
  const km = m[1].replace(',', '.');
  if (m[2] !== undefined && !km.includes('.')) return `${km}.${m[2].slice(0, 1)}`;
  return km;
}

function valueFitsSource(c) {
  const v = canonical(c.value);
  const s = canonical(c.source_text);
  if (!v) return false;
  // Numbers must be the whole typed number, not part of it: "A10" is not "10".
  if (c.name === 'structure_number') {
    const strip = (x) => canonical(x).replace(/^(no|num|numero|nº)\s+/, '').replace(/[\s#-]/g, '');
    return strip(c.value) === strip(c.source_text);
  }
  if (c.name === 'zip') return String(c.value).replace(/\D/g, '').slice(0, 5) === String(c.source_text).replace(/\D/g, '').slice(0, 5);
  if (c.name === 'km_hm') return normalizeKm(c.value) === normalizeKm(c.source_text);
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
