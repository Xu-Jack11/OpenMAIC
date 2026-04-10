/**
 * Test: Requirement Analysis Prompt Resolution
 *
 * Simulates the prompt that gets built when a user enters
 * "根据文档生成课堂" in a course with indexed documents.
 *
 * Usage: npx tsx tests/test-requirement-analysis.ts
 */

import { buildPrompt, PROMPT_IDS } from '@/lib/generation/prompts';

const REQUIREMENT = '根据文档生成课堂';
const LANGUAGE = 'zh-CN';
const COURSE_ID = 'cmnqy1z6h0002s7ryly400e0t';

const MOCK_AVAILABLE_DOCUMENTS = [
  { id: 'doc-001', name: '示例教学文档.pdf' },
  { id: 'doc-002', name: '核心概念笔记.docx' },
];

const none = LANGUAGE === 'zh-CN' ? '无' : 'None';

// Build the same prompt as analyzeRequirement() does (before RAG retrieval)
const prompts = buildPrompt(PROMPT_IDS.REQUIREMENT_ANALYSIS, {
  requirement: REQUIREMENT,
  language: LANGUAGE,
  pdfContent: none,
  documentContext: none,
  researchContext: none,
  userProfile: none,
  availableDocuments: MOCK_AVAILABLE_DOCUMENTS.map((doc) => `- ${doc.name} (ID: ${doc.id})`).join('\n'),
});

if (!prompts) {
  console.error('Failed to build prompt - template not found');
  process.exit(1);
}

console.log('='.repeat(80));
console.log('REQUIREMENT ANALYSIS PROMPT TEST');
console.log('='.repeat(80));
console.log();
console.log(`Input: "${REQUIREMENT}"`);
console.log(`Language: ${LANGUAGE}`);
console.log(`Course ID: ${COURSE_ID}`);
console.log(`Available Documents: ${MOCK_AVAILABLE_DOCUMENTS.length}`);
console.log();

console.log('─'.repeat(80));
console.log('SYSTEM PROMPT:');
console.log('─'.repeat(80));
console.log(prompts.system);
console.log();

console.log('─'.repeat(80));
console.log('USER PROMPT:');
console.log('─'.repeat(80));
console.log(prompts.user);
console.log();

console.log('='.repeat(80));
console.log('EXPECTED LLM OUTPUT SCHEMA:');
console.log('='.repeat(80));
console.log(JSON.stringify(
  {
    topic: 'string - Core topic inferred from document names/themes',
    subTopics: ["string - sub-topics from document themes"],
    audience: 'beginner | intermediate | advanced',
    audienceDescription: 'string',
    depth: 'overview | working-knowledge | deep-dive',
    estimatedDurationMinutes: 'number',
    style: 'lecture | hands-on | discussion | case-study | mixed',
    focusAreas: ["string - key areas from document"],
    prerequisites: ["string"],
    enrichedRequirement:
      'string - detailed paragraph combining user intent + document themes',
    ragQuery: 'string - concise topic-focused query for vector similarity search',
    referencedDocumentIds: ['doc-001', 'doc-002'],
  },
  null,
  2,
));

console.log();
console.log('VALIDATION CHECKS:');
console.log('- referencedDocumentIds should only contain IDs from availableDocuments');
console.log('- ragQuery should NOT remain as meta-instruction text');
console.log('- ragQuery should extract topical keywords from available documents');
