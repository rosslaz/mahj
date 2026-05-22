import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Handles post-sign-in routing for two entry paths:
//   - Magic link: ?code=... — we exchange it for a session here.
//   - OTP code (typed on sign-in page): ?from=otp — session was already
//     established client-side by supabase.auth.verifyOtp. No code to
//     exchange, just need to do the users-row provisioning.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const fromOtp = searchParams.get('from') === 'otp';
  const next = searchParams.get('next') ?? '/';

  // Neither path gave us anything to work with → bail to sign-in.
  if (!code && !fromOtp) {
    return NextResponse.redirect(`${origin}/sign-in?error=callback`);
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options: any) { cookieStore.set({ name, value, ...options }); },
        remove(name: string, options: any) { cookieStore.set({ name, value: '', ...options }); },
      },
    }
  );

  // Magic-link flow: exchange the code for a session.
  if (code) {
    const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeErr) {
      return NextResponse.redirect(`${origin}/sign-in?error=callback`);
    }
  }
  // OTP flow: session is already in cookies; no exchange needed.

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    // OTP flow without a valid session = something went wrong client-side.
    return NextResponse.redirect(`${origin}/sign-in?error=no-session`);
  }
  const email = user.email.toLowerCase();

  // Step 1: try to link an existing users row (or confirm one is already
  // linked). The link_auth_to_user RPC is SECURITY DEFINER so it bypasses
  // RLS to find rows by email and stamp auth_user_id when missing. Returns
  // the users.id if a row exists (now linked), or null if no row exists.
  const { data: linkedId } = await supabase.rpc('link_auth_to_user');

  let userRowId: string | null = (linkedId as string | null) ?? null;
  let needsProfile = false;

  if (!userRowId) {
    // No users row for this email — create one. RLS allows insert when
    // auth_user_id = auth.uid(), so a regular insert works here.
    const placeholderName = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const { data: created, error: insErr } = await supabase
      .from('users')
      .insert({
        auth_user_id: user.id,
        email,
        name: placeholderName,
      })
      .select('id')
      .single();
    if (insErr) {
      console.error('User insert error:', insErr);
      return NextResponse.redirect(`${origin}/sign-in?error=user-create`);
    }
    userRowId = (created as any).id;
    needsProfile = true;
  }

  void userRowId;  // tracked for completeness; not used further here

  const destination = needsProfile ? '/profile?welcome=1' : next;
  return NextResponse.redirect(`${origin}${destination}`);
}
