'use client';

import { useEffect, useRef } from 'react';

/**
 * Re-runs `refetch` when the page becomes visible after being backgrounded,
 * or when the window regains focus.
 *
 * Two events for belt-and-suspenders:
 *   - `visibilitychange` fires reliably on mobile (PWA returns from background,
 *     screen unlocks, app switcher dismiss). Doesn't fire on desktop tab focus.
 *   - `focus` fires on desktop when the window is refocused. Some mobile
 *     browsers also fire it on app return.
 *
 * Together they catch every "user came back to this page" case.
 *
 * Includes a small debounce: if visibility AND focus fire within the same
 * 500ms (common when restoring an app), refetch runs once, not twice.
 *
 * The hook captures `refetch` in a ref so it doesn't re-subscribe on every
 * render if the parent passes an inline arrow function (which would change
 * identity each render).
 */
export function useRefreshOnFocus(refetch: () => void, enabled = true) {
  const refetchRef = useRef(refetch);
  useEffect(() => { refetchRef.current = refetch; }, [refetch]);

  useEffect(() => {
    if (!enabled) return;
    let lastFiredAt = 0;
    const DEBOUNCE_MS = 500;

    const fire = (reason: string) => {
      const now = Date.now();
      if (now - lastFiredAt < DEBOUNCE_MS) return;
      lastFiredAt = now;
      // Wrap in try/catch — the caller's refetch might throw, but we don't
      // want one bad refresh to break the listener for future ones.
      try {
        refetchRef.current();
      } catch (e) {
        console.error(`[useRefreshOnFocus:${reason}]`, e);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fire('visibility');
    };
    const onFocus = () => fire('focus');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled]);
}
