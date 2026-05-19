'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';

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
    setSaving(true);
    const { error: updErr } = await supabase
      .from('clubs')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        is_public: isPublic,
      })
      .eq('id', cb.club!.id);
    setSaving(false);
    if (updErr) { setError(updErr.message); return; }
    setSaveMsg('Saved.');
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function transferOwnership() {
    if (!transferTarget) return;
    const target = admins.find((a) => a.user_id === transferTarget);
    if (!target) return;
    if (!confirm(`Transfer ownership to ${target.name}? You will become an admin.`)) return;
    setTransferring(true);
    try {
      const { error: e1 } = await supabase.from('club_members').update({ role: 'owner' }).eq('club_id', cb.club!.id).eq('user_id', target.user_id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('clubs').update({ owner_user_id: target.user_id }).eq('id', cb.club!.id);
      if (e2) throw e2;
      const { error: e3 } = await supabase.from('club_members').update({ role: 'admin' }).eq('club_id', cb.club!.id).eq('user_id', auth.userId!);
      if (e3) throw e3;
      alert('Ownership transferred.');
      router.push(`/c/${slug}`);
    } catch (e: any) {
      setError('Transfer failed: ' + e.message);
      setTransferring(false);
    }
  }

  async function deleteClub() {
    setDeleting(true);
    const { error: delErr } = await supabase
      .from('clubs')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', cb.club!.id);
    setDeleting(false);
    if (delErr) { alert(delErr.message); return; }
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
            Soft-deletes the club and all of its activities. Recoverable with database access. Member history is preserved.
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
