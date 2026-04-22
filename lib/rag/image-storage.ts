/**
 * On-disk storage for chunk-extracted images.
 *
 * Layout:   data/documents/{courseId}/{docId}/images/{chunkId}.{ext}
 *
 * All paths stored in the DB are relative to process.cwd() so the app can
 * move its data directory without breaking references.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';

const log = createLogger('RAG:ImageStorage');

function imagesDir(courseId: string, documentId: string): string {
  return path.join('data', 'documents', courseId, documentId, 'images');
}

/**
 * Persist a chunk image and return its path relative to process.cwd().
 */
export async function saveChunkImage(
  courseId: string,
  documentId: string,
  chunkId: string,
  buffer: Buffer,
  ext: string,
): Promise<string> {
  const dir = imagesDir(courseId, documentId);
  await fs.mkdir(dir, { recursive: true });
  const relativePath = path.join(dir, `${chunkId}.${ext}`);
  const absolutePath = path.join(process.cwd(), relativePath);
  await fs.writeFile(absolutePath, new Uint8Array(buffer));
  return relativePath;
}

/**
 * Remove all chunk images for a document. Safe to call when the directory
 * does not exist.
 */
export async function deleteDocumentImages(courseId: string, documentId: string): Promise<void> {
  const dir = path.join(process.cwd(), imagesDir(courseId, documentId));
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    log.warn(`Failed to clean image directory for doc ${documentId}:`, err);
  }
}

/**
 * Remove all chunk image directories for a course (used on course delete).
 */
export async function deleteCourseImages(courseId: string): Promise<void> {
  const dir = path.join(process.cwd(), 'data', 'documents', courseId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    log.warn(`Failed to clean image directory for course ${courseId}:`, err);
  }
}
