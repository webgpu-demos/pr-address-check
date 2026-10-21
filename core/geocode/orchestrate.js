// Geocode orchestration: which queries to send, and which candidate to trust.

import { canonical, sameValue, fold } from '../text.js';
import { findMunicipio } from '../vocab.js';

export const PRECISION_RANK = { rooftop: 4, interpolated: 3, street: 2, area: 1, none: 0 };

export function value(comps, name, role) {
  const list = comps.filter((c) => c.name === name && (!role || c.role === role));
  return list[0]?.value ?? '';
}

export function municipalityOf(comps) {
  const cities = comps.filter((c) => c.name === 'city');
  const m = cities.find((c) => c.role === 'municipality') ?? cities.find((c) => c.role !== 'postal_city' && findMunicipio(c.value))
    ?? cities.find((c) => findMunicipio(c.value));
  return m ? findMunicipio(m.value) : null;
}

/** Compose a clean single-line address from parsed parts (label text left out). */
export function composeQuery(comps, { style = 'census' } = {}) {
  const num = value(comps, 'structure_number');
  const route = value(comps, 'route_number');
  const type = value(comps, 'street_type');
  const name = value(comps, 'street_name');
  const km = value(comps, 'km_hm');
  const urb = value(comps, 'urbanization');
  const complex = value(comps, 'complex');
  const muni = municipalityOf(comps);
  const city = muni?.name ?? value(comps, 'city');
  const zip = value(comps, 'zip');
  let street = '';
  if (route) street = style === 'esri' ? `PR-${route}${km ? ` Km ${km}` : ''}` : `Carr ${route}${km ? ` Km ${km}` : ''}`;
  else if (name) street = [type, name].filter(Boolean).join(' ');
  const line1 = [num, street].filter(Boolean).join(' ');
  const parts = [line1, urb ? (style === 'census' ? `Urb ${urb}` : urb) : '', complex, city,
    style === 'esri' ? `Puerto Rico ${zip}`.trim() : `PR ${zip}`.trim()];
  const q = parts.filter(Boolean).join(', ');
  return line1 || urb || complex ? q : '';
}

/** Queries for one geocoder, deduplicated. The raw input always goes first so a bad parse cannot hide a good match. */
export function buildQueries(input, comps, modelPlan = [], target = 'census') {
  const out = [];
  const seen = new Set();
  const push = (query, origin) => {
    const q = String(query ?? '').trim();
    if (!q) return;
    const k = canonical(q);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ target, query: q, origin });
  };
  push(input, 'raw');
  for (const p of modelPlan) if (p.target === target) push(p.query, 'model');
  push(composeQuery(comps, { style: target }), 'parsed');
  return out.slice(0, 3);
}

/** Census answers when it finds the typed number on the typed street; otherwise Esri is asked. */
export function censusIsEnough(best) {
  return Boolean(best) && best.provider === 'census' && best.effectivePrecision >= 3
    && best.consistency.number === true && best.consistency.street !== false;
}

/**
 * Census first, then Esri. `pre` holds queries already sent (the raw string during the model call).
 * Returns every query sent, every candidate, the stage that answered and the pick.
 */
export async function geocodeStaged(input, comps, modelPlan, geocoders, pre = { queries: [], candidates: [], errors: [] }) {
  const sent = new Set(pre.queries.map((q) => `${q.target}|${q.query}`));
  const fresh = (list) => list.filter((q) => !sent.has(`${q.target}|${q.query}`));
  const queries = [...pre.queries];
  const candidates = [...pre.candidates];
  const errors = [...pre.errors];

  const censusQ = fresh(buildQueries(input, comps, modelPlan, 'census'));
  const r1 = await runQueries(censusQ, geocoders);
  queries.push(...censusQ); candidates.push(...r1.candidates); errors.push(...r1.errors);
  const censusPick = pickBest(candidates.filter((c) => c.provider === 'census'), comps);
  if (censusIsEnough(censusPick.best) && !censusPick.ambiguous) {
    return { queries, candidates, errors, stage: 'census', censusHit: true, ...pickBest(candidates, comps) };
  }
  const esriQ = fresh(buildQueries(input, comps, modelPlan, 'esri'));
  const r2 = await runQueries(esriQ, geocoders);
  queries.push(...esriQ); candidates.push(...r2.candidates); errors.push(...r2.errors);
  return { queries, candidates, errors, stage: 'esri', censusHit: Boolean(censusPick.best), ...pickBest(candidates, comps) };
}

export async function runQueries(queries, geocoders) {
  const settled = await Promise.allSettled(queries.map((q) => {
    const fn = geocoders[q.target];
    if (!fn) return Promise.resolve([]);
    return fn(q.query).then((cands) => cands.map((c) => ({ ...c, origin: q.origin })));
  }));
  const candidates = [];
  const errors = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') candidates.push(...s.value);
    else errors.push({ ...queries[i], error: String(s.reason?.message ?? s.reason) });
  });
  return { candidates, errors };
}

/** How well a candidate agrees with what was typed: hits and misses on number, street, ZIP and municipio. */
export function consistency(c, comps) {
  const num = value(comps, 'structure_number');
  const name = value(comps, 'route_number') || value(comps, 'street_name');
  const zip = value(comps, 'zip');
  const muni = municipalityOf(comps);
  const out = { number: null, street: null, zip: null, municipio: null };
  const matched = canonical(c.matched);
  if (num) {
    const n = canonical(num).replace(/\s|-/g, '');
    const cn = canonical(c.parts.number || '').replace(/\s|-/g, '');
    out.number = cn ? cn === n : (c.precision === 'rooftop' || c.precision === 'interpolated') ? matched.replace(/-/g, '').startsWith(n) : null;
  }
  if (name) {
    const cs = canonical(c.parts.streetName || c.parts.street || '');
    const nm = canonical(name);
    out.street = cs ? (cs.includes(nm) || nm.includes(cs)) : matched.includes(nm);
  }
  if (zip && c.parts.zip) out.zip = c.parts.zip.slice(0, 5) === zip;
  if (muni && (c.parts.municipio || c.parts.city)) {
    out.municipio = sameValue(c.parts.municipio || '', muni.name) || sameValue(c.parts.city || '', muni.name)
      || fold(c.matched).includes(fold(muni.name)) ? true : null; // a different postal city is not proof of a miss
  }
  return out;
}

export function rankCandidate(c, comps) {
  const k = consistency(c, comps);
  const hits = Object.values(k).filter((v) => v === true).length;
  const misses = Object.values(k).filter((v) => v === false).length;
  // A rooftop hit on the wrong house number is worse than a street-range hit on the right one.
  const precision = PRECISION_RANK[c.precision] ?? 0;
  const effective = k.number === false && precision >= 3 ? 2 : precision;
  return { ...c, consistency: k, effectivePrecision: effective, rank: effective * 100 + hits * 12 - misses * 20 + Math.min(c.score, 100) / 10 };
}

export function metersBetween(a, b) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Pick the best candidate; mark ambiguity when two strong, equally consistent answers sit far apart. */
export function pickBest(candidates, comps) {
  if (!candidates.length) return { best: null, ambiguous: false, ranked: [] };
  const ranked = candidates.map((c) => rankCandidate(c, comps)).sort((a, b) => b.rank - a.rank);
  const best = ranked[0];
  const rival = ranked.find((c) => c !== best && metersBetween(c, best) > 500);
  const ambiguous = Boolean(rival && best.effectivePrecision >= 3 && rival.effectivePrecision === best.effectivePrecision
    && best.rank - rival.rank < 12);
  return { best, ambiguous, rival: ambiguous ? rival : null, ranked: ranked.slice(0, 8) };
}
