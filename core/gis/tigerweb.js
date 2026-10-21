// Census TIGERweb boundaries for Puerto Rico: municipios, barrios and ZCTAs.
// Loads each layer once per session and answers point lookups locally.
// If a bulk load fails, falls back to asking the server about the single point.

import { qs } from '../geocode/transport.js';
import { buildIndex, locateIn } from './pip.js';

export const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer';
export const LAYERS = {
  municipio: { id: 82, where: "STATE='72'", fields: 'GEOID,STATE,COUNTY,BASENAME,NAME,LSADC' },
  barrio: { id: 22, where: "STATE='72'", fields: 'GEOID,STATE,COUNTY,COUSUB,BASENAME,NAME,LSADC' },
  zcta: { id: 2, where: "GEOID LIKE '006%' OR GEOID LIKE '007%' OR GEOID LIKE '009%'", fields: 'GEOID,ZCTA5,BASENAME' },
};

export function layerQueryUrl(key, { geometry = true, offset = 0.00008 } = {}) {
  const l = LAYERS[key];
  return `${TIGERWEB}/${l.id}/query?${qs({
    where: l.where,
    outFields: l.fields,
    returnGeometry: geometry ? 'true' : 'false',
    outSR: 4326,
    maxAllowableOffset: geometry ? offset : undefined,
    geometryPrecision: geometry ? 5 : undefined,
    f: 'json',
  })}`;
}

export function pointQueryUrl(key, lon, lat) {
  const l = LAYERS[key];
  return `${TIGERWEB}/${l.id}/query?${qs({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    where: l.where,
    outFields: l.fields,
    returnGeometry: 'false',
    f: 'json',
  })}`;
}

function describeMunicipio(a) {
  if (!a) return null;
  return {
    name: a.BASENAME, label: a.NAME, county: a.COUNTY, fips: `${a.STATE}${a.COUNTY}`,
    type: /municipio$/i.test(a.NAME ?? '') ? 'Municipio' : (a.NAME ?? '').replace(a.BASENAME ?? '', '').trim() || 'Municipio',
  };
}

function describeBarrio(a) {
  if (!a || a.COUSUB === '00000') return null;
  const type = /barrio-pueblo$/i.test(a.NAME ?? '') ? 'barrio-pueblo' : 'barrio';
  return { name: a.BASENAME, label: a.NAME, geoid: a.GEOID, cousub: a.COUSUB, county: a.COUNTY, type };
}

export function createGis({ transport, onProgress } = {}) {
  const index = { municipio: null, barrio: null, zcta: null };
  const failed = {};
  const loads = {};

  function load(key) {
    if (!loads[key]) {
      loads[key] = transport(layerQueryUrl(key))
        .then((data) => {
          if (data?.error) throw new Error(data.error.message);
          index[key] = buildIndex(data.features ?? []);
          onProgress?.(key, index[key].length);
          return index[key];
        })
        .catch((err) => { failed[key] = String(err.message ?? err); onProgress?.(key, -1); return null; });
    }
    return loads[key];
  }

  async function find(key, lon, lat) {
    await load(key);
    if (index[key]) {
      const f = locateIn(index[key], lon, lat);
      return f ? { attributes: f.attributes, rings: f.rings } : null;
    }
    try {
      const data = await transport(pointQueryUrl(key, lon, lat));
      const f = data?.features?.[0];
      return f ? { attributes: f.attributes, rings: null } : null;
    } catch { return undefined; } // undefined = could not check
  }

  async function lookup(lon, lat) {
    const [m, b, z] = await Promise.all([find('municipio', lon, lat), find('barrio', lon, lat), find('zcta', lon, lat)]);
    return {
      checked: m !== undefined,
      inPR: Boolean(m),
      municipio: describeMunicipio(m?.attributes),
      barrio: describeBarrio(b?.attributes),
      zcta: z?.attributes ? (z.attributes.ZCTA5 ?? z.attributes.GEOID) : '',
      shapes: { municipio: m?.rings ?? null, barrio: b?.rings ?? null },
    };
  }

  return {
    preload: () => Promise.all(Object.keys(LAYERS).map(load)),
    load,
    features: (key) => index[key],
    lookup,
    status: () => ({ loaded: Object.fromEntries(Object.entries(index).map(([k, v]) => [k, v?.length ?? 0])), failed }),
  };
}
