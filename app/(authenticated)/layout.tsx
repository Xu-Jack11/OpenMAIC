'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useCourseAuthStore } from '@/lib/store/course-auth';
import { CourseSidebar } from '@/components/course-sidebar';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { refreshSession } = useCourseAuthStore();
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  // Hide sidebar in classroom viewer (it has its own scene sidebar)
  const isClassroomViewer = /\/course\/[^/]+\/classroom\/[^/]+/.test(pathname);
  // Hide sidebar in generation-preview
  const isGenerationPreview = pathname.startsWith('/generation-preview');
  const showSidebar = !isClassroomViewer && !isGenerationPreview;

  useEffect(() => {
    refreshSession().then((ok) => {
      if (!ok) {
        window.location.href = '/course/login';
      } else {
        setReady(true);
      }
    });

    // Re-validate on tab focus
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshSession().then((ok) => {
          if (!ok) window.location.href = '/course/login';
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refreshSession]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!showSidebar) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <CourseSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
