'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileDown,
  Package,
  Download,
  Eye,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store/stage';
import { useSettingsStore } from '@/lib/store/settings';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useExportPPTX } from '@/lib/export/use-export-pptx';
import { getPluginResult, savePluginResult } from '@/lib/utils/database';
import { PluginDialog } from '@/components/supplementary/plugin-dialog';
import { usePluginStore } from '@/lib/store/plugins';
import type { GenerationPlugin } from '@/lib/plugins/types';
import type { Locale } from '@/lib/i18n';

interface PluginFileState {
  pluginId: string;
  status: 'idle' | 'generating' | 'ready';
  data: unknown;
}

export function FilesSidebar() {
  const { t, locale } = useI18n();
  const scenes = useStageStore((s) => s.scenes);
  const stage = useStageStore((s) => s.stage);
  const generatingOutlines = useStageStore((s) => s.generatingOutlines);
  const failedOutlines = useStageStore.use.failedOutlines();
  const mediaTasks = useMediaGenerationStore((s) => s.tasks);

  const { exporting: isExporting, exportPPTX, exportResourcePack } = useExportPPTX();

  const canExport =
    scenes.length > 0 &&
    generatingOutlines.length === 0 &&
    failedOutlines.length === 0 &&
    Object.values(mediaTasks).every((task) => task.status === 'done' || task.status === 'failed');

  // Plugin state
  const enabledPluginIds = useSettingsStore((s) => s.enabledPluginIds);
  const allPlugins = usePluginStore((s) => s.plugins);
  const plugins = allPlugins.filter((p) => enabledPluginIds.includes(p.id));
  const [pluginStates, setPluginStates] = useState<Record<string, PluginFileState>>({});
  const [activePlugin, setActivePlugin] = useState<GenerationPlugin | null>(null);

  // Load cached plugin results on mount / when stage changes
  useEffect(() => {
    if (!stage) return;
    const stageId = stage.id;

    const loadCached = async () => {
      const states: Record<string, PluginFileState> = {};
      for (const plugin of plugins) {
        const cached = await getPluginResult(stageId, plugin.id);
        states[plugin.id] = {
          pluginId: plugin.id,
          status: cached !== null ? 'ready' : 'idle',
          data: cached,
        };
      }
      setPluginStates(states);
    };

    loadCached();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload on stage change
  }, [stage?.id, enabledPluginIds.join(',')]);

  const handleGeneratePlugin = useCallback(
    async (plugin: GenerationPlugin) => {
      if (!stage || scenes.length === 0) return;

      setPluginStates((prev) => ({
        ...prev,
        [plugin.id]: { pluginId: plugin.id, status: 'generating', data: null },
      }));

      try {
        const result = await plugin.generate({
          scenes,
          stage,
          locale: locale as Locale,
        });
        await savePluginResult(stage.id, plugin.id, result);
        setPluginStates((prev) => ({
          ...prev,
          [plugin.id]: { pluginId: plugin.id, status: 'ready', data: result },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`${t('supplementary.common.generateFailed')}: ${message}`);
        setPluginStates((prev) => ({
          ...prev,
          [plugin.id]: { pluginId: plugin.id, status: 'idle', data: null },
        }));
      }
    },
    [stage, scenes, locale, t],
  );

  const getStatusIcon = (status: 'idle' | 'generating' | 'ready') => {
    switch (status) {
      case 'idle':
        return <Circle className="w-3 h-3 text-gray-300 dark:text-gray-600" />;
      case 'generating':
        return <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />;
      case 'ready':
        return <CheckCircle2 className="w-3 h-3 text-emerald-500" />;
    }
  };

  const getStatusLabel = (status: 'idle' | 'generating' | 'ready') => {
    switch (status) {
      case 'idle':
        return t('files.notGenerated');
      case 'generating':
        return t('files.generating');
      case 'ready':
        return t('files.ready');
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-4 scrollbar-hide">
        {/* Export Section */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-1">
            {t('files.exports')}
          </div>
          <div className="space-y-1.5">
            {/* PPTX */}
            <button
              onClick={() => {
                if (canExport && !isExporting) exportPPTX();
              }}
              disabled={!canExport || isExporting}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group text-left',
                canExport && !isExporting
                  ? 'hover:bg-gray-50 dark:hover:bg-gray-800/60 active:scale-[0.98]'
                  : 'opacity-50 cursor-not-allowed',
              )}
            >
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-sm shadow-orange-200/50 dark:shadow-orange-900/30 shrink-0">
                <FileDown className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                  {t('files.pptx')}
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                  {t('files.pptxDesc')}
                </div>
              </div>
              {isExporting ? (
                <Loader2 className="w-4 h-4 text-gray-400 animate-spin shrink-0" />
              ) : (
                <Download className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors shrink-0" />
              )}
            </button>

            {/* Resource Pack */}
            <button
              onClick={() => {
                if (canExport && !isExporting) exportResourcePack();
              }}
              disabled={!canExport || isExporting}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group text-left',
                canExport && !isExporting
                  ? 'hover:bg-gray-50 dark:hover:bg-gray-800/60 active:scale-[0.98]'
                  : 'opacity-50 cursor-not-allowed',
              )}
            >
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center shadow-sm shadow-blue-200/50 dark:shadow-blue-900/30 shrink-0">
                <Package className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                  {t('files.resourcePack')}
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                  {t('files.resourcePackDesc')}
                </div>
              </div>
              {isExporting ? (
                <Loader2 className="w-4 h-4 text-gray-400 animate-spin shrink-0" />
              ) : (
                <Download className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Plugin Supplements Section */}
        {plugins.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-1">
              {t('files.supplements')}
            </div>
            <div className="space-y-1.5">
              {plugins.map((plugin) => {
                const Icon = plugin.icon;
                const state = pluginStates[plugin.id];
                const status = state?.status || 'idle';

                return (
                  <div
                    key={plugin.id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-all duration-200 group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-400 to-violet-500 flex items-center justify-center shadow-sm shadow-purple-200/50 dark:shadow-purple-900/30 shrink-0">
                      <Icon className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                        {plugin.displayName || t(`${plugin.i18nPrefix}.title`)}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {getStatusIcon(status)}
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">
                          {getStatusLabel(status)}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      {status === 'idle' && (
                        <button
                          onClick={() => handleGeneratePlugin(plugin)}
                          disabled={scenes.length === 0}
                          className="px-2 py-1 text-[11px] font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {t('files.generate')}
                        </button>
                      )}
                      {status === 'generating' && (
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                      )}
                      {status === 'ready' && (
                        <>
                          <button
                            onClick={() => setActivePlugin(plugin)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            title={t('files.preview')}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleGeneratePlugin(plugin)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            title={t('files.regenerate')}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {plugins.length === 0 && (
          <div className="text-center p-6 opacity-50">
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('files.supplements')}</p>
          </div>
        )}
      </div>

      {/* Plugin Dialog */}
      <PluginDialog plugin={activePlugin} onClose={() => setActivePlugin(null)} />
    </>
  );
}
