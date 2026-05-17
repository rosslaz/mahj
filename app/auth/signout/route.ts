import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function POST() {
  const supabase = getSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'));
}

export async function GET(request: Request) {
  const supabase = getSupabase();
  await supabase.auth.signOut();
  const url = new URL('/', request.url);
  return NextResponse.redirect(url);
}
