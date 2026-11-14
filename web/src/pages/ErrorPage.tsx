import { Link, useRouteError } from 'react-router-dom';
import { Logo } from '../components/Logo';

/** Route-level error boundary: a crash in one screen shows this instead of a blank page (and stays out of the demo). */
export default function ErrorPage() {
  const err = useRouteError();
  console.error(err);
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <div style={{ display: 'grid', gap: 16, justifyItems: 'center', maxWidth: 420 }}>
        <Logo size={48} />
        <h1 className="t-h2">Something went wrong</h1>
        <p className="muted">This screen hit an error. Reloading usually fixes it.</p>
        <div style={{ display: 'flex', gap: 16 }}>
          <button className="fchip" onClick={() => location.reload()}>Reload</button>
          <Link to="/app" className="fchip">Back to the feed</Link>
        </div>
      </div>
    </div>
  );
}
