/**
 * Plugin Auto-Generator
 *
 * After all scenes are generated, automatically triggers enabled plugins
 * and caches their results in IndexedDB for instant access in PluginDialog.
 */

import { getPluginResult, savePluginResult } from '@/lib/utils/database';
import { useSettingsStore } from '@/lib/store/settings';
import { usePluginStore } from '@/lib/store/plugins';
import { createLogger } from '@/lib/logger';
import type { Scene, Stage } from '@/lib/types/stage';
import type { Locale } from '@/lib/i18n';

const log = createLogger('PluginAutoGen');

/**
 * Auto-generate results for all enabled plugins.
 * Skips plugins that already have cached results for this stage.
 * Runs each plugin sequentially to avoid overwhelming the API.
 */
export async function autoGeneratePlugins(
  stageId: string,
  scenes: Scene[],
  stage: Stage,
  locale: Locale,
): Promise<void> {
  const enabledIds = useSettingsStore.getState().enabledPluginIds;
  const allPlugins = usePluginStore.getState().plugins;
  const enabledPlugins = allPlugins.filter((p) => enabledIds.includes(p.id));

  if (enabledPlugins.length === 0) {
    log.info('No enabled plugins — skipping auto-generation');
    return;
  }

  log.info(`Auto-generating ${enabledPlugins.length} plugin(s): ${enabledPlugins.map((p) => p.id).join(', ')}`);

  for (const plugin of enabledPlugins) {
    try {
      // Check cache first
      const cached = await getPluginResult(stageId, plugin.id);
      if (cached !== null) {
        log.info(`[${plugin.id}] Already cached — skipping`);
        continue;
      }

      log.info(`[${plugin.id}] Generating...`);
      const result = await plugin.generate({ scenes, stage, locale });
      await savePluginResult(stageId, plugin.id, result);
      log.info(`[${plugin.id}] Generated and cached`);
    } catch (err) {
      // Log but don't fail — plugin generation is best-effort
      log.warn(`[${plugin.id}] Auto-generation failed:`, err);
    }
  }

  log.info('Plugin auto-generation complete');
}
