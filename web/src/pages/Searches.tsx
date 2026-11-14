import { lazy, Suspense, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n, type T } from '../lib/i18n';
import { errorMessage, isMessageKey, type MessageKey } from '../lib/messages';
import { ago, eur, shortAddress } from '../lib/format';
import { excludableFor, matchesSearch } from '../lib/match';
import { useFeed } from '../lib/store';
import { geocodePlace, parseSearchText, type ParsedSearch, type Place } from '../lib/api';
import type { CommuteTarget, FlagType, Kind, SavedSearch, SearchArea, SearchPolygon } from '../lib/types';
import { useNow } from '../lib/useNow';
import './searches.css';

const AreaPicker = lazy(() => import('../components/AreaPicker'));
const kmText = (m: number) => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** The server keeps at most this many searches per user (POST /api/users slices to 5). */
const MAX_SEARCHES = 5;

const dealOptions = (t: T): { value: string; label: string }[] => [
  { value: 'any', label: t('sr.optAny') },
  { value: '0', label: t('sr.optFair') },
  ...[5, 10, 15, 20].map((p) => ({ value: String(p), label: t('sr.optPct', { p }) })),
];

const EMPTY: SavedSearch = { kind: 'sale', max_price: null, min_rooms: null, postcodes: [], areas: [], polygons: [], commute: null, exclude_flags: [], min_deal: -0.1 };

const COMMUTE_MINUTES = [15, 20, 30, 45, 60];

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
  // A typed search fills a fresh "new search" form; the key remounts the form with the parsed values.
  const [draft, setDraft] = useState<{ parsed: ParsedSearch; key: number } | null>(null);

  const listings = useMemo(() => Object.values(byId), [byId]);
  const counts = useMemo(() => searches.map((s) => listings.filter((l) => matchesSearch(l, s)).length), [searches, listings]);

  async function save(next: SavedSearch[]): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await updateSearches(next);
      setEditing(null);
      return true;
    } catch (e) {
      setError(errorMessage(e, 'sr.saveError'));
      return false;
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

      {!full && (
        <DescribeSearch
          onParsed={(parsed) => { setDraft((d) => ({ parsed, key: (d?.key ?? 0) + 1 })); setEditing('new'); }}
        />
      )}

      <div className="srch__grid">
        {editing === 'new' && (
          <SearchForm
            key={`new${draft?.key ?? 0}`}
            initial={draft ? { ...EMPTY, ...draft.parsed.search } : EMPTY}
            busy={busy}
            heading={draft ? t('sr.fromText') : searches.length ? t('sr.new') : t('sr.first')}
            note={draft ? <ParsedNote parsed={draft.parsed} /> : null}
            onCancel={searches.length || draft ? () => { setEditing(searches.length ? null : 'new'); setDraft(null); } : undefined}
            onSave={(s) => void save([...searches, s]).then((ok) => { if (ok) setDraft(null); })}
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
                {s.postcodes.map((p) => <span key={p} className="scard__code t-num-s">{p}</span>)}
                {(s.areas ?? []).map((a, j) => <span key={`a${j}`} className="scard__code scard__code--area t-num-s">{a.label ? `◎ ${a.label} · ${kmText(a.radius_m)} km` : t('sr.areaChip', { km: kmText(a.radius_m) })}</span>)}
                {(s.polygons ?? []).map((_, j) => <span key={`g${j}`} className="scard__code scard__code--area t-num-s">{t('sr.shapeChip', { n: j + 1 })}</span>)}
                {!s.postcodes.length && !s.areas?.length && !s.polygons?.length && <span className="muted t-body-s">{t('sr.anywhere')}</span>}
              </div>
              {s.commute && <p className="t-body-s scard__commute">{t('sr.commuteChip', { min: s.commute.max_min, to: s.commute.label })}</p>}
              {!!s.exclude_flags?.length && (
                <div className="scard__codes">
                  {s.exclude_flags.map((f) => <span key={f} className="scard__code scard__code--ex t-num-s">{t('sr.noFlag', { what: t(`ex.${f}` as MessageKey) })}</span>)}
                </div>
              )}
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

function SearchForm({ initial, heading, note, busy, onSave, onCancel }: {
  initial: SavedSearch;
  heading: string;
  note?: ReactNode;
  busy: boolean;
  onSave: (s: SavedSearch) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>(initial.kind);
  const [badCodes, setBadCodes] = useState<string[]>([]);
  const [areas, setAreas] = useState<SearchArea[]>(initial.areas ?? []);
  const [polygons, setPolygons] = useState<SearchPolygon[]>(initial.polygons ?? []);
  const [commute, setCommute] = useState<CommuteTarget | null>(initial.commute ?? null);
  const [excluded, setExcluded] = useState<Set<FlagType>>(() => new Set(initial.exclude_flags ?? []));
  const toggleEx = (f: FlagType) => setExcluded((x) => { const n = new Set(x); if (n.has(f)) n.delete(f); else n.add(f); return n; });

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
      areas,
      polygons,
      commute,
      exclude_flags: excludableFor(kind).filter((f) => excluded.has(f)),
      min_deal: deal === 'any' ? null : -Number(deal) / 100,
    });
  }

  const dealDefault = initial.min_deal == null ? 'any' : String(Math.round(Math.abs(initial.min_deal) * 100));
  // A typed search can ask for any percentage ("8% below"): offer it, or the select falls back to "any" and the
  // deal filter is silently dropped on save.
  const deals = dealOptions(t);
  if (!deals.some((o) => o.value === dealDefault)) deals.push({ value: dealDefault, label: t('sr.optPct', { p: Number(dealDefault) }) });
  deals.sort((a, b) => (a.value === 'any' ? -1 : b.value === 'any' ? 1 : Number(a.value) - Number(b.value)));
  return (
    <form className="scard scard--form" onSubmit={submit}>
      <h2 className="t-h3">{heading}</h2>
      {note}
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
      <div className="sform__areas">
        <span className="sform__label">{t('sr.areas')}</span>
        <Suspense fallback={<div className="apick__map" />}>
          <AreaPicker value={areas} onChange={setAreas} polygons={polygons} onPolygonsChange={setPolygons} />
        </Suspense>
      </div>
      <CommutePicker value={commute} onChange={setCommute} />
      <fieldset className="sform__ex">
        <legend className="sform__label">{t('sr.skipFlats')}</legend>
        <div className="sform__exlist">
          {excludableFor(kind).map((f) => (
            <label key={f} className="sform__check">
              <input type="checkbox" checked={excluded.has(f)} onChange={() => toggleEx(f)} />
              <span>{t(`ex.${f}` as MessageKey)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        {t('sr.emailMe')}
        <select name="min_deal" defaultValue={dealDefault}>
          {deals.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <div className="scard__actions">
        <button className="btn btn--primary btn--s" disabled={busy}>{busy ? t('sr.saving') : t('sr.save')}</button>
        {onCancel && <button type="button" className="btn btn--ghost btn--s" onClick={onCancel} disabled={busy}>{t('sr.cancel')}</button>}
      </div>
    </form>
  );
}

/** "Describe it": free text → a filled-in search form the user checks before saving. */
function DescribeSearch({ onParsed }: { onParsed: (p: ParsedSearch) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      onParsed(await parseSearchText(text.trim()));
    } catch (err) {
      setError(errorMessage(err, 'sr.describeError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="describe" onSubmit={submit}>
      <label className="describe__label t-label" htmlFor="describe-q">{t('sr.describe')}</label>
      <div className="describe__row">
        <input
          id="describe-q"
          className="describe__input"
          value={text}
          maxLength={400}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('sr.describePh')}
        />
        <button className="btn btn--primary btn--s" disabled={busy || text.trim().length < 3}>{busy ? t('sr.describeBusy') : t('sr.describeGo')}</button>
      </div>
      {error && <p className="sform__err t-body-s" role="alert">{isMessageKey(error) ? t(error) : error}</p>}
    </form>
  );
}

function ParsedNote({ parsed }: { parsed: ParsedSearch }) {
  const { t } = useI18n();
  return (
    <div className="parsed t-body-s">
      {parsed.summary && <p>{parsed.summary}</p>}
      {parsed.notes.map((n) => <p key={n} className="sform__err">{n}</p>)}
      <p className="muted">{t(parsed.via === 'gemini' ? 'sr.viaGemini' : 'sr.viaRules')}</p>
    </div>
  );
}

/** Commute limit: find a place, then pick the most minutes by public transport. */
function CommutePicker({ value, onChange }: { value: CommuteTarget | null; onChange: (c: CommuteTarget | null) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    if (q.trim().length < 2) return;
    setBusy(true);
    try { setHits(await geocodePlace(q.trim())); } catch { setHits([]); } finally { setBusy(false); }
  }

  return (
    <div className="sform__commute">
      <span className="sform__label">{t('sr.commute')}</span>
      {value ? (
        <div className="commute__set">
          <select aria-label={t('sr.commuteMax')} value={value.max_min} onChange={(e) => onChange({ ...value, max_min: Number(e.target.value) })}>
            {[...new Set([...COMMUTE_MINUTES, value.max_min])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{t('sr.minutes', { n: m })}</option>)}
          </select>
          <span className="t-body-s commute__to">{t('sr.commuteTo', { to: value.label })}</span>
          <button type="button" className="btn btn--link apick__rm" onClick={() => onChange(null)} aria-label={t('sr.commuteRemove')} title={t('sr.commuteRemove')}>×</button>
        </div>
      ) : (
        <>
          <div className="commute__find">
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setHits(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(); } }}
              placeholder={t('sr.commutePh')}
              aria-label={t('sr.commute')}
            />
            <button type="button" className="btn btn--ghost btn--s" onClick={() => void find()} disabled={busy || q.trim().length < 2}>{busy ? '…' : t('sr.commuteFind')}</button>
          </div>
          {hits && (hits.length ? (
            <ul className="commute__hits">
              {hits.map((h) => (
                <li key={`${h.lat},${h.lng}`}>
                  <button type="button" className="btn btn--link" onClick={() => { onChange({ label: h.label.split(',')[0].trim() || q.trim(), lat: +h.lat.toFixed(5), lng: +h.lng.toFixed(5), max_min: 30 }); setHits(null); setQ(''); }}>
                    {h.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="t-body-s muted">{t('sr.commuteNone')}</p>)}
        </>
      )}
      <p className="t-body-s muted apick__hint">{t('sr.commuteHint')}</p>
    </div>
  );
}
