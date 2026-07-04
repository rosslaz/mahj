'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from './supabase-browser';
import { useAuth } from './use-auth';

export type Club = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_public: boolean;
  join_code: string | null;
  owner_user_id: string;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type ClubRole = 'owner' | 'admin' | 'member' | null;

export type ClubContextState = {
  loading: boolean;
  club: Club | null;
  role: ClubRole;          // null = not a member
  isMember: boolean;
  isAdmin: boolean;        // owner OR admin
  isOwner: boolean;
  // Definitively no such club: the query SUCCEEDED and returned zero rows.
  notFound: boolean;
  // Load failure (network blip, transient API error) after internal retries —
  // distinct from notFound. 2026-07 audit #11: these used to be conflated,
  // so a dropped request rendered a confident "Club Not Found" screen, and a
  // failed membership check silently demoted a member to visitor.
  error: string | null;
  retry: () => void;
};

const EMPTY = {
  club: null as Club | null,
  role: null as ClubRole,
  isMember: false,
  isAdmin: false,
  isOwner: false,
};
const MAX_ATTEMPTS = 3;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useClub(slug: string | undefined | null): ClubContextState {
  const auth = useAuth();
  const supabase = getBrowserSupabase();
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  const [state, setState] = useState<Omit<ClubContextState, 'retry'>>({
    loading: true, ...EMPTY, notFound: false, error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!slug) {
      setState({ loading: false, ...EMPTY, notFound: true, error: null });
      return;
    }
    if (auth.loading) return;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      let lastError = '';
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) await delay(attempt === 2 ? 400 : 1200);
        if (cancelled) return;

        const clubRes = await supabase
          .from('clubs')
          .select('id, slug, name, description, is_public, join_code, owner_user_id, city, state, zip')
          .eq('slug', slug)
          .is('deleted_at', null)
          .maybeSingle();
        if (cancelled) return;
        if (clubRes.error) { lastError = clubRes.error.message; continue; }
        if (!clubRes.data) {
          setState({ loading: false, ...EMPTY, notFound: true, error: null });
          return;
        }

        let role: ClubRole = null;
        if (auth.userId) {
          const memberRes = await supabase
            .from('club_members')
            .select('role')
            .eq('club_id', (clubRes.data as any).id)
            .eq('user_id', auth.userId)
            .maybeSingle();
          if (cancelled) return;
          // A failed membership check is a LOAD failure, not "not a member".
          if (memberRes.error) { lastError = memberRes.error.message; continue; }
          role = ((memberRes.data as any)?.role ?? null) as ClubRole;
        }

        setState({
          loading: false,
          club: clubRes.data as Club,
          role,
          isMember: !!role,
          isAdmin: role === 'owner' || role === 'admin',
          isOwner: role === 'owner',
          notFound: false,
          error: null,
        });
        return;
      }
      if (cancelled) return;
      console.warn('[useClub] load failed after retries:', lastError);
      setState({
        loading: false, ...EMPTY, notFound: false,
        error: "Couldn't load the club — check your connection.",
      });
    })();
    return () => { cancelled = true; };
  }, [slug, auth.loading, auth.userId, supabase, reloadKey]);

  return { ...state, retry };
}
