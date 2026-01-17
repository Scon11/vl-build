/**
 * Document Segmenter
 * 
 * Segments tender text into header and stop blocks.
 * Used to scope rule application correctly.
 */

export interface TextSegment {
  type: "header" | "pickup" | "delivery";
  startIndex: number;
  endIndex: number;
  text: string;
}

export interface SegmentationResult {
  segments: TextSegment[];
  headerEnd: number; // Where header ends
}

// Patterns that indicate start of stops section
const STOPS_SECTION_PATTERNS = [
  /\bstops\b/i,
  /\bpickup\s*(?:#?\d*|information|details)?$/im,
  /\bdelivery\s*(?:#?\d*|information|details)?$/im,
  /\bship\s*from\b/i,
  /\bship\s*to\b/i,
  /\borigin\b/i,
  /\bconsignee\b/i,
  /\bshipper\b/i,
];

// Patterns that indicate a pickup stop block
const PICKUP_BLOCK_PATTERNS = [
  /\bpickup\b/i,
  /\bship\s*from\b/i,
  /\borigin\b/i,
  /\bshipper\b/i,
  /\bpu\s*#/i,
];

// Patterns that indicate a delivery stop block
const DELIVERY_BLOCK_PATTERNS = [
  /\bdelivery\b/i,
  /\bdeliver\s*to\b/i,
  /\bship\s*to\b/i,
  /\bconsignee\b/i,
  /\bdestination\b/i,
  /\bdel\s*#/i,
];

/**
 * Find where the header ends and stops begin.
 */
function findHeaderEnd(text: string): number {
  let earliestMatch = text.length;
  
  for (const pattern of STOPS_SECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match && match.index !== undefined && match.index < earliestMatch) {
      earliestMatch = match.index;
    }
  }
  
  return earliestMatch;
}

/**
 * Determine if a position is within a pickup or delivery block.
 */
export function getBlockTypeAtPosition(
  text: string, 
  position: number, 
  windowSize: number = 200
): "header" | "pickup" | "delivery" | "unknown" {
  const result = segmentDocument(text);
  
  for (const segment of result.segments) {
    if (position >= segment.startIndex && position < segment.endIndex) {
      return segment.type;
    }
  }
  
  // Check nearby context as fallback
  const windowStart = Math.max(0, position - windowSize);
  const window = text.slice(windowStart, position);
  
  // Check for pickup context
  for (const pattern of PICKUP_BLOCK_PATTERNS) {
    if (pattern.test(window)) {
      return "pickup";
    }
  }
  
  // Check for delivery context
  for (const pattern of DELIVERY_BLOCK_PATTERNS) {
    if (pattern.test(window)) {
      return "delivery";
    }
  }
  
  // If before header end, it's header
  if (position < result.headerEnd) {
    return "header";
  }
  
  return "unknown";
}

/**
 * Segment the document into header and stop blocks.
 */
export function segmentDocument(text: string): SegmentationResult {
  const segments: TextSegment[] = [];
  const headerEnd = findHeaderEnd(text);
  
  // Add header segment
  if (headerEnd > 0) {
    segments.push({
      type: "header",
      startIndex: 0,
      endIndex: headerEnd,
      text: text.slice(0, headerEnd),
    });
  }
  
  // Find stop blocks in the remaining text
  const stopsText = text.slice(headerEnd);
  let currentPos = headerEnd;
  
  // Find all pickup and delivery markers
  const markers: { type: "pickup" | "delivery"; index: number }[] = [];
  
  for (const pattern of PICKUP_BLOCK_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, "gi");
    while ((match = regex.exec(stopsText)) !== null) {
      markers.push({ type: "pickup", index: headerEnd + match.index });
    }
  }
  
  for (const pattern of DELIVERY_BLOCK_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, "gi");
    while ((match = regex.exec(stopsText)) !== null) {
      markers.push({ type: "delivery", index: headerEnd + match.index });
    }
  }
  
  // Sort markers by position
  markers.sort((a, b) => a.index - b.index);
  
  // Dedupe markers that are close together (within 20 chars)
  const dedupedMarkers: typeof markers = [];
  for (const marker of markers) {
    const last = dedupedMarkers[dedupedMarkers.length - 1];
    if (!last || marker.index - last.index > 20) {
      dedupedMarkers.push(marker);
    }
  }
  
  // Create segments from markers
  for (let i = 0; i < dedupedMarkers.length; i++) {
    const marker = dedupedMarkers[i];
    const nextMarker = dedupedMarkers[i + 1];
    const endIndex = nextMarker ? nextMarker.index : text.length;
    
    segments.push({
      type: marker.type,
      startIndex: marker.index,
      endIndex,
      text: text.slice(marker.index, endIndex),
    });
  }
  
  return { segments, headerEnd };
}

/**
 * Check if a position is in the header section.
 */
export function isInHeader(text: string, position: number): boolean {
  const result = segmentDocument(text);
  return position < result.headerEnd;
}

/**
 * Check if a position is in a stop section (pickup or delivery).
 */
export function isInStopSection(text: string, position: number): boolean {
  const blockType = getBlockTypeAtPosition(text, position);
  return blockType === "pickup" || blockType === "delivery";
}
