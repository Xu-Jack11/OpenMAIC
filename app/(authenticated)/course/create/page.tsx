'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCourseAuthStore } from '@/lib/store/course-auth';
import { getClientTranslation } from '@/lib/i18n';

export default function CreateCoursePage() {
  const router = useRouter();
  const { token, setSession } = useCourseAuthStore();
  const t = (k: string) => getClientTranslation(k);
  const [courseName, setCourseName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/course/auth/create-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseName }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? 'Unknown error');
        return;
      }
      setSession(json.token ?? token ?? null, json.user, { ...json.course, role: json.role });
      router.push(`/course/${json.course.id}`);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        <h1 className="text-2xl font-semibold mb-6">{t('course.createTitle')}</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              {t('course.createCourseNameLabel')}
            </label>
            <input
              type="text"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder={t('course.createCourseNamePlaceholder')}
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
            {loading ? t('common.loading') : t('course.createSubmit')}
          </button>
        </form>
      </div>
    </div>
  );
}
