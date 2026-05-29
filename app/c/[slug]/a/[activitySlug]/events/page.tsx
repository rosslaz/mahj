'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import { useActivity } from '@/lib/use-activity';
import { formatTime12 } from '@/lib/game-utils';
import { AddressFields, AddressFieldsValue } from '@/components/AddressFields';
import { validateZip } from '@/lib/address';
import { sendEventInvitations } from '@/app/actions/event-invites';
import { checkCanCreateHiddenEvent } from '@/app/actions/billing-gates';
import { useRefreshOnFocus } from '@/lib/use-refresh-on-focus';
import { PullToRefresh } from '@/components/PullToRefresh';

type Member = {
  user_id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};
type Night = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  num_tables: number;
  games_planned: number;
  status: string;
  host?: { id: string; name: string } | null;
  signup_count?: number;
  assigned?: boolean;          // any of its tables assigned?
};
type NightStanding = {
  user_id: string;
  name: string;
  points: number;
  wins: number;
  games: number;
};

const EMPTY_ADDR: AddressFieldsValue = { street: '', city: '', state: '', zip: '' };

export default function ActivityEventsPage() {
  const params = useParams();
  const clubSlug = params.slug as string;
  const activitySlug = params.activitySlug as string;
  const router = useRouter();
  const auth = useAuth();
  const cb = useClub(clubSlug);
  const act = useActivity(cb.club?.id, activitySlug);
  const supabase = getBrowserSupabase();

  const eventBasePath = `/c/${clubSlug}/a/${activitySlug}/events`;

  const [nights, setNights] = useState<Night[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'none' | 'night' | 'series'>('none');
  // Whether this club has any Pro plan active. Drives the upfront "Hidden
  // requires Pro" treatment on the visibility picker so users on Free see
  // the gate before they fill the form. Server-side gate still authoritative.
  const [isPro, setIsPro] = useState<boolean | null>(null);

  // Single-night form state
  const [nightName, setNightName] = useState('');
  const [nightDate, setNightDate] = useState(new Date().toISOString().slice(0, 10));
  const [nightTime, setNightTime] = useState('19:00');
  const [numTables, setNumTables] = useState(1);
  const [gamesPlanned, setGamesPlanned] = useState(4);
  const [hostId, setHostId] = useState<string>('');
  const [addr, setAddr] = useState<AddressFieldsValue>(EMPTY_ADDR);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Hidden-event state. Only meaningful when admin/owner creating a single
  // night (not a series — series with hidden visibility is too complex for v1).
  const [visibility, setVisibility] = useState<'normal' | 'hidden'>('normal');
  const [invitedMemberIds, setInvitedMemberIds] = useState<Set<string>>(new Set());
  const [outsideEmailsText, setOutsideEmailsText] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');

  // Series form state
  const [sName, setSName] = useState('');
  const [sStartDate, setSStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [sEndDate, setSEndDate] = useState('');
  const [sIntervalWeeks, setSIntervalWeeks] = useState(2);  // every N weeks
  const [sTime, setSTime] = useState('19:00');
  const [sNumTables, setSNumTables] = useState(1);
  const [sGamesPlanned, setSGamesPlanned] = useState(4);
  const [sHostId, setSHostId] = useState<string>('');
  const [sAddr, setSAddr] = useState<AddressFieldsValue>(EMPTY_ADDR);

  // Past-night expansion: which are open, and cached standings per night id
  const [expandedPastId, setExpandedPastId] = useState<string | null>(null);
  const [pastStandings, setPastStandings] = useState<Record<string, NightStanding[]>>({});

  // Per-night signup IDs for the current user (for personal status chip on Next Event)
  const [mySignedUpNightIds, setMySignedUpNightIds] = useState<Set<string>>(new Set());

  async function loadPastStandings(nightId: string) {
    if (pastStandings[nightId]) return;
    // Pull all tables → games → game_scores for this night
    const { data: tablesData } = await supabase
      .from('tables')
      .select('id, games(id, game_scores(player_id, points, is_winner))')
      .eq('event_id', nightId);

    // Aggregate per player
    const tally: Record<string, { points: number; wins: number; games: number }> = {};
    ((tablesData as any[]) || []).forEach((t) => {
      (t.games || []).forEach((g: any) => {
        (g.game_scores || []).forEach((s: any) => {
          if (!tally[s.player_id]) tally[s.player_id] = { points: 0, wins: 0, games: 0 };
          tally[s.player_id].points += s.points;
          tally[s.player_id].games += 1;
          if (s.is_winner) tally[s.player_id].wins += 1;
        });
      });
    });

    const playerIds = Object.keys(tally);
    if (playerIds.length === 0) {
      setPastStandings((m) => ({ ...m, [nightId]: [] }));
      return;
    }

    // Resolve names
    const { data: usersData } = await supabase
      .from('users')
      .select('id, name')
      .in('id', playerIds);
    const nameById = new Map<string, string>(
      ((usersData as any[]) || []).map((u) => [u.id, u.name])
    );

    const rows: NightStanding[] = playerIds.map((pid) => ({
      user_id: pid,
      name: nameById.get(pid) || '—',
      points: tally[pid].points,
      wins: tally[pid].wins,
      games: tally[pid].games,
    })).sort((a, b) => b.wins - a.wins || b.points - a.points);

    setPastStandings((m) => ({ ...m, [nightId]: rows }));
  }

  async function load() {
    if (!cb.club || !act.activity) return;
    setLoading(true);
    const [nightsRes, membersRes, signupsRes, subRes] = await Promise.all([
      supabase.from('events')
        .select('id, name, date, start_time, num_tables, games_planned, status, host:host_player_id(id, name), tables(assigned)')
        .eq('activity_id', act.activity.id)
        .is('deleted_at', null)
        .order('date', { ascending: false }),
      supabase.from('club_members')
        .select('user_id, user:user_id(name, street, city, state, zip, deleted_at)')
        .eq('club_id', cb.club.id),
      // Pull approved signups for this activity's events so we can count them
      // in JS — easier than a per-event aggregate with status filter.
      supabase.from('night_signups')
        .select('event_id, player_id, status')
        .eq('club_id', cb.club.id)
        .eq('status', 'approved'),
      // Subscription state for Pro/Free gating UI.
      supabase.from('club_subscriptions')
        .select('status, current_period_end')
        .eq('club_id', cb.club.id)
        .maybeSingle(),
    ]);

    // Determine Pro: mirrors club_is_pro() in the DB.
    const subData = subRes.data as any;
    const proStatuses = ['active', 'trialing', 'grandfathered', 'past_due'];
    const pro = subData && (
      proStatuses.includes(subData.status) ||
      (subData.status === 'canceled' && subData.current_period_end &&
       new Date(subData.current_period_end) > new Date())
    );
    setIsPro(!!pro);

    // Build approved-signup count per event
    const approvedByEvent = new Map<string, number>();
    ((signupsRes.data as any[]) || []).forEach((r) => {
      approvedByEvent.set(r.event_id, (approvedByEvent.get(r.event_id) ?? 0) + 1);
    });

    const list = ((nightsRes.data as any[]) || []).map((n) => ({
      ...n,
      signup_count: approvedByEvent.get(n.id) ?? 0,
      assigned: (n.tables || []).some((t: any) => t.assigned),
    }));
    setNights(list);

    setMembers(((membersRes.data as any[]) || [])
      .filter((m) => m.user && !m.user.deleted_at)
      .map((m) => ({
        user_id: m.user_id,
        name: m.user.name,
        street: m.user.street, city: m.user.city, state: m.user.state, zip: m.user.zip,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    );

    // Which of these nights am I APPROVED for? (Pending doesn't count as "in.")
    if (auth.userId) {
      const myApproved = ((signupsRes.data as any[]) || [])
        .filter((r) => r.player_id === auth.userId)
        .map((r) => r.event_id);
      setMySignedUpNightIds(new Set(myApproved));
    } else {
      setMySignedUpNightIds(new Set());
    }

    setLoading(false);
  }

  useEffect(() => { if (cb.club && act.activity) load(); /* eslint-disable-next-line */ }, [cb.club, act.activity]);
  useRefreshOnFocus(load, !!(cb.club && act.activity));

  function memberAddr(m: Member | undefined): AddressFieldsValue {
    if (!m) return EMPTY_ADDR;
    return { street: m.street || '', city: m.city || '', state: m.state || '', zip: m.zip || '' };
  }
  function addrIsEmpty(a: AddressFieldsValue) { return !a.street && !a.city && !a.state && !a.zip; }
  function addrEquals(a: AddressFieldsValue, b: AddressFieldsValue) {
    return a.street === b.street && a.city === b.city && a.state === b.state && a.zip === b.zip;
  }

  function handleHostChange(newHostId: string) {
    const prev = members.find((m) => m.user_id === hostId);
    const prevAddr = memberAddr(prev);
    const nh = members.find((m) => m.user_id === newHostId);
    const nhAddr = memberAddr(nh);
    setHostId(newHostId);
    if (addrIsEmpty(addr) || addrEquals(addr, prevAddr)) {
      setAddr(nhAddr);
    }
  }

  function handleSeriesHostChange(newHostId: string) {
    const prev = members.find((m) => m.user_id === sHostId);
    const prevAddr = memberAddr(prev);
    const nh = members.find((m) => m.user_id === newHostId);
    const nhAddr = memberAddr(nh);
    setSHostId(newHostId);
    if (addrIsEmpty(sAddr) || addrEquals(sAddr, prevAddr)) {
      setSAddr(nhAddr);
    }
  }

  // Compute the dates a series will produce. The series starts on
  // sStartDate (whatever weekday that is) and repeats every
  // sIntervalWeeks weeks until — and including — sEndDate.
  function computeSeriesDates(): string[] {
    if (!sStartDate || !sEndDate) return [];
    const start = new Date(sStartDate + 'T00:00:00');
    const end = new Date(sEndDate + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
    if (end < start) return [];
    if (sIntervalWeeks < 1 || sIntervalWeeks > 12) return [];

    const dates: string[] = [];
    const cursor = new Date(start);
    const MAX_OCCURRENCES = 52;
    while (cursor <= end && dates.length < MAX_OCCURRENCES) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + sIntervalWeeks * 7);
    }
    return dates;
  }

  function formatWeekday(dateStr: string): string {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  }

  async function createNight(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!nightName.trim()) return setFormError('Name is required.');
    if (numTables < 1) return setFormError('At least one table is required.');
    const zipErr = validateZip(addr.zip);
    if (zipErr) return setFormError(zipErr);
    if (!cb.club || !act.activity) return;

    setCreating(true);
    try {
      // Free-tier gate: hidden events are a Pro feature. Public/private
      // visibility doesn't require Pro — only hidden does.
      if (visibility === 'hidden') {
        const gate = await checkCanCreateHiddenEvent(cb.club.id);
        if (!gate.ok) {
          setFormError(gate.error);
          setCreating(false);
          return;
        }
      }

      const { data: nightData, error: nightErr } = await supabase
        .from('events')
        .insert({
          club_id: cb.club.id,
          activity_id: act.activity.id,
          name: nightName.trim(),
          date: nightDate,
          start_time: nightTime || null,
          num_tables: numTables,
          games_planned: gamesPlanned,
          host_player_id: hostId || null,
          street: addr.street.trim() || null,
          city: addr.city.trim() || null,
          state: addr.state || null,
          zip: addr.zip.trim() || null,
          visibility,
        })
        .select()
        .single();
      if (nightErr || !nightData) throw new Error(nightErr?.message || 'Failed to create night');

      const tablesPayload = Array.from({ length: numTables }, (_, i) => ({
        club_id: cb.club!.id,
        event_id: (nightData as any).id,
        table_number: i + 1,
        assigned: false,
      }));
      const { error: tablesErr } = await supabase.from('tables').insert(tablesPayload);
      if (tablesErr) throw new Error(tablesErr.message);

      // If this is a hidden event, send invitations now.
      // Member invites + outside email invites.
      if (visibility === 'hidden') {
        const outsideEmails = outsideEmailsText
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const memberIds = Array.from(invitedMemberIds);
        if (memberIds.length > 0 || outsideEmails.length > 0) {
          const res = await sendEventInvitations({
            eventId: (nightData as any).id,
            memberUserIds: memberIds,
            outsideEmails,
            welcomeMessage: welcomeMessage.trim() || undefined,
          });
          if (res && !res.ok) {
            // Event was created; invitations partially failed. Don't block
            // the redirect, but surface the error.
            console.error('[createNight] invitation send failed:', res.error);
          }
        }
      }

      router.push(`${eventBasePath}/${(nightData as any).id}`);
    } catch (err: any) {
      setFormError(err.message);
      setCreating(false);
    }
  }

  async function createSeries(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!sName.trim()) return setFormError('Series name is required.');
    if (sNumTables < 1) return setFormError('At least one table is required.');
    const zipErr = validateZip(sAddr.zip);
    if (zipErr) return setFormError(zipErr);
    if (!cb.club || !act.activity) return;

    const dates = computeSeriesDates();
    if (dates.length === 0) return setFormError('Pick a start date, end date (≥ start), and a weekly interval.');
    if (dates.length > 52) return setFormError('Series would produce too many nights. Shorten the range or increase the interval.');

    setCreating(true);
    try {
      // Build all the night rows in one batch
      const padWidth = String(dates.length).length;
      const nightRows = dates.map((d, i) => ({
        club_id: cb.club!.id,
        activity_id: act.activity!.id,
        name: `${sName.trim()} — Night ${String(i + 1).padStart(padWidth, '0')}`,
        date: d,
        start_time: sTime || null,
        num_tables: sNumTables,
        games_planned: sGamesPlanned,
        host_player_id: sHostId || null,
        street: sAddr.street.trim() || null,
        city: sAddr.city.trim() || null,
        state: sAddr.state || null,
        zip: sAddr.zip.trim() || null,
      }));

      const { data: createdNights, error: nightsErr } = await supabase
        .from('events')
        .insert(nightRows)
        .select('id');
      if (nightsErr) throw new Error(nightsErr.message);
      if (!createdNights) throw new Error('Insert returned no rows.');

      // Build all the table rows in one batch
      const tableRows: any[] = [];
      (createdNights as { id: string }[]).forEach((n) => {
        for (let i = 0; i < sNumTables; i++) {
          tableRows.push({
            club_id: cb.club!.id,
            event_id: n.id,
            table_number: i + 1,
            assigned: false,
          });
        }
      });

      const { error: tablesErr } = await supabase.from('tables').insert(tableRows);
      if (tablesErr) throw new Error('Nights created but tables failed: ' + tablesErr.message);

      // Reset form, close, reload the list
      setSName('');
      setSEndDate('');
      setSHostId('');
      setSAddr(EMPTY_ADDR);
      setMode('none');
      setCreating(false);
      await load();
    } catch (err: any) {
      setFormError(err.message);
      setCreating(false);
    }
  }

  if (!cb.club) return null;

  const selectedHost = members.find((m) => m.user_id === hostId);
  const hostHasAddress = !!(selectedHost?.street || selectedHost?.city || selectedHost?.state || selectedHost?.zip);

  return (
    <PullToRefresh onRefresh={load}>
    <div className="space-y-10">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">The Calendar</p>
          <h1 className="font-display text-5xl md:text-6xl">Game Nights</h1>
        </div>
        {cb.isMember ? (
          <div className="flex gap-2 flex-wrap">
            {mode !== 'none' ? (
              <button onClick={() => { setMode('none'); setFormError(null); }} className="btn btn-ghost">Cancel</button>
            ) : (
              <>
                <button onClick={() => { setMode('night'); setFormError(null); }} className="btn">+ New Night</button>
                <button onClick={() => { setMode('series'); setFormError(null); }} className="btn">+ New Series</button>
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-ink/40 italic">Join the league to create nights.</p>
        )}
      </header>

      {mode === 'night' && cb.isMember && (
        <form onSubmit={createNight} className="tile-border p-7 space-y-6 fade-up">
          <div className="grid md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className="label">Name <span className="text-cinnabar">*</span></label>
              <input className="input" value={nightName} onChange={(e) => setNightName(e.target.value)} placeholder="Spring Tournament Night 3" required />
            </div>
            <div>
              <label className="label">Date <span className="text-cinnabar">*</span></label>
              <input type="date" className="input" value={nightDate} onChange={(e) => setNightDate(e.target.value)} required />
            </div>
            <div>
              <label className="label">Start Time</label>
              <input type="time" className="input" value={nightTime} onChange={(e) => setNightTime(e.target.value)} />
              <p className="text-xs text-ink/40 italic mt-1">Displayed as 12-hour clock.</p>
            </div>
            <div>
              <label className="label">Number of Tables <span className="text-cinnabar">*</span></label>
              <input type="number" min={1} max={10} className="input"
                value={numTables}
                onChange={(e) => setNumTables(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                required />
              <p className="text-xs text-ink/40 italic mt-1">Capacity: {numTables * 4}–{numTables * 5} players.</p>
            </div>
            <div>
              <label className="label">Games per Night <span className="text-cinnabar">*</span></label>
              <input type="number" min={1} max={20} className="input"
                value={gamesPlanned}
                onChange={(e) => setGamesPlanned(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                required />
            </div>
            <div className="md:col-span-2">
              <label className="label">Host <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span></label>
              <select className="input" value={hostId} onChange={(e) => handleHostChange(e.target.value)}>
                <option value="">— No host yet —</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
              </select>
              <p className="text-xs text-ink/40 italic mt-1">A member can claim host later if none chosen here.</p>
            </div>
            <div className="md:col-span-2">
              <AddressFields
                value={addr}
                onChange={setAddr}
                helperText={
                  hostId && hostHasAddress
                    ? "Auto-filled from host's profile. Edit if the night is somewhere else."
                    : 'Enter manually, or set a host first to auto-fill from their profile.'
                }
              />
            </div>

            {/* Visibility — only admins/owners can create hidden events.
                Members can create normal events only. */}
            {(cb.isAdmin || cb.isOwner) && (
              <div className="md:col-span-2 border-t border-ink/10 pt-5">
                <label className="label">Visibility</label>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <button
                    type="button"
                    onClick={() => setVisibility('normal')}
                    className={`p-3 border text-left transition-colors ${
                      visibility === 'normal'
                        ? 'border-jade bg-jade/5'
                        : 'border-ink/15 hover:border-jade/40'
                    }`}
                  >
                    <div className="text-sm font-medium">Normal</div>
                    <div className="text-xs text-ink/50 italic">Visible to all club members.</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isPro === false) {
                        // Redirect to billing rather than letting them fill
                        // out the hidden-event form they can't submit.
                        router.push(`/c/${cb.club!.slug}/billing`);
                        return;
                      }
                      setVisibility('hidden');
                    }}
                    className={`p-3 border text-left transition-colors relative ${
                      visibility === 'hidden'
                        ? 'border-cinnabar bg-cinnabar/5'
                        : isPro === false
                          ? 'border-ink/15 opacity-70 hover:border-cinnabar/40 hover:opacity-100'
                          : 'border-ink/15 hover:border-cinnabar/40'
                    }`}
                  >
                    {isPro === false && (
                      <span className="absolute top-2 right-2 text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 bg-cinnabar/10 border border-cinnabar/40 text-cinnabar">
                        Pro
                      </span>
                    )}
                    <div className="text-sm font-medium">Hidden</div>
                    <div className="text-xs text-ink/50 italic">Invite-only. Hidden from others.</div>
                    {isPro === false && (
                      <div className="text-[10px] tracking-[0.15em] uppercase text-cinnabar mt-2">
                        Upgrade to unlock →
                      </div>
                    )}
                  </button>
                </div>

                {visibility === 'hidden' && (
                  <div className="mt-5 space-y-5 pl-4 border-l-2 border-cinnabar/30">
                    <div>
                      <label className="label">Invite club members</label>
                      <p className="text-xs text-ink/40 italic mb-2">
                        {invitedMemberIds.size === 0
                          ? 'Select members to invite.'
                          : `${invitedMemberIds.size} selected`}
                      </p>
                      {members.length === 0 ? (
                        <p className="text-xs text-ink/50 italic">No members to invite yet.</p>
                      ) : (
                        <div className="max-h-48 overflow-y-auto border border-ink/15 p-2 space-y-1">
                          {members.map((m) => (
                            <label key={m.user_id} className="flex items-center gap-2 cursor-pointer hover:bg-ink/5 px-2 py-1 text-sm">
                              <input
                                type="checkbox"
                                checked={invitedMemberIds.has(m.user_id)}
                                onChange={(e) => {
                                  setInvitedMemberIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(m.user_id);
                                    else next.delete(m.user_id);
                                    return next;
                                  });
                                }}
                                className="accent-jade w-4 h-4"
                              />
                              <span>{m.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="label">
                        Invite outside guests <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span>
                      </label>
                      <textarea
                        className="input min-h-[60px] font-mono text-sm"
                        value={outsideEmailsText}
                        onChange={(e) => setOutsideEmailsText(e.target.value)}
                        placeholder="sarah@example.com&#10;tom@example.com"
                      />
                      <p className="text-xs text-ink/40 italic mt-1">
                        Email addresses, one per line. They&apos;ll be invited to join the club AND this event in one step. Max 20.
                      </p>
                    </div>

                    <div>
                      <label className="label">
                        Welcome message <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span>
                      </label>
                      <textarea
                        className="input min-h-[60px]"
                        value={welcomeMessage}
                        onChange={(e) => setWelcomeMessage(e.target.value)}
                        placeholder="A personal note included in the invitation email."
                        maxLength={2000}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {formError && <p className="text-cinnabar text-sm">{formError}</p>}
          <div className="flex gap-3 pt-2">
            <button className="btn btn-jade" disabled={creating}>{creating ? 'Creating…' : 'Create Game Night'}</button>
            <button type="button" onClick={() => setMode('none')} className="btn btn-ghost">Cancel</button>
          </div>
        </form>
      )}

      {mode === 'series' && cb.isMember && (() => {
        const seriesDates = computeSeriesDates();
        const sHostMember = members.find((m) => m.user_id === sHostId);
        const sHostHasAddress = !!(sHostMember?.street || sHostMember?.city || sHostMember?.state || sHostMember?.zip);
        return (
          <form onSubmit={createSeries} className="tile-border p-7 space-y-6 fade-up">
            <div>
              <h2 className="font-display text-2xl mb-1">New Series</h2>
              <p className="text-xs text-ink/50 italic">
                Creates many game nights at once. Each one is fully editable afterward.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className="label">Series Name <span className="text-cinnabar">*</span></label>
                <input className="input" value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Spring Season 2026" required />
                <p className="text-xs text-ink/40 italic mt-1">
                  Each night will be named like "{sName.trim() || 'Spring Season 2026'} — Night 01", "{sName.trim() || 'Spring Season 2026'} — Night 02", and so on.
                </p>
              </div>

              <div>
                <label className="label">First Date <span className="text-cinnabar">*</span></label>
                <input type="date" className="input" value={sStartDate} onChange={(e) => setSStartDate(e.target.value)} required />
                {sStartDate && (
                  <p className="text-xs text-ink/40 italic mt-1">{formatWeekday(sStartDate)}s</p>
                )}
              </div>
              <div>
                <label className="label">Last Date <span className="text-cinnabar">*</span></label>
                <input type="date" className="input" value={sEndDate} onChange={(e) => setSEndDate(e.target.value)} required min={sStartDate} />
                <p className="text-xs text-ink/40 italic mt-1">Inclusive — the final night may fall on this date.</p>
              </div>

              <div className="md:col-span-2">
                <label className="label">Repeat <span className="text-cinnabar">*</span></label>
                <select className="input" value={sIntervalWeeks} onChange={(e) => setSIntervalWeeks(parseInt(e.target.value))}>
                  <option value={1}>Every week</option>
                  <option value={2}>Every other week</option>
                  <option value={3}>Every 3 weeks</option>
                  <option value={4}>Every 4 weeks</option>
                </select>
              </div>

              <div>
                <label className="label">Start Time</label>
                <input type="time" className="input" value={sTime} onChange={(e) => setSTime(e.target.value)} />
              </div>
              <div />

              <div>
                <label className="label">Number of Tables <span className="text-cinnabar">*</span></label>
                <input type="number" min={1} max={10} className="input"
                  value={sNumTables}
                  onChange={(e) => setSNumTables(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  required />
                <p className="text-xs text-ink/40 italic mt-1">Capacity: {sNumTables * 4}–{sNumTables * 5} players per night.</p>
              </div>
              <div>
                <label className="label">Games per Night <span className="text-cinnabar">*</span></label>
                <input type="number" min={1} max={20} className="input"
                  value={sGamesPlanned}
                  onChange={(e) => setSGamesPlanned(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  required />
              </div>

              <div className="md:col-span-2">
                <label className="label">Host <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional, applies to every night</span></label>
                <select className="input" value={sHostId} onChange={(e) => handleSeriesHostChange(e.target.value)}>
                  <option value="">— No host yet —</option>
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
                </select>
                <p className="text-xs text-ink/40 italic mt-1">
                  Any member can claim host on individual nights later, or admins can edit each.
                </p>
              </div>

              <div className="md:col-span-2">
                <AddressFields
                  value={sAddr}
                  onChange={setSAddr}
                  helperText={
                    sHostId && sHostHasAddress
                      ? "Auto-filled from host's profile. Applies to every night unless edited individually later."
                      : 'Applies to every night in the series. Each night can be edited individually after creation.'
                  }
                />
              </div>
            </div>

            <div className="border-t border-ink/10 pt-5">
              <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-2">Preview</div>
              {seriesDates.length === 0 ? (
                <p className="text-sm text-ink/50 italic">Fill in start date, end date, and interval to see the generated nights.</p>
              ) : (
                <>
                  <p className="text-sm text-ink/70 mb-3">
                    Will create <strong>{seriesDates.length}</strong> game night{seriesDates.length === 1 ? '' : 's'}
                    {' '}— every {sIntervalWeeks === 1 ? '' : sIntervalWeeks === 2 ? 'other ' : `${sIntervalWeeks} weeks on `}
                    {formatWeekday(seriesDates[0])}
                    {sIntervalWeeks === 1 ? '' : ''}.
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto text-xs">
                    {seriesDates.slice(0, 30).map((d) => (
                      <span key={d} className="inline-block px-2 py-1 bg-bone/60 border border-ink/15">
                        {new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    ))}
                    {seriesDates.length > 30 && (
                      <span className="text-ink/50 italic px-2 py-1">+ {seriesDates.length - 30} more</span>
                    )}
                  </div>
                </>
              )}
            </div>

            {formError && <p className="text-cinnabar text-sm">{formError}</p>}
            <div className="flex gap-3 pt-2">
              <button className="btn btn-jade" disabled={creating || seriesDates.length === 0}>
                {creating ? 'Creating…' : `Create ${seriesDates.length || ''} Night${seriesDates.length === 1 ? '' : 's'}`}
              </button>
              <button type="button" onClick={() => setMode('none')} className="btn btn-ghost">Cancel</button>
            </div>
          </form>
        );
      })()}

      {loading ? (
        <p className="text-ink/40 italic">Loading…</p>
      ) : nights.length === 0 ? (
        <div className="tile-border p-12 text-center">
          <p className="font-display italic text-xl text-ink/50">No game nights yet.</p>
          {cb.isMember && mode === 'none' && (
            <button onClick={() => setMode('night')} className="btn mt-6">Create the First</button>
          )}
        </div>
      ) : (() => {
        const today = new Date().toISOString().slice(0, 10);
        const isPast = (n: Night) => n.status === 'completed' || n.date < today;
        const upcoming = nights.filter((n) => !isPast(n)).sort((a, b) =>
          a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || '')
        );
        const past = nights.filter(isPast); // already in desc order from query
        const nextEvent = upcoming[0] || null;
        const otherUpcoming = upcoming.slice(1);

        return (
          <div className="space-y-12">
            {/* NEXT EVENT */}
            {nextEvent && (
              <section>
                <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Next Event</div>
                <NextEventCard
                  night={nextEvent}
                  eventBasePath={eventBasePath}
                  personalStatus={
                    !auth.userId
                      ? { kind: 'none' }
                      : nextEvent.host?.id === auth.userId
                        ? { kind: 'hosting' }
                        : mySignedUpNightIds.has(nextEvent.id)
                          ? { kind: 'signed_up' }
                          : { kind: 'not_signed_up' }
                  }
                />
              </section>
            )}

            {/* UPCOMING */}
            {otherUpcoming.length > 0 && (
              <section>
                <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">
                  Upcoming ({otherUpcoming.length})
                </div>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {otherUpcoming.map((n, i) => (
                    <UpcomingCard
                      key={n.id}
                      night={n}
                      eventBasePath={eventBasePath}
                      index={i}
                      personalStatus={
                        !auth.userId
                          ? { kind: 'none' }
                          : n.host?.id === auth.userId
                            ? { kind: 'hosting' }
                            : mySignedUpNightIds.has(n.id)
                              ? { kind: 'signed_up' }
                              : { kind: 'not_signed_up' }
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {/* PAST */}
            {past.length > 0 && (
              <section>
                <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">
                  Past ({past.length})
                </div>
                <ul className="divide-y divide-ink/10 border-y border-ink/10">
                  {past.map((n) => (
                    <PastNightRow
                      key={n.id}
                      eventBasePath={eventBasePath}
                      night={n}
                      expanded={expandedPastId === n.id}
                      onToggle={async () => {
                        if (expandedPastId === n.id) {
                          setExpandedPastId(null);
                        } else {
                          setExpandedPastId(n.id);
                          await loadPastStandings(n.id);
                        }
                      }}
                      standings={pastStandings[n.id]}
                    />
                  ))}
                </ul>
              </section>
            )}

            {/* If no upcoming events, show a "next event" empty state hint */}
            {!nextEvent && past.length > 0 && (
              <p className="text-ink/40 italic text-sm">Nothing scheduled.</p>
            )}
          </div>
        );
      })()}
    </div>
    </PullToRefresh>
  );
}

// ============================================================
// Shared helpers come from components/NextEventCard
import { NextEventCard, UpcomingCard, nightStatusBadge as nightStatus, statusChipClass } from '@/components/NextEventCard';

// ============================================================
function PastNightRow({
  eventBasePath, night, expanded, onToggle, standings,
}: {
  eventBasePath: string;
  night: Night;
  expanded: boolean;
  onToggle: () => void;
  standings: NightStanding[] | undefined;
}) {
  return (
    <li>
      <button
        onClick={onToggle}
        className="w-full flex items-baseline justify-between gap-4 py-3 px-1 text-left hover:bg-ink/[0.03] transition-colors"
      >
        <div className="flex items-baseline gap-4 min-w-0 flex-1">
          <span className="text-xs tracking-[0.2em] uppercase text-ink/40 whitespace-nowrap w-32 flex-shrink-0">
            {new Date(night.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
          </span>
          <span className="font-medium truncate">{night.name}</span>
          {night.host && (
            <span className="text-xs text-ink/40 italic hidden sm:inline truncate">· {night.host.name}</span>
          )}
        </div>
        <span className={`text-ink/30 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}>›</span>
      </button>
      {expanded && (
        <div className="pl-2 pr-1 pb-5 fade-up">
          {standings === undefined ? (
            <p className="text-xs text-ink/40 italic py-2">Loading standings…</p>
          ) : standings.length === 0 ? (
            <p className="text-xs text-ink/40 italic py-2">No scores recorded for this night.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] tracking-[0.2em] uppercase text-ink/40">
                      <th className="text-left py-1 pr-3 w-8">#</th>
                      <th className="text-left py-1 pr-3">Player</th>
                      <th className="text-right py-1 px-2">Pts</th>
                      <th className="text-right py-1 px-2">Wins</th>
                      <th className="text-right py-1 pl-2 hidden sm:table-cell">Games</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((s, i) => (
                      <tr key={s.user_id} className="border-t border-ink/10">
                        <td className={`py-1.5 pr-3 rank-glyph ${i === 0 ? 'text-cinnabar' : i < 3 ? 'text-jade' : 'text-ink/40'}`}>
                          {i + 1}
                        </td>
                        <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                        <td className="py-1.5 px-2 text-right font-display">{s.points}</td>
                        <td className="py-1.5 px-2 text-right">{s.wins}</td>
                        <td className="py-1.5 pl-2 text-right text-ink/50 hidden sm:table-cell">{s.games}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">
                <Link href={`${eventBasePath}/${night.id}`} className="text-xs tracking-[0.15em] uppercase text-ink/50 hover:text-cinnabar">
                  Full night details →
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}
