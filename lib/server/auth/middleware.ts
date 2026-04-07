import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/db';
// Role type matches the Prisma schema enum

export interface AuthContext {
  userId: string;
  user: { id: string; name: string; avatar: string | null };
}

export interface CourseAuthContext extends AuthContext {
  courseId: string;
  role: 'TEACHER' | 'STUDENT';
  membershipId: string;
}

/** Extract session token from cookie (primary) or Bearer header (fallback) and validate. */
export async function authenticate(req: NextRequest): Promise<AuthContext | null> {
  const token =
    req.cookies.get('session_token')?.value ??
    (req.headers.get('Authorization')?.startsWith('Bearer ')
      ? req.headers.get('Authorization')!.slice(7)
      : null);
  if (!token || token.length !== 32) return null;

  const session = await prisma.sessionToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  });

  if (!session || session.expiresAt < new Date()) return null;

  return { userId: session.user.id, user: session.user };
}

/** Authenticate + verify course membership, optionally requiring TEACHER role. */
export async function authenticateCourse(
  req: NextRequest,
  courseId: string,
  requiredRole?: 'TEACHER',
): Promise<CourseAuthContext | null> {
  const auth = await authenticate(req);
  if (!auth) return null;

  const membership = await prisma.courseMember.findUnique({
    where: { courseId_userId: { courseId, userId: auth.userId } },
  });

  if (!membership) return null;
  if (requiredRole === 'TEACHER' && membership.role !== 'TEACHER') return null;

  return {
    ...auth,
    courseId,
    role: membership.role,
    membershipId: membership.id,
  };
}
