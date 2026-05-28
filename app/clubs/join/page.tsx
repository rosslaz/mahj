'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { notifyClubMemberJoined } from '@/app/actions/notifications';
import { checkCanAddMember } from '@/app/actions/billing-gates';

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

    // Look up the club by join code via a SECURITY DEFINER RPC. We can't do
    // a direct `select from clubs where join_code = ?` because the clubs RLS
    // policy hides private clubs from non-members — possessing the code is
    // the authorization, but RLS doesn't know that. The RPC bypasses RLS and
    // returns only minimal fields.
    const { data: rpcData, error: lookupErr } = await supabase
      .rpc('lookup_club_by_join_code', { p_code: cleaned });

    if (lookupErr) {
      setError('Could not look up that code. Try again.');
      setSubmitting(false);
      return;
    }

    // RPC returns a table (array). Take the first row.
    const clubData = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    if (!clubData) {
      setError('No club found for that code.');
      setSubmitting(false);
      return;
    }

    const clubId = (clubData as any).id;

    // Free-tier gate: max 5 members per club.
    // This is on the JOINER's side — if the club is full, the new person
    // can't join. The owner needs to upgrade or remove someone.
    const gate = await checkCanAddMember(clubId);
    if (!gate.ok) {
      setError(gate.error + ' Ask the club owner to upgrade to Pro.');
      setSubmitting(false);
      return;
    }

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
