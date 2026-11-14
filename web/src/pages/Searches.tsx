import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ago, eur, shortAddress } from '../lib/format';
import { matchesSearch } from '../lib/match';
import { useFeed } from '../lib/store';
import type { Kind, SavedSearch } from '../lib/types';
import { useNow } from '../lib/useNow';
import './searches.css';

/** The server keeps at most this many searches per user (POST /api/users slices to 5). */
const MAX_SEARCHES = 5;

const DEAL_OPTIONS: { value: string; label: string }[] = [
  { value: 'any', label: 'Any listing (score not needed)' },
  { value: '0', label: 'At or below fair value' },
  { value: '5', label: 'At least 5% below fair value' },
  { value: '10', label: 'At least 10% below fair value' },
  { value: '15', label: 'At least 15% below fair value' },
  { value: '20', label: 'At least 20% below fair value' },
];

const EMPTY: SavedSearch = { kind: 'sale', max_price: null, min_rooms: null, postcodes: [], min_deal: -0.1 };

/** "Buy · 2+ rooms · up to €300,000" */
function title(s: SavedSearch) {
  const parts = [s.kind === 'rent' ? 'Rent' : 'Buy'];
  if (s.min_rooms) parts.push(`${s.min_rooms}+ rooms`);
  if (s.max_price) parts.push(s.kind === 'rent' ? `up to ${eur(s.max_price)}/mo` : `up to ${eur(s.max_price)}`);
  return parts.join(' · ');
}
function dealText(s: SavedSearch) {
  if (s.min_deal == null) return 'Every new listing that fits';
  const pct = Math.round(Math.abs(s.min_deal) * 100);
  return pct === 0 ? 'Only at or below fair value' : `Only at least ${pct}% below fair value`;
}

/** /app/searches: the saved searches that drive email alerts, plus the alerts sent this session. */
export default function Searches() {
  const { user, updateSearches } = useAuth();
  const { byId, alerts } = useFeed();
  const now = useNow();
  const searches = user?.searches ?? [];
  // null = no form; 'new' = adding; number = editing that index
  const [editing, setEditing] = useState<number | 'new' | null>(searches.length ? null : 'new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listings = useMemo(() => Object.values(byId), [byId]);
  const counts = useMemo(() => searches.map((s) => listings.filter((l) => matchesSearch(l, s)).length), [searches, listings]);

  async function save(next: SavedSearch[]) {
    setBusy(true);
    setError(null);
    try {
      await updateSearches(next);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save your searches');
    } finally {
      setBusy(false);
    }
  }

  const full = searches.length >= MAX_SEARCHES;

  return (
    <div className="srch">
      <header className="srch__head">
        <div>
          <h1 className="t-h1">My searches</h1>
          <p className="t-body-l muted srch__lead">
            When a new listing matches one of these, we email <strong>{user?.email}</strong>.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setEditing('new')} disabled={full || editing === 'new'} title={full ? `You can keep up to ${MAX_SEARCHES} searches` : undefined}>
          + Add search
        </button>
      </header>

      {error && <p className="srch__error" role="alert">{error}</p>}

      <div className="srch__grid">
        {editing === 'new' && (
          <SearchForm
            initial={EMPTY}
            busy={busy}
            heading={searches.length ? 'New search' : 'Create your first search'}
            onCancel={searches.length ? () => setEditing(null) : undefined}
            onSave={(s) => save([...searches, s])}
          />
        )}
        {searches.map((s, i) =>
          editing === i ? (
            <SearchForm key={i} initial={s} busy={busy} heading="Edit search" onCancel={() => setEditing(null)} onSave={(n) => save(searches.map((x, j) => (j === i ? n : x)))} />
          ) : (
            <article key={i} className="scard">
              <p className="t-eyebrow scard__kind">{s.kind === 'rent' ? 'For rent' : 'For sale'}</p>
              <h2 className="t-h3">{title(s)}</h2>
              <div className="scard__codes">
                {s.postcodes.length ? s.postcodes.map((p) => <span key={p} className="scard__code t-num-s">{p}</span>) : <span className="muted t-body-s">Anywhere in Helsinki</span>}
              </div>
              <p className="t-body-s muted">{dealText(s)}</p>
              <p className="scard__count t-num-s">
                <strong>{counts[i]}</strong> {counts[i] === 1 ? 'listing matches' : 'listings match'} right now
              </p>
              <div className="scard__actions">
                <Link className="btn btn--ghost btn--s" to={`/app?kind=${s.kind}&match=1`}>See matches</Link>
                <button className="btn btn--ghost btn--s" onClick={() => setEditing(i)} disabled={busy}>Edit</button>
                <button
                  className="btn btn--link scard__delete"
                  disabled={busy}
                  onClick={() => { if (confirm(`Delete “${title(s)}”? You’ll stop getting alerts for it.`)) void save(searches.filter((_, j) => j !== i)); }}
                >
                  Delete
                </button>
              </div>
            </article>
          ),
        )}
      </div>

      {full && <p className="t-body-s muted">You can keep up to {MAX_SEARCHES} searches. Delete one to add another.</p>}

      <section className="srch__alerts" aria-labelledby="alerts-h">
        <h2 id="alerts-h" className="t-h3">Alerts sent while you’ve been here</h2>
        {alerts.length ? (
          <ul>
            {alerts.map((a) => {
              const l = byId[a.listing_id];
              return (
                <li key={a.listing_id + a.at}>
                  <Link to={`/app/l/${encodeURIComponent(a.listing_id)}?kind=${l?.kind ?? 'sale'}`}>{l ? shortAddress(l) : a.listing_id}</Link>
                  <span className="t-num-s muted">emailed {a.to} · {ago(a.at, now)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">None yet. They appear here live as new listings match anyone’s search.</p>
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
      <div className="sform__seg" role="radiogroup" aria-label="Looking to">
        {(['sale', 'rent'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className="sform__segbtn t-label" onClick={() => setKind(k)}>
            {k === 'sale' ? 'Buy' : 'Rent'}
          </button>
        ))}
      </div>
      <div className="sform__row">
        <label>
          {kind === 'rent' ? 'Max rent (€/month)' : 'Max price (€)'}
          <input name="max_price" inputMode="numeric" defaultValue={initial.max_price ?? ''} placeholder={kind === 'rent' ? '1200' : '300000'} />
        </label>
        <label>
          Min rooms
          <select name="min_rooms" defaultValue={initial.min_rooms ?? ''}>
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}
          </select>
        </label>
      </div>
      <label>
        Postcodes
        <input name="postcodes" defaultValue={initial.postcodes.join(', ')} placeholder="00530, 00500 (empty = all of Helsinki)" aria-invalid={badCodes.length > 0} />
        {badCodes.length > 0 && <span className="sform__err">Postcodes are 5 digits: {badCodes.join(', ')}</span>}
      </label>
      <label>
        Email me about
        <select name="min_deal" defaultValue={dealDefault}>
          {DEAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <div className="scard__actions">
        <button className="btn btn--primary btn--s" disabled={busy}>{busy ? 'Saving…' : 'Save search'}</button>
        {onCancel && <button type="button" className="btn btn--ghost btn--s" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  );
}
