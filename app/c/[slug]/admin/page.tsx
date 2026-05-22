'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import { ACTIVITY_TYPE_LABEL, type ActivityType } from '@/lib/use-activity';
import ClubInvitesPanel from '@/components/ClubInvitesPanel';

type Member = {
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  name: string;
  email: string;
};

type Activity = {
  id: string;
  slug: string;
  name: string;
  type: ActivityType;
  is_public: boolean;
};

export default function ClubAdminPage() {
  const params = useParams();
  const slug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(slug);
  const supabase = getBrowserSupabase();

  const [members, setMembers] = useState<Member[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState<string | null>(null);

  async function load() {
    if (!cb.club) return;
    setLoading(true);
    const [mRes, aRes] = await Promise.all([
      supabase
        .from('club_members')
        .select('user_id, role, user:user_id(name, email, deleted_at)')
        .eq('club_id', cb.club.id),
      supabase
        .from('activities')
        .select('id, slug, name, type, is_public')
        .eq('club_id', cb.club.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ]);

    const list: Member[] = ((mRes.data as any[]) || [])
      .filter((r) => r.user && !r.user.deleted_at)
      .map((r) => ({ user_id: r.user_id, role: r.role, name: r.user.name, email: r.user.email }))
      .sort((a, b) => {
        const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
        if (order[a.role] !== order[b.role]) return order[a.role] - order[b.role];
        return a.name.localeCompare(b.name);
      });
    setMembers(list);
    setActivities((aRes.data as Activity[]) || []);
    setJoinCode(cb.club.join_code);
    setLoading(false);
  }

  useEffect(() => { if (cb.club) load(); /* eslint-disable-next-line */ }, [cb.club]);

  if (cb.loading || !cb.club) return null;
  if (!auth.email) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Admin Only</h1>
        <p className="text-ink/60 mb-6">Sign in to access admin tools.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }
  if (!cb.isAdmin) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Not Authorized</h1>
        <p className="text-ink/60 mb-6">You're not an admin of this club.</p>
        <Link href={`/c/${slug}`} className="btn btn-ghost">← Club home</Link>
      </div>
    );
  }

  async function setRole(userId: string, newRole: 'admin' | 'member') {
    if (!cb.club) return;
    const { error } = await supabase.from('club_members').update({ role: newRole }).eq('club_id', cb.club.id).eq('user_id', userId);
    if (error) alert(error.message); else load();
  }

  async function removeMember(userId: string) {
    if (!cb.club) return;
    if (!confirm('Remove this member? Their historical scores will remain.')) return;
    const { error } = await supabase.from('club_members').delete().eq('club_id', cb.club.id).eq('user_id', userId);
    if (error) alert(error.message); else load();
  }

  async function regenerateCode() {
    if (!cb.club) return;
    if (!confirm('Generate a new join code? The old code will stop working.')) return;
    const { data, error } = await supabase.rpc('generate_join_code');
    if (error) { alert(error.message); return; }
    const newCode = data as string;
    const { error: updErr } = await supabase.from('clubs').update({ join_code: newCode }).eq('id', cb.club.id);
    if (updErr) alert(updErr.message);
    else setJoinCode(newCode);
  }

  const filtered = members.filter((m) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });
  const admins = members.filter((m) => m.role === 'owner' || m.role === 'admin');

  return (
    <div className="space-y-12">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">Club Administration</p>
        <h1 className="font-display text-5xl md:text-6xl">Admin</h1>
      </header>

      {/* Activities list (creation lives at /a/new) */}
      <section>
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-3">
          <h2 className="font-display text-3xl">Activities</h2>
          <Link href={`/c/${slug}/a/new`} className="btn">+ Add Activity</Link>
        </div>

        {loading ? (
          <p className="text-ink/40 italic">Loading…</p>
        ) : activities.length === 0 ? (
          <div className="tile-border p-6 text-center text-ink/50 italic font-display text-sm">
            No activities yet.
          </div>
        ) : (
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {activities.map((a) => (
              <li key={a.id}>
                <Link href={`/c/${slug}/a/${a.slug}`} className="flex items-center justify-between py-4 hover:text-cinnabar">
                  <span className="flex items-baseline gap-3 min-w-0">
                    <span className="text-[10px] tracking-[0.2em] uppercase text-jade w-20 flex-shrink-0">{ACTIVITY_TYPE_LABEL[a.type]}</span>
                    <span className="font-medium truncate">{a.name}</span>
                    {a.is_public && (
                      <span className="text-[10px] tracking-[0.2em] uppercase text-ink/40">Public</span>
                    )}
                  </span>
                  <span className="text-ink/30">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Join code */}
      <section className="tile-border p-6">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
          <div>
            <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-1">Join Code</div>
            <div className="font-display text-3xl tracking-[0.3em]">{joinCode || '—'}</div>
          </div>
          <button onClick={regenerateCode} className="btn btn-ghost text-xs">Regenerate</button>
        </div>
        <p className="text-xs text-ink/50 italic">Share this with new players. They enter it at <code>/clubs/join</code>.</p>
      </section>

      {/* Email invitations */}
      <ClubInvitesPanel clubId={cb.club.id} clubName={cb.club.name} />

      {/* Members management */}
      <section>
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Owners & Admins ({admins.length})</div>
        <div className="flex flex-wrap gap-2">
          {admins.map((a) => (
            <span key={a.user_id} className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm border ${a.role === 'owner' ? 'bg-cinnabar/10 border-cinnabar/30' : 'bg-jade/10 border-jade/30'}`}>
              <span className="font-medium">{a.name}</span>
              <span className="text-[10px] tracking-[0.2em] uppercase text-ink/40">{a.role}</span>
            </span>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-3">
          <h2 className="font-display text-3xl">All Members</h2>
          <input type="search" className="input max-w-xs" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>

        {loading ? (
          <p className="text-ink/40 italic">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-ink/40 italic">No members match.</p>
        ) : (
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {filtered.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between py-4 gap-4 flex-wrap">
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="font-medium truncate">{m.name}</span>
                  {m.role !== 'member' && (
                    <span className={`text-[10px] tracking-[0.2em] uppercase ${m.role === 'owner' ? 'text-cinnabar' : 'text-jade'}`}>
                      {m.role}
                    </span>
                  )}
                  <span className="text-xs text-ink/40 truncate">{m.email}</span>
                </div>
                {m.role === 'owner' ? (
                  <span className="text-xs text-ink/40 italic">cannot change</span>
                ) : m.role === 'admin' ? (
                  <div className="flex gap-3 items-center">
                    <button onClick={() => setRole(m.user_id, 'member')} className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar">
                      Revoke admin
                    </button>
                    <button onClick={() => removeMember(m.user_id)} className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar">
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3 items-center">
                    <button onClick={() => setRole(m.user_id, 'admin')} className="text-xs tracking-[0.15em] uppercase text-jade hover:underline">
                      Make admin
                    </button>
                    <button onClick={() => removeMember(m.user_id)} className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar">
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
