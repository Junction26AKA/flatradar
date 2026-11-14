import { forwardRef } from 'react';

/** Figma "Piggy bank": Finnish-blue pig with a flag window and a gold coin slot. The slot is what coins pour into. */
export const PiggyBank = forwardRef<HTMLDivElement, { wobble?: boolean }>(function PiggyBank({ wobble }, ref) {
  return (
    <div className={`piggy${wobble ? ' piggy--wobble' : ''}`}>
      <svg viewBox="0 0 320 260" aria-hidden="true">
        <ellipse cx="160" cy="248" rx="120" ry="10" fill="#002F6C" fillOpacity="0.15" />
        <rect x="80" y="190" width="30" height="52" rx="10" fill="#001A3D" />
        <rect x="210" y="190" width="30" height="52" rx="10" fill="#001A3D" />
        <ellipse cx="160" cy="140" rx="130" ry="95" fill="#002F6C" />
        <polygon points="100,62 130,20 150,60" fill="#002F6C" />
        <ellipse cx="282" cy="140" rx="22" ry="28" fill="#1D4E8F" />
        <circle cx="278" cy="132" r="4" fill="#001A3D" />
        <circle cx="278" cy="150" r="4" fill="#001A3D" />
        <circle cx="230" cy="105" r="8" fill="#FFFFFF" />
        <circle cx="232" cy="106" r="4" fill="#001A3D" />
        <rect x="120" y="52" width="80" height="12" rx="6" fill="#F2B632" />
        <rect x="74" y="110" width="50" height="40" rx="4" fill="#FFFFFF" />
        <rect x="95" y="110" width="8" height="40" fill="#002F6C" />
        <rect x="74" y="126" width="50" height="8" fill="#002F6C" />
        <path d="M30 140 q-20 -10 -10 -30" stroke="#002F6C" strokeWidth="8" fill="none" strokeLinecap="round" />
      </svg>
      {/* invisible marker at the coin slot: CoinRain pours into its screen position */}
      <div ref={ref} className="piggy__slot" />
    </div>
  );
});
