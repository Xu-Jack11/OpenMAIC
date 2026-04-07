'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourseAuthStore } from '@/lib/store/course-auth';
import { useStageStore } from '@/lib/store';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { createLogger } from '@/lib/logger';

const log = createLogger('CourseClassroom');

export default function CourseClassroomPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params?.courseId as string;
  const classroomId = params?.classroomId as string;

  const { isTeacher } = useCourseAuthStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const loadClassroom = useCallback(async () => {
    try {
      const res = await fetch(`/api/course/${courseId}/classrooms/${classroomId}`);
      const json = await res.json();

      if (!json.success) {
        setError(json.error ?? 'Failed to load classroom');
        return;
      }

      const { classroom, content } = json;

      if (classroom.status === 'generating') {
        setError('This classroom is still being generated. Please check back later.');
        return;
      }
      if (classroom.status === 'failed') {
        setError('Classroom generation failed.');
        return;
      }
      if (!content) {
        setError('Classroom content not available.');
        return;
      }

      const { stage, scenes } = content;
      const store = useStageStore.getState();
      store.setStage(stage);
      useStageStore.setState({ scenes, currentSceneId: scenes[0]?.id ?? null });
      store.setCourseContext(courseId, classroomId);
      log.info('Loaded course classroom:', classroomId);

      // Hydrate server-generated agents if present
      if (stage.generatedAgentConfigs?.length) {
        const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
        const { useSettingsStore } = await import('@/lib/store/settings');
        const agentIds = await saveGeneratedAgents(stage.id, stage.generatedAgentConfigs);
        useSettingsStore.getState().setSelectedAgentIds(agentIds);
      }
    } catch (e) {
      log.error('Failed to load course classroom:', e);
      setError(e instanceof Error ? e.message : 'Failed to load classroom');
    } finally {
      setLoading(false);
    }
  }, [courseId, classroomId]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    setLoading(true);
    setError(null);

    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });
    useWhiteboardHistoryStore.getState().clearHistory();

    loadClassroom();
  }, [courseId, classroomId, loadClassroom]);

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <p className="text-muted-foreground">Loading classroom...</p>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <p className="text-destructive mb-4">{error}</p>
                <button
                  onClick={() => router.back()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Go back
                </button>
              </div>
            </div>
          ) : (
            <Stage readOnly={!isTeacher()} />
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
