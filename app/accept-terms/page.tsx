'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/use-auth';

export default function AcceptTermsPageWrapper() {
  return (
    <Suspense fallback={<p className="text-ink/40 italic text-center py-12">…</p>}>
      <AcceptTermsPage />
    </Suspense>
  );
}

/**
 * The hard-block page that existing users see when there's a legal document
 * version they haven't accepted.
 *
 * Shows checkboxes for ToS+AUP, Privacy, optional under-18 + parental consent.
 * Submits via recordLegalAcceptance, then redirects to `next` (or /).
 *
 * Users CAN view the documents from here (links open in new tab). They
 * CAN'T navigate elsewhere in the app without accepting; the LegalGate
 * routes them right back here.
 */

function AcceptTermsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') || '/';
  const auth = useAuth();

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [underAge, setUnderAge] = useState(false);
  const [parentalConsent, setParentalConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If they aren't signed in, send them to sign-in (where they accept anyway)
  useEffect(() => {
    if (!auth.loading && !auth.userId) router.replace('/sign-in');
  }, [auth.loading, auth.userId, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { recordLegalAcceptance } = await import('@/app/actions/legal');
      const res = await recordLegalAcceptance({
        parentalConsentAttested: underAge ? parentalConsent : true,
      });
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      router.replace(next);
    } catch (e: any) {
      setError(e?.message || 'Could not record acceptance.');
      setBusy(false);
    }
  }

  if (auth.loading || !auth.userId) {
    return <p className="text-ink/40 italic text-center py-12">…</p>;
  }

  return (
    <div className="max-w-xl mx-auto pt-8">
      <header className="mb-8">
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">One more step</p>
        <h1 className="font-display text-4xl">Updated Terms</h1>
        <p className="mt-4 text-ink/70">
          We&apos;ve published our terms of service, privacy policy, and acceptable use policy. Please review and accept them to continue using Pungctual.
        </p>
      </header>

      <form onSubmit={submit} className="tile-border p-7 space-y-5">
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="accent-jade w-4 h-4 mt-0.5 flex-shrink-0"
              required
            />
            <span className="text-ink/80">
              I agree to the{' '}
              <Link href="/terms" target="_blank" className="text-jade underline">Terms of Service</Link>
              {' '}and{' '}
              <Link href="/acceptable-use" target="_blank" className="text-jade underline">Acceptable Use Policy</Link>.
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={privacyAcknowledged}
              onChange={(e) => setPrivacyAcknowledged(e.target.checked)}
              className="accent-jade w-4 h-4 mt-0.5 flex-shrink-0"
              required
            />
            <span className="text-ink/80">
              I have read the{' '}
              <Link href="/privacy" target="_blank" className="text-jade underline">Privacy Policy</Link>.
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={underAge}
              onChange={(e) => { setUnderAge(e.target.checked); if (!e.target.checked) setParentalConsent(false); }}
              className="accent-jade w-4 h-4 mt-0.5 flex-shrink-0"
            />
            <span className="text-ink/80">
              I am under 18 years old.
            </span>
          </label>

          {underAge && (
            <label className="flex items-start gap-3 cursor-pointer text-sm ml-7 pl-3 border-l-2 border-cinnabar/30">
              <input
                type="checkbox"
                checked={parentalConsent}
                onChange={(e) => setParentalConsent(e.target.checked)}
                className="accent-jade w-4 h-4 mt-0.5 flex-shrink-0"
                required={underAge}
              />
              <span className="text-ink/80">
                My parent or legal guardian has read these documents and consents to my use of Pungctual.
              </span>
            </label>
          )}
        </div>

        {error && <p className="text-cinnabar text-sm">{error}</p>}

        <button
          className="btn btn-jade w-full justify-center"
          disabled={
            busy ||
            !termsAccepted ||
            !privacyAcknowledged ||
            (underAge && !parentalConsent)
          }
        >
          {busy ? 'Saving…' : 'Accept and Continue'}
        </button>

        <p className="text-xs text-ink/40 italic">
          You must accept to continue using Pungctual. If you do not wish to accept, you may close this tab; we&apos;ll keep your account but you won&apos;t be able to access it until you accept.
        </p>
      </form>
    </div>
  );
}
