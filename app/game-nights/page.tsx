'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { formatTime12 } from '@/lib/game-utils';
import { AddressFields, AddressFieldsValue } from '@/components/AddressFields';
import { validateZip } from '@/lib/address';

type Player = {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};
type Night = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  num_tables: number;
  games_planned: number;
  status: string;
  host?: { id: string; name: string } | null;
  signup_count?: number;
};

const EMPTY_ADDR: AddressFieldsValue = { street: '', city: '', state: '', zip: '' };

export default function GameNightsPage() {
  const auth = useAuth();
  const supabase = getBrowserSupabase();
  const router = useRouter();

  const [nights, setNights] = useState<Night[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // form state
  const [nightName, setNightName] = useState('');
  const [nightDate, setNightDate] = useState(new Date().toISOString().slice(0, 10));
  const [nightTime, setNightTime] = useState('19:00');
  const [numTables, setNumTables] = useState(1);
  const [gamesPlanned, setGamesPlanned] = useState(4);
  const [hostId, setHostId] = useState<string>('');
  const [addr, setAddr] = useState<AddressFieldsValue>(EMPTY_ADDR);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [nightsRes, playersRes] = await Promise.all([
      supabase
        .from('game_nights')
        .select('id, name, date, start_time, num_tables, games_planned, status, host:host_player_id(id, name), signups:night_signups(count)')
        .order('date', { ascending: false }),
      supabase.from('players').select('id, name, street, city, state, zip').order('name'),
    ]);
    const nightsWithCount = (nightsRes.data || []).map((n: any) => ({
      ...n,
      signup_count: n.signups?.[0]?.count ?? 0,
    }));
    setNights(nightsWithCount);
    setPlayers((playersRes.data as Player[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function playerAddr(p: Player | undefined): AddressFieldsValue {
    if (!p) return EMPTY_ADDR;
    return {
      street: p.street || '',
      city: p.city || '',
      state: p.state || '',
      zip: p.zip || '',
    };
  }

  function addrIsEmpty(a: AddressFieldsValue) {
    return !a.street && !a.city && !a.state && !a.zip;
  }

  function addrEquals(a: AddressFieldsValue, b: AddressFieldsValue) {
    return a.street === b.street && a.city === b.city && a.state === b.state && a.zip === b.zip;
  }

  function handleHostChange(newHostId: string) {
    const previousHost = players.find((p) => p.id === hostId);
    const previousHostAddr = playerAddr(previousHost);
    const newHost = players.find((p) => p.id === newHostId);
    const newHostAddr = playerAddr(newHost);

    setHostId(newHostId);

    // Auto-fill only if current address is empty OR equals the previous host's address
    if (addrIsEmpty(addr) || addrEquals(addr, previousHostAddr)) {
      setAddr(newHostAddr);
    }
  }

  async function createNight(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!nightName.trim()) return setFormError('Name is required.');
    if (numTables < 1) return setFormError('At least one table is required.');
    const zipErr = validateZip(addr.zip);
    if (zipErr) return setFormError(zipErr);

    setCreating(true);
    try {
      const { data: nightData, error: nightErr } = await supabase
        .from('game_nights')
        .insert({
          name: nightName.trim(),
          date: nightDate,
          start_time: nightTime || null,
          num_tables: numTables,
          games_planned: gamesPlanned,
          host_player_id: hostId || null,
          street: addr.street.trim() || null,
          city: addr.city.trim() || null,
          state: addr.state || null,
          zip: addr.zip.trim() || null,
        })
        .select()
        .single();
      if (nightErr || !nightData) throw new Error(nightErr?.message || 'Failed to create night');

      const tablesPayload = Array.from({ length: numTables }, (_, i) => ({
        game_night_id: nightData.id,
        table_number: i + 1,
        assigned: false,
      }));
      const { error: tablesErr } = await supabase.from('tables').insert(tablesPayload);
      if (tablesErr) throw new Error(tablesErr.message);

      router.push(`/game-nights/${nightData.id}`);
    } catch (err: any) {
      setFormError(err.message);
      setCreating(false);
    }
  }

  const selectedHost = players.find((p) => p.id === hostId);
  const hostHasAddress = !!(selectedHost?.street || selectedHost?.city || selectedHost?.state || selectedHost?.zip);

  return (
    <div className="space-y-12">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">The Calendar</p>
          <h1 className="font-display text-5xl md:text-6xl">Game Nights</h1>
        </div>
        {auth.email ? (
          <button onClick={() => setShowCreate(!showCreate)} className="btn">
            {showCreate ? 'Cancel' : '+ New Night'}
          </button>
        ) : (
          <Link href="/sign-in" className="btn btn-ghost">Sign in to create</Link>
        )}
      </header>

      {showCreate && auth.email && (
        <form onSubmit={createNight} className="tile-border p-7 space-y-6 fade-up">
          <div className="grid md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className="label">Name <span className="text-cinnabar">*</span></label>
              <input className="input" value={nightName} onChange={(e) => setNightName(e.target.value)} placeholder="Spring Tournament Night 3" required />
            </div>
            <div>
              <label className="label">Date <span className="text-cinnabar">*</span></label>
              <input type="date" className="input" value={nightDate} onChange={(e) => setNightDate(e.target.value)} required />
            </div>
            <div>
              <label className="label">Start Time</label>
              <input type="time" className="input" value={nightTime} onChange={(e) => setNightTime(e.target.value)} />
              <p className="text-xs text-ink/40 italic mt-1">Displayed as 12-hour clock.</p>
            </div>
            <div>
              <label className="label">Number of Tables <span className="text-cinnabar">*</span></label>
              <input
                type="number"
                min={1}
                max={10}
                className="input"
                value={numTables}
                onChange={(e) => setNumTables(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                required
              />
              <p className="text-xs text-ink/40 italic mt-1">
                Capacity: {numTables * 4}–{numTables * 5} players.
              </p>
            </div>
            <div>
              <label className="label">Games per Night <span className="text-cinnabar">*</span></label>
              <input
                type="number"
                min={1}
                max={20}
                className="input"
                value={gamesPlanned}
                onChange={(e) => setGamesPlanned(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">Host <span className="text-ink/30 normal-case tracking-normal italic font-normal">— optional</span></label>
              <select className="input" value={hostId} onChange={(e) => handleHostChange(e.target.value)}>
                <option value="">— No host yet —</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <p className="text-xs text-ink/40 italic mt-1">
                A player can claim host later if none chosen here.
              </p>
            </div>
            <div className="md:col-span-2">
              <AddressFields
                value={addr}
                onChange={setAddr}
                helperText={
                  hostId && hostHasAddress
                    ? "Auto-filled from host's profile. Edit if the night is somewhere else."
                    : 'Enter manually, or set a host first to auto-fill from their profile.'
                }
              />
            </div>
          </div>

          {formError && <p className="text-cinnabar text-sm">{formError}</p>}

          <div className="flex gap-3 pt-2">
            <button className="btn btn-jade" disabled={creating}>{creating ? 'Creating…' : 'Create Game Night'}</button>
            <button type="button" onClick={() => setShowCreate(false)} className="btn btn-ghost">Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-ink/40 italic">Loading…</p>
      ) : nights.length === 0 ? (
        <div className="tile-border p-12 text-center">
          <p className="font-display italic text-xl text-ink/50">No game nights yet.</p>
          {auth.email && !showCreate && (
            <button onClick={() => setShowCreate(true)} className="btn mt-6">Create the First</button>
          )}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {nights.map((n, i) => (
            <Link
              key={n.id}
              href={`/game-nights/${n.id}`}
              className="tile-border p-6 hover:border-cinnabar/40 transition-colors fade-up"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">
                {new Date(n.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                {n.start_time && <span className="ml-2">· {formatTime12(n.start_time)}</span>}
              </div>
              <div className="font-display text-2xl mb-1">{n.name}</div>
              {n.host && (
                <div className="text-sm text-ink/60 mb-3 italic">Hosted by {n.host.name}</div>
              )}
              {!n.host && (
                <div className="text-sm text-cinnabar/80 mb-3 italic">Host needed</div>
              )}
              <div className="flex items-center justify-between text-sm text-ink/60 pt-3 border-t border-ink/10">
                <span>{n.num_tables} table{n.num_tables === 1 ? '' : 's'} · {n.signup_count ?? 0}/{n.num_tables * 5} signed up</span>
                <span className={`text-xs tracking-[0.15em] uppercase ${n.status === 'active' ? 'text-jade' : 'text-ink/40'}`}>
                  {n.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
