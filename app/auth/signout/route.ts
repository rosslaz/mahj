import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function POST(request: Request) {
  const supabase = getSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}

export async function GET(request: Request) {
  const supabase = getSupabase();
  await supabase.auth.signOut();
  const url = new URL('/', request.url);
  return NextResponse.redirect(url);
}
