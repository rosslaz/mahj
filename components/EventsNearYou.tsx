'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatTime12 } from '@/lib/game-utils';
import { ACTIVITY_TYPE_LABEL } from '@/lib/use-activity';
import type { NearbyEvent, NearbyEventType } from '@/app/actions/discovery';

const DISTANCE_OPTIONS: number[] = [5, 10, 25, 50, 100];
const TYPE_OPTIONS: { value: NearbyEventType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'league', label: 'League' },
  { value: 'tournament', label: 'Tournament' },
  { value: 'class', label: 'Class' },
  { value: 'open_play', label: 'Open Play' },
];

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'data'; events: NearbyEvent[] }
  | { kind: 'no-zip' }
  | { kind: 'zip-not-found' }
  | { kind: 'error'; message: string };

/**
 * "Events near you" section for the signed-in user's dashboard.
 *
 * Uses the user's profile zip as the search origin. Filter controls for
 * distance (default 10mi) and activity type. Calls the findNearbyEvents
 * server action on mount and whenever a filter changes.
 *
 * Empty states:
 *   - User has no zip in profile → prompt to add it
 *   - User's zip isn't in the coordinates table → "we don't know that zip"
 *   - No events matched → "no public events nearby, try a wider radius"
 */
export default function EventsNearYou() {
  const [maxMiles, setMaxMiles] = useState<number>(10);
  const [type, setType] = useState<NearbyEventType>('all');
  const [state, setState] = useState<LoadState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const { findNearbyEvents } = await import('@/app/actions/discovery');
        const res = await findNearbyEvents({ maxMiles, type });
        if (cancelled) return;
        if (!res.ok) {
          if (res.error === 'NO_ZIP') setState({ kind: 'no-zip' });
          else if (res.error === 'ZIP_NOT_FOUND') setState({ kind: 'zip-not-found' });
          else setState({ kind: 'error', message: res.error });
          return;
        }
        setState({ kind: 'data', events: res.data });
      } catch (e: any) {
        if (cancelled) return;
        setState({ kind: 'error', message: e?.message || 'Failed to load.' });
      }
    })();
    return () => { cancelled = true; };
  }, [maxMiles, type]);

  return (
    <section>
      <header className="mb-5">
        <h2 className="font-display text-3xl">Events near you</h2>
        <p className="text-xs text-ink/50 italic mt-1">
          Public events from public clubs in your area.
        </p>
      </header>

      {/* Filters */}
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
      </div>

      {/* Body */}
      {state.kind === 'idle' || state.kind === 'loading' ? (
        <p className="text-ink/40 italic text-sm">Looking for events…</p>
      ) : state.kind === 'no-zip' ? (
        <div className="tile-border p-5">
          <p className="text-sm text-ink/70 mb-3">
            Add your ZIP code to your profile to discover events near you.
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
      ) : state.events.length === 0 ? (
        <div className="tile-border p-5">
          <p className="text-sm text-ink/70">
            No public events within {maxMiles} miles
            {type !== 'all' ? ` matching ${TYPE_OPTIONS.find((t) => t.value === type)!.label.toLowerCase()}` : ''}.
          </p>
          <p className="text-xs text-ink/50 italic mt-1">
            Try a wider radius or different filter.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-ink/10 border-y border-ink/10">
          {state.events.map((ev) => {
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
                      <div className="font-medium text-sm">
                        {ev.name}
                      </div>
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
      )}
    </section>
  );
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
