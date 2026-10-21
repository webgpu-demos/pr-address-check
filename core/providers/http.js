// Shared request helper for model providers: JSON POST with timeout and backoff on 429/5xx.

export class ProviderError extends Error {
  constructor(message, { status = 0, body = '', retryable = false } = {}) {
    super(message);
    this.status = status;
    this.body = body;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function postJson(url, { headers = {}, body, timeoutMs = 45000, retries = 3, fetchImpl, signal } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
    const onAbort = () => ctrl.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) throw err;
      if (attempt < retries) { attempt++; await sleep(800 * 2 ** attempt); continue; }
      throw new ProviderError(`Network error: ${err.message}. If this is a browser, the endpoint may not allow cross-origin calls.`, { retryable: true });
    }
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    const text = await res.text();
    if (res.ok) {
      try { return JSON.parse(text); } catch { throw new ProviderError('Response was not JSON', { status: res.status, body: text }); }
    }
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (retryable && attempt < retries) {
      const ra = Number(res.headers.get?.('retry-after'));
      attempt++;
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    let msg = text;
    try { const j = JSON.parse(text); msg = j.error?.message ?? j.message ?? text; } catch { /* keep text */ }
    throw new ProviderError(`HTTP ${res.status}: ${msg}`, { status: res.status, body: text, retryable });
  }
}

/** Parse model JSON text, tolerating a fenced block. */
export function parseModelJson(text) {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(t);
}
