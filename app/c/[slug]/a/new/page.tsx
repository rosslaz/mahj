'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import {
  ACTIVITY_TYPE_LABEL,
  ACTIVITY_TYPE_DESCRIPTION,
  activityHasScoring,
  type ActivityType,
} from '@/lib/use-activity';
import { slugify } from '@/lib/slug';
import { AddressFields, AddressFieldsValue } from '@/components/AddressFields';
import { NumberStepper } from '@/components/NumberStepper';
import { validateZip } from '@/lib/address';
import { computeSeriesDates } from '@/lib/game-utils';
import { getNewActivityGateState } from '@/app/actions/billing-gates';
import { createActivityGated } from '@/app/actions/gated-writes';

const ACTIVITY_TYPES: ActivityType[] = ['league', 'tournament', 'class', 'open_play'];

// Reserved activity slugs to avoid colliding with club-level child routes
const RESERVED_SLUGS = new Set(['members', 'admin', 'settings', 'overview', 'new']);

// Tournament is single-event; everything else uses series by default.
function usesSeries(type: ActivityType): boolean {
  return type !== 'tournament';
}

function randomSuffix(len = 4): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

const EMPTY_ADDR: AddressFieldsValue = { street: '', city: '', state: '', zip: '' };

type Member = { user_id: string; name: string; street: string | null; city: string | null; state: string | null; zip: string | null };

export default function NewActivityPage() {
  const params = useParams();
  const router = useRouter();
  const clubSlug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(clubSlug);
  const supabase = getBrowserSupabase();

  // STEP 1: type picker
  const [type, setType] = useState<ActivityType | null>(null);

  // STEP 2: activity fields
  const [activityName, setActivityName] = useState('');
  const [activityDescription, setActivityDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  // STEP 2: event/series fields
  const [eventName, setEventName] = useState('');
  const [eventNameTouched, setEventNameTouched] = useState(false);
  const [singleDate, setSingleDate] = useState(new Date().toISOString().slice(0, 10));
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [time, setTime] = useState('');
  const [numTables, setNumTables] = useState(2);
  const [gamesPlanned, setGamesPlanned] = useState(4);
  const [hostId, setHostId] = useState('');
  const [addr, setAddr] = useState<AddressFieldsValue>(EMPTY_ADDR);

  // Members for the host picker — admin's own row, plus members of the club
  const [members, setMembers] = useState<Member[]>([]);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Billing gate state — loaded once when the club resolves. Until it loads
  // we render nothing for the body to avoid a flash of the type picker.
  const [gateState, setGateState] = useState<{
    isPro: boolean;
    atActivityCap: boolean;
    activityCap: number;
    allowedTypes: Set<ActivityType>;
  } | null>(null);
  useEffect(() => {
    if (!cb.club) return;
    let cancelled = false;
    getNewActivityGateState(cb.club.id).then((s) => {
      if (cancelled) return;
      setGateState({
        isPro: s.isPro,
        atActivityCap: s.atActivityCap,
        activityCap: s.activityCap,
        allowedTypes: new Set(s.allowedTypes),
      });
    }).catch((err) => {
      console.error('[new-activity] gate state failed:', err);
      // Treat failure as "allow everything" so we don't lock users out on
      // transient errors. The server-side gate on submit is still authoritative.
      setGateState({
        isPro: true,
        atActivityCap: false,
        activityCap: Number.POSITIVE_INFINITY,
        allowedTypes: new Set(['league', 'tournament', 'class', 'open_play']),
      });
    });
    return () => { cancelled = true; };
  }, [cb.club]);

  // Live-sync event name from activity name unless user has manually edited it.
  useEffect(() => {
    if (eventNameTouched) return;
    if (!activityName.trim()) { setEventName(''); return; }
    setEventName(activityName.trim());
  }, [activityName, eventNameTouched]);

  // Auto-fill default address from selected host's profile address (one-time on host change)
  useEffect(() => {
    if (!hostId) return;
    const h = members.find((m) => m.user_id === hostId);
    if (!h) return;
    setAddr({
      street: h.street || '',
      city: h.city || '',
      state: h.state || '',
      zip: h.zip || '',
    });
  }, [hostId, members]);

  // Load members for host dropdown
  useEffect(() => {
    if (!cb.club) return;
    (async () => {
      const { data } = await supabase
        .from('club_members')
        .select('user_id, user:user_id(name, street, city, state, zip, deleted_at)')
        .eq('club_id', cb.club!.id);
      const list: Member[] = ((data as any[]) || [])
        .filter((r) => r.user && !r.user.deleted_at)
        .map((r) => ({
          user_id: r.user_id,
          name: r.user.name,
          street: r.user.street, city: r.user.city, state: r.user.state, zip: r.user.zip,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setMembers(list);
      // Host defaults to none — user picks explicitly. This avoids the
      // address field auto-filling to the creator's address (often wrong
      // when an admin creates an activity for someone else, or when the
      // night isn't at the creator's home).
    })();
  }, [cb.club, supabase, auth.userId]);

  if (cb.loading) return <p className="text-ink/40 italic">Loading…</p>;
  if (!auth.email || !auth.userId) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Sign in</h1>
        <p className="text-ink/60 mb-6">Sign in to add activities.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }
  if (!cb.club) return null;
  if (!cb.isAdmin) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Not Authorized</h1>
        <p className="text-ink/60 mb-6">Only club admins can add activities.</p>
        <Link href={`/c/${clubSlug}`} className="btn btn-ghost">← Club home</Link>
      </div>
    );
  }

  async function pickActivitySlug(base: string): Promise<string> {
    if (!cb.club) return base;
    let candidate = base || 'activity';
    if (RESERVED_SLUGS.has(candidate)) candidate = `${candidate}-${randomSuffix(4)}`;
    if (candidate.length > 50) candidate = candidate.slice(0, 50);
    const { data } = await supabase
      .from('activities').select('id')
      .eq('club_id', cb.club.id).eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
    for (let i = 0; i < 8; i++) {
      const suffixed = `${candidate}-${randomSuffix(4)}`;
      const res = await supabase.from('activities').select('id').eq('club_id', cb.club.id).eq('slug', suffixed).maybeSingle();
      if (!res.data) return suffixed;
    }
    return `${candidate}-${randomSuffix(8)}`;
  }

  // Submit handlers - three variants share most validation
  async function createActivityOnly() {
    setError(null);
    if (!type) { setError('Pick an activity type first.'); return; }
    if (!activityName.trim()) { setError('Activity name is required.'); return; }
    setSubmitting(true);
    try {
      // Pick a unique slug client-side (read-only probe), then create via a
      // gated server action that re-checks the free-tier limit AND inserts in
      // one call. The DB trigger backstops it if the check is bypassed.
      const aSlug = await pickActivitySlug(slugify(activityName.trim()));
      const res = await createActivityGated({
        clubId: cb.club!.id,
        slug: aSlug,
        name: activityName.trim(),
        description: activityDescription.trim() || null,
        type,
        isPublic,
      });
      if (!res.ok) {
        setError(res.error);
        setSubmitting(false);
        return;
      }
      router.push(`/c/${clubSlug}/a/${res.data!.slug}`);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  async function createActivityWithEvents() {
    setError(null);
    if (!type) { setError('Pick an activity type first.'); return; }
    if (!activityName.trim()) { setError('Activity name is required.'); return; }
    if (!eventName.trim()) { setError('Event name is required.'); return; }
    if (activityHasScoring(type) && numTables < 1) { setError('At least one table is required.'); return; }
    const zipErr = validateZip(addr.zip);
    if (zipErr) { setError(zipErr); return; }

    // Public events (public activity + public club) require city + state
    const willBePublicEvent = isPublic && cb.club!.is_public;
    if (willBePublicEvent) {
      if (!addr.city.trim()) { setError('City is required for public events.'); return; }
      if (!addr.state) { setError('State is required for public events.'); return; }
    }

    // Compute the dates we need
    const series = usesSeries(type);
    let dates: string[];
    if (series) {
      const effectiveEnd = endDate || startDate;
      dates = computeSeriesDates(startDate, effectiveEnd, intervalWeeks);
      if (dates.length === 0) { setError('Pick valid start/end dates and a weekly interval.'); return; }
      if (dates.length > 52) { setError('Series would create too many events. Shorten the range or increase the interval.'); return; }
    } else {
      dates = [singleDate];
    }

    setSubmitting(true);
    try {
      // Create the activity via the gated server action (re-checks the
      // free-tier limit + inserts atomically; DB trigger backstops). The
      // events + tables below stay client-side — they're not billing-gated
      // beyond the hidden-event trigger, which fires on the events insert.
      const aSlug = await pickActivitySlug(slugify(activityName.trim()));
      const actRes = await createActivityGated({
        clubId: cb.club!.id,
        slug: aSlug,
        name: activityName.trim(),
        description: activityDescription.trim() || null,
        type,
        isPublic,
      });
      if (!actRes.ok) {
        setError(actRes.error);
        setSubmitting(false);
        return;
      }
      const activityId = actRes.data!.id;

      // Build event rows (single or series)
      const padWidth = String(dates.length).length;
      const eventRows = dates.map((d, i) => ({
        club_id: cb.club!.id,
        activity_id: activityId,
        name: dates.length === 1
          ? eventName.trim()
          : `${eventName.trim()} — Night ${String(i + 1).padStart(padWidth, '0')}`,
        date: d,
        start_time: time || null,
        num_tables: activityHasScoring(type) ? numTables : 1,
        games_planned: activityHasScoring(type) ? gamesPlanned : 1,
        host_player_id: hostId || null,
        street: addr.street.trim() || null,
        city: addr.city.trim() || null,
        state: addr.state || null,
        zip: addr.zip.trim() || null,
      }));
      const { data: createdEvents, error: evErr } = await supabase
        .from('events').insert(eventRows).select('id');
      if (evErr) throw new Error(evErr.message);
      if (!createdEvents) throw new Error('Event insert returned nothing.');

      // For scoring activities, create the table rows for each event
      if (activityHasScoring(type)) {
        const tableRows: any[] = [];
        (createdEvents as { id: string }[]).forEach((e) => {
          for (let i = 0; i < numTables; i++) {
            tableRows.push({
              club_id: cb.club!.id,
              event_id: e.id,
              table_number: i + 1,
              assigned: false,
            });
          }
        });
        if (tableRows.length > 0) {
          const { error: tErr } = await supabase.from('tables').insert(tableRows);
          if (tErr) throw new Error(tErr.message);
        }
      }

      // Land on the first event's detail page
      const firstId = (createdEvents as { id: string }[])[0].id;
      router.push(`/c/${clubSlug}/a/${aSlug}/events/${firstId}`);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  const series = type ? usesSeries(type) : true;
  const seriesDates = series && type ? computeSeriesDates(startDate, endDate || startDate, intervalWeeks) : [];

  // ----------------- STEP 1: type picker -----------------
  if (!type) {
    // While the gate state is loading, show a placeholder. Avoids flashing
    // the type picker before we know whether we should show the upgrade
    // screen instead.
    if (!gateState) {
      return <p className="text-ink/40 italic">Loading…</p>;
    }

    // Free tier and already at the activity cap → upgrade screen instead of
    // letting them fill out a form they can't submit.
    if (gateState.atActivityCap) {
      return (
        <div className="max-w-xl mx-auto space-y-10">
          <header>
            <nav className="text-xs tracking-[0.2em] uppercase flex items-center gap-2 flex-wrap mb-5">
              <Link href="/clubs" className="text-ink/40 hover:text-cinnabar transition-colors">My Clubs</Link>
              <span className="text-ink/20">/</span>
              <Link href={`/c/${clubSlug}`} className="text-ink/40 hover:text-cinnabar transition-colors">{cb.club.name}</Link>
              <span className="text-ink/20">/</span>
              <span className="text-ink/80">New Activity</span>
            </nav>
            <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">Upgrade to add more</p>
            <h1 className="font-display text-5xl">One activity limit</h1>
          </header>
          <div className="tile-border p-8 space-y-5">
            <p className="text-ink/70 leading-relaxed">
              Free clubs are limited to <strong>{gateState.activityCap} activity</strong>. Upgrade to Pro for unlimited activities — leagues, tournaments, classes, and open play sessions, all in one club.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link href={`/c/${clubSlug}/billing`} className="btn">View Pro plans</Link>
              <Link href={`/c/${clubSlug}`} className="btn btn-ghost">Back to club</Link>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-2xl mx-auto space-y-10">
        <header>
          <nav className="text-xs tracking-[0.2em] uppercase flex items-center gap-2 flex-wrap mb-5">
            <Link href="/clubs" className="text-ink/40 hover:text-cinnabar transition-colors">My Clubs</Link>
            <span className="text-ink/20">/</span>
            <Link href={`/c/${clubSlug}`} className="text-ink/40 hover:text-cinnabar transition-colors">{cb.club.name}</Link>
            <span className="text-ink/20">/</span>
            <span className="text-ink/80">New Activity</span>
          </nav>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">A new activity</p>
          <h1 className="font-display text-5xl">Add Activity</h1>
          <p className="mt-3 text-ink/60 italic">Pick a type.</p>
          {!gateState.isPro && (
            <p className="mt-2 text-xs text-ink/50">
              Tournaments and Classes require Pro. <Link href={`/c/${clubSlug}/billing`} className="text-cinnabar hover:underline">Upgrade</Link>.
            </p>
          )}
        </header>

        <div className="grid sm:grid-cols-2 gap-3">
          {ACTIVITY_TYPES.map((t) => {
            const isAllowed = gateState.allowedTypes.has(t);
            if (isAllowed) {
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="tile-border p-6 text-left hover:border-cinnabar/40 transition-colors group"
                >
                  <div className="font-display text-2xl mb-2 group-hover:text-cinnabar transition-colors">
                    {ACTIVITY_TYPE_LABEL[t]}
                  </div>
                  <div className="text-sm text-ink/60 italic leading-snug">
                    {ACTIVITY_TYPE_DESCRIPTION[t]}
                  </div>
                </button>
              );
            }
            // Pro-only type — clicking takes the user to billing, with a
            // Pro badge instead of letting them tap into a dead end.
            return (
              <Link
                key={t}
                href={`/c/${clubSlug}/billing`}
                className="tile-border p-6 text-left relative opacity-70 hover:opacity-100 hover:border-cinnabar/40 transition-all group"
              >
                <span className="absolute top-3 right-3 text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 bg-cinnabar/10 border border-cinnabar/40 text-cinnabar">
                  Pro
                </span>
                <div className="font-display text-2xl mb-2 text-ink/60 group-hover:text-cinnabar transition-colors">
                  {ACTIVITY_TYPE_LABEL[t]}
                </div>
                <div className="text-sm text-ink/50 italic leading-snug">
                  {ACTIVITY_TYPE_DESCRIPTION[t]}
                </div>
                <div className="mt-3 text-xs tracking-[0.15em] uppercase text-cinnabar group-hover:underline">
                  Upgrade to unlock →
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // ----------------- STEP 2: combined form -----------------
  const hasScoring = activityHasScoring(type);
  return (
    <div className="max-w-3xl mx-auto space-y-10">
      <header>
        <nav className="text-xs tracking-[0.2em] uppercase flex items-center gap-2 flex-wrap mb-3">
          <Link href="/clubs" className="text-ink/40 hover:text-cinnabar transition-colors">My Clubs</Link>
          <span className="text-ink/20">/</span>
          <Link href={`/c/${clubSlug}`} className="text-ink/40 hover:text-cinnabar transition-colors">{cb.club.name}</Link>
          <span className="text-ink/20">/</span>
          <span className="text-ink/80">New {ACTIVITY_TYPE_LABEL[type]}</span>
        </nav>
        <button
          onClick={() => { setType(null); setError(null); }}
          className="text-xs tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar"
        >
          ← Change type
        </button>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mt-4 mb-3">
          New {ACTIVITY_TYPE_LABEL[type].toLowerCase()}
        </p>
        <h1 className="font-display text-5xl">Add {ACTIVITY_TYPE_LABEL[type]}</h1>
        <p className="mt-3 text-ink/60 italic">
          {series
            ? <>Set up the {ACTIVITY_TYPE_LABEL[type].toLowerCase()} and schedule its sessions in one go.</>
            : <>Set up the tournament and schedule its first event.</>}
        </p>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); createActivityWithEvents(); }}
        className="space-y-7"
      >
        <section className="tile-border p-6 space-y-5">
          <h2 className="font-display text-2xl">The {ACTIVITY_TYPE_LABEL[type]}</h2>

          <div>
            <label className="label">Name <span className="text-cinnabar">*</span></label>
            <input
              className="input"
              value={activityName}
              onChange={(e) => setActivityName(e.target.value)}
              placeholder={
                type === 'league' ? 'Tuesday Night League' :
                type === 'tournament' ? 'Spring Tournament 2026' :
                type === 'class' ? 'Beginner Class — Spring' :
                'Wednesday Open Play'
              }
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label">Description <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span></label>
            <textarea
              className="input min-h-[70px] resize-y"
              value={activityDescription}
              onChange={(e) => setActivityDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="accent-jade w-4 h-4 mt-1"
              />
              <span>
                <span className="block text-sm font-medium">Public</span>
                {cb.club.is_public ? (
                  <span className="text-xs text-ink/50 italic block">
                    Discoverable outside the club. Public events require a city + state, and non-members signing up will need host approval before they see the street address.
                  </span>
                ) : (
                  <span className="text-xs text-ink/50 italic block">
                    Marking this public has no effect right now because <strong>{cb.club.name}</strong> is itself private. Both the club and the activity need to be public for non-members to see it.
                  </span>
                )}
              </span>
            </label>
          </div>
        </section>

        <section className="tile-border p-6 space-y-5">
          <h2 className="font-display text-2xl">
            {series ? 'First Sessions' : 'The First Event'}
          </h2>

          <div>
            <label className="label">
              Event name <span className="text-cinnabar">*</span>
              {!eventNameTouched && activityName && (
                <span className="text-ink/30 normal-case tracking-normal italic font-normal ml-2">— auto-filled from activity name</span>
              )}
            </label>
            <input
              className="input"
              value={eventName}
              onChange={(e) => { setEventName(e.target.value); setEventNameTouched(true); }}
              placeholder={activityName.trim() || 'Event name'}
              required
            />
            {series && (
              <p className="text-xs text-ink/40 italic mt-1">Each event will be named "{eventName.trim() || '…'} — Night 01", "— Night 02", and so on.</p>
            )}
          </div>

          {series ? (
            <>
              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <label className="label">Start date <span className="text-cinnabar">*</span></label>
                  <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
                </div>
                <div>
                  <label className="label">End date</label>
                  <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="same as start" min={startDate} />
                  <p className="text-xs text-ink/40 italic mt-1">Leave blank for one event.</p>
                </div>
                <div>
                  <label className="label">Repeat</label>
                  <select
                    className="input"
                    value={intervalWeeks}
                    onChange={(e) => setIntervalWeeks(parseInt(e.target.value, 10))}
                  >
                    <option value={1}>Every week</option>
                    <option value={2}>Every other week</option>
                    <option value={3}>Every 3 weeks</option>
                    <option value={4}>Every 4 weeks</option>
                  </select>
                </div>
              </div>
              {seriesDates.length > 0 && (
                <div className="border border-jade/30 bg-jade/5 p-3 text-xs">
                  Will create <strong>{seriesDates.length}</strong> event{seriesDates.length === 1 ? '' : 's'}
                  {seriesDates.length > 1 && <> from {new Date(seriesDates[0] + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} through {new Date(seriesDates[seriesDates.length - 1] + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
                </div>
              )}
            </>
          ) : (
            <div>
              <label className="label">Date <span className="text-cinnabar">*</span></label>
              <input type="date" className="input" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} required />
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="label">Start time <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span></label>
              <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <label className="label">Host <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span></label>
              <select className="input" value={hostId} onChange={(e) => setHostId(e.target.value)}>
                <option value="">— No host yet —</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          {hasScoring && (
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="label">Tables</label>
                <NumberStepper
                  value={numTables}
                  onChange={setNumTables}
                  min={1}
                  max={10}
                  label="Number of tables"
                />
                <p className="text-xs text-ink/40 italic mt-1">Each holds 4 or 5 players.</p>
              </div>
              <div>
                <label className="label">Games per event</label>
                <NumberStepper
                  value={gamesPlanned}
                  onChange={setGamesPlanned}
                  min={1}
                  max={20}
                  editable
                  label="Games per event"
                />
              </div>
            </div>
          )}

          <div>
            <AddressFields
              value={addr}
              onChange={setAddr}
              mode={isPublic && cb.club.is_public ? 'public_event' : 'optional'}
            />
            {hostId && (
              <p className="text-xs text-ink/40 italic mt-1">Filled from host's profile. Edit if a different location.</p>
            )}
          </div>
        </section>

        {error && <p className="text-cinnabar text-sm">{error}</p>}

        <div className="flex flex-wrap items-center gap-4">
          <button className="btn btn-jade" disabled={submitting} type="submit">
            {submitting ? 'Creating…' :
              series
                ? `Create + Schedule ${seriesDates.length || ''} Event${seriesDates.length === 1 ? '' : 's'}`
                : 'Create + Schedule Event'
            }
          </button>
          <button
            type="button"
            onClick={createActivityOnly}
            disabled={submitting || !activityName.trim()}
            className="text-sm tracking-[0.15em] uppercase text-ink/50 hover:text-cinnabar disabled:opacity-30"
          >
            {submitting ? '' : 'Skip — Create activity only'}
          </button>
        </div>
      </form>
    </div>
  );
}
