'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatTime12 } from '@/lib/game-utils';
import { ACTIVITY_TYPE_LABEL } from '@/lib/use-activity';
import {
  findNearbyEvents,
  findNearbyClubs,
  type NearbyEvent,
  type NearbyEventType,
  type NearbyClub,
  type ClubMemberRange,
} from '@/app/actions/discovery';

const DISTANCE_OPTIONS: number[] = [5, 10, 25, 50, 100];
const TYPE_OPTIONS: { value: NearbyEventType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'league', label: 'League' },
  { value: 'tournament', label: 'Tournament' },
  { value: 'class', label: 'Class' },
  { value: 'open_play', label: 'Open Play' },
];

type DiscoveryMode = 'events' | 'clubs';

// Discriminated union for the load state — handles loading, data, and
// various error/empty conditions per mode.
type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'events-data'; events: NearbyEvent[] }
  | { kind: 'clubs-data'; clubs: NearbyClub[] }
  | { kind: 'no-zip' }
  | { kind: 'zip-not-found' }
  | { kind: 'error'; message: string };

/**
 * "Near you" section on the signed-in dashboard. Top-level toggle between
 * Events and Clubs. Distance filter applies to both. Activity-type filter
 * shows only in Events mode.
 *
 * Lookup origin: the user's profile zip. (Browser geolocation not used yet.)
 */
export default function NearYou() {
  const [mode, setMode] = useState<DiscoveryMode>('events');
  const [maxMiles, setMaxMiles] = useState<number>(10);
  const [type, setType] = useState<NearbyEventType>('all');
  const [state, setState] = useState<LoadState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        if (mode === 'events') {
          const res = await findNearbyEvents({ maxMiles, type });
          if (cancelled) return;
          if (!res) {
            setState({ kind: 'error', message: 'No response from server. Try again.' });
            return;
          }
          if (!res.ok) {
            if (res.error === 'NO_ZIP') setState({ kind: 'no-zip' });
            else if (res.error === 'ZIP_NOT_FOUND') setState({ kind: 'zip-not-found' });
            else setState({ kind: 'error', message: res.error });
            return;
          }
          setState({ kind: 'events-data', events: res.data });
        } else {
          const res = await findNearbyClubs({ maxMiles });
          if (cancelled) return;
          if (!res) {
            setState({ kind: 'error', message: 'No response from server. Try again.' });
            return;
          }
          if (!res.ok) {
            if (res.error === 'NO_ZIP') setState({ kind: 'no-zip' });
            else if (res.error === 'ZIP_NOT_FOUND') setState({ kind: 'zip-not-found' });
            else setState({ kind: 'error', message: res.error });
            return;
          }
          setState({ kind: 'clubs-data', clubs: res.data });
        }
      } catch (e: any) {
        if (cancelled) return;
        setState({ kind: 'error', message: e?.message || 'Failed to load.' });
      }
    })();
    return () => { cancelled = true; };
    // type only matters when mode === 'events', but listing it as a dep is
    // harmless — switching mode will refetch anyway.
  }, [mode, maxMiles, type]);

  return (
    <section>
      <header className="mb-5">
        <h2 className="font-display text-3xl">Near you</h2>
        <p className="text-xs text-ink/50 italic mt-1">
          Public events and clubs in your area.
        </p>
      </header>

      {/* Mode tabs */}
      <div className="grid grid-cols-2 gap-0 border border-ink/15 mb-5 max-w-xs">
        <button
          type="button"
          onClick={() => setMode('events')}
          className={`py-2 px-4 text-xs tracking-[0.2em] uppercase transition-colors ${
            mode === 'events'
              ? 'bg-jade text-bone'
              : 'bg-bone text-ink/60 hover:bg-ink/5'
          }`}
        >
          Events
        </button>
        <button
          type="button"
          onClick={() => setMode('clubs')}
          className={`py-2 px-4 text-xs tracking-[0.2em] uppercase transition-colors ${
            mode === 'clubs'
              ? 'bg-jade text-bone'
              : 'bg-bone text-ink/60 hover:bg-ink/5'
          }`}
        >
          Clubs
        </button>
      </div>

      {/* Distance + (events only) type filters */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <div className="flex items-center gap-2 text-xs">
          <label className="text-ink/50 tracking-[0.15em] uppercase">Within</label>
          <select
            className="input py-1 px-2 text-sm w-auto"
            value={maxMiles}
            onChange={(e) => setMaxMiles(parseInt(e.target.value, 10))}
          >
            {DISTANCE_OPTIONS.map((m) => (
              <option key={m} value={m}>{m} mi</option>
            ))}
          </select>
        </div>
        {mode === 'events' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setType(opt.value)}
                className={`px-3 py-1 text-xs tracking-[0.1em] uppercase border transition-colors ${
                  type === opt.value
                    ? 'bg-jade text-bone border-jade'
                    : 'bg-bone text-ink/60 border-ink/15 hover:border-jade/40 hover:text-jade'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      {state.kind === 'idle' || state.kind === 'loading' ? (
        <p className="text-ink/40 italic text-sm">
          {mode === 'events' ? 'Looking for events…' : 'Looking for clubs…'}
        </p>
      ) : state.kind === 'no-zip' ? (
        <div className="tile-border p-5">
          <p className="text-sm text-ink/70 mb-3">
            Add your ZIP code to your profile to discover {mode} near you.
          </p>
          <Link href="/profile" className="btn btn-jade text-sm">Edit profile</Link>
        </div>
      ) : state.kind === 'zip-not-found' ? (
        <div className="tile-border p-5">
          <p className="text-sm text-ink/70 mb-1">
            We don&apos;t have coordinates for your ZIP code yet.
          </p>
          <p className="text-xs text-ink/50 italic">
            This is a Pungctual data issue, not yours. If you contact <a href="mailto:support@pungctual.com" className="text-jade underline">support</a> we&apos;ll add your ZIP to our database.
          </p>
        </div>
      ) : state.kind === 'error' ? (
        <p className="text-cinnabar text-sm">{state.message}</p>
      ) : state.kind === 'events-data' ? (
        <EventsList events={state.events} maxMiles={maxMiles} type={type} />
      ) : state.kind === 'clubs-data' ? (
        <ClubsList clubs={state.clubs} maxMiles={maxMiles} />
      ) : null}
    </section>
  );
}

function EventsList({
  events,
  maxMiles,
  type,
}: {
  events: NearbyEvent[];
  maxMiles: number;
  type: NearbyEventType;
}) {
  if (events.length === 0) {
    return (
      <div className="tile-border p-5">
        <p className="text-sm text-ink/70">
          No public events within {maxMiles} miles
          {type !== 'all' ? ` matching ${TYPE_OPTIONS.find((t) => t.value === type)!.label.toLowerCase()}` : ''}.
        </p>
        <p className="text-xs text-ink/50 italic mt-1">Try a wider radius or different filter.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-ink/10 border-y border-ink/10">
      {events.map((ev) => {
        const dateLabel = formatEventDate(ev.date);
        const timeLabel = ev.start_time ? formatTime12(ev.start_time) : null;
        const typeLabel = ACTIVITY_TYPE_LABEL[ev.activity.type as keyof typeof ACTIVITY_TYPE_LABEL] || ev.activity.type;
        return (
          <li key={ev.id} className="py-3">
            <Link
              href={`/c/${ev.club.slug}/a/${ev.activity.slug}/events/${ev.id}`}
              className="block hover:bg-ink/5 -mx-2 px-2 py-1"
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{ev.name}</div>
                  <div className="text-xs text-ink/50 mt-0.5">
                    {ev.club.name} · <span className="uppercase tracking-[0.1em] text-ink/40">{typeLabel}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-ink/60">{dateLabel}{timeLabel ? ` · ${timeLabel}` : ''}</div>
                  <div className="text-[10px] text-jade tracking-[0.1em] uppercase">{ev.miles} mi</div>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ClubsList({ clubs, maxMiles }: { clubs: NearbyClub[]; maxMiles: number }) {
  if (clubs.length === 0) {
    return (
      <div className="tile-border p-5">
        <p className="text-sm text-ink/70">No public clubs within {maxMiles} miles.</p>
        <p className="text-xs text-ink/50 italic mt-1">Try a wider radius.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-ink/10 border-y border-ink/10">
      {clubs.map((c) => {
        const location = c.city && c.state ? `${c.city}, ${c.state}` : null;
        return (
          <li key={c.id} className="py-3">
            <Link
              href={`/c/${c.slug}`}
              className="block hover:bg-ink/5 -mx-2 px-2 py-1"
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{c.name}</div>
                  <div className="text-xs text-ink/50 mt-0.5 flex items-center gap-2 flex-wrap">
                    {location && <span>{location}</span>}
                    <span className="text-ink/30">·</span>
                    <span>{memberRangeLabel(c.memberRange)}</span>
                    {c.upcomingPublicEventCount > 0 && (
                      <>
                        <span className="text-ink/30">·</span>
                        <span className="text-jade">
                          {c.upcomingPublicEventCount} upcoming event{c.upcomingPublicEventCount === 1 ? '' : 's'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-jade tracking-[0.1em] uppercase">{c.miles} mi</div>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function memberRangeLabel(range: ClubMemberRange): string {
  switch (range) {
    case 'small': return 'Under 10 members';
    case 'medium': return '10–25 members';
    case 'large': return '26+ members';
  }
}

// "Mar 17" or "Mar 17, 2027" if not current year
function formatEventDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  const now = new Date();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
