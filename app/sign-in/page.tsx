'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
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
    else setSent(true);
    setBusy(false);
  }

  return (
    <div className="max-w-md mx-auto pt-8">
      <header className="mb-10">
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">Enter the Parlor</p>
        <h1 className="font-display text-5xl">Sign In</h1>
        <p className="mt-3 text-ink/60 italic font-display">Or create an account. A link will arrive in your inbox.</p>
      </header>

      {sent ? (
        <div className="tile-border p-7 space-y-4">
          <h2 className="font-display text-2xl">Check your email</h2>
          <p className="text-sm text-ink/70">
            We sent a sign-in link to <strong>{email}</strong>. Click it on this device to continue.
          </p>
          <p className="text-xs text-ink/40 italic">If it doesn't appear in a minute, check spam.</p>
          <Link href="/" className="btn btn-ghost">← Home</Link>
        </div>
      ) : (
        <form onSubmit={send} className="tile-border p-7 space-y-5">
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
              New here? Just enter your email — we'll create your account when you click the link.
            </p>
          </div>
          {error && <p className="text-cinnabar text-sm">{error}</p>}
          <button className="btn btn-jade w-full justify-center" disabled={busy}>
            {busy ? 'Sending…' : 'Send Magic Link'}
          </button>
        </form>
      )}
    </div>
  );
}
