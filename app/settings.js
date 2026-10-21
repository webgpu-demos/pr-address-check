// Settings: non-secret values in localStorage, keys in sessionStorage only (gone when the tab closes).

import { PROVIDERS } from '../core/providers/index.js';
import { SCHEMA_REQUIRED } from '../core/vocab.js';

const LS = 'prac.settings.v1';
const SS_KEY = (provider) => `prac.key.${provider}`;
const SS_ESRI = 'prac.esriKey';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export const DEFAULTS = {
  provider: 'anthropic',
  models: { anthropic: 'claude-haiku-5-5', openai: 'gpt-6-luna', foundry: 'claude-haiku-5-5' },
  resource: '',
  concurrency: 4,
  required: [...SCHEMA_REQUIRED],
  allowMapFill: false,
  priceOverrides: {},
  basemap: 'light',
  mode: 'ai_first',
};

export function loadSettings() {
  const saved = safe(() => JSON.parse(localStorage.getItem(LS) ?? '{}'), {});
  return { ...DEFAULTS, ...saved, models: { ...DEFAULTS.models, ...(saved.models ?? {}) } };
}

export function saveSettings(s) {
  safe(() => localStorage.setItem(LS, JSON.stringify(s)));
}

export function getKey(provider) { return safe(() => sessionStorage.getItem(SS_KEY(provider)) ?? '', ''); }
export function setKey(provider, key) {
  safe(() => (key ? sessionStorage.setItem(SS_KEY(provider), key) : sessionStorage.removeItem(SS_KEY(provider))));
}
export function getEsriKey() { return safe(() => sessionStorage.getItem(SS_ESRI) ?? '', ''); }
export function setEsriKey(key) { safe(() => (key ? sessionStorage.setItem(SS_ESRI, key) : sessionStorage.removeItem(SS_ESRI))); }

export function priceFor(s, provider, model) {
  return s.priceOverrides[`${provider}:${model}`] ?? PROVIDERS[provider]?.prices?.[model] ?? null;
}
