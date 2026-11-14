/** Figma "Coin" (Type=Face / Lost). Decorative. */
export function Coin({ size = 20, lost = false }: { size?: number; lost?: boolean }) {
  const [face, edge, shine] = lost ? ['#8A2A24', '#4E1512', '#C8362E'] : ['#F2B632', '#B8811A', '#FFE08A'];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="26" r="21" fill={edge} />
      <circle cx="24" cy="23" r="21" fill={face} />
      <circle cx="24" cy="23" r="16" fill="none" stroke={edge} strokeWidth="2" strokeOpacity="0.6" />
      <path d="M12 15 A14 14 0 0 1 22 8" stroke={shine} strokeWidth="3" strokeLinecap="round" fill="none" />
      <text x="24" y="30" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="20" fill={edge}>€</text>
    </svg>
  );
}
