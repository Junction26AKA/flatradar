import { useI18n } from '../lib/i18n';
import { useStreamStatus } from '../lib/stream';
import './LiveDot.css';


export function LiveDot({ onDark = false }: { onDark?: boolean }) {
  const s = useStreamStatus();
  const { t } = useI18n();
  return (
    <span className={`live-dot live-dot--${s}${onDark ? ' live-dot--on-dark' : ''}`} role="status" title={s === 'replay' ? t('live.replayTitle') : undefined}>
      <i aria-hidden="true" />
      <span className="t-num-s">{t(`live.${s}`)}</span>
    </span>
  );
}
