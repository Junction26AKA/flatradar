import type { Flag } from '../lib/types';
import { eur } from '../lib/format';
import './badges.css';

/** Figma "FlagChip". Pending = the Context.dev call is still running: dashed outline + spinner. */
export function FlagChip({ flag }: { flag: Flag }) {
  const state = flag.status === 'pending' ? 'pending' : flag.status === 'error' ? 'error' : flag.severity;
  const cost = flag.est_cost_eur ? ` · ≈${eur(flag.est_cost_eur)}` : '';
  return (
    <span
      className={`chip chip--${state}`}
      title={flag.status === 'error' ? 'This check failed' : flag.detail ?? flag.source?.quote ?? undefined}
    >
      <i aria-hidden="true" className={flag.status === 'pending' ? 'chip__spin' : 'chip__dot'} />
      {flag.label}
      {cost}
      {flag.status === 'pending' && <span className="sr-only"> (checking)</span>}
    </span>
  );
}

const ORDER: Record<string, number> = { pending: 3, high: 0, warn: 1, info: 2, error: 4 };
/** Most serious first; pending checks after the finished ones so the card doesn't jump around as they resolve. */
export const sortFlags = (flags: Flag[]) =>
  [...flags].sort((a, b) => ORDER[a.status === 'ok' ? a.severity : a.status] - ORDER[b.status === 'ok' ? b.severity : b.status]);
