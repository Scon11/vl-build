# VL Build - Architecture Overview

## Project Summary

**VL Build** is an internal freight brokerage tool for parsing load tenders from emails, PDFs, and Word documents. It uses a hybrid extraction approach (deterministic regex + LLM classification) to extract structured shipment data, presents it for human review, and stores the corrected results in Supabase.

**Version:** V1.3 (Provenance-based verification + PDF viewer)

**Status:** Production-ready for internal use

---

## Tech Stack

- **Framework:** Next.js 16.1.3 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS 4
- **Database:** Supabase (PostgreSQL)
- **File Storage:** Supabase Storage
- **LLM:** OpenAI GPT-4o-mini (server-side only)
- **PDF Parsing:** unpdf (extraction), react-pdf-viewer (display)
- **Word Parsing:** mammoth
- **Deployment:** Not yet configured (local dev only)

---

## Environment Variables

Required environment variables (set in `.env.local`):

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o-mini |

See `.env.example` for the template.

**Security notes:**
- All OpenAI calls happen server-side only (`src/lib/classifier.ts`)
- Service role key is never exposed to the client
- `.env*` files are gitignored

---

## Core Architecture

### Data Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INPUT                                      │
│                    (Paste text or Upload PDF/DOCX/TXT)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [1] FILE PARSING (src/lib/file-parser.ts)                                   │
│     - PDF/DOCX/TXT parsing                                                  │
│     - Text cleanup (remove filename contamination, page headers)            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [2] STORE TENDER (Supabase: tenders table)                                  │
│     - original_text, original_file_url, customer_id                         │
│     - Upload file to Supabase Storage (tender-files bucket)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [3] DETERMINISTIC EXTRACTION (src/lib/extractor.ts)                         │
│     - Regex extraction: dates, times, addresses, weights, refs, temps       │
│     - Phone number filtering (prevents XXX-XXX-XXXX as refs)                │
│     - Customer-specific rules applied (label maps, regex patterns)          │
│     - High-confidence labeled field extraction (Load #, BOL, Weight)        │
│     - Output: ExtractedCandidate[] with confidence levels                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [4] LLM CLASSIFICATION (src/lib/classifier.ts) - SERVER-SIDE ONLY           │
│     - Model: GPT-4o-mini via OpenAI API                                     │
│     - Structures candidates into StructuredShipment schema                  │
│     - Customer profile context (cargo hints, reference rules)               │
│     - Never invents data (returns null for missing fields)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [5] POST-LLM VERIFICATION (src/lib/verifier.ts)                             │
│     - Validates all LLM values against source text + candidates             │
│     - Provenance tracking for each field:                                   │
│       • source_type: document_text | rule | user_edit | llm_inference       │
│       • confidence: 0-1 score                                               │
│       • evidence: matching text, position, label                            │
│     - Warning categories:                                                   │
│       • "hallucinated": LLM invented value with no source support           │
│       • "unverified": weak evidence, needs review                           │
│     - Rule-based values (cargo defaults) never flagged as hallucinated      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [6] NORMALIZATION (src/lib/normalizer.ts)                                   │
│     - Scope references: global vs stop-level                                │
│     - De-duplicate refs appearing in multiple places                        │
│     - Infer cargo source (header totals vs stop values)                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [7] CARGO DEFAULTS (src/lib/classifier.ts - applyCargoDefaults)             │
│     - Apply customer-learned cargo rules AFTER verification                 │
│     - Temperature-based commodity (frozen → "Frozen Food")                  │
│     - Provenance set to "rule" (never triggers hallucination warning)       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [8] STORE EXTRACTION RUN (Supabase: extraction_runs table)                  │
│     - candidates, llm_output, verification_warnings, field_provenance       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [9] HUMAN REVIEW SCREEN (src/app/tenders/[id]/review/page.tsx)              │
│     - PDF viewer (react-pdf-viewer) for uploaded documents                  │
│     - Editable structured fields with hallucination warnings                │
│     - Customer selection + reprocess with customer rules                    │
│     - Only shows hallucination banner for truly invented values             │
│     - Inline "low confidence" indicators for unverified fields              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ [10] SAVE & LEARN (src/app/api/tenders/[id]/final-fields/route.ts)          │
│     - Store corrected data in final_fields table                            │
│     - Detect all user edits (refs, cargo, dates)                            │
│     - Generate learning events for customer profile                         │
│     - Apply learned cargo defaults (commodity_by_temp)                      │
│     - Update tender status: draft → reviewed                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Never invent data** - LLM only classifies what was found, returns null for missing
2. **Hybrid approach** - Regex finds candidates, LLM structures them
3. **Human in the loop** - All extractions reviewed before saving
4. **Provenance tracking** - Every field knows where its value came from
5. **Customer learning** - Rules improve automatically from user edits
6. **Audit trail** - Original text, candidates, LLM output, provenance, and final fields all stored

---

## Data Model

### Tables

#### `tenders`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `source_type` | TEXT | 'paste' or 'file' |
| `original_text` | TEXT | Extracted text from file or paste |
| `original_file_url` | TEXT | Supabase Storage URL (if file upload) |
| `status` | TEXT | 'draft', 'reviewed', or 'exported' |
| `customer_id` | UUID, FK | Associated customer profile |
| `reviewed_at` | TIMESTAMPTZ | When reviewed |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

#### `extraction_runs`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `tender_id` | UUID, FK | Reference to tender |
| `candidates` | JSONB | Array of ExtractedCandidate objects |
| `metadata` | JSONB | Extraction metadata (version, file info, warnings, provenance) |
| `llm_output` | JSONB | StructuredShipment from LLM |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**metadata includes:**
- `verification_warnings`: Array of warnings with category (hallucinated/unverified)
- `field_provenance`: Map of field paths to provenance records
- `normalization`: Refs moved, deduplicated, cargo source

#### `final_fields`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `tender_id` | UUID, FK | Reference to tender |
| `shipment` | JSONB | Final reviewed StructuredShipment |
| `reviewed_by` | TEXT | For future auth |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update |

#### `customer_profiles`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `name` | TEXT | Customer display name |
| `code` | TEXT | Short code (e.g., "FFI") |
| `reference_label_rules` | JSONB | Learned label → subtype mappings |
| `reference_regex_rules` | JSONB | Regex pattern → subtype mappings |
| `stop_parsing_hints` | JSONB | Customer-specific parsing hints |
| `cargo_hints` | JSONB | Cargo inference rules (see below) |
| `notes` | TEXT | Optional notes |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update |

**cargo_hints structure:**
```json
{
  "commodity_by_temp": {
    "frozen": "Frozen Food",
    "refrigerated": "Refrigerated Goods",
    "dry": "Dry Goods"
  },
  "default_commodity": "General Freight",
  "default_temp_mode": "frozen"
}
```

#### `learning_events`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `customer_id` | UUID, FK | Customer this learning applies to |
| `tender_id` | UUID, FK | Tender where edit occurred |
| `field_type` | TEXT | Type of field edited |
| `field_path` | TEXT | JSON path to field |
| `before_value` | TEXT | Original value |
| `after_value` | TEXT | User-corrected value |
| `context` | JSONB | Contextual info (label_hint, temp, etc.) |
| `created_at` | TIMESTAMPTZ | When learned |

### Supabase Storage

- **Bucket:** `tender-files` (public)
- **Purpose:** Stores original PDF/DOCX/TXT files
- **Naming:** `{timestamp}-{random}.{ext}`

---

## API Routes

### Tender Management

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/tenders` | Create tender from pasted text |
| `POST` | `/api/tenders/upload` | Create tender from file upload |
| `GET` | `/api/tenders/[id]` | Fetch tender with latest extraction |
| `POST` | `/api/tenders/[id]/final-fields` | Save reviewed shipment + learn |
| `POST` | `/api/tenders/[id]/reprocess` | Re-run extraction with customer context |

### Customer Management

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/customers` | List all customer profiles |
| `POST` | `/api/customers` | Create new customer |
| `GET` | `/api/customers/[id]` | Get customer profile |
| `PATCH` | `/api/customers/[id]` | Update customer profile |
| `POST` | `/api/customers/[id]/rules` | Add a learned rule |
| `DELETE` | `/api/customers/[id]/rules` | Remove a rule |

---

## Key Libraries & Modules

### `src/lib/extractor.ts`
- **Function:** `extractCandidates(text, options?)`
- Regex-based deterministic extraction
- Customer-specific rules applied first
- Phone number filtering
- High-confidence labeled field extraction (Load #, BOL, Weight, Cases)

### `src/lib/classifier.ts`
- **Function:** `classifyShipment(input)` - Raw LLM classification
- **Function:** `classifyAndVerifyShipment(input)` - Full pipeline
- **OpenAI call:** Server-side only, uses `OPENAI_API_KEY`
- Model: GPT-4o-mini with strict JSON schema
- Applies cargo defaults after verification

### `src/lib/verifier.ts`
- **Function:** `verifyShipment(input)`
- Provenance tracking for every field
- Warning categories: "hallucinated" vs "unverified"
- Rule-based values protected from hallucination warnings

### `src/lib/normalizer.ts`
- **Function:** `normalizeShipment(shipment, text, candidates)`
- Scopes references (global vs stop-level)
- De-duplicates references
- Infers cargo source

### `src/lib/learning-detector.ts`
- **Function:** `detectAllEdits(original, final, candidates, tenderId)`
- Compares LLM output with user edits
- Generates learning events
- Suggests label/regex rules

### `src/lib/file-parser.ts`
- **Function:** `parseFile(buffer, filename)`
- Supports: PDF (unpdf), DOCX (mammoth), TXT
- PDF text cleanup

### `src/lib/segmenter.ts`
- **Function:** `segmentTextIntoBlocks(text)`
- Divides text into header/pickup/delivery blocks
- Used for context-aware rule application

### `src/components/PdfViewer.tsx`
- React component for PDF viewing
- Uses react-pdf-viewer + PDF.js
- Cross-browser compatible

---

## File Structure

```
vl-build/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── customers/
│   │   │   │   ├── route.ts                    # GET/POST customers
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts                # GET/PATCH/DELETE customer
│   │   │   │       └── rules/route.ts          # POST/DELETE rules
│   │   │   └── tenders/
│   │   │       ├── route.ts                    # POST (paste)
│   │   │       ├── upload/route.ts             # POST (file)
│   │   │       └── [id]/
│   │   │           ├── route.ts                # GET tender
│   │   │           ├── final-fields/route.ts   # POST save + learn
│   │   │           └── reprocess/route.ts      # POST reprocess
│   │   ├── tenders/[id]/review/page.tsx        # Review page
│   │   ├── layout.tsx                          # Root layout
│   │   ├── page.tsx                            # Home page
│   │   └── globals.css                         # Tailwind styles
│   ├── components/
│   │   ├── CustomerSelector.tsx                # Customer dropdown
│   │   ├── TenderComposer.tsx                  # Paste/upload input
│   │   └── PdfViewer.tsx                       # PDF viewer component
│   └── lib/
│       ├── types.ts                            # TypeScript definitions
│       ├── supabase.ts                         # Supabase client
│       ├── extractor.ts                        # Regex extraction
│       ├── classifier.ts                       # LLM classification
│       ├── verifier.ts                         # Hallucination detection
│       ├── verifier.test.ts                    # Verifier tests
│       ├── normalizer.ts                       # Reference scoping
│       ├── normalizer.test.ts                  # Normalizer tests
│       ├── learning-detector.ts                # Edit detection
│       ├── segmenter.ts                        # Text block segmentation
│       └── file-parser.ts                      # PDF/Word parsing
├── supabase/
│   └── migrations/
│       ├── 001_customer_profiles.sql
│       ├── 002_cargo_hints.sql
│       └── 003_learning_events.sql
├── public/                                     # Static assets
├── .env.example                                # Environment template
├── .env.local                                  # Local secrets (gitignored)
├── .gitignore
├── package.json
├── jest.config.js
├── tsconfig.json
└── next.config.ts
```

---

## Current Features

✅ **Input Methods**
- Paste tender text
- Upload PDF/DOCX/TXT files
- Drag & drop support
- Customer selection before upload

✅ **Extraction**
- Deterministic regex extraction
- LLM classification into structured schema
- Multi-stop support
- Reference number classification (PO, BOL, pickup#, etc.)
- Phone number filtering
- PDF text cleanup
- Global vs stop-level reference scoping
- Customer-specific rule application

✅ **Verification & Provenance**
- Provenance tracking for every field
- Warning categories: hallucinated vs unverified
- Rule-based values protected from hallucination warnings
- Yellow banner only for truly invented values

✅ **Review & Edit**
- PDF viewer (react-pdf-viewer) for all browsers
- Editable structured fields
- Customer selection + reprocess
- Hallucination warning indicators
- Inline low-confidence indicators

✅ **Learning System**
- Automatic learning from user edits
- Label-to-subtype rule learning
- Cargo hints (commodity by temperature)
- Learning events stored per customer
- Rules applied on future extractions

✅ **Storage**
- Original files in Supabase Storage
- Full audit trail (text, candidates, LLM output, provenance, final)
- Status tracking (draft → reviewed)

---

## Testing

Run tests:
```bash
npm test
```

Current test coverage:
- Verifier: 17 tests (provenance, categories, rule protection)
- Normalizer: 8 tests (reference scoping)

---

## Deployment Notes

1. **Environment Variables:** Set all required variables
2. **Supabase:** Run migrations, ensure storage bucket exists
3. **OpenAI:** Monitor API usage/costs
4. **File Size:** Configure Next.js body limits if needed

---

## Known Limitations

1. **File parsing:** .doc not supported (must be .docx), image-only PDFs won't extract
2. **No authentication:** Internal tool, no user auth yet
3. **No McLeod integration:** V1 stores data for future export only

---

*Last Updated: January 18, 2026*
