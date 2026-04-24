/**
 * Agent artifact emission helpers — a single choke-point so both planners
 * (deterministic and LLM) report user-facing documents through the same path:
 * persist to IndexedDB and broadcast an `agent.artifact_created` event.
 *
 * Persistence failures are swallowed on purpose — a malfunctioning IndexedDB
 * must not abort classroom generation.
 */

import type { SceneOutline } from '@/lib/types/generation';
import { saveAgentArtifact, type AgentArtifactKind } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';
import type { ActivityTree } from './runtime';

const log = createLogger('GenerationAgent:Artifacts');

const MARKDOWN_PREVIEW_CHARS = 200;

export interface EmitArtifactArgs {
  stageId: string;
  artifactId: string;
  kind: AgentArtifactKind;
  title: string;
  markdown: string;
}

export async function emitArtifact(tree: ActivityTree, args: EmitArtifactArgs): Promise<void> {
  try {
    await saveAgentArtifact(args);
  } catch (err) {
    log.warn(`Failed to persist agent artifact ${args.artifactId}`, err);
  }
  try {
    tree.emit({
      type: 'agent.artifact_created',
      stageId: args.stageId,
      artifactId: args.artifactId,
      kind: args.kind,
      title: args.title,
      markdownPreview: args.markdown.slice(0, MARKDOWN_PREVIEW_CHARS),
      byteSize: args.markdown.length,
    });
  } catch (err) {
    log.warn(`Failed to emit artifact_created event for ${args.artifactId}`, err);
  }
}

const OUTLINE_LABELS = {
  'zh-CN': {
    title: '课程大纲',
    type: '类型',
    description: '描述',
    objective: '教学目标',
    duration: '预计时长',
    keyPoints: '要点',
    slide: '讲解幻灯片',
    quiz: '随堂测验',
    interactive: '交互模拟',
    pbl: '项目式学习',
  },
  'en-US': {
    title: 'Course Outline',
    type: 'Type',
    description: 'Description',
    objective: 'Objective',
    duration: 'Estimated duration',
    keyPoints: 'Key points',
    slide: 'Slide',
    quiz: 'Quiz',
    interactive: 'Interactive',
    pbl: 'Project-Based Learning',
  },
} as const;

/**
 * Render a scene outline list to a reader-friendly markdown document.
 * The same output feeds the sidebar preview and the PDF/DOCX export path, so
 * keep the structure predictable (heading → bullet block → key-points list).
 */
export function outlinesToMarkdown(
  outlines: SceneOutline[],
  language: 'zh-CN' | 'en-US',
  title?: string,
): string {
  const L = OUTLINE_LABELS[language];
  const lines: string[] = [];
  lines.push(`# ${title ?? L.title}`);
  lines.push('');
  outlines.forEach((o, i) => {
    lines.push(`## ${i + 1}. ${o.title}`);
    lines.push('');
    lines.push(`- **${L.type}**: ${L[o.type]}`);
    if (o.description) lines.push(`- **${L.description}**: ${o.description}`);
    if (o.teachingObjective) lines.push(`- **${L.objective}**: ${o.teachingObjective}`);
    if (typeof o.estimatedDuration === 'number')
      lines.push(`- **${L.duration}**: ${Math.round(o.estimatedDuration / 60)} min`);
    if (o.keyPoints?.length) {
      lines.push('');
      lines.push(`**${L.keyPoints}:**`);
      for (const kp of o.keyPoints) lines.push(`- ${kp}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}
