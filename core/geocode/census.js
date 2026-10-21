// U.S. Census Bureau geocoder (onelineaddress). Matches are interpolated along TIGER street ranges.

import { qs } from './transport.js';

export const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

export function censusUrl(query) {
  return `${CENSUS_URL}?${qs({ address: query, benchmark: 'Public_AR_Current', format: 'jsonp' })}`;
}

/** transport(url) -> parsed JSON (JSONP in the browser). */
export async function censusGeocode(query, { transport }) {
  const data = await transport(censusUrl(query));
  const matches = data?.result?.addressMatches ?? [];
  return matches.map((m) => {
    const a = m.addressComponents ?? {};
    return {
      provider: 'census',
      query,
      matched: m.matchedAddress ?? '',
      lon: Number(m.coordinates?.x),
      lat: Number(m.coordinates?.y),
      score: 100,
      precision: 'interpolated',
      addrType: 'StreetAddress',
      parts: {
        number: '',
        street: [a.preType, a.streetName, a.suffixType].filter(Boolean).join(' '),
        streetName: a.streetName ?? '',
        city: a.city ?? '',
        zip: a.zip ?? '',
        from: a.fromAddress ?? '',
        to: a.toAddress ?? '',
      },
    };
  }).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
}
