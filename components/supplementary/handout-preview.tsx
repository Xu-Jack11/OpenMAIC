'use client';

import type { Handout } from '@/lib/types/supplementary';
import { useI18n } from '@/lib/hooks/use-i18n';

interface HandoutPreviewProps {
  data: unknown;
}

export function HandoutPreview({ data }: HandoutPreviewProps) {
  const handout = data as Handout;
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-base mb-1">{handout.title}</h3>
        <p className="text-gray-600 dark:text-gray-400">{handout.overview}</p>
      </div>

      {handout.sections.map((section, i) => (
        <div key={i} className="border-l-2 border-purple-300 dark:border-purple-700 pl-3">
          <h4 className="font-semibold text-sm mb-1">
            <span className="text-purple-500 text-xs uppercase mr-1">[{section.type}]</span>
            {section.title}
          </h4>

          {section.keyPoints.length > 0 && (
            <ul className="list-disc list-inside text-xs text-gray-600 dark:text-gray-400 mb-1">
              {section.keyPoints.map((kp, j) => (
                <li key={j}>{kp}</li>
              ))}
            </ul>
          )}

          {section.notes && (
            <p className="text-xs text-gray-500 dark:text-gray-500 italic">{section.notes}</p>
          )}

          {section.questions?.map((q, j) => (
            <div key={j} className="mt-1 text-xs bg-white dark:bg-gray-800 rounded p-2">
              <p className="font-medium">{q.question}</p>
              {q.options && <p className="text-gray-500 mt-0.5">{q.options.join('  ')}</p>}
              {q.answer && <p className="text-green-600 dark:text-green-400 mt-0.5">{q.answer}</p>}
            </div>
          ))}
        </div>
      ))}

      {handout.summary && (
        <div className="border-t pt-3">
          <h4 className="font-semibold text-sm mb-1">{t('supplementary.handout.summary')}</h4>
          <p className="text-gray-600 dark:text-gray-400 text-xs">{handout.summary}</p>
        </div>
      )}
    </div>
  );
}
