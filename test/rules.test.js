// Invented addresses only. No applicant data and none of the review's sample addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRules } from '../core/rules.js';
import { fold, canonical, locateSourceText, findSpan } from '../core/text.js';

const get = (p, name, role) => p.components.find((c) => c.name === name && (!role || c.role === role))?.value;
const flags = (p) => p.flags.map((f) => f.code);

test('text helpers', () => {
  assert.equal(fold('Bayamón'), 'bayamon');
  assert.equal(canonical('Carr. 2 Km 9.4'), canonical('Carretera 2 km 9.4'));
  assert.equal(canonical('PR-165'), 'pr 165');
  assert.deepEqual(findSpan('12 Calle Peñón', 'penon'), [9, 14]);
  assert.equal(locateSourceText('Urb. Santa Rita', 'urbanizacion santa rita').found, true);
  assert.equal(locateSourceText('45 Calle Lares', 'Calle Sol').found, false);
});

test('urban address with label text and a street named after a municipio', () => {
  const p = parseRules('45 Calle Lares, Urb. Santa Rita, Guaynabo PR 00969, Attn Oficina Central');
  assert.equal(get(p, 'structure_number'), '45');
  assert.equal(get(p, 'street_type'), 'Calle');
  assert.equal(get(p, 'street_name'), 'Lares');
  assert.equal(get(p, 'urbanization'), 'Santa Rita');
  assert.equal(get(p, 'city'), 'Guaynabo');
  assert.equal(get(p, 'zip'), '00969');
  assert.equal(get(p, 'label_text'), 'Attn Oficina Central');
  assert.ok(flags(p).includes('NON_ADDRESS_TEXT'));
  assert.ok(flags(p).includes('STREET_NAMED_AFTER_MUNICIPALITY'));
  assert.equal(p.address_class, 'physical_urban');
});

test('block-lot number after the street, unlabeled urbanización', () => {
  const p = parseRules('Calle 3 B-14, Santa Elena, Bayamón 00957');
  assert.equal(get(p, 'street_name'), '3');
  assert.equal(get(p, 'structure_number'), 'B-14');
  assert.equal(get(p, 'urbanization'), 'Santa Elena');
  assert.equal(get(p, 'city'), 'Bayamón');
  assert.ok(flags(p).includes('AMBIGUOUS_NUMBER'));
  assert.ok(flags(p).includes('UNLABELED_LOCALITY'));
  assert.ok(flags(p).includes('NONSTANDARD_ORDER'));
});

test('postal city and municipio both named', () => {
  const p = parseRules('12 Calle Sol, Bo. Pueblo, Guaynabo, San Juan Municipio, 00969');
  assert.equal(get(p, 'city', 'municipality'), 'San Juan');
  assert.equal(get(p, 'city', 'postal_city'), 'Guaynabo');
  assert.equal(get(p, 'barrio'), 'Pueblo');
});

test('route with KM and suite', () => {
  const p = parseRules('77 Road 2 Suite 210 Km 4.5, Toa Baja, 00949');
  assert.equal(get(p, 'structure_number'), '77');
  assert.equal(get(p, 'street_type'), 'Carretera');
  assert.equal(get(p, 'route_number'), '2');
  assert.equal(get(p, 'km_hm'), '4.5');
  assert.equal(get(p, 'unit'), 'Suite 210');
  assert.equal(get(p, 'city'), 'Toa Baja');
  assert.ok(flags(p).includes('KM_PRESENT'));
});

test('PR-style route is not the state', () => {
  const p = parseRules('Carr. PR-861 Km 2.1, Bo. Pájaros, Toa Alta PR 00953');
  assert.equal(get(p, 'route_number'), '861');
  assert.equal(get(p, 'state'), 'PR');
  assert.equal(get(p, 'barrio'), 'Pájaros');
  assert.equal(p.address_class, 'physical_rural');
});

test('postal-only forms', () => {
  for (const s of ['PO Box 4410, Cidra PR 00739', 'Apartado 2231, Moca PR 00676', 'HC 02 Box 8812, Lares PR 00669']) {
    const p = parseRules(s);
    assert.equal(p.address_class, 'postal_only', s);
    assert.ok(get(p, 'postal_box'), s);
  }
});

test('non-PR ZIP is flagged', () => {
  const p = parseRules('10 Calle Rosa, Ponce PR 10001');
  assert.ok(flags(p).includes('ZIP_OUT_OF_RANGE'));
});

test('descriptive address', () => {
  const p = parseRules('Frente a la iglesia, Bo. Río Abajo, Utuado');
  assert.equal(p.address_class, 'descriptive');
});

test('every rule component points at its own text', () => {
  const input = '210 Ave Las Palmas Apt 5B, Bo. Pueblo, Ponce PR 00715';
  const p = parseRules(input);
  for (const c of p.components) assert.equal(input.slice(c.span[0], c.span[1]), c.source_text, c.name);
});

test('real-world number and landmark patterns (invented addresses)', () => {
  const v = (s, n) => parseRules(s).components.find((c) => c.name === n)?.value;
  assert.equal(v('Calle Luna No. 14', 'structure_number'), '14');
  assert.equal(v('Calle Luna No. 14', 'street_name'), 'Luna');
  assert.equal(v('Calle Sol #9, Lares', 'structure_number'), '9');
  assert.equal(v('Carr. 155 Núm. 40, Morovis', 'structure_number'), '40');
  assert.equal(v('7 Calle Paz (al lado de la iglesia), Ciales', 'street_name'), 'Paz');
  assert.equal(v('7 Calle Paz (al lado de la iglesia), Ciales', 'label_text'), 'al lado de la iglesia');
  assert.equal(v('Ave. Central, Esq. Calle Rosa Pda. 12, Hato Rey', 'structure_number'), undefined);
  assert.equal(v('State Hwy #3, Km. 22.1, Humacao', 'route_number'), '3');
  assert.equal(v('State Hwy #3, Km. 22.1, Humacao', 'structure_number'), undefined);
  assert.equal(v('CARRETERA 159. K.6.H 3, COROZAL', 'km_hm'), '6.3');
  assert.equal(v('12 Calle Marina, Boqueron, PR 00622', 'city'), 'Boquerón');
  assert.equal(v('Calle Coll y Toste 12, San Juan', 'street_name'), 'Coll y Toste');
  assert.equal(v('300 Roble Avenue, Ceiba', 'street_type'), 'Avenida');
});
