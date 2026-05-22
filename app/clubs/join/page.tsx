'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { notifyClubMemberJoined } from '@/app/actions/notifications';

export default function JoinClubPage() {
  const router = useRouter();
  const auth = useAuth();
  const supabase = getBrowserSupabase();

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.loading) return <p className="text-ink/40 italic">Loading…</p>;
  if (!auth.email || !auth.userId) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Sign in</h1>
        <p className="text-ink/60 mb-6">You need to sign in to join a club.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!auth.userId) return;  // narrows for TS + safety guard
    const userId = auth.userId;
    const cleaned = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length < 4) { setError('Enter a valid code.'); return; }

    setSubmitting(true);

    const { data: clubData } = await supabase
      .from('clubs')
      .select('id, slug, name')
      .eq('join_code', cleaned)
      .is('deleted_at', null)
      .maybeSingle();

    if (!clubData) {
      setError('No club found for that code.');
      setSubmitting(false);
      return;
    }

    const clubId = (clubData as any).id;
    const { error: memErr } = await supabase.from('club_members').insert({
      club_id: clubId,
      user_id: userId,
      role: 'member',
    });

    if (memErr && memErr.code !== '23505') {
      setError(memErr.message);
      setSubmitting(false);
      return;
    }

    // Notify admins of the new member (don't wait — let routing proceed)
    if (!memErr) {
      notifyClubMemberJoined(clubId, userId).catch(() => {});
    }

    router.push(`/c/${(clubData as any).slug}`);
  }

  return (
    <div className="max-w-md mx-auto space-y-10">
      <header>
        <Link href="/clubs" className="text-xs tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">← My Clubs</Link>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mt-4 mb-3">An invitation</p>
        <h1 className="font-display text-5xl">Join Club</h1>
      </header>

      <form onSubmit={join} className="tile-border p-7 space-y-5">
        <div>
          <label className="label">Join Code</label>
          <input
            className="input font-display text-2xl tracking-[0.3em] uppercase text-center"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABC-123"
            maxLength={10}
            autoComplete="off"
            autoCapitalize="characters"
            required
          />
          <p className="text-xs text-ink/40 italic mt-1">Ask the club owner for the 6-character code.</p>
        </div>

        {error && <p className="text-cinnabar text-sm">{error}</p>}

        <button className="btn btn-jade w-full justify-center" disabled={submitting}>
          {submitting ? 'Joining…' : 'Join'}
        </button>
      </form>
    </div>
  );
}
