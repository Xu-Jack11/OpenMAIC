/**
 * Skill Manifest — declarative plugin definition loaded from skill.yaml
 */

export interface SkillManifest {
  /** Unique skill identifier (e.g. 'handout') */
  id: string;

  /** Lucide icon name (e.g. 'BookOpen') */
  icon: string;

  /** i18n key prefix (e.g. 'supplementary.handout') */
  i18nPrefix: string;

  /** Supported export formats */
  supportedFormats: ('docx' | 'pdf' | 'markdown')[];

  /** Outline generation guidance, keyed by language */
  guidance?: Record<string, string>;

  /** LLM generation configuration */
  generation: {
    /** Prompt template ID from PROMPT_IDS (e.g. 'handout') */
    promptId: string;

    /**
     * Variable mapping: template variable name → value source.
     * Special values:
     * - 'stage.name' → input.stage.name
     * - 'stage.description' → input.stage.description
     * - 'stage.language' → input.stage.language || input.locale
     * - 'sceneSummary' → summarizeScenes(input.scenes)
     */
    variables: Record<string, string>;

    /** Key in the LLM response JSON to extract (e.g. 'handout') */
    responseKey: string;

    /**
     * Phase D — optional Zod schema id for output validation. When set, the
     * skill API route looks up `lib/plugins/schemas.ts` for a matching
     * schema and validates the parsed response. Missing or unknown ids skip
     * validation (backward-compatible with legacy manifests).
     */
    outputSchema?: string;

    /**
     * Phase D — declares that the plugin supports incremental output. The
     * runtime will stream partial data when `true`. Default false.
     */
    streaming?: boolean;

    /**
     * Phase D — ids of secondary tools this plugin may invoke during
     * generation (e.g. 'rag.search'). Advisory only in Phase D; Phase B's
     * LLM planner may consume it in a future update.
     */
    tools?: string[];
  };

  /** Optional custom preview component path (relative to components/supplementary/) */
  preview?: {
    component: string;
  };

  /** Optional custom export converter path (relative to lib/export/document/converters/) */
  export?: {
    converter: string;
  };
}
