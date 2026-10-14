# DepotFlow Security Checklist

## Accounts and roles expansion

Planning documents:
- [Phase 1 authorization audit](./access-control-phase1-audit.md)
- [Staff permission matrix (proposed)](./staff-permission-matrix.md)
- [Gated multi-business migration plan](./accounts-security-rollout.md)
- [Additive M1 business and membership blueprint](./business-membership-m1-blueprint.md)

Before granting **any staff or multi-business access**, verify:
- every business-owned table/record is scoped and all foreign keys respect the same business
- every read and privileged RPC checks active membership and the exact permission in PostgreSQL
- no role bypasses cost-price, financial export, staff permissions, or cross-business protections by direct API call
- suspended employees are denied on the next protected operation, including existing sessions
- all legacy sale, payment, debt, receipt, empties, stock and idempotency invariants pass
- secure staff invitation, owner recovery, audit log and approval rules are tested
- public receipt verification exposes only intended fields
- isolated two-business negative tests pass before enabling staff

**These are release gates, not claims about the current production system.**

## Existing release checklist

Before release, verify:

- .env.local is gitignored
- no Supabase secret/service-role key exists in browser code
- no secrets are committed to git history
- RLS enabled on every exposed table
- RLS policies tested using multiple users
- no customer/user record accessible by changing an ID
- server/database validates stock before sale completion
- stock cannot become negative under concurrent requests
- inputs validated server-side
- production errors do not expose stack traces/secrets
- logs contain no secrets/session tokens
- auth checks use trusted Supabase claims
- protected mutations cannot rely only on UI checks
- uploaded product images restricted by type/size when implemented
- rate limits added where abuse is realistic
- dependencies audited before deployment