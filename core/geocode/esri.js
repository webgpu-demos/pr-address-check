// ArcGIS World Geocoding Service, findAddressCandidates limited to Puerto Rico.

import { qs } from './transport.js';

export const ESRI_URL = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
export const PR_EXTENT = { xmin: -67.95, ymin: 17.85, xmax: -65.2, ymax: 18.55 };

const PRECISION = {
  PointAddress: 'rooftop', Subaddress: 'rooftop',
  StreetAddress: 'interpolated', StreetAddressExt: 'interpolated', DistanceMarker: 'km',
  StreetInt: 'street', StreetBetween: 'street', StreetName: 'street', StreetMidBlock: 'street',
  POI: 'area', Locality: 'area', PostalLoc: 'area', PostalExt: 'area', Postal: 'area', Nbrhd: 'area',
};

export function esriUrl(query, { token, maxLocations = 5 } = {}) {
  return `${ESRI_URL}?${qs({
    SingleLine: query,
    f: 'json',
    outFields: 'Addr_type,Match_addr,AddNum,StName,StType,StPreType,Nbrhd,District,Sector,City,Subregion,Region,RegionAbbr,Postal,Score',
    maxLocations,
    countryCode: 'PRI',
    searchExtent: JSON.stringify({ ...PR_EXTENT, spatialReference: { wkid: 4326 } }),
    outSR: 4326,
    forStorage: 'false',
    token,
  })}`;
}

/** transport(url) -> parsed JSON (fetch; the service allows cross-origin calls). */
export async function esriGeocode(query, { transport, token }) {
  const data = await transport(esriUrl(query, { token }));
  if (data?.error) throw new Error(data.error.message ?? 'Esri geocoder error');
  return (data?.candidates ?? []).map((c) => {
    const a = c.attributes ?? {};
    return {
      provider: 'esri',
      query,
      matched: a.Match_addr ?? c.address ?? '',
      lon: Number(c.location?.x),
      lat: Number(c.location?.y),
      score: Number(c.score ?? a.Score ?? 0),
      precision: PRECISION[a.Addr_type] ?? 'area',
      addrType: a.Addr_type ?? '',
      parts: {
        number: a.AddNum ?? '',
        street: [a.StPreType, a.StName, a.StType].filter(Boolean).join(' '),
        streetName: a.StName ?? '',
        neighborhood: a.Nbrhd ?? '', // PR: the urbanización, "Urb X"
        district: a.District ?? '', // PR: the barrio, "Barrio X"
        sector: a.Sector ?? '',
        city: a.City ?? '',
        municipio: a.Subregion ?? '',
        zip: a.Postal ?? '',
      },
    };
  }).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
}
