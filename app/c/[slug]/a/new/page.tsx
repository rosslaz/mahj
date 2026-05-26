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
import { validateZip } from '@/lib/address';
import { computeSeriesDates } from '@/lib/game-utils';

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
      // Default host to the current user if they're a member
      if (auth.userId && list.some((m) => m.user_id === auth.userId)) {
        setHostId(auth.userId);
      }
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
      const aSlug = await pickActivitySlug(slugify(activityName.trim()));
      const { data: actData, error: actErr } = await supabase
        .from('activities')
        .insert({
          club_id: cb.club!.id,
          slug: aSlug,
          name: activityName.trim(),
          description: activityDescription.trim() || null,
          type,
          is_public: isPublic,
        })
        .select()
        .single();
      if (actErr || !actData) throw new Error(actErr?.message || 'Could not create activity.');
      router.push(`/c/${clubSlug}/a/${aSlug}`);
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
      // Create the activity first
      const aSlug = await pickActivitySlug(slugify(activityName.trim()));
      const { data: actData, error: actErr } = await supabase
        .from('activities')
        .insert({
          club_id: cb.club!.id,
          slug: aSlug,
          name: activityName.trim(),
          description: activityDescription.trim() || null,
          type,
          is_public: isPublic,
        })
        .select()
        .single();
      if (actErr || !actData) throw new Error(actErr?.message || 'Could not create activity.');
      const activityId = (actData as any).id;

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
        </header>

        <div className="grid sm:grid-cols-2 gap-3">
          {ACTIVITY_TYPES.map((t) => (
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
          ))}
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
                  <label className="label">Repeat every</label>
                  <div className="flex items-center gap-2">
                    <input type="number" className="input w-16 text-center" min={1} max={12} value={intervalWeeks} onChange={(e) => setIntervalWeeks(parseInt(e.target.value || '1', 10))} />
                    <span className="text-sm text-ink/60">week{intervalWeeks === 1 ? '' : 's'}</span>
                  </div>
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
                <input type="number" className="input w-24 text-center" min={1} max={10} value={numTables} onChange={(e) => setNumTables(parseInt(e.target.value || '1', 10))} />
                <p className="text-xs text-ink/40 italic mt-1">Each holds 4 or 5 players.</p>
              </div>
              <div>
                <label className="label">Games per event</label>
                <input type="number" className="input w-24 text-center" min={1} max={20} value={gamesPlanned} onChange={(e) => setGamesPlanned(parseInt(e.target.value || '1', 10))} />
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
