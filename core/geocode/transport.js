// Network transports. The Census geocoder sends no CORS headers, so the browser uses JSONP.
// Everything else tries fetch first and falls back to JSONP for ArcGIS REST endpoints.

let seq = 0;

export function jsonp(url, { timeoutMs = 20000, param = 'callback' } = {}) {
  if (typeof document === 'undefined') return Promise.reject(new Error('JSONP needs a browser'));
  return new Promise((resolve, reject) => {
    const name = `__jsonp_${Date.now().toString(36)}_${seq++}`;
    const script = document.createElement('script');
    const cleanup = () => { delete window[name]; script.remove(); clearTimeout(timer); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Request timed out')); }, timeoutMs);
    window[name] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('Request failed')); };
    script.src = `${url}${url.includes('?') ? '&' : '?'}${param}=${name}`;
    document.head.appendChild(script);
  });
}

export async function fetchJson(url, { timeoutMs = 20000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/** ArcGIS REST: fetch, then JSONP if the server blocks cross-origin reads. */
export async function arcgisJson(url, opts = {}) {
  try { return await fetchJson(url, opts); }
  catch (err) {
    if (typeof document === 'undefined' || /HTTP 4\d\d/.test(err.message)) throw err;
    return jsonp(url, opts);
  }
}

export function qs(params) {
  return Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
