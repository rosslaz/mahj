'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';

// Two-phase sign-in:
//   Phase 1 (email): user enters email; we call signInWithOtp which sends
//     an email containing BOTH a magic link AND a one-time code (typically
//     6 or 8 digits depending on the Supabase project settings).
//   Phase 2 (verify): we show the "check email" confirmation, plus a
//     collapsible "enter code instead" form. The link is preferred — but
//     if the user is on a device where it would open in the wrong browser
//     (default-browser ≠ app browser, PWA-from-Safari-default, etc.),
//     they can type the code from the email instead and complete
//     auth in this exact session.

type Phase = 'email' | 'sent';

// A typed code is "plausible" if it's exactly 6 or 8 digits after stripping
// spaces/dashes — the two lengths Supabase uses by default depending on
// project config. Used to enable/disable the verify button.
function isPlausibleCode(raw: string): boolean {
  const cleaned = raw.replace(/\s|-/g, '');
  return /^\d{6}$/.test(cleaned) || /^\d{8}$/.test(cleaned);
}

export default function SignInPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The code-entry UI is off by default — magic link is the primary path.
  // Some users will just use the link and never see this.
  const [showCodeForm, setShowCodeForm] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCodeForm) codeInputRef.current?.focus();
  }, [showCodeForm]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = getBrowserSupabase();
    const redirectTo = `${window.location.origin}/auth/callback`;
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
    // Strip spaces/dashes — users sometimes type "123 456" or "123-456"
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
    // We're now authenticated. /auth/callback creates the users row for
    // new signups and redirects to /profile?welcome=1 — but it expects a
    // ?code=... query and runs server-side. Since we verified client-side
    // and have a session, we go straight to the post-sign-in landing.
    // The users row will be created by our existing handling in /auth/callback
    // or on first /profile load. To be safe, navigate via the callback
    // route which has the new-user-row creation logic. Pass next=/ so it
    // lands on home rather than the welcome flow if the user already exists.
    router.push('/auth/callback?from=otp');
  }

  return (
    <div className="max-w-md mx-auto pt-8">
      <header className="mb-10">
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">Enter the Parlor</p>
        <h1 className="font-display text-5xl">Sign In</h1>
        <p className="mt-3 text-ink/60 italic font-display">Or create an account. A link will arrive in your inbox.</p>
      </header>

      {phase === 'email' && (
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
            <p className="mt-2 text-xs text-ink/40 italic">
              New here? Just enter your email — we'll create your account when you sign in.
            </p>
          </div>
          {error && <p className="text-cinnabar text-sm">{error}</p>}
          <button className="btn btn-jade w-full justify-center" disabled={busy}>
            {busy ? 'Sending…' : 'Send Sign-In Email'}
          </button>
        </form>
      )}

      {phase === 'sent' && (
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

          {/* OTP fallback. Off by default so it doesn't distract people who
              just want to click the link. Shown when the link doesn't work
              for them (cross-browser / PWA / different device cases). */}
          {!showCodeForm ? (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowCodeForm(true)}
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
                  // Some projects use 6-digit codes, others 8. Allow up to 10
                  // chars to accommodate either + a typed space.
                  maxLength={10}
                  placeholder="12345678"
                  required
                />
              </div>
              {verifyError && <p className="text-cinnabar text-sm">{verifyError}</p>}
              <div className="flex items-center gap-3">
                {/* Enable submit when the entered code is a plausible length
                    (6 or 8 digits — the two common Supabase configurations).
                    Final validation happens server-side. */}
                <button
                  className="btn btn-jade flex-1 justify-center"
                  disabled={verifying || !isPlausibleCode(code)}
                >
                  {verifying ? 'Verifying…' : 'Verify & Sign In'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCodeForm(false); setCode(''); setVerifyError(null); }}
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
              onClick={() => { setPhase('email'); setShowCodeForm(false); setCode(''); setError(null); setVerifyError(null); }}
              className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
            >
              ← Use a different email
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
