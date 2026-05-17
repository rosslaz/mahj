'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from './supabase-browser';

export type AuthState = {
  loading: boolean;
  email: string | null;
  userId: string | null;     // users.id (NOT auth.uid)
  authUserId: string | null; // auth.uid
  name: string | null;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true,
    email: null,
    userId: null,
    authUserId: null,
    name: null,
  });

  useEffect(() => {
    const supabase = getBrowserSupabase();
    let mounted = true;

    async function refresh(authUserId: string | null, email: string | null) {
      if (!authUserId || !email) {
        if (mounted) setState({ loading: false, email: null, userId: null, authUserId: null, name: null });
        return;
      }
      // Look up the users row by auth_user_id (preferred) then fall back to email
      let { data } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      if (!data) {
        const r2 = await supabase
          .from('users')
          .select('id, name, email')
          .ilike('email', email)
          .maybeSingle();
        data = r2.data;
        // If found by email, attach the auth_user_id for next time
        if (data) {
          await supabase.from('users').update({ auth_user_id: authUserId }).eq('id', (data as any).id);
        }
      }
      if (!mounted) return;
      setState({
        loading: false,
        email,
        userId: (data as any)?.id ?? null,
        authUserId,
        name: (data as any)?.name ?? null,
      });
    }

    supabase.auth.getSession().then(({ data }) =>
      refresh(data.session?.user.id ?? null, data.session?.user.email ?? null)
    );
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      refresh(session?.user.id ?? null, session?.user.email ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
