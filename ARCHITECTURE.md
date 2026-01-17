# VL Build - Architecture Overview

## Project Summary

**VL Build** is an internal freight brokerage tool for parsing load tenders from emails, PDFs, and Word documents. It uses a hybrid extraction approach (deterministic regex + LLM classification) to extract structured shipment data, presents it for human review, and stores the corrected results in Supabase.

**Version:** V1.2 (Enhanced extraction + customer learning)

**Status:** Production-ready for internal use

---

## Tech Stack

- **Framework:** Next.js 16.1.3 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS 4
- **Database:** Supabase (PostgreSQL)
- **File Storage:** Supabase Storage
- **LLM:** OpenAI GPT-4o-mini (for classification)
- **PDF Parsing:** unpdf
- **Word Parsing:** mammoth
- **Deployment:** Not yet configured (local dev only)

---

## Core Architecture

### Extraction Pipeline

```
User Input (Paste/File)
    ↓
[1] File Parsing & Text Cleanup
    - PDF/DOCX/TXT parsing
    - Remove filename/footer contamination from PDFs
    - Filter repeated page headers/footers
    ↓
[2] Store Tender in Supabase
    ↓
[3] Deterministic Extraction (Regex)
    - Finds candidates: numbers, dates, addresses, weights, etc.
    - Captures label hints and context
    - Filters out phone numbers (XXX-XXX-XXXX patterns)
    - Applies customer-specific rules (label maps, regex patterns)
    - Stores in extraction_runs.candidates (JSONB)
    ↓
[4] LLM Classification (GPT-4o-mini)
    - Structures candidates into shipment schema
    - Classifies reference numbers (PO, BOL, pickup#, etc.)
    - Uses customer profile context (cargo hints, reference rules)
    - Never invents data (returns null for missing fields)
    ↓
[5] Post-LLM Verification
    - Validates all LLM values against source text
    - Flags unsupported/hallucinated values with warnings
    ↓
[6] Shipment Normalization
    - Scopes reference numbers (global vs stop-level)
    - De-duplicates references appearing in multiple places
    - Sets cargo from header totals when available
    - Stores in extraction_runs.llm_output (JSONB)
    ↓
[7] Human Review Screen
    - Editable structured fields with hallucination warnings
    - PDF viewer for uploaded documents
    - Customer selection dropdown + cargo rules config
    - Can correct mistakes & reclassify reference numbers
    ↓
[8] Save Final Fields + Learning
    - Stores corrected data in final_fields table
    - Detects reclassifications → suggests rules
    - User can apply suggested rules to customer profile
    - Updates tender status: draft → reviewed
```

### Key Principles

1. **Never invent data** - LLM only classifies what was found, returns null for missing
2. **Hybrid approach** - Regex finds candidates, LLM structures them
3. **Human in the loop** - All extractions reviewed before saving
4. **Audit trail** - Original text, candidates, LLM output, and final fields all stored

---

## Data Model

### Tables

#### `tenders`
- `id` (UUID, PK)
- `source_type` (TEXT: 'paste' | 'file')
- `original_text` (TEXT) - Extracted text from file or paste
- `original_file_url` (TEXT, nullable) - Supabase Storage URL if file upload
- `status` (TEXT: 'draft' | 'reviewed' | 'exported')
- `customer_id` (UUID, FK → customer_profiles.id, nullable) - Associated customer
- `reviewed_at` (TIMESTAMPTZ, nullable)
- `created_at` (TIMESTAMPTZ)

#### `extraction_runs`
- `id` (UUID, PK)
- `tender_id` (UUID, FK → tenders.id)
- `candidates` (JSONB) - Array of ExtractedCandidate objects
- `metadata` (JSONB) - Extraction metadata (version, timestamp, file info)
- `llm_output` (JSONB, nullable) - StructuredShipment object from LLM
- `created_at` (TIMESTAMPTZ)

#### `final_fields`
- `id` (UUID, PK)
- `tender_id` (UUID, FK → tenders.id)
- `shipment` (JSONB) - Final reviewed StructuredShipment
- `reviewed_by` (TEXT, nullable) - For future auth
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

#### `customer_profiles`
- `id` (UUID, PK)
- `name` (TEXT) - Customer display name
- `code` (TEXT, nullable) - Short code like "ACME" or "FFI"
- `reference_label_rules` (JSONB) - Array of learned label → subtype mappings
- `reference_regex_rules` (JSONB) - Array of regex pattern → subtype mappings
- `stop_parsing_hints` (JSONB) - Customer-specific parsing hints
- `cargo_hints` (JSONB) - Cargo inference rules:
  - `commodity_by_temp`: { frozen, refrigerated, dry } - Commodity based on temperature
  - `default_commodity`: Default commodity if not detected
  - `default_temp_mode`: Default temperature mode (frozen/refrigerated/dry)
- `notes` (TEXT, nullable)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

#### Supabase Storage
- **Bucket:** `tender-files` (public)
- Stores original PDF/DOCX/TXT files
- Files named: `{timestamp}-{random}.{ext}`

---

## Customer-Specific Learning System

### Overview
VL Build supports customer-specific learning via rules (no fine-tuning). When users correct reference number classifications, the system can learn these patterns for future extractions.

### How It Works
1. **Customer Selection** - User selects a customer from dropdown on the review page
2. **Extraction with Customer Rules** - If a customer is selected:
   - Customer label rules are checked before generic rules
   - Customer regex patterns are matched against reference numbers
   - Customer context is included in the LLM prompt
3. **Learning on Save** - When user reclassifies a reference number:
   - System detects the difference between LLM output and user correction
   - Suggests new rules based on the observed label/context
   - User can accept to add rules to the customer profile
4. **Future Extractions** - Customer rules are applied automatically

### Rule Types
- **Label Rules**: Map label text to reference subtypes (e.g., "Release #" → PO)
- **Regex Rules**: Match value patterns to subtypes (e.g., `^FFI\d+$` → PO)
- **Stop Parsing Hints**: Customer-specific pickup/delivery keywords
- **Cargo Hints**: Temperature-based commodity inference:
  - `commodity_by_temp.frozen`: Commodity for temp < 32°F (e.g., "Frozen Food")
  - `commodity_by_temp.refrigerated`: Commodity for temp 32-40°F
  - `commodity_by_temp.dry`: Commodity for no temp control
  - `default_temp_mode`: Assume frozen/refrigerated/dry if not specified

### API Endpoints
- `GET /api/customers` - List all customer profiles
- `POST /api/customers` - Create new customer
- `GET /api/customers/[id]` - Get customer profile
- `PATCH /api/customers/[id]` - Update customer profile
- `POST /api/customers/[id]/rules` - Add a learned rule
- `DELETE /api/customers/[id]/rules` - Remove a rule

---

## Type Definitions

### Core Types (`src/lib/types.ts`)

```typescript
// Tender status
type TenderStatus = "draft" | "reviewed" | "exported";

// Source type
type SourceType = "paste" | "file";

// Reference number subtypes
type ReferenceNumberSubtype = 
  | "po" | "bol" | "order" | "pickup" | "delivery" 
  | "appointment" | "reference" | "confirmation" | "pro" | "unknown";

// Extracted candidate (from regex)
interface ExtractedCandidate {
  type: CandidateType;
  value: string;
  raw_match: string;
  label_hint: string | null;
  subtype: ReferenceNumberSubtype | null;
  confidence: "high" | "medium" | "low";
  position: { start: number; end: number };
  context: string;
}

// Structured shipment (LLM output + human edits)
interface StructuredShipment {
  reference_numbers: ReferenceNumber[];
  stops: Stop[];
  cargo: CargoDetails;
  unclassified_notes: string[];
  classification_metadata: {
    model: string;
    classified_at: string;
    confidence_notes: string | null;
  };
}

// Stop (pickup or delivery)
interface Stop {
  type: "pickup" | "delivery";
  sequence: number;
  location: StopLocation;
  schedule: StopSchedule;
  reference_numbers: ReferenceNumber[];
  notes: string | null;
}
```

---

## API Routes

### `POST /api/tenders`
**Purpose:** Create tender from pasted text

**Request:**
```json
{
  "source_type": "paste",
  "original_text": "..."
}
```

**Response:**
```json
{
  "id": "uuid",
  "candidates_count": 12,
  "has_llm_output": true
}
```

**Flow:**
1. Validates input
2. Creates tender record
3. Runs deterministic extraction
4. Runs LLM classification
5. Stores extraction run
6. Returns tender ID

---

### `POST /api/tenders/upload`
**Purpose:** Create tender from file upload

**Request:** `FormData` with `file` field

**Response:**
```json
{
  "id": "uuid",
  "file_name": "tender.pdf",
  "file_url": "https://...",
  "text_length": 1234,
  "word_count": 200,
  "candidates_count": 12,
  "has_llm_output": true
}
```

**Flow:**
1. Validates file type (PDF, DOCX, TXT)
2. Parses file to extract text
3. Uploads original file to Supabase Storage
4. Creates tender record
5. Runs extraction + LLM classification
6. Stores extraction run
7. Returns tender ID

---

### `GET /api/tenders/[id]`
**Purpose:** Fetch tender with latest extraction

**Response:**
```json
{
  "tender": { ... },
  "extraction": { ... } | null
}
```

---

### `POST /api/tenders/[id]/final-fields`
**Purpose:** Save reviewed/corrected shipment data

**Request:**
```json
{
  "shipment": { ...StructuredShipment }
}
```

**Response:**
```json
{
  "id": "uuid",
  "message": "Final fields saved successfully"
}
```

**Flow:**
1. Validates shipment data
2. Upserts final_fields (insert or update)
3. Updates tender status to "reviewed"
4. Sets reviewed_at timestamp

---

## Key Libraries & Utilities

### `src/lib/supabase.ts`
- Creates server-side Supabase client
- Uses service role key (server-only)
- Never exposed to client

### `src/lib/extractor.ts`
- **Function:** `extractCandidates(text: string, options?: { customerProfile }): ExtractionResult`
- Regex-based deterministic extraction
- Finds: dates, times, addresses, weights, pieces, dimensions, temps, reference numbers
- Uses label hints to classify reference numbers (PO, BOL, pickup#, etc.)
- **Phone number filtering:** Excludes phone patterns from reference candidates
- **Customer rules:** Applies customer-specific label and regex rules before generic rules
- Returns candidates with confidence levels

**Patterns:**
- Dates: MM/DD/YYYY, "today", "tomorrow", month names
- Times: HH:MM, military time, "at noon"
- Locations: City, State ZIP patterns
- Addresses: Street patterns
- Reference numbers: 4+ digit numbers with label detection
- Weight: "Total Lbs: 22,176" → weight candidate
- Pieces: "Total Cases: 533" → pieces candidate
- Temperature: "Load Temp: -10" → temperature candidate

**Phone Detection:**
- (800) 657-7475, 844-211-1470, 208-287-0121 formats
- "Call for Appt. #:" treated as phone label
- 10-digit consecutive numbers filtered

### `src/lib/classifier.ts`
- **Function:** `classifyShipment(input: ClassifyInput): Promise<StructuredShipment>`
- **Function:** `classifyAndVerifyShipment(input): Promise<VerifiedShipmentResult>` - Full pipeline with verification + normalization
- Uses GPT-4o-mini with strict JSON schema
- Classifies candidates into structured shipment
- Includes customer profile context (cargo hints, reference rules)
- Never invents data (returns null for missing)
- Handles multi-stop shipments
- Classifies mystery numbers as "unknown" if unclear

**LLM Prompt Strategy:**
- System prompt: Rules about never inventing data, phone number exclusion, cargo extraction
- User prompt: Original text + extracted candidates + customer context
- Response format: Strict JSON schema (additionalProperties: false on all objects)

### `src/lib/verifier.ts`
- **Function:** `verifyShipment({ shipment, candidates, originalText }): VerifiedShipmentResult`
- Post-LLM hallucination detection
- Checks every LLM-returned value against:
  - Extracted candidates list
  - Exact substring match in original text
- Generates warnings for unsupported values
- Sets unsupported fields to null with `unsupported_by_source` warning

### `src/lib/normalizer.ts`
- **Function:** `normalizeShipment(shipment, originalText, candidates): NormalizedShipmentResult`
- Scopes reference numbers to correct level (global vs stop)
- Global refs: BOL, Load #, Order # from header section
- Stop refs: Pickup #, Delivery #, Confirmation #, Appointment #
- De-duplicates refs that appear in both global and stop
- Infers cargo source (header totals vs stop values)

### `src/lib/learning-detector.ts`
- **Function:** `detectReclassifications(original, final, candidates, tenderId): SuggestedRule[]`
- Compares LLM output with user's final edits
- Detects when user changes reference number type
- Suggests label rules from nearby labels
- Suggests regex rules from value patterns

### `src/lib/file-parser.ts`
- **Function:** `parseFile(buffer: Buffer, filename: string): Promise<ParseResult>`
- Supports: PDF (unpdf), DOCX (mammoth), TXT
- Returns extracted text + metadata (page count, word count)
- **PDF cleaning:** Removes filename/footer contamination:
  - Filters lines containing the uploaded filename
  - Filters "Page X of Y" patterns
  - Filters repeated footer lines across pages

---

## Frontend Components

### `src/app/page.tsx` (Home)
- Toggle between "Paste Text" and "Upload File"
- Paste mode: Large textarea
- Upload mode: Drag & drop + file picker
- Redirects to review page on success

### `src/app/tenders/[id]/review/page.tsx` (Review)
- **Two views:**
  - **Structured (Edit):** Editable form with all fields
  - **Raw:** Shows extracted candidates grouped by type
- **Left panel (Original Tender):**
  - PDF viewer (iframe) for uploaded PDFs
  - Toggle between Document view and Extracted Text
  - Plain text for paste input or DOCX
- **Right panel (Structured Shipment):**
  - **Shipment-level References:** Only global refs (BOL, Order #, etc.)
  - **Stop cards:** Each stop has its own reference section
  - Hallucination warning indicators on unverified fields
- **Editable components:**
  - Reference numbers (value + type dropdown)
  - Stops (location, schedule, refs)
  - Cargo (weight, pieces, dimensions, commodity, temp)
- **Customer features:**
  - Customer selection dropdown
  - "⚙️ Cargo Rules" button → modal for commodity-by-temp settings
  - "Learn All Rules" button for suggested label/regex rules
- **Save button:** "Approve & Save" → stores final_fields + learns rules
- **Status badge:** Shows DRAFT/REVIEWED/EXPORTED

---

## Environment Variables

Required in `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# OpenAI
OPENAI_API_KEY=sk-...
```

---

## Database Schema (SQL)

```sql
-- Tenders table
CREATE TABLE tenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('paste', 'file')),
  original_text TEXT NOT NULL,
  original_file_url TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'exported')),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tenders_created_at ON tenders(created_at DESC);

-- Extraction runs
CREATE TABLE extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  candidates JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  llm_output JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_extraction_runs_tender_id ON extraction_runs(tender_id);

-- Final fields
CREATE TABLE final_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  shipment JSONB NOT NULL,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_final_fields_tender_id ON final_fields(tender_id);
```

---

## File Structure

```
vl-build/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── customers/
│   │   │   │   ├── route.ts                    # GET/POST /api/customers
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts                # GET/PATCH/DELETE /api/customers/[id]
│   │   │   │       └── rules/route.ts          # POST/DELETE customer rules
│   │   │   └── tenders/
│   │   │       ├── route.ts                    # POST /api/tenders (paste)
│   │   │       ├── upload/route.ts             # POST /api/tenders/upload
│   │   │       ├── [id]/route.ts              # GET /api/tenders/[id]
│   │   │       └── [id]/final-fields/route.ts # POST /api/tenders/[id]/final-fields
│   │   ├── tenders/
│   │   │   └── [id]/
│   │   │       └── review/page.tsx             # Review page
│   │   ├── layout.tsx                          # Root layout
│   │   ├── page.tsx                           # Home page (paste/upload)
│   │   └── globals.css                         # Tailwind styles
│   └── lib/
│       ├── types.ts                            # TypeScript definitions
│       ├── supabase.ts                         # Supabase client
│       ├── extractor.ts                        # Regex extraction (with customer rules)
│       ├── classifier.ts                       # LLM classification
│       ├── verifier.ts                         # Post-LLM hallucination detection
│       ├── verifier.test.ts                    # Verifier unit tests
│       ├── normalizer.ts                       # Global vs stop-level reference scoping
│       ├── normalizer.test.ts                  # Normalizer unit tests
│       ├── learning-detector.ts                # Detects reclassifications for learning
│       └── file-parser.ts                      # PDF/Word parsing
├── supabase/
│   └── migrations/
│       ├── 001_customer_profiles.sql           # Customer profiles table
│       └── 002_cargo_hints.sql                 # Cargo hints column
├── public/                                     # Static assets
├── .env.local                                  # Environment variables
├── package.json
├── jest.config.js                              # Test configuration
├── tsconfig.json
└── next.config.ts
```

---

## Current Features (V1 Complete)

✅ **Input Methods**
- Paste tender text
- Upload PDF files
- Upload Word (.docx) files
- Upload text files
- Drag & drop support

✅ **Extraction**
- Deterministic regex extraction (dates, addresses, weights, refs, etc.)
- LLM classification into structured schema
- Multi-stop support (pickups + deliveries)
- Reference number classification (PO, BOL, pickup#, etc.)
- "Unknown" type for mystery numbers
- Post-LLM hallucination detection and warnings
- Customer-specific rule application
- Phone number filtering (prevents XXX-XXX-XXXX from becoming refs)
- PDF text cleanup (removes filename/footer contamination)
- Global vs stop-level reference scoping
- Cargo extraction from header totals (Total Lbs, Total Cases)

✅ **Review & Edit**
- Structured view with editable fields
- Raw candidates view
- Inline editing of all fields
- Reclassify reference numbers
- Add/remove reference numbers
- Edit stops, cargo, schedule
- Customer selection dropdown
- Hallucination warning indicators
- PDF viewer for uploaded documents (with extracted text fallback)
- Shipment-level vs stop-level reference separation
- Cargo rules configuration panel (commodity by temperature)

✅ **Storage**
- Original tender text/files in Supabase
- Extraction candidates stored
- LLM output stored
- Final reviewed fields stored
- Status tracking (draft → reviewed)
- Customer profiles with learned rules

✅ **Data Integrity**
- Never invents data (LLM returns null)
- Preserves original text
- Full audit trail
- Hallucination detection and warnings

✅ **Customer Learning**
- Customer profile management
- Label-to-subtype rule learning
- Regex pattern rule learning
- Rule suggestion on reclassification
- Customer rules applied before generic rules
- Cargo hints: commodity by temperature (frozen → "Frozen Food")
- Default commodity and temperature mode settings

---

## Known Limitations

1. **File parsing:**
   - `.doc` (old Word format) not supported (must be .docx)
   - PDFs with only images won't extract text
   - Large files (>10MB) may timeout

2. **Extraction:**
   - Regex patterns may miss edge cases
   - LLM may misclassify reference numbers
   - Multi-stop sequencing assumes pickups before deliveries

3. **No authentication:**
   - Internal tool, no user auth yet
   - `reviewed_by` field exists but not populated

4. **No McLeod integration:**
   - V1 explicitly excludes McLeod creation
   - Only stores data for future export

---

## Future Enhancements (Post-V1)

### High Priority
- **Tender List Dashboard** - View all tenders, filter by status
- **Customer Assignment** - Link tenders to customers
- **McLeod Export** - Generate McLeod-compatible format
- **Pattern Learning** - Use corrections to improve extraction

### Medium Priority
- **Email Integration** - Parse emails directly
- **Batch Processing** - Upload multiple files at once
- **Export Formats** - CSV, JSON, McLeod XML
- **Search** - Search tenders by customer, date, ref number

### Low Priority
- **User Authentication** - Track who reviewed what
- **Version History** - Track changes to final_fields
- **Notifications** - Alert on new tenders
- **Analytics** - Extraction accuracy metrics

---

## Development Notes

### Adding New Extraction Patterns
Edit `src/lib/extractor.ts`:
- Add pattern to `PATTERNS` array
- Add label hints to `REFERENCE_LABELS` if needed
- Test with real tender examples

### Modifying Shipment Schema
1. Update `StructuredShipment` in `src/lib/types.ts`
2. Update LLM schema in `src/lib/classifier.ts` (RESPONSE_SCHEMA)
3. Update review page components if UI changes needed

### Adding File Types
1. Add parser function in `src/lib/file-parser.ts`
2. Update `getFileType()` and `isSupported()`
3. Add to `parseFile()` switch statement

---

## Testing Checklist

- [x] Paste text → extraction → review → save
- [x] Upload PDF → extraction → review → save
- [x] Upload DOCX → extraction → review → save
- [x] Edit fields in review screen
- [x] Reclassify reference numbers
- [x] Save final fields updates status
- [x] Verifier unit tests (21 tests passing)
- [x] Normalizer unit tests (global vs stop-level scoping)
- [x] Phone numbers excluded from reference candidates
- [x] PDF viewer displays uploaded documents
- [x] Customer cargo rules saved and applied
- [ ] Error handling for invalid files
- [ ] Error handling for LLM failures
- [ ] Large file handling

---

## Deployment Considerations

1. **Environment Variables:** Set in production environment
2. **Supabase:** Ensure RLS policies if needed (currently none)
3. **Storage Bucket:** Ensure `tender-files` bucket exists
4. **OpenAI API:** Monitor usage/costs
5. **File Size Limits:** Configure Next.js body size limits if needed

---

## Contact & Maintenance

**Current State:** V1 complete, ready for internal testing

**Next Steps:** User feedback → iterate on extraction patterns → add McLeod export

---

*Last Updated: January 17, 2026*
