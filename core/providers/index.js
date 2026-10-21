// Provider registry. Every provider exposes callJson({system, user, schema, schemaName, signal})
// returning {data, usage:{input, output, cacheRead, cacheWrite}, model, latencyMs}.

import { anthropicProvider, foundryProvider } from './anthropic.js';
import { openaiProvider } from './openai.js';
import { ProviderError } from './http.js';

export { ProviderError };

// Prices in USD per million tokens, list prices checked Oct 2026. Editable in Settings.
export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic', status: 'ready', keyLabel: 'Anthropic API key',
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    defaultModel: 'claude-haiku-5-5',
    prices: {
      'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
      'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.10, cacheWrite: 2.5 },
      'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.20, cacheWrite: 5 },
    },
  },
  openai: {
    label: 'OpenAI', status: 'ready', keyLabel: 'OpenAI API key',
    models: ['gpt-6-luna', 'gpt-6.1-sol'],
    defaultModel: 'gpt-6-luna',
    prices: {
      'gpt-6-luna': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0 },
      'gpt-6.1-sol': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 },
    },
  },
  foundry: {
    label: 'Claude on Foundry', status: 'experimental', keyLabel: 'Foundry API key', needsResource: true,
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    defaultModel: 'claude-haiku-5-5',
    prices: {},
    note: 'Browser calls depend on the resource allowing this site\'s origin. Model is the deployment name.',
  },
  bedrock: {
    label: 'Amazon Bedrock', status: 'backend', models: [], prices: {},
    note: 'Needs signed requests (SigV4), so it runs from the backend, not this page.',
  },
  webgpu: {
    label: 'In-browser (WebGPU)', status: 'planned', models: [], prices: {},
    note: 'Not enabled in round one.',
  },
};

export function createProvider(id, opts) {
  switch (id) {
    case 'anthropic': return anthropicProvider(opts);
    case 'openai': return openaiProvider(opts);
    case 'foundry': return foundryProvider(opts);
    default: throw new ProviderError(`${PROVIDERS[id]?.label ?? id} is not available on this page. ${PROVIDERS[id]?.note ?? ''}`);
  }
}

/** Cost in USD for one call's usage. Unknown prices return null rather than a wrong number. */
export function costOf(providerId, model, usage, overrides = {}) {
  const p = overrides[`${providerId}:${model}`] ?? PROVIDERS[providerId]?.prices?.[model]
    ?? PROVIDERS.anthropic.prices[model];
  if (!p || !usage) return null;
  return ((usage.input ?? 0) * p.input + (usage.output ?? 0) * p.output
    + (usage.cacheRead ?? 0) * (p.cacheRead ?? p.input * 0.1)
    + (usage.cacheWrite ?? 0) * (p.cacheWrite ?? p.input * 1.25)) / 1e6;
}

export function addUsage(a = {}, b = {}) {
  return {
    input: (a.input ?? 0) + (b.input ?? 0),
    output: (a.output ?? 0) + (b.output ?? 0),
    cacheRead: (a.cacheRead ?? 0) + (b.cacheRead ?? 0),
    cacheWrite: (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0),
  };
}
