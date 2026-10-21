// OpenAI Chat Completions with strict JSON Schema output.

import { postJson, parseModelJson, ProviderError } from './http.js';

export function openaiProvider({ apiKey, model = 'gpt-6-luna', baseUrl = 'https://api.openai.com/v1', fetchImpl } = {}) {
  if (!apiKey) throw new ProviderError('No API key set for this provider.');

  async function callJson({ system, user, schema, schemaName = 'result', signal }) {
    const started = Date.now();
    const res = await postJson(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      headers: { authorization: `Bearer ${apiKey}` },
      body: {
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
      },
      fetchImpl,
      signal,
    });
    const choice = res.choices?.[0];
    if (choice?.message?.refusal) throw new ProviderError('The model declined this input.');
    if (choice?.finish_reason === 'length') throw new ProviderError('The model ran out of output tokens.');
    const u = res.usage ?? {};
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      data: parseModelJson(choice?.message?.content),
      usage: { input: (u.prompt_tokens ?? 0) - cached, output: u.completion_tokens ?? 0, cacheRead: cached, cacheWrite: 0 },
      model: res.model ?? model,
      latencyMs: Date.now() - started,
    };
  }

  return { id: 'openai', label: 'OpenAI', model, callJson };
}
