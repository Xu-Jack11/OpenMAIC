import { create } from 'zustand';
import type { GenerationPlugin } from '@/lib/plugins/types';
import { loadSkills } from '@/lib/plugins/skill-loader';
import { loadUserSkillPlugins } from '@/lib/plugins/user-skill-loader';

interface PluginStoreState {
  plugins: GenerationPlugin[];
  isLoaded: boolean;
  loadPlugins: () => Promise<void>;
  reloadPlugins: () => Promise<void>;
  getPlugin: (id: string) => GenerationPlugin | undefined;
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  plugins: [],
  isLoaded: false,

  loadPlugins: async () => {
    // Only load once
    if (get().isLoaded) return;

    try {
      const [builtInPlugins, userPlugins] = await Promise.all([
        loadSkills(),
        loadUserSkillPlugins(),
      ]);
      set({ plugins: [...builtInPlugins, ...userPlugins], isLoaded: true });
    } catch (error) {
      console.error('Failed to load plugins:', error);
      // Even on failure, set isLoaded to true to prevent infinite retry loops in UI
      set({ isLoaded: true });
    }
  },

  reloadPlugins: async () => {
    set({ isLoaded: false });
    await get().loadPlugins();
  },

  getPlugin: (id: string) => {
    return get().plugins.find((p) => p.id === id);
  },
}));
