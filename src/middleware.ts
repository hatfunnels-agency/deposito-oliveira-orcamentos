import { NextRequest, NextResponse } from 'next/server';

// Routes that don't require authentication
const PUBLIC_ROUTES = ['/login'];

// API routes use service role key - don't protect them via middleware
const API_PREFIX = '/api/';

// Cookie name that Supabase uses for the session
const SUPABASE_AUTH_COOKIE = 'sb-vfdoaocrafbcktnkhyvo-auth-token';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for API routes (they use service role key)
  if (pathname.startsWith(API_PREFIX)) {
    return NextResponse.next();
  }

  // Skip for public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Check if Supabase auth cookie exists and has a valid access token
  const authCookie = request.cookies.get(SUPABASE_AUTH_COOKIE);

  if (!authCookie?.value) {
    const redirectUrl = new URL('/login', request.url);
    return NextResponse.redirect(redirectUrl);
  }

  try {
    // Parse the cookie value and check for access_token
    const sessionData = JSON.parse(decodeURIComponent(authCookie.value));
    if (!sessionData?.access_token) {
      const redirectUrl = new URL('/login', request.url);
      return NextResponse.redirect(redirectUrl);
    }
  } catch {
    // If we can't parse the cookie, redirect to login
    const redirectUrl = new URL('/login', request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.png|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
