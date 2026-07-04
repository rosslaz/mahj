'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import { AddressFields, AddressFieldsValue } from '@/components/AddressFields';
import { validateZip } from '@/lib/address';
import { transferClubOwnership, deleteClubWithBilling } from '@/app/actions/club-lifecycle';

type AdminCandidate = {
  user_id: string;
  name: string;
  email: string;
};

export default function ClubSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(slug);
  const supabase = getBrowserSupabase();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [addr, setAddr] = useState<AddressFieldsValue>({ street: '', city: '', state: '', zip: '' });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [admins, setAdmins] = useState<AdminCandidate[]>([]);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferring, setTransferring] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!cb.club) return;
    setName(cb.club.name);
    setDescription(cb.club.description || '');
    setIsPublic(cb.club.is_public);
    setAddr({
      street: '',
      city: cb.club.city || '',
      state: cb.club.state || '',
      zip: cb.club.zip || '',
    });
  }, [cb.club]);

  useEffect(() => {
    if (!cb.club) return;
    (async () => {
      const { data } = await supabase
        .from('club_members')
        .select('user_id, role, user:user_id(name, email, deleted_at)')
        .eq('club_id', cb.club!.id)
        .eq('role', 'admin');
      const list: AdminCandidate[] = ((data as any[]) || [])
        .filter((r) => r.user && !r.user.deleted_at)
        .map((r) => ({ user_id: r.user_id, name: r.user.name, email: r.user.email }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setAdmins(list);
    })();
  }, [cb.club, supabase]);

  if (cb.loading || !cb.club) return null;
  if (!auth.email) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Owner Only</h1>
        <p className="text-ink/60 mb-6">Sign in to access settings.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }
  if (!cb.isOwner) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Owner Only</h1>
        <p className="text-ink/60 mb-6">Only the club owner can change settings.</p>
        <Link href={`/c/${slug}`} className="btn btn-ghost">← Club home</Link>
      </div>
    );
  }

  async function saveBasics(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaveMsg(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    if (isPublic) {
      if (!addr.city.trim() || !addr.state || !addr.zip.trim()) {
        setError('Public clubs require city, state, and ZIP.');
        return;
      }
      const zipErr = validateZip(addr.zip.trim());
      if (zipErr) { setError(zipErr); return; }
    }
    setSaving(true);
    const { error: updErr } = await supabase
      .from('clubs')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        is_public: isPublic,
        city: addr.city.trim() || null,
        state: addr.state || null,
        zip: addr.zip.trim() || null,
      })
      .eq('id', cb.club!.id);
    setSaving(false);
    if (updErr) { setError(updErr.message); return; }
    setSaveMsg('Saved.');
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function transferOwnership() {
    if (!transferTarget || !cb.club) return;
    const target = admins.find((a) => a.user_id === transferTarget);
    if (!target) return;
    if (!confirm(
      `Transfer ownership to ${target.name}? You will become an admin.\n\n` +
      `If this club has an active Pro subscription paid by you, it will be set to cancel at the end of the current billing period — you won't be charged again, and ${target.name} can subscribe with their own card.`
    )) return;
    setTransferring(true);
    // Single atomic RPC via server action (migration 0036). The old
    // client-side 3-step update never worked: cm_update's WITH CHECK
    // rejects setting role='owner' while clubs.owner_user_id still points
    // at the old owner, so step 1 always failed with 42501 — and even
    // reordered it wasn't atomic. The server action also winds down
    // billing (cancel_at_period_end + detach the old owner's Stripe
    // customer so the new owner can't open their portal).
    const res = await transferClubOwnership(cb.club.id, target.user_id);
    if (!res.ok) {
      setError('Transfer failed: ' + res.error);
      setTransferring(false);
      return;
    }
    alert(res.warning ? `Ownership transferred. Note: ${res.warning}` : 'Ownership transferred.');
    router.push(`/c/${slug}`);
  }

  async function deleteClub() {
    setDeleting(true);
    // Server action: cancels any active Stripe subscription FIRST, and
    // aborts the delete if that fails — better a live club the owner can
    // retry than a deleted ghost that keeps charging their card. The old
    // direct update here left subscriptions billing forever.
    const res = await deleteClubWithBilling(cb.club!.id);
    setDeleting(false);
    if (!res.ok) { alert(res.error); return; }
    router.push('/clubs');
  }

  return (
    <div className="space-y-12">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">Club Settings</p>
        <h1 className="font-display text-5xl md:text-6xl">Settings</h1>
        <p className="mt-2 text-ink/60 italic">Owner-only. Tread carefully.</p>
      </header>

      <form onSubmit={saveBasics} className="tile-border p-7 space-y-5">
        <h2 className="font-display text-2xl">Basics</h2>

        <div>
          <label className="label">Club Name <span className="text-cinnabar">*</span></label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div>
          <label className="label">Description <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span></label>
          <textarea
            className="input min-h-[80px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="accent-jade w-4 h-4 mt-1"
            />
            <span>
              <span className="block text-sm font-medium">Public club</span>
              <span className="text-xs text-ink/50 italic">Discoverable by anyone. Members still join via code or invite.</span>
            </span>
          </label>
        </div>

        {isPublic && (
          <div className="pl-7 pt-2 border-l-2 border-jade/30">
            <AddressFields
              value={addr}
              onChange={setAddr}
              mode="public_club"
            />
          </div>
        )}

        {error && <p className="text-cinnabar text-sm">{error}</p>}
        {saveMsg && <p className="text-jade text-sm">{saveMsg}</p>}

        <button className="btn btn-jade" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
      </form>

      <section className="tile-border p-7 space-y-4">
        <h2 className="font-display text-2xl">Transfer Ownership</h2>
        <p className="text-sm text-ink/60">
          Hand the club over to another admin. You'll become an admin.
        </p>
        {admins.length === 0 ? (
          <p className="text-ink/50 italic text-sm">
            No admins yet. Promote someone to admin on the <Link href={`/c/${slug}/admin`} className="underline hover:text-cinnabar">Admin</Link> tab first.
          </p>
        ) : (
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="label">New Owner</label>
              <select className="input" value={transferTarget} onChange={(e) => setTransferTarget(e.target.value)}>
                <option value="">— Select an admin —</option>
                {admins.map((a) => (
                  <option key={a.user_id} value={a.user_id}>{a.name} · {a.email}</option>
                ))}
              </select>
            </div>
            <button
              onClick={transferOwnership}
              disabled={!transferTarget || transferring}
              className="btn"
            >
              {transferring ? 'Transferring…' : 'Transfer'}
            </button>
          </div>
        )}
      </section>

      <section className="border border-cinnabar/30 bg-cinnabar/5 p-7 space-y-4">
        <h2 className="font-display text-2xl text-cinnabar">Danger Zone</h2>
        <div>
          <p className="font-medium mb-1">Delete club</p>
          <p className="text-sm text-ink/60 mb-4">
            Soft-deletes the club and all of its activities, and immediately cancels any active Pro subscription. The club is recoverable with database access; the subscription is not. Member history is preserved.
          </p>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="btn" style={{ background: '#9c2c1f', color: '#f5efe6' }}>
              Delete Club
            </button>
          ) : (
            <div className="flex gap-3 flex-wrap items-center">
              <span className="text-sm text-ink/70">Really delete <strong>{cb.club.name}</strong>?</span>
              <button onClick={deleteClub} disabled={deleting} className="btn" style={{ background: '#9c2c1f', color: '#f5efe6' }}>
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="btn btn-ghost">Cancel</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
