'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { StepVisualizer } from '@/components/generation/step-visualizer';
import { AgentActivityTree } from '@/components/generation/agent-activity-tree';
import { createLogger } from '@/lib/logger';

const STICK_TO_BOTTOM_THRESHOLD_PX = 24;

/**
 * Scrollable container that auto-follows new content as long as the user is
 * pinned near the bottom. Scrolling up releases the pin; scrolling back to
 * the bottom re-engages it. Relies on MutationObserver so it works regardless
 * of how children update their DOM.
 */
function AutoFollowScroll({ className, children }: { className?: string; children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;

    const isAtBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX;

    const onScroll = () => {
      pinnedRef.current = isAtBottom();
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    const observer = new MutationObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={scrollRef} className={className}>
      {children}
    </div>
  );
}

const log = createLogger('ClassroomGenerationProgress');

const POLL_INTERVAL_MS = 5000;

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

interface JobPollResponse {
  success: boolean;
  jobId?: string;
  status?: JobStatus;
  step?: string;
  progress?: number;
  message?: string;
  scenesGenerated?: number;
  totalScenes?: number;
  error?: string;
  done?: boolean;
}

interface ProgressSnapshot {
  status: JobStatus;
  step: string;
  progress: number;
  message: string;
  scenesGenerated: number;
  totalScenes?: number;
  error?: string;
}

interface Props {
  courseId: string;
  jobId: string;
  /** Seed the view with a failure state before the first poll returns. */
  initialFailure?: { error: string };
  onSucceeded: () => void;
}

function snapshotEquals(a: ProgressSnapshot, b: ProgressSnapshot): boolean {
  return (
    a.status === b.status &&
    a.step === b.step &&
    a.progress === b.progress &&
    a.message === b.message &&
    a.scenesGenerated === b.scenesGenerated &&
    a.totalScenes === b.totalScenes &&
    a.error === b.error
  );
}

type VisualizerStepId = 'pdf-analysis' | 'web-search' | 'outline' | 'slide-content' | 'actions';

interface VisualizerMapping {
  id: VisualizerStepId;
  titleKey: string;
  descriptionKey: string;
}

// Maps server ClassroomGenerationStep → a StepVisualizer id plus i18n labels.
// Unmapped steps (`completed`, unknown) return null and the visualizer area is hidden.
function mapServerStep(serverStep: string): VisualizerMapping | null {
  switch (serverStep) {
    case 'researching':
      return {
        id: 'web-search',
        titleKey: 'generation.webSearching',
        descriptionKey: 'generation.webSearchingDesc',
      };
    case 'initializing':
    case 'queued':
    case 'generating_outlines':
      return {
        id: 'outline',
        titleKey: 'generation.generatingOutlines',
        descriptionKey: 'generation.generatingOutlinesDesc',
      };
    case 'generating_scenes':
      return {
        id: 'slide-content',
        titleKey: 'generation.generatingSlideContent',
        descriptionKey: 'generation.generatingSlideContentDesc',
      };
    case 'generating_media':
    case 'generating_tts':
    case 'persisting':
      return {
        id: 'actions',
        titleKey: 'generation.generatingActions',
        descriptionKey: 'generation.generatingActionsDesc',
      };
    default:
      return null;
  }
}

export function ClassroomGenerationProgress({
  courseId,
  jobId,
  initialFailure,
  onSucceeded,
}: Props) {
  const { t } = useI18n();
  const router = useRouter();

  const [snapshot, setSnapshot] = useState<ProgressSnapshot>(() => ({
    status: initialFailure ? 'failed' : 'running',
    step: 'queued',
    progress: 0,
    message: '',
    scenesGenerated: 0,
    error: initialFailure?.error,
  }));

  const onSucceededRef = useRef(onSucceeded);
  useEffect(() => {
    onSucceededRef.current = onSucceeded;
  }, [onSucceeded]);

  useEffect(() => {
    let cancelled = false;
    let currentController: AbortController | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const poll = async () => {
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;
      try {
        const res = await fetch(`/api/generate-classroom/${jobId}`, {
          signal: controller.signal,
        });
        if (res.status === 404) {
          if (cancelled) return;
          setSnapshot((prev) => {
            const next: ProgressSnapshot = {
              ...prev,
              status: 'failed',
              error: t('course.classroomGenerationMissing'),
            };
            return snapshotEquals(prev, next) ? prev : next;
          });
          stopPolling();
          return;
        }
        const json = (await res.json()) as JobPollResponse;
        if (cancelled || !json.success || !json.status) return;
        const next: ProgressSnapshot = {
          status: json.status,
          step: json.step ?? 'running',
          progress: json.progress ?? 0,
          message: json.message ?? '',
          scenesGenerated: json.scenesGenerated ?? 0,
          totalScenes: json.totalScenes,
          error: json.error,
        };
        setSnapshot((prev) => (snapshotEquals(prev, next) ? prev : next));
        if (json.done) {
          stopPolling();
          if (json.status === 'succeeded') onSucceededRef.current();
        }
      } catch (err) {
        if ((err as { name?: string } | undefined)?.name === 'AbortError') return;
        log.warn('Progress poll failed:', err);
      }
    };

    void poll();
    timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopPolling();
      currentController?.abort();
    };
  }, [jobId, t]);

  const pct = Math.max(0, Math.min(100, Math.round(snapshot.progress)));
  const isFailed = snapshot.status === 'failed';
  const visualizer = isFailed ? null : mapServerStep(snapshot.step);

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-12 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-2xl space-y-6">
        {isFailed ? (
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex justify-center">
              <AlertCircle className="size-8 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold">{t('course.classroomGenerationFailedTitle')}</h2>
            <p className="text-sm text-muted-foreground">{snapshot.error ?? snapshot.message}</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white/90 p-8 shadow-sm backdrop-blur-xl dark:border-gray-700 dark:bg-slate-900/80">
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-4">
                {visualizer ? (
                  <StepVisualizer stepId={visualizer.id} />
                ) : (
                  <div className="h-32 w-32" />
                )}
                <div className="text-center">
                  <h2 className="text-lg font-semibold">
                    {visualizer ? t(visualizer.titleKey) : t('course.classroomGenerationTitle')}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {visualizer
                      ? t(visualizer.descriptionKey)
                      : t('course.classroomGenerationDescription')}
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full bg-primary transition-all duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{snapshot.message || snapshot.step}</span>
                  <span>{pct}%</span>
                </div>
                {typeof snapshot.totalScenes === 'number' && snapshot.totalScenes > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('course.classroomGenerationScenes')
                      .replace('{done}', String(snapshot.scenesGenerated))
                      .replace('{total}', String(snapshot.totalScenes))}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white/90 shadow-sm backdrop-blur-xl dark:border-gray-700 dark:bg-slate-900/80">
              <AutoFollowScroll className="h-[360px] overflow-y-auto overscroll-contain p-6">
                <AgentActivityTree jobId={jobId} />
              </AutoFollowScroll>
            </div>
          </>
        )}

        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => router.push(`/course/${courseId}`)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white/70 px-4 py-2 text-sm text-foreground hover:bg-gray-100 dark:border-gray-700 dark:bg-slate-900/50 dark:hover:bg-gray-700"
          >
            <ArrowLeft className="size-4" />
            {t('course.classroomGenerationBack')}
          </button>
        </div>
      </div>
    </div>
  );
}
