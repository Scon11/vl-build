import mammoth from "mammoth";
import { extractText } from "unpdf";

export type SupportedFileType = "pdf" | "docx" | "doc" | "txt";

/**
 * Clean extracted PDF text by removing filename/footer artifacts.
 */
function cleanPdfText(text: string, filename: string): string {
  const lines = text.split("\n");
  const cleanedLines: string[] = [];
  
  // Get filename without extension for matching
  const filenameWithoutExt = filename.replace(/\.[^.]+$/, "");
  const filenameLower = filename.toLowerCase();
  const filenameWithoutExtLower = filenameWithoutExt.toLowerCase();
  
  // Track line occurrences for repeated footer detection
  const lineOccurrences = new Map<string, number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length < 100) { // Only track short lines
      lineOccurrences.set(trimmed, (lineOccurrences.get(trimmed) || 0) + 1);
    }
  }
  
  // Page pattern regex
  const pagePattern = /^\s*page\s+\d+\s+(of|\/)\s+\d+\s*$/i;
  const pagePatternPartial = /page\s+\d+\s+(of|\/)\s+\d+/i;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const lineLower = trimmedLine.toLowerCase();
    
    // Skip empty lines (but keep them for formatting)
    if (trimmedLine.length === 0) {
      cleanedLines.push(line);
      continue;
    }
    
    // 1. Skip lines containing the filename
    if (lineLower.includes(filenameLower) || lineLower.includes(filenameWithoutExtLower)) {
      continue;
    }
    
    // 2. Skip pure "Page X of Y" lines
    if (pagePattern.test(trimmedLine)) {
      continue;
    }
    
    // 3. Skip lines that look like page indicators with timestamps (common PDF artifact)
    // e.g., "Tender-00121224-20250905-055319Z.pdf ... Page 1 of 2"
    if (pagePatternPartial.test(trimmedLine) && /\d{8,}/.test(trimmedLine)) {
      continue;
    }
    
    // 4. Skip repeated short lines (appear 3+ times) - likely headers/footers
    if (trimmedLine.length < 80 && (lineOccurrences.get(trimmedLine) || 0) >= 3) {
      continue;
    }
    
    // 5. Skip lines that are just a filename-like pattern with timestamps
    // e.g., "Tender-00121224-20250905-055319Z"
    if (/^[A-Za-z]+-\d{6,}-\d{8,}[A-Z]?\.?\w*$/.test(trimmedLine)) {
      continue;
    }
    
    cleanedLines.push(line);
  }
  
  // Remove excessive blank lines (more than 2 in a row)
  let result = cleanedLines.join("\n");
  result = result.replace(/\n{4,}/g, "\n\n\n");
  
  return result.trim();
}

export interface ParseResult {
  text: string;
  metadata: {
    file_type: SupportedFileType;
    page_count?: number;
    word_count: number;
  };
}

export function getFileType(filename: string): SupportedFileType | null {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    case "doc":
      return "doc";
    case "txt":
      return "txt";
    default:
      return null;
  }
}

export function isSupported(filename: string): boolean {
  return getFileType(filename) !== null;
}

export async function parseFile(
  buffer: Buffer,
  filename: string
): Promise<ParseResult> {
  const fileType = getFileType(filename);

  if (!fileType) {
    throw new Error(`Unsupported file type: ${filename}`);
  }

  switch (fileType) {
    case "pdf":
      return parsePDF(buffer, filename);
    case "docx":
      return parseDocx(buffer);
    case "doc":
      throw new Error(
        ".doc files are not supported. Please save as .docx and re-upload."
      );
    case "txt":
      return parseTxt(buffer);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function parsePDF(buffer: Buffer, filename: string): Promise<ParseResult> {
  // Convert Buffer to Uint8Array for unpdf
  const uint8Array = new Uint8Array(buffer);
  
  const result = await extractText(uint8Array);
  
  // unpdf returns { text: string[], totalPages: number }
  // Join all pages into a single string
  const textContent = Array.isArray(result.text) 
    ? result.text.join("\n\n") 
    : String(result.text);
  
  // Clean the extracted text to remove filename/footer artifacts
  const cleanedText = cleanPdfText(textContent, filename);

  if (!cleanedText) {
    throw new Error("PDF appears to be empty or contains only images");
  }

  return {
    text: cleanedText,
    metadata: {
      file_type: "pdf",
      page_count: result.totalPages,
      word_count: countWords(cleanedText),
    },
  };
}

async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const result = await mammoth.extractRawText({ buffer });

  const text = result.value.trim();

  if (!text) {
    throw new Error("Word document appears to be empty");
  }

  if (result.messages.length > 0) {
    console.warn("Mammoth warnings:", result.messages);
  }

  return {
    text,
    metadata: {
      file_type: "docx",
      word_count: countWords(text),
    },
  };
}

async function parseTxt(buffer: Buffer): Promise<ParseResult> {
  const text = buffer.toString("utf-8").trim();

  if (!text) {
    throw new Error("Text file is empty");
  }

  return {
    text,
    metadata: {
      file_type: "txt",
      word_count: countWords(text),
    },
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Get page count from a PDF buffer without full text extraction.
 * Returns null if unable to determine page count.
 */
export async function getPageCount(buffer: Buffer): Promise<number | null> {
  try {
    const uint8Array = new Uint8Array(buffer);
    const result = await extractText(uint8Array);
    return result.totalPages || null;
  } catch {
    return null;
  }
}
