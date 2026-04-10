'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type DeleteCourseDialogProps = {
  courseId: string;
  courseName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
};

export function DeleteCourseDialog({
  courseId,
  courseName,
  open,
  onOpenChange,
  onDeleted,
}: DeleteCourseDialogProps) {
  const { t } = useI18n();
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmText('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const canDelete = confirmText.trim() === courseName.trim() && !submitting;

  const handleDelete = async () => {
    if (!canDelete) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/course/${courseId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || t('course.deleteCourseError'));
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('course.deleteCourseError'));
      setSubmitting(false);
    }
  };

  const confirmLabel = t('course.deleteCourseConfirmLabel').replace('{name}', courseName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold text-destructive">
          {t('course.deleteCourseDialogTitle')}
        </DialogTitle>

        <p className="mt-3 text-sm text-muted-foreground">
          {t('course.deleteCourseDialogWarning')}
        </p>

        <label className="mt-4 block text-sm">
          <span className="text-foreground">{confirmLabel}</span>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={submitting}
            autoFocus
            className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-50"
          />
        </label>

        {error && (
          <div className="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {t('course.deleteCourseCancelButton')}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              canDelete
                ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                : 'bg-muted text-muted-foreground/50 cursor-not-allowed',
            )}
          >
            {submitting ? '...' : t('course.deleteCourseConfirmButton')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
