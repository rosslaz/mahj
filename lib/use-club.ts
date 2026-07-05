'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
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

// ============================================================
// Shared-instance context (audit #14 + the #11 residual)
//
// The club layout runs ONE real instance of the hook and provides it here;
// every useClub(slug) call underneath (the activity layout, the page, any
// panel) reads the shared state instead of running its own queries. That
// kills the N-instances-per-page duplication AND the #11 residual where a
// page's own instance could fail while the layout's succeeded — there is
// only one instance to fail now, and the layout owns the error screen.
//
// Trade-off, documented in PROJECT_STATE: club/role data is now cached for
// the layout's lifetime instead of refetching on every in-club page
// navigation. A mid-session role change shows up on the next entry into the
// club (or retry), not the next page click.
// ============================================================

const ClubContext = createContext<(ClubContextState & { slug: string }) | null>(null);

/** Mounted by the club layout around its children. Plain createElement so
 *  this file can stay .ts. */
export function ClubProvider({
  slug,
  value,
  children,
}: {
  slug: string;
  value: ClubContextState;
  children: ReactNode;
}) {
  return createElement(ClubContext.Provider, { value: { ...value, slug } }, children);
}

/**
 * Context-aware: if a ClubProvider for THIS slug is above us, return the
 * shared state; otherwise run standalone (the layout itself, and any
 * component rendered outside a club tree). Signature and return shape are
 * unchanged from the pre-provider version, so no consumer changed.
 */
export function useClub(slug: string | undefined | null): ClubContextState {
  const ctx = useContext(ClubContext);
  const provided = ctx && slug && ctx.slug === slug ? ctx : null;
  // Hooks must run unconditionally: when the provider matches, run the
  // standalone hook with a null slug — its early branch sets static state
  // and performs no queries — purely to keep hook order stable.
  const standalone = useClubStandalone(provided ? null : slug);
  return provided ?? standalone;
}

function useClubStandalone(slug: string | undefined | null): ClubContextState {
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
