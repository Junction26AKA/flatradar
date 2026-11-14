import { useAuth } from '../lib/auth';
import { useFeed } from '../lib/store';

/** Step-1 scaffold for /app/searches. Step 4 builds the editable search form + alert history. */
export default function Searches() {
  const { user } = useAuth();
  const { alerts } = useFeed();
  return (
    <div className="scaffold">
      <h1 className="t-h1">My searches</h1>
      <pre className="scaffold__note t-num-s">{JSON.stringify(user?.searches ?? [], null, 2)}</pre>
      <h2 className="t-h3">Alerts sent this session</h2>
      {alerts.length ? alerts.map((a) => <p key={a.listing_id + a.at} className="t-num-s">{a.at} · {a.listing_id} → {a.to}</p>) : <p className="muted">None yet.</p>}
    </div>
  );
}
