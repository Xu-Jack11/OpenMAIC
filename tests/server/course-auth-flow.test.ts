import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = {
  authenticated: false,
};

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  sessionToken: {
    create: vi.fn(),
  },
  course: {
    create: vi.fn(),
  },
  courseMember: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  invitationCode: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@/lib/server/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/server/auth/middleware', () => ({
  authenticate: vi.fn(async () => {
    if (!authState.authenticated) return null;
    return {
      userId: 'user-1',
      user: {
        id: 'user-1',
        name: 'Test User',
        avatar: null,
      },
    };
  }),
}));

vi.mock('@/lib/server/auth/password', () => ({
  hashPassword: vi.fn(async () => 'hashed-password'),
  verifyPassword: vi.fn(),
}));

describe('course auth flow', () => {
  beforeEach(() => {
    authState.authenticated = false;
    vi.clearAllMocks();

    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-2',
      name: 'New User',
      account: 'new-user',
      avatar: null,
    });
    prismaMock.sessionToken.create.mockResolvedValue({ id: 'session-1' });

    prismaMock.$transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return input({
          user: { create: prismaMock.user.create },
          sessionToken: { create: prismaMock.sessionToken.create },
        });
      }
      return Promise.resolve(input);
    });
  });

  it('returns 401 when unauthenticated user creates course', async () => {
    const { POST } = await import('@/app/api/course/auth/create-course/route');

    const req = new Request('http://localhost/api/course/auth/create-course', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseName: 'Demo Course' }),
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      errorCode: 'UNAUTHORIZED',
    });
  });

  it('returns 401 when unauthenticated user joins course', async () => {
    const { POST } = await import('@/app/api/course/auth/join/route');

    const req = new Request('http://localhost/api/course/auth/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      errorCode: 'UNAUTHORIZED',
    });
  });

  it('registers user, creates session and returns cookie', async () => {
    const { POST } = await import('@/app/api/course/auth/register/route');

    const req = new Request('http://localhost/api/course/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New User',
        account: 'new-user',
        password: '123456',
      }),
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.user).toMatchObject({ name: 'New User' });
    expect(Array.isArray(json.courses)).toBe(true);
    expect(json.courses).toHaveLength(0);
    expect(typeof json.token).toBe('string');
    expect(res.headers.get('Set-Cookie') ?? res.headers.get('set-cookie')).toContain(
      'session_token=',
    );

    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.sessionToken.create).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when registering duplicate account', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing-user' });

    const { POST } = await import('@/app/api/course/auth/register/route');

    const req = new Request('http://localhost/api/course/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Existing User',
        account: 'existing-user',
        password: '123456',
      }),
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      errorCode: 'ACCOUNT_EXISTS',
    });
  });
});
