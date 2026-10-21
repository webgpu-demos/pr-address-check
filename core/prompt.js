// The model prompt. The system text is stable across calls so providers can cache it;
// only the user message changes per address. Examples are invented, never real applicant data.

import { MUNICIPIOS } from './vocab.js';
import { PROMPT_VERSION } from './schema.js';

export { PROMPT_VERSION };

const EXAMPLES = [
  {
    input: '45 Calle Lares, Urb. Santa Rita, Guaynabo PR 00969, Attn Oficina Central',
    output: {
      address_class: 'physical_urban',
      components: [
        { name: 'structure_number', value: '45', source_text: '45', inferred_from: '', role: '' },
        { name: 'street_type', value: 'Calle', source_text: 'Calle', inferred_from: '', role: '' },
        { name: 'street_name', value: 'Lares', source_text: 'Lares', inferred_from: '', role: '' },
        { name: 'urbanization', value: 'Santa Rita', source_text: 'Urb. Santa Rita', inferred_from: '', role: '' },
        { name: 'city', value: 'Guaynabo', source_text: 'Guaynabo', inferred_from: '', role: 'unknown' },
        { name: 'state', value: 'PR', source_text: 'PR', inferred_from: '', role: '' },
        { name: 'zip', value: '00969', source_text: '00969', inferred_from: '', role: '' },
        { name: 'label_text', value: 'Attn Oficina Central', source_text: 'Attn Oficina Central', inferred_from: '', role: '' },
      ],
      missing_required: ['barrio'],
      flags: [
        { code: 'STREET_NAMED_AFTER_MUNICIPALITY', note: 'Lares is the street name here, not the municipality.' },
        { code: 'NON_ADDRESS_TEXT', note: '"Attn Oficina Central" is a delivery label, not part of the address.' },
      ],
      geocode_plan: [
        { target: 'census', query: '45 Calle Lares, Urb Santa Rita, Guaynabo, PR 00969' },
        { target: 'esri', query: '45 Calle Lares, Santa Rita, Guaynabo, Puerto Rico 00969' },
      ],
      user_prompts: ['Add the barrio.'],
    },
  },
  {
    input: 'carr 412 km 3.2 bo caimital alto, aguadilla',
    output: {
      address_class: 'physical_rural',
      components: [
        { name: 'street_type', value: 'Carretera', source_text: 'carr', inferred_from: '', role: '' },
        { name: 'route_number', value: '412', source_text: '412', inferred_from: '', role: '' },
        { name: 'street_name', value: '412', source_text: '412', inferred_from: '', role: '' },
        { name: 'km_hm', value: '3.2', source_text: 'km 3.2', inferred_from: '', role: '' },
        { name: 'barrio', value: 'Caimital Alto', source_text: 'bo caimital alto', inferred_from: '', role: '' },
        { name: 'city', value: 'Aguadilla', source_text: 'aguadilla', inferred_from: '', role: 'unknown' },
        { name: 'state', value: 'PR', source_text: '', inferred_from: 'model', role: '' },
      ],
      missing_required: ['structure_number', 'zip'],
      flags: [{ code: 'KM_PRESENT', note: 'KM 3.2 locates the road segment; the standard still needs a structure number.' }],
      geocode_plan: [
        { target: 'esri', query: 'Carr 412 KM 3.2, Caimital Alto, Aguadilla, Puerto Rico' },
        { target: 'census', query: 'Carr 412 Km 3.2, Aguadilla, PR' },
      ],
      user_prompts: ['Add the structure number posted on the house.', 'Add the ZIP code.'],
    },
  },
  {
    input: 'Calle 7 G-22, Villa del Mar, Carolina 00979',
    output: {
      address_class: 'physical_urban',
      components: [
        { name: 'street_type', value: 'Calle', source_text: 'Calle', inferred_from: '', role: '' },
        { name: 'street_name', value: '7', source_text: '7', inferred_from: '', role: '' },
        { name: 'structure_number', value: 'G-22', source_text: 'G-22', inferred_from: '', role: '' },
        { name: 'urbanization', value: 'Villa del Mar', source_text: 'Villa del Mar', inferred_from: '', role: '' },
        { name: 'city', value: 'Carolina', source_text: 'Carolina', inferred_from: '', role: 'unknown' },
        { name: 'zip', value: '00979', source_text: '00979', inferred_from: '', role: '' },
        { name: 'state', value: 'PR', source_text: '', inferred_from: 'model', role: '' },
      ],
      missing_required: ['barrio'],
      flags: [
        { code: 'AMBIGUOUS_NUMBER', note: '"G-22" reads as block G, lot 22, typical of an urbanización.' },
        { code: 'UNLABELED_LOCALITY', note: '"Villa del Mar" has no "Urb." marker but sits where an urbanización goes.' },
        { code: 'NONSTANDARD_ORDER', note: 'The number follows the street; the standard puts it first.' },
      ],
      geocode_plan: [
        { target: 'census', query: 'G22 Calle 7, Urb Villa del Mar, Carolina, PR 00979' },
        { target: 'esri', query: 'Calle 7 G-22, Villa del Mar, Carolina, Puerto Rico 00979' },
      ],
      user_prompts: ['Confirm "G-22" is block and lot.', 'Add the barrio.'],
    },
  },
  {
    input: 'PO Box 3381, Cayey PR 00737',
    output: {
      address_class: 'postal_only',
      components: [
        { name: 'postal_box', value: 'PO Box 3381', source_text: 'PO Box 3381', inferred_from: '', role: '' },
        { name: 'city', value: 'Cayey', source_text: 'Cayey', inferred_from: '', role: 'postal_city' },
        { name: 'state', value: 'PR', source_text: 'PR', inferred_from: '', role: '' },
        { name: 'zip', value: '00737', source_text: '00737', inferred_from: '', role: '' },
      ],
      missing_required: ['structure_number', 'street_type', 'street_name', 'barrio'],
      flags: [],
      geocode_plan: [],
      user_prompts: ['A PO box is a mailing address. Enter the physical address of the property.'],
    },
  },
  {
    input: 'frente a la escuela vieja, sector la loma, bo. jagüeyes, aguas buenas',
    output: {
      address_class: 'descriptive',
      components: [
        { name: 'sector', value: 'La Loma', source_text: 'sector la loma', inferred_from: '', role: '' },
        { name: 'barrio', value: 'Jagüeyes', source_text: 'bo. jagüeyes', inferred_from: '', role: '' },
        { name: 'city', value: 'Aguas Buenas', source_text: 'aguas buenas', inferred_from: '', role: 'unknown' },
        { name: 'label_text', value: 'frente a la escuela vieja', source_text: 'frente a la escuela vieja', inferred_from: '', role: '' },
        { name: 'state', value: 'PR', source_text: '', inferred_from: 'model', role: '' },
      ],
      missing_required: ['structure_number', 'street_type', 'street_name', 'zip'],
      flags: [{ code: 'NON_ADDRESS_TEXT', note: '"frente a la escuela vieja" is a landmark description, not an address part.' }],
      geocode_plan: [{ target: 'esri', query: 'Sector La Loma, Jagüeyes, Aguas Buenas, Puerto Rico' }],
      user_prompts: ['Add the road or street and the structure number.'],
    },
  },
  {
    input: '210 Ave Las Palmas Apt 5B, Bo. Pueblo, Ponce Municipio, Mercedita PR 00715',
    output: {
      address_class: 'physical_urban',
      components: [
        { name: 'structure_number', value: '210', source_text: '210', inferred_from: '', role: '' },
        { name: 'street_type', value: 'Avenida', source_text: 'Ave', inferred_from: '', role: '' },
        { name: 'street_name', value: 'Las Palmas', source_text: 'Las Palmas', inferred_from: '', role: '' },
        { name: 'unit', value: 'Apt 5B', source_text: 'Apt 5B', inferred_from: '', role: '' },
        { name: 'barrio', value: 'Pueblo', source_text: 'Bo. Pueblo', inferred_from: '', role: '' },
        { name: 'city', value: 'Ponce', source_text: 'Ponce Municipio', inferred_from: '', role: 'municipality' },
        { name: 'city', value: 'Mercedita', source_text: 'Mercedita', inferred_from: '', role: 'postal_city' },
        { name: 'state', value: 'PR', source_text: 'PR', inferred_from: '', role: '' },
        { name: 'zip', value: '00715', source_text: '00715', inferred_from: '', role: '' },
      ],
      missing_required: [],
      flags: [{ code: 'POSTAL_CITY_DIFFERS', note: 'Mercedita is the postal place name; the municipality is Ponce.' }],
      geocode_plan: [
        { target: 'census', query: '210 Ave Las Palmas, Ponce, PR 00715' },
        { target: 'esri', query: '210 Avenida Las Palmas, Ponce, Puerto Rico 00715' },
      ],
      user_prompts: [],
    },
  },
];

const RULES = `You read one Puerto Rico address as typed by an applicant and return its parts as JSON.
You never correct, complete or guess the address. You only label what is there.

Hard rules
1. source_text is copied character for character from the input (case and accents as typed). If a part is not in the input, leave it out; the only exception is state "PR" with source_text "" and inferred_from "model" when the address is clearly in Puerto Rico.
2. value is the standard form of the same text: "Calle", "Avenida", "Carretera" for street types; title case for names; digits only for ZIP.
3. Never invent a structure number, ZIP, barrio or street. Missing parts go in missing_required (only from its enum).
4. A municipio name inside a street name ("Calle Lares") is the street, not the city. Flag STREET_NAMED_AFTER_MUNICIPALITY.
5. city role: "municipality" when written as "X Municipio" or the address names two places and X is the municipio; "postal_city" for a place name that is not one of the 78 municipios (Río Piedras, Hato Rey, Mercedita, Levittown), or for a PO box city; otherwise "unknown". Keep the place as typed: Río Piedras stays Río Piedras, never San Juan. A place name in the city position (just before the state or ZIP) that is not a municipio is a postal_city, not a barrio.
6. Delivery labels, company or office names, "Attn" lines and landmark descriptions are label_text with flag NON_ADDRESS_TEXT.
7. Routes: "Carr. 2", "Road 165", "PR-165" are street_type "Carretera" with street_name and route_number both set to the route number.
8. KM or HM marks are km_hm with flag KM_PRESENT; write the value as a decimal kilometer ("Km 10 Hm 5" -> "10.5"). They do not replace a structure number.
8b. "Pda. 37" or "Parada 37" is a bus stop, a landmark: label_text, never a structure number. "#25", "No. 25", "Núm. 25" are the structure number.
9. "B-14" or "G-22" style numbers are structure_number with flag AMBIGUOUS_NUMBER.
10. A name between the street and the city with no marker is usually an urbanización: name it urbanization and flag UNLABELED_LOCALITY.
11. PO Box, Apartado, HC or RR box: postal_box. Only a box and no street: address_class "postal_only".
12. More than one address in the input: flag MULTIPLE_ADDRESSES and parse the first.
13. geocode_plan: up to 3 queries built only from the parts you found, without label_text, best first. Census wants "number type name, Urb name, city, PR zip". Esri accepts free text; write routes as "Carr 2 KM 47.7" and urbanizaciones as "Urb Name". Leave it empty for postal_only or not_an_address.
14. user_prompts: short instructions to the applicant, one per missing or doubtful part, in plain English.

address_class: physical_urban (street and number), physical_rural (route or KM, no number), descriptive (landmark directions), complex_only (residencial or condominio without a street), postal_only, mixed (box plus street), not_an_address, ambiguous.

The 78 municipios: ${MUNICIPIOS.map((m) => m.name).join(', ')}.`;

export function systemPrompt() {
  const shots = EXAMPLES.map((e, i) => `Example ${i + 1}\nInput: ${e.input}\nOutput: ${JSON.stringify(e.output)}`).join('\n\n');
  return `${RULES}\n\nInvented examples\n\n${shots}`;
}

export function userMessage(input) {
  return `Input: ${String(input).slice(0, 500)}`;
}

/** AI-after-rules: the model reviews the rule parse and returns notes only. */
export function reviewSystemPrompt() {
  return `You review a rule parser's reading of one Puerto Rico address.
Return notes about anything the parser likely got wrong or missed, using the flag codes where they fit and OTHER otherwise.
You never rewrite the address or its parts. Keep each note to one sentence. If nothing looks wrong, return no notes and say so in summary.
${RULES.split('\n\n')[1]}`;
}

export function reviewMessage(input, rulesParse) {
  const parts = rulesParse.components.map((c) => `${c.name}${c.role ? `(${c.role})` : ''}: ${c.value}`).join('; ');
  return `Input: ${String(input).slice(0, 500)}\nParser read: ${parts}\nParser flags: ${rulesParse.flags.map((f) => f.code).join(', ') || 'none'}`;
}

export const EXAMPLE_INPUTS = EXAMPLES.map((e) => e.input);
export const EXAMPLE_OUTPUTS = EXAMPLES.map((e) => e.output);
