import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { deleteSession, getMe, HttpError, postSession, postUser, type ApiUser } from './api';
import type { SavedSearch } from './types';

/**
 * Sign-in against Adam's cookie session (docs/contracts.md §4):
 *   restore  GET /api/me            → { user } or 401
 *   sign up  POST /api/users + password → sets the httpOnly fr_session cookie
 *   sign in  POST /api/session      → sets the cookie
 *   sign out DELETE /api/session
 * We never touch the cookie; same-origin fetch sends it.
 *
 * Offline demo mode: only when the server is unreachable (no API behind us, e.g. `vite` with no backend),
 * sign-up/sign-in succeed locally and the user is kept in localStorage, flagged `offline`.
 * A real server answer (401, 409, 400) is always shown to the user, never papered over.
 */
export interface User extends ApiUser {
  offline?: boolean;
}

interface AuthValue {
  user: User | null;
  status: 'loading' | 'signed-in' | 'signed-out';
  signUp(input: { email: string; password: string; name?: string; searches: SavedSearch[] }): Promise<User>;
  signIn(email: string, password: string): Promise<User>;
  updateSearches(searches: SavedSearch[]): Promise<User>;
  signOut(): Promise<void>;
}

const OFFLINE_KEY = 'flatradar.offline-user';
const unreachable = (e: unknown) => e instanceof HttpError && e.status === 0;

function readOffline(): User | null {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}
function writeOffline(u: User | null) {
  try {
    if (u) localStorage.setItem(OFFLINE_KEY, JSON.stringify(u));
    else localStorage.removeItem(OFFLINE_KEY);
  } catch {
    /* storage blocked: offline session lasts until reload */
  }
}
const offlineUser = (email: string, name: string | null, searches: SavedSearch[]): User => ({
  id: `offline:${crypto.randomUUID()}`, email: email.trim().toLowerCase(), name, searches, offline: true,
});

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthValue['status']>('loading');

  const commit = useCallback((u: User | null) => {
    setUser(u);
    setStatus(u ? 'signed-in' : 'signed-out');
    return u;
  }, []);

  useEffect(() => {
    let alive = true;
    getMe()
      .then((me) => {
        if (!alive) return;
        writeOffline(null); // a real server answered, drop any offline demo user
        commit(me);
      })
      .catch((e) => { if (alive) commit(unreachable(e) ? readOffline() : null); });
    return () => { alive = false; };
  }, [commit]);

  const value = useMemo<AuthValue>(() => ({
    user,
    status,

    signUp: async ({ email, password, name, searches }) => {
      const cleanName = name?.trim() || null;
      try {
        await postUser({ email: email.trim(), name: cleanName, password, searches });
        const me = await getMe();
        if (!me) throw new HttpError(401, 'Signed up, but the session didn’t stick. Try signing in.');
        return commit(me)!;
      } catch (e) {
        if (!unreachable(e)) throw e;
        const u = offlineUser(email, cleanName, searches);
        writeOffline(u);
        return commit(u)!;
      }
    },

    signIn: async (email, password) => {
      try {
        return commit(await postSession(email.trim(), password))!;
      } catch (e) {
        if (!unreachable(e)) throw e;
        const prev = readOffline();
        const u = prev?.email === email.trim().toLowerCase() ? prev : offlineUser(email, null, []);
        writeOffline(u);
        return commit(u)!;
      }
    },

    updateSearches: async (searches) => {
      if (!user) throw new Error('not signed in');
      if (user.offline) {
        const u = { ...user, searches };
        writeOffline(u);
        return commit(u)!;
      }
      // Signed in as the owner, so the server accepts the update without the password.
      await postUser({ email: user.email, name: user.name, searches });
      return commit({ ...user, searches })!;
    },

    signOut: async () => {
      if (user && !user.offline) await deleteSession().catch(() => {});
      writeOffline(null);
      commit(null);
    },
  }), [user, status, commit]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Guards /app/*: signed-out visitors go to /signin and come back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return null;
  if (status === 'signed-out') return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
