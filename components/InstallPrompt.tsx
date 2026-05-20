'use client';

import { useEffect, useState } from 'react';

// The browser fires `beforeinstallprompt` when the app meets installability
// criteria (HTTPS, manifest present, service worker registered, not already
// installed). We capture it, prevent the auto-mini-infobar, and surface a
// tasteful in-app prompt instead — giving us control over timing and copy.
//
// On iOS Safari this event never fires (Apple doesn't support it), but iOS
// users can still "Add to Home Screen" from the share menu. We show a small
// hint for iOS visitors who haven't installed yet.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'mahjong-install-dismissed-until';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari standalone flag
  if ((window.navigator as any).standalone === true) return true;
  return false;
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}

function isDismissed(): boolean {
  try {
    const until = localStorage.getItem(DISMISS_KEY);
    if (!until) return false;
    return Date.now() < parseInt(until, 10);
  } catch {
    return false;
  }
}

function dismissFor(days: number) {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 86400 * 1000));
  } catch { /* ignore */ }
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone()) return;          // already installed
    if (isDismissed()) return;            // user said not now

    // Generic Chromium/Edge install flow
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Hide if installed during this session
    const onInstalled = () => {
      setHidden(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS: show hint if not in standalone mode
    if (isIOS()) {
      setShowIOSHint(true);
      setHidden(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (hidden) return null;

  const onInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setHidden(true);
    } else {
      // Dismissed via the system prompt — back off for 30 days
      dismissFor(30);
      setHidden(true);
    }
    setDeferredPrompt(null);
  };

  const onDismiss = () => {
    dismissFor(7); // shorter cooldown for "not now" than for outright reject
    setHidden(true);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:max-w-sm z-40 fade-up">
      <div className="tile-border bg-bone p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <img
            src="/icon-192.png"
            alt=""
            className="w-12 h-12 flex-shrink-0 rounded"
          />
          <div className="flex-1 min-w-0">
            <div className="font-display text-lg leading-tight">Install Pungctual</div>
            {showIOSHint ? (
              <p className="text-xs text-ink/60 italic mt-1 leading-snug">
                Tap the Share button, then "Add to Home Screen" for a full-screen app experience.
              </p>
            ) : (
              <p className="text-xs text-ink/60 italic mt-1 leading-snug">
                Add to your home screen for quick access and full-screen play.
              </p>
            )}
            <div className="flex gap-2 mt-3 items-center">
              {!showIOSHint && deferredPrompt && (
                <button onClick={onInstall} className="btn btn-jade text-xs px-3 py-1.5">
                  Install
                </button>
              )}
              <button
                onClick={onDismiss}
                className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
