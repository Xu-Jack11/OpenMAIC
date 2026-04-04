'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store/stage';
import { useDocumentExport } from '@/lib/export/document/use-document-export';
import type { ExportFormat } from '@/lib/export/document/types';
import type { GenerationPlugin } from '@/lib/plugins/types';
import type { Locale } from '@/lib/i18n';

interface PluginDialogProps {
  plugin: GenerationPlugin | null;
  onClose: () => void;
}

export function PluginDialog({ plugin, onClose }: PluginDialogProps) {
  const { t, locale } = useI18n();
  const { exporting, exportDocument } = useDocumentExport();
  const [generating, setGenerating] = useState(false);
  const [data, setData] = useState<unknown>(null);
  const [format, setFormat] = useState<ExportFormat>('docx');

  const open = plugin !== null;

  const document = useMemo(() => {
    if (!data || !plugin) return null;
    return plugin.toDocument(data, locale as Locale);
  }, [data, plugin, locale]);

  useEffect(() => {
    if (!open) {
      setData(null);
      setGenerating(false);
    }
  }, [open]);

  const handleGenerate = useCallback(async () => {
    if (!plugin) return;

    const scenes = useStageStore.getState().scenes;
    const stage = useStageStore.getState().stage;

    if (!scenes.length || !stage) {
      toast.error(t('supplementary.common.generateFailed'));
      return;
    }

    setGenerating(true);
    setData(null);

    try {
      const result = await plugin.generate({ scenes, stage, locale: locale as Locale });
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${t('supplementary.common.generateFailed')}: ${message}`);
    } finally {
      setGenerating(false);
    }
  }, [plugin, t, locale]);

  const handleExport = useCallback(async () => {
    if (!document || !plugin) return;
    await exportDocument(document, format, plugin.id);
  }, [document, format, plugin, exportDocument]);

  if (!plugin) return null;

  const PreviewComponent = plugin.PreviewComponent;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogTitle>{t(`${plugin.i18nPrefix}.title`)}</DialogTitle>
        <DialogDescription>{t(`${plugin.i18nPrefix}.description`)}</DialogDescription>

        {data === null && !generating && (
          <div className="flex justify-center py-8">
            <Button onClick={handleGenerate}>{t(`${plugin.i18nPrefix}.generate`)}</Button>
          </div>
        )}

        {generating && (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>{t(`${plugin.i18nPrefix}.generating`)}</span>
          </div>
        )}

        {data !== null && !generating && (
          <div className="flex-1 overflow-y-auto border rounded-lg p-4 bg-gray-50 dark:bg-gray-900 text-sm leading-relaxed">
            <PreviewComponent data={data} />
          </div>
        )}

        {data !== null && !generating && (
          <DialogFooter className="flex items-center gap-2 sm:justify-between">
            <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
              {t('supplementary.common.regenerate')}
            </Button>
            <div className="flex items-center gap-2">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
                className="h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm"
              >
                {plugin.supportedFormats.map((f) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()}
                  </option>
                ))}
              </select>
              <Button onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                {t('supplementary.common.export')}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
