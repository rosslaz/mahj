'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/use-auth';
import { getBrowserSupabase } from '@/lib/supabase-browser';

export default function UserMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);

  async function signOut() {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    setOpen(false);
    window.location.href = '/';
  }

  if (auth.loading) return null;

  if (!auth.email) {
    return (
      <Link href="/sign-in" className="text-sm hover:text-cinnabar transition-colors">
        Sign In
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm hover:text-cinnabar transition-colors"
      >
        <span className="truncate max-w-[140px]">{auth.name || auth.email}</span>
        <span className={`text-ink/40 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-56 tile-border z-50 fade-up">
            <div className="px-4 py-3 border-b border-ink/10 text-xs text-ink/50 truncate">{auth.email}</div>
            <Link href="/" onClick={() => setOpen(false)} className="block px-4 py-3 text-sm hover:bg-ink/5 border-b border-ink/10">
              Dashboard
            </Link>
            <Link href="/leagues" onClick={() => setOpen(false)} className="block px-4 py-3 text-sm hover:bg-ink/5 border-b border-ink/10">
              My Leagues
            </Link>
            <Link href="/profile" onClick={() => setOpen(false)} className="block px-4 py-3 text-sm hover:bg-ink/5 border-b border-ink/10">
              My Profile
            </Link>
            <button onClick={signOut} className="block w-full text-left px-4 py-3 text-sm hover:bg-ink/5 text-cinnabar">
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
