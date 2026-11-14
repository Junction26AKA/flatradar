import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n, type T } from '../lib/i18n';
import { errorMessage, isMessageKey, type MessageKey } from '../lib/messages';
import { ago, eur, shortAddress } from '../lib/format';
import { matchesSearch } from '../lib/match';
import { useFeed } from '../lib/store';
import type { Kind, SavedSearch } from '../lib/types';
import { useNow } from '../lib/useNow';
import './searches.css';

/** The server keeps at most this many searches per user (POST /api/users slices to 5). */
const MAX_SEARCHES = 5;

const dealOptions = (t: T): { value: string; label: string }[] => [
  { value: 'any', label: t('sr.optAny') },
  { value: '0', label: t('sr.optFair') },
  ...[5, 10, 15, 20].map((p) => ({ value: String(p), label: t('sr.optPct', { p }) })),
];

const EMPTY: SavedSearch = { kind: 'sale', max_price: null, min_rooms: null, postcodes: [], min_deal: -0.1 };

/** "Buy · 2+ rooms · up to €300,000" */
function title(s: SavedSearch, t: T) {
  const parts = [t(s.kind === 'rent' ? 'sr.kindRent' : 'sr.kindSale')];
  if (s.min_rooms) parts.push(t('sr.roomsPlus', { n: s.min_rooms }));
  if (s.max_price) parts.push(t(s.kind === 'rent' ? 'sr.upToRent' : 'sr.upTo', { eur: eur(s.max_price) }));
  return parts.join(' · ');
}
function dealText(s: SavedSearch, t: T) {
  if (s.min_deal == null) return t('sr.dealAny');
  const pct = Math.round(Math.abs(s.min_deal) * 100);
  return pct === 0 ? t('sr.dealFair') : t('sr.dealPct', { p: pct });
}

/** /app/searches: the saved searches that drive email alerts, plus the alerts sent this session. */
export default function Searches() {
  const { user, updateSearches } = useAuth();
  const { t } = useI18n();
  const { byId, alerts } = useFeed();
  const now = useNow();
  const searches = user?.searches ?? [];
  // null = no form; 'new' = adding; number = editing that index
  const [editing, setEditing] = useState<number | 'new' | null>(searches.length ? null : 'new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | string | null>(null);

  const listings = useMemo(() => Object.values(byId), [byId]);
  const counts = useMemo(() => searches.map((s) => listings.filter((l) => matchesSearch(l, s)).length), [searches, listings]);

  async function save(next: SavedSearch[]) {
    setBusy(true);
    setError(null);
    try {
      await updateSearches(next);
      setEditing(null);
    } catch (e) {
      setError(errorMessage(e, 'sr.saveError'));
    } finally {
      setBusy(false);
    }
  }

  const full = searches.length >= MAX_SEARCHES;

  return (
    <div className="srch">
      <header className="srch__head">
        <div>
          <h1 className="t-h1">{t('sr.title')}</h1>
          <p className="t-body-l muted srch__lead">
            {t('sr.lead')} <strong>{user?.email}</strong>.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setEditing('new')} disabled={full || editing === 'new'} title={full ? t('sr.maxTitle', { n: MAX_SEARCHES }) : undefined}>
          {t('sr.add')}
        </button>
      </header>

      {error && <p className="srch__error" role="alert">{isMessageKey(error) ? t(error) : error}</p>}

      <div className="srch__grid">
        {editing === 'new' && (
          <SearchForm
            initial={EMPTY}
            busy={busy}
            heading={searches.length ? t('sr.new') : t('sr.first')}
            onCancel={searches.length ? () => setEditing(null) : undefined}
            onSave={(s) => save([...searches, s])}
          />
        )}
        {searches.map((s, i) =>
          editing === i ? (
            <SearchForm key={i} initial={s} busy={busy} heading={t('sr.edit')} onCancel={() => setEditing(null)} onSave={(n) => save(searches.map((x, j) => (j === i ? n : x)))} />
          ) : (
            <article key={i} className="scard">
              <p className="t-eyebrow scard__kind">{t(s.kind === 'rent' ? 'kind.forRent' : 'kind.forSale')}</p>
              <h2 className="t-h3">{title(s, t)}</h2>
              <div className="scard__codes">
                {s.postcodes.length ? s.postcodes.map((p) => <span key={p} className="scard__code t-num-s">{p}</span>) : <span className="muted t-body-s">{t('sr.anywhere')}</span>}
              </div>
              <p className="t-body-s muted">{dealText(s, t)}</p>
              <p className="scard__count t-num-s">
                <strong>{counts[i]}</strong> {t('sr.count', { n: counts[i] })}
              </p>
              <div className="scard__actions">
                <Link className="btn btn--ghost btn--s" to={`/app?kind=${s.kind}&match=1`}>{t('sr.seeMatches')}</Link>
                <button className="btn btn--ghost btn--s" onClick={() => setEditing(i)} disabled={busy}>{t('sr.editBtn')}</button>
                <button
                  className="btn btn--link scard__delete"
                  disabled={busy}
                  onClick={() => { if (confirm(t('sr.confirmDelete', { t: title(s, t) }))) void save(searches.filter((_, j) => j !== i)); }}
                >
                  {t('sr.delete')}
                </button>
              </div>
            </article>
          ),
        )}
      </div>

      {full && <p className="t-body-s muted">{t('sr.full', { n: MAX_SEARCHES })}</p>}

      <section className="srch__alerts" aria-labelledby="alerts-h">
        <h2 id="alerts-h" className="t-h3">{t('sr.alertsH')}</h2>
        {alerts.length ? (
          <ul>
            {alerts.map((a) => {
              const l = byId[a.listing_id];
              return (
                <li key={a.listing_id + a.at}>
                  <Link to={`/app/l/${encodeURIComponent(a.listing_id)}?kind=${l?.kind ?? 'sale'}`}>{l ? shortAddress(l) : a.listing_id}</Link>
                  <span className="t-num-s muted">{t('sr.emailed', { to: a.to, ago: ago(a.at, now) })}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">{t('sr.noAlerts')}</p>
        )}
      </section>
    </div>
  );
}

function SearchForm({ initial, heading, busy, onSave, onCancel }: {
  initial: SavedSearch;
  heading: string;
  busy: boolean;
  onSave: (s: SavedSearch) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>(initial.kind);
  const [badCodes, setBadCodes] = useState<string[]>([]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const raw = String(f.get('postcodes') ?? '').split(/[,\s]+/).filter(Boolean);
    const bad = raw.filter((p) => !/^\d{5}$/.test(p));
    setBadCodes(bad);
    if (bad.length) return;
    const deal = String(f.get('min_deal'));
    onSave({
      kind,
      max_price: Number(String(f.get('max_price')).replace(/[^\d]/g, '')) || null,
      min_rooms: Number(f.get('min_rooms')) || null,
      postcodes: [...new Set(raw)],
      min_deal: deal === 'any' ? null : -Number(deal) / 100,
    });
  }

  const dealDefault = initial.min_deal == null ? 'any' : String(Math.round(Math.abs(initial.min_deal) * 100));
  return (
    <form className="scard scard--form" onSubmit={submit}>
      <h2 className="t-h3">{heading}</h2>
      <div className="sform__seg" role="radiogroup" aria-label={t('si.lookingTo')}>
        {(['sale', 'rent'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className="sform__segbtn t-label" onClick={() => setKind(k)}>
            {t(k === 'sale' ? 'si.kindSale' : 'si.kindRent')}
          </button>
        ))}
      </div>
      <div className="sform__row">
        <label>
          {t(kind === 'rent' ? 'si.maxRent' : 'si.maxPrice')}
          <input name="max_price" inputMode="numeric" defaultValue={initial.max_price ?? ''} placeholder={kind === 'rent' ? '1200' : '300000'} />
        </label>
        <label>
          {t('si.minRooms')}
          <select name="min_rooms" defaultValue={initial.min_rooms ?? ''}>
            <option value="">{t('sr.any')}</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}
          </select>
        </label>
      </div>
      <label>
        {t('si.postcodes')}
        <input name="postcodes" defaultValue={initial.postcodes.join(', ')} placeholder={t('sr.postcodesPh')} aria-invalid={badCodes.length > 0} />
        {badCodes.length > 0 && <span className="sform__err">{t('sr.badCodes', { c: badCodes.join(', ') })}</span>}
      </label>
      <label>
        {t('sr.emailMe')}
        <select name="min_deal" defaultValue={dealDefault}>
          {dealOptions(t).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <div className="scard__actions">
        <button className="btn btn--primary btn--s" disabled={busy}>{busy ? t('sr.saving') : t('sr.save')}</button>
        {onCancel && <button type="button" className="btn btn--ghost btn--s" onClick={onCancel} disabled={busy}>{t('sr.cancel')}</button>}
      </div>
    </form>
  );
}
