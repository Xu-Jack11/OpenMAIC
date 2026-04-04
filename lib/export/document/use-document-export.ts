'use client';

import { useState, useCallback } from 'react';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { ExportableDocument, ExportFormat } from './types';

export function useDocumentExport() {
  const { t } = useI18n();
  const [exporting, setExporting] = useState(false);

  const exportDocument = useCallback(
    async (doc: ExportableDocument, format: ExportFormat, filename: string) => {
      setExporting(true);
      try {
        let blob: Blob;
        const ext = format === 'markdown' ? 'md' : format;

        switch (format) {
          case 'markdown': {
            const { buildMarkdown } = await import('./markdown-builder');
            const md = buildMarkdown(doc);
            blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
            break;
          }
          case 'docx': {
            const { buildDocx } = await import('./docx-builder');
            blob = await buildDocx(doc);
            break;
          }
          case 'pdf': {
            const { buildPdf } = await import('./pdf-builder');
            blob = buildPdf(doc);
            break;
          }
        }

        saveAs(blob, `${filename}.${ext}`);
        toast.success(t('supplementary.common.exportSuccess'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`${t('supplementary.common.exportFailed')}: ${message}`);
      } finally {
        setExporting(false);
      }
    },
    [t],
  );

  return { exporting, exportDocument };
}
