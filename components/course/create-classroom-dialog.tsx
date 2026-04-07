'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { AgentBar } from '@/components/agent/agent-bar';
import { SpeechButton } from '@/components/audio/speech-button';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { SettingsDialog } from '@/components/settings';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { nanoid } from 'nanoid';
import { storePdfBlob } from '@/lib/utils/image-storage';
import type { SettingsSection } from '@/lib/types/settings';
import type { UserRequirements } from '@/lib/types/generation';
import type { GenerationSessionState } from '@/app/(authenticated)/generation-preview/types';

const log = createLogger('CreateClassroomDialog');

const LANGUAGE_STORAGE_KEY = 'generationLanguage';
const WEB_SEARCH_STORAGE_KEY = 'webSearchEnabled';

type CreateClassroomDialogProps = {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormState = {
  pdfFile: File | null;
  requirement: string;
  language: 'zh-CN' | 'en-US';
  webSearch: boolean;
};

const initialFormState: FormState = {
  pdfFile: null,
  requirement: '',
  language: 'zh-CN',
  webSearch: false,
};

function GreetingPill() {
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const displayName = nickname || t('profile.defaultNickname');

  return (
    <div className="flex items-center gap-2.5 rounded-full px-2.5 py-1.5 border border-border/50 text-muted-foreground/70 bg-background/50">
      <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-border/30">
        <img src={avatar} alt="" className="size-full object-cover" />
      </div>
      <span className="leading-none select-none flex items-center gap-1">
        <span className="text-xs text-muted-foreground/60">{t('home.greeting')}</span>
        <span className="text-[13px] font-semibold text-foreground/85">{displayName}</span>
      </span>
    </div>
  );
}

export function CreateClassroomDialog({ courseId, open, onOpenChange }: CreateClassroomDialogProps) {
  const { t } = useI18n();
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentModelId = useSettingsStore((s) => s.modelId);

  const [form, setForm] = useState<FormState>(initialFormState);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);

  const canGenerate = !!form.requirement.trim() && !submitting;

  useEffect(() => {
    if (!open) return;

    try {
      const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      const savedWebSearch = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);

      setForm((prev) => ({
        ...prev,
        language:
          savedLanguage === 'zh-CN' || savedLanguage === 'en-US'
            ? savedLanguage
            : prev.language,
        webSearch: savedWebSearch === 'true' ? true : prev.webSearch,
      }));
    } catch {
      // ignore localStorage failures
    }

    const id = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));

    try {
      if (field === 'language') {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, String(value));
      }
      if (field === 'webSearch') {
        localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(value));
      }
    } catch {
      // ignore localStorage failures
    }
  };

  const handleGenerate = async () => {
    if (!currentModelId) {
      setError(t('settings.modelNotConfigured'));
      setSettingsOpen(true);
      return;
    }

    if (!form.requirement.trim()) {
      setError(t('upload.requirementRequired'));
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: form.requirement,
        language: form.language,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        webSearch: form.webSearch || undefined,
      };

      let pdfStorageKey: string | undefined;
      let pdfFileName: string | undefined;
      let pdfProviderId: string | undefined;
      let pdfProviderConfig: { apiKey?: string; baseUrl?: string } | undefined;

      if (form.pdfFile) {
        pdfStorageKey = await storePdfBlob(form.pdfFile);
        pdfFileName = form.pdfFile.name;

        const settings = useSettingsStore.getState();
        pdfProviderId = settings.pdfProviderId;
        const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
        if (providerCfg) {
          pdfProviderConfig = {
            apiKey: providerCfg.apiKey,
            baseUrl: providerCfg.serverBaseUrl || providerCfg.baseUrl,
          };
        }
      }

      const sessionState: GenerationSessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        pdfStorageKey,
        pdfFileName,
        pdfProviderId,
        pdfProviderConfig,
        sceneOutlines: null,
        currentStep: 'generating',
      };

      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));
      sessionStorage.setItem('generationCourseId', courseId);

      onOpenChange(false);
      router.push('/generation-preview');
    } catch (err) {
      log.error('Error preparing generation session:', err);
      setError(err instanceof Error ? err.message : t('upload.generateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canGenerate) {
        void handleGenerate();
      }
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-w-5xl p-0 overflow-hidden border border-border/60 bg-white/90 dark:bg-slate-900/90"
        >
          <DialogTitle className="sr-only">{t('course.dashboardCreateClassroom')}</DialogTitle>

          <div className="w-full rounded-2xl border border-border/20 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl shadow-black/[0.03] dark:shadow-black/20">
            <div className="relative z-20 flex items-start justify-between px-3 pt-3">
              <GreetingPill />
              <div className="shrink-0 pl-2">
                <AgentBar />
              </div>
            </div>

            <textarea
              ref={textareaRef}
              data-testid="create-classroom-requirement"
              placeholder={t('upload.requirementPlaceholder')}
              className="w-full resize-none border-0 bg-transparent px-4 pt-1 pb-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none min-h-[160px] max-h-[320px]"
              value={form.requirement}
              onChange={(e) => updateForm('requirement', e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
            />

            <div className="px-3 pb-3 flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <GenerationToolbar
                  language={form.language}
                  onLanguageChange={(lang) => updateForm('language', lang)}
                  webSearch={form.webSearch}
                  onWebSearchChange={(v) => updateForm('webSearch', v)}
                  onSettingsOpen={(section) => {
                    setSettingsSection(section);
                    setSettingsOpen(true);
                  }}
                  pdfFile={form.pdfFile}
                  onPdfFileChange={(file) => updateForm('pdfFile', file)}
                  onPdfError={setError}
                />
              </div>

              <SpeechButton
                size="md"
                onTranscription={(text) => {
                  setForm((prev) => ({
                    ...prev,
                    requirement: prev.requirement + (prev.requirement ? ' ' : '') + text,
                  }));
                }}
              />

              <button
                data-testid="create-classroom-submit"
                onClick={() => {
                  void handleGenerate();
                }}
                disabled={!canGenerate}
                className={cn(
                  'shrink-0 h-8 rounded-lg flex items-center justify-center gap-1.5 transition-all px-3',
                  canGenerate
                    ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm cursor-pointer'
                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                <span className="text-xs font-medium">{t('toolbar.enterClassroom')}</span>
                <ArrowUp className="size-3.5" />
              </button>
            </div>

            {error && (
              <div className="px-3 pb-3">
                <div className="w-full p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSection={settingsSection}
      />
    </>
  );
}
