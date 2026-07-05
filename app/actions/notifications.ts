'use server';

import { getCallerUserId } from '@/lib/supabase';
import {
  dispatchSignupCreated,
  dispatchSignupWithdrawn,
  dispatchSignupApproved,
  dispatchPlayerRemovedByHost,
  dispatchPlayerAddedByHost,
  dispatchClubMemberJoined,
} from '@/lib/notifications';

// Each notify* function resolves the caller's users.id and delegates to the
// appropriate dispatcher in lib/notifications. We use the shared
// getCallerUserId helper which filters by auth.uid() explicitly — a previous
// version that relied on RLS-only filtering returned the wrong user's row
// when co-members were visible through RLS.

// All of these return void — the client doesn't need a response. Errors are
// already swallowed inside the dispatcher level (notification failures
// shouldn't bubble up).

/**
 * Call after creating a night_signups row. Notifies the host.
 */
export async function notifySignupCreated(signupId: string, status: 'approved' | 'pending'): Promise<void> {
  const actorUserId = await getCallerUserId();
  if (!actorUserId) return;
  try {
    await dispatchSignupCreated({ signupId, actorUserId, status });
  } catch (e) {
    console.error('[notifySignupCreated]', e);
  }
}

/**
 * Call after deleting a night_signups row due to self-withdrawal. Caller
 * must pass the eventId and the user_id who was on the signup (since the
 * row is already gone by the time we call this).
 */
export async function notifySignupWithdrawn(eventId: string, withdrawnUserId: string): Promise<void> {
  const actorUserId = await getCallerUserId();
  if (!actorUserId) return;
  try {
    await dispatchSignupWithdrawn({ eventId, withdrawnUserId, actorUserId });
  } catch (e) {
    console.error('[notifySignupWithdrawn]', e);
  }
}

/**
 * Call after host approves a pending signup. Notifies the approved player.
 */
export async function notifySignupApproved(signupId: string): Promise<void> {
  const actorUserId = await getCallerUserId();
  if (!actorUserId) return;
  try {
    await dispatchSignupApproved({ signupId, actorUserId });
  } catch (e) {
    console.error('[notifySignupApproved]', e);
  }
}

/**
 * Call after host removes a player from the event (the × on a player chip).
 */
export async function notifyPlayerRemoved(eventId: string, removedUserId: string): Promise<void> {
  const actorUserId = await getCallerUserId();
  if (!actorUserId) return;
  try {
    await dispatchPlayerRemovedByHost({ eventId, removedUserId, actorUserId });
  } catch (e) {
    console.error('[notifyPlayerRemoved]', e);
  }
}

/**
 * Call after host adds a player to the event (+ Add player flow).
 */
export async function notifyPlayerAdded(eventId: string, addedUserId: string): Promise<void> {
  const actorUserId = await getCallerUserId();
  if (!actorUserId) return;
  try {
    await dispatchPlayerAddedByHost({ eventId, addedUserId, actorUserId });
  } catch (e) {
    console.error('[notifyPlayerAdded]', e);
  }
}

/**
 * Call after a new member joins a club (via join code).
 */
export async function notifyClubMemberJoined(clubId: string, newMemberUserId: string): Promise<void> {
  // Caller's identity is irrelevant for this one — the new member's identity
  // is the trigger. Still, verify they're authenticated.
  const actorUserId = await getCallerUserId();
  if (!actorUserId) return;
  try {
    await dispatchClubMemberJoined({ clubId, newMemberUserId });
  } catch (e) {
    console.error('[notifyClubMemberJoined]', e);
  }
}

// (notifyClubMemberLeft was deleted in the 2026-07 audit #17 purge — it was
// fully built but called by NOTHING: admin-removes deliberately don't notify,
// and there's no self-service leave-club. If leave-club ships post-beta,
// resurrect the pair from git history: this action + dispatchClubMemberLeft
// in lib/notifications.ts, deleted the same day.)
