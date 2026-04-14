/**
 * Built-in subagent registry.
 *
 * Phase A dispatches these by id from the deterministic planner. Phase B will
 * surface them as Anthropic tools to an LLM planner.
 */

import type { SubagentDefinition } from '../types';

import { requirementAnalyzerSubagent } from './requirement-analyzer';
import { ragRetrieverSubagent } from './rag-retriever';
import { webResearcherSubagent } from './web-researcher';
import { outlineGeneratorSubagent } from './outline-generator';
import { sceneContentGeneratorSubagent } from './scene-content-generator';
import { sceneActionGeneratorSubagent } from './scene-action-generator';
import { sceneComposerSubagent } from './scene-composer';
import { mediaGeneratorSubagent } from './media-generator';
import { ttsGeneratorSubagent } from './tts-generator';
import { pluginRunnerSubagent } from './plugin-runner';

export const BUILTIN_SUBAGENTS = {
  'requirement-analyzer': requirementAnalyzerSubagent,
  'rag-retriever': ragRetrieverSubagent,
  'web-researcher': webResearcherSubagent,
  'outline-generator': outlineGeneratorSubagent,
  'scene-content-generator': sceneContentGeneratorSubagent,
  'scene-action-generator': sceneActionGeneratorSubagent,
  'scene-composer': sceneComposerSubagent,
  'media-generator': mediaGeneratorSubagent,
  'tts-generator': ttsGeneratorSubagent,
  'plugin-runner': pluginRunnerSubagent,
} as const satisfies Record<string, SubagentDefinition<unknown, unknown>>;

export type BuiltinSubagentId = keyof typeof BUILTIN_SUBAGENTS;

export function getSubagent<I = unknown, O = unknown>(
  id: BuiltinSubagentId,
): SubagentDefinition<I, O> {
  return BUILTIN_SUBAGENTS[id] as unknown as SubagentDefinition<I, O>;
}

export {
  requirementAnalyzerSubagent,
  ragRetrieverSubagent,
  webResearcherSubagent,
  outlineGeneratorSubagent,
  sceneContentGeneratorSubagent,
  sceneActionGeneratorSubagent,
  sceneComposerSubagent,
  mediaGeneratorSubagent,
  ttsGeneratorSubagent,
  pluginRunnerSubagent,
};
