import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import type { MotionValue } from 'motion/react';
import { CAMERA, HOUSE, MINI, track } from './chapters';

/**
 * The sticky 3D stage: one low-poly Helsinki kerrostalo built from boxes (no model file to load),
 * driven entirely by scroll progress through chapters.ts. Lazy-loaded so three.js never blocks first paint.
 */

const BLUE = '#002F6C';
const PALE = '#C9D6E8';
const LIT = '#FFE08A';
const RED = '#C8362E';

const W = 3.2, H = 4.2, D = 1.7; // block size in world units
const MINI_X = 5; // live-map grid sits right of centre (matches HOUSE.x in that chapter)
const COLS = 4, ROWS = 5;

/** Smoothly follow a scroll-driven target (critically damped feel, frame-rate independent). */
const damp = (cur: number, target: number, lambda: number, dt: number) => THREE.MathUtils.damp(cur, target, lambda, dt);

function Windows({ z, litEvery, flip = false }: { z: number; litEvery: number; flip?: boolean }) {
  const ww = 0.5, wh = 0.42;
  const TOP = 0.45, BOTTOM = 1.0;
  const gx = (W - 0.6 - COLS * ww) / (COLS - 1);
  const gy = (H - TOP - BOTTOM - ROWS * wh) / (ROWS - 1);
  const items = [];
  let i = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    i++;
    const lit = i % litEvery === 0;
    const x = -W / 2 + 0.3 + ww / 2 + c * (ww + gx);
    const y = H / 2 - TOP - wh / 2 - r * (wh + gy);
    items.push(
      <group key={i} position={[x, y, z]} rotation={[0, flip ? Math.PI : 0, 0]}>
        <mesh position={[0, 0, 0.005]}>
          <boxGeometry args={[ww + 0.08, wh + 0.08, 0.04]} />
          <meshStandardMaterial color={BLUE} />
        </mesh>
        <mesh position={[0, 0, 0.03]}>
          <boxGeometry args={[ww, wh, 0.02]} />
          <meshStandardMaterial color={lit ? LIT : PALE} emissive={lit ? LIT : '#000000'} emissiveIntensity={lit ? 0.55 : 0} roughness={0.3} />
        </mesh>
      </group>,
    );
  }
  return <>{items}</>;
}

/** Zig-zag cracks on the back wall; glow strength comes from the "hidden costs" chapter. */
function Cracks({ glow }: { glow: React.MutableRefObject<number> }) {
  // One material shared by every crack segment, so the glow is a single uniform update per frame.
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: RED, emissive: RED, emissiveIntensity: 0, transparent: true, opacity: 0 }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const segs = useMemo(() => {
    const paths = [
      [[-1.0, 1.4], [-0.7, 0.8], [-0.95, 0.3], [-0.6, -0.4]],
      [[0.95, 0.2], [0.65, -0.35], [0.9, -0.8], [0.55, -1.6]],
    ];
    return paths.flatMap((pts) => pts.slice(1).map((b, i) => {
      const a = pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, len, rot: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }));
  }, []);
  useFrame(({ clock }) => {
    const g = glow.current;
    mat.emissiveIntensity = g * (1.6 + Math.sin(clock.elapsedTime * 4) * 0.6);
    mat.opacity = Math.min(1, g * 1.4);
  });
  return (
    <group position={[0, 0, -D / 2 - 0.03]} rotation={[0, Math.PI, 0]}>
      {segs.map((s, i) => (
        <mesh key={i} position={[s.x, s.y, 0]} rotation={[0, 0, s.rot]} material={mat}>
          <boxGeometry args={[s.len + 0.06, 0.07, 0.02]} />
        </mesh>
      ))}
    </group>
  );
}

function House({ progress }: { progress: MotionValue<number> }) {
  const g = useRef<THREE.Group>(null);
  const glow = useRef(0);
  useFrame(({ clock }, dt) => {
    const p = progress.get();
    const o = g.current!;
    const idle = p < 0.13 ? Math.sin(clock.elapsedTime * 0.6) * 0.15 : 0;
    o.rotation.y = damp(o.rotation.y, track(HOUSE.rotY, p) + idle, 5, dt);
    o.position.x = damp(o.position.x, track(HOUSE.x, p), 4, dt);
    o.position.y = damp(o.position.y, track(HOUSE.y, p) + (p < 0.13 ? Math.sin(clock.elapsedTime * 1.2) * 0.06 : 0), 4, dt);
    const s = damp(o.scale.x, track(HOUSE.scale, p), 5, dt);
    o.scale.setScalar(Math.max(0.0001, s));
    o.visible = s > 0.01;
    glow.current = damp(glow.current, track(HOUSE.crackGlow, p), 6, dt);
  });
  return (
    <group ref={g}>
      {/* walls */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial color="#FFFFFF" emissive="#E8EEF6" emissiveIntensity={0.45} roughness={0.85} />
      </mesh>
      {/* roof slab + parapet */}
      <mesh position={[0, H / 2 + 0.14, 0]} castShadow>
        <boxGeometry args={[W + 0.3, 0.28, D + 0.3]} />
        <meshStandardMaterial color={BLUE} roughness={0.6} />
      </mesh>
      <mesh position={[0, H / 2 - 0.05, 0]}>
        <boxGeometry args={[W + 0.04, 0.12, D + 0.04]} />
        <meshStandardMaterial color="#001A3D" />
      </mesh>
      <Windows z={D / 2} litEvery={3} />
      <Windows z={-D / 2} litEvery={7} flip />
      {/* side windows */}
      {[-1, 1].map((side) => [0, 1, 2, 3, 4].map((r) => (
        <mesh key={`${side}${r}`} position={[side * (W / 2 + 0.01), H / 2 - 0.85 - r * 0.72, 0]} rotation={[0, side * Math.PI / 2, 0]}>
          <boxGeometry args={[0.55, 0.45, 0.02]} />
          <meshStandardMaterial color={r % 3 === 0 ? LIT : '#4A6FA5'} emissive={r % 3 === 0 ? LIT : '#000000'} emissiveIntensity={r % 3 === 0 ? 0.4 : 0} />
        </mesh>
      )))}
      {/* door */}
      <mesh position={[0, -H / 2 + 0.45, D / 2 + 0.02]}>
        <boxGeometry args={[0.6, 0.9, 0.04]} />
        <meshStandardMaterial color={BLUE} />
      </mesh>
      <Cracks glow={glow} />
    </group>
  );
}

/** The live-map chapter: a grid of mini blocks pops up around the house; good deals glow green. */
function MiniHouses({ progress }: { progress: MotionValue<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => {
    const out: { x: number; z: number; h: number; good: boolean; delay: number }[] = [];
    for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 4; gz++) {
      if (Math.abs(gx) <= 1 && Math.abs(gz) <= 1) continue; // the hero house sits in the middle of the grid
      if (Math.random() < 0.25) continue;
      out.push({ x: MINI_X + gx * 1.25 + (Math.random() - 0.5) * 0.3, z: gz * 1.25 + (Math.random() - 0.5) * 0.3, h: 0.6 + Math.random() * 1.2, good: Math.random() < 0.18, delay: Math.random() * 0.5 });
    }
    return out;
  }, []);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => {
    const c = new THREE.Color();
    return items.map((it) => c.set(it.good ? '#1E8E5A' : '#FFFFFF').clone());
  }, [items]);
  useEffect(() => { items.forEach((_, i) => mesh.current!.setColorAt(i, colors[i])); mesh.current!.instanceColor!.needsUpdate = true; }, [items, colors]);
  useFrame(({ clock }) => {
    const appear = track(MINI, progress.get());
    const m = mesh.current!;
    m.visible = appear > 0.001;
    if (!m.visible) return;
    items.forEach((it, i) => {
      const s = Math.max(0.0001, Math.min(1, (appear - it.delay * 0.5) / 0.5));
      const pulse = it.good ? 1 + Math.sin(clock.elapsedTime * 3 + i) * 0.06 : 1;
      tmp.position.set(it.x, -1.8 + (it.h * s) / 2, it.z);
      tmp.scale.set(0.62 * pulse, Math.max(0.0001, it.h * s), 0.62 * pulse);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, items.length]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.7} emissive="#E8EEF6" emissiveIntensity={0.35} />
    </instancedMesh>
  );
}

function CameraRig({ progress }: { progress: MotionValue<number> }) {
  const { camera } = useThree();
  useFrame((_, dt) => {
    const p = progress.get();
    camera.position.y = damp(camera.position.y, track(CAMERA.y, p), 3.5, dt);
    camera.position.z = damp(camera.position.z, track(CAMERA.z, p), 3.5, dt);
    camera.lookAt(0, -0.4, 0);
  });
  return null;
}

/** Stop rendering when the tab is hidden or the stage is scrolled away (saves battery on laptops at the demo). */
function usePaused() {
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

export default function Scene3D({ progress }: { progress: MotionValue<number> }) {
  const paused = usePaused();
  return (
    <Canvas
      className="stage3d"
      dpr={[1, 1.5]}
      frameloop={paused ? 'never' : 'always'}
      shadows
      camera={{ position: [0, 1.2, 14], fov: 34, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-hidden="true"
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[5, 9, 7]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-6, 3, -4]} intensity={0.35} color="#C9D6E8" />
      <CameraRig progress={progress} />
      <House progress={progress} />
      <MiniHouses progress={progress} />
      <ContactShadows position={[0, -2.32, 0]} opacity={0.28} scale={18} blur={2.4} far={6} color={BLUE} />
    </Canvas>
  );
}
