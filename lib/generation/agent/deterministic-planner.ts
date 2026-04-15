/**
 * Deterministic Phase A planner.
 *
 * Mirrors the legacy `generateClassroom()` pipeline exactly; every step is
 * wrapped as a subagent so events flow through the shared activity tree and
 * SSE channel. No LLM is involved in ordering or dispatch.
 */

import { createLogger } from '@/lib/logger';
import { applyOutlineFallbacks } from '@/lib/generation/outline-generator';
import {
  mediaGeneratorSubagent,
  outlineGeneratorSubagent,
  ragRetrieverSubagent,
  requirementAnalyzerSubagent,
  sceneActionGeneratorSubagent,
  sceneComposerSubagent,
  sceneContentGeneratorSubagent,
  ttsGeneratorSubagent,
  webResearcherSubagent,
} from './subagents';
import {
  ActivityTree,
  buildCtxBase,
  runPool,
  runSubagent,
  type OrchestratorInput,
  type OrchestratorOutput,
} from './runtime';

const log = createLogger('GenerationAgent:Deterministic');

const SCENE_CONCURRENCY = 3;

export async function runDeterministicPlanner(
  input: OrchestratorInput,
  tree: ActivityTree,
): Promise<OrchestratorOutput> {
  const ctxBase = buildCtxBase(input);

  // 1. Web research (optional)
  let researchContext: string | undefined;
  if (input.enableWebSearch && input.webSearchApiKey) {
    const result = await runSubagent(
      tree,
      webResearcherSubagent,
      {
        requirement: input.requirement,
        pdfText: input.pdfText,
        apiKey: input.webSearchApiKey,
      },
      ctxBase,
      null,
    );
    researchContext = result.context;
  }

  // 2. Stage 0: requirement analysis
  const analysis = await runSubagent(
    tree,
    requirementAnalyzerSubagent,
    {
      requirement: input.requirement,
      language: input.language,
      pdfContent: input.pdfText,
      researchContext,
      availableDocuments: input.availableDocuments,
    },
    ctxBase,
    null,
  );

  // 3. RAG retrieval (optional)
  let documentContext: string | undefined;
  if (input.courseId) {
    const ragQuery = analysis?.ragQuery || input.requirement;
    const docIds = analysis?.referencedDocumentIds?.length
      ? analysis.referencedDocumentIds
      : undefined;
    const ragResult = await runSubagent(
      tree,
      ragRetrieverSubagent,
      {
        courseId: input.courseId,
        query: ragQuery,
        topK: 8,
        maxTokens: 3000,
        documentIds: docIds,
      },
      ctxBase,
      null,
      undefined,
      `query="${ragQuery.substring(0, 60)}"`,
    );
    documentContext = ragResult?.text;
  }

  // 4. Stage 1: outline generation
  const { outlines } = await runSubagent(
    tree,
    outlineGeneratorSubagent,
    {
      requirement: analysis?.enrichedRequirement || input.requirement,
      language: input.language,
      pdfText: input.pdfText,
      researchContext,
      teacherContext: input.teacherContext,
      documentContext,
      imageGenerationEnabled: input.enableImageGeneration,
      videoGenerationEnabled: input.enableVideoGeneration,
    },
    ctxBase,
    null,
  );

  tree.emit({
    type: 'agent.progress',
    pct: 30,
    message: `Generated ${outlines.length} scene outlines`,
    step: 'generating_outlines',
    scenesGenerated: 0,
    totalScenes: outlines.length,
  });

  // 5. Stage 2: per-outline content → actions → compose (concurrent)
  const sceneTasks = outlines.map((rawOutline, index) => async () => {
    const safeOutline = applyOutlineFallbacks(rawOutline, true);

    const content = await runSubagent(
      tree,
      sceneContentGeneratorSubagent,
      { outline: safeOutline, agents: input.agents },
      ctxBase,
      null,
      `Scene ${index + 1}: ${safeOutline.title}`,
    );

    if (!content) {
      log.warn(`Scene "${safeOutline.title}" content failed; skipping`);
      return;
    }

    const { actions } = await runSubagent(
      tree,
      sceneActionGeneratorSubagent,
      { outline: safeOutline, content, agents: input.agents },
      ctxBase,
      null,
      `Actions: ${safeOutline.title}`,
    );

    await runSubagent(
      tree,
      sceneComposerSubagent,
      { outline: safeOutline, content, actions },
      ctxBase,
      null,
      `Compose: ${safeOutline.title}`,
    );

    tree.emit({
      type: 'agent.progress',
      pct: 30 + Math.floor(((index + 1) / outlines.length) * 60),
      message: `Scene ${index + 1}/${outlines.length}`,
      step: 'generating_scenes',
      scenesGenerated: (input.stageApi.scene.list().data ?? []).length,
      totalScenes: outlines.length,
    });
  });

  await runPool(SCENE_CONCURRENCY, sceneTasks);
  const scenes = input.stageApi.scene.list().data ?? [];

  // 6. Media (optional)
  if (input.enableImageGeneration || input.enableVideoGeneration) {
    await runSubagent(
      tree,
      mediaGeneratorSubagent,
      { outlines, stageId: input.stageId, baseUrl: input.baseUrl },
      ctxBase,
      null,
    );
  }

  // 7. TTS (optional)
  if (input.enableTTS && scenes.length > 0) {
    await runSubagent(
      tree,
      ttsGeneratorSubagent,
      { scenes, stageId: input.stageId, baseUrl: input.baseUrl },
      ctxBase,
      null,
    );
  }

  return {
    outlines,
    scenes,
    agentTree: tree.snapshot(),
  };
}
