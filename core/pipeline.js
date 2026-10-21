// The pipeline in three modes. Every result records the mode it ran in.
//   rules        rule parser -> geocode -> point checks
//   ai_after     rules path, then the model reviews the parse and adds notes (it changes nothing)
//   ai_first     model interprets -> gate -> geocode with model and raw queries -> tie-break -> point checks
//                Falls back to the rules path when the model fails or the gate rejects its answer.

import { parseRules } from './rules.js';
import { runGate } from './gate.js';
import { squash } from './text.js';
import { INTERPRETATION_SCHEMA, REVIEW_SCHEMA, PROMPT_VERSION, validate, normalizeEnums } from './schema.js';
import { systemPrompt, userMessage, reviewSystemPrompt, reviewMessage } from './prompt.js';
import { runQueries, geocodeStaged } from './geocode/orchestrate.js';
import { buildResult, tieBreak } from './result.js';
import { costOf } from './providers/index.js';
import { findMunicipio } from './vocab.js';

export const MODES = {
  rules: { label: 'Rules only', usesModel: false },
  ai_after: { label: 'AI after rules', usesModel: true },
  ai_first: { label: 'AI first', usesModel: true },
};

export const MAX_INPUT = 500;

export async function validateAddress(rawInput, ctx) {
  const { mode = 'rules', provider = null, geocoders, gis, usng, settings = {}, signal, formMunicipio = '', manualPoint = null, priorModel = null, priorReview = null } = ctx;
  const t0 = Date.now();
  const input = squash(rawInput).slice(0, MAX_INPUT);
  const rulesParse = parseRules(input);

  let comps = rulesParse.components;
  let flags = rulesParse.flags;
  let addressClass = rulesParse.address_class;
  let parseSource = 'rules';
  let gate = null;
  let review = null;
  let fallback = null;
  let usage = null;
  let modelName = provider?.model ?? '';
  let modelPlan = [];
  let userPrompts = [];
  const extraReasons = [];
  let preRun = { candidates: [], errors: [] };
  let preQueries = [];

  const needsModel = mode !== 'rules';
  if (needsModel && !provider) {
    fallback = { used: true, reason: 'NO_PROVIDER', detail: 'No model provider is set up.' };
  }

  if (mode === 'ai_first' && provider) {
    // The raw string goes to the geocoders while the model reads it.
    preQueries = [{ target: 'census', query: input, origin: 'raw' }];
    const rawPromise = runQueries(preQueries, geocoders);
    try {
      // A re-run (e.g. after a map pick) reuses the model's earlier answer instead of paying for it again.
      const res = priorModel ?? await provider.callJson({
        system: systemPrompt(), user: userMessage(input), schema: INTERPRETATION_SCHEMA, schemaName: 'interpretation', signal,
      });
      usage = priorModel ? null : res.usage;
      modelName = res.model || modelName;
      gate = runGate(input, res.data, rulesParse);
      gate.raw = res.data;
      if (gate.ok) {
        comps = gate.components;
        flags = gate.flags;
        addressClass = gate.address_class;
        parseSource = 'model';
        modelPlan = gate.geocode_plan;
        userPrompts = gate.user_prompts;
      } else {
        fallback = { used: true, reason: gate.reason, detail: gate.errors.join('; ') || gate.dropped.map((d) => `${d.component.name}: ${d.reason}`).join('; ') };
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      fallback = { used: true, reason: 'MODEL_ERROR', detail: String(err.message ?? err) };
    }
    preRun = await rawPromise;
  }
  if (fallback?.used) {
    // A failed model call says nothing about the address, so it never changes compliance.
    extraReasons.push({ code: 'MODEL_FALLBACK', severity: 'info', maturity: 'core', source: 'gate',
      text: `Rules-only result: ${fallback.reason === 'MODEL_ERROR' ? 'the model call failed' : fallback.reason === 'NO_PROVIDER' ? 'no model is set up' : 'the model answer did not pass the gate'}.` });
  }
  if (gate?.dropped?.length && gate.ok) {
    extraReasons.push({ code: 'GATE_DROPPED', severity: 'info', maturity: 'experimental', source: 'gate',
      text: `Set aside ${gate.dropped.length} model part(s) not found in the input: ${gate.dropped.map((d) => d.component.name).join(', ')}.` });
  }

  // The municipality picked in the form is typed input too. The point still decides.
  const formMuni = findMunicipio(formMunicipio);
  if (formMuni && !comps.some((c) => c.name === 'city' && c.role === 'municipality')) {
    comps = [...comps.map((c) => (c.name === 'city' && c.role === 'unknown' && findMunicipio(c.value)?.name !== formMuni.name ? { ...c, role: 'postal_city' } : c)),
      { name: 'city', value: formMuni.name, source_text: formMuni.name, span: null, source: 'form', role: 'municipality' }];
  }

  // Geocode: Census first with the raw string and parse-built queries, Esri when Census falls short.
  // A postal-only address has no location to find. A reviewer's map pick replaces geocoding.
  const geo = manualPoint
    ? { queries: [], candidates: [], errors: [], ambiguous: false, rival: null, stage: 'manual', censusHit: false,
      best: { provider: 'manual', matched: 'Picked on the map', lon: manualPoint.lon, lat: manualPoint.lat, score: 100, precision: 'rooftop',
        addrType: 'Manual', parts: {}, consistency: {}, effectivePrecision: 4 }, ranked: [] }
    : addressClass === 'postal_only'
    ? { queries: preQueries, candidates: [], errors: [], best: null, ambiguous: false, rival: null, ranked: [], stage: '', censusHit: false }
    : await geocodeStaged(input, comps, modelPlan, geocoders, { queries: preQueries, ...preRun });
  const { best, ambiguous, rival, ranked, conflictAlt = null } = geo;

  const place = best && gis ? await gis.lookup(best.lon, best.lat) : null;

  // Tie-break parser disagreements with the point.
  if (gate?.ok && gate.disagreements.length) {
    const tb = tieBreak(comps, rulesParse.components, gate.disagreements, best, place);
    comps = tb.components;
    extraReasons.push(...tb.reasons);
    gate.resolved = tb.resolved;
  }

  // AI after rules: the model reviews the rule parse. Notes are advisory and never change the record.
  if (mode === 'ai_after' && provider) {
    try {
      const res = priorReview ?? await provider.callJson({
        system: reviewSystemPrompt(), user: reviewMessage(input, rulesParse), schema: REVIEW_SCHEMA, schemaName: 'review', signal,
      });
      usage = priorReview ? null : res.usage;
      modelName = res.model || modelName;
      const data = normalizeEnums(REVIEW_SCHEMA, res.data);
      const errs = validate(REVIEW_SCHEMA, data);
      review = errs.length ? { notes: [], summary: '', errors: errs } : data;
      for (const n of review.notes ?? []) {
        extraReasons.push({ code: `AI_${n.code}`, severity: 'info', maturity: 'experimental', source: 'model', text: n.note });
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      review = { notes: [], summary: '', error: String(err.message ?? err) };
      extraReasons.push({ code: 'MODEL_FALLBACK', severity: 'info', maturity: 'core', source: 'gate', text: 'The model review failed; rules-only result.' });
    }
  }

  let usngText = '';
  if (best && place?.inPR && usng) {
    try { usngText = await usng(best.lat, best.lon); } catch { usngText = ''; }
  }

  const providerId = needsModel && provider ? provider.id : '';
  return buildResult({
    input,
    mode,
    providerId,
    model: needsModel && provider ? modelName : '',
    promptVersion: needsModel && provider ? PROMPT_VERSION : '',
    components: comps,
    flags,
    addressClass,
    parseSource,
    inferredState: comps.some((c) => c.name === 'state'),
    best,
    ambiguous,
    rival,
    conflictAlt,
    candidates: ranked,
    queries: geo.queries,
    geocodeErrors: geo.errors,
    geocodeStage: geo.stage,
    censusHit: geo.censusHit,
    place,
    usng: usngText,
    gate: gate ? { ok: gate.ok, reason: gate.reason, dropped: gate.dropped, droppedFlags: gate.droppedFlags ?? [], disagreements: gate.disagreements, resolved: gate.resolved ?? [], raw: gate.raw } : null,
    review,
    fallback,
    usage,
    cost: usage ? costOf(providerId, modelName, usage, settings.priceOverrides) : null,
    latencyMs: Date.now() - t0,
    userPrompts,
    extraReasons,
    settings,
    modelFlags: review ? (review.notes ?? []).map((n) => n.code) : [],
  });
}
