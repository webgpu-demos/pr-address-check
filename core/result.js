// The result record: two statuses, reasons, checks, field sources and the output schema row.

import { SCHEMA_REQUIRED, FIELD_LABELS, isPrZip, findMunicipio } from './vocab.js';
import { sameValue, fold } from './text.js';
import { municipalityOf } from './geocode/orchestrate.js';

export const COMPLIANCE = ['Postal only', 'Needs review', 'Not compliant', 'Compliant with warnings', 'Compliant'];
const PRECISION_ORDER = { rooftop: 4, interpolated: 3, km: 3, street: 2, area: 1, none: 0 };
const SEVERITY_STATUS = { review: 'Needs review', block: 'Not compliant', warn: 'Compliant with warnings' };

export const LOCATION_LABEL = {
  rooftop: 'Address point', interpolated: 'Street range', km: 'KM marker', street: 'Street only', area: 'Area only',
  ambiguous: 'Ambiguous', conflict: 'Conflicting match', outside: 'Outside Puerto Rico', none: 'Not located',
};
// Location reasons describe where the point landed. They set the location status, never compliance.
const LOCATION_CODES = new Set(['COARSE_POINT_ELSEWHERE', 'NOT_LOCATED', 'OUTSIDE_PR', 'LOW_PRECISION', 'AMBIGUOUS_MATCH', 'LOCATION_CONFLICT', 'BARRIO_DIFFERS', 'ZIP_ZCTA_DIFFERS']);

const FLAG_TEXT = {
  KM_PRESENT: ['warn', 'KM is extra detail; the standard expects a structure number.'],
  NON_ADDRESS_TEXT: ['warn', 'Text that is not part of the address was set aside.'],
  POSTAL_CITY_DIFFERS: ['warn', 'The city typed is a postal name; the municipality comes from the map.'],
  STREET_NAMED_AFTER_MUNICIPALITY: ['info', 'The street shares a municipality name; it was read as the street.'],
  AMBIGUOUS_NUMBER: ['warn', 'The structure number could be block and lot.'],
  UNLABELED_LOCALITY: ['warn', 'An urbanización was typed without "Urb."'],
  NONSTANDARD_ORDER: ['warn', 'The number follows the street name; the standard puts it first.'],
  MULTIPLE_ADDRESSES: ['review', 'More than one address was typed.'],
  OBSOLETE_NAME: ['warn', 'A place name looks outdated.'],
  ZIP_OUT_OF_RANGE: ['block', 'The ZIP is not a Puerto Rico ZIP.'],
};

export function componentValue(comps, name) {
  return comps.find((c) => c.name === name)?.value ?? '';
}

/**
 * Resolve parser disagreements with the geocoded evidence.
 * The value consistent with the matched address or the point wins; otherwise PARSE_DISAGREEMENT.
 */
export function tieBreak(comps, rulesComps, disagreements, best, place) {
  const out = comps.map((c) => ({ ...c }));
  const reasons = [];
  const resolved = [];
  for (const d of disagreements) {
    const evidence = evidenceFor(d.name, best, place);
    const modelOk = d.model && evidence.some((e) => agrees(d.name, d.model, e));
    const rulesOk = d.rules && evidence.some((e) => agrees(d.name, d.rules, e));
    if (modelOk && !rulesOk) { resolved.push({ ...d, winner: 'model' }); continue; }
    if (rulesOk && !modelOk) {
      const fromRules = pickComp(rulesComps, d.name);
      const i = out.findIndex((c) => sameField(c, d.name));
      if (fromRules) { if (i >= 0) out[i] = { ...fromRules }; else out.push({ ...fromRules }); }
      resolved.push({ ...d, winner: 'rules' });
      continue;
    }
    if (modelOk && rulesOk) { resolved.push({ ...d, winner: 'both' }); continue; }
    const key = ['structure_number', 'street_name', 'city'].includes(d.name) && d.model && d.rules;
    reasons.push({
      code: 'PARSE_DISAGREEMENT', severity: key ? 'review' : 'warn', maturity: 'experimental', source: 'gate',
      text: `${FIELD_LABELS[d.name] ?? d.name}: the model read "${d.model || '—'}", the rule parser read "${d.rules || '—'}", and the map did not settle it.`,
    });
  }
  return { components: out, reasons, resolved };
}

function sameField(c, name) {
  return name === 'city' ? c.name === 'city' && c.role !== 'postal_city' : c.name === name;
}
function pickComp(comps, name) { return comps.find((c) => sameField(c, name)) ?? comps.find((c) => c.name === name); }

function evidenceFor(name, best, place) {
  const ev = [];
  if (best) {
    if (name === 'structure_number') ev.push(best.parts.number, best.matched);
    if (name === 'street_name') ev.push(best.parts.streetName, best.parts.street, best.matched);
    if (name === 'zip') ev.push(best.parts.zip);
    if (name === 'urbanization') ev.push(String(best.parts.neighborhood ?? '').replace(/^urb\.?\s+/i, ''), best.parts.urb);
    if (name === 'barrio') ev.push(String(best.parts.district ?? '').replace(/^barrio\s+/i, ''));
    if (name === 'city') ev.push(best.parts.municipio);
  }
  if (place) {
    if (name === 'city') ev.push(place.municipio?.name);
    if (name === 'barrio') ev.push(place.barrio?.name);
    if (name === 'zip') ev.push(place.zcta);
  }
  return ev.filter(Boolean);
}

function agrees(name, v, e) {
  if (name === 'structure_number') {
    const n = fold(v).replace(/[\s-]/g, '');
    const t = fold(e).replace(/[\s-]/g, '');
    return t === n || t.startsWith(n + ' ') || fold(e).startsWith(fold(v) + ' ') || t.startsWith(n) && !/\d/.test(t[n.length] ?? '');
  }
  if (name === 'zip') return String(e).slice(0, 5) === String(v).slice(0, 5);
  if (name === 'city') return sameValue(v, e) || findMunicipio(v)?.name === findMunicipio(e)?.name && Boolean(findMunicipio(v));
  return fold(e).includes(fold(v)) || sameValue(v, e);
}

/** Build the full record. */
export function buildResult(x) {
  const settings = x.settings ?? {};
  const required = settings.required ?? SCHEMA_REQUIRED;
  const comps = x.components;
  const place = x.place ?? null;
  const best = x.best ?? null;
  const reasons = [...(x.extraReasons ?? [])];
  const has = (n) => comps.some((c) => c.name === n && (c.source_text ?? '') !== '');
  const addressClass = x.addressClass;

  // Flags from both parsers (model flags in AI-first, rule flags otherwise), deduplicated.
  for (const f of x.flags ?? []) {
    const [severity, text] = FLAG_TEXT[f.code] ?? ['info', f.note];
    if (reasons.some((r) => r.code === f.code)) continue;
    reasons.push({ code: f.code, severity, text: f.note || text, maturity: 'experimental', source: f.source ?? 'rules' });
  }

  // Location facts come from the point, never from the geocoder's city text.
  const muniTyped = municipalityOf(comps);
  const located = Boolean(best) && place?.inPR;
  const precision = best ? best.precision : 'none';
  // usable: the point names a place we can record. trusted: precise enough to judge the typed address against.
  // A coarse point is a street or area centroid; when the geocoder itself names another municipio, the point
  // is not evidence of where the address is, so its municipio is not recorded.
  const candMuni = findMunicipio(best?.parts?.municipio);
  const coarseDisagrees = located && (best.effectivePrecision ?? 0) < 3 && candMuni && place.municipio && candMuni.name !== place.municipio.name;
  const usable = located && !best.conflict && !x.ambiguous && !coarseDisagrees;
  if (coarseDisagrees) {
    reasons.push({ code: 'COARSE_POINT_ELSEWHERE', severity: 'info', maturity: 'experimental', source: 'map',
      text: `The ${best.effectivePrecision === 2 ? 'street' : 'area'} match is placed in ${place.municipio.name}, but the geocoder says ${candMuni.name}; no municipio recorded from it.` });
  }
  const precisionOk = usable && (best.effectivePrecision ?? 0) >= 3;
  const trusted = precisionOk;

  // Required fields, as typed. Some can be filled from the point.
  const fillable = {
    barrio: trusted && place.barrio ? place.barrio.name : '',
    city: usable && place.municipio ? place.municipio.name : '',
    state: usable || (x.inferredState ?? false) ? 'PR' : '',
    zip: trusted && place.zcta ? place.zcta : '',
  };
  const missing = [];
  const filled = [];
  for (const f of required) {
    const present = f === 'street_name' ? has('street_name') || has('route_number') : has(f);
    if (present) continue;
    // As typed by default: a field the map can fill is still missing. Settings can relax this.
    if (fillable[f] && settings.allowMapFill) filled.push(f); else missing.push(f);
  }
  if (addressClass === 'postal_only') {
    reasons.push({ code: 'POSTAL_ONLY', severity: 'info', maturity: 'core', source: 'rules', text: 'A mailing address (PO box or similar), not a physical location.' });
  } else if (missing.length) {
    reasons.push({ code: 'MISSING_REQUIRED', severity: 'block', maturity: 'core', source: 'rules',
      text: `Missing: ${missing.map((f) => FIELD_LABELS[f] ?? f).join(', ')}.` });
  }
  if (filled.length && addressClass !== 'postal_only') {
    reasons.push({ code: 'FILLED_FROM_MAP', severity: 'warn', maturity: 'experimental', source: 'map',
      text: `Not typed, filled from the map: ${filled.map((f) => FIELD_LABELS[f] ?? f).join(', ')}.` });
  }

  const zipTyped = componentValue(comps, 'zip');
  if (zipTyped && !isPrZip(zipTyped) && !reasons.some((r) => r.code === 'ZIP_OUT_OF_RANGE')) {
    reasons.push({ code: 'ZIP_OUT_OF_RANGE', severity: 'block', maturity: 'core', source: 'rules', text: FLAG_TEXT.ZIP_OUT_OF_RANGE[1] });
  }
  if (['descriptive', 'not_an_address', 'ambiguous', 'complex_only'].includes(addressClass)) {
    reasons.push({ code: `CLASS_${addressClass.toUpperCase()}`, severity: 'review', maturity: 'experimental', source: x.parseSource ?? 'rules',
      text: { descriptive: 'Directions instead of an address.', not_an_address: 'This does not read as an address.',
        ambiguous: 'Too little to read as an address.', complex_only: 'A residencial or condominio without a street address.' }[addressClass] });
  }

  // Location checks.
  if (addressClass !== 'postal_only') {
    if (!best) {
      reasons.push({ code: 'NOT_LOCATED', severity: 'review', maturity: 'core', source: 'map', text: 'No geocoder found this address.' });
    } else if (place?.checked && !place.inPR) {
      reasons.push({ code: 'OUTSIDE_PR', severity: 'review', maturity: 'core', source: 'map', text: 'The point falls outside Puerto Rico.' });
    } else if (best.conflict) {
      const k = best.consistency ?? {};
      const why = [k.zip === false ? `ZIP ${best.parts.zip}` : '', k.urbanization === false ? 'a different urbanización' : '',
        best.parts.municipio ? `municipio ${best.parts.municipio}` : ''].filter(Boolean).join(', ');
      reasons.push({ code: 'LOCATION_CONFLICT', severity: 'review', maturity: 'core', source: 'map',
        text: `The closest match is a different place (${why}): ${best.matched}.` });
    } else if (!precisionOk && !x.ambiguous) {
      const eff = best.effectivePrecision ?? 0;
      const what = eff >= 2 ? 'the street, not the house' : 'an area (ZIP, barrio or town), not the address';
      reasons.push({ code: 'LOW_PRECISION', severity: 'warn', maturity: 'core', source: 'map',
        text: `Located only to ${what}${best.consistency?.number === false ? '; the house number did not match' : ''}${best.consistency?.street === false ? '; the street did not match' : ''}.` });
    }
    if (x.conflictAlt && !reasons.some((r) => r.code === 'LOCATION_CONFLICT')) {
      const alt = x.conflictAlt;
      reasons.push({ code: 'LOCATION_CONFLICT', severity: 'review', maturity: 'core', source: 'map',
        text: `A precise match exists somewhere else: ${alt.matched}. Check the typed municipio and ZIP.` });
    }
    if (x.ambiguous) {
      reasons.push({ code: 'AMBIGUOUS_MATCH', severity: 'review', maturity: 'experimental', source: 'map',
        text: 'Two different places match equally well.' });
    }
    if (trusted && place.municipio && muniTyped && !sameValue(muniTyped.name, place.municipio.name)) {
      const postalRole = comps.some((c) => c.name === 'city' && c.role === 'postal_city' && findMunicipio(c.value)?.name === muniTyped.name);
      const zipFits = zipTyped && place.zcta && zipTyped === place.zcta;
      if (postalRole || zipFits) {
        if (!reasons.some((r) => r.code === 'POSTAL_CITY_DIFFERS')) {
          reasons.push({ code: 'POSTAL_CITY_DIFFERS', severity: 'warn', maturity: 'core', source: 'map',
            text: `"${muniTyped.name}" is the postal city; the point is in ${place.municipio.name}.` });
        }
      } else {
        reasons.push({ code: 'MUNICIPALITY_CONFLICT', severity: 'review', maturity: 'core', source: 'map',
          text: `Typed ${muniTyped.name}, but the point is in ${place.municipio.name}.` });
      }
    }
    const placeName = comps.find((c) => c.name === 'city' && !findMunicipio(c.value));
    if (trusted && place.municipio && !muniTyped && placeName && !reasons.some((r) => r.code === 'POSTAL_CITY_DIFFERS')) {
      reasons.push({ code: 'POSTAL_CITY_DIFFERS', severity: 'warn', maturity: 'core', source: 'map',
        text: `"${placeName.value}" is a postal place name, not a municipality; the point is in ${place.municipio.name}.` });
    }
    const barrioTyped = componentValue(comps, 'barrio');
    if (trusted && barrioTyped && place.barrio && !sameValue(barrioTyped, place.barrio.name)
      && !fold(place.barrio.name).includes(fold(barrioTyped))) {
      reasons.push({ code: 'BARRIO_DIFFERS', severity: 'warn', maturity: 'experimental', source: 'map',
        text: `Typed barrio ${barrioTyped}; the point is in ${place.barrio.name}.` });
    }
    if (trusted && zipTyped && place.zcta && zipTyped !== place.zcta) {
      reasons.push({ code: 'ZIP_ZCTA_DIFFERS', severity: 'warn', maturity: 'experimental', source: 'map',
        text: `ZIP ${zipTyped} differs from the point's ZIP area (ZCTA ${place.zcta}).` });
    }
  }

  // Statuses.
  for (const r of reasons) r.scope = LOCATION_CODES.has(r.code) ? 'location' : 'compliance';
  let compliance = 'Compliant';
  if (addressClass === 'postal_only') compliance = 'Postal only';
  else {
    for (const s of ['review', 'block', 'warn']) {
      if (reasons.some((r) => r.scope === 'compliance' && r.severity === s)) { compliance = SEVERITY_STATUS[s]; break; }
    }
  }
  const EFFECTIVE = { 4: 'rooftop', 3: 'interpolated', 2: 'street', 1: 'area', 0: 'none' };
  let location = best ? (best.effectivePrecision < (PRECISION_ORDER[precision] ?? 0) ? EFFECTIVE[best.effectivePrecision] : precision) : 'none';
  if (!best) location = 'none';
  else if (place?.checked && !place.inPR) location = 'outside';
  else if (x.ambiguous) location = 'ambiguous';
  else if (best.conflict) location = 'conflict';

  // Field sources and the output record.
  const fields = {};
  const setField = (name, v, source, typed = '', by = '') => { fields[name] = { value: v, source, typed, by }; };
  for (const name of ['structure_number', 'street_type', 'street_name', 'unit', 'urbanization', 'complex', 'sector', 'km_hm', 'route_number', 'postal_box', 'label_text']) {
    const c = comps.find((k) => k.name === name);
    if (c) setField(name, c.value, c.source_text ? 'typed' : 'model', c.source_text, c.source);
  }
  const barrioC = comps.find((k) => k.name === 'barrio');
  if (trusted && place.barrio) setField('barrio', place.barrio.name, 'map', barrioC?.source_text ?? '', 'tigerweb');
  else if (barrioC) setField('barrio', barrioC.value, 'typed', barrioC.source_text, barrioC.source);
  const cityC = comps.find((k) => k.name === 'city' && k.role !== 'municipality') ?? comps.find((k) => k.name === 'city');
  if (cityC) setField('city', cityC.value, cityC.source === 'form' ? 'form' : 'typed', cityC.source_text, cityC.source);
  else if (fillable.city) setField('city', fillable.city, 'map', '', 'tigerweb');
  const stateC = comps.find((k) => k.name === 'state');
  if (stateC) setField('state', 'PR', stateC.source_text ? 'typed' : 'model', stateC.source_text, stateC.source);
  else if (fillable.state) setField('state', 'PR', 'map', '', 'tigerweb');
  const zipC = comps.find((k) => k.name === 'zip');
  if (zipC) setField('zip', zipC.value, 'typed', zipC.source_text, zipC.source);
  else if (fillable.zip) setField('zip', fillable.zip, 'map', '', 'zcta');

  const v = (n) => fields[n]?.value ?? '';
  const streetLine = [v('structure_number'), v('street_type'), v('street_name')].filter(Boolean).join(' ')
    + (v('unit') ? ` ${v('unit')}` : '');
  // Full address in the current app's order: number type name, city, barrio, PR zip. The municipality comes
  // from a trusted point; otherwise the typed city stands.
  const fullCity = trusted && place.municipio ? place.municipio.name : (muniTyped?.name ?? v('city'));
  const fullAddress = addressClass === 'postal_only' ? ''
    : [streetLine, fullCity, v('barrio'), ['PR', v('zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const record = {
    structure_number: v('structure_number'),
    street_type: v('street_type'),
    street_name: v('street_name'),
    unit: v('unit'),
    urbanization: v('urbanization'),
    complex: v('complex'),
    barrio: trusted && place.barrio ? place.barrio.name : '',
    barrio_typed: barrioC?.value ?? '',
    barrio_type: trusted && place.barrio ? place.barrio.type : '',
    city: v('city'),
    city_role: cityC?.role ?? (fillable.city ? 'municipality' : ''),
    state: v('state'),
    zip: v('zip'),
    municipality: usable && place.municipio ? place.municipio.name : '',
    municipio_fips: usable && place.municipio ? place.municipio.fips : '',
    municipality_type: usable && place.municipio ? place.municipio.type : '',
    zcta: trusted ? place.zcta ?? '' : '',
    usng: usable ? x.usng ?? '' : '',
    lat: best && usable ? round(best.lat, 6) : '',
    lon: best && usable ? round(best.lon, 6) : '',
    candidate_lat: best && !usable ? round(best.lat, 6) : '',
    candidate_lon: best && !usable ? round(best.lon, 6) : '',
    full_address: fullAddress,
    location_precision: LOCATION_LABEL[location],
    matched_address: best?.matched ?? '',
    geocoder: best ? `${best.provider}${best.addrType ? ` ${best.addrType}` : ''}` : '',
  };

  const checks = buildChecks({ reasons, addressClass, located: trusted, precisionOk, best, place, muniTyped, zipTyped, comps, x });

  return {
    input: x.input,
    mode: x.mode,
    provider: x.providerId ?? '',
    model: x.model ?? '',
    prompt_version: x.promptVersion ?? '',
    address_class: addressClass,
    compliance,
    location,
    location_label: LOCATION_LABEL[location],
    reasons: sortReasons(reasons),
    checks,
    missing_required: addressClass === 'postal_only' ? [] : missing,
    filled_from_map: filled,
    fields,
    record,
    components: comps,
    best,
    rival: x.rival ?? x.conflictAlt ?? null,
    candidates: x.candidates ?? [],
    queries: x.queries ?? [],
    geocode_errors: x.geocodeErrors ?? [],
    geocode_stage: x.geocodeStage ?? '',
    census_hit: Boolean(x.censusHit),
    model_flags: x.modelFlags ?? [],
    place,
    gate: x.gate ?? null,
    review: x.review ?? null,
    fallback: x.fallback ?? null,
    usage: x.usage ?? null,
    cost: x.cost ?? null,
    latency_ms: x.latencyMs ?? null,
    user_prompts: x.userPrompts ?? [],
    created: new Date().toISOString(),
  };
}

const SEV_ORDER = { review: 0, block: 1, warn: 2, info: 3 };
function sortReasons(r) { return [...r].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]); }
function round(n, d) { const k = 10 ** d; return Math.round(n * k) / k; }

function buildChecks({ reasons, addressClass, located, precisionOk, best, place, muniTyped, zipTyped, x }) {
  const r = (code) => reasons.find((k) => k.code === code);
  const state = (fail, na = false) => (na ? 'na' : fail ? 'fail' : 'pass');
  const postal = addressClass === 'postal_only';
  return [
    { id: 'required', label: 'Required fields typed', maturity: 'core', state: state(Boolean(r('MISSING_REQUIRED')), postal), detail: r('MISSING_REQUIRED')?.text ?? r('FILLED_FROM_MAP')?.text ?? '' },
    { id: 'physical', label: 'Physical address, not a mailbox', maturity: 'core', state: state(postal), detail: postal ? r('POSTAL_ONLY')?.text : '' },
    { id: 'zip', label: 'Puerto Rico ZIP', maturity: 'core', state: state(Boolean(r('ZIP_OUT_OF_RANGE')), !zipTyped), detail: r('ZIP_OUT_OF_RANGE')?.text ?? '' },
    { id: 'located', label: 'Located to the address', maturity: 'core', state: state(!precisionOk, postal), detail: (r('NOT_LOCATED') ?? r('OUTSIDE_PR') ?? r('LOCATION_CONFLICT') ?? r('AMBIGUOUS_MATCH') ?? r('LOW_PRECISION'))?.text ?? (best ? `${LOCATION_LABEL[best.precision]} from ${best.provider === 'esri' ? 'Esri' : 'Census'}.` : '') },
    { id: 'municipality', label: 'Municipality matches the point', maturity: 'core', state: state(Boolean(r('MUNICIPALITY_CONFLICT')), !located || !muniTyped), detail: (r('MUNICIPALITY_CONFLICT') ?? r('POSTAL_CITY_DIFFERS'))?.text ?? '' },
    { id: 'barrio', label: 'Barrio matches the point', maturity: 'experimental', state: state(Boolean(r('BARRIO_DIFFERS')), !located || !x.components.some((c) => c.name === 'barrio')), detail: r('BARRIO_DIFFERS')?.text ?? '' },
    { id: 'zcta', label: 'ZIP matches the ZIP area', maturity: 'experimental', state: state(Boolean(r('ZIP_ZCTA_DIFFERS')), !located || !zipTyped || !place?.zcta), detail: r('ZIP_ZCTA_DIFFERS')?.text ?? '' },
    { id: 'agree', label: 'Parsers agree', maturity: 'experimental', state: state(Boolean(r('PARSE_DISAGREEMENT')), x.mode !== 'ai_first' || Boolean(x.fallback?.used)), detail: reasons.filter((k) => k.code === 'PARSE_DISAGREEMENT').map((k) => k.text).join(' ') },
  ];
}
