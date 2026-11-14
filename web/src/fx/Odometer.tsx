import { useEffect, useState } from 'react';

/**
 * Rolling-digit counter. Each digit is a 0–9 strip that slides into place; digits roll in from the
 * right with a small stagger. Non-digits (€, spaces) are static.
 */
export function Odometer({ value, prefix = '€ ', className = '' }: { value: number; prefix?: string; className?: string }) {
  const text = prefix + new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value)));
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t); }, []);
  let digitIdx = 0;
  const digits = [...text].filter((ch) => /\d/.test(ch)).length;
  return (
    <span className={`odo ${className}`} aria-label={text} role="text">
      {[...text].map((ch, i) => {
        if (!/\d/.test(ch)) return <span key={i} className="odo__static" aria-hidden="true">{ch === ' ' || ch === ' ' || ch === ' ' ? ' ' : ch}</span>;
        const d = Number(ch);
        const delay = (digits - digitIdx++) * 70;
        return (
          <span key={i} className="odo__digit" aria-hidden="true">
            <span className="odo__strip" style={{ transform: `translateY(${shown ? -d : 0}em)`, transitionDelay: `${delay}ms` }}>
              {'0123456789'.split('').map((n) => <span key={n}>{n}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
