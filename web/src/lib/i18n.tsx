import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translate, type MessageKey } from './messages';
import { setFormatLang } from './format';

/**
 * Tiny i18n: English and Finnish, no library. The choice is remembered per browser; the first visit
 * follows the browser language (Finnish browsers get Finnish).
 */
export type Lang = 'en' | 'fi';
const KEY = 'flatradar.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'fi') return saved;
  } catch { /* storage blocked */ }
  return navigator.language?.toLowerCase().startsWith('fi') ? 'fi' : 'en';
}

type Vars = Record<string, unknown>;
export type T = (key: MessageKey, vars?: Vars) => string;

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: T }
const Ctx = createContext<I18n | null>(null);

// Formatting helpers (eur(), ago(), …) read the language from format.ts; keep it in step before children render.
const first = initialLang();
setFormatLang(first);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(first);
  const setLang = useCallback((l: Lang) => {
    setFormatLang(l);
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* not persisted */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const t = useCallback<T>((key, vars) => translate(lang, key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}

/** EN | FI switch. `onDark` for the blue top bars. */
export function LangSwitch({ onDark = false, className = '' }: { onDark?: boolean; className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={`langsw${onDark ? ' langsw--dark' : ''} ${className}`} role="group" aria-label={t('lang.label')}>
      {(['en', 'fi'] as const).map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)} title={l === 'en' ? 'English' : 'Suomi'}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
