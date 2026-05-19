'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import { ACTIVITY_TYPE_LABEL, ACTIVITY_TYPE_DESCRIPTION, type ActivityType } from '@/lib/use-activity';
import { slugify } from '@/lib/slug';

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

const ACTIVITY_TYPES: ActivityType[] = ['league', 'tournament', 'class', 'open_play'];

// Reserved activity slugs to avoid collisions with club-level routes
const RESERVED_SLUGS = new Set(['members', 'admin', 'settings', 'overview']);

function randomSuffix(len = 4): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export default function ClubAdminPage() {
  return (
    <Suspense fallback={<p className="text-ink/40 italic">Loading…</p>}>
      <ClubAdminPageInner />
    </Suspense>
  );
}

function ClubAdminPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(slug);
  const supabase = getBrowserSupabase();
  const router = useRouter();

  const [members, setMembers] = useState<Member[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState<string | null>(null);

  // Activity-creation form
  const [showNewActivity, setShowNewActivity] = useState(searchParams.get('new') === 'activity');
  const [newType, setNewType] = useState<ActivityType>('league');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(false);
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

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

  async function pickActivitySlug(base: string): Promise<string> {
    if (!cb.club) return base;
    let candidate = base || 'activity';
    if (RESERVED_SLUGS.has(candidate)) candidate = `${candidate}-${randomSuffix(4)}`;
    if (candidate.length > 50) candidate = candidate.slice(0, 50);
    const { data } = await supabase
      .from('activities')
      .select('id')
      .eq('club_id', cb.club.id)
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
    for (let attempts = 0; attempts < 8; attempts++) {
      const suffixed = `${candidate}-${randomSuffix(4)}`;
      const res = await supabase.from('activities').select('id').eq('club_id', cb.club.id).eq('slug', suffixed).maybeSingle();
      if (!res.data) return suffixed;
    }
    return `${candidate}-${randomSuffix(8)}`;
  }

  async function createActivity(e: React.FormEvent) {
    e.preventDefault();
    setActivityError(null);
    if (!newName.trim()) { setActivityError('Name is required.'); return; }
    if (!cb.club) return;

    setCreatingActivity(true);
    try {
      const aSlug = await pickActivitySlug(slugify(newName.trim()));
      const { data, error } = await supabase
        .from('activities')
        .insert({
          club_id: cb.club.id,
          slug: aSlug,
          name: newName.trim(),
          description: newDescription.trim() || null,
          type: newType,
          is_public: newIsPublic,
        })
        .select()
        .single();
      if (error || !data) throw new Error(error?.message || 'Could not create activity.');
      router.push(`/c/${slug}/a/${aSlug}`);
    } catch (e: any) {
      setActivityError(e.message);
      setCreatingActivity(false);
    }
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

      {/* Activities management */}
      <section>
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-3">
          <h2 className="font-display text-3xl">Activities</h2>
          {!showNewActivity && (
            <button onClick={() => setShowNewActivity(true)} className="btn">+ Add Activity</button>
          )}
          {showNewActivity && (
            <button onClick={() => { setShowNewActivity(false); setActivityError(null); }} className="btn btn-ghost">Cancel</button>
          )}
        </div>

        {showNewActivity && (
          <form onSubmit={createActivity} className="tile-border p-6 space-y-5 mb-5 fade-up">
            <div>
              <label className="label">Type <span className="text-cinnabar">*</span></label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {ACTIVITY_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewType(t)}
                    className={`p-3 border text-left transition-colors ${
                      newType === t
                        ? 'bg-jade/10 border-jade'
                        : 'bg-bone border-ink/15 hover:border-ink/40'
                    }`}
                  >
                    <div className="font-display text-lg">{ACTIVITY_TYPE_LABEL[t]}</div>
                    <div className="text-[10px] text-ink/50 italic leading-snug mt-0.5">{ACTIVITY_TYPE_DESCRIPTION[t]}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Name <span className="text-cinnabar">*</span></label>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={
                  newType === 'league' ? 'Tuesday Night League' :
                  newType === 'tournament' ? 'Spring Tournament 2026' :
                  newType === 'class' ? 'Beginner Class — Spring' :
                  'Wednesday Open Play'
                }
                required
              />
            </div>
            <div>
              <label className="label">Description <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span></label>
              <textarea
                className="input min-h-[70px] resize-y"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newIsPublic}
                  onChange={(e) => setNewIsPublic(e.target.checked)}
                  className="accent-jade w-4 h-4 mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">Public activity</span>
                  <span className="text-xs text-ink/50 italic">Discoverable outside the club. Only takes effect if the club is also public.</span>
                </span>
              </label>
            </div>
            {activityError && <p className="text-cinnabar text-sm">{activityError}</p>}
            <div className="flex gap-3 pt-2">
              <button className="btn btn-jade" disabled={creatingActivity}>
                {creatingActivity ? 'Creating…' : 'Create Activity'}
              </button>
              <button type="button" onClick={() => { setShowNewActivity(false); setActivityError(null); }} className="btn btn-ghost">
                Cancel
              </button>
            </div>
          </form>
        )}

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
