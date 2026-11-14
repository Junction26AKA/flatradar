import type { Listing } from '../lib/types';
import { eur } from '../lib/format';
import './badges.css';
import './AnalystPanel.css';

type Lang = 'en' | 'fi';

// The panel's own strings. Gemini writes the analysis itself in both languages (insight.fi, flag.label_fi).
// Once the site-wide switch lands (PR #17), these can move into lib/messages.ts and `lang` can come from useI18n().
const T = {
  en: {
    title: 'Analyst · Gemini',
    reading: 'Reading the listing and documents…',
    failed: 'The analysis didn’t finish for this listing.',
    verified: (ok: number, n: number) => `✓ ${ok}/${n} quotes verified`,
    verifiedHint: 'Every hidden cost must quote the listing or document word for word. We check each quote and drop the ones we can’t find.',
    debtFree: 'Debt-free price',
    upcoming: '+ Upcoming renovations',
    real: 'Real cost',
    found: 'Also found in the Finnish text',
    ask: 'Ask the agent',
  },
  fi: {
    title: 'Analyysi · Gemini',
    reading: 'Luetaan ilmoitusta ja asiakirjoja…',
    failed: 'Analyysi ei valmistunut tälle kohteelle.',
    verified: (ok: number, n: number) => `✓ ${ok}/${n} lainausta tarkistettu`,
    verifiedHint: 'Jokaisen piilokulun on lainattava ilmoitusta tai asiakirjaa sanatarkasti. Tarkistamme jokaisen lainauksen ja hylkäämme ne, joita ei löydy.',
    debtFree: 'Velaton hinta',
    upcoming: '+ Tulevat remontit',
    real: 'Todellinen hinta',
    found: 'Löytyi myös ilmoituksen tekstistä',
    ask: 'Kysy välittäjältä',
  },
} as const;

/**
 * Gemini analyst (docs/contracts.md §3b): verdict, real cost and questions for the agent, in English or Finnish.
 * Self-contained so it can drop into whatever the detail drawer becomes.
 */
export function AnalystPanel({ listing: l, lang = 'en' }: { listing: Listing; lang?: Lang }) {
  const ins = l.insight;
  const t = T[lang];
  if (!ins) return null;

  if (ins.status === 'pending') {
    // A restart mid-analysis leaves it pending; the server retries on startup, so don't spin meanwhile.
    if (!ins.at || Date.now() - Date.parse(ins.at) > 90_000) return null;
    return (
      <section className="analyst analyst--pending" aria-busy="true" aria-label={t.title}>
        <p className="t-eyebrow muted">{t.title}</p>
        <p className="t-body-s muted"><i className="chip__spin" aria-hidden="true" /> {t.reading}</p>
      </section>
    );
  }
  if (ins.status === 'error') {
    return (
      <section className="analyst" aria-label={t.title}>
        <p className="t-eyebrow muted">{t.title}</p>
        <p className="t-body-s muted">{t.failed}</p>
      </section>
    );
  }

  // Finnish text when it exists, English otherwise (older analyses have no `fi`).
  const fi = lang === 'fi' ? ins.fi : undefined;
  const headline = fi?.headline || ins.headline;
  const summary = fi?.summary || ins.summary;
  const questions = fi?.questions?.length ? fi.questions : ins.questions;
  const found = l.flags.filter((f) => f.origin === 'gemini' && f.status === 'ok');
  const debtFree = l.debt_free_price ?? null;

  return (
    <section className="analyst" aria-label={t.title}>
      <header className="analyst__head">
        <p className="t-eyebrow muted">{t.title}</p>
        {ins.grounding.checked > 0 && (
          <span className="analyst__verified t-num-s" title={t.verifiedHint}>
            {t.verified(ins.grounding.checked - ins.grounding.dropped, ins.grounding.checked)}
          </span>
        )}
      </header>

      <h3 className="t-h4">{headline}</h3>
      <p className="analyst__summary">{summary}</p>

      {l.kind === 'sale' && debtFree != null && ins.hidden_cost_eur != null && (
        <dl className="analyst__cost">
          <div><dt className="t-body-s muted">{t.debtFree}</dt><dd className="t-num-m">{eur(debtFree)}</dd></div>
          <div><dt className="t-body-s muted">{t.upcoming}</dt><dd className="t-num-m">≈{eur(ins.hidden_cost_eur)}</dd></div>
          <div className="analyst__total"><dt className="t-label">{t.real}</dt><dd className="t-num-m">≈{eur(debtFree + ins.hidden_cost_eur)}</dd></div>
        </dl>
      )}

      {found.length > 0 && (
        <>
          <p className="t-label analyst__sub">{t.found}</p>
          <ul className="analyst__found">
            {found.map((f) => {
              const label = (lang === 'fi' && f.label_fi) || f.label;
              const detail = (lang === 'fi' && f.detail_fi) || f.detail;
              return (
                <li key={f.id}>
                  <span className="t-label">{label}{f.est_cost_eur ? ` · ≈${eur(f.est_cost_eur)}` : ''}</span>
                  {detail && <span className="t-body-s">{detail}</span>}
                  {f.source?.quote && (
                    <q className="analyst__quote t-body-s" lang="fi">
                      {f.source.url ? <a href={f.source.url} target="_blank" rel="noreferrer">{f.source.quote}</a> : f.source.quote}
                    </q>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {questions.length > 0 && (
        <>
          <p className="t-label analyst__sub">{t.ask}</p>
          <ol className="analyst__questions t-body-s">
            {questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </>
      )}

    </section>
  );
}
