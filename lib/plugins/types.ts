import type { ExportableDocument, ExportFormat } from '@/lib/export/document/types';
import type { Locale } from '@/lib/i18n';
import type { Scene, Stage } from '@/lib/types/stage';
import type { LucideIcon } from 'lucide-react';

export interface PluginInput {
  scenes: Scene[];
  stage: Stage;
  locale: Locale;
}

export interface GenerationPlugin {
  id: string;
  icon: LucideIcon;
  /** i18n key prefix, e.g. 'supplementary.handout' → t('supplementary.handout.title') */
  i18nPrefix: string;
  supportedFormats: ExportFormat[];
  /** Call API to generate, returns raw data */
  generate: (input: PluginInput) => Promise<unknown>;
  /** Raw data → ExportableDocument for export */
  toDocument: (data: unknown, locale: Locale) => ExportableDocument;
  /** Preview component rendered inside the dialog */
  PreviewComponent: React.ComponentType<{ data: unknown }>;
  /** Optional: return guidance text to inject into outline generation prompt.
   *  Should be 1-2 concise sentences describing how outlines should accommodate this plugin. */
  getOutlineGuidance?: (language: string) => string | null;
}
