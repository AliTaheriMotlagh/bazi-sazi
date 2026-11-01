import { useEffect, useState } from 'react';

/** Reactive CSS media query. */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Below this share of the screen height, the on-screen keyboard is assumed to be open. */
export const KEYBOARD_RATIO = 0.75;

export function isKeyboardOpen(viewportHeight: number, screenHeight: number): boolean {
  return viewportHeight < screenHeight * KEYBOARD_RATIO;
}

/**
 * Tracks the visual viewport (what is left above the on-screen keyboard) in the `--vvh` CSS variable so the
 * editor can fit above the keyboard on iOS, which does not resize the layout viewport. Returns whether the
 * keyboard looks open.
 */
export function useKeyboardAwareHeight(enabled: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!enabled || !vv) return;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      setOpen(isKeyboardOpen(vv.height, window.screen.height || window.innerHeight));
      // iOS scrolls the page when the keyboard opens; keep the editor pinned to the top.
      if (window.scrollY) window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--vvh');
      setOpen(false);
    };
  }, [enabled]);
  return open;
}
