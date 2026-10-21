// Reference vocabulary for Puerto Rico addresses.
// The municipio list is the fallback; at runtime the app checks it against the TIGERweb municipios it loads.

import { fold } from './text.js';

/** The 78 municipios with their county FIPS codes (state 72). */
export const MUNICIPIOS = [
  ['Adjuntas', '001'], ['Aguada', '003'], ['Aguadilla', '005'], ['Aguas Buenas', '007'],
  ['Aibonito', '009'], ['Añasco', '011'], ['Arecibo', '013'], ['Arroyo', '015'],
  ['Barceloneta', '017'], ['Barranquitas', '019'], ['Bayamón', '021'], ['Cabo Rojo', '023'],
  ['Caguas', '025'], ['Camuy', '027'], ['Canóvanas', '029'], ['Carolina', '031'],
  ['Cataño', '033'], ['Cayey', '035'], ['Ceiba', '037'], ['Ciales', '039'],
  ['Cidra', '041'], ['Coamo', '043'], ['Comerío', '045'], ['Corozal', '047'],
  ['Culebra', '049'], ['Dorado', '051'], ['Fajardo', '053'], ['Florida', '054'],
  ['Guánica', '055'], ['Guayama', '057'], ['Guayanilla', '059'], ['Guaynabo', '061'],
  ['Gurabo', '063'], ['Hatillo', '065'], ['Hormigueros', '067'], ['Humacao', '069'],
  ['Isabela', '071'], ['Jayuya', '073'], ['Juana Díaz', '075'], ['Juncos', '077'],
  ['Lajas', '079'], ['Lares', '081'], ['Las Marías', '083'], ['Las Piedras', '085'],
  ['Loíza', '087'], ['Luquillo', '089'], ['Manatí', '091'], ['Maricao', '093'],
  ['Maunabo', '095'], ['Mayagüez', '097'], ['Moca', '099'], ['Morovis', '101'],
  ['Naguabo', '103'], ['Naranjito', '105'], ['Orocovis', '107'], ['Patillas', '109'],
  ['Peñuelas', '111'], ['Ponce', '113'], ['Quebradillas', '115'], ['Rincón', '117'],
  ['Río Grande', '119'], ['Sabana Grande', '121'], ['Salinas', '123'], ['San Germán', '125'],
  ['San Juan', '127'], ['San Lorenzo', '129'], ['San Sebastián', '131'], ['Santa Isabel', '133'],
  ['Toa Alta', '135'], ['Toa Baja', '137'], ['Trujillo Alto', '139'], ['Utuado', '141'],
  ['Vega Alta', '143'], ['Vega Baja', '145'], ['Vieques', '147'], ['Villalba', '149'],
  ['Yabucoa', '151'], ['Yauco', '153'],
].map(([name, county]) => ({ name, county, fips: `72${county}`, key: fold(name) }));

const MUNI_BY_KEY = new Map(MUNICIPIOS.map((m) => [m.key, m]));

/** Look a municipio up by any spelling ("Bayamon", "BAYAMÓN", "Bayamón Municipio"). */
export function findMunicipio(name) {
  if (!name) return null;
  const k = fold(name).replace(/\s+municipio$/, '').replace(/\s+/g, ' ').trim();
  return MUNI_BY_KEY.get(k) ?? null;
}

/**
 * Postal place names that are not municipios: USPS city names and the San Juan-area places people write as a city.
 * Used only to recognize a place in the city slot; the point still decides the municipio.
 */
export const POSTAL_PLACES = ['Río Piedras', 'Hato Rey', 'Santurce', 'Condado', 'Isla Verde', 'Caparra', 'Caparra Heights',
  'Viejo San Juan', 'Old San Juan', 'Puerto Nuevo', 'Cupey', 'Levittown', 'Mercedita', 'Ángeles', 'Boquerón', 'Palmer',
  'Castañer', 'Ensenada', 'Fort Buchanan', 'Sabana Seca', 'Ramey', 'Saint Just', 'Bajadero', 'Garrochales', 'Rosario',
  'Coto Laurel', 'Aguirre', 'Punta Santiago', 'La Plata', 'Sabana Hoyos', 'Puerto Real', 'Río Blanco', 'San Antonio',
  'Ocean Park', 'Miramar', 'Trujillo Bajo', 'Mayagüez Terrace'].map((name) => ({ name, key: fold(name) }));

export function findPostalPlace(s) {
  const k = fold(s).replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  return POSTAL_PLACES.find((p) => p.key === k) ?? null;
}

/** Street types, keyed by the folded word people type, valued by the standard form. */
export const STREET_TYPES = new Map([
  ['calle', 'Calle'], ['cll', 'Calle'], ['c/', 'Calle'],
  ['avenida', 'Avenida'], ['ave', 'Avenida'], ['av', 'Avenida'], ['avenue', 'Avenida'],
  ['carretera', 'Carretera'], ['carr', 'Carretera'], ['road', 'Carretera'], ['rd', 'Carretera'],
  ['camino', 'Camino'], ['cam', 'Camino'], ['paseo', 'Paseo'], ['pso', 'Paseo'], ['callejon', 'Callejón'], ['cjon', 'Callejón'],
  ['boulevard', 'Boulevard'], ['blvd', 'Boulevard'], ['bulevar', 'Boulevard'],
  ['via', 'Vía'], ['ramal', 'Ramal'], ['pasaje', 'Pasaje'], ['sendero', 'Sendero'], ['marginal', 'Marginal'],
  ['street', 'Street'], ['st', 'Street'], ['way', 'Way'], ['drive', 'Drive'], ['dr', 'Drive'],
  ['lane', 'Lane'], ['ln', 'Lane'], ['court', 'Court'], ['ct', 'Court'], ['circle', 'Circle'],
]);

/** Locality markers: urbanización and its relatives. */
export const LOCALITY_MARKERS = [
  { re: /\b(urb\.?|urbanizaci[oó]n|urbanization)\s+/i, name: 'urbanization' },
  { re: /\b(res\.?|residencial)\s+/i, name: 'complex' },
  { re: /\b(cond\.?|condominio|condominium)\s+/i, name: 'complex' },
  { re: /\b(sector|sect\.?)\s+/i, name: 'sector' },
  { re: /\b(bo\.?|barrio)\s+/i, name: 'barrio' },
  { re: /\b(parc\.?|parcelas)\s+/i, name: 'sector' },
  { re: /\b(com\.?|comunidad)\s+/i, name: 'sector' },
];

/** Postal-only markers. */
export const POSTAL_ONLY = /\b(p\.?\s*o\.?\s*box|apartado|apdo\.?|pmb|hc[\s-]*0?\d+\s*box|rr[\s-]*0?\d+\s*box|box\s+\d+)\b/i;

/** Puerto Rico ZIP ranges: 006xx, 007xx, 009xx. */
export const PR_ZIP = /\b(00[679]\d{2})(?:-\d{4})?\b/;
export function isPrZip(zip) {
  return /^00[679]\d{2}$/.test(String(zip ?? '').trim());
}

/** Fields the current app's schema marks as required (asterisked). */
export const SCHEMA_REQUIRED = ['structure_number', 'street_name', 'street_type', 'barrio', 'city', 'state', 'zip'];

export const FIELD_LABELS = {
  structure_number: 'Structure number',
  street_type: 'Street type',
  street_name: 'Street name',
  route_number: 'Route',
  km_hm: 'KM',
  unit: 'Unit',
  urbanization: 'Urbanización',
  complex: 'Complex or condominium',
  sector: 'Sector',
  barrio: 'Barrio',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  postal_box: 'Postal box',
  cadastral_id: 'Cadastral ID',
  label_text: 'Label text',
};
