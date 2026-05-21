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

  // Find the users row by auth_user_id, then by email
  let { data: existing } = await supabase
    .from('users')
    .select('id, name')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!existing) {
    const { data: byEmail } = await supabase
      .from('users')
      .select('id, name, auth_user_id')
      .ilike('email', email)
      .maybeSingle();
    if (byEmail) {
      // Link the existing users row to this auth account
      if (!(byEmail as any).auth_user_id) {
        await supabase.from('users').update({ auth_user_id: user.id }).eq('id', (byEmail as any).id);
      }
      existing = byEmail as any;
    }
  }

  let needsProfile = false;
  if (!existing) {
    // Brand new user — create a placeholder row. Name defaults to the email
    // prefix; they'll be prompted to update it.
    const placeholderName = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const { error: insErr } = await supabase
      .from('users')
      .insert({
        auth_user_id: user.id,
        email,
        name: placeholderName,
      });
    if (insErr) {
      // If a uniqueness error (someone created the row in a race) just proceed.
      console.error('User insert error:', insErr);
    }
    needsProfile = true;
  } else if (!(existing as any).name || /^\w+$/.test((existing as any).name)) {
    // Stub name (email-prefix style) — invite them to complete their profile.
    needsProfile = false;
  }

  const destination = needsProfile ? '/profile?welcome=1' : next;
  return NextResponse.redirect(`${origin}${destination}`);
}
