'use client';

import { useEffect, useState } from 'react';
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
  notFound: boolean;
};

export function useClub(slug: string | undefined | null): ClubContextState {
  const auth = useAuth();
  const supabase = getBrowserSupabase();
  const [state, setState] = useState<ClubContextState>({
    loading: true,
    club: null,
    role: null,
    isMember: false,
    isAdmin: false,
    isOwner: false,
    notFound: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!slug) {
      setState({ loading: false, club: null, role: null, isMember: false, isAdmin: false, isOwner: false, notFound: true });
      return;
    }
    if (auth.loading) return;

    (async () => {
      const { data: clubData } = await supabase
        .from('clubs')
        .select('id, slug, name, description, is_public, join_code, owner_user_id, city, state, zip')
        .eq('slug', slug)
        .is('deleted_at', null)
        .maybeSingle();

      if (cancelled) return;
      if (!clubData) {
        setState({ loading: false, club: null, role: null, isMember: false, isAdmin: false, isOwner: false, notFound: true });
        return;
      }

      let role: ClubRole = null;
      if (auth.userId) {
        const { data: memberData } = await supabase
          .from('club_members')
          .select('role')
          .eq('club_id', (clubData as any).id)
          .eq('user_id', auth.userId)
          .maybeSingle();
        role = ((memberData as any)?.role ?? null) as ClubRole;
      }

      setState({
        loading: false,
        club: clubData as Club,
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
