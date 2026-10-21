// Text helpers shared by the rule parser, the gate and scoring.
// Pure functions: no browser APIs, so they run under node --test.

const COMBINING = /[̀-ͯ]/g;

/** Lower-case and strip accents: "Bayamón" -> "bayamon". */
export function fold(s) {
  return String(s ?? '').normalize('NFD').replace(COMBINING, '').toLowerCase();
}

/** Collapse whitespace. */
export function squash(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// Abbreviations and synonyms that mean the same thing in a PR address.
// Applied word by word after folding, so "Carr." "Carretera" "Road" and "PR-" compare equal.
const CANON = new Map([
  ['carr', 'pr'], ['carretera', 'pr'], ['road', 'pr'], ['rd', 'pr'], ['pr', 'pr'],
  ['bo', 'barrio'], ['barrio', 'barrio'], ['bda', 'barriada'],
  ['urb', 'urb'], ['urbanizacion', 'urb'], ['urbanization', 'urb'],
  ['ave', 'avenida'], ['av', 'avenida'], ['avenida', 'avenida'], ['avenue', 'avenida'],
  ['apt', 'apt'], ['apto', 'apt'], ['apartamento', 'apt'], ['apartment', 'apt'],
  ['ste', 'suite'], ['suite', 'suite'],
  ['cond', 'cond'], ['condominio', 'cond'], ['condominium', 'cond'],
  ['res', 'res'], ['residencial', 'res'],
  ['km', 'km'], ['kilometro', 'km'], ['k', 'km'],
  ['calle', 'calle'], ['cll', 'calle'], ['c', 'calle'], ['street', 'calle'], ['st', 'calle'],
  ['sect', 'sector'], ['sec', 'sector'], ['sector', 'sector'],
  ['ext', 'ext'], ['extension', 'ext'],
  ['parc', 'parcelas'], ['parcelas', 'parcelas'],
  ['blvd', 'boulevard'], ['bulevar', 'boulevard'], ['boulevard', 'boulevard'],
  ['cjon', 'callejon'], ['callejon', 'callejon'],
]);

/** Canonical form for comparing address text: folded, punctuation-free, abbreviations unified. */
export function canonical(s) {
  const words = fold(s)
    .replace(/#/g, ' ')
    .replace(/[^a-z0-9.\- ]+/g, ' ')
    .replace(/(\d)\.(\d)/g, '$1§$2') // keep decimal points inside numbers (Km 9.4)
    .replace(/[.]/g, ' ')
    .replace(/§/g, '.')
    .replace(/-(?=[a-z])/g, ' ')
    .replace(/\b([a-z]{2,})-(?=\d)/g, '$1 ') // "PR-165" -> "pr 165", keep block-lot "B-14"
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => CANON.get(w) ?? w);
  return words.join(' ');
}

/**
 * Find where `needle` sits in `haystack`, ignoring case and accents.
 * Returns [start, end) in the ORIGINAL haystack, or null.
 */
export function findSpan(haystack, needle) {
  const hay = String(haystack ?? '');
  const ndl = fold(needle).trim();
  if (!ndl) return null;
  // Build the folded haystack with a map back to original indexes.
  let folded = '';
  const map = [];
  for (let i = 0; i < hay.length; i++) {
    const f = fold(hay[i]);
    for (let k = 0; k < f.length; k++) { folded += f[k]; map.push(i); }
  }
  const at = folded.indexOf(ndl);
  if (at < 0) return null;
  const start = map[at];
  const end = map[at + ndl.length - 1] + 1;
  return [start, end];
}

/**
 * Is `sourceText` really in `input`? Exact (accent/case-insensitive) first,
 * then canonical-word containment so "Carr. 2" matches "Carretera 2".
 * Returns { found, span } where span may be null for a canonical-only match.
 */
export function locateSourceText(input, sourceText) {
  const span = findSpan(input, sourceText);
  if (span) return { found: true, span };
  const hay = ` ${canonical(input)} `;
  const ndl = canonical(sourceText);
  if (ndl && hay.includes(` ${ndl} `)) return { found: true, span: null };
  return { found: false, span: null };
}

/** Same value, ignoring case, accents, punctuation and known abbreviations. */
export function sameValue(a, b) {
  return canonical(a) === canonical(b);
}

/** Small stable hash (FNV-1a) for cache keys. */
export function hash(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
