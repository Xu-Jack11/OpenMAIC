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

export default function CourseLoginPage() {
  const router = useRouter();
  const { setLoginSession, isAuthenticated, courses, switchCourse, clearSession } =
    useCourseAuthStore();

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticated = isAuthenticated();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/course/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, password }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error ?? t('course.loginError'));
        return;
      }

      setLoginSession(json.token ?? null, json.user, json.courses);

      const nextPath = getSafeNextPath();
      if (nextPath) {
        router.push(nextPath);
        return;
      }

      if (json.courses.length === 1) {
        router.push(`/course/${json.courses[0].id}`);
        return;
      }

      if (json.courses.length === 0) {
        router.push('/course/create');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  function goToRegister() {
    const search = typeof window === 'undefined' ? '' : window.location.search;
    router.push(`/course/register${search}`);
  }

  if (authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 space-y-4">
          <h1 className="text-2xl font-semibold">{t('course.loginTitle')}</h1>

          {courses.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">{t('course.myCourses')}</h2>
              {courses.map((course) => (
                <button
                  key={course.id}
                  onClick={() => {
                    switchCourse(course);
                    router.push(`/course/${course.id}`);
                  }}
                  className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <p className="font-medium">{course.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {course.role === 'TEACHER' ? t('course.roleTeacher') : t('course.roleStudent')}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('course.noCourses')}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => router.push('/course/create')}
              className="py-2 px-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
            >
              {t('course.tabCreate')}
            </button>
            <button
              onClick={() => router.push('/course/join')}
              className="py-2 px-3 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t('course.tabJoin')}
            </button>
          </div>

          <button
            onClick={async () => {
              await clearSession();
              router.refresh();
            }}
            className="w-full py-2 px-4 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-muted-foreground hover:text-foreground"
          >
            {t('course.logout')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-semibold mb-6">{t('course.loginTitle')}</h1>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('course.loginAccount')}</label>
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={t('course.loginAccountPlaceholder')}
              required
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t('course.loginPassword')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('course.loginPasswordPlaceholder')}
              required
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? t('common.loading') : t('course.loginSubmit')}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            {t('course.noAccount')}{' '}
            <button type="button" onClick={goToRegister} className="text-primary hover:underline">
              {t('course.registerTitle')}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
