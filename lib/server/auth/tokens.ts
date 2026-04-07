import { randomBytes } from 'crypto';

export function generateSessionToken(): string {
  return randomBytes(16).toString('hex'); // 32-char hex
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateInvitationCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

export const SESSION_EXPIRY_DAYS = 30;
const SESSION_MAX_AGE = SESSION_EXPIRY_DAYS * 24 * 60 * 60; // seconds

export function sessionExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_EXPIRY_DAYS);
  return d;
}

export function createSessionCookie(token: string): string {
  return `session_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return 'session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
