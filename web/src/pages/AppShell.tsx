import { Link, NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { LiveDot } from '../components/LiveDot';
import { useAuth } from '../lib/auth';
import { FeedProvider } from '../lib/store';
import type { Kind } from '../lib/types';
import './app.css';

/** Signed-in layout: top bar (brand, live status, Buy/Rent, searches, user) + routed content. */
export default function AppShell() {
  const { user, signOut } = useAuth();
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get('kind') === 'rent' ? 'rent' : 'sale';
  const setKind = (k: Kind) => setParams((p) => { p.set('kind', k); return p; }, { replace: true });

  return (
    <FeedProvider>
      <header className="app-bar">
        <Link to="/app" className="app-bar__brand">
          <Logo size={30} />
          <span className="t-h4">FlatRadar</span>
        </Link>
        <LiveDot onDark />
        <div className="seg" role="tablist" aria-label="Buy or rent">
          {(['sale', 'rent'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className="seg__btn t-label" onClick={() => setKind(k)}>
              {k === 'sale' ? 'Buy' : 'Rent'}
            </button>
          ))}
        </div>
        <nav className="app-bar__right t-label">
          <NavLink to="/app/searches">My searches</NavLink>
          <button className="app-bar__user" onClick={() => void signOut()} title={`Signed in as ${user?.email}. Click to sign out.`}>
            <span aria-hidden="true">{(user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase()}</span>
            <span className="sr-only">Sign out</span>
          </button>
        </nav>
      </header>
      <main className="app-main">
        <Outlet context={{ kind }} />
      </main>
    </FeedProvider>
  );
}
