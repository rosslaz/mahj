'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { slugify } from '@/lib/slug';

// Random suffix for slug disambiguation. Lowercase + digits, no ambiguous chars.
function randomSuffix(len = 4): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export default function NewLeaguePage() {
  const router = useRouter();
  const auth = useAuth();
  const supabase = getBrowserSupabase();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.loading) return <p className="text-ink/40 italic">Loading…</p>;
  if (!auth.email || !auth.userId) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Sign in</h1>
        <p className="text-ink/60 mb-6">You need to sign in to create a league.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }

  // Pick a unique slug for this name. Try the bare slugified form first; if
  // it's taken, append a short random suffix until we find one that's free.
  async function pickUniqueSlug(base: string): Promise<string> {
    let candidate = base || 'league';
    // Cap length so suffix fits within the 60-char DB limit.
    if (candidate.length > 50) candidate = candidate.slice(0, 50);

    // First try the clean form
    let { data } = await supabase
      .from('leagues')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;

    // Try suffixed forms
    for (let attempts = 0; attempts < 8; attempts++) {
      const suffixed = `${candidate}-${randomSuffix(4)}`;
      const res = await supabase
        .from('leagues')
        .select('id')
        .eq('slug', suffixed)
        .maybeSingle();
      if (!res.data) return suffixed;
    }
    // Last resort — long random suffix, essentially guaranteed to be unique
    return `${candidate}-${randomSuffix(8)}`;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }

    setSubmitting(true);

    try {
      const slug = await pickUniqueSlug(slugify(name.trim()));

      const { data: codeData, error: codeErr } = await supabase.rpc('generate_join_code');
      if (codeErr) throw new Error(codeErr.message);

      const { data: leagueData, error: leagueErr } = await supabase
        .from('leagues')
        .insert({
          slug,
          name: name.trim(),
          description: description.trim() || null,
          is_public: isPublic,
          owner_user_id: auth.userId,
          join_code: codeData as string,
        })
        .select()
        .single();

      if (leagueErr || !leagueData) {
        // 23505 = unique violation. Rare race where the slug got taken between
        // our check and our insert; just retry once with a fresh suffix.
        if (leagueErr?.code === '23505') {
          const retrySlug = `${slug}-${randomSuffix(4)}`;
          const retry = await supabase
            .from('leagues')
            .insert({
              slug: retrySlug,
              name: name.trim(),
              description: description.trim() || null,
              is_public: isPublic,
              owner_user_id: auth.userId,
              join_code: codeData as string,
            })
            .select()
            .single();
          if (retry.error || !retry.data) throw new Error(retry.error?.message || 'Could not create league.');
          await supabase.from('league_members').insert({
            league_id: (retry.data as any).id,
            user_id: auth.userId,
            role: 'owner',
          });
          router.push(`/l/${retrySlug}`);
          return;
        }
        throw new Error(leagueErr?.message || 'Could not create league.');
      }

      const { error: memErr } = await supabase.from('league_members').insert({
        league_id: (leagueData as any).id,
        user_id: auth.userId,
        role: 'owner',
      });
      if (memErr) throw new Error('League created but membership failed: ' + memErr.message);

      router.push(`/l/${slug}`);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-10">
      <header>
        <Link href="/leagues" className="text-xs tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">← My Leagues</Link>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mt-4 mb-3">A new club</p>
        <h1 className="font-display text-5xl">Create League</h1>
      </header>

      <form onSubmit={create} className="tile-border p-7 space-y-5">
        <div>
          <label className="label">League Name <span className="text-cinnabar">*</span></label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Birmingham Tile Society"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="label">Description <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span></label>
          <textarea
            className="input min-h-[80px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Weekly Tuesday nights, traditional rules, beginners welcome."
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
              <span className="text-xs text-ink/50 italic">Discoverable by anyone. Members still join via code or invite. Default is private.</span>
            </span>
          </label>
        </div>

        {error && <p className="text-cinnabar text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button className="btn btn-jade flex-1 justify-center" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create League'}
          </button>
          <Link href="/leagues" className="btn btn-ghost">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
