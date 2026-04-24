'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCourseAuthStore } from '@/lib/store/course-auth';
import { useStageStore } from '@/lib/store';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useSettingsStore } from '@/lib/store/settings';
import { saveGeneratedAgents } from '@/lib/orchestration/registry/store';
import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { ClassroomGenerationProgress } from '@/components/course/classroom-generation-progress';
import type { ClassroomStatus } from '@/lib/server/classroom-storage';
import type { Scene, Stage as StageType } from '@/lib/types/stage';
import { createLogger } from '@/lib/logger';

const log = createLogger('CourseClassroom');

interface ClassroomDetailResponse {
  success: boolean;
  error?: string;
  classroom: {
    status: ClassroomStatus;
    jobId: string | null;
  };
  content?: { stage: StageType; scenes: Scene[] } | null;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'generating'; jobId: string }
  | { kind: 'failed'; jobId: string; message: string }
  | { kind: 'ready' };

export default function CourseClassroomPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params?.courseId as string;
  const classroomId = params?.classroomId as string;

  const { isTeacher } = useCourseAuthStore();

  const [view, setView] = useState<ViewState>({ kind: 'loading' });
  const hydratedRef = useRef(false);

  const loadClassroom = useCallback(async () => {
    try {
      const res = await fetch(`/api/course/${courseId}/classrooms/${classroomId}`);
      const json = (await res.json()) as ClassroomDetailResponse;

      if (!json.success) {
        setView({ kind: 'error', message: json.error ?? 'Failed to load classroom' });
        return;
      }

      const { classroom, content } = json;

      if (classroom.status === 'generating') {
        if (!classroom.jobId) {
          setView({ kind: 'error', message: 'Classroom is generating but job id is missing' });
          return;
        }
        setView({ kind: 'generating', jobId: classroom.jobId });
        return;
      }

      if (classroom.status === 'failed') {
        if (!classroom.jobId) {
          setView({ kind: 'error', message: 'Classroom generation failed.' });
          return;
        }
        setView({
          kind: 'failed',
          jobId: classroom.jobId,
          message: 'Classroom generation failed',
        });
        return;
      }

      if (!content) {
        setView({ kind: 'error', message: 'Classroom content not available.' });
        return;
      }

      // Refetch after successful generation must not reset stage state.
      if (!hydratedRef.current) {
        hydratedRef.current = true;
        const { stage, scenes } = content;
        const store = useStageStore.getState();
        store.setStage(stage);
        useStageStore.setState({ scenes, currentSceneId: scenes[0]?.id ?? null });
        store.setCourseContext(courseId, classroomId);
        log.info('Loaded course classroom:', classroomId);

        if (stage.generatedAgentConfigs?.length) {
          const agentIds = await saveGeneratedAgents(stage.id, stage.generatedAgentConfigs);
          useSettingsStore.getState().setSelectedAgentIds(agentIds);
        }
      }

      setView({ kind: 'ready' });
    } catch (e) {
      log.error('Failed to load course classroom:', e);
      setView({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Failed to load classroom',
      });
    }
  }, [courseId, classroomId]);

  useEffect(() => {
    hydratedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset view on classroom navigation
    setView({ kind: 'loading' });

    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });
    useWhiteboardHistoryStore.getState().clearHistory();

    void loadClassroom();
  }, [courseId, classroomId, loadClassroom]);

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen flex flex-col overflow-hidden">
          {view.kind === 'loading' && (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <p className="text-muted-foreground">Loading classroom...</p>
            </div>
          )}
          {view.kind === 'error' && (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <p className="text-destructive mb-4">{view.message}</p>
                <button
                  onClick={() => router.back()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Go back
                </button>
              </div>
            </div>
          )}
          {view.kind === 'generating' && (
            <ClassroomGenerationProgress
              courseId={courseId}
              jobId={view.jobId}
              onSucceeded={() => {
                void loadClassroom();
              }}
            />
          )}
          {view.kind === 'failed' && (
            <ClassroomGenerationProgress
              courseId={courseId}
              jobId={view.jobId}
              initialFailure={{ error: view.message }}
              onSucceeded={() => {
                void loadClassroom();
              }}
            />
          )}
          {view.kind === 'ready' && <Stage readOnly={!isTeacher()} />}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
