// Version stamps for legal documents. Bumped when a document materially
// changes. The acceptance gate checks these against legal_acceptances —
// users without a row for the current version are re-prompted.
//
// IMPORTANT: when bumping a version, the user-facing acceptance UI will
// re-trigger for every existing user on next visit. Don't bump for
// formatting/typo fixes; only when terms substantively change.
//
// History:
//   v1.0  — Initial release. Drafted by Ross + Claude pre-lawyer-review.
//   v2.0 (terms, privacy) — July 4, 2026: replaced the "Service is
//     currently free" sections with real billing terms (Pro pricing,
//     trials, Stripe processing, auto-renewal, cancellation, no-refunds,
//     club-deletion and ownership-transfer billing behavior), corrected
//     the Privacy description of what club members can actually see (the
//     roster shows profile email/phone/address to fellow members), added
//     Stripe to the processor list, and removed Sentry (no longer in the
//     stack). acceptable_use unchanged at 1.0, so returning users are
//     re-prompted for terms + privacy only. Still pre-lawyer-review.

export const LEGAL_VERSIONS = {
  terms: '2.0',
  privacy: '2.0',
  acceptable_use: '1.0',
} as const;

export type LegalDocument = keyof typeof LEGAL_VERSIONS;
export const ALL_DOCUMENTS: LegalDocument[] = ['terms', 'privacy', 'acceptable_use'];

// Last-modified dates for display in document footers
export const LEGAL_DATES = {
  terms: 'July 4, 2026',
  privacy: 'July 4, 2026',
  acceptable_use: 'May 21, 2026',
} as const;
