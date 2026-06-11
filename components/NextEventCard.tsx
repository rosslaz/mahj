'use client';

import Link from 'next/link';
import { useState } from 'react';
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
  | { kind: 'signed_up' }                  // approved signup
  | { kind: 'pending_signup' }             // request awaiting host approval (public events)
  | { kind: 'pending_invitation' }         // hidden-event invite awaiting response
  | { kind: 'not_signed_up' }              // member but hasn't signed up
  | { kind: 'none' };                      // not signed in / not a member

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

// =============================================================
// Inline signup affordance — shared between Next and Upcoming cards.
//
// The whole card is a Link to the event detail. The signup button sits
// *inside* that Link and uses stopPropagation to avoid drilling into the
// detail when the user just wants to one-click sign up.
//
// onSignup/onWithdraw are async callbacks owned by the host page (the
// dashboard) so it can refresh after the operation completes.
// =============================================================
function SignupAffordance({
  eventId,
  capacityMax,
  signupCount,
  personalStatus,
  onSignup,
  onWithdraw,
  size = 'lg',
}: {
  eventId: string;
  capacityMax: number;
  signupCount: number;
  personalStatus: PersonalStatus;
  onSignup?: (eventId: string) => Promise<void>;
  onWithdraw?: (eventId: string) => Promise<void>;
  size?: 'sm' | 'lg';
}) {
  const [busy, setBusy] = useState(false);

  if (personalStatus.kind === 'pending_invitation') {
    // Don't try to handle invite accept/decline inline — too much state. Card
    // already drills into the event detail (where the banner lives).
    return (
      <span className={`tracking-[0.15em] uppercase px-2.5 py-1 border bg-cinnabar/10 border-cinnabar/30 text-cinnabar text-xs`}>
        Tap to respond
      </span>
    );
  }

  if (personalStatus.kind === 'pending_signup') {
    return (
      <span className={`tracking-[0.15em] uppercase px-2.5 py-1 border bg-cinnabar/10 border-cinnabar/30 text-cinnabar text-xs`}>
        Pending approval
      </span>
    );
  }

  if (personalStatus.kind === 'signed_up' || personalStatus.kind === 'hosting') {
    // Already in. Show "you're in" / "hosting" badge plus a subtle Withdraw
    // affordance — except hosts shouldn't withdraw their own host signup
    // from the dashboard (they'd release host first from the event page).
    if (personalStatus.kind === 'hosting' || !onWithdraw) {
      return (
        <span className={`tracking-[0.15em] uppercase px-2.5 py-1 border ${
          personalStatus.kind === 'hosting'
            ? 'bg-gold/10 border-gold/40 text-gold'
            : 'bg-jade/10 border-jade/40 text-jade'
        } text-xs`}>
          {personalStatus.kind === 'hosting' ? "You're hosting" : "You're in"}
        </span>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <span className={`tracking-[0.15em] uppercase px-2.5 py-1 border bg-jade/10 border-jade/40 text-jade text-xs`}>
          You&apos;re in
        </span>
        <button
          type="button"
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (busy || !onWithdraw) return;
            setBusy(true);
            try { await onWithdraw(eventId); } finally { setBusy(false); }
          }}
          disabled={busy}
          className="text-xs tracking-[0.15em] uppercase text-ink/60 hover:text-cinnabar disabled:opacity-50 p-2.5 -m-2.5"
        >
          {busy ? '…' : 'Withdraw'}
        </button>
      </div>
    );
  }

  // not_signed_up — member who can self-signup
  if (personalStatus.kind === 'not_signed_up') {
    const isFull = signupCount >= capacityMax;
    if (!onSignup) {
      // No handler wired (e.g. club home page) — show a passive "Not signed up"
      // chip that prompts the user to drill in.
      return (
        <span className={`tracking-[0.15em] uppercase px-2.5 py-1 border bg-cinnabar/10 border-cinnabar/30 text-cinnabar text-xs`}>
          Not signed up
        </span>
      );
    }
    if (isFull) {
      return (
        <span className={`tracking-[0.15em] uppercase px-2.5 py-1 border border-ink/15 text-ink/60 text-xs`}>
          Full
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (busy) return;
          setBusy(true);
          try { await onSignup(eventId); } finally { setBusy(false); }
        }}
        disabled={busy}
        className={`tracking-[0.15em] uppercase px-4 py-2.5 min-h-[44px] bg-jade text-bone hover:bg-jade/90 disabled:opacity-50 border border-jade transition-colors text-xs`}
      >
        {busy ? 'Signing up…' : 'Sign me up'}
      </button>
    );
  }

  return null;
}

export function NextEventCard({
  night,
  eventBasePath,
  personalStatus = { kind: 'none' },
  leagueName,
  onSignup,
  onWithdraw,
}: {
  night: NextEventNight;
  eventBasePath: string;
  personalStatus?: PersonalStatus;
  leagueName?: string;
  onSignup?: (eventId: string) => Promise<void>;
  onWithdraw?: (eventId: string) => Promise<void>;
  slug?: string;  // legacy
}) {
  const status = nightStatusBadge(night);
  const capacityMax = night.num_tables * 5;
  const signupCount = night.signup_count ?? 0;

  return (
    <Link
      href={`${eventBasePath}/${night.id}`}
      className="block tile-border p-8 md:p-10 hover:border-cinnabar/40 transition-colors fade-up"
    >
      {leagueName && (
        <div className="text-xs tracking-[0.3em] uppercase text-jade mb-3">{leagueName}</div>
      )}
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-4">
        <div className="text-xs tracking-[0.25em] uppercase text-cinnabar">
          {new Date(night.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          {night.start_time && <span className="ml-3 text-ink/65">· {formatTime12(night.start_time)}</span>}
        </div>
        <span className={`text-xs tracking-[0.2em] uppercase px-3 py-1 border ${statusChipClass(status.tone)}`}>
          {status.label}
        </span>
      </div>
      <div className="font-display text-4xl md:text-6xl leading-tight mb-3">{night.name}</div>
      <div className="text-base text-ink/70 mb-4 italic">
        {night.host ? <>Hosted by <strong className="not-italic">{night.host.name}</strong></> : <span className="text-cinnabar/80">Awaiting a host</span>}
      </div>
      <div className="flex items-center justify-between text-sm pt-4 border-t border-ink/10 text-ink/60 gap-3 flex-wrap">
        <span>{night.num_tables} table{night.num_tables === 1 ? '' : 's'} · {signupCount}/{capacityMax} signed up · {night.games_planned} games</span>
        <SignupAffordance
          eventId={night.id}
          capacityMax={capacityMax}
          signupCount={signupCount}
          personalStatus={personalStatus}
          onSignup={onSignup}
          onWithdraw={onWithdraw}
          size="lg"
        />
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
  onSignup,
  onWithdraw,
}: {
  night: NextEventNight;
  eventBasePath: string;
  index?: number;
  leagueName?: string;
  personalStatus?: PersonalStatus;
  onSignup?: (eventId: string) => Promise<void>;
  onWithdraw?: (eventId: string) => Promise<void>;
  slug?: string;
}) {
  const status = nightStatusBadge(night);
  const capacityMax = night.num_tables * 5;
  const signupCount = night.signup_count ?? 0;
  return (
    <Link
      href={`${eventBasePath}/${night.id}`}
      className="tile-border p-5 hover:border-cinnabar/40 transition-colors fade-up flex flex-col"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      {leagueName && (
        <div className="text-xs tracking-[0.25em] uppercase text-jade mb-1.5">{leagueName}</div>
      )}
      <div className="text-xs tracking-[0.2em] uppercase text-ink/60 mb-2">
        {new Date(night.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        {night.start_time && <span className="ml-2">· {formatTime12(night.start_time)}</span>}
      </div>
      <div className="font-display text-xl mb-1 line-clamp-2">{night.name}</div>
      <div className="text-xs text-ink/65 mb-3 italic">
        {night.host ? <>Hosted by {night.host.name}</> : <span className="text-cinnabar/80">Host needed</span>}
      </div>
      <div className="mt-auto flex items-center justify-between pt-3 border-t border-ink/10 gap-2 flex-wrap">
        <span className="text-xs text-ink/65">{signupCount}/{capacityMax}</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <span className={`text-xs tracking-[0.15em] uppercase px-2 py-0.5 border ${statusChipClass(status.tone)}`}>
            {status.label}
          </span>
          <SignupAffordance
            eventId={night.id}
            capacityMax={capacityMax}
            signupCount={signupCount}
            personalStatus={personalStatus}
            onSignup={onSignup}
            onWithdraw={onWithdraw}
            size="sm"
          />
        </div>
      </div>
    </Link>
  );
}
