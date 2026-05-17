'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useLeague } from '@/lib/use-league';

type AdminCandidate = {
  user_id: string;
  name: string;
  email: string;
};

export default function LeagueSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const auth = useAuth();
  const lg = useLeague(slug);
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

  useEffect(() => {
    if (!lg.league) return;
    setName(lg.league.name);
    setDescription(lg.league.description || '');
    setIsPublic(lg.league.is_public);
  }, [lg.league]);

  useEffect(() => {
    if (!lg.league) return;
    (async () => {
      const { data } = await supabase
        .from('league_members')
        .select('user_id, role, user:user_id(name, email, deleted_at)')
        .eq('league_id', lg.league!.id)
        .eq('role', 'admin');
      const list: AdminCandidate[] = ((data as any[]) || [])
        .filter((r) => r.user && !r.user.deleted_at)
        .map((r) => ({ user_id: r.user_id, name: r.user.name, email: r.user.email }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setAdmins(list);
    })();
  }, [lg.league, supabase]);

  if (lg.loading || !lg.league) return null;
  if (!auth.email) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Owner Only</h1>
        <p className="text-ink/60 mb-6">Sign in to access settings.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }
  if (!lg.isOwner) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Owner Only</h1>
        <p className="text-ink/60 mb-6">Only the league owner can change settings.</p>
        <Link href={`/l/${slug}`} className="btn btn-ghost">← League home</Link>
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
      .from('leagues')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        is_public: isPublic,
      })
      .eq('id', lg.league!.id);
    setSaving(false);
    if (updErr) { setError(updErr.message); return; }
    setSaveMsg('Saved.');
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function transferOwnership() {
    if (!transferTarget) return;
    const target = admins.find((a) => a.user_id === transferTarget);
    if (!target) return;
    if (!confirm(`Transfer ownership to ${target.name}? You will become an admin. This cannot be undone without their cooperation.`)) return;
    setTransferring(true);
    try {
      // Step 1: promote target to owner
      const { error: e1 } = await supabase
        .from('league_members')
        .update({ role: 'owner' })
        .eq('league_id', lg.league!.id)
        .eq('user_id', target.user_id);
      if (e1) throw e1;

      // Step 2: update the league's owner_user_id
      const { error: e2 } = await supabase
        .from('leagues')
        .update({ owner_user_id: target.user_id })
        .eq('id', lg.league!.id);
      if (e2) throw e2;

      // Step 3: demote myself to admin
      const { error: e3 } = await supabase
        .from('league_members')
        .update({ role: 'admin' })
        .eq('league_id', lg.league!.id)
        .eq('user_id', auth.userId!);
      if (e3) throw e3;

      alert('Ownership transferred.');
      router.push(`/l/${slug}`);
    } catch (e: any) {
      setError('Transfer failed: ' + e.message);
      setTransferring(false);
    }
  }

  async function deleteLeague() {
    const confirmation = prompt(`Type the league name to confirm soft-deletion:\n\n${lg.league!.name}`);
    if (confirmation !== lg.league!.name) {
      if (confirmation !== null) alert('Name did not match. Deletion cancelled.');
      return;
    }
    setDeleting(true);
    const { error: delErr } = await supabase
      .from('leagues')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', lg.league!.id);
    setDeleting(false);
    if (delErr) { alert(delErr.message); return; }
    router.push('/leagues');
  }

  return (
    <div className="space-y-12">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">League Settings</p>
        <h1 className="font-display text-5xl md:text-6xl">Settings</h1>
        <p className="mt-2 text-ink/60 italic">Owner-only. Tread carefully.</p>
      </header>

      {/* Basics */}
      <form onSubmit={saveBasics} className="tile-border p-7 space-y-5">
        <h2 className="font-display text-2xl">Basics</h2>

        <div>
          <label className="label">League Name <span className="text-cinnabar">*</span></label>
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
              <span className="block text-sm font-medium">Public league</span>
              <span className="text-xs text-ink/50 italic">Discoverable by anyone with a link. Members still join via code or invite.</span>
            </span>
          </label>
        </div>

        {error && <p className="text-cinnabar text-sm">{error}</p>}
        {saveMsg && <p className="text-jade text-sm">{saveMsg}</p>}

        <button className="btn btn-jade" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
      </form>

      {/* Transfer ownership */}
      <section className="tile-border p-7 space-y-4">
        <h2 className="font-display text-2xl">Transfer Ownership</h2>
        <p className="text-sm text-ink/60">
          Hand the league over to another admin. You'll become an admin. There can only be one owner.
        </p>
        {admins.length === 0 ? (
          <p className="text-ink/50 italic text-sm">
            No admins yet. Promote someone to admin on the <Link href={`/l/${slug}/admin`} className="underline hover:text-cinnabar">Admin</Link> tab first.
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

      {/* Danger zone */}
      <section className="border border-cinnabar/30 bg-cinnabar/5 p-7 space-y-4">
        <h2 className="font-display text-2xl text-cinnabar">Danger Zone</h2>
        <div>
          <p className="font-medium mb-1">Delete league</p>
          <p className="text-sm text-ink/60 mb-4">
            Soft-deletes the league. Hidden from everyone, but recoverable with database access. Member history is preserved.
          </p>
          <button onClick={deleteLeague} disabled={deleting} className="btn" style={{ background: '#9c2c1f', color: '#f5efe6' }}>
            {deleting ? 'Deleting…' : 'Delete League'}
          </button>
        </div>
      </section>
    </div>
  );
}
