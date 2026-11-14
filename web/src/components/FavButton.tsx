import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import './FavButton.css';

/**
 * Heart toggle for a listing. Rendered next to the card, not inside it: the card is a <Link>, and a button
 * inside a link is invalid HTML (and the click would also open the listing).
 */
export function FavButton({ id, variant = 'icon' }: { id: string; variant?: 'icon' | 'labelled' }) {
  const { user, toggleFavourite } = useAuth();
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  if (!user) return null;
  const on = !!user.favourites?.includes(id);
  const title = failed ? t('fav.error') : t(on ? 'fav.remove' : 'fav.add');

  return (
    <button
      type="button"
      className={`fav fav--${variant}${on ? ' is-on' : ''}${failed ? ' is-failed' : ''}`}
      aria-pressed={on}
      aria-label={title}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setFailed(false);
        toggleFavourite(id).catch(() => setFailed(true));
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 20.5s-7.5-4.6-9.3-9.4C1.5 7.6 3.7 4 7.3 4c2 0 3.6 1.1 4.7 2.7C13.1 5.1 14.7 4 16.7 4c3.6 0 5.8 3.6 4.6 7.1-1.8 4.8-9.3 9.4-9.3 9.4z" />
      </svg>
      {variant === 'labelled' && <span className="t-label">{t(on ? 'fav.saved' : 'fav.save')}</span>}
    </button>
  );
}
