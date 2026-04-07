'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCourseAuthStore } from '@/lib/store/course-auth';
import { getClientTranslation } from '@/lib/i18n';

const t = (k: string) => getClientTranslation(k);

function getSafeNextPath(): string | null {
  if (typeof window === 'undefined') return null;
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') ? next : null;
}

export default function CourseRegisterPage() {
  const router = useRouter();
  const { setLoginSession } = useCourseAuthStore();

  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/course/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, account, password }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error ?? 'Unknown error');
        return;
      }

      const courses = Array.isArray(json.courses) ? json.courses : [];
      setLoginSession(json.token ?? null, json.user, courses);

      const nextPath = getSafeNextPath();
      if (nextPath) {
        router.push(nextPath);
        return;
      }

      if (courses.length === 1) {
        router.push(`/course/${courses[0].id}`);
        return;
      }

      router.push('/course/create');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  function goToLogin() {
    const search = typeof window === 'undefined' ? '' : window.location.search;
    router.push(`/course/login${search}`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-semibold mb-6">{t('course.registerTitle')}</h1>

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('course.createNameLabel')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('course.createNamePlaceholder')}
              required
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('course.accountLabel')}</label>
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={t('course.accountPlaceholder')}
              required
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('course.passwordLabel')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('course.passwordPlaceholder')}
              required
              minLength={6}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? t('common.loading') : t('course.registerTitle')}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            {t('course.alreadyHaveAccount')}{' '}
            <button type="button" onClick={goToLogin} className="text-primary hover:underline">
              {t('course.loginTitle')}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
