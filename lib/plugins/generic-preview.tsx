'use client';

/**
 * Generic Preview — renders any JSON object as a structured preview.
 * Used as the default preview when a skill doesn't specify a custom component.
 */

interface GenericPreviewProps {
  data: unknown;
}

export function GenericPreview({ data }: GenericPreviewProps) {
  if (!data || typeof data !== 'object') {
    return <p className="text-gray-500 italic">No data</p>;
  }

  return <div className="space-y-3">{renderObject(data as Record<string, unknown>, 0)}</div>;
}

function renderObject(obj: Record<string, unknown>, depth: number): React.ReactNode[] {
  return Object.entries(obj).map(([key, value]) => (
    <div key={key} style={{ paddingLeft: depth * 12 }}>
      {typeof value === 'string' ? (
        <div className="mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-500 dark:text-purple-400">
            {formatLabel(key)}
          </span>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
            {value}
          </p>
        </div>
      ) : typeof value === 'number' || typeof value === 'boolean' ? (
        <div className="mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-500 dark:text-purple-400 mr-2">
            {formatLabel(key)}
          </span>
          <span className="text-sm text-gray-700 dark:text-gray-300">{String(value)}</span>
        </div>
      ) : Array.isArray(value) ? (
        <div className="mb-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-500 dark:text-purple-400 block mb-1">
            {formatLabel(key)}
          </span>
          <div className="space-y-1.5">
            {value.map((item, i) =>
              typeof item === 'string' ? (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
                >
                  <span className="text-purple-400 dark:text-purple-500 shrink-0 mt-0.5">•</span>
                  <span className="whitespace-pre-wrap">{item}</span>
                </div>
              ) : typeof item === 'object' && item !== null ? (
                <div
                  key={i}
                  className="border-l-2 border-gray-200 dark:border-gray-700 pl-3 py-1"
                >
                  {renderObject(item as Record<string, unknown>, depth + 1)}
                </div>
              ) : (
                <div key={i} className="text-sm text-gray-700 dark:text-gray-300">
                  {String(item)}
                </div>
              ),
            )}
          </div>
        </div>
      ) : typeof value === 'object' && value !== null ? (
        <div className="mb-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-500 dark:text-purple-400 block mb-1">
            {formatLabel(key)}
          </span>
          <div className="border-l-2 border-gray-200 dark:border-gray-700 pl-3">
            {renderObject(value as Record<string, unknown>, depth + 1)}
          </div>
        </div>
      ) : null}
    </div>
  ));
}

/** Convert camelCase/snake_case to readable label */
function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .trim();
}
