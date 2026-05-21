'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Phase = 'idle' | 'pulling' | 'ready' | 'refreshing';

const THRESHOLD = 80;        // px of pull required to trigger refresh
const MAX_PULL = 120;        // px hard limit so it doesn't drag forever
const RESISTANCE = 0.55;     // multiplier on raw finger movement; gives the "rubbery" feel
const SNAP_BACK_MS = 220;    // animation duration after release / completion

/**
 * Pull-to-refresh wrapper for mobile/touch screens.
 *
 * Behavior:
 *   - Only intercepts touches that begin when the document is scrolled to
 *     the top. Otherwise we let normal scrolling work.
 *   - Translates the wrapped content downward as the user drags, with
 *     diminishing-returns resistance so it never feels uncontrollable.
 *   - Above THRESHOLD, the indicator flips to "release to refresh".
 *   - Release above threshold → calls onRefresh(), shows spinner, snaps back.
 *   - Release below threshold → snaps back immediately, no refresh.
 *
 * Mouse is ignored entirely. Desktop users have refresh-on-focus + the
 * browser refresh button + page navigation. Pull-to-refresh is a mobile
 * affordance.
 */
export function PullToRefresh({
  onRefresh,
  children,
  enabled = true,
}: {
  onRefresh: () => void | Promise<void>;
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [pullY, setPullY] = useState(0);  // current displacement in px
  const startYRef = useRef<number | null>(null);
  const trackingRef = useRef(false);

  // Keep latest onRefresh in a ref so we don't have to re-bind listeners
  // when the parent passes an inline function.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  // Is the document scrolled all the way to the top? We only start tracking
  // a pull if so — otherwise the user is trying to scroll content upward
  // (= a normal swipe) and we mustn't hijack.
  const isAtTop = useCallback(() => {
    return (window.scrollY || document.documentElement.scrollTop) <= 0;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (phase === 'refreshing') return;
      if (!isAtTop()) return;
      if (e.touches.length !== 1) return;
      startYRef.current = e.touches[0].clientY;
      trackingRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!trackingRef.current || phase === 'refreshing') return;
      if (startYRef.current === null) return;

      const dy = e.touches[0].clientY - startYRef.current;

      if (dy <= 0) {
        // Finger moved up (or stayed put) — cancel tracking; we're not
        // pulling down anymore. Let normal scroll resume.
        trackingRef.current = false;
        startYRef.current = null;
        if (pullY !== 0) {
          setPhase('idle');
          setPullY(0);
        }
        return;
      }

      // Active pull. Apply resistance so the feel is exponential-ish.
      const pulled = Math.min(MAX_PULL, dy * RESISTANCE);
      setPullY(pulled);
      setPhase(pulled >= THRESHOLD ? 'ready' : 'pulling');

      // Prevent the browser's own pull-to-refresh (Chrome on Android) and
      // any overscroll/bounce while we're managing this gesture.
      // Note: preventDefault on touchmove requires non-passive listener.
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = async () => {
      if (!trackingRef.current) return;
      trackingRef.current = false;
      const wasReady = phase === 'ready';
      startYRef.current = null;

      if (wasReady) {
        setPhase('refreshing');
        setPullY(THRESHOLD);  // hold indicator at threshold during refresh
        try {
          await onRefreshRef.current();
        } catch (e) {
          console.error('[PullToRefresh] onRefresh threw', e);
        } finally {
          // Snap back; CSS transition handles the animation
          setPullY(0);
          // Wait for the snap animation to finish before going to idle so
          // the indicator doesn't flicker
          setTimeout(() => setPhase('idle'), SNAP_BACK_MS);
        }
      } else {
        setPhase('idle');
        setPullY(0);
      }
    };

    const onTouchCancel = () => {
      trackingRef.current = false;
      startYRef.current = null;
      if (phase !== 'refreshing') {
        setPhase('idle');
        setPullY(0);
      }
    };

    // Non-passive on touchmove so preventDefault works to suppress Chrome's
    // native overscroll-refresh. Passive on the others.
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [enabled, phase, isAtTop, pullY]);

  // Indicator: a small jade circle, rotates with pull progress, becomes a
  // spinner during refresh. Sits at the top of the wrapper, partially
  // hidden until pulled.
  const indicatorOpacity = Math.min(1, pullY / (THRESHOLD * 0.5));
  const rotation = Math.min(360, (pullY / THRESHOLD) * 270);
  const showIndicator = phase !== 'idle' || pullY > 0;

  return (
    <div
      style={{
        // overscroll-behavior prevents the browser-native pull-refresh
        // (Chrome Android) from competing with ours.
        overscrollBehaviorY: 'contain',
      }}
    >
      {/* Indicator strip */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: `translate(-50%, ${Math.max(0, pullY - 40)}px)`,
          opacity: showIndicator ? indicatorOpacity : 0,
          transition: phase === 'pulling' || phase === 'ready' ? 'none' : `transform ${SNAP_BACK_MS}ms ease, opacity ${SNAP_BACK_MS}ms ease`,
          zIndex: 60,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#f5efe6',
            border: '1px solid rgba(26,20,16,0.15)',
            boxShadow: '0 2px 8px rgba(26,20,16,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {phase === 'refreshing' ? (
            <RefreshSpinner />
          ) : (
            <RefreshArrow rotation={rotation} ready={phase === 'ready'} />
          )}
        </div>
      </div>

      {/* Content wrapper — translated downward as user pulls */}
      <div
        style={{
          transform: `translateY(${pullY}px)`,
          transition: phase === 'pulling' || phase === 'ready' ? 'none' : `transform ${SNAP_BACK_MS}ms ease`,
          willChange: pullY > 0 ? 'transform' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function RefreshArrow({ rotation, ready }: { rotation: number; ready: boolean }) {
  const color = ready ? '#3d6b4f' /* jade */ : 'rgba(26,20,16,0.5)';
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 60ms linear, stroke 120ms ease' }}>
      <path
        d="M12 5v14M12 19l-6-6M12 19l6-6"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshSpinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={{ animation: 'ptr-spin 0.9s linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="rgba(26,20,16,0.15)" strokeWidth="2.5" fill="none" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="#3d6b4f"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <style>{`@keyframes ptr-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
