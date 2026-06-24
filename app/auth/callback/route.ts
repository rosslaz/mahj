import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Handles post-sign-in routing for two entry paths:
//   - Magic link: ?code=... — we exchange it for a session here.
//   - OTP code (typed on sign-in page): ?from=otp — session was already
//     established client-side by supabase.auth.verifyOtp. No code to
//     exchange, just need to do the users-row provisioning.
export async function GET(request: NextRequest) {
  const reqUrl = new URL(request.url);
  const { searchParams } = reqUrl;
  // Canonical origin for every redirect below. Behind Vercel's proxy,
  // request.url can carry the internal deployment host (*.vercel.app)
  // rather than the domain the user is actually on; redirecting there sets
  // the auth cookies on the wrong host and the user lands "signed out".
  // x-forwarded-host/-proto preserve the original request's host; raw
  // request.url remains the fallback for local dev. (Same bug class as the
  // signout-route fix.)
  const fwdHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const fwdProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const origin = fwdHost
    ? (fwdProto || 'https') + '://' + fwdHost
    : reqUrl.origin;
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

  // Step 1: provision (or fetch) the caller's users row via a SECURITY DEFINER
  // RPC. This handles all three cases safely without tripping the users_insert
  // RLS policy (which rejected the old direct insert with 42501 for brand-new
  // accounts — see migration 0032):
  //   - already linked  → returns (id, created=false)
  //   - exists by email → links it, returns (id, created=false)
  //   - brand new       → inserts it, returns (id, created=true)
  const { data: provisioned, error: provErr } = await supabase
    .rpc('provision_user_row')
    .single();

  if (provErr || !provisioned) {
    console.error('provision_user_row error:', provErr);
    return NextResponse.redirect(`${origin}/sign-in?error=user-create`);
  }

  const needsProfile = (provisioned as any).created === true;

  const destination = needsProfile ? '/profile?welcome=1' : next;
  return NextResponse.redirect(`${origin}${destination}`);
}
