/**
 * Unit tests for the generation-agent orchestrator's planner-mode dispatch.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePlannerMode, runGenerationAgent } from '@/lib/generation/agent/orchestrator';
import type { OrchestratorInput } from '@/lib/generation/agent/runtime';

function minimalInput(): OrchestratorInput {
  const api = {
    scene: { list: () => ({ success: true as const, data: [] as never[] }) },
  } as unknown as OrchestratorInput['stageApi'];
  return {
    requirement: 'noop',
    language: 'zh-CN',
    aiCall: async () => '',
    baseUrl: 'http://localhost',
    agents: [],
    stageApi: api,
    stageId: 'stage-x',
  };
}

describe('resolvePlannerMode', () => {
  const saved = process.env.GENERATION_AGENT_MODE;

  beforeEach(() => {
    delete process.env.GENERATION_AGENT_MODE;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.GENERATION_AGENT_MODE;
    } else {
      process.env.GENERATION_AGENT_MODE = saved;
    }
  });

  it('defaults to deterministic', () => {
    expect(resolvePlannerMode()).toBe('deterministic');
  });

  it('returns deterministic for phase-a', () => {
    process.env.GENERATION_AGENT_MODE = 'phase-a';
    expect(resolvePlannerMode()).toBe('deterministic');
  });

  it('returns tool_use when set', () => {
    process.env.GENERATION_AGENT_MODE = 'tool_use';
    expect(resolvePlannerMode()).toBe('tool_use');
  });

  it('falls back to deterministic on unknown values', () => {
    process.env.GENERATION_AGENT_MODE = 'weird-mode';
    expect(resolvePlannerMode()).toBe('deterministic');
  });
});

describe('runGenerationAgent dispatch', () => {
  it('throws when tool_use mode is requested without a languageModel', async () => {
    await expect(runGenerationAgent(minimalInput(), { mode: 'tool_use' })).rejects.toThrow(
      /tool_use mode requires `input.languageModel`/,
    );
  });
});
