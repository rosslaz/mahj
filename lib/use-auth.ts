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

// Placeholder display name derived from the email local-part, matching the
// callback's logic so a self-healed row looks identical to a callback-created
// one ("ross.lazar" -> "Ross Lazar").
function placeholderNameFromEmail(email: string): string {
  return email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

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

      // 1. Look up the users row by auth_user_id (the linked, fast path).
      let { data } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('auth_user_id', authUserId)
        .maybeSingle();

      // 2. Not found by auth_user_id — try by email. A row may exist from an
      //    email invite that was never linked to this auth account yet.
      if (!data) {
        const r2 = await supabase
          .from('users')
          .select('id, name, email')
          .ilike('email', email)
          .maybeSingle();
        data = r2.data;
        if (data) {
          // Found by email → link it for next time.
          await supabase.from('users').update({ auth_user_id: authUserId }).eq('id', (data as any).id);
        }
      }

      // 3. SELF-HEAL: still no row means this authenticated session was never
      //    provisioned — the /auth/callback step that normally creates the
      //    users row was missed or failed (e.g. a magic link opened in a
      //    different browser context, a consumed single-use code, a closed
      //    tab mid-redirect, an insert that errored). Without a users row,
      //    current_user_id() returns NULL and every RLS-gated feature treats
      //    the user as signed-out even though their session is valid — the
      //    "logged in but says sign in" dead state. Create the row here so no
      //    single missed callback can strand a user. RLS permits this insert
      //    because auth_user_id = auth.uid().
      if (!data) {
        const { data: created, error: insErr } = await supabase
          .from('users')
          .insert({
            auth_user_id: authUserId,
            email: email.toLowerCase(),
            name: placeholderNameFromEmail(email),
          })
          .select('id, name, email')
          .single();

        if (insErr) {
          // 23505 (unique violation) = the callback or another tab won the
          // race and inserted concurrently. Re-fetch the now-existing row.
          const r3 = await supabase
            .from('users')
            .select('id, name, email')
            .eq('auth_user_id', authUserId)
            .maybeSingle();
          data = r3.data;
          if (!data) {
            // Genuinely failed (not a race). Log and fall through to a
            // signed-out-ish state rather than throwing — better a retryable
            // null than a crash. The next refresh() will try again.
            console.error('useAuth self-heal insert failed:', insErr);
          }
        } else {
          data = created;
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
