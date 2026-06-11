'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import { ACTIVITY_TYPE_LABEL, type ActivityType } from '@/lib/use-activity';
import ClubInvitesPanel from '@/components/ClubInvitesPanel';
import { checkCanPromoteAdmin } from '@/app/actions/billing-gates';
import { ToastProvider, useToast } from '@/components/Toast';

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
  return (
    <ToastProvider>
      <ClubAdminPageInner />
    </ToastProvider>
  );
}

function ClubAdminPageInner() {
  const params = useParams();
  const slug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(slug);
  const supabase = getBrowserSupabase();
  // Styled dialogs + toasts (U-6) — replaces native confirm()/alert(), which
  // render as jarring OS chrome inside the standalone PWA. Note: `confirm`
  // deliberately shadows window.confirm so nothing here can reach for it.
  const { toast, confirm } = useToast();

  const [members, setMembers] = useState<Member[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  // Subscription state — used to surface the admin-slot cap on Free tier.
  // We only need to know "is this club Pro" for UI gating; the server-side
  // gate is still authoritative.
  const [isPro, setIsPro] = useState<boolean | null>(null);

  async function load() {
    if (!cb.club) return;
    setLoading(true);
    const [mRes, aRes, sRes] = await Promise.all([
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
      supabase
        .from('club_subscriptions')
        .select('status, current_period_end')
        .eq('club_id', cb.club.id)
        .maybeSingle(),
    ]);

    // Determine Pro: mirrors club_is_pro() in the DB.
    const subData = sRes.data as any;
    const proStatuses = ['active', 'trialing', 'grandfathered', 'past_due'];
    const pro = subData && (
      proStatuses.includes(subData.status) ||
      (subData.status === 'canceled' && subData.current_period_end &&
       new Date(subData.current_period_end) > new Date())
    );
    setIsPro(!!pro);

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
    // Free-tier gate: only check when promoting (admin direction). Demoting
    // to member always allowed regardless of plan.
    if (newRole === 'admin') {
      const gate = await checkCanPromoteAdmin(cb.club.id);
      if (!gate.ok) {
        toast(gate.error ?? 'Cannot promote an admin right now.', 'error');
        return;
      }
    }
    const { error } = await supabase.from('club_members').update({ role: newRole }).eq('club_id', cb.club.id).eq('user_id', userId);
    if (error) toast(error.message, 'error'); else load();
  }

  async function removeMember(userId: string, name: string) {
    if (!cb.club) return;
    const ok = await confirm({
      title: 'Remove ' + name + '?',
      message: 'They will be removed from ' + cb.club.name + '. Their historical scores will remain.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    const { error } = await supabase.from('club_members').delete().eq('club_id', cb.club.id).eq('user_id', userId);
    if (error) toast(error.message, 'error'); else load();
  }

  async function regenerateCode() {
    if (!cb.club) return;
    const ok = await confirm({
      title: 'Generate a new join code?',
      message: 'The old code stops working immediately — anyone you already sent it to will need the new one.',
      confirmLabel: 'Generate new code',
      tone: 'danger',
    });
    if (!ok) return;
    const { data, error } = await supabase.rpc('generate_join_code');
    if (error) { toast(error.message, 'error'); return; }
    const newCode = data as string;
    const { error: updErr } = await supabase.from('clubs').update({ join_code: newCode }).eq('id', cb.club.id);
    if (updErr) toast(updErr.message, 'error');
    else { setJoinCode(newCode); toast('New join code generated', 'success'); }
  }

  // U-8: copy / native-share the join code — the product's main growth loop.
  // Selecting letterspaced display text on a phone is fiddly; give it real
  // affordances. navigator.share opens the OS share sheet in the PWA.
  async function copyCode() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      toast('Join code copied', 'success');
    } catch {
      toast('Could not copy — long-press the code to copy it manually.', 'error');
    }
  }

  async function shareCode() {
    if (!joinCode || !cb.club) return;
    const url = window.location.origin + '/clubs/join?code=' + joinCode;
    const text = 'Join ' + cb.club.name + ' on Pungctual! Tap ' + url + ' or use code ' + joinCode + ' at pungctual.com/clubs/join';
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join ' + cb.club.name, text, url });
      } catch {
        // User dismissed the share sheet — not an error.
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        toast('Invite copied — paste it anywhere', 'success');
      } catch {
        toast('Could not copy the invite.', 'error');
      }
    }
  }

  const filtered = members.filter((m) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });
  const admins = members.filter((m) => m.role === 'owner' || m.role === 'admin');
  // Just the admins, not counting the owner. Used for free-tier slot display.
  const adminCount = members.filter((m) => m.role === 'admin').length;
  const FREE_ADMIN_CAP = 1;
  // Show the cap to free-tier clubs only. Once isPro is known to be true,
  // the UI hides all the slot messaging.
  const showAdminCap = isPro === false;
  const atAdminCap = showAdminCap && adminCount >= FREE_ADMIN_CAP;
  // Member cap (Free = 5). Used to warn the owner that the join code won't
  // work if shared further until they upgrade or someone leaves.
  const FREE_MEMBER_CAP = 5;
  const memberCount = members.length;
  const atMemberCap = isPro === false && memberCount >= FREE_MEMBER_CAP;

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
          <p className="text-ink/60 italic">Loading…</p>
        ) : activities.length === 0 ? (
          <div className="tile-border p-6 text-center text-ink/65 italic font-display text-sm">
            No activities yet.
          </div>
        ) : (
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {activities.map((a) => (
              <li key={a.id}>
                <Link href={`/c/${slug}/a/${a.slug}`} className="flex items-center justify-between py-4 hover:text-cinnabar">
                  <span className="flex items-baseline gap-3 min-w-0">
                    <span className="text-xs tracking-[0.2em] uppercase text-jade w-20 flex-shrink-0">{ACTIVITY_TYPE_LABEL[a.type]}</span>
                    <span className="font-medium truncate">{a.name}</span>
                    {a.is_public && (
                      <span className="text-xs tracking-[0.2em] uppercase text-ink/60">Public</span>
                    )}
                  </span>
                  <span className="text-ink/50">›</span>
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
            <div className="text-xs tracking-[0.2em] uppercase text-ink/60 mb-1">Join Code</div>
            <button
              type="button"
              onClick={copyCode}
              title="Tap to copy"
              className="font-display text-3xl tracking-[0.3em] hover:text-jade transition-colors text-left"
            >
              {joinCode || '—'}
            </button>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={shareCode} className="btn text-xs">Share</button>
            <button onClick={copyCode} className="btn btn-ghost text-xs">Copy</button>
            <button onClick={regenerateCode} className="btn btn-ghost text-xs">Regenerate</button>
          </div>
        </div>
        <p className="text-xs text-ink/65 italic">Share this with new players — the Share button sends a one-tap link, or they can enter the code at <code>/clubs/join</code>.</p>
        {isPro === false && (
          <div className={`mt-4 pt-4 border-t border-ink/10 text-xs flex items-baseline justify-between flex-wrap gap-2 ${
            atMemberCap ? 'text-cinnabar' : 'text-ink/65'
          }`}>
            <span>
              {memberCount} of {FREE_MEMBER_CAP} member slots used
              <span className="text-ink/55 italic ml-1">(Free tier)</span>
            </span>
            {atMemberCap ? (
              <Link href={`/c/${slug}/billing`} className="text-cinnabar hover:underline">
                Cap reached — upgrade to add more
              </Link>
            ) : (
              <Link href={`/c/${slug}/billing`} className="text-ink/65 hover:text-cinnabar hover:underline">
                Upgrade for unlimited
              </Link>
            )}
          </div>
        )}
      </section>

      {/* Email invitations */}
      <ClubInvitesPanel clubId={cb.club.id} clubName={cb.club.name} isPro={isPro} slug={slug} />

      {/* Members management */}
      <section>
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/60">Owners & Admins ({admins.length})</div>
          {showAdminCap && (
            <div className="text-xs tracking-[0.15em] uppercase text-ink/65 flex items-baseline gap-2">
              <span>
                {adminCount} of {FREE_ADMIN_CAP} admin slot{FREE_ADMIN_CAP === 1 ? '' : 's'} used
                <span className="text-ink/55 normal-case tracking-normal italic ml-1">(Free tier)</span>
              </span>
              {atAdminCap && (
                <Link href={`/c/${slug}/billing`} className="text-cinnabar hover:underline tracking-[0.15em]">
                  Upgrade for more
                </Link>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {admins.map((a) => (
            <span key={a.user_id} className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm border ${a.role === 'owner' ? 'bg-cinnabar/10 border-cinnabar/30' : 'bg-jade/10 border-jade/30'}`}>
              <span className="font-medium">{a.name}</span>
              <span className="text-xs tracking-[0.2em] uppercase text-ink/60">{a.role}</span>
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
          <p className="text-ink/60 italic">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-ink/60 italic">No members match.</p>
        ) : (
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {filtered.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between py-4 gap-4 flex-wrap">
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="font-medium truncate">{m.name}</span>
                  {m.role !== 'member' && (
                    <span className={`text-xs tracking-[0.2em] uppercase ${m.role === 'owner' ? 'text-cinnabar' : 'text-jade'}`}>
                      {m.role}
                    </span>
                  )}
                  <span className="text-xs text-ink/60 truncate">{m.email}</span>
                </div>
                {m.role === 'owner' ? (
                  <span className="text-xs text-ink/60 italic">cannot change</span>
                ) : m.role === 'admin' ? (
                  <div className="flex gap-3 items-center">
                    <button onClick={() => setRole(m.user_id, 'member')} className="text-xs tracking-[0.15em] uppercase text-ink/60 hover:text-cinnabar py-3 -my-3 px-1.5 -mx-1.5">
                      Revoke admin
                    </button>
                    <button onClick={() => removeMember(m.user_id, m.name)} className="text-xs tracking-[0.15em] uppercase text-cinnabar/80 hover:text-cinnabar py-3 -my-3 px-1.5 -mx-1.5">
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3 items-center">
                    {atAdminCap ? (
                      <Link
                        href={`/c/${slug}/billing`}
                        title="Free clubs allow 1 admin. Upgrade to Pro for unlimited."
                        className="text-xs tracking-[0.15em] uppercase text-ink/50 hover:text-cinnabar hover:underline"
                      >
                        Pro for more admins
                      </Link>
                    ) : (
                      <button onClick={() => setRole(m.user_id, 'admin')} className="text-xs tracking-[0.15em] uppercase text-jade hover:underline py-3 -my-3 px-1.5 -mx-1.5">
                        Make admin
                      </button>
                    )}
                    <button onClick={() => removeMember(m.user_id, m.name)} className="text-xs tracking-[0.15em] uppercase text-cinnabar/80 hover:text-cinnabar py-3 -my-3 px-1.5 -mx-1.5">
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
