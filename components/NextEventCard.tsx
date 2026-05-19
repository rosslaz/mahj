'use client';

import Link from 'next/link';
import { formatTime12 } from '@/lib/game-utils';

export type NextEventNight = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  num_tables: number;
  games_planned: number;
  status: string;
  signup_count?: number;
  assigned?: boolean;
  host?: { id: string; name: string } | null;
};

export type PersonalStatus =
  | { kind: 'hosting' }
  | { kind: 'signed_up' }
  | { kind: 'not_signed_up' }
  | { kind: 'none' };  // not signed in / not a member

export function nightStatusBadge(n: NextEventNight): { label: string; tone: 'warn' | 'go' | 'ready' | 'over' } {
  const capMin = n.num_tables * 4;
  const capMax = n.num_tables * 5;
  const signups = n.signup_count ?? 0;
  if (n.assigned) return { label: 'Tables assigned', tone: 'go' };
  if (!n.host) return { label: 'Host needed', tone: 'warn' };
  if (signups > capMax) return { label: `${signups - capMax} over capacity`, tone: 'over' };
  if (signups >= capMin) return { label: 'Ready — assign tables', tone: 'ready' };
  return { label: `${capMin - signups} more needed`, tone: 'warn' };
}

export function statusChipClass(tone: 'warn' | 'go' | 'ready' | 'over'): string {
  switch (tone) {
    case 'warn':  return 'bg-cinnabar/10 border-cinnabar/30 text-cinnabar';
    case 'ready': return 'bg-bamboo/10 border-bamboo/40 text-bamboo';
    case 'go':    return 'bg-jade/10 border-jade/30 text-jade';
    case 'over':  return 'bg-gold/10 border-gold/40 text-gold';
  }
}

export function NextEventCard({
  night,
  eventBasePath,           // required: e.g. `/c/lazar/a/league/events`
  personalStatus = { kind: 'none' },
  leagueName,
}: {
  night: NextEventNight;
  eventBasePath: string;
  personalStatus?: PersonalStatus;
  leagueName?: string;          // optional eyebrow — used when shown across activities
  // legacy: leave `slug` accepted but unused so old call-sites don't error
  slug?: string;
}) {
  const status = nightStatusBadge(night);

  let personalChip: { label: string; tone: 'go' | 'warn' | 'host' } | null = null;
  if (personalStatus.kind === 'hosting') {
    personalChip = { label: 'You\'re hosting', tone: 'host' };
  } else if (personalStatus.kind === 'signed_up') {
    personalChip = { label: 'You\'re in', tone: 'go' };
  } else if (personalStatus.kind === 'not_signed_up') {
    personalChip = { label: 'Not signed up', tone: 'warn' };
  }

  return (
    <Link
      href={`${eventBasePath}/${night.id}`}
      className="block tile-border p-8 md:p-10 hover:border-cinnabar/40 transition-colors fade-up"
    >
      {leagueName && (
        <div className="text-[10px] tracking-[0.3em] uppercase text-jade mb-3">{leagueName}</div>
      )}
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-4">
        <div className="text-xs tracking-[0.25em] uppercase text-cinnabar">
          {new Date(night.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          {night.start_time && <span className="ml-3 text-ink/50">· {formatTime12(night.start_time)}</span>}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {personalChip && (
            <span className={`text-[10px] tracking-[0.2em] uppercase px-3 py-1 border ${
              personalChip.tone === 'go' ? 'bg-jade/10 border-jade/40 text-jade' :
              personalChip.tone === 'host' ? 'bg-gold/10 border-gold/40 text-gold' :
              'bg-cinnabar/10 border-cinnabar/30 text-cinnabar'
            }`}>
              {personalChip.label}
            </span>
          )}
          <span className={`text-[10px] tracking-[0.2em] uppercase px-3 py-1 border ${statusChipClass(status.tone)}`}>
            {status.label}
          </span>
        </div>
      </div>
      <div className="font-display text-4xl md:text-6xl leading-tight mb-3">{night.name}</div>
      <div className="text-base text-ink/70 mb-4 italic">
        {night.host ? <>Hosted by <strong className="not-italic">{night.host.name}</strong></> : <span className="text-cinnabar/80">Awaiting a host</span>}
      </div>
      <div className="flex items-center justify-between text-sm pt-4 border-t border-ink/10 text-ink/60">
        <span>{night.num_tables} table{night.num_tables === 1 ? '' : 's'}</span>
        <span>{night.signup_count ?? 0}/{night.num_tables * 5} signed up</span>
        <span>{night.games_planned} games</span>
      </div>
    </Link>
  );
}

export function UpcomingCard({
  night,
  eventBasePath,
  index = 0,
  leagueName,
  personalStatus = { kind: 'none' },
}: {
  night: NextEventNight;
  eventBasePath: string;
  index?: number;
  leagueName?: string;
  personalStatus?: PersonalStatus;
  slug?: string; // legacy, unused
}) {
  const status = nightStatusBadge(night);
  return (
    <Link
      href={`${eventBasePath}/${night.id}`}
      className="tile-border p-5 hover:border-cinnabar/40 transition-colors fade-up flex flex-col"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      {leagueName && (
        <div className="text-[10px] tracking-[0.25em] uppercase text-jade mb-1.5">{leagueName}</div>
      )}
      <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-2">
        {new Date(night.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        {night.start_time && <span className="ml-2">· {formatTime12(night.start_time)}</span>}
      </div>
      <div className="font-display text-xl mb-1 line-clamp-2">{night.name}</div>
      <div className="text-xs text-ink/50 mb-3 italic">
        {night.host ? <>Hosted by {night.host.name}</> : <span className="text-cinnabar/80">Host needed</span>}
      </div>
      <div className="mt-auto flex items-center justify-between pt-3 border-t border-ink/10 gap-2">
        <span className="text-xs text-ink/50">{night.signup_count ?? 0}/{night.num_tables * 5}</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {personalStatus.kind === 'signed_up' && (
            <span className="text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border bg-jade/10 border-jade/40 text-jade">You're in</span>
          )}
          {personalStatus.kind === 'hosting' && (
            <span className="text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border bg-gold/10 border-gold/40 text-gold">Hosting</span>
          )}
          <span className={`text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border ${statusChipClass(status.tone)}`}>
            {status.label}
          </span>
        </div>
      </div>
    </Link>
  );
}
