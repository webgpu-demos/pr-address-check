// Structural flags computed by code from verified parts, so every mode flags the same input the same way.
// The model's own flags are kept only for what code cannot see (several addresses, outdated names).

import { fold, findSpan } from './text.js';
import { MUNICIPIOS, findMunicipio } from './vocab.js';

export const DERIVED = new Set(['KM_PRESENT', 'NON_ADDRESS_TEXT', 'STREET_NAMED_AFTER_MUNICIPALITY', 'AMBIGUOUS_NUMBER',
  'NONSTANDARD_ORDER', 'UNLABELED_LOCALITY']);

const MUNI_KEYS = MUNICIPIOS.map((m) => m.key);

function spanOf(input, c) {
  return c.span ?? (c.source_text ? findSpan(input, c.source_text) : null);
}

export function derivedFlags(input, comps) {
  const get = (n) => comps.find((c) => c.name === n);
  const out = [];
  const add = (code, note) => out.push({ code, note, source: 'code' });

  const km = get('km_hm');
  if (km) add('KM_PRESENT', `KM ${km.value} is extra detail; the standard expects a structure number.`);

  const label = get('label_text');
  if (label) add('NON_ADDRESS_TEXT', `"${label.value}" is not part of the address.`);

  const street = get('street_name');
  if (street && !get('route_number')) {
    const k = ` ${fold(street.value)} `;
    if (MUNI_KEYS.some((m) => k.includes(` ${m} `))) add('STREET_NAMED_AFTER_MUNICIPALITY', `"${street.value}" is the street, not the municipality.`);
  }

  const num = get('structure_number');
  if (num && (/[a-z]/i.test(num.value) || /-/.test(num.value))) add('AMBIGUOUS_NUMBER', `"${num.value}" could be block and lot, or building and unit.`);

  const streetStart = [get('street_type'), get('route_number'), street].filter(Boolean)
    .map((c) => spanOf(input, c)?.[0]).filter((x) => x !== undefined && x !== null);
  const numSpan = num ? spanOf(input, num) : null;
  if (numSpan && streetStart.length && numSpan[0] > Math.min(...streetStart)) {
    add('NONSTANDARD_ORDER', 'The number follows the street name; the standard puts it first.');
  }

  const urb = get('urbanization');
  if (urb && urb.source_text && !/\b(urb|urbanizaci[oó]n|urbanization)\b/i.test(fold(urb.source_text))) {
    add('UNLABELED_LOCALITY', `"${urb.value}" read as an urbanización; it has no "Urb." marker.`);
  }
  return out;
}

/** Derived flags win; the model's note is kept when it agrees. Model-only codes pass through if supported. */
export function mergeFlags(derived, modelFlags) {
  const out = derived.map((d) => {
    const m = modelFlags.find((f) => f.code === d.code);
    return m ? { ...d, note: m.note || d.note, source: 'model+code' } : d;
  });
  for (const f of modelFlags) if (!DERIVED.has(f.code) && !out.some((o) => o.code === f.code)) out.push(f);
  return out;
}

export { findMunicipio };
