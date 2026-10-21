// End-to-end pipeline with offline fakes. Invented addresses only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAddress } from '../core/pipeline.js';
import { runGate } from '../core/gate.js';
import { tieBreak } from '../core/result.js';
import { parseRules } from '../core/rules.js';
import { INTERPRETATION_SCHEMA, validate } from '../core/schema.js';
import { EXAMPLE_INPUTS, EXAMPLE_OUTPUTS } from '../core/prompt.js';
import { fakeGis, fakeGeocoders, fakeProvider } from './fakes.js';

const INPUT = '45 Calle Lares, Urb. Santa Rita, Guaynabo PR 00969, Attn Oficina Central';
const MODEL_ANSWER = EXAMPLE_OUTPUTS[0];
const ESRI_HIT = [{ matched: '45 Calle Lares, Guaynabo, Puerto Rico, 00969', lon: -66.11, lat: 18.35, precision: 'rooftop', addrType: 'PointAddress',
  parts: { number: '45', streetName: 'Lares', street: 'Calle Lares', municipio: 'Guaynabo', city: 'Guaynabo', zip: '00969' } }];

const ctx = (extra = {}) => ({
  geocoders: fakeGeocoders({ 'esri:*': ESRI_HIT }),
  gis: fakeGis(),
  usng: async () => '19Q GA 12345 67890',
  ...extra,
});

test('few-shot examples satisfy the schema and their own source text', () => {
  EXAMPLE_OUTPUTS.forEach((o, i) => {
    assert.deepEqual(validate(INTERPRETATION_SCHEMA, o), []);
    const g = runGate(EXAMPLE_INPUTS[i], o, parseRules(EXAMPLE_INPUTS[i]));
    assert.equal(g.dropped.length, 0, `example ${i + 1}: ${JSON.stringify(g.dropped)}`);
    assert.ok(g.ok);
  });
});

test('gate drops invented parts and inferred values', () => {
  const bad = structuredClone(MODEL_ANSWER);
  bad.components.push({ name: 'barrio', value: 'Frailes', source_text: 'Bo. Frailes', inferred_from: '', role: '' });
  bad.components.push({ name: 'unit', value: 'Apt 3', source_text: '', inferred_from: 'model', role: '' });
  const g = runGate(INPUT, bad, parseRules(INPUT));
  assert.ok(g.ok);
  assert.deepEqual(g.dropped.map((d) => d.reason).sort(), ['INFERRED', 'SOURCE_TEXT_NOT_FOUND']);
  assert.ok(!g.components.some((c) => c.name === 'barrio'));
});

test('gate rejects a value that is not a reading of its source text', () => {
  const bad = structuredClone(MODEL_ANSWER);
  bad.components.find((c) => c.name === 'street_name').value = 'Luna';
  const g = runGate(INPUT, bad, parseRules(INPUT));
  assert.ok(g.dropped.some((d) => d.reason === 'VALUE_NOT_IN_SOURCE'));
});

test('gate fails on a schema violation', () => {
  const g = runGate(INPUT, { address_class: 'physical_urban', components: 'nope' }, parseRules(INPUT));
  assert.equal(g.ok, false);
  assert.equal(g.reason, 'SCHEMA');
});

test('rules only: located, record filled, barrio missing as typed', async () => {
  const r = await validateAddress(INPUT, ctx({ mode: 'rules' }));
  assert.equal(r.mode, 'rules');
  assert.equal(r.provider, '');
  assert.equal(r.location, 'rooftop');
  assert.equal(r.record.municipality, 'Guaynabo');
  assert.equal(r.record.municipio_fips, '72061');
  assert.equal(r.record.barrio, 'Pueblo Viejo');
  assert.equal(r.fields.barrio.source, 'map');
  assert.equal(r.fields.street_name.source, 'typed');
  assert.deepEqual(r.missing_required, ['barrio']);
  assert.equal(r.compliance, 'Not compliant');
  assert.equal(r.record.full_address, '45 Calle Lares, Guaynabo, Pueblo Viejo, PR 00969');
  assert.equal(r.record.usng, '19Q GA 12345 67890');
});

test('allowing map fill turns a missing barrio into a warning', async () => {
  const r = await validateAddress(INPUT, ctx({ mode: 'rules', settings: { allowMapFill: true } }));
  assert.equal(r.compliance, 'Compliant with warnings');
  assert.deepEqual(r.filled_from_map, ['barrio']);
});

test('AI first uses the verified model parse, records mode, model and cost', async () => {
  const provider = fakeProvider(MODEL_ANSWER);
  const r = await validateAddress(INPUT, ctx({ mode: 'ai_first', provider }));
  assert.equal(r.mode, 'ai_first');
  assert.equal(r.model, 'claude-haiku-5-5');
  assert.ok(r.prompt_version);
  assert.equal(r.fallback, null);
  assert.equal(r.gate.ok, true);
  assert.equal(r.fields.label_text.value, 'Attn Oficina Central');
  assert.ok(r.reasons.some((x) => x.code === 'NON_ADDRESS_TEXT' && x.source === 'model'));
  assert.ok(r.cost > 0);
  assert.equal(provider.calls.length, 1);
});

test('AI first falls back to rules when the model fails', async () => {
  const r = await validateAddress(INPUT, ctx({ mode: 'ai_first', provider: fakeProvider(null, { fail: true }) }));
  assert.equal(r.fallback.used, true);
  assert.equal(r.fallback.reason, 'MODEL_ERROR');
  assert.ok(r.reasons.some((x) => x.code === 'MODEL_FALLBACK'));
  assert.equal(r.record.street_name, 'Lares');
});

test('AI first falls back when the gate rejects the answer', async () => {
  const junk = { ...structuredClone(MODEL_ANSWER), components: MODEL_ANSWER.components.map((c) => ({ ...c, source_text: `${c.source_text} XYZ` })) };
  const r = await validateAddress(INPUT, ctx({ mode: 'ai_first', provider: fakeProvider(junk) }));
  assert.equal(r.fallback.used, true);
  assert.equal(r.fallback.reason, 'NOTHING_VERIFIED');
});

test('AI after rules adds notes and never changes the parse', async () => {
  const provider = fakeProvider({ notes: [{ code: 'OTHER', note: 'Looks fine.' }], summary: 'No issues.' });
  const rules = await validateAddress(INPUT, ctx({ mode: 'rules' }));
  const after = await validateAddress(INPUT, ctx({ mode: 'ai_after', provider }));
  assert.deepEqual(after.record, { ...rules.record });
  assert.equal(after.compliance, rules.compliance);
  assert.ok(after.reasons.some((x) => x.code === 'AI_OTHER' && x.severity === 'info'));
  assert.equal(after.review.summary, 'No issues.');
});

test('Census answers first; Esri is skipped when Census matches number and street', async () => {
  const calls = [];
  const census = [{ matched: '45 CALLE LARES, GUAYNABO, PR, 00969', lon: -66.11, lat: 18.35, precision: 'interpolated', addrType: 'StreetAddress',
    parts: { streetName: 'LARES', street: 'CALLE LARES', city: 'GUAYNABO', zip: '00969' } }];
  const r = await validateAddress(INPUT, ctx({ mode: 'rules', geocoders: fakeGeocoders({ 'census:*': census, 'esri:*': ESRI_HIT }, calls) }));
  assert.equal(r.geocode_stage, 'census');
  assert.ok(!calls.some((c) => c.provider === 'esri'));
  assert.equal(r.location, 'interpolated');
});

test('typed municipio that disagrees with the point needs review', async () => {
  const far = [{ ...ESRI_HIT[0], lon: -66.07, matched: '45 Calle Lares, San Juan, 00969', parts: { ...ESRI_HIT[0].parts, municipio: 'San Juan', zip: '00969' } }];
  const r = await validateAddress('45 Calle Lares, Guaynabo PR 00969', ctx({ mode: 'rules', geocoders: fakeGeocoders({ 'esri:*': far }) }));
  assert.equal(r.record.municipality, 'San Juan');
  assert.ok(r.reasons.some((x) => x.code === 'MUNICIPALITY_CONFLICT'));
  assert.equal(r.compliance, 'Needs review');
});

test('a match in another urbanización, ZIP and municipio is a conflict, not a location', async () => {
  const other = [{ ...ESRI_HIT[0], lon: -66.07, matched: '45 Calle Lares, Urb Pérez Morris, San Juan, 00917',
    parts: { ...ESRI_HIT[0].parts, municipio: 'San Juan', zip: '00917' } }];
  const r = await validateAddress(INPUT, ctx({ mode: 'rules', geocoders: fakeGeocoders({ 'esri:*': other }) }));
  assert.equal(r.location, 'conflict');
  assert.equal(r.record.municipality, '');
  assert.equal(r.record.lat, '');
  assert.ok(r.record.candidate_lat);
  assert.ok(r.reasons.some((x) => x.code === 'LOCATION_CONFLICT' && x.scope === 'location'));
  assert.ok(!r.reasons.some((x) => x.code === 'MUNICIPALITY_CONFLICT'));
  assert.equal(r.record.full_address, '45 Calle Lares, Guaynabo, PR 00969');
});

test('postal city with a matching ZIP is a warning, not a conflict', async () => {
  const sj = [{ ...ESRI_HIT[0], lon: -66.07, matched: '45 Calle Lares, San Juan, 00926', parts: { ...ESRI_HIT[0].parts, municipio: 'San Juan', zip: '00926' } }];
  const r = await validateAddress('45 Calle Lares, Bo. Caimito, Guaynabo PR 00926', ctx({ mode: 'rules', geocoders: fakeGeocoders({ 'esri:*': sj }) }));
  assert.ok(r.reasons.some((x) => x.code === 'POSTAL_CITY_DIFFERS'));
  assert.ok(!r.reasons.some((x) => x.code === 'MUNICIPALITY_CONFLICT'));
});

test('postal-only is its own status and is not geocoded', async () => {
  const calls = [];
  const r = await validateAddress('PO Box 4410, Cidra PR 00739', ctx({ mode: 'rules', geocoders: fakeGeocoders({}, calls) }));
  assert.equal(r.compliance, 'Postal only');
  assert.equal(r.location, 'none');
  assert.equal(calls.length, 0);
});

test('not located does not change compliance', async () => {
  const typed = '45 Calle Lares, Urb. Santa Rita, Bo. Pueblo, Guaynabo PR 00969';
  const r = await validateAddress(typed, ctx({ mode: 'rules', geocoders: fakeGeocoders({}) }));
  assert.equal(r.location, 'none');
  assert.ok(r.reasons.some((x) => x.code === 'NOT_LOCATED' && x.scope === 'location'));
  assert.equal(r.compliance, 'Compliant');
});

test('tie-break: the value the geocoder confirms wins; otherwise PARSE_DISAGREEMENT', () => {
  const model = [{ name: 'structure_number', value: '12', source_text: '12', role: '', source: 'model' }];
  const rules = [{ name: 'structure_number', value: '21', source_text: '21', role: '', source: 'rules' }];
  const d = [{ name: 'structure_number', model: '12', rules: '21' }];
  const best = { matched: '21 Calle Sol, Guaynabo', parts: { number: '21' } };
  const won = tieBreak(model, rules, d, best, null);
  assert.equal(won.components[0].value, '21');
  assert.equal(won.resolved[0].winner, 'rules');
  assert.equal(won.reasons.length, 0);
  const open = tieBreak(model, rules, d, { matched: 'Calle Sol, Guaynabo', parts: { number: '' } }, null);
  assert.equal(open.components[0].value, '12');
  assert.equal(open.reasons[0].code, 'PARSE_DISAGREEMENT');
  assert.equal(open.reasons[0].severity, 'review');
});

test('tie-break on city uses the point, not the geocoder text', () => {
  const model = [{ name: 'city', value: 'San Juan', source_text: 'San Juan', role: 'unknown', source: 'model' }];
  const rules = [{ name: 'city', value: 'Guaynabo', source_text: 'Guaynabo', role: 'unknown', source: 'rules' }];
  const place = { municipio: { name: 'San Juan' } };
  const r = tieBreak(model, rules, [{ name: 'city', model: 'San Juan', rules: 'Guaynabo' }], { matched: '', parts: {} }, place);
  assert.equal(r.resolved[0].winner, 'model');
});

test('form municipality is checked against the point; a map pick replaces geocoding', async () => {
  const calls = [];
  const r = await validateAddress('45 Calle Lares, Urb. Santa Rita', ctx({ mode: 'rules', formMunicipio: 'San Juan',
    geocoders: fakeGeocoders({ 'esri:*': ESRI_HIT }, calls) }));
  assert.equal(r.fields.city.source, 'form');
  assert.ok(r.reasons.some((x) => x.code === 'MUNICIPALITY_CONFLICT'));
  const picked = await validateAddress('45 Calle Lares, Urb. Santa Rita', ctx({ mode: 'rules', formMunicipio: 'San Juan',
    manualPoint: { lon: -66.07, lat: 18.35 }, geocoders: fakeGeocoders({}, calls) }));
  assert.equal(picked.record.municipality, 'San Juan');
  assert.equal(picked.geocode_stage, 'manual');
  assert.ok(!picked.reasons.some((x) => x.code === 'MUNICIPALITY_CONFLICT'));
});

test('enum casing from the model is normalized before the gate', () => {
  const cased = structuredClone(MODEL_ANSWER);
  cased.address_class = 'Physical_urban';
  cased.components[0].name = 'Structure_number';
  const g = runGate(INPUT, cased, parseRules(INPUT));
  assert.ok(g.ok);
  assert.equal(g.address_class, 'physical_urban');
});
