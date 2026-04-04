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
