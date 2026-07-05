'use client';

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
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

const AuthContext = createContext<AuthState | null>(null);

/**
 * Single app-wide auth subscription (audit #14). useAuth used to be a
 * standalone hook: every mounting component (UserMenu, club layout, activity
 * layout, the page itself, panels — 4-6 per page) created its OWN
 * onAuthStateChange listener and re-ran the users-row lookup, including the
 * link_auth_to_user RPC and the self-heal insert path, in parallel on every
 * page load. This provider runs that machinery exactly once at the root;
 * useAuth() is now a context read with an unchanged return shape, so no
 * consumer changed.
 *
 * Mounted once in app/layout.tsx. Plain createElement instead of JSX so this
 * file can stay .ts.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
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

      // 2. Not found by auth_user_id. A users row may exist from an email
      //    invite that was never linked to this auth account. Delegate the
      //    link to the server-side link_auth_to_user() RPC, which links a
      //    row by email ONLY when it is currently unlinked, and REFUSES to
      //    clobber a row already bound to a different auth account.
      //
      //    SECURITY: we do NOT trust the RPC's return value as "this row is
      //    mine" — when the matching row belongs to a different auth account
      //    the RPC leaves it untouched but STILL returns its id. So after
      //    calling it we re-fetch strictly by our OWN auth_user_id. If the
      //    RPC linked an unlinked row, this finds it; if the row belonged to
      //    someone else, this finds nothing and we fall through to self-heal
      //    (step 3), which creates a fresh row. This closes the hijack where
      //    a blind `update auth_user_id` could steal another account's row.
      if (!data) {
        await supabase.rpc('link_auth_to_user');
        const r2 = await supabase
          .from('users')
          .select('id, name, email')
          .eq('auth_user_id', authUserId)
          .maybeSingle();
        data = r2.data;
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

  return createElement(AuthContext.Provider, { value: state }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Loud by design: a missing provider means the app/layout.tsx wiring
    // broke. Failing soft (a permanent loading:true) would blank every page
    // silently, which is far harder to diagnose than this message.
    throw new Error('useAuth() requires <AuthProvider> (mounted in app/layout.tsx).');
  }
  return ctx;
}
