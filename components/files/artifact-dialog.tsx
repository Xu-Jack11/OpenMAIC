'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useAgentArtifactStore, type AgentArtifactEntry } from '@/lib/store/agent-artifacts';
import { exportArtifact, markdownToExportableDocument } from '@/lib/export/artifact-export';
import type { ExportFormat } from '@/lib/export/document/types';
import type { Locale } from '@/lib/i18n';
import type { ExportableDocument, DocumentSection } from '@/lib/export/document/types';

interface ArtifactDialogProps {
  stageId: string | null;
  artifactId: string | null;
  onClose: () => void;
}

const FORMATS: ExportFormat[] = ['markdown', 'pdf', 'docx'];

export function ArtifactDialog({ stageId, artifactId, onClose }: ArtifactDialogProps) {
  const { t, locale } = useI18n();
  const getOne = useAgentArtifactStore((s) => s.getOne);

  const [entry, setEntry] = useState<AgentArtifactEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('markdown');

  const open = stageId !== null && artifactId !== null;

  useEffect(() => {
    if (!open || !stageId || !artifactId) {
      setEntry(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getOne(stageId, artifactId)
      .then((e) => {
        if (!cancelled) setEntry(e);
      })
      .catch(() => {
        if (!cancelled) setEntry(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, stageId, artifactId, getOne]);

  const parsedDoc = useMemo<ExportableDocument | null>(() => {
    if (!entry?.markdown) return null;
    return markdownToExportableDocument(entry.markdown, locale as Locale, entry.title);
  }, [entry, locale]);

  const handleExport = useCallback(async () => {
    if (!entry?.markdown) return;
    setExporting(true);
    try {
      await exportArtifact(
        { title: entry.title, markdown: entry.markdown, locale: locale as Locale },
        format,
      );
      toast.success(t('files.downloadStarted'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${t('files.downloadFailed')}: ${message}`);
    } finally {
      setExporting(false);
    }
  }, [entry, format, locale, t]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] flex flex-col">
        <DialogTitle>{entry?.title ?? t('files.agentOutputs')}</DialogTitle>
        <DialogDescription>{entry ? formatByteSize(entry.byteSize) : ''}</DialogDescription>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && !entry && (
          <div className="py-8 text-center text-sm text-gray-500">
            {t('files.agentOutputsEmpty')}
          </div>
        )}

        {!loading && entry && (
          <div className="flex-1 overflow-y-auto border rounded-lg p-4 bg-gray-50 dark:bg-gray-900 text-sm leading-relaxed prose-artifact">
            {parsedDoc ? <RenderedDocument doc={parsedDoc} /> : null}
          </div>
        )}

        {entry && (
          <DialogFooter className="flex items-center gap-2 sm:justify-end">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="h-9 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-sm"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f === 'markdown' ? 'MD' : f.toUpperCase()}
                </option>
              ))}
            </select>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              {t('files.download')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenderedDocument({ doc }: { doc: ExportableDocument }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{doc.meta.title}</h1>
        {doc.meta.date && <div className="text-xs text-gray-400 mt-1">{doc.meta.date}</div>}
      </div>
      {doc.sections.map((s, i) => (
        <RenderedSection key={i} section={s} />
      ))}
    </div>
  );
}

function RenderedSection({ section }: { section: DocumentSection }) {
  const headingClass = headingClassForLevel(section.level);
  return (
    <section className="space-y-2">
      {section.heading && <div className={headingClass}>{section.heading}</div>}
      {section.paragraphs?.map((p, i) => (
        <p key={`p-${i}`} className="text-gray-700 dark:text-gray-300">
          {p}
        </p>
      ))}
      {section.bulletPoints && section.bulletPoints.length > 0 && (
        <ul className="list-disc list-outside pl-5 space-y-1 text-gray-700 dark:text-gray-300">
          {section.bulletPoints.map((b, i) => (
            <li key={`b-${i}`}>{b}</li>
          ))}
        </ul>
      )}
      {section.numberedItems && section.numberedItems.length > 0 && (
        <ol className="list-decimal list-outside pl-5 space-y-1 text-gray-700 dark:text-gray-300">
          {section.numberedItems.map((n, i) => (
            <li key={`n-${i}`}>{n}</li>
          ))}
        </ol>
      )}
      {section.table && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border border-gray-200 dark:border-gray-700">
            <thead className="bg-gray-100 dark:bg-gray-800">
              <tr>
                {section.table.headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold text-left"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="px-2 py-1 border border-gray-200 dark:border-gray-700 align-top"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.children?.map((c, i) => (
        <RenderedSection key={`c-${i}`} section={c} />
      ))}
    </section>
  );
}

function headingClassForLevel(level: 1 | 2 | 3 | 4): string {
  switch (level) {
    case 1:
      return 'text-lg font-bold text-gray-900 dark:text-gray-100';
    case 2:
      return 'text-base font-semibold text-gray-900 dark:text-gray-100';
    case 3:
      return 'text-sm font-semibold text-gray-800 dark:text-gray-200';
    case 4:
    default:
      return 'text-sm font-medium text-gray-700 dark:text-gray-300';
  }
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
