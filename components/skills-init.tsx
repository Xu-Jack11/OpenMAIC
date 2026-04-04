'use client';

import { useEffect } from 'react';
import { usePluginStore } from '@/lib/store/plugins';
import { useUserSkillStore } from '@/lib/store/user-skills';

/**
 * Fetches skills on mount and populates the global store and registry.
 * Loads user-defined skills first, then built-in + user plugins together.
 * Renders nothing — purely a side-effect component.
 */
export function SkillsInit() {
  const loadPlugins = usePluginStore((state) => state.loadPlugins);
  const loadUserSkills = useUserSkillStore((state) => state.loadUserSkills);

  useEffect(() => {
    // Load user skills into their own store first (for CRUD UI),
    // then load all plugins (built-in + user) into the plugin store.
    loadUserSkills().then(() => loadPlugins());
  }, [loadPlugins, loadUserSkills]);

  return null;
}
