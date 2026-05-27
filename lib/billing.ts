// Server-side helpers for checking subscription / Pro state.
//
// All gating decisions in the app should go through these functions —
// keeps the logic in one place so changing pricing tiers later means
// editing one file, not searching across the codebase.

import { createClient } from '@supabase/supabase-js';

// Free-tier limits. Tightening or relaxing these is a single-file change.
export const FREE_TIER_LIMITS = {
  maxMembers: 5,
  maxActivities: 1,
  // Max ADDITIONAL admins beyond the owner. Free clubs can promote 1
  // member to admin; the owner is the second authorizer by default.
  // Pro clubs have unlimited admins.
  maxAdmins: 1,
  allowedActivityTypes: ['league', 'open_play'] as const,
  publicAllowed: true,   // public listing is free (unlike most features)
  hiddenEventsAllowed: false,
  emailInvitesAllowed: false,
} as const;

// Standard trial length. Launch-promo clubs get more.
export const STANDARD_TRIAL_DAYS = 14;
export const LAUNCH_PROMO_TRIAL_DAYS = 30;
export const LAUNCH_PROMO_CAP = 10;

// Pro plan price strings — only used for human labels. The actual IDs
// come from Stripe via env vars (see api/billing routes).
export const PRO_MONTHLY_PRICE_LABEL = '$9/month';
export const PRO_ANNUAL_PRICE_LABEL = '$90/year';

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export type ClubBillingStatus = {
  isPro: boolean;
  plan: 'free' | 'pro_monthly' | 'pro_annual' | 'pro_grandfathered';
  status: 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'grandfathered';
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  isLaunchPromo: boolean;
  isGrandfathered: boolean;
};

/**
 * Get the current billing status of a club. Pulls from club_subscriptions.
 * If for some reason the row doesn't exist (shouldn't happen post-migration),
 * defaults to free.
 */
export async function getClubBillingStatus(clubId: string): Promise<ClubBillingStatus> {
  const supabase = svc();
  const { data } = await supabase
    .from('club_subscriptions')
    .select('plan, status, trial_ends_at, current_period_end, cancel_at_period_end, is_launch_promo')
    .eq('club_id', clubId)
    .maybeSingle();

  if (!data) {
    return {
      isPro: false,
      plan: 'free',
      status: 'free',
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      isLaunchPromo: false,
      isGrandfathered: false,
    };
  }

  const r = data as any;
  // Mirror the DB function club_is_pro() logic exactly. Single source of truth.
  const isPro =
    r.status === 'active' ||
    r.status === 'trialing' ||
    r.status === 'grandfathered' ||
    r.status === 'past_due' ||
    (r.status === 'canceled' && r.current_period_end && new Date(r.current_period_end) > new Date());

  return {
    isPro,
    plan: r.plan,
    status: r.status,
    trialEndsAt: r.trial_ends_at,
    currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: !!r.cancel_at_period_end,
    isLaunchPromo: !!r.is_launch_promo,
    isGrandfathered: r.status === 'grandfathered' || r.plan === 'pro_grandfathered',
  };
}

/**
 * Quick boolean check. Same logic as getClubBillingStatus().isPro but cheaper
 * call since it can use the DB function directly.
 */
export async function isClubPro(clubId: string): Promise<boolean> {
  const supabase = svc();
  const { data } = await supabase.rpc('club_is_pro', { p_club_id: clubId });
  return !!data;
}

// ============================================================
// Feature gating
//
// These are the ONLY functions that should make "can this club do X?"
// decisions. UI and server actions call these; they consult getClubBillingStatus.
// ============================================================

export type GateResult = { allowed: true } | { allowed: false; reason: string };

export async function canAddMember(clubId: string, currentCount?: number): Promise<GateResult> {
  const status = await getClubBillingStatus(clubId);
  if (status.isPro) return { allowed: true };

  const supabase = svc();
  const count = currentCount ?? (await supabase
    .rpc('club_member_count', { p_club_id: clubId })
    .then((r: any) => r.data ?? 0));

  if (count >= FREE_TIER_LIMITS.maxMembers) {
    return {
      allowed: false,
      reason: `Free clubs are limited to ${FREE_TIER_LIMITS.maxMembers} members. Upgrade to Pro for unlimited.`,
    };
  }
  return { allowed: true };
}

export async function canCreateActivity(
  clubId: string,
  activityType: 'league' | 'tournament' | 'class' | 'open_play'
): Promise<GateResult> {
  const status = await getClubBillingStatus(clubId);
  if (status.isPro) return { allowed: true };

  // Free tier: only league and open_play
  if (!FREE_TIER_LIMITS.allowedActivityTypes.includes(activityType as any)) {
    return {
      allowed: false,
      reason: `${activityType === 'tournament' ? 'Tournaments' : 'Classes'} require Pro. Upgrade to unlock.`,
    };
  }

  // Free tier: only 1 activity total
  const supabase = svc();
  const { data: count } = await supabase.rpc('club_activity_count', { p_club_id: clubId });
  if ((count ?? 0) >= FREE_TIER_LIMITS.maxActivities) {
    return {
      allowed: false,
      reason: `Free clubs are limited to ${FREE_TIER_LIMITS.maxActivities} activity. Upgrade to Pro for unlimited.`,
    };
  }
  return { allowed: true };
}

export async function canCreateHiddenEvent(clubId: string): Promise<GateResult> {
  const status = await getClubBillingStatus(clubId);
  if (status.isPro) return { allowed: true };
  return {
    allowed: false,
    reason: 'Hidden events require Pro. Upgrade to invite specific players to private events.',
  };
}

export async function canSendEmailInvites(clubId: string): Promise<GateResult> {
  const status = await getClubBillingStatus(clubId);
  if (status.isPro) return { allowed: true };
  return {
    allowed: false,
    reason: 'Email invitations require Pro. Upgrade to invite outside players via email.',
  };
}

/**
 * Check whether the club can promote another member to admin. The owner
 * is excluded from the count — they're always there regardless of tier.
 *
 * On Pro: always allowed.
 * On Free: at most maxAdmins (1) additional admins beyond the owner.
 */
export async function canPromoteAdmin(clubId: string): Promise<GateResult> {
  const status = await getClubBillingStatus(clubId);
  if (status.isPro) return { allowed: true };

  const supabase = svc();
  const { data: count } = await supabase.rpc('club_admin_count', { p_club_id: clubId });
  if ((count ?? 0) >= FREE_TIER_LIMITS.maxAdmins) {
    return {
      allowed: false,
      reason: `Free clubs are limited to ${FREE_TIER_LIMITS.maxAdmins} admin. Upgrade to Pro for unlimited.`,
    };
  }
  return { allowed: true };
}
