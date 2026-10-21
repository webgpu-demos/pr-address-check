#!/usr/bin/env node
// Turn samples/real-facilities.csv (public facility addresses with sources) into a batch CSV.
// Truth: the municipio the facility is in, and the source's own coordinates where it gave them.
//   node tools/make-facility-cases.mjs samples/real-facilities.csv samples/real-facilities-labels.csv > samples/real-facilities-cases.csv
import { readFileSync } from 'node:fs';
import { parseCsvObjects, toCsv } from '../core/csv.js';

const DOUBTFUL_POINTS = new Set(['f50']); // source point is ~4 km from the street address
const { rows } = parseCsvObjects(readFileSync(process.argv[2], 'utf8'));
// Hand labels for the parse: "-" means no structure number in the address; blank means not scored.
const labels = Object.fromEntries((process.argv[3] ? parseCsvObjects(readFileSync(process.argv[3], 'utf8')).rows : []).map((l) => [l.id, l]));
const kind = (f) => (/^city hall/i.test(f) ? 'city_hall' : /^post office/i.test(f) ? 'post_office' : /^courthouse/i.test(f) ? 'courthouse'
  : /^university/i.test(f) ? 'campus' : /cdt|health|hospital/i.test(f) ? 'health' : /walgreens|home depot/i.test(f) ? 'store'
  : /^bank/i.test(f) ? 'bank' : /fire/i.test(f) ? 'fire_station' : /library/i.test(f) ? 'library' : 'other');
const styles = (a) => [/\bk\.?\s?m\b|\bkm\.?\s|\bk\.\d/i.test(a) && 'km', /corner|esq\.?|junction|intersecci|&| and /i.test(a) && 'corner',
  /frente|al lado|final|marginal|antiguo/i.test(a) && 'descriptive', /\b(urb|bo|barrio)\b\.?/i.test(a) && 'locality'].filter(Boolean);
const out = rows.map((r) => ({
  id: r.id,
  input: r.address,
  form_municipio: r.municipio,
  tags: ['real', kind(r.facility), ...styles(r.address)].join(';'),
  expected_municipio: r.municipio,
  expected_zip: (r.zip || '').slice(0, 5),
  expected_structure_number: labels[r.id]?.expected_structure_number ?? '',
  expected_street_name: labels[r.id]?.expected_street_name ?? '',
  expected_lat: DOUBTFUL_POINTS.has(r.id) ? '' : r.lat,
  expected_lon: DOUBTFUL_POINTS.has(r.id) ? '' : r.lon,
  facility: r.facility,
  source_url: r.source_url,
}));
process.stdout.write(toCsv(out, ['id', 'input', 'form_municipio', 'tags', 'expected_municipio', 'expected_zip', 'expected_structure_number', 'expected_street_name', 'expected_lat', 'expected_lon', 'facility', 'source_url']));
console.error(`${out.length} cases, ${out.filter((o) => o.expected_lat).length} with source coordinates`);
