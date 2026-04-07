import { describe, expect, it, vi, beforeEach } from 'vitest';

const authState = {
  authenticated: false,
  role: 'STUDENT' as 'TEACHER' | 'STUDENT',
  userId: 'user-1',
};

vi.mock('@/lib/server/db', () => ({
  prisma: {
    classroom: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'classroom-1',
        courseId: 'course-1',
        storageId: 'storage-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        name: 'Demo Classroom',
      }),
      create: vi.fn().mockResolvedValue({
        id: 'classroom-1',
        storageId: 'storage-1',
      }),
      update: vi.fn().mockResolvedValue({ id: 'classroom-1' }),
    },
  },
}));

vi.mock('@/lib/server/auth/middleware', () => ({
  authenticate: vi.fn(async () => {
    if (!authState.authenticated) return null;
    return {
      userId: authState.userId,
      user: { id: authState.userId, name: 'Test User', avatar: null },
    };
  }),
  authenticateCourse: vi.fn(async () => {
    if (!authState.authenticated) return null;
    return {
      userId: authState.userId,
      user: { id: authState.userId, name: 'Test User', avatar: null },
      courseId: 'course-1',
      role: authState.role,
      membershipId: 'membership-1',
    };
  }),
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  ensureClassroomsDir: vi.fn().mockResolvedValue(undefined),
  writeJsonFileAtomic: vi.fn().mockResolvedValue(undefined),
  CLASSROOMS_DIR: '/tmp/classrooms',
}));

describe('course write auth', () => {
  beforeEach(() => {
    authState.authenticated = false;
    authState.role = 'STUDENT';
    authState.userId = 'user-1';
    vi.clearAllMocks();
  });

  it('returns 403 when student writes classroom content', async () => {
    authState.authenticated = true;
    authState.role = 'STUDENT';

    const { PATCH } = await import(
      '@/app/api/course/[courseId]/classrooms/[classroomId]/content/route'
    );

    const req = new Request('http://localhost/api/course/course-1/classrooms/classroom-1/content', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: { id: 'stage-1', name: 'Stage', createdAt: Date.now(), updatedAt: Date.now() },
        scenes: [],
      }),
    });

    const res = await PATCH(req as unknown as Parameters<typeof PATCH>[0], {
      params: Promise.resolve({ courseId: 'course-1', classroomId: 'classroom-1' }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      errorCode: 'FORBIDDEN',
    });
  });

  it('returns 403 when student imports classroom', async () => {
    authState.authenticated = true;
    authState.role = 'STUDENT';

    const { POST } = await import('@/app/api/course/[courseId]/classrooms/import/route');

    const req = new Request('http://localhost/api/course/course-1/classrooms/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: {
          id: 'stage-1',
          name: 'Stage',
          description: '',
          language: 'zh-CN',
          style: 'professional',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        scenes: [{ id: 'scene-1', stageId: 'stage-1', type: 'slide', title: 'S1', order: 0, content: {} }],
      }),
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0], {
      params: Promise.resolve({ courseId: 'course-1' }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      errorCode: 'FORBIDDEN',
    });
  });
});
