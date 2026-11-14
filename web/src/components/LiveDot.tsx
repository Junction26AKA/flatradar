import { useStreamStatus } from '../lib/stream';
import './LiveDot.css';

const LABEL = { live: 'Live', replay: 'Replaying sample', connecting: 'Connecting…' } as const;

export function LiveDot({ onDark = false }: { onDark?: boolean }) {
  const s = useStreamStatus();
  return (
    <span className={`live-dot live-dot--${s}${onDark ? ' live-dot--on-dark' : ''}`} role="status" title={s === 'replay' ? 'Server unreachable: replaying data/fixtures/sse-sample.txt' : undefined}>
      <i aria-hidden="true" />
      <span className="t-num-s">{LABEL[s]}</span>
    </span>
  );
}
