/**
 * Agent artifact emission helpers.
 *
 * Centralises the "persist + broadcast" flow used by both planners. Any code
 * path that produces a user-facing markdown document (outline, experiment
 * report, handout, etc.) should call `emitArtifact()` so:
 *
 *   1. The document is written to IndexedDB via `saveAgentArtifact`.
 *   2. An `agent.artifact_created` event is emitted on the activity tree,
 *      reaching the client through the same SSE channel as progress updates.
 *
 * Persistence failures are logged but never rethrown — a malfunctioning
 * IndexedDB must not abort classroom generation.
 */

import type { SceneOutline } from '@/lib/types/generation';
import { saveAgentArtifact } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';
import type { ActivityTree } from './runtime';

const log = createLogger('GenerationAgent:Artifacts');

const MARKDOWN_PREVIEW_CHARS = 200;

export interface EmitArtifactArgs {
  stageId: string;
  artifactId: string;
  kind: 'outline' | 'document';
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

/**
 * Render a scene outline list to a reader-friendly markdown document.
 * Keep the format stable: the same transform feeds the PDF/DOCX export path.
 */
export function outlinesToMarkdown(
  outlines: SceneOutline[],
  language: 'zh-CN' | 'en-US',
  title?: string,
): string {
  const heading = title ?? (language === 'zh-CN' ? '课程大纲' : 'Course Outline');
  const typeLabel = (t: SceneOutline['type']): string => {
    if (language === 'zh-CN') {
      switch (t) {
        case 'slide':
          return '讲解幻灯片';
        case 'quiz':
          return '随堂测验';
        case 'interactive':
          return '交互模拟';
        case 'pbl':
          return '项目式学习';
      }
    }
    switch (t) {
      case 'slide':
        return 'Slide';
      case 'quiz':
        return 'Quiz';
      case 'interactive':
        return 'Interactive';
      case 'pbl':
        return 'Project-Based Learning';
    }
  };
  const keyPointsLabel = language === 'zh-CN' ? '要点' : 'Key points';
  const objectiveLabel = language === 'zh-CN' ? '教学目标' : 'Objective';
  const durationLabel = language === 'zh-CN' ? '预计时长' : 'Estimated duration';

  const lines: string[] = [];
  lines.push(`# ${heading}`);
  lines.push('');
  outlines.forEach((o, i) => {
    lines.push(`## ${i + 1}. ${o.title}`);
    lines.push('');
    lines.push(`- **${language === 'zh-CN' ? '类型' : 'Type'}**: ${typeLabel(o.type)}`);
    if (o.description)
      lines.push(`- **${language === 'zh-CN' ? '描述' : 'Description'}**: ${o.description}`);
    if (o.teachingObjective) lines.push(`- **${objectiveLabel}**: ${o.teachingObjective}`);
    if (typeof o.estimatedDuration === 'number')
      lines.push(`- **${durationLabel}**: ${Math.round(o.estimatedDuration / 60)} min`);
    if (o.keyPoints?.length) {
      lines.push('');
      lines.push(`**${keyPointsLabel}:**`);
      for (const kp of o.keyPoints) lines.push(`- ${kp}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}
