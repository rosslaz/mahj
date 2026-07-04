// Normalized Resend "from" header (2026-07 code-audit #6).
//
// RESEND_FROM_EMAIL may be a bare address ("hello@pungctual.com") or a full
// header ("Pungctual <hello@pungctual.com>"). Historically .env.example
// documented the FULL form while four call sites wrapped it again
// (`Pungctual <${fromEmail}>`) — nested angle brackets, Resend 422, every
// email dead the moment anyone set the env var as documented. Meanwhile
// send-invites.ts used the raw value inside its own display name, which
// broke in the opposite configuration. These helpers accept either form so
// no configuration choice can produce a malformed header again.

const DEFAULT_ADDRESS = 'no-reply@pungctual.com';

/** Bare from address, with any "Display Name <...>" wrapper stripped. */
export function resendFromAddress(): string {
  const raw = (process.env.RESEND_FROM_EMAIL || DEFAULT_ADDRESS).trim();
  const m = raw.match(/<([^<>]+)>/);
  return (m ? m[1] : raw).trim();
}

/** Full `Display Name <address>` from header. */
export function resendFrom(displayName: string = 'Pungctual'): string {
  return `${displayName} <${resendFromAddress()}>`;
}
