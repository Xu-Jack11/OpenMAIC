/**
 * Shared Lucide icon resolver.
 * Used by both skill-loader (built-in YAML skills) and user-skill-loader (custom skills).
 */

import * as icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Resolve a Lucide icon by name string. Falls back to Puzzle if not found. */
export function resolveIcon(name: string): LucideIcon {
  const icon = (icons as Record<string, unknown>)[name];
  if (typeof icon === 'function') return icon as LucideIcon;
  return icons.Puzzle;
}

/** Curated list of education-relevant icons for the skill editor picker */
export const SKILL_ICON_OPTIONS: string[] = [
  'BookOpen',
  'GraduationCap',
  'Lightbulb',
  'Brain',
  'Sparkles',
  'FlaskConical',
  'Library',
  'FileText',
  'PenTool',
  'ListChecks',
  'ClipboardList',
  'MessageSquare',
  'Search',
  'BarChart3',
  'PieChart',
  'Map',
  'Globe',
  'Microscope',
  'Atom',
  'Calculator',
  'Music',
  'Palette',
  'Code',
  'Puzzle',
  'Target',
];
