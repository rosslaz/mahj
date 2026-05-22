'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/use-auth';
import { recordLegalAcceptance, checkLegalAcceptance } from '@/app/actions/legal';

/**
 * Headless component that ensures every signed-in user has accepted the
 * current versions of the legal documents.
 *
 * Flow:
 *   1. Wait for auth to resolve
 *   2. If signed in: check legal acceptance
 *   3. If acceptance is pending in sessionStorage (just signed up via sign-in
 *      page), submit that acceptance to the server before checking
 *   4. If still not accepted, redirect to /accept-terms
 *
 * Pages excluded from the gate (so a user CAN reach them while in this
 * unaccepted state): /sign-in, /accept-terms, /terms, /privacy, /acceptable-use.
 * Otherwise they'd be stuck — can't read what they're agreeing to.
 */

const EXEMPT_PATHS = [
  '/sign-in',
  '/accept-terms',
  '/terms',
  '/privacy',
  '/acceptable-use',
  '/auth/callback',  // redirect path
];

export default function LegalGate() {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Skip on exempt paths
    if (EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      setChecked(true);
      return;
    }
    // Skip while auth still resolving or signed out
    if (auth.loading || !auth.userId) {
      setChecked(true);
      return;
    }

    let cancelled = false;
    (async () => {
      // Step 1: if there's a pending acceptance from the sign-in flow,
      // submit it first.
      try {
        const raw = sessionStorage.getItem('pungctual:pending-acceptance');
        if (raw) {
          const parsed = JSON.parse(raw);
          await recordLegalAcceptance({
            parentalConsentAttested: !!parsed.parentalConsent,
          });
          sessionStorage.removeItem('pungctual:pending-acceptance');
        }
      } catch { /* pending submit failed; check will re-route */ }

      if (cancelled) return;

      // Step 2: check whether the user is now in good standing
      try {
        const ok = await checkLegalAcceptance();
        if (cancelled) return;
        if (ok === false) {
          // Existing user who hasn't accepted current versions (or new user
          // whose pending-acceptance failed). Send them to the gate page.
          router.replace('/accept-terms?next=' + encodeURIComponent(pathname));
          return;
        }
      } catch { /* fail open: let them through, gate will catch on next nav */ }
      setChecked(true);
    })();

    return () => { cancelled = true; };
  }, [auth.loading, auth.userId, pathname, router]);

  void checked;
  return null;
}
