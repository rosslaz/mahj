'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import { useActivity, ACTIVITY_TYPE_LABEL } from '@/lib/use-activity';

export default function ActivitySettingsPage() {
  const params = useParams();
  const router = useRouter();
  const clubSlug = params.slug as string;
  const activitySlug = params.activitySlug as string;
  const auth = useAuth();
  const cb = useClub(clubSlug);
  const act = useActivity(cb.club?.id, activitySlug);
  const supabase = getBrowserSupabase();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!act.activity) return;
    setName(act.activity.name);
    setDescription(act.activity.description || '');
    setIsPublic(act.activity.is_public);
  }, [act.activity]);

  if (cb.loading || act.loading) return null;
  if (!act.activity || !cb.club) return null;
  if (!auth.email) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Sign in</h1>
        <p className="text-ink/60 mb-6">Sign in to access settings.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }
  if (!cb.isAdmin) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Not Authorized</h1>
        <p className="text-ink/60 mb-6">Only club admins can change activity settings.</p>
        <Link href={`/c/${clubSlug}/a/${activitySlug}`} className="btn btn-ghost">← Back</Link>
      </div>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSaveMsg(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    const { error: updErr } = await supabase
      .from('activities')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        is_public: isPublic,
      })
      .eq('id', act.activity!.id);
    setSaving(false);
    if (updErr) { setError(updErr.message); return; }
    setSaveMsg('Saved.');
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function deleteActivity() {
    setDeleting(true);
    const { error: delErr } = await supabase
      .from('activities')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', act.activity!.id);
    setDeleting(false);
    if (delErr) { alert(delErr.message); return; }
    router.push(`/c/${clubSlug}`);
  }

  return (
    <div className="space-y-12 max-w-2xl">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">Activity Settings</p>
        <h1 className="font-display text-5xl md:text-6xl">Settings</h1>
        <p className="mt-2 text-ink/60 italic">
          {ACTIVITY_TYPE_LABEL[act.activity.type]} — part of <Link href={`/c/${clubSlug}`} className="underline hover:text-cinnabar">{cb.club.name}</Link>
        </p>
      </header>

      <form onSubmit={save} className="tile-border p-7 space-y-5">
        <h2 className="font-display text-2xl">Basics</h2>

        <div>
          <label className="label">Activity Name <span className="text-cinnabar">*</span></label>
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
              <span className="block text-sm font-medium">Public activity</span>
              <span className="text-xs text-ink/50 italic">Discoverable outside the club. Only takes effect if the club is also public.</span>
            </span>
          </label>
        </div>

        {error && <p className="text-cinnabar text-sm">{error}</p>}
        {saveMsg && <p className="text-jade text-sm">{saveMsg}</p>}

        <button className="btn btn-jade" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
      </form>

      <section className="border border-cinnabar/30 bg-cinnabar/5 p-7 space-y-4">
        <h2 className="font-display text-2xl text-cinnabar">Danger Zone</h2>
        <div>
          <p className="font-medium mb-1">Delete activity</p>
          <p className="text-sm text-ink/60 mb-4">
            Soft-deletes the activity and its events. Recoverable with database access.
          </p>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="btn" style={{ background: '#9c2c1f', color: '#f5efe6' }}>
              Delete Activity
            </button>
          ) : (
            <div className="flex gap-3 flex-wrap items-center">
              <span className="text-sm text-ink/70">Really delete <strong>{act.activity.name}</strong>?</span>
              <button onClick={deleteActivity} disabled={deleting} className="btn" style={{ background: '#9c2c1f', color: '#f5efe6' }}>
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
