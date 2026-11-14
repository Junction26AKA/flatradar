import type { Flag } from '../lib/types';
import { flagCost, flagLabel } from '../lib/flagText';
import { useI18n } from '../lib/i18n';
import './badges.css';

/** Figma "FlagChip". Pending = the Context.dev call is still running: dashed outline + spinner. */
export function FlagChip({ flag }: { flag: Flag }) {
  const { t, lang } = useI18n();
  const state = flag.status === 'pending' ? 'pending' : flag.status === 'error' ? 'error' : flag.severity;
  const cost = flagCost(flag);
  return (
    <span
      className={`chip chip--${state}`}
      title={flag.status === 'error' ? t('flag.failed') : (lang === 'fi' && flag.detail_fi) || flag.detail || flag.source?.quote || undefined}
    >
      <i aria-hidden="true" className={flag.status === 'pending' ? 'chip__spin' : 'chip__dot'} />
      {flagLabel(flag)}
      {cost}
      {flag.status === 'pending' && <span className="sr-only"> {t('flag.checking')}</span>}
    </span>
  );
}

const ORDER: Record<string, number> = { pending: 3, high: 0, warn: 1, info: 2, error: 4 };
/** Most serious first; pending checks after the finished ones so the card doesn't jump around as they resolve. */
export const sortFlags = (flags: Flag[]) =>
  [...flags].sort((a, b) => ORDER[a.status === 'ok' ? a.severity : a.status] - ORDER[b.status === 'ok' ? b.severity : b.status]);
