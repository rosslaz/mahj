'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { AddressFields, AddressFieldsValue } from '@/components/AddressFields';
import { formatAddressLines, validateZip } from '@/lib/address';

type Player = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  created_at: string;
};

const EMPTY_ADDR: AddressFieldsValue = { street: '', city: '', state: '', zip: '' };

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addr, setAddr] = useState<AddressFieldsValue>(EMPTY_ADDR);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = getBrowserSupabase();

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('name');
    if (error) setError(error.message);
    else setPlayers((data as Player[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function validate(): string | null {
    if (!name.trim()) return 'Name is required.';
    if (!email.trim()) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Please enter a valid email address.';
    if (!phone.trim()) return 'Phone is required.';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) return 'Please enter a valid phone number.';
    const zipErr = validateZip(addr.zip);
    if (zipErr) return zipErr;
    return null;
  }

  async function register(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); return; }
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from('players').insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      street: addr.street.trim() || null,
      city: addr.city.trim() || null,
      state: addr.state || null,
      zip: addr.zip.trim() || null,
    });
    if (error) {
      setError(error.code === '23505' ? 'A player with that email is already registered.' : error.message);
    } else {
      setName(''); setEmail(''); setPhone(''); setAddr(EMPTY_ADDR);
      await load();
    }
    setSubmitting(false);
  }

  async function removePlayer(id: string) {
    if (!confirm('Remove this player? Their historical scores will remain.')) return;
    const { error } = await supabase.from('players').delete().eq('id', id);
    if (error) alert(error.message);
    else load();
  }

  return (
    <div className="space-y-12">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">The Roster</p>
        <h1 className="font-display text-5xl md:text-6xl">Players</h1>
      </header>

      <div className="grid md:grid-cols-12 gap-10">
        {/* Form */}
        <div className="md:col-span-5">
          <div className="tile-border p-7">
            <h2 className="font-display text-2xl mb-1">Register</h2>
            <p className="text-sm text-ink/50 mb-6 italic">Add a new player to the league.</p>
            <form onSubmit={register} className="space-y-5" noValidate>
              <div>
                <label className="label">
                  Name <span className="text-cinnabar">*</span>
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Wei Lin"
                  autoComplete="name"
                  required
                />
              </div>
              <div>
                <label className="label">
                  Email <span className="text-cinnabar">*</span>
                </label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="player@example.com"
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label className="label">
                  Phone <span className="text-cinnabar">*</span>
                </label>
                <input
                  className="input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  autoComplete="tel"
                  required
                />
              </div>

              <AddressFields value={addr} onChange={setAddr} />

              {error && <p className="text-cinnabar text-sm">{error}</p>}
              <button className="btn btn-jade w-full justify-center" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add Player'}
              </button>
            </form>
          </div>
        </div>

        {/* List */}
        <div className="md:col-span-7">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-display text-2xl">All Players</h2>
            <span className="text-xs tracking-[0.2em] uppercase text-ink/40">{players.length} total</span>
          </div>
          {loading ? (
            <p className="text-ink/40 italic">Loading…</p>
          ) : players.length === 0 ? (
            <div className="tile-border p-8 text-center text-ink/50 italic font-display">
              No players yet. Add the first one.
            </div>
          ) : (
            <ul className="divide-y divide-ink/10 border-y border-ink/10">
              {players.map((p, i) => {
                const open = expandedId === p.id;
                const addressLines = formatAddressLines(p);
                return (
                  <li key={p.id} className="group">
                    <div
                      className="flex items-center justify-between py-4 cursor-pointer"
                      onClick={() => setExpandedId(open ? null : p.id)}
                    >
                      <div className="flex items-baseline gap-4">
                        <span className="rank-glyph text-xl text-ink/30 w-6">{String(i + 1).padStart(2, '0')}</span>
                        <div>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-ink/40">{p.email} · {p.phone}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removePlayer(p.id);
                          }}
                          className="text-xs tracking-[0.15em] uppercase text-ink/30 hover:text-cinnabar opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Remove
                        </button>
                        <span className={`text-ink/30 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                      </div>
                    </div>
                    {open && (
                      <div className="pb-4 pl-10 text-sm text-ink/60 space-y-1 fade-up">
                        <div>
                          <span className="text-ink/40 text-xs tracking-[0.15em] uppercase mr-2">Email</span>
                          <a href={`mailto:${p.email}`} className="hover:text-cinnabar">{p.email}</a>
                        </div>
                        <div>
                          <span className="text-ink/40 text-xs tracking-[0.15em] uppercase mr-2">Phone</span>
                          <a href={`tel:${p.phone}`} className="hover:text-cinnabar">{p.phone}</a>
                        </div>
                        {addressLines.length > 0 && (
                          <div>
                            <span className="text-ink/40 text-xs tracking-[0.15em] uppercase mr-2 align-top">Address</span>
                            <span className="inline-block">
                              {addressLines.map((line, idx) => (
                                <span key={idx} className="block">{line}</span>
                              ))}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
