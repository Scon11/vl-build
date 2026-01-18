# VL Build - Architecture Overview

## Project Summary

**VL Build** is an internal freight brokerage tool for parsing load tenders from emails, PDFs, and Word documents. It uses a hybrid extraction approach (deterministic regex + LLM classification) to extract structured shipment data, presents it for human review, and stores the corrected results in Supabase.

**Version:** V1.6.1 (UI Refinements)

**Status:** Production-ready for internal use (500+ customer scale)

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

Optional configuration (with defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_REQUESTS_PER_MINUTE` | 10 | Rate limit for extraction routes |
| `MAX_REPROCESS_PER_HOUR` | 5 | Rate limit for reprocess per tender |
| `MAX_FILE_SIZE_MB` | 10 | Maximum upload file size |
| `MAX_PDF_PAGES` | 20 | Maximum pages in PDF uploads |
| `DEDUPE_WINDOW_DAYS` | 7 | Days to check for duplicate files |
| `BATCH_MAX_FILES` | 10 | Maximum files per batch upload |
| `NEXT_PUBLIC_BATCH_MAX_FILES` | 10 | Exposed to client for batch UI |

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
│     - Customer-specific rules applied with PRECEDENCE (V1.4):               │
│       1. Value pattern rules (TRFR* → PO globally)                          │
│       2. Label rules ("Release #" → PO)                                     │
│       3. Regex rules (legacy)                                               │
│     - Scope enforcement: rules only apply in matching blocks                │
│     - Deprecated rules are skipped                                          │
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
│     - V1.4 HARDENED RULE SUGGESTIONS:                                       │
│       • Value patterns only proposed if score >= 3                          │
│       • Collision check: reject if >3 distinct matches                      │
│       • Show regex + match count + examples in UI                           │
│       • Lifecycle metadata: status, created_by, hits                        │
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
| `reference_regex_rules` | JSONB | Regex pattern → subtype mappings (legacy) |
| `reference_value_rules` | JSONB | Value-pattern rules - highest priority (V1.4) |
| `stop_parsing_hints` | JSONB | Customer-specific parsing hints |
| `cargo_hints` | JSONB | Cargo inference rules (see below) |
| `notes` | TEXT | Optional notes |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update |

**reference_value_rules structure (V1.4):**
```json
[
  {
    "pattern": "^TRFR\\d{7,}$",
    "subtype": "po",
    "scope": "global",
    "priority": 0,
    "confidence": 0.8,
    "status": "active",
    "created_by": "user-uuid",
    "hits": 15,
    "learned_from": "tender-uuid",
    "created_at": "2026-01-18T00:00:00Z"
  }
]
```

**Rule Precedence (highest to lowest):**
1. `reference_value_rules` - Match on VALUE pattern (e.g., TRFR* → PO globally)
2. `reference_label_rules` - Match on LABEL text (e.g., "Release #" → PO)
3. `reference_regex_rules` - Legacy pattern matching (deprecated)

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

#### `rate_limit_entries` (V1.5)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `user_id` | UUID, FK | User being rate limited |
| `route` | TEXT | API route being limited |
| `resource_id` | TEXT | Optional resource ID (e.g., tender_id) |
| `created_at` | TIMESTAMPTZ | When request was made |

#### `llm_usage_logs` (V1.5)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `tender_id` | UUID, FK | Associated tender |
| `extraction_run_id` | UUID, FK | Associated extraction run |
| `route` | TEXT | API route that made the call |
| `operation` | TEXT | Operation type (classify/extract/reprocess) |
| `model` | TEXT | OpenAI model used |
| `prompt_tokens` | INTEGER | Input tokens |
| `completion_tokens` | INTEGER | Output tokens |
| `total_tokens` | INTEGER | Total tokens |
| `duration_ms` | INTEGER | Request duration |
| `parser_type` | TEXT | Parser used (pdf/docx/txt/paste) |
| `success` | BOOLEAN | Whether extraction succeeded |
| `error_code` | TEXT | Error code if failed |
| `error_message` | TEXT | Error message if failed |
| `user_id` | UUID, FK | User who triggered the call |
| `customer_id` | UUID, FK | Associated customer |
| `created_at` | TIMESTAMPTZ | When call was made |

#### `idempotency_keys` (V1.5)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `key` | TEXT | Idempotency key from client |
| `user_id` | UUID, FK | User who made the request |
| `route` | TEXT | API route |
| `request_hash` | TEXT | SHA-256 of request payload |
| `response_json` | JSONB | Cached response |
| `status` | TEXT | pending/completed/failed |
| `created_at` | TIMESTAMPTZ | When created |

#### `tender_batches` (V1.6)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `created_by` | UUID, FK | User who created the batch |
| `customer_id` | UUID, FK | Optional associated customer |
| `status` | TEXT | 'active', 'completed', or 'abandoned' |
| `current_index` | INTEGER | Current position in review queue |
| `total_items` | INTEGER | Total files in batch |
| `created_at` | TIMESTAMPTZ | When created |
| `updated_at` | TIMESTAMPTZ | Last update |

#### `tender_batch_items` (V1.6)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | Primary key |
| `batch_id` | UUID, FK | Reference to tender_batches |
| `tender_id` | UUID, FK | Reference to tender |
| `file_name` | TEXT | Original file name |
| `source_type` | TEXT | 'file' or 'paste' |
| `position` | INTEGER | Order in batch (0-based) |
| `state` | TEXT | 'ready', 'needs_review', 'reviewed', 'skipped', 'failed' |
| `deduped` | BOOLEAN | True if file was a duplicate |
| `error_message` | TEXT | Error message if failed |
| `created_at` | TIMESTAMPTZ | When created |
| `updated_at` | TIMESTAMPTZ | Last update |

### Supabase Storage

- **Bucket:** `tender-files` (private)
- **Purpose:** Stores original PDF/DOCX/TXT files
- **Naming:** `{timestamp}-{random}.{ext}`
- **Access:** Via signed URLs (1-hour expiry) from `/api/tenders/[id]/file-url`

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

### Batch Upload (V1.6)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/tenders/batch-upload` | Upload multiple files, create batch |
| `GET` | `/api/tenders/batches/[id]` | Get batch details + items |
| `PATCH` | `/api/tenders/batches/[id]/advance` | Advance to next item (next/skip) |

### Admin (V1.5)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/admin/observability` | LLM usage summary (admin only) |
| `GET` | `/api/admin/observability/failing-customers` | Failing customers (admin only) |
| `GET/POST/DELETE` | `/api/admin/customers/[id]/rules` | Manage customer rules (admin only) |
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
- **Function:** `detectReclassifications(input)` - Detects reference type changes
- **Function:** `detectAllEdits(input)` - Detects all user edits (refs, cargo, etc.)
- **Function:** `isRuleAlreadyLearned(suggestion, labelRules, regexRules, valueRules)`

**V1.4 Hardening Features:**
- Generic pattern detection (no prefix allowlists)
- Collision checking (rejects patterns matching >3 distinct values)
- Scoring threshold (score >= 3 required to propose value_pattern)
- Scope-aware learning (pickup/delivery/header/global)
- Low-entropy value rejection (repeated chars, sequential runs)
- Phone/date/time pattern exclusion

**Scoring Factors:**
- `+2`: Changed from unknown to specific type
- `+2`: Appears in multiple blocks (pickup + delivery)
- `+1`: Labels differ across occurrences
- `+1`: Clear alphanumeric structure
- `-2`: Length < 8 characters
- `-2`: Collision count > 3
- `-2`: Matches exclusion pattern
- `-1`: Low entropy / purely numeric

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
│   │   │       ├── batch-upload/route.ts       # POST batch (V1.6)
│   │   │       ├── batches/[id]/
│   │   │       │   ├── route.ts                # GET batch details
│   │   │       │   └── advance/route.ts        # PATCH next/skip
│   │   │       └── [id]/
│   │   │           ├── route.ts                # GET tender
│   │   │           ├── final-fields/route.ts   # POST save + learn
│   │   │           └── reprocess/route.ts      # POST reprocess
│   │   ├── tenders/
│   │   │   ├── [id]/review/page.tsx            # Review page (+ batch mode)
│   │   │   └── batch/[batchId]/
│   │   │       ├── review/page.tsx             # Batch review list (V1.6)
│   │   │       └── complete/page.tsx           # Batch completion (V1.6)
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
│       ├── extractor-value-rules.test.ts       # Value rule tests (V1.4)
│       ├── classifier.ts                       # LLM classification + usage tracking
│       ├── verifier.ts                         # Hallucination detection
│       ├── verifier.test.ts                    # Verifier tests
│       ├── normalizer.ts                       # Reference scoping
│       ├── normalizer.test.ts                  # Normalizer tests
│       ├── learning-detector.ts                # Edit detection + rule learning
│       ├── learning-detector.test.ts           # Learning system tests (V1.4)
│       ├── segmenter.ts                        # Text block segmentation
│       ├── state-machine.ts                    # Tender status transitions
│       ├── state-machine.test.ts               # State machine tests
│       ├── retry.ts                            # Retry utilities
│       ├── retry.test.ts                       # Retry tests
│       ├── hash.ts                             # SHA-256 hashing (V1.5)
│       ├── hash.test.ts                        # Hash tests (V1.5)
│       ├── batch.test.ts                       # Batch upload tests (V1.6)
│       ├── rate-limiter.ts                     # Postgres rate limiting (V1.5)
│       ├── rate-limiter.test.ts                # Rate limit tests (V1.5)
│       ├── tender-lock.ts                      # Processing locks (V1.5)
│       ├── tender-lock.test.ts                 # Lock tests (V1.5)
│       ├── llm-usage.ts                        # LLM usage tracking (V1.5)
│       ├── idempotency.ts                      # Idempotency keys (V1.5)
│       └── file-parser.ts                      # PDF/Word parsing + page count
├── supabase/
│   └── migrations/
│       ├── 001_customer_profiles.sql
│       ├── 002_cargo_hints.sql
│       ├── 003_learning_events.sql
│       ├── 004_auth_rls_export.sql
│       ├── 005_state_machine_idempotency_rules.sql
│       ├── 006_reference_value_rules.sql       # V1.4 value pattern rules
│       └── 007_dedupe_locks_ratelimit_observability.sql  # V1.5
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

✅ **Learning System (V1.4 Hardened)**
- Automatic learning from user edits
- Three rule types with precedence: value_pattern > label > regex
- **Value Pattern Rules** (highest priority):
  - Generic pattern detection (no prefix allowlists)
  - Collision checking (rejects overly-broad patterns)
  - Scoring threshold (score >= 3 to propose)
  - Scope-aware: global, pickup, delivery, header
  - Low-entropy rejection (repeated chars, sequential runs)
  - Phone/date/time pattern exclusion
- Label-to-subtype rule learning
- Cargo hints (commodity by temperature)
- Rule lifecycle: status (active/deprecated), hits counter, created_by
- Deprecated rules are never applied
- Learning events stored per customer
- Rules applied on future extractions with scope enforcement

✅ **Storage**
- Original files in Supabase Storage (private bucket)
- Signed URL access with 1-hour expiry
- Full audit trail (text, candidates, LLM output, provenance, final)
- Status tracking (draft → reviewed)

✅ **Production Hardening (V1.5)**
- **Deduplication:**
  - File hash (SHA-256) for uploaded files
  - Text hash for pasted content
  - 7-day window for duplicate detection (configurable)
  - Returns existing tender ID on duplicate
- **Processing Locks:**
  - Prevents concurrent processing of same tender
  - 10-minute lock timeout (auto-cleanup)
  - Returns 409 with lock info if locked
- **Rate Limiting:**
  - Per-user request limits (10/minute for extraction)
  - Per-tender limits (5 reprocesses/hour)
  - Postgres-backed for server-side enforcement
  - Returns 429 with Retry-After header
- **File Size Limits:**
  - Max file size (10MB default, configurable)
  - Max PDF pages (20 default, configurable)
  - Returns 413/422 for violations
- **Idempotency:**
  - Automatic key generation from file/text hash
  - Supports explicit Idempotency-Key header
  - Caches responses for safe retries

✅ **Batch Upload (V1.6)**
- **Multi-File Upload:**
  - Upload up to 10 files at once (configurable via BATCH_MAX_FILES)
  - Sequential processing to avoid rate limits
  - Per-file error handling (failed files don't block batch)
- **Sequential Review Queue:**
  - Review tenders one at a time in order
  - "Save & Next" advances to next tender
  - "Skip" skips current tender and moves to next
  - Progress bar shows completion status
- **Resumable Sessions:**
  - Batch state persisted in database
  - Refresh or close browser and continue later
  - `/tenders/batch/[id]/review` shows all files + progress
- **Deduplication Integration:**
  - Duplicate files link to existing tender
  - Already-reviewed duplicates auto-marked as reviewed
  - Deduped flag shown in batch summary
  - **Single upload duplicate detection:** Shows persistent orange banner on review page
- **Completion Screen:**
  - Summary counts: reviewed, skipped, failed, deduped
  - Links to failed/skipped items for manual retry
  - 24-hour TTL with auto-cleanup

✅ **UI Refinements (V1.6.1)**
- **Home Screen:**
  - Clean layout with centered upload bar
  - Customer selector positioned below upload bar (narrower, centered)
  - No helper text - minimal visual clutter
- **Review Page:**
  - Compact single-row header with batch controls (when in batch mode)
  - Home button with icon replaces "← New"
  - Heroicons for calendar and clock fields (replacing emojis)
  - Duplicate detection banner (orange) for single uploads that matched existing tender

✅ **Observability (V1.5)**
- **LLM Usage Tracking:**
  - Token usage (prompt/completion/total)
  - Duration and latency metrics
  - Parser type (pdf/docx/txt/paste)
  - Error tracking with codes and messages
  - Per-user and per-customer attribution
- **Admin Dashboards:**
  - `/admin/observability` - LLM spend, calls, success rate, top users
  - `/admin/observability/failing-customers` - Warning/failure rates by customer
  - Date range filters (7/30 days)

---

## Testing

Run tests:
```bash
npm test
```

Current test coverage (127 tests total):
- **Verifier:** 17 tests (provenance, categories, rule protection)
- **Normalizer:** 8 tests (reference scoping)
- **Learning Detector:** 15 tests (V1.4 hardening)
  - Generic pattern detection (prefix + numbers, dashed, mixed alphanumeric)
  - Collision-based rejection
  - Short/low-entropy value rejection
  - Phone pattern rejection
  - Scope detection
  - Match metadata for UI transparency
- **Extractor Value Rules:** 5 tests (V1.4 hardening)
  - Deprecated rules not applied
  - Scope enforcement (pickup vs delivery)
  - Priority ordering
- **State Machine:** Tests for tender status transitions
- **Retry:** Tests for retry utilities
- **McLeod Provider:** Export integration tests
- **Hash:** 10 tests (V1.5 - buffer/text hashing, normalization)
- **Rate Limiter:** 5 tests (V1.5 - config, error class)
- **Tender Lock:** 4 tests (V1.5 - error class)

---

## Deployment Notes

1. **Environment Variables:** Set all required variables
2. **Supabase:** Run migrations, ensure storage bucket exists
3. **OpenAI:** Monitor API usage/costs
4. **File Size:** Configure Next.js body limits if needed

---

## Known Limitations

1. **File parsing:** .doc not supported (must be .docx), image-only PDFs won't extract
2. **Export:** McLeod provider implemented but not yet deployed to production
3. **Observability:** Admin dashboards require manual database migration run

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| V1.6.1 | Jan 2026 | **UI Refinements** - Home screen cleanup (customer selector below upload bar, no helper text), review page improvements (Home button with icon, Heroicons for date/time, duplicate detection banner for single uploads) |
| V1.6 | Jan 2026 | **Batch Upload + Sequential Review Queue** - Multi-file batch uploads (up to 10), sequential review with Save & Next / Skip, resumable sessions, batch progress tracking, completion summary, integration with deduplication, 19 new batch tests (127 total) |
| V1.5 | Jan 2026 | **Production Hardening** - File/text deduplication (SHA-256), processing locks, rate limiting (per-user + per-tender), file size/page limits, idempotency keys, LLM usage tracking, admin observability dashboards, 19 new tests |
| V1.4 | Jan 2026 | **Hardened Learning System** - Generic pattern detection, collision checks, scoring thresholds, scope enforcement, lifecycle metadata (status/hits/created_by), 20 new tests |
| V1.3 | Jan 2026 | Provenance-based verification, PDF viewer, hallucination detection |
| V1.2 | Jan 2026 | Customer profiles, learning system, cargo hints |
| V1.1 | Jan 2026 | Multi-stop support, reference classification |
| V1.0 | Jan 2026 | Initial release - text/file input, regex extraction, LLM classification |

---

*Last Updated: January 18, 2026*
