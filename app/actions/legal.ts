'use server';

import { headers } from 'next/headers';
import { getSupabase, getCallerUserId } from '@/lib/supabase';
import { LEGAL_VERSIONS, ALL_DOCUMENTS, type LegalDocument } from '@/lib/legal-docs';

type Result = { ok: true } | { ok: false; error: string };

/**
 * Record acceptance of all three legal documents in their current versions.
 * Called from the sign-in flow (new users) and the /accept-terms gate
 * (existing users on first sign-in after the legal documents were added or
 * updated).
 *
 * parentalConsentAttested is meaningful only when the user is under 18; the
 * caller passes it through from the consent checkbox.
 */
export async function recordLegalAcceptance(opts: {
  parentalConsentAttested: boolean;
}): Promise<Result> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const supabase = getSupabase();
  const hdrs = headers();
  // Pull IP from common proxy headers — Vercel uses x-forwarded-for / x-real-ip
  const ipAddress =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    hdrs.get('x-real-ip') ||
    null;
  const userAgent = hdrs.get('user-agent') || null;

  // Build one row per document. Insert all at once; if any conflict, the
  // unique constraint on (user_id, document, version) means we've already
  // recorded that acceptance — silently succeed.
  const rows = ALL_DOCUMENTS.map((doc: LegalDocument) => ({
    user_id: userId,
    document: doc,
    version: LEGAL_VERSIONS[doc],
    // Only meaningful on the terms acceptance; harmless on others.
    parental_consent_attested: doc === 'terms' ? opts.parentalConsentAttested : null,
    ip_address: ipAddress,
    user_agent: userAgent?.slice(0, 500) || null,
  }));

  // Upsert ignores rows that already exist (we just re-recorded the same
  // version). Errors only on real DB issues.
  const { error } = await supabase
    .from('legal_acceptances')
    .upsert(rows, { onConflict: 'user_id,document,version', ignoreDuplicates: true });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Check whether the calling user has accepted all current document versions.
 * Returns true if they have, false if any are missing. Used by the gate
 * client component to decide whether to redirect to /accept-terms.
 *
 * Returns null if not signed in.
 */
export async function checkLegalAcceptance(): Promise<boolean | null> {
  const userId = await getCallerUserId();
  if (!userId) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('legal_acceptances')
    .select('document, version')
    .eq('user_id', userId);

  if (error) return false;  // err on the side of re-prompting

  const accepted = new Set(((data as any[]) || []).map((r) => `${r.document}:${r.version}`));
  return ALL_DOCUMENTS.every((doc) => accepted.has(`${doc}:${LEGAL_VERSIONS[doc]}`));
}
