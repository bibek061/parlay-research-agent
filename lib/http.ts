import { createHash } from 'node:crypto';
// Provider JSON is intentionally untyped here and checked by each normalizer.
export type Raw = Record<string, any>;
const cache = new Map<string, { expires: number; body: Raw }>();
const pending = new Map<string, Promise<Raw>>();
export async function providerJson(url: URL, key = '', ttl = 300000, header = 'x-apisports-key', allowArray = false): Promise<Raw> {
  const id = `${url}:${header}:${allowArray}:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
  const saved = cache.get(id);
  if (saved && saved.expires > Date.now()) return saved.body;
  if (pending.has(id)) return pending.get(id)!;
  const work = (async () => {
    let response: Response;
    // Query authentication is added only to the outgoing URL, never the cache identity or errors.
    const requestUrl = new URL(url);
    if (header === 'query:apiKey') requestUrl.searchParams.set('apiKey', key);
    try { response = await fetch(requestUrl, { headers: key && header !== 'query:apiKey' ? { [header]: key } : {}, signal: AbortSignal.timeout(12000), redirect: 'error', cache: 'no-store' }); }
    catch { throw Error('Provider timed out or could not connect.'); }
    if (response.status === 429) throw Error('Provider request limit reached.');
    if ([401, 403].includes(response.status)) throw Error('Provider rejected access. Check the API key and subscription.');
    if (!response.ok) throw Error(`Provider returned HTTP ${response.status}.`);
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) && !allowArray) throw Error('Provider returned an invalid response.');
    if (body.errors && Object.keys(body.errors).length) {
      // Raw provider error messages may echo credentials; do not return them.
      const error = JSON.stringify(body.errors).toLowerCase();
      throw Error(/limit|quota/.test(error) ? 'Provider request limit reached.' : 'Provider rejected the parameters, API key or plan access.');
    }
    body._fetchedAt = new Date().toISOString();
    body._quotaRemaining = numberOrNull(response.headers.get('x-requests-remaining'));
    if (cache.size >= 300) cache.delete(cache.keys().next().value!);
    cache.set(id, { expires: Date.now() + ttl, body });
    return body;
  })();
  pending.set(id, work);
  try { return await work; } finally { pending.delete(id); }
}
export function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string' || typeof value === 'string' && !value.trim()) return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
export const array = (value: unknown): Raw[] => Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
