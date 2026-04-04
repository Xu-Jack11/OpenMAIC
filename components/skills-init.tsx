'use client';

import { useEffect } from 'react';
import { usePluginStore } from '@/lib/store/plugins';

/**
 * Fetches skills on mount and populates the global store and registry.
 * Renders nothing — purely a side-effect component.
 */
export function SkillsInit() {
  const loadPlugins = usePluginStore((state) => state.loadPlugins);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  return null;
}
