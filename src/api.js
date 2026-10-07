let csrfToken = null;
export async function api(url, options = {}) {
  const headers = { 'X-Palletshipper': '1', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, credentials: 'same-origin', headers, body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw Object.assign(new Error(data.error || 'The request failed.'), { status: response.status });
  }
  if (options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase()) && /^\/api\/(pallets\/|shipments\/|challenges\/settings|auth\/profile|users\/)/.test(url)) window.dispatchEvent(new Event('challenge-scores-changed'));
  if ('csrfToken' in data) csrfToken = data.csrfToken;
  return data;
}
