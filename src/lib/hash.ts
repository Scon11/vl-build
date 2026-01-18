/**
 * Hashing Utilities
 * 
 * Provides SHA-256 hashing for file and text deduplication.
 */

import { createHash } from "crypto";

/**
 * Compute SHA-256 hash of a buffer (for file deduplication).
 * Returns a 64-character hex string.
 */
export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Normalize text for hashing (for paste deduplication).
 * - Trims whitespace
 * - Normalizes line endings to \n
 * - Collapses multiple whitespace to single space
 * - Lowercases for case-insensitive comparison
 */
export function normalizeTextForHash(text: string): string {
  return text
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .toLowerCase();
}

/**
 * Compute SHA-256 hash of normalized text (for paste deduplication).
 * Returns a 64-character hex string.
 */
export function hashText(text: string): string {
  const normalized = normalizeTextForHash(text);
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Generate a short hash prefix for display (first 8 characters).
 */
export function shortHash(hash: string): string {
  return hash.slice(0, 8);
}
