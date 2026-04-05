import { ParsedDocumentContent } from './document';

/**
 * PDF parsing result types
 * Extended to support advanced features from providers like MinerU
 */

/**
 * Parsed PDF content with text and images
 */
export type ParsedPdfContent = ParsedDocumentContent;

/**
 * Request parameters for PDF parsing
 */
export interface ParsePdfRequest {
  /** PDF file to parse */
  pdf: File;
}

/**
 * Response from PDF parsing API
 */
export interface ParsePdfResponse {
  success: boolean;
  data?: ParsedPdfContent;
  error?: string;
}