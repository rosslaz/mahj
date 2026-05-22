'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';

// Two flows, decided at runtime based on whether the user is running the
// app from a home-screen-installed PWA:
//
//   PWA user (display-mode: standalone)
//     → defaults to OTP code entry. Magic links from email open in the
//       default browser, NOT the PWA. The user could click the link in
//       Mail and end up signed in to Safari while their PWA stays signed
//       out. The code path keeps auth inside the PWA where they wanted it.
//
//   Browser user
//     → defaults to magic-link flow. Faster to click than to type. The
//       code is still offered as a fallback via a small link.
//
// Both flows hit the same Supabase signInWithOtp call — that endpoint emits
// an email containing BOTH a magic link and a code. We just present them
// differently. Same email arrives either way.

type Phase = 'email' | 'sent';

// A typed code is "plausible" if it's exactly 6 or 8 digits after stripping
// spaces/dashes — the two lengths Supabase uses by default depending on
// project config.
function isPlausibleCode(raw: string): boolean {
  const cleaned = raw.replace(/\s|-/g, '');
  return /^\d{6}$/.test(cleaned) || /^\d{8}$/.test(cleaned);
}

// Detect whether we're running inside an installed PWA. The standard signal
// is `display-mode: standalone`. iOS Safari additionally exposes a
// non-standard `navigator.standalone` boolean for backward compatibility.
function detectIsPwa(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if ((window.navigator as any).standalone === true) return true;
  } catch { /* old browser, fall through */ }
  return false;
}

export default function SignInPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Two tabs at the top of the form:
  //   sign_in        → returning users; no legal checkboxes shown
  //   create_account → new users; must accept ToS/Privacy/parental consent
  // Both paths call signInWithOtp with shouldCreateUser: true. The difference
  // is purely UI framing: which field-set is shown, what the button says,
  // and what client-side validation requires. The auth flow is identical.
  //
  // Default: 'sign_in'. New users tap the Create Account tab to switch.
  const [mode, setMode] = useState<'sign_in' | 'create_account'>('sign_in');

  // Legal acceptance state. Only meaningful in create_account mode.
  //   - termsAccepted: ToS + AUP (combined since AUP is part of ToS)
  //   - privacyAcknowledged: Privacy Policy
  //   - parentalConsent: only required if user indicates they're under 18
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  // True when the user marks themselves as under 18. Drives parental-consent UI.
  const [underAge, setUnderAge] = useState(false);
  const [parentalConsent, setParentalConsent] = useState(false);

  // PWA detection. Initialized to null so the first render doesn't make
  // a layout decision before we know. Effect resolves it once.
  const [isPwa, setIsPwa] = useState<boolean | null>(null);
  useEffect(() => { setIsPwa(detectIsPwa()); }, []);

  // Show a brief farewell message if the user just deleted their account.
  // Read from URL directly to avoid useSearchParams Suspense requirement.
  const [showDeletedMessage, setShowDeletedMessage] = useState(false);
  // Carry-through next-URL for post-signin destination (e.g. invite acceptance)
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('deleted') === '1') setShowDeletedMessage(true);
    const n = params.get('next');
    if (n && n.startsWith('/')) {  // only allow same-origin paths
      setNextUrl(n);
    }
  }, []);

  // In browser mode, the code form is hidden behind a "Link not working?"
  // toggle. In PWA mode, the code form is the primary UI — this toggle
  // is unused (kept for symmetry).
  const [showCodeFormInBrowser, setShowCodeFormInBrowser] = useState(false);

  // In browser mode, also offer a quiet "or use the link" affordance when
  // the user is on the code form. In PWA mode the link won't work anyway.
  const [showLinkInfoInPwa, setShowLinkInfoInPwa] = useState(false);

  // Auto-focus the code input when it becomes visible
  useEffect(() => {
    if (phase !== 'sent') return;
    // PWA: code input is always there once we're on the sent screen
    // Browser: code input appears when toggled
    const codeIsVisible = isPwa === true || showCodeFormInBrowser;
    if (codeIsVisible) codeInputRef.current?.focus();
  }, [phase, isPwa, showCodeFormInBrowser]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Only stash pending-acceptance for new users. Returning users already
    // have legal acceptance records — LegalGate will see them and let them
    // through without re-prompting.
    if (mode === 'create_account') {
      try {
        sessionStorage.setItem(
          'pungctual:pending-acceptance',
          JSON.stringify({ parentalConsent: underAge ? parentalConsent : true })
        );
      } catch { /* sessionStorage might be unavailable; not fatal */ }
    } else {
      // Clear any stale acceptance from a previous Create Account attempt
      try { sessionStorage.removeItem('pungctual:pending-acceptance'); } catch {}
    }
    const supabase = getBrowserSupabase();
    // Pass `next` through to the callback so post-sign-in we land on the
    // requested destination (e.g. an invite acceptance page).
    const callbackUrl = new URL(`${window.location.origin}/auth/callback`);
    if (nextUrl) callbackUrl.searchParams.set('next', nextUrl);
    const redirectTo = callbackUrl.toString();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (error) setError(error.message);
    else setPhase('sent');
    setBusy(false);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setVerifyError(null);
    const supabase = getBrowserSupabase();
    const cleanCode = code.replace(/\s|-/g, '');
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: cleanCode,
      type: 'email',
    });
    if (error) {
      setVerifyError(error.message);
      setVerifying(false);
      return;
    }
    if (!data.session) {
      setVerifyError('Verification did not produce a session. Try again.');
      setVerifying(false);
      return;
    }
    // Carry through `next` so post-signin we land on the right page.
    const callbackPath = nextUrl
      ? `/auth/callback?from=otp&next=${encodeURIComponent(nextUrl)}`
      : '/auth/callback?from=otp';
    router.push(callbackPath);
  }

  function resetToEmailEntry() {
    setPhase('email');
    setShowCodeFormInBrowser(false);
    setShowLinkInfoInPwa(false);
    setCode('');
    setError(null);
    setVerifyError(null);
  }

  return (
    <div className="max-w-md mx-auto pt-8">
      {showDeletedMessage && (
        <div className="tile-border p-5 mb-6 bg-jade/5 border-jade/40">
          <p className="text-sm text-ink/80">
            <strong>Your account has been deleted.</strong> A confirmation email is on its way. Thanks for being part of Pungctual.
          </p>
        </div>
      )}
      <header className="mb-10">
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">Enter the Parlor</p>
        <h1 className="font-display text-5xl">
          {mode === 'sign_in' ? 'Sign In' : 'Create Account'}
        </h1>
        <p className="mt-3 text-ink/60 italic font-display">
          {mode === 'sign_in'
            ? (isPwa ? 'A code will arrive in your inbox.' : 'A link will arrive in your inbox.')
            : (isPwa ? 'A code will arrive in your inbox.' : 'A link will arrive in your inbox.')}
        </p>
      </header>

      {phase === 'email' && (
        <div className="space-y-4">
          {/* Tab toggle: Sign In / Create Account */}
          <div className="grid grid-cols-2 gap-0 border border-ink/15">
            <button
              type="button"
              onClick={() => setMode('sign_in')}
              className={`py-3 px-4 text-xs tracking-[0.2em] uppercase transition-colors ${
                mode === 'sign_in'
                  ? 'bg-jade text-bone'
                  : 'bg-bone text-ink/60 hover:bg-ink/5'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('create_account')}
              className={`py-3 px-4 text-xs tracking-[0.2em] uppercase transition-colors ${
                mode === 'create_account'
                  ? 'bg-jade text-bone'
                  : 'bg-bone text-ink/60 hover:bg-ink/5'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={sendLink} className="tile-border p-7 space-y-5">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
              {mode === 'create_account' && (
                <p className="mt-2 text-xs text-ink/40 italic">
                  We&apos;ll create your account when you confirm your email.
                </p>
              )}
            </div>

            {/* Legal acceptance — only shown for new users creating an account.
                Returning users already have acceptance records and don't need
                to re-tick on every sign-in. */}
            {mode === 'create_account' && (
              <div className="border-t border-ink/10 pt-5 space-y-3">
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
                  <label className="flex items-start gap-3 cursor-pointer text-sm ml-7 pl-1 border-l-2 border-cinnabar/30 -mt-1 pl-3">
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
                <p className="text-[11px] text-ink/40 italic pt-1">
                  You must be at least 13 years old to use Pungctual.
                </p>
              </div>
            )}

            {error && <p className="text-cinnabar text-sm">{error}</p>}
            <button
              className="btn btn-jade w-full justify-center"
              disabled={
                busy ||
                (mode === 'create_account' && (
                  !termsAccepted ||
                  !privacyAcknowledged ||
                  (underAge && !parentalConsent)
                ))
              }
            >
              {busy
                ? 'Sending…'
                : (mode === 'sign_in' ? 'Send Sign-In Email' : 'Create Account')}
            </button>
          </form>

          {/* Cross-tab nudge for users who tap the wrong one */}
          <p className="text-xs text-ink/40 italic text-center">
            {mode === 'sign_in' ? (
              <>New here?{' '}
                <button
                  type="button"
                  onClick={() => setMode('create_account')}
                  className="text-jade underline hover:text-cinnabar"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setMode('sign_in')}
                  className="text-jade underline hover:text-cinnabar"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {phase === 'sent' && isPwa === true && (
        // ============================================================
        // PWA MODE: code entry is the primary UI
        // ============================================================
        <div className="space-y-5">
          <form onSubmit={verifyCode} className="tile-border p-7 space-y-5">
            <div>
              <h2 className="font-display text-2xl mb-1">Enter your code</h2>
              <p className="text-sm text-ink/60">
                We sent a code to <strong>{email}</strong>. Type it below to sign in.
              </p>
            </div>
            <div>
              <label className="label">Code from email</label>
              <input
                ref={codeInputRef}
                type="text"
                className="input text-center text-2xl tracking-[0.4em] font-mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                placeholder="12345678"
                required
              />
            </div>
            {verifyError && <p className="text-cinnabar text-sm">{verifyError}</p>}
            <button
              type="submit"
              className="btn btn-jade w-full justify-center"
              disabled={verifying || !isPlausibleCode(code)}
            >
              {verifying ? 'Verifying…' : 'Verify & Sign In'}
            </button>
            <p className="text-xs text-ink/40 italic">
              Check spam if it doesn't arrive within a minute. The code expires after about an hour.
            </p>
          </form>

          {/* Quiet escape hatch for PWA users who prefer the link. Rarely
              useful here since the link opens outside the PWA, but kept
              for the unusual cases (desktop PWAs where browser/PWA share
              cookies, troubleshooting, etc). */}
          {!showLinkInfoInPwa ? (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowLinkInfoInPwa(true)}
                className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
              >
                Use the link instead?
              </button>
            </div>
          ) : (
            <div className="tile-border p-5 text-sm text-ink/70 space-y-2">
              <p>
                Your email also includes a magic link. Clicking it on this device may open the link in your default browser rather than this app — which would sign you in there, not here.
              </p>
              <p className="text-xs text-ink/40 italic">
                Typing the code keeps you signed in within Pungctual.
              </p>
            </div>
          )}

          <div className="text-center">
            <button
              type="button"
              onClick={resetToEmailEntry}
              className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
            >
              ← Use a different email
            </button>
          </div>
        </div>
      )}

      {phase === 'sent' && isPwa === false && (
        // ============================================================
        // BROWSER MODE: magic-link is the primary UI; code is fallback
        // ============================================================
        <div className="space-y-5">
          <div className="tile-border p-7 space-y-3">
            <h2 className="font-display text-2xl">Check your email</h2>
            <p className="text-sm text-ink/70">
              We sent a sign-in email to <strong>{email}</strong>.
            </p>
            <p className="text-sm text-ink/70">
              Click the magic link in the email <strong>on this same browser</strong>, and you'll be signed in.
            </p>
            <p className="text-xs text-ink/40 italic">
              If it doesn't appear in a minute, check spam.
            </p>
          </div>

          {!showCodeFormInBrowser ? (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowCodeFormInBrowser(true)}
                className="text-xs tracking-[0.15em] uppercase text-ink/50 hover:text-cinnabar"
              >
                Link not working? Enter code instead →
              </button>
            </div>
          ) : (
            <form onSubmit={verifyCode} className="tile-border p-7 space-y-5">
              <div>
                <h3 className="font-display text-xl mb-1">Enter code</h3>
                <p className="text-xs text-ink/50 italic">
                  Your email also contains a one-time code. Type it below to sign in here.
                </p>
              </div>
              <div>
                <label className="label">Code from email</label>
                <input
                  ref={codeInputRef}
                  type="text"
                  className="input text-center text-2xl tracking-[0.4em] font-mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  placeholder="12345678"
                  required
                />
              </div>
              {verifyError && <p className="text-cinnabar text-sm">{verifyError}</p>}
              <div className="flex items-center gap-3">
                <button
                  className="btn btn-jade flex-1 justify-center"
                  disabled={verifying || !isPlausibleCode(code)}
                >
                  {verifying ? 'Verifying…' : 'Verify & Sign In'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCodeFormInBrowser(false); setCode(''); setVerifyError(null); }}
                  className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-ink/40 italic">
                Same email, same code — use whichever way is easiest. The code expires after about an hour.
              </p>
            </form>
          )}

          <div className="text-center">
            <button
              type="button"
              onClick={resetToEmailEntry}
              className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
            >
              ← Use a different email
            </button>
          </div>
        </div>
      )}

      {/* While PWA detection is in flight (very brief), show nothing rather
          than flash the wrong layout. isPwa starts null and resolves
          synchronously on first effect. */}
    </div>
  );
}
