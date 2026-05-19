'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { AddressFields, AddressFieldsValue } from '@/components/AddressFields';
import { validateZip } from '@/lib/address';

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

const EMPTY_ADDR: AddressFieldsValue = { street: '', city: '', state: '', zip: '' };

export default function ProfilePage() {
  return (
    <Suspense fallback={<p className="text-ink/40 italic">Loading…</p>}>
      <ProfilePageInner />
    </Suspense>
  );
}

function ProfilePageInner() {
  const auth = useAuth();
  const supabase = getBrowserSupabase();
  const searchParams = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';

  const [user, setUser] = useState<UserRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addr, setAddr] = useState<AddressFieldsValue>(EMPTY_ADDR);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.userId) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, email, phone, street, city, state, zip')
        .eq('id', auth.userId)
        .single();
      if (data) {
        const u = data as UserRow;
        setUser(u);
        setName(u.name);
        setEmail(u.email);
        setPhone(u.phone || '');
        setAddr({
          street: u.street || '',
          city: u.city || '',
          state: u.state || '',
          zip: u.zip || '',
        });
      }
      setLoading(false);
    })();
  }, [auth.loading, auth.userId, supabase]);

  function validate(): string | null {
    if (!name.trim()) return 'Name is required.';
    if (!email.trim()) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Please enter a valid email address.';
    // Phone now optional at the platform level (was required only at registration).
    if (phone.trim()) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 7) return 'Please enter a valid phone number, or leave it blank.';
    }
    const zipErr = validateZip(addr.zip);
    if (zipErr) return zipErr;
    return null;
  }

  const dirty = !!user && (
    name.trim() !== user.name ||
    email.trim().toLowerCase() !== user.email ||
    phone.trim() !== (user.phone || '') ||
    addr.street.trim() !== (user.street || '') ||
    addr.city.trim() !== (user.city || '') ||
    addr.state !== (user.state || '') ||
    addr.zip.trim() !== (user.zip || '')
  );
  const emailChanged = !!user && email.trim().toLowerCase() !== user.email;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null);
    const v = validate();
    if (v) { setError(v); return; }
    if (!user) return;

    if (emailChanged) {
      const ok = confirm(
        `You're changing your email from ${user.email} to ${email.trim().toLowerCase()}.\n\n` +
        `Future sign-in links will go to the new address. You'll need to sign in again with the new email after saving. Continue?`
      );
      if (!ok) return;
    }

    setSaving(true);
    const newEmail = email.trim().toLowerCase();

    const { error: userErr } = await supabase
      .from('users')
      .update({
        name: name.trim(),
        email: newEmail,
        phone: phone.trim() || null,
        street: addr.street.trim() || null,
        city: addr.city.trim() || null,
        state: addr.state || null,
        zip: addr.zip.trim() || null,
      })
      .eq('id', user.id);

    if (userErr) {
      setError(userErr.code === '23505' ? 'That email is already in use by another account.' : userErr.message);
      setSaving(false);
      return;
    }

    if (emailChanged) {
      const { error: authErr } = await supabase.auth.updateUser({ email: newEmail });
      if (authErr) {
        // Roll back the users row
        await supabase.from('users').update({ email: user.email }).eq('id', user.id);
        setError('Could not update sign-in email: ' + authErr.message);
        setSaving(false);
        return;
      }
      setSuccess('Profile saved. Check your new email to confirm the change.');
    } else {
      setSuccess('Profile saved.');
    }

    setUser({
      ...user,
      name: name.trim(),
      email: newEmail,
      phone: phone.trim() || null,
      street: addr.street.trim() || null,
      city: addr.city.trim() || null,
      state: addr.state || null,
      zip: addr.zip.trim() || null,
    });
    setSaving(false);
  }

  if (auth.loading || loading) return <p className="text-ink/40 italic">Loading…</p>;

  if (!auth.email) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Profile</h1>
        <p className="text-ink/60 mb-6">You need to sign in to edit your profile.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">No Profile Yet</h1>
        <p className="text-ink/60 mb-6">
          You're signed in as <strong>{auth.email}</strong>, but no profile row exists yet.
          Try signing out and back in — your profile is created automatically.
        </p>
        <Link href="/" className="btn btn-ghost">Home</Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-10">
      <header>
        <Link href="/" className="text-xs tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">← Dashboard</Link>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mt-4 mb-3">Your Information</p>
        <h1 className="font-display text-5xl md:text-6xl">Profile</h1>
        <p className="mt-3 text-ink/60 italic">
          Your details are shared with the clubs you join.
        </p>
      </header>

      {isWelcome && (
        <div className="border border-jade/30 bg-jade/5 p-5 text-sm">
          <p className="font-display text-xl mb-1">Welcome.</p>
          <p className="text-ink/70">
            Set your name and any optional details below, then head to <Link href="/clubs" className="underline hover:text-cinnabar">My Clubs</Link> to create or join a club.
          </p>
        </div>
      )}

      <form onSubmit={save} className="tile-border p-7 space-y-5" noValidate>
        <div>
          <label className="label">Name <span className="text-cinnabar">*</span></label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </div>

        <div>
          <label className="label">Email <span className="text-cinnabar">*</span></label>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          {emailChanged && (
            <p className="text-xs text-cinnabar/80 italic mt-1">
              Changing your email will move your sign-in to the new address.
            </p>
          )}
        </div>

        <div>
          <label className="label">Phone <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span></label>
          <input type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </div>

        <AddressFields
          value={addr}
          onChange={setAddr}
          helperText="Auto-fills as the location when you host a game night."
        />

        {error && <p className="text-cinnabar text-sm">{error}</p>}
        {success && <p className="text-jade text-sm">{success}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn btn-jade flex-1 justify-center" disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save Changes' : 'No Changes'}
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setName(user.name);
                setEmail(user.email);
                setPhone(user.phone || '');
                setAddr({
                  street: user.street || '',
                  city: user.city || '',
                  state: user.state || '',
                  zip: user.zip || '',
                });
                setError(null); setSuccess(null);
              }}
              className="btn btn-ghost"
            >
              Reset
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
