'use client';

import type { ExtendedReading } from '@/lib/types/supplementary';
import { useI18n } from '@/lib/hooks/use-i18n';

interface ReadingPreviewProps {
  data: unknown;
}

export function ReadingPreview({ data }: ReadingPreviewProps) {
  const reading = data as ExtendedReading;
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-base mb-1">{reading.title}</h3>
        <p className="text-gray-600 dark:text-gray-400">{reading.topicOverview}</p>
      </div>

      <div>
        <h4 className="font-semibold text-sm mb-2">{t('supplementary.reading.knowledgePoints')}</h4>
        <div className="space-y-2">
          {reading.knowledgePoints.map((kp, i) => (
            <div key={i} className="border-l-2 border-blue-300 dark:border-blue-700 pl-3">
              <h5 className="font-medium text-xs">{kp.title}</h5>
              <p className="text-xs text-gray-600 dark:text-gray-400">{kp.content}</p>
              {kp.connections && (
                <p className="text-xs text-blue-500 italic mt-0.5">{kp.connections}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-sm mb-2">{t('supplementary.reading.resources')}</h4>
        <div className="space-y-1.5">
          {reading.recommendedResources.map((r, i) => (
            <div key={i} className="text-xs bg-white dark:bg-gray-800 rounded p-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.title}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">
                  {r.type}
                </span>
              </div>
              <p className="text-gray-500 mt-0.5">{r.description}</p>
              {r.url && <p className="text-blue-500 truncate mt-0.5">{r.url}</p>}
            </div>
          ))}
        </div>
      </div>

      {reading.guidingQuestions.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm mb-1">
            {t('supplementary.reading.guidingQuestions')}
          </h4>
          <ol className="list-decimal list-inside text-xs space-y-1">
            {reading.guidingQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
