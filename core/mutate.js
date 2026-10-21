// Test-case generator: a correctly located address plus controlled mutations,
// with expected fields and flags known by construction.
// Ground truth columns: id, structure_number, street_type, street_name, unit, urbanization, barrio,
// municipio, zip, lat, lon, postal_city (optional).

import { fold } from './text.js';
import { MUNICIPIOS } from './vocab.js';

// Flags that inform without lowering compliance.
const INFO_FLAGS = new Set(['STREET_NAMED_AFTER_MUNICIPALITY']);

const ABBREV = {
  Calle: ['C/', 'Cll', 'Street'], Avenida: ['Ave', 'Av.', 'Avenue'], Carretera: ['Carr.', 'Road', 'PR-'],
  Camino: ['Cam.'], Paseo: ['Pso.'],
};

/** Deterministic PRNG so a seed reproduces the same suite. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function stripAccents(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }

export function cleanParts(g) {
  return {
    number: g.structure_number ?? '',
    type: g.street_type ?? '',
    name: g.street_name ?? '',
    unit: g.unit ?? '',
    urb: g.urbanization ?? '',
    barrio: g.barrio ?? '',
    city: g.municipio ?? '',
    zip: g.zip ?? '',
    state: 'PR',
  };
}

export function render(p, { order = 'standard', urbLabel = 'Urb.', barrioLabel = 'Bo.', withState = true } = {}) {
  const street = p.type === 'Carretera' && /^\d/.test(p.name)
    ? (p.routeStyle === 'PR-' ? `PR-${p.name}` : `${p.routeStyle ?? 'Carr.'} ${p.name}`)
    : [p.type, p.name].filter(Boolean).join(' ');
  const line1 = order === 'number_after' ? [street, p.number].filter(Boolean).join(' ') : [p.number, street].filter(Boolean).join(' ');
  const parts = [];
  if (p.prefix) parts.push(p.prefix);
  const l1 = line1 + (p.km ? ` Km ${p.km}` : '') + (p.unit ? ` ${p.unit}` : '');
  if (order === 'urb_first' && p.urb) parts.push(`${urbLabel} ${p.urb}`.trim());
  parts.push(l1);
  if (order !== 'urb_first' && p.urb) parts.push(urbLabel ? `${urbLabel} ${p.urb}` : p.urb);
  if (p.barrio) parts.push(`${barrioLabel} ${p.barrio}`.trim());
  const last = [p.city, withState ? p.state : '', p.zip].filter(Boolean).join(' ');
  if (last) parts.push(last);
  if (p.suffix) parts.push(p.suffix);
  return parts.filter(Boolean).join(', ');
}

/** Each mutation: (parts, rand) -> {parts, opts, tag, flags[], missing[]} or null when it does not apply. */
export const MUTATIONS = {
  clean: (p) => ({ p, opts: {}, flags: [], missing: [] }),
  number_after: (p) => (p.number && p.name ? { p, opts: { order: 'number_after' }, flags: ['NONSTANDARD_ORDER'], missing: [] } : null),
  urb_first: (p) => (p.urb ? { p, opts: { order: 'urb_first' }, flags: [], missing: [] } : null),
  drop_barrio: (p) => (p.barrio ? { p: { ...p, barrio: '' }, opts: {}, flags: [], missing: ['barrio'] } : null),
  drop_type: (p) => (p.type && p.type !== 'Carretera' ? { p: { ...p, type: '' }, opts: {}, flags: [], missing: ['street_type'] } : null),
  drop_state: (p) => ({ p, opts: { withState: false }, flags: [], missing: ['state'] }),
  drop_zip: (p) => (p.zip ? { p: { ...p, zip: '' }, opts: {}, flags: [], missing: ['zip'] } : null),
  business_name: (p, r) => ({ p: { ...p, prefix: ['Farmacia El Carmen', 'Colmado La Esquina', 'Edificio Torre Norte', 'Ferretería Central'][Math.floor(r() * 4)] }, opts: {}, flags: ['NON_ADDRESS_TEXT'], missing: [] }),
  attention_line: (p) => ({ p: { ...p, suffix: 'Attn Departamento de Compras' }, opts: {}, flags: ['NON_ADDRESS_TEXT'], missing: [] }),
  stray_punct: (p) => ({ p: { ...p, name: `${p.name}.`, city: `${p.city},` }, opts: {}, flags: [], missing: [] }),
  add_km: (p, r) => (p.number ? { p: { ...p, km: (1 + Math.floor(r() * 300) / 10).toFixed(1) }, opts: {}, flags: ['KM_PRESENT'], missing: [] } : null),
  route_style: (p, r) => (p.type === 'Carretera' ? { p: { ...p, routeStyle: ['Road', 'Carr.', 'PR-'][Math.floor(r() * 3)] }, opts: {}, flags: [], missing: [] } : null),
  abbreviate: (p, r) => (ABBREV[p.type] ? { p: { ...p, type: ABBREV[p.type][Math.floor(r() * ABBREV[p.type].length)] }, opts: {}, flags: [], missing: [] } : null),
  long_labels: (p) => ({ p, opts: { urbLabel: 'Urbanización', barrioLabel: 'Barrio' }, flags: [], missing: [] }),
  no_urb_label: (p) => (p.urb ? { p, opts: { urbLabel: '' }, flags: ['UNLABELED_LOCALITY'], missing: [] } : null),
  postal_city: (p) => (p.postal_city && fold(p.postal_city) !== fold(p.city) ? { p: { ...p, city: p.postal_city }, opts: {}, flags: ['POSTAL_CITY_DIFFERS'], missing: [] } : null),
  block_lot: (p, r) => (p.number && /^\d+$/.test(p.number) ? { p: { ...p, number: `${'ABCDEFGHJKLM'[Math.floor(r() * 12)]}-${p.number}` }, opts: {}, flags: ['AMBIGUOUS_NUMBER'], missing: [], expect: { structure_number: null } } : null),
  merged_unit: (p) => (p.unit && p.number ? { p: { ...p, number: `${p.number}-${p.unit.replace(/\D/g, '') || '1'}`, unit: '' }, opts: {}, flags: ['AMBIGUOUS_NUMBER'], missing: [], expect: { structure_number: null } } : null),
  strip_accents: (p) => ({ p: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' ? stripAccents(v) : v])), opts: {}, flags: [], missing: [] }),
  lower_case: (p) => ({ p: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' ? v.toLowerCase() : v])), opts: {}, flags: [], missing: [], post: (s) => s.toLowerCase() }),
  upper_case: (p) => ({ p, opts: {}, flags: [], missing: [], post: (s) => s.toUpperCase() }),
};

const POSTAL_FORMS = [
  (n, z, c) => `PO Box ${n}, ${c} PR ${z}`,
  (n, z, c) => `Apartado ${n}, ${c}, PR ${z}`,
  (n, z, c) => `HC 0${1 + (n % 9)} Box ${n}, ${c} PR ${z}`,
  (n, z, c) => `RR ${1 + (n % 9)} Box ${n}, ${c} PR ${z}`,
  (n, z, c) => `PMB ${n % 900} PO Box ${n}, ${c} PR ${z}`,
];

/** Build cases for one ground-truth row. */
export function casesFor(g, { mutations = Object.keys(MUTATIONS), pairs = 2, rand = rng(1) } = {}) {
  const base = { ...cleanParts(g), postal_city: g.postal_city ?? '' };
  const out = [];
  const make = (tags, list) => {
    let p = { ...base }; let opts = {}; const flags = new Set(); const missing = new Set(); const posts = []; const expect = {};
    for (const m of list) {
      const r = MUTATIONS[m](p, rand);
      if (!r) return null;
      p = r.p; opts = { ...opts, ...r.opts }; r.flags.forEach((f) => flags.add(f)); r.missing.forEach((f) => missing.add(f));
      if (r.post) posts.push(r.post);
      Object.assign(expect, r.expect ?? {});
    }
    let input = render(p, opts);
    for (const f of posts) input = f(input);
    const muni = MUNICIPIOS.find((m) => fold(m.name) === fold(g.municipio));
    // Missing fields follow from what was finally rendered, not just from the mutation names.
    const present = { structure_number: p.number, street_type: p.type || (p.type === '' ? '' : p.routeStyle), street_name: p.name,
      barrio: p.barrio, city: p.city, state: opts.withState === false ? '' : 'PR', zip: p.zip };
    for (const [k, v] of Object.entries(present)) if (!v) missing.add(k);
    if (MUNICIPIOS.some((m) => fold(m.name) === fold(p.name))) flags.add('STREET_NAMED_AFTER_MUNICIPALITY');
    return {
      id: `${g.id}-${tags.join('+')}`,
      input,
      tags: tags.join(';'),
      expected_compliance: missing.size ? 'Not compliant' : [...flags].some((f) => !INFO_FLAGS.has(f)) ? 'Compliant with warnings' : 'Compliant',
      expected_flags: [...flags].join(';'),
      expected_missing: [...missing].join(';'),
      expected_structure_number: 'structure_number' in expect ? '' : base.number,
      expected_street_name: base.name,
      expected_zip: base.zip,
      expected_municipio: muni?.name ?? g.municipio,
      expected_barrio: g.barrio ?? '',
      expected_lat: g.lat,
      expected_lon: g.lon,
    };
  };
  for (const m of mutations) { const c = make([m], [m]); if (c) out.push(c); }
  // A few random pairs, the way real input stacks mistakes.
  const pool = mutations.filter((m) => m !== 'clean' && !['lower_case', 'upper_case'].includes(m));
  for (let i = 0; i < pairs; i++) {
    const a = pool[Math.floor(rand() * pool.length)];
    const b = pool[Math.floor(rand() * pool.length)];
    if (a === b) continue;
    const c = make([a, b], [a, b]);
    if (c) out.push(c);
  }
  // Postal-only form for this municipio.
  if (g.zip) {
    const n = 1000 + Math.floor(rand() * 8999);
    const form = POSTAL_FORMS[Math.floor(rand() * POSTAL_FORMS.length)];
    out.push({
      id: `${g.id}-postal`, input: form(n, g.zip, g.municipio), tags: 'postal_only',
      expected_compliance: 'Postal only', expected_flags: '', expected_missing: '',
      expected_structure_number: '', expected_street_name: '', expected_zip: g.zip,
      expected_municipio: g.municipio, expected_barrio: '', expected_lat: '', expected_lon: '',
    });
  }
  return out;
}

export const CASE_COLUMNS = ['id', 'input', 'tags', 'expected_compliance', 'expected_flags', 'expected_missing',
  'expected_structure_number', 'expected_street_name', 'expected_zip', 'expected_municipio', 'expected_barrio',
  'expected_lat', 'expected_lon'];
