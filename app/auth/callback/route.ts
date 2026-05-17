import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
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

  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    return NextResponse.redirect(`${origin}/sign-in?error=callback`);
  }

  // We now have a session. Ensure a users row exists.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.redirect(`${origin}${next}`);
  }
  const email = user.email.toLowerCase();

  // Find by auth_user_id first, then by email
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

  // If brand new, route them to profile to set their name. Otherwise the requested `next`.
  const destination = needsProfile ? '/profile?welcome=1' : next;
  return NextResponse.redirect(`${origin}${destination}`);
}
