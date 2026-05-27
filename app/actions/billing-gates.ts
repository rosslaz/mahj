'use server';

// Thin server-action wrappers around lib/billing gate helpers, so the client
// can ask "can the current club do X?" before attempting the action.
//
// All return a discriminated union — { ok: true } or { ok: false, error }.
// The error message is what to show the user as part of an upgrade prompt.

import {
  canAddMember as gateAddMember,
  canCreateActivity as gateCreateActivity,
  canCreateHiddenEvent as gateCreateHiddenEvent,
  canSendEmailInvites as gateSendEmailInvites,
} from '@/lib/billing';

type Result = { ok: true } | { ok: false; error: string };

export async function checkCanAddMember(clubId: string): Promise<Result> {
  const r = await gateAddMember(clubId);
  return r.allowed ? { ok: true } : { ok: false, error: r.reason };
}

export async function checkCanCreateActivity(
  clubId: string,
  activityType: 'league' | 'tournament' | 'class' | 'open_play'
): Promise<Result> {
  const r = await gateCreateActivity(clubId, activityType);
  return r.allowed ? { ok: true } : { ok: false, error: r.reason };
}

export async function checkCanCreateHiddenEvent(clubId: string): Promise<Result> {
  const r = await gateCreateHiddenEvent(clubId);
  return r.allowed ? { ok: true } : { ok: false, error: r.reason };
}

export async function checkCanSendEmailInvites(clubId: string): Promise<Result> {
  const r = await gateSendEmailInvites(clubId);
  return r.allowed ? { ok: true } : { ok: false, error: r.reason };
}
