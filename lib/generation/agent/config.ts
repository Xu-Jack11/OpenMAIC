/**
 * Generation Agent Configuration — single source of truth for reading the
 * `GENERATION_AGENT_MODE` environment variable.
 *
 *   (unset / unknown) → "legacy"        (skip the agent orchestrator entirely)
 *   `phase-a`          → "deterministic" (Phase A subagent wrappers)
 *   `tool_use`         → "tool_use"      (Phase B LLM planner)
 */

export type GenerationAgentMode = 'legacy' | 'deterministic' | 'tool_use';

export function getGenerationAgentMode(): GenerationAgentMode {
  const raw = process.env.GENERATION_AGENT_MODE;
  if (raw === 'phase-a') return 'deterministic';
  if (raw === 'tool_use') return 'tool_use';
  return 'legacy';
}

/** Whether either agent-orchestrator path is active. */
export function isAgentOrchestratorEnabled(): boolean {
  return getGenerationAgentMode() !== 'legacy';
}
