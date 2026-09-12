# DepotFlow

Technical foundation for a single-owner drinks shop. Only the mobile Home shell
is implemented; its four actions are visibly unavailable.

- `src/components`: reusable UI
- `src/domain`: pure quantity calculations, tests, and domain models
- `src/lib/supabase`: browser and request-scoped server clients
- `src/types`: initial database contract
- `supabase/migrations`: initial schema and RLS

Use Node.js 22.18+ (or Node.js 24). `npm run dev` starts Next.js.
`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` validate it.
The existing `.env.local` supplies `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No privileged key is used.
The proxy refreshes auth cookies; no login flow is implemented yet.

## Database boundary

Apply the migration to the intended Supabase project through the normal migration
workflow. It is not applied remotely by this change. An administrator must register
the existing authenticated owner's UUID in `private.shop_owner` (`user_id`). Its
singleton constraint permits exactly one configured owner. No owner is guessed or
seeded. With no configured owner, all application data is inaccessible.

All exposed tables have RLS and owner-only reads. Anonymous access and direct API
writes are denied. Before adding sale saving, implement one server-validated atomic
database operation for totals, stock deduction, debt, deposits and empty returns.
Do not enable independent writes to those tables. Amounts are integer naira;
stock and obligations cannot be negative. Sale items snapshot crate size and empty
types, so subsequent product changes cannot change the meaning of an old sale.

Money owed and deposits are distinct current balances. Physical empty stock and
customer obligations are distinct counts. Crate and bottle type identifiers are
independent; the optional product family is only a display label. Compatibility
and pricing for arbitrary combinations remain unimplemented pending business rules.
Quantity utilities reject fractional bottles and unsafe numbers instead of rounding.
