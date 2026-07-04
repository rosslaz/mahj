'use server';

// Club lifecycle server actions: ownership transfer and club deletion,
// both with correct Stripe billing behavior (code-audit #1 and #3).
//
// Both actions are publicly invokable endpoints (that's what server actions
// are), so each authorizes internally:
//   - transferClubOwnership delegates authz to the transfer_club_ownership
//     RPC (migration 0036), which checks current_user_id() == clubs.owner —
//     so the RPC MUST be called with the caller's Supabase client, not the
//     service role (auth.uid() would be null and the RPC would reject).
//   - deleteClubWithBilling checks caller == owner itself, then uses the
//     service role for the billing + soft-delete writes.

import { getSupabase, getCallerUserId } from '@/lib/supabase';
import { getServiceSupabase } from '@/lib/supabase-service';
import {
  cancelClubSubscriptionImmediately,
  windDownClubSubscriptionForTransfer,
} from '@/lib/stripe-cancel';

export type LifecycleResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/**
 * Transfer club ownership to an existing admin, atomically (RPC), then wind
 * down billing: the old owner's Stripe sub is set to cancel_at_period_end
 * (they're never charged again; the club keeps Pro through the paid period)
 * and their Stripe customer is detached so the new owner can't open the
 * Customer Portal against the previous owner's card. The new owner can
 * re-subscribe from the billing page whenever they like.
 */
export async function transferClubOwnership(
  clubId: string,
  newOwnerUserId: string,
): Promise<LifecycleResult> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  // Ownership change first (it's the user's actual intent); billing cleanup
  // second. If billing cleanup then fails, the transfer stands and we
  // surface a warning — and because the wind-down detaches the customer id
  // BEFORE touching Stripe, a Stripe failure still can't expose the old
  // owner's portal to the new owner.
  const supabase = getSupabase();
  const { error: rpcErr } = await supabase.rpc('transfer_club_ownership', {
    p_club_id: clubId,
    p_new_owner_user_id: newOwnerUserId,
  });
  if (rpcErr) return { ok: false, error: rpcErr.message };

  const res = await windDownClubSubscriptionForTransfer(
    getServiceSupabase(),
    clubId,
    'transfer-ownership',
  );
  if (!res.ok) return { ok: true, warning: res.error };
  return { ok: true, warning: res.warning };
}

/**
 * Soft-delete a club, canceling any active Stripe subscription FIRST.
 * If the Stripe cancellation fails, the delete is ABORTED — better a live
 * club the owner can retry than a soft-deleted ghost that keeps charging
 * their card with no UI left to manage it from.
 */
export async function deleteClubWithBilling(clubId: string): Promise<LifecycleResult> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const svc = getServiceSupabase();
  const { data: club, error: clubErr } = await svc
    .from('clubs')
    .select('id, owner_user_id, deleted_at')
    .eq('id', clubId)
    .maybeSingle();
  if (clubErr) return { ok: false, error: clubErr.message };
  if (!club) return { ok: false, error: 'Club not found.' };
  if ((club as any).owner_user_id !== userId) {
    return { ok: false, error: 'Only the club owner can delete the club.' };
  }
  if ((club as any).deleted_at) return { ok: true }; // idempotent

  const cancel = await cancelClubSubscriptionImmediately(svc, clubId, 'delete-club');
  if (!cancel.ok) {
    return {
      ok: false,
      error:
        'Could not cancel the Pro subscription: ' +
        cancel.error +
        ' The club was NOT deleted — try again, or contact support.',
    };
  }

  const { error: delErr } = await svc
    .from('clubs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', clubId);
  if (delErr) {
    return {
      ok: false,
      error:
        delErr.message +
        (cancel.hadStripeSub ? ' (Note: the Pro subscription was already canceled.)' : ''),
    };
  }

  return { ok: true };
}
