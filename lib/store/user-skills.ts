import { create } from 'zustand';
import { nanoid } from 'nanoid';
import {
  getUserSkills,
  saveUserSkill as dbSaveUserSkill,
  deleteUserSkill as dbDeleteUserSkill,
} from '@/lib/utils/database';
import type { UserSkill } from '@/lib/plugins/user-skill';
import type { UserSkillRecord } from '@/lib/utils/database';

interface UserSkillStoreState {
  skills: UserSkill[];
  isLoaded: boolean;
  loadUserSkills: () => Promise<void>;
  addSkill: (
    skill: Omit<UserSkill, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<UserSkill>;
  updateSkill: (id: string, updates: Partial<UserSkill>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  getSkill: (id: string) => UserSkill | undefined;
}

function recordToSkill(record: UserSkillRecord): UserSkill {
  return {
    ...record,
    variables: JSON.parse(record.variables),
    supportedFormats: JSON.parse(record.supportedFormats),
  };
}

function skillToRecord(skill: UserSkill): UserSkillRecord {
  return {
    ...skill,
    variables: JSON.stringify(skill.variables),
    supportedFormats: JSON.stringify(skill.supportedFormats),
  };
}

export const useUserSkillStore = create<UserSkillStoreState>((set, get) => ({
  skills: [],
  isLoaded: false,

  loadUserSkills: async () => {
    if (get().isLoaded) return;
    try {
      const records = await getUserSkills();
      const skills = records.map(recordToSkill);
      set({ skills, isLoaded: true });
    } catch (error) {
      console.error('Failed to load user skills:', error);
      set({ isLoaded: true });
    }
  },

  addSkill: async (input) => {
    const now = Date.now();
    const skill: UserSkill = {
      ...input,
      id: `custom-${nanoid(8)}`,
      createdAt: now,
      updatedAt: now,
    };

    await dbSaveUserSkill(skillToRecord(skill));
    set((state) => ({ skills: [skill, ...state.skills] }));

    // Auto-enable the new skill and refresh plugin store
    const { useSettingsStore } = await import('@/lib/store/settings');
    const { enabledPluginIds } = useSettingsStore.getState();
    if (!enabledPluginIds.includes(skill.id)) {
      useSettingsStore.getState().togglePlugin(skill.id);
    }

    const { usePluginStore } = await import('@/lib/store/plugins');
    await usePluginStore.getState().reloadPlugins();

    return skill;
  },

  updateSkill: async (id, updates) => {
    const existing = get().skills.find((s) => s.id === id);
    if (!existing) return;

    const updated: UserSkill = {
      ...existing,
      ...updates,
      id, // prevent ID changes
      updatedAt: Date.now(),
    };

    await dbSaveUserSkill(skillToRecord(updated));
    set((state) => ({
      skills: state.skills.map((s) => (s.id === id ? updated : s)),
    }));

    const { usePluginStore } = await import('@/lib/store/plugins');
    await usePluginStore.getState().reloadPlugins();
  },

  deleteSkill: async (id) => {
    await dbDeleteUserSkill(id);
    set((state) => ({ skills: state.skills.filter((s) => s.id !== id) }));

    // Remove from enabled plugins
    const { useSettingsStore } = await import('@/lib/store/settings');
    const { enabledPluginIds } = useSettingsStore.getState();
    if (enabledPluginIds.includes(id)) {
      useSettingsStore.getState().togglePlugin(id);
    }

    const { usePluginStore } = await import('@/lib/store/plugins');
    await usePluginStore.getState().reloadPlugins();
  },

  getSkill: (id) => get().skills.find((s) => s.id === id),
}));
