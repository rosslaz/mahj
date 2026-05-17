'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useLeague } from '@/lib/use-league';
import { formatAddressLines } from '@/lib/address';

type Member = {
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
  name: string;
  email: string;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sit_outs: number;
};

export default function LeaguePlayersPage() {
  const params = useParams();
  const slug = params.slug as string;
  const lg = useLeague(slug);
  const supabase = getBrowserSupabase();

  const [members, setMembers] = useState<Member[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'name' | 'sit_outs'>('name');

  useEffect(() => {
    if (!lg.league) return;
    (async () => {
      setLoading(true);
      const [mRes, soRes] = await Promise.all([
        supabase
          .from('league_members')
          .select('user_id, role, joined_at, user:user_id(name, email, phone, street, city, state, zip, deleted_at)')
          .eq('league_id', lg.league!.id),
        supabase
          .from('game_player_winds')
          .select('player_id')
          .eq('league_id', lg.league!.id)
          .eq('is_sitting_out', true),
      ]);

      // Tally sit-outs per player
      const sitOuts = new Map<string, number>();
      ((soRes.data as any[]) || []).forEach((r) => {
        sitOuts.set(r.player_id, (sitOuts.get(r.player_id) ?? 0) + 1);
      });

      const list: Member[] = ((mRes.data as any[]) || [])
        .filter((r) => r.user && !r.user.deleted_at)
        .map((r) => ({
          user_id: r.user_id,
          role: r.role,
          joined_at: r.joined_at,
          name: r.user.name,
          email: r.user.email,
          phone: r.user.phone,
          street: r.user.street,
          city: r.user.city,
          state: r.user.state,
          zip: r.user.zip,
          sit_outs: sitOuts.get(r.user_id) ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setMembers(list);
      setLoading(false);
    })();
  }, [lg.league, supabase]);

  if (!lg.league) return null;

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">The Roster</p>
          <h1 className="font-display text-5xl md:text-6xl">Players</h1>
          <p className="mt-2 text-ink/60">{members.length} {members.length === 1 ? 'member' : 'members'}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 text-xs tracking-[0.15em] uppercase">
            <span className="text-ink/40">Sort:</span>
            <button
              onClick={() => setSortBy('name')}
              className={sortBy === 'name' ? 'text-cinnabar' : 'text-ink/50 hover:text-ink'}
            >
              Name
            </button>
            <span className="text-ink/20">·</span>
            <button
              onClick={() => setSortBy('sit_outs')}
              className={sortBy === 'sit_outs' ? 'text-cinnabar' : 'text-ink/50 hover:text-ink'}
            >
              Sit-outs
            </button>
          </div>
          {lg.isAdmin && (
            <p className="text-xs text-ink/40 italic max-w-xs text-right">
              Manage roster on the <span className="underline">Admin</span> tab.
            </p>
          )}
        </div>
      </header>

      {loading ? (
        <p className="text-ink/40 italic">Loading…</p>
      ) : members.length === 0 ? (
        <div className="tile-border p-8 text-center text-ink/50 italic font-display">
          No members yet.
        </div>
      ) : (
        <ul className="divide-y divide-ink/10 border-y border-ink/10">
          {[...members].sort((a, b) =>
            sortBy === 'sit_outs'
              ? a.sit_outs - b.sit_outs || a.name.localeCompare(b.name)
              : a.name.localeCompare(b.name)
          ).map((m, i) => {
            const open = expandedId === m.user_id;
            const addressLines = formatAddressLines(m);
            return (
              <li key={m.user_id} className="group">
                <div
                  className="flex items-center justify-between py-4 cursor-pointer gap-4"
                  onClick={() => setExpandedId(open ? null : m.user_id)}
                >
                  <div className="flex items-baseline gap-4 min-w-0 flex-1">
                    <span className="rank-glyph text-xl text-ink/30 w-6">{String(i + 1).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-medium truncate">{m.name}</span>
                        {m.role !== 'member' && (
                          <span className={`text-[10px] tracking-[0.2em] uppercase ${m.role === 'owner' ? 'text-cinnabar' : 'text-jade'}`}>
                            {m.role}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink/40 truncate">{m.email}{m.phone && <> · {m.phone}</>}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-right">
                      <span className="block font-display text-lg leading-none">{m.sit_outs}</span>
                      <span className="block text-[9px] tracking-[0.15em] uppercase text-ink/40 mt-0.5">sit-outs</span>
                    </span>
                    <span className={`text-ink/30 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                  </div>
                </div>
                {open && (
                  <div className="pb-4 pl-10 text-sm text-ink/60 space-y-1 fade-up">
                    <div>
                      <span className="text-ink/40 text-xs tracking-[0.15em] uppercase mr-2">Email</span>
                      <a href={`mailto:${m.email}`} className="hover:text-cinnabar">{m.email}</a>
                    </div>
                    {m.phone && (
                      <div>
                        <span className="text-ink/40 text-xs tracking-[0.15em] uppercase mr-2">Phone</span>
                        <a href={`tel:${m.phone}`} className="hover:text-cinnabar">{m.phone}</a>
                      </div>
                    )}
                    {addressLines.length > 0 && (
                      <div>
                        <span className="text-ink/40 text-xs tracking-[0.15em] uppercase mr-2 align-top">Address</span>
                        <span className="inline-block">
                          {addressLines.map((line, idx) => (
                            <span key={idx} className="block">{line}</span>
                          ))}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
