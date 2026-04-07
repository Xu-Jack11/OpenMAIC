'use client';

import { useRouter } from 'next/navigation';
import { BookOpen } from 'lucide-react';
import { useCourseAuthStore, type CourseInfo } from '@/lib/store/course-auth';
import { getClientTranslation } from '@/lib/i18n';

const t = (k: string) => getClientTranslation(k);

export default function DashboardPage() {
  const router = useRouter();
  const { courses } = useCourseAuthStore();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h2 className="text-lg font-medium mb-6">{t('course.myCourses')}</h2>

        {courses.length === 0 ? (
          <div className="text-center py-20">
            <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground">{t('course.noCourses')}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course: CourseInfo) => (
              <button
                key={course.id}
                onClick={() => router.push(`/course/${course.id}`)}
                className="text-left p-5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-primary/50 hover:shadow-md transition-all"
              >
                <h3 className="font-medium mb-1 truncate">{course.name}</h3>
                {course.description && (
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                    {course.description}
                  </p>
                )}
                <span
                  className={`inline-block text-xs px-2 py-0.5 rounded-full ${
                    course.role === 'TEACHER'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  }`}
                >
                  {course.role === 'TEACHER' ? t('course.roleTeacher') : t('course.roleStudent')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
