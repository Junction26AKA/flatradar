/** Finnish flag (blue Nordic cross on white) with a gold radar ping. Matches Figma "Logo/Mark". */
export function Logo({ size = 32, title = 'FlatRadar' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={title}>
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="9.25" fill="#FFFFFF" stroke="#002F6C" strokeWidth="1.5" />
      <rect x="11" y="1" width="7" height="38" fill="#002F6C" />
      <rect x="1" y="16.5" width="38" height="7" fill="#002F6C" />
      <path d="M29 6 A 9 9 0 0 1 35 12" stroke="#F2B632" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M27.5 9.5 A 5 5 0 0 1 31.5 13" stroke="#F2B632" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="27" cy="13.5" r="2" fill="#F2B632" />
    </svg>
  );
}
