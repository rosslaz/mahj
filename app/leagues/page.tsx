'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';

type LeagueCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_public: boolean;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
};

export default function LeaguesPage() {
  const auth = useAuth();
  const supabase = getBrowserSupabase();
  const [leagues, setLeagues] = useState<LeagueCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.userId) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from('league_members')
        .select('role, joined_at, league:league_id(id, slug, name, description, is_public, deleted_at)')
        .eq('user_id', auth.userId)
        .order('joined_at', { ascending: false });
      const list: LeagueCard[] = ((data as any[]) || [])
        .filter((r) => r.league && !r.league.deleted_at)
        .map((r) => ({
          id: r.league.id,
          slug: r.league.slug,
          name: r.league.name,
          description: r.league.description,
          is_public: r.league.is_public,
          role: r.role,
          joined_at: r.joined_at,
        }));
      setLeagues(list);
      setLoading(false);
    })();
  }, [auth.loading, auth.userId, supabase]);

  if (auth.loading) return <p className="text-ink/40 italic">Loading…</p>;
  if (!auth.email) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Sign in</h1>
        <p className="text-ink/60 mb-6">You need to sign in to see your leagues.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">Your Clubs</p>
          <h1 className="font-display text-5xl md:text-6xl">My Leagues</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/leagues/join" className="btn btn-ghost">Join with Code</Link>
          <Link href="/leagues/new" className="btn">+ Create League</Link>
        </div>
      </header>

      {loading ? (
        <p className="text-ink/40 italic">Loading…</p>
      ) : leagues.length === 0 ? (
        <div className="tile-border p-12 text-center">
          <p className="font-display italic text-xl text-ink/50 mb-2">You haven't joined any leagues yet.</p>
          <p className="text-sm text-ink/50 mb-6">Start one for your club or join one with a code.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link href="/leagues/new" className="btn">Create a League</Link>
            <Link href="/leagues/join" className="btn btn-ghost">Join with Code</Link>
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {leagues.map((l, i) => (
            <Link
              key={l.id}
              href={`/l/${l.slug}`}
              className="tile-border p-6 hover:border-cinnabar/40 transition-colors fade-up"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="flex items-baseline justify-between mb-2 gap-2">
                <span className="text-[10px] tracking-[0.25em] uppercase text-ink/40">{l.role}</span>
                {l.is_public && (
                  <span className="text-[10px] tracking-[0.25em] uppercase text-jade">Public</span>
                )}
              </div>
              <div className="font-display text-2xl mb-1">{l.name}</div>
              {l.description && <div className="text-sm text-ink/60 line-clamp-2">{l.description}</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
