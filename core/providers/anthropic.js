// Anthropic Messages API, called straight from the browser with the user's own key.
// Structured outputs (output_config.format) guarantee schema-shaped JSON.
// Also used for Claude on Microsoft Foundry, which serves the same API at a different base URL.

import { postJson, parseModelJson, ProviderError } from './http.js';

export function anthropicProvider({ apiKey, model = 'claude-haiku-5-5', baseUrl = 'https://api.anthropic.com',
  effort = 'low', maxTokens = 2000, fetchImpl, id = 'anthropic', label = 'Anthropic', extraHeaders = {} } = {}) {
  if (!apiKey) throw new ProviderError('No API key set for this provider.');
  let useThinkingOff = true;
  let useEffort = Boolean(effort);

  async function callJson({ system, user, schema, signal }) {
    const started = Date.now();
    const body = () => {
      const b = {
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema } },
      };
      if (useEffort) b.output_config.effort = effort;
      if (useThinkingOff) b.thinking = { type: 'disabled' };
      return b;
    };
    const headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...extraHeaders,
    };
    let res;
    try {
      res = await postJson(`${baseUrl.replace(/\/$/, '')}/v1/messages`, { headers, body: body(), fetchImpl, signal });
    } catch (err) {
      // Older or different models may reject thinking:disabled or effort. Retry once without them.
      if (err.status === 400 && /thinking|effort/i.test(err.body ?? err.message)) {
        useThinkingOff = false;
        if (/effort/i.test(err.body ?? err.message)) useEffort = false;
        res = await postJson(`${baseUrl.replace(/\/$/, '')}/v1/messages`, { headers, body: body(), fetchImpl, signal });
      } else throw err;
    }
    const textBlock = (res.content ?? []).find((b) => b.type === 'text');
    if (res.stop_reason === 'refusal') throw new ProviderError('The model declined this input.');
    if (res.stop_reason === 'max_tokens') throw new ProviderError('The model ran out of output tokens.');
    if (!textBlock) throw new ProviderError('No text in the model response.');
    const u = res.usage ?? {};
    return {
      data: parseModelJson(textBlock.text),
      usage: {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      },
      model: res.model ?? model,
      latencyMs: Date.now() - started,
    };
  }

  return { id, label, model, callJson };
}

/** Claude on Microsoft Foundry: same Messages API under the resource's /anthropic path. Experimental in the browser. */
export function foundryProvider({ apiKey, resource, model, ...rest } = {}) {
  if (!resource) throw new ProviderError('Set the Foundry resource name.');
  const baseUrl = /^https?:/.test(resource) ? resource.replace(/\/v1\/messages$/, '') : `https://${resource}.services.ai.azure.com/anthropic`;
  return anthropicProvider({ apiKey, model, baseUrl, id: 'foundry', label: 'Claude on Foundry', ...rest });
}
