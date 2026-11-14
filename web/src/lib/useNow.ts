import { useSyncExternalStore } from 'react';

// One shared 1 s clock for every "seen 12 s ago", instead of an interval per card.
let now = Date.now();
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) timer = setInterval(() => { now = Date.now(); subs.forEach((s) => s()); }, 1000);
  return () => {
    subs.delete(cb);
    if (!subs.size && timer) { clearInterval(timer); timer = null; }
  };
}

export const useNow = () => useSyncExternalStore(subscribe, () => now, () => now);
