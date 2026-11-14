import { Link, useRouteError } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { LangSwitch, useI18n } from '../lib/i18n';

/** Route-level error boundary: a crash in one screen shows this instead of a blank page (and stays out of the demo). */
export default function ErrorPage() {
  const err = useRouteError();
  const { t } = useI18n();
  console.error(err);
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <div style={{ display: 'grid', gap: 16, justifyItems: 'center', maxWidth: 420 }}>
        <Logo size={48} />
        <h1 className="t-h2">{t('err.title')}</h1>
        <p className="muted">{t('err.body')}</p>
        <div style={{ display: 'flex', gap: 16 }}>
          <button className="fchip" onClick={() => location.reload()}>{t('err.reload')}</button>
          <Link to="/app" className="fchip">{t('err.back')}</Link>
        </div>
        <LangSwitch />
      </div>
    </div>
  );
}
