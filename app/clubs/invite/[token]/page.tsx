'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/use-auth';

/**
 * Invite acceptance route. The user lands here from the email link.
 *
 * Two paths:
 *   - Signed in: immediately call acceptClubInvite, redirect to the club page
 *   - Not signed in: redirect to /sign-in?next=/clubs/invite/{token}
 *     After sign-in, the auth callback respects `next` and lands them back
 *     here; this effect runs again with auth.userId now set, and the accept
 *     happens.
 *
 * Errors (expired, revoked, used) display inline with a "go to sign-in" or
 * "go home" exit.
 */

export default function InviteAcceptancePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const auth = useAuth();

  const [status, setStatus] = useState<'pending' | 'accepting' | 'success' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [clubName, setClubName] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);

  useEffect(() => {
    if (auth.loading) return;

    // Not signed in → redirect to sign-in carrying the invite URL as `next`
    if (!auth.userId) {
      const next = encodeURIComponent(`/clubs/invite/${token}`);
      router.replace(`/sign-in?next=${next}`);
      return;
    }

    if (status !== 'pending') return;  // already running

    setStatus('accepting');
    (async () => {
      try {
        const { acceptClubInvite } = await import('@/app/actions/club-invites');
        const res = await acceptClubInvite(token);
        if (!res.ok) {
          setError(res.error);
          setStatus('error');
          return;
        }
        const data = res.data!;
        setClubName(data.clubName);
        setAlreadyMember(data.alreadyMember);
        setStatus('success');
        // Brief pause so the user sees the success state, then forward
        setTimeout(() => {
          router.replace(`/c/${data.clubSlug}`);
        }, 1400);
      } catch (e: any) {
        setError(e?.message || 'Could not accept invite.');
        setStatus('error');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loading, auth.userId, token]);

  return (
    <div className="max-w-md mx-auto pt-12 text-center">
      {status === 'pending' || status === 'accepting' ? (
        <>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">Accepting Invite</p>
          <h1 className="font-display text-3xl mb-4">One moment…</h1>
          <p className="text-ink/50 italic">Adding you to the club.</p>
        </>
      ) : status === 'success' ? (
        <>
          <p className="text-xs tracking-[0.4em] uppercase text-jade mb-4">Welcome</p>
          <h1 className="font-display text-4xl mb-4">
            {alreadyMember ? `You're in ${clubName}` : `Welcome to ${clubName}`}
          </h1>
          <p className="text-ink/60 italic">Taking you to the club…</p>
        </>
      ) : (
        <>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">Invite</p>
          <h1 className="font-display text-3xl mb-4">Couldn&apos;t accept</h1>
          <p className="text-ink/70 mb-8">{error}</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/" className="btn">Go home</Link>
            <Link href="/clubs/join" className="btn btn-ghost">Enter a join code</Link>
          </div>
        </>
      )}
    </div>
  );
}
