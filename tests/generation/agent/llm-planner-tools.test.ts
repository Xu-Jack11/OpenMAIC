/**
 * Unit tests for the Phase B LLM planner's tool precondition logic.
 *
 * These tests exercise `buildTools()` directly — they don't spin up a real
 * `LanguageModel` or call any subagent. They set the planner state to the
 * desired shape and invoke `tool.execute()` to verify the guards fire
 * correctly.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TOOL_NAMES,
  buildTools,
  createInitialPlannerState,
  type PlannerState,
} from '@/lib/generation/agent/llm-planner';
import { ActivityTree, type OrchestratorInput } from '@/lib/generation/agent/runtime';
import type { RequirementAnalysis } from '@/lib/generation/requirement-analyzer';
import type { SceneOutline } from '@/lib/types/generation';

// Minimal stage API shim — only `scene.list()` is ever read by tool preconditions.
function stubStageApi(scenes: unknown[] = []): OrchestratorInput['stageApi'] {
  const api = {
    scene: {
      list: () => ({ success: true as const, data: scenes as never }),
    },
  } as unknown as OrchestratorInput['stageApi'];
  return api;
}

function baseInput(overrides: Partial<OrchestratorInput> = {}): OrchestratorInput {
  return {
    requirement: 'Teach photosynthesis',
    language: 'zh-CN',
    aiCall: async () => 'never-called',
    baseUrl: 'http://localhost',
    agents: [],
    stageApi: stubStageApi(),
    stageId: 'stage-1',
    ...overrides,
  };
}

function makeTools(
  overrides: {
    input?: Partial<OrchestratorInput>;
    state?: Partial<PlannerState>;
  } = {},
) {
  const input = baseInput(overrides.input);
  const tree = new ActivityTree();
  const state: PlannerState = { ...createInitialPlannerState(), ...overrides.state };
  const tools = buildTools({ input, tree, state });
  return { tools, state, tree, input };
}

/**
 * Invoke a tool's `execute` directly. The AI SDK's Tool type has a richer
 * signature than we care about here; cast through `unknown` and call it with
 * a stub options object.
 */
async function invoke(tool: unknown, args: unknown): Promise<unknown> {
  const exec = (tool as { execute?: (args: unknown, opts: unknown) => Promise<unknown> }).execute;
  if (!exec) throw new Error('tool has no execute');
  return exec(args, {});
}

describe('LLM planner tools — preconditions', () => {
  describe('research_web', () => {
    it('skips when web search is disabled', async () => {
      const { tools, state } = makeTools({ input: { enableWebSearch: false } });
      const result = (await invoke(tools.research_web, { query_hint: 'x' })) as {
        skipped: boolean;
      };
      expect(result.skipped).toBe(true);
      expect(state.researchContext).toBeUndefined();
    });

    it('skips when api key is missing', async () => {
      const { tools } = makeTools({
        input: { enableWebSearch: true, webSearchApiKey: undefined },
      });
      const result = (await invoke(tools.research_web, { query_hint: 'x' })) as {
        skipped: boolean;
      };
      expect(result.skipped).toBe(true);
    });

    it('skips on second call', async () => {
      const { tools } = makeTools({ state: { researchContext: 'already' } });
      const result = (await invoke(tools.research_web, { query_hint: 'x' })) as {
        skipped: boolean;
      };
      expect(result.skipped).toBe(true);
    });
  });

  describe('analyze_requirement', () => {
    it('throws when called twice', async () => {
      const { tools } = makeTools({
        state: { analysis: { topic: 'x' } as unknown as RequirementAnalysis },
      });
      await expect(invoke(tools.analyze_requirement, {})).rejects.toThrow(/already been called/);
    });
  });

  describe('retrieve_rag', () => {
    it('skips when no courseId', async () => {
      const { tools } = makeTools({ input: { courseId: undefined } });
      const result = (await invoke(tools.retrieve_rag, {})) as { skipped: boolean };
      expect(result.skipped).toBe(true);
    });

    it('throws when analyze_requirement has not run', async () => {
      const { tools } = makeTools({ input: { courseId: 'course-1' } });
      await expect(invoke(tools.retrieve_rag, {})).rejects.toThrow(
        /analyze_requirement must be called/,
      );
    });

    it('skips on second call', async () => {
      const { tools } = makeTools({
        input: { courseId: 'course-1' },
        state: {
          analysis: { topic: 'x' } as unknown as RequirementAnalysis,
          documentContext: 'already',
        },
      });
      const result = (await invoke(tools.retrieve_rag, {})) as { skipped: boolean };
      expect(result.skipped).toBe(true);
    });
  });

  describe('generate_outlines', () => {
    it('throws when analyze_requirement has not run', async () => {
      const { tools } = makeTools();
      await expect(invoke(tools.generate_outlines, {})).rejects.toThrow(
        /analyze_requirement must be called/,
      );
    });

    it('throws when called twice', async () => {
      const { tools } = makeTools({
        state: {
          analysis: { topic: 'x' } as unknown as RequirementAnalysis,
          outlines: [{ title: 'scene 1' } as unknown as SceneOutline],
        },
      });
      await expect(invoke(tools.generate_outlines, {})).rejects.toThrow(/already been called/);
    });
  });

  describe('generate_scene', () => {
    it('throws before generate_outlines', async () => {
      const { tools } = makeTools();
      await expect(invoke(tools.generate_scene, { outline_index: 0 })).rejects.toThrow(
        /generate_outlines must be called/,
      );
    });

    it('throws on out-of-range index', async () => {
      const { tools } = makeTools({
        state: {
          outlines: [{ title: 'scene 1' } as unknown as SceneOutline],
        },
      });
      await expect(invoke(tools.generate_scene, { outline_index: 5 })).rejects.toThrow(
        /out of range/,
      );
    });

    it('skips a completed outline', async () => {
      const { tools } = makeTools({
        state: {
          outlines: [{ title: 'scene 1' } as unknown as SceneOutline],
          completedOutlineIndices: new Set([0]),
        },
      });
      const result = (await invoke(tools.generate_scene, { outline_index: 0 })) as {
        skipped: boolean;
      };
      expect(result.skipped).toBe(true);
    });
  });

  describe('generate_media', () => {
    it('throws before generate_outlines', async () => {
      const { tools } = makeTools({ input: { enableImageGeneration: true } });
      await expect(invoke(tools.generate_media, {})).rejects.toThrow(
        /generate_outlines must be called/,
      );
    });

    it('throws when not all scenes are generated', async () => {
      const { tools } = makeTools({
        input: { enableImageGeneration: true },
        state: {
          outlines: [
            { title: '1' } as unknown as SceneOutline,
            { title: '2' } as unknown as SceneOutline,
          ],
          completedOutlineIndices: new Set([0]),
        },
      });
      await expect(invoke(tools.generate_media, {})).rejects.toThrow(
        /Not all scenes are generated yet/,
      );
    });

    it('skips when media flags are off', async () => {
      const { tools } = makeTools({
        input: { enableImageGeneration: false, enableVideoGeneration: false },
        state: {
          outlines: [{ title: '1' } as unknown as SceneOutline],
          completedOutlineIndices: new Set([0]),
        },
      });
      const result = (await invoke(tools.generate_media, {})) as { skipped: boolean };
      expect(result.skipped).toBe(true);
    });

    it('skips on second call', async () => {
      const { tools } = makeTools({
        input: { enableImageGeneration: true },
        state: {
          outlines: [{ title: '1' } as unknown as SceneOutline],
          completedOutlineIndices: new Set([0]),
          mediaGenerated: true,
        },
      });
      const result = (await invoke(tools.generate_media, {})) as { skipped: boolean };
      expect(result.skipped).toBe(true);
    });
  });

  describe('generate_tts', () => {
    it('throws before all scenes are generated', async () => {
      const { tools } = makeTools({
        input: { enableTTS: true },
        state: {
          outlines: [
            { title: '1' } as unknown as SceneOutline,
            { title: '2' } as unknown as SceneOutline,
          ],
          completedOutlineIndices: new Set([0]),
        },
      });
      await expect(invoke(tools.generate_tts, {})).rejects.toThrow(
        /Not all scenes are generated yet/,
      );
    });

    it('skips when TTS is disabled', async () => {
      const { tools } = makeTools({
        input: { enableTTS: false },
        state: {
          outlines: [{ title: '1' } as unknown as SceneOutline],
          completedOutlineIndices: new Set([0]),
        },
      });
      const result = (await invoke(tools.generate_tts, {})) as { skipped: boolean };
      expect(result.skipped).toBe(true);
    });
  });

  describe('finish', () => {
    it('sets finished=true', async () => {
      const { tools, state } = makeTools();
      const result = (await invoke(tools.finish, { reason: 'done' })) as { ok: boolean };
      expect(result.ok).toBe(true);
      expect(state.finished).toBe(true);
    });
  });

  describe('write_document', () => {
    it('throws when analyze_requirement has not run', async () => {
      const { tools } = makeTools();
      await expect(
        invoke(tools.write_document, {
          artifact_id: 'experiment-report',
          title: 'Experiment Report',
          markdown: '# Hello',
        }),
      ).rejects.toThrow(/analyze_requirement must be called/);
    });

    it('succeeds after analyze_requirement and returns bytes + artifactId', async () => {
      const { tools } = makeTools({
        state: { analysis: { topic: 'x' } as unknown as RequirementAnalysis },
      });
      const markdown = '# Report\n\nBody text.';
      const result = (await invoke(tools.write_document, {
        artifact_id: 'experiment-report',
        title: 'Experiment Report',
        markdown,
      })) as { ok: boolean; bytes: number; artifactId: string };
      expect(result.ok).toBe(true);
      expect(result.bytes).toBe(markdown.length);
      expect(result.artifactId).toBe('experiment-report');
    });

    it('rejects invalid artifact_id slugs at schema boundary', () => {
      // The AI SDK's `tool({ inputSchema })` exposes the zod schema on the tool.
      const { tools } = makeTools({
        state: { analysis: { topic: 'x' } as unknown as RequirementAnalysis },
      });
      const schema = (
        tools.write_document as unknown as {
          inputSchema: { safeParse: (v: unknown) => { success: boolean } };
        }
      ).inputSchema;
      expect(schema.safeParse({ artifact_id: 'Bad ID', title: 't', markdown: 'm' }).success).toBe(
        false,
      );
      expect(schema.safeParse({ artifact_id: 'ok-id', title: 't', markdown: 'm' }).success).toBe(
        true,
      );
    });
  });

  describe('tool set shape', () => {
    it('exposes exactly the declared BUILTIN_TOOL_NAMES', () => {
      const { tools } = makeTools();
      expect(Object.keys(tools).sort()).toEqual([...BUILTIN_TOOL_NAMES].sort());
    });
  });
});
