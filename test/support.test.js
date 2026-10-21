// Providers, CSV, mutations and scoring. Invented data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicProvider } from '../core/providers/anthropic.js';
import { openaiProvider } from '../core/providers/openai.js';
import { costOf } from '../core/providers/index.js';
import { parseCsv, parseCsvObjects, toCsv, guessAddressColumn } from '../core/csv.js';
import { casesFor, rng } from '../core/mutate.js';
import { scoreRow, report, wilson } from '../core/score.js';
import { parseRules } from '../core/rules.js';
import { INTERPRETATION_SCHEMA } from '../core/schema.js';
import { pointInRings } from '../core/gis/pip.js';

const okJson = (obj) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(obj) });
const errJson = (status, obj) => ({ ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify(obj) });

test('Anthropic request: browser header, structured output, cached system prompt, thinking off', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return okJson({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } });
  };
  const p = anthropicProvider({ apiKey: 'test-key', fetchImpl });
  const r = await p.callJson({ system: 'S', user: 'U', schema: INTERPRETATION_SCHEMA });
  assert.deepEqual(r.data, { a: 1 });
  assert.equal(r.usage.cacheRead, 100);
  const { url, init, body } = seen[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(init.headers['x-api-key'], 'test-key');
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.effort, 'low');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
});

test('Anthropic: retries without thinking when the model rejects it', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    if (b.thinking) return errJson(400, { error: { message: 'thinking: disabled is not supported for this model' } });
    return okJson({ content: [{ type: 'text', text: '{}' }], usage: {} });
  };
  const p = anthropicProvider({ apiKey: 'k', fetchImpl });
  await p.callJson({ system: 'S', user: 'U', schema: {} });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].thinking, undefined);
});

test('OpenAI request: strict json_schema', async () => {
  let body;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return okJson({ choices: [{ message: { content: '{"x":2}' } }], usage: { prompt_tokens: 50, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 20 } } }); };
  const r = await openaiProvider({ apiKey: 'k', fetchImpl }).callJson({ system: 'S', user: 'U', schema: INTERPRETATION_SCHEMA, schemaName: 'interpretation' });
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.temperature, undefined);
  assert.deepEqual(r.usage, { input: 30, output: 9, cacheRead: 20, cacheWrite: 0 });
});

test('cost from token counts', () => {
  const c = costOf('anthropic', 'claude-haiku-5-5', { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 });
  assert.equal(Math.round(c * 100) / 100, 0.6);
  assert.equal(costOf('foundry', 'unknown-deployment', { input: 1 }), null);
});

test('CSV round trip with quotes, commas and newlines', () => {
  const rows = [{ id: '1', input: 'Calle "Sol", 12\nPonce' }, { id: '2', input: '=cmd' }];
  const text = toCsv(rows, ['id', 'input']);
  const back = parseCsvObjects(text).rows;
  assert.equal(back[0].input, 'Calle "Sol", 12\nPonce');
  assert.equal(back[1].input, "'=cmd");
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.equal(guessAddressColumn(['id', 'Direccion'], []), 'Direccion');
});

test('point in polygon with a hole', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(pointInRings(2, 2, [outer, hole]), true);
  assert.equal(pointInRings(5, 5, [outer, hole]), false);
  assert.equal(pointInRings(11, 5, [outer, hole]), false);
});

const GT = { id: 'g1', structure_number: '18', street_type: 'Calle', street_name: 'Ceiba', unit: 'Apt 2', urbanization: 'Los Pinos',
  barrio: 'Hato Tejas', municipio: 'Bayamón', zip: '00959', lat: '18.3900', lon: '-66.1500' };

test('mutations produce labeled cases, and the rule parser reads the clean one', () => {
  const cases = casesFor(GT, { rand: rng(3), pairs: 3 });
  const clean = cases.find((c) => c.tags === 'clean');
  assert.equal(clean.input, '18 Calle Ceiba Apt 2, Urb. Los Pinos, Bo. Hato Tejas, Bayamón PR 00959');
  assert.equal(clean.expected_compliance, 'Compliant');
  const noZip = cases.find((c) => c.tags === 'drop_zip');
  assert.equal(noZip.expected_missing, 'zip');
  assert.equal(noZip.expected_compliance, 'Not compliant');
  const after = cases.find((c) => c.tags === 'number_after');
  assert.match(after.expected_flags, /NONSTANDARD_ORDER/);
  assert.ok(cases.some((c) => c.tags === 'postal_only' && c.expected_compliance === 'Postal only'));
  const p = parseRules(clean.input);
  const v = (n) => p.components.find((c) => c.name === n)?.value;
  assert.equal(v('structure_number'), '18');
  assert.equal(v('street_name'), 'Ceiba');
  assert.equal(v('barrio'), 'Hato Tejas');
  assert.equal(v('urbanization'), 'Los Pinos');
  // Same seed, same suite.
  assert.deepEqual(casesFor(GT, { rand: rng(3), pairs: 3 }), cases);
});

test('scoring buckets, flags and the report', () => {
  const kase = { id: 'c1', tags: 'number_after', input: 'x', expected_compliance: 'Compliant with warnings', expected_flags: 'NONSTANDARD_ORDER',
    expected_missing: '', expected_structure_number: '18', expected_street_name: 'Ceiba', expected_zip: '00959',
    expected_municipio: 'Bayamón', expected_lat: '18.39', expected_lon: '-66.15' };
  const result = {
    mode: 'rules', provider: '', model: '', compliance: 'Compliant with warnings', location: 'rooftop', location_label: 'Address point',
    record: { lat: 18.3901, lon: -66.1501, municipality: 'Bayamón' },
    fields: { structure_number: { value: '18' }, street_name: { value: 'Ceiba' }, zip: { value: '00959', source: 'typed' } },
    reasons: [{ code: 'NONSTANDARD_ORDER' }, { code: 'LOW_PRECISION' }], missing_required: [], latency_ms: 900, cost: null,
  };
  const row = scoreRow(kase, result);
  assert.equal(row.bucket, 'unit');
  assert.equal(row.ok_compliance, true);
  assert.equal(row.flag_tp, 1);
  assert.equal(row.flag_fp, 0);
  const rep = report([row]);
  assert.equal(rep[0].summary.buckets.unit.rate, 1);
  assert.equal(rep[0].summary.flags.recall, 1);
  const [lo, hi] = wilson(8, 10);
  assert.ok(lo > 0.44 && lo < 0.5 && hi > 0.94 && hi < 0.97);
});
