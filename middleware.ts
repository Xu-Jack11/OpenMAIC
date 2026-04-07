import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_EXACT_PATHS = new Set([
  '/course/login',
  '/course/register',
  '/api/server-providers',
  '/api/skills',
  '/api/skills/',
  '/api/health',
  '/api/azure-voices',
  '/api/verify-model',
  '/api/verify-image-provider',
  '/api/verify-pdf-provider',
  '/api/verify-video-provider',
]);

const PUBLIC_PREFIX_PATHS = ['/api/course/auth/', '/api/skills/'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_EXACT_PATHS.has(pathname) ||
    PUBLIC_PREFIX_PATHS.some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get('session_token')?.value;
  if (!token) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/course/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|images/).*)'],
};
