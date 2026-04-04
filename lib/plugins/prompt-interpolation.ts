/**
 * Client-side prompt variable interpolation.
 *
 * Mirrors the server-side interpolateVariables() in lib/generation/prompts/loader.ts
 * but without filesystem dependencies, so it can run in the browser.
 */

/**
 * Replace {{variable}} placeholders in a template string.
 * Unmatched placeholders are left as-is.
 */
export function interpolatePrompt(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match;
  });
}
