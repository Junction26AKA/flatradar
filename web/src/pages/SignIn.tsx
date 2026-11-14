import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { HttpError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Kind, SavedSearch } from '../lib/types';
import './signin.css';

/** /signin: sign-up with a first saved search, or sign back in by email. Styled properly in step 4. */
export default function SignIn() {
  const { status, signUp, signIn } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/app') ? params.get('next')! : '/app';
  const [mode, setMode] = useState<'up' | 'in'>('up');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'signed-in' && !busy) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? '');
    const password = String(f.get('password') ?? '');
    setBusy(true);
    setError(null);
    try {
      if (mode === 'in') await signIn(email, password);
      else {
        const search: SavedSearch = {
          kind: (f.get('kind') as Kind) ?? 'sale',
          max_price: Number(f.get('max_price')) || null,
          min_rooms: Number(f.get('min_rooms')) || null,
          postcodes: String(f.get('postcodes') ?? '').split(/[,\s]+/).filter((p) => /^\d{5}$/.test(p)),
          min_deal: -(Number(f.get('min_deal')) || 0) / 100,
        };
        await signUp({ email, password, name: String(f.get('name') ?? ''), searches: [search] });
      }
      nav(next, { replace: true });
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        setMode('in');
        setError('You already have an account with that email. Sign in instead.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <aside className="signin__brand">
        <Link to="/" className="signin__logo"><Logo size={36} /><span className="t-h4">FlatRadar</span></Link>
        <p className="t-h3">Every new Helsinki listing, scored in seconds, with the hidden costs called out before you book a viewing.</p>
      </aside>
      <form className="signin__form" onSubmit={onSubmit}>
        <h1 className="t-h1">{mode === 'up' ? 'Start saving' : 'Welcome back'}</h1>
        <p className="t-body-l muted">{mode === 'up' ? 'Tell us where to send deals and what you’re looking for.' : 'Sign in to see your feed and alerts.'}</p>
        <div className="signin__row">
          {mode === 'up' && <label>Name<input name="name" autoComplete="name" placeholder="Your name" /></label>}
          <label>Email<input name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></label>
        </div>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={mode === 'up' ? 8 : 1}
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            placeholder={mode === 'up' ? 'At least 8 characters' : ''}
          />
        </label>
        {mode === 'up' && (
          <fieldset>
            <legend className="t-h4">Your first search</legend>
            <div className="signin__row">
              <label>Looking to<select name="kind" defaultValue="sale"><option value="sale">Buy</option><option value="rent">Rent</option></select></label>
              <label>Max price (€)<input name="max_price" inputMode="numeric" placeholder="280000" /></label>
              <label>Min rooms<input name="min_rooms" inputMode="numeric" placeholder="2" /></label>
            </div>
            <label>Postcodes<input name="postcodes" placeholder="00530, 00500" /></label>
            <label>Alert me when at least … % below fair value<input name="min_deal" type="number" min={0} max={50} defaultValue={10} /></label>
          </fieldset>
        )}
        {error && <p className="signin__error" role="alert">{error}</p>}
        <button className="btn btn--primary" disabled={busy}>{busy ? 'One moment…' : mode === 'up' ? 'Start watching →' : 'Sign in →'}</button>
        <button type="button" className="btn btn--link" onClick={() => { setMode(mode === 'up' ? 'in' : 'up'); setError(null); }}>
          {mode === 'up' ? 'Already watching? Sign in with your email' : 'New here? Create a search'}
        </button>
      </form>
    </div>
  );
}
