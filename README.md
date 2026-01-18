# VL Build

A Next.js application for freight tender extraction, verification, and export to TMS systems.

## Features

- **Tender Processing**: Upload or paste freight tenders for automated extraction
- **AI-Powered Extraction**: Uses OpenAI to extract shipment data from unstructured text
- **Verification & Review**: Hallucination detection and human review workflow
- **Customer Learning**: Auto-learns customer-specific patterns and rules
- **TMS Export**: Dry-run validation and export to McLeod TMS (extensible to other providers)
- **Role-Based Access**: User and admin roles with RLS policies

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase project (for database and auth)
- OpenAI API key (for extraction)

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OpenAI (required for extraction)
OPENAI_API_KEY=your-openai-key

# McLeod TMS (optional - enables live export)
MCLEOD_API_BASE_URL=https://api.mcleod.com
MCLEOD_API_KEY=your-mcleod-key

# App URL (optional)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Installation

```bash
npm install
```

### Database Setup

Run the Supabase migrations in order:

```bash
# Apply migrations to your Supabase project
supabase db push

# Or apply manually:
# 001_customer_profiles.sql
# 002_cargo_hints.sql
# 003_learning_events.sql
# 004_auth_rls_export.sql
# 005_state_machine_idempotency_rules.sql
```

### Running Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Authentication & Authorization

### Creating the First Admin User

1. Sign up via the login page at `/login`
2. In Supabase Dashboard, go to Authentication > Users
3. Find your user and copy the UUID
4. In SQL Editor, run:

```sql
UPDATE user_profiles 
SET role = 'admin' 
WHERE id = 'your-user-uuid';
```

### Roles

- **user**: Can create/view tenders, review extractions, run dry-run exports
- **admin**: All user permissions + manage customer rules, approve proposed rules, access admin pages

### Protected Routes

- All routes require authentication (redirects to `/login` if not authenticated)
- Admin routes (`/admin/*`) require admin role
- API routes use `requireAuth()` or `requireAdmin()` helpers

## Tender Status Lifecycle

```
draft → extracted → needs_review → reviewed → export_pending → exported
                                            ↘ export_failed (can retry)
```

- **draft**: Initial state after upload/paste
- **extracted**: AI extraction completed
- **needs_review**: Flagged for human review (hallucination warnings)
- **reviewed**: Human approved the extraction
- **export_pending**: Export in progress
- **exported**: Successfully exported to TMS
- **export_failed**: Export failed (can retry)

## API Idempotency

POST routes support idempotency via the `Idempotency-Key` header:

```bash
curl -X POST /api/tenders/123/export \
  -H "Idempotency-Key: unique-key-123" \
  -H "Content-Type: application/json" \
  -d '{"mode": "live"}'
```

If the same key + route is used:
- Same payload: Returns cached response
- Different payload: Returns 409 Conflict

## Export Providers

### McLeod TMS

The McLeod provider supports:

- **Dry Run**: Validates payload and returns mapped format without sending
- **Live Export**: Sends to McLeod API (requires `MCLEOD_API_BASE_URL` and `MCLEOD_API_KEY`)

To add a new provider:
1. Create a class implementing `IExportProvider` in `src/lib/export/`
2. Add to the registry in `src/lib/export/index.ts`

## Customer Rules Governance

Customer rules have a lifecycle:
- **proposed**: Learned from user corrections, pending approval
- **active**: Approved and used in extraction
- **deprecated**: Disabled but preserved for audit

Admin UI: `/admin/customers/[id]/rules`

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- state-machine.test.ts

# Run with coverage
npm test -- --coverage
```

## Project Structure

```
src/
├── app/
│   ├── api/              # API routes
│   │   ├── admin/        # Admin-only routes
│   │   ├── customers/    # Customer CRUD
│   │   └── tenders/      # Tender operations
│   ├── admin/            # Admin pages
│   ├── login/            # Auth pages
│   └── tenders/          # Tender review page
├── components/           # React components
└── lib/
    ├── auth.ts           # Auth utilities
    ├── customer-rules.ts # Rule management
    ├── export/           # Export providers
    ├── idempotency.ts    # Idempotency handling
    ├── retry.ts          # Retry with backoff
    ├── state-machine.ts  # Tender status transitions
    ├── supabase/         # Database clients
    └── tender-lock.ts    # Concurrency control
```

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import in Vercel
3. Add environment variables
4. Deploy

### Other Platforms

Ensure:
- Node.js 18+ runtime
- Environment variables configured
- Supabase project accessible

## License

Proprietary - Vantage Logistics
