'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';

type Player = {
  id: string;
  name: string;
  email: string;
  phone: string;
  is_admin: boolean;
};

export default function AdminPage() {
  const auth = useAuth();
  const router = useRouter();
  const supabase = getBrowserSupabase();

  const [players, setPlayers] = useState<Player[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('players')
      .select('id, name, email, phone, is_admin')
      .order('is_admin', { ascending: false })
      .order('name');
    if (error) setError(error.message);
    else setPlayers((data as Player[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!auth.loading) load();
  }, [auth.loading]);

  async function setAdmin(id: string, makeAdmin: boolean) {
    const target = players.find((p) => p.id === id);
    if (!target) return;
    if (!makeAdmin && target.id === auth.playerId) {
      if (!confirm('You are about to remove your own admin rights. You will not be able to undo this yourself. Continue?')) return;
    }
    const { error } = await supabase.from('players').update({ is_admin: makeAdmin }).eq('id', id);
    if (error) {
      alert(error.message);
    } else {
      load();
    }
  }

  // Loading
  if (auth.loading) return <p className="text-ink/40 italic">Loading…</p>;

  // Not signed in
  if (!auth.email) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Admin Only</h1>
        <p className="text-ink/60 mb-6">You need to sign in to access this page.</p>
        <Link href="/sign-in" className="btn">Sign In</Link>
      </div>
    );
  }

  // Signed in but not admin
  if (!auth.isAdmin) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Not Authorized</h1>
        <p className="text-ink/60 mb-6">
          You're signed in as <strong>{auth.email}</strong>, but this account isn't an admin.
        </p>
        <Link href="/" className="btn btn-ghost">← Home</Link>
      </div>
    );
  }

  const admins = players.filter((p) => p.is_admin);
  const filtered = players.filter((p) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-12">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">League Administration</p>
        <h1 className="font-display text-5xl md:text-6xl">Admin</h1>
        <p className="mt-4 text-ink/60">
          Signed in as <strong>{auth.playerName || auth.email}</strong>. Manage admin privileges below.
        </p>
      </header>

      {/* Current admins summary */}
      <section className="tile-border p-6">
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Current Admins ({admins.length})</div>
        <div className="flex flex-wrap gap-2">
          {admins.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-jade/10 border border-jade/30 text-sm">
              <span className="font-medium">{a.name}</span>
              <span className="text-ink/40 text-xs">{a.email}</span>
            </span>
          ))}
        </div>
      </section>

      {/* All players */}
      <section>
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-3">
          <h2 className="font-display text-3xl">All Players</h2>
          <input
            type="search"
            className="input max-w-xs"
            placeholder="Filter by name or email…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {error && <p className="text-cinnabar text-sm mb-4">{error}</p>}

        {loading ? (
          <p className="text-ink/40 italic">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-ink/40 italic">No players match.</p>
        ) : (
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {filtered.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-4 gap-4 flex-wrap">
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="font-medium truncate">{p.name}</span>
                  {p.is_admin && (
                    <span className="text-[10px] tracking-[0.2em] uppercase text-jade border border-jade/40 px-2 py-0.5">
                      Admin
                    </span>
                  )}
                  <span className="text-xs text-ink/40 truncate">{p.email}</span>
                </div>
                {p.is_admin ? (
                  <button
                    onClick={() => setAdmin(p.id, false)}
                    className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
                  >
                    Revoke admin
                  </button>
                ) : (
                  <button
                    onClick={() => setAdmin(p.id, true)}
                    className="text-xs tracking-[0.15em] uppercase text-jade hover:underline"
                  >
                    Make admin
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
