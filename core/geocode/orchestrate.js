// Geocode orchestration: which queries to send, and which candidate to trust.

import { canonical, sameValue, fold } from '../text.js';
import { findMunicipio } from '../vocab.js';

// KM markers are placed by interpolating along the route, often a kilometer or more off: trusted like a street.
export const PRECISION_RANK = { rooftop: 4, interpolated: 3, km: 2, street: 2, area: 1, none: 0 };

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
  if (route) street = `Carr ${route}${km ? ` Km ${km}` : ''}`;
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
  // A house number and a KM on the same route: ask for the KM marker too, to choose among same-numbered houses.
  const route = value(comps, 'route_number'); const km = value(comps, 'km_hm'); const muni = municipalityOf(comps);
  if (target === 'esri' && route && km && value(comps, 'structure_number')) {
    push(`Carr ${route} KM ${km}${muni ? `, ${muni.name}` : ''}, Puerto Rico`, 'km');
  }
  return out.slice(0, 4);
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
  const route = value(comps, 'route_number');
  const name = route || value(comps, 'street_name');
  const zip = value(comps, 'zip');
  const urb = value(comps, 'urbanization');
  const barrio = value(comps, 'barrio');
  const muni = municipalityOf(comps);
  const out = { number: null, street: null, zip: null, municipio: null, urbanization: null, barrio: null };
  const matched = canonical(c.matched);
  const km = value(comps, 'km_hm');
  if (c.addrType === 'DistanceMarker' || c.precision === 'km') {
    // A KM marker match: its "house number" is the kilometer.
    out.number = km ? Number(c.parts.number) === Number(km) : null;
  } else if (num) {
    const n = canonical(num).replace(/\s|-/g, '');
    const cn = canonical(c.parts.number || '').replace(/\s|-/g, '');
    out.number = cn ? cn === n : (c.precision === 'rooftop' || c.precision === 'interpolated') ? matched.replace(/-/g, '').startsWith(n) : null;
  }
  if (name) {
    // Token-level, so "Calle 2" does not match "Calle 12" and route 2 does not match "Calle 7".
    const candStreet = canonical(c.parts.street || c.parts.streetName || '');
    const cTokens = new Set((candStreet || matched).split(' '));
    if (route) {
      const isRoute = /\b(pr|carr|carretera|ruta|road|rd|expreso|autopista)\b/.test(candStreet || matched) || !candStreet;
      out.street = isRoute && cTokens.has(canonical(route));
      if (!candStreet && !out.street) out.street = null;
    } else {
      const nTokens = canonical(name).split(' ').filter(Boolean);
      const sTokens = candStreet ? candStreet.split(' ').filter((t) => !['calle', 'avenida', 'pr', 'camino', 'paseo', 'boulevard', 'callejon'].includes(t)) : [];
      if (candStreet) {
        const a = nTokens.every((t) => cTokens.has(t));
        const b = sTokens.length > 0 && sTokens.every((t) => nTokens.includes(t));
        out.street = a || b;
      } else {
        out.street = nTokens.every((t) => cTokens.has(t)) ? true : null;
      }
    }
  }
  if (zip && c.parts.zip) out.zip = c.parts.zip.slice(0, 5) === zip;
  if (muni && (c.parts.municipio || c.parts.city)) {
    // Esri's Subregion is the municipio; its City is the postal city. A typed postal city that matches City is fine.
    const candMuni = findMunicipio(c.parts.municipio);
    const postalMatch = sameValue(c.parts.city || '', muni.name);
    if (candMuni) out.municipio = candMuni.name === muni.name || postalMatch;
    else out.municipio = postalMatch || fold(c.matched).includes(fold(muni.name)) ? true : null;
  }
  if (barrio && c.parts.district) {
    const a = canonical(barrio); const b = canonical(String(c.parts.district).replace(/^barrio\s+/i, ''));
    out.barrio = a.includes(b) || b.includes(a);
  }
  // Urbanización: the candidate names one (Esri "Urb X" in the match, Census urb) and it is not the typed one.
  const candUrb = c.parts.urb || String(c.parts.neighborhood ?? '').replace(/^urb\.?\s+/i, '') || (/\burb\.?\s+([^,]+)/i.exec(c.matched)?.[1] ?? '');
  if (urb && candUrb) {
    const a = canonical(urb); const b = canonical(candUrb);
    out.urbanization = a.includes(b) || b.includes(a);
  }
  return out;
}

/**
 * The candidate names a different place. In Puerto Rico the same street name repeats across urbanizaciones,
 * so a different urbanización is a different place; so is another municipio unless the ZIP agrees.
 */
export function isConflict(c, k) {
  if (k.urbanization === false) return true;
  if (k.municipio === false && k.zip !== true) return true;
  return k.zip === false && k.barrio === false;
}

export function rankCandidate(c, comps) {
  const k = consistency(c, comps);
  const hits = Object.values(k).filter((v) => v === true).length;
  const misses = Object.values(k).filter((v) => v === false).length;
  // A rooftop hit on the wrong house number is worse than a street-range hit on the right one.
  const precision = PRECISION_RANK[c.precision] ?? 0;
  const conflict = isConflict(c, k);
  let effective = k.number === false && precision >= 3 ? 2 : precision;
  // A different street is not this address: only its area can be trusted.
  if (k.street === false && precision >= 2) effective = Math.min(effective, 1);
  if (conflict) effective = Math.min(effective, 1);
  return { ...c, consistency: k, conflict, effectivePrecision: effective, rank: effective * 100 + hits * 12 - misses * 20 + Math.min(c.score, 100) / 10 };
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
  const ranked = candidates.map((c) => rankCandidate(c, comps));
  // The same house number repeats along long routes. When the typed KM marker was found, prefer the house near it.
  const kmRef = ranked.find((c) => c.precision === 'km' && c.consistency.number === true && !c.conflict);
  if (kmRef) {
    for (const c of ranked) {
      if (c === kmRef || (PRECISION_RANK[c.precision] ?? 0) < 3) continue;
      c.kmDistance = Math.round(metersBetween(c, kmRef));
      if (c.kmDistance > 2000) { c.rank -= 150; c.farFromKm = true; }
    }
  }
  ranked.sort((a, b) => b.rank - a.rank);
  const best = ranked[0];
  const rival = ranked.find((c) => c !== best && metersBetween(c, best) > 500);
  const ambiguous = Boolean(rival && best.effectivePrecision >= 3 && rival.effectivePrecision === best.effectivePrecision
    && best.rank - rival.rank < 12);
  // When the best we can stand behind is coarse but a precise match exists elsewhere, surface it:
  // it usually means the typed municipio or ZIP is wrong.
  const strongConflict = best.effectivePrecision < 3
    ? ranked.find((c) => c.conflict && (PRECISION_RANK[c.precision] ?? 0) >= Math.max(2, best.effectivePrecision)
      && c.consistency.street === true && c.consistency.number === true)
    : null;
  return { best, ambiguous, rival: ambiguous ? rival : null, conflictAlt: strongConflict ?? null, ranked: ranked.slice(0, 8) };
}
