import { useEffect, useState } from 'react';

export function useMotion() {
  const [enabled, setEnabledState] = useState(() => { try { return localStorage.getItem('asu-motion') !== 'off'; } catch { return true; } });
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { document.documentElement.dataset.motion = enabled && !reduced ? 'full' : 'off'; }, [enabled, reduced]);
  useEffect(() => {
    const visibility = () => { document.documentElement.dataset.pageVisible = String(!document.hidden); };
    const pointer = () => { document.documentElement.dataset.inputMethod = 'pointer'; };
    const keyboard = (event: KeyboardEvent) => { if (['Tab', 'Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) document.documentElement.dataset.inputMethod = 'keyboard'; };
    visibility(); document.addEventListener('visibilitychange', visibility); document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('visibilitychange', visibility); document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', keyboard); };
  }, []);
  const setEnabled = (value: boolean) => { setEnabledState(value); try { localStorage.setItem('asu-motion', value ? 'on' : 'off'); } catch { /* The current device preference still applies for this session. */ } };
  return { enabled, reduced, setEnabled };
}
export type MotionPreference = ReturnType<typeof useMotion>;
