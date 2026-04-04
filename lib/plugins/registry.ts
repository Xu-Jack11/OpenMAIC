import type { GenerationPlugin } from './types';

const plugins: GenerationPlugin[] = [];

export function registerPlugin(plugin: GenerationPlugin) {
  if (!plugins.find((p) => p.id === plugin.id)) {
    plugins.push(plugin);
  }
}

export function getPlugins(): readonly GenerationPlugin[] {
  return plugins;
}

/**
 * Collect outline-generation guidance from all enabled plugins.
 * Returns a formatted string to inject into the outline prompt, or empty string if none.
 */
export function getPluginGuidance(enabledIds: string[], language: string): string {
  const lines: string[] = [];
  for (const plugin of plugins) {
    if (!enabledIds.includes(plugin.id)) continue;
    const guidance = plugin.getOutlineGuidance?.(language);
    if (guidance) lines.push(`- [${plugin.id}] ${guidance}`);
  }
  if (lines.length === 0) return '';
  const header =
    language === 'zh-CN'
      ? '## 已启用的技能指导\n\n以下技能已启用，请在生成大纲时考虑它们的需求：'
      : '## Enabled Skill Guidance\n\nThe following skills are enabled. Consider their requirements when generating outlines:';
  return `${header}\n${lines.join('\n')}`;
}
