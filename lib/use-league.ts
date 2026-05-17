'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from './supabase-browser';
import { useAuth } from './use-auth';

export type League = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_public: boolean;
  join_code: string | null;
  owner_user_id: string;
};

export type LeagueRole = 'owner' | 'admin' | 'member' | null;

export type LeagueContextState = {
  loading: boolean;
  league: League | null;
  role: LeagueRole;        // null = not a member
  isMember: boolean;
  isAdmin: boolean;        // owner OR admin
  isOwner: boolean;
  notFound: boolean;
};

export function useLeague(slug: string | undefined | null): LeagueContextState {
  const auth = useAuth();
  const supabase = getBrowserSupabase();
  const [state, setState] = useState<LeagueContextState>({
    loading: true,
    league: null,
    role: null,
    isMember: false,
    isAdmin: false,
    isOwner: false,
    notFound: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!slug) {
      setState({ loading: false, league: null, role: null, isMember: false, isAdmin: false, isOwner: false, notFound: true });
      return;
    }
    if (auth.loading) return;

    (async () => {
      const { data: leagueData } = await supabase
        .from('leagues')
        .select('id, slug, name, description, is_public, join_code, owner_user_id')
        .eq('slug', slug)
        .is('deleted_at', null)
        .maybeSingle();

      if (cancelled) return;
      if (!leagueData) {
        setState({ loading: false, league: null, role: null, isMember: false, isAdmin: false, isOwner: false, notFound: true });
        return;
      }

      let role: LeagueRole = null;
      if (auth.userId) {
        const { data: memberData } = await supabase
          .from('league_members')
          .select('role')
          .eq('league_id', (leagueData as any).id)
          .eq('user_id', auth.userId)
          .maybeSingle();
        role = ((memberData as any)?.role ?? null) as LeagueRole;
      }

      setState({
        loading: false,
        league: leagueData as League,
        role,
        isMember: !!role,
        isAdmin: role === 'owner' || role === 'admin',
        isOwner: role === 'owner',
        notFound: false,
      });
    })();
    return () => { cancelled = true; };
  }, [slug, auth.loading, auth.userId, supabase]);

  return state;
}
