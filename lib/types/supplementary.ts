/**
 * Supplementary content types for classroom handouts, experiments, and extended reading.
 * These represent LLM-generated content structures.
 */

// ==================== Handout ====================

export interface HandoutSection {
  type: 'slide' | 'quiz' | 'interactive' | 'pbl';
  title: string;
  keyPoints: string[];
  notes: string;
  questions?: Array<{
    question: string;
    options?: string[];
    answer?: string;
    analysis?: string;
  }>;
}

export interface Handout {
  title: string;
  overview: string;
  sections: HandoutSection[];
  summary: string;
}

// ==================== Experiment Design ====================

export interface ExperimentMaterial {
  name: string;
  quantity: string;
  notes?: string;
}

export interface ExperimentStep {
  order: number;
  instruction: string;
  duration?: string;
  tips?: string;
}

export interface ExperimentDesign {
  title: string;
  subject: string;
  purpose: string;
  materials: ExperimentMaterial[];
  steps: ExperimentStep[];
  safetyNotes: string[];
  expectedResults: string;
  thinkingQuestions: string[];
}

// ==================== Extended Reading ====================

export interface ReadingKnowledgePoint {
  title: string;
  content: string;
  connections?: string;
}

export interface ReadingResource {
  title: string;
  type: 'book' | 'article' | 'video' | 'website' | 'other';
  description: string;
  url?: string;
}

export interface ExtendedReading {
  title: string;
  topicOverview: string;
  knowledgePoints: ReadingKnowledgePoint[];
  recommendedResources: ReadingResource[];
  guidingQuestions: string[];
}
