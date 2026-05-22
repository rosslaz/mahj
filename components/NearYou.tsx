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
 * Lookup origin: the user's profile zip.
 *
 * Visual language matches the rest of the dashboard:
 *   - Small all-caps section label (not a display heading)
 *   - Card grid for results (matches Upcoming + My Clubs)
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
  }, [mode, maxMiles, type]);

  return (
    <section>
      {/* Section label — matches Next Event / For You / Upcoming / etc. */}
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40">Near You</div>
        {/* Mode tabs sit on the same row as the label, pushed right */}
        <div className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase">
          <button
            type="button"
            onClick={() => setMode('events')}
            className={`px-3 py-1 border transition-colors ${
              mode === 'events'
                ? 'bg-jade text-bone border-jade'
                : 'bg-bone text-ink/50 border-ink/15 hover:border-jade/40 hover:text-jade'
            }`}
          >
            Events
          </button>
          <button
            type="button"
            onClick={() => setMode('clubs')}
            className={`px-3 py-1 border transition-colors ${
              mode === 'clubs'
                ? 'bg-jade text-bone border-jade'
                : 'bg-bone text-ink/50 border-ink/15 hover:border-jade/40 hover:text-jade'
            }`}
          >
            Clubs
          </button>
        </div>
      </div>

      {/* Filters row: distance dropdown + (events only) type chips */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
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
        <EventCards events={state.events} maxMiles={maxMiles} type={type} />
      ) : state.kind === 'clubs-data' ? (
        <ClubCards clubs={state.clubs} maxMiles={maxMiles} />
      ) : null}
    </section>
  );
}

function EventCards({
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
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {events.map((ev, i) => {
        const typeLabel = ACTIVITY_TYPE_LABEL[ev.activity.type as keyof typeof ACTIVITY_TYPE_LABEL] || ev.activity.type;
        return (
          <Link
            key={ev.id}
            href={`/c/${ev.club.slug}/a/${ev.activity.slug}/events/${ev.id}`}
            className="tile-border p-5 hover:border-cinnabar/40 transition-colors fade-up flex flex-col"
            style={{ animationDelay: `${i * 0.04}s` }}
          >
            <div className="text-[10px] tracking-[0.25em] uppercase text-jade mb-1.5">
              {ev.club.name} · {typeLabel}
            </div>
            <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-2">
              {new Date(ev.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              {ev.start_time && <span className="ml-2">· {formatTime12(ev.start_time)}</span>}
            </div>
            <div className="font-display text-xl mb-1 line-clamp-2">{ev.name}</div>
            {(ev.city && ev.state) && (
              <div className="text-xs text-ink/50 italic">{ev.city}, {ev.state}</div>
            )}
            <div className="mt-auto flex items-center justify-end pt-3 border-t border-ink/10">
              <span className="text-[10px] tracking-[0.15em] uppercase text-jade">{ev.miles} mi away</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function ClubCards({ clubs, maxMiles }: { clubs: NearbyClub[]; maxMiles: number }) {
  if (clubs.length === 0) {
    return (
      <div className="tile-border p-5">
        <p className="text-sm text-ink/70">No public clubs within {maxMiles} miles.</p>
        <p className="text-xs text-ink/50 italic mt-1">Try a wider radius.</p>
      </div>
    );
  }
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {clubs.map((c, i) => {
        const location = c.city && c.state ? `${c.city}, ${c.state}` : null;
        return (
          <Link
            key={c.id}
            href={`/c/${c.slug}`}
            className="tile-border p-5 hover:border-cinnabar/40 transition-colors fade-up flex flex-col"
            style={{ animationDelay: `${i * 0.04}s` }}
          >
            {location && (
              <div className="text-[10px] tracking-[0.25em] uppercase text-jade mb-1.5">{location}</div>
            )}
            <div className="font-display text-xl mb-2 line-clamp-2">{c.name}</div>
            {c.description && (
              <div className="text-sm text-ink/60 line-clamp-2 mb-3">{c.description}</div>
            )}
            <div className="mt-auto pt-3 border-t border-ink/10 space-y-1.5">
              <div className="text-[11px] text-ink/50">{memberRangeLabel(c.memberRange)}</div>
              {c.upcomingPublicEventCount > 0 && (
                <div className="text-[11px] text-cinnabar/80">
                  {c.upcomingPublicEventCount} upcoming event{c.upcomingPublicEventCount === 1 ? '' : 's'}
                </div>
              )}
              <div className="flex items-center justify-end">
                <span className="text-[10px] tracking-[0.15em] uppercase text-jade">{c.miles} mi away</span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function memberRangeLabel(range: ClubMemberRange): string {
  switch (range) {
    case 'small': return 'Under 10 members';
    case 'medium': return '10–25 members';
    case 'large': return '26+ members';
  }
}
