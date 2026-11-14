import type { Health, Kind, Listing, ListingDetail, SavedSearch } from './types';
import saleScored from '@fixtures/listing-sale-scored.json';
import sale from '@fixtures/listing-sale.json';
import rent from '@fixtures/listing-rent.json';

/**
 * Same-origin API (server.mjs). Every read falls back to the fixtures in data/fixtures when the server
 * is unreachable, so the UI always has something to render; `source` says which one you got.
 */
export type Source = 'live' | 'fixtures';
export interface Result<T> { data: T; source: Source }

const FIXTURES = [saleScored, sale, rent] as unknown as Listing[];

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${path}`);
  // In dev without a backend, Vite answers unknown paths with index.html; treat that as "server down".
  if (!res.headers.get('content-type')?.includes('application/json')) throw new HttpError(0, `not json: ${path}`);
  return res.json() as Promise<T>;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export async function getListings(kind?: Kind, limit = 50, signal?: AbortSignal): Promise<Result<Listing[]>> {
  const qs = new URLSearchParams({ limit: String(limit), ...(kind ? { kind } : {}) });
  try {
    const { items } = await getJson<{ items: Listing[] }>(`/api/listings?${qs}`, signal);
    return { data: items, source: 'live' };
  } catch (e) {
    if (isAbort(e)) throw e;
    return { data: FIXTURES.filter((l) => !kind || l.kind === kind), source: 'fixtures' };
  }
}

export async function getListing(id: string, signal?: AbortSignal): Promise<Result<ListingDetail | null>> {
  try {
    return { data: await getJson<ListingDetail>(`/api/listings/${encodeURIComponent(id)}`, signal), source: 'live' };
  } catch (e) {
    if (isAbort(e)) throw e;
    if (e instanceof HttpError && e.status === 404) return { data: null, source: 'live' };
    const l = FIXTURES.find((f) => f._id === id);
    return { data: l ? { ...l, calls: [] } : null, source: 'fixtures' };
  }
}

export async function getHealth(signal?: AbortSignal): Promise<Result<Health | null>> {
  try {
    return { data: await getJson<Health>('/api/health', signal), source: 'live' };
  } catch (e) {
    if (isAbort(e)) throw e;
    return { data: null, source: 'fixtures' };
  }
}

// ---------- auth (cookie session, same origin; docs/contracts.md §4) ----------
export interface ApiUser { id: string; email: string; name: string | null; searches: SavedSearch[] }

/** JSON request that throws HttpError with the server's `{ error }` message. status 0 = server unreachable. */
async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new HttpError(0, 'Can’t reach the server');
  }
  const json = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
  // A non-JSON reply (e.g. Vite's dev proxy with no backend) means there's no API behind us.
  if (json == null) throw new HttpError(res.ok ? 0 : res.status >= 500 ? 0 : res.status, 'Can’t reach the server');
  if (!res.ok) throw new HttpError(res.status, (json as { error?: string }).error ?? `${method} ${path} failed (${res.status})`);
  return json as T;
}

/** GET /api/me → the signed-in user, or null on 401. Throws HttpError(0) when the server is unreachable. */
export async function getMe(): Promise<ApiUser | null> {
  try {
    return (await send<{ user: ApiUser }>('GET', '/api/me')).user;
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return null;
    throw e;
  }
}

/** POST /api/users. With `password` it creates the account and signs in (sets the cookie). 409 = account exists. */
export const postUser = (body: { email: string; name?: string | null; password?: string; searches: SavedSearch[] }) =>
  send<{ id: string }>('POST', '/api/users', body);

/** POST /api/session → signs in (sets the cookie). 401 = wrong email or password. */
export const postSession = (email: string, password: string) =>
  send<{ user: ApiUser }>('POST', '/api/session', { email, password }).then((r) => r.user);

export const deleteSession = () => send<{ ok: true }>('DELETE', '/api/session');

/** Stage demo: publish the mock flat and trigger the monitor. */
export async function publishMock(preset = 'kallio-2h'): Promise<{ listing_id: string }> {
  const res = await fetch('/mock/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset }),
  });
  if (!res.ok) throw new HttpError(res.status, `publish failed (${res.status})`);
  return res.json();
}
