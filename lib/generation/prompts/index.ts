/**
 * Prompt System - Simplified prompt management
 *
 * Features:
 * - File-based prompt storage in templates/
 * - Snippet composition via {{snippet:name}} syntax
 * - Variable interpolation via {{variable}} syntax
 */

// Types
export type { PromptId, SnippetId, LoadedPrompt } from './types';

// Loader functions
export {
  loadPrompt,
  loadSnippet,
  buildPrompt,
  interpolateVariables,
  clearPromptCache,
} from './loader';

// Prompt IDs constant
export const PROMPT_IDS = {
  REQUIREMENT_ANALYSIS: 'requirement-analysis',
  REQUIREMENT_ANALYSIS_JUDGE: 'requirement-analysis-judge',
  REQUIREMENTS_TO_OUTLINES: 'requirements-to-outlines',
  OUTLINE_JUDGE: 'outline-judge',
  WEB_SEARCH_QUERY_REWRITE: 'web-search-query-rewrite',
  SLIDE_CONTENT: 'slide-content',
  QUIZ_CONTENT: 'quiz-content',
  SLIDE_ACTIONS: 'slide-actions',
  QUIZ_ACTIONS: 'quiz-actions',
  INTERACTIVE_SCIENTIFIC_MODEL: 'interactive-scientific-model',
  INTERACTIVE_HTML: 'interactive-html',
  INTERACTIVE_ACTIONS: 'interactive-actions',
  PBL_ACTIONS: 'pbl-actions',
  HANDOUT: 'handout',
  EXPERIMENT_DESIGN: 'experiment-design',
  EXTENDED_READING: 'extended-reading',
} as const;
