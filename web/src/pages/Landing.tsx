import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { LiveDot } from '../components/LiveDot';
import './landing.css';

/**
 * Step-1 placeholder for the landing page (chapter 01 copy only).
 * Step 3 adds the sticky 3D stage: spinning house + scroll-driven coin rain (see Figma "Landing /").
 */
export default function Landing() {
  return (
    <div className="landing">
      <header className="landing__nav">
        <Link to="/" className="landing__brand"><Logo size={36} /><span className="t-h4">FlatRadar</span></Link>
        <LiveDot onDark />
        <Link to="/signin" className="landing__cta t-label">Start saving →</Link>
      </header>
      <section className="landing__hero">
        <p className="t-eyebrow landing__eyebrow">Helsinki · live on Etuovi + Vuokraovi</p>
        <h1 className="t-hero">Stop overpaying for Helsinki flats.</h1>
        <p className="t-body-l landing__sub">
          Every new listing scored against comparables, an ML model and Statistics Finland prices, in seconds, with the hidden costs called out.
        </p>
        <Link to="/signin" className="landing__cta landing__cta--big t-label">Start saving →</Link>
      </section>
    </div>
  );
}
