'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Plus, LogIn, LogOut, BookOpen } from 'lucide-react';
import { useCourseAuthStore } from '@/lib/store/course-auth';
import { getClientTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const t = (k: string) => getClientTranslation(k);

export function CourseSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, courses, clearSession } = useCourseAuthStore();

  // Extract current courseId from URL
  const courseIdMatch = pathname.match(/\/course\/([^/]+)/);
  const activeCourseId = courseIdMatch?.[1] ?? null;

  return (
    <aside className="w-64 shrink-0 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => router.push('/')}
          className="text-lg font-semibold hover:text-primary transition-colors"
        >
          OpenMAIC
        </button>
      </div>

      {/* New course button */}
      <div className="p-3">
        <button
          onClick={() => router.push('/course/create')}
          className="w-full flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('course.tabCreate')}
        </button>
      </div>

      {/* Course list */}
      <div className="flex-1 overflow-y-auto px-3">
        {courses.length === 0 ? (
          <div className="text-center py-8">
            <BookOpen className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{t('course.noCourses')}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {courses.map((course) => (
              <button
                key={course.id}
                onClick={() => router.push(`/course/${course.id}`)}
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors',
                  activeCourseId === course.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-gray-100 dark:hover:bg-gray-700',
                )}
              >
                <p className="truncate">{course.name}</p>
                <span
                  className={cn(
                    'inline-block text-[10px] px-1.5 py-0.5 rounded mt-0.5',
                    course.role === 'TEACHER'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                  )}
                >
                  {course.role === 'TEACHER' ? t('course.roleTeacher') : t('course.roleStudent')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Join course */}
      <div className="px-3 pb-2">
        <button
          onClick={() => router.push('/course/join')}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          <LogIn className="w-4 h-4" />
          {t('course.tabJoin')}
        </button>
      </div>

      {/* User footer */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium shrink-0">
              {user?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="text-sm truncate">{user?.name}</span>
          </div>
          <button
            onClick={async () => {
              await clearSession();
              window.location.href = '/course/login';
            }}
            className="text-muted-foreground hover:text-foreground p-1"
            title={t('course.logout')}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
