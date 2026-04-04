'use client';

import { Puzzle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { usePluginStore } from '@/lib/store/plugins';

export function PluginToggles() {
  const { t } = useI18n();
  const enabledPluginIds = useSettingsStore((s) => s.enabledPluginIds);
  const togglePlugin = useSettingsStore((s) => s.togglePlugin);

  const plugins = usePluginStore((s) => s.plugins);
  const enabledCount = plugins.filter((p) => enabledPluginIds.includes(p.id)).length;

  if (plugins.length === 0) return null;

  const pillCls =
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer select-none whitespace-nowrap border';
  const pillMuted = `${pillCls} border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60`;
  const pillActive = `${pillCls} border-violet-200/60 dark:border-violet-700/50 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={enabledCount > 0 ? pillActive : pillMuted}>
          <Puzzle className="size-3.5" />
          {enabledCount > 0 && (
            <span>
              {t('toolbar.pluginsEnabled').replace('{n}', String(enabledCount))}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {/* Header */}
        <div className="px-3 pt-3 pb-2 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Puzzle className="size-4 text-violet-500" />
            <span className="text-xs font-semibold text-foreground">
              {t('toolbar.plugins')}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1 leading-relaxed">
            {t('toolbar.pluginsDesc')}
          </p>
        </div>

        {/* Plugin list */}
        <div className="p-1.5 space-y-0.5">
          {plugins.map((plugin) => {
            const Icon = plugin.icon;
            const isEnabled = enabledPluginIds.includes(plugin.id);
            return (
              <button
                key={plugin.id}
                onClick={() => togglePlugin(plugin.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all',
                  isEnabled
                    ? 'bg-violet-50 dark:bg-violet-950/20 ring-1 ring-violet-200/60 dark:ring-violet-800/40'
                    : 'hover:bg-muted/50',
                )}
              >
                <div
                  className={cn(
                    'size-7 rounded-md flex items-center justify-center shrink-0 transition-colors',
                    isEnabled
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400'
                      : 'bg-muted/60 text-muted-foreground/50',
                  )}
                >
                  <Icon className="size-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-xs font-medium truncate',
                      isEnabled ? 'text-violet-700 dark:text-violet-300' : 'text-foreground',
                    )}
                  >
                    {t(`${plugin.i18nPrefix}.title`)}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 truncate mt-0.5">
                    {t(`${plugin.i18nPrefix}.description`)}
                  </p>
                </div>
                {/* Toggle indicator */}
                <div
                  className={cn(
                    'shrink-0 w-8 h-[18px] rounded-full transition-colors relative',
                    isEnabled
                      ? 'bg-violet-500 dark:bg-violet-600'
                      : 'bg-muted-foreground/20',
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-[2px] size-[14px] rounded-full bg-white shadow-sm transition-all',
                      isEnabled ? 'left-[16px]' : 'left-[2px]',
                    )}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
