'use client';

import type { ExperimentDesign } from '@/lib/types/supplementary';
import { useI18n } from '@/lib/hooks/use-i18n';

interface ExperimentPreviewProps {
  data: unknown;
}

export function ExperimentPreview({ data }: ExperimentPreviewProps) {
  const experiment = data as ExperimentDesign;
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-base mb-1">{experiment.title}</h3>
        <p className="text-xs text-purple-500">{experiment.subject}</p>
        <p className="text-gray-600 dark:text-gray-400 mt-1">{experiment.purpose}</p>
      </div>

      <div>
        <h4 className="font-semibold text-sm mb-2">{t('supplementary.experiment.materials')}</h4>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-800">
              <th className="text-left p-1.5 border border-gray-200 dark:border-gray-700">
                {t('supplementary.experiment.materialName')}
              </th>
              <th className="text-left p-1.5 border border-gray-200 dark:border-gray-700">
                {t('supplementary.experiment.materialQty')}
              </th>
              <th className="text-left p-1.5 border border-gray-200 dark:border-gray-700">
                {t('supplementary.experiment.materialNotes')}
              </th>
            </tr>
          </thead>
          <tbody>
            {experiment.materials.map((m, i) => (
              <tr key={i}>
                <td className="p-1.5 border border-gray-200 dark:border-gray-700">{m.name}</td>
                <td className="p-1.5 border border-gray-200 dark:border-gray-700">{m.quantity}</td>
                <td className="p-1.5 border border-gray-200 dark:border-gray-700 text-gray-500">
                  {m.notes || ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h4 className="font-semibold text-sm mb-2">{t('supplementary.experiment.steps')}</h4>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          {experiment.steps.map((s) => (
            <li key={s.order}>
              {s.instruction}
              {s.duration && <span className="text-gray-400 ml-1">({s.duration})</span>}
              {s.tips && <span className="text-blue-500 ml-1">— {s.tips}</span>}
            </li>
          ))}
        </ol>
      </div>

      {experiment.safetyNotes.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm mb-1 text-orange-600 dark:text-orange-400">
            {t('supplementary.experiment.safety')}
          </h4>
          <ul className="list-disc list-inside text-xs text-orange-600 dark:text-orange-400">
            {experiment.safetyNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="font-semibold text-sm mb-1">
          {t('supplementary.experiment.expectedResults')}
        </h4>
        <p className="text-xs text-gray-600 dark:text-gray-400">{experiment.expectedResults}</p>
      </div>

      {experiment.thinkingQuestions.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm mb-1">
            {t('supplementary.experiment.thinkingQuestions')}
          </h4>
          <ol className="list-decimal list-inside text-xs space-y-1">
            {experiment.thinkingQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
