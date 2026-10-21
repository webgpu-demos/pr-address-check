// The interpretation contract: what the model must return, as a portable JSON Schema.
// Portable subset: every property required, additionalProperties false, enums, no length or
// numeric limits, no recursion, no unions. Accepted by Anthropic structured outputs,
// OpenAI strict mode and Bedrock. Length and range checks happen in the gate instead.

export const PROMPT_VERSION = 'p-2026-10-21b';

export const ADDRESS_CLASSES = ['physical_urban', 'physical_rural', 'descriptive', 'complex_only',
  'postal_only', 'mixed', 'not_an_address', 'ambiguous'];

export const COMPONENT_NAMES = ['structure_number', 'street_type', 'street_name', 'route_number', 'km_hm',
  'urbanization', 'complex', 'sector', 'barrio', 'city', 'state', 'unit', 'postal_box', 'zip',
  'cadastral_id', 'label_text'];

export const FLAG_CODES = ['KM_PRESENT', 'NON_ADDRESS_TEXT', 'POSTAL_CITY_DIFFERS', 'STREET_NAMED_AFTER_MUNICIPALITY',
  'AMBIGUOUS_NUMBER', 'UNLABELED_LOCALITY', 'NONSTANDARD_ORDER', 'MULTIPLE_ADDRESSES', 'OBSOLETE_NAME'];

export const REQUIRED_NAMES = ['structure_number', 'street_type', 'street_name', 'barrio', 'city', 'state', 'zip'];

const str = { type: 'string' };
const obj = (properties) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});

export const INTERPRETATION_SCHEMA = obj({
  address_class: { type: 'string', enum: ADDRESS_CLASSES },
  components: {
    type: 'array',
    items: obj({
      name: { type: 'string', enum: COMPONENT_NAMES },
      value: str,
      source_text: str,
      inferred_from: { type: 'string', enum: ['', 'model'] },
      role: { type: 'string', enum: ['', 'municipality', 'postal_city', 'unknown'] },
    }),
  },
  missing_required: { type: 'array', items: { type: 'string', enum: REQUIRED_NAMES } },
  flags: { type: 'array', items: obj({ code: { type: 'string', enum: FLAG_CODES }, note: str }) },
  geocode_plan: { type: 'array', items: obj({ target: { type: 'string', enum: ['census', 'esri'] }, query: str }) },
  user_prompts: { type: 'array', items: str },
});

/** "AI after rules" returns review notes only; it never changes components. */
export const REVIEW_SCHEMA = obj({
  notes: { type: 'array', items: obj({ code: { type: 'string', enum: [...FLAG_CODES, 'OTHER'] }, note: str }) },
  summary: str,
});

/** Minimal validator for the subset above. Returns a list of error strings. */
export function validate(schema, value, path = '$') {
  const errors = [];
  const t = schema.type;
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected object`];
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}.${k}: missing`);
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in schema.properties)) errors.push(`${path}.${k}: not allowed`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in value) errors.push(...validate(sub, value[k], `${path}.${k}`));
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
  } else if (t === 'string') {
    if (typeof value !== 'string') return [`${path}: expected string`];
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: "${value}" not in enum`);
  }
  return errors;
}

/** Models may change the capitalization of enum values. Map case variants back to the schema's spelling. */
export function normalizeEnums(schema, value) {
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = schema.properties?.[k] ? normalizeEnums(schema.properties[k], v) : v;
    return out;
  }
  if (schema.type === 'array' && Array.isArray(value)) return value.map((v) => normalizeEnums(schema.items, v));
  if (schema.type === 'string' && schema.enum && typeof value === 'string' && !schema.enum.includes(value)) {
    return schema.enum.find((e) => e.toLowerCase() === value.toLowerCase()) ?? value;
  }
  return value;
}
