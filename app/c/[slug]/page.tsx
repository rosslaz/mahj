'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import { ACTIVITY_TYPE_LABEL, type ActivityType, activityHasScoring } from '@/lib/use-activity';
import { NextEventCard, type NextEventNight, type PersonalStatus } from '@/components/NextEventCard';
import { useRefreshOnFocus } from '@/lib/use-refresh-on-focus';
import { PullToRefresh } from '@/components/PullToRefresh';

type ActivityCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: ActivityType;
  is_public: boolean;
};

type UpcomingEvent = NextEventNight & {
  activity_id: string;
  activity_slug: string;
  activity_name: string;
  activity_type: ActivityType;
  personal: PersonalStatus;
};

export default function ClubOverview() {
  const params = useParams();
  const slug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(slug);
  const supabase = getBrowserSupabase();

  const [activities, setActivities] = useState<ActivityCard[]>([]);
  const [nextEvent, setNextEvent] = useState<UpcomingEvent | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!cb.club) return;
    // Activities in this club
    const { data: actData } = await supabase
      .from('activities')
      .select('id, slug, name, description, type, is_public, deleted_at')
      .eq('club_id', cb.club!.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    const acts = ((actData as any[]) || []).map((a) => ({
      id: a.id, slug: a.slug, name: a.name, description: a.description,
      type: a.type as ActivityType, is_public: a.is_public,
    }));
    setActivities(acts);

    // Next event across all activities in this club
    const today = new Date().toISOString().slice(0, 10);
    const { data: gnData } = await supabase
      .from('events')
      .select('id, name, date, start_time, num_tables, games_planned, status, activity_id, host:host_player_id(id, name), tables(assigned)')
      .eq('club_id', cb.club!.id)
      .gte('date', today)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(1);

    let next: UpcomingEvent | null = null;
    if (gnData && gnData.length > 0) {
      const g: any = gnData[0];
      const act = acts.find((a) => a.id === g.activity_id);
      if (act) {
        // Count approved signups for this event + look up the user's own status
        const { data: signupData } = await supabase
          .from('night_signups')
          .select('player_id, status')
          .eq('event_id', g.id);
        const approvedCount = ((signupData as any[]) || []).filter((s) => s.status === 'approved').length;
        let personal: PersonalStatus = { kind: 'none' };
        if (auth.userId) {
          if (g.host?.id === auth.userId) {
            personal = { kind: 'hosting' };
          } else {
            const mine = ((signupData as any[]) || []).find((s) => s.player_id === auth.userId);
            personal = mine && mine.status === 'approved' ? { kind: 'signed_up' } : { kind: 'not_signed_up' };
          }
        }
        next = {
          id: g.id,
          name: g.name,
          date: g.date,
          start_time: g.start_time,
          num_tables: g.num_tables,
          games_planned: g.games_planned,
          status: g.status,
          host: g.host,
          signup_count: approvedCount,
          assigned: (g.tables || []).some((t: any) => t.assigned),
          activity_id: g.activity_id,
          activity_slug: act.slug,
          activity_name: act.name,
          activity_type: act.type,
          personal,
        };
      }
    }
    setNextEvent(next);

    // Member count
    const { count } = await supabase
      .from('club_members')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', cb.club!.id);
    setMemberCount(count || 0);

    setLoading(false);
  }, [cb.club, auth.userId, supabase]);

  useEffect(() => { load(); }, [load]);
  useRefreshOnFocus(load, !!cb.club);

  if (!cb.club) return null;

  return (
    <PullToRefresh onRefresh={load}>
    <div className="space-y-12">
      {cb.club.description && (
        <p className="text-ink/70 italic text-base max-w-2xl -mt-2 leading-relaxed">
          {cb.club.description}
        </p>
      )}

      {/* NEXT EVENT across club */}
      <section>
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Next Event</div>
        {loading ? (
          <p className="text-ink/40 italic">Loading…</p>
        ) : nextEvent ? (
          <NextEventCard
            slug={`${slug}/a/${nextEvent.activity_slug}`}
            night={nextEvent}
            personalStatus={nextEvent.personal}
            leagueName={nextEvent.activity_name}
            eventBasePath={`/c/${slug}/a/${nextEvent.activity_slug}/events`}
          />
        ) : (
          <div className="tile-border p-10 text-center">
            <p className="font-display italic text-xl text-ink/50 mb-1">Nothing scheduled.</p>
            {cb.isAdmin && activities.length === 0 && (
              <p className="text-sm text-ink/50 mt-2">
                Start by adding an activity below.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ACTIVITIES */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40">Activities</div>
          {cb.isAdmin && activities.length > 0 && (
            <Link href={`/c/${slug}/a/new`} className="text-xs tracking-[0.2em] uppercase text-ink/50 hover:text-cinnabar">
              + Add →
            </Link>
          )}
        </div>
        {loading ? (
          <p className="text-ink/40 italic">Loading…</p>
        ) : activities.length === 0 ? (
          <div className="tile-border p-10 text-center">
            <p className="font-display italic text-xl text-ink/50 mb-1">No activities yet.</p>
            <p className="text-sm text-ink/50 mb-4">
              {cb.isAdmin
                ? <>Add your first activity — a league, tournament, class, or open play session.</>
                : <>The club owner hasn't set up any activities yet.</>}
            </p>
            {cb.isAdmin && (
              <Link href={`/c/${slug}/a/new`} className="btn">+ Add Activity</Link>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activities.map((a, i) => (
              <Link
                key={a.id}
                href={`/c/${slug}/a/${a.slug}`}
                className="tile-border p-6 hover:border-cinnabar/40 transition-colors fade-up"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <div className="flex items-baseline justify-between mb-2 gap-2">
                  <span className="text-[10px] tracking-[0.25em] uppercase text-jade">{ACTIVITY_TYPE_LABEL[a.type]}</span>
                  {a.is_public && (
                    <span className="text-[10px] tracking-[0.25em] uppercase text-ink/40">Public</span>
                  )}
                </div>
                <div className="font-display text-2xl mb-1">{a.name}</div>
                {a.description && <div className="text-sm text-ink/60 line-clamp-2">{a.description}</div>}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Quick stat */}
      <section className="grid grid-cols-2 gap-px bg-ink/15 border border-ink/15">
        <div className="bg-bone p-6">
          <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40 mb-1">Members</div>
          <div className="font-display text-3xl">{memberCount}</div>
        </div>
        <div className="bg-bone p-6">
          <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40 mb-1">Activities</div>
          <div className="font-display text-3xl">{activities.length}</div>
        </div>
      </section>
    </div>
    </PullToRefresh>
  );
}
