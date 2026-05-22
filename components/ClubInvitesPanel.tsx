'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';

const MAX_INVITES_PER_SEND = 20;

type Invite = {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked';
  welcome_message: string | null;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  invited_by: { name: string | null } | null;
};

/**
 * Club invites management. Used by owners and admins to:
 *   - Send email invites to one or more addresses
 *   - See the status of existing invites
 *   - Revoke pending invites
 *
 * Lives on the club admin page. Compact when collapsed; expands when the
 * user clicks "Invite people."
 */
export default function ClubInvitesPanel({ clubId, clubName }: { clubId: string; clubName: string }) {
  const supabase = getBrowserSupabase();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [emailsText, setEmailsText] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from('club_invites')
      .select('id, email, status, welcome_message, expires_at, created_at, accepted_at, invited_by:invited_by_user_id(name)')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .limit(100);
    setInvites(((data as any[]) || []) as Invite[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clubId]);

  // Parse the textarea into a clean email list. Accepts comma-, semicolon-,
  // newline-, or whitespace-separated emails. Returns just the parsed strings;
  // server does final validation.
  function parseEmails(raw: string): string[] {
    return raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const parsedEmails = parseEmails(emailsText);
  const tooMany = parsedEmails.length > MAX_INVITES_PER_SEND;

  async function handleSend() {
    if (parsedEmails.length === 0) {
      setSendError('Enter at least one email address.');
      return;
    }
    if (tooMany) {
      setSendError(`Maximum ${MAX_INVITES_PER_SEND} invites per send.`);
      return;
    }
    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const { createClubInvites } = await import('@/app/actions/club-invites');
      const res = await createClubInvites({
        clubId,
        emails: parsedEmails,
        welcomeMessage: welcomeMessage.trim() || undefined,
      });
      if (!res.ok) {
        setSendError(res.error);
        return;
      }
      const d = res.data!;
      const parts = [];
      if (d.created > 0) parts.push(`${d.created} invite${d.created === 1 ? '' : 's'} sent`);
      if (d.skippedAlreadyMember > 0) parts.push(`${d.skippedAlreadyMember} already in club`);
      if (d.skippedAlreadyInvited > 0) parts.push(`${d.skippedAlreadyInvited} already invited`);
      if (d.skippedInvalid > 0) parts.push(`${d.skippedInvalid} invalid`);
      if (d.emailsFailed > 0) parts.push(`${d.emailsFailed} failed to deliver`);
      setSendResult(parts.join(' · '));
      // Clear the form on success (keep welcome message for next batch)
      if (d.created > 0) {
        setEmailsText('');
        await load();
      }
    } catch (e: any) {
      setSendError(e?.message || 'Send failed.');
    } finally {
      setSending(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    if (!confirm('Revoke this invitation? The link will stop working.')) return;
    const { revokeClubInvite } = await import('@/app/actions/club-invites');
    const res = await revokeClubInvite(inviteId);
    if (!res.ok) {
      alert(res.error);
      return;
    }
    await load();
  }

  const pendingInvites = invites.filter((i) => i.status === 'pending' && new Date(i.expires_at) > new Date());
  const acceptedInvites = invites.filter((i) => i.status === 'accepted');
  const otherInvites = invites.filter((i) =>
    i.status === 'revoked' || (i.status === 'pending' && new Date(i.expires_at) <= new Date())
  );

  function statusLabel(invite: Invite): { text: string; color: string } {
    if (invite.status === 'accepted') return { text: 'Accepted', color: 'text-jade' };
    if (invite.status === 'revoked') return { text: 'Revoked', color: 'text-ink/40' };
    if (new Date(invite.expires_at) <= new Date()) return { text: 'Expired', color: 'text-ink/40' };
    return { text: 'Pending', color: 'text-cinnabar' };
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-display text-3xl">Invitations</h2>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="btn btn-jade text-sm">
            Invite people
          </button>
        )}
      </div>

      {showForm && (
        <div className="tile-border p-6 mb-6 space-y-4">
          <div>
            <label className="label">Email addresses</label>
            <textarea
              className="input min-h-[100px] font-mono text-sm"
              value={emailsText}
              onChange={(e) => setEmailsText(e.target.value)}
              placeholder="sarah@example.com&#10;tom@example.com&#10;..."
            />
            <p className="text-xs text-ink/40 italic mt-1">
              {parsedEmails.length > 0
                ? `${parsedEmails.length} email${parsedEmails.length === 1 ? '' : 's'}`
                : 'One per line, or separated by commas. Max 20 at a time.'}
              {tooMany && <span className="text-cinnabar"> · too many — split into batches.</span>}
            </p>
          </div>

          <div>
            <label className="label">
              Welcome message <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span>
            </label>
            <textarea
              className="input min-h-[80px]"
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder="A personal note from you to the invitees…"
              maxLength={2000}
            />
            <p className="text-xs text-ink/40 italic mt-1">
              Shown in the invite email below your name.
            </p>
          </div>

          {sendError && <p className="text-cinnabar text-sm">{sendError}</p>}
          {sendResult && <p className="text-jade text-sm">{sendResult}</p>}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleSend}
              disabled={sending || parsedEmails.length === 0 || tooMany}
              className="btn btn-jade"
            >
              {sending ? 'Sending…' : `Send ${parsedEmails.length || ''} invite${parsedEmails.length === 1 ? '' : 's'}`}
            </button>
            <button
              onClick={() => { setShowForm(false); setEmailsText(''); setSendError(null); setSendResult(null); }}
              className="btn btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-ink/40 italic">Loading invitations…</p>
      ) : (
        <>
          {pendingInvites.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs tracking-[0.2em] uppercase text-ink/50 mb-3">Pending ({pendingInvites.length})</h3>
              <ul className="divide-y divide-ink/10 border-y border-ink/10">
                {pendingInvites.map((inv) => {
                  const expiresInDays = Math.max(0, Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                  return (
                    <li key={inv.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{inv.email}</div>
                        <div className="text-xs text-ink/40 italic">
                          {inv.invited_by?.name ? `Sent by ${inv.invited_by.name}` : 'Sent'} · expires in {expiresInDays} day{expiresInDays === 1 ? '' : 's'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevoke(inv.id)}
                        className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
                      >
                        Revoke
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {acceptedInvites.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs tracking-[0.2em] uppercase text-ink/50 mb-3">Accepted ({acceptedInvites.length})</h3>
              <ul className="divide-y divide-ink/10 border-y border-ink/10">
                {acceptedInvites.slice(0, 20).map((inv) => {
                  const acceptedAgo = inv.accepted_at
                    ? new Date(inv.accepted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : null;
                  return (
                    <li key={inv.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink/70 truncate">{inv.email}</div>
                        {acceptedAgo && <div className="text-xs text-ink/40 italic">Joined {acceptedAgo}</div>}
                      </div>
                      <span className="text-xs tracking-[0.2em] uppercase text-jade">✓</span>
                    </li>
                  );
                })}
              </ul>
              {acceptedInvites.length > 20 && (
                <p className="text-xs text-ink/40 italic mt-2">
                  Showing 20 most recent. {acceptedInvites.length - 20} more.
                </p>
              )}
            </div>
          )}

          {otherInvites.length > 0 && (
            <details className="mb-6">
              <summary className="text-xs tracking-[0.2em] uppercase text-ink/40 cursor-pointer">
                Expired or revoked ({otherInvites.length})
              </summary>
              <ul className="divide-y divide-ink/10 border-y border-ink/10 mt-3">
                {otherInvites.slice(0, 30).map((inv) => {
                  const s = statusLabel(inv);
                  return (
                    <li key={inv.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="text-sm text-ink/50 truncate">{inv.email}</div>
                      <span className={`text-xs tracking-[0.15em] uppercase ${s.color}`}>{s.text}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          {invites.length === 0 && !showForm && (
            <p className="text-sm text-ink/50 italic">
              No invitations yet. Click &quot;Invite people&quot; to send your first invite.
            </p>
          )}
        </>
      )}
    </section>
  );
}
