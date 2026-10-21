// Deterministic rule parser: the "rules only" read of an address.
// It is the independent second opinion the gate compares the model against,
// and the whole parse in rules-only mode. No model, no network.

import { fold, squash } from './text.js';
import { MUNICIPIOS, STREET_TYPES, POSTAL_ONLY, PR_ZIP, isPrZip, findPostalPlace, findMunicipio } from './vocab.js';

const SPANISH_TYPES = new Set(['calle', 'cll', 'c/', 'avenida', 'ave', 'av', 'camino', 'cam', 'paseo', 'pso', 'callejon', 'cjon',
  'boulevard', 'blvd', 'bulevar', 'via', 'ramal', 'pasaje', 'sendero']);
// English words written in Spanish order ("Street Flamboyán", "Avenue Los Robles").
const TYPE_FIRST_ENGLISH = new Set(['street', 'st', 'avenue']);
const NAME_CONNECTORS = new Set(['de', 'del', 'la', 'las', 'los', 'el']);
// Words that end a street name: corners and numbering markers.
const NUMBER_MARKERS = new Set(['no', 'num', 'núm', 'numero', 'número', 'nº']);
const NAME_STOPS = new Set(['esq', 'esquina', 'corner', '&', 'and', 'no', 'num', 'núm', 'numero', 'número', 'final', 'frnt', 'frente', 'intersección', 'interseccion']);
const ENGLISH_TYPES = new Set(['street', 'st', 'way', 'drive', 'dr', 'lane', 'ln', 'court', 'ct', 'circle', 'avenue', 'ave']);
const MARKER_WORDS = new Set(['urb', 'urbanizacion', 'urbanization', 'res', 'residencial', 'cond', 'condominio',
  'condominium', 'bo', 'barrio', 'sector', 'sect', 'parc', 'parcelas', 'com', 'comunidad', 'apt', 'apto',
  'apartamento', 'apartment', 'suite', 'ste', 'unit', 'unidad', 'km', 'hm', 'carr', 'carretera', 'pr',
  'edif', 'edificio', 'bldg', 'building']);
const DESCRIPTIVE = /\b(frente\s+a|al\s+lado|cerca\s+de|detr[aá]s\s+de|esquina\s+(?:con|de)|en\s+la\s+esquina|entrada\s+de|al\s+fondo|antes\s+de|despu[eé]s\s+de)\b/i;

/** Tokenize with character offsets. Commas become their own tokens. */
function tokenize(input) {
  const tokens = [];
  const re = /,|[^\s,]+/g;
  let m;
  while ((m = re.exec(input))) {
    const raw = m[0];
    tokens.push({ raw, start: m.index, end: m.index + raw.length, key: fold(raw).replace(/[.:;]+$/g, '') });
  }
  return tokens;
}

export function parseRules(input, opts = {}) {
  const text = String(input ?? '');
  const used = new Array(text.length).fill(false);
  const components = [];
  const flags = [];
  const mark = (s, e) => { for (let i = s; i < e; i++) used[i] = true; };
  const free = (s, e) => { for (let i = s; i < e; i++) if (used[i]) return false; return true; };
  const add = (name, value, s, e, extra = {}) => {
    const v = NAME_PARTS.has(name) ? titleCase(squash(value)) : squash(value);
    components.push({ name, value: v, source_text: text.slice(s, e), span: [s, e], source: 'rules', role: '', ...extra });
    mark(s, e);
  };
  const flag = (code, note) => { if (!flags.some((f) => f.code === code)) flags.push({ code, note, source: 'rules' }); };
  const tokens = tokenize(text);
  const tokenAt = (pos) => tokens.findIndex((t) => t.start <= pos && pos < t.end);
  const numberish = (tok) => tok && !used[tok.start] && /^#?(\d+[a-z]?|[a-z]{1,2}-?\d+[a-z]?|\d+-\d+)$/i.test(tok.raw.replace(/,$/, ''));
  let street = null;

  // 0a. Parenthetical notes and bus-stop landmarks are never address parts: "(al lado del Cuartel)", "Pda. 37".
  for (const m of text.matchAll(/\([^()]*\)|\b(?:pda\.?|parada)\s*\d+[a-z]?\b/gi)) {
    add('label_text', m[0].replace(/^\(|\)$/g, '').trim() || m[0], m.index, m.index + m[0].length);
    flag('NON_ADDRESS_TEXT', `"${m[0]}" is not part of the address.`);
  }

  // 0. Attention / care-of lines are never address parts.
  for (const m of text.matchAll(/(?:^|,)\s*((?:attn\.?|atenci[oó]n|attention|c\/o|care\s+of)\b[^,]*)/gi)) {
    const s = m.index + m[0].indexOf(m[1]);
    add('label_text', m[1].trim(), s, s + m[1].trimEnd().length);
    flag('NON_ADDRESS_TEXT', `"${m[1].trim()}" is not part of the address.`);
  }

  // 1. Postal-only forms, possibly more than one ("PMB 730 PO Box 5230").
  for (const postal of text.matchAll(new RegExp(POSTAL_ONLY.source, 'gi'))) {
    if (!free(postal.index, postal.index + postal[0].length)) continue;
    let end = postal.index + postal[0].length;
    const tail = /^\s*#?\s*\d+/.exec(text.slice(end));
    if (tail) end += tail[0].length;
    add('postal_box', text.slice(postal.index, end), postal.index, end);
  }

  // 2. ZIP: the last PR-shaped ZIP; otherwise a trailing 5-digit number.
  let zipMatch = null;
  for (const m of text.matchAll(new RegExp(PR_ZIP.source, 'g'))) zipMatch = m;
  if (!zipMatch) {
    const any = /\b(\d{5})(?:-\d{4})?\s*$/.exec(text);
    if (any) zipMatch = any;
  }
  if (zipMatch && free(zipMatch.index, zipMatch.index + zipMatch[0].length)) {
    add('zip', zipMatch[1], zipMatch.index, zipMatch.index + zipMatch[0].length);
  }

  // 3. State, but not the "PR" of a route ("PR-165", "PR 2").
  const state = /\b(P\.\s?R\.|PR|Puerto\s+Rico)\b(?![-\s]*\d{1,3}\b)/i.exec(text);
  if (state && free(state.index, state.index + state[0].length)) {
    add('state', 'PR', state.index, state.index + state[0].length);
  }

  // 4. KM / HM marks.
  // "Km 27.4", "K.m. 149.5", "K.10.H 5" (km 10, hm 5), "Km 156 Hm 0".
  for (const m of text.matchAll(/\b(?:km|kil[oó]metro|k\.\s?m|k(?=\.\s?\d))\s*\.?\s*(\d+(?:[.,]\d+)?)(?:\s*\.?\s*h\.?\s*m?\.?\s*(\d+))?/gi)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const km = m[1].replace(',', '.');
    const value = m[2] !== undefined && !km.includes('.') ? `${km}.${m[2].slice(0, 1)}` : km;
    add('km_hm', value, m.index, m.index + m[0].length);
    flag('KM_PRESENT', `KM ${value} is extra detail only; the standard expects a structure number.`);
  }
  for (const m of text.matchAll(/\bhm\s*\.?\s*(\d+(?:[.,]\d+)?)/gi)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    add('km_hm', `HM ${m[1]}`, m.index, m.index + m[0].length);
    flag('KM_PRESENT', `HM ${m[1]} is extra detail only.`);
  }

  // 5. Routes: Carr. 172, Carretera 2, Road 165, PR-165.
  const route = /\b(carr(?:etera)?\.?|state\s+(?:road|rd\.?|hwy\.?|highway)|road|rd\.?|ruta|hwy\.?|pr)\s*[-#]?\s*(\d{1,3}[a-z]?)\b(?!\d)/gi;
  for (const m of text.matchAll(route)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const typeEnd = m.index + m[1].length;
    add('street_type', 'Carretera', m.index, typeEnd);
    const numStart = m.index + m[0].length - m[2].length;
    add('route_number', m[2], numStart, m.index + m[0].length);
    mark(m.index, m.index + m[0].length); // the "#" in "Hwy #2" belongs to the route
    components.push({ name: 'street_name', value: m[2], source_text: m[2], span: [numStart, m.index + m[0].length], source: 'rules', role: '' });
    street = { typeIndex: tokenAt(m.index), nameEnd: tokenAt(numStart), route: true };
    break;
  }

  // 6. Units.
  for (const m of text.matchAll(/\b(apt\.?|apto\.?|apartamento|apartment|suite|ste\.?|unit|unidad|oficina|ofic\.?|edif\.?|edificio|bldg\.?|office)\s*#?\s*([a-z]{0,2}-?\d[a-z0-9-]*|[a-z]{1,2}(?![\p{L}]))/giu)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    add('unit', `${m[1].replace(/\.$/, '')} ${m[2]}`, m.index, m.index + m[0].length);
  }

  // 7. Locality markers: urbanización, residencial, condominio, sector, barrio.
  const isStop = (t) => t.raw === ',' || MARKER_WORDS.has(t.key) || SPANISH_TYPES.has(t.key) || /^\d/.test(t.raw)
    || /^[a-z]{1,2}-\d/i.test(t.raw) || used[t.start] || NAME_STOPS.has(t.key) || /^#/.test(t.raw);
  const markerName = { urb: 'urbanization', urbanizacion: 'urbanization', urbanization: 'urbanization',
    res: 'complex', residencial: 'complex', cond: 'complex', condominio: 'complex', condominium: 'complex',
    bo: 'barrio', barrio: 'barrio', sector: 'sector', sect: 'sector', parc: 'sector', parcelas: 'sector',
    com: 'sector', comunidad: 'sector' };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const name = markerName[t.key];
    if (!name || used[t.start]) continue;
    let j = i + 1;
    const words = [];
    while (j < tokens.length && !isStop(tokens[j])) { words.push(tokens[j]); j++; }
    // Drop a trailing municipio name ("Bo. Caimito Guaynabo") when only the state or ZIP follows it,
    // but keep it inside a name that continues ("Urb. Sierra Bayamón, Calle 41 ...").
    const rest = tokens.slice(j).filter((x) => x.raw !== ',');
    if (rest.every((x) => /^(pr|p\.r|puerto|rico|municipio|00[679]\d{2}(-\d{4})?)$/i.test(x.key))) trimTrailingMunicipio(words);
    if (!words.length) continue;
    const s = t.start; const e = words[words.length - 1].end;
    add(name, words.map((w) => w.raw).join(' ').replace(/[.,]$/, ''), s, e);
    i = j - 1;
  }

  // 8. Streets: Spanish order (type first) and English order (type last).
  if (!components.some((c) => c.name === 'street_type')) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      // "37 c munoz rivera": a bare "c" right after the number is Calle.
      const bareC = t.key === 'c' && i > 0 && numberish(tokens[i - 1]) && tokens[i + 1] && /^\p{L}{2,}/u.test(tokens[i + 1].raw);
      const typeFirst = SPANISH_TYPES.has(t.key) || bareC || (TYPE_FIRST_ENGLISH.has(t.key) && i > 0 && numberish(tokens[i - 1]));
      if (used[t.start] || !typeFirst) continue;
      // "205 antonio r barcelo ave cayey": an English-order type after a name, followed by a place. Leave it to step 8b.
      const prevWord = i > 0 && /^\p{L}/u.test(tokens[i - 1].raw) && !used[tokens[i - 1].start] && !MARKER_WORDS.has(tokens[i - 1].key);
      const placeNext = !tokens[i + 1] || tokens[i + 1].raw === ',' || municipioAt(tokens, i + 1, { allowAfterType: true }) || postalPlaceAt(tokens, i + 1);
      if (ENGLISH_TYPES.has(t.key) && prevWord && placeNext) continue;
      const nameToks = [];
      let j = i + 1;
      if (j < tokens.length && /^\d+[a-z]?$/i.test(tokens[j].raw) && !used[tokens[j].start]) {
        nameToks.push(tokens[j]); j++; // "Calle 3"
      } else {
        while (j < tokens.length && !isStop(tokens[j]) && !isMunicipioAt(tokens, j, true) && !(nameToks.length && postalPlaceAt(tokens, j))) { nameToks.push(tokens[j]); j++; }
      }
      if (!nameToks.length) continue;
      add('street_type', bareC ? 'Calle' : TYPE_FIRST_ENGLISH.has(t.key) ? (t.key === 'avenue' ? 'Avenida' : 'Calle') : STREET_TYPES.get(t.key) ?? t.raw.replace(/\.$/, ''), t.start, t.end);
      const s = nameToks[0].start; const e = nameToks[nameToks.length - 1].end;
      add('street_name', nameToks.map((w) => w.raw).join(' ').replace(/[.,]$/, ''), s, e);
      street = { typeIndex: i, nameEnd: j - 1 };
      // A street named after a municipio ("Calle Juncos").
      if (findMunicipioIn(nameToks.map((w) => w.raw).join(' '))) {
        flag('STREET_NAMED_AFTER_MUNICIPALITY', `"${t.raw} ${nameToks.map((w) => w.raw).join(' ')}" is a street, not the municipality.`);
      }
      break;
    }
    if (!street) {
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (used[t.start] || !ENGLISH_TYPES.has(t.key)) continue;
        const nameToks = [];
        let k = i - 1;
        while (k >= 0 && !isStop(tokens[k]) && !/^\d/.test(tokens[k].raw)) { nameToks.unshift(tokens[k]); k--; }
        if (!nameToks.length) continue;
        add('street_name', nameToks.map((w) => w.raw).join(' '), nameToks[0].start, nameToks[nameToks.length - 1].end);
        add('street_type', { st: 'Calle', street: 'Calle', ave: 'Avenida', avenue: 'Avenida' }[t.key] ?? STREET_TYPES.get(t.key) ?? t.raw, t.start, t.end);
        street = { typeIndex: k + 1, nameEnd: i };
        break;
      }
    }
    if (!street && numberish(tokens[0]) && tokens[1] && /^\p{L}/u.test(tokens[1].raw) && !used[tokens[1].start]
      && !MARKER_WORDS.has(tokens[1].key)) {
      // "18 Ceiba Apt 2, ..." — a number and a name with no street type.
      const nameToks = [];
      let j = 1;
      while (j < tokens.length && !isStop(tokens[j]) && !(nameToks.length && (isMunicipioAt(tokens, j, true) || postalPlaceAt(tokens, j)))) { nameToks.push(tokens[j]); j++; }
      if (nameToks.length && nameToks.length <= 4) {
        add('street_name', nameToks.map((w) => w.raw).join(' ').replace(/[.,]$/, ''), nameToks[0].start, nameToks[nameToks.length - 1].end);
        street = { typeIndex: 1, nameEnd: j - 1, untyped: true };
        if (findMunicipioIn(nameToks.map((w) => w.raw).join(' '))) {
          flag('STREET_NAMED_AFTER_MUNICIPALITY', `"${nameToks.map((w) => w.raw).join(' ')}" is read as the street, not the municipality.`);
        }
      }
    }
  }

  // 9. Structure number: before the street, after it, or after "#".
  let numTok = null; let after = false;
  if (street) {
    const before = tokens[street.typeIndex - 1];
    const next = tokens[street.nameEnd + 1];
    const afterMarker = tokens[street.nameEnd + 2];
    if (numberish(before)) numTok = before;
    else if (numberish(next)) { numTok = next; after = true; }
    else if (next && NUMBER_MARKERS.has(next.key) && numberish(afterMarker)) { numTok = afterMarker; after = true; }
  }
  if (!numTok) {
    const hashTok = tokens.find((t) => /^#\s*\S/.test(t.raw) && numberish(t));
    if (hashTok) numTok = hashTok;
  }
  if (!numTok && !street) {
    // "Robles 61 ..." — a word followed by a number, no street type.
    for (let i = 1; i < tokens.length; i++) {
      if (numberish(tokens[i]) && /^[a-z]/i.test(tokens[i - 1].raw) && !used[tokens[i - 1].start]
        && !MARKER_WORDS.has(tokens[i - 1].key) && !isMunicipioAt(tokens, i - 1, false)) {
        add('street_name', tokens[i - 1].raw, tokens[i - 1].start, tokens[i - 1].end);
        numTok = tokens[i]; after = true;
        flag('NONSTANDARD_ORDER', 'The number follows the street name; the standard puts it first.');
        break;
      }
    }
  }
  if (!numTok) {
    const lead = tokens[0];
    if (numberish(lead)) numTok = lead;
  }
  if (numTok) {
    const raw = numTok.raw.replace(/^#/, '').replace(/,$/, '');
    const s = numTok.start + (numTok.raw.startsWith('#') ? 1 : 0);
    add('structure_number', raw.toUpperCase(), s, s + raw.length);
    if (after && street) flag('NONSTANDARD_ORDER', 'The number follows the street name; the standard puts it first.');
    if (/-/.test(raw) || /^[a-z]/i.test(raw)) {
      flag('AMBIGUOUS_NUMBER', `"${raw}" could be block and lot, or building and unit.`);
    }
  }

  // 10. City: municipio names, skipping ones used as street names.
  const cities = [];
  // In English order ("Munoz Rivera St Florida") the word after the type is the city, not the street.
  const typeComp = components.find((c) => c.name === 'street_type');
  const nameComp = components.find((c) => c.name === 'street_name');
  const englishOrder = typeComp && nameComp && nameComp.span[1] <= typeComp.span[0];
  for (let i = 0; i < tokens.length; i++) {
    if (used[tokens[i].start]) continue;
    const afterEnglishType = englishOrder && tokens[i - 1]?.start === typeComp.span[0];
    const hit = municipioAt(tokens, i, { allowAfterType: afterEnglishType });
    if (!hit) continue;
    if (i > 0 && NAME_CONNECTORS.has(tokens[i - 1].key)) continue; // "Jardines de Cayey" is a place name
    const s = tokens[i].start; const e = tokens[i + hit.len - 1].end;
    let role = 'unknown';
    const nextTok = tokens[i + hit.len];
    if (nextTok && /^municipio/i.test(nextTok.raw)) { role = 'municipality'; mark(nextTok.start, nextTok.end); }
    cities.push({ name: 'city', value: hit.muni.name, source_text: text.slice(s, e), span: [s, e], source: 'rules', role });
    mark(s, e);
    i += hit.len - 1;
  }
  if (cities.length > 1 && cities.some((c) => c.role === 'municipality')) {
    for (const c of cities) if (c.role !== 'municipality') c.role = 'postal_city';
  }
  // A known postal place anywhere in what is left ("... ave santurce").
  for (let i = 0; i < tokens.length; i++) {
    if (used[tokens[i].start]) continue;
    const len = postalPlaceAt(tokens, i);
    if (!len) continue;
    const s = tokens[i].start; const e = tokens[i + len - 1].end;
    if (!free(s, e)) continue;
    cities.push({ name: 'city', value: findPostalPlace(tokens.slice(i, i + len).map((t) => t.key).join(' ')).name, source_text: text.slice(s, e), span: [s, e], source: 'rules', role: 'postal_city' });
    mark(s, e);
    i += len - 1;
  }
  if (cities.length > 1) for (const c of cities) if (c.role === 'unknown' && findMunicipio(c.value)) c.role = 'unknown';
  // A place name right before the state or ZIP that is not a municipio: a postal city ("Río Piedras PR 00926").
  if (!cities.length) {
    const anchor = tokens.findIndex((t) => used[t.start] && components.some((c) => (c.name === 'state' || c.name === 'zip') && c.span[0] === t.start));
    if (anchor > 0) {
      const words = [];
      let k = anchor - 1;
      if (k >= 0 && tokens[k].raw === ',') k--; // "MERCEDITA, PR 00715"
      while (k >= 0 && tokens[k].raw !== ',' && !used[tokens[k].start] && /^\p{L}/u.test(tokens[k].raw) && !MARKER_WORDS.has(tokens[k].key) && words.length < 3) { words.unshift(tokens[k]); k--; }
      if (words.length && (k < 0 || tokens[k].raw === ',' || findPostalPlace(words.map((w) => w.key).join(' ')))) {
        const s = words[0].start; const e = words[words.length - 1].end;
        const typed = words.map((w) => w.raw).join(' ').replace(/[.,]$/, '');
        cities.push({ name: 'city', value: findPostalPlace(typed)?.name ?? titleCase(typed), source_text: text.slice(s, e), span: [s, e], source: 'rules', role: 'postal_city' });
        mark(s, e);
      }
    }
  }
  components.push(...cities);

  // 11. Leftover comma segments. Before or after the address: label text ("ACME OFFICE").
  //     Between address parts: most likely an urbanización written without "Urb." ("Santa Elena").
  const addrSpans = components.filter((c) => c.name !== 'label_text' && c.span).map((c) => c.span);
  const firstUsed = addrSpans.length ? Math.min(...addrSpans.map((s) => s[0])) : 0;
  const lastUsed = addrSpans.length ? Math.max(...addrSpans.map((s) => s[1])) : 0;
  let segStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === ',') {
      const seg = text.slice(segStart, i);
      const letters = [...seg].filter((ch) => /\p{L}/u.test(ch)).length;
      if (free(segStart, i) && letters >= 3 && !DESCRIPTIVE.test(seg) && addrSpans.length) {
        const lead = seg.length - seg.trimStart().length;
        const s = segStart + lead; const e = segStart + seg.trimEnd().length;
        const words = seg.trim().split(/\s+/);
        const place = findPostalPlace(seg);
        if (place && !components.some((c) => c.name === 'city' && c.role === 'postal_city')) {
          components.push({ name: 'city', value: place.name, source_text: seg.trim(), span: [s, e], source: 'rules', role: 'postal_city' });
          mark(s, e);
        } else if ((e <= firstUsed || s >= lastUsed) || /\d/.test(seg) || words.length > 5) {
          add('label_text', seg.trim(), s, e);
          flag('NON_ADDRESS_TEXT', `"${seg.trim()}" is not part of the address.`);
        } else {
          add('urbanization', seg.trim(), s, e);
          flag('UNLABELED_LOCALITY', `"${seg.trim()}" read as an urbanización; it has no "Urb." marker.`);
        }
      }
      segStart = i + 1;
    }
  }

  // 12. Class.
  const has = (n) => components.some((c) => c.name === n);
  let addressClass = 'physical_urban';
  if (has('postal_box') && !has('street_name')) addressClass = 'postal_only';
  else if (has('postal_box')) addressClass = 'mixed';
  else if (DESCRIPTIVE.test(text) && !has('structure_number')) addressClass = 'descriptive';
  else if (has('complex') && !has('street_name')) addressClass = 'complex_only';
  else if ((has('km_hm') || has('route_number')) && !has('structure_number')) addressClass = 'physical_rural';
  else if (!has('street_name') && !has('urbanization') && !has('complex') && !has('route_number')) addressClass = 'ambiguous';

  if (has('zip') && !isPrZip(components.find((c) => c.name === 'zip').value)) {
    flag('ZIP_OUT_OF_RANGE', 'The ZIP is not a Puerto Rico ZIP.');
  }

  return { address_class: addressClass, components, flags, source: 'rules' };
}

const NAME_PARTS = new Set(['street_name', 'urbanization', 'complex', 'sector', 'barrio']);
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);
/** Title-case names typed all in one case ("villa carolina", "CALLE LUNA"); mixed case is left as typed. */
export function titleCase(s) {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (!letters || (letters !== letters.toLowerCase() && letters !== letters.toUpperCase())) return s;
  return s.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

/** A known postal place (1-3 words) starting at token i: "levittown", "rio piedras", "hato rey". */
function postalPlaceAt(tokens, i) {
  for (let len = 3; len >= 1; len--) {
    const slice = tokens.slice(i, i + len);
    if (slice.length < len || slice.some((t) => t.raw === ',')) continue;
    if (findPostalPlace(slice.map((t) => t.key).join(' '))) return len;
  }
  return 0;
}

function municipioAt(tokens, i, { allowAfterType = false } = {}) {
  // Try 3-, 2- and 1-word names starting at token i.
  for (let len = 3; len >= 1; len--) {
    const slice = tokens.slice(i, i + len);
    if (slice.length < len || slice.some((t) => t.raw === ',')) continue;
    const name = slice.map((t) => t.key).join(' ').replace(/,$/, '');
    const muni = MUNICIPIOS.find((m) => m.key === name);
    if (muni) {
      const prev = tokens[i - 1];
      if (!allowAfterType && prev && (SPANISH_TYPES.has(prev.key) || ENGLISH_TYPES.has(prev.key))) return null; // "Calle Juncos"
      return { muni, len };
    }
  }
  return null;
}

function isMunicipioAt(tokens, j, atEnd) {
  const hit = municipioAt(tokens, j);
  if (!hit) return false;
  if (!atEnd) return true;
  // Treat as the city when a comma, state, ZIP, "Municipio" or the end follows it.
  const next = tokens[j + hit.len];
  return !next || next.raw === ',' || /^(pr|p\.r|puerto|municipio|00[679]\d{2}(-\d{4})?)$/i.test(next.key);
}

function trimTrailingMunicipio(words) {
  for (let len = 3; len >= 1; len--) {
    if (words.length <= len) continue;
    const tail = words.slice(words.length - len).map((w) => w.key).join(' ');
    if (MUNICIPIOS.some((m) => m.key === tail)) { words.splice(words.length - len, len); return; }
  }
}

function findMunicipioIn(s) {
  const k = fold(s).trim();
  return MUNICIPIOS.find((m) => m.key === k) ?? null;
}
