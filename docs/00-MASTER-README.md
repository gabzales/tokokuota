# Toko Kuota — Master Build Specification

## Project Identity

**Store:** Raja Kuota  
**Website:** Toko Kuota  
**Domain target:** `toko-kuota.web.id`  
**Theme:** Blue + Purple

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase PostgreSQL
- Supabase Auth
- Vercel
- KhfyPay REST API

## Main Objective

Build a production-ready digital reseller/top-up website that:

- is fast and mobile-friendly
- uses KhfyPay as provider
- minimizes unnecessary provider API requests
- minimizes Supabase database queries/egress
- minimizes Vercel serverless work
- protects user balances
- provides transaction history
- supports provider webhook
- supports admin management
- is structured for future multi-provider expansion

## Read These Files Before Coding

1. `01-PRD-TOKO-KUOTA.md`
2. `02-ARCHITECTURE-TOKO-KUOTA.md`
3. `03-SUPABASE-DATABASE-RLS.md`
4. `04-KHFYPAY-API-INTEGRATION.md`
5. `05-VIBECODE-CLAUDE-RULES.md`

## Priority

1. Financial integrity
2. Security
3. Correct provider integration
4. Idempotency
5. Performance
6. Maintainability
7. UI polish

## Critical Rules

Never:

- trust price from frontend
- directly mutate balance from browser
- expose KhfyPay API key
- refund twice
- process duplicate webhook twice
- generate a new `reff_id` for a retry of the same transaction
- invent undocumented KhfyPay response fields
- treat a provider timeout as an automatic failure

## Product Flow

```text
User
 ↓
Login
 ↓
Product Catalog
 ↓
Checkout
 ↓
Server Validation
 ↓
Atomic Balance Reservation
 ↓
Create PENDING transaction
 ↓
KhfyPay /trx
 ↓
Provider Callback / Webhook
 ↓
SUCCESS
or
FAILED → Atomic Refund
```

## Brand Direction

Use a modern reseller-dashboard style.

Primary visual direction:

- blue
- purple
- white
- slate/dark text
- subtle gradients
- clean cards
- mobile-first
- avoid excessive glassmorphism/neon effects

Initial design tokens:

```text
Primary Blue:   #2563EB
Secondary Purple: #7C3AED
Background:     #F8FAFC
Surface:        #FFFFFF
Text:           #0F172A
Muted:          #64748B
```

These are starting tokens and may be refined during UI implementation.

## Important Provider Limitation

The following exact KhfyPay JSON response schemas have not yet been supplied:

- `/list_product`
- `/trx`
- `/history`
- `/cek_stock_akrab`

Do not invent fields.

Implement provider adapters so real samples can later be mapped without rewriting application/business logic.

## Final Goal

The application must feel like a proper reseller platform, not a prototype.

Financial operations must be deterministic, auditable, secure, and idempotent.