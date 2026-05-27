'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { slugify } from '@/lib/slug';
import { AddressFields, AddressFieldsValue } from '@/components/AddressFields';
import { validateZip } from '@/lib/address';
import { provisionClubSubscription } from '@/app/actions/billing-provision';

function randomSuffix(len = 4): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export default function NewClubPage() {
  const router = useRouter();
  const auth = useAuth();
  const supabase = getBrowserSupabase();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [addr, setAddr] = useState<AddressFieldsValue>({ street: '', city: '', state: '', zip: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.loading) return <p className="text-ink/40 italic">Loading…</p>;
  if (!auth.email || !auth.userId) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Sign in</h1>
        <p className="text-ink/60 mb-6">You need to sign in to create a club.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }

  async function pickUniqueSlug(base: string): Promise<string> {
    let candidate = base || 'club';
    if (candidate.length > 50) candidate = candidate.slice(0, 50);
    const { data } = await supabase
      .from('clubs')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
    for (let attempts = 0; attempts < 8; attempts++) {
      const suffixed = `${candidate}-${randomSuffix(4)}`;
      const res = await supabase.from('clubs').select('id').eq('slug', suffixed).maybeSingle();
      if (!res.data) return suffixed;
    }
    return `${candidate}-${randomSuffix(8)}`;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    if (isPublic) {
      if (!addr.city.trim() || !addr.state || !addr.zip.trim()) {
        setError('Public clubs require city, state, and ZIP.');
        return;
      }
      const zipErr = validateZip(addr.zip.trim());
      if (zipErr) { setError(zipErr); return; }
    }
    setSubmitting(true);

    try {
      const slug = await pickUniqueSlug(slugify(name.trim()));
      const { data: codeData, error: codeErr } = await supabase.rpc('generate_join_code');
      if (codeErr) throw new Error(codeErr.message);

      const { data: clubData, error: clubErr } = await supabase
        .from('clubs')
        .insert({
          slug,
          name: name.trim(),
          description: description.trim() || null,
          is_public: isPublic,
          owner_user_id: auth.userId,
          join_code: codeData as string,
          // Address: store whatever was entered (even for private clubs).
          // The DB-level check constraint only enforces required-when-public.
          city: addr.city.trim() || null,
          state: addr.state || null,
          zip: addr.zip.trim() || null,
        })
        .select()
        .single();
      if (clubErr || !clubData) throw new Error(clubErr?.message || 'Could not create club.');

      const { error: memErr } = await supabase.from('club_members').insert({
        club_id: (clubData as any).id,
        user_id: auth.userId,
        role: 'owner',
      });
      if (memErr) throw new Error('Club created but membership failed: ' + memErr.message);

      // Provision the subscription row. @pungctual.com owners get grandfathered;
      // everyone else gets a 14-day Pro trial (30 days for the first 10 new clubs).
      // Don't block the redirect on this — worst case they land on the club page
      // and see free-tier limits until a retry kicks in.
      try {
        await provisionClubSubscription((clubData as any).id);
      } catch (err) {
        console.error('[create-club] provisioning failed (non-fatal):', err);
      }

      router.push(`/c/${slug}`);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-10">
      <header>
        <Link href="/clubs" className="text-xs tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">← My Clubs</Link>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mt-4 mb-3">A new group</p>
        <h1 className="font-display text-5xl">Create Club</h1>
      </header>

      <form onSubmit={create} className="tile-border p-7 space-y-5">
        <div>
          <label className="label">Club Name <span className="text-cinnabar">*</span></label>
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
              <span className="block text-sm font-medium">Public club</span>
              <span className="text-xs text-ink/50 italic">Discoverable by anyone. Members still join via code or invite. Default is private.</span>
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

        <div className="flex gap-3 pt-2">
          <button className="btn btn-jade flex-1 justify-center" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Club'}
          </button>
          <Link href="/clubs" className="btn btn-ghost">Cancel</Link>
        </div>
      </form>

      <p className="text-xs text-ink/40 italic text-center">
        Once your club exists, you can add activities — leagues, tournaments, classes, or open play sessions.
      </p>
    </div>
  );
}
