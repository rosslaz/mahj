'use server';

import { getSupabase } from '@/lib/supabase';
import {
  dispatchSignupCreated,
  dispatchSignupWithdrawn,
  dispatchSignupApproved,
  dispatchPlayerRemovedByHost,
  dispatchPlayerAddedByHost,
  dispatchClubMemberJoined,
  dispatchClubMemberLeft,
} from '@/lib/notifications';

// Resolves the calling user's users.id (NOT auth.uid). Returns null if not signed in.
async function getCallerId(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase.from('users').select('id').limit(1).maybeSingle();
  return (data as any)?.id ?? null;
}

// All of these return void — the client doesn't need a response. Errors are
// already swallowed inside the dispatcher level (notification failures
// shouldn't bubble up).

/**
 * Call after creating a night_signups row. Notifies the host.
 */
export async function notifySignupCreated(signupId: string, status: 'approved' | 'pending'): Promise<void> {
  const actorUserId = await getCallerId();
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
  const actorUserId = await getCallerId();
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
  const actorUserId = await getCallerId();
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
  const actorUserId = await getCallerId();
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
  const actorUserId = await getCallerId();
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
  const actorUserId = await getCallerId();
  if (!actorUserId) return;
  try {
    await dispatchClubMemberJoined({ clubId, newMemberUserId });
  } catch (e) {
    console.error('[notifyClubMemberJoined]', e);
  }
}

/**
 * Call after a member leaves or is removed from a club. The dispatcher
 * decides whether to notify based on actor vs. left user.
 */
export async function notifyClubMemberLeft(clubId: string, leftUserId: string): Promise<void> {
  const actorUserId = await getCallerId();
  if (!actorUserId) return;
  try {
    await dispatchClubMemberLeft({ clubId, leftUserId, actorUserId });
  } catch (e) {
    console.error('[notifyClubMemberLeft]', e);
  }
}
