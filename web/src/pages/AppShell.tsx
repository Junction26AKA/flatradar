import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { LiveDot } from '../components/LiveDot';
import { useAuth } from '../lib/auth';
import { LangSwitch, useI18n } from '../lib/i18n';
import { FeedProvider } from '../lib/store';
import type { Kind } from '../lib/types';
import './app.css';

/** Signed-in layout: top bar (brand, live status, Buy/Rent, Feed / My searches, account menu) + routed content. */
export default function AppShell() {
  const [params, setParams] = useSearchParams();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const kind: Kind = params.get('kind') === 'rent' ? 'rent' : 'sale';
  const onSearches = pathname.startsWith('/app/searches');
  const onFeedIndex = pathname === '/app' || pathname === '/app/';

  // Buy/Rent always shows that feed. On the feed itself only the param changes (keeps scroll and filters);
  // from My searches or an open listing of the other kind, it goes back to the feed.
  const setKind = (k: Kind) => {
    if (onFeedIndex) setParams((p) => { p.set('kind', k); return p; }, { replace: true });
    else if (k !== kind || onSearches) nav(`/app?kind=${k}`);
  };
  const q = `?kind=${kind}`;

  return (
    <FeedProvider>
      <header className="app-bar">
        <Link to={`/app${q}`} className="app-bar__brand">
          <Logo size={30} />
          <span className="t-h4">FlatRadar</span>
        </Link>
        <LiveDot onDark />
        <div className="seg" role="tablist" aria-label={t('kind.buyOrRent')}>
          {(['sale', 'rent'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={!onSearches && kind === k} className="seg__btn t-label" onClick={() => setKind(k)}>
              {t(k === 'sale' ? 'kind.sale' : 'kind.rent')}
            </button>
          ))}
        </div>
        <nav className="app-bar__right t-label" aria-label="App">
          <Link to={`/app${q}`} aria-current={onSearches ? undefined : 'page'}>{t('app.feed')}</Link>
          <Link to={`/app/searches${q}`} aria-current={onSearches ? 'page' : undefined}>{t('app.searches')}</Link>
          <LangSwitch onDark />
          <AccountMenu />
        </nav>
      </header>
      <main className="app-main">
        <Outlet context={{ kind }} />
      </main>
    </FeedProvider>
  );
}

/** Avatar → small menu (who you're signed in as, My searches, Sign out). Signing out goes to the landing page. */
function AccountMenu() {
  const { user, signOut } = useAuth();
  const { t } = useI18n();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname, search]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const initial = (user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase();
  return (
    <div className="acct" ref={box}>
      <button className="app-bar__user" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">{initial}</span>
        <span className="sr-only">{t('app.account')}</span>
      </button>
      {open && (
        <div className="acct__menu" role="menu">
          <div className="acct__who">
            {user?.name && <strong className="t-label">{user.name}</strong>}
            <span className="t-body-s muted">{user?.email}</span>
            {user?.offline && <span className="t-num-s muted">{t('app.offline')}</span>}
          </div>
          <Link role="menuitem" to="/app/searches" className="acct__item">{t('app.searches')}</Link>
          <button
            role="menuitem"
            className="acct__item"
            onClick={() => void signOut() /* the /app guard then goes to the landing page */}
          >
            {t('app.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
