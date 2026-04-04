import type {
  Scene,
  SlideContent,
  QuizContent,
  InteractiveContent,
  PBLContent,
} from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function extractSpeechText(scene: Scene): string[] {
  if (!scene.actions) return [];
  return scene.actions.filter((a): a is SpeechAction => a.type === 'speech').map((a) => a.text);
}

function summarizeSlide(scene: Scene): string {
  const content = scene.content as SlideContent;
  const parts: string[] = [`[Slide] ${scene.title}`];

  if (content.canvas?.elements) {
    for (const el of content.canvas.elements) {
      if ('content' in el && typeof el.content === 'string') {
        const text = stripHtml(el.content);
        if (text) parts.push(text);
      }
    }
  }

  const speeches = extractSpeechText(scene);
  if (speeches.length > 0) {
    parts.push('Speaker notes: ' + speeches.join(' '));
  }

  return parts.join('\n');
}

function summarizeQuiz(scene: Scene): string {
  const content = scene.content as QuizContent;
  const parts: string[] = [`[Quiz] ${scene.title}`];

  for (const q of content.questions) {
    parts.push(`Q: ${q.question} (${q.type})`);
    if (q.options) {
      for (const opt of q.options) {
        parts.push(`  ${opt.value}. ${opt.label}`);
      }
    }
    if (q.answer) {
      parts.push(`  Answer: ${q.answer.join(', ')}`);
    }
    if (q.analysis) {
      parts.push(`  Analysis: ${q.analysis}`);
    }
  }

  return parts.join('\n');
}

function summarizeInteractive(scene: Scene): string {
  const content = scene.content as InteractiveContent;
  const parts: string[] = [`[Interactive] ${scene.title}`];
  if (content.url) parts.push(`URL: ${content.url}`);

  const speeches = extractSpeechText(scene);
  if (speeches.length > 0) {
    parts.push('Description: ' + speeches.join(' '));
  }

  return parts.join('\n');
}

function summarizePbl(scene: Scene): string {
  const content = scene.content as PBLContent;
  const config = content.projectConfig;
  const parts: string[] = [`[PBL] ${scene.title}`];

  if (config.projectInfo) {
    parts.push(`Project: ${config.projectInfo.title}`);
    parts.push(`Description: ${config.projectInfo.description}`);
  }

  if (config.agents) {
    const roles = config.agents
      .filter((a) => !a.is_system_agent)
      .map((a) => `${a.name} (${a.actor_role})`)
      .join(', ');
    if (roles) parts.push(`Roles: ${roles}`);
  }

  if (config.issueboard?.issues) {
    const tasks = config.issueboard.issues.map((i) => i.title).join(', ');
    if (tasks) parts.push(`Tasks: ${tasks}`);
  }

  return parts.join('\n');
}

/**
 * Extract a compact text summary from scenes for LLM input.
 * Sorts by scene order, then dispatches to type-specific summarizers.
 */
export function summarizeScenes(scenes: Scene[]): string {
  const sorted = [...scenes].sort((a, b) => a.order - b.order);

  return sorted
    .map((scene) => {
      switch (scene.content.type) {
        case 'slide':
          return summarizeSlide(scene);
        case 'quiz':
          return summarizeQuiz(scene);
        case 'interactive':
          return summarizeInteractive(scene);
        case 'pbl':
          return summarizePbl(scene);
        default:
          return `[${scene.type}] ${scene.title}`;
      }
    })
    .join('\n\n---\n\n');
}
