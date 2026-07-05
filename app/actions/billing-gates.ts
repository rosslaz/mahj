'use server';

// Thin server-action wrappers around lib/billing gate helpers, so the client
// can ask "can the current club do X?" before attempting the action.
//
// All return a discriminated union — { ok: true } or { ok: false, error }.
// The error message is what to show the user as part of an upgrade prompt.

import { createClient } from '@supabase/supabase-js';
import {
  canCreateHiddenEvent as gateCreateHiddenEvent,
  canPromoteAdmin as gatePromoteAdmin,
  getClubBillingStatus,
  FREE_TIER_LIMITS,
} from '@/lib/billing';

type Result = { ok: true } | { ok: false; error: string };

// (checkCanAddMember / checkCanCreateActivity / checkCanSendEmailInvites were
// deleted in the 2026-07 audit #17 purge — zero callers. Those gates run
// through lib/billing directly (server actions) or gated-writes; only the
// page-level pre-checks below are consumed from this file.)

export async function checkCanCreateHiddenEvent(clubId: string): Promise<Result> {
  const r = await gateCreateHiddenEvent(clubId);
  return r.allowed ? { ok: true } : { ok: false, error: r.reason };
}

export async function checkCanPromoteAdmin(clubId: string): Promise<Result> {
  const r = await gatePromoteAdmin(clubId);
  return r.allowed ? { ok: true } : { ok: false, error: r.reason };
}

/**
 * For the New Activity page: return everything the UI needs to decide
 * what to show *before* the user fills out the form. Lets us:
 *   - hide the page entirely when at the activity-count cap (free tier)
 *   - mark Tournament and Class as Pro-only on the type picker
 *
 * Returns the club's Pro state plus the granular allowed-types info.
 */
export async function getNewActivityGateState(clubId: string): Promise<{
  isPro: boolean;
  atActivityCap: boolean;
  activityCap: number;
  allowedTypes: ('league' | 'tournament' | 'class' | 'open_play')[];
}> {
  const status = await getClubBillingStatus(clubId);
  if (status.isPro) {
    return {
      isPro: true,
      atActivityCap: false,
      activityCap: Number.POSITIVE_INFINITY,
      allowedTypes: ['league', 'tournament', 'class', 'open_play'],
    };
  }
  // Free tier: need to know how many activities exist
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(svcUrl, svcKey, { auth: { persistSession: false } });
  const { data: count } = await supabase.rpc('club_activity_count', { p_club_id: clubId });
  const activityCount = (count as number) ?? 0;
  return {
    isPro: false,
    atActivityCap: activityCount >= FREE_TIER_LIMITS.maxActivities,
    activityCap: FREE_TIER_LIMITS.maxActivities,
    allowedTypes: [...FREE_TIER_LIMITS.allowedActivityTypes],
  };
}
