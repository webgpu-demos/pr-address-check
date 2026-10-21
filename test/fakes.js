// Test doubles: geocoders, boundaries and a model, all offline and all invented.

// A made-up square "municipio" around a point in Guaynabo, and one in San Juan next to it.
export const SQUARES = {
  guaynabo: { name: 'Guaynabo', county: '061', box: [-66.13, 18.33, -66.09, 18.37], barrio: 'Pueblo Viejo', zcta: '00969' },
  sanjuan: { name: 'San Juan', county: '127', box: [-66.09, 18.33, -66.05, 18.37], barrio: 'Caimito', zcta: '00926' },
};

export function fakeGis() {
  return {
    async lookup(lon, lat) {
      for (const s of Object.values(SQUARES)) {
        const [a, b, c, d] = s.box;
        if (lon >= a && lon <= c && lat >= b && lat <= d) {
          return {
            checked: true, inPR: true,
            municipio: { name: s.name, label: `${s.name} Municipio`, county: s.county, fips: `72${s.county}`, type: 'Municipio' },
            barrio: { name: s.barrio, label: `${s.barrio} barrio`, geoid: '72000', type: 'barrio' },
            zcta: s.zcta, shapes: {},
          };
        }
      }
      return { checked: true, inPR: false, municipio: null, barrio: null, zcta: '', shapes: {} };
    },
  };
}

/** table: { 'query text (lower)': [candidates] } with a fallback per provider. */
export function fakeGeocoders(table = {}, calls = []) {
  const make = (provider) => async (q) => {
    calls.push({ provider, q });
    const hit = table[`${provider}:${q.toLowerCase()}`] ?? table[`${provider}:*`] ?? [];
    return hit.map((c) => ({ provider, query: q, score: 100, addrType: '', parts: {}, ...c }));
  };
  return { census: make('census'), esri: make('esri') };
}

export function fakeProvider(answer, { fail = false, id = 'anthropic', model = 'claude-haiku-5-5' } = {}) {
  const calls = [];
  return {
    id, label: 'Fake', model, calls,
    async callJson(req) {
      calls.push(req);
      if (fail) throw new Error('boom');
      const data = typeof answer === 'function' ? answer(req) : answer;
      return { data: structuredClone(data), usage: { input: 1200, output: 300, cacheRead: 2800, cacheWrite: 0 }, model, latencyMs: 5 };
    },
  };
}
