import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { HttpError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LangSwitch, useI18n } from '../lib/i18n';
import { errorMessage, isMessageKey, type MessageKey } from '../lib/messages';
import type { Kind, SavedSearch } from '../lib/types';
import './signin.css';

/** /signin: sign-up with a first saved search, or sign back in by email. Styled properly in step 4. */
export default function SignIn() {
  const { status, signUp, signIn } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/app') ? params.get('next')! : '/app';
  const [mode, setMode] = useState<'up' | 'in'>(params.get('mode') === 'in' ? 'in' : 'up');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Kind>('sale');
  // a message key (translated at render, so it follows a language switch) or a server text as sent
  const [error, setError] = useState<MessageKey | string | null>(null);

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
        setError('si.exists');
      } else {
        setError(errorMessage(err, 'si.error'));
      }
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <aside className="signin__brand">
        <div className="signin__top">
          <Link to="/" className="signin__logo"><Logo size={36} /><span className="t-h4">FlatRadar</span></Link>
          <LangSwitch onDark />
        </div>
        <p className="t-h3">{t('si.brand')}</p>
      </aside>
      <form className="signin__form" onSubmit={onSubmit}>
        <h1 className="t-h1">{t(mode === 'up' ? 'si.upH' : 'si.inH')}</h1>
        <p className="t-body-l muted">{t(mode === 'up' ? 'si.upSub' : 'si.inSub')}</p>
        <div className="signin__row">
          {mode === 'up' && <label>{t('si.name')}<input name="name" autoComplete="name" placeholder={t('si.namePh')} /></label>}
          <label>{t('si.email')}<input name="email" type="email" required autoComplete="email" placeholder={t('si.emailPh')} /></label>
        </div>
        <label>
          {t('si.password')}
          <input
            name="password"
            type="password"
            required
            minLength={mode === 'up' ? 8 : 1}
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            placeholder={mode === 'up' ? t('si.passwordPh') : ''}
          />
        </label>
        {mode === 'up' && (
          <fieldset>
            <legend className="t-h4">{t('si.first')}</legend>
            <div className="signin__row">
              <label>{t('si.lookingTo')}<select name="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}><option value="sale">{t('si.kindSale')}</option><option value="rent">{t('si.kindRent')}</option></select></label>
              <label>{t(kind === 'rent' ? 'si.maxRent' : 'si.maxPrice')}<input name="max_price" inputMode="numeric" placeholder={t('si.any')} /></label>
              <label>{t('si.minRooms')}<input name="min_rooms" inputMode="numeric" placeholder={t('si.any')} /></label>
            </div>
            <label>{t('si.postcodes')}<input name="postcodes" placeholder={t('si.postcodesPh')} /></label>
            <label>{t('si.minDeal')}<input name="min_deal" type="number" min={0} max={50} defaultValue={10} /><span className="t-body-s muted">{t('si.minDealHint')}</span></label>
          </fieldset>
        )}
        {error && <p className="signin__error" role="alert">{isMessageKey(error) ? t(error) : error}</p>}
        <button className="btn btn--primary" disabled={busy}>{busy ? t('si.busy') : t(mode === 'up' ? 'si.submitUp' : 'si.submitIn')}</button>
        <button type="button" className="btn btn--link" onClick={() => { setMode(mode === 'up' ? 'in' : 'up'); setError(null); }}>
          {t(mode === 'up' ? 'si.toIn' : 'si.toUp')}
        </button>
      </form>
    </div>
  );
}
