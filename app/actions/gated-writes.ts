'use server';

// Gated writes: server actions that re-check a free-tier gate AND perform the
// write in a single server round-trip, using the service-role client.
//
// Why this exists (H2): the client pages used to gate by calling a
// check*-style server action and then, if it passed, doing a direct PostgREST
// insert from the browser. The gate and the write were two separate calls
// with nothing binding them — a user could skip the check and insert directly,
// because RLS on these tables doesn't know anything about subscription state.
//
// These actions close that gap at the app layer. The DB triggers added in
// migration 0026 are the authoritative backstop; these give a friendly,
// specific error message and keep the happy path a single call.
//
// Each action:
//   1. Resolves + authorizes the caller (owner/admin where required)
//   2. Re-checks the relevant gate from lib/billing
//   3. Performs the insert with the service client
// If the DB trigger ALSO rejects (e.g. a race created a 2nd activity between
// our count and the insert), we surface that too.

import { getServiceSupabase } from '@/lib/supabase-service';
import { getCallerUserId } from '@/lib/supabase';
import { canCreateActivity, canAddMember } from '@/lib/billing';
import { isValidSlug } from '@/lib/slug';

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

// Map the Postgres check_violation our triggers raise into a clean message.
// Trigger messages are already human-readable, so we just pass them through;
// this helper exists so callers don't leak raw "new row violates..." text.
function friendlyDbError(err: { code?: string; message?: string } | null): string {
  if (!err) return 'Write failed.';
  // 23514 = check_violation (our triggers use this errcode)
  if (err.code === '23514' && err.message) return err.message;
  return err.message || 'Write failed.';
}

async function callerRoleInClub(clubId: string, userId: string): Promise<string | null> {
  const svc = getServiceSupabase();
  const { data } = await svc
    .from('club_members')
    .select('role')
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as any)?.role ?? null;
}

// ============================================================
// Activity creation (gated: type + count)
// ============================================================

export async function createActivityGated(opts: {
  clubId: string;
  slug: string;
  name: string;
  description?: string | null;
  type: 'league' | 'tournament' | 'class' | 'open_play';
  isPublic: boolean;
}): Promise<Result<{ id: string; slug: string }>> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  // Authz: owner/admin only (mirrors the activities INSERT RLS policy).
  const role = await callerRoleInClub(opts.clubId, userId);
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Only club admins can add activities.' };
  }

  if (!opts.name?.trim()) return { ok: false, error: 'Activity name is required.' };
  if (!isValidSlug(opts.slug)) return { ok: false, error: 'Invalid activity slug.' };

  // Re-check the gate server-side.
  const gate = await canCreateActivity(opts.clubId, opts.type);
  if (!gate.allowed) return { ok: false, error: gate.reason };

  const svc = getServiceSupabase();
  const { data, error } = await svc
    .from('activities')
    .insert({
      club_id: opts.clubId,
      slug: opts.slug,
      name: opts.name.trim(),
      description: opts.description?.trim() || null,
      type: opts.type,
      is_public: opts.isPublic,
    })
    .select('id, slug')
    .single();

  if (error || !data) return { ok: false, error: friendlyDbError(error) };
  return { ok: true, data: { id: (data as any).id, slug: (data as any).slug } };
}

// ============================================================
// Join a club by code (gated: member cap)
// ============================================================

export async function joinClubByCodeGated(rawCode: string): Promise<
  Result<{ clubId: string; clubSlug: string; alreadyMember: boolean }>
> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const cleaned = (rawCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 4) return { ok: false, error: 'Enter a valid code.' };

  const svc = getServiceSupabase();

  // Look up the club by join code (service role bypasses the clubs RLS that
  // would otherwise hide a private club from a non-member). Possession of the
  // exact code is the authorization. Mirrors lookup_club_by_join_code.
  const normalized = cleaned;
  const { data: clubRow } = await svc
    .from('clubs')
    .select('id, slug, deleted_at')
    .eq('join_code', normalized)
    .maybeSingle();
  if (!clubRow || (clubRow as any).deleted_at) {
    return { ok: false, error: 'No club found for that code.' };
  }
  const clubId = (clubRow as any).id as string;
  const clubSlug = (clubRow as any).slug as string;

  // Already a member? Idempotent success.
  const { data: existing } = await svc
    .from('club_members')
    .select('id')
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) {
    return { ok: true, data: { clubId, clubSlug, alreadyMember: true } };
  }

  // Re-check the member-cap gate server-side.
  const gate = await canAddMember(clubId);
  if (!gate.allowed) {
    return { ok: false, error: gate.reason + ' Ask the club owner to upgrade to Pro.' };
  }

  const { error: memErr } = await svc.from('club_members').insert({
    club_id: clubId,
    user_id: userId,
    role: 'member',
  });
  // 23505 = unique violation (raced into membership) → treat as success.
  if (memErr && memErr.code !== '23505') {
    return { ok: false, error: friendlyDbError(memErr) };
  }

  return { ok: true, data: { clubId, clubSlug, alreadyMember: false } };
}
