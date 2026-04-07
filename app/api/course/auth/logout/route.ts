import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { clearSessionCookie } from '@/lib/server/auth/tokens';

export async function POST(req: NextRequest) {
  // Read token: cookie first, then Bearer header fallback
  const token =
    req.cookies.get('session_token')?.value ??
    (req.headers.get('Authorization')?.startsWith('Bearer ')
      ? req.headers.get('Authorization')!.slice(7)
      : null);

  if (!token) {
    return apiError('UNAUTHORIZED', 401, 'No session token provided');
  }

  await prisma.sessionToken.deleteMany({ where: { token } });

  const res = apiSuccess({ message: 'Logged out successfully' });
  res.headers.set('Set-Cookie', clearSessionCookie());
  return res;
}
