import { NextResponse, type NextRequest } from 'next/server';
import { DEV_COOKIE } from '@/lib/auth/dev';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  response.cookies.delete(DEV_COOKIE);
  return response;
}
