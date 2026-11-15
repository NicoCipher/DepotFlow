# DepotFlow controlled owner invitation and business provisioning

**Status: staged code; NOT deployed to production.** Public signup remains closed. The migration does not enable any business rollout gate.

## Purpose

DepotFlow is an assisted-onboarding product. An operator, not a public signup page, authorises a new owner. The process is split into two auditable steps:

1. Authorise one exact email for one 15-minute invitation window.
2. After Supabase Auth creates the invited user, provision the business, owner membership, profile and registration audit row in one database transaction.

The existing business_auth_signup_gate remains OFF. The auth.users insert guard accepts only a request from the trusted supabase_auth_admin database session for the exact, unexpired, operator-prepared email, and consumes that request atomically. It deliberately does not depend on invited_at because GoTrue may populate that field after the initial INSERT. Ordinary public signup and unprepared Auth user creation remain denied. The database row alone cannot distinguish the Auth Invite user endpoint from another Auth-admin creation path for the same pre-authorised email, so operators must use Authentication → Users → Invite user as specified below.

## Mandatory M2 activation preflight

**Do this before creating the second business.** The customer, payment and sales paths deliberately require the global `legacy_write_scope_gate` as the M2 cutover prerequisite. Its activation procedure only supports the original single-business stage: exactly one legacy business, one active owner and one membership. Do not create Walnik first and then try to activate this gate.

The gate is not the Walnik business identity. It remains anchored to the existing legacy business and acts as a prerequisite for the separately gated nonlegacy business paths. Keep all 14 business rollout gates, public signup, customer-payment and sales gates OFF during this preflight.

Production read-only inspection on 15 November 2026 found:
- one active legacy business, one Auth user, one owner row and one active owner membership;
- all 31 tenant foreign keys still unvalidated (the staged validation migration must be released first);
- the legacy write gate has no row;
- the legacy inventory snapshot has exactly one unassigned row: the existing `public.shop_profile` singleton. The other 28 scoped tables have no rows.

After the approved forward-only migration release has validated all 31 tenant foreign keys:

1. Take and verify a restorable database backup. Re-run `select private.legacy_scope_snapshot();` and review the entire result. Do not assume the 15 November snapshot is still current.
2. If the only remaining unassigned/foreign-data checks still match the reviewed inventory, pass that exact reviewed JSON snapshot to `private.backfill_legacy_shop_rows(...)` in an explicit transaction. This operation tags the existing legacy shop rows—including the one `shop_profile` row—to the existing legacy business. It must never tag them to Walnik. Re-read the snapshot after commit and confirm every scoped row is assigned to the legacy business, with zero unassigned and zero foreign rows.
3. Review the post-backfill snapshot and pass that exact JSON to `private.enable_legacy_write_scope(...)` in a separate explicit transaction. This activation requires exactly 31 matching tenant FKs validated and the single legacy owner/business preconditions. Confirm the returned business ID is the existing legacy business ID and the gate is enabled.
4. Only after this succeeds may the operator create the separate Walnik business. Never repurpose the legacy business or import its test records as Walnik history.

If the snapshot changes, contains unexpected data, the backup cannot be verified, the owner/business counts differ, or any constraint is unvalidated, stop. Do not bypass the preflight by inserting a gate row manually. The backfill and gate activation are production data/security changes and require explicit operator approval.

## Auth invitation verification evidence

The disposable two-owner browser workflow now exercises the real local Supabase GoTrue `inviteUserByEmail` endpoint while the public signup gate is OFF. It prepares one exact email, verifies the Auth insert trigger consumes that request, provisions the invited test user into a separate `setup` business with `canOperate=false`, and confirms an unprepared Auth `createUser` call is rejected. This is stronger than a PostgreSQL-only role simulation, but it is still a disposable local GoTrue stack—not a hosted production invitation.

The production invitation must be the real intended Walnik owner account, not a fake test account. After the approved migration release, prepare the invitation with the final verified business name, address and phone, call Authentication → Users → Invite user, confirm the request changes to `user_created` for the exact Auth user ID, and only then call the operator provisioning function. Do not provision if the request is not consumed by the Auth insert guard.

## Operator procedure (after separately approved production deployment)

### 1. Prepare the invitation

Run this in the Supabase SQL Editor as the postgres operator. Use the actual business address and phone supplied by the business owner.

```sql
select private.prepare_business_invitation(
  gen_random_uuid(),
  'owner@example.com',
  'Business name',
  'Full business address',
  'Business phone'
);
```

Save the returned requestId. The authorisation expires after 15 minutes. Do not prepare a request until the email and business identity have been checked. The same request ID can be replayed with identical details; changed details are rejected.

### 2. Send the Auth invitation

In Supabase Dashboard, open **Authentication → Users → Invite user** and invite the exact email returned by step 1.

- Do not enable public signups.
- Do not use direct auth.users inserts.
- Do not use an Auth admin createUser call as a substitute for an invitation.
- Use the GoTrue invitation flow. The database trigger consumes the matching one-time authorisation inside the Auth insert transaction; it does not rely on invited_at being populated during the initial INSERT.
- If the invitation fails or the 15-minute window expires, inspect the private request row before preparing another request.

### 3. Provision the business

After the invited user appears in Authentication → Users, run:

```sql
select private.provision_invited_business('<request-id-from-step-1>');
```

This creates, atomically:

- one private.businesses row in setup status;
- one active owner membership for the invited Auth user;
- one public.business_profiles row;
- one private.business_registration_requests audit row;
- the final provisioned status and business ID on the invitation request.

The operation is idempotent. Repeating the same request returns the same business ID rather than creating a second depot.

### 4. Owner accepts the invite

The owner follows the invitation email, sets their password and signs in. The business remains in setup status. The multi-business selection and operational gates are still controlled separately; provisioning does not activate sales, receiving, stock or customer operations.

## Stop conditions

Stop and review manually if:

- the email already exists in Auth;
- the invitation request is expired, consumed or cancelled unexpectedly;
- the Auth user email does not match the prepared email;
- the business identity already belongs to another depot;
- provisioning reports an existing owner limit or membership conflict;
- the Auth invite does not create the expected Auth user under the trusted supabase_auth_admin database session;
- the hosted Before User Created hook rejects an authorised invitation.

Do not delete Auth users or repurpose the existing legacy business to recover from a failed invitation.

## Required hosted verification before production use

The disposable PostgreSQL 17 suite verifies the trigger and provisioning transaction with a simulated supabase_auth_admin session, including the case where invited_at is NULL at INSERT time. It does not prove the hosted GoTrue Invite user endpoint uses the same database role in this project, nor does it distinguish that endpoint from other Auth-admin creation paths. Before production deployment, verify the actual Invite user flow on an isolated staging project, confirm the database session role, confirm the invited user receives the expected email/password-setup flow, and confirm ordinary direct signup remains denied.

No production Auth user, invitation, business row or gate has been changed by this staged implementation.
