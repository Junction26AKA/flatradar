import { motion, useTransform, type MotionValue } from 'motion/react';
import { HOUSE, track } from './chapters';

/**
 * Phones / reduced motion: no WebGL. The Figma house's front and back faces as two SVG cards that
 * flip with CSS 3D (rotateY follows the same track as the 3D house), so the story still reads.
 */
const windows = (lit: number) => {
  const out = [];
  let i = 0;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
    i++;
    out.push(<rect key={i} x={46 + c * 40} y={64 + r * 40} width={28} height={30} rx={2} fill={i % lit === 0 ? '#FFE08A' : '#C9D6E8'} stroke="#002F6C" strokeWidth={2} />);
  }
  return out;
};

function Face({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 240 280" className={`h2d__face${back ? ' h2d__face--back' : ''}`} aria-hidden="true">
      <rect x="30" y="40" width="180" height="230" fill={back ? '#F5F8FC' : '#FFFFFF'} stroke="#002F6C" strokeWidth="3" />
      <rect x="22" y="26" width="196" height="18" rx="3" fill="#002F6C" />
      {windows(back ? 99 : 3)}
      {!back && <rect x="104" y="226" width="32" height="44" rx="3" fill="#002F6C" />}
      {back && (
        <g className="h2d__cracks" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M60 92 L74 118 L66 140 L82 170" stroke="#C8362E" strokeWidth="4" />
          <path d="M172 150 L160 178 L170 200 L156 236" stroke="#C8362E" strokeWidth="4" />
        </g>
      )}
    </svg>
  );
}

export function House2D({ progress }: { progress: MotionValue<number> }) {
  const rotateY = useTransform(progress, (p) => (track(HOUSE.rotY, p) * 180) / Math.PI);
  const scale = useTransform(progress, (p) => track(HOUSE.scale, p));
  const cracks = useTransform(progress, (p) => track(HOUSE.crackGlow, p));
  return (
    <div className="h2d">
      <motion.div className="h2d__card" style={{ rotateY, scale, ['--crack' as string]: cracks }}>
        <Face />
        <Face back />
      </motion.div>
    </div>
  );
}
